"use strict";

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

const DOCTYPE_JSON_RE = /[/\\]doctype[/\\]([^/\\]+)[/\\]\1\.json$/;
const PY_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const STANDARD_DOC_FIELDS = new Set(["doctype", "name", "owner", "creation", "modified", "modified_by", "docstatus", "idx"]);

let state;
let output;

function activate(context) {
  output = vscode.window.createOutputChannel("Frappe Intelli");
  // The extension keeps one bench index in memory. VS Code will recreate it
  // whenever the extension host starts, and file watchers refresh it as the
  // local bench changes.
  state = new FrappeState();
  const diagnostics = vscode.languages.createDiagnosticCollection("frappe-intelli");
  const explorer = new BenchExplorerProvider(state);

  context.subscriptions.push(
    diagnostics,
    vscode.window.registerTreeDataProvider("frappe-intelli.benchExplorer", explorer),
    registerCommand("reloadIndex", async () => {
      await state.reload(true);
      explorer.refresh();
      refreshDiagnostics(diagnostics);
    }),
    registerCommand("selectSite", async () => {
      await selectSite(state);
      explorer.refresh();
    }),
    registerCommand("openBenchConsole", () => runBenchCommand(state, "console")),
    registerCommand("runMigrate", () => runBenchCommand(state, "migrate")),
    registerCommand("clearCache", () => runBenchCommand(state, "clear-cache")),
    registerCommand("restartBench", () => runBenchCommand(state, "restart", { noSite: true })),
    registerCommand("buildAssets", () => runBenchCommand(state, "build", { noSite: true })),
    registerCommand("watchAssets", () => runBenchCommand(state, "watch", { noSite: true })),
    registerCommand("runCurrentTest", () => runCurrentTest(state)),
    registerCommand("openDoctypeJson", () => openCurrentDoctypeAsset(state, "json")),
    registerCommand("openController", () => openCurrentDoctypeAsset(state, "controller")),
    registerCommand("createPatch", () => createPatch(state)),
    registerCommand("showIndexStatus", () => showIndexStatus(state)),
    vscode.languages.registerCompletionItemProvider(
      ["python", "javascript", "typescript"],
      new FrappeCompletionProvider(state),
      ".",
      "\"",
      "'",
      "[",
      "{",
      ","
    ),
    vscode.languages.registerDefinitionProvider(["python", "javascript", "typescript"], new FrappeDefinitionProvider(state)),
    vscode.languages.registerHoverProvider(["python", "javascript", "typescript", "json"], new FrappeHoverProvider(state))
  );

  const watcher = vscode.workspace.createFileSystemWatcher("**/{*.json,*.py,*.js,*.ts,patches.txt,hooks.py,apps.txt}");
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(() => scheduleReload(explorer, diagnostics)),
    watcher.onDidChange(() => scheduleReload(explorer, diagnostics)),
    watcher.onDidDelete(() => scheduleReload(explorer, diagnostics)),
    vscode.workspace.onDidOpenTextDocument((document) => updateDiagnosticsForDocument(document, diagnostics)),
    vscode.workspace.onDidChangeTextDocument((event) => updateDiagnosticsForDocument(event.document, diagnostics)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("frappeIntelli")) {
        scheduleReload(explorer, diagnostics, 25);
      }
    })
  );

  state.reload(false).then(() => {
    explorer.refresh();
    refreshDiagnostics(diagnostics);
  });
}

function deactivate() {}

function registerCommand(name, handler) {
  return vscode.commands.registerCommand(`frappe-intelli.${name}`, handler);
}

class FrappeState {
  constructor() {
    this.clear();
  }

  async reload(showMessage) {
    // Frappe projects are often opened from the bench root, an app folder, or a
    // nested doctype folder. Discovery walks upward so all of those workflows
    // get the same local intelligence.
    const benchPath = findBenchPath();
    if (!benchPath) {
      this.clear();
      log("No bench detected. Set frappeIntelli.benchPath or open a Frappe bench folder.");
      if (showMessage) {
        vscode.window.showWarningMessage("Frappe Intelli could not find a bench. Set frappeIntelli.benchPath.");
      }
      return;
    }

    this.clear();
    this.benchPath = benchPath;
    this.apps = readApps(benchPath);
    this.sites = readSites(benchPath);
    this.defaultSite = resolveDefaultSite(benchPath, this.sites);

    const appsToIndex = getConfig().get("indexCustomAppsOnly")
      ? this.apps.filter((app) => !["frappe", "erpnext"].includes(app.name))
      : this.apps;

    for (const app of appsToIndex) {
      indexApp(this, app);
    }

    this.lastReload = Date.now();
    log(`Indexed bench: ${this.benchPath}`);
    log(`Apps: ${this.apps.map((app) => app.name).join(", ") || "none"}`);
    log(`Sites: ${this.sites.join(", ") || "none"}`);
    log(`DocTypes: ${this.doctypes.size}; methods: ${this.methodPaths.size}; patches: ${this.patchPaths.size}`);
    await vscode.commands.executeCommand("setContext", "frappe-intelli.hasBench", true);

    if (showMessage) {
      vscode.window.showInformationMessage(
        `Frappe Intelli indexed ${this.doctypes.size} DocTypes, ${this.methodPaths.size} methods, and ${this.patchPaths.size} patch entries.`
      );
    }
  }

  clear() {
    this.benchPath = "";
    this.apps = [];
    this.sites = [];
    this.defaultSite = "";
    this.doctypes = new Map();
    this.doctypeByPath = new Map();
    this.methodPaths = new Map();
    this.patchPaths = new Map();
    this.hookFiles = [];
    this.lastReload = 0;
  }
}

class FrappeCompletionProvider {
  constructor(frappeState) {
    this.state = frappeState;
  }

  provideCompletionItems(document, position) {
    if (!this.state.benchPath) {
      return [];
    }

    const line = document.lineAt(position).text.slice(0, position.character);
    const language = document.languageId;
    const currentDoctype = inferDoctypeForDocument(this.state, document);

    if (language === "python") {
      if (/\bfrappe\.\w*$/.test(line)) {
        return frappeApiCompletions();
      }
      if (/\bfrappe\.db\.\w*$/.test(line)) {
        return frappeDbApiCompletions();
      }
      if (isPythonDocumentAccess(line)) {
        return fieldCompletions(this.state, currentDoctype);
      }
      if (looksLikePythonDoctypeStringContext(line)) {
        return doctypeCompletions(this.state);
      }
      const doctypeFromCall = inferDoctypeFromNearbyCall(document, position);
      if (doctypeFromCall && looksLikePythonFieldStringContext(line)) {
        return fieldCompletions(this.state, doctypeFromCall);
      }
      if (looksLikeFrappeMethodString(line)) {
        return methodCompletions(this.state);
      }
    }

    if (["javascript", "typescript"].includes(language)) {
      if (/\bfrappe\.\w*$/.test(line)) {
        return frappeJsApiCompletions();
      }
      if (/\bfrappe\.db\.\w*$/.test(line)) {
        return frappeDbApiCompletions();
      }
      if (/\bfrm\.\w*$/.test(line)) {
        return frappeFrmApiCompletions();
      }
      if (/\b(?:frm\.doc|doc|row)\.\w*$/.test(line)) {
        return fieldCompletions(this.state, currentDoctype);
      }
      if (looksLikeJsDoctypeStringContext(line)) {
        return doctypeCompletions(this.state);
      }
      const frmDoctype = inferDoctypeFromFormScript(document, position) || currentDoctype;
      if (frmDoctype && looksLikeJsFieldStringContext(line)) {
        return fieldCompletions(this.state, frmDoctype);
      }
      if (looksLikeFrappeMethodString(line)) {
        return methodCompletions(this.state);
      }
    }

    return [];
  }
}

class FrappeDefinitionProvider {
  constructor(frappeState) {
    this.state = frappeState;
  }

  provideDefinition(document, position) {
    if (!this.state.benchPath) {
      return undefined;
    }

    const quoted = getQuotedStringAt(document, position);
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z0-9_ .-]+/);
    const value = quoted || (wordRange ? document.getText(wordRange).trim() : "");
    if (!value) {
      return undefined;
    }

    if (path.basename(document.uri.fsPath) === "patches.txt") {
      const patchPath = this.state.patchPaths.get(value) || this.state.patchPaths.get(`${value}.execute`);
      if (patchPath) {
        return locationAtSymbol(patchPath, "execute");
      }
    }

    const doctype = this.state.doctypes.get(value);
    if (doctype) {
      return new vscode.Location(vscode.Uri.file(doctype.jsonPath), new vscode.Position(0, 0));
    }

    const methodPath = this.state.methodPaths.get(value);
    if (methodPath) {
      return locationAtSymbol(methodPath, value.split(".").pop());
    }

    return undefined;
  }
}

class FrappeHoverProvider {
  constructor(frappeState) {
    this.state = frappeState;
  }

  provideHover(document, position) {
    const value = getQuotedStringAt(document, position);
    if (!value) {
      return undefined;
    }

    const doctype = this.state.doctypes.get(value);
    if (doctype) {
      const markdown = new vscode.MarkdownString();
      markdown.appendMarkdown(`**${doctype.name}**\n\n`);
      markdown.appendMarkdown(`App: \`${doctype.app}\`\n\n`);
      markdown.appendMarkdown(`Fields: \`${doctype.fields.length}\``);
      return new vscode.Hover(markdown);
    }

    const methodPath = this.state.methodPaths.get(value);
    if (methodPath) {
      return new vscode.Hover(new vscode.MarkdownString(`Frappe method\n\n\`${methodPath}\``));
    }

    return undefined;
  }
}

class BenchExplorerProvider {
  constructor(frappeState) {
    this.state = frappeState;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(item) {
    return item;
  }

  getChildren(item) {
    if (!this.state.benchPath) {
      return [treeItem("No bench detected", vscode.TreeItemCollapsibleState.None, "Set frappeIntelli.benchPath")];
    }

    if (!item) {
      return [
        treeItem(path.basename(this.state.benchPath), vscode.TreeItemCollapsibleState.Expanded, this.state.benchPath),
        treeItem("Sites", vscode.TreeItemCollapsibleState.Collapsed, `${this.state.sites.length} site(s)`),
        treeItem("Apps", vscode.TreeItemCollapsibleState.Collapsed, `${this.state.apps.length} app(s)`),
        treeItem("DocTypes", vscode.TreeItemCollapsibleState.Collapsed, `${this.state.doctypes.size} DocType(s)`),
        treeItem("Patches", vscode.TreeItemCollapsibleState.Collapsed, `${this.state.patchPaths.size} patch path(s)`)
      ];
    }

    if (item.label === "Sites") {
      return this.state.sites.map((site) => treeItem(site, vscode.TreeItemCollapsibleState.None, site));
    }

    if (item.label === "Apps") {
      return this.state.apps.map((app) => treeItem(app.name, vscode.TreeItemCollapsibleState.None, app.path));
    }

    if (item.label === "DocTypes") {
      return Array.from(this.state.doctypes.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 500)
        .map((doctype) => {
          const node = treeItem(doctype.name, vscode.TreeItemCollapsibleState.None, `${doctype.app} - ${doctype.fields.length} fields`);
          node.command = { command: "vscode.open", title: "Open DocType JSON", arguments: [vscode.Uri.file(doctype.jsonPath)] };
          return node;
        });
    }

    if (item.label === "Patches") {
      return Array.from(this.state.patchPaths.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, 500)
        .map(([patch, patchPath]) => {
          const node = treeItem(patch, vscode.TreeItemCollapsibleState.None, patchPath);
          node.command = { command: "vscode.open", title: "Open Patch", arguments: [vscode.Uri.file(patchPath)] };
          return node;
        });
    }

    return [];
  }
}

function getConfig() {
  return vscode.workspace.getConfiguration("frappeIntelli");
}

function findBenchPath() {
  const configured = getConfig().get("benchPath");
  if (configured && isBenchPath(configured)) {
    return configured;
  }

  for (const folder of vscode.workspace.workspaceFolders || []) {
    let current = folder.uri.fsPath;
    for (let i = 0; i < 8; i += 1) {
      if (isBenchPath(current)) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  return "";
}

function isBenchPath(candidate) {
  return fileExists(path.join(candidate, "sites", "apps.txt")) && dirExists(path.join(candidate, "apps"));
}

function readApps(benchPath) {
  return readFile(path.join(benchPath, "sites", "apps.txt"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((name) => ({ name, path: path.join(benchPath, "apps", name) }))
    .filter((app) => dirExists(app.path));
}

function readSites(benchPath) {
  const sitesPath = path.join(benchPath, "sites");
  if (!dirExists(sitesPath)) {
    return [];
  }

  return fs
    .readdirSync(sitesPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fileExists(path.join(sitesPath, entry.name, "site_config.json")))
    .map((entry) => entry.name)
    .sort();
}

function resolveDefaultSite(benchPath, sites) {
  const configured = getConfig().get("defaultSite");
  if (configured && sites.includes(configured)) {
    return configured;
  }

  const currentSitePath = path.join(benchPath, "sites", "currentsite.txt");
  const currentSite = readFile(currentSitePath).trim();
  if (sites.includes(currentSite)) {
    return currentSite;
  }

  return sites[0] || "";
}

function indexApp(frappeState, app) {
  // DocType JSON is the canonical source for fields. Controllers, client
  // scripts, patches, and methods are then linked back to that same app index.
  for (const jsonPath of walk(app.path, (file) => DOCTYPE_JSON_RE.test(file))) {
    const doctype = parseDoctypeJson(app.name, jsonPath);
    if (!doctype) {
      continue;
    }
    frappeState.doctypes.set(doctype.name, doctype);
    frappeState.doctypeByPath.set(normalizePath(doctype.jsonPath), doctype.name);
    if (doctype.controllerPath) {
      frappeState.doctypeByPath.set(normalizePath(doctype.controllerPath), doctype.name);
    }
    if (doctype.clientPath) {
      frappeState.doctypeByPath.set(normalizePath(doctype.clientPath), doctype.name);
    }
  }

  for (const pyFile of walk(app.path, (file) => file.endsWith(".py"))) {
    indexPythonMethods(frappeState, app, pyFile);
    if (path.basename(pyFile) === "hooks.py") {
      frappeState.hookFiles.push(pyFile);
    }
    if (pyFile.includes(`${path.sep}patches${path.sep}`)) {
      const dotted = fileToDotted(app, pyFile);
      if (dotted) {
        frappeState.patchPaths.set(dotted, pyFile);
        frappeState.patchPaths.set(`${dotted}.execute`, pyFile);
      }
    }
  }
}

function parseDoctypeJson(appName, jsonPath) {
  try {
    const data = JSON.parse(readFile(jsonPath));
    const name = data.name || data.doctype || titleFromFolder(path.basename(path.dirname(jsonPath)));
    const doctypeDir = path.dirname(jsonPath);
    const folderName = path.basename(doctypeDir);
    const controllerPath = path.join(doctypeDir, `${folderName}.py`);
    const clientPath = path.join(doctypeDir, `${folderName}.js`);
    const fields = Array.isArray(data.fields)
      ? data.fields
          .filter((field) => field && field.fieldname)
          .map((field) => ({
            fieldname: field.fieldname,
            label: field.label || field.fieldname,
            fieldtype: field.fieldtype || "Data",
            options: field.options || "",
            reqd: Boolean(field.reqd),
            hidden: Boolean(field.hidden)
          }))
      : [];

    return {
      name,
      app: appName,
      module: data.module || "",
      jsonPath,
      controllerPath: fileExists(controllerPath) ? controllerPath : "",
      clientPath: fileExists(clientPath) ? clientPath : "",
      fields
    };
  } catch {
    return undefined;
  }
}

function indexPythonMethods(frappeState, app, pyFile) {
  const dottedBase = fileToDotted(app, pyFile);
  if (!dottedBase) {
    return;
  }

  for (const match of readFile(pyFile).matchAll(/^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)) {
    frappeState.methodPaths.set(`${dottedBase}.${match[1]}`, pyFile);
  }
}

function fileToDotted(app, filePath) {
  const rel = path.relative(app.path, filePath).replace(/\\/g, "/");
  if (!rel.endsWith(".py")) {
    return "";
  }
  return rel.slice(0, -3).split("/").join(".");
}

function doctypeCompletions(frappeState) {
  return Array.from(frappeState.doctypes.values()).map((doctype) => {
    const item = new vscode.CompletionItem(doctype.name, vscode.CompletionItemKind.Class);
    item.detail = `DocType - ${doctype.app}`;
    item.documentation = new vscode.MarkdownString(`Fields: \`${doctype.fields.length}\`\n\nJSON: \`${doctype.jsonPath}\``);
    item.insertText = doctype.name;
    return item;
  });
}

function fieldCompletions(frappeState, doctypeName) {
  const doctype = frappeState.doctypes.get(doctypeName || "");
  if (!doctype) {
    return [];
  }

  return doctype.fields.map((field) => {
    const item = new vscode.CompletionItem(field.fieldname, vscode.CompletionItemKind.Field);
    item.detail = `${doctype.name}.${field.fieldname} (${field.fieldtype})`;
    item.documentation = new vscode.MarkdownString(
      `**${field.label}**\n\nType: \`${field.fieldtype}\`${field.options ? `\n\nOptions: \`${field.options}\`` : ""}`
    );
    item.insertText = field.fieldname;
    item.sortText = field.reqd ? `0_${field.fieldname}` : `1_${field.fieldname}`;
    return item;
  });
}

function methodCompletions(frappeState) {
  return Array.from(frappeState.methodPaths.keys()).map((method) => {
    const item = new vscode.CompletionItem(method, vscode.CompletionItemKind.Method);
    item.detail = "Frappe dotted method";
    item.documentation = `Source: ${frappeState.methodPaths.get(method)}`;
    item.insertText = method;
    return item;
  });
}

function frappeApiCompletions() {
  return [
    ["get_doc", "Fetch a document by DocType and name."],
    ["get_cached_doc", "Fetch a cached document."],
    ["new_doc", "Create a new document."],
    ["get_all", "Fetch records without permission checks."],
    ["get_list", "Fetch records with permission checks."],
    ["throw", "Raise a Frappe exception."],
    ["msgprint", "Show a message to the user."],
    ["whitelist", "Expose a Python method to HTTP/RPC."],
    ["enqueue", "Run a method in the background."],
    ["publish_realtime", "Publish a realtime event."]
  ].map(([label, documentation]) => {
    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Method);
    item.detail = "Frappe API";
    item.documentation = documentation;
    return item;
  });
}

function frappeJsApiCompletions() {
  return [
    ["call", "Call a whitelisted method."],
    ["db", "Client-side database helpers."],
    ["ui", "Frappe UI namespace."],
    ["model", "Client-side model helpers."],
    ["route_options", "Set route filters before navigation."],
    ["set_route", "Navigate to a route."],
    ["msgprint", "Show a translated message."],
    ["throw", "Throw a client-side Frappe error."],
    ["confirm", "Show a confirmation dialog."]
  ].map(([label, documentation]) => {
    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Method);
    item.detail = "Frappe JS API";
    item.documentation = documentation;
    return item;
  });
}

function frappeDbApiCompletions() {
  return [
    ["get_value", "Read one field value."],
    ["get_single_value", "Read a Single DocType field value."],
    ["set_value", "Update a field value."],
    ["exists", "Check whether a document exists."],
    ["count", "Count matching documents."],
    ["get_list", "Fetch a list of documents."]
  ].map(([label, documentation]) => {
    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Method);
    item.detail = "Frappe DB API";
    item.documentation = documentation;
    return item;
  });
}

function frappeFrmApiCompletions() {
  return [
    ["doc", "Current document."],
    ["set_value", "Set a field value."],
    ["get_field", "Get a field control."],
    ["refresh_field", "Refresh one field."],
    ["set_query", "Set a Link field query."],
    ["set_df_property", "Set field metadata at runtime."],
    ["toggle_display", "Show or hide a field."],
    ["toggle_enable", "Enable or disable a field."],
    ["add_custom_button", "Add a form button."],
    ["save", "Save the document."],
    ["reload_doc", "Reload the document."]
  ].map(([label, documentation]) => {
    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Method);
    item.detail = "Frappe Form API";
    item.documentation = documentation;
    return item;
  });
}

function looksLikePythonDoctypeStringContext(line) {
  return /\bfrappe\.(?:get_doc|get_cached_doc|new_doc|get_all|get_list|delete_doc)\(\s*["'][^"']*$/.test(line)
    || /\bfrappe\.db\.(?:get_value|get_single_value|set_value|exists|count|delete)\(\s*["'][^"']*$/.test(line)
    || /\bdoctype\s*=\s*["'][^"']*$/.test(line);
}

function looksLikePythonFieldStringContext(line) {
  return /\b(?:fields|fieldname|field)\s*=\s*(?:\[)?\s*["'][^"']*$/.test(line)
    || /[,{]\s*["'][^"']*$/.test(line);
}

function looksLikeJsDoctypeStringContext(line) {
  return /\bfrappe\.ui\.form\.on\(\s*["'][^"']*$/.test(line)
    || /\bfrappe\.model\.with_doc\(\s*["'][^"']*$/.test(line)
    || /\bfrappe\.db\.(?:get_value|get_list|get_doc|exists)\(\s*["'][^"']*$/.test(line)
    || /\bdoctype\s*:\s*["'][^"']*$/.test(line);
}

function looksLikeJsFieldStringContext(line) {
  return /\bfrm\.(?:set_value|get_field|toggle_display|toggle_enable|set_df_property|refresh_field|set_query)\(\s*["'][^"']*$/.test(line)
    || /\b(?:fieldname|field)\s*:\s*["'][^"']*$/.test(line)
    || /[,{]\s*["'][^"']*$/.test(line);
}

function looksLikeFrappeMethodString(line) {
  return /\b(?:method|handler)\s*[:=]\s*["'][A-Za-z0-9_.'-]*$/.test(line)
    || /\bfrappe\.call\(\s*\{[^}]*method\s*:\s*["'][A-Za-z0-9_.'-]*$/.test(line);
}

function isPythonDocumentAccess(line) {
  return /\b(?:self|doc|row)\.\w*$/.test(line);
}

function inferDoctypeForDocument(frappeState, document) {
  // Best case: the file path maps directly to a known DocType asset. Fallbacks
  // support custom client scripts and other files that declare the DocType in
  // code with frappe.ui.form.on("DocType", ...).
  const filePath = normalizePath(document.uri.fsPath);
  if (frappeState.doctypeByPath.has(filePath)) {
    return frappeState.doctypeByPath.get(filePath);
  }

  const dir = normalizePath(path.dirname(filePath));
  for (const doctype of frappeState.doctypes.values()) {
    if (normalizePath(path.dirname(doctype.jsonPath)) === dir) {
      return doctype.name;
    }
  }

  const formMatch = document.getText().match(/frappe\.ui\.form\.on\(\s*["']([^"']+)["']/);
  if (formMatch && frappeState.doctypes.has(formMatch[1])) {
    return formMatch[1];
  }

  return "";
}

function inferDoctypeFromFormScript(document, position) {
  const textBefore = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
  const matches = Array.from(textBefore.matchAll(/frappe\.ui\.form\.on\(\s*["']([^"']+)["']/g));
  return matches.length ? matches[matches.length - 1][1] : "";
}

function inferDoctypeFromNearbyCall(document, position) {
  const startLine = Math.max(0, position.line - 5);
  const text = document.getText(new vscode.Range(new vscode.Position(startLine, 0), position));
  const matches = Array.from(text.matchAll(/(?:frappe\.(?:get_doc|get_all|get_list)|frappe\.db\.(?:get_value|set_value|exists))\(\s*["']([^"']+)["']/g));
  return matches.length ? matches[matches.length - 1][1] : "";
}

function getQuotedStringAt(document, position) {
  const line = document.lineAt(position.line).text;
  const index = position.character;
  const quotePositions = [line.lastIndexOf("\"", index), line.lastIndexOf("'", index)].filter((value) => value >= 0);
  if (!quotePositions.length) {
    return "";
  }

  const leftQuote = Math.max(...quotePositions);
  const quote = line[leftQuote];
  const rightQuote = line.indexOf(quote, leftQuote + 1);
  if (rightQuote < index) {
    return "";
  }
  return line.slice(leftQuote + 1, rightQuote);
}

function locationAtSymbol(filePath, symbolName) {
  const text = readFile(filePath);
  const re = new RegExp(`^(?:def|class)\\s+${escapeRegex(symbolName)}\\b`, "m");
  const match = text.match(re);
  if (!match) {
    return new vscode.Location(vscode.Uri.file(filePath), new vscode.Position(0, 0));
  }

  const line = text.slice(0, match.index).split(/\r?\n/).length - 1;
  return new vscode.Location(vscode.Uri.file(filePath), new vscode.Position(line, 0));
}

async function selectSite(frappeState) {
  if (!frappeState.benchPath) {
    await frappeState.reload(false);
  }

  const site = await vscode.window.showQuickPick(frappeState.sites, {
    title: "Select Frappe site",
    placeHolder: "Site used by bench commands"
  });
  if (!site) {
    return;
  }

  await getConfig().update("defaultSite", site, vscode.ConfigurationTarget.Workspace);
  frappeState.defaultSite = site;
}

function showIndexStatus(frappeState) {
  const lines = [
    `Bench: ${frappeState.benchPath || "not detected"}`,
    `Default site: ${frappeState.defaultSite || "none"}`,
    `Apps: ${frappeState.apps.map((app) => app.name).join(", ") || "none"}`,
    `Sites: ${frappeState.sites.join(", ") || "none"}`,
    `DocTypes: ${frappeState.doctypes.size}`,
    `Methods: ${frappeState.methodPaths.size}`,
    `Patch paths: ${frappeState.patchPaths.size}`,
    `Last reload: ${frappeState.lastReload ? new Date(frappeState.lastReload).toLocaleString() : "never"}`
  ];
  vscode.window.showInformationMessage(lines.join(" | "));
  log(lines.join("\n"));
  output.show(true);
}

function runBenchCommand(frappeState, command, options = {}) {
  if (!frappeState.benchPath) {
    vscode.window.showWarningMessage("Frappe Intelli could not find a bench.");
    return;
  }

  const terminal = vscode.window.createTerminal({ name: `bench ${command}`, cwd: frappeState.benchPath });
  const site = options.noSite ? "" : frappeState.defaultSite;
  terminal.show();
  terminal.sendText(site ? `bench --site ${shellQuote(site)} ${command}` : `bench ${command}`);
}

function runCurrentTest(frappeState) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !frappeState.benchPath) {
    return;
  }

  const rel = path.relative(frappeState.benchPath, editor.document.uri.fsPath);
  const app = appNameFromBenchRelPath(rel);
  const moduleName = moduleFromBenchRelPath(rel);
  const terminal = vscode.window.createTerminal({ name: "bench run current test", cwd: frappeState.benchPath });
  terminal.show();
  terminal.sendText(app ? `bench run-tests --app ${shellQuote(app)} --module ${shellQuote(moduleName)}` : `bench run-tests --module ${shellQuote(moduleName)}`);
}

async function openCurrentDoctypeAsset(frappeState, kind) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const doctypeName = inferDoctypeForDocument(frappeState, editor.document);
  const doctype = frappeState.doctypes.get(doctypeName);
  if (!doctype) {
    vscode.window.showWarningMessage("No DocType could be inferred for the active file.");
    return;
  }

  const target = kind === "controller" ? doctype.controllerPath : doctype.jsonPath;
  if (!target) {
    vscode.window.showWarningMessage(`No ${kind} file found for ${doctype.name}.`);
    return;
  }

  await vscode.window.showTextDocument(vscode.Uri.file(target));
}

async function createPatch(frappeState) {
  if (!frappeState.benchPath) {
    vscode.window.showWarningMessage("Frappe Intelli could not find a bench.");
    return;
  }

  const customApps = frappeState.apps.filter((app) => !["frappe", "erpnext"].includes(app.name));
  const appName = await vscode.window.showQuickPick((customApps.length ? customApps : frappeState.apps).map((app) => app.name), {
    title: "Create Frappe patch",
    placeHolder: "Choose app"
  });
  if (!appName) {
    return;
  }

  const patchName = await vscode.window.showInputBox({
    title: "Patch file name",
    prompt: "Use snake_case, without .py",
    validateInput: (value) => (PY_IDENTIFIER_RE.test(value) ? undefined : "Use a valid snake_case Python identifier.")
  });
  if (!patchName) {
    return;
  }

  const app = frappeState.apps.find((candidate) => candidate.name === appName);
  const patchesDir = path.join(app.path, app.name, "patches", "v16_0");
  fs.mkdirSync(patchesDir, { recursive: true });
  const patchPath = path.join(patchesDir, `${patchName}.py`);

  if (!fileExists(patchPath)) {
    fs.writeFileSync(patchPath, "import frappe\n\n\ndef execute():\n\tpass\n", "utf8");
  }

  const patchDotted = `${app.name}.patches.v16_0.${patchName}`;
  const patchesTxt = path.join(frappeState.benchPath, "patches.txt");
  if (fileExists(patchesTxt)) {
    const text = readFile(patchesTxt);
    if (!text.includes(patchDotted)) {
      fs.appendFileSync(patchesTxt, `${text.endsWith("\n") ? "" : "\n"}${patchDotted}\n`);
    }
  }

  await vscode.window.showTextDocument(vscode.Uri.file(patchPath));
  await frappeState.reload(false);
}

let reloadTimer;
function scheduleReload(explorer, diagnostics, delay = 600) {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    await state.reload(false);
    explorer.refresh();
    refreshDiagnostics(diagnostics);
  }, delay);
}

function refreshDiagnostics(collection) {
  if (!getConfig().get("enableDiagnostics")) {
    collection.clear();
    return;
  }

  for (const document of vscode.workspace.textDocuments) {
    updateDiagnosticsForDocument(document, collection);
  }
}

function updateDiagnosticsForDocument(document, collection) {
  if (!getConfig().get("enableDiagnostics") || !isDiagnosticLanguage(document)) {
    collection.delete(document.uri);
    return;
  }

  const diagnostics = [];
  const text = document.getText();
  const fileName = path.basename(document.uri.fsPath);

  if (fileName === "patches.txt") {
    collectPatchDiagnostics(text, diagnostics);
  }
  if (["python", "javascript", "typescript"].includes(document.languageId)) {
    collectTranslationDiagnostics(document, text, diagnostics);
    collectFieldDiagnostics(document, text, diagnostics);
  }
  if (fileName === "hooks.py") {
    collectHookDiagnostics(text, diagnostics);
  }

  collection.set(document.uri, diagnostics);
}

function collectPatchDiagnostics(text, diagnostics) {
  const seen = new Map();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      return;
    }

    const patch = line.split("#")[0].trim();
    const start = raw.indexOf(patch);
    const range = new vscode.Range(index, start, index, start + patch.length);
    if (seen.has(patch)) {
      diagnostics.push(new vscode.Diagnostic(range, `Duplicate patch entry. First seen on line ${seen.get(patch) + 1}.`, vscode.DiagnosticSeverity.Warning));
    }
    seen.set(patch, index);

    if (!state.patchPaths.has(patch) && !state.patchPaths.has(`${patch}.execute`)) {
      diagnostics.push(new vscode.Diagnostic(range, "Patch path does not resolve to an indexed Python patch file.", vscode.DiagnosticSeverity.Error));
    }
  });
}

function collectTranslationDiagnostics(document, text, diagnostics) {
  // These checks intentionally catch the most common i18n footguns without
  // pretending to be a full Python or JavaScript parser.
  if (document.languageId === "python") {
    if (/\b_\s*\(/.test(text) && !/(?:from\s+frappe\s+import\s+_|_\s*=\s*frappe\._)/.test(text)) {
      diagnostics.push(new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), "`_()` is used but `_` is not imported from frappe.", vscode.DiagnosticSeverity.Warning));
    }
    addRegexDiagnostics(text, /_\(\s*f["'][^"']*["']\s*\)/g, diagnostics, "Avoid f-strings inside translation calls. Translate the template, then interpolate values.", vscode.DiagnosticSeverity.Warning);
    addRegexDiagnostics(text, /_\(\s*["'][^"']*["']\s*\+/g, diagnostics, "Avoid string concatenation inside translation calls.", vscode.DiagnosticSeverity.Warning);
    addRegexDiagnostics(text, /\bfrappe\.(?:throw|msgprint|confirm)\(\s*["'][^"']+["']/g, diagnostics, "User-facing Frappe messages should usually be wrapped in `_()`.", vscode.DiagnosticSeverity.Information);
  } else {
    addRegexDiagnostics(text, /__\(\s*`[^`]*\$\{/g, diagnostics, "Avoid template interpolation inside translation calls. Translate the template, then interpolate values.", vscode.DiagnosticSeverity.Warning);
    addRegexDiagnostics(text, /\bfrappe\.(?:throw|msgprint|confirm)\(\s*["'][^"']+["']/g, diagnostics, "User-facing Frappe messages should usually be wrapped in `__()`.", vscode.DiagnosticSeverity.Information);
  }
}

function collectFieldDiagnostics(document, text, diagnostics) {
  const doctypeName = inferDoctypeForDocument(state, document);
  const doctype = state.doctypes.get(doctypeName);
  if (!doctype) {
    return;
  }

  const validFields = new Set(doctype.fields.map((field) => field.fieldname));
  const re = document.languageId === "python" ? /\bself\.([A-Za-z_][A-Za-z0-9_]*)/g : /\bfrm\.doc\.([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const match of text.matchAll(re)) {
    const fieldname = match[1];
    if (!validFields.has(fieldname) && !STANDARD_DOC_FIELDS.has(fieldname)) {
      const fieldStart = match.index + match[0].lastIndexOf(fieldname);
      diagnostics.push(new vscode.Diagnostic(rangeFromIndex(text, fieldStart, fieldname.length), `Field "${fieldname}" is not defined on ${doctype.name}.`, vscode.DiagnosticSeverity.Warning));
    }
  }
}

function collectHookDiagnostics(text, diagnostics) {
  for (const match of text.matchAll(/["']([A-Za-z_][A-Za-z0-9_.]*\.[A-Za-z_][A-Za-z0-9_]*)["']/g)) {
    const dotted = match[1];
    if (dotted.split(".").length > 2 && !state.methodPaths.has(dotted)) {
      diagnostics.push(new vscode.Diagnostic(rangeFromIndex(text, match.index + 1, dotted.length), "Dotted method does not resolve to an indexed Python function.", vscode.DiagnosticSeverity.Warning));
    }
  }
}

function addRegexDiagnostics(text, re, diagnostics, message, severity) {
  for (const match of text.matchAll(re)) {
    diagnostics.push(new vscode.Diagnostic(rangeFromIndex(text, match.index, match[0].length), message, severity));
  }
}

function rangeFromIndex(text, index, length) {
  const before = text.slice(0, index).split(/\r?\n/);
  const line = before.length - 1;
  const character = before[before.length - 1].length;
  return new vscode.Range(line, character, line, character + length);
}

function isDiagnosticLanguage(document) {
  return ["python", "javascript", "typescript"].includes(document.languageId) || ["patches.txt", "hooks.py"].includes(path.basename(document.uri.fsPath));
}

function treeItem(label, collapsibleState, description) {
  const item = new vscode.TreeItem(label, collapsibleState);
  item.description = description;
  item.tooltip = description;
  return item;
}

function walk(root, predicate, out = []) {
  if (!dirExists(root)) {
    return out;
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if ([".git", "node_modules", ".venv", "__pycache__", "env"].includes(entry.name)) {
      continue;
    }
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, predicate, out);
    } else if (predicate(fullPath)) {
      out.push(fullPath);
    }
  }
  return out;
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function dirExists(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function normalizePath(filePath) {
  return path.normalize(filePath);
}

function titleFromFolder(folder) {
  return folder
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function appNameFromBenchRelPath(rel) {
  const parts = rel.split(path.sep);
  return parts[0] === "apps" ? parts[1] : "";
}

function moduleFromBenchRelPath(rel) {
  return rel.replace(/\\/g, "/").replace(/^apps\/[^/]+\//, "").replace(/\.py$/, "").split("/").join(".");
}

function log(message) {
  if (output) {
    output.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
  }
}

module.exports = {
  activate,
  deactivate
};

"use strict";

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { PY_IDENTIFIER_RE } = require("./constants");
const { inferDoctypeForDocument } = require("./inference");
const {
  appNameFromBenchRelPath,
  fileExists,
  getConfig,
  locationAtSymbol,
  moduleFromBenchRelPath,
  readFile,
  shellQuote
} = require("./utils");

function registerCommands(context, frappeState, explorer, diagnostics, refreshDiagnostics) {
  const register = (name, handler) => context.subscriptions.push(vscode.commands.registerCommand(`frappe-intelli.${name}`, handler));

  register("reloadIndex", async () => {
    await frappeState.reload(true);
    explorer.refresh();
    refreshDiagnostics(diagnostics);
  });
  register("selectSite", async () => {
    await selectSite(frappeState);
    explorer.refresh();
  });
  register("openBenchConsole", () => runBenchCommand(frappeState, "console"));
  register("runMigrate", () => runBenchCommand(frappeState, "migrate"));
  register("clearCache", () => runBenchCommand(frappeState, "clear-cache"));
  register("restartBench", () => runBenchCommand(frappeState, "restart", { noSite: true }));
  register("buildAssets", () => runBenchCommand(frappeState, "build", { noSite: true }));
  register("watchAssets", () => runBenchCommand(frappeState, "watch", { noSite: true }));
  register("runCurrentTest", () => runCurrentTest(frappeState));
  register("openDoctypeJson", () => openCurrentDoctypeAsset(frappeState, "json"));
  register("openController", () => openCurrentDoctypeAsset(frappeState, "controller"));
  register("createPatch", () => createPatch(frappeState));
  register("showIndexStatus", () => showIndexStatus(frappeState));
  register("openPathAtSymbol", (filePath, symbolName) => openPathAtSymbol(filePath, symbolName));
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
    `Reports: ${frappeState.reports.size}`,
    `Methods: ${frappeState.methodPaths.size}`,
    `Patch paths: ${frappeState.patchPaths.size}`,
    `Last reload: ${frappeState.lastReload ? new Date(frappeState.lastReload).toLocaleString() : "never"}`
  ];
  vscode.window.showInformationMessage(lines.join(" | "));
  frappeState.log(lines.join("\n"));
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

async function openPathAtSymbol(filePath, symbolName) {
  const location = locationAtSymbol(filePath, symbolName);
  await vscode.window.showTextDocument(location.uri, { selection: location.range });
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

module.exports = {
  registerCommands
};

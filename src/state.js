"use strict";

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { DOCTYPE_JSON_RE, REPORT_JSON_RE } = require("./constants");
const {
  dirExists,
  fileExists,
  getConfig,
  normalizePath,
  readFile,
  titleFromFolder,
  walk
} = require("./utils");

class FrappeState {
  constructor(logger) {
    this.logger = logger;
    this.clear();
  }

  async reload(showMessage) {
    const benchPath = findBenchPath();
    if (!benchPath) {
      this.clear();
      this.log("No bench detected. Set frappeIntelli.benchPath or open a Frappe bench folder.");
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
    this.log(`Indexed bench: ${this.benchPath}`);
    this.log(`Apps: ${this.apps.map((app) => app.name).join(", ") || "none"}`);
    this.log(`Sites: ${this.sites.join(", ") || "none"}`);
    this.log(`DocTypes: ${this.doctypes.size}; reports: ${this.reports.size}; methods: ${this.methodPaths.size}; patches: ${this.patchPaths.size}`);
    await vscode.commands.executeCommand("setContext", "frappe-intelli.hasBench", true);

    if (showMessage) {
      vscode.window.showInformationMessage(
        `Frappe Intelli indexed ${this.doctypes.size} DocTypes, ${this.reports.size} reports, ${this.methodPaths.size} methods, and ${this.patchPaths.size} patch entries.`
      );
    }
  }

  clear() {
    this.benchPath = "";
    this.apps = [];
    this.sites = [];
    this.defaultSite = "";
    this.doctypes = new Map();
    this.reports = new Map();
    this.doctypeByPath = new Map();
    this.methodPaths = new Map();
    this.patchPaths = new Map();
    this.hookFiles = [];
    this.lastReload = 0;
  }

  log(message) {
    if (this.logger) {
      this.logger(message);
    }
  }
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

  const currentSite = readFile(path.join(benchPath, "sites", "currentsite.txt")).trim();
  return sites.includes(currentSite) ? currentSite : sites[0] || "";
}

function indexApp(frappeState, app) {
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

  for (const jsonPath of walk(app.path, (file) => REPORT_JSON_RE.test(file))) {
    const report = parseReportJson(app.name, jsonPath);
    if (report) {
      frappeState.reports.set(report.name, report);
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

function parseReportJson(appName, jsonPath) {
  try {
    const data = JSON.parse(readFile(jsonPath));
    const name = data.report_name || data.name || titleFromFolder(path.basename(path.dirname(jsonPath)));
    const reportDir = path.dirname(jsonPath);
    const folderName = path.basename(reportDir);
    const pythonPath = path.join(reportDir, `${folderName}.py`);
    const javascriptPath = path.join(reportDir, `${folderName}.js`);

    return {
      name,
      app: appName,
      jsonPath,
      pythonPath: fileExists(pythonPath) ? pythonPath : "",
      javascriptPath: fileExists(javascriptPath) ? javascriptPath : "",
      reportType: data.report_type || ""
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

  const text = readFile(pyFile);
  const whitelistedOnly = getConfig().get("indexWhitelistedMethodsOnly");
  for (const match of text.matchAll(/((?:^[ \t]*@.*\n)*)^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)) {
    if (whitelistedOnly && !/@\s*frappe\.whitelist\s*\(/.test(match[1])) {
      continue;
    }
    frappeState.methodPaths.set(`${dottedBase}.${match[2]}`, pyFile);
  }
}

function fileToDotted(app, filePath) {
  const rel = path.relative(app.path, filePath).replace(/\\/g, "/");
  if (!rel.endsWith(".py")) {
    return "";
  }
  return rel.slice(0, -3).split("/").join(".");
}

module.exports = {
  FrappeState
};

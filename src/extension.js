"use strict";

const vscode = require("vscode");
const { FrappeState } = require("./state");
const { registerCommands } = require("./commands");
const { refreshDiagnostics, updateDiagnosticsForDocument } = require("./diagnostics");
const { FrappeCompletionProvider } = require("./providers/completion");
const { FrappeDefinitionProvider } = require("./providers/definition");
const { FrappeHoverProvider } = require("./providers/hover");
const { FrappeCodeLensProvider } = require("./providers/codelens");
const { BenchExplorerProvider } = require("./providers/explorer");

let state;
let reloadTimer;
let output;

function activate(context) {
  output = vscode.window.createOutputChannel("Frappe Intelli");
  state = new FrappeState(log);

  const diagnostics = vscode.languages.createDiagnosticCollection("frappe-intelli");
  const explorer = new BenchExplorerProvider(state);

  context.subscriptions.push(
    output,
    diagnostics,
    vscode.window.registerTreeDataProvider("frappe-intelli.benchExplorer", explorer),
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
    vscode.languages.registerHoverProvider(["python", "javascript", "typescript", "json"], new FrappeHoverProvider(state)),
    vscode.languages.registerCodeLensProvider(
      ["python", "javascript", "typescript", { pattern: "**/patches.txt" }],
      new FrappeCodeLensProvider(state)
    )
  );

  registerCommands(context, state, explorer, diagnostics, (collection) => refreshDiagnostics(state, collection));
  registerWatchers(context, state, explorer, diagnostics);

  state.reload(false).then(() => {
    explorer.refresh();
    refreshDiagnostics(state, diagnostics);
  });
}

function deactivate() {}

function registerWatchers(context, frappeState, explorer, diagnostics) {
  const watcher = vscode.workspace.createFileSystemWatcher("**/{*.json,*.py,*.js,*.ts,patches.txt,hooks.py,apps.txt}");
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(() => scheduleReload(frappeState, explorer, diagnostics)),
    watcher.onDidChange(() => scheduleReload(frappeState, explorer, diagnostics)),
    watcher.onDidDelete(() => scheduleReload(frappeState, explorer, diagnostics)),
    vscode.workspace.onDidOpenTextDocument((document) => updateDiagnosticsForDocument(frappeState, document, diagnostics)),
    vscode.workspace.onDidChangeTextDocument((event) => updateDiagnosticsForDocument(frappeState, event.document, diagnostics)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("frappeIntelli")) {
        scheduleReload(frappeState, explorer, diagnostics, 25);
      }
    })
  );
}

function scheduleReload(frappeState, explorer, diagnostics, delay = 600) {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    await frappeState.reload(false);
    explorer.refresh();
    refreshDiagnostics(frappeState, diagnostics);
  }, delay);
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

"use strict";

const vscode = require("vscode");
const path = require("path");
const { rangeFromIndex } = require("../utils");

class FrappeCodeLensProvider {
  constructor(frappeState) {
    this.state = frappeState;
  }

  provideCodeLenses(document) {
    if (!this.state.benchPath) {
      return [];
    }

    const lenses = [];
    const text = document.getText();
    const fileName = path.basename(document.uri.fsPath);

    if (fileName === "patches.txt") {
      return patchCodeLenses(this.state, text);
    }

    if (["javascript", "typescript"].includes(document.languageId)) {
      lenses.push(...reportCodeLenses(this.state, text));
      lenses.push(...formCodeLenses(this.state, text));
    }

    return lenses;
  }
}

function patchCodeLenses(frappeState, text) {
  const lenses = [];
  text.split(/\r?\n/).forEach((raw, line) => {
    const patch = raw.trim().split("#")[0].trim();
    const patchPath = frappeState.patchPaths.get(patch) || frappeState.patchPaths.get(`${patch}.execute`);
    if (!patch || !patchPath) {
      return;
    }
    lenses.push(
      new vscode.CodeLens(new vscode.Range(line, 0, line, raw.length), {
        title: "Open patch execute()",
        command: "frappe-intelli.openPathAtSymbol",
        arguments: [patchPath, "execute"]
      })
    );
  });
  return lenses;
}

function reportCodeLenses(frappeState, text) {
  const lenses = [];
  for (const match of text.matchAll(/frappe\.query_reports\s*\[\s*["']([^"']+)["']\s*\]/g)) {
    const report = frappeState.reports.get(match[1]);
    if (!report) {
      continue;
    }
    const range = rangeFromIndex(text, match.index, match[0].length);
    lenses.push(new vscode.CodeLens(range, {
      title: "Open report JSON",
      command: "vscode.open",
      arguments: [vscode.Uri.file(report.jsonPath)]
    }));
    if (report.pythonPath) {
      lenses.push(new vscode.CodeLens(range, {
        title: "Open report Python",
        command: "vscode.open",
        arguments: [vscode.Uri.file(report.pythonPath)]
      }));
    }
  }
  return lenses;
}

function formCodeLenses(frappeState, text) {
  const lenses = [];
  for (const match of text.matchAll(/frappe\.ui\.form\.on\(\s*["']([^"']+)["']/g)) {
    const doctype = frappeState.doctypes.get(match[1]);
    if (!doctype) {
      continue;
    }
    const range = rangeFromIndex(text, match.index, match[0].length);
    lenses.push(new vscode.CodeLens(range, {
      title: "Open DocType JSON",
      command: "vscode.open",
      arguments: [vscode.Uri.file(doctype.jsonPath)]
    }));
    if (doctype.controllerPath) {
      lenses.push(new vscode.CodeLens(range, {
        title: "Open controller",
        command: "vscode.open",
        arguments: [vscode.Uri.file(doctype.controllerPath)]
      }));
    }
  }
  return lenses;
}

module.exports = {
  FrappeCodeLensProvider
};

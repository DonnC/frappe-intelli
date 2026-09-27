"use strict";

const vscode = require("vscode");
const path = require("path");
const { getQuotedStringAt, locationAtSymbol } = require("../utils");

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

    const report = this.state.reports.get(value);
    if (report) {
      return new vscode.Location(vscode.Uri.file(report.jsonPath), new vscode.Position(0, 0));
    }

    const methodPath = this.state.methodPaths.get(value);
    if (methodPath) {
      return locationAtSymbol(methodPath, value.split(".").pop());
    }

    return undefined;
  }
}

module.exports = {
  FrappeDefinitionProvider
};

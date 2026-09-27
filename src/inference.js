"use strict";

const vscode = require("vscode");
const path = require("path");
const { normalizePath } = require("./utils");

function inferDoctypeForDocument(frappeState, document) {
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

module.exports = {
  inferDoctypeForDocument,
  inferDoctypeFromFormScript,
  inferDoctypeFromNearbyCall
};

"use strict";

const vscode = require("vscode");
const path = require("path");
const { STANDARD_DOC_FIELDS } = require("./constants");
const { inferDoctypeForDocument } = require("./inference");
const { getConfig, rangeFromIndex } = require("./utils");

const HOOK_METHOD_KEYS = [
  "doc_events",
  "scheduler_events",
  "override_whitelisted_methods",
  "permission_query_conditions",
  "has_permission",
  "auth_hooks",
  "before_request",
  "after_request",
  "before_tests",
  "after_migrate"
];

function refreshDiagnostics(frappeState, collection) {
  if (!getConfig().get("enableDiagnostics")) {
    collection.clear();
    return;
  }

  for (const document of vscode.workspace.textDocuments) {
    updateDiagnosticsForDocument(frappeState, document, collection);
  }
}

function updateDiagnosticsForDocument(frappeState, document, collection) {
  if (!getConfig().get("enableDiagnostics") || !isDiagnosticLanguage(document)) {
    collection.delete(document.uri);
    return;
  }

  const diagnostics = [];
  const text = document.getText();
  const fileName = path.basename(document.uri.fsPath);

  if (fileName === "patches.txt") {
    collectPatchDiagnostics(frappeState, text, diagnostics);
  }
  if (["python", "javascript", "typescript"].includes(document.languageId)) {
    collectTranslationDiagnostics(document, text, diagnostics);
    collectFieldDiagnostics(frappeState, document, text, diagnostics);
  }
  if (fileName === "hooks.py") {
    collectHookDiagnostics(frappeState, text, diagnostics);
    collectFixtureDiagnostics(frappeState, text, diagnostics);
  }

  collection.set(document.uri, diagnostics);
}

function collectPatchDiagnostics(frappeState, text, diagnostics) {
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

    if (!frappeState.patchPaths.has(patch) && !frappeState.patchPaths.has(`${patch}.execute`)) {
      diagnostics.push(new vscode.Diagnostic(range, "Patch path does not resolve to an indexed Python patch file.", vscode.DiagnosticSeverity.Error));
    }
  });
}

function collectTranslationDiagnostics(document, text, diagnostics) {
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

function collectFieldDiagnostics(frappeState, document, text, diagnostics) {
  const doctypeName = inferDoctypeForDocument(frappeState, document);
  const doctype = frappeState.doctypes.get(doctypeName);
  if (!doctype) {
    return;
  }

  const validFields = new Set(doctype.fields.map((field) => field.fieldname));
  const re = document.languageId === "python" ? /\bself\.([A-Za-z_][A-Za-z0-9_]*)/g : /\bfrm\.doc\.([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const match of text.matchAll(re)) {
    reportUnknownField(text, match, match[1], validFields, doctype.name, diagnostics);
  }

  const stringFieldRe = document.languageId === "python"
    ? /\bself\.(?:get|set|db_set)\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g
    : /\bfrm\.(?:set_value|get_field|refresh_field|toggle_display|toggle_enable|set_df_property)\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g;

  for (const match of text.matchAll(stringFieldRe)) {
    reportUnknownField(text, match, match[1], validFields, doctype.name, diagnostics);
  }
}

function reportUnknownField(text, match, fieldname, validFields, doctypeName, diagnostics) {
  if (validFields.has(fieldname) || STANDARD_DOC_FIELDS.has(fieldname)) {
    return;
  }
  const fieldStart = match.index + match[0].lastIndexOf(fieldname);
  diagnostics.push(new vscode.Diagnostic(rangeFromIndex(text, fieldStart, fieldname.length), `Field "${fieldname}" is not defined on ${doctypeName}.`, vscode.DiagnosticSeverity.Warning));
}

function collectHookDiagnostics(frappeState, text, diagnostics) {
  for (const block of findHookBlocks(text)) {
    for (const match of block.text.matchAll(/["']([A-Za-z_][A-Za-z0-9_.]*\.[A-Za-z_][A-Za-z0-9_]*)["']/g)) {
      const dotted = match[1];
      if (dotted.split(".").length > 2 && !frappeState.methodPaths.has(dotted)) {
        diagnostics.push(new vscode.Diagnostic(rangeFromIndex(text, block.start + match.index + 1, dotted.length), "Dotted hook method does not resolve to an indexed Python function.", vscode.DiagnosticSeverity.Warning));
      }
    }
  }
}

function findHookBlocks(text) {
  const blocks = [];
  for (const key of HOOK_METHOD_KEYS) {
    const re = new RegExp(`(^${key}\\s*=\\s*)([\\s\\S]*?)(?=\\n[A-Za-z_][A-Za-z0-9_]*\\s*=|\\n#\\s*[-=]{3,}|\\s*$)`, "gm");
    for (const match of text.matchAll(re)) {
      blocks.push({ start: match.index, text: match[0] });
    }
  }
  return blocks;
}

function collectFixtureDiagnostics(frappeState, text, diagnostics) {
  const fixtureBlock = text.match(/fixtures\s*=\s*\[([\s\S]*?)\n\]/m);
  if (!fixtureBlock) {
    return;
  }

  const blockStart = fixtureBlock.index;
  for (const match of fixtureBlock[0].matchAll(/["'](?:dt|doctype)["']\s*:\s*["']([^"']+)["']/g)) {
    addUnknownFixtureDoctypeDiagnostic(frappeState, text, blockStart + match.index + match[0].lastIndexOf(match[1]), match[1], diagnostics);
  }

  for (const match of fixtureBlock[0].matchAll(/^[ \t]*["']([^"']+)["'][ \t,]*$/gm)) {
    addUnknownFixtureDoctypeDiagnostic(frappeState, text, blockStart + match.index + match[0].indexOf(match[1]), match[1], diagnostics);
  }
}

function addUnknownFixtureDoctypeDiagnostic(frappeState, text, index, doctypeName, diagnostics) {
  if (!frappeState.doctypes.has(doctypeName)) {
    diagnostics.push(new vscode.Diagnostic(rangeFromIndex(text, index, doctypeName.length), `Fixture DocType "${doctypeName}" was not found in the bench index.`, vscode.DiagnosticSeverity.Warning));
  }
}

function addRegexDiagnostics(text, re, diagnostics, message, severity) {
  for (const match of text.matchAll(re)) {
    diagnostics.push(new vscode.Diagnostic(rangeFromIndex(text, match.index, match[0].length), message, severity));
  }
}

function isDiagnosticLanguage(document) {
  return ["python", "javascript", "typescript"].includes(document.languageId) || ["patches.txt", "hooks.py"].includes(path.basename(document.uri.fsPath));
}

module.exports = {
  refreshDiagnostics,
  updateDiagnosticsForDocument
};

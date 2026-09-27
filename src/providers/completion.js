"use strict";

const vscode = require("vscode");
const {
  inferDoctypeForDocument,
  inferDoctypeFromFormScript,
  inferDoctypeFromNearbyCall
} = require("../inference");

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
      const frmDoctype = inferDoctypeFromFormScript(document, position) || currentDoctype;
      if (/\bfrappe\.\w*$/.test(line)) {
        return frappeJsApiCompletions();
      }
      if (/\bfrappe\.db\.\w*$/.test(line)) {
        return frappeDbApiCompletions();
      }
      if (/\bfrm\.\w*$/.test(line)) {
        return frappeFrmApiCompletions();
      }
      if (/\b(?:frm\.doc|doc|row)\.\w*$/.test(line) || /\blocals\s*\[\s*cdt\s*\]\s*\[\s*cdn\s*\]\.\w*$/.test(line)) {
        return fieldCompletions(this.state, frmDoctype);
      }
      if (looksLikeJsDoctypeStringContext(line)) {
        return doctypeCompletions(this.state);
      }
      if (looksLikeJsReportStringContext(line)) {
        return reportCompletions(this.state);
      }
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

function reportCompletions(frappeState) {
  return Array.from(frappeState.reports.values()).map((report) => {
    const item = new vscode.CompletionItem(report.name, vscode.CompletionItemKind.File);
    item.detail = `Report - ${report.app}`;
    item.documentation = new vscode.MarkdownString(`Type: \`${report.reportType || "Report"}\`\n\nJSON: \`${report.jsonPath}\``);
    item.insertText = report.name;
    return item;
  });
}

function frappeApiCompletions() {
  return makeMethodItems([
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
  ], "Frappe API");
}

function frappeJsApiCompletions() {
  return makeMethodItems([
    ["call", "Call a whitelisted method."],
    ["db", "Client-side database helpers."],
    ["ui", "Frappe UI namespace."],
    ["model", "Client-side model helpers."],
    ["route_options", "Set route filters before navigation."],
    ["set_route", "Navigate to a route."],
    ["msgprint", "Show a translated message."],
    ["throw", "Throw a client-side Frappe error."],
    ["confirm", "Show a confirmation dialog."]
  ], "Frappe JS API");
}

function frappeDbApiCompletions() {
  return makeMethodItems([
    ["get_value", "Read one field value."],
    ["get_single_value", "Read a Single DocType field value."],
    ["set_value", "Update a field value."],
    ["exists", "Check whether a document exists."],
    ["count", "Count matching documents."],
    ["get_list", "Fetch a list of documents."]
  ], "Frappe DB API");
}

function frappeFrmApiCompletions() {
  return makeMethodItems([
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
  ], "Frappe Form API");
}

function makeMethodItems(items, detail) {
  return items.map(([label, documentation]) => {
    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Method);
    item.detail = detail;
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

function looksLikeJsReportStringContext(line) {
  return /\bfrappe\.query_reports\s*\[\s*["'][^"']*$/.test(line);
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

module.exports = {
  FrappeCompletionProvider
};

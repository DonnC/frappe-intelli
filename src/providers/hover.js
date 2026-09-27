"use strict";

const vscode = require("vscode");
const { getQuotedStringAt } = require("../utils");

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

    const report = this.state.reports.get(value);
    if (report) {
      const markdown = new vscode.MarkdownString();
      markdown.appendMarkdown(`**${report.name}**\n\n`);
      markdown.appendMarkdown(`App: \`${report.app}\`\n\n`);
      markdown.appendMarkdown(`Type: \`${report.reportType || "Report"}\``);
      return new vscode.Hover(markdown);
    }

    const methodPath = this.state.methodPaths.get(value);
    if (methodPath) {
      return new vscode.Hover(new vscode.MarkdownString(`Frappe method\n\n\`${methodPath}\``));
    }

    return undefined;
  }
}

module.exports = {
  FrappeHoverProvider
};

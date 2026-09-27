"use strict";

const vscode = require("vscode");
const path = require("path");
const { treeItem } = require("../utils");

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
        treeItem("Reports", vscode.TreeItemCollapsibleState.Collapsed, `${this.state.reports.size} report(s)`),
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

    if (item.label === "Reports") {
      return Array.from(this.state.reports.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 500)
        .map((report) => {
          const node = treeItem(report.name, vscode.TreeItemCollapsibleState.None, `${report.app} - ${report.reportType || "Report"}`);
          node.command = { command: "vscode.open", title: "Open Report JSON", arguments: [vscode.Uri.file(report.jsonPath)] };
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

module.exports = {
  BenchExplorerProvider
};

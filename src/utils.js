"use strict";

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

function getConfig() {
  return vscode.workspace.getConfiguration("frappeIntelli");
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function dirExists(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function walk(root, predicate, out = []) {
  if (!dirExists(root)) {
    return out;
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if ([".git", "node_modules", ".venv", "__pycache__", "env"].includes(entry.name)) {
      continue;
    }
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, predicate, out);
    } else if (predicate(fullPath)) {
      out.push(fullPath);
    }
  }
  return out;
}

function normalizePath(filePath) {
  return path.normalize(filePath);
}

function titleFromFolder(folder) {
  return folder
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function appNameFromBenchRelPath(rel) {
  const parts = rel.split(path.sep);
  return parts[0] === "apps" ? parts[1] : "";
}

function moduleFromBenchRelPath(rel) {
  return rel.replace(/\\/g, "/").replace(/^apps\/[^/]+\//, "").replace(/\.py$/, "").split("/").join(".");
}

function rangeFromIndex(text, index, length) {
  const before = text.slice(0, index).split(/\r?\n/);
  const line = before.length - 1;
  const character = before[before.length - 1].length;
  return new vscode.Range(line, character, line, character + length);
}

function treeItem(label, collapsibleState, description) {
  const item = new vscode.TreeItem(label, collapsibleState);
  item.description = description;
  item.tooltip = description;
  return item;
}

function getQuotedStringAt(document, position) {
  const line = document.lineAt(position.line).text;
  const index = position.character;
  const quotePositions = [line.lastIndexOf("\"", index), line.lastIndexOf("'", index)].filter((value) => value >= 0);
  if (!quotePositions.length) {
    return "";
  }

  const leftQuote = Math.max(...quotePositions);
  const quote = line[leftQuote];
  const rightQuote = line.indexOf(quote, leftQuote + 1);
  if (rightQuote < index) {
    return "";
  }
  return line.slice(leftQuote + 1, rightQuote);
}

function locationAtSymbol(filePath, symbolName) {
  const text = readFile(filePath);
  const re = new RegExp(`^(?:def|class)\\s+${escapeRegex(symbolName)}\\b`, "m");
  const match = text.match(re);
  if (!match) {
    return new vscode.Location(vscode.Uri.file(filePath), new vscode.Position(0, 0));
  }

  const line = text.slice(0, match.index).split(/\r?\n/).length - 1;
  return new vscode.Location(vscode.Uri.file(filePath), new vscode.Position(line, 0));
}

module.exports = {
  appNameFromBenchRelPath,
  dirExists,
  fileExists,
  getConfig,
  getQuotedStringAt,
  locationAtSymbol,
  moduleFromBenchRelPath,
  normalizePath,
  rangeFromIndex,
  readFile,
  shellQuote,
  titleFromFolder,
  treeItem,
  walk
};

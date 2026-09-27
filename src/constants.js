"use strict";

const DOCTYPE_JSON_RE = /[/\\]doctype[/\\]([^/\\]+)[/\\]\1\.json$/;
const REPORT_JSON_RE = /[/\\]report[/\\]([^/\\]+)[/\\]\1\.json$/;
const PY_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const STANDARD_DOC_FIELDS = new Set(["doctype", "name", "owner", "creation", "modified", "modified_by", "docstatus", "idx"]);

module.exports = {
  DOCTYPE_JSON_RE,
  REPORT_JSON_RE,
  PY_IDENTIFIER_RE,
  STANDARD_DOC_FIELDS
};

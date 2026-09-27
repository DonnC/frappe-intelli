# Changelog

## 0.2.0

Architecture and intelligence pass.

- Split the extension runtime into focused modules for activation, state/indexing, commands, diagnostics, inference, utilities, and VS Code providers.
- Reduced `src/extension.js` to a small activation/orchestration entry point.
- Added modular linting across every source file.
- Added `.vscodeignore` so packaged builds exclude dev-only files.
- Added startup activation and index-status output.
- Added optional whitelisted-only dotted method indexing.
- Added CodeLens actions for `patches.txt`, form scripts, and query reports.
- Added report indexing, report completions, hover support, and report navigation.
- Added fixture diagnostics for common `hooks.py` fixture shapes.
- Added string-based field diagnostics for common Python and JavaScript field APIs.
- Improved child table field inference for nearby `frappe.ui.form.on("Child DocType")` handlers.
- Narrowed hook diagnostics to likely hook method blocks to reduce false positives.
- Removed machine-specific paths from documentation and debug configuration.

## 0.1.0

Initial local-first release.

- Added bench discovery from workspace folders.
- Added installed app discovery from `sites/apps.txt`.
- Added site discovery from `sites/*/site_config.json`.
- Added DocType indexing from installed app JSON files.
- Added Python DocType completions.
- Added JavaScript and TypeScript DocType completions.
- Added Python `self.`, `doc.`, and `row.` field completions in inferred DocType files.
- Added JavaScript `frm.doc.`, `doc.`, and `row.` field completions in inferred form files.
- Added field completions in common `frm.*` calls.
- Added dotted Python method indexing.
- Added Go to Definition for DocType strings.
- Added Go to Definition for dotted method strings.
- Added Go to Definition for patch entries in `patches.txt`.
- Added translation diagnostics for Python and JavaScript.
- Added patch diagnostics for missing and duplicate patches.
- Added field diagnostics for common document access patterns.
- Added hook diagnostics for unresolved dotted methods.
- Added bench command palette commands.
- Added Bench Explorer activity bar view.
- Added Python, JavaScript, and JSON snippets.

# Frappe Intelli

Frappe Intelli is a local-first VS Code extension for Frappe and ERPNext development. It indexes the bench already on your machine and turns your installed apps into completions, source navigation, snippets, diagnostics, and bench commands.

The extension is designed for Frappe/ERPNext v16+ projects, but most features work with older benches that use the same app and DocType file layout.

## Why This Exists

Generic Python and JavaScript IntelliSense does not understand that `"Sales Invoice"` is a DocType, that `self.customer` is a field from `sales_invoice.json`, or that a line in `patches.txt` should jump to a Python `execute()` function.

Frappe Intelli fills that gap by reading your bench:

- `sites/apps.txt`
- `sites/*/site_config.json`
- `apps/*/**/doctype/*/*.json`
- `apps/*/**/*.py`
- `apps/*/**/patches/**/*.py`
- `hooks.py`
- `patches.txt`

No cloud service is required. Your local code is the source of truth.

## Features

### Bench Discovery

Frappe Intelli auto-detects a bench by walking upward from the open VS Code workspace and looking for:

- `sites/apps.txt`
- `apps/`

You can also set the bench path manually:

```json
{
  "frappeIntelli.benchPath": "/path/to/frappe-bench"
}
```

### DocType Autocompletion

DocType names are suggested in common Python and JavaScript Frappe APIs.

Python examples:

```python
frappe.get_doc("Sales Invoice", name)
frappe.new_doc("Customer")
frappe.get_all("Item")
frappe.db.get_value("Sales Order", name, "customer")
frappe.db.exists("User", user)
```

JavaScript examples:

```javascript
frappe.ui.form.on("Sales Invoice", {
  refresh(frm) {}
});

frappe.model.with_doc("Item", item_code, () => {});
frappe.db.get_value("Customer", customer, "customer_name");
```

### Document Field Autocompletion

In DocType controller files, fields are suggested after:

```python
self.
doc.
row.
```

The extension infers the DocType from the controller path:

```text
apps/erpnext/erpnext/accounts/doctype/sales_invoice/sales_invoice.py
```

Then it loads fields from:

```text
apps/erpnext/erpnext/accounts/doctype/sales_invoice/sales_invoice.json
```

In client scripts, fields are suggested after:

```javascript
frm.doc.
doc.
row.
```

It also suggests field names inside common form calls:

```javascript
frm.set_value("customer", value);
frm.get_field("items");
frm.toggle_display("taxes", true);
frm.set_df_property("customer", "read_only", 1);
frm.refresh_field("items");
```

### Dotted Method Autocompletion

Python functions from installed apps are indexed as dotted paths. This helps when writing:

```python
method = "my_app.api.create_invoice"
```

```javascript
frappe.call({
  method: "my_app.api.create_invoice"
});
```

### Jump To Source

Use VS Code's normal **Go to Definition** command.

Supported targets:

- DocType string -> DocType JSON
- Report string -> report JSON
- Dotted method string -> Python source function
- `patches.txt` entry -> patch file and `execute()`

Example:

```text
erpnext.patches.v16_0.update_some_data
```

Go to Definition opens:

```text
apps/erpnext/erpnext/patches/v16_0/update_some_data.py
```

and jumps to:

```python
def execute():
```

### CodeLens

Frappe Intelli adds inline actions above common Frappe entry points:

- `patches.txt` entries get **Open patch execute()**
- `frappe.ui.form.on("DocType")` blocks get **Open DocType JSON**
- form scripts get **Open controller** when a Python controller exists
- `frappe.query_reports["Report"]` entries get **Open report JSON**
- script reports get **Open report Python** when a Python report file exists

### Translation Diagnostics

Frappe Intelli catches common translation issues.

Python diagnostics:

- `_()` used without importing `_`
- f-strings inside `_()`
- string concatenation inside `_()`
- likely user-facing `frappe.throw`, `frappe.msgprint`, or `frappe.confirm` messages not wrapped in `_()`

JavaScript diagnostics:

- template interpolation inside `__()`
- likely user-facing `frappe.throw`, `frappe.msgprint`, or `frappe.confirm` messages not wrapped in `__()`

### Patch Diagnostics

In `patches.txt`, the extension reports:

- duplicate patch entries
- patch paths that do not resolve to an indexed Python file

### Field Diagnostics

Inside inferred DocType controller and form files, the extension warns when:

- `self.some_field` is not present in the DocType JSON
- `frm.doc.some_field` is not present in the DocType JSON
- `self.get("some_field")` references an unknown field
- `frm.set_value("some_field")` and related form calls reference unknown fields

Standard Frappe document fields such as `name`, `doctype`, `owner`, `creation`, `modified`, `docstatus`, and `idx` are allowed.

### Hooks Diagnostics

In `hooks.py`, dotted method strings are checked against indexed Python functions.

This helps catch broken paths in:

- `doc_events`
- `scheduler_events`
- `override_whitelisted_methods`
- `permission_query_conditions`
- `has_permission`

### Fixture Diagnostics

In `hooks.py`, fixtures are checked against indexed DocTypes.

Supported fixture shapes include:

```python
fixtures = [
    "Custom Field",
    {"dt": "Property Setter"},
    {"doctype": "Workspace"},
]
```

### Bench Commands

Commands are available from the VS Code Command Palette:

- `Frappe Intelli: Reload Bench Index`
- `Frappe Intelli: Select Site`
- `Frappe Intelli: Open Bench Console`
- `Frappe Intelli: Run Migrate`
- `Frappe Intelli: Clear Cache`
- `Frappe Intelli: Restart Bench`
- `Frappe Intelli: Build Assets`
- `Frappe Intelli: Watch Assets`
- `Frappe Intelli: Run Current Test`
- `Frappe Intelli: Open Current DocType JSON`
- `Frappe Intelli: Open Current Controller`
- `Frappe Intelli: Create Patch`
- `Frappe Intelli: Show Index Status`

Bench commands open a VS Code terminal in the bench root and run the matching `bench` command. Site-specific commands use the selected site.

### Bench Explorer

The Frappe activity bar view shows:

- current bench
- sites
- installed apps
- indexed DocTypes
- indexed reports
- indexed patch paths

Click a DocType or report to open its JSON file.

### Snippets

Python snippets:

- `frappe-controller`
- `frappe-whitelist`
- `frappe-whitelist-guest`
- `frappe-patch`
- `frappe-report`
- `frappe-throw`
- `frappe-enqueue`
- `frappe-get-doc`
- `frappe-db-get-value`
- `frappe-get-all`
- `frappe-permission-query`
- `frappe-has-permission`

JavaScript snippets:

- `frappe-form`
- `frappe-field`
- `frappe-child`
- `frappe-call`
- `frappe-set-query`
- `frappe-button`
- `frappe-dialog`
- `frappe-set-value`
- `frappe-listview`
- `frappe-query-report`

JSON snippets:

- `frappe-field`
- `frappe-link-field`
- `frappe-table-field`

## Local Installation

### Option 1: Run In Extension Development Host

This is the easiest way to test while developing the extension.

1. Open this folder in VS Code:

   ```bash
   code /path/to/frappe-intelli
   ```

2. Press `F5`.

3. A new VS Code window opens.

4. In that new window, open your bench:

   ```bash
   code /path/to/frappe-bench
   ```

5. Run:

   ```text
   Frappe Intelli: Reload Bench Index
   ```

### Option 2: Install As A Local VSIX

Install `vsce` packaging dependencies:

```bash
cd /path/to/frappe-intelli
npm install
```

Package the extension:

```bash
npm run package
```

Install it:

```bash
code --install-extension frappe-intelli-0.1.0.vsix
```

Reload VS Code and open your Frappe bench.

## Recommended VS Code Settings

For your bench workspace, create or update:

```text
/path/to/frappe-bench/.vscode/settings.json
```

Example:

```json
{
  "frappeIntelli.benchPath": "/path/to/frappe-bench",
  "frappeIntelli.defaultSite": "site.localhost",
  "frappeIntelli.enableDiagnostics": true,
  "frappeIntelli.indexCustomAppsOnly": false
}
```

## Troubleshooting Autocomplete

If snippets appear but DocType or field autocomplete does not, the extension host may not have indexed a bench yet.

1. In the Extension Development Host window, run:

   ```text
   Frappe Intelli: Show Index Status
   ```

2. Confirm that `Bench`, `Apps`, and `DocTypes` are populated.

3. If the bench is not detected, add this to the bench workspace settings:

   ```json
   {
     "frappeIntelli.benchPath": "/path/to/frappe-bench"
   }
   ```

4. Run:

   ```text
   Frappe Intelli: Reload Bench Index
   ```

5. Test completions in a known context:

   ```python
   import frappe

   doc = frappe.get_doc("
   ```

   Press `Ctrl+Space` after the quote. DocType names should appear.

6. Test controller field completions in a real DocType controller file:

   ```python
   self.
   ```

   Press `Ctrl+Space` after the dot. Fieldnames from the matching DocType JSON should appear.

The extension also writes indexing details to the `Frappe Intelli` output channel.

## Configuration

### `frappeIntelli.benchPath`

Absolute path to your bench. Leave empty for auto-detection.

Default:

```json
""
```

### `frappeIntelli.defaultSite`

Default site for site-aware bench commands.

Default:

```json
""
```

### `frappeIntelli.enableDiagnostics`

Enable or disable Frappe diagnostics.

Default:

```json
true
```

### `frappeIntelli.indexCustomAppsOnly`

When enabled, indexes only apps after excluding `frappe` and `erpnext`.

This is useful for very large benches or when you only want completions from your custom apps.

Default:

```json
false
```

### `frappeIntelli.indexWhitelistedMethodsOnly`

When enabled, dotted method completions only include Python functions decorated with `@frappe.whitelist()`.

Default:

```json
false
```

## Architecture

Frappe Intelli is intentionally organized as small CommonJS modules:

- `src/extension.js`: VS Code activation, provider registration, and file watchers
- `src/state.js`: bench discovery, app indexing, DocType indexing, report indexing, and method indexing
- `src/commands.js`: command palette handlers and terminal-backed bench commands
- `src/diagnostics.js`: diagnostics for patches, translations, hooks, fixtures, and field references
- `src/inference.js`: DocType inference helpers shared by providers and diagnostics
- `src/providers/*`: completion, definition, hover, CodeLens, and tree providers
- `src/utils.js`: filesystem, path, range, and VS Code helper functions

The extension currently uses plain JavaScript and Node built-ins. There is no compile step.

## Development

Check syntax:

```bash
npm run lint
```

Package:

```bash
npm run package
```

Debug:

```bash
code /path/to/ext/frappe-intelli
```

Then press `F5`.

## Current Limitations

This is an intentionally practical first release. Some inference is heuristic:

- field completions work best in normal DocType controller and form script locations
- child table inference follows nearby `frappe.ui.form.on("Child DocType")` blocks, but unusual dynamic patterns may still need manual navigation
- hook diagnostics are scoped to known hook method blocks, but unusual dynamic hook construction may still need manual review
- diagnostics do not parse Python or JavaScript ASTs yet

These tradeoffs keep the extension fast, dependency-light, and immediately usable.

## Roadmap

- AST-based Python and JavaScript parsing
- deeper child table context tracking across helper functions
- DocType creation wizard
- typed stub generation for custom apps
- dedicated Language Server Protocol backend for larger benches

## Contributing

Contributions are welcome. Keep the extension local-first, predictable, and friendly to real bench layouts.

Before opening a pull request:

1. Run `npm run lint`.
2. Test against a real bench.
3. Include a small note about the Frappe pattern being supported.

## License

MIT

# revive — Specification

> **Focus:** Precise reference for the `revive` linter — synopsis, flags, configuration file, rules, output formats, exit codes, and guarantees.
>
> **Sources:**
> - Project README: https://github.com/mgechev/revive
> - Rule catalogue: https://github.com/mgechev/revive/blob/master/RULES_DESCRIPTIONS.md
> - `revive -h`

---

## 1. Synopsis

```
revive [flags] [package patterns...]
```

`revive` loads the named Go packages in module-aware mode, runs the configured rules over their source, and writes findings via the chosen formatter. The default package pattern is the current directory; common forms are `./...`, `./cmd/...`, and explicit import paths.

---

## 2. Common flags

| Flag | Effect |
|------|--------|
| `-config FILE` | Path to a TOML config file. If omitted, a built-in default rule set is used. |
| `-formatter NAME` | Output formatter: `default`, `plain`, `friendly`, `stylish`, `ndjson`, `json`, `checkstyle`, `sarif`, `unix`. |
| `-set_exit_status` | Exit non-zero (`errorCode`/`warningCode` from the config) when findings exist. Without this, `revive` always exits 0. |
| `-exclude PATTERN` | Skip files matching `PATTERN` (package patterns like `vendor/...`). May be repeated. |
| `-max_open_files N` | Cap on concurrently open source files (default: system default). |
| `-version` | Print the revive version and exit. |

Flags appear before package arguments. Tokens after the first package pattern are treated as more package patterns, not as program arguments (unlike `go run`).

---

## 3. Configuration file (TOML)

A `revive.toml` has a small set of top-level fields plus one `[rule.NAME]` block per enabled rule.

```toml
ignoreGeneratedHeader = false   # if true, lint files marked "Code generated ... DO NOT EDIT."
severity              = "warning"
confidence            = 0.8
errorCode             = 1       # process exit code for error-severity findings
warningCode           = 0       # process exit code for warning-severity findings

# Optional directory-pattern exclusions baked into the config
exclude = ["vendor/...", "./internal/mock/..."]

[rule.RULE_NAME]
  severity  = "error"           # overrides top-level severity for this rule
  arguments = [...]             # rule-specific arguments (varies per rule)
  disabled  = false             # true to keep the block but turn the rule off
```

Semantics worth memorizing:

- **Providing any `[rule.X]` blocks replaces the built-in default rule set.** Rules not listed are off.
- A rule's `arguments` schema is rule-specific (some take a list of strings, some a map, some nothing).
- `disabled = true` is functionally the same as omitting the block; useful in shared configs as a documented "we deliberately turned this off".

---

## 4. Top-level fields

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `ignoreGeneratedHeader` | bool | `false` | When `false`, files whose first matching line is `// Code generated ... DO NOT EDIT.` are skipped. |
| `severity` | string | `"warning"` | Default severity for rules that do not set their own. |
| `confidence` | float | `0.8` | Drop findings with confidence below this. |
| `errorCode` | int | `1` | Exit code when `-set_exit_status` and any `error`-severity finding fired. |
| `warningCode` | int | `0` | Exit code when only `warning`-severity findings fired. |
| `exclude` | string list | `[]` | Package patterns to skip, equivalent to repeated `-exclude` flags. |

---

## 5. Rule block fields

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `severity` | string | top-level | `"warning"` or `"error"`. |
| `arguments` | TOML array | rule-defined | Per-rule configuration (consult the rule's documentation). |
| `disabled` | bool | `false` | If `true`, the rule is loaded but inactive. |

---

## 6. Output formats

| Formatter | Shape | Typical use |
|-----------|-------|-------------|
| `default` / `plain` | `file:line:col: message` | Terminal during dev |
| `friendly` | Pretty, colored, grouped | Local human reading |
| `stylish` | Compact summary with totals | CI logs (human-skimmable) |
| `unix` | `file:line:col: severity: message` | Editor jump-to-error pipelines |
| `ndjson` | One JSON object per line | Streaming consumers, `jq` |
| `json` | Single JSON document | Bulk parsing |
| `checkstyle` | Checkstyle XML | IDE integrations, Jenkins |
| `sarif` | SARIF JSON | GitHub code-scanning, security tools |

`default` and `friendly` are **not** stable across patch releases. Anything machine-consumed should use `ndjson`, `json`, `checkstyle`, or `sarif`.

---

## 7. Exit codes

| Situation | Without `-set_exit_status` | With `-set_exit_status` |
|-----------|----------------------------|--------------------------|
| No findings | `0` | `0` |
| Only `warning` findings | `0` | `warningCode` (default `0`) |
| Any `error` finding | `0` | `errorCode` (default `1`) |
| Invalid config / load error | non-zero (1+) | non-zero (1+) |
| Invalid CLI flags | `2` | `2` |

A common idiom: set `errorCode = 1`, keep `warningCode = 0`, and pass `-set_exit_status`. CI fails on `error` findings while `warning` findings remain visible without blocking.

---

## 8. Per-line directives

Inside Go source, comments control rule activation:

```go
//revive:disable                       // disable all rules from here to end of file or :enable
//revive:disable:rule-name             // disable a single rule until :enable
//revive:disable-next-line:rule-name   // disable for the next source line only
//revive:enable                        // re-enable previously disabled rules
//revive:enable:rule-name              // re-enable one rule
```

Multiple rules in one directive: `//revive:disable-next-line:rule-a,rule-b`. The directive must be a `//`-line comment (block comments are ignored). Whitespace between `revive:` and the action is not allowed.

---

## 9. Behavioral guarantees

- **Defaults are replaced, not merged.** Providing any `[rule.X]` block makes the config the authoritative list.
- **No global config.** `revive` reads only `-config` and built-in defaults; there is no `~/.revive.toml` or `/etc/revive.toml`.
- **Module-aware loading.** Packages are resolved via `go list`; running outside a module fails.
- **Generated-file skipping.** Files whose detection line matches the `// Code generated .* DO NOT EDIT\.` regex are skipped unless `ignoreGeneratedHeader = true`.
- **Confidence filter.** Findings with confidence below the top-level `confidence` value are silently dropped before formatting.
- **Parallel per-file execution.** Files are processed concurrently; rule order within a file is deterministic but rule output order across files is not.

---

## 10. Non-goals / limitations

- Not a security scanner / SAST. Use `gosec`, `semgrep`, or `govulncheck` for those concerns.
- Not a deep correctness analyzer. Use `staticcheck` and `go vet`.
- Not a test runner, formatter, or code generator. Stays in the style/conventions niche.
- Not a fixer — `revive` reports findings; it does **not** rewrite source.
- Not an analyzer plugin host. Custom rules require building a binary that vendors `revive` as a library.
- Not driven by `golang.org/x/tools/go/analysis`; it does not interoperate with that framework's Facts or shared type-info.

---

## 11. Related references
- Project: https://github.com/mgechev/revive
- Rule catalogue: https://github.com/mgechev/revive/blob/master/RULES_DESCRIPTIONS.md
- Formatter list: https://github.com/mgechev/revive#formatters
- `golangci-lint` `revive` integration: https://golangci-lint.run/usage/linters/#revive

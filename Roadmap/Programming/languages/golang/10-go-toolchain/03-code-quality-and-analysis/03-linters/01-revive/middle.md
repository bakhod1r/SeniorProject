# revive — Middle

## 1. Configuring with `revive.toml`

`revive` reads a TOML file pointed to by `-config`. A minimal one:

```toml
# revive.toml
ignoreGeneratedHeader = false
severity = "warning"
confidence = 0.8
errorCode = 1
warningCode = 0

[rule.exported]
[rule.var-naming]
[rule.package-comments]
[rule.error-return]
[rule.error-strings]
[rule.if-return]
[rule.unused-parameter]
[rule.unhandled-error]
  arguments = ["fmt.Print*", "fmt.Fprint*"]
```

Run it:

```bash
revive -config revive.toml ./...
```

Top-level fields:

- `severity` — default severity for rules that do not set their own (`"warning"` or `"error"`).
- `confidence` — minimum confidence to report (rules emit findings with a score; below this they are dropped).
- `errorCode` / `warningCode` — process exit codes used when `-set_exit_status` is set.
- `ignoreGeneratedHeader` — when `false` (default), files starting with `// Code generated ... DO NOT EDIT.` are skipped.

Every `[rule.NAME]` entry enables that rule. Omit it and the rule is off, even if it is in the defaults — declaring a config file means "this list is the policy."

---

## 2. The rules you will actually configure

The rules people enable first, with what they catch:

| Rule | Catches |
|------|---------|
| `exported` | Exported identifiers without a doc comment (or with one that does not start with the identifier name) |
| `var-naming` | `Id` → `ID`, `Url` → `URL`, `Json` → `JSON`, etc. |
| `package-comments` | Packages without a `// Package x ...` comment on the package clause |
| `error-return` | `error` returned in the wrong position (must be last) |
| `error-strings` | Capitalized or punctuation-ended error strings (`errors.New("Bad")`) |
| `if-return` | `if err != nil { return err }; return nil` collapses to `return err` |
| `unused-parameter` | A parameter that is never read inside the function body |
| `unhandled-error` | A return-value error that is discarded |

Some of these accept arguments. For example, `unhandled-error` takes a list of function patterns to *ignore* (because their errors are intentionally dropped):

```toml
[rule.unhandled-error]
  arguments = [
    "fmt.Print*",
    "fmt.Fprint*",
    "os.Stdout.Write",
    "(*bytes.Buffer).Write",
  ]
```

Read the official rule catalogue before turning each one on — the argument formats differ rule by rule.

---

## 3. Severity per rule

Each rule can override the global severity:

```toml
severity = "warning"

[rule.exported]
  severity = "warning"

[rule.error-return]
  severity = "error"   # this one fails CI

[rule.unhandled-error]
  severity = "error"
  arguments = ["fmt.Print*", "fmt.Fprint*"]
```

Combined with `-set_exit_status`:

- `warning` findings → exit code `warningCode` (default 0) — visible, do not fail the build.
- `error` findings → exit code `errorCode` (default 1) — fail the build.

This split is how you gradually adopt rules: enable a noisy new rule at `warning` first, fix the backlog over weeks, then promote to `error`.

---

## 4. Disabling rules locally

Sometimes a finding is correct in general but wrong here. Use directive comments:

```go
// Disable a rule for a single line:
//revive:disable-next-line:unused-parameter
func Handle(w http.ResponseWriter, r *http.Request) { ... }

// Disable for a block:
//revive:disable:exported
func internalButExported() {}
//revive:enable:exported

// Disable an entire file (put at top of file):
//revive:disable:package-comments
```

Multiple rules in one directive:

```go
//revive:disable-next-line:unused-parameter,unhandled-error
```

Rule of thumb: prefer fixing the issue. Reach for directives only when the rule genuinely does not apply (generated code, third-party callback signatures you cannot change, deliberate examples in docs).

---

## 5. Output formatters

`-formatter` controls how findings are rendered:

| Formatter | When to use |
|-----------|-------------|
| `default` | Plain `file:line:col: message` — terminal-friendly |
| `friendly` | Pretty, colored, grouped — best for humans reading locally |
| `stylish` | Compact summary with totals |
| `ndjson` | One JSON object per line — feed to scripts / dashboards |
| `checkstyle` | XML for IDE/CI integrations that consume Checkstyle reports |
| `json` | Single JSON document — handy in CI logs |
| `sarif` | SARIF for GitHub code-scanning |
| `plain` | Like `default` without colors |

```bash
revive -formatter friendly ./...
revive -formatter ndjson ./... > findings.ndjson
revive -formatter checkstyle ./... > revive-report.xml
```

`ndjson` is the right pick for CI: one finding per line, easy to grep, count, and stream-process without parsing a giant JSON tree.

---

## 6. CI integration

A typical job:

```yaml
- name: Lint with revive
  run: |
    go install github.com/mgechev/revive@v1.5.1
    revive -config revive.toml -formatter stylish -set_exit_status ./...
```

Three details that matter in CI:

1. **Pin the version** (`@v1.5.1`) — new rules can fire on previously clean code.
2. **`-set_exit_status`** — without it, `revive` always exits 0 and the job passes even with findings.
3. **Cache `~/.cache/go-build` and `~/go/pkg/mod`** so `go install revive` and the lint pass are quick on subsequent runs.

For pre-commit, run it only on changed packages so feedback is fast:

```bash
revive -config revive.toml $(git diff --name-only HEAD | grep '\.go$' | xargs -n1 dirname | sort -u)
```

---

## 7. `revive` vs `staticcheck`

They look similar but live in different niches:

| Concern | `revive` | `staticcheck` |
|---------|----------|---------------|
| Focus | Style, conventions, idioms | Correctness, real bugs, dead code |
| Configurable | Highly | Limited (rule on/off, per-package suppress) |
| Example finding | "exported func without doc comment" | "this comparison is always true" |
| Analyzer model | Custom AST visitors | Built on `golang.org/x/tools/go/analysis` |
| Custom rules | Yes (write a `lint.Rule`) | Indirectly (write an `Analyzer`) |
| Overlap with `go vet` | Some | Significant (extends it) |

Most teams run **both**: `revive` to enforce house style, `staticcheck` to catch real defects. They do not duplicate each other; their findings rarely overlap.

---

## 8. A realistic team config

For a typical service that wants moderate strictness:

```toml
ignoreGeneratedHeader = false
severity = "warning"
confidence = 0.8

[rule.var-naming]
[rule.exported]
[rule.package-comments]
[rule.error-return]
  severity = "error"
[rule.error-strings]
[rule.error-naming]
[rule.if-return]
[rule.indent-error-flow]
[rule.receiver-naming]
[rule.context-as-argument]
[rule.context-keys-type]
[rule.unused-parameter]
[rule.unhandled-error]
  severity = "error"
  arguments = ["fmt.Print*", "fmt.Fprint*", "(*os.File).Close"]
[rule.errorf]
[rule.empty-block]
[rule.superfluous-else]
```

This is small, opinionated, and stable — the recipe for a lint config that survives more than a quarter.

---

## 9. Summary

`revive.toml` is where the policy lives: which rules run, at what severity, with what arguments. Use `-set_exit_status` in CI, pick a formatter that matches the consumer (`friendly` for humans, `ndjson`/`checkstyle` for tooling), and reach for `//revive:disable:` directives only when the rule is genuinely wrong for that spot. Pair `revive` with `staticcheck` — they cover different ground.

---

## Further reading
- Rule catalogue: https://github.com/mgechev/revive/blob/master/RULES_DESCRIPTIONS.md
- Formatter list: https://github.com/mgechev/revive#formatters
- `staticcheck`: https://staticcheck.dev

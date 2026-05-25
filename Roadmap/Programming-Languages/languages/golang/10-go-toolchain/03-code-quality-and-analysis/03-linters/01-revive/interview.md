# revive — Interview Q&A

A mix of conceptual and practical questions, labeled by level. Answers are concise; expand with examples in a real interview.

---

## Junior

**Q1. What is `revive`?**
A configurable Go linter that flags style and convention issues (undocumented exports, bad naming, unhandled errors, etc.). It is the maintained, drop-in replacement for the archived `golint`.

**Q2. How do you install and run it?**
`go install github.com/mgechev/revive@latest`, then `revive ./...` from a module. With no config, it uses a built-in "golint-equivalent" default rule set.

**Q3. Name three rules in the default set.**
`var-naming` (catches `Id` → `ID`), `exported` (requires doc comments on exported identifiers), and `package-comments` (each package needs a `// Package x ...` line). Also valid: `error-strings`, `error-return`, `if-return`.

**Q4. How is `revive` different from `golint`?**
`golint` is archived and not configurable; `revive` is maintained, lets you pick rules in `revive.toml`, supports per-rule severity, custom rules, multiple output formats, and per-line disable comments.

---

## Middle

**Q5. How do you configure which rules run?**
Create a `revive.toml` and pass it with `-config revive.toml`. Each rule is enabled by a `[rule.NAME]` block; rules not listed are disabled even if they were in the defaults.

**Q6. How do you make `revive` fail CI on findings?**
Pass `-set_exit_status`. Then `warning` findings exit with `warningCode` (default 0) and `error` findings exit with `errorCode` (default 1). Without `-set_exit_status`, `revive` always exits 0.

**Q7. How do you suppress a single rule on one line?**
With a directive comment: `//revive:disable-next-line:unused-parameter` above the line. Block form: `//revive:disable:rule-name` ... `//revive:enable:rule-name`. Use sparingly; prefer fixing the issue.

**Q8. `revive` vs `staticcheck` — when do you use each?**
`revive` is for style and conventions (configurable, opinion-heavy). `staticcheck` is for correctness and real bugs (deeper analysis, fewer knobs). Most teams run both — their findings rarely overlap.

---

## Senior

**Q9. How would you roll out `revive` on a large legacy codebase?**
Start with three rules at `error` severity (e.g., `error-return`, `error-strings`, `package-comments`); fix everything they find in one PR. Then add more rules at `warning` severity and chip away at the backlog. Promote to `error` once a rule's backlog reaches zero on main.

**Q10. What does the `confidence` setting do?**
Each finding has a 0–1 confidence score; the top-level `confidence` threshold suppresses anything below it. Default is 0.8. Raise it (e.g., 0.95) to filter noisy rules during initial adoption; do not lower it without telling the team.

**Q11. A rule fires on generated code. How do you fix it?**
First, make sure the generator emits `// Code generated ... DO NOT EDIT.` — `revive` skips those by default. Otherwise, exclude the path via `-exclude path/...`. Last resort: file-level `//revive:disable:rule-name` at the top of generated files (and fix the generator).

**Q12. How do you write a custom rule?**
Implement the `lint.Rule` interface: `Name() string` and `Apply(file *lint.File, args lint.Arguments) []lint.Failure`. Walk the AST with `ast.Inspect`, return `lint.Failure` values with node, message, category, and confidence. Ship it by building a small CLI that imports `revive` as a library and appends your rules to the registry.

---

## Professional

**Q13. Why doesn't `revive` use `go/analysis` like staticcheck?**
It predates the convention and was designed for simple, isolated rules with a per-file worker pool. The trade-off: rules cannot share type-checking results, so `revive` does redundant work for semantic rules — but rule authors do not have to learn the Analyzer API. It is the right choice for a style linter, the wrong one for deep semantic analysis.

**Q14. You run `revive` standalone *and* `golangci-lint` (which also includes revive). Why both?**
Standalone for fast local feedback on just this linter; `golangci-lint` in CI for one combined report across many linters (revive + staticcheck + errcheck + ...). Share the `revive.toml` between them so the rule set is identical.

**Q15. How should CI consume `revive`'s output?**
Use a machine-readable formatter: `-formatter ndjson` for streaming, `-formatter checkstyle` for IDE/CI report integrations, `-formatter sarif` for GitHub code-scanning. The default text format is not a stable interface — patch releases have tweaked the wording.

---

## Common traps

- Running `revive` and expecting `staticcheck`-style bug detection. Different niches.
- Forgetting `-set_exit_status` and wondering why CI passes with hundreds of findings.
- Using `@latest` for the `revive` binary in CI — a new release can fire new rules on previously clean code.
- Disabling rules per-line as the default response to a finding instead of fixing the code (or fixing the config).
- Treating the default text formatter as machine-parseable — use `ndjson`/`json` for tooling.
- Putting `revive.toml` in only one repo when you have a fleet — the policy should be centralized.
- Confusing `confidence` (a per-finding score) with `severity` (warning vs error → exit code).
- Expecting `revive` to read a `~/.revive.toml`; there is no global config — only `-config` and the built-in defaults.

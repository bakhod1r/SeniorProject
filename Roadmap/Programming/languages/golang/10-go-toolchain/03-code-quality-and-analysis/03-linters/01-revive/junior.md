# revive — Junior

## 1. What is `revive`?

`revive` is a **fast, configurable, drop-in replacement for `golint`**. It reads your Go source and flags style and convention problems: undocumented exported identifiers, names that do not follow Go conventions, ignored errors, unused parameters, and dozens more.

The original `golint` from the Go team was archived and is no longer maintained. `revive` picks up where it left off, adds many more rules, and — crucially — lets you configure which rules run and how strict each one is. That single change (config-driven) is the whole reason it exists.

```bash
revive ./...
```

That one command lints every package under the current directory using the default rule set.

---

## 2. Prerequisites
- Go 1.21+ installed (`go version`).
- A Go module (`go mod init example.com/x`) with at least one package.
- Basic familiarity with running CLI tools.

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Linter** | A tool that flags suspicious or non-idiomatic code without executing it |
| **Rule** | A single check (e.g., "exported types must have a doc comment") |
| **Default rule set** | The rules `revive` enables when you give it no config |
| **Severity** | Whether a finding is a `warning` or an `error` (affects exit code) |
| **Confidence** | A 0.0–1.0 threshold; `revive` suppresses findings below it |
| **Formatter** | How findings are rendered (plain text, JSON, checkstyle XML, etc.) |
| **`revive.toml`** | The TOML config file that selects and configures rules |

---

## 4. Installing

The official one-liner:

```bash
go install github.com/mgechev/revive@latest
```

This drops a `revive` binary into `$(go env GOBIN)` (or `$GOPATH/bin`). Make sure that directory is on your `$PATH`:

```bash
export PATH="$(go env GOPATH)/bin:$PATH"
revive -version
```

Pinning a release is healthier than `@latest` once you put it in a team workflow:

```bash
go install github.com/mgechev/revive@v1.5.1
```

---

## 5. The first run

In any module:

```bash
revive ./...
```

Output (one finding per line):

```
internal/store/store.go:14:6: exported type Store should have comment or be unexported
cmd/api/main.go:32:5: error strings should not be capitalized or end with punctuation
```

The format is `file:line:col: message`. Each line is a single rule firing on a single location.

If you give no `-config` flag, `revive` uses its **built-in default configuration**, which is intentionally minimal — roughly the rules `golint` used to apply. It will not produce the same noise as `golangci-lint`; you have to opt into more rules deliberately.

---

## 6. The default rule set (what fires out of the box)

Without a config, `revive` enables a small "golint-equivalent" set, including:

- `var-naming` — flags `Id` (should be `ID`), `Url` (should be `URL`), etc.
- `exported` — exported identifiers need a doc comment starting with the name.
- `package-comments` — every package should have a `// Package x ...` comment.
- `error-return` — the error return value should be last.
- `error-strings` — error strings should not be capitalized or end with punctuation.
- `error-naming` — error variables/types should be named `errFoo` / `FooError`.
- `if-return` — `if err != nil { return err } return nil` simplifies to `return err`.
- `indent-error-flow` — keep the happy path un-indented.
- `range` — idiomatic `for range` loops.
- `receiver-naming` — receivers should be consistently named across methods.
- `time-naming` — `time.Duration` variables should not be `Sec`/`Msec` suffixed.
- `unexported-return` — exported funcs returning unexported types are usually a smell.
- `errorf` — prefer `fmt.Errorf` over `errors.New(fmt.Sprintf(...))`.
- `empty-block` — flag empty `{}` blocks.
- `superfluous-else` — `if {...} else {...}` after a `return` should drop the `else`.
- `dot-imports` — discourage `import . "pkg"`.
- `blank-imports` — require doc for `_ "pkg"` imports.
- `context-as-argument` — `ctx` must be the first argument.
- `context-keys-type` — context keys must not be a built-in type.

You get all of these without writing any config.

---

## 7. `revive` vs `golint`

| Concern | `golint` (archived) | `revive` |
|---------|---------------------|----------|
| Maintained | No (frozen 2020) | Yes |
| Rule selection | Hard-coded | Configurable |
| Per-rule severity | No | Yes (`warning` / `error`) |
| Disable a rule per line | No | Yes (`//revive:disable:rule-name`) |
| Custom rules | No | Yes (write one in Go) |
| Output formats | One | Several (text, JSON, checkstyle, ndjson) |
| Speed | Slow on large repos | Faster, runs rules in parallel |

If you used `golint` before, `revive ./...` with no config produces roughly the same output. From there you turn things on.

---

## 8. Why config-driven linting matters

Two teams almost never agree on which rules are useful. Some examples that are genuinely contested:

- "Must every exported function have a doc comment?" — fine in a public library, painful in an internal microservice.
- "Should `if-return` always be simplified?" — sometimes the explicit form is clearer.
- "Are dot imports always bad?" — they are idiomatic in some DSLs and test helpers.

`revive` lets you pick a per-repo policy in `revive.toml` and **enforce only what you agree on**. The result: fewer fights in code review, and a stable signal-to-noise ratio in CI.

---

## 9. Common first-day mistakes

- Running `revive` without a `go.mod` — it complains about packages and you assume the tool is broken.
- Expecting it to behave like `staticcheck` — `revive` is about *style and conventions*, not deep correctness.
- Adding *every* available rule on day one and getting drowned in noise. Start small (defaults), then add one rule at a time.
- Treating `warning` severity as a build failure — by default `revive` exits 0 even with findings unless you use `-set_exit_status`.

---

## 10. Summary

`revive` is the maintained, configurable successor to `golint`. Install with `go install github.com/mgechev/revive@latest`, run `revive ./...` to lint with a sensible default rule set, and reach for a `revive.toml` once you want to tighten or relax the policy. It is a *style and conventions* linter, complementary to (not a replacement for) `go vet` and `staticcheck`.

---

## Further reading
- Project page: https://github.com/mgechev/revive
- Full rule catalogue: https://github.com/mgechev/revive/blob/master/RULES_DESCRIPTIONS.md
- `golint` deprecation: https://github.com/golang/go/issues/38968

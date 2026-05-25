# staticcheck — Middle

## 1. Check categories in depth

Staticcheck groups checks into families by intent:

| Prefix | Family | What it catches | Tone |
|--------|--------|-----------------|------|
| `SA` | Static analysis | Likely bugs, misuse of APIs, suspicious patterns | Usually a real problem |
| `S` | Simple | Equivalent but simpler code | Quality-of-life |
| `ST` | Stylecheck | Style/convention violations | Opinionated |
| `U` | Unused | Dead code (functions, fields, constants, variables) | Usually safe to delete |
| `QF` | Quickfix | Refactor suggestions, surfaced by `gopls` | IDE-driven |

A reasonable starting policy: treat all `SA` and `U` findings as blocking, `S` as encouraged, `ST` as opt-in per repo.

---

## 2. Selecting which checks run

The `-checks` flag controls the active set. Syntax: comma-separated patterns, `-` to exclude, `*` as wildcard. Order matters — later items override earlier ones.

```bash
staticcheck -checks=all ./...                 # everything
staticcheck -checks=SA* ./...                 # only SA family
staticcheck -checks=all,-ST* ./...            # everything except style
staticcheck -checks=SA*,U1000 ./...           # all SA + the unused-func check
staticcheck -checks=inherit ./...             # inherit from staticcheck.conf
```

The default is roughly "all checks except a few noisy ST ones". Use `-checks=all,-ST1000,-ST1003` to opt out of specific style rules.

---

## 3. Per-project configuration: `staticcheck.conf`

A `staticcheck.conf` file at the module root (or any package) sets defaults so contributors do not need to remember flags:

```toml
# staticcheck.conf
checks = ["all", "-ST1000", "-ST1003"]
initialisms = ["ACL", "API", "CPU", "DNS", "ID", "URL", "UTF8"]
dot_import_whitelist = ["github.com/example/dsl"]
http_status_code_whitelist = ["200", "400", "404", "500"]
```

Keys:
- `checks` — same syntax as `-checks`.
- `initialisms` — allowed all-caps identifiers (`URL`, not `Url`).
- `dot_import_whitelist` — packages allowed to be imported with `.`.
- `http_status_code_whitelist` — numeric status codes allowed instead of `http.StatusX` constants.

Configs nest: a `staticcheck.conf` inside `internal/legacy/` overrides the root one for that subtree. Use this to relax checks in legacy code while keeping new code strict.

---

## 4. High-signal checks worth knowing by ID

| ID | What it flags |
|----|---------------|
| `SA1006` | `fmt.Printf` format-verb / argument-type mismatch |
| `SA1019` | Use of a deprecated symbol (`// Deprecated:` doc) |
| `SA1029` | Inappropriate key type for `context.WithValue` (e.g., a string literal) |
| `SA4006` | Assigned value never used (dead store) |
| `SA4009` | Argument overwritten before being used |
| `SA5007` | Infinite recursive call (function calls itself unconditionally) |
| `SA9003` | Empty branch (`if x { }`) — usually a bug |
| `S1005` | Drop blank receiver in `for _, _ := range` |
| `S1000` | Replace `for { select { case x := <-ch: ... } }` with `for x := range ch` |
| `ST1005` | Capitalized or punctuation-ending error string |
| `U1000` | Unused unexported function/method/field |

These are the ones that recur in code review; memorize a handful and the reports become readable at a glance.

---

## 5. Suppressing a finding inline

When a flag is intentional, suppress it with a `//lint:ignore` directive on the line above:

```go
//lint:ignore SA1019 v2 client is intentionally still on the old API until Q3
client := oldpkg.NewClient()
```

Or for a whole file, at the top:

```go
//lint:file-ignore SA1019 migrating away in a separate PR
```

The reason after the ID is **mandatory** by convention — staticcheck does not enforce it programmatically, but reviewers should reject ignores without one. A bare `//lint:ignore SA1019` is a code smell.

---

## 6. Exit status for CI

By default, staticcheck **always** exits 0 — findings go to stdout, not the exit code. To make CI fail when there are findings:

```bash
staticcheck -set_exit_status ./...
echo $?   # non-zero if there were any findings
```

`-set_exit_status` is technically deprecated in favor of the unconditional behavior of `staticcheck -fail`, but it remains widely used and is the form you will see in older CI configs. Keep using it until your CI templates are updated.

```yaml
# GitHub Actions step
- name: staticcheck
  run: |
    go install honnef.co/go/tools/cmd/staticcheck@v0.5.1
    staticcheck -set_exit_status ./...
```

---

## 7. Output formats

| `-f` value | Use for |
|------------|---------|
| `text` (default) | Human reading in the terminal |
| `stylish` | Slightly nicer human format |
| `json` | Machine processing / custom tooling |
| `sarif` | GitHub code scanning, Azure DevOps, etc. |
| `binary` | Internal serialization, rarely needed |

```bash
staticcheck -f sarif ./... > staticcheck.sarif
```

SARIF is the format you upload to GitHub's "Code scanning alerts" UI via `github/codeql-action/upload-sarif`. Findings then appear in the PR review interface alongside CodeQL results.

---

## 8. Filtering scope

```bash
staticcheck -tests=false ./...            # skip *_test.go files
staticcheck -tags=integration ./...        # apply build tags
staticcheck -go 1.22 ./...                # target a specific Go version's behavior
staticcheck ./internal/...                # restrict to a subtree
```

`-go` matters: some checks change behavior based on the target Go version (e.g., what is deprecated, what stdlib symbols exist). Set it to your `go.mod`'s `go` directive for consistency between local and CI.

---

## 9. Run-don't-fix workflow on a legacy repo

When you adopt staticcheck on an established codebase, you will see thousands of findings. The pragmatic order:

1. Run `staticcheck -checks=SA* ./...` — fix all correctness bugs first.
2. Add `-checks=SA*,U1000 ./...` — delete dead code.
3. Add `S*` — accept simplifications.
4. Add `ST*` last; bikeshed once with the team, then commit the policy in `staticcheck.conf`.

This avoids drowning in style noise before the real bugs are addressed.

---

## 10. Summary

Staticcheck's checks live in four families — `SA`, `S`, `ST`, `U` (plus `QF` for IDE quickfixes). Control them with `-checks=...` or a committed `staticcheck.conf`. Suppress intentional findings with `//lint:ignore SA1234 reason` (always include the reason). Fail CI with `-set_exit_status`, emit SARIF for code-scanning UIs, and pin the Go target with `-go` so local and CI agree. Adopting on a legacy repo? Roll out `SA` first, then `U`, then `S`, then `ST`.

---

## Further reading
- Configuration: https://staticcheck.dev/docs/configuration/
- Check list: https://staticcheck.dev/docs/checks/
- Running staticcheck: https://staticcheck.dev/docs/running-staticcheck/

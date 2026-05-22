# gofmt / go fmt — Senior

## 1. gofmt is part of Go's compatibility surface

gofmt's output is intentionally **stable**, but it is not frozen forever — the Go team occasionally adjusts formatting (e.g., the Go 1.19 doc-comment reformatting). When the formatter changes between toolchain versions, files formatted by an older gofmt can be flagged by a newer one and vice versa. This is the single most important senior insight:

> **The gofmt version is tied to the Go toolchain version.** A repo formatted with Go 1.22's gofmt may show diffs under Go 1.19's, and vice versa.

Consequence: CI must run the **same toolchain version** developers use, or formatting checks produce spurious failures. Pin the toolchain (`go` directive + `GOTOOLCHAIN`) so gofmt behaves identically everywhere.

---

## 2. The Go 1.19 doc-comment change (a concrete example)

Go 1.19 taught gofmt to reformat doc comments (links, lists, headings). Upgrading a large repo produced a one-time formatting churn across many comment blocks. Seniors handle this by:

1. Upgrading the toolchain repo-wide in one commit.
2. Running `gofmt -w ./...` in a dedicated "reformat for Go 1.19" commit, isolated from logic changes.
3. Adding that commit to `.git-blame-ignore-revs` so blame is not polluted.

```
# .git-blame-ignore-revs
# gofmt reformat for Go 1.19
<commit-sha>
```

---

## 3. gofmt vs the build/dev loop

gofmt is purely syntactic — it parses to an AST and re-prints. It does **not** type-check, so it formats code that does not compile, as long as it parses. This is why format-on-save works even mid-edit. It also means:

- A parse error (not just a type error) blocks formatting; `gofmt -e` reveals all parse errors.
- gofmt is fast (no type checking, no dependency loading), making it cheap to run on every save and in pre-commit hooks.

---

## 4. Where it surprises people

- **gofmt does not sort/add imports beyond grouping.** Teams expecting unused-import cleanup are surprised; that is goimports/gopls.
- **Toolchain-version skew** produces "your file is unformatted" failures even though it was formatted — by a different gofmt.
- **gofmt rewrites struct tag alignment and comment formatting**, which can create large diffs on legacy code at upgrade time.
- **`go fmt` writes by default** (`-w`); running it in CI silently mutates files instead of failing — always use `gofmt -l` for *checking*.
- **CRLF / tabs vs spaces.** gofmt uses tabs for indentation; editors set to insert spaces fight it until format-on-save normalizes.
- **Generated files** still get formatted; gofmt has no concept of "skip generated," so generators should emit gofmt-clean output (or run gofmt on their output).

---

## 5. CI: check, pin, isolate

```bash
# Check formatting with the pinned toolchain (gofmt -s).
diff=$(gofmt -s -l .)
if [ -n "$diff" ]; then
  echo "Unformatted files:"; echo "$diff"
  echo "Run: gofmt -s -w ."
  exit 1
fi
```

Senior CI rules:
- Run the formatting check under the **same `go` toolchain** as developers (pin via `GOTOOLCHAIN`).
- Use `gofmt -l` (check), never `go fmt` (write) in CI.
- Decide once whether the standard is `gofmt`, `gofmt -s`, or `gofumpt`, and apply the *same* tool in editors, hooks, and CI.

---

## 6. Programmatic formatting (`go/format`)

The same engine is available as a library, useful in code generators and tooling:

```go
import "go/format"

src := []byte("package x\nfunc f( ){}")
out, err := format.Source(src) // canonical gofmt output
```

Code generators should pass their output through `format.Source` so generated files are gofmt-clean and never appear in formatting-check failures.

---

## 7. Performance and scale

On a large monorepo, `gofmt -l ./...` is fast because it skips type checking, but it still walks every file. Optimizations:

- In CI, format-check only **changed** files for PRs (`git diff --name-only` filtered to `.go`), and run a full check on main periodically.
- Editors format only the open file on save — effectively zero cost.

---

## 8. Standardizing the exact formatter

The decision matrix seniors drive:

| Tool | Adds | Trade-off |
|------|------|-----------|
| `gofmt` | baseline | leaves some variation |
| `gofmt -s` | redundancy removal | none; recommended baseline |
| `goimports` | import management | not stdlib (x/tools) |
| `gofumpt` | stricter rules | non-stdlib; superset of gofmt |

Whatever you pick must be identical across editor (gopls config), pre-commit hook, and CI — mismatch produces endless "format" diffs.

---

## 9. Summary

gofmt is a fast, syntactic, opinionated formatter whose output is stable but tied to the toolchain version — so pin the toolchain to avoid spurious CI failures. Handle formatter upgrades (e.g., the 1.19 doc-comment change) as isolated reformat commits added to `.git-blame-ignore-revs`. Use `gofmt -l` to check in CI (never `go fmt`'s write mode), pass generated code through `go/format`, and standardize one exact formatter (gofmt/`-s`/gofumpt) across editors, hooks, and CI.

---

## Further reading
- `gofmt`: https://pkg.go.dev/cmd/gofmt
- `go/format`: https://pkg.go.dev/go/format
- Go 1.19 doc comments: https://go.dev/doc/comment

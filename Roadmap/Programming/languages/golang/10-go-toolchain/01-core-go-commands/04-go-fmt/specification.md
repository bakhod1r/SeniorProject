# gofmt / go fmt — Specification

> **Focus:** Precise reference for `gofmt` and the `go fmt` wrapper — synopsis, flags, behavior, exit codes, and guarantees.
>
> **Sources:**
> - `gofmt`: https://pkg.go.dev/cmd/gofmt
> - `go fmt`: `go help fmt`
> - `go/format`: https://pkg.go.dev/go/format

---

## 1. Synopsis

```
gofmt [flags] [path ...]
go fmt [-n] [-x] [packages]
```

`gofmt` formats Go source to the canonical style. `go fmt` runs `gofmt -l -w` on the Go source files in the named packages.

If no paths are given, `gofmt` reads from standard input and writes to standard output.

---

## 2. gofmt flags

| Flag | Effect |
|------|--------|
| (none) | Print formatted result to stdout |
| `-l` | List files whose formatting differs from gofmt's (no other output) |
| `-w` | Write the result back to the (source) file instead of stdout |
| `-d` | Print diffs (unified) instead of the formatted file |
| `-s` | Apply simplifications to the code |
| `-e` | Report all errors, not just the first 10 lines |
| `-r 'rule'` | Apply a rewrite rule (`pattern -> replacement`) |
| `-cpuprofile file` | Write a CPU profile (debugging gofmt itself) |

`-l` and `-w` can combine (this is what `go fmt` uses).

---

## 3. go fmt flags

| Flag | Effect |
|------|--------|
| `-n` | Print the commands that would run, without executing |
| `-x` | Print the commands as they execute |

`go fmt` accepts package patterns (`.`, `./...`, import paths) and forwards them to `gofmt -l -w`.

---

## 4. The `-s` simplifications

| Before | After |
|--------|-------|
| `s[a:len(s)]` | `s[a:]` |
| `[]T{T{...}}` | `[]T{{...}}` (redundant element type) |
| `map[K]V{K{...}: ...}` | `{...}: ...` (redundant key type) |
| `for x = range v { ... }` with unused index/value | normalized range forms |

`-s` is semantics-preserving and widely adopted as the baseline.

---

## 5. The `-r` rewrite rules

```bash
gofmt -r 'a[b:len(a)] -> a[b:]' -w .
gofmt -r 'α[β] -> γ' file.go      # pattern variables are single lowercase letters
```

Rules operate on the AST; pattern variables match arbitrary subexpressions. Used for mechanical refactors.

---

## 6. Behavior and guarantees

- **Syntactic only.** gofmt parses to an AST and re-prints; it does **not** type-check. It formats code that does not compile, provided it parses.
- **Idempotent.** Running gofmt on already-formatted code produces no change.
- **Single canonical output.** No configuration options for style; output is fixed by the toolchain version.
- **Version-tied.** gofmt's output can change between Go releases (e.g., doc-comment formatting in Go 1.19). The gofmt used is the one shipped with the active toolchain.
- **Imports.** gofmt sorts and groups imports but never adds or removes them (use `goimports` for that).

---

## 7. Exit codes

| Situation | gofmt exit |
|-----------|-----------|
| Success (formatting done/printed/listed) | 0 |
| With `-l`: files listed | 0 (the *output* signals work, not the exit code) |
| Parse error in input | non-zero, error to stderr |
| I/O error | non-zero |

CI typically tests the **output** of `-l` (non-empty = unformatted) rather than the exit code:

```bash
test -z "$(gofmt -l .)"
```

---

## 8. Library equivalent (`go/format`)

```go
import "go/format"
out, err := format.Source(src)   // canonical gofmt formatting of src
out, err := format.Node(w, fset, node) // format an AST node
```

Generators should use `format.Source` so emitted code is gofmt-clean.

---

## 9. Related tools

| Tool | Adds over gofmt |
|------|-----------------|
| `goimports` | adds/removes imports | https://pkg.go.dev/golang.org/x/tools/cmd/goimports |
| `gofumpt` | stricter, gofmt-compatible superset | https://github.com/mvdan/gofumpt |
| `gopls` | runs gofmt/goimports on save | https://pkg.go.dev/golang.org/x/tools/gopls |

---

## 10. Related references
- gofmt blog: https://go.dev/blog/gofmt
- Effective Go (formatting): https://go.dev/doc/effective_go#formatting
- Go doc comments (1.19+): https://go.dev/doc/comment

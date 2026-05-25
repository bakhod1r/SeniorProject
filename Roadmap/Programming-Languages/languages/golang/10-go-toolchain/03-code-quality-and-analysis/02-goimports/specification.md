# goimports — Specification

> **Focus:** Precise reference for the `goimports` tool — synopsis, arguments, flags, environment, behavioral guarantees, and limitations.
>
> **Sources:**
> - `goimports -h`
> - Tool: https://pkg.go.dev/golang.org/x/tools/cmd/goimports
> - Library: https://pkg.go.dev/golang.org/x/tools/imports
> - `gofmt` reference: https://pkg.go.dev/cmd/gofmt

---

## 1. Synopsis

```
goimports [flags] [path ...]
```

`goimports` updates the formatting and import block of Go source files. It is a strict superset of `gofmt`: the output is always also valid `gofmt` output, with the addition that missing imports are added and unused imports are removed.

If no path is given, `goimports` reads from stdin and writes to stdout. If paths are given:
- A file path: that file is processed.
- A directory path: every `.go` file under it (recursively) is processed.

---

## 2. Argument forms

| Form | Meaning |
|------|---------|
| (none) | Read source from stdin, write formatted source to stdout |
| `file.go` | Process the named file |
| `dir/` | Recursively process every `.go` file under `dir/` |
| Multiple paths | Process each in order |

`goimports` does not distinguish "main" packages from libraries; it operates on individual files regardless of package role.

---

## 3. Flags

| Flag | Effect |
|------|--------|
| `-w` | Write the result back to the source file(s) instead of stdout. The standard form for in-place fixup. |
| `-d` | Display a unified diff of the changes instead of writing or printing the full file. Useful for CI error messages. |
| `-l` | List the names of files that would be changed; do not write or print contents. Empty output = nothing to do. |
| `-srcdir <dir>` | Resolve imports as if the file lived in `<dir>`. Used by editors/LSP when feeding an in-memory buffer whose on-disk path is a temp file. |
| `-local <prefixes>` | Comma-separated import path prefixes to treat as "local," placing them in a separate group below third-party imports. |
| `-format-only` | Disable import fixup entirely; behave like `gofmt`. The `imports.Options.FormatOnly` setting from the library. |
| `-v` | Verbose: log files being processed. |
| `-e` | Report all errors (not just the first 10) per file. Inherited from `gofmt`. |
| `-cpuprofile <file>` | Write a CPU profile to `<file>` for performance debugging. |

Flags must appear before path arguments.

---

## 4. Environment variables

`goimports` consults the same Go environment used by the toolchain to find candidate packages.

| Variable | Role |
|----------|------|
| `GOROOT` | Standard library location for candidate scanning |
| `GOPATH` | Legacy candidate search root (`$GOPATH/src/...`) |
| `GOMODCACHE` | Module cache location (`$(go env GOMODCACHE)`); the bulk of third-party candidates |
| `GO111MODULE` | Module mode (`on`/`off`/`auto`); `on` is the modern default |
| `GOFLAGS` | Default flags applied to underlying `go` operations |
| `GOPROXY`, `GOSUMDB` | Used by the underlying `go list`-style resolution when needed |

When invoked outside a module (no enclosing `go.mod`), `goimports` falls back to GOPATH-style resolution; this is rarely what you want in modern Go.

---

## 5. Exit behavior

| Situation | Exit |
|-----------|------|
| All files processed cleanly | 0 |
| Parse error in any file | non-zero; the error is printed to stderr; other files may still be processed |
| File I/O error (e.g., write permission) | non-zero |
| `-l` mode with files to change | exit 0; the list is printed to stdout (the **shell** decides what to do with a non-empty list — CI scripts typically `[ -z "$(goimports -l ...)" ]`) |

`-l` is intentionally **not** a non-zero exit on "needs formatting"; build the gate yourself in shell.

---

## 6. Behavioral guarantees

- **gofmt-clean output.** Anything `goimports` writes is also valid `gofmt` output. Running `gofmt` after `goimports` is a no-op.
- **Add missing imports** for unresolved selectors (`pkg.Symbol`) when an unambiguous candidate package is found.
- **Remove unused imports** whose imported name is not referenced anywhere in the file.
- **Preserve blank and dot imports.** `_ "pkg"` and `. "pkg"` are kept regardless of references — these are explicit side-effect / namespace-merge imports.
- **Sort imports** lexicographically within each group.
- **Group imports** into two groups (stdlib, non-stdlib) by default, or three groups (stdlib, third-party, local) when `-local` is provided.
- **Idempotent.** Running `goimports` twice on the same file produces the same result.

---

## 7. Non-goals / limitations

- **No type checking of your code.** Resolution of unresolved selectors uses a name-based candidate scan with light verification, not a full type-check. Ambiguous symbols (same name in two packages) are resolved heuristically — and may be wrong.
- **No multi-file refactor.** `goimports` operates one file at a time. Cross-file rename or symbol resolution is the job of `gopls`/`gorename`.
- **Will not import a package for code you have not written.** Removing a reference (or commenting it out) removes the import.
- **Will not invent imports for unresolved identifiers** if no candidate package on disk exports that name. Packages not yet in the module cache are invisible — run `go mod download` first.
- **Does not enforce style beyond `gofmt`.** For stricter rules (e.g., simplified composite literals), use `gofumpt`. For richer import grouping (more than three groups), use `gci`.
- **Not part of the Go distribution.** Install separately with `go install golang.org/x/tools/cmd/goimports@vX.Y.Z`.

---

## 8. Module-mode interaction

In module mode (`GO111MODULE=on`, the default in Go 1.16+):
- The current module's `go.mod` defines what is in scope; the build list bounds the third-party candidate set.
- Candidates come from stdlib + the module cache + the current module's own packages.
- `-srcdir` overrides which `go.mod` is consulted, used when the file path does not reflect its logical module location.

In GOPATH mode (`GO111MODULE=off`):
- Candidates come from stdlib + `$GOPATH/src/...`.
- No module graph; ambiguity is more common.
- Avoid in modern Go.

---

## 9. Library equivalent

The same engine is exposed as a Go library:

```go
import "golang.org/x/tools/imports"

opts := &imports.Options{
    Comments:   true,
    TabIndent:  true,
    TabWidth:   8,
    FormatOnly: false,           // false = also fix imports
}
out, err := imports.Process("path/for/resolution.go", src, opts)
```

`gopls` and other tools call into this library directly; the CLI is a thin wrapper.

---

## 10. Related references
- `gofmt`: https://pkg.go.dev/cmd/gofmt
- `gopls` (organizeImports code action): https://pkg.go.dev/golang.org/x/tools/gopls
- `gofumpt`: https://github.com/mvdan/gofumpt
- `gci`: https://github.com/daixiang0/gci
- Modules reference: https://go.dev/ref/mod

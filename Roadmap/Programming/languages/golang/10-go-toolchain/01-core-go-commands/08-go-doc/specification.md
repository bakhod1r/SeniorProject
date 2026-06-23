# go doc — Specification

> **Focus:** Precise reference for `go doc` (and briefly pkgsite/godoc) — synopsis, flags, argument forms, environment, exit codes, and guarantees.
>
> **Sources:**
> - `go help doc`
> - `go doc`: https://pkg.go.dev/cmd/doc
> - Go doc comments: https://go.dev/doc/comment

---

## 1. Synopsis

```
go doc [doc flags] [package|[package.]symbol[.methodOrField]]
go doc [doc flags] [package] [symbol]
```

Prints documentation for a package or symbol, extracted from source doc comments. With no arguments, documents the package in the current directory.

---

## 2. Argument forms

| Form | Meaning |
|------|---------|
| (none) | The package in the current directory |
| `pkg` | A package (import path or local path) |
| `pkg.Symbol` | A package-level symbol |
| `pkg.Type.Method` / `pkg.Type.Field` | A method or field of a type |
| `pkg Symbol` | Two-argument form (useful for disambiguation) |
| `.Symbol` | A symbol in the current directory's package |

Symbol matching is case-insensitive by default (use `-c` for case-sensitive).

---

## 3. Flags

| Flag | Effect |
|------|--------|
| `-all` | Show all documentation for the package |
| `-c` | Case-sensitive symbol matching |
| `-cmd` | Treat a command (`package main`) as documentable |
| `-short` | One-line representation of each symbol |
| `-src` | Show the source of the symbol |
| `-u` | Include unexported symbols and fields |

---

## 4. Doc comment rules

- A doc comment is the comment block **immediately preceding** a declaration, with no intervening blank line.
- Package documentation precedes `package x` (commonly in `doc.go`).
- Conventionally begins with the symbol's name (`// Hello returns ...`).
- Since Go 1.19, comments support a defined syntax: headings (`# Title`), lists, indented code blocks, and links (`[Name]`, `[pkg.Symbol]`), normalized by gofmt and rendered by pkg.go.dev.
- A paragraph starting `Deprecated:` marks the symbol as deprecated (recognized by tools).

---

## 5. Examples (`ExampleXxx`)

| Form | Documents |
|------|-----------|
| `Example()` | the package |
| `ExampleF()` | function `F` |
| `ExampleT()` | type `T` |
| `ExampleT_M()` | method `M` of type `T` |

An `// Output:` comment makes the example a verified test (run by `go test`); `// Unordered output:` allows any ordering. Examples appear under the symbol on pkg.go.dev.

---

## 6. Environment variables

| Variable | Role |
|----------|------|
| `GOPATH`, `GOMODCACHE` | Where dependency source is resolved from |
| `GOFLAGS` | Default flags applied to `go` commands |
| `PAGER` | Used when output is paged (via shell, e.g., `go doc -all pkg | less`) |

`go doc` resolves third-party packages via the module graph; the module must be available locally.

---

## 7. Exit codes

| Situation | Exit |
|-----------|------|
| Documentation printed | 0 |
| Symbol/package not found | non-zero, message to stderr |
| Invalid flags | 2 |

---

## 8. Behavioral guarantees

- **Exported-only by default.** Unexported symbols require `-u`.
- **Resolves the module-graph version.** `-src` shows the cached source for the selected version, not local dependency edits.
- **Mirrors pkg.go.dev content** (text vs HTML), driven by the same doc comments.
- **Detached comments are not docs.** A blank line between comment and declaration disconnects them.

---

## 9. Related tools

| Tool | Role | Reference |
|------|------|-----------|
| `pkg.go.dev` | Hosted HTML docs | https://pkg.go.dev |
| `pkgsite` | Local HTML preview matching pkg.go.dev | https://pkg.go.dev/golang.org/x/pkgsite |
| `godoc` (legacy) | Older local HTML server | https://pkg.go.dev/golang.org/x/tools/cmd/godoc |

```bash
go install golang.org/x/pkgsite/cmd/pkgsite@latest
pkgsite -open .
```

---

## 10. Related references
- `go doc`: https://pkg.go.dev/cmd/doc
- Go doc comments (1.19+): https://go.dev/doc/comment
- Compatibility promise: https://go.dev/doc/go1compat

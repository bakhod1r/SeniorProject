# go doc — Middle

## 1. The flags that matter

| Flag | Effect |
|------|--------|
| `-all` | Show all documentation for the package (not just the summary) |
| `-src` | Show the source code of the symbol |
| `-u` | Include unexported symbols (lowercase) |
| `-c` | Case-sensitive symbol matching |
| `-cmd` | Treat a command's `main` package as documentable |
| `-short` | One-line representation of each symbol |

```bash
go doc -all -u ./internal/auth    # full docs incl. unexported, for a local pkg
go doc -src strings.HasPrefix     # implementation
go doc -short io                   # compact symbol list
```

---

## 2. Addressing symbols precisely

`go doc` accepts increasingly specific arguments:

```bash
go doc strings                       # package
go doc strings.Builder               # a type (and its methods/fields)
go doc strings.Builder.WriteString   # a method
go doc strings.Compare               # a function
go doc strings Compare               # package + symbol as two args (also valid)
```

For a type, `go doc` lists its methods and fields; drill into a method by appending it. The two-argument form (`go doc <pkg> <Sym>`) is handy when the symbol name is ambiguous.

---

## 3. Local packages and the current directory

```bash
go doc                  # the package in the current directory
go doc .                # same
go doc ./internal/db    # a package by relative path
go doc -all .           # full docs for the current package
```

This is how you preview your own package's documentation exactly as consumers will read it on pkg.go.dev — write the comment, then `go doc .` to check.

---

## 4. Doc comment conventions (so your docs read well)

- Start the comment with the symbol's name: `// Hello returns ...`.
- A package's doc comment goes above `package x` (often in a `doc.go` file for large packages).
- Since Go 1.19, doc comments support lightweight formatting: lists, headings, and links rendered by pkg.go.dev.

```go
// Package cache provides an in-memory LRU.
//
// # Usage
//
// Create a cache with New and call Get/Set.
//
// See also [Config] for tuning.
package cache
```

`gofmt` (1.19+) normalizes this formatting; `go doc` shows it as text and pkg.go.dev renders it.

---

## 5. Examples are documentation

`ExampleXxx` functions in `_test.go` become runnable, displayed examples:

```go
func ExampleHello() {
	fmt.Println(Hello("Go"))
	// Output: Hello, Go
}
```

`go test` runs them (verifying the `// Output:` comment), and pkg.go.dev shows them under the symbol. `go doc` itself shows that an example exists. Examples are the best documentation because they are compiled and tested.

---

## 6. `go doc` vs pkgsite/godoc

| Tool | Output | Use |
|------|--------|-----|
| `go doc` | terminal text | quick lookup while coding |
| pkg.go.dev | hosted HTML | public, browsable docs |
| `pkgsite` (local) | local HTML server | preview your docs as HTML before publishing |
| `godoc` (legacy) | local HTML server | older tool, mostly superseded by pkgsite |

To preview HTML locally:

```bash
go install golang.org/x/pkgsite/cmd/pkgsite@latest
pkgsite -open .        # serves your module's docs as HTML
```

`godoc` is the older command (`go install golang.org/x/tools/cmd/godoc@latest`); pkgsite is the modern equivalent that matches pkg.go.dev.

---

## 7. Documentation as part of the dev loop

- Looking up an API: `go doc pkg.Symbol` (faster than a browser).
- Reading an implementation: `go doc -src pkg.Symbol`.
- Reviewing your own API surface: `go doc -all .` to see exactly what you export.
- Catching accidental exports: scan `go doc .` for symbols that should have been unexported.

---

## 8. Documenting commands

For a `main` package (a CLI), document it with a package comment, and view it with `-cmd`:

```go
// Command mytool does X.
//
// Usage:
//
//	mytool [flags] args
package main
```

```bash
go doc -cmd .     # show the command's package documentation
```

pkg.go.dev shows command docs the same way.

---

## 9. Trade-offs

| Choice | Pro | Con |
|--------|-----|-----|
| `go doc` in terminal | instant, no browser | plain text, no rendering |
| pkgsite locally | accurate HTML preview | needs install + a server |
| Relying on pkg.go.dev | zero setup, public | requires publishing/network |

---

## 10. Summary

`go doc` reads doc comments and prints package/type/function/method docs in the terminal; `-all` shows everything, `-src` shows source, `-u` includes unexported symbols. Address symbols as `pkg.Type.Method`. Write doc comments starting with the symbol name and add `ExampleXxx` tests (compiled, tested, shown). Preview HTML locally with `pkgsite` (modern) or `godoc` (legacy), matching what pkg.go.dev publishes.

---

## Further reading
- `go doc`: https://pkg.go.dev/cmd/doc
- Go doc comments (1.19+): https://go.dev/doc/comment
- pkgsite: https://pkg.go.dev/golang.org/x/pkgsite

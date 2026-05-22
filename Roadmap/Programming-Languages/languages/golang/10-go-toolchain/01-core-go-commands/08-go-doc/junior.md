# go doc — Junior

## 1. What does `go doc` do?

`go doc` **prints documentation for Go packages, types, functions, and methods** straight to your terminal — extracted from the comments in the source code. Instead of opening a browser, you read the docs where you work.

```bash
go doc fmt              # docs for the fmt package
go doc fmt.Println      # docs for one function
```

Go's philosophy: documentation lives next to the code as comments, and `go doc` surfaces it instantly.

---

## 2. Prerequisites
- Go 1.21+ (`go doc` ships with the toolchain).
- Knowing that doc comments are the comments directly above a declaration.

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Doc comment** | The comment immediately above a package/type/func declaration |
| **Exported** | A name starting with an uppercase letter (visible outside the package) |
| **Symbol** | A package-level name: a type, function, variable, or constant |
| **`-all`** | Show the full documentation for a package, not just the summary |
| **`-src`** | Show the source code of a symbol |
| **pkgsite** | The tool behind pkg.go.dev (HTML docs) |

---

## 4. Doc comments produce the docs

Documentation is just comments above declarations:

```go
// Package greet provides friendly greetings.
package greet

// Hello returns a greeting for name.
// If name is empty, it greets the world.
func Hello(name string) string {
	if name == "" {
		name = "world"
	}
	return "Hello, " + name
}
```

```bash
$ go doc greet.Hello
func Hello(name string) string
    Hello returns a greeting for name. If name is empty, it greets the world.
```

The comment becomes the documentation — no special syntax required.

---

## 5. The most common invocations

```bash
go doc fmt                 # package summary + exported symbols list
go doc fmt.Println         # one function's docs
go doc strings.Builder     # a type and its methods
go doc -all strings        # the FULL docs for the strings package
go doc .                   # docs for the package in the current directory
go doc                     # same as `go doc .`
```

Start with `go doc <pkg>` for an overview, then `go doc <pkg>.<Symbol>` to drill in.

---

## 6. `-all` for the complete picture

By default `go doc <pkg>` shows a summary (package comment + a list of exported symbols). Add `-all` to dump everything:

```bash
go doc -all errors         # every exported symbol with full docs
```

Pipe to a pager for long output:

```bash
go doc -all net/http | less
```

---

## 7. Looking at the source

`-src` shows the actual implementation:

```bash
go doc -src sort.Ints      # the source of sort.Ints
```

Great for quickly understanding *how* a standard-library function works, not just what it does.

---

## 8. Documenting your own code

When you write doc comments, follow the convention: start with the name being documented.

```go
// Add returns the sum of a and b.
func Add(a, b int) int { return a + b }

// Package mathutil offers small math helpers.
package mathutil
```

Then `go doc .` (in that directory) shows your docs exactly as users will see them. This is a great habit — write the comment, check it with `go doc`.

---

## 9. Common beginner mistakes

- **Documenting unexported symbols and expecting them shown.** `go doc` shows exported (uppercase) names by default; use `go doc -u` for unexported.
- **Wrong comment placement.** The doc comment must be *directly above* the declaration with no blank line.
- **Expecting Markdown rendering in the terminal.** `go doc` shows plain text; HTML rendering is pkg.go.dev's job.
- **Forgetting the package prefix.** It is `go doc strings.Builder`, not `go doc Builder`.

---

## 10. Summary

`go doc` prints documentation extracted from source comments: `go doc <pkg>` for a summary, `go doc <pkg>.<Symbol>` for a specific symbol, `-all` for everything, and `-src` for the implementation. Documentation is just comments placed directly above declarations, starting with the symbol's name. Write good doc comments and verify them with `go doc .`; for browsable HTML docs, that is what pkg.go.dev (pkgsite) provides.

---

## Further reading
- `go help doc`
- `go doc` command: https://pkg.go.dev/cmd/doc
- Go doc comments: https://go.dev/doc/comment

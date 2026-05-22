# gofmt / go fmt — Junior

## 1. What do these do?

Go has **one official code style**, and the tools enforce it automatically:

- **`gofmt`** — the formatter program. It reads Go source and rewrites it in the canonical style (indentation with tabs, spacing, alignment, import grouping).
- **`go fmt`** — a convenience wrapper that runs `gofmt -l -w` on the packages you name. It is the command you usually type.

```bash
go fmt ./...
```

This reformats every Go file in your module to the standard style and saves the changes.

The whole point: **you never argue about formatting in Go.** The tool decides, everyone agrees.

---

## 2. Prerequisites
- Go installed (`gofmt` ships with the toolchain).
- A Go source file with some messy formatting to clean up.

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **`gofmt`** | The formatter binary that ships with Go |
| **`go fmt`** | Wrapper that runs `gofmt -l -w` on packages |
| **Canonical style** | The single, official Go formatting Go enforces |
| **`-w`** | Write changes back to the file (instead of printing) |
| **`-l`** | List files whose formatting differs from canonical |
| **`-d`** | Show a diff of what would change |
| **gofumpt** | A stricter community formatter (superset of gofmt) |

---

## 4. The standard style in one example

Messy input:

```go
package main
import "fmt"
func main(){
x:=1
    y := 2
fmt.Println( x ,y )
}
```

After `gofmt`:

```go
package main

import "fmt"

func main() {
	x := 1
	y := 2
	fmt.Println(x, y)
}
```

Notice: tab indentation, a blank line after the package clause, normalized spacing, and aligned code. You did not choose any of this — the tool did.

---

## 5. The most common invocations

```bash
go fmt ./...                 # format every package in the module (writes changes)
gofmt -w main.go             # format one file, write changes back
gofmt -l ./...               # list files that are NOT formatted (no changes)
gofmt -d main.go             # show a diff of what would change
gofmt main.go                # print the formatted result to stdout (no write)
```

In daily work, most people let their **editor format on save** (gopls/the Go extension runs gofmt automatically), so they rarely type these by hand.

---

## 6. `go fmt` vs `gofmt`

| | `go fmt` | `gofmt` |
|--|---------|---------|
| Takes | package paths (`./...`) | files/dirs |
| Default action | writes changes (`-w`) | prints to stdout |
| Use | quick "format my packages" | precise control (`-l`, `-d`, `-w`) |

`go fmt ./...` is the friendly everyday command; `gofmt` gives you the `-l`/`-d`/`-w` knobs for scripts and CI.

---

## 7. When you use it

- **On every save** (via your editor) — the normal case.
- **Before committing** — `go fmt ./...` to be sure.
- **In CI** — `gofmt -l .` to *check* that everything is formatted (it lists offenders).

---

## 8. Checking formatting in CI (a first taste)

`gofmt -l` lists unformatted files and prints nothing if all are clean. CI uses that:

```bash
test -z "$(gofmt -l .)"     # exits non-zero if any file is unformatted
```

If the command lists files, the build fails — forcing contributors to format before merge.

---

## 9. Common beginner mistakes

- **Editing then forgetting to format.** Let your editor format on save, or run `go fmt ./...`.
- **Confusing `gofmt` (prints) with `gofmt -w` (writes).** Without `-w`, your file is unchanged.
- **Trying to configure the style.** You cannot — gofmt has no style options. That is the design.
- **Expecting `go fmt` to fix imports.** It groups/sorts imports but does not add or remove them; that is `goimports`'s job.

---

## 10. Summary

Go has one canonical style, and `gofmt` enforces it. Use `go fmt ./...` to format your packages, or `gofmt -l`/`-d`/`-w` for listing, diffing, and writing. Most developers format on save in their editor. There is nothing to configure — the consistency is the feature. For automatic import management, reach for `goimports`.

---

## Further reading
- `gofmt` docs: https://pkg.go.dev/cmd/gofmt
- "gofmt" blog post: https://go.dev/blog/gofmt
- Effective Go (formatting): https://go.dev/doc/effective_go#formatting

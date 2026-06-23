# goimports — Junior

## 1. What is `goimports`?

`goimports` is a Go source formatter that does everything `gofmt` does **and** automatically fixes your `import` block. It adds imports for packages you reference but did not import, removes imports you no longer use, and sorts the result into a tidy block. The output is always also valid `gofmt` output — `goimports` is a strict **superset** of `gofmt`.

Think of it as *"format my Go file and clean up my imports while you are at it."*

```bash
goimports -w main.go
```

This rewrites `main.go` in place, fixed imports included.

---

## 2. Installing it

It is not part of the Go distribution; you install it as a separate tool:

```bash
go install golang.org/x/tools/cmd/goimports@latest
```

This places a `goimports` binary in `$(go env GOBIN)` (or `$(go env GOPATH)/bin` if `GOBIN` is unset). Make sure that directory is on your `PATH`:

```bash
export PATH="$(go env GOPATH)/bin:$PATH"
goimports -h
```

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **`gofmt`** | The standard Go formatter (whitespace, braces, layout) |
| **`goimports`** | `gofmt` plus automatic import management |
| **Import block** | The `import (...)` statement at the top of a Go file |
| **Unused import** | An imported package that nothing in the file references — a compile error in Go |
| **Module cache** | Where downloaded module sources live (`$(go env GOMODCACHE)`) |
| **`-w` flag** | Write the formatted result back to the file (otherwise `goimports` prints to stdout) |
| **`-l` flag** | List files that would be reformatted, but do not change them |

---

## 4. A minimal worked example

Start with this broken file (`hello.go`):

```go
package main

import "os"

func main() {
    fmt.Println("hi", os.Args)
}
```

It does not compile — `fmt` is missing and `os` is fine. Run:

```bash
goimports -w hello.go
```

Result:

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    fmt.Println("hi", os.Args)
}
```

`goimports` saw `fmt.Println` and added the missing import. If you remove the call to `fmt.Println`, running it again will remove the now-unused `fmt` import.

---

## 5. The most common invocations

```bash
goimports -w main.go            # rewrite a single file
goimports -w .                  # rewrite every .go file under the current directory
goimports -d main.go            # show a diff instead of writing
goimports -l .                  # list files that would be changed (for CI)
goimports main.go               # print the formatted file to stdout
```

`-w .` is the form you will use most when cleaning up a whole package or project.

---

## 6. How is it different from `gofmt`?

`gofmt` does **not** touch your imports beyond sorting them. It will not add a missing import and it will not remove an unused one. So with `gofmt`:

```bash
gofmt -w hello.go     # still does not compile — fmt missing
```

With `goimports`:

```bash
goimports -w hello.go # adds the missing import, file now compiles
```

| Feature | `gofmt` | `goimports` |
|---------|---------|-------------|
| Whitespace, braces, layout | yes | yes |
| Sort imports | yes | yes |
| **Add missing imports** | no | yes |
| **Remove unused imports** | no | yes |
| Ship with Go | yes | no (install separately) |

If you use `goimports`, you do not also need to run `gofmt` — the output is gofmt-clean by construction.

---

## 7. Editor / IDE integration

Most editors run `goimports` automatically when you save a `.go` file. Set it up once and you will never think about imports again.

- **VS Code (Go extension):** `"go.formatTool": "goimports"` in `settings.json`. Save → file is formatted and imports fixed.
- **GoLand / IntelliJ:** Settings → Go → "On Save" → "Optimize imports" + "Reformat code" (uses `goimports` under the hood when configured).
- **Neovim with `gopls`:** the `gopls` language server exposes an `organizeImports` code action that does the same job; map it to run on save.

Running it on save is the standard developer workflow. Manual `goimports -w` is mostly for batch fixes or CI.

---

## 8. A common beginner mistake

Forgetting `-w`:

```bash
$ goimports main.go
# (formatted output prints to terminal, file is unchanged)
$ cat main.go
# still the old, unformatted version
```

Without `-w`, `goimports` writes to stdout. To actually change the file you need `-w` (write) or pipe the output back yourself (don't — use `-w`).

---

## 9. Summary

`goimports` is a strict superset of `gofmt` that also adds missing imports and removes unused ones. Install it with `go install golang.org/x/tools/cmd/goimports@latest`, run `goimports -w .` to fix a tree of files, and wire it into your editor's "format on save" so you never edit an import block by hand again.

---

## Further reading
- Tool source: https://pkg.go.dev/golang.org/x/tools/cmd/goimports
- `gofmt` reference: https://pkg.go.dev/cmd/gofmt
- `gopls` editor integration: https://pkg.go.dev/golang.org/x/tools/gopls

# Build Tags — Junior

## 1. What is a build tag?

A **build tag** (also called a **build constraint**) is a special comment that tells the Go tool **whether to compile a file** for the current build. If the constraint is true, the file is included; if it is false, the file is silently skipped — as if it did not exist in the directory.

```go
//go:build linux

package main
```

This file is compiled **only when building for Linux**. On macOS or Windows, the Go tool ignores it entirely. No errors, no warnings — just skipped.

Build tags are how Go supports the same package across multiple operating systems, architectures, and optional features (like `cgo`) without `#ifdef`s scattered through your code.

---

## 2. Prerequisites
- Go installed (`go version` ≥ 1.21).
- Comfort with `package main`, `go build`, `go run`.
- A directory with at least two `.go` files.

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Build tag / constraint** | A condition that decides whether the Go tool compiles a file |
| **`//go:build`** | The modern syntax (Go 1.17+) for build constraints |
| **`// +build`** | The legacy syntax (pre-Go 1.17), still recognized for compatibility |
| **File-name suffix** | A naming convention like `foo_linux.go` that adds an implicit constraint |
| **GOOS** | The target operating system (`linux`, `darwin`, `windows`, ...) |
| **GOARCH** | The target CPU architecture (`amd64`, `arm64`, `386`, ...) |
| **Custom tag** | A tag you invent and enable with `-tags=mytag` |

---

## 4. The two syntactic forms

### Modern form (`//go:build`, Go 1.17+)

```go
//go:build linux

package mypkg
```

### Legacy form (`// +build`, pre-Go 1.17)

```go
// +build linux

package mypkg
```

`gofmt` automatically adds the new `//go:build` line above any old `// +build` it sees, so you usually have both for a while during migration. The Go tool requires they **agree** if both are present.

For all new code use only `//go:build`. The legacy form is kept alive for old codebases.

---

## 5. Where the tag must appear

The constraint must be:

1. **Above the `package` clause** — not inside the package body.
2. Followed by a **blank line** before `package`.

```go
//go:build linux
                            <-- blank line REQUIRED
package mypkg
```

Without the blank line, the Go tool treats `//go:build linux` as an ordinary doc comment attached to the package — the constraint silently does nothing. This is the single most common beginner bug.

---

## 6. The file-name suffix form

You don't always need a `//go:build` line. If the file ends in a recognized OS or arch suffix, the constraint is implied by the file name:

| File name | Compiled when |
|-----------|---------------|
| `foo_linux.go` | `GOOS=linux` |
| `bar_amd64.go` | `GOARCH=amd64` |
| `baz_linux_amd64.go` | `GOOS=linux` AND `GOARCH=amd64` |
| `quux_windows_arm64.go` | `GOOS=windows` AND `GOARCH=arm64` |
| `helper_test.go` | only during `go test` |

The format is `name_GOOS.go`, `name_GOARCH.go`, or `name_GOOS_GOARCH.go`. The Go tool reads the last one or two underscore-separated segments and matches them against known values.

Beware: `foo_LINUX.go` is **not** a constraint — the suffix is case-sensitive lowercase.

---

## 7. A complete worked example

Two files implement the same function differently per OS:

```go
// notify_unix.go
//go:build linux || darwin

package main

import "fmt"

func notify(msg string) { fmt.Println("[unix notify]", msg) }
```

```go
// notify_windows.go
//go:build windows

package main

import "fmt"

func notify(msg string) { fmt.Println("[windows notify]", msg) }
```

```go
// main.go
package main

func main() { notify("hello") }
```

Build on macOS:

```bash
$ go build . && ./yourapp
[unix notify] hello
```

Build for Windows:

```bash
$ GOOS=windows GOARCH=amd64 go build .
```

`main.go` calls `notify` and the Go tool selects exactly one of the two implementations based on the target — no `if runtime.GOOS == ...` branches at runtime, no duplicated logic.

---

## 8. How `go build` selects files

When you run `go build` (or `go test`, `go run`, etc.), the tool:

1. Lists every `.go` file in the package directory.
2. For each file, checks: (a) the file-name suffix, then (b) the `//go:build` line if present.
3. Drops files whose constraints evaluate to **false** for the current `GOOS`/`GOARCH`/tags.
4. Compiles the rest as if the dropped files were not there.

The dropped files still have to **parse correctly** (the Go tool looks at the build constraint before the file body), but they are not type-checked or linked.

You can see exactly which files were chosen:

```bash
go list -f '{{.GoFiles}}' .
```

---

## 9. A common beginner mistake

```go
package main
//go:build linux        // WRONG: below the package clause — ignored
```

The constraint is parsed only **above** the package line. Place it at the very top of the file, with a blank line before `package`.

Another classic:

```go
//go:build linux
package main            // WRONG: no blank line — treated as a doc comment
```

Always: tag, blank line, then `package`.

---

## 10. Summary

A build tag is a comment that tells the Go tool whether to compile a file. The modern form is `//go:build linux` (Go 1.17+); the legacy `// +build linux` still works. Tags must sit above the `package` clause separated by a blank line. File-name suffixes (`foo_linux.go`, `bar_amd64.go`) imply the same kind of constraint without a `//go:build` line. Use them to ship per-OS implementations of the same function without runtime branching.

---

## Further reading
- `go help buildconstraint`
- Build constraints reference: https://pkg.go.dev/cmd/go#hdr-Build_constraints
- `go/build` package docs: https://pkg.go.dev/go/build

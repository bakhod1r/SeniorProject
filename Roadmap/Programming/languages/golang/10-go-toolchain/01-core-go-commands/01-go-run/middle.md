# go run — Middle

## 1. What `go run` really is

`go run` is `go build` to a temporary location, immediately followed by executing that binary, followed by deleting it. The compiled *packages* (your dependencies) are still cached in `GOCACHE`; only the final linked executable is temporary. That is why the second `go run` of an unchanged program is faster than the first — the package compilation is cached, only linking repeats.

This distinction matters: `go run` is not "interpreted Go." It is a full compile every time, just throwing away the artifact.

---

## 2. Specifying what to run

```bash
go run .                    # the main package in the current directory
go run ./cmd/server         # a main package by relative path
go run example.com/x/tool   # a main package by import path (built from modules)
go run main.go util.go      # explicit file list (all must be package main)
```

Rules to internalize:
- A file list and a package path are mutually exclusive.
- A file list must contain **all** files of the `main` package you need; it cannot pull in sibling files automatically.
- A package path uses the module graph and pulls in everything that package needs.

In day-to-day work, `go run .` and `go run ./cmd/...` are the idiomatic forms.

---

## 3. Build flags that apply to `go run`

`go run` accepts the same build flags as `go build`. Common ones:

```bash
go run -race .                          # enable the race detector
go run -tags=dev .                      # set build tags
go run -ldflags="-X main.version=1.2.3" .   # inject build-time variables
go run -gcflags="all=-N -l" .           # disable optimizations/inlining (debugging)
go run -mod=mod .                        # allow go.mod updates while running
go run -x .                              # print the underlying commands
```

These go **before** the package/file. Anything **after** is passed to your program.

---

## 4. The flag-ordering trap (in depth)

```bash
go run -race main.go -verbose
#       ^^^^^ build flag (to go)   ^^^^^^^^ program flag (to your code)
```

Once `go` sees the package or file argument, every remaining token is forwarded to your program untouched. If you accidentally write `go run main.go -race`, your program receives `-race` as an argument and the race detector is **not** enabled. A quick sanity check: `go run -race .` then trigger a known race and confirm the detector fires.

---

## 5. Injecting version info at run time

A realistic pattern for tools that report their version:

```go
package main

import "fmt"

var version = "dev"

func main() {
    fmt.Println("version:", version)
}
```

```bash
go run -ldflags="-X main.version=$(git describe --tags)" .
```

This is the same `-ldflags` mechanism you will use in `go build` for releases, so practicing it here pays off later.

---

## 6. `go run` in the development loop

Typical edit-run cycle:

```bash
# terminal 1: edit code in your editor
# terminal 2:
go run .            # run, read output, fix, repeat
```

For web servers, people often pair `go run` with a file watcher (e.g., `air`, `reflex`, or a simple `find | entr`) that re-invokes `go run .` on save. `go run` itself does not watch files; it runs once and exits.

Trade-off: `go run` recompiles and relinks on every invocation. For a small program this is sub-second; for a large one the link step adds up, and `go build` once + run the binary repeatedly can be faster during a tight loop.

---

## 7. Exit codes propagate

`go run` exits with **your program's** exit code, so it composes correctly in scripts:

```go
func main() {
    os.Exit(2)
}
```

```bash
go run . ; echo $?   # prints 2
```

If compilation fails, `go run` exits non-zero (typically 1) **before** your `main` ever runs — distinguishing a build failure from a runtime failure matters in CI.

---

## 8. Running remote tools without installing them

```bash
go run golang.org/x/tools/cmd/stringer@latest -type=Pin
```

With a version suffix (`@latest`, `@v0.1.0`), `go run` fetches and runs a tool in *module-aware* mode without adding it to your project's `go.mod` and without leaving a binary in `GOBIN`. This is handy for one-off code generation. (Without a version and outside a module you will get an error in modern Go.)

---

## 9. Trade-offs summary

| Concern | `go run` | `go build` + run binary |
|---------|----------|--------------------------|
| Convenience | One command | Two steps |
| Repeated runs | Recompiles/relinks each time | Compile once, run many |
| Leaves an artifact | No | Yes |
| Deployment | Not suitable | The standard |
| Debugging with a debugger | Awkward (temp binary) | Easy (stable path) |

---

## 10. Summary

`go run` is a compile-link-execute-delete cycle that shares the build cache with `go build`. Use `go run .` to include the whole `main` package; put build flags before the path and program arguments after it. It shines in the inner dev loop and for one-off tooling (especially with `@version` suffixes), but for repeated execution, debugging, or deployment, build a real binary.

---

## Further reading
- `go help run`, `go help build`
- Build flags reference: https://pkg.go.dev/cmd/go
- `-ldflags -X`: https://pkg.go.dev/cmd/link

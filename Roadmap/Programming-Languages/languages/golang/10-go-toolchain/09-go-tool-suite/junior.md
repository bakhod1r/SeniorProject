# go tool — Junior

## 1. What is `go tool`?

`go tool` is a **launcher** for a family of small executables that ship with the Go distribution. The `go` command you use every day (`go build`, `go test`, …) is one program; behind it sits a folder full of helper binaries — the compiler, the linker, the profile viewer, the trace viewer, the coverage analyzer, and so on. `go tool <name>` runs one of them.

You can think of `go tool` as a menu of "secondary" Go commands: the headline ones (`build`, `run`, `test`, `mod`) have their own top-level names, while the rest live under `go tool`.

```bash
go tool          # list everything available
```

---

## 2. Where do these tools live?

They are real binaries on disk, inside your Go installation:

```bash
ls "$(go env GOTOOLDIR)"
# /usr/local/go/pkg/tool/darwin_arm64/
# asm  buildid  cgo  compile  cover  dist  fix  link  nm  objdump
# pack  pprof  test2json  trace  ...
```

The directory is `$GOROOT/pkg/tool/<GOOS_GOARCH>/`. Each file in there is a standalone executable; `go tool <name>` simply finds it and runs it with whatever arguments you pass.

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **`$GOROOT`** | Where Go itself is installed |
| **`$GOTOOLDIR`** | The folder of helper binaries (`$GOROOT/pkg/tool/<OS_arch>`) |
| **Toolchain** | The compiler + linker + assembler + helpers bundled with Go |
| **Object/binary** | A compiled file (`.a` archive or final executable) |
| **Symbol** | A named entry in a binary (function, variable) |
| **Profile** | A recorded snapshot of CPU/memory/etc. usage |
| **Trace** | A timeline of goroutine and runtime events |

---

## 4. Listing what you have

With no arguments, `go tool` prints the available tools:

```bash
$ go tool
addr2line
asm
buildid
cgo
compile
covdata
cover
cpu
dist
distpack
doc
fix
fmt
link
nm
objdump
pack
pprof
test2json
trace
vet
```

The exact list depends on your Go version. New ones appear and old ones get removed over the years.

---

## 5. The ones you will use first

You do not need to learn all of them. Start with these:

| Tool | What you use it for |
|------|---------------------|
| `go tool pprof` | Open a CPU/memory profile and explore it |
| `go tool trace` | Open an execution trace in a browser |
| `go tool cover` | Turn `coverage.out` into a report |
| `go tool nm` | List the symbols inside a binary |
| `go tool objdump` | Disassemble a binary |
| `go tool addr2line` | Map an address to a source line |
| `go tool buildid` | Print the unique build ID of a binary |
| `go tool dist list` | List all supported `GOOS/GOARCH` pairs |

The other ones (`asm`, `compile`, `link`, `cgo`, `pack`, `fix`, `test2json`) are normally invoked **by** `go build` for you — you usually do not call them by hand.

---

## 6. A first demo: list the symbols in a binary

Build a tiny program and inspect it.

```go
// hello.go
package main

import "fmt"

func greet(name string) { fmt.Println("hi,", name) }

func main() { greet("world") }
```

```bash
go build -o hello hello.go
go tool nm hello | grep main.greet
# 00000000010a1234 T main.greet
```

`nm` lists every symbol in the binary. `T` means a text (code) symbol. You just saw your own function inside the compiled executable.

---

## 7. A first profile

Profiling is the most common reason a beginner reaches for `go tool`:

```bash
go test -cpuprofile=cpu.out -bench=.
go tool pprof cpu.out
# (pprof) top
# (pprof) web    # opens a graph in your browser (needs Graphviz)
```

The exact same `go tool pprof` opens memory profiles, block profiles, and pprof endpoints from a running HTTP server.

---

## 8. A first trace

```bash
go test -trace=trace.out -run=TestSomething
go tool trace trace.out
# opens http://127.0.0.1:NNNN/ in your browser
```

You get a visual timeline of every goroutine — invaluable for spotting blocked goroutines or scheduler issues later on.

---

## 9. Listing supported targets

```bash
go tool dist list | head
# aix/ppc64
# android/386
# android/amd64
# android/arm
# android/arm64
# darwin/amd64
# darwin/arm64
# ...
```

These are the `GOOS/GOARCH` pairs your installed toolchain can cross-compile to.

---

## 10. Checking the identity of a binary

Every Go binary has a **build ID** — a unique fingerprint of its inputs:

```bash
go tool buildid hello
# Lz3a...long-hash...QrUe/...
```

Two binaries with the same build ID were produced from identical inputs.

---

## 11. Common mistake: tool not found

```bash
$ go tool foo
go: no such tool "foo"
```

Either you typoed the name or the tool does not exist in your Go version (some are removed across releases, e.g., `vet` moved into the compiler distribution and is now run via `go vet`, not `go tool vet`).

---

## 12. Summary

`go tool` is a launcher for the helper binaries that live in `$GOROOT/pkg/tool/<OS_arch>/`. Run `go tool` alone to list them. As a junior, learn the user-facing ones: `pprof`, `trace`, `cover`, `nm`, `objdump`, `addr2line`, `buildid`, `dist list`. The lower-level ones (`compile`, `link`, `asm`, `cgo`, `pack`) are normally driven for you by `go build`.

---

## Further reading
- `go help tool`
- `cmd/go` documentation: https://pkg.go.dev/cmd/go
- `cmd/` source tree: https://github.com/golang/go/tree/master/src/cmd

# Cross-compilation — Junior

## 1. What is cross-compilation?

**Cross-compilation** means producing an executable for one operating system or CPU architecture while building on a different one. For example, on your macOS laptop you can build a binary that runs on a Linux server, without ever installing Linux.

Most languages need a separate toolchain or SDK per target. Go bakes cross-compilation into the standard distribution: a single `go` install can produce binaries for dozens of target platforms out of the box, for pure-Go programs.

```bash
# On macOS, build a Linux/amd64 binary
GOOS=linux GOARCH=amd64 go build -o app .
```

The result, `app`, is a Linux ELF binary you can `scp` to a server and run.

---

## 2. Prerequisites
- Go 1.21+ installed (`go version`).
- A `main` package you can build with `go build .`.
- Basic familiarity with environment variables in your shell.

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Host** | The machine you build on |
| **Target** | The OS/architecture the binary will run on |
| **GOOS** | Target operating system (`linux`, `darwin`, `windows`, ...) |
| **GOARCH** | Target CPU architecture (`amd64`, `arm64`, `386`, ...) |
| **Pure Go** | A program with no `import "C"` (no cgo) |
| **cgo** | The mechanism that lets Go call C code |
| **ELF / PE / Mach-O** | Binary formats for Linux / Windows / macOS |

---

## 4. The two switches that matter

Two environment variables control the target:

```bash
GOOS=<os>     # the operating system
GOARCH=<arch> # the CPU architecture
```

You set them for one command:

```bash
GOOS=linux GOARCH=arm64 go build -o app .
```

Or export them for a whole shell session:

```bash
export GOOS=linux
export GOARCH=amd64
go build -o app .
```

Without these, `go build` produces a binary for your host (`runtime.GOOS` / `runtime.GOARCH`).

---

## 5. Listing the supported targets

Ask the toolchain what it can build for:

```bash
go tool dist list
```

You get pairs like:

```
aix/ppc64
android/amd64
darwin/amd64
darwin/arm64
linux/386
linux/amd64
linux/arm
linux/arm64
windows/386
windows/amd64
windows/arm64
js/wasm
wasip1/wasm
...
```

Each line is a valid `GOOS/GOARCH` combination.

---

## 6. A worked example — build for Linux from any host

A tiny program:

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    fmt.Printf("hello from %s/%s\n", runtime.GOOS, runtime.GOARCH)
}
```

Build for Linux/amd64:

```bash
GOOS=linux GOARCH=amd64 go build -o app-linux-amd64 .
file app-linux-amd64
# app-linux-amd64: ELF 64-bit LSB executable, x86-64, ...
```

The `file` command confirms the binary is an ELF executable for x86-64 Linux, even though you built it on macOS.

---

## 7. Building for Windows

```bash
GOOS=windows GOARCH=amd64 go build -o app.exe .
```

Notice the `.exe` suffix — Windows expects it. The output is a PE/COFF binary.

```bash
file app.exe
# app.exe: PE32+ executable (console) x86-64, for MS Windows
```

You can copy `app.exe` to a Windows machine and run it directly.

---

## 8. Why this "just works"

For **pure-Go** programs the toolchain ships its own compiler, assembler, and linker for every supported target — no external C compiler is needed. The standard library has per-platform implementations (e.g., system calls), and the build system picks the right ones automatically based on `GOOS` and `GOARCH`.

The moment you import a C library through cgo, this stops being trivial: cgo cross-compilation needs a C cross-toolchain. As a junior you usually do not have cgo dependencies, so pure-Go cross-builds are your default world.

---

## 9. Common mistake — running the cross-built binary locally

```bash
$ GOOS=linux GOARCH=amd64 go build -o app .
$ ./app
zsh: exec format error: ./app
```

That is not a bug. You built a Linux binary; your macOS kernel cannot run it. Copy it to a Linux host (or run it inside a container) and it works.

---

## 10. Summary

Cross-compilation lets one machine build binaries for other operating systems and architectures. In Go you do it by setting `GOOS` and `GOARCH` before `go build`. The list of valid targets comes from `go tool dist list`. For pure-Go code, nothing else is required — no SDK, no extra toolchain. The cross-built binary runs on the **target**, not on your host.

---

## Further reading
- `go help build`, `go help environment`
- `go tool dist list` — supported targets
- `cmd/go` documentation: https://pkg.go.dev/cmd/go
- Installing Go: https://go.dev/doc/install

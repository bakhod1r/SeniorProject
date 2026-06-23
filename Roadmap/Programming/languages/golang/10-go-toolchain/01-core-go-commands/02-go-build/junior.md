# go build — Junior

## 1. What does `go build` do?

`go build` **compiles** your Go code into a native executable (or just type-checks a library) and, for a `main` package, **writes the binary to disk**. Unlike `go run`, the executable stays — you can run it as many times as you like without recompiling.

```bash
go build
```

In a `main` package, this produces an executable named after your module/directory in the current folder.

Think of `go build` as *"turn my source into a program I can keep and ship."*

---

## 2. Prerequisites
- Go installed (`go version` → 1.21+).
- A module initialized with `go mod init` (so Go knows your import path).
- A `package main` with `func main()` to get an executable.

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Compile** | Translate source into machine code |
| **Executable / binary** | The runnable program produced for `package main` |
| **Library package** | A non-`main` package; `go build` checks it but writes no binary |
| **Output path** (`-o`) | Where to write the executable |
| **Build cache** | Stored compiled packages, reused to speed up builds |
| **Module** | A collection of Go packages defined by a `go.mod` file |
| **Cross-compile** | Build for a different OS/CPU than your own |

---

## 4. A minimal worked example

```bash
mkdir hello && cd hello
go mod init example.com/hello
```

Create `main.go`:

```go
package main

import "fmt"

func main() {
    fmt.Println("Hello, build!")
}
```

Build and run:

```bash
go build          # produces ./hello (named after the directory/module)
./hello           # Hello, build!
```

The `hello` executable now exists on disk; running it does not recompile anything.

---

## 5. The most common invocations

```bash
go build                 # build the package in the current directory
go build .               # same thing, explicit
go build ./...           # build (type-check) every package in the module
go build -o app .        # write the binary to "app" instead of the default name
go build ./cmd/server    # build a specific main package
```

`-o` is the flag you will use most: it controls the output file name and location.

```bash
go build -o bin/myapp ./cmd/myapp
```

---

## 6. `go build` vs `go run`

| | `go build` | `go run` |
|--|-----------|----------|
| Leaves a binary | Yes | No (temporary) |
| Best for | Shipping, repeated runs | Quick one-off runs |
| Recompiles each run | No (run the file) | Yes |
| Used in deployment | Yes | No |

Use `go build` when you want a real, reusable program. Use `go run` for quick experiments.

---

## 7. Building libraries

If your package is **not** `main`, `go build` compiles and checks it but writes no file — it just confirms the code compiles:

```bash
$ go build ./internal/math
# no output, no file, exit 0 means it compiled cleanly
```

This is a fast way to check that your library code compiles without running anything.

---

## 8. A quick taste of cross-compiling

Go can build for other platforms by setting two environment variables:

```bash
GOOS=linux GOARCH=amd64 go build -o app-linux .
GOOS=windows GOARCH=amd64 go build -o app.exe .
```

No special toolchain needed for pure-Go programs — this is one of Go's superpowers. You will use this when you develop on a Mac but deploy to Linux.

---

## 9. Common beginner mistakes

- **Forgetting `go mod init`.** Without a module, builds can fail or behave oddly. Initialize first.
- **Expecting a binary from a library package.** Only `package main` produces an executable.
- **Confusing `-o` placement.** `-o` is a build flag, so it comes before the package: `go build -o app .`, not `go build . -o app`.
- **Building one file in a multi-file package.** Use `go build .` (the package), not `go build main.go`, so all files are included.

---

## 10. Summary

`go build` compiles your code: for a `main` package it writes a reusable executable to disk; for a library it just type-checks. Use `-o` to name the output, `./...` to build everything, and `GOOS`/`GOARCH` to cross-compile. It is the command you reach for whenever you want a real program to keep, run repeatedly, or ship.

---

## Further reading
- `go help build`
- cmd/go documentation: https://pkg.go.dev/cmd/go
- Cross-compilation overview: https://go.dev/wiki/WindowsCrossCompiling

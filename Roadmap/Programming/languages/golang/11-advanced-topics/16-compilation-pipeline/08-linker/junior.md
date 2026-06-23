# The Linker — Junior

You wrote `package main`, ran `go build`, and got a single file you can run.
The **linker** is the last stage of that journey: it takes all the compiled
pieces and glues them into one executable. This page explains what it does in
plain terms and shows you two tricks you'll use forever: **stripping** a binary
to make it smaller, and **stamping a version** into it at build time.

---

## 1. What a linker actually does

The Go compiler does not produce an executable. It produces **object files**
(one per package, with the `.o` / `.a` extension internally). Each object file
is incomplete: it references functions and variables that live in *other*
packages. For example your `main.main` calls `fmt.Println`, but the code for
`fmt.Println` lives in a different object file.

The linker's job is to:

1. **Load** every object file and archive your program needs.
2. **Resolve symbols** — connect "I call `fmt.Println`" to "here is the actual
   machine code for `fmt.Println`."
3. **Throw away** everything that's never used (dead-code elimination).
4. **Lay out** the surviving code and data into one file with the right format
   for your operating system.
5. **Write** that file to disk — your executable.

```
  compiler           linker
  --------           ------
  main.go  → main.o  ─┐
  fmt/*.go → fmt.a    ├─►  cmd/link  ─►  ./myapp  (one runnable file)
  runtime  → runtime.a┘
```

In Go this linker is `cmd/link`, part of the Go toolchain itself. You almost
never run it by hand — `go build` calls it for you. But you *can*:
`go tool link`.

---

## 2. Internal vs external linking (the simple version)

There are two ways Go can produce the final binary:

| Mode | Who does the linking | When it's used |
| --- | --- | --- |
| **Internal** (default) | Go's own linker (`cmd/link`) | Pure-Go programs |
| **External** | The system linker (`ld`/`clang`) | When you use **cgo**, or certain build modes |

By default Go uses **internal linking** — it does *not* call the system `ld`.
This is why a pure-Go program builds the same on a machine with no C toolchain
installed. The moment you import C code (cgo), Go must hand off to the system
linker because only it knows how to link the C object files. We'll go deeper in
later tiers; for now just remember: **pure Go = internal, cgo = usually
external**.

---

## 3. Strip a binary and watch it shrink

A normal Go binary carries extra baggage: a **symbol table** (names of all your
functions) and **DWARF** debug information (so debuggers can map machine code
back to source lines). You don't need either to *run* the program — only to
debug it.

`-ldflags` lets you pass options to the linker. Two flags strip the fat:

- `-s` — omit the **symbol table** and debug info.
- `-w` — omit the **DWARF** debug info specifically.

```bash
# Build normally
go build -o app-full ./...

# Build stripped
go build -ldflags="-s -w" -o app-stripped ./...

# Compare sizes
ls -lh app-full app-stripped
```

Typical result: the stripped binary is often **20–30% smaller**.

```
-rwxr-xr-x  6.9M  app-full
-rwxr-xr-x  4.9M  app-stripped
```

The tradeoff: stripped binaries are harder to debug, and stack traces lose some
detail (we'll cover exactly what survives in the middle/senior tiers — the
function-name table for panics is *separate* and usually still there).

---

## 4. Stamp a version into the binary with `-X`

You want `myapp --version` to print the exact git commit it was built from —
without editing source each time. The `-X` linker flag sets a **string
variable** at link time.

First, declare a package-level string variable (it must be a `var`, must be a
`string`, and must be left unset or set to a default):

```go
package main

import "fmt"

// Set at build time via -ldflags "-X main.version=..."
var version = "dev"

func main() {
    fmt.Println("version:", version)
}
```

Then build with `-X importpath.name=value`:

```bash
go build -ldflags="-X main.version=1.4.2" -o app ./...
./app
# version: 1.4.2
```

Real pipelines pull the value from git:

```bash
VER=$(git describe --tags --always)
go build -ldflags="-X main.version=$VER" -o app ./...
```

You can combine flags. Quote the whole thing:

```bash
go build -ldflags="-s -w -X main.version=1.4.2" -o app ./...
```

---

## 5. Common misconceptions

- **"Go uses the system linker like C does."** No — by default Go has its *own*
  linker and does not need `ld`. Only cgo/some build modes pull in the system
  linker.
- **"`-X` can set any variable."** It only sets **package-level `string`
  variables**. You can't set an `int`, a `bool`, or a local variable. (Convert
  later in code if you need a number.)
- **"`-X main.Version` works for any file."** The path must be the **import
  path** of the package, not the filename. For `package main` in your module
  it's usually `main.Version`; for a sub-package it's
  `github.com/you/app/build.Version`.
- **"`-s -w` breaks panics / stack traces."** Stack traces with function names
  still work after `-s -w`, because Go keeps a separate function table
  (`.gopclntab`). What you lose is full *debugger* support (DWARF) and the
  classic symbol table used by some external tools.
- **"Stripping makes it run faster."** It only makes the *file* smaller. Runtime
  speed is unchanged.

---

## 6. Things to do today

1. Build any program twice — once normally, once with `-ldflags="-s -w"` — and
   record the size difference with `ls -lh`.
2. Add a `var version = "dev"` to a tiny `main.go` and stamp it with
   `-X main.version=$(git describe --tags --always)`.
3. Run `go tool nm app | head` on an unstripped binary to *see* the symbol
   names the linker produced.
4. Build the *same* program with `-ldflags="-s -w"` and run `go tool nm` again —
   watch most symbols disappear.
5. Run `go version -m ./app` to see the build info the linker embedded
   (module versions, build flags).

---

## 7. Summary

- The **linker** (`cmd/link`) is the final build stage: it loads object files,
  resolves symbols, drops dead code, lays out sections, and writes the
  OS-native executable.
- Go uses **internal linking** by default (its own linker, no system `ld`);
  **cgo** and some build modes switch to **external linking**.
- `-ldflags="-s -w"` strips the symbol table and DWARF to shrink the binary.
- `-ldflags="-X importpath.name=value"` sets a package-level **string** variable
  at link time — the standard way to stamp versions.
- Inspect results with `go tool nm` and `go version -m`.

---

## Further reading

- [`cmd/link` command documentation](https://pkg.go.dev/cmd/link)
- [`go build` and `-ldflags`](https://pkg.go.dev/cmd/go#hdr-Compile_packages_and_dependencies)
- [How to set version at build time (Go wiki / blog patterns)](https://www.digitalocean.com/community/tutorials/using-ldflags-to-set-version-information-for-go-applications)
- [`go tool nm` reference](https://pkg.go.dev/cmd/nm)

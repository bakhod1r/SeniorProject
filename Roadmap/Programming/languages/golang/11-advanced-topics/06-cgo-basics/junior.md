# cgo Basics — Junior

## 1. What cgo is

cgo is the Go tool that lets you call C code from Go (and vice versa). When you have a C library that does something Go doesn't — image codecs, cryptographic primitives, hardware drivers — cgo is the bridge.

Most Go programs don't need cgo. Reach for it only when:

- You depend on an existing C library and a pure-Go rewrite is impractical.
- You need a syscall or platform feature Go doesn't expose directly.
- You're squeezing every nanosecond out of a hot loop (rare, usually solved differently).

---

## 2. A first cgo program

```go
package main

/*
#include <stdio.h>

void greet(const char* name) {
    printf("Hello, %s!\n", name);
}
*/
import "C"

import "unsafe"

func main() {
    name := C.CString("World")
    defer C.free(unsafe.Pointer(name))
    C.greet(name)
}
```

What's happening:

- The block comment above `import "C"` is C source code.
- `C.greet`, `C.CString`, `C.free` are exposed by cgo automatically.
- Strings must be converted: Go strings aren't NUL-terminated; C strings are.

Run with `go run main.go`. You need a C compiler installed (`gcc` or `clang`).

---

## 3. The two halves of a cgo file

```go
package mypkg

/*
   // C preamble: declarations, #include, static helpers
*/
import "C"

// Go code: uses C.* identifiers
```

The preamble is C; the rest is Go. They share the file but compile separately.

---

## 4. Converting strings

```go
// Go string → C char*
cs := C.CString("hello")
defer C.free(unsafe.Pointer(cs))

// C char* → Go string
gs := C.GoString(cs)
```

`CString` allocates memory using C's `malloc`. You must `free` it when done. Forgetting this is a memory leak.

---

## 5. Type names

C types are accessed as `C.<type>`:

- `C.int`, `C.long`, `C.double`
- `C.char` for `char`
- `*C.char` for `char*`
- `unsafe.Pointer` for `void*`
- `C.struct_foo` for `struct foo`

Often you'll need explicit conversions:

```go
n := 42
C.someFunc(C.int(n))   // convert Go int to C int
```

---

## 6. Building flags

You can pass flags to the C compiler and linker via special comments:

```go
// #cgo CFLAGS: -I/usr/local/include
// #cgo LDFLAGS: -L/usr/local/lib -lcurl
import "C"
```

The CFLAGS go to the C compiler; LDFLAGS go to the linker. Without these, your C code might not find the library it depends on.

---

## 7. A real example: calling SQLite

```go
package main

/*
#cgo LDFLAGS: -lsqlite3
#include <sqlite3.h>
#include <stdlib.h>
*/
import "C"
import "unsafe"

func main() {
    var db *C.sqlite3
    cpath := C.CString("test.db")
    defer C.free(unsafe.Pointer(cpath))
    C.sqlite3_open(cpath, &db)
    defer C.sqlite3_close(db)
}
```

This compiles only if `sqlite3.h` is on your include path and `libsqlite3` is linkable. Most Linux distros: `apt install libsqlite3-dev`. macOS: `brew install sqlite`.

(In practice, use a Go package like `mattn/go-sqlite3` rather than rolling your own.)

---

## 8. Pitfalls

- **Forgetting to free.** Every `C.CString` needs a `C.free`. Otherwise: leak.
- **Passing Go pointers into C.** Rules forbid retaining Go pointers in C. Convert via `unsafe.Pointer` carefully.
- **Cross-compilation gets hard.** You'd need a cross C compiler.
- **Build time explodes.** Cgo files compile much slower than pure Go.
- **Static binaries trickier.** Cgo links against libc by default.

---

## 9. When to avoid cgo

- The pure-Go alternative is good enough (performance test first).
- You need to distribute statically linked binaries.
- You need easy cross-compilation.
- You want to use the race detector or pgo (cgo makes both harder).

---

## 10. Summary

cgo lets Go call C functions, with a few rituals: a C preamble in a block comment, `import "C"`, type and string conversions, and explicit memory management for C-allocated buffers. It's a bridge for specific needs — a C library, a syscall — not a general optimization technique.

---

## Further reading
- `cmd/cgo`: https://pkg.go.dev/cmd/cgo
- "C? Go? Cgo!": https://go.dev/blog/cgo

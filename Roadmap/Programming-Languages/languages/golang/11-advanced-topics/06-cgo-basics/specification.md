# cgo Basics — Specification

> **Focus:** Precise reference for `cgo` — the Go tool that lets Go packages call C code (and vice versa) — including its syntax, conventions, type mapping, memory rules, and build interactions.
>
> **Sources:**
> - `cmd/cgo` documentation: https://pkg.go.dev/cmd/cgo
> - Go spec doesn't define cgo; the rules live in the cmd/cgo doc and runtime
> - `runtime/cgo`: https://pkg.go.dev/runtime/cgo

---

## 1. What `cgo` is

`cgo` is a tool that processes Go source files containing C code embedded in a special `import "C"` block. It generates wrapper code so Go can call C functions, read C types, and (with care) let C call Go functions.

A file using cgo looks like:

```go
package mypkg

/*
#include <stdio.h>

static void greet(const char* name) {
    printf("Hello, %s!\n", name);
}
*/
import "C"

func Greet(name string) {
    cstr := C.CString(name)
    defer C.free(unsafe.Pointer(cstr))
    C.greet(cstr)
}
```

---

## 2. The `import "C"` magic

`import "C"` is not a regular import. It's a directive to `cgo`. The block comment immediately above (no blank lines between) is C source — preprocessed as C and exposed via the `C.*` namespace in Go.

The `import "C"` line **must**:

- Appear in a file that includes only the C preamble immediately above it.
- Not have any other imports on the same line (no `import ("a"; "C")`).
- Not appear if you only want to use Go.

---

## 3. The preamble

Everything in the block comment before `import "C"` is a C preamble:

- Includes (`#include <...>`).
- Static functions (preferred way to bridge complex calls).
- Macros, typedefs, declarations.

Restrictions:

- The preamble is compiled by the C compiler, not by Go.
- It must produce no executable code at file scope (only declarations).
- Use `static` for helper functions to avoid symbol clashes.

---

## 4. Cgo directives

In comments before the `import "C"`:

```go
// #cgo CFLAGS: -I/usr/local/include
// #cgo LDFLAGS: -L/usr/local/lib -lfoo
// #cgo linux CFLAGS: -DLINUX_BUILD
// #cgo darwin LDFLAGS: -framework CoreServices
// #cgo pkg-config: openssl libcurl
```

| Directive | Meaning |
|-----------|---------|
| `CFLAGS` | C compiler flags |
| `CPPFLAGS` | C preprocessor flags |
| `CXXFLAGS` | C++ compiler flags (for `import "C"` files with C++) |
| `FFLAGS` | Fortran flags (rarely used) |
| `LDFLAGS` | Linker flags |
| `pkg-config` | Resolve flags via `pkg-config` |

Prefix with platform tags (`linux`, `darwin`, etc.) for OS-specific flags.

---

## 5. Type mapping

| C | Go |
|---|----|
| `int`, `unsigned int` | `C.int`, `C.uint` |
| `long`, `unsigned long` | `C.long`, `C.ulong` |
| `long long` | `C.longlong` |
| `float`, `double` | `C.float`, `C.double` |
| `char` | `C.char` (signedness platform-dependent) |
| `signed char`, `unsigned char` | `C.schar`, `C.uchar` |
| `size_t` | `C.size_t` |
| `void*` | `unsafe.Pointer` |
| `char*` | `*C.char` (use `C.CString` to convert from Go string) |
| `struct foo` | `C.struct_foo` |
| `enum foo` | `C.enum_foo` |
| `typedef T` | `C.T` |

`int`, `long`, `void*`, `size_t` sizes vary by platform — use `unsafe.Sizeof(C.int(0))` to check.

---

## 6. String conversion

```go
// Go string → C char*
cs := C.CString("hello")
defer C.free(unsafe.Pointer(cs))   // CString allocates with C malloc

// C char* → Go string
gs := C.GoString(cs)               // copies bytes into Go memory

// C bytes with explicit length
gb := C.GoBytes(unsafe.Pointer(cs), C.int(5))   // []byte
```

Rules:

- `C.CString` allocates in C heap; you must `C.free`.
- `C.GoString` copies; the result is independent of the C buffer.
- Don't pass Go strings directly to C — strings aren't NUL-terminated.

---

## 7. Memory ownership rules

The single most important cgo concept:

> **Go pointers passed to C must not be retained by C past the call's return, and must not point at memory that contains other Go pointers.**

The runtime checks this at runtime; violations panic with `cgo argument has Go pointer to Go pointer`.

Practical consequences:

- A `[]int` (no internal pointers) can be passed to C for the duration of a call.
- A `[]*Foo` (contains pointers) cannot.
- C cannot store a Go pointer in a global or pass it to another thread.
- C-allocated memory (`malloc`) is owned by C; you `C.free`.
- Go-allocated memory is owned by Go; the GC manages it.

---

## 8. The Go runtime and cgo calls

Every cgo call:

1. Switches to a system-OS-thread stack (Go uses small movable stacks; C needs a real one).
2. Saves goroutine state.
3. Calls the C function.
4. Restores state and returns.

Cost: ~100–200 ns per call on modern hardware. Tight loops calling small C functions are usually faster done in pure Go.

`runtime.LockOSThread` is sometimes required when the C library has thread-local state (e.g., GUI libraries).

---

## 9. C calling Go

Export a Go function with `//export`:

```go
//export Multiply
func Multiply(a, b C.int) C.int {
    return a * b
}
```

Plus a `cgo_main.go` (or use `c-shared` build mode) to create a shared library or archive that C can link against.

```bash
go build -buildmode=c-archive -o libmath.a .
go build -buildmode=c-shared -o libmath.so .
```

The resulting `.a` or `.so` plus a generated `.h` exposes the Go function as a C symbol.

---

## 10. `runtime.LockOSThread`

```go
runtime.LockOSThread()
defer runtime.UnlockOSThread()
// call C library that uses thread-local state
```

Locks the current goroutine to a specific OS thread until `UnlockOSThread`. Required for:

- OpenGL / GUI toolkits (must run on the same thread for the lifetime of the context).
- Libraries that store thread-local state.
- Signal handling that needs a specific thread.

Without it, cgo calls may execute on different OS threads across calls.

---

## 11. `runtime.cgocall` and goroutine scheduling

When a goroutine enters a cgo call, the Go scheduler:

- Tracks the goroutine as "blocked in C".
- The associated `M` (OS thread) is dedicated to C until the call returns.
- New goroutines can be scheduled onto other `M`s.

If the C call blocks for a long time, that `M` is unavailable for Go work. The runtime can spawn additional `M`s up to `GOMAXPROCS+N` to keep scheduling alive, but long blocking cgo calls hurt throughput.

---

## 12. Build interactions

| Var | Effect |
|-----|--------|
| `CGO_ENABLED=0` | Disable cgo entirely; falls back to pure-Go implementations of stdlib pieces |
| `CGO_ENABLED=1` | Enable cgo (default when a C compiler is present) |
| `CC` | C compiler to use (default `gcc`/`clang`) |
| `CGO_CFLAGS`, `CGO_LDFLAGS` | Override flags |
| `CGO_CFLAGS_ALLOW`, `CGO_LDFLAGS_ALLOW` | Allow flags otherwise rejected for security |

Cross-compilation with cgo requires a cross-compiler toolchain. Often easier to set `CGO_ENABLED=0` for cross-builds.

---

## 13. Cgo and the Go modules cache

The C preamble's `#include` paths are resolved by the C compiler, not the Go module system. Headers must be available at compile time on the local machine. This is one reason cgo is harder to reproduce across builds — environment matters.

---

## 14. Limits

- Cgo calls have ~100 ns overhead each.
- Cgo objects are not visible to the Go GC.
- Cgo cannot easily share complex data structures with Go (no pointer-to-Go-pointer).
- Cgo files require a C toolchain.
- Cross-compilation is harder with cgo.

---

## 15. Related references

- `cmd/cgo`: https://pkg.go.dev/cmd/cgo
- Cgo documentation: https://go.dev/blog/cgo
- "C? Go? Cgo!" tutorial: https://go.dev/blog/cgo
- `unsafe` package: [04-unsafe-package](../04-unsafe-package/)

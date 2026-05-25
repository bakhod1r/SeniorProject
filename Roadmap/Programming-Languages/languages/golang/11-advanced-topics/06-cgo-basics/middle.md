# cgo Basics — Middle

## 1. The cgo build pipeline

When you `go build` a cgo-using package:

1. `cgo` parses the file, extracts the C preamble, and generates two artifacts:
   - A Go file with stub functions that call into C.
   - A C file with wrapper functions matching those stubs.
2. The Go compiler compiles the Go portion.
3. The C compiler (`gcc`/`clang`) compiles the C portion.
4. The linker combines them into a single binary.

The C compiler invocation is what fails if `CGO_ENABLED=0`, if the toolchain is missing, or if headers aren't found.

---

## 2. Type-mapping nuances

```go
var i C.int = 42
var l C.long = 100
var ll C.longlong = 1 << 40
```

Sizes vary:

- `C.int` is 32 bits on most modern platforms but 16 on some embedded targets.
- `C.long` is 64 bits on Linux/64-bit but 32 on Windows/64-bit (LLP64).
- `C.size_t` follows `sizeof(size_t)` — usually pointer-sized.

For portable code, use the explicit C99 types (`int32_t`, `uint64_t`) and bind those:

```c
#include <stdint.h>
int32_t my_func(int32_t x);
```

```go
C.my_func(C.int32_t(x))
```

---

## 3. Calling a C function with a struct argument

```go
/*
typedef struct {
    int x;
    int y;
} point;

int distance(point* a, point* b);
*/
import "C"

a := C.point{x: 1, y: 2}
b := C.point{x: 4, y: 6}
d := C.distance(&a, &b)
```

You can construct `C.<struct>` values directly with named fields. Taking `&` of them gives a `*C.point` pointer C can use.

---

## 4. Pointer rules (the cardinal cgo law)

```
Go pointers passed to C must not be retained by C past the call's return,
and the memory they point at must not contain other Go pointers.
```

Violations cause a runtime panic: `runtime error: cgo argument has Go pointer to Go pointer`.

Allowed:

- `[]int` (no internal pointers): OK to pass for the duration of a call.
- `*C.char` returned by `C.CString` (C-owned): OK to pass anywhere.
- `*MyStruct` where `MyStruct` has no pointer fields: OK to pass for the call.

Not allowed:

- `*MyStruct` where the struct contains slices, maps, or other pointers.
- Storing a Go pointer in a C global.
- Passing a Go pointer to a thread C will use later.

---

## 5. Converting between Go and C memory

| Direction | Function | Notes |
|-----------|----------|-------|
| Go string → C string | `C.CString(s)` | Allocates with C malloc; you must free |
| Go []byte → C buffer | Pass `&b[0]`, `C.size_t(len(b))` | Memory borrowed for call duration |
| C string → Go string | `C.GoString(p)` | Copies; result is independent |
| C string with length → Go string | `C.GoStringN(p, n)` | When C string isn't NUL-terminated |
| C buffer → Go []byte | `C.GoBytes(p, n)` | Copies n bytes |

`unsafe.Slice` (Go 1.20+) lets you alias C memory as a Go slice without copy, but the slice must be treated as borrowed.

---

## 6. The cgo call cost

Every cgo call costs ~100 ns on modern hardware:

- Switch from Go stack to OS-thread stack.
- Save/restore registers and goroutine state.
- Invoke the C function.

Implications:

- A tight loop of `C.f()` is slow; batch the work into a single C call.
- A C library called once per request is fine.
- A C library called per element of a slice is rarely worth it.

---

## 7. Goroutines and cgo

When a goroutine enters a C call:

- The scheduler marks the goroutine as blocked-in-C.
- The OS thread is dedicated to C until the call returns.
- Other goroutines can run on other threads.

If many goroutines are simultaneously in long C calls, the scheduler spawns extra OS threads (up to a runtime-managed limit) to keep Go work flowing.

For C code that blocks for seconds (e.g., a slow ioctl), you may exhaust your thread budget. Consider running such code on a dedicated worker goroutine with a bounded queue.

---

## 8. `runtime.LockOSThread`

```go
runtime.LockOSThread()
defer runtime.UnlockOSThread()
// call C that requires thread-local state
```

Locks the goroutine to its current OS thread. Required for:

- OpenGL contexts (must use same thread).
- Java JNI calls (thread-attached).
- GUI toolkits (main-thread requirement).
- Some signal handlers.

Without it, consecutive cgo calls in the same goroutine may run on different OS threads.

---

## 9. C calling Go (exports)

```go
//export Multiply
func Multiply(a, b C.int) C.int {
    return a * b
}
```

Compile as a C-archive or C-shared:

```bash
go build -buildmode=c-archive -o libgo.a .
go build -buildmode=c-shared -o libgo.so .
```

The resulting `.a`/`.so` plus a generated `.h` lets C code call `Multiply(2, 3)`.

Caveats:

- The Go runtime must initialize before any exported function runs.
- Exported functions can't use Go features that depend on the calling goroutine's stack (some recursive patterns).
- Multiple exported functions share the runtime; calls don't restart it.

---

## 10. Cgo and the GC

Go-allocated objects are managed by the GC. C-allocated objects are not. The GC doesn't trace pointers stored in C memory.

So:

- A Go pointer stored in a C global may have its target collected.
- Use `runtime.KeepAlive` if you pass a Go pointer to C and C uses it later.
- Finalizers can run while a C function is using a Go object — `KeepAlive` is essential.

```go
buf := make([]byte, 1024)
C.read(C.int(fd), unsafe.Pointer(&buf[0]), C.size_t(len(buf)))
runtime.KeepAlive(buf)
```

---

## 11. Cgo flags via pkg-config

```go
// #cgo pkg-config: openssl
import "C"
```

`cgo` invokes `pkg-config --cflags openssl` and `pkg-config --libs openssl` and folds the results into the build. Convenient when the library uses standard pkg-config metadata.

---

## 12. Cross-compilation

By default, cross-compiling a cgo-enabled package fails because the host's C toolchain produces the host's binaries.

Options:

1. **Set `CGO_ENABLED=0`** — strips cgo, falls back to pure-Go stdlib. Works if your dependencies are also cgo-free.
2. **Set `CC=...-cross-gcc`** — specify a cross-compilation toolchain. Painful to set up.
3. **Build inside a Linux container** — easiest for "I want a Linux binary from a Mac".

In practice, teams that need multi-platform deployment standardize on Docker-based builds.

---

## 13. Cgo and binary size

A cgo-enabled binary is typically 2–3 MiB larger than the equivalent pure-Go binary, primarily because of the C runtime and libc dependencies.

A static cgo binary (linking libc statically) is even larger and platform-fragile. Distroless static images require `CGO_ENABLED=0`.

---

## 14. Common patterns

| Pattern | When |
|---------|------|
| Static helper functions in the preamble | Bridge complex C APIs cleanly |
| Pre-allocate a C buffer once, reuse | Avoid `malloc/free` per call |
| Copy in/out at the cgo boundary | Avoid pointer-rules violations |
| `runtime.KeepAlive` after every async C call | Prevent GC-induced corruption |

---

## 15. Summary

cgo is a bridge to C with a careful set of rules: type mapping, string/buffer conversions, ownership of memory, and pointer constraints. Calls cost ~100 ns each, so use cgo for *units of work*, not inner loops. For most application code, prefer a pure-Go alternative; for unique C library needs, cgo is the standard answer.

---

## Further reading
- `cmd/cgo` documentation
- Pointer passing rules: https://pkg.go.dev/cmd/cgo#hdr-Passing_pointers
- `runtime.LockOSThread`: https://pkg.go.dev/runtime#LockOSThread

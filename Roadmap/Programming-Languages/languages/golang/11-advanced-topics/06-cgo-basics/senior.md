# cgo Basics — Senior

## 1. Cgo's three costs

Senior cgo work is mostly negotiating three costs:

1. **Per-call overhead** (~100 ns) — bad for hot loops.
2. **GC scheduler interaction** — long blocking C calls hold an OS thread.
3. **Build complexity** — cross-compilation, static linking, supply chain.

If your design pays each cost only where it adds value, cgo is a fine tool. If you sprinkle it across the codebase, build times and correctness debts compound.

---

## 2. Batching at the cgo boundary

```go
// 1000 cgo calls, ~100 µs of overhead alone
for _, x := range data {
    C.process_one(C.int(x))
}

// 1 cgo call, processes all data in C
C.process_batch((*C.int)(unsafe.Pointer(&data[0])), C.size_t(len(data)))
```

The C function does the loop. The Go side hands over the buffer and waits. For workloads that already have a "process N items" API in the C library, this is the only reasonable shape.

---

## 3. Long-running C calls and `M`-thread starvation

A goroutine blocked in a long C call holds an OS thread (`M`). With many such goroutines, the runtime spawns extra threads to keep Go work flowing — but there's a limit (`GOMAXPROCS * a multiplier`, see `runtime/debug.SetMaxThreads`).

Symptom: a service stops servicing requests after some threshold of concurrent cgo calls.

Mitigations:

- **Bounded worker pool** for cgo work, sized to expected concurrency.
- **Async C APIs** where available (use a callback or completion queue).
- **Move work to a separate process** for truly long-running C tasks.

---

## 4. `runtime.LockOSThread`, deeply

The "lock to OS thread" semantics:

- Until `UnlockOSThread` (or goroutine exit), this goroutine runs on a specific OS thread.
- That OS thread cannot run other Go work.
- New goroutines spawned from this one are *not* inherited; they run on any thread.

When this is necessary:

- OpenGL contexts (the context is bound to a thread; OpenGL calls must run there).
- JNI (Java's `JNIEnv*` is per-thread).
- Some signal-handling setups.
- Libraries that store data in `errno`-like thread-local storage if you call them across multiple yielding points.

For each, lock-on-entry / unlock-on-exit is the canonical pattern.

---

## 5. The pointer-passing rules, properly

Rule (from cmd/cgo docs):

> Go code may pass a Go pointer to C provided the Go memory to which it points does not contain any Go pointers. C code must not store a Go pointer in Go memory, even temporarily. C code must not keep a copy of a Go pointer after the call returns.

Why: the GC is non-moving in current Go, but the runtime reserves the right to move stacks during growth. A Go pointer the runtime can't trace is liable to becoming stale.

Defenses:

- For complex data, allocate via `C.malloc`, fill from Go, pass the C pointer, free when done.
- For simple scalars, just pass the value (no pointers involved).
- For slices of structs containing pointers, encode them into a byte buffer the C side parses.

The runtime checks pointer rules dynamically at the cgo boundary (you can disable with `GODEBUG=cgocheck=0`, but don't).

---

## 6. Cgo and the race detector

`go build -race` instruments Go memory accesses. C code is **not** instrumented. Race conditions that span C and Go are invisible to the detector.

In practice:

- Synchronize cgo state carefully — Go mutexes work for Go callers; C code must do its own synchronization.
- A C library that's not thread-safe needs serialization on the Go side (one goroutine at a time, or `LockOSThread` + single thread).

---

## 7. C++ in cgo

Set `CGO_CXXFLAGS` and use `extern "C"` for any C++ functions you want to expose:

```cpp
// helper.cpp
extern "C" int multiply(int a, int b) { return a * b; }
```

```go
// #cgo CXXFLAGS: -std=c++17
// #cgo LDFLAGS: -lstdc++
// extern int multiply(int a, int b);
import "C"

n := C.multiply(3, 4)
```

C++ name mangling is the main hurdle; `extern "C"` removes it. Don't try to expose C++ classes directly to Go.

---

## 8. Memory ownership patterns

| Pattern | Lifetime |
|---------|----------|
| `C.CString` returned from Go → C call | Go owns; `defer C.free` |
| C function returns `char*` | C owns; convert with `C.GoString` (copies) before C frees |
| `C.malloc` from Go → fill → pass to C | Go owns; `defer C.free` |
| Long-lived C struct accessed from Go | C owns; treat the Go-side handle as opaque |
| Go slice passed to C for a single call | Go owns; valid for call duration only |

The error class to avoid: Go pointers stashed in C memory or kept alive past the call.

---

## 9. Errors across the boundary

C functions usually communicate errors via:

- A negative return value and an `errno`/`GetLastError` field.
- A nullable output struct.
- A string buffer the caller passes in.

```go
buf := make([]byte, 256)
ret := C.libfoo_do_thing(arg, (*C.char)(unsafe.Pointer(&buf[0])), C.size_t(len(buf)))
if ret < 0 {
    msg := C.GoString((*C.char)(unsafe.Pointer(&buf[0])))
    return fmt.Errorf("libfoo: %s", msg)
}
```

Errors should be translated into Go errors at the boundary; the rest of the program shouldn't know about C return codes.

---

## 10. Building cgo as a static binary

```bash
go build -ldflags='-linkmode=external -extldflags="-static"' ./...
```

Or with `CC=musl-gcc` and `CGO_ENABLED=1` for fully-static binaries against musl. Painful to set up; the result is portable across Linux distros.

For most production deployments, prefer `CGO_ENABLED=0` and a pure-Go binary unless the C library is essential.

---

## 11. Cgo overhead in microbenchmarks

```go
func BenchmarkCgoCall(b *testing.B) {
    for i := 0; i < b.N; i++ {
        C.cheap_noop()
    }
}

// Result: ~100 ns/op
```

For comparison:

- Pure Go function call: ~1 ns.
- Interface dispatch: ~2 ns.
- Map lookup: ~30 ns.
- mutex lock/unlock: ~20 ns.

100 ns is 100× a Go call. Use that ratio when deciding whether cgo is worth it for a particular function.

---

## 12. Cgo and PGO

Profile-guided optimization mostly benefits Go-to-Go calls. Cgo calls remain opaque to the Go compiler — PGO doesn't reach inside C. If your hot path is dominated by C work, PGO gains will be modest.

---

## 13. Cgo and modules

The C preamble's `#include` paths are resolved by the C preprocessor at build time. Headers must be on the system, in your module's `vendor` directory if vendored, or specified via `-I` paths. Cgo does not manage C dependencies; `go mod` doesn't know about them.

For reproducible builds, vendor the C source and provide it in the module:

```
mypkg/
  go.mod
  api.go
  libfoo/         # vendored C source
    foo.h
    foo.c
```

```go
// #cgo CFLAGS: -I${SRCDIR}/libfoo
// #cgo LDFLAGS: -L${SRCDIR}/libfoo -lfoo
import "C"
```

`${SRCDIR}` is replaced at build time with the directory of the cgo file.

---

## 14. When to invest vs. pivot

**Invest in cgo** when:

- You depend on a mature C library with no Go equivalent (image codecs, ML runtimes, OS bindings).
- The C call boundary is wide (one call processes many items).
- Build complexity is acceptable for your deployment.

**Pivot away from cgo** when:

- The pure-Go alternative is within an acceptable performance margin.
- Cross-compilation and static binaries matter.
- The C library is a maintenance burden (supply chain, security updates).

Maintained Go alternatives have grown for many ecosystems: `pure-go` SQLite implementations, `golang.org/x/crypto`, etc.

---

## 15. Summary

Senior cgo work is about boundaries: making the call boundary efficient (batched), respecting pointer rules, locking OS threads when required, and isolating cgo behavior to a small, well-tested package. Build complexity and platform portability are real costs to weigh against the convenience of using a C library directly.

---

## Further reading
- `cmd/cgo` documentation (re-read it every year)
- Dave Cheney "cgo is not Go"
- `runtime.LockOSThread` semantics
- `GODEBUG=cgocheck=...`

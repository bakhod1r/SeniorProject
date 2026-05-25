# cgo Basics — Optimize

## 1. The first optimization: don't use cgo

Cgo adds ~100 ns per call, plus build complexity, plus binary size. For most workloads, the right optimization is to replace cgo with pure Go.

Cases where pure Go is now competitive:

- Crypto: `crypto/*` is highly optimized.
- Compression: `klauspost/compress` is often faster than `cgo zlib`.
- TLS: Go's `crypto/tls` is fully native.
- Hashing: `crypto/sha256`, `hash/maphash` are pure Go with assembly fast paths.

Benchmark the pure-Go alternative before reaching for cgo.

---

## 2. Batch calls across the boundary

```go
// Bad: 10000 boundary crossings
for _, x := range items {
    C.process_one(C.int(x))
}

// Good: 1 boundary crossing
C.process_batch((*C.int)(unsafe.Pointer(&items[0])), C.size_t(len(items)))
```

If the C library lacks a batch API, write a static helper in the cgo preamble:

```go
/*
void process_batch(int* arr, size_t n) {
    for (size_t i = 0; i < n; i++) {
        process_one(arr[i]);
    }
}
*/
import "C"
```

The static helper compiles into your binary; you get the batched call for free.

---

## 3. Pre-allocate scratch buffers in C

```go
// Bad: malloc + free every call
func encode(data []byte) []byte {
    cbuf := C.malloc(C.size_t(len(data) + 64))
    defer C.free(cbuf)
    // ...
}

// Good: reuse via sync.Pool
var bufPool = sync.Pool{
    New: func() any {
        return C.malloc(4096)
    },
}

func encode(data []byte) []byte {
    cbuf := bufPool.Get().(unsafe.Pointer)
    defer bufPool.Put(cbuf)
    // ...
}
```

Note: putting raw `unsafe.Pointer` in a `sync.Pool` is fine because `unsafe.Pointer` is GC-tracked. But your sync.Pool will eventually be evicted, so attach a cleanup or use a fixed buffer count.

---

## 4. Avoid `C.CString` in hot loops

`C.CString` calls `malloc` and copies. For short strings used many times, pre-allocate:

```go
var nameC = C.CString("widget")    // initialized once

func loop() {
    for i := 0; i < 1000; i++ {
        C.lookup(nameC)              // no allocation
    }
}

// remember to C.free(unsafe.Pointer(nameC)) at shutdown
```

For dynamic strings, hold the `*C.char` for the lifetime needed; don't `CString`/`free` per use.

---

## 5. Cgo and the Go scheduler

A goroutine in a C call holds an `M` (OS thread). For CPU-bound C work:

```go
runtime.GOMAXPROCS(runtime.NumCPU())   // set explicitly
```

Limit the concurrency of C work to roughly `NumCPU` — beyond that you're context-switching threads, not getting more parallelism.

```go
sem := make(chan struct{}, runtime.NumCPU())

func computeIntensive() {
    sem <- struct{}{}
    defer func() { <-sem }()
    C.compute()
}
```

---

## 6. Cgo overhead measurement

```go
func BenchmarkCgoNoop(b *testing.B) {
    for i := 0; i < b.N; i++ {
        C.noop()                      // empty C function
    }
}
```

On modern hardware: ~100 ns/op. Compare to:

```go
func BenchmarkGoNoop(b *testing.B) {
    for i := 0; i < b.N; i++ {
        noop()                        // empty Go function
    }
}
```

~0.5 ns/op (often optimized away entirely).

The ratio (200×) is your budget: a C call must do more than 200 ns of work to be worth the boundary.

---

## 7. `runtime.LockOSThread` performance

Locking a goroutine to an OS thread:

- Prevents the goroutine from being parked between cgo calls.
- Reduces some scheduler overhead on long-running goroutines.
- Costs nothing in steady state (the thread is already dedicated to the goroutine during C).

For a worker that makes many cgo calls in a row, `LockOSThread` is essentially free and prevents subtle bugs (thread-local state).

---

## 8. Skipping pointer checks (carefully)

The runtime checks pointer-passing rules at every cgo call. The check has small overhead. For ultra-hot paths:

```bash
GODEBUG=cgocheck=0 ./app
```

This disables the runtime check. Don't do this in production. It's a debugging tool for measuring "would my code be faster without the check?" — usually answer is "by 5%, not worth the lost safety".

---

## 9. Inline static helpers vs separate `.c` files

The C preamble in a comment compiles per-file. For a large helper library:

```
mypkg/
  bridge.go         # //go:build cgo
  helpers.c         # compiled by the C compiler as part of the package
  helpers.h
```

Cgo will compile `helpers.c` and link it. Faster than re-compiling a huge preamble in every `.go` file. Standard practice for cgo packages with substantial C code.

---

## 10. `pkg-config` performance

```go
// #cgo pkg-config: openssl
```

The first build invokes `pkg-config` and caches the result. Subsequent builds are fast. If `pkg-config` is slow on your system (rare), pre-compute the flags:

```go
// #cgo LDFLAGS: -L/usr/lib/x86_64-linux-gnu -lssl -lcrypto
```

---

## 11. Reducing binary size

Cgo binaries are larger by default. Options:

```bash
go build -ldflags='-s -w' -trimpath ./...
```

Strips debug info: ~10% size reduction.

For genuinely small binaries, use `CGO_ENABLED=0`. The savings can be 30%+ if cgo wasn't doing much.

---

## 12. Static vs dynamic linking

| Mode | Pros | Cons |
|------|------|------|
| Dynamic (default) | Smaller binary; shared libc | Requires libc at runtime; portability issues |
| Static (musl) | Self-contained; portable | Bigger binary; possibly worse perf on some libs |

Linking flag:

```bash
go build -ldflags='-linkmode=external -extldflags="-static"' ./...
```

Combine with `CC=musl-gcc` for fully static.

---

## 13. Cgo and PGO

PGO won't help inside C. So profile-guided optimization for a cgo-heavy binary mostly improves the Go side. Worth running if:

- Your Go side has hot paths the compiler can optimize.
- You're already running PGO on other binaries.

Not worth the complexity for binaries dominated by C work.

---

## 14. The "rewrite in Go" question

For each cgo dependency, ask annually:

- Has a maintained pure-Go alternative emerged?
- Is the performance gap acceptable?
- What's the build/deploy complexity cost?

Examples of successful migrations:

- `mattn/go-sqlite3` (cgo) → `modernc.org/sqlite` (pure Go).
- `cgo openssl` → `crypto/tls`.
- `cgo libcurl` → `net/http`.

The pure-Go versions are now usable for most workloads.

---

## 15. Summary

Cgo optimization is mostly about minimizing boundary crossings (batch), reusing C resources (pre-allocated buffers, persistent CStrings), and bounding concurrency to avoid `M`-thread exhaustion. The bigger wins often come from architectural decisions: confine cgo to a small package, or replace it entirely with a pure-Go alternative. Measure costs concretely and revisit the cgo decision yearly.

---

## Further reading
- `klauspost/compress`: a pure-Go alternative to cgo-based compression
- `modernc.org/sqlite`: pure-Go SQLite
- "Cgo is not Go" — Dave Cheney

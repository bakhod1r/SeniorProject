# Slice Header Internals — Professional

## 1. From mechanics to production

Knowing what the slice header is and how `growslice` works is necessary; the production work is in *systematically not getting bitten by them*. This file collects patterns that mature Go codebases use to keep slice behaviour predictable in long-running services: bounded reslices on API boundaries, defensive copies on ingress, GC-safe handling of large buffers, `unsafe.Slice` for zero-copy interop, and profiling techniques specific to slice-heavy hot paths.

Audience: engineers who own a Go service handling non-trivial volume and want their slice code to neither leak memory nor surprise the caller.

---

## 2. The defensive-view pattern

Any function that returns a sub-slice of internal state risks the caller mutating that state. Three options, in increasing order of safety and cost:

```go
// 1. Raw — fastest, most dangerous
func (b *Buffer) Bytes() []byte { return b.buf }

// 2. Bounded view — zero-copy, append-safe
func (b *Buffer) BoundedBytes() []byte { return b.buf[:len(b.buf):len(b.buf)] }

// 3. Defensive copy — fully isolated
func (b *Buffer) CopiedBytes() []byte { return slices.Clone(b.buf) }
```

When to pick each:

| Returning to... | Pick |
|----------------|------|
| Trusted internal caller, performance-critical | (1) Raw |
| External package, but only reads expected | (2) Bounded view |
| External package, mutation possible or unspecified | (3) Defensive copy |
| Caller persists the result beyond the next mutation | (3) Defensive copy |

Pattern (2) is the most undervalued. It's free at runtime (just a header construction) and prevents the most common bug: caller appends, runtime decides the cap suffices, caller's append silently overwrites the next slot of *your* buffer.

```go
buf := []byte("hello world")
view := buf[:5:5]           // bounded
appended := append(view, '!') // forced to allocate; buf unchanged
```

Rule: **public APIs that return a slice should return `s[:n:n]`** unless they explicitly document mutation semantics.

---

## 3. The retention trap and how to detect it

A small slice over a huge backing array keeps the array alive. In a cache or long-running data structure, this leaks memory invisibly.

```go
func parseAndCacheFirstLine(big []byte) []byte {
    nl := bytes.IndexByte(big, '\n')
    if nl < 0 { nl = len(big) }
    return big[:nl] // retains the entire big array!
}
```

If `big` is 100 MiB and the first line is 200 bytes, this function effectively allocates 100 MiB into your cache.

**Detection:** profile heap with `runtime/pprof`. Look for arrays referenced only by tiny slices. A heuristic: `len(s) / cap(s) < 0.1` on a long-lived slice is suspicious.

```go
import (
    "runtime"
    _ "net/http/pprof"
)

// programmatically check retention
func checkRetention(s []byte) {
    if cap(s) > 4096 && len(s)*10 < cap(s) {
        log.Printf("suspicious retention: len=%d cap=%d", len(s), cap(s))
    }
}
```

**Fix:** the `clone-and-shrink` pattern:

```go
func parseAndCacheFirstLine(big []byte) []byte {
    nl := bytes.IndexByte(big, '\n')
    if nl < 0 { nl = len(big) }
    out := make([]byte, nl)
    copy(out, big[:nl])
    return out
}
// or
return slices.Clone(big[:nl])
```

`slices.Clone` (Go 1.21) is the idiomatic spelling. It allocates a slice with `cap == len` containing the same elements; the original backing array is no longer referenced.

---

## 4. Ingress copy on the network boundary

A common variant of retention bites HTTP servers:

```go
func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    s.cache.Store(r.URL.Path, body[:20]) // retains all of body
}
```

`io.ReadAll` returns a slice whose capacity rounds up to the next size class — possibly 4 KiB for a 200-byte body, but possibly 64 KiB for a 10 KiB body. The cache holds a 20-byte view but retains all 64 KiB.

Defensive ingress copy:

```go
s.cache.Store(r.URL.Path, slices.Clone(body[:20]))
```

Apply this rule generally: **when you accept a `[]byte` from one subsystem and hand it to another for long-term storage, copy at the boundary.** Yes, it costs an allocation. The alternative is unbounded retention.

A more economical version when you accept many small slices: a packed byte arena.

```go
type arena struct {
    buf []byte
}

func (a *arena) intern(b []byte) []byte {
    start := len(a.buf)
    a.buf = append(a.buf, b...)
    return a.buf[start:len(a.buf):len(a.buf)] // bounded view into arena
}
```

All interned slices share one growing buffer. Use when you produce many small `[]byte` whose lifetime matches the arena's.

---

## 5. Header-only data flow with `unsafe.Slice`

When you receive a pointer from C, a memory-mapped file, or a custom allocator, `unsafe.Slice` builds a Go slice header without copying:

```go
import (
    "syscall"
    "unsafe"
)

func mmap(fd, length int) ([]byte, error) {
    p, err := syscall.Mmap(fd, 0, length, syscall.PROT_READ, syscall.MAP_SHARED)
    if err != nil {
        return nil, err
    }
    // p is already a []byte from syscall.Mmap, but to demonstrate:
    return unsafe.Slice((*byte)(unsafe.Pointer(&p[0])), length), nil
}
```

Real-world use: reading a binary protocol whose lengths are known from a header. Build a slice over the on-the-wire buffer without copying the payload.

**Caveats:**

- `unsafe.Slice(ptr, n)` does not allocate; the slice's `Data` is `ptr`. The GC does *not* manage that memory if it came from `mmap`/`malloc`. You must explicitly `munmap`/`free` when done.
- The caller must ensure no reference outlives the underlying memory.
- `unsafe.Slice` is the **only** GC-safe way to build a slice from a raw pointer in Go 1.20+. The legacy `(*[1 << 30]byte)(unsafe.Pointer(ptr))[:n:n]` pattern still works but is hostile to the linter and bounds-checker.

---

## 6. `unsafe.SliceData` for zero-copy serialisation

Pair: `unsafe.SliceData(s) *T` returns the data pointer. Useful for handing a slice to a C library:

```go
/*
#include <stdint.h>
void process(const uint8_t* data, size_t len);
*/
import "C"
import "unsafe"

func send(s []byte) {
    if len(s) == 0 { return }
    C.process((*C.uint8_t)(unsafe.SliceData(s)), C.size_t(len(s)))
}
```

This passes the slice's underlying buffer directly to C — no copy. The Go garbage collector will not move slices (Go's GC is non-moving for now), so the pointer is stable for the duration of the cgo call, provided the slice itself remains reachable in Go.

**Pinning:** if the C call may outlive the cgo invocation (rare, but happens with async callbacks), use `runtime.Pinner` (Go 1.21):

```go
var pin runtime.Pinner
pin.Pin(unsafe.SliceData(s))
defer pin.Unpin()
C.process_async((*C.uint8_t)(unsafe.SliceData(s)), C.size_t(len(s)))
```

`Pin` prevents the GC from collecting (or moving in a future moving-GC world) the pointed-to memory until `Unpin`.

---

## 7. Slice pools

For workloads that repeatedly build slices of similar size, `sync.Pool` of slices avoids allocation churn:

```go
var bufPool = sync.Pool{
    New: func() any {
        s := make([]byte, 0, 4096)
        return &s
    },
}

func encode(payload Payload) []byte {
    bufP := bufPool.Get().(*[]byte)
    buf := (*bufP)[:0]
    buf = appendEncoded(buf, payload)
    out := slices.Clone(buf) // copy out before returning to pool
    *bufP = buf
    bufPool.Put(bufP)
    return out
}
```

Two production wrinkles:

1. **Pool the pointer to slice, not the slice value.** A `[]byte` is 24 bytes; pooling it loses the underlying capacity bookkeeping. Pool a `*[]byte` (16 bytes overhead, but the slice header is preserved).

2. **Reset length, not capacity.** `buf := (*bufP)[:0]` keeps the backing array, sets `len = 0`. If you set `*bufP = nil` or `*bufP = make(...)`, you've defeated the pool.

3. **Cap the pooled size.** Don't return a 10 MiB slice to a pool meant for 4 KiB working buffers; you'll bloat memory across all pool consumers. Bound:

   ```go
   if cap(buf) > 16384 { return } // drop oversized buffers
   *bufP = buf
   bufPool.Put(bufP)
   ```

`sync.Pool` is GC-aware: it drops pooled items each cycle. The hot path benefits; idle pools don't bloat.

---

## 8. Profiling slice-heavy hot paths

The relevant pprof profiles:

| Profile | What it shows |
|---------|---------------|
| `/debug/pprof/allocs` | Cumulative allocations (where `make`, `append`, `growslice` happen) |
| `/debug/pprof/heap` | Currently-live allocations (where retention lives) |
| `/debug/pprof/profile?seconds=30` | CPU samples — `memmove`, `growslice`, `mallocgc` |

Three high-signal flags:

```bash
GODEBUG=allocfreetrace=1 ./program   # log every allocation
GODEBUG=clobberfree=1 ./program      # poison freed memory (helps catch UAF)
GODEBUG=gctrace=1 ./program          # GC cycle stats
```

For a slice-heavy hot path:

1. Run CPU profile under load: `go tool pprof -http=:8080 cpu.prof`.
2. Look for `runtime.growslice`, `runtime.memmove`, `runtime.mallocgc` in the flame graph. Their parent frames are your hot path.
3. For each parent: can you preallocate (`make([]T, 0, n)` with `n` estimated)? Can you use `slices.Grow(s, n)`?
4. Repeat with allocs profile to confirm allocations dropped.

A worked anecdote: a JSON-encoding hot path showed 40 % of CPU in `mallocgc` from `bytes.Buffer.grow`. Switching to a per-request `sync.Pool` of `*bytes.Buffer` dropped that to 4 %.

---

## 9. Bench harness for slice operations

```go
func BenchmarkAppendNoHint(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var s []int
        for j := 0; j < 1000; j++ {
            s = append(s, j)
        }
    }
}

func BenchmarkAppendWithHint(b *testing.B) {
    for i := 0; i < b.N; i++ {
        s := make([]int, 0, 1000)
        for j := 0; j < 1000; j++ {
            s = append(s, j)
        }
    }
}
```

Run with `go test -bench=. -benchmem`. Typical result on amd64:

```
BenchmarkAppendNoHint-8     200000   8200 ns/op  16128 B/op  10 allocs/op
BenchmarkAppendWithHint-8  1500000    790 ns/op   8192 B/op   1 allocs/op
```

The 10x improvement is real and reproducible. Multiply by the request rate of a hot path.

Pair with `-cpuprofile` and `-memprofile`:

```bash
go test -bench=BenchmarkAppend -cpuprofile=cpu.out -memprofile=mem.out
go tool pprof -http=:8080 cpu.out
```

The visual difference: `BenchmarkAppendNoHint` shows a tall `runtime.growslice` stack; `BenchmarkAppendWithHint` is essentially `runtime.makeslice` + `runtime.memclrNoHeapPointers`.

---

## 10. The `slices` package (Go 1.21+)

The standard library now ships a set of slice utilities. Production code should prefer these over hand-rolled equivalents:

| Function | Use |
|----------|-----|
| `slices.Clone(s)` | Defensive copy with `cap == len` |
| `slices.Equal(a, b)` | Element-wise equality |
| `slices.Contains(s, v)` | Linear search |
| `slices.Index(s, v)` | First-match index |
| `slices.Sort(s)` | In-place sort for ordered types |
| `slices.Grow(s, n)` | Ensure `cap(s) >= len(s) + n` (allocates once if needed) |
| `slices.Delete(s, i, j)` | Remove range, preserving order |
| `slices.Insert(s, i, vs...)` | Insert at index |
| `slices.Concat(s1, s2, ...)` | Allocate result of correct size once |

`slices.Grow(s, n)` is the under-appreciated one. It expresses "I'm about to append n items" and lets the runtime pick the right new capacity in one shot, rather than the iterative doubling that bare `append` performs:

```go
s = slices.Grow(s, 1000) // one allocation
for i := 0; i < 1000; i++ {
    s = append(s, i)
}
```

vs

```go
for i := 0; i < 1000; i++ {
    s = append(s, i) // ~10 reallocations
}
```

`slices.Concat([]a, b, c)` similarly allocates a result of `len(a)+len(b)+len(c)` in one shot — superior to `append(append(append(nil, a...), b...), c...)`.

---

## 11. Worked production pattern: paginated query reader

A function that reads many DB pages and returns concatenated results.

```go
// Naive
func ReadAll(ctx context.Context, q Querier) ([]Row, error) {
    var all []Row
    for {
        page, err := q.NextPage(ctx)
        if err != nil { return nil, err }
        if len(page) == 0 { break }
        all = append(all, page...)
    }
    return all, nil
}
```

Issues:

- `all` doubles repeatedly. For a 10k-row result, ~14 `growslice` calls.
- The pages themselves may share a backing buffer with the DB driver's read buffer (driver-dependent; the SQL driver often does this).
- Each `append(all, page...)` may force the driver buffer to remain alive longer than needed.

Production version:

```go
func ReadAll(ctx context.Context, q Querier) ([]Row, error) {
    estimate, _ := q.RowCountEstimate(ctx)
    all := make([]Row, 0, estimate)
    for {
        page, err := q.NextPage(ctx)
        if err != nil { return nil, err }
        if len(page) == 0 { break }
        if cap(all)-len(all) < len(page) {
            all = slices.Grow(all, len(page))
        }
        for _, r := range page {
            all = append(all, r.Clone()) // defensive — release driver page
        }
    }
    return all, nil
}
```

Trade-offs:

- Estimate hint cuts allocations from ~14 to ~1.
- `r.Clone()` releases the driver's page after each iteration, capping memory at one page in flight.
- `slices.Grow` covers the case where the estimate was low.

---

## 12. The "in-place filter" idiom

A canonical slice manipulation that doesn't allocate:

```go
func filter(s []int, keep func(int) bool) []int {
    n := 0
    for _, v := range s {
        if keep(v) {
            s[n] = v
            n++
        }
    }
    return s[:n]
}
```

Reuses the backing array; returns a header with a smaller `Len`. Zero allocations. Mutates the input.

**Caveat:** the original elements past index `n` are still there and still reachable through the original `s` (which now has the same `Data` and `Cap` as the returned slice). For element types containing pointers, this leaks references to filtered-out elements:

```go
type Conn struct { /* large */ }

s := []*Conn{...}
s = filter(s, predicate) // s[len:cap] still holds pointers to filtered-out *Conn
```

The standard fix: nil the tails.

```go
func filter[T any](s []T, keep func(T) bool) []T {
    n := 0
    var zero T
    for i, v := range s {
        if keep(v) {
            s[n] = v
            n++
        }
        s[i] = zero // clear; lets GC reclaim
    }
    return s[:n]
}
```

For pointer-free element types (e.g., `[]int`), the cleanup loop is unnecessary. For pointer-bearing types, it's required if the slice may live for a while after filtering.

Go 1.21's `slices.DeleteFunc` and `slices.Compact` do the right thing — they clear the tail. Prefer those.

---

## 13. Bench-guided cap rounding

Every `make([]T, 0, n)` rounds up to a malloc size class. Picking `n` near a class boundary is wasteful. The size classes for small allocations are roughly powers of two and selected non-powers between them (8, 16, 24, 32, 48, 64, 80, 96, 112, 128, 144, ..., 4096, 8192, 16384).

If your typical slice grows to ~700 elements of `int64` (5600 bytes), `make([]int64, 0, 700)` will allocate a span class for ~5632 bytes — wasted bytes at the tail. `make([]int64, 0, 768)` (6144 bytes) might round up to the same class with no extra waste, giving you headroom for free.

Run a small experiment:

```go
func sizeOf(cap int) uintptr {
    s := make([]int64, 0, cap)
    return unsafe.Sizeof(s[0:1][0]) * uintptr(cap) // your view
    // run pprof to see actual heap class
}
```

The `runtime/internal/sys/sizeclasses.go` file documents the size classes. Round your typical caps up to a class boundary.

In hot paths this is a 1–5 % memory win; in steady-state services it can be significant.

---

## 14. Cross-goroutine slice handoff

A common pattern: producer goroutine builds a slice, sends to a worker via channel.

```go
ch := make(chan []byte, 16)

// producer
buf := bufPool.Get().(*[]byte)
*buf = (*buf)[:0]
*buf = appendData(*buf, payload)
ch <- *buf
// producer continues; the pool will get the buf back after the consumer is done

// consumer
data := <-ch
process(data)
*buf = data[:0]
bufPool.Put(buf) // only safe if no other consumer holds data
```

The bug is at the handoff: who owns the slice header after the send? Common rules:

1. **Move semantics:** producer relinquishes after send; consumer is sole owner. Pool return is consumer's responsibility.
2. **Borrow semantics:** producer waits for consumer to finish (sync.WaitGroup), then pools. Consumer must not retain beyond signal.

Pick one and document it. The most common production bug is mixing them: producer pools after send, consumer is still reading — boom, racy mutation.

For Go 1.22's `sync.OnceFunc`-driven once-only return, wrap the handoff:

```go
type pooledSlice struct {
    Data []byte
    once func()
}

func (p *pooledSlice) Release() { p.once() }
```

The consumer always calls `Release`; the once guarantees exactly-one pool put, regardless of paths through the code.

---

## 15. Header-level invariants for code review

A checklist for production code reviewing slice-heavy paths:

- [ ] Public APIs returning a sub-slice of internal state use `s[:n:n]` or `slices.Clone`.
- [ ] No `[]byte` from `io.ReadAll`, `bufio.Reader.Bytes`, or `bytes.Buffer.Bytes` is stored across the source's next mutation without copying.
- [ ] Long-lived caches don't store small slices into large backing arrays.
- [ ] Hot-path allocations use `make([]T, 0, hint)` or `slices.Grow` with realistic hints.
- [ ] `sync.Pool` of slices stores `*[]T`, caps slice size on return, resets length to 0 (not capacity).
- [ ] `unsafe.Slice` is used rather than `reflect.SliceHeader` for pointer-to-slice construction (Go 1.20+).
- [ ] Filter/compact functions clear the tail for pointer-bearing element types (or use `slices.DeleteFunc`).
- [ ] Cross-goroutine handoffs of pooled slices document ownership semantics.
- [ ] Benchmarks (`-benchmem`) exist for hot paths and are run in CI.

---

## 16. Field experience: three production incidents

**Incident 1 — Memory leak via `bytes.Buffer.Bytes()`.** A logging library cached the result of `buf.Bytes()` across `buf.Reset()` calls. On low-traffic services, occasional log entries showed garbage. Root cause: the underlying array was reused; cached "logged" payloads were overwritten. Fix: `slices.Clone(buf.Bytes())` at cache write.

**Incident 2 — RSS unbounded growth in a stream parser.** A streaming JSON parser kept the first 200 bytes of each error event for context. The 200-byte slice retained the 64 KiB read buffer. With ~10k errors/day, ~640 MiB leaked weekly. Fix: `slices.Clone` at error-context capture.

**Incident 3 — Latency spike from `growslice` in a hot path.** A request encoder used `var buf []byte` and appended ~4 KiB per request. `growslice` accounted for 18 % of CPU under load. Fix: `make([]byte, 0, 4096)` per request — `growslice` dropped to 0.1 %.

All three issues were spotted by reading the heap profile and asking "why is this slice so deep into a big backing array?" Train your eye for the pattern; the fix is then mechanical.

---

## 17. Summary

The slice header is small, but production behaviour is dominated by what its `Data` field keeps alive. Defensive bounded views, ingress copies, pool discipline, and an awareness of GC retention turn a thin runtime type into a reliable production primitive. Use `slices.Clone`, `slices.Grow`, `unsafe.Slice`, and the `slices` package for stdlib-blessed forms of the patterns above. Profile slice-heavy paths with `-benchmem` and pprof's allocs profile; the wins are usually in the 10x range.

---

## Further reading
- `slices` package — https://pkg.go.dev/slices
- `runtime` GC tuning — https://go.dev/doc/gc-guide
- `sync.Pool` — https://pkg.go.dev/sync#Pool
- `unsafe.Slice`/`SliceData` — https://pkg.go.dev/unsafe#Slice
- `runtime/internal/sys/sizeclasses.go` — https://github.com/golang/go/blob/master/src/runtime/sizeclasses.go
- Dmitry Vyukov: "Go scheduler" (background for the cross-goroutine section) — https://golang.org/s/go11sched

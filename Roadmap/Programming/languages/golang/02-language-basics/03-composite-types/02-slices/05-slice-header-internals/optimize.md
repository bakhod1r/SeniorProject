# Slice Header Internals — Optimization

How to make slice-heavy code fast. Most wins come from a few patterns: pre-allocation with the right cap, three-index slicing to avoid spurious copies, `unsafe.Slice`/`unsafe.SliceData` for zero-copy interop, pooling, and avoiding the small set of operations that produce hidden allocations. Each pattern below comes with a benchmark you can run.

For background mechanics, read [senior.md](senior.md). For production patterns, [professional.md](professional.md). This file is the optimisation cookbook.

---

## 1. Preallocation: the single biggest win

The pattern:

```go
// Slow
var s []T
for x := range source {
    s = append(s, transform(x))
}

// Fast
s := make([]T, 0, len(source))
for x := range source {
    s = append(s, transform(x))
}
```

Bench:

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

Typical numbers (amd64, Go 1.22):

```
BenchmarkAppendNoHint-8     200000   8200 ns/op  16128 B/op  10 allocs/op
BenchmarkAppendWithHint-8  1500000    790 ns/op   8192 B/op   1 allocs/op
```

10× faster, 10× fewer allocations. **The hint must be the final length, not a guess far below it** — otherwise `growslice` runs anyway.

When the final length is unknown but bounded, prefer an over-estimate (a bit of wasted memory) over an under-estimate (multiple reallocs).

---

## 2. `slices.Grow(s, n)` — preallocate after the fact

Sometimes you receive a slice and then append a known number of elements:

```go
// Slow
func extend(prefix []int, items []int) []int {
    for _, x := range items {
        prefix = append(prefix, x)
    }
    return prefix
}

// Fast
func extend(prefix []int, items []int) []int {
    prefix = slices.Grow(prefix, len(items))
    for _, x := range items {
        prefix = append(prefix, x)
    }
    return prefix
}
```

`slices.Grow` allocates exactly once (or not at all if capacity already suffices). Without it, you risk multiple `growslice` calls — even worse when `prefix` is small and `items` is large.

`slices.Concat(a, b, c, ...)` is the single-shot equivalent for fully known inputs.

---

## 3. Three-index slicing to defer allocation

When passing a slice to code that might `append`, three-index slicing prevents an inadvertent copy at the wrong layer:

```go
// Suspicious — passing a slice with extra cap to user code
processUser(allUsers)

// Defensive — user code's append allocates fresh
processUser(allUsers[:len(allUsers):len(allUsers)])
```

The bound stops the user code from clobbering your buffer *and* forces an explicit copy that lives in their accounting, not yours. Useful when:

- Returning slice fields from a struct method.
- Splitting one buffer into many sub-slices that may each grow.
- Building immutable views of mutable data.

When passing slices internally inside a hot path, omit the bound (no point allocating defensively). When crossing a trust boundary, add it.

---

## 4. `unsafe.SliceData` for zero-copy interop

To pass a slice's backing array to C without copying:

```go
import "C"
import "unsafe"

func send(s []byte) {
    if len(s) == 0 { return }
    C.write(C.int(fd), unsafe.Pointer(unsafe.SliceData(s)), C.size_t(len(s)))
}
```

`unsafe.SliceData(s)` returns `*byte` (typed, GC-tracked). The cgo call sees the raw bytes without an intermediate copy. The Go runtime guarantees the slice's memory is stable for the duration of the call (the GC is non-moving, and the runtime keeps the slice reachable through the parameter).

For an empty slice, `unsafe.SliceData` returns a non-nil sentinel pointer in Go 1.21+. For C calls that disallow null, this is the safe pattern.

---

## 5. `unsafe.Slice` for zero-copy data construction

When you receive a pointer plus length from a custom allocator, `mmap`, or a memory pool, build a slice header without copying:

```go
func mmapToSlice(fd, length int) ([]byte, error) {
    p, err := syscall.Mmap(fd, 0, length, syscall.PROT_READ, syscall.MAP_SHARED)
    if err != nil { return nil, err }
    // syscall.Mmap already returns []byte, but for an arbitrary pointer:
    // return unsafe.Slice((*byte)(rawPtr), length), nil
    return p, nil
}
```

`unsafe.Slice(ptr, n)` builds `{Data: ptr, Len: n, Cap: n}` with zero allocation. Replaces the legacy idiom:

```go
// Legacy (deprecated in modern style)
slice := (*[1 << 30]byte)(unsafe.Pointer(rawPtr))[:n:n]
```

The new form is type-safe (returns `[]byte`, not `[1<<30]byte` cast), linter-friendly, and explicit about the length.

---

## 6. Avoid `string(b)` and `[]byte(s)` in hot paths

Both conversions allocate and copy. In a hot loop, they can dominate CPU time.

```go
// Hot path receives bytes; uses them as a map key
for _, b := range messages {
    v := cache[string(b)] // ALLOCATES!
    process(v)
}
```

Compiler peephole optimisations elide the copy for specific patterns:

| Pattern | Allocates? |
|---------|-----------|
| `m[string(b)]` (map lookup) | NO — recognised special case |
| `string(b) == "literal"` | NO — byte-compared in place |
| `for _, c := range string(b)` | NO — iterates over bytes directly |
| `_ = string(b)` (stored or returned) | YES |
| `s := string(b); doStuff(s)` | YES |

Verify with `go build -gcflags="-m=2"`. If a hot conversion is missed, restructure to fall into one of the special-cased patterns.

For unavoidable conversions where you need a string for a long-lived data structure, accept the cost.

---

## 7. `sync.Pool` of slice buffers

For request-scoped buffers that have similar size:

```go
var bufPool = sync.Pool{
    New: func() any {
        s := make([]byte, 0, 4096)
        return &s
    },
}

func encode(p Payload) []byte {
    bufP := bufPool.Get().(*[]byte)
    buf := (*bufP)[:0]
    buf = appendEncoded(buf, p)
    out := slices.Clone(buf)
    if cap(buf) <= 16384 {
        *bufP = buf
        bufPool.Put(bufP)
    }
    return out
}
```

Three discipline points:

1. **Pool `*[]byte`**, not `[]byte`. A slice value is 24 bytes; storing it in the `any` of `sync.Pool` is acceptable, but pointer-pooling cooperates better with escape analysis.
2. **Reset length, not capacity:** `buf := (*bufP)[:0]` preserves the backing array.
3. **Cap the returned size.** Don't pollute the pool with oversized buffers.

Bench impact for an HTTP-like workload: 30–50 % CPU reduction in encoding paths is typical when the prior version called `make` per request.

---

## 8. Beware copy of huge pointer-bearing element types

For `[]int`, `[]byte`, `[]struct{...}` (pointer-free), `copy(dst, src)` is `memmove`-fast (SIMD/REP MOVSB on amd64). For `[]*Big`, `[]Big` where `Big` contains pointers, `copy` calls `runtime.typedslicecopy` which is slower — each pointer needs a write barrier.

Workaround when applicable: split a pointer-bearing struct into separate columns (Struct-of-Arrays vs Array-of-Structs).

```go
// AoS — slow to copy if Item has pointers
type Item struct {
    Name *string
    Count int
}
items := make([]Item, N)

// SoA — Count column is plain ints; can copy fast
type ItemsSoA struct {
    Names []*string
    Counts []int
}
```

Bench `copy` on a 1M-element `[]Item` vs `copy(c.Counts, ...)` to see the difference (often 5–10×). SoA isn't always semantically right, but for hot inner loops it can be transformative.

---

## 9. Avoid passing pointers to slices

```go
// Anti-pattern
func grow(s *[]int) {
    *s = append(*s, ...)
}

// Idiomatic
func grow(s []int) []int {
    return append(s, ...)
}
```

The pointer-to-slice version forces the slice header into the heap (because its address must be taken). The idiomatic version keeps the header in registers (3 registers under the register ABI). The latter is faster and triggers less GC pressure.

The only legitimate reason to take a pointer to a slice: you genuinely need to mutate the caller's slice variable (rare). Even then, prefer a return-the-new-slice API.

---

## 10. Reslicing instead of copying

A common pattern: process a byte stream by repeatedly reading the head off a buffer.

```go
// Slow: copy bytes off the front
func readN(buf *[]byte, n int) []byte {
    out := slices.Clone((*buf)[:n])
    *buf = (*buf)[n:]
    return out
}

// Fast: just reslice
func readN(buf *[]byte, n int) []byte {
    out := (*buf)[:n:n] // bounded; safe if caller doesn't outlive buffer's next write
    *buf = (*buf)[n:]
    return out
}
```

The fast version returns a sub-slice that aliases `buf`. If the consumer uses it immediately and synchronously, no copy is needed. If the consumer stores it past the next buffer mutation, you need the slow version.

The choice is contextual; don't blindly clone or blindly reslice. Document the lifetime convention.

---

## 11. `bytes.Buffer.Grow` over implicit append growth

When you know you're about to write N bytes to a buffer:

```go
// Implicit
buf.Write(payload1)
buf.Write(payload2)
buf.Write(payload3)

// Explicit
buf.Grow(len(payload1) + len(payload2) + len(payload3))
buf.Write(payload1)
buf.Write(payload2)
buf.Write(payload3)
```

The explicit form sizes the buffer once. The implicit form may grow 2–3 times. Same idea as `slices.Grow`, applied to `bytes.Buffer`.

---

## 12. `make([]T, 0, n)` rounding to size classes

The runtime rounds requested capacity up to the next allocator size class. For `[]byte`:

| Requested cap | Actual cap (rounded) | Bytes |
|---------------|----------------------|-------|
| 1...8 | 8 | 8 |
| 9...16 | 16 | 16 |
| 17...32 | 32 | 32 |
| 33...48 | 48 | 48 |
| 49...64 | 64 | 64 |
| 65...80 | 80 | 80 |
| ... | ... | ... |
| 3585...4096 | 4096 | 4096 |
| 4097...4608 | 4608 | 4608 |

If your typical request is 700 bytes, `make([]byte, 0, 700)` allocates 768 bytes (rounded up). You could request 768 directly with no waste, gaining a few free bytes of headroom — and a single `append` past 700 won't trigger a realloc.

The full size class table is in `runtime/sizeclasses.go`. For element types other than byte, multiply by `sizeof(T)`.

Bench-driven cap selection sounds nit-picky but in a hot path it's measurable. Combine with profiling: look for slices that consistently grow by one item just past the size class boundary.

---

## 13. Don't store small things in big arrays you'll abandon

```go
// Bad
func parseHeader(big []byte) Header {
    return Header{
        Type: big[0:4],   // 4 bytes; retains all of big!
        Data: big[4:100], // 96 bytes; retains all of big!
    }
}

// Good
func parseHeader(big []byte) Header {
    return Header{
        Type: slices.Clone(big[0:4]),
        Data: slices.Clone(big[4:100]),
    }
}
```

The "bad" version is faster (no copies), but every `Header` keeps the entire `big` array alive. If you have many `Header`s, total RSS is N × len(big), not N × 100 bytes.

The optimisation is contextual: if `big` itself is short-lived and the `Header` is also short-lived (request scope), the alias-keeping version is fine. If the `Header` lives in a cache or queue, copy at the boundary.

---

## 14. In-place filter — avoid `make` of a new slice

```go
// Slow: allocates
func filter(in []int, keep func(int) bool) []int {
    out := make([]int, 0, len(in))
    for _, v := range in {
        if keep(v) {
            out = append(out, v)
        }
    }
    return out
}

// Fast: zero-allocation
func filterInPlace(in []int, keep func(int) bool) []int {
    n := 0
    for _, v := range in {
        if keep(v) {
            in[n] = v
            n++
        }
    }
    return in[:n]
}
```

The in-place version reuses the backing array. Caveats:

- Mutates `in`. If the caller needs the original, this is the wrong shape.
- For pointer-bearing element types, zero the tail (`in[i] = nilValue`) or use `slices.DeleteFunc`.

When the caller doesn't need the input afterward, the in-place version is essentially free.

---

## 15. Choose `int8`/`int16` for memory-bound slices

For very large slices where each element is a small integer, the element type matters:

```go
var counts []int     // 8 bytes per element
var counts []int32   // 4 bytes
var counts []int16   // 2 bytes
var counts []int8    // 1 byte (-128..127)
```

A `[]int` of 100M elements is 800 MiB. The same data as `[]int8` (if range permits) is 100 MiB — 8× memory, 8× cache, 4× SIMD throughput per cache line.

When you know the value range (counters under 256, small enums, packed bitfields), use the smaller type. Numeric-method ergonomics suffer slightly but the memory savings are worth it for large datasets.

---

## 16. Use `[]byte` instead of `[]rune` when possible

```go
// Wasteful — []rune is []int32
runes := []rune("hello")  // 5 elements × 4 bytes = 20 bytes
bytes := []byte("hello")  // 5 bytes
```

`[]rune` exists for indexing into characters (UTF-8 code points). If you don't need that — for ASCII processing, prefix matching, hashing, comparison — stay in `[]byte`. The conversion `[]rune(s)` walks the entire string allocating one int32 per code point.

Most "I need a rune slice" intuitions can be replaced with `range string(...)`, which iterates without allocating.

---

## 17. `slices.Compact` removes adjacent duplicates with one allocation

```go
// Naive
out := []int{}
for i, v := range in {
    if i == 0 || v != in[i-1] {
        out = append(out, v)
    }
}

// Better
out := slices.Compact(in)
```

`slices.Compact` does it in place, mutating `in` and returning a shortened header. Zero allocations.

For pointer-bearing types, `slices.Compact` clears the tail. Don't roll your own.

---

## 18. The cost of bounds checks

Every `s[i]` is bounds-checked unless the compiler can prove `i` is in range. In a hot loop:

```go
for i := 0; i < len(s); i++ {
    sum += s[i] // bounds check?
}
```

The compiler can often elide the check because `i < len(s)` is the loop guard. But:

```go
for i := 0; i < n; i++ {
    sum += s[i] // n might be > len(s); check required
}
```

To force elision:

```go
_ = s[n-1] // panic-or-pass before the loop
for i := 0; i < n; i++ {
    sum += s[i] // compiler knows s[0..n-1] in range
}
```

Or use `range`, which is always bounds-check-free for the element:

```go
for _, v := range s {
    sum += v
}
```

For tight numerical loops, profiling will reveal whether bounds checks matter. Use `go build -gcflags="-d=ssa/check_bce/debug=1"` to see which checks were emitted.

---

## 19. Vectorisable inner loops

A `for ... range []float64` over contiguous data can be auto-vectorised by the compiler in Go 1.22+ if the body is simple enough (single arithmetic, no function calls, no branches). The slice header points to contiguous memory, which is necessary for SIMD.

```go
func sum(s []float64) float64 {
    var t float64
    for _, v := range s {
        t += v
    }
    return t
}
```

Compiler in Go 1.22+ can emit SIMD adds on amd64. Verify with `go build -gcflags="-S"` and look for SIMD instructions (`ADDPD`, `MOVUPD`).

For very hot numeric paths, `math.Float64bits` tricks, manual unrolling, or assembly may be warranted — but the contiguous-array property of slices is what makes any of it possible.

---

## 20. Profile slice-heavy code

The minimal recipe:

```bash
go test -bench=. -benchmem -cpuprofile=cpu.out -memprofile=mem.out
go tool pprof -http=:8080 cpu.out
go tool pprof -http=:8080 mem.out
```

In the CPU profile, look for:

- `runtime.growslice` — preallocate.
- `runtime.memmove` — large copies; consider reslicing or aliasing.
- `runtime.typedslicecopy` — pointer-bearing copies; consider SoA reshaping.
- `runtime.mallocgc` — many small allocations; pool or batch.

In the memory profile, look for:

- Allocations from `make` paths — same advice as above.
- Large heap retained by small slices — clone at the boundary.

The flame graph for a slice-heavy hot path is dominated by one or two of these names. Each has a specific countermeasure from earlier in this file.

---

## 21. Anti-patterns to avoid

| Pattern | Why bad | Replacement |
|---------|---------|-------------|
| `var s []T; copy(s, src)` | `s` has len 0; copies zero elements | `s := slices.Clone(src)` |
| `append(make([]T, 0, n), ...)` with n wrong | If too small, you get growth anyway | Measure or use slices.Grow |
| `reflect.SliceHeader{...}` for construction | GC-unsafe; deprecated | `unsafe.Slice(ptr, n)` |
| `(*[1<<30]byte)(p)[:n:n]` | Linter unfriendly | `unsafe.Slice((*byte)(p), n)` |
| `s = append(s, item)` of a pointer-to-slice field outside a method | Header on heap | Method with value receiver returning the new slice |
| Storing slices in `sync.Pool` directly (not pointers) | Header copied in/out | Store `*[]T` |
| `return s` for an internal-state sub-slice | Caller may mutate | `return s[:n:n]` or `slices.Clone(s)` |

---

## 22. Summary

Slice optimisation is overwhelmingly about three behaviours: **allocate the right size up front** (`make([]T, 0, n)`, `slices.Grow`), **avoid spurious copies** (`unsafe.Slice`, `unsafe.SliceData`, peephole `string`/`[]byte`), and **bound the lifetime of large backing arrays** (`s[:n:n]`, `slices.Clone` at boundaries). Pooling is a layer above that for request-scoped buffers. The slices package and the unsafe.Slice/SliceData family are the stdlib-blessed answers to most patterns; prefer them. Profile early; the slice-heavy CPU/memory profiles are usually dominated by one of `growslice`, `memmove`, `typedslicecopy`, or `mallocgc`, each with a specific fix.

---

## Further reading
- `slices` package — https://pkg.go.dev/slices
- `runtime/sizeclasses.go` — https://github.com/golang/go/blob/master/src/runtime/sizeclasses.go
- `runtime/slice.go` — https://github.com/golang/go/blob/master/src/runtime/slice.go
- `unsafe.Slice`/`SliceData` — https://pkg.go.dev/unsafe#Slice
- Go 1.22 SIMD compiler notes — https://go.dev/doc/go1.22#compiler
- Go GC guide — https://go.dev/doc/gc-guide

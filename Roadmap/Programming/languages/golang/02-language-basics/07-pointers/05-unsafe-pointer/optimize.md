# Unsafe Pointer — Optimize

## 1. Goal of this file

This file is about **when `unsafe.Pointer` actually pays off and when it doesn't**. The temptation to reach for `unsafe` is strong — it feels like the lowest-level, fastest option. In practice the win is narrow: a handful of patterns where the compiler-optimized safe equivalent has irreducible overhead that the unsafe version skips. Everywhere else, `unsafe` is the same speed or *slower* than the safe path (because it disables escape analysis) and carries audit cost the safe path doesn't.

The structure of this file:

1. The wins that are real (zero-copy I/O, header parsing, mmap, `[]byte`/`string` round-trips).
2. The wins that aren't (range loops, struct field access, generic containers).
3. How to measure honestly (microbench + allocation count + a realistic load test).
4. How to guard hot paths so a regression in compiler optimization doesn't silently revert your win.

The realistic envelope: 5–50× speedup for the few patterns where it's the right tool; 0× elsewhere.

---

## 2. The measurement baseline

Before optimizing, write the safe version and benchmark it.

```go
func bytesToStringSafe(b []byte) string {
    return string(b)
}

func bytesToStringUnsafe(b []byte) string {
    if len(b) == 0 {
        return ""
    }
    return unsafe.String(unsafe.SliceData(b), len(b))
}

func BenchmarkBytesToString(b *testing.B) {
    data := []byte(strings.Repeat("x", 1024))
    b.Run("safe", func(b *testing.B) {
        var sink string
        for i := 0; i < b.N; i++ {
            sink = bytesToStringSafe(data)
        }
        _ = sink
    })
    b.Run("unsafe", func(b *testing.B) {
        var sink string
        for i := 0; i < b.N; i++ {
            sink = bytesToStringUnsafe(data)
        }
        _ = sink
    })
}
```

Typical output:

```
BenchmarkBytesToString/safe-8         5000000   320 ns/op   1024 B/op   1 allocs/op
BenchmarkBytesToString/unsafe-8     500000000     2.0 ns/op      0 B/op   0 allocs/op
```

160× faster, zero allocations. That's a real win for the conversion **considered in isolation**. Whether it's a real win for your service depends on whether this conversion is in your hot path. Profile first.

For a profiling-driven view:

```bash
go test -bench=. -cpuprofile=cpu.prof -memprofile=mem.prof
go tool pprof -top cpu.prof
go tool pprof -top mem.prof
```

If `bytesToString` is 0.1% of CPU and 0.5% of allocations, swapping it for the unsafe version is 0.5% of allocations saved — not worth the review burden. If it's 30%, the change is worth shipping.

---

## 3. When `unsafe` pays off: zero-copy I/O

The single most common production win. Parsing binary protocols (Kafka, gRPC frames, Postgres wire, custom RPC) involves consuming bytes off the wire and producing typed values. The naive path allocates and copies; the `unsafe` path views the buffer directly.

```go
// Safe: encoding/binary
type Frame struct {
    Length  uint32
    Version uint16
    Type    uint16
    Payload []byte
}

func parseFrameSafe(buf []byte) (*Frame, error) {
    if len(buf) < 8 {
        return nil, errors.New("short")
    }
    return &Frame{
        Length:  binary.BigEndian.Uint32(buf[0:4]),
        Version: binary.BigEndian.Uint16(buf[4:6]),
        Type:    binary.BigEndian.Uint16(buf[6:8]),
        Payload: buf[8:],
    }, nil
}
```

```go
// Unsafe: zero-copy header view (assuming the wire format is the host's endianness;
// for big-endian wire on little-endian host, you still need byteswap).
type FrameHeader struct {
    Length  uint32
    Version uint16
    Type    uint16
}

func parseFrameUnsafe(buf []byte) (*FrameHeader, []byte, error) {
    const sz = unsafe.Sizeof(FrameHeader{})
    if uintptr(len(buf)) < sz {
        return nil, nil, errors.New("short")
    }
    if uintptr(unsafe.Pointer(&buf[0]))%unsafe.Alignof(FrameHeader{}) != 0 {
        return nil, nil, errors.New("misaligned")
    }
    h := (*FrameHeader)(unsafe.Pointer(&buf[0]))
    return h, buf[sz:], nil
}
```

For little-endian wire on little-endian host (typical), the unsafe version is ~5× faster: zero allocations, no individual `binary.BigEndian.Uint32` calls.

For mixed endianness, you can do a single field swap after the cast — still faster than per-field decoding.

**Caveats:**
- Caller must keep `buf` alive while using `*FrameHeader`. Document this.
- Alignment must be checked (8-byte for the `uint32`/`uint16` layout above).
- Endianness must match. Misuse here produces silently-wrong data.

---

## 4. When `unsafe` pays off: `[]byte` ↔ `string` in hot paths

Already covered in §2. The win shape:

| Scenario | Safe ns/op | Unsafe ns/op | Allocs saved |
|----------|------------|--------------|--------------|
| 1 KiB conversion in a JSON encoder | ~300 | ~0.5 | 1 per call |
| Short (16-byte) header strings | ~10 | ~0.5 | 1 per call |
| Very short (< 32 bytes) where compiler stack-allocates | ~5 | ~0.5 | 0 (compiler optimized) |

The catch: Go 1.20+'s compiler stack-allocates `string(b)` for small constant-bound `b`. The compiler is improving each release. Re-measure on every Go upgrade; a future compiler may make the unsafe version unnecessary.

---

## 5. When `unsafe` pays off: mmap and large file processing

Mapping a 10 GiB file via `mmap` and viewing it as `[]uint64` (or your record type) gives zero-allocation reads:

```go
// (Setup as in professional.md §4)
ints := unsafe.Slice((*uint64)(unsafe.Pointer(addr)), totalSize/8)

// Process 1 billion uint64s with zero Go heap allocation
var sum uint64
for _, v := range ints {
    sum += v
}
```

The alternative is `os.Open` + `bufio.Scanner` + `binary.LittleEndian.Uint64`. For sequential reads, the safe path might be roughly as fast (the kernel page cache is the bottleneck), but for **random access** over a large region, mmap + unsafe view wins by 10–100×.

When the file is larger than RAM, mmap still works (the kernel pages in on demand); the safe path becomes "implement your own page cache", which is impractical.

This is the canonical "unsafe is the only option" case. Databases (BoltDB, LMDB-backed stores) use it; analytics engines use it; large-binary-format parsers (Parquet, Arrow) use it.

---

## 6. When `unsafe` doesn't pay off: range-loop "optimizations"

A common attempt:

```go
type Item struct { X, Y, Z int64 }

// "Optimized" with unsafe arithmetic
func sumXUnsafe(items []Item) int64 {
    if len(items) == 0 { return 0 }
    var s int64
    p := unsafe.Pointer(&items[0])
    sz := unsafe.Sizeof(Item{})
    for i := 0; i < len(items); i++ {
        s += (*Item)(unsafe.Add(p, uintptr(i)*sz)).X
    }
    return s
}

// Safe
func sumXSafe(items []Item) int64 {
    var s int64
    for _, it := range items {
        s += it.X
    }
    return s
}
```

Benchmark on a slice of 1 million `Item`:

```
BenchmarkSumX/safe-8     3000   400000 ns/op   0 B/op   0 allocs/op
BenchmarkSumX/unsafe-8   3000   405000 ns/op   0 B/op   0 allocs/op
```

The same speed. Why? Because the Go compiler's range-loop optimizer produces nearly identical assembly to the manual `unsafe.Add` version. The bounds check on `items[i]` is hoisted out of the loop (`i < len(items)` is checked once, not per iteration). The compiler knows the stride.

The unsafe version offers no win and adds review burden. **Don't use `unsafe` for tight loops over typed slices.** The compiler is already doing the work.

The exception: if you're walking a `[]byte` and viewing 8 bytes at a time as `uint64`, that's pattern 1 + iteration, not just iteration. Different case (see §3).

---

## 7. When `unsafe` doesn't pay off: struct field access

```go
type Big struct {
    A, B, C, D, E, F, G, H int64
    Tail [128]byte
}

// "Optimized"
func getHUnsafe(b *Big) int64 {
    return *(*int64)(unsafe.Add(unsafe.Pointer(b), unsafe.Offsetof(Big{}.H)))
}

// Safe
func getHSafe(b *Big) int64 {
    return b.H
}
```

Both compile to a single load instruction at offset 56. Same speed, exactly.

The unsafe version exists in some libraries that need to reach **unexported** fields of *other* packages (e.g., `runtime.MemStats` internals via `//go:linkname`). That's the only legitimate use. For your own structs, just access the field.

---

## 8. When `unsafe` doesn't pay off: generic containers

Pre-generics Go used `unsafe.Pointer` to build type-erased containers:

```go
type Set struct{ m map[unsafe.Pointer]struct{} }

func (s *Set) Add(x any) { ... }
```

This was sometimes a win when you needed `any` but the boxed allocation hurt. With Go 1.18+ generics, the unsafe machinery is obsolete:

```go
type Set[T comparable] struct{ m map[T]struct{} }

func (s *Set[T]) Add(x T) { ... }
```

Generic code is type-safe, allocates the same memory, and is just as fast. Audit any pre-1.18 `unsafe.Pointer`-based container; almost all of them should migrate to generics.

---

## 9. The compiler's safe alternatives that beat naive code

Sometimes the right "optimization" isn't `unsafe` at all but using the standard library's specialized functions:

| Naive code | Better alternative | Why faster |
|------------|-------------------|------------|
| `string(b) == "literal"` | `bytes.Equal(b, []byte("literal"))` | Avoids string allocation |
| `strings.HasPrefix(s, "pre")` | (already optimal) | Compiler stack-allocates the slice |
| `b := []byte(s); b[0] = 'A'; string(b)` | `strings.Replace(s, s[:1], "A", 1)` | Less obvious; benchmark both |
| Hand-rolled `unsafe.Slice` for mmap | `golang.org/x/exp/mmap` package | Already does it correctly |
| Hand-rolled `unsafe.Pointer` JSON parser | `encoding/json` with `RawMessage`, or `sonic` | Industry-tested |

The "best optimization" is often "use a library someone else has hardened with `unsafe`". You inherit the wins without inheriting the audit burden.

---

## 10. Guarding hot paths against regression

`unsafe`-using code is brittle. The compiler version, the struct layout, the Go memory model assumptions can all change. Without explicit checks, a regression in your `unsafe` code is invisible until production.

Three guards:

### 10.1 Layout assertions at init

```go
func init() {
    if got, want := unsafe.Sizeof(FrameHeader{}), uintptr(8); got != want {
        panic(fmt.Sprintf("FrameHeader size: got %d, want %d (compiler layout changed?)", got, want))
    }
}
```

If a future Go version pads the struct differently, you crash at startup with a clear message instead of corrupting wire data.

### 10.2 Property-based testing against the safe path

```go
func FuzzFrameParse(f *testing.F) {
    f.Fuzz(func(t *testing.T, buf []byte) {
        safe, safeErr := parseFrameSafe(buf)
        unsafe, unsafeErr := parseFrameUnsafe(buf)

        // Both must agree on error / success
        if (safeErr == nil) != (unsafeErr == nil) {
            t.Fatalf("disagree on error: safe=%v unsafe=%v", safeErr, unsafeErr)
        }
        if safeErr != nil {
            return
        }
        if safe.Length != unsafe.Length || safe.Version != unsafe.Version {
            t.Fatalf("disagree on fields: safe=%+v unsafe=%+v", safe, unsafe)
        }
    })
}
```

The fuzzer generates inputs neither author considered. Any divergence between safe and unsafe paths is a bug in one of them — usually the unsafe one.

### 10.3 Benchmark regressions in CI

```bash
go test -bench=BenchmarkParseFrame -benchmem -count=10 ./... | tee bench.txt
benchstat oldbench.txt bench.txt   # compare to previous baseline
```

If your unsafe parser used to be 5× faster than safe and is now only 1.2× faster, the compiler has improved the safe path. Time to delete the unsafe version.

---

## 11. The `-gcflags="-m"` view

Always check escape analysis on `unsafe`-touching code:

```bash
go build -gcflags="-m" ./...
```

What you want to see:

```
./fast.go:42:18: parseFrame &buf[0] does not escape
```

What you don't want to see:

```
./fast.go:42:18: parseFrame &buf[0] escapes to heap
./fast.go:43:13: (*Header)(...) escapes to heap
```

If your "optimization" forces an unexpected heap allocation, the result is *slower* than the safe version. Check before shipping.

The hidden cost: `unsafe.Pointer(&x)` in any expression that flows to a non-inlined function call escapes `x`. Inlining matters; mark hot wrappers with `//go:inline` if needed (and verify it took effect with `-gcflags="-m=2"`).

---

## 12. When provisioned-concurrency-like tricks help (and when they don't)

For very tight loops where every nanosecond counts, three patterns occasionally squeeze more speed:

### 12.1 Pool-allocated typed buffers

```go
var headerPool = sync.Pool{
    New: func() any { return &FrameHeader{} },
}

func parseFrame(buf []byte) *FrameHeader {
    h := headerPool.Get().(*FrameHeader)
    // Note: this copies! Not zero-copy. Trade-off depends on whether you want
    // the header to outlive buf.
    *h = *(*FrameHeader)(unsafe.Pointer(&buf[0]))
    return h
}
```

The pool avoids per-call allocation when the header must outlive `buf`. The single struct copy (8 bytes) is faster than the heap allocation of a fresh `*FrameHeader`.

### 12.2 SIMD-like batched reads

```go
// View 32 bytes as 4 uint64s; the CPU loads 4 quads in one cache line.
words := unsafe.Slice((*uint64)(unsafe.Pointer(&buf[0])), 4)
sum := words[0] + words[1] + words[2] + words[3]
```

The CPU autopreloads cache lines. Aligned 64-bit reads beat per-byte access by 4–8× on modern x86. Code generators for hash/checksum routines lean on this heavily.

### 12.3 Cache-aligned struct layout

```go
type ProducerState struct {
    seq uint64
    _   [56]byte   // pad to 64 bytes (cache line)
}

type ConsumerState struct {
    seq uint64
    _   [56]byte
}
```

The padding ensures producer and consumer don't share a cache line, eliminating false sharing. `unsafe.Sizeof` and `unsafe.Alignof` help verify the padding worked:

```go
func init() {
    if unsafe.Sizeof(ProducerState{}) != 64 {
        panic("ProducerState not 64-byte padded")
    }
}
```

These tricks belong in framework-level code (queues, channels, lock-free data structures), not application logic.

---

## 13. When NOT to use `unsafe`, briefly

| Anti-pattern | Why |
|--------------|-----|
| Replacing a single `string()` cast in a non-hot path | Saves 300 ns at 0.001 % traffic; not worth the audit |
| "Type erasure" containers (post-Go-1.18) | Generics do it type-safely and equally fast |
| Tight loops with typed-slice access | Compiler already vectorizes the safe form |
| Pointer arithmetic into objects you didn't allocate | Pattern violations + lifetime bugs |
| Working around an API you find inconvenient | The wrong layer of fix |
| Microservice glue code | Network IO dominates; CPU savings invisible |

The default answer to "should we use `unsafe` here?" is **no**. The yes cases are narrow and benchmark-justified.

---

## 14. A complete optimized example: zero-copy newline split

A common parsing primitive: split a `[]byte` into lines without allocating a `[][]byte`. The unsafe view returns a slice of `string`s, each aliasing into the input buffer:

```go
package zerocopy

import "unsafe"

// SplitLines returns a slice of strings, each aliasing into b. Caller must
// not mutate b while using the returned slice. The returned strings live
// only as long as b lives.
func SplitLines(b []byte) []string {
    if len(b) == 0 {
        return nil
    }
    // Count newlines for capacity hint
    n := 1
    for _, c := range b {
        if c == '\n' {
            n++
        }
    }
    out := make([]string, 0, n)
    start := 0
    for i, c := range b {
        if c == '\n' {
            out = append(out, unsafe.String(unsafe.SliceData(b[start:i]), i-start))
            start = i + 1
        }
    }
    if start < len(b) {
        out = append(out, unsafe.String(unsafe.SliceData(b[start:]), len(b)-start))
    }
    return out
}
```

Benchmark on a 1 MiB input with ~10 000 lines:

```
BenchmarkSplitLines/strings.Split-8    300   4_500_000 ns/op   2_400_000 B/op   2 allocs/op
BenchmarkSplitLines/zerocopy-8        1500     900_000 ns/op     400_000 B/op   2 allocs/op
```

5× faster, 6× less allocation. The remaining allocation is the `out []string` slice itself — unavoidable since the caller wants to iterate.

For the common case "iterate lines without keeping them", an iterator (Go 1.23+ `range`-over-func) is even cheaper:

```go
func IterLines(b []byte, yield func(string) bool) {
    start := 0
    for i, c := range b {
        if c == '\n' {
            if !yield(unsafe.String(unsafe.SliceData(b[start:i]), i-start)) {
                return
            }
            start = i + 1
        }
    }
    if start < len(b) {
        yield(unsafe.String(unsafe.SliceData(b[start:]), len(b)-start))
    }
}
```

Zero allocations for the iteration — the caller's `yield` decides whether to keep each string. The unsafe view stays valid for the duration of `yield`'s call.

---

## 15. The optimization checklist

Before shipping any `unsafe`-using "optimization", run through this list:

1. [ ] Safe version benchmarked.
2. [ ] Unsafe version benchmarked.
3. [ ] Both produce identical output on a fuzz suite.
4. [ ] `-gcflags=-m` shows no unexpected escapes.
5. [ ] `-d=checkptr` and `-race` clean.
6. [ ] Layout assertions in `init()` for any struct-layout dependency.
7. [ ] Lifetime contract documented on every exported function.
8. [ ] Code review has signed off on the unsafe usage explicitly.
9. [ ] The benchmark improvement is large enough to matter (rule of thumb: 2× or 10 % of service CPU).
10. [ ] CI regression check (`benchstat`) prevents future slowdowns.

If any of these are missing, the optimization isn't ready.

---

## 16. Summary

The `unsafe.Pointer` wins worth shipping cluster in four areas: zero-copy `[]byte`/`string` round-trips in hot serialization paths (~100–600× faster), fixed-layout binary header parsing in network/file IO (~5–10× faster), mmap-backed large-file processing (only viable approach above RAM size), and SIMD-like batched memory access in framework-level code. Everything else — range-loop "optimizations", struct field access via offsets, generic containers — is either neutral or actively worse because of escape-analysis pessimism. Always benchmark, always check escape with `-gcflags=-m`, always fuzz the safe and unsafe versions for equivalence, and always gate the win behind layout assertions so a compiler change doesn't silently break wire formats. The realistic envelope: 5–50× speedup for the few patterns where it's the right tool; 0× elsewhere. Most production codebases need fewer than ten lines of `unsafe.Pointer`; the rest is the safe path.

---

## Further reading
- `unsafe.Pointer` rules: https://pkg.go.dev/unsafe#Pointer
- Go escape analysis: https://github.com/golang/go/wiki/CompilerOptimizations
- `benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
- Sibling: [memory-management](../04-memory-management/)
- Related: [string-internals](../../02-data-types/07-string-internals/)
- Related: [slice-header-internals](../../03-composite-types/02-slices/05-slice-header-internals/)
- Related: [unsafe-package](../../../11-advanced-topics/04-unsafe-package/)
- Industry-grade JSON with unsafe: https://github.com/bytedance/sonic
- Mmap helpers: https://pkg.go.dev/golang.org/x/exp/mmap

# Slice Capacity and Growth — Interview Q&A

> **Format:** Questions grouped by seniority level, each with a full answer and code example.

---

## Junior Level Questions

### Q1. What is the difference between `len` and `cap` for a slice?

**Answer:**

`len` is the number of elements currently accessible in the slice. `cap` is the total number of elements the backing array can hold starting from the slice's first element. You can read or write elements in positions `0..len-1`. Positions `len..cap-1` exist in memory but are hidden from the slice.

```go
s := make([]int, 3, 7)
fmt.Println(len(s)) // 3 — accessible elements
fmt.Println(cap(s)) // 7 — total capacity

s[0] = 1 // OK
s[2] = 3 // OK
// s[3] = 4 // panic: index out of range (even though cap=7)

// But you can expose hidden elements:
s2 := s[:5] // len=5, cap=7 — positions 3 and 4 are now accessible
```

---

### Q2. What does `append` do when the slice has remaining capacity?

**Answer:**

When `len(s) < cap(s)`, `append` writes the new element directly into the next position of the existing backing array (at index `len(s)`) and returns a new slice header with `len` incremented by 1. No allocation occurs.

```go
s := make([]int, 2, 5) // len=2, cap=5
fmt.Printf("before: len=%d cap=%d ptr=%p\n", len(s), cap(s), &s[0])

s = append(s, 99)
fmt.Printf("after:  len=%d cap=%d ptr=%p\n", len(s), cap(s), &s[0])
// ptr is the SAME — no allocation happened
// Output:
// before: len=2 cap=5 ptr=0xc000...
// after:  len=3 cap=5 ptr=0xc000...  ← same address
```

---

### Q3. What happens when `append` exceeds the slice's capacity?

**Answer:**

When `len(s) == cap(s)` and you call `append`, the runtime:
1. Allocates a new, larger backing array
2. Copies all existing elements from the old array to the new one
3. Writes the new element at position `len(s)`
4. Returns a new slice header pointing to the new array

The old backing array becomes garbage eligible for collection.

```go
s := make([]int, 3, 3) // cap exactly 3
fmt.Printf("before: cap=%d ptr=%p\n", cap(s), &s[0])

s = append(s, 99) // exceeds cap!
fmt.Printf("after:  cap=%d ptr=%p\n", cap(s), &s[0])
// ptr CHANGED — new backing array allocated
// cap grew to 6 (approximately doubled)
```

---

### Q4. How do you pre-allocate a slice in Go?

**Answer:**

Use `make` with a capacity argument: `make([]T, 0, n)`. This allocates a backing array for `n` elements but starts with `len=0`. Use `append` to add elements without causing reallocations (as long as you don't exceed `n`).

```go
// Without pre-allocation: ~17 allocations for 100,000 elements
var s []int
for i := 0; i < 100_000; i++ {
    s = append(s, i)
}

// With pre-allocation: 1 allocation for 100,000 elements
s := make([]int, 0, 100_000)
for i := 0; i < 100_000; i++ {
    s = append(s, i)
}
```

---

### Q5. What is the difference between `make([]T, n)` and `make([]T, 0, n)`?

**Answer:**

- `make([]T, n)`: creates a slice with `len=n` and `cap=n`. The slice has `n` accessible elements, all zero-valued. Use indexing (`s[i] = v`) to populate it.
- `make([]T, 0, n)`: creates a slice with `len=0` and `cap=n`. The backing array is allocated but no elements are exposed. Use `append` to add elements.

```go
s1 := make([]int, 5)    // [0 0 0 0 0], len=5, cap=5
s1[0] = 10              // correct

s2 := make([]int, 0, 5) // [], len=0, cap=5
s2 = append(s2, 10)     // [10], len=1, cap=5

// Common mistake with make([]T, n) + append:
s3 := make([]int, 5)
s3 = append(s3, 10) // [0 0 0 0 0 10] — NOT [10]!
```

---

### Q6. Can you directly read elements beyond `len` if there is remaining capacity?

**Answer:**

No. Accessing `s[i]` where `i >= len(s)` causes a panic, even if `i < cap(s)`. Capacity is a runtime implementation detail that determines when reallocation occurs. To access those elements, you must first extend the slice's length, either by re-slicing (`s = s[:i+1]`) or by appending.

```go
s := make([]int, 3, 7)
// s[4] = 99 // panic: runtime error: index out of range [4] with length 3

s = s[:5] // extend length to 5 (still within cap=7)
s[4] = 99 // now OK
```

---

### Q7. How can you observe when Go reallocates a slice backing array?

**Answer:**

Compare the pointer address before and after `append`. When the pointer changes, a new backing array was allocated:

```go
s := make([]int, 0)
var prevPtr uintptr

for i := 0; i < 20; i++ {
    if len(s) > 0 {
        prevPtr = uintptr(unsafe.Pointer(&s[0]))
    }
    s = append(s, i)
    if len(s) > 1 {
        newPtr := uintptr(unsafe.Pointer(&s[0]))
        if newPtr != prevPtr {
            fmt.Printf("reallocated at len=%d, new cap=%d\n", len(s), cap(s))
        }
    }
}
```

A simpler way is to track `cap(s)` and log when it changes:

```go
prevCap := 0
for i := 0; i < 50; i++ {
    s = append(s, i)
    if cap(s) != prevCap {
        fmt.Printf("grew to cap=%d\n", cap(s))
        prevCap = cap(s)
    }
}
```

---

## Middle Level Questions

### Q8. Explain the Go 1.18+ slice growth algorithm and why it was changed.

**Answer:**

Before Go 1.18, the growth strategy was:
- `cap < 1024`: double the capacity
- `cap >= 1024`: grow by 25%

This created a **sharp discontinuity** at 1024: a slice with cap=1023 would grow to 2046 (+100%), but a slice with cap=1024 would only grow to 1280 (+25%). This fragmented memory allocation patterns and caused surprising behavior.

Go 1.18+ replaced this with a **smooth curve** using the formula:
```
if oldCap < 256:
    newCap = 2 * oldCap
else:
    loop: newCap += (newCap + 3*256) / 4
          until newCap >= newLen
```

This interpolates smoothly from 2x growth (small slices) toward 1.25x growth (large slices), eliminating the cliff at 1024.

After computing `newCap`, the runtime rounds it **up to the nearest memory allocator size class** (8, 16, 24, 32, 48, 64, ...), which is why `cap(s)` after an append can be larger than the formula predicts.

```go
s := make([]int64, 0)
var prev int
for len(s) < 2000 {
    s = append(s, 0)
    if cap(s) != prev {
        growth := 0.0
        if prev > 0 {
            growth = float64(cap(s)) / float64(prev)
        }
        fmt.Printf("cap=%d (growth factor: %.2f)\n", cap(s), growth)
        prev = cap(s)
    }
}
```

---

### Q9. What is the three-index slice expression and when should you use it?

**Answer:**

The three-index expression `s[low:high:max]` creates a sub-slice where:
- `len = high - low`
- `cap = max - low`

The third index restricts capacity, preventing the sub-slice from "seeing" elements beyond `max`.

**Use case 1: preventing accidental overwrites**
```go
base := make([]int, 3, 10)
// Without three-index: sub-slice can overwrite base's extra capacity
sub1 := base[:3]           // cap=10, append writes to base[3..9]!
sub1 = append(sub1, 99)    // modifies base's backing array

// With three-index: sub-slice has its own capacity boundary
sub2 := base[:3:3]         // cap=3, append forces new allocation
sub2 = append(sub2, 99)    // new backing array, base untouched
```

**Use case 2: buffer pool safety**
```go
func borrowBuffer() []byte {
    buf := pool.Get().(*[4096]byte)
    return buf[:0:4096] // expose empty slice with full pool capacity
    // caller's appends stay within the 4096-byte pool buffer
}
```

---

### Q10. How does sub-slice retention cause memory leaks? Show a concrete example.

**Answer:**

When you take a sub-slice, both the sub-slice and the original share the same backing array. If you keep the sub-slice alive and discard the original reference, the GC cannot collect the original backing array — the sub-slice's pointer is still pointing into it.

```go
var retained []byte

func loadAndProcess() {
    // Allocate 100MB
    bigBuffer := make([]byte, 100*1024*1024)
    readFromNetwork(bigBuffer)

    // Keep only first 16 bytes
    retained = bigBuffer[:16] // BUG: 100MB backing array stays alive!
    // bigBuffer goes out of scope, but its backing array is
    // still referenced by retained.Data pointer
}

// Fix: copy the needed portion
func loadAndProcessFixed() {
    bigBuffer := make([]byte, 100*1024*1024)
    readFromNetwork(bigBuffer)

    header := make([]byte, 16)
    copy(header, bigBuffer[:16])
    retained = header // 100MB backing array is now unreferenced and can be GC'd
}
```

---

### Q11. How does `sync.Pool` interact with slice capacity? Show a pattern.

**Answer:**

`sync.Pool` is used to reuse slice backing arrays across function calls, avoiding repeated allocations. The key is to store a **pointer to the slice** (not the slice value) so that the updated backing array is correctly returned to the pool after potential reallocation.

```go
var bufPool = sync.Pool{
    New: func() any {
        s := make([]byte, 0, 1024)
        return &s
    },
}

func processRequest(data []byte) []byte {
    // Borrow
    pSlice := bufPool.Get().(*[]byte)
    buf := (*pSlice)[:0] // reset length, preserve capacity

    // Use
    buf = append(buf, data...)
    buf = transform(buf)

    // Copy result before returning buf to pool
    result := make([]byte, len(buf))
    copy(result, buf)

    // Return (IMPORTANT: update the pointer in case append reallocated)
    *pSlice = buf
    bufPool.Put(pSlice)

    return result
}
```

The critical detail: `*pSlice = buf` before `Put`. If `append` inside the function reallocated `buf`, the old backing array is gone — the pool must receive the new one.

---

### Q12. When does `cap(s)` equal `len(s)` after an `append`?

**Answer:**

`cap(s)` equals `len(s)` after `append` when the new length exactly fills a memory size class, OR when you used `append(s[:0:0], elements...)` to build a new slice from scratch.

In practice, `cap` is almost always larger than `len` after growth because the runtime rounds up to size classes. But you can force `cap == len` using `slices.Clip`:

```go
import "slices"

s := make([]int, 0)
for i := 0; i < 5; i++ {
    s = append(s, i)
}
fmt.Println(len(s), cap(s)) // 5 8 (or similar, depends on growth)

s = slices.Clip(s)
fmt.Println(len(s), cap(s)) // 5 5 — cap reduced to len
```

`slices.Clip` is useful when you've finished building a slice and want to minimize its memory footprint before storing it long-term.

---

### Q13. Explain the cost of `append` in terms of algorithmic complexity.

**Answer:**

`append` has **amortized O(1)** time complexity per element appended.

- When capacity is available: O(1) — just write one element
- When capacity is exceeded: O(n) — copy all n elements to new array

However, because the growth factor is ≥ 1.25x (and ~2x for small slices), the total number of copies across all growth events is bounded by O(n). Proof: if final length is n and we double each time, copies are 1 + 2 + 4 + ... + n/2 = n - 1.

This means appending n elements to a nil slice costs O(n) total — same as filling a pre-allocated slice. Pre-allocation just eliminates the constant factor (number of `mallocgc` calls).

```go
// Both are O(n) total work:
// Option A: pre-allocated
s := make([]int, 0, n)
for i := 0; i < n; i++ { s = append(s, i) } // n writes, 1 malloc

// Option B: organic growth
var s []int
for i := 0; i < n; i++ { s = append(s, i) } // n writes, log2(n) mallocs
```

---

## Senior Level Questions

### Q14. A service has P99 latency of 10ms but P999 latency of 2 seconds. How might slice capacity be the cause, and how would you diagnose it?

**Answer:**

P999 spikes (rare but severe) are a classic signature of GC-pause-induced latency. Slice growth can trigger this pattern:

**Mechanism:**
1. A hot-path function builds a large slice without pre-allocation
2. For most requests, the slice happens to stay small (fast path)
3. Occasionally, input is large — the slice reallocates 15-18 times
4. The last reallocation copies tens of megabytes — pausing the goroutine
5. The discarded backing arrays create GC pressure
6. GC pause hits unrelated goroutines — P999 spike

**Diagnosis:**
```bash
# 1. Look for growslice in heap profiles
go tool pprof http://localhost:6060/debug/pprof/heap
(pprof) top10

# 2. Count growslice calls
GODEBUG=allocfreetrace=1 ./service 2>&1 | grep growslice | wc -l

# 3. Benchmark with -benchmem
go test -bench=BenchmarkHotPath -benchmem -count=10
# Look for high allocs/op and B/op in the hot function

# 4. Add alloc tracing to the function
import "testing"
allocs := testing.AllocsPerRun(100, func() {
    processBigRequest(testInput)
})
```

**Fix:**
```go
// Before
func processRequest(items []Item) []Result {
    var results []Result // zero allocation, grows organically
    for _, item := range items {
        results = append(results, process(item))
    }
    return results
}

// After
func processRequest(items []Item) []Result {
    results := make([]Result, 0, len(items)) // worst-case pre-allocation
    for _, item := range items {
        results = append(results, process(item))
    }
    return results
}
```

---

### Q15. How does the memory allocator size-class rounding affect capacity-sensitive code?

**Answer:**

Go's allocator (`mallocgc`) works with fixed size classes rather than arbitrary sizes. When `growslice` computes a new capacity, it calls `roundupsize` to align to the nearest size class. This means:

- You request capacity for 13 `int64` values (104 bytes)
- Nearest size class is 112 bytes = 14 `int64` values
- `cap(s)` becomes 14, not 13

This has practical implications:

```go
// Code that checks "did we grow past our budget?"
budgetCap := 100
s := make([]int64, 0, budgetCap)

// After some appends that triggered growth:
if cap(s) > budgetCap {
    // This may trigger unexpectedly due to rounding!
    // cap might be 104, 112, or 128 — all > 100
}
```

For capacity-critical code (where exact memory budgets matter), use:
```go
// After building, trim to exact len:
import "slices"
s = slices.Clip(s) // cap == len, no wasted memory
```

---

### Q16. Design a capacity management strategy for a streaming pipeline where element sizes vary by 100×.

**Answer:**

When element sizes vary greatly (e.g., small log entries and large JSON blobs), static pre-allocation wastes memory for small inputs and under-allocates for large ones. Use **exponentially-weighted moving average (EWMA) estimation**:

```go
type AdaptiveBuffer[T any] struct {
    mu    sync.Mutex
    ewma  float64 // smoothed average of observed lengths
    alpha float64 // 0.1 = slow, 0.9 = fast adaptation
}

func NewAdaptiveBuffer[T any](alpha float64) *AdaptiveBuffer[T] {
    return &AdaptiveBuffer[T]{alpha: alpha, ewma: 64}
}

func (a *AdaptiveBuffer[T]) Estimate() int {
    a.mu.Lock()
    defer a.mu.Unlock()
    return int(a.ewma * 1.5) // 50% headroom above average
}

func (a *AdaptiveBuffer[T]) Record(n int) {
    a.mu.Lock()
    defer a.mu.Unlock()
    a.ewma = a.alpha*float64(n) + (1-a.alpha)*a.ewma
}

// Usage in pipeline:
var estimator = NewAdaptiveBuffer[Event](0.1)

func processBatch(events []Event) []ProcessedEvent {
    hint := estimator.Estimate()
    results := make([]ProcessedEvent, 0, hint)

    for _, e := range events {
        results = append(results, process(e))
    }

    estimator.Record(len(results))
    return results
}
```

This converges to the typical output size, minimizing both waste and reallocation frequency.

---

### Q17. What are the write barrier implications of growing a `[]*T` slice vs a `[]T` slice?

**Answer:**

When `growslice` copies elements from the old backing array to the new one:

- **`[]T` (value types, no pointers):** `memmove` — no write barriers, minimal overhead
- **`[]*T` or `[]T` where T contains pointers:** each pointer write must go through a GC write barrier

The write barrier:
1. Marks the pointer as "needs to be scanned"
2. Ensures the GC's tricolor invariant is maintained
3. Adds ~2-3 ns per pointer write

For a slice of 100,000 structs containing pointers, a growth event must execute 100,000 write-barrier-protected pointer copies. This is significantly slower than copying a `[]byte` of the same total size.

```go
type HasPointer struct { Name *string; Value int }
type NoPointer  struct { Value1, Value2 int }

// This growth event is slower:
var ptrSlice []HasPointer
for i := 0; i < 100_000; i++ { ptrSlice = append(ptrSlice, ...) }

// This growth event is faster:
var valSlice []NoPointer
for i := 0; i < 100_000; i++ { valSlice = append(valSlice, ...) }
```

**Optimization:** Use `make([]HasPointer, 0, n)` to avoid growth events entirely for pointer-containing slices — the benefit is even greater than for value types.

---

### Q18. Explain the `Reset()` design pattern for structs that own large slice buffers.

**Answer:**

When a struct owns a slice buffer and needs to be periodically cleared, the implementation of `Reset()` determines whether the backing array is reused or released:

```go
type Pipeline struct {
    scratch []byte
    results []Result
}

// Pattern 1: Reuse backing array (good for predictable sizes)
func (p *Pipeline) Reset() {
    p.scratch = p.scratch[:0]  // len=0, cap unchanged
    p.results = p.results[:0]  // reuse both backing arrays
}

// Pattern 2: Release large backing arrays, reuse small ones
func (p *Pipeline) Reset() {
    const maxReusableCap = 64 * 1024 // 64KB threshold

    if cap(p.scratch) > maxReusableCap {
        p.scratch = nil // release 100MB+ spike allocations
    } else {
        p.scratch = p.scratch[:0] // reuse normal-sized buffers
    }

    p.results = p.results[:0] // results are always small, always reuse
}

// Pattern 3: Adaptive (track high-water mark)
func (p *Pipeline) Reset() {
    p.highWaterMark = max(p.highWaterMark, len(p.scratch))
    if cap(p.scratch) > p.highWaterMark*4 {
        // Cap grew to 4x normal — probably a spike, release it
        p.scratch = make([]byte, 0, p.highWaterMark)
    } else {
        p.scratch = p.scratch[:0]
    }
}
```

Pattern 2 is the most practical: reuse typical-sized buffers (avoid per-call allocation) but release spike allocations (avoid permanent memory growth).

---

## Scenario-Based Questions

### Q19. You're reviewing a PR and see this code. What's wrong and how do you fix it?

```go
func (c *Cache) AddBatch(items []Item) {
    for _, item := range items {
        c.data = append(c.data, item)
    }
}

func (c *Cache) Clear() {
    c.data = c.data[:0]
}
```

**Answer:**

Two issues:

**Issue 1: No synchronization.** `AddBatch` and `Clear` modify `c.data` without any mutex. Concurrent calls from different goroutines will cause data races, potentially corrupting the slice header or backing array.

**Issue 2: `Clear()` retains the backing array forever.** If `AddBatch` is called with a million items, the backing array grows to hold them all. `Clear()` resets length to 0 but keeps that large backing array. If this happens repeatedly (traffic spikes), the cache permanently holds memory proportional to the peak batch size.

**Fix:**
```go
type Cache struct {
    mu   sync.RWMutex
    data []Item
}

func (c *Cache) AddBatch(items []Item) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.data = append(c.data, items...)
}

func (c *Cache) Clear() {
    c.mu.Lock()
    defer c.mu.Unlock()
    const maxReusable = 10_000
    if cap(c.data) > maxReusable {
        c.data = nil // release spike allocations
    } else {
        c.data = c.data[:0] // reuse normal backing arrays
    }
}
```

---

### Q20. A function processes network packets. Memory profiles show it accounts for 30% of total heap allocations. How do you optimize it?

```go
func processPackets(stream io.Reader) []Packet {
    var packets []Packet
    buf := make([]byte, 1500) // MTU size

    for {
        n, err := stream.Read(buf)
        if n > 0 {
            pkt := parsePacket(buf[:n])
            packets = append(packets, pkt)
        }
        if err != nil { break }
    }
    return packets
}
```

**Answer:**

Multiple optimization opportunities:

**Problem 1:** `packets` grows organically — O(log n) reallocations. If you know the expected packet count, pre-allocate.

**Problem 2:** `buf` is allocated fresh each call. For high-throughput code, use `sync.Pool`.

**Problem 3:** `parsePacket` might allocate — check if it copies `buf[:n]` into the `Packet` struct. If so, it's correct (packet data is independent of buf). If not, the packet holds a reference to `buf`, preventing reuse.

```go
var bufPool = sync.Pool{
    New: func() any {
        b := make([]byte, 1500)
        return &b
    },
}

func processPackets(stream io.Reader, expectedCount int) []Packet {
    packets := make([]Packet, 0, expectedCount) // pre-allocate

    pBuf := bufPool.Get().(*[]byte)
    buf := *pBuf
    defer func() {
        *pBuf = buf
        bufPool.Put(pBuf)
    }()

    for {
        n, err := stream.Read(buf)
        if n > 0 {
            pkt := parsePacket(buf[:n]) // parsePacket must copy data!
            packets = append(packets, pkt)
        }
        if err != nil { break }
    }
    return packets
}
```

If `expectedCount` is unknown, use a heuristic:
```go
packets := make([]Packet, 0, 256) // typical burst size
```

---

### Q21. Explain why this benchmark is misleading, and write a correct version.

```go
func BenchmarkProcess(b *testing.B) {
    input := generateInput(10_000)
    result := make([]int, 0, 10_000) // pre-allocated OUTSIDE the loop

    for b.Loop() {
        result = result[:0]
        for _, v := range input {
            if v > 500 {
                result = append(result, v)
            }
        }
    }
    _ = result
}
```

**Answer:**

This benchmark measures the steady state where the pre-allocated buffer is already warmed up. In production, every function call starts with a fresh slice (no pre-allocated buffer), so the benchmark measures a situation that doesn't occur in real code.

The benchmark will report 0 or 1 `allocs/op` because `result` never reallocates after the first iteration. But real callers will see multiple allocations.

**Correct version:**
```go
func BenchmarkProcess(b *testing.B) {
    b.ReportAllocs()
    input := generateInput(10_000)

    for b.Loop() {
        // Allocate fresh each iteration — mirrors real usage
        result := make([]int, 0, 0) // or: var result []int
        for _, v := range input {
            if v > 500 {
                result = append(result, v)
            }
        }
        _ = result
    }
}

// To benchmark the OPTIMIZED version (with pre-allocation):
func BenchmarkProcessOptimized(b *testing.B) {
    b.ReportAllocs()
    input := generateInput(10_000)

    for b.Loop() {
        result := make([]int, 0, len(input)/2) // estimated pre-allocation
        for _, v := range input {
            if v > 500 {
                result = append(result, v)
            }
        }
        _ = result
    }
}
```

Run both and compare `allocs/op` and `ns/op` to quantify the benefit of pre-allocation for this specific workload.

---

## FAQ

**Q: Does `append` ever shrink a slice?**
No. `append` only increases `len` (and sometimes `cap`). To shrink `len`, use re-slicing: `s = s[:n]`. To shrink `cap`, create a new slice with `copy` or use `slices.Clip`.

**Q: If I do `s = s[:0]`, can I still read the old elements?**
Yes, if you extend the slice back: `s = s[:oldLen]`. The data is still in the backing array. This is why `s[:0]` doesn't "clear" the data — it just hides it.

**Q: Why does `cap` sometimes jump by more than 2x?**
When you `append` multiple elements at once and the required new length exceeds `2 * oldCap`, the runtime sets `newCap = newLen` directly. E.g., `append(make([]int, 0, 2), 1, 2, 3, 4, 5)` — newLen=5, 2*oldCap=4, so newCap becomes 5 (then rounded up to size class).

**Q: Is it safe to use the same slice in multiple goroutines if they only read?**
Yes. Concurrent reads from a slice (without any concurrent writes) are safe. Only concurrent reads+writes (including `append`) require synchronization.

**Q: What does `slices.Grow` do differently from pre-allocating with `make`?**
`slices.Grow(s, n)` ensures that `cap(s) >= len(s) + n` without changing `len`. If the current cap already has room, it's a no-op. This is useful when you receive a slice of unknown capacity and need to ensure space for n more elements before a loop.

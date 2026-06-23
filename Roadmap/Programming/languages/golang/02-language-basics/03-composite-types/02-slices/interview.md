# Slices — Interview Questions

## Overview

Slices are the most commonly asked Go interview topic. Questions range from basic syntax to deep runtime internals. This file covers questions at all levels plus scenario-based problems.

---

## Junior Level Questions

**Q1: What are the three components of a Go slice?**

A: A slice has three components stored in its header:
1. **Pointer** — points to the first element of the backing array
2. **Length** (`len`) — the number of elements accessible through this slice
3. **Capacity** (`cap`) — the number of elements from the pointer to the end of the backing array

Example:
```go
s := []int{10, 20, 30, 40, 50}
// Header: {ptr: &s[0], len: 5, cap: 5}
t := s[1:3]
// Header: {ptr: &s[1], len: 2, cap: 4}
```

---

**Q2: What is the difference between a nil slice and an empty slice?**

A:
- **Nil slice:** `var s []int` — ptr=nil, len=0, cap=0. `s == nil` is `true`.
- **Empty slice:** `s := []int{}` — ptr=non-nil, len=0, cap=0. `s == nil` is `false`.

Both have `len(s) == 0` and both work correctly with `append` and `range`. The main practical difference: `json.Marshal(nil_slice)` produces `"null"` while `json.Marshal(empty_slice)` produces `"[]"`.

---

**Q3: Why must you assign the result of `append` back?**

A: `append` returns a new slice value. If the append stays within the existing capacity, the returned slice has the same backing array with `len+1`. If it exceeds capacity, a new backing array is allocated, and the returned slice points to the new array. Either way, you get a new slice header. If you don't assign it back, the new header (and potentially the new element) is lost:

```go
s := []int{1, 2, 3}
append(s, 4)  // WRONG: result discarded
fmt.Println(len(s)) // 3, not 4
s = append(s, 4)  // CORRECT
fmt.Println(len(s)) // 4
```

---

**Q4: What does `copy(dst, src)` return, and what are the rules?**

A: `copy` returns the number of elements copied. The rules:
- Elements copied = `min(len(dst), len(src))`
- If `dst` is shorter, only `len(dst)` elements are copied
- `copy` correctly handles overlapping slices (uses memmove internally)
- `copy` works between `[]byte` and `string`: `copy(dst_bytes, src_string)`

```go
s := []int{1, 2, 3, 4, 5}
dst := make([]int, 3)
n := copy(dst, s)
fmt.Println(n, dst) // 3 [1 2 3]
```

---

**Q5: How do you delete an element at index i from a slice?**

A: Two approaches:
```go
// Order-preserving (O(n) — shifts elements)
s = append(s[:i], s[i+1:]...)

// Fast (O(1) — doesn't preserve order)
s[i] = s[len(s)-1]
s = s[:len(s)-1]
```

---

**Q6: What is `len(s)` vs `cap(s)` after `t := s[1:3]`?**

A: If `s = []int{1,2,3,4,5}` (len=5, cap=5):
- `t = s[1:3]`: len = 3-1 = 2, cap = 5-1 = 4

The capacity is the number of elements from the sub-slice's start to the END of the original backing array.

---

**Q7: What is three-index slicing `s[1:3:4]`?**

A: Three-index slicing sets both the high bound (length) and the cap bound: `s[low:high:max]`. The resulting slice has:
- Length = high - low
- Capacity = max - low

This prevents appends to the sub-slice from overwriting elements beyond `max` in the original backing array.

---

## Middle Level Questions

**Q1: Explain the aliasing bug in this code:**
```go
func main() {
    s := make([]int, 3, 5)
    a := s[:3]
    b := s[:3]
    a = append(a, 10)
    b = append(b, 20)
    fmt.Println(a[3]) // what is printed?
}
```

A: `20`, not `10`. Both `a` and `b` have `cap=5` (from `s`'s backing array). `a = append(a, 10)` writes `10` to `s[3]` without reallocation (cap permits it). `b = append(b, 20)` also writes to `s[3]` without reallocation — overwriting the `10` that `a` just wrote. Both `a[3]` and `b[3]` now point to the same memory location containing `20`.

Fix: `a := s[:3:3]` and `b := s[:3:3]` — limits capacity to 3, forcing reallocation on append.

---

**Q2: How does Go's slice growth algorithm work?**

A: When `append` exceeds capacity, `runtime.growslice` is called:
- If `len(s) < 256`: new capacity ≈ 2x old capacity
- If `len(s) >= 256`: uses a smoother formula that transitions from 2x to ~1.25x growth
- The computed capacity is then rounded up to the next memory allocator size class

The rounding means actual capacity may exceed the computed value. For example, `append` may give you cap=8 when you expected cap=6, because 6×8=48 bytes rounds to the next size class.

---

**Q3: When does a slice sub-expression cause a memory leak?**

A: When a small sub-slice is returned from a function that owned a large backing buffer:
```go
func getFirstBytes(large []byte) []byte {
    return large[:10]  // LEAK: 10-byte slice keeps MB-size buffer alive
}
```

The GC cannot free the large backing array because the returned slice holds a reference to it. Fix: `result := make([]byte, 10); copy(result, large[:10]); return result`.

---

**Q4: What is `reflect.SliceHeader` and when would you use it?**

A: `reflect.SliceHeader` exposes the internal representation of a slice:
```go
type SliceHeader struct {
    Data uintptr
    Len  int
    Cap  int
}
```

Use cases:
- Inspecting memory layout for debugging
- (Historical) Creating slices from raw pointers with `unsafe`

Modern Go (1.17+) prefers `unsafe.Slice(ptr, len)` over manipulating `SliceHeader.Data` because `uintptr` is not recognized by the GC as a pointer and can cause unsafe behavior during GC cycles.

---

**Q5: What is the difference between `append([]int{}, s...)` and `s[:]`?**

A:
- `s[:]`: Creates a new slice header pointing to the SAME backing array. Modifications through the result affect the original.
- `append([]int{}, s...)`: Creates a new backing array and copies all elements. Modifications through the result do NOT affect the original.

`append([]int{}, s...)` is a common Go idiom for making an independent copy of a slice.

---

**Q6: How would you safely share a slice between goroutines for concurrent reads?**

A: For read-only sharing, no synchronization is needed IF no goroutine writes to the slice or its backing array:
```go
// Safe: read-only concurrent access (all goroutines only read)
var shared = []int{1, 2, 3, 4, 5}

func reader() {
    for _, v := range shared { _ = v } // safe
}
```

For concurrent reads AND writes, use `sync.RWMutex`:
```go
var mu sync.RWMutex
var shared []int

func read() []int { mu.RLock(); defer mu.RUnlock(); return shared }
func write(s []int) { mu.Lock(); defer mu.Unlock(); shared = s }
```

---

## Senior Level Questions

**Q1: Explain the full cost model of `append` for pointer-containing element types.**

A: For `[]T` where `T` contains pointer fields:

1. **Within capacity (len < cap):** Write element to `s.array[s.len]`, increment `s.len`. For pointer-containing types, the GC write barrier is invoked to register the new pointer. Cost: O(1) + write barrier overhead (~20-50 ns).

2. **Capacity exceeded (len == cap):** Call `growslice` which:
   - Allocates new backing array via `mallocgc(newSize, et, true)` — GC must scan this memory
   - Calls `bulkBarrierPreWriteSrcOnly` to register all pointers being moved
   - Copies elements via `memmove`
   - Returns new slice header

   Total cost: O(n) for the copy plus write barrier overhead for every pointer element.

For `[]int` (no pointers): append within capacity costs only a store + increment, and `growslice` uses `mallocgc(size, nil, false)` with no write barriers.

---

**Q2: Design a zero-allocation, concurrent-safe event bus using slices.**

A:
```go
type EventBus struct {
    mu          sync.RWMutex
    subscribers map[string][]func(Event)
}

func (b *EventBus) Subscribe(topic string, handler func(Event)) {
    b.mu.Lock()
    defer b.mu.Unlock()
    if b.subscribers == nil {
        b.subscribers = make(map[string][]func(Event))
    }
    b.subscribers[topic] = append(b.subscribers[topic], handler)
}

func (b *EventBus) Publish(topic string, event Event) {
    b.mu.RLock()
    handlers := b.subscribers[topic] // read slice header (24 bytes)
    b.mu.RUnlock()
    // Iterate handlers without holding the lock — safe because
    // handlers is a snapshot of the slice header; backing array
    // is only appended to (never modified), so existing handlers are stable
    for _, h := range handlers {
        h(event)
    }
}
```

---

**Q3: How would you detect and fix a false sharing issue in a slice of counters?**

A: False sharing occurs when multiple goroutines write to different slice elements that share a CPU cache line. Detection:
```bash
# Linux: perf stat -e cache-misses ./program
# Go: benchmark with varying GOMAXPROCS — flat throughput indicates false sharing
```

Fix: Pad each element to one cache line (64 bytes):
```go
type paddedInt struct {
    val int64
    _   [56]byte // pad to 64 bytes
}
var counters [16]paddedInt  // each on own cache line
atomic.AddInt64(&counters[i].val, 1)  // no false sharing
```

---

**Q4: Explain how the GC interacts with slices during a concurrent GC cycle.**

A: Go uses a tri-color concurrent GC. During marking:
1. The GC scans slice headers (pointers to backing arrays) as roots
2. For each backing array, the GC scans elements based on `et.ptrdata` (which words contain pointers)
3. The write barrier ensures that any pointer written to a slice element during the GC cycle is properly tracked — this is why `growslice` for pointer slices uses `bulkBarrierPreWriteSrcOnly`

For `[]int`: the GC traces the header's Data pointer to find the backing array, marks the array as reachable, but does NOT scan elements (no ptrdata).

For `[]*T`: GC traces header pointer, marks backing array reachable, then scans each element as a pointer to find T objects.

---

**Q5: What happens to memory when you do `s = s[:0]` on a large slice?**

A: `s = s[:0]` sets the length to 0 but keeps `cap` and the `array` pointer unchanged. The backing array is NOT freed — it remains allocated and referenced by `s.array`. The GC cannot collect it.

If the element type contains pointers, those pointers in the backing array (at indices 0 to old len-1) are still visible to the GC through the `cap`. The GC will scan them even though `len=0`.

To release the backing array: `s = nil` (sets array=nil, len=0, cap=0) or let `s` go out of scope.

To reuse the backing array (preferred for hot paths): `s = s[:0]` is correct — you get zero-length slice with the old capacity ready for new `append` operations.

---

## Scenario-Based Questions

**Scenario 1: Your service is OOMing after several hours. Profiling shows a large number of small `[]byte` slices alive. What is your diagnosis and fix?**

A: This is the classic sub-slice memory leak. Likely cause: some code is returning sub-slices of large network buffers or file reads:
```go
// BUG
func extractField(data []byte) []byte {
    return data[offset:offset+length]  // keeps entire data alive
}
```

Diagnosis: Use `go tool pprof -alloc_space` to find where allocations originate. Check if the retained size per object is much larger than the used size.

Fix: Copy the needed portion:
```go
func extractField(data []byte) []byte {
    result := make([]byte, length)
    copy(result, data[offset:offset+length])
    return result
}
```

---

**Scenario 2: A parallel processing pipeline is not scaling beyond 4 cores even on a 32-core machine. Processing involves appending results to per-goroutine slices. How do you fix this?**

A: Check for false sharing between per-goroutine result slices AND verify no goroutine is accidentally sharing state. Common pattern:

```go
// If goroutines write to a shared slice with a mutex, the mutex becomes a bottleneck
var mu sync.Mutex
var results []Item  // global

// Better: per-goroutine slices, merge at end
func worker(items []Item) []Item {
    result := make([]Item, 0, len(items))
    for _, item := range items {
        result = append(result, process(item))
    }
    return result
}

// Merge without contention
allResults := make([][]Item, numWorkers)
// fill allResults with worker results
final := make([]Item, 0, totalLen)
for _, r := range allResults {
    final = append(final, r...)
}
```

---

**Scenario 3: A slice-backed queue shows occasional data loss under high concurrency. How do you diagnose and fix it?**

A: Run with `go test -race` first. The likely cause is concurrent modification without proper synchronization:
```go
// BUG: concurrent append without lock
func (q *Queue) Enqueue(item Item) {
    q.data = append(q.data, item)  // NOT safe
}
```

Fixes (in order of performance impact):
1. `sync.Mutex` — simplest, correct for most workloads
2. `sync.RWMutex` — better if reads >> writes
3. Channel-based queue — natural for producer-consumer patterns
4. `atomic.Value` with copy-on-write — lock-free reads

---

## FAQ

**Q: Should I always pre-allocate slices?**
A: Pre-allocate when you know the approximate final size and performance matters. For rare or cold paths, dynamic growth is fine. For hot paths (e.g., per-request processing), always pre-allocate.

**Q: Is it safe to convert `[]byte` to `string` and back?**
A: `string(bytes)` always allocates a new copy. `[]byte(string)` also allocates. For read-only operations, use `unsafe` or `strings.Builder`. In Go 1.20+, `unsafe.String` creates a string from a byte slice without allocation (but the string must not outlive the slice).

**Q: When is a slice not the right choice?**
A: Use a map instead of a slice when you need fast lookup by key. Use a fixed-size array when the size is a semantic constraint. Use a channel instead of a slice when you need producer-consumer coordination. Use `container/list` when you need O(1) arbitrary insertions/deletions (rare).

**Q: What does `append(s, s...)` do?**
A: It appends all elements of `s` to `s` itself. If `cap(s) >= 2*len(s)`, it uses the existing backing array (which is read before being written to). If not, a new backing array is allocated. The net result is a doubled slice. Be careful: the source elements are read before any writes when no reallocation occurs.

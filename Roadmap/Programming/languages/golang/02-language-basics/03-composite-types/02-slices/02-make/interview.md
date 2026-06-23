# make() for Slices — Interview Questions

## Junior Level

### Q1: What does `make([]int, 5)` do?

**Answer:** It allocates a slice of type `[]int` with length 5 and capacity 5. All 5 elements are zero-initialized (value `0` for int). The backing array is allocated on the heap (unless the compiler's escape analysis determines it can be stack-allocated).

```go
s := make([]int, 5)
fmt.Println(s)        // [0 0 0 0 0]
fmt.Println(len(s))   // 5
fmt.Println(cap(s))   // 5
```

---

### Q2: What is the difference between `make([]int, 3)` and `make([]int, 0, 3)`?

**Answer:**
- `make([]int, 3)` — creates a slice with **length=3, cap=3**. All 3 elements exist and are zero-valued. You access them by index (`s[0]`, `s[1]`, `s[2]`).
- `make([]int, 0, 3)` — creates a slice with **length=0, cap=3**. No accessible elements yet. You add elements via `append`.

```go
s1 := make([]int, 3)    // [0 0 0] — 3 accessible elements
s2 := make([]int, 0, 3) // []      — 0 elements, capacity for 3
s2 = append(s2, 1, 2, 3) // [1 2 3]
```

---

### Q3: Will this code panic? Why?

```go
s := make([]int, 5, 3)
```

**Answer:** Yes, it will panic at runtime with `runtime error: makeslice: cap out of range`. The capacity (3) is less than the length (5), which is invalid. Length can never exceed capacity.

---

### Q4: What does `make` return for slices?

**Answer:** `make` returns the slice itself (type `[]T`), not a pointer. The slice value is a 3-word struct containing a pointer to the backing array, the length, and the capacity.

---

### Q5: How is `make([]int, 5)` different from `new([]int)`?

**Answer:**
- `make([]int, 5)` returns a `[]int` — a fully initialized, ready-to-use slice with 5 zero elements.
- `new([]int)` returns a `*[]int` — a pointer to a zero-valued slice header (which is a nil slice). You still need to initialize the backing array.

```go
s := make([]int, 5) // []int, has 5 elements
p := new([]int)     // *[]int, points to nil slice
fmt.Println(*p)     // []
```

---

### Q6: Can you use `make` for types other than slices?

**Answer:** Yes. `make` works for exactly three types: slices, maps, and channels.

```go
s  := make([]int, 5)            // slice
m  := make(map[string]int)      // map
ch := make(chan int, 10)        // buffered channel
```

---

### Q7: What happens to memory when `append` exceeds capacity?

**Answer:** Go allocates a new, larger backing array, copies all existing elements to it, then appends the new element. The old backing array becomes eligible for garbage collection (if no other references exist).

---

### Q8: Why is `make([]int, 0, n)` preferred over `var s []int` when building a list?

**Answer:** Pre-allocating capacity with `make([]int, 0, n)` avoids repeated memory reallocations as elements are appended. `var s []int` starts with no backing array and Go must reallocate (roughly 2x each time) as the slice grows, causing extra memory copies and GC pressure.

---

## Middle Level

### Q9: What is the output of this program?

```go
s := make([]int, 3, 5)
s = append(s, 10)
fmt.Println(s, len(s), cap(s))
```

**Answer:** `[0 0 0 10] 4 5`. The slice starts with 3 zero elements and capacity 5. Appending 10 adds a 4th element without reallocation (len becomes 4, cap stays 5).

---

### Q10: Explain the memory diagram for `make([]int, 3, 5)`.

**Answer:**

```
Stack:
┌──────────────────────────┐
│  ptr → 0xc000012345      │
│  len = 3                 │
│  cap = 5                 │
└──────────────────────────┘
         │
         ▼ Heap
┌────┬────┬────┬────┬────┐
│ 0  │ 0  │ 0  │ 0  │ 0  │
└────┴────┴────┴────┴────┘
  0    1    2    3    4
  ←── len=3 ───→ ←cap=5→
```

Indices 0-2 are accessible (len=3). Indices 3-4 exist in memory but aren't accessible until `append` is called.

---

### Q11: Why might you choose `make([]T, 0, n)` over `make([]T, n)` even when you know the final count?

**Answer:** When you're going to `append` elements rather than assign by index. Using `make([]T, n)` and then appending creates `n` zero elements PLUS the appended ones:

```go
s := make([]int, 5)
s = append(s, 10) // s = [0,0,0,0,0,10] — likely wrong!

s2 := make([]int, 0, 5)
s2 = append(s2, 10) // s2 = [10] — correct
```

---

### Q12: What is the growth algorithm for slices in Go 1.18+?

**Answer:** Go 1.18 changed from a simple doubling strategy to a blended formula:
- For slices with cap < 256: double the capacity
- For larger slices: grow by `(cap + 3*256) / 4` until sufficient
This avoids sudden memory spikes for large slices while remaining fast for small ones.

---

### Q13: How do you detect when `append` causes a reallocation?

**Answer:** Compare the pointer to the backing array before and after:

```go
s := make([]int, 0, 3)
ptr1 := &s[:1:1][0] // unsafe trick for demonstration
s = append(s, 1, 2, 3, 4) // exceeds cap → realloc
ptr2 := &s[0]
fmt.Println(ptr1 == ptr2) // false if reallocated
```

Or simply compare `cap(s)` before and after `append`.

---

### Q14: What is the performance difference between `make` with and without capacity pre-allocation for 10,000 appends?

**Answer:** Without pre-allocation: ~log₂(10000) ≈ 14 reallocations, each copying all existing data. Total work is O(n log n). With `make([]T, 0, 10000)`: 1 allocation, O(n) total work. Benchmark typically shows 3-5x speedup and 80-90% fewer allocations.

---

### Q15: What's the difference between `make(map[string]int)` and `make(map[string]int, 100)`?

**Answer:** The second argument is a size hint that tells Go to pre-allocate hash buckets for approximately 100 entries. It's a performance optimization — both forms work correctly, but the pre-sized map avoids resizing for up to ~100 entries. Unlike slices, maps cannot overflow their hint; it's advisory only.

---

## Senior Level

### Q16: How does `make` interact with escape analysis?

**Answer:** The Go compiler analyzes whether a slice's backing array can be stack-allocated. If a slice doesn't escape the function (i.e., it's not returned, not stored in a global, not passed to a goroutine), the compiler may allocate the backing array on the goroutine's stack, avoiding heap allocation and GC pressure. Run `go build -gcflags='-m'` to see which `make` calls escape.

---

### Q17: Explain the `runtime.makeslice` function signature and what each parameter means.

**Answer:**

```go
func makeslice(et *_type, len, cap int) unsafe.Pointer
```

- `et *_type`: pointer to the runtime type descriptor for the element type. Contains size, alignment, GC bitmap, etc.
- `len`: the length of the slice
- `cap`: the capacity; actual bytes allocated = `et.size * cap`
- Returns: raw pointer to the zero-initialized backing array

The function validates that `len >= 0`, `cap >= len`, and `et.size * cap` doesn't overflow, then calls `mallocgc`.

---

### Q18: What is the difference between `[]int` and `[]*int` in terms of GC performance with `make`?

**Answer:** For `[]int`, the GC bitmap (`ptrdata`) is 0, meaning the GC doesn't need to scan the backing array for pointers. For `[]*int`, every element is a potential pointer, so the GC must scan the entire array on every GC cycle. For large slices or high-frequency allocations, this can significantly impact GC pause time. Prefer value types in slices when possible.

---

### Q19: Describe the optimized 2D matrix allocation pattern and why it's better.

**Answer:**

```go
// Naive: rows+1 allocations, poor cache locality
func naiveMatrix(r, c int) [][]int {
    m := make([][]int, r)
    for i := range m { m[i] = make([]int, c) }
    return m
}

// Optimized: 2 allocations, all data contiguous
func optimizedMatrix(r, c int) [][]int {
    data := make([]int, r*c)    // one contiguous block
    m := make([][]int, r)
    for i := range m { m[i] = data[i*c : (i+1)*c] }
    return m
}
```

The optimized version has better cache locality (all data is contiguous), fewer allocations (reducing GC work), and better performance for sequential access patterns.

---

### Q20: How does `sync.Pool` complement `make` in high-throughput systems?

**Answer:** `sync.Pool` allows reusing previously allocated slices instead of calling `make` every time. This reduces heap pressure and GC pauses. Objects in the pool are cleared on each GC cycle. Pattern:

```go
var pool = sync.Pool{
    New: func() interface{} { return make([]byte, 4096) },
}

func process() {
    buf := pool.Get().([]byte)
    defer pool.Put(buf[:cap(buf)]) // reset length, return to pool
    // use buf
}
```

---

## Scenario Questions

### Q21: You notice your service's memory usage grows linearly over time and never stabilizes. What `make`-related issues would you investigate?

**Answer:**
1. **Retained sub-slices**: `data[:n]` keeps the entire backing array alive — use `copy` instead.
2. **Growing slices in globals/caches**: Maps or slices that grow indefinitely.
3. **Missing `sync.Pool` for repeated `make` calls**: High allocation rate keeps GC busy.
4. **Large capacity waste**: `make([]T, 0, 10000)` but only 10 elements used — waste 99% capacity.

Tools: `pprof` heap profile, `runtime.ReadMemStats`, `GODEBUG=gccheckmark=1`.

---

### Q22: A team member proposes replacing all `var s []T` with `make([]T, 0)`. Is this a good idea?

**Answer:** Not necessarily. The key differences:
- `var s []T` creates a nil slice; `make([]T, 0)` creates a non-nil empty slice.
- Both can be appended to. Both have `len(s) == 0`.
- The nil slice is the zero value and is idiomatic in Go.
- Some JSON encoders encode nil slices as `null` and empty slices as `[]` — changing this affects wire format.
- Performance: both are equivalent for append patterns.

**Recommendation**: Use `var s []T` as the default; use `make([]T, 0, n)` only when you need capacity pre-allocation.

---

### Q23: How would you design a batch processor that avoids repeated `make` calls for temporary buffers?

**Answer:**

```go
type Processor struct {
    pool sync.Pool
}

func NewProcessor(bufSize int) *Processor {
    return &Processor{
        pool: sync.Pool{
            New: func() interface{} {
                buf := make([]byte, bufSize)
                return &buf
            },
        },
    }
}

func (p *Processor) Process(data []byte) []byte {
    bufPtr := p.pool.Get().(*[]byte)
    buf := *bufPtr
    buf = buf[:cap(buf)] // reset length

    n := copy(buf, data)
    result := make([]byte, n) // only allocate what we need for output
    copy(result, buf[:n])

    p.pool.Put(bufPtr)
    return result
}
```

---

## FAQ

### Q24: Is `make([]int, 0)` the same as `[]int{}`?

**Answer:** Functionally yes — both create non-nil empty slices with length 0. Implementation-wise, the compiler may handle them slightly differently (literal might be more optimized), but for all practical purposes they're equivalent.

---

### Q25: Can I use `make` with a variable element type?

**Answer:** Not directly. `make` is a compile-time built-in; the type must be known at compile time. For dynamic types, use `reflect.MakeSlice`:

```go
t := reflect.TypeOf((*int)(nil)).Elem()
s := reflect.MakeSlice(reflect.SliceOf(t), 5, 10)
```

---

### Q26: Does `make` guarantee memory alignment?

**Answer:** Yes. Go's allocator guarantees that all allocations are aligned according to the element type's alignment requirement. For example, `make([]int64, n)` returns memory aligned to 8 bytes. This is handled by the size class system in `mallocgc`.

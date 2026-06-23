# Array to Slice Conversion — Interview Q&A

## Junior Questions (5–7)

---

### Q1: What is the difference between an array and a slice in Go?

**Answer:**
- An **array** has a fixed size that is part of its type: `[5]int` and `[3]int` are different types. Arrays are value types — assigning one copies all elements.
- A **slice** (`[]int`) is a dynamic view into a contiguous sequence. It has three fields: a pointer to the first element, a length, and a capacity. Slices do not own data; they reference it.

```go
arr := [5]int{1, 2, 3, 4, 5}  // array — fixed type [5]int
s   := arr[:]                  // slice — type []int, references arr
```

---

### Q2: How do you convert an array to a slice in Go?

**Answer:**
Use a slice expression: `arr[:]` for the full array, or `arr[low:high]` for a sub-range.

```go
arr := [5]int{10, 20, 30, 40, 50}
s1 := arr[:]      // all 5 elements
s2 := arr[1:4]    // elements at index 1, 2, 3 → [20 30 40]
s3 := arr[1:3:4]  // full slice expression: len=2, cap=3
```

Important: no data is copied. The slice shares the array's memory.

---

### Q3: What are `len` and `cap` for `arr[1:3]` where `arr` is `[5]int`?

**Answer:**
- `len = high - low = 3 - 1 = 2`
- `cap = len(arr) - low = 5 - 1 = 4`

The capacity extends from the slice's start to the end of the backing array.

---

### Q4: If you modify a slice derived from an array, does the array change?

**Answer:**
Yes. The slice and the array share the same memory. Writing through the slice modifies the array.

```go
arr := [3]int{1, 2, 3}
s := arr[:]
s[0] = 99
fmt.Println(arr[0]) // 99
```

---

### Q5: Can you pass an array directly where a slice is expected?

**Answer:**
No. Go does not automatically convert `[5]int` to `[]int`. You must explicitly write `arr[:]`.

```go
func sum(s []int) int { /* ... */ }

var arr [5]int
sum(arr)    // COMPILE ERROR: cannot use arr as []int
sum(arr[:]) // OK
```

---

### Q6: What is the full slice expression and why is it useful?

**Answer:**
`arr[low:high:max]` — the third index controls the **capacity** of the resulting slice.

```go
arr := [5]int{1, 2, 3, 4, 5}
s := arr[1:3:4] // len=2, cap=3 (max-low=4-1=3)
```

It prevents the receiver from re-slicing beyond `max` and accessing elements you don't intend to share.

---

### Q7: How do you create an independent copy of an array as a slice?

**Answer:**
Use `make` and `copy`:

```go
arr := [5]int{1, 2, 3, 4, 5}
dst := make([]int, len(arr))
copy(dst, arr[:])
dst[0] = 99
fmt.Println(arr[0]) // still 1 — independent
```

---

## Middle Questions (5–7)

---

### Q8: What happens if you `append` to a slice derived from an array when `len < cap`?

**Answer:**
Go writes the new element into the backing array at position `len` — **without allocating new memory**. This mutates the original array.

```go
arr := [5]int{1, 2, 3, 4, 5}
s := arr[0:3]           // len=3, cap=5
s = append(s, 99)       // writes arr[3]!
fmt.Println(arr[3])     // 99

// To prevent this, cap the slice:
s2 := arr[0:3:3]        // len=3, cap=3
s2 = append(s2, 99)     // allocates new backing array
fmt.Println(arr[3])     // still 4 — unchanged
```

---

### Q9: When does a local array escape to the heap?

**Answer:**
A local array escapes when a pointer (or slice header pointing into it) outlives the function's stack frame:

- Returning a slice that references the local array
- Storing the slice in a heap-allocated struct or interface
- Closing over the array in a goroutine

```go
func escapes() []int {
    var arr [4]int
    return arr[:] // arr escapes — slice outlives function
}

func doesNotEscape() [4]int {
    var arr [4]int
    return arr // returned by value — copied, arr stays on stack
}
```

Verify with: `go build -gcflags="-m" ./...`

---

### Q10: What is memory pinning and how does it relate to array-to-slice conversion?

**Answer:**
Memory pinning is when a small slice derived from a large array keeps the entire large array alive in memory, preventing GC from collecting it.

```go
// BUG: 1 MB array stays alive because of a 4-byte slice
var cache []byte
func f(arr *[1<<20]byte) {
    cache = arr[:4] // cache holds a pointer into arr → arr cannot be GCed
}
// Fix:
func fFixed(arr *[1<<20]byte) {
    cache = make([]byte, 4)
    copy(cache, arr[:4]) // independent slice
}
```

---

### Q11: How do you benchmark a function to verify it makes zero heap allocations?

**Answer:**
Use `testing.B` with `-benchmem` flag:

```go
func BenchmarkNoAlloc(b *testing.B) {
    r := strings.NewReader("test data")
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        var buf [64]byte
        n, _ := r.Read(buf[:])
        _ = buf[:n]
    }
}
```

```bash
go test -bench=BenchmarkNoAlloc -benchmem
# Output: 0 allocs/op means success
```

---

### Q12: What is the difference between `arr[i:j]` and `arr[i:j:j]` in terms of safety?

**Answer:**
`arr[i:j]` has capacity `len(arr)-i`, meaning the receiver can re-slice to reveal elements beyond `j`.

`arr[i:j:j]` has capacity `j-i`, equal to the length. The receiver cannot re-slice past index `j`. This is the **defensive API pattern**.

---

### Q13: Can you take a slice of a pointer-to-array? How?

**Answer:**
Yes. Go automatically dereferences a `*[N]T` in slice expressions:

```go
arrPtr := &[5]int{1, 2, 3, 4, 5}
s := arrPtr[1:3] // equivalent to (*arrPtr)[1:3]
fmt.Println(s)   // [2 3]
```

---

### Q14: How do you use a `[N]byte` array as an `io.Reader` buffer without heap allocation?

**Answer:**
```go
func readData(r io.Reader) (int, error) {
    var buf [4096]byte        // stack allocation (if buf doesn't escape)
    n, err := r.Read(buf[:]) // pass slice to Read
    if err != nil {
        return 0, err
    }
    // process buf[:n]
    return n, nil
}
```

The key is that `buf` is a local variable and `buf[:]` is used only within this function — so `buf` stays on the stack.

---

## Senior Questions (5–7)

---

### Q15: How does escape analysis decide whether an array stays on the stack?

**Answer:**
The Go compiler performs **escape analysis** to determine if a variable's address can be observed after the function returns. An array escapes when:

1. A slice pointing into it is returned.
2. A pointer to it is stored in a heap-allocated value.
3. It is captured by a goroutine or closure that outlives the function.
4. It is assigned to an interface.

When an array escapes, the compiler inserts a `runtime.newarray` call to allocate it on the heap instead of the stack.

```bash
# Verify
go build -gcflags="-m=2" ./... 2>&1 | grep "escapes to heap"
```

---

### Q16: Design an API that uses a fixed-size internal buffer without exposing it to callers.

**Answer:**
```go
type Codec struct {
    scratch [512]byte
}

func (c *Codec) Encode(dst, src []byte) (int, error) {
    // Use scratch internally — never expose it
    n := encode(c.scratch[:], src)
    if n > len(dst) {
        return 0, errors.New("dst too small")
    }
    return copy(dst, c.scratch[:n]), nil
}
```

The `scratch` field is a `[512]byte` — it avoids a heap allocation on each call while keeping the API clean (callers only see `[]byte`).

---

### Q17: What is false sharing and how can you prevent it with arrays?

**Answer:**
False sharing occurs when two goroutines access different variables that reside on the same CPU cache line (typically 64 bytes). The hardware invalidates the cache line on each write, causing performance degradation.

Prevention — pad array elements to cache line size:

```go
type PaddedInt64 struct {
    val int64
    _   [56]byte // 8 + 56 = 64 bytes = 1 cache line
}

var counters [8]PaddedInt64
// goroutine i modifies counters[i].val — no false sharing
```

---

### Q18: How would you build a zero-copy ring buffer using a fixed array?

**Answer:**
```go
type RingBuffer struct {
    data [4096]byte
    head int
    tail int
    n    int
}

func (r *RingBuffer) Write(b []byte) int {
    written := 0
    for _, c := range b {
        if r.n == len(r.data) { break }
        r.data[r.tail] = c
        r.tail = (r.tail + 1) % len(r.data)
        r.n++
        written++
    }
    return written
}

func (r *RingBuffer) Read(out []byte) int {
    count := r.n
    if count > len(out) { count = len(out) }
    for i := 0; i < count; i++ {
        out[i] = r.data[r.head]
        r.head = (r.head + 1) % len(r.data)
        r.n--
    }
    return count
}
```

---

### Q19: How does Go handle goroutine stack growth when a slice points into the stack?

**Answer:**
Go uses **stack copying** (introduced in Go 1.3). When a goroutine's stack needs to grow:

1. A new larger stack is allocated.
2. All contents of the old stack are copied.
3. The GC runtime scans the old stack for pointers and updates them to the new addresses — including slice `Data` pointers that pointed into the old stack.
4. The old stack is freed.

This means slice headers on the stack that point to arrays also on the stack are correctly updated. No user code change is needed.

---

### Q20: What security risk arises from not using a full slice expression when sharing a buffer?

**Answer:**
Without a full slice expression, the receiver of a slice can re-slice to `s[:cap(s)]` and read memory beyond what was intended:

```go
var secretKey [64]byte
// BUG: receiver gets cap=64, can read entire key
func share(n int) []byte {
    return secretKey[:n] // cap = 64
}

// SAFE: receiver gets cap=n
func shareSecure(n int) []byte {
    return secretKey[:n:n]
}
```

This is critical for cryptographic keys, session tokens, and other sensitive data stored in arrays.

---

## Scenario-Based Questions (3–5)

---

### Q21: You are reviewing a PR where a function reads from an `io.Reader` into a `[4096]byte` local variable and returns `buf[:]`. What problem do you see?

**Answer:**
The returned slice points to a local array. This forces the array to escape to the heap — the compiler detects that `buf[:]` outlives the function's stack frame. The developer probably intended to avoid an allocation but actually caused one.

Fix: either return the count + use a caller-provided buffer, or use `make([]byte, n)` explicitly and document the allocation.

```go
// Better API design:
func readInto(r io.Reader, dst []byte) (int, error) {
    return r.Read(dst) // caller owns the buffer
}
```

---

### Q22: A service has high GC pause times. Profiling shows that `runtime.newarray` appears frequently in hot path X, which processes small fixed-size messages. How do you fix it?

**Answer:**
Replace heap-allocated slices with stack-backed arrays in the hot path:

```go
// Before (heap allocation each call):
func process(r io.Reader) error {
    buf := make([]byte, 256)
    n, err := r.Read(buf)
    _ = n
    return err
}

// After (stack allocation, if buf doesn't escape):
func process(r io.Reader) error {
    var buf [256]byte
    n, err := r.Read(buf[:])
    _ = n
    return err
}
```

If `handleData` stores the slice, use `sync.Pool` with `*[256]byte` instead.

---

### Q23: You find this code in a security-critical module. What is wrong?

```go
func getToken(store *[512]byte, userID int) []byte {
    offset := userID * 16
    return store[offset : offset+16]
}
```

**Answer:**
Two issues:

1. **No bounds checking:** If `userID` is malicious (negative, or very large), `offset` could cause a panic or read the wrong memory region.

2. **Capacity leak:** The returned slice has `cap = 512 - offset`, not 16. The receiver can call `s[:cap(s)]` to read other users' tokens.

Fix:
```go
func getToken(store *[512]byte, userID int) ([]byte, error) {
    if userID < 0 || userID >= 32 { // max 32 users: 512/16
        return nil, fmt.Errorf("invalid userID %d", userID)
    }
    offset := userID * 16
    return store[offset : offset+16 : offset+16], nil // bounded cap
}
```

---

### Q24: A developer claims "using arr[:] is faster than make([]byte, n) because it avoids allocation." When is this true and when is it false?

**Answer:**
**True when:**
- The array is a local variable and the resulting slice does not escape the function.
- The array fits comfortably in the stack (rule of thumb: < 64 KB).
- Confirmed with `go build -gcflags="-m"` showing no escape.

**False when:**
- The slice escapes (returned, stored globally, captured by goroutine) — the array heap-allocates just like `make`.
- The array is very large (> ~64 KB) and causes goroutine stack growth.
- The function is called from many goroutines simultaneously with large buffers — all stack memory adds up.

---

### Q25: How do you write a test that catches the regression where an array unexpectedly starts escaping to the heap?

**Answer:**
Use `testing.AllocsPerRun`:

```go
func TestNoAllocInHotPath(t *testing.T) {
    r := strings.NewReader("test data for reading")
    allocs := testing.AllocsPerRun(100, func() {
        var buf [64]byte
        n, _ := r.Read(buf[:])
        _ = buf[:n]
    })
    if allocs > 0 {
        t.Errorf("expected 0 allocs, got %v", allocs)
    }
}
```

This test fails immediately if someone adds code that causes `buf` to escape to the heap.

---

## FAQ (3–5)

---

### FAQ1: Is `arr[:]` nil?

No. A slice derived from an array is always non-nil, even if it's empty (`arr[0:0]`). Only a `var s []int` declaration (without initialization) produces a nil slice.

---

### FAQ2: Can I slice a nil pointer to an array?

No. Slicing a nil pointer to an array panics at runtime:

```go
var p *[5]int
_ = p[:] // PANIC: nil pointer dereference
```

---

### FAQ3: Does `copy(dst, arr[:])` do a deep copy?

For slices of primitive types (int, byte, etc.), yes — elements are copied by value. For slices of reference types (pointers, slices, maps), `copy` copies the references, not the underlying data — this is a shallow copy.

---

### FAQ4: What is the practical maximum size for a stack-allocated array?

There is no hard compiler limit, but practical guidance:
- < 8 KB: always stays on stack (initial goroutine stack size)
- 8 KB – 64 KB: may require stack growth, but still stack-allocated
- > 64 KB: will likely escape to the heap or cause significant stack growth; prefer `make`
- > 1 MB: always use `make` — risks goroutine memory exhaustion

---

### FAQ5: When is it better to return `[32]byte` vs `[]byte` from a function?

Return `[32]byte` (value type) when:
- The size is fixed and known at compile time
- You want value semantics (copy-on-return)
- You want to avoid heap allocation (caller receives a copy on their stack)

Return `[]byte` when:
- The size varies at runtime
- The caller needs to pass it to an interface that requires `[]byte`
- The result must outlive the function as a long-lived reference

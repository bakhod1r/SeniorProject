# Array to Slice Conversion — Junior Guide

## 1. Introduction

### What is it?
Array-to-slice conversion is the process of creating a **slice** that references (points to) an existing **array** in Go. Instead of copying the array's data, Go gives you a lightweight "view" into it. The slice header stores a pointer to the array's memory, a length, and a capacity — it does not duplicate any elements.

### How to use it?
```go
arr := [5]int{10, 20, 30, 40, 50}

s := arr[:]        // slice of all 5 elements
s2 := arr[1:4]     // slice of elements at index 1, 2, 3 → [20 30 40]
s3 := arr[1:3:4]   // full slice expression: len=2, cap=3
```

---

## 2. Prerequisites
- Basic understanding of Go variables and types
- Familiarity with arrays (`[N]T`) and their fixed-size nature
- Basic knowledge of slices (dynamic view of a sequence)
- Understanding of the `fmt` package for printing

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| **Array** | Fixed-length sequence of elements of the same type (`[5]int`) |
| **Slice** | Dynamic view into a contiguous sequence; has pointer, length, and capacity |
| **Slice Header** | A 3-field struct: `{ptr *T, len int, cap int}` |
| **Backing Array** | The underlying memory a slice points into |
| **Low Index** | Starting index of the slice expression |
| **High Index** | One-past-the-end index |
| **Capacity** | Elements available from the slice's start pointer to the end of the backing array |
| **Full Slice Expression** | `arr[low:high:max]` — lets you control the capacity |
| **Escape Analysis** | Compiler deciding whether a variable lives on the stack or heap |
| **Stack Allocation** | Variable lives in the function's stack frame (cheap, auto-freed) |

---

## 4. Core Concepts

### Arrays are value types
In Go, arrays are **values**. Assigning one array to another copies all elements. Passing an array to a function also copies it.

### Slices share memory
When you write `s := arr[:]`, no data is copied. The slice's internal pointer points directly to `arr[0]`. Any write through `s` modifies `arr`, and vice versa.

### The three-field slice header
```
Slice Header
┌─────────┐
│  ptr    │──► arr[0] in memory
│  len    │    (number of accessible elements)
│  cap    │    (total elements from ptr to end of backing array)
└─────────┘
```

### Capacity rule
```
cap = len(arr) - low
```
For `arr[1:3]`: low=1, so cap = 5 − 1 = 4.

### Full slice expression controls capacity
```go
s := arr[1:3:4]  // low=1, high=3, max=4
// len = high - low = 3 - 1 = 2
// cap = max  - low = 4 - 1 = 3
```
This is useful when you want to prevent the slice from "seeing" elements beyond index 4.

---

## 5. Real-World Analogies

**Window on a spreadsheet row:** Imagine a spreadsheet row with 10 cells (the array). A "named range" in a spreadsheet is like a slice — it points to a subset of those cells. Changing a cell value through the named range changes the underlying row.

**Library book checkout card:** The card (slice header) contains a shelf location (pointer), the number of pages you borrowed access to (len), and how many more pages are available on that shelf (cap). The card is tiny; the actual book (array) stays on the shelf.

---

## 6. Mental Models

1. **Pointer + window:** A slice is just a pointer plus two integers. It is always "inside" some array.
2. **Shared ownership:** Both the original array variable and any derived slices can modify the same bytes.
3. **Cap guards re-slicing:** You can re-slice `s` up to `s[:cap(s)]`. You cannot exceed the capacity.

---

## 7. Pros & Cons

### Pros
- **Zero-copy:** No memory allocation when converting array to slice.
- **Interoperability:** Most Go APIs (io.Reader, sort.Sort, etc.) accept slices, not arrays. Conversion bridges the gap.
- **Stack buffers:** A local array converted to a slice stays on the stack — no GC pressure.
- **Capacity control:** Full slice expression lets you limit how far a caller can re-slice.

### Cons
- **Shared mutation:** Accidental writes through a slice modify the original array.
- **Memory pinning:** A small slice derived from a large array keeps the entire array alive.
- **Subtle bugs:** Forgetting that two slices share memory leads to hard-to-find bugs.

---

## 8. Use Cases

1. Passing a fixed-size local buffer to `io.Reader`.
2. Sorting a portion of a fixed-size lookup table.
3. Splitting an array into windows for batch processing.
4. Zero-copy conversion to `[]byte` for hashing a stack buffer.
5. Building a ring buffer with a fixed backing array.

---

## 9. Code Examples

### Example 1: Basic conversion and shared memory
```go
package main

import "fmt"

func main() {
    arr := [5]int{1, 2, 3, 4, 5}

    // Full slice — shares memory
    s := arr[:]
    fmt.Println("slice:", s)         // [1 2 3 4 5]
    fmt.Println("len:", len(s))      // 5
    fmt.Println("cap:", cap(s))      // 5

    // Modifying slice modifies array
    s[0] = 99
    fmt.Println("arr[0]:", arr[0])   // 99
}
```

### Example 2: Partial slice with capacity demonstration
```go
package main

import "fmt"

func main() {
    arr := [5]int{10, 20, 30, 40, 50}

    s := arr[1:3] // elements 20, 30
    fmt.Printf("s=%v  len=%d  cap=%d\n", s, len(s), cap(s))
    // s=[20 30]  len=2  cap=4

    // We can re-slice up to capacity
    s2 := s[:4]
    fmt.Println("re-sliced:", s2) // [20 30 40 50]
}
```

### Example 3: Stack-allocated buffer for io.Reader
```go
package main

import (
    "fmt"
    "strings"
)

func main() {
    r := strings.NewReader("Hello, Go!")

    var buf [16]byte          // on the stack (likely)
    n, err := r.Read(buf[:]) // pass slice to Read
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Printf("Read %d bytes: %s\n", n, buf[:n])
    // Read 10 bytes: Hello, Go!
}
```

### Example 4: Full slice expression to limit capacity
```go
package main

import "fmt"

func main() {
    arr := [5]int{1, 2, 3, 4, 5}

    // Without full slice expression: cap=4
    s1 := arr[1:3]
    fmt.Printf("s1 cap=%d\n", cap(s1)) // 4

    // With full slice expression: cap=3 (max=4, low=1 → cap=3)
    s2 := arr[1:3:4]
    fmt.Printf("s2 cap=%d\n", cap(s2)) // 3

    // Appending to s2 will NOT modify arr[3] accidentally
    s3 := append(s2, 99)
    fmt.Println("arr:", arr)  // arr is unchanged
    fmt.Println("s3:", s3)    // [2 3 99]
}
```

---

## 10. Coding Patterns

### Pattern 1: Read into a fixed-size stack buffer
```go
var buf [512]byte
n, err := conn.Read(buf[:])
process(buf[:n])
```

### Pattern 2: Sort a portion of a fixed table
```go
table := [10]int{5, 3, 8, 1, 9, 2, 7, 4, 6, 0}
sort.Ints(table[2:7]) // sort only indices 2-6
```

### Pattern 3: Independent copy from array
```go
arr := [5]int{1, 2, 3, 4, 5}
independent := make([]int, len(arr))
copy(independent, arr[:])
independent[0] = 99
fmt.Println(arr[0]) // still 1 — not affected
```

---

## 11. Clean Code Guidelines

- Name buffer arrays clearly: `var readBuf [4096]byte`, not `var b [4096]byte`.
- Use full slice expression when passing a sub-slice to untrusted code that might `append`.
- Document that a function parameter `[]byte` may or may not own its backing memory.
- Prefer `copy` when you need an independent slice to avoid shared-state bugs.

---

## 12. Product Use / Feature Context

**HTTP servers** use fixed-size stack buffers for reading request headers to avoid heap allocations on every request — crucial at high QPS.

**Cryptography libraries** use `[32]byte` arrays for keys/nonces and convert to `[]byte` only for API calls, keeping sensitive data in a predictable memory location.

**Embedded/IoT Go programs** use stack-allocated arrays to avoid garbage collector pauses in real-time loops.

---

## 13. Error Handling

Common runtime panics related to array-to-slice conversion:

```go
arr := [5]int{1, 2, 3, 4, 5}

// PANIC: slice bounds out of range
_ = arr[2:1]  // high < low

// PANIC: slice bounds out of range
_ = arr[0:6]  // high > len(arr)

// PANIC: slice bounds out of range [::] with capacity 5
_ = arr[1:3:6] // max > len(arr)
```

Always validate indices before using dynamic values in slice expressions:
```go
func safeSlice(arr *[10]int, low, high int) ([]int, error) {
    if low < 0 || high > len(arr) || low > high {
        return nil, fmt.Errorf("invalid bounds [%d:%d] for array length %d", low, high, len(arr))
    }
    return arr[low:high], nil
}
```

---

## 14. Security Considerations

- **Buffer overread:** If you expose a slice derived from a sensitive array (e.g., a crypto key), the receiver can re-slice to `s[:cap(s)]` and read memory beyond the intended range. Use full slice expression to cap capacity.
- **Sensitive data in stack frames:** Stack arrays holding passwords/keys are not zeroed by GC. Explicitly zero them after use:
```go
var key [32]byte
// ... fill key ...
defer func() { key = [32]byte{} }() // zero out
```

---

## 15. Performance Tips

- Converting an array to a slice with `arr[:]` has **zero runtime cost** — it just constructs a header struct.
- Local arrays declared inside a function are placed on the **stack** (if they don't escape), making `arr[:]` a zero-allocation pattern.
- Avoid `make([]T, n)` when a fixed-size stack buffer suffices for small N.

---

## 16. Metrics & Analytics

When profiling array-to-slice patterns, check:
- **Heap allocations per operation** (`go test -benchmem`): stack-backed slices should show 0 allocs.
- **Escape analysis output** (`go build -gcflags="-m"`) to verify the array stays on the stack.
- **CPU cache performance**: contiguous arrays are cache-friendly; slice-of-slices (2D) is not.

---

## 17. Best Practices

1. Prefer `[N]T` arrays for fixed-size local buffers; use `arr[:]` to pass to functions.
2. Use the full slice expression `arr[low:high:max]` when the receiver must not see beyond `max`.
3. Use `copy` to produce an independent slice from an array when shared mutation is undesirable.
4. Always check slice bounds when using dynamic indices — Go panics on out-of-bounds, it does not silently corrupt.
5. Keep array size constants named: `const bufSize = 512; var buf [bufSize]byte`.

---

## 18. Edge Cases & Pitfalls

```go
// Pitfall 1: Empty slice from array
arr := [5]int{1, 2, 3, 4, 5}
s := arr[3:3] // len=0, cap=2 — valid but empty
fmt.Println(s) // []

// Pitfall 2: Nil vs empty slice — arr[:] is NEVER nil
s2 := arr[0:0]
fmt.Println(s2 == nil) // false

// Pitfall 3: append may or may not modify arr
s3 := arr[0:3]         // len=3, cap=5
s3 = append(s3, 99)    // len < cap → writes arr[3]!
fmt.Println(arr[3])    // 99  ← arr was mutated

// Pitfall 4: re-slicing beyond original high
arr2 := [5]int{1, 2, 3, 4, 5}
s4 := arr2[1:2]         // len=1, cap=4
s5 := s4[:4]            // valid! re-slices to cap
fmt.Println(s5)         // [2 3 4 5]
```

---

## 19. Common Mistakes

| Mistake | Fix |
|---------|-----|
| Forgetting slices share the backing array | Use `copy` for independence |
| Using `arr[:]` and expecting a nil slice | `arr[:]` is always non-nil |
| Passing `arr` (not `arr[:]`) to a `[]T` parameter | Go does **not** auto-convert: must write `arr[:]` explicitly |
| Re-slicing beyond cap at runtime | Check `cap(s)` before re-slicing |
| Zeroing only the slice, not the array | Zero `arr` directly: `arr = [N]T{}` |

---

## 20. Common Misconceptions

- **"arr[:] copies the array"** — FALSE. It creates a header pointing to the same memory.
- **"Slices and arrays are the same type"** — FALSE. `[5]int` and `[]int` are distinct types.
- **"You can pass [5]int where []int is expected"** — FALSE. You must explicitly write `arr[:]`.
- **"cap always equals len"** — FALSE. `arr[1:3]` has len=2 but cap=4.

---

## 21. Tricky Points

1. **Array address equality:** `&arr[0] == &s[0]` is true when `s = arr[:]`.
2. **Capacity of zero-index slice:** `arr[0:]` and `arr[:]` are identical — both have cap=5 for a `[5]T`.
3. **Full slice expression on slice, not just array:** `s[1:3:4]` works on an existing slice too, as long as max ≤ cap(s).
4. **append with cap room writes into the array:** This is often surprising.

---

## 22. Quick Test

**Q1:** Given `arr := [4]int{10, 20, 30, 40}` and `s := arr[1:3]`, what are `len(s)` and `cap(s)`?
**A1:** len=2, cap=3

**Q2:** After `s[0] = 99`, what is `arr[1]`?
**A2:** 99 (shared memory)

**Q3:** What does `arr[1:3:3]` produce compared to `arr[1:3]`?
**A3:** Same len=2, but cap=2 instead of cap=3 — restricts re-slicing.

**Q4:** Will `arr[:]` ever be nil?
**A4:** No. Only a nil slice (declared with `var s []int`) is nil.

---

## 23. Tricky Questions

1. Can you use a full slice expression on a slice? (`s[1:3:4]` where s is `[]int`) — Yes, as long as indices are valid.
2. What happens to the array if you `append` to a slice derived from it when `len < cap`? — The array is modified in-place.
3. How do you make a `[]byte` from a `[32]byte` key without heap allocation? — `key[:]` — it's stack-allocated if key doesn't escape.
4. Is `&s[0] == &arr[0]` always true for `s = arr[:]`? — Yes, they point to the same first element.

---

## 24. Cheat Sheet

```
arr[:]        → len=N, cap=N  (full array)
arr[i:]       → len=N-i, cap=N-i
arr[:j]       → len=j, cap=N
arr[i:j]      → len=j-i, cap=N-i
arr[i:j:k]    → len=j-i, cap=k-i  (k ≤ N)

shared memory: YES (slice writes modify arr)
nil check:     arr[:] is NEVER nil
copy:          copy(dst, arr[:])  → independent
```

---

## 25. Self-Assessment Checklist

- [ ] I can explain the difference between `[5]int` and `[]int`.
- [ ] I know that `arr[:]` shares memory with the array.
- [ ] I can compute `len` and `cap` for any slice expression.
- [ ] I understand what the full slice expression `arr[i:j:k]` does.
- [ ] I know how to use `copy` to get an independent slice.
- [ ] I can write a stack-allocated buffer pattern for `io.Reader`.
- [ ] I can identify when `append` might silently modify the backing array.

---

## 26. Summary

Array-to-slice conversion in Go is a **zero-cost** operation that creates a slice header pointing into an existing array's memory. The slice and the array share the same bytes — writes through one are visible through the other. Capacity is determined by the distance from the slice's start to the end of the array. The full slice expression (`arr[i:j:k]`) allows precise capacity control. Use `copy` whenever independent ownership is needed.

---

## 27. What You Can Build

- A zero-allocation line reader (fixed stack buffer + `io.Reader`)
- A fixed-size ring buffer using a `[N]T` array and a slice window
- A cryptographic nonce manager using `[12]byte` arrays
- An HTTP header parser with a stack-backed `[4096]byte` buffer
- A batch processor that slides a window across a fixed-size data array

---

## 28. Further Reading

- [The Go Blog — Arrays, slices (and strings): The mechanics of 'append'](https://go.dev/blog/slices-intro)
- [Go Specification — Slice expressions](https://go.dev/ref/spec#Slice_expressions)
- [Go Specification — Full slice expressions](https://go.dev/ref/spec#Full_slice_expressions)
- [Go FAQ — Why are arrays value types?](https://go.dev/doc/faq#pass_by_value)

---

## 29. Related Topics

- `make([]T, len, cap)` — heap-allocated slices
- `copy(dst, src)` — copying between slices/arrays
- `append(slice, elems...)` — growing slices
- Escape analysis (`go build -gcflags="-m"`)
- `io.Reader` interface
- `bytes.Buffer` vs fixed-size buffer patterns

---

## 30. Diagrams & Visual Aids

### Memory Layout

```
arr := [5]int{1, 2, 3, 4, 5}
s   := arr[1:3]

Memory (heap or stack):
Index:  [0]  [1]  [2]  [3]  [4]
        ┌────┬────┬────┬────┬────┐
arr →   │  1 │  2 │  3 │  4 │  5 │
        └────┴────┴────┴────┴────┘
              ▲         ▲
              │         │ (high = index 3, exclusive)
              │
Slice header s:
┌──────────────┐
│ ptr → &arr[1]│
│ len = 2      │
│ cap = 4      │   (from index 1 to end of array)
└──────────────┘
```

### Full Slice Expression Diagram

```
arr[1:3:4]
           [0]  [1]  [2]  [3]  [4]
           ┌────┬────┬────┬────┬────┐
arr →      │  1 │  2 │  3 │  4 │  5 │
           └────┴────┴────┴────┴────┘
                 ▲         ▲    ▲
                 ptr      high  max

len = high - low = 3 - 1 = 2
cap = max  - low = 4 - 1 = 3
Elements accessible: arr[1], arr[2]
Cap boundary:        arr[1], arr[2], arr[3]  (arr[4] hidden)
```

### Mermaid: Relationship Diagram

```mermaid
graph TD
    A["arr [5]int on stack"] -->|ptr| B["s1 = arr[:]<br>len=5 cap=5"]
    A -->|ptr+1| C["s2 = arr[1:3]<br>len=2 cap=4"]
    A -->|ptr+1| D["s3 = arr[1:3:4]<br>len=2 cap=3"]
    B -->|write s1[0]=99| A
    C -->|write s2[0]=99| A
    style A fill:#f9f,stroke:#333
    style B fill:#bbf,stroke:#333
    style C fill:#bbf,stroke:#333
    style D fill:#bbf,stroke:#333
```

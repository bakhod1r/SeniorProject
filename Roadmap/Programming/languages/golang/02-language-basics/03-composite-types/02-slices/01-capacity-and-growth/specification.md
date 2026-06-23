# Go Specification: Slice Capacity and Growth

**Source:** https://go.dev/ref/spec#Slice_types
**Section:** Types → Composite Types → Slice Types / Built-in Functions → Length and Capacity / Appending and Copying Slices

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Official Spec** | https://go.dev/ref/spec |
| **Primary Section** | [Slice types](https://go.dev/ref/spec#Slice_types) |
| **Related Sections** | [Length and capacity](https://go.dev/ref/spec#Length_and_capacity), [Appending and copying slices](https://go.dev/ref/spec#Appending_and_copying_slices), [Making slices, maps and channels](https://go.dev/ref/spec#Making_slices_maps_and_channels), [Slice expressions](https://go.dev/ref/spec#Slice_expressions) |
| **Go Version** | Go 1.0+ (growth algorithm changed in Go 1.18) |

- **Primary:** https://go.dev/ref/spec#Slice_types
- **Related:** https://go.dev/ref/spec#Length_and_capacity
- **Related:** https://go.dev/ref/spec#Appending_and_copying_slices
- **Related:** https://go.dev/ref/spec#Making_slices_maps_and_channels
- **Related:** https://go.dev/ref/spec#Slice_expressions

Official definition from the spec:

> "The number of elements is called the length of the slice and is never negative. The value of an uninitialized slice is nil."

> "The capacity of a slice is the number of elements for which there is space allocated in the underlying array."

> "If the capacity of s is not large enough to fit the additional values, append allocates a new, sufficiently large underlying array that fits both the existing slice elements and the additional values."

---

## 2. Formal Grammar (EBNF)

```ebnf
SliceType       = "[" "]" ElementType .
ElementType     = Type .

SliceExpr       = SimpleSliceExpr | FullSliceExpr .
SimpleSliceExpr = PrimaryExpr "[" [ Expression ] ":" [ Expression ] "]" .
FullSliceExpr   = PrimaryExpr "[" [ Expression ] ":" Expression ":" Expression "]" .
```

### Grammar Breakdown

| Production | Description |
|------------|-------------|
| `SliceType` | A slice type declaration: `[]` followed by an element type. No length specified (unlike arrays). |
| `ElementType` | Any valid Go type. |
| `SimpleSliceExpr` | Two-index slice expression `a[low:high]`, controls length only. Capacity inherited from source. |
| `FullSliceExpr` | Three-index slice expression `a[low:high:max]`, controls both length and capacity. |

### Example Parse

```
Expression: make([]int, 3, 10)

Parse tree:
  BuiltinCall
  ├── "make"
  ├── SliceType: "[" "]" "int"       → []int
  ├── LengthExpr: 3                  → len = 3
  └── CapacityExpr: 10               → cap = 10

Result: a slice of type []int with length 3 and capacity 10.
         The underlying array has 10 int-sized slots.
         Elements at indices 0..2 are accessible; 3..9 are allocated but hidden.
```

```
Expression: s[1:3:5]

Parse tree:
  FullSliceExpr
  ├── PrimaryExpr: s
  ├── low: 1
  ├── high: 3
  └── max: 5

Result: length = high - low = 2, capacity = max - low = 4
```

---

## 3. Core Rules & Constraints

### 3.1 Capacity Is Always >= Length

From the spec on [Length and capacity](https://go.dev/ref/spec#Length_and_capacity):

> "The capacity of a slice is the number of elements for which there is space allocated in the underlying array."

The invariant `0 <= len(s) <= cap(s)` always holds. It is impossible to construct a valid slice where `cap(s) < len(s)`.

```go
// ✅ Valid: cap >= len
package main

import "fmt"

func main() {
    s := make([]int, 3, 10)
    fmt.Println(len(s)) // 3
    fmt.Println(cap(s)) // 10
    // Invariant: 3 <= 10 ✓
}
```

```go
// ❌ Invalid: attempting cap < len causes panic
package main

func main() {
    _ = make([]int, 10, 5) // panic: makeslice: len larger than cap
}
```

### 3.2 make([]T, len, cap) Constraints

From the spec on [Making slices, maps and channels](https://go.dev/ref/spec#Making_slices_maps_and_channels):

> "make([]T, n, m) — slice of type T with length n and capacity m"

The constraints are:
- `0 <= n <= m` (length must be non-negative and not exceed capacity)
- Both `n` and `m` must be representable as type `int`
- If `n` or `m` is a negative constant, it is a **compile-time error**
- If `n` or `m` is a negative runtime value, it is a **runtime panic**

```go
// ✅ Valid: various make forms
package main

import "fmt"

func main() {
    a := make([]int, 5)       // len=5, cap=5
    b := make([]int, 0, 10)   // len=0, cap=10
    c := make([]int, 3, 3)    // len=3, cap=3
    d := make([]int, 0)       // len=0, cap=0 (non-nil)

    fmt.Println(len(a), cap(a)) // 5 5
    fmt.Println(len(b), cap(b)) // 0 10
    fmt.Println(len(c), cap(c)) // 3 3
    fmt.Println(len(d), cap(d)) // 0 0
    fmt.Println(d == nil)       // false
}
```

```go
// ❌ Invalid: compile-time error with constant negative
package main

func main() {
    // _ = make([]int, -1)     // compile error: negative len argument in make
    // _ = make([]int, 5, -1)  // compile error: negative cap argument in make
    // _ = make([]int, 5, 3)   // compile error: len larger than cap in make
}
```

```go
// ❌ Invalid: runtime panic with variable negative
package main

func main() {
    n := -1
    _ = make([]int, n) // panic: makeslice: len out of range
}
```

### 3.3 Append Growth Behavior

From the spec on [Appending and copying slices](https://go.dev/ref/spec#Appending_and_copying_slices):

> "If the capacity of s is not large enough to fit the additional values, append allocates a new, sufficiently large underlying array that fits both the existing slice elements and the additional values. Otherwise, append re-uses the underlying array."

The spec intentionally does **not** specify the exact growth factor. This is implementation-defined behavior. However, the gc compiler's growth strategy has changed over Go versions:

- **Go 1.0 -- Go 1.17:** Capacity roughly doubles when `cap < 1024`, then grows by ~25%.
- **Go 1.18+:** A smoother growth curve is used. For small slices (`cap < 256`), capacity roughly doubles. For larger slices, the growth factor transitions gradually from 2x toward ~1.25x using the formula that avoids a sharp cliff at 1024.

```go
// ✅ Observing growth behavior
package main

import "fmt"

func main() {
    var s []int
    prevCap := 0
    for i := 0; i < 20; i++ {
        s = append(s, i)
        if cap(s) != prevCap {
            fmt.Printf("len=%-3d cap=%-3d (grew from %d)\n", len(s), cap(s), prevCap)
            prevCap = cap(s)
        }
    }
}
```

Expected output (gc compiler, Go 1.18+, may vary by platform):

```
len=1   cap=1   (grew from 0)
len=2   cap=2   (grew from 1)
len=3   cap=4   (grew from 2)
len=5   cap=8   (grew from 4)
len=9   cap=16  (grew from 8)
len=17  cap=32  (grew from 16)
```

### 3.4 Capacity Does Not Shrink Automatically

There is no mechanism in the Go spec for a slice's capacity to automatically decrease. Removing elements (via re-slicing or the `append` deletion idiom) reduces `len` but never reduces `cap`.

```go
// ✅ Demonstrating capacity retention after shrinking length
package main

import "fmt"

func main() {
    s := make([]int, 1000, 1000)
    for i := range s {
        s[i] = i
    }
    fmt.Printf("before: len=%d cap=%d\n", len(s), cap(s)) // len=1000 cap=1000

    s = s[:10] // shrink length to 10
    fmt.Printf("after:  len=%d cap=%d\n", len(s), cap(s)) // len=10   cap=1000

    // Capacity still 1000 — the underlying array is NOT freed
    // To release memory, copy to a new smaller slice:
    small := make([]int, len(s))
    copy(small, s)
    s = small
    fmt.Printf("copied: len=%d cap=%d\n", len(s), cap(s)) // len=10   cap=10
}
```

### 3.5 Re-slicing Can Access Elements Up to Capacity

From the spec on [Slice expressions](https://go.dev/ref/spec#Slice_expressions):

> "For arrays or strings, the indices are in range if 0 <= low <= high <= len(a), otherwise they are out of range. For slices, the upper index bound is the slice capacity cap(a) rather than the length."

This means a slice can be re-sliced to "recover" elements beyond its current length, up to its capacity.

```go
// ✅ Re-slicing up to capacity
package main

import "fmt"

func main() {
    arr := [8]int{10, 20, 30, 40, 50, 60, 70, 80}
    s := arr[2:4]  // [30 40], len=2, cap=6
    fmt.Println(s)  // [30 40]

    // Re-slice to access elements beyond len but within cap
    s2 := s[:6]     // valid: 6 <= cap(s)
    fmt.Println(s2)  // [30 40 50 60 70 80]

    // ❌ This would panic: s[:7] — 7 > cap(s) which is 6
    // _ = s[:7]     // panic: slice bounds out of range [:7] with capacity 6
}
```

---

## 4. Type Rules

### 4.1 Capacity-Related Expressions and Types

| Expression | Result Type | Spec Reference |
|------------|-------------|----------------|
| `cap(s)` where `s` is `[]T` | `int` | [Length and capacity](https://go.dev/ref/spec#Length_and_capacity) |
| `len(s)` where `s` is `[]T` | `int` | [Length and capacity](https://go.dev/ref/spec#Length_and_capacity) |
| `make([]T, n, m)` | `[]T` | [Making slices](https://go.dev/ref/spec#Making_slices_maps_and_channels) |
| `append(s, x...)` | `[]T` (same as `s`) | [Appending and copying](https://go.dev/ref/spec#Appending_and_copying_slices) |
| `s[low:high:max]` | `[]T` (same element type as `s`) | [Slice expressions](https://go.dev/ref/spec#Slice_expressions) |

### 4.2 Type Compatibility Matrix for Capacity Operations

| Operation | `[]T` | `[N]T` | `*[N]T` | `string` |
|-----------|-------|--------|---------|----------|
| `cap(x)` | Yes | Yes | Yes | No |
| `len(x)` | Yes | Yes | Yes | Yes |
| `make(x, n, m)` | Yes | No | No | No |
| `append(x, ...)` | Yes | No | No | No |
| `x[low:high:max]` (three-index) | Yes | Yes | Yes | No |

### 4.3 cap() and len() on Named Slice Types

```go
package main

import "fmt"

type IntSlice []int

func main() {
    s := IntSlice{1, 2, 3, 4, 5}
    fmt.Println(len(s)) // 5 — works on named types
    fmt.Println(cap(s)) // 5 — works on named types

    s2 := make(IntSlice, 3, 10)
    fmt.Println(len(s2)) // 3
    fmt.Println(cap(s2)) // 10
}
```

---

## 5. Behavioral Specification

### 5.1 Normal Execution: Capacity Tracking Through Operations

A slice's capacity changes only in specific circumstances:

1. **make([]T, n, m):** Capacity is set to `m`.
2. **append:** If `len(s) + added > cap(s)`, a new array is allocated with a larger capacity. The exact new capacity is implementation-defined.
3. **Slice expression `s[low:high]`:** Capacity of result is `cap(s) - low`.
4. **Full slice expression `s[low:high:max]`:** Capacity of result is `max - low`.

```go
package main

import "fmt"

func main() {
    // Step 1: make sets initial capacity
    s := make([]int, 0, 5)
    fmt.Printf("make:   len=%d cap=%d\n", len(s), cap(s)) // len=0 cap=5

    // Step 2: append within capacity — no reallocation
    s = append(s, 1, 2, 3)
    fmt.Printf("append: len=%d cap=%d\n", len(s), cap(s)) // len=3 cap=5

    // Step 3: simple slice expression — capacity reduces by low index
    s2 := s[1:]
    fmt.Printf("s[1:]:  len=%d cap=%d\n", len(s2), cap(s2)) // len=2 cap=4

    // Step 4: full slice expression — capacity explicitly set
    s3 := s[0:2:3]
    fmt.Printf("s[0:2:3]: len=%d cap=%d\n", len(s3), cap(s3)) // len=2 cap=3

    // Step 5: append beyond capacity — reallocation occurs
    s = append(s, 4, 5, 6, 7, 8)
    fmt.Printf("grow:   len=%d cap=%d\n", len(s), cap(s)) // len=8 cap=10 (implementation-defined)
}
```

### 5.2 Error Conditions

#### Panic: cap < len in make

```go
package main

func main() {
    defer func() {
        if r := recover(); r != nil {
            println("recovered:", r)
        }
    }()
    _ = make([]int, 10, 5) // panic: makeslice: len larger than cap
}
```

#### Panic: Slice Bounds Out of Range (Exceeding Capacity)

```go
package main

func main() {
    s := make([]int, 3, 5)
    _ = s[:6] // panic: slice bounds out of range [:6] with capacity 5
}
```

#### Panic: Three-Index Slice Bounds Violation

```go
package main

func main() {
    s := make([]int, 5, 10)
    // max must be <= cap(s)
    _ = s[0:3:11] // panic: slice bounds out of range [::11] with capacity 10
}
```

### 5.3 Compile-Time vs Run-Time Checking

| Condition | Compile-Time Error? | Run-Time Panic? |
|-----------|---------------------|-----------------|
| `make([]int, -1)` (constant -1) | Yes | N/A |
| `make([]int, n)` where `n` is variable and negative | No | Yes |
| `make([]int, 5, 3)` (constant 5 > 3) | Yes | N/A |
| `make([]int, n, m)` where `n > m` at runtime | No | Yes |
| `s[0:3:2]` (constant high > max) | Yes | N/A |
| `s[:cap(s)+1]` | No (not evaluable at compile time) | Yes |

---

## 6. Defined vs Undefined Behavior

| Scenario | Behavior | Status |
|----------|----------|--------|
| `cap(s)` on a nil slice | Returns 0 | **Defined** |
| `len(s)` on a nil slice | Returns 0 | **Defined** |
| `append(nil, 1, 2, 3)` | Allocates new array, returns `[]int{1,2,3}` | **Defined** |
| Accessing `s[i]` where `len(s) <= i < cap(s)` | Runtime panic (index out of range) | **Defined** |
| Re-slicing `s[:n]` where `len(s) < n <= cap(s)` | Valid, extends the visible portion | **Defined** |
| Re-slicing `s[:n]` where `n > cap(s)` | Runtime panic | **Defined** |
| Exact capacity after `append` triggers growth | Implementation-defined (not in spec) | **Unspecified** |
| Exact growth factor for `append` | Implementation-defined | **Unspecified** |
| Whether `append` returns same or new pointer | Implementation-defined (depends on available capacity) | **Unspecified** |
| Memory alignment of underlying array | Implementation-defined | **Unspecified** |
| Order of evaluation in `s[a:b:c]` | Left to right (`a`, then `b`, then `c`) | **Defined** |
| `cap(s)` after `s = s[:0]` | Same as before (underlying array unchanged) | **Defined** |
| Whether GC reclaims unused capacity | GC keeps entire underlying array alive if any slice references it | **Implementation-defined** |

---

## 7. Edge Cases from Spec

### 7.1 Nil Slice Capacity

A nil slice has capacity 0. Both `len` and `cap` are safe to call on nil slices.

```go
package main

import "fmt"

func main() {
    var s []int
    fmt.Println(s == nil)  // true
    fmt.Println(len(s))    // 0
    fmt.Println(cap(s))    // 0

    // All these are safe on nil:
    for range s {
        fmt.Println("never reached")
    }
    t := append(s, 42)
    fmt.Println(t)         // [42]
    fmt.Println(cap(t))    // 1
}
```

### 7.2 Append to Nil Slice

Appending to a nil slice is well-defined and allocates a new underlying array. The result is a non-nil slice.

```go
package main

import "fmt"

func main() {
    var s []string
    fmt.Println(s == nil) // true

    s = append(s, "hello")
    fmt.Println(s == nil) // false
    fmt.Println(s)        // [hello]
    fmt.Println(len(s))   // 1
    fmt.Println(cap(s))   // 1 (or more, implementation-defined)

    s = append(s, "world", "go")
    fmt.Println(s)        // [hello world go]
    fmt.Println(len(s))   // 3
    fmt.Printf("cap >= 3: %v\n", cap(s) >= 3) // true
}
```

### 7.3 Capacity of s[:0]

Re-slicing to zero length retains the original capacity. The underlying array is not released.

```go
package main

import "fmt"

func main() {
    s := make([]int, 100, 200)
    fmt.Printf("original: len=%d cap=%d\n", len(s), cap(s)) // len=100 cap=200

    s = s[:0]
    fmt.Printf("s[:0]:    len=%d cap=%d\n", len(s), cap(s)) // len=0   cap=200

    // The full capacity is still available for re-slicing
    s = s[:150]
    fmt.Printf("s[:150]:  len=%d cap=%d\n", len(s), cap(s)) // len=150 cap=200

    // Or for appending (no reallocation until cap exceeded)
    s = s[:0]
    for i := 0; i < 200; i++ {
        s = append(s, i)
    }
    fmt.Printf("filled:   len=%d cap=%d\n", len(s), cap(s)) // len=200 cap=200
}
```

### 7.4 Three-Index Slicing (Full Slice Expression) s[low:high:max]

From the spec on [Slice expressions](https://go.dev/ref/spec#Slice_expressions):

> "The full slice expression a[low : high : max] constructs a slice of the same type, and with the same length and elements as the simple slice expression a[low : high]. Additionally, it controls the resulting slice's capacity by setting it to max - low."

Constraints: `0 <= low <= high <= max <= cap(a)`

The third index is NOT supported on strings.

```go
package main

import "fmt"

func main() {
    a := [10]int{0, 1, 2, 3, 4, 5, 6, 7, 8, 9}

    // Simple slice: inherits full remaining capacity
    s1 := a[2:5]
    fmt.Printf("s1=a[2:5]:     len=%d cap=%d values=%v\n", len(s1), cap(s1), s1)
    // len=3 cap=8 values=[2 3 4]

    // Full slice: capacity explicitly limited
    s2 := a[2:5:7]
    fmt.Printf("s2=a[2:5:7]:   len=%d cap=%d values=%v\n", len(s2), cap(s2), s2)
    // len=3 cap=5 values=[2 3 4]

    // Full slice: capacity equals length (no room for append without realloc)
    s3 := a[2:5:5]
    fmt.Printf("s3=a[2:5:5]:   len=%d cap=%d values=%v\n", len(s3), cap(s3), s3)
    // len=3 cap=3 values=[2 3 4]
}
```

### 7.5 Three-Index Slicing Prevents Unintended Overwrites

Without the third index, appending to a sub-slice can overwrite elements in the original slice/array. The full slice expression prevents this.

```go
package main

import "fmt"

func main() {
    original := []int{1, 2, 3, 4, 5}

    // ❌ Dangerous: sub has extra capacity pointing into original's array
    sub := original[1:3] // [2 3], cap=4
    sub = append(sub, 99)
    fmt.Println("original after dangerous append:", original) // [1 2 3 99 5] — element 4 was overwritten!

    // Reset
    original = []int{1, 2, 3, 4, 5}

    // ✅ Safe: three-index slice limits capacity
    sub = original[1:3:3] // [2 3], cap=2
    sub = append(sub, 99)
    fmt.Println("original after safe append:", original) // [1 2 3 4 5] — unchanged
    fmt.Println("sub:", sub)                              // [2 3 99] — new backing array
}
```

### 7.6 Capacity After Multiple Slicing Operations

Capacity calculation chains through successive slice expressions.

```go
package main

import "fmt"

func main() {
    a := make([]int, 10, 10) // len=10 cap=10
    for i := range a {
        a[i] = i
    }

    b := a[2:8]     // len=6, cap=8  (cap(a) - 2 = 8)
    c := b[1:3]     // len=2, cap=7  (cap(b) - 1 = 7)
    d := c[0:1:2]   // len=1, cap=2  (max - low = 2 - 0 = 2)

    fmt.Printf("a: len=%d cap=%d\n", len(a), cap(a)) // 10 10
    fmt.Printf("b: len=%d cap=%d\n", len(b), cap(b)) // 6  8
    fmt.Printf("c: len=%d cap=%d\n", len(c), cap(c)) // 2  7
    fmt.Printf("d: len=%d cap=%d\n", len(d), cap(d)) // 1  2
}
```

### 7.7 Zero-Length, Non-Zero Capacity Slice

A slice can have zero length but non-zero capacity. This is a common pattern for building slices with pre-allocated backing arrays.

```go
package main

import "fmt"

func main() {
    s := make([]int, 0, 100)
    fmt.Printf("len=%d cap=%d nil=%v\n", len(s), cap(s), s == nil)
    // len=0 cap=100 nil=false

    // No elements are accessible via indexing
    // _ = s[0] // panic: index out of range [0] with length 0

    // But appending is efficient (no reallocation until cap exceeded)
    for i := 0; i < 100; i++ {
        s = append(s, i)
    }
    fmt.Printf("len=%d cap=%d\n", len(s), cap(s)) // len=100 cap=100
}
```

---

## 8. Version History

| Go Version | Change | Impact on Capacity/Growth |
|------------|--------|---------------------------|
| Go 1.0 | Slice type introduced with `len`/`cap` semantics, `append`, `copy`, `make` | Initial specification. Growth factor approximately 2x for all sizes. |
| Go 1.2 | Three-index (full) slice expression `a[low:high:max]` added | Allows explicit capacity control. Prevents unintended overwrites on shared backing arrays. |
| Go 1.18 | Growth algorithm changed in gc compiler (`runtime.growslice`) | Removed the sharp transition at cap=1024. For `cap < 256`, roughly doubles. For larger slices, uses a smooth formula transitioning from 2x toward ~1.25x. Results in more predictable memory usage. |
| Go 1.20 | `unsafe.SliceData(s)` and `unsafe.Slice(ptr, len)` added | Provides direct access to the underlying array pointer. `reflect.SliceHeader` deprecated. |
| Go 1.21 | `clear` built-in added; `slices` package promoted to stdlib | `clear(s)` zeroes all elements within `len(s)` without changing capacity. `slices.Grow(s, n)` ensures `cap(s) >= len(s)+n`. |

### Go 1.18 Growth Algorithm Change (Detail)

Before Go 1.18 (runtime/slice.go):
```
if oldCap < 1024 {
    newCap = oldCap * 2
} else {
    newCap = oldCap + oldCap/4  // 1.25x
}
```

After Go 1.18 (runtime/slice.go):
```
if oldCap < 256 {
    newCap = oldCap * 2
} else {
    newCap = oldCap + (oldCap + 3*256) / 4  // smooth transition
}
```

The new formula avoids the abrupt change at 1024 where growth ratio would jump from 2.0x to 1.25x, which caused performance issues in certain workloads.

---

## 9. Implementation-Specific Behavior

### 9.1 gc Compiler (Standard Go Compiler)

The gc compiler's `runtime.growslice` function handles capacity growth:

1. **Requested capacity calculation:** `newLen = oldLen + numAppended`
2. **Initial guess:** If `newLen > 2 * oldCap`, use `newLen` directly. Otherwise, apply the growth formula (see Version History).
3. **Size class rounding:** The final capacity is rounded up to the allocator's next size class. This means `cap(s)` after growth may be slightly larger than expected.

```go
package main

import "fmt"

func main() {
    // Demonstrating size class rounding
    s := make([]int64, 0)
    s = append(s, 1)
    fmt.Printf("after 1 append: cap=%d\n", cap(s))
    // Might be 1 or 2 depending on size class alignment

    s = make([]byte, 0)
    s = append(s, 1)
    fmt.Printf("byte slice after 1 append: cap=%d\n", cap(s))
    // Often 8 due to minimum allocation size
}
```

### 9.2 gc vs gccgo Behavior Differences

| Aspect | gc Compiler | gccgo |
|--------|-------------|-------|
| Growth factor (small slices) | ~2x for cap < 256 | ~2x (may differ in exact threshold) |
| Growth factor (large slices) | Smooth transition to ~1.25x | May use different formula |
| Size class rounding | Go runtime allocator size classes | System `malloc` size classes |
| Stack allocation of small slices | Yes (escape analysis) | Depends on GCC optimization level |
| Minimum allocation size | 8 bytes (for tiny objects) | Platform-dependent |

### 9.3 Escape Analysis and Capacity

If the compiler determines a slice does not escape the function scope, the backing array may be stack-allocated. This affects performance but not capacity semantics.

```go
package main

import "fmt"

func noEscape() {
    // This slice may be stack-allocated (no heap allocation)
    s := make([]int, 3)
    s[0] = 1
    s[1] = 2
    s[2] = 3
    total := 0
    for _, v := range s {
        total += v
    }
    fmt.Println(total) // 6
}

func main() {
    noEscape()
}
```

To check escape analysis: `go build -gcflags="-m" .`

### 9.4 Capacity and Memory Retention

The garbage collector cannot reclaim the unused portion of a backing array while any slice references that array. This can cause memory leaks with large arrays and small slices.

```go
package main

import "fmt"

// ❌ Bad: retains entire large array in memory
func getFirstThreeBad(data []int) []int {
    return data[:3] // underlying array of data stays alive
}

// ✅ Good: copies to new small slice, original can be GC'd
func getFirstThreeGood(data []int) []int {
    result := make([]int, 3)
    copy(result, data[:3])
    return result
}

func main() {
    large := make([]int, 1_000_000)
    for i := range large {
        large[i] = i
    }

    small := getFirstThreeGood(large)
    fmt.Println(small[:3])
    // large can now be garbage collected
}
```

---

## 10. Spec Compliance Checklist

- [ ] `cap(s) >= len(s)` invariant holds for all valid slices
- [ ] `cap(nil_slice)` returns 0 without panic
- [ ] `len(nil_slice)` returns 0 without panic
- [ ] `make([]T, n, m)` panics when `n > m`
- [ ] `make([]T, n, m)` panics when `n < 0` or `m < 0` (runtime values)
- [ ] `make([]T, -1)` is a compile error when -1 is a constant
- [ ] `append` to nil slice allocates new array and returns non-nil slice
- [ ] `append` reuses underlying array when capacity is sufficient
- [ ] `append` allocates new array when capacity is exceeded
- [ ] The exact growth factor of `append` is NOT specified by the language spec
- [ ] `s[:0]` preserves capacity (cap(s[:0]) == cap(s))
- [ ] Re-slicing `s[:n]` is valid for `n <= cap(s)`, even if `n > len(s)`
- [ ] Re-slicing `s[:n]` panics when `n > cap(s)`
- [ ] Three-index slicing `s[low:high:max]` sets cap to `max - low`
- [ ] Three-index slicing requires `0 <= low <= high <= max <= cap(s)`
- [ ] Three-index slicing is NOT supported on strings
- [ ] `clear(s)` zeroes elements without changing length or capacity (Go 1.21+)
- [ ] Capacity may be rounded up by the runtime allocator (implementation-defined)
- [ ] Index access `s[i]` panics when `i >= len(s)`, even if `i < cap(s)`

---

## 11. Official Examples

### Example 1: Tracking Capacity Through Append Growth

This program demonstrates how capacity grows as elements are appended, showing the implementation-defined growth pattern.

```go
package main

import "fmt"

func main() {
    var s []int
    fmt.Printf("%-10s %-10s %-10s %-10s\n", "Append#", "Length", "Capacity", "Grew?")
    fmt.Println("------------------------------------------")

    prevCap := cap(s)
    for i := 0; i < 32; i++ {
        s = append(s, i)
        grew := ""
        if cap(s) != prevCap {
            grew = fmt.Sprintf("yes (%d -> %d)", prevCap, cap(s))
            prevCap = cap(s)
        }
        fmt.Printf("%-10d %-10d %-10d %-10s\n", i+1, len(s), cap(s), grew)
    }

    fmt.Println()
    fmt.Println("Final slice length:", len(s))
    fmt.Println("Final slice capacity:", cap(s))
    fmt.Println("Capacity >= Length:", cap(s) >= len(s))
}
```

### Example 2: Full Slice Expression for Safe Sub-Slicing

This program demonstrates how the three-index slice expression prevents append from corrupting shared data.

```go
package main

import "fmt"

// SafeSplit splits a slice at index i, returning two independent slices.
// The full slice expression ensures appending to either half
// does not corrupt the other half.
func SafeSplit(s []int, i int) (left, right []int) {
    left = s[:i:i]    // cap = i - 0 = i (no extra capacity)
    right = s[i:len(s):len(s)] // cap = len(s) - i (no extra capacity)
    return
}

func main() {
    data := []int{10, 20, 30, 40, 50, 60, 70, 80}
    fmt.Println("Original:", data)

    left, right := SafeSplit(data, 4)
    fmt.Printf("Left:  %v (len=%d, cap=%d)\n", left, len(left), cap(left))
    fmt.Printf("Right: %v (len=%d, cap=%d)\n", right, len(right), cap(right))

    // Appending to left does NOT affect right or original
    left = append(left, 99)
    fmt.Println("\nAfter append to left:")
    fmt.Println("Original:", data)   // [10 20 30 40 50 60 70 80] — unchanged
    fmt.Println("Left:    ", left)   // [10 20 30 40 99]
    fmt.Println("Right:   ", right)  // [50 60 70 80] — unchanged

    // Appending to right does NOT affect left or original
    right = append(right, 100)
    fmt.Println("\nAfter append to right:")
    fmt.Println("Original:", data)   // [10 20 30 40 50 60 70 80] — unchanged
    fmt.Println("Left:    ", left)   // [10 20 30 40 99]
    fmt.Println("Right:   ", right)  // [50 60 70 80 100]
}
```

### Example 3: Pre-allocation Strategy Comparison

This program compares the performance implications of different capacity strategies.

```go
package main

import (
    "fmt"
    "time"
)

func appendWithoutPrealloc(n int) []int {
    var s []int // nil slice, cap=0
    for i := 0; i < n; i++ {
        s = append(s, i)
    }
    return s
}

func appendWithPrealloc(n int) []int {
    s := make([]int, 0, n) // pre-allocated capacity
    for i := 0; i < n; i++ {
        s = append(s, i)
    }
    return s
}

func directIndex(n int) []int {
    s := make([]int, n) // pre-allocated with length
    for i := 0; i < n; i++ {
        s[i] = i
    }
    return s
}

func main() {
    n := 10_000_000

    start := time.Now()
    s1 := appendWithoutPrealloc(n)
    d1 := time.Since(start)
    fmt.Printf("No prealloc:   %v (len=%d, cap=%d)\n", d1, len(s1), cap(s1))

    start = time.Now()
    s2 := appendWithPrealloc(n)
    d2 := time.Since(start)
    fmt.Printf("With prealloc: %v (len=%d, cap=%d)\n", d2, len(s2), cap(s2))

    start = time.Now()
    s3 := directIndex(n)
    d3 := time.Since(start)
    fmt.Printf("Direct index:  %v (len=%d, cap=%d)\n", d3, len(s3), cap(s3))

    fmt.Println()
    fmt.Println("Pre-allocation avoids repeated growslice calls.")
    fmt.Println("Direct indexing avoids append overhead entirely.")
}
```

### Example 4: Capacity Behavior with clear (Go 1.21+)

```go
package main

import "fmt"

func main() {
    s := []int{10, 20, 30, 40, 50}
    fmt.Printf("before clear: len=%d cap=%d values=%v\n", len(s), cap(s), s)
    // before clear: len=5 cap=5 values=[10 20 30 40 50]

    clear(s)
    fmt.Printf("after clear:  len=%d cap=%d values=%v\n", len(s), cap(s), s)
    // after clear:  len=5 cap=5 values=[0 0 0 0 0]
    // clear zeroes elements but does NOT change len or cap
}
```

### Example 5: slices.Grow for Explicit Capacity Growth (Go 1.21+)

```go
package main

import (
    "fmt"
    "slices"
)

func main() {
    s := make([]int, 3, 5)
    s[0], s[1], s[2] = 1, 2, 3
    fmt.Printf("before Grow: len=%d cap=%d\n", len(s), cap(s)) // len=3 cap=5

    // Ensure there is room for at least 20 more elements
    s = slices.Grow(s, 20)
    fmt.Printf("after Grow:  len=%d cap=%d\n", len(s), cap(s)) // len=3 cap>=23
    fmt.Printf("cap >= 23:   %v\n", cap(s) >= 23)               // true

    // slices.Grow does not change length or existing elements
    fmt.Println("values:", s) // [1 2 3]
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Slice types | https://go.dev/ref/spec#Slice_types | Core slice type definition, including capacity concept |
| Array types | https://go.dev/ref/spec#Array_types | Arrays are the underlying storage; capacity relates to array size |
| Slice expressions | https://go.dev/ref/spec#Slice_expressions | `a[low:high]` and `a[low:high:max]` — controls resulting capacity |
| Length and capacity | https://go.dev/ref/spec#Length_and_capacity | `len(s)` and `cap(s)` built-in functions |
| Appending and copying slices | https://go.dev/ref/spec#Appending_and_copying_slices | `append` triggers growth; `copy` respects length not capacity |
| Making slices, maps and channels | https://go.dev/ref/spec#Making_slices_maps_and_channels | `make([]T, len, cap)` — explicit capacity allocation |
| Index expressions | https://go.dev/ref/spec#Index_expressions | `s[i]` uses length bound, not capacity |
| Composite literals | https://go.dev/ref/spec#Composite_literals | `[]T{...}` — capacity equals length |
| Built-in functions | https://go.dev/ref/spec#Built-in_functions | Overview of `len`, `cap`, `make`, `append`, `copy`, `clear` |
| Package unsafe | https://go.dev/ref/spec#Package_unsafe | `unsafe.Slice`, `unsafe.SliceData` for low-level access |

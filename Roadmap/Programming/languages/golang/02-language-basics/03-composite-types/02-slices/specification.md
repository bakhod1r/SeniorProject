# Go Specification: Slices

**Source:** https://go.dev/ref/spec#Slice_types
**Section:** Types → Composite Types → Slice Types

---

## 1. Spec Reference

- **Primary:** https://go.dev/ref/spec#Slice_types
- **Related:** https://go.dev/ref/spec#Making_slices_maps_and_channels
- **Related:** https://go.dev/ref/spec#Appending_and_copying_slices
- **Related:** https://go.dev/ref/spec#Index_expressions
- **Related:** https://go.dev/ref/spec#Slice_expressions
- **Related:** https://go.dev/ref/spec#Length_and_capacity

Official definition from the spec:

> "A slice is a descriptor for a contiguous segment of an underlying array and provides access to a numbered sequence of elements from that array. A slice type denotes the set of all slices of arrays of its element type. The number of elements is called the length of the slice and is never negative. The value of an uninitialized slice is nil."

---

## 2. Formal Grammar (EBNF)

```ebnf
SliceType      = "[" "]" ElementType .
ElementType    = Type .

SliceExpr      = SimpleSliceExpr | FullSliceExpr .
SimpleSliceExpr = PrimaryExpr "[" [ Expression ] ":" [ Expression ] "]" .
FullSliceExpr   = PrimaryExpr "[" [ Expression ] ":" Expression ":" Expression "]" .
```

- `SliceType` has no length specification (unlike arrays).
- `ElementType` can be any type.
- Slice expressions operate on arrays, array pointers, or existing slices.

**Examples of valid slice types:**

```
[]int
[]string
[][]byte         // slice of slices
[]*MyStruct      // slice of pointers
[]interface{}    // slice of any
```

---

## 3. Core Rules & Constraints

### 3.1 Slice Header: Three-Word Descriptor

Every slice value is an internal three-word descriptor:
1. **Pointer** — points to the first element of the underlying array segment
2. **Length** — number of elements accessible via the slice
3. **Capacity** — number of elements from the pointer to the end of the underlying array

```go
package main

import "fmt"

func main() {
    a := [5]int{10, 20, 30, 40, 50}
    s := a[1:3]
    fmt.Println("slice:   ", s)       // [20 30]
    fmt.Println("len:     ", len(s))  // 2
    fmt.Println("cap:     ", cap(s))  // 4  (from index 1 to end of a)
}
```

### 3.2 Nil Slice

The zero value of a slice is `nil`. A nil slice has length 0, capacity 0, and a nil pointer. Most slice operations are safe on nil slices.

```go
package main

import "fmt"

func main() {
    var s []int
    fmt.Println(s == nil)  // true
    fmt.Println(len(s))    // 0
    fmt.Println(cap(s))    // 0

    // append works on nil slice
    s = append(s, 1, 2, 3)
    fmt.Println(s) // [1 2 3]
}
```

### 3.3 Slice Expressions — Simple Form

`a[low : high]` creates a slice from index `low` (inclusive) to `high` (exclusive).

Rules:
- `0 <= low <= high <= cap(a)`
- Length of result = `high - low`
- Capacity of result = `cap(a) - low`
- If `low` is omitted, it defaults to 0.
- If `high` is omitted, it defaults to `len(a)`.

```go
package main

import "fmt"

func main() {
    a := []int{1, 2, 3, 4, 5}
    fmt.Println(a[1:3])  // [2 3]
    fmt.Println(a[:2])   // [1 2]
    fmt.Println(a[2:])   // [3 4 5]
    fmt.Println(a[:])    // [1 2 3 4 5]
}
```

### 3.4 Slice Expressions — Full (Three-Index) Form

`a[low : high : max]` additionally controls the capacity of the resulting slice.

- Capacity = `max - low`
- Constraint: `0 <= low <= high <= max <= cap(a)`
- Only valid on arrays, pointers to arrays, or slices (not strings).

```go
package main

import "fmt"

func main() {
    a := []int{1, 2, 3, 4, 5}
    s := a[1:3:4]
    fmt.Println(s)        // [2 3]
    fmt.Println(len(s))   // 2
    fmt.Println(cap(s))   // 3  (4 - 1)
}
```

### 3.5 Slices Are Reference Types

Unlike arrays, slices are reference types. Multiple slices can share the same underlying array. Modifying elements through one slice is visible through other slices sharing the same memory.

```go
package main

import "fmt"

func main() {
    a := []int{1, 2, 3, 4, 5}
    b := a[1:3]
    b[0] = 99
    fmt.Println(a) // [1 99 3 4 5]
    fmt.Println(b) // [99 3]
}
```

---

## 4. Type Rules

### 4.1 Slice Type Identity

Two slice types are identical if they have the same element type. Length is NOT part of the type.

```go
// []int and []int    → identical
// []int and []int32  → NOT identical
// [][]int            → slice of slice of int
```

### 4.2 Assignability

A nil slice of type `[]T` is assignable to any variable of type `[]T`. Slices of the same element type are directly assignable.

```go
package main

import "fmt"

func main() {
    var a []int
    b := []int{1, 2, 3}
    a = b
    fmt.Println(a) // [1 2 3]
}
```

### 4.3 Slices Are NOT Comparable

Slices cannot be compared with `==` except against `nil`. Comparing two slices with `==` is a compile-time error.

```go
package main

import "fmt"

func main() {
    a := []int{1, 2, 3}
    fmt.Println(a == nil) // false — only nil comparison allowed
    // fmt.Println(a == []int{1,2,3}) // compile error: slice can only be compared to nil
}
```

### 4.4 Interface Satisfaction

A slice type itself does not implement any interfaces beyond the empty interface. Slices can be stored in `interface{}` or `any`.

---

## 5. Behavioral Specification

### 5.1 `append` — Appending to a Slice

The built-in `append(s S, x ...T) S` appends elements to a slice. If the underlying array has insufficient capacity, `append` allocates a new, larger array and copies elements.

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3}
    s = append(s, 4, 5)
    fmt.Println(s) // [1 2 3 4 5]

    // Appending another slice with ...
    t := []int{6, 7}
    s = append(s, t...)
    fmt.Println(s) // [1 2 3 4 5 6 7]
}
```

### 5.2 `copy` — Copying Between Slices

`copy(dst, src []T) int` copies min(len(dst), len(src)) elements from src to dst. Returns number copied.

```go
package main

import "fmt"

func main() {
    src := []int{1, 2, 3, 4, 5}
    dst := make([]int, 3)
    n := copy(dst, src)
    fmt.Println("copied:", n)  // 3
    fmt.Println("dst:", dst)   // [1 2 3]
}
```

### 5.3 `len` and `cap`

- `len(s)` returns the number of elements accessible in the slice.
- `cap(s)` returns the number of elements from the slice's pointer to the end of the underlying array.

```go
package main

import "fmt"

func main() {
    s := make([]int, 3, 10)
    fmt.Println(len(s)) // 3
    fmt.Println(cap(s)) // 10
}
```

### 5.4 Growing Capacity (Append Growth Strategy)

When `append` must grow, the new capacity is not specified by the spec — it is implementation-defined. In practice (gc compiler), the capacity roughly doubles for small slices and uses a proportional growth factor for larger ones.

```go
package main

import "fmt"

func main() {
    var s []int
    for i := 0; i < 10; i++ {
        s = append(s, i)
        fmt.Printf("len=%d cap=%d\n", len(s), cap(s))
    }
}
```

### 5.5 Ranging Over Slices

```go
package main

import "fmt"

func main() {
    fruits := []string{"apple", "banana", "cherry"}
    for i, v := range fruits {
        fmt.Printf("%d: %s\n", i, v)
    }
}
```

### 5.6 Deleting Elements

The spec does not provide a delete built-in for slices. The idiomatic approach uses append.

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3, 4, 5}
    i := 2 // delete element at index 2
    s = append(s[:i], s[i+1:]...)
    fmt.Println(s) // [1 2 4 5]
}
```

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined: Index Out of Range

Accessing `s[i]` where `i < 0` or `i >= len(s)` causes a runtime panic.

```go
package main

func main() {
    s := []int{1, 2, 3}
    _ = s[5] // panic: runtime error: index out of range [5] with length 3
}
```

### 6.2 Defined: Slice Bounds Out of Range

Slicing with invalid bounds panics at runtime with a descriptive message.

```go
package main

func main() {
    s := []int{1, 2, 3}
    _ = s[1:10] // panic: runtime error: slice bounds out of range [1:10] with length 3
}
```

### 6.3 Defined: Append on Nil Slice

Appending to a nil slice is well-defined and produces a new non-nil slice.

```go
package main

import "fmt"

func main() {
    var s []int
    s = append(s, 1)
    fmt.Println(s)        // [1]
    fmt.Println(s == nil) // false
}
```

### 6.4 Defined: Copy Source/Dest Overlap

`copy` from a string to `[]byte` or within the same backing array is well-defined. Overlapping `copy` within the same slice is safe.

### 6.5 Defined: Modifying Slice Returned by Function

If a function returns a slice, the caller may modify elements. The underlying array is shared.

---

## 7. Edge Cases from Spec

### 7.1 Empty Slice vs Nil Slice

An empty (non-nil) slice `[]int{}` is different from `nil`. Both have length 0, but only the nil slice equals nil.

```go
package main

import "fmt"

func main() {
    var a []int         // nil slice
    b := []int{}        // empty, non-nil
    c := make([]int, 0) // empty, non-nil

    fmt.Println(a == nil) // true
    fmt.Println(b == nil) // false
    fmt.Println(c == nil) // false
    fmt.Println(len(a), len(b), len(c)) // 0 0 0
}
```

### 7.2 Re-slicing Beyond Current Length (Up to Capacity)

A slice can be re-sliced up to its capacity, even beyond its current length.

```go
package main

import "fmt"

func main() {
    a := [5]int{1, 2, 3, 4, 5}
    s := a[1:2] // len=1, cap=4
    s2 := s[:4] // re-slice up to cap
    fmt.Println(s2) // [2 3 4 5]
}
```

### 7.3 Slice of String (Bytes)

Strings can be sliced like byte slices, but the result is still a string (immutable).

```go
package main

import "fmt"

func main() {
    str := "hello world"
    sub := str[6:11]
    fmt.Println(sub) // world
}
```

### 7.4 Passing Slice to Function

Since a slice header is copied on pass, modifying the slice's elements within the function affects the caller's data, but reslicing or appending (which may reallocate) does not affect the caller's slice variable.

```go
package main

import "fmt"

func modifyElem(s []int) {
    s[0] = 999 // affects caller
}

func appendToSlice(s []int) {
    s = append(s, 100) // does NOT affect caller's variable
}

func main() {
    s := []int{1, 2, 3}
    modifyElem(s)
    fmt.Println(s) // [999 2 3]
    appendToSlice(s)
    fmt.Println(s) // [999 2 3] — unchanged length
}
```

### 7.5 Three-Index Slice Prevents Accidental Sharing

Using the full slice expression limits capacity, preventing append from modifying shared data beyond the intended range.

```go
package main

import "fmt"

func main() {
    a := []int{1, 2, 3, 4, 5}
    s := a[1:3:3] // cap limited to 3-1=2

    // append to s will NOT overwrite a[3]
    s = append(s, 99)
    fmt.Println(a) // [1 2 3 4 5] — unchanged
    fmt.Println(s) // [2 3 99]
}
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0     | Slice type with len/cap semantics introduced |
| Go 1.2     | Three-index slicing `a[low:high:max]` added |
| Go 1.17    | No changes to slice spec |
| Go 1.20    | `unsafe.SliceData(s)` returns pointer to underlying array; `unsafe.Slice(ptr, n)` creates slice from pointer |
| Go 1.21    | `slices` package added to stdlib (not spec change, but standard library support) |

---

## 9. Implementation-Specific Behavior

### 9.1 Slice Header Layout (gc Compiler)

In the `gc` compiler, a slice is represented as:

```
type SliceHeader struct {
    Data uintptr  // pointer to underlying array
    Len  int      // current length
    Cap  int      // capacity
}
```

This is exposed via `reflect.SliceHeader` (deprecated in Go 1.20 in favor of `unsafe.Slice`/`unsafe.SliceData`).

### 9.2 Append Growth Factor

As of Go 1.18+, the gc compiler uses a smoothed growth factor:
- For small slices (cap < 256): capacity roughly doubles.
- For larger slices: grows by ~25% + amortization padding.
- The exact formula is implementation-defined.

### 9.3 GC and Slice Memory

If a large array underlies a small slice, the garbage collector keeps the entire array alive. To release the underlying array, use `copy` to a new slice.

```go
package main

import "fmt"

func extractSmall(big []int) []int {
    small := make([]int, 3)
    copy(small, big[:3]) // big can now be GC'd
    return small
}

func main() {
    big := make([]int, 1000000)
    small := extractSmall(big)
    fmt.Println(small)
}
```

---

## 10. Spec Compliance Checklist

- [ ] Slice zero value is nil (pointer=nil, len=0, cap=0)
- [ ] Nil slice is safe for len, cap, range, append, copy
- [ ] Slice holds pointer + length + capacity internally
- [ ] Modifying elements through one slice affects all slices sharing the array
- [ ] Slice bounds `[low:high]` require `0 <= low <= high <= cap`
- [ ] Three-index slicing `[low:high:max]` limits capacity to `max-low`
- [ ] `append` returns a new slice (must reassign result)
- [ ] `append` may or may not allocate a new array (implementation-defined growth)
- [ ] `copy` copies min(len(dst), len(src)) elements
- [ ] Slices are NOT comparable with `==` (only `== nil` allowed)
- [ ] Index out of range causes runtime panic (not undefined behavior)
- [ ] Reslicing up to `cap` is valid even beyond current `len`
- [ ] `[]T{}` is empty but NOT nil

---

## 11. Official Examples

### Example 1: Basic Slice Operations

```go
package main

import "fmt"

func main() {
    s := make([]string, 3)
    s[0] = "a"
    s[1] = "b"
    s[2] = "c"
    fmt.Println("set:", s)
    fmt.Println("get:", s[2])
    fmt.Println("len:", len(s))

    s = append(s, "d")
    s = append(s, "e", "f")
    fmt.Println("apd:", s)

    c := make([]string, len(s))
    copy(c, s)
    fmt.Println("cpy:", c)

    l := s[2:5]
    fmt.Println("sl1:", l)

    l = s[:5]
    fmt.Println("sl2:", l)

    l = s[2:]
    fmt.Println("sl3:", l)
}
```

### Example 2: Slice of Slices (2D)

```go
package main

import (
    "fmt"
    "strings"
)

func main() {
    board := [][]string{
        {"_", "_", "_"},
        {"_", "_", "_"},
        {"_", "_", "_"},
    }
    board[0][0] = "X"
    board[2][2] = "O"
    board[1][1] = "X"
    for i := 0; i < len(board); i++ {
        fmt.Println(strings.Join(board[i], " "))
    }
}
```

### Example 3: Nil Slice Behavior

```go
package main

import "fmt"

func main() {
    var s []int
    fmt.Println(s, len(s), cap(s)) // [] 0 0
    if s == nil {
        fmt.Println("nil!")
    }
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Array types | https://go.dev/ref/spec#Array_types | Arrays are the underlying storage for slices |
| Making slices | https://go.dev/ref/spec#Making_slices_maps_and_channels | `make([]T, len, cap)` |
| Appending/copying | https://go.dev/ref/spec#Appending_and_copying_slices | `append` and `copy` built-ins |
| Slice expressions | https://go.dev/ref/spec#Slice_expressions | `a[low:high]` and `a[low:high:max]` |
| Index expressions | https://go.dev/ref/spec#Index_expressions | `s[i]` access rules |
| Length and capacity | https://go.dev/ref/spec#Length_and_capacity | `len` and `cap` built-ins |
| Composite literals | https://go.dev/ref/spec#Composite_literals | `[]T{...}` syntax |
| For range | https://go.dev/ref/spec#For_range | Iteration over slices |
| Type identity | https://go.dev/ref/spec#Type_identity | When two slice types are identical |
| Package unsafe | https://go.dev/ref/spec#Package_unsafe | `unsafe.Slice`, `unsafe.SliceData` |

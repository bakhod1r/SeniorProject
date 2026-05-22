# Go Specification: Array-to-Slice Conversion

**Source:** https://go.dev/ref/spec#Slice_expressions
**Section:** Expressions → Slice expressions (operating on arrays)

---

## 1. Spec Reference

- **Primary:** https://go.dev/ref/spec#Slice_expressions
- **Related:** https://go.dev/ref/spec#Conversions (slice-to-array / slice-to-array-pointer)
- **Related:** https://go.dev/ref/spec#Length_and_capacity
- **Related:** https://go.dev/ref/spec#Address_operators
- **Related:** https://go.dev/ref/spec#Composite_literals

Official wording from the spec:

> "For arrays or strings, the indices are in range if `0 <= low <= high <= len(a)`, otherwise they are out of range. For slices, the upper index bound is the slice capacity `cap(a)` rather than the length. If the sliced operand is an array, it must be addressable and the result of the slice operation is a slice with the same element type as the array."

---

## 2. Formal Grammar (EBNF)

```ebnf
SliceExpr       = SimpleSliceExpr | FullSliceExpr .
SimpleSliceExpr = PrimaryExpr "[" [ Expression ] ":" [ Expression ] "]" .
FullSliceExpr   = PrimaryExpr "[" [ Expression ] ":" Expression ":" Expression "]" .
```

The `PrimaryExpr` may be an array, a pointer to an array, a slice, or a string. For array-to-slice conversion specifically, `PrimaryExpr` is an **addressable array** or a **pointer to an array**.

```go
arr := [5]int{10, 20, 30, 40, 50}
s  := arr[:]      // []int, len=5, cap=5
s2 := arr[1:4]    // []int, len=3, cap=4
s3 := arr[1:3:4]  // []int, len=2, cap=3
```

---

## 3. Core Rules & Constraints

### 3.1 The Array Must Be Addressable

Slicing an array requires the array operand to be addressable (a variable, a dereferenced pointer, or an addressable element). A non-addressable array (e.g., an array returned from a function, or an array composite literal value) cannot be sliced directly.

```go
package main

func get() [3]int { return [3]int{1, 2, 3} }

func main() {
    // _ = get()[:]          // compile error: cannot slice unaddressable value
    a := get()
    _ = a[:]                 // OK — 'a' is addressable
}
```

A pointer to an array IS sliceable even when the pointer itself comes from a non-addressable expression, because the array it points to is addressable.

### 3.2 Resulting Length and Capacity

For `a[low:high]` on array `a` with length `N`:
- length = `high - low`
- capacity = `N - low`

For the full expression `a[low:high:max]`:
- length = `high - low`
- capacity = `max - low`

```go
package main

import "fmt"

func main() {
    a := [6]int{0, 1, 2, 3, 4, 5}
    s := a[2:4]
    fmt.Println(len(s), cap(s)) // 2 4
    t := a[2:4:5]
    fmt.Println(len(t), cap(t)) // 2 3
}
```

### 3.3 The Slice Shares the Array's Memory

Array-to-slice conversion does NOT copy elements. The slice header points into the array's storage. Writing through the slice mutates the array.

```go
package main

import "fmt"

func main() {
    a := [3]int{1, 2, 3}
    s := a[:]
    s[0] = 99
    fmt.Println(a) // [99 2 3] — array changed
}
```

### 3.4 Pointer-to-Array Slicing

`(&a)[:]` and `p[:]` (where `p` is `*[N]T`) are valid and produce a slice over the pointed-to array. A nil array pointer panics only if `low`/`high` are non-zero; `p[0:0]` on a nil `*[0]T`-style edge is defined narrowly — in practice slicing a nil array pointer with non-empty bounds panics.

```go
package main

import "fmt"

func main() {
    a := [4]int{1, 2, 3, 4}
    p := &a
    s := p[1:3]  // equivalent to (*p)[1:3]
    fmt.Println(s) // [2 3]
}
```

---

## 4. Type Rules

### 4.1 Element Type Is Preserved

Slicing `[N]T` yields `[]T`. The element type is identical; only the container changes from fixed-array to slice.

### 4.2 Distinct From the Reverse Conversion

Go 1.17+ allows slice→array-pointer conversion, and Go 1.20+ allows slice→array conversion. Those are *conversions* (`(*[4]int)(s)`, `[4]int(s)`), separate from the slice-expression mechanism described here.

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3, 4}
    arrPtr := (*[4]int)(s) // Go 1.17+
    arr := [4]int(s)       // Go 1.20+ (copies)
    fmt.Println(*arrPtr, arr)
}
```

### 4.3 No Implicit Conversion

There is no implicit array→slice conversion in assignments or function calls. You must use a slice expression (`a[:]`) explicitly.

```go
package main

func takesSlice(s []int) {}

func main() {
    a := [3]int{1, 2, 3}
    // takesSlice(a)   // compile error: cannot use a (type [3]int) as type []int
    takesSlice(a[:])   // OK
}
```

---

## 5. Behavioral Specification

### 5.1 Default Bounds

Omitting `low` defaults to 0; omitting `high` defaults to `len(a)`. `a[:]` slices the entire array.

### 5.2 Re-slicing Within Capacity

Because capacity extends to the end of the array, the resulting slice can be re-sliced to reach array elements past the original `high`.

```go
package main

import "fmt"

func main() {
    a := [5]int{1, 2, 3, 4, 5}
    s := a[1:2]   // len=1, cap=4
    s = s[:4]     // grow within capacity
    fmt.Println(s) // [2 3 4 5]
}
```

### 5.3 append May Detach the Slice From the Array

While capacity remains, `append` writes into the array. Once capacity is exceeded, `append` allocates a new backing array and the slice no longer aliases the original array.

```go
package main

import "fmt"

func main() {
    a := [3]int{1, 2, 3}
    s := a[:2]            // len=2 cap=3
    s = append(s, 99)     // fits in cap → mutates a
    fmt.Println(a)        // [1 2 99]
    s = append(s, 100)    // exceeds cap → reallocates
    s[0] = -1
    fmt.Println(a)        // [1 2 99] — a untouched now
}
```

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined: Out-of-Range Bounds Panic

`a[low:high]` with `high > len(a)` (for arrays, capacity equals length) panics at runtime, or is a compile error if all indices are constants and out of range.

```go
package main

func main() {
    a := [3]int{1, 2, 3}
    _ = a[1:10] // panic: slice bounds out of range [:10] with capacity 3
}
```

### 6.2 Defined: Unaddressable Array Slicing Is a Compile Error

Slicing a non-addressable array value is rejected at compile time, not runtime.

### 6.3 Defined: Zero-Length Slice

`a[len(a):len(a)]` is valid and yields an empty, non-nil slice with capacity 0.

### 6.4 Defined: Aliasing Guarantees

The spec guarantees the resulting slice aliases the array's storage until a reallocation occurs; this is not implementation-defined.

---

## 7. Edge Cases from Spec

### 7.1 Slicing an Array Element of a Struct

An array field of an addressable struct is itself addressable and sliceable.

```go
package main

import "fmt"

func main() {
    type T struct{ data [4]byte }
    var t T
    s := t.data[:]
    s[0] = 0xFF
    fmt.Println(t.data) // [255 0 0 0]
}
```

### 7.2 Slicing Array Returned by Map Index Is Illegal

A map index expression is not addressable, so `m[k][:]` where the value is an array is a compile error.

```go
package main

func main() {
    m := map[string][3]int{"a": {1, 2, 3}}
    // _ = m["a"][:] // compile error: cannot slice unaddressable value
    v := m["a"]
    _ = v[:]         // OK after copy to addressable variable
}
```

### 7.3 Full Slice Expression Caps Sharing

`a[low:high:max]` limits capacity so a later `append` reallocates earlier, protecting the tail of the array from accidental overwrite.

### 7.4 Array Pointer From Composite Literal

`(&[3]int{1,2,3})[:]` is valid: the composite literal taken by address is addressable.

```go
package main

import "fmt"

func main() {
    s := (&[3]int{1, 2, 3})[:]
    fmt.Println(s) // [1 2 3]
}
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Array and pointer-to-array slice expressions defined |
| Go 1.2 | Full three-index slice expression `a[low:high:max]` added |
| Go 1.17 | Slice → array pointer conversion `(*[N]T)(s)` added (reverse direction) |
| Go 1.20 | Slice → array value conversion `[N]T(s)` added (copies) |
| Go 1.21 | No change to array-to-slice semantics |

---

## 9. Implementation-Specific Behavior

### 9.1 Escape Analysis Decides Stack vs Heap

If the compiler proves the slice does not escape the function, the backing array stays on the stack and slicing allocates nothing. If the slice escapes (returned, stored in a heap object), the array is heap-allocated.

```go
package main

func sumLocal() int {
    a := [4]int{1, 2, 3, 4} // may stay on stack
    s := a[:]
    total := 0
    for _, v := range s {
        total += v
    }
    return total
}

func main() { _ = sumLocal() }
```

Inspect with `go build -gcflags='-m'`.

### 9.2 No Runtime Cost for the Conversion Itself

The slice header construction is three word-sized stores (pointer, len, cap). There is no element copy, so array-to-slice conversion is O(1).

### 9.3 Backing Array Keeps the Whole Array Alive

A small slice over a large array keeps the entire array reachable for GC. Copy to a fresh slice (`make`+`copy`) to release the array.

---

## 10. Spec Compliance Checklist

- [ ] The sliced array must be addressable (or a pointer to an array)
- [ ] `a[low:high]` length = `high-low`, capacity = `len(a)-low`
- [ ] `a[low:high:max]` capacity = `max-low`
- [ ] Conversion shares memory — no element copy (O(1))
- [ ] Writing through the slice mutates the array (until reallocation)
- [ ] `(&a)[:]` and `p[:]` for `p *[N]T` are valid
- [ ] No implicit array→slice conversion in calls/assignments
- [ ] Out-of-range bounds panic at runtime (compile error if constant)
- [ ] Unaddressable array (function return, map index) cannot be sliced directly
- [ ] `a[len(a):len(a)]` yields an empty non-nil slice
- [ ] Full slice expression caps capacity to limit array sharing

---

## 11. Official Examples

### Example 1: Basic Conversion and Aliasing

```go
package main

import "fmt"

func main() {
    arr := [5]int{10, 20, 30, 40, 50}
    s := arr[1:4]
    fmt.Println(s, len(s), cap(s)) // [20 30 40] 3 4
    s[0] = 0
    fmt.Println(arr) // [10 0 30 40 50]
}
```

### Example 2: Passing a Fixed Array as a Slice

```go
package main

import "fmt"

func sum(nums []int) int {
    t := 0
    for _, n := range nums {
        t += n
    }
    return t
}

func main() {
    a := [4]int{1, 2, 3, 4}
    fmt.Println(sum(a[:])) // 10
}
```

### Example 3: Capacity-Limited Slice

```go
package main

import "fmt"

func main() {
    a := [5]int{1, 2, 3, 4, 5}
    s := a[0:2:2]      // cap=2
    s = append(s, 99)  // exceeds cap → new array
    fmt.Println(a)     // [1 2 3 4 5] unchanged
    fmt.Println(s)     // [1 2 99]
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Slice expressions | https://go.dev/ref/spec#Slice_expressions | The core `a[low:high:max]` rules |
| Conversions | https://go.dev/ref/spec#Conversions | Reverse slice→array conversions |
| Length and capacity | https://go.dev/ref/spec#Length_and_capacity | `len`/`cap` of the result |
| Address operators | https://go.dev/ref/spec#Address_operators | Addressability of arrays |
| Array types | https://go.dev/ref/spec#Array_types | The source operand type |
| Slice types | https://go.dev/ref/spec#Slice_types | The result type |
| Appending and copying slices | https://go.dev/ref/spec#Appending_and_copying_slices | When append detaches from the array |
| Composite literals | https://go.dev/ref/spec#Composite_literals | Addressability of `&[N]T{...}` |

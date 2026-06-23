# Go Specification: Slice to Array Conversion

**Source:** https://go.dev/ref/spec#Conversions
**Section:** Conversions → Slice to array or array pointer conversions

---

## 1. Spec Reference

- **Primary:** https://go.dev/ref/spec#Conversions
- **Related:** https://go.dev/ref/spec#Slice_types
- **Related:** https://go.dev/ref/spec#Array_types
- **Related:** https://go.dev/ref/spec#Package_unsafe

Official definition from the spec:

> "Converting a value of a slice type to a type of array type yields an array containing the elements of the underlying slice. Similarly, converting a value of a slice type to a type of array pointer type yields a pointer to a new or shared array."

> "If the length of the array type is greater than the length of the slice, a run-time panic occurs."

**Go version requirement:** Slice-to-array conversion was added in **Go 1.20**. Slice-to-array-pointer conversion was available from **Go 1.17**.

---

## 2. Formal Grammar (EBNF)

```ebnf
Conversion = Type "(" Expression [ "," ] ")" .

-- Slice to array pointer (Go 1.17+):
SliceToArrayPtr = "*[N]T" "(" sliceExpr ")" .

-- Slice to array (Go 1.20+):
SliceToArray    = "[N]T" "(" sliceExpr ")" .
```

Where:
- `N` is a non-negative integer constant (the target array length)
- `T` is the element type (must match the slice's element type)
- `sliceExpr` is any expression of type `[]T`

**Valid conversions:**

```
[]int → *[3]int    // slice-to-array-pointer (Go 1.17+)
[]int → [3]int     // slice-to-array (Go 1.20+)
[]byte → *[0]byte  // valid: zero-length array pointer
[]byte → [0]byte   // valid: zero-length array
```

---

## 3. Core Rules & Constraints

### 3.1 Slice-to-Array-Pointer (Go 1.17+)

Converting `[]T` to `*[N]T` yields a pointer to the slice's underlying array starting at the slice's pointer. The resulting pointer points into the same memory as the slice.

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3, 4, 5}
    p := (*[3]int)(s) // pointer to first 3 elements
    fmt.Println(*p)   // [1 2 3]

    // Modifying through p affects s
    p[0] = 99
    fmt.Println(s) // [99 2 3 4 5]
}
```

### 3.2 Slice-to-Array (Go 1.20+)

Converting `[]T` to `[N]T` copies the first N elements into a new array value. This is a **value copy**, unlike the pointer form.

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3, 4, 5}
    a := [3]int(s) // copies first 3 elements
    fmt.Println(a) // [1 2 3]

    // Modifying a does NOT affect s
    a[0] = 99
    fmt.Println(s) // [1 2 3 4 5] — unchanged
    fmt.Println(a) // [99 2 3 4 5]
}
```

### 3.3 Panic When Slice Too Short

If `len(s) < N`, a runtime panic occurs: `"runtime error: cannot convert slice with length L to array or pointer to array with length N"`.

```go
package main

func main() {
    s := []int{1, 2}
    _ = [5]int(s)   // panic: cannot convert slice with length 2 to array or pointer to array with length 5
}
```

### 3.4 Converting Nil Slice

Converting a nil slice to a non-zero-length array pointer panics. Converting a nil slice to `*[0]T` is valid (yields a non-nil pointer in some cases — see edge cases).

```go
package main

func main() {
    var s []int
    // _ = (*[3]int)(s) // panic: cannot convert nil slice to array pointer
    p := (*[0]int)(s)   // valid — returns nil pointer for nil slice
    _ = p
}
```

### 3.5 Element Type Must Match

The element type of the slice and the array must be identical. No implicit conversion.

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3}
    a := [3]int(s)
    fmt.Println(a)
    // b := [3]int64(s) // compile error: cannot convert s (type []int) to type [3]int64
}
```

---

## 4. Type Rules

### 4.1 Type of the Result

- `[]T` → `*[N]T`: result is of type `*[N]T`
- `[]T` → `[N]T`: result is of type `[N]T`

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3}

    p := (*[3]int)(s)   // type: *[3]int
    a := [3]int(s)      // type: [3]int

    fmt.Printf("%T\n", p) // *[3]int
    fmt.Printf("%T\n", a) // [3]int
}
```

### 4.2 The Conversion is Explicit

There is no implicit conversion between slices and arrays. The explicit conversion syntax is required.

### 4.3 Assignability After Conversion

The resulting array type follows normal array assignment rules — arrays of same type are assignable.

### 4.4 Named Slice Types

The conversion also works with named slice types whose underlying type is a slice.

```go
package main

import "fmt"

type ByteSlice []byte

func main() {
    s := ByteSlice{65, 66, 67}
    a := [3]byte(s)
    fmt.Println(a) // [65 66 67]
}
```

---

## 5. Behavioral Specification

### 5.1 Pointer Form Shares Memory

The `*[N]T` form produces a pointer into the slice's backing array. Mutations through the pointer are reflected in the original slice.

```go
package main

import "fmt"

func fillFirst3(p *[3]int, val int) {
    for i := range p {
        p[i] = val
    }
}

func main() {
    s := []int{0, 0, 0, 4, 5}
    fillFirst3((*[3]int)(s), 99)
    fmt.Println(s) // [99 99 99 4 5]
}
```

### 5.2 Array Form Copies Memory

The `[N]T` form (Go 1.20+) produces an independent copy. This is useful when you need an array value from a slice without aliasing concerns.

```go
package main

import "fmt"

func main() {
    s := make([]int, 5)
    for i := range s {
        s[i] = i + 1
    }
    arr := [5]int(s) // full copy
    s[0] = 99        // does not affect arr
    fmt.Println(arr) // [1 2 3 4 5]
    fmt.Println(s)   // [99 2 3 4 5]
}
```

### 5.3 Using with Cryptography / Fixed-Size Buffers

A common use case is extracting fixed-size keys or hashes from byte slices.

```go
package main

import (
    "crypto/sha256"
    "fmt"
)

func main() {
    data := []byte("hello")
    hashSlice := sha256.Sum256(data) // already returns [32]byte
    _ = hashSlice

    // If you have a []byte and need [32]byte:
    raw := make([]byte, 32)
    var key [32]byte = [32]byte(raw) // Go 1.20+
    fmt.Println(key)
}
```

### 5.4 Passing Slice Segment to Array-Expecting Function

```go
package main

import "fmt"

func processFixed(arr [4]int) int {
    sum := 0
    for _, v := range arr {
        sum += v
    }
    return sum
}

func main() {
    data := []int{10, 20, 30, 40, 50, 60}
    // Extract middle 4 elements as array
    arr := [4]int(data[1:5])
    fmt.Println(processFixed(arr)) // 140
}
```

### 5.5 Zero-Length Array Conversion

Converting any slice (including nil) to `[0]T` is always valid (never panics for the array form).

```go
package main

import "fmt"

func main() {
    var nilSlice []int
    var empty []int = []int{}
    nonempty := []int{1, 2, 3}

    a := [0]int(nilSlice)
    b := [0]int(empty)
    c := [0]int(nonempty)

    fmt.Println(a, b, c) // [] [] []
    fmt.Println(len(a), len(b), len(c)) // 0 0 0
}
```

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined: Length Violation Panics at Runtime

```go
package main

import "fmt"

func safeCast(s []int, n int) (a [3]int, ok bool) {
    defer func() {
        if r := recover(); r != nil {
            ok = false
        }
    }()
    if len(s) >= 3 {
        a = [3]int(s)
        ok = true
    }
    return
}

func main() {
    s1 := []int{1, 2, 3, 4}
    s2 := []int{1}
    a1, ok1 := safeCast(s1, 3)
    a2, ok2 := safeCast(s2, 3)
    fmt.Println(a1, ok1) // [1 2 3] true
    fmt.Println(a2, ok2) // [0 0 0] false
}
```

### 6.2 Defined: Nil Slice Pointer Conversion

`(*[0]T)(nil)` yields a nil pointer. `(*[N]T)(nil)` for N > 0 panics.

```go
package main

import "fmt"

func main() {
    var s []int
    p := (*[0]int)(s) // nil pointer — valid
    fmt.Println(p)    // <nil>
}
```

### 6.3 Defined: Capacity Not Required

Only `len(s) >= N` is required, not `cap(s) >= N`. The conversion only needs the first N elements to exist.

### 6.4 Defined: Result Array Is Independent (Array Form)

The array conversion result does not share memory with the slice. Future appends or reallocations of the slice do not affect the array.

---

## 7. Edge Cases from Spec

### 7.1 Converting Resliced Slice

The conversion starts at the slice's current start position, not the start of the underlying array.

```go
package main

import "fmt"

func main() {
    a := [5]int{10, 20, 30, 40, 50}
    s := a[2:] // s starts at a[2]
    arr := [3]int(s)
    fmt.Println(arr) // [30 40 50]
}
```

### 7.2 Pointer Form on Resliced Slice

```go
package main

import "fmt"

func main() {
    a := [5]int{10, 20, 30, 40, 50}
    s := a[1:4] // points to a[1]
    p := (*[3]int)(s)
    p[0] = 99
    fmt.Println(a) // [10 99 30 40 50] — a[1] was modified
}
```

### 7.3 Go Version Guard

Code using `[N]T(s)` (array form) must use `go 1.20` or later in `go.mod`. Using it with an earlier language version causes a compile error.

```go
// go.mod: go 1.20
package main

import "fmt"

func main() {
    s := []int{1, 2, 3}
    arr := [3]int(s) // requires go 1.20+
    fmt.Println(arr)
}
```

### 7.4 Generics with Slice-to-Array

```go
package main

import "fmt"

func toArray3[T any](s []T) [3]T {
    return [3]T(s) // panics if len(s) < 3
}

func main() {
    s := []int{1, 2, 3, 4, 5}
    arr := toArray3(s)
    fmt.Println(arr) // [1 2 3]
}
```

### 7.5 Using unsafe for Pre-1.17 Equivalents

Before Go 1.17, the only way to get a pointer to the slice's array was through `unsafe`.

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    s := []int{1, 2, 3, 4, 5}
    // Old way (unsafe, still valid):
    p := (*[3]int)(unsafe.Pointer(&s[0]))
    fmt.Println(*p) // [1 2 3]

    // New way (Go 1.17+, safe):
    p2 := (*[3]int)(s)
    fmt.Println(*p2) // [1 2 3]
}
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0–1.16 | No direct slice-to-array conversion; `unsafe.Pointer` required |
| Go 1.17    | Slice-to-array-pointer conversion `(*[N]T)(s)` added to spec |
| Go 1.20    | Slice-to-array conversion `[N]T(s)` added to spec (value copy form) |
| Go 1.21    | No changes |

**Migration note:** Code using `(*[N]T)(unsafe.Pointer(&s[0]))` can be replaced with `(*[N]T)(s)` on Go 1.17+ and `[N]T(s)` on Go 1.20+ for the safer, more idiomatic form.

---

## 9. Implementation-Specific Behavior

### 9.1 Array Conversion (Go 1.20) — Stack vs Heap

The resulting array value is an independent copy. The gc compiler may allocate it on the stack if it does not escape the function.

### 9.2 Pointer Conversion — No Allocation

`(*[N]T)(s)` is a zero-cost operation — it is just a pointer cast. No new memory is allocated; the pointer points directly into the slice's backing array.

### 9.3 Bounds Check

The length check `len(s) >= N` is performed at runtime. The gc compiler cannot eliminate this check unless it can prove it statically.

### 9.4 Interaction with Garbage Collector

When using `(*[N]T)(s)`, the resulting pointer keeps the slice's backing array alive (the GC can trace through the pointer). This prevents premature collection.

---

## 10. Spec Compliance Checklist

- [ ] Requires Go 1.17+ for `(*[N]T)(s)` pointer form
- [ ] Requires Go 1.20+ for `[N]T(s)` value array form
- [ ] Element type of slice and array must be identical
- [ ] Runtime panic if `len(s) < N`
- [ ] Zero-length array conversion `[0]T(s)` is always valid (never panics)
- [ ] `(*[0]T)(nil)` returns nil pointer (no panic)
- [ ] `(*[N]T)(nil)` for N > 0 panics at runtime
- [ ] Array form produces an independent copy (no aliasing)
- [ ] Pointer form shares the same underlying array memory
- [ ] Conversion starts at the slice's current start position
- [ ] Works with named types whose underlying type is `[]T`
- [ ] Works with generic type parameters (Go 1.18+)

---

## 11. Official Examples

### Example 1: Slice-to-Array-Pointer (Go 1.17+)

```go
package main

import "fmt"

func main() {
    s := make([]byte, 2, 4)
    s[0] = 'a'
    s[1] = 'b'

    // Convert to array pointer
    p := (*[2]byte)(s)
    fmt.Println(string(p[:])) // ab

    // Mutation through pointer is visible in slice
    p[0] = 'A'
    fmt.Println(string(s)) // Ab
}
```

### Example 2: Slice-to-Array Value Copy (Go 1.20+)

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3, 4, 5}

    // Value copy
    a := [3]int(s)
    a[0] = 99

    fmt.Println(s) // [1 2 3 4 5] — original unchanged
    fmt.Println(a) // [99 2 3]
}
```

### Example 3: Panic on Short Slice

```go
package main

import "fmt"

func convertSafe(s []int) (arr [5]int, err error) {
    if len(s) < 5 {
        err = fmt.Errorf("slice too short: need 5, have %d", len(s))
        return
    }
    return [5]int(s), nil
}

func main() {
    s := []int{1, 2, 3}
    arr, err := convertSafe(s)
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Println(arr)
}
```

### Example 4: Extracting Fixed Key from Byte Slice

```go
package main

import "fmt"

func extractKey(data []byte) ([16]byte, bool) {
    if len(data) < 16 {
        return [16]byte{}, false
    }
    return [16]byte(data[:16]), true
}

func main() {
    data := make([]byte, 32)
    for i := range data {
        data[i] = byte(i)
    }
    key, ok := extractKey(data)
    fmt.Println(ok)  // true
    fmt.Println(key) // [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15]
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Conversions | https://go.dev/ref/spec#Conversions | Main spec section for this feature |
| Slice types | https://go.dev/ref/spec#Slice_types | Source type definition |
| Array types | https://go.dev/ref/spec#Array_types | Target type definition |
| Index expressions | https://go.dev/ref/spec#Index_expressions | Accessing elements after conversion |
| Package unsafe | https://go.dev/ref/spec#Package_unsafe | Pre-1.17 alternative via unsafe.Pointer |
| Slice expressions | https://go.dev/ref/spec#Slice_expressions | Reslicing before conversion |
| Type identity | https://go.dev/ref/spec#Type_identity | Element type matching requirement |
| Length and capacity | https://go.dev/ref/spec#Length_and_capacity | `len(s) >= N` runtime requirement |

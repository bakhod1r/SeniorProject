# Go Specification: make() for Slices

**Source:** https://go.dev/ref/spec#Making_slices_maps_and_channels
**Section:** Built-in Functions → Making slices, maps and channels

---

## 1. Spec Reference

- **Primary:** https://go.dev/ref/spec#Making_slices_maps_and_channels
- **Related:** https://go.dev/ref/spec#Slice_types
- **Related:** https://go.dev/ref/spec#Appending_and_copying_slices
- **Related:** https://go.dev/ref/spec#Length_and_capacity
- **Related:** https://go.dev/ref/spec#Allocation

Official definition from the spec:

> "The built-in function make takes a type T, optionally followed by a type-specific list of expressions. The core type of T must be a slice, map or channel. It returns a value of type T (not *T). The memory is initialized as described in the section on initial values."

For slices specifically:

> "make([]T, n) — slice of type T with length n and capacity n"
> "make([]T, n, m) — slice of type T with length n and capacity m"

---

## 2. Formal Grammar (EBNF)

```ebnf
MakeCall = "make" "(" SliceType [ "," LengthExpr [ "," CapacityExpr ] ] ")" .
SliceType    = "[" "]" ElementType .
LengthExpr   = Expression .
CapacityExpr = Expression .
```

- `LengthExpr` and `CapacityExpr` must be of integer type or untyped constants representable as `int`.
- Result type is `[]T`, NOT `*[]T`.
- `make` for slices allocates a new underlying array.

**Valid `make` calls for slices:**

```
make([]int, 5)        // len=5, cap=5
make([]int, 0, 10)    // len=0, cap=10
make([]string, 3, 3)  // len=3, cap=3
make([]byte, 0)       // len=0, cap=0 — empty but non-nil
```

---

## 3. Core Rules & Constraints

### 3.1 make Returns Non-Nil Slice

Unlike the zero value of a slice (nil), `make` always returns a non-nil slice with an allocated backing array.

```go
package main

import "fmt"

func main() {
    s := make([]int, 0)
    fmt.Println(s == nil) // false — make never returns nil
    fmt.Println(len(s))   // 0
    fmt.Println(cap(s))   // 0
}
```

### 3.2 Length and Capacity Constraints

The spec requires:
- `0 <= n <= m` where `n` = length and `m` = capacity
- Both `n` and `m` must be representable as type `int`
- Violating these causes a runtime panic (or compile error for constants)

```go
package main

func main() {
    // make([]int, 5, 3) // panic: makeslice: len larger than cap
    // make([]int, -1)   // panic: makeslice: len out of range
}
```

### 3.3 Elements Are Zero-Initialized

All elements of a slice created with `make` are initialized to the zero value of the element type. There is no uninitialized memory.

```go
package main

import "fmt"

func main() {
    s := make([]int, 5)
    fmt.Println(s) // [0 0 0 0 0]

    b := make([]bool, 3)
    fmt.Println(b) // [false false false]

    str := make([]string, 2)
    fmt.Println(str) // [ ]
}
```

### 3.4 The Two-Argument Form: make([]T, n)

When only length is provided, capacity equals length.

```go
package main

import "fmt"

func main() {
    s := make([]int, 5)
    fmt.Println(len(s)) // 5
    fmt.Println(cap(s)) // 5
}
```

### 3.5 The Three-Argument Form: make([]T, n, m)

Allocates an array of capacity `m`, but only exposes `n` elements through the slice.

```go
package main

import "fmt"

func main() {
    s := make([]int, 3, 10)
    fmt.Println(len(s)) // 3
    fmt.Println(cap(s)) // 10
    fmt.Println(s)      // [0 0 0]

    // Can append up to 7 more elements without reallocation
    s = append(s, 4, 5, 6)
    fmt.Println(len(s)) // 6
    fmt.Println(cap(s)) // 10 — no reallocation yet
}
```

---

## 4. Type Rules

### 4.1 make Is Not a Regular Function

`make` is a built-in that takes a type as its first argument. It cannot be used as a first-class function value. Its return type is determined by the type argument.

```go
package main

import "fmt"

func main() {
    // f := make // compile error: use of builtin make not in call expression
    s := make([]int, 5)
    fmt.Println(s)
}
```

### 4.2 Type Argument Must Have Slice Core Type

The first argument to `make` must be a type whose core type is a slice, map, or channel. For slice creation, it must be a slice type or a type parameter constrained to slices.

```go
package main

import "fmt"

type MySlice []int

func main() {
    // make(MySlice, 3) is valid — MySlice has core type []int
    s := make(MySlice, 3)
    fmt.Println(s) // [0 0 0]
}
```

### 4.3 Integer Types for Length and Capacity

Both `n` and `m` must be of integer type. Floating-point, string, or other types are not accepted.

```go
package main

import "fmt"

func main() {
    var n int = 5
    s := make([]int, n)
    fmt.Println(s)
    // make([]int, 3.0) // compile error: cannot use 3.0 (untyped float constant) as int value in argument to make
}
```

---

## 5. Behavioral Specification

### 5.1 Pre-allocating for Performance

The primary use case for `make([]T, 0, n)` is pre-allocating capacity when the final size is known in advance, avoiding multiple reallocations during appends.

```go
package main

import "fmt"

func buildSlice(n int) []int {
    s := make([]int, 0, n) // reserve space for n elements
    for i := 0; i < n; i++ {
        s = append(s, i*i)
    }
    return s
}

func main() {
    result := buildSlice(5)
    fmt.Println(result) // [0 1 4 9 16]
}
```

### 5.2 make vs Composite Literal

`make([]T, n)` and `[]T{...}` serve different purposes:
- `make`: allocate with given len/cap, zero-initialized
- `[]T{...}`: allocate with specific initial values

```go
package main

import "fmt"

func main() {
    // make: zero-initialized
    a := make([]int, 3)
    fmt.Println(a) // [0 0 0]

    // composite literal: explicit values
    b := []int{10, 20, 30}
    fmt.Println(b) // [10 20 30]
}
```

### 5.3 make vs new for Slices

`new([]T)` returns a `*[]T` pointing to a nil slice — not useful for most slice operations. `make([]T, n)` returns a usable `[]T` directly.

```go
package main

import "fmt"

func main() {
    p := new([]int)
    fmt.Println(*p == nil)  // true — new gives *[]T with nil value
    fmt.Println(len(*p))    // 0

    s := make([]int, 5)
    fmt.Println(s == nil)   // false — make gives usable slice
    fmt.Println(len(s))     // 5
}
```

### 5.4 Using make in Loops (Buffer Reuse Pattern)

```go
package main

import "fmt"

func process(data [][]int) [][]int {
    result := make([][]int, len(data))
    for i, row := range data {
        result[i] = make([]int, len(row))
        copy(result[i], row)
    }
    return result
}

func main() {
    data := [][]int{{1, 2, 3}, {4, 5}, {6}}
    out := process(data)
    fmt.Println(out)
}
```

### 5.5 Maximum Capacity

The maximum capacity for a slice is limited by `uintptr` overflow and available memory. On a 64-bit system, `make([]byte, 1<<50)` would fail at runtime with "out of memory."

```go
package main

import "fmt"

func main() {
    // This will panic at runtime:
    // s := make([]byte, 1<<62)

    // Safe example with large but reasonable size:
    s := make([]byte, 1024*1024) // 1 MB
    fmt.Println(len(s))
}
```

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined: Length > Capacity Panics

```go
package main

func main() {
    defer func() {
        if r := recover(); r != nil {
            println("panic:", r.(string))
        }
    }()
    _ = make([]int, 10, 5) // panic: makeslice: len larger than cap
}
```

### 6.2 Defined: Negative Length or Capacity Panics

Runtime panics with `makeslice: len out of range` or `makeslice: cap out of range` for negative values.

```go
package main

func main() {
    defer func() { recover() }()
    _ = make([]int, -1) // panic at runtime
}
```

### 6.3 Defined: make with Constant Negative Argument

When the argument is a constant, the compiler catches it:

```go
package main

func main() {
    // _ = make([]int, -1) // compile error if -1 is a constant expression
}
```

### 6.4 Defined: Zero-Initialization of All Elements

Every element is guaranteed to be zero-initialized. No uninitialized reads.

### 6.5 Defined: Capacity 0 Is Valid

`make([]int, 0, 0)` is equivalent to `[]int{}` — a non-nil empty slice.

---

## 7. Edge Cases from Spec

### 7.1 Large Capacity Pre-allocation

```go
package main

import "fmt"

func main() {
    // Pre-allocate large capacity — no panic unless OOM
    s := make([]int, 0, 1000000)
    fmt.Println(len(s)) // 0
    fmt.Println(cap(s)) // 1000000
}
```

### 7.2 make with Type Parameter (Generics)

Since Go 1.18, `make` works with type parameters constrained to slices.

```go
package main

import "fmt"

func makeSlice[T any](n int) []T {
    return make([]T, n)
}

func main() {
    ints := makeSlice[int](3)
    strs := makeSlice[string](2)
    fmt.Println(ints) // [0 0 0]
    fmt.Println(strs) // [ ]
}
```

### 7.3 make Length as Runtime Variable

Length and capacity do not need to be compile-time constants (unlike arrays).

```go
package main

import (
    "fmt"
    "os"
    "strconv"
)

func main() {
    n := 5
    if len(os.Args) > 1 {
        n, _ = strconv.Atoi(os.Args[1])
    }
    s := make([]int, n) // runtime-determined length
    for i := range s {
        s[i] = i + 1
    }
    fmt.Println(s)
}
```

### 7.4 make vs append for Building Slices

Two common patterns for building slices of known length:

```go
package main

import "fmt"

func main() {
    n := 5

    // Pattern 1: make with length, then index
    a := make([]int, n)
    for i := range a {
        a[i] = i * 2
    }

    // Pattern 2: make with capacity 0, then append
    b := make([]int, 0, n)
    for i := 0; i < n; i++ {
        b = append(b, i*2)
    }

    fmt.Println(a) // [0 2 4 6 8]
    fmt.Println(b) // [0 2 4 6 8]
}
```

### 7.5 make Does Not Track Length After Append

After `make([]int, 5)`, if you do `s = append(s, 99)`, the 5 existing elements remain and 99 is added at index 5.

```go
package main

import "fmt"

func main() {
    s := make([]int, 5)   // [0 0 0 0 0]
    s = append(s, 99)     // [0 0 0 0 0 99]
    fmt.Println(s)
    fmt.Println(len(s))   // 6 — common mistake: intended make([]int, 0, 5)
}
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0     | `make([]T, len)` and `make([]T, len, cap)` available |
| Go 1.18    | `make` works with generic type parameters constrained to slices |
| Go 1.21    | `slices.Grow` in stdlib as alternative for capacity pre-growth |

**Note:** The core `make` specification for slices has not changed since Go 1.0.

---

## 9. Implementation-Specific Behavior

### 9.1 Allocation Strategy

The gc compiler uses the runtime function `runtime.makeslice(et *_type, len, cap int) unsafe.Pointer`. The underlying array is allocated via the Go runtime memory allocator (not directly via `malloc`).

### 9.2 Inlining and Escape Analysis

If the compiler can determine the slice does not escape the function, it may allocate the backing array on the stack rather than the heap.

```go
package main

import "fmt"

func stackAllocated() {
    s := make([]int, 3) // may be stack-allocated
    s[0] = 1
    fmt.Println(s)
}

func main() {
    stackAllocated()
}
```

### 9.3 Capacity Alignment

The gc runtime may round up the requested capacity to the next size class for efficiency. The actual cap may be slightly larger than requested.

```go
package main

import "fmt"

func main() {
    s := make([]int, 0, 3)
    // actual cap may be 4 on some allocators, but spec says at least 3
    fmt.Println(cap(s) >= 3) // always true
}
```

### 9.4 Zero-Initialization Cost

The Go runtime always zero-initializes memory. For performance-sensitive code, this is a real cost. Third-party packages like `sync.Pool` or custom arenas can reduce allocation pressure.

---

## 10. Spec Compliance Checklist

- [ ] `make([]T, n)` creates a slice with len=n, cap=n
- [ ] `make([]T, n, m)` creates a slice with len=n, cap=m (requires n <= m)
- [ ] All elements are zero-initialized
- [ ] Result of `make` is never nil
- [ ] `make` with len > cap panics at runtime
- [ ] `make` with negative len or cap panics at runtime
- [ ] Length and capacity can be runtime (non-constant) expressions
- [ ] `make` cannot be used as a first-class function
- [ ] `make([]T, 0)` returns a non-nil empty slice (different from `var s []T`)
- [ ] Capacity may be rounded up by implementation (still >= requested)
- [ ] Works with defined types whose underlying type is a slice
- [ ] Works with generic type parameters constrained to slice types (Go 1.18+)

---

## 11. Official Examples

### Example 1: Basic make Usage

```go
package main

import "fmt"

func main() {
    s := make([]int, 5)
    fmt.Println("emp:", s)      // emp: [0 0 0 0 0]
    fmt.Println("len:", len(s)) // len: 5
    fmt.Println("cap:", cap(s)) // cap: 5
}
```

### Example 2: make with Separate Length and Capacity

```go
package main

import "fmt"

func main() {
    s := make([]int, 0, 5)
    fmt.Println("emp:", s)      // emp: []
    fmt.Println("len:", len(s)) // len: 0
    fmt.Println("cap:", cap(s)) // cap: 5

    s = append(s, 1, 2, 3)
    fmt.Println("apd:", s)      // apd: [1 2 3]
    fmt.Println("len:", len(s)) // len: 3
    fmt.Println("cap:", cap(s)) // cap: 5 — no realloc
}
```

### Example 3: Pre-allocation Pattern

```go
package main

import "fmt"

func squares(n int) []int {
    result := make([]int, 0, n) // pre-allocate capacity
    for i := 0; i < n; i++ {
        result = append(result, i*i)
    }
    return result
}

func main() {
    fmt.Println(squares(5)) // [0 1 4 9 16]
}
```

### Example 4: make vs new

```go
package main

import "fmt"

func main() {
    // new returns *[]int pointing to nil slice
    p := new([]int)
    fmt.Println(*p == nil) // true

    // make returns usable []int
    s := make([]int, 3)
    fmt.Println(s == nil) // false
    fmt.Println(s)        // [0 0 0]
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Slice types | https://go.dev/ref/spec#Slice_types | Core slice type definition |
| Appending and copying | https://go.dev/ref/spec#Appending_and_copying_slices | How to use slices after make |
| Length and capacity | https://go.dev/ref/spec#Length_and_capacity | `len` and `cap` built-ins |
| Allocation (new) | https://go.dev/ref/spec#Allocation | Contrast with `new` built-in |
| Composite literals | https://go.dev/ref/spec#Composite_literals | Alternative to make for initialization |
| Type parameters | https://go.dev/ref/spec#Type_parameter_declarations | Generics with make |
| Built-in functions | https://go.dev/ref/spec#Built-in_functions | Overview of all built-ins |
| Index expressions | https://go.dev/ref/spec#Index_expressions | Accessing elements after make |

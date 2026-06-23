# Go Specification: Arrays

**Source:** https://go.dev/ref/spec#Array_types
**Section:** Types → Composite Types → Array Types

---

## 1. Spec Reference

- **Primary:** https://go.dev/ref/spec#Array_types
- **Related:** https://go.dev/ref/spec#Index_expressions
- **Related:** https://go.dev/ref/spec#Length_and_capacity
- **Related:** https://go.dev/ref/spec#Comparison_operators
- **Related:** https://go.dev/ref/spec#Assignability
- **Related:** https://go.dev/ref/spec#Composite_literals

Official definition from the spec:

> "An array is a numbered sequence of elements of a single type, called the element type. The number of elements is called the length of the array and is never negative."

---

## 2. Formal Grammar (EBNF)

```ebnf
ArrayType   = "[" ArrayLength "]" ElementType .
ArrayLength = Expression .
ElementType = Type .
```

- `ArrayLength` must be a constant expression of integer type.
- `ArrayLength` must evaluate to a non-negative value.
- `ElementType` can be any type, including another array type (for multi-dimensional arrays).

**Examples of valid array types:**

```
[5]int
[100]string
[3][4]float64         // 2D array: 3 rows, 4 columns
[0]byte               // zero-length array — valid
[1 << 10]bool         // 1024 elements — constant expression
```

---

## 3. Core Rules & Constraints

### 3.1 Length is Part of the Type

The length of an array is part of its type. `[3]int` and `[4]int` are **distinct, incompatible types**.

```go
package main

import "fmt"

func main() {
    var a [3]int
    var b [4]int
    // a = b // compile error: cannot use b (type [4]int) as type [3]int
    fmt.Println(a, b)
}
```

### 3.2 Length Must Be a Non-Negative Constant

The array length must be a non-negative constant integer expression, evaluable at compile time.

```go
package main

import "fmt"

const N = 5

func main() {
    var arr [N]int // valid: N is a constant
    fmt.Println(arr)
    // var x = 5
    // var arr2 [x]int // compile error: non-constant array bound x
}
```

### 3.3 Zero-Length Arrays

Arrays with length 0 are valid. They occupy no storage for elements but are real types.

```go
package main

import "fmt"

func main() {
    var empty [0]int
    fmt.Println(len(empty)) // 0
}
```

### 3.4 Indexing

Elements are accessed via index expressions `a[i]`. Indices are zero-based: valid range is `0` through `len(a)-1`.

```go
package main

import "fmt"

func main() {
    a := [5]int{10, 20, 30, 40, 50}
    fmt.Println(a[0]) // 10
    fmt.Println(a[4]) // 50
    // fmt.Println(a[5]) // runtime panic: index out of range
}
```

### 3.5 Arrays Are Value Types

Arrays in Go are **value types**. Assigning an array to another variable copies all elements. Passing to a function copies the entire array.

```go
package main

import "fmt"

func modify(arr [3]int) {
    arr[0] = 999 // modifies copy only
}

func main() {
    original := [3]int{1, 2, 3}
    modify(original)
    fmt.Println(original) // [1 2 3] — unchanged
}
```

### 3.6 Multi-Dimensional Arrays

Go supports multi-dimensional arrays as arrays of arrays.

```go
package main

import "fmt"

func main() {
    var grid [3][4]int
    grid[0][0] = 1
    grid[2][3] = 99
    fmt.Println(grid)
}
```

---

## 4. Type Rules

### 4.1 Identical Array Types

Two array types are identical if and only if:
- They have the same element type, AND
- They have the same array length.

```go
// [3]int and [3]int  → identical
// [3]int and [4]int  → NOT identical
// [3]int and [3]int32 → NOT identical
```

### 4.2 Assignability

An array value `a` of type `T` is assignable to type `V` if `T` and `V` are identical array types.

```go
package main

import "fmt"

func main() {
    var a [3]int = [3]int{1, 2, 3}
    var b [3]int
    b = a // valid: same type
    fmt.Println(b)
}
```

### 4.3 Comparability

Array types are comparable if the element type is comparable. Two arrays are equal if all corresponding elements are equal.

```go
package main

import "fmt"

func main() {
    a := [3]int{1, 2, 3}
    b := [3]int{1, 2, 3}
    c := [3]int{1, 2, 4}
    fmt.Println(a == b) // true
    fmt.Println(a == c) // false
}
```

### 4.4 Element Type Constraints

There are no constraints on the element type — it can be any Go type, including interfaces, structs, pointers, functions, or other arrays.

```go
package main

import "fmt"

func main() {
    var funcs [3]func(int) int
    funcs[0] = func(x int) int { return x * 2 }
    fmt.Println(funcs[0](5)) // 10
}
```

---

## 5. Behavioral Specification

### 5.1 Zero Value

The zero value of an array is an array whose elements are all zero values of the element type.

```go
package main

import "fmt"

func main() {
    var a [5]int
    var b [3]string
    var c [2]bool
    fmt.Println(a) // [0 0 0 0 0]
    fmt.Println(b) // [  ]
    fmt.Println(c) // [false false]
}
```

### 5.2 Composite Literals

Arrays can be initialized with composite literals. Elements can be listed sequentially or with explicit indices.

```go
package main

import "fmt"

func main() {
    // Sequential initialization
    a := [3]int{1, 2, 3}

    // Partial initialization (rest zero)
    b := [5]int{1, 2}

    // Explicit index initialization
    c := [5]int{0: 10, 2: 30, 4: 50}

    // Ellipsis: compiler counts elements
    d := [...]int{1, 2, 3, 4, 5}

    fmt.Println(a) // [1 2 3]
    fmt.Println(b) // [1 2 0 0 0]
    fmt.Println(c) // [10 0 30 0 50]
    fmt.Println(d) // [1 2 3 4 5]
    fmt.Println(len(d)) // 5
}
```

### 5.3 The `...` Notation

When using a composite literal, `[...]T` allows the compiler to determine the length from the number of elements provided.

```go
package main

import "fmt"

func main() {
    a := [...]string{"apple", "banana", "cherry"}
    fmt.Println(len(a)) // 3
}
```

### 5.4 Ranging Over Arrays

The `for range` construct iterates over arrays, yielding index and element.

```go
package main

import "fmt"

func main() {
    a := [4]string{"a", "b", "c", "d"}
    for i, v := range a {
        fmt.Printf("a[%d] = %s\n", i, v)
    }
}
```

### 5.5 Taking Addresses

You can take the address of an array element. This gives a pointer into the array.

```go
package main

import "fmt"

func main() {
    a := [3]int{1, 2, 3}
    p := &a[1]
    *p = 99
    fmt.Println(a) // [1 99 3]
}
```

### 5.6 Passing Pointer to Array

To avoid copying and allow mutation, pass a pointer to the array.

```go
package main

import "fmt"

func doubleFirst(arr *[3]int) {
    arr[0] *= 2
}

func main() {
    a := [3]int{5, 10, 15}
    doubleFirst(&a)
    fmt.Println(a) // [10 10 15]
}
```

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined: Index Out of Range

Runtime panic with message `runtime error: index out of range [i] with length n`. This is well-defined behavior (not undefined behavior as in C).

```go
package main

func main() {
    a := [3]int{1, 2, 3}
    _ = a[5] // panic: runtime error: index out of range [5] with length 3
}
```

### 6.2 Defined: Constant Index Bounds Check

If the index is a constant expression, bounds are checked at compile time.

```go
package main

func main() {
    a := [3]int{1, 2, 3}
    _ = a[3] // compile error: invalid argument: index 3 out of bounds [0:3]
}
```

### 6.3 Defined: Negative Index

Using a negative constant index is a compile-time error. Using a negative runtime integer index causes a panic.

```go
package main

func main() {
    a := [3]int{1, 2, 3}
    // _ = a[-1] // compile error: invalid argument: index -1 (constant of type int) must not be negative
}
```

### 6.4 Defined: Copy Semantics

All array assignments and function calls produce a full value copy. There is no aliasing between the original and the copy.

---

## 7. Edge Cases from Spec

### 7.1 Zero-Length Array Size

The spec states that a zero-length array `[0]T` is valid. Its size is 0 bytes, but it is a distinct type. Two variables of type `[0]T` at different addresses are allowed to have the same address (the spec permits this).

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    var a [0]int
    var b [0]int
    fmt.Println(unsafe.Sizeof(a)) // 0
    fmt.Println(unsafe.Sizeof(b)) // 0
    // a and b may have same address — implementation-defined
}
```

### 7.2 Array of Interfaces

An array of interfaces stores interface values (type + pointer pairs), not concrete values directly.

```go
package main

import "fmt"

func main() {
    var a [3]interface{}
    a[0] = 42
    a[1] = "hello"
    a[2] = true
    for _, v := range a {
        fmt.Printf("%T: %v\n", v, v)
    }
}
```

### 7.3 Explicit Index in Composite Literal Sets Length

When using explicit key-index composite literals, the array length is determined by the highest index plus one.

```go
package main

import "fmt"

func main() {
    a := [...]int{9: 1} // length is 10
    fmt.Println(len(a)) // 10
    fmt.Println(a)      // [0 0 0 0 0 0 0 0 0 1]
}
```

### 7.4 Array Comparison with Uncomparable Elements

Arrays with uncomparable element types (e.g., slices, maps, functions) are not comparable and cannot be used with `==`.

```go
package main

func main() {
    // var a, b [2][]int
    // fmt.Println(a == b) // compile error: invalid operation: a == b ([2][]int is not comparable)
}
```

### 7.5 Taking Slice from Array

An array can be sliced to produce a slice that shares the underlying array memory.

```go
package main

import "fmt"

func main() {
    a := [5]int{1, 2, 3, 4, 5}
    s := a[1:4] // slice sharing a's memory
    s[0] = 99
    fmt.Println(a) // [1 99 3 4 5] — original modified
    fmt.Println(s) // [99 3 4]
}
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0     | Arrays introduced as value types with full semantics |
| Go 1.17    | Array-to-slice conversion via `[low:high:max]` three-index slicing stabilized |
| Go 1.20    | `unsafe.SliceData`, `unsafe.StringData` added; array pointers usable in new unsafe conversions |
| Go 1.21    | No changes to array spec |

**Note:** The core array specification has remained stable since Go 1.0. The fundamental rules — value semantics, length as part of type, zero-indexing — have not changed.

---

## 9. Implementation-Specific Behavior

### 9.1 Memory Layout

In the `gc` compiler (standard Go compiler), arrays are laid out contiguously in memory. Element `i` is at offset `i * sizeof(ElementType)` from the start of the array. This matches C array layout.

### 9.2 Alignment

Each array element is aligned according to the alignment requirements of the element type. The array itself has the same alignment as its element type.

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    var a [4]int64
    fmt.Println(unsafe.Sizeof(a))   // 32 (4 * 8)
    fmt.Println(unsafe.Alignof(a))  // 8
}
```

### 9.3 Stack vs Heap Allocation

The compiler may allocate arrays on the stack or heap depending on size and escape analysis. Large arrays (typically >~64KB, compiler-dependent) or arrays whose addresses escape are heap-allocated.

### 9.4 Bounds Check Elimination (BCE)

The `gc` compiler performs bounds check elimination. If the compiler can prove an index is within bounds at compile time, the runtime bounds check is omitted.

### 9.5 GOARCH-Specific Behavior

On 32-bit architectures, `unsafe.Sizeof([1<<30]byte)` may overflow. The maximum array size is architecture-dependent (limited by `uintptr` size).

---

## 10. Spec Compliance Checklist

- [ ] Array length is a compile-time non-negative constant expression
- [ ] Array length is part of the type (different lengths = different types)
- [ ] Zero-value of array is all-zeros (no need to initialize)
- [ ] Array assignment copies all elements (value semantics)
- [ ] Index access panics at runtime for out-of-range indices
- [ ] Constant index out of range is a compile-time error
- [ ] Arrays are comparable iff element type is comparable
- [ ] Multi-dimensional arrays work as arrays of arrays
- [ ] `[...]T{...}` in composite literal infers length from element count
- [ ] Slicing an array produces a slice that shares underlying memory
- [ ] Ranging over an array iterates index 0 through len-1
- [ ] Taking address of array element gives pointer into the array

---

## 11. Official Examples

### Example 1: Basic Array Declaration and Use

```go
package main

import "fmt"

func main() {
    var a [5]int
    a[4] = 100
    fmt.Println("get:", a[4])   // get: 100
    fmt.Println("len:", len(a)) // len: 5
}
```

### Example 2: Array Initialization with Composite Literal

```go
package main

import "fmt"

func main() {
    b := [5]int{1, 2, 3, 4, 5}
    fmt.Println(b)
}
```

### Example 3: Two-Dimensional Array

```go
package main

import "fmt"

func main() {
    var twoD [2][3]int
    for i := 0; i < 2; i++ {
        for j := 0; j < 3; j++ {
            twoD[i][j] = i*3 + j + 1
        }
    }
    fmt.Println("2D: ", twoD) // 2D:  [[1 2 3] [4 5 6]]
}
```

### Example 4: Array Copying (Value Semantics Demonstration)

```go
package main

import "fmt"

func main() {
    a := [3]int{1, 2, 3}
    b := a // full copy
    b[0] = 100
    fmt.Println("a:", a) // a: [1 2 3]
    fmt.Println("b:", b) // b: [100 2 3]
}
```

### Example 5: Comparing Arrays

```go
package main

import "fmt"

func main() {
    a := [3]int{1, 2, 3}
    b := [3]int{1, 2, 3}
    c := [3]int{4, 5, 6}
    fmt.Println(a == b) // true
    fmt.Println(a == c) // false
    fmt.Println(a != c) // true
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Slice types | https://go.dev/ref/spec#Slice_types | Slices are built on arrays; slicing an array shares memory |
| Index expressions | https://go.dev/ref/spec#Index_expressions | Defines how `a[i]` is evaluated and bounds-checked |
| Length and capacity | https://go.dev/ref/spec#Length_and_capacity | `len(a)` returns the array length |
| Composite literals | https://go.dev/ref/spec#Composite_literals | Syntax for initializing arrays |
| Comparison operators | https://go.dev/ref/spec#Comparison_operators | Rules for `==` and `!=` on arrays |
| Assignability | https://go.dev/ref/spec#Assignability | When arrays can be assigned to one another |
| Type identity | https://go.dev/ref/spec#Type_identity | Defines when two array types are identical |
| For range | https://go.dev/ref/spec#For_range | Iteration over arrays |
| Address operators | https://go.dev/ref/spec#Address_operators | Taking address of array elements |
| Unsafe package | https://go.dev/ref/spec#Package_unsafe | `unsafe.Sizeof`, `unsafe.Alignof` for arrays |

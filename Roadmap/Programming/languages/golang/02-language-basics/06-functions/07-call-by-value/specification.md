# Go Specification: Call by Value

**Source:** https://go.dev/ref/spec#Calls
**Sections:** Calls (argument passing), Function types, Pointer types

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Official Spec** | https://go.dev/ref/spec#Calls |
| **Pointer types** | https://go.dev/ref/spec#Pointer_types |
| **Slice types** | https://go.dev/ref/spec#Slice_types |
| **Map types** | https://go.dev/ref/spec#Map_types |
| **Go Version** | Go 1.0+ |

Official text:

> "Each time a function f is called, fresh storage is allocated for its local variables, including parameters and result variables. The lifetime of these storage locations corresponds to the lifetime of the function execution."

> "The arguments are evaluated in the usual order. After they are evaluated, the parameters of the call are passed by value to the function and the called function begins execution."

---

## 2. Definition

**Go is a pass-by-value language.** Every argument passed to a function is copied into the function's parameter. This applies to all types — integers, structs, slices, maps, channels, functions, pointers, interfaces. The function operates on its local copies.

The implication is subtle for "reference-like" types (slice, map, channel, pointer, interface): the COPY is a copy of the *handle* (header for slices, pointer for maps/channels/etc.), not the underlying data. Modifying the data through the handle is visible to the caller; modifying the handle itself (reassignment) is local to the callee.

---

## 3. Core Rules & Constraints

### 3.1 Every Argument Is Copied

```go
package main

import "fmt"

func tryDouble(n int) {
    n *= 2
    fmt.Println("inside:", n)
}

func main() {
    x := 5
    tryDouble(x)
    fmt.Println("outside:", x) // still 5
}
```

The function gets a copy of `x`. Modifying `n` doesn't affect `x`.

### 3.2 To Mutate Caller's Variable, Pass a Pointer

```go
func actuallyDouble(p *int) {
    *p *= 2
}

x := 5
actuallyDouble(&x)
fmt.Println(x) // 10
```

The pointer is also passed by value (the pointer-value is copied), but dereferencing `*p` accesses the same memory the caller owns.

### 3.3 Slice Header Is Copied; Backing Array Is Shared

```go
package main

import "fmt"

func mutateElements(s []int) {
    s[0] = 999 // modifies the SHARED backing array
}

func reslice(s []int) {
    s = append(s, 99) // modifies the LOCAL slice header; caller's slice unchanged (unless backing array is shared and grew in-place)
}

func main() {
    s := []int{1, 2, 3}
    mutateElements(s)
    fmt.Println(s) // [999 2 3] — shared array mutation visible
    
    reslice(s)
    fmt.Println(s, len(s)) // [999 2 3] 3 — caller's header unchanged
}
```

The slice header `(ptr, len, cap)` is copied. The pointer points to the same underlying array. Element mutations are visible; header mutations (length, capacity changes via reassignment) are local.

### 3.4 Map Handle Is Copied; Map Data Is Shared

```go
package main

import "fmt"

func mutateMap(m map[string]int) {
    m["x"] = 99 // modifies shared map data
}

func main() {
    m := map[string]int{"a": 1}
    mutateMap(m)
    fmt.Println(m) // map[a:1 x:99]
}
```

The map header (a pointer to the hash table) is copied. Modifications via the header are visible everywhere.

### 3.5 Channel Handle Is Copied; Channel Itself Is Shared

```go
package main

import "fmt"

func send(ch chan<- int) {
    ch <- 42 // sends through shared channel
}

func main() {
    ch := make(chan int, 1)
    send(ch)
    fmt.Println(<-ch) // 42
}
```

Channels are reference types. The channel value (essentially a pointer to the runtime channel struct) is copied; both sender and receiver use the same underlying channel.

### 3.6 Interface Value Is Copied (Two Words)

```go
package main

import "fmt"

type Animal interface{ Sound() string }
type Dog struct{}
func (d Dog) Sound() string { return "woof" }

func describe(a Animal) {
    fmt.Println(a.Sound())
}

func main() {
    d := Dog{}
    describe(d) // copies the interface value (itab + data)
}
```

The interface value (itab pointer + data pointer) is copied. The data may be a pointer to the underlying value (depends on the boxed type).

### 3.7 Function Value Is Copied

```go
func apply(fn func(int) int, x int) int {
    return fn(x)
}

apply(func(n int) int { return n * 2 }, 5) // funcval copied
```

A function value (funcval pointer + closure context) is copied. Calling through the copy invokes the same code with the same captures.

### 3.8 Struct Is Copied Field-by-Field

```go
package main

import "fmt"

type Point struct{ X, Y int }

func translate(p Point) {
    p.X += 10 // modifies LOCAL copy
}

func main() {
    p := Point{1, 2}
    translate(p)
    fmt.Println(p) // {1 2} — unchanged
}
```

For mutation, pass a pointer:
```go
func translate(p *Point) {
    p.X += 10
}
translate(&p) // {11 2}
```

### 3.9 Arrays Are Copied

```go
package main

import "fmt"

func modify(a [3]int) {
    a[0] = 999
}

func main() {
    a := [3]int{1, 2, 3}
    modify(a)
    fmt.Println(a) // [1 2 3] — unchanged
}
```

Unlike slices, ARRAYS are value types. Passing `[1024]int` copies all 8 KB. Use `*[1024]int` or `[]int` (slice) for efficient passing.

---

## 4. Type Rules

### 4.1 Every Type Is Pass-by-Value

There are no exceptions:
- Numeric, bool, string: copy of value.
- Struct: copy of all fields.
- Array: copy of all elements.
- Pointer: copy of pointer (pointee shared).
- Slice: copy of header (backing array shared).
- Map: copy of map header (hash table shared).
- Channel: copy of channel handle (channel itself shared).
- Interface: copy of itab+data (data may point to shared content).
- Function: copy of funcval (captures shared if closure).

### 4.2 Type-Convert Before Passing if Needed

If parameter type differs (assignable but distinct), conversion happens at the call site:

```go
type MyInt int
func use(n int) {}

mi := MyInt(5)
// use(mi)        // compile error: type MyInt cannot be used as int
use(int(mi))      // explicit conversion
```

### 4.3 Named Types vs Underlying

For named types (e.g., `type Fahrenheit float64`), passing requires the parameter type to match exactly (or convert):

```go
type Celsius float64
func freeze(c Celsius) {}

var f float64 = 0
// freeze(f)      // compile error
freeze(Celsius(f)) // OK
```

---

## 5. Behavioral Specification

### 5.1 Argument Evaluation Order

Arguments are evaluated **left to right** before the call:

```go
package main

import "fmt"

func arg(label string, v int) int {
    fmt.Println("eval", label)
    return v
}

func use(a, b, c int) { fmt.Println(a, b, c) }

func main() {
    use(arg("a", 1), arg("b", 2), arg("c", 3))
    // Output:
    // eval a
    // eval b
    // eval c
    // 1 2 3
}
```

### 5.2 Copy Cost

Per call:
- Primitives (int, bool, ptr): register-pass; ~free.
- Small structs (≤ 64 B): register-decomposed; ~free.
- Medium structs (64-512 B): stack copy; small but measurable.
- Large structs (> 512 B): stack copy; significant.
- Slices, maps, channels: 1-3 words; trivial.
- Interfaces: 2 words; trivial.
- Functions: 1 word + capture pointer; trivial.

### 5.3 Returning Values is Also By Value

Return values are similarly copied. For small types, register-passed. For large structs, copied via the caller's frame.

### 5.4 Aliasing Through Copied Handles

The "copy" is shallow. Slice/map/channel copies share underlying storage. To get an independent copy, you must explicitly clone:

```go
// Slice
a := []int{1, 2, 3}
b := append([]int(nil), a...) // independent

// Map
m1 := map[string]int{"a": 1}
m2 := map[string]int{}
for k, v := range m1 { m2[k] = v } // independent
// Or in Go 1.21+:
m2 := maps.Clone(m1)
```

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| Modifying parameter (primitive) | Defined — local copy modified, caller's variable unchanged |
| Modifying slice elements | Defined — shared array; caller sees changes |
| Reslicing parameter | Defined — local header changes; caller's header unchanged |
| Appending to slice (no reallocation) | Defined — modifies shared array, caller sees if cap allows |
| Appending to slice (reallocation) | Defined — new backing array; caller's header still points to old |
| Modifying map | Defined — shared data; caller sees |
| Receiving from channel | Defined — same channel; consumed from caller's view too |
| Passing nil pointer | Defined — pointer copy is nil; dereferencing panics |
| Passing nil slice | Defined — len=0, can range, can append |
| Passing nil map | Defined — read OK (zero values), write panics |
| Passing nil channel | Defined — sends/receives block forever |
| Modifying struct field through pointer | Defined — caller sees |
| Modifying struct field by value | Defined — local copy only |

---

## 7. Edge Cases from Spec

### 7.1 Self-Referential: Same Variable as Multiple Args

```go
package main

import "fmt"

func swap(a, b *int) {
    *a, *b = *b, *a
}

func main() {
    x := 5
    swap(&x, &x) // both point to same x
    fmt.Println(x) // 5 — swap of x with itself is identity
}
```

### 7.2 Slice Aliasing With Different Headers

```go
package main

import "fmt"

func main() {
    a := []int{1, 2, 3, 4, 5}
    b := a[1:4]    // b shares array with a
    b[0] = 999
    fmt.Println(a) // [1 999 3 4 5] — shared backing
}
```

This isn't function call semantics per se, but the same principle: slices reference the same backing array.

### 7.3 Struct Containing Slice

```go
type Container struct{ items []int }

func add(c Container, x int) {
    c.items = append(c.items, x) // local header modified; caller may not see
}

func main() {
    c := Container{items: []int{1, 2, 3}}
    add(c, 99)
    fmt.Println(c.items) // [1 2 3] usually — but can vary if append doesn't realloc and shared
}
```

To mutate, pass `*Container`.

### 7.4 Self-Mutation in Method

```go
type Counter struct{ n int }

// Value receiver — operates on a COPY
func (c Counter) Inc() { c.n++ } // doesn't affect caller

// Pointer receiver — operates on the original
func (c *Counter) IncPtr() { c.n++ }

func main() {
    c := Counter{}
    c.Inc()    // n stays 0
    c.IncPtr() // n becomes 1
}
```

Methods with value receivers are subject to call-by-value (the receiver is copied).

### 7.5 Interface Boxing on Call

Passing a concrete type to an interface parameter boxes it:

```go
type Stringer interface{ String() string }
type T struct{}
func (t T) String() string { return "T" }

func use(s Stringer) {}

t := T{}
use(t) // boxes t into an interface (small alloc if T isn't a pointer type)
```

### 7.6 Nil Slice vs Empty Slice vs Untyped

All three are distinct value-wise but behave identically for most operations:

```go
var nilSlice []int           // nil
emptySlice := []int{}        // non-nil, len 0
emptySlice2 := make([]int, 0) // non-nil, len 0

len(nilSlice)   // 0
len(emptySlice) // 0
nilSlice == nil // true
emptySlice == nil // false
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Pass-by-value semantics established for all types |
| Go 1.17 | Register-based ABI: small struct arguments decomposed into registers |
| Go 1.18 | Generics: type parameters also passed by value |

The semantics haven't changed; only the implementation (register ABI) has improved efficiency.

---

## 9. Implementation-Specific Behavior

### 9.1 Register Pass for Small Types

Since Go 1.17 (amd64) and 1.18 (arm64), arguments fit in registers when small enough:
- Up to 9 integer/pointer args in registers.
- Up to 15 floating-point args in registers.
- Structs are decomposed field-by-field if they fit.

### 9.2 Stack Pass for Large Types

Large structs are passed via the caller's stack frame. The compiler reserves space in the caller's outgoing args area; the callee accesses via SP-relative offsets.

### 9.3 Slice/Map/Channel/Interface Copies Are 1-3 Words

These "reference-like" types have small headers:
- Slice: 3 words (ptr, len, cap).
- Map: 1 word (pointer to hash table).
- Channel: 1 word (pointer to channel struct).
- Interface: 2 words (itab + data).
- Function value: 1+ words (funcval).

Copying these is essentially free.

### 9.4 Struct Decomposition

Small structs are decomposed for register passing. For example, `type Point struct{X, Y int}` (2 words) might be passed in (AX, BX). For larger structs, the compiler may decide to pass by stack memcpy.

---

## 10. Spec Compliance Checklist

- [ ] Recognize that ALL arguments are pass-by-value in Go
- [ ] Use pointers when caller's variable must be mutated
- [ ] Understand slice/map/channel/interface "reference type" semantics: header copied, data shared
- [ ] Account for slice header reassignment not being visible to caller
- [ ] Avoid passing huge arrays by value (use slice or pointer)
- [ ] Be careful with shared backing arrays (aliasing)
- [ ] Document mutation behavior in function comments
- [ ] Handle nil cases for reference-like types

---

## 11. Official Examples

### Example 1: Primitive Pass-by-Value

```go
package main

import "fmt"

func tryChange(n int) {
    n = 99
}

func main() {
    x := 5
    tryChange(x)
    fmt.Println(x) // 5
}
```

### Example 2: Pointer Pass for Mutation

```go
package main

import "fmt"

func incr(p *int) {
    *p++
}

func main() {
    x := 5
    incr(&x)
    fmt.Println(x) // 6
}
```

### Example 3: Slice Element Mutation Visible

```go
package main

import "fmt"

func zero(s []int) {
    for i := range s {
        s[i] = 0
    }
}

func main() {
    s := []int{1, 2, 3}
    zero(s)
    fmt.Println(s) // [0 0 0]
}
```

### Example 4: Slice Reassignment Not Visible

```go
package main

import "fmt"

func empty(s []int) {
    s = nil // local s is now nil; caller's s unchanged
}

func main() {
    s := []int{1, 2, 3}
    empty(s)
    fmt.Println(s) // [1 2 3]
}
```

### Example 5: Map Mutation Visible

```go
package main

import "fmt"

func add(m map[string]int) {
    m["x"] = 99
}

func main() {
    m := map[string]int{"a": 1}
    add(m)
    fmt.Println(m) // map[a:1 x:99]
}
```

### Example 6: Large Struct Copy

```go
package main

import "fmt"

type BigData struct {
    buf [1024]byte
}

func process(d BigData) { // 1 KB copy per call!
    d.buf[0] = 1
}

func main() {
    d := BigData{}
    process(d) // expensive
    fmt.Println(d.buf[0]) // 0 — caller's copy unchanged
}
```

For large structs, prefer pointers:
```go
func process(d *BigData) { d.buf[0] = 1 } // pointer-pass
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Calls | https://go.dev/ref/spec#Calls | Argument passing |
| Pointer types | https://go.dev/ref/spec#Pointer_types | Pointer semantics |
| Slice types | https://go.dev/ref/spec#Slice_types | Slice header layout |
| Map types | https://go.dev/ref/spec#Map_types | Map header |
| Channel types | https://go.dev/ref/spec#Channel_types | Channel handle |
| Interface types | https://go.dev/ref/spec#Interface_types | Interface value layout |
| Method declarations | https://go.dev/ref/spec#Method_declarations | Receiver semantics |
| Memory model | https://go.dev/ref/mem | Concurrent access to shared data |

# Go Specification: Empty Struct

**Source:** https://go.dev/ref/spec#Struct_types
**Sections:** Struct types; Size and alignment guarantees; Channel types

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Official Spec — Struct types** | https://go.dev/ref/spec#Struct_types |
| **Size and alignment** | https://go.dev/ref/spec#Size_and_alignment_guarantees |
| **Channel types** | https://go.dev/ref/spec#Channel_types |
| **Composite literals** | https://go.dev/ref/spec#Composite_literals |
| **Go Version** | Go 1.0+ (empty struct exists from the start); Go 1.5 introduced trailing-zero-size-field padding |

Official text (excerpted):

> "A struct is a sequence of named elements, called fields, each of which has a name and a type. Field names may be specified explicitly (IdentifierList) or implicitly (EmbeddedField)."

> "A struct or array type has size zero if it contains no fields (or elements, respectively) that have a size greater than zero."

> "Two distinct zero-size variables may have the same address in memory."

These three sentences formalise the entire empty-struct model.

---

## 2. Definition

The **empty struct type** is `struct{}` — a struct type with no fields. It has exactly one value, the **empty struct value** `struct{}{}`. The type and the value are spelled differently to keep the syntax of types and composite literals separate.

`struct{}` belongs to a broader class called **zero-size types** — types whose size is zero bytes. Other members of this class include `[0]T` for any `T` and types whose only fields are themselves zero size.

Because the type stores no data, all values of `struct{}` are equal, the type is comparable, the type is hashable (with a constant hash), and the type can serve as a map key, channel element, function parameter, return value, and method receiver.

---

## 3. Core Rules & Constraints

### 3.1 Zero Size

The type has zero size:

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    fmt.Println(unsafe.Sizeof(struct{}{}))      // 0
    fmt.Println(unsafe.Sizeof([1024]struct{}{})) // 0
}
```

### 3.2 Single Value

Only one value of the type exists. All instances are equal:

```go
a := struct{}{}
b := struct{}{}
fmt.Println(a == b) // true
```

### 3.3 Address Identity Is Implementation-Defined

Two distinct zero-size variables may share an address:

```go
a := &struct{}{}
b := &struct{}{}
fmt.Println(a == b) // implementation-defined; in current Go runtimes typically true
```

Per the spec, both outcomes (`true` and `false`) are conformant. Current Go runtimes always collapse such pointers to `runtime.zerobase`, but no portable program may rely on it.

### 3.4 Trailing Zero-Size Field Padding

When a struct's last field is of zero size, the compiler ensures that the address of that field remains within the struct by adjusting the struct's size:

```go
type A struct {
    x int      // 8 bytes on amd64
    y struct{} // 0 bytes — but at the END
}

unsafe.Sizeof(A{}) // 16, not 8
```

Compare with leading position:

```go
type B struct {
    y struct{}
    x int
}

unsafe.Sizeof(B{}) // 8 — leading zero-size collapses
```

### 3.5 Comparability

`struct{}` is a comparable type. Comparison between two values is always `true`. The type may be used as a map key:

```go
m := map[struct{}]int{}
m[struct{}{}] = 1
m[struct{}{}] = 2
fmt.Println(len(m), m[struct{}{}]) // 1 2
```

### 3.6 Channel Element Type

`chan struct{}` is permitted. Sends carry no data; receives produce `struct{}{}`. Closing the channel signals all receivers without delivering data.

### 3.7 Method Set

A type defined as `type X struct{}` may have methods:

```go
type Discard struct{}
func (Discard) Write(p []byte) (int, error) { return len(p), nil }
```

The methods do not have access to per-instance state because there is none.

### 3.8 Composite Literals

The composite literal for the empty struct is `struct{}{}`:

```go
v := struct{}{}
```

In a map literal, `{}` shorthand suffices when the value type is known:

```go
m := map[string]struct{}{"a": {}, "b": {}}
```

---

## 4. Type Rules

### 4.1 The Empty Struct Is A Struct

`struct{}` is a struct type as defined by the Struct types section of the spec. All struct rules apply:
- Field selection: there are no fields, so no selectors.
- Composite literals: `struct{}{}` (or `{}` with type elision in context).
- Embedded fields: no embeddings (no fields).

### 4.2 Zero Size Propagates

Any composite type whose components are all zero size is itself zero size:

```go
type Z struct {
    a struct{}
    b [10]struct{}
    c [0]int
}
unsafe.Sizeof(Z{}) // 0
```

The trailing-zero-size-field rule applies only when at least one non-zero-size field precedes a zero-size field at the end.

### 4.3 Pointer Type

`*struct{}` is a valid pointer type. The pointee has zero size; the pointer itself has the platform pointer size.

### 4.4 Channel Type

`chan struct{}`, `<-chan struct{}`, and `chan<- struct{}` are all valid channel types. Send and receive operations work normally except that no data crosses the channel.

### 4.5 Map Key And Value

`map[struct{}]V` is valid (degenerate one-element map).
`map[K]struct{}` is valid and is the idiomatic set type.

### 4.6 Method Receivers

Both value and pointer receivers are permitted:

```go
type X struct{}
func (X) ValueMethod() {}
func (*X) PointerMethod() {}
```

The pointer receiver gives access to a pointer (which equals `&runtime.zerobase` for any value of type `X`).

---

## 5. Behavioral Specification

### 5.1 Allocation

Per the implementation, `new(struct{})` and `&struct{}{}` return the address of a runtime symbol (`runtime.zerobase`). The spec does not prescribe this; only that "two distinct zero-size variables may have the same address". The implementation chooses to collapse them to a single address.

### 5.2 Channel Operations

```go
ch := make(chan struct{})
ch <- struct{}{} // send a zero-size value
v := <-ch        // receive; v is struct{}{}
close(ch)        // closed; further receives return (struct{}{}, false)
```

After close, all blocked receivers wake. The element copy on each receive is zero bytes — only the goroutine wake-up cost applies.

### 5.3 Map Operations

```go
m := map[string]struct{}{}
m["a"] = struct{}{}
_, ok := m["a"] // ok = true
delete(m, "a")
_, ok = m["a"] // ok = false
```

The underlying map bucket layout omits the value array when `V == struct{}`.

### 5.4 Struct Embedding

```go
type Inner struct{}
type Outer struct{ Inner }
```

Embedding an empty struct adds no fields to the outer type but exposes any methods of `Inner` via the outer's method set.

### 5.5 Comparison Of Structs Containing Zero-Size Fields

Comparability of the enclosing type is not affected by zero-size fields. Comparing such structs simply ignores the zero-size fields (they always compare equal).

```go
type T struct {
    a int
    z struct{}
}
fmt.Println(T{1, struct{}{}} == T{1, struct{}{}}) // true
fmt.Println(T{1, struct{}{}} == T{2, struct{}{}}) // false
```

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| `unsafe.Sizeof(struct{}{})` | Defined — 0 |
| `[N]struct{}` size for any N | Defined — 0 |
| All values of `struct{}` equal | Defined — true |
| Two `&struct{}{}` pointer equality | Implementation-defined |
| Trailing zero-size field padding | Defined — implementation guarantees address-in-struct |
| Closing a `chan struct{}` | Defined — wakes all receivers; no data delivered |
| Sending on a closed `chan struct{}` | Defined — panic |
| Closing an already-closed `chan struct{}` | Defined — panic |
| `map[struct{}]V` | Defined — valid type, at most one entry |
| Method on empty struct | Defined — no per-instance state, but method set is real |

---

## 7. Edge Cases from Spec

### 7.1 Pointer Identity Of Zero-Size Values

```go
type Z struct{}
a := &Z{}
b := &Z{}
fmt.Println(a == b) // implementation-defined
```

Both `true` and `false` are conformant with the specification. Do not write portable code that assumes either outcome.

### 7.2 Trailing `_ struct{}` Field

```go
type T struct {
    x int
    _ struct{} // blank-name trailing zero-size field
}
unsafe.Sizeof(T{}) // grows by one word vs sizeof(int)
```

The blank-name field still adds the trailing-padding requirement. Move it to the start to avoid the cost.

### 7.3 Embedded `struct{}` Fields With Methods

```go
type token struct{}
func (token) String() string { return "<tok>" }

type Container struct {
    token // embedded
}

c := Container{}
fmt.Println(c.String()) // <tok>
```

Embedding an empty struct with methods is a way to inject behaviour without state.

### 7.4 Channel Close With No Receivers

```go
ch := make(chan struct{})
close(ch)
// No receivers; close still legal.
```

A closed channel with no receivers is fine. Subsequent receives produce `(struct{}{}, false)`.

### 7.5 Channel Of Channel Of Empty Struct

```go
chch := make(chan chan struct{})
go func() {
    inner := make(chan struct{})
    chch <- inner
    close(inner)
}()
inner := <-chch
<-inner
```

Composes signal channels into hierarchical cancellation patterns.

### 7.6 Generic Set Over Empty Struct Value

```go
type Set[T comparable] map[T]struct{}

func (s Set[T]) Add(v T) { s[v] = struct{}{} }
func (s Set[T]) Has(v T) bool { _, ok := s[v]; return ok }
```

Using generics (Go 1.18+) lets you write a single `Set` type for any comparable element.

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Empty struct type and zero-size value semantics |
| Go 1.5 | Compiler implements trailing-zero-size-field padding (1 word added at end) |
| Go 1.18 | Generics enable `Set[T comparable] map[T]struct{}` style |
| Go 1.20+ | `runtime.zerobase` documentation references stabilised |

---

## 9. Implementation-Specific Behavior

### 9.1 `runtime.zerobase`

Implemented in `src/runtime/malloc.go`:

```go
var zerobase uintptr // base address for all 0-byte allocations
```

`mallocgc` short-circuits zero-size allocations:

```go
if size == 0 {
    return unsafe.Pointer(&zerobase)
}
```

All `new(T)` and `&T{}` calls where `unsafe.Sizeof(T{}) == 0` return the same pointer.

### 9.2 Map Bucket Layout

The compiler emits a bucket type for each `map[K]V`. When `V` has zero size, the bucket type omits the value array. Bucket size shrinks; iteration cost drops slightly.

### 9.3 Channel Send/Receive Element Copy

The runtime functions `chansend` and `chanrecv` use `typedmemmove` to copy elements. When `elemsize == 0`, the copy is skipped.

### 9.4 SSA Optimisation

In the compiler's SSA pass, stores and loads of zero-size values fold to no-ops. The compiler omits register allocation for zero-size return values.

### 9.5 Trailing Field Padding Implementation

The compiler computes struct size via the `widstruct` function in the type-size pass. When the last field has zero size and the struct is non-empty, the function adds a word of padding so that taking the address of the trailing field produces a unique in-bounds address.

---

## 10. Spec Compliance Checklist

- [ ] `unsafe.Sizeof(struct{}{}) == 0` is asserted in tests
- [ ] No code relies on pointer identity of `&struct{}{}` values
- [ ] No struct in cgo or wire-format-sensitive code has a trailing zero-size field
- [ ] Signal channels use `chan struct{}` and `close` for broadcast
- [ ] Sets use `map[K]struct{}` when only presence matters
- [ ] Method-only types document statelessness
- [ ] Repeated close paths are guarded with `sync.Once`

---

## 11. Official Examples

### Example 1: Empty Struct As Set Value

```go
package main

import "fmt"

func main() {
    seen := map[string]struct{}{}
    for _, x := range []string{"a", "b", "a", "c", "b"} {
        seen[x] = struct{}{}
    }
    for k := range seen {
        fmt.Println(k)
    }
    // a, b, c (some order)
}
```

### Example 2: Signal Channel With Close

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    done := make(chan struct{})
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            <-done
            fmt.Println(id, "released")
        }(i)
    }
    time.Sleep(20 * time.Millisecond)
    close(done)
    wg.Wait()
}
```

### Example 3: Empty Struct Method Set

```go
package main

import "fmt"

type Discard struct{}

func (Discard) Write(p []byte) (int, error) { return len(p), nil }

func main() {
    var d Discard
    n, err := d.Write([]byte("hello"))
    fmt.Println(n, err) // 5 <nil>
}
```

### Example 4: Trailing Field Padding

```go
package main

import (
    "fmt"
    "unsafe"
)

type A struct {
    x int
    z struct{}
}

type B struct {
    z struct{}
    x int
}

func main() {
    fmt.Println(unsafe.Sizeof(A{})) // 16
    fmt.Println(unsafe.Sizeof(B{})) //  8
}
```

### Example 5: Generic Set

```go
package main

import "fmt"

type Set[T comparable] map[T]struct{}

func (s Set[T]) Add(v T) { s[v] = struct{}{} }
func (s Set[T]) Has(v T) bool {
    _, ok := s[v]
    return ok
}

func main() {
    s := Set[string]{}
    s.Add("alpha")
    s.Add("beta")
    fmt.Println(s.Has("alpha"), s.Has("gamma"))
    // true false
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Struct types | https://go.dev/ref/spec#Struct_types | Definition of struct, including the empty case |
| Size and alignment | https://go.dev/ref/spec#Size_and_alignment_guarantees | Zero-size rule and address-sharing licence |
| Channel types | https://go.dev/ref/spec#Channel_types | `chan struct{}` validity |
| Composite literals | https://go.dev/ref/spec#Composite_literals | `struct{}{}` syntax |
| Map types | https://go.dev/ref/spec#Map_types | `map[K]struct{}` validity |
| Comparison operators | https://go.dev/ref/spec#Comparison_operators | All `struct{}` values compare equal |
| Close built-in | https://go.dev/ref/spec#Close | Close semantics on channels |
| Method sets | https://go.dev/ref/spec#Method_sets | Methods on empty struct types |

# Type Constraints — Find the Bug

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Bugs 1-15](#bugs-1-15)

Each bug has: **Code**, **Hint**, **Fix**, **Explanation**. Try to spot the bug before reading the hint.

---

## How to Use This File

1. Read the code.
2. Predict the compile error or unexpected behavior.
3. Check your hint.
4. Read the fix.
5. Read the explanation.

This drills the most common constraint mistakes. After finishing all 15 you'll catch them on sight in code review.

---

## Bugs 1-15

### Bug 1 — Missing `~`

```go
package main

type Number interface {
    int | float64
}

func Sum[T Number](xs []T) T {
    var s T
    for _, x := range xs { s += x }
    return s
}

type UserID int

func main() {
    ids := []UserID{1, 2, 3}
    Sum(ids)  // (?) what happens
}
```

**Hint.** What is the relationship between `UserID` and `int`?

**Fix.**
```go
type Number interface {
    ~int | ~float64
}
```

**Explanation.** Without `~`, the constraint matches only the predeclared `int`. `UserID` is a distinct defined type (even though its underlying type is `int`) and is rejected. Add `~` to admit the family of `int`-shaped types.

---

### Bug 2 — Wrong union with intersection intent

```go
type WeirdConstraint interface {
    int
    string
}

func F[T WeirdConstraint]() {}

func main() {
    F[int]()    // (?)
    F[string]() // (?)
}
```

**Hint.** Semicolon between elements means **intersection**, not union.

**Fix.**
```go
type WeirdConstraint interface {
    int | string
}
```

**Explanation.** `interface{ int; string }` requires the type to be in **both** type sets. No type is both `int` and `string`. The intersection is empty; every instantiation fails. To express "either", use the `|` operator inside a single type element.

---

### Bug 3 — Embedding a method-only interface as a type element

```go
type Stringer interface { String() string }

type WrongConstraint interface {
    Stringer | int   // (?) — error here
}
```

**Hint.** What kinds of operands does the union operator accept?

**Fix.**
```go
type WrongConstraint interface {
    int            // type element
    String() string // method element (separately)
}
```

**Explanation.** `|` operates only on type terms (types or `~T`). You cannot union an interface (method-only or general) with a type term. To require both "method `String()`" and "type `int`", list them as separate interface elements (intersection).

---

### Bug 4 — Trying to use a general interface as a value

```go
type Number interface {
    ~int | ~float64
}

func main() {
    var x Number   // (?)
    _ = x
}
```

**Hint.** Can a general interface be used outside the constraint position?

**Fix.** Don't use it as a value. If you genuinely need a runtime value, define a method-only interface instead:

```go
type Numeric interface {
    Add(Numeric) Numeric
}
```

**Explanation.** General interfaces (interfaces with type elements) describe a compile-time type set. They cannot be implemented by a runtime value because their identity is restricted by `~T` or `T | U`. The compiler rejects `var x Number`.

---

### Bug 5 — Calling `==` under `any`

```go
func Equal[T any](a, b T) bool {
    return a == b   // (?)
}
```

**Hint.** Does `any` guarantee comparability?

**Fix.**
```go
func Equal[T comparable](a, b T) bool {
    return a == b
}
```

**Explanation.** `any` is the universal type set; it includes types like slices that don't support `==`. The compiler refuses `==` on a type parameter unless the constraint guarantees comparability (`comparable` or a type-element union of comparable types).

---

### Bug 6 — Forgetting `comparable` for map keys

```go
type Cache[K, V any] map[K]V   // (?)
```

**Hint.** What constraint do Go map keys require?

**Fix.**
```go
type Cache[K comparable, V any] map[K]V
```

**Explanation.** Go's map key type must be comparable. The type parameter `K` must satisfy `comparable` for the compiler to accept the map type definition.

---

### Bug 7 — Method on pointer receiver, constraint requires the method

```go
type Resetter interface {
    Reset()
}

type Counter struct { n int }
func (c *Counter) Reset() { c.n = 0 }

func ResetAll[T Resetter](xs []T) {
    for _, x := range xs {
        x.Reset()
    }
}

func main() {
    counters := []Counter{ {n: 1}, {n: 2} }
    ResetAll(counters)   // (?)
}
```

**Hint.** What is the method set of `Counter` vs `*Counter`?

**Fix.**
```go
ptrs := []*Counter{ {n: 1}, {n: 2} }
ResetAll(ptrs)
```

Or, define `Reset()` with a value receiver (only sensible if it doesn't need to mutate; here it does, so pointers it is).

**Explanation.** `Counter` does not have `Reset()` in its method set; only `*Counter` does. The constraint `Resetter` is not satisfied by `Counter`. Pass pointers.

---

### Bug 8 — `~T` on a defined type

```go
type Money int

type WrongConstraint interface {
    ~Money   // (?)
}
```

**Hint.** What does the spec say about the type after `~`?

**Fix.**
```go
type WrongConstraint interface {
    ~int   // matches Money and any other ~int type
}
```

**Explanation.** The type after `~` must be its own underlying type — typically a predeclared type or an unnamed type literal. `~Money` is illegal because `Money` is a defined type. Use `~int` to match `Money` and friends.

---

### Bug 9 — Using `~` on a slice in a constraint with a method element

```go
type WrongBytes interface {
    ~[]byte
    Len() int
}

type Payload []byte

func main() {
    var p Payload
    UseBytes(p)   // (?) — error
}

func UseBytes[T WrongBytes](x T) {
    println(x.Len())
}
```

**Hint.** Does `[]byte` have a `Len()` method?

**Fix.** Either drop the method element or use a type that has it:

```go
type Payload []byte
func (p Payload) Len() int { return len(p) }
```

Then `UseBytes(p)` works.

**Explanation.** The constraint requires both the underlying type to be `[]byte` **and** the type to have a `Len() int` method. Bare `[]byte` and `Payload` don't have it unless you define it.

---

### Bug 10 — Over-restrictive type element

```go
type Numeric interface {
    int | int64 | float64    // (?)
}

func Sum[T Numeric](xs []T) T {
    var s T
    for _, x := range xs { s += x }
    return s
}

func main() {
    Sum([]int32{1, 2, 3})   // (?) — error
}
```

**Hint.** Is `int32` in the type set?

**Fix.**
```go
type Numeric interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
        ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
        ~float32 | ~float64
}
// or just: import "golang.org/x/exp/constraints"; type Numeric interface { constraints.Integer | constraints.Float }
```

**Explanation.** A union with three types is too narrow. Either enumerate all numeric kinds or use `constraints.Integer | constraints.Float`.

---

### Bug 11 — `comparable` over-broad assumption pre-1.20

```go
// Go 1.18 / 1.19
type Set[T comparable] map[T]struct{}

func main() {
    s := Set[any]{}   // (?)
}
```

**Hint.** What did `comparable` mean before Go 1.20?

**Fix.** Either upgrade to Go 1.20+, or define a narrower constraint:

```go
type Hashable interface {
    ~int | ~uint | ~string | ~bool
}
type Set[T Hashable] map[T]struct{}
```

**Explanation.** Before Go 1.20, `comparable` did not include interface types. `any` is `interface{}`, so `Set[any]` was illegal. Go 1.20 relaxed this; `Set[any]` now compiles, but `==` on values that hold non-comparable dynamic types panics.

---

### Bug 12 — Mixed type set blocks an operator

```go
type IntOrSlice interface { int | []int }

func Double[T IntOrSlice](x T) T {
    return x + x   // (?) — error
}
```

**Hint.** Does every type in the union support `+`?

**Fix.** Choose one shape:
```go
type IntOnly interface { int }
type SliceOnly interface { []int }
```

Or write two functions — one per shape.

**Explanation.** `+` is supported by `int` but not by `[]int`. The compiler refuses the operator because not every type in the type set supports it. There is no way to "specialize per branch" inside a single generic body.

---

### Bug 13 — Empty type set after intersection

```go
type StringInt interface {
    ~int
    ~string
}

func F[T StringInt](x T) {}

func main() {
    F[int]("hi")   // (?)
}
```

**Hint.** What is the intersection of `~int` and `~string`?

**Fix.** Use a union:
```go
type IntOrString interface {
    ~int | ~string
}
```

**Explanation.** `~int` and `~string` describe disjoint families. Their intersection is empty; no type satisfies both. The constraint accepts the declaration but rejects every type argument.

---

### Bug 14 — Trying to embed a constraint into a value-typed interface

```go
type Numeric interface {
    ~int | ~float64
}

type Foo interface {
    Numeric
    String() string
}

func main() {
    var f Foo   // (?)
    _ = f
}
```

**Hint.** Embedding a general interface into another interface — what does it produce?

**Fix.** If you need a runtime-valuable interface, drop the type element:

```go
type Foo interface {
    String() string
}
```

If you need a constraint, that's fine — but use it only in `[T Foo]` positions.

**Explanation.** Embedding `Numeric` (a general interface) makes `Foo` a general interface too. General interfaces cannot be used as value types. `var f Foo` is rejected.

---

### Bug 15 — Re-declaring `comparable`

```go
type comparable interface {   // (?)
    ~int | ~string
}
```

**Hint.** `comparable` is a predeclared identifier.

**Fix.** Pick a different name:

```go
type Hashable interface {
    ~int | ~string
}
```

**Explanation.** `comparable` is reserved as a predeclared identifier (alongside `any`, `int`, etc.). You cannot shadow it with your own type definition without confusion. Pick a different, descriptive name like `Hashable` or `MapKey`.

---

## Summary

The bugs above cover the recurring constraint mistakes:
- Forgetting `~`.
- Confusing union and intersection.
- Mixing method elements and type elements incorrectly.
- Using a general interface as a value.
- Wrong receiver type for a method-element constraint.
- Empty/unsatisfiable type sets.

When reviewing constraint code, run through this list. The cost is two minutes; the savings can be hours of debugging mysterious "T does not satisfy" errors.

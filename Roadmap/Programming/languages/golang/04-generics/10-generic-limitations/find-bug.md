# Generic Limitations — Find the Bug

## How to use

Each problem shows a code snippet that the **compiler refuses**. Read it carefully and answer:
1. What limit is being violated?
2. What is the exact compile-error wording (or close to it)?
3. What is the canonical workaround?

Solutions are at the end.

---

## Bug 1 — method type parameter

```go
type Box[T any] struct{ V T }

func (b Box[T]) Map[U any](f func(T) U) Box[U] {
    return Box[U]{V: f(b.V)}
}
```

**Hint:** The error is about methods declaring something they shouldn't.

---

## Bug 2 — type-switch on T

```go
func Describe[T any](v T) string {
    switch v.(type) {
    case int:    return "int"
    case string: return "str"
    }
    return "?"
}
```

**Hint:** What kind of operand does a type switch require?

---

## Bug 3 — covariant slice assignment

```go
type Animal interface{ Name() string }
type Cat struct{}
func (Cat) Name() string { return "cat" }

func main() {
    cats := []Cat{{}, {}}
    var animals []Animal = cats
    _ = animals
}
```

**Hint:** Variance rule.

---

## Bug 4 — `len` on bare T

```go
func Length[T any](v T) int {
    return len(v)
}
```

**Hint:** What types is `len` defined for?

---

## Bug 5 — `make` on bare T

```go
func Empty[T any]() T {
    return make(T)
}
```

**Hint:** What does `make` need to know?

---

## Bug 6 — interface with method type parameter

```go
type Mapper interface {
    Map[U any](f func(int) U) Mapper
}
```

**Hint:** Same rule as concrete methods.

---

## Bug 7 — receiver missing type parameter

```go
type List[T any] struct{ items []T }

func (l List) Push(v T) {
    l.items = append(l.items, v)
}
```

**Hint:** The receiver must mention the type parameter.

---

## Bug 8 — `~` on an interface

```go
type S interface{ String() string }
type C interface{ ~S }
```

**Hint:** `~T` requires a specific kind of type.

---

## Bug 9 — interfaces in a union

```go
type Either interface { fmt.Stringer | error }

func F[T Either](v T) {}
```

**Hint:** Type elements have rules about what can appear.

---

## Bug 10 — embedding a type parameter

```go
type Wrapper[T any] struct {
    T
}
```

**Hint:** What can a struct embed?

---

## Bug 11 — comparing distinct instantiations

```go
type Box[T any] struct{ V T }

func main() {
    var a Box[int]
    var b Box[int64]
    if a == b {
        _ = a
    }
}
```

**Hint:** Are `Box[int]` and `Box[int64]` the same type?

---

## Bug 12 — generic constant

```go
func F[T int | float64]() {
    const x T = 1
    _ = x
}
```

**Hint:** What is special about constants?

---

## Bug 13 — type assertion on T

```go
func F[T any](v T) int {
    return v.(int)
}
```

**Hint:** Same rule as type switches.

---

## Bug 14 — pre-1.24 generic alias

```go
// Compiled with Go 1.22:
type Vec[T any] = []T
```

**Hint:** Aliases vs definitions.

---

## Bug 15 — generic type alias used as defined type pre-1.24

```go
// Pre-1.24 with workaround
type Vec[T any] []T

func main() {
    v := []int{1, 2, 3}
    var x Vec[int] = v
    _ = x
}
```

**Hint:** Workaround changed the semantics. Does this assignment compile?

---

## Solutions

### Bug 1 — fix
Error: `method must have no type parameters` (or similar). Methods cannot declare new type parameters. Lift to a free function:
```go
func MapBox[T, U any](b Box[T], f func(T) U) Box[U] {
    return Box[U]{V: f(b.V)}
}
```

### Bug 2 — fix
Error: `cannot use type switch on type parameter value v` (T is not an interface). Funnel through `any`:
```go
switch any(v).(type) {
case int:    return "int"
case string: return "str"
}
```

### Bug 3 — fix
Error: `cannot use cats (variable of type []Cat) as []Animal value`. Slices are invariant. Copy element-by-element:
```go
animals := make([]Animal, len(cats))
for i, c := range cats { animals[i] = c }
```

### Bug 4 — fix
Error: `invalid argument: v (variable of type T constrained by any) for len`. Add a constraint that supports `len`:
```go
func Length[E any, S ~[]E | ~string](s S) int { return len(s) }
```

### Bug 5 — fix
Error: `cannot make T: T does not have core type slice/map/chan`. `make` needs a slice/map/chan kind. Rewrite with explicit slice:
```go
func Empty[E any]() []E { return make([]E, 0) }
```

### Bug 6 — fix
Error: `interface method must have no type parameters`. Use a free function:
```go
type IntSlice []int
func MapMapper[U any](m IntSlice, f func(int) U) []U { /* ... */ return nil }
```

### Bug 7 — fix
Error: `instantiation cycle` or `missing type argument list in type Box`. The receiver must repeat the type parameter list:
```go
func (l *List[T]) Push(v T) { l.items = append(l.items, v) }
```

### Bug 8 — fix
Error: `cannot use ~S` (S is an interface type). Use a concrete underlying type:
```go
type C interface { ~int | ~float64 }
```

### Bug 9 — fix
Error: `cannot use fmt.Stringer in union (Stringer is an interface)`. Type elements in unions must be concrete types. Workaround: define a method requirement instead, or accept `any` and handle dynamically.

### Bug 10 — fix
Error: `embedded field type cannot be a type parameter`. Make it a named field:
```go
type Wrapper[T any] struct { Value T }
```

### Bug 11 — fix
Error: `invalid operation: a == b (mismatched types Box[int] and Box[int64])`. Different instantiations are different types. Convert explicitly:
```go
// Convert via constructor
b2 := Box[int]{V: int(b.V)}
if a == b2 { ... }
```

### Bug 12 — fix
Error: `T is not a valid constant type`. Constants cannot have a type-parameter type. Use a variable:
```go
var x T = 1
```

### Bug 13 — fix
Error: `cannot use type assertion on type parameter value`. Funnel through `any`:
```go
return any(v).(int)
```

### Bug 14 — fix
Error in 1.22: `type alias must have no type parameters` (the spec rejected it pre-1.24). Use a type definition:
```go
type Vec[T any] []T
```
Or upgrade to Go 1.24+. See `14-generic-type-aliases` for the full story.

### Bug 15 — fix
Error: `cannot use v (type []int) as Vec[int] value`. The type definition created a distinct named type. Convert explicitly:
```go
var x Vec[int] = Vec[int](v)
```
With a 1.24+ alias `type Vec[T any] = []T`, the assignment would be implicit because the alias preserves identity.

---

## Lessons

Patterns from these bugs:

1. **Methods cannot have new type parameters** (Bugs 1, 6). The receiver's type parameters are the only ones in scope.
2. **Type-switch and type-assertion need interface operands** (Bugs 2, 13). Funnel through `any`.
3. **Variance is invariance** (Bug 3). Copy element-by-element.
4. **Predeclared functions on T require constraint guarantees** (Bugs 4, 5). Add the constraint.
5. **Type elements have strict rules** (Bugs 8, 9). No `~Interface`, no interfaces in unions.
6. **Embedding requires a defined type** (Bug 10). Use a named field.
7. **Each instantiation is a distinct type** (Bug 11). Different parameters → different types.
8. **Constants cannot have type-parameter types** (Bug 12). Use variables.
9. **Generic type aliases shipped in 1.24** (Bugs 14, 15). Use type definitions on older versions.
10. **Receivers must include the type parameter list** (Bug 7). Always repeat `[T]`.

A senior engineer reads these errors as **signposts**: each one points at a documented limit, and each limit has a known canonical workaround. Memorizing the error wording shortens the cycle from "the code does not compile" to "I know exactly what to write instead".

# Generic Pitfalls — Find the Bug

## How to use

Each problem shows a code snippet. Read it carefully and answer:
1. What is the bug?
2. How would you fix it?
3. Is it a pitfall (compiles but misbehaves) or a hard error (refuses to compile)?

Solutions are at the end. Most of these are **realistic** — patterns observed in real codebases.

---

## Bug 1 — `T{}` composite literal

```go
func New[T any]() T {
    return T{}
}
```

**Hint:** What kinds of types support composite literals?

---

## Bug 2 — `nil` check for `T any`

```go
func IsAbsent[T any](v T) bool {
    return v == nil
}
```

**Hint:** What does the constraint `any` permit?

---

## Bug 3 — Type switch on `T` directly

```go
func Describe[T any](v T) string {
    switch v.(type) {
    case int: return "int"
    case string: return "string"
    }
    return "?"
}
```

**Hint:** Type assertions require interface types.

---

## Bug 4 — `comparable` instead of `cmp.Ordered`

```go
import "cmp"

func Min[T comparable](a, b T) T {
    if a < b { return a }
    return b
}
```

**Hint:** What operators does `comparable` allow?

---

## Bug 5 — typed-nil interface

```go
func IsNil[T any](v T) bool {
    return any(v) == nil
}

var p *int
fmt.Println(IsNil(p))
```

**Hint:** What happens when you box a nil pointer into `any`?

---

## Bug 6 — Useless `T`

```go
func Log[T any](msg string, v T) {
    log.Println(msg)
}
```

**Hint:** Where is `T` used?

---

## Bug 7 — empty constraint type set

```go
type Strange interface {
    ~int
    ~string
}

func F[T Strange](v T) T { return v }

F(1)        // ?
F("hello")  // ?
```

**Hint:** Set intersection.

---

## Bug 8 — pointer/value method-set

```go
type Greeter interface { Greet() }

type Bot struct{ name string }
func (b *Bot) Greet() { fmt.Println("hi from", b.name) }

func RunGreeter[T Greeter](g T) { g.Greet() }

RunGreeter(Bot{name: "A"})
```

**Hint:** Whose method set contains `Greet`?

---

## Bug 9 — Constraint-operation mismatch

```go
func Sum[T comparable](s []T) T {
    var total T
    for _, v := range s { total += v }
    return total
}
```

**Hint:** What does `comparable` allow?

---

## Bug 10 — `IsZero` for slice-typed `T`

```go
func IsZero[T comparable](v T) bool {
    var zero T
    return v == zero
}

x := IsZero([]int{})
```

**Hint:** Are slices comparable?

---

## Bug 11 — runtime panic from relaxed `comparable`

```go
func Eq[T comparable](a, b T) bool { return a == b }

var a, b any = []int{1, 2}, []int{1, 2}
fmt.Println(Eq(a, b))
```

**Hint:** Compiles in 1.20+. What happens when run?

---

## Bug 12 — inference fails with function-typed parameter

```go
func Apply[T, U any](f func(T) U) U {
    var t T
    return f(t)
}

r := Apply(func(int) string { return "" })
```

**Hint:** Where do `T` and `U` get pinned?

---

## Bug 13 — reflecting nil interface

```go
import "reflect"

func TypeName[T any](v T) string {
    return reflect.TypeOf(v).Name()
}

var e error
fmt.Println(TypeName(e))
```

**Hint:** What does `reflect.TypeOf` return for nil interface?

---

## Bug 14 — polymorphism by type switch

```go
func Process[T any](v T) {
    switch x := any(v).(type) {
    case Dog: x.Bark()
    case Cat: x.Meow()
    }
}

Process(Fish{})
```

**Hint:** What happens for unhandled types? Is this really generic?

---

## Bug 15 — `Optional[T]` everywhere

```go
type Optional[T any] struct {
    v   T
    has bool
}

func Find[T any](s []T, p func(T) bool) Optional[T] {
    for _, v := range s {
        if p(v) { return Optional[T]{v, true} }
    }
    return Optional[T]{}
}
```

**Hint:** Compare with idiomatic Go.

---

## Solutions

### Bug 1 — fix
**Pitfall: hard error.** `T{}` is a composite literal restricted to specific underlying kinds.
```go
func New[T any]() T {
    var zero T
    return zero
}
```

### Bug 2 — fix
**Pitfall: hard error.** `==` requires comparable, and `nil` requires nilable.
```go
func IsZero[T comparable](v T) bool {
    var zero T
    return v == zero
}
```

### Bug 3 — fix
**Pitfall: hard error.** Convert through `any` first:
```go
switch any(v).(type) { ... }
```
Better: ask why you need to type-switch on `T` and consider using an interface instead.

### Bug 4 — fix
**Pitfall: hard error.** `comparable` does not allow `<`. Use `cmp.Ordered`:
```go
func Min[T cmp.Ordered](a, b T) T { ... }
```

### Bug 5 — fix
**Pitfall: silent wrong answer.** `IsNil(p)` returns `false` because `any(p)` holds `(*int, nil)`. Use reflection or restructure the API:
```go
func IsNil[T any](v T) bool {
    rv := reflect.ValueOf(&v).Elem()
    switch rv.Kind() {
    case reflect.Pointer, reflect.Map, reflect.Slice, reflect.Chan, reflect.Func:
        return rv.IsNil()
    }
    return false
}
```

### Bug 6 — fix
**Pitfall: useless type parameter.** Remove `T`:
```go
func Log(msg string) { log.Println(msg) }
```

### Bug 7 — fix
**Pitfall: empty type set.** No type can satisfy. Both calls fail to compile. Use a union:
```go
type IntOrString interface { ~int | ~string }
```

### Bug 8 — fix
**Pitfall: hard error.** `Greet` is on `*Bot`, not `Bot`. Either change to value receiver or call with `&Bot{...}`:
```go
RunGreeter(&Bot{name: "A"})
```

### Bug 9 — fix
**Pitfall: hard error.** `comparable` does not allow `+`. Use a numeric constraint:
```go
type Number interface { ~int | ~int64 | ~float32 | ~float64 }
func Sum[T Number](s []T) T { ... }
```

### Bug 10 — fix
**Pitfall: hard error.** `[]int` is not comparable. Provide a slice helper:
```go
func IsEmpty[T any](s []T) bool { return len(s) == 0 }
```

### Bug 11 — fix
**Pitfall: silent runtime panic.** `==` on two `[]int` panics. The compiler allowed because of 1.20 relaxation. Defensive code: never pass slices/maps through `comparable` generics.

### Bug 12 — fix
**Pitfall: hard error or runtime weirdness.** Pre-1.21 inference often fails. Specify explicitly:
```go
r := Apply[int, string](func(int) string { return "" })
```

### Bug 13 — fix
**Pitfall: panic.** `reflect.TypeOf(nil interface)` returns nil; `.Name()` panics. Guard:
```go
t := reflect.TypeOf(v)
if t == nil { return "<nil>" }
return t.Name()
```

### Bug 14 — fix
**Pitfall: silent wrong behaviour.** `Process(Fish{})` matches no case and silently does nothing. This is interface dispatch in disguise. Use:
```go
type Animal interface { Sound() string }
func Process(a Animal) { fmt.Println(a.Sound()) }
```

### Bug 15 — fix
**Pitfall: anti-pattern.** Use Go's idiomatic `(T, bool)`:
```go
func Find[T any](s []T, p func(T) bool) (T, bool) {
    for _, v := range s {
        if p(v) { return v, true }
    }
    var zero T
    return zero, false
}
```
`Optional[T]` adds a wrapper type that fights Go's idiom and adds an unwrap step at every boundary.

---

## Lessons

Patterns from these bugs:

1. **Composite literals** never work for arbitrary `T any` (Bug 1).
2. **`nil` and `==` checks** depend on the constraint (Bugs 2, 5, 9, 11).
3. **Type switches require interfaces** (Bug 3) — and even when allowed, often signal misuse (Bug 14).
4. **Constraints must match operations** (Bugs 4, 9). `comparable` ≠ `cmp.Ordered`.
5. **Method sets differ between `T` and `*T`** (Bug 8).
6. **`reflect.TypeOf` is sensitive to nil interfaces** (Bug 13).
7. **Useless type parameters** add complexity without value (Bug 6).
8. **Empty type sets** compile but accept nothing (Bug 7).
9. **Inference fails through function-typed arguments** (Bug 12).
10. **Imported abstractions** like `Optional[T]` fight Go idioms (Bug 15).

A senior reviewer reads constraints and signatures with these patterns in mind. The questions are always the same: "Does the body's operations match the constraint? Is the type parameter doing useful work? Will inference work at the call site?" Mismatches between any of these are the **category** of generic bugs.

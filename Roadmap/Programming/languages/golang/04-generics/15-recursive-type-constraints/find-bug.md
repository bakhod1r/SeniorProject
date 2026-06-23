# Recursive Type Constraints — Find the Bug

## How to use

Each problem shows a code snippet. Read it carefully and answer:
1. What is the bug?
2. How would you fix it?
3. Would a different abstraction have prevented it?

Solutions are at the end. Many of these bugs come from real codebases experimenting with F-bounded polymorphism.

---

## Bug 1 — Cloner returning the interface, not T

```go
type Cloner[T any] interface {
    Clone() Cloner[T]
}

func DupAll[T Cloner[T]](xs []T) []T {
    out := make([]T, len(xs))
    for i, v := range xs { out[i] = v.Clone() }
    return out
}
```

**Hint:** What is the return type of `Clone()`?

---

## Bug 2 — Forgetting the recursion

```go
type Cloner interface {
    Clone() Cloner
}

func DupAll[T Cloner](xs []T) []T {
    out := make([]T, len(xs))
    for i, v := range xs { out[i] = v.Clone() }
    return out
}
```

**Hint:** Which T is `Clone` returning?

---

## Bug 3 — Wrong receiver type

```go
type Cloner[T any] interface { Clone() T }

type User struct{ Name string }

func (u *User) Clone() User { return User{Name: u.Name} }

func main() {
    xs := []User{{"Ada"}}
    DupAll(xs) // ❌
}
```

**Hint:** Which method set has `Clone`?

---

## Bug 4 — Cloning a pointer slice with value method

```go
type Cloner[T any] interface { Clone() T }

type User struct{ Name string }
func (u User) Clone() User { return User{u.Name} }

func main() {
    xs := []*User{{Name: "Ada"}}
    DupAll(xs) // ❌
}
```

**Hint:** What is the type of the slice elements?

---

## Bug 5 — Method type parameter

```go
type Box[T any] struct{ v T }

func (b Box[T]) Map[U any](f func(T) U) Box[U] {
    return Box[U]{v: f(b.v)}
}
```

**Hint:** What does Go forbid for methods?

---

## Bug 6 — Constraint with `any` instead of `T`

```go
type Cloner[T any] interface { Clone() T }

func DupAll[T Cloner[any]](xs []T) []T {
    out := make([]T, len(xs))
    for i, v := range xs { out[i] = v.Clone() }
    return out
}
```

**Hint:** What does `v.Clone()` return?

---

## Bug 7 — Nested recursion

```go
type Cloner[T any] interface { Clone() T }

func DeepDup[T Cloner[Cloner[T]]](xs []T) []T {
    out := make([]T, len(xs))
    for i, v := range xs { out[i] = v.Clone() }
    return out
}
```

**Hint:** Read the constraint slowly.

---

## Bug 8 — Inference failure on two-parameter recursive bound

```go
type Pairable[A, B any] interface {
    Pair(other A) B
}

func PairAll[A Pairable[A, B], B any](xs []A) []B {
    out := []B{}
    for i := 0; i+1 < len(xs); i += 2 {
        out = append(out, xs[i].Pair(xs[i+1]))
    }
    return out
}

func main() {
    var xs []int
    PairAll(xs) // ❌
}
```

**Hint:** Does `int` have a `Pair` method? What can the compiler infer?

---

## Bug 9 — Comparing a value of T inside the body

```go
type Comparable[T any] interface {
    CompareTo(other T) int
}

func Equal[T Comparable[T]](a, b T) bool {
    return a == b // ❌
}
```

**Hint:** What does `Comparable[T]` allow?

---

## Bug 10 — Mixing `comparable` and recursion incorrectly

```go
type Cloner[T comparable] interface {
    Clone() T
}

func DupAll[T Cloner[T]](xs []T) []T {
    out := make([]T, len(xs))
    for i, v := range xs { out[i] = v.Clone() }
    return out
}

type SliceOfInt []int
// SliceOfInt has Clone but is not comparable.
```

**Hint:** What does the inner constraint require?

---

## Bug 11 — Builder returning the interface

```go
type Stepper[B any] interface {
    Step() Stepper[B]
}

type IntBuilder struct{ V int }
func (b IntBuilder) Step() Stepper[IntBuilder] {
    return IntBuilder{V: b.V + 1}
}
```

**Hint:** What is the return type of `Step()`?

---

## Bug 12 — Forgetting to instantiate a recursive type

```go
type Tree[T Cloner[T]] struct {
    items []T
}

var t Tree // ❌
```

**Hint:** Generic types need type arguments.

---

## Bug 13 — Wrong T in receiver method list

```go
type Box[T Cloner[T]] struct{ v T }

func (b Box) Get() T { return b.v }
```

**Hint:** Method receivers and generic types.

---

## Bug 14 — Cloning recursion that loops forever at runtime

```go
type Cloner[T any] interface { Clone() T }

type Bad struct{ self *Bad }

func (b *Bad) Clone() *Bad {
    return b.self.Clone() // infinite recursion
}
```

**Hint:** Compile vs runtime.

---

## Bug 15 — Pointer T with value satisfaction

```go
type Cloner[T any] interface { Clone() T }

type S struct{}
func (s S) Clone() S { return s }

func main() {
    var x *S
    DupAll([]*S{x}) // ❌
}
```

**Hint:** Method sets of S vs *S.

---

## Solutions

### Bug 1 — fix
`Clone()` returning the interface defeats the recursion. Fix:
```go
type Cloner[T any] interface { Clone() T }
```

### Bug 2 — fix
The interface is non-generic; `Clone` returns `Cloner` and the assignment to `out[i]` (typed `T`) fails. Fix: make the interface generic and use `[T Cloner[T]]`.

### Bug 3 — fix
Either change the receiver to value:
```go
func (u User) Clone() User { return User{u.Name} }
```
Or call with `[]*User`:
```go
DupAll([]*User{...}) // T = *User, but then *User must have Clone() *User
```

### Bug 4 — fix
For `T = *User`, the constraint `Cloner[*User]` requires a `Clone() *User`. Add:
```go
func (u *User) Clone() *User { return &User{u.Name} }
```

### Bug 5 — fix
Methods cannot declare their own type parameters. Move to a free function:
```go
func Map[T, U any](b Box[T], f func(T) U) Box[U] {
    return Box[U]{v: f(b.v)}
}
```

### Bug 6 — fix
`Cloner[any]` returns `any`, not `T`. Use `Cloner[T]`:
```go
func DupAll[T Cloner[T]](xs []T) []T { ... }
```

### Bug 7 — fix
Two layers of recursion is rejected by Go's constraint system in most shapes. Flatten to one level:
```go
func DeepDup[T Cloner[T]](xs []T) []T { ... }
```
For genuine "container of cloneables", split into two type parameters explicitly.

### Bug 8 — fix
The compiler cannot infer `B` because `int` has no `Pair` method. Either give `int` a wrapper type with `Pair`, or instantiate explicitly:
```go
PairAll[Foo, Bar](xs)
```

### Bug 9 — fix
`Comparable[T]` does not include `comparable`. Use the method:
```go
return a.CompareTo(b) == 0
```

### Bug 10 — fix
Either drop `comparable` from `Cloner`'s declaration, or accept that `SliceOfInt` cannot satisfy it (slices are not comparable). Best: keep `Cloner[T any]` and intersect with `comparable` in callers that need equality.

### Bug 11 — fix
The interface returns itself, not `B`. Fix:
```go
type Stepper[B any] interface { Step() B }
func (b IntBuilder) Step() IntBuilder { return IntBuilder{V: b.V + 1} }
```

### Bug 12 — fix
Provide the type argument:
```go
var t Tree[User]
```
Where `User` satisfies `Cloner[User]`.

### Bug 13 — fix
The receiver must repeat the type parameter list:
```go
func (b Box[T]) Get() T { return b.v }
```

### Bug 14 — fix
Recursive constraints are a **type-system** mechanism. Runtime infinite loops are unrelated and your responsibility:
```go
func (b *Bad) Clone() *Bad { return &Bad{} }
```

### Bug 15 — fix
`*S` does not have `Clone() *S` because `S`'s value-receiver method does not appear in `*S`'s method set in the right shape. Add a pointer-receiver method:
```go
func (s *S) Clone() *S { return s }
```

---

## Lessons

Patterns from these bugs:

1. **Return type is everything.** A recursive constraint is wasted if the method returns the interface or a different parameterisation. Always return `T`.
2. **Receiver types matter.** Value vs pointer receivers determine which side of T satisfies the constraint.
3. **Methods cannot have their own type parameters.** Always use free functions.
4. **`any` in the constraint kills the recursion.** Use the parameter, not `any`.
5. **Nested recursion is rejected.** Keep recursion shallow.
6. **Inference has limits.** When parameters appear only in constraints, instantiate explicitly.
7. **`comparable` and recursive constraints can mix**, but be careful what types satisfy both.
8. **Generic types need their type arguments.** No bare `Tree`.

A useful mantra: **the recursion exists to bring T back to the surface**. If the body of the function does not actually use the returned `T` as `T`, the constraint is misapplied. Keep the recursion meaningful.

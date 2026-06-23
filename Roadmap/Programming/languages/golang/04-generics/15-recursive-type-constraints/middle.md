# Recursive Type Constraints — Middle Level

## Table of Contents
1. [F-bounded polymorphism explained](#f-bounded-polymorphism-explained)
2. [The simple alternative — interface returning interface](#the-simple-alternative-interface-returning-interface)
3. [Why the simple alternative is not enough](#why-the-simple-alternative-is-not-enough)
4. [Fluent builders with recursive bounds](#fluent-builders-with-recursive-bounds)
5. [Two-step builders and intermediate states](#two-step-builders-and-intermediate-states)
6. [Recursive constraints with two parameters](#recursive-constraints-with-two-parameters)
7. [Comparison vs `cmp.Ordered`](#comparison-vs-cmpordered)
8. [Reading the spec for recursive interfaces](#reading-the-spec-for-recursive-interfaces)
9. [Summary](#summary)

---

## F-bounded polymorphism explained

The academic name for a constraint that **bounds T by an interface that mentions T** is **F-bounded polymorphism**. The "F" comes from the way the bound itself is parameterized by `T`:

```
T : F(T)
```

In Go this becomes:

```go
func Foo[T C[T]](x T) T { ... }
```

Where `C[T]` is an interface like `interface{ Method() T }`.

### Where the name comes from

The pattern was named in the 1989 paper *"F-Bounded Polymorphism for Object-Oriented Programming"* (Canning, Cook, Hill, Olthoff, Mitchell). The same paper introduced the idea for type systems with explicit subtyping. Java, C#, Scala, Kotlin all adopted it. Go inherits it implicitly: there is no special syntax, just the natural consequence of letting generic interfaces play the role of constraints.

### The fundamental problem it solves

In a non-generic interface, `Clone() Cloner` returns the **interface**, not the concrete type. After a chain of `.Clone()` calls, the user holds a `Cloner` and must assert. F-bounded polymorphism breaks the chain by saying "Clone returns `T`, where `T` is your concrete type".

```go
// Non-recursive — caller loses the type
type Cloner interface { Clone() Cloner }

// Recursive bound — caller keeps the type
type Cloner[T any] interface { Clone() T }
func DupAll[T Cloner[T]](xs []T) []T { ... }
```

### Why Go's design is unusual

Most languages with F-bounded polymorphism have inheritance. The bound says "T must extend C[T]". Go has no inheritance — it has structural interface satisfaction. So the "T extends C[T]" relation becomes "T satisfies the type set of C[T]". The semantics is the same; the mechanism is different.

---

## The simple alternative — interface returning interface

Before generics, Go programmers wrote:

```go
type Cloner interface {
    Clone() Cloner
}

func DupAll(xs []Cloner) []Cloner {
    out := make([]Cloner, len(xs))
    for i, v := range xs {
        out[i] = v.Clone()
    }
    return out
}
```

This works at runtime. But it has four problems:

1. **The caller boxes their values.** Putting a `User` into `[]Cloner` requires wrapping each value in an interface header.
2. **The caller asserts on the way out.** `out[0].(User)` is required.
3. **Cross-type bugs slip through.** A `[]Cloner` with mixed types compiles silently.
4. **Performance suffers.** Every `Clone()` call goes through interface dispatch and may allocate.

### Performance comparison

| Approach | ns/op | allocs/op |
|----------|-------|-----------|
| `DupAll(xs []User)` (hand-written, non-generic) | 22 | 0 |
| `DupAll[T Cloner[T]](xs []T)` instantiated for `User` | 23 | 0 |
| `DupAll(xs []Cloner)` interface-only | 95 | 1 per element |

The recursive bound matches hand-written code because `T = User` makes the call direct.

---

## Why the simple alternative is not enough

The interface-only style breaks down once the **caller wants to keep working with the concrete type**:

```go
type Notification struct{ Body string }

func (n Notification) Clone() Cloner { return n } // works
func (n Notification) Send() { ... }              // concrete-only method

xs := []Cloner{Notification{"hi"}}
ys := DupAll(xs)
ys[0].Send() // ❌ Send is on Notification, not Cloner
```

You must assert `ys[0].(Notification).Send()`. With the recursive bound:

```go
ys := DupAll([]Notification{{"hi"}})
ys[0].Send() // ✓ ys is []Notification
```

The caller keeps full access to `Notification`'s API. That is the whole reason recursive constraints exist.

### Lossless round-trip

A useful slogan: a function with a recursive bound is **type-lossless**. The input type is the same as the output type. Without the bound, the function loses information at the type system level.

---

## Fluent builders with recursive bounds

Fluent builder APIs are the most popular use of recursive constraints.

### The naive builder

```go
type Builder struct {
    name string
    age  int
}

func (b Builder) WithName(n string) Builder { b.name = n; return b }
func (b Builder) WithAge(a int) Builder      { b.age = a; return b }
```

This works because `Builder` has all methods inline. But what if you want to **share** the builder methods across types?

### The shared-step builder

```go
type StepBuilder[B any] interface {
    Step() B
}

func RunAll[B StepBuilder[B]](b B) B {
    return b.Step().Step().Step()
}

type IntBuilder struct{ V int }
func (b IntBuilder) Step() IntBuilder { return IntBuilder{V: b.V + 1} }

type StringBuilder struct{ V string }
func (b StringBuilder) Step() StringBuilder { return StringBuilder{V: b.V + "*"} }

func main() {
    fmt.Println(RunAll(IntBuilder{V: 0}).V)        // 3
    fmt.Println(RunAll(StringBuilder{V: ""}).V)    // ***
}
```

The free function `RunAll` operates on **any** builder that promises `Step() B`.

### Why this needs the recursion

Without the recursive bound, `Step()` would return an interface and the chain `Step().Step().Step()` would not give you back `B`. You would have to assert on each step.

### Limitations

The fluent style hits a wall when you want **different methods at different stages** of the build. F-bounded polymorphism keeps the **same** type across calls. To change the type per step, you need separate generic interfaces, which is hard to express in Go's current generics. C++ and Rust handle this with **typestate** patterns.

---

## Two-step builders and intermediate states

Sometimes a builder transitions through stages: `EmptyOrder` → `OrderWithItems` → `SubmittedOrder`. Each stage exposes different methods.

A naive recursive bound cannot express this. You usually fall back to **separate types** with a `Build()` method connecting them:

```go
type OrderDraft struct{ items []string }
func (o OrderDraft) AddItem(s string) OrderDraft { o.items = append(o.items, s); return o }
func (o OrderDraft) Submit() SubmittedOrder      { return SubmittedOrder{items: o.items} }

type SubmittedOrder struct{ items []string }
func (o SubmittedOrder) Cancel() CancelledOrder { return CancelledOrder{items: o.items} }
```

The transitions are concrete types, not generic. You **lose** the recursive abstraction but gain compile-time stage enforcement.

A common middle ground:

```go
type Stepper[Self, Next any] interface {
    Step() Next
}
```

Two type parameters: the current type and the next. This is no longer self-referential — it is a **two-parameter generic interface**. Go accepts it.

---

## Recursive constraints with two parameters

Recursion does not have to be one-parameter. You can write:

```go
type Pairable[A, B any] interface {
    Pair(other A) B
}

func PairAll[A Pairable[A, B], B any](xs []A) []B {
    out := make([]B, 0, len(xs))
    for i := 0; i+1 < len(xs); i += 2 {
        out = append(out, xs[i].Pair(xs[i+1]))
    }
    return out
}
```

`A` is bounded by an interface that mentions both `A` and `B`. This is still F-bounded — just with two type parameters in the constraint. Go accepts it; inference works in many but not all cases.

### When inference fails

If `B` appears **only** in the constraint and not in any other parameter or return type, the compiler cannot infer it from the call site. You must instantiate explicitly:

```go
out := PairAll[Foo, Bar](xs)
```

This is one of the practical limits we explore in `senior.md`.

---

## Comparison vs `cmp.Ordered`

`cmp.Ordered` is a **non-recursive** constraint:

```go
type Ordered interface {
    ~int | ~float64 | ~string | ...
}
```

It works for primitive-shaped types: integers, floats, strings, and any `~`-derived domain types. But it cannot be used for **struct types** that have a custom ordering.

A recursive `Comparable[T]` solves that:

```go
type Comparable[T any] interface {
    CompareTo(other T) int
}

type Money struct{ Cents int }

func (m Money) CompareTo(other Money) int { return m.Cents - other.Cents }
```

Now `func Sort[T Comparable[T]](xs []T)` works for `Money`, while `cmp.Ordered` cannot.

### Side-by-side

| Constraint | Works for | Custom struct sort? | Operator-friendly? |
|------------|-----------|--------------------|--------------------|
| `cmp.Ordered` | int, float, string, ~derivatives | no | yes (`<`, `>`) |
| `Comparable[T]` (recursive) | anything with `CompareTo` | yes | no (method only) |

In practice, both coexist: use `cmp.Ordered` for primitives, fall back to `Comparable[T]` for domain types.

---

## Reading the spec for recursive interfaces

The Go specification does not call this pattern "F-bounded polymorphism". It falls out of two existing rules:

1. **A constraint is an interface.** (Type constraints section.)
2. **A generic interface can be instantiated with a type parameter.** (Type parameters section.)

So writing `[T Cloner[T]]` is just instantiating `Cloner` with `T`. There is no separate language feature.

### What the compiler actually does

Conceptually:

1. See `[T Cloner[T]]`.
2. Substitute the candidate type at the call site, e.g., `User`, into both occurrences of `T`.
3. The constraint becomes `User Cloner[User]`, i.e., `User` must implement `interface{ Clone() User }`.
4. Check method set membership.

If the type implements the substituted method, the call compiles. The recursion is unrolled exactly **once** because the substitution gives back a concrete interface — there is no further `T` to substitute.

### The "no real recursion at runtime"

Recursive constraints are a **type-system** trick. At runtime, no infinite expansion happens. The compiler resolves the constraint once and produces a normal stenciled body. The call site is a regular function call.

---

## Summary

F-bounded polymorphism — recursive type constraints — is the Go pattern for "method returns my exact concrete type". It is the natural consequence of generic interfaces being usable as constraints. The two main use cases are **self-cloning / self-merging types** and **fluent builders**. The technique preserves the concrete type across method calls, removing the need for assertions and the cost of interface dispatch.

The simple alternative — `Clone() Cloner` returning an interface — works for one-step calls but loses the type and pays for boxing. Recursive bounds eliminate both costs.

Some patterns hit Go's expressiveness limits: nested recursion, typestate transitions, and inference with type parameters that only appear in the constraint. We dive into those limits in `senior.md`.

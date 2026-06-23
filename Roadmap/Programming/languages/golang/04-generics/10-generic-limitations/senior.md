# Generic Limitations — Senior Level

## Table of Contents
1. [No higher-kinded types](#no-higher-kinded-types)
2. [No specialization](#no-specialization)
3. [No SFINAE or concept-style overloading](#no-sfinae-or-concept-style-overloading)
4. [Structural typing meets type parameters](#structural-typing-meets-type-parameters)
5. [Method-set limits with parameterized types](#method-set-limits-with-parameterized-types)
6. [The constraint-as-interface ceiling](#the-constraint-as-interface-ceiling)
7. [Architectural impact](#architectural-impact)
8. [Summary](#summary)

---

## No higher-kinded types

A **higher-kinded type (HKT)** is a type parameter that itself takes type parameters. In Haskell or Scala you can write:

```haskell
class Functor f where
  fmap :: (a -> b) -> f a -> f b
```

Here `f` is a type parameter that must take **another** type. It abstracts over **type constructors**, not just types. In Go this is impossible:

```go
type Functor[F[_] any, A, B any] interface { // ❌ — Go has no F[_] kind
    Fmap(f func(A) B) F[B]
}
```

There is no kind system in Go. A type parameter is always an ordinary type (`int`, `*Foo`, `[]string`), never "a type-of-type".

### Why this matters architecturally

The lack of HKTs means certain abstractions popular in functional languages **cannot be expressed**:

- `Functor[F]`, `Monad[M]`, `Applicative[F]`
- "Effect" types like `IO[A]`, `State[S, A]`, `Reader[R, A]` as a polymorphic family
- Generic `Traverse`, `Sequence`

The standard workaround is to **drop the abstraction** and write per-container free functions:

```go
// No HKT. Just per-container Map.
func MapSlice[T, U any](s []T, f func(T) U) []U { ... }
func MapStack[T, U any](s *Stack[T], f func(T) U) *Stack[U] { ... }
func MapQueue[T, U any](q *Queue[T], f func(T) U) *Queue[U] { ... }
```

This duplicates the **wrapper** even though the inner logic is the same. It is verbose but explicit, and the Go community has accepted it. Libraries like `samber/lo` and `samber/mo` prove that even without HKTs, ergonomic functional helpers are possible.

### Why Go does not have HKTs

The proposal for type parameters (43651) explicitly excluded HKTs:

> Type parameters are types, not type constructors. Adding kinds would significantly complicate the type system, the compiler, and the runtime, with limited gain for typical Go workloads.

The Go team's pragmatic stance: the kind of code that benefits from HKTs (functional pipelines, effect tracking) is rarely the bottleneck in real Go programs. Adding HKTs to chase those use cases would slow down everything else.

---

## No specialization

In C++ and Rust nightly you can write a **specialization** — a separate body for a specific instantiation:

```cpp
template <typename T> int hash(T v) { /* generic */ }
template <> int hash<string>(string v) { /* specialized */ }
```

Go does not. There is exactly **one body** per shape, and the dictionary fills in per-type details. You cannot say "for `int`, use this faster path; for everything else, use the generic path".

### The workarounds

#### 1. Outside-the-generic dispatch

```go
func Hash[T any](v T) uint64 {
    if h, ok := any(v).(*FastHash); ok { return h.Compute() }
    return genericHash(v)
}
```

This re-introduces an `any` conversion and a runtime check. Acceptable when the fast path is taken often enough that the dispatch cost is amortized.

#### 2. A separate non-generic function for the hot type

```go
func Hash[T any](v T) uint64 { /* generic */ }
func HashInt(v int) uint64 { /* specialized */ }
```

Callers explicitly choose. The compiler will not inline `Hash` to call `HashInt` automatically.

#### 3. Profile-guided optimization (PGO)

In Go 1.21+, PGO can devirtualize hot dictionary lookups when profile data shows a single dominant instantiation. This is the closest thing to specialization the compiler offers, and it is **automatic** — you do not write code for it, you record profiles and rebuild.

### Architectural consequence

You cannot ship a generic library that "secretly does the right thing" for known hot types. Either:

- The library is generic everywhere (uniform, slightly slower for hot types)
- The library exposes specialized helpers (more API surface, more docs)

Most senior Go authors choose the first and let users wrap the second locally.

---

## No SFINAE or concept-style overloading

C++ has SFINAE ("Substitution Failure Is Not An Error"): the compiler tries multiple overloads and picks the one that compiles. C++20 added **concepts**, a cleaner mechanism for the same goal. Rust has **trait coherence** with overlap rules.

Go has **none** of these. A function name is unique within its scope. You cannot write:

```go
func Process[T int](v T) { /* int version */ }
func Process[T string](v T) { /* string version */ } // ❌ — duplicate name
```

### The workarounds

#### 1. Different names

```go
func ProcessInt(v int) { ... }
func ProcessString(v string) { ... }
```

The mainstream Go idiom. Unambiguous, easy to grep.

#### 2. One generic with internal dispatch

```go
func Process[T int | string](v T) {
    switch x := any(v).(type) {
    case int: /* ... */
    case string: /* ... */
    }
}
```

We covered this in the middle file. Re-introduces boxing.

#### 3. An interface

```go
type Processor interface { Process() }
type IntVal int
func (n IntVal) Process() { /* ... */ }
type StrVal string
func (s StrVal) Process() { /* ... */ }
```

Clean polymorphism. The senior choice when behaviour really differs.

### Why no overloading?

Go's design rejects function-name overloading entirely — even outside generics. Two functions in the same package cannot share a name. This is part of Go's broader "less is exponentially more" philosophy: the cost of overload resolution (for the user, the compiler, and the toolchain) was deemed not worth the benefit.

Generics inherit this restriction. You cannot define multiple `Process[T]` for different constraint sets.

---

## Structural typing meets type parameters

Go has **structural** interface satisfaction: a type satisfies an interface if its method set matches, regardless of name. This works with parameterized types — but with subtle limits.

### What works

```go
type Stringer interface { String() string }

type Named[T any] struct{ Name string; V T }
func (n Named[T]) String() string { return n.Name }

var s Stringer = Named[int]{} // OK
```

A method set on a generic type is **the same for every instantiation** when the method does not use the type parameter.

### What does not work

#### 1. Different method sets per instantiation

You cannot conditionally add a method based on `T`:

```go
type Container[T any] struct{ ... }
func (c Container[T]) Sum() T // only valid if T is numeric
```

There is no "where T is Number" clause on a method. The method's existence is **uniform** across every instantiation.

Workaround: free function with the constraint.

```go
func SumContainer[T Number](c Container[T]) T { ... }
```

#### 2. Interfaces with type-parameterized method signatures

```go
type Iter[T any] interface { Next() (T, bool) }
```

This is fine — a single `T`. But:

```go
type BiFunctor interface {
    Map[A, B, C, D any](f func(A) C, g func(B) D) BiFunctor // ❌
}
```

Not allowed. Interfaces cannot have method type parameters.

#### 3. Structural matching with type parameters in the interface

```go
type Adder[T any] interface { Add(T) }
```

A type satisfies `Adder[int]` if it has `Add(int)`. But a type with `Add(int)` does NOT automatically satisfy `Adder[T]` in a generic function — the compiler instantiates `Adder` per call site, and matching happens **after** instantiation.

This sometimes confuses senior engineers coming from C# or Java, where interfaces with type parameters compose more freely.

---

## Method-set limits with parameterized types

The method set of a parameterized type is fixed at declaration:

```go
type List[T any] struct{ ... }
func (l *List[T]) Push(v T)
func (l *List[T]) Pop() (T, bool)
```

No method can be added per instantiation, conditionally based on `T`'s constraint, or via "extension methods" (a feature Go has never had).

### The "embed and override" non-pattern

In some languages you would embed a base parameterized type and override a method based on `T`. In Go:

```go
type Base[T any] struct{ ... }
func (b Base[T]) Compute() T { ... }

type Special struct{ Base[int] }
// Cannot override Compute() based on T being int
```

You can shadow `Compute` with a non-generic method on `Special`, but the shadowing is not "specialization for `T == int`" — it is just normal Go method shadowing.

### What this means for library design

A senior engineer designing a generic API must:

1. Decide the **complete** method set up front
2. Accept that callers cannot extend or specialize it without wrapping
3. Use **interfaces** when callers need to inject behaviour

This is why the generic stdlib (`slices`, `maps`, `cmp`) consists almost entirely of **free functions** rather than methods on generic containers. Free functions sidestep the method-set limits.

---

## The constraint-as-interface ceiling

Go's choice to make constraints **interfaces** (with type elements) was elegant — but it caps what constraints can express:

### What constraints CAN express

- Method requirements: `interface { String() string }`
- Type sets: `interface { int | string }`
- Underlying-type sets: `interface { ~int | ~float64 }`
- Intersections: embedded interfaces

### What constraints CANNOT express

#### 1. "T must have a method whose return type is T"

In Java/C# you can write `<T extends Comparable<T>>`. In Go, the analog requires constraint type inference and is awkward:

```go
type Comparer[T any] interface { CompareTo(other T) int }

func Sort[T Comparer[T]](s []T) { /* ... */ }
```

This works for the simple case but breaks when `T` itself has type parameters or when you need recursive bounds. See [`15-recursive-type-constraints`](../15-recursive-type-constraints/junior.md) for the deep dive.

#### 2. "T must be a slice of some E"

```go
type SliceOf[E any] interface { ~[]E }

func Sum[E Number, S SliceOf[E]](s S) E { ... }
```

This works but **two type parameters** are needed where one would suffice in a more expressive system.

#### 3. "T must implement either A or B"

```go
type AOrB interface { A | B } // OK only if A and B are types, not interfaces
```

You cannot say "T satisfies interface A or interface B". Type elements in unions must be types, not interfaces. This blocks "duck typing" across interface families.

#### 4. Negative constraints

"T is any comparable type **except** `string`" — Go has no syntax for this. Workaround: validate at runtime.

---

## Architectural impact

A senior Go engineer evaluates a generic design against these limits:

### Design decisions a senior engineer makes

1. **Free functions over methods** when type relations cross multiple parameters.
2. **One body, no specialization.** Profile-guided optimization is the only "specialization" Go offers.
3. **Names, not overloads.** `ProcessInt`, `ProcessString` if behaviour really differs.
4. **No HKT abstractions.** Per-container helpers are the Go way.
5. **Interfaces for polymorphism**, generics for parameterism.
6. **Document the constraint shape carefully** because users cannot extend it.

### When to abandon generics altogether

If your design hits **three or more** of the limits above, you are fighting the language. Common signs:

- You wish methods could have type parameters
- You wish to specialize for one type
- You want negative constraints
- You want to abstract over container kinds

In this case the right design is usually **interfaces** with a small amount of concrete code per implementation. Trying to bend generics to do polymorphism produces code that nobody can read.

### When the limits do not bite

- Algorithmic helpers: `Map`, `Filter`, `Reduce`, `Sort`, `Find`
- Pure data containers: Stack, Queue, Set, Map
- Numeric utilities: `Min`, `Max`, `Sum`, `Clamp`
- Type-safe wrappers: `AtomicValue[T]`, `Pool[T]`, `Result[T]`

The vast majority of generic code in real Go projects falls into these categories. The limits only bite when you reach for HKT, specialization, or per-instantiation method sets.

---

## Summary

The senior view of generic limitations is **architectural**:

1. **No HKTs** — per-container helpers replace `Functor`/`Monad`-style abstractions.
2. **No specialization** — one body per shape, with PGO as the only auto-optimization.
3. **No SFINAE / overloading** — different names or interface dispatch.
4. **Structural typing has limits with type parameters** — uniform method sets, no per-instantiation conditional methods.
5. **Constraints are interfaces** — the ceiling is set by what interfaces can express.
6. **Free functions outside the type** are the default workaround.

Go's design philosophy is consistent: **prefer simple language semantics over expressive power**. Each missing feature was a deliberate "no" to keep the language teachable and the toolchain fast. Senior engineers do not fight these decisions — they choose between generics (for parameterism) and interfaces (for polymorphism) and write the rest in plain Go.

The professional file (`professional.md`) walks through how mature codebases work around these limits with codegen, runtime reflection, and interface fallbacks — and the trade-offs of each.

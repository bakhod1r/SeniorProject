# Recursive Type Constraints — Senior Level

## Table of Contents
1. [Where Go's expressiveness ends](#where-gos-expressiveness-ends)
2. [Constraints that "should" work but don't](#constraints-that-should-work-but-dont)
3. [Inference depth and when the compiler gives up](#inference-depth-and-when-the-compiler-gives-up)
4. [Two-parameter F-bounds and inference](#two-parameter-f-bounds-and-inference)
5. [Self-bounded types as method receivers](#self-bounded-types-as-method-receivers)
6. [Workarounds and accepting verbosity](#workarounds-and-accepting-verbosity)
7. [Designing public APIs with recursive bounds](#designing-public-apis-with-recursive-bounds)
8. [When to abandon the pattern](#when-to-abandon-the-pattern)
9. [Summary](#summary)

---

## Where Go's expressiveness ends

Recursive constraints look powerful but Go's generic machinery deliberately stops short of full F-bounded polymorphism. A senior engineer must know the wall before they hit it.

### The three boundaries

1. **One layer of self-reference is fine.** `[T Cloner[T]]` is supported.
2. **Nested self-reference is rejected.** `[T Cloner[Cloner[T]]]` does not compile cleanly.
3. **Mutual recursion across constraints is fragile.** Two interfaces that mention each other often confuse the type checker.

### Why these limits exist

The Go team chose **decidable type checking** as a hard requirement. Languages that allow unbounded recursion in their constraints have type checkers that may not terminate. Java's wildcards, Scala's higher-kinded types, and C++'s SFINAE all have famously slow or undecidable corners. Go decided to forbid the corners.

The trade-off: simpler error messages, faster compilation, but you cannot express every type relation that academic literature describes.

---

## Constraints that "should" work but don't

### Example 1 — Constraint requiring an instance of itself in a slice

```go
type Mergeable[T any] interface {
    Merge(others []T) T
}

func ReduceAll[T Mergeable[T]](xs []T) T {
    var head T
    if len(xs) == 0 { return head }
    return xs[0].Merge(xs[1:])
}
```

This works. The recursion is one layer.

```go
type DoubleMergeable[T any] interface {
    Merge(other Mergeable[T]) T
}
```

This still works because `Mergeable[T]` is a concrete (instantiated) interface inside `DoubleMergeable[T]`. The compiler accepts it.

But:

```go
type Self interface {
    Method() Self
}

type Bound[T Self] func(x T) T  // ❌ Self is not generic; no T to bind to
```

Mixing recursive constraints with non-generic self-references fails. The error messages are obscure.

### Example 2 — Constraint that requires the method set of T to include T itself in a slice

```go
type Container[T any] interface {
    Items() []T
}

func Flatten[T Container[T]](c T) []T {
    return c.Items() // returns []T, fine
}
```

This works. But:

```go
func DeepFlatten[T Container[T]](c T) []T {
    out := []T{}
    for _, x := range c.Items() {
        out = append(out, DeepFlatten(x)...) // recursive call
    }
    return out
}
```

Compiles. The runtime recursion is fine. But the **type system** has only one layer — the recursion is in your code, not in the constraint.

If you wanted the constraint to enforce "items are themselves containers of themselves", you would need:

```go
type DeepContainer[T any] interface {
    Items() []DeepContainer[T] // ❌ no clean way to express this
}
```

That kind of nested self-reference is what the Go type system rejects.

### Example 3 — Constraint with a method returning a generic of T

```go
type Mapper[T any] interface {
    Map(f func(T) T) Mapper[T]
}

func DoMap[T Mapper[T]](m T, f func(T) T) T {
    return m.Map(f).(T) // type assertion — ugly
}
```

`Map` returns `Mapper[T]`, not `T`. Even though we used a recursive bound, the **method's return** is the interface, not `T`. Fix: change the method to return `T` directly.

```go
type Mapper[T any] interface {
    Map(f func(T) T) T
}
```

Now no assertion is needed. The lesson: **the recursion must reach `T` directly**, not just stay at `I[T]`.

---

## Inference depth and when the compiler gives up

Type inference for recursive constraints follows the standard two-pass algorithm, but with extra constraint-resolution steps.

### Step-by-step

For `func DupAll[T Cloner[T]](xs []T) []T` called as `DupAll(myUsers)`:

1. From the argument `myUsers []User`, infer `T = User`.
2. Substitute into the constraint: `User Cloner[User]`.
3. Verify `User` has method `Clone() User`. It does.
4. Compile.

Easy case. Now consider:

```go
func PairAll[A Pairable[A, B], B any](xs []A) []B { ... }

PairAll(myFoos) // ?
```

`A = Foo` is inferred. But what is `B`? `B` does not appear in `[]A`, only in the constraint. The compiler:

1. Sees `Foo Pairable[Foo, B]` — must find an interface match.
2. Looks at `Foo`'s methods: `Pair(other Foo) Bar`.
3. Matches the constraint pattern `Pair(other A) B` against `Pair(other Foo) Bar`.
4. Infers `B = Bar`.

This is **constraint type inference** — propagating type info from the constraint backwards. Go 1.21 made it more capable.

### When inference fails

Inference fails when:

- A type parameter appears **only** inside a deeply nested constraint and no argument constrains it.
- Multiple constraint solutions exist and the compiler picks none.
- The recursion depth exceeds what the compiler is willing to explore.

The error message is usually:

```
cannot infer T
```

Workaround: instantiate explicitly: `PairAll[Foo, Bar](xs)`.

### Recursion depth in practice

Go's compiler does **not** unwrap recursive constraints multiple times. It substitutes once and stops. So no matter how complex the constraint looks, only one layer of substitution happens. The "depth" question is really "did inference find a unique solution at depth 1?".

---

## Two-parameter F-bounds and inference

The `Pairable[A, B]` example earlier is realistic. Let us go deeper:

```go
type Encoder[I, O any] interface {
    Encode(I) O
}

func Pipeline[I, O any, E Encoder[I, O]](e E, in I) O {
    return e.Encode(in)
}
```

Calling this with `Pipeline(myJSONEncoder, "hi")` requires the compiler to:

1. Infer `I = string` from `in`.
2. Infer `E = JSONEncoder` from the receiver.
3. Look at `JSONEncoder`'s `Encode` method to derive `O`.

This works in Go 1.21+. In 1.18-1.20 it sometimes failed and required explicit instantiation.

### Generic interfaces vs concrete interfaces

A subtle gotcha: when the interface in the constraint has more type parameters than the function exposes, you can run into ambiguity. Some authors prefer to limit recursive constraints to **one** type parameter for inference reliability.

---

## Self-bounded types as method receivers

A pattern that breaks in Go: putting the recursive function on the **type itself**:

```go
type Cloner[T any] interface {
    Clone() T
}

type Container[T Cloner[T]] struct {
    items []T
}

func (c Container[T]) DupAll() []T {
    out := make([]T, len(c.items))
    for i, v := range c.items {
        out[i] = v.Clone()
    }
    return out
}
```

This works! The recursive constraint is on the **type**, not on the method. Methods do not have their own type parameters — they use the type's parameters. The recursion is set up once at the type level.

But:

```go
type Container2[T any] struct {
    items []T
}

func (c Container2[T]) DupAll() []T where T Cloner[T] { ... } // ❌
```

There is no `where` clause. You cannot constrain a method differently from the type. The constraint must live on the type.

### Workaround — split the function out

If only some methods need the recursive constraint, write them as **free functions**:

```go
type Container[T any] struct{ items []T }

func DupContainer[T Cloner[T]](c Container[T]) []T {
    out := make([]T, len(c.items))
    for i, v := range c.items {
        out[i] = v.Clone()
    }
    return out
}
```

The container itself is a normal generic; the cloning operation is a free function with its own constraint. This is the idiomatic Go workaround.

---

## Workarounds and accepting verbosity

Once you accept Go's limits, the standard workarounds are:

### 1. Promote to a free function

Methods cannot have their own type parameters. Move the operation to a package-level function.

### 2. Use a non-generic interface for the runtime case

If you only need the **runtime** behaviour (a list of cloners), a plain interface returning interface is fine:

```go
type AnyCloner interface { Clone() AnyCloner }
```

You only reach for the recursive bound when **type identity matters** at the call site.

### 3. Accept explicit instantiation

When inference fails, write `Foo[T1, T2](args)`. Yes, it is uglier, but predictable.

### 4. Encode state in separate types

For typestate-style fluent APIs, use distinct types per stage:

```go
type Empty struct{}
type WithName struct{ Name string }
type Submitted struct{ Order Order }
```

Methods transition between types: `func (Empty) WithName(n string) WithName`. No recursion needed — the type system enforces the chain naturally.

### 5. Accept verbosity

Sometimes the cleanest answer is `[T Cloner[T], U Comparable[U]]` — long but explicit.

---

## Designing public APIs with recursive bounds

Recursive constraints are **strong signals** to library users. A function `func DupAll[T Cloner[T]]` says: "your type must implement Clone returning itself". Two consequences:

### 1. Documentation cost

You cannot rely on godoc to explain F-bounded polymorphism. Add a worked example:

```go
// DupAll clones every element of xs.
//
// Each T must implement a Clone method that returns its own type:
//
//   type User struct{ Name string }
//   func (u User) Clone() User { return User{u.Name} }
//
// Then DupAll([]User{...}) returns []User with each element cloned.
func DupAll[T Cloner[T]](xs []T) []T { ... }
```

### 2. API stability

Once published, changing `Cloner[T]` (adding a method) breaks every implementer. Treat recursive interfaces like sealed contracts.

### 3. Multiple recursive constraints in one signature

```go
func Process[T Cloner[T], U Mergeable[U]](xs []T, ys []U) (T, U) { ... }
```

Each parameter has its own recursion. Readers parse it slowly. Use **named constraints** to soften:

```go
type Self[T any] interface { Clone() T }
type Combiner[T any] interface { Combine(other T) T }

func Process[T Self[T], U Combiner[U]](xs []T, ys []U) (T, U) { ... }
```

The named constraints make the intent clearer at the call site.

---

## When to abandon the pattern

A senior engineer recognises when **not** to push recursive constraints further:

1. **The user audience does not know F-bounded polymorphism.** Education cost outweighs benefit.
2. **Inference fails repeatedly.** If callers must instantiate explicitly every time, the abstraction is leaking.
3. **The same logic is needed for heterogeneous types.** Use a non-recursive interface; let callers assert if they need the concrete type.
4. **Compiler errors are unreadable.** Sometimes Go's error messages on recursive constraints are very long. A simpler design is worth the duplication.
5. **The constraint is changing rapidly.** Recursive interfaces are sticky — every change breaks every implementer.

A real-world heuristic from Go community discussions: **introduce a recursive bound only when the same pattern has appeared in three independent places**. The "rule of three" applies even more strictly here than for ordinary generics.

---

## Summary

Go's recursive type constraints — F-bounded polymorphism — are a powerful but bounded feature. **One layer** of self-reference works smoothly; deeper nesting hits compiler limits. Inference handles the common shapes but fails when type parameters appear only inside the constraint. Methods cannot carry their own type parameters, so most recursive operations live as free functions.

A senior engineer designs with these limits in mind:

1. Keep recursion **shallow** — one layer is the sweet spot.
2. Move recursive operations to **free functions**, not methods.
3. Accept **explicit instantiation** when inference fails.
4. Document the pattern; it is unfamiliar to most readers.
5. Avoid recursive bounds when typestate or heterogeneous collections are the real need.

The pattern shines for self-cloning, self-comparing, and fluent builders. Outside those niches, plain interfaces, hand-rolled per-type code, or typestate machines are usually a better fit.

Move on to `professional.md` to see how real codebases — mocking frameworks, ORMs, fluent APIs — actually use these constraints in production.

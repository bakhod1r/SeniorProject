# Type Inference — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Three Inference Phases](#the-three-inference-phases)
3. [Function Argument Type Inference (FTAI)](#function-argument-type-inference-ftai)
4. [Constraint Type Inference](#constraint-type-inference)
5. [Untyped Constants and Default Types](#untyped-constants-and-default-types)
6. [Named Types vs Unnamed Types in Unification](#named-types-vs-unnamed-types-in-unification)
7. [Partial Type Inference](#partial-type-inference)
8. [Evolution Across Go Versions](#evolution-across-go-versions)
9. [Worked Examples](#worked-examples)
10. [Pitfalls Middle-Level Engineers Hit](#pitfalls-middle-level-engineers-hit)
11. [Practical Heuristics](#practical-heuristics)
12. [Summary](#summary)

---

## Introduction

You have written a few generic functions, and most of the time `Map`, `Filter`, and `Reduce` work without type-argument brackets. Now it is time to understand the rules in enough depth to *predict* whether a new function you are designing will infer cleanly. This file tightens the screws: what inference does in detail, where it changed in Go 1.21 and 1.22, and how to read the error messages.

By the end you will be able to:
- List the inference phases and what each one contributes.
- Reason about untyped-constant behaviour mixed with typed arguments.
- Decide when partial type arguments are useful.
- Spot when a signature like `func F[A, B any](b B) A` will never infer.

---

## The Three Inference Phases

Go's type inference happens in conceptually three phases, applied in a fixed order:

1. **Type argument substitution** — any explicit `[A, ...]` brackets the caller supplied.
2. **Function argument type inference (FTAI)** — match function-argument types against parameter types and unify.
3. **Constraint type inference** — examine each constraint and derive remaining unknowns from constraint shape.

Phases 2 and 3 alternate until either all type parameters are known or no progress can be made. Phase 3 may unlock more substitutions that phase 2 then uses, and vice versa.

```
[explicit args] ─▶ [FTAI]  ⇄  [constraint]  ─▶ done or error
```

---

## Function Argument Type Inference (FTAI)

### Mechanism
For each (parameter type, argument type) pair the compiler runs **type unification** — it walks the structure of both types in parallel, recording substitutions for each type parameter as it encounters them.

```go
func F[T any](x T) {}

F(42) // unify(T, int) → T = int
```

For composite types unification descends into structure:

```go
func F[T any](xs []T) {}
F([]int{1,2,3}) // unify([]T, []int) → T = int
```

Maps, channels, function types, pointers, structs all unify by walking matched components.

### Multi-argument unification
When the same `T` appears in multiple parameter positions, unification must be consistent.

```go
func Equal[T comparable](a, b T) bool { return a == b }
Equal(1, 2)        // a→int, b→int, T=int OK
Equal(1, "x")      // a→int, b→string, conflict
```

### Failure modes
- **No information**: a type parameter does not appear in any parameter position.
- **Conflict**: two parameters force different bindings for the same type parameter.
- **Shape mismatch**: argument is `func(int)` where `func(T,U)` is expected.

---

## Constraint Type Inference

Constraint type inference looks at the *shape* of constraints and may pin down unknown type parameters.

### Core type extraction
A constraint's *core type* is the underlying type shared by all members of the type set, if any.

```go
type SliceLike interface {
    ~[]int | ~[]string
}
```

This has no single core type, so constraint inference cannot help. But:

```go
type IntSliceLike interface {
    ~[]int
}
```

has core type `[]int`, allowing inference to resolve types unified against any `T` constrained by `IntSliceLike`.

### Slice/element pattern
The most common case is the dual-parameter slice pattern:

```go
func First[S ~[]E, E any](s S) E {
    return s[0]
}

First([]int{1, 2}) // FTAI: S = []int. Constraint: ~[]E → E = int.
```

Without constraint inference you would need `First[[]int, int]([]int{1,2})`. Constraint inference saves this.

### Map/key/value pattern
```go
func Keys[M ~map[K]V, K comparable, V any](m M) []K {
    out := make([]K, 0, len(m))
    for k := range m { out = append(out, k) }
    return out
}

Keys(map[string]int{"a":1}) // M = map[string]int → K = string, V = int
```

### When core type does not exist
If a constraint mixes incompatible underlying types, no core type exists and constraint inference yields nothing for that step.

```go
type Mixed interface { ~int | ~string }
// no core type — inference must come purely from FTAI.
```

---

## Untyped Constants and Default Types

Untyped constants are a recurring source of confusion. The rules:

1. An **untyped constant** has a default type (e.g., `int` for `1`, `float64` for `1.0`, `string` for `"hi"`, `bool` for `true`).
2. If a typed value participates in unification with an untyped constant, the typed value's type wins, *provided* the constant is representable in that type.
3. If only untyped constants participate, the default type applies.

```go
func Add[T int | float64](a, b T) T { return a + b }

var x int32 // typed
// Add(x, 1) — In Go 1.18 this could fail because int32 is not in [int|float64].
// In Go 1.21 the typed value still must satisfy the constraint, so this is still an error.
// (Inference rules changed; constraint satisfaction did not.)
```

```go
func Max[T int | float64](a, b T) T { /* ... */ }

Max(1, 2)            // both untyped int → T = int
Max(1.0, 2)          // 1.0 is untyped float, 2 is untyped int. Combined default → float64.
Max(int64(1), 2)     // 1.18: error (int64 ∉ T). Same in 1.21.
Max(int(1), 2)       // T = int.
```

### Untyped + only-return type parameters
```go
func Make[T int | float64](_ int) T { var z T; return z }
// Make(0) — what is T? The argument doesn't pin T. Compiler errors with
// "cannot infer T" — defaulting only happens when an untyped constant is
// being unified with the type parameter.
Make[int](0) // OK
```

---

## Named Types vs Unnamed Types in Unification

This is the source of many "but it's the same shape!" surprises.

```go
type MyInt int

func Max[T int | float64](a, b T) T { /* ... */ }
var m MyInt = 1
Max(m, m) // ERROR: MyInt is not in T's type set.
```

The fix is to use the `~` token in the constraint:

```go
func Max[T ~int | ~float64](a, b T) T { /* ... */ }
Max(m, m) // OK: T = MyInt
```

Unification matches *types*, not "kind-of-the-same". A `[]int` and a `MyIntSlice` defined as `type MyIntSlice []int` are different from the inference algorithm's perspective when no `~` is present.

When `~[]E` appears, the slice operand can be any type whose underlying type is `[]E`, and `E` is inferred accordingly.

```go
type IDs []int
func First[S ~[]E, E any](s S) E { return s[0] }
First(IDs{10,20}) // S = IDs, E = int — works because of ~[]E.
```

---

## Partial Type Inference

Sometimes you want to provide *some* type arguments but let the rest be inferred. Go supports this:

```go
func Convert[Out, In any](x In) Out {
    return any(x).(Out)
}

// Provide Out explicitly; let In infer:
y := Convert[float64](42) // Out = float64; In inferred = int
```

Rules:
- You may supply a prefix of the type arguments. The remaining parameters are inferred from the rest of the call.
- You cannot skip earlier parameters and provide later ones in positional form.
- Partial instantiation is great for "result type" cases like `Convert[Out]`.

Practical pattern:
```go
func Get[V any](key string) (V, error) { /* ... */ }
v, err := Get[*User]("user:42")
```

Here `V` would be unsupplied with no inference clue, so naming it explicitly is the API design choice. Putting the explicit parameter first lets callers write `Get[T](...)` cleanly.

---

## Evolution Across Go Versions

Inference rules have evolved. Knowing what changed protects you from "it works on my laptop" surprises.

### Go 1.18 (initial release)
- FTAI on parameter list.
- Constraint type inference for core types.
- Conservative untyped-constant handling.
- Inference *did not* descend into function-typed arguments deeply.

Common surprise:
```go
// 1.18: fails. 1.21+: succeeds (function-shape inference improved).
Map([]int{1,2,3}, strconv.Itoa)
```

### Go 1.19 / 1.20
- Mostly bug fixes; inference behaviour did not change substantially.

### Go 1.21
- **Major** inference improvements.
- Better unification with **named types**.
- Better handling of **untyped constants** in mixed positions.
- More cases where type parameters are derived from function argument *signatures*.
- Improved error messages.
- Spec rewrite of the inference section.

Examples that work in 1.21 but not in 1.18:
```go
type IntSlice []int
func Sum[S ~[]E, E int](s S) E { /* ... */ }
Sum(IntSlice{1,2}) // 1.18: sometimes failed; 1.21: works.
```

```go
func Map[T, U any](s []T, f func(T) U) []U { /* ... */ }
Map([]int{1,2,3}, strconv.Itoa)             // 1.21: works; 1.18: failed.
```

### Go 1.22
- Further refinements; particularly around untyped-constant unification.
- Improved error messages naming the unification step that failed.
- The `cmp` package added in 1.21 (`cmp.Ordered`) is widely usable now.

### Go 1.23 / 1.24 (later)
- Iterator generics and `range func(yield func(T) bool)` interplay with inference.
- Inference works with the iterator function's element type.

### Practical recommendation
- Set `go 1.21` or higher in `go.mod` to get modern inference.
- If you must support 1.18, write more explicit instantiations and avoid relying on function-shape inference for multi-arg signatures.

---

## Worked Examples

### Example 1: Why does Map(s, fmt.Sprint) fail?
```go
func Map[T, U any](s []T, f func(T) U) []U { /* ... */ }

Map([]int{1, 2, 3}, fmt.Sprint)
```

Step-by-step:
- `s` has type `[]int` → unify `[]T` with `[]int` → `T = int`.
- `f` has type `func(...any) string`.
- Compiler tries to unify `func(T) U` with `func(...any) string`.
- The arities and the variadic-vs-fixed shape do not match.
- Error: cannot use `fmt.Sprint` (value of type `func(...any) string`) as type `func(int) U` in argument to `Map`.

The fix is a wrapper:
```go
Map([]int{1, 2, 3}, func(x int) string { return fmt.Sprint(x) })
```

### Example 2: Inference through a method value
```go
type Greeter struct{}
func (g Greeter) Greet(name string) string { return "Hi " + name }

func Apply[T, U any](x T, f func(T) U) U { return f(x) }

g := Greeter{}
Apply("Anna", g.Greet) // method value g.Greet has type func(string) string.
                        // T = string, U = string. Works.
```

### Example 3: A signature that cannot infer
```go
func New[T any]() T { var z T; return z }
// New() is unsolvable — T appears nowhere except return.
```

### Example 4: Reduce with init giving a different type
```go
func Reduce[T, U any](s []T, init U, f func(U, T) U) U {
    acc := init
    for _, v := range s { acc = f(acc, v) }
    return acc
}

total := Reduce([]int{1,2,3}, 0.0, func(acc float64, x int) float64 {
    return acc + float64(x)
})
// T = int (from s), U = float64 (from init), f = func(float64,int) float64
fmt.Println(total) // 6
```

### Example 5: Constraint inference unlocks FTAI
```go
type Number interface { ~int | ~float64 }

func Pair[T Number](a, b T) [2]T { return [2]T{a, b} }
// FTAI alone determines T = int (or float64).

func WithSlice[S ~[]E, E Number](s S) (E, E) {
    var lo, hi E = s[0], s[0]
    for _, v := range s {
        if v < lo { lo = v }
        if v > hi { hi = v }
    }
    return lo, hi
}
WithSlice([]float64{3.1, 2.5, 4.0}) // S = []float64, E = float64
```

### Example 6: Channel parameter
```go
func Drain[T any](ch <-chan T) []T {
    var out []T
    for v := range ch { out = append(out, v) }
    return out
}

ch := make(chan int)
close(ch)
Drain(ch) // T inferred = int
```

### Example 7: Pointer parameter
```go
func Set[T any](p *T, v T) { *p = v }

var n int
Set(&n, 42) // T = int
```

### Example 8: Struct field unification
```go
type Pair[A, B any] struct { First A; Second B }

func MakePair[A, B any](a A, b B) Pair[A, B] { return Pair[A, B]{a, b} }

p := MakePair(1, "hello") // A = int, B = string
_ = p
```

---

## Pitfalls Middle-Level Engineers Hit

### Pitfall 1: Returning typed nil
```go
func Find[T any](s []T, pred func(T) bool) *T {
    for i, v := range s { if pred(v) { return &s[i] } }
    return nil
}
// Inference of T: from s. OK.
```

### Pitfall 2: Generic function value
```go
var f func([]int, func(int) string) []string = Map[int, string]
// Without explicit instantiation Map cannot be assigned: it is generic, not a concrete function.
```

### Pitfall 3: Method-set inference confusion
You cannot infer the receiver type of a generic struct's method from method-set membership alone; you need the value.
```go
type Box[T any] struct{ v T }
func (b Box[T]) Get() T { return b.v }

box := Box[int]{v: 7}
_ = box.Get() // here T is taken from the *type* Box[int], not inferred at the call site.
```

### Pitfall 4: Mixing untyped and named typed
```go
type Celsius float64
var c Celsius = 36.6
Max(c, 37.0) // 37.0 is untyped float; can it become Celsius?
              // Yes — 37.0 is representable as Celsius. T = Celsius.
```

### Pitfall 5: Variadic with no args
```go
func Sum[T int | float64](xs ...T) T { /* ... */ }
Sum() // FAILS: nothing to look at. Pass at least one element or annotate.
Sum[int]() // OK.
```

### Pitfall 6: Pointer-to-generic
```go
func F[T any](*T) {}
// F(nil) — fails: nil has no type information.
F[int](nil) // OK
```

### Pitfall 7: Map with key/value reversed
```go
func Invert[K, V comparable](m map[K]V) map[V]K { /* ... */ }
// Inference works fine: K and V both come from the map type. Just be sure
// V is comparable (constraint satisfied).
```

---

## Practical Heuristics

1. **Anchor every parameter.** Make sure each `T` appears in at least one parameter (preferably the first).
2. **Slices first.** `[]T` carries `T` and (with `~[]E`) the element type.
3. **Wrap variadic-any helpers.** Replace `fmt.Sprint` with a `func(int) string` lambda.
4. **Use `cmp.Ordered`.** Available in Go 1.21+ from `cmp`.
5. **Name explicit-only parameters first.** If a parameter must be supplied by the caller, list it first so partial instantiation reads naturally: `Get[*User]("k")`.
6. **Test with the lowest Go version your module supports.** Inference upgrades are silent but real.
7. **Read errors top-to-bottom.** Modern errors will name the parameter that failed and the unification step that broke.

---

## Summary

Type inference is a multi-phase algorithm: explicit instantiation, FTAI via type unification, and constraint type inference. It cooperates with untyped-constant defaulting and benefits from `~T` constraints to handle named types. Go 1.21 was the breakpoint where inference became powerful enough that most idiomatic generic code *just works* at the call site. Designing APIs with inference in mind — anchoring every parameter, putting slices first, listing explicit-only parameters first — lets your callers write generic Go that reads as cleanly as ungeneric Go.

# Type Constraints — Interview Questions

## Table of Contents
1. [Junior Questions (1-10)](#junior-questions-1-10)
2. [Middle Questions (11-20)](#middle-questions-11-20)
3. [Senior Questions (21-30)](#senior-questions-21-30)
4. [Tricky / Edge Cases (31-35)](#tricky-edge-cases-31-35)
5. [Coding Tasks](#coding-tasks)

---

## Junior Questions (1-10)

### Q1. What is a type constraint?

A type constraint is an interface that limits which concrete types can be supplied as a type argument to a generic function or generic type. It is what tells the compiler which operations are valid on the type parameter inside the body. Constraints can describe required methods, required types via union (`|`), or required underlying types via `~`.

### Q2. What is the difference between `any` and `comparable`?

`any` is an alias for `interface{}` and matches every Go type, but inside the function you cannot use any operator. `comparable` matches every type that supports `==` and `!=`. `comparable` is strictly narrower than `any` (slices, maps, and functions satisfy `any` but not `comparable`).

### Q3. What does `~int` mean in a constraint?

`~int` is the **approximation** type term. It matches `int` and every defined type whose underlying type is `int`. So `type UserID int` satisfies `~int` even though it is a distinct type from `int`.

### Q4. Where does the `constraints` package live?

`golang.org/x/exp/constraints`. As of Go 1.21+, it has not moved into the standard library. You import it via:

```go
import "golang.org/x/exp/constraints"
```

### Q5. What is `constraints.Ordered`?

It is the constraint of any type that supports `<`, `<=`, `>`, `>=`. Its type set is `~int`-shaped, `~uint`-shaped, `~float`-shaped, and `~string`. Complex numbers are excluded (no ordering).

### Q6. What is the difference between `int` and `~int` in a constraint?

`int` matches **only** the predeclared `int`. `~int` matches `int` and every defined type whose underlying type is `int`. Use `~int` in libraries; use `int` only when you specifically want to reject newtype wrappers.

### Q7. Why isn't `comparable` the same as `any`?

Because not every Go type supports `==`. Slices, maps, and functions are not comparable. `any` accepts every type; `comparable` accepts only the comparable subset.

### Q8. Can a constraint contain methods AND type elements?

Yes. The type argument must satisfy both halves: it must be in the type set described by the type elements **and** it must have all the methods listed.

```go
type Stringy interface {
    ~int | ~float64
    String() string
}
```

### Q9. When do you reach for `constraints.Ordered` vs writing your own?

Use `constraints.Ordered` whenever you need ordered semantics (`<`, `>`, etc.) and you can depend on `golang.org/x/exp`. Write your own only when you need a strictly different type set (e.g., excluding strings, including complex).

### Q10. What is the type set of `any`?

The type set of `any` is **every Go type**. That is the universal type set.

---

## Middle Questions (11-20)

### Q11. What is a "general interface" and why can't it be used as a value?

A general interface is an interface that contains at least one type element (union or `~`). Such an interface cannot be implemented by an arbitrary runtime value because its type set restricts the concrete identity of the value, which is a compile-time property. You can use a general interface only as a type constraint.

### Q12. What is the type set of `interface{ int | string }`?

Exactly two elements: `{int, string}`. No other types satisfy this constraint.

### Q13. What is the type set of `interface{ ~int; M() }`?

The intersection: every type whose underlying type is `int` **and** that has a method `M()`. For example `type Money int` with a `func (m Money) M() {}` would satisfy.

### Q14. What does it mean for a constraint to have a "core type"?

A constraint has a core type `U` when every type in its type set has the same underlying type `U`. If a core type exists, operations of `U` are available on the type parameter. If not, only operations supported by all types in the set are available.

### Q15. Can you use `==` inside a generic function constrained by `any`?

No. `any` has no operations; you'd have to convert to `any` and type-assert, which is tedious and error-prone. Use `comparable` instead if you need equality.

### Q16. What does the union operator distribute over?

Nothing — there is no distribution. Union is a flat list of type terms. You cannot write `(int | float) | string` with parentheses; just write `int | float | string`.

### Q17. Can a type term inside a union be an interface?

No. The type term must be a non-interface type or a `~`-prefixed non-interface type. You cannot say `int | Stringer`.

### Q18. How do you compose two constraints?

Embed one inside the other. The result is the **intersection** of their type sets.

```go
type A interface { ~int | ~float64 }
type B interface { String() string }
type C interface { A; B }   // ~int|~float64 AND has String()
```

### Q19. What happens if a constraint's type set is empty?

The constraint declaration is legal but useless: no type argument satisfies it. Every call site that tries to instantiate the generic will fail to compile.

### Q20. What is `constraints.Signed`?

A constraint matching all signed integer types: `~int | ~int8 | ~int16 | ~int32 | ~int64`.

---

## Senior Questions (21-30)

### Q21. What changed about `comparable` in Go 1.20?

Go 1.20 expanded `comparable` to also include interface types (including `any`). Before 1.20, you could not write `Set[any]`. Starting with 1.20 you can — but the runtime comparison may panic if the dynamic type is not comparable.

### Q22. How does Go monomorphize generics?

Via **GC-shape stenciling**: types with the same memory layout share one compiled function body, with a runtime dictionary providing per-type metadata. This trades off code size against runtime cost. For pure type-element constraints with simple shapes, the result is close to hand-written code.

### Q23. What is the cost of a method element in a constraint?

A method element forces method dispatch through the runtime dictionary, similar to interface method calls. In tight loops this can be slower than a pure type-element constraint where operators map directly to machine instructions.

### Q24. How would you design a "Hashable" constraint that is safer than `comparable`?

Define an explicit union of types that cannot panic at runtime:

```go
type Hashable interface {
    ~int | ~int64 | ~uint | ~uint64 | ~string | ~bool
}
```

This excludes structs (which may contain non-comparable fields) and interfaces (which may hold non-comparable dynamic values).

### Q25. Why might you prefer to re-export constraints from `x/exp`?

To insulate your codebase from the dependency. If `x/exp/constraints` ever moves into the standard library or its location changes, you have only one file to update. Plus, it gives you a single audited surface for new type sets.

### Q26. Can a constraint be parameterised by another type parameter?

No. Type parameters cannot themselves be used inside constraint type elements. You can use them in interface method signatures, but not as type terms.

### Q27. How do you handle the "I want exactly `int`, no newtypes" case?

Drop the `~`: write the constraint as `int` rather than `~int`. Document the choice — it's restrictive and surprising.

### Q28. What are the design implications of constraints in a public API?

Constraints become part of your stable surface. Adding a type to a union is non-breaking; removing one is breaking. Adding a method element is breaking. Always document the type set in godoc.

### Q29. How do you write a constraint that allows only types whose representation is `[]byte`?

```go
type BytesLike interface { ~[]byte }
```

`type Buffer []byte` and `type Payload []byte` both satisfy this; `string` does not.

### Q30. What's the difference between a method element and an interface embedding inside a constraint?

A method element directly lists a method requirement. Interface embedding pulls in all the elements of the embedded interface. Embedding a basic interface adds method elements; embedding a general interface adds type elements (and method elements if any). Both produce the same effect: an intersection.

---

## Tricky / Edge Cases (31-35)

### Q31. Why does `interface{ int; string }` (semicolon, not pipe) compile to an empty type set?

Semicolon between type elements means **intersection**. `int` and `string` cannot both be a type's identity. The intersection is empty. Compiler accepts the declaration but rejects every type argument at instantiation.

### Q32. Can pointer types appear in a type-element union?

Yes: `*int | *string` is legal. Used rarely; mostly for low-level libraries where pointer identity matters.

### Q33. If a method is defined on `*T` (pointer receiver), does `T` satisfy a constraint that requires the method?

No. Only `*T` satisfies it. The constraint enforces the method set, and value `T`'s method set does not include pointer-receiver methods.

### Q34. What is `interface{ ~[]byte | ~string }` and what operators does it allow?

Type set: every type whose underlying type is `[]byte` plus every type whose underlying type is `string`. There is no core type (different underlying types). Common operators that work on **both**: indexing, slicing, `len()`, range. `+=` works for `string` but not `[]byte` (slices need `append`), so concatenation does not work via `+=` on this constraint.

### Q35. Why must `~T` use a type whose underlying type is itself?

Because `~` describes "underlying type equals". Saying `~Foo` where `Foo` is a defined type would be ambiguous: do you mean "underlying type of `Foo`" or "underlying type is the underlying type of `Foo`"? The spec resolves this by requiring `~T` to use a type that is its own underlying type — predeclared types or unnamed type literals.

---

## Coding Tasks

### Task 1
Write a constraint `Numeric` that includes all integers and all floats, accepting newtype wrappers, and a function `Sum` that sums a slice of `Numeric`.

```go
type Numeric interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
        ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
        ~float32 | ~float64
}

func Sum[T Numeric](xs []T) T {
    var s T
    for _, x := range xs {
        s += x
    }
    return s
}
```

### Task 2
Write `Min[T constraints.Ordered](xs []T) T`, returning the smallest element.

```go
import "golang.org/x/exp/constraints"

func Min[T constraints.Ordered](xs []T) T {
    m := xs[0]
    for _, x := range xs[1:] {
        if x < m {
            m = x
        }
    }
    return m
}
```

### Task 3
Define `Set[T comparable]` with `Add`, `Has`, `Remove`.

```go
type Set[T comparable] map[T]struct{}

func NewSet[T comparable]() Set[T] { return Set[T]{} }
func (s Set[T]) Add(v T)            { s[v] = struct{}{} }
func (s Set[T]) Has(v T) bool       { _, ok := s[v]; return ok }
func (s Set[T]) Remove(v T)         { delete(s, v) }
```

### Task 4
Write a constraint `Stringer` that requires `String() string` and a function `JoinAll[T Stringer]` that returns space-separated string output.

```go
type Stringer interface { String() string }

func JoinAll[T Stringer](xs []T) string {
    parts := make([]string, len(xs))
    for i, x := range xs {
        parts[i] = x.String()
    }
    return strings.Join(parts, " ")
}
```

### Task 5
Write `Map[T, U any](xs []T, f func(T) U) []U`.

```go
func Map[T, U any](xs []T, f func(T) U) []U {
    out := make([]U, len(xs))
    for i, x := range xs {
        out[i] = f(x)
    }
    return out
}
```

### Task 6
Write a constraint that requires both `~int64` and a `Validate() error` method, and a function `ValidatedSum`.

```go
type ValidatedNum interface {
    ~int64
    Validate() error
}

func ValidatedSum[T ValidatedNum](xs []T) (T, error) {
    var s T
    for _, x := range xs {
        if err := x.Validate(); err != nil {
            return 0, err
        }
        s += x
    }
    return s, nil
}
```

### Task 7
Write a generic `LRU[K, V]` with `K constraints.Hashable` (define `Hashable` yourself).

```go
type Hashable interface {
    ~int | ~int64 | ~uint | ~uint64 | ~string
}

type LRU[K Hashable, V any] struct { ... }
```

### Task 8
Implement `Clamp[T constraints.Ordered](x, lo, hi T) T`.

```go
func Clamp[T constraints.Ordered](x, lo, hi T) T {
    if x < lo {
        return lo
    }
    if x > hi {
        return hi
    }
    return x
}
```

### Task 9
Show why `interface{ int; string }` is unsatisfiable.

```go
type Impossible interface {
    int
    string
}

// No type can be both int and string. Intersection is empty.
// func F[T Impossible]() {}   // any call site fails:
//   F[int]()    // ❌ int is not in the type set of string
//   F[string]() // ❌ string is not in the type set of int
```

### Task 10
Write a constraint with two type elements that have **disjoint** sets, and explain.

```go
type IntsOrFloats interface {
    constraints.Integer | constraints.Float
}
// The two layers are disjoint by construction (no integer is a float
// in Go's type system) so the union is well-defined and useful.
```

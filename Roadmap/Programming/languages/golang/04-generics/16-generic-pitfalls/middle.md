# Generic Pitfalls — Middle Level

## Table of Contents
1. [The mid-level taxonomy](#the-mid-level-taxonomy)
2. [Type-switch limitations and workarounds](#type-switch-limitations-and-workarounds)
3. [Pointer vs value generics](#pointer-vs-value-generics)
4. [Comparing zero when T is not comparable](#comparing-zero-when-t-is-not-comparable)
5. [Constraint mismatch with body operations](#constraint-mismatch-with-body-operations)
6. [Inference failures around function types](#inference-failures-around-function-types)
7. [Mixing methods and type elements in constraints](#mixing-methods-and-type-elements-in-constraints)
8. [Recap and takeaway](#recap-and-takeaway)

---

## The mid-level taxonomy

The junior pitfalls are about syntax and zero values. The middle pitfalls are about **shape**: the shape of `T`, the shape of constraints, and the shape of your function arguments. Each of the following is a category that swallows hours when first encountered:

1. You cannot type-switch on `T` directly — and even when you do via `any`, you usually meant something else.
2. You want a function that accepts both `*T` and `T` — Go does not give you a clean way.
3. You want to know "is this `T` empty" but `T` is a `[]X` (not comparable).
4. Constraints look right but your body does an operation the constraint does not allow.
5. Function-typed parameters confuse type inference in subtle ways.
6. Constraints that mix methods and type elements have surprising satisfaction rules.

We dig into each.

---

## Type-switch limitations and workarounds

### Why direct type switch fails

```go
func Describe[T any](v T) string {
    switch v.(type) { // ❌
    case int:
        return "int"
    }
    return "other"
}
```

The Go spec says type assertions and type switches require **interface** types. `T` is a type parameter; until instantiation, it has no method set. The compiler refuses.

### The `any(v)` trick

```go
func Describe[T any](v T) string {
    switch x := any(v).(type) {
    case int:
        return fmt.Sprintf("int %d", x)
    case string:
        return fmt.Sprintf("string %q", x)
    default:
        return "?"
    }
}
```

This compiles. It also has costs:

- `any(v)` boxes the value if `T` is not pointer-shaped — a heap allocation for small `T`.
- The type switch is a runtime lookup.
- The compiler cannot inline the cases.

If your code does this on every call, you have re-invented `interface{}` with extra steps.

### When type-switch on `T` is justified

Rare cases:

- **Encoding helpers** that fall back to a special path for primitives.
- **Logging / debug output** that wants type-aware printing.
- **Backwards compatibility shims** during a migration.

Otherwise, the existence of a type switch on `T` is a sign you have **polymorphism**, not parameterism. Use an interface.

### Signs of a misused type switch

```go
func Process[T any](v T) {
    switch any(v).(type) {
    case Dog: ...
    case Cat: ...
    }
}
```

This is an interface in disguise. The fix:

```go
type Animal interface { Process() }
func Process(a Animal) { a.Process() }
```

Each animal implements `Process` differently — that is **polymorphic behaviour**, not generic parameterism. Do not reach for generics.

### A useful pattern: type switch as a fast path

```go
func Marshal[T any](v T) ([]byte, error) {
    switch x := any(v).(type) {
    case []byte:
        return x, nil
    case string:
        return []byte(x), nil
    }
    return json.Marshal(v)
}
```

Here the type switch is an **optimization**, not the contract. The function still works for any `T`; it just skips JSON for two common cases. Acceptable use.

---

## Pointer vs value generics

A common middle-grade question: how do you write a generic function that accepts both `T` and `*T`?

### The naive attempt

```go
func Describe[T any](v T) string {
    return fmt.Sprintf("%v", v)
}

Describe(42)        // OK — T = int
Describe(&42)       // not valid syntax
ptr := 42; Describe(&ptr) // OK — T = *int
```

Each call pins `T` to a different concrete type. The same function body runs, but the compiler stencils two bodies — one for `int`, one for `*int`. So `Describe` already accepts both, just with different `T`s.

### The pitfall: dereferencing inside

```go
func Length[T any](v T) int {
    return len(*v) // ❌ — T is not necessarily a pointer
}
```

You cannot generically dereference. Fix by constraining:

```go
func Length[T any](p *T) int {
    return ... // we have a pointer-only parameter
}
```

or by using a method-bearing constraint.

### Two helper patterns

**Pattern A — separate functions, generic delegate**

```go
func DescribeVal[T any](v T) string  { return describe(v, v) }
func DescribePtr[T any](p *T) string { return describe(p, *p) }
```

Two entry points, one shared body.

**Pattern B — pointer-or-value via interface**

```go
type Anything[T any] interface { *T | T }
func Describe[T any, A Anything[T]](a A) string { ... }
```

This compiles in newer Go versions but is hard to read. Most teams reject it in code review.

### The deeper issue: methods on `T` vs `*T`

If you constrain `T` to require a method, only one of `T` or `*T` may satisfy:

```go
type HasName interface { Name() string }

type User struct{ name string }
func (u *User) Name() string { return u.name } // pointer receiver

func PrintName[T HasName](v T) { fmt.Println(v.Name()) }

PrintName(User{})    // ❌ — User does not satisfy (pointer method)
PrintName(&User{})   // ✓
```

A junior thinks "User has a Name method", but the spec says `Name` belongs to `*User`'s method set, not `User`'s. The fix is to call with `&u` or to make `Name` a value-receiver method.

### Workaround: explicit `*T` in the constraint

When you need both:

```go
type Nameable[T any] interface {
    *T
    Name() string
}

func PrintName[T any, P Nameable[T]](p P) { fmt.Println(p.Name()) }
```

Now `P` is `*T` for some `T`, and `Name` is required. Callers must use the pointer form. This pattern shows up in serialization libraries.

---

## Comparing zero when T is not comparable

```go
func IsZero[T comparable](v T) bool {
    var zero T
    return v == zero
}
```

Works. But what if `T` is `[]int` or `map[string]int` or a struct containing a slice? Those are not `comparable`. The `IsZero` above does not even compile for them.

### Workaround 1 — `reflect.DeepEqual`

```go
func IsZeroAny[T any](v T) bool {
    var zero T
    return reflect.DeepEqual(v, zero)
}
```

Works for everything, but slow and uses reflection. Acceptable for cold paths.

### Workaround 2 — `len` for slices and maps

If you know `T` is a slice or map kind:

```go
func IsEmptySlice[T any](s []T) bool { return len(s) == 0 }
func IsEmptyMap[K comparable, V any](m map[K]V) bool { return len(m) == 0 }
```

Specialise per kind.

### Workaround 3 — caller responsibility

Don't bake "is this empty" into the generic helper. Let the caller pass a predicate:

```go
func DefaultIfZero[T any](v T, isZero func(T) bool, fallback T) T {
    if isZero(v) { return fallback }
    return v
}
```

Verbose but unambiguous.

### Workaround 4 — `comparable` with relaxation in 1.20+

Go 1.20 relaxed `comparable` so that interface types satisfy it (with potential runtime panic):

```go
func IsZero[T comparable](v T) bool {
    var zero T
    return v == zero
}

var x any = 42
fmt.Println(IsZero(x)) // works in 1.20+
```

But `[]int` is still not comparable; that hasn't changed. Slices and maps remain `==`-incompatible.

### Why this is a pitfall, not a limitation

It is a pitfall because juniors instinctively reach for `IsZero[T comparable]` and then watch the compiler refuse `IsZero([]int{})`. The right answer depends on what kind of "zero" you mean — and Go's comparability rules force you to be explicit.

---

## Constraint mismatch with body operations

A common middle-tier mistake:

```go
func Sum[T any](s []T) T {
    var total T
    for _, v := range s { total += v } // ❌
    return total
}
```

`+` is not in `any`'s permitted operations. Fix:

```go
type Number interface { ~int | ~int64 | ~float32 | ~float64 }

func Sum[T Number](s []T) T { ... }
```

The pitfall is more subtle when the body uses **multiple** operations:

```go
func Range[T any](s []T) (min, max T) {
    if len(s) == 0 { return }
    min, max = s[0], s[0]
    for _, v := range s {
        if v < min { min = v }   // needs cmp.Ordered
        if v > max { max = v }   // needs cmp.Ordered
    }
    return
}
```

You change `any` to `comparable` (because of equality elsewhere), but `<` and `>` need `cmp.Ordered`. The compiler points at the wrong line if you fix one and not the other. Read every operation in the body, then choose the **tightest** constraint that covers all of them.

### The constraint fix-up dance

When you tighten a constraint, you may break callers who previously satisfied the looser one. This is a backwards-incompatible change. Document it.

```go
// v1: T any
func Count[T any](s []T) int { return len(s) }

// v2: T comparable — v1 callers using []func() break
func Count[T comparable](s []T) int { return len(s) }
```

A senior engineer keeps the constraint as loose as possible. A junior tightens too eagerly.

---

## Inference failures around function types

Inference works well when type parameters appear in **value-typed** positions:

```go
func F[T any](v T) T { return v }
F(42) // T inferred as int, easy
```

It struggles when type parameters appear inside **function-typed** positions:

```go
func Apply[T, U any](f func(T) U, v T) U { return f(v) }
Apply(strconv.Itoa, 42) // ✓ — both T and U pinned by arguments
Apply(func(x int) string { return "" }, 42) // ✓
```

OK so far. But:

```go
func Pipeline[T, U, V any](f func(T) U, g func(U) V) func(T) V {
    return func(t T) V { return g(f(t)) }
}

p := Pipeline(strconv.Itoa, func(s string) int { return len(s) })
// works in 1.21+, may fail in 1.18
```

In Go 1.18 inference often refuses these chains because it cannot reason backwards through function shapes. Go 1.21 added improvements that handle most realistic cases. When inference fails, the fix is always: **specify type arguments explicitly**.

### A practical heuristic

If a generic helper takes more than one function parameter, and the type parameters thread through them, expect inference to occasionally fail. Add a one-line example in the godoc showing explicit instantiation as a backup.

---

## Mixing methods and type elements in constraints

```go
type StringerNum interface {
    ~int | ~float64
    String() string
}
```

Looks reasonable. Question: which types satisfy it?

Answer: **none of the predeclared `int` or `float64`** — they have no `String()` method. You'd have to wrap with a named type:

```go
type Quantity int
func (q Quantity) String() string { return fmt.Sprintf("%d", q) }
```

Now `Quantity` satisfies `StringerNum`. The pitfall: many users expect the constraint to be looser than it is. The constraint is a **conjunction**: type set intersect method set.

### The empty-set trap

```go
type Impossible interface {
    ~int
    ~string
}
```

Type set is empty (no type has both underlying-int and underlying-string). The compiler accepts the constraint declaration but no value can ever satisfy it. Some linters (`staticcheck`) flag this; many do not. Be aware.

### The "method on a primitive" trap

```go
type IntStringer interface {
    ~int
    String() string
}
```

The user writes:

```go
var i int = 5
F[int](i) // ❌ — int has no String() method
```

To use `F`, the caller must define `type MyInt int` and add `String()`. That is a real user-experience tax. Use this pattern only when the method is the genuine reason for the abstraction.

---

## Recap and takeaway

A middle-level Go engineer remembers this short list:

1. **Type switches on `T`** require `any(v)` and usually mean you should use an interface.
2. **Pointer vs value** is sharper than it looks; method sets differ between `T` and `*T`.
3. **`comparable` does not include slices, maps, functions** — and `IsZero` does not work for them.
4. **Constraints must allow every operation in the body** — not just one of them.
5. **Inference fails around function types**; specify explicitly when in doubt.
6. **Constraints with both type elements and methods** can have empty type sets.

These are not bugs in Go's design. They are **predictable consequences** of the constraint system. Once you internalise the model — "constraint = type set intersected with method set" — the pitfalls become legible at a glance.

The senior file moves to **implementation-level** pitfalls: implicit boxing into the dictionary path, lost inlining, method sets that quietly accept the wrong types, and reflect-with-generics traps.

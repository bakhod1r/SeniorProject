# Generic Constraints Deep Dive — Middle Level

## Table of Contents
1. [The `~` operator in depth](#the-operator-in-depth)
2. [Union elements `A \| B`](#union-elements-a-b)
3. [Method-set constraints](#method-set-constraints)
4. [Mixing types and methods](#mixing-types-and-methods)
5. [Constraints with multiple terms](#constraints-with-multiple-terms)
6. [Embedding constraints](#embedding-constraints)
7. [Operations the compiler unlocks](#operations-the-compiler-unlocks)
8. [Practical constraint patterns](#practical-constraint-patterns)
9. [Summary](#summary)

---

## The `~` operator in depth

The tilde (`~`) is the single most important constraint operator after `|`. Without it, generic numeric code is almost useless for real programs.

### What `~T` means

> `~T` denotes the set of all types whose **underlying type** is `T`.

The "underlying type" of a defined type is the literal type written on the right-hand side of `type X ...`:

```go
type Celsius float64       // underlying type: float64
type Fahrenheit float64    // underlying type: float64
type ID int                // underlying type: int
type SortedID ID           // underlying type: int  (chases through)
```

Note the chase-through: a `type` declaration whose right-hand side is itself a defined type carries that defined type's underlying type all the way down.

### Without `~`

```go
type OnlyInt interface { int }

type Celsius int
var c Celsius = 5
var i int = 5

func F[T OnlyInt](v T) T { return v }

F(i)  // OK
F(c)  // compile error — Celsius is not int
```

The constraint `int` matches **only** the predeclared `int` type. Defined types are excluded.

### With `~`

```go
type AnyInt interface { ~int }

func G[T AnyInt](v T) T { return v }

G(i)  // OK
G(c)  // OK — Celsius's underlying type is int
```

The tilde widens the type set to include **every** type whose underlying type is `int`.

### Why this matters in practice

Real programs constantly use defined types for clarity:

```go
type UserID int64
type Score float64
type Tag string
```

A `Sum` helper that requires `~int64`, `~float64`, or `~string` works for these domain types. A helper that requires the predeclared types **only** rejects them, forcing callers to convert via `int64(uid)` everywhere.

### Subtleties

- `~int` is **not** the same as `interface{ int }`. The first admits `Celsius`; the second does not.
- `~T` only works when `T` is **not** an interface. `~error` is illegal.
- The underlying type of a struct type is the struct literal itself: `type P struct{ X, Y int }` has underlying type `struct{ X, Y int }`. So `~struct{ X, Y int }` matches only types with **exactly** that field shape.

```go
// Subtle: this is legal
type Point struct { X, Y int }
type Vec struct { X, Y int }

type C interface { ~struct{ X, Y int } }

func F[T C](v T) {}

F(Point{1, 2}) // OK
F(Vec{3, 4})   // OK — same underlying struct
```

This works because both `Point` and `Vec` have the same underlying type. In practice, `~struct{...}` is rarely used; it is mostly an academic curiosity.

---

## Union elements `A | B`

A constraint can list several alternative type terms separated by `|`. The result is the **union** of their type sets:

```go
type IntOrString interface { int | string }

func F[T IntOrString](v T) T { return v }

F(1)         // OK
F("hello")   // OK
F(1.5)       // compile error
```

### Combining `~` with `|`

The two operators compose freely:

```go
type Numeric interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
    ~float32 | ~float64
}
```

Each term is independent. Some terms can be `~T`, others not:

```go
type Mixed interface { int | ~string }
```

This admits the predeclared `int` exactly, plus any type whose underlying type is `string`. Asymmetric, but legal.

### What operations does a union allow?

The compiler lets you use an operator inside the body **only if it is defined for every type in the union, with the same semantics**. So:

```go
func Sum[T int | float64](s []T) T {
    var total T
    for _, v := range s { total += v }
    return total
}
```

`+` works because both `int` and `float64` support it. The compiler does not specialise per type — it generates one body that works for any member of the type set.

The tricky case:

```go
func Concat[T int | string](a, b T) T { return a + b }
```

This compiles. For `int` it adds; for `string` it concatenates. The body is one piece of source, but the **runtime semantics** depend on the instantiation. This is sometimes considered surprising; some linters warn about it.

### Forbidden: mixing types where operations differ

```go
// ❌ Subtraction is not defined for string
func Sub[T int | string](a, b T) T { return a - b }
```

The compiler refuses because `string - string` is undefined.

### Forbidden: incompatible numeric semantics

```go
type C interface { int | float64 }

func Halve[T C](v T) T { return v / 2 }
```

This compiles because both `int` and `float64` support `/`. But beware: integer division and float division behave differently. The body's semantics depend on `T`.

### Empty unions are illegal

```go
type C interface { } // legal — same as `any`
type C2 interface { | } // ❌ — syntax error
```

You always need at least one term (or none, which is `any`).

---

## Method-set constraints

A constraint can require **methods**. This is where constraints look exactly like classic Go interfaces:

```go
type Stringer interface {
    String() string
}

func Print[T Stringer](xs []T) {
    for _, x := range xs { fmt.Println(x.String()) }
}
```

Inside the body, `x.String()` is allowed because the constraint guarantees the method exists.

### How the compiler dispatches

For method-only constraints, the compiler emits a **call through the runtime dictionary** — similar to how interface method dispatch works. The cost is small but non-zero. We dig into this in `optimize.md`.

### Combining methods

```go
type ReadCloser interface {
    Read(p []byte) (int, error)
    Close() error
}

func ReadAll[T ReadCloser](r T) ([]byte, error) {
    defer r.Close()
    return io.ReadAll(r)
}
```

A type satisfies the constraint if it has **all** the listed methods.

---

## Mixing types and methods

The interesting cases happen when a constraint contains **both** type elements and method elements:

```go
type IntStringer interface {
    ~int
    String() string
}
```

To satisfy this constraint, a type must:

1. Have an underlying type of `int`, **and**
2. Have a `String() string` method.

```go
type UserID int
func (u UserID) String() string { return fmt.Sprintf("u/%d", int(u)) }

type OrderID int  // no String method

func F[T IntStringer](v T) string { return v.String() }

F(UserID(7))   // OK
F(OrderID(8))  // compile error — missing String
F(int(9))      // compile error — int has no String method
```

This is the killer feature of Go's constraint system: you can require **both** a structural type shape and a behavioural method set.

### Methods apply to every type in the union

```go
type C interface {
    ~int | ~float64
    String() string
}
```

Every type in the union must have a `String() string` method. So this constraint only matches `~int`-shaped or `~float64`-shaped types **that also implement Stringer**.

If `int` itself does not have a `String()` method (it does not), then this constraint excludes the bare `int` — only **defined types** with the right underlying type and the method qualify.

### A worked example

```go
type Sec int
func (s Sec) String() string { return fmt.Sprintf("%ds", int(s)) }

type Min float64
func (m Min) String() string { return fmt.Sprintf("%.1fmin", float64(m)) }

type Hour int  // no String

type Duration interface {
    ~int | ~float64
    String() string
}

func Format[T Duration](v T) string { return v.String() }

Format(Sec(30))    // "30s"
Format(Min(2.5))   // "2.5min"
Format(Hour(1))    // compile error: Hour has no String
Format(int(1))     // compile error: int has no String
```

This pattern — constraint demanding both shape and behaviour — is one of the most expressive corners of Go generics.

---

## Constraints with multiple terms

A constraint may list several type elements on **separate lines** (or, equivalently, embed several interfaces). Multiple lines mean **intersection**, not union:

```go
type A interface { int | string }
type B interface { int | float64 }

type C interface {
    A
    B
}
```

`C`'s type set is the **intersection** of `A` and `B`: only types in both. `A` is `{int, string}`, `B` is `{int, float64}`, so `C` is `{int}`.

Compare:

```go
type D interface { int | string | float64 }   // union, type set = {int, string, float64}
type E interface { int; string }               // intersection, type set = {} (empty!)
```

This is a frequent source of confusion: the spec uses `;` (or newlines) to list multiple elements, and they are intersected.

```go
type Stringer interface { String() string }
type Numeric interface { ~int | ~float64 }

type StringableNumber interface {
    Numeric
    Stringer
}
```

Here `StringableNumber` is the intersection of `Numeric` and `Stringer`: types whose underlying is `int` or `float64` **and** that implement `String()`.

### Empty type sets

```go
type Impossible interface { int; string }
```

The type set is empty. The constraint compiles, but no value can satisfy it. The compiler does not flag this (yet); some linters do. A function `func F[T Impossible]()` compiles, but you cannot call it.

---

## Embedding constraints

You can embed an interface inside another to compose constraints:

```go
type Comparable interface { comparable }

type Numeric interface { ~int | ~float64 }

type ComparableNumeric interface {
    Comparable
    Numeric
}
```

Embedding is the canonical way to **reuse** a constraint without repeating its body. The Go standard library uses this pattern in `cmp.Ordered` (which is itself just a long `~int | ~int8 | ...` interface that other types embed).

### Embedding `comparable`

```go
type HashKey interface {
    comparable
    Hash() uint64
}
```

A type satisfies `HashKey` if it is `comparable` (works with `==`) **and** has a `Hash() uint64` method.

### Diamond and chains

```go
type A interface { ~int }
type B interface { A; String() string }
type C interface { A; Reset() }
type D interface { B; C }
```

`D` requires everything: `~int`, `String()`, and `Reset()`. Diamond-shaped embedding is fine in Go because there is no inheritance — only set algebra.

---

## Operations the compiler unlocks

A subtle but important fact: the operations you can use inside a generic body depend on what the **constraint** authorises. Here is the cheat sheet for a value `v` of type parameter `T`:

| Operation | Required constraint |
|-----------|---------------------|
| Assignment, return, parameter passing | Always allowed (`any`) |
| `==`, `!=` | `comparable` (or a union all of whose members are comparable) |
| `<`, `<=`, `>`, `>=` | `cmp.Ordered` or a similar union of ordered types |
| `+`, `-`, `*`, `/` | A union all of whose members support that operator |
| Method `m(...)` | The constraint embeds an interface declaring `m` |
| `len(v)`, indexing, range | A union of `~[]E`, `~map[K]V`, `~string`, etc. |
| `make(T, n)` | A constraint guaranteeing T is a slice/map/chan |
| Conversion `T(x)` | The constraint guarantees the conversion |

Concretely:

```go
func Sum[T ~int | ~float64](s []T) T {
    var total T
    for _, v := range s { total += v } // + allowed
    return total
}

func IndexLen[T ~[]E, E any](s T) int {
    return len(s) // len allowed
}

func IndexAt[T ~[]E, E any](s T, i int) E {
    return s[i] // indexing allowed
}
```

The `[T ~[]E, E any]` pattern — two type parameters where one constrains the slice shape and the other names its element — is the canonical way to write generic slice helpers.

---

## Practical constraint patterns

### Pattern 1 — Numeric

```go
type Numeric interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
    ~float32 | ~float64
}
```

Use for `Sum`, `Avg`, `Min`, `Max`, etc. Note that `string` is **not** included.

### Pattern 2 — Slice element

```go
type SliceOf[E any] interface { ~[]E }

func Reverse[S SliceOf[E], E any](s S) S {
    out := make(S, len(s))
    for i, v := range s { out[len(s)-1-i] = v }
    return out
}
```

This signature preserves the **named slice type**: `Reverse(MySlice{1,2,3})` returns `MySlice`, not `[]int`.

### Pattern 3 — Map key

```go
type Key interface { comparable }
```

Use as a synonym for `comparable` when the intent is "this is a map key". It documents intent without changing behaviour.

### Pattern 4 — Sortable

```go
type Sortable[T any] interface {
    Less(other T) bool
}

func Sort[T Sortable[T]](s []T) { ... }
```

This is the "self-bounded" pattern — the type parameter appears inside its own constraint. We dig into self-bounded constraints in `senior.md`.

### Pattern 5 — Composable

```go
type Resettable interface { Reset() }
type Closable   interface { Close() error }

type Lifecycle interface {
    Resettable
    Closable
}
```

Compose small constraints into bigger ones. Each one is a tiny interface; together they describe a richer contract.

---

## Summary

The middle-level deep dive covers the four main mechanics of Go's constraint system:

1. **`~T`** — widens a type term to include every type whose underlying type matches.
2. **Unions `A | B`** — type set is the union of the listed terms.
3. **Method elements** — required methods, dispatched through a runtime dictionary.
4. **Mixing types and methods** — a constraint can demand both structural shape and behaviour.

Plus three set-algebra operations:

- **Multiple terms** (lines / `;`) intersect.
- **Embedding** an interface composes its requirements.
- **Empty type sets** are allowed but useless.

The operations you can use inside a generic body are determined by the constraint. A loose constraint authorises few operations; a tight constraint authorises many. The body is the **demand**, the constraint is the **supply** — they must match.

Move on to `senior.md` for the type-set algebra, the post-1.20 `comparable` story, and constraint hierarchy design.

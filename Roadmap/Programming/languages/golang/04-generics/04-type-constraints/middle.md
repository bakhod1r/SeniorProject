# Type Constraints — Middle Level

## Table of Contents
1. [Overview](#overview)
2. [Type Sets in Depth](#type-sets-in-depth)
3. [The Union Operator (`|`)](#the-union-operator)
4. [Intersection (Embedding)](#intersection-embedding)
5. [The Approximation Operator (`~`)](#the-approximation-operator)
6. [The `constraints` Package — Full Tour](#the-constraints-package-full-tour)
7. [Custom Constraint Design](#custom-constraint-design)
8. [Method Elements vs Type Elements](#method-elements-vs-type-elements)
9. [Core Types and Allowed Operations](#core-types-and-allowed-operations)
10. [Code Examples](#code-examples)
11. [Patterns](#patterns)
12. [Anti-Patterns](#anti-patterns)
13. [Practice Drills](#practice-drills)
14. [Summary](#summary)

---

## Overview

At the junior level you saw `~int | ~float64` and used `comparable`. At the middle level we slow down and look at exactly what those expressions mean to the compiler — the formal **type set** model — and we tour the `golang.org/x/exp/constraints` package end to end.

This file is about **fluency**. By the end you should be able to read any constraint in a real-world library and predict which types satisfy it.

---

## Type Sets in Depth

A **type set** is a set of concrete types. Every interface in Go has a type set:

- `interface{}` (`any`) — the type set of **all types**.
- `interface{ String() string }` — the type set of every type whose method set contains `String() string`.
- `interface{ int | float64 }` — the type set `{int, float64}`.
- `interface{ ~int }` — the (infinite) type set of every type whose underlying type is `int`.

A type `T` **satisfies** an interface `I` if `T` is in the type set of `I`. For a basic interface (only methods), this is equivalent to "the method set of `T` includes every method of `I`". For a general interface (with type elements), we explicitly check the type element rules.

Key insight: **every interface is just a description of a type set**. Methods are one way to describe; unions are another way; `~` is a third. Reading constraints as set descriptions makes everything else clear.

### The "type set" of a method-only interface

```go
type Reader interface {
    Read([]byte) (int, error)
}
```

The type set of `Reader` is "every type that has a method `Read([]byte) (int, error)`". Infinite, but described by a method requirement.

### The "type set" of a general interface

```go
type Numeric interface {
    int | int64 | float64
}
```

The type set of `Numeric` is exactly `{int, int64, float64}`. Three elements.

### The "type set" of an embedded interface

```go
type Foo interface {
    Numeric
    Stringer
}
```

The type set of `Foo` is the **intersection**: types that are in `Numeric` **and** in `Stringer`. Since none of `int`, `int64`, `float64` satisfy `Stringer` automatically, this is empty unless you have user-defined types that satisfy both.

---

## The Union Operator (`|`)

The `|` operator combines two type elements into one type element whose type set is the **union** of the operand sets.

```go
type StringOrInt interface { string | int }                   // {string, int}
type ManyInts    interface { int8 | int16 | int32 | int64 }   // 4 elements
type Mixed       interface { ~int | ~float64 | ~string }      // 3 infinite families
```

**Rules:**
1. Each operand must be a type literal, a defined type, or a `~T` form. Operands cannot themselves be unions in the same expression (the compiler flattens them, but you cannot write `(int | float) | string` — drop the parens).
2. Operands must be **disjoint** in a specific sense: if both refer to the same underlying-type family, you should not list them twice. `int | int` is not an error but it's a code smell.
3. **No interfaces inside the union** — `Stringer | int` is illegal. (You may have `Stringer` next to `int` only by embedding `Stringer` separately, not as a union operand.)
4. The union is **commutative** but Go style is to list smaller-bit-width first or alphabetically. `~int8 | ~int16 | ~int32 | ~int64` reads better than the reverse.

Example — pseudo-spec showing what the compiler accepts:
```go
type OK1 interface { int | string }
type OK2 interface { ~int | ~string }
type OK3 interface { *int | *string }   // pointer types — legal but rare

type Bad1 interface { Stringer | int }   // ❌ method element cannot appear in a union
type Bad2 interface { (int | string) | float64 }   // ❌ no parens
```

### Allowed operations after a union

If your constraint is `int | float64`, then inside the function you can use **only operations supported by every type in the union**. Both `int` and `float64` support `+`, `-`, `*`, `/`, `<`, etc., so all those work.

`int | string` is interesting: both support `+` (numeric addition for `int`, concatenation for `string`) and `<` (numeric ordering for `int`, lexicographic for `string`). The Go spec calls this a "core type" check — see the section below.

---

## Intersection (Embedding)

Embedding interfaces produces an **intersection** of type sets:

```go
type Numeric interface { int | int64 | float64 }
type Stringer interface { String() string }

type StringableNumeric interface {
    Numeric
    Stringer
}
```

A type satisfies `StringableNumeric` iff it is in `Numeric` **and** has the `String()` method. The empty intersection is the empty set — no type satisfies it, and you cannot instantiate the generic with any argument.

You can also intersect type elements:

```go
type Both interface {
    ~int                // from this constraint
    int | int32 | int64 // from this one
}
```

The intersection of `~int` and `{int, int32, int64}` is `{int}` plus any user type whose underlying type is `int` — the second element narrows the family. This is rarely needed in practice but is legal.

---

## The Approximation Operator (`~`)

`~T` reads as "any type whose underlying type is exactly `T`".

```go
type Celsius float64
type Fahrenheit float64

type Temp interface { ~float64 }

var c Celsius = 25
var f Fahrenheit = 77
// Both c and f satisfy Temp because their underlying type is float64.
```

### Rules of `~`

1. **`T` after `~` must be an unnamed type or a predeclared type.** `~int`, `~[]byte`, `~map[string]int` are legal. `~Celsius` (a named type) is illegal — you would just write `Celsius`.
2. **`~` is not transitive in user code.** It is "underlying type equals". If `type A int` and `type B A`, then `B`'s underlying type is still `int` (Go's type system flattens), so `~int` matches both.
3. **`~` works on any type literal**, including composite types. `~[]byte` matches `type Bytes []byte`.
4. **You cannot use `~` on an interface.** `~Stringer` is illegal.
5. **Pointers are written as the type literal.** `~*int` matches `type IntPtr *int`.

### When to use `~`

- **Almost always**, in a constraint that lists concrete types.
- The cost is zero. The win is library-friendliness: callers with `type UserID int` can use your function.
- The exception: you genuinely want to reject newtype wrappers — for example, in a low-level encoding helper that depends on the exact memory layout being `int` and not "underlying int". This is rare.

### `~` and method sets

`~int` includes `type Money int`, but `Money`'s methods are **not** carried into the constraint. The constraint only describes the **shape**, not the methods. If your function needs both, write:

```go
type ShoppingMoney interface {
    ~int
    String() string
}
```

Now the type argument must have underlying type `int` **and** define `String() string`.

---

## The `constraints` Package — Full Tour

Path: `golang.org/x/exp/constraints` (Go 1.18+, **still in `x/exp` as of Go 1.21+**).

```go
import "golang.org/x/exp/constraints"
```

### `constraints.Signed`
```go
type Signed interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64
}
```
Use for "any signed integer including newtypes". Common for indexing, position offsets, signed counters.

### `constraints.Unsigned`
```go
type Unsigned interface {
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr
}
```
Use for non-negative quantities, sizes, addresses. Note `~uintptr` — important for low-level code.

### `constraints.Integer`
```go
type Integer interface {
    Signed | Unsigned
}
```
Composition. Any integer at all.

### `constraints.Float`
```go
type Float interface {
    ~float32 | ~float64
}
```
The two IEEE-754 floats. Most numeric APIs that want fractional types use this.

### `constraints.Complex`
```go
type Complex interface {
    ~complex64 | ~complex128
}
```
Less common but available for FFT or signal-processing code.

### `constraints.Ordered`
```go
type Ordered interface {
    Integer | Float | ~string
}
```
The big one. Any type that supports `<`, `<=`, `>`, `>=`. Note: complex numbers are **not** ordered, so `Complex` is excluded.

### Idiomatic usage

```go
import "golang.org/x/exp/constraints"

func Sum[T constraints.Integer | constraints.Float](xs []T) T { ... }

func Min[T constraints.Ordered](a, b T) T {
    if a < b {
        return a
    }
    return b
}

func Abs[T constraints.Signed | constraints.Float](x T) T {
    if x < 0 {
        return -x
    }
    return x
}
```

### Why is this not in the standard library?

Originally proposed but moved to `x/exp` so the team could iterate without committing to backward compatibility. Many production projects use it directly; some define their own copies to avoid the dependency. **For Go 1.21+ projects, including the `x/exp` dependency is normal practice.**

---

## Custom Constraint Design

When the `constraints` package is too coarse, design your own. Three guidelines:

### 1. Name after the property, not the types

Bad:
```go
type IntsAndStrings interface { ~int | ~string }
```
Good:
```go
type Hashable interface { ~int | ~string }   // implies "usable as a hash key"
type Concatenable interface { ~string | ~[]byte }
```

The name should answer "what can I do with this?" — not "what types are in this?".

### 2. Compose, don't list

Bad:
```go
type MyOrdered interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
        ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
        ~float32 | ~float64 | ~string
}
```

Good:
```go
import "golang.org/x/exp/constraints"

type MyOrdered interface { constraints.Ordered }
```

Or, if you must avoid the dependency:
```go
type Signed interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64
}
type Unsigned interface {
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr
}
type Integer interface { Signed | Unsigned }
type Float interface { ~float32 | ~float64 }
type Ordered interface { Integer | Float | ~string }
```

### 3. Use `~` unless you have a documented reason not to

A library should be permissive. Reject newtype wrappers only if the math actually depends on the exact representation — for instance, a constraint paired with `unsafe.Sizeof` assumptions.

### 4. One file: `constraints.go`

In a small package, keep all constraints in `constraints.go`. In a library that exposes them, consider a `pkg/constraints` sub-package.

---

## Method Elements vs Type Elements

An interface has two kinds of elements:

| Element | Example | Says |
|---------|---------|------|
| Method element | `Read([]byte) (int, error)` | The type must have this method |
| Type element | `int`, `~string`, `int \| float64` | The type must be in this set |

You can mix them:

```go
type Buffered interface {
    ~[]byte
    Len() int
}
```

A type satisfies `Buffered` iff its underlying type is `[]byte` **and** it has a `Len() int` method.

```go
type ByteBuf []byte
func (b ByteBuf) Len() int { return len(b) }

func Use[T Buffered](x T) {
    fmt.Println(x.Len())
}
```

### When to combine

- You want both a known shape and known capabilities — e.g. "an `int`-shaped value that also knows how to print itself".
- You want to constrain to a specific protocol — e.g. "any `~[]byte` that can be marshalled".

### When **not** to combine

- If only the methods matter, use a method-only interface.
- If only the type matters, use a type-element-only constraint.
- Combining the two creates a **general interface** that cannot be used as a value type.

---

## Core Types and Allowed Operations

The Go spec defines the **core type** of a type parameter:

> If the type set of a type parameter contains only types whose underlying type is the same type T, the core type is T.

If a core type exists, you can use the operations of that type inside the function. If not (e.g., `int | string`), only operations supported by **all** types in the set are allowed.

```go
type IntOrFloat interface { ~int | ~float64 }
// Core type? Both have different underlying types (int vs float64). No core type.
// But + - * / and comparison are supported by both, so they work.

func Sum[T IntOrFloat](xs []T) T {
    var total T
    for _, x := range xs {
        total += x   // ✅ both int and float64 support +
    }
    return total
}
```

```go
type IntOrSlice interface { int | []int }
// + works for int but not for []int. The compiler will reject + inside.
func Bad[T IntOrSlice](x T) T { return x + x }   // ❌ compile error
```

The "what operations work" question is determined entirely by the type set. There's no `if T == int { ... }` inside a generic function — instead, design your constraint so that every type in the set supports the operations you need.

---

## Code Examples

### Example 1: Custom `Numeric` and `Sum`/`Average`
```go
package main

import "fmt"

type Numeric interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
        ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
        ~float32 | ~float64
}

func Sum[T Numeric](xs []T) T {
    var total T
    for _, x := range xs {
        total += x
    }
    return total
}

func Average[T Numeric](xs []T) float64 {
    if len(xs) == 0 {
        return 0
    }
    return float64(Sum(xs)) / float64(len(xs))
}

func main() {
    fmt.Println(Sum([]int{1, 2, 3}))
    fmt.Println(Average([]float64{1.5, 2.5, 3.5}))
}
```

### Example 2: `Ordered` and `Sort`
```go
package main

import (
    "fmt"
    "sort"

    "golang.org/x/exp/constraints"
)

func Sort[T constraints.Ordered](xs []T) {
    sort.Slice(xs, func(i, j int) bool { return xs[i] < xs[j] })
}

func main() {
    nums := []int{3, 1, 4, 1, 5, 9, 2, 6}
    Sort(nums)
    fmt.Println(nums)

    words := []string{"banana", "apple", "cherry"}
    Sort(words)
    fmt.Println(words)
}
```

### Example 3: Embedding `constraints.Integer`
```go
package main

import (
    "fmt"

    "golang.org/x/exp/constraints"
)

type IntegerOrString interface {
    constraints.Integer | ~string
}

func ToString[T IntegerOrString](x T) string {
    return fmt.Sprintf("%v", x)
}

func main() {
    fmt.Println(ToString(42))
    fmt.Println(ToString("hi"))
}
```

### Example 4: `~[]byte` and pipe to a writer
```go
package main

import (
    "fmt"
    "io"
    "os"
)

type Bytesy interface { ~[]byte }

func WriteAll[T Bytesy](w io.Writer, data T) (int, error) {
    return w.Write([]byte(data))
}

type Payload []byte

func main() {
    n, err := WriteAll(os.Stdout, Payload("hello\n"))
    fmt.Println(n, err)
}
```

### Example 5: Method element
```go
package main

import "fmt"

type Stringer interface {
    String() string
}

func PrintAll[T Stringer](xs []T) {
    for _, x := range xs {
        fmt.Println(x.String())
    }
}

type City string
func (c City) String() string { return "City: " + string(c) }

func main() {
    PrintAll([]City{"Tashkent", "Bukhara"})
}
```

### Example 6: Method + type element
```go
package main

import "fmt"

type Numbery interface {
    ~int | ~float64
    String() string
}

type Cents int
func (c Cents) String() string { return fmt.Sprintf("¢%d", c) }

func ShowAll[T Numbery](xs []T) {
    for _, x := range xs {
        fmt.Println(x.String())
    }
}

func main() {
    ShowAll([]Cents{100, 250, 99})
}
```

### Example 7: Constraint composition (DSL)
```go
package main

import "golang.org/x/exp/constraints"

type SafeKey interface {
    constraints.Integer | ~string   // hashable, ordered
}

type Cache[K SafeKey, V any] struct {
    data map[K]V
}

func NewCache[K SafeKey, V any]() *Cache[K, V] {
    return &Cache[K, V]{data: make(map[K]V)}
}

func (c *Cache[K, V]) Put(k K, v V) { c.data[k] = v }
func (c *Cache[K, V]) Get(k K) (V, bool) {
    v, ok := c.data[k]
    return v, ok
}
```

### Example 8: Reject with intersection
```go
type IntegerString interface {
    ~int    // type element 1
    ~string // type element 2 — intersection!
}
// Type set: empty. No type can be both ~int and ~string at the same time.
// Useful as a teaching example; do not write this in real code.
```

### Example 9: Constraint param vs interface param
```go
package main

import "fmt"

type Writer interface {
    Write([]byte) (int, error)
}

// As an interface parameter (runtime polymorphism, value boxed):
func WriteFmt(w Writer, msg string) { w.Write([]byte(msg)) }

// As a constraint (compile-time monomorphization, no boxing):
func WriteFmtG[W Writer](w W, msg string) { w.Write([]byte(msg)) }
```

When does it matter? Hot loops where the cost of dynamic dispatch matters. The generic version monomorphizes per concrete type and may inline `Write`.

### Example 10: Approximation breakage
```go
type Number interface { int | float64 }   // no ~

type ID int
ids := []ID{1, 2, 3}
_ = Sum(ids)   // ❌ ID is not int

// Fix:
type Number2 interface { ~int | ~float64 }
_ = Sum(ids)   // ✅
```

---

## Patterns

### Pattern 1: Constraint per package
Each library defines its own minimal set of constraints; depend on `x/exp/constraints` only at the entry-point package, not in every leaf module.

### Pattern 2: Two-level constraint hierarchy
```go
type Number interface { Integer | Float }
type Calculable interface { Number | constraints.Complex }
```
Designs scale by intersecting/unioning the levels.

### Pattern 3: "Method or shape" choice
- If consumers can implement methods, prefer a method-only constraint — most flexible.
- If consumers cannot (or you want operator support), use a type-element constraint.

### Pattern 4: Use `comparable` for keys, `Ordered` for sorting
Don't conflate them. `comparable` is wider than `Ordered`. `Ordered` is wider than `Integer`.

### Pattern 5: The "exact match" constraint
When you really mean "exactly `int`", drop the `~`. Document why.
```go
// AlignedInt requires exactly int (machine word) — no newtype wrappers.
type AlignedInt interface { int }
```

---

## Anti-Patterns

1. **Listing every numeric type by hand** when `constraints.Integer | constraints.Float` would do.
2. **Forgetting `~`** in a published library.
3. **Mixing unrelated types in a union** for "convenience" — `int | http.Request` is meaningless.
4. **Re-deriving `comparable`** with a long union of types.
5. **Using a constraint as a value type** — fails to compile, but novices try it.
6. **Adding a method element for "future flexibility"** — narrows the constraint without need.

---

## Practice Drills

1. Define a constraint `Hashable` that accepts `~int`, `~uint`, `~string`, and `~[]byte`. Discuss why `~[]byte` is problematic (slices aren't `comparable`).
2. Write `Distinct[T comparable](xs []T) []T` returning unique elements in order.
3. Write `Clamp[T Ordered](x, lo, hi T) T`.
4. Define a constraint `Numerical` that includes integers, floats, and complex.
5. Write `Range[T Integer](start, stop T) []T`.
6. Define `Stringable` (method element) and `OrderedStringable` (combined).
7. Write `MaxBy[T any, K Ordered](xs []T, key func(T) K) T`.
8. Reproduce `constraints.Signed` from scratch without importing the package.
9. Show a constraint whose type set is empty; explain why no instantiation is possible.
10. Write a `Counter[T comparable]` that tracks frequency of each element.

---

## Summary

Type constraints describe **type sets**. Build them with three tools: union (`|`), intersection (embedding), and approximation (`~`). The `golang.org/x/exp/constraints` package gives you `Signed`, `Unsigned`, `Integer`, `Float`, `Complex`, and `Ordered` — use them. Mix method elements and type elements only when you genuinely need both. Always prefer permissive constraints over restrictive ones, and always prefer composition over copy-paste.

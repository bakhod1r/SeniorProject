# Generic Types & Interfaces — Middle Level

## Table of Contents
1. [Methods on generic types in detail](#methods-on-generic-types-in-detail)
2. [Why methods can't have their own type parameters](#why-methods-cant-have-their-own-type-parameters)
3. [Workarounds for "generic methods"](#workarounds-for-generic-methods)
4. [Type sets in interfaces](#type-sets-in-interfaces)
5. [Constraint vs value interface](#constraint-vs-value-interface)
6. [Embedding generic interfaces](#embedding-generic-interfaces)
7. [Method sets of instantiated types](#method-sets-of-instantiated-types)
8. [Type-set syntax: `|`, `~`, `comparable`](#type-set-syntax-comparable)
9. [The structural rules of `any`](#the-structural-rules-of-any)
10. [Self-referential generic types](#self-referential-generic-types)
11. [Mutual references between generic types](#mutual-references-between-generic-types)
12. [Generic interfaces with multiple parameters](#generic-interfaces-with-multiple-parameters)
13. [Practice patterns](#practice-patterns)
14. [Common errors](#common-errors)
15. [Tasks](#tasks)
16. [Summary](#summary)

---

## Methods on generic types in detail

When you declare a method on a generic type, the **receiver must repeat the type parameter list** of the type:

```go
type Box[T any] struct { v T }

func (b *Box[T]) Get() T  { return b.v }
func (b *Box[T]) Set(x T) { b.v = x }
```

Note three things:

1. The receiver is `*Box[T]`, not `*Box`. The brackets carry `T` into the method body.
2. The constraint (`any`) is **not** repeated — only the parameter names appear.
3. Inside the method, `T` refers to whichever type was used to instantiate the receiver. For a `*Box[int]`, `T` is `int`; for a `*Box[string]`, `T` is `string`.

You can also rename the parameter in the receiver if you want — it just has to match positionally:

```go
func (b *Box[X]) Touch() {} // X here is the same as T outside; renaming legal but discouraged
```

In practice, **always keep the same name** (`T`, `K`, `V`) you used in the type declaration. Renaming hurts readability.

### What's actually inside the receiver

In a regular method, the receiver `r` is a value of type `*Receiver`. In a generic method, the receiver is a value of the **instantiated** type. So if you write:

```go
func (s *Stack[T]) Push(v T) { s.items = append(s.items, v) }
```

and you call `s.Push(42)` where `s` is `*Stack[int]`, then inside the method:
- `s` is `*Stack[int]`
- `T` is `int`
- `v` is `int`
- `s.items` is `[]int`

This is checked at compile time. There is no runtime "is this an int?" check.

---

## Why methods can't have their own type parameters

The Go spec forbids method declarations from carrying *additional* type parameters:

> "A method declaration may not have type parameters; the method's type parameters are the type parameters of its receiver."
> — Go Spec, *Method declarations*

So this is **invalid**:

```go
// ✘ Compile error
func (s *Stack[T]) Map[U any](fn func(T) U) *Stack[U] { ... }
```

### The core reason — interface satisfaction

Interfaces in Go work by structural matching of the method set. If methods could add their own type parameters, then "does `Stack[int]` implement `Container[int]`?" would depend on resolving every possible `U` — which makes the interface check undecidable in general.

There is also a more practical reason: per-method type parameters interact awkwardly with method values, method expressions, and the dictionary-passing implementation strategy used by the Go compiler (see `optimize.md`).

The Go team initially considered allowing them, decided against it for the first release, and as of Go 1.22+ this restriction still stands. There is an open discussion (issue #49085 and friends) but no plan to lift it.

---

## Workarounds for "generic methods"

Your method needs an extra type? You have three options.

### Option A — top-level function

```go
func MapStack[T, U any](s *Stack[T], fn func(T) U) *Stack[U] {
    out := NewStack[U]()
    for _, v := range s.items {
        out.Push(fn(v))
    }
    return out
}
```

This is the **most idiomatic** workaround. `slices.Map` (in proposal form) and friends in the standard library all take this shape.

### Option B — `any` plus a runtime type assertion

```go
func (s *Stack[T]) MapAny(fn func(T) any) *Stack[any] {
    out := NewStack[any]()
    for _, v := range s.items {
        out.Push(fn(v))
    }
    return out
}
```

Lose type safety; rarely worth it.

### Option C — wrap in a generic helper type

```go
type Mapper[T, U any] struct{}

func (Mapper[T, U]) Map(s *Stack[T], fn func(T) U) *Stack[U] {
    out := NewStack[U]()
    for _, v := range s.items { out.Push(fn(v)) }
    return out
}
```

`Mapper[int, string]{}.Map(s, fn)` — syntactically heavier, occasionally useful when you want method-call style.

The honest answer: **most teams pick Option A and move on**.

---

## Type sets in interfaces

Inside an interface used as a *constraint*, you can list a **type set** with `|` (union):

```go
type Signed interface {
    int | int8 | int16 | int32 | int64
}

type Unsigned interface {
    uint | uint8 | uint16 | uint32 | uint64
}

type Integer interface {
    Signed | Unsigned
}

type Number interface {
    Integer | float32 | float64
}
```

`Number` accepts any of those underlying types. Use `~` to also accept defined types based on those underlyings:

```go
type Ordered interface {
    ~int | ~int64 | ~float64 | ~string
}

type Celsius float64
// Celsius satisfies Ordered because its underlying type is float64
```

Without the `~`, `Celsius` would not satisfy `Ordered`.

The `cmp.Ordered` interface in the standard library (Go 1.21+) is defined this way; you should usually prefer it over rolling your own.

---

## Constraint vs value interface

The same `interface{...}` syntax serves two distinct roles, and **the role determines what you may put inside**:

| Role | Where it appears | Allowed contents | Use as |
|------|------------------|------------------|--------|
| **Value interface** | Variable types, function signatures, fields | Method signatures only | Holds values; supports method dispatch |
| **Constraint** | Inside `[T constraint]` | Method signatures + type sets (`|`, `~`) | Restricts type parameters; not a value type |

```go
// VALUE interface — usable as a variable type
type Reader interface {
    Read(p []byte) (int, error)
}

var r Reader = os.Stdin // OK

// CONSTRAINT — only usable in [T ...]
type Number interface {
    int | float64
}

var n Number = 1 // ✘ compile error
func Sum[T Number](xs []T) T { ... } // OK
```

A **generic interface** — `Iterator[T any] interface { Next() (T, bool) }` — is a value interface that happens to be parameterized. It contains only method signatures, so once instantiated (`Iterator[int]`) it becomes a normal value interface.

### What if I add a type set to a parameterized interface?

```go
type Mixed[T any] interface {
    int | string  // type set
    Foo() T       // method
}
```

This compiles, but **it is now a constraint-only interface**. You cannot use `Mixed[int]` as a value type. The presence of the type set makes the role unambiguous.

Mixing methods and type sets is rare in practice — keep them separated.

---

## Embedding generic interfaces

Interfaces can embed other interfaces, including generic ones.

### Case 1 — value interface embedding a value interface

```go
type Reader[T any] interface {
    Read() (T, bool)
}

type Writer[T any] interface {
    Write(v T) error
}

type ReadWriter[T any] interface {
    Reader[T]
    Writer[T]
}
```

`ReadWriter[int]` requires both `Read() (int, bool)` and `Write(int) error`.

### Case 2 — constraint embedding a constraint

```go
type Numeric interface {
    int | int64 | float64
}

type Ordered interface {
    Numeric
    ~string
}
```

Here the union widens.

### Case 3 — constraint embedding a value interface

You can embed any interface you want; the result is a constraint that requires the listed methods AND any listed type set.

```go
type Stringer = fmt.Stringer

type StringableNumber interface {
    Numeric
    Stringer
}

func Format[T StringableNumber](xs []T) []string {
    out := make([]string, len(xs))
    for i, x := range xs { out[i] = x.String() }
    return out
}
```

Here, every `T` must be one of the numeric types AND have a `String() string` method (so the user must use defined types like `type MyInt int` with a method).

---

## Method sets of instantiated types

When you instantiate `Stack[int]`, its method set is exactly the methods of `Stack[T]` with `T` substituted by `int`.

```go
type Stack[T any] struct{ items []T }

func (s *Stack[T]) Push(v T)    { s.items = append(s.items, v) }
func (s *Stack[T]) Pop() (T, bool) { ... }
func (s *Stack[T]) Len() int    { return len(s.items) }
```

The method set of `*Stack[int]` is:
- `Push(v int)`
- `Pop() (int, bool)`
- `Len() int`

The method set of `*Stack[string]` differs only in the substituted parameter:
- `Push(v string)`
- `Pop() (string, bool)`
- `Len() int`

Since `Stack[int]` and `Stack[string]` are **different types**, their method sets are different (even though they share a source).

### Interface satisfaction

An instantiated type satisfies an interface if its method set matches:

```go
type IntSink interface {
    Push(v int)
    Len() int
}

var x IntSink = &Stack[int]{} // OK — method set matches with T = int
var y IntSink = &Stack[string]{} // ✘ Push(string) ≠ Push(int)
```

---

## Type-set syntax: `|`, `~`, `comparable`

### Union `|`

Lists alternative underlying types. Order does not matter.

### Approximation `~T`

Means "any type whose underlying type is T". Without `~`, only the exact type counts.

```go
type Celsius float64

type ExactFloat interface { float64 }
type AnyFloat   interface { ~float64 }

var a ExactFloat = 1.5      // ✘ used as a value? actually constraint-only — just imagine in [T]
// ExactFloat allows float64 only.
// AnyFloat allows float64, Celsius, Kelvin, ... (any "type X float64")
```

In real code, prefer `~` whenever you would accept a defined type.

### `comparable`

A built-in constraint meaning "supports `==` and `!=`". Required for map keys.

```go
type Set[T comparable] struct {
    m map[T]struct{}
}
```

`comparable` is **not** a regular interface; you cannot use it as a value type. It excludes slices, maps, functions, and structs containing them.

---

## The structural rules of `any`

`any` is just an alias for `interface{}`. As a constraint, it allows any type whatsoever — including types that cannot be compared (`func`, `[]int`, `map[K]V`, structs containing them).

This affects what you can do inside the body:

```go
func Find[T any](xs []T, want T) int {
    for i, x := range xs {
        if x == want { return i } // ✘ compile error: T might not be comparable
    }
    return -1
}
```

Use `comparable` when you need `==`:

```go
func Find[T comparable](xs []T, want T) int {
    for i, x := range xs {
        if x == want { return i }
    }
    return -1
}
```

Or pass a comparison function for `any`:

```go
func FindFunc[T any](xs []T, eq func(T) bool) int {
    for i, x := range xs {
        if eq(x) { return i }
    }
    return -1
}
```

---

## Self-referential generic types

A generic type may refer to itself:

```go
type Tree[T any] struct {
    value       T
    left, right *Tree[T]
}

type LinkedList[T any] struct {
    head *node[T]
}

type node[T any] struct {
    v    T
    next *node[T]
}
```

The key rule: when you reference the type from inside its own definition, you must include the same type parameters (`*Tree[T]`, not `*Tree`).

---

## Mutual references between generic types

Two generic types can reference each other in the same package:

```go
type Graph[T comparable] struct {
    nodes map[T]*GraphNode[T]
}

type GraphNode[T comparable] struct {
    value T
    edges []*GraphNode[T]
    graph *Graph[T]
}
```

Both must agree on the parameter list. If `Graph` is `[T comparable]` and `GraphNode` is `[T any]`, you cannot keep `*Graph[T]` inside `GraphNode` without adjusting constraints.

---

## Generic interfaces with multiple parameters

```go
type KeyValueStore[K comparable, V any] interface {
    Get(k K) (V, bool)
    Set(k K, v V)
    Delete(k K)
}

type RedisStore[K comparable, V any] struct { /* ... */ }

func (r *RedisStore[K, V]) Get(k K) (V, bool) { /* ... */ }
func (r *RedisStore[K, V]) Set(k K, v V)      { /* ... */ }
func (r *RedisStore[K, V]) Delete(k K)         { /* ... */ }

var s KeyValueStore[string, int] = &RedisStore[string, int]{}
```

The order of `[K, V]` matters and must match between interface, type, and methods.

---

## Practice patterns

### Pattern: pointer-receiver everywhere

For a generic container with mutable state, use pointer receivers for **every** method to keep the method set consistent:

```go
func (s *Stack[T]) Len() int { return len(s.items) }      // pointer receiver
func (s *Stack[T]) Push(v T) { s.items = append(s.items, v) }
func (s *Stack[T]) IsEmpty() bool { return len(s.items) == 0 }
```

If `Len` were a value receiver and `Push` a pointer receiver, only `*Stack[T]` would have the full method set, but `Stack[T]` would have only `Len`. Mixed receivers cause subtle interface-satisfaction bugs.

### Pattern: provide both `Func` and `FuncRecv` versions

```go
// As function — composable
func Filter[T any](xs []T, pred func(T) bool) []T { ... }

// As method on a wrapper — fluent
type Slice[T any] []T
func (s Slice[T]) Filter(pred func(T) bool) Slice[T] { return Filter([]T(s), pred) }
```

### Pattern: factory + interface

Expose a generic interface and a private generic struct:

```go
type Cache[K comparable, V any] interface {
    Get(K) (V, bool)
    Set(K, V)
}

type lruCache[K comparable, V any] struct { /* ... */ }

func NewLRU[K comparable, V any](cap int) Cache[K, V] {
    return &lruCache[K, V]{cap: cap}
}
```

### Pattern: typed channels

```go
type EventBus[E any] struct {
    subs []chan E
}

func (b *EventBus[E]) Subscribe() <-chan E {
    ch := make(chan E, 8)
    b.subs = append(b.subs, ch)
    return ch
}

func (b *EventBus[E]) Publish(e E) {
    for _, ch := range b.subs {
        select {
        case ch <- e:
        default:
        }
    }
}
```

`EventBus[OrderPlaced]`, `EventBus[UserRegistered]` — each is a separate, type-safe bus.

---

## Common errors

| Error | Cause | Fix |
|------|-------|-----|
| `methods cannot have type parameters` | `func (s *Stack[T]) Map[U any]` | Move to a top-level function |
| `Stack is not a type` (when used as `Stack` alone) | Missing `[T]` | Use `Stack[int]`, etc. |
| `interface contains type constraints` | Used a type-set interface as value | Define a separate constraint and value interface |
| `cannot use foo (variable of type Stack[int]) as Stack[string]` | Different instantiated types | Convert manually |
| `T does not support ==` | Used `==` with `any` constraint | Use `comparable` constraint |
| `cannot infer T` | Compiler can't deduce parameters | Write them explicitly: `Foo[int](x)` |
| `wrong type parameter list` on receiver | Receiver missing parameters | `func (s *Stack[T])` not `func (s *Stack)` |

---

## Tasks

1. Write a `Pair[A, B any]` type with constructors and a method `Swap() Pair[B, A]`. (Hint: this needs a top-level function, not a method, because of the parameter swap.)
2. Implement `OrderedMap[K comparable, V any]` keeping insertion order.
3. Implement a generic `Set[T comparable]` with `Add`, `Has`, `Remove`, `Len`, `Union`, `Intersect`.
4. Implement a generic `RingBuffer[T any]` with fixed capacity.
5. Define a constraint `Numeric interface { ~int | ~int64 | ~float32 | ~float64 }` and write `Avg[T Numeric](xs []T) float64`.
6. Implement a generic `Iterator[T]` value interface, then write `Map[T, U any](it Iterator[T], fn func(T) U) Iterator[U]` (top-level function — methods can't add `U`).
7. Define `Comparator[T] interface { Compare(a, b T) int }` and write `SortWith[T any](xs []T, cmp Comparator[T])`.
8. Build an `EventBus[E]` and demonstrate two separate buses for two event types.
9. Write a generic `KeyValueStore[K, V]` interface and an in-memory implementation.
10. Try to write `func (s *Stack[T]) Map[U any](fn func(T) U) *Stack[U]` — observe the compiler error, then refactor to a top-level function.

---

## Summary

- Methods on generic types **must** repeat the receiver's type parameter list and **cannot** add new type parameters of their own.
- The `interface { ... }` syntax has two roles — value type and constraint — and the contents (type sets, methods) determine which.
- Type sets use `|` and `~`; `comparable` is a built-in constraint.
- Embedding generic interfaces composes both methods and type sets.
- Each instantiation is a distinct type; method sets are derived per instantiation.
- Workaround for "method-level type parameters": top-level generic function.

End of middle.md.

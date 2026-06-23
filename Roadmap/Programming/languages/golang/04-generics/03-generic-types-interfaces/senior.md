# Generic Types & Interfaces — Senior Level

## Table of Contents
1. [Designing reusable data structures](#designing-reusable-data-structures)
2. [Encapsulation in generic packages](#encapsulation-in-generic-packages)
3. [Type identity and the type system](#type-identity-and-the-type-system)
4. [Zero values across instantiations](#zero-values-across-instantiations)
5. [Generic types at package boundaries](#generic-types-at-package-boundaries)
6. [Concurrency-safe generic types](#concurrency-safe-generic-types)
7. [The cost of methods on generic types](#the-cost-of-methods-on-generic-types)
8. [API design — generic vs interface](#api-design-generic-vs-interface)
9. [Versioning and evolution](#versioning-and-evolution)
10. [Refactoring legacy `interface{}` code](#refactoring-legacy-interface-code)
11. [Testing strategies](#testing-strategies)
12. [Pitfalls and red flags](#pitfalls-and-red-flags)
13. [Architecture patterns](#architecture-patterns)
14. [Summary](#summary)

---

## Designing reusable data structures

A reusable generic data structure is more than just a `Stack[T]` — it has a thoughtful API surface, consistent receiver discipline, and a clear story about ownership.

### Principle 1 — keep the parameter list small

`Stack[T]`, `Queue[T]`, `Cache[K, V]` are easy to read. Once you reach four or more parameters, the call site becomes ugly:

```go
type Pipeline[In, Out, Err, State any] struct{} // smells
```

Often a "many-parameter" generic type is hiding a *family* of types. Either split it, or absorb some parameters into nested types.

### Principle 2 — pick constraints carefully

For a container, common constraints are:

| Use | Constraint |
|-----|-----------|
| Generic container, no comparison needed | `T any` |
| Map keys, set elements | `T comparable` |
| Sorted structure | `T cmp.Ordered` (Go 1.21+) |
| Numeric reduction | custom `Numeric` |

A constraint tightens the API contract; loosening it later is easy, tightening it is a breaking change.

### Principle 3 — return iterators, not snapshots, for big data

For small structures, returning `[]T` is fine. For large or streaming structures, a generic iterator is better:

```go
type Iterator[T any] interface {
    Next() (T, bool)
}
```

It allows lazy evaluation and avoids blowing memory on huge collections.

### Principle 4 — prefer composition over deep inheritance

Generic types do not "inherit" — and you should not try to fake it through embedding. If `LRUCache[K, V]` and `TTLCache[K, V]` share behavior, factor the shared logic into a function or a small type they both compose, not a "base" type.

---

## Encapsulation in generic packages

A package exporting a generic type uses the same Go visibility rules as for a non-generic type — but two patterns matter most.

### Pattern A — exported type, exported methods

Simplest and most common:

```go
package stack

type Stack[T any] struct {
    items []T // unexported field — encapsulated
}

func New[T any]() *Stack[T]       { return &Stack[T]{} }
func (s *Stack[T]) Push(v T)      { s.items = append(s.items, v) }
func (s *Stack[T]) Pop() (T, bool) { /* ... */ }
```

External code uses `stack.New[int]()` and the public methods.

### Pattern B — exported interface, unexported implementation

When you want to hide the implementation entirely:

```go
package cache

type Cache[K comparable, V any] interface {
    Get(K) (V, bool)
    Set(K, V)
}

type lru[K comparable, V any] struct { /* ... */ }

func New[K comparable, V any](cap int) Cache[K, V] {
    return &lru[K, V]{cap: cap}
}
```

External code never sees `lru`. You can swap implementations (`lru`, `lfu`, `tinylfu`) without breaking callers.

### Encapsulation across instantiations

Unexported fields stay unexported regardless of instantiation:

```go
// package internal
type Box[T any] struct { val T } // val is unexported

// package main
b := internal.Box[int]{val: 42} // ✘ cannot access val
```

Type parameters do not pierce visibility.

---

## Type identity and the type system

Two generic types are **identical** if and only if:

1. They are the same generic type, AND
2. All their type arguments are identical types.

So:

```go
type Stack[T any] struct { items []T }

var a Stack[int]
var b Stack[int]
a = b // OK — identical types

var c Stack[string]
a = c // ✘ different types
```

### Subtle case — type aliases

A type alias of a generic type just renames it — it does not create a new type:

```go
type IntStack = Stack[int]

var a Stack[int]
var b IntStack
a = b // OK — same underlying type
```

### Subtle case — named (defined) types from instantiation

```go
type IntStack Stack[int] // a *new* defined type, not an alias

var a Stack[int]
var b IntStack
a = b // ✘ different types; need explicit conversion
```

This is sometimes useful — you might want to attach extra methods to `IntStack` only.

### Cross-package identity

`pkgA.Stack[int]` is a different type than `pkgB.Stack[int]` if both packages define their own `Stack`. The package path is part of the type identity.

### Reflection and runtime types

At runtime, `reflect.TypeOf(Stack[int]{})` gives you a `reflect.Type` with name `Stack[int]` and package path of the source. Two different instantiations have two different `reflect.Type` values.

---

## Zero values across instantiations

The zero value of `Stack[T]` is field-by-field zero:

```go
var s Stack[int]    // {items: nil}
var s2 Stack[string] // {items: nil}
```

The zero value depends on `T`:

- `Stack[int]{}.items` is `[]int(nil)` — a nil int slice.
- `Stack[string]{}.items` is `[]string(nil)` — a nil string slice.

Inside methods you may need to return the zero value of `T`:

```go
func (s *Stack[T]) Top() T {
    if len(s.items) == 0 {
        var zero T
        return zero
    }
    return s.items[len(s.items)-1]
}
```

`var zero T` is the **only** portable way to get a `T` zero value. You cannot use `nil` (only valid for some `T`), `0` (only for numerics), or `""` (only for strings).

### Caveat — pointer T

When `T` is `*Foo`, the zero value is `nil`:

```go
type Stack[T any] struct{ items []T }
s := Stack[*Foo]{}
var zero *Foo
// zero == nil
```

This sometimes surprises developers expecting `&Foo{}`.

### Caveat — interface T

When `T` is an interface, the zero value is the nil interface (both type and value nil), which is *not* the same as a typed nil. Beware of comparisons.

---

## Generic types at package boundaries

When you publish a generic type, you commit to:

1. **Its name and parameter list.** Adding or reordering parameters is a breaking change.
2. **Its constraints.** Tightening (from `any` to `comparable`) breaks callers; loosening is safe.
3. **Its method set per instantiation.** Same rules as a non-generic API.

### Recommendation — start tight

It is far easier to **loosen** a constraint later than to tighten it. Start with `comparable` if you might ever need it; downgrade to `any` only when you confirm you never need `==`.

### Recommendation — don't expose internal generics if you can avoid it

Generic internals leak quickly across packages. If a generic type is purely internal scaffolding, keep it `unexported`. Expose only the high-level interface:

```go
// public
type Repository[T any] interface { ... }

// internal — not exported
type sqlRepo[T any] struct { ... }
```

### Recommendation — keep one canonical instantiation per concept

If your project uses `Set[string]` in many places, define `type StringSet = Set[string]` once. Reduces noise and gives a target for type-specific helper methods.

---

## Concurrency-safe generic types

A generic container is no more or less thread-safe than its non-generic equivalent. You must add synchronization explicitly.

### Approach A — built-in mutex

```go
type SafeMap[K comparable, V any] struct {
    mu sync.RWMutex
    m  map[K]V
}

func NewSafeMap[K comparable, V any]() *SafeMap[K, V] {
    return &SafeMap[K, V]{m: make(map[K]V)}
}

func (s *SafeMap[K, V]) Get(k K) (V, bool) {
    s.mu.RLock(); defer s.mu.RUnlock()
    v, ok := s.m[k]; return v, ok
}

func (s *SafeMap[K, V]) Set(k K, v V) {
    s.mu.Lock(); defer s.mu.Unlock()
    s.m[k] = v
}
```

The mutex protects the *whole* map, irrespective of `K` and `V`.

### Approach B — wrap `sync.Map` (untyped)

`sync.Map` (pre-1.21) is untyped and uses `any`. Wrap it for type safety:

```go
type TypedSyncMap[K comparable, V any] struct {
    m sync.Map
}

func (t *TypedSyncMap[K, V]) Load(k K) (V, bool) {
    v, ok := t.m.Load(k)
    if !ok { var zero V; return zero, false }
    return v.(V), true // type assertion
}

func (t *TypedSyncMap[K, V]) Store(k K, v V) { t.m.Store(k, v) }
```

The type assertion cannot fail because we always store `V`. But the boxing cost remains because `sync.Map` itself uses `any` internally.

In Go 1.21+ there are proposals/experiments for a typed `sync.Map[K, V]`. Watch the standard library.

### Approach C — channel-based ownership

Wrap state in a single goroutine; communicate via a typed channel:

```go
type Counter[T any] struct {
    ops chan func(*T)
}

func (c *Counter[T]) run(state *T) {
    for op := range c.ops { op(state) }
}
```

This avoids locks entirely; the channel type is parameterized.

---

## The cost of methods on generic types

The Go compiler's strategy (since 1.18) is **GC stenciling with dictionaries**:

- For each unique *gcshape* (class of types with the same memory layout / GC properties), one specialized version of the method body is emitted.
- Pointer types of any size share one shape (since they are all `unsafe.Pointer` to the GC).
- Many value types share shape as well (e.g., `int32` and `uint32`).
- A small *dictionary* is passed to the method; it carries per-instantiation metadata (e.g., type info needed for `==`, allocation, conversion).

### Practical consequences

1. **Calling a method on a `Stack[*User]` and a `Stack[*Order]`** uses the **same compiled body**, just different dictionaries.
2. **Calling `Stack[int].Push` and `Stack[float64].Push`** typically uses different bodies (different shapes).
3. **A pointer-shape generic method has a small overhead** vs the equivalent hand-written non-generic method (the dictionary lookup), often in the low ns range.

### When to worry

For 99% of code: don't. For tight inner loops:

- Benchmark with `-benchmem` and `-cpuprofile`.
- Compare against a hand-written specialized version.
- If the difference matters, write a specialized type for that hot path.

`optimize.md` covers this in detail.

---

## API design — generic vs interface

When does a generic type beat a regular interface, and vice versa?

### Use a generic type when:

- The API is "a container of T".
- You want to preserve the concrete element type at the boundary.
- You want compile-time checks ("a `Cache[string, User]` cannot accidentally be used as `Cache[string, Order]`").
- You want zero boxing for value types.

### Use a regular interface when:

- You need *heterogeneity* — different concrete types behind one type.
- You want runtime polymorphism / dynamic dispatch.
- The set of implementations is open and unknown.

### Use both when:

- The interface is the contract (`Cache[K, V]`), and a generic struct is the default implementation.

A mistake to avoid: replacing every `interface{}` with a generic. Sometimes you really do want a heterogeneous container — `[]Shape` containing circles, squares, triangles is the textbook case.

---

## Versioning and evolution

Generic APIs require care when they reach v1.

### Adding a new parameter — breaking

```go
// v1
type Cache[K comparable, V any] struct{ ... }

// v2 — adds a third parameter for an event hook?
type Cache[K comparable, V any, E any] struct{ ... }
```

**Breaking.** All call sites and embedding code must update.

### Tightening a constraint — breaking

```go
// v1
type Set[T any] struct{ ... }

// v2 — wants to use ==
type Set[T comparable] struct{ ... }
```

**Breaking.** A user who had `Set[func()]` in v1 cannot upgrade.

### Loosening a constraint — safe

```go
// v1
type X[T comparable] struct{ ... }

// v2
type X[T any] struct{ ... }
```

Generally safe — but methods that used `==` no longer compile.

### Adding methods — usually safe

Adding methods to `Stack[T]` is safe at the type level, but may break interface satisfaction tests if a user relied on a minimal method set.

### Strategy

- Treat generic types as part of your stable API surface.
- Use semantic versioning for breaking changes.
- Provide aliases or thin wrappers when the change is unavoidable.

---

## Refactoring legacy `interface{}` code

A common modern task: turn a pre-generics container that uses `interface{}` into a generic version.

### Step 1 — identify the parameter

A function signature like:

```go
func (c *Cache) Get(key string) interface{} { ... }
```

becomes:

```go
type Cache[V any] struct { ... }
func (c *Cache[V]) Get(key string) V { ... }
```

### Step 2 — handle the cast removal

Where you had:

```go
v := c.Get("user").(User)
```

now you have:

```go
v := c.Get("user") // already User
```

### Step 3 — fix nil returns

Old code returning `nil` for "missing":

```go
func (c *Cache) Get(k string) interface{} {
    v, ok := c.m[k]
    if !ok { return nil }
    return v
}
```

New code must return a `(V, bool)`:

```go
func (c *Cache[V]) Get(k string) (V, bool) {
    v, ok := c.m[k]; return v, ok
}
```

### Step 4 — keep a deprecation alias

```go
// Deprecated: use Cache[V] directly.
type AnyCache = Cache[any]
```

Lets old call sites compile while you migrate them.

---

## Testing strategies

Test the generic type with at least two type parameters to flush out type-specific assumptions.

```go
func TestStackInt(t *testing.T)    { testStack(t, []int{1, 2, 3}) }
func TestStackString(t *testing.T) { testStack(t, []string{"a", "b"}) }

func testStack[T comparable](t *testing.T, items []T) {
    s := NewStack[T]()
    for _, v := range items { s.Push(v) }
    for i := len(items) - 1; i >= 0; i-- {
        v, ok := s.Pop()
        if !ok || v != items[i] {
            t.Fatalf("pop[%d] = %v ok=%v, want %v", i, v, ok, items[i])
        }
    }
}
```

This is itself a generic helper. Run the same scenario across types.

### Property-based ideas

- "After Push, Pop returns the same value."
- "Len matches the number of pushes minus pops."
- "Pop on empty returns zero value and false."

These hold for any `T`.

---

## Pitfalls and red flags

| Red flag | What's likely wrong |
|----------|---------------------|
| `Stack[any]` everywhere | You're using generics to defer the decision — usually wrong; pick a concrete `T` |
| Lots of `(any, error)` returns inside a generic struct | You are leaking dynamic typing — try to push the parameterization further |
| `*BigStruct` cached without sync | Concurrency bug independent of generics |
| Method that takes `interface{}` inside a generic type | Smells — usually you can parameterize this |
| Multiple `if reflect.TypeOf(...)...` branches inside a generic method | The type parameter is doing nothing — refactor |
| 7-parameter generic type | Almost always over-engineered |

---

## Architecture patterns

### Layered repository

```go
type Repository[T any] interface {
    Get(ctx context.Context, id string) (T, error)
    Save(ctx context.Context, v T) error
    Delete(ctx context.Context, id string) error
}

type sqlRepo[T any] struct { db *sql.DB; table string; scan func(rows *sql.Rows) (T, error) }

func NewSQLRepo[T any](db *sql.DB, table string, scan func(rows *sql.Rows) (T, error)) Repository[T] {
    return &sqlRepo[T]{db: db, table: table, scan: scan}
}
```

Each domain type gets its own scanner; the rest of the boilerplate is shared.

### Service with typed cache

```go
type Service[T any] struct {
    repo  Repository[T]
    cache Cache[string, T]
}
```

`Service[User]`, `Service[Order]` — same shape, type-safe usage.

### Event-driven systems

```go
type EventStore[E any] interface {
    Append(ctx context.Context, agg string, e E) error
    Load(ctx context.Context, agg string) ([]E, error)
}
```

One event store per aggregate type.

---

## Summary

At senior level, a generic type is more than syntax — it is a piece of API surface with constraints, identity, encapsulation, and evolution rules of its own. Pick narrow parameter lists, tight starting constraints, consistent receivers, and clear concurrency stories. Prefer composition to faux inheritance. Reserve `interface{}` (now `any`) for genuine heterogeneity; use generics where the relationship is "container of T" or "operation on T".

End of senior.md.

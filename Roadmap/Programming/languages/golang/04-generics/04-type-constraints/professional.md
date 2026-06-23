# Type Constraints — Professional Level

## Table of Contents
1. [Overview](#overview)
2. [Production Constraint Catalog](#production-constraint-catalog)
3. [Numeric Pipelines](#numeric-pipelines)
4. [Ordered Collections](#ordered-collections)
5. [Hashable Keys](#hashable-keys)
6. [Custom DSL Constraints](#custom-dsl-constraints)
7. [Library API Design](#library-api-design)
8. [Code Review Checklist](#code-review-checklist)
9. [Migration Strategies](#migration-strategies)
10. [Real-World Code Examples](#real-world-code-examples)
11. [Production Patterns](#production-patterns)
12. [Failure Modes](#failure-modes)
13. [Performance Engineering](#performance-engineering)
14. [Constraint Documentation Standards](#constraint-documentation-standards)
15. [Summary](#summary)

---

## Overview

This page is about constraints **in production code**: the trade-offs you make when shipping a library, when reviewing a teammate's PR, when migrating a 200k-line codebase from interface-based polymorphism to constraint-based generics.

Assumed knowledge: you can fluently read and write any constraint. You know `comparable` semantics across Go versions. You have your own constraint package in your project.

What we cover:
- What good production constraints look like.
- How to review them.
- How to evolve them safely across releases.
- How to teach them to a team.

---

## Production Constraint Catalog

A real production constraint package looks something like this. It is small. It is documented. It is stable.

```go
// Package mycorp/constraints is the canonical source of generic
// type constraints used across mycorp services.
//
// Add new entries cautiously: every constraint here is a public API
// commitment.
package constraints

import xc "golang.org/x/exp/constraints"

// Re-exports from x/exp. We re-export so consumers do not depend
// on x/exp directly; if it ever moves, only this file changes.
type (
    Integer  = xc.Integer
    Float    = xc.Float
    Ordered  = xc.Ordered
    Signed   = xc.Signed
    Unsigned = xc.Unsigned
    Complex  = xc.Complex
)

// Numeric is any integer or floating-point type.
//
// Type set:
//   ~int, ~int8 ... ~int64
//   ~uint, ~uint8 ... ~uint64, ~uintptr
//   ~float32, ~float64
type Numeric interface {
    Integer | Float
}

// Hashable is anything safely usable as a map key.
//
// We exclude interfaces because their dynamic type may not be
// comparable — see go.dev/blog/comparable.
type Hashable interface {
    Integer | Float | ~string | ~bool | ~complex64 | ~complex128
}

// Stringy is any type whose underlying type is string-shaped.
type Stringy interface {
    ~string | ~[]byte
}
```

That's the whole catalog. Twenty lines. A team of fifty engineers can rely on this and never write another constraint.

---

## Numeric Pipelines

A common production scenario: a data pipeline accepts numeric inputs, applies operations, and produces typed outputs. Constraints carry the type information end to end.

### Example: Telemetry rollup

```go
package rollup

import (
    "mycorp/constraints"
)

// Aggregator collects samples and produces a summary.
type Aggregator[T constraints.Numeric] struct {
    samples []T
}

func (a *Aggregator[T]) Add(x T) { a.samples = append(a.samples, x) }

func (a *Aggregator[T]) Sum() T {
    var s T
    for _, x := range a.samples {
        s += x
    }
    return s
}

func (a *Aggregator[T]) Mean() float64 {
    if len(a.samples) == 0 {
        return 0
    }
    return float64(a.Sum()) / float64(len(a.samples))
}
```

### Why Numeric and not Ordered?

Because `Mean` does division, which `~string` doesn't support. `Numeric` is the right floor.

### Why Numeric and not Float?

Because callers may have `Counter` types like `type RequestCount uint64`. We don't want to force them to convert.

### How a teammate might break it

By writing:

```go
func (a *Aggregator[T]) Median() T {
    sort.Slice(a.samples, func(i, j int) bool { return a.samples[i] < a.samples[j] })
    return a.samples[len(a.samples)/2]
}
```

This works for `Numeric` only by coincidence — `<` is supported by every type in `Numeric`. But if a future maintainer widens `Numeric` to include `~complex64`, `<` no longer works on complex numbers. The fix: narrow the constraint of `Median` itself:

```go
func Median[T constraints.Ordered](xs []T) T { ... }
```

Now `Median` declares its own (narrower) constraint and survives changes to `Numeric`.

---

## Ordered Collections

### Sorted slice with binary search

```go
package sorted

import (
    "sort"

    "mycorp/constraints"
)

type Slice[T constraints.Ordered] struct {
    data []T
}

func New[T constraints.Ordered]() *Slice[T] { return &Slice[T]{} }

func (s *Slice[T]) Insert(x T) {
    i := sort.Search(len(s.data), func(i int) bool { return s.data[i] >= x })
    s.data = append(s.data, x)
    copy(s.data[i+1:], s.data[i:])
    s.data[i] = x
}

func (s *Slice[T]) Contains(x T) bool {
    i := sort.Search(len(s.data), func(i int) bool { return s.data[i] >= x })
    return i < len(s.data) && s.data[i] == x
}
```

### Why `Ordered` (not `comparable`)?

Because we use `<`. `comparable` only gives `==` and `!=`.

### Why not `Numeric`?

Because users may have `string` keys. `Ordered` covers strings; `Numeric` does not.

---

## Hashable Keys

### Sharded LRU cache

```go
package cache

import (
    "container/list"
    "sync"
)

type Hashable interface {
    ~int | ~int64 | ~string
}

type LRU[K Hashable, V any] struct {
    mu       sync.Mutex
    capacity int
    items    map[K]*list.Element
    order    *list.List
}

type entry[K Hashable, V any] struct {
    k K
    v V
}

func New[K Hashable, V any](cap int) *LRU[K, V] {
    return &LRU[K, V]{
        capacity: cap,
        items:    make(map[K]*list.Element),
        order:    list.New(),
    }
}

func (c *LRU[K, V]) Get(k K) (V, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if e, ok := c.items[k]; ok {
        c.order.MoveToFront(e)
        return e.Value.(*entry[K, V]).v, true
    }
    var zero V
    return zero, false
}

func (c *LRU[K, V]) Put(k K, v V) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if e, ok := c.items[k]; ok {
        e.Value.(*entry[K, V]).v = v
        c.order.MoveToFront(e)
        return
    }
    e := c.order.PushFront(&entry[K, V]{k: k, v: v})
    c.items[k] = e
    if c.order.Len() > c.capacity {
        oldest := c.order.Back()
        c.order.Remove(oldest)
        delete(c.items, oldest.Value.(*entry[K, V]).k)
    }
}
```

### Why a custom `Hashable` instead of `comparable`?

Because we want to exclude struct keys (they may have non-comparable fields and panic at runtime) and interface keys (Go 1.20+ `comparable` allows them but they panic on slice values inside).

This is **deliberately stricter** than `comparable`. In production code that handles untrusted keys, this is often the right call.

---

## Custom DSL Constraints

When you build a domain-specific language in Go, constraints encode the grammar at the type level.

### Example: a typed query builder

```go
package query

// Selectable marks a value that can appear in a SELECT clause.
type Selectable interface {
    isSelectable()
}

type Column struct{ Name string }
func (Column) isSelectable() {}

type Aggregate struct {
    Func string
    Col  Column
}
func (Aggregate) isSelectable() {}

type Literal[T constraint.Hashable] struct{ Value T }
func (Literal[T]) isSelectable() {}

func Select[S Selectable](items ...S) *Query { ... }
```

The `isSelectable()` method element acts as a **sealed marker**: only types declared in this package can satisfy `Selectable`. The constraint enforces grammar.

### When to use sealed-marker constraints

- Building a small, closed DSL.
- Wanting to prevent third parties from adding new "kinds".
- Building exhaustive switches in a type-safe way.

### When **not** to

- When extensibility is a feature.
- When the DSL is large enough that you want documentation, not enforcement, to guide users.

---

## Library API Design

### Rule 1: Constraints are part of your public API

If `mylib.Foo[T constraints.Integer]` is exported, your users see `constraints.Integer`. Removing `int8` from it is a breaking change.

### Rule 2: Re-export to insulate

Always re-export third-party constraints under your own names:

```go
package mylib

import xc "golang.org/x/exp/constraints"

type Integer = xc.Integer
```

Now if Go's standard library finally adopts `constraints`, you change one line.

### Rule 3: Version constraints with the rest of your API

Adding a constraint? Minor version. Narrowing a constraint? Major version. Document it in your CHANGELOG with type-set deltas.

### Rule 4: Examples in godoc

Every exported constraint should have an `Example` showing a satisfying type:

```go
// Numeric is any integer or floating-point type.
//
//   func Sum[T Numeric](xs []T) T { ... }
//
//   Sum([]int{1,2,3})       // ok
//   Sum([]float64{1.5})     // ok
//   Sum([]string{"a"})      // does not compile
type Numeric interface { Integer | Float }
```

### Rule 5: Return concrete error messages

If a generic API may panic for non-satisfying calls (rare but possible with `any`), recover and wrap:

```go
defer func() {
    if r := recover(); r != nil {
        err = fmt.Errorf("invalid type for Foo[T]: %v", r)
    }
}()
```

This is a band-aid; the right fix is to tighten the constraint.

---

## Code Review Checklist

When reviewing a PR that introduces or changes a constraint, walk this checklist:

```
[ ] Is the constraint necessary at all? (Could a method-only interface do?)
[ ] Are all the listed types prefixed with ~ where appropriate?
[ ] Does the constraint name describe a behaviour, not a type list?
[ ] Is the constraint documented with its full type set?
[ ] Does the constraint use composition (embedding) rather than copy-paste?
[ ] Does the constraint depend on x/exp/constraints? If so, is it via a re-export?
[ ] Is the constraint used in more than one place? If single-use, can it be inlined?
[ ] Does the constraint mix method elements and type elements? If yes, is that intentional?
[ ] Does the function body actually need the operations the constraint allows?
[ ] If comparable is used, is == actually called?
[ ] If the constraint is in a public API, is the change backward compatible?
[ ] Is there an example in godoc?
[ ] Does the test suite cover at least one user-defined wrapper type (to verify ~)?
[ ] If a method element is used, is the method-receiver type correct (T vs *T)?
[ ] Does the constraint admit any type that could panic at runtime (slices via any)?
```

A constraint that passes all 15 boxes is production-ready.

---

## Migration Strategies

### From `interface{}` parameters to generic constraints

Before:
```go
func Sum(xs []interface{}) interface{} {
    // type-switch hell
}
```

After:
```go
func Sum[T constraints.Numeric](xs []T) T { ... }
```

Migration steps:
1. Identify all callers.
2. Determine the actual type set in use (may be just `int`).
3. Pick the narrowest constraint covering all callers.
4. Add the generic version alongside the old one.
5. Migrate callers in batches.
6. Remove the old version after a deprecation cycle.

### From method-based polymorphism to type-element constraints

Before:
```go
type Numbery interface {
    Plus(Numbery) Numbery
}
```

After:
```go
func Plus[T Numeric](a, b T) T { return a + b }
```

The generic version is faster (no boxing) and forces fewer runtime checks. Migration is similar to the above: side by side, then remove.

### From local constraints to a shared package

When the same constraint shows up in three packages, factor it out. Add a constraint package, re-export everything, update imports.

---

## Real-World Code Examples

### Example 1: Generic event bus
```go
package eventbus

type Event interface {
    EventType() string
}

type Bus[E Event] struct {
    subs map[string][]func(E)
}

func New[E Event]() *Bus[E] {
    return &Bus[E]{subs: make(map[string][]func(E))}
}

func (b *Bus[E]) Subscribe(t string, f func(E)) {
    b.subs[t] = append(b.subs[t], f)
}

func (b *Bus[E]) Publish(e E) {
    for _, f := range b.subs[e.EventType()] {
        f(e)
    }
}
```

The method-element constraint `Event` lets the bus call `EventType()` to route messages without type assertions.

### Example 2: Generic config loader
```go
package config

import (
    "os"
    "strconv"

    "mycorp/constraints"
)

func GetInt[T constraints.Integer](key string, def T) T {
    raw := os.Getenv(key)
    if raw == "" {
        return def
    }
    n, err := strconv.ParseInt(raw, 10, 64)
    if err != nil {
        return def
    }
    return T(n)
}

func GetFloat[T constraints.Float](key string, def T) T {
    raw := os.Getenv(key)
    if raw == "" {
        return def
    }
    f, err := strconv.ParseFloat(raw, 64)
    if err != nil {
        return def
    }
    return T(f)
}
```

### Example 3: Pagination cursor
```go
package pagination

import "mycorp/constraints"

type Cursor[K constraints.Ordered] struct {
    Last K
}

type Page[K constraints.Ordered, V any] struct {
    Items  []V
    Cursor Cursor[K]
}

func After[K constraints.Ordered](xs []K, last K) []K {
    var out []K
    for _, x := range xs {
        if x > last {
            out = append(out, x)
        }
    }
    return out
}
```

### Example 4: Validation rules
```go
package validate

type Rule[T any] interface {
    Check(T) error
}

type Min[T constraints.Ordered] struct {
    Value T
}

func (m Min[T]) Check(x T) error {
    if x < m.Value {
        return fmt.Errorf("value %v < %v", x, m.Value)
    }
    return nil
}
```

### Example 5: Resource pool
```go
package pool

type Resource interface {
    Close() error
    Healthy() bool
}

type Pool[R Resource] struct {
    items chan R
    new   func() (R, error)
}
```

`Resource` is a method-element constraint that ensures every `R` we hold can be closed and health-checked.

### Example 6: Graph node set
```go
package graph

import "mycorp/constraints"

type Node[ID constraints.Hashable] struct {
    ID    ID
    Edges []ID
}

type Graph[ID constraints.Hashable] struct {
    Nodes map[ID]Node[ID]
}
```

### Example 7: Type-safe option pattern
```go
package server

type Option[T any] func(*T)

func Apply[T any](t *T, opts ...Option[T]) {
    for _, o := range opts { o(t) }
}
```

### Example 8: Runtime metric typed by units
```go
package metrics

type Unit interface {
    UnitName() string
}

type Bytes struct{}
func (Bytes) UnitName() string { return "bytes" }

type Seconds struct{}
func (Seconds) UnitName() string { return "seconds" }

type Metric[U Unit, T constraints.Float] struct {
    Unit  U
    Value T
}
```

### Example 9: Strict-comparable cache key
```go
type StrictHashable interface {
    ~int | ~int64 | ~uint | ~uint64 | ~string
}

func WithKey[K StrictHashable](m map[K]int, k K) int {
    return m[k]
}
```

### Example 10: Workflow stage constraint
```go
package workflow

type Stage interface {
    Run() error
}

type Sequence[S Stage] struct {
    stages []S
}

func (s *Sequence[S]) Execute() error {
    for _, st := range s.stages {
        if err := st.Run(); err != nil {
            return err
        }
    }
    return nil
}
```

---

## Production Patterns

### Pattern 1: One constraint package per service / module
Big org? One per service. Small org? One per repo. Avoid duplication across packages.

### Pattern 2: Constraints close to consumers
If a constraint is used by exactly one function, put it next to that function. Don't lift to the constraints package prematurely.

### Pattern 3: Test the constraint with wrapper types
Every public constraint should have a unit test that instantiates a generic with a `type X int`-style wrapper. This proves `~` is in place.

```go
func TestSumAcceptsWrapper(t *testing.T) {
    type Money int64
    got := Sum([]Money{1, 2, 3})
    if got != 6 {
        t.Fatalf("got %d", got)
    }
}
```

### Pattern 4: Document the panic risks
If a constraint admits types that may panic at `==` (e.g., `comparable` with `any`), document it loudly.

### Pattern 5: Avoid generic methods on generic types
Methods on generic types cannot have additional type parameters in Go 1.18+. If you need that, refactor to a generic function.

---

## Failure Modes

### Failure 1: A new type wrapper breaks the build
A user adds `type Counter uint64`, calls `Sum(counters)`, and you forgot `~`. They see a confusing error. **Fix:** add `~`.

### Failure 2: Runtime panic from over-permissive constraint
You used `comparable` with `any`. A caller passes a slice. Boom. **Fix:** narrow to a strict-hashable constraint.

### Failure 3: Constraint becomes unsatisfiable after refactor
You added a method element to a constraint that already had a `~int` element. No `int`-shaped type has the method. Compilation breaks for everyone. **Fix:** restore the previous constraint and split into two.

### Failure 4: Type inference fails
Caller writes `Min(xs, 0)` and gets "cannot infer T". The literal `0` is untyped. **Fix:** either explicit type argument `Min[int](xs, 0)` or a different signature.

### Failure 5: x/exp/constraints removed
This is a hypothetical worst case. **Fix:** because you re-exported, change one file.

---

## Performance Engineering

### Hot loop check
Profile before and after introducing a generic. Compare:
- Generic with type-element constraint: usually equivalent to hand-written.
- Generic with method-element constraint: a method dispatch per call; can be slower in tight loops.
- Generic with `any`: may box; profile carefully.

### GC shape stenciling
Go monomorphizes per **GC shape**, not per concrete type. That means `int` and `int32` may share code if they have the same shape. In practice they don't (different sizes), but pointer-shaped types often do. Read the runtime's `internal/dictgen` package if you need the gory details.

### Avoid the dictionary penalty
A dictionary is a runtime structure carried into a generic call to provide type information. For pure type-element constraints with simple shapes, it's effectively free. For constraints with method elements, the dictionary holds the method table — non-trivial.

---

## Constraint Documentation Standards

For every exported constraint:

```go
// Numeric is the constraint of any integer or floating-point type.
//
// # Type set
//
//   ~int, ~int8, ~int16, ~int32, ~int64
//   ~uint, ~uint8, ~uint16, ~uint32, ~uint64, ~uintptr
//   ~float32, ~float64
//
// # Operations available
//
//   + - * / < <= > >= == !=
//
// # Examples
//
//   func Sum[T Numeric](xs []T) T { ... }
//   func Mean[T Numeric](xs []T) float64 { ... }
//
// # See also
//
//   Integer, Float, Ordered
type Numeric interface {
    Integer | Float
}
```

This template is enough for any team. Adopt it.

---

## Summary

Production constraints are small, documented, composable, and stable. Re-export third-party constraints to insulate your code. Test wrapper types to verify `~`. Review constraints with a checklist. Treat them as part of your stable API. When in doubt, make them more permissive — narrowing is breaking, widening is not. A team with a 20-line constraint package and a strict review checklist will outperform a team that scatters ad-hoc constraints across 50 files.

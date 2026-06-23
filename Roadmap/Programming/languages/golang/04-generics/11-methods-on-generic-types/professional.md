# Methods on Generic Types — Professional Level

## Table of Contents
1. [Interface satisfaction with generic types](#interface-satisfaction-with-generic-types)
2. [The "no universal generic interface" rule](#the-no-universal-generic-interface-rule)
3. [Designing public APIs around generic methods](#designing-public-apis-around-generic-methods)
4. [Choosing receivers for library types](#choosing-receivers-for-library-types)
5. [Generic methods in stdlib (`atomic.Pointer[T]`, `sync.OnceValue[T]`)](#generic-methods-in-stdlib-atomicpointert-synconcevaluet)
6. [API stability and migration](#api-stability-and-migration)
7. [Anti-patterns in generic-method APIs](#anti-patterns-in-generic-method-apis)
8. [Summary](#summary)

---

## Interface satisfaction with generic types

A specific instantiation of a generic type satisfies an interface in the **usual** way — the method set of `T[Foo]` is checked against the interface's method set:

```go
type Stack[T any] struct{ data []T }
func (s *Stack[T]) Push(v T) { s.data = append(s.data, v) }

type IntPusher interface {
    Push(int)
}

var p IntPusher = &Stack[int]{}   // OK — Stack[int].Push has signature func(int)
```

The check happens **after instantiation**: `Stack[int]` has `Push(int)`, which matches `IntPusher.Push(int)`.

### Each instantiation has its own satisfaction relation

```go
var pi IntPusher = &Stack[int]{}     // OK
var ps StringPusher = &Stack[string]{} // OK
var px IntPusher = &Stack[string]{}   // ❌ Push(string) does not match Push(int)
```

Even though all three are `*Stack[T]`, only the **right** instantiation satisfies a given interface.

---

## The "no universal generic interface" rule

A generic type does **not** satisfy any interface "universally" — only specific instantiations do.

```go
type Box[T any] struct{ v T }
func (b Box[T]) Get() T { return b.v }

type AnyGetter interface {
    Get() any
}

var g AnyGetter = Box[int]{}  // ❌ — Box[int].Get returns int, not any
```

You cannot ask "does `Box[T]` satisfy `interface { Get() any }` for every `T`?" — the answer is no, because `Get` returns `T`, not `any`.

### Why this matters

This rule prevents the C++/Java "raw type" trap. In Java, `Box` (raw) can be assigned to `Box<Object>` after an unchecked cast — bugs follow. Go simply forbids it: each instantiation is a distinct type, and each is checked against the interface separately.

### Workaround — generic interface

To express "any `Box`, regardless of `T`", you need a generic interface:

```go
type Getter[T any] interface {
    Get() T
}

func Use[T any](g Getter[T]) T { return g.Get() }

Use(Box[int]{v: 1})       // T inferred as int
Use(Box[string]{v: "hi"}) // T inferred as string
```

The interface itself takes a type parameter. The caller (or inference) picks `T`.

### Workaround — wrap with `any`

A second workaround is an explicit `any` wrapper:

```go
type AnyGetter interface { Get() any }

type AnyBox[T any] struct{ Box[T] }
func (b AnyBox[T]) Get() any { return b.v }   // returns any, not T

var g AnyGetter = AnyBox[int]{Box: Box[int]{v: 1}}
```

This loses generics' type safety on the boundary. Use sparingly.

---

## Designing public APIs around generic methods

Building a library with generic types is a different discipline than building one with concrete types. Senior-level design rules:

### Rule 1 — Constraint as part of the contract

The type's constraint is permanently part of the public API. Loosening is a **breaking change** in some cases (e.g., when callers depend on operators); tightening is **always** breaking.

```go
// v1
type Container[T any] struct{ ... }

// v2 — tightening to comparable BREAKS callers using slices, maps as T
type Container[T comparable] struct{ ... }
```

Pick the constraint carefully **before** v1.

### Rule 2 — Method names should not encode the type

Avoid:
```go
func (s *Stack[T]) PushInt(v T)  // bad — name lies if T is not int
```

Prefer:
```go
func (s *Stack[T]) Push(v T)
```

### Rule 3 — Provide both a generic and a concrete API for hot paths

If `Stack[int]` is a common case, exporting a non-generic helper avoids dictionary indirection in hot loops:

```go
func PushInts(s *Stack[int], vs ...int) { for _, v := range vs { s.Push(v) } }
```

### Rule 4 — Document the constraint clearly

godoc shows the constraint, but readers often skim. A short sentence helps:

```go
// Stack is a LIFO container of any element type.
// Element type T may be any type, including non-comparable types.
type Stack[T any] struct{ ... }
```

### Rule 5 — Avoid exposing internal generic helpers

Keep package-internal generic helpers in `internal/`. Public generic surface should be small and stable.

---

## Choosing receivers for library types

For a library that exports `Stack[T]`, the receiver choice matters more than for application code.

### Library guidelines

| Situation | Receiver |
|-----------|----------|
| Type contains slice/map/pointer fields | Pointer |
| Type is a small wrapper (1-2 scalars) | Value |
| Type implements an interface that requires pointer | Pointer (or value, consistent) |
| Methods mutate state | Pointer |
| Type is meant to be passed by value | Value |

### Mixed receivers — a common smell

A library that mixes `(s *Stack[T])` and `(s Stack[T])` confuses callers — the method set differs:

```go
// Stack[T] method set: { Len() int }              (just the value receiver)
// *Stack[T] method set: { Push(v T), Pop() (T, bool), Len() int }  (both)
```

Callers passing a `Stack[int]` (value) cannot call `Push`. Pick one style and stick with it.

### Stdlib precedent

`atomic.Pointer[T]` uses **pointer receiver** for `Store`, `Load`, `Swap`, `CompareAndSwap`. `sync.OnceValue[T]` is a function, not a type. The stdlib is consistent: containers and stateful types use pointer receivers.

---

## Generic methods in stdlib (`atomic.Pointer[T]`, `sync.OnceValue[T]`)

The Go standard library's generic types are **textbook** designs.

### `atomic.Pointer[T]`

```go
package atomic

type Pointer[T any] struct {
    _ noCopy
    _ [0]*T
    v unsafe.Pointer
}

func (p *Pointer[T]) Load() *T { ... }
func (p *Pointer[T]) Store(val *T) { ... }
func (p *Pointer[T]) Swap(new *T) (old *T) { ... }
func (p *Pointer[T]) CompareAndSwap(old, new *T) bool { ... }
```

Lessons:

1. **Pointer receivers throughout** — atomic ops require addressable storage.
2. **`noCopy` marker** — prevents accidental value-copying that breaks atomicity.
3. **`[0]*T` field** — keeps the GC happy by remembering the element type.
4. **Single-letter type parameter** (`T`) — minimal noise.
5. **Methods all return `*T`** — the type parameter flows through return values.

### `sync.OnceValue[T]` (Go 1.21+)

```go
func OnceValue[T any](f func() T) func() T { ... }
```

Not a type — a free generic function that returns a closure. **No methods needed**. This pattern is common when state can be hidden inside a closure.

### `slices.Map`-style — free functions, not methods

The `slices` and `maps` packages use free generic functions, not methods on a generic slice type:

```go
func slices.Map[S ~[]E, E, R any](s S, f func(E) R) []R { ... }
```

Why? Because the operation **changes the element type** (`E → R`). Methods cannot do that in Go. Stdlib chose free functions.

### Lesson — when to use methods, when to use free functions

| Use a method when | Use a free function when |
|-------------------|---------------------------|
| Operation is in-type | Operation changes the type parameter |
| Operation needs receiver state | Operation is pure |
| Method-call syntax aids readability | Method-call syntax does not fit |
| API is already method-heavy | Symmetric across multiple types |

---

## API stability and migration

Generic types and their methods carry **forward-compatibility pitfalls** that concrete types do not.

### Adding a new method — non-breaking

Like classic Go, adding a method is non-breaking unless callers' interfaces grew incidentally.

### Removing a method — breaking

Same as classic Go.

### Adding a type parameter — breaking

```go
// v1
type Cache[K comparable] struct{ ... }
func (c *Cache[K]) Set(k K, v string) { ... }

// v2 — adds value type parameter
type Cache[K comparable, V any] struct{ ... }
func (c *Cache[K, V]) Set(k K, v V) { ... }
```

Every caller's `Cache[string]` becomes `Cache[string, string]` (or whatever default). All existing instantiations break. **Major-version bump required.**

### Removing a type parameter — breaking

Symmetric; also requires a major-version bump.

### Tightening a constraint — usually breaking

```go
// v1
type Container[T any] struct{ ... }

// v2
type Container[T comparable] struct{ ... }
```

Callers using `Container[[]int]` now fail to compile. Major-version bump.

### Loosening a constraint — sometimes breaking

If callers wrote interface satisfaction code that depended on the tighter constraint, loosening can break them. Less common but possible.

### Migration playbook

1. **Plan the type parameter list before v1.** Future additions are expensive.
2. **Use `golang-lru/v2`-style** new module path for breaking changes.
3. **Add deprecation notices** before removal: `// Deprecated: use NewMethod instead.`
4. **Provide migration tools** — sometimes a simple `gofmt -r` rewrite works.
5. **Document the constraint precisely** so users do not depend on accidental properties.

---

## Anti-patterns in generic-method APIs

Patterns to avoid in production-quality generic libraries.

### Anti-pattern 1 — Method-name parameter encoding

```go
type Repo[T any] struct{ ... }
func (r *Repo[T]) FindString(q string) ([]T, error) { ... }
func (r *Repo[T]) FindInt(q int) ([]T, error) { ... }
```

If you find yourself appending the type to method names, you probably want a generic method (or a free function). The explicit suffix defeats the point.

### Anti-pattern 2 — Methods that "really need" a method-level type parameter

```go
type Stream[T any] struct{ ... }

// Wishful thinking — does not compile
func (s Stream[T]) Map[U any](f func(T) U) Stream[U] { ... }
```

Workaround: free function. If your library has many "shape-changing" operations, **all of them** must be free functions. That is fine.

### Anti-pattern 3 — Hidden interface assertion in a generic method

```go
type Box[T any] struct{ v T }

func (b Box[T]) Print() {
    if s, ok := any(b.v).(fmt.Stringer); ok {
        fmt.Println(s.String())
    } else {
        fmt.Println(b.v)
    }
}
```

You wrote a generic method but did runtime dispatch. The pattern works but loses type safety. Use a constraint instead:

```go
func (b Box[T]) Print() where T: fmt.Stringer ... // Go does not have this syntax
// Workaround:
type StringerBox[T fmt.Stringer] struct{ v T }
func (b StringerBox[T]) Print() { fmt.Println(b.v.String()) }
```

### Anti-pattern 4 — Inconsistent receivers

Half the methods use `*T`, half use `T`. The method set is broken depending on how callers hold the value. Choose and stick.

### Anti-pattern 5 — Exporting internals through generic types

```go
type Cache[T MyInternal] struct{ ... }
```

Now every caller is bound to `MyInternal`. Either keep the type internal or expose a concrete-or-`any` API.

### Anti-pattern 6 — Method explosion

```go
type Repo[T any] struct{ ... }
func (r *Repo[T]) FindByName(...) ...
func (r *Repo[T]) FindByID(...) ...
func (r *Repo[T]) FindByEmail(...) ...
func (r *Repo[T]) FindByPhone(...) ...
// 30 more
```

A generic type with 30 methods is a smell. Split responsibilities — query helpers as free functions, core CRUD on the type.

---

## Summary

Designing public APIs with generic methods means living with three permanent constraints:

1. **Each instantiation is its own type.** Interface satisfaction is per instantiation.
2. **No method-level type parameters.** Free functions fill the gap.
3. **Type parameter list is part of the API.** Adding/removing parameters is a breaking change.

The mature approach: study `atomic.Pointer[T]`, `sync.OnceValue[T]`, and `slices.*` for patterns. Use methods when the operation stays in-type, free functions when it changes the parameter shape. Keep public surface small. Document constraints. Plan the type parameter list before the first release.

Generic-method APIs that age well are **boring**: short method lists, single-letter parameters, consistent receivers, and an explicit free-function library for the shape-changing operations. Excitement here is a smell.

The next file (`specification.md`) digs into the formal grammar that the spec uses for method declarations and parameterised receivers.

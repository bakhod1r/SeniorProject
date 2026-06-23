# Generic Types & Interfaces — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What is a generic type?" and "How do I use it?"

In Go 1.18 the language gained generics. We have already met **generic functions** in section 4.2 (`func Map[T, U any](...)`). But generics are not limited to functions — you can also parameterize **types**. A *generic type* is a type whose definition holds one or more **type parameters**:

```go
// Stack[T] — a generic type. T is a type parameter.
type Stack[T any] struct {
    items []T
}
```

Until you choose a concrete type for `T`, `Stack[T]` is just a *blueprint*. The moment you write `Stack[int]` or `Stack[string]`, the compiler creates a real, usable type — this is called **instantiation**. From that point on, `Stack[int]` behaves exactly like a normal struct: you can declare variables of it, build methods on it, and pass values around.

```go
var s Stack[int]                // instantiated
s.items = append(s.items, 42)   // works exactly like []int
```

**Why does this matter?** Before generics, every reusable container in Go either used `interface{}` (boxing, type assertions, lost compile-time safety) or required code generation. Generic types let you write a `Stack`, `Queue`, `Tree`, `Set`, `Cache`, or `Result` once and reuse it for any element type — with full type safety and no boxing.

**Generic interfaces** extend the same idea. An interface can declare a type parameter (`type Iterator[T any] interface { ... }`) and use it in its method signatures. You can also write *type sets* inside an interface — a list of allowed underlying types — to use the interface as a **constraint**.

```go
type Iterator[T any] interface {
    Next() (T, bool)
}

type Number interface {
    int | int64 | float64
}
```

After reading this file you will:
- Understand the syntax for declaring a generic struct, generic slice, and generic interface
- Know how to instantiate a generic type (`Stack[int]`)
- Be able to write methods that use the receiver's type parameters
- Recognize the difference between a generic interface used as a *constraint* and one used as an *iface value*
- Build small reusable structures: `Stack[T]`, `Queue[T]`, `Pair[K, V]`, `Result[T]`, `Option[T]`

---

## Prerequisites
- Comfortable with `struct`, methods, and basic interfaces (sections 1–3 of this roadmap)
- A read-through of section **4.1 — Why Generics?** and **4.2 — Generic Functions**
- Understand `any` (alias for `interface{}` since Go 1.18)
- Go 1.18 or newer installed (`go version`)
- Familiar with `go run`, `go test`, `go build`

---

## Glossary

| Term | Definition |
|------|------------|
| **Generic type** | A type whose definition has one or more type parameters, e.g. `type Stack[T any] struct{...}` |
| **Type parameter** | A placeholder name (commonly `T`, `K`, `V`, `E`) that stands for an unknown type |
| **Type parameter list** | The bracketed list right after the type name: `[T any]`, `[K comparable, V any]` |
| **Type constraint** | The interface following each type parameter; restricts what types may be used |
| **Instantiation** | Filling in concrete types for the parameters: `Stack[int]`, `Pair[string, User]` |
| **Instantiated type** | The concrete type produced by instantiation; behaves like a normal type |
| **Generic interface** | An interface whose methods or type set reference a type parameter |
| **Type set** | The set of underlying types listed inside an interface using `|` (union) |
| **Constraint interface** | An interface used in a type parameter list (not as a value type) |
| **Method receiver type parameters** | The type parameters carried by the receiver: `func (s *Stack[T]) Push(v T)` |
| **Type identity** | Whether two types are the same; `Stack[int]` and `Stack[string]` are distinct types |
| **Underlying type** | The structural type a defined type is built on |

---

## Core Concepts

### 1. Generic struct type

A struct can hold fields whose types depend on a type parameter:

```go
type Pair[K comparable, V any] struct {
    Key   K
    Value V
}

func main() {
    p := Pair[string, int]{Key: "age", Value: 30}
    fmt.Println(p.Key, p.Value) // age 30
}
```

`Pair[string, int]` is now a fully formed type. You can pass it to functions, store it in slices (`[]Pair[string, int]`), and define methods on `Pair`.

### 2. Generic slice / array / map alias

You can wrap any composite type:

```go
type Stack[T any] struct {
    items []T
}

type Matrix[T any] [][]T

type Index[K comparable, V any] map[K]V
```

### 3. Methods on generic types

Methods on a generic type **must reuse the receiver's type parameters** — they cannot introduce new ones:

```go
type Stack[T any] struct {
    items []T
}

func (s *Stack[T]) Push(v T) {
    s.items = append(s.items, v)
}

func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    if len(s.items) == 0 {
        return zero, false
    }
    n := len(s.items) - 1
    v := s.items[n]
    s.items = s.items[:n]
    return v, true
}
```

The receiver `(s *Stack[T])` carries the parameter `T` so that `Push(v T)` and the local variable `var zero T` know what `T` is. **You may not write** `func (s *Stack[T]) Convert[U any](...)` — methods cannot add their own type parameters. (See `middle.md` for details.)

### 4. Generic interface — used as a *value type*

An interface can hold a type parameter inside its method signatures:

```go
type Iterator[T any] interface {
    Next() (T, bool)
}

type IntList struct {
    items []int
    idx   int
}

func (l *IntList) Next() (int, bool) {
    if l.idx >= len(l.items) {
        return 0, false
    }
    v := l.items[l.idx]
    l.idx++
    return v, true
}

func main() {
    var it Iterator[int] = &IntList{items: []int{1, 2, 3}}
    for {
        v, ok := it.Next()
        if !ok { break }
        fmt.Println(v)
    }
}
```

Here `Iterator[int]` is an instantiated interface — exactly like a normal interface, but the method signatures are specialised to `int`.

### 5. Generic interface — used as a *constraint*

The same interface mechanism is reused to describe what types are allowed for a type parameter. When an interface is used in a `[T constraint]` position, it can also list a *type set*:

```go
type Number interface {
    int | int64 | float32 | float64
}

func Sum[T Number](xs []T) T {
    var total T
    for _, x := range xs {
        total += x
    }
    return total
}
```

`Number` is used here as a **constraint**. You cannot use `Number` as a regular interface value because a type set with `|` makes it a constraint-only interface. (Section 4.4 covers this in depth.)

### 6. Instantiation

Whenever you write `Stack[int]`, `Pair[string, User]`, or `Iterator[error]`, the compiler creates the concrete type:

```go
var a Stack[int]
var b Stack[string]
// a and b are different types — you cannot assign between them.
```

In simple cases the compiler can infer the type parameters from the value used (especially for functions). For type names, you usually write the parameters explicitly. (Section 4.5 — Type Inference.)

---

## Real-World Analogies

**Analogy 1 — Recipe vs cooked meal**

A generic type is like a *recipe*: "stir-fry with vegetable X". Until you choose X (broccoli, zucchini, asparagus), the dish does not exist. The instantiated type `Stack[int]` is the cooked meal — concrete and ready to serve.

**Analogy 2 — Cardboard box label**

`Stack[T]` is a labeled box with "T" written on it. When you label it `Stack[Book]`, it becomes a book box. The shape of the box is the same; what you put inside is fixed at labeling time. Once labeled, you cannot suddenly stuff DVDs in there — that is type safety.

**Analogy 3 — Parametric clothing pattern**

A clothing pattern declares a *size*: small, medium, large. The pattern is the generic type. Each *cut* of fabric using a specific size is an instantiation.

**Analogy 4 — Function vs type — same idea, different scope**

A generic function `Map[T, U]` chooses its parameters at each call. A generic type `Stack[T]` chooses its parameter at each *declaration* of a variable. The parameter then sticks with that variable for its whole life.

---

## Mental Models

### Model 1: A generic type is a *type-level function*

```
Stack : Type -> Type
Stack(int)    = Stack[int]    // concrete type
Stack(string) = Stack[string] // a different concrete type
Pair  : (Type, Type) -> Type
```

You feed types in, you get a type out. Once instantiated, the result is identical in spirit to any hand-written struct.

### Model 2: Two interfaces — same syntax, two roles

```
interface { ... }
   ├── as value → can hold a value, supports method calls (regular interface)
   └── as constraint → describes which types may be used (no value can be of this type when type sets are present)
```

### Model 3: Methods inherit receiver's type parameters

```
type Box[T any] struct { v T }
        │
        ▼
func (b *Box[T]) Get() T { return b.v }
                   ▲
        Same T as on receiver — methods do not add new type parameters
```

---

## Pros & Cons

### Generic struct types

| Pros | Cons |
|------|------|
| Type-safe containers without `interface{}` | Slightly more verbose syntax |
| One implementation, many element types | Compile time can rise on heavy use |
| Removes need for code generation | Methods cannot add new type parameters |
| Works for queues, stacks, trees, caches, sets | Type identity is per-instantiation (`Stack[int]` ≠ `Stack[string]`) |

### Generic interfaces

| Pros | Cons |
|------|------|
| Specialised method signatures (`Next() T`) | Cannot mix value-mode and constraint-mode in the same definition |
| Reusable iterator/visitor patterns | Type-set interfaces cannot be used as a value type |
| Fits well with constraints in 4.4 | Beginners often confuse the two roles |

---

## Use Cases

### Generic struct types
1. **Containers** — `Stack[T]`, `Queue[T]`, `LinkedList[T]`, `Set[T]`, `Tree[T]`
2. **Tuple-like values** — `Pair[K, V]`, `Triple[A, B, C]`
3. **Result / option wrappers** — `Result[T]`, `Option[T]`
4. **Caches with typed values** — `Cache[K, V]`
5. **Channels of typed events** — `EventBus[E]`
6. **Domain-specific aggregates** — `Money[C Currency]`

### Generic interfaces
1. **Iterators** — `Iterator[T] { Next() (T, bool) }`
2. **Encoders/decoders** — `Codec[T] { Encode(T) []byte; Decode([]byte) (T, error) }`
3. **Repositories** — `Repository[T] { Get(id ID) (T, error) }`
4. **Visitors** — `Visitor[T] { Visit(T) error }`
5. **Comparators** — `Comparator[T] { Compare(a, b T) int }`

---

## Code Examples

### Example 1: `Stack[T]` — push/pop/peek

```go
package main

import "fmt"

type Stack[T any] struct {
    items []T
}

func NewStack[T any]() *Stack[T] {
    return &Stack[T]{items: make([]T, 0, 8)}
}

func (s *Stack[T]) Push(v T)        { s.items = append(s.items, v) }
func (s *Stack[T]) Len() int        { return len(s.items) }
func (s *Stack[T]) IsEmpty() bool   { return len(s.items) == 0 }

func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    if s.IsEmpty() {
        return zero, false
    }
    n := len(s.items) - 1
    v := s.items[n]
    s.items = s.items[:n]
    return v, true
}

func (s *Stack[T]) Peek() (T, bool) {
    var zero T
    if s.IsEmpty() {
        return zero, false
    }
    return s.items[len(s.items)-1], true
}

func main() {
    s := NewStack[int]()
    s.Push(1); s.Push(2); s.Push(3)
    for !s.IsEmpty() {
        v, _ := s.Pop()
        fmt.Println(v) // 3 2 1
    }
}
```

### Example 2: `Queue[T]` — FIFO

```go
type Queue[T any] struct {
    items []T
}

func (q *Queue[T]) Enqueue(v T) { q.items = append(q.items, v) }

func (q *Queue[T]) Dequeue() (T, bool) {
    var zero T
    if len(q.items) == 0 {
        return zero, false
    }
    v := q.items[0]
    q.items = q.items[1:]
    return v, true
}
```

### Example 3: `LinkedList[T]`

```go
type node[T any] struct {
    value T
    next  *node[T]
}

type LinkedList[T any] struct {
    head *node[T]
    size int
}

func (l *LinkedList[T]) Prepend(v T) {
    l.head = &node[T]{value: v, next: l.head}
    l.size++
}

func (l *LinkedList[T]) Len() int { return l.size }

func (l *LinkedList[T]) ForEach(fn func(T)) {
    for n := l.head; n != nil; n = n.next {
        fn(n.value)
    }
}
```

Notice that the unexported helper `node[T]` is also generic and parameterised on the same `T`.

### Example 4: `Tree[T]` — binary tree

```go
type Tree[T any] struct {
    value       T
    left, right *Tree[T]
}

func (t *Tree[T]) Insert(v T, less func(a, b T) bool) *Tree[T] {
    if t == nil {
        return &Tree[T]{value: v}
    }
    if less(v, t.value) {
        t.left = t.left.Insert(v, less)
    } else {
        t.right = t.right.Insert(v, less)
    }
    return t
}

func (t *Tree[T]) InOrder(visit func(T)) {
    if t == nil {
        return
    }
    t.left.InOrder(visit)
    visit(t.value)
    t.right.InOrder(visit)
}
```

We pass `less` from outside instead of using a constraint like `cmp.Ordered` so this example stays minimal. (Real code would use `cmp.Ordered` — see 4.4.)

### Example 5: `Pair[K, V]`

```go
type Pair[K comparable, V any] struct {
    Key   K
    Value V
}

func NewPair[K comparable, V any](k K, v V) Pair[K, V] {
    return Pair[K, V]{Key: k, Value: v}
}
```

### Example 6: `Result[T]`

```go
type Result[T any] struct {
    value T
    err   error
}

func Ok[T any](v T) Result[T]       { return Result[T]{value: v} }
func Err[T any](err error) Result[T] { return Result[T]{err: err} }

func (r Result[T]) Unwrap() (T, error) { return r.value, r.err }
func (r Result[T]) IsOk() bool         { return r.err == nil }
```

Usage:

```go
func parseAge(s string) Result[int] {
    n, err := strconv.Atoi(s)
    if err != nil { return Err[int](err) }
    return Ok(n)
}
```

### Example 7: `Option[T]`

```go
type Option[T any] struct {
    value T
    has   bool
}

func Some[T any](v T) Option[T]   { return Option[T]{value: v, has: true} }
func None[T any]() Option[T]      { return Option[T]{} }

func (o Option[T]) Get() (T, bool) { return o.value, o.has }
```

### Example 8: Generic interface — `Iterator[T]`

```go
type Iterator[T any] interface {
    Next() (T, bool)
}

type sliceIter[T any] struct {
    s []T
    i int
}

func NewSliceIter[T any](s []T) Iterator[T] {
    return &sliceIter[T]{s: s}
}

func (it *sliceIter[T]) Next() (T, bool) {
    var zero T
    if it.i >= len(it.s) {
        return zero, false
    }
    v := it.s[it.i]
    it.i++
    return v, true
}
```

### Example 9: Generic interface as constraint — `Number`

```go
type Number interface {
    ~int | ~int64 | ~float64
}

func Sum[T Number](xs []T) T {
    var total T
    for _, x := range xs { total += x }
    return total
}
```

The `~` means "any type whose underlying type is one of these". (Constraints are covered in 4.4.)

---

## Coding Patterns

### Pattern 1: Constructor function

A generic type often comes with a `NewX[T]()` constructor — it makes call sites cleaner because Go can infer parameters more aggressively when calling functions:

```go
func NewStack[T any]() *Stack[T] {
    return &Stack[T]{items: make([]T, 0, 8)}
}
```

### Pattern 2: Pointer receiver for mutation

If your method modifies state (`Push`, `Pop`, `Insert`), use a pointer receiver `func (s *Stack[T])`. Otherwise the changes are made to a copy.

### Pattern 3: Zero value via `var zero T`

To return the zero value of `T` (when, say, `Pop` finds an empty stack):

```go
var zero T
return zero, false
```

This works for any `T` — even types you do not know in advance.

### Pattern 4: Hide implementation type, expose interface

```go
func NewSliceIter[T any](s []T) Iterator[T] {
    return &sliceIter[T]{s: s}
}
```

Callers see `Iterator[T]`, not `sliceIter[T]`. You can swap the underlying implementation later without breaking anything.

### Pattern 5: Pair `Result[T]` with constructors

`Ok[T](v)` and `Err[T](err)` make creating result values very natural and readable.

---

## Clean Code

- **Pick short, conventional parameter names.** `T` for a generic value, `K`/`V` for key/value, `E` for element, `A`/`B` for tuple-like.
- **Put the constraint where it adds real value.** Use `any` if you really do not need any constraint; do not invent meaningless constraints.
- **One generic type — one responsibility.** A `Stack[T]` should not also implement caching, persistence, and metrics. Compose smaller pieces.
- **Match exported / unexported casing.** If `T` is meant for users, the type is exported (`Stack`); if it is an internal helper, lowercase it (`node[T]`).
- **Document the constraint.** A doc comment over `func NewStore[T fmt.Stringer]` should say "T must be a Stringer because the cache key uses T.String()".

---

## Product Use / Feature

In a real product these are the everyday generic types you will reach for:

- **Configuration loader**: `Config[T]` returns a typed configuration block (`Config[DBOptions]`, `Config[CacheOptions]`).
- **Pagination wrapper**: `Page[T] { Items []T; Total int; NextCursor string }`.
- **API response envelope**: `Response[T] { Data T; Error string }`.
- **In-memory cache**: `Cache[K, V]`.
- **Channel-based event bus**: `EventBus[E]`.
- **Repository abstraction**: `Repository[T]` over a database table.

These reduce boilerplate dramatically while keeping types tight at API boundaries.

---

## Error Handling

Generic types do not change Go's error handling — keep returning `error`. Two patterns are common:

### 1. `(T, error)` style

```go
func (c *Cache[K, V]) Get(k K) (V, error) {
    var zero V
    v, ok := c.m[k]
    if !ok { return zero, ErrNotFound }
    return v, nil
}
```

### 2. `Result[T]` style

```go
func (c *Cache[K, V]) Get(k K) Result[V] {
    v, ok := c.m[k]
    if !ok { return Err[V](ErrNotFound) }
    return Ok(v)
}
```

Pick one style per package. Mixing both confuses callers.

---

## Security Considerations

- **No reflection magic.** Generic types do not bypass the visibility rules — unexported fields stay unexported across packages.
- **Untrusted input still needs validation.** A `Cache[string, []byte]` will happily store gigabytes if you do not bound it. Generics give you types, not safety policies.
- **Beware of `any` constraint.** `any` allows literally any value, including ones you cannot safely log or compare. Choose a tighter constraint when possible.
- **Do not store secrets in generic containers without thinking.** A `Stack[Token]` is just a `Stack` — it does not zero memory when popped. If you need that, write a specialized type.

---

## Performance Tips

- **Reserve capacity** in the constructor when you can: `make([]T, 0, 8)` for small stacks.
- **Pointer vs value** — for big structs, prefer `*BigStruct` as the element type to avoid copying.
- **Avoid converting between `Stack[T]` and `[]T` repeatedly** — wrap once and operate on the wrapper.
- **Generic methods on hot paths** — the Go compiler may use a single shared implementation for all pointer types (GC stenciling). For value types it monomorphises. The cost depends on `T`. See `optimize.md`.
- **Don't create giant type-parameter lists.** `Stack[T]` is fine; `Soup[A, B, C, D, E, F]` is a smell.

---

## Best Practices

1. Prefer a generic type over `interface{}` when the relationship is "container of T".
2. Prefer a generic interface (`Iterator[T]`) over per-type interfaces (`IntIterator`, `StringIterator`).
3. Always provide a constructor (`NewStack[T]()`) — it improves type inference at call sites.
4. Mark mutating methods with pointer receivers.
5. Document each type parameter ("`T` is the element type") at the top of the file or type.
6. Keep methods consistent — if one method takes a pointer receiver, usually all do.
7. Stay close to existing patterns in the standard library: `slices`, `maps`, `cmp`, `sync.Map` (the post-1.21 generic version), and so on.

---

## Edge Cases & Pitfalls

### 1. Cannot use a type parameter as a method's own type parameter

```go
// ✘ Compile error: methods cannot have their own type parameters
func (s *Stack[T]) Map[U any](fn func(T) U) *Stack[U] { ... }
```

Workaround: write a *function*, not a method:

```go
func MapStack[T, U any](s *Stack[T], fn func(T) U) *Stack[U] { ... }
```

### 2. Calling a method on a nil generic pointer

A `*Stack[T]` that is `nil` will panic on `Push`. Always allocate via `NewStack[T]()`.

### 3. `Stack[int]{}` vs `Stack[int]{items: nil}`

Both are fine — the zero value of a generic struct is the zero value field-by-field.

### 4. `Stack[T]` and `Stack[U]` are different types

You cannot pass one to a function expecting the other, even if `T` and `U` happen to be aliases.

### 5. Type set interfaces can't be used as a value

```go
type Number interface { int | float64 }

var x Number = 3 // ✘ compile error: cannot use Number outside type constraints
```

### 6. `comparable` is a constraint, not a regular interface

`comparable` only makes sense in `[K comparable]`; it is not for `var x comparable`.

---

## Common Mistakes

| Mistake | Why it's wrong | Fix |
|---------|----------------|-----|
| Adding a new type parameter on a method | Forbidden by the spec | Use a top-level generic function |
| Forgetting `[T]` on the receiver: `func (s *Stack) Push(v T)` | Compile error — receiver doesn't know `T` | Write `func (s *Stack[T]) Push(v T)` |
| Using a type-set interface as a value | Can't — these are constraint-only | Convert to a regular interface or a generic function |
| `var s Stack` (no parameter) | Stack alone is incomplete | Use `Stack[int]`, `Stack[string]`, etc. |
| Mixing element types in one `Stack[T]` | Defeats the purpose | Use two stacks or use `Stack[any]` deliberately |
| Returning `nil` for a generic value | `nil` may not be a valid `T` | Use `var zero T; return zero, false` |

---

## Common Misconceptions

- *"Generic types in Go are like Java's, fully erased."* — They are not erased; the compiler emits real specialized code (sometimes shared across types). See `optimize.md`.
- *"Generic types are slower than `interface{}`."* — Usually they are *faster*, because boxing and dynamic dispatch are avoided.
- *"I can attach a method to `Stack[int]` only."* — No. Methods are written once on `Stack[T]` and apply to every instantiation.
- *"Generic types are objects."* — They are not. Go has no classes; generic types are still structs.
- *"Two `Stack[int]` from different packages are different types."* — Wrong. The type identity rules say `pkgA.Stack[int]` is identical only to itself; if both packages define their own `Stack`, those are different. But the same package's `Stack[int]` is the same type wherever you mention it.

---

## Tricky Points

1. **Receiver carries the parameters.** `func (s *Stack[T]) Push(v T)` — the `[T]` after `Stack` is mandatory.
2. **`any` is allowed everywhere a constraint is allowed.** It means "no constraint".
3. **Nil pointers** to generic types follow the same rules as ordinary types — methods may have a nil receiver if they handle it.
4. **Embedding a generic type** inside another generic type works: `type Cache[K comparable, V any] struct { m map[K]V; lru *List[K] }`.
5. **Self-referential generic types** are fine: `type Tree[T any] struct { left, right *Tree[T] }`.
6. **You can take the address of a method on an instantiated type**: `f := (*Stack[int]).Push` — though this is rarely needed.

---

## Test

```go
package gen

import "testing"

func TestStackPushPop(t *testing.T) {
    s := NewStack[int]()
    s.Push(1); s.Push(2); s.Push(3)
    if s.Len() != 3 {
        t.Fatalf("len = %d, want 3", s.Len())
    }
    for _, want := range []int{3, 2, 1} {
        got, ok := s.Pop()
        if !ok || got != want {
            t.Fatalf("pop = (%d,%v), want (%d,true)", got, ok, want)
        }
    }
    if !s.IsEmpty() {
        t.Fatal("expected empty stack")
    }
}

func TestStackString(t *testing.T) {
    s := NewStack[string]()
    s.Push("a"); s.Push("b")
    v, _ := s.Pop()
    if v != "b" {
        t.Fatalf("got %q want %q", v, "b")
    }
}
```

The same `NewStack`/`Push`/`Pop` works for `int`, `string`, `User`, anything.

---

## Tricky Questions

1. **Q: Can a method declare its own type parameters?**
   A: No. Methods on a generic type must reuse the receiver's type parameters; they cannot add new ones.

2. **Q: Are `Stack[int]` and `Stack[string]` the same type?**
   A: No — they are different instantiated types, even though they share one generic source.

3. **Q: Can I have a `Stack[Stack[int]]`?**
   A: Yes. Generic types compose naturally.

4. **Q: Why do I get a compile error for `var x Number = 5` when `Number` is `int | float64`?**
   A: A type set with `|` makes the interface a constraint-only interface; it cannot be used as a value type.

5. **Q: How does the compiler know which `T` to use in `s.Push(42)`?**
   A: Because the receiver `*Stack[int]` already fixes `T = int`.

6. **Q: Can I attach a method to `Stack[int]` only, and a different method to `Stack[string]` only?**
   A: Not directly. You define one `Push[T]` on `Stack[T]` and it applies to every instantiation. To get type-specific behavior, you write a top-level function for that case.

7. **Q: Can I use `comparable` as a regular interface to store any comparable value?**
   A: No. `comparable` is a constraint; you cannot use it as a value type.

8. **Q: Will my generic code work in Go 1.17?**
   A: No. Generics require Go 1.18 or newer.

---

## Cheat Sheet

```go
// Declare
type Stack[T any] struct { items []T }
type Pair[K comparable, V any] struct { Key K; Value V }
type Iterator[T any] interface { Next() (T, bool) }

// Methods reuse receiver's type parameters
func (s *Stack[T]) Push(v T) { s.items = append(s.items, v) }
func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    if len(s.items) == 0 { return zero, false }
    n := len(s.items) - 1
    v := s.items[n]; s.items = s.items[:n]
    return v, true
}

// Instantiate
var s Stack[int]
p := Pair[string, int]{"age", 30}

// Constructor
func NewStack[T any]() *Stack[T] { return &Stack[T]{} }

// Generic interface - value mode
var it Iterator[int] = NewSliceIter([]int{1,2,3})

// Generic interface - constraint mode (with type set)
type Number interface { int | float64 }
func Sum[T Number](xs []T) T { var s T; for _, x := range xs { s += x }; return s }

// Forbidden
// func (s *Stack[T]) Map[U any](...)  // ✘ no method type params
// var x Number = 1                     // ✘ type-set interface as value
```

---

## Self-Assessment Checklist

- [ ] I can write a generic struct and instantiate it.
- [ ] I know the syntax for methods on generic types.
- [ ] I understand why methods cannot add their own type parameters.
- [ ] I can tell a *constraint interface* from a *value interface*.
- [ ] I can write `Stack`, `Queue`, `Pair`, `Result`, `Option` without help.
- [ ] I know the difference between `Stack[int]` and `Stack[string]` at the type level.
- [ ] I can read code that uses generic types in the standard library.

---

## Summary

A **generic type** is a type with one or more type parameters; instantiating it produces a real, usable type. Methods on a generic type carry the receiver's type parameters and cannot add new ones. A **generic interface** can be used either as a value-type (regular interface with parameterised method signatures) or as a *constraint* (with a type set, only usable in type-parameter lists). The most common shapes are containers (`Stack`, `Queue`, `Tree`), value wrappers (`Result`, `Option`), and abstract iterators / repositories.

---

## What You Can Build

After this file you can build:
- A type-safe in-memory cache (`Cache[K, V]`).
- A generic event bus (`EventBus[E]`) that fires only events of a chosen type.
- A typed pagination envelope for an HTTP API (`Page[T]`).
- A generic linked list / tree library to use across projects.
- A `Result[T]` / `Option[T]` micro-library to remove boilerplate around errors and presence.

---

## Further Reading

- Go spec — *Type parameters* and *Instantiations* (`https://go.dev/ref/spec#Type_parameters`).
- "An Introduction to Generics" — go.dev blog, June 2022.
- "When to Use Generics" — Ian Lance Taylor (go.dev blog).
- The `slices`, `maps`, and `cmp` packages in the standard library (excellent examples of generic types and functions).

---

## Related Topics

- **4.1 Why Generics?** — motivation
- **4.2 Generic Functions** — function-side syntax (this file is the type-side)
- **4.4 Type Constraints** — going beyond `any`
- **4.5 Type Inference** — when you can omit the type arguments
- **3.4 Interfaces Basics** — for the underlying interface concepts
- **`middle.md`** — methods restrictions, type sets, embedded generic interfaces

---

## Diagrams & Visual Aids

```
            ┌──────────────────────────┐
            │ type Stack[T any] struct │   (generic source — a recipe)
            └────────────┬─────────────┘
                         │ instantiate
       ┌─────────────────┼──────────────────┐
       ▼                 ▼                  ▼
   Stack[int]       Stack[string]       Stack[User]
   (concrete)       (concrete)          (concrete)
```

```
   Interface roles
   ────────────────
   type Iterator[T any] interface { Next() (T, bool) }   ← value mode
   type Number          interface { int | float64 }      ← constraint mode
                                       │
                                       └─ contains a type set; constraint-only
```

```
   Methods inherit receiver's type parameters
   ──────────────────────────────────────────
   func (s *Stack[T]) Push(v T)
                ▲           ▲
                │           │
                └─ same T ──┘
   ✘ func (s *Stack[T]) Map[U any](fn func(T) U) *Stack[U]   // not allowed
   ✓ func MapStack[T, U any](s *Stack[T], fn func(T) U) *Stack[U]
```

```
   Type identity
   ─────────────
   Stack[int]    ─────┐
                       ├── different types
   Stack[string] ─────┘

   Stack[int] (in foo.go) ≡ Stack[int] (in bar.go in same package)
```

End of junior.md.

# Generic Data Structures — Junior Level

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
> Focus: "Why couldn't we write a clean Stack[T] before 1.18?" and "How do we build one now?"

Containers — stacks, queues, sets, lists, trees — are the bread and butter of every programming language. In Go, before generics arrived in March 2022, building a **type-safe** container that could hold any element type was essentially impossible without giving up something important. Either you picked a single concrete type (`type IntStack []int`) and copied the code for every other element type, or you used `[]interface{}` and paid for it with runtime type assertions and bugs.

Generic data structures are the **first** thing every Go programmer reaches for after learning type parameters. They are also the cleanest case study of "why generics are worth it":

1. **Pre-1.18**: `Stack` was either type-locked or `interface{}`-based.
2. **Post-1.18**: `Stack[T any]` is one definition for every element type, with full compile-time type safety.

```go
// Pre-1.18 — pick your poison
type IntStack []int                       // type-locked
type Stack []interface{}                  // unsafe

// Post-1.18 — clean, fast, type-safe
type Stack[T any] struct {
    data []T
}
```

After reading this file you will:
- Understand **why** generic containers were impossible to write cleanly before 1.18
- Implement `Stack[T]` from scratch with `Push`, `Pop`, `Peek`, `Len`
- Implement `Set[T]` with `map[T]struct{}`, knowing why `T` must be `comparable`
- Read and write generic struct/method signatures confidently

---

## Prerequisites
- Go syntax: structs, slices, maps, methods
- Basic understanding of `interface{}` / `any`
- Familiarity with `[T any]` and `[T comparable]` constraints (see `04-type-constraints`)
- Go **1.18 or newer** installed

---

## Glossary

| Term | Definition |
|------|------------|
| **Generic type** | A type declaration parameterised by one or more types |
| **Element type** | The `T` stored inside a container |
| **`comparable`** | Built-in constraint for types usable with `==`/`!=` |
| **Pointer receiver** | Method receiver of form `*Stack[T]` — needed to mutate |
| **Zero value** | `var zero T` — the default value of any type |
| **Empty struct** | `struct{}` — zero bytes, used as a "set membership" marker |
| **Set** | Unordered collection of unique elements |
| **Stack** | LIFO container (Last In, First Out) |
| **Instantiation** | Picking `T` at the call site: `Stack[int]{}` |

---

## Core Concepts

### 1. Why Stack[T] was painful before 1.18

Pre-generics, three options existed, all bad:

**Option A — Type-locked**
```go
type IntStack struct{ data []int }
type StringStack struct{ data []string }
type Float64Stack struct{ data []float64 }
```
Three identical types, three sets of methods, three places to fix every bug.

**Option B — `interface{}`-backed**
```go
type Stack struct{ data []interface{} }

func (s *Stack) Push(v interface{}) { s.data = append(s.data, v) }
func (s *Stack) Pop() interface{} { /* ... */ }
```
- The caller must type-assert `v.(int)` on every `Pop`
- The container happily mixes `int`, `string`, `*User` together — no compile-time check
- Boxing every value into `interface{}` adds heap allocations

**Option C — Code generation (`genny`, `gotemplate`)**
```go
//go:generate genny -in=stack.go -out=int_stack.go gen "T=int"
```
- Real type-safe code, but two extra files per type
- IDE jump-to-definition lands in generated code
- Build pipeline grows fragile

None of these is "clean". Generics fix all three.

### 2. The first generic Stack

```go
type Stack[T any] struct {
    data []T
}

func (s *Stack[T]) Push(v T) {
    s.data = append(s.data, v)
}

func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    if len(s.data) == 0 {
        return zero, false
    }
    n := len(s.data) - 1
    v := s.data[n]
    s.data = s.data[:n]
    return v, true
}

func (s *Stack[T]) Len() int {
    return len(s.data)
}
```

Three things to notice:
- `Stack[T any]` declares one type parameter `T`. Inside the struct, `[]T` is a slice of whatever `T` is.
- The receiver is `*Stack[T]` — note the `[T]`. You **must** repeat the type parameter list on every method.
- `var zero T` gives you the type's zero value when the stack is empty.

### 3. Why Set[T] needs `comparable`

A set is a collection of unique elements. The idiomatic Go implementation uses a map:

```go
type Set[T comparable] struct {
    m map[T]struct{}
}
```

Why `comparable` and not `any`? Because **map keys must be comparable**. `==` is required for map insertion and lookup. The compiler enforces this:

```go
type Set[T any] struct {
    m map[T]struct{} // ❌ compile error: T is not comparable
}
```

Switching to `[T comparable]` lets the body use `==` (implicitly, through map operations) and the compiler accepts it.

### 4. Why `struct{}` as the value type

`struct{}` is the **empty struct** — it occupies zero bytes. Using `map[T]struct{}` instead of `map[T]bool` saves memory because every value would be one byte (or eight, due to alignment). For huge sets this matters.

```go
m1 := map[int]bool{}    // value: 1 byte each
m2 := map[int]struct{}{} // value: 0 bytes each
```

### 5. The four pieces in one table

| Pre-1.18 approach | Cost | Post-1.18 generic |
|--------------------|------|--------------------|
| `IntStack`, `StringStack`, ... | Copy-paste, drift | `Stack[T any]` |
| `Stack` over `interface{}` | Boxing, runtime panics | `Stack[T any]` |
| `genny` codegen | Build complexity | `Stack[T any]` |
| `map[interface{}]struct{}` set | Lost type safety | `Set[T comparable]` |

---

## Real-World Analogies

**Analogy 1 — Cafeteria trays**

A stack of trays in a cafeteria is LIFO: you take the top tray, and the next one springs up. `Stack[T]` is the same idea — the only thing that changes between cafeterias is **what** is on the trays (food, books, plates). The mechanism is identical.

**Analogy 2 — A bag of distinct stamps**

A `Set[Stamp]` is a bag where every stamp can appear at most once. Whether the stamp is a sticker, a postage stamp, or a digital token does not matter to the bag. The bag enforces uniqueness and answers "do you have this stamp?" — that is `Has`.

**Analogy 3 — A typed envelope**

An `interface{}` slot is a brown envelope: you put anything in, and you read the label to know what came out. A generic `T` slot is a labelled folder: only certain documents fit, and the label says which.

**Analogy 4 — Parking garage**

A parking garage with numbered spots is a `Map[SpotNumber, Car]`. The spot number is `comparable` (you check it with `==`), the car is the value. Try to use a non-comparable key (a list of spots?) and the garage cannot find the car.

---

## Mental Models

### Model 1 — "The container does not care about T"

A stack pushes and pops. It does not multiply, compare, or print elements. So `[T any]` is enough — no constraint needed beyond "any type".

### Model 2 — "Operations dictate constraints"

Whenever a container uses `T` as a **map key** or compares with `==`, the constraint must be `comparable`. Whenever it sorts with `<`, the constraint must include `cmp.Ordered`.

### Model 3 — "Methods inherit T from the type"

A method on `Stack[T]` does not declare `T` again — it reuses the receiver type's parameter. The form is always `func (s *Stack[T]) MethodName(...)`. Forget the `[T]` and the compiler complains.

### Model 4 — "Two questions before defining a container"

1. What operations does the container perform on `T`? (none, `==`, `<`, hash, etc.)
2. Should methods mutate the container? (yes → pointer receiver `*Stack[T]`)

Answer those, and the constraint and receiver type follow automatically.

---

## Pros & Cons

### Pros

| Benefit | Why it matters |
|---------|----------------|
| **Type safety** | Wrong-type pushes fail to compile |
| **No boxing** | Values stay as their primitive type |
| **One definition** | No `IntStack`, `StringStack`, ... duplication |
| **Better IDE** | Autocomplete knows the element type |
| **Reusable libraries** | One package serves every team |

### Cons

| Drawback | Why it matters |
|----------|----------------|
| **Slightly more syntax** | `[T]` on every method |
| **Constraint pitfalls** | Forget `comparable` and the body fails to compile |
| **Easy to over-design** | Tempting to build five containers when one works |
| **Learning curve** | Newcomers see `[T any]` and pause |

---

## Use Cases

Generic containers shine in:

1. **Stack[T]** — undo history, expression evaluators, DFS traversal
2. **Queue[T]** — task pipelines, BFS traversal
3. **Set[T comparable]** — uniqueness, membership tests
4. **LinkedList[T]** — ordered insertion, free splicing
5. **Tree[T cmp.Ordered]** — sorted lookups
6. **Pair[K,V]** — small ad hoc tuples

They are **not** ideal for:

1. Containers where the elements have rich behaviour — use interfaces
2. Performance-critical code where one specialised version wins
3. Containers that mix many types — use `interface{}` then

---

## Code Examples

### Example 1 — Stack[T] from scratch

```go
package main

import "fmt"

type Stack[T any] struct {
    data []T
}

func NewStack[T any]() *Stack[T] {
    return &Stack[T]{}
}

func (s *Stack[T]) Push(v T) {
    s.data = append(s.data, v)
}

func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    if len(s.data) == 0 {
        return zero, false
    }
    n := len(s.data) - 1
    v := s.data[n]
    s.data = s.data[:n]
    return v, true
}

func (s *Stack[T]) Peek() (T, bool) {
    var zero T
    if len(s.data) == 0 {
        return zero, false
    }
    return s.data[len(s.data)-1], true
}

func (s *Stack[T]) Len() int { return len(s.data) }

func main() {
    s := NewStack[int]()
    s.Push(1)
    s.Push(2)
    s.Push(3)
    v, _ := s.Pop()
    fmt.Println(v) // 3
    fmt.Println(s.Len()) // 2
}
```

### Example 2 — Set[T] using map[T]struct{}

```go
type Set[T comparable] struct {
    m map[T]struct{}
}

func NewSet[T comparable]() *Set[T] {
    return &Set[T]{m: make(map[T]struct{})}
}

func (s *Set[T]) Add(v T) {
    s.m[v] = struct{}{}
}

func (s *Set[T]) Has(v T) bool {
    _, ok := s.m[v]
    return ok
}

func (s *Set[T]) Remove(v T) {
    delete(s.m, v)
}

func (s *Set[T]) Len() int { return len(s.m) }

func main() {
    s := NewSet[string]()
    s.Add("apple")
    s.Add("apple") // duplicate, ignored
    s.Add("pear")
    fmt.Println(s.Len()) // 2
    fmt.Println(s.Has("apple")) // true
}
```

### Example 3 — Stack of strings, no assertions

```go
s := NewStack[string]()
s.Push("hello")
s.Push("world")
v, _ := s.Pop() // v is string — no .(string) needed
fmt.Println(v)  // "world"
```

Compare to the pre-1.18 `Stack []interface{}` version, where `Pop` returned `interface{}` and the caller had to write `v.(string)` on every pop.

### Example 4 — Wrong-type push fails to compile

```go
s := NewStack[int]()
s.Push(1)
s.Push("two") // ❌ does not compile
```

The compiler's error is precise: `cannot use "two" (untyped string constant) as int value in argument to s.Push`. With `interface{}`, the same code would compile and quietly mix types.

### Example 5 — Set of structs

```go
type Point struct{ X, Y int }

func main() {
    s := NewSet[Point]()
    s.Add(Point{1, 2})
    s.Add(Point{1, 2}) // same value, ignored
    s.Add(Point{3, 4})
    fmt.Println(s.Len()) // 2
}
```

`Point` has comparable fields, so `Point` itself is comparable. The set works without any extra setup.

### Example 6 — Set Union with a free function

```go
func Union[T comparable](a, b *Set[T]) *Set[T] {
    out := NewSet[T]()
    for k := range a.m {
        out.Add(k)
    }
    for k := range b.m {
        out.Add(k)
    }
    return out
}
```

Methods cannot have their own type parameters, so set operations like `Union` and `Intersection` are usually free functions.

---

## Coding Patterns

### Pattern 1 — Pointer receivers for mutation

A stack mutates its slice. Always use `*Stack[T]` receivers, not `Stack[T]`. Otherwise `Push` operates on a copy and the original stack stays empty.

### Pattern 2 — Constructor functions

`NewStack[int]()` is friendlier than `&Stack[int]{}` because it can initialise internal maps:

```go
func NewSet[T comparable]() *Set[T] {
    return &Set[T]{m: make(map[T]struct{})}
}
```

Without the constructor, the user might forget to initialise the map and panic on first `Add`.

### Pattern 3 — Zero value via `var zero T`

Inside generic methods, you cannot write `T{}` for an arbitrary `T`. Use:
```go
var zero T
return zero, false
```

### Pattern 4 — `(T, bool)` for "may not exist"

Pop, Peek, Get all return `(T, bool)` so callers can distinguish "empty" from "valid zero value". This is the same idiom as `m, ok := mp[k]`.

---

## Clean Code

- Prefer `[T any]` and tighten only when needed (`comparable`, `cmp.Ordered`).
- Use single-letter type parameters (`T`, `K`, `V`) — they are idiomatic.
- Provide a `New<Type>[T]()` constructor when the zero value is unsafe.
- Document the constraint when it is non-obvious.

```go
// Clean
type Cache[K comparable, V any] struct{ m map[K]V }

// Less clean — what is X?
type Cache[X comparable, Y any] struct{ m map[X]Y }
```

---

## Product Use / Feature

Real product scenarios where generic containers shine:

1. **HTTP middleware** — `RequestStack[T]` for layered context.
2. **Event deduplication** — `Set[EventID]` to drop replays.
3. **Connection pools** — `Pool[*Conn]` instead of `interface{}`-based pools.
4. **Job queues** — `Queue[Job]` per worker.
5. **Browser back/forward stacks** — `Stack[URL]`.

Each used to require either `interface{}` or a hand-written per-type structure. Generics removed both options.

---

## Error Handling

Containers usually do not return errors — they return `(T, bool)`:

```go
v, ok := stack.Pop()
if !ok {
    // handle empty
}
```

If a container does need to fail with a reason (capacity exceeded, key not found in a typed lookup), use `(T, error)`:

```go
func (q *BoundedQueue[T]) Enqueue(v T) error {
    if q.Len() == q.cap {
        return errors.New("queue full")
    }
    q.data = append(q.data, v)
    return nil
}
```

---

## Security Considerations

Generic containers themselves do not introduce security issues, but two things are worth knowing:

1. **A `Set[any]` defeats the purpose** — it is the same as the old `interface{}` set. Always pick a real type for `T`.
2. **Maps in containers are not safe for concurrent use.** Wrap with a mutex or use `sync.Map` if multiple goroutines touch the same instance.
3. **Sensitive data in containers** — if the container outlives the secret, the secret stays in memory. Wipe explicitly when relevant.

---

## Performance Tips

- A `Stack[int]` is as fast as a hand-rolled `IntStack`. The compiler stencils the body for `int` directly.
- A `Set[T]` over a struct with pointers may be slightly slower than a hand-rolled set due to GC shape stenciling. We dive into this in `optimize.md`.
- Pre-allocate slices with `make([]T, 0, cap)` when the size is known.
- Use `struct{}` (not `bool`) as the map value in sets to save memory.

---

## Best Practices

1. **Pick the smallest constraint** — `any` first, tighten only when needed.
2. **Always pointer-receiver** for containers that mutate.
3. **Provide a constructor** — `NewStack[T]() *Stack[T]`.
4. **Return `(T, bool)`** for operations that may have no result.
5. **Use `var zero T`** for zero values inside generic code.
6. **Document the operations** the container performs on `T`.
7. **Test with at least two element types** to confirm genericity.
8. **Free functions for binary operations** — `Union`, `Intersection`, `Concat`.

---

## Edge Cases & Pitfalls

### 1. Forgetting `[T]` on the receiver

```go
func (s *Stack) Push(v T) { ... } // ❌
```
Methods on a generic type must repeat the type parameter list:
```go
func (s *Stack[T]) Push(v T) { ... }
```

### 2. Using `any` where `comparable` is needed

```go
type Set[T any] struct{ m map[T]struct{} } // ❌ map key must be comparable
```

### 3. Forgetting the constructor

```go
var s Set[int]
s.Add(1) // panic: assignment to entry in nil map
```
Use `NewSet[int]()` or initialise the map manually.

### 4. Comparing the zero value of `T`

```go
var zero T
if v == zero { ... } // ❌ if T is `any`
```
Add `comparable` to the constraint or guard with a flag.

### 5. Using value receivers for mutation

```go
func (s Stack[T]) Push(v T) { s.data = append(s.data, v) } // mutates a copy
```
Use `*Stack[T]`.

---

## Common Mistakes

1. **Using `Stack[any]`** when you really want `Stack[Job]`. That defeats the point.
2. **Putting `comparable` on a stack** that does not need `==`. Stay with `any`.
3. **Forgetting to initialise internal maps.** Always provide a constructor.
4. **Comparing `T` without the right constraint.** The compiler is strict here.
5. **Method-level type parameters** — they don't exist in Go.
6. **Hard-coding the constraint** to `int | string | float64` instead of using `any`/`comparable`.
7. **Exporting helper types** (`listNode[T]`) that callers do not need.

---

## Common Misconceptions

- **"Set[T] needs `any`."** It needs `comparable` — the map key must support `==`.
- **"`map[T]bool` is the same as `map[T]struct{}`."** Not in memory. `struct{}` is zero-byte.
- **"A method can declare its own `T`."** It cannot. Use a free function.
- **"Pop should panic on empty."** Idiomatic Go returns `(T, bool)` instead.
- **"A generic Stack is slower than IntStack."** Not for primitives — they are essentially identical.
- **"You cannot have nested generics."** You can. `Stack[Pair[int,string]]` is valid.

---

## Tricky Points

1. **The receiver type must always be `*Stack[T]`** even if you only have one type parameter; the compiler will not infer it.
2. **`Stack` (without `[int]`)** is not a complete type — you cannot declare `var s Stack`.
3. **Generic types can embed other generic types** (`type Inbox[T any] struct { Stack[T] }`) and inherit methods.
4. **Constructors return pointers** by convention, because containers usually contain a slice or map that must be initialised.
5. **`comparable` is stricter than "supports `==`"** — slices, maps, and functions never satisfy it.

---

## Test

Test yourself before continuing.

1. Why must `Set[T]` use `comparable` rather than `any`?
2. Why use `struct{}` as the map value in a set?
3. What does `var zero T` do?
4. Why must containers use pointer receivers?
5. Can a method on `Stack[T]` declare its own `[U any]`?
6. What is the idiomatic return type for `Pop` on an empty stack?
7. Name three pre-1.18 alternatives to a generic stack.
8. Why is `Stack[any]` an anti-pattern?

(Answers: 1) map keys must support `==`; 2) zero bytes; 3) yields `T`'s zero value; 4) to mutate the underlying slice/map; 5) no; 6) `(T, bool)`; 7) per-type stack, `[]interface{}` stack, codegen; 8) defeats the purpose of generics.)

---

## Tricky Questions

**Q1.** Why does this fail to compile?
```go
type Set[T any] struct{ m map[T]struct{} }
```
**A.** Map keys must be `comparable`. Change to `[T comparable]`.

**Q2.** Why does this stack stay empty?
```go
func (s Stack[T]) Push(v T) { s.data = append(s.data, v) }
s := Stack[int]{}
s.Push(1)
fmt.Println(s.Len()) // 0
```
**A.** Value receiver mutates a copy. Use `*Stack[T]`.

**Q3.** What goes wrong?
```go
var s Set[int]
s.Add(5) // panic
```
**A.** The internal map is `nil`. Use `NewSet[int]()`.

**Q4.** Why is `Stack[any]` an anti-pattern?
**A.** It is equivalent to the pre-1.18 `Stack` over `interface{}` — boxing, no compile-time type safety.

**Q5.** Can `Set[T comparable]` hold `[]int`?
**A.** No — slices are not comparable. The compiler rejects the instantiation.

---

## Cheat Sheet

```go
// Stack — no constraint needed
type Stack[T any] struct{ data []T }
func (s *Stack[T]) Push(v T)         { s.data = append(s.data, v) }
func (s *Stack[T]) Pop() (T, bool)   { /* var zero T; ... */ }
func (s *Stack[T]) Peek() (T, bool)  { /* ... */ }
func (s *Stack[T]) Len() int         { return len(s.data) }

// Set — comparable required for map keys
type Set[T comparable] struct{ m map[T]struct{} }
func NewSet[T comparable]() *Set[T] { return &Set[T]{m: map[T]struct{}{}} }
func (s *Set[T]) Add(v T)            { s.m[v] = struct{}{} }
func (s *Set[T]) Has(v T) bool       { _, ok := s.m[v]; return ok }
func (s *Set[T]) Remove(v T)         { delete(s.m, v) }
```

| Construct | Example |
|-----------|---------|
| Generic struct | `type Stack[T any] struct{...}` |
| Method on generic | `func (s *Stack[T]) Push(v T)` |
| Instantiate | `&Stack[int]{}` |
| Zero value | `var zero T` |
| Map-backed set | `map[T]struct{}` |

---

## Self-Assessment Checklist

- [ ] I can implement `Stack[T]` from scratch.
- [ ] I can implement `Set[T]` and explain why it needs `comparable`.
- [ ] I know why methods need `[T]` on the receiver.
- [ ] I use pointer receivers for mutation.
- [ ] I can name three pre-1.18 ways to build a stack and their drawbacks.
- [ ] I know why `var zero T` is needed inside generic methods.
- [ ] I understand the difference between `map[T]bool` and `map[T]struct{}`.
- [ ] I provide constructor functions for containers with internal maps.

If you ticked at least 6, move on to `middle.md`.

---

## Summary

Pre-1.18 Go made building **type-safe** containers awkward — you had to choose between per-type duplication, `interface{}` boxing, or external code generation. Generics close that gap. `Stack[T any]` is one definition that serves every element type with full compile-time checking. `Set[T comparable]` adds a single constraint to allow map keys.

The two recurring patterns are: pointer receivers for mutation, and `(T, bool)` returns for operations that may have no result. Constructors and `var zero T` round out the toolkit. Once these patterns are second nature, you can build any container you want without reaching for `interface{}` again.

Move on to `middle.md` for queues, linked lists, pairs, and option types.

---

## What You Can Build

After this section you can build:

1. A generic **`Stack[T]`** with full LIFO semantics.
2. A generic **`Set[T comparable]`** with `Add`, `Has`, `Remove`.
3. A small **undo manager** built on `Stack[Action]`.
4. An **event de-duplicator** built on `Set[EventID]`.
5. A **connection pool** with `Pool[*Conn]`.
6. A **typed cache** built on `map[K]V` wrapped in a generic struct.

---

## Further Reading

- [The Go 1.18 release notes](https://go.dev/doc/go1.18)
- [An Introduction To Generics — Go blog](https://go.dev/blog/intro-generics)
- [`container/list` documentation](https://pkg.go.dev/container/list) — the pre-generics linked list
- [`hashicorp/golang-lru/v2`](https://github.com/hashicorp/golang-lru) — real-world generic LRU
- [`sync/atomic.Pointer[T]`](https://pkg.go.dev/sync/atomic#Pointer) — generic atomic wrapper
- [`slices`](https://pkg.go.dev/slices), [`maps`](https://pkg.go.dev/maps) — stdlib generics

---

## Related Topics

- **4.1 Why Generics?** — the motivation behind type parameters
- **4.3 Generic Types & Interfaces** — generic struct declarations
- **4.4 Type Constraints** — `any`, `comparable`, custom constraints
- **4.11 Methods on Generic Types** — receiver rules in depth
- **4.13 `comparable` and `cmp.Ordered`** — when to pick which

---

## Diagrams & Visual Aids

### Stack[T] memory layout

```
Stack[int]:  data → [1, 2, 3]   (slice of int, contiguous in memory)
Stack[any]:  data → [box, box, box]  (each box is a 16-byte interface header)
```

### Set[T] using map[T]struct{}

```
Set[string]
   m → ┌────────────┬──────────┐
       │ "apple"    │ struct{} │
       │ "pear"     │ struct{} │
       │ "banana"   │ struct{} │
       └────────────┴──────────┘
```
The values are zero-byte; only the keys carry information.

### Pre-1.18 vs post-1.18

```
Before:                  After:
  IntStack    {[]int}      Stack[T any] { []T }
  StringStack {[]string}   ────────────────────
  Float64Stack ...           one type, every element
                             type, full compile check
```

# Method Sets Deep — Junior Level

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
12. [Error Handling](#error-handling)
13. [Performance Tips](#performance-tips)
14. [Best Practices](#best-practices)
15. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
16. [Common Mistakes](#common-mistakes)
17. [Test](#test)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [Further Reading](#further-reading)

---

## Introduction
> Focus: "What is a method set, and why does it sometimes 'lose' methods?"

You have already met the term **method set** in earlier sections. The basic rule is: a value type `T` carries methods declared with a value receiver, and the pointer type `*T` carries everything (value-receiver methods *plus* pointer-receiver methods).

That single sentence hides a lot of mechanics. The most common surprise for new Go developers is this:

```go
type Cat struct{ name string }

func (c *Cat) Rename(n string) { c.name = n }

type Renamer interface {
    Rename(string)
}

var r Renamer = Cat{name: "Tom"}    // ❌ compile error
```

The compiler says: *Cat does not implement Renamer (Rename method has pointer receiver)*. Why? Because the method set of `Cat` (the value type) does **not** include `Rename` — only `*Cat` does. And to construct an interface holding a `*Cat`, you must have something that is **addressable** so Go can take `&` of it. Once you store a `Cat` value into an interface, that value is no longer addressable.

This file will:
- Define method sets formally with examples you can run
- Show what "addressability" means and where it gets lost
- Explain why `m["k"].M()` fails for pointer-receiver methods
- Walk through embedding and how method sets propagate
- Set up the deeper rules covered at middle/senior levels

---

## Prerequisites
- Sections 01–04 of this chapter (`methods-vs-functions`, `pointer-receivers`, `value-receivers`, `interfaces-basics`)
- A basic understanding of `*T` vs `T` (pointer vs value)
- Familiarity with `interface{ M() }` declarations

---

## Glossary

| Term | Definition |
|------|------------|
| **Method set** | The full collection of methods callable on a given type |
| **Value receiver** | `func (t T) M()` — `M` belongs to method sets of both `T` and `*T` |
| **Pointer receiver** | `func (t *T) M()` — `M` belongs to method set of `*T` only |
| **Addressable** | A value whose memory location can be referenced via `&` |
| **Interface boxing** | Storing a concrete value inside an interface variable |
| **Promotion** | An embedded type's methods becoming part of the outer struct's method set |
| **Auto-address** | Compiler implicitly inserts `&v` when calling `(*T).M()` on a `T` variable |

---

## Core Concepts

### 1. Method set definitions

Given:

```go
type Box struct{ n int }

func (b Box)  Read()  int  { return b.n }   // value receiver
func (b *Box) Write(n int) { b.n = n }      // pointer receiver
```

| Type     | Read in set? | Write in set? |
|----------|--------------|---------------|
| `Box`    | yes          | **no**        |
| `*Box`   | yes          | yes           |

The asymmetry exists because calling `Write` on a `Box` value requires Go to find the address of that value — which is not always possible.

### 2. Addressability — the hidden gate

Go's rule: you can call a `*T` method on a `T` value **only if the value is addressable**. The compiler will silently rewrite `b.Write(5)` into `(&b).Write(5)` when `b` is addressable.

Addressable values include:
- Plain variables — `var b Box`
- Fields of an addressable struct — `pair.left` (when `pair` is addressable)
- Pointer dereferences — `*p`
- Slice elements — `s[i]`

Non-addressable values include:
- **Map elements** — `m["k"]`
- Values inside an interface — `i.(Box)` returns an unaddressable copy
- Composite literals in certain expressions — `Box{}.Write(5)` fails (but `(&Box{}).Write(5)` works because of a special rule)
- Constants and function return values

### 3. Why `m["k"].M()` fails for pointer methods

```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }

m := map[string]Counter{"a": {}}
m["a"].Inc()   // compile error: cannot take the address of m["a"]
```

Why is the map element not addressable? Because Go's map implementation is allowed to **rehash** at any time — the underlying memory location of `m["a"]` can move when the map grows. If Go let you take `&m["a"]`, you could end up with a dangling pointer after a single insertion.

The fix is to read it out, mutate, and write back:

```go
v := m["a"]
v.Inc()
m["a"] = v
```

Or change to `map[string]*Counter`, where the pointer (not the struct) is stored:

```go
m := map[string]*Counter{"a": {}}
m["a"].Inc()   // OK — m["a"] is *Counter; (*Counter).Inc is in set
```

### 4. Interface boxing strips addressability

When you assign a value to an interface, Go copies the value into the interface's internal storage. That storage is **not addressable** from your code.

```go
type Stringer interface{ String() string }

type X struct{ n int }
func (x *X) String() string { return fmt.Sprintf("%d", x.n) }

var s Stringer = X{}   // ❌ compile error: String has pointer receiver
var s Stringer = &X{}  // ✅ OK — *X is in the method set of *X
```

Even though writing `X{}.String()` *would* work in a different context (because `X{}` is sometimes auto-addressed for method calls), the compiler refuses interface assignment with a pointer-receiver method on a value type — because the addressability story will be permanently lost the moment the value enters the interface.

### 5. Embedding propagates method sets

When you embed a type, its methods are **promoted** to the outer type. The exact rules depend on whether you embed `T` or `*T`:

```go
type Logger struct{}
func (l Logger)  Info(msg string)  { fmt.Println("info:", msg) }
func (l *Logger) Reset()           { /* ... */ }

type Server struct{ Logger }       // embed by value

var s Server
s.Info("hi")    // OK — Logger.Info is value-receiver, Logger embedded by value
s.Reset()       // OK if s is addressable — auto &s.Logger
```

| Embed style       | `T` methods reachable | `*T` methods reachable on outer value |
|-------------------|-----------------------|--------------------------------------|
| `Server { T }`    | yes                   | yes (if outer is addressable)        |
| `Server { *T }`   | yes                   | yes (always — pointer is stored)     |

This is the topic explored at length in section 19 (struct method promotion); here we just note that the addressability rule still applies.

---

## Real-World Analogies

**Analogy 1 — Library card vs. building access**

A `T`-method is like a library card you can give anyone — they can read the book on the shelf without taking the shelf with them. A `*T`-method is like the locker key — you can only hand it over if there is a fixed locker location for it. A map slot doesn't have a fixed location (the building rearranges itself), so you cannot hand out the key.

**Analogy 2 — Photocopy vs. original**

Putting a value into an interface is like making a photocopy and stapling it inside a binder. You cannot stamp the photocopy back onto the original — the original's address is no longer reachable through the binder.

**Analogy 3 — Map slot is a dynamic safe**

A map slot is a dynamic safe with a moving combination. Writing inside it is fine (the safe self-rebalances), but you cannot tell someone "go modify what's inside slot K" because by the time they show up, the safe may have moved.

---

## Mental Models

### Model 1: Method set as a contract list

Imagine each type carries a printed list of its callable methods. For `T`, the list contains only value-receiver methods. For `*T`, the list contains everything. Interfaces compare their required list against the candidate's list.

```
Box  → [Read]
*Box → [Read, Write]
```

### Model 2: Addressability is a runtime concept the compiler enforces statically

The compiler does not need to know the runtime address of a value — but it needs to be sure an address **could** be taken if asked. Three places where it cannot prove this:

1. Map elements — they can move
2. Interface contents — copy, not original
3. Function return values — temporary

### Model 3: The interface refusal is preventive, not pedantic

The compiler refuses `var i I = X{}` (when `I.M` requires `*X`) because, even though it could *copy* `X{}` into an addressable temporary right now, every later call through `i` would mutate that hidden temporary instead of any user-visible value. Go decides early that this would be confusing and forbids it.

---

## Pros & Cons

### The strict method-set rule

| Pros | Cons |
|------|------|
| Predictable interface satisfaction | Surprising for newcomers |
| No silent mutation of hidden copies | Requires "always take pointer" discipline |
| Forces explicit ownership of mutation | Map workarounds add boilerplate |
| Works with concurrent code (no hidden copy of locks) | Can't satisfy `*T` interface from a `T` value |

---

## Use Cases

1. **Designing an interface that mutates** — declare the methods with pointer receivers and require callers to pass `*T`.
2. **Designing an immutable value object** — value receivers everywhere; both `T` and `*T` satisfy the interface.
3. **Storing values in a map** — if you need pointer-method calls, store `*T` not `T`.
4. **Embedding a logger or mutex** — embed `*Logger` to keep the address stable across copies.

---

## Code Examples

### Example 1: The classic interface-assignment failure

```go
package main

import "fmt"

type Counter struct{ n int }

func (c *Counter) Inc() { c.n++ }

type Incer interface{ Inc() }

func main() {
    c := Counter{}
    var i Incer = &c   // OK — &c is addressable
    i.Inc()
    i.Inc()
    fmt.Println(c.n)   // 2

    // var i Incer = c  // would fail to compile
}
```

### Example 2: Map element vs slice element

```go
type T struct{ n int }
func (t *T) Inc() { t.n++ }

func main() {
    s := []T{{}, {}}
    s[0].Inc()        // OK — slice elements are addressable
    fmt.Println(s[0]) // {1}

    m := map[string]T{"a": {}}
    // m["a"].Inc()   // compile error
    v := m["a"]
    v.Inc()
    m["a"] = v
}
```

### Example 3: Interface holding a value loses *T methods

```go
type Animal interface{ Sound() string }
type Dog struct{ name string }
func (d *Dog) Sound() string { return d.name + " woofs" }

func main() {
    var a Animal = &Dog{name: "Rex"}    // OK — *Dog
    fmt.Println(a.Sound())              // "Rex woofs"

    // var a Animal = Dog{name: "Rex"}  // does not compile
}
```

### Example 4: Composite literal addressability

```go
type Greeter struct{ msg string }
func (g *Greeter) Set(m string) { g.msg = m }

func main() {
    // Greeter{}.Set("hi")     // compile error — composite literal not addressable
    (&Greeter{}).Set("hi")     // explicit & — OK, but the result is discarded

    g := Greeter{}             // addressable
    g.Set("hi")                // OK
    fmt.Println(g.msg)
}
```

### Example 5: Embedding by value vs by pointer

```go
type Engine struct{ rpm int }
func (e *Engine) Start() { e.rpm = 1000 }

type CarValue struct{ Engine }   // embed by value
type CarPtr   struct{ *Engine }  // embed by pointer

func main() {
    cv := CarValue{}
    cv.Start()                   // OK — auto &cv.Engine
    fmt.Println(cv.rpm)          // 1000

    cp := CarPtr{Engine: &Engine{}}
    cp.Start()                   // OK — pointer already stored
    fmt.Println(cp.rpm)          // 1000
}
```

---

## Coding Patterns

### Pattern 1: Always take the address before assigning to an interface

```go
type Doer interface{ Do() }

type Job struct{ id int }
func (j *Job) Do() { fmt.Println("job", j.id) }

var d Doer = &Job{id: 1}         // not Job{...}
```

### Pattern 2: Use `*T` map values when methods mutate

```go
type Player struct{ score int }
func (p *Player) Add(n int) { p.score += n }

scores := map[string]*Player{}
scores["alice"] = &Player{}
scores["alice"].Add(10)          // OK — *Player.Add is in the set
```

### Pattern 3: Read-modify-write for value maps

```go
m := map[string]Player{"alice": {}}
v := m["alice"]
v.Add(10)
m["alice"] = v
```

---

## Clean Code

### Rule 1: Pick a side (value or pointer) per type and stick to it

If any method on a type has a pointer receiver, make them all pointer receivers. This avoids mismatched method sets.

```go
// Bad
type Buffer struct{ data []byte }
func (b Buffer)  Len() int   { return len(b.data) }
func (b *Buffer) Write(p []byte) { b.data = append(b.data, p...) }

// Good
type Buffer struct{ data []byte }
func (b *Buffer) Len() int       { return len(b.data) }
func (b *Buffer) Write(p []byte) { b.data = append(b.data, p...) }
```

### Rule 2: Document interface satisfaction at the type level

```go
var _ Doer = (*Job)(nil)   // compile-time assertion: *Job satisfies Doer
```

### Rule 3: Prefer pointer storage when methods mutate

```go
// Stored as *T — mutation works through the map
fleet := map[string]*Vehicle{}
```

---

## Error Handling

The "X does not implement Y" diagnostic is your friend. Go gives you the exact reason:

```
./main.go:10:6: cannot use Cat{...} (type Cat) as type Renamer:
    Cat does not implement Renamer (Rename method has pointer receiver)
```

When you see "method has pointer receiver", check three things:
1. Did you forget a `&` on the value?
2. Is the value coming out of a map element?
3. Is the value the result of a function call (not addressable)?

---

## Performance Tips

- A pointer receiver avoids copying when the type is large; for small types it costs an extra dereference.
- Values stored in maps are copied on every read and every write. If your value type is large, prefer `map[K]*V`.
- Interface dispatch is dynamic — slightly slower than a direct `*T` method call.

---

## Best Practices

1. Use pointer receivers when methods mutate state.
2. Use pointer receivers for any type containing `sync.Mutex` or `atomic.*`.
3. Store pointers in maps when methods mutate.
4. Always assign `&value` to an interface when the interface methods are pointer-receiver.
5. Use `var _ I = (*T)(nil)` as a compile-time satisfaction check.
6. Don't mix value and pointer receivers on the same type.

---

## Edge Cases & Pitfalls

### Pitfall 1: `Box{}.M()` for pointer methods

```go
type Box struct{}
func (b *Box) Mark() {}

Box{}.Mark()  // compile error — composite literal is not addressable
```

Workaround: `(&Box{}).Mark()`.

### Pitfall 2: Returning a value vs returning a pointer

```go
func get() Counter { return Counter{} }

get().Inc()    // compile error if Inc has pointer receiver
               // — the return value is not addressable
```

### Pitfall 3: Type assertion gives a copy

```go
var i Incer = &Counter{}
c := i.(Counter)   // panic — not the right concrete type
                   // even with i.(*Counter), the result is a *Counter copy
```

---

## Common Mistakes

| Mistake | Cause | Fix |
|---------|-------|-----|
| `var i Incer = c` (when c is value) | Value's method set lacks pointer methods | `var i Incer = &c` |
| `m["k"].Inc()` | Map elements not addressable | Read-modify-write |
| `Box{}.Mark()` for pointer method | Composite literal not addressable | `(&Box{}).Mark()` |
| Mixing receiver kinds on one type | Inconsistent method set | Pick one and stick to it |

---

## Test

### 1. Which assignment compiles?
```go
type C struct{}
func (c *C) M() {}
type I interface{ M() }
```
- a) `var x I = C{}`
- b) `var x I = &C{}`
- c) Both
- d) Neither

**Answer: b**

### 2. Why does `m["k"].M()` fail for pointer-receiver `M`?
- a) Map elements have private storage
- b) Map elements are not addressable
- c) Maps require unique keys
- d) Pointer methods cannot read maps

**Answer: b**

### 3. Method set of `T` includes:
- a) Value-receiver methods only
- b) Pointer-receiver methods only
- c) Both
- d) Depends on package

**Answer: a**

### 4. Method set of `*T` includes:
- a) Value-receiver methods only
- b) Pointer-receiver methods only
- c) Both
- d) Depends on package

**Answer: c**

### 5. Composite literal `T{}.M()` for pointer-receiver `M`:
- a) Compiles and works
- b) Compiles but silently drops the call
- c) Compile error (not addressable)
- d) Runtime panic

**Answer: c**

---

## Cheat Sheet

```
METHOD SETS
─────────────────────────────
T   → value-receiver methods only
*T  → value AND pointer-receiver methods

ADDRESSABILITY (CAN TAKE &)
─────────────────────────────
YES: variables, slice[i], *p, struct fields of addressable
NO:  m["k"], interface contents, return values, composite literals

INTERFACE ASSIGNMENT
─────────────────────────────
var i I = T{}    if I.M is value-receiver
var i I = &T{}   if I.M is pointer-receiver

MAP MUTATION
─────────────────────────────
map[K]T → cannot call pointer methods on m[k]
map[K]*T → can call pointer methods directly

EMBEDDING
─────────────────────────────
struct{ T }  → outer's method set: T and (*T) (if outer addressable)
struct{ *T } → outer's method set: T and (*T)
```

---

## Summary

The deep story of method sets is the story of **addressability**. The simple "T has value methods, *T has both" rule is exact, but its real-world impact lands when you put values into maps, interfaces, or return slots — places where Go cannot guarantee a stable address. Once you internalise the addressability rule, "X does not implement Y" errors become obvious and easy to fix.

This file laid the groundwork. The middle level dives into interface boxing internals, embedding edge cases, and Go 1.22's per-iteration loop variable. The senior level uses these rules to design dispatch tables and architecture-level interfaces.

---

## Further Reading

- [Go Spec — Method sets](https://go.dev/ref/spec#Method_sets)
- [Go Spec — Address operators](https://go.dev/ref/spec#Address_operators)
- [Go Spec — Selectors](https://go.dev/ref/spec#Selectors)
- [Effective Go — Pointers vs. Values](https://go.dev/doc/effective_go#pointers_vs_values)
- [Go FAQ — Why am I getting "X does not implement Y"?](https://go.dev/doc/faq#different_method_sets)

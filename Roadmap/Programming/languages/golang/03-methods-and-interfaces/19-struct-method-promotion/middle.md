# Struct Method Promotion — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Promotion Mechanics](#promotion-mechanics)
3. [Value vs Pointer Embed](#value-vs-pointer-embed)
4. [Method-Set Propagation Rules](#method-set-propagation-rules)
5. [Ambiguity at Compile Time](#ambiguity-at-compile-time)
6. [Shadowing — Outer Wins](#shadowing-outer-wins)
7. [Explicit Qualification](#explicit-qualification)
8. [Field Promotion vs Method Promotion](#field-promotion-vs-method-promotion)
9. [Multiple-Level Embedding](#multiple-level-embedding)
10. [Diamond-Like Embedding](#diamond-like-embedding)
11. [Embedding and Initialisation](#embedding-and-initialisation)
12. [Patterns and Anti-Patterns](#patterns-and-anti-patterns)
13. [Code Review Checklist](#code-review-checklist)
14. [Test](#test)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)

---

## Introduction

At the junior level you saw what method promotion does. At the middle level we look at the details:

- The exact method-set rules for `Outer` and `*Outer` when embedding `T` vs `*T`.
- How **ambiguity** is resolved (it isn't — you must qualify).
- **Shadowing**: when the outer struct declares its own `M`, the inner's `M` is hidden but still reachable.
- The **diamond problem** (Go has none, by design).
- Initialisation, zero values, and addressable embedded values.

Every example here is about **struct embedding** — not interface embedding.

---

## Promotion Mechanics

A method `M` declared on the embedded type `T` is **promoted** to the outer struct `S` provided that **`S` does not declare `M` itself** and **promotion is unambiguous** (no other embed at the same depth declares `M`).

```go
type Inner struct{}
func (Inner) Greet() { fmt.Println("hi") }

type Outer struct{ Inner }

var o Outer
o.Greet()       // Outer.Greet → Outer.Inner.Greet
```

Internally, the compiler synthesises a forwarding method roughly equivalent to:

```go
// pseudo-code, not real Go you'd write
func (o Outer) Greet() { o.Inner.Greet() }
```

This is just resolution — it is **not** inheritance.

---

## Value vs Pointer Embed

You can embed either a value `T` or a pointer `*T`. Both forms work; they differ in:
- Storage: `T` stores the inner inline; `*T` stores only an indirection.
- Method set propagation (covered below).
- Initialisation: `*T` requires a non-nil allocation.

```go
type Engine struct{ Power int }
func (e Engine) Spec() string  { return fmt.Sprintf("%dHP", e.Power) }
func (e *Engine) SetPower(p int) { e.Power = p }

type Car1 struct{ Engine }   // embed by value
type Car2 struct{ *Engine }  // embed by pointer

c1 := Car1{Engine: Engine{Power: 200}}
c2 := Car2{Engine: &Engine{Power: 200}}

c1.Spec()        // "200HP"
c2.Spec()        // "200HP"
c1.SetPower(250) // Engine has pointer method; c1 is addressable, so OK
c2.SetPower(250) // OK — *Engine fully promoted
```

If `c1` were a non-addressable value (e.g., a map element), `c1.SetPower` would fail.

---

## Method-Set Propagation Rules

These are the precise rules — memorise them.

### Rule 1: Embedding `T` (value) inside struct `S`

| `T`'s method declared with | In `S`'s method set? | In `*S`'s method set? |
|---|---|---|
| `func (T) M()`  (value receiver) | yes | yes |
| `func (*T) M()` (pointer receiver) | **no** | yes |

### Rule 2: Embedding `*T` (pointer) inside struct `S`

| `T`'s method declared with | In `S`'s method set? | In `*S`'s method set? |
|---|---|---|
| `func (T) M()`  (value receiver) | yes | yes |
| `func (*T) M()` (pointer receiver) | **yes** | yes |

The key difference is the second row. Embedding by pointer makes pointer-receiver methods part of the **value** method set of `S` too — because the inner is already a pointer.

### Why does this matter?

Interface satisfaction depends on the method set:

```go
type Doubler interface{ Double() }

type Slow struct{ n int }
func (s *Slow) Double() { s.n *= 2 }

type EmbedValue struct{ Slow }
type EmbedPtr   struct{ *Slow }

var _ Doubler = &EmbedValue{} // OK — *EmbedValue gets *Slow's method
// var _ Doubler = EmbedValue{}   // ERROR — Slow's pointer method not in EmbedValue's set
var _ Doubler = EmbedPtr{}    // OK — *Slow embedded; method already on pointer type
var _ Doubler = &EmbedPtr{}   // OK
```

### Worked example

```go
type Inner struct{}
func (Inner)  V()  {}   // value receiver
func (*Inner) P()  {}   // pointer receiver

type S1 struct{ Inner }
type S2 struct{ *Inner }

// Method sets:
// S1:    V()                          // P missing!
// *S1:   V(), P()
// S2:    V(), P()                     // pointer embed: full set
// *S2:   V(), P()
```

---

## Ambiguity at Compile Time

When two embedded fields **at the same depth** declare a method with the same name, calling it on the outer **without qualification** is a compile error.

```go
type A struct{}
func (A) Ping() string { return "A" }

type B struct{}
func (B) Ping() string { return "B" }

type C struct{ A; B }

var c C
// c.Ping()       // ERROR: ambiguous selector c.Ping
c.A.Ping()        // OK — explicit
c.B.Ping()        // OK — explicit
```

This is Go's deliberate solution to the diamond problem: instead of picking a winner silently, the compiler refuses to guess.

### Spec wording

The spec calls a selector `x.f` valid only if there is **exactly one** field/method named `f` at the **shallowest depth** where it is found. Two at the same depth = ambiguity.

### Depth matters

```go
type A struct{}
func (A) Ping() {}

type B struct{ A }   // A is at depth 1 inside B
type C struct{ A; B } // A appears directly (depth 1) AND inside B (depth 2)

var c C
c.Ping()  // OK — A.Ping at depth 1 wins; B.A.Ping at depth 2 is hidden
```

The shallower one wins. Depth-1 vs depth-2 is **not** ambiguous.

---

## Shadowing — Outer Wins

When the outer struct declares the **same method name** as a promoted one, the outer's method **shadows** the inner's. The inner's method is still callable via explicit qualification.

```go
type Greeter struct{ name string }
func (g Greeter) Hello() string { return "hi from " + g.name }

type LoudGreeter struct {
    Greeter
}

func (l LoudGreeter) Hello() string {
    return strings.ToUpper(l.Greeter.Hello()) // call shadowed inner
}

func main() {
    l := LoudGreeter{Greeter: Greeter{name: "ana"}}
    fmt.Println(l.Hello())           // HI FROM ANA  (outer)
    fmt.Println(l.Greeter.Hello())   // hi from ana  (inner via qualification)
}
```

**Key points about shadowing:**
- Outer's method is what `l.Hello()` resolves to.
- Inner's method is **not** removed; it is hidden behind the shorter selector.
- The inner method is **never called automatically** when the outer calls a shared name (no virtual dispatch). You must call `l.Greeter.Hello()` explicitly if you want it.

---

## Explicit Qualification

Even when no shadowing occurs, you can always write the long form:

```go
type Inner struct{}
func (Inner) M() {}

type Outer struct{ Inner }

var o Outer
o.M()        // promoted shortcut
o.Inner.M()  // explicit — recommended when intent matters
```

When to qualify explicitly:
- You want code reviewers to see *which* embedded type provides the method.
- You're debugging an ambiguous selector.
- You're documenting that the method comes from a specific sub-component.

---

## Field Promotion vs Method Promotion

Promotion applies to **fields** as well as methods. The rules are the same.

```go
type Address struct {
    City string
}

type Person struct {
    Address
    Name string
}

p := Person{Address: Address{City: "Tashkent"}, Name: "Bahodir"}
fmt.Println(p.City) // Tashkent — field promotion
fmt.Println(p.Name) // Bahodir
```

Ambiguity rules apply to fields too:

```go
type A struct{ X int }
type B struct{ X int }

type C struct{ A; B }

var c C
// c.X       // ERROR: ambiguous
c.A.X = 1    // OK
c.B.X = 2    // OK
```

---

## Multiple-Level Embedding

Embedding chains:

```go
type L1 struct{}
func (L1) Layer1() string { return "L1" }

type L2 struct{ L1 }
func (L2) Layer2() string { return "L2" }

type L3 struct{ L2 }

var x L3
fmt.Println(x.Layer1()) // "L1" — promoted across two levels
fmt.Println(x.Layer2()) // "L2"
fmt.Println(x.L2.L1.Layer1()) // explicit chain
```

**Depth rule:** the shallowest match wins. `L1` is at depth 2 in `L3`, but if no other field at depth 1 or 2 named `Layer1` exists, `x.Layer1()` resolves there.

---

## Diamond-Like Embedding

The "diamond" pattern: `D` embeds both `B` and `C`, both of which embed `A`. In OOP languages with multiple inheritance, this causes trouble. In Go, it's a non-event:

```go
type A struct{ N int }
func (a A) Show() { fmt.Println("A.N =", a.N) }

type B struct{ A }
type C struct{ A }
type D struct {
    B
    C
}

func main() {
    var d D
    // d.Show()  // ERROR: ambiguous (B.A.Show and C.A.Show both at depth 2)
    // d.N       // ERROR: ambiguous as well
    d.B.Show()   // OK
    d.C.Show()   // OK
    d.B.A.N = 5  // OK
}
```

There is **no diamond problem** in Go because the language refuses to silently merge two paths. You must qualify, or restructure the design. The Go FAQ stance: ambiguity should be a compile error, not a runtime gotcha.

---

## Embedding and Initialisation

### Composite literal — by name

```go
type Inner struct{ X int }
type Outer struct {
    Inner
    Y int
}

o := Outer{
    Inner: Inner{X: 10}, // use the type name as the key
    Y:     20,
}
```

### Composite literal — positional (avoid)

```go
o := Outer{Inner{X: 10}, 20} // legal but fragile
```

Positional literals break silently when fields are reordered or added. Always use named.

### Zero-value embedding

```go
var o Outer  // Outer.Inner == Inner{X: 0}
fmt.Println(o.X) // 0 — fine, promoted, zero
```

If the embed is a pointer (`*Inner`), the zero value is `nil` and methods that dereference will panic:

```go
type S struct{ *Inner }
var s S
s.Inner // nil
// s.X   // panic: nil pointer dereference (X is field on *Inner)
```

Initialise pointer embeds explicitly: `S{Inner: &Inner{}}`.

---

## Patterns and Anti-Patterns

### Pattern: Embed sync.Mutex (idiomatic)

```go
type Cache struct {
    sync.Mutex // embedded
    items map[string]int
}

func (c *Cache) Get(k string) int {
    c.Lock()
    defer c.Unlock()
    return c.items[k]
}
```

### Pattern: Decorator with selective override

```go
type Repo struct{ /* ... */ }
func (r *Repo) Find(id string) string { return "raw" }
func (r *Repo) Save(s string)         { /* ... */ }

type Logged struct{ *Repo }

func (l *Logged) Find(id string) string {
    log.Println("Find", id)
    return l.Repo.Find(id) // delegate to inner
}
// Save is still promoted unchanged
```

### Anti-pattern: Embedding for "is-a"

```go
// Bad — author hopes Manager "is-a" Employee
type Employee struct{ Salary int }
type Manager struct{ Employee }

// This works, but the design says: Manager has-an Employee role,
// not Manager IS an Employee. Composition reads weird here.
```

If you really want a hierarchy, model it explicitly with fields and small interfaces.

### Anti-pattern: Re-embedding to "fix" ambiguity

```go
type A struct{}
func (A) M() {}
type B struct{}
func (B) M() {}

type C struct {
    A
    B
}

func (c C) M() { c.A.M() } // shadowing to disambiguate — OK but reveals design smell
```

This works, but ask whether `C` should really embed both. Often a single explicit field is clearer.

---

## Code Review Checklist

When you see embedding in a PR, check:

- [ ] Is the embedded type's full API really part of the outer's intended surface?
- [ ] If two embeds, can their methods overlap?
- [ ] Is the receiver pointer/value choice consistent across the chain?
- [ ] If embedding `*T`, is initialisation (non-nil) guaranteed?
- [ ] Are promoted methods documented (`// Inherits Mutex.Lock and Mutex.Unlock`)?
- [ ] Could explicit forwarding be clearer?
- [ ] Does the code rely on virtual dispatch (it shouldn't — there isn't any)?

---

## Test

### 1. Method set of `S` when `S` embeds `*T` and `T` has only pointer methods?
```go
type T struct{}
func (*T) M() {}
type S struct{ *T }
```
- a) `S` has no methods, `*S` has `M`
- b) Both `S` and `*S` have `M`
- c) `S` has `M` only via &S
- d) Compile error

**Answer: b**

### 2. What happens?
```go
type A struct{}; func (A) F() {}
type B struct{}; func (B) F() {}
type C struct{ A; B }
var c C
c.F()
```
- a) Calls A.F
- b) Calls B.F
- c) Compile error: ambiguous
- d) Runtime panic

**Answer: c**

### 3. Outer's `Hello` shadows inner's `Hello`. To call inner's, you write...
- a) `super.Hello()`
- b) `o.Hello.Inner()`
- c) `o.Inner.Hello()`
- d) Not possible

**Answer: c**

### 4. The field name when embedding `*pkg.Foo` is...
- a) `pkg.Foo`
- b) `Foo`
- c) `*Foo`
- d) Anonymous, no name

**Answer: b**

### 5. Embedding `T` (value) — is `func (*T) M()` promoted to the value method set of `S`?
- a) Yes
- b) No
- c) Only if `S` is addressable
- d) Only with reflection

**Answer: b** (it is in `*S`'s method set, not `S`'s)

---

## Cheat Sheet

```
PROMOTION RULES
─────────────────────────────────────────
Embed T:   S  gets T's value methods
           *S gets T's value + pointer methods
Embed *T:  S  gets T's value + pointer methods
           *S gets T's value + pointer methods

AMBIGUITY
─────────────────────────────────────────
Two embeds at same depth, same name → compile error
Resolution: qualify (o.Inner.M(), not o.M())

DEPTH
─────────────────────────────────────────
Shallowest match wins
Depth-1 beats depth-2 silently — no ambiguity if depths differ

SHADOWING
─────────────────────────────────────────
Outer declares same name → outer wins
Inner still reachable: o.Inner.M()

NO INHERITANCE
─────────────────────────────────────────
Inner.A() calls Inner.B(), NEVER Outer.B() override.
Composition, not virtual dispatch.

INITIALISATION
─────────────────────────────────────────
Outer{Inner: Inner{...}}     — value embed
Outer{Inner: &Inner{...}}    — pointer embed (must be non-nil)

DIAMOND
─────────────────────────────────────────
Go has no diamond problem
Two paths to same field/method → must qualify
```

---

## Summary

The middle-level rules of struct method promotion are:

1. **`Outer` does not declare `M`** + **promotion unambiguous** + **method set rules** = `M` is promoted.
2. **Value embed `T`**: `T`'s pointer methods are missing from `S`'s value method set.
3. **Pointer embed `*T`**: `T`'s full method set is included in both `S` and `*S`.
4. **Ambiguity is a compile error.** Go does not silently pick a winner.
5. **Shadowing**: outer's same-named method wins; the inner is still reachable via qualification.
6. **No diamond problem**: ambiguity makes you choose, at compile time.
7. **Initialise pointer embeds** explicitly; nil receivers panic on dereference.

At the senior level we see how these rules combine with interface satisfaction, refactoring strategies, and large-codebase patterns.

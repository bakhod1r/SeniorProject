# Sealed Interfaces — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Algebraic Data Types in Go](#algebraic-data-types-in-go)
3. [Sum Types vs Product Types](#sum-types-vs-product-types)
4. [The Visitor Alternative](#the-visitor-alternative)
5. [Dispatch Comparison — Type Switch vs Visitor vs Map](#dispatch-comparison-type-switch-vs-visitor-vs-map)
6. [Performance — Type Switch Internals](#performance-type-switch-internals)
7. [Sealed Interfaces and Generics](#sealed-interfaces-and-generics)
8. [Result/Option Types](#resultoption-types)
9. [Building a Type-Safe State Machine](#building-a-type-safe-state-machine)
10. [Refactoring an Open Interface to Sealed](#refactoring-an-open-interface-to-sealed)
11. [Testing Sealed Code](#testing-sealed-code)
12. [Pitfalls Senior Engineers Hit](#pitfalls-senior-engineers-hit)
13. [When Sealing Is the Wrong Answer](#when-sealing-is-the-wrong-answer)
14. [Summary](#summary)

---

## Introduction

Senior-level treatment of sealed interfaces concerns:
- How sealing maps to **algebraic data type** theory
- Trade-offs versus the **visitor pattern**
- The runtime cost of **type-switch dispatch**
- How sealing interacts with **generics**
- Real refactor strategies

You already know *how* to write a sealed interface. Now we ask *why*, *when*, and *what does it cost*.

---

## Algebraic Data Types in Go

An **Algebraic Data Type** (ADT) is a type formed by combining other types using two operations:

- **Sum** ("OR") — value is one of several variants
- **Product** ("AND") — value contains several fields together

Languages with native ADT support (Haskell, Rust, OCaml, Scala, Swift, recent Java, recent C#) make this trivial:

```rust
// Rust
enum Expr {
    Number(f64),
    Var(String),
    BinOp { op: char, lhs: Box<Expr>, rhs: Box<Expr> },
}
```

Go has no `enum` of this kind. The sealed interface pattern is Go's idiomatic substitute:

```go
type Expr interface{ expr() }

type Number struct{ Value float64 }
type Var    struct{ Name string }
type BinOp  struct{ Op rune; Lhs, Rhs Expr }

func (Number) expr() {}
func (Var)    expr() {}
func (BinOp)  expr() {}
```

This gives you **most** of the ADT benefits:
- Closed variant set (sum)
- Each variant has its own fields (product)
- Type switch is dispatch on tag

What's missing compared to Rust:
- Compile-time exhaustiveness
- Pattern destructuring (`match Expr::BinOp { op, lhs, rhs } => ...`)
- Pattern guards
- Stack-only variants (every Go interface boxes through an itab)

The trade-off is acceptable for most domains; we discuss perf below.

---

## Sum Types vs Product Types

Most Go developers reach for `struct` (a product type) without thinking. A struct is a tuple of fields — it represents "this AND this AND this".

```go
// Product type
type Point struct{ X, Y int } // a point IS X AND Y
```

When the natural model is "this OR this OR this", you have a **sum type** in disguise. The wrong fix is a struct with optional fields:

```go
// Anti-pattern: faking a sum with optional fields
type Expr struct {
    Kind   string  // "number", "var", "binop"
    Number float64 // only valid if Kind == "number"
    Name   string  // only valid if Kind == "var"
    Op     rune    // only valid if Kind == "binop"
    Lhs    *Expr   // only valid if Kind == "binop"
    Rhs    *Expr   // only valid if Kind == "binop"
}
```

This struct has invalid states (e.g. `Kind="number"` AND `Name="foo"`). It is a *bag of bytes* that the consumer must police. The sealed interface lifts the discriminant into the type system:

```go
type Expr interface{ expr() }
```

Now the discriminant is the dynamic type, not a string. There are no invalid states to defend against — the type system enforces the variant.

This refactor (struct-with-Kind → sealed interface) is one of the highest-value moves a senior engineer can make in a Go codebase.

---

## The Visitor Alternative

The visitor pattern is the OO substitute for type-switch dispatch:

```go
type ExprVisitor interface {
    VisitNumber(Number)
    VisitVar(Var)
    VisitBinOp(BinOp)
}

type Expr interface {
    Accept(ExprVisitor)
}

func (n Number) Accept(v ExprVisitor) { v.VisitNumber(n) }
func (n Var)    Accept(v ExprVisitor) { v.VisitVar(n) }
func (n BinOp)  Accept(v ExprVisitor) { v.VisitBinOp(n) }
```

Consumer:

```go
type Evaluator struct {
    env    map[string]float64
    result float64
}

func (e *Evaluator) VisitNumber(n Number) { e.result = n.Value }
func (e *Evaluator) VisitVar(v Var)       { e.result = e.env[v.Name] }
func (e *Evaluator) VisitBinOp(b BinOp) {
    b.Lhs.Accept(e); l := e.result
    b.Rhs.Accept(e); r := e.result
    e.result = apply(b.Op, l, r)
}
```

### When visitor wins

1. **Compile-time exhaustiveness** — adding a new variant *requires* every visitor implementation to add a method, or it won't compile.
2. **Multiple operations are first-class** — each visitor type is a different operation.
3. **Stable consumer API** — adding a new operation never touches the AST.

### When type switch wins

1. **Open consumer set** — any caller can write a switch without implementing a method on every variant.
2. **Adding a new variant is easy** — just add a new struct + seal method, then update existing switches (the linter helps).
3. **Less ceremony** — no `Accept`/`Visit*` plumbing.

Go's idiomatic preference is **type switch**, because Go optimizes for "easy to add a variant" over "easy to add an operation". Most domain models grow more variants than operations.

### The Expression Problem

| | Easy to add variants | Easy to add operations |
|---|---|---|
| **Type switch** | Yes (linter prompts switches to update) | No (every switch must update) |
| **Visitor** | No (every visitor must update) | Yes (just write a new visitor) |

Pick by which axis grows more in your domain.

---

## Dispatch Comparison — Type Switch vs Visitor vs Map

```go
// Type switch
func eval(e Expr) float64 {
    switch n := e.(type) {
    case Number: return n.Value
    case Var:    return env[n.Name]
    case BinOp:  return apply(n.Op, eval(n.Lhs), eval(n.Rhs))
    }
    panic("unreachable")
}

// Visitor (above)
e.Accept(evaluator)

// Function-table dispatch
var dispatch = map[reflect.Type]func(Expr) float64{
    reflect.TypeOf(Number{}): func(e Expr) float64 { return e.(Number).Value },
    reflect.TypeOf(Var{}):    func(e Expr) float64 { return env[e.(Var).Name] },
}

func eval(e Expr) float64 {
    return dispatch[reflect.TypeOf(e)](e)
}
```

Bench results (rough, AMD64, Go 1.22):

| Strategy | ns/op | allocs |
|----------|-------|--------|
| Direct concrete call | 0.5 | 0 |
| Type switch (3 cases) | 1.5 | 0 |
| Type switch (30 cases) | 5–8 | 0 |
| Visitor (vtable) | 2 | 0 |
| Map dispatch (`reflect.Type` key) | 30+ | 1+ |

**Type switch is fast** — usually 1–2 ns per case. The compiler often emits a small jump table. Map-based dispatch through `reflect.Type` is two orders of magnitude slower.

For hot paths (parsers, interpreters, compilers), **type switch** with a sealed interface is the right answer.

---

## Performance — Type Switch Internals

A `type switch` on an interface value compares the dynamic type pointer against each case's expected type. The compiler emits roughly:

```
TYPESWITCH on x.(type):
    load itab pointer from x
    load type pointer from itab
    cmp type, *Number
    je case_number
    cmp type, *Var
    je case_var
    cmp type, *BinOp
    je case_binop
    jmp default
```

For small case counts (≤ ~8) this is a linear chain of compares. For larger counts the compiler may use a hash or jump table — but research suggests it's still mostly linear up to dozens of cases. So:

- 3 cases → 3 ns/op typical
- 10 cases → 5–10 ns/op
- 60 cases → can hit 20+ ns/op

If you have a **very large** sealed interface and a hot dispatch loop, consider:
1. Sub-sealing (split into smaller sealed interfaces, each with fewer variants per switch).
2. Adding a `kind() Kind` method to skip type switch entirely:
   ```go
   func (Number) Kind() Kind { return KindNumber }
   func eval(e Expr) float64 {
       switch e.Kind() {
       case KindNumber: return e.(Number).Value
       ...
       }
   }
   ```
   This trades a tiny amount of safety (you can lie in `Kind()`) for a faster integer compare.
3. Pre-cast at construction (callers know the variant).

In 99% of code, the type-switch cost is dwarfed by everything else. Profile first.

---

## Sealed Interfaces and Generics

Go 1.18 generics interact with sealed interfaces in subtle ways.

### Sealed interface as a type constraint

```go
type Expr interface{ expr() }

func Map[T any](exprs []Expr, f func(Expr) T) []T {
    out := make([]T, len(exprs))
    for i, e := range exprs { out[i] = f(e) }
    return out
}
```

This works — `Expr` constrains the interface, and `expr()` keeps the variant set closed.

### Generic sealed interface

```go
type Result[T any] interface {
    isResult()
}

type Ok[T any]  struct{ Value T }
type Err[T any] struct{ Err error }

func (Ok[T])  isResult() {}
func (Err[T]) isResult() {}
```

A `Result[int]` and `Result[string]` are distinct sealed interfaces, each with its own pair of `Ok[T]/Err[T]`. The seal still works because `isResult` is unexported.

### Method-set restriction

A method on a generic type **cannot** introduce its own type parameters (Go 1.22), so:

```go
type Expr interface{ expr() }
type Number[T any] struct{ Value T }
func (Number[T]) expr() {} // ok

// But you cannot do:
// func (n Number[T]) Map[U any](f func(T) U) Number[U] { ... }
```

Lift such operations to package-level generic functions. This is the standard Go idiom.

### Type-set interfaces vs sealed interfaces

Go 1.18 added type-set interfaces (constraint syntax `~int | ~float64`). These are **different** from sealed interfaces — type sets are constraints used in generics; sealed interfaces are runtime-dispatch interfaces. Don't confuse them.

```go
// Type-set — constraint, no methods, used at compile time
type Number interface { ~int | ~float64 }

// Sealed — runtime, methods, dispatch via itab
type Expr interface { expr() }
```

You cannot use a sealed interface as a generic constraint and get the closed-set benefit at compile time. The compiler still treats it as `interface{ expr() }` for monomorphisation.

---

## Result/Option Types

A common ADT is `Result[T]` (`Ok | Err`) or `Option[T]` (`Some | None`):

```go
package result

type Result[T any] interface {
    result()
    Get() (T, error) // unwrap
}

type Ok[T any]  struct{ Value T }
type Err[T any] struct{ Err error }

func (Ok[T])  result() {}
func (Err[T]) result() {}

func (o Ok[T])  Get() (T, error)  { return o.Value, nil }
func (e Err[T]) Get() (T, error)  { var z T; return z, e.Err }

func OkOf[T any](v T) Result[T]    { return Ok[T]{Value: v} }
func ErrOf[T any](err error) Result[T] { return Err[T]{Err: err} }
```

Usage:

```go
r := result.OkOf(42)

switch r := r.(type) {
case result.Ok[int]:  fmt.Println("got", r.Value)
case result.Err[int]: fmt.Println("err", r.Err)
}
```

Whether this is *better* than Go's idiomatic `(T, error)` return is debated. It works, and it composes nicely in pipelines (`Map`, `FlatMap`). But it adds machinery to every function signature. Most Go code stays with `(T, error)`.

Use `Result`-style sealed types when you have:
- A pipeline of stages where errors should be lazy / accumulated
- A protocol where success and error carry different structured payloads (not just `error`)
- A cross-language boundary where the consumer expects `Either`-style values

---

## Building a Type-Safe State Machine

Sealed interfaces let you encode states as types so that illegal transitions don't compile:

```go
package order

// Sealed states.
type State interface{ state() }

type Draft struct{ items []Item }
type Submitted struct{ id string; items []Item; submittedAt time.Time }
type Paid struct{ id string; amount Money; paidAt time.Time }

func (Draft)     state() {}
func (Submitted) state() {}
func (Paid)      state() {}

// Transitions return a different state type.
func (d Draft) Submit() (Submitted, error) {
    if len(d.items) == 0 { return Submitted{}, errors.New("empty") }
    return Submitted{id: newID(), items: d.items, submittedAt: time.Now()}, nil
}

func (s Submitted) Pay(amount Money) Paid {
    return Paid{id: s.id, amount: amount, paidAt: time.Now()}
}
```

Now `Paid.Submit()` does not compile — the API is type-safe. A consumer can store the value as `State` for serialisation:

```go
type Order struct {
    State State
}

switch s := o.State.(type) {
case Draft:     // can submit
case Submitted: // can pay
case Paid:      // terminal
}
```

This pattern shines in protocols, financial workflows, and game logic.

---

## Refactoring an Open Interface to Sealed

You inherit a codebase with:

```go
type Event interface {
    Topic() string
    Payload() []byte
}
```

Anyone can implement. You realise the events form a fixed set: `OrderPlaced`, `OrderShipped`, `OrderCanceled`. Refactor to seal:

### Step 1: Add the seal method

```go
type Event interface {
    Topic() string
    Payload() []byte
    event()
}
```

### Step 2: Implement seal on all known variants

```go
func (OrderPlaced)   event() {}
func (OrderShipped)  event() {}
func (OrderCanceled) event() {}
```

### Step 3: Compile and find external implementers

The compiler tells you exactly which packages have other `Event` implementations. Each is a candidate to either:
- Move into the events package as a real variant
- Be replaced with a real variant

### Step 4: Migrate consumers to type switch

```go
// Before (interface call)
func handle(e Event) { log(e.Topic(), e.Payload()) }

// After (variant-aware)
func handle(e Event) {
    switch e := e.(type) {
    case OrderPlaced:   ...
    case OrderShipped:  ...
    case OrderCanceled: ...
    default:
        log("unknown", e)
    }
}
```

### Step 5: Add a linter

Add `staticcheck` / `exhaustive` to enforce coverage going forward.

This refactor is **breaking** for external implementers — bump major version. Inside a single binary or monorepo, do it as one atomic change.

---

## Testing Sealed Code

### Test a variant in isolation

```go
func TestNumberEval(t *testing.T) {
    e := Number{Value: 3.14}
    if got := Eval(e, nil); got != 3.14 {
        t.Errorf("got %v, want 3.14", got)
    }
}
```

### Test a switch is exhaustive (manually, or via linter)

```go
func TestEvalCoversAllVariants(t *testing.T) {
    cases := []Expr{
        Number{Value: 1},
        Var{Name: "x"},
        BinOp{Op: '+', Lhs: Number{1}, Rhs: Number{2}},
    }
    for _, e := range cases {
        _ = Eval(e, map[string]float64{"x": 1})
    }
    // If a new variant is added without updating Eval,
    // this test will not catch it. Use go-sumtype.
}
```

### Use `go-sumtype` for compile-time exhaustiveness

```go
//go-sumtype:decl Expr
type Expr interface{ expr() }
```

The tool then errors at build time if any switch on `Expr` lacks a case.

### In-package test variants

If you need a stub, put it in a `_test.go` file in the same package:

```go
// expr_test.go
package expr

type stubExpr struct{}
func (stubExpr) expr() {}
```

It satisfies the seal because it's in `package expr`.

---

## Pitfalls Senior Engineers Hit

### Pitfall 1: Sealing too early

You start with two variants and seal. Then a real plug-in need shows up — too late, breaking change required to unseal.

**Fix:** seal only when the variant set is conceptually closed. If you suspect users may want to extend, leave open and add the seal later if needed.

### Pitfall 2: Hidden switch divergence

A codebase has 12 type switches on `Expr`. You add a 4th variant. You update 11 switches. The 12th — buried in a test helper — is missed. Bug ships.

**Fix:** linter (`go-sumtype`, `exhaustive`) in CI.

### Pitfall 3: Sealing a serialised type

You seal `Event`, then realise a downstream consumer (different binary, different team) needs to deserialise events from a queue. Their generated structs can't be `Event` because the seal lives in your package.

**Fix:** unseal, OR provide a registration-based decoder, OR move events to a shared module.

### Pitfall 4: The seal is not actually sealing

Someone exported the seal method during a refactor (`expr` → `Expr`). Now anyone can implement.

**Fix:** code-review checklist; lint rule that flags exported methods that look like seals (`SealedXxx`, `IsXxx` on a sum type).

### Pitfall 5: Type-switch on `any`

The seal is enforced by interface satisfaction. If you switch on `any` (interface{}) you bypass the contract:

```go
func eval(e any) float64 { // BAD — accepts anything
    switch n := e.(type) {
    case Number: return n.Value
    ...
    }
}
```

**Fix:** the parameter type should be `Expr`, not `any`.

### Pitfall 6: Equating sealed with abstract

A sealed interface is not a base class; you cannot share fields across variants without embedding. Don't try to put fields on the interface — that doesn't compile.

---

## When Sealing Is the Wrong Answer

- **Plugin systems** — users must extend.
- **`io.Reader`-style contracts** — the whole point is openness.
- **Single implementation today, future grafts likely** — leave open.
- **Codebases with cross-team boundaries** — sealing forces every variant into one package, which may not match team ownership.
- **Performance-critical loops with one variant 95% of the time** — a non-interface concrete type is faster (no itab lookup).

A sealed interface is a precise tool. Reach for it when you really mean: "this set of variants is fixed, by design, and consumers should treat it that way."

---

## Summary

At the senior level, sealed interfaces become a deliberate ADT-modeling choice:

1. **ADT emulation** — sum + product types via sealed interface + struct.
2. **Visitor vs type switch** — choose by which axis (variants vs operations) grows.
3. **Performance** — type switches are O(n) on case count; sub-seal at high variant counts.
4. **Generics** — sealed generic interfaces work; remember method-parameter restrictions.
5. **Result/Option** — useful in pipelines, but Go idioms still favor `(T, error)`.
6. **State machines** — encode states as variants; transitions return different types.
7. **Refactor** — open → sealed is a breaking change with predictable steps.
8. **Linters** — `go-sumtype` and `exhaustive` are essential for safety.

At the professional level we'll cover library API design, migration strategies, and how to handle this across multi-team and multi-version boundaries.

# Static vs Dynamic Typing — Middle Level

> **Topic:** [Static vs Dynamic Typing](README.md)
> **Focus:** The middle grounds — gradual typing, optional typing, duck typing vs structural typing, and the escape hatch (`any`/`Any`) that quietly erodes every guarantee.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)

---

## Introduction

> Focus: **The world is not actually "static OR dynamic."** Most real-world systems today live in a *middle ground*: a dynamic language with optional static checking grafted on. What does that hybrid actually guarantee — and where does it leak?

The junior view — static checks before running, dynamic checks while running — is correct but binary. The industry has spent the last decade building the *space between* those poles, because each pole has a cost the other doesn't, and large teams wanted both: dynamic's flexibility for the messy 20% of code, static's safety for the well-understood 80%.

The result is **gradual typing**: you take a dynamic language and add *optional* type annotations that a separate checker verifies, while leaving the runtime untouched. The flagship examples are everywhere you look:

- **TypeScript** — static types over JavaScript. The checker runs at build time; the types are erased and you ship plain JS.
- **Python type hints + mypy / Pyright** — annotations (`def f(x: int) -> str:`) checked by a tool; the interpreter mostly ignores them at runtime.
- **Sorbet** — gradual static typing for Ruby (built by Stripe for a multi-million-line codebase).
- **Hack** — Facebook/Meta's gradually-typed dialect of PHP.

These systems all share a defining feature and a defining weakness. The feature: you can annotate *some* of the code and leave the rest dynamic, mixing freely. The weakness: there's an **escape hatch** — `any` in TypeScript, `Any` in Python, `T.untyped` in Sorbet — a type that means "stop checking, trust me." Every `any` is a hole in the dam, and one hole can flood the room downstream. Understanding *exactly* what `any` does and where guarantees survive or evaporate is the core skill of this level.

Alongside gradual typing, this level untangles two often-confused ideas that are really the *static and dynamic versions of the same intuition*:

- **Duck typing** (dynamic): "if it has a `.quack()` method, it's a duck" — checked at runtime, at the call site.
- **Structural typing** (static): "any type with a `quack(): void` method *is* a Duck" — the same idea, but verified at compile time by *shape*, not by declared name. TypeScript and Go interfaces are structural. Java and C# interfaces are *nominal* (you must explicitly declare you implement them).

> 🎓 **Why this matters for a mid-level engineer:** You will almost certainly work in a TypeScript or typed-Python codebase, and you will be the one deciding whether to reach for `any` to make an error go away. That one decision — `any` vs doing the work to type it properly — is the difference between a type system that protects the team and a type system that's theater. Knowing what gradual typing guarantees (and the precise shape of the "gradual guarantee") makes you the person who can hold the line.

This page covers: gradual typing and its formal promise (the **gradual guarantee**), optional/erased typing, the `any` escape hatch and how unsoundness propagates from it, duck typing vs structural vs nominal typing, and a forward look at how type inference makes static typing *feel* dynamic. `senior.md` formalizes soundness and covers erasure vs reification in depth; `professional.md` covers the performance and migration story.

---

## Prerequisites

What you should know before reading this:

- **Required:** Everything in `junior.md` — the static/dynamic distinction (when checks happen), strong vs weak as an orthogonal axis, and where the type lives (variable vs value).
- **Required:** Working familiarity with at least one of TypeScript, typed Python, or Go — enough to read annotations.
- **Required:** What an interface (or protocol) is — a set of methods a type promises to provide.
- **Helpful:** Having seen a `type: ignore` or `as any` cast in real code, and wondered what it actually does.

You do **not** need to know:

- The formal type-soundness proof or the meaning of "progress and preservation" (that's `senior.md`).
- How Hindley–Milner inference works mechanically (forward-referenced, deep-dived later).
- JIT internals, hidden classes, or monomorphization (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Gradual typing** | A type system where parts of a program are statically typed and parts are dynamically typed, and the two interoperate freely. |
| **Optional typing** | Annotations that the checker uses but the **runtime ignores** — they have no effect on execution (Python hints by default, TypeScript). |
| **`any` / `Any`** | The "dynamic" type within a gradual system. It's compatible with *everything* in both directions and turns off checking wherever it flows. |
| **The gradual guarantee** | The formal promise that adding (correct) type annotations to a working program never changes its runtime behavior, only adds checks; and removing them never introduces a static error. |
| **Erased / erasure** | Types exist only at compile time and are removed before running; no type information survives to runtime (Java generics, TypeScript). |
| **Reified** | Types survive to runtime and can be inspected (`isinstance`, reflection, `.GetType()`) — C#, Go, Python values. |
| **Nominal typing** | Two types are compatible only if they share a *declared name/relationship* (you must write `implements Duck`). Java, C#, Rust traits. |
| **Structural typing** | Two types are compatible if they have the same *shape* (same fields/methods), regardless of name. TypeScript, Go interfaces. |
| **Duck typing** | The dynamic-runtime analogue of structural typing: an operation succeeds if the value happens to support it at runtime, no declaration required. |
| **Protocol (Python) / interface (Go/TS)** | A description of required methods/fields used for structural checking. |
| **Type inference** | The checker deducing types you didn't annotate, letting statically-typed code read as tersely as dynamic code. |
| **Monkeypatching** | Replacing or adding methods on a class/object at runtime — a dynamic-typing power that static checking struggles to model. |
| **Soundness (informal)** | A type system is sound if a program that type-checks can never have a type error at runtime. Gradual systems with `any` are deliberately **unsound**. |

---

## Core Concepts

### 1. Gradual Typing: A Dial, Not a Switch

Gradual typing replaces the binary "static OR dynamic" with a **dial** you can turn per-variable, per-function, per-file. An unannotated parameter is dynamic (typed `any`/`Any`); an annotated one is static. The two coexist in the same program, and crucially, **values cross the boundary in both directions**.

```typescript
function lengthOf(x: string): number {  // statically typed
    return x.length;
}

let data: any = JSON.parse(input);       // dynamic — could be anything
let n = lengthOf(data);                  // boundary: `any` flows into a `string` param — allowed, NOT checked
```

The type checker allows `data` (an `any`) to be passed where a `string` is expected. It assumes you know what you're doing. If `data` is actually a number at runtime, plain TypeScript will *not* catch it — the types were erased, and there's no runtime guard. (This is the unsoundness; more below.)

### 2. The Escape Hatch: `any` / `Any`

`any` is the single most important — and most dangerous — feature of gradual typing. It is the type that is **assignable to and from everything**:

```typescript
let x: any = 42;
let s: string = x;     // allowed — any -> string, no check
let n: number = x;     // also allowed — any -> number
x.foo.bar.baz();       // allowed — any access on any is "valid"
```

`any` is "turn off the type system here." It exists so you can incrementally adopt types (the un-migrated parts are `any`) and so you can model genuinely dynamic data (parsed JSON, plugin systems). But it has a **viral, silent** failure mode: once a value is `any`, anything *derived* from it is also unchecked, so a single `any` at the top of a data-flow chain disables checking all the way down. The error that `any` would have caught reappears — at runtime, exactly where static typing was supposed to save you.

> The mid-level discipline in one rule: **every `any` is a debt. Pay it down or quarantine it.** A typed codebase's real safety is roughly `1 - (fraction of values that are any)`.

### 3. The Gradual Guarantee

The **gradual guarantee** (Siek, Vitousek, et al.) is the formal contract a *well-designed* gradual type system makes:

> Adding type annotations to a working program should only ever *add checks* — it must not change the program's runtime behavior (beyond possibly raising a type error sooner). Conversely, removing annotations (making things `any`) must never introduce a *static* type error.

In plain terms: **types are a monotonic safety net.** You can always make a program "more dynamic" by deleting annotations without breaking the build, and "more static" by adding them without changing what the program does (when correct). This is what makes gradual migration *safe to do piecemeal* — you can type one module at a time and trust that you haven't silently changed behavior elsewhere.

Note: TypeScript and Python-with-mypy **erase** types and so don't enforce types at the boundary at runtime — they uphold the *static* half of the guarantee but not the runtime-check half that fully-sound gradual systems (with runtime "casts" inserted at boundaries) would. This is a deliberate performance trade-off, and it's why a wrong `any` becomes a silent runtime bug rather than a clean boundary error.

### 4. Optional Typing: Annotations the Runtime Ignores

**Optional typing** is the special case where the annotations have *zero* runtime effect — they're purely a tool for the checker. This describes Python type hints (by default) and TypeScript:

```python
def greet(name: str) -> str:
    return "Hello, " + name

greet(42)   # mypy: ERROR. But at RUNTIME this raises TypeError on "+", because Python ignores the hint.
```

Python's interpreter does **not** check `name: str` at runtime — you can call `greet(42)` and Python will happily try, then fail on the `+` for a *different* reason (string + int). The hint guided the *checker*, not the *runtime*. (Libraries like `pydantic` and `typeguard` *opt in* to runtime enforcement, but that's extra machinery, not the language.)

This is the connection to **erasure** (next concept and `senior.md`): optional types are erased, so they cost nothing at runtime and guarantee nothing at runtime. Their entire value is delivered before the program runs.

### 5. Erasure vs Reification (Introduction)

- **Erased**: types are removed before running. TypeScript compiles to plain JavaScript with no type info. Java generics are erased — `List<String>` and `List<Integer>` are the same `List` at runtime. You *cannot* ask "what type parameter is this?" at runtime.
- **Reified**: types survive to runtime and can be inspected. Python values carry their type (`type(x)`, `isinstance(x, int)`). Go has runtime type information (reflection, type switches). C# generics are reified — `List<int>` truly knows it's `int` at runtime.

Why it matters here: in an **erased** gradual system, the `any` escape hatch leaks silently because there's no runtime type to catch the mismatch. In a **reified** dynamic language, the runtime *always* knows the real type, which is exactly how dynamic checking works in the first place — and why `isinstance` is available for hand-rolled validation. `senior.md` goes deep; for now: erased = cheap + silent failures; reified = costs memory + enables runtime introspection.

### 6. Duck Typing vs Structural vs Nominal Typing

These three answer the question: *when is value X acceptable where type Y is expected?*

**Duck typing (dynamic):** X is acceptable if, *at runtime*, it happens to have the methods you call on it. No declaration, no check beforehand.

```python
def make_it_quack(thing):
    thing.quack()   # works for ANYTHING with a .quack(), discovered at call time

class Dog:
    def quack(self): print("woof-ish quack")

make_it_quack(Dog())   # fine — Dog walks like a duck
```

**Structural typing (static):** X is acceptable if its *shape* (fields/methods) matches Y — verified by the compiler, no declared relationship needed. This is "duck typing checked at compile time."

```go
type Quacker interface { Quack() }

type Dog struct{}
func (Dog) Quack() {}   // Dog never says "implements Quacker" — but structurally it does

func main() {
    var q Quacker = Dog{}   // compiles: Dog has the right shape
}
```

```typescript
interface Quacker { quack(): void }
const dog = { quack() {}, bark() {} };
const q: Quacker = dog;   // compiles: dog's shape includes quack()
```

**Nominal typing (static):** X is acceptable only if it *declares* a relationship to Y. Shape alone is not enough.

```java
interface Quacker { void quack(); }
class Dog implements Quacker {   // MUST say "implements Quacker"
    public void quack() {}
}
// A class with a quack() method but no "implements Quacker" is NOT a Quacker in Java.
```

The mapping is the punchline: **structural typing is the static, compile-time-verified version of duck typing.** Go and TypeScript give you duck-typing's flexibility *with* a compiler checking it. Java and Rust are nominal — more explicit, less accidental coupling, but more ceremony.

### 7. Type Inference Makes Static Feel Dynamic (Forward Reference)

A big reason people *think* they want dynamic typing is the terseness — no annotations. But much of that terseness is available statically through **type inference**: the compiler figures out the type from the value.

```go
x := 5            // inferred int — no annotation, still fully static
name := "Ada"     // inferred string
```

```typescript
const nums = [1, 2, 3];   // inferred number[]
```

Languages with **Hindley–Milner** inference (Haskell, OCaml, ML, and Rust's local inference) take this furthest — you can write whole functions with *no* annotations and still get full static checking, because the compiler reconstructs every type. (The HM algorithm is a forward-referenced topic of its own.) The takeaway for this level: **"no annotations" does not mean "dynamic."** Inferred static typing gives you dynamic-looking source with compile-time guarantees — undercutting the main ergonomic argument for dynamic typing.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Gradual typing** | Renovating a house room by room while living in it — some rooms are finished (typed), some are still bare studs (dynamic), and you can walk between them. |
| **`any` escape hatch** | A "staff only" door that's propped open — convenient, but now anyone can wander into the secure area, and you won't notice until something's missing. |
| **The gradual guarantee** | A promise that putting up new walls (annotations) never changes where the furniture sits (runtime behavior) — only adds doors that check ID. |
| **Optional typing (erased)** | Blueprints used during construction then thrown away — they shaped the build but aren't part of the finished house. |
| **Reified types** | A serial-number plate riveted to every appliance — you can always read what it is, even years later. |
| **Duck typing** | Auditioning actors by having them perform the scene — if they can do it, they're cast, no résumé required. |
| **Structural typing** | A casting director reading résumés and confirming each candidate *lists* the required skills before the audition — same idea, checked up front. |
| **Nominal typing** | A union card: you can only do the job if you're a *card-carrying member*, regardless of whether you can do the work. |
| **Monkeypatching** | Rewiring a building's electrics while the lights are on — possible, powerful, and terrifying to anyone relying on the original wiring diagram. |

---

## Mental Models

### The "Sieve with Holes" Model for `any`

Picture the type checker as a sieve catching type errors before they reach runtime. Every `any` is a **hole punched in the sieve**. A program that's 95% typed but routes its core data through one `any` has a hole right where the water flows — most errors still pass straight through. Type-safety is not "did I add types?" but "what fraction of the *actual data flow* is non-`any`?" One well-placed `any` can neutralize a thousand annotations.

### The "Two Languages Sharing a Runtime" Model

A gradually typed program is really two languages braided together: a static one and a dynamic one, sharing one runtime. The annotations mark which language each region is written in. The `any` boundary is the *border crossing*. In an erased system (TS, mypy), there are **no guards at the border** — values cross unchecked, and a smuggled wrong type detonates somewhere downstream. Keeping the border small and well-guarded (few `any`s, validated at the edge) is the whole game.

### The "Duck Audition vs Duck Résumé" Model

Duck typing auditions every value at runtime: call `.quack()` and see what happens. Structural typing reads the résumé at compile time: does this shape *list* `quack()`? Nominal typing checks the union card: are you a *declared* Duck? Moving left-to-right trades flexibility for earlier, stronger guarantees. Structural typing is the sweet spot many modern languages (Go, TypeScript) chose: the audition's flexibility with the résumé's up-front check.

---

## Code Examples

### Gradual migration in Python: from dynamic to checked

```python
# Step 0 — fully dynamic, no hints
def total_price(items):
    return sum(i["price"] * i["qty"] for i in items)

# Step 1 — add hints; mypy now checks call sites, runtime unchanged
from typing import TypedDict

class Item(TypedDict):
    price: float
    qty: int

def total_price(items: list[Item]) -> float:
    return sum(i["price"] * i["qty"] for i in items)

# Now: total_price([{"price": "9.99", "qty": 1}])  -> mypy ERROR (price must be float)
# But at RUNTIME, with no enforcement, "9.99" * 1 == "9.99" and sum() then fails differently.
```

The hints upgraded the *checker's* knowledge without touching the *runtime*. That's optional + gradual typing in one snippet.

### The `any` leak, demonstrated

```typescript
interface User { id: number; name: string; }

function getUser(): User {
    const raw: any = JSON.parse('{"id": 1, "naem": "Ada"}');  // typo in data, but it's `any`
    return raw;   // `any` -> User: ALLOWED, no check. The typo passes straight through.
}

const u = getUser();
console.log(u.name.toUpperCase());  // RUNTIME: Cannot read properties of undefined (reading 'toUpperCase')
```

TypeScript's checker was *disabled* the moment data became `any`. The bug it exists to prevent happened anyway, at runtime — because the `any` punched a hole right at the data source. The fix is to validate at the boundary (next).

### Closing the `any` hole: validate at the boundary

```typescript
function parseUser(json: string): User {
    const raw: unknown = JSON.parse(json);   // `unknown`, not `any` — forces a check before use
    if (
        typeof raw === "object" && raw !== null &&
        "id" in raw && typeof (raw as any).id === "number" &&
        "name" in raw && typeof (raw as any).name === "string"
    ) {
        return raw as User;   // narrowed and verified — the cast is now justified
    }
    throw new Error("invalid user payload");
}
```

`unknown` is `any`'s safe sibling: it's compatible *from* everything but assignable *to* nothing without a check. Using `unknown` at boundaries and narrowing before use is how you keep the sieve hole-free. (Libraries like Zod or `io-ts` automate this; the principle is the same.)

### Structural vs nominal, side by side

```go
// Go — structural. No "implements" needed.
type Stringer interface{ String() string }
type Point struct{ X, Y int }
func (p Point) String() string { return fmt.Sprintf("(%d,%d)", p.X, p.Y) }
var s Stringer = Point{1, 2}   // works: Point structurally satisfies Stringer
```

```java
// Java — nominal. The declaration is mandatory.
interface Stringer { String stringify(); }
class Point /* must say */ implements Stringer {
    public String stringify() { return "(" + x + "," + y + ")"; }
}
// A Point class with a matching method but no `implements Stringer` is NOT a Stringer.
```

### Duck typing in Python = structural typing's dynamic cousin

```python
from typing import Protocol

# The dynamic version: duck typing, checked at runtime when .area() is called
def describe(shape):
    print(f"area is {shape.area()}")   # works for anything with .area()

# The static version: a Protocol (structural), checked by mypy at compile time
class HasArea(Protocol):
    def area(self) -> float: ...

def describe_typed(shape: HasArea) -> None:
    print(f"area is {shape.area()}")   # mypy verifies the argument has .area() BEFORE running
```

Python's `Protocol` (PEP 544) is literally "structural typing for Python" — the compile-time formalization of the duck typing Python always had at runtime. Same intuition, moved earlier in time.

---

## Pros & Cons

| Aspect | Gradual / Optional Typing | Pure Static | Pure Dynamic |
|--------|---------------------------|-------------|--------------|
| **Adoption cost** | Low — type incrementally, file by file. | High — must type everything up front. | Zero. |
| **Strength of guarantee** | Only as strong as the *least*-typed path; `any` voids it. | Strong (modulo casts). | None at compile time. |
| **Flexibility** | High — keep dynamic where you need it. | Lower — conservative checker. | Highest. |
| **Runtime cost** | Zero if erased (TS, mypy). | Zero/low. | Pays runtime type checks. |
| **Migration story** | Excellent — the gradual guarantee makes piecemeal safe. | N/A — born static. | N/A — born dynamic. |
| **Failure mode** | Silent: a wrong `any` crashes at runtime as if untyped. | Loud at build. | Loud at run, on executed paths. |
| **Tooling** | Improves as coverage rises; great IDE help on typed regions. | Excellent. | Limited. |

---

## Use Cases

**Gradual / optional typing shines when:**

- You have a **large existing dynamic codebase** (Python, JS, Ruby, PHP) and can't stop the world to rewrite — type the hot, bug-prone modules first.
- Different parts of the system have **different correctness needs** — type the payment logic strictly, leave the one-off migration script dynamic.
- You're building a **library** whose users want autocomplete and signatures (publish type stubs / `.d.ts`).
- You ingest **genuinely dynamic data** (JSON, config, plugin output) — use `unknown`/validation at the edge, typed everywhere inside.

**Structural typing shines when:**

- You want **duck typing's flexibility with compile-time safety** — interfaces satisfied by shape (Go, TS).
- You're integrating types you **don't own** — a third-party object can satisfy your interface without modifying it.

**Nominal typing shines when:**

- You want **explicit, intentional contracts** — "this is a `Celsius`, not just any `float`" — and to prevent accidental structural matches.
- **Domain modeling** where two types share a shape but mean different things (a `UserId` and an `OrderId` are both ints but must not mix).

---

## Coding Patterns

### Pattern 1: `unknown` at boundaries, never `any`

Treat data entering your program (JSON, env vars, network) as `unknown`, validate it into a real type, and let everything inside stay fully typed. `any` is for genuine "I give up"; `unknown` is for "I'll check first."

### Pattern 2: Quarantine the dynamic part

If a region must be dynamic (reflection, plugins, metaprogramming), wrap it behind a *typed* facade. The rest of the codebase sees a clean typed interface; the unsafe `any` lives in one small, well-tested module.

### Pattern 3: Strict mode on, ratchet only forward

Enable the strictest checker settings (`strict: true` in `tsconfig`, `--strict` in mypy) and add a CI check that the count of `any`/`type: ignore` never *increases*. Coverage ratchets up, never down.

### Pattern 4: Protocols/interfaces for structural seams

Use structural interfaces (Go `interface`, Python `Protocol`, TS `interface`) at module seams so callers can supply any conforming type — this gives you duck typing's flexibility without giving up the compiler.

### Pattern 5: Make illegal states unrepresentable with nominal wrappers

Wrap primitives in distinct nominal types (`type UserId = ...` branded types in TS, newtypes in Rust/Haskell) so the compiler stops you from passing an `OrderId` where a `UserId` belongs — a class of bug structural typing alone won't catch.

---

## Best Practices

- **Count your `any`s.** They're the real measure of how much your type system protects you. Track and reduce them. A "fully typed" codebase riddled with `any` is theater.
- **Prefer `unknown` to `any` at every boundary.** It forces a check instead of silently disabling one.
- **Turn on strict mode from day one** on new projects; ratchet it on for old ones. Lenient defaults let `any` breed.
- **Don't fight inference.** Let the checker infer locals; annotate the *interfaces* (function signatures, public types). Over-annotating internals is noise; under-annotating boundaries is danger.
- **Use structural typing for flexibility, nominal for safety-critical distinctions.** Know which your language gives you by default and reach for the other when needed.
- **Remember the runtime ignores your hints (erased systems).** If you need runtime enforcement (validating external input), add it explicitly — pydantic, Zod, `typeguard` — don't assume the annotation guards anything at run time.
- **Migrate hot spots first.** When typing a dynamic codebase, type the modules with the most bugs/most churn first — that's where static checking pays back fastest.

---

## Edge Cases & Pitfalls

- **`any` is viral.** Anything derived from an `any` is also `any`. One `any` at a data source disables checking for everything downstream — far beyond the line it appears on.
- **`any` vs `unknown` confusion.** They look similar but `any` *disables* checking while `unknown` *demands* a check before use. Reaching for `any` to silence an error is almost always the wrong move.
- **Erased types don't validate input.** A Python signature `def f(x: int)` does *not* stop someone passing a string at runtime — the hint is gone by then. External input still needs explicit validation.
- **Structural typing's accidental matches.** Two unrelated types with the same shape are interchangeable in a structural system — sometimes you *don't* want that (a `Meters` and a `Feet` both `{value: number}`). Use nominal/branded types to forbid it.
- **Monkeypatching defeats the checker.** Adding methods at runtime (Ruby, Python) is invisible to a static checker, which reasons about the code as written, not as mutated. Gradual checkers either model a fixed set or give up (`any`).
- **The gradual guarantee is about *correct* annotations.** It says adding *right* types doesn't change behavior. A *wrong* annotation plus an `any` boundary absolutely can let a bug through; the guarantee isn't "annotations make bugs impossible."
- **`type: ignore` / `@ts-ignore` are `any` in disguise.** They silence one error and create an unchecked island. Each one is a debt to track.
- **Inferred ≠ dynamic.** `x := 5` in Go and `const x = 5` in TS have no annotation but are fully static. Don't mistake terse inferred code for dynamic typing.

---

## Test Yourself

1. Define gradual typing and state the gradual guarantee in your own words. Why does the guarantee make piecemeal migration *safe*?
2. What exactly does `any` do that `unknown` does not? Rewrite an `any`-using boundary to use `unknown` plus validation.
3. Explain why a TypeScript program that "fully type-checks" can still throw `Cannot read properties of undefined` at runtime. Trace the `any`.
4. Distinguish duck typing, structural typing, and nominal typing. Which is "compile-time duck typing," and which language gives you each?
5. Give an example where structural typing's *accidental* match is a bug, and show how a nominal/branded type fixes it.
6. Python type hints are "optional/erased." What does that mean for `def f(x: int)` when someone calls `f("hello")` at runtime? Why?
7. Show, in code, how a single `any` at the top of a data-flow chain silently disables checking for five lines downstream.
8. Why is "no annotations" not the same as "dynamic"? Use Go's `:=` and Hindley–Milner inference in your answer.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│              GRADUAL / OPTIONAL / STRUCTURAL TYPING               │
├──────────────────────────────────────────────────────────────────┤
│ GRADUAL TYPING                                                   │
│   static + dynamic mixed in one program, interoperating          │
│   TypeScript, Python+mypy, Sorbet(Ruby), Hack(PHP)               │
│   the gradual guarantee: adding correct types only ADDS checks,  │
│     never changes runtime behavior -> safe piecemeal migration   │
├──────────────────────────────────────────────────────────────────┤
│ THE ESCAPE HATCH                                                 │
│   any / Any  = "stop checking here"; assignable to/from ALL      │
│   VIRAL: anything derived from any is unchecked downstream       │
│   unknown   = any's safe sibling; demands a check before use     │
│   type:ignore / @ts-ignore = a localized any                    │
│   safety ~= 1 - (fraction of data flow that is `any`)            │
├──────────────────────────────────────────────────────────────────┤
│ OPTIONAL / ERASED                                                │
│   annotations checked at build, IGNORED at runtime               │
│   TS erases to JS; Python ignores hints; Java erases generics    │
│   => external input still needs explicit runtime validation      │
├──────────────────────────────────────────────────────────────────┤
│ WHEN IS X OK WHERE Y IS EXPECTED?                                │
│   duck typing (dynamic)  : has the method at runtime  -> Python  │
│   structural (static)    : shape matches at compile   -> Go, TS  │
│   nominal (static)       : declared relationship      -> Java    │
│   structural = compile-time duck typing                          │
├──────────────────────────────────────────────────────────────────┤
│ INFERENCE                                                        │
│   no annotation != dynamic.  x := 5 is static int.               │
│   Hindley-Milner: full static checking, zero annotations         │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- The real world isn't static-OR-dynamic; most large systems are **gradually typed** — a dynamic language (JS, Python, Ruby, PHP) with *optional* static checking added (TypeScript, mypy/Pyright, Sorbet, Hack). You can turn the type dial per file, per function.
- The **gradual guarantee** is what makes incremental migration safe: adding *correct* annotations only adds checks and never changes runtime behavior. You can type one module at a time without fear of silently breaking others.
- The **`any`/`Any` escape hatch** is the defining feature *and* the defining weakness. It's assignable to and from everything and **disables checking wherever it flows** — virally, downstream. A typed codebase's real safety is roughly the fraction of its data flow that *isn't* `any`. Prefer **`unknown`** (which forces a check) and validate at boundaries.
- **Optional typing** means the annotations are **erased** — the runtime ignores them (Python hints, TypeScript compile to plain JS). They guarantee nothing at runtime, so external input still needs explicit validation. This connects to **erasure vs reification**: erased types are cheap and silent on failure; reified types (Python values, Go reflection, C# generics) survive to runtime.
- **Duck typing** (dynamic, runtime), **structural typing** (static, by shape), and **nominal typing** (static, by declared name) answer "when is X usable as Y?" with increasing earliness and explicitness. **Structural typing is compile-time duck typing** — Go and TypeScript give you the flexibility of duck typing with a compiler checking it; Java/Rust are nominal.
- **Type inference** (Go's `:=`, TypeScript's `const`, and full Hindley–Milner in Haskell/OCaml/ML) makes static typing read as tersely as dynamic code — so "no annotations" must never be confused with "dynamic." This undercuts the main ergonomic argument for dynamic typing.

---

## What's Next

- `senior.md` — **type soundness** formalized, **erasure vs reification** in depth, and how **inference** reconstructs types.
- `professional.md` — the **performance** consequences (monomorphization, JIT inline caches, hidden classes), the **empirical bug-rate** research, and migrating a large Python/JS codebase.
- `interview.md` — graded questions including the language-specific gradual-typing traps.
- `tasks.md` — exercises on `any` leaks, structural vs nominal, and boundary validation.

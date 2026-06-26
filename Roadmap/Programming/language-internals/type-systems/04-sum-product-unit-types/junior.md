# Sum, Product & Unit Types — Junior Level

> **Topic:** [Sum, Product & Unit Types](README.md)
> **Focus:** The two ways to combine types — **AND** (product) and **OR** (sum) — plus the two boring-looking corner cases (Unit and Void) that make the whole system click.

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
16. [What You Can Build](#what-you-can-build)
17. [Further Reading](#further-reading)

---

## Introduction

> Focus: **What does it mean to combine two types?** There are exactly two fundamental ways, and most type systems give you both.

When you design data, you constantly glue smaller types together to make bigger ones. There are two — and really only two — fundamental ways to do this:

- **AND**: a value holds an `A` **and** a `B` at the same time. A `Point` has an `x` **and** a `y`. A `User` has a name **and** an email **and** an age. These are **product types**: structs, records, tuples, classes-with-fields.
- **OR**: a value is an `A` **or** a `B`, but not both at once. A `Shape` is a `Circle` **or** a `Rectangle` **or** a `Triangle`. A network result is a `Success` **or** an `Error`. These are **sum types**: also called tagged unions, variants, discriminated unions, or "enums with data."

Most languages give you products easily (every language has structs or objects). Many older mainstream languages historically made sum types *awkward* — you faked them with class hierarchies, interfaces, or a struct full of nullable fields and boolean flags. Modern languages (Rust, Swift, Kotlin, TypeScript, Haskell, OCaml, F#, recent Java) give you sum types directly, and once you have them, a huge category of bugs simply stops being possible.

There are also two corner cases that look trivial but are load-bearing:

- The **Unit type** — a type with **exactly one value**. In Rust it's `()`, in Haskell/OCaml it's `()` of type `unit`, in many languages `void` plays a similar role. "I return nothing useful, but I did finish."
- The **Void type** (also called *never*, *bottom*, *Nothing*) — a type with **zero values**. You can never construct one. It marks "this code path never produces a value" — a function that always loops forever or always throws.

In one sentence: **product = AND = struct, sum = OR = tagged union, Unit = exactly one value, Void = no values at all.** Together these are called **algebraic data types** (ADTs), and this page teaches you to see all your data through this lens.

> 🎓 **Why this matters for a junior:** The single most common beginner data-modeling mistake is using a product type (a struct with optional fields and flags) where you needed a sum type. The result is a struct that can represent **illegal states** — combinations that should never exist — and then you sprinkle `if` checks everywhere to defend against them. Sum types let you make those illegal states *impossible to even write down*. That is a superpower, and it's learnable in an afternoon.

---

## Prerequisites

What you should know before reading this:

- **Required:** What a `struct` / record / object with fields is, in at least one language.
- **Required:** What an `enum` is in the simplest sense (a fixed list of named choices like `RED`, `GREEN`, `BLUE`).
- **Required:** Basic `if`/`switch` and how function return types work.
- **Helpful but not required:** Having been bitten by a `null` / `nil` / `None` once. (You'll appreciate the fix more.)
- **Helpful but not required:** A vague memory of `true`/`false` being a type with exactly two values.

You do **not** need:

- Any category theory. We'll use the word "algebra" but only grade-school multiplication and addition.
- The function-types-as-exponentials material (that's `middle.md` and `senior.md`).
- Knowledge of any specific advanced language. Examples span several, but the idea is universal.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Type** | A set of possible values. `bool` is the set `{true, false}`. `u8` is `{0, 1, …, 255}`. |
| **Inhabitant** | A value of a type. `true` is an inhabitant of `bool`. The number of inhabitants is the "size" of the type. |
| **Product type** | A type whose value holds several fields **at once** (A **and** B). Structs, tuples, records. |
| **Sum type** | A type whose value is **one of several** alternatives (A **or** B). Tagged unions, variants, "enums with data." |
| **Tag (discriminant)** | The hidden marker inside a sum value that records *which* alternative it currently is. |
| **Variant / case** | One of the alternatives of a sum type. `Circle` is a variant of `Shape`. |
| **Unit type** | A type with **exactly one** value. `()` in Rust, `unit` in OCaml/Haskell. Means "no meaningful information." |
| **Void / Never / Bottom** | A type with **zero** values. Cannot be constructed. Marks unreachable code. (Note: C's `void` is *not* this; see pitfalls.) |
| **ADT (Algebraic Data Type)** | A type built from sums and products. The "algebraic" refers to multiplying and adding the sizes. |
| **Pattern matching** | A control structure that inspects a sum value, figures out which variant it is, and pulls out the data inside. |
| **Exhaustiveness** | The compiler checking that your pattern match handles **every** variant — no case forgotten. |
| **`Option` / `Maybe`** | The canonical sum type: a value is either `Some(x)` (present) or `None` (absent). Replaces `null`. |
| **`Result` / `Either`** | The canonical error sum type: either `Ok(value)` or `Err(error)`. Replaces exceptions/error codes. |
| **Illegal state** | A combination of field values that *should* be impossible but that the type still allows you to construct. |

---

## Core Concepts

### 1. A type is a set of values — count them

The trick that makes everything else obvious: **think of a type as a set, and count how many values it has.**

- `bool` has **2** values: `true`, `false`.
- A `u8` (unsigned 8-bit integer) has **256** values.
- An enum `enum Color { Red, Green, Blue }` has **3** values.

This count is the type's number of *inhabitants*. We'll use it constantly.

### 2. Product types: AND, and you multiply

A **product type** bundles fields together. A value holds **all** of them at once.

```rust
struct Point { x: bool, y: bool }   // a value has BOTH x AND y
```

How many `Point`s are there? For each of the 2 choices of `x`, there are 2 choices of `y`:

```
(false, false), (false, true), (true, false), (true, true)   →   4 = 2 × 2
```

The number of inhabitants is the **product** of the components' counts. That's literally why it's called a *product* type:

```
|A × B| = |A| × |B|
```

Tuples `(A, B)`, structs, records, and field-bearing classes are all product types. "Has-an `x` and a `y`" → multiply.

### 3. Sum types: OR, and you add

A **sum type** says a value is **one of** several alternatives.

```rust
enum Either { L(bool), R(bool) }   // a value is EITHER an L OR an R
```

How many `Either`s are there? An `L` carries a `bool` (2 options) and an `R` carries a `bool` (2 options). A value is one or the other:

```
L(false), L(true), R(false), R(true)   →   4 = 2 + 2
```

The number of inhabitants is the **sum** of the variants' counts. That's why it's called a *sum* type:

```
|A + B| = |A| + |B|
```

Rust `enum`, Haskell `data`, Swift `enum`, OCaml/F# variants, TypeScript discriminated unions, and Java sealed interfaces are all sum types. "Is an `A` *or* a `B`" → add.

### 4. The tag: how a sum knows what it is

A product is easy to lay out in memory: just put the fields next to each other. A sum is trickier: at any moment the value is *only one* of its variants, so it needs a hidden **tag** (also called a *discriminant*) that says "right now I am a `Circle`," plus enough room for the largest variant's payload.

```
Sum value layout (conceptually):
┌──────┬─────────────────────────────┐
│ tag  │ payload (sized for biggest) │
└──────┴─────────────────────────────┘
   ▲        ▲
   │        └─ the data for whichever variant the tag says
   └─ which variant is this? (0 = Circle, 1 = Rectangle, …)
```

This tag is what makes ADTs **safe**. Old C `union`s have the payload but **no tag** — nothing records which member is active, so you can read it as the wrong type and corrupt everything. ADTs are "tagged unions"; C unions are "untagged." The tag is the whole difference between safe and unsafe.

### 5. Pattern matching: open the box safely

To use a sum value you **pattern match**: you ask "which variant are you?" and, in the same breath, pull out the payload.

```rust
match shape {
    Shape::Circle(r)         => 3.14159 * r * r,
    Shape::Rectangle(w, h)   => w * h,
}
```

Each arm handles one variant and binds its data (`r`, or `w` and `h`). You cannot accidentally read a `Circle`'s radius when the value is actually a `Rectangle` — the match makes that impossible.

### 6. Exhaustiveness: the compiler has your back

Here is the feature that changes how you write programs. A good compiler checks that your match handles **every** variant. If you add a fourth `Shape::Triangle` variant later and forget to handle it somewhere, the compiler **refuses to compile** and points at every match that's now incomplete.

```
error: non-exhaustive patterns: `Triangle { .. }` not covered
```

Think about what just happened: you changed a data definition, and the compiler handed you a to-do list of every place in the entire codebase that needs updating. That's not an annoyance — that's the most valuable refactoring tool you'll ever use. In a language without sum types, that same change would slip through and crash at runtime, on a Friday, in production.

### 7. The Unit type: exactly one value

The **Unit type** has exactly **one** inhabitant. In Rust it's written `()` (and its single value is also written `()`). In Haskell and OCaml it's `()` of type `unit`.

```
|Unit| = 1
```

Why would you want a type with only one value? Because "one value" means "no information to carry." When a function does something for its *effect* (print, save) and has nothing meaningful to return, it returns Unit: "I'm done; here's the one and only value I could possibly give you." It is the **identity of product**: `A × Unit` has the same number of values as `A`, because multiplying by 1 changes nothing. Adding a Unit field to a struct adds no information.

### 8. The Void type: zero values

The **Void type** (also called *Never*, *bottom*, or *Nothing* depending on the language) has **zero** inhabitants. You can never produce one.

```
|Void| = 0
```

What use is a type you can't construct? It's a *promise*: a function returning `Never` is promising it will **never return normally** — it loops forever, or always panics, or always exits. It's the **identity of sum**: `A + Void` has the same number of values as `A`, because the `Void` branch can never actually happen (adding 0 changes nothing). This is why `Result<T, Never>` means "an error case that can never occur."

> ⚠️ **Important name clash:** C/Java/JS `void` is **not** the Void type — it's closer to Unit ("a function that returns nothing useful but does return"). The true zero-value type is Rust's `!`, Haskell's `Void`/`Data.Void`, TypeScript's `never`, Kotlin's `Nothing`. Don't let the spelling fool you.

### 9. Why this is called an *algebra*

Put the four facts together:

```
|A × B|  = |A| × |B|     (product → multiply)
|A + B|  = |A| + |B|     (sum     → add)
|Unit|   = 1             (identity of ×)
|Void|   = 0             (identity of +)
```

These obey the same rules as ordinary arithmetic. `A × Unit` ≅ `A` (multiply by 1). `A + Void` ≅ `A` (add 0). `A × Void` has 0 values (multiply by 0 — a struct with an uninhabitable field can never be built). This is why they're called **algebraic** data types: the *counts* of your types literally do arithmetic. You don't need this to use ADTs, but it's a beautiful sanity-check, and `middle.md` shows it explains `Option`, generics, and even function types.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Product type** | A meal combo: you get a drink **AND** a side **AND** a main. Total combos = drinks × sides × mains. |
| **Sum type** | A "choose your protein": chicken **OR** beef **OR** tofu. You pick exactly one. |
| **Tag (discriminant)** | The label on a takeout box that says what's inside, so you don't open beef expecting tofu. |
| **Pattern matching** | A sorting machine that routes each labeled box to the correct handler. |
| **Exhaustiveness** | A checklist at the end of a shift: every item must be ticked, or you can't clock out. |
| **Unit type** | A receipt that says "transaction complete." It carries no other info — there's only one possible receipt. |
| **Void type** | A door labeled "this leads nowhere." Nobody ever walks through; if they claim to, they're lying. |
| **C union (untagged)** | An unlabeled box: maybe it's chicken, maybe tofu, you guess and hope. |
| **Illegal state** | A form where "married" is checked but the "spouse name" is blank — a combination the form *shouldn't* allow but does. |

---

## Mental Models

### The "Count the Values" Model

Whenever you meet a type, ask: *how many distinct values does it have?* A struct → multiply the fields. An enum-with-data → add the variants. This single habit tells you instantly whether two types are "the same shape," whether a refactor preserved information, and whether a type can represent states it shouldn't.

### The "AND vs OR" Model

Every time you bundle data, ask one question: **"Do I have all of these at once (AND), or exactly one of these (OR)?"**
- AND → product → struct/record/tuple.
- OR → sum → enum/variant/discriminated union.

Beginners reach for AND by reflex (a struct with everything in it) even when the answer is OR. Train yourself to hear the word "or" in a spec — "a payment is *either* card *or* cash *or* voucher" — and reach for a sum type.

### The "Make Illegal States Unrepresentable" Model

Don't model a connection as `struct { is_connected: bool, socket: Socket?, retry_count: int }`. That struct lets you build nonsense: `is_connected = true` but `socket = null`. Instead, model it as a sum:

```
Disconnected
Connecting { attempt: int }
Connected { socket: Socket }
```

Now a `Connected` value *always* has a socket, and a `Disconnected` value *can't* have one. The illegal combinations don't just get rejected at runtime — they can't be written down at all. The type *is* the validation.

---

## Code Examples

We model the same thing — a **shape** (sum) and a **point** (product) — across several languages, then show `Option` replacing `null`.

### Rust — sum (`enum`), product (`struct`), and a match

```rust
// PRODUCT: a Point has an x AND a y.
struct Point { x: f64, y: f64 }

// SUM: a Shape is a Circle OR a Rectangle OR a Triangle.
enum Shape {
    Circle { radius: f64 },
    Rectangle { width: f64, height: f64 },
    Triangle { base: f64, height: f64 },
}

fn area(s: &Shape) -> f64 {
    match s {
        Shape::Circle { radius }            => std::f64::consts::PI * radius * radius,
        Shape::Rectangle { width, height }  => width * height,
        Shape::Triangle { base, height }    => 0.5 * base * height,
        // Delete one arm and this WON'T COMPILE: non-exhaustive patterns.
    }
}

fn main() {
    let s = Shape::Circle { radius: 2.0 };
    println!("area = {}", area(&s));
}
```

### Swift — same idea, `enum` with associated values

```swift
struct Point { let x: Double; let y: Double }   // product

enum Shape {                                     // sum
    case circle(radius: Double)
    case rectangle(width: Double, height: Double)
    case triangle(base: Double, height: Double)
}

func area(_ s: Shape) -> Double {
    switch s {                                   // exhaustive switch
    case .circle(let r):            return .pi * r * r
    case .rectangle(let w, let h):  return w * h
    case .triangle(let b, let h):   return 0.5 * b * h
    }
}
```

### Haskell — `data` declares both at once

```haskell
data Point = Point Double Double          -- product: two fields side by side

data Shape                                -- sum: three alternatives, separated by |
  = Circle    Double
  | Rectangle Double Double
  | Triangle  Double Double

area :: Shape -> Double
area (Circle r)      = pi * r * r
area (Rectangle w h) = w * h
area (Triangle b h)  = 0.5 * b * h
-- drop a line and GHC warns: Pattern match(es) are non-exhaustive
```

### TypeScript — discriminated union (the tag is a literal field)

```typescript
type Point = { x: number; y: number };              // product (object type)

type Shape =                                          // sum: union with a "kind" tag
  | { kind: "circle"; radius: number }
  | { kind: "rectangle"; width: number; height: number }
  | { kind: "triangle"; base: number; height: number };

function area(s: Shape): number {
  switch (s.kind) {                                   // narrows on the tag
    case "circle":    return Math.PI * s.radius ** 2;
    case "rectangle": return s.width * s.height;
    case "triangle":  return 0.5 * s.base * s.height;
  }
}
```

The string field `kind` *is* the tag. TypeScript narrows the type inside each `case`, so `s.radius` is only accessible in the `"circle"` branch.

### Go — there is no native sum; you fake it with an interface + type switch

```go
type Shape interface{ isShape() }

type Circle struct{ Radius float64 }
type Rectangle struct{ Width, Height float64 }

func (Circle) isShape()    {}
func (Rectangle) isShape() {}

func Area(s Shape) float64 {
    switch v := s.(type) {           // type switch stands in for pattern matching
    case Circle:
        return math.Pi * v.Radius * v.Radius
    case Rectangle:
        return v.Width * v.Height
    default:
        panic("unknown shape")       // no compile-time exhaustiveness — runtime only
    }
}
```

Go has product types (structs) but no built-in sum types. The interface trick works, but note the painful difference: there is **no exhaustiveness check**. Add a new shape, forget a case, and you find out at runtime via the `panic`, not at compile time.

### `Option` / `Maybe` — the canonical sum, replacing `null`

```rust
// Rust: Option<T> is literally `enum Option<T> { None, Some(T) }`
fn find_user(id: u32) -> Option<String> {
    if id == 1 { Some("alice".to_string()) } else { None }
}

fn main() {
    match find_user(7) {
        Some(name) => println!("found {name}"),
        None       => println!("no such user"),  // you CANNOT forget this branch
    }
}
```

In a language with `null`, `find_user` would return a `String` that might secretly be null, and nothing forces you to check — until it crashes. With `Option`, the *type* says "this might be absent," and the compiler makes you handle the absent case. That's the same bug, made impossible.

> **Counting check:** `Option<bool>` has `1 + 2 = 3` values: `None`, `Some(false)`, `Some(true)`. It's `1 + A` where the `1` is `None` (a Unit-like variant) and `A` is the wrapped type. The algebra predicts the count exactly.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Correctness** | Illegal states become unrepresentable; whole bug classes vanish. | Requires up-front thought about which states are legal. |
| **Refactoring** | Add a variant → compiler lists every place to update (exhaustiveness). | Add a variant → you *must* touch every match (sometimes many files). |
| **Null safety** | `Option`/`Maybe` make "absent" explicit and checked. | More verbose than just using `null` — until the first null crash. |
| **Readability** | Data definitions read like the domain ("a Shape is a Circle or a Rectangle"). | Pattern matches can get long for large sums. |
| **Performance** | Compact memory layout (tag + largest payload); no heap needed in many languages. | Every variant uses space for the largest variant in some layouts (size = biggest case). |
| **Tooling/portability** | First-class in Rust/Swift/Haskell/OCaml/F#/Kotlin/TS/modern Java. | Faked awkwardly in Go and pre-sealed Java; no exhaustiveness there. |

---

## Use Cases

Reach for **sum types** when:

- A value is "one of N kinds": shapes, AST nodes, JSON values, UI events, message types.
- You're modeling **states** of something (a connection, an order, a request lifecycle).
- A function can **succeed or fail** — use `Result`/`Either` instead of exceptions or sentinel values.
- A value might be **absent** — use `Option`/`Maybe` instead of `null`.

Reach for **product types** when:

- A thing genuinely *has* several parts at once: coordinates, a configuration, a database row.
- You're grouping related fields that always travel together.

Reach for **Unit** when a function has nothing meaningful to return but does complete. Reach for **Void/Never** to mark "this never returns" (infinite loops, always-throwing functions) and to express impossible cases in generic code.

---

## Coding Patterns

### Pattern 1: Replace flags-and-nullables with a sum

Before (a product that allows illegal states):

```rust
struct Connection {
    connected: bool,
    socket: Option<Socket>,   // null when disconnected... but nothing enforces that
    retry_count: u32,
}
```

After (a sum where every state carries exactly what it needs):

```rust
enum Connection {
    Disconnected,
    Connecting { attempts: u32 },
    Connected  { socket: Socket },
}
```

Now `Connected` *always* has a socket; `Disconnected` *can't* have one.

### Pattern 2: `Option` instead of `null` for "might be missing"

```rust
fn first_even(v: &[i32]) -> Option<i32> {
    v.iter().copied().find(|n| n % 2 == 0)
}
```

The caller *must* handle `None`. There is no null to forget to check.

### Pattern 3: `Result` instead of exceptions for "might fail"

```rust
fn parse_port(s: &str) -> Result<u16, String> {
    s.parse::<u16>().map_err(|_| format!("not a port: {s}"))
}
```

Success and failure are both in the return type, both visible, both handled.

### Pattern 4: Make the tag explicit in languages without native sums

In TypeScript and Go, keep a `kind`/type-marker field and always switch on it. Treat the type switch as your pattern match, and add a `default` that loudly fails so a forgotten case is at least *noisy*.

---

## Best Practices

- **Prefer a sum to a struct-with-flags whenever the word "or" shows up in the spec.** "A user is *either* a guest *or* a member" → sum, not booleans.
- **Make every variant carry exactly the data that variant needs — no more, no less.** That's how you kill illegal states.
- **Always pattern match exhaustively.** In languages that check it, lean on the compiler. In ones that don't, add a failing default and a test.
- **Avoid catch-all wildcards (`_ =>`) in matches over your own sums** when you can. A wildcard silences the exhaustiveness check, so adding a variant won't flag this match. Spell out the cases.
- **Use the standard `Option`/`Result` (or `Maybe`/`Either`) instead of inventing your own** "maybe missing" or "maybe failed" types.
- **Name variants for the domain, not for the data.** `Disconnected`, not `StateZero`.
- **Return Unit (`()` / `void`) honestly** when a function is called for its effect; don't return a meaningless `bool` or `0`.

---

## Edge Cases & Pitfalls

- **`void` is not Void.** C/Java/JS `void` means "returns nothing useful" (Unit-like). The true zero-value type is Rust `!`, TS `never`, Kotlin `Nothing`, Haskell `Void`. Mixing them up confuses a lot of conversations.
- **Untagged C unions are a foot-gun.** `union { int i; float f; }` has no tag. Read the wrong member and you reinterpret raw bytes. ADTs add the tag; C unions don't. Never treat a C union like a safe sum type.
- **The wildcard arm defeats exhaustiveness.** `match s { Circle(_) => …, _ => … }` compiles forever, even after you add ten new variants, silently routing them to the catch-all. Use it sparingly.
- **A struct with a nullable field is a *weak* sum.** `socket: Option<Socket>` plus `connected: bool` technically encodes states, but it also encodes the *illegal* ones. Promote to a real sum.
- **Order/position can be a tag by accident.** A tuple `(bool, bool)` has no field names; it's easy to swap. Prefer named fields for products with same-typed components.
- **Empty sum vs empty product.** A sum with zero variants is Void (0 values, can't construct). A product with zero fields is Unit (1 value — the empty tuple). Beginners mix these up; remember: no-choice OR = impossible, no-fields AND = trivially one value.
- **Recursive sums need indirection in some languages.** A linked list `Cons(head, tail)` or a tree references *itself*. Languages like Rust require a `Box`/pointer so the size is finite. The idea is the same; the mechanics differ.

---

## Test Yourself

1. How many values does `(bool, Color)` have, if `Color` has 3 values? Show the multiplication.
2. How many values does `enum E { A(bool), B }` have? Show the addition. (Hint: `B` carries no data.)
3. Classify each as sum or product: a 2D point; an HTTP response that's `200 OK` or `404 Not Found`; a tuple `(String, u32)`; a JSON value (`null`/`bool`/`number`/`string`/`array`/`object`).
4. Write the connection example as a struct-with-flags, then list one illegal state it allows, then rewrite it as a sum so that state is unrepresentable.
5. `Option<Option<bool>>` — how many values does it have? Name them all. (Use `1 + (1 + 2)`.)
6. Why does C's `void` behave more like Unit than like Void? What's the type that actually behaves like Void in your favorite language?
7. In the Go example, add a `Triangle`. Nothing forces you to update `Area`. What goes wrong, and when do you find out? Contrast with the Rust or Swift versions.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                 SUM, PRODUCT, UNIT, VOID                         │
├──────────────────────────────────────────────────────────────────┤
│ PRODUCT  =  AND   struct {a; b}    |A × B| = |A| × |B|           │
│ SUM      =  OR    enum  A | B      |A + B| = |A| + |B|           │
│ UNIT     =  ()    one value        |Unit|  = 1   (identity of ×) │
│ VOID     =  !     zero values      |Void|  = 0   (identity of +) │
├──────────────────────────────────────────────────────────────────┤
│ Reflex test when bundling data:                                  │
│   "all of these at once?"  → AND → product (struct/tuple)        │
│   "exactly one of these?"  → OR  → sum (enum/variant)            │
├──────────────────────────────────────────────────────────────────┤
│ The killer feature: EXHAUSTIVENESS                               │
│   add a variant → compiler lists every match to fix              │
├──────────────────────────────────────────────────────────────────┤
│ Canonical sums (learn these):                                    │
│   Option<T> / Maybe   =  None  | Some(T)     =  1 + A   (no null) │
│   Result<T,E> / Either =  Ok(T) | Err(E)     =  T + E   (no excn) │
├──────────────────────────────────────────────────────────────────┤
│ Native sums:  Rust, Swift, Haskell, OCaml, F#, Kotlin, TS,       │
│               modern Java (sealed + record)                      │
│ Faked sums:   Go (interface + type switch — NO exhaustiveness)   │
│               old Java (class hierarchy / visitor)               │
├──────────────────────────────────────────────────────────────────┤
│ Watch out:                                                        │
│   * void (C/Java/JS) is UNIT-like, NOT the zero-value Void       │
│   * C union = UNTAGGED = unsafe; ADT = TAGGED = safe             │
│   * wildcard `_ =>` silences exhaustiveness — use sparingly      │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- There are exactly two fundamental ways to combine types: **product (AND** — a struct holding several fields at once) and **sum (OR** — a tagged union that is exactly one of several variants).
- Treat a type as a **set of values** and count: products **multiply** the counts (`|A × B| = |A| × |B|`), sums **add** them (`|A + B| = |A| + |B|`). That arithmetic is why they're called **algebraic data types**.
- **Unit** is the one-value type (identity of product, `|Unit| = 1`); **Void/Never** is the zero-value type (identity of sum, `|Void| = 0`). Beware: C/Java/JS `void` is Unit-like, not the real Void.
- A sum carries a hidden **tag** that records which variant it currently is. That tag is the difference between a safe ADT and an unsafe C union.
- **Pattern matching** reads a sum safely, and **exhaustiveness checking** makes the compiler prove you handled every case — so adding a variant turns into a compiler-guided to-do list instead of a runtime crash.
- The headline technique is **"make illegal states unrepresentable":** replace structs-with-flags-and-nullables with sum types so impossible combinations can't be written.
- `Option`/`Maybe` (= `1 + A`) replaces `null`; `Result`/`Either` (= `T + E`) replaces exceptions. Both are just sum types.
- Native in Rust, Swift, Haskell, OCaml, F#, Kotlin, TypeScript, and modern Java; awkwardly faked (with no exhaustiveness) in Go and old Java.

---

## What You Can Build

- **A tiny shape library.** Define a `Shape` sum (circle/rectangle/triangle), write `area` and `perimeter` with exhaustive matches, then add a `Square` and let the compiler walk you through every site that needs updating.
- **A safe-divide / safe-parse module.** Functions returning `Option` or `Result` instead of throwing or returning sentinels. Force the caller to handle the missing/failed case.
- **A traffic-light state machine.** Model `Red | Yellow | Green` as a sum, write a `next()` transition, and prove with the compiler that you handled every state.
- **A JSON value type.** A recursive sum: `Null | Bool(b) | Number(n) | String(s) | Array(list) | Object(map)`. Write a pretty-printer by pattern matching.
- **A "before/after" refactor demo.** Take a struct-with-flags (say, a `Form` with `isSubmitted: bool`, `error: String?`) and rewrite it as a sum (`Editing | Submitting | Failed(error) | Done`). Count the illegal states you eliminated.

---

## Further Reading

- *Programming in Haskell* — Graham Hutton. The cleanest first introduction to algebraic data types and pattern matching.
- *The Rust Programming Language* ("the Book"), chapters on Enums and Pattern Matching, and on `Option`. https://doc.rust-lang.org/book/ch06-00-enums.html
- *Domain Modeling Made Functional* — Scott Wlaschin. The definitive practical treatment of "make illegal states unrepresentable" using sum types (in F#, but universally applicable).
- "Null References: The Billion Dollar Mistake" — Tony Hoare's talk on why `null` was a mistake and how option types fix it.
- *Real World OCaml* — Minsky, Madhavapeddy, Hickey. Variants and records with an engineering slant.
- The Swift Language Guide, "Enumerations" chapter — associated values and exhaustive switches.
- *Thinking with Types* — Sandy Maguire. Goes deep (later) on the algebra of types; the early chapters are very approachable.

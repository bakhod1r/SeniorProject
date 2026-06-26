# Sum, Product & Unit Types — Middle Level

> **Topic:** [Sum, Product & Unit Types](README.md)
> **Focus:** The full algebra of types — including function types as exponentials — plus how compilers lay out sums and products in memory, and how exhaustiveness checking actually works.

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

> Focus: **The algebra is real, and it's predictive.** Once you can multiply, add, and exponentiate types, you can reason about isomorphisms, derive `Option`/`Either`/function types from first principles, and predict memory layout.

At the junior level you learned the four facts: product multiplies, sum adds, Unit is 1, Void is 0. This level takes that algebra seriously and shows it's not a cute mnemonic — it's a genuine isomorphism between *finite types* and *natural numbers under arithmetic*. Two types with the same number of inhabitants are "the same shape": there's a lossless, reversible conversion between them. That insight lets you reason about refactors with arithmetic, recognize when two designs are secretly equivalent, and understand why the standard library's types are shaped the way they are.

We add the third operation that completes the algebra: **function types are exponentials**. `A -> B` has `|B|^|A|` inhabitants. Once you have `×`, `+`, and `^`, the type system obeys the laws of a *commutative semiring* — distributivity, currying-as-the-exponent-law, and the rest. This is "high-school algebra, but the variables are types."

Then we descend from theory to the machine. A sum needs a **discriminant tag**; a product is just fields laid side by side. We'll look at how real compilers represent these: tagged layouts, niche/null-pointer optimization (where `Option<&T>` costs zero extra bytes), and why a sum's size is "tag plus the largest variant." Finally, we'll dig into **exhaustiveness and reachability checking** — the algorithm the compiler runs to prove your match handles every case and has no dead arms.

> 🎓 **Why this matters at the middle level:** You're now designing data structures other people depend on. Knowing the algebra lets you justify a design ("these two encodings are isomorphic, so prefer the clearer one"), knowing the layout lets you reason about size and performance, and knowing how exhaustiveness works lets you *use* the compiler as a refactoring engine instead of fighting it.

---

## Prerequisites

- **Required:** The junior page — product/sum/Unit/Void and basic counting.
- **Required:** Comfort writing and pattern-matching sum types in at least one language (Rust, Swift, Haskell, OCaml, F#, TypeScript, or Kotlin).
- **Required:** Basic generics/parametric types (`Vec<T>`, `Option<T>`, `List a`).
- **Helpful:** A loose memory of high-school exponent and distributive laws (`x^(a+b) = x^a · x^b`, `a(b+c) = ab + ac`).
- **Helpful:** Any exposure to how a struct is laid out in memory (offsets, padding).

You do **not** need category theory, initial-algebra semantics, or dependent types — those are `senior.md` and `professional.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Isomorphism** | A lossless, reversible pair of conversions between two types. Iso types have the same inhabitant count. |
| **Cardinality** | The number of inhabitants of a type. `|bool| = 2`. The thing the algebra computes. |
| **Exponential type** | A function type `A -> B`. Its cardinality is `|B|^|A|`. |
| **Semiring** | An algebraic structure with `+`, `×`, a 0, and a 1, obeying distributivity. Types form one. |
| **Currying** | Turning `(A, B) -> C` into `A -> (B -> C)`. The type-algebra image of `c^(a·b) = (c^b)^a`. |
| **Discriminant / tag** | The integer stored in a sum value recording the active variant. |
| **Niche optimization** | Storing the tag *inside* unused bit patterns of a payload, so the sum needs no extra space (e.g. `Option<&T>` using the null pointer as `None`). |
| **Payload** | The data carried by a chosen sum variant. |
| **Exhaustiveness checking** | Compiler analysis proving a match covers every possible value. |
| **Reachability / redundancy** | Compiler analysis proving no match arm is dead (shadowed by earlier arms). |
| **Smart constructor** | A function that validates inputs and returns `Option`/`Result`, used to guarantee an invariant a raw constructor couldn't. |
| **Newtype** | A single-field product wrapping one type to give it a distinct identity (`UserId(u64)`), `×`-iso to the inner type but not interchangeable. |
| **Sum of products (SOP)** | The canonical shape of an ADT: a sum whose variants are each products. Every ADT normalizes to this. |

---

## Core Concepts

### 1. Isomorphism: "same number of values" = "same type, relabeled"

Two finite types are **isomorphic** (`≅`) when there's a reversible conversion between them. The litmus test: they have the same cardinality. `(bool, bool)` and `u8`-restricted-to-`{0,1,2,3}` both have 4 values, so they're isomorphic — you can map `(false,false)↔0`, `(false,true)↔1`, and so on, losslessly.

Why care? Because **isomorphic types carry the same information**, so a refactor between them loses nothing. When you replace a `(bool, bool)` with a 4-variant enum, the algebra (`2 × 2 = 4 = 1+1+1+1`) certifies the swap is information-preserving. The algebra is your refactor receipt.

### 2. The semiring laws actually hold for types

Types under `+` (sum), `×` (product), `0` (Void), `1` (Unit) form a **commutative semiring**. Concretely, these isomorphisms hold:

```
A × 1   ≅  A                 (Unit is the product identity)
A + 0   ≅  A                 (Void is the sum identity)
A × 0   ≅  0                 (a struct with an uninhabitable field can't be built)
A × B   ≅  B × A             (tuple order doesn't change the information)
A + B   ≅  B + A             (variant order doesn't change the information)
A × (B + C)  ≅  A×B + A×C    (DISTRIBUTIVITY — the big one)
```

Distributivity is the most useful in practice. `A × (B + C) ≅ A×B + A×C` says: *"a struct containing one field plus a two-variant choice" is the same as "a two-variant choice where each variant carries the struct field."* That's a real refactoring you do by hand all the time; the algebra says both encodings hold identical information, so pick the clearer one.

### 3. Option and Either, derived

The standard types fall straight out of the algebra:

```
Option<A> = Maybe a   ≅  1 + A     (None is the "1"; Some a is the "A")
Result<T,E> = Either E A ≅ E + A    (a tagged choice of error or value)
bool ≅ 1 + 1                         (true and false: two zero-payload variants)
```

So `Option<bool> = 1 + 2 = 3` (None, Some false, Some true). `Option<Option<A>> = 1 + (1 + A) = 2 + A`. The nested option has *two* distinct "empty-ish" values (`None` and `Some(None)`), which is exactly the famous footgun of nesting options — the algebra predicts it: `2 + A`, not `1 + A`. (`Option::flatten` is the function that collapses `2 + A` back to `1 + A`, deliberately merging the two empties.)

### 4. Function types are exponentials

Here's the operation that completes the algebra. A function `A -> B` must, for *each* of the `|A|` inputs, choose one of `|B|` outputs. The number of such functions is:

```
|A -> B|  =  |B| ^ |A|
```

Check it: `bool -> bool` has `2^2 = 4` inhabitants — the four functions `id`, `not`, `const true`, `const false`. A function `Color -> bool` (3 inputs, 2 outputs) has `2^3 = 8`. This is why function types are called **exponentials**.

The exponent laws map onto programming idioms:

```
c ^ (a + b)  =  c^a · c^b      ⟷    (A + B) -> C   ≅   (A -> C) × (B -> C)
```
"A function from a sum is a pair of functions, one per variant" — which is *exactly* what pattern matching is: a match over `A + B` is a function for the `A` case and a function for the `B` case, bundled.

```
(c ^ b) ^ a  =  c ^ (b · a)    ⟷    A -> (B -> C)  ≅   (A × B) -> C
```
That's **currying**: a two-argument function is a function returning a function. The exponent law *is* currying.

```
a ^ 1 = a    ⟷  Unit -> A  ≅  A         (a function from Unit is just a value)
a ^ 0 = 1    ⟷  Void -> A  ≅  Unit      (exactly one function from Void: the empty/absurd one)
1 ^ a = 1    ⟷  A -> Unit  ≅  Unit      (only one function into Unit: const ())
0 ^ a = 0    (for a>0) ⟷ A -> Void ≅ Void  (no total function into an empty type, if A is inhabited)
```

`Void -> A ≅ Unit` is the type-theory meaning of `absurd`/`unreachable`: given a value of an uninhabitable type, you can produce *anything*, because you'll never actually be called.

### 5. Memory layout of products: fields side by side (plus padding)

A product is the easy case. The compiler places the fields in memory, adding **padding** to satisfy alignment:

```
struct S { a: u8, b: u32, c: u8 }     // naive layout
┌────┬─────────┬─────────────────┬────┬─────────┐
│ a  │ pad ×3  │       b         │ c  │ pad ×3  │   = 12 bytes
└────┴─────────┴─────────────────┴────┴─────────┘
```

Many compilers (Rust by default) **reorder** fields to minimize padding — layout is not guaranteed unless you opt into `#[repr(C)]`. The *cardinality* is unaffected by layout: `|S| = 256 × 2^32 × 256` regardless of byte arrangement.

### 6. Memory layout of sums: tag + largest payload

A sum stores a **discriminant** plus space sized for the **largest** variant (because at runtime it could be any of them):

```
enum E { A(u8), B(u32, u32), C }
┌─────┬─────────────────────────────┐
│ tag │   payload (max over variants)│   tag picks A / B / C
└─────┴─────────────────────────────┘
        A uses 1 byte, B uses 8, C uses 0  →  payload sized to 8
```

So `size_of(sum) ≈ size_of(tag) + max(size_of(variant_i))`, rounded for alignment. This is why a sum with one huge variant and many tiny ones is "expensive even when it's a tiny variant" — every value reserves room for the biggest. (Fix: box the big variant so the sum stores a pointer.)

### 7. Niche / null-pointer optimization: free sums

Sometimes the tag costs **zero** extra bytes. If a payload type has unused bit patterns (a "niche"), the compiler stuffs the tag there. The classic case: a reference/pointer is never null, so `Option<&T>` uses the all-zero pointer to mean `None` and any other pointer to mean `Some`. Result: `Option<&T>` is the same size as `&T` — the safety is free.

```
Option<&T>:   0x0000…0000  → None
              any other    → Some(ptr)
size_of::<Option<&T>>() == size_of::<&T>()   // 8 bytes, no extra tag
```

Rust generalizes this: `Option<NonZeroU32>`, `Option<Box<T>>`, `Result<T, Void-like>`, and enums whose variants don't use every bit pattern all get niche-packed. The algebra (`1 + A`) is unchanged; the *representation* is just clever.

### 8. How exhaustiveness checking works (the algorithm, roughly)

Exhaustiveness is decided by an algorithm (the classic one is due to Maranget) that treats the set of patterns as a matrix and asks: *is there any value not matched by any row?* It works by:

1. Start with the full "value space" of the matched type (its set of possible shapes).
2. For each pattern arm, **subtract** the values it covers.
3. If anything remains, report it as a missing case (the compiler even *constructs a witness* — "`Triangle { .. }` not covered").
4. **Redundancy/reachability**: if an arm covers nothing new (everything it'd match was already covered above), it's dead code; warn.

This is why the compiler can say *exactly which* variant you forgot, and why moving a wildcard `_` to the top makes every arm below it "unreachable." The check is decidable and runs on the *structure* of the sum, which is precisely why native sums enable it and "faked" sums (Go interfaces) can't — the compiler doesn't know the closed set of implementors.

### 9. Closed vs open sums; the expression problem (preview)

Native sum types are **closed**: the set of variants is fixed at the definition site. That's what makes exhaustiveness possible — the compiler knows the complete list. The trade-off is the **expression problem**: with a closed sum, adding a new *operation* (a new function over the sum) is easy and exhaustiveness-checked, but adding a new *variant* forces edits to every existing function. Object-oriented interfaces make the opposite trade (new types easy, new operations hard). `senior.md` treats this in full; for now, internalize: **sum types optimize for "few fixed cases, many operations."**

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Isomorphism** | Two spreadsheets with the same data in different column orders — relabel and they're identical. |
| **Distributivity** | "Pick a size (S/M/L) of either coffee or tea" = "pick from {S,M,L coffee} or {S,M,L tea}." Same menu, regrouped. |
| **Function as exponential** | A lookup table: for each of the N keys you fill in one of M values; there are M^N possible tables. |
| **Currying** | A vending machine with two dials: turning the first dial gives you a machine with one dial left. |
| **Discriminant tag** | The colored sticker on a luggage carousel telling the handler which conveyor it goes to. |
| **Niche optimization** | Using the already-blank back of a form as the "no data" marker instead of stapling on an extra page. |
| **Sum size = biggest variant** | A shipping box sized for your largest item, even when you're only mailing a pencil. |
| **Exhaustiveness algorithm** | A bingo card: cross off covered squares; if any square is left uncovered, you're not done. |

---

## Mental Models

### The "Arithmetic Receipt" Model

Before and after any data refactor, compute both cardinalities. If they match, the refactor is information-preserving (an isomorphism) — you've reshaped, not changed, the data. If the *after* is smaller, you've removed states (often good — you killed illegal ones). If it's larger, you've added states (often a smell — where did the extra possibilities come from?).

### The "Pattern Match = Function-out-of-a-Sum" Model

Stop seeing `match` as control flow and start seeing it as *constructing the unique function out of a sum*. The exponent law `(A+B)->C ≅ (A->C) × (B->C)` says such a function *is* one handler per variant. Exhaustiveness checking is the compiler verifying you actually supplied the full pair — that your function is **total**, defined on every input.

### The "Tag + Box" Model for layout

Picture every sum value as a small tag next to a box sized for the biggest variant. When that box is wastefully large (one giant variant among small ones), put a pointer in the box instead and heap-allocate the giant — the sum shrinks to tag + pointer. This single mental image explains both sum sizing and the standard "box the large variant" optimization.

---

## Code Examples

### Verifying the algebra by counting (Haskell-style reasoning, runnable in Rust)

```rust
use std::mem::size_of;

#[derive(Clone, Copy)] enum Color { Red, Green, Blue }   // 1+1+1 = 3 values

// (bool, Color): product, 2 × 3 = 6 values
// Option<bool>: 1 + 2 = 3 values  (None, Some(false), Some(true))

fn main() {
    // Niche optimization: Option<&T> is the same size as &T.
    assert_eq!(size_of::<Option<&u8>>(), size_of::<&u8>());   // 8 == 8
    // A plain Option<u8> can't niche-pack (u8 uses all 256 patterns),
    // so it needs a separate tag byte → 2 bytes, not 1.
    assert_eq!(size_of::<Option<u8>>(), 2);
    println!("algebra checks out at the byte level");
}
```

### Distributivity as a real refactor (Rust)

```rust
// BEFORE:  A × (B + C)  — a struct holding a tag plus a "kind" sum
struct Event1 {
    timestamp: u64,                 // the A (shared field)
    payload: Payload,               // the (B + C)
}
enum Payload { Click { x: i32, y: i32 }, Key { code: u32 } }

// AFTER:  A×B + A×C  — push the shared field into each variant
enum Event2 {
    Click { timestamp: u64, x: i32, y: i32 },
    Key   { timestamp: u64, code: u32 },
}
// Same information (the algebra proves it). Event1 keeps the shared field
// factored out (less repetition); Event2 makes each variant self-contained.
// Pick by ergonomics, not by capability — they're isomorphic.
```

### Currying — the exponent law in code (Haskell)

```haskell
-- (A × B) -> C   ≅   A -> (B -> C)        because  c^(a·b) = (c^b)^a
add :: (Int, Int) -> Int           -- uncurried: takes a product
add (x, y) = x + y

addC :: Int -> Int -> Int          -- curried: A -> (B -> C)
addC x y = x + y

-- curry / uncurry witness the isomorphism both ways
roundTrip :: Int -> Int -> Int
roundTrip = curry (uncurry addC)   -- == addC
```

### Function out of a sum = pattern match (TypeScript)

```typescript
type Shape =
  | { kind: "circle"; r: number }
  | { kind: "square"; s: number };

// (circle + square) -> number  ≅  (circle -> number) × (square -> number)
const area = (sh: Shape): number => {
  switch (sh.kind) {
    case "circle": return Math.PI * sh.r ** 2;   // the circle -> number half
    case "square": return sh.s ** 2;             // the square -> number half
  }
  // With "strictNullChecks" + a `never` assertion, TS proves exhaustiveness:
};

// Exhaustiveness trick in TS: the assertNever pattern
function assertNever(x: never): never { throw new Error("unreachable: " + x); }
const areaChecked = (sh: Shape): number => {
  switch (sh.kind) {
    case "circle": return Math.PI * sh.r ** 2;
    case "square": return sh.s ** 2;
    default: return assertNever(sh);   // compile error here if a variant is unhandled
  }
};
```

The `assertNever(sh)` line is how you bolt compile-time exhaustiveness onto TypeScript: in the `default`, `sh` has type `never` (Void) *only if* every variant was handled. Add a `triangle` variant and forget a case, and `sh` is now `{kind:"triangle";…}`, which isn't assignable to `never` — a type error pinpoints the gap. This is the Void/Never type doing real work.

### Boxing the large variant to shrink a sum (Rust)

```rust
struct Huge { data: [u8; 4096] }

enum Bad  { Small(u8), Big(Huge) }            // size ≈ 4096 even for Small
enum Good { Small(u8), Big(Box<Huge>) }       // size ≈ tag + pointer (~16)

// Good stores Huge on the heap behind a pointer, so every Good value is tiny.
// Same cardinality (1×256-ish + |Huge|); very different footprint.
```

### Recursive sum: a tree, and why indirection is required

```rust
enum Tree {
    Leaf(i32),
    Node(Box<Tree>, Box<Tree>),   // Box = pointer; without it the size is infinite
}
// Cardinality is infinite (trees of any depth); the algebra extends to
// "least fixed point": Tree ≅ i32 + Tree×Tree. The Box makes the SIZE finite
// even though the SET of values isn't.

fn depth(t: &Tree) -> u32 {
    match t {
        Tree::Leaf(_)       => 1,
        Tree::Node(l, r)    => 1 + depth(l).max(depth(r)),
    }
}
```

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Reasoning** | The algebra lets you certify refactors as information-preserving with arithmetic. | The arithmetic is exact only for *finite* types; recursive/infinite types need fixed-point reasoning. |
| **Layout** | Niche optimization makes many sums (notably `Option<ptr>`) cost zero extra bytes. | A sum is sized for its largest variant; one fat variant bloats every value unless boxed. |
| **Exhaustiveness** | Decidable, witness-producing checks turn missed cases into compile errors. | Only works on *closed* sums; open/extensible designs lose it. |
| **Currying/HOF** | The exponent laws make currying, partial application, and "handler-per-variant" natural. | The "function = exponential" intuition breaks for partial/effectful/non-terminating functions. |
| **Refactoring** | Distributivity gives you principled ways to regroup data. | Isomorphic-but-different ergonomics: choosing the *right* of several equivalent encodings still takes judgment. |

---

## Use Cases

- **Justifying a schema change** by showing the before/after cardinalities match (no information lost) or shrink (illegal states removed).
- **Choosing an encoding** among isomorphic options — e.g. "shared field factored out" vs "shared field per-variant" — using distributivity to confirm they're equivalent, then picking on readability.
- **Predicting and tuning memory** — knowing a sum is "tag + biggest variant," boxing the outlier, and relying on niche optimization for pointer-shaped options.
- **Bolting exhaustiveness onto weak languages** — the `assertNever`/`never` trick in TypeScript, the "unreachable variant" guard in others.
- **Designing curried APIs** — recognizing `(A,B)->C ≅ A->B->C` and exposing whichever form composes better.

---

## Coding Patterns

### Pattern 1: Smart constructor to enforce an invariant the type can't

When a raw product would permit illegal values, hide the constructor and expose a validating one returning `Option`/`Result`:

```rust
pub struct Percent(u8);                       // wants to be 0..=100
impl Percent {
    pub fn new(n: u8) -> Option<Percent> {    // smart constructor
        if n <= 100 { Some(Percent(n)) } else { None }
    }
}
```

Now every `Percent` in the program is in range, by construction — the algebra (`|Percent| = 101`) is smaller than its representation (`u8`, 256), and the smart constructor is what enforces the gap.

### Pattern 2: Newtype to give a product distinct identity

```rust
struct UserId(u64);     // ×-iso to u64, but NOT interchangeable with OrderId(u64)
struct OrderId(u64);
```

Both are `1`-field products isomorphic to `u64`, but the type system now refuses to mix them — a zero-runtime-cost win.

### Pattern 3: Box the rare-but-large variant

If a sum has one fat variant, store it behind a pointer so the common small variants stay cheap (see the `Box<Huge>` example).

### Pattern 4: Use the `never`/Void guard for exhaustiveness in weak languages

In TypeScript (and similar), end every discriminated-union switch with `default: return assertNever(x)`. It converts "forgot a case" into a compile error.

### Pattern 5: Flatten nested options deliberately

`Option<Option<A>>` is `2 + A` and almost always a mistake. Collapse it with `.flatten()` to `1 + A` unless the two empties genuinely mean different things.

---

## Best Practices

- **Compute cardinalities when refactoring data.** Matching counts ⇒ lossless; smaller ⇒ you removed states (check they were illegal ones); larger ⇒ investigate the new states.
- **Reach for niche-friendly types.** Prefer `Option<&T>`, `Option<NonZero…>`, `Option<Box<T>>` where you can — they cost nothing extra.
- **Box outlier variants** to keep sum values small; measure with `size_of`.
- **Don't nest `Option`/`Maybe`** without a reason; flatten to a single layer.
- **Avoid wildcard arms over your own closed sums** so exhaustiveness keeps protecting you across future edits.
- **In TypeScript/weak languages, always end discriminated-union switches with an `assertNever` guard.**
- **Prefer the clearest of several isomorphic encodings** — the algebra tells you they're equivalent, so optimize for the reader.

---

## Edge Cases & Pitfalls

- **Layout is not cardinality.** Reordering fields, padding, and niche packing change *size*, never the *number of values*. Don't conflate "this got smaller in memory" with "this lost states."
- **Nested options multiply empties.** `Option<Option<A>>` has two "nothing" values. JSON/serialization round-trips frequently collapse them, silently changing meaning.
- **Sum size is the largest variant, always.** A `Result<(), [u8; 1<<20]>` is a megabyte even on the `Ok(())` path. Box the big side.
- **`repr` matters for FFI.** Rust's default enum/struct layout is unspecified and may reorder. Crossing a C boundary requires `#[repr(C)]` / explicit discriminants, or the algebra-correct value has the wrong bytes.
- **Exhaustiveness over non-closed sums is impossible.** Open hierarchies (Go interfaces, subclassable types, `#[non_exhaustive]` enums across crate boundaries) can't be exhaustively checked — the compiler doesn't know the full variant set, so it forces a wildcard.
- **The exponential analogy assumes total functions.** Partial functions, exceptions, infinite loops, and side effects break `|A->B| = |B|^|A|`. The clean algebra is for *total, pure* functions.
- **Distributivity preserves info but not invariants.** `A × (B+C) ≅ A×B + A×C` keeps the same values, but if you had a cross-field invariant tying `A` to the choice, regrouping may make it easier *or harder* to enforce. Re-check invariants after regrouping.
- **`#[non_exhaustive]` flips the trade-off.** Library authors mark enums non-exhaustive so adding a variant isn't a breaking change — but it forces *downstream* matches to include a wildcard, costing them exhaustiveness.

---

## Test Yourself

1. Compute the cardinality of `Result<bool, Color>` where `|Color| = 3`. Then compute `Result<Color, bool>`. Are they isomorphic? Why does iso-ness not make them interchangeable in code?
2. Use the exponent laws to simplify the type `Unit -> (A -> Void)`. What well-known type/value is it?
3. `(bool, bool, bool)` vs `u8` restricted to `0..=7`: prove they're isomorphic by giving the forward and backward conversions.
4. Apply distributivity to `(timestamp: u64) × (Click | Key)` and write both encodings as concrete structs/enums. Which would you ship, and why?
5. Why is `size_of::<Option<&u8>>()` equal to `size_of::<&u8>()`, but `size_of::<Option<u8>>()` is `2`? Explain in terms of niches.
6. `Option<Option<()>>` — how many values, and what are they? Which two would `.flatten()` merge?
7. In the TypeScript `assertNever` pattern, what type does `sh` have in the `default` arm when all cases are handled? What changes when you add an unhandled variant, and why does that produce an error?
8. Show why `Void -> A` has exactly one inhabitant for any `A`, using `0 ^ a` reasoning. What is that one function usually named?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│            THE ALGEBRA OF TYPES (semiring + exponentials)        │
├──────────────────────────────────────────────────────────────────┤
│ |A × B| = |A|·|B|     |A + B| = |A|+|B|                          │
│ |Unit| = 1            |Void| = 0                                  │
│ |A -> B| = |B| ^ |A|   ← functions are EXPONENTIALS              │
├──────────────────────────────────────────────────────────────────┤
│ Identities / laws:                                               │
│   A×1 ≅ A      A+0 ≅ A      A×0 ≅ 0                              │
│   A×(B+C) ≅ A×B + A×C          (distributivity → refactors)     │
│   (A×B)->C ≅ A->(B->C)         (currying = (c^b)^a)             │
│   (A+B)->C ≅ (A->C)×(B->C)     (match = function out of a sum)  │
│   Unit->A ≅ A     Void->A ≅ Unit (absurd)                       │
├──────────────────────────────────────────────────────────────────┤
│ Derived standard types:                                          │
│   Option<A> ≅ 1 + A      Result<T,E> ≅ E + T     bool ≅ 1 + 1   │
│   Option<Option<A>> ≅ 2 + A   (two empties — flatten!)          │
├──────────────────────────────────────────────────────────────────┤
│ Layout:                                                           │
│   product = fields + padding (order may be reshuffled)           │
│   sum     = tag + max(variant payloads)                          │
│   niche   = tag hidden in unused bits ⇒ Option<&T> is free       │
│   fix fat variant: Box it → sum shrinks to tag + pointer         │
├──────────────────────────────────────────────────────────────────┤
│ Exhaustiveness:                                                   │
│   decidable on CLOSED sums; produces a witness for missing case  │
│   wildcard `_` / non_exhaustive / open hierarchies disable it    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- Finite types and natural numbers are **isomorphic under arithmetic**: same cardinality ⇒ same information ⇒ lossless conversion. The algebra is a refactor receipt.
- Types form a **commutative semiring**: `A×1≅A`, `A+0≅A`, `A×0≅0`, and crucially **distributivity** `A×(B+C) ≅ A×B + A×C`, which justifies regrouping data between "shared field factored out" and "shared field per variant."
- **Function types are exponentials**: `|A->B| = |B|^|A|`. The exponent laws *are* programming idioms — currying (`(A×B)->C ≅ A->(B->C)`), pattern matching (`(A+B)->C ≅ (A->C)×(B->C)`), and `absurd` (`Void->A ≅ Unit`).
- The standard types are algebra: `Option<A> ≅ 1 + A`, `Result<T,E> ≅ E + T`, `bool ≅ 1 + 1`. Nested options are `2 + A` — two empties, hence `.flatten()`.
- **Products** lay out as fields-plus-padding (order may be reshuffled); **sums** lay out as **tag + largest variant**. **Niche optimization** hides the tag in unused bit patterns, making `Option<&T>` the same size as `&T` for free. Box fat variants to shrink sums.
- **Exhaustiveness checking** is a decidable, witness-producing algorithm over *closed* sums — which is why native sums enable it and faked/open ones don't. Bolt it onto weak languages with the `never`/`assertNever` (Void) trick.
- Closed sums favor *many operations over few fixed cases*; the opposite trade-off (the expression problem) is the OO/interface world, covered next level.

---

## What You Can Build

- **A cardinality calculator.** Parse a small ADT grammar (sums, products, Unit, Void, references to named types) and compute the number of inhabitants, flagging infinite (recursive) types.
- **An isomorphism checker / converter generator.** Given two finite ADTs of equal cardinality, generate the `to`/`from` functions witnessing the isomorphism.
- **A `size_of` explorer.** A program that prints the size and alignment of various sums and demonstrates niche optimization and the box-the-fat-variant trick with before/after numbers.
- **A toy exhaustiveness checker.** Implement Maranget's usefulness algorithm for a tiny pattern language and have it report the missing-case witness.
- **A curry/uncurry library** for tuples of arity 2–5, with property tests asserting the round-trip identities (the exponent laws) hold.

---

## Further Reading

- *Thinking with Types* — Sandy Maguire. Chapter on the algebra of types: isomorphisms, the semiring, and exponentials, with exercises.
- "The Algebra (and Calculus!) of Algebraic Data Types" — Joel Burget / various write-ups expanding Conor McBride's "differentiating data structures" line of work.
- "Compiling Pattern Matching to Good Decision Trees" — Luc Maranget. The exhaustiveness/usefulness algorithm that real compilers use.
- The Rust Reference, "Type layout" and "Enumerations" sections — discriminants, `repr`, and niche/null-pointer optimization. https://doc.rust-lang.org/reference/type-layout.html
- *Programming in Haskell* — Graham Hutton — for `curry`/`uncurry` and reasoning about functions as values.
- "Parametricity" / Wadler, *Theorems for Free!* — why the shape of a (polymorphic) type constrains the functions of that type (a payoff of seeing functions as exponentials).
- *Domain Modeling Made Functional* — Scott Wlaschin — distributivity and choice-of-encoding shown as everyday domain modeling.

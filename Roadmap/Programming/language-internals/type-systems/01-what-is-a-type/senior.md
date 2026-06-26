# What Is a Type — Senior Level

> **Topic:** [What Is a Type](README.md)
> **Focus:** The formal lenses on "type" — types-as-sets (and where it breaks), the Curry–Howard correspondence (types as propositions, programs as proofs), types as interfaces/capabilities — and why "untyped" really means "uni-typed."

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
13. [Tricky Points](#tricky-points)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)

---

## Introduction

> Focus: **What is a type, formally?** Not "a set of values plus operations" as a slogan, but as the object that several rigorous theories each capture from a different angle — and why no single lens is the whole picture.

The pragmatic definition — *a set of values together with the operations valid on them* — is the right starting point and survives a lot of pressure. But a senior engineer should know **where it leaks**, **what the alternative formalizations buy you**, and **why "a type is just a set" is both the most intuitive and the most misleading thing you can say.**

This page presents four lenses, each illuminating something the others hide:

1. **Types as sets.** Intuitive, the basis of subtyping-as-subset and union/intersection types — but it breaks on recursive types, function types, and the "set of all sets" paradox.
2. **Types as propositions, programs as proofs** — the **Curry–Howard correspondence**. A type is a *logical proposition*; a value of that type is a *proof* of it. This is not a metaphor; it is a precise structural isomorphism, and it underlies proof assistants, dependent types, and a deep view of what a well-typed program *means*.
3. **Types as interfaces/capabilities.** A type is the *set of operations you may perform* — it describes what you can *do*, not what something *is*. This is the view behind interfaces, type classes, traits, and structural typing.
4. **"Untyped" as uni-typed.** A so-called untyped language isn't free of types; it has exactly *one* type (the universal type of "values"), with every operation defending itself at run time.

The throughline: **a type is whatever a particular theory needs it to be to make "well-typed programs don't go wrong" provable.** Different theories make different trade-offs, and a senior chooses the lens that fits the problem.

> 🎓 **Why this matters at this level:** The lens you adopt changes the systems you can design and the bugs you can eliminate. Sets give you union/intersection types and subtyping. Curry–Howard gives you "make illegal states unrepresentable" taken to its logical extreme — types that encode invariants a checker can *prove*. The interface lens gives you decoupling and polymorphism. Knowing all of them lets you reach for the right one rather than forcing every problem into "set of values."

---

## Prerequisites

- **Required:** The middle-level framework — static vs dynamic type, type checking as proof vs test, inference, erasure, soundness ("well-typed programs don't go wrong").
- **Required:** Comfort with generics/parametric polymorphism, subtyping, and at least one of: ML/Haskell-style sum types, Rust traits, or Java/TS interfaces.
- **Required:** Basic logic (implication, conjunction, disjunction, quantifiers) at the level of "I can read `A ∧ B → C`."
- **Helpful but not required:** Having seen `Either`/`Result`, `Option`/`Maybe`, and pattern matching.
- **Helpful but not required:** Awareness that some languages (Idris, Agda, Coq/Lean) let types depend on values.

You do **not** need:

- A formal proof-theory background; Curry–Howard is presented operationally, with the slogan made concrete, not via sequent calculus.
- Category theory.
- The professional-level material on representation, monomorphization, and runtime type representation.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Types-as-sets** | Viewing a type as the set of its values; subtyping as subset, union/intersection as set operations. |
| **Curry–Howard correspondence** | The isomorphism: types ≅ propositions, programs ≅ proofs, evaluation ≅ proof simplification. |
| **Proposition** | A logical statement that may be true or false; under Curry–Howard, a type. |
| **Inhabited type** | A type that has at least one value; corresponds to a *provable* proposition. |
| **Uninhabited type** | A type with no values (e.g. `Void`, `Never`); corresponds to `False`. |
| **Sum type** | A "this OR that" type (tagged union); corresponds to logical OR. |
| **Product type** | A "this AND that" type (struct/tuple); corresponds to logical AND. |
| **Function type `A → B`** | "Given an `A`, produces a `B`"; corresponds to implication `A ⇒ B`. |
| **Interface / capability view** | A type as the *set of operations* permitted, not the set of values. |
| **Structural typing** | Type compatibility by shape/operations rather than name. |
| **Nominal typing** | Type compatibility by declared name/identity. |
| **Uni-typed** | Having exactly one type; the precise sense in which "untyped" languages are typed. |
| **Recursive type** | A type defined in terms of itself (`List = Nil | Cons(T, List)`). |
| **Variance** | How subtyping of components relates to subtyping of containers (covariant/contravariant). |
| **Dependent type** | A type that depends on a *value* (`Vec<n>` for length `n`). |
| **Type former / connective** | A constructor that builds types from types (`→`, `×`, `+`, `∀`). |

---

## Core Concepts

### 1. Lens One: Types as Sets

The most natural formalization: a type **is** the set of its values. `Bool = {true, false}`. `Nat = {0, 1, 2, ...}`. Under this lens, the type-system operations become set operations, and a lot falls out elegantly:

- **Subtyping is subset.** `S <: T` ("S is a subtype of T") means *the values of `S` are a subset of the values of `T`*. `PositiveInt <: Int` because every positive integer is an integer. A value of the subtype is usable wherever the supertype is expected — the **Liskov substitution** principle is "subset" in disguise.
- **Union types are set union.** `Int | String` is the set of all ints *and* all strings.
- **Intersection types are set intersection.** `Serializable & Comparable` is the set of values that are *both*.
- **The empty type** (`Never`, `Void`, `⊥`) is the empty set `∅` — no values inhabit it.
- **The top type** (`any`, `Object`, `⊤`) is the universal set — every value belongs.

This lens is genuinely how TypeScript's union/intersection types, Scala's `with`, and most subtyping intuition work. It's powerful and you should keep it.

### 2. Where Types-as-Sets Breaks

But "a type is just a set" leaks badly under pressure, and a senior must know exactly where:

**(a) Function types.** What *set* is `Int → Int`? Naively, the set of all functions from `Int` to `Int`. But that set is enormous — for an infinite domain it's uncountable, while the functions a program can *express* are countable. The set of *mathematical* functions and the set of *computable/definable* functions diverge. Treating `A → B` as a plain function set leads to cardinality trouble.

**(b) Recursive types.** Define `Tree = Leaf | Node(Tree, Tree)`. As a set equation, this is `Tree = 1 + (Tree × Tree)` — a set defined in terms of itself. Does a solution even exist? Naively iterating can blow up. The honest answer requires *domain theory* (least fixed points of monotone operators on a lattice of sets), not naive set theory. The intuition "a type is its set of values" doesn't tell you how to *construct* that set when the definition is circular.

**(c) The "set of all sets" paradox.** If a type is a set, and there is a *type of all types* (a top type that contains itself), you reproduce **Russell's paradox**: the set of all sets that don't contain themselves cannot consistently exist. A naive "type of all types : type" is *inconsistent*. This is why dependently typed systems introduce a **hierarchy of universes** (`Type₀ : Type₁ : Type₂ : ...`) — to avoid the type of all types containing itself. The set lens, taken literally, is logically unsound.

The lesson: **types-as-sets is an excellent intuition and a poor foundation.** Use it to reason about subtyping and unions; abandon it the moment you hit functions, recursion, or types-of-types.

### 3. Lens Two: Curry–Howard — Types as Propositions, Programs as Proofs

Here is the deep one. The **Curry–Howard correspondence** observes that the typing rules of a programming language and the inference rules of constructive (intuitionistic) logic are *the same rules*, written in different notation. It is a structural isomorphism, not an analogy:

| Logic | Types | 
|-------|-------|
| proposition `P` | type `P` |
| proof of `P` | value/program of type `P` |
| `P ∧ Q` (and) | product type `(P, Q)` — a pair |
| `P ∨ Q` (or) | sum type `Either P Q` — a tagged union |
| `P ⇒ Q` (implies) | function type `P → Q` |
| `True` | unit type `()` — trivially inhabited |
| `False` | empty type `Void`/`Never` — uninhabited |
| `¬P` | `P → Void` (a function that, given a `P`, derives absurdity) |
| proof simplification | program evaluation (β-reduction) |

Read the table as: **a type is a proposition, and a value of that type is a proof that the proposition holds.** To *have* a value of type `T` is to have *evidence* that `T` is inhabited — that the proposition `T` is true.

This reframes everything. A function `(A, B) → C` is a *proof* that "`A` and `B` together imply `C`." A function `A → (B → C)` is a proof of `A ⇒ (B ⇒ C)` — and currying is exactly the logical equivalence `(A ∧ B ⇒ C) ⟺ (A ⇒ B ⇒ C)`. The empty type `Void` is `False`: you can't construct a value of it, just as you can't prove falsehood. A function `A → Void` is a proof of `¬A` — "assuming `A`, I reach a contradiction."

Why this matters operationally:

- **"Make illegal states unrepresentable" is the engineering shadow of Curry–Howard.** If you encode an invariant as a type, *constructing a value of that type is a proof the invariant holds.* A `NonEmptyList` value is a proof the list is non-empty. The type checker checks your proof.
- **Total functions are proofs; partial functions are not.** A function that might loop forever or throw doesn't correspond to a valid proof — which is why proof assistants (Coq, Agda, Lean, Idris) require *totality*.
- **Dependent types push this to the limit.** When types can mention values, `∀n. Vec n → Vec n` is a genuine universally-quantified theorem, and the program is its proof. Proving and programming become the same activity.

You don't need a proof assistant to benefit. The mindset — *a type is a claim; a value is its evidence* — sharpens API design enormously.

### 4. Lens Three: Types as Interfaces / Capabilities

The third lens drops "what values are in the set" entirely and asks: **what can I *do* with this?** A type, under this view, is a *set of operations* (a capability, an interface, a contract of behavior):

- A Java/Go **interface** says "any value here supports these methods." It says nothing about the value's representation — only its capabilities.
- A Haskell **type class** / Rust **trait** says "any type implementing this provides these operations." `Ord` means "can be ordered"; `Show` means "can be rendered."
- **Structural typing** (TypeScript, Go interfaces, OCaml objects) makes this literal: a value *has* a type iff it *has the operations*, regardless of name or declared inheritance. "If it walks like a duck and quacks like a duck, it's a `Duck`."

This is the lens that powers decoupling. When a function takes a `Reader` interface, it doesn't care whether the value is a file, a socket, or an in-memory buffer — only that it supports `read`. The type is the *capability boundary*. Note this is *dual* to the set lens: the set lens describes a type by its inhabitants (extensionally); the interface lens describes it by its operations (intensionally). The pragmatic junior definition — "values *plus operations*" — is really these two lenses stapled together, and the staple is doing real work.

### 5. Lens Four: "Untyped" Is Uni-Typed

A claim that sounds like a riddle but is precise. People call assembly, raw Lisp, or the untyped lambda calculus "untyped." But from a type-theory standpoint, **they are not untyped — they are *uni-typed*: they have exactly one type**, the universal type of all values.

In the untyped lambda calculus, everything is a function, so there is one type, "term," and every term inhabits it. In a dynamic language, every value inhabits the single static type "Value" (or `Dynamic`, or `Object`), and the language inserts a runtime check at *every* operation to defend against misuse — `x.foo()` is "if the value tagged at `x` supports `foo`, dispatch, else error." Robert Harper's framing: **a dynamically typed language is a statically typed language with a single recursive type into which all values are injected, with tag-checking projections out of it.**

This reframing has teeth:

- It dissolves the "static vs dynamic" war into "how many static types: one, or many?" Dynamic languages chose *one*.
- It explains why you can *embed* a dynamic language inside a static one (a `Dynamic` type plus tag checks) but the reverse requires throwing information away.
- It clarifies that "untyped" code still pays for types — just at run time, on every operation, with a tag check — rather than once, at compile time.

### 6. Synthesizing the Lenses

No single lens is "the truth." A type is the object that:

- has an **extension** (its set of values — the set lens),
- carries a **logical meaning** (its proposition — the Curry–Howard lens),
- exposes an **interface** (its operations — the capability lens),
- and exists to make **soundness** provable.

The pragmatic "set of values + operations" is the set lens and the interface lens fused. Curry–Howard explains *why* well-typed programs are meaningful (they're proofs). The uni-typed observation explains what "no types" really costs. A senior reaches for whichever lens makes the current design decision clearest — unions and subtyping (sets), invariants and evidence (Curry–Howard), decoupling and polymorphism (interfaces).

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Type as set** | A guest list: a type is exactly the set of people allowed in. Subtype = a subset of the list (VIPs ⊆ guests). |
| **Where sets break (recursive)** | A definition like "a committee is a person or a pair of committees" — circular; you can't just enumerate it. |
| **Set of all sets paradox** | A directory that must list every directory including itself — and a directory of "directories not listing themselves" can't consistently exist. |
| **Curry–Howard: type as proposition** | A *contract clause* ("if you deliver A and B, I owe you C"). A signed, fulfilled contract (a value) is *proof* the clause was honored. |
| **Value as proof** | A *receipt*. Possessing a valid receipt is evidence the transaction (the proposition) actually happened. |
| **Uninhabited type (Void)** | A receipt for a transaction that can never occur — none can exist, so holding one would be absurd. |
| **Type as interface/capability** | A *driver's license*. It doesn't say who you are inside; it certifies a capability ("permitted to drive"). |
| **Structural typing** | Hiring by skills demonstrated, not by job title on the résumé — "can you do the work?" not "what were you called?" |
| **Uni-typed / "untyped"** | A warehouse where every box is labeled only "STUFF," and a worker must open and inspect each box at use-time to know what's inside. |

---

## Mental Models

### The "Evidence" Model (Curry–Howard)

Stop reading `x: T` as "x is in the set T" and start reading it as "**x is evidence that T holds.**" A `User` value is evidence a user exists; a `Sorted<List>` value is evidence the list is sorted; a `Proof<A=B>` value is evidence two things are equal. Designing types becomes designing *what you must prove to construct a value* — and the constructor becomes the proof. This single reframing is the most powerful tool a senior gets from this topic.

### The "Four Questions" Model

For any type, you can ask four different questions, each a lens: *(1) Which values are in it?* (set) *(2) What proposition does it assert?* (Curry–Howard) *(3) What can I do with it?* (interface) *(4) How many static types does my language have — and is this one of many, or the only one?* (uni-typed). Different design problems are clarified by different questions. Train yourself to notice which question you're actually asking.

### The "Inhabitation = Provability" Model

A type is **inhabited** (has a value) iff its corresponding proposition is **provable**. `() ` (unit / `True`) is trivially inhabited. `Void` / `Never` (`False`) has no inhabitants — and the only way to "produce" one is via code that can never actually run (`absurd`, `unreachable!`, `match` on an empty type). When you find yourself writing a function `(A) -> Never`, you're writing a proof of `¬A` — a claim that `A` leads to contradiction. The compiler verifying it is the compiler checking your proof.

### The "Set Intuition, Domain-Theory Reality" Model

Keep the set picture for subtyping and unions, but flag it as a *lossy approximation*. The moment you write a recursive type, a function type, or a type-of-types, switch models: types are *least fixed points* of operators on a lattice (domain theory), not naive sets. Holding both — set intuition for the easy 90%, domain-theory awareness for the hard 10% — is what separates "I learned types-as-sets once" from understanding.

---

## Code Examples

### Types-as-sets: subtyping is subset, unions and intersections

```typescript
// TypeScript makes the set lens literal.
type Animal = { name: string };
type Dog = { name: string; bark(): void };
// Dog <: Animal  ⟺  every Dog is an Animal  (subset)

type Id = string | number;          // UNION = set union: all strings ∪ all numbers
type Both = Serializable & Loggable; // INTERSECTION = set intersection

type Never = string & number;        // empty set: no value is both → effectively `never`
```

### Curry–Howard: types are propositions, values are proofs

```haskell
-- AND  ≅  product (pair)
type And a b = (a, b)
-- proof of "A and B" is a pair: you must supply both
proofAnd :: And Int Bool
proofAnd = (42, True)

-- OR  ≅  sum (Either)
type Or a b = Either a b
-- proof of "A or B" is a choice of one side
proofOr :: Or Int Bool
proofOr = Left 42

-- IMPLICATION  ≅  function
modusPonens :: (a -> b) -> a -> b   -- given (A ⇒ B) and A, derive B
modusPonens f x = f x

-- FALSE  ≅  uninhabited type; no value can be built
data Void                            -- no constructors → no proof of False

-- NOT A  ≅  A -> Void
type Not a = a -> Void
```

The key insight: `modusPonens` is literally the logical rule "from `A ⇒ B` and `A`, conclude `B`," and it *is* function application. The program is the proof.

### Curry–Howard in Rust: `Never` as `False`, and impossible code

```rust
// `!` (never) is the uninhabited type — Rust's False.
fn unreachable_branch(x: u8) -> u8 {
    match x {
        0..=255 => x,        // exhaustive
        // any further arm would have type `!` — impossible to reach
    }
}

// A function returning `!` never returns normally — it's a proof of "no normal exit".
fn always_panics() -> ! {
    panic!("this never returns a value")
}

// Result<T, Infallible>: the error case is uninhabited → a PROOF it can't fail.
use std::convert::Infallible;
fn cannot_fail(x: i32) -> Result<i32, Infallible> {
    Ok(x)   // the Err variant can never be constructed; the type proves totality
}
```

`Infallible` (an uninhabited error type) is "make illegal states unrepresentable" as a *proof*: the type guarantees, by inhabitation, that no error path exists.

### Make illegal states unrepresentable as proof-carrying construction

```rust
// A NonEmptyVec: constructing one is a PROOF the collection is non-empty.
pub struct NonEmptyVec<T> {
    head: T,            // there is always at least this one
    tail: Vec<T>,
}

impl<T> NonEmptyVec<T> {
    pub fn new(head: T) -> Self { Self { head, tail: vec![] } }
    pub fn first(&self) -> &T { &self.head }   // total — no Option needed, no panic
}
// `first()` can never fail. The TYPE carries the proof, so the runtime never checks.
```

### The interface/capability lens — Go structural typing

```go
// A type here = a set of operations, not a set of values.
type Reader interface { Read(p []byte) (n int, err error) }

// Anything with a Read method IS a Reader — no declaration of intent needed.
func consume(r Reader) { /* works for files, sockets, buffers, ... */ }

// *bytes.Buffer, *os.File, net.Conn all satisfy Reader structurally:
// they have the Read method, therefore they have the type.
```

### Haskell type classes — capability as constraint

```haskell
-- `Ord a` is the capability "a can be totally ordered".
maximum' :: Ord a => [a] -> a       -- works for ANY a that supports ordering
maximum' = foldr1 (\x y -> if x >= y then x else y)
-- The type doesn't name concrete values; it names a REQUIRED OPERATION SET.
```

### Uni-typed: "untyped" is one type with runtime tag checks

```python
# Conceptually, every Python value has the single static type "object",
# and each operation defends itself with a runtime tag check.
def add(a, b):
    return a + b      # runtime: look up __add__ on a's dynamic tag; error if absent

add(1, 2)             # 3
add("x", "y")         # "xy"
add(1, "y")           # TypeError — the tag-checking "projection out of the universal type" fails
```

Harper's point made concrete: this is a statically typed program over a single universal type `object`, with a tag check at every `+`.

---

## Pros & Cons

| Lens | What it buys you | Where it misleads |
|------|------------------|-------------------|
| **Types-as-sets** | Clean account of subtyping (subset), unions, intersections, top/bottom types. | Breaks on function types, recursive types, type-of-types (Russell). Not a sound foundation. |
| **Curry–Howard** | Types-as-evidence; "make illegal states unrepresentable" as *proof*; foundation of dependent types and proof assistants. | The full correspondence requires totality; mainstream languages with `null`/exceptions/loops are "inconsistent logics." |
| **Interface/capability** | Decoupling, polymorphism, structural typing, dependency inversion. | Says nothing about values/representation; can permit structurally-compatible-but-semantically-wrong matches. |
| **Uni-typed view** | Dissolves the static/dynamic war; explains the runtime cost of "untyped." | A reframing, not a tool you code with directly; can feel like sophistry until it clicks. |

---

## Use Cases

- **Reach for the set lens** when designing union/intersection types, modeling subtype hierarchies, or reasoning about `top`/`bottom`/exhaustiveness.
- **Reach for Curry–Howard** when you want a type to *carry a guarantee* — non-emptiness, sortedness, validated input, bounded indices — and when evaluating proof-assistant or dependently typed approaches (smart contracts, crypto, safety-critical kernels).
- **Reach for the interface lens** when decoupling modules, designing plugin systems, writing generic algorithms over capabilities, or choosing between nominal and structural typing.
- **Reach for the uni-typed framing** when explaining to a team *why* a dynamic language's flexibility isn't free, or when designing a `Dynamic`/`Any` interop layer inside a static language.

---

## Coding Patterns

### Pattern 1: Encode invariants as constructible-only-when-valid types

A value of `EmailAddress`, `NonEmptyList`, `SortedVec`, or `ValidatedForm` can only be *constructed* through a checking constructor. Once you hold one, the invariant is *proved* — downstream code never re-checks. This is Curry–Howard applied: the constructor is the proof; the type is the theorem.

### Pattern 2: Use uninhabited types to prove "can't happen"

Return `Result<T, Infallible>` (Rust), use `Void`/`never` for unreachable branches, model "this enum case is impossible here" with an empty type. The compiler then *proves* the dead path is dead and can optimize it away.

### Pattern 3: Program to capabilities, not representations

Accept the narrowest interface that supports the operations you need (`Reader`, `Ord`, `Iterator`), not a concrete type. You're naming the *proposition* "this value supports these operations," which is the most reusable contract.

### Pattern 4: Choose nominal vs structural deliberately

Use **nominal** typing when identity/intent matters (a `Meters` must not be confused with a `Feet` even though both are `f64`). Use **structural** typing when you want maximal interop with anything shaped right (duck-typed adapters, config objects). The lens (set+name vs operations) tells you which you're choosing.

---

## Best Practices

- **State which lens you're using when reasoning.** "Is this a subtype?" is a set question; "does this carry the invariant?" is a Curry–Howard question; "what operations does it need?" is an interface question. Mixing them silently causes confused designs.
- **Treat construction as proof.** If a value of type `T` should imply an invariant, make the invariant *impossible to violate at construction*, and never re-validate downstream.
- **Use the empty/never type intentionally.** It documents and proves impossibility; it's not a curiosity. `-> Never` and `Result<_, Infallible>` are precise communication.
- **Don't oversell types-as-sets.** When a colleague reasons about a recursive or higher-order type as "just a set," gently flag the leak — it's where subtle bugs and misunderstandings live.
- **Prefer capabilities over concretes at boundaries.** It maximizes reuse and testability and names exactly the proposition you depend on.
- **Know your language's logic is probably inconsistent.** Any language with non-termination, exceptions, or `null` corresponds to an inconsistent logic — so you can "prove" `False` (e.g. `let x: Void = loop {}`). Useful to know when you reach for "the type proves it": it proves it *only if the producing code is total*.

---

## Edge Cases & Pitfalls

- **Function types aren't honest sets.** Reasoning about `A → B` as the full mathematical function set overcounts (uncomputable functions) and invites cardinality confusion. Think "computable maps," or switch to the Curry–Howard reading (a proof of `A ⇒ B`).
- **Recursive types need fixed points, not enumeration.** "List is Nil or Cons of (T, List)" isn't a set you enumerate; it's a least fixed point. Naive set reasoning gives wrong answers about inhabitation and equality.
- **`Type : Type` is inconsistent.** A type of all types containing itself reproduces Russell's paradox; this is why dependent type theories stratify into universes. If you design a "type of types," beware.
- **Inhabitation can be undefined to decide.** Whether an arbitrary type is inhabited (provable) is, in rich type systems, undecidable — the same wall as the halting problem. Don't expect a checker to always answer "can this be constructed?"
- **Structural matches can be semantically wrong.** Two types with the same shape (`{ x: number; y: number }` as both a `Point` and a `Vector`) are interchangeable structurally but may mean different things. The interface lens sees operations, not meaning.
- **"The type proves it" only holds in a total fragment.** If the constructor can loop, throw, or be bypassed by reflection/`unsafe`, the "proof" has a hole. Curry–Howard guarantees are as strong as your language's totality and soundness.

---

## Tricky Points

- **Curry–Howard is an isomorphism, not an analogy.** The typing rules and the natural-deduction rules are *the same rules*. This is why advances in logic and in type systems track each other historically (intuitionistic logic ↔ simply typed lambda calculus; second-order logic ↔ System F; predicate logic ↔ dependent types).
- **Currying is a logical theorem.** `(A × B → C) ≅ (A → B → C)` is the type-level statement of `(A ∧ B ⇒ C) ⟺ (A ⇒ (B ⇒ C))`. The everyday refactor "uncurry/curry" is a proof transformation.
- **Negation is a function to `Void`.** `¬A` is `A → Void`: "give me an `A` and I'll produce absurdity." Double-negation `((A → Void) → Void)` is *not* the same as `A` in constructive logic — which is exactly why constructive type theory rejects the law of excluded middle and classical proofs by contradiction don't always yield programs.
- **The pragmatic definition is two lenses fused.** "Set of values + operations" = the set lens (values) ∧ the interface lens (operations). Recognizing this explains why it's so durable *and* why it quietly omits the Curry–Howard meaning.
- **Uni-typed framing inverts the usual story.** Instead of "dynamic languages have no types," say "they have *one* type and check it everywhere at run time." This is more accurate and more useful, and it makes gradual typing (adding *more* static types incrementally) the natural next step rather than a paradigm switch.

---

## Test Yourself

1. State subtyping in set terms. Why is `S <: T` "the values of S are a subset of T's," and how does Liskov substitution follow?
2. Give three concrete places "a type is just a set" breaks, and say what goes wrong in each.
3. Under Curry–Howard, what proposition does the function type `A → B` correspond to? What about the product `(A, B)` and the sum `Either A B`?
4. Why is `Void`/`Never` the type corresponding to `False`? What does a function of type `A → Void` prove?
5. Explain "make illegal states unrepresentable" as an instance of Curry–Howard. What is the proof, and what is the theorem?
6. In what precise sense is an "untyped" language uni-typed? What does it pay, and when, in place of compile-time checking?
7. Why does a language with non-termination correspond to an *inconsistent* logic, and what does that mean for "the type proves the invariant"?
8. Contrast the set lens and the interface lens on the *same* type `Reader`. What does each say, and why are they dual?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                   FOUR LENSES ON "WHAT IS A TYPE"               │
├──────────────────────────────────────────────────────────────────┤
│ 1. TYPES AS SETS                                                 │
│    type = set of its values                                      │
│    subtype = subset (S<:T ⟺ S ⊆ T) → Liskov                     │
│    union = ∪,  intersection = ∩,  Never = ∅,  Any = universe     │
│    BREAKS ON: function types, recursive types, Type:Type (Russell)│
├──────────────────────────────────────────────────────────────────┤
│ 2. CURRY–HOWARD: types ≅ propositions, programs ≅ proofs         │
│    A∧B = (A,B) product     A∨B = Either A B sum                  │
│    A⇒B = A→B function      True = ()        False = Void/Never   │
│    ¬A  = A→Void            modus ponens = function application    │
│    inhabited type ⟺ provable proposition                         │
│    "make illegal states unrepresentable" = construction-as-proof  │
│    (needs TOTALITY; null/loops/exceptions ⇒ inconsistent logic)  │
├──────────────────────────────────────────────────────────────────┤
│ 3. TYPES AS INTERFACES / CAPABILITIES                            │
│    type = the SET OF OPERATIONS you may perform                  │
│    interfaces / traits / type classes / structural typing        │
│    "what can I DO with it" not "what IS it"  (dual of set lens)  │
├──────────────────────────────────────────────────────────────────┤
│ 4. "UNTYPED" = UNI-TYPED                                         │
│    one universal type; every op does a runtime TAG CHECK         │
│    dynamic lang = static lang w/ a single recursive type +       │
│                   tag-checking projections (Harper)              │
├──────────────────────────────────────────────────────────────────┤
│ pragmatic def "values + operations" = lens 1 (values) ∧ lens 3   │
│   (operations).  Curry–Howard explains WHY well-typed = meaningful│
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- The pragmatic "set of values + operations" is the right starting point but is really **two lenses fused** (values = the set lens, operations = the interface lens), and it omits the deeper logical meaning.
- **Types-as-sets** elegantly explains subtyping (subset), unions, intersections, and top/bottom types — but **breaks** on function types (cardinality), recursive types (need fixed points / domain theory), and a type-of-all-types (**Russell's paradox**; hence universe hierarchies). Great intuition, unsound foundation.
- The **Curry–Howard correspondence** is a precise isomorphism: **types are propositions, values are proofs.** Products are AND, sums are OR, functions are implication, `Void`/`Never` is `False`, `A → Void` is `¬A`, and *constructing a value is proving a theorem*. This is the formal heart of "make illegal states unrepresentable."
- The **interface/capability lens** defines a type by *what you can do* with it (operations), powering interfaces, traits, type classes, and structural typing — the dual of the set lens.
- **"Untyped" really means uni-typed:** one universal type with a runtime tag check at every operation. A dynamic language is a static language over a single recursive type with tag-checking projections.
- No lens is the whole truth. A senior **chooses the lens** that clarifies the problem: sets for subtyping/unions, Curry–Howard for invariants-as-evidence, interfaces for decoupling, uni-typed for understanding the cost of dynamism.
- The Curry–Howard "proof" guarantees hold only in a **total, sound** fragment; `null`, exceptions, non-termination, and `unsafe` make a language's logic inconsistent — so "the type proves it" is exactly as strong as the language's soundness.

---

## Further Reading

- *Types and Programming Languages* — Benjamin C. Pierce. The bridge from pragmatic to formal; subtyping, recursive types, and references.
- *Software Foundations* (Pierce et al.) — https://softwarefoundations.cis.upenn.edu/ — learn Curry–Howard by doing, in Coq.
- "Propositions as Types" — Philip Wadler. The single best accessible essay on Curry–Howard; also a recorded talk. https://homepages.inf.ed.ac.uk/wadler/papers/propositions-as-types/propositions-as-types.pdf
- "Dynamic Languages are Static Languages" — Robert Harper. The uni-typed argument, stated sharply. https://existentialtype.wordpress.com/2011/03/19/dynamic-languages-are-static-languages/
- *Practical Foundations for Programming Languages* — Robert Harper. Rigorous, modern, covers the uni-typed view formally.
- *Type Theory and Formal Proof* — Nederpelt & Geuvers. Curry–Howard and dependent types from the logic side.
- *The Little Typer* — Friedman & Christiansen. A gentle, Socratic introduction to dependent types and types-as-evidence.
- "Designing with Types" series — Scott Wlaschin. The engineering face of Curry–Howard for everyday code. https://fsharpforfunandprofit.com/series/designing-with-types/
- Russell's paradox and universe hierarchies — see the Agda/Idris/Lean documentation on `Type : Type` and stratification.

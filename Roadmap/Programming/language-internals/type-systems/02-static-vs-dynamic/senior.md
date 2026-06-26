# Static vs Dynamic Typing — Senior Level

> **Topic:** [Static vs Dynamic Typing](README.md)
> **Focus:** The machinery underneath — type soundness, what each discipline actually *guarantees*, erasure vs reification, inference, and the precise places where guarantees survive or break.

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

> Focus: **What does a type system actually *prove*, and what does it cost to prove it?** Static and dynamic typing differ not just in *when* they check but in *what theorem they establish* — and understanding that theorem is what lets a senior engineer reason precisely about where a program can and cannot go wrong.

At junior and middle level, static vs dynamic is "when are types checked" and "how do the hybrids work." At senior level you need the *formal substance*: the property a static type system establishes is **soundness** — "well-typed programs don't go wrong" (Milner, 1978) — and the entire engineering trade-off space is about *how much* of "wrong" a system rules out, at what cost in expressiveness and runtime mechanics.

Three things separate a senior's understanding from a mid-level's:

1. **Soundness is a precise claim, and it's about a specific set of errors.** A sound type system guarantees that a program that type-checks will never, at runtime, apply an operation to a value of the wrong type *for the operations the type system tracks*. It says **nothing** about logic errors, division by zero (usually), array bounds (usually), or `null` (unless the system tracks it). Knowing the boundary of the guarantee is the senior skill — "sound" doesn't mean "correct."

2. **The dynamic discipline establishes the *opposite* contract at runtime.** A dynamic language is, in a sense, *trivially* "sound" — it can't execute a bad operation, because it checks every operation right before performing it and raises an exception instead. The dynamic runtime is a *universal* type checker that fires at the last possible moment. Static typing is the project of moving that check *earlier* — before execution, over *all* paths — at the cost of conservatism.

3. **Erasure vs reification determines what survives to runtime**, which decides whether you can do `isinstance`, reflection, and runtime dispatch — and whether gradual typing's boundaries can be *enforced* or merely *erased*.

> 🎓 **Why this matters for a senior:** You will make architecture-level calls — "do we adopt a sound static layer, or stay dynamic with good tests?", "do we need reified types for our plugin system?", "why does our 'fully typed' codebase still crash?" — and these require reasoning about the *guarantee*, not vibes. The phrase "sound but not complete," the difference between erased Java generics and reified C# generics, and the Hindley–Milner contract are the senior-level vocabulary for these decisions.

This page covers: soundness (and its dual, completeness) and the inevitable trade-off between them; the static checker as conservative over-approximation; the dynamic runtime as a deferred universal check; erasure vs reification and what each enables; type inference (Hindley–Milner) as the bridge that makes static typing terse; and the precise anatomy of how an unsound gradual boundary leaks. `professional.md` then takes these foundations into performance, empirical research, and migration at scale.

---

## Prerequisites

- **Required:** `junior.md` and `middle.md` — the static/dynamic and strong/weak axes, gradual/optional typing, `any` semantics, duck/structural/nominal typing.
- **Required:** Comfort reading types as propositions — a function `A -> B` as "give me an A, I'll give you a B."
- **Required:** Familiarity with at least one strongly statically typed language with inference (Rust, Haskell, OCaml, Go, or TypeScript with `strict`).
- **Helpful:** Having debugged a `ClassCastException`, a deserialization type mismatch, or a gradual-typing boundary bug — concrete experience of where static guarantees end.

You do **not** need to know:

- The full operational semantics or a mechanized soundness proof (we use them informally).
- The HM constraint-solving algorithm in mechanical detail (forward-referenced; we cover the *contract* and intuition).
- JIT/runtime-performance internals (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Soundness** | The property that every program the type checker accepts is free of the type errors the system tracks — "well-typed programs don't go wrong." No false negatives. |
| **Completeness** | The property that the type checker accepts every program that *would* run without type errors. No false positives. Practically unattainable for useful languages. |
| **Type safety** | The combination usually meant by "sound": well-typed programs don't reach an undefined/stuck state. |
| **Progress & preservation** | The two lemmas a syntactic soundness proof establishes: a well-typed term isn't stuck (progress), and evaluation preserves well-typedness (preservation). |
| **Conservative / over-approximation** | The checker rejects anything it can't *prove* safe, so it rejects some safe programs to guarantee it rejects all unsafe ones. |
| **Erasure** | Removing type information before runtime; no type survives execution (Java generics, TypeScript, ML after compilation). |
| **Reification** | Preserving type information at runtime so it can be inspected/dispatched on (Python values, Go reflection, C# generics, JVM `Class`). |
| **Type inference** | Reconstructing unannotated types from usage. **Hindley–Milner (HM)** is the classic complete algorithm for the ML family. |
| **Principal type** | The single most general type HM assigns; every other valid type is an instance of it. |
| **Unsound (deliberately)** | A type system that accepts some programs that *can* fail at runtime, by design — gradual systems with `any`, Java array covariance, TypeScript's bivariance. |
| **Gradual guarantee / blame** | Formal properties of gradual systems: blame tracking attributes a runtime cast failure to the responsible boundary (in sound gradual systems with runtime casts). |
| **Stuck state** | An execution state with no valid next step that isn't a final value — what soundness forbids for well-typed programs. |

---

## Core Concepts

### 1. Soundness: The Theorem Static Typing Proves

The foundational claim of static typing, in Milner's phrasing, is **"well-typed programs do not go wrong."** Formally, *go wrong* means reaching a **stuck state** — an expression that is not a value and has no valid evaluation step (e.g., trying to call `5` as a function). A **sound** type system guarantees: *if the checker accepts a program, execution never gets stuck on a type error the system tracks.*

The standard modern proof technique (Wright & Felleisen's syntactic approach) factors soundness into two lemmas:

- **Progress:** a well-typed term is either a value or can take an evaluation step — it's never stuck.
- **Preservation (subject reduction):** if a well-typed term takes a step, the result is still well-typed (with the same type).

Together: a well-typed program steps and steps, staying well-typed, never getting stuck. That's the guarantee. The critical senior-level caveat: **soundness is relative to the errors the type system models.** A type system that doesn't track `null` proves nothing about `null` dereferences; one that doesn't track array bounds proves nothing about out-of-bounds. "Sound" is not "bug-free" — it's "free of *these specific* errors."

### 2. The Soundness/Completeness Trade-off — Why Static Rejects Valid Programs

A type checker is a *decision procedure* approximating an *undecidable* question ("will this program have a type error at runtime?"). By Rice's theorem, you can't decide that exactly for a Turing-complete language. So every static checker must approximate, and it approximates **conservatively**:

- **Sound but incomplete** (the standard choice): never accept a bad program (no false negatives), but reject some good ones (false positives). This is why static typing "rejects valid programs" — it's not a bug, it's the *price of the guarantee*. The checker rejects what it can't *prove* safe.
- **Complete but unsound** (rare/undesirable): accept all good programs but also some bad ones. Useless as a safety net.

Real languages choose sound-but-incomplete and then *expand* the set of accepted-good programs by adding type-system features (generics, flow typing, dependent types) — each feature lets the checker *prove* more programs safe, shrinking the false-positive set without admitting false negatives. The whole history of type-system design is "make the checker smart enough to prove *more* correct programs correct, without ever letting a wrong one through."

```rust
// A correct program a checker may reject (illustrative): the value is always an int here,
// but if the type system can't track the branch condition's effect on the type, it refuses.
let x = if condition { 5 } else { 5 };   // fine
// vs. a heterogeneous case the checker can't unify into one static type:
// let x = if condition { 5 } else { "five" };  // rejected — no single type, even if downstream only uses one branch's shape
```

### 3. The Dynamic Runtime as a Deferred Universal Checker

Here's the reframing that unifies the two disciplines: **a dynamic language is "sound" in a trivial, expensive way — it checks every operation immediately before performing it.** When Python evaluates `a + b`, the interpreter dispatches on the *runtime* types of `a` and `b` (`a.__add__(b)`), and if no valid operation exists, it raises `TypeError` *instead of* doing something undefined. The program never reaches a stuck/undefined state; it reaches a *controlled exception*.

So the dynamic runtime is a **universal type checker that runs at the latest possible moment, per operation, only on executed paths.** Static typing is the project of **hoisting that check earlier** — to compile time, over *all* paths — accepting conservatism as the cost. This is the cleanest way to state the whole topic:

> **Dynamic = check late, per-op, executed-paths-only, always exact (the value's real type is right there). Static = check early, whole-program, all-paths, necessarily approximate (must reason about values it hasn't seen).**

The dynamic runtime is *exact* because it has the real value in hand — no approximation needed. The static checker is *approximate* because it reasons about values that don't exist yet, over branches that may never run. Exactness vs earliness is the fundamental tension.

### 4. Erasure vs Reification

**What survives to runtime?**

- **Erasure**: type information is a compile-time-only artifact, removed before execution. Java *generics* erase: `List<String>` and `List<Integer>` are both raw `List` at runtime; you cannot ask a `List` its element type. TypeScript erases *entirely* to JavaScript. ML/Haskell erase types after monomorphization/dictionary-passing.
- **Reification**: type information is preserved at runtime. Every Python value carries its type (`type(x)`). Go has full runtime type info (reflection, type switches, `interface` carries a type tag). C# *generics* are reified — `typeof(List<int>)` knows it's `int`. The JVM reifies *classes* (you can `getClass()`) but *erases* generic parameters.

**Consequences seniors must reason about:**

| Capability | Needs reification? |
|---|---|
| `isinstance(x, T)` / `x instanceof T` on the *erased* parameter | Yes — can't ask erased generics their parameter |
| Reflection / serialization driven by runtime type | Yes |
| Runtime dispatch on dynamic type (dynamic typing itself) | Yes — dynamic languages are inherently reified |
| Enforcing a gradual boundary at runtime (inserting a cast that *checks*) | Yes — erased systems (TS, mypy) *can't*, so their `any` leaks silently |
| Monomorphization / specialization for performance | Often pairs with erasure (the type is "used up" at compile time) |

The deep point: **dynamic typing requires reification by definition** — you can't check types at runtime if types aren't present at runtime. And **erasure is why TypeScript/mypy `any` boundaries fail silently** rather than throwing a clean cast error: there's no runtime type left to compare against. A *sound* gradual system (e.g., Typed Racket) keeps enough runtime information to insert *checking* casts at the static/dynamic boundary, so a smuggled wrong value is caught *at the boundary* with **blame** assigned to the offending side — but it pays for those casts.

### 5. The Anatomy of a Gradual-Boundary Leak (Soundness, Precisely)

Now we can state *exactly* why a "fully typed" TypeScript program crashes:

1. A value enters as `any` (erased — no runtime tag distinguishing it from any other JS value).
2. The checker, at the `any`-to-`T` boundary, performs **no static check** (that's what `any` means) and inserts **no runtime check** (that's what erasure means).
3. The value flows into typed code, which now *assumes* it's a `T` and emits code accessing `.foo` or calling `.bar()`.
4. At runtime, the value isn't a `T`; the access produces `undefined`/throws — at a point possibly far from the boundary, with no blame.

Compare a *sound* gradual system: step 2 inserts a runtime cast; the wrong value is caught *at the boundary*, blame points at the untyped side, and typed code never sees a non-`T`. TypeScript chose erasure (zero runtime cost, full JS interop) and thus **deliberate unsoundness** at `any` boundaries. This is a *designed* trade-off, not a flaw — but a senior must know precisely where the guarantee evaporates.

### 6. Type Inference: Static Typing Without the Ceremony

The strongest ergonomic objection to static typing — "too many annotations" — is largely answered by **inference**. The crown jewel is **Hindley–Milner (HM)**, the inference algorithm of the ML family (Haskell, OCaml, Standard ML, and the inspiration for Rust/Swift local inference).

The HM *contract* (mechanics are a forward-referenced topic):

- You write **no type annotations** and the compiler reconstructs the type of every expression.
- It always finds the **principal type** — the single *most general* type, of which every other valid type is a specialization. `fun x -> x` infers the principal type `'a -> 'a` (for all `'a`), the most general possible.
- It's **sound and complete *for its type discipline*** (let-polymorphism, no subtyping): it accepts exactly the well-typed programs, no more, no less, with no annotations needed.

```ocaml
(* No annotations anywhere — HM infers everything, fully statically *)
let rec map f = function
  | [] -> []
  | x :: xs -> f x :: map f xs
(* inferred principal type: ('a -> 'b) -> 'a list -> 'b list *)
```

The senior takeaway: **terseness is not a property of dynamic typing; it's a property of inference.** ML-family code reads as cleanly as Python and is fully statically checked. Languages with subtyping/overloading (Java, C#, TS) can't use full HM (subtyping breaks principal types), so they use *local* inference (`var`, `:=`, `auto`, `const`) — terse for locals, explicit at signatures. Either way, "no annotations visible" tells you nothing about static vs dynamic.

### 7. Where Static Soundness Famously Breaks (Real Unsoundness in Practice)

Even "static, strong" languages have *deliberate* soundness holes you must know:

- **Java/C# array covariance:** `Object[] a = new String[1]; a[0] = 42;` compiles but throws `ArrayStoreException` at runtime. The type system accepts a program that fails — unsound by design, patched with a runtime check.
- **`null` in most languages:** historically, `null` inhabits every reference type, so the checker "proves" a `String` is a `String` while it's actually `null` — the billion-dollar mistake. Modern systems (Kotlin, Rust's lack of null, TS `strictNullChecks`) close this by *tracking nullability in the type*.
- **Unchecked casts / `unsafe` / reflection:** every static language has an escape hatch (`(T) x`, `unsafe`, `Object.cast`) that hands the check back to runtime.
- **Deserialization:** reading JSON/bytes into a typed value is a runtime act the checker can't verify; it's a classic place static "guarantees" are actually runtime assumptions.

A senior states the guarantee precisely: **a sound static type system guarantees freedom from the type errors it models, *assuming no escape hatches are used*. Casts, `null`, reflection, deserialization, and `any` are exactly the boundaries where you re-enter dynamic-typing risk.**

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Soundness** | A bridge inspection that *guarantees* no bridge it passes will collapse — at the cost of failing some perfectly safe bridges it can't fully verify. |
| **Completeness (unattainable)** | An inspection that passes *every* safe bridge and no unsafe one — impossible when "will it hold?" can't be decided in finite time. |
| **Conservative over-approximation** | A bouncer who turns away anyone whose ID he can't *positively* verify — some real adults get turned away, but no minors get in. |
| **Dynamic runtime as deferred check** | A tightrope walker who tests each plank *as their foot lands on it* — never falls through a tested plank, but only tests planks they actually step on. |
| **Erasure** | Scaffolding taken down once the building stands — it shaped construction but isn't part of the finished structure, and you can't ask the wall about it later. |
| **Reification** | A nutrition label fused into the product — the information travels with the item forever and you can read it any time. |
| **Hindley–Milner inference** | A master tailor who measures you by watching you move, never asking your size, and produces a garment that fits exactly — and the *most general* pattern that still fits. |
| **Gradual boundary leak** | A customs lane with the scanner switched off — contraband (wrong types) passes unexamined and is only discovered when it explodes deep inside the country. |

---

## Mental Models

### The "Approximate-Early vs Exact-Late" Model

Lay the two disciplines on a time axis. Static typing makes its judgment **early** (compile time) and therefore **approximately** — it reasons about values it has never seen, over branches that may never run, so it must over-approximate and reject the unprovable. Dynamic typing makes its judgment **late** (the instant before each operation) and therefore **exactly** — the real value is in hand, no guessing, but only for operations that actually execute. Every property of the topic falls out of this one trade: earliness buys whole-program guarantees and costs conservatism; lateness buys exactness and costs "you only learn about the paths you ran."

### The "Theorem and Its Footnotes" Model

Treat a static type system as a *theorem*: "no type errors at runtime." Then read the *footnotes* that bound it: "...for the operations we track (not `null`, not bounds, not division), ...assuming you don't use casts/reflection/`unsafe`/`any`, ...assuming deserialization actually produced the claimed type." A senior never quotes the theorem without the footnotes. Most production "static type system didn't save us" stories are footnote violations — a cast, a `null`, an `any`, a bad deserialize — not a failure of the theorem.

### The "Information Lifetime" Model

Ask of any language: *when does type information cease to exist?* Dynamic: never — it lives in every value forever (reification), which is exactly what makes runtime checking possible. Static + erased (Java generics, TS): at the compile boundary — gone before main runs, enabling zero-cost abstraction but disabling runtime type queries on those parameters. Static + reified (C#, Go): it persists, costing memory but enabling reflection and runtime dispatch. This single question predicts whether `isinstance`/reflection works, whether gradual boundaries can self-enforce, and what the runtime costs.

---

## Code Examples

### Soundness boundary: where the "guarantee" stops

```java
// Java's type system is sound for the operations it models — except the holes it ships with.

// HOLE 1: array covariance (statically accepted, runtime failure)
Object[] arr = new String[2];
arr[0] = Integer.valueOf(42);   // compiles; throws ArrayStoreException at runtime

// HOLE 2: null inhabits every reference type
String s = null;                // "sound": s : String, but...
int len = s.length();           // NullPointerException — the checker "proved" s was a String

// HOLE 3: unchecked cast hands the check to runtime
Object o = "hello";
Integer n = (Integer) o;        // compiles (unchecked); ClassCastException at runtime
```

Each is a *deliberate* unsoundness: the language designers traded a guarantee for expressiveness/compatibility and inserted a runtime check (or, for `null`, nothing) as the backstop.

### Erasure vs reification, observable

```java
// Java generics ERASED — both are raw List at runtime
List<String> ls = new ArrayList<>();
List<Integer> li = new ArrayList<>();
System.out.println(ls.getClass() == li.getClass());   // true — same runtime class
// You CANNOT write: if (x instanceof List<String>)   // compile error — type erased
```

```csharp
// C# generics REIFIED — the parameter survives
var ls = new List<string>();
var li = new List<int>();
Console.WriteLine(ls.GetType() == li.GetType());   // False — distinct runtime types
Console.WriteLine(ls is List<string>);             // True — can query the parameter
```

```python
# Python is fully reified — every value knows its type at runtime; this IS dynamic checking
x = [1, 2, 3]
print(type(x), isinstance(x, list))   # <class 'list'> True
```

### The dynamic runtime as a per-operation checker

```python
# Python doesn't "have no type checking" — it checks EVERY operation, exactly, at the last moment.
def add(a, b):
    return a + b        # dispatches on a.__add__(b) at runtime, on the real types

add(1, 2)        # 3        — int.__add__ exists
add("a", "b")    # "ab"     — str.__add__ exists
add(1, "b")      # TypeError: unsupported operand type(s) for +: 'int' and 'str'
                 # NOT undefined behavior — a controlled, exact check that fired on THIS executed call only
```

### HM inference: full static checking, zero annotations

```haskell
-- No annotations. GHC infers the principal (most general) type of each.
compose f g x = f (g x)
-- inferred:  compose :: (b -> c) -> (a -> b) -> a -> c

pair x = (x, x)
-- inferred:  pair :: a -> (a, a)
```

The source is as terse as any dynamic language; the checking is total and the inferred types are *principal* (most general). Terseness ≠ dynamic.

### A sound gradual boundary (contrast with TS) — the idea

```racket
; Typed Racket inserts a runtime CONTRACT at the typed/untyped boundary.
; If untyped code passes a wrong value into a typed function, the contract
; CHECKS it at the boundary and BLAMES the untyped module — the typed side
; never observes a value of the wrong type. (Erased TS cannot do this.)
```

This is the difference between *sound* gradual typing (runtime-checked boundaries, blame) and *erased/optional* gradual typing (TS, mypy — boundaries unchecked, silent leak).

---

## Pros & Cons

| Aspect | Sound Static (no escape hatches) | Dynamic (reified, deferred check) |
|--------|----------------------------------|-----------------------------------|
| **Guarantee** | Provable absence of the modeled type errors over *all* paths. | Exact per-operation safety, but only on *executed* paths; no whole-program claim. |
| **When it fires** | Compile time, before any execution. | Runtime, last-possible-moment, per operation. |
| **Precision** | Approximate — rejects unprovable-but-correct programs. | Exact — has the real value in hand. |
| **Runtime cost** | Often zero (erased) — no type tags or checks needed. | Pays for reified tags and per-op dispatch/checks. |
| **Introspection / reflection** | Limited if erased; full if reified. | Full — types are always present. |
| **Escape-hatch risk** | Casts/`null`/reflection/`any` reopen runtime risk. | N/A — it's all runtime anyway, but no compile-time net. |
| **Expressiveness ceiling** | Bounded by what the checker can *prove* (conservatism). | Unbounded — any runtime-valid program runs. |

---

## Use Cases

- **Reach for sound static typing** when you need *provable* properties over the whole program — security-sensitive code, protocol state machines, anything where "we tested the paths we thought of" is insufficient. Encode invariants in types so the compiler proves them (make illegal states unrepresentable).
- **Reach for reified types** when the system genuinely needs runtime type knowledge — serialization frameworks, dependency-injection containers, ORMs, plugin systems, generic runtime dispatch. Erased generics will fight you here (the classic "can't get `T.class`" Java pain).
- **Accept dynamic typing's deferred-exact model** when the program's shape is inherently runtime-determined — interpreters, REPLs, data-shape-varies-by-input glue code, rapid exploration — and back it with tests that *execute every path* (since only executed paths are checked).
- **Choose a sound gradual system** (Typed Racket-style) when you need both incremental adoption *and* boundary enforcement; choose an erased/optional one (TS, mypy) when you need JS/Python interop and zero runtime cost more than boundary enforcement — and then guard boundaries by hand.

---

## Coding Patterns

### Pattern 1: Encode invariants into types (push runtime checks to compile time)

Replace runtime validation with types the compiler proves: non-empty lists (`NonEmpty`), validated email (`Email` newtype), parsed-not-stringly state. The senior mantra: *parse, don't validate* — turn external data into a precise type once, at the edge, and let the type carry the guarantee thereafter.

### Pattern 2: Quarantine every escape hatch behind a checked edge

Every cast, `unsafe`, reflection call, and deserialize is a re-entry into runtime risk. Wrap each in a small module that *validates* and returns a sound type, so the unsound act happens in exactly one audited place.

### Pattern 3: Prefer reified-friendly designs only where you need runtime types

Don't reach for reflection by default; it defeats erasure's zero-cost benefits and the checker's static reasoning. Use it deliberately at framework seams (serialization, DI) and keep business logic statically dispatched.

### Pattern 4: Let inference carry locals; annotate the proofs

Annotate the *theorems* — public function signatures and data types (the contracts other code relies on) — and let inference handle the *steps* (locals). This gives terse bodies with explicit, checkable interfaces.

### Pattern 5: Model nullability in the type, not in your head

Use `Option`/`Maybe`/`T?`/`strictNullChecks` so the single biggest soundness hole (`null`) becomes a tracked, compiler-enforced case rather than an implicit inhabitant of every type.

---

## Best Practices

- **State guarantees with their footnotes.** "Sound for the errors it models, absent escape hatches." Never claim a type system makes bugs impossible — it makes a *specific class* of bugs impossible under *specific assumptions*.
- **Treat every escape hatch as a documented exception to soundness.** Casts, `unsafe`, reflection, `any`, raw deserialize — count them, review them, validate at them.
- **Close the `null` hole.** Turn on `strictNullChecks` / use `Option` / use a non-null-by-default language. It's the highest-ROI soundness improvement available.
- **Know your erasure model.** Before designing serialization, DI, or generic runtime dispatch, know whether your generics are erased (Java, TS) or reified (C#, Go-ish) — it changes the whole design.
- **Don't confuse terseness with dynamism.** Inference (especially HM) gives static typing dynamic-looking ergonomics; judge a language by *when and what it checks*, not by how many annotations you type.
- **Prefer sound boundaries where bugs are expensive.** If a gradual boundary guards critical code, add the runtime validation that erasure omits — don't trust an erased `any` boundary.
- **Make illegal states unrepresentable.** The strongest use of a static system isn't catching typos; it's encoding domain invariants so whole bug classes can't be written.

---

## Edge Cases & Pitfalls

- **"Sound" ≠ "correct."** A sound type checker accepts programs with infinite loops, wrong business logic, and division by zero. It rules out only the type errors it models.
- **Incompleteness is not a defect.** Rejecting some valid programs is the *price* of soundness (Rice's theorem). The remedy is richer type features, not "turn off the checker."
- **Erased generics can't be reflected on.** `new T()`, `instanceof List<String>`, and `T.class` are impossible in Java because the parameter is gone at runtime. Designs assuming otherwise break.
- **Reification costs memory and sometimes speed.** Every reified value carries a type tag; dynamic dispatch reads it on every operation. This is the runtime tax static-erased code avoids (see `professional.md`).
- **Array covariance and similar holes are *deliberate* unsoundness.** They compile and fail at runtime by design — know your language's specific holes (Java arrays, TS function-parameter bivariance, `null`).
- **A gradual boundary in an erased system is unchecked in both directions.** Don't assume passing a typed value *out* to dynamic code is safe either — mutation and callbacks can smuggle wrong types back.
- **HM breaks under subtyping/overloading.** Languages with subtypes (Java, TS, C#) can't have full HM principal types, so they fall back to local inference and require signature annotations — this is why "just infer everything" isn't universally available.
- **Deserialization is an unchecked cast.** Reading bytes into `User` is a runtime *assertion*, not a static *proof*. The compiler trusts you; validate.

---

## Test Yourself

1. State Milner's soundness slogan and define "go wrong" precisely (stuck state). What two lemmas does a syntactic soundness proof use, and what does each say?
2. Why must a useful static type checker reject some valid programs? Tie your answer to decidability and the soundness/completeness trade-off.
3. Explain the claim "a dynamic language is trivially sound at runtime." In what sense is the dynamic runtime a *deferred universal type checker*, and what makes it *exact* where static is *approximate*?
4. Give three concrete, deliberate unsoundness holes in a "strong static" language and the runtime backstop (if any) for each.
5. Java generics vs C# generics: which is erased, which reified? Show one operation each enables/forbids as a result.
6. Explain *precisely* why a "fully typed" TypeScript program can throw at runtime, referencing both `any` (no static check) and erasure (no runtime check). Contrast with a sound gradual system's boundary.
7. What does Hindley–Milner guarantee about the type it infers (principal type)? Why can't Java use full HM? What's the consequence for annotations?
8. Why does dynamic typing *require* reification? Why does erasure *enable* TypeScript's silent `any` leak rather than a clean boundary error?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│        SOUNDNESS · ERASURE/REIFICATION · INFERENCE               │
├──────────────────────────────────────────────────────────────────┤
│ SOUNDNESS  "well-typed programs don't go wrong" (Milner)         │
│   proof = PROGRESS (not stuck) + PRESERVATION (stays well-typed) │
│   guarantee is RELATIVE to the errors the system models          │
│   sound != correct (logic bugs, div0, bounds, null may remain)   │
├──────────────────────────────────────────────────────────────────┤
│ SOUND vs COMPLETE (can't have both, undecidable)                 │
│   real checkers: SOUND + incomplete                              │
│     -> reject some valid programs (conservatism = the price)     │
│   richer type features = prove MORE correct programs, no leaks   │
├──────────────────────────────────────────────────────────────────┤
│ STATIC = check EARLY, all-paths, APPROXIMATE                     │
│ DYNAMIC = check LATE, per-op, executed-paths, EXACT              │
│   dynamic runtime = deferred universal checker (always reified)  │
├──────────────────────────────────────────────────────────────────┤
│ ERASURE  type gone before runtime (Java generics, TS, ML)        │
│   + zero runtime cost   - no isinstance/reflection on param      │
│   - gradual `any` boundary leaks SILENTLY (no tag to check)      │
│ REIFICATION  type survives (Python, Go, C# generics, JVM class)  │
│   + reflection/dispatch/serialization   - memory + per-op tax    │
├──────────────────────────────────────────────────────────────────┤
│ INFERENCE  terseness is a property of INFERENCE, not dynamism    │
│   Hindley-Milner: no annotations, finds PRINCIPAL (most general) │
│     type; sound+complete for its discipline; breaks w/ subtyping │
│   subtyping langs (Java/TS/C#): LOCAL inference + signature annos │
├──────────────────────────────────────────────────────────────────┤
│ DELIBERATE UNSOUNDNESS HOLES (know your language's)              │
│   Java/C# array covariance · null in every ref type · casts ·    │
│   reflection · deserialize · gradual `any`                       │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- Static typing's foundational claim is **soundness** — Milner's "well-typed programs don't go wrong," proved via **progress** (never stuck) and **preservation** (stays well-typed). The guarantee is **relative to the errors the system models**: sound is not correct, and a system that doesn't track `null`/bounds/division proves nothing about them.
- A useful checker is **sound but incomplete** by necessity (the question is undecidable). It **over-approximates conservatively**, rejecting some valid programs — that conservatism *is* the price of the guarantee, not a bug. Richer type features expand what the checker can *prove* safe without admitting unsafe programs.
- The unifying frame: **dynamic typing is a deferred, per-operation, *exact* check that only ever sees executed paths; static typing hoists that check to compile time, over all paths, where it must be *approximate*.** Earliness buys whole-program guarantees at the cost of conservatism; lateness buys exactness at the cost of "only the paths you ran are checked."
- **Erasure vs reification** decides what survives to runtime. Erased types (Java generics, TypeScript) cost nothing at runtime but disable `instanceof`/reflection on the parameter — and make gradual `any` boundaries leak **silently**, because there's no runtime tag to check. Reified types (Python values, Go reflection, C# generics) enable runtime introspection and dispatch at a memory/speed cost. **Dynamic typing requires reification by definition.**
- **Type inference** — culminating in **Hindley–Milner**, which finds the **principal (most general) type** with zero annotations and is sound+complete for its discipline — proves that *terseness is a property of inference, not of dynamic typing*. Subtyping languages can't use full HM and so combine local inference with signature annotations.
- Every "strong static" language ships **deliberate unsoundness holes** — array covariance, `null` in every reference type, unchecked casts, reflection, deserialization, and the gradual `any` — and these are *precisely* the places a program re-enters runtime type risk. A senior states the guarantee with its footnotes and quarantines every escape hatch behind a validated edge.

---

## What's Next

- `professional.md` — how these foundations cash out in **performance** (monomorphization, inline caches, hidden classes), the **empirical research** on whether static types reduce bugs, and migrating a large dynamic codebase to static checking.
- `interview.md` — soundness, erasure, inference, and gradual-boundary questions across difficulty bands.
- `tasks.md` — exercises that make soundness footnotes, erasure observability, and inference concrete.

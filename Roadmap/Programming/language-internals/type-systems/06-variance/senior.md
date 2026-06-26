# Variance — Senior Level

> **Topic:** [Variance](README.md)
> **Focus:** Declaration-site vs use-site variance, how a compiler *checks* variance soundly, and the precise reason mutable structures are forced to be invariant.

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

> Focus: **Where do you declare variance, and how does the compiler prove it's sound? The two design points — declaration-site and use-site — and the position-checking algorithm that backs them.**

A language designer who wants generics-with-subtyping must answer two questions: **where** does the programmer express variance, and **how** does the compiler ensure no unsound program type-checks? There are two coherent answers to "where," each with real engineering trade-offs:

- **Declaration-site variance** (Scala `+T`/`-T`, C# `out`/`in` on interfaces, Kotlin `out`/`in`): you annotate the type parameter *once, where the generic is defined*. The compiler then **verifies** that the parameter is only used in positions consistent with its declared variance, and from then on every *use* of the type automatically has that variance.
- **Use-site variance** (Java wildcards `? extends T`/`? super T`, C# array covariance): the generic itself is invariant; each *use site* opts into covariant or contravariant treatment with a wildcard. The same `List<T>` can be used covariantly (`List<? extends T>`) here and contravariantly (`List<? super T>`) there.

The "how" is one algorithm: **positional variance checking.** Every position in a type definition is classified as covariant, contravariant, or invariant (using sign multiplication from `middle.md`), and a type parameter declared `out` may only occur in covariant positions, `in` only in contravariant positions. This single check is what makes declaration-site variance sound, and understanding it tells you *exactly* why a mutable container — which exposes its parameter in both a read (covariant) and a write (contravariant) position — is forced to be invariant.

> 🎓 **Why this matters for a senior:** You design the generic APIs other teams build on. Choosing declaration-site vs use-site variance shapes how flexible and how readable your library is. And when the compiler rejects your `class Box<out T> { fun set(x: T) }`, you need to know it's not a bug — it's the position check catching genuine unsoundness, and you need to know how to restructure (split read/write interfaces, use `@UnsafeVariance`, or accept invariance).

This page covers both designs, the checking algorithm, the formal subtyping rule for a generic in terms of its variances, and the soundness theorem that variance preserves.

---

## Prerequisites

- **Required:** Function variance and "accept more, return less" from `middle.md`.
- **Required:** Per-position variance and the sign-multiplication rule for nested positions.
- **Required:** Java wildcards and PECS in practice.
- **Helpful:** Familiarity with at least one declaration-site language (Scala, Kotlin, or C#).
- **Helpful:** A mental model of how subtyping is checked structurally (the subtype judgment `S <: T`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Declaration-site variance** | Variance annotated once at the generic's definition (`class List<out T>`); verified by the compiler, applied at every use. |
| **Use-site variance** | Variance chosen at each use of an invariant generic, via wildcards (`List<? extends T>`). |
| **Variance annotation** | `+T`/`-T` (Scala), `out T`/`in T` (C#, Kotlin), or nothing (invariant). |
| **Positional check** | The compiler rule: an `out` parameter may appear only in covariant positions; `in` only in contravariant positions. |
| **Covariant position** | A spot in a type where, by sign multiplication, the enclosing variance is `+`: return types, immutable fields, `out` slots of nested generics. |
| **Contravariant position** | A spot with overall variance `−`: parameter types, `in` slots of nested generics. |
| **Bounded wildcard** | `? extends T` (upper bound, covariant use) or `? super T` (lower bound, contravariant use) in Java. |
| **Subtyping rule for generics** | `F<S> <: F<T>` holds depending on `F`'s declared variance and the relation between `S` and `T`. |
| **`@UnsafeVariance`** | A Kotlin annotation (Scala has `@uncheckedVariance`) that suppresses the position check at a single spot, asserting the programmer has reasoned about soundness manually. |
| **f-bounded / use-site capture** | Java's wildcard "capture" — the compiler introduces a fresh type variable for `?` so it can reason about an unknown-but-fixed element type. |
| **Soundness** | The property that a well-typed program never performs an operation its static type forbids (no `ClassCastException`/`ArrayStoreException` from type-correct code). |

---

## Core Concepts

### 1. The subtyping rule for a generic, given its variances

For a unary generic `F<T>` with declared variance `v`:

```text
v = covariant     (out, +):   S <: T   ⟹   F<S> <: F<T>
v = contravariant (in,  -):   S <: T   ⟹   F<T> <: F<S>
v = invariant     (0):        F<S> <: F<T>   only if   S = T
```

For a multi-parameter generic, apply this per parameter and require *all* of them simultaneously. So `Function<in A, out B>`: `Function<A1,B1> <: Function<A2,B2>` iff `A2 <: A1` (contravariant) **and** `B1 <: B2` (covariant) — exactly the function rule.

### 2. The positional check: how declaration-site variance stays sound

When you write `class Producer<out T>`, the compiler scans every position where `T` appears in the class body and demands each is a **covariant position**. Concretely:

- A method **return type** is covariant → `out T` allowed there.
- A method **parameter type** is contravariant → `out T` *forbidden* there.
- An *immutable* (`val`/`readonly`/`final`) field of type `T` is covariant (read-only) → allowed.
- A *mutable* (`var`) field of type `T` is both read (covariant) and written (contravariant) → **invariant position** → `out T` forbidden, `in T` forbidden — only an invariant parameter may sit there.

This is *the* mechanism. It is the formalization of the producer/consumer test. The compiler doesn't trust your intent; it proves the parameter only flows in the declared direction.

### 3. Why mutable containers are forced invariant — the proof

Take a mutable `Box<T>` with `fun get(): T` and `fun set(x: T)`.

- `get(): T` puts `T` in a **covariant** position. To declare `out T`, you'd need *only* covariant positions.
- `set(x: T)` puts `T` in a **contravariant** position. To declare `in T`, you'd need *only* contravariant positions.

`T` appears in both. By sign analysis it is in an **invariant** position. Therefore neither `out` nor `in` passes the positional check, and `Box<T>` is forced invariant. This is the rigorous version of "covariance + mutation = unsound." The array bug from `junior.md` is exactly the case of a language (Java arrays) that *skipped* this check and pushed the cost to a runtime `ArrayStoreException`.

### 4. Use-site variance: shift the choice to the caller

Java made generics invariant by default and gave callers wildcards to opt into variance per use:

- `List<? extends Animal>` — a covariant *view*. You may read `Animal`s; you may **not** call `add(x)` for any non-null `x`, because the compiler captured `?` as some unknown subtype of `Animal` and can't prove `x` matches it.
- `List<? super Cat>` — a contravariant *view*. You may `add(Cat)`; reads come out as `Object`, because all the compiler knows is "some supertype of `Cat`."

The brilliance is flexibility: one invariant `List<T>` serves both producer and consumer roles depending on the wildcard at the call site. The cost is verbosity and **wildcard capture** complexity — every `?` is a fresh, anonymous type variable the compiler juggles, which produces those infamous `capture#1 of ? extends Animal` error messages.

### 5. Declaration-site vs use-site — the engineering trade

| | Declaration-site | Use-site |
|---|---|---|
| **Where annotated** | Once, at definition | At every use |
| **Reader burden** | Low at call sites; variance is implicit and uniform | High; every signature repeats `? extends`/`? super` |
| **Author burden** | Must design the type to satisfy the position check | None up front; flexibility deferred |
| **Flexibility** | Fixed per type | Per use — same type, different variance at different sites |
| **Examples** | Scala, Kotlin, C# interfaces | Java generics, C# arrays |

Most modern languages (Scala, Kotlin, C#) favor declaration-site as the default and offer use-site as an escape hatch (Kotlin's `out`/`in` *projections*, C# can't easily). Java is the major use-site-only holdout for generics.

### 6. Variance and the `Comparable`/`Iterator`/`Function` standard library

The standard library is where these rules earn their keep:

- `Iterator<out T>` / `Iterator<? extends T>` — covariant; you only pull values.
- `Comparable<in T>` / `Comparator<? super T>` — contravariant; a comparator that orders `Animal`s can order `Cat`s, so a `Comparator<Animal>` should be accepted where a `Comparator<Cat>` is wanted. Generic bounds in `sort` are written `Comparator<? super T>` precisely for this.
- `Function<in A, out B>` — per-position: contravariant input, covariant output.
- `Supplier<out T>` / `Consumer<in T>` — the textbook producer and consumer.

When you see these `in`/`out`/`? super`/`? extends` decorations on the standard library, they are not decoration — they are the position check made visible.

### 7. Soundness: what variance buys and what it doesn't

The soundness guarantee is: a program that type-checks under the variance rules will never crash with a type error from a well-typed operation. Variance *preserves* the substitution guarantee of subtyping through type constructors. What it does **not** give you: it doesn't make *every* `F<S> <: F<T>` you might *want* legal — only the safe ones. And it says nothing about runtime semantics beyond type safety (no claims about nullability, side effects, etc.).

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Declaration-site variance** | A product is stamped "FOOD-SAFE" at the factory. Every shop that sells it inherits the certification — no per-shop paperwork. |
| **Use-site variance** | No factory stamp; instead each shop fills out a permit ("read-only access" or "write-only drop-off") for its particular counter. Flexible, but every counter needs its own form. |
| **Positional check** | A safety inspector who refuses to certify "outflow-only" plumbing if they find even one pipe wired for inflow. One bad position fails the whole certification. |
| **Mutable box forced invariant** | A turnstile that both lets people in *and* out can't be labeled "exit only" or "entry only" — it's genuinely bidirectional, so it gets the strict generic label. |
| **Wildcard capture** | A delivery slip that says "contents: some specific fruit, but we sealed the box before labeling." You can hand the box on (it's *some* fruit) but you can't add to it — you don't know which fruit it must be. |
| **`@UnsafeVariance`** | A manual override sticker on a fire door: "inspector waived this; engineer signed off personally." Use sparingly. |

---

## Mental Models

### The "Position Polarity" Model

Every spot a type parameter can appear has a polarity: `+` (output/covariant), `−` (input/contravariant), or `0` (both/invariant). Declaration-site variance is a *constraint solver*: `out T` demands all of `T`'s polarities are `+`, `in T` demands all are `−`. The compiler computes polarities by sign-multiplying through nesting and checks the constraint. Hold this picture and every variance error becomes "you used `out T` in a `−` position."

### The "Who Owns the Choice" Model

Declaration-site puts the variance choice in the **library author's** hands — decided once, for everyone. Use-site puts it in the **caller's** hands — decided per use. Neither is universally better: declaration-site optimizes for a type that has one natural role; use-site optimizes for a type used in many roles. Java's `List` is invariant because it has *both* roles, and wildcards let each caller pick.

### The "Read = Out, Write = In" Model

Strip every API to its data-flow direction. A method that returns `T` reads it out (covariant). A method that takes `T` writes it in (contravariant). A `var`/mutable field does both. The variance you may declare is the *intersection* of what every method permits — and the intersection of "out-only" and "in-only" is "invariant." This is why even one mutating method collapses the whole type to invariant.

---

## Code Examples

### Scala — declaration-site `+`/`-` and the position check

```scala
// Covariant: T only in OUTPUT positions
class ImmutableBox[+T](val value: T) {
  def get: T = value                       // covariant position: OK
  // def set(x: T): Unit = ???             // would NOT compile:
  //   "covariant type T occurs in contravariant position"
}

// Contravariant: T only in INPUT positions
trait Printer[-T] {
  def print(x: T): Unit                    // contravariant position: OK
  // def produce(): T                      // would NOT compile:
  //   "contravariant type T occurs in covariant position"
}

class Animal; class Cat extends Animal
val cats: ImmutableBox[Cat] = new ImmutableBox(new Cat)
val animals: ImmutableBox[Animal] = cats   // covariance: OK, sound (read-only)
```

The commented-out lines are *exactly* the compiler's position check firing.

### Scala — `@uncheckedVariance` escape hatch

```scala
import scala.annotation.unchecked.uncheckedVariance

// Asserts to the compiler: "I know T appears in a contravariant position here,
// but I've reasoned about soundness myself." Used in the stdlib for buffers.
trait Builder[+T] {
  def add(x: T @uncheckedVariance): Unit   // suppress the position error
}
```

This is the manual-override sticker. It is occasionally necessary (the Scala collections library uses it) but it shifts the soundness burden onto you.

### Kotlin — declaration-site plus use-site projections

```kotlin
// Declaration-site: Source is covariant, Sink is contravariant
interface Source<out T> { fun next(): T }
interface Sink<in T> { fun put(x: T) }

open class Animal; class Cat : Animal()

// USE-SITE projection: make an otherwise-invariant Array covariant for this parameter
fun copyOut(from: Array<out Animal>) {       // 'out' projection: read-only view
    for (a in from) println(a)
    // from[0] = Animal()  // ERROR: out-projected array can't be written
}

fun main() {
    val src: Source<Cat> = TODO()
    val animalSrc: Source<Animal> = src       // covariance from declaration-site

    val sink: Sink<Animal> = TODO()
    val catSink: Sink<Cat> = sink             // contravariance from declaration-site
}
```

Kotlin shows both designs in one language: `out`/`in` at the declaration, plus `out`/`in` *projections* at the use site for types (like `Array`) that are declared invariant.

### Java — use-site wildcards and capture

```java
import java.util.*;

// One invariant List<T>, two roles chosen at the use site:
static double sum(List<? extends Number> producers) {   // covariant view: read
    double total = 0;
    for (Number n : producers) total += n.doubleValue();
    // producers.add(1);  // ERROR: capture of ? extends Number — can't prove the element type
    return total;
}

static void fillWithZeros(List<? super Integer> consumers, int n) {  // contravariant view: write
    for (int i = 0; i < n; i++) consumers.add(0);
    // Integer x = consumers.get(0);  // ERROR: reads come out as Object
}
```

### C# — declaration-site on interfaces; arrays are use-site (and unsafe)

```csharp
interface IEnumerable<out T> { /* T only in output positions */ }
interface IComparer<in T> { int Compare(T a, T b); /* T only in input positions */ }

class Animal {}
class Cat : Animal {}

class Demo {
    static void M() {
        IEnumerable<Cat> cats = null;
        IEnumerable<Animal> animals = cats;   // covariant interface — sound

        // Arrays remain covariant (legacy, pre-generics) and UNSOUND:
        Cat[] catArray = new Cat[1];
        Animal[] animalArray = catArray;       // allowed
        // animalArray[0] = new Animal();       // throws ArrayTypeMismatchException at runtime
    }
}
```

C# is the cleanest illustration of the split: **interfaces** got sound declaration-site variance in 4.0, while **arrays** kept the old unsound use-site covariance for backward compatibility — and pay for it with a runtime `ArrayTypeMismatchException`.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Declaration-site** | Variance written once; call sites stay clean; uniform behavior. | Author must design types to pass the position check; can't vary per use. |
| **Use-site (wildcards)** | Same type used covariantly or contravariantly as needed; maximal per-call flexibility. | Verbose; wildcard capture produces baffling errors; repeated at every signature. |
| **Positional check** | Mechanically guarantees soundness; turns intent into a proof. | Rejects programs that are *actually* safe but that the check can't see (need `@uncheckedVariance`). |
| **Forced invariance of mutables** | Eliminates the array-bug class entirely for generics. | Forces wildcards/casts to pass `List<Cat>` where `List<Animal>` is wanted. |

---

## Use Cases

- **Designing a public collections / streams library.** Decide read-only vs read-write types and annotate covariance/contravariance so consumers get flexibility for free.
- **Modeling event systems.** `Source<out E>` and `Sink<in E>` interfaces let one broad source/sink serve many specific event types.
- **Comparator and ordering APIs.** Use `Comparator<? super T>` / `IComparer<in T>` so base-class comparators apply to subclasses.
- **Bridging to legacy arrays.** When you must accept arrays, know they're covariant-and-unsafe; prefer `List`/`IReadOnlyList` at API boundaries.
- **Generic algorithm signatures.** `copy(dest: List<? super T>, src: List<? extends T>)` and its declaration-site equivalents.

---

## Coding Patterns

### Pattern 1: Split a read/write type into producer + consumer interfaces

```kotlin
interface ReadOnly<out T> { fun get(i: Int): T }     // covariant
interface WriteOnly<in T> { fun set(i: Int, v: T) }  // contravariant
interface ReadWrite<T> : ReadOnly<T>, WriteOnly<T>   // invariant where you need both
```

The pair gives callers a covariant view, a contravariant view, and an invariant union — the most flexible design the position check allows.

### Pattern 2: Use-site projection to borrow variance from an invariant type

```kotlin
fun render(items: List<out Drawable>) { for (d in items) d.draw() }
// Caller may pass List<Button>, List<Label>, etc., without List being declared covariant.
```

### Pattern 3: PECS as the use-site form of producer/consumer

```java
static <T> void pipe(List<? extends T> src, List<? super T> dst) {
    for (T x : src) dst.add(x);
}
```

### Pattern 4: Reach for the escape hatch only with a written-down argument

When you must use `@uncheckedVariance`/`@UnsafeVariance`, write a comment proving the position is safe (e.g., "T only ever escapes after a defensive copy"). The compiler stops checking; your comment is the new proof.

---

## Best Practices

- **Default to declaration-site variance where your language offers it.** Annotate `out`/`in` on interfaces with a single clear role.
- **Design types so the position check passes naturally — split read and write.** If a type wants covariance but has a setter, that setter belongs on a separate invariant interface.
- **Treat a position-check error as a soundness warning, not a nuisance.** It is telling you the variance you asked for would let a wrong value through.
- **Use wildcards (`? extends`/`? super`) in *public* Java signatures, not internal ones.** Flexibility belongs at the API boundary; internal code can stay concrete.
- **Avoid the escape hatch unless you can write the soundness argument.** `@uncheckedVariance`/`@UnsafeVariance` moves the proof obligation to you.
- **Prefer `IReadOnlyList<out T>`/`List` over arrays at boundaries.** Arrays' legacy covariance is a runtime hazard; the generic alternatives are sound.
- **Document the variance intent of each type parameter.** Future maintainers shouldn't have to re-derive whether `T` is produced or consumed.

---

## Edge Cases & Pitfalls

- **A single mutating method collapses the type to invariant.** Add one `set(T)` to a covariant type and the position check fails. Move it to a separate interface or accept invariance.
- **Wildcard capture errors are about an *unknown but fixed* type.** `List<? extends Animal>.add(cat)` fails not because cats aren't animals but because the compiler captured `?` as "some specific unknown subtype of Animal" and can't prove `cat` matches it.
- **`@uncheckedVariance`/`@UnsafeVariance` silences the check, not the danger.** Scala's mutable collections use it correctly; misuse reintroduces the array bug under a different name.
- **C# generic *delegates* and *interfaces* support declaration-site variance; classes do not.** You can't write `class Box<out T>` in C#. Use an interface.
- **Java has no declaration-site variance at all.** Every `List<T>` is invariant; you *must* use wildcards. Code ported from Kotlin/Scala loses its declaration-site annotations.
- **Variance interacts with nullability and bounds.** `out T` with a lower-bounded use, or `T : Comparable<T>` f-bounds, can produce surprising "out-projected type ... cannot be used" errors. Read the capture in the message.
- **Out-projection makes a parameter read-only even for `var`.** Kotlin's `Array<out T>` forbids writes; people expect `out` to mean "covariant and still writable" — it can't, by the position check.
- **Star projection (`List<*>`) is not the same as `List<Any?>`.** `*` means "some unknown type argument," producing an out-projected read view, not the top type.

---

## Test Yourself

1. State the subtyping rule for `F<S>` vs `F<T>` for each of covariant, contravariant, and invariant `F`.
2. Walk through the positional check for `class Box<out T> { fun get(): T; fun set(x: T) }`. Which method fails and what is the exact reason?
3. Explain why use-site variance lets a *single* `List<T>` be used both covariantly and contravariantly, while declaration-site fixes the variance per type.
4. Why can you not call `add(x)` (for non-null `x`) on a `List<? extends Animal>`? Answer in terms of wildcard capture, not "cats aren't animals."
5. C# arrays are covariant but C# generic interfaces with `out` are also covariant — yet only one throws at runtime. What's the difference, and what's the runtime exception's name?
6. When is `@uncheckedVariance`/`@UnsafeVariance` justified? What obligation does it transfer to the programmer?
7. Sign-multiply to determine the legal declaration-site variance of `T` in `interface F<T> { fun h(g: (T) -> Unit) }`. (Hint: a callback consuming `T`, passed *into* a method.)

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│        DECLARATION-SITE vs USE-SITE VARIANCE                     │
├──────────────────────────────────────────────────────────────────┤
│ DECLARATION-SITE  annotate once at definition; compiler verifies │
│   Scala  class C[+T] / [-T]                                       │
│   Kotlin/C# interface C<out T> / <in T>                           │
│   position check: out -> only covariant spots                    │
│                   in  -> only contravariant spots                │
│                                                                   │
│ USE-SITE          invariant type; caller opts in per use         │
│   Java   List<? extends T> (cov) | List<? super T> (contra)      │
│   Kotlin Array<out T> / Array<in T>  (projections)               │
│   C#     arrays (legacy, UNSOUND)                                │
├──────────────────────────────────────────────────────────────────┤
│ SUBTYPING RULE                                                   │
│   cov:     S<:T  =>  F<S> <: F<T>                                │
│   contra:  S<:T  =>  F<T> <: F<S>                                │
│   inv:     F<S> <: F<T>  iff  S = T                              │
├──────────────────────────────────────────────────────────────────┤
│ POSITION POLARITY (sign-multiply through nesting)                │
│   return type / immutable field / out-slot   -> +  (covariant)   │
│   param type / in-slot                       -> -  (contra)      │
│   mutable (var) field                        -> 0  (invariant)   │
│   => any mutating method forces INVARIANT                        │
├──────────────────────────────────────────────────────────────────┤
│ ESCAPE HATCH (you now own the soundness proof)                   │
│   Scala  @uncheckedVariance   Kotlin  @UnsafeVariance            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A language expresses variance at one of two sites. **Declaration-site** (Scala `+`/`-`, Kotlin/C# `out`/`in`) annotates the type parameter once at definition; the compiler verifies it and applies it at every use. **Use-site** (Java wildcards, C# arrays) keeps the generic invariant and lets each caller opt into covariant/contravariant treatment.
- The soundness machinery is the **positional check**: an `out` parameter may appear only in covariant positions, `in` only in contravariant positions, where each position's polarity is computed by sign-multiplying through nesting. This is the producer/consumer test turned into a proof.
- That check **forces mutable containers to be invariant**: a getter puts `T` in a covariant position and a setter puts it in a contravariant position, so `T` is invariant overall — neither `out` nor `in` is allowed. This is the rigorous form of "covariance + mutation = unsound," and it's exactly the check Java arrays skip (paying with a runtime `ArrayStoreException`).
- The **subtyping rule** for a generic follows directly from its variances, per parameter; `Function<in A, out B>` recovers the function rule, `Iterator<out T>`/`Comparator<? super T>` recover the standard-library shapes.
- **Use-site variance** trades verbosity and wildcard-capture complexity for the flexibility of using one type in multiple roles; **declaration-site** trades that flexibility for clean, uniform call sites. Modern languages default to declaration-site and offer use-site projections as an escape hatch.
- The **escape hatches** (`@uncheckedVariance`, `@UnsafeVariance`) suppress the position check at a single spot and transfer the soundness proof to the programmer — necessary occasionally (Scala collections), dangerous when misused.
- The recurring design pattern is to **split a read/write type into a covariant producer interface and a contravariant consumer interface**, with an invariant union where both are needed. `professional.md` takes these rules into the field — array holes, TypeScript's bivariant methods, and the real engineering signatures that depend on getting variance right.

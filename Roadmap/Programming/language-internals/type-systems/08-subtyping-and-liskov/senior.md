# Subtyping & Liskov Substitution — Senior Level

> **Topic:** [Subtyping & Liskov Substitution](README.md)
> **Focus:** The type-theory of subtyping — the subsumption judgment, variance as the formal core of LSP, declaration-site vs use-site variance, why arrays are unsoundly covariant, and where nominal and structural subtyping really diverge.

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
13. [Summary](#summary)

---

## Introduction

> Focus: **What are the formal rules that *define* `S <: T`?** And **why is variance — not inheritance — the deepest expression of the Liskov Substitution Principle?**

At the middle level, LSP became four concrete rules and we saw that two of them line up with variance. At the senior level we close the loop: subtyping is a **formal relation defined by inference rules**, the subsumption rule is the bridge between it and type-checking, and **variance is LSP lifted from values to type constructors**. When you understand variance properly, every behavioral LSP rule falls out of it as a special case — the behavioral notion and the type-theoretic notion are the same theorem stated in two vocabularies.

The senior insight is this: *LSP is not an OO design tip; it is the soundness condition for subtype polymorphism.* A type system with subtyping is sound exactly when "if `S <: T` then an `S` is safely usable as a `T`" — and that is LSP, by definition. The four behavioral rules are the consequences of that soundness condition applied to method contracts. Variance annotations (`out`/`in` in C#, `+`/`-` in Scala, `extends`/`super` wildcards in Java) are the *type-system's* way of letting the programmer assert and the compiler verify LSP-preserving relationships between *parameterized* types.

This level also confronts the places where mainstream languages **deliberately break LSP in their own type systems** — Java/C# covariant arrays are the famous unsound choice — and explains *why* (historical, pre-generics expedience) and what it costs (a runtime check, `ArrayStoreException`). We'll formalize nominal vs structural subtyping, look at the subsumption typing rule, contrast declaration-site and use-site variance, and connect all of it back to the substitution principle that names the topic.

> 🎓 **Why this matters at the senior level:** You will design APIs whose subtyping and variance choices ripple through every consumer for years. Getting `List<? extends T>` vs `List<? super T>` right, deciding whether your `Repository<T>` should be covariant, knowing that an immutable container *can* be covariant while a mutable one *cannot* — these are LSP decisions encoded in the type system, and getting them wrong either over-constrains your users or ships an unsound API.

This page covers: the subtyping relation as inference rules, the subsumption typing rule, variance of every common type constructor, declaration-site vs use-site variance, the array unsoundness, nominal vs structural subtyping formally, and bounded/recursive subtyping in brief. `professional.md` turns this theory toward real library and API design and the engineering war stories.

---

## Prerequisites

What you should know before reading this:

- **Required:** Everything in `middle.md` — the four LSP rules, function-type subtyping, record width/depth, covariant returns.
- **Required:** Comfort reading generic/parameterized types and bounded type parameters (`<T extends Number>`).
- **Required:** Familiarity with at least one language with explicit variance: Scala (`+T`/`-T`), C# (`out`/`in`), or Java wildcards (`? extends`/`? super`).
- **Helpful but not required:** Some exposure to typing judgments (`Γ ⊢ e : T`) and inference-rule notation.
- **Helpful but not required:** Awareness of generics erasure vs reification.

You do **not** need to know:

- Higher-kinded types or type-constructor polymorphism in depth.
- Full subtyping algorithms for recursive types (coinductive checking) — mentioned only.
- Dependent types or refinement types.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Subtyping relation `<:`** | A reflexive, transitive relation on types defined by inference rules; `S <: T` means an `S` value is usable as a `T`. |
| **Subsumption rule** | The typing rule `Γ ⊢ e : S, S <: T ⟹ Γ ⊢ e : T` — lets a value of a subtype be typed at the supertype. |
| **Variance** | How subtyping of type arguments lifts to subtyping of a parameterized type. Covariant, contravariant, or invariant. |
| **Covariance** | `S <: T ⟹ F<S> <: F<T>`. Output positions (returns, read-only fields, producers). C#/Kotlin `out`, Scala `+`. |
| **Contravariance** | `S <: T ⟹ F<T> <: F<S>`. Input positions (parameters, consumers). C#/Kotlin `in`, Scala `-`. |
| **Invariance** | Neither: `F<S>` and `F<T>` are unrelated unless `S = T`. Mutable containers must be invariant. |
| **Declaration-site variance** | Variance fixed where the type is *defined* (`interface List<out T>` in Kotlin/C#, `class List[+T]` in Scala). |
| **Use-site variance** | Variance chosen where the type is *used* (Java wildcards: `List<? extends T>`, `List<? super T>`). |
| **PECS** | "Producer Extends, Consumer Super" — Java's mnemonic: read-source ⇒ `? extends`, write-sink ⇒ `? super`. |
| **Nominal subtyping** | `S <: T` holds iff explicitly declared (`extends`/`implements`). Identity by name. |
| **Structural subtyping** | `S <: T` holds iff `S`'s structure includes `T`'s. Identity by shape. |
| **Bounded quantification** | Generics constrained by a subtype bound: `<T extends Comparable<T>>`. |
| **F-bounded polymorphism** | A bound that mentions the type variable itself: `T extends Comparable<T>`. |
| **Top / Bottom type** | Top (`Object`, `any`, `Any`) is a supertype of all; Bottom (`Nothing`, `never`) a subtype of all. |
| **Soundness** | The property that a well-typed program "can't go wrong" — the very thing LSP guarantees for subtyping. |

---

## Core Concepts

### 1. Subtyping as a Formal Relation

`<:` is defined by inference rules. The structural ones every type system shares:

```text
            S <: T   T <: U                       (reflexivity)
(trans)  ───────────────────         (refl)   ─────────────
                S <: U                              T <: T
```

Then per-constructor rules. The function rule is the canonical one and the home of variance:

```text
        T1 <: S1        S2 <: T2
(→)  ─────────────────────────────────
        S1 → S2   <:   T1 → T2
```

Read the hypotheses: the *argument* type flips (`T1 <: S1` — contravariant), the *result* type stays the same direction (`S2 <: T2` — covariant). This single rule *is* the middle-level "contravariant parameters, covariant returns," now stated as a typing judgment. The whole point of the rule is to guarantee LSP: if `S1 → S2 <: T1 → T2`, then the function can be used wherever a `T1 → T2` is expected.

### 2. The Subsumption Rule Is the Bridge

Subtyping only *does* anything because of one typing rule:

```text
        Γ ⊢ e : S        S <: T
(sub)  ──────────────────────────
              Γ ⊢ e : T
```

This says: if `e` has type `S` and `S <: T`, then `e` *also* has type `T`. This is what lets you pass a `Dog` to a function expecting an `Animal` — the type checker *subsumes* the `Dog`'s type up to `Animal`. Every act of "using a subtype where a supertype is expected" is an application of `(sub)`. LSP is the *semantic* promise that this *syntactic* rule is safe: the program won't go wrong when you do it. A type system is **sound** precisely when subsumption never lets a value be used in a way it can't actually support — which is LSP, formalized.

### 3. Variance Is LSP for Type Constructors

A type constructor `F<·>` (like `List<·>`, `Func<·>`, `Box<·>`) takes a type and produces a type. The question variance answers: *given `S <: T`, what is the relationship between `F<S>` and `F<T>`?*

- **Covariant** (`F<+T>`): `S <: T ⟹ F<S> <: F<T>`. Safe when `T` appears only in **output** positions — return types, read-only fields. A `Producer<Dog>` is safely a `Producer<Animal>`: every dog it produces is an animal.
- **Contravariant** (`F<-T>`): `S <: T ⟹ F<T> <: F<S>`. Safe when `T` appears only in **input** positions — parameters, write-only sinks. A `Consumer<Animal>` is safely a `Consumer<Dog>`: something that eats any animal will eat a dog.
- **Invariant**: `T` appears in **both** input and output positions (a mutable container's `get` and `set`). Then *neither* direction is safe, so `F<S>` and `F<T>` are unrelated.

This is the deepest statement of LSP available: **variance is the rule that decides when a parameterized subtype is substitutable for a parameterized supertype.** The behavioral four-rules of the middle level are this rule specialized to method contracts (a method's parameters are input positions ⇒ contravariant ⇒ "don't strengthen preconditions"; a method's return is an output position ⇒ covariant ⇒ "don't weaken postconditions").

### 4. Why Mutable Containers Must Be Invariant (and Arrays Lie)

Consider why `List<Dog>` is *not* a subtype of `List<Animal>` in a sound system. Suppose it were. Then:

```text
List<Dog> dogs = ...;
List<Animal> animals = dogs;     // if List were covariant
animals.add(new Cat());          // type-checks: Cat is an Animal
Dog d = dogs.get(0);             // 💥 might be the Cat — type hole!
```

The `add` (input position) wants contravariance; the `get` (output position) wants covariance. A mutable list uses `T` in both, so it must be **invariant**. This is exactly why Java generics are invariant by default and why Scala's `class List[+T]` is *immutable*.

Now the famous lie: **Java and C# arrays are covariant** — `Dog[] <: Animal[]` holds. This is **unsound**, and the languages "patch" the hole with a *runtime* check:

```java
Dog[] dogs = new Dog[3];
Object[] objs = dogs;          // covariant — compiles
objs[0] = new Cat();           // compiles (Cat is Object)... 💥 ArrayStoreException at runtime
```

The static type system permits the unsafe assignment; the JVM inserts a runtime store check to catch it. This was a deliberate 1995 decision (Java had no generics, and covariant arrays let `sort(Object[])` work on any array). It is the canonical example of a language *knowingly violating LSP in its own type system* and paying for it with a runtime check on every array store.

### 5. Declaration-Site vs Use-Site Variance

Two designs for letting programmers express variance:

**Declaration-site** (Scala, C#, Kotlin): variance is fixed where the type is *defined*. `interface IEnumerable<out T>` in C# is covariant *everywhere it's used*. Cleaner for users; requires the designer to commit, and the compiler verifies that `T` only appears in legal positions for that variance.

```scala
trait Producer[+T] { def get(): T }            // covariant — T only in output
trait Consumer[-T] { def put(t: T): Unit }      // contravariant — T only in input
```

**Use-site** (Java wildcards): the *user* picks variance per use:

```java
List<? extends Number> producers;   // covariant view: can read Number, cannot add
List<? super Integer>  consumers;   // contravariant view: can add Integer, read only Object
```

Java's mnemonic is **PECS — Producer Extends, Consumer Super**. If you only *read* from a structure, it's a producer ⇒ `? extends`. If you only *write* to it, it's a consumer ⇒ `? super`. The wildcard is literally LSP applied at the call site: `? extends T` gives you a covariant (read-safe) view; `? super T` a contravariant (write-safe) view.

### 6. Nominal vs Structural, Formally

- **Nominal**: `S <: T` iff there's a declared chain `S extends/implements ... T`. The relation is a fixed DAG given by declarations. Java, C#, C++, Scala. Advantages: intentional (you can't be a subtype by accident), supports sealed hierarchies, names carry semantic intent. Disadvantage: can't retrofit a subtype relationship onto types you don't own.
- **Structural**: `S <: T` iff `S`'s members include `T`'s members with compatible (variance-respecting) types. TypeScript, Go interfaces, OCaml object types. Advantages: duck typing, retroactive conformance, fits gradual typing. Disadvantage: *accidental* conformance — a type can satisfy an interface by coincidence and then violate the unwritten behavioral contract (structural typing checks shape, never semantics — the behavioral LSP gap is *wider* here).

Both are *type-level* subtyping. Neither checks the *behavioral* contract — that's still LSP's domain and still has no compiler. (The nominal-vs-structural distinction has its own dedicated topic in this section; the link to it is in prose only by request.)

### 7. Bounded and Recursive Subtyping (Briefly)

**Bounded quantification** lets a generic constrain its parameter via subtyping: `<T extends Comparable<T>>`. **F-bounded polymorphism** is the recursive case where the bound mentions `T` itself — common for self-referential APIs (`Enum<E extends Enum<E>>`, fluent builders `Builder<B extends Builder<B>>`). These let subtyping and genericity interact: a method `<T extends Animal> void feed(List<T>)` accepts `List<Dog>`, `List<Cat>`, etc., recovering covariance-like flexibility without making `List` itself covariant.

---

## Real-World Analogies

**The one-way valve.** Covariance and contravariance are about which way data flows. A *producer* is a faucet — data flows out — and a faucet of dog-water can stand in for a faucet of animal-water (covariant). A *consumer* is a drain — data flows in — and a drain that accepts any animal can stand in for a drain that accepts dogs (contravariant). A *pipe with flow both ways* (mutable container) can't substitute in either direction; it must match exactly (invariant).

**The unsound shortcut with a safety net.** Covariant arrays are like a building with a fire door propped open for convenience (the static type system lets the unsafe assignment through) but with a guard posted who tackles anyone who actually walks through wrong (`ArrayStoreException`). It works, but you've moved a compile-time guarantee into a runtime cost on every pass.

**Declaration-site as factory labeling vs use-site as buyer's choice.** Declaration-site variance is the manufacturer stamping "read-only" on the product for everyone. Use-site variance (wildcards) is the buyer deciding, per purchase, "I'll treat this one as read-only" — more flexible, more verbose, more chances to choose wrong.

**The passport (nominal) vs the costume (structural).** Nominal subtyping is a passport: you *are* a citizen because a registry says so. Structural subtyping is a costume: you're treated as a guard because you're *dressed* like one. The costume is convenient and retrofittable, but it lets impostors through — a type that *looks* right but doesn't *behave* right.

---

## Mental Models

**Model 1 — "Variance follows the data flow."** To decide a type parameter's variance, ask: does `T` come *out* (covariant), go *in* (contravariant), or both (invariant)? Output ⇒ `out`/`+`/`extends`. Input ⇒ `in`/`-`/`super`. Both ⇒ invariant. This single rule subsumes function variance, array safety, and PECS.

**Model 2 — "Subsumption is the only door; variance is who's allowed through it carrying boxes."** `(sub)` is the rule that lets any subtype pass as a supertype. Variance extends that permission to *parameterized* types, and only when the data-flow direction makes it safe. LSP is the guarantee that everyone who passes through the door can actually do the supertype's job.

**Model 3 — "LSP is soundness; the four rules are corollaries."** Don't think of LSP as advice and variance as theory. LSP *is* the soundness condition for subtype polymorphism. The behavioral rules (preconditions/postconditions/invariants/history) are what soundness *requires* of method contracts. Variance is what soundness *requires* of type constructors. One principle, two surfaces.

**Model 4 — "Mutability is the enemy of variance."** Every time you want a container to be covariant or contravariant and the compiler refuses, the culprit is a method that uses `T` in the *other* direction. Make the container immutable (or split read/write interfaces) and the variance you want becomes sound.

**Model 5 — "Structural typing widens the behavioral gap."** Nominal subtyping at least forces an *intentional* declaration, a hook for the author to consider the contract. Structural subtyping grants the type-level relation automatically, so the behavioral (LSP) obligation is entirely on discipline — there isn't even a declaration site to attach intent to.

---

## Code Examples

### Example 1: Variance verified at the declaration site (Scala)

```scala
// Covariant: T only appears in output position (return of get) — compiler accepts +T.
trait Source[+T] { def get(): T }
val dogs: Source[Dog]   = ...
val animals: Source[Animal] = dogs        // ✓ Source[Dog] <: Source[Animal]

// Contravariant: T only in input position — compiler accepts -T.
trait Sink[-T] { def put(t: T): Unit }
val animalSink: Sink[Animal] = ...
val dogSink: Sink[Dog] = animalSink        // ✓ Sink[Animal] <: Sink[Dog]

// Invariant by necessity: T in BOTH positions — +T or -T would fail to compile.
trait Cell[T] { def get(): T; def set(t: T): Unit }
```

If you tried `trait Cell[+T]`, the compiler rejects it: `set(t: T)` is a contravariant (input) use of a covariant parameter — a direct LSP soundness check, enforced at definition time.

### Example 2: PECS in Java — use-site variance as LSP at the call site

```java
// Producer: we only READ Numbers out — use ? extends (covariant view).
static double sum(List<? extends Number> src) {
    double total = 0;
    for (Number n : src) total += n.doubleValue();   // read ok
    // src.add(1);  // ✗ compile error: can't write through a producer view
    return total;
}

// Consumer: we only WRITE Integers in — use ? super (contravariant view).
static void fillWithZeros(List<? super Integer> dst, int count) {
    for (int i = 0; i < count; i++) dst.add(0);       // write ok
    // Integer x = dst.get(0);  // ✗ can only read as Object through a consumer view
}

sum(List.of(1, 2, 3));            // List<Integer> as List<? extends Number>  ✓
fillWithZeros(new ArrayList<Number>(), 3);  // List<Number> as List<? super Integer>  ✓
```

`? extends` recovers covariance for reads; `? super` recovers contravariance for writes — both are LSP-preserving views carved out of an otherwise invariant `List`.

### Example 3: The covariant-array unsoundness, demonstrated

```java
Integer[] ints = new Integer[3];
Number[]  nums = ints;            // ✓ compiles: arrays are covariant (Integer[] <: Number[])
nums[0] = 3.14;                   // ✓ compiles: Double is a Number
// 💥 java.lang.ArrayStoreException at runtime
```

The static type system permits an assignment that violates LSP (an `Integer[]` cannot actually hold a `Double`); the JVM inserts a per-store runtime type check to preserve memory safety. Generics fixed this by being invariant — `List<Integer>` is *not* a `List<Number>`, so the same mistake is a compile error.

### Example 4: Declaration-site variance in C#

```csharp
public interface IEnumerable<out T> { IEnumerator<T> GetEnumerator(); }  // covariant
public interface IComparer<in T>    { int Compare(T a, T b); }            // contravariant

IEnumerable<Dog>    dogs    = new List<Dog>();
IEnumerable<Animal> animals = dogs;       // ✓ out T: covariance

IComparer<Animal> byName = ...;
IComparer<Dog>    dogCmp  = byName;        // ✓ in T: contravariance (an animal-comparer compares dogs)
```

The `out`/`in` annotations let the compiler *prove* substitutability once, at the interface, for all consumers.

### Example 5: F-bounded polymorphism recovering flexibility

```java
// Self-referential bound: every Enum subtype compares only to its own kind.
abstract class Enum<E extends Enum<E>> implements Comparable<E> { /* ... */ }

// Generic method gives "covariance for this call" without making List covariant:
static <T extends Shape> double totalArea(List<T> shapes) {
    return shapes.stream().mapToDouble(Shape::area).sum();
}
totalArea(new ArrayList<Circle>());   // ✓ List<Circle> accepted via the bound
```

---

## Pros & Cons

**Pros of the type-theoretic view:**

- **One principle explains everything.** Function variance, PECS, array safety, immutable-container covariance, and the four behavioral rules are all the same soundness condition.
- **Predictable API design.** Knowing data-flow ⇒ variance lets you choose `out`/`in`/invariant correctly the first time.
- **Compiler-verified LSP for type constructors.** Declaration-site variance turns a behavioral discipline into a checked property *for the parameterized part* of the design.
- **Names the language's own sins.** You can articulate exactly why covariant arrays are unsound and what they cost.

**Cons / costs:**

- **Variance is genuinely hard for users.** Wildcards (`? extends`/`? super`) are a notorious source of confusion and verbose signatures.
- **It only covers the type-level half.** Even perfect variance doesn't enforce behavioral LSP (an `IEnumerable<Dog>` can still lie about its elements).
- **Language inconsistency.** Arrays vs generics, Java's invariant method parameters, site-vs-declaration differences — the theory is clean, the languages are not.
- **Over-constraining is easy.** Declaring a type invariant when it could be covariant needlessly limits your users; getting it wrong the other way is unsound.

---

## Use Cases

- **Designing a generic library API.** Decide each type parameter's variance from its data-flow before publishing — it's a breaking change to alter later.
- **Read/write interface separation.** Expose `IReadOnlyList<out T>` (covariant) separately from `IList<T>` (invariant) so consumers get the most substitutable view that's still sound.
- **Functional callbacks and event systems.** Function/delegate variance decides which handlers are interchangeable — `Action<in T>`/`Func<out T>` in C#, function-type subtyping in TS/Scala.
- **Comparator and consumer plumbing.** PECS-style signatures (`Comparator<? super T>`, `Consumer<? super T>`) maximize the inputs a method accepts without sacrificing soundness.
- **Auditing a hierarchy for soundness.** Spot where a "subtype" uses a parameter in the wrong-variance position — that's the LSP break the compiler can't see for behavior but variance can for types.

---

## Coding Patterns

**Pattern 1 — Derive variance from positions, then annotate.** For each type parameter, classify every occurrence as input or output. All-output ⇒ covariant. All-input ⇒ contravariant. Mixed ⇒ invariant (or split the type).

**Pattern 2 — Split mutable types into covariant read + invariant write.** The standard trick to get covariance you couldn't otherwise have:

```kotlin
interface Source<out T> { fun get(): T }            // covariant
interface Sink<in T>    { fun put(t: T) }            // contravariant
interface Cell<T> : Source<T>, Sink<T>              // invariant where both are needed
```

**Pattern 3 — Apply PECS at every generic method boundary.** Parameters you only read from: `? extends`. Parameters you only write to: `? super`. This maximizes the LSP-valid set of arguments callers can pass.

**Pattern 4 — Prefer generic methods over covariant containers.** A bounded type parameter (`<T extends Shape>`) often gives the flexibility you wanted from covariance, soundly, without committing the container itself.

---

## Best Practices

- **Make containers immutable if you want them covariant.** Mutability forces invariance; immutability frees variance. This is the single most useful LSP-and-variance design lever.
- **Annotate variance at declaration when your language supports it.** It documents and *proves* the substitutability contract once, for all users, instead of pushing wildcard noise onto every call site.
- **Use PECS deliberately in Java APIs**, even though it's verbose — it widens what callers can pass and is itself LSP applied per-use.
- **Never rely on array covariance.** Treat `Object[]` parameters as a legacy hazard; prefer `List<? extends T>` which is statically sound.
- **Remember variance is only half of LSP.** The compiler proves the type-constructor relationship; you still owe the *behavioral* contract (the four rules) for the values themselves.
- **In structural-typing languages, write the behavioral contract down explicitly** — there's no declaration site to carry intent, so accidental conformance is a live risk.

---

## Edge Cases & Pitfalls

- **The unsound array trap in disguise.** Generic varargs, reflection, and legacy `Object[]` APIs reintroduce array covariance — and `ArrayStoreException` — into otherwise generic code.
- **Variance position violations the compiler reports cryptically.** "Covariant type parameter T occurs in contravariant position" means you used a `+T` parameter as a method *input*. The fix is usually a lower-bounded method generic (`def put[U >: T](u: U)` in Scala).
- **Wildcard capture confusion.** `List<?>` (unbounded) lets you read `Object` and write nothing but `null`; programmers expect to be able to copy within it and can't without a capture helper method.
- **Site-vs-declaration mismatch when porting.** Code translated from Scala/C# (declaration-site) to Java (use-site) must re-express variance as wildcards at every use, and vice versa — a common porting bug.
- **Top/Bottom edge cases.** `Nothing`/`never` (bottom) is a subtype of everything, so a function returning `never` is a subtype of any return type — handy for throwers, surprising in inference.
- **Structural accidental conformance.** In Go/TS, a type can satisfy an interface because two unrelated methods happen to share a name and signature, then violate the unwritten behavioral contract — a pure-LSP break the type checker is blind to.
- **Self-bounds that leak.** F-bounded `Builder<B extends Builder<B>>` works until a subclass forgets to re-parameterize `B`, at which point fluent chains return the wrong static type — a subtle substitutability defect.

---

## Summary

- **Subtyping is a formal relation** defined by reflexivity, transitivity, and per-constructor rules; the **function rule** (`T1 <: S1, S2 <: T2 ⟹ S1→S2 <: T1→T2`) encodes contravariant parameters and covariant returns.
- The **subsumption rule** (`e : S, S <: T ⟹ e : T`) is the bridge that makes subtyping usable, and **LSP is the soundness guarantee** that subsumption is safe.
- **Variance is LSP for type constructors.** Output positions ⇒ **covariant** (`out`/`+`/`? extends`), input positions ⇒ **contravariant** (`in`/`-`/`? super`), both ⇒ **invariant**. Mutable containers are invariant by necessity.
- **Java/C# arrays are covariant and therefore unsound**, patched with a runtime `ArrayStoreException` — the textbook case of a language breaking LSP in its own type system; **generics fixed it by being invariant**.
- **Declaration-site variance** (Scala/C#/Kotlin) fixes variance at the type definition and verifies it; **use-site variance** (Java wildcards, **PECS** — Producer Extends, Consumer Super) chooses it per use.
- **Nominal** subtyping is by declaration (intentional, no accidents); **structural** is by shape (retrofittable, but *widens* the behavioral-contract gap LSP must still close by discipline).
- Variance and subsumption cover the **type-level** half of LSP; the **behavioral** half (preconditions/postconditions/invariants/history) still has no compiler and remains the engineer's responsibility.

Move on to `professional.md` for how these choices play out in real library and API design — the war stories, the migration costs, and the judgment calls that decide whether an LSP-shaped abstraction helps or hurts in production.

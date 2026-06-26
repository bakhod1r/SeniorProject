# Variance — Professional Level

> **Topic:** [Variance](README.md)
> **Focus:** The unsound holes shipped in real languages (Java/C# arrays, TypeScript bivariant method parameters), why they exist, and how a working engineer designs around them.

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

> Focus: **Real languages ship known unsoundness on purpose. Knowing *which* holes exist, *why* the designers chose them, and *how* to engineer safely around them is what separates a professional from someone who just knows the textbook rules.**

The previous levels built the ideal: variance rules that, checked properly, give soundness. Production languages deviate from the ideal deliberately, trading soundness for ergonomics, backward compatibility, or developer productivity. A professional must know exactly where the deviations are because they manifest as production crashes, not compile errors:

- **Java and C# arrays are covariant** — the original sin. `Object[] a = new String[1]; a[0] = 42;` compiles and throws at runtime. Chosen in 1995 (before generics existed) so that generic-ish code like `Arrays.sort(Object[])` could work on any array. The cost: every array store carries a runtime type check and can throw `ArrayStoreException` / `ArrayTypeMismatchException`.
- **TypeScript method parameters are bivariant by default** — `strictFunctionTypes` makes standalone *function-typed* parameters contravariant (sound), but leaves *method* parameters bivariant for pragmatic reasons (mainly so that event-handler and array-method patterns type-check the way developers expect). This is a documented, intentional unsoundness.
- **Covariant generics with mutation via casts.** Even invariant-by-default languages let you cast your way into the array bug.

This page is the field guide: the exact reproductions, the design rationale, and the patterns professionals use — defensive immutability, read-only interfaces at boundaries, `strictFunctionTypes`, and treating arrays as a known hazard. We'll also walk concrete engineering signatures (`Collections.copy`, contravariant comparators, callback sinks) where getting variance right is the difference between an API that composes and one that fights its callers.

> 🎓 **Why this matters for a professional:** You review APIs and diagnose production incidents. An `ArrayStoreException` in a logs aggregator, an `InvalidCastException` from a covariant interface misuse, a TypeScript callback that silently receives the wrong shape — these are variance failures wearing different masks. Recognizing the variance root cause turns a multi-hour debug into a one-line fix.

---

## Prerequisites

- **Required:** Declaration-site vs use-site variance and the positional check from `senior.md`.
- **Required:** Function variance ("accept more, return less") and the array-covariance bug.
- **Required:** Hands-on experience with at least two of: Java generics, C# variance, TypeScript, Scala/Kotlin.
- **Helpful:** Having debugged a real `ArrayStoreException` or `ClassCastException` whose root cause was variance.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`ArrayStoreException`** | JVM runtime exception thrown when storing an element whose type isn't assignable to the array's actual element type. The cost of covariant arrays. |
| **`ArrayTypeMismatchException`** | The .NET equivalent of `ArrayStoreException`. |
| **`strictFunctionTypes`** | TypeScript compiler flag that makes standalone function-typed parameters checked contravariantly (sound) instead of bivariantly. |
| **Bivariant method parameters** | TypeScript's default for *method* (vs standalone function) parameters: assignable in both directions, intentionally unsound. |
| **Defensive copy** | Returning/storing a copy so internal mutable state can't be aliased and mutated through a covariant view. |
| **Read-only interface** | An interface exposing only producers (`IReadOnlyList<out T>`, `ReadonlyArray<T>`), safely covariant. |
| **Soundness hole** | A place where a type-correct program can still fail with a type error at runtime. |
| **Variance erasure** | The fact that the JVM/CLR don't carry generic variance at runtime; only arrays carry element type (enabling their runtime check). |
| **`in`/`out` projection** | Use-site variance applied to borrow safe variance from an invariant type (Kotlin). |

---

## Core Concepts

### 1. The array covariance hole, fully dissected

Java arrays were made covariant in 1995 so that pre-generics code could write polymorphic routines like `void sort(Object[] a)` and call it on a `String[]`. Without covariance, you'd have needed a separate sort per element type. The price: covariance + mutation is unsound, so the runtime *must* check every store.

```java
String[] s = new String[1];
Object[] o = s;        // upcast allowed by covariance
o[0] = Integer.valueOf(42);   // type-checks (Integer IS-A Object)
// JVM checks: is the actual array element type (String) assignable from Integer? NO.
// throws java.lang.ArrayStoreException
```

This means **every reference-array store in Java carries a hidden runtime type check** — a real, measurable cost, and a latent crash. C# made the identical choice with the identical consequence (`ArrayTypeMismatchException`). When C# and Java *added generics*, they made them **invariant** — explicitly to *not* repeat this — which is why `List<String>` is not a `List<Object>` but `String[]` is an `Object[]`.

### 2. Why generics fixed it but arrays couldn't be retrofitted

Generics are *erased* (Java) or reified-but-invariant (C#); either way, the language designers controlled the rules from day one and chose invariance plus opt-in wildcards/`out`/`in`. Arrays predate generics and millions of lines rely on their covariance; removing it would break the world. So both languages live with a permanent, well-documented hazard in arrays and a sound model in generics — a split a professional must keep straight.

### 3. TypeScript: bivariant method parameters by design

TypeScript's structural type system checks function assignability. Under the original (and still default for *methods*) rules, parameters are **bivariant** — a `(x: Animal) => void` and a `(x: Cat) => void` are mutually assignable. That's unsound: assigning a `(x: Cat) => void` where `(x: Animal) => void` is expected lets the function receive a `Dog` and call cat-only methods.

`strictFunctionTypes` (TS 2.6+) fixes this for **standalone function-typed** parameters by checking them **contravariantly** — but deliberately leaves **method** parameters bivariant. The rationale: a huge amount of real code (especially around mutable arrays and event handlers) relies on method-parameter bivariance, and making it strict would break the `Array<T>` methods and DOM event types in painful ways. So TypeScript ships a *partial* fix: sound for function properties, unsound for methods, and documents it.

```typescript
interface EventHandler { handle(e: Event): void; }      // method -> bivariant param
type EventHandlerFn = { handle: (e: Event) => void; };  // function property -> contravariant under strict
```

The same signature shape is checked differently depending on whether it's written as a *method* or a *function-typed property*. Professionals exploit this: write callbacks as function-typed properties to get the sound check.

### 4. The engineering signatures that depend on variance

The payoff for all this theory is APIs that compose. The canonical examples:

- **`Collections.copy(List<? super T> dest, List<? extends T> src)`** — PECS made concrete. `src` produces (covariant `? extends`), `dest` consumes (contravariant `? super`). Without the wildcards, you couldn't copy `List<Cat>` into `List<Animal>`.
- **A contravariant comparator: `sort(List<T>, Comparator<? super T>)`** — lets a `Comparator<Animal>` sort a `List<Cat>`. Drop the `? super` and your generic ordering utilities reject base-class comparators.
- **A contravariant callback sink: `forEach(Consumer<? super T>)`** — lets a `Consumer<Object>` (e.g., a logger) consume a stream of `String`.
- **Covariant return in overrides: `Cat reproduce()` overriding `Animal reproduce()`** — callers of the subtype get the precise type without casting.

### 5. The override asymmetry, stated for engineers

The practical rule professionals enforce in code review: **an override may return a subtype but may not accept a supertype *as an override* (most OO languages make that an overload).** You *can* return a subtype (covariant return — useful). You *cannot* safely accept only a subtype (narrowing a param — unsound). And accepting a supertype, while sound, usually isn't an override in Java/C#. So the only override flexibility you actually get in mainstream OO is **covariant returns** — narrow the output, keep the input the same.

### 6. Defensive immutability as the engineering answer to the array bug

The professional's standard mitigation: when you want covariance, make the data immutable so covariance is *sound*. Return `IReadOnlyList<T>` / `ReadonlyArray<T>` / Kotlin `List` (read-only) from APIs; copy on the way in and out so no covariant alias can mutate your internals. This converts "covariance is dangerous" into "covariance is fine because nothing can be written through the covariant view."

### 7. Variance failures wear disguises in production

The same root cause surfaces as different exceptions and bugs: `ArrayStoreException` (Java arrays), `ArrayTypeMismatchException` (.NET arrays), `ClassCastException` from a downcast that "shouldn't" fail, a TypeScript callback silently receiving the wrong runtime shape (no exception — just wrong behavior because TS types are erased). A professional learns to ask, on seeing these, "is something covariant being mutated, or is a contravariant slot being narrowed?"

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Covariant arrays** | A "fragile" sticker the shipper trusts but the loader ignores until a box breaks at the destination dock (runtime). The compiler is the shipper; the JVM is the dock. |
| **Runtime store check** | A bouncer at the *exit* checking IDs you should have checked at the entrance. Every array write pays this tax. |
| **TS bivariant methods** | A building code that's strict for new construction (function properties) but grandfathers in old wiring (methods) because rewiring the whole city would shut it down. |
| **Defensive copy** | Handing visitors a photocopy of the ledger, not the ledger. They can read it; they can't alter your records. |
| **Read-only interface** | A museum display case: you can look at the artifact (covariant read) but the glass stops you putting your own junk inside (no write). |
| **Variance disguises** | The same disease presenting with different symptoms in different organs — you treat the cause, not each symptom. |

---

## Mental Models

### The "Where Does the Check Move?" Model

Soundness must be enforced *somewhere*. Sound generics enforce it at **compile time** (the position check). Covariant arrays defer it to **runtime** (the store check). TypeScript's bivariant methods enforce it **nowhere** (types are erased; the wrong value just flows through). When you choose or use a construct, ask: where did the check go? If "runtime," expect exceptions. If "nowhere," expect silent corruption.

### The "Immutability Buys Covariance" Model

Every soundness hole in variance is ultimately about *writing* through a covariant alias. Remove the write — make it immutable — and covariance becomes free and safe. So the professional reflex when you crave covariance is: "can I make this read-only?" If yes, the problem dissolves.

### The "Two TypeScripts" Model

Treat TS as having two assignability rules living side by side: a sound one for function-typed properties (under `strictFunctionTypes`) and an unsound one for methods. Writing a callback type as `{ cb: (x: T) => void }` opts into the sound rule; writing it as `{ cb(x: T): void }` opts into the unsound one. Same intent, different safety — and you choose.

---

## Code Examples

### Java — `Collections.copy`-style PECS in production

```java
import java.util.*;

final class Pipes {
    // Producer Extends, Consumer Super — the canonical variance-aware signature.
    static <T> void copy(List<? super T> dest, List<? extends T> src) {
        for (int i = 0; i < src.size(); i++) {
            dest.set(i, src.get(i));     // read T from src (covariant), write T to dest (contravariant)
        }
    }

    public static void main(String[] args) {
        List<Animal> dst = new ArrayList<>(Arrays.asList(null, null));
        List<Cat> src = Arrays.asList(new Cat(), new Cat());
        copy(dst, src);   // copy List<Cat> into List<Animal> — only possible with the wildcards
    }
}
class Animal {}
class Cat extends Animal {}
```

### Java — the array hole that a code reviewer must catch

```java
static void appendNumber(Object[] arr, int idx) {
    arr[idx] = 42;   // looks innocent; throws ArrayStoreException if arr is really a String[]
}

public static void demo() {
    String[] names = {"a", "b"};
    appendNumber(names, 0);   // compiles; ArrayStoreException at runtime
}
```

The fix in review: take a `List<Object>` (invariant, compile-time safe) instead of `Object[]`, or make the parameter `String[]` if that's what it really is.

### TypeScript — `strictFunctionTypes` catching an unsound override

```typescript
// tsconfig: "strictFunctionTypes": true
class Animal {}
class Cat extends Animal { meow() {} }

// Standalone function-typed property: checked CONTRAVARIANTLY (sound)
interface Registry {
    onEvent: (a: Animal) => void;
}

const r: Registry = {
    // ERROR under strictFunctionTypes:
    //   Type '(c: Cat) => void' is not assignable to '(a: Animal) => void'
    onEvent: (c: Cat) => c.meow(),   // would receive a Dog and call meow() -> caught!
};
```

### TypeScript — the method-parameter loophole, made visible

```typescript
class Animal {}
class Cat extends Animal { meow() {} }

// METHOD form -> parameters stay BIVARIANT even with strictFunctionTypes
interface RegistryMethod {
    onEvent(a: Animal): void;
}

const r: RegistryMethod = {
    onEvent(c: Cat) { c.meow(); },   // NO error — bivariant method param (UNSOUND)
};
// r.onEvent(new Animal());  // at runtime: meow is not a function — silent type hole
```

Same intent, opposite safety — purely because one is a method and one is a function-typed property. Professionals prefer the function-typed-property form for callbacks.

### C# — variant interface vs unsafe array, side by side

```csharp
class Animal {}
class Cat : Animal {}

class Demo {
    static void Safe() {
        // Declaration-site variance on an interface: SOUND
        IEnumerable<Cat> cats = new List<Cat>();
        IEnumerable<Animal> animals = cats;   // covariant, no runtime risk
    }
    static void Unsafe() {
        Cat[] cats = new Cat[1];
        Animal[] animals = cats;              // covariant array (legacy)
        animals[0] = new Animal();            // ArrayTypeMismatchException at runtime
    }
}
```

### Kotlin — contravariant comparator and read-only covariance together

```kotlin
open class Animal(val weight: Int)
class Cat(weight: Int) : Animal(weight)

// Comparator<in T> is contravariant -> a Comparator<Animal> can sort Cats
fun sortCats(cats: MutableList<Cat>, cmp: Comparator<in Cat>) {
    cats.sortWith(cmp)
}

val byWeight: Comparator<Animal> = compareBy { it.weight }

fun main() {
    val cats = mutableListOf(Cat(5), Cat(2))
    sortCats(cats, byWeight)        // pass a broad Comparator<Animal> for a List<Cat>
    val readOnly: List<Animal> = cats   // Kotlin's read-only List<out T> is covariant: safe
}
```

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Covariant arrays** | Pre-generics polymorphism (`sort(Object[])`); ergonomic legacy code. | Unsound; runtime store check on every write; latent `ArrayStoreException`. |
| **TS bivariant methods** | Existing code (array methods, event handlers) type-checks as developers expect; smooth migration. | Documented unsoundness; callbacks can receive wrong types silently. |
| **`strictFunctionTypes`** | Restores sound contravariant checking for function-typed parameters. | Doesn't cover methods; can surface errors in previously-"working" code. |
| **Defensive immutability for covariance** | Makes covariance fully sound; eliminates the hole. | Copying cost; read-only APIs can feel restrictive to callers who want to mutate. |
| **PECS / variant signatures** | APIs compose; callers pass natural types without casts. | Verbose; wildcard errors are hard to read; easy to get the direction wrong. |

---

## Use Cases

- **Designing public library APIs** where callers pass collections/comparators/callbacks of related types — use PECS / `in`/`out` so they don't fight your signatures.
- **Hardening a service against array-store crashes** — replace `Object[]`/covariant-array parameters at boundaries with invariant `List`/`IReadOnlyList`.
- **Migrating a TypeScript codebase to soundness** — enable `strictFunctionTypes`, convert callback methods to function-typed properties, fix the override errors it surfaces.
- **Exposing read-only views of internal mutable state** — return `IReadOnlyList<out T>` / `ReadonlyArray<T>` / Kotlin `List` for safe covariance without leaking write access.
- **Reviewing override hierarchies** — enforce covariant-return-only; flag attempts to narrow parameters.

---

## Coding Patterns

### Pattern 1: Replace covariant arrays with invariant collections at boundaries

```java
// Hazardous: void process(Object[] items)   // covariant, can ArrayStoreException
void process(List<Object> items) { items.add(42); }   // invariant, compile-time safe
```

### Pattern 2: Function-typed properties for sound TS callbacks

```typescript
// Prefer this (contravariant under strictFunctionTypes):
type Handler<T> = { handle: (x: T) => void };
// Over this (bivariant method param):
interface HandlerMethod<T> { handle(x: T): void }
```

### Pattern 3: Read-only covariant view over mutable internals

```csharp
class Shelter {
    private readonly List<Cat> _cats = new();
    public IReadOnlyList<Animal> Animals => _cats;   // covariant, safe — no Add exposed
}
```

### Pattern 4: PECS signature with a written rationale

```java
// src PRODUCES T (read) -> ? extends ; dest CONSUMES T (write) -> ? super
static <T> void drain(List<? extends T> src, List<? super T> dest) {
    for (T x : src) dest.add(x);
}
```

### Pattern 5: Contravariant comparator parameter

```kotlin
fun <T> topK(items: List<T>, k: Int, cmp: Comparator<in T>): List<T> =
    items.sortedWith(cmp).take(k)   // accepts a Comparator of any supertype of T
```

---

## Best Practices

- **Treat reference-type arrays as a known hazard.** Prefer invariant generic collections at API boundaries; reserve arrays for primitives or tight, locally-controlled code.
- **Enable `strictFunctionTypes` in every TypeScript project,** and write callbacks as function-typed properties to get the sound (contravariant) check.
- **Make data immutable when you want covariance.** Return read-only interfaces; covariance over immutable data is always sound.
- **Use PECS / `in`/`out` in public signatures, concrete types internally.** Flexibility belongs at the boundary.
- **In overrides, allow only covariant returns; reject parameter narrowing in review.** It's the only sound, portable override flexibility.
- **Never expose a mutable internal collection through a covariant view.** A `List<Cat>` returned as `List<? extends Animal>`-shaped read view is fine; returning it as something writable is the array bug reborn.
- **When you debug `ArrayStoreException`/`ArrayTypeMismatchException`/a silently-wrong TS callback, name the variance cause.** It's covariance-plus-mutation or a narrowed contravariant slot, every time.

---

## Edge Cases & Pitfalls

- **`Arrays.asList(...)` returns a fixed-size, array-backed list** that can still surface array-covariance surprises on `set`. Wrap in `new ArrayList<>(...)` when you need a true invariant list.
- **Generic varargs are arrays under the hood.** `static <T> List<T> of(T... items)` creates a covariant array — hence the `@SafeVarargs` annotation and the "unchecked generic array creation" warnings. The array hole leaks into generics through varargs.
- **TS structural typing makes the method/function distinction subtle.** A type literal `{ f(x: T): void }` is a method (bivariant); `{ f: (x: T) => void }` is a property (contravariant under strict). One character of syntax flips the safety.
- **`readonly` in TypeScript is shallow and erased.** `ReadonlyArray<T>` prevents writes at compile time but there's no runtime enforcement — a cast or `any` punches through. It buys soundness only if you don't cheat.
- **C# arrays of value types are *not* covariant** (`int[]` is not `object[]`), so the hole is reference-types-only. Don't over-generalize the rule.
- **Covariant return + generics can require explicit bridge handling in reflection/serialization frameworks.** The synthetic bridge method can confuse annotation processors that don't expect duplicate method signatures.
- **Kotlin `Array<out T>` is read-only-projected**, so you can't pass it where a writable array is needed — people hit this porting Java array code and assume `out` should still allow writes. It can't.
- **`List<*>` (star projection) / `IEnumerable` without type args** give you a safe out-projected read view, *not* `List<Any?>`; trying to add anything but `null` fails.

---

## Test Yourself

1. Reproduce the array-covariance bug in Java and in C#. Name both runtime exceptions. Explain why generics (`List<T>`) don't have this problem.
2. Why did Java/C# make arrays covariant in the first place, and why did they make generics invariant later? What changed in their reasoning?
3. Write a TypeScript callback two ways — as a method and as a function-typed property — and show which one `strictFunctionTypes` checks soundly. Explain the one-character difference.
4. Give the full `Collections.copy`-style signature and label which wildcard is the producer and which is the consumer. What breaks if you swap them?
5. A teammate returns an internal `List<Cat>` from a getter typed as a covariant read view, then another team mutates the original list elsewhere and breaks an invariant. Diagnose this as a variance issue and give the fix.
6. Explain why "an override may return a subtype but not accept a narrower parameter" is the only sound override flexibility mainstream OO actually gives you.
7. Why do generic varargs reintroduce the array-covariance hazard, and what does `@SafeVarargs` assert?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│           VARIANCE IN THE REAL WORLD (the holes)                 │
├──────────────────────────────────────────────────────────────────┤
│ JAVA/C# ARRAYS = COVARIANT + MUTABLE = UNSOUND                   │
│   Object[] a = new String[1]; a[0] = 42;                         │
│   -> ArrayStoreException (Java) / ArrayTypeMismatchException (C#) │
│   reason: shipped before generics; runtime store-check pays cost │
│   FIX: use invariant List/IReadOnlyList at boundaries            │
│                                                                   │
│ GENERICS (List<T>) = INVARIANT = SOUND                          │
│   designed after arrays, explicitly to NOT repeat the hole       │
│                                                                   │
│ TYPESCRIPT METHOD PARAMS = BIVARIANT (unsound, by design)       │
│   strictFunctionTypes -> standalone FUNCTION params contravariant│
│   but METHOD params stay bivariant (compat with array/events)    │
│   FIX: write callbacks as function-typed properties              │
│       { cb: (x: T) => void }   not   { cb(x: T): void }          │
├──────────────────────────────────────────────────────────────────┤
│ WHERE DID THE CHECK GO?                                          │
│   sound generics    -> COMPILE time (position check)             │
│   covariant arrays  -> RUNTIME (store check, can throw)          │
│   TS bivariant      -> NOWHERE (erased, silent wrong value)      │
├──────────────────────────────────────────────────────────────────┤
│ ENGINEERING SIGNATURES                                          │
│   copy(List<? super T> dest, List<? extends T> src)  // PECS     │
│   sort(List<T>, Comparator<? super T>)               // contra   │
│   override: Cat reproduce() over Animal reproduce()  // cov ret  │
│   IReadOnlyList<out T> view over mutable internals   // safe cov │
├──────────────────────────────────────────────────────────────────┤
│ THE PRO REFLEX:  want covariance? make it IMMUTABLE.            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- Production languages ship **deliberate variance unsoundness**. The professional's job is to know exactly where, why, and how to work around it.
- **Java and C# arrays are covariant and mutable**, which is unsound: `Object[] a = new String[1]; a[0] = 42;` compiles and throws `ArrayStoreException` (`ArrayTypeMismatchException` in .NET) at runtime. The choice predates generics and bought pre-generic polymorphism; the cost is a runtime store check on every reference-array write. When generics arrived, both languages made them **invariant** specifically to avoid repeating the hole.
- **TypeScript method parameters are bivariant by default** — intentionally unsound for backward compatibility with array methods and event handlers. `strictFunctionTypes` restores sound **contravariant** checking, but only for **standalone function-typed** parameters, not methods. The practical lever: write callbacks as function-typed properties (`{ cb: (x: T) => void }`) to get the sound check.
- A unifying question: **where did the soundness check go?** Sound generics check at compile time; covariant arrays defer to runtime (exceptions); TS bivariant methods check nowhere (silent wrong values, because TS types are erased).
- The **engineering signatures** that depend on variance: `Collections.copy(List<? super T> dest, List<? extends T> src)` (PECS), `sort(..., Comparator<? super T>)` (contravariant comparator), `forEach(Consumer<? super T>)` (contravariant sink), and covariant-return overrides (`Cat reproduce()`). The only sound, portable override flexibility in mainstream OO is the **covariant return**.
- The professional's standard mitigation is **defensive immutability**: when you want covariance, make the data read-only (`IReadOnlyList<out T>`, `ReadonlyArray<T>`, Kotlin `List`) so covariance is sound by construction. The reflex is "want covariance? make it immutable."
- Variance failures **wear disguises** in production — `ArrayStoreException`, `ArrayTypeMismatchException`, `ClassCastException`, silently-wrong TS callbacks — but the root cause is always covariance-plus-mutation or a narrowed contravariant slot. Naming the cause turns a long debug into a one-line fix. The interview and tasks files drill these scenarios.

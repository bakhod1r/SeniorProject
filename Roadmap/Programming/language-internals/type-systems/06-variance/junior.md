# Variance — Junior Level

> **Topic:** [Variance](README.md)
> **Focus:** If a `Cat` is an `Animal`, is a `List<Cat>` a `List<Animal>`? The surprising answer is "it depends" — and getting it wrong is one of the oldest bugs in programming.

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

> Focus: **What does it mean for one type to be a subtype of another, and how does that relationship survive when you wrap the types in a container or a generic?**

You already know that a `Cat` is an `Animal`. In a typed language this is written `Cat <: Animal` — read "`Cat` is a subtype of `Animal`." It means: anywhere the program asks for an `Animal`, you can hand it a `Cat` and nothing breaks. That is the **Liskov Substitution Principle** in one line — a subtype must be usable wherever the supertype is expected.

**Variance** is the answer to the next, much harder question: *now that I know `Cat <: Animal`, what is the relationship between `List<Cat>` and `List<Animal>`?* Or between `Function<Cat>` and `Function<Animal>`? Or between `Box<Cat>` and `Box<Animal>`? The component types have a subtype relationship — does the composed type inherit it, reverse it, or lose it entirely?

Most people's first instinct is: *"obviously a list of cats is a list of animals."* That instinct is **wrong for mutable lists**, and the reason it's wrong has caused real, shipped, runtime-crashing bugs in Java and C# for decades. Variance is the set of rules that tells you exactly when your instinct is safe and when it will blow up.

There are only four possibilities, and that's the whole topic:

- **Covariant** — the relationship is preserved. `Cat <: Animal` implies `F<Cat> <: F<Animal>`. (Producers, read-only things.)
- **Contravariant** — the relationship is *reversed*. `Cat <: Animal` implies `F<Animal> <: F<Cat>`. (Consumers.)
- **Invariant** — no relationship at all. `F<Cat>` and `F<Animal>` are unrelated types. (Mutable containers, for safety.)
- **Bivariant** — both directions allowed at once. (Almost always unsound; a footgun.)

> 🎓 **Why this matters for a junior:** The moment you use generics — `List<T>`, `Optional<T>`, `Function<A, B>` — you are using variance, whether you know it or not. When the compiler rejects `List<Animal> a = listOfCats;` you'll think the compiler is being annoying. It isn't. It's saving you from a crash. This page teaches you to read those errors and know *why* the rule exists.

This page covers the four variances, the famous array-covariance bug, and the producer/consumer intuition that lets you pick the right one without memorizing rules. The deeper levels go into declaration-site vs use-site variance, function subtyping, and the formal soundness arguments.

---

## Prerequisites

What you should know before reading this:

- **Required:** What a class and a subclass are. `Dog extends Animal`, or `class Dog : Animal`.
- **Required:** Basic generics. You've seen `List<String>`, `ArrayList<Integer>`, `Map<K, V>`.
- **Required:** The idea of a "type error" — the compiler refusing a program because the types don't match.
- **Helpful but not required:** The Liskov Substitution Principle (LSP) by name — though we'll define it.
- **Helpful but not required:** Having been bitten once by an `ArrayStoreException` or an `InvalidCastException`. If you have, this page will explain *why*.

You do **not** need to know:

- The formal type-theory notation (Γ ⊢ ...) — that's not here.
- How the compiler implements variance checking — that's `senior.md`.
- The full PECS rule or Scala's `+T`/`-T` syntax — those are introduced gently and covered in depth later.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Subtype** | `B <: A` ("B is a subtype of A") means a `B` can be used anywhere an `A` is expected. `Cat <: Animal`. |
| **Supertype** | The reverse: `A` is a supertype of `B`. `Animal` is a supertype of `Cat`. |
| **Liskov Substitution Principle (LSP)** | The rule that defines subtyping: a subtype must be substitutable for its supertype without breaking the program. |
| **Generic type / type constructor** | A type that takes another type as a parameter: `List<T>`, `Box<T>`, `Optional<T>`. `T` is the type parameter. |
| **Variance** | The rule describing how subtyping of `T` carries over to subtyping of `F<T>`. |
| **Covariant** | Preserves subtyping direction: `Cat <: Animal` ⟹ `F<Cat> <: F<Animal>`. |
| **Contravariant** | Reverses subtyping direction: `Cat <: Animal` ⟹ `F<Animal> <: F<Cat>`. |
| **Invariant** | No subtyping relationship between `F<Cat>` and `F<Animal>` even though `Cat <: Animal`. |
| **Bivariant** | Both covariant and contravariant at once — `F<Cat>` and `F<Animal>` are mutually substitutable. Usually unsound. |
| **Producer** | Something you only **read from** / get values out of. A source. |
| **Consumer** | Something you only **write to** / put values into. A sink. |
| **Mutable** | Can be changed after creation. A normal `List` you can `add` to. |
| **Immutable** | Cannot be changed after creation. A read-only list. |
| **Sound** | A type rule is sound if it never lets a type-correct program crash with a type error at runtime. Variance rules exist to preserve soundness. |
| **Upcast** | Treating a value as one of its supertypes (`Cat` as `Animal`). Always safe. |
| **Downcast** | Treating a value as one of its subtypes (`Animal` as `Cat`). Not always safe; can fail at runtime. |

---

## Core Concepts

### 1. Subtyping: the foundation

Start with the one rule everything rests on. `Cat <: Animal` means: **a `Cat` is a valid `Animal`.** If a function takes an `Animal`, you can pass it a `Cat`. If a variable is declared `Animal x`, you can store a `Cat` in it. This is upcasting and it is always safe — a cat really *is* an animal, it just has extra abilities.

Variance asks the follow-up: subtyping is defined for *plain* types. What about *composed* types built out of them?

### 2. Covariance: the relationship is preserved

A type `F<T>` is **covariant in `T`** when:

```text
Cat <: Animal   implies   F<Cat> <: F<Animal>
```

The subtype relationship flows straight through, in the same direction. This is the intuitive case. It is safe **as long as `F<T>` only ever lets you *read* a `T` out** (a producer). Why? If you have a `Producer<Cat>` and treat it as a `Producer<Animal>`, every value it hands you is a `Cat`, and a `Cat` is a valid `Animal`. No lie is told. Reading is safe.

Examples of naturally covariant things: an immutable read-only list, a function's **return type**, an `Iterator` (you only pull values out), `Optional<T>` (read-only).

### 3. Contravariance: the relationship is reversed

A type `F<T>` is **contravariant in `T`** when:

```text
Cat <: Animal   implies   F<Animal> <: F<Cat>
```

The arrow flips. This feels backwards until you see *why*. Contravariance is the rule for **consumers** — things you only *write into* / *feed values to*.

Consider a `Consumer<T>` that has a method `accept(T value)`. Think about a `Consumer<Animal>` — it can accept *any* animal: a cat, a dog, a hamster. Now, can you use a `Consumer<Animal>` wherever a `Consumer<Cat>` is expected? **Yes!** A thing that can swallow any animal can certainly swallow a cat. So `Consumer<Animal> <: Consumer<Cat>` — the relationship reversed. A consumer of the *more general* type is a subtype of a consumer of the *more specific* type.

Examples of naturally contravariant things: a function's **parameter**, a `Comparator<T>` (it consumes two `T`s), a callback that you hand values to.

### 4. Invariance: no relationship — for safety

A type `F<T>` is **invariant in `T`** when `F<Cat>` and `F<Animal>` have **no subtype relationship at all**, even though `Cat <: Animal`. They are simply different, unrelated types.

This is the correct (and only safe) variance for a **mutable container** — something you can both read from *and* write to. A normal `List<T>` with both `get` and `add` must be invariant, because covariance breaks on the write side and contravariance breaks on the read side. We'll prove this with the array bug below.

### 5. Bivariance: both — and (almost always) wrong

**Bivariant** means `F<Cat>` and `F<Animal>` are mutually substitutable in *both* directions. This is almost always **unsound** — it lets you both read a wrong type out and write a wrong type in. Few languages allow it deliberately; the famous exception is TypeScript's method parameters by default, which is a known unsoundness (covered in `professional.md`).

### 6. The killer example: why mutable containers can't be covariant

Here is the bug that proves invariance is necessary. Java and C# made **arrays covariant** — they let you write `Object[] a = new String[1]`. Watch what that allows:

```java
String[] strings = new String[1];
Object[] objects = strings;     // ALLOWED: arrays are covariant, String[] <: Object[]
objects[0] = 42;                // compiles fine! 42 is an Object.
                                // ...but the array is REALLY a String[]
                                // CRASH: ArrayStoreException at runtime
```

Every line type-checks. The compiler is happy. But at runtime, the JVM has to insert a *check* on every array store, and when you try to put an `Integer` into what is secretly a `String[]`, it throws `ArrayStoreException`. **Covariance plus mutation equals unsoundness.** The only way to make this safe at compile time is to make mutable containers **invariant** — which is exactly what Java did for generics (`List<T>` is invariant) after learning the lesson from arrays.

### 7. The producer/consumer intuition (the shortcut)

You don't have to memorize the four rules. Ask one question about your generic type:

- **Do I only read `T` out of it?** → It's a producer → **covariant** is safe.
- **Do I only write `T` into it?** → It's a consumer → **contravariant** is safe.
- **Do I do both?** → **invariant** — no variance is safe.

In Java this intuition has a name: **PECS — "Producer Extends, Consumer Super."** When you read/produce, use `? extends T`. When you write/consume, use `? super T`. We'll see this in the examples and go deep on it in `middle.md`.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Subtyping** | A cat *is* an animal. Anywhere a sign says "animals allowed," a cat is allowed. |
| **Covariance** | A **vending machine that only dispenses cats**. A machine that gives out cats is also (safely) usable as a machine that gives out animals — whatever falls out is an animal. Read-only, so it's safe. |
| **Contravariance** | A **garbage chute labeled "any animal"**. A chute that accepts *any* animal can stand in for a chute that only needs to accept *cats*. The general acceptor substitutes for the specific one. |
| **Invariance** | A **pet carrier you both load and unload**. You can't safely treat a cat-carrier as an animal-carrier (someone might load a dog into your cat-only carrier), nor vice versa. It must be exactly what it says. |
| **The array bug** | You label a box "STRING ONLY," then someone re-labels it "ANYTHING," drops a number in, and the original owner reaches in expecting a string and gets a face full of integer. The mislabeling is the covariance; the crash is the `ArrayStoreException`. |
| **PECS** | If a friend is *giving* you pets (producer), you'll happily accept "cats or any subtype." If a friend is *taking* pets off your hands (consumer), you'll happily hand them off to anyone who accepts "cats or any supertype." |
| **Bivariance** | A box labeled both "STRING ONLY" and "ANYTHING" at the same time — every guarantee is meaningless. |

---

## Mental Models

### The Arrow Model

Draw the subtype arrow: `Cat ──<:──▶ Animal`.

- **Covariant**: the arrow on `F<...>` points the **same way**: `F<Cat> ──<:──▶ F<Animal>`.
- **Contravariant**: the arrow **flips**: `F<Animal> ──<:──▶ F<Cat>`.
- **Invariant**: **no arrow** between `F<Cat>` and `F<Animal>`.

"Co" = together (same direction). "Contra" = against (opposite direction). The Latin tells you the answer.

### The "Which Way Do Values Flow?" Model

The single most useful question: **which direction does data move through the `T` slot?**

- Data flows **out** of the generic (you read `T`) → covariant. The supertype view is safe because everything coming out is at least the supertype.
- Data flows **in** to the generic (you write `T`) → contravariant. The subtype-of-consumer can accept more, so the general consumer is the subtype.
- Data flows **both** ways → invariant.

### The "What Lie Could I Tell?" Model

A variance is *unsound* if it lets you tell a lie the runtime can't catch. Covariant-and-writable lets you write a `Dog` into a secret `List<Cat>` — a lie discovered only at read time, possibly far away. Contravariant-and-readable lets you read an `Animal` out of something promised to give `Cat`s — same problem. Invariance forbids both lies. Whenever you're unsure, ask: *"if the compiler allowed this, what wrong value could sneak through?"*

---

## Code Examples

We'll use the same cast — `Animal`, `Cat`, `Dog` — across languages.

### Java — arrays are covariant (and that's the bug)

```java
class Animal {}
class Cat extends Animal {}
class Dog extends Animal {}

public class ArrayCovariance {
    public static void main(String[] args) {
        Cat[] cats = new Cat[1];
        Animal[] animals = cats;   // legal: arrays ARE covariant in Java
        animals[0] = new Dog();    // compiles! Dog is an Animal.
        // At runtime: java.lang.ArrayStoreException — the array is really Cat[]
    }
}
```

The compiler accepts every line. The crash happens at runtime because the JVM checks every array store against the array's *actual* element type.

### Java — generics are invariant (the fix)

```java
import java.util.*;

public class ListInvariance {
    public static void main(String[] args) {
        List<Cat> cats = new ArrayList<>();
        // List<Animal> animals = cats;  // COMPILE ERROR: incompatible types
        // The compiler stops you BEFORE any crash can happen.
    }
}
```

`List<Cat>` is **not** a `List<Animal>` in Java. That rejection is the compiler protecting you from the exact array bug above. Generics learned the lesson arrays didn't.

### Java — covariance and contravariance on demand (wildcards / PECS)

```java
import java.util.*;

public class Pecs {
    // PRODUCER: we only READ animals out of src -> use ? extends (covariant)
    // CONSUMER: we only WRITE animals into dest -> use ? super (contravariant)
    static void copy(List<? super Animal> dest, List<? extends Animal> src) {
        for (Animal a : src) {   // reading: each is at least an Animal
            dest.add(a);         // writing: dest accepts Animal or any supertype
        }
    }

    public static void main(String[] args) {
        List<Cat> cats = new ArrayList<>(List.of(new Cat(), new Cat()));
        List<Object> sink = new ArrayList<>();
        copy(sink, cats);   // src is List<Cat> (a producer of Animals — fits ? extends Animal)
                            // dest is List<Object> (a consumer of Animals — fits ? super Animal)
    }
}
```

This is the real signature shape used by `java.util.Collections.copy`. **Producer Extends, Consumer Super.**

### C# — `out` and `in` declare variance on interfaces

```csharp
// Covariant: T appears only in OUTPUT position -> 'out'
interface IProducer<out T> { T Get(); }

// Contravariant: T appears only in INPUT position -> 'in'
interface IConsumer<in T> { void Accept(T item); }

class Animal {}
class Cat : Animal {}

class Program {
    static void Main() {
        IProducer<Cat> catSource = null;
        IProducer<Animal> animalSource = catSource;   // OK: covariant (out)

        IConsumer<Animal> animalSink = null;
        IConsumer<Cat> catSink = animalSink;           // OK: contravariant (in)
    }
}
```

C# bakes the producer/consumer rule into syntax: `out` = covariant (output only), `in` = contravariant (input only). The compiler *enforces* that a `T` marked `out` never appears as a parameter, and vice versa.

### Kotlin — `out` and `in`, same idea

```kotlin
interface Producer<out T> { fun get(): T }       // covariant
interface Consumer<in T> { fun accept(item: T) } // contravariant

open class Animal
class Cat : Animal()

fun main() {
    val catSource: Producer<Cat> = TODO()
    val animalSource: Producer<Animal> = catSource    // OK (out)

    val animalSink: Consumer<Animal> = TODO()
    val catSink: Consumer<Cat> = animalSink           // OK (in)
}
```

Kotlin's mnemonic is the same words as C# — `out` for "produces/outputs", `in` for "consumes/inputs".

### TypeScript — read-only arrays are safely covariant; mutable ones are the trap

```typescript
class Animal {}
class Cat extends Animal { meow() {} }

// ReadonlyArray is a producer -> covariant is safe
const cats: ReadonlyArray<Cat> = [new Cat()];
const animals: ReadonlyArray<Animal> = cats;  // OK and SOUND: you can only read

// Mutable array covariance is the unsafe analog of the Java array bug
let mutCats: Cat[] = [new Cat()];
let mutAnimals: Animal[] = mutCats;  // TS allows this (arrays are covariant)
mutAnimals.push(new Animal());        // now mutCats[1] is NOT a Cat — unsound
mutCats[1].meow();                    // runtime error: meow is not a function
```

TypeScript, like Java, lets mutable arrays be covariant for ergonomic reasons — and inherits the same soundness hole. The `ReadonlyArray` version is genuinely safe.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Covariance** | Natural, intuitive; lets you pass `List<Cat>` where `List<? extends Animal>` is wanted; safe for read-only data. | Unsound if the type can be mutated — the source of the array bug. |
| **Contravariance** | Lets one general consumer/comparator/callback serve many specific needs; reduces duplication. | Counterintuitive direction; trips up almost everyone the first time. |
| **Invariance** | Always sound; the safe default for mutable containers. | Rigid: forces wildcards/casts to pass `List<Cat>` where `List<Animal>` is asked. |
| **Bivariance** | Maximum flexibility, fewer compile errors. | Almost always unsound; defeats the point of static typing. |
| **Variance in general** | Lets generic APIs be flexible *and* safe at the same time. | One of the hardest parts of a type system to learn and to read in signatures. |

---

## Use Cases

You reach for each variance when:

- **Covariance** — you have a read-only / producing generic: an immutable list, an `Iterator`, a function return type, `Optional`/`Maybe`, a `Supplier<T>`. You want `Producer<Cat>` to be usable as `Producer<Animal>`.
- **Contravariance** — you have a consuming generic: a `Comparator<T>`, an event `Consumer<T>`, a callback, a function's parameter slot, a logging sink. You want `Consumer<Animal>` to be usable as `Consumer<Cat>`.
- **Invariance** — you have a mutable container that is both read and written: a normal `List<T>`, a `Map<K, V>`, a mutable `Box<T>`, a cache. Safety requires no variance.
- **Bivariance** — essentially never on purpose. You'll meet it only as a default you want to *turn off* (TypeScript's `strictFunctionTypes`).

---

## Coding Patterns

### Pattern 1: PECS for flexible method signatures (Java)

```java
// Producer Extends, Consumer Super
static <T> void transfer(List<? extends T> from, List<? super T> to) {
    for (T item : from) to.add(item);
}
```

Read from `? extends`, write to `? super`. Memorize PECS and you'll write correct wildcard signatures without thinking about the soundness proof.

### Pattern 2: Mark interfaces by role (C# / Kotlin)

```csharp
interface IReader<out T> { T Read(); }     // producer -> out -> covariant
interface IWriter<in T> { void Write(T x); } // consumer -> in -> contravariant
```

Split a read/write interface into a producer interface and a consumer interface, each with the right variance. This is cleaner than one invariant interface and unlocks flexibility.

### Pattern 3: Prefer immutable types when you want covariance

If you find yourself wishing `List<Cat>` were a `List<Animal>`, ask whether the list needs to be mutable at all. An *immutable* list can be safely covariant. Reach for `ReadonlyArray<T>` (TS), `List<out T>` (Kotlin's read-only `List` is already covariant!), or `IReadOnlyList<out T>` (C#).

### Pattern 4: A contravariant comparator

```java
// A Comparator<Animal> can compare Cats, so it should be usable as Comparator<Cat>.
static void sortCats(List<Cat> cats, Comparator<? super Cat> cmp) {
    cats.sort(cmp);
}
// Now a general Comparator<Animal> can be passed in to sort cats.
```

`? super Cat` is contravariance in action: a more general comparator is accepted.

---

## Best Practices

- **Default mutable containers to invariant.** Don't fight your compiler when it refuses `List<Animal> a = catList`. It's right.
- **Use the producer/consumer test, not memorized rules.** Ask "do I read or write `T`?" and the variance falls out.
- **In Java, learn PECS and apply it mechanically.** `? extends` to read, `? super` to write.
- **In C#/Kotlin, mark each interface's parameter `out` or `in` when it's purely produced or consumed.** Let the compiler verify you didn't mix positions.
- **Prefer immutable types when you want covariance.** Immutability makes covariance safe for free.
- **Never rely on array covariance.** It compiles but it's a runtime trap. Treat arrays of reference types as a known hazard.
- **Don't fabricate bivariance.** If a language lets you (casts, `any`, unsafe interfaces), you're punching a hole in your type safety.

---

## Edge Cases & Pitfalls

- **The classic array-store crash.** `Object[] a = new String[1]; a[0] = 42;` compiles, throws `ArrayStoreException`. Covariant array + mutation = unsound. The #1 thing to remember from this page.
- **`List<Cat>` is *not* a `List<Animal>` in Java/C#/Kotlin generics.** People expect it to be. It isn't, and that rejection is a *feature*.
- **Contravariance feels backwards.** `Consumer<Animal> <: Consumer<Cat>` (not the other way). If it feels wrong, you're normal — re-read the garbage-chute analogy.
- **A read-only list is covariant; a mutable one is invariant.** Same data, different variance, purely because of mutation. Kotlin's `List` (read-only) is covariant; its `MutableList` is invariant.
- **Wildcards limit you.** A `List<? extends Animal>` lets you read `Animal`s but you *cannot* `add` to it (except `null`) — because the compiler doesn't know the real element type. A `List<? super Cat>` lets you add `Cat`s but reads come out as `Object`. This is the price of variance, and it's correct.
- **`null` is special.** You can usually add `null` to a `? extends` list because `null` is a member of every reference type. Don't read meaning into that.
- **Variance is per-type-parameter.** A `Map<K, V>` can be (and is) invariant in `K` and could be covariant in `V` — each slot has its own variance. A `Function<A, B>` is contravariant in `A` and covariant in `B`. We cover this in `middle.md`.

---

## Test Yourself

1. State the definition of covariant, contravariant, and invariant using the symbols `<:`, `Cat`, and `Animal`.
2. Why is `Object[] a = new String[1]; a[0] = 42;` accepted by the Java compiler but rejected by the JVM at runtime? What is the exception's name?
3. A `Consumer<T>` only ever *receives* `T`s. Should `Consumer<Animal>` be a subtype of `Consumer<Cat>`, or the other way around? Explain using the "which way do values flow?" model.
4. Your colleague writes `List<Animal> a = catList;` and is annoyed the compiler rejects it. In two sentences, explain why the rejection prevents a bug.
5. Translate "Producer Extends, Consumer Super" into the producer/consumer flow model. Which wildcard reads, which writes?
6. Kotlin's read-only `List<out T>` is covariant but `MutableList<T>` is invariant. Both hold the same data. What single property makes the difference, and why?
7. In C#, you mark an interface's type parameter `out`. What does the compiler now forbid you from doing with that parameter, and why does that restriction make covariance safe?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                          VARIANCE                                 │
├──────────────────────────────────────────────────────────────────┤
│ Given:  Cat <: Animal   ("a Cat is an Animal")                    │
├──────────────────────────────────────────────────────────────────┤
│ COVARIANT      F<Cat> <: F<Animal>     (same direction)           │
│                safe for PRODUCERS (read-only / output)            │
│                Java ? extends | C#/Kotlin out                     │
│                                                                   │
│ CONTRAVARIANT  F<Animal> <: F<Cat>     (reversed!)                │
│                safe for CONSUMERS (write-only / input)            │
│                Java ? super | C#/Kotlin in                        │
│                                                                   │
│ INVARIANT      F<Cat> and F<Animal> unrelated                     │
│                required for MUTABLE containers (read AND write)   │
│                Java List<T>, C#/Kotlin default                    │
│                                                                   │
│ BIVARIANT      both directions — almost always UNSOUND            │
├──────────────────────────────────────────────────────────────────┤
│ THE PRODUCER/CONSUMER TEST                                        │
│   read T out  → producer → covariant                              │
│   write T in  → consumer → contravariant                          │
│   both        → invariant                                         │
│   PECS: Producer Extends, Consumer Super                          │
├──────────────────────────────────────────────────────────────────┤
│ THE BUG TO NEVER FORGET                                           │
│   Object[] a = new String[1];  // covariant array                │
│   a[0] = 42;                    // compiles                        │
│   --> ArrayStoreException       // crashes at runtime             │
│   covariance + mutation = unsound  => mutable must be invariant   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Subtyping** (`Cat <: Animal`) means a `Cat` is usable anywhere an `Animal` is. **Variance** answers what happens to that relationship when you wrap the types: is `F<Cat>` related to `F<Animal>`?
- **Covariant** preserves the direction (`F<Cat> <: F<Animal>`) and is safe for **producers** — things you only read from. Java `? extends`, C#/Kotlin `out`.
- **Contravariant** reverses the direction (`F<Animal> <: F<Cat>`) and is safe for **consumers** — things you only write to. Java `? super`, C#/Kotlin `in`.
- **Invariant** means no relationship at all, and it is the *required, safe* variance for **mutable containers** that are both read and written.
- **Bivariant** allows both and is almost always **unsound** — a hole in type safety.
- The famous proof that mutable containers must be invariant is the **array covariance bug**: `Object[] a = new String[1]; a[0] = 42;` compiles but throws `ArrayStoreException`. **Covariance + mutation = unsound.**
- The shortcut that replaces memorization: **which way do values flow?** Out = covariant (producer), in = contravariant (consumer), both = invariant. In Java this is **PECS — Producer Extends, Consumer Super.**
- Mutability is the hinge: an *immutable* list can be safely covariant; a *mutable* one cannot. Kotlin's `List` (read-only) is covariant, its `MutableList` is invariant — same data, different variance.
- Next levels go deeper: function subtyping (contravariant in args, covariant in returns), declaration-site vs use-site variance, and the formal soundness arguments.

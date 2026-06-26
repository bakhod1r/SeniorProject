# Variance — Middle Level

> **Topic:** [Variance](README.md)
> **Focus:** Function subtyping (the single most-tested variance fact), per-position variance, and why overriding lets you widen parameters and narrow returns.

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

> Focus: **Functions are the most important place variance shows up. A function is a subtype of another when it accepts *more* and returns *less*.** This page makes that precise and shows you why it governs method overriding everywhere.

At the junior level you learned the four variances and the producer/consumer test. Now we apply that test to the one type constructor that appears in every program: the **function type** `(A) -> B`.

A function has two type slots, and they have *opposite* variances:

- It is **contravariant in its parameter type** `A` — because the function *consumes* `A`.
- It is **covariant in its return type** `B` — because the function *produces* `B`.

Put together: a function `f` is a subtype of a function `g` when **`f` accepts everything `g` accepts (and maybe more) and returns something at least as specific as what `g` returns (and maybe more specific).** The slogan: **"accept more, return less."** A more lenient input and a more precise output makes a *better* (sub-) function.

This isn't an academic curiosity. It is the rule that governs **method overriding** in every object-oriented language: when you override a method, you may *widen* (generalize) the parameter types and *narrow* (specialize) the return type, and the result is still a valid override. Java relaxed its rules in 5.0 to allow **covariant return types** for exactly this reason. Understanding function variance means understanding why `clone()` overrides can return a more specific type but overrides can't demand a more specific argument.

> 🎓 **Why this matters for a middle engineer:** You write higher-order functions, callbacks, and overrides daily. The compiler's acceptance or rejection of "can I pass this function here?" or "is this a valid override?" is *entirely* governed by function variance. Once you internalize "contravariant params, covariant returns," a whole class of confusing type errors becomes obvious.

This page also introduces **per-position variance** — the idea that a single generic can be covariant in one parameter and contravariant in another (`Function<A, B>` is the canonical example) — and how to read off a type's variance by where each parameter appears.

---

## Prerequisites

- **Required:** The four variances and the producer/consumer test from `junior.md`.
- **Required:** The array-covariance bug and why mutable containers are invariant.
- **Required:** Comfort with higher-order functions: passing a function as an argument, function types like `Function<A, B>`, `(A) -> B`, `Func<A, B>`.
- **Required:** What method overriding is and that an override must be type-compatible with the method it overrides.
- **Helpful:** Java wildcards (`? extends` / `? super`) — used in examples.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Function type** | The type of a function: `(A) -> B`, written `Function<A, B>` in Java, `Func<A, B>` in C#, `(a: A) => B` in TS. |
| **Parameter (input) position** | Where a type appears as something the construct *consumes*. Contravariant. |
| **Return (output) position** | Where a type appears as something the construct *produces*. Covariant. |
| **Covariant return type** | Overriding a method with a more specific return type. Legal in Java 5+, C#, C++, Kotlin. |
| **Parameter widening** | An override accepting a *more general* parameter type than the supertype's method. Sound, but most OO languages don't allow it via overriding (they treat it as overloading). |
| **Per-position variance** | A generic that is covariant in one type parameter and contravariant in another. |
| **Function subtyping rule** | `(A1 -> B1) <: (A2 -> B2)` iff `A2 <: A1` (params contravariant) and `B1 <: B2` (returns covariant). |
| **"Accept more, return less"** | The slogan form of the function subtyping rule. |
| **Use-site variance** | Variance specified where the type is *used* (Java wildcards `? extends`/`? super`). |
| **Declaration-site variance** | Variance specified once where the type is *declared* (C#/Kotlin `out`/`in`, Scala `+`/`-`). |
| **Nested position flip** | Variance composes: a contravariant slot *inside* another contravariant slot becomes covariant. |

---

## Core Concepts

### 1. The function subtyping rule, stated precisely

For two function types:

```text
(A1 -> B1) <: (A2 -> B2)
   iff
A2 <: A1     (parameter: CONTRAVARIANT — the arrow flips)
   and
B1 <: B2     (return:    COVARIANT     — the arrow preserved)
```

Read it as: a function `f : A1 -> B1` can be used wherever `g : A2 -> B2` is expected when `f` accepts at least everything `g` would be given (so `A2 <: A1`, `f`'s parameter is a *supertype*) and `f` returns something that fits where `g`'s result was expected (so `B1 <: B2`, `f`'s result is a *subtype*).

### 2. Why parameters are contravariant — the substitution argument

Suppose code expects a `g : Cat -> Int` and somewhere calls `g(someCat)`. You want to substitute your `f` for `g`. The caller will hand `f` a `Cat`. For `f` to be safe, `f` must be able to accept that `Cat`. If `f : Animal -> Int`, it accepts *any* animal, so it certainly accepts the `Cat`. So `f : Animal -> Int <: Cat -> Int` — the function with the *more general* parameter is the subtype. **More general input = subtype.** That's contravariance.

If instead `f : Persian -> Int` (a subtype of `Cat`), it would choke when handed a plain `Cat`. So narrowing a parameter is *unsafe* — you may not do it.

### 3. Why returns are covariant — the same argument, other end

The caller does `Int x = g(someCat)` expecting an `Int`. If your `f` returns a `PositiveInt <: Int`, the caller still gets something usable as an `Int`. So `f : Cat -> PositiveInt <: Cat -> Int` — the function with the *more specific* return is the subtype. **More specific output = subtype.** That's covariance.

### 4. The slogan: "accept more, return less"

A function is a *better* (sub-) function if it is more **lenient** about what it takes and more **precise** about what it gives. "Accept more" = wider parameter (contravariant). "Return less" = narrower return (covariant). Both make the function *more useful* as a drop-in. This single sentence is the most-tested variance fact in interviews.

### 5. Override rules fall straight out of this

Method overriding is function subtyping with the parameter and return slots:

- **Covariant return**: an override may return a **subtype** of the original return type. `Animal reproduce()` may be overridden by `Cat reproduce()`. Java 5+ allows this; before that you had to return the exact type.
- **Parameter contravariance** *would* allow an override to accept a **supertype** of the original parameter. It's sound — but most OO languages (Java, C#, C++) treat a different parameter type as **overloading**, not overriding, so you rarely see it. Scala and a few others support genuine parameter contravariance in overrides.
- **What you must NOT do**: narrow a parameter (demand a subtype) or widen a return (return a supertype) — both break substitutability.

A clean way to remember override rules: **"a subclass method may promise more (narrower return) and demand less (wider parameter)."** That's LSP for methods, and it's exactly function variance.

### 6. Per-position variance: one generic, multiple slots

`Function<A, B>` has two slots with opposite variances. In C#:

```csharp
interface Func<in A, out B> { B Invoke(A arg); }
```

`A` is `in` (contravariant — it's only consumed as a parameter), `B` is `out` (covariant — it's only produced as a return). Variance is computed *per type parameter*, by looking at every position where that parameter appears:

- Appears only in output positions → covariant (`out`).
- Appears only in input positions → contravariant (`in`).
- Appears in both → invariant.

### 7. Variance composes (positions can flip)

Variance is computed by multiplying signs as you nest. Treat covariant as `+` and contravariant as `-`. A position's overall variance is the product of the variances of every constructor wrapping it.

Consider `(Cat -> Int) -> String`, a function that *takes a function*. The inner `Cat` sits in the parameter position of the inner function (`-`), which itself sits in the parameter position of the outer function (`-`). `(-) × (-) = (+)` — so `Cat` is in a **covariant** position overall. A higher-order function's *callback's parameter* ends up covariant. This "minus times minus is plus" rule is how you reason about deeply nested signatures, and it trips up almost everyone the first time.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Contravariant parameter** | A job posting that says "must accept any animal." An applicant who can handle *any animal* over-qualifies for a "must handle cats" role. The broader skill is the better fit — a subtype. |
| **Covariant return** | A vending machine upgrade that used to dispense "a drink" and now dispenses "a cold drink." It still satisfies anyone who wanted "a drink," and it does *more*. The more specific output is a strict improvement. |
| **"Accept more, return less"** | A contractor who accepts more kinds of jobs and delivers more precisely finished work is strictly better to hire. |
| **Override widening params** | A new manager who can manage *any* department can stand in for one who only managed engineering. |
| **Override narrowing return** | A factory that promised "a vehicle" now ships "a car." Everyone expecting a vehicle is satisfied. |
| **Minus times minus** | An enemy of my enemy is my friend. Reverse a reversal and you're back to the original direction. |

---

## Mental Models

### The Two-Arrow Model

Draw `A1 -> B1` above `A2 -> B2`. For the top to be a subtype of the bottom: the **parameter arrow points up** (`A2 <: A1`) and the **return arrow points down** (`B1 <: B2`). The arrows point *toward each other*, like a function "squeezing" inward — accept a wider input, produce a narrower output.

### The "Caller's Contract" Model

A function type is a contract with its callers. The caller promises to supply something of the parameter type and expects something of the return type. A substitute function is valid iff it **honors every promise the caller relied on**: it must accept whatever the caller might pass (so its parameter type is at least as wide → contravariant) and it must deliver whatever the caller expects (so its return type is at least as specific → covariant).

### The Sign-Multiplication Model

Tag covariant `+`, contravariant `-`, invariant `0`. To find a nested type parameter's variance, multiply the variance of each enclosing position. `+×+ = +`, `−×− = +`, `+×− = −`, `0×anything = 0`. This single rule subsumes every special case: function-in-function, list-of-functions, function-returning-list, etc.

---

## Code Examples

### Scala — function variance is built into the standard library

```scala
// Scala's Function1 is DECLARED:  trait Function1[-T1, +R]
//   -T1  contravariant in the argument
//   +R   covariant in the result
class Animal
class Cat extends Animal
class Persian extends Cat

val takesCat:    Cat => Animal    = (c: Cat) => new Animal
val takesAnimal: Animal => Persian = (a: Animal) => new Persian

// Is (Animal => Persian) a subtype of (Cat => Animal)?
// Param:  Cat <: Animal   ✓ (contravariant: wider param OK)
// Return: Persian <: Animal ✓ (covariant: narrower return OK)
val asCatToAnimal: Cat => Animal = takesAnimal   // compiles — accept more, return less
```

`takesAnimal` accepts *more* (any animal, not just cats) and returns *less* (a `Persian`, more specific than `Animal`), so it is a valid `Cat => Animal`.

### Java — covariant return types in overrides

```java
class Animal { Animal reproduce() { return new Animal(); } }

class Cat extends Animal {
    @Override
    Cat reproduce() { return new Cat(); }   // covariant return: Cat <: Animal — legal in Java 5+
}

// Why it's safe: anyone calling animal.reproduce() expects an Animal.
// A Cat IS an Animal, so returning a Cat never disappoints the caller.
```

Before Java 5 this was a compile error; you had to declare the return type as `Animal`. The relaxation is pure covariant-return reasoning.

### Java — why you can't narrow a parameter (it becomes overloading, not overriding)

```java
class Handler { void handle(Animal a) { } }

class CatHandler extends Handler {
    // void handle(Cat c) { }   // This does NOT override — it OVERLOADS.
    // If it DID override and narrowed the param, then:
    //   Handler h = new CatHandler();
    //   h.handle(new Dog());    // caller passes a Dog (legal for Handler.handle)
    //                           // but CatHandler only handles Cats -> unsound!
}
```

Narrowing a parameter via override would be unsound, which is why Java refuses to treat it as an override at all.

### TypeScript — function types, with strictFunctionTypes

```typescript
class Animal {}
class Cat extends Animal { meow() {} }

type CatFn = (c: Cat) => void;
type AnimalFn = (a: Animal) => void;

declare let takesAnimal: AnimalFn;
declare let takesCat: CatFn;

// Sound assignment: a function taking Animal can stand in for one taking Cat
// (contravariant parameters): it accepts MORE.
let asCatFn: CatFn = takesAnimal;   // OK under strictFunctionTypes — sound

// The UNSOUND direction is rejected only when strictFunctionTypes is ON:
let asAnimalFn: AnimalFn = takesCat; // ERROR (strict): takesCat would receive a Dog and call .meow()
```

With `strictFunctionTypes` enabled, TypeScript checks standalone function parameters **contravariantly** (sound). Method parameters remain bivariant — covered in `professional.md`.

### Kotlin — declaration-site variance on a function-like interface

```kotlin
interface Transform<in A, out B> {   // contravariant in A, covariant in B
    fun apply(input: A): B
}

open class Animal
class Cat : Animal()
open class Shape
class Circle : Shape()

fun main() {
    val animalToCircle: Transform<Animal, Circle> = TODO()
    // Usable where Transform<Cat, Shape> is wanted:
    //   in A:  Cat <: Animal  -> accepts more (contravariant)  ✓
    //   out B: Circle <: Shape -> returns less (covariant)     ✓
    val catToShape: Transform<Cat, Shape> = animalToCircle      // compiles
}
```

### C# — nested variance, the sign-multiplication rule

```csharp
// Action<T> is contravariant: Action<in T>
// Action<Action<T>> -> T sits inside contravariant inside contravariant -> COVARIANT overall.
class Animal {}
class Cat : Animal {}

class Demo {
    static void Run() {
        Action<Action<Cat>> outer = null;
        // Because (-)×(-) = (+), this behaves covariantly in the inner T:
        Action<Action<Animal>> wider = outer;   // permitted: minus-times-minus is plus
    }
}
```

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Function contravariant params** | Lets a general handler/comparator/callback substitute for a specific one; reduces duplication. | The reversed direction confuses learners; bugs hide where languages get it wrong (TS method params). |
| **Function covariant returns** | Overrides can return precise types; no needless upcasting or casts at call sites. | Subtle when combined with generics and bridge methods (JVM synthesizes bridges). |
| **Per-position variance** | Precisely captures real APIs (`Function`, `Comparator`); maximal flexibility with safety. | Reading multi-parameter variance annotations is hard; mistakes are easy. |
| **"Accept more, return less"** | A one-line rule that governs overriding everywhere. | Easy to state, easy to misapply under nesting. |

---

## Use Cases

- **Designing higher-order APIs.** A `map(f: A -> B)` should accept any `f` that accepts at least `A` and returns at most `B`. Function variance tells you the right signature.
- **Overriding and the template-method pattern.** Subclasses override hooks; covariant returns let them return their own concrete types.
- **Callback and listener interfaces.** A `Listener<in T>` (contravariant) lets one broad listener serve many specific event streams.
- **Comparators and orderings.** `Comparator<? super T>` (Java) or `Comparator<in T>` (Kotlin) is contravariance: a comparator of a supertype works for the subtype.
- **Functional combinators.** `compose`, `andThen`, `flatMap` signatures all rely on function variance to type-check cleanly.

---

## Coding Patterns

### Pattern 1: Contravariant callback parameter (Java)

```java
interface Sink<T> { void accept(T value); }

static void feedCats(List<Cat> cats, Sink<? super Cat> sink) {
    for (Cat c : cats) sink.accept(c);
}
// A Sink<Animal> can be passed: it consumes Cats fine. ? super = contravariance.
```

### Pattern 2: Covariant return in a factory hierarchy

```java
abstract class AnimalShelter { abstract Animal adopt(); }
class CatShelter extends AnimalShelter {
    @Override Cat adopt() { return new Cat(); }   // callers get the precise type for free
}
```

### Pattern 3: Split a transform into `in`/`out` slots (Kotlin/C#)

```kotlin
interface Pipe<in I, out O> { fun run(input: I): O }
```

Mark inputs `in`, outputs `out`. The compiler verifies each parameter only appears in its declared role — a free correctness check.

### Pattern 4: Use the sign rule before trusting a nested signature

When a signature nests functions (`(A -> B) -> C`), don't guess. Multiply signs from the outside in for each occurrence of a type parameter, then write the `in`/`out`/invariant annotation that results.

---

## Best Practices

- **Memorize "accept more, return less."** It governs overrides, callbacks, and higher-order signatures in every language.
- **For overrides, narrow returns and (where the language allows) widen parameters — never the reverse.** That's the LSP-safe direction.
- **Annotate function-like interfaces with `in`/`out` (C#/Kotlin) or `-`/`+` (Scala).** It documents intent and lets the compiler catch position mistakes.
- **When a signature nests, compute variance with sign multiplication.** Don't reason by gut feeling about `(A -> B) -> C`.
- **Turn on `strictFunctionTypes` in TypeScript.** It restores sound contravariant checking of standalone function parameters.
- **Prefer `Comparator<? super T>` / `Consumer<? super T>` in public APIs.** Contravariant bounds make your API accept more callers' types.
- **Prefer `? extends T` / `Iterator<? extends T>` for producers you return or read.** Covariant bounds make your API usable in more contexts.

---

## Edge Cases & Pitfalls

- **Method parameters in TypeScript are bivariant by default.** Even with `strictFunctionTypes`, *method* (not standalone function) parameters stay bivariant — a deliberate unsound concession. See `professional.md`.
- **Overriding vs overloading confusion.** Changing a parameter type in a subclass often creates an *overload*, not an override — so `@Override` (Java) or `override` (Kotlin/C#) is your safety net; use it.
- **Covariant return + generics + erasure → bridge methods.** On the JVM, a covariant-return override compiles to a synthetic bridge method. Usually invisible, but it shows up in stack traces and reflection.
- **Contravariance breaks naïve equality/`compareTo`.** `Comparable<T>` is often `Comparable<? super T>` precisely so a base-class `compareTo` works for subclasses. Forgetting the `? super` produces frustrating "cannot be applied" errors.
- **The nested flip surprises everyone.** A callback's parameter inside a higher-order function ends up *covariant*. If you "just feel" the variance you'll get it wrong; multiply signs.
- **Languages disagree on parameter contravariance in overrides.** Java/C#/C++ treat differing parameters as overloads; Scala and Eiffel allow genuine contravariant overriding. Don't assume portability.
- **`void`/`Unit` return is covariant too, trivially.** A function returning `Nothing`/`never` is a subtype of one returning anything — `Nothing` is the bottom type, a subtype of all.

---

## Test Yourself

1. Write the full function subtyping rule with `<:` for `(A1 -> B1) <: (A2 -> B2)`. Which slot is contravariant, which covariant?
2. Explain, using the caller's-contract argument, why a function with a *wider* parameter type is the subtype (not the supertype).
3. Java allows `Cat reproduce()` to override `Animal reproduce()`. What is this feature called, and why is it sound?
4. Why does Java treat `void handle(Cat)` in a subclass as an *overload* of `void handle(Animal)` rather than an override? What unsoundness would treating it as an override allow?
5. Compute the variance of the type parameter `T` in `(T -> Int) -> Int`. Show your sign multiplication.
6. In `Comparator<? super T>`, what does the `? super` buy you? Give a concrete case where dropping it causes a compile error.
7. TypeScript checks standalone function parameters contravariantly under `strictFunctionTypes`. Write a two-function example where this catches an unsound assignment.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                    FUNCTION VARIANCE                              │
├──────────────────────────────────────────────────────────────────┤
│   (A1 -> B1) <: (A2 -> B2)                                        │
│        iff  A2 <: A1   (PARAM:  contravariant — flip)            │
│        and  B1 <: B2   (RETURN: covariant     — same)           │
│                                                                   │
│   SLOGAN:  "accept more, return less"                            │
├──────────────────────────────────────────────────────────────────┤
│ OVERRIDE RULES (= function variance)                             │
│   return:  may NARROW   (covariant return)        ✓ widely OK    │
│   param:   may WIDEN    (contravariant param)     ✓ if supported │
│   return:  may NOT widen | param: may NOT narrow  ✗ unsound      │
│   "promise more, demand less"                                    │
├──────────────────────────────────────────────────────────────────┤
│ PER-POSITION VARIANCE                                            │
│   appears only in OUTPUT  -> covariant   (out / +)               │
│   appears only in INPUT   -> contravariant (in / -)              │
│   appears in BOTH         -> invariant   (0)                     │
│   Function<in A, out B> | Function1[-T1, +R]                     │
├──────────────────────────────────────────────────────────────────┤
│ NESTING: multiply signs                                         │
│   + × + = +     - × - = +     + × - = -     0 × _ = 0            │
│   (A -> B) -> C : A is (-)×(-) = (+) covariant                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A **function type** has two slots with opposite variances: it is **contravariant in its parameter** (consumer) and **covariant in its return** (producer). Formally, `(A1 -> B1) <: (A2 -> B2)` iff `A2 <: A1` and `B1 <: B2`.
- The slogan is **"accept more, return less"**: a function is a *better* substitute when it takes a wider input and produces a narrower output. This is the single most-tested variance fact.
- **Method overriding is function subtyping.** An override may **narrow its return** (covariant return types, legal in Java 5+, C#, Kotlin, C++) and, where the language supports it, **widen its parameter** (contravariant). It may never widen the return or narrow the parameter — both break LSP.
- Most OO languages treat a differently-typed override parameter as **overloading**, not overriding, which is why parameter contravariance is rarely seen outside Scala/Eiffel.
- **Variance is computed per type parameter** by where it appears: output-only → covariant (`out`/`+`), input-only → contravariant (`in`/`-`), both → invariant. `Function<in A, out B>` and Scala's `Function1[-T1, +R]` encode this directly.
- **Variance composes by sign multiplication.** A type parameter nested inside two contravariant positions becomes covariant (`−×− = +`). Always multiply signs for nested signatures like `(A -> B) -> C` rather than guessing.
- Practical payoffs: contravariant bounds (`? super T`, `in T`) make consuming APIs accept more callers; covariant bounds (`? extends T`, `out T`) make producing APIs usable in more places. Turn on TypeScript's `strictFunctionTypes` to get sound contravariant parameter checking.
- Next, `senior.md` covers declaration-site vs use-site variance in depth and the soundness machinery; `professional.md` covers the real-world holes (array covariance, TS bivariant methods) and how to engineer around them.

# Higher-Kinded Types — Junior Level

> **Topic:** [Higher-Kinded Types](README.md)
> **Focus:** Types have types too. Before you can write code that works for *any* container, you need a word for "the kind of thing `List` is" — and that word is **kind**.

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
14. [Further Reading](#further-reading)

---

## Introduction

> Focus: **What is a "kind"?** And **why would you ever want a type parameter that is itself a container, not a value?**

You already write **generic** code. `List<T>` works for any element type `T`: `List<Int>`, `List<String>`, `List<User>`. The `T` is a *hole* you fill with a concrete type. That is **abstraction over a type** — your code does not care *which* element type fills the hole.

Higher-kinded types ask a stranger question. What if the hole is not the *element* but the *container itself*? What if you could write one function that works for **any container** — `List`, `Maybe`/`Option`, `Either`, a `Future`, a tree — without naming which one? Not "any element type", but "any *thing that holds elements*". That is **abstraction over a type constructor**, and to even talk about it cleanly we need a vocabulary for the "shape" of types. That vocabulary is **kinds**.

Here is the one idea this whole page builds toward:

- `Int`, `String`, `Bool`, `User` are **complete, finished types**. You can have a value of type `Int`. Their kind is written `*` (say it "star", or "type").
- `List`, `Maybe`, `Option`, `Set` are **not** finished types. You cannot have a value of type "`List`". `List` of *what*? It is a *type that needs one more type* to become complete. It is a **type constructor**. Its kind is `* -> *` — "give me a type, I'll give you back a type".
- `Either`, `Map`, a pair `(A, B)` need **two** types to finish. Their kind is `* -> * -> *`.

A **higher-kinded type** is code that abstracts over something of kind `* -> *` — code that is generic in the *container*, the way ordinary generics are generic in the *element*.

> 🎓 **Why this matters for a junior:** You don't need to *write* higher-kinded code on day one. But the moment you read Haskell, Scala with the Cats library, or TypeScript with fp-ts, you'll hit `f a`, `F[_]`, or `Kind<F, A>` and wonder what kind of beast that is. Understanding *kinds* — the "types of types" — is the single concept that unlocks all of it. It is also one of the cleanest ways to deepen what "generic" really means.

This page stays gentle. We explain kinds with pictures and counting, show what "a function that works for any container" buys you, and meet — without mysticism — the famous trio `Functor`, `Applicative`, `Monad`, which are *the* reason higher-kinded types exist. The real Haskell and Scala mechanics live in `middle.md` and `senior.md`. Here we build intuition.

---

## Prerequisites

What you should know before reading this:

- **Required:** Generics in at least one language — `List<T>`, `Optional<T>`, `Map<K, V>`, or the equivalent. You should be comfortable with the idea of a type parameter.
- **Required:** What a function is, and that functions take inputs and return outputs.
- **Required:** Familiarity with at least one "container that might be empty or hold a value", such as Java `Optional`, Swift/Rust `Option`, or even nullable types.
- **Helpful but not required:** Having used `map` on a list (`[1,2,3].map(x => x + 1)`).
- **Helpful but not required:** Seeing `flatMap` (also called `bind`, `>>=`, `andThen`, or `SelectMany`) once before.

You do **not** need:

- Any Haskell or Scala yet. We introduce the syntax slowly.
- Category theory. The word "monad" comes from there, but you can use it without any of the math.
- The implementation tricks (defunctionalization, type lambdas) — those are senior/professional topics.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Type** | A set of values: `Int` is "all the integers", `Bool` is `{true, false}`. You can hold a value of a type. |
| **Type constructor** | A type that needs other types to become complete: `List`, `Maybe`, `Map`. Not a type by itself. |
| **Generic / parametric** | Code with type *holes* (`T`, `A`) that works for many element types. |
| **Kind** | The "type of a type". Tells you how many type arguments a type needs to be complete. |
| **`*`** ("star" / "type") | The kind of a complete type like `Int` or `String`. |
| **`* -> *`** | The kind of a one-argument type constructor like `List` or `Maybe`. |
| **`* -> * -> *`** | The kind of a two-argument type constructor like `Either` or `Map`. |
| **Higher-kinded type (HKT)** | Code that abstracts over a type constructor (something of kind `* -> *`), not just a type. |
| **Container / effect** | Informal name for an `F` of kind `* -> *`: it "wraps" a value of type `A` to make `F<A>`. |
| **`map` / `fmap`** | Transform the value(s) inside a container with a function, keeping the container shape. |
| **`flatMap` / `bind` / `>>=`** | Like `map`, but the function itself returns a container; the result is flattened so you don't get a container-of-containers. |
| **Functor** | Any container `F` that supports a lawful `map`. |
| **Monad** | A container `F` that supports `flatMap` and a way to wrap a plain value (`pure` / `of` / `return`), following laws. |
| **`pure` / `of` / `return`** | Put a plain value into the simplest possible container: `pure(3)` is `Some(3)` for `Option`, `[3]` for `List`. |

---

## Core Concepts

### 1. Types classify values; kinds classify types

Think of three levels:

```text
LEVEL 0  values:   3        "hi"        true        [1, 2, 3]
                    │          │           │            │
LEVEL 1  types:    Int      String      Bool        List<Int>
                    │          │           │            │
LEVEL 2  kinds:    *          *           *            *
```

A **type** answers "what values can this be?". `3` has type `Int`. A **kind** answers "what types can this be?" — it classifies the *types themselves*. A finished type like `Int` or `List<Int>` has kind `*`.

The key realization: **`List` by itself is not at level 1 next to `Int`.** `List` is incomplete. You can't store a "`List`" the way you store an `Int`. You can only store a `List<Int>` or a `List<String>`. So `List` lives one notch higher — it is a *function at the type level*.

### 2. Type constructors are functions that build types

Read `List` as a little machine:

```text
List : give me a type  -->  I return a finished type
       List(Int)   = List<Int>      ✅ a finished type, kind *
       List(String)= List<String>   ✅ a finished type, kind *
       List        =                ❌ not finished — still hungry for an argument
```

That "type-level function" has a kind that mirrors a normal function signature:

```text
List   :: * -> *          one type in, one type out
Maybe  :: * -> *          one type in, one type out
Set    :: * -> *
Either :: * -> * -> *     two types in (the error type and the value type)
Map    :: * -> * -> *     two types in (key and value)
Int    :: *               needs nothing — already a finished type
```

**Counting the arrows tells you how many type arguments are still missing.** `*` means "done". Each `* ->` means "still needs one more type".

### 3. "Higher-kinded" means a type parameter that is itself `* -> *`

Ordinary generics let you abstract over a *type* of kind `*`:

```text
function length<A>(xs: List<A>): Int     // A is any FINISHED type — kind *
```

A higher-kinded type lets you abstract over a *type constructor* of kind `* -> *`:

```text
function describe<F>(fa: F<String>): String   // F is any CONTAINER — kind * -> *
//                  ^ F could be List, Option, Future, Either<Err, _>, ...
```

Here `F` is not `Int` or `String`. `F` is *the box itself*, left as a hole. You're saying: "I'll work with `F<String>` for **whatever container `F` happens to be**." That is the whole game. Most mainstream languages (Java, Go, C#, Rust, TypeScript as of today's native syntax) **cannot** write that `F` hole — they only have the kind-`*` hole. Haskell and Scala can.

### 4. Why you'd want this: `map` is the same idea everywhere

Look at how `map` shows up across containers:

```text
List:    [1, 2, 3].map(x => x * 10)        ==>  [10, 20, 30]
Option:  Some(2).map(x => x * 10)          ==>  Some(20)
Option:  None.map(x => x * 10)             ==>  None
Either:  Right(2).map(x => x * 10)         ==>  Right(20)
Either:  Left("boom").map(x => x * 10)     ==>  Left("boom")   (untouched)
Future:  fetchAge().map(age => age + 1)    ==>  a Future of (age + 1)
```

In *every* case the shape is: **take a function `A -> B`, reach inside `F<A>`, apply it, hand back `F<B>`, leave the container's structure alone.** That repeated pattern is begging to be named once and reused. The name is **Functor**, and writing "the `map` that works for every `F`" *requires* a higher-kinded type — because you're abstracting over the container `F`.

### 5. Functor, in plain words

A **Functor** is any container `F` (kind `* -> *`) for which you can implement:

```text
map : (A -> B) -> F<A> -> F<B>
```

with two common-sense rules (the **functor laws**):

1. **Identity:** `xs.map(x => x)` returns `xs` unchanged. Mapping with "do nothing" does nothing.
2. **Composition:** `xs.map(f).map(g)` equals `xs.map(x => g(f(x)))`. Two maps fuse into one.

That's it. `List`, `Option`, `Either`, `Future`, trees — all are Functors. The laws are not bureaucracy; they're what lets you refactor `map` chains safely.

### 6. Monad, demystified: `flatMap` + `pure`

Sometimes the function you want to apply *itself returns a container*. Example: `parseInt : String -> Option<Int>`. If you `map` it over an `Option<String>`, you get `Option<Option<Int>>` — a box inside a box. Annoying.

**`flatMap`** (a.k.a. `bind`, `>>=`, `andThen`, `SelectMany`) is `map` followed by *flattening one layer*:

```text
flatMap : (A -> F<B>) -> F<A> -> F<B>
```

A **Monad** is a container `F` with:

- `flatMap` (chain a container-returning step), and
- `pure` / `of` (wrap a plain value: `pure(3)` is `Some(3)` for Option, `[3]` for List),

obeying a few laws. Concretely, here is what `flatMap` *does* per container — no mysticism:

```text
Option:  Some(2).flatMap(x => half(x))   where half(4)=Some(2), half(odd)=None
         Some(4).flatMap(half) = Some(2)        None.flatMap(half) = None
         "stop the chain the moment something is None"

List:    [1, 2].flatMap(x => [x, x*10]) = [1, 10, 2, 20]
         "run the rest for EVERY element and concatenate"

Either:  Right(2).flatMap(step) runs step; Left(e).flatMap(step) = Left(e)
         "short-circuit on the first error, carry it through"
```

So a monad is not magic. It is **"a container of kind `* -> * ` with a sane `flatMap` and `pure`"**, and `flatMap` is just "do the next step, then flatten". The reason it deserves a shared name — and the reason it needs higher-kinded types — is that `flatMap` has the *exact same signature* for `Option`, `List`, `Either`, `Future`, and dozens more. Write the abstraction once, get it for all of them.

### 7. The hierarchy: Functor → Applicative → Monad

These three stack, each adding power:

```text
Functor      can: map  (A -> B) over F<A>
   │  add the ability to combine independent F's
Applicative  can also: combine F<A> and F<B> into F<(A,B)>; lift pure values
   │  add the ability to let a later step DEPEND on an earlier result
Monad        can also: flatMap — sequence steps where step 2 depends on step 1's value
```

You don't need the details now. The shape to remember: **every Monad is an Applicative, every Applicative is a Functor.** More structure = more operations you're promising to provide.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **A type (`Int`)** | A specific, finished object you can hold — a single brick. |
| **A type constructor (`List`)** | A *mold* that stamps out bricks. The mold itself is not a brick; feed it material and it makes one. |
| **Kind `*`** | "This is a finished brick." |
| **Kind `* -> *`** | "This is a brick mold — needs one material to produce a brick." |
| **Kind `* -> * -> *`** | "This is a mold that needs two materials" (e.g. a two-tone brick mold). |
| **Higher-kinded function** | An instruction manual that works for *any mold*, not just one specific brick. |
| **`map`** | A gift-wrapping rule: "whatever is in the box, swap it for something else, keep the same box." |
| **Functor** | Any box you can apply that gift-wrapping rule to. |
| **`flatMap`** | "Open the box; the thing inside tells you to go to *another* box; merge them so you don't end up holding nested boxes." |
| **Monad** | A box that supports that open-and-merge rule plus a way to put a plain item into the simplest box. |
| **`pure`** | The simplest possible packaging: drop one item into a single-item box. |

The "mold vs brick" picture is the load-bearing one. **`List` is a mold, `List<Int>` is a brick.** Higher-kinded types are about writing instructions for molds.

---

## Mental Models

### The "count the holes" model

When you meet any type name, ask: *how many type arguments must I supply before I can store a value of it?*

- Zero holes → kind `*` → `Int`, `String`, `List<Int>`.
- One hole → kind `* -> *` → `List`, `Option`, `Future`.
- Two holes → kind `* -> * -> *` → `Either`, `Map`, pair.

A higher-kinded type is any code whose **type parameter still has a hole in it** — you're parameterizing over a one-hole (or more) thing.

### The "same shape, many boxes" model

Whenever you notice yourself writing the *same operation* against `List`, then against `Option`, then against `Either`, with only the box changing, you've found a place where a higher-kinded abstraction would let you write it **once**. `map` is the first such operation; `flatMap` is the second. The whole `Functor`/`Monad` machinery is "let me write this once for all boxes".

### The "ladder of power" model

Think of three rungs. `Functor` lets you transform inside a box. `Applicative` lets you combine *independent* boxes. `Monad` lets a later step *depend on* an earlier box's contents. Pick the lowest rung that does your job: don't demand `Monad` when `Functor` suffices. Lower rungs are more general and apply to more types.

---

## Code Examples

We stay light. The point is to *see* kinds and the shared shape, not to master Haskell yet.

### Seeing kinds (Haskell, read-only)

In a Haskell REPL you can literally ask for a type's kind with `:kind` (`:k`):

```haskell
ghci> :kind Int
Int :: *

ghci> :kind Maybe
Maybe :: * -> *

ghci> :kind Maybe Int      -- now we've supplied the argument
Maybe Int :: *

ghci> :kind Either
Either :: * -> * -> *

ghci> :kind Either String  -- supplied one of two; one hole remains
Either String :: * -> *
```

Notice `Either String` still has kind `* -> *`. Supplying *one* argument to a two-argument constructor leaves a one-argument constructor. This is exactly like a function: give a 2-argument function one argument and you get a 1-argument function back. Kinds behave the same way at the type level.

### The repeated shape of `map` (TypeScript, the part everyone already knows)

```typescript
// You have written all three of these. Stare at how similar they are.
[1, 2, 3].map(x => x + 1);              // Array<number> -> Array<number>

function mapOption<A, B>(o: A | null, f: (a: A) => B): B | null {
  return o === null ? null : f(o);      // Option-ish -> Option-ish
}

promise.then(x => x + 1);               // Promise<number> -> Promise<number>
```

Each one is `(A -> B) -> F<A> -> F<B>` for a different `F` (`Array`, the nullable, `Promise`). The *signature is identical* up to the container. A higher-kinded language lets you write the single function `map<F, A, B>(fa: F<A>, f: (a: A) => B): F<B>` and have it apply to all of them. TypeScript's native syntax cannot, because you cannot write `F<A>` with `F` left as a parameter — `middle.md` shows the clever encoding fp-ts uses to fake it.

### `flatMap` doing different jobs, same signature (pseudocode)

```text
// Option: short-circuit on absence
findUser(id)            // Option<User>
  .flatMap(u => u.emailVerified ? Some(u.email) : None)   // Option<Email>

// List: cartesian / non-determinism
[1, 2, 3].flatMap(n => [n, -n])         // [1, -1, 2, -2, 3, -3]

// Either: stop on first error, keep the error
parseConfig(text)                       // Either<Error, Config>
  .flatMap(cfg => validate(cfg))        // Either<Error, Config>
```

Three completely different runtime behaviors — short-circuit, cartesian product, error-propagation — yet **one shared signature** `(A -> F<B>) -> F<A> -> F<B>`. That shared signature is what `Monad` abstracts, and abstracting it needs higher-kinded types.

### A taste of writing the abstraction (Scala, just read it)

```scala
// "Functor" for ANY container F that has one hole. F[_] is the HKT part.
trait Functor[F[_]] {
  def map[A, B](fa: F[A])(f: A => B): F[B]
}

// One instance for Option, one for List. The CALLER's code below never
// mentions Option or List — only "some Functor F".
given Functor[Option] with
  def map[A, B](fa: Option[A])(f: A => B): Option[B] = fa.map(f)

given Functor[List] with
  def map[A, B](fa: List[A])(f: A => B): List[B] = fa.map(f)

// Generic over the container: works for Option, List, or anything with a Functor.
def bump[F[_]](fa: F[Int])(using F: Functor[F]): F[Int] =
  F.map(fa)(_ + 1)

bump(Some(41))      // Some(42)
bump(List(1, 2, 3)) // List(2, 3, 4)
```

`F[_]` in `Functor[F[_]]` is Scala's way of writing "F is a one-hole type constructor, kind `* -> *`". That underscore-in-brackets is a higher-kinded type. You'll learn to write these in `middle.md`/`senior.md`; for now, just notice that `bump` is **one function that runs for every container**.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Reuse** | Write `map`, `traverse`, validation, retry logic *once* and reuse across every container/effect. | The payoff only appears once you have several containers; for one container it's overkill. |
| **Abstraction** | Express "works for any effect `F`" — the basis of tagless-final, generic `traverse`, effect systems. | Adds a layer of indirection that can hide what's actually running. |
| **Type safety** | The compiler checks that your generic code is valid for *all* containers, not just the one you tested. | Error messages get long and abstract — "no Functor instance for F" baffles newcomers. |
| **Learnability** | Once internalized, a huge body of FP code becomes readable. | Steep ramp. Many engineers never need it; teams often ban it for onboarding cost. |
| **Language support** | First-class in Haskell, Scala, PureScript. | Absent in Java, Go, C#, Rust (native), TypeScript (native) — you either can't or must hack it. |

---

## Use Cases

Higher-kinded types earn their keep when:

- **You have many containers and the same operation across all of them.** Define `map`/`flatMap`/`traverse` once.
- **You want code generic over the "effect".** A function that works whether the effect is `Option` (maybe-missing), `Either` (maybe-error), `Future`/`IO` (async/side-effecting), or `List` (many results).
- **You're using a typed-FP library.** Scala's Cats/ZIO, Haskell's `base`/`mtl`, PureScript, TypeScript's fp-ts all lean on HKTs.
- **You want to write a single validation/parsing pipeline** that can run synchronously *or* asynchronously by swapping the effect type.

They are the **wrong** tool when:

- Your codebase has one or two containers and no plans for more — plain generics are simpler.
- Your team is unfamiliar with FP and onboarding speed matters more than maximal reuse.
- Your language doesn't support them and the encoding cost outweighs the benefit (often the case in Rust/TypeScript today).

---

## Coding Patterns

### Pattern 1: Reach for `map` before `flatMap`

If your transformation is a plain `A -> B`, use `map`. Use `flatMap` *only* when your step returns a container (`A -> F<B>`). Over-reaching for `flatMap` produces awkward code and demands more structure (Monad) than you need (Functor).

### Pattern 2: Read `F<_>` / `F[_]` / `f a` as "some container, unspecified"

When you see a one-hole type parameter, mentally substitute "any of List, Option, Either, Future…". The code is promising to behave for *all* of them.

### Pattern 3: Pick the lowest rung (Functor < Applicative < Monad)

Ask for the least powerful abstraction that does the job. If you only transform inside the box, require `Functor`. Asking for `Monad` everywhere needlessly narrows what types your function accepts.

### Pattern 4: Let the container handle absence/error, not `if`-ladders

`Option`/`Either` plus `map`/`flatMap` replace nested null checks and try/catch ladders with a flat chain that short-circuits automatically. That chaining is exactly what the Monad structure provides.

---

## Best Practices

- **Learn kinds before learning monads.** "Monad" is confusing until you've internalized that `F` is a `* -> *` thing. Count the holes first.
- **Don't say "monad" mystically.** It's a container with `flatMap` and `pure` obeying laws. If you can explain what `flatMap` does for `Option` and `List`, you understand monads.
- **Trust the laws when refactoring.** `map(f).map(g)` becomes `map(g ∘ f)`; a `flatMap` chain can be reordered per the monad laws. These rewrites are safe *because* the laws hold.
- **Prefer the standard `map`/`flatMap` on your language's built-in `Optional`/`Result`/`Stream`** to get comfortable, even before touching HKT libraries. You're already using Functors and Monads informally.
- **Don't introduce an HKT library into a team that isn't ready.** The abstraction tax is real. Make sure the reuse payoff is worth the onboarding cost.

---

## Edge Cases & Pitfalls

- **"`List` is a type" — no.** `List` is a *type constructor* (kind `* -> *`). `List<Int>` is the type. Saying "a value of type `List`" is a category error, like saying "a value of type `+`".
- **`map` returning nested containers.** Mapping an `F`-returning function gives `F<F<B>>`. That's the signal you wanted `flatMap`, which flattens one layer.
- **Confusing the three "highers".** *Higher-kinded* (abstract over type constructors), *higher-rank* (abstract over polymorphic functions), and *higher-order* (functions that take functions) are three different things. They share the word "higher" and nothing else. Senior pages disambiguate carefully; just don't assume they're the same.
- **Assuming every language can do this.** Java's `<T>` and Go's `[T any]` are kind-`*` only. You *cannot* write a general `Functor` in them; the type parameter can't itself be a one-hole constructor. This is a real, hard limitation, not an oversight you can work around with more generics.
- **Thinking monads are about side effects.** `Option` and `List` are monads with zero side effects. The monad structure is about *sequencing and flattening*, not I/O — though it's famously *used* to sequence I/O in Haskell.
- **Forgetting the laws.** A type with a `map` that secretly reorders or drops elements is *not* a lawful Functor, and generic code built on Functor will misbehave. Laws are part of the contract.

---

## Summary

- **Types classify values; kinds classify types.** A finished type like `Int` has kind `*`.
- **Type constructors are type-level functions.** `List` and `Maybe` have kind `* -> *` (one hole); `Either` and `Map` have kind `* -> * -> *` (two holes). Count the arrows to count the missing arguments.
- **A higher-kinded type abstracts over a type *constructor*** (a `* -> *` thing), not just a type — it's "generic in the container", not merely "generic in the element".
- **The motivation is the repeated shape of `map` and `flatMap`** across `List`, `Option`, `Either`, `Future`. The same signature appears everywhere; HKTs let you write it once.
- **Functor** = container with a lawful `map`. **Monad** = container with `flatMap` + `pure` obeying laws; `flatMap` just "runs the next step and flattens". The hierarchy is **Functor → Applicative → Monad**, each adding power.
- **`flatMap` is concrete, not magic:** short-circuit for `Option`, error-propagate for `Either`, cartesian-product for `List`.
- **Haskell and Scala have HKTs natively; Java, Go, C#, Rust (native), and TypeScript (native) do not** — a limitation we explore in later pages.
- **Junior takeaway:** master the word *kind* and the "count the holes" habit. Everything else builds on it.

---

## Further Reading

- *Learn You a Haskell for Great Good!* — Miran Lipovača. The gentlest on-ramp to Functors and Monads. http://learnyouahaskell.com/
- *Functional Programming in Scala* ("the red book") — Chiusano & Bjarnason. Builds Functor/Monad from scratch.
- *Haskell Programming from First Principles* — Allen & Moronuki. Careful, slow, excellent on kinds.
- *Category Theory for Programmers* — Bartosz Milewski. For the curious; not required. https://bartoszmilewski.com/
- The fp-ts documentation (TypeScript) — shows the same ideas in a language many juniors already use. https://gcanti.github.io/fp-ts/
- *What I Wish I Knew When Learning Haskell* — Stephen Diehl. A map of the territory.

# Higher-Kinded Types — Middle Level

> **Topic:** [Higher-Kinded Types](README.md)
> **Focus:** From "kinds exist" to *writing* code generic over a container. The `Functor`/`Applicative`/`Monad` typeclass hierarchy in real Haskell and Scala, the laws, and the first encoding tricks for languages that lack native HKTs.

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

> Focus: **How do you actually express "for all containers `F`"?** And **what are the typeclasses Functor / Applicative / Monad, with their laws, in code you can run?**

At the junior level you learned the vocabulary: kinds (`*`, `* -> *`, `* -> * -> *`), type constructors as type-level functions, and the *intuition* that a higher-kinded type abstracts over a container `F`. This level makes it concrete. You will see:

- The **typeclass mechanism** — Haskell's `class`/`instance` and Scala's `trait` + given/implicit — that lets you *declare* "any `F` that supports `map`" and *provide* `map` per container.
- The **Functor → Applicative → Monad** hierarchy written out, with the exact method signatures and the **laws** each must obey.
- Concrete instances for `Option`/`Maybe`, `List`, `Either`, and a `Pair`, so the abstractions never float free of examples.
- Why two-argument constructors like `Either` need **partial application at the type level** to fit a `* -> *` slot, and how Scala (`Either[E, *]`) and Haskell express that.
- A first look at the **encoding problem**: how languages without native HKTs (TypeScript, Kotlin) *simulate* them, and why it's awkward.

The throughline: **a higher-kinded type is a type parameter whose own kind is `* -> *`.** Everything here is a consequence of taking that seriously.

> Engineering reality: this is where teams split. Used well, HKT-based abstractions remove enormous duplication (one `traverse` instead of twenty). Used carelessly, they produce code only the author can read. By the end of this page you should be able to *read* Cats/Haskell code fluently and *write* a `Functor`/`Monad` instance — and judge when not to.

---

## Prerequisites

- **Required:** The junior page — kinds, type constructors, the "count the holes" model, and the informal notion of `map`/`flatMap`.
- **Required:** Generics with bounds/constraints in some language (`<T extends Comparable<T>>`, Rust trait bounds, or Scala/Haskell typeclass constraints). HKT typeclasses are "generics with a constraint that happens to be over a `* -> *` parameter".
- **Required:** Comfort reading at least one of Haskell or Scala syntax at a basic level. We provide both.
- **Helpful:** Having used Java `Optional.map/flatMap`, Rust `Option::map/and_then`, or JS `Promise.then` — these are Functor/Monad operations under other names.
- **Helpful:** Knowing what "currying" and "partial application" mean for ordinary functions; we reuse the idea at the type level.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Typeclass** | A named bundle of operations a type can implement (Haskell `class`, Scala `trait`). Like an interface, but you can add instances *after the fact* and they can be higher-kinded. |
| **Instance** | A concrete implementation of a typeclass for a specific type (`instance Functor Maybe`). |
| **Constraint / context** | "This code requires `F` to be a Functor", written `Functor f =>` (Haskell) or `(using Functor[F])` (Scala). |
| **`Functor`** | Typeclass with `map`/`fmap :: (a -> b) -> f a -> f b`, obeying identity & composition laws. |
| **`Applicative`** | Adds `pure :: a -> f a` and `ap`/`<*> :: f (a -> b) -> f a -> f b` — combine independent effects. |
| **`Monad`** | Adds `flatMap`/`>>= :: f a -> (a -> f b) -> f b` (and `pure`). Sequence dependent effects. |
| **`pure` / `return` / `of`** | Lift a plain value into the minimal container. (`return` in Haskell is *not* control-flow return.) |
| **`<$>`** | Infix `fmap` in Haskell: `f <$> fa == fmap f fa`. |
| **`<*>`** | Infix `ap` ("apply"), the Applicative combine operator. |
| **`>>=`** | Infix `flatMap`/`bind`, the Monad sequencing operator (pronounced "bind"). |
| **Kind signature** | `Functor :: (* -> *) -> Constraint` — Functor is a typeclass *over one-hole constructors*. |
| **Type lambda** | An anonymous, partially-applied type constructor, e.g. Scala `[X] =>> Either[E, X]`, to fit a `* -> *` slot. |
| **Defunctionalization** | Encoding type-level functions as data + a separate "apply" — the trick TypeScript/Kotlin use to fake HKTs. |

---

## Core Concepts

### 1. A typeclass can be parameterized by a `* -> *` type

An ordinary interface abstracts over a *type* of kind `*`. A higher-kinded typeclass abstracts over a *type constructor* of kind `* -> *`. In Haskell the kind is visible:

```haskell
class Functor f where
  fmap :: (a -> b) -> f a -> f b
--          ^a,b are kind *      ^f is applied to a type, so f :: * -> *
```

The compiler **infers** that `f` must have kind `* -> *` because you write `f a` (you apply `f` to a type). You cannot make `f` be `Int` here — `Int a` is nonsense (`Int` takes no arguments). This is the type-level analogue of an arity check.

In Scala the kind is written explicitly with `F[_]`:

```scala
trait Functor[F[_]]:
  def map[A, B](fa: F[A])(f: A => B): F[B]
//      F[_] declares F :: * -> *
```

`F[_]` means "F is a unary type constructor". Without the underscore, `Functor[F]` would demand `F :: *` and you couldn't write `F[A]`.

### 2. Functor: the laws are the contract

`map`/`fmap` must satisfy:

```text
1. Identity:     fmap id == id
                 fmap (\x -> x) fa  ==  fa
2. Composition:  fmap (g . f) == fmap g . fmap f
                 fmap (\x -> g (f x)) fa  ==  fmap g (fmap f fa)
```

These say "`map` only touches the contents, never the structure". A `map` for a list that reversed the list would *type-check* but **break the laws**, and any generic code assuming lawful Functors could then be wrong. The laws are not optional decoration — they are the part the compiler *can't* check and you must.

### 3. Applicative: combine independent effects

`Functor` can lift `A -> B` into `F<A> -> F<B>`. But what about a two-argument function `A -> B -> C` and two independent effects `F<A>`, `F<B>`? You can't get there with `map` alone. **Applicative** adds exactly that:

```haskell
class Functor f => Applicative f where
  pure  :: a -> f a
  (<*>) :: f (a -> b) -> f a -> f b
```

`pure` injects a value; `<*>` ("ap") applies a wrapped function to a wrapped argument. With them you can lift any n-ary function:

```haskell
-- combine two independent Maybe values with (+)
(+) <$> Just 3 <*> Just 4   == Just 7
(+) <$> Just 3 <*> Nothing  == Nothing      -- any Nothing kills the result
```

The defining trait: the effects are **independent**. `F<B>` does not depend on the *value* inside `F<A>` — only their structures combine. That independence is why Applicative can do things Monad can't always do efficiently (batch, parallelize, accumulate *all* errors).

### 4. Monad: let a later step depend on an earlier result

`Applicative` combines independent effects. **Monad** adds the power for a later effect to *depend on the value produced by an earlier one*:

```haskell
class Applicative m => Monad m where
  (>>=) :: m a -> (a -> m b) -> m b   -- "bind" / flatMap
  -- return = pure
```

The function `a -> m b` receives the *unwrapped* `a` and chooses the next effect based on it. That's the difference: in `<*>` the second effect is fixed up front; in `>>=` it's computed from the first effect's result.

```haskell
lookupUser id      >>= \user ->     -- Maybe User
lookupAddress user >>= \addr ->     -- the address LOOKUP depends on `user`
pure (format addr)
```

### 5. The monad laws

`>>=` and `pure` must obey:

```text
Left identity:   pure a >>= f      ==  f a
Right identity:  m >>= pure        ==  m
Associativity:   (m >>= f) >>= g   ==  m >>= (\x -> f x >>= g)
```

Left identity: wrapping then binding is just calling. Right identity: binding with `pure` changes nothing. Associativity: how you parenthesize a chain doesn't matter — this is what makes `do`-notation / for-comprehensions well-defined.

### 6. Concrete instances (the whole point)

Here is `Maybe` as Functor/Applicative/Monad, end to end:

```haskell
instance Functor Maybe where
  fmap _ Nothing  = Nothing
  fmap f (Just x) = Just (f x)

instance Applicative Maybe where
  pure = Just
  Nothing  <*> _ = Nothing
  Just f   <*> m = fmap f m

instance Monad Maybe where
  Nothing  >>= _ = Nothing          -- short-circuit on absence
  Just x   >>= f = f x              -- feed x into the next step
```

And `Either e` (note: `Either` is `* -> * -> *`, so we fix the error type `e` and the *constructor* `Either e` has kind `* -> *`):

```haskell
instance Monad (Either e) where
  Left  err >>= _ = Left err        -- short-circuit, carry the error
  Right x   >>= f = f x
```

And `[]` (list), where `>>=` is "for each element, run the function, concatenate":

```haskell
instance Monad [] where
  xs >>= f = concat (map f xs)      -- [1,2] >>= \x -> [x,x] == [1,1,2,2]
```

Same three signatures, three completely different behaviors. *That* is what higher-kinded abstraction buys: generic code over `m` runs against all of them.

### 7. Partial application at the type level (the `Either e` subtlety)

`Functor`/`Monad` demand a `* -> *` argument, but `Either :: * -> * -> *` and `Map :: * -> * -> *` have *two* holes. You make them fit by **fixing all but the last argument**, leaving one hole:

```text
Either        :: * -> * -> *
Either String :: * -> *          ✅ now it fits a Functor/Monad slot
```

Haskell does this with plain partial application: `instance Functor (Either e)`. Scala needs a **type lambda** because you can't write a "partially applied type" inline as easily:

```scala
// Scala 3 type lambda: "fix E, leave one hole X"
type EitherE[E] = [X] =>> Either[E, X]
given [E]: Functor[[X] =>> Either[E, X]] with
  def map[A, B](fa: Either[E, A])(f: A => B): Either[E, B] = fa.map(f)
```

This is the type-level mirror of currying: `Either` is "curried", and supplying one argument yields a one-hole constructor.

### 8. The encoding problem (languages without native HKTs)

TypeScript and Kotlin cannot write `F<A>` with `F` as a parameter. They fake it via **defunctionalization** (the "lightweight higher-kinded polymorphism" trick, popularized by Yallop & White and used by fp-ts):

- Represent each type constructor by a unique *tag* (a marker type).
- Define one indexed type `Kind<F, A>` ("the type you get by applying constructor `F` to `A`") via a lookup table interface.
- Each real constructor registers itself in that table.

```typescript
// fp-ts-style sketch (simplified)
interface URItoKind<A> {        // the "apply" table, extended by declaration merging
  Option: Option<A>;
  Array:  Array<A>;
}
type URIS = keyof URItoKind<unknown>;        // the set of constructor tags
type Kind<F extends URIS, A> = URItoKind<A>[F];  // "F applied to A"

interface Functor<F extends URIS> {
  map<A, B>(fa: Kind<F, A>, f: (a: A) => B): Kind<F, B>;
}
```

It works, and it's type-safe, but it's verbose, the error messages are rough, and you constantly pass the `F` tag around by hand. We go deeper in `senior.md`. The lesson: **HKTs can be *encoded* almost anywhere, but only native support makes them ergonomic.**

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Typeclass (`Functor`)** | A certification standard: "to be Functor-certified, your container must provide a lawful `map`". |
| **Instance** | A specific product passing the certification — `Maybe` is Functor-certified, `List` is Functor-certified. |
| **Constraint `Functor f =>`** | A job posting: "applicant `F` must hold the Functor certification to apply for this generic function". |
| **Functor** | A translator who changes the contents of a sealed package without opening the box's design. |
| **Applicative** | A jig that bolts two *independently prepared* parts together; neither part's shape depends on the other. |
| **Monad** | An assembly line where step 2's blueprint is chosen based on what step 1 produced. |
| **Partial type application (`Either e`)** | A two-knob machine with one knob pre-set at the factory, sold as a one-knob machine. |
| **Defunctionalization** | A coat-check: you can't hand the cloakroom your whole coat *constructor*, so you hand it a numbered ticket (tag) and a lookup desk reunites ticket with coat. |

---

## Mental Models

### The "interface, but the parameter is a container" model

You already understand `interface Comparable<T>`. A higher-kinded typeclass is `interface Functor<F<_>>` — the *only* new thing is that the type parameter `F` has a hole in it. Everything else (declare operations, provide instances, constrain generic code) is familiar.

### The "ladder of independence vs dependence" model

- **Functor** — one effect, transform its contents.
- **Applicative** — many **independent** effects, combine them. (Order doesn't create dependency; great for parallelism and error accumulation.)
- **Monad** — many **dependent** effects, each chosen from the previous result. (Forces sequencing.)

When you choose a constraint, you're choosing how much *dependency* your code is allowed to introduce. Less is more general.

### The "currying at the type level" model

Functions curry: `f : A -> B -> C` partially applies to `f a : B -> C`. Types curry too: `Either : * -> * -> *` partially applies to `Either E : * -> *`. The instant you see a two-hole constructor used where one hole is expected, look for a fixed first argument.

---

## Code Examples

### Generic code over an arbitrary Monad (Haskell)

```haskell
-- Works for Maybe, Either e, [], IO, State s, ... ANY Monad.
twiceThenAdd :: Monad m => m Int -> m Int
twiceThenAdd mx = do
  x <- mx          -- desugars to  mx >>= \x ->
  y <- mx          --              mx >>= \y ->
  pure (x + x + y)

-- main> twiceThenAdd (Just 5)         == Just 15
-- main> twiceThenAdd Nothing          == Nothing
-- main> twiceThenAdd [1,2]            == [3,4,4,5, 4,5,5,6]  (cartesian!)
```

One definition; the behavior changes with the container. `[1,2]` produces a cartesian explosion because list-bind is non-determinism. That single example shows both the power *and* the danger of being generic over `m`.

### The same in Scala with Cats

```scala
import cats.Monad
import cats.syntax.all.*

def twiceThenAdd[F[_]: Monad](fx: F[Int]): F[Int] =
  for {
    x <- fx
    y <- fx
  } yield x + x + y

twiceThenAdd(Option(5))            // Some(15)
twiceThenAdd(List(1, 2))           // List(3,4,4,5, 4,5,5,6)
twiceThenAdd(Right[String, Int](5))// Right(15)
```

`[F[_]: Monad]` reads "for any one-hole constructor `F` that has a `Monad` instance". The for-comprehension is sugar over `flatMap`/`map`, exactly like Haskell `do`.

### Applicative accumulates ALL errors; Monad stops at the first

```scala
import cats.data.Validated      // Applicative that accumulates
import cats.data.Validated.{Valid, Invalid}
import cats.syntax.all.*

def check(name: String, age: Int): Validated[List[String], (String, Int)] = {
  val n = if (name.nonEmpty) name.valid else List("empty name").invalid
  val a = if (age >= 0) age.valid else List("negative age").invalid
  (n, a).mapN((_, _))            // Applicative combine — runs BOTH checks
}

check("", -1)   // Invalid(List("empty name", "negative age"))  -- BOTH errors
```

A `Monad`/`Either` chain would short-circuit and report only `"empty name"`. This is the headline reason Applicative is its own rung: **independent effects can be combined to gather everything, not just the first failure.**

### Writing a Monad instance and checking a law (Haskell)

```haskell
newtype Identity a = Identity { runIdentity :: a }

instance Functor Identity where
  fmap f (Identity a) = Identity (f a)
instance Applicative Identity where
  pure = Identity
  Identity f <*> Identity a = Identity (f a)
instance Monad Identity where
  Identity a >>= f = f a

-- Left identity check:  pure 5 >>= f  ==  f 5
--   pure 5 >>= f  =  Identity 5 >>= f  =  f 5   ✅
```

`Identity` is the "no effect" monad — useful as a base case and for testing generic code.

### The TypeScript encoding, used

```typescript
// Given the Kind/URItoKind machinery from Core Concept 8:
const functorArray: Functor<'Array'> = {
  map: (fa, f) => fa.map(f),
};
const functorOption: Functor<'Option'> = {
  map: (fa, f) => (fa._tag === 'None' ? fa : some(f(fa.value))),
};

// Generic consumer — note we pass the instance explicitly (no implicit resolution)
function bump<F extends URIS>(F: Functor<F>, fa: Kind<F, number>): Kind<F, number> {
  return F.map(fa, (x) => x + 1);
}
bump(functorArray, [1, 2, 3]);   // [2, 3, 4]
```

Compare with Scala's `[F[_]: Monad]`: in TypeScript you thread the instance and the tag by hand. It works, it's sound, it's just heavier — which is exactly why HKTs feel native in Haskell/Scala and bolted-on elsewhere.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Code reuse** | One `traverse`, `sequence`, `foldMap`, validation pipeline reused across every effect. | Reuse only pays off past a threshold of containers; below it, plain code is clearer. |
| **Precision of constraints** | Demanding `Functor` vs `Applicative` vs `Monad` documents exactly how much power a function uses. | Picking the wrong rung (over-asking `Monad`) needlessly restricts callers. |
| **Law-based reasoning** | Laws license safe refactors (`map`/`map` fusion, bind reassociation). | Laws are *unchecked by the compiler*; a buggy instance silently breaks generic code. |
| **Ecosystem** | Cats, ZIO, Haskell `base`, fp-ts give batteries-included instances. | Heavy dependency and a large conceptual surface for a team to absorb. |
| **Native vs encoded** | Native (Haskell/Scala) is ergonomic. | Encoded (TS/Kotlin) is verbose, leaks tags, and gives worse errors. |

---

## Use Cases

- **Generic `traverse`/`sequence`:** turn a `List<F<A>>` into an `F<List<A>>` for any Applicative `F` — validate a list of inputs, run a list of async calls, etc., with one function.
- **Effect-polymorphic business logic:** write `program[F[_]: Monad](...)` once and run it with `Option`, `Either`, `IO`, `Future`, or a test `Id` monad.
- **Error-accumulating validation:** use an Applicative (`Validated`) to collect *all* form errors instead of bailing on the first.
- **Library design:** expose `map`/`flatMap`/`traverse` so users' own types plug into your combinators by providing instances.

Avoid when: you have a single concrete effect, your team isn't fluent in typeclasses, or your language lacks native support and the encoding cost dominates.

---

## Coding Patterns

### Pattern 1: Constrain to the weakest typeclass that compiles

Start a generic function with `Functor`. If you need to combine independent effects, widen to `Applicative`. Only widen to `Monad` when a step genuinely depends on a previous result. This maximizes the set of types your function accepts.

### Pattern 2: Fix extra type arguments to reach `* -> *`

To give a Functor/Monad instance for `Either`, `Map`, or `Validated`, fix all but the last type parameter (`Either E`, type lambda `[X] =>> Either[E, X]`). The "effect" is always the *last* hole.

### Pattern 3: Use `do`/for-comprehension for readable bind chains

`do` (Haskell) and `for { ... } yield` (Scala) desugar to `>>=`/`flatMap`. Prefer them over hand-written bind ladders for sequential, dependent steps; they read like imperative code while staying generic over `m`.

### Pattern 4: Reach for Applicative when you want all errors / parallelism

If sub-computations are independent, model them with Applicative so you can accumulate failures or run them concurrently — capabilities a Monadic chain forfeits by sequencing.

---

## Best Practices

- **Verify instances against the laws** — by hand for small types, with property-based tests (`Discipline` in Cats, QuickCheck in Haskell) otherwise. An unlawful instance is a landmine for every generic caller.
- **Prefer existing instances** from Cats/Haskell `base`/fp-ts over rolling your own; they're law-tested.
- **Document the kind** when you introduce a new type constructor: is it `* -> *`? Two holes fixed to one? Make it obvious.
- **Don't over-abstract.** If a function is only ever called with `Option`, don't make it `[F[_]: Monad]`. Generalize when a *second* concrete use appears, not before.
- **Teach `flatMap` concretely.** When onboarding, explain what bind *does* for `Option`/`Either`/`List` before invoking the word "monad".
- **In encoded HKT (TS/Kotlin), isolate the machinery.** Keep the `Kind`/tag plumbing in one module so application code sees clean `F`-generic signatures.

---

## Edge Cases & Pitfalls

- **Unlawful instances type-check.** The compiler verifies the *signatures*, never the *laws*. A Functor whose `map` drops elements compiles fine and silently corrupts generic code. Test the laws.
- **List monad's combinatorial blow-up.** `>>=` for lists is a cartesian product; an innocent generic function can explode from `O(n)` to `O(n^k)` when instantiated at `[]`. Generic-over-`m` code hides its runtime cost.
- **`pure`/`return` ambiguity.** Haskell `return` is `pure`, not control flow. Scala's `pure` needs the target `F` known (`3.pure[Option]`) or inference fails.
- **`Set` is not a lawful Functor (in general).** `Set` requires `Ord`/`Eq` on its elements, so it can't satisfy `Functor`'s "works for *any* element type" signature without constraints — a classic "looks like a Functor but isn't" trap.
- **Two-hole confusion.** Forgetting to fix the extra argument (`Functor Either` instead of `Functor (Either e)`) is a kind error: you'd be feeding a `* -> * -> *` where `* -> *` is required.
- **Applicative vs Monad for errors.** Using a Monad where you wanted *all* errors gets you only the first. Reach for Applicative/`Validated` deliberately.
- **Scala implicit/`given` resolution failures** produce intimidating "could not find implicit Monad[F]" errors — usually a missing import (`cats.syntax.all.*`) or a `F[_]` that has no instance, not a logic bug.

---

## Summary

- A **higher-kinded typeclass** is an interface whose type parameter is itself a `* -> *` constructor. Haskell infers the kind from `f a`; Scala declares it with `F[_]`.
- **Functor** (`map`/`fmap`), **Applicative** (`pure` + `<*>`), **Monad** (`>>=`) form a hierarchy of increasing power: transform inside one effect → combine **independent** effects → sequence **dependent** effects.
- Each layer carries **laws** the compiler can't check (identity/composition for Functor; left/right identity and associativity for Monad). Lawful instances are the contract that makes generic code correct.
- Concrete instances ground everything: `Maybe`/`Either` short-circuit, `[]` does cartesian non-determinism — *same signatures, different behavior*.
- Two-argument constructors like `Either` and `Map` fit a `* -> *` slot by **fixing all but the last type argument** — type-level partial application (`Either e`, Scala type lambdas).
- **Applicative earns its own rung** by combining independent effects: it can accumulate *all* errors and parallelize, where Monad must sequence and short-circuit.
- Languages without native HKTs **encode** them via defunctionalization (`Kind<F, A>` + tags, as in fp-ts) — sound but verbose; native support (Haskell/Scala) is what makes them ergonomic.
- The senior skill is knowing the **weakest constraint** that works and the **runtime cost** hiding behind a generic `m`.

---

## Further Reading

- *Functional Programming in Scala* — Chiusano & Bjarnason. Chapters on Functor/Applicative/Monad/Traverse built from scratch.
- *Programming in Haskell* — Graham Hutton. Clear, formal treatment of the typeclass hierarchy and laws.
- The Typeclassopedia — Brent Yorgey. The canonical map of Haskell's typeclass hierarchy. https://wiki.haskell.org/Typeclassopedia
- Cats documentation — Functor, Applicative, Monad, Traverse, Validated. https://typelevel.org/cats/
- *Lightweight Higher-Kinded Polymorphism* — Yallop & White. The paper behind the defunctionalization encoding. https://www.cl.cam.ac.uk/~jdy22/papers/lightweight-higher-kinded-polymorphism.pdf
- fp-ts docs — the encoding in a mainstream language. https://gcanti.github.io/fp-ts/

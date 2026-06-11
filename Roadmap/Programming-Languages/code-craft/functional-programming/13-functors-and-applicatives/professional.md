# Functors & Applicatives (Professional Level)

> **Roadmap:** [Functional Programming](../README.md) → Functors & Applicatives
>
> *A functor is a structure-preserving map; an applicative is a lax monoidal functor. By this level you can state both as equational laws and prove an instance lawful. The professional questions are different: what *exactly* do the laws guarantee a refactorer, why is `Validation` an applicative-but-not-a-monad as a theorem rather than a convention, what does each `ap` cost the allocator, and when does `traverse` over a large structure become the performance problem a profiler blames on "GC"?*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Functor Laws, Formally](#the-functor-laws-formally)
4. [Applicative as a Lax Monoidal Functor](#applicative-as-a-lax-monoidal-functor)
5. [The Applicative Laws, Formally](#the-applicative-laws-formally)
6. [Why `Validation` Is Not a Monad — a Proof Sketch](#why-validation-is-not-a-monad--a-proof-sketch)
7. [`Traversable`: `traverse`, `sequenceA`, and Their Laws](#traversable-traverse-sequencea-and-their-laws)
8. [Composing Functors and Applicatives](#composing-functors-and-applicatives)
9. [Runtime: Allocation per `map` and `ap`](#runtime-allocation-per-map-and-ap)
10. [Measurement](#measurement)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **the algebra that makes this code refactorable, and the runtime price of the abstraction.** `senior.md` taught you *when* to descend from monad to applicative and *why* the weaker abstraction buys accumulation and parallelism. This file goes one layer down in two directions: upward into the laws (functor, applicative, traversable — stated equationally, with the `Validation`-is-not-a-monad result proven, not asserted), and downward into the runtime (what `map`/`ap`/`traverse` allocate, how compilers claw it back, and when a traversal becomes a measurable cost).

Three things separate a professional treatment from the senior one:

1. **The laws are the contract, stated precisely.** "A functor is a structure-preserving map" and "an applicative is a lax monoidal functor" are not slogans — they are equational specifications. The functor identity/composition laws are *exactly* what license map fusion and chained-`map` refactors; the applicative laws are *exactly* what make `f <$> a <*> b <*> c` well-defined regardless of grouping. Break a law and a refactoring that "obviously can't change anything" silently does.

2. **`Validation`-is-applicative-but-not-monad is a theorem.** The senior file stated it; here we sketch the proof. It follows from a *coherence* requirement (the applicative derived from a monad must agree with the type's own applicative) plus the fact that accumulating `ap` and short-circuiting `ap` are observably different functions. This is the cleanest possible demonstration that the ladder's rungs are *mathematically* distinct, not just stylistically.

3. **The cost is real and measurable.** Every `map` and `ap` in a naive implementation allocates: a new wrapper, often a closure. A `traverse` over an N-element structure allocates O(N) intermediate effects. On the JVM that's young-generation pressure; in a hot path it's the cost a profiler attributes to GC. Compilers fight back — GHC fuses `traverse`, the JIT scalar-replaces short-lived `Optional`s — but only inside the shapes they can prove. Knowing which shapes optimize is the professional skill.

> **The mental model:** a functor/applicative is a *contract with two readers.* The first is the next engineer, who relies on the **laws** to refactor `traverse`/`<*>`/`map` chains safely. The second is the optimizer (GHC's simplifier, the JIT, V8), which can only erase the abstraction's allocation cost when your `map`/`ap` stay inlinable and non-escaping. Honor both.

---

## Prerequisites

- **Required:** Fluent with [`senior.md`](senior.md) — you can choose applicative-vs-monad by the independent/dependent test and explain why `Validation` accumulates while `Either` short-circuits.
- **Required:** [`middle.md`](middle.md) — you can implement `map`/`ap`/`pure` for a custom type and have met the laws informally.
- **Required:** A working model of a managed runtime: heap vs stack, generational GC, JIT inlining and escape analysis (see [Bad Structure → professional](../../anti-patterns/01-development/01-bad-structure/professional.md) for the vocabulary).
- **Required:** You can read a JMH benchmark and a `benchstat` comparison and tell signal from noise.
- **Helpful:** Exposure to one lazy language (Haskell) — `traverse` fusion and strictness are clearest there. Familiarity with [Monads — Plain English: professional](../09-monads-plain-english/professional.md) for the rung above.
- **Helpful:** the `profiling-techniques`, `memory-leak-detection`, and `big-o-analysis` skills for the measurement vocabulary.

> **Discipline carried over from the runtime track:** if you cannot name the instrument that would *falsify* a performance claim about a `traverse`, you are guessing. Every cost below is paired with the tool that proves it on *your* code; illustrative numbers are labeled as such.

---

## The Functor Laws, Formally

A **functor** is a type constructor `F` with an operation `fmap :: (a -> b) -> F a -> F b` satisfying two equations. Write `id` for the identity function and `.` for composition (`(g . f) x = g (f x)`).

```text
(F1)  Identity:     fmap id        ≡  id
(F2)  Composition:  fmap (g . f)   ≡  fmap g . fmap f
```

Read these as equalities *of functions on `F a`* — they hold for every input box, not just some.

- **(F1)** says `fmap` of the do-nothing function *is* the do-nothing function on the whole box. This forbids any `fmap` that perturbs structure: a `map` that reverses a list, drops an element, or fills in a `None` would make `fmap id ≠ id` and fail to be a functor.
- **(F2)** says mapping a composition equals composing the maps. This is precisely **map fusion**: `fmap g . fmap f` (two passes, two intermediate structures) equals `fmap (g . f)` (one pass, none). It is what lets a stream library or compiler collapse `.map(f).map(g)` — and what lets *you* hand-fuse it without changing behavior.

A subtle but important theorem: **for a lawful functor in a parametric (Hindley–Milner) setting, (F2) follows from (F1).** By parametricity (the "free theorem" for `fmap`'s type), any total `fmap` satisfying identity automatically satisfies composition. So in Haskell-like languages there is, up to the laws, *at most one* lawful `Functor` instance per type — the instance is *determined* by the type. This is why `deriving Functor` is sound and why you essentially never have a "choice" of functor: structure-preservation pins it down.

```haskell
-- A LAWFUL functor and a LAW-BREAKER, side by side.
-- Lawful: Identity preserves structure.
instance Functor [] where
  fmap = map                       -- fmap id = id ✓, fmap (g.f) = fmap g . fmap f ✓

-- Law-breaking (NOT a real instance): an fmap that reverses violates (F1).
-- fmapBad id [1,2,3] = reverse [1,2,3] = [3,2,1] ≠ [1,2,3]  → NOT a functor.
fmapBad :: (a -> b) -> [a] -> [b]
fmapBad f = reverse . map f        -- looks like fmap, isn't lawful
```

> **What the laws buy a refactorer:** any sequence of `map`s can be fused, reordered into a single map, split, or hoisted, with a *guarantee* of identical behavior — no re-testing of semantics required. That guarantee is the entire practical value of the abstraction being *lawful* rather than merely *having a method called `map`*.

---

## Applicative as a Lax Monoidal Functor

The slogan "an applicative is a lax monoidal functor" is worth unpacking, because it explains *why* applicatives compose, parallelize, and accumulate, and where the laws come from.

There are two equivalent presentations of `Applicative`:

**The `ap` presentation** (the one you use day to day):

```text
pure :: a -> F a
(<*>) :: F (a -> b) -> F a -> F b
```

**The monoidal presentation** (the one that explains the structure):

```text
unit :: F ()                         -- a "do-nothing" effect carrying no information
(⊗)  :: F a -> F b -> F (a, b)       -- combine two INDEPENDENT effects into a pair
```

The two are interdefinable: `a ⊗ b = (,) <$> a <*> b`, and `<*>` recovers from `⊗` plus `fmap`. The monoidal form makes the essence visible: **an applicative is a functor that can *combine two independent effects into one*, pairing their results, with a neutral `unit`.** "Monoidal" because `⊗` is an associative combination with `unit` as identity (up to the obvious isomorphisms); "lax" because those identities hold only up to natural isomorphism, not on the nose.

This presentation explains the three senior-level payoffs at a stroke:

- **Why independence is structural.** `⊗ :: F a -> F b -> F (a, b)` takes its two operands *separately* — neither is a function of the other's value. Independence isn't a usage convention; it's baked into the *type* of the combine. (Contrast `bind :: F a -> (a -> F b) -> F b`, where the second operand *is* a function of the first's value — dependence baked in.)
- **Why accumulation is possible.** When `⊗` combines two failed effects, nothing in its type forces it to discard one. It can merge them (if failures live in a `Semigroup`). That's `Validation`.
- **Why parallelism is sound.** `⊗`'s two operands have no data dependency, so a runtime may evaluate them in any order, including concurrently. `parMapN`/`Promise.all` are `⊗` with a parallel evaluation strategy.

```haskell
-- The monoidal view, concretely. `zip`-like pairing of independent effects.
pairMaybe :: Maybe a -> Maybe b -> Maybe (a, b)
pairMaybe a b = (,) <$> a <*> b        -- this IS the ⊗ for Maybe
-- pairMaybe (Just 1) (Just 'x') = Just (1, 'x'); any Nothing → Nothing.
```

> The professional payoff of this view: when you ask "can this effect be an applicative?", the real question is "can I combine two *independent* instances into one, with a neutral element?" If yes, you have an applicative and inherit accumulation/parallelism/traversal. If the only sensible combine *needs* the first result to produce the second, you have (at best) a monad, and you forfeit those.

---

## The Applicative Laws, Formally

An applicative satisfies the functor laws **plus** four equations relating `pure` and `<*>`. With `id`, `.`, and `($ y) = \g -> g y`:

```text
(A1)  Identity:        pure id <*> v               ≡  v
(A2)  Homomorphism:    pure f <*> pure x            ≡  pure (f x)
(A3)  Interchange:     u <*> pure y                 ≡  pure ($ y) <*> u
(A4)  Composition:     pure (.) <*> u <*> v <*> w   ≡  u <*> (v <*> w)
```

And a *consistency* law tying the functor `fmap` to the applicative operations:

```text
(A0)  fmap f x  ≡  pure f <*> x
```

What each guarantees, in engineering terms:

- **(A1) Identity** — wrapping `id` and applying it is a no-op; `pure` injects no behavior. The applicative cousin of (F1).
- **(A2) Homomorphism** — combining two `pure` values equals combining them outside the box and then `pure`-ing. `pure` is a *homomorphism*: it preserves application. This is what makes `pure` a clean boundary between the plain world and the effectful one — no hidden effect sneaks in via `pure`.
- **(A3) Interchange** — it doesn't matter *which* operand carries the `pure`; a boxed function applied to a pure value can be rewritten with the `pure` on the other side. This is the law that lets `liftA2 f a b` be defined unambiguously.
- **(A4) Composition** — chained `<*>` re-associates exactly like function composition. This is the crucial one for refactoring: it makes `f <$> a <*> b <*> c` **unambiguous** — every grouping of the `<*>`s yields the same result, so you can extract `(b <*> c)` into a helper, or fluent-chain, and trust the result.

```haskell
-- (A4) in action: two groupings of the same chain are provably equal.
-- left  = ((User <$> a) <*> b) <*> c     -- default left-assoc grouping
-- right = (User <$> a) <*> (b <*> c)     -- regrouped
-- (A4) guarantees left ≡ right for any lawful applicative.
```

> **The one-sentence takeaway:** the functor laws say *`fmap` only transforms contents*; the applicative laws say *`pure` is a neutral homomorphism and `<*>` associates like composition.* Together they make the `f <$> a <*> b <*> c` idiom a well-defined "apply this N-ary function across these N independent effects," refactorable and regroupable without changing meaning — the same refactoring guarantee the monad laws give one rung up, here for *combining* rather than *sequencing*.

Crucially, **the laws do not mandate short-circuiting or any particular failure semantics.** `Maybe`'s `<*>` short-circuits; `Validation`'s accumulates; `[]`'s takes the cartesian product; `ZipList`'s zips position-wise. All four are *lawful applicatives*. The instance chooses the combine; the laws only insist it be associative with a neutral `pure`. That freedom is exactly the door accumulation walks through — and it's why a single type (lists) can carry *two* lawful applicatives (`[]` cartesian vs `ZipList` positional), distinguished only by their `<*>`.

---

## Why `Validation` Is Not a Monad — a Proof Sketch

The senior level asserted that `Validation`/`Validated` is an applicative but *cannot* be a lawful monad. Here is the argument, which is the cleanest demonstration that the ladder's rungs are genuinely distinct.

**Setup.** Suppose, for contradiction, that `Validation E` (with `E` a `Semigroup`, so errors combine via `<>`) had a lawful `Monad` instance with `bind` (`>>=`). Every monad induces an applicative via:

```text
mf `ap` mx  =  mf >>= \f -> mx >>= \x -> pure (f x)        -- the derived applicative
```

A *coherence* requirement (part of being lawfully both `Applicative` and `Monad`) demands that a type's *declared* `<*>` equal this *derived* `ap`:

```text
(C)   (<*>)  ≡  ap        -- the applicative and the one derived from the monad must match
```

**The contradiction.** Evaluate both sides on two *failing* validations, `Invalid e1` and `Invalid e2`:

- The **declared** accumulating `<*>` merges: `Invalid e1 <*> Invalid e2  =  Invalid (e1 <> e2)`.
- The **derived** `ap` runs `Invalid e1 >>= (...)`. But `bind` on a *failed* `Validation` has no value to feed the continuation, so by the only lawful definition it must short-circuit: `Invalid e1 >>= k  =  Invalid e1`. Hence `Invalid e1 \`ap\` Invalid e2  =  Invalid e1` — the *second* error is **discarded**.

So `Invalid (e1 <> e2)  ≠  Invalid e1` whenever `e2` is non-empty, violating coherence (C). **There is no lawful `Monad` instance whose derived `ap` accumulates.** A `Validation` that wanted to be a monad would have to *abandon* accumulation and short-circuit like `Either` — at which point it *is* `Either`. ∎ (sketch)

```haskell
-- The fork in the road, made concrete:
-- EITHER (monad): bind short-circuits → ap discards the second error.
Left e1  >>= _   =  Left e1
-- VALIDATION (applicative only): <*> accumulates → CANNOT come from a lawful bind.
Invalid e1 <*> Invalid e2  =  Invalid (e1 <> e2)
```

> **Why this matters beyond the theorem.** It tells you the accumulate-vs-short-circuit choice is *forced* and *exclusive*: you cannot have one type that does both lawfully. That is why every serious FP library ships `Validated`/`Validation` *separately* from `Either`, why converting between them (`toEither`/`fromEither`) is the explicit seam between independent-and-accumulating and dependent-and-short-circuiting parts of a pipeline, and why "just add a `flatMap` to my `Validation`" is a request that *cannot* be granted without silently losing errors. The law is the design.

---

## `Traversable`: `traverse`, `sequenceA`, and Their Laws

`traverse` is the most important *use* of an applicative and deserves a precise treatment. A **`Traversable`** is a functor `T` you can walk left-to-right, performing an applicative effect at each element and collecting the results:

```text
traverse  :: Applicative F => (a -> F b) -> T a -> F (T b)
sequenceA :: Applicative F => T (F a)            -> F (T a)
-- sequenceA = traverse id;   traverse f = sequenceA . fmap f
```

The signature is the entire idea: turn a `T` of plain values plus an effect-producing function into *one* effect yielding a `T` of results — flipping the two layers (`T (F b)` → `F (T b)`). The *applicative* (not monad) is what's required, which is why `traverse` inherits accumulation and parallelism: traversing with a `Validation` collects all errors; traversing with a concurrent applicative runs all elements in parallel.

`Traversable` has its own laws (naturality, identity, composition) ensuring `traverse` is a *structure-preserving* walk — it visits each element exactly once, left to right, and rebuilds the same shape. The professionally relevant consequences:

- **`traverse` with the `Identity` applicative is `fmap`.** `traverse (Identity . f) = Identity . fmap f`. So `Traversable ⇒ Functor`, and `traverse` *generalizes* `map`.
- **`traverse` with the `Const m` applicative (for a monoid `m`) is `foldMap`.** This is why `Traversable ⇒ Foldable`: a traversal that ignores the rebuilt structure and only accumulates a monoid is exactly a fold. *One* `traverse` definition gives you `map`, `fold`, and the effectful walk.

```haskell
-- traverse subsumes map and fold by choosing the applicative.
import Data.Functor.Identity
import Data.Functor.Const

mapViaTraverse  f = runIdentity . traverse (Identity . f)   -- fmap
foldViaTraverse f = getConst   . traverse (Const . f)       -- foldMap
-- The same traversal, two applicatives, two classic operations fall out.
```

```rust
// Rust — sequence for Result is in the stdlib as `collect`, short-circuiting.
let r: Result<Vec<i32>, _> =
    vec!["1", "2", "x"].iter().map(|s| s.parse::<i32>()).collect();
// Err(ParseIntError) at "x" — Result's applicative collect short-circuits.
// (For accumulation you fold errors into a Vec by hand; the stdlib gives short-circuit.)
```

> **The unifying insight:** `traverse` is "iterate, but return the effect." Because it's parameterized over *any* applicative, the *same* traversal of the *same* structure gives you a validating walk (`Validation`), a parallel fetch (`Promise.all`/`parTraverse`), a stateful relabel (`State`), or a plain map/fold (`Identity`/`Const`). `Traversable` is the precise answer to "what data structures can I run an applicative effect over while preserving their shape?" — and the answer is "almost all of them," which is why `traverse` is everywhere in real FP.

---

## Composing Functors and Applicatives

A property that distinguishes applicatives from monads, and matters for both theory and performance:

> **Applicatives compose; monads do not.**

If `F` and `G` are applicatives, their *composition* `F ∘ G` (a `F (G a)`) is *automatically* an applicative — `pure` is `pure . pure`, and `<*>` lifts through both layers mechanically. No transformer, no `lift`, no ordering subtlety. This is why you can freely nest `Validation (Maybe a)` or `[] (Either e a)` and still combine them applicatively.

```haskell
-- Compose two applicatives → still an applicative, for free.
newtype Compose f g a = Compose (f (g a))

instance (Applicative f, Applicative g) => Applicative (Compose f g) where
  pure = Compose . pure . pure
  Compose fgf <*> Compose fgx = Compose ((<*>) <$> fgf <*> fgx)
-- No transformer needed; composition is mechanical.
```

Monads, by contrast, **do not compose** in general — `Future (Either e a)` is *not* automatically a monad, which is the entire reason monad *transformers* (`EitherT`, `StateT`) exist and carry their `lift`/ordering complexity (see [Monads — Plain English: senior](../09-monads-plain-english/senior.md)). The structural reason: `<*>`'s operands are independent, so lifting through a second layer is uniform; `bind`'s operand is a *function of the inner value*, and there's no generic way to thread that through an outer layer.

> **The professional consequence:** "stay applicative as long as possible" isn't only about accumulation and parallelism — it's also about *composition without transformers.* The moment you need monadic dependency you may pay the transformer-stack tax; while you remain applicative, nesting effects is free. This is a real architectural lever: structuring a data layer applicatively (independent, composable, batchable) and dropping to monadic only at the genuinely-dependent seams keeps the composition cheap.

### Four "non-effect" applicatives worth knowing

Beyond `Maybe`/`Either`/`Validation`/`[]`, four applicatives are pure structure — and each unlocks a classic operation when you `traverse` with it. Recognizing them is a depth marker, because they show that "applicative" is a *shape*, not a synonym for "effect."

| Applicative | `pure` / `<*>` behavior | `traverse` with it gives you |
|---|---|---|
| **`Identity a`** | `pure = Identity`; `<*>` just applies | `fmap` (a plain map) |
| **`Const m`** (monoid `m`) | `pure _ = Const mempty`; `<*>` is `<>` on the `m`s, *ignoring* the function | `foldMap` (a fold) |
| **`ZipList a`** | `pure x = repeat x`; `<*>` zips position-wise | `transpose` / element-wise combine |
| **`Validation e`** (semigroup `e`) | `<*>` accumulates errors | all-errors validation |

```haskell
-- Const is the surprising one: it THROWS AWAY the function and only combines the
-- monoid, which is exactly why traversing with Const m is a fold.
newtype Const m a = Const { getConst :: m }
instance Monoid m => Applicative (Const m) where
  pure _              = Const mempty
  Const x <*> Const y = Const (x <> y)     -- ignores the (a->b); accumulates m

-- ZipList is the OTHER lawful applicative on lists (vs the cartesian default):
-- ZipList [(+1),(*10)] <*> ZipList [5, 6]  ==  ZipList [6, 60]   (position-wise)
```

The `Const` applicative is the deepest of these: it discards the function entirely and only accumulates a monoid, which is *precisely* a fold — and it's how `foldMap` is recovered from `traverse`. `ZipList` is the canonical proof that a single type (lists) carries *two* lawful applicatives, distinguished only by `<*>`. Together they make concrete the professional point that **the applicative laws constrain the combine's *algebra* (associative, neutral `pure`) without dictating its *behavior*** — leaving room for cartesian vs zip, short-circuit vs accumulate, and effect vs pure structure, all lawful.

---

## Runtime: Allocation per `map` and `ap`

The abstraction is not free. A naive `map`/`ap`/`traverse` allocates, and on a hot path those allocations dominate.

**Per-`map` cost.** `fmap f x` constructs a *new* box wrapping `f`'s result. On the JVM, `optional.map(f)` allocates a new `Optional` (and the lambda `f`, if not hoisted); `stream.map(f)` allocates a pipeline stage. A chain `.map(f).map(g)` without fusion allocates *two* intermediate structures. The functor composition law (F2) is what *permits* a library/compiler to fuse them into one — but only if it actually does (Java `Stream` fuses lazily; eager `List.map().map()` in many languages does not).

**Per-`ap` cost.** `mf <*> mx` typically allocates a result box, and for accumulating applicatives a *new* combined-error collection. `Validation`'s `<*>` on two failures allocates a concatenated list each time — an N-field validation that fails all N fields does O(N²) list-copying if implemented with naive `++`/`+`, which is why production `Validated` uses a `NonEmptyList`/`Chain` with O(1) append, not naive concatenation. **The choice of error `Semigroup` is a performance decision**, not just a correctness one.

```java
// Java — the allocation reality of a map chain on Optional.
Optional<Integer> r = findValue(k)   // Optional (1 alloc)
    .map(x -> x + 1)                 // new Optional (1 alloc) + lambda
    .map(x -> x * 2)                 // new Optional (1 alloc) + lambda
    .map(x -> x - 3);                // new Optional (1 alloc) + lambda
// 4 Optionals where imperative code allocates 0. On a hot path this is GC pressure.
// The JIT MAY scalar-replace short-lived Optionals via escape analysis — but only
// when the chain inlines and nothing escapes. Verify, don't assume.
```

**`traverse` cost.** `traverse f xs` over N elements performs N applicative `ap`s and allocates O(N) intermediate effects plus the rebuilt structure. With an accumulating applicative it also holds the growing result/error collection. For large N this is a genuine cost: a `traverse` over a million-element list builds a million-element effectful structure. In Haskell, GHC's `traverse` can fuse for some structures; on the JVM, a `traverse`-style loop over a huge collection should be measured and, if hot, rewritten as an explicit accumulation loop (the "Go pattern") that allocates only the final result.

> **The mitigation hierarchy** (apply only after measuring):
> 1. **Use primitive-specialized functors** where they exist (`OptionalInt`, `IntStream`) to avoid boxing.
> 2. **Pick an O(1)-append error structure** (`NonEmptyList`/`Chain`/builder) for accumulating applicatives — never naive list `++` in a loop.
> 3. **Let the optimizer fuse** by keeping chains inlinable and non-escaping; verify with escape-analysis logs / `-XX:+PrintInlining`.
> 4. **Drop to an explicit loop on proven hot paths.** A `traverse` over a large structure in an inner loop is a legitimate place to write the imperative accumulation by hand — same result, O(1) intermediate allocation.

The rule mirrors the monad-cost rule one rung up: **the abstraction buys clarity, accumulation, and parallelism; on hot paths, *measure* whether you can afford the allocations, and specialize or de-sugar where the profiler tells you to.**

---

## Measurement

Claims about `map`/`ap`/`traverse` cost are falsifiable. Pair each with the instrument.

| Claim | Instrument | What you're looking for |
|---|---|---|
| "This `map` chain allocates per stage" | JFR / `async-profiler` (alloc mode), `-Xlog:gc` | allocation rate; young-gen churn proportional to chain length |
| "The JIT scalar-replaced the `Optional`s" | `-XX:+PrintInlining`, `-XX:+PrintEscapeAnalysis` (debug JVM), JMH `-prof gc` | `norm` alloc/op near zero ⇒ eliminated; nonzero ⇒ it escaped |
| "`Validated` accumulation is O(N²)" | JMH across N = 10, 100, 1000 | per-op time scaling super-linearly ⇒ naive concat; fix the `Semigroup` |
| "`traverse` is the hot spot" | CPU + alloc profiler (flame graph) | time/alloc in `ap`/wrapper constructors, not the actual work |
| "Promise.all is actually concurrent" | request timeline / tracing (e.g. spans) | total ≈ max(call), not sum(call) |
| "GHC fused the traversal" | `-ddump-simpl`, `-ddump-rule-firings`, criterion | fused core, no intermediate list allocation |

```java
// JMH skeleton — measure allocation of a map chain vs an imperative equivalent.
@Benchmark public int mapChain(St s) {
    return Optional.of(s.x).map(a -> a + 1).map(a -> a * 2).orElse(0);
}
@Benchmark public int imperative(St s) {
    int a = s.x; a = a + 1; a = a * 2; return a;
}
// Run with: -prof gc.  Compare `·gc.alloc.rate.norm` (bytes/op).
// If the map chain's norm is ~0, escape analysis won; if it tracks chain length,
// the Optionals escaped and you're paying per-stage allocation.
```

```text
# benchstat-style read for the Validated O(N²) check:
#   validate/N=10     50ns
#   validate/N=100   600ns      ← ~12× for 10× ⇒ super-linear ⇒ naive concat
#   validate/N=1000  9000ns     ← confirms; switch to Chain/NonEmptyList append
```

> **Discipline:** "applicatives allocate" is true and useless without numbers. Measure on *your* workload, at *your* N, on *your* runtime. The most common real findings are (a) the JIT already eliminated the cost (do nothing), (b) an accumulating validator uses naive concatenation and scales quadratically (fix the `Semigroup`), or (c) a `traverse` over a large structure is hot and wants an explicit loop. Each is a specific, instrument-backed conclusion — not a blanket "avoid functors."

---

## Common Mistakes

1. **Treating "has a `map` method" as "is a lawful functor."** A `map` that reorders, dedups, or fills in defaults breaks (F1) and silently breaks every fusion/refactor that assumes lawfulness. Property-test (F1)/(F2) on custom instances.
2. **Assuming you can add `flatMap`/`bind` to `Validation`.** You can't, lawfully — the coherence proof shows accumulating `<*>` and a monadic-derived `ap` disagree. A `bind` on `Validation` would silently discard errors. Convert to `Either` for dependent sequencing.
3. **Naive error concatenation in an accumulating applicative.** `errors ++ more` in a loop is O(N²). Production `Validated` uses `NonEmptyList`/`Chain`/a builder with O(1) append. The `Semigroup` choice is a performance decision.
4. **Forgetting that applicatives compose but monads don't.** Reaching for a "transformer" to combine two *applicatives* is unnecessary work — `Compose f g` is automatically applicative. Transformers are a monad problem.
5. **Ignoring `traverse`'s O(N) intermediate allocation on large structures.** A `traverse` over a million elements builds a million-element effectful structure. On a hot path, measure and consider an explicit accumulation loop.
6. **Confusing `traverse` with `map` at the type level.** `map (a -> F b)` gives `T (F b)`; `traverse (a -> F b)` gives `F (T b)`. The professional tell is the *applicative constraint*: `traverse` needs one, `map` doesn't.
7. **Assuming a single lawful applicative per type.** Lists have two (`[]` cartesian, `ZipList` positional); both lawful. The instance you `import`/select determines the combine. (Functors *are* unique by parametricity; applicatives are not.)
8. **Asserting the JIT/GHC "optimized it away" without checking.** Escape analysis and fusion fire only inside provable shapes. Verify with `-prof gc` / `-ddump-simpl`; a non-inlined boundary or an escaping box defeats them.

---

## Test Yourself

1. State the two functor laws equationally and explain why, in a parametric setting, composition follows from identity (and what that implies about how many lawful `Functor` instances a type has).
2. Give the monoidal presentation of `Applicative` (`unit`, `⊗`) and show how it explains independence, accumulation, and parallelism.
3. State the four applicative laws. Which one makes `f <$> a <*> b <*> c` unambiguous under regrouping, and why does that matter for refactoring?
4. Prove (sketch) that `Validation` with accumulating `<*>` has no lawful `Monad` instance. Which exact law/coherence requirement does the monad-derived `ap` violate?
5. Give `traverse`'s signature. Show how choosing the `Identity` and `Const m` applicatives recovers `map` and `foldMap`, and state what that proves about `Traversable`.
6. "Applicatives compose; monads don't." Explain the structural reason and name the practical machinery monads need *because* of it.
7. You have a `.map(f).map(g).map(h)` chain on `Optional` in a hot JVM loop. What allocates, what *might* eliminate it, and how do you confirm which happened?

<details>
<summary>Answers</summary>

1. **(F1)** `fmap id ≡ id`; **(F2)** `fmap (g . f) ≡ fmap g . fmap f`. In a parametric (HM) setting, the free theorem for `fmap`'s type forces any total identity-preserving `fmap` to also satisfy composition, so **(F2) follows from (F1)**. Consequence: up to the laws there is *at most one* lawful `Functor` per type — the instance is *determined* by the type (hence `deriving Functor` is sound).
2. `unit :: F ()` and `⊗ :: F a -> F b -> F (a,b)`, with `a ⊗ b = (,) <$> a <*> b`. **Independence:** `⊗` takes its operands *separately* — neither is a function of the other's value (unlike `bind`). **Accumulation:** nothing in `⊗`'s type forces discarding one failed operand, so failures can be merged (if in a `Semigroup`). **Parallelism:** no data dependency between operands ⇒ a runtime may evaluate them concurrently.
3. **(A1)** identity `pure id <*> v ≡ v`; **(A2)** homomorphism `pure f <*> pure x ≡ pure (f x)`; **(A3)** interchange `u <*> pure y ≡ pure ($ y) <*> u`; **(A4)** composition `pure (.) <*> u <*> v <*> w ≡ u <*> (v <*> w)`. **(A4)** makes the chain unambiguous: it guarantees every grouping of the `<*>`s is equal, so you can regroup/extract sub-chains into helpers without changing behavior — the refactoring safety net.
4. Assume a lawful `Monad`. Its *derived* `ap` is `mf >>= \f -> mx >>= \x -> pure (f x)`. Coherence requires the declared `<*>` to equal this derived `ap`. On two failures: declared `<*>` gives `Invalid (e1 <> e2)` (accumulate); derived `ap` runs `Invalid e1 >>= ...`, which must short-circuit to `Invalid e1` (a failed value has nothing to feed the continuation), discarding `e2`. Since `Invalid (e1 <> e2) ≠ Invalid e1`, **coherence is violated** — no lawful monad whose derived `ap` accumulates exists.
5. `traverse :: Applicative F => (a -> F b) -> T a -> F (T b)`. With `Identity`: `traverse (Identity . f) = Identity . fmap f` ⇒ recovers `map` (so `Traversable ⇒ Functor`). With `Const m` (monoid `m`): the rebuilt structure is ignored and the monoid accumulates ⇒ recovers `foldMap` (so `Traversable ⇒ Foldable`). This proves `traverse` *subsumes* both `map` and `fold`: one traversal, parameterized by the applicative, yields all three.
6. For applicatives `F`, `G`, the composite `F ∘ G` is automatically applicative: `pure = pure . pure`, `<*>` lifts mechanically through both layers, because `<*>`'s operands are *independent* and thread uniformly. Monads don't compose because `bind`'s operand is a *function of the inner value*, with no generic way to thread it through an outer monad — hence monads need **transformers** (`EitherT`, `StateT`) with their `lift`/ordering complexity.
7. Each `.map` allocates a new `Optional` (and possibly the lambda) — three intermediate `Optional`s. The JIT's **escape analysis + scalar replacement** *may* eliminate them if the chain fully inlines and nothing escapes. Confirm with JMH `-prof gc`: if `gc.alloc.rate.norm` is ~0 bytes/op, they were eliminated; if it scales with chain length, they escaped and you're paying per-stage allocation (consider `OptionalInt` or an imperative rewrite on this hot path).

</details>

---

## Cheat Sheet

| Law set | Equations | Guarantees |
|---|---|---|
| **Functor** | `fmap id ≡ id`; `fmap (g.f) ≡ fmap g . fmap f` | structure preservation; map fusion; (comp. follows from id. by parametricity) |
| **Applicative** | identity, homomorphism, interchange, composition (+ `fmap f x ≡ pure f <*> x`) | `pure` neutral; `<*>` associates ⇒ `f <$> a <*> b <*> c` unambiguous |
| **Monoidal view** | `unit :: F ()`, `⊗ :: F a → F b → F (a,b)` | independence, accumulation, parallelism are *structural* |
| **Traversable** | naturality, identity, composition | `traverse` is a structure-preserving single-pass walk |

| Fact | Consequence |
|---|---|
| **Functor unique by parametricity** | at most one lawful `Functor`/type; `deriving Functor` is sound |
| **Multiple lawful applicatives possible** | `[]` (cartesian) vs `ZipList` (positional) |
| **`Validation` ⇒ no lawful monad** | accumulating `<*>` ≠ monad-derived `ap` (coherence); convert to `Either` to sequence |
| **Applicatives compose; monads don't** | `Compose f g` free; monads need transformers |
| **`traverse` subsumes `map`/`fold`** | `Identity` ⇒ `map`; `Const m` ⇒ `foldMap` |

**Runtime:**

| Operation | Allocates | Mitigation (after measuring) |
|---|---|---|
| `map` (per stage) | new box (+ lambda) | fusion (verify), primitive functors (`OptionalInt`) |
| `ap` (accumulating) | result box + combined errors | O(1)-append `Semigroup` (`NonEmptyList`/`Chain`) |
| `traverse` (N elems) | O(N) intermediate effects + structure | explicit loop on hot paths; verify GHC/JIT fusion |

> **Three golden rules:**
> - *The laws are the contract: lawful `map`/`ap`/`traverse` are refactorable and regroupable with a guarantee; a method named `map` that breaks (F1) is a footgun.*
> - *`Validation`-is-not-a-monad is a theorem (coherence + accumulation vs short-circuit), not a convention — it's why two types exist for one data shape.*
> - *Every `map`/`ap`/`traverse` allocates; the abstraction buys clarity/accumulation/parallelism, and on hot paths you measure (`-prof gc`, flame graphs, scaling tests) before specializing or de-sugaring.*

---

## Summary

- **The laws are equational specifications, and they are the contract.** Functor: `fmap id ≡ id` and `fmap (g.f) ≡ fmap g . fmap f` (composition follows from identity by parametricity, so the functor is *unique* per type). Applicative: identity, homomorphism, interchange, composition — making `f <$> a <*> b <*> c` unambiguous under regrouping. These laws are *exactly* what license fusion and the extract/inline refactors of `map`/`<*>`/`traverse` chains.
- **An applicative is a lax monoidal functor** (`unit`, `⊗`), and that view explains the senior payoffs structurally: `⊗`'s operands are independent, so accumulation and parallelism are *built into the type*, not bolted on. The laws never mandate short-circuiting — hence one type can carry two lawful applicatives (`[]` vs `ZipList`), and `Validation` can accumulate lawfully.
- **`Validation` is an applicative but provably not a monad.** Coherence requires the declared `<*>` to equal the monad-derived `ap`; on two failures the accumulating `<*>` merges while the derived `ap` short-circuits and discards the second error — a contradiction. So accumulate-vs-short-circuit is a *forced, exclusive* choice, which is why every library ships `Validated` separately from `Either`.
- **`Traversable`/`traverse` is the applicative's killer use.** `traverse :: Applicative F => (a -> F b) -> T a -> F (T b)` flips the layers, parameterized over *any* applicative — recovering `map` (via `Identity`) and `foldMap` (via `Const m`), and inheriting accumulation and parallelism. One traversal, many semantics by choice of applicative.
- **Applicatives compose; monads don't.** `Compose f g` is automatically applicative; monads need transformers because `bind`'s operand depends on the inner value. "Stay applicative" buys composition-without-transformers on top of accumulation and parallelism.
- **The runtime cost is real and measurable.** `map`/`ap`/`traverse` allocate per stage/element; accumulating validators with naive concat scale O(N²); `traverse` over large structures allocates O(N) intermediates. Compilers fuse and scalar-replace inside provable shapes — verify with `-prof gc`, `-ddump-simpl`, and scaling tests; specialize (`OptionalInt`, `Chain`) or de-sugar to an explicit loop *only* where the profiler points.
- Next: [Optics, Lenses & Prisms](../14-optics-lenses-and-prisms/professional.md) — where `traverse` reappears as a *traversal* optic, and the functor/applicative machinery becomes the engine of composable, lawful access into deep structures.

---

## Further Reading

- **"Applicative programming with effects"** — McBride & Paterson (2008) — the founding paper; the laws, the monoidal view, and traversal in their original form.
- **"The Essence of the Iterator Pattern"** — Gibbons & Oliveira (2009) — `Traversable`/`traverse` as the deep theory of iteration; recovering `map` and `fold` from one traversal.
- **"Notions of Computation as Monoids"** — Rivas & Jaskelioff (2017) — the precise "applicative = lax monoidal functor, monad = monoid in endofunctors" account.
- **Typeclassopedia** — Brent Yorgey (Monad.Reader, 2009) — the canonical map of `Functor`/`Applicative`/`Traversable`/`Monad` and their laws and interrelations.
- **"Free Applicative Functors"** — Capriotti & Kaposi (2014) — static-analyzability made formal: why applicative structure can be inspected before running (batching parsers, Haxl).
- **JMH and `async-profiler` documentation** — the JVM instruments for the allocation/escape-analysis claims here; **GHC users' guide** (`-ddump-simpl`, fusion rules) for the lazy side.

---

## Related Topics

- [Functors & Applicatives: `senior.md`](senior.md) — the design judgment (independent vs dependent, the validation-type decision, parallelism) the laws here justify.
- [Monads — Plain English: `professional.md`](../09-monads-plain-english/professional.md) — the rung above: the monad laws, Kleisli composition, and why monads need transformers (because they don't compose).
- [Algebraic Data Types](../06-algebraic-data-types/professional.md) — `Validation`/`Either` as sum types; the data side of the accumulate-vs-short-circuit split.
- [Laziness & Streams](../12-laziness-and-streams/professional.md) — the functor composition law as the basis of map fusion; the performance cousin of these laws.
- [Composition](../05-composition/professional.md) — the function functor and the composition that the applicative laws generalize to independent effects.
- [Optics, Lenses & Prisms](../14-optics-lenses-and-prisms/professional.md) — `traverse` as the traversal optic; functor/applicative as the engine of composable access.
- [Recursion Schemes & Transducers](../16-recursion-schemes-and-transducers/professional.md) — `Traversable` and structure-preserving walks generalized further.

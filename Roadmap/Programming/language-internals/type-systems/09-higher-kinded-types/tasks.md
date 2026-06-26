# Higher-Kinded Types — Tasks & Exercises

> **Topic:** [Higher-Kinded Types](README.md)
> **Focus:** Build the muscle. Read kinds, write instances, feel the laws, hit the language walls yourself, and make a real adoption call.

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Track A — Kinds & Counting Holes (Warm-up)](#track-a--kinds--counting-holes-warm-up)
3. [Track B — Functor / Applicative / Monad by Hand](#track-b--functor--applicative--monad-by-hand)
4. [Track C — The Laws](#track-c--the-laws)
5. [Track D — `traverse` and Effect-Polymorphism](#track-d--traverse-and-effect-polymorphism)
6. [Track E — Hitting the Language Walls (Rust / TypeScript)](#track-e--hitting-the-language-walls-rust--typescript)
7. [Track F — Engineering Judgment](#track-f--engineering-judgment)
8. [Capstone Projects](#capstone-projects)
9. [Self-Assessment Checklist](#self-assessment-checklist)

---

## How to Use This Page

Each task has a **self-check** (how you know you're right), a **hint** (collapsed-by-thought; read only when stuck), and, for a *minority* of tasks, a **sparse solution** (the key step, not a full copy-paste answer). Do the work first. If you can read `:kind`, write a lawful `Monad` instance, explain why Rust can't host a `Functor`, and produce a defensible adopt/avoid memo, you've mastered the topic.

Recommended environments: a Haskell REPL (GHCi) and/or a Scala 3 worksheet with Cats; a TypeScript playground with fp-ts; a Rust playground. You can do the conceptual tasks on paper.

---

## Track A — Kinds & Counting Holes (Warm-up)

### Task A1 — Predict the kind

Without a REPL, write down the kind of each: `Int`, `Bool`, `Maybe`, `Maybe Int`, `Either`, `Either String`, `Either String Int`, `Map`, `(,)` (the pair constructor), `[]` (list), `[Int]`.

**Self-check:** Verify in GHCi with `:kind`. Every answer should be one of `*`, `* -> *`, or `* -> * -> *`. `Maybe Int`, `Either String Int`, and `[Int]` are `*`; `Maybe`, `Either String`, and `[]` are `* -> *`; `Either`, `Map`, and `(,)` are `* -> * -> *`.

<details><summary>Hint</summary>

Count how many type arguments you must supply before you can hold a value. Supplying *some* arguments to a multi-arg constructor reduces the arrow count.

</details>

### Task A2 — The "is this a type?" test

For each, answer "can I declare a variable/value of this exact thing?": a value of type `List`; a value of type `List<Int>`; a value of type `Option`; a value of type `Either<String, Int>`; a value of type `Map<String, _>`.

**Self-check:** Only `List<Int>` and `Either<String, Int>` are finished types (kind `*`) you can hold. `List`, `Option`, and `Map<String, _>` still have holes (kind `* -> *`) and cannot be the type of a value. If you said "yes" to any one-hole constructor, re-read the junior page's "List is a mold, List<Int> is a brick".

### Task A3 — Kind of a typeclass

In GHCi, run `:kind Functor`, `:kind Monad`, `:kind Eq`, `:kind Num`. Explain the difference between the results.

**Self-check:** `Functor` and `Monad` are `(* -> *) -> Constraint` (they classify *constructors*); `Eq` and `Num` are `* -> Constraint` (they classify *finished types*). The `(* -> *)` part is the higher-kindedness — `Functor`/`Monad` are constraints *over one-hole constructors*, which is exactly why they can express "any container."

---

## Track B — Functor / Applicative / Monad by Hand

### Task B1 — Implement Functor/Applicative/Monad for `Maybe` from scratch

In Haskell (or a Maybe/Option you define yourself in Scala), implement all three instances without looking at the standard library. Then evaluate: `fmap (+1) (Just 5)`, `fmap (+1) Nothing`, `(+) <$> Just 3 <*> Just 4`, `(+) <$> Just 3 <*> Nothing`, `Just 5 >>= \x -> if x > 0 then Just (x*2) else Nothing`.

**Self-check:** Results: `Just 6`, `Nothing`, `Just 7`, `Nothing`, `Just 10`. If `(+) <$> Just 3 <*> Nothing` gave anything other than `Nothing`, your `<*>` mishandles the absent case.

<details><summary>Hint</summary>

`fmap` only touches `Just x`. `<*>` is `Nothing` if *either* side is `Nothing`. `>>=` feeds the unwrapped `x` to the function and returns `Nothing` immediately for `Nothing`.

</details>

<details><summary>Sparse solution (the load-bearing lines)</summary>

```haskell
instance Monad Maybe where
  Nothing >>= _ = Nothing       -- short-circuit
  Just x  >>= f = f x           -- feed x forward
```

Everything else (Functor, Applicative) is determined by this plus `pure = Just`.

</details>

### Task B2 — Predict `flatMap` behavior across three containers

Without running, predict: `[1,2,3] >>= \x -> [x, x*10]`; `Right 5 >>= \x -> Right (x+1)` (type `Either String Int`); `Left "boom" >>= \x -> Right (x+1)`; `[1,2] >>= \x -> []`.

**Self-check:** `[1,10,2,20,3,30]`; `Right 6`; `Left "boom"` (untouched); `[]`. The list one is "run for every element and concatenate"; the `Left` one short-circuits and carries the error; binding into `[]` annihilates everything (the list-monad zero).

### Task B3 — Implement Monad for a function/Reader

Implement `Functor`/`Applicative`/`Monad` for `Reader r` (a wrapper around `r -> a`). Then write a tiny program with two `ask`-style steps that read a config value.

**Self-check:** `fmap f (Reader g) = Reader (f . g)`; `>>=` should thread the same `r` into both the receiver and the continuation. If your `>>=` calls the function with *different* environments for the two steps, it's wrong — the whole point of Reader is a *shared* environment.

<details><summary>Hint</summary>

`Reader r a` is essentially `r -> a`. `(Reader g) >>= f = Reader (\r -> runReader (f (g r)) r)` — note `r` is fed to *both* `g` and the result of `f`.

</details>

### Task B4 — Find the Applicative-only operation

Write a function that combines `Option<Int>` and `Option<String>` into `Option<(Int, String)>` using *only* Functor + Applicative operations (`map`, `pure`, `<*>` / `mapN`), never `flatMap`. Why is `flatMap` unnecessary here?

**Self-check:** `(oa, ob).mapN((a, b) => (a, b))` (Scala/Cats) or `(,) <$> oa <*> ob` (Haskell). `flatMap` is unnecessary because the two effects are *independent* — neither's structure depends on the other's value. That independence is exactly what marks an Applicative-shaped problem.

---

## Track C — The Laws

### Task C1 — Verify the functor laws for `Maybe`

By case analysis (on `Nothing` and `Just x`), prove `fmap id == id` and `fmap (g . f) == fmap g . fmap f` for your `Maybe` Functor.

**Self-check:** Both cases must hold for both laws. `fmap id (Just x) = Just (id x) = Just x`; `fmap id Nothing = Nothing`. For composition, `fmap (g.f) (Just x) = Just (g (f x))` and `fmap g (fmap f (Just x)) = fmap g (Just (f x)) = Just (g (f x))` — equal. The `Nothing` cases are trivially equal.

### Task C2 — Build an UNLAWFUL Functor and watch it break

Define a "Functor" for a list-like type whose `map` *reverses* the list after mapping. It will type-check. Now find a concrete expression where the composition law fails, and a piece of generic code (e.g. `fmap show . fmap (+1)`) that produces a wrong answer.

**Self-check:** `fmap (g.f) xs` reverses once; `fmap g (fmap f xs)` reverses *twice* (back to original order) — different results, so the composition law fails. Any generic code that relied on map-fusion now gives a differently-ordered result. The lesson: **the compiler accepted an instance that silently corrupts generic callers.**

<details><summary>Hint</summary>

You don't need a real list type — even a two-element example like `[1,2]` is enough to expose the order mismatch between one reverse and two reverses.

</details>

### Task C3 — Check a monad law

Pick the **associativity** law `(m >>= f) >>= g == m >>= (\x -> f x >>= g)` and verify it for the `Maybe` monad by case analysis on `m`.

**Self-check:** For `m = Nothing`, both sides are `Nothing`. For `m = Just x`, left side is `(f x) >>= g`, right side is `(\x -> f x >>= g) x = f x >>= g` — identical. Law holds. If you couldn't reduce both sides to the same expression, recheck your `>>=` definition.

---

## Track D — `traverse` and Effect-Polymorphism

### Task D1 — Use `traverse` three ways

Using your language's standard `traverse`/`sequence` (Haskell `Data.Traversable`, Scala Cats, or fp-ts), run a parse-each-element over a list with three different effects: `Either Err`, `Option`, and an `IO`/`Task`. Use the *same* traversal call shape each time.

**Self-check:** With `Either`, a list containing one bad element yields a single `Left` (short-circuit). With `Option`, one bad element yields `None`. With `IO`/`Task`, you get an effect that, when run, produces the list of results. The *call shape is identical*; only the effect changes — that's the higher-kinded payoff.

### Task D2 — `sequence` is `traverse id`

Show, by trying it, that `sequence [Just 1, Just 2, Just 3] == Just [1,2,3]` and `sequence [Just 1, Nothing, Just 3] == Nothing`. Then implement `sequence` in terms of `traverse`.

**Self-check:** `sequence = traverse id` (Haskell) / `xs.sequence == xs.traverse(identity)`. The `Nothing` case collapses the whole thing to `Nothing` — turning a list-of-options inside-out into an option-of-list, with absence anywhere meaning absence of the whole.

### Task D3 — Write effect-polymorphic logic, run two interpreters

Write a function `program[F[_]: Monad]` (Scala/Cats) or `Monad m => ... m ...` (Haskell) that performs two dependent steps (step 2 uses step 1's result). Run it once with a real effect (`IO`/`Option`) and once with `Identity`/a pure test monad. Confirm the *same* function works for both.

**Self-check:** The function body mentions no concrete effect — only `flatMap`/`map`/`pure` (or `do`/for). Running it at `Identity` gives a pure value; running it at `IO` gives an effect. If you had to change the function body to switch effects, it wasn't effect-polymorphic.

<details><summary>Hint</summary>

Keep the signature `def program[F[_]: Monad](...): F[Result]`. The only operations allowed inside are those a `Monad[F]` provides. If you reach for a concrete `Option.get` or `IO.unsafeRun` inside, you've broken polymorphism.

</details>

### Task D4 — Accumulate ALL errors with an Applicative

Using Cats `Validated` (or an equivalent), validate a form with two independent fields where *both* are invalid, and show the result contains *both* errors. Then redo it with `Either`/Monad and show it reports only the first.

**Self-check:** `Validated` (Applicative combine via `mapN`) → `Invalid(List(err1, err2))`. `Either` (Monad chain) → `Left(err1)` only. This is the canonical demonstration of why Applicative is its own rung: independent effects can be combined to gather everything.

---

## Track E — Hitting the Language Walls (Rust / TypeScript)

### Task E1 — Try (and fail) to write `Functor` in Rust

In a Rust playground, attempt to write `trait Functor { fn map<A, B>(self: Self<A>, f: impl Fn(A) -> B) -> Self<B>; }`. Record the exact compiler error and explain it.

**Self-check:** It does not compile — there is no way to apply `Self` (a type) to a type argument `A`. The error is about `Self<A>` not being valid; `Self` is already a concrete type, not a constructor. This *is* the HKT gap: Rust has no kind-`(* -> *)` parameter, so the unifying trait can't be expressed.

### Task E2 — Implement per-type `map`s, then feel the absence

In Rust, write `map` for `Option<T>` and for a custom `Box2<T>` separately. Then try to write *one* generic function that calls `.map` on "any Functor". Note where you get stuck.

**Self-check:** Each individual `map` works fine. The generic-over-the-container function is impossible — you'd need a `Functor` trait abstracting over the constructor, which Task E1 showed you can't write. The takeaway: having many `.map()`s is *not* the same as being able to abstract over them.

### Task E3 — Read the fp-ts encoding

In a TypeScript playground with fp-ts, write a small generic consumer using `Kind<F, A>` and a tag, e.g. a function that takes a `Functor<F>` instance and an `Kind<F, number>` and bumps it. Run it for `Array` and `Option`.

**Self-check:** It type-checks and runs, but you had to: (a) pass the `Functor` instance explicitly, and (b) thread the tag (`'Array'`/`'Option'`) by hand. Compare the ergonomics to Scala's `[F[_]: Functor]` where resolution is automatic. The encoding is sound but heavier — that's the point.

<details><summary>Hint</summary>

Lean on fp-ts's built-in `URItoKind` registry and the provided `functorArray` / `Functor` instances rather than rolling your own registry from scratch.

</details>

### Task E4 — GAT vs HKT, on paper

Write the `LendingIterator` trait with a GAT (`type Item<'a>`) and a `Windows` impl that yields borrowed slices. Then explain in 3–4 sentences why this is *not* the same capability as a `Functor`.

**Self-check:** Your explanation must hit: a GAT parameterizes an *associated type member* (`Item<'a>`), solving lending iterators; a Functor would parameterize the *implementing type by a constructor* (`Self<A>`). GATs add parameters to a trait's *outputs*; HKTs would let the trait range over *constructors*. Different axis — GATs don't give you a general `Functor` or `traverse`.

---

## Track F — Engineering Judgment

### Task F1 — Write the adoption memo

Pick a realistic scenario (e.g. "a 12-person Scala team, mixed FP experience, building a payments service that talks to 4 external systems"). Write a one-page memo recommending **adopt / contain-to-a-module / avoid** HKTs, with an explicit cost/benefit ledger.

**Self-check:** A strong memo names *concrete* costs (compile time, onboarding, bus factor, review speed) and *concrete* benefits (which duplication is removed, which effect-swaps you need), recommends a containment boundary if appropriate, and includes a *reversibility plan*. If your memo argues from "it's elegant" or "it's astronaut nonsense," redo it from the ledger.

### Task F2 — Diagnose the wrong reason to reject

A teammate says "we tried Cats and it was too slow — those monad transformer stacks killed our latency, so HKTs are out." What's the flaw in this reasoning, and what would you try before concluding?

**Self-check:** The flaw conflates the *abstraction* (effect-polymorphism) with a *naive implementation* (transformer towers). Before rejecting, try a fused effect runtime (Cats-Effect `IO`, ZIO) or the ReaderT/RIO pattern, which keep the polymorphism and shed the per-layer overhead. The decision should be re-measured against the modern implementation.

### Task F3 — Spot the speculative generality

Given a code snippet that defines `def process[F[_]: Monad](...)` but is only ever called with `IO`, decide whether to keep the generality or specialize it. Justify.

**Self-check:** With exactly one `F` ever used and none foreseeable, the generality is speculative — pure abstraction tax (worse errors, harder onboarding) for no current benefit. Specialize to `IO`. Generalize *on the second real use*, because generic→concrete is cheaper to reverse than the other direction. (If a pure *test* interpreter is a genuine second `F`, that changes the answer.)

### Task F4 — Containment design

You must use fp-ts's HKT encoding for one validation subsystem, but you don't want `Kind<F,A>` noise leaking across the codebase. Sketch the module boundary.

**Self-check:** The `Kind`/`URItoKind`/tag plumbing lives in *one* internal module; the subsystem exposes functions with clean, concrete-looking signatures (e.g. returning `Task<Report>`), so application code and its error messages never see the encoding. If consumers import anything named `Kind`/`URIS`, the containment has leaked.

---

## Capstone Projects

### Capstone 1 — Mini typeclass library

Build, from scratch in Haskell or Scala, a tiny library with `Functor`, `Applicative`, and `Monad`, instances for `Maybe`/`Option`, `Either e`, and `[]`/`List`, plus a generic `traverse` and `sequence`. Law-test every instance (QuickCheck or Cats `Discipline`).

**Self-check:** Your `traverse` must compile against *any* Applicative and run correctly for all three effects. All law tests pass. You handled the `Either` two-hole case via partial application (`Either e` / type lambda). If `traverse` only works for one effect, you haven't abstracted over `f` properly.

### Capstone 2 — Same program, four effects

Write one effect-polymorphic "fetch-and-summarize" program (`program[F[_]: Monad]` / `Monad m =>`). Provide four interpreters: `Identity` (pure), `Option` (maybe-missing), `Either` (maybe-error), and a real `IO`/`Task`. Demonstrate the identical program running under all four.

**Self-check:** Zero changes to the program body across interpreters; only the chosen `F` differs at the call site. The `Either` run short-circuits on error, `Option` on absence, `IO` performs real effects, `Identity` is pure. This is the architecture of tagless-final / MTL in miniature.

### Capstone 3 — The cross-language report

Pick one operation (say, `traverse` over a list with an effect). Implement or attempt it in: Haskell (native), Scala/Cats (native), TypeScript/fp-ts (encoded), and Rust (try, and document the wall). Write a short comparison of ergonomics, error quality, and where each language pays the cost.

**Self-check:** Haskell/Scala versions are short and natural; fp-ts works but threads instances/tags and leaks `Kind` in errors; Rust cannot do the general version at all (you can only hand-roll per-type). Your report should connect each experience to *why* (native HKTs vs defunctionalized encoding vs no constructor-genericity), and note Rust's GATs don't close the gap.

---

## Self-Assessment Checklist

You understand higher-kinded types when you can, without notes:

- [ ] State the kind of any type/constructor by counting holes (`*`, `* -> *`, `* -> * -> *`), and explain why `List` is not a type.
- [ ] Define "higher-kinded type" precisely: abstraction over a type *constructor* (a `* -> *` parameter), not a type.
- [ ] Write lawful `Functor`/`Applicative`/`Monad` instances for `Maybe`, `Either e`, and `List`, and explain `Either e` as type-level partial application.
- [ ] Explain `flatMap` *concretely* per container (short-circuit / error-carry / cartesian) without mysticism.
- [ ] State the functor and monad laws and show, by example, how an unlawful instance corrupts generic code.
- [ ] Explain why `Applicative` is its own rung (independent effects, all-error accumulation, parallelism).
- [ ] Describe what `traverse` abstracts over (two constructors) and why it's inexpressible without HKTs.
- [ ] Disambiguate higher-kinded vs higher-rank vs higher-order with an example of each.
- [ ] List which languages have native HKTs and which don't, and write/explain the `Functor` you *can't* write in Rust.
- [ ] Explain what GATs do, why they're "a step toward," and why they are *not* HKTs.
- [ ] Sketch the defunctionalization encoding (fp-ts `Kind<F, A>` + tags) and its ergonomic costs.
- [ ] Make a defensible **adopt / contain / avoid** recommendation from a cost/benefit ledger, with a reversibility plan.

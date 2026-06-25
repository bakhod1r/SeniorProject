# Eager vs. Lazy Evaluation — Senior Level

> **Topic:** [Eager vs. Lazy Evaluation](README.md)
> **Focus:** Laziness as the *default* — Haskell, call-by-need, thunks on the heap, and the cost nobody warns you about: space leaks, `foldl` thunk buildup, and the tools (`seq`, `$!`, `BangPatterns`, `deepseq`) that buy strictness back.

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

> Focus: **What happens when laziness is not an opt-in but the law of the land?** Haskell evaluates *everything* lazily by default. That makes infinite data and elegant generate-and-filter trivial — and it makes one specific failure mode, the **space leak**, a rite of passage.

So far laziness has been something you reach for: a generator, a `LazyList`, a deferred query. In **Haskell**, laziness is the **default evaluation strategy**. Every binding, every function argument, every list element is a **thunk** until something demands its value. `let x = 1 + 2` does *not* compute `3`; it allocates a thunk on the heap that *will* compute `3` if forced. This is **call-by-need**: arguments are passed unevaluated, and when first forced, the result is written back into the thunk (memoized) so it's never recomputed.

This buys real power. Infinite lists are idiomatic (`[1..]`, `repeat 0`, `cycle xs`). The generate-and-filter modularity from the middle level is the *normal* way to write code, not a special technique. `take 5 primes` over an infinite prime list is unremarkable. Control flow built from ordinary functions works because arguments aren't forced until used — you can write your own `if`, your own short-circuit operators, your own `unless`.

But the bill comes due as **space leaks**. The canonical horror is `sum [1..1e9]` written with the wrong fold: instead of accumulating a running total, the program builds a *gigabyte-tall tower of unevaluated thunks* — `((((0+1)+2)+3)+…)` — and either crashes with a stack overflow when finally forced or sits there eating heap. The fix is to *break* laziness in the right place: `seq`, `($!)`, `BangPatterns`, `foldl'`, `deepseq`. A senior Haskeller's craft is largely knowing *where* a thunk should be forced and *where* it should stay lazy.

This page covers: call-by-need and how thunks live on the heap; Weak Head Normal Form (WHNF) vs. Normal Form (the two "how far to evaluate" levels); the `foldl` thunk-buildup space leak and `foldl'` as its cure; `seq`, `($!)`, `BangPatterns`, and `deepseq`/`force`; why laziness and `IO`/side effects coexist uneasily; and the general discipline of reasoning about evaluation in a lazy language. The next level (`professional.md`) covers compiler strictness analysis, demand analysis, and lazy initialization under concurrency in strict languages.

---

## Prerequisites

- **Required:** Middle-level material — lazy sequences, intermediate vs. terminal, infinite streams, generate-and-filter.
- **Required:** Reading basic Haskell syntax (function definition, `let`/`where`, list syntax, pattern matching). You don't need to be fluent; you need to follow examples.
- **Required:** A clear grasp of "a value vs. a recipe for a value" (thunks).
- **Helpful but not required:** Some exposure to recursion and folds (`foldl`/`foldr`).
- **Helpful but not required:** Awareness of heap vs. stack and what a stack overflow is.

You do **not** need:

- Category theory, monads-in-depth, or type classes beyond reading them.
- The GHC internals of strictness analysis (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Call-by-need** | Lazy evaluation *with memoization*: an argument is passed as a thunk, forced at most once, and the result cached. Haskell's strategy. |
| **Call-by-name** | Lazy without memoization: the thunk is re-evaluated each time it's used. (Scala by-name params.) |
| **Call-by-value** | Eager/strict: arguments evaluated before the call. (Most languages.) |
| **Thunk** | A heap-allocated, unevaluated computation. The runtime representation of "a value not yet computed." |
| **Force / demand** | To evaluate a thunk. Pattern-matching, arithmetic, and `seq` all force their operand. |
| **WHNF (Weak Head Normal Form)** | Evaluated just far enough to expose the *outermost* constructor (e.g. `(:)` for a list, a data constructor). The *spine head* only. |
| **NF (Normal Form)** | Fully evaluated, no thunks anywhere inside. What `deepseq`/`force` produces. |
| **`seq a b`** | Forces `a` to **WHNF** when `b` is forced, then returns `b`. The primitive strictness operator. |
| **`($!)`** | `f $! x` = force `x` to WHNF, then apply `f`. Strict application. |
| **`BangPatterns`** | GHC extension; `!x` in a pattern forces `x` to WHNF on binding. The ergonomic way to add strictness. |
| **`deepseq` / `force`** | Force a value all the way to **NF** (fully, recursively). From `Control.DeepSeq`. |
| **`foldl` vs `foldl'`** | Left fold; `foldl` is lazy in the accumulator (builds thunks); `foldl'` forces the accumulator each step (no buildup). |
| **Space leak** | Memory growing unboundedly because thunks accumulate instead of being evaluated. The signature lazy bug. |
| **Strictness analysis** | A compiler pass that proves a function always forces an argument, allowing it to evaluate eagerly (no thunk). |
| **Bottom (`⊥`)** | A non-terminating or erroring computation. Laziness lets you have `⊥` in a structure you never force. |

---

## Core Concepts

### 1. Everything Is a Thunk Until Forced

In Haskell, evaluation is **demand-driven**. Nothing computes until something needs it. A binding allocates a thunk:

```haskell
let x = expensive 42      -- allocates a thunk; 'expensive' does NOT run
    y = x + x             -- another thunk, referring to x's thunk
in  print y               -- forcing y forces x ONCE (call-by-need memoizes), then adds
```

When `print y` demands `y`, the runtime forces the `+` thunk, which forces `x`'s thunk — *once*. Because of call-by-need, `x` is evaluated a single time even though `y` mentions it twice; the result is written back into `x`'s thunk. That memoization is the difference between call-by-need (Haskell) and call-by-name (re-evaluate each use).

The practical consequence: **the order your code is written has almost nothing to do with the order things execute.** Execution order is whatever the demand for the final result dictates. This is liberating and disorienting in equal measure.

### 2. Infinite Data Is Idiomatic, Not Exotic

```haskell
nats   = [0..]                       -- infinite: 0,1,2,...
ones   = repeat 1                    -- infinite: 1,1,1,...
naturalsBy2 = iterate (+2) 0         -- 0,2,4,...
fibs   = 0 : 1 : zipWith (+) fibs (tail fibs)   -- self-referential Fib stream

main = do
  print (take 10 fibs)               -- [0,1,1,2,3,5,8,13,21,34]
  print (takeWhile (< 100) (map (^2) nats))   -- squares under 100
```

`fibs` defines itself in terms of itself — well-founded *only* because `:` (cons) is lazy in its tail, so `fibs` is a thunk that unfolds exactly as far as `take`/`takeWhile` demands. This is the cleanest possible version of the lazy-stream patterns from earlier levels, and it's just *how you write Haskell*.

### 3. WHNF vs. NF: How Far Does Forcing Go?

Crucial and frequently misunderstood: forcing a value does **not** mean evaluating it completely. It means evaluating to **Weak Head Normal Form (WHNF)** — just enough to expose the *outermost constructor*.

```haskell
seq (1 + 2 : undefined) ()   -- OK! WHNF only needs the outermost (:),
                             -- not the head (1+2) nor the tail (undefined).
```

`seq` forces to WHNF. The list above has outermost constructor `(:)`, so `seq` is satisfied — it never touches the head thunk `1+2` or the bottom tail. To force *everything*, you need `deepseq` / `force`, which drives to **Normal Form (NF)**: no thunks anywhere inside.

This distinction is the source of countless "I added `seq` and still leaked" bugs. `seq` on a tuple forces the tuple's outer constructor but leaves both *components* as thunks. You wanted NF; you got WHNF.

### 4. The Space Leak: `foldl` and the Thunk Tower

Here is the canonical disaster. Sum a billion numbers:

```haskell
import Data.List (foldl)

main = print (foldl (+) 0 [1..1000000000])    -- DON'T: space leak
```

`foldl` is **lazy in its accumulator**. It does *not* compute the running sum. Instead it builds:

```text
(((...((0 + 1) + 2) + 3) + ...) + 1000000000)
```

— a thunk a billion levels deep, held entirely on the heap, *then* forced all at once at the end, typically overflowing the stack. The program either crashes or consumes gigabytes. The data list `[1..1e9]` is fine (lazy, GC'd as consumed); the **accumulator** is the leak.

The cure is **`foldl'`** (strict left fold, from `Data.List`):

```haskell
import Data.List (foldl')

main = print (foldl' (+) 0 [1..1000000000])   -- DO: constant space
```

`foldl'` forces the accumulator to WHNF on *every step*, so the running total is a real number, not a growing thunk. Constant memory, no overflow. The rule of thumb every Haskeller internalizes: **for a strict accumulation, use `foldl'`, never `foldl`.** (And `foldr` is the right choice when you're building a lazy structure or can short-circuit — different tool.)

### 5. Buying Strictness Back: `seq`, `$!`, BangPatterns, `deepseq`

Because laziness is the default, controlling space means *inserting strictness* at the right spots:

- **`seq a b`** — forces `a` to WHNF, then yields `b`. The primitive.
- **`f $! x`** — strict application: force `x` to WHNF, then call `f`. Sugar over `seq`.
- **`{-# LANGUAGE BangPatterns #-}` + `!x`** — force on bind, the ergonomic everyday tool:

```haskell
{-# LANGUAGE BangPatterns #-}
sumStrict :: [Int] -> Int
sumStrict = go 0
  where
    go !acc []     = acc          -- !acc forces the accumulator each call
    go !acc (x:xs) = go (acc + x) xs
```

- **`deepseq` / `force`** — drive to full Normal Form when WHNF isn't enough (e.g. a tuple/record accumulator whose *fields* would otherwise stay thunked):

```haskell
import Control.DeepSeq (deepseq, force)

-- A leak even with foldl', because the PAIR is WHNF but its components thunk:
meanLeaky = foldl' (\(s, c) x -> (s + x, c + 1)) (0, 0)   -- s and c still thunks!

-- Fix: force the components.
meanStrict = foldl' step (0, 0)
  where step (!s, !c) x = (s + x, c + 1)                  -- BangPatterns on fields
```

The `meanLeaky` case is the classic "I used `foldl'` and *still* leaked" trap: `foldl'` forces the tuple to WHNF, but WHNF for `(s, c)` is just "it's a pair" — `s` and `c` themselves stay thunks and tower up. You need component strictness (`!s`, `!c`) or `deepseq`.

### 6. Laziness and Side Effects Don't Mix Cleanly

Pure laziness reorders and skips computation freely — which is *fine* for pure values but *catastrophic* for side effects (the order and number of effects would be undefined). Haskell resolves this by making effects explicit in the `IO` type, sequenced by `>>=`/`do`-notation, *outside* the lazy-evaluation game. This is the deep version of a lesson from earlier levels: **keep side effects out of lazy values.** The famous `lazy IO` / `readFile`-returns-lazy-string feature is widely considered a misfeature precisely because it smuggles effects (file handles closing) into laziness, producing non-deterministic resource bugs. Senior practice prefers strict/streaming IO libraries.

---

## Real-World Analogies

**The just-in-time factory vs. the warehouse.** Haskell is a pure just-in-time factory: nothing is built until an order (demand) arrives, and it's built exactly as far as the order specifies (WHNF = "show me the box," NF = "show me everything inside"). A space leak is *order slips piling up unfilled* — you keep deferring, and the backlog (thunks) crushes the floor.

**The IOU avalanche.** Each `foldl (+)` step writes an IOU: "I owe you the sum so far, computed later." A billion IOUs stack into a tower. `foldl'` cashes each IOU the moment it's written — no stack. `seq`/`!` is "cash this IOU now."

**Peeling an onion (WHNF vs NF).** Forcing to WHNF peels exactly *one* layer — you see the outermost constructor and stop. `deepseq` peels the whole onion to the core. Many bugs are "I peeled one layer and assumed I'd peeled them all."

**The smart vs. naive accountant.** `foldl'` is the accountant who updates the running balance after every transaction. `foldl` is the accountant who writes down "balance = previous balance + this transaction" a billion times and only computes the final number at year-end — by which point the ledger is a billion pages tall.

---

## Mental Models

**Model 1: Demand flows backward from the answer.** Start at the final `print`/`main`. It demands a value. That demand propagates *backward* through the program, forcing exactly the thunks needed and no others. Code you wrote that nothing demands never runs.

**Model 2: A thunk is heap until it's a value.** Every unevaluated expression is an object on the heap with a pointer to its code. Forcing replaces it (in place, call-by-need) with the computed value. A space leak is *thunks that should have collapsed into small values but instead retained references to large structures.*

**Model 3: Two dials — laziness and strictness — and you tune them locally.** The default dial is "lazy everywhere." Your job is to turn the *strictness* dial up at the few hot spots (accumulators, large folds) where laziness would leak, and leave it down everywhere else (infinite data, short-circuiting).

**Model 4: WHNF is one layer; NF is all layers.** Always ask, when you force something, "to what depth?" `seq`/`!`/`$!` → one layer (WHNF). `deepseq`/`force` → all layers (NF). Mismatch here is the leak.

---

## Code Examples

### The leak and its fix, side by side

```haskell
import Data.List (foldl, foldl')

-- LEAKS: billion-deep thunk tower in the accumulator → stack overflow.
badSum :: Integer
badSum = foldl (+) 0 [1..100000000]

-- CONSTANT SPACE: foldl' forces the accumulator each step.
goodSum :: Integer
goodSum = foldl' (+) 0 [1..100000000]
```

### `seq` forces, but only to WHNF — watch the depth

```haskell
import Control.DeepSeq (force)

pair :: (Int, Int)
pair = (1 + 1, 2 + 2)

whnf = pair `seq` "forced to WHNF"   -- forces the tuple shape; 1+1 and 2+2 STAY thunks
nf   = force pair `seq` "forced to NF" -- forces components too: both are real Ints now
```

### A strict accumulator with BangPatterns (the idiomatic fix)

```haskell
{-# LANGUAGE BangPatterns #-}

mean :: [Double] -> Double
mean xs = s / fromIntegral c
  where
    (s, c) = foldl' step (0, 0) xs
    step (!s, !c) x = (s + x, c + 1)   -- !s, !c force fields → no thunk buildup
```

### Infinite structures + the sieve, Haskell-native

```haskell
primes :: [Int]
primes = sieve [2..]
  where sieve (p:xs) = p : sieve [x | x <- xs, x `mod` p /= 0]

main = print (take 10 primes)   -- [2,3,5,7,11,13,17,19,23,29]
```

`sieve` recurses over an *infinite* list and yet `take 10` makes it terminate — demand-driven evaluation realizes only the prefix asked for. This is the middle-level sieve, but here it's the *natural* expression, not a deliberate trick.

### Laziness enables custom control flow

```haskell
-- Because arguments are thunks, you can write your own short-circuit / control flow:
myIf :: Bool -> a -> a -> a
myIf True  t _ = t      -- 'f' (the else branch) is never forced
myIf False _ f = f      -- 't' is never forced

safeHead :: [a] -> a -> a
safeHead xs def = myIf (null xs) def (head xs)   -- head xs not forced if xs is empty
```

In a strict language `myIf` can't work — both branches would evaluate before the call. Laziness is what makes `&&`, `||`, `if` expressible as *ordinary functions* rather than built-in magic.

### Bottom in an unforced position is harmless

```haskell
-- This is FINE: we never force the second element, so 'undefined' never blows up.
safe = take 1 [1, undefined, 3]    -- [1]

-- This blows up: forcing the spine to length reaches 'undefined'.
boom = length [1, undefined, 3]    -- length forces the SPINE... but not the elements!
                                   -- actually OK: length only forces (:), not heads.
-- THIS blows up: summing forces the elements.
kaboom = sum [1, undefined, 3]     -- *** Exception: Prelude.undefined
```

The subtlety — `length` forces the list *spine* (the `(:)` constructors) but **not** the element thunks, so `length [1, undefined, 3]` is `3`, no crash — is exactly the WHNF/NF distinction in the wild, and a favorite interview trap.

---

## Pros & Cons

**Lazy-by-default (Haskell) — pros**

- **Infinite data and generate-and-filter are idiomatic**, not special-cased.
- **Composability:** functions don't force arguments, so control flow and combinators compose freely.
- **Modularity** (Hughes): producers and consumers decouple; consumption drives production.
- **Can hold `⊥` safely** in positions never forced — partial structures, knot-tying (`fibs`).
- **Automatic short-circuiting** everywhere, not just in `&&`/`||`.

**Lazy-by-default — cons**

- **Space leaks** are the signature failure: thunk buildup in accumulators (`foldl`, lazy state, lazy tuples).
- **Reasoning about *when* and *how much* work happens is hard** — execution order ≠ source order.
- **Performance is unpredictable** without `seq`/`!`/`foldl'` discipline; profiling (heap profiles) is essential.
- **Side effects don't fit** — laziness and effects coexist awkwardly (lazy IO bugs); must be quarantined in `IO`.
- **WHNF/NF confusion** — adding `seq` in the wrong place "fixes nothing."

---

## Use Cases

- **Stream processing and producer/consumer pipelines** where consumption naturally bounds production.
- **Search and backtracking** over infinite/huge spaces with early termination (`take`, `find`).
- **Knot-tying / circular definitions** (`fibs`, lazy graphs, lazy memo tables built via laziness).
- **Algorithms that benefit from "build the whole structure, use part"** — minimax with `take`, lazy DP tables.
- **Reach for strictness** (`foldl'`, `!`, `deepseq`) whenever you *accumulate* a value across a long sequence — sums, counts, running state, large folds — to avoid leaks.

---

## Coding Patterns

**Pattern: strict left fold for accumulation.** Use `foldl'` (and `Data.Map.Strict`, strict `State`, strict fields) whenever you reduce a sequence to a value. `foldl` is almost always wrong here.

**Pattern: bang the accumulator.** With `BangPatterns`, prefix accumulator parameters with `!` in recursive helpers so they force to WHNF each step.

**Pattern: strict data fields.** Declare record/data fields strict with `!` so values stored in them are forced on construction, preventing thunk accumulation inside long-lived structures:

```haskell
data Stats = Stats { total :: !Int, count :: !Int }   -- strict fields, no inner thunks
```

**Pattern: `deepseq` at boundaries.** Force results to NF before storing them in caches, sending across threads, or returning from a worker, so you don't ship a thunk that retains a huge structure.

**Pattern: keep laziness for the producer, add strictness at the reducer.** Lazy generation (`[1..]`, `iterate`) is great; the *consumer that folds it down* is where strictness goes.

**Pattern: quarantine effects in `IO`.** Never bury side effects in lazy pure values; sequence them explicitly.

---

## Best Practices

- **Default to `foldl'` for strict reductions; reserve `foldr` for lazy/short-circuiting builds.** Know which one each problem wants.
- **Make accumulator fields strict** (`!Int`, BangPatterns) — the single highest-leverage anti-leak habit.
- **Understand WHNF vs. NF before reaching for `seq`.** If your accumulator is a tuple/record, WHNF won't save you; force the components.
- **Profile with heap profiling** (`+RTS -h`) when memory climbs — leaks are invisible to the type checker and obvious in a heap profile.
- **Don't sprinkle `seq` blindly.** Place strictness where demand analysis fails: long-lived accumulators and large folds. Over-forcing kills the benefits (infinite data, short-circuiting).
- **Keep effects in `IO`, avoid lazy IO** for resources (file handles, sockets); prefer streaming libraries with deterministic resource handling.
- **Treat `length`/`sum`/`foldl'`/pattern-match as forcing operations**; reason about exactly what depth each forces.

---

## Edge Cases & Pitfalls

**Pitfall 1: `foldl` instead of `foldl'`.** The textbook space leak. `foldl (+) 0 hugeList` towers thunks. Always `foldl'` for strict accumulation.

**Pitfall 2: "`foldl'` and still leaking."** `foldl'` forces only to WHNF. A tuple/record accumulator is WHNF as soon as its *constructor* is known; its *fields* stay thunks. Force the fields (`!s`, `!c`, strict data fields, `deepseq`).

**Pitfall 3: `seq` doesn't deep-force.** `x `seq` y` forces `x` one layer. If you needed the whole structure evaluated, you wanted `deepseq`/`force`.

**Pitfall 4: lazy state in `State`/`Writer` monad.** The lazy variants accumulate thunks in the state/log identically to `foldl`. Use `Control.Monad.State.Strict`, strict `Writer`/`mtl` accumulators, or accumulate into strict structures.

**Pitfall 5: lazy IO resource leaks.** `readFile` returns a lazy `String`; the handle closes when the string is fully consumed — which may be never, or after the `withFile` scope. Non-deterministic. Prefer strict/streaming IO.

**Pitfall 6: over-forcing.** Slapping `deepseq` everywhere destroys laziness's benefits — infinite structures now hang, short-circuiting now evaluates both branches, and you pay to force values you never use. Strictness is a scalpel, not a hammer.

**Pitfall 7: `⊥` hiding in unforced positions.** A bottom value (error/loop) lurking in a structure is *fine* until something forces it — meaning a refactor that adds a force (e.g. switching `foldr` to `foldl'`, or adding `length`) can resurrect a latent crash that "always worked before."

---

## Test Yourself

1. Distinguish call-by-value, call-by-name, and call-by-need. Which is Haskell's, and what does the "need" add?
2. What is WHNF? What is NF? Which does `seq` produce, and which does `deepseq` produce?
3. Walk through *why* `foldl (+) 0 [1..1e9]` leaks and `foldl' (+) 0 [1..1e9]` does not.
4. You switched to `foldl'` for a `(sum, count)` accumulator and *still* leak. Why, and how do you fix it?
5. Why does `length [1, undefined, 3]` return `3` without crashing, but `sum [1, undefined, 3]` throws?
6. Why can Haskell define `if`/`&&`/`||` and your own `myIf` as ordinary functions, while a strict language cannot?
7. Why do side effects need the `IO` type? What goes wrong if effects live in arbitrary lazy values?

<details>
<summary>Answers</summary>

1. **Call-by-value:** evaluate args before the call (strict). **Call-by-name:** pass args as thunks, re-evaluate each use. **Call-by-need:** pass as thunks, evaluate at most once, *memoize* the result. Haskell is call-by-need; "need" adds memoization, so a shared lazy value computes only once.
2. **WHNF:** evaluated to expose the outermost constructor only (the rest stays thunked). **NF:** fully evaluated, no thunks anywhere. `seq` forces to WHNF; `deepseq`/`force` forces to NF.
3. `foldl` is lazy in the accumulator: it builds `(((0+1)+2)+…)`, a thunk billions deep on the heap, forced only at the end — overflowing the stack / eating heap. `foldl'` forces the accumulator to WHNF each step, so the running sum is always a real `Int`: constant space.
4. `foldl'` forces the tuple to WHNF, but WHNF for `(s, c)` is just "it's a pair" — `s` and `c` remain thunks that tower up. Fix: force the components with BangPatterns (`step (!s, !c) x = …`), strict data fields, or `deepseq`.
5. `length` forces only the list *spine* (the `(:)` constructors), never the element thunks — so the `undefined` head is never touched. `sum` forces each *element* to add it, so it hits `undefined` and throws. This is WHNF/spine-vs-element in action.
6. Because Haskell arguments are passed as thunks and forced only when used, `myIf` can return one branch without forcing the other. In a strict (call-by-value) language, both branches evaluate *before* the call, so a user-defined `if` would always run both — hence `if`/`&&`/`||` must be built-in special forms there.
7. Pure laziness freely reorders, skips, and shares computations — fine for values, but it would make the *order and number* of side effects undefined. `IO` makes effects first-class values sequenced explicitly (`>>=`/`do`), pulling them out of the lazy-evaluation game so their ordering is deterministic.

</details>

---

## Cheat Sheet

```text
HASKELL = lazy by default = everything is a THUNK until forced (call-by-need = lazy + memoized)

FORCING DEPTH:
  WHNF  = outermost constructor only   ← seq, $!, BangPatterns (!x)
  NF    = fully evaluated, no thunks    ← deepseq, force

THE SPACE LEAK:
  foldl  (+) 0 [1..1e9]  → thunk tower → stack overflow   ✗
  foldl' (+) 0 [1..1e9]  → constant space                 ✓

"foldl' AND STILL LEAKING":
  tuple/record accumulator → WHNF stops at the constructor;
  fields stay thunks → bang the fields (!s, !c) or strict data fields

STRICTNESS TOOLS:
  seq a b        force a to WHNF, return b
  f $! x         force x to WHNF, then f x
  !x  (pattern)  force on bind (BangPatterns)
  data F = F !T  strict field
  deepseq / force  force to NF

LAZINESS BUYS:
  infinite data [1..], repeat, cycle, iterate, self-ref fibs
  custom control flow (myIf), short-circuiting everywhere
  ⊥ safe in unforced positions

WATCH:
  length forces SPINE not elements; sum forces elements
  lazy IO → resource leaks; keep effects in IO
  over-forcing kills infinite data + short-circuiting
  profile leaks with +RTS -h
```

---

## Summary

In Haskell, laziness is not a feature you opt into — it is the **default evaluation strategy**. Every expression is a **thunk** on the heap until something demands it, and demand flows *backward* from the program's final result, so source order tells you little about execution order. The strategy is **call-by-need**: thunks are forced at most once and the result memoized. This makes infinite data (`[1..]`, `repeat`, self-referential `fibs`), generate-and-filter pipelines, and user-defined control flow (`myIf`, lazy `&&`) ordinary and elegant, and it lets a structure safely contain `⊥` in positions you never force.

The cost is the **space leak**. The signature case — `foldl (+) 0 [1..1e9]` — builds a billion-deep tower of unevaluated accumulator thunks and overflows. The cure is to *insert strictness* in the right place: `foldl'` for strict reductions, `seq`/`($!)` for WHNF forcing, `BangPatterns` (`!x`) for ergonomic per-bind forcing, strict data fields, and `deepseq`/`force` for full Normal Form. The deepest trap is the **WHNF/NF distinction**: `seq` and `foldl'` force only to WHNF — the *outermost constructor* — so a tuple or record accumulator still leaks through its un-forced fields, and the famous `length [1, undefined, 3] == 3` works because spine-forcing never touches element thunks. Laziness also coexists badly with side effects, which Haskell quarantines in `IO`; lazy IO's resource bugs are the standing warning.

A senior's craft in a lazy language is knowing *where to be lazy* (producers, infinite data, short-circuiting) and *where to be strict* (accumulators, large folds, long-lived structure fields), forcing to exactly the right depth and no more — and reaching for a heap profile, not a hunch, when memory climbs. The next level lifts to the compiler's side: strictness/demand analysis that recovers this discipline automatically, and lazy-initialization correctness under concurrency in strict languages.

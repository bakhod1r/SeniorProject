# Eager vs. Lazy Evaluation — Hands-On Tasks

> **Topic:** [Eager vs. Lazy Evaluation](README.md)

---

## Introduction

This file is a structured set of exercises that take you from "I have heard
that generators are lazy" to "I can build infinite streams, diagnose a space
leak, and pick the correct thread-safe lazy-init primitive." Each task is
small enough for one or two focused sessions, and they build on one another.
Attempt each problem *before* reading the hints — five minutes of struggle
with generator exhaustion or the `[2, 2, 2]` closure teaches more than a
clean walkthrough.

How to use this file: read the task, write code, **run it and observe the
actual behavior** (especially *when* things print and *how much* work
happens), and only then check the hints. Mark a self-check box when you can
*explain the result to someone else*, not when the program merely compiles.
Solutions are intentionally sparse — they appear only where the canonical
answer is more instructive than your first attempt.

Pick whichever language fits each task; some are language-specific by design
(Haskell space leaks, C# multiple enumeration, Java Streams).

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)

---

## Warm-Up

These rebuild the mental model. Short, but each introduces a primitive or a
failure mode reused later.

### Task 1: Observe eager vs. lazy with print order

**Problem.** In Python, write a function `noisy(x)` that prints `f"computing {x}"`
and returns `x * x`. Build a list comprehension `[noisy(x) for x in range(5)]`
and, separately, a generator expression `(noisy(x) for x in range(5))`. After
each, print `"built"`. Then pull one value from each. Record the exact order
of output.

**Constraints.**
- Do not change `noisy`.
- Print `"built"` immediately after each construction, before pulling.

**Hints (try without first).**
- The list comprehension prints all five `computing` lines *before* `"built"`.
- The generator prints `"built"` first, then exactly one `computing` line when
  you call `next()`.
- The difference is *when* the work happens, not *what* it computes.

**Self-check.**
- [ ] You can state which bracket is eager and which is lazy.
- [ ] You can predict the output order without running it.
- [ ] You can explain why the generator did less work.

---

### Task 2: Short-circuit as laziness

**Problem.** Write `expensive()` that prints `"ran expensive"` and returns
`True`. Then evaluate `False and expensive()` and `True or expensive()`.
Confirm `"ran expensive"` never prints. Now write the same with a value that
*would crash* if evaluated (e.g. `data is not None and data.value > 0` with
`data = None`) and confirm no crash.

**Hints (try without first).**
- `and` skips its right operand when the left is falsy; `or` skips when truthy.
- This is laziness you already rely on for correctness, not just performance.

**Self-check.**
- [ ] You can name three short-circuit/non-strict operators.
- [ ] You can explain why reordering `a and b` could introduce a crash.

---

### Task 3: Generator exhaustion

**Problem.** Create `gen = (x*x for x in range(4))`. Call `list(gen)` twice and
print both results. Explain why the second is `[]`. Then make it work: produce
the squares twice, two different ways.

**Hints (try without first).**
- A generator is a *one-shot* stream; once consumed it is empty forever.
- Way 1: materialize once — `data = list(gen)` — then reuse `data`.
- Way 2: wrap creation in a function and call it again for a fresh generator.

**Self-check.**
- [ ] You can explain "exhaustion" without using the word "reset."
- [ ] You know two ways to iterate the same logical sequence twice.

---

### Task 4: The `[2, 2, 2]` closure trap

**Problem.** Predict, then run:

```python
funcs = [lambda: i for i in range(3)]
print([f() for f in funcs])
```

Explain the output. Then fix it so it prints `[0, 1, 2]`.

**Hints (try without first).**
- The lambdas capture the *variable* `i`, evaluated lazily — *after* the loop,
  when `i == 2`.
- Fix with a default argument that binds the value eagerly: `lambda i=i: i`.

**Self-check.**
- [ ] You can articulate "captures the variable, read late."
- [ ] You can reproduce the analogous trap in JS (`var` vs `let`).

<details>
<summary>Solution sketch</summary>

```python
funcs = [lambda i=i: i for i in range(3)]   # default arg snapshots i now
print([f() for f in funcs])                 # [0, 1, 2]
```

The default-argument value is evaluated at lambda *definition* time, capturing
the current `i` by value instead of capturing the live variable.

</details>

---

## Core

These build the working techniques: infinite streams, generate-and-filter,
and the cross-language laziness traps.

### Task 5: Infinite stream toolkit

**Problem.** Implement, as lazy generators in your language of choice:
`repeat(x)` (x forever), `iterate(f, seed)` (`seed, f(seed), …`), and
`naturals()` (0,1,2,…). Then produce the first 10 powers of two using
`iterate`, and the first 10 naturals divisible by 3 — *without* ever building
an infinite list.

**Constraints.**
- Every generator must be genuinely infinite (`while True`).
- Bound consumption with a `take`/`islice`/`limit`, never a full materialize.

**Hints (try without first).**
- Powers of two: `iterate(lambda x: x*2, 1)`.
- Divisible by 3: filter `naturals()` then take 10.
- If your program hangs, you applied a fully-forcing op to an infinite source.

**Self-check.**
- [ ] You can explain why `list(naturals())` hangs but `islice(naturals(), 10)`
      does not.
- [ ] You can compose `iterate` + `filter` + `take` cleanly.

---

### Task 6: The lazy Fibonacci stream

**Problem.** Produce the first 20 Fibonacci numbers as a lazy stream. Then,
*without recomputing from scratch*, get the first 20 even-valued Fibonacci
numbers.

**Hints (try without first).**
- A generator with `a, b = b, a+b` after each `yield a` gives the stream.
- For even Fibs: filter the stream, then take 20.
- Confirm you compute roughly as many Fibs as you consume, not more.

**Self-check.**
- [ ] Your stream computes exactly the prefix you ask for.
- [ ] You can describe how generate (fibs) and filter (even) decouple.

---

### Task 7: Lazy sieve of Eratosthenes

**Problem.** Implement a lazy prime generator using the generate-and-filter
sieve: start from `2,3,4,…`; the head is prime; recursively filter out its
multiples from the rest. Print the first 15 primes.

**Constraints.**
- The candidate source must be an infinite lazy stream.
- Each found prime installs a new lazy filter over the remaining stream.

**Hints (try without first).**
- `yield p`, then `yield from sieve(x for x in stream if x % p != 0)`.
- This is elegant, not fast — the point is the *shape* (layered lazy filters),
  not primality performance.

**Self-check.**
- [ ] You can explain why this terminates despite an infinite source.
- [ ] You can state why it gets slow (a growing stack of filters per prime).

<details>
<summary>Solution sketch (Python)</summary>

```python
import itertools
def sieve(stream):
    p = next(stream)
    yield p
    yield from sieve(x for x in stream if x % p != 0)

print(list(itertools.islice(sieve(itertools.count(2)), 15)))
```

</details>

---

### Task 8: Generate-and-filter modularity (Newton's sqrt)

**Problem.** Compute √2 by generating an *infinite* lazy stream of
approximations (Newton's method: `guess = (guess + n/guess)/2`) and, in a
*separate* function, consuming until two successive approximations differ by
less than `1e-12`. Neither function should know about the other's stopping
condition.

**Hints (try without first).**
- `approximations` is an infinite generator; `within(eps, stream)` decides
  when to stop. That separation is the whole point.
- The generator does only as much work as `within` demands.

**Self-check.**
- [ ] Generation and stopping are fully decoupled (you could reuse either).
- [ ] You can explain why this composes only because generation is lazy.

---

### Task 9: LINQ multiple enumeration (C#)

**Problem.** In C#, build `var q = source.Where(x => { Console.WriteLine($"filter {x}"); return x % 2 == 0; });`
over `Enumerable.Range(1, 5)`. Call `q.Count()` and then `q.ToList()`. Count
how many times `"filter"` prints. Explain it, then fix it so the filter runs
only once.

**Hints (try without first).**
- A deferred `IEnumerable` is cold — each terminal op re-runs the whole pipeline.
- `Count()` runs the filter, `ToList()` runs it *again* → filter prints twice
  per element.
- Fix: materialize once with `var cached = q.ToList();` then read `cached`.

**Self-check.**
- [ ] You can explain "cold sequence = function disguised as data."
- [ ] You know why this matters more when the source is a DB.

---

### Task 10: Java Stream — intermediate vs. terminal, and single-use

**Problem.** In Java, build a stream with a `.peek(System.out::println)` before
a `.filter(...)`. Confirm nothing prints until you add a terminal op
(`collect`). Then call a *second* terminal op on the same stream and observe
the exception. Finally, bound an infinite `Stream.iterate(...)` with `limit`.

**Hints (try without first).**
- `peek`/`filter`/`map` are intermediate (lazy); `collect`/`count`/`forEach`
  force.
- A second terminal op throws `IllegalStateException` — streams are one-shot.
- `Stream.iterate(0, n -> n+1).filter(...).limit(5)` bounds the infinite source.

**Self-check.**
- [ ] You can classify any stream op as intermediate or terminal.
- [ ] You can explain Java's "stream has already been operated upon" error.

---

### Task 11: Deferred logging with a thunk

**Problem.** Write a `log(level, make_message)` function (any language) that
takes a *thunk* (a zero-arg function) for the message and calls it only if
`level >= CURRENT_LEVEL`. Prove with a print inside the thunk that the message
is built only when it will be logged. Compare against the eager version that
builds the string unconditionally.

**Hints (try without first).**
- Pass `lambda: f"dump {expensive()}"` (Python) / `() -> ...` (Java/JS) /
  `Func<string>` (C#).
- The eager version runs `expensive()` even when the level is disabled; the
  lazy one skips it.

**Self-check.**
- [ ] You can explain "convert unconditional cost into conditional cost."
- [ ] You can identify the closure-capture risk if the thunk reads mutable
      state.

---

## Advanced

These confront the hard parts: Haskell space leaks and the WHNF/NF depth
problem.

### Task 12: Reproduce and fix a Haskell space leak

**Problem.** In Haskell (GHCi or a compiled program), evaluate
`foldl (+) 0 [1..10000000]`. Observe the blowup (stack overflow or huge
memory). Replace `foldl` with `foldl'` (from `Data.List`) and confirm constant
space. Explain the difference in one paragraph.

**Constraints.**
- Use a large enough range to actually trigger the leak.
- Import `foldl'` explicitly from `Data.List`.

**Hints (try without first).**
- `foldl` builds a thunk tower `(((0+1)+2)+…)` in the accumulator, forced all
  at once.
- `foldl'` forces the accumulator to WHNF each step → constant space.
- If you can, compile with `-rtsopts` and run `+RTS -s` to see allocation.

**Self-check.**
- [ ] You can explain *where* the leak lives (the accumulator, not the list).
- [ ] You can state the rule: strict reductions use `foldl'`.

---

### Task 13: The "`foldl'` still leaks" tuple trap

**Problem.** Compute the mean of a large list in one pass with a
`(sum, count)` accumulator using `foldl'`. Observe that it *still* leaks. Fix
it. Explain why `foldl'` alone wasn't enough.

**Hints (try without first).**
- `foldl'` forces the tuple to WHNF — but WHNF for `(s, c)` is just "it's a
  pair"; `s` and `c` stay thunks and tower up.
- Fix with BangPatterns on the components (`step (!s, !c) x = (s+x, c+1)`) or a
  strict data type (`data Acc = Acc !Double !Int`).

**Self-check.**
- [ ] You can explain WHNF vs. NF using this exact example.
- [ ] You know three ways to force the components (BangPatterns, strict fields,
      `deepseq`).

<details>
<summary>Solution sketch</summary>

```haskell
{-# LANGUAGE BangPatterns #-}
import Data.List (foldl')

mean :: [Double] -> Double
mean xs = s / fromIntegral c
  where (s, c) = foldl' step (0, 0) xs
        step (!s, !c) x = (s + x, c + 1)   -- force the fields, not just the pair
```

</details>

---

### Task 14: WHNF vs. NF — `length` vs. `sum` of a list with `undefined`

**Problem.** In Haskell, evaluate `length [1, undefined, 3]` and
`sum [1, undefined, 3]`. Predict each result first. Explain why one succeeds
and the other throws.

**Hints (try without first).**
- `length` forces only the *spine* (the `(:)` constructors), never the element
  thunks → returns `3`.
- `sum` forces each *element* to add it → hits `undefined` → throws.

**Self-check.**
- [ ] You can articulate "forcing the structure ≠ forcing the contents."
- [ ] You can predict whether a given function forces spine, elements, or both.

---

### Task 15: Custom control flow via laziness

**Problem.** In a lazy language (Haskell) *or* with Scala by-name parameters,
implement your own `myIf :: Bool -> a -> a -> a` (or a Scala `unless`) that
evaluates only the taken branch. Demonstrate that the *untaken* branch can be
`undefined`/throwing and the program still works.

**Hints (try without first).**
- Haskell: `myIf True t _ = t; myIf False _ f = f` — arguments are thunks, so
  the untaken branch is never forced.
- Scala: `def myIf[A](c: Boolean)(t: => A)(f: => A): A = if (c) t else f`.
- In a strict language this is impossible — both branches would evaluate first.

**Self-check.**
- [ ] You can explain why strict languages must make `if`/`&&` built-in.
- [ ] You can demonstrate the untaken-branch-is-`⊥` case safely.

---

## Capstone

A larger task tying laziness to production correctness.

### Task 16: Thread-safe lazy initialization, done four ways

**Problem.** Implement a lazily-initialized, expensive `Config` object that is
built **exactly once** and is **safe under concurrent first access**. Do it in
at least two of: Java (holder idiom *and* `volatile`+DCL), C# (`Lazy<T>`), Go
(`sync.Once`), C++ (function-local static). For one language, *deliberately
write the broken non-`volatile` DCL version* and explain (in a comment) the
exact reordering that can publish a half-constructed object.

**Constraints.**
- The initializer must run once even under many concurrent callers.
- No global lock on the hot (already-initialized) path where the idiom allows
  it (holder idiom, `sync.Once` fast path).

**Hints (try without first).**
- Java holder idiom: a `static` nested class whose `static final` field is the
  instance; the JVM class-init lock gives once-only + safe publication, no
  `volatile` reasoning.
- Broken DCL: `instance = new Singleton()` is allocate → assign-ref →
  construct, and the assign-ref can be reordered *before* construct completes,
  so an unlocked reader sees a non-null but half-built object.
- `Lazy<T>` defaults to `ExecutionAndPublication` (correct DCL for you, and it
  *caches a thrown exception* — note that).

**Self-check.**
- [ ] You can name the memory-model guarantee each correct version relies on.
- [ ] You can explain why hand-rolled DCL without a barrier is unsafe.
- [ ] You can describe what happens if the initializer throws (per primitive).

---

### Task 17: Hunt an N+1 query caused by lazy loading

**Problem.** (If you have an ORM handy — Hibernate/JPA or EF Core.) Create a
parent entity with a lazy child association. Write a loop that iterates parents
and touches the child on each. Enable SQL logging and count the queries.
Confirm the N+1 pattern (1 + N). Then fix it with an eager fetch (`JOIN FETCH`
/ `Include`) and confirm a single query. Finally, trigger and explain a
`LazyInitializationException` (or EF detached-context error) by touching the
association *after* the session/context closes.

**Hints (try without first).**
- N+1: parents query + one child query per parent. Visible only in query logs.
- Eager fix: `SELECT p FROM Parent p JOIN FETCH p.children`.
- The exception happens because the lazy thunk has no open session to force
  against — laziness moved the failure to first access, past the boundary.

**Self-check.**
- [ ] You can spot N+1 from query logs, not from reading the code.
- [ ] You can explain where the lazy-loading failure surface lives and how
      DTOs/eager fetch move it back inside the transaction.

---

## Self-Assessment

You are done with this topic when you can, without notes:

- Explain eager vs. lazy and point to short-circuit operators as everyday
  laziness.
- Build an infinite lazy stream and bound it correctly (and explain why an
  unbounded `list()`/`collect()` hangs).
- Reproduce and explain: generator exhaustion, the `[2,2,2]` closure trap,
  LINQ multiple enumeration, the Java single-use stream, and `sorted().limit()`
  hanging on an infinite stream.
- Reproduce a Haskell `foldl` space leak, fix it with `foldl'`, and explain why
  a tuple accumulator *still* leaks (WHNF vs. NF).
- Write a correct thread-safe lazy singleton with the right primitive, and
  explain why hand-rolled DCL without a barrier is broken.
- Diagnose an ORM N+1 and a `LazyInitializationException`, and state the fix.
- Decide eager vs. lazy by *where you want cost and failure to land*.

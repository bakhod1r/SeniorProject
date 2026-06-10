# Laziness & Streams — Interview Q&A

> **Roadmap:** [Functional Programming](../README.md) → Laziness & Streams
>
> *Laziness is computing **on demand**: an expression is described now and evaluated only when its result is actually needed — sometimes never. Streams are the lazy sequence: a recipe for elements that materializes one at a time, so you can pipeline transformations, model infinite data, and decouple producing from consuming. The power is real but the costs are sneaky: thunks accumulate, effects fire at surprising times, and a generator you consume twice silently yields nothing the second time.*

A bank of 50+ interview questions and answers spanning eager-vs-lazy intuition, lazy pipelines, streaming API design, space leaks, and the runtime machinery (thunks, WHNF, fusion). Each answer models the reasoning a strong candidate gives — including the trade-offs. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Intermediate / Middle](#intermediate--middle)
3. [Senior — Streaming API Design, Backpressure, Effects](#senior--streaming-api-design-backpressure-effects)
4. [Professional / Deep — Thunks, WHNF, Fusion, Runtime Cost](#professional--deep--thunks-whnf-fusion-runtime-cost)
5. [Code-Reading — Lazy or Eager? When Does It Run?](#code-reading--lazy-or-eager-when-does-it-run)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. How to Talk About Laziness in Interviews
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> Eager vs lazy, generators/iterators, infinite sequences.

**Q1. What is the difference between eager and lazy evaluation?**

<details><summary>Answer</summary>

**Eager** (strict) evaluation computes an expression as soon as it's bound — the moment you write `x = expensive()`, `expensive()` runs. **Lazy** (non-strict) evaluation defers the computation until the value is actually *demanded* by something that needs it; if nothing ever needs it, it never runs. Most mainstream languages (Python, Java, Go, C) are eager by default; Haskell is lazy by default. The practical consequences of lazy: you can describe infinite or expensive computations cheaply, skip work that's never needed, and short-circuit pipelines — at the cost of less predictable *when* (and whether) code executes.
</details>

**Q2. What is a stream in the functional sense?**

<details><summary>Answer</summary>

A stream is a **lazily-produced sequence**: a recipe that yields elements one at a time, on demand, rather than a fully-materialized collection sitting in memory. Conceptually it's a head plus a *thunk* for the rest — "here's the first element, and here's how to compute the tail if you ask." This lets a stream be infinite (the tail is only ever partially forced), lets transformations chain without intermediate collections, and lets a consumer pull only as much as it needs. Java's `Stream`, Python's generators, Go's channels/iterators, and Haskell's lazy lists are all instances of the idea.
</details>

**Q3. What is a generator, and how does it relate to laziness?**

<details><summary>Answer</summary>

A generator is a function that produces a sequence of values *incrementally* — it runs until it `yield`s a value, then suspends with its local state frozen, and resumes from exactly that point when the next value is demanded. That suspend/resume mechanism *is* laziness made concrete: nothing past a `yield` runs until someone asks for more. In Python you write `yield`; in modern Java you build it with `Stream.iterate`/`generate`; in Go (1.23+) `iter.Seq` and `range`-over-func give the same pull-based behavior. The key property: a generator holds only its current state, not the whole sequence, so it can model unbounded data in O(1) space.
</details>

**Q4. How can a lazy sequence be infinite without running out of memory?**

<details><summary>Answer</summary>

Because it's never fully built — only the prefix you actually consume is materialized, and a generator keeps just enough state to compute the *next* element. `naturals()` that yields `0, 1, 2, …` forever stores a single counter; taking the first 10 forces exactly 10 steps and then stops. The infinity lives in the *description* (the recipe for "the next one"), not in memory. You run out of memory only if you accidentally *retain* every element produced (e.g. collecting them into a list) or if a consumer demands the whole thing (`list(naturals())` hangs).

```python
def naturals():
    n = 0
    while True:
        yield n      # suspends here; only `n` is live
        n += 1

from itertools import islice
print(list(islice(naturals(), 5)))  # [0, 1, 2, 3, 4] — forces only 5
```
</details>

**Q5. What's the difference between an iterable and an iterator in Python?**

<details><summary>Answer</summary>

An **iterable** is anything you can get an iterator *from* — it implements `__iter__` (lists, dicts, ranges, files). An **iterator** is the thing that actually produces values one at a time via `__next__`, and crucially it is *stateful and single-use*: once exhausted, it yields nothing more. A list is a re-iterable container (each `for` gets a fresh iterator); a generator is *both* — it is its own iterator, which is exactly why you can only loop over it once. The distinction explains the classic bug: re-iterating a list works, re-iterating a generator gives empty results.
</details>

**Q6. Can you iterate a Python generator twice?**

<details><summary>Answer</summary>

No. A generator is a single-use iterator: once it's exhausted, every further request for a value raises `StopIteration`, so a second loop runs zero times. This bites people constantly:

```python
g = (x * 2 for x in range(3))
print(list(g))   # [0, 2, 4]
print(list(g))   # [] — already exhausted, silently empty
```

If you need to iterate more than once, either materialize it into a list/tuple (giving up laziness and the memory savings), use `itertools.tee` to clone it (which buffers consumed-but-not-yet-replayed items), or re-create the generator from its source. The silent empty second pass — no error — is what makes this a frequent, hard-to-spot bug.
</details>

**Q7. Give a concrete benefit of laziness in everyday code.**

<details><summary>Answer</summary>

Reading a huge file line by line. An eager approach (`lines = f.readlines()`) loads the entire file into memory before you process anything; a lazy one (`for line in f:`) pulls one line at a time, so a 50 GB log processes in constant memory. The same idea powers `filter`/`map` over large datasets, paginated API results, and `take(n)` from an expensive source: you do exactly the work the consumer demands and not a byte more. Laziness turns "load everything, then process" into "process as it arrives."
</details>

**Q8. What does `range(1_000_000)` cost in Python 3 versus building a list of a million numbers?**

<details><summary>Answer</summary>

`range` is lazy: it's a constant-size object that *computes* each value on demand from `start`, `stop`, `step`, so `range(1_000_000)` allocates essentially nothing and is instantaneous. `list(range(1_000_000))` eagerly materializes a million integer objects in a real list — megabytes of memory and the time to build it. If you only iterate once, the `range` is strictly better. You pay for the list only when you need random access, length-independent reuse, or to iterate multiple times. (Python 2's `range` returned a list; `xrange` was the lazy one — a common historical gotcha.)
</details>

**Q9. What is "demand" or "forcing" a value?**

<details><summary>Answer</summary>

*Forcing* (or *demanding*) a value means triggering the deferred computation so it produces an actual result. A lazy value sits as an unevaluated recipe until something needs its concrete form — printing it, pattern-matching on it, adding it to a number, or a terminal operation consuming a stream. That act of needing-the-result-now is what forces it. Understanding *what forces evaluation* is the whole game with laziness: bugs and surprises almost always come from misjudging when forcing happens (too late, never, or unexpectedly during an effectful operation).
</details>

**Q10. Why are comprehensions in Python sometimes lazy and sometimes eager?**

<details><summary>Answer</summary>

It's the brackets. A **list comprehension** `[x*2 for x in xs]` is eager — it builds the whole list immediately. A **generator expression** `(x*2 for x in xs)` is lazy — it produces a generator that yields on demand. Same body, different evaluation strategy chosen by `[]` vs `()`. Set and dict comprehensions are also eager. The rule of thumb: use the generator expression when you'll consume the result once and want to avoid building an intermediate collection (especially when feeding `sum`, `any`, `max`, or an early-exit loop); use the list when you need to reuse or index it.
</details>

**Q11. Is a Python `for` loop over a generator lazy?**

<details><summary>Answer</summary>

Yes — the loop pulls one value at a time. Each iteration calls `next()` on the generator, which resumes it just far enough to produce the next `yield`, runs the loop body, then suspends the generator again. Nothing is precomputed. This is why you can loop over an infinite generator with a `break` and it terminates: the loop only demands values until you stop asking. It's also why a `return`/`break` partway through leaves the rest of the sequence never computed.
</details>

---

## Intermediate / Middle

> Lazy pipelines, short-circuiting, memoized lazy values, processing unbounded data.

**Q12. How does a lazy pipeline avoid building intermediate collections?**

<details><summary>Answer</summary>

In an eager pipeline, each stage fully materializes its output before the next begins: `map` builds a whole list, then `filter` builds another whole list, then you consume it — three full passes and two throwaway collections. A lazy pipeline instead pulls *one element all the way through*: the consumer asks for a value, which pulls one through `filter`, which pulls one through `map`, which pulls one from the source. No intermediate list ever exists; memory is O(1) in the pipeline length rather than O(n) per stage. This element-at-a-time flow is what makes `source.map(...).filter(...).first()` cheap even on a billion-element source.
</details>

**Q13. What is short-circuiting in a lazy pipeline, and why does it matter?**

<details><summary>Answer</summary>

Short-circuiting means a consumer stops pulling once it has its answer, so upstream stages never produce the rest. `findFirst`, `anyMatch`, `limit(n)`, `take`, and `||`/`&&` all short-circuit. The payoff: you can run a cheap query over an enormous or infinite source and pay only for what you touch — `naturals().map(expensive).filter(pred).first()` evaluates `expensive` exactly until the first match, not for all naturals. Eager pipelines can't do this; they'd compute everything first. Short-circuiting is the practical reason laziness composes well with infinite streams.
</details>

**Q14. How do you sum an infinite stream's first N elements?**

<details><summary>Answer</summary>

You bound it *before* you reduce — apply a `take`/`limit`/`islice` so the otherwise-infinite source is truncated, then fold. The laziness ensures only N elements are ever produced.

```python
# Python
from itertools import islice
def naturals():
    n = 0
    while True: yield n; n += 1
total = sum(islice(naturals(), 100))   # 4950 — forces exactly 100
```

```java
// Java
int total = Stream.iterate(0, n -> n + 1)   // infinite
                  .limit(100)                 // bound it
                  .mapToInt(Integer::intValue)
                  .sum();
```

The trap is reducing *without* bounding: `sum(naturals())` or an unbounded `reduce` over an infinite stream never terminates, because the reduction demands every element. Laziness makes the infinite source *safe*, but only if a short-circuiting operation sits between the source and the terminal reduce.
</details>

**Q15. What is a memoized lazy value (a "lazy val"), and why use one?**

<details><summary>Answer</summary>

A memoized lazy value defers its computation until first access, then *caches* the result so subsequent accesses are free — compute-once, on-demand. It's the union of laziness (don't compute until needed) and memoization (don't recompute). Scala's `lazy val`, Haskell's thunks (which are memoized by default), Python's `functools.cached_property`, and Kotlin's `by lazy {}` all do this. Use it for an expensive field that may not always be needed (a parsed config, a compiled regex, a DB connection) and is referentially transparent. The subtlety: thread-safety on first force (double-checked locking) and the fact that it captures the result *and the surrounding values* it closed over — a retention risk.
</details>

**Q16. Distinguish "lazy" from "memoized." Are they the same?**

<details><summary>Answer</summary>

No. **Lazy** = "don't compute until demanded." **Memoized** = "don't recompute once computed." A value can be lazy but *not* memoized — a Python generator recomputes on each fresh iteration (in fact you can't re-iterate it at all). A value can be memoized but eager — a precomputed cache. Haskell's laziness happens to be memoized (forcing a thunk updates it in place with the result), which is why `let xs = expensive in (head xs, head xs)` computes `expensive` once. Conflating the two leads to wrong performance assumptions: assuming a lazy stream caches its elements when re-traversed (it may not) is a common error.
</details>

**Q17. How do you process an unbounded data source — e.g. a network feed or a file you can't fit in memory?**

<details><summary>Answer</summary>

Treat it as a lazy stream and never materialize the whole thing: read/pull one chunk, transform it through a lazy pipeline, emit or aggregate, then drop it so it can be collected. Keep state bounded — running totals, fixed-size windows, sketches (HyperLogLog, count-min) — rather than accumulating elements. Bound any reduction with a `take`/timeout/poison-pill so it can terminate. Crucially, ensure your consumer can keep up or apply backpressure, and make sure you don't accidentally hold a reference to the stream's head (which would retain everything). The mental model: "data flows *through* a constant-size window," not "data piles up and then I process it."
</details>

**Q18. In a lazy pipeline, when do `map`'s side effects run?**

<details><summary>Answer</summary>

Only when the element is pulled through by a downstream consumer — not when `map` is declared. So `stream.map(x -> { log(x); return f(x); })` logs nothing until a terminal/short-circuiting operation demands elements, and it logs only for the elements actually consumed. If you `limit(3)` after the `map`, you see three log lines, not n. This is why putting effects inside `map` is fragile: the *number* and *timing* of effects depend on the consumer, which can be far away and may change. Prefer keeping `map` pure and running effects in an explicit terminal stage (`forEach`) where the count is obvious.
</details>

**Q19. What's the bug here, and how do you fix it?**

```python
def get_records():
    rows = (parse(line) for line in open("data.csv"))
    return rows

records = get_records()
print(sum(1 for _ in records))   # count
print(max(r.value for r in records))   # max — BUG
```

<details><summary>Answer</summary>

The generator `records` is **consumed twice**. The first line exhausts it counting rows; the second line iterates an already-empty generator, so `max(...)` raises `ValueError: max() arg is an empty sequence` (or returns nothing meaningful). Generators are single-use. Fixes: (a) materialize once — `records = list(get_records())` — trading memory for re-iterability; (b) compute both aggregates in a *single* pass; or (c) re-create the generator before the second use. There's also a latent file-handle leak (the file is never explicitly closed). The single-pass fix is the most stream-friendly:

```python
count, mx = 0, float("-inf")
for r in get_records():
    count += 1; mx = max(mx, r.value)
```
</details>

**Q20. How does `itertools.tee` let you iterate a generator twice, and what's the catch?**

<details><summary>Answer</summary>

`tee(gen, 2)` returns independent iterators that replay the same underlying sequence. It works by *buffering*: when one branch advances ahead of the other, `tee` stores the produced-but-not-yet-consumed items so the lagging branch can still see them. The catch is memory — if one consumer races far ahead of (or fully drains before) the other, `tee` buffers the entire gap, which for a large or infinite source defeats the point of laziness and can OOM. `tee` is only cheap when the consumers advance roughly in lockstep. If they don't, materializing to a list is simpler and no worse.
</details>

**Q21. Why prefer a generator expression over a list comprehension when feeding `any()` or `sum()`?**

<details><summary>Answer</summary>

`any()` short-circuits — it stops at the first truthy element. Feed it a *list* comprehension and you've already paid to build the entire list before `any` even starts, defeating the short-circuit. Feed it a *generator* expression and elements are produced lazily, so `any(is_prime(x) for x in big)` stops the moment it finds one prime, computing no further. For `sum`/`max`/`min` over a single pass, the generator also avoids the throwaway intermediate list, saving memory. Use the list only when you need the materialized collection afterward.
</details>

**Q22. What's the difference between `Stream.iterate` and `Stream.generate` in Java?**

<details><summary>Answer</summary>

Both create *infinite* lazy streams. `Stream.iterate(seed, f)` produces `seed, f(seed), f(f(seed)), …` — each element depends on the previous, ideal for sequences (counters, Fibonacci with a pair). `Stream.generate(supplier)` calls a `Supplier` repeatedly with no memory of the last value — ideal for constants, random numbers, or pulling from an external source. Both *must* be bounded (`limit`, `takeWhile`, or a short-circuiting terminal) or the terminal operation never returns. Java 9 added a three-arg `iterate(seed, hasNext, f)` that bakes in the stopping condition, the lazy analogue of a `for` loop.
</details>

**Q23. You need only the first matching element from an expensive computation over a large list. Eager `filter().get(0)` vs lazy — what's the difference in work done?**

<details><summary>Answer</summary>

Eager `filter` (e.g. Python's `[x for x in xs if pred(x)][0]` or building a full filtered list) evaluates `pred` for *every* element, then throws away all but the first match — O(n) predicate calls regardless of where the match is. The lazy version (`next(x for x in xs if pred(x))`, or Java `xs.stream().filter(pred).findFirst()`) evaluates `pred` only up to and including the first match — O(k) where k is the position of the first match. If `pred` is expensive and matches are early, this is a dramatic saving. The lazy form is also the only one that works at all on an infinite source.
</details>

---

## Senior — Streaming API Design, Backpressure, Effects

> Designing streaming APIs, backpressure, space leaks, late effects/exceptions.

**Q24. What principles guide designing a good streaming API?**

<details><summary>Answer</summary>

Keep the **stream lazy and single-pass by contract**, and make that contract explicit so callers don't accidentally re-traverse. Separate *describing* the pipeline (pure, reusable transformations) from *running* it (the terminal operation that forces and may perform effects). Provide short-circuiting operations (`take`/`limit`/`takeWhile`) so infinite and large sources are usable. Decide and document **resource ownership** — who closes the underlying file/socket, and ensure it's closed even on early termination or exception (Java's `Stream` is `AutoCloseable` for exactly this). Offer backpressure or bounded buffering if production can outpace consumption. And make effects and ordering predictable: avoid hiding side effects inside intermediate operations where their count and timing depend on the consumer.
</details>

**Q25. What is backpressure, and why do lazy/pull-based streams handle it naturally?**

<details><summary>Answer</summary>

Backpressure is the mechanism by which a slow consumer signals a fast producer to *slow down*, preventing unbounded buffering and OOM. In a **pull-based** (lazy) stream the consumer drives — it requests the next element only when ready — so the producer inherently can't outrun it; backpressure is automatic and the buffer is effectively size-1. The hard case is **push-based** sources (network packets, sensors, `Observable`s) where the producer drives and can't be slowed at the source. There you need explicit strategies: bounded queues with blocking, request-N protocols (Reactive Streams / RSocket), or lossy policies (drop, sample, latest-wins). The interview point: pull-based laziness gives you backpressure for free; push-based needs an explicit protocol.
</details>

**Q26. What is a space leak in the context of laziness, and how does it differ from a normal memory leak?**

<details><summary>Answer</summary>

A space leak is when laziness causes memory to grow *unexpectedly* even though the program is "correct" — typically a chain of unevaluated thunks builds up because the result is never forced, or a reference to a stream's *head* keeps the entire (otherwise-collectible) sequence alive. It differs from a classic leak (where you forget to free / keep adding to a collection): here the program logic looks fine, the thunks/elements *would* be freed if only the value were forced or the head reference dropped. The classic example is a lazy left fold accumulating millions of nested `(+)` thunks instead of a single running total. The cure is usually to *force* strictly at the right point or to *not retain* the head.
</details>

**Q27. Why does a lazy `foldl` leak space, and how does `foldl'` fix it? (Haskell aside)**

<details><summary>Answer</summary>

`foldl (+) 0 [1..1000000]` builds a giant unevaluated thunk: `(((0 + 1) + 2) + 3) + …`. Because `foldl` is lazy in its accumulator, each step *doesn't* add — it constructs a new thunk wrapping the previous one. Nothing forces the sum until the very end, so you accumulate a million nested thunks on the heap, often blowing the stack when finally forced. `foldl'` (strict left fold) forces the accumulator to **WHNF** at each step, so the addition happens immediately and the accumulator stays a single integer — O(1) space. The general lesson, beyond Haskell: in a lazy fold, an accumulator that's never forced mid-loop is a space leak; force it eagerly (or use the strict fold variant). Right folds (`foldr`) have their own story — they can work on infinite lists *if* the combining function is lazy in its second argument.
</details>

**Q28. With laziness, *when* do exceptions and effects actually fire — and why is that dangerous?**

<details><summary>Answer</summary>

At **force time**, not at definition time. If you build a lazy value or stream that will throw (a parse error, a division by zero) or perform an effect (read a file, hit the network), nothing happens until something forces it — which may be in a completely different part of the code, after the surrounding `try`/`with`/`defer` has already exited. So an exception "escapes" its apparent scope: the `try` that wrapped the *construction* doesn't catch a failure that fires during *consumption* elsewhere. Likewise a file opened lazily may be read after you thought it was closed. This makes error handling and resource lifetimes hard to reason about. Mitigations: force eagerly at the boundary where you *can* handle the error/own the resource, or thread the resource lifetime through to the consumer (Java's try-with-resources on a `Stream`, Python `with` that fully consumes inside the block).
</details>

**Q29. Show how lazy file reading can leak a file handle, and how to avoid it.**

<details><summary>Answer</summary>

```python
def lines(path):
    with open(path) as f:
        for line in f:
            yield line        # control returns to caller WHILE file is open

g = lines("big.txt")
first = next(g)               # opens file, reads one line
# ... if we never exhaust g, the `with` never finishes → handle stays open
```

The `with` block can only close the file when the generator is *driven to completion* (or garbage-collected, or `.close()`d). If the consumer stops early — a `break`, an exception, or just dropping the reference — the file may stay open until GC runs `close()` non-deterministically. Avoid it by ensuring the generator is fully consumed inside a controlled scope, by explicitly calling `g.close()` (which throws `GeneratorExit` into the suspended generator, running the `with`'s cleanup), or by using `contextlib.closing`. In Java the equivalent is using a `Stream` from `Files.lines` inside try-with-resources so the underlying handle closes deterministically. The general rule: *lazy resources need an owner who guarantees cleanup regardless of how consumption ends.*
</details>

**Q30. When should an API return an eager collection versus a lazy stream?**

<details><summary>Answer</summary>

Return a **lazy stream** when the result may be large or infinite, when the consumer often needs only a prefix (short-circuiting), when you want to pipeline without intermediates, or when elements arrive over time. Return an **eager collection** when the result is small and bounded, when callers will iterate it multiple times or index into it, when you must release the underlying resource (DB connection, file) before returning, or when you want errors to surface *now* rather than later during consumption. A common pragmatic default for public APIs is to return a materialized `List` unless there's a clear reason for laziness, because eager results are easier to reason about (no re-iteration bugs, no escaping effects, deterministic resource lifetime). Lazy is a deliberate optimization, not a free default.
</details>

**Q31. How do you reconcile laziness with deterministic resource cleanup (RAII / try-with-resources)?**

<details><summary>Answer</summary>

The tension is fundamental: laziness wants to defer work past the current scope, while RAII/`with`/try-with-resources want to release resources *at* scope exit. The reconciliation patterns are: (1) **consume within the scope** — fully drive the lazy sequence before the `with`/try block exits, so cleanup runs after the last element; (2) **make the stream itself closeable** and tie its lifetime to a scope (Java `Stream.onClose` + try-with-resources; Python generators' `GeneratorExit`/`close()`); (3) **push the boundary outward** — let the consumer own the resource and the scope, passing the open resource through; or (4) **bracket** the resource (acquire/use/release as one combinator) so the lazy producer can't outlive its resource. The anti-pattern is returning a lazy stream backed by a resource you've already closed, or whose closing depends on the consumer remembering to drain it.
</details>

**Q32. Why can putting side effects inside `map` / intermediate operations be a design smell in a streaming API?**

<details><summary>Answer</summary>

Because the *number and timing* of those effects become a function of the consumer, which is exactly what laziness makes unpredictable. The same pipeline produces n effects, 3 effects, or 0 effects depending on whether the consumer takes everything, `limit`s, or short-circuits — and reordering or fusing operations can change it further. That couples "what the data is" to "what happens as a side effect," violating the separation that makes streams composable and testable. The discipline: keep intermediate operations *pure* (so they're freely reorderable and re-runnable), and concentrate effects in the explicit terminal stage (`forEach`/the final consumer loop) where the element count is obvious and ordering is defined. This is the same functional-core/imperative-shell idea from [effect tracking](../10-effect-tracking/senior.md).
</details>

**Q33. How would you design a lazy stream that's safe to consume multiple times?**

<details><summary>Answer</summary>

Don't return an *iterator*; return an **iterable factory** — something whose every traversal produces a *fresh* lazy iterator from the original source. In Java that's `Supplier<Stream<T>>` or just re-deriving the stream; in Python, a class with `__iter__` that builds a new generator each call, or a function you call again rather than a generator object you hold. The cost is that re-traversal *re-runs* the computation (and re-performs any effects), so this only works when the source is replayable and the pipeline is pure. If recomputation is too expensive, the alternative is to *memoize* — materialize once into a collection (eager, bounded memory) or use a caching lazy-list structure that fills in elements as they're first demanded and replays them thereafter. The choice is recompute-vs-cache, and you must pick deliberately.
</details>

**Q34. A teammate wants to log progress by adding a `println` inside a `.map()` of a Java Stream. What do you tell them?**

<details><summary>Answer</summary>

That it will fire only when (and as many times as) the stream is actually consumed by a terminal operation — and possibly never if the stream is never terminated, or fewer times than expected if a downstream `limit`/`findFirst` short-circuits. So it's an unreliable progress indicator and a hidden side effect inside a supposedly-pure transformation, which also breaks if the stream is later run in parallel (interleaved, out-of-order output). Better options: use `Stream.peek` *if* it's debugging-only (the Javadoc explicitly scopes `peek` to debugging, and even `peek` can be elided by the JIT when results are unused), or log explicitly in the terminal `forEach`. The deeper point is the lesson of [Q18](#intermediate--middle)/[Q32](#senior--streaming-api-design-backpressure-effects): effects in intermediate ops have consumer-dependent timing.
</details>

---

## Professional / Deep — Thunks, WHNF, Fusion, Runtime Cost

> Thunks, graph reduction, foldl space leak & foldl', generator runtime cost, fusion.

**Q35. What is a thunk?**

<details><summary>Answer</summary>

A thunk is a **suspended computation** — a heap-allocated object holding the code and captured environment needed to produce a value, but not yet run. It's how laziness is implemented: instead of a value, you store "how to compute the value later." When the value is forced, the thunk is evaluated; in a memoizing lazy language the thunk is then *updated in place* (overwritten with the result) so subsequent forces are free. Thunks cost an allocation and an indirection, and their accumulation is the mechanism behind space leaks — a million unevaluated `(+)` thunks is a million heap objects waiting to be forced. The closure you pass to `setTimeout`, a Java `Supplier<T>` you haven't called, and a 0-arg lambda are all everyday thunks.
</details>

**Q36. What is WHNF (Weak Head Normal Form), and why does it matter for forcing? (Haskell aside)**

<details><summary>Answer</summary>

WHNF means evaluated just enough to expose the **outermost constructor** (or lambda) — but not necessarily its contents. `(1+2, 3+4)` in WHNF is `(_, _)` — you know it's a pair, but the components stay thunks. Forcing to WHNF is *shallow*; forcing to *normal form* (fully evaluated) is deep. This matters because the standard forcing primitive (`seq`, strict folds, bang patterns) only forces to WHNF — so forcing `(thunk, thunk)` to WHNF does **not** evaluate the elements, and a space leak hiding inside the components survives. To fully eliminate such leaks you need deep forcing (`deepseq`/`force`). The practical takeaway even outside Haskell: "forced" has degrees; knowing you've forced the *shell* but not the *contents* explains leaks that "strictness" supposedly fixed.
</details>

**Q37. What is graph reduction, the evaluation model behind lazy languages?**

<details><summary>Answer</summary>

A lazy program is represented as a **graph of expressions** (not a tree, because shared subexpressions point to the *same* node). Evaluation proceeds by *reducing* nodes — replacing a redex (reducible expression) with its value — and, crucially, *updating the node in place* so every reference to that shared subexpression sees the computed result. That in-place update is what gives laziness its memoization: `let x = expensive in x + x` reduces `expensive` once because both `x`s point at one node, which is overwritten with the result after the first force. Sharing is why lazy evaluation can be efficient (no recomputation of shared work) and also why retaining a reference to a partially-reduced graph can retain a lot of memory.
</details>

**Q38. What is the runtime cost of generators / lazy iteration versus a plain loop?**

<details><summary>Answer</summary>

Each step of a generator costs more than a tight loop iteration: there's the suspend/resume machinery (saving and restoring the frame/state), an indirect call per `next()`, and in many runtimes an allocation for the iterator/state object. So for a hot, in-memory loop over data that fits comfortably, an eager array loop is typically faster — the generator's per-element overhead dominates when the per-element *work* is trivial. Laziness *wins* when it lets you (a) avoid materializing huge intermediate collections, (b) short-circuit and skip work entirely, or (c) handle data too big for memory. The senior framing: laziness trades constant-factor per-element overhead for asymptotic and memory wins; profile to know which dominates for your workload. Don't reach for generators on a 100-element in-memory list expecting speed.
</details>

**Q39. What is stream/loop fusion, and why does it matter?**

<details><summary>Answer</summary>

Fusion is the optimization that collapses a chain of transformations into a **single pass with no intermediate structures** — `map f . map g` becomes `map (f . g)`, and `map`/`filter`/`fold` chains fuse so the data is traversed once with the operations inlined together. Without fusion, a lazy pipeline still avoids *materializing* intermediates but pays per-element dispatch/allocation through each stage; with fusion the compiler eliminates even that overhead, approaching hand-written-loop speed. GHC does this via rewrite rules (`build`/`foldr` "shortcut fusion", stream fusion); Rust's iterator adapters fuse via monomorphization and inlining; Java Streams partially fuse stateless intermediate ops into one traversal. The point for interviews: fusion is *why* idiomatic functional pipelines can be both expressive *and* fast — the abstraction is compiled away.
</details>

**Q40. How does Java's Stream pipeline actually execute — what happens at `collect`/terminal time?**

<details><summary>Answer</summary>

Intermediate operations (`map`, `filter`, `sorted`, `limit`) are **lazy** — calling them only builds up a pipeline of `Sink`/stage objects; no element moves. The **terminal** operation (`collect`, `forEach`, `reduce`, `findFirst`) triggers execution: it pulls elements from the source `Spliterator` and pushes each one through the chained sinks in a single fused traversal (for stateless ops), short-circuiting if a stage like `limit`/`findFirst` signals completion. Stateful ops (`sorted`, `distinct`) introduce a buffering barrier that must see enough elements before emitting. After the terminal runs, the stream is *consumed* and cannot be reused (`IllegalStateException` on re-use) — the Java analogue of an exhausted generator. So: declaring the pipeline is free; the terminal op does all the work, once.
</details>

**Q41. Is Go lazy? How do you express lazy sequences in Go?**

<details><summary>Answer</summary>

Go is eagerly evaluated and has no built-in lazy collections, but you can build pull-based laziness. The classic idiom is a **channel + goroutine**: the goroutine sends values, the consumer ranges over the channel pulling on demand — though it costs a goroutine and channel sync per stream, and you must close the channel / cancel via `context` to avoid leaking the goroutine. Since Go 1.23, **range-over-func iterators** (`iter.Seq[T]` / `iter.Seq2[K,V]`) give first-class lazy iteration with no goroutine: you write a function `func(yield func(T) bool)` and consumers `range` over it, with `yield` returning `false` to signal early stop (the short-circuit). This makes `slices.Values`, `maps.Keys`, and custom lazy generators ergonomic without channels. The trap with the channel approach is a *leaked goroutine* if the consumer stops early without signaling — the producer blocks forever on a send.
</details>

**Q42. Why might forcing to WHNF *not* fix a space leak, and what does that teach about "adding strictness"?**

<details><summary>Answer</summary>

Because WHNF only evaluates the outermost layer. If your accumulator is a *pair* of running statistics `(sumThunk, countThunk)`, forcing it to WHNF every step confirms "it's a pair" but leaves both components as growing thunk chains — the leak persists inside the tuple. Strictly forcing the *spine* of a structure doesn't force its *contents*. The lesson: "just add a bang / `seq`" is not a reflexive fix; you must force to the right *depth*, which for nested accumulators means strict fields, `deepseq`, or restructuring so the leaking values live where shallow forcing reaches them. Strictness analysis and profiling (heap profiles showing thunk buildup) are how you find the actual leaking node rather than guessing.
</details>

**Q43. What's the memory difference between `Stream.iterate(...).limit(n)` and an equivalent eager loop?**

<details><summary>Answer</summary>

For a simple aggregation the stream is *O(1)* extra memory beyond the loop: elements flow through one at a time and are not retained, so summing the first n of `Stream.iterate` allocates per-element boxing (for `Stream<Integer>`) but no growing collection. The real costs are constant-factor: autoboxing (use `IntStream`/`mapToInt` to avoid it), the per-stage sink dispatch, and the iterator/spliterator object. So memory is comparable to the loop; CPU has a modest overhead. The asymptotic difference appears only if you *collect* the elements (`collect(toList())`), which then matches the eager list's O(n). The interview nuance: a *bounded* lazy stream's win over an eager *list* is "we never built the list," not "the stream is magically smaller while iterating."
</details>

---

## Code-Reading — Lazy or Eager? When Does It Run?

> You're shown a snippet; say whether it's lazy or eager, when it actually runs, or spot the bug.

**Q44. Lazy or eager? When does `expensive()` run?**

```python
xs = [expensive(i) for i in range(3)]   # A
ys = (expensive(i) for i in range(3))   # B
```

<details><summary>Answer</summary>

**A is eager** — the list comprehension calls `expensive(0)`, `expensive(1)`, `expensive(2)` *right now*, before the next line. **B is lazy** — the generator expression runs nothing yet; `expensive(i)` fires only as `ys` is iterated, one call per `next()`. If you never consume `ys`, `expensive` never runs; if you `break` after one element, it runs once. The only syntactic difference is `[]` vs `()`, and it flips the entire evaluation strategy. (Note `range(3)` itself is lazy in both — it doesn't build a list.)
</details>

**Q45. When does anything happen here? (Java)**

```java
Stream<String> s = Files.lines(Path.of("big.txt"))
    .map(String::trim)
    .filter(line -> !line.isEmpty());
System.out.println("built the stream");
```

<details><summary>Answer</summary>

**Nothing has happened to the file's contents yet.** `Files.lines`, `map`, and `filter` are all lazy intermediate operations — they build the pipeline but read no lines. The `println` prints *before* any line is trimmed or filtered. The file *is* opened (so a handle is held), but lines are pulled only when a *terminal* operation runs (`forEach`, `collect`, `count`). Two latent issues: (1) there's no terminal op, so the work never runs and the file handle leaks; (2) `Files.lines` should be in try-with-resources so the handle closes deterministically once consumed. Add `try (var s = Files.lines(...))` and a terminal op.
</details>

**Q46. Spot the bug. (Python)**

```python
def evens(nums):
    return (n for n in nums if n % 2 == 0)

data = [1, 2, 3, 4]
e = evens(data)
if any(x > 2 for x in e):
    result = list(e)        # expecting [4]
```

<details><summary>Answer</summary>

**Consumed-twice generator.** `any(x > 2 for x in e)` advances `e` through `2` and `4` until it finds `4 > 2` is true — so `e` is now *partially* (here, fully) consumed. `list(e)` then iterates the *remaining* items, which is empty, so `result` is `[]`, not `[4]`. The generator's statefulness means the first consumer's progress is invisible to the second. Fix: materialize once (`e = list(evens(data))`) and reuse the list, or re-create the generator before the second use. The bug is silent — no exception, just a wrong empty result.
</details>

**Q47. Lazy or eager — and is there a bug? (Go, channels)**

```go
func gen() <-chan int {
    ch := make(chan int)
    go func() {
        for i := 0; ; i++ { ch <- i }   // infinite
    }()
    return ch
}

func main() {
    ch := gen()
    fmt.Println(<-ch, <-ch)   // 0 1
}                              // returns
```

<details><summary>Answer</summary>

It's **lazy/pull-based** at the consumer (each `<-ch` pulls one value, and the producer blocks on `ch <- i` until pulled), so taking two values forces exactly two iterations. But there's a **goroutine leak**: `main` reads two values and returns, while the producer goroutine is blocked forever trying to send the third value on an unbuffered channel nobody will receive. The goroutine never terminates and its stack is never reclaimed. Fix: pass a `context` or `done` channel the producer selects on, so it can exit when the consumer is finished — or use a Go 1.23 `iter.Seq` iterator, which has no goroutine to leak.
</details>

**Q48. Does this log 5 times or 1000 times? (Java)**

```java
IntStream.rangeClosed(1, 1000)
    .peek(n -> System.out.println("seen " + n))
    .filter(n -> n % 2 == 0)
    .limit(5)
    .forEach(n -> {});
```

<details><summary>Answer</summary>

It logs about **10 times, not 1000** — and certainly not 5. Execution is element-at-a-time and short-circuits at `limit(5)`: each integer is `peek`ed (logged) then `filter`ed; the pipeline stops pulling once `limit` has emitted 5 even numbers. To get 5 evens you must pull 1..10 (5 odds rejected, 5 evens passed), so `peek` fires ~10 times. The exact count is "however many source elements it took to satisfy `limit`," which depends on the filter — the precise reason effects inside intermediate ops are consumer-dependent and unreliable ([Q18](#intermediate--middle), [Q34](#senior--streaming-api-design-backpressure-effects)).
</details>

**Q49. Eager or lazy? What's printed and why? (Python)**

```python
def f(x):
    print("f", x)
    return x * 10

m = map(f, [1, 2, 3])     # Python 3: map() is lazy
print("before")
print(next(m))
```

<details><summary>Answer</summary>

In **Python 3, `map` is lazy** (it returns an iterator, unlike Python 2's eager list). So `m = map(f, ...)` prints nothing; `print("before")` runs first. Then `next(m)` forces *one* element: it prints `f 1`, then `10`. Output is:

```
before
f 1
10
```

`f(2)` and `f(3)` haven't run — they fire only on further `next()` calls. This is a frequent gotcha for those carrying Python 2 habits, where `map` would have eagerly printed `f 1`, `f 2`, `f 3` at construction time. (`filter` and `zip` are also lazy in Python 3.)
</details>

**Q50. What does this print, and what's the subtle laziness trap? (Python closures + generator)**

```python
funcs = (lambda: i for i in range(3))
print([fn() for fn in funcs])
```

<details><summary>Answer</summary>

It prints **`[0, 1, 2]`**, which is the *non-obvious correct* case — and contrasting it with the buggy version is the point. Because the generator is lazy and produces one lambda at a time, by the time each `fn()` is *called* in the list comprehension, the generator has advanced `i` appropriately... actually the safe behavior here comes from each `lambda` capturing the loop variable `i` *by reference*, and the generator interleaving production with consumption. The classic *bug* is the eager list form `funcs = [lambda: i for i in range(3)]; [fn() for fn in funcs]` → **`[2, 2, 2]`**, because all three lambdas close over the *same* `i`, which is `2` after the (eager) comprehension finishes, and they're only called afterward. The lesson: late binding of closures interacts with *when* you force the lambdas; the fix for the eager case is `lambda i=i: i` to bind per-iteration. Laziness changes *when* the closures are invoked relative to when `i` changes.
</details>

---

## Curveballs

> The questions designed to catch glib answers.

**Q51. Is a Java Stream lazy?**

<details><summary>Answer</summary>

Partially — and the precise answer is the point. **Intermediate operations** (`map`, `filter`, `sorted`, `limit`, `peek`) are lazy: calling them builds the pipeline but processes no elements. The **terminal operation** (`collect`, `forEach`, `reduce`, `count`, `findFirst`) is what triggers evaluation, pulling elements through the whole chain in one fused, possibly short-circuiting pass. So "is a Stream lazy?" → *the pipeline is lazily assembled and only runs at the terminal*. Two corollaries interviewers probe: a stream with no terminal op does nothing, and a stream is single-use — after the terminal it throws `IllegalStateException` if reused, just like an exhausted generator.
</details>

**Q52. Why does lazy `foldl` leak space?**

<details><summary>Answer</summary>

Because a lazy left fold doesn't *perform* the combining operation each step — it *builds a thunk* for it. `foldl (+) 0 xs` over a long list constructs `(((0+x1)+x2)+x3)+…` as a deeply nested chain of unevaluated `(+)` thunks, all retained on the heap because nothing forces the running result until the fold ends. That's O(n) memory (and often a stack overflow when finally forced) for what should be O(1). The fix is the strict fold `foldl'`, which forces the accumulator to WHNF at each step so the addition happens immediately and only a single number is ever live. Generalized: a lazy accumulator that's never forced mid-loop is a space leak — force it eagerly.
</details>

**Q53. What's a thunk, in one breath, with an everyday non-Haskell example?**

<details><summary>Answer</summary>

A thunk is a packaged "compute-this-later" — a zero-argument piece of code plus its captured environment, not yet run. Everyday examples: a JavaScript `() => expensive()` you haven't called; a Java `Supplier<T>` sitting unused; the callback in `setTimeout(fn, 0)`; a React reducer's lazy initializer. Forcing the thunk = calling it. Lazy languages allocate thunks pervasively and (when memoizing) overwrite each with its result on first force, which is both the source of their power and the source of space leaks.
</details>

**Q54. Can you iterate a Python generator twice?**

<details><summary>Answer</summary>

No — a generator is a single-use iterator that's exhausted after one pass; a second loop runs zero times and raises no error (it just yields nothing). This is *the* most common laziness bug in Python. If you need multiple passes: `list(gen)` to materialize (gives up O(1) memory), `itertools.tee` to clone (buffers the gap between consumers — dangerous for large/infinite sources), or re-create the generator from its source. The silence is the trap: the second consumer simply sees empty data and you get a wrong result, not an exception.
</details>

**Q55. How do you sum an infinite stream's first N elements?**

<details><summary>Answer</summary>

Insert a bound *between* the infinite source and the reduction so only N elements are ever forced: `sum(islice(naturals(), N))` in Python, `Stream.iterate(...).limit(N).sum()` in Java, a `take(N)` then fold in any lazy library. The reduction terminates because `take`/`islice`/`limit` short-circuits the source after N. The classic mistake is reducing an unbounded source directly (`sum(naturals())`), which never returns — laziness makes the infinite source *constructible and safe to query*, but only a short-circuiting operation makes a *reduction* over it terminate.
</details>

**Q56. "Laziness is always more efficient because it does less work." True?**

<details><summary>Answer</summary>

No. Laziness avoids *unneeded* work and intermediate collections, which is a big win for short-circuited or huge/infinite data — but it adds per-element overhead (thunk allocation, suspend/resume, indirection) and can *cost* memory through space leaks (thunk buildup) or by retaining a stream's head. For small in-memory data with trivial per-element work, an eager loop is often faster and simpler. Laziness is a *trade*: constant-factor and memory overhead in exchange for skipped work and bounded memory on large/infinite inputs. The senior answer is "it depends on whether you skip enough work to pay for the overhead — profile."
</details>

**Q57. If a lazy value is never forced, does its side effect happen?**

<details><summary>Answer</summary>

No — and that's both a feature and a hazard. An effect embedded in an unforced thunk simply never runs, so a "fire-and-forget" log or write you stashed in a lazy value silently doesn't happen if nothing demands it. Conversely, an effect that *will* run does so at *force* time, potentially far from where it was defined and after the enclosing scope/`try` has exited. The takeaway: never rely on laziness to schedule effects, and never assume an effect's timing matches its textual position. Keep effects in eagerly-run terminal stages so their occurrence is deterministic.
</details>

**Q58. Does `map` in Python run eagerly or lazily — and was that always true?**

<details><summary>Answer</summary>

In Python 3, `map` (and `filter`, `zip`) is **lazy** — it returns an iterator that computes on demand. In Python 2, `map` was **eager** and returned a full list. So code ported from Py2 that relied on `map`'s side effects firing immediately, or that iterated the result twice, breaks subtly under Py3 (effects deferred; iterator single-use). It's a favorite curveball precisely because the same call has opposite evaluation semantics across versions. The safe mental model in Py3: `map`/`filter`/`zip`/`range` are lazy; comprehensions with `[]`/`{}` are eager.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q59. Eager vs lazy in one line each?**

<details><summary>Answer</summary>

Eager: compute now, whether or not the result is needed. Lazy: compute only when (and if) the result is demanded.
</details>

**Q60. What forces a lazy value?**

<details><summary>Answer</summary>

Anything that needs its concrete result — pattern-matching, arithmetic, printing, or a stream's terminal/short-circuiting operation.
</details>

**Q61. Generator: container or iterator?**

<details><summary>Answer</summary>

Iterator — stateful and single-use; it *is* its own iterator, which is why you can't loop it twice.
</details>

**Q62. `[x for x in xs]` vs `(x for x in xs)`?**

<details><summary>Answer</summary>

Brackets = eager list (built now); parens = lazy generator (yields on demand).
</details>

**Q63. One-line cure for a lazy `foldl` space leak?**

<details><summary>Answer</summary>

Use the strict fold (`foldl'`) so the accumulator is forced to WHNF every step instead of building thunks.
</details>

**Q64. Where do intermediate-op side effects fire in a Java Stream?**

<details><summary>Answer</summary>

At terminal-operation time, once per *consumed* element — possibly fewer than expected if a downstream op short-circuits, or never with no terminal op.
</details>

**Q65. What makes pull-based streams handle backpressure for free?**

<details><summary>Answer</summary>

The consumer drives — it requests the next element only when ready — so the producer structurally can't outrun it.
</details>

**Q66. WHNF in one sentence?**

<details><summary>Answer</summary>

Evaluated just far enough to reveal the outermost constructor/lambda, leaving the contents as thunks.
</details>

**Q67. When does laziness lose to an eager loop?**

<details><summary>Answer</summary>

On small in-memory data with trivial per-element work, where the thunk/suspend-resume overhead dominates and there's nothing to short-circuit.
</details>

**Q68. The classic stream/loop fusion rewrite?**

<details><summary>Answer</summary>

`map f . map g` → `map (f . g)` — two passes collapsed into one, no intermediate structure.
</details>

**Q69. One-liner: how to make a stream re-iterable?**

<details><summary>Answer</summary>

Return an iterable factory (fresh iterator per traversal) for replayable sources, or materialize once into a list if recomputation is too costly.
</details>

---

## How to Talk About Laziness in Interviews

A few habits separate a strong answer from a textbook recital:

- **Always answer "lazy or eager?" with "lazy *until what forces it*."** The interesting part is never the label — it's *when* (and whether) evaluation happens. Name the forcing event: the terminal op, the `next()`, the pattern match.
- **Name the trade-off, not just the win.** Laziness buys skipped work, intermediate-free pipelines, and infinite sequences — and *costs* per-element overhead, less predictable effect timing, escaping exceptions, and space leaks. "It depends on whether you skip enough work to pay for the overhead" is a senior answer.
- **Separate *describing* from *running*.** The composable, testable design keeps intermediate operations pure and concentrates effects in the terminal stage. Mentioning this unprompted signals you've designed streaming APIs, not just used them.
- **Know the single-use gotcha cold.** Generators/streams are exhausted after one pass; the bug is *silent*. Being able to spot the consumed-twice pattern and reach for materialize / `tee` / re-create instantly is a reliable separator.
- **Tie infinite sources to short-circuiting.** "Laziness makes the infinite source constructible; a `take`/`limit` makes a reduction over it terminate" shows you understand *why* it works, not just the incantation.
- **Go to the machinery when asked to go deep.** Thunks, WHNF, graph reduction with sharing, the `foldl`/`foldl'` space leak, and fusion are the depth markers. Use them to explain *why* space leaks happen and *why* fusion lets functional pipelines hit loop-like speed.
- **Reason about resources.** Lazy + RAII is a real tension: a stream backed by a file handle must have an owner who closes it regardless of how consumption ends. Mentioning try-with-resources / `GeneratorExit` / bracket shows production experience.

---

## Summary

- **Laziness is on-demand computation:** describe now, evaluate only when the result is *forced* — sometimes never. Most mainstream languages are eager by default; laziness shows up as generators, streams, and lazy iterators.
- The junior bar is *eager vs lazy*, generators/iterators (single-use!), and infinite sequences in O(1) space. The middle bar is *lazy pipelines, short-circuiting, memoized lazy values, and bounding infinite sources before reducing*. The senior bar is *streaming API design, backpressure, space leaks, and late effects/exceptions*. The professional bar is the *machinery* — thunks, WHNF, graph reduction, the `foldl`/`foldl'` leak, generator runtime cost, and fusion.
- The recurring traps: a **consumed-twice generator** (silent empty result), **effects inside intermediate ops** (consumer-dependent timing), a **reduction over an unbounded source** (never terminates), a **space leak** from unforced thunks or a retained head, and a **leaked resource/goroutine** from a lazy producer outliving its consumer.
- The strongest answers lead with *when evaluation actually happens*, name the *trade-off* (skipped work vs overhead and unpredictability), separate *describing* from *running*, and reach for the runtime machinery (thunks/WHNF/fusion) to explain *why* — not just *that* — laziness behaves as it does.

---

## Related Topics

- [`junior.md`](junior.md) — eager vs lazy, generators, and infinite sequences from scratch.
- [`middle.md`](middle.md) — lazy pipelines, short-circuiting, and processing unbounded data.
- [`senior.md`](senior.md) — streaming API design, backpressure, space leaks, and late effects.
- [`professional.md`](professional.md) — thunks, WHNF, graph reduction, the `foldl'` fix, and fusion.
- [Map / Filter / Reduce](../04-map-filter-reduce/senior.md) — the core transformations that lazy pipelines fuse.
- [Recursion & Tail Calls](../08-recursion-and-tail-calls/professional.md) — accumulator strictness and the cousin of the `foldl` space leak.
- [Effect Tracking](../10-effect-tracking/senior.md) — pure core / imperative shell, the discipline that keeps effects out of lazy intermediate ops.
- [Pure Functions & Referential Transparency](../02-pure-functions-and-referential-transparency/middle.md) — why pure transformations are safe to defer, reorder, and re-run.
# Map / Filter / Reduce — Interview Q&A

> **Roadmap:** [Functional Programming](../README.md) → Map / Filter / Reduce
>
> *The three operations that replace most hand-written loops: `map` reshapes each element, `filter` keeps a subset, `reduce` collapses a sequence to one value. Together they are the working vocabulary of functional data processing — and `reduce` alone is powerful enough to express the other two.*

A bank of 50+ interview questions spanning what each operation does, the fold variants beneath `reduce`, lazy versus eager pipelines, transducers and fusion, parallel map-reduce, and the allocation/boxing costs that show up in real runtimes (Go slices, Java Streams, Python generators). Each answer models the reasoning of a strong candidate — including the trade-offs. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Intermediate / Middle](#intermediate--middle)
3. [Senior — Laziness, Transducers, Parallelism](#senior--laziness-transducers-parallelism)
4. [Professional / Deep — Allocations, Fusion, Boxing](#professional--deep--allocations-fusion-boxing)
5. [Code-Reading — What Does This Pipeline Produce?](#code-reading--what-does-this-pipeline-produce)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. How to Talk About Map/Filter/Reduce in Interviews
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> What each operation does, and how it maps onto a plain loop.

**Q1. Define `map`, `filter`, and `reduce` in one sentence each.**

<details><summary>Answer</summary>

- **`map(f, xs)`** — apply `f` to every element, producing a new collection of the **same length** where element `i` is `f(xs[i])`. It transforms shape/value, never the count.
- **`filter(p, xs)`** — keep only the elements for which predicate `p` returns true, producing a collection of **length ≤ original**, same element type, order preserved.
- **`reduce(f, init, xs)`** — collapse the whole collection into a **single accumulated value** by repeatedly combining the running accumulator with each element: `f(f(f(init, x0), x1), x2)...`.

`map` is 1-to-1, `filter` is many-to-fewer, `reduce` is many-to-one.
</details>

**Q2. Write the imperative loop each one replaces.**

<details><summary>Answer</summary>

```python
# map
out = []
for x in xs:
    out.append(f(x))

# filter
out = []
for x in xs:
    if p(x):
        out.append(x)

# reduce
acc = init
for x in xs:
    acc = f(acc, x)
```

Each higher-order function names the *intent* (transform / select / accumulate) and hides the mechanics (allocate, iterate, append). The loop is the same machine work; the named operation removes the boilerplate and the chance to get the loop wrong.
</details>

**Q3. Does `map` change the length of the collection? Does `filter`? Does `reduce`?**

<details><summary>Answer</summary>

`map` preserves length exactly — one output per input. `filter` produces length between 0 and the original, never more. `reduce` produces a *single value* (a scalar/object, not a collection at all). Remembering these length invariants is the fastest way to pick the right tool and to sanity-check a pipeline: if you need fewer elements you want `filter`, if you need a different count entirely you want `reduce`, if you reshape in place you want `map`.
</details>

**Q4. Why prefer these over a `for` loop at all?**

<details><summary>Answer</summary>

They raise the **level of intent**: `map(price, orders)` says "transform each," `filter(isPaid, orders)` says "select these," with no index arithmetic, no off-by-one, no accidental mutation of the source. The shape of the operation is visible from the name, so the reader doesn't have to *infer* it from loop body details. They also compose into readable pipelines and are trivially testable (pass a pure function in). The trade-off — covered later — is that naive chaining can allocate intermediate collections a single loop wouldn't.
</details>

**Q5. Is `map` supposed to mutate the original collection?**

<details><summary>Answer</summary>

No. `map` in the functional sense returns a **new** collection and leaves the input untouched; the transforming function should be pure (no side effects). Mutating in place, or relying on side effects inside the mapper, defeats the purpose and surprises readers — JavaScript's `Array.prototype.map` returning a new array is the canonical contract. (Note the name collision in libraries: Python's `list.sort()` mutates while `sorted()` returns new; always check whether a given language's method returns new or mutates.) See [Immutability](../03-immutability/interview.md).
</details>

**Q6. What is the "initial value" (seed/accumulator) in `reduce`, and why does it matter?**

<details><summary>Answer</summary>

It's the starting accumulator before any element is seen — `reduce(f, init, xs)`. It matters for two reasons. **Correctness on empty input:** with a seed, `reduce(+, 0, [])` returns `0`; without a seed, reducing an empty list has no answer and most languages throw (Python `reduce` raises `TypeError`, JS `[].reduce(f)` throws). **Type:** the seed sets the accumulator's type, which can differ from the element type — e.g. reducing a list of words into a `dict` of counts seeds with `{}`. Always supply an explicit seed unless you can guarantee a non-empty input *and* the accumulator type equals the element type.
</details>

**Q7. Show `sum`, `max`, and `count` written as `reduce`.**

<details><summary>Answer</summary>

```python
total = reduce(lambda acc, x: acc + x, xs, 0)
mx    = reduce(lambda acc, x: x if x > acc else acc, xs, float("-inf"))
cnt   = reduce(lambda acc, _: acc + 1, xs, 0)
```

These illustrate the pattern: the seed is the identity for the operation (`0` for sum, `-∞` for max, `0` for count), and the combining function folds one element into the accumulator. In practice you'd use `sum`/`max`/`len`, but seeing them as reductions reveals that all three are the *same* shape.
</details>

**Q8. What's the difference between `reduce` and `map` followed by `reduce`?**

<details><summary>Answer</summary>

`map` then `reduce` is the canonical two-phase pattern: transform each element, then collapse. `total = reduce(+, 0, map(price, orders))` first turns orders into prices, then sums. You *can* fuse it into one reduce — `reduce(lambda acc, o: acc + price(o), 0, orders)` — avoiding the intermediate collection. The two-phase version is more readable and composable; the fused version saves an allocation. Which to prefer depends on whether the intermediate list is large and whether clarity or throughput dominates (see fusion, Q31).
</details>

**Q9. Order: does `filter` before `map` differ from `map` before `filter`?**

<details><summary>Answer</summary>

It can differ in both **result** and **cost**. Result: `filter` then `map` applies the predicate to *originals*; `map` then `filter` applies it to *transformed* values — different predicates see different data, so swapping them changes meaning unless the predicate is invariant under the map. Cost: filtering first means `map` runs over fewer elements (cheaper if `map` is expensive); mapping first wastes work on elements you'll discard. General rule: **filter early** to shrink the stream before expensive transforms, as long as the predicate's meaning is preserved.
</details>

**Q10. Is `filter` the same as a `WHERE` clause in SQL?**

<details><summary>Answer</summary>

Conceptually yes — both keep rows/elements satisfying a predicate. The instructive difference is *evaluation*: SQL is **declarative**, so the query planner is free to push the predicate down to an index, reorder it, or run it before/after joins. A naive in-memory `filter` runs exactly where you wrote it, over whatever it's given. This is why lazy streams and transducers (later questions) try to recover some of that planner-like freedom — pushing filters earlier, fusing stages — that SQL engines have always had.
</details>

---

## Intermediate / Middle

> Folds, `flatMap`, when `reduce` is the wrong tool, associativity and identity.

**Q11. What is a "fold," and how do `foldLeft` and `foldRight` differ?**

<details><summary>Answer</summary>

A fold *is* `reduce` with an explicit seed — "fold the list into a value." The variants differ in **association direction**:

- `foldLeft(f, z, [a,b,c])` = `f(f(f(z, a), b), c)` — accumulates from the left, processing `a` first.
- `foldRight(f, z, [a,b,c])` = `f(a, f(b, f(c, z)))` — associates from the right, combining `c` with the seed first.

For an associative operation with an identity (like `+`) both give the same result. They diverge for non-associative or order-sensitive operations, for laziness, and for stack behavior — the next two questions.
</details>

**Q12. When does `foldLeft` vs `foldRight` actually matter?**

<details><summary>Answer</summary>

Three situations. **(1) Non-associative combiners:** subtraction, division, list cons, or building a tree — `foldLeft` and `foldRight` produce *different* results (`foldRight(cons, [], xs)` rebuilds the list in order; `foldLeft(cons, [], xs)` reverses it). **(2) Laziness:** in a lazy language `foldRight` can short-circuit and even work on infinite lists because its combiner can ignore the not-yet-forced tail; `foldLeft` must consume the whole list first. **(3) Stack:** a strict `foldRight` recurses to the end before combining, so it risks stack overflow on long lists; `foldLeft` is naturally a tail-recursive loop. Rule of thumb: in strict languages prefer `foldLeft` for safety; in lazy ones `foldRight` is often the right default.
</details>

**Q13. What is `flatMap` (a.k.a. `mapcat`, `bind`, `>>=`), and when do you need it?**

<details><summary>Answer</summary>

`flatMap(f, xs)` applies `f` to each element where `f` returns a *collection*, then concatenates the results into one flat collection — it's `map` followed by one level of `flatten`. You need it whenever the per-element transform produces zero-or-more outputs rather than exactly one: splitting each sentence into words, expanding each order into its line items, or pairing each element with several others. `map` alone would give you a collection-of-collections; `flatMap` flattens by one level. It's also the core operation behind monads (`Option`, `Result`, `Promise` all have a `flatMap`/`bind`) — see [Monads — Plain English](../09-monads-plain-english/interview.md).
</details>

**Q14. Give a case where using `reduce` is the *wrong* tool even though it works.**

<details><summary>Answer</summary>

When the reduction is really a `map` or `filter` in disguise. `reduce(lambda acc, x: acc + [f(x)], [], xs)` *works* as a map but is O(n²) (each `acc + [..]` copies the whole accumulator) and obscures intent — just write `map`. Likewise building a filtered list via reduce. The anti-pattern is "everything is a reduce": a reduce whose accumulator is the same collection type, growing by one element each step, is almost always a `map`/`filter`/`flatMap` you've hand-rolled less efficiently and less readably. Reach for `reduce` when you genuinely collapse to a *different* shape (a number, a dict, a single object).
</details>

**Q15. The combining function for `reduce` — what properties should it have for the result to be well-defined?**

<details><summary>Answer</summary>

For a *sequential* `foldLeft`, any function works — the result is whatever left-to-right accumulation yields. But for the result to be **order-independent** (so you can parallelize, reorder, or chunk), the combiner must be **associative** (`f(f(a,b),c) == f(a,f(b,c))`), and a clean parallel reduce also wants an **identity** element (`f(z,a) == a`) so empty chunks contribute nothing. Operations forming a *monoid* (associative + identity) — sum/0, product/1, max/-∞, string concat/"", set union/∅ — are exactly the ones that parallelize and chunk cleanly. Non-associative reductions are correct only in strict left-to-right order.
</details>

**Q16. Why does `reduce` on an empty collection need special handling?**

<details><summary>Answer</summary>

Because "the accumulation of nothing" only has a defined answer if you supply the identity/seed. With a seed, empty input returns the seed (`reduce(+, 0, []) == 0`). Without one, there's no element to start from, so the operation is undefined — Python's `functools.reduce` raises `TypeError: reduce() of empty iterable with no initial value`, JavaScript's `[].reduce(f)` throws `TypeError`, and Java's `Stream.reduce` with an accumulator-only signature returns an `Optional` (empty for empty input) to make the absence explicit. The lesson: always pass a seed, or handle the empty/`Optional` case deliberately.
</details>

**Q17. Build a frequency map (histogram) with `reduce`. What's the seed and combiner?**

<details><summary>Answer</summary>

```python
from functools import reduce
def add(counts, word):
    counts[word] = counts.get(word, 0) + 1
    return counts
freq = reduce(add, words, {})
```

The **seed** is an empty dict (`{}`), and the accumulator type (`dict`) differs from the element type (`str`) — the hallmark of a "real" reduce. The combiner mutates and returns the accumulator. Note this is *not* associative-friendly as written (it mutates a shared dict), so it's fine sequentially but needs care to parallelize: each thread needs its own map, then a merge step. This is exactly the shape of word-count map-reduce.
</details>

**Q18. What's the relationship between `reduce` and `scan` (a.k.a. `accumulate` / running fold)?**

<details><summary>Answer</summary>

`reduce` returns only the *final* accumulator; `scan` returns *every intermediate* accumulator — the list of partial results. `scan(+, 0, [1,2,3])` → `[1, 3, 6]` (running sums / prefix sums), whereas `reduce(+, 0, [1,2,3])` → `6`. Use `scan` when you need the history of the accumulation — running totals, prefix sums, cumulative maxima, parsing state at each step. Python spells it `itertools.accumulate`; many FP libs call it `scanl`/`scanLeft`. It's a reduce that doesn't throw away the intermediates.
</details>

**Q19. How do comprehensions relate to map/filter?**

<details><summary>Answer</summary>

A comprehension is syntactic sugar that fuses `map` and `filter` into one readable expression. `[f(x) for x in xs if p(x)]` is exactly `map(f, filter(p, xs))`, and Python evaluates it in a single pass without building the intermediate filtered list — so the comprehension is often *both* clearer and more efficient than chaining `map`/`filter` calls. The nested form `[g(x, y) for x in xs for y in ys]` corresponds to `flatMap`. Comprehensions are the idiomatic Python answer; explicit `map`/`filter` shine when you already have named functions to pass.
</details>

**Q20. Can `filter` and `map` be expressed in terms of `flatMap`?**

<details><summary>Answer</summary>

Yes — `filter(p, xs)` = `flatMap(lambda x: [x] if p(x) else [], xs)` (each element maps to a one-element list to keep, or an empty list to drop), and `map(f, xs)` = `flatMap(lambda x: [f(x)], xs)`. `flatMap`'s flattening concatenates the per-element collections, reproducing both. This shows `flatMap` is strictly more general than `filter` and `map` — keep-or-drop and one-to-one transform are both special cases of one-to-many. It's the same reason `flatMap`/`bind` is the fundamental monadic operation.
</details>

---

## Senior — Laziness, Transducers, Parallelism

> Lazy vs eager pipelines, transducers, parallel map-reduce, reduce as the universal operation.

**Q21. Lazy vs eager evaluation of a pipeline — what's the difference and why does it matter?**

<details><summary>Answer</summary>

**Eager** pipelines compute each stage fully before the next: `filter` builds a whole intermediate list, then `map` builds another. **Lazy** pipelines pull elements one at a time through all stages on demand — nothing is computed until a terminal operation requests it, and only as much as needed. Laziness matters because it (1) avoids materializing intermediate collections, (2) enables **short-circuiting** (`findFirst`, `take(5)` stop early without processing the rest), and (3) allows **infinite sequences**. The cost is per-element overhead and harder reasoning about *when* side effects fire. Python generators, Java Streams (intermediate ops), and Rust iterators are lazy; a plain list `map`/`filter` chain is eager. See [Laziness & Streams](../12-laziness-and-streams/interview.md).
</details>

**Q22. Is a Java `Stream` lazy? Be precise.**

<details><summary>Answer</summary>

Partially: **intermediate operations** (`map`, `filter`, `peek`) are lazy — they're recorded but do nothing until a **terminal operation** (`collect`, `reduce`, `forEach`, `count`, `findFirst`) runs. When the terminal op runs, elements are pulled through the whole pipeline one at a time, which is why `stream.filter(...).findFirst()` can stop after the first match without filtering the rest. The caveat: `sorted` and `distinct` are *stateful* intermediate ops that must buffer/consume the whole stream, defeating short-circuiting before them. So "lazy" is true for the stateless intermediates and the pull model, but stateful ops and the terminal op are where work actually happens.
</details>

**Q23. What is a transducer, and what problem does it solve?**

<details><summary>Answer</summary>

A transducer is a **composable transformation decoupled from the source and the output**. Normally `map`/`filter` are written against a specific collection type and each chained call builds an intermediate collection. A transducer expresses "map then filter then take" as a single function that transforms a *reducing function* into another reducing function — so the whole pipeline runs in **one pass with no intermediate collections**, and the *same* pipeline can be applied to a list, a stream, a channel, or an async source. Clojure popularized them. The win is **fusion + reuse**: you compose the transformation once, pay for one traversal, and stay agnostic about where the data comes from or goes.
</details>

**Q24. Sketch how a transducer fuses `map` and `filter` into one pass.**

<details><summary>Answer</summary>

A transducer wraps a reducing function `rf` (step `(acc, x) -> acc`). `mapping(f)` returns `rf -> (acc, x) -> rf(acc, f(x))`; `filtering(p)` returns `rf -> (acc, x) -> p(x) ? rf(acc, x) : acc`. Composing them, `filtering(p)(mapping(f)(rf))`, yields a single reducing function that, for each `x`, checks `p` then applies `f` then steps `rf` — all inline, **no intermediate list between filter and map**. You then `reduce` the source with this fused function. Conceptually it's the same fusion a smart stream library or compiler does, but expressed as ordinary composable values you can build and reuse.
</details>

**Q25. How does map-reduce parallelize, and what must hold for it to be correct?**

<details><summary>Answer</summary>

Split the data into chunks, **map** each element independently (map is embarrassingly parallel — no shared state), reduce each chunk locally, then **combine** the per-chunk results. For the combine to give the same answer regardless of how you chunked, the reduce operation must be **associative** (so `(a⊕b)⊕c == a⊕(b⊕c)` — grouping doesn't matter) and ideally have an **identity** (so empty chunks are harmless). If the combiner is also **commutative**, order across chunks doesn't matter either, which helps when results arrive out of order. Sum, count, max, set-union, and "merge histograms" all qualify; subtraction and "first element" do not.
</details>

**Q26. "`reduce` is the universal operation." Defend that claim.**

<details><summary>Answer</summary>

Because `map`, `filter`, and `flatMap` are all expressible as a single `reduce`: `map(f) = reduce(\acc x -> acc ++ [f x]) []`, `filter(p) = reduce(\acc x -> p x ? acc ++ [x] : acc) []`, `flatMap(f) = reduce(\acc x -> acc ++ f x) []`. Fold is the *catamorphism* for lists — the canonical way to tear a list down to any value — so anything you can compute by consuming a list left-to-right is a fold. The practical caveat: just because you *can* express everything as `reduce` doesn't mean you *should* — the naive `acc ++ [..]` versions are O(n²) and unreadable. The claim is about expressive power, not the recommended style.
</details>

**Q27. Why can a chained `map(...).filter(...).map(...)` be *slower* than a single hand-written loop?**

<details><summary>Answer</summary>

Because each *eager* stage allocates and traverses an intermediate collection: `map` builds list A (n elements), `filter` traverses A to build list B, the second `map` traverses B to build list C — three allocations and three passes, plus GC pressure, where a single loop does one pass and one allocation. The hand loop also keeps data hot in cache and lets the optimizer fuse the work. Lazy pipelines (Streams, iterators) and transducers close most of this gap by pulling one element through all stages, but a naive eager chain over large data pays a real, measurable tax. This is the central performance caveat of the trio.
</details>

**Q28. When would you deliberately choose laziness, and when is it a liability?**

<details><summary>Answer</summary>

Choose lazy when the source is large or infinite, when you'll short-circuit (`take`, `find`, `any`), or when chaining many transforms whose intermediates you don't want to materialize — laziness turns "build three big lists" into "one streaming pass." It's a liability when: the per-element overhead of the lazy machinery exceeds the cost of a tight eager loop on small data; **side effects** in the pipeline make *when* they run hard to reason about (a `map` with logging won't fire until forced); you accidentally **re-traverse** a lazy source twice (it may be consumed or recomputed); or laziness retains references to a large head, causing a space leak. Laziness trades predictable eager cost for on-demand evaluation — usually a win at scale, a needless complication for a 10-element list.
</details>

**Q29. Is a parallel reduce always faster than a sequential one?**

<details><summary>Answer</summary>

No. Parallelism has fixed costs — splitting the source, scheduling tasks, thread coordination, and merging partial results — that only pay off when there's enough work to amortize them. For small collections, cheap per-element functions, or non-splittable sources (a `LinkedList`, an I/O-bound iterator), a parallel reduce is often *slower* than sequential because overhead dominates. It also requires an associative combiner (Q25). Java's `parallelStream()` is the classic trap: it's a one-word change that can degrade performance or, worse, give wrong results if the reduce isn't associative or the lambdas touch shared state. Measure; don't assume.
</details>

**Q30. What's the difference between `reduce` and `collect` (mutable reduction) in Java Streams, and why does the distinction exist?**

<details><summary>Answer</summary>

`reduce` is a **functional** reduction: the combiner takes two values and returns a *new* value, ideal for immutable accumulators (sum, max). `collect` is a **mutable** reduction: it uses a *supplier* (new container), an *accumulator* (fold element into container), and a *combiner* (merge two containers) — designed for building `List`/`Map`/`StringBuilder` where creating a fresh container per element (as functional `reduce` would) is O(n²) and wasteful. The distinction exists precisely to make parallel-safe mutable accumulation correct: each thread gets its own container via the supplier, and the combiner merges them. Use `reduce` for immutable folds, `collect` for building mutable containers.
</details>

---

## Professional / Deep — Allocations, Fusion, Boxing

> Intermediate allocations, stream fusion, boxing, parallel-stream overhead, and runtime internals.

**Q31. What is "stream/loop fusion" and which environments do it for you?**

<details><summary>Answer</summary>

Fusion is the elimination of intermediate collections by merging adjacent stages into a single pass — `map(f).map(g)` becomes effectively `map(g∘f)`, and `filter.map` interleaves rather than materializing between them. **Lazy iterator models fuse structurally**: Rust iterators and Java Streams pull one element through the whole chain, so no intermediate `Vec`/list exists, and Rust's monomorphized, inlined iterator adapters often compile to code identical to a hand loop ("zero-cost abstraction"). **Haskell** relies on GHC's list-fusion rewrite rules. **Python** generators fuse by being lazy. What does *not* fuse: eager list `map`/`filter` in Python or JavaScript arrays — each call returns a full new array. So fusion is automatic in lazy/monomorphized pipelines and absent in eager-collection chaining.
</details>

**Q32. Count the intermediate allocations in `nums.stream().filter(...).map(...).collect(toList())` vs the equivalent Go `for` loop.**

<details><summary>Answer</summary>

The Java Stream allocates: the pipeline wrapper objects (a few small objects per stage), the lambdas (often cached singletons), boxing for an `int` source unless you use `IntStream`, and the final `List` from `collect`. Crucially it does **not** allocate an intermediate list between `filter` and `map` — the stream is lazy/fused, so it's one pass with one output list (plus per-element boxing if not primitive-specialized). A Go loop appending to a `[]T` allocates only the result slice (possibly re-growing a few times; preallocate with `make([]T, 0, len(nums))` to avoid that) and zero boxing for value types. So Stream overhead is mostly the pipeline scaffolding and boxing, not intermediate collections; the Go loop's only allocation is the result. For hot loops on primitives, the loop or `IntStream` wins.
</details>

**Q33. What is boxing, and how does it bite map/filter/reduce on primitives in Java?**

<details><summary>Answer</summary>

Boxing wraps a primitive (`int`) in an object (`Integer`) on the heap. A generic `Stream<Integer>` boxes every element, so `Stream<Integer>.reduce(0, Integer::sum)` allocates an `Integer` per step and chases pointers, hammering the allocator and cache. The fix is the **primitive-specialized streams** — `IntStream`/`LongStream`/`DoubleStream` — which carry raw primitives end to end: `IntStream.of(...).filter(...).map(...).sum()` does **zero boxing**. The lesson: when the element type is a primitive and the pipeline is hot, reach for the specialized stream (or a plain loop). Boxing is invisible in the source but dominant in a profiler. Python (everything-is-an-object) and Go (`interface{}` boxing) have analogous costs.
</details>

**Q34. Why is `parallelStream()` so often a net loss in practice?**

<details><summary>Answer</summary>

Several reasons compound. It runs on the **shared common ForkJoinPool**, so one greedy parallel stream can starve others (and blocking I/O inside it is poison). The **split cost** is high for non-`ArrayList` sources (`LinkedList`, I/O-backed) that can't be cheaply halved. The **merge step** for `collect` into a non-concurrent container costs real work. Small N or cheap per-element functions never recoup the scheduling overhead. And it's a **correctness footgun**: a non-associative reducer or a lambda touching shared mutable state silently produces wrong results in parallel. Net: it's a one-word change with large hidden costs; justified only for big, splittable, CPU-bound, associative, side-effect-free workloads — and then only after measuring.
</details>

**Q35. Explain the cost model of a Python generator pipeline vs a list-comprehension chain.**

<details><summary>Answer</summary>

A generator pipeline (`(f(x) for x in xs if p(x))`, or chained `map`/`filter` which return lazy iterators in Py3) is **lazy and memory-flat**: it holds one element at a time, materializes nothing intermediate, and short-circuits — ideal for large/infinite data. Its cost is **per-element overhead**: each `next()` is a Python-level frame resumption, so for fully-consumed small data a generator can be *slower* than a single list comprehension that the interpreter runs in a tight C loop. A *chain* of separate list calls (`list(map(...))` then `list(filter(...))`) is the worst of both: eager, allocating each intermediate list. Rule: one fused comprehension for small eager work; generators for large/streaming/short-circuiting work; avoid eager multi-stage chains.
</details>

**Q36. How does element order interact with parallel reduce and `forEach` vs `forEachOrdered`?**

<details><summary>Answer</summary>

A parallel pipeline processes chunks concurrently, so the *encounter order* of side effects is not preserved by default. `forEach` on a parallel stream may emit in any order; `forEachOrdered` forces the original order at a synchronization cost (often serializing the tail). For `reduce`, if the combiner is associative the **result** is order-independent and correct, but if you rely on left-to-right *sequencing* (a non-commutative accumulation like string concatenation where order of pieces matters), you must keep the stream **ordered** so chunks recombine in encounter order — which Java guarantees for ordered sources even in parallel, at some cost. So: associativity protects the value; ordered-ness protects the sequence; commutativity lets you drop the ordering cost.
</details>

**Q37. What is a "space leak" from laziness, and how does it appear in a fold?**

<details><summary>Answer</summary>

A space leak is unexpected memory growth caused by deferred computation piling up. The classic case is a **lazy `foldLeft`** (Haskell's `foldl`): each step builds an unevaluated thunk `(((0 + a) + b) + c)...` instead of summing immediately, so the whole chain of thunks accumulates in memory and may blow the heap/stack when finally forced. The cure is a **strict** fold (`foldl'`) that forces the accumulator each step, keeping memory constant. The general principle: laziness defers work, and deferred work *is* retained state; in accumulation you usually want the accumulator strict so the fold runs in constant space. (Strict languages like Java/Go don't have this in `reduce`, but lazily retaining the source head causes the analogous leak.)
</details>

**Q38. In Rust, why are iterator adapters described as "zero-cost," and where does that break down?**

<details><summary>Answer</summary>

Rust iterators are lazy and **monomorphized** — `v.iter().filter(p).map(f).sum()` generates concrete, fully-inlined code with no trait-object dispatch and no intermediate `Vec`, so LLVM typically optimizes the chain into the same machine code as a hand-written loop: zero abstraction overhead. It breaks down when you **erase types** with `dyn` (`Box<dyn Iterator>`) — now each `next()` is a virtual call that can't inline — or when an adapter forces materialization (`.collect()` mid-chain), or when bounds checks aren't elided. So "zero-cost" holds for statically-dispatched, fully-inlined chains and degrades the moment you introduce dynamic dispatch or premature collection.
</details>

**Q39. How do you decide between a fused single `reduce` and a readable multi-stage pipeline in production code?**

<details><summary>Answer</summary>

Default to the **readable multi-stage** form — `map`/`filter`/`reduce` named stages — because clarity is the common case and lazy runtimes (Streams, iterators, generators) already fuse it for you with no intermediate collections. Reach for a hand-fused single `reduce` (or transducer) only when a profiler shows the pipeline is hot *and* the environment is eager (so intermediates are real), or when you're processing very large data where even per-stage overhead matters. The order of operations: write it clearly, measure, fuse only the proven hot path — and when you do fuse, leave a comment explaining the readability sacrifice. Premature fusion is obfuscation with no payoff on lazy runtimes.
</details>

**Q40. What's the interaction between `filter` selectivity and pipeline cost?**

<details><summary>Answer</summary>

Placing a highly **selective** filter (drops most elements) *early* slashes the work all downstream stages do — a cheap predicate that removes 90% of elements before an expensive `map` is a large win, and in lazy/SQL-like systems this "predicate pushdown" is automatic. But selectivity has limits: if the filter itself is expensive and rarely fires, or if it sits behind a stateful op (`sorted`) that already buffered everything, the gain shrinks. On parallel streams, an early filter also reduces the per-chunk payload, improving balance. The heuristic — **filter early, cheap predicate first** — mirrors query optimization: do the work that eliminates the most future work as soon as possible.
</details>

---

## Code-Reading — What Does This Pipeline Produce?

> Trace the output or spot the bug. Languages: Go, Java, Python (Haskell aside).

**Q41. (Python) What does this print, and is there a bug?**

```python
from functools import reduce
nums = [1, 2, 3, 4]
out = reduce(lambda acc, x: acc + [x * 2] if x % 2 == 0 else acc, nums, [])
print(out)
```

<details><summary>Answer</summary>

Prints `[4, 8]`. The reduce keeps even numbers and doubles them — `2→4`, `4→8`; odds leave the accumulator unchanged. **It's correct but a code smell:** this is `filter` + `map` hand-rolled as a reduce, and `acc + [..]` copies the growing list each step → O(n²). Idiomatic and O(n): `[x * 2 for x in nums if x % 2 == 0]` or `list(map(lambda x: x*2, filter(lambda x: x%2==0, nums)))`. The "bug" an interviewer wants you to name is the misuse of `reduce` where `map`/`filter` belong.
</details>

**Q42. (Java) What's the result and the hidden correctness problem?**

```java
List<Integer> nums = List.of(5, 3, 9, 1);
int max = nums.stream().reduce(0, (a, b) -> a > b ? a : b);
```

<details><summary>Answer</summary>

`max` is `9` — correct *for these inputs*. **The bug is the seed `0`**: it's the identity for max only if all elements are ≥ 0. For `List.of(-5, -3)` this returns `0`, not `-3`, because `0` beats every negative. The correct identity for max is `Integer.MIN_VALUE`, or better use `nums.stream().max(Integer::compareTo)`, which returns an `Optional<Integer>` and sidesteps the seed entirely (empty for empty input). Aside: `Stream<Integer>` boxes; `nums.stream().mapToInt(Integer::intValue).max()` avoids it. The interview point: a wrong identity in `reduce` is a silent correctness bug.
</details>

**Q43. (Go) What does this produce, and what's the idiom point?**

```go
nums := []int{1, 2, 3, 4, 5}
doubled := make([]int, 0, len(nums))
sum := 0
for _, n := range nums {
    if n%2 == 1 {
        continue
    }
    doubled = append(doubled, n*2)
    sum += n * 2
}
fmt.Println(doubled, sum)
```

<details><summary>Answer</summary>

Prints `[4 8] 12`. It filters evens (`2, 4`), doubles them into `doubled`, and sums them. The idiom point: Go has no generic `map`/`filter`/`reduce` in the stdlib pre-generics, and even with generics (`slices` package helpers) the community largely **prefers the explicit loop** — it fuses filter+map+reduce into one pass with one allocation (`make(..., 0, len)` preallocates), no intermediate slices, and no closure overhead. This is the eager-loop-beats-naive-chaining lesson made concrete: in Go the loop *is* the fused pipeline.
</details>

**Q44. (Python) Spot the bug in this lazy pipeline.**

```python
evens = filter(lambda x: x % 2 == 0, range(10))
print(sum(evens))   # 20
print(list(evens))  # ?
```

<details><summary>Answer</summary>

The second line prints `[]`, not `[0, 2, 4, 6, 8]`. In Python 3, `filter` returns a **lazy iterator**, and `sum(evens)` has already **consumed it to exhaustion**. A second pass over the same iterator yields nothing. The bug is treating a one-shot iterator as if it were a re-iterable collection. Fixes: materialize once (`evens = list(filter(...))`) if you need multiple passes, or rebuild the iterator. This is the classic "lazy source consumed twice" trap from Q28.
</details>

**Q45. (Java) Why does this throw, and what's the fix?**

```java
Stream<Integer> s = List.of(1, 2, 3).stream();
long c = s.filter(x -> x > 1).count();
List<Integer> rest = s.collect(Collectors.toList());  // boom
```

<details><summary>Answer</summary>

The third line throws `IllegalStateException: stream has already been operated upon or closed`. A Java `Stream` is **single-use**: once a terminal operation (`count()`) runs, the stream is consumed and cannot be reused. The fix is to create a fresh stream from the source for the second pipeline (`List.of(...).stream().collect(...)`), or to derive both results from one traversal (e.g. partition with `Collectors.partitioningBy`). Same lesson as Q44 in a different runtime: lazy pipelines are typically one-shot.
</details>

**Q46. (Python) Predict the output and explain the surprise.**

```python
from functools import reduce
print(reduce(lambda a, b: a - b, [10, 1, 2, 3]))
```

<details><summary>Answer</summary>

Prints `4`. `reduce` is a **left fold**: `((10 - 1) - 2) - 3 = 9 - 2 - 3 = 4`. The surprise candidates trip on is assuming right-association (`10 - (1 - (2 - 3))) = 10 - (1 - (-1)) = 10 - 2 = 8`) or that order doesn't matter. Subtraction is **non-associative**, so `foldLeft` and `foldRight` give different answers (4 vs 8) — exactly the case from Q12. With no seed and a non-empty list, `reduce` uses the first element as the seed. This is why associativity is the property that lets you parallelize: subtraction can't be safely chunked.
</details>

**Q47. (Haskell aside) Why does this work on an infinite list?**

```haskell
take 3 (map (*2) [1..])   -- [2,4,6]
```

<details><summary>Answer</summary>

Because Haskell is **lazy by default**: `[1..]` is an infinite list, but `map (*2)` doesn't eagerly produce all elements — it produces each doubled value only when demanded. `take 3` demands exactly three, so only `1, 2, 3` are ever generated and doubled, then evaluation stops. The same code in a strict language with eager `map` would loop forever trying to build the whole mapped list before `take` ever runs. This is the purest demonstration of why laziness enables infinite sequences and short-circuiting (Q21).
</details>

---

## Curveballs

> The questions designed to catch glib answers.

**Q48. Can you implement `map` and `filter` using `reduce`? Show it.**

<details><summary>Answer</summary>

Yes — `reduce` is universal (Q26). Conceptually:

```python
def my_map(f, xs):    return reduce(lambda acc, x: acc + [f(x)], xs, [])
def my_filter(p, xs): return reduce(lambda acc, x: acc + [x] if p(x) else acc, xs, [])
```

Both fold the source into a list, the mapper transforming each element and the filter conditionally appending. **The honest caveat:** `acc + [x]` copies the accumulator each step → O(n²); a real implementation appends in place (or uses a transducer). So this proves *expressiveness*, not that you should write `map` this way. The senior move is to show the implementation *and* immediately name why it's not how you'd ship it.
</details>

**Q49. `foldLeft` vs `foldRight` — when does the choice actually change the answer or break?**

<details><summary>Answer</summary>

Three triggers (Q12 condensed): **(1) Non-associative op** — subtraction `((10-1)-2)` ≠ `(10-(1-2))`, or list cons where `foldRight` preserves order and `foldLeft` reverses. **(2) Laziness/infinite input** — `foldRight` with a non-strict combiner can short-circuit and run on infinite lists; `foldLeft` must walk the whole thing first. **(3) Stack safety in strict languages** — strict `foldRight` recurses to the end and can overflow; `foldLeft` is a loop. Default to `foldLeft` in strict languages, `foldRight` in lazy ones, and switch deliberately when the operation's associativity or the need to short-circuit demands it.
</details>

**Q50. Is a Java `Stream` lazy? (Yes/no with the precise nuance.)**

<details><summary>Answer</summary>

Yes for intermediate ops, no for the terminal op — that's the precise framing. Intermediate operations (`map`, `filter`) are lazy and do nothing until a terminal operation (`collect`, `reduce`, `count`) triggers a single pull-based pass; this enables short-circuiting (`findFirst`). The nuance interviewers probe: stateful intermediates (`sorted`, `distinct`) buffer the whole stream so they break short-circuiting, and the stream is **single-use** (Q45). "Lazy" is not the same as "free to reuse." (See Q22.)
</details>

**Q51. Why can chaining `map`/`filter` be slower than one loop — and when is it *not*?**

<details><summary>Answer</summary>

It's slower when the chain is **eager** (Python lists, JS arrays): each stage allocates and traverses a full intermediate collection, so three stages = three allocations + three passes + GC, versus the loop's one pass and one allocation (Q27). It's **not** slower when the pipeline is **lazy/fused** — Java Streams, Rust iterators, Python generators pull one element through all stages, so there are no intermediates and Rust's monomorphized chains compile to the same code as the loop. So the answer is "it depends on eager vs lazy": eager chaining pays the intermediate-collection tax; lazy/fused chaining largely doesn't.
</details>

**Q52. Is `reduce` always parallelizable?**

<details><summary>Answer</summary>

No — only when the combining function is **associative** (and a clean parallel reduce also wants an **identity**). Parallelism reorders the grouping of operations across chunks, so a non-associative reducer (subtraction, division, "take first", order-dependent string building without ordering guarantees) gives *wrong* results when run in parallel, even though it's perfectly correct sequentially. If the op is also commutative you can additionally ignore chunk arrival order. So the precondition for safe parallel reduce is: associative combiner + identity element + side-effect-free lambdas. Without those, parallel reduce is a silent correctness bug, not just a performance question.
</details>

**Q53. If `map` preserves length and `filter` only shrinks, how do you grow a collection functionally?**

<details><summary>Answer</summary>

With `flatMap` (Q13). Since `flatMap` maps each element to a *collection* and concatenates, an element mapping to a 3-element list grows the output. "Repeat each element n times," "expand each row into its sub-rows," "generate all pairs" are all `flatMap`. So the trio's length rules are: `map` = same, `filter` = fewer, `flatMap` = any (including more), `reduce` = one. If a candidate says "you can't grow with map/filter," the follow-up is "right — which operation do you reach for?" and the answer is `flatMap`.
</details>

**Q54. A reduce that builds a list grows by one each step — is that a smell?**

<details><summary>Answer</summary>

Usually yes (Q14). A reduce whose accumulator is the *same collection type* as the elements, appended one-at-a-time, is a `map`/`filter`/`flatMap` in disguise — less readable and often O(n²) if it copies. The legitimate exceptions: when each step needs the *running accumulated state* to decide the next element (a `scan`-like dependency), when you're deduplicating/grouping (accumulator is a `set`/`dict`, a genuinely different shape), or when building a single non-collection object. The discriminator: does the step depend on the accumulated history, or just on the current element? If just the element → it's a map/filter.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q55. Length rule for each of map/filter/reduce/flatMap?**

<details><summary>Answer</summary>

`map` → same length; `filter` → fewer-or-equal; `reduce` → one value; `flatMap` → any (zero, fewer, same, or more).
</details>

**Q56. The one property a reducer needs to parallelize?**

<details><summary>Answer</summary>

Associativity (plus an identity element for clean handling of empty chunks).
</details>

**Q57. Filter-then-map or map-then-filter — default?**

<details><summary>Answer</summary>

Filter first to shrink the stream before expensive transforms — unless the map changes what the predicate must see.
</details>

**Q58. Why supply a seed to `reduce`?**

<details><summary>Answer</summary>

Correct result on empty input, and to set an accumulator type that may differ from the element type.
</details>

**Q59. Java: primitive pipeline without boxing?**

<details><summary>Answer</summary>

Use `IntStream`/`LongStream`/`DoubleStream` instead of `Stream<Integer>`.
</details>

**Q60. Are Java Stream intermediate ops eager or lazy?**

<details><summary>Answer</summary>

Lazy — they don't run until a terminal operation pulls elements through.
</details>

**Q61. What does `flatMap` do that `map` can't?**

<details><summary>Answer</summary>

Produce a different number of outputs per input (one-to-many), then flatten by one level.
</details>

**Q62. `reduce` vs `scan`?**

<details><summary>Answer</summary>

`reduce` returns the final accumulator; `scan` returns every intermediate (running results).
</details>

**Q63. One reason a parallel reduce can be slower?**

<details><summary>Answer</summary>

Split/schedule/merge overhead exceeds the work for small or non-splittable inputs.
</details>

**Q64. Cure for a lazy-fold space leak?**

<details><summary>Answer</summary>

Use a strict fold (`foldl'`) that forces the accumulator each step.
</details>

---

## How to Talk About Map/Filter/Reduce in Interviews

A few habits separate a strong answer from a textbook recital:

- **Lead with the length/shape invariant.** "`map` is 1-to-1, `filter` is many-to-fewer, `reduce` is many-to-one, `flatMap` is one-to-many" instantly shows you reason about these as a family, not as three memorized methods.
- **Name the trade-off, especially allocations.** The senior signal on the trio is knowing that *naive eager chaining* allocates intermediate collections while *lazy/fused* pipelines don't — and being able to say which runtime you're in (Java Stream, Rust iterator, Python generator vs list).
- **Tie `reduce`'s correctness to algebra.** Associativity for parallelism, identity for empty input, the monoid pattern — these connect the operation to *why* it parallelizes and *why* the seed matters, which is the difference between using `reduce` and understanding it.
- **Show `map`/`filter` as special cases of `reduce`/`flatMap`,** then immediately add the caveat that you wouldn't *write* them that way (O(n²), unreadable). Demonstrating power *and* judgment is the combination interviewers want.
- **Reach for the idiomatic form per language.** Python → comprehension/generator; Java → Stream (primitive-specialized when hot); Go → the explicit fused loop. Knowing the local idiom signals real experience.
- **Avoid purism.** "Always use `reduce`," "always avoid loops," "always parallelize" are juniorisms. Calibrate: clarity by default, fuse/parallelize only on a profiled hot path with the right algebraic properties.

---

## Summary

- The trio has fixed **shape invariants**: `map` preserves length (1-to-1), `filter` shrinks (many-to-fewer), `reduce` collapses to one value (many-to-one), and `flatMap` is the general one-to-many that can even grow the collection. Picking the right one starts from "what should the output count be?"
- `reduce` is a **fold**, and the `foldLeft`/`foldRight` distinction matters for non-associative combiners, laziness/short-circuiting, and stack safety. The combiner's **associativity** (plus an **identity**) is exactly what makes a reduce parallelizable and chunk-independent; without it, parallel reduce is a silent correctness bug.
- The defining performance story is **intermediate allocations**: eager `map`/`filter` chains build a full collection per stage, so they can be slower than one loop, while **lazy/fused** pipelines (Java Streams, Rust iterators, Python generators) and **transducers** pull one element through all stages with no intermediates. **Boxing** (`Stream<Integer>` vs `IntStream`) and **parallel-stream overhead** are the other deep costs.
- The strongest answers lead with the shape invariants, name the eager-vs-lazy allocation trade-off, ground `reduce` in associativity/identity, and pick the idiomatic form per language — defaulting to clarity and fusing/parallelizing only on a measured hot path.

---

## Related Topics

- [`junior.md`](junior.md) — the trio's definitions, loop equivalence, and first pipelines.
- [`middle.md`](middle.md) — folds, `flatMap`, when `reduce` is the wrong tool.
- [`senior.md`](senior.md) — laziness, transducers, parallel map-reduce.
- [`professional.md`](professional.md) — allocations, fusion, boxing, parallel-stream internals.
- [First-Class & Higher-Order Functions](../01-first-class-and-higher-order-functions/interview.md) — `map`/`filter`/`reduce` take functions as arguments; the foundation beneath the trio.
- [Composition](../05-composition/interview.md) — chaining stages into pipelines, point-free style, and stage fusion.
- [Immutability](../03-immutability/interview.md) — why `map`/`filter` return new collections instead of mutating.
- [Algebraic Data Types](../06-algebraic-data-types/interview.md) — `Option`/`Result` and their `map`/`flatMap`, the monadic cousins of the trio.
- [Monads — Plain English](../09-monads-plain-english/interview.md) — `flatMap`/`bind` as the universal one-to-many operation.
- [Laziness & Streams](../12-laziness-and-streams/interview.md) — lazy evaluation, infinite sequences, short-circuiting, and stream performance.
- [Clean Code → Async & Functional](../../clean-code/12-async-and-functional/README.md) — functional style in everyday code.
- [Concurrency](../../../language-internals/concurrency-async-parallel/concurrency/README.md) — the parallel-execution backdrop for parallel map-reduce.

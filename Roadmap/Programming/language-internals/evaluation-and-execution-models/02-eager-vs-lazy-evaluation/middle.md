# Eager vs. Lazy Evaluation — Middle Level

> **Topic:** [Eager vs. Lazy Evaluation](README.md)
> **Focus:** Lazy *sequences* as a design tool — infinite streams, generate-and-filter pipelines, the sieve of Eratosthenes, and the same laziness across Python, JavaScript, C#/LINQ, Java Streams, and Scala.

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

> Focus: **How do you design with laziness?** Not just "what is a thunk," but "how do I build pipelines, infinite streams, and queries that do the minimum work — and the same idea in five languages I'll actually use."

At the junior level, laziness was a property: some expressions run later than you wrote them. At this level, laziness becomes a **design tool**. The central technique is the **lazy sequence** — a stream of values pulled on demand — and the patterns it unlocks: *generate-and-filter*, where you produce a possibly-infinite source and lazily filter it; *take-N*, where you slice exactly what you need off an unbounded stream; and *fusion*, where chained `map`/`filter` operations run one element at a time with no intermediate collections.

The reason this matters at work is that every major language now ships a lazy-sequence facility, and they all behave the same way under the hood even though they have different names:

- **Python:** generators (`yield`), generator expressions, `itertools`.
- **JavaScript:** iterators and generator functions (`function*`, `yield`).
- **C#:** `IEnumerable<T>` with **deferred execution** (LINQ).
- **Java:** `Stream<T>` with **intermediate** vs. **terminal** operations.
- **Scala:** `LazyList` (formerly `Stream`), `lazy val`, and by-name parameters (`=> A`).

Learn the shape once and you read all five. The shape is: *intermediate operations are lazy and just record intent; a terminal/consuming operation pulls values through and triggers the work.* If you never call the terminal operation, **nothing happens** — which is both the superpower and the footgun.

This page covers: building infinite streams (`naturals`, `repeat`, `iterate`), the canonical lazy programs (Fibonacci stream, sieve of Eratosthenes), the intermediate-vs-terminal distinction made concrete in each language, the C#/LINQ "multiple enumeration" and "modified closure" traps, and how to reason about *how much* work a lazy pipeline actually performs. The next level (`senior.md`) takes the leap to Haskell, where laziness is the default and brings space leaks; `professional.md` covers strictness analysis and lazy initialization under concurrency.

---

## Prerequisites

- **Required:** Comfort with the junior material — eager vs. lazy, thunks, short-circuit operators, Python generators, exhaustion.
- **Required:** Reading basic code in at least two of: Python, JavaScript, C#, Java, Scala.
- **Required:** Familiarity with `map`/`filter`/`reduce`-style higher-order functions.
- **Helpful but not required:** Some exposure to LINQ (`Where`, `Select`) or Java Streams (`.stream().filter()`).
- **Helpful but not required:** The idea of an *iterator protocol* (`hasNext`/`next`, `MoveNext`).

You do **not** need:

- Haskell, `seq`, or strictness analysis (that's `senior.md`).
- Thread-safe lazy initialization or double-checked locking (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Lazy sequence / stream** | A sequence whose elements are produced on demand, one at a time, rather than all upfront. |
| **Intermediate operation** | A pipeline step (`map`, `filter`, `Select`, `Where`) that is *lazy*: it records what to do but computes nothing yet. |
| **Terminal operation** | A consuming step (`collect`, `toList`, `sum`, `forEach`, `next`) that *forces* the pipeline and triggers the work. |
| **Deferred execution** | (C#/LINQ) The query is built lazily; work runs only when enumerated. Identical concept to laziness. |
| **Fusion / loop fusion** | When chained lazy ops run per-element in a single pass, never building intermediate collections. |
| **`iterate(f, seed)`** | Lazy stream `seed, f(seed), f(f(seed)), …`. Builds infinite sequences from a step function. |
| **`repeat(x)`** | Infinite lazy stream of the same value `x, x, x, …`. |
| **`cycle(xs)`** | Infinite lazy stream that loops a finite sequence forever. |
| **`takeWhile` / `take`** | Lazy slicing: pull until a predicate fails / pull exactly N. The usual way to bound an infinite stream. |
| **Multiple enumeration** | (C#) Iterating the same deferred query twice, re-running all the work twice. A common performance bug. |
| **By-name parameter** | (Scala) `x: => A` — the argument is a thunk, evaluated each time it's used inside the method, not at the call site. |
| **`lazy val`** | (Scala) A value computed at most once, on first access, then memoized. |
| **Memoized thunk** | A thunk that caches its result after the first force (call-by-need). `lazy val` is one. |
| **Cold vs. hot** | A *cold* source recomputes on each enumeration (most LINQ); a *hot* source is consumed once. |

---

## Core Concepts

### 1. The Universal Shape: Lazy Steps, Eager Consumers

Every lazy-pipeline API in every language splits operations into two kinds:

- **Lazy (intermediate):** `map`, `filter`, `take`, `Select`, `Where`, `Skip`. These return a *new lazy sequence* and do **no work**.
- **Strict (terminal):** `toList`/`collect`/`sum`/`count`/`forEach`/`reduce`/materializing into an array. These **pull** values through the whole chain and trigger every recorded step.

```python
# Python: filter and map are lazy; list(...) is the terminal that forces it all.
pipeline = map(lambda x: x * x, filter(lambda x: x % 2 == 0, range(10)))
# Nothing has run. 'pipeline' is a lazy iterator.
result = list(pipeline)   # NOW the filter and map run, element by element.
```

The mental rule: **building the pipeline is free; consuming it is where the work lives.** If you forget the terminal operation, you get a sequence object and zero output — the famous "it never ran."

### 2. Infinite Streams: `repeat`, `iterate`, `naturals`

Laziness makes infinite data ordinary. The three canonical generators:

```python
import itertools

# repeat: same value forever
ones = itertools.repeat(1)                       # 1, 1, 1, ...

# count: naturals (iterate with +1)
naturals = itertools.count(0)                    # 0, 1, 2, ...

# iterate-style: seed, f(seed), f(f(seed)), ... (hand-rolled)
def iterate(f, seed):
    x = seed
    while True:
        yield x
        x = f(x)

powers_of_two = iterate(lambda x: x * 2, 1)      # 1, 2, 4, 8, ...
print(list(itertools.islice(powers_of_two, 6)))  # [1, 2, 4, 8, 16, 32]
```

None of these would terminate eagerly. Laziness lets you *describe* the whole infinite sequence and pull a finite slice with `islice` / `takeWhile`.

### 3. The Fibonacci Stream

The Fibonacci sequence is the textbook lazy-stream example because each element depends on the previous two, and you want as many as you ask for — no more:

```python
def fibonacci():
    a, b = 0, 1
    while True:
        yield a
        a, b = b, a + b

import itertools
print(list(itertools.islice(fibonacci(), 10)))
# [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]
```

The stream is infinite and self-referential in spirit ("the next Fib is the sum of the last two"), but the generator computes exactly the elements you pull. Ask for 10, compute 10. Ask for a million, compute a million. The *description* is bounded; the *data* is unbounded.

### 4. The Sieve of Eratosthenes — Lazily

The sieve is the canonical "generate-and-filter" lazy program. Generate `2, 3, 4, 5, …`; the first is prime; remove every multiple of it; recurse on the rest. Eagerly this needs a bounded array. Lazily it produces primes forever:

```python
def sieve(stream):
    p = next(stream)
    yield p
    # Lazily filter out multiples of p, then recurse on the rest.
    yield from sieve(x for x in stream if x % p != 0)

import itertools
primes = sieve(itertools.count(2))
print(list(itertools.islice(primes, 10)))
# [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]
```

Each prime found installs a new lazy filter over the stream of candidates. (This is the elegant-but-slow "incremental sieve" — beautiful as a demonstration of generate-and-filter, not as a fast primality engine. The point is the *shape*: an unbounded source, layered lazy filters, pull as many as you want.)

### 5. Generate-and-Filter: the Modularity Win

Lazy sequences let you separate *generation* from *selection* with no efficiency penalty. The classic argument (from the paper *Why Functional Programming Matters*): eagerly, "generate all candidates then take the best" wastes work because you build the whole candidate list. Lazily, "generate" and "take the best" *fuse* — generation stops the moment the consumer stops asking.

```python
# Newton's method square root: generate an infinite stream of approximations,
# then lazily take the first one that's "good enough." Generation halts there.
def approximations(n, guess=1.0):
    while True:
        yield guess
        guess = (guess + n / guess) / 2

def within(eps, stream):
    prev = next(stream)
    for cur in stream:
        if abs(cur - prev) < eps:
            return cur
        prev = cur

print(within(1e-9, approximations(2)))   # ~1.41421356
```

`approximations` is infinite; `within` decides when to stop. Neither knows about the other. That separation — possible *only* because generation is lazy — is the modularity payoff.

### 6. Same Idea, Five Languages

The shape is identical; only the names change.

| Concept | Python | JavaScript | C# (LINQ) | Java | Scala |
|---|---|---|---|---|---|
| Lazy source | generator / `itertools` | `function*` | `IEnumerable<T>` | `Stream<T>` | `LazyList` |
| Lazy map | `map` / genexpr | manual / lib | `.Select()` | `.map()` | `.map()` |
| Lazy filter | `filter` | manual / lib | `.Where()` | `.filter()` | `.filter()` |
| Bound it | `islice`, `takewhile` | `take` helper | `.Take()` | `.limit()` | `.take()` |
| Terminal | `list()`, `sum()` | `[...gen]`, loop | `.ToList()`, `foreach` | `.collect()`, `.count()` | `.toList`, `.force` |
| Single-value lazy | — | — | `Lazy<T>` | `Supplier<T>` | `lazy val` |
| Deferred argument | `lambda` thunk | arrow thunk | `Func<T>` | `Supplier<T>` | by-name `=> A` |

---

## Real-World Analogies

**The assembly line vs. the conveyor on demand.** An eager pipeline finishes station 1 for *all* items before station 2 starts — three full passes, three full piles of work-in-progress. A lazy pipeline is a single conveyor: one item walks through station 1, then 2, then 3, then the next item starts. No piles (intermediate collections), and if the customer takes only five items, stations stop after five.

**The streaming service vs. the download.** Eager is downloading the whole movie before you can watch (full materialization). Lazy is streaming: frames arrive as you watch, and if you stop after ten minutes, the rest is never fetched.

**The vending machine (LINQ deferred).** Building a LINQ query is like *programming* a vending machine — pressing buttons to choose what it *will* dispense. Nothing drops until you put the coin in (`.ToList()` / `foreach`). And if you press the coin button twice, you pay twice — that's multiple enumeration.

**The recipe card that re-cooks (cold sequences).** Most LINQ queries are cold recipes: every time you enumerate, the kitchen cooks again from scratch. If the cooking is expensive (a DB hit), enumerating twice hits the DB twice.

---

## Mental Models

**Model 1: The pipeline is a blueprint; the terminal op presses START.** `filter().map().take()` draws the blueprint. `toList()` is the START button. No button, no machine running.

**Model 2: Pull from the right.** Data flows because the *consumer on the right* asks for one value, which pulls one value left-to-right through every stage. Demand propagates backward; data propagates forward, one element at a time.

**Model 3: Infinite description, finite realization.** An infinite stream is a *finite description* of an *unbounded* sequence. You can hold it, pass it, compose it — all cheap — and you only ever realize the prefix you consume.

**Model 4: Cold = a function disguised as data.** A cold lazy sequence (most LINQ, a fresh generator) is really "the work, frozen, ready to re-run." Treat enumerating it as *calling a function*: do it twice, pay twice.

---

## Code Examples

### JavaScript: generators and a lazy `take`

```javascript
function* naturals() {
  let n = 0;
  while (true) yield n++;          // infinite, but lazy
}

function* take(n, iterable) {
  let i = 0;
  for (const x of iterable) {
    if (i++ >= n) return;          // stop early — pulls only n values
    yield x;
  }
}

console.log([...take(5, naturals())]);   // [0, 1, 2, 3, 4]
```

### C#: LINQ deferred execution and the multiple-enumeration trap

```csharp
// Deferred: Where + Select do NOTHING here. No DB call, no iteration.
IEnumerable<int> query = numbers
    .Where(x => { Console.WriteLine($"filtering {x}"); return x % 2 == 0; })
    .Select(x => x * x);

// First enumeration — NOW the Where runs.
var list1 = query.ToList();

// Second enumeration — the Where runs AGAIN. The work is duplicated!
var count = query.Count();   // re-filters everything

// Fix: materialize once.
var cached = query.ToList();   // run the work a single time
var c1 = cached.Count;
var c2 = cached.Sum();         // reuse — no re-run
```

This is the **multiple enumeration** bug: a deferred `IEnumerable` is cold, so each consuming call (`ToList`, `Count`, a `foreach`) re-executes the entire pipeline. If the source is a database or network call, you pay for it every time. The fix is to materialize (`.ToList()` / `.ToArray()`) when you'll consume more than once.

### C#: the modified-closure trap with deferred queries

```csharp
// Pre-C# 5 / classic trap: the lambda captures the LOOP VARIABLE, not its value.
var queries = new List<IEnumerable<int>>();
for (int threshold = 0; threshold < 3; threshold++)
    queries.Add(numbers.Where(x => x > threshold));   // captures 'threshold'

// Because the queries are DEFERRED, none ran during the loop.
// By the time we enumerate, 'threshold' == 3 for ALL of them.
foreach (var q in queries)
    Console.WriteLine(q.Count());   // all use threshold == 3

// Fix: copy the loop variable into a local captured per-iteration.
for (int t = 0; t < 3; t++) {
    int local = t;                                    // fresh binding each pass
    queries.Add(numbers.Where(x => x > local));
}
```

Deferred execution *amplifies* the closure trap: because the query doesn't run during the loop, the captured variable has moved on by the time it does. (C# `foreach` was later changed to give each iteration a fresh variable, but `for` loops and many other languages still bite here.)

### Java: Stream intermediate vs. terminal

```java
import java.util.stream.*;

// peek/filter/map are INTERMEDIATE (lazy). No "peeking 1" prints yet.
Stream<Integer> s = Stream.of(1, 2, 3, 4, 5)
    .peek(x -> System.out.println("peeking " + x))
    .filter(x -> x % 2 == 0)
    .map(x -> x * 10);

System.out.println("stream built, nothing ran");

// collect is TERMINAL — it forces the pipeline, one element at a time.
var result = s.collect(Collectors.toList());   // now the peeks run, interleaved
System.out.println(result);                     // [20, 40]
```

```java
// Infinite Java stream + limit (the terminal-bounded pattern):
Stream.iterate(0, n -> n + 1)   // infinite, lazy
      .filter(n -> n % 3 == 0)
      .limit(5)                 // still intermediate, but bounds it
      .forEach(System.out::println);   // terminal → 0 3 6 9 12
```

Two Java rules worth memorizing: (1) a stream can be consumed **once** — a second terminal op throws `IllegalStateException` (Java's version of "exhausted"); (2) `limit` on an infinite stream is the standard way to keep the terminal op from running forever.

### Scala: `lazy val` and by-name parameters

```scala
// lazy val: computed at most once, on first access, then cached (memoized thunk).
lazy val config = {
  println("loading config (expensive)")
  loadFromDisk()
}
// 'loading config' has NOT printed yet.
println("about to use config")
println(config.timeout)   // NOW it loads — and only this once
println(config.retries)   // cached; no reload

// By-name parameter: `body: => Unit` is a thunk, re-evaluated on each use.
def repeat(n: Int)(body: => Unit): Unit =
  for (_ <- 1 to n) body          // 'body' re-runs each iteration

repeat(3) { println("hi") }       // prints hi three times
```

The distinction is sharp: `lazy val` runs **once** and memoizes; a **by-name parameter** runs **each time** it is referenced. One is call-by-need (cached); the other is call-by-name (re-evaluated). Both defer the work past the point you wrote it.

### Scala: an infinite `LazyList`

```scala
val fibs: LazyList[BigInt] =
  BigInt(0) #:: BigInt(1) #:: fibs.zip(fibs.tail).map { case (a, b) => a + b }

println(fibs.take(10).toList)   // List(0, 1, 1, 2, 3, 5, 8, 13, 21, 34)
```

`#::` is the lazy cons — the tail is a thunk, so this self-referential definition is well-founded and computes each Fib exactly once (memoized in the `LazyList`).

---

## Pros & Cons

**Lazy sequences — pros**

- **Zero intermediate collections** via fusion — chained `map`/`filter` run per-element in one pass.
- **Infinite and unbounded sources** become first-class (`iterate`, `repeat`, paginated APIs).
- **Generate-and-filter modularity** — generation and selection compose without wasted work.
- **Early termination is automatic** — `take`/`limit`/`first` stops generation immediately.

**Lazy sequences — cons**

- **"It never ran"** — forgetting the terminal operation yields a pipeline object and no output.
- **Multiple enumeration** — re-consuming a cold sequence silently re-runs all the work (DB/network hits multiply).
- **Single-consumption surprises** — Java Streams and Python generators throw or go empty on a second pass.
- **Closure traps amplified** — deferred execution reads captured variables *later*, after they've changed.
- **Side-effect timing is non-local** — `peek`/print fires at consumption, interleaved with the consumer.

---

## Use Cases

- **Paginated/streamed APIs:** model "all results across all pages" as one lazy stream; consumers `take` what they need.
- **Large-file processing:** read a file line-by-line as a lazy sequence; filter/map/take without loading it all.
- **Search with early exit:** "first item satisfying P" over a large or infinite candidate space.
- **Pipelines with many stages:** `parse → validate → transform → filter` fuses into one pass over the data.
- **Mathematical sequences:** primes, Fibonacci, approximation series — describe infinitely, realize finitely.
- **Avoid eager when:** the source is consumed multiple times, or it's a cold DB query and you'd re-hit the DB.

---

## Coding Patterns

**Pattern: bound an infinite stream at the terminal.** Always pair an infinite source with `take`/`limit`/`takeWhile`/`islice`. Never call a fully-forcing terminal (`toList`, `sum`, `count`) on an unbounded stream.

**Pattern: materialize-once for multiple reads.** If a cold sequence will be consumed more than once, snapshot it: `var data = query.ToList();` in C#, `results = list(gen)` in Python, collect a Java stream into a `List`.

**Pattern: generate-and-filter.** Express the unbounded source separately from the selection logic; let early termination prune generation.

```python
# Find the first 3 perfect squares above 1000.
import itertools
squares = (n * n for n in itertools.count(1))                # generate
big = (s for s in squares if s > 1000)                       # filter
print(list(itertools.islice(big, 3)))                        # take → [1024, 1089, 1156]
```

**Pattern: capture by value, not by variable.** In loops that build deferred work, copy the loop variable into a fresh local (`int local = t;` / `lambda i=i: i`) before capturing it.

**Pattern: keep lazy stages pure.** Put side effects (logging, writes) in the terminal step or outside the pipeline, so their timing is predictable.

---

## Best Practices

- **Memorize intermediate vs. terminal** for whatever API you use. Intermediate = lazy, free, returns a sequence. Terminal = forces, runs the work, returns a value/collection.
- **Treat a cold lazy sequence like a function.** Enumerating it twice means running it twice. Cache if that's expensive.
- **Bound every infinite stream** before a forcing terminal op, or you hang.
- **Don't pass generators across module boundaries** if the caller expects re-readable data — return a `list`/array, or document the one-shot nature loudly.
- **Avoid side effects in `map`/`filter`/`peek`.** Use them for transformation only; do effects in a terminal `forEach` where timing is clear.
- **Watch closures in deferred code.** If a lambda captures a loop variable, copy it locally first.
- **Profile by consumption, not construction.** The cost shows up at the terminal op; that's where to measure.

---

## Edge Cases & Pitfalls

**Pitfall 1: forgetting the terminal op.** `numbers.Where(...)` / `stream.filter(...)` / `(x for x in xs)` with no consumer does nothing. There's no error — just silence. Always end with a terminal op (or know you're intentionally returning a lazy value).

**Pitfall 2: multiple enumeration of a cold source.** `query.Count()` then `query.ToList()` runs the whole pipeline twice. Over a DB, that's two queries. Materialize once.

**Pitfall 3: consuming a one-shot source twice.** Python generators go empty; Java streams throw `IllegalStateException: stream has already been operated upon or closed`. A generator/stream is not a re-readable collection.

**Pitfall 4: `limit`/`take` after a *blocking* infinite op.** `Stream.iterate(...).sorted().limit(5)` hangs — `sorted` is a *stateful* intermediate op that must see *all* elements first, so it never returns on an infinite stream. Only *stateless* intermediates (`map`, `filter`) stay lazy; `sorted`, `distinct` (sometimes) buffer.

**Pitfall 5: deferred side effects firing at the wrong time.** A `peek(println)` or a logging `Select` prints when consumed, not when written, and interleaves with the consumer. Logs look scrambled. Keep effects out of lazy stages.

**Pitfall 6: the modified-closure trap, amplified.** Because deferred queries run *later*, captured loop variables have moved on. Copy to a local before capturing.

**Pitfall 7: laziness hiding exceptions.** An error in a lazy stage doesn't throw when you build the pipeline — it throws when you *consume*, far from the code that caused it. The stack trace points at the terminal op, not the buggy `map`.

---

## Test Yourself

1. What is the difference between an intermediate and a terminal operation? Give two examples of each in any language.
2. Why does an infinite stream not hang your program — until it does? What turns "fine" into "hang"?
3. Explain the multiple-enumeration bug in LINQ. What's the one-line fix?
4. In Scala, what's the difference between `lazy val x` and a by-name parameter `x: => A`?
5. Why does `Stream.iterate(0, n -> n+1).sorted().limit(5)` hang, while `.filter(...).limit(5)` does not?
6. You write `(square(x) for x in nums)` and see no output. Nothing is broken. What's missing?
7. Why does deferred execution make the closure/loop-variable trap *worse* than in eager code?

<details>
<summary>Answers</summary>

1. **Intermediate** ops are lazy and return a new sequence without doing work: `map`/`filter`/`Select`/`Where`/`take`. **Terminal** ops force the pipeline and return a value/collection: `toList`/`collect`/`sum`/`count`/`forEach`/`next`.
2. It stays fine as long as every consumer is bounded (`take`/`limit`/`islice`). It hangs the moment a *forcing* terminal op (`toList`, `sum`, `count`) tries to realize *all* of an unbounded stream.
3. A cold deferred `IEnumerable` re-runs its whole pipeline on each enumeration, so consuming it twice (e.g. `Count()` then `ToList()`) does the work twice — and re-hits any DB/network source. Fix: materialize once with `.ToList()`/`.ToArray()`.
4. `lazy val` is computed **at most once**, on first access, then memoized (call-by-need). A by-name parameter is a thunk **re-evaluated every time** it's referenced inside the method (call-by-name).
5. `sorted` is a *stateful* intermediate op: it must consume the entire stream before producing anything, so on an infinite stream it never finishes. `filter` is *stateless* and stays lazy, so `limit` can stop it after 5.
6. The terminal/consuming step. A generator expression does nothing until consumed — `list(...)`, a `for` loop, or `next()`.
7. Because the deferred work runs *later*, after the loop has advanced/finished, so a captured loop variable has already changed by the time the lambda reads it. Eager code would have read the variable's value during the loop.

</details>

---

## Cheat Sheet

```text
PIPELINE SHAPE (all languages):
  [lazy intermediate ops]  →  [strict terminal op]
  map/filter/take          →  toList/collect/sum/forEach/next
  builds blueprint (free)  →  presses START (does the work)

INFINITE STREAM TOOLKIT:
  repeat(x)      x, x, x, ...
  iterate(f, s)  s, f(s), f(f(s)), ...
  count()        0, 1, 2, ...
  bound with:    take / limit / takeWhile / islice   (ALWAYS)

PER-LANGUAGE:
  Python  generator / itertools ; terminal = list()/sum()
  JS      function* / yield     ; terminal = [...gen]/for
  C#      IEnumerable (deferred) ; terminal = ToList()/foreach   ⚠ multiple enumeration
  Java    Stream (intermediate/terminal) ; one-shot, .limit() infinite ⚠ sorted() buffers
  Scala   LazyList / lazy val(once) / by-name =>A(each time)

TRAPS:
  - forgot terminal op → silent no-op
  - cold source enumerated twice → work runs twice
  - one-shot consumed twice → empty / IllegalStateException
  - sorted/distinct on infinite → hang (stateful intermediate)
  - captured loop var read late → wrong value
  - exception thrown at consume, not at definition
```

---

## Summary

At this level, laziness is a design tool centered on the **lazy sequence**. Every major language ships one, and they all share a shape: **intermediate operations** (`map`, `filter`, `take`) are lazy and merely record intent, while a **terminal operation** (`toList`, `collect`, `sum`, `forEach`, `next`) forces the pipeline and drives the work one element at a time. Forget the terminal op and nothing runs; that's the "it never ran" surprise.

Laziness makes **infinite streams** ordinary (`repeat`, `iterate`, `count`), enabling the canonical programs — the Fibonacci stream, the sieve of Eratosthenes, Newton's-method approximation series — and the **generate-and-filter** modularity win, where generation and selection compose with no wasted work because early termination prunes generation. Each language dresses this up differently: Python generators and `itertools`, JS `function*`, C# `IEnumerable` with deferred execution, Java `Stream` with its intermediate/terminal split and once-only consumption, and Scala's `LazyList`, `lazy val` (run-once, memoized), and by-name `=> A` parameters (re-run each use).

The costs are real and load-bearing: cold sequences re-run on every enumeration (the **multiple-enumeration** bug), one-shot sources go empty or throw on a second pass, stateful intermediates like `sorted` buffer and hang on infinite input, deferred execution amplifies the **closure trap**, and exceptions surface at consumption rather than definition. The discipline is: know your intermediate-vs-terminal split, bound every infinite stream, materialize cold sequences you'll read twice, and keep side effects out of lazy stages. The next level pushes into Haskell, where laziness is the *default* — bringing both the cleanest version of these ideas and their sharpest cost: the space leak.

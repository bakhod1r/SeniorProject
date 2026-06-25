# Eager vs. Lazy Evaluation — Interview Questions

> **Topic:** [Eager vs. Lazy Evaluation](README.md)
> **Focus:** Questions an interviewer actually asks — conceptual foundations, the language-specific behaviors (Haskell, Scala, Python, JS, C#/LINQ, Java Stream), the traps that catch strong candidates, and the design judgment that separates senior from mid.

---

## How to Use This File

Each question is a flat `## Question N` with a tier tag and a category. Read the prompt, answer out loud or on paper, *then* expand the answer. The categories are:

- **Conceptual / Foundational** — definitions and the "why."
- **Language-Specific** — Haskell, Scala, Python, JS, C#/LINQ, Java Stream behaviors.
- **Tricky / Trap** — the questions designed to expose shallow understanding.
- **Design** — judgment calls at system scale.

---

## Conceptual / Foundational

## Question 1

**(Junior) Define eager and lazy evaluation in one sentence each, and name the more common default.**

<details>
<summary>Answer</summary>

**Eager (strict)** evaluation computes a value as soon as the expression is reached. **Lazy (non-strict)** evaluation defers computing a value until its result is actually needed — and skips it entirely if it never is. Eager is the default in almost every mainstream language (Python, JavaScript, Java, C#, Go, C, Ruby); lazy is usually opt-in (generators, streams, deferred queries), with Haskell the major exception where laziness is the default.

</details>

---

## Question 2

**(Junior) Name three operators you already use that are lazy in one of their operands.**

<details>
<summary>Answer</summary>

`&&` / `and` (right operand skipped if left is false), `||` / `or` (right skipped if left is true), and the ternary `cond ? a : b` (only the chosen branch evaluates). These are **short-circuit** operators — non-strict in their second/branch operand. They are laziness everyone already relies on, often for correctness (`p != null && p.field`).

</details>

---

## Question 3

**(Middle) What is a thunk, and what does it mean to "force" one?**

<details>
<summary>Answer</summary>

A **thunk** is a parked, unevaluated computation — a heap object holding "how to produce this value when asked," rather than the value itself. To **force** a thunk is to run that computation and obtain the value. In a memoizing (call-by-need) system, the forced result is written back into the thunk so subsequent reads are free. Pattern matching, arithmetic, and primitives like `seq` force their operands.

</details>

---

## Question 4

**(Middle) Distinguish call-by-value, call-by-name, and call-by-need.**

<details>
<summary>Answer</summary>

- **Call-by-value (eager/strict):** evaluate each argument *before* the call. Most languages.
- **Call-by-name (lazy, no memo):** pass the argument as a thunk; *re-evaluate it every time* it's used in the body. Scala by-name parameters (`x: => A`) are this.
- **Call-by-need (lazy + memo):** pass as a thunk; evaluate at most *once* and cache. Haskell's strategy; Scala `lazy val` is this for a single binding.

The distinction between by-name and by-need is memoization — by-need shares the result, by-name recomputes.

</details>

---

## Question 5

**(Middle) What's the single biggest *modularity* argument for laziness?**

<details>
<summary>Answer</summary>

Laziness lets you **decouple generation from selection** with no efficiency penalty (the central point of Hughes's *Why Functional Programming Matters*). You can write "generate an infinite/large stream of candidates" and, separately, "consume until good enough" — and the consumer's early termination automatically prunes the producer's work. Newton's-method square root (generate approximations, take the first within epsilon) and the sieve of Eratosthenes are canonical examples. Eagerly you'd build the whole candidate list first; lazily the two compose and fuse.

</details>

---

## Question 6

**(Senior) What is the difference between Weak Head Normal Form (WHNF) and Normal Form (NF)? Why does it matter?**

<details>
<summary>Answer</summary>

**WHNF** means evaluated just far enough to expose the *outermost constructor* — the rest stays thunked. **NF** means fully evaluated: no thunks anywhere inside. It matters because the common forcing tools (`seq`, `$!`, BangPatterns, even `foldl'`) force only to **WHNF**. So `seq` on a tuple forces "it's a pair" but leaves both components as thunks — which is exactly why people add `foldl'` and *still* get a space leak with a tuple accumulator. To force completely you need `deepseq`/`force`. Mismatching the depth you need versus the depth you forced is the root of a whole class of laziness bugs.

</details>

---

## Question 7

**(Senior) Why does Haskell make side effects explicit in `IO` rather than allowing them in arbitrary lazy values?**

<details>
<summary>Answer</summary>

Pure laziness freely **reorders, skips, and shares** computations based on demand. For pure values that's invisible and beneficial. For *side effects* it would make the **order and number** of effects undefined — you couldn't predict when (or whether, or how many times) a print or write happens. Haskell quarantines effects in the `IO` type, sequenced explicitly by `>>=`/`do`, pulling them out of the lazy-evaluation game so ordering is deterministic. The widely-criticized "lazy IO" (e.g. `readFile` returning a lazy `String`) breaks this by smuggling effects — file-handle lifetime — into laziness, producing non-deterministic resource bugs.

</details>

---

## Language-Specific

## Question 8

**(Senior, Haskell) Walk through why `foldl (+) 0 [1..1000000]` can blow the stack, and how `foldl'` fixes it.**

<details>
<summary>Answer</summary>

`foldl` is lazy in its accumulator, so it never computes the running sum; it builds a thunk `(((0+1)+2)+3)+…` a million levels deep on the heap, then forces it all at once at the end — which overflows the stack (or eats huge heap). `foldl'` (from `Data.List`) forces the accumulator to **WHNF on every step**, so the running total is always a real number, not a growing thunk: constant space, no overflow. Rule of thumb: for strict reductions (sum, count, running state), always `foldl'`; reserve `foldr` for building lazy structures or short-circuiting.

</details>

---

## Question 9

**(Senior, Haskell) You replaced `foldl` with `foldl'` for a `(sum, count)` accumulator and it *still* leaks. Why? Fix it.**

<details>
<summary>Answer</summary>

`foldl'` forces the accumulator only to **WHNF**. For a tuple `(s, c)`, WHNF is satisfied the moment the *pair constructor* is known — but `s` and `c` themselves remain thunks, which tower up exactly like the original `foldl` leak. Fix by forcing the *components*: use BangPatterns (`step (!s, !c) x = (s+x, c+1)`), strict data fields (`data Acc = Acc !Int !Int`), or `deepseq` to drive the accumulator to NF. This "`foldl'` and still leaking" case is a favorite senior trap.

</details>

---

## Question 10

**(Senior, Haskell) Why does `length [1, undefined, 3]` return `3` without error, but `sum [1, undefined, 3]` throws?**

<details>
<summary>Answer</summary>

`length` forces only the list **spine** — the `(:)` constructors — to count them; it never inspects the *element* thunks, so the `undefined` head is never forced. `sum` must force *each element* to add it, so it forces `undefined` and throws. This is the WHNF/spine-vs-element distinction in practice: forcing the structure is not the same as forcing the contents. It also shows how a refactor that adds element-forcing (or switching `length`→`sum`) can resurrect a latent `⊥`.

</details>

---

## Question 11

**(Middle, Scala) What's the difference between `lazy val` and a by-name parameter `x: => A`?**

<details>
<summary>Answer</summary>

`lazy val x = expr` is **call-by-need**: `expr` runs at most once, on first access, then the result is memoized — every later read of `x` is free. A by-name parameter `def f(x: => A)` is **call-by-name**: `x` is a thunk that is **re-evaluated every time** it's referenced inside `f`'s body. So `lazy val` shares one computation; a by-name param recomputes on each use. By-name params are how Scala builds custom control structures (a `while`-like combinator, `unless`) and short-circuiting APIs without forcing the argument at the call site.

</details>

---

## Question 12

**(Middle, Python) What's the difference between `[f(x) for x in xs]` and `(f(x) for x in xs)`, where `f` prints?**

<details>
<summary>Answer</summary>

`[...]` is an **eager list comprehension**: it computes `f(x)` for *every* element immediately, so all the prints fire at construction. `(...)` is a **lazy generator expression**: it computes nothing until consumed, so no prints fire until you pull values with `next()`, a `for` loop, or `list(...)`. The one-bracket difference flips eager to lazy. Generators are also one-shot: once consumed (exhausted), iterating again yields nothing.

</details>

---

## Question 13

**(Middle, Python) What is generator exhaustion, and how do you handle needing to iterate twice?**

<details>
<summary>Answer</summary>

A generator is a *one-shot* stream: after it's been fully consumed, it is **exhausted** and produces nothing on a second pass (`list(gen)` then `list(gen)` gives `[]` the second time). It does *not* restart. To iterate twice: either **materialize** to a list once (`data = list(gen)`) and iterate the list, or **rebuild** a fresh generator each time you need to iterate. `itertools.tee` can duplicate a generator but buffers consumed values, which can negate the memory benefit.

</details>

---

## Question 14

**(Middle, JS) How do you build a lazy infinite sequence in JavaScript, and how do you bound it?**

<details>
<summary>Answer</summary>

Use a **generator function** (`function*` + `yield`):

```javascript
function* naturals() { let n = 0; while (true) yield n++; }
function* take(n, it) { let i = 0; for (const x of it) { if (i++ >= n) return; yield x; } }
[...take(5, naturals())];   // [0,1,2,3,4]
```

`naturals()` is infinite but lazy — each value is produced only on `.next()`. You **bound** it with a `take`/`takeWhile` helper (the iterator-helpers proposal and libraries like Lodash/IxJS / `lazy.js` provide these). Spreading or `Array.from` on the *raw* infinite generator hangs, because that forces the whole thing.

</details>

---

## Question 15

**(Middle, C#) Explain deferred execution in LINQ. When does the query actually run?**

<details>
<summary>Answer</summary>

LINQ query operators (`Where`, `Select`, `OrderBy`, etc.) are **deferred**: calling them builds an `IEnumerable<T>` that *describes* the query but does no work. The query executes only when it's **enumerated** — by a `foreach`, or a materializing/aggregating operator like `ToList()`, `ToArray()`, `Count()`, `First()`, `Sum()`. Until then, no iteration, no DB call (for `IQueryable`). This is identical in spirit to laziness: intermediate operators are lazy, terminal operators force.

</details>

---

## Question 16

**(Senior, C#) What is the "multiple enumeration" problem, and how do you fix it?**

<details>
<summary>Answer</summary>

A deferred `IEnumerable` is **cold**: each time you enumerate it, the *entire pipeline re-runs*. So `query.Count()` followed by `query.ToList()` executes the whole query *twice* — and if the source is a database or network call, you hit it twice. The fix is to **materialize once** with `.ToList()`/`.ToArray()`, then read the materialized collection as many times as needed. Tools like ReSharper flag "possible multiple enumeration of IEnumerable" for exactly this reason. The deeper rule: treat a cold lazy sequence like a *function* — enumerating twice means running twice.

</details>

---

## Question 17

**(Middle, Java) Distinguish intermediate and terminal operations on a `Stream`. What does laziness mean here?**

<details>
<summary>Answer</summary>

**Intermediate** operations (`filter`, `map`, `peek`, `limit`, `sorted`, `distinct`) are *lazy* — they return a new `Stream` and record intent without processing elements. **Terminal** operations (`collect`, `forEach`, `count`, `reduce`, `findFirst`, `anyMatch`) *force* the pipeline: they pull elements through, triggering all the recorded intermediates, one element at a time. Until a terminal op is called, **nothing runs**. Also: a `Stream` is single-use — a second terminal op throws `IllegalStateException` (Java's "exhausted"). And `Stream.iterate(...).limit(n)` is the idiom for bounding an infinite stream.

</details>

---

## Question 18

**(Senior, Java) Show how to make a log statement lazy so an expensive message isn't built when the level is disabled.**

<details>
<summary>Answer</summary>

Pass a `Supplier<String>` (a thunk) instead of a pre-built string, so the framework forces it only after the level check:

```java
// Eager: buildDump() always runs, even at WARN level.
log.debug("state: " + buildDump());

// Lazy: the lambda runs ONLY if DEBUG is enabled.
log.atDebug().log(() -> "state: " + buildDump());   // Log4j2 / SLF4J 2.x
```

The `Supplier` is a deferred computation; the logger checks `isDebugEnabled()` internally and forces the supplier only if needed. The same `Supplier<T>`/`Func<T>` pattern powers lazy defaults (`computeIfAbsent`) and gated work. Caveat: keep the thunk's captured state immutable, or you log a value that changed before the thunk ran.

</details>

---

## Tricky / Trap Questions

## Question 19

**(Middle) This prints `[2, 2, 2]`, not `[0, 1, 2]`. Why?**

```python
funcs = [lambda: i for i in range(3)]
print([f() for f in funcs])
```

<details>
<summary>Answer</summary>

Each lambda captures the **variable** `i`, not its value at creation time. The lambdas are lazy — they run *after* the loop has finished, when `i` has its final value `2`. So all three return `2`. This is the **late-binding closure trap**. Fix by binding the value eagerly at definition: `lambda i=i: i` (default argument captures the current value), or in a helper that takes `i` by value. The same trap appears in JavaScript with `var` (fixed by `let`), and in C# deferred LINQ with captured loop variables.

</details>

---

## Question 20

**(Senior, C#) These deferred queries all behave as if `threshold == 3`. Why?**

```csharp
var queries = new List<IEnumerable<int>>();
for (int threshold = 0; threshold < 3; threshold++)
    queries.Add(nums.Where(x => x > threshold));
// later: foreach (var q in queries) Console.WriteLine(q.Count());
```

<details>
<summary>Answer</summary>

The closure captures the **loop variable** `threshold`, and because the queries are **deferred**, none of them run during the loop. By the time you enumerate (later), the loop has finished and `threshold == 3` for *all* captured lambdas. Deferred execution *amplifies* the modified-closure trap — eager code would have read `threshold`'s value during the loop. Fix: copy into a per-iteration local: `int local = threshold; nums.Where(x => x > local)`. (C# later gave `foreach` a fresh per-iteration variable, but a `for` loop and many other languages still bite.)

</details>

---

## Question 21

**(Middle, Python) This hangs forever. Why, and how do you fix it?**

```python
def naturals():
    n = 0
    while True:
        yield n
        n += 1
print(list(naturals()))
```

<details>
<summary>Answer</summary>

`naturals()` is an **infinite** generator. `list(...)` is a *fully-forcing* terminal — it tries to realize *every* element, so it never returns. The generator was fine; the consumer was unbounded. Fix by bounding the consumption: `list(itertools.islice(naturals(), 10))`, or `takewhile`, or a `for ... break`. Rule: never apply a fully-forcing operation (`list`, `sum`, `max`) to an infinite source; always pair it with `take`/`islice`/`takewhile`.

</details>

---

## Question 22

**(Senior, Java) This hangs, even though it has a `limit`. Why?**

```java
Stream.iterate(0, n -> n + 1).sorted().limit(5).forEach(System.out::println);
```

<details>
<summary>Answer</summary>

`sorted()` is a **stateful intermediate** operation: it must consume the *entire* stream before it can emit anything (you can't know the smallest element until you've seen them all). On an *infinite* source it never finishes, so `limit(5)` never gets a chance to run. Only **stateless** intermediates (`filter`, `map`) stay fully lazy and let `limit` short-circuit. So `.filter(...).limit(5)` works but `.sorted().limit(5)` (and sometimes `.distinct()`) hangs on infinite input. Lesson: laziness is broken by operations that need to see the whole stream.

</details>

---

## Question 23

**(Senior, C#) `Lazy<T>`'s first initialization throws an exception. What happens on the *second* access?**

<details>
<summary>Answer</summary>

With the default `LazyThreadSafetyMode.ExecutionAndPublication`, the exception is **cached** — every subsequent access of `.Value` re-throws the *same* exception, and the factory is never retried. This is correct-by-design (so all threads see a consistent result) but surprising if your initializer can fail transiently (a flaky network/DB call). If you need retry-on-failure, use `LazyThreadSafetyMode.PublicationOnly` (which discards a failed value and allows another attempt) or handle initialization explicitly rather than relying on `Lazy<T>` to retry.

</details>

---

## Question 24

**(Senior) Does this LINQ query hit the database once or twice?**

```csharp
var active = db.Users.Where(u => u.IsActive);   // IQueryable, deferred
var count = active.Count();
var list = active.ToList();
```

<details>
<summary>Answer</summary>

**Twice.** `active` is a deferred `IQueryable`; `Count()` translates to and executes a `SELECT COUNT(*)` query, and `ToList()` executes a *separate* `SELECT *` query. Each terminal operation runs the pipeline against the DB anew. To hit the DB once, materialize first: `var list = active.ToList(); var count = list.Count;`. This is the database-flavored version of multiple enumeration, and a frequent source of surprise extra queries in EF Core / Entity Framework.

</details>

---

## Question 25

**(Senior, Java) Why might this Hibernate code throw `LazyInitializationException`?**

```java
Order o = orderRepo.findById(id).orElseThrow();
return o.getItems();   // returned to a controller, then serialized
```

<details>
<summary>Answer</summary>

`getItems()` is a **lazy association**. If `findById` ran inside a transaction/session that has now *closed*, the lazy collection has no open session/connection to force itself against. When the controller/serializer later iterates it, Hibernate throws `LazyInitializationException`. Laziness relocated the failure to *first access*, which happens after the session boundary. Fixes: fetch eagerly within the transaction (`JOIN FETCH`/entity graph), keep the session open across the access (Open-Session-in-View, with caveats), or — best — return a **DTO/projection** with the needed data already loaded inside the transaction.

</details>

---

## Question 26

**(Senior, Haskell) Adding `seq x ()` "to force x" didn't stop the leak. Why might that be?**

<details>
<summary>Answer</summary>

`seq` forces only to **WHNF** — the outermost constructor. If `x` is a structure whose *contents* are the thunks accumulating (a tuple, a list whose elements thunk, a record with lazy fields), forcing the outer shape does nothing about the inner thunks. You either need to force deeper (`deepseq`/`force` to NF), force the specific components (BangPatterns on fields, strict data fields), or `seq` the right sub-value. "I added `seq` and nothing changed" almost always means you forced one layer when the leak was deeper.

</details>

---

## Design / System Scenarios

## Question 27

**(Senior) When would you choose eager evaluation even though lazy "wastes less work"?**

<details>
<summary>Answer</summary>

Choose eager when:
- **The data is small and fully used** — laziness's bookkeeping/allocations cost more than they save.
- **Side-effect timing must be predictable** — logging, I/O ordering, metrics.
- **You'll consume the result more than once** — eager collections are re-readable; cold lazy sequences re-run.
- **You want fail-fast** — surface errors at construction with a clean stack trace, not deep inside a consumer.
- **Latency must be predictable** — eager front-loads cost; lazy can spike on first use (cold start).

Laziness's "less work" matters only when there's *work to skip* (large/infinite sources, partial consumption). Otherwise eager is simpler and often faster.

</details>

---

## Question 28

**(Senior) Design a thread-safe lazy singleton. Walk through the options and their guarantees.**

<details>
<summary>Answer</summary>

Never hand-roll naive double-checked locking — without a memory barrier it can publish a *half-constructed* object (a reordered allocate→assign→construct). Use a vetted primitive:

- **Java:** the **initialization-on-demand holder** idiom (a static nested class; the JVM class-init lock guarantees once-only init and safe publication, with no synchronization on the hot path). If a non-static lazy field is needed, use `volatile` + DCL, reading the volatile into a local.
- **C#:** `Lazy<T>` with `ExecutionAndPublication` — correct DCL implemented for you.
- **Go:** `sync.Once` — `once.Do(init)` runs once with correct ordering.
- **C++:** function-local `static` (thread-safe since C++11 "magic statics") or `std::call_once`.

The unifying point: lazy-init across threads is a **safe-publication** problem, and correctness requires a memory barrier that these primitives encapsulate.

</details>

---

## Question 29

**(Senior) An ORM-backed endpoint is slow. You suspect laziness. How do you diagnose and fix it?**

<details>
<summary>Answer</summary>

Suspect an **N+1 query** from lazy loading: a loop over parents where each iteration touches a lazy association (`order.getCustomer()`), firing one query per parent. **Diagnose** by enabling SQL query logging / an APM trace and counting queries per request — N+1 shows as one parent query plus N child queries. **Fix** by eager-fetching the association you iterate: `JOIN FETCH` / entity graph (JPA), `Include()` (EF Core), or batch fetching. Keep lazy loading only for genuinely optional graph edges you rarely touch. Also watch for accessing lazy associations *outside* the session (→ `LazyInitializationException`) and fix with eager fetch or DTO projections within the transaction.

</details>

---

## Question 30

**(Professional) "Lazy-init everything for fast startup." Critique this as an architecture decision.**

<details>
<summary>Answer</summary>

Lazy-init-everything optimizes the *wrong* metric. It buys fast boot but:
- **Moves cost to first request** — a user waits while config/connections/caches initialize (cold-start latency cliffs), often under load.
- **Loses fail-fast** — a bad config, missing secret, or unreachable DB only surfaces *mid-request* instead of at boot, where it's safe to crash and roll back.
- **Complicates capacity planning** — steady-state latency is unpredictable when work is deferred unevenly.

Better: **eager-load and warm the critical path** (config, auth keys, schema checks, primary pool) at boot so the system fails fast and serves the first request hot; **lazy-load the rarely-used and the enormous** (big indexes, optional features, ML models most requests skip). Eager vs. lazy is a decision about *where you want cost and failure to land* — front-load the critical, defer the optional.

</details>

---

## Question 31

**(Professional) Where does the compiler help with laziness, and where does it not?**

<details>
<summary>Answer</summary>

GHC's **strictness/demand analysis** proves which arguments a function *always* forces and evaluates them eagerly (often unboxed, via the worker/wrapper transform), recovering most of the runtime cost of "lazy by default" — *without changing semantics*, since it only un-defers evaluation that was guaranteed to happen. Where it **can't** help: *conditionally* strict functions (force an argument on some branches only), strictness that needs **cross-module inlining** the compiler didn't perform, and places where laziness is genuinely needed. Those gaps are exactly where space leaks survive, and where you intervene with `!`/`foldl'`/strict fields/`deepseq` — annotations that also *help the analyzer* prove strictness. The senior skill is reading a heap profile to find the leak the compiler missed.

</details>

---

## Question 32

**(Senior) Argue both sides: is "lazy by default" (Haskell) a good language design choice?**

<details>
<summary>Answer</summary>

**For:** It maximizes compositionality — functions don't force arguments, so control flow, combinators, and infinite/circular structures (`fibs`) compose freely; generate-and-filter modularity is the norm; short-circuiting is automatic everywhere; and `⊥` can live safely in unused positions. It pushed the language toward purity (effects had to be quarantined, which yielded `IO`/monads).

**Against:** Reasoning about *time and space* is genuinely hard — execution order differs from source order, and **space leaks** (thunk buildup in `foldl`/lazy state/lazy fields) are a recurring, hard-to-spot failure that newcomers and experts both hit. Performance needs `seq`/`!`/`foldl'` discipline and heap profiling; side effects fit awkwardly; and many practitioners (including some language designers in hindsight) argue strict-by-default with opt-in laziness — the model the rest of the industry chose — gives most of the benefits with far fewer surprises. The honest senior answer: laziness-by-default is a *coherent and powerful* choice that trades predictable performance for maximal compositionality, and reasonable engineers disagree on whether that trade is worth it.

</details>

---

## Cheat Sheet

```text
DEFINITIONS
  eager/strict     = compute when reached (default everywhere except Haskell)
  lazy/non-strict  = compute when needed (opt-in: generators/streams/deferred)
  thunk            = parked computation; FORCE = run it
  call-by-value/name/need = eager / lazy-recompute / lazy-memoized

FORCING DEPTH (Haskell)
  WHNF = outermost constructor (seq, $!, !, foldl')
  NF   = fully evaluated (deepseq, force)
  "foldl' still leaks" → tuple/record fields stay thunks → bang them

LANGUAGE QUICK-REF
  Haskell  lazy by default; foldl' for strict folds; space leaks
  Scala    lazy val (once, memoized) vs by-name =>A (each use)
  Python   [..] eager / (..) lazy genexpr ; one-shot exhaustion
  JS       function*/yield ; bound infinite with take
  C#       IEnumerable deferred ; multiple-enumeration + modified-closure traps
  Java     Stream intermediate(lazy)/terminal(forces) ; single-use ; sorted() buffers

TOP TRAPS
  [2,2,2] late-binding closure (capture variable, read late)
  list(infinite_gen) hangs
  sorted().limit(5) on infinite → hangs (stateful intermediate)
  query.Count() + query.ToList() → DB hit twice
  LazyInitializationException → lazy assoc after session closed
  DCL without volatile → half-constructed object

DESIGN
  eager  = front-load cost, fail-fast, predictable latency, maybe wasted work
  lazy   = fast boot, pay-on-use, cold-start spikes, failure at first use
  thread-safe lazy init: holder idiom / Lazy<T> / sync.Once / magic statics
```

---

## What I'd Ask a Candidate Now

If I had ten minutes, I'd ask three things. **One conceptual:** "Name a lazy operator you use every day and explain what would break if it became eager." (Tests whether they connect short-circuit `&&` to the topic at all.) **One trap:** the `[2, 2, 2]` closure or the LINQ multiple-enumeration question — both reveal whether "deferred" is understood mechanically or just memorized. **One design:** "You're told to lazy-init everything for fast startup — react." A strong candidate immediately raises cold-start latency, loss of fail-fast, and the thread-safety of first access, and reaches for the right primitive instead of hand-rolling DCL. The gap between candidates who recite "lazy = compute later" and those who can say *where the cost and failure move* is the gap between mid and senior.

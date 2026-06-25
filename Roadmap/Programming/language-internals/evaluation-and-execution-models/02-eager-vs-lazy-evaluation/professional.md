# Eager vs. Lazy Evaluation — Professional Level

> **Topic:** [Eager vs. Lazy Evaluation](README.md)
> **Focus:** Laziness in production systems — the compiler's strictness analysis that recovers performance automatically, lazy initialization under concurrency (and why double-checked locking is a minefield), deferred logging, and choosing eager vs. lazy as an architecture decision with real failure modes.

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

> Focus: **When laziness leaves the textbook and enters a multi-threaded, latency-bound, observable production system, what actually breaks — and who fixes it?** Sometimes the compiler. Sometimes you, with a lock you'd better get exactly right.

The earlier levels treated laziness as a programmer's tool and Haskell's default. At the professional level, three forces converge that change the calculus:

1. **The compiler fights back.** Pervasive laziness is slow if taken literally (a thunk allocation per expression). Real compilers run **strictness analysis** (more precisely, *demand analysis*) to *prove* that a function always forces an argument, then evaluate it eagerly with no thunk — recovering most of the cost of "lazy by default" automatically. Understanding what the analyzer can and can't prove explains why some Haskell is fast and some leaks.

2. **Concurrency makes lazy initialization dangerous.** "Compute this once, the first time it's needed" — the most common form of laziness in mainstream production code (a lazy singleton, a cached config, a memoized expensive object) — becomes a **thread-safety problem** when two threads race to that first access. This is where **double-checked locking**, `volatile`/`Atomic`/`memory_order`, `Lazy<T>`, `LazyThreadSafetyMode`, `sync.Once`, and Java's holder idiom live, and where decades of subtly broken code originate.

3. **Laziness becomes an observability and latency property.** Deferred logging (`Supplier<T>`, `() => message`) trades predictable cost for conditional cost. Lazy DB queries (deferred `IEnumerable`, ORM lazy loading) trade upfront work for surprise N+1 queries and `LazyInitializationException` outside a session. Laziness moves *when and where* cost and failure occur — which is an architecture decision, not a micro-optimization.

This page covers: strictness/demand analysis and how it interacts with `seq`/inlining/worker-wrapper; thread-safe lazy initialization done correctly across Java/C#/C++/Go; the double-checked-locking pitfall and its language-specific fixes; deferred logging and `Supplier`-based APIs; ORM lazy loading and the N+1 / detached-entity traps; and a decision framework for eager vs. lazy at system scale. This is the deepest level; there is no further file.

---

## Prerequisites

- **Required:** Senior-level material — call-by-need, thunks, WHNF/NF, space leaks, `seq`/`foldl'`/`BangPatterns`/`deepseq`.
- **Required:** Working knowledge of one memory model (Java JMM, C++ `std::memory_order`, or Go's memory model) — what `volatile`/`atomic`/happens-before mean.
- **Required:** Practical concurrency: threads, races, why "publish a partially-constructed object" is a bug.
- **Helpful but not required:** Exposure to an ORM (Hibernate/JPA, EF Core) and its lazy-loading behavior.
- **Helpful but not required:** Some compiler-pipeline intuition (passes, inlining, optimization).

You do **not** need to be a compiler engineer; you need to reason about what the analyzer guarantees and where you must intervene.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Strictness analysis** | A compiler analysis proving a function *always* forces an argument, so it can be evaluated eagerly (no thunk) without changing semantics. |
| **Demand analysis** | The modern generalization (GHC): infers *how much* and *whether* each argument is used (strictness + usage/cardinality). |
| **Worker/wrapper** | A GHC transformation that, using strictness info, splits a function into an unboxed strict "worker" and a thin "wrapper" — the payoff of strictness analysis. |
| **Lazy initialization** | Defer creating/computing a value until its first use; cache thereafter. The mainstream "lazy." |
| **Double-checked locking (DCL)** | An optimization: check the flag without a lock, lock only if unset, check again inside the lock. Notoriously broken without correct memory barriers. |
| **Happens-before** | The memory-model relation guaranteeing visibility of one thread's writes to another. Locks/`volatile`/atomics establish it. |
| **Safe publication** | Making a fully-constructed object visible to other threads without them seeing a half-built version. |
| **`Lazy<T>`** | (.NET) Thread-safe (configurable) lazy value. Java has `Supplier`-backed idioms; C++ has `std::call_once`. |
| **`sync.Once`** | (Go) Runs an initializer exactly once with correct memory ordering. The blessed lazy-init primitive. |
| **`Supplier<T>` / thunk param** | A deferred computation passed so the callee decides whether to run it (deferred logging, default values). |
| **Deferred (lazy) loading** | (ORM) Related entities/collections fetched only on access. Source of N+1 and detached-entity errors. |
| **N+1 query** | One query for parents, then one per parent for children — a lazy-loading performance disaster. |
| **`LazyInitializationException`** | (Hibernate) Accessing a lazy association after the persistence session closed. |
| **Memoization** | Caching a computed result so repeats are free. Lazy init is memoization keyed by "first access." |

---

## Core Concepts

### 1. Strictness Analysis: the Compiler Makes Laziness Affordable

If Haskell literally allocated a thunk for every sub-expression, it would be unusably slow. It isn't, because GHC runs **strictness analysis** (now subsumed by **demand analysis**). The analyzer proves facts like "`f` always forces its first argument" — meaning evaluating that argument *eagerly* before the call cannot change the program's result (it can only change *when* a guaranteed-to-happen evaluation occurs). Armed with that proof, the compiler:

- Skips the thunk: pass the argument by value (often *unboxed*, e.g. a raw `Int#` in a register rather than a boxed heap `Int`).
- Applies the **worker/wrapper** transform: a strict, unboxed "worker" does the real work; a thin "wrapper" preserves the lazy interface for callers.

This is why a well-written `foldl'`-based loop compiles to a tight, allocation-free machine loop despite the source being "lazy." The senior-level discipline of inserting `seq`/`!`/`foldl'` is, in part, *helping the analyzer* — a bang pattern is a guarantee the compiler can build on. Conversely, the analyzer **cannot** prove strictness when a function is *conditionally* strict (forces an argument on some branches but not others), or across module boundaries without inlining, or when laziness is genuinely needed. Those are exactly the spots where leaks survive and where you must intervene manually.

**Key insight:** strictness analysis recovers *performance* without changing *semantics* — it only evaluates eagerly what was *going to be evaluated anyway*. It can never make a non-terminating-if-lazy program terminate, nor vice versa. That semantic-preservation guarantee is what makes it safe to apply automatically.

### 2. Lazy Initialization Is the Mainstream "Lazy" — and It Has a Concurrency Problem

In Java/C#/C++/Go/Python services, you rarely write infinite streams. You constantly write **lazy initialization**: "build this expensive thing on first use, then reuse it."

```java
// Single-threaded: simple and correct.
private Config config;
public Config getConfig() {
    if (config == null) {
        config = loadConfig();   // expensive; runs once
    }
    return config;
}
```

This is fine — *until two threads call `getConfig()` simultaneously*. Both may see `config == null`, both call `loadConfig()`, and worse, one thread may publish a *partially constructed* `Config` that another thread reads via a stale/reordered view. Lazy init, the most common laziness in production, is a **safe-publication** problem in disguise.

### 3. Double-Checked Locking: the Famous Footgun

The "obvious" optimization — avoid locking on the hot path by checking twice — is the single most infamous concurrency bug in the field:

```java
// BROKEN before Java 5, and STILL broken without 'volatile'.
private static Singleton instance;
public static Singleton getInstance() {
    if (instance == null) {                 // (1) unlocked check
        synchronized (Singleton.class) {
            if (instance == null) {         // (2) locked check
                instance = new Singleton(); // (3) NOT atomic: allocate, construct, assign
            }
        }
    }
    return instance;
}
```

The bug: step (3) is not atomic. The compiler/CPU may **reorder** it to "assign the reference, *then* finish constructing." A second thread on the unlocked path (1) can see a non-null `instance` that points at a **half-built object**, and use it. The fix in Java is `private static volatile Singleton instance;` — `volatile` forbids the harmful reordering and establishes happens-before, so a non-null read sees a fully-constructed object. The general lesson: **lazy init across threads requires a memory barrier; the language's default visibility is not enough.**

Correct, idiomatic forms differ by language:

- **Java:** prefer the **initialization-on-demand holder** idiom (a static nested class loaded lazily by the JVM's class-init lock) — laziness and thread-safety for free, no `volatile` reasoning. Or `volatile` + DCL if you must.
- **C#:** `Lazy<T>` with `LazyThreadSafetyMode.ExecutionAndPublication` (the default) — correct DCL implemented for you.
- **C++:** `static` local initialization is guaranteed thread-safe since C++11 ("magic statics"), or `std::call_once` with `std::once_flag`.
- **Go:** `sync.Once` — `once.Do(init)` runs exactly once with correct ordering.

### 4. Deferred Logging and `Supplier<T>`: Conditional Cost

A pervasive professional use of laziness: **don't build the log message unless we'll actually log it.**

```java
// EAGER: buildExpensiveDump() runs even when DEBUG is disabled — wasted work.
log.debug("state: " + buildExpensiveDump());

// LAZY: the lambda (a Supplier / thunk) runs ONLY if DEBUG is enabled.
log.debug("state: {}", () -> buildExpensiveDump());   // SLF4J / Log4j2 lazy form
```

The `Supplier<String>`/lambda is a thunk; the logging framework forces it only after checking the level. This converts *unconditional* cost into *conditional* cost. The same pattern powers lazy default values (`getOrDefault(key, () -> expensiveDefault())`), lazy assertions, and feature-flag-gated work. The trade-off: a tiny allocation (the lambda) and slightly less readable call sites, in exchange for skipping expensive work on the common path.

### 5. ORM Lazy Loading: Laziness You Didn't Ask For

ORMs (Hibernate/JPA, EF Core) lazy-load associations by default: `order.getCustomer()` fires a query *on access*, not at fetch time. This is laziness as a *framework default*, and it produces two signature production failures:

- **N+1 queries:** loop over 100 orders, touch `order.getCustomer()` each iteration → 1 query for orders + 100 for customers. A latency catastrophe invisible in code review. Fix: eager `JOIN FETCH` / `Include()` / batch fetching when you know you'll need the association.
- **`LazyInitializationException` / detached entity:** access a lazy association *after* the session/`DbContext` closed (e.g. in the view layer) → the thunk has no DB connection to force against → crash. Fix: fetch within the session boundary, use DTOs/projections, or `Open Session in View` (with caveats).

The meta-lesson: **a framework's laziness decision becomes your latency and failure surface.** "Lazy by default" at the ORM layer is convenient and routinely the root cause of production incidents.

### 6. Eager vs. Lazy as an Architecture Decision

At system scale the choice is about *moving cost and failure in time and space*:

- **Eager** front-loads cost (startup, fetch, full materialization) → predictable steady-state latency, fail-fast at boot, higher startup time and memory, possible wasted work.
- **Lazy** defers cost to first use → fast startup, pay-as-you-go, but unpredictable first-hit latency ("cold start" spikes), surprise failures at the deferred moment (lazy DB call fails mid-request), and harder capacity planning.

Real systems mix both deliberately: eager-load the critical path and config at boot (fail fast, warm caches), lazy-load rarely-used or huge resources. Serverless cold starts, JIT warmup, connection-pool pre-warming, and CDN cache priming are all explicit *eager-vs-lazy* trade-offs at the infrastructure level.

---

## Real-World Analogies

**The compiler as an efficiency consultant.** Strictness analysis is a consultant who watches your lazy factory and notes: "you *always* end up building this part, every time — stop writing IOUs for it and just build it now." It only eliminates deferral that was guaranteed to resolve, so it never changes *what* gets built, only *when* — safely.

**The shared coffee machine (lazy init race).** First person to the office is supposed to brew the coffee, then everyone shares the pot. If two people arrive at once and both start brewing (no lock), you get two half-pots and chaos. Worse, someone grabs a cup *while it's still filling* (half-constructed object). The lock + barrier is "one person brews, and nobody drinks until the pot light is fully green."

**The lazy bartender (deferred logging).** You ask the bartender to "prepare an elaborate cocktail *if* a VIP shows up." If no VIP comes, the cocktail is never made — no wasted gin. The order (the `Supplier`) is cheap to give; the work is conditional.

**The ORM tourist (N+1).** A tourist who asks the guide one question, walks to the next exhibit, asks again, walks back — 100 round trips. The eager tourist asks for the whole tour script upfront (one `JOIN FETCH`). Same information, 100x fewer trips.

---

## Mental Models

**Model 1: Strictness analysis = "prove the deferral is pointless, then skip it."** The compiler only un-defers work that was certain to happen. Your `!`/`foldl'` annotations are hints that make the proof easier or fill gaps the analysis can't reach.

**Model 2: Lazy init = memoization keyed on first access, and first access is a race.** Every "compute once, cache" is a critical section. The question is always "what makes the first-access path correct under concurrency?" — and the answer is a memory barrier, by some name.

**Model 3: Laziness relocates cost and failure in spacetime.** Eager pins cost at point of definition/boot; lazy floats it to point of first use. Wherever you float it, that's where the latency spike and the failure now live. Design that location deliberately.

**Model 4: Default laziness is a liability you inherit.** ORM lazy loading, deferred LINQ, lazy IO — you didn't write the laziness, but you own its failure modes. Know your framework's defaults; they are architectural decisions made for you.

---

## Code Examples

### Thread-safe lazy init done right, four ways

```java
// Java: initialization-on-demand holder — lazy + thread-safe with NO volatile reasoning.
public final class Singleton {
    private Singleton() {}
    private static class Holder {                 // loaded lazily, on first getInstance()
        static final Singleton INSTANCE = new Singleton();   // JVM class-init lock guarantees once + safe publication
    }
    public static Singleton getInstance() { return Holder.INSTANCE; }
}
```

```java
// Java: correct double-checked locking when you need a non-static lazy field.
private volatile Config config;                   // volatile is mandatory
public Config getConfig() {
    Config c = config;                            // read volatile once into a local (perf)
    if (c == null) {
        synchronized (this) {
            c = config;
            if (c == null) {
                c = loadConfig();
                config = c;                       // volatile write: safe publication + ordering
            }
        }
    }
    return c;
}
```

```csharp
// C#: Lazy<T> implements correct, thread-safe DCL for you.
private static readonly Lazy<Config> config =
    new Lazy<Config>(LoadConfig, LazyThreadSafetyMode.ExecutionAndPublication);
public static Config Config => config.Value;       // computed once, on first access, safely
```

```go
// Go: sync.Once — exactly-once with correct memory ordering, no manual barriers.
var (
    once sync.Once
    cfg  *Config
)
func GetConfig() *Config {
    once.Do(func() { cfg = loadConfig() })          // runs init once; publishes safely
    return cfg
}
```

```cpp
// C++11+: "magic statics" — local static init is thread-safe by the standard.
Config& getConfig() {
    static Config config = loadConfig();   // initialized once, thread-safely, on first call
    return config;
}
```

### The broken DCL, annotated (what NOT to ship)

```java
private static Singleton instance;                 // ✗ NOT volatile
public static Singleton getInstance() {
    if (instance == null) {                        // unlocked read can see a half-built object
        synchronized (Singleton.class) {
            if (instance == null) {
                instance = new Singleton();        // allocate→assign-ref→construct may reorder
            }
        }
    }
    return instance;                               // another thread may use a partially-constructed Singleton
}
```

### Deferred logging with `Supplier`

```java
// Skip the expensive dump entirely when DEBUG is off.
logger.atDebug().log(() -> "snapshot=" + buildExpensiveSnapshot());

// Same idea for a lazy default that's costly to compute:
String value = cache.computeIfAbsent(key, k -> expensiveCompute(k));   // thunk runs only on miss
```

### ORM: the N+1 trap and the eager fix

```java
// N+1: 1 query for orders, then 1 per order for customer (lazy association).
for (Order o : orderRepo.findAll()) {
    process(o.getCustomer().getName());   // each .getCustomer() may fire a query
}

// Fix: eager fetch in a single join.
@Query("SELECT o FROM Order o JOIN FETCH o.customer")
List<Order> findAllWithCustomers();        // one query, no N+1
```

```java
// LazyInitializationException: touching a lazy association after the session closed.
Order o = orderRepo.findById(id).orElseThrow();   // session opens and closes here
// ... later, outside any session ...
o.getItems().size();   // ✗ throws: no session to force the lazy collection
// Fix: fetch items inside the transaction, or return a DTO with items already loaded.
```

---

## Pros & Cons

**Lazy initialization (production) — pros**

- **Fast startup / pay-on-use** — skip building things never touched this run.
- **Memoization for free** — the "once" semantics cache the expensive result.
- **Lower baseline memory** when many resources go unused.

**Lazy initialization — cons**

- **Concurrency correctness is hard** — DCL footguns, safe-publication, memory barriers.
- **First-hit latency spikes** — the deferred cost lands on an unlucky request (cold start).
- **Failure moves to first use** — a config/DB failure surfaces mid-request, not at boot (no fail-fast).

**Deferred logging / `Supplier` APIs — pros/cons**

- **Pro:** converts unconditional expensive work into conditional work; big win on hot paths with disabled logging.
- **Con:** tiny allocation + readability cost; misuse (capturing mutable state in the thunk) reintroduces closure traps.

**ORM lazy loading — pros/cons**

- **Pro:** convenient object graphs without manual joins; load only what you touch.
- **Con:** N+1 query explosions and `LazyInitializationException`; a framework default that becomes your incident.

**Strictness analysis (compiler) — pros**

- **Recovers most of laziness's runtime cost automatically**, preserving semantics; enables tight, unboxed loops.
- **Con (for you):** it's invisible and incomplete — where it fails (conditional strictness, cross-module), leaks survive and you must annotate.

---

## Use Cases

- **Lazy singletons / config / connection factories:** build once on first use; pick the language's *correct* primitive (`Lazy<T>`, holder idiom, `sync.Once`, magic statics), never hand-rolled DCL.
- **Hot-path logging/metrics:** use `Supplier`/lambda forms so disabled levels cost nothing.
- **Expensive optional resources:** lazy-load big in-memory indexes, ML models, report generators that most requests never need.
- **Eager-load the critical path:** config, auth keys, schema validation, primary connection pool — fail fast at boot, warm caches before serving traffic.
- **ORM:** lazy-load by default *only* with eyes open; switch to eager `JOIN FETCH`/`Include` wherever you iterate associations or cross a session boundary.

---

## Coding Patterns

**Pattern: never hand-roll lazy init across threads.** Use `Lazy<T>` (C#), the holder idiom or `volatile`+DCL (Java), `sync.Once` (Go), `std::call_once`/magic statics (C++). These encapsulate the memory barrier correctly.

**Pattern: read a `volatile` field once into a local.** In correct DCL, cache the volatile read in a local to avoid re-reading it on the return path (a standard micro-optimization that also reads cleaner).

**Pattern: pass thunks for conditional cost.** Accept `Supplier<T>`/`Func<T>`/`() => T` for log messages, default values, and gated work, so the callee decides whether to force.

**Pattern: fetch-eager-at-the-boundary for ORMs.** When you'll iterate an association or use it outside the session, switch that path to eager fetch; keep lazy only for genuinely optional graph edges.

**Pattern: warm caches eagerly at startup.** For latency-critical lazy resources, *trigger* the lazy init at boot (a warmup call) so the first real request doesn't pay the cold cost.

**Pattern: help the strictness analyzer.** In lazy languages, annotate accumulators and hot fields strict (`!`, `foldl'`, strict data) so the compiler's worker/wrapper kicks in; profile to confirm.

---

## Best Practices

- **Treat every "compute once on first use" as a critical section.** Ask "is the first-access path thread-safe and safely published?" and reach for a vetted primitive.
- **Banish hand-rolled double-checked locking** unless you can recite the memory-model reason `volatile`/barrier is required — and even then, prefer the holder idiom / `Lazy<T>` / `sync.Once`.
- **Use lazy logging on hot paths**, but keep the thunk pure and capture-safe (no mutable shared state).
- **Audit ORM fetch plans.** Profile queries; hunt N+1 with query logging; fetch eagerly where you iterate; never let lazy associations escape the session.
- **Decide eager vs. lazy by where you want cost and failure to land.** Front-load the critical path (fail fast, predictable latency); defer the rarely-used and the huge.
- **Warm critical lazy resources at startup** to avoid first-request latency cliffs.
- **In lazy languages, profile the heap** and add strictness where demand analysis can't reach; don't assume the compiler caught every leak.
- **Document laziness at API boundaries.** If you return a deferred query, a generator, or a lazily-loaded entity, say so — the caller owns its failure modes.

---

## Edge Cases & Pitfalls

**Pitfall 1: DCL without a barrier.** The classic. Non-`volatile` (Java) / non-`atomic` (C++ pre-magic-statics, or manual flags) DCL can publish a half-constructed object. Use the holder idiom / `Lazy<T>` / `sync.Once` / `std::call_once`.

**Pitfall 2: `volatile` on the *wrong* thing.** Marking the *flag* volatile but not the *reference*, or assuming `volatile` makes compound operations atomic (it doesn't), reintroduces the race.

**Pitfall 3: the lazy-init exception is cached too.** Some lazy primitives cache a *thrown exception* — the first failed init permanently fails every future access (`Lazy<T>` default `ExecutionAndPublication` does this). If init can transiently fail, choose a mode/primitive that allows retry, or handle it explicitly.

**Pitfall 4: ORM N+1 hidden behind clean code.** A `.map(o -> o.getCustomer().getName())` reads beautifully and fires 100 queries. Only query logging / profiling reveals it. Eager-fetch where you iterate.

**Pitfall 5: `LazyInitializationException` from layering.** Returning entities to a view/controller after the session closes forces a lazy association with no connection. Use DTOs/projections or fetch within the transaction.

**Pitfall 6: cold-start latency from deferral.** Lazy init + a request-time first hit = a latency outlier exactly when a user is waiting. Warm at startup for latency-critical paths.

**Pitfall 7: strictness annotations that change semantics.** Forcing a value that the program *legitimately* needs to leave un-evaluated (an infinite structure, a `⊥` in an unused slot) can turn a working program into a hang/crash. Strictness is safe only where the value was going to be forced anyway.

**Pitfall 8: capturing mutable state in a deferred thunk.** A `Supplier` log message that reads a field which mutates before the thunk is forced logs the *wrong* value — the closure trap, at production scale.

---

## Test Yourself

1. What does strictness/demand analysis prove, and why is it always safe to apply? What can it *not* recover?
2. Walk through exactly why non-`volatile` double-checked locking can hand out a half-constructed object.
3. Give the *correct* thread-safe lazy-init primitive for Java, C#, Go, and C++ — and say what guarantees each one provides.
4. Why is the initialization-on-demand holder idiom often preferred over `volatile`+DCL in Java?
5. What is the N+1 query problem, how does ORM lazy loading cause it, and how do you fix it?
6. Why does `LazyInitializationException` happen, and what does it tell you about where laziness's failure surface lives?
7. You front-load nothing and lazy-init everything for "fast startup." Name two production failure modes this invites.
8. How can a deferred-logging `Supplier` log the *wrong* value, and how do you prevent it?

<details>
<summary>Answers</summary>

1. It proves a function *always* forces a given argument (and how much), so the compiler can evaluate it eagerly/unboxed (worker/wrapper) without changing results — safe because it only un-defers evaluation that was guaranteed to occur. It cannot recover cases of *conditional* strictness, cross-module laziness without inlining, or genuinely needed laziness; those still need manual `!`/`foldl'`.
2. `instance = new Singleton()` is allocate → assign-reference → run-constructor, and the compiler/CPU may reorder assign-reference *before* constructor completion. A second thread on the unlocked path sees a non-null reference pointing at a not-yet-constructed object and uses it. `volatile` forbids that reordering and establishes happens-before.
3. **Java:** holder idiom (JVM class-init lock → once + safe publication) or `volatile`+DCL. **C#:** `Lazy<T>` with `ExecutionAndPublication` (correct DCL implemented for you). **Go:** `sync.Once` (exactly-once + correct ordering). **C++:** function-local `static` (magic statics, thread-safe since C++11) or `std::call_once`.
4. It gets laziness *and* thread-safety from the JVM's guaranteed class-initialization lock, with no `volatile`/memory-model reasoning and no synchronization on the hot path — simpler and harder to get wrong.
5. N+1: one query loads N parents, then accessing a lazy association fires one query per parent (N more). Lazy loading triggers a query on each `.getChild()` access inside a loop. Fix: eager fetch in a single join (`JOIN FETCH` / `Include` / batch fetching) when you know you'll touch the association.
6. It happens when you access a lazy association after the persistence session/`DbContext` closed — the thunk has no connection to force. It shows that laziness *relocates the failure to the point of first use*, which may be a layer (the view) far from where the entity was loaded.
7. Cold-start/first-hit latency spikes (the deferred cost lands on a live request) and loss of fail-fast (a bad config/DB only surfaces mid-request instead of at boot, often under load).
8. The thunk captures a *variable/field* that mutates between creation and forcing, so when the framework forces it (after the level check), it reads the changed value. Prevent it by capturing immutable snapshots (copy the value into a final local) and keeping the thunk pure.

</details>

---

## Cheat Sheet

```text
STRICTNESS / DEMAND ANALYSIS:
  proves "always forces arg X" → eval eagerly, unboxed (worker/wrapper)
  semantics-preserving; recovers perf automatically
  FAILS on: conditional strictness, cross-module no-inline → you annotate (! / foldl')

LAZY INIT ACROSS THREADS — use the vetted primitive, never hand-rolled DCL:
  Java   holder idiom  OR  volatile + DCL (read volatile into a local)
  C#     Lazy<T> (ExecutionAndPublication)
  Go     sync.Once  →  once.Do(init)
  C++    function-local static (magic statics, C++11+)  OR  std::call_once

BROKEN DCL:
  non-volatile field → reorder publishes HALF-CONSTRUCTED object → barrier required

DEFERRED LOGGING:
  log.debug(() -> expensive())   ← thunk forced only if level enabled
  ⚠ don't capture mutable state in the thunk (closure trap)

ORM LAZY LOADING (framework default = your failure surface):
  N+1: loop + .getChild() → 1 + N queries → fix: JOIN FETCH / Include
  LazyInitializationException: access after session closed → fetch in tx / use DTOs

EAGER vs LAZY = move cost & failure in time/space:
  eager → slow boot, fail-fast, predictable latency, maybe wasted work
  lazy  → fast boot, pay-on-use, cold-start spikes, failure at first use
  mix: eager critical path + warm caches; lazy the rare & huge
```

---

## Summary

At production scale, three forces reshape laziness. First, the **compiler** makes pervasive laziness affordable through **strictness/demand analysis**: it proves which arguments are always forced and evaluates them eagerly (unboxed, via worker/wrapper) without changing semantics — recovering most of the runtime cost automatically, while leaving conditional-strictness and cross-module gaps for you to annotate. Second, **concurrency** turns the mainstream form of laziness — *lazy initialization*, "compute once on first use" — into a safe-publication problem. Hand-rolled **double-checked locking** is the field's most infamous footgun: without a memory barrier it can publish a half-constructed object. The correct answers are language-specific vetted primitives: Java's initialization-on-demand holder (or `volatile`+DCL), C#'s `Lazy<T>`, Go's `sync.Once`, C++'s magic statics / `std::call_once`. Third, laziness becomes an **observability, latency, and failure** property: deferred logging via `Supplier`/lambda converts unconditional cost into conditional cost; ORM lazy loading — a *framework default* — silently produces N+1 query storms and `LazyInitializationException` when associations escape the session.

The through-line is that **laziness relocates cost and failure in spacetime**. Eager evaluation front-loads cost (slower boot, more memory, possible waste) in exchange for fail-fast behavior and predictable steady-state latency. Lazy defers cost to first use (fast boot, pay-as-you-go) at the price of cold-start latency spikes and failures that surface mid-request rather than at startup. Mature systems mix the two on purpose: eager-load and warm the critical path so it fails fast and runs predictably, lazy-load the rarely-used and the enormous — and, crucially, use the *right* primitive whenever the deferred work is shared across threads. The discipline that began at the junior level with "know which bracket you wrote" ends here as "know where you want the cost, the failure, and the memory barrier to live."

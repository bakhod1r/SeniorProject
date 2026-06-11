# Refactoring Toward Structural Patterns — Professional Level

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/structural-patterns](https://refactoring.guru/design-patterns/structural-patterns)

Structural patterns buy flexibility with **indirection**, and indirection is never free. A Decorator chain is a chain of virtual calls and allocations. A Composite traversal is pointer-chasing across the heap. A Proxy adds a hop on every access. A Flyweight trades CPU (pool lookups) for memory. This file is about the *bill*: how to measure it, when the structural indirection earns its cost, and — the under-taught half — when to **inline the pattern back out** because the cost outweighs the flexibility you're not using. The mirror of "refactor to patterns" is [Refactoring Away From Patterns](../05-refactoring-away-from-patterns/junior.md).

---

## Contents

- [Decorator call-chain overhead](#decorator-call-chain-overhead)
- [Composite traversal cost on large trees](#composite-traversal-cost-on-large-trees)
- [Flyweight memory wins, measured](#flyweight-memory-wins-measured)
- [Proxy latency and caching](#proxy-latency-and-caching)
- [Allocation patterns and object churn](#allocation-patterns-and-object-churn)
- [When the indirection is too costly: inline it](#when-the-indirection-is-too-costly-inline-it)
- [A measurement checklist](#a-measurement-checklist)
- [Next](#next)

---

## Decorator call-chain overhead

Each layer in a Decorator stack is one more virtual dispatch and one more stack frame per call. `new D3(new D2(new D1(base)))` turns one logical `render()` into four method invocations.

**What it actually costs.** On the JVM, a megamorphic call site (the decorator's `wrappee.render()` where `wrappee` could be many types) defeats inlining and can cost on the order of a few nanoseconds per hop versus a fraction of a nanosecond for an inlinable call. For a 5-deep chain called once per request, this is noise. For a 5-deep chain called **inside a hot loop millions of times per second**, it's measurable: you've turned one inlinable call into five non-inlinable ones, plus you've defeated the JIT's ability to fold the whole operation.

**The amplifier is the loop, not the chain.** A decorator wrapping a per-frame render is fine. A decorator wrapping `compare()` inside a sort of 10M elements is not — the chain runs `O(n log n)` times.

**Mitigations before you abandon the pattern:**
- Keep chains shallow. A 3-deep stack is a design; a 12-deep stack is a smell.
- Make the wrappee field `final` and the chain monomorphic where possible so the JIT can speculate.
- If a particular *combination* is hot and stable, collapse that combination into one class (see [inlining](#when-the-indirection-is-too-costly-inline-it)) and keep decorators for the cold, varied paths.

**Benchmark, don't guess.** Use JMH; micro-timing with `System.nanoTime()` lies because of JIT warmup and dead-code elimination. See [profiling-techniques](../../../../#) for harness setup discipline.

---

## Composite traversal cost on large trees

A Composite walk is recursion over heap-scattered nodes. Two costs dominate:

1. **Cache misses from pointer chasing.** Each `child.accept()` / `child.totalSize()` dereferences a reference that may live anywhere on the heap. A tree of 10M nodes has terrible spatial locality compared to a flat array — every step is a potential L1/L2 miss. This, not the virtual call, is usually the real tax on large trees.
2. **Stack depth.** Deep or skewed trees risk `StackOverflowError` on recursive traversal. A linked-list-shaped "tree" 100k deep blows the stack. Convert to an explicit-stack iterative walk for unbounded depth.

**When the tree is large and hot:**
- **Memoize aggregates.** If `totalSize()` is read far more than the tree mutates, cache it on each composite node and invalidate on `add`/`remove`. You turn repeated `O(n)` walks into `O(1)` reads at the cost of invalidation discipline.
- **Flatten for read-heavy passes.** If you traverse the whole tree repeatedly for analytics, materialize a flat `List<Node>` (or a struct-of-arrays) once and iterate that — contiguous memory, prefetcher-friendly. Keep the Composite for *mutation*, the flat array for *bulk reads*.
- **Iterative + explicit stack** for depth safety and to avoid frame overhead.

**Caveat:** memoized aggregates add a cache-coherence problem. If the tree mutates often, invalidation churn can cost more than it saves — measure the read/write ratio first.

---

## Flyweight memory wins, measured

Flyweight's whole justification is a memory number, so measure that number.

**The model.** Suppose `N` logical objects, of which only `K` distinct intrinsic values exist (`K ≪ N`). Without Flyweight you allocate `N` objects. With Flyweight you allocate `K` shared objects plus `N` lightweight references/extrinsic carriers.

**Worked estimate.** A document with `N = 5,000,000` glyphs over `K = 95` printable ASCII chars × a few fonts (say 300 distinct `Glyph`s). Each `Glyph` holds a `char` + a `Font` reference + object header ≈ 24–32 bytes.
- **Without Flyweight:** ~5M × 32 B ≈ **160 MB** just for glyph objects.
- **With Flyweight:** 300 × 32 B ≈ **10 KB** for the pool; the 5M positions live in the layout you needed anyway.
- **Reduction: ~160 MB → ~kilobytes** for the glyph state. The order-of-magnitude is the point; verify with a real heap dump (`jmap` / a profiler), because object layout and padding vary by JVM.

**The CPU side of the trade.** Every object acquisition is now a pool lookup (`map.computeIfAbsent`). That hashing/locking cost is paid `N` times. So Flyweight is a **memory-for-CPU trade**:
- It wins decisively when memory is the binding constraint (you were OOM-ing or thrashing GC).
- It can *lose* if the pool's concurrent access becomes a contention hotspot — a synchronized factory called from many threads serializes object creation. Use a concurrent map or per-thread pools.

**Don't apply Flyweight when** the objects aren't actually duplicated at scale (`K ≈ N`), or when the intrinsic state can't be made immutable cheaply. A 95%-distinct population gets no sharing and only pays the lookup tax.

---

## Proxy latency and caching

A Proxy adds one indirection on every call. For a **virtual (lazy) proxy** the cost profile is asymmetric:

- **First access:** pays the full construction cost it was deferring — a latency *spike*. If the heavy object is loaded lazily on a request path, the unlucky first request eats the whole bill. For latency-sensitive paths, consider warming the proxy off the hot path (eager init in the background) so no user request pays the spike.
- **Subsequent accesses:** a null-check and a delegate — negligible.

For a **caching proxy**, the proxy *is* the optimization: it converts repeated expensive calls into cheap memoized hits. The professional concerns are the usual cache concerns — **invalidation** (stale data correctness), **memory bound** (an unbounded cache is a leak; use an LRU/size cap), and **stampede** (many threads missing the same key at once all recompute — guard with single-flight). See [caching-strategies](../../../../#) for the patterns.

**Concurrency tax.** The lazy-init `if (real == null) real = build();` is a data race. The thread-safe fix (double-checked locking with a `volatile` holder, or an `AtomicReference`, or the initialization-on-demand holder idiom) adds a memory barrier or a synchronized region — small, but real, and on *every* access for some implementations. Don't pretend lazy proxies are free under concurrency.

---

## Allocation patterns and object churn

Structural patterns are allocation-heavy by nature; on managed runtimes that means GC pressure.

- **Decorator** allocates one wrapper object per layer per *instance*. If you wrap freshly per request — `new LoggingDecorator(new ...)` on every call — you allocate the whole chain each time. Build chains **once** and reuse them when the wrapped state is stateless; only re-wrap when per-instance state demands it.
- **Composite** allocates a node per tree element plus the backing `List`. Building a 10M-node tree is 10M+ allocations and the GC roots to match. If the tree is transient (built, queried once, discarded), consider whether you need objects at all or whether a flat parsed representation suffices.
- **Adapter / Proxy** are usually one wrapper per adaptee — cheap, unless created in a loop.

**The repeated-wrapping anti-pattern:** wrapping the same base in a fresh decorator chain inside a hot loop. You pay `N` chain allocations for `N` iterations. Hoist the wrapping out of the loop.

---

## When the indirection is too costly: inline it

This is the half nobody teaches. A structural pattern is justified by **flexibility you actually use**. When you're paying the indirection cost but not using the flexibility, the honest move is to **inline the pattern back out** — Kerievsky's *Inline Singleton*, *Replace Decorator with simpler code*, etc., catalogued in [Refactoring Away From Patterns](../05-refactoring-away-from-patterns/junior.md).

Inline when **all** of these hold:

1. **The flexibility is unused.** Only one decorator ever wraps; the Composite tree is always exactly one level; the Proxy's "control" never triggers; the Bridge's second axis never grew. You're paying for variation that didn't happen.
2. **The path is hot.** The indirection runs in an inner loop or a latency-critical request, and a profiler shows the call/allocation cost is material — *measured*, not assumed.
3. **Inlining is reversible.** You can re-extract the pattern later if the flexibility need returns. Pattern ⇄ inlined is a refactoring round-trip, not a one-way door.

**Concretely:** if `BorderDecorator` is the *only* decorator ever applied and `render()` is in a 60fps loop, fold the border into the component and delete the decorator machinery. If a `Gateway` Adapter has exactly one implementation and always will, inline the translation into the client.

**The discipline:** inline because of a *measurement and an unused-flexibility observation*, never because "patterns are over-engineering" as a slogan. The pattern was correct when the flexibility was plausible; you're removing it because the future it anticipated didn't arrive.

---

## A measurement checklist

Before adding or removing structural indirection for performance reasons:

- [ ] **Profile first.** Confirm the structural code is actually on the hot path. Most decorator/composite overhead is irrelevant because it runs cold.
- [ ] **Use a real benchmark harness** (JMH) with warmup; reject `nanoTime()` micro-benchmarks.
- [ ] **Measure the trade, not just one side.** Flyweight: memory saved *and* lookup cost added. Caching proxy: latency saved *and* invalidation/memory cost added.
- [ ] **Check the loop multiplier.** A 5-call chain is fine once-per-request, fatal once-per-element in a billion-element pass.
- [ ] **Heap-dump Flyweight claims.** Verify the `K ≪ N` assumption with real distinct-value counts.
- [ ] **Quantify GC.** Watch allocation rate and pause times before/after; structural patterns often regress these silently.
- [ ] **Decide reversibly.** Whether you add or inline, keep the round-trip cheap so a future measurement can flip the decision.

---

## Next

- [junior.md](junior.md) — Decorator and Composite basics.
- [middle.md](middle.md) — One/Many Composite, Extract Composite, Adapter refactorings.
- [senior.md](senior.md) — Composite + Visitor, Decorator invariants, Bridge, Proxy, Flyweight, interface design.
- [interview.md](interview.md) — Interview Q&A.
- [tasks.md](tasks.md) — Hands-on exercises.
- [find-bug.md](find-bug.md) — Diagnose broken structural patterns.
- [optimize.md](optimize.md) — Propose (or reject) structural refactorings.

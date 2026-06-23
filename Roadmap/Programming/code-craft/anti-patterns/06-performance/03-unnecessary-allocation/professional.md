# Unnecessary Allocation — Professional Level

> **Category:** [Performance Anti-Patterns](../README.md) → **Unnecessary Allocation** — *throwaway objects, boxing, and copies churned in a hot path.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Why Allocation Rate Drives GC CPU](#why-allocation-rate-drives-gc-cpu)
4. [GC Models and What They Punish](#gc-models-and-what-they-punish)
5. [Stack vs Heap: Escape Analysis Pitfalls](#stack-vs-heap-escape-analysis-pitfalls)
6. [Layout, Cache, and False Sharing](#layout-cache-and-false-sharing)
7. [When Pooling Backfires](#when-pooling-backfires)
8. [Arenas and Value-Type Approaches](#arenas-and-value-type-approaches)
9. [Benchmarking Allocation Honestly](#benchmarking-allocation-honestly)
10. [A Thousand Cuts vs One Hot Allocation](#a-thousand-cuts-vs-one-hot-allocation)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Deep mechanics and trade-offs** — how the GC turns allocation rate into CPU, why escape analysis fails, when pooling makes things worse, and how to benchmark allocation without lying to yourself.

The senior file gave you the workflow: profile, explain via escape analysis, fix, re-profile. This file gives you the **mechanism underneath** — the part that lets you reason about a fix *before* you run it, predict whether the GC will even notice, and recognize the cases where the "obvious" cure (a pool, an arena) is a net loss.

The throughline: **allocation is not expensive because `new` is slow.** Bump-pointer allocation into a thread-local buffer is a handful of instructions. Allocation is expensive because of what comes *after* it — the garbage it creates, the collector cycles that garbage triggers, and the cache and layout effects of churning memory. To optimize allocation well, you reason about the GC and the memory system, not the allocator.

> **Professional framing:** the question is never "does this allocate?" — almost everything allocates. The question is "does this allocation, *at this rate*, cost more GC CPU / latency than the clarity of leaving it alone?" That requires modeling the collector.

---

## Prerequisites

- **Required:** [`senior.md`](senior.md) — allocation profiling, escape analysis, `sync.Pool` and its dangers.
- **Required:** Comfort reading GC logs / GC telemetry and a profiler's allocation view.
- **Helpful:** A mental model of CPU cache hierarchy (L1/L2/L3, cache lines) — the layout section depends on it.
- **Helpful:** The `profiling-techniques`, `memory-leak-detection`, and `big-o-analysis` skills.

---

## Why Allocation Rate Drives GC CPU

A tracing GC's cost is dominated by the **mark** phase: it walks the live object graph. The key, counter-intuitive fact:

> **A tracing GC pays for *live* (surviving) data, not for garbage.** Dead objects cost (almost) nothing to collect — they're simply not marked, and the space is reclaimed wholesale.

So why does *allocation* matter if dead objects are cheap? Because **allocation rate sets how often the collector must run.** A region of memory (Go's heap, the JVM's eden) fills at the allocation rate; when it fills, a collection triggers. The faster you allocate, the more collections per second, and each collection pays the mark cost over whatever is live at that moment.

The standard model (Go and generational JVMs both approximate it):

```text
GC CPU fraction  ≈  (collection frequency) × (mark cost per collection)
collection frequency  ∝  allocation rate / heap headroom
mark cost  ∝  live set size
```

Two levers fall out of this, and they're the two things you can actually tune:

1. **Lower the allocation rate** → fewer collections → less total mark work. *This is what reducing unnecessary allocation does.*
2. **Increase heap headroom** (Go's `GOGC` / soft memory limit; JVM heap size) → each collection happens later, amortizing mark cost over more allocation — at the cost of a bigger resident heap.

This is why the fix for "GC is eating 30% of CPU" is often **allocate less**, not "tune the GC harder." You're reducing the *input* to the cost formula instead of trading memory for it.

---

## GC Models and What They Punish

Different collectors charge for allocation differently. Knowing which one you're under tells you what to optimize.

### Go — concurrent, non-generational, non-moving mark-sweep

Go's GC runs concurrently with the program, targeting low pause times (sub-millisecond) rather than maximum throughput. Consequences for allocation:

- It is **non-generational**: every collection marks the *whole* live set, so a large live set is expensive every cycle (no "cheap young collection" to lean on).
- It is **non-moving**: no compaction, so allocation goes through size-class free-lists (`mcache`/`mcentral`/`mheap`), and fragmentation is possible.
- The **pacer** schedules GC by allocation rate against `GOGC` (default 100 → collect when heap doubles). A high allocation rate makes the pacer run GC more often, stealing CPU from your goroutines and possibly triggering *assist* (mutators forced to help mark).
- **Takeaway:** in Go, cutting allocation rate directly cuts GC-assist and collection frequency. Because it's non-generational, keeping the *live set* small matters too.

### JVM — generational

HotSpot's collectors exploit the **weak generational hypothesis**: most objects die young. New objects go in **eden**; a **minor GC** copies the few survivors out and reclaims eden wholesale — very cheap *if* most objects are dead. The danger is objects that **survive** eden:

- **G1** (default since Java 9): region-based, mostly-concurrent, balances pause-time goals. Allocation that survives gets copied; high promotion → more expensive mixed collections.
- **ZGC / Shenandoah**: concurrent, *compacting*, sub-millisecond pauses even on huge heaps — but they trade CPU/memory for that. They tolerate high allocation rates better but don't make allocation *free*.
- **Parallel/Throughput GC**: maximizes throughput with stop-the-world pauses; best when you can afford pauses and want raw speed.
- **Takeaway:** on the JVM, a *short-lived* allocation that dies in eden is cheap (that's the design). The expensive allocation is the one that **escapes eden** — promoted to survivor/old, scanned repeatedly, eventually collected by a costlier old/mixed GC. So "reduce allocation" on the JVM specifically means "reduce *promotion*" — kill the objects that survive.

> **The cross-runtime lesson:** Go punishes high allocation *rate* and large *live set* (non-generational). The JVM punishes *promotion* (surviving objects). Same anti-pattern, slightly different cost center — and both reward fewer unnecessary objects.

---

## Stack vs Heap: Escape Analysis Pitfalls

Escape analysis is what lets an allocation cost *nothing* — a stack value is freed by the return instruction. But it's a static, conservative analysis, and seniors who rely on it get surprised. The pitfalls:

- **Conservatism.** When the analyzer *can't prove* a value doesn't escape, it assumes it does. An interface call it can't devirtualize, a slice whose size it can't bound, a closure it can't fully track — all force heap allocation even when, dynamically, the value never actually escapes.
- **It's fragile to refactoring.** A value that stayed on the stack can start escaping after an innocent change — extracting a helper that takes a pointer, adding a `fmt.Println` for debugging (`interface{}` boxing), or storing the value in a field for "convenience." Escape decisions are **not stable across edits**; that's why you re-check `-gcflags=-m` after touching a hot path.
- **Inlining gates it.** In both Go and the JVM, escape analysis is far more effective *after inlining* — once the callee's body is inlined, the compiler sees that the argument doesn't actually escape. A function too big to inline (Go's inlining budget, JVM's `MaxInlineSize`) blocks the analysis. Keeping hot functions small isn't just readability; it enables stack allocation and scalar replacement.
- **JVM scalar replacement is all-or-nothing per object and JIT-tier dependent.** It only happens once C2 (or the relevant tier) compiles the method and proves non-escape; the *interpreted* and C1 warm-up runs still allocate. A microbenchmark that doesn't reach steady state will *see* allocations that vanish in production — a classic measurement trap (next section).
- **Partial escape analysis** (present in Graal, not stock HotSpot C2) can keep an object on the stack on paths where it doesn't escape and only heap-allocate on the path where it does. Stock HotSpot is all-or-nothing: one escaping path heap-allocates everywhere.

> **The pitfall summarized:** escape analysis is a *capability*, not a *guarantee*. You don't get to assume a value is stack-allocated; you *verify* it (`-gcflags=-m`, or JMH `gc.alloc.rate.norm == 0` at steady state) and re-verify after edits.

---

## Layout, Cache, and False Sharing

Allocation isn't only a GC concern — *how* you lay out memory determines cache behavior, and getting it wrong adds latency no GC tuning fixes.

- **Array-of-structs vs slice-of-pointers.** `[]Point` (values inline) is one contiguous allocation the CPU can prefetch and scan with perfect locality. `[]*Point` is N separate heap objects scattered across memory — N allocations *and* a cache miss per element when you iterate. Choosing value storage cuts both allocation count and cache misses. (Boxing — `List<Integer>` — is the same pathology: pointer-chasing across scattered heap objects.)
- **False sharing.** Two variables that different threads write, sitting on the *same cache line* (typically 64 bytes), force the cache-coherence protocol to ping-pong the line between cores even though the variables are logically independent. This can make "reuse one shared object across goroutines/threads" *slower* than per-thread allocation. Padding hot per-thread fields to separate cache lines is the cure — the mechanism and the measurements live in [coupling-and-state](../../02-design/02-coupling-and-state/professional.md).
- **The pooling/sharing trap.** A naive object pool can *introduce* false sharing: pooled scratch buffers handed to different threads may share a line, and a shared pool's internal counters are a contention hotspot. So "reuse to avoid allocation" can lose to "allocate per-thread" on a multicore box — exactly the kind of result only a benchmark reveals.

> **Layout is an allocation decision in disguise.** Picking value types over pointer-laden ones cuts allocation *and* improves locality; the two wins compound. This is why "use `int[]` not `List<Integer>`" beats "pool your `Integer`s."

---

## When Pooling Backfires

`sync.Pool` (and JVM object pools) are the cure of last resort precisely because they fail in non-obvious ways. The professional inventory of backfires:

| Failure mode | Mechanism | Symptom |
|---|---|---|
| **Allocator is faster than the pool** | Modern bump-pointer alloc + cheap young GC beats Get/Put/reset bookkeeping for small objects | Pooled version is *slower* in the benchmark |
| **Pool contention** | A shared pool's internal sync becomes the hotspot under high core count | Throughput drops as cores increase |
| **Retained garbage** | `Put`-ing oversized objects pins memory; pool defeats the GC's reclamation | RSS climbs, "leak" that isn't a leak |
| **Promotion (JVM)** | Pooled objects live long → promoted to old-gen → costlier old GC | Old-gen GC frequency rises |
| **Correctness** | Dirty/aliased reuse leaks data between users | Wrong/leaked data, security bug |
| **Complexity tax** | Every reader must now reason about lifetimes and reset | Bugs in *future* edits |

The decision rule: pool only objects that are **(a) genuinely expensive to create** (large buffers, objects with costly initialization — not small structs), **(b) provably hot** in the profile, and **(c)** where you've *measured* the pooled version beating the plain one on the target hardware and concurrency. On the JVM especially, the modern default is **don't pool small objects** — the generational GC is engineered to make their creation and reclamation cheap, and a pool just adds promotion pressure and bugs.

---

## Arenas and Value-Type Approaches

When allocation genuinely dominates and pooling is too fiddly, two structural approaches change the game:

- **Arena / region allocation.** Allocate many objects into one big region and free the *whole region* at once (e.g., per-request). This collapses thousands of individual allocations and their GC bookkeeping into one alloc and one free, and gives perfect locality. Go has an experimental `arena` package (GOEXPERIMENT); the manual version is "allocate a big `[]T`, hand out sub-slices, drop it all at request end." The hazard mirrors pooling: an escaped pointer into a freed arena is a use-after-free. Arenas trade GC safety for control and suit request-scoped, clearly-bounded lifetimes.
- **Value types / flattening.** Storing data *inline* instead of behind a pointer removes the allocation entirely. Go structs are value types by default; the lever is *not* taking their address and not boxing them into interfaces. The JVM is getting this via **Project Valhalla** value classes (objects with no identity that the JIT can flatten into their container — `Point[]` stored as raw fields, not pointers). Until then, the JVM workarounds are primitive arrays, struct-of-arrays layouts, and primitive-specialized collections. The principle is universal: **inline what you can, point to what you must.**

> Both techniques are "below the GC" — you're taking allocation management into your own hands. Justified in a serializer, a parser, or a per-request hot loop; over-engineering anywhere else.

---

## Benchmarking Allocation Honestly

A benchmark that lies about allocation is worse than none — it justifies bad changes. The professional checklist:

- **Steady state, not warm-up.** On the JVM, escape analysis/scalar replacement and JIT inlining only kick in after C2 compiles the hot method. Measure *after* warm-up (JMH `@Warmup` iterations); a cold measurement reports allocations that don't exist in production. In Go, `b.ResetTimer()` after setup excludes one-time allocation.
- **Defeat dead-code elimination (DCE).** If the result is unused, the compiler may delete the allocation you're trying to measure — reporting `0 allocs/op` for code that allocates in production. Consume the result: assign to a package-level sink (Go), `blackhole.consume()` / return it (JMH), or otherwise make it observable. A suspiciously perfect `0 allocs/op` is usually DCE, not a win.
- **Report allocations, not just time.** `-benchmem` / `b.ReportAllocs()` (Go), JMH `-prof gc` for `gc.alloc.rate.norm` (Java). `ns/op` alone hides allocation cost that's deferred into future GC cycles the microbenchmark never runs.
- **Realistic input size and shape.** The O(n²) of loop concatenation is invisible at n=8. Boxing's cost scales with element count. Benchmark near production sizes and with production-like data distributions.
- **Account for the GC the benchmark doesn't trigger.** A microbenchmark allocates fast but may finish before a full GC cycle, so it *undercounts* the real CPU cost. `gc.alloc.rate.norm` (bytes/op) is the honest cross-cutting number — it's independent of when the GC happens to run.
- **Pin the environment.** Allocation benchmarks are sensitive to `GOGC`/heap size, core count (for pool contention), and other processes. Hold them fixed and report them.

```go
// Go — honest allocation benchmark skeleton.
var sink []byte   // package-level → defeats DCE

func BenchmarkRender(b *testing.B) {
	in := makeRealisticInput()   // production-size
	b.ReportAllocs()
	b.ResetTimer()               // exclude setup allocation
	for i := 0; i < b.N; i++ {
		sink = render(in)        // result escapes to sink → not eliminated
	}
}
```

---

## A Thousand Cuts vs One Hot Allocation

Two genuinely different problems wear the same name, and they call for opposite responses:

- **One hot allocation** — a single site (the parser's per-token string, the serializer's buffer) accounts for most of the allocation profile. The profiler finds it instantly; you fix that *one* site and move on. High leverage, surgical.
- **Death by a thousand allocations** — no single site dominates; the whole codebase allocates a little everywhere, and the profile is *flat*. There's no hotspot to fix. The cure is cultural, not surgical: idioms that don't allocate by default (presized collections, value types, avoiding boxing, builders), enforced in review and linting — so the baseline allocation rate is low everywhere. You cannot profile your way out of this one; you prevent it.

The professional reads the *shape* of the allocation profile to know which game they're playing. A spiky profile → hunt the spike. A flat-but-high profile → the README's "death by a thousand cuts" — tighten the defaults across the codebase, because there's no single line to blame.

---

## Common Mistakes

1. **Thinking allocation is expensive because `new` is slow.** It's cheap; the cost is the GC cycles the resulting garbage triggers and the cache effects of churn. Optimize the *rate* and the *live/promoted set*, not the allocator.
2. **Tuning the GC instead of allocating less.** Bigger heap/`GOGC` buys headroom but raises RSS; reducing allocation attacks the root input to the cost formula.
3. **Assuming escape analysis is a guarantee.** It's conservative, inlining-gated, and fragile across edits. Verify with `-gcflags=-m` / `gc.alloc.rate.norm`, and re-verify after refactors.
4. **Benchmarking before warm-up / with DCE.** Cold JVM runs report phantom allocations; unused results get eliminated and report phantom zeros. Warm up; consume the result.
5. **Pooling small objects on the JVM.** The generational GC makes them cheap; a pool adds promotion pressure, contention, and bugs. Pool only expensive, hot, *measured-better* objects.
6. **Ignoring layout.** `[]*T` and `List<Integer>` lose to `[]T` and `int[]` on *both* allocation count and cache locality. Picking value storage is often the biggest single win.
7. **Treating a flat profile like a spiky one.** No hotspot means no surgical fix — the cure is low-allocation defaults across the codebase, not chasing a non-existent hot line.

---

## Test Yourself

1. A tracing GC "pays for live data, not garbage." Then why does reducing *allocation* reduce GC CPU?
2. Contrast what Go's GC punishes vs what a generational JVM GC punishes about allocation. How does that change what you optimize?
3. Give three reasons escape analysis might heap-allocate a value that, dynamically, never escapes.
4. Why can an object pool make a multicore service *slower*? Name two distinct mechanisms.
5. Your JMH benchmark reports `0 allocs/op` but the code clearly constructs objects. Give two explanations and how you'd distinguish them.
6. You profile and the allocation graph is *flat* — no site over 4%. What kind of problem is this, and why won't "fix the hotspot" work?
7. How does inlining interact with escape analysis, and what does that imply about hot-function size?

<details>
<summary>Answers</summary>

1. The GC's mark cost is paid per *collection*, and **allocation rate determines collection frequency** (a region fills at the allocation rate, triggering a GC). Less allocation → fewer collections → less total mark work, even though each individual dead object is cheap.
2. **Go** (non-generational, concurrent) punishes high allocation *rate* (more pacer-driven collections, GC-assist) and a large *live set* (whole set marked every cycle). **Generational JVM** punishes *promotion* — objects that survive eden get copied to old-gen and collected by costlier GCs; short-lived objects that die in eden are cheap by design. So on Go you cut rate and live set; on the JVM you specifically cut objects that *survive*.
3. Any three: the compiler **can't devirtualize** an interface/virtual call so it assumes the callee retains the arg; the value is **boxed into `interface{}`/`Object`**; a **closure captures** it; its **size isn't statically bounded**; the function is **too big to inline**, hiding the proof of non-escape.
4. (a) **Pool contention** — the shared pool's internal synchronization becomes a hotspot as cores increase. (b) **False sharing** — pooled buffers handed to different threads share a cache line, ping-ponging it between cores. (Also: the allocator + young GC may simply be faster than Get/Put/reset for small objects.)
5. (a) **Dead-code elimination** — the result is unused, so the compiler deleted the allocation; fix by consuming it (blackhole/sink) and the allocs reappear. (b) **Scalar replacement** — escape analysis flattened the non-escaping object so it's genuinely never allocated at steady state; this is real. Distinguish by making the result escape (return/sink it): if allocs reappear it was DCE; if they stay zero it's scalar replacement.
6. **Death by a thousand allocations** — the codebase allocates a little everywhere with no dominant site. "Fix the hotspot" fails because there is no hotspot. The cure is systemic: low-allocation defaults (presizing, value types, no boxing, builders) enforced in review/linting to lower the baseline everywhere.
7. Escape analysis is far more effective *after inlining* — once a callee is inlined, the compiler can see the argument doesn't actually escape and stack-allocate it. A function too large to inline (Go's budget, JVM `MaxInlineSize`) **blocks** that proof and forces heap allocation. Implication: keeping hot functions small isn't just readability — it enables stack allocation/scalar replacement.

</details>

---

## Cheat Sheet

| Concept | The professional point |
|---|---|
| **GC cost model** | `GC CPU ≈ frequency × mark cost`; allocation rate sets frequency. Allocate less to lower the input. |
| **Go GC** | Concurrent, non-generational, non-moving. Punishes allocation *rate* + large *live set*. |
| **JVM GC** | Generational. Punishes *promotion*; eden death is cheap. Reduce *surviving* objects. |
| **Escape analysis** | A conservative, inlining-gated *capability*, not a guarantee. Verify and re-verify. |
| **Layout** | `[]T`/`int[]` beat `[]*T`/`List<Integer>` on allocation *and* cache. Inline what you can. |
| **Pooling** | Last resort; backfires via contention, false sharing, retention, promotion, complexity. |
| **Arenas / value types** | Below-the-GC control for bounded lifetimes; use-after-free hazard. |
| **Honest benchmark** | Steady state, defeat DCE, report `gc.alloc.rate.norm`/`allocs/op`, realistic size. |

> **One rule:** reason about the *GC and the cache*, not the allocator. The cost of an allocation is everything that happens after it.

---

## Summary

- Allocation is cheap to *make* and expensive in *consequence*: it sets **GC collection frequency** (`GC CPU ≈ frequency × mark cost`), and a tracing GC pays for *live* data per cycle. Reducing allocation lowers the input to that formula — usually better than tuning the GC.
- **Go** (concurrent, non-generational) punishes allocation *rate* and large *live set*; the **JVM** (generational) punishes *promotion* — short-lived eden deaths are cheap by design. Optimize accordingly.
- **Escape analysis** is a conservative, inlining-gated capability, not a guarantee — fragile across edits, blocked by un-inlinable functions and undevirtualizable calls. Verify with `-gcflags=-m` / `gc.alloc.rate.norm`.
- **Layout is an allocation decision**: value storage (`[]T`, `int[]`) beats pointer storage (`[]*T`, `List<Integer>`) on both allocation count and cache locality, and naive pooling can *introduce* false sharing.
- **Pooling backfires** through contention, false sharing, retained garbage, JVM promotion, and complexity — reserve it for expensive, hot, *measured-better* objects. **Arenas and value types** give below-the-GC control for bounded lifetimes.
- **Benchmark honestly**: steady state, defeat DCE, report bytes/op (`gc.alloc.rate.norm`), realistic sizes — and read the profile's *shape* to tell **one hot allocation** (hunt it) from **death by a thousand cuts** (fix the defaults).

---

## Further Reading

- **Systems Performance** — Brendan Gregg (2nd ed., 2020) — memory subsystem, allocation rate, cache effects, and how to observe them in production.
- **Java Performance** — Scott Oaks (2nd ed., 2020) — generational GC, G1/ZGC trade-offs, TLABs, promotion, escape analysis & scalar replacement, JFR-based allocation analysis.
- **The Go Blog — escape analysis & "Getting to Go: the GC"** (go.dev/blog) — Go's concurrent non-generational collector, the pacer, and stack vs heap.
- **The Garbage Collection Handbook** — Jones, Hosking, Moss (2nd ed., 2023) — the definitive treatment of tracing, generational, and concurrent collection.

---

## Related Topics

- [Premature Optimization Traps](../01-premature-optimization-traps/professional.md) — the discipline of measuring before paying complexity for an allocation cure.
- [Coupling and State → false sharing / cache](../../02-design/02-coupling-and-state/professional.md) — object layout, cache lines, and the contention mechanics referenced throughout.
- [N+1 in Code](../02-n-plus-one-in-code/professional.md) — repeated work in a loop; the structural sibling that often co-occurs with allocation churn.
- [Wrong Data Structure](../04-wrong-data-structure/professional.md) — cost models where allocation and access pattern interact.
- [Architecture Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — when memory pressure becomes a system-design concern.
- The `profiling-techniques`, `memory-leak-detection`, and `big-o-analysis` skills.

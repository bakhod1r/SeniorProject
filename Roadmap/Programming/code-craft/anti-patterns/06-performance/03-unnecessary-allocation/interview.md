# Unnecessary Allocation — Interview Questions

> **Category:** [Performance Anti-Patterns](../README.md) → **Unnecessary Allocation** — *throwaway objects, boxing, and copies churned in a hot path.*

---

This file is a question bank for interviews — as the interviewee preparing and the interviewer probing depth. Questions run from junior recognition to staff-level judgment. Each has a model answer; the strongest answers tie back to **measure first**, the **GC cost model** (allocation rate → collection frequency), and the line between a free win (build a string once) and a complexity-laden last resort (`sync.Pool`).

> **How to use this file:** answer out loud *before* expanding. A weak answer says "allocation is slow." A strong answer explains *why* (GC pressure, not `new` itself), proves it with `allocs/op`, and knows when not to bother.

---

## Table of Contents

1. [Fundamentals](#fundamentals)
2. [String Building & Complexity](#string-building--complexity)
3. [Boxing](#boxing)
4. [Presizing](#presizing)
5. [Escape Analysis](#escape-analysis)
6. [`sync.Pool` & Reuse](#syncpool--reuse)
7. [Profiling & Measurement](#profiling--measurement)
8. [GC & Mechanics](#gc--mechanics)
9. [Judgment: When It Doesn't Matter](#judgment-when-it-doesnt-matter)
10. [Related Topics](#related-topics)

---

## Fundamentals

**Q1. What is the "unnecessary allocation" anti-pattern?**

<details><summary>Answer</summary>

Creating objects, buffers, or strings that the program immediately discards, in code that runs often enough that the *making and discarding* dominates the useful work. The key qualifier is "in a hot path" — the same code on a cold path is harmless. It's an anti-pattern only when the allocation churn is a measured cost.

</details>

**Q2. Is allocation expensive? Defend your answer.**

<details><summary>Answer</summary>

Per allocation, no — modern allocators bump a pointer into a thread-local buffer in a few instructions. What's expensive is the *consequence*: each allocation becomes garbage the GC must later reclaim, and the **allocation rate** determines how often the collector runs. "Cheap × a lot" is the cost. So allocation is expensive in *aggregate at high rate*, not per call.

</details>

**Q3. Why isn't the cure "allocate faster"?**

<details><summary>Answer</summary>

Because the bottleneck isn't the `new` instruction — it's GC cycles and cache churn driven by allocation *rate*. The cure is to **allocate fewer times** (build once, presize, reuse, avoid boxing, keep values on the stack), which lowers the rate and the live/promoted set. A faster allocator doesn't reduce the number of objects the GC must chase.

</details>

**Q4. Name the main forms of unnecessary allocation.**

<details><summary>Answer</summary>

Loop string concatenation; boxing primitives (`List<Integer>`, `interface{}`); growing a collection without presizing; defensive copies that aren't needed; re-creating a buffer each iteration instead of reusing it; intermediate collections in stream/list pipelines; allocating in a tight loop what could be hoisted out; values escaping to the heap that could stay on the stack.

</details>

**Q5. How is this different from N+1 in code?**

<details><summary>Answer</summary>

N+1 is repeated *work* in a loop (a call, query, or computation done per item that should be batched/hoisted). Unnecessary allocation is repeated *object creation* in a loop. They're structural siblings and often co-occur (an N+1 loop frequently allocates per iteration too), but the cure differs: batch the work vs. reduce the allocation.

</details>

---

## String Building & Complexity

**Q6. Why is `s = s + x` in a loop O(n²)?**

<details><summary>Answer</summary>

Strings are immutable, so `s + x` allocates a *new* string and copies all of `s` plus `x`. The copied prefix grows by one each iteration: `1+2+…+n = n(n+1)/2 = O(n²)`. It also creates *n* throwaway strings. The join itself is inherently O(n); the quadratic cost is the repeated re-copying of the growing prefix.

</details>

**Q7. What's the fix and what's its complexity?**

<details><summary>Answer</summary>

A builder: `strings.Builder` (Go), `StringBuilder` (Java), or `"".join(list)` (Python). It appends into a growable buffer in **amortized O(1)** per element, so the whole build is **O(n)** with a handful of allocations (one or two). Presizing the builder (`b.Grow(n)`, `new StringBuilder(n)`) takes it to a single allocation.

</details>

**Q8. Does Python's `s += x` in a loop suffer the same problem?**

<details><summary>Answer</summary>

Logically yes — strings are immutable. CPython has a *special-case optimization* that can make in-place-looking `s += x` amortized linear when the string has one reference, but it's an implementation detail you shouldn't rely on (it doesn't hold for all builds/patterns). The idiomatic, guaranteed-linear approach is to collect into a list and `"".join` once.

</details>

**Q9. Why can `fmt.Sprintf` in a hot loop be an allocation problem?**

<details><summary>Answer</summary>

`Sprintf` allocates for the formatted result *and* boxes each `...interface{}` argument (primitives escape to the heap when put into `interface{}`). In a hot path that's several allocations per call. The fix is a `strings.Builder` with `strconv` conversions. But on a cold path `Sprintf` is fine and far clearer — replace it only where a profile points.

</details>

---

## Boxing

**Q10. What is boxing, and why does `List<Integer>` allocate more than `int[]`?**

<details><summary>Answer</summary>

Boxing wraps a primitive in a heap object (`int` → `Integer`). `List<Integer>` stores *pointers to Integer objects* — one heap allocation per element, plus pointer-chasing on iteration. `int[]` is a flat contiguous block of raw ints — zero per-element objects and perfect cache locality. The difference is N allocations and many cache misses vs. one allocation and a linear scan.

</details>

**Q11. What is autoboxing and why is it dangerous?**

<details><summary>Answer</summary>

Autoboxing is the compiler silently converting `int ↔ Integer` at boundaries (`map.get(intKey)`, `Integer n = 5`). It's dangerous because the allocations are *invisible in the source* — code that looks primitive is boxing on every call. It also hides a correctness trap: `==` on boxed values compares identity, which "works" for the cached −128..127 range and breaks above it.

</details>

**Q12. Does Go have boxing?**

<details><summary>Answer</summary>

Not for numbers in the Java sense, but the equivalent is putting a value into an `interface{}`/`any` — that boxes it (the value escapes to the heap). `fmt.Println(x)`, `[]any{x}`, `sync.Map` storing primitives, and generic code that funnels through `any` all box. Generics with type parameters (Go 1.18+) avoid it for many cases.

</details>

**Q13. How do you avoid boxing in hot Java code?**

<details><summary>Answer</summary>

Use primitive arrays (`int[]`, `long[]`) instead of `List<Integer>`; use `IntStream`/`LongStream`/`DoubleStream` instead of `Stream<Integer>`; use primitive-specialized collections (Eclipse Collections, fastutil, HPPC) for primitive maps/sets; keep primitives local rather than storing them in `Object` fields. Verify with JMH `-prof gc` showing `gc.alloc.rate.norm` drop.

</details>

---

## Presizing

**Q14. Why does an un-presized slice/list reallocate, and how much does it cost?**

<details><summary>Answer</summary>

When the backing array fills, the collection allocates a larger one (typically ~2×), copies everything over, and discards the old array. For *n* appends from empty you pay ~log₂(n) reallocations and copy ~2n elements total — all avoidable if the final size is known. Presizing (`make([]T,0,n)`, `new ArrayList<>(n)`) makes it a single allocation.

</details>

**Q15. In Go, what's the difference between `make([]int, n)` and `make([]int, 0, n)`?**

<details><summary>Answer</summary>

`make([]int, n)` is length n, **prefilled with n zeros**; appending then adds *beyond* n and triggers growth. `make([]int, 0, n)` is length 0, capacity n; appending n items fits exactly with **no reallocation**. For "append n items," you want `0, n`. Mixing them up is a common subtle bug.

</details>

**Q16. Why presize a `HashMap`, and to what size?**

<details><summary>Answer</summary>

A map that outgrows its capacity **rehashes** — reallocating the whole table and redistributing entries, an expensive O(n) event. Presize from the known element count, accounting for the load factor: `new HashMap<>((int)(n / 0.75) + 1)` for Java's default 0.75 load factor (or `make(map[K]V, n)` in Go). This avoids the rehash storm during population.

</details>

**Q17. Is presizing ever risky?**

<details><summary>Answer</summary>

It's the *lowest*-risk allocation fix — no reuse contract, no pool, no aliasing. The only "risks" are trivial: presizing too large wastes a bit of memory, and presizing with the wrong API (`make([]T, n)` vs `0, n`) changes semantics. An *estimate* still helps even when the exact size is unknown.

</details>

---

## Escape Analysis

**Q18. What is escape analysis and what does it decide?**

<details><summary>Answer</summary>

A compile-time analysis that determines whether a value's lifetime is contained within its function. If it can prove the value doesn't escape, it lives on the **stack** (freed by the return, zero GC cost); if it escapes, it goes on the **heap**. Escape analysis is what makes some allocations cost literally nothing.

</details>

**Q19. How do you see Go's escape decisions?**

<details><summary>Answer</summary>

`go build -gcflags=-m` prints escape decisions ("moved to heap: x", "x does not escape"); `-gcflags="-m -m"` shows the reasoning chain. You use it to confirm a hot-path value stays on the stack and to diagnose *why* one escapes.

</details>

**Q20. Name common reasons a value escapes to the heap.**

<details><summary>Answer</summary>

Returning a pointer to a local; storing the value in an `interface{}`/`any` (boxing); capturing it in a closure that escapes; passing it through an interface call the compiler can't devirtualize; a slice/map whose size the compiler can't bound; the containing function being too big to inline (which blocks the proof of non-escape).

</details>

**Q21. Can you force a value to stay on the stack?**

<details><summary>Answer</summary>

Not directly — the compiler decides. The lever is to *remove the escape*: don't return its pointer, don't box it into `interface{}`, keep it local, keep the function small enough to inline. Stack allocation then follows automatically. "Force stack allocation" is the wrong mental model; "eliminate the escape" is right.

</details>

**Q22. What is the JVM's equivalent?**

<details><summary>Answer</summary>

HotSpot does escape analysis enabling **scalar replacement** — a non-escaping object's fields are kept in registers and the object is *never allocated*. It's on by default but only after the JIT (C2) compiles the hot method, so it appears only at steady state. You enable it the same way: don't let the object escape (no field storage, no return, no undevirtualizable polymorphic call). Project Valhalla value classes will extend this to flattenable value types.

</details>

---

## `sync.Pool` & Reuse

**Q23. When should you reach for `sync.Pool`?**

<details><summary>Answer</summary>

Last, after presizing and escape-removal fail — when a hot path repeatedly allocates the same *large, escaping* temporary (e.g., a 64 KB buffer per request) and the profile proves it dominates. Pool only objects expensive to create, provably hot, and where you've *measured* the pooled version beating the plain one on the target hardware.

</details>

**Q24. What are the dangers of `sync.Pool`?**

<details><summary>Answer</summary>

Dirty objects (`Get` returns whatever was `Put` — you must reset, or leak data across users — a security bug); retained garbage (`Put`-ing an oversized object pins memory — a "leak"); escape into the pool (a pooled object holding a pointer keeps the referent alive); it's not a cache (cleared on GC); contention/false sharing under concurrency; and the complexity tax on every future reader. Always measure it helped.

</details>

**Q25. Why might pooling make a service *slower*?**

<details><summary>Answer</summary>

For small objects the bump-pointer allocator plus a cheap young GC beats Get/Put/reset bookkeeping. Under high core count a shared pool's internal synchronization becomes a contention hotspot, and pooled buffers can suffer false sharing (different threads' objects on the same cache line). On the JVM, pooled objects survive long enough to be *promoted* to old-gen, defeating the generational GC. So pooling can lose on multicore — only a benchmark on the real hardware tells you.

</details>

**Q26. What's the rule for buffer reuse correctness?**

<details><summary>Answer</summary>

The previous contents must be **fully consumed before** the buffer is reused/overwritten, and you must reset it (`buf[:0]`, clear the struct). If anything downstream retains a reference past the iteration, you've created an aliasing bug — all the stored references point at the same buffer and show the last write. Reuse trades a small allocation win for a real lifetime obligation.

</details>

---

## Profiling & Measurement

**Q27. How do you make Go allocations visible in a benchmark?**

<details><summary>Answer</summary>

`go test -bench=. -benchmem` (or `b.ReportAllocs()`) reports `B/op` (bytes per op) and `allocs/op` (count per op). `allocs/op` is the primary signal for this anti-pattern; `ns/op` is the consequence and *understates* the cost because GC is deferred past the microbenchmark.

</details>

**Q28. Difference between `pprof -alloc_objects` and `-alloc_space`?**

<details><summary>Answer</summary>

`-alloc_objects` ranks sites by allocation *count* (finds GC-pressure / many-small-objects patterns; GC cost scales with object count). `-alloc_space` ranks by *bytes* (finds the single fat allocation). Check both — a high object count and a high byte count are different problems with different fixes.

</details>

**Q29. How do you profile allocation on the JVM and in Python?**

<details><summary>Answer</summary>

JVM: JMH with `-prof gc` for `gc.alloc.rate.norm` (bytes/op, the honest number) in benchmarks; JFR "Allocation by Class" or async-profiler in `alloc` mode for a flame graph by allocating call stack in production. Python: `tracemalloc` snapshots by line, or `memray` for a flame graph including native allocations.

</details>

**Q30. Your benchmark reports `0 allocs/op` for code that obviously constructs objects. Why?**

<details><summary>Answer</summary>

Two possibilities. (1) **Dead-code elimination** — the result is unused so the compiler deleted the allocation; fix by consuming it (a package-level sink / JMH blackhole) and the allocs reappear. (2) **Scalar replacement / stack allocation** — escape analysis proved non-escape and genuinely removed the allocation; this is real. Distinguish by forcing the result to escape: if allocs reappear it was DCE; if they stay zero it was legitimately optimized away.

</details>

**Q31. What makes an allocation benchmark *honest*?**

<details><summary>Answer</summary>

Steady state (warm up so JIT/escape analysis is active; `b.ResetTimer()` after setup); defeat DCE (consume the result); report allocations not just time (`gc.alloc.rate.norm`/`allocs/op`); realistic input size and distribution (O(n²) is invisible at n=8); and a pinned environment (`GOGC`/heap, core count). Bytes/op is the cross-cutting honest number since it's independent of when GC happens to run.

</details>

---

## GC & Mechanics

**Q32. A tracing GC "pays for live data, not garbage." Then why does reducing allocation help?**

<details><summary>Answer</summary>

Because **allocation rate sets collection frequency** — a region fills at the allocation rate and triggers a GC when full. Each collection pays the mark cost over the live set. Less allocation → fewer collections → less total mark work, even though each individual dead object is essentially free to reclaim. `GC CPU ≈ frequency × mark cost`, and you're lowering frequency.

</details>

**Q33. Contrast Go's GC and a generational JVM GC w.r.t. allocation.**

<details><summary>Answer</summary>

Go's GC is concurrent, **non-generational**, non-moving: every collection marks the whole live set, so it punishes high allocation *rate* and a large *live set*. A generational JVM GC exploits "most objects die young": eden deaths are cheap; it punishes **promotion** — objects that survive eden get copied to old-gen and collected by costlier GCs. So on Go reduce rate and live set; on the JVM reduce *surviving* objects.

</details>

**Q34. What's the trade-off between "allocate less" and "give the GC more heap"?**

<details><summary>Answer</summary>

More heap headroom (`GOGC`/soft memory limit in Go, larger `-Xmx` on the JVM) lets each collection happen *later*, amortizing the mark cost over more allocation — fewer GCs, but a larger resident set (more RAM). Allocating less attacks the *input* to the cost formula directly without raising RSS. They're complementary: tune the heap for headroom, but reducing unnecessary allocation is the root-cause fix and doesn't cost memory.

</details>

**Q35. What is "false sharing" and how does it relate to allocation/reuse?**

<details><summary>Answer</summary>

False sharing is two independent variables landing on the same 64-byte cache line; when different cores write them, the cache-coherence protocol ping-pongs the line between cores despite no logical sharing. It relates to allocation because naive *reuse/pooling* of shared objects across threads can put per-thread scratch on the same line — making "reuse to avoid allocation" slower than per-thread allocation. The cure is padding hot fields to separate lines.

</details>

---

## Judgment: When It Doesn't Matter

**Q36. When does unnecessary allocation NOT matter?**

<details><summary>Answer</summary>

On a cold path — code that runs rarely (a startup routine, an admin endpoint hit a few times a day, a CLI that runs once). There the allocation is invisible to the GC and to users, and "fixing" it trades readability for nothing. The anti-pattern requires *hotness*; without it, leave the clear code alone. This is the premature-optimization boundary.

</details>

**Q37. A junior wants to add a `sync.Pool` to a request handler called ~10 times/minute. What do you say?**

<details><summary>Answer</summary>

No. That's a cold path — the allocation is invisible at that rate, and a pool adds Get/Put/reset complexity plus a correctness contract (dirty objects, retention) for zero measurable gain. It's premature optimization. Ask for a profile first; the pool is a last resort reserved for a *measured* hot allocation.

</details>

**Q38. How do you decide whether an allocation fix is worth the readability cost?**

<details><summary>Answer</summary>

Spend clarity in proportion to the *measured* win, and only on the hot path the profiler fingered. Presizing and building-once are ~free (often clearer) — always do them. Buffer reuse costs a small contract. `sync.Pool`/arenas cost a lot — justify them with profile data showing the site dominates and a benchmark showing the cure actually helps on the target hardware. If the numbers don't justify it, keep the simple code.

</details>

**Q39. You profile and the allocation graph is flat — no site over 4%. What kind of problem is this?**

<details><summary>Answer</summary>

"Death by a thousand allocations" — the codebase allocates a little everywhere with no dominant site, so there's no hotspot to surgically fix. The cure is systemic, not surgical: low-allocation *defaults* (presized collections, value types, no boxing, builders) enforced in review and linting, lowering the baseline rate everywhere. You prevent this; you can't profile your way out of it.

</details>

**Q40. Summarize the whole topic in one sentence a junior would remember.**

<details><summary>Answer</summary>

Allocate fewer times, not faster — and only bother where a profile proves it's hot; the GC handles the rest, and twisting cold code to avoid allocations just makes it harder to read for no gain.

</details>

---

## Related Topics

- [Premature Optimization Traps](../01-premature-optimization-traps/interview.md) — the measure-first discipline behind every "when it doesn't matter" answer.
- [N+1 in Code](../02-n-plus-one-in-code/interview.md) — repeated *work* in a loop; the structural sibling of repeated *allocation*.
- [Wrong Data Structure](../04-wrong-data-structure/interview.md) — collection choice that drives both allocation and access cost.
- [`junior.md`](junior.md) · [`middle.md`](middle.md) · [`senior.md`](senior.md) · [`professional.md`](professional.md) — recognition → forms → hot-path fixes → deep mechanics.
- The `profiling-techniques`, `memory-leak-detection`, and `big-o-analysis` skills.

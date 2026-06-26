# GC Tuning in Production — Interview Questions
> **Topic:** [GC Tuning in Production](README.md)

A bank of interview questions spanning the fundamental trade-offs, the JVM and Go knobs, the tricky traps that separate people who've read a blog post from people who've fought a 3 a.m. incident, and open-ended design scenarios. Each answer is written to be said out loud in 60–120 seconds.

---

## Table of Contents
- [Conceptual](#conceptual)
- [Tool-Specific](#tool-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1
**What is the GC tuning triangle, and why can't you optimize all three corners?**

The three corners are **latency** (short STW pauses), **throughput** (minimal CPU spent on GC), and **memory footprint** (small heap). You can generally get two at the expense of the third. Short pauses *and* high throughput require a bigger heap (more headroom). Short pauses *and* a small heap force the GC to work harder and more often, costing throughput. High throughput *and* a small heap means you accept longer or more disruptive pauses. The reason is mechanical: the GC's total work is roughly fixed by how much garbage you make, so reducing one cost just relocates it to another axis — unless you reduce allocation, which shrinks the whole triangle. Every flag you set is choosing a position inside this triangle, not escaping it.

## Question 2
**Why does a bigger heap usually mean better GC behavior?**

Because collectors trigger based on *how full the heap is*, not a clock. A bigger heap gives more headroom between the live set and the trigger point, so the heap fills more slowly and the GC runs **less frequently**. Each collection costs roughly the same, but you make far fewer of them, so total pause time and GC overhead drop. The analogy: a small trash can needs emptying constantly; a dumpster gets emptied rarely. The catch is footprint — you've traded memory for fewer pauses — and there's a ceiling: an oversized heap eventually hurts cache locality and, if the live set is genuinely large, individual collections get bigger.

## Question 3
**Why is average latency "a lie" when reasoning about GC?**

Because GC pauses live in the **tail**. If 999 of 1000 requests are fast and 1 hits a 200 ms pause, the average barely moves but one user in a thousand had a terrible experience — and at scale that's thousands of users. GC impact is concentrated and bursty, so the mean smooths it into invisibility. You must reason in **percentiles**: p99 and p999. The mean is fine for capacity planning, but the SLO that protects users is a tail SLO, and the tail is exactly where the collector shows up.

## Question 4
**What's the single highest-leverage thing you can do to reduce GC cost, and why?**

**Reduce the allocation rate** in application code. The GC's workload is downstream of how much garbage you create; if you allocate less, there's less to collect. Crucially, it's the only lever that improves all three corners of the triangle at once — less GC CPU (throughput), fewer/shorter pauses (latency), and a smaller working heap (footprint) — whereas flags only rebalance the trade-off. Concretely: pool and reuse buffers, preallocate collections to known sizes, avoid boxing in hot loops, and stream records instead of materializing huge intermediate structures. It's also fully in your control, unlike collector internals.

## Question 5
**Explain the generational hypothesis and how collectors exploit it.**

The generational hypothesis is the empirical observation that **most objects die young** — loop temporaries, request-scoped buffers, intermediate strings become garbage almost immediately, while a small minority (caches, pools, config) live long. Generational collectors split the heap into a small **young generation** and a larger **old generation**. They collect the young gen often and cheaply (a minor GC), because by the time they look most of it is already dead, so they copy out only the few survivors. Survivors that persist get **promoted** to the old gen, which is collected far less often. This makes the common case (lots of short-lived garbage) cheap and confines expensive work to the rare case.

## Question 6
**Why does a concurrent, low-pause collector cost throughput?**

Because doing GC work *while the application runs* requires **barriers** — small compiler-inserted snippets around pointer access (write barriers to track mutations during concurrent marking, load/read barriers to handle concurrent relocation). Those barriers add a few percent of overhead to ordinary memory operations across the whole program. Concurrent collectors also compete with the app for CPU and need extra headroom and metadata. So the short pauses aren't free: you're paying an "exchange rate" of throughput (and some memory) for latency on every pointer touch. That's why you only reach for ZGC/Shenandoah when your SLO actually needs sub-millisecond pauses.

---

## Tool-Specific

## Question 7
**Walk me through choosing a JVM collector for (a) a nightly ETL job and (b) a low-latency API.**

For the **ETL job**, total wall-clock time matters and pauses don't — use **Parallel GC**. It maximizes throughput and a multi-second pause is irrelevant to a batch process; paying for concurrency would just slow it down. For the **low-latency API**, start with **G1** (the balanced default) and set a `MaxGCPauseMillis` goal matching your latency budget — it gives tunable tens-of-milliseconds pauses with good throughput. If the heap is huge (tens of GB to TB) and the tail SLO is sub-10ms, move to **ZGC** or **Shenandoah**, accepting ~10–15% throughput cost for pauses that don't scale with heap size. The deciding inputs are: latency SLO, heap size, and how much throughput you'll trade.

## Question 8
**What do `GOGC` and `GOMEMLIMIT` do, and how do they interact?**

`GOGC` is the **pacer's heap-growth target**: at the default 100, Go triggers a collection when the heap grows to 2× the live set after the last GC. Raising it (200, 400) collects less often — more throughput, more memory; lowering it does the opposite. `GOMEMLIMIT` (Go 1.19+) is a **soft total-memory ceiling**: as memory approaches it, the GC runs more aggressively to stay under, even overriding `GOGC`. The powerful idiom is **high `GOGC` (or off) + `GOMEMLIMIT`**: collect lazily for throughput on a normal day, but never breach the limit on a bad one. In a container you set `GOMEMLIMIT` to ~90–95% of the cgroup limit, which is also why the old "ballast" trick is now obsolete.

## Question 9
**You're handed a Go `gctrace` line. Which fields matter and what do they tell you?**

Take `gc 142 @8.2s 2%: 0.018+1.9+0.005 ms clock, ..., 24->25->13 MB, 25 MB goal, 8 P`. The **`2%`** is the fraction of CPU spent on GC — your throughput cost; single digits are healthy, a rising number signals an allocation regression. The clock triple's **first and last numbers (0.018, 0.005 ms)** are the STW pause times — sub-millisecond, as Go intends. **`24->25->13 MB`** is heap before → after-mark → live; the **13 MB live set** is the real signal, and watching its floor over time detects leaks. **`25 MB goal`** is the next trigger (~2× live at GOGC=100). So in one line: throughput cost, pause times, live set trend, and pacing target.

## Question 10
**In the JVM, why set `-Xms` equal to `-Xmx` in production, and what's `MaxRAMPercentage` for?**

Setting `-Xms` = `-Xmx` pins the heap so the JVM never grows or shrinks it at runtime. Resizing can trigger Full GCs and commit/uncommit OS pages — pure jitter you don't want in a latency-sensitive service. Pinning also pre-commits the memory so you fail fast at startup if the box can't provide it. **`MaxRAMPercentage`** is the container-aware way to size the heap: instead of a hard `-Xmx`, you say "use 70% of the container's memory limit," so the heap scales with the pod's cgroup limit and you don't have to recompute `-Xmx` every time you resize the deployment — while still leaving headroom for non-heap memory.

## Question 11
**What signals would you put on a GC dashboard, and which is the leak detector?**

Four core signals: **GC%/CPU-in-GC** (throughput cost; catches allocation regressions after deploys), **pause-time p99** (the leading indicator that moves before user latency), **GC frequency** (collections per minute), and **heap-after-GC over time**. The leak detector is **heap-after-GC** — specifically its *floor* trend. Pause and frequency wobble with load, but the floor of heap-after-GC reveals the true live set; if that floor steadily climbs over hours, objects are being retained and you have a leak, not a tuning problem. I'd also track container **RSS vs. cgroup limit** separately, since OOMKills happen on total RSS, not heap.

---

## Tricky / Trap

## Question 12
**Memory keeps climbing and GC pauses are getting longer over time. Is this a GC tuning problem?**

Almost certainly **not** — it's most likely a **memory leak**, and no GC flag will fix it. The tell is **heap-after-GC trending upward**: the collector is doing its job and finding less and less garbage because the objects are still *reachable* (an unbounded cache, an ever-growing map, unclosed resources). A second tell is that a **restart temporarily fixes it** and it recurs on a schedule. Tuning `GOGC` or `MaxGCPauseMillis` here just postpones the inevitable OOM. The fix is to find the retained objects — heap dump, dominator tree — and bound or release them. The trap is reaching for a flag because the *symptom* (GC activity) looks like a GC problem.

## Question 13
**Your pod gets OOMKilled but the heap dashboard shows the heap well under `-Xmx`. What's happening?**

The kernel kills on **total RSS vs. the cgroup limit**, and the **heap is not the whole process**. Beyond the object heap you have thread stacks, metaspace/code cache, direct/native byte buffers, memory-mapped files, and the GC's own structures — none of which count against `-Xmx` but all of which count against the container limit. A common culprit is a native library allocating off-heap direct buffers. The fix: leave headroom (size the heap to ~70% of the limit via `MaxRAMPercentage`), cap off-heap memory (e.g. `MaxDirectMemorySize`), and **alert on RSS, not just heap**. The trap is "raise the memory limit," which only delays a recurrence.

## Question 14
**You lowered `MaxGCPauseMillis` to 5 ms to reduce pauses, but latency got worse. Why?**

`MaxGCPauseMillis` is a **soft goal, not a guarantee**. To meet an aggressive target, G1 collects ever-smaller slices of the heap, which means it runs **much more often**. The frequency and per-cycle overhead rise, GC% climbs, and the collector may still **miss** the unrealistic target while now stealing far more CPU from your app — so end-to-end latency degrades. If you genuinely need 5 ms pauses, that's a signal to switch collectors (ZGC/Shenandoah), not to crank a G1 goal into a regime it can't serve. The trap is treating a hint as a hard SLA.

## Question 15
**You migrated a high-throughput service to ZGC for sub-millisecond pauses, but now you see periodic multi-hundred-millisecond latency spikes. What went wrong?**

The service is **allocating faster than ZGC can reclaim**, so threads hit **allocation stalls** — they block waiting for memory because the concurrent collector lost the race with the mutator. The very spikes you were trying to eliminate. ZGC's sub-ms guarantee assumes it can stay ahead of allocation; feed it a firehose with insufficient headroom and it falls behind. The fix is to **reduce the allocation rate** and **add heap headroom** so the collector wins the race, plus backpressure to cap burst allocation. The lesson: low-pause collectors aren't a substitute for fixing allocation; they amplify the need to control it.

## Question 16
**After a deploy, GC CPU jumped from 3% to 11% with no config change. Where do you look?**

This is the signature of an **allocation regression**, not a collector problem — the config didn't change, so something in the new code allocates more. The heap is filling faster, so GC frequency (and CPU) rose proportionally. I'd **diff the allocation flame graph** against the previous release (`pprof -alloc_space` in Go, async-profiler's allocation profile on the JVM) to find the new hot allocation site — classically a per-request buffer that used to be pooled, an unnecessary copy, or boxing introduced in a hot loop. The fix is in the code (pool/reuse/preallocate), not in a flag. The trap is "switch to a fancier collector," which masks rather than fixes the regression.

---

## Design

## Question 17
**Design a GC strategy for a payments API with a p999 < 100 ms SLO at 2× peak load. Walk me through it.**

I'd start by **decomposing the latency budget**: if real work is ~60 ms at p999, the GC pause budget is roughly 20–30 ms with margin — comfortable **G1** territory, so no need for ZGC's throughput tax yet. Then follow the order: **(1) reduce allocation** — profile the top allocation sites and pool/preallocate them, because that helps every axis; **(2) size the heap** with `-Xms`=`-Xmx`, sized below the container limit via `MaxRAMPercentage` with non-heap headroom; **(3) configure G1** with `MaxGCPauseMillis=25` and a lower `InitiatingHeapOccupancyPercent` (~40) so concurrent marking starts early and avoids evacuation-failure Full GCs under burst; **(4) validate** with a load test at 2× peak measuring *actual* pause p999, not the goal. Finally, **wire alerting**: pause p99, GC%, heap-after-GC trend, RSS vs. limit, and pair with load shedding so a spike degrades gracefully instead of thrashing the GC.

## Question 18
**You run hundreds of Go microservices on Kubernetes. Design a default GC/memory configuration and explain the trade-offs.**

I'd standardize a template: **`GOMEMLIMIT`** set to ~90% of each pod's cgroup memory limit (soft ceiling that keeps the GC reclaiming before OOM), **`GOGC=100`** or slightly higher as the default pacer (lazy enough for throughput; `GOMEMLIMIT` catches the bad day), and **`GOMAXPROCS`** matched to the CPU limit (via `automaxprocs`) so the GC doesn't spin up 64 workers on a 2-CPU pod and cause throttling. I'd enable `GODEBUG=gctrace=1` to stdout for log-based GC dashboards. The trade-offs: `GOMEMLIMIT` trades CPU for OOM-safety under pressure (acceptable — a slow pod beats a dead one); a higher `GOGC` trades memory for throughput, so it only suits pods with generous limits. The platform value is that one sane default removes the most common outage (cgroup mismatch) across the whole fleet, while teams with unusual allocation profiles can override per-service after profiling.

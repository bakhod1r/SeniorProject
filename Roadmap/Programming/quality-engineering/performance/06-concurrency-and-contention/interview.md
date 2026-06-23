# Concurrency and Contention — Interview Questions

> **Roadmap:** [Performance](../README.md) → Concurrency and Contention
> *A concurrency-for-performance interview rarely asks "what is a mutex." It asks "you added cores and throughput went *down* — explain," and then watches whether you can separate concurrency from parallelism, reason about Amdahl and the USL coherency term, and tell true sharing from false sharing. This page is the question bank, with model answers and a note on what each question is really probing. The angle throughout is **scaling and performance**, not correctness — races and deadlocks are a different topic.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Concurrency vs Parallelism and When It Helps](#theme-1--concurrency-vs-parallelism-and-when-it-helps)
3. [Theme 2 — Amdahl, USL, and Finding the Optimal N](#theme-2--amdahl-usl-and-finding-the-optimal-n)
4. [Theme 3 — Lock Contention](#theme-3--lock-contention)
5. [Theme 4 — Cache Coherence and False Sharing](#theme-4--cache-coherence-and-false-sharing)
6. [Theme 5 — Lock-Free and Memory Ordering](#theme-5--lock-free-and-memory-ordering)
7. [Theme 6 — Debugging Scenarios](#theme-6--debugging-scenarios)
8. [Theme 7 — Design and Judgment](#theme-7--design-and-judgment)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **concurrency vs parallelism** (structure of interleaving vs actually-simultaneous execution)
- **CPU-bound vs I/O-bound** (cores help one, overlap helps the other, contention hurts both)
- **scaling vs speed** (more workers can be slower per unit of work)
- **true vs false sharing** (a real data dependency vs an accident of memory layout)

Nearly every scaling pathology in this bank is one of those distinctions wearing a costume. The candidates who do well *name the distinction and reach for a model* (Amdahl, USL, MESI) before they reach for "add a thread pool."

---

## Theme 1 — Concurrency vs Parallelism and When It Helps

### Q1.1 — Define concurrency and parallelism. Why does the distinction matter for performance?

> **Testing:** Whether you treat these as the same word, or understand they solve different problems.

**A.** **Concurrency** is a property of program *structure*: independent tasks that can be *in progress* in overlapping time windows — it's about dealing with many things at once, and it exists even on a single core (the OS interleaves them). **Parallelism** is a property of *execution*: tasks literally running at the same instant on multiple cores. Concurrency is composition; parallelism is the hardware actually doing two things simultaneously.

The reason it matters: **concurrency can improve throughput on an I/O-bound workload with one core** (while one task waits on the network, another runs), but it gives you *zero* extra compute. **Parallelism improves throughput on a CPU-bound workload** by adding compute, but only to the extent the work is independent. Confusing them leads to the classic mistake of throwing threads at a CPU-bound, mostly-serial task and getting nothing — or throwing parallelism at an I/O wait and adding overhead for no gain.

### Q1.2 — Give me three workloads: one where more cores help, one where async/overlap helps, and one where neither helps.

> **Testing:** Can you classify work, not just recite definitions?

**A.**
- **More cores help — CPU-bound and parallelizable:** image resizing a batch of photos, matrix multiply, parsing 10k independent JSON documents. The work is compute and the units don't depend on each other, so N cores approach N× until a shared resource pushes back.
- **Overlap helps — I/O-bound:** a service that makes 50 downstream HTTP calls per request, or a crawler. The bottleneck is *waiting*, not CPU; concurrency (async, or a few threads) lets the waits overlap so wall-clock collapses from sum-of-latencies to roughly max-of-latencies. One core can saturate this.
- **Neither helps — inherently serial or already-bottlenecked:** a computation where each step needs the previous step's result (a tight dependency chain), or a workload already bottlenecked on a single disk/lock/connection. Adding workers here adds coordination cost and *reduces* throughput.

The senior move is to *measure first*: a flame graph or a simple "is the CPU pegged?" check tells you whether you're CPU-bound (parallelize) or waiting (overlap) before you pick a tool.

### Q1.3 — A team made a single-threaded API handler `async` and saw no latency improvement under load. Why might that be?

> **Testing:** Whether you know async buys overlap, not compute.

**A.** Async / non-blocking I/O improves throughput by letting a thread do *other work while waiting* on I/O — it does nothing for CPU time. If the handler is **CPU-bound** (heavy serialization, crypto, parsing), making it async just moves the same CPU work onto an event loop, and under load the loop is saturated exactly as the synchronous version was. Worse, on a single-threaded event loop a long CPU task *blocks the loop*, hurting every other request's latency. Async pays off when the handler spends its time *waiting* (DB, downstream calls); for CPU-bound work you need actual parallelism (a worker pool / multiple processes), not concurrency.

---

## Theme 2 — Amdahl, USL, and Finding the Optimal N

### Q2.1 — State Amdahl's Law and what it implies about the limit of speedup.

> **Testing:** The first law of parallel scaling, and the role of the serial fraction.

**A.** If a fraction **p** of the work is parallelizable and **(1 − p)** is serial, then with **N** processors the speedup is

> S(N) = 1 / ( (1 − p) + p/N )

As N → ∞, the parallel term vanishes and **S → 1 / (1 − p)** — speedup is capped by the *serial fraction alone*. If 5% of your work is serial, the absolute ceiling is 20× no matter how many cores you buy. The practical implication: past a point, **adding cores buys almost nothing**, because the serial part dominates. Amdahl is fixed-problem-size; for the optimistic counterpart where the problem grows with the machine, cite **Gustafson's Law** (serial fraction shrinks relative to a bigger workload, so large-scale scaling is more favorable than Amdahl suggests).

### Q2.2 — Amdahl says adding cores gives diminishing returns. But you've seen throughput actually *drop* as cores increase. Amdahl doesn't predict that. What does?

> **Testing:** The Universal Scalability Law — the model that explains retrograde scaling.

**A.** Amdahl only models contention (serialization); it asymptotes to a ceiling but never *decreases*. Real systems get **worse** past an optimum, and the model for that is the **Universal Scalability Law (USL)**:

> C(N) = N / ( 1 + α(N − 1) + β·N·(N − 1) )

- **α (alpha)** is the **contention** term — serialized/queued work, the Amdahl-like part.
- **β (beta)** is the **coherency** term — the cost of keeping N workers' shared state consistent (cache-coherence traffic, lock cacheline bouncing, cross-node crosstalk). This grows as **N²** (every worker can interact with every other).

Because β grows quadratically while throughput grows at best linearly, there's a peak after which the coherency penalty *exceeds* the gain from another worker, and throughput goes **retrograde** — it declines. That downward curve is the USL's signature and Amdahl's blind spot.

### Q2.3 — Given a USL fit, how do you find the optimal number of workers?

> **Testing:** Whether USL is a real planning tool to you or a name you've heard.

**A.** When β > 0, C(N) has a maximum, and calculus gives the optimum directly:

> N* = sqrt( (1 − α) / β )

So if you fit α and β to a handful of measured load points (run the system at 1, 2, 4, 8, 16 concurrency and regress), you can *compute* where throughput peaks rather than discover it in production. The headline insight: **N\* is driven almost entirely by β** — even a tiny coherency cost (β = 0.001) caps the useful worker count in the low tens. That's why "just raise the thread pool / GOMAXPROCS / connection count" so often backfires: you push N past N\* and slide down the retrograde slope. USL turns capacity planning from guesswork into a two-parameter fit.

### Q2.4 — Your throughput vs. concurrency curve rises, flattens, then falls. Map each region to its cause.

> **Testing:** Reading a scalability curve like a diagnostician.

**A.**
- **Rising (near-linear):** you're below saturation; each added worker contributes real parallel work. α and β are still small relative to N.
- **Flattening (plateau):** the **contention** term α dominates — workers increasingly serialize on a shared resource (a lock, a single DB connection, a queue). This is the Amdahl ceiling.
- **Falling (retrograde):** the **coherency** term β dominates — the N² cost of synchronizing shared state (cacheline bouncing, lock convoy, coherence traffic) now outweighs the marginal worker. You're past N\*.

The fix differs by region: to push the plateau out, *shrink or shard the contended resource* (lower α); to avoid the cliff, *cap concurrency at or below N\** and reduce shared mutable state (lower β). Adding more workers helps only on the rising part.

---

## Theme 3 — Lock Contention

### Q3.1 — What does a thread blocked on a lock actually *cost* the system? Be specific.

> **Testing:** Whether you cost contention concretely or just say "it's slow."

**A.** It costs more than the wait itself:
1. **The critical section serializes** — that span runs one-at-a-time regardless of core count, so it's pure α in USL terms.
2. **Context-switch / parking cost** — if the lock blocks (rather than spins), the thread is descheduled and later woken: thousands of cycles, plus cache pollution when it resumes on a possibly-different core with cold caches.
3. **Cacheline bouncing on the lock word itself** — every acquire/release writes the lock's cacheline, which then ricochets between cores' caches (coherence traffic, the β term).
4. **Lost throughput downstream** — a held lock can stall a queue of waiters, and tail latency (p99) inflates far faster than the mean because waiters pile up.

The mean might look fine while p99 explodes — contention shows up in the *tail* first, which is why averages hide it.

### Q3.2 — Explain lock convoying. Why is it disproportionately bad?

> **Testing:** A specific contention pathology that separates the experienced.

**A.** A **convoy** forms when a thread holding a lock is **preempted** (its time slice ends, or it page-faults / takes an interrupt) *while holding the lock*. Every other thread that needs the lock now blocks and parks — even though the holder isn't doing useful work, it's just *not scheduled*. When the holder finally runs and releases, it often re-acquires quickly (it's hot), and the woken waiters wake, fail to acquire, and park again. The system spends its time parking and waking rather than doing work; throughput collapses far below what the critical section's length alone would predict. It's disproportionate because the cost is **scheduling churn**, not computation. Mitigations: keep critical sections short enough that preemption-while-holding is rare, avoid holding locks across blocking calls, use lock-free structures for hot paths, or use adaptive mutexes that spin briefly before parking.

### Q3.3 — Name the levers for reducing lock contention, strongest first.

> **Testing:** A prioritized toolkit, not a single trick.

**A.**
1. **Don't share** — the strongest lever. Give each thread its own state (thread-local, sharded counters) and merge lazily; no sharing means no lock. This is the shared-nothing principle.
2. **Shrink the critical section** — hold the lock for the minimum: do expensive work (allocation, I/O, formatting) *outside* the lock; compute first, then lock only to publish. Smaller α.
3. **Shard / stripe the lock** — replace one lock over a big structure with N locks each guarding a slice (e.g. a striped hash map, per-bucket locks). Contention drops by ~N if access is uniform.
4. **Reader/writer locks** — let readers share when reads dominate (caveats below).
5. **Lock-free / atomics** — for simple hot operations (counters, single-pointer publish), a CAS loop avoids parking entirely.
6. **Reduce the *rate* of entry** — batch, coalesce, or back off so threads hit the lock less often.

Order matters: eliminating sharing beats optimizing the lock, which beats picking a fancier lock.

### Q3.4 — When does a reader/writer lock *not* help, or even hurt?

> **Testing:** Whether you know RWLock is not a free lunch.

**A.** An RWLock wins only when reads vastly dominate *and* read critical sections are long enough to amortize its overhead. It can fail or hurt when:
- **Reads are short.** The RWLock's bookkeeping (tracking reader counts, often with its own atomics) costs more than the trivial read it's protecting — a plain mutex or an atomic is faster.
- **Writes are frequent.** A writer needs exclusive access, so it waits for *all* readers to drain and blocks new ones; under mixed load this serializes worse than a simple mutex.
- **Writer starvation / fairness.** Naive RWLocks can starve writers under a steady read stream, inflating write latency unboundedly.
- **The read counter itself contends.** Acquiring a read lock still writes a shared counter's cacheline, so it *still bounces* between cores — the very thing you hoped to avoid. Per-core or sharded reader locks (or RCU) address this; a single shared reader count does not.

For read-mostly data, an immutable-snapshot / copy-on-write or RCU pattern often beats an RWLock because readers touch *no* shared writable state at all.

---

## Theme 4 — Cache Coherence and False Sharing

### Q4.1 — What is false sharing, and how is it different from true sharing?

> **Testing:** The single most common "invisible" multicore performance bug.

**A.** Caches move data in **cache lines** (64 bytes on x86/most ARM), not individual variables. **True sharing** is when two cores genuinely access the *same* variable — there's a real data dependency, and the coherence traffic is unavoidable. **False sharing** is when two cores access *different* variables that happen to sit on the *same cache line*: there's no logical dependency, but the hardware tracks coherence at line granularity, so a write by core A to its variable **invalidates the whole line** in core B's cache, forcing B to re-fetch even though B's variable never changed.

The symptom is a parallel program that *should* scale linearly but stalls or even slows as you add cores — because two unrelated counters landed in the same 64 bytes and the cores are ping-ponging the line. It's "false" because the sharing is an accident of memory layout, not the algorithm.

### Q4.2 — Walk me through, in MESI terms, what a single contended atomic increment costs across cores.

> **Testing:** Real cache-coherence mechanics, not hand-waving.

**A.** MESI gives each cacheline a state per core: **M**odified, **E**xclusive, **S**hared, **I**nvalid. To write (and an atomic RMW *is* a write), a core needs the line in **Modified**, which requires **Exclusive** ownership. So for a counter hammered by N cores:
1. Core A wants to increment → issues a **Read-For-Ownership (RFO)** → the line is invalidated in every other core (they go to **I**), A gets it **M**, increments.
2. Core B wants to increment → its copy is now **I** → it issues an RFO → A's line is invalidated, the modified value is transferred to B (cache-to-cache), B gets **M**, increments.
3. Repeat. The line **bounces** between cores, one owner at a time.

Each bounce is a cross-core coherence transaction — tens to ~100+ ns, far slower than the increment's ~1 ns of arithmetic. The atomic instruction is cheap; the **coherence traffic on the contended line** is the cost, and it's exactly the USL β term made physical. N cores hammering one counter scale *negatively*. The fix is per-core/sharded counters summed on read.

### Q4.3 — How do you fix false sharing, and how do you confirm it was the problem?

> **Testing:** A concrete remedy plus verification, not just diagnosis.

**A.** **Fix:** ensure independently-written variables live on *different* cache lines — **pad and align to a cache line** (typically 64 bytes). In practice: `alignas(64)` per hot field in C++, Java's `@Contended` (with `-XX:-RestrictContended`), Go's padding structs, or Rust's `crossbeam`'s `CachePadded`. For per-thread counters, give each thread its own cache-line-aligned slot. Pad both *sides* if multiple hot fields share a struct.

**Confirm:** the remedy shouldn't be applied blindly — padding wastes cache and memory bandwidth if there's no false sharing. Verify with hardware counters: `perf c2c` (cache-to-cache) on Linux directly identifies cachelines and offsets where cores are HITM-bouncing; or watch for high `mem_load_*.hit_lfb` / coherence-miss counters; or simply observe that adding padding restores linear scaling. The honest answer is "I'd profile with `perf c2c` to *prove* the contended line before padding."

### Q4.4 — Why can adding a field to a struct, with no logic change, suddenly speed up or slow down a multithreaded program?

> **Testing:** Whether you connect layout to coherence.

**A.** Because the change shifted the **memory layout** relative to cache-line boundaries. Adding a field can push two hot, independently-written variables onto *separate* 64-byte lines (eliminating false sharing → speedup) — or pull two previously-separated hot variables onto the *same* line (introducing false sharing → slowdown). The code's logic is identical; only the byte offsets moved. This is why multicore performance is *layout-sensitive* and why "harmless" struct edits, padding changes, or even a compiler/allocator version bump can swing throughput. It also argues for *deliberate* layout of hot shared data rather than leaving it to chance.

---

## Theme 5 — Lock-Free and Memory Ordering

### Q5.1 — What is compare-and-swap (CAS), and when does a lock-free structure actually beat a mutex?

> **Testing:** Whether "lock-free" means something precise, and that it isn't always faster.

**A.** **CAS** is an atomic instruction: "if the value at address X is still `expected`, set it to `new` and report success; otherwise fail." Lock-free algorithms build on a **CAS retry loop** — read the current value, compute the new one, CAS; if it failed (someone else changed it), retry. No thread is ever *parked*, so the system as a whole always makes progress (that's the lock-free guarantee), which means **no convoying and no priority inversion**.

Lock-free beats a mutex when: contention is **moderate**, critical sections are **tiny** (a pointer swap, a counter), and you can't afford the **tail-latency** spikes that parking/convoying cause. It *loses* when contention is **high** — every failed CAS is wasted work, and a hot CAS loop can livelock into a storm of retries that's slower than a mutex that just queues waiters. It also loses when the operation is genuinely complex (lock-free is hard to get right and often needs careful memory reclamation). Rule of thumb: lock-free for simple, hot, latency-sensitive operations; a well-implemented mutex for everything else.

### Q5.2 — Explain acquire, release, and sequentially-consistent ordering. Why not always use seq-cst?

> **Testing:** Real memory-model knowledge, and the cost of the strongest ordering.

**A.** Memory ordering constrains how the compiler and CPU may *reorder* memory operations around an atomic:
- **Acquire** (on a load): no reads/writes *after* it may be reordered *before* it. Used when *taking* a lock or *consuming* a published flag — guarantees you see everything the producer did before the matching release.
- **Release** (on a store): no reads/writes *before* it may be reordered *after* it. Used when *publishing* — guarantees the consumer that acquires sees all your prior writes.
- **Acquire/release pair** establishes a *happens-before* edge between the releasing and acquiring threads — the standard "publish data, then set a ready flag with release; read flag with acquire, then read data" idiom.
- **Sequentially consistent (seq-cst):** the strongest — a single total order of all seq-cst operations that every thread agrees on.

You don't always use seq-cst because it's the **most expensive**: on x86 a seq-cst store typically needs a full `MFENCE` / locked instruction (draining the store buffer), and on weakly-ordered ISAs (ARM/POWER) it inserts heavier barriers than acquire/release. Acquire/release is usually sufficient for producer/consumer handoff and is cheaper — on x86 plain loads/stores are *already* acquire/release-ish, so it's nearly free. Use the **weakest ordering that's correct**; reach for seq-cst only when you genuinely need a global total order (e.g. some lock-free algorithms, Dekker-style flags).

### Q5.3 — What is the ABA problem, and how do you defend against it?

> **Testing:** The classic lock-free trap.

**A.** **ABA:** a CAS checks only the *value*, not whether the value *changed and changed back*. Thread 1 reads pointer A, gets preempted; thread 2 pops A, pushes B, then pushes A again (so the top is A once more, but the structure is different — A may have been freed and reused). Thread 1 resumes, CASes "top is still A → swap," **succeeds**, but its assumption about what's behind A is now wrong — corrupting the structure. The value matched; the world didn't.

Defenses:
- **Tagged / versioned pointers:** pack a monotonic counter alongside the pointer and CAS the pair (double-width CAS, `cmpxchg16b`), so A-with-tag-5 ≠ A-with-tag-7.
- **Hazard pointers / epoch-based reclamation:** prevent a node from being freed and reused while another thread might still reference it (removes the "reused address" precondition).
- **GC'd languages dodge the classic form** because a node won't be reclaimed while reachable — but logical ABA on values can still bite.

The deeper point: ABA is why lock-free **memory reclamation** is the genuinely hard part, far more than the CAS loop itself.

---

## Theme 6 — Debugging Scenarios

### Q6.1 — Throughput climbs as you add cores, peaks at 8, then *drops* at 16 and 32. Walk me through it.

> **Testing:** Recognizing retrograde scaling and triaging its cause.

**A.** First, name it: this is **retrograde scaling**, which Amdahl can't produce — so the **USL coherency term β** is dominating past the peak (≈ N\*). Something shared is getting more expensive super-linearly as workers increase. Triage:
1. **Is the CPU actually saturated?** If cores aren't pegged at the peak, the limit is contention/coordination, not compute.
2. **Profile for the contended resource.** `perf c2c` for false-sharing / contended cachelines; lock-profiling (e.g. `mutex` contention profiles, `perf lock`) for a hot lock; check for a single shared counter, allocator lock, or one DB connection.
3. **Look for a global serialization point:** a stats counter, a logging lock, a shared RNG, a single accept socket, a malloc arena.
4. **Fit the USL** to the points you have to estimate β and N\*, then cap concurrency at N\*.

Common culprits in order: a hot shared atomic/lock (false or true sharing), allocator contention, or an external bottleneck (one DB/connection) that more workers just queue behind. The fix is to lower β (shard the resource, per-core state, pad cachelines) — *not* to add more cores.

### Q6.2 — Under load, p99 latency spikes badly while CPU utilization sits at 60%. Is this contention?

> **Testing:** Whether you can read "spare CPU + bad tail" as a coordination/queueing problem.

**A.** Very likely **yes — contention or queueing**, not a compute shortage. If CPU is only 60% but latency is bad, work isn't CPU-starved; threads are **waiting** — on a lock, a connection-pool slot, a saturated queue, or each other. Signatures:
- **Lock contention / convoying:** threads park waiting for a hot lock; the holder may be getting preempted (convoy), so waiters pile up and the *tail* explodes while the mean stays OK and CPU stays moderate.
- **Pool exhaustion / backpressure failure:** a bounded resource (DB connections, thread pool) is saturated; requests queue, and queueing delay shows up as p99.
- **Coordinated omission / GC pauses** can also masquerade as tail spikes.

How to confirm: look at **off-CPU time** (off-CPU flame graph, `perf sched`, or wait-time profiling) — it directly shows time spent *blocked* rather than running. High off-CPU + spare CPU = a coordination bottleneck. The fix is to find and shrink/shard the contended resource or add proper backpressure, not to add cores (which won't help — they'll wait too).

### Q6.3 — A Go service runs fine on a 32-core host but is sluggish and burns CPU in a Kubernetes pod with a 2-core limit. What's going on?

> **Testing:** The GOMAXPROCS-in-a-container trap (and the general "runtime can't see the cgroup limit" class).

**A.** By default the Go runtime sets **GOMAXPROCS to the number of CPUs it sees on the *machine*** (`runtime.NumCPU()` reads the host's 32), but the container's **CFS quota** limits it to the equivalent of ~2 cores. So the runtime spins up 32 OS threads / P's all trying to run, but the scheduler only gets ~2 cores' worth of quota — leading to **throttling** (the cgroup periodically freezes the process when it exhausts its quota slice), excessive context switching, and worse GC/scheduler behavior. The mismatch wastes CPU on coordination and causes latency hiccups at every quota period.

Fix: set **GOMAXPROCS to match the CPU limit** — historically via `uber-go/automaxprocs` (reads the cgroup quota), and **Go 1.25+ makes the runtime cgroup-aware by default**. The general lesson — applies to JVM (`-XX:ActiveProcessorCount` / UseContainerSupport), thread pools sized off `availableProcessors()`, etc. — is that **runtimes that auto-size parallelism off host CPU count over-provision inside containers**; always pin parallelism to the *cgroup* limit, not the host.

### Q6.4 — You sharded a hot counter into 64 per-thread counters and contention vanished — but now a different microbenchmark is slower. Why might sharding backfire?

> **Testing:** Whether you see the costs of the fix, not just the win.

**A.** A few ways sharding can regress:
- **Read cost moved.** A sharded counter is cheap to *write* but now requires summing 64 slots to *read* — if reads are frequent (a metric scraped often), you've traded write contention for read cost.
- **Cache / memory footprint.** 64 cache-line-padded slots is 64 × 64 = 4 KB for one counter; many such counters blow the cache working set, hurting unrelated code via more cache misses.
- **Still false-sharing if unpadded.** If the 64 slots aren't cache-line-aligned, several share a line and you've added complexity without removing the bouncing.
- **NUMA / locality.** Slots scattered across NUMA nodes add cross-socket traffic on the read path.

The lesson: every contention fix has a cost (memory, read latency, complexity), and the right shard count is a *tuning* decision driven by the read/write ratio and core count — not "more shards is always better." Measure both read and write paths after the change.

---

## Theme 7 — Design and Judgment

### Q7.1 — How do you size a thread pool / worker pool for a given workload?

> **Testing:** Whether pool sizing is principled or cargo-culted to "number of cores."

**A.** It depends on whether the work is **CPU-bound or I/O-bound**:
- **CPU-bound:** size ≈ **number of cores** (sometimes cores + 1 to cover an occasional stall). More threads than cores just adds context-switch overhead and cache thrash without more compute — you're past the useful point on the scaling curve.
- **I/O-bound:** threads spend most time *waiting*, so you want more threads than cores to keep cores busy during waits. The classic guide is **Little's Law / the Brendan-Gregg-style formula**: optimal threads ≈ cores × (1 + wait-time / compute-time). A handler that waits 90% of the time wants ~10× cores.

But the cap should also respect **N\*** from the USL and the capacity of *downstream* resources — there's no point running 200 workers if the database accepts 50 connections; you'd just move the queue. So: classify the work, apply the formula for a starting point, then **measure the throughput-vs-concurrency curve** and cap at or below the peak. And always pair the pool with a **bounded queue and backpressure** so saturation degrades gracefully instead of exploding memory.

### Q7.2 — What is backpressure, and why is an unbounded queue a performance bug?

> **Testing:** Whether you understand that "just queue it" defers the problem catastrophically.

**A.** **Backpressure** is the mechanism by which a saturated consumer signals upstream to *slow down* — by blocking, rejecting (429 / load-shedding), or applying flow control — instead of accepting work it can't process. An **unbounded queue** removes that signal: when arrival rate exceeds service rate, the queue grows without limit. The consequences are severe:
- **Latency explodes.** By Little's Law, latency = queue length / throughput; an ever-growing queue means ever-growing delay — requests are "accepted" but answered far too late to matter.
- **Memory exhaustion → OOM.** The queue eats heap until the process dies, taking *all* in-flight work with it.
- **No load-shedding.** A bounded queue lets you *reject* excess fast (fail fast) and stay responsive for the load you *can* serve; unbounded means the whole system collapses instead of degrading.

The correct design is a **bounded** queue plus an explicit overflow policy (block the producer, drop oldest, or reject with a retryable error). Concurrency limits (a semaphore bounding in-flight work) are backpressure made explicit. "We'll just queue it" without a bound is a latency-and-availability time bomb.

### Q7.3 — When would you choose a shared-nothing / single-writer architecture over fine-grained locking?

> **Testing:** Top-end judgment — designing contention *out* rather than optimizing it.

**A.** Choose **shared-nothing** (each worker owns its data, communicates by message-passing) or **single-writer** (one thread owns a piece of state; others send it requests) when contention is the bottleneck and you want to *eliminate* coordination cost rather than shave it. The payoff is that the USL **β term goes toward zero**: no shared mutable state means no cache-line bouncing, no locks, no coherence storm — so the system scales *linearly* far longer. Sharding a service by key (each shard single-threaded over its partition) is this pattern at the macro level; an actor model is it at the micro level.

The canonical example is the **LMAX Disruptor**: a single-writer ring buffer with mechanical-sympathy design (cache-line padding, no locks, batching) that hit millions of ops/sec on one thread precisely because it avoided contention instead of managing it. The tradeoffs: you pay in **message-passing overhead and latency** for cross-shard operations, and **partitioning is hard** when work doesn't cleanly shard (cross-key transactions become distributed coordination). So: shared-nothing when the workload partitions naturally and contention dominates; fine-grained locking when state is genuinely shared and partitioning would force expensive cross-shard chatter. The senior instinct is to *design the sharing out* before optimizing the lock.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Concurrency vs parallelism in one line?** A: Concurrency is *structuring* independent tasks to overlap; parallelism is *executing* them at the same instant on multiple cores.
- **Q: CPU-bound — parallelism or async?** A: Parallelism (more cores); async only overlaps waits, of which CPU-bound work has none.
- **Q: Amdahl's ceiling for 10% serial?** A: 1 / 0.1 = **10×**, no matter how many cores.
- **Q: What does Amdahl miss that the USL captures?** A: The **coherency** (β) term — N² synchronization cost that makes scaling go *retrograde*, not just plateau.
- **Q: Typical cache line size?** A: **64 bytes** on x86 and most ARM.
- **Q: True vs false sharing?** A: True = same variable (real dependency); false = different variables on the same cache line (layout accident).
- **Q: Fix for false sharing?** A: **Pad and align** the hot fields to separate cache lines (e.g. `alignas(64)`, `@Contended`, `CachePadded`).
- **Q: What state must a core have to write a cacheline (MESI)?** A: **Modified**, which requires **Exclusive** ownership via a Read-For-Ownership.
- **Q: Weakest ordering for producer/consumer handoff?** A: **Release** on publish, **acquire** on consume — cheaper than seq-cst.
- **Q: Why not always seq-cst?** A: It forces the strongest barriers (full fence / store-buffer drain), which is the most expensive ordering.
- **Q: What is ABA?** A: A CAS succeeds because the value returned to the original, even though the structure changed underneath — defend with tagged pointers or hazard pointers.
- **Q: Lock convoy in one line?** A: A lock holder gets preempted, all waiters park, and the system churns on scheduling instead of work.
- **Q: GOMAXPROCS in a container?** A: Pin it to the **cgroup CPU limit**, not the host core count (Go 1.25+ does this automatically; older: `automaxprocs`).
- **Q: Thread pool size for I/O-bound work?** A: More than cores: ≈ cores × (1 + wait/compute), capped by downstream capacity.
- **Q: One-line case against an unbounded queue?** A: It removes backpressure, so latency and memory grow without limit until OOM instead of shedding load.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Using "concurrency" and "parallelism" interchangeably.
- Throwing threads at a CPU-bound, mostly-serial task and expecting linear speedup.
- Knowing Amdahl but having no model for *retrograde* scaling (no USL / coherency term).
- Confusing true and false sharing, or never mentioning the cache line.
- "Atomics are free / lock-free is always faster" — ignoring coherence traffic and high-contention CAS storms.
- Sizing every pool to "number of cores" regardless of I/O.
- "Just queue it" with no bound and no backpressure.
- Reading "spare CPU + bad p99" as a compute problem.

**Green flags:**
- Classifying the workload (CPU vs I/O) and *measuring* before choosing a tool.
- Reaching for **Amdahl for the ceiling, USL for the cliff**, and computing **N\*** from a fit.
- Explaining a contended atomic in **MESI / RFO** terms — cheap instruction, expensive coherence.
- Proposing to *eliminate* sharing (shared-nothing, single-writer) before optimizing the lock.
- Verifying false sharing with `perf c2c` before blindly padding.
- Using the **weakest correct** memory ordering and justifying it.
- Pairing every pool with a bounded queue and explicit backpressure.
- Pinning runtime parallelism to the **cgroup limit** in containers.

---

## Summary

- The bank reduces to four distinctions in costumes: **concurrency vs parallelism**, **CPU-bound vs I/O-bound**, **scaling vs speed**, **true vs false sharing**. Name the distinction and pick a model first; the tool follows.
- **When it helps:** more cores help *CPU-bound, parallelizable* work; overlap (async/concurrency) helps *I/O-bound* work; *serial or already-bottlenecked* work is helped by neither — measure to tell which you have.
- **The math:** Amdahl caps speedup at **1/(1−p)** and only ever plateaus; the **USL** adds a **coherency term β** that grows as N², explaining *retrograde* throughput and giving an optimum **N\* = sqrt((1−α)/β)**.
- **Lock contention** costs serialization + parking + cacheline bouncing + tail-latency blowup; **convoying** turns preemption-while-holding into scheduling churn. Levers, strongest first: don't share, shrink the section, shard the lock, RWLock (with caveats), lock-free, reduce entry rate.
- **Cache coherence:** caches work in 64-byte lines; a contended atomic costs **MESI RFO bouncing** (the β term made physical), and **false sharing** silently kills scaling — fix by padding to a cache line, confirm with `perf c2c`.
- **Lock-free:** CAS retry loops avoid parking (no convoying), win for tiny hot operations at moderate contention and lose under high contention; use the **weakest correct memory ordering** (acquire/release over seq-cst); beware **ABA** and the hard problem of memory reclamation.
- **Judgment:** size pools by workload and cap at N\* and downstream capacity; *always* bound queues with backpressure; pin parallelism to the cgroup limit in containers; and **design the contention out** (shared-nothing / single-writer / Disruptor) rather than optimizing the lock when the workload partitions.

---

## Further Reading

- *The Art of Multiprocessor Programming* (Herlihy & Shavit) — the reference for locks, lock-free structures, CAS, ABA, and memory models.
- Neil Gunther, *Guerrilla Capacity Planning* — the Universal Scalability Law, fitting α/β, and computing N\*.
- Ulrich Drepper, *What Every Programmer Should Know About Memory* — cache lines, MESI, false sharing, and `perf`-level diagnosis.
- *C++ Concurrency in Action* (Anthony Williams) — the memory model (acquire/release/seq-cst) explained operationally.
- The LMAX **Disruptor** technical paper — mechanical sympathy, single-writer, and cache-line padding in production.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [03 — Latency and Throughput](../03-latency-and-throughput/interview.md) — Little's Law, queueing, and the metrics contention degrades.
- [junior.md](junior.md) — the foundational concurrency-vs-parallelism and shared-state material.
- [middle.md](middle.md) — locks, atomics, and the mechanics of contention.
- [senior.md](senior.md) — USL, cache coherence, and lock-free design depth.
- [professional.md](professional.md) — fleet-scale capacity planning and shared-nothing architecture.
- [Performance README](../README.md) — where concurrency and contention sit in the broader performance landscape.

# CPU-Bound Optimization — Interview Questions

> **Roadmap:** [Performance](../README.md) → CPU-Bound Optimization
> *A CPU-optimization interview rarely asks "how do you make code fast." It asks "the service is pinned at 100% on one core — walk me through it," and then watches whether you profile before you guess, whether you know a cache miss costs ~200x an L1 hit, and whether you can tell a 2x micro-benchmark win that moved nothing from one that moved the p99. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — CPU-Bound vs I/O-Bound and Profile-First](#theme-1--cpu-bound-vs-io-bound-and-profile-first)
3. [Theme 2 — Optimization Altitude](#theme-2--optimization-altitude)
4. [Theme 3 — Memory Hierarchy and Cache](#theme-3--memory-hierarchy-and-cache)
5. [Theme 4 — Branch Prediction and ILP](#theme-4--branch-prediction-and-ilp)
6. [Theme 5 — SIMD and Vectorization](#theme-5--simd-and-vectorization)
7. [Theme 6 — Scenario and Debugging](#theme-6--scenario-and-debugging)
8. [Theme 7 — Design and Judgment](#theme-7--design-and-judgment)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *reflexes* they keep returning to:

- **measure before you change** (a profile, not a hunch, points at the hot spot)
- **altitude before effort** (the algorithm and the amount of work dominate any constant-factor trick)
- **the machine is not flat** (a cache miss, a branch misprediction, and a dependency chain each cost real, knowable cycles)
- **the benchmark is not the system** (a faster function only helps if that function was on the critical path)

Nearly every question in this bank is one of those four reflexes wearing a costume. The candidates who do well *reach for the profiler and name the bottleneck class* before they reach for a clever rewrite.

---

## Theme 1 — CPU-Bound vs I/O-Bound and Profile-First

### Q1.1 — How do you tell whether a workload is CPU-bound or I/O-bound?

> **Testing:** Do you diagnose with a tool, or guess from the code?

**A.** I look at where the wall-clock time actually goes. The fast first cut is utilization: if a process saturates a core (`top` shows ~100% of one CPU, low `%iowait`, low `D`-state time) while throughput is the bottleneck, it's CPU-bound; if CPU sits low while latency is high and the process spends its time in `D`/`S` state waiting on disk, network, or locks, it's I/O- or wait-bound. `pidstat`, `vmstat`, and `/proc/<pid>/status` confirm it. The sharper question is *which* — a profiler that separates **on-CPU** time (where flame graphs of cycles point) from **off-CPU** time (blocked on syscalls, I/O, mutexes) tells you definitively. The trap is optimizing instruction count when the program is asleep 90% of the time waiting on a database — you'd make the 10% faster and move nothing.

### Q1.2 — "Premature optimization is the root of all evil." What did Knuth actually mean, and how do you apply it?

> **Testing:** Whether you parrot the cliché or understand the engineering discipline behind it.

**A.** The full quote is "we should forget about small efficiencies, say about 97% of the time: premature optimization is the root of all evil. Yet we should not pass up our opportunities in that critical 3%." The point isn't "never optimize" — it's *don't optimize without evidence of where the time goes*. Applied: write the clear, correct version first; if it's too slow, profile to find the real hot 3%; optimize *that* and re-measure. Optimizing the other 97% adds complexity, bugs, and review cost while buying nothing measurable. The discipline is "measure, change one thing, measure again," not abstaining from performance work.

### Q1.3 — Why is "profile first" non-negotiable rather than just good practice?

> **Testing:** Whether you know human intuition about hot spots is reliably wrong.

**A.** Because developer intuition about where time goes is wrong far more often than it's right — the cost lives in places you don't expect: a logging call in a tight loop, an accidental O(n²) from a `list.contains` inside a loop, a serialization step, a lock under contention. Profiling replaces a guess with a measured distribution. A flame graph shows the *self* time concentrated in a few frames, and that's almost never where you'd have pointed. The corollary is that every optimization needs a before/after measurement on a representative workload, because a "faster" change that you didn't measure is just as likely to be slower (it defeated a compiler optimization, blew the i-cache, or moved work off the hot path you actually profiled).

### Q1.4 — A function looks obviously inefficient in code review. Is that enough to justify rewriting it for speed?

> **Testing:** Separating readability/correctness concerns from performance ones.

**A.** No — "looks slow" is not "is on the hot path." If it's called once at startup, its constant factor is irrelevant and the rewrite only costs clarity. The right move is: is this on a measured hot path? If a profile says yes, optimize and measure. If there's no profile, the honest answer in review is "this could be simpler/clearer" (a maintainability comment) rather than "this is slow" (a performance claim you can't back). I'll happily fix a genuine algorithmic landmine I can reason about — an O(n²) in a request handler — but constant-factor "this allocates a temporary" comments need a profile behind them.

---

## Theme 2 — Optimization Altitude

### Q2.1 — Given a slow function, where do you look first: the algorithm or the micro-optimizations?

> **Testing:** Whether you optimize at the right altitude.

**A.** Algorithm first, always — it changes the *shape* of the curve, not just its height. Going from O(n²) to O(n log n) wins more at scale than any constant-factor trick, and no amount of SIMD or branchless code rescues a quadratic loop on large `n`. The hierarchy I work down: (1) **do less work** — better algorithm, better data structure, avoid recomputation (memoize/cache), avoid doing it at all (lazy, batch, dedup); (2) **better data layout** — make the work cache-friendly; (3) **micro-optimization** — branchless, SIMD, intrinsics. Micro-optimizations are constant factors; they matter only after the algorithm and data layout are right, and only on a measured hot path.

### Q2.2 — When *is* a micro-optimization the right move over an algorithmic one?

> **Testing:** That you don't dogmatically dismiss the low altitude.

**A.** When the algorithm is already optimal for the problem and the constant factor is the bottleneck — which is common in genuinely hot, small-`n`-but-called-billions-of-times code: a hash function, a parser's inner loop, a pixel kernel, a serialization path. If `n` is small and fixed, big-O is irrelevant and the constant factor *is* the performance. There, cache layout, branch elimination, and SIMD are exactly the right tools, because there's no algorithmic win left to take. The judgment is: have I exhausted "do less work," and is this provably hot? If yes, descend.

### Q2.3 — State Amdahl's law and use it to decide which hot path to attack.

> **Testing:** Quantitative reasoning about where speedup actually comes from.

**A.** Amdahl's law: if a fraction `p` of the runtime is sped up by factor `s`, total speedup is `1 / ((1 - p) + p/s)`. The lesson is that the *un-optimized* fraction caps you. If a function is 80% of runtime and I make it infinitely fast, the ceiling is `1/(1-0.8) = 5x`. If it's 5% of runtime, even a 10x win on it yields `1/(0.95 + 0.005) ≈ 1.05x` — a 5% improvement for real effort. So I attack the *largest* slice of the profile first, because the size of the slice bounds the payoff regardless of how clever the optimization is. This is why "profile first" and "altitude" are the same discipline: the profile tells you `p`, and `p` tells you whether the work is worth doing.

### Q2.4 — Your profile shows time spread evenly across 20 functions with no clear hot spot. What does that tell you?

> **Testing:** Recognizing that a flat profile is itself a diagnosis.

**A.** A flat profile usually means there's no local win to be had — the cost is *systemic*, not concentrated. Likely culprits: an algorithm whose work is genuinely distributed (so the fix is a different algorithm, not a faster function), excessive allocation/GC pressure smeared across everything, cache thrashing from a bad data layout that taxes every access, or an abstraction overhead (virtual dispatch, boxing) that's a tax on all 20 functions. The response is to step *up* an altitude: change the data representation or algorithm so there's less total work, rather than hunting for a hot function that doesn't exist. A flat profile is the signal to stop looking for a hot line and start looking at the design.

---

## Theme 3 — Memory Hierarchy and Cache

### Q3.1 — Give the rough cost, in cycles, of an L1 hit vs an L2 hit vs an LLC hit vs a main-memory access. Why do these numbers dominate optimization?

> **Testing:** Whether you know the actual shape of the memory hierarchy.

**A.** Order-of-magnitude on a modern x86 core: **L1** ~4 cycles, **L2** ~12 cycles, **L3 (LLC)** ~40 cycles, **main memory (DRAM)** ~200–300 cycles. So an LLC miss to DRAM costs roughly **50–100x** an L1 hit. They dominate because a core that retires several instructions per cycle is *starved* during a 200-cycle stall — the CPU is fast, but it spends most of its time waiting for data. That's why "make it cache-friendly" beats "do fewer instructions": eliminating one cache miss can be worth dozens of instructions. The mental model flips from "minimize operations" to "minimize and localize memory traffic."

### Q3.2 — Explain AoS vs SoA and when SoA wins.

> **Testing:** The single most common cache-layout lever.

**A.** **Array of Structs (AoS)** stores objects contiguously: `[{x,y,z,mass}, {x,y,z,mass}, ...]`. **Struct of Arrays (SoA)** stores each field in its own array: `xs[], ys[], zs[], masses[]`. SoA wins when you stream over *one or a few fields* of many objects — say, update every `x`. With AoS, each cache line (64 bytes) drags in `y`, `z`, `mass` you don't touch, so you waste most of the line's bandwidth; with SoA, the `xs` array is dense, every byte of each cache line is useful, and it also auto-vectorizes cleanly because the data the SIMD lane wants is contiguous. AoS wins when you touch *all* fields of one object at a time (better spatial locality per object) and for code clarity. The decision is driven by the *access pattern*, not the data's logical shape.

### Q3.3 — Why is pointer chasing (e.g. a linked list) often dramatically slower than iterating an array, even at the same big-O?

> **Testing:** That you see beyond asymptotic complexity to memory behavior.

**A.** Both are O(n) traversals, but they behave nothing alike on the machine. An array is contiguous: the hardware **prefetcher** detects the sequential stride and pulls the next cache lines *before* you ask, so accesses hit cache and run near peak. A linked list scatters nodes across the heap; each `node = node->next` is a **dependent load** to an unpredictable address, so the prefetcher can't help and you eat a cache miss (~200 cycles) per node, fully serialized — you can't even start the next load until the current one returns the pointer. That's the "pointer-chasing" penalty: a linked-list traversal can be 10x+ slower than the equivalent array scan despite identical asymptotics. It's why flat, contiguous structures (arrays, slices, B-trees with fat nodes) beat node-based ones (linked lists, naive binary trees) in practice.

### Q3.4 — Why do cache misses so often dominate, even when the instruction count is modest?

> **Testing:** The core "memory wall" intuition.

**A.** Because of the speed gap: cores have gotten much faster than DRAM latency has shrunk — the "memory wall." A modern core can retire ~4 instructions per cycle, so in the ~200 cycles of a DRAM miss it *could* have executed ~800 instructions. If your inner loop misses cache frequently, the CPU spends the overwhelming majority of its time stalled, and the instruction count is almost irrelevant — you're memory-latency-bound, not compute-bound. This is why a profiler that only shows time-in-function can mislead: the time is real, but the *cause* is a stall, not the instructions. Hardware counters (cache-miss rate, `MEM_LOAD_RETIRED.L3_MISS`, stalled cycles) reveal it, and the fix is a layout/access-pattern change, not fewer operations.

### Q3.5 — What is false sharing, and how do you detect and fix it?

> **Testing:** A multicore cache hazard seniors are expected to know.

**A.** **False sharing** happens when two threads write to *different* variables that happen to live on the *same 64-byte cache line*. Cache coherence works at line granularity, so each write invalidates the other core's copy of the whole line, forcing a coherence round-trip — the two threads ping-pong the line between cores even though they never touch the same data. Symptom: a parallel program that scales *negatively* (slower with more threads) on what looks like independent per-thread state, e.g. an array of per-thread counters. Detect it with `perf c2c` (cache-to-cache analysis). Fix by padding/aligning each thread's data to its own cache line (`alignas(64)`, padding fields) so independent writes land on independent lines.

---

## Theme 4 — Branch Prediction and ILP

### Q4.1 — What does a branch misprediction cost, and why?

> **Testing:** Whether you know the pipeline-flush penalty concretely.

**A.** Roughly **15–20 cycles** on a modern deep-pipeline x86 core. The CPU is pipelined and speculative: it predicts which way a branch goes and runs ahead executing the predicted path. When the prediction is wrong, all that speculative work is discarded and the pipeline is **flushed and refilled** from the correct target — and a deep pipeline means many in-flight instructions to throw away, hence the ~15–20 cycle bubble. Modern predictors are very accurate (often >95%) on predictable patterns, so the cost only bites on *data-dependent, unpredictable* branches — and there it can dominate a tight loop, because 15–20 wasted cycles per iteration is enormous next to the handful of useful ones.

### Q4.2 — The classic: "Why is processing a *sorted* array faster than an unsorted one for the same code?"

> **Testing:** The canonical branch-prediction question — do you actually understand it?

**A.** The classic case is a loop with a data-dependent branch like `if (data[i] >= 128) sum += data[i];`. On a **sorted** array the branch is highly predictable — it's false for the whole first half, then true for the whole second half — so the predictor is right ~100% of the time and the branch is nearly free. On an **unsorted** array the values are random, so the branch is a coin flip; the predictor is wrong ~50% of the time, eating a ~15–20 cycle flush on every misprediction, which can make the loop several times slower for *identical* instructions and data. The deeper point: performance depends on data *distribution*, not just the code, and the fix is to make the branch predictable or remove it — which leads to branchless code.

### Q4.3 — What does "branchless" mean, and when does it actually help?

> **Testing:** That you know branchless is a tradeoff, not a free win.

**A.** Branchless code replaces a control-flow branch with arithmetic or a conditional-move (`cmov`) / select, so there's no branch for the predictor to miss — you *always* compute both possibilities (or a mask) and pick. Example: `sum += (data[i] >= 128) * data[i]` or a `cmov`. It helps when the branch is **unpredictable** (~50/50, data-dependent), because you trade a ~15–20 cycle misprediction risk for a couple of guaranteed cheap instructions. It *hurts* when the branch is **predictable**: then the real branch is nearly free and the branchless version is pure overhead, because you're now doing the work of *both* sides every time and may have lengthened the dependency chain. So it's profile-and-measure, and it's most valuable on hot loops over random data. It also unlocks vectorization, since SIMD can't take per-lane branches.

### Q4.4 — Explain superscalar and out-of-order execution, and why they matter for optimization.

> **Testing:** A working model of the modern core beyond "it runs instructions."

**A.** A **superscalar** core has multiple execution ports and can issue/retire several instructions *per cycle* (~4–6 wide). **Out-of-order (OoO)** execution means it doesn't wait in program order — it has a window of in-flight instructions (a reorder buffer) and executes any whose inputs are ready, hiding latency by overlapping independent work (e.g., running ahead during a cache miss). The optimization consequence is **instruction-level parallelism (ILP)**: independent operations run in parallel for free, but a **dependency chain** — where each instruction needs the previous one's result — serializes execution and starves the ports. So you make code fast for the OoO engine by exposing independent work: unroll loops with multiple accumulators (break the single `sum +=` dependency chain into four parallel ones), avoid long latency-bound chains, and keep the reorder buffer fed. The core *wants* parallel work; your job is to not artificially serialize it.

### Q4.5 — Why can adding a second accumulator to a sum loop nearly double its throughput?

> **Testing:** Dependency chains and latency-vs-throughput, concretely.

**A.** A naive `for (i) sum += a[i]` has a single dependency chain: each add waits for the previous add's result, so throughput is limited by the **latency** of one add (or one FP add, ~4 cycles), not the core's ability to *issue* adds (multiple per cycle). The core's add units sit mostly idle waiting on the chain. Splitting into `sum0 += a[i]; sum1 += a[i+1];` (then combine at the end) creates *two independent chains* the OoO engine can run in parallel, so you're now limited by **throughput** instead of latency — roughly 2x, and more accumulators help until you saturate the issue ports or registers. This is the textbook demonstration that exposing ILP, not reducing instruction count, is what wins on latency-bound loops.

---

## Theme 5 — SIMD and Vectorization

### Q5.1 — What is SIMD, and what kind of work does it actually speed up?

> **Testing:** Whether you know where vectorization pays off and where it can't.

**A.** **SIMD** (Single Instruction, Multiple Data) applies one operation to a vector of lanes at once — e.g., an AVX2 256-bit register holds 8 `float`s, AVX-512 holds 16, so one instruction does 8–16 adds. It speeds up **data-parallel** work: the same independent operation over a large, contiguous array — image/audio processing, numeric kernels, dot products, bulk comparisons, string scanning. It does *nothing* for inherently serial or branchy, pointer-chasing, control-heavy code: if each element's work depends on the last, or every element takes a different path, there's no parallelism to extract. The ceiling is the lane count, but real speedups are usually below that because you become memory-bandwidth-bound — feeding 16 lanes needs data, and DRAM may not keep up.

### Q5.2 — Why does the auto-vectorizer often fail to vectorize a loop that "looks" vectorizable?

> **Testing:** Practical knowledge of what blocks the compiler.

**A.** The compiler must *prove* the transform is safe and profitable, and several things block that proof: (1) **potential aliasing** — if two pointers might overlap, the compiler can't assume independence across iterations (the fix is `restrict`/`__restrict`); (2) **loop-carried dependencies** — each iteration reading the previous result can't be parallelized; (3) **data-dependent branches** inside the loop the compiler can't turn into masks; (4) **function calls** it can't inline; (5) **non-contiguous / strided / gather access** that's too expensive to vectorize; (6) **unknown trip count or alignment** making it bail. The way to find out *why* is `-fopt-info-vec-missed` (GCC) / `-Rpass-missed=loop-vectorize` (Clang), which prints the exact reason per loop. Then you fix the blocker (add `restrict`, remove the branch, simplify the access) rather than reaching straight for intrinsics.

### Q5.3 — How does data alignment affect SIMD, and how much does it matter on current hardware?

> **Testing:** Nuance — knowing alignment matters less than it used to but still matters.

**A.** Aligned SIMD loads/stores (data on a 16/32/64-byte boundary matching the register width) let the hardware move a vector in one shot; a misaligned access historically required a slower path or could *fault* on instructions that demanded alignment. On modern Intel/AMD, unaligned `vmovups`-style loads are nearly as fast as aligned ones *when the access doesn't straddle a cache line* — the real penalty today is a **cache-line-split** or **page-split** access, which costs an extra cycle or two. So alignment matters most at the *cache-line* level: aligning hot arrays to 64 bytes avoids split penalties and lets you use aligned instructions safely. The practical move is to allocate aligned (`alignas(64)`, `posix_memalign`) for hot vectorized data, but not to agonize over it the way 2005-era advice did.

### Q5.4 — When would you hand-write intrinsics or assembly instead of trusting auto-vectorization?

> **Testing:** Judgment about the maintainability cost of going low.

**A.** Only when (a) it's a proven, profiled hot kernel, (b) the auto-vectorizer demonstrably can't do it (confirmed via the missed-optimization report) or leaves significant speedup on the table, and (c) the win justifies the cost. Intrinsics are far less portable (per-ISA: SSE/AVX/AVX-512/NEON/SVE), far harder to read and maintain, and easy to get subtly wrong; they also pin you to a microarchitecture's tradeoffs. So I'd first try guiding the compiler (`restrict`, `#pragma omp simd`, removing branches, fixing layout) and a portable wrapper library (Highway, std::simd, `xsimd`) before dropping to raw intrinsics, and I'd isolate any hand-written kernel behind a clean interface with a scalar fallback and tests. The bar is high because the maintenance tax is permanent and the hardware keeps moving.

---

## Theme 6 — Scenario and Debugging

### Q6.1 — "A service is pinned at 100% on one core while the others sit idle. Walk me through it."

> **Testing:** Calm, tool-driven triage of a CPU-bound symptom.

**A.** First, the "one core" detail is the key clue: full utilization on a *single* core with others idle means the hot work is **serialized** — either single-threaded by design, or bottlenecked on one thread (a lock everyone funnels through, a single-consumer queue, a `GIL`-style global lock). Triage:
1. Confirm it's on-CPU, not a spin-wait: `top -H` / `pidstat -t` to find *which thread* is hot, then a CPU profiler (`perf record -g`, async-profiler, `pprof`) to get a flame graph of that thread's self time.
2. Read the flame graph: is the time in real work (then it's a genuine compute hot path — optimize at the right altitude), or in lock/spin code (then it's contention masquerading as CPU — the fix is reducing the critical section or sharding the lock, not faster math)?
3. Check whether the work is *parallelizable* but isn't being parallelized — if it's embarrassingly parallel and we're using one core, the win is spreading it across cores, not micro-optimizing the single thread.

So the branch point is *real compute vs. serialization*; the flame graph decides it, and only then do I pick algorithm/layout/parallelism as the lever.

### Q6.2 — "You sped up the micro-benchmark 2x, but the production service got no faster. Why?"

> **Testing:** The benchmark-is-not-the-system reflex — the most important scenario here.

**A.** Several classic reasons, and I'd check them in order:
1. **The function wasn't on the critical path.** Amdahl: if it was 5% of real runtime, a 2x win is ~2.5% overall, lost in the noise. The micro-benchmark over-weighted it.
2. **The service is bound on something else** — I/O, DB, network, lock contention, GC. You optimized CPU in a system that was waiting, not computing.
3. **The micro-benchmark was unrealistic** — hot caches, predictable data, a fixed small input, no contention. In production the inputs are larger/random, caches are cold and shared, and the function competes for memory bandwidth with everything else, so the isolated win doesn't reproduce.
4. **The benchmark measured the wrong thing** — dead-code elimination removed the work, or the JIT/optimizer specialized for the benchmark's constant inputs, so the "2x" was partly an artifact.
5. **Down-stream bottleneck moved, not removed** — you sped up stage A, but stage B is now the bottleneck and total throughput is unchanged.

The discipline is to validate optimizations against a *representative, end-to-end* measurement (production-like load, real data distribution), not just the isolated micro-benchmark — and to confirm with the production profile that the slice you optimized was actually large.

### Q6.3 — A loop got *slower* after you "optimized" it. What are the usual culprits?

> **Testing:** Knowing that hand-optimization frequently backfires.

**A.** Common ones: (1) you **defeated a compiler optimization** — manual unrolling or pointer tricks that stopped auto-vectorization or inlining, so the "smarter" code is slower than what the compiler would have produced; (2) you **lengthened a dependency chain** or added work to both sides of a now-branchless path that was actually predictable; (3) you **hurt the cache** — a layout change that improved one access pattern wrecked another, or bloated the working set past a cache level; (4) you grew the **code size** and blew the i-cache / hurt the front end; (5) the **benchmark was noisy** and the "regression" is measurement variance (no warmup, frequency scaling, noisy neighbor). The fix is the same discipline as before: measure with a stable harness, change one thing, compare, and read hardware counters to see *which* resource got worse rather than guessing.

### Q6.4 — Throughput is fine but tail latency (p99) is bad on a CPU-bound service. How do you reason about it?

> **Testing:** Distinguishing throughput optimization from latency, and tail-specific causes.

**A.** Good average throughput with a bad tail says the median request is fine but some requests hit a cliff — and the causes are often *not* the average-case hot path. Suspects: **GC / allocation pauses** (a stop-the-world or large collection stalls whatever request is unlucky), **scheduling** (the request gets preempted, or migrated to a cold cache on another core — cache locality lost), **lock contention** spikes under burst load, **data-dependent work** where rare inputs take a much longer path (a degenerate hash bucket, a large outlier payload), and **occasional cache/TLB thrash**. So I'd profile the *slow* requests specifically (tail tracing, per-request spans), look at GC logs and run-queue latency, and check for input-dependent worst cases. The lever is different from throughput work: pin/affinity for cache locality, reduce allocation to cut GC, bound worst-case input handling — optimizing the mean often does nothing for p99.

---

## Theme 7 — Design and Judgment

### Q7.1 — What is Profile-Guided Optimization (PGO), and when is it worth the build complexity?

> **Testing:** Knowing a real compiler lever and its operational cost.

**A.** **PGO** compiles in two phases: build an instrumented binary, run it on a *representative* workload to collect a profile (which branches go which way, which functions are hot, which calls are common), then recompile using that profile so the compiler can lay out code for the real execution pattern — putting hot paths together for i-cache locality, predicting branches correctly, inlining the genuinely hot calls, and moving cold code out of line. Typical wins are **5–20%** on branch- and i-cache-bound workloads (compilers, interpreters, large services) for *no source change*. It's worth it when the workload is stable and representative enough to profile, you have a hot, branchy, large-codebase service where front-end stalls matter, and you can automate the two-phase build in CI. The cost is exactly that operational complexity plus a representative profile you must keep fresh; for small or wildly variable workloads the win isn't worth the pipeline. (AutoFDO, which samples production with `perf`, lowers the collection cost.)

### Q7.2 — You've optimized a hot path in your managed-language service as far as it'll go. When do you drop to C/Rust, and what's the real cost?

> **Testing:** Judgment about the FFI/native boundary, not just "native is faster."

**A.** I'd consider it only for a *small, proven, hot kernel* where the managed runtime's overhead (GC pressure, bounds checks I can't elide, lack of SIMD control, boxing) is the demonstrated bottleneck and I've exhausted in-language options. The classic shape is a numeric/parsing/crypto inner loop. The real costs: an **FFI boundary** isn't free — marshaling and the call overhead can eat the win if the kernel is small or called chattily, so it pays only when each call does substantial work; you take on a **build/toolchain** burden (cross-compilation, ABI, packaging the native artifact per platform); you lose memory safety guarantees (Rust mitigates this vs C); and you **fragment the codebase**, raising the bar for who can maintain it and how you debug across the boundary. So the decision is: is the kernel small enough to rewrite, hot enough to matter, and coarse-grained enough that FFI overhead is amortized — and is the team prepared to own native code? If any answer is no, I keep optimizing in-language or rethink the algorithm.

### Q7.3 — How do you weigh a 15% speedup against the maintainability cost of the code that achieves it?

> **Testing:** The senior tradeoff — performance is not free of engineering cost.

**A.** I price both sides. On the value side: *where* is the 15% — is it on a path that matters to users (p99 latency, a cost-driving batch job, a capacity ceiling we're hitting), or a number nobody feels? 15% off a service that's at 90% capacity may defer a costly scale-out; 15% off a nightly job with hours of slack is worth little. On the cost side: how much does the optimization obscure the code, how many people can now safely change it, what's the risk of a subtle correctness bug (branchless/SIMD/native code is easy to get wrong), and is it pinned to a microarchitecture that'll shift? My defaults: isolate the optimization behind a clean interface with a tested scalar/simple fallback, comment *why* (with the measurement that justified it), and only accept the complexity when the win is on a path that demonstrably matters. Unmotivated cleverness is a liability; a measured, contained, documented optimization on a hot path is good engineering. The worst outcome is hard-to-read code that's also not on the critical path.

### Q7.4 — A teammate wants to rewrite a core module in branchless SIMD for performance. How do you evaluate the proposal?

> **Testing:** Bringing all the disciplines together as a review.

**A.** I'd ask for evidence and scope before any code. Questions: (1) **Is it on a measured hot path?** Show me the production profile and the slice size (Amdahl ceiling). (2) **What's the expected win, end-to-end, not in a micro-benchmark?** (3) **Has the cheaper altitude been exhausted** — algorithm, data layout, guiding the auto-vectorizer with `restrict`/pragmas — before going to hand-written intrinsics? (4) **What's the maintenance and portability cost** — which ISAs, is there a scalar fallback, who owns it, how is it tested for correctness against the scalar version? If it survives that: it's a proven hot path, the cheaper options are exhausted, the win is real end-to-end, and it's contained behind an interface with a tested fallback — then yes. If it's speculative cleverness on an unprofiled module, no: the most likely outcome is a hard-to-maintain module that didn't move the needle. The review *is* the discipline: measure, altitude, representative benchmark, contained complexity.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Roughly, L1 vs DRAM latency?** A: ~4 cycles vs ~200–300 cycles — DRAM is ~50–100x slower, which is why cache behavior dominates.
- **Q: Cost of a branch misprediction?** A: ~15–20 cycles — the pipeline flushes and refills from the correct target.
- **Q: AoS vs SoA — when SoA?** A: When you stream over one or a few fields of many objects; it keeps cache lines dense and auto-vectorizes.
- **Q: Why is a linked list slow to traverse vs an array at the same O(n)?** A: Dependent loads to scattered addresses defeat the prefetcher — a cache miss per node, fully serialized.
- **Q: State Amdahl's law.** A: Speedup = 1 / ((1 − p) + p/s); the un-optimized fraction caps total speedup.
- **Q: When is branchless code a win?** A: When the branch is unpredictable (~50/50); it's a loss when the branch is predictable.
- **Q: What is ILP?** A: Instruction-level parallelism — independent ops the out-of-order, superscalar core runs at once.
- **Q: Why add multiple accumulators to a reduction loop?** A: To break the single dependency chain so independent chains run in parallel — latency-bound becomes throughput-bound.
- **Q: One reason auto-vectorization fails?** A: Possible pointer aliasing — the compiler can't prove iterations are independent (fix with `restrict`).
- **Q: What is false sharing?** A: Two threads writing different variables on the same cache line, ping-ponging it between cores.
- **Q: What does SIMD *not* help?** A: Serial, branchy, or pointer-chasing work with no data parallelism to extract.
- **Q: What does PGO do?** A: Recompiles using a profile of a real run to lay out code, predict branches, and inline hot calls.
- **Q: First step for any CPU-perf problem?** A: Profile on a representative workload — never guess the hot spot.
- **Q: What flag shows why a loop didn't vectorize?** A: `-fopt-info-vec-missed` (GCC) / `-Rpass-missed=loop-vectorize` (Clang).

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Reaching for micro-optimizations before profiling or before checking the algorithm.
- Quoting "premature optimization is evil" as a reason to never measure or improve anything.
- Treating big-O as the whole story — ignoring cache behavior, branches, and memory layout.
- Believing a micro-benchmark win automatically helps the service.
- "Branchless is always faster" / "SIMD is always faster" — no sense of when each is a loss.
- Optimizing CPU on a workload that's actually I/O- or lock-bound.
- Proposing hand-written intrinsics or a native rewrite with no profile and no fallback.

**Green flags:**
- Profiling first and naming the bottleneck *class* (compute vs cache vs branch vs contention) before choosing a tool.
- Using Amdahl's law to justify *which* hot path to attack.
- Knowing real numbers — cache-miss ~200 cycles, mispredict ~15–20 cycles — and using them to reason.
- Explaining the sorted-array result via branch prediction unprompted.
- Validating optimizations end-to-end on representative load, not just micro-benchmarks.
- Treating SIMD/native/branchless as measured, contained tradeoffs with a fallback — not reflexes.
- Recognizing a flat profile, false sharing, or a latency-vs-throughput distinction as the actual diagnosis.

---

## Summary

- The bank reduces to four reflexes, repeated in costumes: **measure before you change**, **altitude before effort**, **the machine is not flat**, and **the benchmark is not the system**. Reach for the profiler and name the bottleneck class first; the technique follows.
- **CPU vs I/O and profile-first:** classify on-CPU vs off-CPU time with tools; intuition about hot spots is reliably wrong; every optimization needs a before/after on representative load.
- **Altitude:** algorithm and "do less work" change the curve's shape and dominate constant-factor tricks; Amdahl's law (`1/((1−p)+p/s)`) tells you the largest slice is the only one worth attacking; a flat profile is a design-level diagnosis.
- **Memory hierarchy:** L1 ~4 vs DRAM ~200–300 cycles makes cache misses dominate; SoA keeps cache lines dense and vectorizes; pointer chasing defeats the prefetcher; false sharing ping-pongs lines between cores.
- **Branches and ILP:** a mispredict costs ~15–20 cycles; the sorted-array case is predictable-vs-coin-flip branches; branchless helps *only* on unpredictable branches; the superscalar OoO core wants independent work, so break dependency chains (multiple accumulators) to turn latency-bound into throughput-bound.
- **SIMD:** speeds up contiguous data-parallel work up to the lane count (often memory-bandwidth-capped); auto-vectorization fails on aliasing, loop-carried deps, and branches — read the missed-optimization report; alignment matters most at the cache-line level; intrinsics only for proven kernels with a fallback.
- **Scenarios:** "one core at 100%" is serialization vs real compute — the flame graph decides; a 2x micro-benchmark that moved nothing means it wasn't on the critical path or the system is bound elsewhere; tail latency has its own causes (GC, scheduling, input-dependent worst cases) distinct from throughput.

---

## Further Reading

- *Computer Systems: A Programmer's Perspective* (Bryant & O'Hallaron) — Chapters 5 and 6, optimization and the memory hierarchy. The reference for cache behavior and ILP.
- Ulrich Drepper, *What Every Programmer Should Know About Memory* — the definitive treatment of caches, prefetching, and access patterns.
- Agner Fog's optimization manuals — microarchitecture, instruction latencies/throughputs, and vectorization, primary-source detail.
- Denis Bakhvalov, *Performance Analysis and Tuning on Modern CPUs* — top-down analysis, hardware counters, and the modern toolchain.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.
- `man perf`, `perf list`, `perf c2c`, and your compiler's `-fopt-info` / `-Rpass` flags — primary sources for the tooling the answers reference.

---

## Related Topics

- [02 — Benchmarking and Microbenchmarks](../02-benchmarking-and-microbenchmarks/interview.md) — how to measure correctly so a "2x win" is real, not an artifact.
- [01 — Performance Fundamentals](../01-profiling/01-cpu-profiling/interview.md) — latency vs throughput, percentiles, and the mental models these answers assume.
- [03 — Memory and Allocation](../05-memory-and-allocation-profiling/interview.md) — allocation, GC pressure, and the memory side of the tail-latency story.
- [Performance README](../README.md) — where CPU-bound optimization sits in the broader performance landscape.

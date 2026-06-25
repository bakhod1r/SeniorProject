> Interview questions on measuring before optimizing — the Knuth quote in context, Amdahl's law, percentiles vs averages, profiling tools, benchmark lies, and knowing when to stop. Answers are short and precise, with the traps and follow-ups interviewers use to separate people who *cite* the ideas from people who *apply* them.

---

## Q1. What does Knuth actually mean by "premature optimization is the root of all evil"?

The line is quoted to mean "never optimize," which is the opposite of his point. The full sentence (Knuth, *Structured Programming with go to Statements*, 1974) is: "We should forget about small efficiencies, say about 97% of the time: premature optimization is the root of all evil. **Yet we should not pass up our opportunities in that critical 3%.**" It's a *pro-measurement* argument: don't waste effort micro-optimizing the 97% that doesn't matter, but *do* optimize the critical 3% — once you've **measured** which 3% it is.

**Trap:** using the quote to justify shipping known-quadratic code. Knuth isn't excusing bad algorithm choice; choosing an O(n log n) over O(n²) up front is good engineering, not premature optimization.

## Q2. State Amdahl's law and why it matters before optimizing.

`Speedup_max = 1 / ((1 − p) + p/s)`, where `p` is the fraction of total time in the part you're improving and `s` is the speedup of that part. It matters because it caps your win by `p`: if a section is 5% of runtime, even an infinite speedup gives at most `1/0.95 ≈ 1.05×` — a 5% gain. It's the math behind "profile first": optimizing a small-`p` component is futile no matter how clever the fix.

**Follow-up:** *A function is 5% of runtime and you make it 10× faster — what's the overall speedup?* `1/(0.95 + 0.005) = 1.047×`, about 4.5%. Not worth it.

## Q3. Why report p99 instead of the average latency?

The average hides the tail, and the tail is what users feel. A mean of 31 ms can coexist with p99 = 850 ms — 1 in 100 requests is slow. Worse, in fan-out systems the tail compounds: if a page makes 50 backend calls each with a 1% chance of being p99-slow, the chance at least one is slow is `1 − 0.99^50 ≈ 39%`. So tail latency of components becomes typical latency of the page — the thesis of Dean & Barroso's *The Tail at Scale* (2013). Percentiles for anything a human waits on; the mean is for throughput aggregates.

**Trap:** averaging percentiles across servers. You cannot average p99s — percentiles aren't additive; you must merge the underlying distributions (e.g. histograms).

## Q4. Your micro-benchmark says a function runs in 0.3 ns. Why don't you believe it?

0.3 ns is roughly one CPU cycle — the work was almost certainly **eliminated**. Likely causes: dead-code elimination (the result is unused, so the compiler deleted the call), or constant folding (fixed inputs let it precompute the answer). Fix it by consuming the result (assign to a sink that escapes, return it, or use the language's benchmark "keep" primitive) and by using non-constant inputs.

**Follow-up:** *Other benchmark lies?* No JIT warmup (first iterations run interpreted, 10–50× slower), unrealistic data (sorted when prod is random, all-cache-hit), and too-small inputs that fit in L1 when prod spills to RAM.

## Q5. CPU is at 20% but p99 latency is terrible. Where do you look?

**Off-CPU.** Low CPU utilization with high latency means the threads are *waiting*, not computing — blocked on I/O, a lock, a downstream service, or GC pauses. A CPU (on-CPU) flame graph will show almost nothing useful here because the time isn't being spent on CPU. Use off-CPU profiling, distributed tracing, or wait-time analysis. The USE method names this directly: low utilization + high latency points away from that resource.

**Trap:** profiling on-CPU because that's the default tool; it's the most common misdiagnosis.

## Q6. Explain the USE method.

Brendan Gregg's checklist applied to each resource (CPU, memory, disk, network, locks): **U**tilization (% busy), **S**aturation (queued work it can't yet service), **E**rrors. It's a systematic way to find the *constraining* resource fast — e.g. high disk utilization *and* saturation means disk is the bottleneck; CPU at 95% with a deep run queue means CPU. It stops you from random profiling by pointing at the saturated resource first.

## Q7. How do you read a flame graph?

Width = time (sample count) on CPU; the y-axis is stack depth. You scan for **wide boxes** — wide means hot — and ignore narrow towers. Color is usually just contrast, not meaningful. A wide `json.Marshal` frame says serialization is the cost; go optimize there. An *off-CPU* flame graph flips the meaning to blocked/wait time, revealing latency a CPU profile misses.

**Trap:** thinking tall = slow. Depth is just call nesting; only *width* indicates cost.

## Q8. Difference between a micro-benchmark and a macro-benchmark, and when to use each?

A micro-benchmark measures one function in isolation — precise but easily fooled by compiler optimizations and unrealistic conditions. A macro-benchmark measures an end-to-end path — realistic but noisier and harder to attribute. Use macro profiling to **find** the bottleneck (what's actually hot under real load), then a micro-benchmark to **compare two implementations** of that already-identified hot path. Never use a micro-benchmark to decide *what* is hot.

## Q9. What's the observer effect in profiling, and which profiler avoids it?

Instrumentation isn't free, and heavy instrumentation distorts what it measures. **Instrumenting (tracing) profilers** wrap every call — 2–10× overhead, and they over-inflate cheap, frequently-called functions, lying about where time goes. **Sampling profilers** interrupt at a fixed rate (e.g. 99 Hz) and read the stack — ~1–5% overhead, roughly uniform, so the *shape* stays honest. Use sampling to find hotspots; trust tracing's absolute numbers only with caution for tiny hot functions.

## Q10. You optimized something and it's 3% faster. Ship it?

Not on that evidence. 3% is likely inside the noise band of a benchmark. Run N samples of before and after, and test for significance — e.g. `benchstat` reporting the delta with a confidence interval and p-value (`p < 0.05`). Also control the environment: pinned CPU frequency, isolated cores, quiet hardware — cloud VMs can swing ±30% run-to-run and swamp a real 3% signal. If the improvement isn't statistically distinguishable from noise, you're shipping added complexity for nothing.

## Q11. When is the correct answer "stop optimizing"?

When the requirement is met. If the SLO is p99 < 200 ms and you're at 150 ms, you're done — driving it to 80 ms spends engineering time and adds risk (every optimization is complexity and bug surface) for a number no user or contract requires. "Fast enough relative to the SLO" is the disciplined answer. Define the SLO *first* so "done" is a measurable state, not a feeling. This is Knuth's "forget small efficiencies 97% of the time" in practice.

**Follow-up:** *How does an error budget make this a fundable decision?* If you're within budget, latency work is deprioritized for features; if you're burning it, the work gets funded. The budget turns "stop" into a governed choice rather than a personal judgment.

## Q12. What makes a workload "representative," and why does it matter?

It must match production in **size** (real cardinality, not a 10-row fixture), **shape** (real key distribution — Zipfian/skewed with hot keys, not uniform-random), and **mix** (real read/write ratio and request-type proportions). It matters because optimizing against an unrepresentative load tunes your code for a world that doesn't exist — e.g. a 99% cache hit rate on uniform keys collapses to 60% on production's skewed keys, and your "optimized" path is actually slower in reality.

## Q13. How do you derive the floor a system can physically reach?

Reason from first principles using known latency constants: a cross-region round trip is ~70 ms, an SSD random read ~100 µs, a same-DC RTT ~500 µs, a main-memory reference ~100 ns. If a request *must* make two cross-region trips, its floor is ~140 ms — no code change beats physics. The floor tells you whether you're 2× off it (worth chasing) or already there (stop) or 50× off (something structural is broken, so don't micro-optimize — fix the architecture).

## Q14. Walk through your end-to-end loop for an optimization.

(1) Pick the metric and target (p99 < 200 ms). (2) Build a representative workload; take a baseline with variance. (3) Profile to find the dominant `p` (the right *kind* of profiler — on-CPU vs off-CPU). (4) Compute the Amdahl ceiling — is the win even possible? If `p` is tiny, stop. (5) Write a falsifiable hypothesis with a predicted number and a kill condition. (6) Change one thing. (7) Re-measure under the same load; confirm the win beats both the prediction and the noise band (significance test). (8) Keep or revert; stop when the SLO is met.

## Q15. A teammate wants to rewrite a hot loop in assembly for a 2× speedup. The loop is 4% of runtime. Your response?

Compute the ceiling first: `p = 0.04`, `s = 2` → `1/(0.96 + 0.02) = 1.02×`, a 2% overall gain — for a large jump in complexity, unportability, and maintenance/bug risk. Amdahl says no. Redirect the effort to whatever the profiler shows as the dominant `p`. If *nothing* dominates and the system already meets its SLO, the right answer is to do neither and ship features. This is precisely the "critical 3%" judgment Knuth was pointing at — and this loop isn't in it.

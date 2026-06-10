# Premature Optimization Traps — Interview Questions

> **Category:** [Performance Anti-Patterns](../README.md) → **Premature Optimization Traps** — *code twisted for speed that was never measured and rarely matters.*

---

This file is a question bank for interviews — both as the interviewee (preparing) and the interviewer (probing depth). Questions run from junior recognition to staff-level judgment. Each has a model answer; the strongest answers tie back to **measure-first**, the **full Knuth quote**, and the line between **design** and **premature optimization**.

> **How to use this file:** answer out loud *before* expanding. A surface answer recites "premature optimization is the root of all evil"; a strong answer measures, distinguishes design from optimization, and names the cost of getting it wrong.

---

## Table of Contents

- [Fundamentals (1–10)](#fundamentals)
- [Measurement & Workflow (11–18)](#measurement--workflow)
- [Judgment & Trade-offs (19–26)](#judgment--trade-offs)
- [Hard / Staff-Level (27–34)](#hard--staff-level)

---

## Fundamentals

### 1. What is premature optimization, in one sentence?

<details><summary>Answer</summary>

Optimizing before (or without) measuring — trading readability or correctness for speed that was never shown to matter, usually on code that isn't even hot. The defining feature is the **trade made without evidence**.

</details>

### 2. Quote Knuth's line in full. What does the part everyone omits mean?

<details><summary>Answer</summary>

*"We should forget about small efficiencies, say about 97% of the time: premature optimization is the root of all evil. **Yet we should not pass up our opportunities in that critical 3%.**"* The omitted half says performance **does** matter in a small, critical slice — and the skill is telling the 3% from the 97% by **measuring**. Knuth is pro-optimization-of-the-right-thing, not anti-optimization.

</details>

### 3. Three conditions must all hold for code to be a premature optimization. Name them.

<details><summary>Answer</summary>

(1) It's harder to read or more error-prone than the obvious version; (2) there's no benchmark/profile justifying it; (3) it's not on a proven hot path. If any one is false it may not be the trap — clear-but-fast code is just good code; ugly-but-benchmarked-hot code is justified.

</details>

### 4. Is using a `HashMap` instead of a list-scan for a frequent lookup premature optimization?

<details><summary>Answer</summary>

No — it's **clarity-neutral** and it's **design**. The `map` reads as clearly as the scan, it's driven by the known problem shape (a repeated lookup), and it picks the right complexity class. Premature optimization requires *trading* clarity for *unmeasured* speed; there's no trade here.

</details>

### 5. A teammate replaces `a + b` (two strings) with a `StringBuilder` chain "for performance." Verdict?

<details><summary>Answer</summary>

Premature. `javac` already compiles `a + b` to efficient bytecode (often identical or better). The chain adds ceremony and reduces readability for **zero measured gain** — all three trap conditions hold. The compiler already did the optimization.

</details>

### 6. What's the difference between an optimization and just "picking the right tool"?

<details><summary>Answer</summary>

An optimization is a **trade** — you spend readability/correctness to buy speed. Picking the right tool (a set for membership, streaming a big file) costs *nothing* and isn't a trade, so it isn't optimization at all — it's design/competence. Only trades can be premature.

</details>

### 7. Why is "make it correct, then clear, then fast" the right ordering?

<details><summary>Answer</summary>

Correctness and clarity apply to all code; "fast" applies only to the profiled hot slice. A clear, correct function is **easy to optimize later** if it turns out hot — you can see what it does. A prematurely-optimized one is the opposite: you can't safely change it (can't tell what it does) and can't tell if the optimization even helps (nobody measured).

</details>

### 8. Give three concrete shapes of premature optimization.

<details><summary>Answer</summary>

Any three: hand-unrolled loops; bit-tricks for clarity-cost; caching/memoizing a cheap computation; `StringBuilder` for two strings; object pooling with no contention; hand-inlining "to avoid the call"; a complex algorithm for n=10; optimizing the error/cold path.

</details>

### 9. Why does optimizing the error path rarely help?

<details><summary>Answer</summary>

The error/failure path runs ~never under normal load, so it's cold by definition. Time spent making it fast targets ~0% of runtime — Amdahl caps the win near zero. You paid readability for nothing.

</details>

### 10. Is avoiding premature optimization an excuse to write wasteful code?

<details><summary>Answer</summary>

No — that's the opposite failure (death by a thousand cuts). **Clarity-neutral efficiency** (right structure, read-once, no needless copies) is free and should be applied everywhere, always, without measurement. The anti-pattern is specifically sacrificing *clarity/correctness* for *unmeasured* speed — not being efficient when it's free.

</details>

---

## Measurement & Workflow

### 11. Walk me through the measure-first workflow.

<details><summary>Answer</summary>

Define "fast enough" (a target/SLO) → profile under a realistic workload → find the hotspot → benchmark a candidate fix in isolation → keep it only if the improvement is statistically real → leave everything the profiler didn't flag clear → re-profile (fixing one hotspot reveals the next). Stop when you hit the target.

</details>

### 12. What's the 90/10 rule and what does it imply about optimization?

<details><summary>Answer</summary>

~90% of runtime is in ~10% of the code. So optimizing the 10% can win big; optimizing the 90% is near-worthless. Critically, you **can't find the 10% by reading** — it's set by the workload (how often each path runs), which is invisible in source. Hence: profile, don't guess.

</details>

### 13. A function is 5% of runtime. You make it free. Maximum whole-program speedup? What law?

<details><summary>Answer</summary>

~5.3% (1/(1−0.05) − 1). **Amdahl's Law.** It bounds the payoff of optimizing any single part by that part's share of runtime — which is why optimizing a small-share function (the usual premature target) is capped low no matter how clever the optimization.

</details>

### 14. Name a profiler and a benchmark tool for Go, Python, and Java.

<details><summary>Answer</summary>

**Profilers (where time goes):** Go `pprof`; Python `cProfile`/`py-spy`; Java JFR/async-profiler. **Benchmarks (did the fix help):** Go `testing.B` + `benchstat`; Python `timeit`/`pyperf`; Java JMH.

</details>

### 15. Why is a single benchmark run meaningless?

<details><summary>Answer</summary>

One number folds in GC pauses, scheduling, CPU turbo/throttle, and cache state — pure noise. You need many runs and a *distribution*: `benchstat` reports a p-value; if it prints `~ (p>0.05)`, the "improvement" is within the noise band and isn't real.

</details>

### 16. What is dead-code elimination in benchmarking and how do you defeat it?

<details><summary>Answer</summary>

If a benchmark's computed result is unused, the optimizer deletes the work — you measure *nothing* and it looks infinitely fast. Fix: consume the result. JMH `Blackhole.consume(x)`; Go assign to a package-level `sink` or `runtime.KeepAlive`; return it so it escapes.

</details>

### 17. Why must JVM microbenchmarks include warm-up?

<details><summary>Answer</summary>

The JVM starts interpreted, then compiles hot methods with C1, then C2. The first iterations run cold/unoptimized code, so timing them measures the wrong thing. JMH runs warm-up iterations (`-wi`) before measuring so you time the steady-state JIT-compiled version — the one production runs.

</details>

### 18. You're told "this endpoint is slow." First action, and what you explicitly avoid?

<details><summary>Answer</summary>

**First:** profile it under a realistic workload to find where the time actually goes. **Avoid:** rewriting the function you *guess* is slow — the hotspot is frequently elsewhere (e.g., an N+1 query, not the arithmetic you eyeballed). Guessing is the engine of premature optimization.

</details>

---

## Judgment & Trade-offs

### 19. Is choosing the right algorithm up front premature optimization?

<details><summary>Answer</summary>

No — it's **design**. Picking O(n) over O(n²) when it's the same code, driven by the known problem shape, costs no readability and is expensive to fix later. Knuth's caution is about *small efficiencies* (constant factors), not about choosing the right complexity class. Conflating them is the over-corrected failure.

</details>

### 20. Where exactly is the line between design and premature optimization?

<details><summary>Answer</summary>

**Design** = up-front, evidence-free, *free* decisions about the complexity class and structure from the known problem (map for a lookup, stream a huge file, no N+1-forcing API). **Optimization** = shaving constant factors with a clarity cost (bit-packing, hand-unroll, pools), which you defer until a profile points at it. The test: if the efficient choice costs the *same* readability as the inefficient one, it's design, not optimization.

</details>

### 21. When is a clarity-costing micro-optimization justified?

<details><summary>Answer</summary>

When **all** hold: a profile proves it's hot; a benchmark proves the win is statistically real; the win moves a number you care about (SLO/cost/latency); and it's guarded by a committed benchmark + documented *why*. The difference from the anti-pattern is the **evidence**, not the code — identical cleverness with no profile/benchmark is premature.

</details>

### 22. A hot path genuinely needs ugly code. How do you keep it from rotting the codebase?

<details><summary>Answer</summary>

**Box it.** Hide it behind a clean interface (`encoder.Encode`); keep a reference/slow version as an oracle (property test `fast(x)==slow(x)`); pin it with a committed benchmark so CI catches regressions and proves it's load-bearing; comment the *why* (profiled %, measured speedup), not the *what*. The boundary stops one justified opt from becoming a culture of premature cleverness.

</details>

### 23. As a reviewer, what do you ask when you see a performance-motivated change?

<details><summary>Answer</summary>

"Where's the profile (which flame graph is this on)?" "Where's the benchmark (before/after, with variance)?" "Is this path actually hot, or is it cold/startup/error code?" "What did it cost in readability and correctness?" "Will it stay correct — is there a benchmark guard and a test oracle?" No profile + no benchmark ⇒ premature until proven otherwise.

</details>

### 24. Distinguish premature optimization from death by a thousand cuts.

<details><summary>Answer</summary>

Premature optimization = one cold function twisted for unmeasured speed (often no profile was even taken). Death by a thousand cuts = a **flat profile** where *everything* is 1–3% wasteful, summing to slow with no hotspot. **Opposite cures:** the first needs "stop, profile, keep it clear"; the second needs a *pervasive* clarity-neutral efficiency discipline (or a systemic lever), because no single fix exists.

</details>

### 25. How do SLOs/perf budgets resolve "is this worth optimizing?"

<details><summary>Answer</summary>

They turn it into arithmetic. Define an SLO (p99 ≤ 200ms), budget it across stages, then optimize **only** the over-budget stage, **only** until it's back under budget, then **stop**. A stage under budget is off-limits — optimizing it is premature by definition even with a profile. The budget forbids both premature optimization and the never-optimize over-correction.

</details>

### 26. "We don't do premature optimization here." When is this advice wrong?

<details><summary>Answer</summary>

When the profile is **flat** (death by a thousand cuts) — there the cure *is* pervasive efficiency, and the slogan blocks it. Also when someone uses it to reject a **free** clarity-neutral win (a set over a scan) or to justify an O(n²) design. The slogan assumes a spiky profile and a clarity *trade*; it's wrong when neither holds.

</details>

---

## Hard / Staff-Level

### 27. Does the compiler/JIT already do most micro-optimizations? Prove it.

<details><summary>Answer</summary>

Yes on Go/JVM. Go: `go build -gcflags='-m -m'` shows inlining and escape-analysis stack allocation — hand-inlining or pooling what it already handles is pure liability. JVM: `-XX:+PrintInlining`/`-XX:+PrintCompilation` shows C2 inlining hot methods, eliminating provable bounds checks, devirtualizing monomorphic calls, and SuperWord-vectorizing counted loops. Hand-unrolling often *defeats* vectorization → a regression. (CPython is the exception: no JIT pre-3.13, so the real lever is dropping the hot loop to C/NumPy, not bytecode tweaks.)

</details>

### 28. Why can hand-unrolling a loop be slower on the JVM than the clean version?

<details><summary>Answer</summary>

C2's SuperWord pass auto-vectorizes simple counted loops into SIMD. A hand-unrolled loop often has a shape the vectorizer no longer recognizes, so it falls back to scalar code — slower than the clean loop the JIT *would* have vectorized. You out-clevered yourself into a regression, visible via `-XX:+PrintAssembly`.

</details>

### 29. What are the real costs of a premature optimization beyond wasted effort?

<details><summary>Answer</summary>

**Bugs** (clever code is harder to get right — pools hand back live objects, bit tricks have sign-extension errors, caches go stale); **blocked refactors** (optimized code is rigid, freezes the design where it should stay fluid); **maintenance tax** (every reader/change pays); **stolen attention** (budget spent off the real 3%); **false confidence**. The asymmetry: imaginary unmeasured upside vs. real downside — an irrational trade.

</details>

### 30. A benchmark says your change is infinitely fast. What happened?

<details><summary>Answer</summary>

Dead-code elimination (or constant folding) — the result was unused or compile-time-known, so the optimizer deleted the work. You measured nothing. Fix: consume the result (Blackhole/sink/KeepAlive) and feed inputs the compiler can't see at compile time.

</details>

### 31. Your single biggest profile frame is 8%. The system is over budget by 40%. Diagnosis?

<details><summary>Answer</summary>

**Death by a thousand cuts.** Even zeroing the top frame (Amdahl: ≤8.7% win) leaves you far over budget — there's no hotspot to fix. The cure is a broad clarity-neutral sweep across the many small frames, or a *systemic* lever (allocator, framework, data layout) that moves all of them at once — not a hotspot hunt.

</details>

### 32. When *should* you fight the compiler and write the manual micro-opt?

<details><summary>Answer</summary>

Only when a benchmark proves the manual version actually beats the optimizer's on *this* toolchain version, on a *profiled* hot path, and the win matters (SLO/cost). Then box it behind an interface, guard it with the benchmark, and **re-check on toolchain upgrades** — optimizers improve, and your manual version can silently become the slow path. It's an expert, evidence-gated exception, not a default.

</details>

### 33. How do you optimize a hot path in CPython, given there's no JIT?

<details><summary>Answer</summary>

Don't hand-tune bytecode — that's maximally premature (tiny win, big readability cost). Move the hot loop *out of Python*: vectorize with NumPy, call a C extension/Cython, batch the work, or run on PyPy. The lever in Python is almost always "stop looping in the interpreter," not "tweak the interpreter loop."

</details>

### 34. Reconcile "keep code clear" with "the hot path needs to be ugly."

<details><summary>Answer</summary>

They're not in conflict once you scope them. ~99% of code stays clear (it's cold; optimizing it is premature). The ~1% the profile proves hot may need ugly code — and you **box it**: ugly *inside* a clean interface, with a benchmark guard and a reference oracle. The boundary lets the 1% be fast and the 99% be clear, and stops the ugliness (and the cargo-cult instinct to copy it) from spreading.

</details>

---

## Related Topics

- [`junior.md`](junior.md) · [`middle.md`](middle.md) · [`senior.md`](senior.md) · [`professional.md`](professional.md) — the full conceptual arc these questions test.
- [`tasks.md`](tasks.md) — hands-on exercises (profile a hotspot, revert an unhelpful micro-opt, write a guarding benchmark).
- [`find-bug.md`](find-bug.md) — spot measured-vs-guessed optimization in snippets.
- [N+1 in Code](../02-n-plus-one-in-code/junior.md) · [Unnecessary Allocation](../03-unnecessary-allocation/junior.md) · [Wrong Data Structure](../04-wrong-data-structure/junior.md) — the real hotspots a profile points at.
- [Over-Engineering → senior.md](../../01-development/03-over-engineering/senior.md) — speculative perf work as over-engineering.
- The `profiling-techniques` and `big-o-analysis` skills — the measurement and complexity foundations behind every strong answer.

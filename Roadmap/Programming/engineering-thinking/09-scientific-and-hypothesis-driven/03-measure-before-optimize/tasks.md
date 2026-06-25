> Practice tasks for measuring before optimizing. Global constraints: **show the number** for every conclusion (no "feels faster"); **change one thing per measurement**; **state your metric** (p50/p99/throughput/allocs) before reporting it; and for every optimization decision, **compute the Amdahl ceiling first** and refuse work whose ceiling can't meet the requirement. Several tasks have a numeric answer — compute it, don't estimate. Treat each "stop" as a valid, often correct, outcome.

---

## Task 1 — Read the profile, name the bottleneck

You're told "the import is slow." A sampling profiler reports:

```
Function          tottime   cumtime
main                0.01      8.40
parseCSV            0.30      0.30
validateRow         0.20      0.50
insertRow           7.60      7.80   (called 500,000 times)
buildSummary        0.05      0.10
```

(a) Which function do you optimize, and why? (b) A teammate is rewriting `parseCSV` to be 2× faster — what's the overall speedup of *that* effort, and what do you tell them? (c) What single design change would you hypothesize for `insertRow` given it's called 500k times?

*Numeric:* (b) `parseCSV` is `0.30/8.40 ≈ 3.6%`; `1/(0.964 + 0.018) = 1.018×`, ~1.8% — tell them to stop and attack `insertRow` (≈93% of time). (c) Batch the 500k inserts into bulk statements / one transaction (N+1 write pattern).

## Task 2 — Compute the Amdahl ceiling

For each, compute `Speedup_max = 1/((1−p) + p/s)` and the resulting time for a 100 ms baseline. Decide go/no-go if the requirement is "at least 25% faster."

| Case | p | s |
|---|---|---|
| A | 0.10 | ∞ |
| B | 0.60 | 3 |
| C | 0.80 | 1.5 |
| D | 0.40 | 10 |

*Numeric:* A: `1/0.90 = 1.11×` → 90 ms (11%, **no-go**). B: `1/(0.4+0.2)=1.67×` → 60 ms (40%, **go**). C: `1/(0.2+0.533)=1.36×` → 73 ms (27%, **go**). D: `1/(0.6+0.04)=1.56×` → 64 ms (36%, **go**).

## Task 3 — The average is lying

A service reports mean latency 28 ms and the team is happy. The raw percentiles are:

```
p50 = 18 ms   p90 = 35 ms   p99 = 600 ms   p999 = 2,800 ms
```

(a) Why is the mean misleading here? (b) The frontend makes 30 of these calls per page load. Estimate the probability that a page hits at least one p99-class (≥600 ms) call. (c) What metric should the SLO be written against?

*Numeric:* (b) `1 − 0.99^30 ≈ 1 − 0.740 = 0.26` → ~26% of page loads. (a) The mean is dragged near the median and hides a heavy tail; 1% of calls are ~33× the median. (c) A percentile (e.g. p99 < X ms), not the mean.

## Task 4 — Find the benchmark lie (dead code)

```go
func BenchmarkSum(b *testing.B) {
    data := []int{1, 2, 3, 4, 5}
    for i := 0; i < b.N; i++ {
        sum := 0
        for _, v := range data {
            sum += v
        }
        _ = sum
    }
}
```

It reports 0.31 ns/op. (a) Why is this number meaningless? (b) Name two separate defects. (c) Rewrite it to be honest.

*Answer:* (a) 0.31 ns ≈ 1 cycle — the compiler eliminated the loop because `sum` is discarded (and folds the constant slice). Defects: dead-code elimination (assign to an escaping sink, e.g. a package-level `var sink int; sink = sum`) and unrealistic data (5 constant ints fitting trivially in registers — use a large, varying, non-constant input).

## Task 5 — Pick the right tool

Match each question to the right instrument (sampling profiler / off-CPU profiler / counters / micro-benchmark / distributed tracing):

1. "Which function burns the most CPU?"
2. "p99 is 800 ms but CPU is 15% — where's the time going?"
3. "Is implementation A faster than B for this one hot function?"
4. "How many times do we hit the DB per request?"
5. "Across our 6 microservices, which span dominates checkout latency?"

*Answer:* 1 → sampling profiler (on-CPU flame graph). 2 → off-CPU profiler (blocked/wait time). 3 → micro-benchmark. 4 → counters/metrics. 5 → distributed tracing.

## Task 6 — Is the win real?

You optimize a path and collect p99 (ms) over 8 runs each:

```
Before: 152 148 155 150 149 153 151 147   (mean 150.6)
After:  149 151 148 150 152 147 150 148   (mean 149.4)
```

(a) Should you ship this as an improvement? (b) What single quantity decides it? (c) Name two environment controls that reduce the noise you're fighting.

*Answer:* (a) No — a ~0.8% delta with these spreads is indistinguishable from noise. (b) The confidence interval / p-value of the *delta* (e.g. `benchstat`); ship only if `p < 0.05`. (c) Pin CPU frequency (disable turbo/throttling) and isolate cores / use quiet dedicated hardware (not noisy-neighbor VMs).

## Task 7 — Representative workload audit

A cache benchmark uses 10,000 keys drawn uniformly at random and reports a 98% hit rate, "blazing fast." Production traffic is Zipfian (a few hot keys, a long cold tail) with the same 10,000-key space. (a) Why is the benchmark's hit rate unrepresentative? (b) Which direction does the real hit rate move, and what does that do to measured latency? (c) State the three dimensions a workload must match production on.

*Answer:* (a) Uniform keys spread access evenly so the cache rarely misses; production's skew means many requests hit cold keys outside the cache's working set. (b) Real hit rate drops (often substantially), so measured latency rises — the "optimized" path may be net slower in production. (c) Size (cardinality), shape (key distribution), mix (read/write ratio & request-type proportions).

## Task 8 — Derive the floor, then decide

A request must make: one cross-region DB round trip (~70 ms), one same-DC cache lookup (~0.5 ms), and ~3 ms of CPU work. Current p99 = 95 ms; SLO is p99 < 120 ms. (a) What's the theoretical floor? (b) Is profiling the JSON serializer (currently ~2 ms) worth it? (c) What's the *only* way to get materially below the floor?

*Numeric:* (a) ≈ 70 + 0.5 + 3 = 73.5 ms floor. (b) No — you're already meeting the SLO with margin and within ~30% of an irreducible floor; the 2 ms serializer has a ceiling of `1/(1−0.021) ≈ 2%`. (c) Architectural: remove/cache the cross-region round trip (co-locate, replicate, or read from a regional cache) — physics caps everything else.

## Task 9 — Spot the JIT-warmup lie

A JIT-language micro-benchmark times a function once, right after process start, and reports 4.2 ms. Run continuously, the same function settles to 0.18 ms. (a) Explain the 23× gap. (b) How should the harness be structured? (c) Why does this *not* mean "warmup is cheating" — when is the cold number the one you want?

*Answer:* (a) The first run executes interpreted/un-optimized bytecode before the JIT compiles the hot method; you measured the compiler + cold caches, not steady-state code. (b) Run warmup iterations and discard them, then measure many steady-state iterations (use the language's benchmark framework, which does this). (c) Cold-start latency is the *right* metric for serverless/FaaS or rarely-called paths where the function genuinely runs cold every time — match the measured state to the production state.

## Task 10 — When to stop

For each, decide optimize or stop, and justify in one line. SLO is p99 < 250 ms.

| Service | Current p99 | Trend |
|---|---|---|
| A | 90 ms | flat |
| B | 240 ms | rising 5%/month |
| C | 310 ms | flat |
| D | 120 ms | flat, but team wants assembly rewrite for −10 ms |

*Answer:* A → **stop** (well inside SLO; spend effort elsewhere). B → **act now** (within SLO but trend will breach it in ~1–2 months; add headroom). C → **optimize** (breaching SLO). D → **stop / reject** (a 10 ms gain on a path already at half the budget, for large complexity and risk — optimizing past the requirement; Knuth's non-critical 97%).

## Task 11 — Lead a cross-team trace

A distributed trace attributes checkout p99 = 2,100 ms (SLO 800 ms) across spans:

```
gateway      120 ms
auth-svc      90 ms
inventory-svc 1,250 ms
pricing-svc   480 ms
ledger-svc    160 ms
```

(a) Rank the optimization targets by Amdahl `p`. (b) If `inventory-svc` is halved and `pricing-svc` is cut to 80 ms, what's the new end-to-end p99 (assume spans are sequential and additive)? (c) Why must the win be confirmed on the *end-to-end* number, not each team's local measurement?

*Numeric:* (a) inventory (`p ≈ 0.60`) > pricing (`p ≈ 0.23`) > others (each < 0.08, off-limits). (b) `120 + 90 + 625 + 80 + 160 = 1,075 ms` — still over SLO, so a second round (inventory again) is needed. (c) A local optimum can shift load and worsen another span (or rely on a now-overloaded shared resource); only the end-to-end p99 proves the system, not the component, met the SLO.

## Task 12 — Design a regression gate

You must add a CI performance gate for a hot benchmark whose run-to-run noise is measured at ±3%. (a) What threshold do you set, and why not 2%? (b) What do you compare against — last run, or something else? (c) Name one thing that will get the gate disabled within a week if you skip it.

*Answer:* (a) Above the noise floor — e.g. fail on a regression > 5–7% (with the delta's confidence interval), because a 2% gate sits inside ±3% noise and fires constantly on flake. (b) A deliberately re-baselined reference commit (and track a long-term time-series to catch slow drift), never "last run." (c) Noise control — running on shared/noisy-neighbor VMs without pinned CPU frequency produces flaky failures, and a flaky gate gets muted fast.

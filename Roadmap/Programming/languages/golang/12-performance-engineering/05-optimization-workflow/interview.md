# Optimization Workflow — Interview

## Q1. Describe the optimization loop in Go.

The loop has five steps: set a measurable goal, capture a baseline, identify the hotspot from a profile, apply exactly one targeted change, and re-measure to decide keep or revert. Step 4 is the only step that touches code; steps 1, 2, 3, and 5 are all measurement. The discipline is in not skipping any step.

---

## Q2. What's the difference between a microbenchmark and a production profile, and when do you use each?

A microbenchmark answers "is implementation A faster than implementation B?" — reproducible, isolated, low-realism. A production profile answers "where does my service spend its time under real load?" — realistic, expensive to capture, low-isolation. Use a production profile to find the hot function, then a microbenchmark to compare candidate implementations. Going the other way wastes engineering time.

---

## Q3. What's "the hierarchy of optimizations"?

Algorithm > data structure > implementation > compiler/runtime > micro-optimization. A 10× algorithmic improvement dwarfs every micro-optimization stacked together. Always start at the top and only descend when upper levels have been exhausted or measured to be irrelevant. Reaching for `unsafe` before checking complexity is a category error.

---

## Q4. How do you tell whether a service is CPU-bound, memory-bound, contention-bound, or I/O-bound?

Scale concurrency and watch CPU. If CPU pegs and latency rises linearly: CPU-bound. If GC CPU fraction is > 20% and the heap grows: memory-bound. If CPU stays low at high load and latency rises: contention or I/O. Then narrow down with `pprof -mutex`/`-block` for contention vs. `runtime/trace` for syscall waits. Each bottleneck has a different tool.

---

## Q5. Why is `benchstat` important and what does its `p` value mean?

`benchstat` computes statistical significance across multiple runs of the same benchmark. The `p` value is a Mann-Whitney U test result: `p < 0.05` means the difference is unlikely to be noise. A change with 20% improvement but `p=0.18` is not a real improvement, regardless of how large the percent looks. Never claim a win without `p < 0.05`.

---

## Q6. What does the "90/10 rule" mean in performance work?

Roughly 90% of CPU and allocations happen in 10% of functions. After a CPU profile, `top10` almost always accounts for 80-90% of total. The corollary: optimizing the bottom 90% of functions is almost always wasted effort. Find the hot 10% first, then choose where in that 10% to invest.

---

## Q7. What does "change one thing at a time" mean and why does it matter?

Each iteration of the loop modifies exactly one identifiable thing. Two changes in one commit make it impossible to attribute the result: if performance worsens, you can't tell which sub-change is the cause. If it improves, you can't tell which sub-change was actually useful. Split a multi-change PR into multiple commits, each with its own `benchstat` output.

---

## Q8. When should you stop optimizing?

When the next candidate change is less than 5% improvement, or when meeting the goal already has 20% margin, or when the change makes the code substantially harder to read for marginal gain, or when the benchmark variance exceeds the improvement size (you're measuring noise). Knowing when to stop is the senior skill; juniors over-optimize, seniors leave the field having declared the work done.

---

## Q9. How do you set a performance goal correctly?

A correct goal names a metric, a value, a baseline, a workload, and (often) a window. "Reduce p99 of `/checkout` from 250 ms to 100 ms at 500 RPS sustained" is a goal. "Make it faster" is not. The goal also implies a stopping condition: once you hit 100 ms with margin, you're done.

---

## Q10. What is PGO, when do you turn it on, and what could go wrong?

PGO (Profile-Guided Optimization) lets the compiler use a real-workload profile to make better inlining and code-layout decisions. Typical wins: 2-10% CPU. Turn it on after structural optimizations are exhausted. Pitfalls: stale profiles produce binaries optimized for old workloads; profiles from stress tests optimize for the wrong code paths; cold-start profiles ignore steady-state patterns. Re-collect monthly from representative load.

---

## Q11. Why are allocations a CPU cost?

Allocations cost CPU through two paths: the allocator runs code on every call, and the garbage collector runs proportional to allocation rate. A service with high allocation rate often spends 15-25% of CPU on GC. Dropping allocs/op from 12 to 3 can recover most of that, even if total memory usage barely changes. Always track allocs/op as a first-class metric.

---

## Q12. What's the difference between `pprof -inuse_objects` and `pprof -alloc_objects`?

`-inuse_objects` shows what's currently alive in the heap — useful for memory leaks. `-alloc_objects` shows the cumulative allocation count since profile collection started — useful for GC pressure and allocation hotspots. To find leaks, use `-inuse_objects`. To find what to optimize for GC, use `-alloc_objects`.

---

## Q13. What does a flame graph tell you and how do you read one?

A flame graph stacks calls vertically (depth) and orders them by sample count horizontally (width). The width of a box is the time spent in that function and its callees. Read it by finding the widest box near the top of each stack — that's the hotspot. A wide `runtime.mallocgc` means allocation pressure; wide `runtime.futex` means contention; wide application functions are CPU work.

---

## Q14. What's the difference between p50 and p99 latency, and why optimize for the tail?

p50 (median) is the typical request; p99 is the slowest 1% — about one request every 100. Users notice the worst experiences more than the average. A change that improves p50 by 30% but worsens p99 by 50% is usually a net loss for user experience. Most performance SLOs target p99 or p99.9 specifically.

---

## Q15. What's a regression test for performance and how do you write one?

A regression test is a benchmark whose name encodes the property you're guarding, and whose CI gate enforces a budget. Example:

```go
func BenchmarkEncode_AllocsBudget(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ { _ = encode(input) }
}
```

The CI gate parses `benchstat` against a baseline and fails the build if `allocs/op` regresses. Without the gate, the benchmark is decorative; the gate is what protects the optimization.

---

## Q16. When does it make sense to *not* optimize?

When the code isn't on a hot path (confirmed by profile); when the system is bottlenecked elsewhere; when the readability cost is large and the improvement is small; when the workload will change soon; when the user-visible improvement is below the threshold of perception (e.g., 3 ms in a 200 ms response). A senior engineer's "no" to an optimization request is one of the most valuable contributions.

---

## Q17. What's the difference between caching and pooling, and when do you use each?

Caching stores *results* keyed by inputs to avoid recomputing them. Pooling reuses *workspace* (buffers, decoders) to avoid reallocating them. Cache when the same computation is repeated with the same inputs; pool when the same shape of allocation happens many times in hot paths. Cache invalidation is a hard problem; pool retention quirks are easier but real.

---

## Q18. How do you document an optimization so it doesn't get reverted?

A comment that names the technique, the reason, the measured improvement, and the hazard ("don't replace this with X without re-running BenchmarkY"). Plus a regression benchmark in CI that asserts the property the optimization established. Without both, the optimization is one well-meaning refactor away from being silently undone.

---

## Q19. You see `GC CPU fraction` at 30%. What do you do?

Don't reach for `GOGC` first — that's treating the thermometer. The root cause is allocation rate. Capture `-alloc_objects`, identify the top contributors, and reduce allocations at those sites (pooling, pre-sizing, value over pointer). Only after structural changes are exhausted should you adjust `GOGC` or set `GOMEMLIMIT`. Raising `GOGC` without fixing allocations trades GC CPU for heap size, and a too-large heap goes OOM.

---

## Q20. Walk me through how you'd approach "the service is slow, fix it."

1. Confirm the symptom: look at the latency dashboard, identify which endpoint and percentile is slow.
2. Set a measurable goal: "p99 of `/X` from N ms to M ms at Y RPS."
3. Categorize the bottleneck: CPU, memory, contention, or I/O. CPU profile first, then add others as needed.
4. Identify the hotspot: read `top10`, `top -cum`, and `list` on the hot functions.
5. Generate candidate changes from the hierarchy: algorithm first, then data structure, then implementation. Skip micro-opts unless you've already done the rest.
6. Apply one change. Write a microbenchmark to validate it.
7. Re-measure with `benchstat`. Confirm `p < 0.05`.
8. Re-profile production via canary. Confirm the system-level number moved.
9. Document: commit with before/after numbers, add a regression test, write a `PERFORMANCE.md` note.
10. Decide whether to continue or stop based on whether the goal is met.

The shape of the answer matters more than any specific tool. The interviewer is checking that you have a workflow at all.

---

## Summary

Optimization interview questions test process more than tools. The expected answers center on measurement (no work without a benchmark or profile), discipline (one change at a time, `benchstat` for significance), and judgment (knowing when to stop, recognizing the bottleneck category, choosing the right tool). Candidates who only know individual tricks fail; candidates who can describe the loop and the trade-offs pass.

---

## Further reading
- Brendan Gregg, "USE Method": https://www.brendangregg.com/usemethod.html
- Dave Cheney, "High Performance Go Workshop": https://dave.cheney.net/high-performance-go-workshop/dotgo-paris.html
- Damian Gryski, go-perfbook: https://github.com/dgryski/go-perfbook
- Russ Cox, "Profile-Guided Optimization in Go 1.21": https://go.dev/blog/pgo

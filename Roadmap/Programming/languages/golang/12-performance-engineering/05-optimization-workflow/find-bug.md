# Optimization Workflow — Find the Bug

This file collects anti-patterns and methodological mistakes in performance work. Each section is a failure mode: the symptom, why it happens, how to detect it, and the correct alternative.

These are not bugs in code — they are bugs in *process*. They produce slow systems, wasted engineering time, regressions that look like improvements, and improvements that look like regressions.

---

## 1. Premature optimization

**Symptom.** A junior engineer rewrites a clear function into a clever one because "this might be slow." The new version is harder to read; nobody knows if it's actually faster because nobody benchmarked.

**Why it happens.** Pattern-matching against blog posts that say `[]byte` is faster than `string`, `sync.Pool` is mandatory, `unsafe` is fine. Without measurement, every "fact" becomes an excuse to add complexity.

**Detection.** Check git history. If an optimization landed without a benchmark, profile, or before/after numbers in the commit, it was probably premature.

**Fix.** Revert if the optimization predates measurement. Going forward, the rule is: no optimization without a profile that names the function being optimized.

---

## 2. No measurement at all

**Symptom.** Someone says "I made it faster" and points at the diff. No numbers.

**Why it happens.** Time pressure, confidence in the change, or just habit.

**Detection.** Ask: "How much faster?" If the answer is a percentage without a `benchstat` output, the answer is fiction.

**Fix.** Refuse to merge optimization PRs without:

```
Before: X ns/op, Y B/op, Z allocs/op
After:  X' ns/op, Y' B/op, Z' allocs/op
benchstat: p=..., n=10+10
```

The commit message template should require it.

---

## 3. Micro-optimization on a cold path

**Symptom.** An engineer spends two days tuning a function that runs once per request, when the bottleneck is the database call that takes 95% of the wall time.

**Why it happens.** The function looked optimizable and was nearby. Available pattern beat important pattern.

**Detection.** Run a CPU profile of the actual production workload. Find the function in the profile. If it's < 5% of total CPU, optimizing it cannot improve the system by more than 5%, and that's the absolute ceiling.

**Fix.** Sort the optimization backlog by the function's share of the profile. Work top down, not "where I happen to be reading."

---

## 4. Benchmark that doesn't measure what you think

**Symptom.** Benchmark shows a 50% improvement; production shows no change.

**Why it happens.**

- The benchmark runs on data that's smaller, cleaner, or more predictable than reality.
- The compiler eliminates the work because the result isn't used.
- The benchmark warms a cache that's cold in production.
- Per-call setup dominates the loop body.

**Detection.** Read the benchmark code. Is the result of the function consumed (via `runtime.KeepAlive`, a sink variable, or `b.SetBytes`)? Is the input size realistic? Does `b.N` reach a stable number before timing?

**Fix.**

```go
var sink int

func BenchmarkX(b *testing.B) {
    data := buildRealistic(b)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sink = doWork(data)  // assigning to a package var prevents elision
    }
    _ = sink
}
```

Verify the benchmark matches reality with a *production* profile of the same function. The two should agree on relative cost.

---

## 5. Changing two things at once

**Symptom.** A PR claims a 20% improvement. The diff contains a new algorithm *and* a buffer pool *and* a refactor. The reviewer can't tell which change matters.

**Why it happens.** Engineers see multiple opportunities and want to fix them all in one go.

**Detection.** Diff is large and touches multiple concerns. The benchstat output shows aggregate change without attribution.

**Fix.** Split into multiple commits, ideally multiple PRs. Each commit has one named technique and a benchstat output for that change alone. If a change is supposed to enable a later optimization (refactor to enable pooling), commit the refactor as a no-op first, verify with benchstat that nothing changed, then commit the pool.

---

## 6. Benchmarking on a noisy machine

**Symptom.** `benchstat` shows `± 15%` spread. The same change measures +10% on one run and -10% on the next.

**Why it happens.** CPU frequency scaling, thermal throttling, background processes, other VMs on a shared host, laptop on battery.

**Detection.** Run the same benchmark three times in a row without changing anything. If the variance is greater than 3-4%, the harness is unreliable.

**Fix.**

```bash
# Linux: fix the CPU governor
sudo cpupower frequency-set --governor performance

# Pin the benchmark to a specific CPU
taskset -c 2 go test -bench=. -count=20

# Disable turbo boost via /sys (if supported)
# Close other applications
# Run on a dedicated machine for serious work
```

For comparing PR vs. main, prefer running both on the same machine back-to-back, not different machines. The relative measurement is more reliable than the absolute one.

---

## 7. Acting on a profile without context

**Symptom.** `pprof` shows `runtime.mallocgc` is 30% of CPU. Engineer concludes the allocator is slow and adds `sync.Pool` everywhere.

**Why it happens.** `runtime.mallocgc` is the leaf function of every allocation. It being 30% doesn't tell you which *caller* is responsible.

**Detection.** Read `top -cum` and click through to see *which callers* are responsible for the allocator's time. Often two or three functions account for most of the allocations that drove `mallocgc` to 30%.

**Fix.** Find the calling function, optimize the allocation there. Or zoom in:

```
(pprof) peek runtime.mallocgc
(pprof) list myEncoder
```

The allocator is a symptom, not the bug. The bug is whatever is calling it too often.

---

## 8. Optimizing the function that isn't the bottleneck

**Symptom.** A function is 5% of CPU. Engineer spends a week and reduces it to 2.5%. System-level latency doesn't change.

**Why it happens.** The 50% improvement is real but irrelevant. The 95% that's somewhere else is unchanged. Total improvement: 2.5%, which is within measurement noise of production load.

**Detection.** Compute the theoretical maximum improvement before starting. If optimizing function X to instantaneous removes (e.g.) 5% of CPU, and your target is 30%, X is not the right target.

**Fix.** Re-rank the targets by their share of the profile and the realistic improvement available. Always work the largest share first.

---

## 9. Ignoring tail latency

**Symptom.** A change improves p50 by 30% but moves p99 from 100 ms to 250 ms. The team celebrates the p50 win, and the SLO breaches three days later.

**Why it happens.** Average-case wins often come at worst-case cost. A buffer pool reduces typical allocations but increases worst-case GC pause when a large request inflates the pooled buffer. Caching improves median lookup but slow cache misses move to the tail.

**Detection.** Always report p50, p95, p99, p99.9 — not "average." A change that improves median while regressing the tail is, in most user-facing services, a net loss.

**Fix.**

```go
// In benchmarks, record percentiles, not just b.ReportMetric
// Or use a real load generator (k6, vegeta, wrk) and check the histogram
```

For production, the latency dashboard must show percentile breakdown, not just average. Block PRs that worsen p99 even if they improve p50.

---

## 10. Optimizing without a goal

**Symptom.** Engineer keeps tuning a function for a week. Each change gives 1-2%. Total improvement after a week is 8%, at the cost of code that's three times longer and uses two `sync.Pool`s and one `unsafe` call.

**Why it happens.** No stopping criterion was set. "Make it faster" is open-ended; without a target, there's always one more 2% to chase.

**Detection.** Ask "what's the target?" If the answer is "as fast as possible," there is no target.

**Fix.** Before any optimization sprint, set a numeric goal with a deadline:

> "Reduce p99 of `/encode` from 80 ms to 30 ms within one week. Stop when we hit 30 ms or when the next change would compromise readability."

The goal makes the stopping condition explicit and prevents the slide into diminishing returns.

---

## 11. Reverting performance work by accident

**Symptom.** Code that was optimized six months ago is slow again. Nobody notices for weeks.

**Why it happens.** A refactor removes the optimization. The next engineer reads the cleverer code, doesn't understand why it's that shape, and "simplifies" it back to the slow form. No test catches it because there was no benchmark guard.

**Detection.** Compare production p99 to its value six months ago. If there's drift, bisect through release tags.

**Fix.** Two prevention mechanisms:

1. **Comment that names the optimization.** "We pre-allocate at length N because BenchmarkX measured 3× win. Do not change without rerunning the benchmark."
2. **A regression benchmark in CI.** `BenchmarkXAllocations` asserts that the function does ≤ 1 allocation per call. CI fails if a refactor breaks the property.

Both belong in the same commit as the optimization itself.

---

## 12. Wrong tool for the bottleneck

**Symptom.** A service has high latency. Engineer profiles CPU, sees nothing remarkable, gives up. The actual bottleneck was lock contention.

**Why it happens.** The CPU profile only captures the work the CPU is doing. Time spent blocked on a mutex, channel send, or syscall doesn't appear in `pprof -cpu`.

**Detection.** When `pprof -cpu` shows the program isn't using its CPUs (look at the total seconds vs. wall time), the bottleneck is somewhere else.

**Fix.** Match the profile to the bottleneck category:

| Symptom | Profile |
|---------|---------|
| CPU pegged | `pprof -cpu` |
| GC CPU high | `pprof -alloc_objects`, `GODEBUG=gctrace=1` |
| Locks suspected | `pprof -mutex`, `pprof -block` |
| Syscall heavy | `runtime/trace`, `strace` |
| Don't know | `runtime/trace` (it shows everything) |

`runtime/trace` is underused. When you don't know what kind of bottleneck you have, capture a trace; it shows scheduling, GC, blocking, and syscalls in one view.

---

## 13. Benchmark in CI without a budget

**Symptom.** CI runs benchmarks but nobody looks at the output. Performance drifts over months because no one's reading the dashboard.

**Why it happens.** Running benchmarks is the easy half; gating on them is the hard half. Without a budget that fails the build, the data is decorative.

**Detection.** Check what happens if `BenchmarkHotPath` regresses 20%. Does CI go red? If not, you don't have a gate; you have a log.

**Fix.** The CI script must parse `benchstat` output and exit non-zero on regressions:

```bash
benchstat baseline.txt new.txt | tee report.txt
if grep -E "delta.*\+[0-9]+\.[0-9]+%.*p=0\.0[0-9]" report.txt | grep -v "alloc"; then
    echo "Performance regression detected"
    exit 1
fi
```

The threshold matters too: 2% for hot paths, 15% for cold paths, 0 for allocation counts.

---

## 14. PGO with a stale or unrepresentative profile

**Symptom.** A team turns on PGO with a profile captured during a stress test. Production performance gets worse.

**Why it happens.** A stress test exercises different code paths than steady-state traffic. PGO optimizes for the profile it has, so it makes the stress-test paths fast at the cost of normal paths.

**Detection.** Compare CPU profiles before and after the PGO build. If `top10` from production looks different from `top10` in the PGO profile, the profile isn't representative.

**Fix.**

- Capture profiles from steady-state production, not stress tests or cold start.
- Aggregate across 24-72 hours and across multiple traffic conditions.
- Re-collect the profile monthly or on major workload changes.
- Sanity-check by running the PGO binary in canary and comparing latency to the non-PGO binary.

---

## 15. Tuning `GOGC` blindly

**Symptom.** Engineer sees high GC CPU, sets `GOGC=400`. GC pauses now happen less often but each one is longer, and live heap grows to 4× the previous size. Service goes OOM.

**Why it happens.** `GOGC` is a blunt knob. Raising it reduces GC frequency at the cost of memory; lowering it does the opposite. Neither addresses the root cause (excess allocations).

**Detection.** Heap size after the change. If raising `GOGC` solved the GC CPU problem by *enlarging the heap to where the service no longer fits in its container*, you didn't fix anything; you moved the symptom.

**Fix.** Fix the allocation rate, not the GC frequency. The order is:

1. Reduce allocations (pooling, pre-sizing, value over pointer).
2. Set `GOMEMLIMIT` to give the runtime a soft cap based on the container limit.
3. Only then consider `GOGC` adjustment, and only with measured benefit.

Increasing `GOGC` to "fix" high GC CPU without fixing the allocation rate is treating the thermometer instead of the fever.

---

## 16. Optimizing third-party code by replacing it

**Symptom.** "JSON is slow, let's switch to `easyjson` everywhere." Six weeks later, the team is debugging codegen issues and incompatible behavior, with no measurable improvement on the actual SLO.

**Why it happens.** The third-party library was a small fraction of total time. The win was real but small. The cost (maintenance, codegen complexity, debugging) was large.

**Detection.** Before any library swap, compute the *theoretical maximum win*: if the library is 8% of CPU and the replacement makes it instantaneous, the maximum win is 8%. Is that worth the maintenance cost?

**Fix.** Library swaps are last-resort optimizations. They make sense when the library is > 20% of CPU and the replacement is well-maintained. For lesser shares, optimize callers instead.

---

## 17. The benchmark that lies via inlining

**Symptom.** A function benchmarks at 0.5 ns/op (impossibly fast). Production behavior doesn't match.

**Why it happens.** The compiler inlined the function into the benchmark and then optimized away the call entirely because the result was unused.

**Detection.** Sub-nanosecond ns/op on anything that does real work is a red flag. So is "zero allocations" on a function that obviously allocates.

**Fix.**

```go
var sink Result

func BenchmarkFoo(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = foo()         // package-level var prevents DCE
    }
}
```

Or use `//go:noinline` on the function under test, or capture the result and assert something on it. Avoid `_ = result` — the compiler may still eliminate the call.

---

## 18. Summary

The hardest performance bug in a Go service is not in the code; it's in the workflow. Premature optimization, missing measurement, micro-optimizing the wrong function, ignoring tail latency, turning `GOGC` knobs without fixing allocations — each one wastes engineering time and produces no system-level improvement. The fix in every case is the same: a benchmark, a profile, a `benchstat` output, and a written goal. Without those, no claim of "I made it faster" is credible.

---

## Further reading
- Brendan Gregg, "Methodology, not tools" (talk): https://www.brendangregg.com/methodology.html
- Dave Cheney, "Mistakes new Go developers make": https://dave.cheney.net/practical-go/presentations/qcon-china.html
- Carlos Bueno, "Mature Optimization Handbook" (free PDF)
- Damian Gryski, go-perfbook: https://github.com/dgryski/go-perfbook

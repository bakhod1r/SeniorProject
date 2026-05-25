# Benchmarking Strategy — Interview

A focused Q&A bank. Each question has a short, defensible answer that demonstrates real understanding, not just `go test -bench` familiarity.

---

## Q1. What is `b.N` and who sets it?

`b.N` is the iteration count assigned by the `go test` driver. The driver starts with `b.N = 1`, measures the elapsed time, and ramps `b.N` up (by up to 100× each step) until total elapsed time meets `-benchtime` (default 1 s). Your benchmark must run its work *exactly* `b.N` times. The driver reports total time divided by `b.N` as `ns/op`.

---

## Q2. Why does `go test -bench=.` also need `-run=^$`?

`-bench=.` runs benchmarks but **does not** disable normal tests. Without `-run=^$`, the test binary still runs every `TestXxx` first. `-run=^$` is a regex that matches no test name, so tests are skipped and only benchmarks execute. It also makes the output less cluttered.

---

## Q3. What does `b.ResetTimer()` do and when do you use it?

`b.ResetTimer()` zeroes the elapsed time, allocation counters, and bytes counter. Use it after any expensive setup that happens before the timing loop — file reads, building large input, warming caches. Without it, setup cost is counted as benchmark work and your `ns/op` is wrong.

---

## Q4. Difference between `b.StopTimer` / `b.StartTimer` and `b.ResetTimer`?

- `b.ResetTimer()` clears everything and starts fresh. Called once after setup.
- `b.StopTimer()` / `b.StartTimer()` pauses and resumes the running timer. Used inside the loop when per-iteration setup must be excluded.

`StopTimer/StartTimer` has overhead (tens of nanoseconds); avoid for sub-microsecond benchmarks.

---

## Q5. Why might a benchmark report `0.3 ns/op` and what do you do about it?

The Go compiler removed the work. If the result is unused, the compiler proves the loop body has no side effects and deletes it; you measure only the loop counter. Defenses:

1. Assign the result to a package-level `sink` variable.
2. Use `runtime.KeepAlive(x)` for allocations without a natural sink.
3. On Go 1.24+, use `for b.Loop()` which prevents this elimination.

---

## Q6. What does `b.ReportAllocs()` do?

It enables the `B/op` (bytes per op) and `allocs/op` (allocations per op) columns in the benchmark output for that specific benchmark, equivalent to running with `-benchmem`. It only reports *heap* allocations — stack allocations are invisible.

---

## Q7. What does `b.SetBytes(n)` do?

It declares that each operation processes `n` bytes. The driver computes and prints throughput as `MB/s`. Use for parsers, hashers, serializers — anything you want to express in bandwidth. The argument is data you supply; the driver does not verify it.

---

## Q8. When do you use `b.Run`?

For sub-benchmarks: table-driven scans of input sizes, parameter sweeps, or comparing implementations. Each `b.Run(name, fn)` produces a separate output line and has its own `b.N`. Target individual sub-benchmarks with `-bench=Name/sub`.

---

## Q9. When should you use `b.RunParallel`?

When the function under test has *contention* — shared mutexes, atomics, channels, contended maps. `RunParallel` distributes `b.N` across `GOMAXPROCS` goroutines, exposing scaling behavior under concurrent pressure. **Do not** use it for purely single-threaded code; it just adds scheduler overhead and produces less useful numbers.

---

## Q10. How do you compare two benchmark results statistically?

Run each benchmark with `-count=10` (or more), save the outputs, and use `benchstat`:

```bash
go test -bench=. -count=10 -run=^$ > old.txt
# make change
go test -bench=. -count=10 -run=^$ > new.txt
benchstat old.txt new.txt
```

`benchstat` runs a Mann–Whitney U-test. Differences with `p < 0.05` are reported as a percentage delta; differences with `p ≥ 0.05` print as `~` (no significant change). The default alpha is 0.05; tighten via `-confidence`.

---

## Q11. What does `~` mean in `benchstat` output?

The two samples are not statistically distinguishable at the chosen confidence level (default 95%). The observed difference is consistent with random variation; there is no evidence of a real change. Do not claim an improvement (or regression) when `benchstat` prints `~`.

---

## Q12. Why does the same benchmark give different numbers on each run?

Sources of variance: CPU frequency scaling, thermal throttling, other processes competing for CPU, ASLR / page allocation luck, GC interference, cache state across iterations, branch predictor warm-up. Mitigations: pin governor to `performance`, disable turbo, run on a dedicated machine, use `taskset` or `perflock`, increase `-benchtime`, use `-count` and `benchstat`.

---

## Q13. What is `perflock` and why use it?

`perflock` (by Austin Clements) is a Linux tool that serializes benchmark runs and configures CPU governor/affinity for the duration of a run. Two benefits: it prevents concurrent CI jobs from interfering with each other's benchmarks, and it normalizes governor settings even on a misconfigured host. With it, well-warmed-up benchmarks typically hit <1% variance on dedicated hardware.

---

## Q14. How is `b.Loop()` (Go 1.24+) different from `for i := 0; i < b.N; i++`?

`b.Loop()` is a function call with intentional opacity. The compiler treats arguments passed to functions inside the loop as escaping, preventing dead-code elimination. It also automatically excludes setup code (everything before the first `b.Loop()` call) from the timer, so you usually don't need `b.ResetTimer()`. New code targeting Go 1.24+ should prefer it.

---

## Q15. What is constant folding in a benchmark context?

If a function argument is a compile-time constant, the Go compiler may inline the function and compute the result at compile time. Example: `parse("42")` becomes `42` if `parse` is inlinable and the input is a literal. The loop then has no runtime work. Defeat by passing arguments through a `var` so the compiler cannot prove constancy.

---

## Q16. How would you build a regression test for "this benchmark must allocate zero"?

Use `testing.Benchmark` from a regular `TestXxx`:

```go
func TestEncodeAllocBudget(t *testing.T) {
    r := testing.Benchmark(BenchmarkEncode)
    if got := r.AllocsPerOp(); got != 0 {
        t.Fatalf("got %d allocs/op, want 0", got)
    }
}
```

This runs in normal `go test` (no `-bench` needed) and fails CI if someone adds an allocation. The same shape works for byte counts (`AllocedBytesPerOp`) and time (`NsPerOp`).

---

## Q17. What's the difference between `-benchtime=5s` and `-benchtime=1000000x`?

- `5s` is a target *wall time*. The driver ramps `b.N` until total elapsed time reaches 5 s. The final `b.N` is whatever it took to fill that time.
- `1000000x` *pins* `b.N` to exactly 1,000,000 iterations, no ramp-up. Useful for deterministic runs, but per-sample variance is larger because the driver has no chance to amortize startup noise.

Use `5s` for normal benchmarking; use `Nx` for reproducible runs where the number of iterations is the experimental variable.

---

## Q18. What is profile-guided optimization (PGO) and how does it affect benchmarks?

PGO uses a CPU profile (`profile.pprof`) collected from a real workload to guide the compiler's inlining, branch layout, and register allocation. With `-pgo=profile.pprof`, the resulting binary can be 2–14% faster on the workloads represented in the profile. Implication for benchmarks: if production runs PGO-optimized and your local bench doesn't, you measure the wrong binary. Either use the same PGO profile in benchmarks or accept that local numbers are conservative.

---

## Q19. How would you design a benchmark suite for a service?

1. **Identify hot paths** via continuous CPU profiling (Pyroscope, Parca, or periodic `/debug/pprof/profile`). Focus on functions accounting for ≥1% of CPU.
2. **Write `BenchmarkTracked_*`** functions for each, with input shape sampled from production (sizes, distributions).
3. **Curate the suite** to finish in <5 minutes at `-count=10 -benchtime=1s`. Mark with a build tag or name prefix.
4. **Run on PR** against base ref, post `benchstat` diff as a PR comment.
5. **Run post-merge** on `main`, store results in a time-series DB or archive, alert on >10% regressions.
6. **Use a dedicated, stable runner** with `perflock` and a pinned governor.
7. **Enforce allocation budgets** as `TestXxxAllocBudget` tests so they fail CI even without `-bench`.

---

## Q20. Walk through diagnosing a benchmark that suddenly got 50% slower.

1. **Verify the regression is real.** Run with `-count=10`, compare via `benchstat`. If `p ≥ 0.05`, it might be noise — check hardware/runner conditions.
2. **Bisect.** `git bisect` between the last known-good commit and the current one, using the benchmark as the test predicate (`-count=5` for speed, then confirm with `-count=10`).
3. **Profile the slow version.** `go test -bench=BenchmarkX -cpuprofile=cpu.out`, then `go tool pprof -top cpu.out`. The new hot function — or the function that grew significantly — is the suspect.
4. **Diff allocations.** Run with `-memprofile=mem.out` on both versions. `pprof -base old.pprof new.pprof` shows what allocations changed.
5. **Check compiler output.** `go build -gcflags='-m=2'` reports inlining and escape decisions. A change that suddenly causes a function to escape, or that breaks an inlining threshold, can introduce overhead.
6. **Verify the benchmark itself didn't change.** Compare `Benchmark*` source between commits.
7. **Check dependencies.** A `go.mod` update can pull in a slower transitive dependency. Look at `go.sum` diff and inspect any dependency the benchmark touches.

The systematic approach (verify → bisect → profile → compare allocations) catches >90% of real regressions inside an hour.

---

## 21. Summary

These questions cover the four pillars of competent Go benchmarking: the `testing.B` API (Q1–Q9), statistical interpretation (Q10–Q12), measurement honesty (Q5, Q15, Q14), and production engineering (Q13, Q18–Q20). A candidate who can answer all twenty without hesitation is ready to lead performance work on a service.

---

## Further reading
- `testing` package: https://pkg.go.dev/testing
- `benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
- Go blog — sub-benchmarks: https://go.dev/blog/subtests
- Go PGO guide: https://go.dev/doc/pgo
- Damian Gryski, *go-perfbook*: https://github.com/dgryski/go-perfbook

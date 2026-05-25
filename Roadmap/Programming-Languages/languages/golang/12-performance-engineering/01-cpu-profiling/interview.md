# CPU Profiling in Go — Interview Questions

A working set of CPU-profiling questions ranging from "junior screen" to "staff-level architecture". Strong answers below each. Read the explanations even if you know the term — the framing is what gets graded.

---

## Q1. What is a CPU profile in Go, and how is it captured?

A CPU profile is a statistical record of which functions were on CPU during a capture window. The runtime asks the kernel to deliver a `SIGPROF` signal at a fixed rate (default 100 Hz). Each signal walks the current goroutine's call stack and records it. After capture, all the stacks are aggregated into a weighted call graph.

The capture is started by `runtime/pprof.StartCPUProfile(io.Writer)` and stopped by `pprof.StopCPUProfile()`. From a benchmark, `go test -cpuprofile=cpu.out -bench=.` does the same. From a running service, `/debug/pprof/profile?seconds=N` (via `net/http/pprof`) captures for N seconds.

---

## Q2. What's the difference between flat and cumulative time?

**Flat** (also called *self*) is time spent in the function itself, excluding time in functions it called. **Cumulative** (*cum*) is flat plus all time spent in the call tree below the function.

A leaf function has flat ≈ cum. A wrapper like `http.HandlerFunc.ServeHTTP` has tiny flat and large cum. When looking for hotspots, sort by flat. Functions with only high cum are organizational — they don't do the work themselves.

---

## Q3. What does the default 100 Hz sampling rate mean, and when would you change it?

100 Hz means one sample every 10 ms of CPU time per thread. A 30-second profile on 8 saturated cores yields ~24,000 samples — enough resolution to find any function consuming ≥0.5% of CPU.

Raise the rate (`runtime.SetCPUProfileRate(500)`) only for microbenchmarks that finish before generating enough samples at 100 Hz. Above ~1000 Hz the kernel can't deliver `SIGPROF` reliably anyway, and the profiler overhead becomes a meaningful fraction of measured CPU.

---

## Q4. How does Go's CPU profiler differ from instrumentation-based profilers?

Instrumentation profilers insert function-entry/exit hooks. They report exact call counts and timing, at the cost of measurable overhead and skew (instrumented functions are slower than uninstrumented ones).

Go uses **statistical sampling**. It does not count calls; it estimates fraction-of-CPU. Overhead is roughly 1–5% at 100 Hz. The trade-off is uncertainty: rare or short functions may be missed, and small percentages are noise. The advantage is realistic measurement — the profile reflects the actual program, not an instrumented variant.

---

## Q5. Why do my CPU profiles show `runtime.findrunnable` near the top?

`runtime.findrunnable` is the scheduler looking for runnable goroutines. It is called by an idle P that has nothing to do.

If it dominates your profile, your program is **idle** during capture. The CPU profiler only sees what's on CPU; sleeping and blocked goroutines contribute zero samples. To investigate latency in an idle profile, use the block profile, the mutex profile, or `go tool trace` — they show off-CPU time.

You can also filter idle frames: `go tool pprof -ignore='runtime\.findrunnable|runtime\.mcall'`.

---

## Q6. How would you safely expose pprof endpoints in production?

Three rules:

- **Bind to localhost or a private interface**, never the public listener. Profile data exposes source-level details.
- **Use a separate `http.ServeMux`**, not `http.DefaultServeMux`. Importing `_ "net/http/pprof"` into the main service registers handlers on the default mux, leaking them if anything else uses it.
- **Wrap with authentication** (mTLS, bearer token, sidecar). Even on a private network, profiles are sensitive.

Implementation: dedicated mux, dedicated port (commonly :6060), behind an auth middleware. Operators scrape with a credential; pprof endpoints are never reachable from outside.

---

## Q7. How do you compare two CPU profiles to verify an optimization?

```bash
go tool pprof -http=:8080 -base=before.pprof after.pprof
```

The `-base` flag subtracts the baseline profile from the new one. Functions that became faster are colored green; functions that became slower are red. The intended target should be the largest green delta; nothing else should move significantly.

For benchmarks, the analogous workflow is `benchstat`:

```bash
go test -bench=. -count=10 -run=^$ > before.txt
# apply fix
go test -bench=. -count=10 -run=^$ > after.txt
benchstat before.txt after.txt
```

`benchstat` runs a Welch's t-test and reports per-metric significance and confidence intervals.

---

## Q8. What is the pprof labels mechanism, and when do you use it?

`pprof.Do(ctx, pprof.Labels(...), fn)` tags CPU samples taken while the goroutine runs `fn` with the given key/value labels. The pprof tool can then filter or group by tag:

```
(pprof) tags endpoint
(pprof) -tagfocus=endpoint=/api/search
```

Use cases: attributing CPU to logical units like endpoints, tenants, or batch jobs in a multi-tenant service. Cardinality matters — keep label values bounded (route patterns, not URLs; tenant buckets, not tenant IDs). Labels do **not** propagate across `go` statements unless the goroutine receives a labeled context.

---

## Q9. How does inlining affect CPU profiles?

The Go compiler inlines small functions into their callers. By default, inlined functions do **not** appear as separate frames in the profile — their cost is attributed to the caller. This causes `list` to show weight on lines that look innocent.

Workarounds:

- `go build -gcflags='all=-l'` disables inlining for analysis.
- `//go:noinline` on a specific function preserves its frame.
- Modern Go (1.21+) improves inline-frame attribution, but isn't perfect.

When the profile attribution looks suspicious, drop to `disasm` to see what the compiler actually emitted.

---

## Q10. Why is your benchmark profile dominated by setup code?

You probably forgot `b.ResetTimer()`. The benchmark runs with variable `b.N`. If setup is expensive and `N` is small, setup dominates the measured time.

```go
func BenchmarkParse(b *testing.B) {
    data := generateLargeInput()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        parse(data)
    }
}
```

`ResetTimer` zeroes the elapsed counter and the profile collector so only the loop body counts. Without it, profile attribution is wrong even if the timing report looks plausible.

---

## Q11. What is PGO and how does it use CPU profiles?

PGO (Profile-Guided Optimization), introduced in Go 1.20 and matured in 1.21+, lets the compiler read a CPU profile and use it to guide inlining, devirtualization, and basic-block layout.

Workflow:

1. Capture a representative production profile.
2. Save it as `default.pgo` next to the `main` package.
3. Build with `go build -pgo=auto`.

Typical speedup is 2–14% on real services. PGO is most effective when the profile reflects realistic load (not microbenchmarks) and when the hot path includes interface calls (which PGO can devirtualize). Refresh the profile periodically — stale PGO data can mis-guide the compiler.

---

## Q12. How would you find a CPU regression introduced in the last release?

Two routes, both worth setting up:

**Continuous profiling.** A tool like Pyroscope or Parca stores profiles tagged by service version. Compare flame graphs for `v2.4.0` (yesterday) vs `v2.4.1` (now). A new wide flame is the regression.

**CI benchmarks.** Run `go test -bench=. -count=10` on a dedicated runner, store the baseline from `main`, and gate PRs with `benchstat baseline.txt new.txt`. Any function whose time increased by more than the threshold fails the build.

Both should run; they catch different things. Benchmarks find regressions in modeled paths; continuous profiling finds them in real production load.

---

## Q13. What's a "self-time vs total-time" example where the right answer differs?

Consider a profile:

```
flat  cum   function
3.0s  3.0s  runtime.memmove
0.0s  4.0s  serializeRequest
```

Sorting by flat says "fix memmove". But `memmove` is a library leaf; you can't speed it up. Sorting by cum says "look at serializeRequest" — its 4 seconds includes the memmove plus other work it controls.

The right move: open `serializeRequest`, find that it copies a 2 MB buffer in a hot path, and avoid the copy. The leaf isn't the bug; the caller's choice to invoke the leaf is.

---

## Q14. How does profile sampling interact with very short-lived goroutines?

Short-lived goroutines may complete entirely between two `SIGPROF` ticks (10 ms apart at 100 Hz). They contribute zero samples and are invisible in the profile.

Consequences:

- A high-fanout "spawn 100,000 goroutines, each does 100 µs of work" pattern shows up as `runtime.schedule` + `runtime.newproc` overhead, not as the actual work.
- The fix is to **batch** — a worker pool drains a job channel; each worker is long-lived and gets sampled normally.
- For diagnosing the missing work, supplement with `go tool trace`, which records goroutine creation explicitly.

---

## Q15. Walk me through diagnosing a "CPU went from 50% to 90% overnight" incident.

Five-step runbook:

1. **What changed?** New deployment? Traffic spike? Schema change? Check the deploy log and request-rate metric first.
2. **Continuous profile diff.** Open the flame graph for "now" vs "24h ago" at the affected version. New wide flames = real regression; uniformly wider profile = traffic.
3. **If no continuous profiler**: SSH-tunnel to the pprof endpoint, capture 60s, compare against a saved baseline (if you have one) or against another replica (if behavior differs across replicas).
4. **Decide**: rollback (if regression), scale (if traffic), debug (if slow leak now surfacing).
5. **Mitigate first**, then commit to a fix and write the postmortem so the next on-call recognizes the same shape faster.

Each step should be a few minutes. If step 2 is taking an hour, the tooling investment for next time is where to spend energy.

---

## Q16. What's the difference between the CPU profile, the heap profile, and the trace?

| Tool | Records | Question it answers |
|------|---------|---------------------|
| **CPU profile** | On-CPU stacks, 100 Hz sampled | "Where is CPU spent?" |
| **Heap profile** | Allocations, 512 KiB sampled | "Where is memory allocated?" |
| **Trace** | Every scheduler event, GC pause, syscall | "Why is this specific request slow?" |

A CPU profile is the right starting point for throughput questions; a trace is the right tool for tail-latency questions. The heap profile diagnoses allocation rate, which is itself often the root cause of CPU spent in `runtime.gcBgMarkWorker`.

---

## Q17. How does `runtime.SetCPUProfileRate` behave, and what's the cost of higher rates?

```go
runtime.SetCPUProfileRate(500)
```

Sets the period to `1e9 / hz` ns. Must be called before `StartCPUProfile` — changing the rate during an active profile is undefined.

Higher rates produce more samples per CPU-second but:

- Kernel `setitimer` resolution is ~1 ms on Linux; rates above 1000 Hz are clamped.
- Each sample executes the stack walker; at very high rates this is a measurable fraction of program CPU (5–10% at 1000 Hz on some workloads).
- The signal handler itself becomes part of what gets sampled, creating reflexive noise.

Stay at 100 Hz unless you have a measured reason. Run the workload longer to gather more samples instead.

---

## Q18. Explain `pprof -base` versus `pprof -diff_base`.

Both compare two profiles. The difference:

- `-base=old.pprof`: subtracts `old` from the current profile, showing absolute deltas. Negative values (improvements) appear as green; positive values (regressions) appear as red. Functions absent from either show as zero.
- `-diff_base=old.pprof`: shows only **positive** differences — places where the new profile is heavier than the base. Useful when you only care about regressions.

`-base` is the common case for "did my fix work" analysis. `-diff_base` is useful in regression review when you don't care about the cells that got faster.

---

## Q19. What's the cost of running pprof in production?

For CPU profiles at 100 Hz: typically 1–5% CPU overhead during capture. Outside capture, the cost is zero (the signal isn't requested).

Other profiles:

- **Heap profile**: nearly free (samples on allocation; ~512 KiB sample rate).
- **Block / mutex profiles**: free until you call `SetBlockProfileRate` / `SetMutexProfileFraction`; then a small per-event overhead. Set rates carefully in production.
- **Goroutine profile**: cheap to capture (snapshot of stacks). Avoid running it on a pathologically large goroutine population.
- **Trace**: 1–10% overhead depending on event volume. Not for continuous use; capture in 5–30 second bursts.

CPU profiling specifically is safe to run continuously in production via a continuous-profiling agent (Pyroscope, Parca, cloud profilers).

---

## Q20. How would you design CPU profiling integration for a new service?

A staff-level answer:

1. **Embed `pprof.Profile` endpoints** behind auth on a dedicated localhost port. Never on the public listener, never on `DefaultServeMux`.
2. **Integrate a continuous-profiling agent** (Pyroscope or Parca push library). Tag samples with `version`, `region`, `endpoint`.
3. **Adopt `pprof.Do` labels** in the request middleware so every CPU sample carries the endpoint pattern.
4. **CI bench gate**: `go test -bench -count=10` on a dedicated runner; fail PRs that regress benchmarks beyond a threshold using `benchstat`.
5. **Canary diff**: deploy to 5% of traffic for an hour; compare flame graphs; auto-rollback if regression exceeds 10%.
6. **PGO**: weekly job that pulls a representative production profile into the build pipeline.
7. **Runbook**: a documented procedure for "CPU is up" that points the on-call at the continuous-profiler diff first, never at manual pprof against a live host.

This is two days of setup and pays back in every incident afterward.

---

## Summary

CPU profiling in Go is a small surface (`StartCPUProfile`, `/debug/pprof/profile`, `go tool pprof`) backed by a deep mental model: statistical sampling via `SIGPROF`, on-CPU only, attributed by stack walk, biased by inlining and short-lived goroutines, useful in diff form against a baseline. The interview discriminator is rarely the commands — it's whether you know what the profile *can't* tell you and how to combine it with traces, mutex profiles, and continuous profiling for the full picture.

---

## Further reading
- "Profiling Go Programs" (Go blog): https://go.dev/blog/pprof
- pprof README: https://github.com/google/pprof/blob/main/doc/README.md
- Go PGO guide: https://go.dev/doc/pgo
- Pyroscope continuous profiling: https://pyroscope.io

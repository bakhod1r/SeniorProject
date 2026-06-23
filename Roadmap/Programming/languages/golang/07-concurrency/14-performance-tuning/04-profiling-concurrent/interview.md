# Profiling Concurrent Go Code — Interview Questions

## Table of Contents
1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Behavioural / Workflow Questions](#behavioural--workflow-questions)
6. [Live-Coding Prompts](#live-coding-prompts)

---

## Junior Questions

### Q1. Which three pprof profiles are most relevant to concurrent code, and what does each measure?

`goroutine`, `mutex`, `block`. The goroutine profile is a snapshot of every live goroutine with its current stack. The mutex profile records contention on `sync.Mutex` and `sync.RWMutex`. The block profile records all blocking sync events: channels, mutex, `sync.WaitGroup`, `sync.Cond`, `time.Sleep`.

### Q2. How do you enable the mutex and block profiles?

```go
runtime.SetMutexProfileFraction(100)
runtime.SetBlockProfileRate(int(time.Millisecond))
```

Both are off by default. The first samples ~1% of contended events; the second records events of at least 1 ms.

### Q3. What does a CPU profile fail to show in a concurrent program?

Off-CPU time. The CPU profile only samples while a goroutine is running; goroutines blocked on a lock or channel produce no samples. Latency caused by waiting is invisible to the CPU profile.

### Q4. What is the difference between `?debug=1` and `?debug=2` on the goroutine endpoint?

`debug=1` is a grouped text format showing each unique stack and the count of goroutines on it. `debug=2` prints every goroutine individually with its wait reason and duration.

### Q5. When would you use `runtime/trace` instead of a profile?

When the question involves timing or ordering. "Why does this one request occasionally take 200 ms?" — trace. "What's my hottest critical section?" — mutex profile.

---

## Middle Questions

### Q6. The CPU profile is at 5% and p99 latency is 2 seconds. Where is the time going and which profile do you check?

The program is off-CPU. Check the block profile first; if it's empty (or you haven't enabled it), capture a `runtime/trace` and look at the synchronization blocking profile inside.

### Q7. Why does the mutex profile attribute contention to the unlock site instead of the lock site?

To identify which critical section is causing the wait. The unlock stack shows the function whose lock-hold duration was the bottleneck. The lock stack would just point at every caller.

### Q8. The block profile reports 30 seconds of contention in a 10-second window. Is this a bug?

No. The block profile sums wait time across all goroutines. Three goroutines waiting 10 seconds each report 30 seconds total. The reporting is correct; the interpretation is "many goroutines were blocked concurrently."

### Q9. You ran `go tool pprof mutex.prof` and `top` shows a lot of `sync.(*Mutex).Lock` from many different functions. Two of them are the same function but different mutexes. Why are they collapsed?

Default pprof granularity is per-function. Two mutexes used in the same function show up as one. Run `go tool pprof -lines mutex.prof` (or `granularity=lines` in the REPL) to split.

### Q10. Why is `SetMutexProfileFraction(1)` dangerous in production?

It records every contended event with full stack walks. On a hot lock this can add measurable CPU and memory overhead. Use `100` for production; `1` is for brief forensic windows.

### Q11. Walk me through a block-profile-driven debug for a slow channel.

Enable block profile at 1 ms. Reproduce load. Capture `/debug/pprof/block`. `go tool pprof -lines block.prof`, `top -cum`. Top entry should be a `runtime.chansend` or `runtime.chanrecv` site. `list` that file. Check producer/consumer rates. Fix the slow side (consumer usually).

### Q12. Name three views in `go tool trace` and what each reveals.

- **View trace** — timeline of goroutines on each P, useful for visual ordering.
- **Goroutine analysis** — per-goroutine breakdown of on-CPU, sync block, syscall, scheduler wait.
- **Scheduler latency profile** — time spent runnable but not running. High values indicate over-scheduling.

### Q13. How do you diff two block profiles to verify a fix?

```bash
go tool pprof -base before.prof after.prof
(pprof) top
```

Negative numbers = contention decreased. Pair the diff with a stable load test to ensure the comparison is meaningful.

---

## Senior Questions

### Q14. Explain goroutine labels and `pprof.Do`. What problem do they solve?

Labels are key/value pairs attached to a goroutine. The profiler emits them with every sample. They let you slice a profile by request endpoint, tenant, worker pool, etc. `pprof.Do(ctx, labels, fn)` runs `fn` with the labels set and propagates them to goroutines started inside.

### Q15. How do labels propagate across the `go` statement?

The runtime copies the parent goroutine's `g.labels` to the new goroutine at `newproc`. So a `go f()` started while the parent is labelled also runs labelled. Outside of any label context, no labels propagate.

### Q16. What's the difference between a `trace.NewTask` and a `trace.StartRegion`?

A task is a top-level logical operation, often a request. It can span multiple goroutines and outlive the function that created it. A region is a span inside a task — typically scoped to one function via `defer`. Both appear in `go tool trace`'s user-defined view, but tasks aggregate regions.

### Q17. You want to ship continuous profiling for a 1000-instance fleet. What concerns do you raise?

Storage volume (~MB per scrape × 6 profile types × 1000 instances × frequency). Network cost. The mutex/block profile being off by default fleet-wide. Per-pod sampling (enable mutex/block on 10% of pods, not 100%). Auth on the pprof endpoint. Trace capture rate-limiting so an operator can't accidentally stall the service.

### Q18. Profile-guided optimization — does it help with lock contention?

No, directly. PGO uses CPU profiles to drive inlining and basic block ordering. It doesn't see lock behaviour. Indirectly, faster critical sections might reduce contention, but PGO is not the tool to fix contention. Use the mutex profile instead.

### Q19. You've added `pprof.Do(ctx, pprof.Labels("request_id", id), fn)`. What's wrong?

Cardinality. Every request has a unique ID, so the profile store would carry an unbounded set of labels. Use low-cardinality keys like `endpoint` or bucketed `tenant`. Request IDs belong in tracing, not profile labels.

### Q20. Compare Pyroscope, Parca, and Polar Signals.

All three pull standard pprof endpoints and store them queryably. Pyroscope (Grafana) integrates with Grafana dashboards and is the most familiar UX for Prometheus shops. Parca is kubernetes-native with Parquet on S3, good for very large data. Polar Signals is hosted Parca with additional features (PGO management, allocation tracking). The right one is the one that fits the team's existing stack.

### Q21. Why is `runtime/trace` not suitable for continuous collection?

Trace output is large — megabytes per second on a busy service. The viewer struggles past ~100 MB. Traces are designed for targeted captures of a few seconds. Continuous CPU/heap/mutex/block profiles are fine; continuous tracing is not.

---

## Professional Questions

### Q22. Inside the runtime, where does the mutex sample actually get recorded?

In `runtime.semrelease1` (in `src/runtime/sema.go`). When the releaser sees that one or more goroutines waited, it runs `cheaprandn(rate) == 0`. If true, it calls `mutexevent` with the waiter's wait time and the releaser's own stack.

### Q23. Explain the formula behind the block profile's sampling decision.

```
record if cycles >= rate  OR  cheaprand64()%rate < cycles
```

Long events are always recorded; short events are recorded with probability proportional to duration. The expected recorded total tracks the true total over a long window.

### Q24. The pprof format records `sample_type` entries. For a mutex profile, what are they?

`contentions: count` and `delay: nanoseconds`. `go tool pprof` defaults to `delay` because it's the more useful axis for ranking hot locks.

### Q25. How does the Go 1.22 trace2 format differ from the original?

Per-P partitioning (each P writes its own buffer), tighter timestamps via TSC, smaller per-event encoding, and a stricter event protocol that makes the parser simpler. Files are smaller and traces of busier services are more practical to capture.

### Q26. A goroutine moves between Ps mid-trace. What event sequence does the parser see?

`EvGoBlock` on the old P (or `EvGoSched` for cooperative yield), then `EvGoUnblock` followed by `EvGoStart` on the new P. The goroutine ID is the linkage; the trace parser stitches its timeline together by ID across Ps.

### Q27. When would internal `runtime.mutex` contention be invisible to the mutex profile?

Always. `runtime.mutex` is a separate primitive used by the scheduler, GC, etc. It does not feed `mutexevent`. To see it you need `GODEBUG=schedtrace=...` or, experimentally, `GOEXPERIMENT=staticlockranking`.

### Q28. You see a flame graph dominated by `runtime.gopark` in the CPU profile. What's happening?

The CPU profile sampled goroutines at the exact moment they were going to sleep. It's not "your CPU time is spent in `gopark`" — it's "every time the sampler interrupted, the running goroutine was about to block." The information value is low; switch to block or mutex profiles.

---

## Behavioural / Workflow Questions

### Q29. Walk us through how you'd debug "latency p99 doubled after yesterday's deploy."

1. Check goroutine count — leak?
2. Check CPU usage — saturation?
3. Capture goroutine, mutex, block profiles. Diff against yesterday's baseline (continuous profiling makes this trivial).
4. If the diff points at a function changed in yesterday's deploy, look at the PR.
5. If not, capture a 5 s trace, look at scheduler latency and goroutine analysis for the slow endpoint.
6. Roll back if uncertain, fix forward if obvious.

### Q30. You inherit a service with no profiling at all. What's day-one work?

- Add `_ "net/http/pprof"` on `127.0.0.1:6060`.
- Enable mutex profile at fraction 100, block profile at rate 1 ms.
- Wire up a continuous profiler (Pyroscope or Parca, depending on stack).
- Add a runbook: "how to capture a snapshot during an incident."
- Add the four concurrency health metrics to the dashboard.

### Q31. A teammate says "I don't trust the mutex profile — the numbers are confusing." How do you onboard them?

Two key clarifications. First, the time axis is **summed across goroutines** — not wall-clock. Second, the stack is the **unlock** site, not the lock site; the function shown is the one whose critical section took too long. After those two ideas land, the rest is `go tool pprof` mechanics.

### Q32. When would you say no to enabling mutex profile in production?

Almost never at fraction 100. If the service is performance-critical to a degree where 0.5% CPU matters (HFT, very tight HFT-adjacent), you might disable. Otherwise, the data is worth the cost.

---

## Live-Coding Prompts

### Prompt 1

Given a deliberately contended counter:

```go
type Counter struct {
    mu sync.Mutex
    n  int
}
```

Write a test that enables the mutex profile, runs 1000 goroutines each incrementing the counter, captures the profile, and asserts that `(*Counter).Inc` appears in the top of the profile.

### Prompt 2

Instrument an HTTP handler with `trace.NewTask`, `pprof.WithLabels`, and `pprof.SetGoroutineLabels`. Show that when the trace is captured, the handler shows up as a named task in `go tool trace`.

### Prompt 3

Take two block profiles (pre-fix and post-fix). Write a Go program using `github.com/google/pprof/profile` that computes the percentage change in total contention at each call site.

### Prompt 4

You're given a 200 MB `trace.out` that times out when opening in `go tool trace`. Write a script (any language) that splits it into 10 s chunks for separate viewing.

### Prompt 5

Add labels to a worker pool so that profiles can be sliced per `pool` and per `shard`. Show how the `top` output changes when you `tagfocus` to a specific shard.

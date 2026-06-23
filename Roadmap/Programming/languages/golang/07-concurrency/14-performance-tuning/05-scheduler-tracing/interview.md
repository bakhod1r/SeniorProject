# Scheduler Tracing — Interview Questions

[Back to index](index.md)

Questions you should expect for senior Go and infrastructure roles. Each question has a brief answer; the depth comes from the linked level file.

## Table of Contents
1. [Basics](#basics)
2. [Reading Output](#reading-output)
3. [`runtime/trace` Usage](#runtimetrace-usage)
4. [Annotations](#annotations)
5. [Production Scenarios](#production-scenarios)
6. [Diagnosing Specific Patterns](#diagnosing-specific-patterns)
7. [Format and Tooling Internals](#format-and-tooling-internals)
8. [Comparison Questions](#comparison-questions)
9. [Whiteboard-Style Drills](#whiteboard-style-drills)

---

## Basics

**Q1. What does `GODEBUG=schedtrace=1000` do?**

Every 1000 ms, the runtime prints a one-line summary of scheduler state to standard error: `gomaxprocs`, `idleprocs`, `threads`, `spinningthreads`, `runqueue`, and per-P runqueue lengths.

**Q2. What is the difference between `schedtrace` and `runtime/trace`?**

`schedtrace` is a coarse summary printed periodically. `runtime/trace` records every scheduler event into a binary file for offline analysis with `go tool trace`. Use schedtrace for ongoing observation and runtime/trace for deep dives.

**Q3. What does `scheddetail=1` add to `schedtrace`?**

Per-G, per-M, and per-P detail lines after each summary. Used when the summary is not enough to diagnose the problem.

**Q4. What is the overhead of `runtime/trace`?**

Typically 5–25% during the capture. Higher with heavy annotations. The capture itself produces tens of megabytes per second of trace data on a busy server.

**Q5. Why should you limit trace captures to a few seconds?**

The file size grows linearly with time; the UI struggles past a few hundred MB; the runtime overhead is non-trivial; and short bursts capture the symptom you are investigating better than long averages.

---

## Reading Output

**Q6. What does the bracketed list at the end of a schedtrace line mean?**

```
[0 0 0 0 1 0 0 0]
```

The local runqueue length for each P, in P-id order. Here only P4 has any local work, and only one G.

**Q7. What does `idleprocs=0` and high `runqueue` mean?**

All Ps are busy, and the global runqueue is non-empty. Local runqueues are full and overflowing to the global one. The system is at or beyond CPU capacity.

**Q8. What does `spinningthreads > 0` mean?**

Some Ms are actively scanning for runnable work without holding any themselves. The runtime caps this around `GOMAXPROCS/2`. Persistent spinning indicates either churn (work is being stolen quickly between Ps) or a pathological steal pattern.

**Q9. What does `threads` much larger than `gomaxprocs` indicate?**

Many Ms have been spawned, typically because syscalls are donating their Ps and the runtime needs replacement Ms to keep work flowing. A syscall storm.

**Q10. In `scheddetail` output, what does `G201: status=4(IO wait)` mean?**

G201 is in `_Gwaiting` state, blocked on the network poller. It will become `_Grunnable` when the kernel signals readiness.

---

## `runtime/trace` Usage

**Q11. How do you capture a trace from a running HTTP service?**

```bash
curl -o trace.out http://127.0.0.1:6060/debug/pprof/trace?seconds=5
```

Requires `import _ "net/http/pprof"` somewhere in the program.

**Q12. How do you open the trace?**

```bash
go tool trace trace.out
```

The tool parses the file, splits it into renderable chunks, and serves a UI on a random `localhost` port.

**Q13. What are the main views in the trace UI?**

View trace, Goroutine analysis, Network/Sync/Syscall blocking profiles, Scheduler latency profile, User-defined tasks and regions, Minimum mutator utilisation.

**Q14. Which view should you open first for a tail-latency investigation?**

Scheduler latency profile. It directly attributes "time runnable but not yet running" to call sites.

**Q15. Can you capture a trace and a CPU profile at the same time?**

Yes, but the combined overhead approaches 15–25%. Use it for one-off investigation, not continuously.

---

## Annotations

**Q16. What is the difference between a `trace.NewTask` and a `trace.WithRegion`?**

A task is a *logical operation* that may span goroutines (its identity travels via `context.Context`). A region is *function-local*: it begins and ends on the same goroutine. Use tasks for "one request" and regions for "one phase of work."

**Q17. How do you propagate a task across goroutines?**

Pass the `context.Context` returned from `NewTask` into the child goroutine. The task identity travels with the context.

**Q18. What is `trace.Logf`?**

A formatted, point-in-time event attached to any task active in the context. Shows in the UI's task detail and timeline.

**Q19. What is the cost of annotations when tracing is disabled?**

Approximately the cost of one atomic load and a branch — single-digit nanoseconds. Safe to leave in shipping code.

**Q20. Can you nest regions?**

Yes. They form a stack on each goroutine. Sibling regions on different goroutines may overlap freely.

---

## Production Scenarios

**Q21. How would you set up continuous tracing for a production service?**

A background goroutine takes a 2-second trace every 5 minutes, writes to a temp file, uploads to object storage with a name like `service/host/yyyymmdd/hhmmss.trace`. Disk usage is bounded; retention is N days.

**Q22. What is sampled tracing?**

Capturing short traces periodically rather than always-on. Sample rates are usually low — 1% of wall time or less.

**Q23. Should mutex and block profiles be enabled in production?**

Yes, at conservative rates: `SetMutexProfileFraction(100)` and `SetBlockProfileRate(int(time.Millisecond))`. The overhead is minimal and the data is invaluable when contention strikes.

**Q24. Is `runtime/trace` the same as OpenTelemetry tracing?**

No. OTel describes distributed requests across processes. `runtime/trace` describes intra-process scheduler behaviour. They complement each other.

**Q25. How do you avoid trace files growing without bound?**

Cap the directory size; rotate when over a threshold. Or upload immediately and delete locally.

---

## Diagnosing Specific Patterns

**Q26. Your service has p99 latency at 250ms but median at 10ms. What do you look at?**

1. `runtime/metrics` for `/sched/latencies:seconds` p99.
2. `runtime/trace` during a slow burst.
3. **Minimum mutator utilisation** view — is GC eating CPU?
4. **Scheduler latency profile** — are requests queueing?
5. **View trace** zoomed to a slow request — is the request blocked or scheduled badly?

**Q27. Your service shows `runtime.NumGoroutine()` increasing over time. How do you find the leak?**

1. Capture `goroutine?debug=2` at two intervals.
2. Diff with `pprof -base`.
3. The leak is at the top of the diff. The runtime trace can confirm by showing many `GoCreate` events without matching `GoEnd`.

**Q28. Your service uses 60% CPU but only saturates 7 of 8 cores. What is happening?**

Likely a stuck P: one P has been donated to a syscall and not reclaimed. `schedtrace,scheddetail=1` will show a P in `status=2` without `syscalltick` advancing. Often a cgo call.

**Q29. Your `threads` count grows to 200 over an hour. Why?**

Syscalls are donating Ps; idle Ms accumulate. Each blocking IO call that lasts > 20µs forces sysmon to detach the P; a new M is woken or spawned to take over. If many such syscalls occur concurrently, M count balloons.

**Q30. Your latency spikes correlate with garbage collections. What do you do?**

Confirm with `gctrace=1` and the **Minimum mutator utilisation** view. Mitigations:
- Reduce allocations on the hot path (object pools, pre-allocated buffers).
- Raise `GOGC` to run GC less often.
- Set `GOMEMLIMIT` to a hard memory cap (Go 1.19+).
- For absolute determinism, none of these eliminate STW; reducing them helps.

---

## Format and Tooling Internals

**Q31. What changed in the Go 1.21 trace format?**

Generations were introduced. The trace is split into ~64MB or ~1s chunks; each is self-contained with its own string/stack tables. This enables streaming consumption and reduces overhead.

**Q32. Why do trace events use per-M buffers?**

To avoid contention. Each M writes to its own ring buffer with no synchronization; a lock is only needed when the buffer flushes (~32KB) to the trace file.

**Q33. How are stack traces stored in a trace?**

The PC arrays are interned into a stack table per generation. Events reference stacks by integer ID.

**Q34. Can you parse a trace from your own code?**

Yes, with `golang.org/x/exp/trace`. The standard library's parser is internal.

**Q35. What does `go tool trace -pprof=sched trace.out` produce?**

A pprof-format file containing the scheduler latency profile. You can open it with `go tool pprof` and use pprof's filters.

---

## Comparison Questions

**Q36. When do you use a CPU profile vs a trace?**

CPU profile: "which function uses CPU?" Trace: "when did it run, and was the scheduler waiting on something?" For tail latency and queueing, trace wins.

**Q37. When do you use a block profile vs the trace's synchronization blocking profile?**

The block profile is *sampled* and runs continuously at low overhead. The trace's blocking profile is *complete* but only for the trace window. Use block profile for ongoing observation, trace for deep dives.

**Q38. When is `runtime/metrics` better than `runtime.NumGoroutine()`?**

When you want consistent semantics across runtime versions and access to histograms (scheduler latency, GC pauses). `NumGoroutine()` is fine for a quick log line; `runtime/metrics` is fine for a metrics endpoint.

**Q39. When is `GODEBUG=schedtrace` better than `runtime/trace`?**

Always-on production observation. The cost is essentially zero and the output is a small text stream you can pipe anywhere.

**Q40. When is OpenTelemetry better than `runtime/trace`?**

For distributed cross-service tracing. OTel knows about HTTP requests; `runtime/trace` knows about goroutines. Use both.

---

## Whiteboard-Style Drills

**Drill A.** Given this schedtrace line, describe the state of the system:

```
SCHED 5000ms: gomaxprocs=4 idleprocs=0 threads=12 spinningthreads=0 needspinning=0 idlethreads=4 runqueue=0 [80 90 85 75]
```

Answer: All 4 Ps are running. The system has 12 threads, 4 parked (idle Ms ready for syscall returns), 0 spinning, 0 in the global queue. Each P has 75–90 Gs waiting locally. The system is heavily loaded with even distribution across Ps. Work is queueing but not yet spilling to the global queue.

**Drill B.** Write a goroutine that captures `runtime/trace` for 2 seconds every 5 minutes.

```go
func traceLoop(ctx context.Context, dir string) {
    t := time.NewTicker(5 * time.Minute)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            name := filepath.Join(dir, fmt.Sprintf("trace-%d.out", time.Now().Unix()))
            f, err := os.Create(name)
            if err != nil {
                continue
            }
            _ = trace.Start(f)
            time.Sleep(2 * time.Second)
            trace.Stop()
            f.Close()
        }
    }
}
```

**Drill C.** Write an HTTP middleware that wraps each request in a `runtime/trace` task.

```go
func TraceMW(name string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            ctx, task := trace.NewTask(r.Context(), name)
            defer task.End()
            trace.Logf(ctx, "request", "%s %s", r.Method, r.URL.Path)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}
```

**Drill D.** Compute scheduler-latency p99 from `runtime/metrics`.

```go
func schedP99() float64 {
    s := metrics.Sample{Name: "/sched/latencies:seconds"}
    metrics.Read([]metrics.Sample{s})
    h := s.Value.Float64Histogram()
    var total uint64
    for _, c := range h.Counts {
        total += c
    }
    target := total - total/100
    var cum uint64
    for i, c := range h.Counts {
        cum += c
        if cum >= target {
            return h.Buckets[i+1]
        }
    }
    return 0
}
```

**Drill E.** Given a service with `runtime.NumGoroutine() = 100_000` and CPU at 5%, what hypothesis would you test first?

Likely netpoller saturation. Most goroutines are blocked waiting on network IO. Verify by capturing `goroutine?debug=2`: if most stacks end at `net.(*conn).Read`, the hypothesis holds. The scheduler is healthy; the bottleneck is downstream.

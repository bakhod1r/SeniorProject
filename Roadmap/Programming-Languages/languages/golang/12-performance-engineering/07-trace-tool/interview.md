# The Go Execution Tracer — Interview

Twenty questions to gauge familiarity with `runtime/trace`, the `go tool trace` viewer, and the runtime behaviors the tracer exposes.

---

## Q1. What does the execution tracer record that the CPU profiler does not?

The tracer records **every** runtime event — goroutine creates and exits, every state transition (running, runnable, blocked, syscall), every scheduler decision, every GC phase, every syscall enter/exit. The CPU profiler samples program counters at ~100 Hz. The tracer answers "what was the system doing at time T?"; the profiler answers "where was CPU spent?" The trace gives you precise wall-clock timing for waits, blocks, and scheduling; the profile cannot see time spent waiting.

---

## Q2. How do you capture a trace from a running HTTP service?

Import `net/http/pprof` for its side effects (registers handlers), expose it on a localhost port:

```go
import _ "net/http/pprof"
go http.ListenAndServe("127.0.0.1:6060", nil)
```

Then:

```bash
curl -o trace.out 'http://127.0.0.1:6060/debug/pprof/trace?seconds=5'
go tool trace trace.out
```

The `seconds` query parameter is mandatory; the handler captures for that duration.

---

## Q3. What's the API to start/stop a trace from code?

```go
import "runtime/trace"

f, _ := os.Create("trace.out")
defer f.Close()
if err := trace.Start(f); err != nil { ... }
defer trace.Stop()
```

Only one capture per process at a time. `trace.Start` returns an error if a trace is already active.

---

## Q4. What's the overhead of a running trace?

Typically 5-10% CPU. It varies with how event-rich the workload is — pure CPU loops produce few events (low overhead), heavy chan/syscall traffic produces many (higher overhead). Output is roughly 1-5 MB per second of wall clock at moderate concurrency. When `trace.Stop` is called, overhead drops to zero.

---

## Q5. What is a `trace.NewTask` and how does it differ from `trace.WithRegion`?

- `trace.NewTask(ctx, name)` opens a hierarchical, **cross-goroutine** span propagated via `context.Context`. Use it to follow one logical operation (e.g., a request) through fan-out.
- `trace.WithRegion(ctx, name, fn)` opens a **single-goroutine, synchronous** span. Use it to label phases inside a single goroutine.

A task can span many goroutines; a region cannot.

---

## Q6. How do you make user log events show up in the trace?

```go
trace.Log(ctx, "category", "message")
trace.Logf(ctx, "category", "rows=%d", n)
```

They appear in the "User-defined log messages" view, filterable by category. Cost is ~50 ns; safe to leave in production code for incident-time visibility.

---

## Q7. What's the difference between `GoBlockNet`, `GoBlockSync`, and `GoBlockSyscall`?

| Event | Triggered by |
|-------|--------------|
| `GoBlockNet` | A goroutine waiting on the netpoller (sockets, pipes managed by Go's `net` package) |
| `GoBlockSync` | A goroutine blocked on a Go synchronization primitive (chan send/recv, sync.Mutex.Lock, sync.Cond.Wait) |
| `GoBlockSyscall` | A goroutine in a blocking OS syscall (file I/O, `getaddrinfo`, cgo) |

They map to three different blocking profiles in the viewer.

---

## Q8. How does a goroutine wait for network I/O without consuming a P?

A goroutine that issues a non-blocking read on a Go-managed socket parks itself, the runtime registers interest with `epoll` / `kqueue` (the netpoller). The P is now free to run other goroutines. When the netpoller wakes up (the fd is ready), it `GoUnblock`s the waiting goroutine, putting it back on a run queue. No M, no P, just `epoll`.

In the trace this appears as a goroutine that "disappears" (no slices) during the wait and reappears when ready, with a linked event annotated `GoUnblock from netpoller`.

---

## Q9. What's the flight recorder and why does it matter?

`trace.NewFlightRecorder` (Go 1.25+) is a circular trace buffer running continuously in memory. It never writes to disk unless you call `WriteTo`. Use it to capture the *most recent* N seconds of execution at the moment something interesting happens — perfect for post-incident analysis of transient events you can't reproduce on demand.

```go
fr := trace.NewFlightRecorder(trace.FlightRecorderConfig{
    MinAge: 5*time.Second, MaxBytes: 64<<20,
})
fr.Start()
// later, on event:
fr.WriteTo(file)
```

---

## Q10. What's the MMU view good for?

Minimum Mutator Utilization plots, for each window size `t`, the worst-case fraction of CPU available to your code (not the runtime) over any sliding window of that size. It's a GC-quality metric: a program that pauses 1 ms every 100 ms scores ~99% at `t=100ms` but lower at smaller windows. Useful to validate latency SLOs against actual runtime behavior; if the MMU curve at your p99 budget is too low, no application tweak alone will meet the SLO.

---

## Q11. You see long pale slices preceding short bright slices on every goroutine. What does that indicate?

Pale = runnable; bright = running. Long pale tails mean goroutines are spending much more time waiting for a P than executing. That's **oversubscription**: too many runnable goroutines for `GOMAXPROCS`. Fix with a bounded worker pool sized to (or a small multiple of) `GOMAXPROCS`.

---

## Q12. What's `gcAssistAlloc` and why is seeing it bad?

When the GC pacer falls behind allocation, the runtime *conscripts* allocating goroutines to do mark work mid-allocation. Those slices show as `runtime.gcAssistAlloc` in the flame view. Their presence means your code is being forced to help the GC catch up — a sign of high allocation rate or insufficient GC headroom. Mitigation: reduce allocation rate, raise `GOGC`, or set `GOMEMLIMIT`.

---

## Q13. How do you reduce STW pauses?

STW pauses scale with:

- The number of goroutines (every stack must be scanned).
- The size of the live pointer-rich heap.
- The presence of finalizers (extra work).

Reduce via fewer/longer-lived goroutines, smaller pointer-dense live data, removing finalizers (use `runtime.AddCleanup` since Go 1.24, or explicit `Close` patterns). `runtime/metrics` `/gc/pauses:seconds` is the cheap continuous metric to alert on.

---

## Q14. Why might `runtime.NumGoroutine()` grow without bound when the trace shows healthy code?

The trace's flame view is bounded by capture window. A leak that produces one stuck goroutine per second is invisible inside a 5-second window. You need `runtime.NumGoroutine()` over time (or `runtime/metrics` `/sched/goroutines:goroutines`) to spot growth, and `/debug/pprof/goroutine?debug=2` to see the leaked stacks.

The trace + goroutine pprof together: trace shows you behavior, pprof shows you accumulation.

---

## Q15. How would you measure if your "parallel" pipeline is actually parallel?

Capture a trace under load. Open the flame view. Count how many P lanes are simultaneously bright during a typical handler interval. If `GOMAXPROCS=8` but only 1-2 lanes are ever simultaneously busy, the pipeline is serial despite the goroutines. The "Synchronization blocking profile" usually identifies the culprit (a shared mutex, a single connection pool slot, an order-preserving channel).

---

## Q16. What's the cost of `trace.NewTask` and `trace.WithRegion`?

Each is a few hundred nanoseconds: it allocates a task/region object and records two events (begin + end). Negligible for handlers measured in milliseconds; meaningful in code paths measured in microseconds. The recommended placement: per-request task, per-phase region, no regions inside tight inner loops.

---

## Q17. Trace says a goroutine blocked 100 ms in `GoBlockSync` — how do you find what held the lock?

Click the slice **after** the gap in the flame view. The sidebar shows a "Linked event" of the form `GoUnblock from G<n>`. That's the goroutine that *released* the resource. Click through to G<n>'s timeline; its preceding slice is the critical section that took 100 ms. Examine that slice's stack to find the slow code inside the critical section.

For aggregate views, the mutex profile (`/debug/pprof/mutex`) ranks contention sites by total wait time but doesn't show *when*; the trace shows *when* but for individual events.

---

## Q18. Trace and CPU profile disagree about where time is spent. What does each mean?

The CPU profile shows where CPU **time** went; it sees only running goroutines, sampled at 100 Hz. The trace shows where wall-clock **time** went; it captures running, runnable, blocked, and syscall time.

If wall clock is dominated by blocking (network, lock, GC), the CPU profile will appear "empty" relative to the elapsed time. That's not a disagreement — it's the two tools answering different questions. Use both: the CPU profile for "what code burns CPU?", the trace for "what was the program waiting on?".

---

## Q19. How do you keep trace overhead acceptable in production?

Three rules:

1. Don't run a trace continuously. Use the flight recorder (always-on in memory, dump on demand) instead.
2. Throttle on-demand captures (one per minute is plenty) so an aggressive operator can't DoS the process.
3. Cap `seconds` to a defensible maximum (5-30 s); never accept arbitrary input.

Localhost-only binding for the pprof endpoint, dedicated mux (not `http.DefaultServeMux`), and authentication for anything beyond local complete the picture.

---

## Q20. Walk me through diagnosing a sudden p99 latency spike with the trace.

1. **Check metrics.** `/sched/latencies:seconds`, `/gc/pauses:seconds`, `/sched/goroutines:goroutines`. Identify which dimension regressed.
2. **Capture during the spike** (or pull from the flight recorder).
3. **Goroutine analysis.** Sort by total time. Identify the function with anomalous `Sched wait`, `Sync block`, or `Network wait`.
4. **Drill into the flame view** at the spike time. Click long slices, read stacks.
5. **Match to a category**: scheduler latency (oversubscription) → bound concurrency; GC pause → reduce allocation; sync block → shorten critical section; network block → diagnose downstream service; syscall block → check for blocking DNS/disk; long single goroutine → break into chunks.
6. **Verify.** Apply fix in a canary, reproduce load, re-trace, confirm the shape is gone.

The trace is rarely the start of the investigation (metrics are) but it's almost always the step that gets you from "something is wrong" to "this exact thing in this exact code."

---

## Further reading
- `runtime/trace`: https://pkg.go.dev/runtime/trace
- Felix Geisendorfer, "Reading a Go trace": https://blog.felixge.de/reading-go-execution-traces/
- Go diagnostics guide: https://go.dev/doc/diagnostics
- "Diagnose user-perceived latency with execution traces", Go blog: https://go.dev/blog/execution-traces-2024

# go tool trace — Middle

## 1. When trace beats pprof

pprof samples *aggregate* CPU or allocation hot spots. The tracer records the *exact, ordered sequence* of scheduling and blocking events. Use the tracer when the question is about **time**, **latency**, or **ordering**, not CPU:

| Question | Tool |
|----------|------|
| Which function burns CPU? | pprof CPU |
| Why is p99 latency 200ms when median is 5ms? | trace |
| Why are goroutines starved even though CPU is idle? | trace |
| How long is each GC pause? | trace |
| Is a single slow request blocked on the network or on a mutex? | trace |
| Why does throughput collapse at N goroutines? | trace |

If your CPU profile shows ~30% utilization but your service still misses its SLO, the time is being spent **not running** — exactly what the tracer reveals.

---

## 2. Reading the timeline

In **View trace**, the top row(s) labelled `PROC 0`, `PROC 1`, ... show what each scheduler P was executing at every moment. Below them, threads (`M`) and goroutines (`G`) appear when zoomed in. Colour conventions to internalize:

- Solid bars on a `PROC` row = a goroutine actively running on that P.
- Gaps on a `PROC` row = the P had nothing runnable.
- Brown / hatched regions = GC activity (sweep, mark, mark-assist).
- Vertical pink/red bars across all PROCs = stop-the-world (STW) pauses.
- Goroutine arrows (when zoomed in) = `unblock` events: who woke whom.

Click any bar to see the event in the bottom pane, including the stack trace at that moment.

---

## 3. What STW pauses look like

A STW pause is a thin vertical band where every PROC simultaneously stops executing user goroutines. Modern Go's STW (mark setup + termination) is sub-millisecond on healthy workloads. If you see a STW band wider than ~1ms, investigate:

- Very large heap with many goroutines (root scan).
- A goroutine stuck in tight assembly or cgo that cannot be preempted (preemption delay).
- Frequent GC because allocation rate is too high (look at the GC frequency in the same view).

The **Minimum mutator utilization** (MMU) link from the landing page plots, for each window size, what fraction of CPU your code (not GC) had — a sharp dip means GC dominated.

---

## 4. Network-blocked goroutines

The **Network blocking profile** ranks call sites by how much wall time goroutines spent waiting on the network poller (`epoll`/`kqueue`). A high entry on a hot path means many goroutines block on the same socket read/write. Combine with the timeline: zoom in and look for many short bars followed by long gaps, then arrows from the netpoller waking them.

This is how you spot "everything is waiting on the upstream API" issues that no CPU profile would show.

---

## 5. Goroutine starvation: runnable but not running

The **Scheduler latency profile** shows time goroutines spent in the **runnable** state — ready to run but waiting for a P. Non-trivial latency here means:

- Too many runnable goroutines for `GOMAXPROCS` (over-subscription).
- A goroutine ran a long uninterruptible loop (Go 1.14+ async preemption helps, but cgo and assembly can still hold a P).
- A burst of goroutines was created and the scheduler is catching up.

In **View trace**, zoom into a busy region. If the **Runnable** row at the bottom (when you click a goroutine) shows a long bar before the **Running** state begins, that goroutine starved.

---

## 6. Annotating your code with tasks and regions

`runtime/trace` lets you name your own units of work so the UI surfaces them:

```go
import "runtime/trace"

func handle(ctx context.Context, req *Request) {
    ctx, task := trace.NewTask(ctx, "handleRequest")
    defer task.End()

    trace.Log(ctx, "userID", req.UserID)

    trace.WithRegion(ctx, "auth", func() { authorize(req) })
    trace.WithRegion(ctx, "db.query", func() { loadFromDB(req) })
    trace.WithRegion(ctx, "render", func() { renderResponse(req) })
}
```

- **Task** = a logical operation that spans goroutines (a request, a job).
- **Region** = a named span within one goroutine.
- **Log** = a key/value annotation attached to a task.

In the UI, **User-defined tasks** lists every `NewTask`/`End` pair with its duration, child regions, and goroutines. Clicking one jumps the timeline to that task. This turns "why was *this* slow?" into a guided view.

---

## 7. Capturing from a live server

Wire `net/http/pprof` once (only on an internal port — see find-bug for the trap):

```go
import _ "net/http/pprof"

go func() { _ = http.ListenAndServe("127.0.0.1:6060", nil) }()
```

Then trigger a capture on demand:

```bash
curl -o trace.out 'http://127.0.0.1:6060/debug/pprof/trace?seconds=5'
go tool trace trace.out
```

The handler streams 5 seconds of trace data into your file with no extra code in your app. Keep windows short (≤5s) — a busy server can produce hundreds of MB of trace per second, and the UI struggles past a few hundred MB.

---

## 8. Workflow for diagnosing a latency spike

1. Reproduce the spike with load (or wait for it).
2. Capture `?seconds=3-5` covering a spike.
3. Open the trace; in **Goroutine analysis**, find goroutines with the largest *blocked* time on the relevant axis (network, sync, syscall).
4. Click into one; the timeline jumps to its lifecycle.
5. Look at the unblock arrows: who woke this goroutine, and why did it take so long?
6. If multiple goroutines blocked on the same site, instrument that site with a `WithRegion` and recapture for a clean view next time.

---

## 9. Overhead awareness

The tracer is precise because the runtime emits an event for every scheduling decision. Typical overhead is roughly **5-10% throughput** and a small per-event CPU cost. That is acceptable for short, targeted captures (seconds), not for always-on production. Section 9 of `senior.md` covers the flight recorder, which makes always-on capture practical.

---

## 10. Summary

Reach for `go tool trace` when the question is about *time and ordering*, not aggregate CPU. The timeline view exposes STW pauses, network/sync blocking, and scheduler starvation that no profiler shows. Capture short windows (≤5s) from `/debug/pprof/trace?seconds=N` or test runs, annotate hot paths with `trace.NewTask` and `WithRegion`, and read the per-dimension blocking profiles before diving into the raw timeline.

---

## Further reading
- `runtime/trace` API: https://pkg.go.dev/runtime/trace
- "Diagnostics" guide: https://go.dev/doc/diagnostics
- `net/http/pprof` trace endpoint: https://pkg.go.dev/net/http/pprof

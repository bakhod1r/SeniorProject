# go tool trace — Senior

## 1. The cost of the tracer, precisely

Every scheduling decision in the Go runtime — goroutine create, block, unblock, syscall enter/exit, GC start/done, proc start/stop — emits a trace event when the tracer is on. Cost has two parts:

1. **Per-event:** a few nanoseconds to write into the active P's local trace buffer (lock-free for the hot path).
2. **Per-flush:** periodically, the runtime swaps the per-P buffer and writes it to the trace `io.Writer`. This is where I/O latency shows up.

Empirical overhead on real services is typically **5-10% throughput** and a noticeable bump in tail latency from buffer flushes. That is fine for **short, targeted captures**, never for always-on production — except via the flight recorder (section 9).

The tracer also pins memory: each P holds at least one trace buffer (~64KB or so). High `GOMAXPROCS` × always-on traces × long capture windows = lots of RAM.

---

## 2. Choosing the capture window

A 30-second trace on a busy server can be hundreds of MB and crash the browser. Two rules:

- **Capture short windows** (≤5s by default; 1-2s is often enough).
- **Capture targeted windows** — start the capture just before the event you suspect (a queued job, a synthetic burst), not "for the whole hour and hope".

If you need a longer view, aggregate multiple short traces or use the flight recorder.

---

## 3. Bin sizes vs distribution

The per-dimension profiles (network/sync/syscall blocking, scheduler latency) bucket times into bins. **Total** time in a bucket is interesting, but always also inspect the **distribution**:

- 1000 × 1µs blocks ≠ 1 × 1ms block, even if the totals match.
- The latter probably reflects a real stall worth investigating; the former is normal channel chatter.

Use the timeline to confirm: zoom on one long bar in the offending row rather than chasing aggregate totals.

---

## 4. A long syscall blocks an entire P (sometimes)

In Go's scheduler, when a goroutine enters a syscall the runtime usually **hands the P off** to another M so other goroutines keep running. But there are conditions where that doesn't happen quickly (very short syscalls, cgo with unmovable G), and in cgo the runtime cannot always preempt at all.

In the trace, this shows as:
- A `PROC` row where the active goroutine sits in `Syscall` for a long time.
- Other runnable goroutines accumulating in the **Scheduler latency** profile on that P.
- No corresponding work on a sibling M.

This is a classic "everything halted because one goroutine called into C" diagnosis. Fix: shorten the cgo call, drop the syscall to a worker pool, or set `runtime.LockOSThread` only where required.

---

## 5. Goroutine flow: following one request

The **View trace** has a per-goroutine focus mode: click a goroutine, then "Show goroutine analysis". You see its entire lifecycle (created, runnable, running on P3, blocked on chan, unblocked by G42, running on P1, ...). For a request that spans many goroutines, lift this to the **task** abstraction:

```go
ctx, task := trace.NewTask(ctx, "GET /orders")
defer task.End()
```

The **User-defined tasks** tab lists every task with its tree of regions and goroutines. Clicking one filters the timeline. This is the single most useful primitive for "why was *this one* request slow?" on a busy service.

---

## 6. Identifying lock convoys

A **lock convoy** is when many goroutines line up behind one mutex; the holder finishes, exactly one is awoken, runs briefly, takes the lock again, and the line never drains. Signature in a trace:

- The **Synchronization blocking profile** shows one acquire site dominating wall time.
- In the timeline, you see a staircase: G1 runs briefly, G2 runs briefly, G3 runs briefly — never two at once on this lock, never any with idle time.
- Throughput on the affected operation is roughly `1 / (critical_section_time + handoff_time)` — fixed regardless of how many goroutines you add.

Fixes: shrink the critical section, switch to `sync.RWMutex` if read-heavy, shard by hash, or replace the mutex with channels/atomics.

---

## 7. Scheduler latency analysis (runnable-to-running)

Open **Scheduler latency profile**. It shows, per goroutine creation site, how long goroutines sat **runnable** before being **scheduled**. Healthy interactive workloads are sub-microsecond; high entries mean:

| Cause | Signal |
|-------|--------|
| Over-subscription | many runnable G's, all P's busy |
| Preemption blocked | one G hogs a P (cgo, tight loop in pre-1.14 style) |
| GC assist | mark-assist in the same window stealing CPU |
| Wrong GOMAXPROCS | container CPU quota < `GOMAXPROCS` |

For the last one, set `GOMAXPROCS` to the container CPU quota (or use `automaxprocs`) and re-capture — scheduler latency typically collapses.

---

## 8. Flight recorder: always-on capture with a rolling buffer

The "long capture is too big" problem is solved by the **flight recorder** (`runtime/trace.FlightRecorder`, available in Go 1.23+). It keeps a small rolling window of trace events in memory continuously; when an anomaly happens you snapshot it.

```go
import "runtime/trace"

fr := trace.NewFlightRecorder()
_ = fr.Start()
defer fr.Stop()

http.HandleFunc("/debug/flightrecorder", func(w http.ResponseWriter, r *http.Request) {
    if _, err := fr.WriteTo(w); err != nil {
        http.Error(w, err.Error(), 500)
    }
})

// Elsewhere: when a request exceeds the SLO, dump the recent past.
if elapsed > 500*time.Millisecond {
    f, _ := os.Create("slo-miss.trace")
    fr.WriteTo(f)
    f.Close()
}
```

You always have the **last few seconds** of trace data; nothing is written to disk unless you snapshot. Overhead is similar to a normal trace (the runtime still emits events), but you avoid the I/O cost of continuous file writes and the giant-file problem.

This turns the tracer from "fire-fighting tool you wish you had on at the time of the incident" into "always there, snapshot on alert."

---

## 9. Trace on production: rules

- Capture from an **internal** port only; never expose `/debug/pprof/trace` publicly.
- Bound the window with the `seconds` parameter.
- Roll out the flight recorder behind a config flag; verify CPU impact under load first.
- Snapshot on **SLO miss**, not on every request — bursts of snapshots saturate disk.
- Store traces in object storage with a short TTL; they are sensitive (filenames, URLs, query keys via `trace.Log` may leak).

---

## 10. Summary

The tracer's value is precise event ordering; its cost is ~5-10% throughput plus memory for per-P buffers. Capture short, targeted windows; read both the bin totals and the distribution; treat long syscalls and lock convoys as recognizable timeline patterns; and use scheduler latency to expose container CPU mis-sizing. For production diagnostics, the Go 1.23+ flight recorder gives you an always-on rolling window so you can snapshot the trace exactly when an SLO is missed instead of relying on luck.

---

## Further reading
- `runtime/trace.FlightRecorder`: https://pkg.go.dev/runtime/trace
- "Execution tracer" deep dive (Dmitry Vyukov, design doc): https://go.googlesource.com/proposal
- Go diagnostics guide: https://go.dev/doc/diagnostics

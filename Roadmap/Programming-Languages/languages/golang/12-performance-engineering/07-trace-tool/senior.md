# The Go Execution Tracer — Senior

## 1. What the senior eye looks for first

When you open a trace as a senior engineer, you're not chasing one slow function. You're scanning the whole timeline for **shapes** that indicate categories of trouble:

| Shape | What it usually means |
|-------|------------------------|
| Most P lanes empty, one or two saturated | Under-parallelism; serial bottleneck |
| Every P busy but few user goroutines visible | GC overhead; mark workers everywhere |
| Frequent tall stacks of `gcAssistAlloc` | Allocator outrunning the pacer |
| Long pale ("runnable") tails on goroutines | Oversubscription; not enough Ps |
| Periodic STW bars every few seconds | Healthy GC cadence |
| STW bars > 1 ms | GC pause regression; investigate |
| Wide vertical bars across all goroutines | A global pause: STW, scheduler quiesce, sysmon glitch |

Train yourself to read the shape first, the slices second.

---

## 2. Scheduler internals you'll see in the trace

The Go scheduler runs N goroutines on M OS threads via P (processor) abstractions; `GOMAXPROCS` sets the number of Ps. The trace exposes:

| Concept | Event(s) | Meaning |
|---------|----------|---------|
| Goroutine queued on a P's run queue | `GoCreate`, `GoUnblock` | Newly runnable |
| Goroutine starts running | `GoStart` | Dequeued from a runq onto a P |
| Goroutine yields | `GoSched` | Voluntary yield (rare) or `runtime.Gosched()` |
| Goroutine pre-empted | `GoPreempt` | Async preemption hit (Go 1.14+) |
| Work stolen between Ps | `ProcSteal` | A P with empty runq took work from another |
| P parked | `ProcStop` | No work; M may go to `findrunnable` |
| P resumed | `ProcStart` | A new M brought a P online |

A healthy mixed workload shows constant churn in `GoCreate/GoStart/GoEnd`, occasional `ProcSteal` to balance load, and no extended `ProcStop` periods on any P while runnable goroutines wait.

---

## 3. Detecting oversubscription

Oversubscription = too many goroutines for the Ps available. Symptoms in the trace:

- "Goroutine analysis" shows large `Sched wait` columns.
- The flame view shows long pale slices (`runnable`) before the bright (`running`) ones.
- The bottom thread lane shows all Ms active but goroutines still queued.

```go
// classic oversubscription
for i := 0; i < 100000; i++ {
    go computeHash(items[i])   // 100k goroutines for 8 Ps
}
```

The fix is a bounded worker pool:

```go
sem := make(chan struct{}, runtime.GOMAXPROCS(0))
var wg sync.WaitGroup
for i := range items {
    sem <- struct{}{}
    wg.Add(1)
    go func(i int) {
        defer wg.Done(); defer func() { <-sem }()
        computeHash(items[i])
    }(i)
}
wg.Wait()
```

After the fix, `Sched wait` should drop close to zero and total throughput should rise because the scheduler isn't thrashing.

---

## 4. Under-parallelism — the opposite problem

A wide trace with most P lanes idle and one saturated is a serial bottleneck. Common causes:

- A global mutex held in a critical section that's CPU-bound.
- A single goroutine doing fan-out work item by item instead of dispatching.
- A queue with a single consumer goroutine.

In the trace, you'll see one goroutine running continuously while others wait on `chan recv` or `Mutex.Lock`. Click the running goroutine; if its stack always shows the same function, that's where to split work.

---

## 5. GC events, decoded

Each GC cycle in the trace has a structure:

```
HEAP:   live ────────────╱ goal ─ trigger! ─ GCStart ─ MARK ──── STW(MT) ── SWEEP ── GCDone
                                              │                       │
                                              └── gcBgMarkWorker on each P during mark
                                                  gcAssistAlloc on allocating goroutines
```

| Event | What to check |
|-------|----------------|
| `GCStart` | How often? > once per second under steady load = high allocation rate |
| `gcBgMarkWorker` slices | Should run on idle P time; if your code is also running, they steal CPU |
| `gcAssistAlloc` slices | Your goroutines being conscripted to help mark; means GC is behind |
| STW mark termination | Should be < 1 ms; > 10 ms is a regression |
| `GCSweep` | Spread across allocations after `GCDone`; cheap individually |

A healthy GC pattern: short, regular cycles with most mark work on `gcBgMarkWorker` and minimal `gcAssistAlloc`. Tune via `GOGC` and `GOMEMLIMIT`; or, structurally, reduce allocation rate.

---

## 6. Syscalls in the trace

When a goroutine enters a blocking syscall:

1. `GoSysCall` event is emitted on its P.
2. If the syscall takes long enough (the runtime polls every ~10 µs via sysmon), `GoSysBlock` fires and the P is detached, free to run another goroutine.
3. On return, `GoSysExit` fires; the goroutine acquires a P (possibly different from the original) or waits.

In the flame view, you see this as the goroutine "leaving" its P, the P picking up a new goroutine, and the syscall goroutine reappearing on possibly a different P later. The "Syscall blocking profile" aggregates these.

Long syscalls (e.g., disk reads on a slow disk, DNS lookups, blocking `getaddrinfo`) often surface here. They're invisible to the CPU profile because no Go code is running.

---

## 7. Network blocking — netpoll

Network I/O does **not** use blocking syscalls under the hood; Go uses `epoll`/`kqueue` via the runtime's netpoller. A goroutine waiting on a socket emits `GoBlockNet` and is parked until the file descriptor is ready. When `epoll_wait` returns, the netpoller `GoUnblock`s it.

In the trace you'll see:

- Gaps in the goroutine's timeline (no slice, because it's not on a P).
- The slice **after** the gap has a "Linked event: GoUnblock from netpoller" annotation.
- The "Network blocking profile" stacks accumulate.

A handler that spends most of its time in network blocks is healthy *if* it's waiting for an external service. It's a bug *if* the network it's waiting on is itself in your process (e.g., a deadlock between two services on the same node).

---

## 8. Mutex and channel contention

Sync blocks (`GoBlockSync`, `GoBlockSend`, `GoBlockRecv`, `GoBlockSelect`) appear when a goroutine waits on a Go primitive:

| Event | Cause |
|-------|-------|
| `GoBlockSync` | `sync.Mutex.Lock`, `sync.RWMutex.RLock`, `sync.Cond.Wait` |
| `GoBlockSend` | Sending on a full channel |
| `GoBlockRecv` | Receiving from an empty channel |
| `GoBlockSelect` | All cases blocked in a `select` |

The flame view annotates the next slice with `GoUnblock from G<n>`. That is the goroutine that *released* the resource — your contention partner. Follow the link to its timeline and you'll often find a long critical section there.

For high-volume contention, capture a mutex profile (`/debug/pprof/mutex`) alongside the trace; the profile aggregates while the trace localizes.

---

## 9. The Minimum Mutator Utilization (MMU) view

`go tool trace` ships a unique view: **MMU** — the worst-case fraction of CPU available to your code over a sliding window of size `t`. A perfect (no GC) program is 100% at every `t`. A program with 1 ms STW pauses every 100 ms is ~99% at `t=100ms`, but drops below that at smaller windows.

Use the MMU view to set realistic latency SLOs. If your p99 budget is 5 ms but the MMU curve shows `mmu(5ms) = 0.6`, the GC alone consumes 40% of any 5 ms window — you cannot meet the SLO with the current allocation rate.

---

## 10. Preemption — when goroutines actually yield

Pre-Go 1.14, goroutines yielded only at function call boundaries. Long tight loops with no calls could starve all other goroutines on a P. Since Go 1.14, the runtime uses asynchronous preemption via signals (`SIGURG`); after ~10 ms, a long-running goroutine is preempted.

In the trace, `GoPreempt` events mark these. A trace with **many** `GoPreempt` events on the same goroutine is suspicious: the goroutine is running for 10+ ms at a time, which suggests it has tight loops without natural yield points. That's fine if it's pure CPU work, less fine if other latency-sensitive goroutines are waiting on it.

---

## 11. Combining trace and pprof

The trace tells you *when*. CPU pprof tells you *what code*. The two are complementary, not redundant.

A workflow that works:

```bash
# capture both at once
curl -o cpu.pprof 'http://localhost:6060/debug/pprof/profile?seconds=10' &
curl -o trace.out 'http://localhost:6060/debug/pprof/trace?seconds=10'
wait

go tool trace trace.out          # find the slow region in time
go tool pprof cpu.pprof          # see the hot stacks at that moment
```

Even better: open the trace, click on a "Running" slice, and the sidebar shows the stack — that's effectively the pprof sample for that instant. The trace **embeds** a sampled CPU profile in newer Go versions, which the viewer surfaces.

---

## 12. Reading raw events programmatically

The viewer's UI is one window onto the trace. For ad-hoc questions (e.g., "how many goroutines were created per second?", "what's the distribution of `GoBlockNet` durations?"), use `golang.org/x/exp/trace`:

```go
import "golang.org/x/exp/trace"

r, _ := trace.NewReader(file)
for {
    ev, err := r.ReadEvent()
    if err == io.EOF { break }
    switch ev.Kind() {
    case trace.EventStateTransition:
        st := ev.StateTransition()
        if st.Resource.Kind == trace.ResourceGoroutine {
            from, to := st.Goroutine()
            // ...
        }
    }
}
```

This is the right tool for building custom analyzers, exporters, and diff tools.

---

## 13. Detecting GC starvation of mutators

`runtime.gcBgMarkWorker` goroutines are supposed to run on idle CPU time, not steal it. The pacer adjusts how much mark work each P does proportionally to allocation rate.

If you see `gcAssistAlloc` slices on multiple goroutines simultaneously, allocations are outrunning GC and your code is being forced into mark work mid-allocation. Symptoms:

- Latency spikes correlated with high allocation bursts.
- `runtime/metrics` `/gc/cycles/total:gc-cycles` rate climbs.
- `GCCPUFraction` exceeds 25%.

Fixes:
- Set `GOMEMLIMIT` to give the pacer headroom.
- Reduce allocation rate (preallocate, pool, avoid `interface{}` in hot paths).
- If absolutely necessary, raise `GOGC` (more memory, less GC CPU).

---

## 14. Per-thread (M) view

The bottom lane of the flame view shows OS threads (Ms). For most code you can ignore this lane, but it's invaluable for:

- Diagnosing cgo: cgo calls block an M; if you see Ms continually being created (with `ThreadCreate` events), you have a cgo hotspot.
- Understanding thread count under `GOMAXPROCS` changes: each P needs an M to run.
- Spotting `runtime/debug.SetMaxThreads` violations.

`runtime.NumCgoCall()` returns the cumulative cgo call count; correlate with trace events for problem isolation.

---

## 15. Sysmon, the background watchdog

The runtime runs a goroutine called `runtime.sysmon` (without a P) that:

- Polls the netpoller every 10 ms when idle.
- Forces async preemption on goroutines running > 10 ms.
- Returns idle Ps' Ms to a thread cache.
- Forces a GC cycle if 2 minutes pass without one.

You won't see `sysmon` in goroutine analysis (it's a system goroutine), but its actions show up as `GoPreempt` events and forced GC cycles in traces of otherwise idle programs.

---

## 16. Summary

At the senior level, the trace is a system-state reconstruction tool. You read shapes (oversubscription, under-parallelism, GC pressure, contention) before slices, decode GC and syscall events to understand runtime behavior, and combine the trace with CPU pprof and `runtime/metrics` for a full picture. The viewer's MMU curve grounds latency SLOs in actual GC behavior; `golang.org/x/exp/trace` lets you build custom analyses when the UI runs out.

---

## Further reading
- Dmitry Vyukov, original tracer design doc: https://docs.google.com/document/d/1FP5apqzBgr7ahCCgFO-yoVhk4YZrNIDNf9RybngBc14
- Felix Geisendorfer, "Reading a Go trace": https://blog.felixge.de/reading-go-execution-traces/
- Async preemption (Go 1.14): https://go.googlesource.com/proposal/+/master/design/24543-non-cooperative-preemption.md
- `golang.org/x/exp/trace`: https://pkg.go.dev/golang.org/x/exp/trace

# go tool trace — Interview Q&A

A mix of conceptual and practical questions, labeled by level. Answers are concise; expand with examples in a real interview.

---

## Junior

**Q1. What is `go tool trace` and how is it different from pprof?**
`go tool trace` is the viewer for Go's execution tracer: it shows a precise, per-event timeline of goroutine scheduling, GC, syscalls, and network I/O. pprof aggregates *where* CPU time or allocations happen on average. trace shows *what happened and when*, ordered. Use trace for latency/ordering, pprof for hot spots.

**Q2. How do you collect a trace?**
Three common ways: (1) `go test -trace=trace.out` for tests, (2) `runtime/trace.Start(f)` and `defer trace.Stop()` in code, (3) `curl -o trace.out 'http://host/debug/pprof/trace?seconds=5'` for a live server with `net/http/pprof` imported.

**Q3. How do you view a trace?**
`go tool trace trace.out`. It starts a local HTTP server and prints a URL; open it in a browser.

**Q4. What are the main tabs in the viewer?**
"View trace" (the timeline), "Goroutine analysis", and several blocking profiles (network, synchronization, syscall), plus "Scheduler latency" and "User-defined tasks/regions" if you used the annotation API.

---

## Middle

**Q5. When would you reach for the tracer instead of pprof?**
Latency questions, scheduler/starvation questions, GC pause analysis, and "why was *this* request slow?" When CPU is low but the SLO is missed, time is spent *not running* — exactly what the tracer reveals.

**Q6. What do STW pauses look like in the timeline?**
Thin vertical bands across every PROC row where all user goroutines stop at once. Healthy Go STW is sub-millisecond; multi-millisecond bands point to slow preemption, huge root scans, or GC churn.

**Q7. How do you annotate your code so the tracer surfaces business logic?**
`runtime/trace.NewTask(ctx, "name")` for cross-goroutine logical units, `trace.WithRegion(ctx, "name", fn)` for named spans inside a goroutine, and `trace.Log(ctx, key, value)` for metadata. The "User-defined tasks" tab shows the resulting tree.

**Q8. Why keep trace capture windows short?**
The tracer emits an event per scheduling decision; a busy server can produce hundreds of MB per second. The browser UI (Catapult/Perfetto, JavaScript) chokes on huge files, and the overhead is non-trivial (~5-10%). 1-5 seconds is plenty for most diagnoses.

---

## Senior

**Q9. What is "scheduler latency" and how do you read it in a trace?**
The time a goroutine spent runnable but not yet scheduled onto a P. The "Scheduler latency profile" ranks goroutine creation sites by this delay. High values mean over-subscription, blocked preemption (cgo, tight loops), or a wrong `GOMAXPROCS` (e.g., container CPU quota smaller than `GOMAXPROCS`).

**Q10. How does the trace look when a single syscall blocks a P?**
A `PROC` row where the active goroutine sits in `Syscall` for an extended time, no sibling M picking up the orphaned work fast enough, and runnable goroutines accumulating in scheduler latency on that P. Common with cgo calls that the runtime cannot preempt.

**Q11. What is a lock convoy and how do you spot it?**
Many goroutines queued behind one mutex; the holder finishes, exactly one wakes, runs briefly, re-takes the lock, and the line never drains. In the trace: one acquire site dominates the Synchronization blocking profile; the timeline shows a staircase of one-at-a-time runs on the same lock; throughput is roughly `1/critical_section_time` regardless of concurrency.

**Q12. What is the flight recorder and why does it matter?**
A Go 1.23+ feature (`runtime/trace.FlightRecorder`) that keeps a rolling in-memory window of trace events continuously. You snapshot it on an SLO miss instead of capturing constantly to disk. It turns the tracer from "I wish it was on when the incident happened" into "always on, snapshot on alert."

---

## Professional

**Q13. What changed in trace format v2 (Go 1.21)?**
The global emission lock was removed; each P writes its own batches, organized into self-describing generations. Parsing became streamable, which unlocked larger traces, custom analysis tools (`golang.org/x/exp/trace`), and the flight recorder. v1 and v2 traces are not cross-compatible.

**Q14. How should `/debug/pprof/trace` be exposed in production?**
On an internal port only (`127.0.0.1:6060` or a private interface), never the public listener. Anyone who can hit that URL can stall your server with a long `seconds=` value, exhaust disk, or capture sensitive paths and `trace.Log` values. Put it behind auth or an admin sidecar.

**Q15. Sketch how you would gate a CI test on scheduler latency.**
Run the load test with `runtime/trace.Start`, write `trace.out`, then in a small post-step use `golang.org/x/exp/trace` to walk events: for every `StateTransition` from runnable → running, compute the delta; fail if the p99 exceeds the SLO. This makes a regression in scheduling behaviour fail the build, not just observability dashboards.

---

## Common traps

- Capturing for too long, then being unable to open the trace in the browser.
- Forgetting `trace.Stop()` and getting a truncated/unparsable file.
- Confusing low CPU with "the program is fast" when goroutines are actually blocked.
- Reading aggregate totals without checking distributions (1000×1µs vs 1×1ms).
- Running with `GOMAXPROCS=1` and concluding "no parallelism" from the trace — it is by configuration.
- Exposing `/debug/pprof/trace` publicly.
- Leaking `trace.Task`/`trace.Region` (forgetting `End()`/`defer task.End()`) and seeing infinite-duration entries in the UI.
- Using the tracer to find a CPU hot spot — that is pprof's job, not the tracer's.
- Capturing during init when scheduling is trivial and concluding "nothing happens."
- Treating trace files as non-sensitive when they may include stacks, HTTP paths, and `trace.Log` keys/values.

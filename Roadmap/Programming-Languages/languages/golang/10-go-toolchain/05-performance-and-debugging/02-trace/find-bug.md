# go tool trace — Find the Bug

Each scenario shows a setup or interpretation that looks fine but is wrong. Find the defect, explain it, and fix it.

---

## Bug 1 — Trace file won't open

```go
f, _ := os.Create("trace.out")
trace.Start(f)
doWork()
// program exits here
```

```bash
$ go tool trace trace.out
failed to parse trace: unexpected EOF
```

**Bug:** `trace.Stop()` was never called and the file was never closed before exit, so the in-memory buffer was not flushed.
**Fix:**

```go
trace.Start(f)
defer trace.Stop()
defer f.Close()
```

`Stop` flushes runtime buffers; `Close` flushes the file. Both matter.

---

## Bug 2 — Trace file too large to open

```bash
curl -o trace.out 'http://localhost:6060/debug/pprof/trace?seconds=120'
# trace.out is 1.8 GB
go tool trace trace.out
# browser tab hangs, eventually crashes
```

**Bug:** 120 seconds on a busy server produces gigabytes of events. The Catapult/Perfetto browser UI is single-threaded JS and chokes well before that.
**Fix:** capture short windows (≤5s). For longer observation, take several short snapshots, or use the flight recorder and snapshot on demand.

---

## Bug 3 — `GOMAXPROCS=1` makes the trace useless

```bash
GOMAXPROCS=1 go run .
# capture trace; only one PROC row, no parallelism, all goroutines serialize
```

The reader concludes "Go's scheduler is broken — there's no concurrency."

**Bug:** with one P, only one goroutine can run at a time, by design. The trace correctly reflects the configuration, not a bug.
**Fix:** unset `GOMAXPROCS` (or set it to the CPU count) and re-capture. In containers, set `GOMAXPROCS` to match the CPU quota (consider `automaxprocs`).

---

## Bug 4 — Long blocking syscall hides a channel wait

A goroutine appears to "block on syscall" for 200ms; the engineer rewrites the syscall path.

```go
trace.WithRegion(ctx, "fetch", func() {
    select {
    case msg := <-ch:
        _, _ = io.Copy(io.Discard, msg.body) // shows up as long syscall
    case <-time.After(5 * time.Second):
    }
})
```

**Bug:** the goroutine was actually waiting on the channel (`ch`) for ~199ms, then doing ~1ms of I/O. The long bar in "syscall" was misread; the real time was in `GoBlockRecv`.
**Fix:** before changing code, click the long span and read the *state* — the tracer labels block reasons. Look at "Synchronization blocking profile" / channel block events in addition to the syscall view.

---

## Bug 5 — `/debug/pprof/trace` exposed publicly

```go
import _ "net/http/pprof"

http.ListenAndServe(":8080", nil) // serves both the app and pprof
```

**Bug:** anyone on the internet can hit `/debug/pprof/trace?seconds=600`, which (a) stalls a goroutine writing trace data for 10 minutes, (b) leaks stacks/paths/user `trace.Log` values, (c) can fill the disk if redirected.
**Fix:** bind pprof to an internal address only:

```go
go func() { _ = http.ListenAndServe("127.0.0.1:6060", nil) }()
http.ListenAndServe(":8080", appMux) // separate mux for public traffic
```

Or put it behind auth in an admin sidecar.

---

## Bug 6 — Low CPU misread as "fast"

```
$ top
go-app   8%  CPU
```

The on-call concludes "service is fine." But p99 latency is 2 seconds.

**Bug:** low CPU means goroutines are spending most of their time **not running** — blocked on I/O, channels, locks, or the netpoller. CPU usage is silent about wait time.
**Fix:** capture a trace and inspect the blocking profiles. The tracer is the right tool when CPU and latency disagree; pprof CPU is not.

---

## Bug 7 — Tasks/regions leak in the UI

```go
ctx, task := trace.NewTask(r.Context(), "request")
// no defer task.End()
go background(ctx)
```

The "User-defined tasks" view shows entries with growing or unbounded duration; many tasks listed as still in progress.

**Bug:** `task.End()` was never called (the goroutine returned, but the task lived on via `ctx` passed to `background`). The tracer cannot close it.
**Fix:** always `defer task.End()` immediately after `NewTask`, and consider whether long-lived background work should be a separate task (with its own `NewTask`) rather than sharing the request's task.

---

## Bug 8 — Capturing during init, "nothing happens"

```go
func init() {
    f, _ := os.Create("trace.out")
    trace.Start(f)
}
```

Then the program does its real work after `main` starts, and the trace is stopped by `os.Exit` indirectly via deferred handlers... but the trace shows almost no scheduling events.

**Bug:** before `main` runs, the program is in `init` — single-threaded, almost no concurrency, no real workload. The captured window is meaningless.
**Fix:** start the trace **inside `main`**, immediately before the workload you want to observe; stop it immediately after.

---

## Bug 9 — `trace.Start` called twice

```go
trace.Start(f1)
trace.Start(f2) // returns an error, but it was ignored
```

The second trace appears empty.

**Bug:** the tracer is a singleton; a second `Start` while already started errors out (`trace: tracing already enabled`) and writes nothing to `f2`. The `Start` return value was ignored.
**Fix:** always check the error from `trace.Start`; in a long-lived process, gate captures behind a mutex/flag so only one is active at a time. The flight recorder is the right abstraction for "always have recent trace data."

---

## Bug 10 — Trace overhead measured on a tiny benchmark, dismissed

A microbenchmark with the tracer on shows <1% overhead. The team concludes "always-on tracing in production is free."

**Bug:** a small benchmark has few scheduling events per second; the per-event cost is invisible. Real services with thousands of goroutines and many syscalls per second see 5-10% throughput loss plus tail-latency bumps from buffer flushes.
**Fix:** measure overhead on the real workload (production load test) before enabling continuous traces. Use the flight recorder for always-on; reserve full continuous capture for ad-hoc investigations.

---

## How to approach these
1. Trace won't open? → forgot `Stop()`/`Close()`, or it's a v1/v2 mismatch.
2. Browser hangs? → window too long; capture seconds, not minutes.
3. Weird "no parallelism"? → check `GOMAXPROCS` and container CPU quota.
4. A long bar's *reason* is what matters — don't read by colour alone, click and inspect.
5. Don't put `/debug/pprof/trace` on a public listener.
6. Low CPU + high latency = use trace, not pprof.
7. Always `defer task.End()`; tasks leak silently.
8. Capture the *workload window*, not init.
9. Check `Start`'s error; the tracer is a singleton.
10. Measure overhead on real workloads before going always-on; use the flight recorder.

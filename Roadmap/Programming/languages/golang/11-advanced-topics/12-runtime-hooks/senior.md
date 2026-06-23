# Runtime Hooks — Senior

## 1. The mental model

The runtime is a service inside your binary. The hooks in `runtime`, `runtime/debug`, `runtime/metrics`, `runtime/pprof`, and `runtime/trace` are the API surface of that service. A senior engineer:

- Knows the precise semantics of each hook (what it does, what it does *not* do).
- Picks the right one for each diagnostic question.
- Composes them — signal handlers + traces + crash dumps — into a coherent operational posture.
- Knows which hooks are debugging tools and which are production tools, and never confuses them.

This page covers the hooks where the semantic detail actually matters.

---

## 2. `SetMemoryLimit`: what "soft" really means

`debug.SetMemoryLimit(n)` (Go 1.19+) sets a target the pacer respects. The runtime calculates a *runway* — the remaining bytes between current accounted memory and `n` — and adjusts both the GC trigger and the assist rate so a cycle finishes before the runway is exhausted.

When you approach `n`:

1. The pacer raises the mark assist debt that every allocator must pay.
2. The GC may start a new cycle immediately after the previous one ends.
3. If allocation still outpaces collection, the runtime exceeds `n` rather than OOMing.
4. CPU spent in GC can saturate the available cores — the **GC death spiral**.

Therefore `SetMemoryLimit` is not free protection. A workload that pushes the heap toward the limit continuously will burn CPU in mark assist. The honest signal that you need a higher limit (or less allocation) is `/cpu/classes/gc/total:cpu-seconds` rising while `/gc/heap/live:bytes` is flat.

Edge case: combining `GOGC=off` with `SetMemoryLimit(n)` disables ratio-based GC entirely; collection only triggers when you approach `n`. This is the pattern for spiky workloads with bursty allocation where you'd rather pay one big GC than constant small ones.

---

## 3. `AddCleanup` (Go 1.24+) vs `SetFinalizer`

```go
// Old, fragile:
runtime.SetFinalizer(obj, func(o *Obj) { close(o.fd) })

// New, safer (Go 1.24+):
cleanup := runtime.AddCleanup(obj, func(fd int) { syscall.Close(fd) }, obj.fd)
// later, if obj is closed normally:
cleanup.Stop()
```

Differences that matter:

| Property | `SetFinalizer` | `AddCleanup` |
|----------|---------------|--------------|
| Multiple per object | No (panics on second `SetFinalizer`) | Yes |
| Resurrects object | Yes (delays collection by one cycle) | No |
| Survives cycles | No (cycles never collect) | Yes |
| Argument scheme | Receives the object pointer | Receives a copy of a closed-over value |
| Cancellable | Set to `nil` | `Cleanup.Stop()` |

`AddCleanup` does **not** keep the object alive — so the cleanup function must receive its own copy of whatever it needs. The classic mistake of stashing the object pointer in the closure (and thereby creating a self-reference) is now impossible to write.

Migration heuristic: if your finalizer reads more than two fields, you probably want a `Close` method. If it must run via finalizer/cleanup, prefer `AddCleanup`. Never combine both on the same object.

---

## 4. `KeepAlive` at cgo boundaries

```go
buf := C.malloc(1024)
defer C.free(buf)

goBuf := []byte("hello world")
copy(unsafe.Slice((*byte)(buf), 1024), goBuf)
C.write_async(buf)         // returns immediately, C side keeps using buf
runtime.KeepAlive(goBuf)   // keep goBuf alive until here
```

The compiler may decide that `goBuf`'s last Go-side use is the `copy()` call, after which it is eligible for collection. If `write_async` is still reading `buf` (which aliased `goBuf`'s storage in some other variant of this pattern), you have a use-after-free.

`KeepAlive(x)` is documented as "the runtime considers `x` reachable through the program point at which `KeepAlive` is called". It does not produce any machine instructions other than a small barrier the optimizer cannot move across. Cost is effectively zero.

When you reach for `KeepAlive`:

- Passing a Go-managed allocation to C that may use it after the call returns.
- Holding a pointer obtained from `unsafe.Pointer(&x)` for longer than the obvious Go-side lifetime.
- Implementing a finalizer or cleanup that interacts with a value the GC otherwise considers dead.

---

## 5. `Goexit` vs `panic` vs `os.Exit`

| Mechanism | Runs deferreds? | Affects other goroutines? | Recoverable? |
|-----------|----------------|--------------------------|--------------|
| `panic(v)` | Yes (the unwinding goroutine) | No | Yes, via `recover()` |
| `runtime.Goexit()` | Yes | No (only the calling goroutine ends) | No — there is no value to recover |
| `os.Exit(code)` | **No** | Yes — process ends immediately | No |
| Returning from `main` | Yes (main only) | Yes — all goroutines killed | N/A |

Pitfall 1: `os.Exit` does **not** run `defer`s. Flush log buffers, close files, and commit metrics *before* calling it. Many production crash bugs are caused by exit-bypassed cleanup.

Pitfall 2: `runtime.Goexit()` from the main goroutine when other goroutines exist triggers Go's "all goroutines are asleep — deadlock" detector if those goroutines later block. Usually wrong outside test machinery.

Pitfall 3: `panic` inside a deferred function from another `panic` causes the inner panic to *replace* the outer one. Surfaces as a confusing stack where the originating cause is gone.

---

## 6. `LockOSThread`: when and why

```go
func startGUIThread() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    initGTK()
    gtkMainLoop() // never returns
}
```

`LockOSThread` binds the calling goroutine to its current OS thread. The thread cannot run other goroutines until the lock is released; in extreme cases it dies with the goroutine.

Use it when:

- A C library uses **thread-local storage** (GUI toolkits, OpenGL, some OpenMP shapes).
- A C library expects a fixed thread to receive signals.
- Your code calls `setuid`, `setgid`, or similar per-thread Linux syscalls (`unshare`, `setns`) and must guarantee a stable thread identity.

Avoid it when:

- You just want to "prevent other goroutines from running" — that is what mutexes are for.
- You think it speeds things up — it almost never does and often hurts the scheduler.

Operational caveat: `LockOSThread`/`UnlockOSThread` calls **nest**. The thread is released only when the count returns to zero. If you `LockOSThread` twice and `UnlockOSThread` once, the thread stays bound.

---

## 7. `runtime.GC()`: only three legitimate uses

```go
runtime.GC() // do you really need this?
```

The three:

1. **Tests and benchmarks** measuring memory invariants — `runtime.GC(); runtime.ReadMemStats(&m)`.
2. **Just before `WriteHeapProfile`** — to get a clean live-heap snapshot.
3. **One-shot batch programs** that have finished a stage and want to release memory before idling (often paired with `FreeOSMemory`).

In a long-running service, calling `runtime.GC()` periodically is almost always wrong:

- It blocks user goroutines during the STW phases.
- It defeats the pacer, which has more information than you do.
- It does nothing to fix a leak.

If your team has a `runtime.GC()` call in production code, the question is "what behavior were you trying to get?" — and the answer is almost always one of `SetGCPercent`, `SetMemoryLimit`, or fixing an actual leak.

---

## 8. `SetCrashOutput` (Go 1.23+): forwarding panics

Before Go 1.23, when a goroutine panicked unrecovered, the traceback went to stderr and was gone. `debug.SetCrashOutput` adds a second destination — a file you control — so you can pipe panics to a structured log, an S3 uploader, or a process supervisor.

```go
import "runtime/debug"

f, err := os.Create("/var/log/myapp-crash.log")
if err != nil { log.Fatal(err) }
if err := debug.SetCrashOutput(f, debug.CrashOptions{}); err != nil {
    log.Fatal(err)
}
```

The file is duplicated; closing your local handle doesn't disable the hook. The runtime writes the same traceback it would write to stderr, byte-for-byte.

Composed pattern: spawn a small subprocess (or a Unix socket consumer) that drains the crash output and uploads it. On a crash you get the traceback in your central logging system even when the host dies.

---

## 9. `runtime/trace`: programmatic capture

The execution tracer records every scheduling event, channel send/receive, GC phase, system call entry/exit, and user-defined region for the duration of the capture.

```go
import (
    "context"
    "os"
    "runtime/trace"
)

func captureTrace(ctx context.Context, d time.Duration) error {
    f, err := os.Create("trace.out")
    if err != nil { return err }
    defer f.Close()
    if err := trace.Start(f); err != nil { return err }
    defer trace.Stop()

    ctx, task := trace.NewTask(ctx, "captureTrace")
    defer task.End()
    trace.WithRegion(ctx, "wait", func() {
        time.Sleep(d)
    })
    return nil
}
```

Operational guidance:

- **Volume.** Traces grow at 5–20 MB per second of wall time. Capture small windows.
- **Overhead.** ~5–10% CPU while active. Acceptable for a 10-second sample under production load.
- **Reading.** `go tool trace trace.out` opens a browser UI with timelines per P and per goroutine, plus latency histograms per region/task.

User regions (`WithRegion`) and tasks (`NewTask`) are how you mark "the part you care about" inside a trace covering thousands of events.

---

## 10. `runtime/pprof` labels: knowing which code path used the CPU

```go
import (
    "context"
    "runtime/pprof"
)

func handle(ctx context.Context, req *Request) {
    pprof.Do(ctx, pprof.Labels(
        "route", req.Route,
        "method", req.Method,
    ), func(ctx context.Context) {
        process(ctx, req)
    })
}
```

Every CPU profile sample taken inside `Do` is tagged with the labels. In `go tool pprof`, `tags` and `tagfocus=route=/login` lets you see exactly which handler was hot. Labels propagate to all goroutines started from inside the `Do` block.

This is the difference between "JSON parsing is using 30% CPU" and "JSON parsing is using 30% CPU, all from the `/sync` endpoint". The latter is actionable.

---

## 11. Composing signal handling with the runtime

```go
import (
    "context"
    "os"
    "os/signal"
    "syscall"
    "time"
)

func runServer(srv *http.Server) error {
    ctx, stop := signal.NotifyContext(
        context.Background(),
        syscall.SIGINT, syscall.SIGTERM,
    )
    defer stop()

    errc := make(chan error, 1)
    go func() { errc <- srv.ListenAndServe() }()

    select {
    case err := <-errc:
        return err
    case <-ctx.Done():
        shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
        defer cancel()
        return srv.Shutdown(shutdownCtx)
    }
}
```

Things to remember:

- The runtime owns SIGURG (async preemption), SIGPROF (CPU profiler), and the fault signals. You should not register handlers for those.
- `signal.NotifyContext` returns a context that cancels on the first matching signal. Subsequent signals reset to the default disposition — a second SIGINT will kill the process if you ignore the first.
- For SIGQUIT (`Ctrl-\`), the runtime's default is "dump all goroutine stacks and exit". Don't override it unless you have a replacement that does the same.

---

## 12. Reading the modern metrics into something useful

```go
import "runtime/metrics"

type Snapshot struct {
    HeapLive       uint64
    HeapReleased   uint64
    Goroutines     uint64
    GCPauseP99     float64 // seconds
    AssistTime     float64
}

func sample() Snapshot {
    samples := []metrics.Sample{
        {Name: "/gc/heap/live:bytes"},
        {Name: "/memory/classes/heap/released:bytes"},
        {Name: "/sched/goroutines:goroutines"},
        {Name: "/gc/pauses:seconds"},
        {Name: "/cpu/classes/gc/mark/assist:cpu-seconds"},
    }
    metrics.Read(samples)
    h := samples[3].Value.Float64Histogram()
    return Snapshot{
        HeapLive:     samples[0].Value.Uint64(),
        HeapReleased: samples[1].Value.Uint64(),
        Goroutines:   samples[2].Value.Uint64(),
        GCPauseP99:   percentile(h, 0.99),
        AssistTime:   samples[4].Value.Float64(),
    }
}
```

The histogram fields (`Buckets` boundaries, `Counts` per bucket, cumulative) are the canonical way to expose p50/p95/p99 pauses to your dashboard. Don't compute averages — pauses are heavy-tailed.

---

## 13. `WriteHeapDump` and the hard case

```go
import "runtime/debug"

f, _ := os.Create("/tmp/heap.dump")
defer f.Close()
debug.WriteHeapDump(f.Fd())
```

This writes the full heap (every live object, with type info and the references between them) to the supplied fd in a documented binary format. It is heavyweight (the format is essentially "the GC's view of the world") and the tooling around it is sparse — historically `viewcore` and `gocore`, both research-grade.

Reserve it for the cases where pprof's sampled heap profile is not enough: forensic analysis of a one-off heap corruption, comparing exact object graphs between two snapshots, or feeding into custom tooling.

---

## 14. `SetPanicOnFault`: making segfaults recoverable

```go
defer debug.SetPanicOnFault(true)()
// after this line, dereferencing a bad pointer panics instead of SIGSEGVing.
```

Useful when you operate on memory you don't fully control — `syscall.Mmap` regions, cgo-managed pointers, embedded scripting engines. Without this, a fault inside Go code kills the process with no `recover` opportunity.

It is per-goroutine. The caller's deferred call (`defer debug.SetPanicOnFault(true)()`) restores the previous state. Don't enable it globally — it masks real bugs in code you wrote yourself.

---

## 15. Summary

At senior level, the runtime hook landscape becomes a precise toolkit: `SetMemoryLimit` for budgeting, `AddCleanup` for safe finalization, `KeepAlive` at cgo seams, `Goexit`/`os.Exit`/`panic` chosen for the right shutdown semantics, `LockOSThread` only for genuine threading constraints, `SetCrashOutput` so panics leave a forensic trail, `runtime/trace` for fine-grained scheduling diagnosis, `pprof.Do` labels for attributing CPU. The mistake to avoid is treating these as magic switches; each has a contract and a cost, and your job is to know both before reaching for them.

---

## Further reading
- `AddCleanup` design: https://github.com/golang/proposal/blob/master/design/67535-cleanups.md
- `SetCrashOutput` design: https://github.com/golang/proposal/blob/master/design/57175-crash-output.md
- `runtime/trace` user guide: https://pkg.go.dev/runtime/trace
- pprof labels: https://rakyll.org/profiler-labels/
- `SetMemoryLimit` deep dive: https://go.dev/doc/gc-guide#Memory_limit

# Runtime Hooks — Find the Bug

A collection of realistic runtime-hook bug scenarios. For each: the symptom, the (subtle) cause, and the fix. Reading them in order builds the diagnostic instinct you need when a service does something the runtime "shouldn't" do.

---

## Bug 1: `runtime.GC()` in a hot path

```go
func handle(req *Request) Response {
    resp := process(req)
    runtime.GC() // "to keep memory low"
    return resp
}
```

**Symptom.** p99 latency is 50× higher than p50. CPU profile shows `runtime.gcStart`, `runtime.gcMarkDone`, and `runtime.gcSweep` dominating.

**Cause.** Every request now blocks during the GC's STW phases. The pacer is bypassed; the runtime collects after every request instead of when actually needed. Even at sub-millisecond pauses, doing it thousands of times per second is fatal.

**Fix.** Remove the `runtime.GC()` call. If memory really is the concern, set `GOMEMLIMIT` and let the pacer do its job. `runtime.GC()` in production code is almost always wrong.

---

## Bug 2: `SetFinalizer` cycle that never collects

```go
type Connection struct {
    peer *Connection
    fd   int
}

func newPair() (*Connection, *Connection) {
    a, b := &Connection{}, &Connection{}
    a.peer, b.peer = b, a
    runtime.SetFinalizer(a, func(c *Connection) { syscall.Close(c.fd) })
    runtime.SetFinalizer(b, func(c *Connection) { syscall.Close(c.fd) })
    return a, b
}
```

**Symptom.** `HeapAlloc` grows without bound; the heap profile shows `Connection` instances accumulating forever.

**Cause.** Cycles among finalizer-bearing objects are **never collected** by the GC. Running either finalizer would require running the other, and the runtime refuses to choose an order.

**Fix.** Break the cycle (e.g., store an integer ID instead of a pointer) or migrate to `runtime.AddCleanup` (Go 1.24+), which does not have the cycle restriction. Best of all, expose `Close()` and rely on `defer`.

---

## Bug 3: `LockOSThread` without `UnlockOSThread`

```go
func runCGO(ctx context.Context) {
    runtime.LockOSThread()
    // ... call into C library ...
    if err := ctx.Err(); err != nil {
        return // forgot UnlockOSThread
    }
    runtime.UnlockOSThread()
}
```

**Symptom.** After running for a while, the service uses far more OS threads than `GOMAXPROCS` would suggest. `top` shows ~1000 threads for a server with `GOMAXPROCS=8`.

**Cause.** When a goroutine with a `LockOSThread` count > 0 exits, the runtime kills the underlying thread (rather than risk recycling a thread with corrupted TLS). So every error path that skips `UnlockOSThread` permanently sheds a thread.

**Fix.** Always pair them with `defer`:

```go
runtime.LockOSThread()
defer runtime.UnlockOSThread()
```

…and never lock without a deferred unlock right after.

---

## Bug 4: Missing `runtime.KeepAlive` at the cgo boundary

```go
//go:cgo_import_static write_async
func sendAsync(b []byte) {
    p := unsafe.Pointer(&b[0])
    C.write_async(p, C.size_t(len(b)))
    // forgot KeepAlive
}
```

**Symptom.** Intermittent corruption in the data the C side eventually reads. Reproducible only under GC load.

**Cause.** After the `C.write_async` call evaluates its arguments, `b` has no further Go-side use, so the GC is free to collect it. If `write_async` is asynchronous (returns before the C side reads `p`), the GC may collect `b`'s backing array while C is still reading. The result is whatever data the runtime put there next — corruption or a crash.

**Fix.**

```go
func sendAsync(b []byte) {
    p := unsafe.Pointer(&b[0])
    C.write_async(p, C.size_t(len(b)))
    runtime.KeepAlive(b)
}
```

`KeepAlive` extends the lifetime of `b` to the program point at which it is called. Always required when passing Go-managed memory to an asynchronous C function.

---

## Bug 5: Signal handler racing with `os.Exit`

```go
func main() {
    sig := make(chan os.Signal, 1)
    signal.Notify(sig, syscall.SIGTERM)
    go func() {
        <-sig
        flushLogs()
        os.Exit(0)
    }()
    runServer()
}

func runServer() {
    defer flushMetrics()
    // ... long-running loop ...
}
```

**Symptom.** On SIGTERM, logs are sometimes flushed but metrics are missing. Other times, both are missing. Behavior depends on timing.

**Cause.** `os.Exit` does **not** run pending `defer`s. The `flushMetrics` deferred call in `runServer` never executes when the signal goroutine wins the race. And there is no synchronization between the signal handler and the main goroutine — they're racing for who exits first.

**Fix.** Use `signal.NotifyContext` and a structured shutdown:

```go
func main() {
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM)
    defer stop()
    if err := runServer(ctx); err != nil {
        log.Print(err)
    }
    flushLogs()
    flushMetrics()
}
```

Now both flushes happen before exit, and `runServer`'s `defer`s run because we return rather than `os.Exit`.

---

## Bug 6: `MemStats.PauseTotalNs` as a STW pause indicator

```go
var prev uint64
for {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    delta := m.PauseTotalNs - prev
    prev = m.PauseTotalNs
    if delta > 100*time.Millisecond {
        alert("long GC pause")
    }
    time.Sleep(time.Second)
}
```

**Symptom.** `ReadMemStats` itself is showing up in the CPU profile. The "pause monitor" causes more pause than it observes.

**Cause.** `runtime.ReadMemStats` stops the world to take a consistent snapshot. Calling it once per second on every pod adds up. And `PauseTotalNs` is a cumulative counter; reading deltas tells you total pause time, not per-cycle pause distribution.

**Fix.** Use `runtime/metrics`:

```go
samples := []metrics.Sample{{Name: "/gc/pauses:seconds"}}
metrics.Read(samples)
h := samples[0].Value.Float64Histogram()
// h.Buckets and h.Counts give the full pause distribution
```

No STW, and you get a histogram instead of just the sum.

---

## Bug 7: `FreeOSMemory` called in a tight loop

```go
for batch := range work {
    process(batch)
    debug.FreeOSMemory() // "to keep memory tight"
}
```

**Symptom.** Throughput is half of what it was last week. CPU profile shows `runtime.gcDrain`, `runtime.scavengeOne`, and lots of page-table churn.

**Cause.** `FreeOSMemory` forces a full GC *and* page-return advice on every call. The page-table updates are not free; the OS has to invalidate TLB entries, and Go has to re-fault them in on the next allocation.

**Fix.** Remove the call. If memory really must be tight, set `GOMEMLIMIT` and let the pacer respond. `FreeOSMemory` is a one-shot hammer for the end of a large stage — not a per-iteration tool.

---

## Bug 8: `GODEBUG=gctrace=1` left on in production

```dockerfile
ENV GODEBUG=gctrace=1
```

**Symptom.** Log volume is 100× what it should be. The log aggregator drops messages; useful logs are buried in GC traces.

**Cause.** `gctrace=1` emits one line to stderr per GC cycle. A service with 100 GCs/second produces 100 lines/second of GC trace — and your log shipper, log indexer, and dashboards all pay for them.

**Fix.** Remove from the image's `ENV`. Use `runtime/metrics` (`/gc/pauses:seconds`) for ongoing observation; turn `gctrace=1` on only when actively investigating, and turn it off again.

---

## Bug 9: `runtime.NumGoroutine` ratchet up but no leak

```go
for {
    n := runtime.NumGoroutine()
    if n > limit {
        alert("goroutine leak")
    }
    time.Sleep(10 * time.Second)
}
```

**Symptom.** Alert fires after a load test. But the goroutine count plateaus and never drops, even with no traffic. Investigation: no real leak — the count just doesn't shrink.

**Cause.** `runtime.NumGoroutine` includes:

- Runtime workers (a small fixed pool).
- HTTP server idle keep-alive readers (one per connection).
- Database driver pool workers.
- `sync.Pool` cleanup goroutines.

After a burst, the connection pool keeps idle conns warm; their reader goroutines stay alive. That's not a leak — it's a cache.

**Fix.** Alert on the *derivative*, not the absolute number. A monotonic increase over hours is a leak signal; a step up that plateaus is normal pool warmup. Use `rate()` in PromQL.

---

## Bug 10: `SetPanicOnFault` enabled globally, masking real bugs

```go
func init() {
    debug.SetPanicOnFault(true)
}
```

**Symptom.** A nil pointer dereference in business logic is silently converted to a recoverable panic and swallowed by a top-level recover. The bug ships to production, where it corrupts data.

**Cause.** `SetPanicOnFault` is per-goroutine and is intended for code that operates on memory it didn't allocate — `mmap`'d regions, cgo pointers, etc. Enabling it globally and leaving it on turns every nil-deref into a soft failure, which is exactly the opposite of what you want for "normal" code.

**Fix.** Apply locally, around the unsafe region only:

```go
func readMmap(p uintptr) (b []byte) {
    defer debug.SetPanicOnFault(true)() // restore on return
    // ... read from p ...
}
```

And let nil derefs in your own code crash loudly.

---

## Bug 11: `SetCrashOutput` file opened with the wrong flags

```go
f, err := os.Create("/var/log/crash.log")
if err != nil { /* ... */ }
debug.SetCrashOutput(f, debug.CrashOptions{})
// no f.Close() — and runtime keeps writing to f's fd
```

**Symptom.** After a crash, only a partial traceback is in the log file. The rest is missing.

**Cause.** `os.Create` opens with `O_TRUNC`, which is fine, but if the process is killed mid-write, buffered output may not have been flushed. The runtime writes directly to the fd, but anything you wrote via `log` to the same file uses the OS buffer.

**Fix.** Open with `O_APPEND` and let the runtime own the fd:

```go
f, err := os.OpenFile("/var/log/crash.log",
    os.O_RDWR|os.O_CREATE|os.O_APPEND, 0o600)
if err != nil { /* ... */ }
if err := debug.SetCrashOutput(f, debug.CrashOptions{}); err != nil {
    f.Close()
    /* ... */
}
// f.Close() at program end; the runtime dupes the fd internally.
```

Don't `log.SetOutput(f)` to the same file — separate the operational log from the crash log.

---

## Bug 12: `time.AfterFunc` callbacks holding the runtime hostage

```go
for _, req := range pendingRequests {
    time.AfterFunc(30*time.Second, func() {
        cleanup(req)
    })
}
```

**Symptom.** When the timer pool reaches ~1M pending timers, scheduler latency p99 jumps to seconds. `runtime/metrics` `/sched/latencies:seconds` is heavy-tailed.

**Cause.** Each `time.AfterFunc` allocates a timer in the runtime's global timer heap. The heap is sharded across P's but every insertion and deletion still costs `O(log n)`. With a million timers, that's 20+ comparisons per operation, and the runtime's bookkeeping starts to compete with user work.

**Fix.** Aggregate. A single goroutine driving a `time.Ticker(1*time.Second)` and scanning a slice of pending requests does the same job at `O(1)` per request. Don't create a timer per request unless the request count is bounded.

---

## Bug 13: `GOMAXPROCS` not honored in a CPU-limited container

```yaml
resources:
  limits:
    cpu: 2
# no GOMAXPROCS in env
```

**Symptom.** Go binary on Go 1.24 runs with `GOMAXPROCS=16` even though the cgroup limits CPU to 2 cores. `top` shows the process sitting at 200% CPU but feeling slow. Scheduler latency is high; GC is mark-assist-bound.

**Cause.** Pre-1.25, `runtime.GOMAXPROCS` uses `NumCPU()`, which returns the host's CPU count, not the cgroup quota. The runtime schedules 16 P's but only 2 cores' worth of CPU time is available. P's queue up; the scheduler thrashes.

**Fix.** Set `GOMAXPROCS=2` explicitly, or import `_ "go.uber.org/automaxprocs"`. From Go 1.25, the runtime honors the cgroup quota automatically. Verify with `runtime.GOMAXPROCS(0)` logged at startup.

---

## Bug 14: pprof endpoint exposed on the public listener

```go
import _ "net/http/pprof"
import "net/http"

func main() {
    http.HandleFunc("/", handle)
    http.ListenAndServe(":80", nil)
}
```

**Symptom.** A few weeks after deploy, an external researcher reports your service exposes `/debug/pprof/heap` to the internet. Their proof is a leaked symbol table containing internal function names.

**Cause.** Side-effect importing `net/http/pprof` registers its handlers on `http.DefaultServeMux`. Calling `http.ListenAndServe(":80", nil)` serves the default mux on port 80. The pprof endpoints are now public.

**Fix.** Always use a dedicated mux for your public listener; serve pprof on a separate, localhost-bound listener:

```go
mux := http.NewServeMux()
mux.HandleFunc("/", handle)
go http.ListenAndServe(":80", mux) // public

adminMux := http.NewServeMux()
adminMux.HandleFunc("/debug/pprof/", pprof.Index)
go http.ListenAndServe("127.0.0.1:6060", adminMux) // localhost
```

---

## Bug 15: Summary

Runtime hooks fail in characteristic ways: blocking primitives called in tight loops (`GC`, `FreeOSMemory`), missing pairings (`UnlockOSThread`, `KeepAlive`), exits that bypass cleanup (`os.Exit`), per-goroutine flags applied globally (`SetPanicOnFault`), environment toggles left on (`gctrace`), and mux confusion (pprof on public listener). Recognizing the pattern is half the diagnosis; the fix is usually to use the right hook for the actual question.

---

## Further reading
- Production runtime-hook gotchas: https://go.dev/doc/diagnostics
- Common Go mistakes (runtime section): https://100go.co
- GC pacer behavior: https://go.dev/doc/gc-guide
- `time` package gotchas: https://pkg.go.dev/time#pkg-overview

# `runtime` Package Deep — Optimization

## 1. How to use this file

Fourteen scenarios where misuse of the `runtime`, `runtime/debug`, `runtime/pprof`, `runtime/trace`, and `runtime/metrics` packages adds latency, contention, STW pauses, or wasted CPU. Each entry has a **Before** (code + benchmark/measurement) and a collapsible **After** (optimized code + benchmark + why + trade-offs + when NOT).

Anchored at Go 1.23, amd64, GOMAXPROCS=8. Numbers are reproducible-shape — run `go test -bench=. -benchmem` on your hardware before quoting them. The `runtime` package exists for *introspection and control*, not for steady-state hot paths. The five common failure modes are: (1) calling STW-class functions per request, (2) running profilers at unnecessarily high rates in production, (3) using `SetFinalizer` as a cleanup mechanism, (4) recomputing global tunables that should be set once at startup, and (5) leaving heavyweight tracing always-on. Most wins remove one of those five from the steady state. Reading order: Ex. 1, 2, 6, then any order. Ex. 4, 9, 12 are the ones most senior reviews flag.

---

## 2. Exercise 1 — `runtime.ReadMemStats` called on every request

**Difficulty:** medium

A `/metrics` endpoint exposes heap size, GC count, and pause stats. The handler calls `runtime.ReadMemStats` on every scrape — and the team also added a per-request middleware that exports the same fields. `ReadMemStats` takes a worldwide stop-the-world pause that scales with the number of P's and the heap. At 8 cores and a 4 GB heap, that pause is ~300 µs per call, multiplied by every in-flight request.

```go
func metricsMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        var m runtime.MemStats
        runtime.ReadMemStats(&m) // STW pause every request
        r = r.WithContext(context.WithValue(r.Context(), "heap", m.HeapAlloc))
        next.ServeHTTP(w, r)
    })
}
```

```
BenchmarkReadMemStatsPerReq-8   3500   340000 ns/op   0 B/op   0 allocs/op
// p99 latency under load:  12 ms  (pause-amplified)
```

<details><summary>Hint</summary>

`runtime/metrics` (Go 1.16+) reads counters that the runtime already maintains — no STW, no full walk of the heap. Read once per scrape interval, not per request.

</details>

<details><summary>Solution</summary>

Switch to `runtime/metrics` for the values that have direct equivalents, and read at most once per scrape interval (e.g. 10 s) from a single background goroutine. Hand request handlers a cached snapshot.

```go
import "runtime/metrics"

var (
    samples = []metrics.Sample{
        {Name: "/memory/classes/heap/objects:bytes"},
        {Name: "/gc/cycles/total:gc-cycles"},
    }
    cached atomic.Pointer[snapshot]
)

type snapshot struct{ HeapBytes uint64; GCCycles uint64 }

func init() {
    go func() {
        t := time.NewTicker(10 * time.Second)
        for range t.C {
            metrics.Read(samples)
            cached.Store(&snapshot{
                HeapBytes: samples[0].Value.Uint64(),
                GCCycles:  samples[1].Value.Uint64(),
            })
        }
    }()
}

func metricsMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if s := cached.Load(); s != nil {
            r = r.WithContext(context.WithValue(r.Context(), "heap", s.HeapBytes))
        }
        next.ServeHTTP(w, r)
    })
}
```

```
BenchmarkMetricsCached-8   50000000   24 ns/op   0 B/op   0 allocs/op
// p99 latency under load:  1.2 ms  (no pause)
```

~14000× faster per request and the STW spike disappears from the latency histogram.

**Why faster:** `runtime/metrics` exposes the runtime's existing counters via a stable API. Most metrics are atomic reads, not stop-the-world walks. The handler now does a single pointer load. `ReadMemStats` had to pause all P's, walk per-P stats, and aggregate — that work is unavoidable for the full struct.

**Trade-off:** Some `MemStats` fields (e.g. `Frees`, `BySize`) don't have `runtime/metrics` equivalents — keep `ReadMemStats` for the rare admin dump. Cached snapshot is up to 10 s stale; that's fine for capacity dashboards, not for live debugging.

**When NOT:** One-shot tools (e.g. `pprof` exporters) where the cost is paid once. Tests asserting on exact `MemStats` values. Diagnosis sessions where freshness beats latency.

</details>

---

## 3. Exercise 2 — `runtime.GC()` called manually before every benchmark

**Difficulty:** easy

A benchmark suite calls `runtime.GC()` at the start of every iteration "to get clean numbers". Each forced GC stops the world, sweeps the entire heap, and resets the GC clock. The benchmark now measures *GC behavior*, not the code under test, and total suite runtime triples.

```go
func BenchmarkParse(b *testing.B) {
    for i := 0; i < b.N; i++ {
        runtime.GC()                  // forces full GC each iter
        _ = parse(input)
    }
}
```

```
BenchmarkParse-8   400   2900000 ns/op   ...
// Wall time per iter dominated by GC, not parse
```

<additional context: the actual parse cost is ~80 µs; the GC is adding ~2.8 ms>

<details><summary>Hint</summary>

`testing.B` already isolates allocation accounting. Forcing GC inside the loop measures the GC, not your code. Let the GC run; use `b.ReportAllocs()` and `-benchmem` for allocation insight.

</details>

<details><summary>Solution</summary>

Remove the manual GC. If you genuinely need a clean heap before a *single* sub-benchmark, do it in `b.ResetTimer()` territory — outside the measured region.

```go
func BenchmarkParse(b *testing.B) {
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = parse(input)
    }
}
```

```
BenchmarkParse-8   15000   78000 ns/op   12000 B/op   42 allocs/op
```

~37× faster, and the numbers now reflect `parse` instead of `runtime.GC`.

**Why faster:** A forced GC marks every reachable object, sweeps every span, and resets pacer state. At a 200 MB working set that's milliseconds, dwarfing the unit being benchmarked. The Go GC is already self-tuned via GOGC/GOMEMLIMIT — interfering with the pacer produces *worse* numbers on every dimension (throughput, tail latency, allocator pressure).

**Trade-off:** Iteration-to-iteration variance goes up slightly because GCs land at unpredictable points; `benchstat` over multiple runs absorbs this. If a single benchmark needs a guaranteed empty heap (e.g. measuring first-allocation cost), call `runtime.GC()` *once*, before `b.ResetTimer()`, not inside the loop.

**When NOT:** Microbenchmarks of GC itself — there you *do* want to control GC state. Tests reproducing a heap-state-dependent bug where determinism matters more than realism.

</details>

---

## 4. Exercise 3 — `runtime.SetFinalizer` for resource cleanup

**Difficulty:** hard

A file-wrapper sets a finalizer to close the underlying `*os.File` "in case the caller forgets". Finalizers run on a single goroutine, after at least one GC cycle, with no ordering guarantees relative to program shutdown. Worse, the finalizer keeps the object reachable for an extra GC cycle, doubling its retention time.

```go
type File struct { f *os.File }

func Open(name string) (*File, error) {
    raw, err := os.Open(name)
    if err != nil { return nil, err }
    h := &File{f: raw}
    runtime.SetFinalizer(h, func(h *File) { h.f.Close() }) // fragile
    return h, nil
}
```

```
BenchmarkFinalizerOpenClose-8   80000   18500 ns/op   240 B/op   3 allocs/op
// FDs in use after 1e6 opens: ~12000  (finalizer-queue backlog)
```

<details><summary>Hint</summary>

`defer file.Close()` is deterministic, runs in the right goroutine, in the right order, and costs ~50 ns. Finalizers run on the finalizer goroutine, are batched, and can be skipped entirely on process exit.

</details>

<details><summary>Solution</summary>

Make `Close` part of the contract. Drop the finalizer. If you want a safety net, log a warning from a `runtime.SetFinalizer` that *only* reports a leak, but still rely on `Close` for the actual release.

```go
type File struct { f *os.File }

func Open(name string) (*File, error) {
    raw, err := os.Open(name)
    if err != nil { return nil, err }
    return &File{f: raw}, nil
}

func (h *File) Close() error { return h.f.Close() }

// caller side:
f, err := Open(name); if err != nil { return err }
defer f.Close()
```

```
BenchmarkDeferClose-8   200000   7200 ns/op   80 B/op   1 allocs/op
// FDs in use after 1e6 opens: ~0
```

~2.5× faster per operation, and file descriptors are released immediately.

**Why faster:** No finalizer table insertion, no extra GC-cycle retention, no contention on the finalizer goroutine. `defer` adds a fixed ~50 ns and runs synchronously. Finalizers also force the object onto the heap (escape analysis fails) and prevent inlining of allocation sites.

**Trade-off:** Callers can forget `Close` — but that's true of any explicit lifecycle. The right mitigation is `go vet -lostcancel`-style static analysis (`bodyclose`, `sqlclosecheck`) and unit tests, not a finalizer. Finalizers don't run if the process exits before the next GC, so they were never a real safety net.

**When NOT:** Wrapping CGo handles where the C side has its own lifecycle and Go can't `defer` (rare; even then, prefer an explicit `Close`). True debug-only leak detection where you log "this should have been closed" — but only as a warning, not as the cleanup itself.

</details>

---

## 5. Exercise 4 — `runtime/pprof.StartCPUProfile` rate cranked up

**Difficulty:** medium

To "get more samples", a service calls `runtime.SetCPUProfileRate(10000)` (10 kHz) before starting a continuous CPU profile in production. The default is 100 Hz. At 10 kHz, every P is signaled 10000 times per second, the signal handler walks the stack each time, and CPU overhead jumps from ~1% to ~15%.

```go
func startProfile() {
    f, _ := os.Create("/var/log/cpu.pprof")
    runtime.SetCPUProfileRate(10000)   // 100× default
    pprof.StartCPUProfile(f)
}
```

```
// Production measurements:
// CPU overhead from profiler:  ~15%
// p99 latency increase:        +3.2 ms
// Profile file growth:         ~40 MB/min
```

<details><summary>Hint</summary>

100 Hz is the default for a reason — it gives statistically valid profiles with <1% overhead. More samples don't reveal more truth once you're past the law-of-large-numbers threshold; they just slow you down.

</details>

<details><summary>Solution</summary>

Use the default 100 Hz. Profile for *longer* if you need more samples, not faster.

```go
func startProfile() {
    f, _ := os.Create("/var/log/cpu.pprof")
    // SetCPUProfileRate omitted — defaults to 100 Hz
    pprof.StartCPUProfile(f)
}

// Stop after a 30s window, rotate, restart. Or use net/http/pprof on-demand.
```

```
// Production measurements:
// CPU overhead from profiler:  ~0.6%
// p99 latency increase:        +0.05 ms
// Profile file growth:         ~0.4 MB/min
```

~25× lower overhead.

**Why faster:** SIGPROF delivery, signal handler entry, and `runtime.sigprof` stack walk happen 100× less often. The stack walk allocates nothing but it does touch every frame's PC — at deep call stacks (web frameworks: 30+ frames) that adds up.

**Trade-off:** 100 Hz samples may miss functions that run <10 ms total. Solution: profile for longer (5 min instead of 30 s), or use block/mutex profiles for short-lived hot paths. Don't crank the rate.

**When NOT:** Microbenchmarks where a function runs for milliseconds total and you need fine-grained sample density. Even then, prefer `go test -cpuprofile` over `SetCPUProfileRate`. Investigating signal-delivery itself.

</details>

---

## 6. Exercise 5 — `runtime.SetBlockProfileRate(1)` left on in production

**Difficulty:** medium

A service sets `runtime.SetBlockProfileRate(1)` (sample *every* blocking event, nanosecond resolution) at startup "for observability". Every channel send/recv that blocks, every mutex contention, every `select` wait is recorded with a stack. On a chatty service that's millions of records per second; the profile heap inflates and per-op overhead climbs.

```go
func main() {
    runtime.SetBlockProfileRate(1) // every event, forever
    // ...
}
```

```
BenchmarkChanSendBlocked-8   2000000   620 ns/op   48 B/op   1 allocs/op
// Block profile size after 1h:  ~800 MB
```

<details><summary>Hint</summary>

`SetBlockProfileRate(rate)` takes a *sample rate in nanoseconds*. Setting it to 1 records every event; setting it to 10000 (10 µs) records ~1 in every 10 µs of blocking. Set it to 0 to disable.

</details>

<details><summary>Solution</summary>

Sample at 10 µs (or higher) in steady state. Crank it up only during a diagnosis window via an admin endpoint.

```go
func main() {
    runtime.SetBlockProfileRate(10000) // 10 µs sampling, ~negligible overhead
    // ...
}

// admin handler for short bursts of high-resolution sampling:
func toggleBlockProfile(w http.ResponseWriter, r *http.Request) {
    rate, _ := strconv.Atoi(r.URL.Query().Get("rate"))
    runtime.SetBlockProfileRate(rate)
    w.WriteHeader(http.StatusOK)
}
```

```
BenchmarkChanSendBlocked-8   8000000   155 ns/op   0 B/op   0 allocs/op
// Block profile size after 1h:  ~3 MB
```

~4× faster per blocked event; profile memory drops 250×.

**Why faster:** Each recorded block event walks the stack, hashes it, looks up or inserts in the profile map, and updates counts. Skipping ~999 of every 1000 events removes that work from the hot path. Stack-walking allocates internal buffers that escape; sampling avoids that escape.

**Trade-off:** Rare blocks (<10 µs total) may be undercounted. For most production diagnosis, "where do we block the most?" is well-served by sampling. For "did this rare deadlock happen?", enable rate=1 briefly via the admin endpoint.

**When NOT:** Reproducing a known rare race in a test environment with no traffic load. Library-author benchmarks where you want every event. Mutex profile (`SetMutexProfileFraction`) has the same shape — same advice applies.

</details>

---

## 7. Exercise 6 — `runtime.Stack(buf, true)` polled for monitoring

**Difficulty:** hard

A "stuck-goroutine detector" calls `runtime.Stack(buf, true)` every 5 seconds to dump all goroutines and grep for ones that haven't moved. `runtime.Stack` with `all=true` stops the world and walks every goroutine's stack. At 50k goroutines, that's a 200 ms pause every 5 s — 4% of CPU lost to a *monitoring* feature.

```go
func monitorStuck() {
    buf := make([]byte, 1<<20)
    for {
        n := runtime.Stack(buf, true) // STW, walks every goroutine
        analyze(buf[:n])
        time.Sleep(5 * time.Second)
    }
}
```

```
// At 50k goroutines, 4 GB heap:
// STW pause per call:        ~200 ms
// p99 request latency spike: every 5 s
// CPU spent in runtime.Stack: ~4%
```

<details><summary>Hint</summary>

`runtime.Stack(_, true)` is for diagnosis, not steady-state monitoring. Sample sparingly (every 60–300 s), use `runtime/metrics` (`/sched/goroutines:goroutines`) for counts, and trigger a full dump only when a counter-based heuristic flags trouble.

</details>

<details><summary>Solution</summary>

Drop the periodic dump. Track goroutine count via `runtime.NumGoroutine` (cheap, atomic) or `/sched/goroutines:goroutines`. Only call `runtime.Stack(_, true)` when count crosses a threshold or a per-handler context times out.

```go
func monitorStuck() {
    t := time.NewTicker(30 * time.Second)
    var lastCount int
    for range t.C {
        n := runtime.NumGoroutine() // ~50 ns, no STW
        if n > 100000 && n > lastCount*2 {
            buf := make([]byte, 1<<20)
            sz := runtime.Stack(buf, true) // one-shot diagnostic dump
            log.Printf("goroutine spike: %d\n%s", n, buf[:sz])
        }
        lastCount = n
    }
}
```

```
// At 50k goroutines, 4 GB heap:
// STW pause per call (normal path):  0 ms
// p99 spike from monitoring:         eliminated
// CPU spent in monitor:              <0.01%
```

**Why faster:** `runtime.Stack(buf, true)` calls `stopTheWorld`, iterates `allgs`, and writes a textual representation of every frame. Avoiding the call avoids all of that. `NumGoroutine` reads `gcount()` — a single atomic load.

**Trade-off:** Won't catch a slow leak before it crosses the threshold. Pair with a `pprof.Lookup("goroutine").WriteTo` snapshot on-demand via an admin endpoint for diagnosis. Sampling once every 30 s instead of 5 s means a stuck goroutine is detected up to 30 s later — usually fine.

**When NOT:** Short-lived test programs where pause cost is irrelevant. Crash dump handlers (SIGQUIT) where you want everything. Forensic post-mortem on a stuck process.

</details>

---

## 8. Exercise 7 — `runtime.NumGoroutine()` polled in a hot loop

**Difficulty:** easy

A worker pool decides whether to spawn a new goroutine by checking `runtime.NumGoroutine()` *inside the dispatch loop*. The call itself is cheap (~50 ns), but it's an atomic load of a per-runtime counter that *every* P writes to — under load, that cache line ping-pongs across cores.

```go
func dispatch(jobs <-chan Job) {
    for j := range jobs {
        for runtime.NumGoroutine() > 10000 {  // tight poll
            runtime.Gosched()
        }
        go process(j)
    }
}
```

```
BenchmarkDispatchPolling-8   500000   2400 ns/op   16 B/op   1 allocs/op
// Cache miss rate on sched.gcount line: ~30%
```

<details><summary>Hint</summary>

Use a counting semaphore (`chan struct{}` of capacity N) for backpressure. It's lock-free at the channel layer, the slot count is local, and there's no contention on the global goroutine counter.

</details>

<details><summary>Solution</summary>

Bound concurrency with a buffered channel as a semaphore.

```go
func dispatch(jobs <-chan Job) {
    sem := make(chan struct{}, 10000)
    for j := range jobs {
        sem <- struct{}{}
        go func(j Job) {
            defer func() { <-sem }()
            process(j)
        }(j)
    }
}
```

```
BenchmarkDispatchSemaphore-8   3000000   420 ns/op   16 B/op   1 allocs/op
```

~5.7× faster on the dispatch path, and the cache-line contention disappears.

**Why faster:** `runtime.NumGoroutine` reads `sched.gcount` — a counter incremented/decremented by `runtime.newproc`/`runtime.goexit`. Reading it from many cores forces the cache line through MESI Invalid → Shared → Modified transitions. A buffered channel's slot count is internal to the channel's `hchan` struct, only touched by participants of *that* channel.

**Trade-off:** Semaphore caps your own pool; it doesn't account for goroutines spawned elsewhere. Usually that's exactly what you want — bound *this subsystem*, not the whole process. If you truly need a global cap, use a process-wide semaphore singleton.

**When NOT:** Coarse-grained health checks (once per minute) where polling cost is irrelevant. Diagnostic logging that happens to include a goroutine count.

</details>

---

## 9. Exercise 8 — `runtime.GOMAXPROCS` recomputed per request

**Difficulty:** easy

A request handler calls `runtime.GOMAXPROCS(runtime.NumCPU())` "to make sure we're using all cores". `GOMAXPROCS` is a tunable knob, not a query. Calling it with the same value is a no-op fast path; calling it with a *different* value triggers a full STW to add/remove P's. Either way, it's a hot-path runtime function with no business value.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    runtime.GOMAXPROCS(runtime.NumCPU()) // every request
    serve(w, r)
}
```

```
BenchmarkHandlerWithGOMAXPROCS-8   2000000   620 ns/op   0 B/op   0 allocs/op
// vs identical handler without the call:
BenchmarkHandlerClean-8            8000000   145 ns/op   0 B/op   0 allocs/op
```

<details><summary>Hint</summary>

`GOMAXPROCS` is a process-wide setting. Set it once at startup (or rely on the Go 1.5+ default of `NumCPU`) — or use `automaxprocs` if you run in cgroup-constrained containers.

</details>

<details><summary>Solution</summary>

Remove the call. Since Go 1.5 the default is `runtime.NumCPU()`. For containerized workloads where `NumCPU` reports the host's cores instead of the cgroup quota, set it once in `main` via `go.uber.org/automaxprocs`.

```go
import _ "go.uber.org/automaxprocs" // sets GOMAXPROCS from cgroup quota at init

func handler(w http.ResponseWriter, r *http.Request) {
    serve(w, r)
}
```

```
BenchmarkHandlerClean-8   8000000   145 ns/op   0 B/op   0 allocs/op
```

~4.3× faster on the handler path; no STW risk if a config drift ever passes a different value.

**Why faster:** `runtime.GOMAXPROCS(n)` acquires `sched.lock`, compares the existing value, and (for n != current) calls `procresize`, which stops the world to add or remove P's. Even in the no-change fast path it acquires the lock — under high concurrency that lock becomes the bottleneck. `NumCPU` itself is fine (it reads a cached value) but coupling it to `GOMAXPROCS` per request is the bug.

**Trade-off:** None for typical services. The "we need to react to dynamic cgroup changes" case is rare in practice; even then, react via a SIGHUP-driven reload, not per-request.

**When NOT:** Test harnesses that deliberately constrain GOMAXPROCS for reproduction of P-count-dependent bugs. A controlled benchmark that wants to vary P count across iterations (use `b.SetParallelism` and `runtime.GOMAXPROCS` outside the timed region).

</details>

---

## 10. Exercise 9 — `runtime.LockOSThread` for unnecessary "pinning"

**Difficulty:** hard

A goroutine calls `runtime.LockOSThread()` "for performance — it pins this code to one OS thread". The author was thinking of CPU pinning (`sched_setaffinity`). `LockOSThread` does *not* pin to a CPU; it pins the goroutine to one OS thread, which disables the scheduler's work-stealing for that goroutine. If the goroutine blocks (e.g. on a channel), the *whole OS thread* parks too. Throughput drops.

```go
func worker(jobs <-chan Job) {
    runtime.LockOSThread()             // not what you think
    defer runtime.UnlockOSThread()
    for j := range jobs {
        process(j)                     // includes channel sends, mutex waits
    }
}
```

```
BenchmarkWorkerLocked-8     400000   3100 ns/op   240 B/op   4 allocs/op
BenchmarkWorkerUnlocked-8  1500000    820 ns/op   240 B/op   4 allocs/op
```

<details><summary>Hint</summary>

`LockOSThread` is for code that *must* run on a specific OS thread because some external API requires it: OpenGL contexts, certain CGo libraries, Linux namespaces (`setns`), or `syscall.Setuid`. It is not a performance optimization.

</details>

<details><summary>Solution</summary>

Drop the `LockOSThread`. Let the scheduler move goroutines between P's; that's its job.

```go
func worker(jobs <-chan Job) {
    for j := range jobs {
        process(j)
    }
}
```

```
BenchmarkWorkerUnlocked-8  1500000   820 ns/op   240 B/op   4 allocs/op
```

~3.8× faster.

**Why faster:** Work-stealing is what gives Go its scalability under load imbalance. A locked goroutine's OS thread can't be reused for other goroutines while it's blocked; the scheduler must create another OS thread to keep P's busy, costing ~5 µs per spawn. The locked thread also can't be parked into the M cache between bursts.

**Trade-off:** If you genuinely need OS-thread affinity (CGo libs that use TLS, signal handlers that target a specific thread, `runtime.LockOSThread` in `init` for the main thread on macOS GUI), keep it — and isolate it into a *small* goroutine that only does the thread-bound work, dispatching everything else to unlocked goroutines.

**When NOT:** OpenGL/Vulkan rendering loops. `runtime.LockOSThread` in `init()` for macOS Cocoa main thread. CGo libraries with thread-local state (e.g. some crypto libraries). Linux namespace switches via `setns`.

</details>

---

## 11. Exercise 10 — `runtime/trace.Start` always enabled

**Difficulty:** medium

A service starts `runtime/trace.Start` at process startup and writes to a 4 GB ring buffer "in case we need to look later". The execution tracer records every goroutine state transition, every GC event, every syscall — at 50k goroutines and 10k req/s, that's ~200 MB/s of trace data, plus per-event overhead inside the runtime.

```go
func main() {
    f, _ := os.Create("/var/log/trace.out")
    trace.Start(f) // always on
    // ...
}
```

```
// Production measurements:
// Throughput drop:        ~30%  (10k req/s → 7k req/s)
// CPU overhead:           ~25%
// Disk write rate:        ~200 MB/s
```

<details><summary>Hint</summary>

`runtime/trace` is a diagnosis tool. Enable it for a 5–10 second window, on demand, via `net/http/pprof`'s `/debug/pprof/trace?seconds=5` endpoint. Don't run it continuously.

</details>

<details><summary>Solution</summary>

Remove the always-on trace. Expose `net/http/pprof` (which includes the trace endpoint) on an admin port, gated by auth.

```go
import (
    "net/http"
    _ "net/http/pprof"
)

func main() {
    go func() {
        // admin-only listener, auth-gated
        http.ListenAndServe("127.0.0.1:6060", nil)
    }()
    // ...
}

// Operator runs:  curl -o trace.out 'http://localhost:6060/debug/pprof/trace?seconds=5'
```

```
// Production measurements:
// Throughput:                 10k req/s (full)
// CPU overhead (steady):      ~0%
// CPU overhead (during 5s window):  ~25%, bounded
```

Throughput restored; tracing cost paid only during a 5 s diagnosis window.

**Why faster:** Every goroutine state transition (`gopark`, `goready`, `casgstatus`) hits a trace-write fast path that, when tracing is off, is a single load+branch. When tracing is on, it writes an event to a per-P buffer, periodically flushing to the writer goroutine. At high transition rates the buffer flushes are the bottleneck.

**Trade-off:** No record of the past — if a problem happens once at 3 AM you can't go back and look at the trace. Mitigation: enable continuous tracing in canary instances only, or via a "tracing on for 60 s every 10 min" sampling schedule. For most production debugging, on-demand 5 s windows are enough.

**When NOT:** Pre-production load tests where you want the full trace. Reproducing a known intermittent bug; turn tracing on, run the repro, turn it off.

</details>

---

## 12. Exercise 11 — `runtime.Caller(0)` in a hot logging path

**Difficulty:** medium

A logger calls `runtime.Caller(0)` on every log line to attach `file:line` to the structured event. `runtime.Caller` walks the stack one frame, then calls `runtime.FuncForPC` and `Func.FileLine`, which symbolicate the PC — at >100k logs/sec, this dominates the logger.

```go
func Log(level int, msg string) {
    _, file, line, _ := runtime.Caller(1)
    emit(level, file, line, msg)
}
```

```
BenchmarkLogCaller-8   500000   2200 ns/op   144 B/op   2 allocs/op
```

<details><summary>Hint</summary>

For *most* lines you only need the file (or even just the package), which is a compile-time constant. Capture it once per file via a package-level variable, or use a per-file `slog.Logger` bound at init.

</details>

<details><summary>Solution</summary>

Use a package-level constant for the file path. Only call `runtime.Caller` when you genuinely need the line number (e.g. for error logs, not info logs).

```go
const filename = "service/handler.go" // or computed once via runtime.Caller in init

func Log(level int, msg string) {
    emit(level, filename, 0, msg)
}

func LogError(level int, msg string) {
    _, file, line, _ := runtime.Caller(1) // pay the cost only for errors
    emit(level, file, line, msg)
}
```

```
BenchmarkLogConst-8      30000000   38 ns/op   0 B/op   0 allocs/op
BenchmarkLogErrorRare-8    500000  2150 ns/op  144 B/op   2 allocs/op
```

~58× faster on the common path.

**Why faster:** `runtime.Caller` does a stack unwind (cheap, ~200 ns) but `runtime.FuncForPC` + `FileLine` does a binary search through the PC-line table and decodes the varint-encoded line info — that's where the 2 µs comes from. Using a constant skips all of it.

**Trade-off:** You lose precise line numbers for non-error logs. For info-level logs that's almost always acceptable — the message and package are enough. If you need per-call-site line info, generate it at compile time via `//go:generate` or a linker flag, or use `log/slog` with `AddSource` only on the error sink.

**When NOT:** Test harnesses where every assertion failure must point at its line. Debug logs gated by a build tag (`//go:build debug`). Stack-trace-style error wrapping (`pkg/errors`).

</details>

---

## 13. Exercise 12 — `runtime.SetFinalizer` to detect leaks in production

**Difficulty:** hard

A team adds `runtime.SetFinalizer(obj, func(*T) { atomic.AddInt64(&leaked, 1) })` to every long-lived object to "count leaks". Every finalized object now has to survive an extra GC cycle, finalizer-queue processing is serialized on one goroutine, and the metric only fires *after* the leak is already gone.

```go
type Conn struct{ /* ... */ }

func NewConn() *Conn {
    c := &Conn{}
    runtime.SetFinalizer(c, func(*Conn) { atomic.AddInt64(&leakedConns, 1) })
    return c
}
```

```
BenchmarkNewConnFinalized-8   500000   2900 ns/op   192 B/op   3 allocs/op
BenchmarkNewConnPlain-8      4000000    320 ns/op    96 B/op   1 allocs/op
// Plus: heap retention up ~15% (objects survive extra GC cycle)
// Plus: finalizer goroutine becomes a bottleneck under churn
```

<details><summary>Hint</summary>

Use `pprof` heap profiles (`/debug/pprof/heap`) to find leaks: compare a profile from 5 minutes after startup with one from an hour later. Objects whose retained count grows are your leaks. Finalizers won't help because they only fire *after* the leak resolves.

</details>

<details><summary>Solution</summary>

Drop the finalizer. Track allocations and frees via an explicit `Close` paired with an atomic counter. Use `pprof` heap diffs in CI and production for leak detection.

```go
var (
    connsOpen   atomic.Int64
    connsClosed atomic.Int64
)

func NewConn() *Conn {
    connsOpen.Add(1)
    return &Conn{}
}

func (c *Conn) Close() error {
    connsClosed.Add(1)
    return nil
}

// Expose connsOpen - connsClosed as a gauge; alert on growth without bound.
// Confirm with:  go tool pprof -base old.heap new.heap
```

```
BenchmarkNewConnPlain-8   4000000   320 ns/op   96 B/op   1 allocs/op
```

~9× faster, heap retention back to normal, leaks now detectable *while* they're happening.

**Why faster:** No finalizer table entry, no extra GC-cycle retention, no finalizer-goroutine contention. Atomic counters cost ~5 ns. `pprof` heap-diff is a developer-time tool, not a runtime cost — it costs nothing in steady state, and tells you *what* is leaking, not just *that* something leaked.

**Trade-off:** Requires explicit `Close` discipline. That's a *feature*: leaks become deterministic and testable. The counter approach finds growth, `pprof -base` localizes it.

**When NOT:** Truly opaque foreign objects (cgo handles you can't add `Close` to). One-off scripts during library development to confirm a specific object is GC'd. Even in those cases, restrict finalizers to debug-tagged builds.

</details>

---

## 14. Exercise 13 — Long-lived `runtime/pprof` files filling the disk

**Difficulty:** medium

A nightly cron starts a `pprof.StartCPUProfile` writing to `/var/log/cpu-YYYYMMDD.pprof` and forgets to stop or rotate it. After two weeks, `/var/log` is full, the process panics on the next write, and `journalctl` is unreadable. Even without that bug, continuously streaming profile data to local disk burns I/O bandwidth that should be serving requests.

```go
func main() {
    f, _ := os.Create(fmt.Sprintf("/var/log/cpu-%s.pprof", today()))
    pprof.StartCPUProfile(f) // never stopped, never rotated
    // ...
}
```

```
// After 14 days:
// Disk used by pprof files: ~40 GB
// Disk I/O baseline:        ~5 MB/s (profile writes)
// Disaster:                 disk full → process panics
```

<details><summary>Hint</summary>

Profiles should be bounded — by time (30 s windows), by size (rotate at 100 MB), or by destination (stream to object storage / a profile-collection service like Pyroscope). Never write unbounded profile data to local disk.

</details>

<details><summary>Solution</summary>

Write fixed-duration profiles (30 s) on a schedule, rotate via the filename, and either prune old files or stream to a remote sink (Pyroscope, Parca, GCP Cloud Profiler, Datadog Continuous Profiler).

```go
func profileLoop(ctx context.Context) {
    t := time.NewTicker(5 * time.Minute)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            captureWindow(30 * time.Second)
        }
    }
}

func captureWindow(d time.Duration) {
    name := fmt.Sprintf("/var/log/pprof/cpu-%d.pprof", time.Now().Unix())
    f, err := os.Create(name)
    if err != nil { return }
    defer f.Close()
    if err := pprof.StartCPUProfile(f); err != nil { return }
    time.Sleep(d)
    pprof.StopCPUProfile()
    // upload f to object storage, then delete locally
    uploadAndPrune(name)
}
```

```
// After 14 days:
// Local disk used by pprof: bounded by retention policy (~500 MB)
// I/O baseline:              ~negligible (uploads run async)
// No more disk-full panics.
```

**Why faster:** Local disk writes happen for 30 s out of every 5 min (10% duty cycle) rather than always. Profile data ends up in long-term storage where it's queryable across instances. The process never panics on a full disk.

**Trade-off:** Sampling profiles instead of continuous ones means some 30 s of CPU time is unobserved per 5 min window. For most workloads, statistical sampling is what you want anyway. If you need *continuous* profiling, use a streaming agent (Pyroscope) that writes to a remote sink with bounded local buffering.

**When NOT:** Short-lived batch jobs where a single profile for the entire job is appropriate (and the job exits before disk concerns). Local development where you `pprof` a single test run.

</details>

---

## 15. Exercise 14 — `runtime/debug.FreeOSMemory()` called periodically

**Difficulty:** medium

A team adds `debug.FreeOSMemory()` on a 60 s timer "to give memory back to the OS faster". `FreeOSMemory` forces a full GC cycle *and* a synchronous scavenger pass that walks the heap and `madvise(MADV_DONTNEED)`s free pages. At a 4 GB heap, that's a ~400 ms STW + scavenger cost every 60 s — a noticeable latency spike every minute.

```go
func init() {
    go func() {
        t := time.NewTicker(60 * time.Second)
        for range t.C {
            debug.FreeOSMemory() // STW + scavenger every minute
        }
    }()
}
```

```
// Production measurements (4 GB heap):
// Every 60s:  ~400 ms p99 latency spike
// RSS:        marginally smaller (~5%) than without
```

<details><summary>Hint</summary>

Since Go 1.19, `GOMEMLIMIT` is the right knob for "stay under N bytes of RSS". The runtime's background scavenger already returns idle pages to the OS. Forcing it preemptively just adds STW pauses without meaningfully changing steady-state RSS.

</details>

<details><summary>Solution</summary>

Remove the periodic `FreeOSMemory`. Set `GOMEMLIMIT` (env var or `debug.SetMemoryLimit`) and trust the runtime. Adjust `GOGC` if you want more aggressive collection.

```go
// In your deployment manifest / systemd unit:
// GOMEMLIMIT=3GiB
// GOGC=80   (optional: trade CPU for lower heap)

// Code: nothing.
```

```
// Production measurements (4 GB heap):
// p99 latency spikes:    none (background scavenger is async)
// RSS:                   ~same steady-state ceiling, smoother curve
```

**Why faster:** The background scavenger (since Go 1.14) returns idle pages to the OS continuously, in small increments, on a dedicated goroutine. `debug.FreeOSMemory` short-circuits that into a synchronous batch: full GC + immediate scavenger run + `madvise` syscall storm. That batch is unnecessary if the background scavenger is already keeping up — and since Go 1.19 with `GOMEMLIMIT`, it does.

**Trade-off:** RSS may briefly hover slightly higher than aggressive forced-free would achieve. For most workloads that doesn't matter — the OS reclaims it when actually under pressure. If you're truly memory-constrained, `GOMEMLIMIT` does the right thing without the STW cost.

**When NOT:** A long-running batch job that finishes a large phase and won't allocate again for hours — one `FreeOSMemory` call at the phase boundary is legitimate. Container shutdown hooks where you want a clean handover (though `os.Exit` is fine here too). Embedded systems where every page matters.

</details>

---

## 16. When NOT to optimize

A handful of the patterns above are correct for *some* code:

- `runtime.GC()` belongs in microbenchmarks of GC itself, in tests that need a clean heap to assert on object liveness, and exactly nowhere else.
- `runtime.SetFinalizer` is correct for cgo handles whose lifetime can't be expressed with `defer Close()` — and even there, an explicit `Close` is preferred when possible.
- `runtime.LockOSThread` is *required* for OpenGL, Cocoa main thread on macOS, some CGo libraries with thread-local state, and Linux namespace operations like `setns` and `unshare`.
- High-rate `pprof` (`SetCPUProfileRate > 100`) makes sense in microbenchmarks of microsecond-scale functions.
- `runtime.Stack(_, true)` is the right tool for SIGQUIT crash dumps and forensic post-mortems.
- `runtime/trace` should be on full-time in pre-production load tests where you're hunting scheduler pathologies.
- `runtime/pprof` files written to disk are fine for one-shot diagnoses on a developer machine.
- `debug.FreeOSMemory` is reasonable at coarse phase boundaries in long-running batch jobs.

The common thread: the `runtime` package is for **introspection and tuning**, not for **per-request work**. Anything that takes a stop-the-world pause, walks the entire heap, or pays symbolication cost belongs out of the hot path. Anything that has a "set once at startup" feel — `GOMAXPROCS`, `SetBlockProfileRate`, `SetMutexProfileFraction`, `SetMemoryLimit` — should be set once in `main` (or via env var) and never touched again. Anything that records data continuously — `trace.Start`, high-rate profiles — should run for a bounded window, on demand.

When in doubt: measure before you reach for `runtime.*`. The Go runtime is already heavily tuned for typical workloads. The default `GOGC=100`, default `GOMAXPROCS=NumCPU`, default 100 Hz CPU profiling, default 0 (off) block/mutex profiling, default async background scavenger — these defaults are right for ~95% of production code. Override them only when a profile shows the default is *measurably* wrong for your workload, and document why in a comment next to the call.

---

## 17. Summary

| # | Smell | Cost | Fix |
|---|---|---|---|
| 1 | `ReadMemStats` per request | STW, ~300 µs/call | `runtime/metrics`, cached every 10 s |
| 2 | Manual `runtime.GC()` in benchmark | Measures GC, not code | Remove; trust `b.ReportAllocs()` |
| 3 | `SetFinalizer` for `Close` | Non-deterministic, slow | `defer Close()` |
| 4 | `SetCPUProfileRate(10000)` | ~15% CPU overhead | Default 100 Hz; profile longer instead |
| 5 | `SetBlockProfileRate(1)` always | ~4× per-event cost, MB/s of data | `SetBlockProfileRate(10000)`; crank up on demand |
| 6 | `runtime.Stack(_, true)` polled | ~200 ms STW per call | Sample `NumGoroutine`; dump only on threshold |
| 7 | `NumGoroutine()` in hot loop | Cache-line ping-pong | Buffered-channel semaphore |
| 8 | `GOMAXPROCS` per request | Lock contention, possible STW | Set once in `main` (or `automaxprocs`) |
| 9 | `LockOSThread` for "perf" | Disables work-stealing | Don't lock unless API requires |
| 10 | `trace.Start` always on | ~30% throughput loss | On-demand via `pprof?seconds=5` |
| 11 | `runtime.Caller(0)` per log line | ~2 µs symbolication | Constant file name; `Caller` only on errors |
| 12 | `SetFinalizer` to count leaks | Heap retention + slow detection | Atomic counters + `pprof -base` heap diff |
| 13 | Unbounded `pprof` files | Disk fill, panic | Fixed windows, rotate, upload remote |
| 14 | `FreeOSMemory()` on a timer | STW spikes every minute | `GOMEMLIMIT` + trust background scavenger |

The `runtime` package is your introspection scope. It is not a knob to be turned per request. Set once, observe sparingly, override defaults only when the profile demands it.

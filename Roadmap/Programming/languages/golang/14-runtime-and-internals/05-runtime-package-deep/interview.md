# runtime Package Deep — Interview

## 1. How to use this file

25 questions in interview order — junior to staff — plus a "what NOT to say" section, a 5-minute prep checklist, red flags, and strong-signal markers. Each question has a **short answer** (two to five sentences, the length you'd give in the room) and where it matters a **follow-up to expect**. Read top to bottom on first pass; on revision skim and re-read only the ones you stumbled on. The `runtime` package is small by design and the interview signal is whether you can name what each function *actually does to the runtime* (not just the surface effect), reach for the right observability tool (`runtime/metrics`, `runtime/pprof`, `runtime/trace`), and reason about cost — taking a stack of 50k goroutines, exposing pprof safely, integrating with Prometheus — without prompting.

---

## 2. Junior questions (Q1–Q5)

### Q1. What is the `runtime` package?

**Short answer:** `runtime` is the Go standard library package that exposes the Go runtime — scheduler, GC, memory allocator, goroutine machinery — to user code. It's *not* a general utility package; everything in it is a hook into the binary's runtime system. You reach for it for three reasons: observability (`NumGoroutine`, `MemStats`, `Caller`), control over runtime behaviour (`GOMAXPROCS`, `LockOSThread`, `GC`), and lifecycle hooks (`SetFinalizer`, `AddCleanup`, `KeepAlive`). Subpackages — `runtime/pprof`, `runtime/trace`, `runtime/metrics`, `runtime/debug` — layer on top of the same primitives.

**Follow-up:** Is it portable across Go versions? Answer: the public API is stable under Go's compatibility promise, but the *behaviour* of functions like `GC()` and `MemStats` evolves with the runtime. Code that depends on specific timing or sizes will rot; code that depends on documented semantics won't.

---

### Q2. When should I call `runtime.GC()`?

**Short answer:** Almost never in production. The garbage collector runs itself based on heap growth and GOGC; calling `GC()` manually forces a stop-the-world cycle that competes with whatever the runtime would have scheduled. Three legitimate uses: (1) **benchmarks** — `runtime.GC()` before measuring heap state so prior allocations don't pollute readings; (2) **tests** — forcing a cycle to make `SetFinalizer` callbacks observable in test assertions; (3) **memory-sensitive batch boundaries** — between large jobs in a long-running tool where you'd rather pay GC cost now than mid-job. In a request-serving service it's a smell — usually the right fix is to tune `GOGC` or `GOMEMLIMIT`, not to schedule manual collections.

**Follow-up:** Does `runtime.GC()` return memory to the OS? Answer: no. It runs a GC cycle which marks unreachable heap memory as free, but returning pages to the OS is `debug.FreeOSMemory()` (which itself calls `GC` plus a scavenger pass). Even then, the runtime's background scavenger usually handles OS-return on its own schedule. RSS in `ps` will lag the actual heap usage by minutes; that's normal, not a leak.

```go
// What you almost never want in real code:
runtime.GC()

// What you actually want:
// (in main.go startup)
debug.SetGCPercent(100)         // default
debug.SetMemoryLimit(2 << 30)   // 2 GiB soft cap, Go 1.19+
```

---

### Q3. What does `runtime.NumGoroutine` tell me?

**Short answer:** It returns the count of goroutines that currently exist — running, runnable, or blocked on I/O, channels, locks, or sleep. It is a single integer; it tells you nothing about *what* the goroutines are doing or *why* they exist. Useful for one signal: leak detection. A healthy service has a roughly bounded `NumGoroutine` that fluctuates with load; an unbounded growth curve is a goroutine leak. Export it as a metric, alert on the slope, and use a goroutine stack dump (`runtime.Stack(buf, true)`) to investigate when it's high.

**Follow-up:** Why isn't `NumGoroutine` zero in a "do nothing" program? Answer: the runtime itself runs goroutines — finalizer goroutine, sysmon (the system monitor that preempts long-running Gs), GC workers, signal-handling Gs. A minimal Go binary already has 4-8 goroutines before `main` runs anything. The right baseline isn't zero; it's "whatever NumGoroutine() reads at the end of `main` initialization, plus N per worker pool, plus M per active request".

---

### Q4. Why is `runtime.Caller(0)` useful?

**Short answer:** `runtime.Caller(skip)` returns the program counter, file, and line number of the call site `skip` frames up the stack — `0` is the function that called `Caller`, `1` is its caller, and so on. It's the building block for any log/error library that annotates output with source location. `log.Printf` doesn't do this by default; structured loggers (`zap`, `slog`) and error libraries (`pkg/errors`) lean on `Caller` to attach `file:line` to every entry. The cost is non-trivial (a few hundred nanoseconds — it unwinds the stack), so wrap it behind a level check and don't call it in hot paths unconditionally.

**Follow-up:** What's the difference between `Caller` and `Callers`? Answer: `Caller` returns one frame; `Callers` fills a `[]uintptr` with multiple PCs at once. For a multi-frame stack trace, use `Callers` + `runtime.CallersFrames` to iterate — it's faster than calling `Caller` in a loop because the runtime does one stack walk instead of N.

```go
pc := make([]uintptr, 32)
n := runtime.Callers(2, pc) // skip Callers itself and the function calling it
frames := runtime.CallersFrames(pc[:n])
for {
    frame, more := frames.Next()
    log.Printf("%s\n\t%s:%d", frame.Function, frame.File, frame.Line)
    if !more { break }
}
```

---

### Q5. Difference between `runtime.GOMAXPROCS(0)` and `runtime.GOMAXPROCS(n)`?

**Short answer:** Both return the *previous* value of GOMAXPROCS. `GOMAXPROCS(0)` is a pure read — it queries without changing anything. `GOMAXPROCS(n)` for `n > 0` sets the maximum number of OS threads that can execute user-level Go code simultaneously, and returns the value it replaced. The default is `runtime.NumCPU()` (Go 1.5+); the only reasons to set it explicitly are (a) limiting CPU usage in a multi-tenant container before Go 1.25 honoured cgroup CPU limits, (b) pinning a benchmark to a known parallelism, (c) experiments. In modern Go (1.25+) `GOMAXPROCS` reads container CPU quotas on Linux, so manual overrides are usually wrong.

**Follow-up:** Does `GOMAXPROCS` change the number of OS threads? Answer: no, it changes the number of `P` (processor) slots — the runtime's scheduling contexts. Threads (`M`) are spawned on demand to run blocked Gs; total `M` count is bounded by `runtime.SetMaxThreads` (default 10000), not by GOMAXPROCS.

---

## 3. Middle questions (Q6–Q12)

### Q6. When is `runtime.LockOSThread` necessary?

**Short answer:** When the code on this goroutine must run on a specific OS thread for the rest of the goroutine's life — usually because some external state lives on the thread, not on the goroutine. Three real cases. (1) **OpenGL and similar GUI libraries** — the GL context belongs to a thread; the main render loop must `LockOSThread` before initializing the context. (2) **Thread-local state in cgo** — `pthread_setspecific`, signal masks, locale (`uselocale`), and Linux capabilities are per-thread; if you set them and then yield the goroutine, the next syscall might land on a different thread with different state. (3) **Real-time scheduling or affinity** — setting `sched_setaffinity` only makes sense if the goroutine stays put.

**Follow-up:** What does `LockOSThread` actually do? Answer: it pins the calling goroutine to the current OS thread *and* the thread to the goroutine — neither can be picked up by the scheduler for other work. The thread is destroyed when the goroutine exits unless `UnlockOSThread` is called first. It does **not** pin to a CPU; affinity is a separate syscall.

```go
func init() {
    // The render loop must run on a fixed thread (GL context lives on it).
    runtime.LockOSThread()
}

func renderLoop() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    initGLContext()
    for { drawFrame() }
}
```

---

### Q7. What does `runtime.KeepAlive` do?

**Short answer:** It tells the compiler/runtime "this variable is still in use up to this point" so the GC won't reclaim it earlier than that line. Without it, a value can be collected as soon as the compiler proves no further reads occur, even if the program hasn't reached the function's `return`. This bites when a Go object owns a non-Go resource (file descriptor, C pointer) and you've passed only the resource to a syscall or C call — the GC sees the Go wrapper as unreachable and runs its finalizer, which closes the FD, while the syscall is still using it. `KeepAlive(wrapper)` placed *after* the syscall forces the wrapper to stay reachable through the call.

```go
fd := openSomething() // *Wrapper with finalizer that closes fd.handle
syscall.Write(fd.handle, buf)
runtime.KeepAlive(fd) // without this, finalizer can fire during Write
```

**Follow-up:** Why doesn't `defer fd.Close()` solve this? Answer: it does — if you have a `Close()` and call it deterministically, `KeepAlive` is unnecessary. `KeepAlive` is the patch for code that relies on a finalizer *instead of* `Close()` (usually because the wrapper is passed to code that doesn't know about it).

---

### Q8. Difference between `runtime.SetFinalizer` and `defer Close()`?

**Short answer:** `defer Close()` is deterministic cleanup that runs when the surrounding function returns; `SetFinalizer` schedules a callback to run *sometime after* the object becomes unreachable, at the GC's discretion. Three differences that matter. (1) **Timing** — `defer` runs on a known line; finalizers run "eventually", possibly never if the program exits first. (2) **Ordering** — `defer` honours LIFO within a function; finalizers run on a single runtime-owned goroutine with no ordering guarantees between objects. (3) **Reliability** — if a finalizer panics it crashes the program; if it allocates more memory it can delay the next GC; if the object has reference cycles or is reachable from a global, the finalizer never runs. The rule: use `Close()` for resources you own; use finalizers only as a safety net for "user forgot to call Close".

**Follow-up:** When is a finalizer the right answer? Answer: rarely — `os.File`, `net.Conn`, and `sql.DB` use them as belt-and-suspenders for buggy callers, but every one of them logs a warning when the finalizer actually fires. Treat finalizers as "this should never run in correct code".

```go
// Anti-pattern: finalizer instead of Close.
runtime.SetFinalizer(r, func(r *Resource) { r.fd.Close() })

// Correct: Close is the API, finalizer is the safety net (and logs if hit).
func (r *Resource) Close() error { /* idempotent */ }
runtime.SetFinalizer(r, func(r *Resource) {
    log.Printf("WARN: Resource %p was not Closed", r)
    r.Close()
})
```

---

### Q9. What's `runtime/metrics` and why prefer it over `MemStats`?

**Short answer:** `runtime/metrics` (Go 1.16+) is a stable, versioned, self-describing API for runtime metrics — heap usage, GC pause times, scheduler latency, etc. You query by string name (`"/gc/heap/allocs:bytes"`, `"/sched/latencies:seconds"`) and get back a typed `metrics.Value` (uint64, float64, histogram). Prefer it over `runtime.ReadMemStats` for three reasons. (1) **Doesn't stop the world.** `ReadMemStats` triggers a STW pause to gather consistent numbers; `runtime/metrics` samples are lock-free or near-it. (2) **Histograms, not just counters.** GC pause distribution comes out as a histogram with buckets, not just a `PauseNs` ring buffer. (3) **Forward-compatible.** New metrics are added by name; your code keeps working when fields are added or `MemStats` changes shape.

```go
samples := []metrics.Sample{{Name: "/memory/classes/heap/objects:bytes"}}
metrics.Read(samples)
heapBytes := samples[0].Value.Uint64()
```

**Follow-up:** What about `debug.GCStats`? Answer: thinner than either — gives you the PauseQuantiles and total pauses. Still useful for a quick "what's GC look like?" check from `runtime/debug`, but `runtime/metrics` supersedes it for production. The naming convention `/category/subcategory/...:unit` is also self-documenting — `:bytes`, `:seconds`, `:gc-cycles` are part of the API and tooling like Prometheus exporters use them to set the correct unit conversions.

---

### Q10. How does `runtime/pprof` work?

**Short answer:** `runtime/pprof` collects sampling profiles by name — `cpu`, `heap`, `goroutine`, `block`, `mutex`, `threadcreate`, `allocs`. For CPU it sets up a SIGPROF timer that fires ~100 times per second; the handler records the current goroutine's stack into a buffer. For heap it samples allocations probabilistically (one sample per ~512KB allocated by default) and labels each sample with the allocation stack. The output is a `profile.proto` (protobuf) format file readable by `go tool pprof`. Two integration paths: (a) `pprof.StartCPUProfile(w)` / `StopCPUProfile()` to a writer for tests and one-shot dumps; (b) `net/http/pprof` to expose HTTP endpoints (`/debug/pprof/profile`, `/debug/pprof/heap`) for live services.

**Follow-up:** Why is the CPU profile sampling at 100Hz and not 1000Hz? Answer: overhead. Each sample walks the goroutine's stack, which on a busy server can be 10-50 frames; 100Hz costs ~1% CPU, 1000Hz costs closer to 10%. The default is the floor where the signal is statistically useful and the cost is acceptable to leave on continuously. The block and mutex profiles work differently — they sample *events*, not time, so `runtime.SetBlockProfileRate(rate)` controls how many nanoseconds of blocking trigger one sample, and `runtime.SetMutexProfileFraction(n)` says "sample 1 out of every n mutex contention events".

---

### Q11. What's `runtime/trace` for?

**Short answer:** `runtime/trace` produces a *time-ordered* event trace of runtime activity: every goroutine create/start/block/unblock, every GC phase, every syscall enter/exit, every user task and region (via `trace.NewTask` / `trace.WithRegion`). pprof tells you "where is CPU spent on average"; trace tells you "what happened at 14:23:05.142, in what order, on which P". Reach for it when you need to understand latency — why this request took 200ms when others take 5ms — not when you need to understand throughput. Cost is much higher than pprof (every event is recorded, not sampled), so it's a "turn on for 5 seconds, capture, turn off" tool, not a steady-state observability source.

```go
f, _ := os.Create("trace.out")
trace.Start(f); defer trace.Stop()
// workload of interest
```

**Follow-up:** Can you read the trace output without `go tool trace`? Answer: technically yes — it's a binary format — but the viewer is the value. `go tool trace trace.out` opens a browser UI with per-goroutine timelines, scheduler latency, GC overlays, and synchronization blocking. Looking at the raw bytes won't get you anywhere useful.

The user-facing instrumentation API is `trace.NewTask` for spans across goroutines and `trace.WithRegion` for spans within one goroutine:

```go
ctx, task := trace.NewTask(ctx, "handle-request")
defer task.End()
trace.WithRegion(ctx, "db-query", func() { db.Query(...) })
trace.WithRegion(ctx, "render", func() { render(...) })
```

These show up as named bars in the trace viewer alongside scheduler events, which is how you attribute latency to your own code.

---

### Q12. How do you take a goroutine dump in production?

**Short answer:** Three paths in order of preference. (1) **HTTP via `net/http/pprof`** — `curl http://service:8080/debug/pprof/goroutine?debug=2` returns full stacks for every goroutine. `debug=1` aggregates by stack (smaller). This is the production-friendly option when pprof is exposed. (2) **Signal-triggered** — send `SIGQUIT` (Ctrl-\\) to the process and Go's default signal handler dumps all goroutine stacks to stderr before crashing. Same for `SIGABRT`. Useful when pprof isn't exposed; cost is the process dies. (3) **In-process API** — `runtime.Stack(buf, true)` fills a buffer with stacks of all goroutines and is what `pprof` calls under the hood; wrap it behind an admin endpoint or signal handler. For 50k+ goroutines, prefer `debug=1` (aggregated) — full stacks can be tens of megabytes and slow to parse.

**Follow-up:** Why is `SIGQUIT` not a great option for live services? Answer: it kills the process. Useful for a hung dev binary; in a load-balanced service you'd rather extract the dump without losing the instance — that's what HTTP-pprof and `runtime.Stack` are for. A common variant is to wire `SIGUSR1` to dump goroutines *without* exiting:

```go
go func() {
    c := make(chan os.Signal, 1)
    signal.Notify(c, syscall.SIGUSR1)
    for range c {
        buf := make([]byte, 1<<20)
        n := runtime.Stack(buf, true)
        log.Printf("goroutine dump:\n%s", buf[:n])
    }
}()
```

---

## 4. Senior questions (Q13–Q20)

### Q13. How would you safely expose `pprof` in a production HTTP service?

**Short answer:** Never on the public listener. Three layers of defence. (1) **Separate admin port.** Run pprof on `127.0.0.1:6060` or an internal-only port, bound only to a private interface or a Unix socket. The public mux must not include `net/http/pprof`. (2) **Auth on the admin port.** If the admin port is reachable from outside localhost — Kubernetes pod, debugging through a jump host — wrap the handler in basic auth or mTLS. The default `/debug/pprof` is unauthenticated and a CPU profile DoS is trivial: a 30-second profile holds a lot of buffers. (3) **Profile selection.** Disable expensive profiles by default — mutex and block profiling need `runtime.SetMutexProfileFraction` and `runtime.SetBlockProfileRate` to be turned on, and they aren't free. Heap and goroutine are cheap to read on demand; CPU and trace are not.

```go
// main.go (public listener — no pprof)
public := http.NewServeMux()
public.Handle("/", appHandler)
go http.ListenAndServe(":8080", public)

// admin listener — pprof bound to loopback
admin := http.NewServeMux()
admin.Handle("/debug/pprof/", http.DefaultServeMux) // import _ "net/http/pprof"
go http.ListenAndServe("127.0.0.1:6060", admin)
```

Senior moves: (a) loopback-only bind, (b) admin endpoints behind separate auth, (c) explicit profile enablement so blocked profiles don't accumulate samples in memory by default.

**Follow-up:** What's the DoS surface of pprof? Answer: `/debug/pprof/profile?seconds=N` will profile for `N` seconds and pin a few MB of buffer per concurrent request. An attacker can hammer it with `seconds=60` for hours; that's why it's loopback-only.

---

### Q14. Walk through what happens when you call `runtime.GC()`.

**Short answer:** `runtime.GC()` blocks until a full GC cycle completes, including any cycle already in progress. The sequence: (1) acquire `mheap_.lock` to coordinate, then enter STW1 (stop-the-world phase 1) where all Gs are paused at safepoints. (2) Run write barrier enable + root marking: stack scanning of every goroutine, global variable scanning, finalizer roots. (3) Exit STW1 and enter the concurrent mark phase — workers walk the heap from roots, marking reachable objects, while user goroutines continue with write barriers active. (4) Mark termination STW2: assist outstanding mark work, drain mark queues. (5) Sweep phase begins (concurrent with the next mutator work) and `GC()` returns. Reclaimed memory is added to the runtime's free spans; OS pages aren't returned — the scavenger does that on its own schedule. Total cost: two short STW pauses (typically <1ms total) plus mark CPU spent in parallel with user code.

**Follow-up:** Does `runtime.GC()` block until all reclaimable memory is freed? Answer: no — it blocks until the GC cycle's mark and sweep *start* completing. Sweep is concurrent and continues after `GC()` returns; objects freed mid-sweep aren't on the free list yet when `GC()` returns. For "force every reclaimable byte freed", you'd need `debug.FreeOSMemory()` which calls `GC` then explicitly drains the sweep. Note also: `runtime.GC()` waits for a *complete* cycle. If a cycle is mid-flight when you call, you wait for that one to finish *and* for a fresh cycle that started after your call — two cycles total.

---

### Q15. Why might `runtime.SetFinalizer` not run for an object you expect it to?

**Short answer:** Five reasons in order of frequency. (1) **The object is still reachable.** A global slice, a long-lived map, a closure holding a reference — anything that keeps the object reachable from a root means the finalizer never fires. (2) **Reference cycle including a finalizer.** Go's GC handles cycles for collection, but a cycle of objects with finalizers won't collect any of them — the runtime can't decide finalizer ordering, so it gives up. (3) **Program exits.** Finalizers are best-effort; the runtime doesn't drain pending finalizers at exit. Short-running programs may never run any. (4) **GC hasn't run yet.** Finalizers only fire after GC discovers unreachability; in a heap that barely grows, GC may not run during the object's lifetime. (5) **Wrong object passed to `SetFinalizer`.** It must be a pointer to an object allocated by `new` or a composite literal `&Foo{}` — passing a pointer to a stack variable or to an interior of a struct silently fails or panics. The diagnostic: write a test that calls `runtime.GC()` and `runtime.Gosched()` in a loop and asserts the finalizer ran.

**Follow-up:** Can a finalizer resurrect its object? Answer: yes — by storing a reference to its argument somewhere reachable. The runtime then skips collecting the object, the finalizer doesn't re-register (you'd need to `SetFinalizer` again inside the finalizer), and you've created a hard-to-debug zombie. Idiomatic Go avoids this entirely.

---

### Q16. How do you read a 50K-goroutine stack dump efficiently?

**Short answer:** Don't read line by line — aggregate first. The default `debug=2` dump is one stack per goroutine and you'll never finish reading. Pipeline:

1. **Get `debug=1`** — `curl http://localhost:6060/debug/pprof/goroutine?debug=1`. This aggregates by identical stack trace and shows `N` goroutines per stack. 50k goroutines often collapse to 10-50 unique stacks.
2. **Sort by count.** The top of the list is what's leaking. A line like `30000 @ 0x... runtime.gopark+0x... net/http.(*conn).serve+0x...` tells you 30k goroutines are sleeping in `http.conn.serve` — likely a connection leak from clients not closing connections.
3. **Use `pprof` instead of grep.** `go tool pprof http://localhost:6060/debug/pprof/goroutine` opens an interactive prompt; `top10`, `list <fn>`, and `web` (flamegraph) are 10x more efficient than text search.
4. **Triage by category.** Stacks parked in `chan receive`, `chan send`, `select`, `sync.(*Mutex).Lock`, `sync.WaitGroup.Wait` each suggest a different leak pattern. Group mentally and investigate the largest category first.
5. **Diff over time.** Take two dumps 30 seconds apart and diff the counts; the stacks that grew between snapshots are the actively leaking ones, vs the stacks that are merely large but stable.

Senior moves: (a) always start with `debug=1` for large dumps, (b) use `pprof` interactive mode rather than reading text, (c) diff two snapshots to separate leaks from steady-state large counts.

**Follow-up:** What if `debug=1` is still 10000 unique stacks? Answer: you have a real fan-out with diverse work — possibly legitimate. Bucket by the second-from-top frame (the caller of `gopark`) instead of the full stack to collapse further. The goroutine profile in pprof does this aggregation natively.

---

### Q17. What is `pprof.Do` / pprof labels and why are they useful?

**Short answer:** `pprof.Do(ctx, labels, fn)` attaches a set of key=value labels to every CPU profile sample taken while `fn` is running. The samples carry the labels through to the profile output; in `go tool pprof` you can filter or group by them. Concretely, you can tag a CPU profile by `tenant_id`, `endpoint`, or `request_id` and then ask "how much CPU does this one tenant consume?" without instrumenting your code with timers. Without labels, a CPU profile shows function-level cost and you have to reason about which call sites came from which workload; with labels, the profile carries that context directly.

```go
labels := pprof.Labels("endpoint", r.URL.Path, "tenant", tenantID)
pprof.Do(r.Context(), labels, func(ctx context.Context) {
    handle(ctx, r)
})
```

Senior moves: (a) labels show up in pprof's `-tagfocus` and `-tagshow` flags for filtering/grouping, (b) labels are *only* attached to CPU profile samples — heap and goroutine profiles don't carry them (yet — `runtime/pprof` issue #23458 tracks expansion), (c) labels propagate through goroutines created from within the labelled context but not through goroutines created from a non-labelled parent.

**Follow-up:** What's the overhead of pprof labels? Answer: a few hundred nanoseconds per `Do` call to push and pop the label set; nothing in the steady state when CPU profile isn't running. Cheap enough to leave on every request.

---

### Q18. When is `runtime.Stack(buf, true)` dangerous?

**Short answer:** Three dangers. (1) **Stop-the-world pause.** With `all=true`, `runtime.Stack` stops every goroutine at a safepoint to gather their stacks. On a service with 50k goroutines this pause is measurable — tens to hundreds of milliseconds. In a latency-sensitive request handler this is a self-inflicted outage. (2) **Buffer sizing.** If `buf` is too small, the function silently truncates — you get only part of the dump. Truncation in a partial dump is worse than no dump because the answer to "what's wrong?" lies in the part that got cut. Either size generously (start with 1 MB and grow if `n == len(buf)`) or call repeatedly with `all=false` per-goroutine. (3) **Allocation in the wrong place.** The stack buffer itself is a `[]byte`; if you call this in a hot path or in a panic handler that's already low on resources, you allocate exactly when you can least afford it. The fix: pre-allocate a debug buffer at startup, or rate-limit the calls.

```go
// Acceptable: signal-triggered, sized for growth
var stackBuf = make([]byte, 1<<20) // 1 MB pre-allocated

func dumpStacks() {
    n := runtime.Stack(stackBuf, true)
    for n == len(stackBuf) {
        stackBuf = make([]byte, 2*len(stackBuf))
        n = runtime.Stack(stackBuf, true)
    }
    log.Print(string(stackBuf[:n]))
}
```

**Follow-up:** Alternative without STW? Answer: `runtime/pprof.Lookup("goroutine").WriteTo(w, 1)` — same data, more efficient pathway, no buffer sizing dance. Use `runtime.Stack` only when you can't import `runtime/pprof` (rare).

---

### Q19. How would you integrate `runtime/metrics` into a Prometheus exporter?

**Short answer:** Wire `runtime/metrics` samples into Prometheus collector callbacks. Pattern:

1. **Pick metrics by name once at startup.** `metrics.All()` returns the catalog; filter to names you care about (`/gc/`, `/sched/`, `/memory/`). Build a `[]metrics.Sample` slice keyed by name so you can refer to indices later.
2. **Register Prometheus collectors that pull on Collect().** Implement `prometheus.Collector` whose `Collect(ch)` calls `metrics.Read(samples)` and emits Prometheus metrics from the values. Read once per scrape; sample reads are cheap.
3. **Map metric types.** `metrics.KindUint64` and `metrics.KindFloat64` → Prometheus Gauge or Counter (depending on cumulative vs instantaneous). `metrics.KindFloat64Histogram` → Prometheus Histogram with the same buckets via `prometheus.NewConstHistogram`.
4. **Names and units.** Replace `/` with `_`, strip the leading `/`, append unit suffix: `/gc/heap/allocs:bytes` → `go_gc_heap_allocs_bytes`. The `prometheus/client_golang` package's `collectors.NewGoCollector(collectors.WithGoCollectorOptions(collectors.GoRuntimeMetricsRule{Matcher: ...}))` does most of this for you.

```go
import "github.com/prometheus/client_golang/prometheus/collectors"

reg.MustRegister(collectors.NewGoCollector(
    collectors.WithGoCollections(collectors.GoRuntimeMetricsCollection),
))
```

Senior moves: (a) prefer the official `client_golang` integration over hand-rolled — it handles unit conversion and naming consistently; (b) histograms need `prometheus.NewConstHistogram` with cumulative bucket counts (Prometheus expects `le` bucket counts, runtime/metrics gives bucket-edge + count pairs — convert); (c) restrict the matcher so you don't blow up cardinality by exposing every internal metric.

**Follow-up:** Why not just use the legacy `MemStats`-based Go collector? Answer: legacy paths invoke `ReadMemStats` (STW pause) per scrape. With a scrape every 15s and a 5ms STW each, you've added 0.03% latency tax on every request — small but unnecessary when `runtime/metrics` is STW-free.

---

### Q20. What's `runtime.AddCleanup` (1.24) and how does it differ from `SetFinalizer`?

**Short answer:** `runtime.AddCleanup(ptr, fn, arg)` registers a callback `fn(arg)` to run after `ptr` becomes unreachable. It's the modern replacement for `SetFinalizer` with three improvements. (1) **No cycle penalty.** The cleanup doesn't hold a reference to `ptr` — it only holds `arg`. So a cycle in `ptr`'s reachability graph doesn't prevent the cleanup from running. With `SetFinalizer`, the finalizer holds a reference to the object, so cycles among finalized objects never collect. (2) **Multiple cleanups per object.** You can register many cleanups for the same `ptr`; `SetFinalizer` is one-per-object and resetting it cancels the prior. (3) **Decoupled argument.** The `arg` passed to the cleanup is separate from `ptr`, so you can capture exactly what cleanup needs (a file descriptor, a handle) without resurrecting the whole object.

```go
type File struct{ fd int }
f := &File{fd: openFD()}
runtime.AddCleanup(f, func(fd int) { syscall.Close(fd) }, f.fd)
// f.fd is captured by value; cleanup doesn't reference *File at all.
```

Senior moves: (a) prefer `AddCleanup` for new code in Go 1.24+; (b) it still doesn't replace `Close()` — both are best-effort safety nets, not deterministic cleanup; (c) the `arg` design subtly fixes a real bug class — capturing the whole `*File` in a `SetFinalizer` closure can keep the object alive forever via the closure capture, which is exactly the bug `AddCleanup` is shaped to prevent.

**Follow-up:** When would you still use `SetFinalizer`? Answer: code that must run on Go versions before 1.24, or library code that cannot bump its minimum Go version. New greenfield code on modern Go should default to `AddCleanup`. The wider claim — that `AddCleanup` makes resource lifetimes "safe" — is wrong; it improves the safety net but doesn't replace deterministic cleanup. `defer Close()` and explicit lifecycle remain the right primary mechanism; `AddCleanup` catches bugs in the primary mechanism.

---

## 5. Staff/Architect questions (Q21–Q25)

### Q21. The runtime API is small by design — argue for or against an API to "force a P to release".

**Short answer:** Argue *against*, with one narrow exception.

**Against.** The runtime's value proposition is that the scheduler is opaque — Go programmers don't manage P/M/G assignment, and that's why the language scales without thread-pool tuning. An API to "release a P" means user code can decide a P should be unbound from its current M — but the scheduler is the only component with the full picture (work-stealing balance, syscall fate, GC mark workload). Exposing this primitive (a) creates a public commitment to a particular scheduler architecture (P/M/G is an implementation detail; future Go could merge them), (b) gives users a knob they'll misuse — every "I'll just release this P" is a "I outsmart the scheduler" bet that's almost always wrong, (c) hands attackers a new DoS primitive (release all Ps from a tight loop). The right escape hatch already exists: `runtime.Gosched()` voluntarily yields, and that's enough for legitimate cases.

**The narrow exception.** If a user has `LockOSThread`'d a goroutine for a long-running cgo call and the scheduler is now starved of an M, an explicit "unlock this G's P even though G is still running" might help. But this case is already handled — the scheduler creates new Ms when existing ones block. Adding the API would be a fix in search of a problem.

**Staff move:** name what you'd build instead. If the underlying need is "I have a CPU-bound goroutine and I want it to yield more often", the answer is `runtime.Gosched()` plus instrumentation; if it's "the scheduler isn't fair under my workload", the answer is a bug report, not a knob.

**Follow-up:** Is there *any* case where you'd add such an API? Answer: for the runtime authors' own testing, yes — but exposed as `internal/runtime/debug`, not `runtime`. Public API is a forever commitment.

---

### Q22. Design a "goroutine profiler with labels" using only public APIs.

**Short answer:** Combine `pprof.Lookup("goroutine")` with a label propagation layer keyed by goroutine identity. Five pieces.

1. **Label storage.** A `sync.Map[uint64, map[string]string]` keyed by goroutine ID. There's no public goroutine ID API; parse it from the first line of `runtime.Stack(buf, false)` (`"goroutine 42 [running]:"`), or use `runtime/pprof.Labels` if the labels you care about are already pprof labels.
2. **Label attach.** Wrap entry points (HTTP handler, worker dispatch) in a helper that records `goroutine_id → labels` on entry and removes on exit, much like `pprof.Do` but for goroutine profile.
3. **Profile collection.** Periodically (or on demand) call `pprof.Lookup("goroutine").WriteTo(buf, 0)` to get the goroutine profile in protobuf form. The profile contains samples with stacks but no labels by default.
4. **Label injection.** Walk every goroutine via `runtime.Stack(buf, true)` once per profile, extract goroutine IDs and stacks, join against the `sync.Map` to get labels per goroutine, and emit a custom profile (or sidecar metric) with labels attached.
5. **Output.** Either write a pprof-compatible `profile.proto` with labels in the samples (so `go tool pprof -tagfocus tenant=x` works), or emit Prometheus metrics like `go_goroutines_by_label{tenant="x"} 3000`.

Staff move: be honest about cost — this is a profile, not a metric. Don't run it every 10 seconds; run it on demand or every few minutes. The `sync.Map` overhead on entry/exit is the steady-state cost; the profile walk is the on-demand cost.

**Follow-up:** Why doesn't `pprof.Do` already cover this? Answer: `pprof.Do` labels are attached to CPU profile samples, not goroutine profile samples. Extending pprof labels to all profile types is on the runtime team's radar but not done; until then, this kind of custom layer is the answer.

---

### Q23. What would you propose to add to `runtime/metrics` for next release?

**Short answer:** Three additions, in priority order.

1. **Per-P scheduler metrics.** Today `runtime/metrics` exposes global scheduler latency (`/sched/latencies:seconds`) but not per-P breakdown. On a 64-CPU machine, knowing *which* P is overloaded matters — currently you need `trace` to find out, which is expensive. Proposed: `/sched/latencies/per-p:seconds` as a per-P histogram, gated behind a flag because of cardinality concerns.
2. **Mutex contention duration histogram.** `/sync/mutex/wait/total:seconds` exists as a counter; what's missing is the *distribution* — is contention a long tail of brief waits or a few catastrophic stalls? A histogram answers the question without enabling mutex profiling (which has higher overhead).
3. **GC assist credit detail.** `/gc/cycles/total:gc-cycles` and `/gc/pauses:seconds` describe GC time but not how much *user* code paid in GC assists. When a goroutine allocates fast it gets drafted into mark work; the cost shows up as request latency but isn't attributable in pprof. Proposed: `/gc/assist/duration:seconds` per-goroutine sampled in CPU profiles with a `gc_assist=true` label.

Staff move: each proposal cites a real diagnostic gap (where does the production engineer reach for a worse tool today?) and considers cardinality cost (per-P metrics on a 1000-CPU node are an explosion).

**Follow-up:** How would you propose these — direct PR, proposal doc? Answer: proposal doc to `golang/go` with a design rationale and benchmark of overhead. `runtime/metrics` is a stable API; additions need community signoff. The proposal template includes "what problem does this solve that existing metrics don't?" which is exactly what the three above answer.

---

### Q24. How would you build a "leak detector" using only public runtime APIs?

**Short answer:** Three primitives compose into a leak detector.

1. **Goroutine leak detector.** Snapshot `runtime.NumGoroutine()` and goroutine profile (`pprof.Lookup("goroutine")`) at a known-quiet baseline. Periodically snapshot again and diff: goroutines whose stacks match the previous diff (same parked location, growing count) are leaks. Aggregate by stack to surface the leak site; alert when growth crosses a threshold.

2. **Heap leak detector.** Periodically read `/memory/classes/heap/objects:bytes` from `runtime/metrics` and watch the trend after GCs settle. A heap that grows monotonically across GC cycles (not just intra-cycle) is leaking. To localize: `pprof.Lookup("heap").WriteTo(w, 0)` gives a heap profile; diff two profiles taken some time apart and the growing allocation sites are the leak.

3. **Finalizer-based "should be freed by now" check.** Tag objects you suspect might leak with `runtime.AddCleanup(ptr, func(id string){ delete(suspectMap, id) }, id)`. After running a workload, `runtime.GC()`; entries left in `suspectMap` are leaked. This is a test-time tool, not a production one, but it pinpoints leaks of specific types precisely.

Wire all three behind an admin endpoint or a periodic background goroutine that writes a structured log when thresholds trip. Output format: `{"leak":"goroutine","stack":"http.serve","count_delta":12000,"window":"5m"}`.

Staff move: acknowledge what this *can't* detect — cycles among non-finalizable types (no detection without `AddCleanup` instrumentation), and leaks within a single GC cycle that get freed before the next snapshot.

**Follow-up:** Why not use third-party tools like `goleak`? Answer: `goleak` is for tests (assert no goroutines leaked from a test); it's not a production leak detector. The runtime APIs above scale to a live service.

---

### Q25. Discuss the tension between observability and overhead in runtime/pprof.

**Short answer:** Every profile in `runtime/pprof` exists on a spectrum from "observable for free" to "observable at meaningful cost", and the design of a production observability stack picks per-profile.

| Profile | Cost | Production posture |
|---------|------|-------------------|
| **goroutine** | Cheap (snapshot on read) | Safe to read every minute |
| **heap** | Cheap (sampling 1/512KB) | Safe to read every minute |
| **threadcreate** | Cheap | Safe to read every minute |
| **cpu** | ~1% CPU while running | On-demand, short bursts |
| **block** | High if `BlockProfileRate` is low (samples every blocking event) | Off by default; turn on to debug |
| **mutex** | High if `MutexProfileFraction` is 1 (samples every mutex unlock) | Off by default; sample fraction 100-1000 in prod |
| **trace** | Very high (every event) | Off by default; turn on for seconds |

The tension is sharpest with **block** and **mutex**: they're invaluable for debugging contention, but the natural use ("turn them on and forget") destroys throughput. The right posture is *episodic*: keep cheap profiles always-on (export to `pprof` continuous profiling like Pyroscope or Polar Signals), and gate expensive ones behind an operator action. Continuous profilers have largely solved this for cpu and heap — they sample at low rates continuously and aggregate over time — but block and mutex remain manual.

The deeper tension is between **profile fidelity** and **profile validity**. Lower sample rates make profiles cheaper but lose tail behaviour — a 1% CPU profile misses spikes; a 1-in-1000 mutex sample misses the rare-but-catastrophic lock. The pragmatic answer: layered defaults. CPU and heap always-on at low rate; block and mutex off but accessible via a privileged operator endpoint; trace as a "kill switch" for hard latency debugging where you accept the cost for 5-30 seconds.

Staff move: name the *design principle* — pay for observability proportional to its value at the current moment. A service in incident mode can afford 5% CPU on profiling; the same service in steady state cannot.

**Follow-up:** What's the future direction here? Answer: continuous profiling with kernel-level sampling (eBPF) is eating into Go's pprof use case — same data, lower overhead, language-agnostic. Go's pprof will remain authoritative for Go-specific details (goroutine state, GC assists) but generic CPU and heap profiling are moving out of the language runtime. Pyroscope, Parca, Polar Signals, and Datadog's continuous profiler are the current commercial answers; the open standard (OpenTelemetry profiling signal) is converging on the pprof protobuf format, so Go's runtime is upstream of the whole ecosystem either way.

---

## 6. What NOT to say

These are confidently-wrong statements that mark a weak candidate. Avoid them.

- **"Use `SetFinalizer` for cleanup."** Finalizers are best-effort; they may never run, can resurrect objects, fire in unspecified order, and block GC. Use `defer Close()` or `runtime.AddCleanup` (1.24+) and treat finalizers as a "buggy caller forgot Close" safety net.
- **"`runtime.GC()` frees memory back to the OS."** It runs a collection cycle; reclaimed memory goes to the runtime's free spans, not back to the kernel. `debug.FreeOSMemory()` is the function that hints to the scavenger to return pages — and even then it's a hint.
- **"`LockOSThread` pins the goroutine to a CPU."** It pins to an *OS thread*, not a CPU. CPU affinity is a separate syscall (`sched_setaffinity` on Linux). The two are independent — a locked thread still migrates across CPUs unless affinity is also set.
- **"`NumGoroutine()` shows running goroutines."** It shows *all* goroutines — running, runnable, blocked on channels/I/O/locks, sleeping. A high count usually means many goroutines are *blocked*, not many running.
- **"`GOMAXPROCS` sets the number of OS threads."** It sets the number of P slots (scheduling contexts). The total OS thread count is independent — bounded by `SetMaxThreads`, expanded as needed when Gs make blocking syscalls.
- **"`runtime/pprof` adds zero overhead."** CPU profile costs ~1% at default 100Hz; block and mutex profiles can cost much more if the sample rate is set aggressively. "Negligible if used right" is honest; "zero" is wrong.
- **"Read `MemStats` for heap monitoring."** `ReadMemStats` triggers a stop-the-world pause. Use `runtime/metrics` for steady-state monitoring; reserve `MemStats` for one-shot diagnostics.
- **"Finalizers run when the object goes out of scope."** They run *sometime* after the object becomes unreachable, at the GC's discretion. The two are completely different events — out-of-scope is a compile-time concept, unreachable is a runtime concept and depends on escape analysis, references, and GC scheduling.
- **"Setting `GOMAXPROCS` higher always helps performance."** Above `NumCPU()` it almost never helps; it causes thread oversubscription and worse cache behaviour. The right value is `NumCPU()` (or the cgroup-aware default in Go 1.25+) for the vast majority of workloads.
- **"`runtime.Stack` is cheap."** With `all=true` it stops the world. On a service with 50k goroutines it's a real outage. Use `pprof.Lookup("goroutine").WriteTo` instead, and even that's not free.
- **"Goroutines have IDs you can read with `runtime.GoroutineID()`."** There is no public API to get a goroutine ID. Parsing it out of `runtime.Stack` works but is fragile and explicitly discouraged. If you need per-goroutine context, use `context.Context` or pprof labels.
- **"`runtime/trace` is a sampling profiler like pprof."** It's an *event tracer* — every scheduler event, every GC phase, every goroutine transition is recorded. Useful for understanding latency in a 5-second window; not useful as a steady-state profiler.

---

## 7. 5-minute prep checklist

Before walking into a Go runtime interview, you can recall:

- [ ] What the `runtime` package is and the three reasons to reach for it (observability, control, lifecycle hooks).
- [ ] Why you almost never call `runtime.GC()` in production — and the three legitimate exceptions (benchmarks, tests, batch boundaries).
- [ ] What `NumGoroutine()` actually counts (all goroutines, including blocked) and how to use it for leak detection.
- [ ] The signature and use of `runtime.Caller(skip)` and `runtime.Callers` — and why you'd use `Callers` over a loop of `Caller`.
- [ ] `GOMAXPROCS(0)` reads, `GOMAXPROCS(n)` writes; both return the previous value. Default is `NumCPU()`; Go 1.25+ honours cgroups.
- [ ] When `LockOSThread` is actually needed (OpenGL, thread-local state in cgo, scheduling affinity) — and that it pins to a *thread*, not a CPU.
- [ ] What `KeepAlive` does and the exact pattern (place it *after* the syscall that uses the wrapped resource).
- [ ] Why `defer Close()` beats `SetFinalizer` for cleanup — and the new `runtime.AddCleanup` in Go 1.24+.
- [ ] `runtime/metrics` is STW-free and the modern replacement for `ReadMemStats`; access by string name (`"/gc/heap/allocs:bytes"`).
- [ ] How `runtime/pprof` works mechanically — SIGPROF timer for CPU at 100Hz, sampling 1/512KB for heap, snapshot for goroutine/threadcreate.
- [ ] What `runtime/trace` produces (event-ordered trace, not samples) and when to use it (latency debugging, not throughput).
- [ ] Three ways to take a goroutine dump in production: HTTP `/debug/pprof/goroutine`, SIGQUIT, in-process `runtime.Stack`. Prefer HTTP.
- [ ] How to safely expose pprof: separate admin port on loopback, auth, explicit profile enablement.
- [ ] What happens when `runtime.GC()` is called: STW1 → concurrent mark → STW2 mark termination → concurrent sweep returns.
- [ ] Five reasons a finalizer doesn't run: still reachable, cycle of finalized objects, program exits early, no GC fired yet, wrong object passed.
- [ ] Reading a 50k-goroutine dump: `debug=1` aggregated, sort by count, group by parked function, diff over time.
- [ ] `pprof.Do` attaches labels to CPU profile samples; useful for tenant/endpoint breakdowns without per-request timers.
- [ ] When `runtime.Stack(buf, true)` is dangerous: STW pause for all goroutines, silent truncation, allocation in bad places.
- [ ] How to wire `runtime/metrics` into Prometheus: `client_golang`'s `NewGoCollector` with the runtime metrics rule.
- [ ] `AddCleanup` vs `SetFinalizer`: no cycle penalty, multiple cleanups per object, arg is decoupled from ptr.
- [ ] One opinionated take: the runtime API is small by design and proposed additions need a real diagnostic gap, not a vague "more control".

---

## 8. Red flags for interviewers

These signal a weak candidate.

- **Calls `runtime.GC()` in production code paths.** No justification, just "to free memory". Misunderstands what GC does and what it costs.
- **Treats `SetFinalizer` as `defer Close()`.** Uses finalizers for resource cleanup; can't articulate why this is unreliable.
- **Confuses `LockOSThread` with CPU affinity.** Says "locks the goroutine to a CPU" or assumes it interacts with `sched_setaffinity`.
- **Reads `MemStats` in a request handler.** Doesn't know `ReadMemStats` causes a STW pause; doesn't reach for `runtime/metrics`.
- **Exposes pprof on the public listener.** Adds `_ "net/http/pprof"` to the main mux and doesn't mention auth, loopback bind, or DoS surface.
- **Can't explain what `KeepAlive` does or when to use it.** Treats it as magic; doesn't link it to escape analysis and finalizer interaction with cgo wrappers.
- **No mention of `runtime/metrics`.** Defaults to `MemStats` for every diagnostic question; hasn't internalised that it's deprecated for monitoring.
- **Reaches for `SIGQUIT` to "dump goroutines in production".** Doesn't realise SIGQUIT kills the process; doesn't know about `/debug/pprof/goroutine`.
- **Can't read a goroutine dump.** Given a 50k-goroutine dump, reads line-by-line; doesn't aggregate by stack or diff over time.
- **Confuses `runtime/pprof` with `runtime/trace`.** Can't articulate that pprof samples function activity and trace records every event.
- **Thinks `GOMAXPROCS` controls OS threads.** Sets it to a high number to "get more threads"; doesn't know about P/M/G.
- **No mention of `runtime.AddCleanup` on Go 1.24+.** Defaults to `SetFinalizer` even when the modern alternative is available.

---

## 9. Strong-candidate signals

These signal a strong candidate.

- **Reaches for `runtime/metrics` unprompted.** When asked "how would you monitor heap usage?", says `runtime/metrics` first, explains why it beats `MemStats`.
- **Names pprof's DoS surface.** When asked about exposing pprof, mentions loopback bind, auth, profile-selection knobs, and the `seconds=N` attack.
- **Articulates STW costs precisely.** Knows `ReadMemStats` is STW, `runtime.Stack(_, true)` is STW, `runtime.GC()` has STW phases — and quantifies the cost.
- **Distinguishes pprof from trace.** Says "pprof for throughput questions, trace for latency questions" or similar; gives concrete examples.
- **Knows the goroutine dump workflow.** `debug=1`, sort by count, group by parked function, diff over time — without prompting.
- **Mentions `pprof.Do` and labels.** When asked about per-tenant CPU attribution, reaches for pprof labels instead of timers.
- **Aware of `runtime.AddCleanup` and its motivation.** Cites the cycle problem with `SetFinalizer` as the reason `AddCleanup` exists.
- **Honest about finalizer reliability.** Treats finalizers as best-effort safety nets, not deterministic cleanup; lists the five failure modes without prompting.
- **Names the Go 1.25 cgroup change for `GOMAXPROCS`.** Knows the default now honours container CPU limits, so manual overrides are usually wrong.
- **Bounds buffer sizing for `runtime.Stack`.** Doesn't pass a fixed-size buffer and pray; either pre-allocates with growth or uses `pprof.Lookup("goroutine").WriteTo`.
- **Knows what the runtime *won't* tell you.** No public goroutine ID API, no "force a P to release", no per-goroutine `KeepAlive` — and can argue why these absences are deliberate.
- **Layers profile cost by mode.** Cheap profiles always-on, expensive ones gated; talks about continuous profiling as the production direction.

---

## 10. Further reading

- **`runtime` package docs**: <https://pkg.go.dev/runtime> — the source of truth. Skim every function once; the API is small enough.
- **`runtime/metrics` design proposal**: <https://github.com/golang/proposal/blob/master/design/37112-runtime-metrics.md> — explains why `MemStats` is being phased out and what the new API guarantees.
- **`runtime/pprof` package docs**: <https://pkg.go.dev/runtime/pprof> — and the supporting `net/http/pprof` for HTTP integration.
- **Profiling Go Programs (Go blog)**: <https://go.dev/blog/pprof> — the canonical pprof tutorial; old but the workflow is unchanged.
- **`go tool trace` documentation**: <https://pkg.go.dev/runtime/trace> — and Dave Cheney's writeup of trace's internals.
- **`runtime.AddCleanup` proposal**: <https://github.com/golang/go/issues/67535> — the design rationale for the 1.24 replacement of `SetFinalizer`.
- **Continuous Profiling with Pyroscope/Polar Signals/Parca**: industry-standard ways to run pprof always-on in production at low overhead.

# `runtime` Package Deep — Find the Bug

## 1. How to use this file

Fourteen buggy snippets of Go code that touch the `runtime`, `runtime/debug`, `runtime/pprof`, and `runtime/trace` packages: finalizers, OS-thread locking, GC tuning, memory stats, profiling. Read each in 30-60 seconds, decide where the defect is, then expand `<details>` for the answer.

Runtime-package bugs almost never produce a compile error and rarely produce a clean panic. They warp behaviour around the edges: a finalizer that fires too late or not at all, an OS thread that quietly leaks, a goroutine count read at a moment that doesn't exist yet, a CPU profile that grows to gigabytes because no one called `StopCPUProfile`. Three questions to ask every snippet:

1. *What does this `runtime` call actually promise — and when (or whether) does the runtime keep that promise?*
2. *Who owns the lifecycle — the caller, the GC, the scheduler, the kernel?*
3. *What is the cost? Most of `runtime` is "advisory hint" or "stop-the-world request"; both have non-obvious blast radius.*

If a snippet can't answer all three, there's a bug.

---

## Bug 1 — Finalizer closure captures the object; finalizer never fires

```go
type Conn struct{ fd int }

func NewConn(fd int) *Conn {
    c := &Conn{fd: fd}
    runtime.SetFinalizer(c, func(_ *Conn) {
        log.Printf("closing fd %d for conn %p", c.fd, c)   // BUG: captures c
        syscall.Close(c.fd)
    })
    return c
}
```

**Observed behavior:** `Conn` instances are allocated and dropped by callers, but the finalizer never runs. `pprof` shows the heap full of unreachable-looking `*Conn`s; file descriptors leak until `ulimit` is hit.

<details><summary>Hint</summary>

What does the finalizer closure refer to? Trace every reachable pointer from the closure back to the object the finalizer is attached to. Read the comment block at the top of `runtime/mfinal.go` — there's a worked example of exactly this trap.

</details>

**Diagnosis:** `runtime.SetFinalizer(obj, fn)` registers `fn` to run when `obj` becomes unreachable. The closure here closes over `c` itself — so the closure object holds a strong reference to `*Conn`. The finalizer keeps `c` alive forever; `c` is never collected; the finalizer never runs.

`runtime/mfinal.go` (`SetFinalizer`'s doc comment) spells it out explicitly: "the finalizer function ... must not refer to the object itself; doing so will prevent it from being collected." Internally, `addfinalizer` (in `runtime/mfinal.go`) records `(obj, fn, ...)` in a side table; the GC's reachability scan walks the closure, finds `c`, and marks the object live every cycle.

This is the single most common finalizer bug. It usually surfaces not as "the finalizer was buggy" but as "the GC is broken — my objects don't free."

**Fix:** Use the parameter, never the outer variable:

```go
func NewConn(fd int) *Conn {
    c := &Conn{fd: fd}
    fd := c.fd                                   // copy, not c
    runtime.SetFinalizer(c, func(x *Conn) {
        log.Printf("closing fd %d for conn %p", x.fd, x)
        syscall.Close(x.fd)
    })
    return c
}
```

Even better: don't put `log.Printf` inside a finalizer at all (finalizers run on a dedicated goroutine; logging there is fine but races with shutdown). Best of all: don't rely on finalizers — see Bug 2.

---

## Bug 2 — Finalizer used to close a file; relies on GC timing

```go
func OpenLog(path string) (*os.File, error) {
    f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0o644)
    if err != nil { return nil, err }
    runtime.SetFinalizer(f, func(f *os.File) { _ = f.Close() })   // BUG: deferred to GC
    return f, nil
}

// caller
for i := 0; i < 100_000; i++ {
    f, _ := OpenLog("/var/log/app.log")
    _, _ = f.Write([]byte("entry\n"))
    // no explicit Close — "the finalizer will get it"
}
```

**Observed behavior:** Program crashes with `too many open files`. The GC is running (`MemStats.NumGC` increases) but file descriptors keep climbing.

<details><summary>Hint</summary>

When does a finalizer actually run, relative to when the object becomes unreachable? Read the second paragraph of `SetFinalizer`'s doc in `runtime/mfinal.go`. Then ask: how big is `os.File`? How many of them fit in the heap before the GC bothers to look?

</details>

**Diagnosis:** Finalizers run *some time* after the object becomes unreachable. There's no upper bound. The GC's trigger is heap growth — not file-descriptor count. `*os.File` is tiny (a few words); millions of unreachable `*os.File` values fit in the live heap before the GC trigger fires.

Even when GC does run, `runtime/mfinal.go`'s `runfinq` enqueues finalizers onto a single dedicated goroutine; under pressure they back up. The kernel's FD table is a hard, low limit (default 1024 on Linux). Heap memory is a soft, high limit. Tying FD release to heap pressure mismatches the resource the system actually constrains.

`os.File`'s standard-library implementation does set a finalizer (`os/file_unix.go`'s `newFile` calls `runtime.SetFinalizer(f.file, (*file).close)`) — but it's a *safety net* for code that forgot to `Close`, not a primary mechanism. The doc on `os.File.Close` says: "Programs should close files as soon as they are no longer needed."

**Fix:** Explicit `defer f.Close()` at the call site. The finalizer is the last line of defence, not the plan.

```go
for i := 0; i < 100_000; i++ {
    f, err := OpenLog("/var/log/app.log")
    if err != nil { return err }
    _, _ = f.Write([]byte("entry\n"))
    f.Close()                                    // explicit, deterministic
}
```

For pooled or shared file handles, use `sync.Pool` or a reference-counted wrapper. Never use finalizers for resources whose limit is enforced outside the Go heap: file descriptors, sockets, kernel handles, GPU buffers, database connections, locks.

---

## Bug 3 — `LockOSThread` without `UnlockOSThread`; M is destroyed when goroutine exits

```go
func runInPinnedThread(work func()) {
    go func() {
        runtime.LockOSThread()                   // BUG: no UnlockOSThread
        // set up thread-local state: CUDA context, GTK GUI, signal mask, etc.
        cudaSetDevice(0)
        work()
        // goroutine returns here
    }()
}

// caller invokes runInPinnedThread thousands of times
```

**Observed behavior:** Over hours, `ps -o thcount` shows the process's thread count climbing slowly even though active goroutines stay flat. Eventually the kernel refuses to create more threads, or memory bloats from per-M stacks.

<details><summary>Hint</summary>

What happens to the OS thread (M, in scheduler terms) when a goroutine that has locked itself to it exits? Is the M returned to the pool? Read the comment on `LockOSThread` in `runtime/proc.go` — specifically the paragraph beginning "If the calling goroutine exits without unlocking the thread".

</details>

**Diagnosis:** `runtime.LockOSThread` pins the calling goroutine to its current M (OS thread). If the goroutine exits while still locked, the runtime *destroys* that M rather than returning it to the idle-M pool — `runtime/proc.go`'s `goexit0` checks `gp.lockedm` and calls `mexit(true)` which tears the thread down.

This is intentional: thread-local state the goroutine set up (CUDA context, OpenGL context, X11 connection, sigaltstack, syscall identity on Linux when `unshare`d) may not be safe to inherit. The Go runtime takes the conservative path and burns the thread.

For `cudaSetDevice`, `gtk_main`, `pthread_setname_np`, `runtime.LockOSThread` is exactly the right tool. But the contract is symmetric: lock for as long as the thread-local state is needed, **unlock before the goroutine returns** if the thread is to be reused.

The leak is slow because Go's scheduler creates new M's on demand; the program *works*, just with growing thread count. On Linux, `/proc/<pid>/status`'s `Threads:` field rises; `top -H` shows phantom threads. Eventually `pthread_create` returns `EAGAIN`.

**Fix:** Pair every `LockOSThread` with an `UnlockOSThread` — and use `defer`:

```go
func runInPinnedThread(work func()) {
    go func() {
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()           // returns M to the pool
        cudaSetDevice(0)
        work()
    }()
}
```

If the thread-local state genuinely cannot be safely reused (CUDA contexts often can't be re-initialised cleanly), keep the lock — but then dedicate one *long-lived* goroutine that owns the thread for the lifetime of the program, and feed it work over a channel. Don't spawn-and-burn.

---

## Bug 4 — `runtime.GC()` in a hot loop; stop-the-world cascade

```go
func ingest(items []Record) {
    for _, r := range items {
        process(r)
        if r.Big {
            runtime.GC()                         // BUG: "free that memory now"
        }
    }
}
```

**Observed behavior:** Single-threaded throughput drops 10x once `Big` records appear. p99 latency for unrelated request handlers spikes simultaneously. `GODEBUG=gctrace=1` shows GC cycles back-to-back, each STW pause adding to tail latency.

<details><summary>Hint</summary>

What does `runtime.GC()` actually do? Look at `runtime/mgc.go` — `GC()` calls `gcStart` with the `gcTriggerCycle` trigger and *blocks until the cycle completes*, including sweep. Compare that to the runtime's automatic pacing.

</details>

**Diagnosis:** `runtime.GC()` runs a *full* mark-and-sweep cycle synchronously. From `runtime/mgc.go`:

```go
// GC runs a garbage collection and blocks the caller until the
// garbage collection is complete. It may also block the entire
// program.
func GC() {
    n := work.cycles.Load()
    gcWaitOnMark(n)
    gcStart(gcTrigger{kind: gcTriggerCycle, n: n + 1})
    gcWaitOnMark(n + 1)
    // ... and waits for sweep, too
}
```

Every call walks the entire reachable heap once. The pacer (`runtime/mgcpacer.go`) is designed to amortize this cost — calling `GC()` manually defeats it. Worse, each manual GC resets the heap-growth target for the next automatic GC, so even non-`Big` records that follow trigger sooner than they would have.

Two stop-the-world phases bracket each cycle (mark-setup and mark-termination). Each STW is hundreds of microseconds to single-digit milliseconds on a healthy server; calling `GC()` thousands of times stacks those pauses.

`runtime.GC()` has exactly two legitimate uses: (1) before benchmarking, to get a clean baseline; (2) before snapshotting memory stats for a regression test. Calling it to "free memory now" is always wrong — the runtime decides when, based on the pacer.

**Fix:** Trust the pacer. If memory pressure is real, tune `GOGC` (lower = more frequent GC, smaller heap) or set a soft memory limit via `debug.SetMemoryLimit` (Go 1.19+):

```go
import "runtime/debug"

func main() {
    debug.SetMemoryLimit(8 << 30)                // 8 GiB soft cap
    ingest(items)                                // no manual GC
}
```

If a specific *large* allocation needs early release, scope its lifetime tightly (use a function so the stack frame frees its references) — but don't call `runtime.GC()`.

---

## Bug 5 — Missing `runtime.KeepAlive` after `unsafe.Pointer` conversion

```go
import (
    "syscall"
    "unsafe"
)

type Buffer struct {
    data []byte
}

func (b *Buffer) WriteToFD(fd int) (int, error) {
    ptr := unsafe.Pointer(&b.data[0])
    n, _, errno := syscall.Syscall(
        syscall.SYS_WRITE,
        uintptr(fd),
        uintptr(ptr),                            // BUG: ptr is now uintptr, GC can't see it
        uintptr(len(b.data)),
    )
    if errno != 0 { return 0, errno }
    return int(n), nil
}

// elsewhere, b has a finalizer that releases pinned memory back to a pool
```

**Observed behavior:** Most calls succeed. Under GC pressure (concurrent allocators on other goroutines), rare calls return garbage bytes, return `EFAULT`, or trigger a SIGSEGV inside the kernel write path.

<details><summary>Hint</summary>

Once `&b.data[0]` is converted to `uintptr`, does the garbage collector know `b` is still in use? Read `runtime.KeepAlive`'s doc in `runtime/mfinal.go` and the "Conversion of a Pointer to a uintptr" rule in `unsafe`'s package docs.

</details>

**Diagnosis:** A `uintptr` is an integer to the GC, not a pointer. Once `unsafe.Pointer(&b.data[0])` is cast to `uintptr` for the syscall, the GC and finalizer scanner stop tracking `b` through that variable. If `b` has no other live references, the runtime is free to:

1. Run `b`'s finalizer, returning the underlying memory to a pool or releasing it.
2. Move the underlying array if `b.data` lives in a region the runtime relocates (the current Go runtime doesn't move heap objects, but compaction is a long-standing roadmap item and the contract assumes it can).

While the kernel is inside `write(2)`, dereferencing the now-stale pointer, either of these is a use-after-free.

The `unsafe` package's documented rule:

> Note that the pointer must point into an allocated object, so it may not be nil. ... The compiler handles a Pointer converted to a uintptr in the argument list of a call to a function implemented in assembly by arranging that the referenced allocated object, if any, is retained and not moved until the call completes ...

`syscall.Syscall` is implemented in assembly — the runtime *does* keep the pointer alive across that *single* call. But the moment the function returns, retention ends. If `b` has a finalizer that's racing the syscall return, it can fire while the kernel still has a stale view.

In practice with `syscall.Syscall` the per-call retention saves most code. But the moment you split the conversion across statements, or wrap the syscall in a helper, or interleave anything between the conversion and the call, the retention contract breaks.

**Fix:** Use `runtime.KeepAlive(b)` *after* the syscall to extend `b`'s reachability past the call:

```go
func (b *Buffer) WriteToFD(fd int) (int, error) {
    n, _, errno := syscall.Syscall(
        syscall.SYS_WRITE,
        uintptr(fd),
        uintptr(unsafe.Pointer(&b.data[0])),     // conversion in arg list
        uintptr(len(b.data)),
    )
    runtime.KeepAlive(b)                         // b reachable until here
    if errno != 0 { return 0, errno }
    return int(n), nil
}
```

`runtime.KeepAlive` (in `runtime/mfinal.go`) is a no-op at runtime — its sole purpose is to mark the variable as live to the compiler's escape analysis and the GC's reachability scan, anchoring it past the call. It costs nothing and prevents an entire class of unsafe bugs.

---

## Bug 6 — Reading `runtime.MemStats` in a loop without realising it requires STW

```go
import (
    "runtime"
    "time"
)

func memMonitor() {
    var m runtime.MemStats
    for {
        runtime.ReadMemStats(&m)                 // BUG: STW every tick
        log.Printf("heap_alloc=%d gc_count=%d", m.HeapAlloc, m.NumGC)
        time.Sleep(100 * time.Millisecond)
    }
}
```

**Observed behavior:** Application's p99 latency rises by 1-5 ms once `memMonitor` is enabled. Throughput on hot endpoints drops a few percent. `pprof` shows time spent in `runtime.stopTheWorld`.

<details><summary>Hint</summary>

How does `ReadMemStats` get a consistent snapshot of every per-P heap-stat counter at once? Look at the function in `runtime/mstats.go`. What does it call before reading?

</details>

**Diagnosis:** `runtime.ReadMemStats` stops the world to take a consistent snapshot. From `runtime/mstats.go`:

```go
func ReadMemStats(m *MemStats) {
    _ = m.Alloc                                  // nil check
    stw := stopTheWorld(stwReadMemStats)
    systemstack(func() {
        readmemstats_m(m)
    })
    startTheWorld(stw)
}
```

Per-P stats are kept lock-free and only reconciled to global counters at GC checkpoints. To produce a coherent `MemStats` value across all P's, `ReadMemStats` halts every goroutine, flushes per-P deltas, copies the global stats, and resumes. The pause is short (microseconds to low milliseconds depending on `GOMAXPROCS` and the worst-case syscall-exit latency) but it's a full STW.

Calling this ten times a second adds ten STW events per second to your latency profile. On a process serving 50k QPS, that's measurable in p99.

**Fix:** Read sparingly — once per scrape interval (Prometheus default 15s) is the right cadence:

```go
func memMonitor() {
    var m runtime.MemStats
    tick := time.NewTicker(15 * time.Second)
    for range tick.C {
        runtime.ReadMemStats(&m)
        log.Printf("heap_alloc=%d gc_count=%d", m.HeapAlloc, m.NumGC)
    }
}
```

For high-frequency observability, use the `runtime/metrics` package (Go 1.16+) — `metrics.Read` reads a single per-P counter at a time without STW. It's the modern replacement for `ReadMemStats` for monitoring:

```go
import "runtime/metrics"

samples := []metrics.Sample{
    {Name: "/memory/classes/heap/objects:bytes"},
    {Name: "/gc/cycles/total:gc-cycles"},
}
metrics.Read(samples)                            // no STW
```

---

## Bug 7 — CPU profile started but never stopped; file grows forever

```go
import "runtime/pprof"

func main() {
    f, _ := os.Create("cpu.prof")
    pprof.StartCPUProfile(f)                     // BUG: no StopCPUProfile
    // defer pprof.StopCPUProfile() omitted

    runApplication()
}
```

**Observed behavior:** `cpu.prof` grows at a steady rate (a few KB/s on a typical workload). Days later, the file is tens of GB and disk fills up. `go tool pprof cpu.prof` either rejects the file as malformed or takes minutes to load.

<details><summary>Hint</summary>

What is the CPU profiler doing in the background while it's running? Look at `runtime/cpuprof.go` — specifically the signal handler that fires every 10 ms. Where does each sample go? When does it stop being collected?

</details>

**Diagnosis:** `pprof.StartCPUProfile` enables the runtime's SIGPROF-based sampler: every 10ms of CPU time on every OS thread, the kernel delivers SIGPROF; the Go runtime captures the current stack and appends it to an in-memory ring buffer. A flusher goroutine drains the buffer to the output file periodically.

From `runtime/cpuprof.go`:

```go
func SetCPUProfileRate(hz int) {
    // ... starts the signal-driven sampler at hz Hz (100 Hz default)
}
```

Without `StopCPUProfile`, sampling never stops and the file never closes properly. Two consequences:

1. The flusher keeps appending samples forever. A long-running server accumulates megabytes per minute.
2. The pprof profile format has a header and a trailer. `StartCPUProfile` writes the header; `StopCPUProfile` writes the final symbol table and closes out the profile. Without `Stop`, `pprof` sees a file that's all body, no trailer — it may parse what it can or reject entirely.

The SIGPROF signal itself has a small but non-zero cost: ~1% overhead at the default 100 Hz, more if the sampler hits a thread inside a tight syscall and has to wait. Forever-on CPU profiling in production wastes CPU.

**Fix:** Always pair `Start` with `Stop`. The canonical idiom:

```go
func main() {
    f, err := os.Create("cpu.prof")
    if err != nil { log.Fatal(err) }
    defer f.Close()
    if err := pprof.StartCPUProfile(f); err != nil { log.Fatal(err) }
    defer pprof.StopCPUProfile()                 // critical

    runApplication()
}
```

For long-running services, expose pprof via `net/http/pprof` and let operators trigger profiles on demand (`go tool pprof http://host/debug/pprof/profile?seconds=30`) — the HTTP handler starts and stops the profiler per request, so leaks are impossible.

---

## Bug 8 — `runtime.NumGoroutine()` called from `init()`, assumed final

```go
var initialGoroutines int

func init() {
    initialGoroutines = runtime.NumGoroutine()   // BUG: main hasn't started
    log.Printf("baseline goroutines: %d", initialGoroutines)
}

func checkLeaks() {
    extra := runtime.NumGoroutine() - initialGoroutines
    if extra > 10 {
        log.Printf("goroutine leak: %d extra", extra)
    }
}
```

**Observed behavior:** `baseline goroutines: 1` printed at startup. Later, `checkLeaks` reports "leaks" of 3-5 goroutines even on a quiescent process. The numbers don't match what `pprof goroutine` shows in the running server.

<details><summary>Hint</summary>

What goroutines exist at the moment `init()` runs? When do the runtime's built-in goroutines (GC worker, finalizer, scavenger, timer) actually start? Look for `forcegchelper`, `bgsweep`, `runfinq` in `runtime/mgc.go` and `runtime/mfinal.go`.

</details>

**Diagnosis:** Package `init()` functions run on the main goroutine *before* `runtime.main` has finished setting up the runtime's auxiliary goroutines. From `runtime/proc.go`'s `main` function:

```go
func main() {
    // ...
    gcenable()                                   // starts GC worker, bgsweep
    // ...
    main_init_done = make(chan bool)
    // run user init functions
    doInit(&main_inittask)
    close(main_init_done)
    main_main()                                  // user's main()
}
```

`gcenable` (in `runtime/mgc.go`) spawns the background sweeper (`bgsweep`); `runfinq` is started lazily on first finalizer; the timer goroutine is per-P and spawned as P's come online; `forcegchelper` is started on first `runtime.GC` trigger. None of these exist when your `init()` runs.

So `NumGoroutine()` at `init()` time returns 1 (just main). At any later point — after the first GC, the first finalizer, the first `time.Sleep` — there will be several runtime-internal goroutines visible. Your "leak detector" reports them as leaks.

**Fix:** Take the baseline *after* the runtime has warmed up, not in `init`:

```go
var initialGoroutines atomic.Int64

func main() {
    // let runtime spin up its goroutines
    time.Sleep(50 * time.Millisecond)
    runtime.GC()                                 // force the GC workers to exist
    initialGoroutines.Store(int64(runtime.NumGoroutine()))

    runApplication()
}
```

Better: for leak detection in tests, use `go.uber.org/goleak` or `testing.M`-wrapped checks that snapshot *after* `m.Run()` and ignore known runtime goroutines by stack-prefix. `runtime.NumGoroutine()` alone is too blunt — it counts everything, including the ones you don't own.

---

## Bug 9 — `runtime/trace.Start` called twice; second call's error is silently ignored

```go
import "runtime/trace"

var tracing bool

func startTrace(path string) {
    f, _ := os.Create(path)
    trace.Start(f)                               // BUG: no error check, no idempotency
    tracing = true
}

// HTTP handler exposed to operators
func handleTrace(w http.ResponseWriter, r *http.Request) {
    startTrace(r.URL.Query().Get("path"))
    fmt.Fprintln(w, "tracing started")
}
```

**Observed behavior:** First call works; the trace file fills. Second call returns 200 to the HTTP client but the new trace file stays at 0 bytes. The original trace continues writing into the *first* file. Operators see "trace started" and wait — nothing arrives.

<details><summary>Hint</summary>

What does `trace.Start` return? What happens inside if tracing is already running? Read `runtime/trace/trace.go` and follow into `runtime/trace.go`'s `StartTrace`.

</details>

**Diagnosis:** `trace.Start` returns an error if tracing is already enabled. From `runtime/trace/trace.go`:

```go
func Start(w io.Writer) error {
    tracing.Lock()
    defer tracing.Unlock()
    if tracing.enabled {
        return errors.New("tracing is already enabled")
    }
    // ... set up writer, call runtime.StartTrace
}
```

The runtime maintains a single global trace state (`runtime/trace.go`'s `traceLock`, `trace.enabled`). The second `trace.Start` returns an error immediately without ever wiring up the new writer; the first writer keeps receiving events.

Ignoring the error masks the fact that the second `Start` did nothing. The caller is left wondering why the new file is empty.

**Fix:** Check the error. Implement `Stop`/`Start` cycling correctly:

```go
var (
    traceMu sync.Mutex
    traceF  *os.File
)

func startTrace(path string) error {
    traceMu.Lock()
    defer traceMu.Unlock()
    if traceF != nil {
        trace.Stop()
        traceF.Close()
        traceF = nil
    }
    f, err := os.Create(path)
    if err != nil { return err }
    if err := trace.Start(f); err != nil {
        f.Close()
        return err
    }
    traceF = f
    return nil
}

func stopTrace() {
    traceMu.Lock()
    defer traceMu.Unlock()
    if traceF == nil { return }
    trace.Stop()
    traceF.Close()
    traceF = nil
}
```

`net/http/pprof.Trace` handles the lifecycle for you and is the safer default for ops-exposed tracing.

---

## Bug 10 — `runtime.SetBlockProfileRate(1)`; one in one is the most aggressive setting

```go
import "runtime"

func init() {
    runtime.SetBlockProfileRate(1)               // BUG: every blocking event sampled
    runtime.SetMutexProfileFraction(1)           // same trap on the mutex side
}
```

**Observed behavior:** Service throughput drops 30-50% with no other change. `pprof` shows huge amounts of time in `runtime.chansend1`, `runtime.semacquire1`, and inside the profiler's own recording functions.

<details><summary>Hint</summary>

What does `SetBlockProfileRate(rate int)` mean — is `1` "1 Hz" or something else? Read the doc and follow into `runtime/mprof.go`'s `blocksampled` / `mutexevent`.

</details>

**Diagnosis:** The argument to `SetBlockProfileRate` is *not* a frequency. It's a *sampling threshold in nanoseconds* — or, equivalently, a 1-in-N sampling rate where smaller is more frequent. From the doc:

> SetBlockProfileRate controls the fraction of goroutine blocking events that are reported in the blocking profile. The profiler aims to sample an average of one blocking event per rate nanoseconds spent blocked. To include every blocking event in the profile, pass rate = 1.

So `1` means "record *every* blocking event, no matter how short". On a busy server with channel ops, mutex contention, and `time.Sleep` calls in the millions per second, every one of those events gets a stack trace captured, hashed, and stored. The profiler's hash table lock becomes the new contention bottleneck.

`SetMutexProfileFraction(1)` is the same trap on the mutex side: `1` means "1 in 1" = every mutex contention event sampled.

Reasonable production values: `SetBlockProfileRate(10000)` (sample one event per 10µs of cumulative block time on average) or higher; `SetMutexProfileFraction(100)` (1 in 100 contention events). Even those are usually only enabled when investigating a specific suspected contention problem.

`runtime/mprof.go`'s `blocksampled` runs cheaply when the cycles threshold is high; with `rate=1`, the cycles threshold is 1, so the check always succeeds and the full stack walk + hash + lock path runs on every block.

**Fix:** Pick a sampling rate. Keep it off by default; enable behind a debug flag:

```go
import (
    "flag"
    "runtime"
)

var blockProfRate = flag.Int("block-profile-rate", 0,
    "ns; <=0 disables, 10000 = once per 10µs of block time")

func init() {
    flag.Parse()
    if *blockProfRate > 0 {
        runtime.SetBlockProfileRate(*blockProfRate)
    }
}
```

For production "always on but cheap" telemetry, leave block/mutex profiling off and use distributed tracing (OpenTelemetry) plus per-handler timing histograms.

---

## Bug 11 — `runtime.Stack(buf, true)` with too-small buf; dump truncated silently

```go
import "runtime"

func crashHandler() {
    if r := recover(); r != nil {
        buf := make([]byte, 4096)                // BUG: too small for goroutine dump
        n := runtime.Stack(buf, true)
        log.Printf("PANIC: %v\nSTACK:\n%s", r, buf[:n])
        os.Exit(2)
    }
}
```

**Observed behavior:** On a panic in production, the log shows the panic message and a truncated stack — usually just the first few goroutines, with the actual panicking goroutine missing or cut off mid-frame. Debugging the panic requires guessing.

<details><summary>Hint</summary>

What does `runtime.Stack(buf, all bool) int` do when the dump doesn't fit? Does it return an error? Does it grow the buffer? Read its doc and `runtime/mprof.go`.

</details>

**Diagnosis:** `runtime.Stack(buf, all)` writes as many bytes as fit into `buf` and returns the count written. If the dump is larger than `buf`, the excess is *silently discarded* — no error, no indicator. From the doc:

> Stack formats a stack trace of the calling goroutine into buf and returns the number of bytes written to buf. If all is true, Stack formats stack traces of all other goroutines into buf after the trace for the current goroutine.

With `all=true`, the buffer must hold every goroutine's stack. On a production server with 10,000 goroutines, that's hundreds of KB to several MB. A 4 KB buffer holds maybe 5-10 goroutines.

Worse, the truncation happens mid-frame: the last line of the buffer is usually a half-printed PC or file path, and the *panicking* goroutine — typically the one you most need — is not necessarily the first one written. Go's runtime walks the goroutine list in scheduler order, not panic order.

`runtime/mprof.go`'s `Stack` calls `goroutineProfileWithLabels` which fills the buffer until it's full and stops. There's no second-pass "tell me how much I need."

**Fix:** Use a growable buffer. Double until it fits:

```go
func dumpAllStacks() []byte {
    buf := make([]byte, 1<<20)                   // start at 1 MiB
    for {
        n := runtime.Stack(buf, true)
        if n < len(buf) {
            return buf[:n]
        }
        buf = make([]byte, 2*len(buf))           // double and retry
    }
}

func crashHandler() {
    if r := recover(); r != nil {
        log.Printf("PANIC: %v\nSTACK:\n%s", r, dumpAllStacks())
        os.Exit(2)
    }
}
```

For *just* the current goroutine (`all=false`), 64 KB is almost always enough. For `all=true`, start at 1 MB and grow.

Alternative: write directly to a file via `pprof.Lookup("goroutine").WriteTo(f, 2)` — the `2` is the "full goroutine dump including stacks" mode and it streams to the writer without a fixed buffer.

---

## Bug 12 — Setting `GOMAXPROCS` in `init()` before reading the cgroup CPU quota

```go
import "runtime"

func init() {
    runtime.GOMAXPROCS(runtime.NumCPU())         // BUG: NumCPU sees host, not cgroup
}
```

**Observed behavior:** Containerised service runs on Kubernetes with `resources.limits.cpu: 2`. The node has 64 cores. The process sets `GOMAXPROCS=64`. The scheduler creates 64 P's, runs all 64 in parallel for short bursts, then the cgroup throttler suspends them for tens of milliseconds while quota replenishes. Latency p99 is terrible; CPU utilization on the cgroup is pegged at 100%.

<details><summary>Hint</summary>

What does `runtime.NumCPU` actually count? Look at `runtime/os_linux.go` — what syscall does it use? Does the result reflect the Linux cgroup CPU quota?

</details>

**Diagnosis:** `runtime.NumCPU` returns the number of logical CPUs visible to the process via `sched_getaffinity(2)` on Linux. From `runtime/os_linux.go`:

```go
func getproccount() int32 {
    // ... reads CPU affinity mask via sched_getaffinity
}
```

`sched_getaffinity` reflects the kernel's CPU set for the process — which Kubernetes does *not* restrict for the common `cpu` cgroup limit (CFS quota). The cgroup quota limits *how much CPU time per period* the process gets; it does not change the set of CPUs the process can be scheduled on. So `NumCPU` returns 64 on a 64-core host even with a 2-CPU CFS quota.

Setting `GOMAXPROCS=64` makes the runtime create 64 P's. The scheduler tries to run 64 goroutines in parallel. The CFS quota is consumed in 2 cores' worth of wall time, then the kernel throttles every thread in the cgroup until the next 100ms period — for tens of milliseconds at a time. Tail latency explodes.

The fix is to set `GOMAXPROCS` to match the *quota*, not the visible CPU count. Reading the cgroup's quota directly is annoying (different paths for cgroup v1 vs v2), so use the standard library's helper.

**Fix:** Use `automaxprocs` (Uber) or, since Go 1.25, the built-in `runtime.GOMAXPROCS(-1)`-respecting behavior driven by `GOMAXPROCS=` env var that supports the cgroup integration. The common pre-1.25 approach:

```go
import _ "go.uber.org/automaxprocs"               // sets GOMAXPROCS from cgroup at init time

func main() {
    log.Printf("GOMAXPROCS=%d", runtime.GOMAXPROCS(0))
    runApplication()
}
```

Or manually parse `/sys/fs/cgroup/cpu.max` (cgroup v2) and divide quota by period.

Setting it in `init()` is fine *if* the value is correct; the bug is reading `NumCPU` rather than the cgroup quota. `runtime/proc.go`'s default `GOMAXPROCS` (when unset) is `NumCPU`, which has the same problem — for containerized workloads always override.

---

## Bug 13 — `runtime.GC()` then expecting RSS to drop instantly

```go
import (
    "runtime"
    "runtime/debug"
)

func releaseMemory() {
    runtime.GC()                                 // BUG: doesn't return memory to OS
    // expected: ps shows lower RSS
    // actual:   ps shows same RSS
}
```

**Observed behavior:** A monitoring script triggers `releaseMemory` when a job finishes; immediately after, `ps -o rss` shows no change. Engineer concludes "GC is broken" and adds more aggressive calls, none of which help.

<details><summary>Hint</summary>

What does `runtime.GC()` do that's different from returning memory to the OS? What's the difference between heap-free spans and unmapped memory? Read `runtime/mheap.go`'s `scavenge` and `runtime/debug.FreeOSMemory`.

</details>

**Diagnosis:** Two distinct steps:

1. `runtime.GC()` runs a mark-and-sweep, marking now-unreachable objects as free. The memory is returned to the runtime's *heap allocator's free spans* — not to the OS.
2. The *scavenger* (`runtime/mgcscavenge.go`'s `bgscavenge`) gradually returns unused heap spans to the OS via `madvise(MADV_DONTNEED)` (Linux) or `MADV_FREE`. The scavenger runs in the background, paced to the runtime's memory-limit signal, and may take seconds to minutes to release a large chunk.

So after `runtime.GC()`, the *Go heap* has free space, but the kernel still accounts the pages against your process's RSS until the scavenger releases them and the kernel reclaims them.

To force immediate release, you need *both* steps: GC to free the heap objects, then `debug.FreeOSMemory` to run the scavenger synchronously. From `runtime/debug/garbage.go`:

```go
// FreeOSMemory forces a garbage collection followed by an
// attempt to return as much memory to the operating system as possible.
func FreeOSMemory() {
    freeOSMemory()
}
```

Internally `freeOSMemory` does `gcStart` + `scavenge(^uintptr(0))` — GC then a full sync scavenge.

Even after `FreeOSMemory`, RSS may not drop *instantly* depending on the platform:

- Linux `MADV_DONTNEED`: kernel zeroes the pages on next access; RSS drops in `top` immediately on most kernels.
- Linux `MADV_FREE` (default on 4.5+): kernel keeps pages mapped but lazily reclaimable; RSS only drops under memory pressure. `ps` still shows the high number.

To force the older, more visible-in-RSS behavior, set `GODEBUG=madvdontneed=1`.

**Fix:** Call both, and understand the platform:

```go
import (
    "runtime"
    "runtime/debug"
)

func releaseMemory() {
    runtime.GC()
    debug.FreeOSMemory()                         // also runs GC + scavenge
}
```

Even better: don't try to manage RSS manually. Set `debug.SetMemoryLimit` and let the runtime keep the process within budget automatically. Manual `FreeOSMemory` is a niche tool for batch jobs that have a clear "now is a good time to give back" moment.

---

## Bug 14 — `runtime/pprof` exposed on a public port without auth

```go
import (
    "net/http"
    _ "net/http/pprof"                           // BUG: registers handlers on DefaultServeMux
)

func main() {
    go func() {
        // expose admin port for ops
        http.ListenAndServe(":6060", nil)         // BUG: 0.0.0.0, no auth
    }()
    runApplication()
}
```

**Observed behavior:** Service runs fine for weeks. A security scan reports the `:6060` port is exposed to the internet (LB misconfig). Attacker hits `/debug/pprof/heap` and downloads a heap profile containing stack traces, function names, file paths, and string contents of recent allocations — effectively a snapshot of the program's recent activity, including possibly user data in unexported buffers. Worse, `/debug/pprof/profile?seconds=300` makes the server burn 5 minutes of CPU on sampling-and-symbolizing each request — an instant DoS amplifier.

<details><summary>Hint</summary>

What does `import _ "net/http/pprof"` actually do at init? Where does it register handlers? What's reachable at `/debug/pprof/`?

</details>

**Diagnosis:** Importing `net/http/pprof` for its side effect registers debugging handlers on `http.DefaultServeMux`. From `net/http/pprof/pprof.go`:

```go
func init() {
    http.HandleFunc("/debug/pprof/", Index)
    http.HandleFunc("/debug/pprof/cmdline", Cmdline)
    http.HandleFunc("/debug/pprof/profile", Profile)
    http.HandleFunc("/debug/pprof/symbol", Symbol)
    http.HandleFunc("/debug/pprof/trace", Trace)
}
```

If anywhere in the program `http.ListenAndServe(addr, nil)` is called with `nil` (meaning `DefaultServeMux`) on a public interface, the pprof endpoints are live for the world. The exposure:

- `/debug/pprof/heap`: complete heap profile with function/file/line for every allocation site. Reveals code structure, library versions, sometimes string contents.
- `/debug/pprof/goroutine?debug=2`: full goroutine stacks. Reveals every concurrent operation in progress — including in-flight request URLs if held in stack-local variables.
- `/debug/pprof/profile?seconds=N`: starts a CPU profile for N seconds. An attacker can request `seconds=3600` repeatedly, each one running the SIGPROF sampler for an hour, eating real CPU.
- `/debug/pprof/cmdline`: full `os.Args`. Often contains config paths, secrets accidentally on the command line, or hostnames.
- `/debug/pprof/symbol`: symbolisation oracle — turns PC values into function names + file:line.

These are not "debug info"; they are a forensic surface and a DoS amplifier.

**Fix:** Bind to localhost, or use a separate mux that is reachable only from inside the cluster:

```go
import (
    "net/http"
    "net/http/pprof"
)

func main() {
    pprofMux := http.NewServeMux()
    pprofMux.HandleFunc("/debug/pprof/", pprof.Index)
    pprofMux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
    pprofMux.HandleFunc("/debug/pprof/profile", pprof.Profile)
    pprofMux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
    pprofMux.HandleFunc("/debug/pprof/trace", pprof.Trace)

    go func() {
        // localhost-only; reached via kubectl port-forward or SSH tunnel
        log.Fatal(http.ListenAndServe("127.0.0.1:6060", pprofMux))
    }()

    // public API on a separate mux with its own auth
    apiMux := http.NewServeMux()
    apiMux.HandleFunc("/v1/", apiHandler)
    log.Fatal(http.ListenAndServe(":8080", apiMux))
}
```

Belt and braces: put pprof behind authentication middleware (mTLS, bearer token from a vault, SPIFFE). Never rely on "we'll remember to firewall it"; the default should be unreachable.

Also: never use `http.DefaultServeMux` for the public listener. Once *any* dependency imports `net/http/pprof` (or `expvar`), `DefaultServeMux` is contaminated. Always create your own `*http.ServeMux`.

---

## Summary

These bugs cluster into four families.

**Lifecycle and timing (1, 2, 3, 7, 9):** finalizers that never fire because they pin their own object; finalizers used in place of explicit `Close`; OS threads burned when locked goroutines exit; CPU profiles that grow forever because `Stop` was forgotten; traces double-started with the error swallowed. The `runtime` package brokers between you and the GC/scheduler/profiler — every "start" needs a matching "stop", and every callback runs on the runtime's timeline, not yours.

**Cost not visible at the call site (4, 6, 10):** `runtime.GC()` invoked manually; `ReadMemStats` polled every 100ms; block/mutex profile rate set to `1`. These look like single function calls; each one is a STW or per-event hot-path tax. Read the implementation in `runtime/mgc.go`, `runtime/mstats.go`, `runtime/mprof.go` once and you stop reaching for them.

**Pointer safety and platform reality (5, 12, 13):** `unsafe.Pointer` → `uintptr` for syscalls without `KeepAlive`; `NumCPU` instead of the cgroup quota; `GC()` instead of `FreeOSMemory` plus scavenger reality. The runtime's contract is precise; the OS's contract is messier; gaps between them are where bugs live.

**Operational exposure (8, 11, 14):** `NumGoroutine` in `init` returning a meaningless baseline; `Stack(buf, true)` silently truncating; pprof on a public port. These don't crash anything — they quietly lie about the system or hand it to whoever asks.

Review checklist for any PR touching `runtime`, `runtime/debug`, `runtime/pprof`, or `runtime/trace`:

- [ ] Every `SetFinalizer` closure uses the parameter, never the outer variable. The function does not reference the object it's attached to, directly or transitively.
- [ ] No finalizer is the *primary* mechanism for releasing a non-heap resource (FDs, sockets, kernel handles, locks). Explicit `Close`/`defer` at the call site, finalizer only as backstop.
- [ ] Every `runtime.LockOSThread` is paired with `runtime.UnlockOSThread`, ideally via `defer`. Goroutines that exit while locked do so deliberately, with comments explaining why the M should be destroyed.
- [ ] No `runtime.GC()` calls outside benchmarks and tests. Memory pressure tuned via `GOGC` or `debug.SetMemoryLimit`.
- [ ] After `unsafe.Pointer` is converted to `uintptr` for a syscall (or any non-Go consumer), `runtime.KeepAlive(holder)` follows the call to anchor the lifetime.
- [ ] `runtime.ReadMemStats` is *not* called on a hot loop. High-frequency observability uses `runtime/metrics` instead.
- [ ] Every `pprof.StartCPUProfile` is paired with `defer pprof.StopCPUProfile()`; every `trace.Start` is paired with `trace.Stop` and the `Start` error is checked.
- [ ] `runtime.NumGoroutine` baselines are taken after main is running and the runtime is warm, not in `init`.
- [ ] `runtime.SetBlockProfileRate` and `runtime.SetMutexProfileFraction` are off by default; turned on with values appropriate to the host (`rate=10000` block, `fraction=100` mutex are reasonable starting points) and behind a flag.
- [ ] `runtime.Stack(buf, true)` uses a growable buffer (start ≥1 MiB, double on overflow), or routes through `pprof.Lookup("goroutine").WriteTo(w, 2)`.
- [ ] `GOMAXPROCS` in containerised deployments reads the cgroup quota (`automaxprocs` or equivalent), not `runtime.NumCPU`.
- [ ] Code that wants RSS to drop calls *both* `runtime.GC()` and `debug.FreeOSMemory()` and understands platform-specific `MADV_FREE` semantics.
- [ ] `net/http/pprof` is bound to localhost or behind authentication. The public listener uses a private `*http.ServeMux`, never `DefaultServeMux`.

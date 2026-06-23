# `LockOSThread` Performance — Find the Bug

> Each scenario presents code that compiles and runs but contains a pinning-related performance bug. Read the code; identify the bug; then check the analysis. The bugs are drawn from real production incidents, simplified for brevity.

## Table of Contents

1. [Bug 1: Per-Request Pinning](#bug-1-per-request-pinning)
2. [Bug 2: Missing `UnlockOSThread`](#bug-2-missing-unlockosthread)
3. [Bug 3: Pin in a Library Function](#bug-3-pin-in-a-library-function)
4. [Bug 4: Pin on `main` for No Reason](#bug-4-pin-on-main-for-no-reason)
5. [Bug 5: Pinned Worker Without Initialisation Sync](#bug-5-pinned-worker-without-initialisation-sync)
6. [Bug 6: Per-Job Worker Spawn](#bug-6-per-job-worker-spawn)
7. [Bug 7: Pin + sync.Mutex Deadlock](#bug-7-pin--syncmutex-deadlock)
8. [Bug 8: Lost Reply on Context Cancel](#bug-8-lost-reply-on-context-cancel)
9. [Bug 9: Pool Where `GOMAXPROCS == pinned`](#bug-9-pool-where-gomaxprocs--pinned)
10. [Bug 10: Pinned Worker Holding a Lock](#bug-10-pinned-worker-holding-a-lock)
11. [Bug 11: Mismatched Lock Counts](#bug-11-mismatched-lock-counts)
12. [Bug 12: Pin + Goroutine Leak](#bug-12-pin--goroutine-leak)
13. [Wrap-up](#wrap-up)

---

## Bug 1: Per-Request Pinning

```go
func handler(w http.ResponseWriter, r *http.Request) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()

    result := C.compute(C.int(parseInt(r.URL.Query().Get("n"))))
    fmt.Fprintln(w, int(result))
}
```

**Symptom.** Under load, `process_threads_total` climbs from ~10 to ~200 within seconds. p99 latency degrades. CPU shows kernel-time spikes.

**Bug.** Each request pins the handler goroutine, retiring one M for the request's duration. The handler is on the HTTP server's goroutine, so each connection pins one M. The runtime grows new Ms via `clone(2)` to keep serving; under sustained load the M count tracks concurrent request count.

**Fix.** Refactor to a single-owner pool. The handler submits via a channel; the worker (long-lived, pinned) does the cgo call.

```go
type ComputeWorker struct {
    in chan computeJob
}

var workerPool = NewComputePool(4)

func handler(w http.ResponseWriter, r *http.Request) {
    n := parseInt(r.URL.Query().Get("n"))
    result := workerPool.Submit(n)
    fmt.Fprintln(w, result)
}
```

Thread count drops to baseline + 4.

---

## Bug 2: Missing `UnlockOSThread`

```go
func computeOnDevice(deviceID int, input []float32) ([]float32, error) {
    runtime.LockOSThread()
    // ... forgot defer runtime.UnlockOSThread()
    if err := C.cuda_set_device(C.int(deviceID)); err != 0 {
        return nil, fmt.Errorf("set_device: %d", err)
    }
    return runKernel(input)
}
```

**Symptom.** Thread count grows by one per call to `computeOnDevice`. The function is called from many goroutines; M count climbs unboundedly.

**Bug.** The pin is never released. Every caller's goroutine ends up pinned. When goroutines die (return from their function), they exit while locked, destroying the M. The runtime spawns a new M, but the cost is amortized over time — at high rate the destruction-creation cycle dominates the syscall overhead.

**Fix.** Either add `defer runtime.UnlockOSThread()`, or refactor to a single-owner worker:

```go
// Correct: defer unlock right after lock.
func computeOnDevice(deviceID int, input []float32) ([]float32, error) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    // ...
}
```

But better: don't pin the caller. Use a pool of pinned workers, each owning a device, and have the caller submit through a channel.

---

## Bug 3: Pin in a Library Function

```go
// In package thirdparty:
func RunGPUOp(input []float32) ([]float32, error) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    return cudaCall(input)
}
```

**Symptom.** Consumers of the library report `process_threads_total` growing under load. The library is imported by many services; multiple ones report the same issue.

**Bug.** The library pins the caller's goroutine. Callers do not expect this and have no mechanism to limit concurrency. At high RPS, every concurrent caller is pinned.

**Fix.** The library should not pin caller goroutines. It should provide a worker abstraction:

```go
package thirdparty

type GPUWorker struct {
    in chan job
}

func NewGPUWorker() *GPUWorker {
    w := &GPUWorker{in: make(chan job, 16)}
    go func() {
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()
        cudaInit()
        defer cudaShutdown()
        for j := range w.in {
            j.reply <- cudaCall(j.input)
        }
    }()
    return w
}

func (w *GPUWorker) Run(input []float32) ([]float32, error) {
    reply := make(chan result, 1)
    w.in <- job{input: input, reply: reply}
    r := <-reply
    return r.output, r.err
}
```

The pin is encapsulated. Callers stay unpinned.

---

## Bug 4: Pin on `main` for No Reason

```go
func main() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    server := http.Server{Addr: ":8080", Handler: routes()}
    log.Fatal(server.ListenAndServe())
}
```

**Symptom.** `process_threads_total` is `baseline + 1`. The service runs but one M is permanently idle, serving only the `ListenAndServe` waiting goroutine.

**Bug.** The pin retires the M that runs `main`. Since `main` mostly blocks waiting for the server to return, that M is wasted. Other Ms handle the actual work.

**Fix.** Remove the pin. `main` does not need pinning for a typical server. macOS GUI apps are the exception, not the rule.

```go
func main() {
    server := http.Server{Addr: ":8080", Handler: routes()}
    log.Fatal(server.ListenAndServe())
}
```

---

## Bug 5: Pinned Worker Without Initialisation Sync

```go
type Worker struct {
    in chan Job
}

func New() *Worker {
    w := &Worker{in: make(chan Job, 16)}
    go func() {
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()
        if err := C.init_resource(); err != 0 {
            log.Fatal(err)
        }
        for j := range w.in {
            j.reply <- process(j)
        }
    }()
    return w
}

func main() {
    w := New()
    result := w.Submit(42)  // SOMETIMES this fails
}
```

**Symptom.** Intermittent failures: the first `Submit` succeeds usually, but occasionally the worker has not yet initialised when the call lands, leading to a panic in `process` or an undefined-state cgo crash.

**Bug.** `New()` returns before the worker is ready. The pinned goroutine starts running concurrently with the caller, and the first `Submit` may queue a job before `C.init_resource()` completes.

**Fix.** Add a readiness signal.

```go
func New() *Worker {
    w := &Worker{in: make(chan Job, 16)}
    ready := make(chan struct{})
    go func() {
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()
        if err := C.init_resource(); err != 0 {
            close(ready) // closed without error signal; caller sees zero
            log.Fatal(err)
        }
        close(ready)
        for j := range w.in {
            j.reply <- process(j)
        }
    }()
    <-ready
    return w
}
```

Better: propagate the init error too, via an `error` channel.

---

## Bug 6: Per-Job Worker Spawn

```go
func processJob(j Job) Result {
    reply := make(chan Result, 1)
    go func() {
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()
        reply <- runCgo(j)
    }()
    return <-reply
}
```

**Symptom.** Every call to `processJob` creates a new goroutine that pins itself, runs once, then dies. M-pool churn destroys throughput at high rates.

**Bug.** Pinning is used as a per-call optimisation, but the pin is the slow path: the goroutine dies while locked, destroying the M (`pthread_exit`); the next call creates a new M (`clone`).

**Fix.** Long-lived pinned worker. Caller's goroutine should not pin.

```go
var theWorker = NewWorker()

func processJob(j Job) Result {
    return theWorker.Submit(j)
}
```

---

## Bug 7: Pin + sync.Mutex Deadlock

```go
type Service struct {
    mu sync.Mutex
    worker *Worker
}

func (s *Service) Do(j Job) Result {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.worker.Submit(j)
}

// elsewhere, in the worker's loop:
//   ... receives j; for some reason needs to call s.Do(other-j) ...
```

**Symptom.** Service hangs after a few minutes. `pprof goroutine?debug=2` shows the worker parked waiting on `s.mu`; many handler goroutines parked waiting for the worker's reply.

**Bug.** The worker's loop tries to re-enter the same mutex held by the caller. Classic deadlock; pinning doesn't change the mechanism but can hide the fault because the worker is "supposed to be running" — debugging is harder.

**Fix.** Either:

- Don't share the mutex across the worker/caller boundary.
- Use a different synchronisation primitive (e.g., the channel itself serialises).
- Refactor so the worker never calls back into the API.

Generally: pinned workers should *only* read jobs from a channel and write results. They should not call into the rest of the service.

---

## Bug 8: Lost Reply on Context Cancel

```go
func (w *Worker) Submit(ctx context.Context, in int) (int, error) {
    reply := make(chan int)  // note: unbuffered
    select {
    case w.in <- Job{Input: in, Reply: reply}:
    case <-ctx.Done():
        return 0, ctx.Err()
    }
    select {
    case r := <-reply:
        return r, nil
    case <-ctx.Done():
        return 0, ctx.Err()
    }
}
```

**Symptom.** Worker eventually blocks. Profile shows the worker stuck in `w.reply <- ...`. New submissions backlog.

**Bug.** Reply channel is unbuffered. When the caller's `ctx` is canceled before the worker sends, the worker's send blocks forever (the caller is gone).

**Fix.** Make reply buffered with capacity 1. The worker can always send; the caller may not read, but the channel is GC'd when both ends go out of scope.

```go
reply := make(chan int, 1)
```

This is a general rule for the single-owner pattern: per-job reply channels should have buffer 1 so the worker is never blocked sending.

---

## Bug 9: Pool Where `GOMAXPROCS == pinned`

```go
// in init or main:
//   runtime.GOMAXPROCS(4)
// pool of 4 pinned workers
```

**Symptom.** Service runs OK at low load. Under load, p99 latency for non-worker work (HTTP routing, downstream calls, logging) skyrockets even though CPU is at 60%.

**Bug.** Effective `GOMAXPROCS` for non-pinned work is `4 − 4 = 0`. The runtime spawns extra Ms to keep going, but the kernel scheduler now has to multiplex many Ms onto 4 cores, which adds context-switch cost. Most importantly, the runtime cannot run pure-Go scheduling decisions on a P if no P is available.

**Fix.** Raise `GOMAXPROCS` to give headroom: `pinned + max(non_pinned_GOMAXPROCS)`. For this pool, `GOMAXPROCS=8` is comfortable.

Add a startup check:

```go
if runtime.GOMAXPROCS(0) <= pinnedCount {
    log.Fatalf("GOMAXPROCS=%d not sufficient for %d pinned workers",
        runtime.GOMAXPROCS(0), pinnedCount)
}
```

---

## Bug 10: Pinned Worker Holding a Lock

```go
func (w *Worker) loop() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    w.mu.Lock()
    defer w.mu.Unlock()
    for j := range w.in {
        // process j
    }
}
```

**Symptom.** Other code paths that try to acquire `w.mu` block until the worker stops, which never happens during normal operation.

**Bug.** The worker holds the mutex for its lifetime. Any external code trying to introspect the worker (e.g., a health check that grabs `w.mu` to read state) deadlocks.

**Fix.** Don't hold the lock across the entire loop. Acquire and release as needed for short critical sections:

```go
func (w *Worker) loop() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    for j := range w.in {
        w.mu.Lock()
        state := w.state
        w.mu.Unlock()
        // process j with state
    }
}
```

Better: pinned workers should communicate via channels, not shared mutexed state.

---

## Bug 11: Mismatched Lock Counts

```go
func suspicious(ctx context.Context, in int) (int, error) {
    runtime.LockOSThread()
    if in < 0 {
        return 0, errors.New("negative")  // forgot to unlock
    }
    defer runtime.UnlockOSThread()
    // ... rest
}
```

**Symptom.** The first call with negative `in` returns the error; the caller's goroutine is now pinned, but the calling code does not know. Subsequent operations on the same goroutine run on the pinned M, possibly with unexpected performance characteristics.

**Bug.** The early return skips the `defer`. (Actually `defer` placed after `Lock` is the issue — moves below the return, but the return is before the defer registration.)

**Fix.** Always pair Lock with defer Unlock *immediately*:

```go
func suspicious(ctx context.Context, in int) (int, error) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    if in < 0 {
        return 0, errors.New("negative")
    }
    // ...
}
```

Or, even better, don't pin caller goroutines.

---

## Bug 12: Pin + Goroutine Leak

```go
func (s *Service) StartWorker() {
    go func() {
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()
        for {
            select {
            case j := <-s.in:
                process(j)
            }
        }
    }()
}
```

**Symptom.** Every time `StartWorker` is called, thread count grows by 1 and never recovers. Eventually `process_threads_total` hits `debug.SetMaxThreads`' default (10 000) and the program aborts.

**Bug.** No shutdown mechanism. Each `StartWorker` call spawns a new pinned worker that never exits. If `StartWorker` is called from a hot path (a test loop, a misconfigured init), pinned workers accumulate.

**Fix.** Add a stop channel and document that `StartWorker` should be called once.

```go
type Service struct {
    in   chan Job
    stop chan struct{}
}

func (s *Service) StartWorker() {
    go func() {
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()
        for {
            select {
            case j := <-s.in:
                process(j)
            case <-s.stop:
                return
            }
        }
    }()
}
```

Better: enforce once-only invocation at the API level (`sync.Once` or returning an error on second call).

---

## Wrap-up

The common pinning bugs reduce to a few patterns:

- **Per-request / per-call pinning** is the single most common bug. Always refactor to a pool.
- **Forgotten `UnlockOSThread`** silently pins more and more goroutines. Always pair with `defer`.
- **Library functions that pin the caller** is a special case of per-request pinning. Encapsulate.
- **Missing initialisation sync** causes intermittent failures. Use a readiness channel.
- **Mismatched lock counts** or unprotected early returns leave pinned state stuck. Pair `Lock` with `defer Unlock` immediately, in the same function.
- **Capacity mistakes** (pinned >= `GOMAXPROCS`) starve the runtime. Plan headroom.
- **Locking inside pinned workers** introduces deadlock risk. Use channels.
- **Unbounded worker spawns** with no shutdown mechanism leak Ms. Always design lifecycle.

The diagnostic toolkit:

1. `process_threads_total` (or `/sched/threads:threads`): rising count is the canary.
2. `pprof goroutine?debug=2`: stacks parked at `runtime.gopark` after `LockOSThread` reveal pinning.
3. `GODEBUG=scheddetail=1,schedtrace=1000`: per-M state, including `lockedg=<id>`.
4. `runtime/trace`: visualises pinned-M behaviour over time.
5. Static analysis (custom `go vet`): flags `LockOSThread` in HTTP handlers and similar anti-patterns.

The optimize page works the same patterns from the other direction: given a working but suboptimal program, improve it.

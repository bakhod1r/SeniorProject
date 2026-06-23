# `LockOSThread` Performance — Optimization Exercises

> Each exercise presents a working but suboptimal program, a target metric, and asks you to improve it. Solutions at the end. The goal is to internalise pinning's cost model and apply it when tuning real systems.

## Table of Contents

1. [Easy](#easy)
2. [Medium](#medium)
3. [Hard](#hard)
4. [Solutions](#solutions)
5. [Wrap-up](#wrap-up)

---

## Easy

### Exercise 1 — Remove a vestigial pin

**Starting code:**

```go
package main

import (
    "fmt"
    "runtime"
)

func compute(n int) int {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    sum := 0
    for i := 0; i < n; i++ {
        sum += i
    }
    return sum
}

func main() {
    for i := 0; i < 10000; i++ {
        _ = compute(1000)
    }
    fmt.Println("done")
}
```

**Baseline.** `process_threads_total` ~8; throughput ~10K calls/s.

**Target.** Throughput ≥ 20K calls/s; thread count baseline only.

**Constraints.** `compute` may not be inlined into `main`. Keep the same function signature.

---

### Exercise 2 — Hoist initialisation out of the hot path

**Starting code:**

```go
package gpu

/* #include "gpu.h" */
import "C"

func Compute(in []float32) []float32 {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    C.cuda_init()
    defer C.cuda_shutdown()
    return runKernel(in)
}
```

**Baseline.** Every call pays init + shutdown overhead (~10 ms each). Throughput is bound to ~50 calls/s.

**Target.** Throughput ≥ 1000 calls/s. Init runs once.

---

### Exercise 3 — Replace per-request pinning with a pool

**Starting code:**

```go
func handler(w http.ResponseWriter, r *http.Request) {
    go func() {
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()
        out := C.process_request()
        w.Write(out)  // assume synchronous reply
    }()
}
```

**Baseline.** Thread count rises with concurrency.

**Target.** Thread count capped at `4 + baseline`.

---

### Exercise 4 — Add a readiness signal

**Starting code:**

```go
func NewWorker() *Worker {
    w := &Worker{in: make(chan Job, 16)}
    go w.loop()
    return w
}
```

**Symptom.** First few jobs sometimes panic because `loop`'s init has not completed.

**Target.** `NewWorker` returns only after the worker has initialised.

---

### Exercise 5 — Convert per-call reply allocation to a pool

**Starting code:**

```go
func (w *Worker) Submit(in int) int {
    reply := make(chan int, 1)
    w.in <- Job{Input: in, Reply: reply}
    return <-reply
}
```

**Baseline.** Each call allocates a channel. At 1M calls/s, pprof `alloc_objects` shows channel allocation in the top 5.

**Target.** Zero allocation per call. Maintain correctness.

---

## Medium

### Exercise 6 — Build a 4-GPU dispatch pool

**Starting code:** a single pinned worker for one GPU.

**Target.**

- 4 pinned workers, one per device.
- Dispatcher routes to least-loaded worker.
- Backpressure via `context.Context`.
- Total M count is `baseline + 4`.

---

### Exercise 7 — Bound cgo concurrency without pinning

**Starting code:**

```go
func Do(in []byte) []byte {
    return C.compress(in)
}
```

**Baseline.** At high concurrency, thread count climbs (Go creates Ms while cgo is in flight). 1000 RPS spawns ~500 Ms.

**Target.** Bound to 16 Ms held in cgo at a time. No pinning required (the library is thread-safe).

---

### Exercise 8 — Replace `LockOSThread`-based serialisation with `sync.Mutex`

**Starting code:**

```go
// Author thought pinning would serialise access. It doesn't.
func Increment() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    counter++
}
```

**Bug to fix.** Pinning does not give exclusive memory access; there is a race.

**Target.** Correct + faster than the pinned version.

---

### Exercise 9 — Pin only when needed

**Starting code:**

```go
func processBatch(batch []Item) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    setup := analyse(batch)        // pure Go
    cudaCall := runCuda(setup)     // cgo, thread-affine
    log := postprocess(cudaCall)   // pure Go
    writeLog(log)                  // pure Go
}
```

**Observation.** Only `runCuda` requires pinning. `analyse`, `postprocess`, `writeLog` benefit from the scheduler's flexibility.

**Target.** Move pinning to a sub-section. Measure throughput before/after.

---

### Exercise 10 — Stabilise thread count under bursty load

**Starting code:**

```go
func Work(in int) int {
    var result int
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()
        result = C.cgo_call(C.int(in))
        wg.Done()
    }()
    wg.Wait()
    return result
}
```

**Baseline.** Thread count oscillates between 10 and 200 every minute under bursty load.

**Target.** Stable at `baseline + N` where N is the pool size.

---

### Exercise 11 — NUMA-aware deployment

**Starting code:** a Go service with 4 GPU workers, `GOMAXPROCS=8`, running on a 32-CPU 2-socket NUMA box. GPU 0 and 1 are on socket 0; GPU 2 and 3 on socket 1.

**Baseline.** Throughput is lower than expected. `perf stat` shows high cross-socket cache traffic.

**Target.** Reduce cross-socket traffic; raise throughput by ≥ 15%.

---

### Exercise 12 — Add observability to a pinned pool

**Starting code:** working pool with no observability.

**Target.**

- Per-worker queue depth metric.
- pprof labels per worker.
- `process_threads_total` metric.
- Alert on thread count > `baseline + pool_size + 5`.

---

## Hard

### Exercise 13 — Migrate a thread-per-request pattern to a pinned pool

**Starting code:** Service has 200 lines of code with `runtime.LockOSThread` scattered across handlers and middleware. Thread count under load is in the thousands.

**Target.**

- Identify all `LockOSThread` call sites.
- Determine which are necessary (cgo with thread-affine APIs) vs vestigial.
- Migrate the necessary ones to a single-owner pool architecture.
- Remove the rest.
- Verify thread count drops to baseline + pool size.
- Verify behaviour unchanged via integration tests.

---

### Exercise 14 — Adaptive pool sizing

**Target.** Build a pool that:

- Starts with `min` pinned workers.
- Scales up to `max` workers if queue depth > 100 for > 1 s.
- Scales down to `min` if no workers had work for > 30 s.
- Tracks scale events.
- Each worker is pinned at start, unpinned at exit.

Compare against a fixed-size pool under bursty load.

---

### Exercise 15 — Avoid the M churn of "exit-while-locked"

**Starting code:**

```go
func RunOnce() {
    runtime.LockOSThread()
    // no defer Unlock
    doThing()
    // goroutine exits while locked; M is destroyed
}
```

**Baseline.** Called 1000 times per second; M creation/destruction rate is ~1000/s; `clone(2)` shows up in `perf top`.

**Target.** Reduce M churn to near zero.

---

### Exercise 16 — Replace cgo + pinning with WebAssembly

**Starting code:** a worker that calls a small C compression library via cgo, pinned.

**Target.** Embed the C library as WebAssembly using `wazero`. No cgo, no pinning. Per-call overhead drops; thread count drops by `pool_size`.

---

### Exercise 17 — Combine pinning with CPU affinity for tail latency

**Starting code:** trading-style service where p99.9 latency is 5 ms but spikes to 20 ms occasionally.

**Target.** Pin one critical-path goroutine and bind its M to a specific CPU set (isolated from interrupts and other Go work). Reduce p99.9 to < 3 ms.

Requires Linux, `isolcpus` kernel parameter ideally, or `nohz_full`.

---

### Exercise 18 — Build a circuit breaker around a pinned pool

**Target.**

- Wrap a pinned-worker pool with a circuit breaker.
- If a worker panics more than 3 times in 60 s, mark it failed.
- Restart the worker (creates a new M, releases the old M's exit).
- If > half the pool is failed, refuse new work until the supervisor confirms health.

---

### Exercise 19 — Diagnose and fix a "main loop pinned" service

**Scenario.** A service was originally a GUI app that pinned `main` for OpenGL. The GUI was removed two years ago but the `runtime.LockOSThread()` in `init` remained. Now the service is a headless RPC server.

**Target.**

- Diagnose the unjustified pin.
- Verify removal is safe.
- Remove the pin.
- Measure thread count and per-request latency before/after.

---

### Exercise 20 — Build the audit lint rule

**Target.** Write a `go vet`-style analyser (`golang.org/x/tools/go/analysis`) that flags:

- `runtime.LockOSThread` in functions with HTTP handler signature.
- `runtime.LockOSThread` in functions called transitively from HTTP handlers.
- `runtime.LockOSThread` without a matching `defer runtime.UnlockOSThread()` in the same function body.

Allow override via `// lockosthread:allow <reason>` comment.

---

## Solutions

### Solution 1 — Remove vestigial pin

```go
func compute(n int) int {
    sum := 0
    for i := 0; i < n; i++ {
        sum += i
    }
    return sum
}
```

`runtime.LockOSThread` was added "for safety" by an earlier engineer but the function uses no thread-local state. Removing it lets the scheduler optimise. Throughput rises ~2× because M-pool churn is eliminated.

---

### Solution 2 — Hoist init

```go
package gpu

type Worker struct {
    in chan Job
}

func New() *Worker {
    w := &Worker{in: make(chan Job, 16)}
    ready := make(chan struct{})
    go func() {
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()
        if rc := C.cuda_init(); rc != 0 {
            close(ready)
            return
        }
        defer C.cuda_shutdown()
        close(ready)
        for j := range w.in {
            j.Reply <- runKernel(j.Input)
        }
    }()
    <-ready
    return w
}
```

Init runs once, per worker, on the pinned thread. Per-call overhead drops to the channel send + the C call.

---

### Solution 3 — Pool replacement

```go
var pool = newComputePool(4)

func handler(w http.ResponseWriter, r *http.Request) {
    result := pool.Submit(context.Background(), r)
    w.Write(result)
}

type computePool struct {
    workers []*Worker
    next    atomic.Uint64
}

func newComputePool(n int) *computePool {
    p := &computePool{workers: make([]*Worker, n)}
    for i := 0; i < n; i++ {
        p.workers[i] = New()
    }
    return p
}

func (p *computePool) Submit(ctx context.Context, r *http.Request) []byte {
    idx := p.next.Add(1) % uint64(len(p.workers))
    return p.workers[idx].Submit(ctx, r)
}
```

Thread count flat at baseline + 4.

---

### Solution 4 — Readiness signal

```go
func NewWorker() *Worker {
    w := &Worker{in: make(chan Job, 16)}
    ready := make(chan error, 1)
    go w.loop(ready)
    if err := <-ready; err != nil {
        log.Fatal(err)
    }
    return w
}

func (w *Worker) loop(ready chan<- error) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    if err := initResource(); err != nil {
        ready <- err
        return
    }
    ready <- nil
    for j := range w.in {
        j.Reply <- process(j)
    }
}
```

First Submit is now safe.

---

### Solution 5 — Reply channel pool

```go
var replyPool = sync.Pool{
    New: func() interface{} { return make(chan int, 1) },
}

func (w *Worker) Submit(in int) int {
    reply := replyPool.Get().(chan int)
    w.in <- Job{Input: in, Reply: reply}
    result := <-reply
    replyPool.Put(reply)
    return result
}
```

Each reply channel buffered 1, reused via `sync.Pool`. Important: must consume the reply before returning the channel.

---

### Solution 6 — 4-GPU dispatch pool

```go
type GPUPool struct {
    workers []*GPUWorker
}

func NewGPUPool(n int) *GPUPool {
    p := &GPUPool{workers: make([]*GPUWorker, n)}
    for i := 0; i < n; i++ {
        p.workers[i] = NewGPUWorker(i)
    }
    return p
}

func (p *GPUPool) Submit(ctx context.Context, j Job) (Result, error) {
    idx := p.leastLoaded()
    return p.workers[idx].SubmitCtx(ctx, j)
}

func (p *GPUPool) leastLoaded() int {
    minIdx := 0
    minLen := len(p.workers[0].in)
    for i, w := range p.workers {
        if l := len(w.in); l < minLen {
            minIdx = i
            minLen = l
        }
    }
    return minIdx
}
```

---

### Solution 7 — Bound cgo concurrency

```go
var cgoSlots = make(chan struct{}, 16)

func Do(in []byte) []byte {
    cgoSlots <- struct{}{}
    defer func() { <-cgoSlots }()
    return []byte(C.compress(in))
}
```

No pinning needed because the library is thread-safe; just bound the concurrent cgo calls.

---

### Solution 8 — Replace pin with mutex

```go
var counterMu sync.Mutex
var counter int

func Increment() {
    counterMu.Lock()
    counter++
    counterMu.Unlock()
}
```

Or atomic:

```go
var counter atomic.Int64
func Increment() { counter.Add(1) }
```

Atomic is ~25× faster than mutex; ~250× faster than pinning.

---

### Solution 9 — Pin only the cgo step

```go
func processBatch(batch []Item) {
    setup := analyse(batch)
    cudaCall := w.SubmitCuda(setup)  // pinned worker
    log := postprocess(cudaCall)
    writeLog(log)
}
```

The pin moves into the pinned worker. The caller goroutine stays free for the rest of the work. Throughput on a multi-core box rises because `analyse`, `postprocess`, `writeLog` can run on any M.

---

### Solution 10 — Stable pool

```go
type Pool struct {
    in chan Job
}

func NewPool(n int) *Pool {
    p := &Pool{in: make(chan Job, 64)}
    for i := 0; i < n; i++ {
        go func() {
            runtime.LockOSThread()
            defer runtime.UnlockOSThread()
            for j := range p.in {
                j.Reply <- C.cgo_call(C.int(j.Input))
            }
        }()
    }
    return p
}

func (p *Pool) Submit(in int) int {
    reply := make(chan int, 1)
    p.in <- Job{Input: in, Reply: reply}
    return <-reply
}
```

Thread count stable at baseline + N.

---

### Solution 11 — NUMA pinning

Layer `unix.SchedSetaffinity` on top of `LockOSThread`. For each worker, pin to the CPUs on the GPU's socket.

```go
func (w *Worker) loop(cpus []int) {
    runtime.LockOSThread()
    // no defer Unlock: keep the M dedicated to this NUMA node.

    var set unix.CPUSet
    for _, cpu := range cpus {
        set.Set(cpu)
    }
    unix.SchedSetaffinity(0, &set)

    cudaInit()
    defer cudaShutdown()

    for j := range w.in {
        j.Reply <- runKernel(j.Input)
    }
}
```

Run the service with `numactl --membind=0,1`. Cross-socket traffic drops; throughput rises.

---

### Solution 12 — Observability

```go
import "runtime/pprof"

// Per-worker labels:
pprof.Do(ctx, pprof.Labels("role", "worker", "id", strconv.Itoa(id)), func(ctx context.Context) {
    // worker loop
})

// Queue depth metric:
prometheus.NewGaugeFunc(prometheus.GaugeOpts{Name: "worker_queue_depth"},
    func() float64 { return float64(len(w.in)) })

// Thread count metric:
prometheus.NewGaugeFunc(prometheus.GaugeOpts{Name: "go_threads"},
    func() float64 { return float64(runtimeThreads()) })
```

Alert rule (Prometheus):

```yaml
- alert: ExcessThreads
  expr: go_threads > 30
  for: 5m
```

---

### Solution 13 — Audit and migrate

Steps:

1. `grep -rn 'runtime\.LockOSThread' .` → identify all sites.
2. For each, classify:
   - cgo into thread-affine library → keep (move into worker pool).
   - cgo into thread-safe library → remove pin.
   - Pure Go → remove pin.
3. Build a single pinned worker pool for the thread-affine cases.
4. Wire HTTP handlers to submit via the pool, not pin.
5. Remove all other pin calls.
6. Add integration test asserting thread count.

Result: thread count from thousands to baseline + pool size.

---

### Solution 14 — Adaptive pool

```go
type Pool struct {
    in      chan Job
    min     int
    max     int
    current atomic.Int32
}

func (p *Pool) controller() {
    var idleStart time.Time
    for range time.Tick(1 * time.Second) {
        depth := len(p.in)
        cur := p.current.Load()
        if depth > 100 && cur < int32(p.max) {
            p.spawn()
            idleStart = time.Time{}
        } else if depth == 0 {
            if idleStart.IsZero() {
                idleStart = time.Now()
            } else if time.Since(idleStart) > 30*time.Second && cur > int32(p.min) {
                p.drainOne()
            }
        }
    }
}

func (p *Pool) spawn() {
    p.current.Add(1)
    go func() {
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()
        defer p.current.Add(-1)
        for j := range p.in {
            if j.Drain {
                return
            }
            j.Reply <- process(j)
        }
    }()
}
```

Burst scaling tested with synthetic load.

---

### Solution 15 — Avoid exit-while-locked churn

Replace one-shot pinned goroutines with a long-lived pool:

```go
var theWorker = NewPinned()

func RunOnce() {
    theWorker.Submit(jobFromCallSite())
}
```

M churn drops from 1000/s to zero.

---

### Solution 16 — WebAssembly

```go
import "github.com/tetratelabs/wazero"

var wazeroRuntime = wazero.NewRuntime(context.Background())
var compressMod, _ = wazeroRuntime.Instantiate(context.Background(), wasmBytes)

func Compress(data []byte) []byte {
    // wasm call, no cgo
    return invokeCompress(compressMod, data)
}
```

No M held; no pinning. Thread count drops by `pool_size`.

---

### Solution 17 — Pinned + isolated CPU

Boot with `isolcpus=2,3` kernel parameter. Run the service. In code:

```go
runtime.LockOSThread()
// no defer Unlock
var set unix.CPUSet
set.Set(2)
unix.SchedSetaffinity(0, &set)
criticalLoop()
```

The critical loop runs on an isolated CPU; the kernel scheduler does not put other work there. Combined with `nohz_full=2,3`, ticker interrupts are also reduced. p99.9 drops.

---

### Solution 18 — Circuit breaker

```go
type SupervisedPool struct {
    workers []*Worker
    health  []*WorkerHealth
}

type WorkerHealth struct {
    panics atomic.Int32
    failed atomic.Bool
}

func (s *SupervisedPool) Submit(ctx context.Context, j Job) (Result, error) {
    if s.failedFraction() > 0.5 {
        return Result{}, errors.New("pool unhealthy")
    }
    // pick a non-failed worker
    for _, w := range s.workers {
        // ...
    }
    return ...
}

func (s *SupervisedPool) onPanic(workerID int) {
    h := s.health[workerID]
    count := h.panics.Add(1)
    if count > 3 {
        h.failed.Store(true)
        go s.restart(workerID)
    }
}

func (s *SupervisedPool) restart(workerID int) {
    s.workers[workerID].Close()
    s.workers[workerID] = NewWorker()
    s.health[workerID].failed.Store(false)
    s.health[workerID].panics.Store(0)
}
```

---

### Solution 19 — Remove unjustified main pin

1. Locate `runtime.LockOSThread()` in `init` or `main`.
2. Check git history: was it added for the (removed) GUI?
3. Remove. Run integration tests.
4. Compare thread count: should drop by 1.
5. Compare p99 latency: should be slightly better (one less M competing for CPU).

---

### Solution 20 — Audit lint

```go
package handlerpin

import (
    "go/ast"
    "golang.org/x/tools/go/analysis"
)

var Analyzer = &analysis.Analyzer{
    Name: "handlerpin",
    Doc:  "flags runtime.LockOSThread in HTTP handlers",
    Run:  run,
}

func run(pass *analysis.Pass) (interface{}, error) {
    for _, file := range pass.Files {
        ast.Inspect(file, func(n ast.Node) bool {
            fn, ok := n.(*ast.FuncDecl)
            if !ok {
                return true
            }
            if !isHandler(fn) && !isCalledByHandler(pass, fn) {
                return true
            }
            ast.Inspect(fn.Body, func(n ast.Node) bool {
                if isLockCall(n) && !hasAllowComment(pass, n) {
                    pass.Reportf(n.Pos(),
                        "runtime.LockOSThread in HTTP handler is forbidden; refactor to single-owner pool or add // lockosthread:allow <reason>")
                }
                return true
            })
            return true
        })
    }
    return nil, nil
}

func isHandler(fn *ast.FuncDecl) bool {
    // function signature: func(http.ResponseWriter, *http.Request)
    // ...
    return false
}
```

Wire into `go vet` in CI. Reject PRs that add unannotated pins to handlers.

---

## Wrap-up

These exercises centre on recurring tuning patterns:

1. **Eliminate vestigial pins** — most pins are not justified; removing them is the simplest win.
2. **Hoist init out of hot paths** — initialise once per worker, never per call.
3. **Refactor per-request pinning into pools** — the canonical single-owner pattern.
4. **Use mutexes or atomics for serialisation** — pinning is not a synchronisation primitive.
5. **Bound cgo concurrency with semaphores** — when the library is thread-safe, you don't need to pin at all.
6. **Layer NUMA + CPU affinity on `LockOSThread`** — for the rare workload that benefits.
7. **Move pinning to sub-sections of code** — don't pin the whole function when only part needs it.
8. **Add lifecycle and observability** — every pinned worker should have a readiness signal, panic recovery, metrics, and pprof labels.
9. **Audit lint rules catch regressions early** — automate the pinning policy.

The general rule: **pin only what genuinely requires thread affinity, encapsulate it in a long-lived worker, and measure the trade-off.** Everything else is a code smell.

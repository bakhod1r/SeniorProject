# Goroutines vs OS Threads — Optimization Exercises

> Each exercise gives you a working but suboptimal program, a target metric, and asks you to improve. Solutions are at the end. The goal is to internalise the cost models of goroutines vs threads and apply them when tuning.

---

## Easy

### Exercise 1 — Reduce thread count under cgo load

**Starting code:**

```go
package main

/*
#include <unistd.h>
void slow(void) { sleep(1); }
*/
import "C"
import (
    "fmt"
    "os"
    "strings"
    "sync"
    "time"
)

func threadCount() int {
    data, _ := os.ReadFile("/proc/self/status")
    for _, line := range strings.Split(string(data), "\n") {
        if strings.HasPrefix(line, "Threads:") {
            var n int
            fmt.Sscanf(line, "Threads: %d", &n)
            return n
        }
    }
    return -1
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 200; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            C.slow()
        }()
    }
    time.Sleep(500 * time.Millisecond)
    fmt.Println("threads:", threadCount())
    wg.Wait()
}
```

**Baseline.** ~200 threads. **Target.** ≤ 20 threads. **Constraints.** All 200 cgo calls must still complete.

---

### Exercise 2 — Replace `time.Sleep`-based polling with a single timer

**Starting code:**

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func worker(id int, wg *sync.WaitGroup) {
    defer wg.Done()
    for {
        // poll
        time.Sleep(10 * time.Millisecond)
        if id%2 == 0 {
            return // half exit
        }
    }
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go worker(i, &wg)
    }
    time.Sleep(50 * time.Millisecond)
    fmt.Println("running")
    wg.Wait()
}
```

**Issue.** Many goroutines each holding their own ticker for the same interval. **Target.** Use a single ticker that fans out signals.

---

### Exercise 3 — Bound goroutine spawn rate

**Starting code:**

```go
package main

import (
    "net/http"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    // Spawn 100k goroutines all at once doing HTTP requests
    for i := 0; i < 100_000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            _, _ = http.Get("http://localhost:8080/")
        }()
    }
    wg.Wait()
}
```

**Issue.** 100K simultaneous goroutines doing HTTP is fine for goroutines, but downstream gets crushed. **Target.** Bound to 100 in-flight requests. Use `errgroup.SetLimit` or `semaphore`. Keep total throughput as high as possible.

---

### Exercise 4 — Right-size `GOMAXPROCS` in a container

**Starting code:** a Go service that calls `runtime.GOMAXPROCS(0)` and writes `100` (it was hard-coded by a previous engineer "for headroom") in a Kubernetes pod with `cpu: 1` limit.

**Symptom.** p99 latency is ~50 ms; expected 5 ms.

**Target.** Set `GOMAXPROCS` to match cgroup quota; p99 should drop to ~5 ms.

---

### Exercise 5 — Reduce goroutine churn in a hot path

**Starting code:**

```go
func handle(req Request) Response {
    var wg sync.WaitGroup
    var a, b Result
    wg.Add(2)
    go func() { defer wg.Done(); a = fetchA(req.ID) }()
    go func() { defer wg.Done(); b = fetchB(req.ID) }()
    wg.Wait()
    return combine(a, b)
}
```

The handler spawns 2 goroutines per request. At 50K RPS, that's 100K goroutines / second of churn.

**Target.** Reduce to 1 goroutine per request (the second fetch reuses the calling goroutine).

---

## Medium

### Exercise 6 — Replace cgo blocking with a pool

A program calls a slow C function. Each call takes 50 ms. Currently:

```go
go C.slow_call(C.int(arg))
```

100 RPS means 5 concurrent cgo calls (avg), peaking higher under load. Thread count fluctuates wildly.

**Target.** Build a pool of 8 worker goroutines, each pinned via `LockOSThread`, that read jobs from a channel. Submit produces stable thread count.

---

### Exercise 7 — Eliminate fork+exec overhead

**Starting code:**

```go
func renderPage(html string) ([]byte, error) {
    cmd := exec.Command("wkhtmltopdf", "-", "-")
    cmd.Stdin = strings.NewReader(html)
    return cmd.Output()
}
```

At 10 RPS, each call fork+exec → wkhtmltopdf, runs, exits. Overhead per call: ~50 ms.

**Target.** Reduce per-call overhead to ~5 ms by either (a) pooling subprocesses (long-running, message-passing) or (b) replacing with a pure-Go renderer if available.

---

### Exercise 8 — Tune `GOGC` to balance throughput and latency

A service does 200 K small allocations per request. p99 latency includes 50 ms GC pause periodically.

**Target.** Reduce p99 by:

- Reusing buffers (`sync.Pool`).
- Tuning `GOGC` (higher value = less frequent GC = more memory).
- Switching to `GOMEMLIMIT` (Go 1.19+) for hard memory cap.

Quantify the trade-off.

---

### Exercise 9 — Replace channel hot path with `atomic`

```go
type Counter struct {
    ops chan int
    val int
}

func NewCounter() *Counter {
    c := &Counter{ops: make(chan int)}
    go func() {
        for n := range c.ops {
            c.val += n
        }
    }()
    return c
}

func (c *Counter) Add(n int) { c.ops <- n }
```

This actor-style counter is slow under contention. 50 ns per op channel-bound vs ~2 ns atomic.

**Target.** Re-implement with `sync/atomic.Int64`. Benchmark with 1M ops, 8 goroutines.

---

### Exercise 10 — Reduce M-pool churn

A service has highly variable cgo workload. Thread count oscillates between 10 and 200 every minute.

**Target.** Stabilise thread count. Options:

- Pin a fixed pool of M-holding goroutines for cgo work.
- Use `GODEBUG=cgocheck=0` to remove the cgocheck overhead (be aware of safety implications).
- Pre-warm with a "no-op" cgo call to make Ms exist before traffic arrives.

---

### Exercise 11 — Batch high-frequency network calls

A service does 1000 RPC calls per request to a downstream service. Each call has ~1 ms RTT. Total request latency: ~1 s.

**Target.** Reduce to < 20 ms by batching 50 calls per batch with the downstream's batch API. Confirm goroutine count and thread count remain unchanged.

---

### Exercise 12 — Replace blocking file reads with buffered reads

A service reads many small files. Each read holds an M for ~ms. Thread count climbs.

```go
data, _ := os.ReadFile(path) // blocking syscall path
```

**Target.** Reduce thread count by:

- Reading in larger chunks (`bufio.Reader`).
- Using `io.Copy` from a single shared reader where possible.
- Bounding parallelism (8 concurrent reads, not 1000).

---

## Hard

### Exercise 13 — NUMA-tune a 64-core deployment

A Go service runs on a 64-core, 4-socket server. `GOMAXPROCS=64`. Throughput is 30% of expected.

**Target.** Use NUMA bindings:

- Run 4 replicas of the service.
- Each replica pinned to one NUMA node with `numactl --cpunodebind=N --membind=N`.
- Each `GOMAXPROCS=16`.

Measure: total throughput should approach 3-4× the original (cross-socket cache misses eliminated).

---

### Exercise 14 — Pinning + work-stealing hybrid

A service has a workload where ~10% of requests need GPU compute (CUDA via cgo, thread-affine). 90% are pure Go.

**Target.** Architect such that:

- 4 goroutines pinned via `LockOSThread`, each owning a GPU device.
- GPU work routed through a channel to the pinned goroutines.
- Non-GPU work runs on normal goroutines.
- Thread count is bounded.
- GPU utilisation is high.

---

### Exercise 15 — Replace `cgo` with WebAssembly

A service uses a small C library for compression. Each call costs cgo overhead (~200 ns + the actual call). At high RPS, cgo overhead is significant.

**Target.** Embed the C library as WebAssembly via `wazero`. No cgo, no Ms held. Measure: per-call overhead drops to ~50 ns (WASM runtime cost), thread count is unchanged.

---

### Exercise 16 — Build a self-tuning goroutine pool

**Target.** Build a `Pool` that:

- Starts with `runtime.GOMAXPROCS(0)` workers.
- Scales up if queue depth > 100 for > 1 s.
- Scales down if all workers are idle for > 30 s.
- Has a hard ceiling (configurable).
- Logs metrics: queue depth, worker count, scale events.

Compare against fixed-size pool under bursty load.

---

### Exercise 17 — Reduce GC impact during spike load

A service handles 1 K RPS steady-state, with bursts to 10 K RPS for 5 s. GC pause during bursts is 200 ms p99.

**Target.** Reduce p99 GC pause to < 20 ms by:

- Pre-allocating with `sync.Pool` to reduce burst allocations.
- Tuning `GOGC=200` (less frequent GC).
- Setting `GOMEMLIMIT` to prevent OOM.
- Profiling allocation hotspots with `pprof alloc_objects`.

---

### Exercise 18 — Cross-language interop without cgo cost

A service needs to call a Python ML model. Two options:

A. Embed Python via cgo (using `python3-embed`). Each call holds an M for ~5 ms inference.
B. Run Python as a subprocess, communicate via Unix socket (msgpack-encoded). Each call is a netpoller round-trip (~100 µs).

**Target.** Implement option B. Confirm thread count is unaffected; latency is similar or better; the Python process can be restarted independently.

---

### Exercise 19 — Diagnose and fix a "thread climbing" production incident

**Scenario.** A pod's thread count, normally ~10, climbs to ~200 over an hour and OOMs. Goroutine count is stable at ~5000.

**Target.** Diagnose:

- Inspect `/debug/pprof/goroutine?debug=2` (saved snapshot).
- Look for cgo stacks.
- Look for blocking syscalls (`syscall.Read` on regular files).
- Identify the offending code path.

Then patch:

- Bound the parallelism of the identified call.
- Add a thread-count metric and alert.
- Add an integration test that fails if thread count exceeds the new bound.

---

### Exercise 20 — Build a workload-aware `GOMAXPROCS` controller

**Target.** A controller goroutine that adjusts `GOMAXPROCS` based on observed scheduler latency:

- If scheduler p99 > 5 ms, increase `GOMAXPROCS` by 1 (up to `NumCPU`).
- If sustained idle, decrease by 1 (down to 2).
- Hysteresis to avoid flapping.

Test with a synthetic workload that varies CPU pressure. Confirm `GOMAXPROCS` follows the load.

(Beware: changing `GOMAXPROCS` is a stop-the-world. In practice this is rarely done in production.)

---

## Solutions

### Solution 1 — Bound cgo with a semaphore

```go
import "golang.org/x/sync/semaphore"

sem := semaphore.NewWeighted(8)
for i := 0; i < 200; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        sem.Acquire(context.Background(), 1)
        defer sem.Release(1)
        C.slow()
    }()
}
```

Thread count drops to ~15.

---

### Solution 2 — Single ticker fanout

```go
ticker := time.NewTicker(10 * time.Millisecond)
defer ticker.Stop()

worker := func(stop <-chan struct{}, tick <-chan time.Time) {
    for {
        select {
        case <-stop: return
        case <-tick: /* do work */
        }
    }
}
```

One ticker, many workers. Avoids per-worker timer overhead.

---

### Solution 3 — `errgroup.SetLimit`

```go
g, _ := errgroup.WithContext(context.Background())
g.SetLimit(100)
for i := 0; i < 100_000; i++ {
    g.Go(func() error {
        _, err := http.Get("http://localhost:8080/")
        return err
    })
}
g.Wait()
```

Or `semaphore.Weighted` if you need weighted resources.

---

### Solution 4 — `automaxprocs` or upgrade

```go
import _ "go.uber.org/automaxprocs"
```

For Go ≥ 1.16 on Linux, the runtime does it automatically. Remove any hard-coded `runtime.GOMAXPROCS(100)` line.

---

### Solution 5 — Inline the second call

```go
func handle(req Request) Response {
    var b Result
    done := make(chan struct{})
    go func() {
        b = fetchB(req.ID)
        close(done)
    }()
    a := fetchA(req.ID) // run in calling goroutine
    <-done
    return combine(a, b)
}
```

Halves goroutine spawn rate.

---

### Solution 6 — Pinned pool

```go
type Pool struct {
    in chan Job
}

func New(n int) *Pool {
    p := &Pool{in: make(chan Job, 1024)}
    for i := 0; i < n; i++ {
        go func() {
            runtime.LockOSThread()
            defer runtime.UnlockOSThread()
            for j := range p.in {
                C.slow_call(C.int(j.arg))
            }
        }()
    }
    return p
}

func (p *Pool) Submit(j Job) { p.in <- j }
```

Thread count: exactly `n + GOMAXPROCS + extras`. Stable.

---

### Solution 7 — Pool subprocesses

Long-running `wkhtmltopdf --batch-mode` (if supported) or a custom protocol. Pre-spawn N processes, route requests over stdin/stdout.

```go
type Renderer struct {
    in chan job
}

func NewRenderer(n int) *Renderer {
    r := &Renderer{in: make(chan job, 64)}
    for i := 0; i < n; i++ {
        go r.worker()
    }
    return r
}

func (r *Renderer) worker() {
    cmd := exec.Command("./renderer")
    stdin, _ := cmd.StdinPipe()
    stdout, _ := cmd.StdoutPipe()
    cmd.Start()
    enc := json.NewEncoder(stdin)
    dec := json.NewDecoder(stdout)
    for j := range r.in {
        enc.Encode(j.req)
        var resp Resp
        dec.Decode(&resp)
        j.reply <- resp
    }
}
```

Per-call overhead: a few hundred µs instead of 50 ms.

---

### Solution 8 — `sync.Pool` + `GOGC`

```go
var bufPool = sync.Pool{
    New: func() interface{} { return make([]byte, 64*1024) },
}

func handle(req Request) Response {
    buf := bufPool.Get().([]byte)
    defer bufPool.Put(buf)
    // use buf
}
```

Plus `GOGC=200` or `GOMEMLIMIT=2GiB` to balance.

Quantify: GC pause drops from 50 ms to 10 ms; memory rises from 1 GB to 2 GB.

---

### Solution 9 — `atomic.Int64`

```go
type Counter struct {
    val atomic.Int64
}

func (c *Counter) Add(n int64) { c.val.Add(n) }
func (c *Counter) Value() int64 { return c.val.Load() }
```

Benchmark:
- Channel: ~50 ns/op contended.
- Atomic: ~2 ns/op contended.

---

### Solution 10 — Pre-warm + bound

Spin up a pool at startup that touches cgo once each. The Ms exist. Bind subsequent cgo work to the pool.

---

### Solution 11 — Batch RPC

```go
type Batcher struct {
    in chan req
    out chan []req
}

func (b *Batcher) collect() {
    var batch []req
    ticker := time.NewTicker(2 * time.Millisecond)
    for {
        select {
        case r := <-b.in:
            batch = append(batch, r)
            if len(batch) >= 50 {
                b.out <- batch
                batch = nil
            }
        case <-ticker.C:
            if len(batch) > 0 {
                b.out <- batch
                batch = nil
            }
        }
    }
}
```

Latency: 1000 calls × 1 ms = 1 s → 20 batches × 1 ms = 20 ms.

---

### Solution 12 — Bound file I/O parallelism

```go
sem := make(chan struct{}, 8)
for _, p := range paths {
    p := p
    sem <- struct{}{}
    go func() {
        defer func() { <-sem }()
        data, _ := os.ReadFile(p)
        process(data)
    }()
}
```

Thread count caps at ~16.

---

### Solution 13 — NUMA pinning

```bash
numactl --cpunodebind=0 --membind=0 ./server --port=8080 &
numactl --cpunodebind=1 --membind=1 ./server --port=8081 &
numactl --cpunodebind=2 --membind=2 ./server --port=8082 &
numactl --cpunodebind=3 --membind=3 ./server --port=8083 &
```

Each replica `GOMAXPROCS=16`. Load balancer in front. Cross-socket traffic eliminated.

---

### Solution 14 — Hybrid pinning

```go
type GPUWorker struct {
    in chan Work
}

func NewGPUPool(numDevs int) *GPUPool {
    p := &GPUPool{workers: make([]*GPUWorker, numDevs)}
    for i := 0; i < numDevs; i++ {
        w := &GPUWorker{in: make(chan Work, 16)}
        p.workers[i] = w
        go func(id int) {
            runtime.LockOSThread()
            defer runtime.UnlockOSThread()
            C.cuda_set_device(C.int(id))
            for work := range w.in {
                C.cuda_run(work.cdata)
                work.reply <- ok
            }
        }(i)
    }
    return p
}
```

GPU work routes via a dispatch goroutine that load-balances across pinned workers. Non-GPU work uses normal goroutines.

---

### Solution 15 — Wazero

```go
import "github.com/tetratelabs/wazero"

ctx := context.Background()
r := wazero.NewRuntime(ctx)
mod, _ := r.InstantiateWithConfig(ctx, wasmBytes, wazero.NewModuleConfig())
compress := mod.ExportedFunction("compress")
result, _ := compress.Call(ctx, dataPtr, dataLen)
```

No cgo. No M held. Per-call overhead is just a function dispatch.

---

### Solution 16 — Self-tuning pool

```go
type Pool struct {
    in     chan Job
    target atomic.Int32
    active atomic.Int32
}

func (p *Pool) controller() {
    var idleStart time.Time
    for range time.Tick(1 * time.Second) {
        depth := len(p.in)
        if depth > 100 && p.active.Load() < p.maxWorkers {
            p.spawn()
            idleStart = time.Time{}
        } else if depth == 0 {
            if idleStart.IsZero() {
                idleStart = time.Now()
            } else if time.Since(idleStart) > 30*time.Second && p.active.Load() > p.minWorkers {
                p.signalDrain() // one worker exits
                idleStart = time.Time{}
            }
        }
    }
}
```

Tested against burst load; scale-up should happen within seconds.

---

### Solution 17 — Allocation reduction

Same techniques as Solution 8. Profile with `pprof alloc_objects`, fix the top 3 hot spots. Then `GOGC=200` and `GOMEMLIMIT`.

---

### Solution 18 — Subprocess + msgpack

```go
type Predictor struct {
    cmd *exec.Cmd
    in  io.WriteCloser
    out io.ReadCloser
    mu  sync.Mutex
}

func New() (*Predictor, error) {
    p := &Predictor{}
    p.cmd = exec.Command("python3", "predict.py")
    var err error
    p.in, _ = p.cmd.StdinPipe()
    p.out, _ = p.cmd.StdoutPipe()
    if err = p.cmd.Start(); err != nil { return nil, err }
    return p, nil
}

func (p *Predictor) Predict(in []float32) ([]float32, error) {
    p.mu.Lock()
    defer p.mu.Unlock()
    msgpack.NewEncoder(p.in).Encode(in)
    var out []float32
    msgpack.NewDecoder(p.out).Decode(&out)
    return out, nil
}
```

Or a pool of subprocesses for parallelism.

---

### Solution 19 — Diagnose and patch

1. Snapshot `pprof goroutine` showed 80% of goroutines in `_Cfunc_libcurl_easy_perform`.
2. Identified: per-request `libcurl` calls, no concurrency bound.
3. Patch: `sem := semaphore.NewWeighted(20)` in the request handler.
4. Added Prometheus metric `process_threads_total`.
5. Alert: `process_threads_total > 30 for 1m`.
6. Integration test: spawn 100 concurrent requests, assert `Threads:` < 50.

---

### Solution 20 — Adaptive GOMAXPROCS

```go
func adaptiveGOMAXPROCS(ctx context.Context) {
    sample := []metrics.Sample{{Name: "/sched/latencies:seconds"}}
    for {
        select { case <-ctx.Done(): return; default: }
        time.Sleep(10 * time.Second)
        metrics.Read(sample)
        // ... parse histogram, compute p99 ...
        current := runtime.GOMAXPROCS(0)
        if p99 > 5*time.Millisecond && current < runtime.NumCPU() {
            runtime.GOMAXPROCS(current + 1)
        } else if p99 < 100*time.Microsecond && current > 2 {
            runtime.GOMAXPROCS(current - 1)
        }
    }
}
```

In practice, just set it once at startup. This is academic.

---

## Wrap-up

These optimizations centre on a few recurring patterns:

1. **Bound expensive concurrency** (cgo, file I/O) with semaphores or pools.
2. **Reduce goroutine churn** in hot paths (inline one of two parallel calls).
3. **Set `GOMAXPROCS` correctly** in containers (trust Go 1.16+; otherwise `automaxprocs`).
4. **Stabilise thread count** with pinned worker pools.
5. **Replace blocking syscalls** with netpoller-backed equivalents.
6. **Avoid cgo where possible** — WebAssembly, subprocess, or pure Go alternative.
7. **NUMA-tune** for large multi-socket machines.

The general rule: **goroutines are cheap, threads are bounded, choose primitives that respect both.**

# Go Runtime GMP — Optimization Exercises

> Each exercise presents code with a scheduler-related performance issue. Identify it, optimise, measure.

---

## Exercise 1 — Overspawning goroutines

**Baseline.**

```go
for _, item := range items {
    go process(item)
}
// ... wait ...
```

For 1 million items: 1 million goroutines. Stack overhead = ~2 GB. Scheduler churn high.

**Goal.** Bound concurrency.

**Solution.**

```go
sem := make(chan struct{}, runtime.NumCPU()*2)
var wg sync.WaitGroup
for _, item := range items {
    sem <- struct{}{}
    wg.Add(1)
    go func(item Item) {
        defer wg.Done()
        defer func() { <-sem }()
        process(item)
    }(item)
}
wg.Wait()
```

Bounded concurrency at `2 * NumCPU`. Memory usage stays small.

---

## Exercise 2 — Container with default `GOMAXPROCS`

**Baseline.**

Go service running in Kubernetes pod with CPU limit of 2 cores, but on a 32-core host. Older Go (1.19) defaults `GOMAXPROCS` to 32. The kernel throttles to 2 cores.

**Goal.** Match `GOMAXPROCS` to actual CPU.

**Solution.**

```go
import _ "go.uber.org/automaxprocs"
```

Or upgrade to Go 1.21+, which detects cgroup CPU quota natively.

Verify with:

```go
fmt.Println("GOMAXPROCS:", runtime.GOMAXPROCS(0))
```

Should report 2 in the container.

---

## Exercise 3 — Cgo in a hot loop

**Baseline.**

```go
for i := 0; i < 1_000_000; i++ {
    C.tiny_function()
}
```

Each Cgo call costs ~300 ns transition. 1M calls = 300 ms in transitions.

**Goal.** Reduce Cgo overhead.

**Solution: batch in C.**

Define a C function that takes a count and loops:

```c
void tiny_function_batch(int n) {
    for (int i = 0; i < n; i++) {
        tiny_function();
    }
}
```

```go
C.tiny_function_batch(C.int(1_000_000))
```

One transition; transitions cost amortised over 1M iterations.

---

## Exercise 4 — Excessive `runtime.Gosched`

**Baseline.**

```go
for {
    runtime.Gosched()
    process()
}
```

In Go 1.14+, async preemption handles fairness. Manual `Gosched` adds ~50 ns per call for no benefit.

**Goal.** Remove unnecessary yields.

**Solution.**

```go
for {
    process()
}
```

Trust the scheduler.

---

## Exercise 5 — Goroutine churn

**Baseline.**

```go
for event := range events {
    go func(e Event) {
        process(e)
    }(event)
}
```

If events arrive at 100 000/sec, you spawn 100 000 goroutines/sec. Scheduler overhead measurable.

**Goal.** Reuse goroutines.

**Solution: worker pool.**

```go
workers := runtime.NumCPU() * 4
queue := make(chan Event, 1024)

for i := 0; i < workers; i++ {
    go func() {
        for e := range queue {
            process(e)
        }
    }()
}

for event := range events {
    queue <- event
}
close(queue)
```

A fixed pool of goroutines reused across events. Scheduler churn drops dramatically.

---

## Exercise 6 — Per-request `runtime.GC`

**Baseline.**

```go
http.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) {
    process(r)
    runtime.GC() // "free memory"
})
```

Each GC call has a brief STW phase. At 1000 req/sec, you're STW'ing 1000 times/sec.

**Goal.** Let GC manage itself.

**Solution.**

Remove the explicit `runtime.GC()`. Tune `GOGC` if memory growth is a concern:

```bash
GOGC=200 ./server
```

Higher `GOGC` means less frequent GC at the cost of more memory.

---

## Exercise 7 — `LockOSThread` overuse

**Baseline.**

```go
func handler(w http.ResponseWriter, r *http.Request) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    process(r)
}
```

Each request pins an OS thread. At 10 000 concurrent requests = 10 000 threads.

**Goal.** Reserve thread pinning for code that needs it.

**Solution.**

Remove `LockOSThread` from the handler. Only use it for the specific code paths that genuinely require thread identity (Cgo with thread-local state, certain syscalls).

If a sub-function needs thread pinning, isolate it:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    process(r)
}

func process(r *http.Request) {
    if needsThreadAffinity() {
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()
        doForeignThing()
    }
    // rest of processing without lock
}
```

---

## Exercise 8 — Many simultaneous syscalls

**Baseline.**

```go
for _, path := range paths {
    go func(p string) {
        data, _ := os.ReadFile(p)
        process(data)
    }(path)
}
```

10 000 concurrent file reads = 10 000 OS threads (each syscall holds an M).

**Goal.** Bound syscall concurrency.

**Solution.**

```go
sem := make(chan struct{}, 16)
for _, path := range paths {
    sem <- struct{}{}
    go func(p string) {
        defer func() { <-sem }()
        data, _ := os.ReadFile(p)
        process(data)
    }(path)
}
```

16 concurrent reads; 16 M's used. Throughput close to optimal for spinning disks; SSDs may benefit from 32–64.

---

## Exercise 9 — `time.After` in a tight loop

**Baseline.**

```go
for {
    select {
    case v := <-ch:
        process(v)
    case <-time.After(time.Second):
        idle()
    }
}
```

Each iteration creates a new timer. The previous one lives in memory until its expiry (up to 1 second). Memory accumulates.

**Goal.** Reuse a single timer.

**Solution.**

```go
t := time.NewTimer(time.Second)
defer t.Stop()
for {
    if !t.Stop() {
        select { case <-t.C: default: }
    }
    t.Reset(time.Second)
    select {
    case v := <-ch:
        process(v)
    case <-t.C:
        idle()
    }
}
```

One timer reused. Less memory pressure, less GC work.

---

## Exercise 10 — Allocations in hot path

**Baseline.**

```go
http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    buf := make([]byte, 0, 4096)
    buf = encode(buf, data)
    w.Write(buf)
})
```

Per request: 4 KB allocation. At 10 000 req/sec: 40 MB/sec to GC. GC frequency rises.

**Goal.** Reuse buffers.

**Solution.**

```go
var bufPool = sync.Pool{
    New: func() interface{} {
        b := make([]byte, 0, 4096)
        return &b
    },
}

http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    bp := bufPool.Get().(*[]byte)
    defer func() {
        *bp = (*bp)[:0]
        bufPool.Put(bp)
    }()
    *bp = encode(*bp, data)
    w.Write(*bp)
})
```

Buffers reused. Allocation rate drops; GC pressure falls.

---

## Exercise 11 — Heavy `runtime.NumGoroutine` polling

**Baseline.**

```go
http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "goroutines %d\n", runtime.NumGoroutine())
    // ... other metrics ...
})
```

`runtime.NumGoroutine` walks internal data structures and is not free under heavy load. Called on every metrics scrape, accumulated cost matters.

**Goal.** Cache or sample less frequently.

**Solution.**

Sample periodically and cache:

```go
var (
    cachedNumGoroutine atomic.Int64
)

func init() {
    go func() {
        t := time.NewTicker(time.Second)
        for range t.C {
            cachedNumGoroutine.Store(int64(runtime.NumGoroutine()))
        }
    }()
}

http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "goroutines %d\n", cachedNumGoroutine.Load())
})
```

Per-scrape cost: nearly zero.

---

## Exercise 12 — Spawning a goroutine per WebSocket message

**Baseline.**

```go
for {
    msg := readMessage(conn)
    go handle(msg)
}
```

If a connection sends 1000 msg/sec, you spawn 1000 goroutines/sec per connection. With 10 000 connections, 10 million goroutines/sec.

**Goal.** Process messages without spawning.

**Solution.**

If `handle` is non-blocking, just call it:

```go
for {
    msg := readMessage(conn)
    handle(msg)
}
```

If `handle` is sometimes slow, use a worker pool:

```go
queue := make(chan Message, 64)
for i := 0; i < 4; i++ {
    go func() {
        for m := range queue {
            handle(m)
        }
    }()
}
for {
    msg := readMessage(conn)
    queue <- msg
}
```

---

## Exercise 13 — Avoiding lock contention in hot path

**Baseline.**

```go
var (
    mu      sync.Mutex
    counter int64
)

http.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) {
    mu.Lock()
    counter++
    mu.Unlock()
})
```

At 100 000 req/sec, the mutex is hot. Multiple cores contend on the lock; throughput plateaus.

**Goal.** Reduce contention.

**Solution.**

```go
var counter atomic.Int64

http.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) {
    counter.Add(1)
})
```

Atomic add: ~5 ns, no mutex. Throughput scales with cores.

For even higher throughput, use per-CPU counters and sum on read (pattern in `expvar`'s `Int.Add`).

---

## Exercise 14 — Reducing GC pause time

**Baseline.**

A service with a large heap (10 GB) has 50 ms GC pauses, dropping p99 latency.

**Goal.** Reduce pause.

**Solution.**

- Reduce allocation rate (object pools, byte buffers).
- Reduce heap size (drop caches, smaller working set).
- Use `GOMEMLIMIT` to bound memory; GC runs more often but with less work each time.
- Use `GOGC=200` to delay GC for higher allocation rates, accepting more memory.
- For latency-critical services, use `debug.SetGCPercent` to manage GC pace.

Each option has trade-offs. Profile to choose.

---

## Exercise 15 — Excessive channel allocation

**Baseline.**

```go
func process(req Request) Response {
    ch := make(chan Response, 1)
    go func() {
        ch <- compute(req)
    }()
    return <-ch
}
```

Per request: one channel allocation + one goroutine spawn. At 100 000 req/sec, 200 000 short-lived allocations and goroutines.

**Goal.** Remove unnecessary indirection.

**Solution.**

If you wait on the channel synchronously, just call the function:

```go
func process(req Request) Response {
    return compute(req)
}
```

If a goroutine is needed for timeout enforcement, structure differently:

```go
func processWithTimeout(req Request, d time.Duration) (Response, error) {
    ctx, cancel := context.WithTimeout(context.Background(), d)
    defer cancel()
    type result struct {
        r Response
        err error
    }
    out := make(chan result, 1)
    go func() {
        out <- result{compute(req), nil}
    }()
    select {
    case r := <-out:
        return r.r, r.err
    case <-ctx.Done():
        return Response{}, ctx.Err()
    }
}
```

Even better: cancel the work in `compute` via the context.

---

## Closing

Scheduler-aware optimisation patterns:

1. **Bound goroutine creation.** Pool or semaphore-limit.
2. **Reuse goroutines.** Worker pools beat per-event spawns.
3. **Reuse buffers.** `sync.Pool` reduces GC pressure.
4. **Reuse timers.** `time.NewTimer` + `Reset` instead of `time.After` in loops.
5. **Avoid Cgo in hot paths.** Batch transitions.
6. **Avoid `LockOSThread` unless needed.** Preserves scheduler flexibility.
7. **Avoid manual `runtime.GC` and `Gosched`.** Trust the runtime.
8. **Use atomics for simple shared state.** Channels for ownership transfer.
9. **Match `GOMAXPROCS` to container CPU.** Use `automaxprocs` or Go 1.21+.
10. **Set `GOMEMLIMIT` for production services.** Prevents OOM.

Optimise based on profile data, not intuition. The Go scheduler is highly tuned; the bottleneck is usually in your code, not in the runtime.

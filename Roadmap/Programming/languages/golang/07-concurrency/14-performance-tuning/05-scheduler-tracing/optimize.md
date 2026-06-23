# Scheduler Tracing — Optimize

[Back to index](index.md)

Each section presents a performance problem visible in a scheduler trace, then walks through the optimisation. Code-before, code-after, and the trace-level evidence.

## Table of Contents
1. [Optimization 1: Reduce GC-Induced Tail Latency](#optimization-1-reduce-gc-induced-tail-latency)
2. [Optimization 2: Eliminate Syscall Storm](#optimization-2-eliminate-syscall-storm)
3. [Optimization 3: Smooth Per-P Imbalance](#optimization-3-smooth-per-p-imbalance)
4. [Optimization 4: Cut Scheduler Latency at p99](#optimization-4-cut-scheduler-latency-at-p99)
5. [Optimization 5: Bound Goroutine Concurrency](#optimization-5-bound-goroutine-concurrency)
6. [Optimization 6: Cheaper Annotations](#optimization-6-cheaper-annotations)
7. [Optimization 7: Reduce Trace File Size](#optimization-7-reduce-trace-file-size)
8. [Optimization 8: Move Hot Allocation Off-Heap](#optimization-8-move-hot-allocation-off-heap)
9. [Optimization 9: Avoid LockOSThread Hotspots](#optimization-9-avoid-lockosthread-hotspots)
10. [Optimization 10: Use Buffered Channels to Smooth Bursts](#optimization-10-use-buffered-channels-to-smooth-bursts)

---

## Optimization 1: Reduce GC-Induced Tail Latency

**Evidence in trace.** Minimum mutator utilisation curve drops to 0.2 at 1ms window. Mark-assist red stripes overlay request handlers. `gctrace=1` shows GC running every 100ms with 30ms mark time.

**Before.**

```go
type Response struct {
    Items []*Item
}

func handle(w http.ResponseWriter, r *http.Request) {
    items := make([]*Item, 0, 1024)
    for i := 0; i < 1024; i++ {
        items = append(items, &Item{ID: i, Data: make([]byte, 256)})
    }
    resp := &Response{Items: items}
    _ = json.NewEncoder(w).Encode(resp)
}
```

Every request allocates a slice of 1024 pointers plus 1024 `Item` structs plus 1024 byte slices. At 1000 rps, the allocation rate dominates and the runtime triggers GC frequently.

**After.**

```go
var itemPool = sync.Pool{
    New: func() any {
        return &itemBundle{
            items: make([]Item, 1024),
            buf:   make([]byte, 1024*256),
        }
    },
}

type itemBundle struct {
    items []Item
    buf   []byte
}

func handle(w http.ResponseWriter, r *http.Request) {
    b := itemPool.Get().(*itemBundle)
    defer itemPool.Put(b)

    for i := 0; i < 1024; i++ {
        b.items[i] = Item{ID: i, Data: b.buf[i*256 : (i+1)*256]}
    }
    _ = json.NewEncoder(w).Encode(b.items)
}
```

`Item` is now a value, not a pointer. Memory is pooled. Allocations per request drop from 2049 (1 slice + 1024 items + 1024 buffers) to 0 in the steady state.

**Trace result.** Minimum mutator utilisation at 1ms rises from 0.20 to 0.85. GC runs every 1–2 seconds instead of every 100ms. Mark assists nearly vanish.

**Caveats.** `sync.Pool` is per-P; in cgo or syscall-heavy code, that may not match request affinity. Measure both before and after.

---

## Optimization 2: Eliminate Syscall Storm

**Evidence in trace.** `threads` grows to 200+ under load. **Syscall blocking profile** shows `net.lookupHostFD` at the top.

**Before.**

```go
func proxy(target string) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        url := "http://" + target + r.URL.Path
        resp, err := http.Get(url) // resolves hostname every call.
        if err != nil {
            http.Error(w, err.Error(), 502)
            return
        }
        defer resp.Body.Close()
        io.Copy(w, resp.Body)
    })
}
```

Every request resolves `target` via the system resolver (cgo). At 1000 rps, the DNS lookups are constant.

**After.**

```go
var client = &http.Client{
    Transport: &http.Transport{
        DialContext: (&net.Dialer{
            Resolver: &net.Resolver{PreferGo: true}, // pure-Go resolver.
            Timeout:  3 * time.Second,
        }).DialContext,
        MaxIdleConnsPerHost: 100,
        IdleConnTimeout:     90 * time.Second,
    },
}

func proxy(target string) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        url := "http://" + target + r.URL.Path
        resp, err := client.Get(url) // reuses idle connections; pure-Go DNS.
        if err != nil {
            http.Error(w, err.Error(), 502)
            return
        }
        defer resp.Body.Close()
        io.Copy(w, resp.Body)
    })
}
```

Two improvements:
1. `MaxIdleConnsPerHost` reuses TCP connections (skips DNS and TCP handshake entirely on warm path).
2. `Resolver.PreferGo=true` uses Go's pure-Go resolver, which is non-blocking and runs on the netpoller.

**Trace result.** Threads drop from 200 to ~16. Syscall blocking profile no longer dominated by DNS. Latency p99 falls because each request no longer waits on a blocking syscall.

---

## Optimization 3: Smooth Per-P Imbalance

**Evidence in trace.** schedtrace `[120 110 5 5 5 5 5 5]`. Two Ps overloaded, six lightly loaded. View trace shows two P lanes fully striped, others mostly idle.

**Before.**

```go
func producer(jobs []Job) {
    for _, job := range jobs {
        go process(job) // spawns burst.
    }
}
```

A single producer spawns thousands of Gs in a tight loop. Each `go process(job)` puts the new G in `runnext` of the producer's P. Other Ps must steal.

**After.**

```go
func producer(jobs []Job, parallelism int) {
    sem := make(chan struct{}, parallelism)
    var wg sync.WaitGroup
    for _, job := range jobs {
        sem <- struct{}{}
        wg.Add(1)
        go func(j Job) {
            defer wg.Done()
            defer func() { <-sem }()
            process(j)
        }(job)
    }
    wg.Wait()
}
```

A semaphore caps concurrency at `parallelism`. New Gs are launched only when an old one finishes. The launch rate matches the consumption rate, so the runtime can balance.

**Alternative.** Worker pool with channels:

```go
func producer(jobs []Job, workers int) {
    ch := make(chan Job, workers*2)
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range ch {
                process(j)
            }
        }()
    }
    for _, job := range jobs {
        ch <- job
    }
    close(ch)
    wg.Wait()
}
```

Workers are long-lived; the scheduler distributes them once and they stay on their assigned Ps.

**Trace result.** Per-P runqueues balance to `[30 30 30 30 30 30 30 30]`. View trace shows all 8 lanes striped. Total throughput up ~30%.

---

## Optimization 4: Cut Scheduler Latency at p99

**Evidence in trace.** Scheduler latency profile dominated by `main.flush`. `runtime/metrics` p99 is 15ms; p50 is 50µs.

**Before.**

```go
func handle(w http.ResponseWriter, r *http.Request) {
    go flush() // fire-and-forget.
    fmt.Fprint(w, "ok")
}

func flush() {
    db.Write(buffer.Drain())
}
```

Every request fires a goroutine that competes with handler Gs for CPU. `flush` is heavier than the handler, so it queues up. When many flushes pile up, the *handlers* wait their turn.

**After.**

```go
var flushes = make(chan struct{}, 1) // single-slot.

func handle(w http.ResponseWriter, r *http.Request) {
    select {
    case flushes <- struct{}{}: // try to enqueue.
    default: // already pending; coalesce.
    }
    fmt.Fprint(w, "ok")
}

func flushWorker(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case <-flushes:
            db.Write(buffer.Drain())
        }
    }
}
```

A single worker goroutine handles flushes. The single-slot channel coalesces requests: if a flush is pending, additional requests do not enqueue. The handler goroutine never creates new Gs.

**Trace result.** Scheduler latency p99 falls from 15ms to <1ms. Goroutine count steady instead of bursty. Throughput up slightly because the runtime is not spending time on G creation/destruction.

---

## Optimization 5: Bound Goroutine Concurrency

**Evidence in trace.** Goroutines counter spikes to 50000 during bursts; CPU usage 8% (most blocked). Netpoller saturated, but scheduler healthy.

**Before.**

```go
for _, url := range urls {
    go fetch(url)
}
```

Unbounded goroutine creation. Each blocks on netpoll; scheduler is fine, but each goroutine costs memory (~8 KB stack) and the connection pool may exhaust.

**After.**

```go
func fetchAll(urls []string, parallelism int) {
    sem := make(chan struct{}, parallelism)
    var wg sync.WaitGroup
    for _, u := range urls {
        sem <- struct{}{}
        wg.Add(1)
        go func(url string) {
            defer wg.Done()
            defer func() { <-sem }()
            fetch(url)
        }(u)
    }
    wg.Wait()
}
```

Bounded concurrency at `parallelism` (e.g., 100). Memory bounded, connection pool bounded, scheduling overhead bounded.

**Trace result.** Goroutine count stays at ~100 + handlers. Memory drops by hundreds of MB. Wall-time slightly higher for the bulk operation but predictable.

---

## Optimization 6: Cheaper Annotations

**Evidence in trace.** Tracing overhead is 12% when enabled, vs 5% expected.

**Before.**

```go
func processBatch(ctx context.Context, items []Item) {
    for _, item := range items {
        trace.WithRegion(ctx, "process", func() { // 10000 regions per call.
            handle(item)
        })
    }
}
```

A region per item, in a loop. 10000 begins + 10000 ends = 20000 events.

**After.**

```go
func processBatch(ctx context.Context, items []Item) {
    trace.WithRegion(ctx, "processBatch", func() { // 1 region.
        for _, item := range items {
            handle(item)
        }
    })
}
```

One region for the batch instead of per-item. Trace events drop from 20000 to 2.

If per-item visibility matters, sample:

```go
func processBatch(ctx context.Context, items []Item) {
    trace.WithRegion(ctx, "processBatch", func() {
        for i, item := range items {
            if i%100 == 0 {
                trace.WithRegion(ctx, "process-sample", func() {
                    handle(item)
                })
                continue
            }
            handle(item)
        }
    })
}
```

100 sampled regions out of 10000 — 99% reduction at minimal information loss.

**Trace result.** Overhead drops to ~5%. Trace files shrink proportionally.

---

## Optimization 7: Reduce Trace File Size

**Evidence.** A 5-second trace from production is 800 MB and crashes `go tool trace`.

**Before.**

Continuous tracing at full event emission. Hot path emits hundreds of events per request: regions, logs, channel sends and receives, GC mark assists, syscalls.

**After.**

Reduce events to the minimum that informs your investigation:

1. **Remove redundant regions.** Function-level regions cover sub-regions in most cases.
2. **Reduce log volume.** Use logs for decision points only, not for every field.
3. **Lower trace duration.** A 2-second trace usually captures the pattern; 5 seconds rarely adds insight.
4. **Lower request rate during capture.** Trace at off-peak if possible.
5. **Filter at parse time.** Use `golang.org/x/exp/trace` to skip events you do not need.

**Trace result.** File size from 800 MB to 80 MB. Loads instantly.

---

## Optimization 8: Move Hot Allocation Off-Heap

**Evidence in trace.** Heap counter climbs aggressively. GC runs every 50ms. Most allocations from one function.

**Before.**

```go
func sumLines(r io.Reader) (int, error) {
    scanner := bufio.NewScanner(r)
    total := 0
    for scanner.Scan() {
        line := scanner.Text() // allocates a string per line.
        n, _ := strconv.Atoi(strings.TrimSpace(line))
        total += n
    }
    return total, scanner.Err()
}
```

`scanner.Text()` returns a freshly allocated string. For 1M lines, that is 1M allocations.

**After.**

```go
func sumLines(r io.Reader) (int, error) {
    scanner := bufio.NewScanner(r)
    total := 0
    for scanner.Scan() {
        line := scanner.Bytes() // reuses internal buffer.
        line = bytes.TrimSpace(line)
        n, _ := strconv.Atoi(string(line)) // unavoidable but the conversion is local.
        total += n
    }
    return total, scanner.Err()
}
```

Using `Bytes()` reuses the scanner's buffer; the conversion to string happens in `Atoi` (and is escape-analyzed: often the string does not escape and is stack-allocated).

For a stricter version that avoids the `string()` conversion entirely:

```go
func sumLines(r io.Reader) (int, error) {
    scanner := bufio.NewScanner(r)
    total := 0
    for scanner.Scan() {
        line := bytes.TrimSpace(scanner.Bytes())
        n, err := parseIntBytes(line) // hand-written parser.
        if err != nil {
            continue
        }
        total += n
    }
    return total, scanner.Err()
}
```

**Trace result.** Heap counter flat. GC runs every few seconds instead of every 50ms. CPU freed from mark assists.

---

## Optimization 9: Avoid LockOSThread Hotspots

**Evidence in trace.** A few Gs sit on dedicated Ms with `lockedm != -1`. View trace by thread shows those Ms busy; the corresponding Ps cannot run other Gs.

**Before.**

```go
func gpuWorker() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()

    for task := range taskCh {
        result := gpuCompute(task) // cgo to CUDA, requires thread affinity.
        resultCh <- result
    }
}
```

Locking is required because the GPU library needs thread-local state. But if there are 10 such workers, 10 Ms are pinned and 10 Ps cannot serve other work.

**After.**

```go
// Batch tasks to reduce thread-locked time per work item.
func gpuWorker(batchSize int) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()

    batch := make([]Task, 0, batchSize)
    for task := range taskCh {
        batch = append(batch, task)
        if len(batch) < batchSize && hasMore(taskCh) {
            continue
        }
        results := gpuComputeBatch(batch) // amortise cost.
        for _, r := range results {
            resultCh <- r
        }
        batch = batch[:0]
    }
}
```

The locked goroutine still pins a thread, but each pin yields proportionally more work. Fewer pinned-Gs are needed; more Ps free for other Gs.

**Trace result.** Locked-M count from 10 to 2 with same throughput. The 8 freed Ms (and their Ps) now serve general goroutines.

---

## Optimization 10: Use Buffered Channels to Smooth Bursts

**Evidence in trace.** Scheduler-latency p99 high. View trace shows producer blocked on channel send for milliseconds at a time.

**Before.**

```go
ch := make(chan Item) // unbuffered.

go consumer(ch)
go producer(ch)
```

Unbuffered: every send blocks until a receive is ready. If the consumer takes 1ms per item, the producer waits 1ms per item too.

**After.**

```go
ch := make(chan Item, 1024) // buffered.

go consumer(ch)
go producer(ch)
```

The producer can write up to 1024 items without blocking. As long as the average production and consumption rates match, the buffer absorbs bursts.

**Caveat.** Buffered channels do not solve sustained imbalance. If production > consumption forever, the channel fills, and the producer blocks anyway. Use buffers for bursts, not for ignoring slow consumers.

**Trace result.** Scheduler latency p99 falls. View trace shows producer running continuously; consumer running continuously; no per-send blocking.

---

## Wrap-Up

Common scheduler-tracing-driven optimisations:

| Symptom | Optimisation |
|---------|--------------|
| GC mark assists in red | Reduce allocations (pools, value types, smaller objects). |
| `threads` climbing | Eliminate blocking syscalls (non-blocking IO, pure-Go DNS). |
| Per-P imbalance | Bounded concurrency or worker pools. |
| High scheduler latency | Coalesce fire-and-forget goroutines. |
| Goroutine count exploding | Bounded concurrency, worker pools. |
| Trace overhead high | Sample annotations, batch regions. |
| Large trace files | Lower event volume, shorter captures. |
| Heap climbing fast | Move allocations off-heap (pools, byte slices). |
| LockOSThread bottlenecks | Batch work per locked goroutine. |
| Bursty producer/consumer | Buffered channels. |

The pattern is always: capture the trace, identify the symptom in the right view, apply the targeted fix, capture again to confirm. Optimisation without measurement is guesswork.

# What is Concurrency — Optimization Exercises

> Each exercise presents code that "works" but is slow. Your job: identify the bottleneck and optimise. Measure before and after; the speedup is the proof.

---

## Exercise 1 — Sequential I/O turned concurrent

**Baseline.**

```go
func FetchAll(urls []string) []string {
    results := make([]string, len(urls))
    for i, u := range urls {
        resp, _ := http.Get(u)
        defer resp.Body.Close()
        b, _ := io.ReadAll(resp.Body)
        results[i] = string(b)
    }
    return results
}
```

This is the most common "I forgot to use concurrency" mistake. With 10 URLs each taking 200 ms, total = 2 s.

**Goal.** Bring total to ~200 ms via concurrent I/O.

**Solution.**

```go
func FetchAll(urls []string) []string {
    results := make([]string, len(urls))
    var wg sync.WaitGroup
    for i, u := range urls {
        wg.Add(1)
        go func(i int, u string) {
            defer wg.Done()
            resp, err := http.Get(u)
            if err != nil {
                results[i] = "error: " + err.Error()
                return
            }
            defer resp.Body.Close()
            b, _ := io.ReadAll(resp.Body)
            results[i] = string(b)
        }(i, u)
    }
    wg.Wait()
    return results
}
```

Speedup: ~10x for 10 URLs.

**Beyond the basics.**

- Add `context.Context` for cancellation.
- Cap concurrency (semaphore or `errgroup.SetLimit`) to avoid exhausting connections.
- Use `errgroup` for first-error semantics.

---

## Exercise 2 — Inefficient parallel sum

**Baseline.**

```go
func ParallelSum(data []int) int64 {
    var sum int64
    var mu sync.Mutex
    var wg sync.WaitGroup
    workers := runtime.NumCPU()
    chunk := len(data) / workers
    for w := 0; w < workers; w++ {
        wg.Add(1)
        go func(w int) {
            defer wg.Done()
            for i := w * chunk; i < (w+1)*chunk; i++ {
                mu.Lock()
                sum += int64(data[i])
                mu.Unlock()
            }
        }(w)
    }
    wg.Wait()
    return sum
}
```

Concurrent, but serialised by the mutex. Slower than sequential.

**Goal.** Achieve genuine parallel speedup.

**Solution.**

Local accumulation, combine at end.

```go
func ParallelSum(data []int) int64 {
    workers := runtime.NumCPU()
    chunk := len(data) / workers
    partial := make([]int64, workers)
    var wg sync.WaitGroup
    for w := 0; w < workers; w++ {
        wg.Add(1)
        go func(w int) {
            defer wg.Done()
            var s int64
            end := (w + 1) * chunk
            if w == workers-1 {
                end = len(data)
            }
            for i := w * chunk; i < end; i++ {
                s += int64(data[i])
            }
            partial[w] = s
        }(w)
    }
    wg.Wait()
    var total int64
    for _, p := range partial {
        total += p
    }
    return total
}
```

Speedup approaches `workers` × on CPU-bound data.

**Further optimisation.**

The `partial` slice may suffer from false sharing if elements share a cache line. For very hot code, pad each entry:

```go
type padded struct {
    v int64
    _ [56]byte
}
partial := make([]padded, workers)
```

---

## Exercise 3 — Reading many files

**Baseline.**

```go
func ReadAll(paths []string) [][]byte {
    out := make([][]byte, len(paths))
    for i, p := range paths {
        b, _ := os.ReadFile(p)
        out[i] = b
    }
    return out
}
```

Sequential file I/O. Total = sum of individual read times.

**Goal.** Reduce wall-clock by overlapping I/O.

**Solution.**

```go
func ReadAll(paths []string) [][]byte {
    out := make([][]byte, len(paths))
    sem := make(chan struct{}, 16) // cap to avoid exhausting FDs
    var wg sync.WaitGroup
    for i, p := range paths {
        wg.Add(1)
        sem <- struct{}{}
        go func(i int, p string) {
            defer wg.Done()
            defer func() { <-sem }()
            b, _ := os.ReadFile(p)
            out[i] = b
        }(i, p)
    }
    wg.Wait()
    return out
}
```

**Notes.**

- File I/O is OS-thread-bound; the runtime may grow `M` to accommodate. The semaphore caps in-flight reads.
- On SSDs, 16–32 concurrent reads usually saturate throughput.
- On HDDs, fewer (4–8) — too many causes seek thrashing.

---

## Exercise 4 — Pipeline with single-stage bottleneck

**Baseline.**

```go
func Process(in <-chan Item) <-chan Result {
    decoded := decode(in)         // 1000 items/s
    transformed := transform(decoded) // 200 items/s -- bottleneck
    return write(transformed)     // 5000 items/s
}
```

Total throughput is 200/s, bottlenecked by `transform`.

**Goal.** Increase throughput.

**Solution.**

Fan out the bottleneck stage.

```go
func transformConcurrent(in <-chan Item, workers int) <-chan Item {
    out := make(chan Item)
    var wg sync.WaitGroup
    for w := 0; w < workers; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for x := range in {
                out <- transformOne(x)
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}

// Usage:
transformed := transformConcurrent(decoded, 5)
```

Five workers at 200/s each = 1000/s — matches `decode`. New bottleneck: `decode`.

**Iterate.** Profile, find the new bottleneck, parallelise it. Stop when bottleneck moves to a resource you cannot scale (network, disk).

---

## Exercise 5 — Lock-heavy hashmap

**Baseline.**

```go
type Cache struct {
    mu sync.Mutex
    m  map[string]string
}

func (c *Cache) Get(k string) string {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.m[k]
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.m[k] = v
}
```

Many readers contend on the single mutex.

**Goal.** Reduce contention.

**Solution A: RWMutex.**

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string]string
}

func (c *Cache) Get(k string) string {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.m[k]
}
```

Multiple readers proceed in parallel. Helps read-heavy workloads.

**Solution B: Sharded map.**

```go
const shards = 32

type Shard struct {
    mu sync.Mutex
    m  map[string]string
}

type Cache struct {
    shards [shards]Shard
}

func (c *Cache) shardFor(k string) *Shard {
    h := fnv.New32a()
    h.Write([]byte(k))
    return &c.shards[h.Sum32()%shards]
}

func (c *Cache) Get(k string) string {
    s := c.shardFor(k)
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.m[k]
}
```

Different keys go to different shards, reducing contention 32x.

**Solution C: `sync.Map`.**

Best for "write once, read many" patterns. Read path is lock-free.

---

## Exercise 6 — Channel send hot loop

**Baseline.**

```go
out := make(chan int)
go func() {
    for i := 0; i < 1_000_000; i++ {
        out <- i
    }
    close(out)
}()
```

Each send is a channel operation (~100 ns). Total: ~100 ms just on channel overhead.

**Goal.** Reduce per-item overhead.

**Solution: batch sends.**

```go
out := make(chan []int, 4)
go func() {
    const batch = 256
    buf := make([]int, 0, batch)
    for i := 0; i < 1_000_000; i++ {
        buf = append(buf, i)
        if len(buf) == batch {
            out <- buf
            buf = make([]int, 0, batch)
        }
    }
    if len(buf) > 0 {
        out <- buf
    }
    close(out)
}()
```

Receiver consumes batches. Channel overhead drops by ~256x.

**Trade-off.** Latency: each item waits up to 256 items for its batch. Acceptable for throughput-oriented code, not for latency-critical code.

---

## Exercise 7 — Goroutine spawn per request to a pool

**Baseline.**

```go
http.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) {
    go expensiveLog(r) // fire and forget
    w.WriteHeader(200)
})
```

Each request spawns a goroutine for logging. At 10 000 req/s the goroutine churn is significant.

**Goal.** Re-use a small pool of workers for logging.

**Solution.**

```go
var logCh = make(chan *http.Request, 10_000)

func init() {
    for i := 0; i < 8; i++ {
        go func() {
            for r := range logCh {
                expensiveLog(r)
            }
        }()
    }
}

http.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) {
    select {
    case logCh <- r:
    default:
        // drop log on overload
    }
    w.WriteHeader(200)
})
```

The `default` clause is **load shedding**: under burst, log entries are dropped rather than blocking the request path.

---

## Exercise 8 — Synchronously chaining I/O

**Baseline.**

```go
func processUser(id string) (User, error) {
    u, err := fetchUser(id)
    if err != nil { return User{}, err }
    profile, err := fetchProfile(id)
    if err != nil { return User{}, err }
    permissions, err := fetchPermissions(id)
    if err != nil { return User{}, err }
    u.Profile = profile
    u.Permissions = permissions
    return u, nil
}
```

Three independent calls in sequence. Latency = sum of three.

**Goal.** Fetch in parallel.

**Solution.**

```go
import "golang.org/x/sync/errgroup"

func processUser(ctx context.Context, id string) (User, error) {
    g, ctx := errgroup.WithContext(ctx)

    var (
        u           User
        profile     Profile
        permissions Permissions
    )

    g.Go(func() error {
        var err error
        u, err = fetchUser(ctx, id)
        return err
    })
    g.Go(func() error {
        var err error
        profile, err = fetchProfile(ctx, id)
        return err
    })
    g.Go(func() error {
        var err error
        permissions, err = fetchPermissions(ctx, id)
        return err
    })

    if err := g.Wait(); err != nil {
        return User{}, err
    }
    u.Profile = profile
    u.Permissions = permissions
    return u, nil
}
```

Latency drops from sum to max of the three.

---

## Exercise 9 — Spurious wakeups in polling

**Baseline.**

```go
for {
    if ready() {
        break
    }
    time.Sleep(10 * time.Millisecond)
}
process()
```

Polls every 10 ms. Average latency ~5 ms. CPU mostly idle but waking up frequently.

**Goal.** Eliminate polling.

**Solution.**

Use a `chan struct{}` signal.

```go
ready := make(chan struct{})

go func() {
    // ...
    close(ready)
}()

<-ready
process()
```

Latency drops to "as soon as ready" (sub-microsecond). No CPU usage while waiting.

---

## Exercise 10 — Cancellation latency

**Baseline.**

```go
for i := 0; i < 1_000_000_000; i++ {
    expensiveOp(i)
    select {
    case <-ctx.Done():
        return
    default:
    }
}
```

Cancellation check on every iteration is expensive (a few ns per channel poll) but bounds cancel latency to one iteration.

**Goal.** Reduce check cost without hurting cancel responsiveness.

**Solution.**

Check less frequently.

```go
for i := 0; i < 1_000_000_000; i++ {
    expensiveOp(i)
    if i%1000 == 0 {
        select {
        case <-ctx.Done():
            return
        default:
        }
    }
}
```

Worst-case cancel latency: 1000 iterations. Tunable based on iteration cost — aim for ~1 ms check interval.

---

## Exercise 11 — `defer` in a hot loop

**Baseline.**

```go
for _, x := range data {
    func() {
        mu.Lock()
        defer mu.Unlock()
        process(x)
    }()
}
```

`defer` has ~30 ns overhead per call. In a loop, this adds up.

**Goal.** Same correctness, less overhead.

**Solution (if the body is short and panic-free).**

```go
for _, x := range data {
    mu.Lock()
    process(x)
    mu.Unlock()
}
```

For long bodies with potential panics, keep `defer`. The "open-coded defer" optimisation in modern Go (1.14+) has reduced this overhead to ~10 ns in many cases, but in hot loops it still matters.

---

## Exercise 12 — Per-request allocation reduction

**Baseline.**

```go
http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    buf := make([]byte, 0, 4096)
    buf = append(buf, "..."...)
    w.Write(buf)
})
```

Each request allocates a 4 KB buffer. Garbage collector pressure rises.

**Goal.** Reuse buffers.

**Solution.**

```go
var bufPool = sync.Pool{
    New: func() interface{} { return new(bytes.Buffer) },
}

http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    buf := bufPool.Get().(*bytes.Buffer)
    defer func() {
        buf.Reset()
        bufPool.Put(buf)
    }()
    buf.WriteString("...")
    w.Write(buf.Bytes())
})
```

`sync.Pool` is per-P (one slot per logical processor), so contention is low. Allocations drop dramatically.

---

## Exercise 13 — Naive scatter-gather hits tail latency

**Baseline.**

```go
func Aggregate(ctx context.Context, urls []string) ([]string, error) {
    out := make([]string, len(urls))
    g, ctx := errgroup.WithContext(ctx)
    for i, u := range urls {
        i, u := i, u
        g.Go(func() error {
            b, err := fetch(ctx, u)
            out[i] = b
            return err
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return out, nil
}
```

Wait for all 10. P99 of any one is p99 of the aggregate, even if 9 are fast.

**Goal.** Reduce tail latency.

**Solution: hedged requests.**

After a delay, fire a duplicate request to a different backend; take whichever returns first.

```go
func fetchHedged(ctx context.Context, urls []string, delay time.Duration) (string, error) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()
    type result struct {
        body string
        err  error
    }
    out := make(chan result, len(urls))
    for i, u := range urls {
        if i > 0 {
            time.Sleep(delay)
        }
        select {
        case <-ctx.Done():
            return "", ctx.Err()
        default:
        }
        go func(u string) {
            b, err := fetch(ctx, u)
            out <- result{b, err}
        }(u)
    }
    var lastErr error
    for range urls {
        r := <-out
        if r.err == nil {
            return r.body, nil
        }
        lastErr = r.err
    }
    return "", lastErr
}
```

Tail drops because the slowest single request no longer determines the wait.

---

## Exercise 14 — Map iteration in concurrent code

**Baseline.**

```go
for k, v := range m {
    go process(k, v)
}
```

Spawns one goroutine per entry. For large maps this can be millions.

**Goal.** Bound concurrency.

**Solution.**

```go
sem := make(chan struct{}, 64)
var wg sync.WaitGroup
for k, v := range m {
    sem <- struct{}{}
    wg.Add(1)
    go func(k string, v Value) {
        defer wg.Done()
        defer func() { <-sem }()
        process(k, v)
    }(k, v)
}
wg.Wait()
```

64 in flight; the rest queue at the semaphore.

---

## Exercise 15 — Profiling guides the next change

Once you have optimised the obvious bottleneck, the next is non-obvious. Use the toolchain.

```bash
go test -cpuprofile cpu.out -bench .
go tool pprof -http=:8080 cpu.out
```

```bash
go test -mutexprofile mu.out -bench .
go tool pprof -http=:8081 mu.out
```

```bash
go test -trace trace.out -bench .
go tool trace trace.out
```

Common findings:

- **`runtime.lock` high in CPU profile.** Mutex contention. Shard, atomicise, or remove the lock.
- **`runtime.morestack` high.** Stack growth. Pre-size with `runtime.LockOSThread` and stack tuning, or reduce goroutine depth.
- **`runtime.mallocgc` high.** Allocation pressure. Pool buffers; reduce allocations.
- **`runtime.chansend` / `runtime.chanrecv` high.** Channel-heavy code. Consider batching or replacing with shared memory.

---

## Closing

Optimisation in concurrent code is a measurement-driven loop:

1. Profile.
2. Identify the bottleneck.
3. Hypothesise a fix.
4. Implement.
5. Measure: faster or not?
6. If not, revert.
7. If yes, find the next bottleneck.

Concurrency is rarely the answer to every question. Often the biggest wins come from *removing* concurrency (less contention, less coordination, less allocation). The general rule: profile first; only add concurrency where measurement says it pays.

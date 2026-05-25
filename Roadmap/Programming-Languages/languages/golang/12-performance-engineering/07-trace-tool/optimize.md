# The Go Execution Tracer — Optimize

## 1. The optimization loop

A repeatable trace-driven optimization loop has five steps:

1. **Measure**: a benchmark or load test that reproduces the regression.
2. **Capture**: a 2-5 s trace + a CPU profile of the same window.
3. **Read**: identify *one* shape — scheduler latency, GC pauses, contention, syscall blocks, under-parallelism.
4. **Change**: the smallest code edit that targets the shape.
5. **Verify**: re-measure; re-capture; compare.

Optimizing without this loop is guessing. The trace is what makes step 3 possible.

---

## 2. Scheduler latency — what to look for

Scheduler latency = time from a goroutine becoming `Runnable` to actually running. The number is in the goroutine analysis page, in the "Scheduler latency profile," and visible as pale slices in the flame view.

| Observation | Diagnosis |
|-------------|-----------|
| Sched wait < 100 µs | Healthy |
| Sched wait 100 µs - 1 ms occasionally | Normal load |
| Sched wait > 1 ms regularly | Oversubscription or P starvation |
| Sched wait > 10 ms | Severe; investigate immediately |

Sources of high sched wait:

- More goroutines runnable than `GOMAXPROCS`.
- A goroutine in a tight CPU loop holding a P without yielding (rare since Go 1.14 async preemption, but possible inside syscalls or cgo).
- GC mark-assist or STW consuming P time.

---

## 3. Fixing scheduler latency

The single most common fix: bound concurrency.

```go
// before: unbounded goroutines, sched wait dominates
for _, item := range items {
    go process(item)
}

// after: bounded by GOMAXPROCS
workers := runtime.GOMAXPROCS(0)
ch := make(chan Item)
var wg sync.WaitGroup
for i := 0; i < workers; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for it := range ch {
            process(it)
        }
    }()
}
for _, item := range items {
    ch <- item
}
close(ch)
wg.Wait()
```

In the trace before: thousands of pale (runnable) slices. After: each P stays busy, sched wait collapses to noise.

For mixed I/O + CPU workloads where blocking is dominant, you can over-provision goroutines beyond `GOMAXPROCS` — the Ps switch to whichever is runnable. Tune the worker count by trying `GOMAXPROCS`, `2*GOMAXPROCS`, `4*GOMAXPROCS` and reading the trace each time.

---

## 4. GC pauses — what to look for

The viewer shows STW (stop-the-world) bars in a dedicated lane. Two STW bars per cycle (sweep termination, mark termination), each ideally sub-millisecond.

| STW pause | Diagnosis |
|-----------|-----------|
| < 100 µs | Excellent |
| 100 µs - 1 ms | Normal |
| 1 ms - 10 ms | Investigate: large goroutine stacks, finalizers, or huge GOMAXPROCS |
| > 10 ms | Regression; bisect |

`runtime/metrics` `/gc/pauses:seconds` is the cheap histogram you should keep in dashboards alongside the trace.

---

## 5. Fixing GC pauses

| Symptom | Action |
|---------|--------|
| Frequent GC cycles | Reduce allocation rate (pool, preallocate, avoid interface boxing) |
| Long mark phase | Reduce live heap (often correlates) |
| Many `gcAssistAlloc` slices | Set `GOMEMLIMIT`; let the pacer give itself more headroom |
| Long STW mark termination | Large pointer-rich live heap; consider value-typed data structures |
| Pauses spike under load | Goroutine stack scan cost; reduce goroutine count |

A specific lever: `GOMEMLIMIT`. With a memory budget the pacer can pre-emptively run GC less often, reducing absolute pause count while keeping headroom for allocation spikes. The trade-off is more RSS for less GC CPU.

```go
import "runtime/debug"
debug.SetMemoryLimit(2 << 30) // 2 GiB cap
```

---

## 6. Syscall blocking — what to look for

Long `GoBlockSyscall` slices in the syscall blocking profile usually fall into three buckets:

| Pattern | Likely cause |
|---------|--------------|
| Long file `Read` / `Write` slices | Slow disk, large reads, no buffering |
| `getaddrinfo` style stacks | DNS resolution under load |
| cgo entry points | cgo call into a blocking C function |

A goroutine in a syscall releases its P; the cost is the syscall itself, not the scheduler. But the cost compounds: many concurrent blocking syscalls translate to many M threads created, which has its own overhead.

---

## 7. Fixing syscall blocking

```go
// before: one big read pulls 100 MB synchronously
data, _ := io.ReadAll(f)

// after: streaming with buffered reads
br := bufio.NewReaderSize(f, 64<<10)
for {
    line, err := br.ReadString('\n')
    if err != nil { break }
    process(line)
}
```

For DNS:
- Cache results in a `singleflight` group.
- Use a long-lived `net.Resolver` with explicit timeout.
- Avoid `net.Lookup*` in hot paths; resolve once at startup.

For cgo: minimize crossings; batch arguments into a single call.

---

## 8. Lock contention — what to look for

In the flame view, contention shows as:

- Many goroutines blocked on `GoBlockSync` simultaneously.
- One goroutine running for a long time inside a function that takes a mutex.
- The "Synchronization blocking profile" stacks dominated by `(*sync.Mutex).Lock`.

The mutex profile (`/debug/pprof/mutex`) ranks contention sites by total wait time; cross-reference with the trace's timeline to see when those waits actually happened.

---

## 9. Fixing lock contention

| Strategy | Use when |
|----------|----------|
| Shorten the critical section | Always first; move computation out of the lock |
| Partition the lock (sharded map) | Hot map; lookup keys distribute uniformly |
| Use `sync.RWMutex` | Read-heavy access |
| Replace with `atomic` or `sync.Map` | Counter-like or write-once patterns |
| Use channels | Coordination, not protection of shared state |
| Lock-free data structure | Only after benchmarking proves it pays |

```go
// before: one mutex per Cache
type Cache struct {
    mu   sync.Mutex
    data map[string]Value
}

// after: 256-shard map
type ShardedCache struct {
    shards [256]struct {
        mu   sync.Mutex
        data map[string]Value
    }
}

func (c *ShardedCache) shard(k string) *struct{...} {
    h := fnv.New32a(); h.Write([]byte(k))
    return &c.shards[h.Sum32()%256]
}
```

After: in the trace, `GoBlockSync` count drops by ~256× under uniform key distribution.

---

## 10. Under-parallelism — what to look for

A wide trace with most P lanes empty and one goroutine running continuously:

- The CPU profile shows one hot function.
- The trace shows that function running on one P while others wait on its result.

This is the most common shape in code that *looks* parallel but isn't — e.g., a parallel loop where each iteration takes a turn on a global lock, a fan-out that secretly serializes on a DB connection pool of size 1.

---

## 11. Fixing under-parallelism

```go
// before: appears parallel, secretly serial
for _, id := range ids {
    go func(id int) {
        result := slowOp(id)         // shares a Mutex inside
        results.Store(id, result)
    }(id)
}

// after: actually parallel — partitioned state
type ShardedResults struct { ... }
for _, id := range ids {
    go func(id int) {
        result := slowOp(id)         // no shared lock
        shardedResults.Store(id, result)
    }(id)
}
```

Verification step: in the trace, all `GOMAXPROCS` P lanes should be busy. If they aren't, the "parallel" code is still serial somewhere.

---

## 12. Goroutine churn — invisible until it isn't

A program that spawns a new goroutine per request, lets it run for microseconds, then exits, looks fine in the CPU profile (the goroutine work is cheap). But the trace tells a different story:

| Event | Cost |
|-------|------|
| `GoCreate` | ~200 ns (stack init, runtime bookkeeping) |
| `GoEnd` | ~100 ns |
| Scheduler queue insertion | ~50 ns |
| GC mark of new goroutine's stack | proportional to depth |

At a million goroutines per second, that's milliseconds per second of pure overhead, plus GC pressure from short-lived stack frames.

Fix: a pool of long-lived workers fed by a channel.

---

## 13. Allocation storms

In the heap chart you'll see `live` climbing rapidly, hitting the goal line, GC triggering, and repeating. The flame view shows `gcBgMarkWorker` and `gcAssistAlloc` slices interspersed with your code.

Diagnose with CPU pprof `-alloc_objects`. Common storms:

- `fmt.Sprintf` in hot loops.
- `[]byte(string)` and `string([]byte)` conversions.
- `interface{}` boxing on small values.
- `json.Unmarshal` into `map[string]interface{}`.
- New regex on every call (`regexp.MustCompile` inside the handler).

Each fix moves the trace's heap chart from sawtooth-fast to sawtooth-slow.

---

## 14. Network call latency stacking

Two RPCs to two services from the same handler:

```go
a := serviceA.Get(ctx, id)
b := serviceB.Get(ctx, id)
```

In the trace, the handler goroutine has two `GoBlockNet` gaps in sequence. Total latency ≈ A + B.

Fix:

```go
g, ctx := errgroup.WithContext(ctx)
var a, b Result
g.Go(func() error { var err error; a, err = serviceA.Get(ctx, id); return err })
g.Go(func() error { var err error; b, err = serviceB.Get(ctx, id); return err })
if err := g.Wait(); err != nil { return err }
```

After: two child goroutines, each `GoBlockNet` once, in parallel. Total ≈ max(A, B). The trace shows the gaps overlap.

---

## 15. Preallocation wins, by signal

| Pattern | Trace signal before | After fix |
|---------|---------------------|-----------|
| `slice = append(slice, x...)` | Frequent `growslice` slices | One allocation |
| `m := make(map[K]V)` no hint | Bucket-resize events | One resize |
| `buf := bytes.Buffer{}` per request | `bytes.Buffer.Grow` slices | `sync.Pool`'d buffer |
| Many small `*Foo` allocations | Heap chart sawtooth | Slab/arena |

The trace doesn't directly show "growslice" by name, but the heap-chart sawtooth and `gcAssistAlloc` density are reliable proxies. Combined with a CPU profile of `runtime.growslice`, the picture is clear.

---

## 16. Goroutine lifetime regions — for handler latency

Annotate every handler phase:

```go
trace.WithRegion(ctx, "parse",  func() { ... })
trace.WithRegion(ctx, "auth",   func() { ... })
trace.WithRegion(ctx, "db",     func() { ... })
trace.WithRegion(ctx, "render", func() { ... })
```

In the "User-defined regions" page, sort by total time. The region with the most wall-clock attention is where to focus. This is the cheapest, fastest "where is the time going in this handler" technique in the language.

---

## 17. Cross-tool verification: trace + benchstat

After a change, re-run the benchmark with `-trace` *and* the standard time/alloc benchmarks. Use `benchstat` to confirm time and allocation deltas; use the trace to confirm the *mechanism* changed (less sched wait, fewer GC cycles, less contention).

```bash
go test -bench=BenchmarkX -count=10 -benchmem -trace=trace.out ./... > new.txt
benchstat old.txt new.txt
go tool trace trace.out
```

If `benchstat` says "no significant change" but the trace shows different behavior, you've measured the wrong thing.

---

## 18. What the trace *won't* fix for you

- A bad algorithm. The trace shows you what the program is doing, not what it should do.
- A poor cache hit rate. The trace doesn't see L1/L2/L3.
- TLB misses, branch mispredictions, NUMA effects. Those need `perf` and friends.
- Bugs in third-party C libraries called via cgo.

The trace's domain is the Go runtime's view of the world. For below-the-runtime questions, use `perf record -p $PID --call-graph dwarf` and `go tool pprof` on the resulting profile.

---

## 19. Summary

Optimization with the trace is a five-step loop: measure, capture, read one shape, change, verify. The high-value shapes to recognize are scheduler latency (oversubscription), GC pauses (allocation pressure), syscall blocking (slow I/O or DNS), lock contention (long critical sections), under-parallelism (hidden serial bottleneck), and allocation storms. Each maps to a small set of well-known fixes. Verify with `benchstat` for numbers and the trace itself for mechanism.

---

## Further reading
- Go diagnostics guide: https://go.dev/doc/diagnostics
- Felix Geisendorfer, "Reading a Go trace": https://blog.felixge.de/reading-go-execution-traces/
- Go GC guide: https://go.dev/doc/gc-guide
- `benchstat` documentation: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat

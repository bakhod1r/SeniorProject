# What is Concurrency — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Amdahl's Law in Detail](#amdahls-law-in-detail)
3. [Gustafson's Law: The Optimist's Counterpoint](#gustafsons-law-the-optimists-counterpoint)
4. [Classifying Workloads](#classifying-workloads)
5. [Scheduling Models, Briefly](#scheduling-models-briefly)
6. [The Go Concurrency Toolkit](#the-go-concurrency-toolkit)
7. [Patterns in Practice](#patterns-in-practice)
8. [Throughput vs Latency Trade-offs](#throughput-vs-latency-trade-offs)
9. [Backpressure and Flow Control](#backpressure-and-flow-control)
10. [Bottleneck Migration](#bottleneck-migration)
11. [Concurrency Anti-Patterns](#concurrency-anti-patterns)
12. [Testing Concurrent Code](#testing-concurrent-code)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## Introduction

At the junior level you learned that concurrency is the property of multiple logical tasks coexisting over a time interval, and that parallelism is one possible execution outcome of that property. You wrote your first `go` statements, hid I/O latency with goroutines, and saw cases where concurrency *hurts* performance.

At this level we treat concurrency as a *design tool*: we reason about *when* to use it, *how much* of it, what speedup we can expect, and what unexpected costs show up at scale. The key shift is from "I know how to write `go f()`" to "I know whether `go f()` is the right answer to this particular problem."

After this you will:

- Apply Amdahl's and Gustafson's laws to estimate expected speedups.
- Classify a workload as I/O-bound, CPU-bound, mixed, or memory-bandwidth-bound.
- Pick the right concurrency primitive for the question you are answering.
- Recognise common patterns: fan-out / fan-in, pipeline, worker pool, scatter-gather.
- Anticipate where concurrency moves the bottleneck rather than removing it.
- Write tests and benchmarks that exercise concurrent code seriously.

---

## Amdahl's Law in Detail

In 1967 Gene Amdahl observed that the speedup from parallelism is bounded by the serial fraction of a program. If `p` is the fraction of work that can run in parallel and `n` is the number of processors, then the maximum speedup is:

```
S(n) = 1 / ((1 - p) + p / n)
```

A few concrete points:

| Serial fraction (1-p) | Speedup at n=4 | Speedup at n=16 | Speedup at n=∞ |
|---|---|---|---|
| 0% (perfectly parallel) | 4.00x | 16.00x | ∞ |
| 5% | 3.48x | 9.14x | 20x |
| 10% | 3.08x | 6.40x | 10x |
| 30% | 2.11x | 2.91x | 3.33x |
| 50% | 1.60x | 1.88x | 2x |

The point of the law is sobering: even a small serial fraction caps the speedup. A program that is 95% parallelisable maxes out at 20x speedup *no matter how many cores you throw at it*.

### What counts as "serial"?

Any code that cannot run in parallel with itself:

- Mutex-protected critical sections.
- Single-threaded I/O (one DB connection, one log file writer).
- Lookups in a shared cache that requires a write lock to refresh.
- Result aggregation at the end (you must combine partial results sequentially).
- Process startup, setup, and teardown.

Some of these are unavoidable; others can be reduced (sharded caches, lock-free data structures, partition-by-key). The work of senior engineering is shrinking the serial fraction.

### Real-world implications

If you observe a Go service whose median latency improves by 1.4x when you double the cores, and you assumed it would improve by 2x, run the numbers: an apparent serial fraction of ~30% explains the gap. Find it (it is usually a lock or a single connection) and shrink it.

---

## Gustafson's Law: The Optimist's Counterpoint

Amdahl assumes the *problem size is fixed*. In practice, when we add cores, we often grow the problem to match — render a higher-resolution image, process a longer log, train a bigger model. Gustafson's law restates speedup under that assumption:

```
S(n) = n - (1 - p) * (n - 1)
```

Under Gustafson, speedup grows roughly linearly with `n` as long as the parallel portion grows with the problem and the serial portion stays roughly constant. This is the "weak scaling" perspective, and it explains why large clusters can still deliver value despite Amdahl.

For everyday Go services, Amdahl is the more useful frame because we usually have a *fixed* request to serve and we want it served faster. Gustafson applies when we ask "can I process 10x more data with 10x more machines?" — usually yes, if the work shards well.

---

## Classifying Workloads

The single most important question before using concurrency: **what is this workload bottlenecked on?**

### I/O-bound

The CPU spends most of its time waiting for an external resource. Examples:

- HTTP API server waiting on a database.
- Crawler waiting on remote servers.
- ETL job reading from disk and writing to disk.
- Service mesh proxying between backends.

**Concurrency strategy:** many goroutines, each blocked on its own I/O. The Go runtime parks blocked goroutines and reuses threads to run other ones. Scaling is bounded by the I/O subsystem (connections, file descriptors, network bandwidth), not by CPU.

### CPU-bound

The CPU spends most of its time computing. Examples:

- Image compression / decompression.
- Cryptographic hashing.
- Game physics simulation.
- Search index ranking.

**Concurrency strategy:** roughly one goroutine per core (or per logical CPU). More than `GOMAXPROCS` runnable goroutines just thrashes the scheduler. Scaling is bounded by Amdahl and by hardware (cache, memory bandwidth).

### Mixed

Real workloads are usually a blend: a request does some I/O (DB), some CPU (template render), more I/O (write response). The goroutine model handles this naturally: each goroutine flows through CPU and I/O phases, parked when blocked, scheduled when ready.

**Concurrency strategy:** one goroutine per request, with the goroutine count somewhat higher than core count to keep cores busy while others wait on I/O. Profile to confirm.

### Memory-bandwidth-bound

A subtle but important case. Code that streams large arrays may be limited by RAM throughput rather than CPU. Adding more cores does *not* help because they share the same memory bus.

Example: SIMD-style summation of a 10 GB array. One thread saturates the memory bus; eight threads each get 1/8 the bandwidth. Total throughput is the same.

**Concurrency strategy:** parallelism only up to the point where memory bandwidth is saturated. Often that is 2–4 cores, not all 32. Cache-friendly algorithms (blocking, tiling) help more than more threads.

### Latency-bound

The work could be done in a microsecond, but it is gated by an external slow event — a user click, a sensor reading every 100 ms. Concurrency does not "speed up" anything; it lets you do other work while waiting.

---

## Scheduling Models, Briefly

Three common models:

1. **1:1 — one OS thread per concurrent task.** Java, C, Rust (default `std::thread`). Simple but expensive: thousands of threads is the practical limit.
2. **N:1 — many user-space tasks on one OS thread.** Early Lua coroutines, Node.js's single-thread event loop. Cheap but cannot use multiple cores; one slow task starves everything else.
3. **M:N — many user-space tasks on M OS threads.** Erlang, Go, Project Loom (Java). Cheap *and* multi-core. The runtime decides which goroutine runs on which thread.

Go uses M:N scheduling. Goroutines are M (typically much larger than N), OS threads are N (typically bounded by `GOMAXPROCS`). The runtime balances the load. See `03-go-runtime-gmp` for the gory details.

---

## The Go Concurrency Toolkit

A quick taxonomy. Each tool corresponds to a question you might want to answer.

| Question | Tool |
|---|---|
| "Run this in the background." | `go f()` |
| "Wait for N goroutines to finish." | `sync.WaitGroup` |
| "Wait for N goroutines, with error propagation." | `errgroup.Group` |
| "Send data from one goroutine to another." | channel |
| "Pick whichever event happens first." | `select` |
| "Cancel a tree of goroutines." | `context.Context` |
| "Limit concurrency." | buffered channel as semaphore, `errgroup.SetLimit`, or `golang.org/x/sync/semaphore` |
| "Protect a shared variable." | `sync.Mutex`, `sync.RWMutex`, atomics |
| "Run once, even from many goroutines." | `sync.Once` |
| "Broadcast a state change." | `sync.Cond` (rarely needed; channels usually better) |
| "Reuse short-lived objects across goroutines." | `sync.Pool` |
| "Coordinate phased work." | `sync.WaitGroup` per phase, or `golang.org/x/sync/errgroup` with sub-groups |

Channels are not the answer to every question. Mutexes are not the answer to every question. Pick by intent.

---

## Patterns in Practice

### Fan-out / fan-in

Spawn N workers to process the same kind of work in parallel, then collect their results. Used when each unit of work is independent.

```go
func fanOut(jobs []Job) []Result {
    out := make([]Result, len(jobs))
    var wg sync.WaitGroup
    for i, j := range jobs {
        wg.Add(1)
        go func(i int, j Job) {
            defer wg.Done()
            out[i] = process(j)
        }(i, j)
    }
    wg.Wait()
    return out
}
```

Pre-allocated `out` slice avoids contention on a shared output channel.

### Pipeline

Multiple stages connected by channels. Each stage runs as its own goroutine; the channel buffers communicate between them.

```go
func pipeline() {
    stage1 := generate()
    stage2 := square(stage1)
    stage3 := filter(stage2)
    for v := range stage3 {
        fmt.Println(v)
    }
}

func generate() <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < 100; i++ {
            out <- i
        }
    }()
    return out
}

func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- v * v
        }
    }()
    return out
}

func filter(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            if v%2 == 0 {
                out <- v
            }
        }
    }()
    return out
}
```

Pipelines compose naturally: each stage is a goroutine + channel pair, taking input on one channel and writing output to the next.

### Worker pool

Bounded concurrency for unbounded input.

```go
func workerPool(jobs <-chan Job, workers int) <-chan Result {
    out := make(chan Result)
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range jobs {
                out <- process(j)
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

The pool size is your knob for "how concurrent." Too few and CPU is idle; too many and you thrash.

### Scatter-gather

Send the same query to N services in parallel, return the first acceptable answer.

```go
func first(ctx context.Context, urls []string) (string, error) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()
    type result struct {
        body string
        err  error
    }
    out := make(chan result, len(urls))
    for _, u := range urls {
        go func(u string) { out <- fetch(ctx, u) }(u)
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

Bonus: `cancel()` stops the losers, so resources are reclaimed.

---

## Throughput vs Latency Trade-offs

Concurrency affects two metrics independently:

- **Throughput** = tasks per second across the whole system. Concurrency almost always improves this for non-trivial workloads.
- **Latency** = time per task. Concurrency rarely improves latency for a single task. Usually it stays the same; sometimes it gets slightly worse (scheduling overhead, contention).

The classic confusion: a developer adds concurrency and complains that "individual requests are not faster." That is expected. The win is at the system level: more requests per second at the same per-request latency.

Two cases where concurrency *can* improve single-task latency:

1. The task can be split into independent sub-tasks that run on different cores. (CPU parallelism.)
2. The task can issue parallel I/Os that overlap their wait. (Parallel I/O, e.g., scatter-gather.)

If neither applies, concurrency cannot reduce a single task's latency; only throughput.

---

## Backpressure and Flow Control

A producer faster than its consumer creates a backlog. Without backpressure, the backlog grows until memory is exhausted.

Three common mechanisms in Go:

1. **Unbuffered channels.** Sends block until a receiver is ready. Built-in backpressure.
2. **Bounded buffered channels.** The buffer absorbs bursts; once full, sends block.
3. **Bounded goroutine pools.** A semaphore limits in-flight work.

```go
sem := make(chan struct{}, maxConcurrent)
for _, item := range items {
    sem <- struct{}{} // blocks if maxConcurrent in flight
    go func(item Item) {
        defer func() { <-sem }()
        process(item)
    }(item)
}
```

Choose the mechanism that matches the failure mode you want: blocking the producer (back-pressure), dropping work (load shedding), or buffering and hoping (asking for OOM).

---

## Bottleneck Migration

Adding concurrency rarely *removes* a bottleneck. It usually moves it. A naive pipeline:

```
Sequential : reader -> processor -> writer
             10 MB/s   100 MB/s    20 MB/s
             total = 6.67 MB/s (limited by min)
```

The processor is fast; the others are slow. Sequentially this is 6.67 MB/s. Now run each as a goroutine connected by channels:

```
Concurrent : reader || processor || writer
             10 MB/s   100 MB/s    20 MB/s
             total = 10 MB/s (limited by reader; writer keeps up since it's 2x)
```

But wait — the writer is now the bottleneck *for the reader* if the buffer fills. Actually the slowest stage still bounds throughput. The benefit is only that the *fast* stages no longer wait *between* batches; they keep working continuously.

If you want > 10 MB/s, you must speed up the reader or split it. The lesson: identify the actual bottleneck before adding concurrency. Concurrency without a target is decoration.

---

## Concurrency Anti-Patterns

### Goroutine per character

```go
for _, c := range s {
    go process(c)
}
```

Per-iteration scheduling cost vastly exceeds the per-iteration work. Just loop.

### Lock per access, fine-grained

```go
for _, x := range items {
    mu.Lock()
    sum += x
    mu.Unlock()
}
```

The lock acquire-release is more expensive than the addition. Batch updates or use atomics, or compute per-goroutine local sums and combine at the end.

### Channels as queues without ownership

A channel passed around with no clear "who closes it" leads to leaks (no close) or panics (double close). Always document ownership.

### Concurrent code without timeouts

A goroutine that blocks on a `chan` no one feeds, or on a network call with no deadline, leaks for the lifetime of the program. Always set a deadline or pair with a cancellation context.

### `time.Sleep` as synchronisation

"Just sleep 100 ms after spawning, it should be done by then." This is a flaky-test factory. Use `WaitGroup`, channels, or `errgroup`.

### Premature concurrency

Code added "in case we ever need to parallelise." It complicates today's code and rarely matches tomorrow's needs. Add concurrency when the measurement says it pays off.

---

## Testing Concurrent Code

### Race detector

```bash
go test -race ./...
```

The race detector catches unsynchronised concurrent accesses. It is the single highest-ROI tool in Go testing. Run it in CI on every commit.

Note: the detector observes only the executions it sees. A race that never happens during the test will not be caught. Combine with stress tests.

### Stress / repeat

```bash
go test -count=100 -race ./...
```

Or:

```bash
go test -run TestX -race -count=1000
```

Some races appear once in hundreds of runs.

### Benchmarks

```go
func BenchmarkConcurrent(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            doWork()
        }
    })
}
```

`RunParallel` spawns `GOMAXPROCS` goroutines and shares the iteration counter. Useful for measuring contention.

### Goroutine leak detection

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

`goleak` snapshots goroutines before and after; failures indicate a leak. Use in packages where leaks are the bug class you fear most.

---

## Self-Assessment

- [ ] I can write Amdahl's law and apply it to a 30%-serial workload.
- [ ] I can classify a workload as I/O-bound or CPU-bound by reading the code.
- [ ] I know which Go primitives to reach for given a coordination question.
- [ ] I have written code in at least three of the canonical patterns (fan-out, pipeline, worker pool, scatter-gather).
- [ ] I have measured a concurrent program's throughput and latency separately.
- [ ] I have used `go test -race` and at least once seen it catch a real bug.
- [ ] I have written a benchmark with `b.RunParallel`.
- [ ] I can describe the difference between back-pressure (block producer), load shedding (drop work), and buffering.
- [ ] I have refactored a piece of code to *remove* unnecessary concurrency.

---

## Summary

Concurrency is a design choice with quantifiable trade-offs. Amdahl's law caps the speedup of parallelism by the program's serial fraction. Gustafson reframes the same numbers for growing problem sizes. Workloads break roughly into I/O-bound, CPU-bound, mixed, and memory-bandwidth-bound — and each calls for a different concurrency strategy.

Go's M:N scheduler and tiny goroutines make concurrency cheap to express but not free in cost. The toolkit (channels, `sync` primitives, `context`, `errgroup`) gives you everything you need to compose patterns: fan-out / fan-in, pipelines, worker pools, scatter-gather. Adding concurrency moves bottlenecks rather than removing them; flow control prevents the new bottleneck from collapsing the system.

Measure, classify, pick the pattern, test under stress with the race detector. Concurrency that pays its weight is one of Go's biggest strengths. Concurrency that does not is one of its biggest cost centres.

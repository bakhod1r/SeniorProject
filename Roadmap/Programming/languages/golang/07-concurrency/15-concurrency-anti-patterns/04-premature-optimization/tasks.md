---
layout: default
title: Tasks
parent: Premature Optimization
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 7
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/04-premature-optimization/tasks/
---

# Premature Concurrency Optimization — Tasks

A series of 18 hands-on tasks to build measurement-driven concurrency intuition. Each task has a setup, instructions, expected outcomes, and reflection questions.

Run all tasks with:

```
go test -bench=. -count=10 -cpu=1,2,4,8 -benchmem
benchstat <baseline.txt> <candidate.txt>
```

---

## Task 1: Sequential vs concurrent sum

**Setup**: Write three implementations of summing a `[]float64`.

```go
// sumSeq: simple for-range loop
// sumParChunks: split into chunks, sum each in a goroutine, sum partial sums
// sumParAtomic: one goroutine per N items, atomic.AddInt64 to a global
```

**Instructions**:
1. Write benchmarks for N = 100, 1000, 10000, 100000, 1000000, 10000000.
2. Run `go test -bench=. -count=10 -cpu=1,2,4,8`.
3. Compute the crossover point: at what N does parallel start to win?
4. Compute the crossover point for atomic vs chunks.

**Expected outcomes**:
- `sumSeq` wins for small N (< ~100000).
- `sumParChunks` wins for large N.
- `sumParAtomic` loses to chunks because of cache contention.

**Reflection**:
- Why does `sumParAtomic` lose?
- What's the crossover N on your hardware?
- How does the crossover shift with `-cpu=2` vs `-cpu=8`?

---

## Task 2: Goroutine spawn overhead

**Setup**: Measure the cost of spawning a goroutine.

```go
func BenchmarkSpawn(b *testing.B) {
    var wg sync.WaitGroup
    for i := 0; i < b.N; i++ {
        wg.Add(1)
        go func() { wg.Done() }()
    }
    wg.Wait()
}

func BenchmarkSpawnParallel(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        var wg sync.WaitGroup
        for pb.Next() {
            wg.Add(1)
            go func() { wg.Done() }()
            wg.Wait()
        }
    })
}
```

**Instructions**:
1. Run both benchmarks.
2. Note the ns/op.
3. Compare to a similar benchmark using a worker pool with channel send/recv.

**Expected outcomes**:
- ~1 µs per spawn.
- Pool with channel: ~100-200 ns per dispatched task.

**Reflection**:
- When does the spawn cost matter?
- For 10 µs of work, what's the relative overhead?
- For 100 ns of work?

---

## Task 3: Channel send/recv cost

**Setup**: Measure channel cost in various scenarios.

```go
// BenchmarkChanBuffered: buffered channel, single producer, single consumer.
// BenchmarkChanUnbuffered: unbuffered channel, producer/consumer must sync.
// BenchmarkChanContended: N producers, 1 consumer.
// BenchmarkChanSelect: select with 2 cases.
```

**Instructions**:
1. Write all four benchmarks.
2. Measure per-op cost.
3. Compare to a mutex-protected slice.

**Expected outcomes**:
- Buffered, hot: ~50 ns/op.
- Unbuffered: ~250 ns/op.
- Contended: depends on N; higher per-op due to lock contention.
- Select: ~150 ns/op for 2 cases.
- Mutex-protected slice: ~30 ns/op.

**Reflection**:
- When is mutex-protected slice clearly better?
- When is buffered channel sufficient?
- When does unbuffered's sync semantics justify the cost?

---

## Task 4: False sharing demonstration

**Setup**: Two structs with adjacent vs padded fields.

```go
type Adjacent struct {
    A, B int64
}

type Padded struct {
    A int64
    _ [56]byte
    B int64
}
```

**Instructions**:
1. Write a benchmark with two goroutines, one incrementing `A` and one incrementing `B`.
2. Run with `Adjacent` and `Padded`.
3. Compare ns/op.

**Expected outcomes**:
- `Adjacent`: dramatically slower (4-8×) due to cache-line bouncing.
- `Padded`: near-baseline speed.

**Reflection**:
- What's the size of your CPU's cache line?
- Where else does false sharing hide in real code?
- How do you detect false sharing without already suspecting it?

---

## Task 5: Mutex vs RWMutex for short reads

**Setup**: A map with concurrent reads and rare writes.

```go
type CacheMutex struct {
    mu sync.Mutex
    m  map[string]string
}

type CacheRW struct {
    mu sync.RWMutex
    m  map[string]string
}
```

**Instructions**:
1. Implement Get/Set on both.
2. Benchmark `RunParallel` reads with rare writes.
3. Compare.

**Expected outcomes**:
- `Mutex` wins for short critical sections.
- `RWMutex` only wins if critical section is long (e.g. > 1 µs).

**Reflection**:
- For your map, how long is the critical section?
- Where would `RWMutex` actually help?
- Could you eliminate the lock entirely (copy-on-write)?

---

## Task 6: Sharded map breakeven

**Setup**: A map with concurrent access; compare single-mutex to sharded.

```go
type SingleMap struct {
    mu sync.Mutex
    m  map[string]int
}

type ShardedMap struct {
    shards []struct {
        mu sync.Mutex
        m  map[string]int
    }
}
```

**Instructions**:
1. Implement both.
2. Benchmark with varying contention (number of goroutines).
3. Find the breakeven: at what contention level does sharding win?

**Expected outcomes**:
- At low contention (1-4 goroutines), single map wins (hash overhead).
- At high contention (16+ goroutines), sharding wins.

**Reflection**:
- What's your production contention level?
- Does sharding pay off given that level?
- What's the right shard count for your workload?

---

## Task 7: sync.Pool benefit measurement

**Setup**: Allocate vs pool small buffers.

```go
// BenchmarkAlloc: make([]byte, size) per call.
// BenchmarkPool: get from sync.Pool, use, put back.
```

**Instructions**:
1. For sizes 64 B, 256 B, 1 KB, 4 KB, 16 KB.
2. Benchmark each.
3. Note `bytes/op` and `allocs/op`.

**Expected outcomes**:
- Pool overhead is comparable to allocation for small sizes.
- Pool clearly wins for sizes > 1 KB.

**Reflection**:
- At what size does pooling start to pay?
- What's the memory cost of the pool when full?
- When is `sync.Pool` wrong (e.g. mutable state)?

---

## Task 8: Worker pool sizing

**Setup**: A CPU-bound task with N workers.

```go
func cpuTask(x int) int {
    sum := 0
    for i := 0; i < 1000; i++ {
        sum += i * x
    }
    return sum
}

// Run with pools of size 1, 2, 4, 8, 16, 32.
```

**Instructions**:
1. Benchmark throughput at each size.
2. Plot throughput vs pool size.

**Expected outcomes**:
- Throughput rises with pool size up to `GOMAXPROCS`.
- Past that, diminishing returns.
- Beyond ~2× GOMAXPROCS, throughput may decline.

**Reflection**:
- What's the optimal size for your machine?
- Does the optimum shift with task cost?
- What if the task were I/O-bound?

---

## Task 9: I/O fan-out

**Setup**: Simulate 10 concurrent HTTP calls each taking 50 ms.

```go
func slowCall(ctx context.Context) error {
    time.Sleep(50 * time.Millisecond)
    return nil
}

// Sequential: 10 calls in a row = 500 ms.
// Parallel: 10 calls concurrent = ~50 ms.
```

**Instructions**:
1. Implement both.
2. Benchmark wall time.

**Expected outcomes**:
- Sequential: ~500 ms.
- Parallel: ~50 ms (limited by single call's latency).

**Reflection**:
- This is the textbook win for concurrency. Why?
- What happens if calls share a connection pool of size 5?
- How would you handle errors (first error vs all errors)?

---

## Task 10: Hedged execution

**Setup**: A backend with variable latency (mostly fast, occasionally slow).

```go
func variableCall() error {
    if rand.Float64() < 0.1 {
        time.Sleep(200 * time.Millisecond) // slow tail
    } else {
        time.Sleep(20 * time.Millisecond)
    }
    return nil
}
```

**Instructions**:
1. Implement a hedger: after 50 ms, fire a backup.
2. Benchmark p99 latency with and without hedging.

**Expected outcomes**:
- Without hedging: p99 ~200 ms.
- With hedging: p99 ~50-70 ms.
- Backend load: ~1.05× (5% of requests trigger hedge).

**Reflection**:
- When is hedging worth it?
- What if the backend is already at capacity?
- How would you measure the actual hedge rate?

---

## Task 11: Profile a slow function

**Setup**: A deliberately slow function.

```go
func slowFunc() {
    // Allocates a lot of garbage
    var s []byte
    for i := 0; i < 1000; i++ {
        s = append(s, byte(i%256))
    }
    // ... more wasteful work
}
```

**Instructions**:
1. Run benchmark with `-cpuprofile=cpu.prof -memprofile=mem.prof`.
2. Open both in `go tool pprof`.
3. Identify top consumers.

**Expected outcomes**:
- CPU profile shows where time goes.
- Memory profile shows allocation sites.

**Reflection**:
- What's the easiest optimization?
- Is concurrency the answer? (Hint: probably not for this kind of function.)

---

## Task 12: Trace a concurrent program

**Setup**: A small program with workers and a producer.

```go
func main() {
    items := make(chan int, 100)
    var wg sync.WaitGroup
    for w := 0; w < 4; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for x := range items {
                _ = x * x
            }
        }()
    }
    for i := 0; i < 1000; i++ {
        items <- i
    }
    close(items)
    wg.Wait()
}
```

**Instructions**:
1. Wrap with `trace.Start/Stop`.
2. Run; open `go tool trace`.
3. View the timeline.

**Expected outcomes**:
- Workers visible on multiple Ps.
- Channel send/recv events.
- Brief idle gaps.

**Reflection**:
- Are workers well-utilized?
- Where do they idle?
- How could you improve parallelism?

---

## Task 13: Compare two implementations with benchstat

**Setup**: Two implementations of the same function.

**Instructions**:
1. Implement both.
2. Run benchmarks with `-count=20` for each.
3. Compare with `benchstat`.

**Expected outcomes**:
- Clear winner with statistical significance, or
- No significant difference (p > 0.05).

**Reflection**:
- Was the winner what you expected?
- If not, why?
- Was the difference practically meaningful?

---

## Task 14: GOMAXPROCS sensitivity

**Setup**: A benchmark that's affected by GOMAXPROCS.

**Instructions**:
1. Run with `-cpu=1,2,4,8`.
2. Plot ns/op vs cpu.

**Expected outcomes**:
- Parallel benchmarks improve with more CPUs (up to a point).
- Beyond a point, returns diminish or reverse.

**Reflection**:
- What's the scaling curve?
- Is there an optimal `-cpu` for your machine?
- What if your container has a 2-CPU limit?

---

## Task 15: Identify a leak

**Setup**: A function that leaks goroutines.

```go
func leakyHandler() {
    go func() {
        time.Sleep(time.Hour)
    }()
}
```

**Instructions**:
1. Call it 100 times.
2. Check `runtime.NumGoroutine()`.
3. Grab a goroutine dump.

**Expected outcomes**:
- Goroutine count = 100+.
- Dump shows 100 goroutines in `time.Sleep`.

**Reflection**:
- How would you fix?
- How would CI catch this (hint: `goleak`)?

---

## Task 16: Remove unnecessary concurrency

**Setup**: A function with goroutines that shouldn't be there.

```go
func slowSum(xs []int) int {
    var wg sync.WaitGroup
    var mu sync.Mutex
    var sum int
    for _, x := range xs {
        x := x
        wg.Add(1)
        go func() {
            defer wg.Done()
            mu.Lock()
            sum += x
            mu.Unlock()
        }()
    }
    wg.Wait()
    return sum
}
```

**Instructions**:
1. Benchmark this.
2. Replace with a simple loop.
3. Compare.

**Expected outcomes**:
- The "concurrent" version is 100-1000× slower than the loop.
- The simple loop is the obvious choice.

**Reflection**:
- Why is this version slow?
- What was the (mistaken) intent?
- How would you spot this in code review?

---

## Task 17: Batch instead of fan out per item

**Setup**: Process a stream of small items.

```go
// BadDesign: spawn goroutine per item.
// GoodDesign: send batches of 100 items to a pool of workers.
```

**Instructions**:
1. Implement both.
2. Benchmark throughput.
3. Measure memory usage during benchmark.

**Expected outcomes**:
- BadDesign: high goroutine count, high GC pressure.
- GoodDesign: bounded goroutines, much higher throughput.

**Reflection**:
- What's the batch size sweet spot?
- How does it depend on item cost?

---

## Task 18: Optimize a real (open source) example

**Setup**: Pick a Go open source library you use.

**Instructions**:
1. Run a representative workload through it.
2. Profile.
3. Identify any premature optimizations (sharded maps, sync.Pool, etc.).
4. Try replacing with simpler alternatives.
5. Benchmark.

**Expected outcomes**:
- Sometimes the "optimization" pays off.
- Often a simpler version is competitive.

**Reflection**:
- Did the original optimization have a measurable justification?
- Could you contribute a simplification PR?
- What did you learn about library performance?

---

## Wrap-up

After completing these tasks, you should have:

- Concrete intuition for when concurrency wins and loses.
- Familiarity with profiling tools.
- Experience with `benchstat`.
- Skepticism toward unmeasured optimizations.

The discipline is the durable outcome. Apply it in your own code.

End of tasks.

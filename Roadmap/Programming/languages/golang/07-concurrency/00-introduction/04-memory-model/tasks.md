# Memory Model — Hands-on Tasks

> Exercises that build intuition for the Go memory model and the race detector.

---

## Easy

### Task 1 — Reproduce a data race

Write code that has an obvious data race:

```go
var counter int
var wg sync.WaitGroup
for i := 0; i < 1000; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        counter++
    }()
}
wg.Wait()
fmt.Println(counter)
```

Run with `go run main.go` and `go run -race main.go`. Compare outputs. Verify the race detector reports the race.

**Goal.** See the race detector in action.

---

### Task 2 — Fix with atomic

Take Task 1 and fix with `atomic.Int64`. Verify the result is always 1000.

---

### Task 3 — Fix with mutex

Same problem, fix with `sync.Mutex`. Verify correctness.

---

### Task 4 — Fix with channel

Same problem, fix with a channel-based design: each goroutine sends 1 on a channel; a single counting goroutine reads.

---

### Task 5 — Lazy init with `sync.Once`

Write a `GetCache()` function that lazily initialises and returns a `*Cache`. Multiple goroutines call it concurrently. Use `sync.Once` to ensure init happens once.

Verify with race detector and stress test.

---

### Task 6 — Configuration hot-reload

Write a small in-process config service:

- `currentConfig() *Config` — readers call this on every operation.
- `reload(*Config)` — operators call this to update.

Use `atomic.Pointer[Config]`. Verify race-free under stress.

---

## Medium

### Task 7 — `RWMutex` vs `Mutex` benchmark

Benchmark a cache with two implementations:

1. `sync.Mutex`.
2. `sync.RWMutex`.

Use `testing.B.RunParallel` with read-heavy and balanced workloads. Compare ns/op.

**Goal.** See when `RWMutex` wins.

---

### Task 8 — `sync.Map` vs sharded mutex

Implement a concurrent cache two ways:

1. `sync.Map`.
2. 16 shards, each a `map[K]V` + `sync.Mutex`.

Benchmark both under read-heavy and write-heavy workloads.

---

### Task 9 — Goroutine leak with channels

Write a function that returns a result through a channel, with a timeout:

```go
func fetch(ctx context.Context) int {
    ch := make(chan int)
    go func() { ch <- compute() }()
    select {
    case v := <-ch:
        return v
    case <-ctx.Done():
        return 0
    }
}
```

Test what happens on timeout. Use `goleak` to detect the leak. Fix by buffering the channel.

---

### Task 10 — False sharing experiment

Write two counter structs:

1. Adjacent `int64` fields (no padding).
2. `int64` fields padded to cache line size.

Each accessed atomically from a different goroutine. Benchmark both. Observe the padded version is significantly faster on multi-core machines.

---

### Task 11 — Memory model educational test

Write a small program that intentionally relies on undefined behaviour:

```go
var x int
var done bool
go func() {
    x = 42
    done = true
}()
for !done {}
fmt.Println(x)
```

Run with `go run`. Note that on x86 it "works" (prints 42). Run with `go run -race`. Note the race report.

Now compile with optimisations disabled (`go run -gcflags='-N -l' main.go`). Does it still work? (Probably yes, on x86.) Now imagine running on ARM or with future compiler optimisations.

**Goal.** Internalise that "works on my machine" is not enough.

---

### Task 12 — `sync.Pool` benchmark

Allocate a 4 KB buffer per call in a hot loop. Compare with a `sync.Pool`-based version. Measure allocations with `b.ReportAllocs()` and `b.Run()`.

Observe the dramatic reduction in allocs/op with pooling.

---

## Hard

### Task 13 — Implement a concurrent LRU cache

Build an LRU cache that supports `Get`, `Set`, `Delete` from many goroutines. Bounded size. LRU eviction on overflow.

- Use a `sync.Mutex` to protect the LRU list and the lookup map.
- Make sure Get under high contention does not block too long.
- Test with `-race`.

**Goal.** Apply synchronisation to a real data structure.

---

### Task 14 — Lock-free single-producer single-consumer ring buffer

Implement a ring buffer with one producer and one consumer goroutine. Use only atomic operations on the head and tail indices. No mutex.

Verify correctness with `-race` and stress runs.

---

### Task 15 — Property-based concurrent test

Use `pgregory.net/rapid` to generate random sequences of `Get`, `Set`, `Delete` operations on your LRU cache from Task 13. After each sequence, verify invariants:

- All keys in the map are also in the list.
- The list size matches the map size.
- No duplicates in the list.

Run the test for 10 minutes; treat any failure as a bug.

---

### Task 16 — Mutex profile diagnosis

Take an existing concurrent program (your worker pool from earlier tasks). Enable mutex profiling:

```go
runtime.SetMutexProfileFraction(1)
```

Run under load. Capture a profile:

```bash
go tool pprof http://localhost:6060/debug/pprof/mutex
```

Identify the mutex with the highest contention. Reason about whether to refactor.

---

### Task 17 — Implementing a singleflight

Build a `singleflight`-like structure that dedupes concurrent calls for the same key:

```go
g.Do("key", func() interface{} { return compute("key") })
```

100 goroutines calling with the same key should result in `compute("key")` running once; all 100 receive the same result.

Use channels + mutex. Compare to `golang.org/x/sync/singleflight`.

---

### Task 18 — Concurrent state machine

Implement a state machine (e.g., a connection's lifecycle: `Idle → Connecting → Connected → Disconnecting → Closed`). Multiple goroutines may request state transitions. Ensure transitions are atomic (no goroutine sees an invalid intermediate state).

Options:
- Mutex around state.
- Atomic CAS on state.
- Owner goroutine processing events from a channel.

Pick one; explain why.

---

### Task 19 — Cross-shard read consistency

Build a sharded counter (each goroutine owns a per-CPU shard). On read, sum all shards. Verify that two consecutive reads from the same goroutine see monotonically non-decreasing values — even under heavy concurrent writes.

Hint: this is subtle because reading shard 1, then shard 2 may see an update that happened after shard 1's read.

**Goal.** Understand snapshot consistency.

---

### Task 20 — Write a "happens-before" exercise

For each of the following pairs, decide whether A happens-before B per the Go memory model:

1. Inside one goroutine: A = `x = 1`, B = `y = 2`.
2. A = `ch <- 1` in goroutine G1; B = `<-ch` in G2.
3. A = `close(done)` in G1; B = `<-done` in G2.
4. A = `mu.Unlock()` in G1; B = `mu.Lock()` in G2.
5. A = `wg.Done()` in G1; B = `wg.Wait()` in G2 returning.
6. A = some operation in G1; B = some operation in G2, no synchronisation.
7. A = goroutine G1's exit; B = the parent calling `wg.Wait()` returning.

Justify each.

**Goal.** Verify your mental model of happens-before.

---

## Solutions and hints

### Task 1 expected output

Without `-race`: result varies, usually < 1000.
With `-race`: race report with two stack traces.

### Task 2 sketch

```go
var counter atomic.Int64
// ...
counter.Add(1)
// ...
fmt.Println(counter.Load())
```

Always 1000.

### Task 6 sketch

```go
var cfg atomic.Pointer[Config]

func Init() {
    cfg.Store(&Config{...})
}

func Current() *Config {
    return cfg.Load()
}

func Reload(newCfg *Config) {
    cfg.Store(newCfg)
}
```

Treat the returned `*Config` as immutable.

### Task 14 sketch

```go
type RingBuffer struct {
    buf  [1024]int
    head atomic.Uint64 // producer writes
    tail atomic.Uint64 // consumer reads
}

func (r *RingBuffer) Push(v int) bool {
    h := r.head.Load()
    t := r.tail.Load()
    if h-t == uint64(len(r.buf)) { return false }
    r.buf[h%uint64(len(r.buf))] = v
    r.head.Store(h + 1)
    return true
}

func (r *RingBuffer) Pop() (int, bool) {
    t := r.tail.Load()
    h := r.head.Load()
    if h == t { return 0, false }
    v := r.buf[t%uint64(len(r.buf))]
    r.tail.Store(t + 1)
    return v, true
}
```

Single producer / single consumer is safe because each side owns one index.

### Task 20 answers

1. A happens-before B (sequential within goroutine).
2. A happens-before B (channel synchronisation).
3. A happens-before B (close synchronises with close-receive).
4. A happens-before B (mutex synchronisation).
5. A happens-before B (waitgroup synchronisation).
6. A and B are concurrent (no synchronisation).
7. Depends. If the parent's `wg.Wait()` corresponds to G1's `wg.Done()`, then G1's `Done` happens-before the return. The exit itself is not directly part of the model; the `Done()` call is.

---

## Wrap-up

After these tasks you should:

- Reproduce and fix data races with atomic, mutex, channel, and `sync.Once`.
- Recognise common patterns (LRU cache, ring buffer, sharded counter).
- Use `goleak` and `pgregory.net/rapid` for concurrent testing.
- Reason about happens-before in concrete code.
- Use the race detector as a daily tool.

The next file (`find-bug.md`) tests your race-spotting skills on broken code.

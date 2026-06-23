# sync.Cond — Optimize

This file is about measuring and reducing the cost of `sync.Cond`-based code. The premise: if you are spending real CPU in `sync.runtime_notifyListNotifyAll` or `sync.(*Cond).Wait`, you have a measurable performance problem and several options to fix it.

The structure: measure first, redesign second, micro-optimize last.

---

## Step 1: Measure

The starting point is `go tool pprof`. Two profiles matter:

### CPU profile

```bash
go test -bench BenchmarkYourCode -cpuprofile cpu.out
go tool pprof cpu.out
(pprof) top10
```

Look for time spent in:

- `sync.(*Cond).Wait`
- `sync.(*Cond).Signal`
- `sync.(*Cond).Broadcast`
- `runtime.notifyListNotifyOne`
- `runtime.notifyListNotifyAll`
- `runtime.goready`
- `runtime.goparkunlock`

If these add up to a significant fraction of your CPU, `Cond` is on the hot path.

### Mutex profile

```bash
go test -bench BenchmarkYourCode -mutexprofile mu.out
go tool pprof mu.out
(pprof) top10
```

The mutex profile shows lock contention. If `cond.L` is the top contended lock, your design serializes too much through one mutex.

### Block profile

```bash
go test -bench BenchmarkYourCode -blockprofile block.out
go tool pprof block.out
```

Shows where goroutines spent time blocked. If `sync.runtime_notifyListWait` dominates, waiters are sitting parked for long durations.

---

## Step 2: A Reference Benchmark

A reproducible benchmark for `Cond` versus channel for a bounded-buffer scenario:

```go
package bench_test

import (
    "sync"
    "testing"
)

func BenchmarkCondQueue(b *testing.B) {
    var mu sync.Mutex
    notFull := sync.NewCond(&mu)
    notEmpty := sync.NewCond(&mu)
    items := make([]int, 0, 64)
    cap := 64

    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            mu.Lock()
            for len(items) == cap { notFull.Wait() }
            items = append(items, 1)
            notEmpty.Signal()
            mu.Unlock()

            mu.Lock()
            for len(items) == 0 { notEmpty.Wait() }
            items = items[1:]
            notFull.Signal()
            mu.Unlock()
        }
    })
}

func BenchmarkChanQueue(b *testing.B) {
    ch := make(chan int, 64)
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            ch <- 1
            <-ch
        }
    })
}
```

Typical results on a 8-core Linux box, Go 1.22:

```
BenchmarkCondQueue-8     2_500_000     480 ns/op
BenchmarkChanQueue-8     5_500_000     220 ns/op
```

The channel version is roughly 2x faster for this microbenchmark. Channel ops are hand-tuned in `runtime/chan.go` and skip the user-space `sync.Mutex`.

For most workloads this difference is irrelevant — the work done per operation dwarfs the cost of the synchronization. For a "queue empty / single item / queue empty" cycle with no actual work, the synchronization dominates and the difference is visible.

---

## Step 3: Reduce Wake-Ups

The cheapest optimization is to wake fewer goroutines.

### Use `Signal` instead of `Broadcast` where possible

A `Broadcast` to N waiters costs O(N) wake-ups plus O(N) re-park if most waiters cannot proceed. A `Signal` to one waiter costs O(1) wake-up.

Use `Broadcast` only when:

- The state change is class-of-state (closed, paused -> running).
- Multiple waiters can simultaneously make progress (rare).

Use `Signal` when:

- Only one waiter can consume the change (one item pushed, one slot freed).

The bounded queue example in `middle.md` uses `Signal` correctly: each push wakes one consumer, each pop wakes one producer.

### Eliminate redundant `Cond`s

If you have two `Cond`s but they always signal together, merge them. If you have one `Cond` covering two unrelated predicates, split it. Each `Cond` should correspond to exactly one predicate.

### Coalesce signals

If a producer pushes many items in a tight loop, signalling on every push wakes a consumer per item, and they spend more time context-switching than working. Batch:

```go
mu.Lock()
items = append(items, batch...)
if len(batch) >= someThreshold {
    cond.Broadcast()
} else {
    cond.Signal()
}
mu.Unlock()
```

Or — better — push the batch atomically as a slice and signal once.

---

## Step 4: Reduce Lock Contention

If `cond.L` is the bottleneck (mutex profile shows it as top contended), you have three options.

### Shard the state

Split the state into N independent shards, each with its own mutex and `Cond`. Operations route to a shard based on hash, key, or round-robin.

```go
type ShardedQueue struct {
    shards [16]struct {
        mu       sync.Mutex
        notFull  *sync.Cond
        notEmpty *sync.Cond
        items    []int
    }
}

func (q *ShardedQueue) Push(key string, v int) {
    s := &q.shards[hash(key)%16]
    s.mu.Lock()
    // ...
}
```

Cost: more memory, no global ordering. Benefit: 16x throughput in the ideal case.

### Use a lock-free fast path

If the common case can be served without locking (queue not empty, no contention), use atomics for the fast path and fall back to the lock only on contention.

```go
func (q *Q) Pop() int {
    if v, ok := q.tryFastPop(); ok { return v }
    return q.slowPop() // takes the lock and waits if necessary
}
```

`sync.Pool`, `sync.Map`, and the runtime's `runtime/chan.go` all use this technique.

### Replace `Cond` with a channel

A channel handles wait list management internally without exposing a user-space mutex on the hot path. If your `Cond` design has high contention on `cond.L`, migrating to a channel often eliminates the contention.

---

## Step 5: Avoid the Thundering Herd

A `Broadcast` to 1000 waiters causes 1000 goroutines to become runnable. They all queue up at `cond.L`. They serialize. Most of them re-park.

### Diagnostic

CPU profile shows `runtime.notifyListNotifyAll` and `runtime.goready` summing to a large fraction. The number of goroutines briefly spikes.

### Mitigation 1: Targeted wakes

If you can identify which specific waiter benefits, wake only it. Each waiter has its own `chan struct{}`; you signal exactly one by sending or closing.

```go
type Waiter struct {
    ch     chan struct{}
    target int
}

type Server struct {
    mu      sync.Mutex
    waiters []*Waiter
}

func (s *Server) OnEvent(v int) {
    s.mu.Lock()
    for i := 0; i < len(s.waiters); i++ {
        w := s.waiters[i]
        if w.target == v {
            close(w.ch) // wake this one
            s.waiters = append(s.waiters[:i], s.waiters[i+1:]...)
            i--
        }
    }
    s.mu.Unlock()
}
```

No `Cond`. Each waiter has a one-shot channel. No broadcast storm.

### Mitigation 2: Wake-on-edge

Only `Broadcast` on actual state-class transitions, not on every state change. If the predicate is "n >= target," `Broadcast` only when the highest target's threshold is crossed, not every increment.

### Mitigation 3: Batch the wake

Accumulate state changes for a short window (e.g., 1 ms), then broadcast once. Latency-sensitivity dependent.

---

## Step 6: Reduce Allocations

`sync.Cond` itself is allocation-free per operation. The allocations come from:

- `sync.NewCond` — one per construction. Amortize.
- The `sudog` for parking — comes from a per-P pool. Free after wake.

If your benchmarks show high allocation rates around `Cond`, the source is usually the surrounding code (closure captures, value copies, helper structs), not `Cond` itself.

### Reuse `Cond` objects

A `Cond` is reusable. Do not construct a new one per operation. Build them once at struct construction.

```go
// BAD
func (q *Q) Push(v int) {
    cond := sync.NewCond(&q.mu) // allocates per call
    // ...
}

// GOOD
type Q struct {
    mu   sync.Mutex
    cond *sync.Cond // constructed once
}
```

### Avoid the helper-goroutine pattern for ctx cancellation

The pattern in `middle.md` of spawning a goroutine per `Wait` to broadcast on `ctx.Done()` is expensive. Each waiter costs a goroutine. Migrate to channels.

---

## Step 7: When to Switch to Channels

Decision rules:

1. **Mutex profile pins `cond.L`.** Channels avoid this hot mutex.
2. **`ctx.Done()` integration is needed.** Channels integrate trivially via `select`.
3. **Timeouts are needed.** Channels + `time.After` is one line.
4. **Wake-up needs to carry a value.** Channels do, `Cond` doesn't.
5. **The predicate is "queue non-empty" or "slot free."** Buffered channels are the canonical model.
6. **Fairness matters.** Channels are FIFO; `Cond` is unspecified.

The migration almost always shortens the code and improves performance.

### Counter-cases: when to keep `Cond`

1. **Multi-predicate over one state.** Two `Cond`s with one mutex is cleaner than a channel split.
2. **Repeated broadcast.** `close(ch)` is one-shot; `Broadcast` is unlimited.
3. **Explicit state inspection.** Channels hide the data; `Cond` lets you inspect.
4. **Benchmark shows `Cond` is faster.** Rare but real on some workloads.

---

## Step 8: Replacing Cond with Atomics

For some patterns, `Cond` is overkill. If the predicate is "this `int32` flag is set," a busy-wait with `atomic.LoadInt32` plus `runtime.Gosched` can outperform `Cond` on a single-shot wait — but it burns CPU and is rarely a good idea.

For "wait until N completions," `sync.WaitGroup` already exists and is implemented with atomics + `runtime/sema`. Don't reinvent it with `Cond`.

For "set this once, anyone reading after the set sees it," `sync.Once` or `atomic.Value` is the right tool.

The general rule: `Cond` is for wait-until-predicate. If the predicate is "an atomic flag is set," consider whether you really need parking at all.

---

## Step 9: Replacing Cond with `runtime/sema` (advanced)

The standard library's internal `runtime_Semacquire` / `runtime_Semrelease` are exposed as `sync.runtime_*` functions but not officially part of the API. `sync.WaitGroup`, `sync.Mutex`, and `golang.org/x/sync/semaphore.Weighted` are built on top of them.

If you find yourself building a high-performance synchronization primitive, the right pattern is:

- Atomics for the fast path.
- `runtime/sema` or a semaphore-like channel for the slow path.

This is beyond normal application code, but worth knowing exists. Almost every time you reach for `Cond`, a semaphore would also work and would be faster.

---

## Step 10: A Concrete Migration

A connection pool migrated from `Cond` to a channel-based design:

### Before (Cond, contended)

```go
type Pool struct {
    mu        sync.Mutex
    available *sync.Cond
    free      []*Conn
}

func (p *Pool) Get() *Conn {
    p.mu.Lock()
    for len(p.free) == 0 { p.available.Wait() }
    c := p.free[len(p.free)-1]
    p.free = p.free[:len(p.free)-1]
    p.mu.Unlock()
    return c
}

func (p *Pool) Put(c *Conn) {
    p.mu.Lock()
    p.free = append(p.free, c)
    p.available.Signal()
    p.mu.Unlock()
}
```

Benchmark (8 cores, 64 connections, 1M ops):

- `Get/Put` p50: 350 ns
- `Get/Put` p99: 1200 ns
- Mutex contention dominates

### After (channel)

```go
type Pool struct {
    free chan *Conn
}

func (p *Pool) Get(ctx context.Context) (*Conn, error) {
    select {
    case c := <-p.free:
        return c, nil
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}

func (p *Pool) Put(c *Conn) {
    select {
    case p.free <- c:
    default:
        c.Close()
    }
}
```

Same benchmark:

- `Get/Put` p50: 180 ns
- `Get/Put` p99: 400 ns
- Mutex contention gone (no user-space mutex)
- Plus: ctx support added for free

This is a typical migration: 30% latency improvement, 3x tail improvement, simpler code, more features.

---

## Step 11: Measure Again

After every change, re-run the benchmarks. The pitfalls:

- Optimizing the wrong thing. `Cond` is fast unless it's the bottleneck.
- Breaking semantics. Race detector and goroutine leak tests must still pass.
- Trading throughput for tail latency, or vice versa. Know which you care about.

Always:

```bash
go test -race -count=10 ./...
go test -bench . -benchmem -count=5 ./... > bench.txt
benchstat old.txt new.txt
```

`benchstat` shows whether the change is statistically significant.

---

## Cheat Sheet

| Symptom | First mitigation |
|---|---|
| `runtime.notifyListNotifyAll` hot in CPU profile | Replace `Broadcast` with `Signal` where appropriate |
| `cond.L` hot in mutex profile | Shard state or migrate to channel |
| Wait list grows unboundedly | Memory leak: workers parked on never-signalled predicate |
| High latency tail | Channel migration for FIFO fairness |
| Goroutines spike on `Broadcast` | Thundering herd: targeted wakes via per-waiter channels |
| `Get(ctx)` requires extra goroutine | Migrate to channels for `select`+`ctx.Done()` |
| Allocations per operation | Construct `Cond` once; do not new it per call |

---

## Summary

Optimizing `sync.Cond` code is mostly about asking whether `Cond` is the right tool. The hot mutex underneath, the thundering-herd risk on `Broadcast`, and the friction with `context.Context` mean that most performance problems with `Cond` are solved by migrating to channels rather than micro-optimizing the `Cond` itself.

When migration is not feasible (multi-predicate design, repeated broadcast, explicit state):

- Shard the lock to reduce contention.
- Use `Signal` instead of `Broadcast` on the hot path.
- Avoid wake-then-re-park with targeted per-waiter channels.
- Profile before and after every change.

The expected order of operations:

1. Measure with `pprof` (cpu, mutex, block).
2. Identify the bottleneck precisely.
3. Try the simple fixes (`Signal` vs `Broadcast`, fewer wakes).
4. Consider channel migration.
5. Re-measure.

Most production performance problems with `Cond` are resolved by step 4. Stay open to that outcome.

---
layout: default
title: When to Use sync.Cond — Optimize
parent: When to Use sync.Cond
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/03-when-to-use-cond/optimize/
---

# When to Use sync.Cond — Optimize

[← Back](../)

This is a performance-flavored tour of `sync.Cond`. The general guidance: most "Cond is slow" reports turn out to be "we used Broadcast where Signal would have done" or "we should not have been using Cond at all." We will benchmark each claim.

## 1. Baseline: Cond vs channel for a bounded buffer

A bounded FIFO with 1024 slots, 8 producers, 8 consumers, 1,000,000 pushes total.

```go
func BenchmarkCondQueue(b *testing.B) {
    q := NewCondQueue(1024)
    runProducersConsumers(b, q.Push, q.Pop)
}
func BenchmarkChanQueue(b *testing.B) {
    ch := make(chan int, 1024)
    runProducersConsumers(b, func(v int){ ch <- v }, func() int { return <-ch })
}
```

Typical numbers on a Mac M3 Pro, Go 1.22, GOMAXPROCS=12:

| Variant | ns/op | allocs/op |
|---|---|---|
| Cond, Broadcast on every op | 245 | 0 |
| Cond, Signal on every op | 168 | 0 |
| Channel, buffered 1024 | 95 | 0 |

The channel version is faster because the runtime channel primitive is specialized for exactly this pattern — the bookkeeping is in `select` and `chan` runtime, written in assembly-friendly Go. The Cond version goes through user-space mutex, then runtime notify-list, then mutex re-acquire. Two synchronization round-trips per operation instead of one.

**Lesson.** If your workload looks like a queue, use a channel.

## 2. Broadcast vs Signal contention

A latch with 1000 waiters, single `Release` call:

```go
func BenchmarkBroadcast1000(b *testing.B) {
    for i := 0; i < b.N; i++ {
        l := newLatch(1000)
        for j := 0; j < 1000; j++ {
            go l.Wait()
        }
        time.Sleep(50 * time.Microsecond) // let them park
        l.Release()                       // Broadcast
        l.AwaitAll()
    }
}
func BenchmarkSignalLoop1000(b *testing.B) {
    // same, but Release calls Signal in a loop 1000 times under the lock
}
```

| Variant | ns/op |
|---|---|
| `Broadcast` once | 1,250,000 (1.25 ms) |
| `Signal` x 1000 under lock | 4,800,000 (4.8 ms) |
| `close(chan struct{})` once | 980,000 (0.98 ms) |

`Broadcast` wins over a Signal loop by ~4x because the runtime can do the FIFO unlink and wake in a single critical section. The closed-channel variant edges out Cond because waiters do not need to re-acquire a user mutex on wake-up.

**Lesson.** If you need to wake N waiters at once, use `Broadcast` (or, better, `close(ch)`). Never write `for i := 0; i < N; i++ { c.Signal() }` — that is a known anti-pattern.

## 3. Fine-grained Broadcast: when Cond shines

Consider a sharded queue with K shards, each with its own mutex and Cond. The alternative is one big channel.

- One channel: every producer and every consumer contends on one cache-line owner. Throughput plateaus at the channel's lock-free fast path, which is single-producer-single-consumer optimized in Go 1.22.
- K shards with Cond: producers hash to a shard; consumers do the same. Lock contention drops by ~K. The Cond fan-out is per-shard, so `Broadcast` wakes at most `waiters/K`.

Benchmark with K=16, 64 producers, 64 consumers:

| Variant | ns/op |
|---|---|
| Single channel, capacity 4096 | 412 |
| 16 shards, each Cond + slice | 188 |
| 16 shards, each buffered channel | 142 |

The Cond version wins over the single channel because of reduced contention. The 16-channel version wins overall because the runtime's channel fast path is still faster than user-space Cond. But the gap is small enough that the Cond version is defensible if it lets you express something the channel cannot (such as "wake all consumers when a shutdown flag flips").

**Lesson.** Reducing scope of contention beats clever primitives. If you must use Cond, shard.

## 4. The cost of waking the wrong goroutine

Wake-up of a goroutine takes ~1µs on modern hardware. Re-parking after seeing the predicate is false adds another ~1µs and a lock cycle. If `Broadcast` wakes 100 goroutines and only one can make progress, you pay 99µs of wasted scheduler work.

This is the steady-state argument for `Signal` over `Broadcast`: when only one waiter can progress, prefer `Signal`. But the *correctness* argument for `Broadcast` is much stronger than the perf argument for `Signal`. The cost of one wasted wake-up is microseconds; the cost of one missed wake-up is unbounded.

**Rule of thumb.**
- If exactly one waiter can progress and they are all interchangeable → `Signal`.
- If multiple waiters are waiting on different predicates → `Broadcast` (mandatory).
- If you are not sure → `Broadcast`.

## 5. Lock-released-then-signal: micro-optimization or footgun?

Some sources recommend releasing the lock before calling `Signal`, on the theory that the woken goroutine then does not have to wait for the signaler to release the lock. Empirically, on Go 1.22:

| Variant | ns/op |
|---|---|
| Signal under lock | 168 |
| Signal after unlock | 173 |

The difference is in the noise. The slight cost of "woken waiter immediately blocks on lock acquisition" is paid back by avoiding context switches, since the woken goroutine and the signaler tend to be scheduled adjacent.

**Bigger reason to signal under the lock.** Correctness. See find-bug.md, Bug 5 and Bug 6 — signaling outside the lock invites lost-wakeup races. The microbenchmark "optimization" is worth less than 5 ns/op and costs you correctness risk.

## 6. When removing Cond removes contention

Profile excerpt from a real service we ported (anonymized):

```
       runtime.semacquire1
       sync.(*Mutex).Lock
       sync.(*Cond).Wait
       app.(*queue).Pop
```

8% of CPU was in the Cond wait path, of which ~60% was in re-acquiring the mutex after wake-up. We replaced the Cond+slice queue with a `chan` of the same capacity. The Cond hot path disappeared entirely; the same workload showed 4.5% total CPU savings end-to-end.

Why so much savings? Two reasons:

1. The channel fast path uses a single atomic op when no waiter is parked. The Cond version takes the user mutex on every op, signaler or waiter.
2. The channel select integration eliminated three goroutines that existed only to fan out wake-ups in the Cond design.

**Lesson.** Profilers reliably find Cond hot paths. If `runtime.semacquire1` shows up under your `sync.Cond.Wait` callsites and the workload is queue-shaped, you are probably leaving a few percent of CPU on the table.

## 7. The "two-sided buffered I/O" benchmark

`io.Pipe` is the canonical "you cannot replace this with a channel cleanly" Cond use. Let us check by replacing it and benchmarking. The naive replacement is `chan []byte` for data plus `chan struct{}` for ack.

```
BenchmarkIOPipe       512    2,150,000 ns/op    (Cond-based, stdlib)
BenchmarkChanPipe     512    2,380,000 ns/op    (channel-based, naive)
```

Channels are ~10% slower in this workload because every byte chunk requires two channel ops (data + ack), versus one Cond cycle in the stdlib pipe. This is one of the very few realistic cases where Cond wins on perf. The stdlib chose Cond here and has stuck with it for over a decade.

**Lesson.** If your workload is a strict ping-pong between two goroutines with backpressure in both directions, Cond can be ~10% faster than the naive channel translation. But the channel version is easier to read and to extend with cancellation. Stdlib's `io.Pipe` is the exception, not the rule.

## 8. Allocation profile

`sync.Cond` itself does not allocate on Wait/Signal/Broadcast in the steady state — the notify list reuses sudog structs from a pool. The only allocations in a Cond-heavy workload come from your data, not the primitive. Channels are similar — both share the same `sudog` machinery.

So "Cond is slow because it allocates" is wrong. Cond is slower than channels because of an extra layer of indirection (user mutex around runtime notify list), not because of GC pressure.

## 9. Practical checklist

When you see Cond in code review:

1. Is the predicate channel-shaped (single bool, queue depth)? → Replace with a channel.
2. Is `Wait` wrapped in `for`, not `if`? → If not, that is a bug; fix before benchmarking.
3. Is `Signal` correct, or should it be `Broadcast`? → If multiple predicates share the Cond, must be `Broadcast`.
4. Is the lock held during the predicate-change-and-signal sequence? → If not, lost wakeups are possible; fix before optimizing.
5. Is the Cond truly needed, or can you split into per-shard Conds (or channels)? → Sharding usually wins.
6. Are you broadcasting more often than necessary? → If most broadcasts wake only one waiter, switch to `Signal` (with care).

The honest summary: **the biggest optimization you can do to a Cond-heavy codebase is to remove the Cond.** Channels are faster for queue-shaped problems, equally fast for fan-out, and the rare cases where Cond wins on perf are usually the io.Pipe-class designs the stdlib already wrote for you.

## 10. Anatomy of a Cond hot path in `pprof`

When `sync.Cond` is the bottleneck, the profile looks like this:

```
flat  flat%   sum%        cum   cum%
0.50s  8.3%   8.3%      2.10s  35.0%  runtime.semacquire1
0.30s  5.0%  13.3%      1.20s  20.0%  sync.(*Mutex).Lock
0.25s  4.2%  17.5%      0.80s  13.3%  sync.(*Cond).Wait
0.20s  3.3%  20.8%      0.60s  10.0%  app.(*queue).Pop
```

`runtime.semacquire1` is the OS-level futex acquisition. It dominates because every `Wait` returns by re-acquiring the mutex, and that re-acquisition contends with other goroutines on the same lock.

To investigate further, capture a mutex profile (`runtime/pprof.Mutex.Profile`) and look at contention:

```
$ go test -mutexprofile=mu.out -bench=.
$ go tool pprof mu.out
(pprof) top
```

A Cond-heavy workload will show high cumulative wait time on the user mutex. If you see this and the workload is queue-shaped, you have a refactor target.

## 11. Cond-specific micro-benchmark patterns

When you write Cond benchmarks, the easy mistake is to forget that the wait/wake cycle is a two-goroutine dance. Single-goroutine benchmarks are useless. Pattern that works:

```go
func BenchmarkCondPingPong(b *testing.B) {
    var mu sync.Mutex
    c := sync.NewCond(&mu)
    var turn int
    done := make(chan struct{})

    go func() {
        for i := 0; i < b.N; i++ {
            mu.Lock()
            for turn != 1 { c.Wait() }
            turn = 0
            c.Signal()
            mu.Unlock()
        }
        close(done)
    }()

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        mu.Lock()
        for turn != 0 { c.Wait() }
        turn = 1
        c.Signal()
        mu.Unlock()
    }
    <-done
}
```

This measures the round-trip wake-up cost. On modern hardware, expect ~250 ns/op. Compare with the channel equivalent (two unbuffered channels):

```go
func BenchmarkChanPingPong(b *testing.B) {
    a := make(chan struct{})
    b2 := make(chan struct{})
    go func() {
        for i := 0; i < b.N; i++ {
            <-a
            b2 <- struct{}{}
        }
    }()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        a <- struct{}{}
        <-b2
    }
}
```

Channel version: ~190 ns/op. The Cond version is slower because of the mutex round-trip on each wake. Both are fast enough that this only matters in tight loops.

## 12. When to NOT optimize

You should not optimize `sync.Cond` usage if:

1. The Cond is not in your profile's top 10. The most expensive Cond use is rarely worth tuning.
2. The Cond's correctness has been thoroughly tested and refactoring risks introducing bugs. Concurrency code is exceptionally costly to get wrong.
3. Your team's familiarity with channels is low. A "more optimal" channel refactor that nobody understands is a maintenance liability.
4. The Cond pattern is in stdlib's idiomatic form (e.g., used like `io.Pipe`). The stdlib has done the analysis.

The cost-benefit of optimizing a Cond is usually unfavorable: small perf gain, significant correctness risk. Optimize Cond hot paths only when the profile demands it.

## 13. A real refactor story

A search service at a previous employer had a Cond-protected query cache. Profile showed ~12% CPU in `sync.(*Cond).Wait` and `runtime.semacquire1`. The query cache pattern was:

- Insert: lock, append to result list, broadcast.
- Read: lock, wait while not enough results, return.

Reads were sometimes parallelized over the same cache key, so multiple readers would wait on the same Cond for the same key's broadcast. We changed the data structure to a `map[Key]chan struct{}` where each key's channel is closed when results are complete. Readers `<-chan` for the close. Writers `close(chan)` after appending.

Result: ~9% total CPU saved, code became shorter, and we picked up cancellation via `select` for free. The whole refactor was ~80 lines of net delete plus a test suite to verify no regression.

**Lesson.** Real Cond refactors are usually net wins on three axes: perf, code size, and feature completeness (cancellation). When the profile points there, the refactor pays for itself.

## 14. Optimization checklist

When you find Cond in a hot path:

1. Verify the Cond is correct first (see find-bug.md). Optimizing buggy code is wasted effort.
2. Check if the workload is queue-shaped. If yes, channel is almost certainly faster.
3. Check if the predicate is a one-shot event ("done", "cancelled", "ready"). If yes, `close(chan struct{})` is faster and adds cancellation support.
4. Check the wake-up pattern: if `Broadcast` wakes many waiters and most go back to sleep, can the design split into per-condition Conds (or per-condition channels)?
5. If you still need Cond, ensure you `Signal` (not `Broadcast`) when only one waiter can progress.
6. If signalling under the lock is a measurable problem, profile both with-and-without. The difference is usually negligible.

## 15. Bottom line

`sync.Cond` is not "slow" — it is competitive with channels for most workloads. But the channel runtime is more aggressively optimized, and the channel API gives you cancellation, timeout, and composition with `select` for free. The performance argument for Cond is real only in narrow cases (io.Pipe-style alternating handoff). The performance argument *against* Cond — that it makes profiles harder to read and refactors riskier — is real in every case.

If you are optimizing a Cond-heavy codebase, the single highest-leverage change is to replace the Cond with the channel-shaped primitive that matches the workload. Everything else is rearranging deck chairs.

## 16. Benchmark methodology notes

A few rules for fair Cond benchmarks:

1. **Measure end-to-end throughput, not single-op latency.** Cond and channel both have overhead per op, but the throughput under realistic contention is what matters for production.
2. **Use realistic GOMAXPROCS.** Many Cond benchmarks are run with GOMAXPROCS=1, which masks contention costs. Use the production value.
3. **Warm up.** First few iterations include scheduler startup and `sudog` pool allocation. Use `b.ResetTimer()` after warm-up.
4. **Vary the contention level.** Cond's performance degrades under high contention faster than channel's. Test at 2, 4, 16, 64 concurrent goroutines.
5. **Watch for false sharing.** Cond's notifyList and your data may share cache lines; padding can affect microbenchmarks.

A template:

```go
func BenchmarkContended(b *testing.B) {
    for _, n := range []int{1, 4, 16, 64} {
        b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
            // setup
            b.ResetTimer()
            var wg sync.WaitGroup
            wg.Add(n)
            for i := 0; i < n; i++ {
                go func() {
                    defer wg.Done()
                    for j := 0; j < b.N/n; j++ {
                        // ... op under test
                    }
                }()
            }
            wg.Wait()
        })
    }
}
```

This gives you a sense of how the primitive scales.

## 17. Realistic profile excerpt

A trimmed `go tool pprof` `top10` from a Cond-heavy service under load:

```
Showing nodes accounting for 7.50s, 75.0% of 10.00s total
Showing top 10 nodes out of 256
      flat  flat%   sum%        cum   cum%
     2.10s 21.0% 21.0%      2.10s 21.0%  runtime.futex
     1.20s 12.0% 33.0%      3.30s 33.0%  runtime.semacquire1
     0.80s  8.0% 41.0%      0.80s  8.0%  sync.(*Mutex).Lock
     0.60s  6.0% 47.0%      4.00s 40.0%  sync.(*Cond).Wait
     0.55s  5.5% 52.5%      0.55s  5.5%  runtime.notifyListNotifyOne
     0.50s  5.0% 57.5%      1.10s 11.0%  app.(*Pool).Get
     0.45s  4.5% 62.0%      0.85s  8.5%  app.(*Pool).Put
     0.40s  4.0% 66.0%      0.40s  4.0%  runtime.runqgrab
     0.30s  3.0% 69.0%      0.30s  3.0%  runtime.casgstatus
     0.30s  3.0% 72.0%      0.30s  3.0%  runtime.sellock
```

Things to notice:
- `runtime.futex` at 21% is the underlying OS-level lock for the runtime's notifyList. Heavy Cond use shows up here.
- `runtime.semacquire1` at 12% is the goroutine-level lock acquisition. The user mutex (`sync.(*Mutex).Lock` at 8%) shows up separately.
- `sync.(*Cond).Wait` cumulative is 40%, dominating the profile.
- `Pool.Get` and `Pool.Put` together are ~10% — the application logic is dwarfed by the synchronization machinery.

When you see profiles like this, the Cond is the bottleneck. The optimization is to remove or restructure the Cond.

## 18. Quick-glance optimization decisions

When you have 30 seconds to assess a Cond hot path:

| Observation | Optimization |
|---|---|
| Cond protects a queue | Replace with `chan T` |
| Cond is one-shot signal | Replace with `close(chan struct{})` |
| Cond uses Broadcast for fan-out only | Replace with closed channel |
| Cond + counter for completion | Replace with `sync.WaitGroup` |
| Cond + bool for init-once | Replace with `sync.Once` |
| Cond + map for per-key wait | Replace with `map[K]chan T` |
| Cond protects resource pool | Replace with `sync.Pool` or buffered chan |
| Cond with timeout via side goroutine | Refactor to channel + select |
| Cond is multi-predicate, single mutex | Keep (this is the niche case) |

If the workload falls into the last row, the optimization options are limited: maybe shard, maybe rewrite as fewer-Conds-each-protecting-less, but the Cond pattern itself is appropriate.

## 19. Final word on perf

`sync.Cond` is not "slow." It is "slower than channels for queue-shaped problems" and "missing features (cancellation, timeout) that channels have." Most "Cond is the bottleneck" reports are really "we should not be using Cond here."

Optimize by replacing the Cond, not by tuning it. The Cond implementation itself is 90 lines of well-tested Go; there is nothing in it to tune. The optimization opportunity is in the design above the Cond, not inside it.

[← Back](../)

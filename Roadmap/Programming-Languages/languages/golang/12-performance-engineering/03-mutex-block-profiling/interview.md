# Mutex and Block Profiling — Interview Questions

## Q1. What's the difference between the mutex profile and the block profile?

The mutex profile records **wait time attributed to the holder of a `sync.Mutex` or `sync.RWMutex`** — captured at `Unlock` time, blaming the goroutine whose holding made others wait. The block profile records **wait time attributed to the waiter** at the moment it parks on any sync primitive (mutex, channel, select, `Cond`, `WaitGroup`, `time.Sleep`). They overlap on mutex contention but answer different questions.

---

## Q2. How do you enable them?

```go
runtime.SetMutexProfileFraction(100)  // 1 in 100 events
runtime.SetBlockProfileRate(10000)    // sample blocks > ~10 μs
```

Or set `GODEBUG=mutexprofilefraction=100,blockprofilerate=10000` at startup.

Both are off by default (rate 0).

---

## Q3. What does the `rate` argument to `SetBlockProfileRate` mean?

It's a **nanosecond threshold**, interpreted statistically: an event of duration `d` is recorded with probability `min(1, d/rate)`. So `rate=10000` biases the profile toward events lasting tens of microseconds or more, and `rate=1` records every event.

---

## Q4. How does the mutex profile decide who to blame?

When a goroutine calls `Unlock` on a mutex that had a waiter, the runtime walks the **unlocker's** stack with `runtime.Callers` and adds the waiter's delay (scaled by `1/fraction`) to that stack's accumulator. The code that *held* the lock is what slowed others down; that's the natural attribution.

---

## Q5. Why doesn't the mutex profile record holding time?

Because holding a lock with no waiter doesn't hurt anyone. The metric is **delay caused to others**, not lock ownership. A lock held for a second by a lone goroutine adds zero to the profile.

---

## Q6. Which primitives does the block profile cover?

`sync.Mutex` and `RWMutex`, channel send/recv, `select`, `sync.Cond.Wait`, `sync.WaitGroup.Wait`, `time.Sleep`. It does **not** cover network I/O, syscalls, GC assists, or internal runtime locks. Use the execution tracer for those.

---

## Q7. Why might `goroutine` profile show many parked goroutines but `mutex` profile is empty?

Three possibilities:

1. `SetMutexProfileFraction` was never called — profile is disabled.
2. The contention is on a channel, not a mutex — check the block profile.
3. Goroutines are blocked on something not covered (network, syscall, GC) — use the tracer.

---

## Q8. What's the cost of enabling both profiles in production?

At the defaults (`mutex=100`, `block=10000`):

- Mutex profile: < 0.5% CPU overhead for most workloads.
- Block profile: 1–3% CPU. Higher with smaller rates.

Setting `rate=1` for either can hit 5–10% on busy services. Stick to defaults unless investigating actively.

---

## Q9. How would you capture a profile over a specific 60-second window?

Take two snapshots and diff:

```bash
curl -s host:6060/debug/pprof/mutex -o m1.pb.gz
sleep 60
curl -s host:6060/debug/pprof/mutex -o m2.pb.gz
go tool pprof -base m1.pb.gz m2.pb.gz
```

Each snapshot contains samples accumulated since startup; subtracting yields the window.

---

## Q10. Walk through interpreting `pprof top` output for a mutex profile.

```
      flat  flat%   sum%        cum   cum%
     6.8s  54.8% 54.8%       6.8s  54.8%  main.(*Counter).Inc
```

- `flat = 6.8s`: this function's own frames are blamed for 6.8s of contention.
- `flat% = 54.8%`: of total profile delay.
- `cum`: this function plus everything it called.

So `Counter.Inc` directly caused 6.8s of other-goroutine wait time. To find the exact line: `(pprof) list main.\(\*Counter\).Inc`.

---

## Q11. When would you use `RWMutex` vs `Mutex` vs `atomic.Pointer`?

| Workload | Best fit |
|----------|----------|
| Balanced read/write | `Mutex` |
| 95%+ reads, occasional writes | `RWMutex` |
| 99.9%+ reads, immutable-after-build snapshots | `atomic.Pointer[T]` |
| Counter or single-field updates | `atomic.IntX` |
| High-cardinality counters | per-cell padded atomic array |

`RWMutex` has higher constant overhead than `Mutex`, so for short critical sections, a `Mutex` is sometimes faster despite the contention model.

---

## Q12. What is `sync.Map` good at, and what is it bad at?

Good at: **read-mostly** maps and **per-goroutine disjoint key sets**. Internally uses an atomic-pointer read-only view that handles reads with no lock.

Bad at: **balanced or write-heavy** workloads — the dirty side is mutex-protected, and you pay promotion overhead. For those, a sharded plain map outperforms.

---

## Q13. Explain "sharding" for contention reduction.

Replace one mutex-protected structure with N copies, each protected by its own mutex. Operations pick a shard based on a hash of the key. Contention scales with `min(N, GOMAXPROCS)` instead of `GOMAXPROCS`.

```go
type ShardedMap struct {
    shards [32]struct {
        mu sync.Mutex
        m  map[K]V
    }
}
```

Pick `N` ≥ `2 × GOMAXPROCS`, use a power-of-two for `mask` arithmetic, and use a fast, well-distributing hash.

---

## Q14. What is "false sharing" and how does it show up?

Two unrelated atomic variables on the same 64-byte cache line cause writes to one to invalidate the line for the other. Cores end up bouncing the line back and forth via the MESI protocol.

Neither profile shows this directly — it manifests as "atomics inexplicably slow on multi-core". Fix with padding:

```go
type Counter struct {
    a atomic.Int64
    _ [56]byte
    b atomic.Int64
}
```

---

## Q15. Why is the block profile's contribution scaled at read time?

Because events are sampled with probability `min(1, d/rate)`. The runtime stores the raw delay; at read time, dividing the bucket sum by the sampling rate produces a statistically unbiased estimate of the true total delay across all events.

---

## Q16. A team adds a feature and p99 latency doubles, CPU is unchanged. What do you do?

1. Goroutine profile — count parked goroutines.
2. Mutex profile delta over the affected window — top stack usually names the culprit.
3. Block profile delta — channel/Cond/Sleep involvement.
4. Diff against the previous release's profiles — that's the regression.
5. `list <fn>` to find the exact line.
6. Fix: shrink critical section, swap primitive, or shard.
7. Verify with another diff.

---

## Q17. What's wrong with `defer mu.Unlock()` followed by I/O?

The `defer` runs at function return, so the lock stays held through the I/O — possibly tens of milliseconds. Holds up every other caller. Either move the I/O outside the lock or restructure:

```go
mu.Lock()
data := state
mu.Unlock()
performIO(data) // outside
```

---

## Q18. Describe a copy-on-write pattern using `atomic.Pointer`.

```go
var current atomic.Pointer[Config]

// readers
c := current.Load()

// writers: build a new Config, swap
fresh := buildConfig()
current.Store(fresh)
```

Readers never lock; writers swap a pointer atomically. The previous `Config` lingers until no `Load` user holds it. Works only for immutable-after-build values; mutating through the loaded pointer is a data race.

---

## Q19. How would you reduce contention on a global counter that's incremented millions of times per second?

| Option | Trade-off |
|--------|-----------|
| `atomic.Int64.Add` | Better than mutex, still cache-line contended |
| Per-P padded counter array, sum on read | Best for high core count |
| `golang.org/x/sync/atomic` packed counters | Library-quality |
| Sharded counter by hash of context | Simple, scalable |

The per-P approach (or its goroutine-id approximation) wins above ~16 cores.

---

## Q20. What's the right time to reach for a lock-free data structure?

When all of these are true:

1. The mutex/atomic version is measurably the bottleneck (profile evidence).
2. A standard alternative (sharding, channels, CoW) has been tried and is inadequate.
3. The lock-free implementation has been independently verified (literature, library with tests).
4. The code's maintenance lifetime justifies the complexity.

Most Go services never hit this bar. Channels and sharded maps cover the vast majority of practical cases.

---

## 21. Summary

A strong interview answer about contention demonstrates: knowledge of the two profile types and how to read them, understanding of sampling and attribution semantics, fluency with the standard fixes (smaller sections, primitive swap, sharding, atomics, CoW), and the discipline to verify each fix with a diff capture. The depth question is usually about *attribution* (who is blamed and why) and *interpretation* (when a high block delay is actually correct behaviour).

---

## Further reading
- `runtime/pprof` package: https://pkg.go.dev/runtime/pprof
- Go blog on profiling: https://go.dev/blog/pprof
- Felix Geisendörfer's profiler notes: https://github.com/DataDog/go-profiler-notes
- The Go Memory Model: https://go.dev/ref/mem

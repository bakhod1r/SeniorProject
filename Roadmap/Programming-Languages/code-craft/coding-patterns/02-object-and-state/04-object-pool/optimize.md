# Object Pool — Optimization Drills

> **Category:** [Object & State Patterns](../README.md) — most "pool optimizations" are about *not pooling*, sizing correctly, and cutting reset/contention cost when you do.

10 drills + benchmarks. Apple M2 Pro, single thread unless noted. **Measure your own workload — these numbers are indicative.**

---

## Drill 1: Don't Pool Cheap Objects (the biggest win is deletion)

### Slow / buggy
```go
var p = sync.Pool{New: func() any { return &Point{} }}  // 16-byte struct
pt := p.Get().(*Point); defer p.Put(pt)
```

### Optimized
```go
pt := &Point{}   // bump-pointer allocation; GC reclaims for free
```

### Benchmark
```
BenchmarkSyncPoolSmall-8   100M   11.0 ns/op   0 B/op
BenchmarkAllocateSmall-8   500M    2.1 ns/op  16 B/op
```

Allocation is **5× faster** for a tiny object. The pool's per-P bookkeeping costs more than the allocation it avoids. **Deleting the pool is the optimization.**

---

## Drill 2: Pool Only Large, Hot Buffers

### Slow
```go
buf := make([]byte, 64*1024)   // 64 KB alloc + zeroing on every call
```

### Optimized
```go
var bufPool = sync.Pool{New: func() any { return make([]byte, 0, 64*1024) }}
buf := bufPool.Get().([]byte)[:0]
defer bufPool.Put(buf[:0])
```

### Benchmark
```
BenchmarkAlloc64K-8     200K   6200 ns/op   65536 B/op
BenchmarkPool64K-8        3M    410 ns/op       0 B/op
```

For a **large** buffer churned hot, pooling is ~15× faster — allocation + zeroing of 64 KB dominates. The size crossover (vs Drill 1) is the whole point: pool size, not count.

---

## Drill 3: Check Escape Analysis Before Pooling

### Slow (assumed allocation pressure)
```go
func process(data []byte) {
    b := bufPool.Get().([]byte) // pooled "to reduce allocations"
    defer bufPool.Put(b)
    ...
}
```

### Optimized — verify the object even escapes
```bash
go build -gcflags='-m' ./...
# ./x.go:10: make([]byte, n) does not escape   ← it was stack-allocated already!
```

If the compiler already stack-allocates the buffer, the pool adds contention for **zero** benefit. Remove it.

### Lesson
The cheapest pool is the one you proved you don't need. Escape analysis often makes pooling moot.

---

## Drill 4: Right-Size the Connection Pool

### Slow / superstition
```java
cfg.setMaximumPoolSize(100);   // "to be safe"
```

100 connections thrash a database that can usefully serve ~16 in parallel; context-switching and lock contention at the DB *lower* throughput.

### Optimized
```java
cfg.setMaximumPoolSize(16);    // ((cores*2)+spindles) — verified by load test
cfg.setMinimumIdle(16);        // fixed-size: no churn
```

### Benchmark (load test, 8-core DB)
```
pool=100   throughput 8,200 req/s   p99 240 ms
pool=16    throughput 9,600 req/s   p99  70 ms
```

Smaller pool, **higher** throughput and lower tail latency. Sizing is queueing theory, not "bigger is better."

---

## Drill 5: Fixed-Size Pool to Kill Churn

### Slow
```java
cfg.setMinimumIdle(2);
cfg.setMaximumPoolSize(20);   // pool constantly grows/shrinks under bursty load
```

Each grow pays a handshake; each shrink discards a warm connection — churn under bursty traffic.

### Optimized
```java
cfg.setMinimumIdle(20);
cfg.setMaximumPoolSize(20);   // minIdle == max → stable, no create/destroy churn
```

Predictable footprint, no handshake latency spikes mid-traffic. HikariCP recommends this for most production services.

---

## Drill 6: Reset Only What's Written

### Slow
```go
func release(b []byte) {
    for i := range b[:cap(b)] { b[i] = 0 }   // zero the full 64 KB capacity
    pool.Put(b[:0])
}
```

Zeroing 64 KB when only 200 bytes were written wastes memory bandwidth.

### Optimized
```go
func release(b []byte) {
    pool.Put(b[:0])   // len=0; next borrow overwrites before reading
}
```

`bytes.Buffer.Reset()` and `b[:0]` make stale data **unreadable** (length 0) without zeroing capacity — safe *because* the next writer overwrites before any read.

> **Caveat:** for **security-sensitive** bytes that might be observed before overwrite (cross-tenant buffers), zero the written region explicitly. Never trade away the security boundary for speed.

---

## Drill 7: Validate Off the Hot Path

### Slow — test-on-borrow
```java
T borrow() {
    T c = idle.poll();
    selectOne(c);   // SELECT 1 round-trip on EVERY borrow → adds latency to all
    return c;
}
```

### Optimized — background eviction
```java
// A scheduler validates idle connections and evicts dead ones off the hot path;
// borrow uses only a cheap, local isValid() with no network round-trip.
cfg.setKeepaliveTime(30_000);   // HikariCP keepalive ping while idle
```

### Benchmark
```
test-on-borrow      borrow p50  900 µs  (SELECT 1 each time)
background-validate borrow p50    1 µs  (local check)
```

Moving the network validation off the borrow path cuts borrow latency by ~900×.

---

## Drill 8: Lock-Free / Sharded Borrow Path

### Slow
```java
synchronized T borrow() { ... }   // one monitor; serializes all cores
```

### Optimized
```java
// Thread-local lists + non-blocking steal (HikariCP ConcurrentBag style),
// or at minimum a concurrent queue, so borrows scale with cores.
private final BlockingQueue<T> idle = new ArrayBlockingQueue<>(size, true);
```

### Benchmark (32 threads)
```
synchronized pool       1.1M borrows/s   (lock-bound)
ConcurrentBag-style    14M  borrows/s   (mostly thread-local)
```

The pool exists to relieve a bottleneck; its own lock must not become one.

---

## Drill 9: Pad Hot Counters Against False Sharing

### Slow
```go
type pool struct {
    active atomic.Int64
    waits  atomic.Int64   // shares a cache line with active
}
```

Every `active++` invalidates the core caching `waits` — false sharing.

### Optimized
```go
type pool struct {
    active atomic.Int64
    _      [56]byte        // pad to a 64-byte cache line
    waits  atomic.Int64
}
```

Independent hot counters on separate cache lines stop cross-core invalidation. (`sync.Pool`'s per-P sharding avoids this by construction.)

---

## Drill 10: Front the DB With a Multiplexer Instead of Bigger Pools

### Slow
```
50 pods × maxPoolSize 20 = 1,000 connections   vs   db.max_connections = 200
```

Either you starve pods (small pools) or melt the DB (big pools) — there's no per-pod size that fits.

### Optimized — PgBouncer transaction mode
```
50 pods × pool 20 = 1,000 client connections
        → PgBouncer multiplexes onto ~50 real DB connections
```

The multiplexer decouples app-side pool sizing from the DB's hard limit; thousands of "connections" share a few dozen real ones.

---

## Optimization Tips

### How to find pool bottlenecks
1. **Profile allocations** (`pprof -alloc_objects`, async-profiler) — is the object even hot?
2. **Check escape analysis** (`go build -gcflags='-m'`) — does it escape at all?
3. **Watch pool metrics** — saturation (active/total), borrow wait p99, borrow timeouts.
4. **Load-test pool size** — the right size is usually *smaller* than you think.

### Optimization checklist
- [ ] Delete pools for cheap objects.
- [ ] Pool only large, hot buffers (or expensive resources).
- [ ] Verify the object escapes before pooling it.
- [ ] Size connection pools from the formula, then load-test.
- [ ] Fixed-size pool (`minIdle == max`) to kill churn.
- [ ] Reset minimally (but never skip a security boundary).
- [ ] Validate off the hot path (background eviction / keepalive).
- [ ] Lock-free / sharded borrow path; pad hot counters.
- [ ] Multiplexer (PgBouncer) instead of oversized pools.

### Anti-optimizations
- ❌ **Pooling small objects** — slower than `new`, plus bugs.
- ❌ **Oversizing connection pools** — lowers throughput, melts the backend.
- ❌ **Skipping reset "for speed"** — stale-state / cross-tenant data leaks.
- ❌ **Hand-rolling a pool** when HikariCP / `database/sql` already exist.

---

## Summary

The headline pool optimization is **not pooling**: the allocator and GC beat a buggy pool for cheap objects, and escape analysis often removes the allocation entirely. When pooling is genuinely warranted — large buffers, connections, threads — the wins come from *right-sizing* (smaller than instinct says), *minimal reset*, *off-hot-path validation*, and a *lock-free borrow path*. Reach for proven pools (HikariCP, `sync.Pool`, `database/sql`) before hand-rolling.

---

[← Find-Bug](find-bug.md) · [Object & State](../README.md) · [Coding Patterns](../../README.md)

**Object Pool roadmap complete.** All 8 files: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md) · [tasks](tasks.md) · [find-bug](find-bug.md) · [optimize](optimize.md).

**Next:** [Self-Encapsulation](../05-self-encapsulation/junior.md).

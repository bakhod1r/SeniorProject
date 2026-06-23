---
layout: default
title: False Sharing — Find the Bug
parent: False Sharing
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/05-false-sharing/find-bug/
---

# False Sharing — Find the Bug

> Each snippet contains a real cache-line / false-sharing bug. The program is correct (no race, no panic) but performs badly under multi-core load. Find the false-sharing problem, explain its hardware-level cause, and fix it.

---

## Bug 1 — Eight counters in one line

```go
type Stats struct {
    counters [8]int64
}

func main() {
    s := &Stats{}
    var wg sync.WaitGroup
    wg.Add(8)
    for i := 0; i < 8; i++ {
        go func(id int) {
            defer wg.Done()
            for j := 0; j < 100_000_000; j++ {
                atomic.AddInt64(&s.counters[id], 1)
            }
        }(i)
    }
    wg.Wait()
}
```

**Bug.** `[8]int64` is 64 bytes — exactly one cache line. All eight counters live on the same line. Eight goroutines on eight cores each writing one of these counters cause continuous cache-line bouncing. Throughput is single-core speed or worse.

**Fix.**

```go
type Stats struct {
    counters [8]struct {
        v int64
        _ [56]byte
    }
}

// ... usage:
atomic.AddInt64(&s.counters[id].v, 1)
```

Each counter is now on its own cache line. Throughput scales linearly with cores.

**Why.** Cache coherence operates at line granularity. The hardware sees writes to different bytes within the same line as conflicting and serialises them via the MESI protocol.

---

## Bug 2 — Producer/consumer indexes share a line

```go
type Queue struct {
    head uint64
    tail uint64
    buf  []int
}

func (q *Queue) Push(v int) {
    h := atomic.LoadUint64(&q.head)
    t := atomic.LoadUint64(&q.tail)
    if h-t == uint64(len(q.buf)) {
        return // full
    }
    q.buf[h%uint64(len(q.buf))] = v
    atomic.StoreUint64(&q.head, h+1)
}

func (q *Queue) Pop() (int, bool) {
    t := atomic.LoadUint64(&q.tail)
    h := atomic.LoadUint64(&q.head)
    if t == h {
        return 0, false // empty
    }
    v := q.buf[t%uint64(len(q.buf))]
    atomic.StoreUint64(&q.tail, t+1)
    return v, true
}
```

**Bug.** `head` and `tail` are adjacent (16 bytes total, sharing a 64-byte line). The producer writes `head`; the consumer writes `tail`. Every push/pop pair causes the line to bounce between producer's core and consumer's core. Throughput is half (or less) what it could be.

**Fix.**

```go
type Queue struct {
    head uint64
    _    [56]byte
    tail uint64
    _    [56]byte
    buf  []int
}
```

Now head and tail are on separate cache lines. Producers' and consumers' writes never invalidate each other's lines.

---

## Bug 3 — Per-worker stats packed in a slice

```go
type Worker struct {
    Processed int64
    Failed    int64
}

type Pool struct {
    workers []Worker
}

func (p *Pool) Run() {
    var wg sync.WaitGroup
    for i := range p.workers {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for {
                if doWork() {
                    atomic.AddInt64(&p.workers[id].Processed, 1)
                } else {
                    atomic.AddInt64(&p.workers[id].Failed, 1)
                }
            }
        }(i)
    }
    wg.Wait()
}
```

**Bug.** Each `Worker` is 16 bytes. Four `Worker`s fit in one cache line. Four goroutines on four cores writing different workers' stats cause continuous line bouncing.

**Fix.**

```go
type Worker struct {
    Processed int64
    Failed    int64
    _         [48]byte // pad to 64
}
```

Each `Worker` is now 64 bytes. Adjacent workers in the slice occupy separate cache lines.

---

## Bug 4 — Global counter for all goroutines

```go
var GlobalCounter int64

func handler() {
    // ... handle request ...
    atomic.AddInt64(&GlobalCounter, 1)
}
```

Under high load (100K req/s, 8 cores), latency p99 spikes. Increasing CPU does not help.

**Bug.** This is *true sharing*, not false sharing. All goroutines hit the same `int64`. Padding does not help — there is only one variable, one line. The cache line bounces from core to core on every increment.

**Fix.** Switch to a sharded counter:

```go
type Counter struct {
    shards []paddedInt64
}

type paddedInt64 struct {
    v atomic.Int64
    _ [56]byte
}

func New() *Counter {
    return &Counter{shards: make([]paddedInt64, runtime.GOMAXPROCS(0))}
}

func (c *Counter) Inc(shardID int) {
    c.shards[shardID%len(c.shards)].v.Add(1)
}

func (c *Counter) Value() int64 {
    var s int64
    for i := range c.shards {
        s += c.shards[i].v.Load()
    }
    return s
}
```

Each handler picks a shard (e.g., via a per-goroutine hash) and increments locally. Reads aggregate.

**Lesson.** Distinguish false sharing (multiple variables on a line) from true contention (one variable hit by many cores). Different problem, different fix.

---

## Bug 5 — Read-write mix on a per-CPU shard

```go
type Shard struct {
    Value int64
}

type Counter struct {
    shards []Shard
}

func (c *Counter) Inc(shardID int) {
    atomic.AddInt64(&c.shards[shardID].Value, 1)
}

func (c *Counter) Sum() int64 {
    var s int64
    for i := range c.shards {
        s += atomic.LoadInt64(&c.shards[i].Value)
    }
    return s
}
```

**Bug.** `Shard` is 8 bytes; eight shards fit in one cache line. Multiple goroutines incrementing different shards bounce the line. The `Sum()` reads all shards, doing additional cache line touches.

**Fix.**

```go
type Shard struct {
    Value int64
    _     [56]byte
}
```

Each shard now occupies one cache line. The bug is the same as Bug 1 in spirit; this is the sharded-counter version of it.

---

## Bug 6 — Mutex array with false sharing

```go
type Bucket struct {
    sync.Mutex
    Data []byte
}

type Sharded struct {
    buckets []Bucket
}

func (s *Sharded) Update(idx int, data []byte) {
    s.buckets[idx].Lock()
    s.buckets[idx].Data = data
    s.buckets[idx].Unlock()
}
```

**Bug.** `sync.Mutex` is 8 bytes; `Bucket` is 32 bytes (mutex + slice header). Two buckets fit in one cache line. Two goroutines updating different buckets contend on the same line — even though they hold different mutexes.

The contention is on the *mutex state words* (the atomic CAS in `Lock`) and on the *slice header writes*.

**Fix.**

```go
type Bucket struct {
    sync.Mutex
    Data []byte
    _    [32]byte // pad to 64 (8 mutex + 24 slice = 32; add 32 more)
}
```

Each bucket is now on its own cache line.

**Verify with `unsafe.Sizeof`:**

```go
import "unsafe"
func init() {
    if unsafe.Sizeof(Bucket{}) != 64 {
        panic("Bucket must be 64 bytes")
    }
}
```

---

## Bug 7 — Layout shift after refactoring

```go
type Stats struct {
    a int64
    b int64
    c int64
    _ [40]byte // pad to 64
}
```

A teammate refactors:

```go
type Stats struct {
    a int64
    b int64
    c int64
    d int64       // new field added
    _ [40]byte    // padding not updated
}
```

**Bug.** After the change, `Stats` is `4*8 + 40 = 72` bytes. Adjacent `Stats` in an array are 72 bytes apart — straddling cache line boundaries. The first 64 bytes of element 1 share a line with the last 8 bytes of element 0. False sharing reappears between adjacent elements.

**Fix.** Update padding:

```go
type Stats struct {
    a int64
    b int64
    c int64
    d int64
    _ [32]byte // pad to 64
}
```

Or compute padding from `unsafe.Sizeof`:

```go
type body struct{ a, b, c, d int64 }
type Stats struct {
    body
    _ [cacheLine - unsafe.Sizeof(body{})%cacheLine]byte
}
```

**Lesson.** Padding silently drifts as struct fields are added. Always include an `unsafe.Sizeof` test.

---

## Bug 8 — Cross-struct false sharing

```go
type Counter struct {
    v int64
    _ [56]byte
}

func handleRequest() {
    a := &Counter{}
    b := &Counter{}
    // ... use a and b in different goroutines ...
}
```

**Bug.** `a` and `b` are allocated by `new(Counter)` (effectively). The Go allocator places successive small allocations close together in the same span. `a` and `b` might land in adjacent cache-line-aligned slots, but the *padding* of `a` ends exactly where `b`'s `v` begins. If the allocator places `a` at offset 0 and `b` at offset 64 of the same span, they are on different lines — good. But if the allocator places them packed (offset 0 and offset 8), `b`'s `v` shares a line with `a`'s padding.

**In practice**, the Go allocator's size classes ensure 64-byte objects are 64-byte aligned within a span. So this bug is rare. But if you had a 32-byte struct, the alignment might be 8 bytes, leading to two structs on one line.

**Fix.** Ensure your padded struct is at least one cache line, and allocate it through normal means. If you need stricter alignment, allocate via `mmap` or a custom aligned allocator.

---

## Bug 9 — Hyperthreading masks the bug

```go
// Benchmark passes on the developer's 2-core (4-thread) laptop.
// Production has 16 physical cores.

func BenchmarkCounters(b *testing.B) {
    a := &Adjacent{} // unpadded
    var wg sync.WaitGroup
    wg.Add(2)
    b.ResetTimer()
    for i := 0; i < 2; i++ {
        go func(id int) {
            defer wg.Done()
            for j := 0; j < b.N; j++ {
                atomic.AddInt64(&a.counters[id], 1)
            }
        }(i)
    }
    wg.Wait()
}
```

**Bug.** Two goroutines on a 2-core hyperthreaded laptop run on two *hyperthreads of the same physical core*. They share L1; "false sharing" between hyperthreads is invisible (no inter-core invalidation). The benchmark looks fine.

In production with 16 physical cores, the same code under load causes real inter-core bouncing and 10x slowdown.

**Fix.** Use `taskset -c 0,2` on Linux to pin to two distinct physical cores during testing. Or run benchmarks at `-cpu=N` where N is the production core count.

---

## Bug 10 — `sync.Pool` accidentally bypassed

```go
var counters []*Counter // shared by all goroutines
var pool = sync.Pool{New: func() interface{} { return &Counter{} }}

func GetCounter() *Counter {
    return pool.Get().(*Counter)
}

func InitCounters(n int) {
    for i := 0; i < n; i++ {
        counters[i] = &Counter{} // bypasses pool, custom allocations
    }
}
```

**Bug.** `InitCounters` allocates `n` `*Counter`s in a tight loop, all from the same goroutine on the same P. The allocator returns them from the same mcache span; they pack densely. If `Counter` is small, adjacent counters share cache lines. Once these counters are then used by N different goroutines, false sharing emerges.

**Fix.** Either:

1. Ensure `Counter` is sized to one or more cache lines (`Counter{v int64; _ [56]byte}`).
2. Allocate from separate mcaches by using separate goroutines (rarely worth the complexity).

The first is the right fix.

---

## Bug 11 — Reading from many shards in a hot loop

```go
func (c *Counter) Increment() {
    shard := c.pickShard()
    atomic.AddInt64(&c.shards[shard].v, 1)
}

func (c *Counter) Total() int64 {
    var t int64
    for i := range c.shards {
        t += atomic.LoadInt64(&c.shards[i].v)
    }
    return t
}

// Hot loop:
for {
    handleRequest()
    counter.Increment()
    if counter.Total() > threshold { ... }
}
```

**Bug.** `Total()` reads every shard. On each call, it touches every shard's cache line. Other cores writing those shards see invalidations (or, more precisely, the line state changes from Modified to Shared each time `Total()` reads it). The combined effect is high coherence traffic.

The fix is *not* padding (already done). The fix is to not call `Total()` in a hot path. Sample less often, or maintain a separate "global view" that updates less frequently.

**Fix.**

```go
type Counter struct {
    shards []paddedInt64
    cachedTotal atomic.Int64
}

// Background goroutine periodically updates cachedTotal:
go func() {
    for {
        time.Sleep(10 * time.Millisecond)
        var t int64
        for i := range c.shards {
            t += c.shards[i].v.Load()
        }
        c.cachedTotal.Store(t)
    }
}()

// Hot path reads from cachedTotal:
func (c *Counter) Total() int64 { return c.cachedTotal.Load() }
```

Bounded staleness (10ms) is acceptable for most use cases.

---

## Bug 12 — Padding misplaced

```go
type S struct {
    hot1 int64
    _    [56]byte // padding placed wrongly
    hot2 int64
}
// Two goroutines: one writes hot1, the other writes hot2.
```

**Bug.** The padding is between hot1 and hot2, so they are on separate cache lines — good. *But* the struct is 16 + 56 = 72 bytes. If multiple `S`s are placed in an array, the second `S`'s `hot1` is at offset 72, which is *inside* the second cache line of the array — so `hot1` of element 1 shares a line with `hot2` of element 0.

In other words: padding between fields prevents within-struct false sharing, but you also need padding at the end of the struct (or sizing the struct to a multiple of cache line) to prevent across-struct false sharing.

**Fix.**

```go
type S struct {
    hot1 int64
    _    [56]byte
    hot2 int64
    _    [56]byte // pad end of struct
}
// Total: 128 bytes, two cache lines exactly.
```

Or restructure as separate arrays of single-padded fields.

---

## Bug 13 — Compiler folds away the contention

```go
func BenchmarkContention(b *testing.B) {
    var x int64
    var wg sync.WaitGroup
    wg.Add(8)
    b.ResetTimer()
    for i := 0; i < 8; i++ {
        go func() {
            defer wg.Done()
            var local int64
            for j := 0; j < b.N; j++ {
                local++
            }
            x = local  // only one write per goroutine
        }()
    }
    wg.Wait()
}
```

**Bug.** This is *not* a false-sharing benchmark — each goroutine increments a local variable on its own stack. The shared `x` is written once per goroutine at the end. No false sharing.

The benchmark is measuring local-increment throughput, not concurrent contention. Sure enough, it scales linearly with goroutines — but that's not because of any cache-line magic; it's because there's no shared state.

**Fix.** Use `atomic.AddInt64` on a *shared* counter to actually measure contention:

```go
var x int64
go func() {
    for j := 0; j < b.N; j++ {
        atomic.AddInt64(&x, 1)
    }
}()
```

**Lesson.** A benchmark must actually exercise the contention you care about. Local-only loops show local-only throughput.

---

## Bug 14 — Map of shards with false sharing

```go
type Counter struct {
    perKey sync.Map // key -> *atomic.Int64
}

func (c *Counter) Inc(key string) {
    v, _ := c.perKey.LoadOrStore(key, new(atomic.Int64))
    v.(*atomic.Int64).Add(1)
}
```

**Bug.** Each `new(atomic.Int64)` returns an 8-byte allocation. The Go allocator packs small allocations densely in spans. Multiple keys' `Int64`s land in adjacent slots; if the keys are hot, the lines bounce.

**Fix.** Allocate padded counters:

```go
type padded struct {
    v atomic.Int64
    _ [56]byte
}

func (c *Counter) Inc(key string) {
    v, _ := c.perKey.LoadOrStore(key, new(padded))
    v.(*padded).v.Add(1)
}
```

Each `*padded` is a separate 64-byte allocation. Allocator placement is now safer (64-byte size class objects are 64-byte-aligned within their span).

---

## Bug 15 — Cross-goroutine state in a closure

```go
func Run() {
    var state struct {
        a int64
        b int64
    }
    go func() {
        for {
            atomic.AddInt64(&state.a, 1)
        }
    }()
    go func() {
        for {
            atomic.AddInt64(&state.b, 1)
        }
    }()
    select {}
}
```

**Bug.** `state` is captured by closure; both goroutines see the same struct. `state.a` and `state.b` are 8 bytes apart — same cache line. False sharing.

**Fix.**

```go
var state struct {
    a int64
    _ [56]byte
    b int64
    _ [56]byte
}
```

---

## Bug 16 — Padded but not aligned

```go
type Padded struct {
    v int64
    _ [56]byte
}

// Allocation:
arr := make([]Padded, 4)
```

`arr[0].v` is at offset 0 of the underlying array; `arr[1].v` is at offset 64; etc. Internal adjacency is solved.

But the array's start address may not be 64-byte aligned. If the allocator returns the array at address 0x...00008, then `arr[0].v` is at offset 8 — sharing a cache line with whatever lives at offset 0.

**In practice**, this is fine: the variable at offset 0 (whatever it is) is unrelated to `arr[0]`. It's not concurrently written. The cache line containing offset 0 is mostly cold.

If for some reason it *is* concurrently written, you'd need a stricter allocation. The fix is `mmap` or `posix_memalign` for aligned allocation. Usually not needed.

---

## Bug 17 — `sync.WaitGroup` shared cache line

```go
type Worker struct {
    wg sync.WaitGroup
    counter atomic.Int64
}

workers := make([]Worker, 8)
// ... each worker started independently ...
```

**Bug.** `Worker` is `sizeof(sync.WaitGroup) + sizeof(atomic.Int64)`. A `sync.WaitGroup` is 12 bytes (in old Go) or 16 bytes (in current Go, with padding). The counter is 8 bytes. Two `Worker`s might fit in one cache line.

`sync.WaitGroup.Add/Done/Wait` write internal state. `counter.Add` writes the counter. If two adjacent workers are hammered concurrently, the line bounces.

**Fix.** Pad `Worker` to a full cache line:

```go
type Worker struct {
    wg sync.WaitGroup
    counter atomic.Int64
    _ [40]byte // pad to 64 (size depends on Go version's WaitGroup size)
}
```

Verify with `unsafe.Sizeof`. Adjust the padding number until the size is 64.

---

## Bug 18 — Channel underneath causes contention

```go
const N = 8
ch := make(chan int, 1000)

for i := 0; i < N; i++ {
    go func() {
        for v := range ch {
            // process v
        }
    }()
}
for i := 0; i < 1000000; i++ {
    ch <- i
}
```

**Bug (sort of).** A buffered channel has internal lock and buffer indices. Multiple receivers contend on the channel's internal state. This is not strictly false sharing of *user* data, but it is contention on the channel's internal cache lines.

For very-high-throughput fan-out, channels are often a bottleneck. The fix is to shard work: N channels, one per receiver, with the producer choosing a channel.

```go
chans := make([]chan int, N)
for i := range chans {
    chans[i] = make(chan int, 1000/N)
    go func(c chan int) {
        for v := range c {
            // process
        }
    }(chans[i])
}
for i := 0; i < 1000000; i++ {
    chans[i%N] <- i
}
```

Now each producer-consumer pair has its own channel; no shared lock contention.

---

## Bug 19 — Reading `runtime.NumGoroutine()` in a hot loop

```go
func handler(w http.ResponseWriter, r *http.Request) {
    n := runtime.NumGoroutine()
    log.Printf("active goroutines: %d", n)
    // ... handle request ...
}
```

**Bug (subtle).** `runtime.NumGoroutine()` walks the scheduler's per-P run queues. Under high request rate, this is called constantly from many cores, causing repeated reads of scheduler internal state — bouncing scheduler-internal cache lines.

Not false sharing in the strictest sense (it's reading scheduler state), but a related contention pattern. The fix: don't call `runtime.NumGoroutine()` in a hot path. Sample once per second in a background goroutine.

---

## Bug 20 — The benchmark is measuring something else

```go
func BenchmarkAtomicInc(b *testing.B) {
    var x int64
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        atomic.AddInt64(&x, 1)
    }
}
```

**Bug.** This benchmark is single-goroutine. There is no contention to measure. The atomic op costs ~5 ns regardless of cache behaviour.

To measure false sharing, you must have multiple goroutines on multiple cores. Use `b.RunParallel` or hand-rolled goroutines plus `-cpu=N`.

**Fix.**

```go
func BenchmarkAtomicIncParallel(b *testing.B) {
    var x int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            atomic.AddInt64(&x, 1)
        }
    })
}
```

This runs with goroutines per `-cpu` value, showing the contention cost.

---

## Discussion

These bugs share a pattern:

- The program is *correct* (no race detector findings, no panics).
- The bug manifests only under multi-core load.
- The fix is a small layout change.
- The verification is a benchmark + `perf c2c`.

Working through 20 such examples builds a reflex: when you see hot, concurrent state, immediately ask "do these variables share cache lines?" — and have the tools to answer.

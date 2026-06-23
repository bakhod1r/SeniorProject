---
layout: default
title: Optimize
parent: Batching
grand_parent: Production Patterns
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/03-batching/optimize/
---

# Batching — Optimization Exercises

> Each exercise gives a slow or sub-optimal batcher and asks you to make it faster, leaner, or more responsive. Always profile first, optimise second.

---

## Exercise 1 — Allocation per flush

### Slow code

```go
func (b *Batcher) flush(buf []int) {
    batch := make([]int, len(buf))
    copy(batch, buf)
    b.sink.Write(batch)
}
```

Every flush allocates a fresh `[]int`. Over 100K flushes/s, that is 100K allocations/s plus GC pressure.

### Goal

Reduce allocation rate to near-zero in steady state.

### Approach

Use a `sync.Pool` for flush buffers:

```go
var batchPool = sync.Pool{
    New: func() interface{} {
        return make([]int, 0, 1024)
    },
}

func (b *Batcher) flush(buf []int) {
    batch := batchPool.Get().([]int)[:0]
    batch = append(batch, buf...)
    b.sink.Write(batch)
    batchPool.Put(batch)
}
```

After the sink returns, return the batch to the pool. The next flush reuses it.

### Caveat

If the sink stores the batch (e.g., asynchronously), do not return it to the pool until the sink is done. For synchronous sinks this is fine.

### Measurement

```bash
go test -bench BenchmarkBatcherFlush -benchmem
```

Look for `0 allocs/op` after the pool warm-up.

---

## Exercise 2 — Channel send hot path

### Slow code

```go
type Item struct {
    UserID    string
    Action    string
    Timestamp time.Time
    Metadata  map[string]string
}

func (b *Batcher) Add(item Item) {
    b.in <- item
}
```

`Item` is a 64+ byte struct with a map field. Every `chan Item` send copies the whole struct.

### Goal

Reduce per-send cost.

### Approach 1: Pointer items

```go
type Batcher struct {
    in chan *Item
}

func (b *Batcher) Add(item *Item) {
    b.in <- item
}
```

Pointer is 8 bytes, copied on every send. But pointers force item to be heap-allocated; trade-off.

### Approach 2: Inline struct

If items are smaller than ~32 bytes, by-value is fine. Strip the map.

### Approach 3: Flatten

Replace `map[string]string` with a fixed slice of string pairs, or with a `[]byte` of serialised metadata. Map allocation is the real cost.

### Measurement

Use `pprof -alloc_space`. Look for `chan send` allocations and `Item` allocations.

---

## Exercise 3 — Time trigger drift

### Slow code

```go
ticker := time.NewTicker(b.maxDelay)
for {
    select {
    case item := <-b.in:
        // ...
    case <-ticker.C:
        flush()
    }
}
```

The ticker fires on a fixed wall-clock schedule. If a flush takes 200 ms and `maxDelay` is 100 ms, the next tick is queued during the flush; the next iteration consumes it immediately. Net effect: time-triggered batches can be smaller than expected.

### Goal

Make the time trigger fire exactly `maxDelay` after the first item of a batch.

### Approach: `time.Timer` reset on first item

```go
var timer *time.Timer
var timerC <-chan time.Time

for {
    select {
    case item := <-b.in:
        buf = append(buf, item)
        if len(buf) == 1 {
            timer = time.NewTimer(b.maxDelay)
            timerC = timer.C
        }
        if len(buf) >= b.maxSize {
            flush()
            timer.Stop()
            timer = nil
            timerC = nil
        }
    case <-timerC:
        flush()
        timer = nil
        timerC = nil
    }
}
```

Now every batch has exactly `maxDelay` between first item and flush.

### Caveat

`time.Timer.Stop()` returns false if the timer has already fired. Drain the channel if needed (Go 1.23 fixes this).

### Measurement

Histogram the per-batch latency. The timer version has tighter p99.

---

## Exercise 4 — Slow JSON marshalling

### Slow code

```go
func (s *HTTPSink) Write(batch []Event) error {
    body, _ := json.Marshal(batch)
    // post body...
}
```

Standard JSON marshalling allocates per field and uses reflection.

### Goal

Reduce serialisation CPU and allocations.

### Approach 1: `easyjson` or `ffjson`

These generate type-specific marshallers, avoiding reflection. 2-5x speedup.

### Approach 2: Streaming encoder

```go
func (s *HTTPSink) Write(batch []Event) error {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)
    enc := json.NewEncoder(buf)
    for _, e := range batch {
        if err := enc.Encode(e); err != nil {
            return err
        }
    }
    // post buf.Bytes()...
}
```

Reuse the buffer across calls.

### Approach 3: Protocol Buffers

If you control both ends, switch to protobuf. 5-10x faster than JSON for typed data.

### Measurement

Compare `json.Marshal` vs `easyjson` vs `proto.Marshal` benchmarks. Profile with `-cpuprofile`.

---

## Exercise 5 — Lock contention on metrics

### Slow code

```go
type Batcher struct {
    mu       sync.Mutex
    enqueued int
}

func (b *Batcher) Add(item int) {
    b.in <- item
    b.mu.Lock()
    b.enqueued++
    b.mu.Unlock()
}
```

The mutex serialises all Add calls. At 1M ops/s, the mutex is the bottleneck.

### Goal

Eliminate the mutex.

### Approach: `atomic.Int64`

```go
type Batcher struct {
    enqueued atomic.Int64
}

func (b *Batcher) Add(item int) {
    b.in <- item
    b.enqueued.Add(1)
}
```

Atomic increments are ~5x faster than mutex on uncontended; on contended, much more.

### Measurement

`go test -race -bench .` Confirm no race. Compare ns/op.

---

## Exercise 6 — Pool size starvation

### Slow code

```go
pool, _ := pgxpool.New(ctx, "postgres://...", pgxpool.Config{MaxConns: 4})

// Batcher with 4 flush workers, each calling pool.Acquire()
```

With 4 flush workers and pool size 4, all workers can be active. But under load, *anything else* in the service that wants a connection (a separate query, a health check) blocks.

### Goal

Avoid pool starvation.

### Approach: oversize the pool

Set `MaxConns` to at least `numFlushers * 2`. The extra slots handle ad-hoc queries.

### Approach: separate pool for batcher

Give the batcher its own pool. Other code uses a different pool. Bulkheading.

### Measurement

`pgxpool.Stat().IdleConns` should be >= 1 in steady state. `AcquireDuration` should be near zero p99.

---

## Exercise 7 — Buffer grows over time

### Slow code

```go
buf := make([]int, 0, 100)
// ...
buf = append(buf, manyItems...) // grows past 100
// ...
buf = buf[:0]
// Now cap(buf) is large; memory pinned.
```

A single oversized append grows the buffer's backing array. `buf = buf[:0]` keeps the larger array; memory stays high.

### Goal

Bound the buffer's capacity.

### Approach: rebuild when oversized

```go
buf = buf[:0]
if cap(buf) > b.maxSize*2 {
    buf = make([]int, 0, b.maxSize)
}
```

After a rare oversized flush, the next iteration replaces the buffer with a fresh, properly-sized one.

### Measurement

`runtime.ReadMemStats` for HeapAlloc. Compare with and without the rebuild.

---

## Exercise 8 — Slow flush blocks accumulation

### Slow code

```go
for {
    select {
    case item := <-b.in:
        buf = append(buf, item)
        if len(buf) >= maxSize {
            b.sink.Write(buf) // <-- can be slow
            buf = buf[:0]
        }
    case <-ticker.C:
        // ...
    }
}
```

A 500 ms flush blocks the run loop for 500 ms. New items pile up in the channel; producers block.

### Goal

Decouple flush from accumulation.

### Approach: pipeline with worker

```go
flushReq := make(chan []int, 4)
go func() {
    for batch := range flushReq {
        b.sink.Write(batch)
    }
}()

for {
    select {
    case item := <-b.in:
        buf = append(buf, item)
        if len(buf) >= maxSize {
            batch := make([]int, len(buf))
            copy(batch, buf)
            flushReq <- batch
            buf = buf[:0]
        }
    // ...
    }
}
```

Now the run loop hands off to the worker and continues. Multiple batches can be queued for flush.

### Caveat

`flushReq` cap is your backpressure boundary. If it fills, the run loop blocks. Tune the cap.

### Measurement

Profile the run loop's `select` time vs `flush` time. After the change, run loop should be 99%+ idle waiting on the channel.

---

## Exercise 9 — Map-based combiner with frequent reallocation

### Slow code

```go
counts := make(map[string]int)
for item := range b.in {
    counts[item]++
}
// On flush:
sink.Write(counts)
counts = make(map[string]int)
```

Each flush allocates a fresh map. The old map is GC'd.

### Goal

Reuse the map allocation.

### Approach 1: Reset by clearing keys

```go
for k := range counts {
    delete(counts, k)
}
```

Go's `delete` clears the entry but does not shrink the map's underlying memory. Subsequent inserts reuse the slots. For maps that grow and shrink predictably, this is fast.

### Approach 2: Go 1.21 `clear`

```go
clear(counts)
```

Same effect, idiomatic. Available since Go 1.21.

### Approach 3: Double map

Keep two maps; alternate. The flush ships one; the other accumulates. Eliminates the contention between read-on-flush and write-on-add.

### Measurement

Allocations/op via benchmark. Should drop to near zero after warm-up.

---

## Exercise 10 — Hot lock on per-tenant map

### Slow code

```go
type Batcher struct {
    mu   sync.Mutex
    bufs map[string][]Item
}

func (b *Batcher) Add(item Item) {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.bufs[item.Tenant] = append(b.bufs[item.Tenant], item)
    // ...
}
```

The single mutex serialises all Adds across tenants. 1000 tenants, 1 lock.

### Goal

Reduce lock contention.

### Approach 1: Per-tenant lock

```go
type Batcher struct {
    bufs sync.Map // map[string]*tenantBuf
}

type tenantBuf struct {
    mu  sync.Mutex
    buf []Item
}
```

Now each tenant has its own lock. Cross-tenant adds do not contend.

### Approach 2: Shard the map

```go
type Batcher struct {
    shards [16]struct {
        mu   sync.Mutex
        bufs map[string][]Item
    }
}

func (b *Batcher) shardFor(tenant string) int {
    return int(hash(tenant)) % 16
}
```

16 shards, 16 locks. Cross-tenant adds contend only within the same shard.

### Measurement

`pprof.Lookup("mutex")` for contention profile (requires `runtime.SetMutexProfileFraction(1)`).

---

## Exercise 11 — Inefficient COPY FROM

### Slow code

```go
func (s *PGSink) Write(ctx context.Context, batch []Event) error {
    rows := make([][]any, len(batch))
    for i, e := range batch {
        rows[i] = []any{e.UserID, e.Action, e.TS}
    }
    _, err := s.pool.CopyFrom(ctx, pgx.Identifier{"events"},
        []string{"user_id", "action", "ts"}, pgx.CopyFromRows(rows))
    return err
}
```

Each Write allocates `len(batch)` slices for rows. At 1000-row batches, that is 1000 allocs.

### Goal

Reduce allocation in CopyFrom path.

### Approach: pgx CopyFromSource interface

Implement `CopyFromSource` directly, reading from a pre-allocated buffer.

```go
type batchSource struct {
    batch []Event
    i     int
    row   []any
}

func (s *batchSource) Next() bool { s.i++; return s.i <= len(s.batch) }
func (s *batchSource) Values() ([]any, error) {
    e := s.batch[s.i-1]
    s.row[0] = e.UserID
    s.row[1] = e.Action
    s.row[2] = e.TS
    return s.row, nil
}
func (s *batchSource) Err() error { return nil }
```

Single `[]any` reused across rows.

### Measurement

`-benchmem`. Compare `allocs/op` before and after.

---

## Exercise 12 — Compression in the flush path

### Slow code

```go
func (s *HTTPSink) Write(batch []Event) error {
    body, _ := json.Marshal(batch)
    resp, _ := http.Post(s.url, "application/json", bytes.NewReader(body))
    // ...
}
```

Network bandwidth is the bottleneck (uncompressed JSON is 5-10x larger than compressed).

### Goal

Reduce bytes on the wire.

### Approach: gzip the body

```go
func (s *HTTPSink) Write(batch []Event) error {
    body, _ := json.Marshal(batch)
    var compressed bytes.Buffer
    gz := gzip.NewWriter(&compressed)
    gz.Write(body)
    gz.Close()
    req, _ := http.NewRequest("POST", s.url, &compressed)
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("Content-Encoding", "gzip")
    s.client.Do(req)
    // ...
}
```

For typical JSON, gzip cuts 5-10x. For pre-compressed data (already-compressed binary), gzip is a small overhead.

### Approach: zstd

For very large payloads, `zstd` is faster than gzip at similar compression ratios.

### Measurement

Network bytes per second. Should drop dramatically.

---

## Exercise 13 — Sleeping in tight retry loop

### Slow code

```go
for try := 0; try < 10; try++ {
    err := sink.Write(batch)
    if err == nil {
        return nil
    }
    time.Sleep(100 * time.Millisecond)
}
```

10 retries with 100 ms sleep = 1 second of blocked goroutine even if all retries fail. Plus no ctx-awareness.

### Goal

Make retries ctx-aware and use exponential backoff.

### Approach

```go
delay := 100 * time.Millisecond
for try := 0; try < 10; try++ {
    err := sink.Write(ctx, batch)
    if err == nil {
        return nil
    }
    if !isTransient(err) {
        return err
    }
    jitter := time.Duration(rand.Int63n(int64(delay)))
    select {
    case <-time.After(delay + jitter):
    case <-ctx.Done():
        return ctx.Err()
    }
    delay *= 2
    if delay > 10*time.Second {
        delay = 10 * time.Second
    }
}
return errors.New("retries exhausted")
```

### Measurement

Benchmark with transient sink failures; verify retries complete in expected wall time.

---

## Exercise 14 — Reflection-heavy generic batcher

### Slow code

```go
type Batcher struct {
    in chan interface{}
}

func (b *Batcher) flush(buf []interface{}) {
    // Each item is interface{}; sink type-asserts
}
```

`interface{}` adds boxing overhead per send and forces heap allocation.

### Goal

Use Go generics for type-safe, zero-overhead items.

### Approach

```go
type Batcher[T any] struct {
    in chan T
}

func (b *Batcher[T]) flush(buf []T) {
    // No boxing
}
```

Go 1.18+. The compiler specialises per T.

### Measurement

`-benchmem`. Allocations per op should drop.

---

## Exercise 15 — Spinning in the run loop

### Slow code

```go
for {
    select {
    case item := <-b.in:
        // ...
    default:
        // Empty: spin
    }
}
```

The `default` case turns the select into a busy loop. CPU pegged at 100%.

### Goal

Block when nothing to do.

### Approach

Remove the `default`. The select blocks until a case is ready.

```go
for {
    select {
    case item := <-b.in:
        // ...
    case <-ticker.C:
        // ...
    }
}
```

### Measurement

CPU usage. From 100% to near-idle when there is no traffic.

---

## Exercise 16 — Sync.Map vs regular map

### Background

`sync.Map` is optimised for "write-once, read-many" or "completely disjoint keys per goroutine". For "mostly-write" workloads (typical batcher tenant map), regular `map[K]V` with a mutex is faster.

### Exercise

Profile a per-tenant batcher with sync.Map vs map+mutex. Confirm map+mutex is faster for your workload.

For 1000 tenants with all goroutines touching all tenants, map+mutex wins. For 1M tenants with each goroutine touching only "its own" tenant, sync.Map can win.

---

## Exercise 17 — Allocation in `time.Now()`

### Background

`time.Now()` is fast but does allocate a `time.Time`. In hot paths, this matters.

### Slow code

```go
func (b *Batcher) Add(item int) {
    b.lastAddTime = time.Now() // every Add
    b.in <- item
}
```

### Goal

Reduce allocation cost of timestamps.

### Approach

- Use `monotime` library or `runtime.nanotime`-based abstraction.
- Or: timestamp at the consumer side, not on Add.

In practice, `time.Now()` is fast (~50 ns) and the allocation is on the stack (no GC pressure). Profile before optimising.

---

## Exercise 18 — Excessive context cancellation checks

### Slow code

```go
func (b *Batcher) Add(ctx context.Context, item int) error {
    select {
    case <-ctx.Done():
        return ctx.Err()
    default:
    }
    select {
    case <-ctx.Done():
        return ctx.Err()
    case b.in <- item:
        return nil
    }
}
```

Three select-on-ctx checks. Each is fast individually but unnecessary.

### Goal

Minimise overhead.

### Approach

Just the second select is enough; `select` evaluates all cases simultaneously.

```go
func (b *Batcher) Add(ctx context.Context, item int) error {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case b.in <- item:
        return nil
    }
}
```

### Measurement

Benchmark. Saves ~30 ns per Add. Add up over 1M ops/s.

---

## Exercise 19 — Logging on every flush

### Slow code

```go
flush := func(reason string) {
    log.Printf("batcher: flushed %d items reason=%s", len(buf), reason)
    sink.Write(buf)
    buf = buf[:0]
}
```

`log.Printf` allocates. At 1000 flushes/s, that is 1000 log lines/s. Disk I/O bound.

### Goal

Reduce logging cost.

### Approach 1: Sampling

```go
if rand.Intn(100) < 1 { // 1% of flushes
    log.Printf(...)
}
```

### Approach 2: Replace with metric

Don't log per-flush. Increment a metric counter; log only on errors or anomalies.

### Approach 3: Structured logging

`slog.Info("flush", "reason", reason, "size", len(buf))` is faster than fmt-based Printf.

### Measurement

Compare CPU profile. Logging should be < 5% of total CPU.

---

## Exercise 20 — End-to-end optimisation

### Setup

Take Task 20 from `tasks.md` (full HTTP service with Postgres batcher). Measure baseline:

- Throughput: req/s.
- p99 API latency.
- p99 batch flush duration.
- CPU usage.
- Memory usage.
- Allocations per request.

### Goal

Reduce CPU by 30% without compromising throughput or latency.

### Approach

Apply the optimisations from this file:

1. sync.Pool for batch slices.
2. Generics (Go 1.18+) instead of interface{}.
3. easyjson or proto serialisation.
4. Atomic counters for stats.
5. Compression on the wire.
6. Per-tenant sharding if multi-tenant.
7. Connection pool tuning.

Measure each. Some will help; some will not (depending on what was the bottleneck).

### Lesson

Optimisation is the discipline of measuring, changing, measuring again. Without the measurement, all "optimisations" are guesses.

---

## How to Practise

For each exercise:

1. Write the slow version. Benchmark it.
2. Apply the fix. Benchmark again.
3. Compare the numbers.

If the fix did not help (the bottleneck was elsewhere), you have learned something. Note it down.

A senior engineer can quote ns/op numbers from memory for channel ops, mutex acquire, map lookup, time.Now, alloc/free. Build that intuition through exercises.

The optimisations here are *micro*-optimisations. They matter at high throughput. Below 10K ops/s, focus on correctness first; the optimisations come later if at all.

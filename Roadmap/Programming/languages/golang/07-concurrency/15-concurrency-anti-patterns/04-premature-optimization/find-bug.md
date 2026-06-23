---
layout: default
title: Find Bug
parent: Premature Optimization
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 8
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/04-premature-optimization/find-bug/
---

# Premature Concurrency Optimization — Find the Bug

Twelve code snippets where concurrency is the bug — either making the code slower than the sequential version, increasing latency, or hiding correctness issues. For each, identify the bug, explain why it's a bug, and propose a fix.

Each snippet is presented first, followed by the analysis. Try to spot the bug before reading the analysis.

---

## Snippet 1: parallel sum, sequential effect

```go
func parallelSum(xs []int) int {
    var mu sync.Mutex
    var sum int
    var wg sync.WaitGroup
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

### Bug

The mutex serialises all the goroutines. They're all waiting for the same lock to update one shared counter. The "parallel" version runs effectively sequentially, plus the overhead of goroutine spawn, mutex contention, and synchronisation.

### Why it's a bug

- Spawn overhead per item: ~1 µs.
- Mutex contention: each item parks/wakes.
- For typical inputs, this is 100-1000× slower than the simple `for _, x := range xs { sum += x }`.

### Fix

Just use a `for` loop. Or, if `xs` is huge, partition: each goroutine sums its chunk into a local variable, and a final merge adds them. No mutex needed in the hot path.

---

## Snippet 2: channel coordination on hot path

```go
func processStream(input []Item) {
    work := make(chan Item)
    done := make(chan struct{})

    go func() {
        for item := range work {
            doTiny(item) // ~50 ns of work
        }
        close(done)
    }()

    for _, item := range input {
        work <- item
    }
    close(work)
    <-done
}
```

### Bug

A channel send/recv costs ~50-250 ns. The work itself is ~50 ns. The channel coordination is 2-5× the cost of the actual work. The "concurrent" version is slower than just `for _, item := range input { doTiny(item) }`.

### Fix

Don't use a channel for tiny work. Just call directly. If you must distribute work, batch it — send slices of 100 items, not single items.

---

## Snippet 3: per-item goroutine for fast work

```go
func fastWork(items []int) []int {
    out := make([]int, len(items))
    var wg sync.WaitGroup
    for i, x := range items {
        i, x := i, x
        wg.Add(1)
        go func() {
            defer wg.Done()
            out[i] = x * 2 // trivial
        }()
    }
    wg.Wait()
    return out
}
```

### Bug

Spawning a goroutine costs ~1 µs. The work is one multiplication (~1 ns). For 10,000 items, you spawn 10,000 goroutines costing ~10 ms — for work that should take ~10 µs.

### Fix

Either use a simple `for` loop (almost certainly faster), or use a bounded worker pool with chunked work.

---

## Snippet 4: false sharing in a counter pool

```go
type Counters struct {
    Requests, Errors, BytesIn, BytesOut int64
}

func (c *Counters) AddRequest() {
    atomic.AddInt64(&c.Requests, 1)
}

func (c *Counters) AddError() {
    atomic.AddInt64(&c.Errors, 1)
}

// ... etc
```

### Bug

All four counters fit in one 64-byte cache line. Multiple goroutines incrementing different counters will bounce the cache line between cores. Each `atomic.AddInt64` becomes 10-30× slower than its uncontended cost.

### Fix

Pad each counter to its own cache line:

```go
type Counters struct {
    Requests int64
    _        [56]byte
    Errors   int64
    _        [56]byte
    BytesIn  int64
    _        [56]byte
    BytesOut int64
    _        [56]byte
}
```

---

## Snippet 5: huge buffered channel hides overload

```go
events := make(chan Event, 1_000_000)

go consumer(events)
go producer(events)
```

### Bug

The buffer is so large that the consumer can fall arbitrarily behind without backpressure. Latency for items in the queue can be seconds. Memory grows. The system appears healthy until OOM.

### Fix

Use a small buffer (16, 64, 256). When the consumer slows, the producer blocks, which provides backpressure. If you want to drop instead of block, use a non-blocking send with a fallback.

---

## Snippet 6: sync.RWMutex hurting reader path

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string]string
}

func (c *Cache) Get(k string) string {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.m[k] // 20 ns of work
}
```

### Bug

`sync.RWMutex.RLock` is ~50 ns; the critical section is ~20 ns. The reader spends more time on the lock than on the work. `sync.RWMutex` only pays off if critical sections are long enough to benefit from reader parallelism.

### Fix

Use `sync.Mutex` (uncontended Lock is ~10 ns). Or, if writes are very rare, use copy-on-write with `atomic.Pointer[map[string]string]`.

---

## Snippet 7: sync.Pool for small objects

```go
var pool = sync.Pool{
    New: func() interface{} { return make([]byte, 16) },
}

func process(x int) []byte {
    b := pool.Get().([]byte)
    defer pool.Put(b)
    binary.LittleEndian.PutUint64(b[:8], uint64(x))
    return b
}
```

### Bug

There are two issues: (1) the buffer is 16 bytes — allocating it is ~30 ns, pool overhead is ~30 ns, no win. (2) `Put` returns the buffer while the caller still holds it; the next `Get` returns the same buffer, overwriting the caller's data. This is a correctness bug masquerading as an optimization.

### Fix

For small buffers, just allocate. If you must reuse, ensure the buffer is no longer referenced before `Put`.

---

## Snippet 8: goroutine leak from forgot-close

```go
func handler(w http.ResponseWriter, r *http.Request) {
    work := make(chan int)
    go func() {
        for x := range work {
            process(x)
        }
    }()
    // ... fill work
    // ... return without close(work)
}
```

### Bug

The goroutine never exits because the channel is never closed. Every request leaks one goroutine. Eventually, OOM.

### Fix

`defer close(work)` in the handler, or ensure all return paths close the channel.

---

## Snippet 9: context not propagated, work continues after return

```go
func handler(w http.ResponseWriter, r *http.Request) {
    var data []int
    go func() {
        data = expensiveFetch(context.Background()) // wrong!
    }()
    // ... handler returns
}
```

### Bug

Two bugs: (1) `data` is a data race (handler reads or modifies without synchronisation). (2) The goroutine uses `Background` instead of `r.Context()`, so if the client disconnects, the goroutine still runs to completion — wasting work and potentially expensive resources.

### Fix

Use `r.Context()` for cancellation. Use `errgroup.WithContext` or wait properly for the goroutine before returning.

---

## Snippet 10: parallel processing of dependent items

```go
type Account struct{ Balance int }

func transfer(accounts []*Account, transfers []Transfer) {
    var wg sync.WaitGroup
    for _, t := range transfers {
        t := t
        wg.Add(1)
        go func() {
            defer wg.Done()
            accounts[t.From].Balance -= t.Amount
            accounts[t.To].Balance += t.Amount
        }()
    }
    wg.Wait()
}
```

### Bug

The transfers are dependent (they update shared state). The "parallel" version has races — two goroutines updating the same account simultaneously give incorrect totals. This is a *correctness* bug, but it's also a performance issue because adding a mutex to fix it serialises everything, making parallel no faster than sequential.

### Fix

Process transfers sequentially. If parallelism is essential, partition by account (each shard sequential within itself).

---

## Snippet 11: time.After in tight loop

```go
func waitForChan(ch chan int) {
    for {
        select {
        case <-ch:
            // process
        case <-time.After(time.Second):
            log.Println("waited a second")
        }
    }
}
```

### Bug

Each iteration creates a new `time.After` timer. If `ch` fires frequently, you accumulate timers — each held until it fires 1 second later. Memory grows.

### Fix

Use `time.NewTimer` and `Reset`:

```go
timer := time.NewTimer(time.Second)
defer timer.Stop()
for {
    timer.Reset(time.Second)
    select {
    case <-ch:
        if !timer.Stop() {
            <-timer.C
        }
    case <-timer.C:
        log.Println("waited a second")
    }
}
```

---

## Snippet 12: unbounded goroutine spawn per request

```go
func handler(w http.ResponseWriter, r *http.Request) {
    var ids []int
    json.NewDecoder(r.Body).Decode(&ids)
    var wg sync.WaitGroup
    for _, id := range ids {
        id := id
        wg.Add(1)
        go func() {
            defer wg.Done()
            backendCall(id)
        }()
    }
    wg.Wait()
}
```

### Bug

The number of goroutines is `len(ids)` — unbounded by the caller. A malicious or buggy client can send a giant array, spawning millions of goroutines. Two consequences: (1) memory explosion, (2) the backend gets a thundering herd that may DDoS it.

### Fix

Bound the fan-out:

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(8)
for _, id := range ids {
    id := id
    g.Go(func() error { return backendCall(ctx, id) })
}
return g.Wait()
```

Also validate `len(ids)` against a sane maximum at the API boundary.

---

## Summary

The 12 bugs covered:

1. Parallel sum with mutex (sequential effect).
2. Channel for tiny work (overhead dominates).
3. Goroutine per fast item (spawn cost).
4. False sharing (cache-line bouncing).
5. Huge buffered channel (no backpressure).
6. RWMutex for short reads (reader overhead).
7. sync.Pool for tiny objects (overhead + race).
8. Goroutine leak (channel never closed).
9. Background context (no cancellation).
10. Parallel dependent items (race).
11. time.After in loop (timer leak).
12. Unbounded fan-out (memory + DDoS).

All twelve are concurrent code that the author thought would be faster, more flexible, or safer — but each is in fact slower, leakier, or buggier than a simpler approach.

The lesson: every `go`, every `chan`, every `mu` is a commitment. Make sure it pays off.

End of find-bug.

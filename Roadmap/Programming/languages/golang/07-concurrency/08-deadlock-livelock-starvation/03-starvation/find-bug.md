# Starvation — Find the Bug

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Bug 1: Slow Callback Under RLock](#bug-1-slow-callback-under-rlock)
3. [Bug 2: Pure Priority Queue](#bug-2-pure-priority-queue)
4. [Bug 3: Always-Ready Default Spin](#bug-3-always-ready-default-spin)
5. [Bug 4: RWMutex on Tiny Critical Section](#bug-4-rwmutex-on-tiny-critical-section)
6. [Bug 5: Unbounded Job Queue](#bug-5-unbounded-job-queue)
7. [Bug 6: Single Global Tenant Queue](#bug-6-single-global-tenant-queue)
8. [Bug 7: Non-Cancellable Lock in HTTP Handler](#bug-7-non-cancellable-lock-in-http-handler)
9. [Bug 8: Biased Two-Stage Select Without Aging](#bug-8-biased-two-stage-select-without-aging)
10. [Bug 9: Reader Pinning Inside RLock](#bug-9-reader-pinning-inside-rlock)
11. [Bug 10: Lock Held Across Channel Send](#bug-10-lock-held-across-channel-send)

---

## How to Use This File

Each bug is presented as code with a description of the production symptom. Read the code, formulate a hypothesis, then read the diagnosis and fix.

These bugs are drawn from patterns commonly seen in real Go services. Some are subtle and may not surface in tests until load increases.

---

## Bug 1: Slow Callback Under RLock

### Code

```go
package main

import "sync"

type Store struct {
    mu   sync.RWMutex
    data map[string]string
}

func (s *Store) ForEach(fn func(k, v string)) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    for k, v := range s.data {
        fn(k, v)
    }
}

func (s *Store) Set(k, v string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.data[k] = v
}
```

### Symptom

`Set` latency p99 spikes to 200 ms during business hours. p50 is 50 µs. Mutex profile shows `Lock` waiting on `ForEach` callers.

### Diagnosis

`ForEach` holds the read lock for the entire iteration *and* invokes a user-supplied callback under the lock. If the callback does anything slow (network I/O, large computation, taking another lock), the read critical section stretches to match. Writers wait behind the slowest callback execution.

### Fix

Snapshot under the lock; iterate outside:

```go
func (s *Store) ForEach(fn func(k, v string)) {
    s.mu.RLock()
    snapshot := make(map[string]string, len(s.data))
    for k, v := range s.data {
        snapshot[k] = v
    }
    s.mu.RUnlock()
    for k, v := range snapshot {
        fn(k, v)
    }
}
```

Trade-off: the snapshot does not reflect concurrent updates that happen during iteration. Acceptable for most read-mostly use cases.

---

## Bug 2: Pure Priority Queue

### Code

```go
type PriorityQueue struct {
    mu    sync.Mutex
    items []*Item
}

func (q *PriorityQueue) Push(it *Item) {
    q.mu.Lock()
    defer q.mu.Unlock()
    q.items = append(q.items, it)
    sort.Slice(q.items, func(i, j int) bool {
        return q.items[i].Priority < q.items[j].Priority
    })
}

func (q *PriorityQueue) Pop() *Item {
    q.mu.Lock()
    defer q.mu.Unlock()
    if len(q.items) == 0 {
        return nil
    }
    it := q.items[0]
    q.items = q.items[1:]
    return it
}
```

### Symptom

Low-priority jobs (priority > 0) submitted at 09:00 are still pending at 18:00. Throughput on high-priority jobs is fine.

### Diagnosis

A pure priority queue starves low-priority items if high-priority items arrive faster than they can be processed. The queue never gets a chance to pop a low-priority item because there is always at least one high-priority item ahead of it.

### Fix

Aging or MLFQ. For aging, see Task 4 in `tasks.md`. For MLFQ, replace the single sorted slice with per-priority FIFOs and a weighted dispatcher.

---

## Bug 3: Always-Ready Default Spin

### Code

```go
func consumer(ch <-chan int) {
    for {
        select {
        case v := <-ch:
            process(v)
        default:
            // wait for work
        }
    }
}
```

### Symptom

CPU at 100% per consumer. Other goroutines on the same P make no progress on Go 1.13. On Go 1.14+ they progress but the consumer still wastes CPU.

### Diagnosis

The `default` branch is taken every iteration the channel is empty. The loop becomes a tight spin. It consumes a full P. Pre-1.14, async preemption did not interrupt this loop, so other goroutines on the same P were starved.

### Fix

Remove the `default`:

```go
func consumer(ch <-chan int) {
    for v := range ch {
        process(v)
    }
}
```

Or, if you need cancellation:

```go
func consumer(ctx context.Context, ch <-chan int) {
    for {
        select {
        case v := <-ch:
            process(v)
        case <-ctx.Done():
            return
        }
    }
}
```

---

## Bug 4: RWMutex on Tiny Critical Section

### Code

```go
type Cache struct {
    mu   sync.RWMutex
    data map[string]string
}

func (c *Cache) Get(k string) string {
    c.mu.RLock()
    v := c.data[k]
    c.mu.RUnlock()
    return v
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    c.data[k] = v
    c.mu.Unlock()
}
```

### Symptom

Benchmark shows `Cache.Get` is *slower* than the same code with plain `sync.Mutex`. Writers also wait longer than expected.

### Diagnosis

`RWMutex` has higher per-operation cost than `Mutex` due to additional atomic operations on `readerCount` and `readerWait`. When the critical section is a single map lookup, the bookkeeping overhead exceeds the parallelism benefit. Worse, the `RWMutex`'s reader-bias gives no real advantage at this granularity but introduces writer-starvation risk.

### Fix

Use `sync.Mutex` for tiny critical sections:

```go
type Cache struct {
    mu   sync.Mutex
    data map[string]string
}
```

Reserve `RWMutex` for critical sections that do actual work (parsing, validating, calling a downstream service) where the parallelism win exceeds the overhead.

---

## Bug 5: Unbounded Job Queue

### Code

```go
type WorkerPool struct {
    jobs   []Job
    mu     sync.Mutex
    done   chan struct{}
}

func (p *WorkerPool) Submit(j Job) {
    p.mu.Lock()
    p.jobs = append(p.jobs, j)
    p.mu.Unlock()
}

func (p *WorkerPool) Worker() {
    for {
        p.mu.Lock()
        if len(p.jobs) == 0 {
            p.mu.Unlock()
            time.Sleep(10 * time.Millisecond)
            continue
        }
        j := p.jobs[0]
        p.jobs = p.jobs[1:]
        p.mu.Unlock()
        j.Run()
    }
}
```

### Symptom

Memory grows unboundedly under load. The oldest items in the queue see p99 latency in the seconds; new items see p99 in the milliseconds.

### Diagnosis

Producer side has no back-pressure. The slice grows without bound; the worker pool falls behind; older items wait longer. This is not strict starvation but its operational twin: items in the queue can wait arbitrarily long. Also, `p.jobs = p.jobs[1:]` does not free the underlying array elements, causing additional memory pressure.

### Fix

Use a bounded channel:

```go
type WorkerPool struct {
    jobs chan Job
}

func New(workers, capacity int) *WorkerPool {
    p := &WorkerPool{jobs: make(chan Job, capacity)}
    for i := 0; i < workers; i++ {
        go func() {
            for j := range p.jobs {
                j.Run()
            }
        }()
    }
    return p
}

func (p *WorkerPool) Submit(ctx context.Context, j Job) error {
    select {
    case p.jobs <- j:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

The bounded channel applies back-pressure to producers. Items wait at most `capacity / throughput` time before being processed.

---

## Bug 6: Single Global Tenant Queue

### Code

```go
type Limiter struct {
    queue chan Request
}

func (l *Limiter) Submit(r Request) {
    l.queue <- r
}

func (l *Limiter) Worker() {
    for r := range l.queue {
        process(r)
    }
}
```

### Symptom

Tenant A submits 10,000 requests in a burst. Tenant B's requests sit behind them and time out.

### Diagnosis

A single FIFO queue has no notion of fairness between tenants. A noisy tenant fills the queue with their own work; quiet tenants wait. This is multi-tenant starvation.

### Fix

Per-tenant queues with a weighted dispatcher (Deficit Round Robin):

```go
type Limiter struct {
    tenants map[string]*Tenant
    out     chan Request
}

type Tenant struct {
    queue   chan Request
    quantum int
    deficit int
}

func (l *Limiter) Submit(tenant string, r Request) {
    l.tenants[tenant].queue <- r
}

// Dispatcher loops over tenants, applies DRR.
```

See Task 7 in `tasks.md` for a full implementation.

---

## Bug 7: Non-Cancellable Lock in HTTP Handler

### Code

```go
var mu sync.Mutex

func handler(w http.ResponseWriter, r *http.Request) {
    mu.Lock()
    defer mu.Unlock()
    doExpensiveThing()
    w.Write([]byte("ok"))
}
```

### Symptom

A slow client connection holds the lock for 10 seconds. Other requests pile up. Closing the slow connection does not free the lock.

### Diagnosis

`sync.Mutex.Lock` is not cancellable. Once a goroutine is parked in `Lock`, neither client disconnect nor context cancellation can release it. Worse, the goroutine that *holds* the lock continues to hold it even after the client has disconnected; only when `doExpensiveThing()` returns is the lock released.

### Fix

Two approaches:

1. **Move the expensive work out of the lock.** Hold the lock only for the data update; do `doExpensiveThing()` outside.

2. **Use a cancellable lock.** A channel-based binary semaphore with `select` plus `ctx.Done()`:

```go
type CtxMutex struct {
    sem chan struct{}
}

func (m *CtxMutex) Lock(ctx context.Context) error {
    select {
    case m.sem <- struct{}{}:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Then:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    if err := mu.Lock(r.Context()); err != nil {
        http.Error(w, err.Error(), 503)
        return
    }
    defer mu.Unlock()
    ...
}
```

The handler now bails out if the client disconnects (which cancels `r.Context()`).

---

## Bug 8: Biased Two-Stage Select Without Aging

### Code

```go
for {
    select {
    case v := <-urgent:
        handle(v)
        continue
    default:
    }
    select {
    case v := <-urgent:
        handle(v)
    case v := <-normal:
        handle(v)
    case <-ctx.Done():
        return
    }
}
```

### Symptom

Under sustained urgent traffic, normal items are never processed.

### Diagnosis

Phase 1 drains `urgent` non-blockingly. Phase 2 includes `urgent` too, with 50% chance of being picked. Net effect: `urgent` always wins when ready. If `urgent` is always ready, `normal` is starved.

### Fix

Add a periodic forced consumption of `normal`, or use a weighted random:

```go
import "math/rand"

for {
    // Phase 1: poll urgent non-blockingly, but only occasionally.
    if rand.Intn(4) < 3 {
        select {
        case v := <-urgent:
            handle(v)
            continue
        default:
        }
    }
    // Phase 2: blocking select with both.
    select {
    case v := <-urgent:
        handle(v)
    case v := <-normal:
        handle(v)
    case <-ctx.Done():
        return
    }
}
```

Phase 2 is now reached at least 1/4 of iterations even when `urgent` is always ready, giving `normal` a guaranteed share.

---

## Bug 9: Reader Pinning Inside RLock

### Code

```go
type Config struct {
    mu  sync.RWMutex
    val *ConfigData
}

func (c *Config) Use(fn func(*ConfigData)) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    fn(c.val)
}

func (c *Config) Reload(v *ConfigData) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.val = v
}
```

### Symptom

Config reloads are slow during business hours. p99 of `Reload` can reach 1 second.

### Diagnosis

`Use` holds the read lock for the entire `fn` callback. `fn` may be slow (template rendering, ML inference, large pretty-print). Every active reader prevents `Reload` from acquiring.

### Fix

Return a snapshot pointer; consumers operate on it outside the lock. Since `ConfigData` is treated as immutable, this is safe:

```go
func (c *Config) Snapshot() *ConfigData {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.val
}

// Caller:
cfg := config.Snapshot()
fn(cfg)
```

`Reload` now only waits for the briefest read critical section (a pointer load).

Alternative: use `atomic.Pointer[ConfigData]` and skip the mutex entirely. Even faster but requires that `ConfigData` is never mutated after publication.

---

## Bug 10: Lock Held Across Channel Send

### Code

```go
type Hub struct {
    mu      sync.Mutex
    clients map[string]chan Message
}

func (h *Hub) Broadcast(msg Message) {
    h.mu.Lock()
    defer h.mu.Unlock()
    for _, ch := range h.clients {
        ch <- msg
    }
}

func (h *Hub) Register(id string) chan Message {
    h.mu.Lock()
    defer h.mu.Unlock()
    ch := make(chan Message, 10)
    h.clients[id] = ch
    return ch
}
```

### Symptom

A slow client (whose buffer is full) blocks all other broadcasts. `Register` calls also stall.

### Diagnosis

`Broadcast` sends to each client channel while holding the lock. If any client's buffer is full, the send blocks. The lock is held for the duration. New registrations cannot proceed; new broadcasts cannot proceed. The slow client starves everyone.

### Fix

Snapshot under the lock; send outside; handle slow clients explicitly.

```go
func (h *Hub) Broadcast(msg Message) {
    h.mu.Lock()
    channels := make([]chan Message, 0, len(h.clients))
    for _, ch := range h.clients {
        channels = append(channels, ch)
    }
    h.mu.Unlock()

    for _, ch := range channels {
        select {
        case ch <- msg:
        default:
            // Slow client; drop or mark for disconnect.
        }
    }
}
```

The non-blocking `select` with `default` drops messages for clients whose buffer is full instead of blocking. This is the right semantics for a fan-out: a slow consumer should not stall the producer.

Trade-off: dropped messages may need to be tracked or buffered separately. Production WebSocket hubs typically maintain a per-client outbound queue with its own back-pressure policy (close the client if its queue exceeds a threshold).

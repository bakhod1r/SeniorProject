---
layout: default
title: Decision Tree — Find the Bug
parent: Decision Tree
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/04-decision-tree/find-bug/
---

# Decision Tree — Find the Bug

[← Back](../)

Six snippets, each from a real code review. The bug is not always a data race; sometimes it is a correct program that picked a primitive so heavyweight that the cost shows up in production. For each snippet, look first and decide what is wrong before reading the diagnosis.

## Bug 1 — Channel where an atomic suffices

```go
type Counter struct {
    incs chan int
    val  int
}

func NewCounter() *Counter {
    c := &Counter{incs: make(chan int, 1024)}
    go func() {
        for d := range c.incs {
            c.val += d
        }
    }()
    return c
}

func (c *Counter) Add(n int) { c.incs <- n }
func (c *Counter) Value() int { return c.val }
```

**Diagnosis:** `Value()` reads `c.val` without synchronization while the goroutine writes it. That is a data race detected by `-race`.

But the deeper bug is the primitive choice. A counter is the textbook `atomic.Int64` case. The channel-based version adds:

- A goroutine that runs forever (no shutdown logic).
- Allocation per `Add` if the channel buffer fills.
- A race on `Value()` that can only be fixed by sending a request-response pair through another channel, which doubles the latency.

**Fix:** delete the channel and the goroutine:

```go
type Counter struct{ val atomic.Int64 }
func (c *Counter) Add(n int)   { c.val.Add(int64(n)) }
func (c *Counter) Value() int  { return int(c.val.Load()) }
```

Three lines instead of fifteen, no race, no leak, and an order of magnitude faster.

## Bug 2 — Mutex where RWMutex helps (or atomic.Pointer helps more)

```go
type Config struct {
    mu      sync.Mutex
    timeout time.Duration
    maxConn int
}

func (c *Config) Read() (time.Duration, int) {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.timeout, c.maxConn
}

func (c *Config) Reload(t time.Duration, m int) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.timeout = t
    c.maxConn = m
}
```

The code is *correct*. The bug is performance: `Read()` is called 1,000,000 times per second across many goroutines; `Reload()` runs once a minute. Every reader serializes through the same mutex, and at high read rates the mutex becomes a hot cache line.

**Better:** `atomic.Pointer[snapshot]` with copy-on-write.

```go
type snapshot struct {
    timeout time.Duration
    maxConn int
}
type Config struct{ snap atomic.Pointer[snapshot] }

func (c *Config) Read() (time.Duration, int) {
    s := c.snap.Load()
    return s.timeout, s.maxConn
}

func (c *Config) Reload(t time.Duration, m int) {
    c.snap.Store(&snapshot{timeout: t, maxConn: m})
}
```

`sync.RWMutex.RLock` would also help but still costs an atomic increment on a hot reader-count cache line. `atomic.Pointer.Load` is one instruction with no shared cache-line modification on the read path.

## Bug 3 — sync.Cond where a channel close is cleaner

```go
type Latch struct {
    mu    sync.Mutex
    cond  *sync.Cond
    fired bool
}

func New() *Latch {
    l := &Latch{}
    l.cond = sync.NewCond(&l.mu)
    return l
}

func (l *Latch) Fire() {
    l.mu.Lock()
    l.fired = true
    l.mu.Unlock()
    l.cond.Broadcast()
}

func (l *Latch) Wait() {
    l.mu.Lock()
    for !l.fired {
        l.cond.Wait()
    }
    l.mu.Unlock()
}
```

The code works. The bug is that the entire object is reinventing a closed channel.

**Better:**

```go
type Latch struct {
    once sync.Once
    done chan struct{}
}

func New() *Latch { return &Latch{done: make(chan struct{})} }

func (l *Latch) Fire()  { l.once.Do(func() { close(l.done) }) }
func (l *Latch) Wait()  { <-l.done }
```

Half the lines, no mutex contention, supports `select` for timeout/cancellation, no risk of forgetting the predicate loop in `Wait`. `sync.Cond` is justified only when the set of waiters is dynamic *and* each waiter re-checks a per-waiter predicate after wakeup. For a single-shot fire-and-forget signal, channel close is always better.

## Bug 4 — Combined atomic and mutex on the same data

```go
type Stats struct {
    mu       sync.Mutex
    requests atomic.Int64
    bytes    int64
}

func (s *Stats) Record(b int) {
    s.requests.Add(1)
    s.mu.Lock()
    s.bytes += int64(b)
    s.mu.Unlock()
}

func (s *Stats) Snapshot() (int64, int64) {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.requests.Load(), s.bytes
}
```

The bug is the inconsistency between the snapshot of `requests` and `bytes`. The reader holds the mutex, so `bytes` is consistent — but `requests.Load()` is read inside the lock, which is fine for the value but means a concurrent `Record` can update `requests` *between* the load and the read of `bytes`. The snapshot may show `requests = 100, bytes = (sum of first 99 requests)`.

The decision tree's rule: *if two values must move together, pack them into one atomic.Pointer to an immutable struct, or guard both with the same mutex.* Mixing the two primitives gives the worst of both worlds.

**Fix (mutex around both):**

```go
type Stats struct {
    mu       sync.Mutex
    requests int64
    bytes    int64
}

func (s *Stats) Record(b int) {
    s.mu.Lock()
    s.requests++
    s.bytes += int64(b)
    s.mu.Unlock()
}

func (s *Stats) Snapshot() (int64, int64) {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.requests, s.bytes
}
```

**Or (single atomic pointer, if reads vastly outnumber writes):**

```go
type stats struct {
    requests int64
    bytes    int64
}
type Stats struct{ p atomic.Pointer[stats] }

func (s *Stats) Record(b int) {
    for {
        old := s.p.Load()
        next := stats{requests: old.requests + 1, bytes: old.bytes + int64(b)}
        if s.p.CompareAndSwap(old, &next) {
            return
        }
    }
}
```

## Bug 5 — sync.Map where map+RWMutex is correct

```go
var routes sync.Map // path -> *Handler

func RegisterRoute(path string, h *Handler) {
    routes.Store(path, h)
}

func Lookup(path string) (*Handler, bool) {
    v, ok := routes.Load(path)
    if !ok {
        return nil, false
    }
    return v.(*Handler), true
}

// Called every hot reload (~once per minute):
func RebuildRoutes(newRoutes map[string]*Handler) {
    routes.Range(func(k, _ any) bool {
        routes.Delete(k)
        return true
    })
    for path, h := range newRoutes {
        routes.Store(path, h)
    }
}
```

The bug: between the `Range`-delete and the re-`Store`, lookups can fail. There is no atomic "swap the entire map" operation on `sync.Map`. Worse, `sync.Map` is documented for "entry written once, read many times" or "disjoint key sets." Routes are rewritten on every reload — neither use case applies.

**Fix:** `atomic.Pointer[map[string]*Handler]` published as a snapshot:

```go
var routes atomic.Pointer[map[string]*Handler]

func Lookup(path string) (*Handler, bool) {
    m := *routes.Load()
    h, ok := m[path]
    return h, ok
}

func RebuildRoutes(newRoutes map[string]*Handler) {
    routes.Store(&newRoutes)
}
```

Atomic swap of the entire map; readers see the old or the new map but never a half-rebuilt one. Reading is a single atomic load plus a normal map lookup — orders of magnitude faster than `sync.Map.Load` for a frequently-rewritten table.

## Bug 6 — Buffered channel used as a "fire and forget" queue

```go
var auditLog = make(chan AuditEvent, 1000)

func init() {
    go func() {
        for e := range auditLog {
            writeToDB(e)
        }
    }()
}

func RecordEvent(e AuditEvent) {
    select {
    case auditLog <- e:
    default:
        // dropped
    }
}
```

The bug is in the comment "dropped." Under sustained load, the channel fills, every event past the first 1000 is silently lost, and there is no metric, no log, no alert. The decision tree's rule for bounded queues: *when you drop, you must observe the drop.* A buffered channel is the right primitive; the missing piece is observability.

**Fix:** count drops with an atomic counter and surface it as a metric.

```go
var dropped atomic.Int64

func RecordEvent(e AuditEvent) {
    select {
    case auditLog <- e:
    default:
        dropped.Add(1)
    }
}

// Metrics goroutine reads dropped.Load() periodically.
```

Now the dropped events are visible. If the metric grows, the queue depth was wrong; if it stays at zero, the choice was correct. The point is not the primitive; it is closing the feedback loop on the design choice.

## Bug 7 — sync.WaitGroup race with Add inside the goroutine

```go
func process(items []Item) {
    var wg sync.WaitGroup
    for _, it := range items {
        go func(it Item) {
            wg.Add(1) // BUG
            defer wg.Done()
            do(it)
        }(it)
    }
    wg.Wait()
}
```

The bug: `wg.Add(1)` runs inside the goroutine, which means `wg.Wait()` in the main function may execute *before* any goroutine has had a chance to Add. If `Wait()` sees the counter at 0, it returns immediately — silently failing to wait.

This is one of the most common Go concurrency bugs in production code. The race detector catches it sometimes, but not reliably; the symptom is "the function returns before all the work is done."

**Fix:** call `wg.Add` from the spawning goroutine, before the `go` statement:

```go
for _, it := range items {
    wg.Add(1)
    go func(it Item) {
        defer wg.Done()
        do(it)
    }(it)
}
wg.Wait()
```

The `Add(1)` happens-before the `go` statement, which happens-before the goroutine starts, which happens-before `Done()`. The chain is sound. Inverting the order — `Add` inside the goroutine — breaks the chain.

## Bug 8 — Closing a channel from the receiver side

```go
type Pipeline struct {
    in chan Item
}

func (p *Pipeline) Consume() {
    for it := range p.in {
        process(it)
    }
    close(p.in) // BUG: receiver should not close
}

func (p *Pipeline) Send(it Item) {
    p.in <- it // panics if Consume already closed
}
```

The Go convention: *the sender closes; the receiver never closes.* The reason is the panic: sending on a closed channel panics, and only the sender knows when no more sends will happen. A receiver closing the channel races with any concurrent send.

**Fix:** restructure so the sender (or a designated coordinator) closes:

```go
// One sender, many receivers: sender closes when done sending.
// Many senders, one receiver: receivers cannot close; use a separate
// "shutdown" signal and let the channel be garbage-collected.
```

## Bug 9 — Releasing a semaphore without acquiring it

```go
sem := semaphore.NewWeighted(10)

func process(ctx context.Context, item Item) error {
    defer sem.Release(1) // BUG: release before acquire
    if err := sem.Acquire(ctx, 1); err != nil {
        return err
    }
    return doWork(item)
}
```

If `Acquire` fails (context cancelled, for example), the deferred `Release` still runs, releasing a slot that was never acquired. The semaphore's internal counter goes negative or grows unbounded.

**Fix:** put `Release` *inside* the success branch:

```go
func process(ctx context.Context, item Item) error {
    if err := sem.Acquire(ctx, 1); err != nil {
        return err
    }
    defer sem.Release(1)
    return doWork(item)
}
```

The defer is registered only after a successful Acquire. The same pattern applies to mutex Lock and channel acquisition with timeout.

## Pattern recap

The recurring shape of these bugs:

1. **Heavier primitive than needed** (Bugs 1, 3) — channel/goroutine/Cond where atomic/closed-channel works.
2. **Lighter primitive than needed** (Bug 4) — mixing atomic and mutex on data that must move together.
3. **Wrong primitive for the access pattern** (Bugs 2, 5) — mutex where atomic.Pointer scales better; `sync.Map` where it does not fit the documented use cases.
4. **Correct primitive, missing instrumentation** (Bug 6) — buffered channel with silent drops.
5. **Correct primitive, wrong order of operations** (Bugs 7, 9) — `Add` inside the goroutine; `defer Release` before `Acquire`.
6. **Correct primitive, wrong side of the channel closing** (Bug 8) — receiver closing instead of sender.

None of these would fail a unit test. They show up as latency, race detector output, or "where did those events go?" in a postmortem. The fix is always to re-walk the decision tree and ask the four canonical questions: *what am I synchronizing, how many writers, how many readers, do these values move together?*

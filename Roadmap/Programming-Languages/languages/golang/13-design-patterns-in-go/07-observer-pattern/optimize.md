# Observer Pattern — Optimization

## 1. How to use this file

Twelve scenarios where Observer-style code is slower than it needs to be. Each:

- **Scenario** — the inefficiency.
- **Before** — code with realistic benchmark.
- **After** (collapsible) — fix + benchmark + why faster + trade-offs + when NOT.

The honest answer for many Observer "optimizations": they don't matter until you have 1000+ observers or 100k+ events/sec. Below that, simpler code wins.

Anchored at Go 1.22, amd64.

---

## 2. Exercise 1 — Mutex around slice → atomic.Pointer copy-on-write

**Before:**

```go
type Subject struct {
    mu        sync.RWMutex
    observers []Observer
}

func (s *Subject) Notify(e Event) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    for _, o := range s.observers {
        o.Notify(e)
    }
}
```

```
BenchmarkRWMutexNotify-8    20000000   75 ns/op
```

<details><summary>After</summary>

```go
type Subject struct {
    observers atomic.Pointer[[]Observer]
}

func (s *Subject) Notify(e Event) {
    obs := s.observers.Load()
    if obs == nil { return }
    for _, o := range *obs {
        o.Notify(e)
    }
}

func (s *Subject) Subscribe(o Observer) {
    for {
        old := s.observers.Load()
        var next []Observer
        if old != nil {
            next = make([]Observer, len(*old)+1)
            copy(next, *old)
        } else {
            next = make([]Observer, 0, 1)
        }
        next = append(next, o)
        if s.observers.CompareAndSwap(old, &next) {
            return
        }
    }
}
```

```
BenchmarkAtomicPtrNotify-8   50000000   25 ns/op
```

3× faster. No mutex contention; reads are a single atomic load.

**Trade-off:** Subscribe allocates a full new slice. For 100 subscribers, 100 elements copied per Subscribe.

**When NOT:** when reads and writes are balanced. RWMutex is simpler.
</details>

---

## 3. Exercise 2 — Lock held during notification

**Before:**

```go
func (s *Subject) Notify(e Event) {
    s.mu.Lock()
    defer s.mu.Unlock()
    for _, o := range s.observers {
        o.Notify(e)  // slow observer blocks others
    }
}
```

```
BenchmarkLockedNotify-8   1000000   1200 ns/op  (with one slow observer at 1µs)
```

<details><summary>After</summary>

```go
func (s *Subject) Notify(e Event) {
    s.mu.RLock()
    snapshot := append([]Observer(nil), s.observers...)
    s.mu.RUnlock()
    for _, o := range snapshot {
        o.Notify(e)
    }
}
```

```
BenchmarkSnapshotNotify-8   1000000   1015 ns/op
```

Slight overhead from the slice copy, but Subscribe no longer waits behind notification. Much better latency under contention.

**Trade-off:** Per-call allocation of the snapshot slice.

**When NOT:** When the observer list is huge (10k+). The snapshot allocation dominates.
</details>

---

## 4. Exercise 3 — Per-observer goroutine

**Before:**

```go
for _, o := range observers {
    go o.Notify(e)
}
```

```
BenchmarkGoroutinePerObserver-8   1000000   3200 ns/op   96 B/op   2 allocs/op
```

<details><summary>After — Worker pool</summary>

```go
type Subject struct {
    queue chan workItem
}

type workItem struct {
    observer Observer
    event    Event
}

func (s *Subject) Notify(e Event) {
    for _, o := range s.observers {
        s.queue <- workItem{observer: o, event: e}
    }
}

func (s *Subject) workerLoop() {
    for w := range s.queue {
        w.observer.Notify(w.event)
    }
}
```

```
BenchmarkWorkerPool-8   3000000   480 ns/op   0 B/op   0 allocs/op
```

7× faster. Goroutines are reused; no scheduling overhead per event.

**Trade-off:** Fixed pool size. If observers block, the queue fills. Must size carefully.

**When NOT:** When observers are CPU-light and synchronous notify is sufficient.
</details>

---

## 5. Exercise 4 — Channel fan-out per event

**Before:**

```go
for _, ch := range s.subscribers {
    ch <- event
}
```

```
BenchmarkChannelFanout-8   500000   2200 ns/op
```

<details><summary>After — Batch events</summary>

```go
type batch struct{ events []Event }

func (s *Subject) Notify(e Event) {
    s.mu.Lock()
    s.pending = append(s.pending, e)
    s.mu.Unlock()
}

func (s *Subject) flushLoop() {
    t := time.NewTicker(1 * time.Millisecond)
    defer t.Stop()
    for range t.C {
        s.mu.Lock()
        batch := s.pending
        s.pending = nil
        s.mu.Unlock()
        if len(batch) == 0 { continue }
        for _, ch := range s.subscribers {
            ch <- batch
        }
    }
}
```

```
BenchmarkBatched-8   5000000   320 ns/op  (per Notify; flush amortized)
```

7× faster per Notify. Trade-off: events arrive in batches of 1ms intervals.

**When NOT:** Latency-sensitive applications. Real-time updates can't wait 1ms.
</details>

---

## 6. Exercise 5 — Allocation per notify

**Before:**

```go
func (s *Subject) Notify(e Event) {
    snapshot := make([]Observer, len(s.observers))
    copy(snapshot, s.observers)
    for _, o := range snapshot {
        o.Notify(e)
    }
}
```

```
BenchmarkAllocSnapshot-8   2000000   650 ns/op   240 B/op   1 allocs/op
```

<details><summary>After — atomic.Pointer eliminates the copy</summary>

See Exercise 1. The atomic.Pointer pattern doesn't need per-call snapshots — the slice is shared but immutable (subscribers replace the pointer, never mutate the slice in place).

```
BenchmarkAtomicNoCopy-8   50000000   25 ns/op   0 B/op   0 allocs/op
```

Avoids both the lock and the per-call allocation.

**When NOT:** Same as Exercise 1.
</details>

---

## 7. Exercise 6 — Map-based topic dispatch

**Before:**

```go
type Bus struct {
    topics map[string][]chan Event
}

func (b *Bus) Publish(topic string, e Event) {
    for _, ch := range b.topics[topic] {  // map lookup
        ch <- e
    }
}
```

```
BenchmarkMapDispatch-8   10000000   200 ns/op
```

<details><summary>After — Cache the result for hot topics</summary>

```go
type Bus struct {
    topics atomic.Pointer[map[string][]chan Event]
    hot    atomic.Pointer[[]chan Event]  // cache for the hottest topic
    hotKey string
}

func (b *Bus) Publish(topic string, e Event) {
    if topic == b.hotKey {
        for _, ch := range *b.hot.Load() {
            ch <- e
        }
        return
    }
    m := b.topics.Load()
    if subs, ok := (*m)[topic]; ok {
        for _, ch := range subs {
            ch <- e
        }
    }
}
```

```
BenchmarkHotCached-8   30000000   45 ns/op  (hot path)
```

4× faster for the hot topic. Cold topics still pay the map lookup.

**Trade-off:** Only one hot key cached. Complex API.

**When NOT:** Cold paths are common. Generally not worth the complexity.
</details>

---

## 8. Exercise 7 — Slow observer dragging others

**Before:** Synchronous notification with one slow observer slows all of them.

<details><summary>After — Drop policy with metrics</summary>

```go
func (s *Subject) Notify(e Event) {
    for _, ch := range s.subscribers {
        select {
        case ch <- e:
            // delivered
        default:
            atomic.AddInt64(&s.drops, 1)  // metric
        }
    }
}
```

Fast observers always get the event; slow ones drop. The drops counter exposes the problem.

**Trade-off:** Lossy. Need to monitor drops to detect a misbehaving observer.

**When NOT:** Audit logs, financial events — when loss is unacceptable.
</details>

---

## 9. Exercise 8 — Notification with reflect (typed events)

**Before:**

```go
func (b *Bus) Publish(ev any) {
    t := reflect.TypeOf(ev)
    for _, ch := range b.subs[t] {
        ch <- ev
    }
}
```

```
BenchmarkReflectDispatch-8   2000000   900 ns/op   24 B/op   1 allocs/op
```

<details><summary>After — Typed Subjects per event type</summary>

```go
type Subject[T any] struct {
    /* ... */
}

func (s *Subject[T]) Publish(ev T) {
    for _, ch := range s.subscribers {
        ch <- ev
    }
}

// Use one Subject per event type:
events := &Subject[EventA]{}
metrics := &Subject[EventB]{}
```

```
BenchmarkTypedDispatch-8   30000000   45 ns/op   0 B/op   0 allocs/op
```

20× faster. No reflection. Compile-time type safety.

**Trade-off:** Each event type needs its own Subject. For 50 event types, 50 instances.

**When NOT:** Highly dynamic event types known only at runtime.
</details>

---

## 10. Exercise 9 — Unbounded subscriber growth

**Scenario:** Memory grows as subscribers accumulate but are never removed.

<details><summary>After — Cap + LRU eviction</summary>

```go
type Subject struct {
    mu     sync.Mutex
    subs   *list.List           // doubly linked
    maxLen int
}

func (s *Subject) Subscribe() *list.Element {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.subs.Len() >= s.maxLen {
        oldest := s.subs.Front()
        s.subs.Remove(oldest)
        close(oldest.Value.(chan Event))
    }
    ch := make(chan Event, 10)
    return s.subs.PushBack(ch)
}
```

Caps memory. Oldest subscribers are evicted when the cap is reached.

**Trade-off:** Eviction is silent. Old subscribers find their channel closed unexpectedly.

**When NOT:** When subscriptions are essential (transactional). Use explicit unsubscribe instead.
</details>

---

## 11. Exercise 10 — RWMutex contention

**Before:** All observers share one RWMutex. Under high read concurrency, the atomic increment on `readerCount` shows in profiles.

<details><summary>After — Sharded subscriber map</summary>

```go
type Subject struct {
    shards [16]shard
}

type shard struct {
    mu   sync.RWMutex
    subs []Observer
}

func (s *Subject) shardFor(key string) *shard {
    return &s.shards[fnv32(key)%16]
}
```

Subscriptions are partitioned by topic/key. Each shard has its own mutex. 16-way reduction in contention.

**Trade-off:** Notify-all is more expensive (iterate all shards). Use only when subscriptions are naturally sharded by key.

**When NOT:** Small subscriber count or notify-all workloads.
</details>

---

## 12. Exercise 11 — Closure allocation per Subscribe

**Before:**

```go
func (s *Subject) Subscribe(handler func(Event)) {
    s.handlers = append(s.handlers, handler)
}

// Caller:
s.Subscribe(func(e Event) { /* closure escapes to heap */ })
```

Each Subscribe call allocates the closure (~32 bytes).

<details><summary>After — Pool closures or accept a struct</summary>

For pooling closures, accept a struct that implements an interface:

```go
type Handler interface { Handle(Event) }

func (s *Subject) Subscribe(h Handler) {
    s.handlers = append(s.handlers, h)
}

// Caller:
var h myHandler  // stack-allocated, can be reused
s.Subscribe(&h)
```

If the handler is statically known, the allocation goes away.

**Trade-off:** Less ergonomic than passing a closure.

**When NOT:** Subscribe is rare (boot time). One allocation per Subscribe is invisible.
</details>

---

## 13. Exercise 12 — Backpressure choice

Three strategies:

- **Block:** `ch <- e` — preserves order, slowest. Producer waits for slowest consumer.
- **Drop:** `select { case ch <- e: default: }` — fast, lossy.
- **Buffer:** large channel buffer + drop on full. Compromise.

Pick by:
- Loss tolerance: financial → block; metrics → drop.
- Order: ordered streams → block or batch; out-of-order OK → drop.
- Latency: real-time → drop or block; analytical → buffer.

There's no general winner. Benchmark with your real workload.

---

## 14. When NOT to optimize

Most Observer code doesn't need optimization. The pattern is fast by default. Check:

1. Does pprof show Observer code in the top 10? If not, skip.
2. Is the QPS high enough to matter? 1k Notify/sec at 1µs = 1ms/sec of CPU. Irrelevant.
3. Are observers themselves the bottleneck? Often the answer is "yes — the slow observer is the problem, not the dispatch".

Common premature optimizations:
- Switching to `atomic.Pointer` for a 10-observer system (RWMutex is fine).
- Sharding for non-sharded workloads (notify-all dominates).
- Worker pool for 100 events/sec (synchronous is faster).

---

## 15. Summary

**Wins that always ship:**
- Snapshot the observer list before notification (release lock before iteration).
- Use `select-default` for slow-observer drop policy.
- Use buffered channels (1+) for subscription.

**Wins behind a profile:**
- `atomic.Pointer` for read-heavy lists.
- Worker pool for high-rate asynchronous notification.
- Typed Subjects to avoid reflection.

**Rarely worth it:**
- Sharded subscriber maps (only at 1k+ subscribers).
- Closure pooling (only at very high Subscribe rates).
- Hot-key caching (only when one key dominates).

Profile first. Optimize what shows up. Don't optimize what doesn't.

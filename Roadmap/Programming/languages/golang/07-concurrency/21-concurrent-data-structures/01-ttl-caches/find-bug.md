---
layout: default
title: Find Bug
parent: TTL Caches
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/01-ttl-caches/find-bug/
---

# TTL Caches — Find the Bug

> Twelve broken snippets. Every one of them compiles. Every one of them looks plausible. Every one of them is wrong in a way that has destroyed at least one production service. Read the code, predict the failure mode, write down a fix, then read the explanation.

A few ground rules:

- All snippets are Go 1.22+.
- "Production-shape" means: many goroutines, real concurrency, real wall-clock pressure.
- Some bugs are races detected only with `go test -race`; some are races even the race detector cannot catch (true logical races between cache state and origin state); some are leaks; some are correctness bugs you only see at 3 AM.

---

## Snippet 1 — The lost-update lazy delete

```go
type Cache struct {
    mu   sync.RWMutex
    data map[string]entry
}

type entry struct {
    value     []byte
    expiresAt time.Time
}

func (c *Cache) Get(key string) ([]byte, bool) {
    c.mu.RLock()
    e, ok := c.data[key]
    c.mu.RUnlock()
    if !ok {
        return nil, false
    }
    if time.Now().After(e.expiresAt) {
        c.mu.Lock()
        delete(c.data, key)
        c.mu.Unlock()
        return nil, false
    }
    return e.value, true
}

func (c *Cache) Set(key string, v []byte, ttl time.Duration) {
    c.mu.Lock()
    c.data[key] = entry{value: v, expiresAt: time.Now().Add(ttl)}
    c.mu.Unlock()
}
```

**The setup.** Goroutine A calls `Get("user:42")`. The entry is expired. A grabs a copy under the RLock, releases the lock, decides to delete. Meanwhile goroutine B calls `Set("user:42", fresh, 5*time.Minute)` and writes a brand-new entry. Now A takes the write lock and `delete`s.

**Question.** What does the cache look like after both goroutines finish? What does the next reader see?

**The bug.** A deletes B's fresh write. The next reader sees a miss and triggers a fresh load — wasted origin call, wasted singleflight slot, *and* the cache may now be permanently empty for that key if the next loader fails. The pattern is called "*resurrected-key delete*" or the "*ABA lazy-delete race*".

**Fix.** Check pointer identity (or generation counter) under the write lock before deleting:

```go
if time.Now().After(e.expiresAt) {
    c.mu.Lock()
    if cur, ok := c.data[key]; ok && cur.expiresAt.Equal(e.expiresAt) {
        delete(c.data, key)
    }
    c.mu.Unlock()
    return nil, false
}
```

Better: store entries as `*entry` (pointers) and compare pointers — equality is fast and unambiguous. Or use a `gen uint64` counter incremented on every `Set`.

---

## Snippet 2 — The sweep goroutine that never dies

```go
type Cache struct {
    mu   sync.Mutex
    data map[string]entry
}

func New(sweep time.Duration) *Cache {
    c := &Cache{data: make(map[string]entry)}
    go func() {
        t := time.NewTicker(sweep)
        for range t.C {
            c.mu.Lock()
            now := time.Now()
            for k, e := range c.data {
                if now.After(e.expiresAt) {
                    delete(c.data, k)
                }
            }
            c.mu.Unlock()
        }
    }()
    return c
}
```

**The bug.** There is no `Close`. The goroutine runs forever — when the cache leaves scope, it is *not* garbage-collected because the sweep goroutine holds a reference via `c.mu`. This is the canonical "goroutine roots the object" leak. Tests that create and discard caches will steadily climb in `runtime.NumGoroutine` until they OOM the test process.

Second bug: `t.Stop()` is never called, so the timer is itself a leak even after the cache becomes unreachable.

**Fix.**

```go
type Cache struct {
    mu   sync.Mutex
    data map[string]entry
    quit chan struct{}
    done chan struct{}
    once sync.Once
}

func New(sweep time.Duration) *Cache {
    c := &Cache{
        data: make(map[string]entry),
        quit: make(chan struct{}),
        done: make(chan struct{}),
    }
    go c.sweepLoop(sweep)
    return c
}

func (c *Cache) sweepLoop(d time.Duration) {
    t := time.NewTicker(d)
    defer t.Stop()
    defer close(c.done)
    for {
        select {
        case <-c.quit:
            return
        case <-t.C:
            c.sweep()
        }
    }
}

func (c *Cache) Close() {
    c.once.Do(func() {
        close(c.quit)
        <-c.done
    })
}
```

**Verify.** Add `defer goleak.VerifyNone(t)` in tests. Tests that previously "passed" will now fail until `Close` is called.

---

## Snippet 3 — The lock held across an expensive load

```go
func (c *Cache) GetOrLoad(
    ctx context.Context,
    key string,
    ttl time.Duration,
    load func(ctx context.Context) ([]byte, error),
) ([]byte, error) {
    c.mu.Lock()
    defer c.mu.Unlock()

    if e, ok := c.data[key]; ok && time.Now().Before(e.expiresAt) {
        return e.value, nil
    }

    v, err := load(ctx)
    if err != nil {
        return nil, err
    }
    c.data[key] = entry{value: v, expiresAt: time.Now().Add(ttl)}
    return v, nil
}
```

**The bug.** `c.mu` is held across `load(ctx)`. If `load` is a 500 ms HTTP call, *every other goroutine on the cache* — readers, writers, sweepers — blocks for 500 ms. With 1000 concurrent requests hitting different keys, throughput collapses to two requests per second. This is the *number one* TTL-cache anti-pattern in code review.

It also is *not* a thundering-herd fix: if 1000 goroutines call `GetOrLoad` for the same cold key, 999 of them block on the mutex, then call `load` one by one — sequential origin hits instead of one.

**Fix.** Release the lock before `load`. Use `singleflight` for the herd:

```go
func (c *Cache) GetOrLoad(
    ctx context.Context,
    key string,
    ttl time.Duration,
    load func(ctx context.Context) ([]byte, error),
) ([]byte, error) {
    if v, ok := c.Get(key); ok {
        return v, nil
    }
    v, err, _ := c.sf.Do(key, func() (any, error) {
        if v, ok := c.Get(key); ok {
            return v, nil
        }
        result, err := load(ctx)
        if err != nil {
            return nil, err
        }
        c.Set(key, result, ttl)
        return result, nil
    })
    if err != nil {
        return nil, err
    }
    return v.([]byte), nil
}
```

The general principle: *no operation that calls user code is allowed to hold a cache lock.* `load` is user code.

---

## Snippet 4 — Reading the same `time.Now()` twice

```go
func (c *Cache) Set(key string, v []byte, ttl time.Duration) {
    c.mu.Lock()
    c.data[key] = entry{value: v, expiresAt: time.Now().Add(ttl)}
    c.mu.Unlock()
}

func (c *Cache) Get(key string) ([]byte, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    e, ok := c.data[key]
    if !ok {
        return nil, false
    }
    if time.Now().After(e.expiresAt) {
        return nil, false
    }
    return e.value, true
}
```

**Spot the subtle one.** This looks fine. It even passes `go test -race`. Where is the bug?

**The bug.** `time.Now()` is *not* monotonic on all platforms in all cases. On macOS pre-1.17 and on a VM that had its clock stepped backwards by NTP, `Set` may write `expiresAt = wall_now + 5s` while a subsequent `Get` computes a *wall_now* that is suddenly earlier than the original write — entries that should have expired do not, or entries that are still alive look expired.

Worse: Go's `time.Time` already contains a monotonic component starting in 1.9, but operations like `time.Time.Round` or storing in JSON / proto and reloading *strip* the monotonic part. If your cache deserialises `expiresAt` from disk on restart, every comparison from then on is wall-time only.

**Fix.** Use durations relative to a *single* monotonic origin:

```go
type Cache struct {
    /* ... */
    started time.Time // captured at New(), retains monotonic
}

func (c *Cache) Set(key string, v []byte, ttl time.Duration) {
    c.mu.Lock()
    c.data[key] = entry{value: v, expiresAt: time.Since(c.started) + ttl}
    c.mu.Unlock()
}

// or use a Clock interface that wraps time.Since under the hood
```

For a single-process cache that never serialises, `time.Now().Add(ttl)` followed by `time.Now().After(expiresAt)` *does* preserve monotonicity correctly. The bug bites the moment you persist or round.

---

## Snippet 5 — The thundering herd nobody mentions

```go
func (c *Cache) GetOrLoad(
    ctx context.Context,
    key string,
    ttl time.Duration,
    load func(ctx context.Context) ([]byte, error),
) ([]byte, error) {
    if v, ok := c.Get(key); ok {
        return v, nil
    }
    // not locked here, no singleflight
    v, err := load(ctx)
    if err != nil {
        return nil, err
    }
    c.Set(key, v, ttl)
    return v, nil
}
```

**The bug.** No `singleflight`. On a cold cache for a hot key, 10 000 concurrent requests all observe a miss and all call `load`. The origin database serves 10 000 simultaneous queries for the same row, every CPU core spins on the same lock, the database falls over, the cache populates with the result, and 10 ms later everything is fine but the SRE is paged.

This is the **thundering herd** or **dogpile** problem. It is one of the top three reasons distributed services collapse.

**Fix.** Use `golang.org/x/sync/singleflight`:

```go
v, err, _ := c.sf.Do(key, func() (any, error) {
    if v, ok := c.Get(key); ok {
        return v, nil
    }
    result, err := load(ctx)
    if err != nil {
        return nil, err
    }
    c.Set(key, result, ttl)
    return result, nil
})
```

Now exactly one goroutine performs the load; the other 9 999 wait on a channel and receive the same result.

**Subtle related bug.** If you `singleflight.DoChan` and the original caller's context is cancelled, the in-flight load *continues* until completion — the other 9 999 callers may still need it. Failing to handle that distinction creates request amplification under cancellation storms.

---

## Snippet 6 — The synchronised-expiry stampede

```go
func warmup(c *Cache, keys []string) {
    for _, k := range keys {
        v, _ := loadFromDB(k)
        c.Set(k, v, 5*time.Minute)
    }
}
```

**The setup.** `warmup` is called on startup. 100 000 keys are loaded back to back. Each one gets TTL = 5 minutes from "right now". Five minutes later, all 100 000 keys expire within the same ~100 ms window. The next reader for *any* of those keys triggers a load. 100 000 simultaneous loads slam the database. Repeat every 5 minutes forever.

**Bug.** Even with `singleflight`, the herd is per-*key*: 100 000 distinct keys = 100 000 distinct singleflights = 100 000 simultaneous origin queries. The cache's TTL mechanism is being used as a *synchronised refresh trigger* — exactly what it should not be.

**Fix.** Add jitter to the TTL:

```go
func jittered(base time.Duration, jitter float64) time.Duration {
    delta := float64(base) * jitter
    return base + time.Duration(rand.Int64N(int64(delta)))
}

c.Set(k, v, jittered(5*time.Minute, 0.2)) // 5m .. 6m
```

With 20% jitter, the expiry window stretches from 100 ms to 60 seconds. The DB still gets hit, but at ~1500 QPS instead of ~10⁶ QPS. Combined with `singleflight`, the effective load is 1500 unique queries per second instead of one million.

**Second-order fix.** Refresh proactively when an entry crosses, say, 80% of its TTL — a *background refresh* pattern that keeps the cache permanently warm. This is what `ristretto`'s `Set` with refresh does, and what `groupcache` lacks.

---

## Snippet 7 — The sweep that holds the lock for 30 ms

```go
func (c *Cache) sweep() {
    c.mu.Lock()
    defer c.mu.Unlock()
    now := time.Now()
    for k, e := range c.data {
        if now.After(e.expiresAt) {
            delete(c.data, k)
        }
    }
}
```

**The bug.** With one million entries, this loop runs for 20-50 ms with the *write* lock held. Every `Get` and `Set` blocks for that entire window. p99 latency spikes; load shedding kicks in upstream.

**Fix.** Bound the scan. Two strategies:

```go
// Strategy A: scan budget
func (c *Cache) sweep(budget int) {
    c.mu.Lock()
    defer c.mu.Unlock()
    now := time.Now()
    n := 0
    for k, e := range c.data {
        if now.After(e.expiresAt) {
            delete(c.data, k)
        }
        n++
        if n >= budget {
            return
        }
    }
}
```

```go
// Strategy B: min-heap of (expiresAt, key)
//   pop heap until top is in the future; each pop is O(log n) and most pops do no work
```

Strategy B is the production design. The sweeper now does only the work it must — no wasted scan of live entries.

**Bonus bug in strategy A.** Go map iteration is randomised. A scan-and-delete pattern with a budget gives no fairness guarantee — some keys may be scanned every sweep, others never. If your TTLs are very short and the cache is large, some entries leak permanently.

---

## Snippet 8 — The map that grows without bound under a busy sweeper

```go
type Cache struct {
    mu      sync.Mutex
    data    map[string]entry
    expires chan string // sweeper sends keys here to delete
}

func (c *Cache) Set(key string, v []byte, ttl time.Duration) {
    c.mu.Lock()
    c.data[key] = entry{value: v, expiresAt: time.Now().Add(ttl)}
    c.mu.Unlock()
    go func() {
        time.AfterFunc(ttl, func() {
            c.expires <- key
        })
    }()
}

func (c *Cache) sweeper() {
    for key := range c.expires {
        c.mu.Lock()
        delete(c.data, key)
        c.mu.Unlock()
    }
}
```

**The bug — choose three.**

1. *One timer per Set.* At 10 000 sets per second, you have 10 000 outstanding `time.AfterFunc` goroutines plus 10 000 entries in the runtime timer heap. Memory and scheduler pressure grow linearly with the cache size.
2. *No re-check.* If `Set("k", ...)` is called again before the original TTL fires, the original timer still fires and deletes the fresh entry. The same lost-update bug as Snippet 1, dressed differently.
3. *`expires` channel is unbounded if shared, or blocks producers if buffered too small.* Under burst, timer goroutines accumulate waiting to send.
4. Bonus: the wrapping `go func()` is unnecessary — `time.AfterFunc` runs its callback on its own goroutine already. The extra goroutine is pure leak.

**Fix.** Use a min-heap or a sorted structure of expirations. One ticker. No per-key timers.

---

## Snippet 9 — `sync.Map` misuse

```go
type Cache struct {
    data sync.Map
}

func (c *Cache) Set(key string, v []byte, ttl time.Duration) {
    c.data.Store(key, &entry{value: v, expiresAt: time.Now().Add(ttl)})
}

func (c *Cache) Get(key string) ([]byte, bool) {
    raw, ok := c.data.Load(key)
    if !ok {
        return nil, false
    }
    e := raw.(*entry)
    if time.Now().After(e.expiresAt) {
        c.data.Delete(key)
        return nil, false
    }
    return e.value, true
}
```

**The bug.** The lazy delete in `Get` races with a concurrent `Set` — same flavour as Snippet 1, but now in `sync.Map` clothing. `sync.Map.Delete(key)` does not check the *value*; if another goroutine has just `Store`d a fresh entry, your `Delete` wipes it.

**Fix.** Use `sync.Map.CompareAndDelete` (Go 1.20+):

```go
if time.Now().After(e.expiresAt) {
    c.data.CompareAndDelete(key, raw)
    return nil, false
}
```

`CompareAndDelete` removes the key only if the value pointer matches. The fresh `Store` is safe.

**Second bug.** `sync.Map` is optimised for two specific patterns: (1) keys are read many times and written rarely, or (2) multiple goroutines read, write, and overwrite entries for *disjoint* sets of keys. A TTL cache with active sweep is neither pattern: the sweeper rewrites the whole map periodically, defeating `sync.Map`'s internal `read`/`dirty` distinction. A plain `RWMutex + map` (or a sharded version) is faster in practice.

---

## Snippet 10 — The "I'll add a TTL later" map

```go
var cache = make(map[string]string)
var cacheMu sync.RWMutex

func Lookup(k string) (string, bool) {
    cacheMu.RLock()
    v, ok := cache[k]
    cacheMu.RUnlock()
    return v, ok
}

func Store(k, v string) {
    cacheMu.Lock()
    cache[k] = v
    cacheMu.Unlock()
}
```

**The bug.** No expiry. The map grows monotonically. The service runs for two weeks, OOMs at 3 AM Saturday, and somebody learns that "no TTL" is the default failure mode of every map-as-cache.

This is the most boring bug in this file. It is also the most common bug in this file. Production codebases are littered with maps that started life as "a temporary cache, I'll add a TTL later".

**Fix.** Be principled. Every cache must answer two questions before merge:

1. What is the TTL?
2. What is the size cap?

If you cannot answer both, you are not building a cache; you are building a memory leak with a friendly name.

---

## Snippet 11 — The sweep that takes its own lock recursively

```go
type Cache struct {
    mu sync.RWMutex
    /* ... */
}

func (c *Cache) sweep() {
    c.mu.Lock()
    defer c.mu.Unlock()
    now := time.Now()
    for k, e := range c.data {
        if now.After(e.expiresAt) {
            c.Delete(k) // calls c.mu.Lock() again!
        }
    }
}

func (c *Cache) Delete(k string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    delete(c.data, k)
}
```

**The bug.** `sync.RWMutex` is **not** reentrant. The second `Lock` call inside `Delete` deadlocks. Goroutine waits on itself forever; the cache stops processing; everything else upstream times out.

This is `sync.Mutex` 101, but a fresh reader of the codebase always finds it.

**Fix.** Two patterns:

```go
// Pattern A: split the locked and unlocked variants
func (c *Cache) Delete(k string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.deleteLocked(k)
}

func (c *Cache) deleteLocked(k string) { delete(c.data, k) }

func (c *Cache) sweep() {
    c.mu.Lock()
    defer c.mu.Unlock()
    for k, e := range c.data {
        if time.Now().After(e.expiresAt) {
            c.deleteLocked(k)
        }
    }
}
```

The naming convention `xxxLocked` is a Go idiom: "this function requires the mutex is already held by the caller". Use it; document it; never call it without the lock.

```go
// Pattern B: collect-then-delete
func (c *Cache) sweep() {
    c.mu.RLock()
    var dead []string
    now := time.Now()
    for k, e := range c.data {
        if now.After(e.expiresAt) {
            dead = append(dead, k)
        }
    }
    c.mu.RUnlock()

    if len(dead) == 0 { return }
    c.mu.Lock()
    for _, k := range dead {
        if e, ok := c.data[k]; ok && now.After(e.expiresAt) {
            delete(c.data, k)
        }
    }
    c.mu.Unlock()
}
```

Pattern B trades CPU for lower-contention reads — sweepers do not block readers during the scan phase. Use it when reads dominate.

---

## Snippet 12 — `time.After` leak inside a hot loop

```go
func (c *Cache) sweepLoop(interval time.Duration) {
    for {
        select {
        case <-c.quit:
            return
        case <-time.After(interval):
            c.sweep()
        }
    }
}
```

**The bug.** Every loop iteration creates a *new* `time.Timer` via `time.After`. The timer is not garbage-collected until its channel fires. If `c.quit` is signalled, every still-pending `time.After` timer hangs around until its original duration elapses, holding closure references and consuming a slot in the runtime timer heap.

Worse, in a tight loop (interval = 1 ms), `time.After` allocates a fresh channel every iteration — measurable allocation pressure.

**Fix.** Use a single `time.Ticker`:

```go
func (c *Cache) sweepLoop(interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-c.quit:
            return
        case <-t.C:
            c.sweep()
        }
    }
}
```

The ticker is reused, `Stop` releases its resources, and zero allocations occur in the loop.

**Related.** `context.WithTimeout` followed by `defer cancel()` is the correct pattern for one-shot cancellable timers. `time.After` outside a select with a `default` case, or inside a tight loop, is almost always wrong.

---

## Bonus snippet — read-modify-write on the value

```go
// counter cache: increment a per-user counter and re-cache
func (c *Cache) Bump(user string) int64 {
    if raw, ok := c.Get(user); ok {
        n := int64(binary.BigEndian.Uint64(raw)) + 1
        buf := make([]byte, 8)
        binary.BigEndian.PutUint64(buf, uint64(n))
        c.Set(user, buf, time.Minute)
        return n
    }
    buf := make([]byte, 8)
    binary.BigEndian.PutUint64(buf, 1)
    c.Set(user, buf, time.Minute)
    return 1
}
```

**The bug.** `Get` and `Set` are atomic individually; the read-modify-write is not. Two concurrent `Bump("alice")` calls both read `5`, both increment to `6`, both write `6`. The counter increments by one instead of two. Lost update.

**Fix.** Either:

1. **Sharded lock per key.** A cache with N shards already gives you a per-shard lock. Expose a `Cache.Update(key string, fn func(old []byte) []byte)` method that takes the shard lock for the read-modify-write.
2. **Atomic redis counter** if the source of truth is Redis; cache the *value* there, not in the in-process map. `INCR` and `EXPIRE` are atomic on the Redis side.
3. **Compare-and-swap loop** if you must do it in-process:

```go
for {
    raw, _ := c.Get(user)
    var n int64
    if len(raw) == 8 {
        n = int64(binary.BigEndian.Uint64(raw)) + 1
    } else {
        n = 1
    }
    buf := make([]byte, 8)
    binary.BigEndian.PutUint64(buf, uint64(n))
    if c.CompareAndSet(user, raw, buf, time.Minute) {
        return n
    }
}
```

This requires a `CompareAndSet` on the cache. `sync.Map.CompareAndSwap` (Go 1.20+) supports the pattern if entries are stored as `*entry` pointers.

The general lesson: *a TTL cache is a key-value store, not a transactional system.* If you need transactions, push the operation to the source of truth.

---

## Postmortem checklist

When a cache misbehaves in production, walk this checklist:

- [ ] Does the cache have a `Close`? Are goroutines and timers stopped?
- [ ] Is `load` (or any user-supplied callback) called while a cache lock is held?
- [ ] Is the lazy-delete protected against the ABA / lost-update race (Snippets 1, 9)?
- [ ] Is there a `singleflight` between cache miss and origin call?
- [ ] Are TTLs jittered? Are they bounded?
- [ ] Does the sweeper have a budget? Does it hold the write lock longer than 1 ms?
- [ ] Is there a size cap? An eviction policy? Metrics for evictions vs expirations?
- [ ] Are read-modify-write operations atomic, or are you assuming they are?
- [ ] Does the cache survive a wall-clock jump backwards (NTP step, container migration)?
- [ ] Are hit / miss / eviction / sweep-lag metrics scraped?
- [ ] Have you run `go test -race`, `goleak.VerifyNone`, and a load test at 10x expected QPS?

Half of these issues are not "concurrency" bugs in the textbook sense. They are *systems* bugs that only show up when goroutines, wall clocks, and origin services collide. The race detector finds the lexical races; the rest require careful reading.

Read the next file, [optimize.md](optimize.md), for the performance counterpart — same primitives, viewed through a profiler.

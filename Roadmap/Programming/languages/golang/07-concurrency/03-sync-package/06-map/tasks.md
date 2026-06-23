# sync.Map — Hands-On Tasks

> Each task starts with a problem statement, lists the skills it exercises, and ends with a reference solution. Work through them in order; later tasks assume earlier ones.

---

## Task 1 — Reproduce the concurrent map crash

**Goal**: see `fatal error: concurrent map writes` with your own eyes.

**Skills**: built-in map limitations, goroutine spawning.

**Problem**: Write a program that starts 100 goroutines, each writing to the same `map[int]int`. Run it. Confirm the crash. Note the line number in the stack trace.

**Acceptance**: the program aborts with `fatal error: concurrent map writes`. Save the output to a file for reference.

### Reference solution

```go
package main

import "sync"

func main() {
    m := map[int]int{}
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            m[i] = i
        }(i)
    }
    wg.Wait()
}
```

The crash usually happens within a few iterations. If it does not crash, increase the goroutine count or add `runtime.GOMAXPROCS(8)`.

---

## Task 2 — Fix the crash with `sync.Map`

**Goal**: replace the unsafe map with `sync.Map` and observe no crash.

**Skills**: `Store`, `Load`, `Range`.

**Problem**: Take Task 1's program. Replace the `map[int]int` with `sync.Map`. After all goroutines finish, count and print the number of entries.

**Acceptance**: program prints `100`. No crash.

### Reference solution

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var m sync.Map
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            m.Store(i, i)
        }(i)
    }
    wg.Wait()

    count := 0
    m.Range(func(_, _ any) bool {
        count++
        return true
    })
    fmt.Println("count:", count)
}
```

---

## Task 3 — A concurrent route cache

**Goal**: build a small read-mostly cache, the sweet spot for `sync.Map`.

**Skills**: `Load`, `Store`, type assertion, encapsulation.

**Problem**: Build a `RouteCache` struct that maps URL paths (string) to handler descriptors (any struct of your choice). Provide `Get(path) (*Handler, bool)` and `Set(path, *Handler)`. Internally use `sync.Map`. Add a unit test that runs 1 000 goroutines reading and 10 goroutines writing concurrently; verify no crash and that reads observe writes eventually.

**Acceptance**: tests pass with `go test -race`.

### Reference solution

```go
package routecache

import "sync"

type Handler struct {
    Name string
}

type RouteCache struct {
    m sync.Map // map[string]*Handler
}

func (r *RouteCache) Get(path string) (*Handler, bool) {
    v, ok := r.m.Load(path)
    if !ok {
        return nil, false
    }
    return v.(*Handler), true
}

func (r *RouteCache) Set(path string, h *Handler) {
    r.m.Store(path, h)
}
```

```go
package routecache_test

import (
    "fmt"
    "sync"
    "testing"

    "yourmod/routecache"
)

func TestConcurrentReadWrite(t *testing.T) {
    rc := &routecache.RouteCache{}
    rc.Set("/", &routecache.Handler{Name: "root"})

    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            if _, ok := rc.Get("/"); !ok {
                t.Errorf("root not found")
            }
        }()
    }
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            path := fmt.Sprintf("/p%d", i)
            rc.Set(path, &routecache.Handler{Name: path})
        }(i)
    }
    wg.Wait()
}
```

Run with `go test -race ./...`.

---

## Task 4 — Race-free compute-once cache

**Goal**: use `LoadOrStore` correctly.

**Skills**: `LoadOrStore`, the actual/loaded pattern.

**Problem**: Build a `getOrCompute(key string) string` function backed by a `sync.Map`. The compute step should be slow (`time.Sleep(100ms)`) and increment a global counter on each call. Spawn 100 goroutines that all call `getOrCompute("hello")` simultaneously. Verify that `compute` was called *at most* once... or document why it might have been called more.

**Acceptance**: write a test that asserts the counter is small (less than 10) on a typical run, with a comment explaining the actual semantics.

### Reference solution

```go
package once

import (
    "sync"
    "sync/atomic"
    "time"
)

var (
    cache    sync.Map
    compCount int64
)

func compute(key string) string {
    atomic.AddInt64(&compCount, 1)
    time.Sleep(100 * time.Millisecond)
    return "computed-" + key
}

func getOrCompute(key string) string {
    if v, ok := cache.Load(key); ok {
        return v.(string)
    }
    actual, _ := cache.LoadOrStore(key, compute(key))
    return actual.(string)
}

func Count() int64 { return atomic.LoadInt64(&compCount) }
```

The catch: `compute(key)` is evaluated *before* `LoadOrStore` is called. If many goroutines race on a missing key, *all of them* call `compute`. `LoadOrStore` only deduplicates the *store*, not the computation. To dedupe computation, use `singleflight` (Task 8).

---

## Task 5 — Atomic counter with `CompareAndSwap`

**Goal**: implement increment-if-current correctly.

**Skills**: `CompareAndSwap`, retry loop.

**Problem**: Use `sync.Map` to store per-key counters. Implement `Inc(key string)` that increments the counter for a key atomically. Spawn 1 000 goroutines that all call `Inc("hits")`. Verify the final value is exactly 1 000.

**Acceptance**: test passes deterministically.

### Reference solution

```go
package counter

import "sync"

type Counters struct {
    m sync.Map // map[string]int
}

func (c *Counters) Inc(key string) {
    for {
        v, _ := c.m.LoadOrStore(key, 0)
        if c.m.CompareAndSwap(key, v, v.(int)+1) {
            return
        }
    }
}

func (c *Counters) Get(key string) int {
    v, ok := c.m.Load(key)
    if !ok {
        return 0
    }
    return v.(int)
}
```

```go
func TestInc(t *testing.T) {
    var c Counters
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); c.Inc("hits") }()
    }
    wg.Wait()
    if got := c.Get("hits"); got != 1000 {
        t.Fatalf("got %d, want 1000", got)
    }
}
```

Note: `atomic.Int64` outside the map is faster for hot single-key counters. This task is about practising `CompareAndSwap`, not about choosing the fastest data structure.

---

## Task 6 — Work hand-off with `LoadAndDelete`

**Goal**: producer/consumer where each job is taken by exactly one consumer.

**Skills**: `LoadAndDelete`, atomic claim.

**Problem**: Build a `JobQueue` that exposes `Submit(id string, payload []byte)` and `Take(id string) ([]byte, bool)`. Submit 100 jobs. Spawn 200 consumer goroutines each trying to take a random one of the 100 jobs. Verify that each job is taken exactly once and no consumer panics.

**Acceptance**: total successful takes equals 100; no duplicate takes.

### Reference solution

```go
package jobs

import "sync"

type JobQueue struct {
    m sync.Map // map[string][]byte
}

func (q *JobQueue) Submit(id string, payload []byte) {
    q.m.Store(id, payload)
}

func (q *JobQueue) Take(id string) ([]byte, bool) {
    v, ok := q.m.LoadAndDelete(id)
    if !ok {
        return nil, false
    }
    return v.([]byte), true
}
```

The atomicity of `LoadAndDelete` guarantees only one consumer succeeds.

---

## Task 7 — Generic wrapper

**Goal**: build a typed `Map[K, V]` around `sync.Map`.

**Skills**: generics, type assertion encapsulation.

**Problem**: Build `Map[K comparable, V any]` exposing `Load`, `Store`, `Delete`, `Range`, `LoadOrStore`. Use it to store `*User` keyed by `int64`. Write a test that uses no type assertions in the test code.

**Acceptance**: test code is `any`-free.

### Reference solution

```go
package syncmap

import "sync"

type Map[K comparable, V any] struct {
    inner sync.Map
}

func (m *Map[K, V]) Load(k K) (V, bool) {
    v, ok := m.inner.Load(k)
    if !ok {
        var zero V
        return zero, false
    }
    return v.(V), true
}

func (m *Map[K, V]) Store(k K, v V) {
    m.inner.Store(k, v)
}

func (m *Map[K, V]) LoadOrStore(k K, v V) (V, bool) {
    actual, loaded := m.inner.LoadOrStore(k, v)
    return actual.(V), loaded
}

func (m *Map[K, V]) Delete(k K) {
    m.inner.Delete(k)
}

func (m *Map[K, V]) Range(f func(K, V) bool) {
    m.inner.Range(func(k, v any) bool {
        return f(k.(K), v.(V))
    })
}
```

---

## Task 8 — Combine `sync.Map` with `singleflight`

**Goal**: dedupe both stores *and* computations.

**Skills**: `singleflight.Group.Do`, cache invariant.

**Problem**: Replace Task 4's `getOrCompute` so that `compute` is called *at most once* per key, regardless of how many goroutines race. Use `golang.org/x/sync/singleflight`.

**Acceptance**: counter equals exactly 1 after 100 concurrent calls.

### Reference solution

```go
package once

import (
    "sync"
    "sync/atomic"
    "time"

    "golang.org/x/sync/singleflight"
)

var (
    cache     sync.Map
    g         singleflight.Group
    compCount int64
)

func compute(key string) string {
    atomic.AddInt64(&compCount, 1)
    time.Sleep(100 * time.Millisecond)
    return "computed-" + key
}

func getOrCompute(key string) string {
    if v, ok := cache.Load(key); ok {
        return v.(string)
    }
    v, _, _ := g.Do(key, func() (any, error) {
        result := compute(key)
        cache.Store(key, result)
        return result, nil
    })
    return v.(string)
}
```

Now `compute` is called exactly once even under heavy concurrency.

---

## Task 9 — Build a TTL cache

**Goal**: combine `Swap`, `CompareAndDelete`, and a sweep goroutine.

**Skills**: composing 1.20 atomic methods, time-based eviction.

**Problem**: Build a `TTLCache` with `Set(key, value, ttl)` and `Get(key) (value, ok)`. Expired entries should be invisible to `Get` and removed asynchronously by a sweep goroutine that runs every second. The sweep must not evict entries that have been refreshed in the meantime.

**Acceptance**: entries expire correctly under concurrent refresh.

### Reference solution

```go
package ttlcache

import (
    "sync"
    "time"
)

type entry struct {
    value   any
    expires time.Time
}

type TTLCache struct {
    m    sync.Map
    stop chan struct{}
}

func New() *TTLCache {
    c := &TTLCache{stop: make(chan struct{})}
    go c.sweepLoop()
    return c
}

func (c *TTLCache) Close() {
    close(c.stop)
}

func (c *TTLCache) Set(key, value any, ttl time.Duration) {
    c.m.Store(key, entry{value: value, expires: time.Now().Add(ttl)})
}

func (c *TTLCache) Get(key any) (any, bool) {
    v, ok := c.m.Load(key)
    if !ok {
        return nil, false
    }
    e := v.(entry)
    if time.Now().After(e.expires) {
        c.m.CompareAndDelete(key, e)
        return nil, false
    }
    return e.value, true
}

func (c *TTLCache) sweepLoop() {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-t.C:
            c.sweep()
        case <-c.stop:
            return
        }
    }
}

func (c *TTLCache) sweep() {
    now := time.Now()
    c.m.Range(func(k, v any) bool {
        e := v.(entry)
        if now.After(e.expires) {
            c.m.CompareAndDelete(k, e)
        }
        return true
    })
}
```

`CompareAndDelete` is critical: between the `Range` visit and the delete, another goroutine may refresh the entry. The CAS-style delete ensures we only remove the expected value.

---

## Task 10 — Sharded map benchmark

**Goal**: write the head-to-head benchmark from middle level.

**Skills**: `go test -bench`, RunParallel, comparison thinking.

**Problem**: Implement three concurrent map types:

1. `SyncMap` — wraps `sync.Map`.
2. `LockedMap` — `RWMutex + map[int]int`.
3. `ShardedMap` — 64 shards, each `RWMutex + map[int]int`, hashed with FNV.

Write benchmarks for read-heavy (95% read), balanced (50/50), and write-heavy (5% read) workloads at `-cpu=1,2,4,8`. Print the results in a table.

**Acceptance**: a clear ranking emerges; you can articulate why each map wins or loses in each scenario.

### Reference skeleton

```go
package mapbench

import (
    "hash/fnv"
    "strconv"
    "sync"
)

const N = 10000

type SyncMap struct{ m sync.Map }
func (s *SyncMap) Get(k int) (int, bool) { v, ok := s.m.Load(k); if !ok { return 0, false }; return v.(int), true }
func (s *SyncMap) Set(k, v int) { s.m.Store(k, v) }

type LockedMap struct {
    mu sync.RWMutex
    m  map[int]int
}
func NewLockedMap() *LockedMap { return &LockedMap{m: make(map[int]int)} }
func (l *LockedMap) Get(k int) (int, bool) { l.mu.RLock(); v, ok := l.m[k]; l.mu.RUnlock(); return v, ok }
func (l *LockedMap) Set(k, v int) { l.mu.Lock(); l.m[k] = v; l.mu.Unlock() }

const shardCount = 64
type ShardedMap struct {
    shards [shardCount]struct {
        sync.RWMutex
        m map[int]int
    }
}
func NewShardedMap() *ShardedMap {
    s := &ShardedMap{}
    for i := range s.shards {
        s.shards[i].m = make(map[int]int)
    }
    return s
}
func (s *ShardedMap) shardFor(k int) *struct { sync.RWMutex; m map[int]int } {
    h := fnv.New32a()
    h.Write([]byte(strconv.Itoa(k)))
    return &s.shards[h.Sum32()%shardCount]
}
func (s *ShardedMap) Get(k int) (int, bool) {
    sh := s.shardFor(k); sh.RLock(); v, ok := sh.m[k]; sh.RUnlock(); return v, ok
}
func (s *ShardedMap) Set(k, v int) {
    sh := s.shardFor(k); sh.Lock(); sh.m[k] = v; sh.Unlock()
}
```

Benchmarks follow the pattern from the middle level file. Run with:

```bash
go test -bench=. -benchmem -cpu=1,2,4,8 ./...
```

Note: production sharded maps should use `maphash` with a randomised seed instead of FNV to defend against engineered hot-key attacks.

---

## Task 11 — Replace `sync.Map` with `atomic.Pointer[map]`

**Goal**: measure the copy-on-write alternative.

**Skills**: `atomic.Pointer`, CAS loops, immutable data structures.

**Problem**: Build a `Config` map that stores feature flags. Reads happen on every request (millions per second). Updates happen rarely (once per minute, via an admin API). Implement two versions — one with `sync.Map`, one with `atomic.Pointer[map[string]bool]`. Benchmark reads. Report the difference.

**Acceptance**: `atomic.Pointer[map]` reads beat `sync.Map` reads by at least 2× on your hardware.

### Reference solution

```go
package config

import (
    "sync"
    "sync/atomic"
)

type SyncMapConfig struct{ m sync.Map }
func (c *SyncMapConfig) Get(k string) (bool, bool) {
    v, ok := c.m.Load(k); if !ok { return false, false }; return v.(bool), true
}
func (c *SyncMapConfig) Set(k string, v bool) { c.m.Store(k, v) }

type AtomicConfig struct {
    p atomic.Pointer[map[string]bool]
}
func NewAtomicConfig() *AtomicConfig {
    c := &AtomicConfig{}
    empty := map[string]bool{}
    c.p.Store(&empty)
    return c
}
func (c *AtomicConfig) Get(k string) (bool, bool) {
    v, ok := (*c.p.Load())[k]
    return v, ok
}
func (c *AtomicConfig) Set(k string, v bool) {
    for {
        old := c.p.Load()
        m := make(map[string]bool, len(*old)+1)
        for k2, v2 := range *old {
            m[k2] = v2
        }
        m[k] = v
        if c.p.CompareAndSwap(old, &m) {
            return
        }
    }
}
```

The `atomic.Pointer` read is two operations: atomic load + map lookup. `sync.Map` adds the entry pointer dereference and (in the cold case) a slow path. For pure-read benchmarks, `atomic.Pointer[map]` typically wins.

---

## Task 12 — Detect a leak

**Goal**: notice when `sync.Map` is holding onto memory it should not.

**Skills**: pprof, goroutine inspection.

**Problem**: Write a program that stores 1 million keys, then deletes 900 000 of them. Use `runtime.ReadMemStats` before and after the delete. Observe that memory does *not* immediately decrease. Now `Range` and count visible keys (should be 100 000). Force a dirty rebuild by storing one new key. Re-check memory. Document what you observed.

**Acceptance**: written explanation matches the professional-level discussion of `expunged` tombstones.

### Reference outline

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    var m sync.Map
    for i := 0; i < 1_000_000; i++ {
        m.Store(i, i)
    }
    runtime.GC()
    var before runtime.MemStats
    runtime.ReadMemStats(&before)

    for i := 0; i < 900_000; i++ {
        m.Delete(i)
    }
    runtime.GC()
    var afterDelete runtime.MemStats
    runtime.ReadMemStats(&afterDelete)

    // Force a dirty rebuild by storing a new key
    m.Store("trigger", 0)
    runtime.GC()
    var afterRebuild runtime.MemStats
    runtime.ReadMemStats(&afterRebuild)

    fmt.Printf("before:        %d KB\n", before.HeapInuse/1024)
    fmt.Printf("after delete:  %d KB\n", afterDelete.HeapInuse/1024)
    fmt.Printf("after rebuild: %d KB\n", afterRebuild.HeapInuse/1024)
}
```

You should see memory drop only after the rebuild trigger. The deleted entries were tombstoned in `read.m` until the next promotion.

---

## Final challenge — replace one production use of `sync.Map` in your codebase

**Goal**: apply the decision matrix to real code.

Look through the codebase you work with. Find one `sync.Map` usage. Ask:

- What is the read/write ratio?
- Is the key set stable?
- Is `Len` ever called?
- Is `Range` used for snapshot semantics?
- Are values boxed unnecessarily?

If `sync.Map` is appropriate, document why with a comment. If not, propose a replacement (`RWMutex+map`, sharded, `atomic.Pointer[map]`, or a different data structure entirely) and benchmark it. Write up the result.

This is the actual senior-level skill: making the right call, defending it with data, and improving real software.

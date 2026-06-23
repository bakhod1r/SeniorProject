# singleflight — Hands-On Tasks

## Table of Contents
1. [Setup](#setup)
2. [Task 1: Prove It Coalesces](#task-1-prove-it-coalesces)
3. [Task 2: First Loader Pattern](#task-2-first-loader-pattern)
4. [Task 3: TTL Cache + Singleflight](#task-3-ttl-cache--singleflight)
5. [Task 4: Generic Wrapper](#task-4-generic-wrapper)
6. [Task 5: DoChan with Cancellation](#task-5-dochan-with-cancellation)
7. [Task 6: Negative Caching with Retry](#task-6-negative-caching-with-retry)
8. [Task 7: Panic-Safe Loader](#task-7-panic-safe-loader)
9. [Task 8: Per-Tenant Loader Group](#task-8-per-tenant-loader-group)
10. [Task 9: Observability Wrapper](#task-9-observability-wrapper)
11. [Task 10: Stress Test the Coalescing Ratio](#task-10-stress-test-the-coalescing-ratio)
12. [Task 11: Tiered Cache with Two Groups](#task-11-tiered-cache-with-two-groups)
13. [Task 12: Loader Invalidation API](#task-12-loader-invalidation-api)

---

## Setup

Create a working directory:

```bash
mkdir -p singleflight-tasks && cd singleflight-tasks
go mod init singleflight-tasks
go get golang.org/x/sync/singleflight
```

Each task is an independent file. Run with `go run task01.go` etc.

---

## Task 1: Prove It Coalesces

**Goal.** Demonstrate, with a counter, that 100 concurrent callers for the same key cause the loader to run exactly once.

**Starter:**

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "time"

    "golang.org/x/sync/singleflight"
)

func main() {
    var g singleflight.Group
    var calls int32

    load := func() (interface{}, error) {
        atomic.AddInt32(&calls, 1)
        time.Sleep(100 * time.Millisecond)
        return "value", nil
    }

    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            // TODO: call g.Do here and assert error/value
        }()
    }
    wg.Wait()
    fmt.Printf("loader ran %d times (expected 1)\n", atomic.LoadInt32(&calls))
}
```

**Acceptance.** Output reads `loader ran 1 times`.

**Solution sketch.** Inside the goroutine:

```go
v, err, shared := g.Do("k", load)
if err != nil || v != "value" {
    fmt.Println("bad result", v, err)
}
_ = shared
```

**Discussion.** This is the smallest possible singleflight demonstration. If the counter ever shows > 1, you have a timing bug — the goroutines started too slowly and the loader finished before the next caller arrived. Increase the sleep in the loader.

---

## Task 2: First Loader Pattern

**Goal.** Write `GetUser(id int) (*User, error)` that uses singleflight on a slow database query.

**Spec.**

```go
type User struct {
    ID   int
    Name string
}

var queries int32

func slowQueryUser(id int) (*User, error) {
    atomic.AddInt32(&queries, 1)
    time.Sleep(200 * time.Millisecond)
    return &User{ID: id, Name: fmt.Sprintf("user-%d", id)}, nil
}
```

Write `GetUser(id)` such that 50 concurrent calls with `id=42` produce exactly 1 query.

**Acceptance.** A test that spawns 50 goroutines calling `GetUser(42)` and asserts that `queries == 1` after.

**Solution sketch.**

```go
var g singleflight.Group

func GetUser(id int) (*User, error) {
    key := strconv.Itoa(id)
    v, err, _ := g.Do(key, func() (interface{}, error) {
        return slowQueryUser(id)
    })
    if err != nil {
        return nil, err
    }
    return v.(*User), nil
}
```

**Discussion.** Notice that the key is the string form of the integer ID. Use `strconv.Itoa` over `fmt.Sprintf` for performance.

---

## Task 3: TTL Cache + Singleflight

**Goal.** Add a TTL cache in front of the loader from Task 2. Sequential calls to `GetUser(42)` separated by less than the TTL must not re-query.

**Spec.**

- TTL = 1 second.
- The cache is a `map[string]ttlEntry` protected by a mutex (no need for a fancy library).
- `GetUser` checks the cache first; on miss, uses singleflight to load and populate.

**Acceptance.** Two sequential `GetUser(42)` calls 100ms apart trigger exactly 1 query. Two calls 2 seconds apart trigger 2 queries.

**Solution sketch.**

```go
type ttlEntry struct {
    u   *User
    exp time.Time
}

var (
    mu    sync.RWMutex
    cache = map[string]ttlEntry{}
    g     singleflight.Group
)

func GetUser(id int) (*User, error) {
    key := strconv.Itoa(id)
    mu.RLock()
    e, ok := cache[key]
    mu.RUnlock()
    if ok && time.Now().Before(e.exp) {
        return e.u, nil
    }
    v, err, _ := g.Do(key, func() (interface{}, error) {
        u, err := slowQueryUser(id)
        if err == nil {
            mu.Lock()
            cache[key] = ttlEntry{u: u, exp: time.Now().Add(1 * time.Second)}
            mu.Unlock()
        }
        return u, err
    })
    if err != nil {
        return nil, err
    }
    return v.(*User), nil
}
```

**Discussion.** The cache and singleflight are independent layers. Singleflight protects against concurrent misses; the cache protects against sequential misses.

---

## Task 4: Generic Wrapper

**Goal.** Build a generic `Group[T]` that wraps `singleflight.Group` and hides `interface{}` from callers.

**Spec.**

```go
type Group[T any] struct {
    g singleflight.Group
}

func (g *Group[T]) Do(key string, fn func() (T, error)) (T, error, bool)
func (g *Group[T]) DoChan(key string, fn func() (T, error)) <-chan Result[T]

type Result[T any] struct {
    Val    T
    Err    error
    Shared bool
}
```

**Acceptance.** Calls compile without `interface{}` at the call site.

**Solution sketch.**

```go
func (g *Group[T]) Do(key string, fn func() (T, error)) (T, error, bool) {
    v, err, shared := g.g.Do(key, func() (interface{}, error) {
        return fn()
    })
    if err != nil {
        var zero T
        return zero, err, shared
    }
    return v.(T), nil, shared
}

func (g *Group[T]) DoChan(key string, fn func() (T, error)) <-chan Result[T] {
    out := make(chan Result[T], 1)
    underlying := g.g.DoChan(key, func() (interface{}, error) { return fn() })
    go func() {
        r := <-underlying
        if r.Err != nil {
            var zero T
            out <- Result[T]{Val: zero, Err: r.Err, Shared: r.Shared}
            return
        }
        out <- Result[T]{Val: r.Val.(T), Err: nil, Shared: r.Shared}
    }()
    return out
}
```

**Discussion.** The `DoChan` wrapper spawns a small goroutine to translate the underlying `Result` to `Result[T]`. The cost is one goroutine per `DoChan` call; cheap.

---

## Task 5: DoChan with Cancellation

**Goal.** Write `GetUserCtx(ctx, id)` that returns `ctx.Err()` if the caller cancels while waiting for the loader.

**Spec.**

- Use `g.DoChan` and `select`.
- The underlying loader continues to run after cancellation (verify this with a counter).

**Acceptance.** A test that cancels the context after 50ms while the loader sleeps for 200ms returns `context.Canceled`; the loader still runs to completion.

**Solution sketch.**

```go
func GetUserCtx(ctx context.Context, id int) (*User, error) {
    key := strconv.Itoa(id)
    ch := g.DoChan(key, func() (interface{}, error) {
        return slowQueryUser(id)
    })
    select {
    case res := <-ch:
        if res.Err != nil {
            return nil, res.Err
        }
        return res.Val.(*User), nil
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}
```

**Discussion.** The loader's goroutine continues running. If you spawn 1000 goroutines that all cancel quickly, the loader still runs to completion exactly once. Late arrivals after cancellation will still see the result (or join a new round if the previous one finished).

---

## Task 6: Negative Caching with Retry

**Goal.** Build a loader that distinguishes permanent and transient errors and caches only permanent ones.

**Spec.**

- Loader sometimes returns `errNotFound` (permanent) and sometimes `errTimeout` (transient).
- Cache only `errNotFound` with TTL 30 seconds.
- Transient errors are returned without caching.

**Acceptance.**

- A call that gets `errNotFound` is followed by 5 more calls in 5 seconds; the loader runs once and the cached error is returned for the rest.
- A call that gets `errTimeout` is followed by another call; the loader runs again.

**Solution sketch.**

```go
type cacheEntry struct {
    u   *User
    err error
    exp time.Time
}

var (
    errNotFound = errors.New("not found")
    errTimeout  = errors.New("timeout")
)

func isPermanent(err error) bool {
    return errors.Is(err, errNotFound)
}

func GetUser(id int) (*User, error) {
    key := strconv.Itoa(id)
    mu.RLock()
    e, ok := cache[key]
    mu.RUnlock()
    if ok && time.Now().Before(e.exp) {
        return e.u, e.err
    }
    v, err, _ := g.Do(key, func() (interface{}, error) {
        u, err := slowQueryUser(id)
        if err == nil {
            mu.Lock()
            cache[key] = cacheEntry{u: u, exp: time.Now().Add(5 * time.Minute)}
            mu.Unlock()
            return u, nil
        }
        if isPermanent(err) {
            mu.Lock()
            cache[key] = cacheEntry{err: err, exp: time.Now().Add(30 * time.Second)}
            mu.Unlock()
        }
        return nil, err
    })
    if err != nil {
        return nil, err
    }
    if v == nil {
        return nil, errors.New("nil value, nil error: impossible")
    }
    return v.(*User), nil
}
```

**Discussion.** Notice the asymmetric TTLs: success cached for 5 minutes, permanent errors for 30 seconds. If we misclassified the error, we recover within 30 seconds.

---

## Task 7: Panic-Safe Loader

**Goal.** A loader that panics on some inputs. Wrap it so panics become errors and N concurrent callers do not all panic.

**Spec.**

```go
func unsafeLoader(id int) (interface{}, error) {
    if id == 13 {
        panic("unlucky")
    }
    return "ok", nil
}
```

**Acceptance.** 10 concurrent callers with `id=13` receive an error containing "unlucky"; no goroutine panics.

**Solution sketch.**

```go
func GetSafe(id int) (interface{}, error) {
    v, err, _ := g.Do(strconv.Itoa(id), func() (v interface{}, err error) {
        defer func() {
            if r := recover(); r != nil {
                err = fmt.Errorf("loader panic: %v", r)
            }
        }()
        return unsafeLoader(id)
    })
    return v, err
}
```

**Discussion.** Always recover inside the loader. The recover converts the panic to an error which is then coalesced normally to every waiter.

---

## Task 8: Per-Tenant Loader Group

**Goal.** Build a multi-tenant loader where each tenant has its own `Group`. Keys include the tenant ID.

**Spec.**

- A `MultiTenantLoader` struct.
- Method `Get(tenant string, key string) (*Resource, error)`.
- Internally, a `map[string]*singleflight.Group` keyed by tenant, lazily created.
- Concurrent loads for `(tenantA, "k")` and `(tenantB, "k")` must NOT coalesce.

**Acceptance.** A test with 50 concurrent loads for `(A, "x")` and 50 for `(B, "x")` runs the loader exactly twice (once per tenant).

**Solution sketch.**

```go
type MultiTenantLoader struct {
    mu     sync.Mutex
    groups map[string]*singleflight.Group
}

func (l *MultiTenantLoader) Get(tenant, key string) (*Resource, error) {
    l.mu.Lock()
    g, ok := l.groups[tenant]
    if !ok {
        g = &singleflight.Group{}
        if l.groups == nil {
            l.groups = make(map[string]*singleflight.Group)
        }
        l.groups[tenant] = g
    }
    l.mu.Unlock()

    v, err, _ := g.Do(key, func() (interface{}, error) {
        return loadResource(tenant, key)
    })
    if err != nil {
        return nil, err
    }
    return v.(*Resource), nil
}
```

**Discussion.** Per-tenant groups isolate tenants from each other's stampedes. An alternative is one global group with `key = "tenant:" + tenant + ":" + key`. Both work; per-tenant groups give independent internal mutexes.

---

## Task 9: Observability Wrapper

**Goal.** Wrap singleflight with counters for total, coalesced, errors, and a histogram for loader duration.

**Spec.** Use atomic counters. Print a summary every 5 seconds.

**Solution sketch.**

```go
type ObservableLoader struct {
    g          singleflight.Group
    total      int64
    coalesced  int64
    errors     int64
    durationNs int64
}

func (l *ObservableLoader) Get(key string, fn func() (interface{}, error)) (interface{}, error) {
    start := time.Now()
    v, err, shared := l.g.Do(key, fn)
    elapsed := time.Since(start)

    atomic.AddInt64(&l.total, 1)
    atomic.AddInt64(&l.durationNs, elapsed.Nanoseconds())
    if shared {
        atomic.AddInt64(&l.coalesced, 1)
    }
    if err != nil {
        atomic.AddInt64(&l.errors, 1)
    }
    return v, err
}

func (l *ObservableLoader) Snapshot() string {
    total := atomic.LoadInt64(&l.total)
    coalesced := atomic.LoadInt64(&l.coalesced)
    errors := atomic.LoadInt64(&l.errors)
    durationNs := atomic.LoadInt64(&l.durationNs)
    avgNs := int64(0)
    if total > 0 {
        avgNs = durationNs / total
    }
    return fmt.Sprintf("total=%d coalesced=%d errors=%d avg=%dns", total, coalesced, errors, avgNs)
}
```

**Discussion.** A real production wrapper would use `prometheus.CounterVec` and `prometheus.HistogramVec`; the principles are the same.

---

## Task 10: Stress Test the Coalescing Ratio

**Goal.** Write a stress test that generates 10,000 concurrent loads across 100 unique keys (so each key gets ~100 concurrent callers) and reports the coalescing ratio.

**Spec.**

- 10,000 goroutines, each picks a random key from 100.
- Loader sleeps a random 10–50ms.
- Report total loads, coalesced loads, ratio.

**Solution sketch.**

```go
func main() {
    var l ObservableLoader
    var wg sync.WaitGroup
    for i := 0; i < 10000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            key := strconv.Itoa(rand.Intn(100))
            l.Get(key, func() (interface{}, error) {
                time.Sleep(time.Duration(10+rand.Intn(40)) * time.Millisecond)
                return key, nil
            })
        }()
    }
    wg.Wait()
    fmt.Println(l.Snapshot())
}
```

**Discussion.** Expect a coalescing ratio between 50% and 95% depending on how tightly the goroutines arrive together. Pause-the-world events (GC) bunch arrivals; busy systems disperse them. Run a few times and observe the variance.

---

## Task 11: Tiered Cache with Two Groups

**Goal.** Build an L1 (in-process map) + L2 (simulated network cache) + slow source. Singleflight at L2 and at the slow source.

**Spec.**

```
caller
  └─ check L1 (map)              hit → return
  └─ gL2.Do
       └─ check L2 (network)     hit → fill L1 → return
       └─ gSource.Do
            └─ slow source       → fill L2 → fill L1 → return
```

Simulate L2 with a 10ms sleep; source with 100ms.

**Acceptance.** 1,000 concurrent loads for the same key: 1 source call, 1 L2 call after L1 fills, then L1 hits for the rest.

**Discussion.** Two-tier coalescing is the same pattern repeated. The deeper layer's group must be inside the shallower layer's loader.

---

## Task 12: Loader Invalidation API

**Goal.** Add `Invalidate(key)` to your loader that ensures the next call re-loads.

**Spec.**

- `Invalidate(key)` deletes the cache entry AND calls `g.Forget(key)`.
- A test: load `K`, then `Invalidate(K)`, then load `K` again. The loader runs twice.

**Solution sketch.**

```go
func (l *Loader) Invalidate(key string) {
    l.mu.Lock()
    delete(l.cache, key)
    l.mu.Unlock()
    l.g.Forget(key)
}
```

**Discussion.** Without the `Forget`, a long-running loader started before the invalidation will finish and re-populate the cache with stale data. The two operations together — cache delete + forget — ensure freshness.

**Bonus.** What happens if `Invalidate` is called *during* the load? The loader finishes, attempts to write to the cache (which we just emptied), succeeds. The cache now contains stale data. To fix: the loader's write should check whether `Invalidate` was called after the loader started. Use a generation counter.

---

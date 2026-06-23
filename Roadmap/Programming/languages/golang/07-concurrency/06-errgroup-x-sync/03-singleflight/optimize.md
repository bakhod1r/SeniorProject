# singleflight — Optimisation

## Table of Contents
1. [Introduction](#introduction)
2. [Measuring Before Optimising](#measuring-before-optimising)
3. [Key Construction Cost](#key-construction-cost)
4. [Group Sharding](#group-sharding)
5. [Allocation Reduction Inside the Loader](#allocation-reduction-inside-the-loader)
6. [Fast-Path Cache Layout](#fast-path-cache-layout)
7. [Closure Costs](#closure-costs)
8. [Avoiding `interface{}` Boxing](#avoiding-interface-boxing)
9. [TTL Jitter and Refresh-Ahead](#ttl-jitter-and-refresh-ahead)
10. [Cancelling the Slow Loader](#cancelling-the-slow-loader)
11. [When to Ditch Singleflight Entirely](#when-to-ditch-singleflight-entirely)
12. [Summary](#summary)

---

## Introduction

Singleflight is a fast tool. In a benchmark of `Group.Do` with a no-op loader, the entire round trip is in the low hundreds of nanoseconds. If singleflight ever shows up as a bottleneck in your profile, the cause is almost certainly *around* it — not inside it. This file walks through the surrounding optimisations.

The cardinal rule of optimisation applies: measure. The micro-optimisations in this file are worth single-digit percent improvements in heavy use; the architectural ones (jittered TTLs, sharded groups) can be order-of-magnitude.

---

## Measuring Before Optimising

Three signals matter:

1. **Loader duration distribution.** P50 / P95 / P99 of the loader function itself. Optimising the wrapper while a loader takes 100ms is silly.
2. **Coalescing ratio.** `coalesced / total`. If low in steady state, singleflight is doing nothing for you.
3. **Internal mutex contention.** Run with `GODEBUG=mutexprofile=1` or use `runtime/pprof` with a mutex profile. If the group's internal mutex shows up, you have a real reason to shard.

A reasonable benchmark setup:

```go
func BenchmarkDoNoCoalesce(b *testing.B) {
    var g singleflight.Group
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        key := strconv.Itoa(i)
        g.Do(key, func() (interface{}, error) {
            return i, nil
        })
    }
}

func BenchmarkDoCoalesce(b *testing.B) {
    var g singleflight.Group
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            g.Do("hot", func() (interface{}, error) {
                time.Sleep(time.Microsecond)
                return 1, nil
            })
        }
    })
}
```

Expect the first benchmark to report ~150-300 ns/op (mostly allocation and map ops). Expect the second to be dominated by the sleep.

---

## Key Construction Cost

The key is the most-touched string in singleflight. Building it with `fmt.Sprintf` is expensive:

```go
key := fmt.Sprintf("user:%d", id) // ~120 ns/op, 32 B/op
```

Alternatives:

```go
// strconv: ~30 ns/op, allocates only on growth
key := "user:" + strconv.Itoa(id)

// pre-allocated builder for hot loops
var b strings.Builder
b.Grow(16)
b.WriteString("user:")
b.WriteString(strconv.Itoa(id))
key := b.String()

// byte slice + unsafe.String (Go 1.20+)
buf := make([]byte, 0, 16)
buf = append(buf, "user:"...)
buf = strconv.AppendInt(buf, int64(id), 10)
key := unsafe.String(&buf[0], len(buf))
```

The `unsafe.String` approach is the fastest, but the resulting string aliases the byte slice. If the slice is mutated, the string changes. Use only when the slice is local and not retained.

For most code, `"prefix:" + strconv.Itoa(id)` is the right balance. Reach for builders or unsafe only when profiles demand it.

---

## Group Sharding

If profiles show the internal `Group` mutex is contended, shard.

```go
type ShardedGroup struct {
    shards [256]singleflight.Group
}

func (s *ShardedGroup) Do(key string, fn func() (interface{}, error)) (interface{}, error, bool) {
    return s.shards[fnv1a32(key)%256].Do(key, fn)
}

func (s *ShardedGroup) DoChan(key string, fn func() (interface{}, error)) <-chan singleflight.Result {
    return s.shards[fnv1a32(key)%256].DoChan(key, fn)
}

func (s *ShardedGroup) Forget(key string) {
    s.shards[fnv1a32(key)%256].Forget(key)
}

func fnv1a32(s string) uint32 {
    const offset32 = 2166136261
    const prime32 = 16777619
    h := uint32(offset32)
    for i := 0; i < len(s); i++ {
        h ^= uint32(s[i])
        h *= prime32
    }
    return h
}
```

256 shards is enough for most workloads. The hash function should be fast and stable; FNV-1a is a sensible default. `xxhash` is faster but adds a dependency.

Caveat: sharding doubles the memory footprint (one `Group` per shard) and only helps if your traffic is well-distributed across keys. A workload with one super-hot key gains nothing from sharding — that key always lands in the same shard.

---

## Allocation Reduction Inside the Loader

The loader is your code. Profile it.

Common allocation hotspots inside loaders:

- **JSON unmarshal.** Use `json.Decoder` with `UseNumber` or switch to a faster library (`json-iterator`, `easyjson`).
- **Database row parsing.** Use the driver's typed scan rather than `[]interface{}`.
- **String building.** As above.
- **Defer of large closures.** Move logic into named functions to avoid escape.
- **Goroutine spawning.** A loader that spawns more goroutines pays the goroutine setup cost.

A profile-guided rule: if a loader allocates more than 1 KB per call on average and is on the hot path, there is usually a low-hanging optimisation.

---

## Fast-Path Cache Layout

When singleflight sits in front of a cache, the cache check is the truly hot path. The singleflight call only happens on miss.

A typical fast-path:

```go
mu.RLock()
e, ok := cache[key]
mu.RUnlock()
if ok && time.Now().Before(e.exp) {
    return e.val, nil
}
```

Three optimisations:

1. **Avoid `time.Now()` per call.** It is not free (~20 ns). On extremely hot paths, sample time from a periodically updated atomic:

   ```go
   var nowNs atomic.Int64
   func init() {
       go func() {
           t := time.NewTicker(100 * time.Millisecond)
           for now := range t.C { nowNs.Store(now.UnixNano()) }
       }()
   }
   ```

   Now reads are sub-nanosecond. Pay the resolution loss (100ms) for the cost saving.

2. **Avoid the RWMutex on truly hot reads.** Replace with `sync.Map` or an `atomic.Pointer[map]` that swaps the entire map on write. The trade-off depends on read/write ratio.

3. **Cache hits should not box.** If your cache stores typed values (a generic LRU), the fast path avoids the `interface{}` box. The slow path through `singleflight` still boxes, but that path is rare.

---

## Closure Costs

Every `g.Do` allocates a closure. The closure captures the loader's free variables.

```go
g.Do(key, func() (interface{}, error) {
    return db.QueryUser(id) // captures id and db
})
```

This is a heap allocation roughly the size of the captured variables (~32-48 bytes for a few pointers). On the hot path, this matters.

If the loader closure is stable across calls (it captures `db` once, but `id` is parameterised), pre-build a typed loader and feed `id` through a sync.Pool of small structs. This is rarely worth it; most code allocates these closures and is fine.

A more impactful optimisation: if the loader signature were `func(key string) (interface{}, error)`, the singleflight package could call the loader with the key it already has, and you would not need to capture `id` in a closure. The package does not provide this signature — but you can build a wrapper that does:

```go
type KeyedGroup struct {
    g singleflight.Group
}

func (k *KeyedGroup) Do(key string, fn func(string) (interface{}, error)) (interface{}, error, bool) {
    return k.g.Do(key, func() (interface{}, error) {
        return fn(key)
    })
}
```

This still allocates a closure. To truly avoid it, you would need to fork the package and add a key-passing loader signature. Not worth it for most workloads.

---

## Avoiding `interface{}` Boxing

`singleflight.Group.Do` returns `interface{}`. Storing a value into an interface boxes it (allocates on the heap for non-pointer values, or uses the pointer directly for pointers).

If your loader returns a pointer type, there is no extra allocation — the interface holds the pointer.

If your loader returns a value type (a struct, an int, a string), the interface boxes it. For a struct return type, that is one allocation per loader call.

Recommendation: have loaders return pointers, not values.

```go
// Bad: boxes a 64-byte struct
func loadUser(id int) (interface{}, error) {
    return User{ID: id, Name: "x"}, nil
}

// Good: returns a pointer
func loadUser(id int) (interface{}, error) {
    return &User{ID: id, Name: "x"}, nil
}
```

The cost is real: a User struct of 64 bytes allocated through an interface costs about 80 ns per call (alloc + zero + interface write). A pointer return is essentially free.

---

## TTL Jitter and Refresh-Ahead

The most impactful optimisation is structural: stop the stampede from happening in the first place.

**TTL jitter.** Add random noise to the TTL so cache entries do not all expire at the same instant.

```go
ttl := baseTTL + time.Duration(rand.Intn(int(jitter)))
cache.Set(key, val, ttl)
```

If `baseTTL=60s` and `jitter=10s`, entries expire over a 10-second window instead of one millisecond. The stampede on expiry is spread over time, reducing the peak load.

**Refresh-ahead.** Refresh the cache *before* it expires. When a caller hits the cache and finds an entry that is "near expiry" (say, last 10% of its TTL), the caller returns the current value *and* triggers an async refresh.

```go
func Get(key string) (V, error) {
    e, ok := cache.Get(key)
    if !ok || time.Now().After(e.exp) {
        return load(key) // standard path
    }
    // Refresh-ahead: if entry is in the last 10% of its TTL, refresh async.
    if time.Until(e.exp) < e.ttl/10 {
        go refresh(key) // uses singleflight inside
    }
    return e.val, nil
}
```

The refresh uses singleflight to avoid duplicate refreshes. The user-facing call never blocks on a cache miss because the cache is kept warm.

Combine jitter + refresh-ahead + singleflight + a small TTL cache and your cache miss path becomes a rare event. The optimisation pyramid: most calls hit the cache fast path; the few that miss are coalesced into one load.

---

## Cancelling the Slow Loader

If a loader hangs, every waiter hangs. There is no built-in cancellation. Build one.

A `Group` wrapper with a timeout per call:

```go
type TimedGroup struct {
    g       singleflight.Group
    timeout time.Duration
}

func (t *TimedGroup) Do(key string, fn func(ctx context.Context) (interface{}, error)) (interface{}, error, bool) {
    ctx, cancel := context.WithTimeout(context.Background(), t.timeout)
    defer cancel()
    return t.g.Do(key, func() (interface{}, error) {
        return fn(ctx)
    })
}
```

Now if `fn` respects the context, a loader that hangs aborts after `timeout`. Every waiter receives the timeout error. The next round can retry.

This trades correctness for liveness: a load that *would* have succeeded in 31 seconds with `timeout=30s` returns an error instead. For most production workloads, this trade is correct — better to fail fast than to pile up.

---

## When to Ditch Singleflight Entirely

Some workloads do not need singleflight at all. Recognising these saves complexity and overhead.

### Case 1: Cheap loader

If the loader runs in <10µs, singleflight's overhead (allocation, mutex, map ops) is comparable to the loader itself. Even under burst, parallel execution may be faster than serial.

### Case 2: Sequential traffic

If your service handles 10 requests per second and your loader takes 5ms, concurrent misses are essentially never happening. Singleflight does nothing.

### Case 3: Cache always warm

If your cache is loaded at startup and refreshed proactively, runtime misses never happen. Singleflight is dead weight.

### Case 4: Cache hit ratio extremely high

If hit ratio is 99.99%, the rare 0.01% miss is unlikely to be concurrent. Singleflight is mostly idle.

### Case 5: A simpler primitive suffices

For "load once at startup," use `sync.Once`. For "atomic set-if-absent of cheap value," use `sync.Map.LoadOrStore`. For "per-key serialisation without sharing the result," use a mutex map.

A rule of thumb: only add singleflight when you have *evidence* (a stampede observed in metrics, a load test that reproduces it) that it solves a real problem.

---

## Summary

Optimising singleflight has two levels:

1. **Micro:** key construction, allocation reduction, closure costs, interface boxing, group sharding. Single-digit-percent wins. Profile first.

2. **Macro:** TTL jitter, refresh-ahead, fast-path cache layout, internal loader timeouts. Order-of-magnitude wins. Architectural.

The macro wins matter more. The macro wins also tend to *reduce* the role of singleflight: a well-jittered cache with refresh-ahead has very few concurrent misses, so singleflight rarely engages. That is the goal — singleflight should be the safety net that catches the occasional stampede, not a daily mitigation.

If your profile says singleflight is hot, you have a deeper problem. Investigate the loader and the cache before optimising the package.

---

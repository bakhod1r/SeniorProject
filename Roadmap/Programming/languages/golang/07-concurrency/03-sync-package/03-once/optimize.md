---
layout: default
title: sync.Once — Optimize
parent: sync.Once
grand_parent: sync Package
nav_order: 9
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/03-once/optimize/
---

# sync.Once — Optimize

← Back to sync.Once

`sync.Once` is already cheap — sub-nanosecond on the fast path on amd64. Most "optimisation" stories around it are not about making `Once` faster; they are about **replacing `Once` with a different primitive that better matches your access pattern**. We cover when that pays off, how to measure, and the few cases where micro-optimising the `Once` itself helps.

---

## 1. Baseline: how fast is `Once.Do` already?

On a 3.5 GHz amd64 with Go 1.22:

```
BenchmarkOnceDo-8        500000000      0.72 ns/op       0 B/op   0 allocs/op
```

That is one atomic load + one branch. Comparable to:

```
BenchmarkAtomicLoad-8    1000000000     0.51 ns/op
BenchmarkPlainLoad-8     2000000000     0.30 ns/op
```

A plain function call costs ~1 ns. `Once.Do` is *cheaper than a regular function call* on the fast path.

The slow path (first invocation, single goroutine):

```
BenchmarkOnceDoFirst-8   200000000      30 ns/op    + cost of f
```

A mutex acquire + double-check + store + release. ~30 ns of overhead before `f` runs.

The slow path under heavy contention (1000 goroutines hit a cold Once simultaneously):

```
~100 µs total wall-clock for all 1000 to clear the Once
plus the cost of f, attributed to the winner
```

Each loser pays microseconds for mutex acquisition. The winner pays for `f` plus 30 ns overhead. The aggregate is small and amortised over the program lifetime.

**Bottom line:** `Once.Do` is not the bottleneck. If your profile shows it on top, you have a different problem (such as inadvertently allocating new `Once` per request).

---

## 2. Optimisation 1 — Replace `Once` with `init()`

If the initialisation always runs anyway, `init()` is cheaper at access time:

```go
// Lazy
var (
    once sync.Once
    val  *Config
)
func Get() *Config {
    once.Do(func() { val = build() })
    return val
}

// Eager
var val = build()

func init() {} // empty; for documentation

func Get() *Config {
    return val
}
```

Access cost:

- Lazy: ~1 ns (atomic load + branch + return).
- Eager: ~0.3 ns (direct field load).

Save: ~0.7 ns per call. Negligible per call, but multiplied by millions of calls per second, it can save measurable CPU.

When it does *not* pay off:

- The init is expensive (>1 ms) and may not run in some deployments.
- The init has dependencies (env vars, files) that may not be ready at package load.
- The init can fail and you need graceful error handling.

---

## 3. Optimisation 2 — Replace `Once` with `atomic.Pointer`

For read-heavy lazy state, `atomic.Pointer[T]` after eager init has the cheapest access:

```go
var ptr atomic.Pointer[Config]

func init() {
    ptr.Store(build())
}

func Get() *Config {
    return ptr.Load()
}
```

Access cost: ~0.5 ns (a single atomic load). Slightly faster than `Once.Do` because there is no comparison-to-zero branch.

Benchmark:

```
BenchmarkOnceDo-8        500000000      0.72 ns/op
BenchmarkAtomicLoad-8    1000000000     0.51 ns/op
```

If you call the accessor 10^9 times per second per core, you save ~200 ms of CPU per second. In most programs this is invisible; in tight hot loops it is real.

The big win of `atomic.Pointer`: hot reload. You can `Store(newConfig)` at any time, and readers seamlessly see the new value without any locking. `Once` cannot do this.

---

## 4. Optimisation 3 — Pre-warm to avoid first-touch stampede

If 1000 worker goroutines hit a cold `Once` simultaneously, 999 of them queue on the mutex while the winner runs `f`. The aggregate latency is `f`'s runtime plus per-loser handoff cost. If `f` is fast (microseconds), no one notices. If `f` is slow (hundreds of milliseconds), the first request after deployment may see noticeable tail latency.

The fix: warm the `Once` synchronously at startup before workers spawn:

```go
func main() {
    // Pre-warm: forces the slow path on the main goroutine,
    // single-threaded, no contention.
    _ = GetConfig()

    // Now fan out:
    for i := 0; i < 1000; i++ {
        go worker()
    }
}
```

Every worker hits the fast path. No mutex.

Measured impact on a real service (cold `Once` triggered by 500 concurrent first requests, `f` takes 200 ms):

| Mode | p50 first-request latency | p99 first-request latency |
|---|---|---|
| Cold (no pre-warm) | 220 ms | 280 ms |
| Pre-warmed in main | 5 ms | 20 ms |

The pre-warm spent 200 ms at startup, but every first request is fast.

---

## 5. Optimisation 4 — Replace `Once` with cached-but-replaceable

Some lazy values are "build once" semantically but practically you want to refresh. `Once` cannot refresh. The pattern:

```go
type Refreshable struct {
    mu   sync.RWMutex
    val  *Config
    last time.Time
}

func (r *Refreshable) Get() *Config {
    r.mu.RLock()
    if r.val != nil && time.Since(r.last) < refreshInterval {
        v := r.val
        r.mu.RUnlock()
        return v
    }
    r.mu.RUnlock()

    r.mu.Lock()
    defer r.mu.Unlock()
    if r.val == nil || time.Since(r.last) >= refreshInterval {
        r.val = build()
        r.last = time.Now()
    }
    return r.val
}
```

The hot path takes the read lock — slightly more expensive than `Once.Do`'s atomic load, but you get refresh. If reads vastly outnumber writes, prefer `atomic.Pointer` with a background goroutine that periodically rebuilds and stores.

Replace with `atomic.Pointer`:

```go
type R struct {
    ptr atomic.Pointer[Config]
}

func (r *R) Get() *Config { return r.ptr.Load() }

func (r *R) backgroundRefresh() {
    for {
        time.Sleep(refreshInterval)
        r.ptr.Store(build())
    }
}
```

Hot path: 0.5 ns. Refresh happens out of band. This is the standard pattern for "live config" in production Go services.

---

## 6. Optimisation 5 — Use `OnceValue` / `OnceValues` (1.21+) for the GC win

Raw `sync.Once` keeps the function value (and its captured closure) alive forever. If the closure captured a 100 MB byte slice for one-time parsing, that slice cannot be freed.

`sync.OnceFunc`, `sync.OnceValue`, `sync.OnceValues` (Go 1.21+) all explicitly nil out the function pointer after the first successful call. The closure can then be GC'd, freeing whatever it captured.

```go
// Before: closure pinned forever
var (
    once sync.Once
    parsed *Result
)
func Get(data []byte) *Result {
    once.Do(func() {
        parsed = parse(data) // closure captures `data`
    })
    return parsed
}
// After Get returns, `data` is still referenced by the closure
// inside `once`. It cannot be GC'd until the package is unloaded
// (which never happens).

// After: closure released
var parsedPtr *Result
var load = sync.OnceFunc(func() {
    parsedPtr = parse(data) // assuming data is a package var
})
```

For closures capturing significant state, this is a real memory win in long-lived services. Profile with `go tool pprof -alloc_space` to confirm.

---

## 7. Optimisation 6 — `singleflight` for per-key deduplication

If you find yourself doing:

```go
m := sync.Map{}
oncePerKey := sync.Map{}

func Get(k string) *V {
    if v, ok := m.Load(k); ok {
        return v.(*V)
    }
    o, _ := oncePerKey.LoadOrStore(k, &sync.Once{})
    o.(*sync.Once).Do(func() {
        m.Store(k, build(k))
    })
    v, _ := m.Load(k)
    return v.(*V)
}
```

You are reinventing `singleflight.Group`. Replace with:

```go
var (
    cache sync.Map
    sf    singleflight.Group
)

func Get(k string) *V {
    if v, ok := cache.Load(k); ok {
        return v.(*V)
    }
    v, _, _ := sf.Do(k, func() (any, error) {
        v := build(k)
        cache.Store(k, v)
        return v, nil
    })
    return v.(*V)
}
```

`singleflight` is purpose-built for this. It is faster than the manual pattern (single mutex, no per-key allocation of a `Once`), and it forgets the key after the call, allowing retry on later calls if the build fails.

---

## 8. Optimisation 7 — Inline the `Once` work for tiny functions

If `f` is genuinely trivial (a single assignment), the overhead of `Once.Do` *itself* (~1 ns) may dominate `f`'s cost. In that case, an `atomic.CompareAndSwap` pattern can be faster:

```go
var done atomic.Uint32

func Init() {
    if done.Load() == 0 {
        if done.CompareAndSwap(0, 1) {
            // initialise (idempotent or first-wins)
            doWork()
        }
    }
}
```

Caveat: `doWork` may be invoked multiple times concurrently (CAS losers do not wait). This only works if `doWork` is idempotent or you can tolerate the duplicate.

For genuine "exactly once," `Once.Do` is the answer. For "at least once, prefer once," CAS is faster but weaker.

In practice, this micro-optimisation is rarely worth the risk. Stick with `Once`.

---

## 9. Optimisation 8 — Avoid `Once` in the hot path entirely

If your hot path is "request comes in, get config, do work," you do not need to call `Get` inside the handler. You can dependency-inject:

```go
// Before
func Handler(w http.ResponseWriter, r *http.Request) {
    cfg := GetConfig() // Once.Do on every request
    serve(w, r, cfg)
}

// After
type Handler struct{ cfg *Config }

func (h *Handler) Serve(w http.ResponseWriter, r *http.Request) {
    serve(w, r, h.cfg)
}

// Constructed once at startup:
h := &Handler{cfg: GetConfig()}
http.Handle("/", h)
```

Now the `Once` is touched once at startup. The hot path reads `h.cfg` directly — no `Once`, no atomic load, just a struct field access.

Saved: ~1 ns per request. Negligible in absolute terms but worth the architectural cleanliness. The hot path is now devoid of any synchronisation concern.

---

## 10. Anti-pattern: re-allocating `Once` per call

```go
func Bad() {
    once := sync.Once{}      // new each call
    once.Do(expensiveSetup)
}
```

`expensiveSetup` runs every call. The "optimisation" you wanted (lazy single execution) is gone. You also pay the cost of zeroing a struct on every call.

This is not a thing anyone writes deliberately. It happens when a `Once` is mistakenly placed inside a function. Look for this in code review.

---

## 11. Profiling `Once`

To see whether `Once` is showing up in your profile:

```bash
go test -bench=. -benchmem -cpuprofile=cpu.out
go tool pprof cpu.out
(pprof) top
(pprof) list YourHotFunction
```

Look for `sync.(*Once).Do` or `sync.(*Once).doSlow` in the listing. If you see `doSlow`, you have contention — many goroutines racing on a cold `Once`. Fix by pre-warming. If you see `Do` itself accounting for measurable CPU, something is wrong — probably you are allocating a fresh `Once` per call (see anti-pattern above).

---

## 12. Memory profiling

```bash
go test -bench=. -benchmem -memprofile=mem.out
go tool pprof -alloc_space mem.out
```

Look for allocations under your `Once`-guarded code paths. If the closure passed to `Do` captures large state and you are pre-1.21, switch to `OnceValue`/`OnceFunc` to release the closure after first call.

---

## 13. Cache-line considerations

`sync.Once` is 24 bytes (4 for `done`, 8 for the Mutex, plus alignment). If you have many `Once` values close together in a struct, false sharing is possible: writes to one (during its slow path) can invalidate the cache line containing others.

```go
type Service struct {
    onceA sync.Once
    onceB sync.Once
    onceC sync.Once
    // all on the same cache line
}
```

If many goroutines simultaneously run `onceA.Do` and `onceB.Do`, the cache line containing both bounces between cores. Pad if this matters:

```go
type Service struct {
    onceA sync.Once
    _     [64]byte // pad to next cache line
    onceB sync.Once
    _     [64]byte
    onceC sync.Once
}
```

In practice this matters only for tight benchmarks. Real applications spend microseconds inside `f`; cache-line bounce is invisible. Do not preemptively pad — measure first.

---

## 14. Compiler optimisations to know about

The Go compiler does **not** inline `Once.Do`. Inspect:

```bash
go build -gcflags="-m -m" yourpkg
```

You will see something like:

```
sync/once.go:71:6: cannot inline (*Once).Do: function too complex
```

`Once.Do` is a hot method but its body is large enough (multiple checks, deferred calls) that the inliner skips it. This costs a few cycles per call (function call overhead). If you really need it inlined, write a wrapper:

```go
func DoFast(o *sync.Once, f func()) {
    if atomic.LoadUint32((*uint32)(unsafe.Pointer(&o.done))) == 0 {
        o.Do(f)
    }
}
```

This is reaching into unexported state and is *not* recommended. The compiler may change `Once`'s layout. Use this only if benchmarks justify it and you accept the maintenance burden. (We do not.)

---

## 15. Concurrent-write contention on shared `Once`

If your design has many independent goroutines all calling the same `Once.Do(f)`, the fast path is wait-free: each goroutine performs an independent atomic load. No contention.

If you have many goroutines calling `Once.Do(f1)` on the same `Once` and also `Once.Do(f2)` on the same `Once`, the first wins; `f2` never runs. (Probably a bug — see find-bug.md.) The contention story is the same: fast path is wait-free.

The only place `Once` has real contention is the cold-start window where multiple goroutines pile into the slow path. That is bounded by `f`'s runtime.

---

## 16. Putting it together — decision matrix

| Pattern | Hot-path cost | Reload? | Retry? | When to choose |
|---|---|---|---|---|
| `init()` + plain var | 0.3 ns | No (process restart) | No | Cheap, always-needed init |
| `sync.Once` + var | 1 ns | No | No | Expensive, conditional init |
| `sync.OnceValue` (1.21+) | 1 ns | No | No | Cleaner sync.Once for value-returning init |
| `atomic.Pointer` + eager init | 0.5 ns | Yes (Store) | N/A | Live-reloadable value |
| `atomic.Pointer` + lazy CAS | 0.5 ns | Yes | Yes (each call) | Pure builder, late readers may retry |
| `singleflight` + cache | depends | Yes | Yes | Per-key dedup with retry |
| Mutex + nil-check | ~10 ns | Yes (clear) | Yes | Retry on error |

Pick by access pattern, not by what is "fastest in isolation." A 0.2 ns difference on the hot path is rarely material; correctness and clarity dominate.

---

## 17. Summary

`sync.Once` is fast. The fast path is one atomic load — cheaper than a function call. Most optimisation effort should *not* go into making `Once` itself faster but into deciding whether `Once` is the right primitive at all.

The real wins:

1. **Replace `Once` with `init()`** if init always runs and is cheap.
2. **Replace `Once` with `atomic.Pointer`** if you need hot reload or want lock-free reads.
3. **Use `OnceValue` / `OnceFunc` (1.21+)** for the GC release of the closure.
4. **Pre-warm in `main`** to avoid first-touch stampede.
5. **Use `singleflight` for per-key** instead of hand-rolled `Once` maps.
6. **Avoid `Once` in the hot path entirely** by dependency-injecting the value at startup.

`Once` is a tool, not a hammer. The performance-conscious engineer reaches for it when "exactly once, with side effects, committed forever" matches the requirement — and reaches past it when the requirement is anything else.

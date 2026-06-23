---
layout: default
title: sync.OnceFunc — Optimize
parent: sync.OnceFunc/OnceValue/OnceValues
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/01-sync-oncefunc/optimize/
---

# sync.OnceFunc — Optimize

[← Back](../)

## The cost model

There are two performance dimensions: the **one-time** cost of constructing the wrapper, and the **per-call** cost of invoking it.

**Construction.** `sync.OnceFunc(f)` allocates one closure on the heap, plus enough room for the `sync.Once`, the `valid` bool, the `p any` slot, and the inner `g` closure that captures all of those. On amd64 with Go 1.22 this is typically two to three small allocations totaling around 64–96 bytes. By contrast, a package-level `var once sync.Once` lives in the BSS segment (zero allocations) and the function it calls is referenced by name (zero allocations). For `OnceValue`/`OnceValues`, add the size of the cached return value(s).

**Per-call (after the first).** Both `sync.Once.Do` and the `OnceFunc` wrapper do exactly one atomic load on the fast path: `Once.Do` reads its `done` field via `atomic.LoadUint32`. `OnceFunc` adds one indirect function call (the wrapper itself), one read of `valid`, and on the success path one return. The difference is ~1 ns on modern x86 — utterly invisible against any non-trivial wrapped function.

## Benchmark

```go
package once_bench

import (
    "sync"
    "testing"
)

var globalOnce sync.Once

func initFn() {}

func BenchmarkSyncOnce(b *testing.B) {
    globalOnce.Do(initFn) // warm
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        globalOnce.Do(initFn)
    }
}

var onceFn = sync.OnceFunc(initFn)

func BenchmarkOnceFunc(b *testing.B) {
    onceFn() // warm
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        onceFn()
    }
}

var onceVal = sync.OnceValue(func() int { return 42 })

func BenchmarkOnceValue(b *testing.B) {
    _ = onceVal() // warm
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = onceVal()
    }
}
```

Representative numbers on an M1 / Go 1.22 (`go test -bench . -benchmem`):

```
BenchmarkSyncOnce-8     1000000000   0.85 ns/op   0 B/op   0 allocs/op
BenchmarkOnceFunc-8      733000000   1.62 ns/op   0 B/op   0 allocs/op
BenchmarkOnceValue-8     680000000   1.78 ns/op   0 B/op   0 allocs/op
```

Two observations: (1) the fast path is sub-2 ns for all three, (2) `OnceFunc` is roughly twice as slow as raw `Once.Do`, but the absolute gap is under a nanosecond — far below the cost of essentially any real workload that would be wrapped in a `Once`.

## When the gap matters

It matters if you call the wrapper at extreme rates with nothing else going on. A request handler that calls `cfg := load()` once per request, where `load = sync.OnceValue(...)`, is fine. A tight inner loop that calls `cached()` a billion times per second is also fine — the cost is ~2 seconds of CPU across that billion calls.

It would *not* be fine if you constructed the wrapper inside a hot function:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    initOnce := sync.OnceFunc(setup) // BUG: per-call alloc
    initOnce()
    // ...
}
```

This allocates 64+ bytes per request and re-runs `setup` every request (because each wrapper is independent). The fix is structural, not micro — hoist the wrapper out of the function.

## Micro-optimization: prefer `OnceValue[*T]` over `OnceValue[T]` for big T

`OnceValue[T]` stores the captured value by value inside the closure and returns a copy on every call. If `T` is large (say a `Config` struct with many fields), every call copies the struct. Switch to `*T`:

```go
// Avoid:
var load = sync.OnceValue(func() Config { return mustLoad() })

// Prefer:
var load = sync.OnceValue(func() *Config {
    c := mustLoad()
    return &c
})
```

The pointer version returns 8 bytes per call instead of `unsafe.Sizeof(Config{})`. The trade is that callers now share a pointer, so they must not mutate the returned value — usually fine, but document it.

## Trade-off vs hand-rolled sync.Once

If you have measured that the OnceFunc allocations matter (you almost certainly haven't), the alternative is the classic hand-roll:

```go
var (
    once sync.Once
    cfg  *Config
    err  error
)

func Load() (*Config, error) {
    once.Do(func() {
        cfg, err = parseConfig()
    })
    return cfg, err
}
```

This pays zero allocations and loses the panic-reuse contract. For production-grade init code the contract is worth more than the allocation. For something like a `metrics.Init()` that fires once at process start and is called from a single goroutine, the hand-roll is fine.

## Don't reach for atomic.Bool

A common "optimization" — replacing `sync.Once` with `atomic.Bool` + `CompareAndSwap` — looks faster but is buggy in general: it lets the second caller proceed before the first has finished its initialization. `sync.Once.Do` *and* `sync.OnceFunc` both guarantee happens-before from `f`'s completion to every later return. The atomic flag doesn't. Don't substitute it.

## Decision rule

- Default: use `OnceFunc`/`OnceValue`/`OnceValues`. Readability and panic-reuse win.
- If profiling shows the wrapper allocation in your hot init path (it won't), fall back to hand-rolled `sync.Once`.
- Never put `sync.OnceFunc(...)` inside a function that runs more than once.
- For very-hot-path internal caches that are not "initialization" but "memoization with possible refresh", you want a different primitive entirely — `singleflight.Group` or an explicit mutex-protected map.

## Construction-time allocation: measured

```go
package once_bench

import (
    "sync"
    "testing"
)

func BenchmarkConstruct_OnceFunc(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = sync.OnceFunc(func() {})
    }
}

func BenchmarkConstruct_OnceValue(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = sync.OnceValue(func() int { return 0 })
    }
}

func BenchmarkConstruct_OnceValues(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = sync.OnceValues(func() (int, error) { return 0, nil })
    }
}
```

Representative results (Go 1.22, M1, `-benchmem`):

```
BenchmarkConstruct_OnceFunc-8     16000000   72 ns/op   96 B/op   2 allocs/op
BenchmarkConstruct_OnceValue-8    14000000   85 ns/op   112 B/op  2 allocs/op
BenchmarkConstruct_OnceValues-8   12000000   95 ns/op   128 B/op  2 allocs/op
```

A wrapper costs roughly 100–130 bytes and two allocations. For a process that builds dozens or hundreds of these at startup, the total is a few kilobytes — negligible. For a process that builds them inside a hot function, the cost is allocations-per-call, which *does* show up in a profile.

## Decision: when to migrate from sync.Once

If your codebase has many existing `sync.Once`-based loaders, should you migrate? The answer is rarely "do a sweep". The answer is usually:

- During incidental file edits: switch.
- For files that have ever had a panic-in-initializer bug: switch.
- Greenfield code: use the helpers by default.
- Never migrate just for performance — the difference is sub-nanosecond per call.

## Hot path: when the per-call cost matters

The wrapper adds roughly 1 ns per call. If your hot path calls the wrapper a billion times per second (which is essentially impossible on a single core — that's the bandwidth of an L1 cache hit), you'd pay about 1 second of CPU per second across the call. In practice, even very hot paths that go through a lazy accessor do not approach this rate, because the work after the accessor dominates.

For comparison: a `sync/atomic.LoadPointer` is also about 1 ns. So the wrapper has roughly the cost of a single atomic load — paid in a context where you would already be doing real work.

The only place I've seen the cost meaningfully appear in a profile is when someone calls the wrapper from inside a *tight loop* (millions of iterations) and the loop body does nothing else. In that case, hoist the wrapper outside the loop:

```go
// Slow:
for _, x := range items {
    result := getCached().Process(x)
    // ...
}

// Fast:
cache := getCached()
for _, x := range items {
    result := cache.Process(x)
    // ...
}
```

This is just basic loop-invariant code motion; it applies equally to any function call, not specifically to `sync.OnceValue`.

## OnceValue[*T] vs OnceValue[T] for large structs: measured

A 1 KiB struct:

```go
type Big struct{ data [1024]byte }

var getByValue = sync.OnceValue(func() Big { return Big{} })
var getByPointer = sync.OnceValue(func() *Big { return &Big{} })

func BenchmarkByValue(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = getByValue()
    }
}

func BenchmarkByPointer(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = getByPointer()
    }
}
```

Results:

```
BenchmarkByValue-8       80000000    20 ns/op    1024 B/op   1 allocs/op
BenchmarkByPointer-8    700000000     1.7 ns/op     0 B/op   0 allocs/op
```

Returning a 1 KiB struct by value forces a copy (and on most paths an escape to the heap). Returning a pointer is essentially free. For any non-trivial type, default to the pointer form unless you have a specific reason to need value semantics.

## Where the wrapper *cannot* be cheaper

The fundamental cost is "one atomic load to check the fast path". You cannot get below that without dropping the concurrency guarantee. Atomic-Bool-only schemes that skip the mutex (`atomic.Bool.CompareAndSwap` plus a write to a value field) are broken: they don't synchronize the value write with the value read. The fast path of `sync.Once` is the minimum-cost correct implementation.

If your hot path *cannot* pay even one atomic load — say, a single-threaded inner loop — eliminate the indirection entirely:

```go
// Single-threaded: just compute and reuse a local.
cfg := loadConfig()
for _, x := range items {
    process(cfg, x)
}
```

This is faster than any wrapper (zero atomics, zero indirect calls) but only works if you can prove there's no concurrent access.

## Final summary

- The wrapper costs ~1.5 ns per call after the first, against ~0.85 ns for raw `sync.Once.Do`. The gap is real but rarely matters.
- Construction allocates ~100 bytes. Trivial at program start; significant only if you allocate wrappers inside a hot function (don't).
- For `OnceValue[T]`, prefer `*T` for non-trivial types to avoid per-call copies.
- Never substitute raw atomics — they break the happens-before guarantee.
- Profile before optimizing. The cost is well below the noise floor of essentially any real workload.

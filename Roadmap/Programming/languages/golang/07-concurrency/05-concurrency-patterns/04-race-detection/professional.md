# Race Detection — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Production Case Study: Hidden Race in a Cache](#production-case-study-hidden-race-in-a-cache)
3. [Production Case Study: Atomic Misuse in Config Reload](#production-case-study-atomic-misuse-in-config-reload)
4. [Production Case Study: Sharded Counter Migration](#production-case-study-sharded-counter-migration)
5. [Race-Free Design Patterns](#race-free-design-patterns)
6. [`sync.Map` vs `map+Mutex`](#syncmap-vs-mapmutex)
7. [Lock-Free Queues in Practice](#lock-free-queues-in-practice)
8. [CI Discipline at Scale](#ci-discipline-at-scale)
9. [Stress Testing](#stress-testing)
10. [Migration: Mutex → Atomic](#migration-mutex-atomic)
11. [Diagnosing Production Races](#diagnosing-production-races)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)

---

## Introduction

Professional race work happens at the system level: designing data structures so races are impossible, integrating `-race` into a multi-stage CI, sharding hot counters, and diagnosing production-only race symptoms. This file is case-study driven.

---

## Production Case Study: Hidden Race in a Cache

A team had a cache with a "lazy invalidate" optimisation:

```go
type Cache struct {
    mu      sync.RWMutex
    data    map[string]Entry
    invalid bool
}

func (c *Cache) Get(k string) (Entry, bool) {
    if c.invalid { // intentionally racy "fast check"
        c.refresh()
    }
    c.mu.RLock()
    defer c.mu.RUnlock()
    e, ok := c.data[k]
    return e, ok
}
```

The author intentionally read `invalid` without the lock to avoid contention, planning that a stale read would just trigger an unnecessary refresh. Reasonable, *except*:

1. The Go memory model gives no visibility guarantee on `invalid` without synchronisation.
2. The `c.invalid` read could be reordered with respect to `c.refresh`, breaking the assumption.
3. CPUs can cache `invalid` indefinitely; the read may never see writes.

The race detector flagged it on the first CI run. The fix: `atomic.Bool` for `invalid`, with `Load` in the fast path and `Store(true)` from invalidators.

Lesson: "I know this is racy but it's fine" is almost always wrong. The detector exists because human intuition about concurrency is unreliable.

---

## Production Case Study: Atomic Misuse in Config Reload

A service had:

```go
var cfg *Config
var cfgVer int64

func Reload(c *Config) {
    cfg = c
    atomic.AddInt64(&cfgVer, 1)
}

func Get() *Config { return cfg }
```

Intent: increment version atomically, swap config. *Race*: `cfg = c` is a non-atomic write to a pointer; concurrent readers may see a torn value or stale pointer.

Worse: even if `cfg = c` were atomic, the version increment is *after* the assignment. Without a memory barrier, a reader could see the old `cfg` and the new `cfgVer`, breaking any version-based cache invalidation.

Fix: `atomic.Pointer[Config]`:

```go
var cfg atomic.Pointer[Config]

func Reload(c *Config) { cfg.Store(c) }
func Get() *Config     { return cfg.Load() }
```

The atomic Store is sequentially consistent. Readers see a complete pointer. No version counter needed; the pointer itself is the version.

---

## Production Case Study: Sharded Counter Migration

A metrics library exported per-request counters. Profiling showed `atomic.AddInt64` on a single hot counter was ~30% of CPU during peak. Cache-line contention.

Solution: a 16-shard counter.

```go
type Counter struct {
    shards [16]atomic.Int64
    _      [48]byte // padding to next cache line for first shard
}

func (c *Counter) Add(delta int64) {
    idx := goroutineID() & 15
    c.shards[idx].Add(delta)
}

func (c *Counter) Value() int64 {
    var sum int64
    for i := range c.shards {
        sum += c.shards[i].Load()
    }
    return sum
}
```

Before: 6M ops/sec, 30% CPU spent in `atomic.Add`.
After: 80M ops/sec, ~5% CPU spent in `atomic.Add`.

`Value()` is now O(16) instead of O(1), but it is called rarely (every 10s for Prometheus scrape).

Critical detail: the padding. Without `_ [48]byte`, two shards may share a cache line, and the contention returns. Use the `runtime/internal` cache-line size constant (64 on x86) or test on your target hardware.

---

## Race-Free Design Patterns

### Confinement
Don't share. A goroutine owns its data; values flow through channels. The channel send creates a happens-before edge, transferring ownership.

### Immutable snapshots
A struct, once published via `atomic.Pointer`, is never modified. Updaters create a new struct and swap the pointer. Readers are lock-free.

### Per-goroutine state
Each goroutine has its own scratch space (e.g., a per-worker buffer). Aggregate at the end via channels.

### Single-writer principle
At most one goroutine writes to a given location. Multiple readers are fine.

### Sharding
Distribute hot writes across N independent locations.

### Copy-on-write maps
Treat the map as immutable. Updaters create a new map with the change and `atomic.Pointer` swap.

These patterns avoid races by construction. The detector's job becomes finding the rare case where the design was violated.

---

## `sync.Map` vs `map+Mutex`

`sync.Map` is optimised for two specific access patterns:

1. Each key is written once and read many times.
2. Multiple goroutines read, write, and overwrite disjoint sets of keys.

For these patterns it is faster than `map+RWMutex` because it avoids contention on a single mutex.

For other patterns (uniform read/write mix, frequent overwrite of the same keys), it is slower because of internal copying.

Benchmarks tell the truth. The library docs are honest about its niche; do not use `sync.Map` as a default.

A simple decision tree:

| Pattern | Choice |
|---------|--------|
| Read-mostly, occasional write | `sync.Map` or `atomic.Pointer[map]` snapshot |
| Balanced read/write | `map + sync.RWMutex` |
| Write-heavy, single-writer | `map + sync.Mutex` |
| Append-only by key | shard then `map + Mutex` per shard |

---

## Lock-Free Queues in Practice

True lock-free queues (e.g., Michael-Scott) are rarely necessary in Go because channels handle most cases at high throughput. When you do need them:

- Use a battle-tested library: `github.com/Workiva/go-datastructures/queue` or `github.com/yireyun/go-queue`.
- Verify under `-race` and stress tests.
- Profile under realistic load — lock-free isn't always faster than mutex-based for moderate contention.

A reasonable rule: prefer channels until profiling proves them inadequate. Then prefer a vetted library over hand-rolled CAS code.

---

## CI Discipline at Scale

Large teams often see CI race tests as a chore. Treat them as a first-class deliverable:

- **Required PR check**: cannot merge if `go test -race ./...` fails.
- **Per-package timeouts**: don't let a stuck test hide a race detector report.
- **Matrix CPU**: `-cpu=1,4,8`. Catches scheduling-dependent races.
- **Iteration count**: `-count=3` per PR; `-count=200` nightly.
- **Quarantine queue**: known-flaky tests are quarantined and triaged within a week.
- **Race-budget**: a team owns each package; race reports are bugs assigned automatically.

Integrate with `staticcheck`, `goleak`, `errcheck` for a wider net.

---

## Stress Testing

A stress test:

1. Runs the suspect code path under `-race`.
2. Iterates many times (`-count=1000`).
3. Varies CPU count (`-cpu=1,4,8`).
4. Uses random schedulers if possible.
5. Logs goroutine state on failure.

Example:

```go
func TestCacheStress(t *testing.T) {
    if testing.Short() {
        t.Skip()
    }
    c := NewCache()
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            for j := 0; j < 10000; j++ {
                key := fmt.Sprintf("k%d", j%100)
                if j%2 == 0 { c.Set(key, j) } else { c.Get(key) }
            }
        }(i)
    }
    wg.Wait()
}
```

Run: `go test -race -count=20 -cpu=1,4,8 -run TestCacheStress`.

Stress tests are slower; tag them with `-short` so quick CI skips them but nightly CI runs them.

---

## Migration: Mutex → Atomic

A common refactor: replace a `sync.Mutex` around an int with an `atomic.Int64`.

Before:

```go
type Stats struct {
    mu     sync.Mutex
    count  int
}

func (s *Stats) Inc() { s.mu.Lock(); s.count++; s.mu.Unlock() }
func (s *Stats) Get() int { s.mu.Lock(); defer s.mu.Unlock(); return s.count }
```

After:

```go
type Stats struct {
    count atomic.Int64
}

func (s *Stats) Inc() { s.count.Add(1) }
func (s *Stats) Get() int64 { return s.count.Load() }
```

Faster, simpler, less contention. But:

- Only works for *single-field* updates.
- If `Stats` later gains a second field that must be consistent with `count`, you cannot atomically update both with atomics; revert to mutex.

A common pitfall: starting with atomic, growing the struct, forgetting to revert. The detector catches the inconsistency once the second field is added; trust the detector.

---

## Diagnosing Production Races

A race that does not appear under `-race` but causes intermittent production bugs is the worst case. Steps:

1. Reproduce in test. Collect the suspect call paths.
2. Add `-race` to a staging run. Some races appear under load.
3. Add `-race` to a stress test specifically targeting the call path.
4. Inspect with `go tool trace` to see goroutine interactions.
5. Use `pprof` to see lock contention on suspect mutexes.
6. Review code with the formal memory model in mind. Identify every shared variable and the happens-before edge protecting it.

Production races usually come from *implicit* sharing: a closure captures a variable, a global reuses memory, a logger formats a struct field while another goroutine writes it.

Audit for these systematically. A senior engineer's checklist:

- Loop variables captured by goroutines.
- Globals written after init.
- Map fields in shared structs.
- Slices passed by value (header is copied; backing array is shared).
- Loggers, metrics, and tracers reading struct fields.

---

## Cheat Sheet

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Counter wrong | Non-atomic increment | `atomic.Add` |
| Map panic | Concurrent map read/write | `RWMutex` or `sync.Map` |
| Stale config | Plain pointer assignment | `atomic.Pointer[T]` |
| Hot atomic dominates CPU | Cache-line contention | Sharded atomic |
| Loop-var bug | Captured `i` in closure | `i := i` shadow |

CI matrix: `-race -count=3 -cpu=1,4,8` per PR; `-count=200` nightly.

Production audits: run `-race` in staging, `go tool trace` for hard cases.

---

## Summary

Professional race work is system design plus operational discipline. Build data structures that are race-free by construction (atomic snapshots, per-goroutine state, sharded counters). Integrate `-race` into a CI matrix that varies CPU and iteration count. Migrate from mutex to atomic deliberately, with awareness that one-field atomics are not a general substitute. Diagnose production-only races by combining `-race` in staging, `pprof`, `go tool trace`, and structured audits of every shared variable. The detector is necessary; the design is sufficient.

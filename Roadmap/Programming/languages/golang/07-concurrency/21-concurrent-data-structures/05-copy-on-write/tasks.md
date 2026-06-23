---
layout: default
title: Tasks
parent: Copy-on-Write
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/05-copy-on-write/tasks/
---

# Copy-on-Write — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions or solution sketches are at the end.

---

## Easy

### Task 1 — First COW config

Write a `Config` struct with a `LogLevel` field and a `Store` type using `atomic.Pointer[Config]`. Implement `Get()` and `SetLogLevel(string)` methods. Verify with a test that the level changes are visible to subsequent `Get` calls.

- Use a writer mutex.
- Initialize with `LogLevel: "info"`.

**Goal.** Learn the basic load-copy-publish pattern.

---

### Task 2 — Snapshot consistency

Add a `Timeout time.Duration` field to `Config`. Implement `SetTimeout` and a combined `SetLevelAndTimeout` method. Show that a reader who Loads once sees both fields consistent.

- One Load per logical operation.
- Combined update is one publish.

**Goal.** Understand snapshot consistency for multi-field reads.

---

### Task 3 — Slice deep copy

Add a `Hosts []string` field. Implement `AddHost(string)`. Make sure the new snapshot has a fresh backing array — don't append in place.

- `next.Hosts = append([]string(nil), old.Hosts...)`
- Run with `-race` to verify no race.

**Goal.** Internalise the slice deep-copy rule.

---

### Task 4 — Map deep copy

Add a `Features map[string]bool` field. Implement `SetFeature(name string, on bool)`. Make sure the new snapshot has a fresh map — don't mutate the old one.

- `next.Features = make(map[string]bool, len(old.Features))`
- Copy entries then update.

**Goal.** Internalise the map deep-copy rule.

---

### Task 5 — Concurrent torture test

Write a test that spawns 100 readers and 10 writers, each looping for 1 second. Run with `-race`. Verify no race detected and the final state is consistent (e.g., the number of unique hosts added matches what writers added).

**Goal.** Learn to torture-test concurrent code.

---

## Medium

### Task 6 — Validation before publish

Add a `MaxRetries int` field with constraint `0 <= MaxRetries <= 100`. Implement `SetMaxRetries(int) error` that returns an error if out of range and does not publish.

- Verify with a test that an invalid update preserves the old snapshot.

**Goal.** Master "validate before publish."

---

### Task 7 — Generic Store

Refactor your Store into a generic `Store[T any]` that takes an `Update(fn func(*T))` method. Use it with at least two different types.

- The library can't enforce deep-copy of inner slices/maps; document this.

**Goal.** Practice generic COW patterns.

---

### Task 8 — Subscriber channel

Add a `Subscribe() (<-chan *Config, func())` method. Writers should non-blocking-send the new snapshot to each subscriber. Returned function unsubscribes.

- Verify subscribers receive updates and unsubscribe cleans up.

**Goal.** Implement watcher notifications.

---

### Task 9 — Hot reload from file

Write a `Reload(path string) error` method that reads JSON from a file, parses into Config, validates, and publishes. On error, the old snapshot remains current.

- Test with a deliberately bad file.

**Goal.** Implement production-style reload.

---

### Task 10 — SIGHUP handler

Add a goroutine that listens for SIGHUP and calls `Reload`. Demonstrate from a separate terminal: edit config file, send SIGHUP, observe change.

```bash
kill -HUP $(pgrep your_program)
```

**Goal.** Integrate COW with operating system signals.

---

### Task 11 — Version tagging

Add a `Version int64` field. Increment monotonically on every publish. Expose `Version()` separately. Allow optimistic concurrency via `CompareAndSet(expectedVersion, fn)`.

**Goal.** Implement versioned snapshots.

---

### Task 12 — Snapshot age metric

Add `PublishedAt time.Time` field. Implement `Age() time.Duration`. Emit `expvar.Func` so `/debug/vars` shows current age.

**Goal.** Add basic observability.

---

## Hard

### Task 13 — Sharded COW map

Implement a `ShardedMap[K comparable, V any]` with 16 shards, each its own atomic.Pointer + mutex. Implement Get, Set, Delete, Len (sum across shards). Benchmark write throughput vs single-shard.

- Use a fast hash to determine the shard.
- Demonstrate parallel writes scale linearly with shard count.

**Goal.** Practice sharded COW design.

---

### Task 14 — COW with rollback

Implement an `Update(fn func(*Config) error) error` that allows fn to return an error to abort the update. Show that aborted updates don't publish and the previous snapshot remains current.

**Goal.** Implement transactional-style updates.

---

### Task 15 — Snapshot diff

Add a `Diff(old, new *Config) Diff` that returns added, removed, and changed fields. Test that diffs are correctly computed for various field changes.

- Use `reflect` or write explicit code per field.

**Goal.** Build change-detection on top of COW.

---

### Task 16 — Persistent HAMT (simplified)

Implement a simplified persistent hash map with branching factor 4 (just for clarity). Wrap it in a COW store. Compare write costs against a plain rebuild map.

- 4-way branching makes the trees small enough to debug.
- Test that old versions remain valid after updates.

**Goal.** Understand structural sharing concretely.

---

### Task 17 — Batched writes

Implement a `BatchUpdate(fns []func(*Config))` that applies all updates in one rebuild. Compare GC pressure against N individual updates.

**Goal.** Reduce GC pressure for high write rates.

---

### Task 18 — Layered COW

Implement a `Layered` struct with `Base *Map` and `Override *Map`. Reads check Override first, then Base. Implement `Compact` that merges Override into Base. Demonstrate compaction reduces read latency over time.

**Goal.** Master generational COW.

---

### Task 19 — Snapshot replication across processes

Build a two-process system: process A holds the canonical config; process B reads it via HTTP. Each fetch returns the current snapshot. Demonstrate that B can update its local cache from A's fetches.

**Goal.** Apply COW to distributed systems.

---

### Task 20 — RCU-style with explicit reclamation

Implement a COW store where the old snapshot's `Close()` method is called when the last reader finishes. Use atomic counters; do not rely on the GC for reclamation timing.

**Goal.** Implement RCU semantics explicitly.

---

## Expert

### Task 21 — Bench COW vs RWMutex vs sync.Map

Write a comprehensive benchmark suite comparing COW (with atomic.Pointer), RWMutex, and sync.Map for:
- Pure reads.
- 90R/10W workloads.
- 50/50 workloads.
- 1K, 10K, 100K entry sizes.

Plot the results.

**Goal.** Develop benchmark intuition.

---

### Task 22 — COW with metrics exporter

Build a COW config store that exports Prometheus metrics:
- `config_version`.
- `config_age_seconds`.
- `config_updates_total`.
- `config_reload_failures_total`.

Demonstrate the dashboard updates as you reload.

**Goal.** Integrate COW with observability tooling.

---

### Task 23 — Lock-free CAS-based writer

Implement an `Update(fn func(*Config) *Config)` that uses CAS instead of a mutex. Show that under low contention it matches mutex performance; under high contention it suffers retries.

- `fn` must be idempotent and pure.

**Goal.** Practice lock-free programming.

---

### Task 24 — Snapshot serialization

Add `Marshal()` and `Unmarshal()` methods to Config. Use them to checkpoint snapshots to disk and reload on startup. Demonstrate crash recovery.

**Goal.** Combine COW with persistence.

---

### Task 25 — Production-grade COW package

Build a reusable Go package `github.com/yourname/cow` with:
- Typed `Store[T]`.
- Pluggable `Source` interface.
- Subscriber channels with backpressure handling.
- Metrics hooks.
- Documentation and examples.
- Race-detector-clean tests.
- Benchmarks.

Publish to GitHub. Get others to use it.

**Goal.** Build a real, shareable COW library.

---

## Bonus

### Task 26 — Find-the-bug

Look at the buggy code in `find-bug.md`. Identify each bug. Suggest fixes.

**Goal.** Sharpen bug-spotting reflexes.

---

### Task 27 — Optimize-the-pattern

Look at the slow code in `optimize.md`. Apply the suggested optimizations. Measure the improvement.

**Goal.** Apply optimization patterns.

---

### Task 28 — Implement Go's `atomic.Value` from scratch

Without looking at the source, implement an `atomic.Value` using `unsafe.Pointer` and atomic primitives. Match the type-consistency invariant. Compare against the standard library.

**Goal.** Understand `atomic.Value` deeply.

---

### Task 29 — Read the runtime source

Read `src/sync/atomic/type.go`, `src/runtime/internal/atomic/atomic_amd64.s`. Summarize what each file does in a paragraph.

**Goal.** Build comfort with the runtime.

---

### Task 30 — Write a postmortem

Imagine your COW system caused a production incident: 5 GB memory growth in 1 hour. Write a fictional postmortem identifying root cause, contributing factors, and mitigations.

**Goal.** Practice incident analysis.

---

## Solutions and Solution Sketches

### Solution to Task 1

```go
package config

import (
    "sync"
    "sync/atomic"
)

type Config struct {
    LogLevel string
}

type Store struct {
    cur atomic.Pointer[Config]
    mu  sync.Mutex
}

func New() *Store {
    s := &Store{}
    s.cur.Store(&Config{LogLevel: "info"})
    return s
}

func (s *Store) Get() *Config { return s.cur.Load() }

func (s *Store) SetLogLevel(level string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    old := s.cur.Load()
    next := *old
    next.LogLevel = level
    s.cur.Store(&next)
}
```

Test:
```go
func TestSetLogLevel(t *testing.T) {
    s := New()
    if s.Get().LogLevel != "info" { t.Fatal("initial") }
    s.SetLogLevel("debug")
    if s.Get().LogLevel != "debug" { t.Fatal("after set") }
}
```

### Solution to Task 3

```go
func (s *Store) AddHost(h string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    old := s.cur.Load()
    next := *old
    next.Hosts = append([]string(nil), old.Hosts...)
    next.Hosts = append(next.Hosts, h)
    s.cur.Store(&next)
}
```

Race-test:
```go
func TestRaceFreeAdd(t *testing.T) {
    s := New()
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); s.AddHost("x") }()
    }
    // concurrent readers
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); _ = len(s.Get().Hosts) }()
    }
    wg.Wait()
    if len(s.Get().Hosts) != 100 { t.Fatal("count") }
}
```

### Solution to Task 7

```go
type Store[T any] struct {
    cur atomic.Pointer[T]
    mu  sync.Mutex
}

func New[T any](initial *T) *Store[T] {
    s := &Store[T]{}
    s.cur.Store(initial)
    return s
}

func (s *Store[T]) Get() *T { return s.cur.Load() }

func (s *Store[T]) Update(fn func(*T)) {
    s.mu.Lock()
    defer s.mu.Unlock()
    old := s.cur.Load()
    next := *old
    fn(&next)
    s.cur.Store(&next)
}
```

Use with multiple types:
```go
type Config struct{ X int }
type Counters struct{ N int64 }

func main() {
    cs := New(&Config{X: 1})
    cs.Update(func(c *Config) { c.X = 2 })

    cn := New(&Counters{N: 0})
    cn.Update(func(c *Counters) { c.N++ })
}
```

### Solution to Task 8

```go
type Store[T any] struct {
    cur   atomic.Pointer[T]
    mu    sync.Mutex
    chans []chan *T
}

func (s *Store[T]) Subscribe() (<-chan *T, func()) {
    ch := make(chan *T, 1)
    s.mu.Lock()
    s.chans = append(s.chans, ch)
    s.mu.Unlock()
    unsub := func() {
        s.mu.Lock()
        defer s.mu.Unlock()
        for i, c := range s.chans {
            if c == ch {
                s.chans = append(s.chans[:i], s.chans[i+1:]...)
                close(ch)
                return
            }
        }
    }
    return ch, unsub
}

func (s *Store[T]) Update(fn func(*T)) {
    s.mu.Lock()
    defer s.mu.Unlock()
    old := s.cur.Load()
    next := *old
    fn(&next)
    s.cur.Store(&next)
    for _, ch := range s.chans {
        select { case ch <- &next: default: }
    }
}
```

### Solution to Task 13

```go
const NShards = 16

type ShardedMap[K comparable, V any] struct {
    shards [NShards]struct {
        cur atomic.Pointer[map[K]V]
        mu  sync.Mutex
    }
}

func NewShardedMap[K comparable, V any]() *ShardedMap[K, V] {
    s := &ShardedMap[K, V]{}
    for i := range s.shards {
        m := make(map[K]V)
        s.shards[i].cur.Store(&m)
    }
    return s
}

func (s *ShardedMap[K, V]) shardFor(k K) int {
    h := fnv.New32()
    h.Write([]byte(fmt.Sprint(k)))
    return int(h.Sum32()) % NShards
}

func (s *ShardedMap[K, V]) Get(k K) (V, bool) {
    v, ok := (*s.shards[s.shardFor(k)].cur.Load())[k]
    return v, ok
}

func (s *ShardedMap[K, V]) Set(k K, v V) {
    sh := &s.shards[s.shardFor(k)]
    sh.mu.Lock()
    defer sh.mu.Unlock()
    old := *sh.cur.Load()
    next := make(map[K]V, len(old)+1)
    for kk, vv := range old { next[kk] = vv }
    next[k] = v
    sh.cur.Store(&next)
}
```

Benchmark shows ~16× write throughput improvement vs single-shard for parallel writes.

### Solution to Task 17

```go
func (s *Store[T]) BatchUpdate(fns []func(*T)) {
    s.mu.Lock()
    defer s.mu.Unlock()
    old := s.cur.Load()
    next := *old
    for _, fn := range fns {
        fn(&next)
    }
    s.cur.Store(&next)
}
```

One allocation per batch, regardless of batch size. With 100 updates per batch, GC pressure reduced ~100×.

### Solution to Task 23

```go
func (s *Store[T]) UpdateCAS(fn func(*T) *T) {
    for {
        old := s.cur.Load()
        next := fn(old)
        if s.cur.CompareAndSwap(old, next) {
            return
        }
    }
}
```

Note: `fn` must be pure — it may run multiple times. It should not modify `old`.

---

## Solution to Task 16 (Simplified HAMT)

```go
type SimpleHAMT struct {
    children [4]any // either *SimpleHAMT or *kv
    bitmap   uint8
}

type kv struct {
    key  string
    val  any
}

func (h *SimpleHAMT) Get(key string) (any, bool) {
    return h.get(hashSimple(key), 0, key)
}

func (h *SimpleHAMT) get(hash uint32, level uint, key string) (any, bool) {
    if h == nil { return nil, false }
    idx := (hash >> (level * 2)) & 0b11
    bit := uint8(1) << idx
    if h.bitmap&bit == 0 { return nil, false }
    pos := popcount8(h.bitmap & (bit - 1))
    child := h.children[pos]
    if e, ok := child.(*kv); ok {
        if e.key == key { return e.val, true }
        return nil, false
    }
    return child.(*SimpleHAMT).get(hash, level+1, key)
}

// ... Set, Delete similarly
```

A 4-way branching keeps trees small and easy to visualize.

---

## Tips for Working Through Tasks

1. **Start with the easy tasks.** Even if they look trivial, they build muscle memory.
2. **Run with -race always.** Catch bugs early.
3. **Add a test for every method.** Tests are documentation.
4. **Benchmark when measuring.** Numbers > opinions.
5. **Pair with someone if stuck.** Two heads on COW bugs is dramatically more efficient.
6. **Read your code aloud.** Bug-finding often happens when you explain code to a rubber duck.

---

## Closing

These 30 tasks span the full COW curriculum. Working through 10-15 of them builds the skills described in the four levels. Working through all 30 makes you a COW expert.

Pick a few that interest you and start coding. The learning is in the doing.

Good luck.

---
layout: default
title: Decision Tree — Professional
parent: Decision Tree
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/04-decision-tree/professional/
---

# Decision Tree — Professional

[← Back](../)

The decision tree as a textbook exercise is one thing; the decision tree as the actual sequence of refactors that improved a real production codebase is another. The pattern that emerges from postmortems is consistent. The original author of a concurrent component picked a primitive that worked. The component grew. The choice that was acceptable at one writer and ten readers per second became a bottleneck at a hundred writers and a million readers. The fix was almost always to *demote* the primitive to a lighter one — channel → atomic, mutex → atomic.Pointer, sync.Cond → channel close — not to introduce a heavier one. The cases below trace that demotion.

## Case 1 — A telemetry pipeline collapses chan-of-1 into a mutex, then into an atomic.Pointer

A telemetry service maintains a sampling rate that the operator can change at runtime. The first version used a "configuration goroutine" that received new rates from a channel:

```go
type Sampler struct {
    updates chan float64
    rate    float64
}

func (s *Sampler) Run(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case r := <-s.updates:
            s.rate = r
        }
    }
}

func (s *Sampler) Update(r float64) { s.updates <- r }
func (s *Sampler) ShouldSample() bool {
    return rand.Float64() < s.rate
}
```

Two problems. First, `ShouldSample` reads `s.rate` without synchronization — a race that the race detector catches the first time someone runs the test suite under `-race`. Second, the goroutine adds a lifetime concern (when does it exit? what if `Update` is called after the context is cancelled?) that contributes nothing.

The first refactor introduced a mutex:

```go
type Sampler struct {
    mu   sync.Mutex
    rate float64
}

func (s *Sampler) Update(r float64) {
    s.mu.Lock()
    s.rate = r
    s.mu.Unlock()
}

func (s *Sampler) ShouldSample() bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    return rand.Float64() < s.rate
}
```

Correct, but `ShouldSample` is called on every request — millions of times per second across the service fleet. The mutex serializes all those calls through a single hot cache line. Profiling showed `sync.(*Mutex).Lock` as the #1 CPU consumer in the binary.

The final form uses `atomic.Pointer[float64]`:

```go
type Sampler struct {
    rate atomic.Pointer[float64]
}

func NewSampler(initial float64) *Sampler {
    s := &Sampler{}
    s.rate.Store(&initial)
    return s
}

func (s *Sampler) Update(r float64) { s.rate.Store(&r) }
func (s *Sampler) ShouldSample() bool {
    return rand.Float64() < *s.rate.Load()
}
```

(In Go 1.19+, `atomic.Uint64` storing math.Float64bits would be even cheaper since it avoids the allocation per `Update`. The pointer form is still fine because `Update` is rare.)

Three refactors, each one removing complexity:

1. Channel + goroutine → mutex: removed the goroutine lifecycle.
2. Mutex → atomic.Pointer: removed serialization on the hot read path.

The lesson is not "atomic.Pointer is always better than mutex." It is "the read/write ratio is the deciding factor, and you should be willing to revisit the primitive choice as that ratio changes."

## Case 2 — Rewriting a sync.Cond as a channel

A job scheduler had a worker pool that consumed jobs from a priority heap. The original implementation used a mutex and a `sync.Cond`:

```go
type Scheduler struct {
    mu     sync.Mutex
    cond   *sync.Cond
    heap   jobHeap
    closed bool
}

func (s *Scheduler) Push(j Job) {
    s.mu.Lock()
    heap.Push(&s.heap, j)
    s.mu.Unlock()
    s.cond.Signal()
}

func (s *Scheduler) Pop() (Job, bool) {
    s.mu.Lock()
    defer s.mu.Unlock()
    for len(s.heap) == 0 && !s.closed {
        s.cond.Wait()
    }
    if s.closed && len(s.heap) == 0 {
        return Job{}, false
    }
    return heap.Pop(&s.heap).(Job), true
}

func (s *Scheduler) Close() {
    s.mu.Lock()
    s.closed = true
    s.mu.Unlock()
    s.cond.Broadcast()
}
```

This is *correct* Cond use: the heap requires the mutex, the predicate (`len(heap) > 0 || closed`) is re-checked after each wakeup, and the set of waiters is dynamic. So why rewrite it?

The reason was a deployment incident. A pull request added a context to `Pop`:

```go
func (s *Scheduler) Pop(ctx context.Context) (Job, bool, error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    for len(s.heap) == 0 && !s.closed {
        // How do we cancel from here?
        s.cond.Wait()
    }
    // ...
}
```

The author tried to add context cancellation. `sync.Cond.Wait` does not take a context. The "right" solution is a separate goroutine that calls `Broadcast` when the context is cancelled — but that adds a goroutine per `Pop` call, plus a synchronization between the cancellation goroutine and the wakeup path. The PR was abandoned and the team replaced the Cond with a channel-based scheduler:

```go
type Scheduler struct {
    jobs chan Job // priority is lost, but jobs is itself FIFO of pre-prioritized items
    done chan struct{}
}

// Inserter goroutine: receives unprioritized jobs, sorts by priority,
// emits to s.jobs in priority order.
func (s *Scheduler) Insert(j Job) error {
    select {
    case s.inbox <- j:
        return nil
    case <-s.done:
        return errors.New("closed")
    }
}

func (s *Scheduler) Pop(ctx context.Context) (Job, error) {
    select {
    case j := <-s.jobs:
        return j, nil
    case <-ctx.Done():
        return Job{}, ctx.Err()
    case <-s.done:
        return Job{}, errors.New("closed")
    }
}
```

The architecture changed — priority is now maintained by a dedicated goroutine that consumes from an inbox channel, sorts, and re-emits — but the consumer side is now trivially context-aware. Three select cases, no Cond, no manual broadcast.

The lesson: `sync.Cond` is correct for "dynamic set of waiters with per-waiter predicate," but the moment you need to combine that with `context.Context`, the channel form wins because `select` composes with `ctx.Done()` and `sync.Cond.Wait` does not.

## Case 3 — Collapsing mutex+atomic into atomic.Pointer

A connection pool tracked statistics: active connection count, idle count, last-used timestamp. The original code had:

```go
type Pool struct {
    mu         sync.Mutex
    activeConn int
    idleConn   int
    lastUsed   atomic.Int64 // unix nanos
}

func (p *Pool) Acquire() *Conn {
    p.mu.Lock()
    p.activeConn++
    p.idleConn--
    p.mu.Unlock()
    p.lastUsed.Store(time.Now().UnixNano())
    return /* ... */
}

func (p *Pool) Stats() Stats {
    p.mu.Lock()
    a, i := p.activeConn, p.idleConn
    p.mu.Unlock()
    return Stats{
        Active:   a,
        Idle:     i,
        LastUsed: time.Unix(0, p.lastUsed.Load()),
    }
}
```

Two issues:

1. The `Stats` snapshot can return `Active = 10, Idle = 5, LastUsed = (timestamp from 3 acquires ago)`. The timestamp is not synchronized with the counts.
2. Mixing primitives confuses the maintenance reader: is `lastUsed` part of the same logical state as `activeConn`/`idleConn`, or not?

The refactor collapsed everything into one atomic.Pointer:

```go
type stats struct {
    active   int
    idle     int
    lastUsed time.Time
}

type Pool struct {
    stats atomic.Pointer[stats]
}

func (p *Pool) Acquire() *Conn {
    for {
        old := p.stats.Load()
        next := stats{
            active:   old.active + 1,
            idle:     old.idle - 1,
            lastUsed: time.Now(),
        }
        if p.stats.CompareAndSwap(old, &next) {
            break
        }
    }
    return /* ... */
}

func (p *Pool) Stats() Stats {
    s := p.stats.Load()
    return Stats{Active: s.active, Idle: s.idle, LastUsed: s.lastUsed}
}
```

`Stats` is now a single atomic load returning a self-consistent snapshot. The CAS loop in `Acquire` runs at most a few times under contention.

When is this *not* the right refactor? When the write path is hot. The CAS loop allocates a new `stats` struct on every update; at high write rates the GC pressure becomes the bottleneck. A telemetry counter updated millions of times per second should not use this pattern; it should use sharded atomics with periodic aggregation.

## Case 4 — A buffered channel as the wrong queue

A request batcher accumulated outgoing requests and flushed them every 50 ms or every 100 items, whichever came first. The original:

```go
type Batcher struct {
    incoming chan Request
}

func (b *Batcher) Run(ctx context.Context) {
    batch := make([]Request, 0, 100)
    ticker := time.NewTicker(50 * time.Millisecond)
    defer ticker.Stop()

    for {
        select {
        case <-ctx.Done():
            return
        case r := <-b.incoming:
            batch = append(batch, r)
            if len(batch) >= 100 {
                flush(batch)
                batch = batch[:0]
            }
        case <-ticker.C:
            if len(batch) > 0 {
                flush(batch)
                batch = batch[:0]
            }
        }
    }
}

func (b *Batcher) Submit(r Request) { b.incoming <- r }
```

This works. Under load, `b.incoming` (capacity say 1000) eventually fills and `Submit` blocks. That is the intended back-pressure. The bug only appeared in a different scenario: when downstream went slow, requests piled up in the channel, and *callers* were blocked indefinitely. The right behavior was to drop with a metric, not block.

The fix was to keep the channel but make `Submit` non-blocking:

```go
func (b *Batcher) Submit(r Request) bool {
    select {
    case b.incoming <- r:
        return true
    default:
        b.dropped.Add(1)
        return false
    }
}
```

The interesting part is what *did not* change: the channel itself was still the right primitive. It was the *semantics around* the channel that needed to change. This is a recurring shape in production review: the data structure is correct, the API around it is wrong.

## Case 5 — sync.Map replaced by sharded map+RWMutex

A routing table for an API gateway used `sync.Map`. The team had read "sync.Map is faster than map+mutex" somewhere and assumed it always wins. The actual workload:

- 10,000 keys (route paths).
- ~100,000 reads/sec, distributed across all keys.
- ~10 writes/sec (route table reloads).
- Routes for the *same paths* get rewritten on each reload.

The `sync.Map` documentation says it is optimized for "(1) when the entry for a given key is only ever written once but read many times" or "(2) when multiple goroutines read, write, and overwrite entries for disjoint sets of keys." The routing table fits neither case — the same keys are overwritten on every reload.

Profiling under load showed `sync.Map.Load` allocating on the slow path (when the read-only map was "amended"). Allocation per request × 100K reads/sec = a steady stream of garbage that bumped GC frequency.

The replacement used `atomic.Pointer[map[string]*Route]`:

```go
var routes atomic.Pointer[map[string]*Route]

func Lookup(path string) (*Route, bool) {
    m := *routes.Load()
    r, ok := m[path]
    return r, ok
}

func Reload(newRoutes map[string]*Route) {
    routes.Store(&newRoutes)
}
```

Lookup is now one atomic load and one map lookup. The map is immutable (treated as read-only after `Store`), so no mutex is needed. Reloads cost an O(n) copy — irrelevant at 10/sec.

Benchmark result: 88 ns/op (sync.Map) → 41 ns/op (atomic.Pointer). GC frequency dropped because the read path no longer allocated.

The lesson is in the godoc: `sync.Map` lists its preferred use cases explicitly. If your workload does not match, the canonical alternative (map + mutex, or atomic.Pointer over an immutable map) is faster.

## Case 6 — WaitGroup vs errgroup decision in a backfill job

A nightly backfill job processed 50 million records in parallel. The original used `sync.WaitGroup`:

```go
func backfill(records []Record) {
    var wg sync.WaitGroup
    for _, r := range records {
        wg.Add(1)
        go func(r Record) {
            defer wg.Done()
            if err := process(r); err != nil {
                log.Printf("error processing %v: %v", r.ID, err)
            }
        }(r)
    }
    wg.Wait()
}
```

Two problems:

1. No bounded concurrency. 50M goroutines exhaust memory.
2. No error propagation. An error logs and moves on; the job reports success even if every record failed.

The fix used `errgroup` with `SetLimit`:

```go
func backfill(ctx context.Context, records []Record) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(100)
    for _, r := range records {
        r := r
        g.Go(func() error {
            return process(ctx, r)
        })
    }
    return g.Wait()
}
```

`SetLimit(100)` caps concurrency. The first error short-circuits via the cancelled context. `Wait` returns the first error.

If the requirement had been "process all records and report aggregate stats, do not short-circuit on first error," the right primitive would still be a worker pool, but built differently — perhaps a fan-out channel plus a goroutine that consumes errors into a slice. The point is to match the primitive to the failure semantics, which `errgroup` does by default for the most common case.

## Case 7 — Splitting a god-lock

A user service had one giant `sync.RWMutex` protecting "all user state": active sessions, password hashes, preferences, audit logs. The lock was acquired on every request. Under load, every code path serialized on the same lock.

The fix was not to make the lock faster. It was to split the state into independent components, each with its own lock or atomic pointer:

```go
// BEFORE
type UserStore struct {
    mu       sync.RWMutex
    sessions map[string]*Session
    pw       map[string]passwordHash
    prefs    map[string]Preferences
    audit    []AuditEntry
}

// AFTER
type UserStore struct {
    sessions sessionStore  // its own mu
    pw       pwStore       // its own mu
    prefs    prefStore     // its own mu (or atomic.Pointer)
    audit    auditWriter   // a channel to a writer goroutine
}
```

Each sub-store picked its own primitive based on its access pattern:

- Sessions: high write rate, per-user disjoint keys → sharded `map[string]*Session` with per-shard mutex.
- Passwords: low write rate, high read rate, all reads need consistency → `sync.RWMutex` is fine.
- Preferences: read-mostly, full reload on update → `atomic.Pointer[map[string]Preferences]`.
- Audit: append-only, order matters per-user but not globally → buffered channel to a writer goroutine.

After the split, the only contention was within each sub-store on its specific access pattern. The decision tree was walked four times, once per sub-store, and four different primitives came out. This is the typical shape of "scaling a Go service": not "use a faster lock" but "use multiple locks (or no lock) on smaller state."

## Pre-merge code review checklist

When a PR introduces or modifies concurrent code, walk through these questions:

### 1. Is the primitive necessary at all?

Many concurrent constructs exist to support a parallelism that nobody asked for. If the data is touched only by one goroutine, no synchronization is needed. Look for variables marked "thread-safe" with mutexes that are only ever called from the same goroutine.

### 2. What is the read-to-write ratio?

If reads >> writes (>10:1), the primitive should be `atomic.Pointer` over an immutable snapshot or `sync.RWMutex`. If writes are more frequent, a plain `sync.Mutex` is fine.

### 3. Are two values that must move together protected by separate atomics?

If yes, pack them into one `atomic.Pointer` to a struct, or use a single mutex for both. Two atomics on values that must be consistent is the most common subtle race in Go.

### 4. Does a goroutine exist whose only job is to receive from a channel and mutate state?

If the channel sends and the only consumer is "update one variable," replace with an atomic. The goroutine is overhead.

### 5. Does a `sync.Cond` exist?

For each one, ask: "could this be a closed channel?" The answer is usually yes. Cond is correct only for dynamic waiter sets with per-waiter predicates that must be re-checked after wakeup.

### 6. Is there an unbounded queue?

Buffered channels with capacity 1,000,000 are not "bounded"; they are "bounded by memory." If the producer can run forever and the consumer can stall, the queue must have a defined drop policy with metrics on drops.

### 7. Does `sync.Map` fit the documented use cases?

The godoc lists exactly two: write-once-read-many, or disjoint key sets. If your workload does not match either, use `map + mutex` (or `atomic.Pointer[map[K]V]` if reads dominate).

### 8. Is there cache-line padding on hot atomics?

Multi-writer atomics on adjacent fields false-share. If a struct has two `atomic.Int64`s next to each other and both are written from different goroutines, the cache line bounces between cores. Pad to 64-byte boundaries.

### 9. Does cancellation work?

For every long-running goroutine, where is the `ctx.Done()` check? For every `chan` receive that might block, is there a `select` with `ctx.Done()` alongside? `sync.Cond.Wait` and `sync.Mutex.Lock` do not honor contexts.

### 10. Does the test suite pass under `-race`?

If the answer is "we never run -race because the tests are too slow," fix the tests first. Concurrent code reviewed without `-race` evidence is reviewed in the dark.

## What good code reviews catch

The most valuable review comments on concurrent Go PRs are:

- "This is the same data we discussed in the design review; why isn't it an `atomic.Pointer`?"
- "Why does `Submit` block instead of dropping with a metric?"
- "If I cancel the context here, what happens to the goroutine that's blocked in `Wait`?"
- "These two atomic counters need to be consistent; pack them into one pointer."
- "This is the second sync.Map in this file. We agreed last week that the access pattern wasn't a fit; can we revisit?"

The least valuable: "what if you used a sync.Cond here?" — almost always a step backward.

## The professional's bias

Senior Go engineers default to *lighter* primitives and add weight only when forced by measurement:

1. First reach: no synchronization at all (single-owner data).
2. Second reach: atomic for one value, channel-close for one signal.
3. Third reach: mutex around small state.
4. Fourth reach: errgroup/semaphore for bounded parallelism.
5. Fifth reach: sync.Cond (rare, justified by dynamic waiter set with predicate).
6. Sixth reach: rebuild the data structure to need less synchronization.

The list is in order of preference. The most common production bug in concurrent Go code is reaching past step 1 or 2 without justification, then needing to refactor under deadline pressure when the heavier primitive turns out to be the bottleneck. Walk the decision tree before merging — not after the on-call shift.

## Adopting the decision tree across a team

Telling a team "use the decision tree" does not work. What works:

1. Bake the tree into the code review template as a checklist.
2. Add a linter rule for the obvious anti-patterns: a goroutine whose only purpose is to update a counter (replace with atomic); a `sync.Cond` without a `for !pred { Wait() }` loop (almost always a bug); a `sync.Map` with frequently-overwritten keys.
3. Maintain a "primitive choices" doc per service: "we use atomic.Pointer for config, channels for fan-out, sharded mutexes for the session store." When a PR deviates, the doc is the reference for "why" the existing pattern was chosen.
4. Run `-race` in CI on every PR. No exceptions. If a test is too slow under race, the fix is to write a smaller test, not skip the race check.

The decision tree's authority is not the document; it is the team agreeing to use it consistently. One engineer reaching for `sync.Cond` because "I've always liked condition variables" undoes the value of everyone else following the tree.

## Case 8 — singleflight for cache stampede prevention

A search service exposed an autocomplete API. Each query was looked up in Redis; on cache miss, the service queried a slow database (200 ms). Under launch traffic, popular queries (like "iphone") arrived 500 times per second from different users. The cache miss path was reached by every concurrent request — 500 simultaneous database queries for the same key. The database fell over.

The wrong fix: add a mutex around the cache miss path. That would serialize *all* misses, not just same-key misses.

The right fix: `golang.org/x/sync/singleflight`.

```go
import "golang.org/x/sync/singleflight"

type Service struct {
    cache map[string][]Result
    mu    sync.RWMutex
    sf    singleflight.Group
}

func (s *Service) Autocomplete(ctx context.Context, q string) ([]Result, error) {
    s.mu.RLock()
    if r, ok := s.cache[q]; ok {
        s.mu.RUnlock()
        return r, nil
    }
    s.mu.RUnlock()

    v, err, _ := s.sf.Do(q, func() (interface{}, error) {
        results, err := s.db.QueryAutocomplete(ctx, q)
        if err != nil {
            return nil, err
        }
        s.mu.Lock()
        s.cache[q] = results
        s.mu.Unlock()
        return results, nil
    })
    if err != nil {
        return nil, err
    }
    return v.([]Result), nil
}
```

`singleflight.Group.Do(key, fn)` ensures that for the same key, only one goroutine runs `fn` at a time; all concurrent callers wait and receive the same result. 500 simultaneous "iphone" misses become 1 database query and 499 free rides.

The decision tree branch for this is: *cache miss with thundering herd potential → singleflight*. It is not in the standard library; you must remember to reach for it.

## Case 9 — Replacing a custom worker pool with x/sync primitives

A team had a 600-line "JobPool" abstraction with custom queue, dispatcher, retry logic, and concurrency limiter. Code review of a new feature revealed:

- The queue was a buffered channel.
- The dispatcher was a goroutine that read from the channel and spawned workers.
- The concurrency limiter was a semaphore implemented as a buffered channel of tokens.
- The retry logic was a wrapper that re-enqueued failed jobs.

Every one of these was a thin re-implementation of standard primitives. The decision tree maps each directly:

- Bounded queue → buffered channel (already).
- N workers consuming → `errgroup.SetLimit`.
- Retry on failure → wrap the job function with a retry helper, no infrastructure needed.

The 600 lines collapsed to ~60:

```go
type Job func(context.Context) error

func RunPool(ctx context.Context, concurrency int, jobs <-chan Job) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(concurrency)
    for j := range jobs {
        j := j
        g.Go(func() error { return j(ctx) })
        if ctx.Err() != nil {
            break
        }
    }
    return g.Wait()
}

func WithRetry(j Job, attempts int, baseDelay time.Duration) Job {
    return func(ctx context.Context) error {
        var err error
        for i := 0; i < attempts; i++ {
            if err = j(ctx); err == nil {
                return nil
            }
            select {
            case <-ctx.Done():
                return ctx.Err()
            case <-time.After(baseDelay << i):
            }
        }
        return err
    }
}
```

The lesson: when a "concurrency framework" exists in your codebase, the question to ask is whether it predates the parts of `x/sync` it duplicates. If it does, the right refactor is to delete it.

## Case 10 — atomic.Value vs atomic.Pointer migration

A pre-Go-1.19 codebase used `atomic.Value` for config publication:

```go
var config atomic.Value // *Config

func init() {
    config.Store(&Config{...})
}

func Get() *Config {
    return config.Load().(*Config) // type assertion every read
}
```

`atomic.Value` is type-erased — `Load` returns `interface{}` (now `any`), forcing a type assertion on every read. The assertion is cheap but non-zero, and the lack of compile-time type safety means a typo (storing a `*OtherType`) becomes a runtime panic.

Go 1.19 added typed `atomic.Pointer[T]`. The migration is mechanical:

```go
var config atomic.Pointer[Config]

func init() {
    config.Store(&Config{...})
}

func Get() *Config {
    return config.Load() // typed, no assertion
}
```

Benefits:

- Compile-time type safety.
- No allocation on Store (the value is already a pointer).
- ~10–15% faster Load (no interface unboxing).

Migration risk: zero. `atomic.Pointer[T]` is a drop-in replacement for `atomic.Value` holding pointers. If your code stores values (not pointers) in `atomic.Value`, you must first wrap them in pointers — but storing non-pointer values in `atomic.Value` was already an anti-pattern because of the copy.

The decision tree's modern form prefers `atomic.Pointer[T]` over `atomic.Value` for every new use case. Run a codebase-wide search for `atomic.Value` and migrate the trivial ones; the harder ones (value types stored in the Value) are usually wrong choices that need rethinking anyway.

## Case 11 — When to roll your own vs reach for a library

A team building a high-throughput message broker needed a lock-free MPSC (multi-producer single-consumer) queue. The decision tree's `Buffered channel` answer would work but profiled at 15% of CPU under peak load — channel operations were a measurable cost.

The temptation was to write a custom lock-free ring buffer. The actual progression:

1. **First attempt:** custom ring buffer with atomic head and tail pointers. Worked in benchmarks. Crashed in production at memory model edge cases.
2. **Second attempt:** ported a well-tested ring buffer from another language. Worked but required 200 lines of unsafe.Pointer arithmetic that nobody on the team wanted to maintain.
3. **Final decision:** use the standard channel and accept the 15% CPU cost. Buy bigger machines. The maintenance cost of the custom queue was higher than the hardware cost.

The lesson: the decision tree's primitives are not the absolute fastest possible answer for every workload. They are the fastest *correct* answer that the team can maintain. A custom lock-free queue is the right choice in projects with full-time concurrency specialists; for a typical engineering team, the channel is the right choice even when it is provably suboptimal.

The corollary: when a benchmark shows the standard primitive as the bottleneck, the first question is "can I avoid the primitive entirely?" — by sharding, batching, or restructuring — not "can I write a faster version?" Standard primitives have battle-tested correctness; custom ones have whatever correctness the original author achieved before getting pulled onto another project.

## Case 12 — RWMutex degradation under high reader count

A graph service held an in-memory adjacency list protected by `sync.RWMutex`. Reads (graph traversals) outnumbered writes (graph mutations) by 1000:1. Initial design: many readers, occasional writer, RWMutex was the textbook choice.

Under load, profiling showed `sync.RWMutex.RLock` consuming 30% of CPU. The cause: `RLock` does a CAS on a shared 32-bit reader counter. With 64 cores all calling `RLock` constantly, that one cache line was the hottest in the entire process.

The first refactor sharded the read path:

```go
type Graph struct {
    shards [64]struct {
        mu       sync.RWMutex
        adjList  map[int][]int
    }
}

func (g *Graph) Neighbors(node int) []int {
    sh := &g.shards[node%64]
    sh.mu.RLock()
    defer sh.mu.RUnlock()
    return append([]int(nil), sh.adjList[node]...) // defensive copy
}
```

This reduced RLock contention by 64x. But adding a mutation now required locking 64 mutexes — possible but ugly.

The second refactor abandoned RWMutex entirely:

```go
type GraphSnapshot struct {
    adjList map[int][]int // immutable after construction
}

type Graph struct {
    snap atomic.Pointer[GraphSnapshot]
}

func (g *Graph) Neighbors(node int) []int {
    return g.snap.Load().adjList[node]
}

func (g *Graph) Mutate(fn func(map[int][]int)) {
    for {
        old := g.snap.Load()
        next := copyMap(old.adjList)
        fn(next)
        if g.snap.CompareAndSwap(old, &GraphSnapshot{adjList: next}) {
            return
        }
    }
}
```

Reads: one atomic load + one map lookup. Writes: full O(V+E) copy + CAS. For a graph with 100K nodes mutated once a second, the write cost is 100 μs; reads run at the speed of a normal map.

The decision tree's rule for read-mostly state is unambiguous: when reads massively dominate, the atomic-pointer-over-immutable-snapshot pattern is faster than any flavor of mutex. RWMutex helps in the 10:1 to 100:1 ratio band; beyond that, the snapshot pattern wins.

## Case 13 — Goroutine leak in a "smart" fan-out

A retry-and-aggregate function:

```go
func fanOutBuggy(ctx context.Context, queries []Query) ([]Result, error) {
    results := make([]Result, len(queries))
    errCh := make(chan error, len(queries))

    for i, q := range queries {
        i, q := i, q
        go func() {
            r, err := tryWithRetry(ctx, q)
            if err != nil {
                errCh <- err
                return
            }
            results[i] = r
            errCh <- nil
        }()
    }

    for range queries {
        if err := <-errCh; err != nil {
            return nil, err
        }
    }
    return results, nil
}
```

The bug: if the first query returns an error, the function returns immediately. But the other goroutines keep running, eventually trying to send on `errCh` — which has buffer capacity for them, so they do not block, but they keep doing work. If `tryWithRetry` is expensive (e.g., does network I/O with exponential backoff), the function returns quickly but the goroutines run for minutes.

Three fixes, in order of cleanliness:

1. **Propagate cancellation:** wrap with `context.WithCancel` and call `cancel()` before returning. The goroutines, if they respect the context, exit promptly.
2. **Use errgroup:** which does the above automatically.
3. **Drain the error channel:** wait for all goroutines to send before returning. Simple but defeats the purpose of "fail fast."

The right answer is errgroup. The original function was reimplementing it badly:

```go
func fanOut(ctx context.Context, queries []Query) ([]Result, error) {
    results := make([]Result, len(queries))
    g, ctx := errgroup.WithContext(ctx)
    for i, q := range queries {
        i, q := i, q
        g.Go(func() error {
            r, err := tryWithRetry(ctx, q)
            if err != nil {
                return err
            }
            results[i] = r
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

The lesson: every time you find yourself writing a goroutine + error channel + loop, ask whether `errgroup.WithContext` does the same job in fewer lines.

## Production heuristics that the tree does not teach

The decision tree picks primitives. But experienced engineers also apply these meta-heuristics:

### Heuristic 1: Make the synchronization invisible

The best concurrent code does not look concurrent. A function that takes a context and a value, calls an `atomic.Pointer.Store`, and returns is more readable than a function that explicitly manages a mutex, a condition variable, and a wakeup. When two solutions are equivalent, prefer the one where the synchronization is implicit in the primitive's API.

### Heuristic 2: One owner per piece of state

For every mutable variable, there should be exactly one goroutine (or one well-defined goroutine pool) responsible for it. "Many goroutines touching the same state" is the source of every concurrency bug. The decision tree's primitives are mechanisms for restoring single-ownership semantics over apparently-shared data.

### Heuristic 3: Channels for data flow, atomics for state, contexts for lifecycle

A useful three-axis decomposition:

- **Data flow** between goroutines → channels.
- **Shared state** read by many → atomics or mutex over immutable snapshots.
- **Lifecycle / cancellation** → contexts.

A well-designed concurrent component touches all three axes but does not mix their roles. A channel that carries cancellation signals (instead of `ctx.Done()`) is a smell; an atomic counter that doubles as a "ready" flag is a smell.

### Heuristic 4: Prefer dead code paths to clever code paths

If a primitive choice introduces a code path that runs once per minute but is hard to reason about, it is probably wrong. The hot path should be obvious; the cold path can be ugly. Inverting this — clever hot path, simple cold path — is how postmortems are written.

### Heuristic 5a: Inversion of responsibility for shutdown

Production services almost always have a shutdown story that the original author got wrong. Common shapes:

- Workers spawned without a cancellation hook ("the goroutine runs forever").
- Channels closed from the wrong side ("panic on send to closed channel").
- WaitGroup with `Done` not in a `defer` ("if the goroutine panics, the counter never decrements and Wait blocks forever").

The pattern that consistently works: a single orchestrator owns the lifecycle. It receives `context.Context` from above. It spawns workers, each of which receives the same context. On shutdown, the orchestrator either cancels its own context (propagating downward) or waits for the parent context to cancel. All workers exit promptly because they check `ctx.Done()` on every blocking operation.

Code review question: "If I cancel the context here, what happens to every goroutine spawned from this function?" If the answer is anything other than "they exit within milliseconds," the design is wrong.

### Heuristic 5: Make wrong code look wrong

Use unexported types for synchronized state so that callers must go through your locked accessors. Pack mutex-protected fields and the mutex itself into the same struct so that "I see a mutex" tells the reader exactly which fields it guards.

```go
// BAD: caller can access state without holding the lock
type Counter struct {
    Mu sync.Mutex
    Val int64 // tempting to read directly
}

// GOOD: state is hidden; only methods can touch it
type Counter struct {
    mu sync.Mutex
    val int64
}
func (c *Counter) Inc()   { c.mu.Lock(); c.val++; c.mu.Unlock() }
func (c *Counter) Get() int64 {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.val
}
```

The unexported form makes "accidentally accessing the state without the lock" a compile error, not a silent race.

## Code review one-liners worth memorizing

Comments that have killed bad concurrent PRs:

- "What happens to this goroutine when the context is cancelled?"
- "Why is this a channel? It carries one value at startup; could it be `atomic.Pointer`?"
- "These two atomic counters must be consistent. Pack into one pointer."
- "This RWMutex protects a map with two fields. Why not `atomic.Pointer[snapshot]`?"
- "The `sync.Cond.Wait` here doesn't have a `for` loop around it. That is a bug."
- "Channel buffer of 100,000 is not back-pressure; it is a memory leak with extra steps."
- "`sync.Map` for a map that gets rewritten every 30 seconds — the godoc forbids that."

If you cannot defend the primitive choice against these one-liners, the PR is not ready.

## Case 14 — Migrating a callback-based API to channels

A legacy event emitter had a callback API:

```go
type Emitter struct {
    mu        sync.Mutex
    listeners []func(Event)
}

func (e *Emitter) On(fn func(Event)) {
    e.mu.Lock()
    e.listeners = append(e.listeners, fn)
    e.mu.Unlock()
}

func (e *Emitter) Emit(ev Event) {
    e.mu.Lock()
    listeners := append([]func(Event){}, e.listeners...) // copy under lock
    e.mu.Unlock()
    for _, fn := range listeners {
        fn(ev)
    }
}
```

Problems:

1. Callbacks run synchronously in the emitter goroutine; a slow callback blocks all subsequent emissions.
2. If a callback panics, the emitter goroutine dies.
3. No way to deregister a callback.
4. The "copy under lock" pattern is correct but easy to get wrong.

The channel-based refactor:

```go
type Emitter struct {
    mu   sync.Mutex
    subs []chan Event
}

func (e *Emitter) Subscribe() (<-chan Event, func()) {
    ch := make(chan Event, 16)
    e.mu.Lock()
    e.subs = append(e.subs, ch)
    e.mu.Unlock()
    cancel := func() {
        e.mu.Lock()
        defer e.mu.Unlock()
        for i, c := range e.subs {
            if c == ch {
                e.subs = append(e.subs[:i], e.subs[i+1:]...)
                close(ch)
                return
            }
        }
    }
    return ch, cancel
}

func (e *Emitter) Emit(ev Event) {
    e.mu.Lock()
    subs := append([]chan Event{}, e.subs...)
    e.mu.Unlock()
    for _, ch := range subs {
        select {
        case ch <- ev:
        default: // drop if subscriber is slow
        }
    }
}
```

Subscribers run their own goroutines and consume from their channels. A slow subscriber gets events dropped, but does not block the emitter. Cancellation is explicit. Panics in subscribers do not affect the emitter.

The decision tree's branch for this is *one-to-many event distribution with independent consumers* → channel-per-subscriber.

## Case 15 — A telemetry batcher that needed to flush on size or time

A metrics pipeline batched events for efficiency. Original design: a single goroutine collected events into a buffer, flushed every 50ms or when the buffer hit 1000 events.

```go
type Batcher struct {
    in chan Event
}

func (b *Batcher) Run(ctx context.Context) {
    buf := make([]Event, 0, 1000)
    ticker := time.NewTicker(50 * time.Millisecond)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            if len(buf) > 0 {
                b.flush(buf)
            }
            return
        case ev := <-b.in:
            buf = append(buf, ev)
            if len(buf) >= 1000 {
                b.flush(buf)
                buf = buf[:0]
            }
        case <-ticker.C:
            if len(buf) > 0 {
                b.flush(buf)
                buf = buf[:0]
            }
        }
    }
}
```

This is a clean Branch 4a (buffered channel) + custom batching design. No mutex, no atomic, no Cond — just one channel, one goroutine, one ticker, one slice. The primitives are minimal because the single owner pattern (one goroutine owns the buffer) eliminates all sharing.

Variations that would be wrong:

- **Sharing the buffer between multiple consumers** would require a mutex on the buffer; the decision tree would push toward "one writer per piece of state."
- **Using a `sync.Cond` to signal "buffer is ready to flush"** is overkill when one consumer can poll its own state.
- **Running the flush inside the receive loop synchronously** is the production-realistic shape; if the flush is slow, kick off `go b.flush(buf)` and create a new buffer.

The decision tree gives the primitive (channel); production experience gives the shape (single-owner goroutine, defensive copy on flush, drain on shutdown).

## The compounding effect of good primitive choices

Choosing the right primitive for one component is a local improvement. Choosing the right primitives across a service compounds:

- Each component is independently optimal.
- Components compose cleanly because they share idioms (every service uses `errgroup` for fan-out, `atomic.Pointer` for config, `context.Context` for cancellation).
- New engineers ramp up faster because they see the same patterns everywhere.
- Code review converges on a shared vocabulary; debates about "what primitive should we use" become rare.

A codebase where every concurrent component is a special snowflake — one uses Cond, another uses mutex, a third uses channel-as-mutex, a fourth uses `atomic.Value` — is harder to maintain than one where the decision tree was walked consistently and the result is documented. The cost of the inconsistency shows up later, in onboarding time, code review duration, and the rate of subtle bugs in PRs that touch unfamiliar concurrent code.

## Career arc of a Go engineer's primitive vocabulary

Watching engineers grow into Go, the progression is roughly:

1. **Junior:** uses goroutines and channels for everything; reaches for mutexes only after channels become unwieldy.
2. **Mid-level:** discovers `sync.Mutex` and `sync.RWMutex`; starts protecting maps and slices; learns to fear data races.
3. **Senior:** learns `sync/atomic`; replaces mutexes with atomic counters and pointer publication for read-mostly workloads; deletes goroutines whose only purpose is to mutate a counter.
4. **Staff:** removes primitives entirely by re-architecting; replaces a `sync.Map` with a sharded `map[K]V`; replaces a complex `sync.Cond` with a `chan` close; ports a custom worker pool to `errgroup`.

The decision tree is most useful at the senior-to-staff transition. It is the framework for asking "is this primitive necessary?" rather than "which primitive should I use?" The best concurrent code in a mature Go codebase has fewer primitives than the previous version, not more.

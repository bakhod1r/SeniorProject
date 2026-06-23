---
layout: default
title: Middle
parent: Copy-on-Write
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/05-copy-on-write/middle/
---

# Copy-on-Write — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [When COW Is the Right Tool](#when-cow-is-the-right-tool)
3. [The Snapshot Discipline](#the-snapshot-discipline)
4. [Writer Coordination Strategies](#writer-coordination-strategies)
5. [COW Maps in Practice](#cow-maps-in-practice)
6. [COW Slices in Practice](#cow-slices-in-practice)
7. [Snapshot Consistency](#snapshot-consistency)
8. [Write Amplification and Batching](#write-amplification-and-batching)
9. [Comparing COW to RWMutex](#comparing-cow-to-rwmutex)
10. [Comparing COW to sync.Map](#comparing-cow-to-syncmap)
11. [Sharded COW](#sharded-cow)
12. [Snapshot Versioning](#snapshot-versioning)
13. [Watchers and Notifications](#watchers-and-notifications)
14. [Hot-Reload Patterns](#hot-reload-patterns)
15. [Error Handling and Validation](#error-handling-and-validation)
16. [Observability](#observability)
17. [Testing COW Code](#testing-cow-code)
18. [Benchmark-Driven Decisions](#benchmark-driven-decisions)
19. [Common Pitfalls at Scale](#common-pitfalls-at-scale)
20. [Best Practices](#best-practices)
21. [Self-Assessment](#self-assessment)
22. [Summary](#summary)

---

## Introduction
> Focus: "I understand the basics. Now: how do I design a system around COW? When is it wrong? How do I avoid the write-amplification trap? How does this interact with the rest of my architecture?"

At the middle level, COW becomes a system-design question, not a primitive-usage question. You already know how to load and store a snapshot, how to deep-copy a slice, and how to serialize writers. The next questions are:

- How do I choose between COW, `sync.RWMutex`, `sync.Map`, and a sharded-mutex map?
- How big can my snapshot get before write cost becomes a problem?
- How do I handle a flood of writes without overwhelming the GC?
- How do I expose snapshots to many goroutines without accidentally pinning old ones?
- How do I let other parts of the system react to snapshot changes (watchers)?
- How do I keep the snapshot consistent across a multi-step write?
- How do I measure all of this so I know my design is right?

The junior level taught the mechanics. The middle level teaches the engineering judgement: shape the design to the workload, measure relentlessly, and have a fallback plan when the workload changes.

---

## When COW Is the Right Tool

The decision tree for "which concurrent data structure" should be applied before any code is written. COW sits at one corner of the design space.

### The decision tree

```
                Reads >> Writes (>1000:1)?
                       |
              ┌────────┴────────┐
             yes                 no
              |                   |
   Snapshot small enough?    Map-shaped?
   (<10 MB; <1 GB upper)         |
              |             ┌────┴────┐
       ┌──────┴──────┐     yes        no
      yes            no    |           |
       |             |   sync.Map   sync.Mutex /
   Multi-field   sync.RWMutex      sync.RWMutex
   consistency             or sharded-mutex map
   needed?
       |
   ┌───┴───┐
  yes      no
   |       |
  COW   atomic primitives
        (Int64, Bool, etc.)
```

### The four canonical workloads

| Workload | Reads/sec | Writes/sec | Best choice |
|----------|-----------|------------|-------------|
| Configuration | 10 000 – 1 000 000 | <1 | COW (atomic.Pointer) |
| Feature flags | 10 000 – 1 000 000 | <0.1 | COW |
| Per-request counter | 10 000 – 1 000 000 | 10 000 – 1 000 000 | `atomic.Int64` |
| Hot cache | 100 000 | 10 000 | `sync.Map` or sharded mutex map |
| Routing table | 1 000 000 | 0.01 (per deploy) | COW |
| Service registry | 100 000 | 0.1 – 1 (per discovery event) | COW |
| User session table | 10 000 | 1 000 (per login) | `sync.Map` or sharded |

The "magic ratio" rule of thumb: if writes are more than 1% of reads, reconsider COW. Below that threshold, COW typically wins on read latency, and the write cost is amortized over many reads.

### Sizes matter as much as ratios

A 1 GB snapshot with one write per hour is theoretically COW-compatible — the per-write rebuild costs ~10 seconds and a 1 GB allocation, but it happens rarely. In practice, the allocation pressure spikes the GC, the rebuild blocks the writer for 10 seconds, and the operator who triggered it wonders why their dashboard hung.

Past 100 MB, switch to:

- **Persistent data structures** (HAMTs, finger trees, RRB trees) that share structure between versions.
- **Incremental snapshots** that combine a small "delta layer" with a large "base layer".
- **Sharded COW** where each shard is independently COW.

These appear in senior.md. At middle level, the rule of thumb is: if your snapshot is over a few MB and you write more than once a minute, plan to switch strategies.

### Latency variance, not just throughput

COW's killer feature is **predictable read latency**. An RWMutex can give you a 100 ms tail latency if a writer holds the lock for 100 ms. COW gives you a 2 ns reader cost, always.

For SLO-sensitive services — p99.9 latency budgets in the low milliseconds — the absence of writer-induced tail latency is reason enough to choose COW even when throughput is similar.

---

## The Snapshot Discipline

The junior level introduced "don't mutate published snapshots". The middle level treats that discipline as a *type design* problem, not a runtime hope.

### Designing for deep immutability

A snapshot type should *look* immutable. Aim for these patterns:

#### Pattern 1: All fields are value types

```go
type Snapshot struct {
	Version int64
	Origin  string
	Limit   int
	// no slices, no maps, no pointers
}
```

If the snapshot is small and field-only, deep immutability is automatic. The shallow copy *is* the deep copy.

#### Pattern 2: Slices and maps are immutable by convention

```go
type Snapshot struct {
	Hosts []string                  // never mutated after publish
	Lookup map[string]*HostInfo     // map never mutated; *HostInfo also immutable
}
```

This is the common case. The type system cannot enforce immutability, so:

- Document the contract in a doc comment.
- Provide accessor methods that return copies or `func` accessors.
- Always rebuild from scratch in writers — never `append` in place, never assign to a map key.

#### Pattern 3: Wrap mutable inner types in accessors

```go
type Snapshot struct {
	hosts []string // unexported
}

func (s *Snapshot) Hosts() []string {
	out := make([]string, len(s.hosts))
	copy(out, s.hosts)
	return out
}

func (s *Snapshot) HostAt(i int) string { return s.hosts[i] }

func (s *Snapshot) ForEachHost(fn func(string)) {
	for _, h := range s.hosts {
		fn(h)
	}
}
```

Accessors enforce immutability at the API boundary. The slice is never directly handed out.

#### Pattern 4: Use immutable sub-types

Use library types like `string` (immutable in Go) or roll your own:

```go
type immutableSet struct {
	m map[string]struct{} // accessed only via Contains
}

func (s *immutableSet) Contains(k string) bool {
	_, ok := s.m[k]
	return ok
}
```

The internal `m` is never exposed.

### Reasoning about deep copies

Every slice, map, or pointer inside the snapshot triggers a question: "if a writer modifies this field, does it need its own copy?"

| Field type | Shallow copy of struct preserves... | Writer must deep-copy if... |
|-----------|-------------------------------------|------------------------------|
| `int`, `bool`, `string` | a fresh value | never (immutable) |
| `time.Time` | a fresh value | never |
| `[]T` | the slice header; backing array shared | writer wants to append/set |
| `map[K]V` | the map header; underlying map shared | writer wants to add/delete/update |
| `*T` | the pointer; pointed-to object shared | writer wants to mutate `*T` |
| `chan T` | the channel; shared | always — you cannot "copy" a channel |
| `sync.Mutex` | a copied mutex (bug!) | never — never put a Mutex in a copyable struct |

The `sync.Mutex` row is a trap. `go vet` catches some cases (`copylocks` analyzer), but if you put a `sync.Mutex` inside a snapshot type, every snapshot you copy carries a fresh mutex — which is almost never what you want.

### Type-system tricks

Some teams use a private "snapshot key" to make the snapshot type unforgeable:

```go
type snapshotKey struct{}

type Snapshot struct {
	_      snapshotKey // can only be constructed by this package
	fields ...
}

func NewSnapshot(...) Snapshot { return Snapshot{...} }
```

Now external code cannot synthesize a `Snapshot`; they can only get one from your constructors. Combined with unexported fields, this approaches immutability-by-construction.

### Returning a clone instead of a snapshot

For the highest safety, return a clone every time:

```go
func (s *Store) Get() *Config {
	return s.cur.Load().Clone()
}
```

The cost is a full deep copy on every read. For a 10-field config with no slices, this is ~50 ns — still cheaper than an RWMutex. For larger snapshots, this destroys the whole point of COW.

Use this only when the caller is untrusted (e.g., third-party plugin) and the snapshot is small.

---

## Writer Coordination Strategies

The junior level showed one writer pattern: a `sync.Mutex` around the load-build-store dance. At middle level, choose between three patterns based on writer characteristics.

### Strategy 1: Plain writer mutex

```go
mu.Lock()
defer mu.Unlock()
old := cur.Load()
next := build(old)
cur.Store(next)
```

**Use when:** writes are infrequent and short. Cleanest, easiest to reason about.

**Avoid when:** writes are bursty or any writer may hold the lock for a long time.

### Strategy 2: CAS loop

```go
for {
	old := cur.Load()
	next := build(old)
	if cur.CompareAndSwap(old, next) {
		return
	}
	// another writer interleaved; retry
}
```

**Use when:** writers must not block each other, and the `build` step is short (so retries are cheap).

**Avoid when:** `build` is expensive — every retry repeats it.

**Caveat:** under heavy contention, CAS can starve. Use a backoff:

```go
for attempt := 0; ; attempt++ {
	old := cur.Load()
	next := build(old)
	if cur.CompareAndSwap(old, next) {
		return
	}
	if attempt > 100 {
		time.Sleep(time.Duration(attempt) * time.Microsecond)
	}
}
```

### Strategy 3: Single-writer goroutine

Funnel all writes through a single goroutine fed by a channel:

```go
type updateReq struct {
	apply func(*Config)
	done  chan struct{}
}

var updateCh = make(chan updateReq, 64)

func writerLoop() {
	for req := range updateCh {
		old := cur.Load()
		next := *old
		req.apply(&next)
		cur.Store(&next)
		close(req.done)
	}
}

func Update(fn func(*Config)) {
	done := make(chan struct{})
	updateCh <- updateReq{apply: fn, done: done}
	<-done
}
```

**Use when:** you want backpressure on writers (the channel buffer), centralized logging of writes, or batched writes.

**Avoid when:** simplicity matters more than control.

### Strategy 4: Batched writer

Buffer pending writes and apply them in batches:

```go
type batcher struct {
	pending []func(*Config)
	mu      sync.Mutex
	timer   *time.Timer
}

func (b *batcher) Enqueue(fn func(*Config)) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.pending = append(b.pending, fn)
	if b.timer == nil {
		b.timer = time.AfterFunc(10*time.Millisecond, b.flush)
	}
}

func (b *batcher) flush() {
	b.mu.Lock()
	work := b.pending
	b.pending = nil
	b.timer = nil
	b.mu.Unlock()

	// One rebuild for all queued updates.
	writeMu.Lock()
	defer writeMu.Unlock()
	old := cur.Load()
	next := *old
	for _, fn := range work {
		fn(&next)
	}
	cur.Store(&next)
}
```

**Use when:** many small writes arrive in bursts and a single combined rebuild is much cheaper than N separate rebuilds.

**Cost:** writers no longer see their changes reflected synchronously. Use callbacks or polling if they need to confirm.

### Choosing among the four

| Property | Mutex | CAS | Single-writer | Batched |
|----------|-------|-----|---------------|---------|
| Implementation simplicity | High | Medium | Medium | Low |
| Write latency | Low | Low (uncontended) | Medium | High (batched) |
| Writer throughput | OK | Good | OK | Excellent |
| GC pressure | High | High | High | Low (one allocation per batch) |
| Easy to add observability | Yes | Yes | Yes (write log) | Yes |

The mutex is the right default. Move to CAS only if you have measured the mutex as a bottleneck. Move to single-writer when you want centralized control. Move to batched when GC pressure or rebuild cost is the bottleneck.

---

## COW Maps in Practice

A COW map is a map exposed through an atomic pointer. The pattern is well-known but has subtleties at production scale.

### The textbook COW map

```go
type COWMap[K comparable, V any] struct {
	cur atomic.Pointer[map[K]V]
	mu  sync.Mutex
}

func NewCOWMap[K comparable, V any]() *COWMap[K, V] {
	m := make(map[K]V)
	out := &COWMap[K, V]{}
	out.cur.Store(&m)
	return out
}

func (m *COWMap[K, V]) Get(k K) (V, bool) {
	v, ok := (*m.cur.Load())[k]
	return v, ok
}

func (m *COWMap[K, V]) Set(k K, v V) {
	m.mu.Lock()
	defer m.mu.Unlock()
	old := *m.cur.Load()
	next := make(map[K]V, len(old)+1)
	for kk, vv := range old {
		next[kk] = vv
	}
	next[k] = v
	m.cur.Store(&next)
}

func (m *COWMap[K, V]) Delete(k K) {
	m.mu.Lock()
	defer m.mu.Unlock()
	old := *m.cur.Load()
	if _, ok := old[k]; !ok {
		return
	}
	next := make(map[K]V, len(old)-1)
	for kk, vv := range old {
		if kk != k {
			next[kk] = vv
		}
	}
	m.cur.Store(&next)
}
```

### The cost model

For a map of size N:

- `Get`: O(1) — one atomic load, one map lookup.
- `Set`: O(N) — full rebuild of the map.
- `Delete`: O(N) — full rebuild.
- Memory: at any moment, holds one current map; old maps stick around until GC.

A 10 000-entry map with `string` keys and `int64` values is ~600 KB. Rebuilding it takes ~500 µs and produces 600 KB of garbage. At 1 write per second, this is fine. At 100 writes per second, you are pushing 60 MB/sec to the GC.

### When to walk away from COWMap

The break-even point depends on workload, but a rough rule:

- Map size < 1 000 entries: COW is fine up to ~1 000 writes/sec.
- Map size 1 000 – 100 000: COW is fine up to ~10 writes/sec.
- Map size > 100 000: COW writes are painful; consider sharded COW or `sync.Map`.

### COWMap with pre-sized capacity

If you know your map's typical size, pre-size to avoid rehash:

```go
next := make(map[K]V, len(old)*2) // double the size to leave headroom
```

The `*2` hedges against future inserts that would otherwise trigger a rehash. Cost: more memory per snapshot.

### COWMap with structural sharing? No.

A naive COWMap rebuilds the whole map per write. The fancy alternative is a HAMT (hash array-mapped trie) which shares structure between versions. Go does not have HAMTs in the standard library; community libraries (e.g., `github.com/benbjohnson/immutable`) implement them. See senior.md for when this is worth the dependency.

### Range over a COWMap

```go
func (m *COWMap[K, V]) Range(fn func(k K, v V) bool) {
	for k, v := range *m.cur.Load() {
		if !fn(k, v) {
			return
		}
	}
}
```

Critical: `for range` evaluates `m.cur.Load()` *once*. The iteration sees a consistent snapshot. A concurrent writer producing a new snapshot does not affect the in-progress iteration.

### A common bug: forgetting that `Load` returns a pointer

```go
func (m *COWMap[K, V]) Set(k K, v V) {
	m.mu.Lock()
	defer m.mu.Unlock()
	old := m.cur.Load() // *map[K]V, NOT map[K]V
	(*old)[k] = v       // BUG: mutates the published snapshot!
	// ...
}
```

The fix: dereference and copy explicitly. This bug is caught by the race detector but only after the first concurrent reader trips on it.

---

## COW Slices in Practice

Slices are simpler than maps but bring their own surprises.

### Append-only slice

```go
type Log[T any] struct {
	cur atomic.Pointer[[]T]
	mu  sync.Mutex
}

func (l *Log[T]) Append(v T) {
	l.mu.Lock()
	defer l.mu.Unlock()
	old := *l.cur.Load()
	next := make([]T, len(old)+1)
	copy(next, old)
	next[len(old)] = v
	l.cur.Store(&next)
}
```

`O(n)` per append; you cannot escape this without a chunked representation.

### Slice as snapshot vs slice as buffer

If your slice represents a rolling buffer ("last 100 events"), COW is wasteful — every append rebuilds the entire buffer. Use a ring buffer or a `sync.Mutex`-protected slice. COW is best for slices that are *built incrementally and then frozen*.

### A frozen builder pattern

```go
type Builder struct {
	pending []Event
}

func (b *Builder) Add(e Event) { b.pending = append(b.pending, e) }

func (b *Builder) Freeze() *Snapshot {
	return &Snapshot{events: b.pending}
}
```

The writer accumulates in a private builder, then publishes one snapshot. No intermediate publishes.

### Slice of pointers

```go
type Snapshot struct {
	events []*Event
}
```

Cheap to copy the slice (header + pointer-sized elements). But: if any reader mutates `*event`, the data is shared. Make `Event` immutable too.

### Pre-allocation

For known-size snapshots:

```go
next := make([]T, 0, len(old)+1)
next = append(next, old...)
next = append(next, v)
```

Two `append`s with pre-allocated capacity avoid intermediate allocations.

### Slice slicing pitfall

```go
old := *cur.Load()
next := old[:len(old)-1] // BUG: shares backing array
cur.Store(&next)
```

Slicing creates a new header but the *same* backing array. A reader iterating `old` sees the truncated portion or, worse, witnesses an in-flight write if you later append to `next`. Always copy:

```go
next := make([]T, len(old)-1)
copy(next, old)
```

---

## Snapshot Consistency

The whole point of COW is that *one snapshot is consistent for the whole reader*. This is more powerful than it sounds.

### Multi-field reads are atomic by construction

```go
c := cfg.Load()
if c.LogLevel == "debug" && c.MaxConnections > 100 { ... }
```

Both fields come from the same snapshot. No torn read possible.

### Multi-snapshot reads are not atomic

```go
cfg := cfg.Load()
flags := flags.Load() // ANOTHER store
if cfg.LogLevel == "debug" && flags.Enabled("foo") { ... }
```

A writer could update `flags` between the two loads. If you need consistency across both, merge them into one snapshot or accept that they may be momentarily inconsistent.

### Pinning a snapshot for the duration of a request

The cleanest pattern: load once per request and pass the pointer down.

```go
func handle(w http.ResponseWriter, r *http.Request) {
	cfg := cfg.Load()
	ctx := context.WithValue(r.Context(), cfgKey{}, cfg)
	process(r.WithContext(ctx))
}
```

Every downstream call uses the same snapshot. Even if a `Store` happens mid-request, the request finishes with its original snapshot.

### Snapshot freshness vs consistency

There is a tension:

- **Freshness** means "give me the latest value." Requires `Load` at point of use.
- **Consistency** means "give me a stable, internally-consistent view." Requires `Load` once at top.

COW excels at consistency but does not give you sub-snapshot freshness. If you need both — "the latest LogLevel and the latest Hosts, even if they were published separately" — you need either:

- A single atomic pointer for the combined config.
- A locking mechanism around both fields.
- Acceptance that you have racy/inconsistent reads.

### Cross-store transactions

You cannot atomically update two `atomic.Pointer[T]`s. The closest you can do:

```go
mu.Lock()
defer mu.Unlock()
a.Store(newA)
b.Store(newB)
```

Two writers serialise via `mu`. But a *reader* that does `a.Load()` then `b.Load()` may catch the moment between the two stores. If this matters, group into one snapshot.

### Consistency vs scale

A single huge snapshot is consistent but expensive to rebuild. A collection of small snapshots is cheap to rebuild but loses cross-snapshot consistency. The middle-level engineer picks the right granularity:

- A web server's config: one snapshot.
- A microservice's downstream-service list: one snapshot per downstream service (each can be reloaded independently).
- A user profile cache: shard by user ID.

---

## Write Amplification and Batching

COW's main weakness is write amplification: a single field change requires rebuilding the entire snapshot.

### Measuring amplification

For a 100 KB snapshot containing 1000 entries, each `Set` allocates 100 KB. If you `Set` 100 keys in a row, you allocate 10 MB.

```go
for k, v := range pending {
	cowmap.Set(k, v) // one rebuild per Set
}
```

### Batched updates

Group writes:

```go
func (m *COWMap[K, V]) SetMany(pairs map[K]V) {
	m.mu.Lock()
	defer m.mu.Unlock()
	old := *m.cur.Load()
	next := make(map[K]V, len(old)+len(pairs))
	for k, v := range old {
		next[k] = v
	}
	for k, v := range pairs {
		next[k] = v
	}
	m.cur.Store(&next)
}
```

One rebuild for the whole batch. The amortized cost per `Set` drops dramatically.

### Time-window batching

If writes arrive continuously, accumulate and flush:

```go
var (
	pendingMu sync.Mutex
	pending   = make(map[string]string)
	flushTimer *time.Timer
)

func ScheduleSet(k, v string) {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	pending[k] = v
	if flushTimer == nil {
		flushTimer = time.AfterFunc(10*time.Millisecond, flush)
	}
}

func flush() {
	pendingMu.Lock()
	batch := pending
	pending = make(map[string]string)
	flushTimer = nil
	pendingMu.Unlock()

	cowmap.SetMany(batch)
}
```

The cost: writes are delayed by up to 10 ms. The win: one snapshot rebuild per 10 ms instead of N rebuilds per N writes.

### Adaptive batching

If load is high, batch larger windows:

```go
windowSize := 10 * time.Millisecond
if writeRate > 1000 {
	windowSize = 100 * time.Millisecond
}
```

Adaptive heuristics keep amortized cost roughly constant across load levels.

### Coalescing writes

If two writes target the same key, only the latest needs to land:

```go
pending[k] = v // overwrites previous value for k
```

Coalescing is automatic with a map-based pending buffer. With a slice-based one (e.g., event log), use a dedup pass before flush.

### Knowing when batching is too much

Batching breaks the "writes are visible synchronously" property. If a writer needs to know its update has landed (e.g., to acknowledge a client), it must wait for the flush. Provide callbacks or futures:

```go
type pendingWrite struct {
	k, v string
	done chan struct{}
}
```

Writers await `<-done` after submitting. Latency is now bounded by the batch window.

---

## Comparing COW to RWMutex

### When RWMutex is right

- The structure is large and writes are merely "occasional" rather than "rare".
- You need to mutate fields in place — perhaps because copying is impractical (e.g., a structure that contains a `sync.Mutex` or open `*os.File`).
- The read path needs to *block* writers for some operation (e.g., taking a consistent snapshot of a live system).

### Why RWMutex is sometimes wrong for read-mostly

- `RLock` always atomically increments a reader counter and decrements on `RUnlock`. Even uncontended, this is ~10–30 ns.
- Under contention with a writer, `RLock` may block until the writer is done (Go's RWMutex is writer-preferring as of 1.18+).
- The reader counter is a single cache line; under heavy read load, it ping-pongs across CPUs.

A COW read is *one* atomic load (~1.5 ns), and the cache line holding the pointer is read-shared across all CPUs (no ping-pong). For 1 M reads/sec across 16 cores, COW is roughly 10× faster than RWMutex.

### Benchmark sketch

```go
func BenchmarkRWMutexRead(b *testing.B) {
	var mu sync.RWMutex
	cfg := &Config{}
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			mu.RLock()
			_ = cfg.LogLevel
			mu.RUnlock()
		}
	})
}

func BenchmarkCOWRead(b *testing.B) {
	var p atomic.Pointer[Config]
	p.Store(&Config{})
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_ = p.Load().LogLevel
		}
	})
}
```

Typical results on a recent Intel laptop:

```
BenchmarkRWMutexRead-8     30000000          45 ns/op
BenchmarkCOWRead-8        500000000           2.1 ns/op
```

20× difference. On NUMA hardware the gap is larger.

### When RWMutex wins

A workload with 50% writes:

```
BenchmarkRWMutexMixed-8    10000000         140 ns/op
BenchmarkCOWMixed-8         2000000         800 ns/op  (snapshot rebuild dominates)
```

For balanced workloads, RWMutex (or a plain `Mutex`) is clearly faster.

---

## Comparing COW to sync.Map

`sync.Map` is the standard library's lock-free-on-the-read-path map. It uses a different read-mostly strategy:

- A read-only `atomic.Value` "read map" — fast path for reads.
- A `sync.Mutex`-protected "dirty map" — slow path for writes.
- A promotion mechanism that moves dirty entries into the read map when the dirty grows large.

### When `sync.Map` is right

- Map-shaped data with **mixed read/write**.
- Keys are accessed independently (no need for multi-key snapshot consistency).
- The set of keys is mostly stable; new keys are rare.

The Go documentation calls out two use cases as ideal:

> 1. When the entry for a given key is only ever written once but read many times, as in caches that only grow.
> 2. When multiple goroutines read, write, and overwrite entries for disjoint sets of keys.

### When `sync.Map` is wrong

- You need a consistent multi-key snapshot. `sync.Map.Range` does not give one — its docs say "Range does not necessarily correspond to any consistent snapshot of the Map's contents."
- You need fast `Len()`. `sync.Map` has no `Len`; you must `Range` and count.
- Keys are frequently created and deleted across goroutines — the read map promotion is too slow to keep up.

### Benchmark sketch

For a hot read on a map containing 1 000 entries:

```
BenchmarkSyncMapRead-8     50000000          22 ns/op
BenchmarkCOWMapRead-8     300000000           3.5 ns/op  (atomic load + map lookup)
```

COW wins for pure read. `sync.Map` wins for mixed read/write when writes touch disjoint keys.

### The hybrid pattern

A small subset of cases benefit from putting a `sync.Map` *inside* a COW snapshot:

- The snapshot dictates which `sync.Map` is current.
- Operators can wholesale-swap to a fresh `sync.Map` (e.g., for cache clearing).
- Within a generation, reads and writes are `sync.Map`-fast.

```go
type Cache struct {
	m *sync.Map
}

var c atomic.Pointer[Cache]

func init() { c.Store(&Cache{m: &sync.Map{}}) }

func Get(k string) (string, bool) {
	v, ok := c.Load().m.Load(k)
	if !ok { return "", false }
	return v.(string), true
}

func ClearAll() {
	c.Store(&Cache{m: &sync.Map{}})
}
```

This composes the two patterns cleanly.

---

## Sharded COW

For a large map with frequent writes, shard:

```go
const NShards = 32

type ShardedCOW[K comparable, V any] struct {
	shards [NShards]struct {
		cur atomic.Pointer[map[K]V]
		mu  sync.Mutex
	}
	hash func(K) uint64
}

func (s *ShardedCOW[K, V]) Get(k K) (V, bool) {
	sh := &s.shards[s.hash(k)%NShards]
	v, ok := (*sh.cur.Load())[k]
	return v, ok
}

func (s *ShardedCOW[K, V]) Set(k K, v V) {
	sh := &s.shards[s.hash(k)%NShards]
	sh.mu.Lock()
	defer sh.mu.Unlock()
	old := *sh.cur.Load()
	next := make(map[K]V, len(old)+1)
	for kk, vv := range old {
		next[kk] = vv
	}
	next[k] = v
	sh.cur.Store(&next)
}
```

### Benefits

- Each shard's rebuild touches only `N/Shards` entries.
- Writer contention is reduced 32× (writers to different shards don't block each other).
- GC pressure spread across smaller allocations.

### Costs

- No cross-shard atomicity. Reading all shards in `Range` is not a consistent snapshot.
- More complexity. Avoid for small maps.

### Choosing the shard count

- Powers of 2 make `hash(k) & (N-1)` a fast bit-mask.
- 16, 32, 64 are common.
- More shards = more memory overhead (per-shard mutex + atomic pointer).
- Diminishing returns past 4× the number of CPU cores.

---

## Snapshot Versioning

Tagging each snapshot with a monotonic version unlocks several patterns.

### The version field

```go
type Snapshot struct {
	Version int64
	Data    map[string]string
}

func (s *Store) Set(k, v string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	old := s.cur.Load()
	next := &Snapshot{
		Version: old.Version + 1,
		Data:    make(map[string]string, len(old.Data)+1),
	}
	for kk, vv := range old.Data { next.Data[kk] = vv }
	next.Data[k] = v
	s.cur.Store(next)
}
```

### Use case 1: Change detection

A consumer can poll and detect changes:

```go
func (s *Store) Changed(since int64) (bool, int64) {
	cur := s.cur.Load()
	return cur.Version != since, cur.Version
}
```

Cheaper than diffing the whole snapshot.

### Use case 2: Optimistic concurrency

A client reads a snapshot, modifies, and conditionally writes:

```go
func (s *Store) CompareAndSet(expectedVer int64, fn func(*Snapshot) *Snapshot) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	old := s.cur.Load()
	if old.Version != expectedVer {
		return false // someone else wrote first
	}
	next := fn(old)
	next.Version = old.Version + 1
	s.cur.Store(next)
	return true
}
```

### Use case 3: Replay / audit

If you persist every snapshot (rare!), the version is the natural primary key. More commonly, the version is logged on every write for audit.

### Pitfall: monotonic but not gapless

If you use CAS, failed attempts produce version-number gaps. Don't rely on contiguous versions.

---

## Watchers and Notifications

Real systems often need "do something when the snapshot changes." There are several patterns.

### Pattern 1: Synchronous watcher list

```go
type Watcher func(old, new *Config)

type Store struct {
	cur      atomic.Pointer[Config]
	mu       sync.Mutex
	watchers []Watcher
}

func (s *Store) Watch(w Watcher) { s.mu.Lock(); defer s.mu.Unlock(); s.watchers = append(s.watchers, w) }

func (s *Store) Update(fn func(*Config)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	old := s.cur.Load()
	next := *old
	fn(&next)
	s.cur.Store(&next)
	for _, w := range s.watchers {
		w(old, &next) // synchronous; blocks under writer mutex
	}
}
```

Pro: simple, ordered, no goroutines.

Con: a slow watcher blocks all writers and other watchers.

### Pattern 2: Asynchronous watcher

```go
for _, w := range s.watchers {
	go w(old, &next)
}
```

Pro: writer is fast.

Con: watchers may run out of order; concurrent watchers may interfere.

### Pattern 3: Channel-based notification

```go
type Store struct {
	cur atomic.Pointer[Config]
	mu  sync.Mutex
	chs []chan *Config
}

func (s *Store) Subscribe() <-chan *Config {
	s.mu.Lock()
	defer s.mu.Unlock()
	ch := make(chan *Config, 1)
	s.chs = append(s.chs, ch)
	return ch
}

func (s *Store) Update(fn func(*Config)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	old := s.cur.Load()
	next := *old
	fn(&next)
	s.cur.Store(&next)
	for _, ch := range s.chs {
		select {
		case ch <- &next:
		default: // drop if subscriber is slow
		}
	}
}
```

Pro: subscribers consume at their own pace, no goroutines spawned per update.

Con: drop policy must be considered. Buffered channels with non-blocking send and "skip if full" is a common compromise.

### Pattern 4: Version-based polling

Subscribers don't get pushed updates; they poll:

```go
last := int64(0)
for {
	cur := s.cur.Load()
	if cur.Version != last {
		handle(cur)
		last = cur.Version
	}
	time.Sleep(50 * time.Millisecond)
}
```

Simple, no infrastructure. Good when the polling latency is acceptable.

### Pattern 5: Closed-channel "edge" notification

Every write closes a channel and replaces it with a fresh one. Subscribers wait on the channel and re-load when it closes.

```go
type Store struct {
	cur atomic.Pointer[Config]
	mu  sync.Mutex
	ch  atomic.Pointer[chan struct{}]
}

func (s *Store) Notify() <-chan struct{} { return *s.ch.Load() }

func (s *Store) Update(...) {
	// ... store next
	old := s.ch.Load()
	next := make(chan struct{})
	s.ch.Store(&next)
	close(*old)
}
```

Subscribers:

```go
for {
	notif := s.Notify()
	cur := s.Get()
	process(cur)
	<-notif // blocks until next update
}
```

Edge-triggered: one wakeup per change, regardless of subscriber count. Cheap.

---

## Hot-Reload Patterns

A hot-reload is COW's canonical use case. Get this right and your service can survive most config-change incidents.

### Idiom: Reload returns an error; on error, the old snapshot remains current

```go
func (s *Store) Reload() error {
	next, err := s.load() // I/O, parsing, validation
	if err != nil {
		return err
	}
	s.cur.Store(next)
	return nil
}
```

A failed reload should never crash the service.

### Idiom: Validate before publish

```go
func validate(c *Config) error {
	if c.ListenAddr == "" {
		return errors.New("listen_addr required")
	}
	if c.MaxRetries < 0 {
		return errors.New("max_retries must be >= 0")
	}
	for _, h := range c.AllowedHosts {
		if _, err := url.Parse(h); err != nil {
			return fmt.Errorf("bad host %q: %w", h, err)
		}
	}
	return nil
}
```

Validation lives between parse and publish. A valid `*Config` reaches `Store`; an invalid one is returned as an error.

### Idiom: Source pluggability

Decouple "where the config comes from" from "how it's published":

```go
type Source interface {
	Load(context.Context) (*Config, error)
}

type FileSource struct{ Path string }
type EtcdSource struct{ Client *etcd.Client; Key string }
type EnvSource struct{}

func (s *Store) Reload(ctx context.Context) error {
	next, err := s.src.Load(ctx)
	if err != nil { return err }
	if err := validate(next); err != nil { return err }
	s.cur.Store(next)
	return nil
}
```

Testing becomes trivial: inject a `Source` that returns a fixture.

### Idiom: Reload-triggered side effects

Some config changes require side effects beyond updating the snapshot — e.g., a new TLS cert requires reloading the server's TLS config.

```go
func (s *Store) Reload() error {
	next, err := s.load()
	if err != nil { return err }
	if err := s.applySideEffects(next); err != nil {
		return err // don't publish if side effects fail
	}
	s.cur.Store(next)
	return nil
}
```

If side effects can fail partway, you have a partial-failure problem — common in config reload. Mitigations:

- Make side effects idempotent so retrying is safe.
- Use a "two-phase" reload: prepare, then commit. Prepare can fail; commit cannot.

### Idiom: Concurrent reloads

`Reload()` is called from a signal handler, a poll loop, an admin API, and a test, all concurrently. The writer mutex serialises them. The second concurrent call simply waits for the first.

### Idiom: Periodic reload with exponential backoff on failure

```go
func PollLoop(ctx context.Context, s *Store, base time.Duration) {
	delay := base
	for {
		err := s.Reload()
		if err != nil {
			delay = min(delay*2, time.Minute)
		} else {
			delay = base
		}
		select {
		case <-time.After(delay):
		case <-ctx.Done():
			return
		}
	}
}
```

---

## Error Handling and Validation

COW makes "validate before publish" easy and obvious. Use this strength.

### Validation surface area

- Schema: required fields present, types correct.
- Semantic: ranges, mutual exclusion (e.g., "if X then not Y").
- Cross-field: consistency (e.g., MaxRetries × RetryDelay < TotalTimeout).
- External: references to existing resources (e.g., DB connectivity).

### Validation order

Cheap checks first; expensive last:

```go
func validate(c *Config) error {
	if c.MaxRetries < 0 { return ... }   // O(1)
	for _, h := range c.AllowedHosts {    // O(N)
		if _, err := url.Parse(h); err != nil { return ... }
	}
	if err := pingDB(c.DBURL); err != nil { return ... } // O(network)
	return nil
}
```

Fail fast on cheap errors; reserve expensive checks for after the cheap ones pass.

### Error wrapping

```go
return fmt.Errorf("invalid host %q at index %d: %w", h, i, err)
```

Operators read these errors. Make them actionable.

### Publishing partial validation

Sometimes a "partial" snapshot is acceptable — e.g., new hosts are added even if some failed validation. Decide explicitly:

```go
var validHosts []string
for _, h := range raw.Hosts {
	if _, err := url.Parse(h); err != nil {
		log.Printf("skipping invalid host %q: %v", h, err)
		continue
	}
	validHosts = append(validHosts, h)
}
next := *old
next.Hosts = validHosts
cur.Store(&next)
```

Log all skipped items; emit a metric for "invalid items skipped".

### Atomic validation across updates

`Update` already gives you atomicity: you can validate cross-field consistency after applying all changes.

```go
func (s *Store) Update(fn func(*Config) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	old := s.cur.Load()
	next := *old
	if err := fn(&next); err != nil { return err }
	if err := validate(&next); err != nil { return err }
	s.cur.Store(&next)
	return nil
}
```

---

## Observability

Make COW visible. Three pieces of telemetry pay for themselves.

### Metric 1: Snapshot version (or generation)

```go
metrics.ConfigGeneration.Set(float64(cfg.Load().Version))
```

If the gauge is the same on two pods, they have the same config. Operators love this.

### Metric 2: Snapshot age

```go
type Snapshot struct {
	PublishedAt time.Time
	// ...
}

metrics.ConfigAgeSeconds.Set(time.Since(cfg.Load().PublishedAt).Seconds())
```

A stuck reload is visible as ever-rising age.

### Metric 3: Reload success/failure counters

```go
func (s *Store) Reload() error {
	defer func() {
		metrics.ReloadAttempts.Inc()
	}()
	// ...
	if err != nil {
		metrics.ReloadFailures.Inc()
		return err
	}
	metrics.ReloadSuccesses.Inc()
	return nil
}
```

A reload-failure spike correlates with operator changes; show it on the deploy dashboard.

### Logs at write boundaries

```go
log.Printf("config reloaded: version=%d hosts=%d log_level=%s",
	next.Version, len(next.Hosts), next.LogLevel)
```

One log line per snapshot publish. Easy to grep, easy to alert on.

### `expvar` for debugging

```go
expvar.Publish("config", expvar.Func(func() any { return cfg.Load() }))
```

Hit `/debug/vars` to see the live snapshot. Invaluable in incidents.

### `pprof.Labels` to identify long readers

```go
pprof.SetGoroutineLabels(pprof.WithLabels(ctx, pprof.Labels("snapshot", "v42")))
```

A `goroutine` profile then shows which version each goroutine is holding — useful for finding "this goroutine pinned an old 100 MB snapshot for 10 minutes."

---

## Testing COW Code

The race detector is your best friend. Make every COW test run with `-race`.

### Test 1: Basic load/store

```go
func TestLoadStore(t *testing.T) {
	s := NewStore(&Config{N: 1})
	if s.Get().N != 1 { t.Fatal("initial") }
	s.Update(func(c *Config) { c.N = 2 })
	if s.Get().N != 2 { t.Fatal("after update") }
}
```

### Test 2: Old snapshot remains valid

```go
func TestOldSnapshot(t *testing.T) {
	s := NewStore(&Config{N: 1})
	old := s.Get()
	s.Update(func(c *Config) { c.N = 2 })
	if old.N != 1 {
		t.Fatal("old snapshot mutated!")
	}
}
```

This is the immutability assertion.

### Test 3: Concurrent reads do not race

```go
func TestConcurrentReads(t *testing.T) {
	s := NewStore(&Config{Hosts: []string{"a", "b"}})
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 1000; j++ {
				_ = s.Get().Hosts
			}
		}()
	}
	wg.Wait()
}
```

Run with `-race`. Any read-side bug surfaces immediately.

### Test 4: Concurrent writes serialize correctly

```go
func TestConcurrentWrites(t *testing.T) {
	s := NewStore(&Counter{N: 0})
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.Update(func(c *Counter) { c.N++ })
		}()
	}
	wg.Wait()
	if s.Get().N != 100 {
		t.Fatalf("expected 100, got %d", s.Get().N)
	}
}
```

If you used CAS without a loop, this test fails. If you used a mutex, it passes.

### Test 5: Mixed read/write under race

The "torture test". Run reads and writes concurrently for several seconds with the race detector enabled.

```go
func TestRaceTorture(t *testing.T) {
	s := NewStore(&Config{Hosts: []string{}})
	stop := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for {
				select {
				case <-stop: return
				default:
					s.Update(func(c *Config) {
						c.Hosts = append([]string(nil), c.Hosts...)
						c.Hosts = append(c.Hosts, "h")
					})
				}
			}
		}(i)
	}
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop: return
				default:
					_ = len(s.Get().Hosts)
				}
			}
		}()
	}
	time.Sleep(2 * time.Second)
	close(stop)
	wg.Wait()
}
```

If the race detector reports anything, you have an immutability bug.

### Test 6: Reload error path

```go
func TestReloadFailure(t *testing.T) {
	s := NewStore(&Config{N: 1})
	src := &mockSource{err: errors.New("nope")}
	s.src = src
	if err := s.Reload(); err == nil {
		t.Fatal("expected error")
	}
	if s.Get().N != 1 {
		t.Fatal("snapshot changed despite error")
	}
}
```

The crucial assertion: failed reloads do not replace the current snapshot.

### Test 7: Watcher delivery

```go
func TestWatcher(t *testing.T) {
	s := NewStore(&Config{N: 1})
	got := make(chan int, 1)
	s.Watch(func(old, new *Config) { got <- new.N })
	s.Update(func(c *Config) { c.N = 2 })
	select {
	case n := <-got:
		if n != 2 { t.Fatal("watcher got wrong value") }
	case <-time.After(time.Second):
		t.Fatal("watcher not fired")
	}
}
```

---

## Benchmark-Driven Decisions

Don't guess; measure. Three benchmarks to run for every COW design.

### Benchmark 1: Pure read throughput

```go
func BenchmarkRead(b *testing.B) {
	s := NewStore(&Config{N: 1})
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_ = s.Get().N
		}
	})
}
```

Establishes the baseline. Expect ~1.5–3 ns/op.

### Benchmark 2: Write latency

```go
func BenchmarkWrite(b *testing.B) {
	s := NewStore(&Config{N: 1})
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		s.Update(func(c *Config) { c.N++ })
	}
}
```

For tiny configs, ~150–300 ns. For 10 000-entry maps, ~500 µs.

### Benchmark 3: Mixed workload

```go
func BenchmarkMixed90R10W(b *testing.B) {
	s := NewStore(&Config{})
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			i++
			if i%10 == 0 {
				s.Update(func(c *Config) { c.N++ })
			} else {
				_ = s.Get().N
			}
		}
	})
}
```

Compare to the same benchmark using `sync.RWMutex` or `sync.Map` to see which wins at your read/write ratio.

### Benchmarking the GC

For write-heavy workloads, the GC may dominate:

```go
func BenchmarkWriteWithGC(b *testing.B) {
	s := NewStore(&BigConfig{Data: make(map[int]string, 10000)})
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		s.Update(func(c *BigConfig) {
			c.Data = copyMap(c.Data)
			c.Data[i] = "x"
		})
	}
}
```

`-benchmem` shows allocation rate. If allocs/op is much higher than ns/op, the GC is the bottleneck.

---

## Common Pitfalls at Scale

### Pitfall 1: A growing slice of subscribers

If your watcher list grows without bound (subscribers never unsubscribe), every `Update` walks an ever-larger list. Provide unsubscribe.

### Pitfall 2: A goroutine pinned to an old snapshot

A long-running goroutine that loads once and never re-loads pins the snapshot. If your snapshots are 100 MB, you accumulate hundreds of MB unnecessarily.

Fix: re-load periodically or on a notification.

### Pitfall 3: Writer mutex held during I/O

A writer that holds the mutex during a slow `os.ReadFile` blocks all other writers. Load outside the lock:

```go
data, err := os.ReadFile(path)  // outside
if err != nil { return err }
mu.Lock()
defer mu.Unlock()
// ... build snapshot from data, publish
```

But beware: another writer may have updated the snapshot between your load and your publish. If you must base your new snapshot on the *latest* old one (read-modify-write), you must do the read inside the lock.

### Pitfall 4: Writer mutex contention

If you have many concurrent writers (e.g., one per API call), the writer mutex serialises them. At thousands of writes per second, the mutex becomes a bottleneck.

Fix: shard, batch, or use single-writer goroutine.

### Pitfall 5: Snapshot drift between processes

In a multi-process deployment, each process has its own snapshot. A control-plane update reaches each process at a slightly different time. Operators expect "instant" updates; reality is "eventually, within seconds." Document this.

### Pitfall 6: Snapshot in shared memory

You cannot share an `atomic.Pointer[T]` across processes via shared memory — Go's GC does not know about cross-process pointers. For cross-process COW, use mmap and a serialised format.

### Pitfall 7: Misleading happiness

A COW system "feels fast" because reads are 1.5 ns. But writes may be silently expensive. Always benchmark both paths.

### Pitfall 8: Cascading snapshots

```go
type Outer struct {
	Inner atomic.Pointer[Inner] // BUG: atomic.Pointer inside a copyable snapshot
}
```

If `Outer` is itself a COW snapshot that gets copied, every copy shares the same inner atomic pointer. Worse, copying an `atomic.Pointer` is not safe (race).

Either flatten or compose carefully — typically by holding only one snapshot per data unit.

### Pitfall 9: Slow watchers blocking writers

Synchronous watchers run under the writer mutex. A slow watcher slows all writers and all other watchers. Fan out to goroutines if any watcher might block.

### Pitfall 10: Update fairness

Under heavy load, the writer mutex may starve some writers. `sync.Mutex` is FIFO-ish but not guaranteed fair. For strict fairness, use a queue and a single-writer goroutine.

---

## Best Practices

1. **Design the snapshot type for deep immutability.** Document the contract.
2. **One Load per logical operation.** Cache the pointer.
3. **Use `atomic.Pointer[T]` on Go 1.19+.** Avoid `atomic.Value` in new code.
4. **Serialise writers with a mutex by default.** Move to CAS or single-writer only with cause.
5. **Validate before publish.** Failed reloads do not replace the current snapshot.
6. **Measure read latency, write latency, and GC pressure.** Don't guess.
7. **Provide an Update closure API.** Hide the load-copy-publish details.
8. **Watcher dispatch is asynchronous unless watchers are trivial.**
9. **Pin the snapshot at request boundaries.** Pass it via context, not via globals.
10. **Add observability: version, age, reload success/failure metrics.**
11. **Test with the race detector. Always.**
12. **Have a fallback plan if writes become frequent.** Sharded COW, persistent structures, or switch to `sync.Map`.

---

## Self-Assessment

- [ ] I can choose between COW, RWMutex, sync.Map, and sharded mutex for a given workload.
- [ ] I can design a snapshot type that is deeply immutable by convention.
- [ ] I know three writer coordination strategies and when to use each.
- [ ] I can batch writes to reduce GC pressure without breaking writer ergonomics.
- [ ] I can build a COW map with `Set`, `Delete`, `Range`, and concurrent-safe behavior.
- [ ] I can sketch a sharded COW implementation and explain its trade-offs.
- [ ] I know why a synchronous watcher can become a problem.
- [ ] I can write tests that detect mutation-after-publish bugs.
- [ ] I can benchmark a COW design against an RWMutex and sync.Map alternative.
- [ ] I know what observability to add for a production COW store.

---

## Summary

At the middle level, COW stops being "a primitive" and becomes "an architectural choice". You decide between COW and its alternatives based on read/write ratio, snapshot size, latency variance, and consistency requirements. You design the snapshot type for deep immutability, choosing accessor methods over raw field exposure. You pick a writer coordination strategy — mutex, CAS, single-writer, batched — that fits your write profile. You add observability so the snapshot state is visible at runtime. You test with the race detector and benchmark against alternatives.

The patterns at this level are pragmatic engineering rather than algorithmic. The next level — senior — introduces persistent data structures, structural sharing, RCU-style updates, and the algorithmic side of making COW work at scale. The professional level after that goes into memory ordering, GC interaction, and the low-level mechanics of `atomic.Pointer[T]`.

---

## Deep Dive: A Realistic COW Configuration Subsystem

To consolidate the middle-level patterns, here is a complete design for a realistic configuration subsystem. It includes pluggable sources, validation, watchers with backpressure, observability, and a test suite.

### File layout

```
config/
  config.go      // Config type + validation
  store.go       // Store: cur + writeMu + watchers
  source.go      // Source interface + implementations
  reload.go      // poll loop + SIGHUP handler
  metrics.go     // observability hooks
  store_test.go
  source_test.go
```

### config.go

```go
package config

import (
	"errors"
	"fmt"
	"net/url"
	"time"
)

// Config is an immutable configuration snapshot.
// After being returned from Store.Get or stored via Store.Update,
// it MUST NOT be modified.
type Config struct {
	Version       int64
	PublishedAt   time.Time
	ListenAddr    string
	ReadTimeout   time.Duration
	WriteTimeout  time.Duration
	MaxRetries    int
	AllowedHosts  []string
	BackendURLs   []string
	DefaultLocale string
	FeatureFlags  map[string]bool
}

// Clone returns a deep copy of c. Use when you need a writable copy.
func (c *Config) Clone() *Config {
	cp := *c
	cp.AllowedHosts = append([]string(nil), c.AllowedHosts...)
	cp.BackendURLs = append([]string(nil), c.BackendURLs...)
	cp.FeatureFlags = make(map[string]bool, len(c.FeatureFlags))
	for k, v := range c.FeatureFlags {
		cp.FeatureFlags[k] = v
	}
	return &cp
}

// Validate returns nil if c is a usable configuration.
func (c *Config) Validate() error {
	if c.ListenAddr == "" {
		return errors.New("listen_addr is required")
	}
	if c.ReadTimeout < 0 {
		return errors.New("read_timeout must be non-negative")
	}
	if c.WriteTimeout < 0 {
		return errors.New("write_timeout must be non-negative")
	}
	if c.MaxRetries < 0 {
		return errors.New("max_retries must be non-negative")
	}
	for i, h := range c.AllowedHosts {
		if h == "" {
			return fmt.Errorf("allowed_hosts[%d] is empty", i)
		}
	}
	for i, u := range c.BackendURLs {
		parsed, err := url.Parse(u)
		if err != nil {
			return fmt.Errorf("backend_urls[%d] invalid: %w", i, err)
		}
		if parsed.Scheme == "" || parsed.Host == "" {
			return fmt.Errorf("backend_urls[%d] missing scheme or host", i)
		}
	}
	return nil
}

// FeatureEnabled is a snapshot accessor that hides the internal map.
func (c *Config) FeatureEnabled(name string) bool {
	return c.FeatureFlags[name]
}
```

### source.go

```go
package config

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
)

// Source produces a Config. Implementations may read files, etcd, env, etc.
type Source interface {
	Load(ctx context.Context) (*Config, error)
	Name() string
}

type FileSource struct{ Path string }

func (f *FileSource) Name() string { return "file:" + f.Path }

func (f *FileSource) Load(ctx context.Context) (*Config, error) {
	data, err := os.ReadFile(f.Path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", f.Path, err)
	}
	var c Config
	if err := json.Unmarshal(data, &c); err != nil {
		return nil, fmt.Errorf("parse %s: %w", f.Path, err)
	}
	return &c, nil
}

type StaticSource struct{ C *Config }

func (s *StaticSource) Name() string                    { return "static" }
func (s *StaticSource) Load(_ context.Context) (*Config, error) {
	return s.C.Clone(), nil
}
```

### store.go

```go
package config

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

// Store is a goroutine-safe configuration store.
// Readers call Get; writers call Update or Reload.
type Store struct {
	cur      atomic.Pointer[Config]
	writeMu  sync.Mutex
	source   Source
	watchers []chan *Config
	nextVer  int64
	clock    func() time.Time
	metrics  *Metrics
}

func NewStore(initial *Config, src Source) (*Store, error) {
	if err := initial.Validate(); err != nil {
		return nil, err
	}
	s := &Store{
		source:  src,
		nextVer: 1,
		clock:   time.Now,
		metrics: NewMetrics(),
	}
	initial.Version = s.nextVer
	initial.PublishedAt = s.clock()
	s.cur.Store(initial)
	s.nextVer++
	return s, nil
}

func (s *Store) Get() *Config { return s.cur.Load() }

func (s *Store) Update(fn func(*Config) error) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	old := s.cur.Load()
	next := old.Clone()
	if err := fn(next); err != nil {
		s.metrics.UpdateFailure.Inc()
		return err
	}
	if err := next.Validate(); err != nil {
		s.metrics.UpdateInvalid.Inc()
		return err
	}
	next.Version = s.nextVer
	next.PublishedAt = s.clock()
	s.nextVer++
	s.cur.Store(next)
	s.metrics.UpdateSuccess.Inc()
	s.fanout(old, next)
	return nil
}

func (s *Store) Reload(ctx context.Context) error {
	loaded, err := s.source.Load(ctx)
	if err != nil {
		s.metrics.ReloadFailure.Inc()
		return err
	}
	if err := loaded.Validate(); err != nil {
		s.metrics.ReloadInvalid.Inc()
		return err
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	old := s.cur.Load()
	loaded.Version = s.nextVer
	loaded.PublishedAt = s.clock()
	s.nextVer++
	s.cur.Store(loaded)
	s.metrics.ReloadSuccess.Inc()
	s.fanout(old, loaded)
	return nil
}

// Subscribe returns a buffered channel that receives every new snapshot.
// If the subscriber is slow, snapshots may be dropped (non-blocking send).
// Call the returned unsubscribe function to remove the channel.
func (s *Store) Subscribe() (<-chan *Config, func()) {
	ch := make(chan *Config, 4)
	s.writeMu.Lock()
	s.watchers = append(s.watchers, ch)
	s.writeMu.Unlock()
	unsub := func() {
		s.writeMu.Lock()
		defer s.writeMu.Unlock()
		for i, w := range s.watchers {
			if w == ch {
				s.watchers = append(s.watchers[:i], s.watchers[i+1:]...)
				close(ch)
				return
			}
		}
	}
	return ch, unsub
}

func (s *Store) fanout(old, new *Config) {
	for _, ch := range s.watchers {
		select {
		case ch <- new:
		default:
			s.metrics.WatcherDrop.Inc()
		}
	}
}
```

### reload.go

```go
package config

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func WatchSIGHUP(ctx context.Context, s *Store) {
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGHUP)
	defer signal.Stop(sigs)
	for {
		select {
		case <-sigs:
			_ = s.Reload(ctx)
		case <-ctx.Done():
			return
		}
	}
}

func PollLoop(ctx context.Context, s *Store, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			_ = s.Reload(ctx)
		case <-ctx.Done():
			return
		}
	}
}
```

### metrics.go

```go
package config

import "sync/atomic"

type Counter struct{ n atomic.Int64 }

func (c *Counter) Inc()        { c.n.Add(1) }
func (c *Counter) Value() int64 { return c.n.Load() }

type Metrics struct {
	UpdateSuccess Counter
	UpdateFailure Counter
	UpdateInvalid Counter
	ReloadSuccess Counter
	ReloadFailure Counter
	ReloadInvalid Counter
	WatcherDrop   Counter
}

func NewMetrics() *Metrics { return &Metrics{} }
```

### store_test.go

```go
package config

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func mkInitial() *Config {
	return &Config{
		ListenAddr:    ":8080",
		ReadTimeout:   5 * time.Second,
		WriteTimeout:  5 * time.Second,
		MaxRetries:    3,
		AllowedHosts:  []string{"example.com"},
		BackendURLs:   []string{"http://backend:9090"},
		DefaultLocale: "en-US",
		FeatureFlags:  map[string]bool{"new_ui": true},
	}
}

func TestStoreBasics(t *testing.T) {
	s, err := NewStore(mkInitial(), &StaticSource{C: mkInitial()})
	if err != nil {
		t.Fatal(err)
	}
	c := s.Get()
	if c.ListenAddr != ":8080" {
		t.Fatal("listen addr")
	}
	if c.Version != 1 {
		t.Fatalf("expected v1, got v%d", c.Version)
	}
}

func TestUpdateValidation(t *testing.T) {
	s, _ := NewStore(mkInitial(), &StaticSource{C: mkInitial()})
	err := s.Update(func(c *Config) error {
		c.MaxRetries = -1
		return nil
	})
	if err == nil {
		t.Fatal("expected validation error")
	}
	if s.Get().MaxRetries != 3 {
		t.Fatal("snapshot changed despite invalid update")
	}
}

func TestUpdateError(t *testing.T) {
	s, _ := NewStore(mkInitial(), &StaticSource{C: mkInitial()})
	err := s.Update(func(c *Config) error { return errors.New("user error") })
	if err == nil {
		t.Fatal("expected error")
	}
	if s.Get().Version != 1 {
		t.Fatal("snapshot version changed after failed update")
	}
}

func TestUpdateSuccess(t *testing.T) {
	s, _ := NewStore(mkInitial(), &StaticSource{C: mkInitial()})
	err := s.Update(func(c *Config) error {
		c.MaxRetries = 5
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if s.Get().MaxRetries != 5 {
		t.Fatal("update did not take effect")
	}
	if s.Get().Version != 2 {
		t.Fatalf("expected v2, got v%d", s.Get().Version)
	}
}

func TestSubscribeReceivesUpdates(t *testing.T) {
	s, _ := NewStore(mkInitial(), &StaticSource{C: mkInitial()})
	ch, unsub := s.Subscribe()
	defer unsub()
	go func() {
		_ = s.Update(func(c *Config) error { c.MaxRetries = 7; return nil })
	}()
	select {
	case c := <-ch:
		if c.MaxRetries != 7 {
			t.Fatalf("expected 7, got %d", c.MaxRetries)
		}
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for subscriber")
	}
}

func TestConcurrentReadsAndWrites(t *testing.T) {
	s, _ := NewStore(mkInitial(), &StaticSource{C: mkInitial()})
	stop := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop: return
				default:
					_ = s.Get().MaxRetries
				}
			}
		}()
	}
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for {
				select {
				case <-stop: return
				default:
					_ = s.Update(func(c *Config) error { c.MaxRetries = i + 1; return nil })
				}
			}
		}(i)
	}
	time.Sleep(500 * time.Millisecond)
	close(stop)
	wg.Wait()
}

func TestReloadFromSource(t *testing.T) {
	src := &StaticSource{C: mkInitial()}
	s, _ := NewStore(mkInitial(), src)
	src.C.MaxRetries = 9
	if err := s.Reload(context.Background()); err != nil {
		t.Fatal(err)
	}
	if s.Get().MaxRetries != 9 {
		t.Fatal("reload did not apply")
	}
}
```

This is the full middle-level production pattern. Run with `go test -race ./...` and observe everything passing.

---

## Architectural Patterns

### Pattern: Config + Resources separated

A common mistake is to put live resources (database handles, HTTP clients) inside a COW config snapshot. Resources have their own lifecycle and concurrency model; mixing them into immutable snapshots leads to surprising bugs.

The clean separation:

```go
type Config struct {        // immutable snapshot
	DBURL string
	APIKey string
}

type Resources struct {     // live resources
	DB   *sql.DB
	HTTP *http.Client
}

type App struct {
	cfg  *config.Store
	res  *Resources
}

func (a *App) Handle(req *http.Request) {
	c := a.cfg.Get()        // snapshot
	if !a.res.HTTP.... { } // live resource
}
```

A reload changes the config snapshot. If the reload requires reopening a database connection, that is a separate explicit step:

```go
func (a *App) Reload(ctx context.Context) error {
	if err := a.cfg.Reload(ctx); err != nil { return err }
	c := a.cfg.Get()
	if c.DBURL != a.lastDBURL {
		newDB, err := sql.Open("postgres", c.DBURL)
		if err != nil { return err }
		oldDB := a.res.DB
		a.res.DB = newDB        // race here! Use atomic.Pointer if shared.
		oldDB.Close()
		a.lastDBURL = c.DBURL
	}
	return nil
}
```

The split prevents the snapshot from carrying mutable state.

### Pattern: Snapshot of snapshots

When two related pieces of state must be consistent, put them in one outer snapshot:

```go
type Combined struct {
	Config   *Config
	Features *FeatureSet
}

var combined atomic.Pointer[Combined]
```

A single `Update` rebuilds both. Readers get a consistent view across both.

The alternative — two separate atomic pointers — gives independent reload but introduces the risk of "new config, old features" briefly visible.

### Pattern: Hierarchical config

For complex services with hundreds of configurable knobs, group:

```go
type Config struct {
	HTTP    *HTTPConfig
	DB      *DBConfig
	Cache   *CacheConfig
	Logging *LoggingConfig
}
```

Each sub-config is itself immutable. Operators see meaningful groupings; the snapshot rebuild is still cheap because sub-configs share pointers across versions when unchanged.

```go
old := cfg.Load()
next := *old
// Only HTTPConfig changes; DB, Cache, Logging keep their pointers.
nextHTTP := *old.HTTP
nextHTTP.ReadTimeout = 10 * time.Second
next.HTTP = &nextHTTP
cfg.Store(&next)
```

This is *structural sharing* in its simplest form, applied at the struct-field level.

### Pattern: Layered config

Many systems layer configs:

```go
type Layered struct {
	Defaults *Config
	Env      *Config
	File     *Config
	Override *Config
}

func (l *Layered) Effective() *Config {
	out := *l.Defaults
	merge(&out, l.Env)
	merge(&out, l.File)
	merge(&out, l.Override)
	return &out
}
```

The store holds the layered structure; readers retrieve the effective config. Reloads can target individual layers.

---

## Pattern: COW for Routing Tables

A reverse-proxy routing table is a canonical COW use case.

```go
type Route struct {
	Prefix  string
	Backend string
	Headers map[string]string
}

type RouteTable struct {
	routes []Route // sorted by prefix length, longest first
	byPath map[string]int // exact-path overrides
}

func (t *RouteTable) Match(path string) (Route, bool) {
	if i, ok := t.byPath[path]; ok {
		return t.routes[i], true
	}
	for _, r := range t.routes {
		if strings.HasPrefix(path, r.Prefix) {
			return r, true
		}
	}
	return Route{}, false
}

var table atomic.Pointer[RouteTable]
var tableMu sync.Mutex

func ReloadRoutes(newRoutes []Route) {
	tableMu.Lock()
	defer tableMu.Unlock()
	sort.Slice(newRoutes, func(i, j int) bool {
		return len(newRoutes[i].Prefix) > len(newRoutes[j].Prefix)
	})
	byPath := make(map[string]int)
	for i, r := range newRoutes {
		if !strings.HasSuffix(r.Prefix, "/") {
			byPath[r.Prefix] = i
		}
	}
	table.Store(&RouteTable{routes: newRoutes, byPath: byPath})
}

func RouteFor(path string) (string, bool) {
	r, ok := table.Load().Match(path)
	return r.Backend, ok
}
```

Reads happen on every request. Updates happen on every deploy. The pattern fits exactly.

### Performance characteristics

- Pure read at p50: ~5 ns (one atomic load + map lookup or prefix scan).
- Update for 1 000-route table: ~1 ms (sort + map build).
- Memory per version: ~100 KB.

For 100 000 requests/sec across 16 cores, total CPU time for routing is ~500 µs/sec — negligible. RWMutex would consume 10× more.

---

## Pattern: COW for TLS Certificate Rotation

```go
type tlsStore struct {
	cur     atomic.Pointer[tls.Config]
	mu      sync.Mutex
}

func (s *tlsStore) Get() *tls.Config { return s.cur.Load() }

func (s *tlsStore) GetCertificate(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
	c := s.cur.Load()
	if len(c.Certificates) == 0 {
		return nil, errors.New("no certificate available")
	}
	return &c.Certificates[0], nil
}

func (s *tlsStore) Rotate(certPath, keyPath string) error {
	cert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil { return err }
	s.mu.Lock()
	defer s.mu.Unlock()
	old := s.cur.Load()
	next := old.Clone()
	next.Certificates = []tls.Certificate{cert}
	s.cur.Store(next)
	return nil
}
```

New TLS connections after `Rotate` use the new certificate. Existing handshakes finish on the old one.

The server is wired up via:

```go
srv := &http.Server{
	TLSConfig: &tls.Config{GetCertificate: store.GetCertificate},
}
```

A SIGHUP handler triggers `store.Rotate(...)`. Cert rotation without a restart.

---

## Pattern: COW for Feature Flags

Feature flags are typically read on every request and updated occasionally. COW is the natural fit.

```go
type FlagSet struct {
	bits map[string]bool
}

func (f *FlagSet) Enabled(name string) bool { return f.bits[name] }

func (f *FlagSet) WithFlag(name string, on bool) *FlagSet {
	next := make(map[string]bool, len(f.bits)+1)
	for k, v := range f.bits {
		next[k] = v
	}
	next[name] = on
	return &FlagSet{bits: next}
}

var flags atomic.Pointer[FlagSet]
var flagMu sync.Mutex

func SetFlag(name string, on bool) {
	flagMu.Lock()
	defer flagMu.Unlock()
	flags.Store(flags.Load().WithFlag(name, on))
}

func Enabled(name string) bool { return flags.Load().Enabled(name) }
```

The `WithFlag` method is a functional-style update that returns a new `*FlagSet`. The store just publishes the result.

---

## Pattern: COW for a Multi-Tenant Routing Map

A SaaS service routes requests to per-tenant backends:

```go
type TenantRoute struct {
	Backend   string
	RateLimit int
}

type TenantMap struct {
	byID map[string]TenantRoute
}

var tmap atomic.Pointer[TenantMap]

func GetRoute(tenantID string) (TenantRoute, bool) {
	r, ok := tmap.Load().byID[tenantID]
	return r, ok
}
```

With 10 000 tenants, each `Set` rebuilds the whole map (~1 ms, ~500 KB). At 1 update per second this is ~500 KB/sec of allocations — well within GC limits. At 100 updates per second you should shard.

### Sharded version

```go
const TShards = 16

type ShardedTenantMap struct {
	shards [TShards]atomic.Pointer[map[string]TenantRoute]
	mus    [TShards]sync.Mutex
}

func (m *ShardedTenantMap) shardFor(id string) int {
	h := fnv.New32()
	h.Write([]byte(id))
	return int(h.Sum32()) % TShards
}

func (m *ShardedTenantMap) Get(id string) (TenantRoute, bool) {
	r, ok := (*m.shards[m.shardFor(id)].Load())[id]
	return r, ok
}

func (m *ShardedTenantMap) Set(id string, r TenantRoute) {
	i := m.shardFor(id)
	m.mus[i].Lock()
	defer m.mus[i].Unlock()
	old := *m.shards[i].Load()
	next := make(map[string]TenantRoute, len(old)+1)
	for k, v := range old { next[k] = v }
	next[id] = r
	m.shards[i].Store(&next)
}
```

Each shard rebuilds independently. With 16 shards, each contains ~600 entries, and a rebuild costs ~50 µs.

---

## Cross-Cutting Concerns

### Logging

A common need: log every snapshot change with the diff.

```go
func logChange(old, new *Config) {
	if old.MaxRetries != new.MaxRetries {
		log.Printf("config: max_retries %d -> %d (v%d)", old.MaxRetries, new.MaxRetries, new.Version)
	}
	if !sameStrings(old.AllowedHosts, new.AllowedHosts) {
		log.Printf("config: allowed_hosts changed (v%d): %v -> %v", new.Version, old.AllowedHosts, new.AllowedHosts)
	}
	// ... etc
}
```

For larger configs, generate the diff with `reflect.DeepEqual` or `cmp.Diff`. Operators love readable diffs.

### Auditing

Persist every snapshot for compliance:

```go
func auditOnPublish(old, new *Config) {
	b, _ := json.Marshal(new)
	auditLog.Write(b)
}
```

Use a buffered writer so the audit does not block the writer mutex.

### Authorization

Some snapshot updates require authorization (e.g., feature-flag changes). Validate at the API boundary, not inside `Update`:

```go
func (api *API) SetFlag(w http.ResponseWriter, r *http.Request) {
	if !api.canMutateFlags(r) {
		http.Error(w, "forbidden", 403)
		return
	}
	api.store.Update(func(c *Config) error {
		c.FeatureFlags[name] = on
		return nil
	})
}
```

`Update` should not be responsible for authorization — it should accept any valid mutation.

---

## Anti-Patterns to Avoid

### Anti-pattern 1: Returning the raw snapshot and trusting the caller

```go
func GetConfig() *Config { return cfg.Load() } // public, can be mutated
```

External code may mutate. Defensive options:
- Return a clone.
- Make `Config` an interface with read-only methods.
- Document the contract and trust internal code (least costly, most error-prone).

### Anti-pattern 2: Updating the snapshot through aliased references

```go
c := cfg.Load()
c.Hosts = append(c.Hosts, "x") // BUG: aliased
cfg.Store(c)                   // re-publishes mutated snapshot
```

This is the most common COW bug. Always copy first.

### Anti-pattern 3: One `atomic.Pointer` per field

```go
var listenAddr atomic.Pointer[string]
var readTimeout atomic.Pointer[time.Duration]
var allowedHosts atomic.Pointer[[]string]
```

You lose snapshot consistency. A reader sees old listen addr + new read timeout. Group into a single struct snapshot.

### Anti-pattern 4: Reload inside a request handler

```go
func handle(w http.ResponseWriter, r *http.Request) {
	cfg.Reload(ctx) // blocks for I/O
	c := cfg.Get()
	// ...
}
```

A per-request reload kills latency. Reload from a dedicated goroutine.

### Anti-pattern 5: Reading multiple times in a hot loop

```go
for i := 0; i < 1000000; i++ {
	_ = cfg.Load().MaxRetries
}
```

Cache once at the top of the loop. A `Load` is ~1.5 ns but in a 1M loop that is 1.5 ms — wasted.

### Anti-pattern 6: Storing a `nil` snapshot

```go
cfg.Store(nil) // first Load returns nil; first dereference panics
```

Always store a usable default.

### Anti-pattern 7: Mixing `atomic.Value` and `atomic.Pointer[T]` for the same data

Pick one. Switching between them in different methods leads to chaos.

### Anti-pattern 8: Snapshot of snapshots without ordering

```go
var configA atomic.Pointer[A]
var configB atomic.Pointer[B]

// Writer:
configA.Store(newA)
configB.Store(newB) // reader between these sees mixed state
```

Either combine into one snapshot or accept transient inconsistency.

### Anti-pattern 9: Forgetting `defer unsub()` for subscribers

```go
ch, _ := store.Subscribe() // _ discards unsubscribe
```

The subscriber channel sticks around forever. Memory leak.

### Anti-pattern 10: Building snapshots inside watchers

```go
store.Subscribe(func(old, new *Config) {
	store.Update(...) // BUG: deadlock — writeMu is held
})
```

Watchers run under the writer mutex (in synchronous patterns). Calling Update from a watcher self-deadlocks. Either dispatch to a goroutine or break the cycle.

---

## Migration Strategies

### Migration: From `sync.RWMutex` to COW

A common refactor. Steps:

1. Identify the protected struct. Check that all reads are RLock + read + RUnlock.
2. Introduce an `atomic.Pointer[StructType]` next to the existing `RWMutex`.
3. Update the writer path: take the lock as before, but build a new struct and Store the pointer instead of mutating in place.
4. Update readers one at a time to use `p.Load()` instead of `RLock` + `RUnlock`.
5. When the last reader is migrated, the `RWMutex` becomes a writer-only mutex; rename for clarity.
6. Run with race detector.
7. Benchmark.

The intermediate state is safe: any reader that still uses `RLock` still sees a consistent struct. The migration can be incremental.

### Migration: From COW to `sync.Map`

If write rate climbs and your COW map becomes a bottleneck, switch to `sync.Map`. The challenge: any consumer that depended on snapshot consistency (e.g., `Range` over a consistent view) must be reworked.

Steps:

1. Identify all consumers that depend on snapshot consistency.
2. For those, either keep a separate COW snapshot of "consistency-critical subset" or restructure them to be tolerant of per-key consistency only.
3. Replace `Get`/`Set`/`Delete` with `Load`/`Store`/`Delete` on `sync.Map`.
4. Replace `Range over snapshot` with `sync.Map.Range`, noting its weaker consistency.
5. Benchmark.

### Migration: From COW to sharded COW

When the map grows large but you still want snapshot semantics per shard:

1. Pick a shard count (16, 32, 64).
2. Define `shardFor(key)` using a fast hash.
3. Replace single store with `[N]Store`.
4. Reads consult the right shard; writes consult the right shard's mutex.
5. Cross-shard operations (Range across all keys) lose consistency. Decide whether that matters.

### Migration: From COW to persistent data structure

If your map is huge (>1M entries) and writes are frequent enough that O(N) rebuilds hurt:

1. Pick a persistent map library (e.g., `github.com/benbjohnson/immutable`).
2. Wrap it in your COW store: the snapshot pointer points to a persistent map.
3. Writers call `m.Set(k, v)` which returns a new persistent map sharing most structure with the old one.
4. Reads call `m.Get(k)` — typically `O(log N)` instead of `O(1)`.
5. Benchmark — log-factor reads vs constant-time map lookups may flip the verdict on read performance.

---

## More Detailed Pitfalls

### Pitfall: Read amplification under a slow writer

A writer takes 100 ms to build a new snapshot. During those 100 ms, readers continue on the old snapshot. After `Store`, readers see the new snapshot. There is no read amplification — readers are not slowed down. The snapshot rebuild cost is paid entirely by the writer.

### Pitfall: Memory growth from short-lived snapshots

Each `Store` produces a new snapshot. The previous becomes unreachable from `cur` but may still be reachable from in-flight readers. Under high write rate, you can have dozens of snapshots in memory simultaneously.

Example: 1000 writes per second × 1 MB snapshot = up to 1 GB transient memory if readers are slow.

Mitigation: keep snapshots small; throttle writes; don't hold snapshot pointers across long operations.

### Pitfall: Snapshot identity vs equality

```go
a := store.Get()
b := store.Get()
fmt.Println(a == b) // true, IF no write happened between
fmt.Println(*a == *b) // comparing value; depends on fields
```

Use `a == b` to check "same snapshot" (pointer identity). Use `*a == *b` to check value equality (subject to types being comparable).

### Pitfall: `reflect.DeepEqual` on snapshots

`reflect.DeepEqual(a, b)` compares the structures pointed to, not the pointers. For COW, you usually want pointer identity:

```go
if a == b { return false } // unchanged
```

Cheaper and stronger than `DeepEqual`.

### Pitfall: Snapshot in a global variable in a library

```go
package mylib

var cfg atomic.Pointer[Config] // package-global
```

Two consumers of `mylib` share `cfg`. If they each call `Reload`, they race. If they each `Subscribe`, they see each other's updates.

Prefer per-instance state:

```go
type Client struct {
	cfg atomic.Pointer[Config]
}
```

### Pitfall: Subscriber forever-blocked channel

```go
ch := store.Subscribe()
for c := range ch {
	processSlowly(c) // 10 seconds per call
}
```

If updates arrive faster than the subscriber processes, the buffered channel fills. Non-blocking send drops updates. The subscriber receives only the latest few.

Decide explicitly: drop-old or block-writer. Documentation prevents surprise.

### Pitfall: Backoff in the writer

```go
mu.Lock()
defer mu.Unlock()
for {
	err := someExpensiveOp()
	if err != nil {
		time.Sleep(time.Second) // BUG: holds mu for a second
		continue
	}
	break
}
// build snapshot, store, return
```

Holding the mutex during a backoff sleeps all other writers. Restructure: do the expensive op outside the mutex; take the mutex only for build+store.

### Pitfall: Snapshot containing closures over outer state

```go
type Snapshot struct {
	OnEvent func(e Event) // closure over... what?
}
```

If `OnEvent` captures mutable state, the snapshot is no longer truly immutable. Trace the closure's captured variables.

### Pitfall: Snapshot equality via `==` requires comparability

`map[K]V` is not comparable. If your snapshot contains a map, `*a == *b` does not compile. Use a pointer-equality check on the snapshot itself, or a custom equality method.

### Pitfall: Time-of-check / time-of-use across snapshots

```go
if store.Get().Enabled {
	// ... 50 ms pass
	doExpensiveOperation() // Enabled might now be false in a newer snapshot
}
```

This is *intended* — the reader committed to the old snapshot at the if-check. But if your business logic requires "check Enabled immediately before each step", load explicitly.

---

## Additional Self-Assessment Questions

1. Given a 50 000-entry map and 500 writes/sec, would you choose COW, `sync.Map`, or sharded COW? Why?
2. How does a synchronous watcher introduce coupling between writers and observers? When is async dispatch worth the cost?
3. What's the difference between snapshot freshness and snapshot consistency? Give an example where you optimised for one at the cost of the other.
4. How does the writer mutex interact with the goroutine that subscribes to the store? Can a subscriber call `Update`?
5. What metrics would you add to monitor a COW config store in production?
6. How would you implement a `WithFlag(name, on)` operation on a feature-flag snapshot in three different ways (mutex, CAS, single-writer)?
7. What is the GC cost of 100 writes per second to a 1 MB snapshot? Is that acceptable?
8. Why does pinning a snapshot for the duration of a long-running goroutine cause memory growth?
9. Sketch a sharded COW design for a 1 M-entry map with 1 K writes/sec across 32 shards. What is the per-write cost?
10. When would you split a single COW snapshot into two independent ones, accepting transient inconsistency?

If any of these are unfamiliar territory, re-read the corresponding section before moving to senior.md.

---

## Closing Notes for Middle Level

At the middle level the key shift is from "I can write COW code" to "I can decide where COW belongs in my architecture." The decisions are:

- **Granularity.** One big snapshot vs many small ones.
- **Coordination.** Mutex vs CAS vs single-writer vs batched.
- **Composition.** COW around sync.Map; COW inside structures.
- **Lifetime.** Per-request snapshot pinning; periodic re-loads in long goroutines.
- **Observability.** Version, age, success/failure counters.
- **Migration paths.** When COW outgrows itself, you know where to go next.

You can ship a COW-based subsystem to production with confidence. The senior level expands the toolkit to persistent structures and RCU; the professional level dives under the runtime to memory ordering and codegen.

---

## Appendix: A Field Guide to Decisions

For quick on-the-job reference.

### "Should I use COW for this?"

| Question | If yes, lean toward... | If no, lean toward... |
|----------|------------------------|------------------------|
| Reads dominate writes 100:1 or more? | COW | Mutex / sync.Map |
| Snapshot smaller than 10 MB? | COW | Persistent structure or sharded |
| Need multi-field consistency? | COW | Per-field atomic |
| Tail latency budget under 1 ms? | COW (no writer-induced stalls) | RWMutex acceptable |
| Many writers at once? | Sharded COW or sync.Map | Plain COW |
| GC pressure must stay low? | Batched COW or persistent | Plain COW |
| External library returns mutable map? | Wrap or restructure first | Pass through |

### "How do I serialize writers?"

| Property | Pick |
|----------|------|
| Default; simple; <1 KHz writes | `sync.Mutex` |
| Writers must not block each other | CAS loop |
| Want backpressure + audit log | Single-writer goroutine |
| Bursty writes; care about GC | Batched flusher |

### "Should I expose the snapshot pointer?"

| Caller trust level | Approach |
|--------------------|----------|
| Internal, known-good | Return `*T`, document immutability |
| Public API, untrusted | Return `Clone()` or accessor methods |
| Plugin / third-party | Return an interface with read-only methods |

### "How do I notify other goroutines of changes?"

| Need | Use |
|------|-----|
| Cheap, allowed to miss | Closed-channel "edge" notification |
| Ordered, eager | Synchronous watcher list |
| Many subscribers, lossy OK | Buffered channels with non-blocking send |
| Reliable delivery | Single-writer goroutine + per-subscriber queue |
| Polling acceptable | Version field + poll loop |

### "How big is too big for a single snapshot?"

| Size | Verdict |
|------|---------|
| <1 MB | Plain COW, any write rate up to 1 KHz |
| 1–10 MB | Plain COW up to 100 Hz; consider batching |
| 10–100 MB | Sharded COW or batched COW |
| 100 MB – 1 GB | Persistent structure with structural sharing |
| >1 GB | Reconsider architecture; consider out-of-process state |

---

Use this guide as a quick checklist on PR review. If a colleague's COW design contradicts one of these recommendations, ask why — usually there is a good reason rooted in workload specifics, but sometimes the design is reaching for the wrong tool.

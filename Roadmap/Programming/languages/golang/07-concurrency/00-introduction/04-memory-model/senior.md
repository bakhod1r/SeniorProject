# Memory Model — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Designing Race-Free APIs](#designing-race-free-apis)
3. [Immutability and the Memory Model](#immutability-and-the-memory-model)
4. [Lock-Free Patterns and Their Limits](#lock-free-patterns-and-their-limits)
5. [Concurrency Contracts in Library Design](#concurrency-contracts-in-library-design)
6. [Cross-Library Synchronisation](#cross-library-synchronisation)
7. [Sharded State and Per-CPU Patterns](#sharded-state-and-per-cpu-patterns)
8. [Read-Mostly, Write-Rare Data Structures](#read-mostly-write-rare-data-structures)
9. [Concurrency Reviews](#concurrency-reviews)
10. [Migrating Legacy Code to Race-Free](#migrating-legacy-code-to-race-free)
11. [Self-Assessment](#self-assessment)
12. [Summary](#summary)

---

## Introduction

The senior view of the memory model is architectural. Individual `Lock()` and `atomic.Add()` calls are tactical; the question at this level is *how to design systems where races cannot happen* — not just by following discipline, but by structure. Immutability, sharding, single-ownership, well-defined concurrency contracts: these are the tools.

This file is opinionated. The opinions reflect what real teams have learned from running Go services at scale. None of the techniques is universally correct; all are useful in the right context.

After this you will:

- Design APIs that document and enforce concurrency contracts.
- Apply immutability where it removes synchronisation needs.
- Recognise the limits of lock-free programming in Go.
- Review concurrent code with a checklist that catches real bugs.
- Migrate legacy mutexed code to safer designs.

---

## Designing Race-Free APIs

A library's concurrency story is part of its public interface. Decisions to make:

### 1. Specify thread-safety per method

For each public method, document whether it is safe for concurrent use. The standard library does this rigorously:

> // ServeHTTP calls f(w, r).
> func (f HandlerFunc) ServeHTTP(w ResponseWriter, r *Request)

> // (Implementation note: this is safe for concurrent use because... )

If a method is safe for concurrent use, callers can call it from many goroutines simultaneously. If not, callers must synchronise externally. Document both cases clearly.

### 2. The standard contract

For Go types, the de facto rules:

- **Method receivers with no shared state.** Safe for concurrent use by definition (no shared state).
- **`io.Reader` / `io.Writer`.** Implementations should be safe for one goroutine at a time; concurrent use is undefined. `bufio.Reader` is *not* safe for concurrent use.
- **`net/http.Client`.** Safe for concurrent use.
- **Maps.** Not safe; require external synchronisation.
- **Slices.** Not safe; require external synchronisation.
- **Channels.** Safe for concurrent send/receive/close, but `close` should be done by exactly one goroutine.

### 3. Self-synchronising types

Encapsulate synchronisation inside the type. The caller never needs to know.

```go
type Counter struct {
    n atomic.Int64
}

func (c *Counter) Inc() { c.n.Add(1) }
func (c *Counter) Load() int64 { return c.n.Load() }
```

Callers use `c.Inc()` from any goroutine. No external locks. The type's contract: "safe for concurrent use."

### 4. Externally synchronised types

For complex types that resist self-synchronisation, document the contract:

```go
// Cache is not safe for concurrent use. Callers must synchronise externally.
type Cache struct {
    m map[string]string
}
```

Callers wrap calls in their own mutex. Less convenient but simpler internals.

### 5. Constructors return safe instances

A constructor should return a fully-initialised instance. No lazy init that races on first use.

```go
func NewCache() *Cache {
    return &Cache{m: make(map[string]string)}
}
```

If a method needs the cache, it does not check `if c.m == nil`; the constructor ensures it is non-nil.

### 6. Avoid passing pointers to internal mutexes

```go
// Bad
type Service struct {
    *sync.Mutex
}
```

Embedding the mutex makes `Lock`/`Unlock` part of the public API. Anyone can call them, defeating encapsulation. Use unexported mutexes:

```go
type Service struct {
    mu sync.Mutex
}
```

---

## Immutability and the Memory Model

The simplest way to be race-free: do not share mutable state. Immutable data can be read concurrently without synchronisation.

### What "immutable" means

A value that, once created, never changes. In Go, this is a discipline, not a language feature. The compiler does not enforce it.

```go
type Config struct {
    Timeout time.Duration
    MaxConn int
}

// After creation, do not modify. Treat as immutable.
cfg := &Config{Timeout: time.Second, MaxConn: 100}
```

To "modify" a Config, allocate a new one with the changes.

### Why this helps

- **Read-only structs need no synchronisation.** Readers can hold pointers indefinitely.
- **Publication is the only synchronisation needed.** "Where does the pointer come from?" is the only memory model question.
- **Reasoning is local.** A function receiving an immutable struct can rely on its values not changing.

### Combine with atomic publication

```go
var cfg atomic.Pointer[Config]
cfg.Store(&Config{Timeout: time.Second})

// Goroutines:
c := cfg.Load()
// c is immutable; no further sync needed
```

Updaters atomically swap in a new pointer:

```go
newCfg := &Config{Timeout: 2 * time.Second}
cfg.Store(newCfg)
```

Readers see a fully-constructed `*Config` or the previous one. Never partial.

### Functional update style

```go
func (c *Config) WithTimeout(d time.Duration) *Config {
    return &Config{Timeout: d, MaxConn: c.MaxConn}
}
```

Returns a new instance; the original is unchanged. Cheap if the struct is small; expensive if it contains large slices or maps.

### Trade-offs

- **Memory churn.** Every "update" allocates. GC pressure if updates are frequent.
- **Slow for large structures.** Copying a 10 MB struct on each update is wasteful.
- **Sharing requires care.** A `[]string` field is mutable even if the parent struct is "immutable"; either copy on update or document carefully.

For configurations (rarely updated, small), immutability is a clear win. For high-rate state (counters, queues), you need other patterns.

---

## Lock-Free Patterns and Their Limits

Lock-free data structures avoid mutexes by using atomic primitives (CAS) directly. Examples:

- Single-producer, single-consumer ring buffer.
- Lock-free queue (Michael-Scott queue).
- Hazard-pointer-based reference counting.

### In Go, mostly not your problem

The standard library provides `sync.Map`, `sync.Pool`, and channels — each implemented carefully. Most application code should use these, not roll its own lock-free structures.

### When to consider lock-free

- The standard library does not have what you need.
- Profiling shows mutex contention is the bottleneck.
- The structure is well-understood (e.g., a known algorithm with a published correctness proof).

### Why not roll your own

Lock-free programming is famously hard. Common bugs:

- **ABA problem.** A CAS sees the same value twice, but the underlying state changed in between. Use hazard pointers or versioned references.
- **Memory ordering.** Even with seq_cst atomics in Go, you must reason about visibility of writes through chains of pointers.
- **Resource lifecycle.** When can a node be freed? In garbage-collected languages this is easier; in C/C++ you need hazard pointers or RCU.

### Specific patterns

#### CAS loop

```go
var counter int64

for {
    old := atomic.LoadInt64(&counter)
    new := old + 1
    if atomic.CompareAndSwapInt64(&counter, old, new) {
        break
    }
}
```

Loops until the CAS succeeds. Under contention, this can livelock — though in practice it's rare.

Simpler: `atomic.AddInt64(&counter, 1)`. Use `AddInt64` when possible; CAS loops are for more complex updates.

#### Atomic pointer swap

```go
type Node struct {
    Value int
    Next  *Node
}

var head atomic.Pointer[Node]

// Push:
newNode := &Node{Value: v}
for {
    old := head.Load()
    newNode.Next = old
    if head.CompareAndSwap(old, newNode) { break }
}
```

A lock-free stack. CAS the head pointer. ABA-safe because Go's GC ensures the old `Node` is not freed until no one references it.

#### Copy-on-write

```go
var data atomic.Pointer[[]string]

// Read:
s := *data.Load()

// Update:
for {
    old := data.Load()
    newSlice := append([]string(nil), *old...)
    newSlice = append(newSlice, "new")
    if data.CompareAndSwap(old, &newSlice) { break }
}
```

Readers always see a complete snapshot. Writers create a new slice and atomically swap. Expensive for frequent updates with large slices.

---

## Concurrency Contracts in Library Design

Every library should document its concurrency contract:

### Format

```go
// Cache is a key-value store.
//
// All methods are safe for concurrent use by multiple goroutines.
// Updates are atomic; readers always see a consistent snapshot.
type Cache struct { ... }
```

Or:

```go
// Iterator yields items from a Cache.
//
// An Iterator is not safe for concurrent use. The underlying Cache
// must not be modified during iteration.
type Iterator struct { ... }
```

### Why it matters

- New users know what they can do.
- Future maintainers know what they cannot break.
- Static analysis tools can use the contract.
- It is part of the API; changing it is a breaking change.

### Anti-pattern: silent thread-safety

A library that quietly synchronises everything imposes performance cost on all callers, including those who would have synchronised externally with knowledge of their use pattern.

A library that quietly does *not* synchronise leaves callers vulnerable to races they cannot detect.

Both are bad. Be explicit.

### Concrete examples in stdlib

- `net/http.Client` is safe for concurrent use.
- `bufio.Reader` is not.
- `database/sql.DB` is safe for concurrent use; `database/sql.Tx` is not (per-transaction).
- `sync.Map` is safe; `map[K]V` is not.

Each documented contract is one less surprise.

---

## Cross-Library Synchronisation

What happens when your code combines several libraries, each with their own thread-safety story?

### Always-safe libraries

If everything you call is safe-for-concurrent-use, you can call them from any goroutine.

### Sometimes-safe libraries

`io.Reader` is the canonical example. Each implementation has its own rules; `bytes.Buffer` is not safe for concurrent use, `bufio.Reader` is not safe for concurrent use, but `os.File` may be (with caveats).

The safe pattern: own each instance from one goroutine at a time. Pass ownership explicitly (e.g., via channels).

### Composing with locks

If library A is mutex-protected and library B is mutex-protected, calling both inside *your* mutex is fine. But:

```go
yourMu.Lock()
a.DoSomething() // takes a.mu
b.DoSomething() // takes b.mu
yourMu.Unlock()
```

Lock ordering matters. Always acquire locks in the same order (across goroutines). Otherwise deadlock.

### Lock leakage

A library that locks and never unlocks (or locks for too long) blocks callers. The CSP-style alternative: take ownership of state, send results back, never hold a lock across an external call.

---

## Sharded State and Per-CPU Patterns

When a single lock becomes a bottleneck, shard the data.

### Hash sharding

```go
const shards = 32

type ShardedCache struct {
    shards [shards]struct {
        mu sync.Mutex
        m  map[string]string
    }
}

func (c *ShardedCache) shardFor(k string) *struct {
    mu sync.Mutex
    m  map[string]string
} {
    h := fnv.New32a()
    h.Write([]byte(k))
    return &c.shards[h.Sum32()%shards]
}

func (c *ShardedCache) Get(k string) string {
    s := c.shardFor(k)
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.m[k]
}
```

Different keys land in different shards. Contention drops by ~`shards` ×.

### Per-CPU (per-P) state

For really hot data, one slot per CPU:

```go
type PerCPU struct {
    slots [256]struct {
        n int64
        _ [56]byte // pad to cache line
    }
}

func (p *PerCPU) Inc() {
    // Note: there is no direct API to get the current P ID.
    // A workaround: use a hash of the goroutine ID, or use sharding via channels.
}
```

Go does not expose the current P ID. Workarounds use goroutine ID (via runtime hacks) or sharding by some external key.

For truly per-CPU patterns, the Go runtime itself does it internally (mcache, gcwork). Application-level per-CPU is rare.

### Sharding trade-offs

- **More memory.** Each shard has its own map header, allocator state, etc.
- **Read patterns matter.** Iterating all shards is slow (must lock each).
- **Hot shard problem.** If one key is much more popular, sharding does not help — that key still hits its single shard.

For most workloads, 16–32 shards is enough.

---

## Read-Mostly, Write-Rare Data Structures

Many production data structures are read-mostly: cache, config, session table. Optimise for the common case.

### `atomic.Value` / `atomic.Pointer`

Already covered. Best for entire-value replacement (immutable updates).

### `sync.RWMutex`

Multiple readers OK; one writer at a time.

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string]string
}

func (c *Cache) Get(k string) string {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.m[k]
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.m[k] = v
}
```

Caveats: `RWMutex` has higher overhead than `Mutex` for uncontended access. Writers can starve readers in some implementations.

### `sync.Map`

Lock-free read path; copy-on-write for updates. Best for "write once, read many" or "read many, write rare."

```go
var m sync.Map
m.Store(k, v)
v, ok := m.Load(k)
```

Not a drop-in replacement for `map[K]V`: less ergonomic, generic-unaware (pre-1.18 idiom uses `interface{}`).

### COW (copy-on-write)

Maintain a pointer to an immutable map; on update, copy, modify, atomically swap.

```go
var cache atomic.Pointer[map[string]string]
cache.Store(&map[string]string{})

func Set(k, v string) {
    for {
        oldP := cache.Load()
        newM := make(map[string]string, len(*oldP)+1)
        for k, v := range *oldP {
            newM[k] = v
        }
        newM[k] = v
        if cache.CompareAndSwap(oldP, &newM) { break }
    }
}
```

Readers do `cache.Load()[k]` — fully lock-free. Writers pay O(n) for the copy. Good if writes are very rare.

---

## Concurrency Reviews

A checklist when reviewing concurrent code:

1. **Every shared variable.** What protects it? Mutex, atomic, channel, or immutable?
2. **Every method.** Documented as safe for concurrent use?
3. **Every goroutine.** When does it exit? Who owns it?
4. **Every channel.** Who closes? Buffer size?
5. **Every lock.** What is the critical section? Is it as small as possible?
6. **Lock ordering.** If multiple locks are taken, are they always taken in the same order?
7. **Lazy init.** `sync.Once` or constructor-based?
8. **Map iteration.** Is the map locked during iteration? Are concurrent writes possible?
9. **Slice sharing.** Are two goroutines accessing the same slice?
10. **Tests.** Run with `-race`?
11. **Stress.** `-count=N` for rare races?
12. **Goleak.** Detect leaked goroutines?
13. **Profile.** Mutex / block profile show contention?
14. **Constraints.** Documented in `// Safe for concurrent use.` or its negation?

---

## Migrating Legacy Code to Race-Free

You inherit a Go service with subtle races. How to clean up?

### Step 1: Inventory

Run the race detector on the test suite. List every reported race. Group by component.

### Step 2: Prioritise

- Races in core paths (auth, request handling): fix first.
- Races in metrics or background tasks: lower priority but still real.
- Races in rarely-exercised code: easy to miss; fix when found.

### Step 3: Decide the fix per race

Sometimes the fix is a simple mutex addition. Sometimes the design must change:

- A shared map with no concurrency model → `sync.Map` or mutex.
- A goroutine writing to a shared slice → channel-based ownership.
- A "shutdown" flag → `context.Context`.

### Step 4: Tests, then fix, then tests

For each fix:

1. Write a stress test that reliably triggers the race.
2. Verify it fails under `-race -count=N`.
3. Apply the fix.
4. Verify the test now passes.
5. Run the full suite to ensure no regression.

### Step 5: Gradual rollout

For risky changes (e.g., switching mutex to atomic), roll out behind a feature flag. Compare metrics.

### Step 6: Document

Each race fixed deserves a comment explaining the synchronisation. Future readers will thank you.

---

## Self-Assessment

- [ ] I have designed a library API with an explicit concurrency contract.
- [ ] I have used immutable data + atomic publication for read-mostly state.
- [ ] I have evaluated `sync.RWMutex` vs `sync.Map` vs sharded mutex for a specific case.
- [ ] I have reviewed concurrent code in a PR with the checklist above.
- [ ] I have refactored legacy mutex-heavy code into something cleaner.
- [ ] I have shipped a fix for a race detected in production.
- [ ] I have used `atomic.Pointer` for hot config swap.
- [ ] I can argue when sharding is worth its complexity.
- [ ] I have written stress tests that triggered a real bug.
- [ ] I have audited an open-source library's concurrency contract.

---

## Summary

The senior view of the memory model is about *design*, not just discipline. Race-free APIs, immutable data, lock-free patterns, sharded state, and clear concurrency contracts — these are the tools.

Most application code does not need lock-free programming; the standard library provides what you need. When it doesn't, reach for sharding before lock-free; reach for `atomic.Pointer` before custom CAS.

Document concurrency contracts explicitly. They are part of the API. Review concurrent code with a checklist. Stress test with `-race -count=N`. Treat goroutine leaks as bugs.

The professional view (next file) drops into hardware memory models and the race detector's internals.

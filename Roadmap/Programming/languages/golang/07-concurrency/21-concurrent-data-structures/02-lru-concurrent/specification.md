---
layout: default
title: Specification
parent: LRU Concurrent
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/02-lru-concurrent/specification/
---

# Concurrent LRU — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Formal LRU Semantics](#formal-lru-semantics)
3. [The Invariant](#the-invariant)
4. [Operation Contracts](#operation-contracts)
5. [`container/list` Contract](#containerlist-contract)
6. [`hashicorp/golang-lru/v2` API Surface](#hashicorpgolang-lruv2-api-surface)
7. [Concurrency Guarantees](#concurrency-guarantees)
8. [The Go Memory Model and Caches](#the-go-memory-model-and-caches)
9. [ristretto Configuration Semantics](#ristretto-configuration-semantics)
10. [Eviction Policy Definitions](#eviction-policy-definitions)
11. [References](#references)

---

## Introduction

This file collects the formal contracts and specifications relevant to concurrent LRU caches in Go. Three sources are normative:

- **The data-structure literature**: defines LRU semantics, the invariant, and policy variations.
- **The Go standard library documentation**: defines `container/list` and `sync` primitives used to build caches.
- **The library documentation for `hashicorp/golang-lru/v2`, `dgraph-io/ristretto`, `expirable`**: defines the APIs you actually call.

Most caches are implementation choices, not specifications. Where a contract exists, this file records it precisely.

---

## Formal LRU Semantics

An LRU cache of capacity `C` is a partial function `f : K → V` that maintains an ordered set of at most `C` keys. The order represents recency of last access (most recent at the front, least recent at the back).

### State

Let `S = (K, V, order)` where:
- `K` is a set of keys, `|K| ≤ C`.
- `V` is a partial map `K → Value`.
- `order` is a permutation of `K` (a sequence with no duplicates).

### Operations

**Get(k):**

- If `k ∉ K`: return `(zero, false)`, no state change.
- If `k ∈ K`: return `(V(k), true)`, update `order` so that `k` is at position 0 (front).

**Set(k, v):**

- If `k ∈ K`: update `V(k) := v`, move `k` to position 0 in `order`.
- If `k ∉ K` and `|K| < C`: add `k` to position 0 in `order`, set `V(k) := v`.
- If `k ∉ K` and `|K| = C`: remove the last element of `order` (and from `K` and `V`), then add `k` at position 0, set `V(k) := v`.

**Remove(k):**

- If `k ∈ K`: remove `k` from `K`, `V`, and `order`. Return `true`.
- If `k ∉ K`: return `false`, no state change.

**Len:** Returns `|K|`.

### Properties

After any sequence of operations:

1. `|K| ≤ C`.
2. `K = set(order)`.
3. `dom(V) = K`.
4. The "least recently used" element is `order[|K|-1]` (the back).

---

## The Invariant

The fundamental invariant of an LRU is:

```
items_map.keys() == list.elements() and |items_map| == list.length() and |items_map| ≤ capacity
```

All three conjuncts must hold before and after every public operation. Internally, operations may temporarily break the invariant but must restore it before releasing the lock.

A violation of the invariant means the cache is corrupt — subsequent operations have undefined behavior.

---

## Operation Contracts

For a concurrent LRU built on the textbook design (map + doubly-linked list + single mutex):

### `Get(k K) (V, bool)`

- **Pre**: The cache is initialized.
- **Post**: If `k` was in the cache, returns `(value, true)` and `k` is at the MRU end. If `k` was not in the cache, returns `(zero V, false)` and the cache state is unchanged.
- **Concurrency**: Safe to call concurrently with any other operation.
- **Complexity**: O(1) amortized.
- **Allocations**: 0 in steady state.

### `Add(k K, v V) bool`

- **Pre**: The cache is initialized.
- **Post**: `k` is in the cache, mapped to `v`, and at the MRU end. Returns `true` if an eviction occurred (the cache was at capacity and a previous entry was removed).
- **Concurrency**: Safe to call concurrently with any other operation.
- **Complexity**: O(1) amortized.
- **Allocations**: 1 entry struct + 1 list element on insert; 0 on update.

### `Peek(k K) (V, bool)`

- **Pre**: The cache is initialized.
- **Post**: If `k` was in the cache, returns `(value, true)`. The recency order is unchanged. If `k` was not in the cache, returns `(zero V, false)`.
- **Concurrency**: Safe to call concurrently with any other operation.
- **Complexity**: O(1).
- **Allocations**: 0.

### `Contains(k K) bool`

- **Pre**: The cache is initialized.
- **Post**: Returns `true` iff `k` is in the cache. Recency order is unchanged.
- **Concurrency**: Safe.
- **Complexity**: O(1).

### `Remove(k K) bool`

- **Pre**: The cache is initialized.
- **Post**: If `k` was in the cache, it is no longer present. Returns `true` iff `k` was removed.
- **Concurrency**: Safe.
- **Complexity**: O(1).

### `Len() int`

- **Pre**: The cache is initialized.
- **Post**: Returns the number of entries currently in the cache.
- **Concurrency**: Safe. The value may be immediately stale.
- **Complexity**: O(1).

### `Purge()`

- **Pre**: The cache is initialized.
- **Post**: The cache contains no entries. Eviction callback fires for each removed entry.
- **Concurrency**: Safe. Holds the lock for the duration.
- **Complexity**: O(n) where n was the previous size.

### `Keys() []K`

- **Pre**: The cache is initialized.
- **Post**: Returns a fresh slice of all keys, ordered MRU to LRU.
- **Concurrency**: Safe. The slice is a snapshot; subsequent cache mutations are not reflected.
- **Complexity**: O(n).
- **Allocations**: 1 slice of size n.

### `Resize(newCap int) (evicted int)`

- **Pre**: `newCap > 0`.
- **Post**: Cache capacity is `newCap`. If `Len() > newCap`, the surplus LRU-end entries are evicted. Returns the count of evictions.
- **Concurrency**: Safe.
- **Complexity**: O(max(0, Len - newCap)).

---

## `container/list` Contract

From `pkg.go.dev/container/list`:

> Package list implements a doubly linked list.
>
> To iterate over a list (where l is a *List):
>
> ```go
> for e := l.Front(); e != nil; e = e.Next() {
>     // do something with e.Value
> }
> ```

### Key methods used by LRU implementations

```go
func (l *List) Front() *Element
func (l *List) Back() *Element
func (l *List) Len() int
func (l *List) PushFront(v any) *Element
func (l *List) PushBack(v any) *Element
func (l *List) MoveToFront(e *Element)
func (l *List) MoveToBack(e *Element)
func (l *List) Remove(e *Element) any
func (l *List) Init() *List
```

### Critical normative points

1. **`container/list` is NOT safe for concurrent use.** Any user must add their own synchronization.
2. **An `*Element` returned by `PushFront`/`PushBack` remains valid until the element is removed.** Subsequent operations (MoveToFront, Remove) accept that pointer.
3. **Iterating while modifying** (calling Remove on the current element) is documented as supported.
4. **The zero value of `Element`** is not usable. Always go through the List API.
5. **`Element.Value` is `any`** (interface{}). Use a type assertion to access typed data.

### Performance characteristics

- All listed methods are O(1).
- Memory: each Element is ~56 bytes on amd64.

---

## `hashicorp/golang-lru/v2` API Surface

From `pkg.go.dev/github.com/hashicorp/golang-lru/v2`:

### Constructors

```go
func New[K comparable, V any](size int) (*Cache[K, V], error)
func NewWithEvict[K comparable, V any](size int, onEvict EvictCallback[K, V]) (*Cache[K, V], error)
```

`size` must be `> 0`; otherwise an error is returned. The error type is `errors.New("must provide a positive size")`.

### Type definitions

```go
type EvictCallback[K comparable, V any] func(key K, value V)

type Cache[K comparable, V any] struct {
    // unexported fields
}
```

### Methods on `*Cache[K, V]`

```go
func (c *Cache[K, V]) Add(key K, value V) (evicted bool)
func (c *Cache[K, V]) Get(key K) (value V, ok bool)
func (c *Cache[K, V]) Contains(key K) bool
func (c *Cache[K, V]) Peek(key K) (value V, ok bool)
func (c *Cache[K, V]) ContainsOrAdd(key K, value V) (ok, evicted bool)
func (c *Cache[K, V]) PeekOrAdd(key K, value V) (previous V, ok, evicted bool)
func (c *Cache[K, V]) Remove(key K) (present bool)
func (c *Cache[K, V]) Resize(size int) (evicted int)
func (c *Cache[K, V]) RemoveOldest() (key K, value V, ok bool)
func (c *Cache[K, V]) GetOldest() (key K, value V, ok bool)
func (c *Cache[K, V]) Keys() []K
func (c *Cache[K, V]) Values() []V
func (c *Cache[K, V]) Len() int
func (c *Cache[K, V]) Purge()
```

### Documented guarantees

- All methods are safe for concurrent use.
- The cache uses a `sync.RWMutex` internally. `Peek` and `Contains` use `RLock`; all others use `Lock`.
- `Get` is a *write* operation despite the name: it updates recency.
- The eviction callback is invoked synchronously, holding the cache's lock.
- The eviction callback must not call back into the cache (deadlock).

### Variants

```go
// 2Q
func New2Q[K comparable, V any](size int) (*TwoQueueCache[K, V], error)

// ARC
func NewARC[K comparable, V any](size int) (*ARCCache[K, V], error)
```

These have the same method surface as `Cache` but use different eviction algorithms internally.

### Expirable variant (subpackage `expirable`)

```go
func NewLRU[K comparable, V any](
    size int,
    onEvict EvictCallback[K, V],
    ttl time.Duration,
) *LRU[K, V]
```

A janitor goroutine runs in the background to remove expired entries. The goroutine stops when the cache is no longer referenced (relies on GC).

---

## Concurrency Guarantees

### `hashicorp/golang-lru/v2`

- **Linearizable per operation.** Each public method appears to take effect at a single instant.
- **No total order across operations on different caches.** Two separate `Cache` instances are independent.
- **`Get` followed by `Add`** in the same goroutine sees the Add's effect on subsequent Gets (sequential consistency for the goroutine's own operations).
- **`Get` from one goroutine vs `Add` from another** has no ordering guarantee. The Get may return the old or new value depending on timing.

### ristretto

- **Eventually consistent.** A `Set` may not be visible to subsequent `Get` calls until the background goroutine processes it (microseconds).
- **`cache.Wait()` flushes** the background queue. After Wait returns, all prior Sets are visible.
- **No serializability guarantees.** Two concurrent Sets on the same key may both be visible only briefly; one wins after the next Wait.

### bigcache/freecache

- **Sharded with per-shard locks.** Operations on different shards are independent.
- **Within a shard, linearizable.**

---

## The Go Memory Model and Caches

From `go.dev/ref/mem`:

> A read r of a memory location x is allowed to observe a write w to x if both of the following hold:
> 1. r does not happen before w.
> 2. There is no other write w' to x that happens after w and before r.

For a cache:

- Operations protected by the same mutex are totally ordered (happens-before).
- Operations on different mutexes (different shards) are unordered with respect to each other.
- Atomic reads/writes have happens-before relationships per the rules in the Memory Model.

### Implications for caches

- A `Get` after a `Set` on the same key in the same goroutine sees the Set's value.
- A `Get` after a `Set` on the same key in different goroutines may or may not see the Set, depending on timing and synchronization.
- Without synchronization, no guarantees. With a mutex around both, the Get sees the latest Set that happened-before.

### `sync.Mutex` and happens-before

- `Lock()` happens-after the most recent `Unlock()` (by any goroutine).
- All writes by the holder happen-before subsequent writes by the next holder.

This is the foundation of cache concurrency safety.

---

## ristretto Configuration Semantics

```go
type Config struct {
    NumCounters int64
    MaxCost     int64
    BufferItems int64
    Metrics     bool
    OnEvict     func(item *Item)
    KeyToHash   func(key interface{}) (uint64, uint64)
    Cost        func(value interface{}) int64
}
```

Documented semantics:

- **NumCounters**: size of the TinyLFU sketch. Recommended: 10x expected unique key count.
- **MaxCost**: maximum total cost. Eviction triggers when sum of admitted costs exceeds this.
- **BufferItems**: per-shard buffer size for access events. Default 64. Higher = better Get throughput, more memory.
- **OnEvict**: callback invoked when an entry is evicted (background goroutine).
- **KeyToHash**: custom hash function. Default uses xxhash.
- **Cost**: function to compute entry cost. If nil, all entries have cost 1.

### Method surface

```go
func (c *Cache) Get(key interface{}) (interface{}, bool)
func (c *Cache) Set(key, value interface{}, cost int64) bool
func (c *Cache) SetWithTTL(key, value interface{}, cost int64, ttl time.Duration) bool
func (c *Cache) Del(key interface{})
func (c *Cache) Wait()
func (c *Cache) Close()
func (c *Cache) Clear()
```

- **Set returns `bool`**: true if accepted into the buffer (not necessarily admitted to cache).
- **Get is best-effort**: a recently-Set value may not be visible until Wait.
- **Close stops the background goroutine.** Subsequent calls panic.

---

## Eviction Policy Definitions

### LRU (Least Recently Used)

Evict the entry whose last access timestamp is earliest.

### LFU (Least Frequently Used)

Evict the entry with the lowest access count. Ties broken by recency.

### FIFO (First In, First Out)

Evict the entry that has been in the cache longest, regardless of access count.

### MRU (Most Recently Used)

Evict the entry whose last access timestamp is latest. Rarely useful.

### 2Q (Two Queue)

Two queues, A1 (FIFO, recent) and Am (LRU, frequent). New entries → A1. Hit in A1 → promote to Am. Hit in Am → MoveToFront in Am.

### SLRU (Segmented LRU)

Two segments, protected (LRU) and probationary (LRU). New entries → probationary. Hit in probationary → promote to protected. Hit in protected → MoveToFront.

### ARC (Adaptive Replacement Cache)

Four lists (T1, T2, B1, B2). Parameter `p` adapts based on hits in ghost lists.

### LIRS (Low Inter-reference Recency Set)

Tracks IRR (Inter-Reference Recency = distinct keys between accesses). Keys with small IRR are kept (LIR set); others are evictable (HIR set).

### TinyLFU

Admission filter using Count-Min Sketch. A new candidate is admitted only if its estimated frequency exceeds the victim's.

### W-TinyLFU

TinyLFU plus a window LRU. New entries first go to the window (without admission check). Promotion from window uses TinyLFU.

### S3-FIFO (Yang et al. 2024)

Three FIFO queues (Small, Main, Ghost). New entries → Small. Promotion on hit count ≥ 1. Eviction recorded in Ghost; re-insertion of ghosted keys goes directly to Main.

---

## References

### Primary documentation

- Go Programming Language Specification: `https://go.dev/ref/spec`
- Go Memory Model: `https://go.dev/ref/mem`
- `container/list`: `https://pkg.go.dev/container/list`
- `sync`: `https://pkg.go.dev/sync`
- `sync/atomic`: `https://pkg.go.dev/sync/atomic`
- `hash/maphash`: `https://pkg.go.dev/hash/maphash`

### Cache libraries

- `hashicorp/golang-lru/v2`: `https://pkg.go.dev/github.com/hashicorp/golang-lru/v2`
- `dgraph-io/ristretto`: `https://pkg.go.dev/github.com/dgraph-io/ristretto`
- `allegro/bigcache/v3`: `https://pkg.go.dev/github.com/allegro/bigcache/v3`
- `coocood/freecache`: `https://pkg.go.dev/github.com/coocood/freecache`

### Academic literature

- Belady, "A study of replacement algorithms for a virtual-storage computer" (1966) — Belady's optimal.
- Sleator & Tarjan, "Amortized efficiency of list update and paging rules" (1985) — k-competitiveness of LRU.
- Megiddo & Modha, "ARC: A self-tuning, low overhead replacement cache" (2003) — ARC.
- Jiang & Zhang, "LIRS: An efficient low inter-reference recency set replacement policy" (2002) — LIRS.
- Einziger, Friedman, Manes, "TinyLFU: A highly efficient cache admission policy" (2017) — TinyLFU.
- Yang et al., "FIFO queues are all you need for cache eviction" (FAST 2024) — S3-FIFO.
- Ding & Zhang, "BP-Wrapper: A system framework making any replacement algorithms (almost) lock contention free" (2008).

### Style and code conventions

- Effective Go: `https://go.dev/doc/effective_go`
- Uber Go Style Guide: `https://github.com/uber-go/guide/blob/master/style.md`

---

## Appendix A: Versioning notes

### `hashicorp/golang-lru` v1 vs v2

The v1 line (`github.com/hashicorp/golang-lru`) uses `interface{}` for keys and values. The v2 line uses Go generics (requires Go 1.18+). New code should use v2.

Migration:

```go
// v1
cache, _ := lru.New(128)
cache.Add("key", "value")
v, _ := cache.Get("key")
str := v.(string)

// v2
cache, _ := lru.New[string, string](128)
cache.Add("key", "value")
str, _ := cache.Get("key") // typed; no assertion
```

The method names are unchanged. Migration is mechanical.

### Go version requirements

- `hashicorp/golang-lru` v1: Go 1.13+
- `hashicorp/golang-lru/v2`: Go 1.18+ (generics)
- `dgraph-io/ristretto`: Go 1.12+
- `allegro/bigcache/v3`: Go 1.16+

For new projects on modern Go, use v2 of golang-lru. For maintained legacy projects, v1 still works.

## Appendix B: Error types

### `hashicorp/golang-lru/v2`

```go
var ErrInvalidSize = errors.New("must provide a positive size")
```

Returned only from `New`. Operations on a constructed cache do not produce errors at the API level.

### `dgraph-io/ristretto`

Construction returns error on invalid `Config`. Operations are best-effort and return `bool` rather than error.

### `allegro/bigcache/v3`

```go
type ErrEntryNotFound struct{}
func (e *ErrEntryNotFound) Error() string { return "entry not found" }
```

Returned from `Get` when the key is not present.

## Appendix C: Memory layout sizes

On amd64 with Go 1.22:

| Type | Size (bytes) |
|------|--------------|
| `*lru.Cache[K, V]` (handle) | 8 |
| `lru.Cache[K, V]` (struct) | ~80 |
| `list.Element` | 56 |
| `list.List` | 56 |
| `sync.Mutex` | 8 |
| `sync.RWMutex` | 24 |
| `atomic.Uint64` | 8 |
| `atomic.Pointer[T]` | 8 |
| `map[K]V` header | 48 |
| `map[K]V` bucket | depends on K, V |

Use `unsafe.Sizeof(struct{}{})` for exact sizes on your platform.

## Appendix D: Atomic operation costs

On modern CPUs (rough numbers, varies by uncontended vs contended):

| Operation | Uncontended | Contended |
|-----------|-------------|-----------|
| `atomic.LoadUint64` | 1 ns | 5 ns |
| `atomic.StoreUint64` | 1 ns | 5 ns |
| `atomic.AddUint64` | 3 ns | 50 ns |
| `atomic.CompareAndSwapUint64` | 5 ns | 100 ns |
| `sync.Mutex.Lock`/Unlock | 25 ns | 200-10000 ns |
| `sync.RWMutex.RLock`/RUnlock | 30 ns | 100-1000 ns |

Memory-mapped atomic operations on uncached lines: add 50-100 ns for cross-CPU traffic.

## Appendix E: Glossary of terms

- **MRU end / LRU end**: the front (most recent) / back (least recent) of the recency order.
- **Stack distance**: position of an entry in the LRU stack at access time. Used in Mattson's algorithm.
- **Reuse distance / Inter-Reference Recency (IRR)**: distinct keys between consecutive accesses of the same key.
- **Working set**: set of distinct keys accessed in a time window.
- **Hot key**: a key with disproportionately many accesses.
- **Cache stampede**: simultaneous misses on the same expired key.
- **Cache poisoning**: filling the cache with junk to evict the hot set.
- **Belady's algorithm**: offline optimal eviction (evict farthest-future).
- **Sharding**: partitioning a cache into N independent stripes for parallelism.
- **False sharing**: two cache-line-adjacent variables causing CPU cache invalidation traffic.
- **Eviction callback**: a function invoked when an entry is removed by the cache.

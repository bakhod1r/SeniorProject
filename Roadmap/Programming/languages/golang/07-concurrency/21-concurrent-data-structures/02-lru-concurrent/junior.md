---
layout: default
title: Junior
parent: LRU Concurrent
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/02-lru-concurrent/junior/
---

# Concurrent LRU — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros and Cons](#pros-and-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use and Features](#product-use-and-features)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams and Visual Aids](#diagrams-and-visual-aids)

---

## Introduction
> Focus: "What is an LRU cache? Why do I need a linked list AND a map? How do I make it safe for many goroutines at once?"

A **cache** is a small, fast store that holds recently used data so the next request can skip a slower step — a database query, an HTTP call, a JSON parse, a regex compile. The catch is the word *small*. A cache has a fixed capacity; once it is full and a new entry arrives, something has to leave. The rule that picks the victim is called the **eviction policy**. The most famous one is **LRU**: throw out the *least recently used* item.

Why "least recently used"? Because of a strong empirical pattern called **temporal locality**: if you accessed a key now, you are more likely to access it again soon than to ask for a key you have not touched in an hour. LRU encodes that bet directly: every access promotes a key to the "most recently used" position, and only items that have sat idle the longest get pushed out.

For a single goroutine, an LRU is a small puzzle: combine a hash map for O(1) lookup with a doubly-linked list for O(1) recency updates. For many goroutines hitting the same cache at once, it becomes a real concurrency exercise. Two goroutines that both `Get` the same hot key must not corrupt the linked list while moving the node to the front. Two goroutines that both `Set` keys while the cache is full must not double-evict or leave dangling map entries.

This file teaches the *minimum complete picture* a junior Go engineer needs:

- The "map plus doubly-linked list" classical design
- Why concurrent goroutines break the naive version
- How a single `sync.Mutex` makes it correct (but slow)
- How `container/list` from the standard library helps
- How to use `hashicorp/golang-lru/v2`, the de facto Go LRU library, in five lines
- The single most common bug: forgetting to update the map when the list evicts

You do not need to know about sharding, RWMutex trade-offs, lock-free reads, or admission policies yet — those come in the middle, senior, and professional files. This file is about *understanding the invariant* and *writing your first correct concurrent LRU*.

After reading this file you will:

- Be able to draw the LRU invariant on paper
- Be able to write a correct single-goroutine LRU in ~80 lines of Go
- Be able to wrap it with one mutex and explain why that is safe
- Be able to drop in `hashicorp/golang-lru/v2` for a real project
- Recognise the three or four bugs that turn an LRU into a memory leak or a deadlock

---

## Prerequisites

- **Required:** Go 1.21 or newer. Generics (`hashicorp/golang-lru/v2`) require 1.18+.
- **Required:** Comfort with the `map[K]V` built-in and basic struct types.
- **Required:** Awareness of pointers. Linked lists are pointer-heavy.
- **Required:** Familiarity with `sync.Mutex` — `Lock`, `Unlock`, and the `defer mu.Unlock()` idiom.
- **Helpful:** A read through the `container/list` package documentation. The whole package is ~150 lines.
- **Helpful:** Some exposure to the race detector (`go test -race`). All concurrent code in this file should be exercised with it.

If you can write a function that takes a `*sync.Mutex` and a shared `map[string]int`, locks the mutex, mutates the map, and unlocks the mutex, you have everything you need.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Cache** | A bounded-size store that holds a subset of a larger collection so that hot items are served fast. |
| **Hit** | A `Get(k)` that finds `k` in the cache. |
| **Miss** | A `Get(k)` that does not find `k` and must fall through to the slow source. |
| **Hit rate** | Hits divided by total lookups. The single most important cache metric. |
| **Eviction** | Removing an item to make space for a new one. |
| **LRU** | "Least Recently Used." The eviction policy that removes the item whose last access is furthest in the past. |
| **MRU end** | The "front" of the recency list. The most recently used item lives here. |
| **LRU end** | The "back" of the recency list. The least recently used item lives here. It is the next eviction victim. |
| **Doubly-linked list** | A linked list where each node has both a `next` and `prev` pointer. Lets you remove a node from the middle in O(1). |
| **`container/list`** | Go's standard-library doubly-linked list. Exposes `List`, `Element`, `MoveToFront`, `PushFront`, `Remove`. |
| **Capacity** | The maximum number of entries the cache will hold. Reaching capacity triggers eviction on the next insert. |
| **`sync.Mutex`** | A mutual-exclusion lock. At most one goroutine holds it. The simplest tool for making a data structure concurrent. |
| **Critical section** | The block of code between `Lock()` and `Unlock()`. All shared state accesses must happen inside it. |
| **`sync.RWMutex`** | A read/write lock that allows many concurrent readers or one exclusive writer. Useful when reads vastly outnumber writes — but an LRU read still mutates the recency list, so be careful. |
| **`hashicorp/golang-lru/v2`** | The most widely used Go LRU library. Provides simple, 2Q, and ARC variants with generics. |
| **Invariant** | A property that always holds before and after each operation, even though it may be temporarily broken inside one. The LRU invariant is "the keys in the map are exactly the values in the list." |

---

## Core Concepts

### 1. The textbook LRU invariant

An LRU cache stores up to `capacity` entries. Each entry has a key, a value, and an implicit position on a recency timeline. We represent that timeline with a doubly-linked list:

```
MRU                                            LRU
front                                          back
[k7,v7] <-> [k2,v2] <-> [k9,v9] <-> [k4,v4] <-> [k1,v1]
```

`k7` was used most recently. `k1` is the next to die.

We also keep a map:

```go
items map[K]*list.Element // K → pointer to the node in the list
```

The map answers "where is key K in the list?" in O(1). Without it, `Get(k)` would have to scan the list.

The **invariant** is small but absolute:

1. Every key in `items` corresponds to exactly one element in the list.
2. Every element in the list has its key present in `items`.
3. The number of entries is `len(items) == list.Len()` and is `≤ capacity`.

If any operation breaks the invariant and then returns, the cache is corrupt and will leak memory or return stale data forever after.

### 2. The three operations and their effect on the invariant

**Get(k):**

1. Look up `k` in the map.
2. If absent, return miss. (No change to list.)
3. If present, move the node to the front of the list. (Recency updated.)
4. Return the value.

**Set(k, v):**

1. If `k` already exists, update the value and move the node to the front.
2. Otherwise:
   - If the cache is full, remove the back node and delete its key from the map.
   - Push a new node to the front and add the map entry.

**Remove(k):**

1. Look up `k`. If absent, no-op.
2. Remove the node from the list and delete the key from the map.

Notice that **`Get` mutates the cache**. This is the single most surprising fact for newcomers. It also explains why `sync.RWMutex.RLock` is not safe for `Get` — `Get` is a writer in disguise.

### 3. Why one goroutine is not enough

In a web server, hundreds of goroutines serve requests in parallel. Each may call `cache.Get(userID)` or `cache.Set(userID, profile)`. If two goroutines both move the same node to the front concurrently, the list's `prev`/`next` pointers can crash into each other. The result is a corrupted list (e.g., a cycle), and the next traversal will loop forever or panic with a nil dereference.

The simplest fix is a single `sync.Mutex` wrapping every public method. This is correct, easy to read, easy to test — and the right starting point. The cost is that only one goroutine at a time enters the cache, no matter how many cores you have. Later levels remove this bottleneck with sharding.

### 4. Why a doubly-linked list?

You might ask: can't I use a slice and move elements around with `copy`? You can, but moving an element from position `i` to the front in a slice of `n` items costs O(n). With `n` of 100 000 and a billion lookups per day, that becomes the bottleneck.

A doubly-linked list lets you:

- Remove a node from the middle in O(1) (because you have both `prev` and `next` already).
- Insert at the front in O(1).
- Insert at the back in O(1).

No other simple data structure gives you all three. (A doubly-ended deque using a ring buffer gives you front/back O(1) but not arbitrary-middle removal.)

### 5. What `container/list` provides

The standard library has exactly what we need:

```go
type List struct { /* ... */ }
type Element struct { Value any; /* ... */ }

func (l *List) Init() *List
func (l *List) Len() int
func (l *List) PushFront(v any) *Element
func (l *List) PushBack(v any) *Element
func (l *List) MoveToFront(e *Element)
func (l *List) MoveToBack(e *Element)
func (l *List) Remove(e *Element) any
func (l *List) Front() *Element
func (l *List) Back() *Element
```

Three operations matter for LRU: `PushFront`, `MoveToFront`, and `Remove`. We stash a custom struct (key + value) in each `Element.Value` so that during eviction we know *which key* to delete from the map.

```go
type entry[K comparable, V any] struct {
    key K
    val V
}
```

`container/list` itself is **not safe for concurrent use** — the docs say so explicitly. We must add our own locking.

---

## Real-World Analogies

### The librarian's returns trolley

Picture a librarian with a small returns trolley that holds 20 books. When a reader brings back a book, the librarian puts it on the *front* of the trolley. Whenever a reader asks for a book that is already on the trolley, the librarian takes it off, hands it over, and *puts it back on the front* — because it has just been used. When the trolley is full and a new book arrives, the librarian takes the book at the *back* of the trolley (the one untouched the longest) and reshelves it.

The hash map is the librarian's mental index: "I know that book X is on the trolley." The trolley itself is the doubly-linked list. The librarian is the mutex — only one move happens at a time.

### The kitchen prep station

A line cook keeps a small tray of "currently active" ingredients at the front of the station. Each time an ingredient is needed, it gets touched and pushed forward. The ingredient at the back of the tray is the next to be put back in the walk-in fridge. The cook never works on two orders at the same instant on the same tray — that is the mutex.

### The phone's recent-calls list

Your phone shows recent calls newest first. If you call someone who is already in the list, they jump to the top. If the list is capped at 100 entries, the oldest one falls off. That is LRU.

---

## Mental Models

### Model 1 — Two views of the same data

The map and the list are two *views* of the same set of entries. The map view answers "is X here, and where?" in O(1). The list view answers "who is newest?" and "who is oldest?" in O(1). Every operation must update *both views* or the invariant breaks.

The mental trap is to think of them as two separate structures. They are not. They are one structure with two indices. Touch one, you must touch the other.

### Model 2 — The mutex is a one-lane bridge

All cache operations cross a one-lane bridge. Only one car at a time. When traffic is light this is fine; when traffic is heavy you get a queue. Sharding (covered at middle level) is "build more bridges." Lock-free reads (covered at senior level) are "let cars go around the bridge in special cases."

### Model 3 — Get is a write in disguise

In a typical data structure, `Read` and `Write` are clearly separated and an RWMutex helps. In an LRU, `Get` mutates the recency list, so it is a writer. Forgetting this turns "performance optimisation" into a data race.

### Model 4 — The cache is allowed to be wrong, briefly

A cache is a *probabilistic* speedup, not a source of truth. If two goroutines `Set` the same key with different values, one wins and one loses, and that is fine — the database is the source of truth. This relaxed contract is why caches can use weaker synchronisation than, say, a database index.

---

## Pros and Cons

### Pros

- **Sub-microsecond latency.** A pointer chase through a small linked list beats almost every other lookup form.
- **Bounded memory.** Unlike an unbounded map, an LRU cache will not eat your heap.
- **Excellent for "hot-set" workloads.** When a small fraction of keys gets most of the traffic, hit rates above 90% are routine.
- **Simple correctness story.** A single mutex makes a textbook LRU trivially safe.
- **Well-supported libraries.** `hashicorp/golang-lru/v2` covers most production needs in five lines.

### Cons

- **Every Get is a write.** RWMutex does not help the way it does for read-mostly data structures.
- **Single mutex is a hotspot.** Under heavy load, all cores serialise on it.
- **Linked-list nodes pressure the GC.** Every `Set` allocates an `Element` and an `entry` value.
- **Scan-unfriendly.** A one-time scan of N+1 cold keys will evict your entire hot set. LRU has no defence against this; smarter policies (LFU, TinyLFU) do.
- **Doubly-linked list cache misses.** Pointer-chasing through random-allocated nodes is L1-unfriendly compared to array-based structures.

---

## Use Cases

LRU cache is the right first answer when you have:

- **A read-heavy workload with a hot set.** User profiles, product metadata, session lookups, JWT-to-user mappings.
- **Expensive recomputation.** Compiled regexes, parsed templates, marshalled protobufs.
- **Bounded scratch space.** Recent computation results in a workflow engine.
- **Application-level fronting of a database.** Especially when the DB has predictable latency and rare changes per key.

It is **not** the right answer for:

- **Unbounded streaming workloads** where every key is fresh — you will evict useful entries and add overhead.
- **Strict consistency requirements** where stale values cannot be served — use a write-through cache or no cache.
- **Workloads with no temporal locality** — you will hit the LRU end almost every time. Use LFU or W-TinyLFU.
- **Caches larger than RAM** — use a persistent store like Redis, not an in-process LRU.

### A few concrete stories

**Story 1 — The session cache that became a hot mutex.** A startup added an LRU session cache to their auth service. Hit-rate was 99%, latency dropped 10x — for a week. Then traffic doubled and `pprof` showed 40% of CPU in `runtime.lock2`. The single mutex on the cache had become the bottleneck. Sharding to 64 stripes (middle file) fixed it overnight.

**Story 2 — The DNS resolver that leaked.** A team built a DNS cache: domain → IPs. They forgot to add a TTL and the eviction was purely LRU. A scan of a public DNS resolver list (~30 K names in one request) evicted the company's own hot domains. The next 10 minutes were a 10x spike in DNS lookups. They added per-entry TTL and a separate cache for trusted-vs-untrusted domains.

**Story 3 — The compiled-regex cache that boosted throughput 4x.** A log-parser had 50 regexes that all callers shared. Every parse was compiling fresh. An LRU of size 64 (over-provisioned by 14) brought parse time from 1.2 ms to 280 µs.

**Story 4 — The cache that *had* to be perfectly consistent.** A trading engine wanted to cache the per-account margin. They reached for an LRU. Then they realised stale margins could let an account over-borrow. They removed the cache and routed straight to the source of truth with a connection pool instead. Right answer: no cache.

The pattern across these stories is the same. An LRU is exactly right when it is right. When it isn't, it is the wrong default — and you must know the failure modes (mutex contention, scan-eviction, inconsistency) to recognise the misfit.

---

## Code Examples

### Example 1 — A minimal single-goroutine LRU

This version is **not** safe for concurrent use. We start here so the structure is clear; then we add the mutex.

```go
package lru

import "container/list"

type entry[K comparable, V any] struct {
    key K
    val V
}

type LRU[K comparable, V any] struct {
    capacity int
    items    map[K]*list.Element
    order    *list.List
}

func New[K comparable, V any](capacity int) *LRU[K, V] {
    if capacity <= 0 {
        panic("lru: capacity must be positive")
    }
    return &LRU[K, V]{
        capacity: capacity,
        items:    make(map[K]*list.Element, capacity),
        order:    list.New(),
    }
}

func (c *LRU[K, V]) Get(k K) (V, bool) {
    if e, ok := c.items[k]; ok {
        c.order.MoveToFront(e)
        return e.Value.(*entry[K, V]).val, true
    }
    var zero V
    return zero, false
}

func (c *LRU[K, V]) Set(k K, v V) {
    if e, ok := c.items[k]; ok {
        c.order.MoveToFront(e)
        e.Value.(*entry[K, V]).val = v
        return
    }
    if c.order.Len() >= c.capacity {
        back := c.order.Back()
        if back != nil {
            ent := c.order.Remove(back).(*entry[K, V])
            delete(c.items, ent.key)
        }
    }
    ent := &entry[K, V]{key: k, val: v}
    c.items[k] = c.order.PushFront(ent)
}

func (c *LRU[K, V]) Remove(k K) bool {
    if e, ok := c.items[k]; ok {
        c.order.Remove(e)
        delete(c.items, k)
        return true
    }
    return false
}

func (c *LRU[K, V]) Len() int { return c.order.Len() }
```

Read through it slowly. Notice three details:

1. We store `*entry[K, V]` in the list — not just the value. We need the key to know what to delete from the map on eviction.
2. `Get` calls `MoveToFront` — that is the mutation.
3. `Set` checks for existing keys *before* deciding to evict. Updating an existing key never causes an eviction.

### Example 2 — Add the mutex

```go
package lru

import (
    "container/list"
    "sync"
)

type LRU[K comparable, V any] struct {
    mu       sync.Mutex
    capacity int
    items    map[K]*list.Element
    order    *list.List
}

func New[K comparable, V any](capacity int) *LRU[K, V] {
    if capacity <= 0 {
        panic("lru: capacity must be positive")
    }
    return &LRU[K, V]{
        capacity: capacity,
        items:    make(map[K]*list.Element, capacity),
        order:    list.New(),
    }
}

func (c *LRU[K, V]) Get(k K) (V, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if e, ok := c.items[k]; ok {
        c.order.MoveToFront(e)
        return e.Value.(*entry[K, V]).val, true
    }
    var zero V
    return zero, false
}

func (c *LRU[K, V]) Set(k K, v V) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if e, ok := c.items[k]; ok {
        c.order.MoveToFront(e)
        e.Value.(*entry[K, V]).val = v
        return
    }
    if c.order.Len() >= c.capacity {
        back := c.order.Back()
        if back != nil {
            ent := c.order.Remove(back).(*entry[K, V])
            delete(c.items, ent.key)
        }
    }
    ent := &entry[K, V]{key: k, val: v}
    c.items[k] = c.order.PushFront(ent)
}

func (c *LRU[K, V]) Remove(k K) bool {
    c.mu.Lock()
    defer c.mu.Unlock()
    if e, ok := c.items[k]; ok {
        c.order.Remove(e)
        delete(c.items, k)
        return true
    }
    return false
}

func (c *LRU[K, V]) Len() int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.order.Len()
}
```

Every public method begins with `c.mu.Lock()` and `defer c.mu.Unlock()`. This is correct under any number of goroutines. It is *slow* under heavy load because only one goroutine is inside the cache at a time, but correctness comes first.

### Example 3 — Use `hashicorp/golang-lru/v2`

In a real project you almost never write your own LRU. The de facto library is `hashicorp/golang-lru/v2`. It is already concurrency-safe, generic, and tuned.

```go
package main

import (
    "fmt"

    lru "github.com/hashicorp/golang-lru/v2"
)

func main() {
    cache, err := lru.New[string, int](128)
    if err != nil {
        panic(err) // only fails on capacity <= 0
    }

    cache.Add("alice", 1)
    cache.Add("bob", 2)

    if v, ok := cache.Get("alice"); ok {
        fmt.Println("alice =", v)
    }
    fmt.Println("len =", cache.Len())
}
```

The library names the insert method `Add`, not `Set`. Otherwise the surface is what you expect: `Get`, `Add`, `Remove`, `Len`, `Purge`, `Keys`.

### Example 4 — Eviction callback with `golang-lru/v2`

When an entry is evicted, you often want a hook — close a file handle, decrement a refcount, record a metric.

```go
cache, _ := lru.NewWithEvict[string, *os.File](
    128,
    func(key string, value *os.File) {
        _ = value.Close()
    },
)
```

The callback runs **inside the lock**. Do not block, do not panic, do not call back into the cache. Keep it to a non-blocking metric increment or a `Close()`.

### Example 5 — A tiny benchmark

```go
package lru_test

import (
    "strconv"
    "sync"
    "testing"

    lru "github.com/hashicorp/golang-lru/v2"
)

func BenchmarkParallelGet(b *testing.B) {
    cache, _ := lru.New[string, int](10_000)
    for i := 0; i < 10_000; i++ {
        cache.Add(strconv.Itoa(i), i)
    }
    b.ResetTimer()
    var wg sync.WaitGroup
    workers := 8
    each := b.N / workers
    for w := 0; w < workers; w++ {
        wg.Add(1)
        go func(off int) {
            defer wg.Done()
            for i := 0; i < each; i++ {
                cache.Get(strconv.Itoa((off + i) % 10_000))
            }
        }(w * 10_000)
    }
    wg.Wait()
}
```

Run with `go test -bench . -benchmem`. Numbers vary by machine but you should see operation costs in the low hundreds of nanoseconds.

### Example 6 — `Set`-or-`Get` (the "load or store" pattern)

A very common pattern: "if the key is there, return it; otherwise compute and insert."

```go
func GetOrLoad[K comparable, V any](
    c *lru.Cache[K, V],
    key K,
    load func() (V, error),
) (V, error) {
    if v, ok := c.Get(key); ok {
        return v, nil
    }
    v, err := load()
    if err != nil {
        var zero V
        return zero, err
    }
    c.Add(key, v)
    return v, nil
}
```

This version has a small race: two goroutines may both miss and call `load()` for the same key. That is acceptable for many workloads (idempotent loaders). When it is not, use `singleflight` — covered in the middle file.

### Example 7 — `Peek` does not touch recency

Sometimes you want to read a value without affecting eviction order — for example, you are dumping the cache to a log for debugging.

```go
if v, ok := cache.Peek("alice"); ok {
    fmt.Println(v)
}
```

`Peek` skips `MoveToFront`. Use it sparingly; the whole point of LRU is that access *should* affect recency.

### Example 8 — Building a thin wrapper around `golang-lru/v2`

Real applications almost never use the cache library directly. They wrap it so that the call site is meaningful and the library is swappable.

```go
package usercache

import (
    "errors"
    "sync/atomic"

    lru "github.com/hashicorp/golang-lru/v2"
)

type User struct {
    ID    string
    Name  string
    Email string
}

type Cache struct {
    inner *lru.Cache[string, *User]
    hits  atomic.Uint64
    miss  atomic.Uint64
}

func New(capacity int) (*Cache, error) {
    if capacity <= 0 {
        return nil, errors.New("capacity must be positive")
    }
    inner, err := lru.New[string, *User](capacity)
    if err != nil {
        return nil, err
    }
    return &Cache{inner: inner}, nil
}

func (c *Cache) Get(id string) (*User, bool) {
    u, ok := c.inner.Get(id)
    if ok {
        c.hits.Add(1)
    } else {
        c.miss.Add(1)
    }
    return u, ok
}

func (c *Cache) Set(id string, u *User) {
    c.inner.Add(id, u)
}

func (c *Cache) Stats() (hits, misses uint64) {
    return c.hits.Load(), c.miss.Load()
}
```

The wrapper does four useful things at once: (1) gives the cache a domain name (`Cache` inside `package usercache`), (2) hides the library type so swapping is one file change, (3) tracks hit/miss metrics, (4) validates capacity.

### Example 9 — Counting evictions

`hashicorp/golang-lru/v2` exposes an eviction callback. A very common use is just a counter.

```go
package usercache

import (
    "sync/atomic"

    lru "github.com/hashicorp/golang-lru/v2"
)

type Cache struct {
    inner    *lru.Cache[string, *User]
    evicted  atomic.Uint64
}

func New(capacity int) (*Cache, error) {
    c := &Cache{}
    inner, err := lru.NewWithEvict[string, *User](capacity, func(_ string, _ *User) {
        c.evicted.Add(1)
    })
    if err != nil {
        return nil, err
    }
    c.inner = inner
    return c, nil
}
```

If `evicted` grows fast, your capacity is too small for the working set — a clear, measurable signal for tuning.

### Example 10 — A test that *demonstrates* eviction order

It is worth writing one test that exercises the recency rules so future contributors do not break them.

```go
func TestRecencyPromotion(t *testing.T) {
    c, _ := lru.New[string, int](3)
    c.Add("a", 1)
    c.Add("b", 2)
    c.Add("c", 3)
    // Touch "a" so it becomes MRU.
    if _, ok := c.Get("a"); !ok {
        t.Fatal("a should be present")
    }
    // Insert "d" — "b" should be evicted because it is now the LRU end.
    c.Add("d", 4)
    if _, ok := c.Get("b"); ok {
        t.Fatal("b should have been evicted")
    }
    if _, ok := c.Get("a"); !ok {
        t.Fatal("a should still be present (was just touched)")
    }
}
```

If that test ever fails, someone has either reordered the operations or swapped the policy. Both deserve a code review conversation.

### Example 11 — `singleflight` to deduplicate misses

Two goroutines that miss the same key both call the expensive loader. For an idempotent loader this is wasteful but correct. For a non-idempotent loader (or a loader that hits a rate-limited downstream), it is wrong.

```go
package usercache

import (
    "golang.org/x/sync/singleflight"
    lru "github.com/hashicorp/golang-lru/v2"
)

type Cache struct {
    inner *lru.Cache[string, *User]
    sf    singleflight.Group
}

func (c *Cache) GetOrLoad(id string, load func() (*User, error)) (*User, error) {
    if u, ok := c.inner.Get(id); ok {
        return u, nil
    }
    v, err, _ := c.sf.Do(id, func() (interface{}, error) {
        u, err := load()
        if err != nil {
            return nil, err
        }
        c.inner.Add(id, u)
        return u, nil
    })
    if err != nil {
        return nil, err
    }
    return v.(*User), nil
}
```

`singleflight` makes sure that concurrent callers for the same `id` share one in-flight `load()`. Each gets the same result. We cover this pattern more deeply in the middle file.

### Example 12 — `Contains` for "is this hot?"

```go
if cache.Contains("user:12345") {
    metrics.HotKeyHits.Inc()
}
```

`Contains` is like `Peek` — it does not promote recency. Use it for diagnostics, not application logic.

### Example 13 — `Cache.Resize` to grow on demand

```go
cache, _ := lru.New[string, int](128)
// later, under high traffic:
cache.Resize(1024)
```

`Resize` adjusts capacity. Growing is free; shrinking evicts the surplus. Use a metric (current size, evictions/min) to decide when to grow.

### Example 14 — Storing immutable values

A cached struct can be read by many goroutines simultaneously. If you mutate it, you race. The cleanest fix is to *never mutate cached values*. Treat them as immutable.

```go
// Good: build the new value outside the cache, then Add.
u := *(cached)        // copy
u.Email = newEmail    // mutate the copy
cache.Add(id, &u)     // replace the entry
```

The map now holds a different pointer, and any goroutine still reading the old `*User` is safe.

### Example 15 — A loader-aware wrapper that handles errors

```go
type Loader[K comparable, V any] func(K) (V, error)

type LoadingCache[K comparable, V any] struct {
    inner *lru.Cache[K, V]
    load  Loader[K, V]
}

func NewLoading[K comparable, V any](capacity int, load Loader[K, V]) (*LoadingCache[K, V], error) {
    inner, err := lru.New[K, V](capacity)
    if err != nil {
        return nil, err
    }
    return &LoadingCache[K, V]{inner: inner, load: load}, nil
}

func (c *LoadingCache[K, V]) Get(k K) (V, error) {
    if v, ok := c.inner.Get(k); ok {
        return v, nil
    }
    v, err := c.load(k)
    if err != nil {
        var zero V
        return zero, err
    }
    c.inner.Add(k, v)
    return v, nil
}
```

A loader-aware cache is a *very* common pattern. The only thing missing here is deduplication of concurrent misses for the same key — that is what `singleflight` adds.

### Example 16 — Closing files when the cache evicts

```go
fileCache, _ := lru.NewWithEvict[string, *os.File](
    32,
    func(_ string, f *os.File) {
        _ = f.Close()
    },
)
```

A useful idiom for bounded handle pools. The cache guarantees at most 32 open files; least-recently-used files close automatically.

### Example 17 — Combining LRU with a TTL

A pure LRU never expires entries. If your data has a freshness deadline (e.g., 60 seconds), wrap the value with its insertion time.

```go
type ttlEntry[V any] struct {
    val      V
    expireAt time.Time
}

type TTLCache[K comparable, V any] struct {
    inner *lru.Cache[K, ttlEntry[V]]
    ttl   time.Duration
}

func (c *TTLCache[K, V]) Get(k K) (V, bool) {
    e, ok := c.inner.Get(k)
    if !ok {
        var zero V
        return zero, false
    }
    if time.Now().After(e.expireAt) {
        c.inner.Remove(k)
        var zero V
        return zero, false
    }
    return e.val, true
}

func (c *TTLCache[K, V]) Set(k K, v V) {
    c.inner.Add(k, ttlEntry[V]{val: v, expireAt: time.Now().Add(c.ttl)})
}
```

A more sophisticated TTL design lives in the TTL-caches subsection; this snippet is the minimum useful combination.

### Example 18 — Logging eviction *rates*, not events

```go
var evictCount atomic.Uint64

cache, _ := lru.NewWithEvict[string, int](128, func(_ string, _ int) {
    evictCount.Add(1)
})

go func() {
    t := time.NewTicker(time.Minute)
    defer t.Stop()
    var last uint64
    for range t.C {
        cur := evictCount.Load()
        log.Printf("evictions/min=%d total=%d", cur-last, cur)
        last = cur
    }
}()
```

A rate-per-minute log line is friendlier to log volume than a per-eviction WARN.

---

## Coding Patterns

### Pattern 1 — Always `defer` the unlock

```go
c.mu.Lock()
defer c.mu.Unlock()
// ... critical section ...
```

Never `Lock` without `defer Unlock` unless you have a specific reason and a single exit. The first time you `return` early without unlocking, you create a deadlock that survives until process restart.

### Pattern 2 — Keep the critical section short

Inside the lock, do only the cache work. Anywhere you can compute *outside* the lock, do so:

```go
// BAD: expensive serialisation inside the lock
func (c *LRU[K, V]) SetSerialised(k K, v interface{}) {
    c.mu.Lock()
    defer c.mu.Unlock()
    b, _ := json.Marshal(v) // slow! holds the lock
    c.setRaw(k, b)
}

// GOOD: serialise first, then lock
func (c *LRU[K, V]) SetSerialised(k K, v interface{}) {
    b, _ := json.Marshal(v)
    c.mu.Lock()
    defer c.mu.Unlock()
    c.setRaw(k, b)
}
```

### Pattern 3 — One struct field per logical role

Keep the four fields visible and named:

```go
type LRU[K comparable, V any] struct {
    mu       sync.Mutex          // protects items and order
    capacity int                 // immutable after New
    items    map[K]*list.Element // K -> node
    order    *list.List          // recency
}
```

Comments next to each field communicate the invariant. Future readers will thank you.

### Pattern 4 — Validate `capacity` in `New`

A capacity of zero or negative is a programmer error, not a runtime condition. Panic (or return an error if your API style prefers).

```go
func New[K comparable, V any](capacity int) *LRU[K, V] {
    if capacity <= 0 {
        panic("lru: capacity must be positive")
    }
    // ...
}
```

`hashicorp/golang-lru/v2.New` returns an error in this case — both styles are fine.

### Pattern 5 — Use `Peek` for housekeeping, `Get` for application logic

```go
// In a metrics dump:
for _, k := range cache.Keys() {
    if v, ok := cache.Peek(k); ok {
        export(k, v)
    }
}

// In user-facing code:
if v, ok := cache.Get(userID); ok {
    return v
}
```

`Peek` keeps the eviction order honest. `Get` updates recency, which is exactly what you want when the application touches a key.

### Pattern 6 — Never store values you have not validated

```go
// BAD
cache.Add(input, parse(input)) // parse may have returned the zero value silently

// GOOD
v, err := parse(input)
if err != nil {
    return err
}
cache.Add(input, v)
```

A cache holding silently-broken values is a cache that propagates failures forever.

### Pattern 7 — Use the cache only as a *fast path*, never the *only path*

```go
func (s *Service) GetUser(ctx context.Context, id string) (*User, error) {
    if u, ok := s.cache.Get(id); ok {
        return u, nil // fast path
    }
    u, err := s.db.GetUser(ctx, id) // slow path
    if err != nil {
        return nil, err
    }
    s.cache.Add(id, u)
    return u, nil
}
```

If the cache is the only path, a cache restart loses data. The database (or whatever the source of truth is) must always be reachable.

### Pattern 8 — Document the staleness contract

```go
// Get returns the cached user. The result may be up to 5 minutes stale.
// Callers that require fresh data must bypass this cache.
func (c *Cache) Get(id string) (*User, bool) { /* ... */ }
```

Stale-by-design is fine, but only if callers know. The doc comment is the contract.

---

## Clean Code

- **Name the cache after what it caches**, not after the type. `userCache` is better than `lruCache`. The implementation can change; the role does not.
- **Hide the library type behind an interface** in package code. Then you can swap `golang-lru` for `ristretto` without touching call sites.

```go
type UserCache interface {
    Get(id string) (*User, bool)
    Set(id string, u *User)
    Remove(id string)
}
```

- **Keep `capacity` as a configuration value**, not a constant in the code. Operators want to tune it.
- **Log evictions only at a sample rate**, not on every event, or the log will become the bottleneck.
- **Never expose the underlying `*list.Element`** to callers. The element is an implementation detail and exposing it leaks the linked-list contract.

---

## Product Use and Features

LRU caches show up in almost every back-end Go service. A few real examples:

- **HTTP middleware** that caches JWT-to-user lookups for 30 seconds so the auth path does not hit the database every request.
- **Image proxy** that caches the resized output of `(url, width, height)` so the second request is served from memory.
- **Feature-flag client** that caches `(flag, userID)` evaluations so a hot flag is checked thousands of times per second without re-evaluating the rules.
- **DNS resolver** that caches `(domain → A records)` for the TTL.
- **Config service** that caches recently used config blobs so a sudden burst of pod restarts does not flood the upstream.
- **Compiled-regex cache** in a log-processing pipeline so each rule is compiled only once.

In every case the cache is a *bounded* fronting layer. The source of truth lives elsewhere.

---

## Error Handling

The cache itself does not produce errors at the operation level — `Get` returns `(V, bool)` and `Set` returns nothing. Errors come from the *loader* that feeds the cache.

The two patterns:

### Pattern A — Negative caching

```go
v, err := loadFromDB(k)
if err != nil {
    cache.Add(k, sentinelError) // cache the absence
    return zero, err
}
cache.Add(k, v)
```

Cache the error too, so a hot key that does not exist does not hammer the database. Use a *shorter* TTL for negative entries (covered in TTL section).

### Pattern B — Bypass the cache on error

```go
v, err := loadFromDB(k)
if err != nil {
    return zero, err // do not insert anything
}
cache.Add(k, v)
```

Simpler. The risk is repeated database load for missing keys.

Pick A or B per use case; do not mix.

### Errors during eviction callbacks

If your eviction callback can fail (e.g., `Close` returns an error), do not panic. Log and continue. The cache cannot know what to do with your error, and panicking inside the lock will tear down the program.

```go
lru.NewWithEvict[string, *os.File](128, func(k string, f *os.File) {
    if err := f.Close(); err != nil {
        log.Printf("lru evict: close %s: %v", k, err)
    }
})
```

---

## Security Considerations

A cache is a *side channel*. Treat it accordingly.

- **Do not cache secrets in process memory longer than needed.** Tokens, API keys, decrypted PII. If you must, document the lifetime and capacity.
- **Cache poisoning.** If untrusted input becomes a cache key (e.g., the requested URL), a malicious actor can fill your cache with junk and evict the hot set. Bound key length, validate input, and consider a separate cache for trusted vs untrusted keys.
- **Timing channels.** Cache hits are faster than misses. An attacker can probe to learn what is hot. For user-data caches, this can leak which users were recently active. For most internal services this is acceptable; for cryptographic operations it is not — use constant-time operations.
- **Memory exhaustion.** If `capacity` is a configuration value taken from untrusted input, an attacker can set it to `MaxInt` and OOM the process. Bound it.

The mutex itself is not a security primitive — do not rely on it to protect secrets.

---

## Performance Tips

- **Pick a power-of-two capacity** (1024, 8192, 16384). Sharding logic later will use bitmasks.
- **Pre-allocate the map** with `make(map[K]V, capacity)`. Avoids growth rehashes.
- **Avoid huge value types** stored by value — they balloon the map and copy on every assignment. Use pointers for values larger than ~64 bytes.
- **Use generics**, not `interface{}`. `interface{}` forces every value to allocate and incurs type-assertion cost on every Get.
- **Do not hold the lock across I/O.** Lock-Marshal-Unlock-Write, not Lock-Marshal-Write-Unlock.
- **Reuse `Element`s where possible.** Advanced trick — covered at senior level.
- **Measure before sharding.** A single-mutex LRU is often fast enough up to ~100 K ops/sec. Sharding matters above that.
- **Treat `Purge` as a maintenance operation**, not a hot-path call. It walks the list.
- **Prefer pointer keys for large strings.** A 200-byte key copied on every `Get` is more expensive than the actual lookup.
- **Set a `runtime.GC()` budget if you cache pointer-heavy values.** Linked-list nodes are garbage-collected one by one when the cache shrinks; large bursts can stress the GC.
- **Profile with `pprof`** before assuming a bottleneck. The mutex `contention` profile (`runtime.SetMutexProfileFraction(1)`) tells you exactly how long goroutines wait at `Lock`.

### A quick benchmark to know your numbers

```go
func BenchmarkSingleMutexLRU(b *testing.B) {
    c, _ := lru.New[int, int](1 << 14)
    for i := 0; i < 1<<14; i++ {
        c.Add(i, i)
    }
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            c.Get(i & (1<<14 - 1))
            i++
        }
    })
}
```

On a modern laptop this typically reports something like 200–400 ns/op single-thread, climbing toward 1500 ns/op under 16 parallel goroutines — the contention cost is visible. Sharding (middle file) brings it back down.

---

## Best Practices

1. **Make `capacity` explicit, validated, and configurable.**
2. **Always run tests with `-race`.** Concurrency bugs are not visible without it.
3. **Wrap the cache in an interface** at the package boundary. You will switch implementations more than once.
4. **Add a metric** for hit-rate, eviction count, and size. Without those numbers the cache is a black box.
5. **Use `hashicorp/golang-lru/v2`** unless you have a specific reason not to.
6. **Document the eviction policy in the type name** — `LRUCache`, `LFUCache`, `TTLCache`. A future reader should not have to guess.
7. **Make the cache `private`** to a package, with constructor and methods that mediate access. Exposing the type-parameterised struct invites misuse.
8. **Keep eviction callbacks tiny and panic-free.** They run inside the lock.
9. **Prefer pointer values** for cached items larger than ~64 bytes. Reduces copying.
10. **Add an integration test** that runs your service with `-race` for at least a minute under realistic load.
11. **Pre-warm the cache** at startup with the known top-N keys if the cold-start hit-rate matters.
12. **Re-evaluate cache effectiveness quarterly.** Working sets change as traffic patterns change.
13. **Use shorter TTLs for security-sensitive data** even when LRU would normally hold them longer.
14. **Never log the cached value**, only the key, to avoid leaking PII.

---

## Edge Cases and Pitfalls

- **Zero capacity.** The cache stores nothing and `Get` always misses. Validate in `New`.
- **`Set(k, sameValue)` after a `Get(k)`.** Both promote recency. Make sure your test does not assume the value is unchanged.
- **`Set(k, nil)` where V is a pointer type.** The cache stores `nil` and `Get` returns `(nil, true)`. That `true` matters — it differs from "not in cache."
- **`Remove(k)` followed immediately by `Get(k)`** — must return miss, not the old value.
- **A goroutine panics inside an eviction callback** — kills the process. Wrap callbacks in `defer recover()` if they can panic.
- **`Len()` is racy if read without the lock.** Always lock around it.
- **The cache outlives the data it caches.** If the loader returns mutable structs, you may mutate cached values from outside. Defensive copy, or store immutable types.
- **A `Set` that updates an existing key does *not* count as an eviction.** Eviction-driven metrics will under-report churn if you confuse update with insert.
- **Setting a key whose value is a large struct** copies the entire struct on the way in and on the way out — pointers avoid both copies.
- **Calling `Keys()` while another goroutine is mutating the cache** is safe in `hashicorp/golang-lru/v2` (it locks), but the returned slice is a *snapshot*. Treat it as immediately stale.
- **`Add` returns a `bool` in some libraries** indicating whether an eviction occurred. Different libraries name this differently. Read the docs of your specific version.
- **Negative capacity from a typo (`-1`).** `hashicorp/golang-lru/v2.New` returns an error; your home-grown version should panic or return error. Never silently treat it as zero.
- **A long key (e.g., a 64 KB URL).** The map will store the full key in the hash table; a million of these will OOM you. Truncate or hash long keys before use.
- **An eviction callback that takes 5 ms** stalls the whole cache for 5 ms on each insert at full capacity. Keep callbacks micro-fast.
- **Using the cache from a `finalizer`** — bad idea. Finalizers run in a separate goroutine; they may run *after* the cache is gone. Do not couple lifetimes.

---

## Common Mistakes

### Mistake 1 — Using `sync.RWMutex` for an LRU

```go
// WRONG
func (c *LRU[K, V]) Get(k K) (V, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    if e, ok := c.items[k]; ok {
        c.order.MoveToFront(e) // RACE: this is a write!
        return e.Value.(*entry[K, V]).val, true
    }
    var zero V
    return zero, false
}
```

`Get` mutates `c.order`. Multiple readers will corrupt the list.

**Fix.** Either use `sync.Mutex`, or split into `Get` (write lock) and `Peek` (read lock).

### Mistake 2 — Forgetting to delete the map entry on eviction

```go
// WRONG
if c.order.Len() >= c.capacity {
    c.order.Remove(c.order.Back()) // map still has the key!
}
```

The map keeps growing. Subsequent `Get`s of an "evicted" key return a stale `*list.Element` pointing to a freed node — you crash on `MoveToFront`.

**Fix.** Always pair `order.Remove` with `delete(items, key)`.

### Mistake 3 — Eviction callback that calls back into the cache

```go
cache, _ := lru.NewWithEvict[string, int](128, func(k string, v int) {
    cache.Add(k, v) // DEADLOCK
})
```

The eviction runs while the cache lock is held. Re-entering the cache deadlocks.

**Fix.** Push work to a separate goroutine, or restructure so the callback only does non-cache work.

### Mistake 4 — Capturing the loop variable in a benchmark

```go
for i := 0; i < N; i++ {
    go func() {
        cache.Get(keys[i]) // shared i!
    }()
}
```

Classic. Pass `i` as a parameter. (On Go 1.22+ this happens to work, but be explicit.)

### Mistake 5 — Treating the cache as durable

```go
cache.Add(orderID, paidStatus) // process restarts → lost
```

The cache is an in-memory accelerator. It is wiped on restart, on `Purge`, and on eviction. Never use it as the only place a fact lives.

### Mistake 6 — Sharing one cache across two unrelated workloads

```go
cache, _ := lru.New[string, any](1024)
cache.Add("user:123", user)
cache.Add("config:billing", cfg)
```

If config is hot but small, it evicts users. If users are hot, they evict config. Two caches, one per concern.

### Mistake 7 — Not setting `capacity` from operator-visible config

A capacity hard-coded in source means a redeploy to tune it. In production you will retune it many times. Make it a flag or env var.

### Mistake 8 — Re-using the same lock for two unrelated caches

```go
// BAD
var mu sync.Mutex
var userCache = lru.NewWithLock[string, *User](128, &mu)
var sessionCache = lru.NewWithLock[string, *Session](128, &mu)
```

Two caches that conceptually do not share state now serialise behind one mutex. There is no benefit and a clear cost.

### Mistake 9 — Catching panics inside the callback but not in the caller

If your eviction callback can panic (e.g., a Close on a nil pointer), `recover` inside the callback is not enough — the surrounding cache code may already be on the deferred-`recover` path. Test the callback in isolation with deliberately broken values.

### Mistake 10 — Pretending the cache is the database

This is the cardinal sin. New engineers write code that mutates a cached object expecting the change to persist. The next eviction destroys the change. Always write to the source first, then update the cache (write-through), or invalidate the cache and let the next read repopulate (write-around).

### Mistake 11 — Holding a value pointer beyond its lifetime

```go
// BAD
u, _ := cache.Get(id) // u may be evicted while we hold a pointer
go heavyWork(u)        // background goroutine still has the pointer
```

In Go this is safe — GC keeps the object alive as long as `u` is reachable — but the cache no longer reflects the same object as the one your goroutine holds. If a later `cache.Add(id, newU)` replaces it, `heavyWork` runs against the *old* state. Document this or copy.

### Mistake 12 — Treating eviction as failure

`cache.Add` quietly evicting an old key is *expected*. Logging at WARN every eviction will fill your logs with normal traffic. Track eviction *counts*, not eviction *events*.

### Mistake 13 — Forgetting that `Get` returns `(V, bool)` not `(V, error)`

```go
v, _ := cache.Get(k) // bool ignored; v is zero on miss
process(v)           // silently processes the zero value
```

Always check the boolean. A zero value is almost never what you wanted; it is the *absence* signal.

### Mistake 14 — Storing entries with circular references

```go
type Node struct {
    Children []*Node
    Parent   *Node
}
cache.Add(id, &Node{...}) // GC will still collect, but cycles slow scans
```

Cyclic graphs in cached values cost more GC time. If your domain has cycles, either flatten before caching or accept the cost.

### Mistake 15 — Calling the cache from inside the cache's own metrics handler

If you expose a `/metrics` endpoint that iterates `cache.Keys()` and your metrics scrape runs every 10 seconds against a 1M-entry cache, you serialise every scrape against the cache lock. Either snapshot the keys outside the scrape path or expose aggregates only.

---

## Common Misconceptions

- **"LRU is the best cache policy."** No — it is the most famous one. For some workloads (frequency-skewed traffic), LFU or W-TinyLFU produces measurably higher hit rates. Pick the policy after measuring.
- **"`sync.Map` is a faster LRU."** No — `sync.Map` has no eviction at all. It grows forever.
- **"An RWMutex always helps read-heavy workloads."** Not for LRU. Reads are writes.
- **"Eviction happens on a timer."** No (unless you build a TTL layer on top). Eviction happens only when an insert finds the cache full.
- **"`golang-lru` is the only choice."** It is the most common. `dgraph-io/ristretto` and `vmihailenco/ristretto` (TinyLFU) are common alternatives.
- **"Bigger capacity is always better."** Diminishing returns. A cache twice as big rarely doubles hit-rate; it often gains a few percentage points at twice the memory. Measure.
- **"The cache is consistent with the database."** It is *eventually* consistent at best. Anything that requires strict consistency must bypass the cache or use a write-through pattern.

---

## Tricky Points

### Trick 1 — `Get` must move *before* it returns

If you read the value, return, and `MoveToFront` later, two concurrent goroutines may interleave their reads and moves. The textbook order is: lock, look up, move, read value, unlock. Never separate them.

### Trick 2 — `len(items)` vs `order.Len()`

By invariant they are equal. By implementation they are stored in different places. If you ever see them diverge in a debugger, you have a bug.

### Trick 3 — Eviction during `Set` of an *existing* key

You must check for existence *before* the eviction branch. Otherwise an update can trigger an unnecessary eviction (or, worse, evict the very key you are about to update).

### Trick 4 — `Set(k, v)` then `Get(k)` should be a hit

This sounds obvious. It is not under concurrency if you don't lock both ends. Imagine `Set` holds the lock, returns, and a concurrent `Set(k, w)` runs before your `Get(k)` even starts. Your `Get` returns `w`, not `v`. That is correct — but new engineers often assume "I just wrote it; I will read what I wrote." Document the relaxed ordering.

### Trick 5 — `Peek` does not extend the lifetime

If you `Peek` a key on the LRU end, it stays on the LRU end and is next to die. This is by design but surprises people.

### Trick 6 — `Purge` is O(n)

`Purge()` clears the cache. It walks the list and clears the map. Do not call it in a hot path — it holds the lock for the duration.

### Trick 7 — `Keys()` returns in order, but which order?

`hashicorp/golang-lru/v2.Keys()` returns keys in *MRU → LRU* order (front to back). Some forks return LRU → MRU. Check the doc comment. A test that asserts order is one way to lock the contract.

### Trick 8 — `Resize(newCap)` evicts

If your library has `Resize(n)` and `n < Len()`, the cache must evict `Len() - n` entries on the spot. Each eviction fires the callback. Do not call `Resize` from inside a callback.

### Trick 9 — Closures captured during `New` outlive the cache

```go
func makeCache() *lru.Cache[string, int] {
    closer := openFile()
    c, _ := lru.NewWithEvict[string, int](128, func(_ string, _ int) {
        closer.Close() // captures "closer"
    })
    return c
}
```

The callback keeps `closer` alive for as long as the cache exists. If `closer` holds a 10 MB buffer, that buffer stays around. Be mindful of captures.

### Trick 10 — Map iteration order is unstable

Go maps iterate in random order. If you implement your own LRU and try to "iterate the map to find the LRU end," you get a different victim every run. That is why we use the list.

### Trick 11 — `Add` may move *and* update

If the key exists, `Add(k, newV)` updates the value *and* promotes recency. New engineers sometimes expect `Add` to be insert-only and write a separate `Update`. The library merges them deliberately.

### Trick 12 — Eviction order under ties

If two keys were inserted at the same instant and never touched again, which is evicted first? Whichever was inserted earlier — insertion is the implicit "last touch." But your test cannot rely on instants; use a `Get` to disambiguate.

---

## Test

The full file is exercised in [tasks.md](tasks.md) and [find-bug.md](find-bug.md). A starter test for your own LRU:

```go
package lru_test

import (
    "sync"
    "testing"
)

func TestBasicSetGet(t *testing.T) {
    c := New[string, int](3)
    c.Set("a", 1)
    c.Set("b", 2)
    c.Set("c", 3)
    if v, ok := c.Get("a"); !ok || v != 1 {
        t.Fatalf("want a=1, got %v ok=%v", v, ok)
    }
}

func TestEviction(t *testing.T) {
    c := New[string, int](2)
    c.Set("a", 1)
    c.Set("b", 2)
    c.Set("c", 3) // evicts "a"
    if _, ok := c.Get("a"); ok {
        t.Fatal("a should have been evicted")
    }
    if v, _ := c.Get("c"); v != 3 {
        t.Fatalf("c=%d", v)
    }
}

func TestConcurrentRace(t *testing.T) {
    c := New[int, int](100)
    var wg sync.WaitGroup
    for w := 0; w < 16; w++ {
        wg.Add(1)
        go func(seed int) {
            defer wg.Done()
            for i := 0; i < 10_000; i++ {
                k := (seed + i) % 200
                c.Set(k, i)
                _, _ = c.Get(k)
            }
        }(w)
    }
    wg.Wait()
}
```

Run with `go test -race ./...`. If the race detector is silent, your invariants survive contention.

---

## Tricky Questions

1. **Why doesn't an RWMutex help an LRU?** Because `Get` mutates the recency list.
2. **What is the LRU invariant?** Keys in the map are exactly the entries in the list, and there are at most `capacity` of each.
3. **Why a doubly-linked list and not a slice?** Slice middle-removal is O(n); list middle-removal is O(1).
4. **What happens to `Get(k)` when `k` was just evicted by another goroutine?** It returns miss. There is no half-state because each operation holds the lock.
5. **What is the worst-case behaviour of an LRU under a one-time full scan?** The hot set is evicted; hit-rate collapses until traffic returns to normal. Scan resistance requires LFU or TinyLFU.
6. **Why does `hashicorp/golang-lru/v2.New` return an error?** It validates `capacity > 0`. The error is the library's way of avoiding a panic in user code.
7. **Is `cache.Len()` safe to call from many goroutines?** Yes, because the library locks internally. Your own LRU must too.
8. **What is the cost of a `Get` hit?** Map lookup (O(1) average), `MoveToFront` (O(1)), a pointer dereference, an unlock. A few hundred nanoseconds on modern hardware.
9. **What is the cost of a `Set` that evicts?** Two map operations, two list operations, the eviction callback if any, plus the allocation of a new `Element`. Still O(1) but with a higher constant.
10. **What is a "ghost" entry in a cache?** An entry the cache *remembers seeing* but did not keep. Used by 2Q and ARC to detect recency vs frequency. Out of scope at junior level.
11. **What is the difference between `Add` and `Set`?** `Add` is the `hashicorp/golang-lru/v2` name; `Set` is the name used by some other libraries. Both mean "insert or update."
12. **What does `Add` return?** A `bool` indicating whether an eviction happened to make room. Useful for diagnostics.
13. **Can `Get` panic?** Not on its own — only if your value is `nil` and you dereference it without checking `ok`.
14. **What if the loader returns `nil, nil`?** Your code stores `nil`. Future `Get`s return `(nil, true)`. Document whether `nil` is a legal cached value or use a sentinel.
15. **Does `Purge` reset metrics?** No. `Purge` clears the cache; the hit/miss counters are yours.
16. **Why is the eviction callback synchronous?** Because the cache must wait for the callback to finish before considering the slot free. Async callbacks would race with the slot reuse.
17. **Can two goroutines safely call `Add(k, v)` and `Get(k)` for the same `k`?** Yes — the lock serialises them. Which goes first is timing-dependent.
18. **What does `Resize` do?** Changes `capacity`. If the new capacity is smaller than `Len`, the surplus is evicted immediately, oldest first.
19. **Why is `container/list` documented as "not safe for concurrent use"?** Because `MoveToFront` is multiple pointer writes that must appear atomic; without a lock, concurrent calls can corrupt the list.
20. **What happens if I forget the eviction callback?** Nothing — the entry is dropped silently. Resources you intended to free will leak.

---

## Cheat Sheet

```text
PICK CONCURRENT LRU WHEN:
  * Read-heavy workload, hot subset, bounded memory.
  * In-process speed required (sub-microsecond).
  * You can tolerate eventual consistency with the source.

AVOID WHEN:
  * No locality (every key is fresh).
  * Strict consistency required.
  * Workload bigger than RAM.

INVARIANT:
  len(items) == order.Len()  AND  items keys == order entries  AND  count <= capacity

OPERATIONS:
  Get(k):  if hit, MoveToFront then return value.
  Set(k,v): if exists, update + MoveToFront. else if full, evict Back. PushFront new.
  Remove(k): list.Remove + delete(map,k).

CONCURRENCY:
  sync.Mutex around all ops. RWMutex is WRONG for an LRU's Get.

LIBRARY:
  hashicorp/golang-lru/v2.New[K, V](capacity)
  Methods: Add, Get, Peek, Remove, Len, Purge, Keys.
  NewWithEvict to add a callback (runs under lock — keep it short).

COMMON BUGS:
  Forget to delete map entry on eviction.
  RWMutex used because "Get is a read" (it isn't).
  Eviction callback re-enters the cache (deadlock).
  Capacity hardcoded.
```

---

## A production checklist before merging the cache PR

When you propose adding an in-process cache to a service, the reviewer should be able to tick all of these. Internalising the list saves you a round of comments.

- [ ] The cache type is named for its role (`UserCache`, not `LRUCache`).
- [ ] The implementation is hidden behind an interface (`UserCache interface { ... }`).
- [ ] Capacity is a configuration value, not a constant.
- [ ] Capacity is validated; zero or negative is rejected.
- [ ] The cache is initialised once per process, not per request.
- [ ] There is a metric for hit rate (counter for hits, counter for misses).
- [ ] There is a metric for eviction rate.
- [ ] There is a metric for current size.
- [ ] The eviction callback (if any) is non-blocking and panic-free.
- [ ] All public methods that touch the cache are concurrency-safe (you used the library, or you wrote tests with `-race`).
- [ ] You have a test for basic Set/Get/Eviction.
- [ ] You have a test that runs under `-race` with at least 8 goroutines.
- [ ] You documented the staleness contract in a doc comment.
- [ ] You documented the cache invalidation path (or stated explicitly that there is none).
- [ ] You used `singleflight` if concurrent misses must not fan out.
- [ ] You have a runbook entry for "cache hit-rate dropped" troubleshooting.

A reviewer who sees this list addressed will approve fast. A reviewer who sees half of it missing will ask all the questions.

## Observability deep dive

A cache without metrics is a black box. The minimum useful set is four counters and one gauge:

```go
var (
    cacheHits      atomic.Uint64
    cacheMisses    atomic.Uint64
    cacheEvictions atomic.Uint64
    cacheUpdates   atomic.Uint64
    cacheSize      atomic.Int64
)
```

Export them via your metrics library:

```go
prometheus.MustRegister(
    prometheus.NewCounterFunc(
        prometheus.CounterOpts{Name: "lru_hits_total"},
        func() float64 { return float64(cacheHits.Load()) },
    ),
    prometheus.NewCounterFunc(
        prometheus.CounterOpts{Name: "lru_misses_total"},
        func() float64 { return float64(cacheMisses.Load()) },
    ),
    prometheus.NewCounterFunc(
        prometheus.CounterOpts{Name: "lru_evictions_total"},
        func() float64 { return float64(cacheEvictions.Load()) },
    ),
    prometheus.NewGaugeFunc(
        prometheus.GaugeOpts{Name: "lru_size"},
        func() float64 { return float64(cacheSize.Load()) },
    ),
)
```

The dashboards you want:

1. **Hit rate over time.** `rate(lru_hits_total[1m]) / (rate(lru_hits_total[1m]) + rate(lru_misses_total[1m]))`. Stable around your steady-state. Drops indicate scan attacks or working-set changes.
2. **Eviction rate over time.** A leading indicator of capacity stress. If `evictions / hits > 0.1`, the cache is undersized.
3. **Size vs capacity.** If size stays well below capacity, you have headroom (good). If it pins at capacity continuously, expect evictions.
4. **Latency p99 with vs without cache.** Run a small fraction of requests with cache disabled and measure the difference. Justifies the cache's existence.

The alerts you want:

- **Hit-rate drops below 70% for 5 minutes** (page someone — likely a scan).
- **Eviction rate doubles week-over-week** (ticket for capacity review).
- **Cache size flat at zero for 1 minute** (panic — the cache is broken).

Most teams over-instrument. Four counters and one gauge are enough.

## A guided debugging session

You are on call. A new pod has been deployed for the user service. Latency p99 is 4x what it was yesterday. Your team's hypothesis is "the cache is broken." How do you confirm or refute?

### Step 1 — Look at the cache metrics

Open Grafana, find the dashboard, see hit-rate. Yesterday: 98%. Today: 31%. That is the smoking gun.

### Step 2 — Check the cache size

`cache_size` was 16 384 (capacity) yesterday. Today it is also 16 384. The cache is *full* but is missing 70% of lookups. Conclusion: the *wrong* keys are in the cache.

### Step 3 — Look at eviction rate

Yesterday: 200 evictions/second. Today: 50 000 evictions/second. The cache is thrashing.

### Step 4 — Look at request patterns

`kubectl logs` shows a new request type — a batch importer is iterating every user ID in alphabetical order. Each request misses, loads, inserts, evicts. The batch is 5 million IDs.

### Step 5 — Identify the cause

A bulk scan is evicting your hot set. LRU has no defence: every "new" key it sees is more recent than your hot keys, so each insertion picks one of your hot keys to evict. By the time the scan ends, your hot set is gone and your hit-rate is whatever the scan happened to leave behind.

### Step 6 — Fix options

- **Short term.** Make the batch importer call a separate endpoint that bypasses the in-process cache (writes go to Redis only).
- **Medium term.** Move the cache to W-TinyLFU (ristretto) so the admission filter rejects keys that have not proven themselves popular.
- **Long term.** Add per-endpoint cache scoping: the API endpoint uses one cache, the batch endpoint uses a different (or no) cache.

This kind of triage is what happens in real production. Knowing how LRU evicts, and knowing its weakness against scans, lets you skip the "what is happening" step entirely.

## Your first cache PR: a walkthrough

You have been asked to add caching to a slow endpoint. The endpoint `GET /products/{id}` calls a downstream catalog service and the round-trip is 80 ms. Your job is to add a per-pod LRU cache and reduce the typical response time.

### Step A — Measure before you start

```go
func (s *Service) GetProduct(ctx context.Context, id string) (*Product, error) {
    start := time.Now()
    defer func() {
        s.metrics.GetProductLatency.Observe(time.Since(start).Seconds())
    }()
    return s.catalog.GetProduct(ctx, id)
}
```

Deploy, measure for 24 hours. Note p50, p99, requests/sec, distinct IDs/sec. Without this baseline you cannot prove the cache helped.

### Step B — Add the cache wrapper

```go
package productcache

import (
    "errors"
    "sync/atomic"

    lru "github.com/hashicorp/golang-lru/v2"
)

type Product = catalog.Product

type Cache struct {
    inner  *lru.Cache[string, *Product]
    hits   atomic.Uint64
    misses atomic.Uint64
}

func New(capacity int) (*Cache, error) {
    if capacity <= 0 {
        return nil, errors.New("capacity must be positive")
    }
    c, err := lru.New[string, *Product](capacity)
    if err != nil {
        return nil, err
    }
    return &Cache{inner: c}, nil
}

func (c *Cache) Get(id string) (*Product, bool) {
    p, ok := c.inner.Get(id)
    if ok {
        c.hits.Add(1)
    } else {
        c.misses.Add(1)
    }
    return p, ok
}

func (c *Cache) Set(id string, p *Product) {
    c.inner.Add(id, p)
}

func (c *Cache) Stats() (uint64, uint64) {
    return c.hits.Load(), c.misses.Load()
}
```

### Step C — Wire it in

```go
func (s *Service) GetProduct(ctx context.Context, id string) (*Product, error) {
    if p, ok := s.cache.Get(id); ok {
        return p, nil
    }
    p, err := s.catalog.GetProduct(ctx, id)
    if err != nil {
        return nil, err
    }
    s.cache.Set(id, p)
    return p, nil
}
```

### Step D — Expose metrics

```go
prometheus.MustRegister(
    prometheus.NewCounterFunc(
        prometheus.CounterOpts{Name: "product_cache_hits_total"},
        func() float64 { h, _ := s.cache.Stats(); return float64(h) },
    ),
    prometheus.NewCounterFunc(
        prometheus.CounterOpts{Name: "product_cache_misses_total"},
        func() float64 { _, m := s.cache.Stats(); return float64(m) },
    ),
)
```

### Step E — Roll out behind a flag

Capacity-zero behaviour means the cache is effectively disabled. Use a feature flag for the *use* of the cache:

```go
if s.cacheEnabled.Load() {
    if p, ok := s.cache.Get(id); ok {
        return p, nil
    }
}
p, err := s.catalog.GetProduct(ctx, id)
// ...
if s.cacheEnabled.Load() {
    s.cache.Set(id, p)
}
```

This lets you turn the cache off without a redeploy if it misbehaves.

### Step F — Measure again

After 24 hours with the cache enabled at, say, 1% of traffic, compare metrics:

- p50 latency: did it drop?
- p99 latency: did it drop?
- Hit rate: how high?
- Memory usage: did it grow as expected?

Promote to 10%, then 50%, then 100% if the numbers stay good.

### Step G — Document

```go
// GetProduct returns the product with the given id.
//
// Results are cached in-process for the lifetime of the pod. The cache holds
// up to 8192 products; the least recently used is evicted on overflow.
// The cache is eventually consistent with the catalog service; callers that
// require fresh data must bypass this method.
func (s *Service) GetProduct(ctx context.Context, id string) (*Product, error) { /* ... */ }
```

The doc comment is the *contract*. Future readers must know the staleness window.

## Reading the library source for real

Look at `hashicorp/golang-lru/v2` directly:

```bash
git clone https://github.com/hashicorp/golang-lru
cd golang-lru
ls
```

Three packages worth reading, in order:

1. **`simplelru/`** — the unsafe core. ~200 lines. Walk through `lru.go` top to bottom.
2. **`lru.go`** at the repo root — the safe wrapper. ~250 lines. See how it locks.
3. **`expirable/`** — TTL variant. ~300 lines. Notice how it adds expiration without changing the LRU mechanics.

Reading the source is the single best investment you can make. Two hours of reading saves you weeks of pain when you eventually have to reason about a production incident involving the cache.

A few annotation hints to guide your reading:

- The `EvictCallback` type is `func(key K, value V)` — confirm that the callback signature matches your assumption.
- Look at `removeOldest` — see that it calls `removeElement`, which calls `c.onEvict` *after* both list and map are updated.
- Look at `Resize` — note that shrinking calls `removeOldest` repeatedly until the size fits. Each call fires the callback.
- Look at `Purge` — note that it iterates the items map calling the callback once per entry, then clears both structures.
- Look at `Keys` — note that it walks the list back-to-front (or front-to-back depending on the version), returning a fresh slice.

If you understand all five of those, you understand the library.

## Side notes on cache invalidation

> "There are only two hard things in computer science: cache invalidation and naming things." — Phil Karlton

For a junior-level cache, invalidation comes from one of three sources:

1. **Eviction.** The cache itself drops entries on capacity overflow. No code needed.
2. **TTL.** The wrapper checks `expireAt` on every read. Stale entries are dropped on access.
3. **Explicit invalidation.** Your code calls `cache.Remove(id)` after a known mutation.

Pick one based on the freshness contract.

**Pure LRU (eviction only).** Acceptable when stale-by-an-hour is fine. Examples: product catalog, user profile metadata.

**LRU with TTL.** Acceptable when stale-by-a-minute is fine. Examples: feature flag evaluations, session lookups.

**LRU with explicit invalidation.** Required when changes must be seen *now*. Examples: post-edit, post-delete, post-payment.

The last is the hardest. In a multi-pod deployment, an explicit `Remove` only invalidates the local pod's cache. The other pods still have the stale entry until *their* TTLs expire. The standard solution is a *cache-invalidation channel* (Redis pub/sub, NATS, Kafka topic) that broadcasts "key K changed" so every pod can Remove. Implementing it well is a senior-level topic. For junior-level code, prefer TTL-based freshness unless the latency requirements demand more.

## What a "first cache" code review usually catches

If you submit a cache PR, the reviewer will probably comment on at least one of:

- "Where is the eviction metric?"
- "What is the staleness contract?"
- "Why this capacity number specifically?"
- "Have you run `-race`?"
- "What happens if `loader` returns `nil, nil`?"
- "Is this cache shared across requests, or per-request?"
- "Where is the test for concurrent access?"
- "Can the cache be disabled at runtime?"
- "How will operators tune capacity?"
- "What is the worst-case memory use?"

If you anticipate all ten in the initial PR, you ship faster. The discipline of "reviewer-proofing" your PR before opening it is most of the difference between a 1-hour merge and a 1-week merge.

## Compatibility and version notes

Some real-world things that bite you:

- **v1 vs v2.** The v1 line (`hashicorp/golang-lru`) is pre-generics; values are `interface{}` and you assert on Get. The v2 line uses generics. All new code should use v2.
- **Go version.** v2 requires Go 1.18+. Code that supports older Go must stay on v1.
- **`Add` return type.** v1's `Add` returns `bool` (whether eviction happened). v2 same. Some forks change this.
- **`Cache` vs `TwoQueueCache` vs `ARCCache`.** Different types, different constructors. Choose deliberately.
- **`expirable.NewLRU` vs `lru.New`.** Different types. You cannot trivially swap them; the API surfaces are similar but not identical (`expirable.LRU` exposes `AddEx` with explicit TTL).

When pinning a version in `go.mod`, prefer a minor-version constraint (`v2.0.x`) over `latest` to avoid surprise behaviour changes.

## Memory and GC notes

A `hashicorp/golang-lru/v2.Cache[K, V]` of capacity N holds:

- The cache struct itself (tiny).
- An `RWMutex` (24 bytes on amd64).
- A `simplelru.LRU` (a few hundred bytes).
- A `map[K]*list.Element` with capacity N (~16 bytes per entry plus the hash table overhead, ~10–30 MB for N=1M).
- A `list.List` with N elements; each element is ~64 bytes (`next`, `prev`, `list`, `Value`).
- An `entry[K, V]` per element with your key and value.

Rough total for `lru.New[string, *User](1_000_000)` where strings average 32 bytes and `*User` is a pointer:

- Map: ~32 MB (entries, buckets, overhead).
- List elements: ~64 MB.
- Entries: ~40 MB (key + value pointer).
- Total: ~136 MB *just for the cache structure*, before counting `*User` payloads.

The lesson: do not casually set capacity to 1 000 000. Profile first. If your cache lives across many pods with high replica counts, 100 MB per pod is 10 GB across a fleet of 100 pods.

GC behaviour:

- Every `Add` allocates one `entry` and one `list.Element`.
- Every eviction frees them.
- A million Adds per second is two million small allocations per second — measurable GC pressure.

Mitigations (covered at senior level):

- **`sync.Pool` for `list.Element`** — reuses the node memory.
- **Off-heap byte caches** — for very large caches, store values in a single byte arena.
- **Bigcache / freecache** — third-party caches that store values off-heap to bypass GC scans.

For a junior-level cache (capacity < 100K, ops < 100K/sec) none of this matters. Start simple.

## Build vs use: when to write your own LRU

Almost never. The reasons people *think* they should write their own are usually:

- **"It looks easy."** It is — but the *easy* part is 95% of the work. The remaining 5% is concurrency edge cases, generics, eviction-callback semantics, and exhaustive tests. The library has them.
- **"I want fewer dependencies."** `hashicorp/golang-lru/v2` is one of the most stable, well-maintained dependencies in the Go ecosystem. Vendoring it costs less than maintaining your own.
- **"I need a feature the library lacks."** Often the feature is one wrapper away. The library exposes enough primitives.

The reasons people *should* write their own are:

- **You need a different algorithm entirely** (S3-FIFO, custom admission). Even then, look for an existing library first.
- **You are learning.** Build it once, with tests, and you have permanent intuition.
- **You have an extreme constraint** (zero allocations per op, special key type, embedded environment). Even then, prove it via benchmark first.

In a normal production codebase, your LRU code is `cache, _ := lru.New[K, V](N)` and a wrapper. That is the whole engineering deliverable.

## Mini-exercises

These are short drills, not full tasks (full tasks live in `tasks.md`). They take 5-15 minutes each.

### Drill 1 — Predict the eviction

Given `capacity = 3` and the call sequence `Add a, Add b, Add c, Get a, Add d`, what is the LRU end after the last call? Answer below.

### Drill 2 — Spot the bug

```go
func (c *LRU[K, V]) Add(k K, v V) {
    c.mu.Lock()
    c.items[k] = c.order.PushFront(&entry[K, V]{k, v})
    if c.order.Len() > c.capacity {
        back := c.order.Back()
        c.order.Remove(back)
    }
    c.mu.Unlock()
}
```

What is wrong? Answer below.

### Drill 3 — Why does the race detector pass?

```go
var m sync.Mutex
v := 0
go func() { m.Lock(); v++; m.Unlock() }()
go func() { m.Lock(); v++; m.Unlock() }()
```

The race detector reports nothing even though two goroutines write `v`. Why? Answer below.

### Drill 4 — `Peek` vs `Get`

In the wrapper-around-`golang-lru` from Example 8, would replacing `Get` with `Peek` change the hit-rate metric? Why or why not? Answer below.

### Drill 5 — Capacity tuning

Your cache reports `evictions/min = 50_000` and `size = 1024` (at capacity) on a `25_000 ops/s` workload. Is the cache too small, too big, or just right? Answer below.

### Answers

1. **Drill 1.** List after each op: `[a]`, `[b,a]`, `[c,b,a]`, `[a,c,b]`, `[d,a,c,b]` — wait, that is len 4 > capacity 3, so `b` evicts. Final list: `[d,a,c]`. LRU end = `c`.
2. **Drill 2.** The map entry for the evicted key is never deleted. Add a `delete(c.items, evictedKey)` after `Remove`. (You also need to extract the key from the back element's value before deleting.)
3. **Drill 3.** Because `sync.Mutex` provides happens-before ordering between unlocking and the next locking. The two `v++` calls are correctly serialised; there is no race.
4. **Drill 4.** Yes — `Peek` would not promote, so the LRU end would drift away from the actually hot keys. Within a few thousand ops the hit-rate would drop noticeably.
5. **Drill 5.** Too small. Eviction rate exceeds operation rate by 2x, meaning every insertion evicts and many existing keys are also being kicked out. Working set is larger than 1024. Try 8192 and re-measure.

## Self-Assessment Checklist

- [ ] I can draw the doubly-linked list plus map and label the MRU and LRU ends.
- [ ] I can state the LRU invariant in one sentence.
- [ ] I can write a single-goroutine LRU from scratch in ~80 lines.
- [ ] I can wrap it with a `sync.Mutex` and explain why an `RWMutex` would be wrong.
- [ ] I can use `hashicorp/golang-lru/v2` in five lines, including capacity validation.
- [ ] I know the difference between `Get` and `Peek`.
- [ ] I know that eviction callbacks run under the lock.
- [ ] I can name three bugs that turn an LRU into a memory leak.

---

## Summary

A concurrent LRU cache is a hash map plus a doubly-linked list, both protected by a mutex. The map gives O(1) lookup; the list gives O(1) recency updates. Every operation updates both views; otherwise the invariant breaks. A single `sync.Mutex` makes it correct under any number of goroutines, and that is the right starting point. For real projects, reach for `hashicorp/golang-lru/v2`. The most common bugs are forgetting to delete the map entry on eviction, using an `RWMutex` because `Get` "feels like a read," and writing an eviction callback that calls back into the cache.

The middle file shows how to scale beyond a single mutex with sharding, how `golang-lru` handles edge cases internally, and when an RWMutex variant *can* help (the `Peek`-heavy case).

---

## What You Can Build

With what you know now, you can confidently build:

- A user-profile cache for an HTTP service.
- A compiled-regex cache for a log processor.
- A `singleflight`-free version of `getOrLoad` for idempotent loaders.
- A 50-line eviction-callback-driven file-handle pool.
- A debugging dump endpoint that uses `Peek` and `Keys` to inspect cache state without perturbing recency.

---

## The wider picture: caching in a Go service architecture

It is tempting to think of an LRU as a small thing in one file. In production it is usually one node in a larger caching strategy. Drawing the full picture once helps you reason about where the LRU fits and where it doesn't.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                            Client                                       │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│ CDN (cache headers, edge cache)            ← caches public, immutable  │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Reverse proxy / API gateway (response cache)                           │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Go service                                                             │
│  ┌──────────────────────┐                                              │
│  │ In-process LRU       │  ← THIS FILE                                 │
│  │ - lookup-tier        │     sub-microsecond, per-pod                 │
│  └──────────┬───────────┘                                              │
│             │ miss                                                     │
│             ▼                                                          │
│  ┌──────────────────────┐                                              │
│  │ Redis cluster        │  ← shared across pods, ~1 ms                 │
│  └──────────┬───────────┘                                              │
│             │ miss                                                     │
│             ▼                                                          │
│  ┌──────────────────────┐                                              │
│  │ Database             │  ← source of truth, ~10 ms                   │
│  └──────────────────────┘                                              │
└────────────────────────────────────────────────────────────────────────┘
```

Each layer has its own eviction policy, sharing rules, and consistency contract:

- **CDN.** Cached by URL plus headers. Invalidated by tags. Hit rate >95% for static assets.
- **Reverse proxy.** May cache anonymous GETs. Shared per pod.
- **In-process LRU.** Per pod. Lowest latency. Smallest capacity. Most aggressive eviction. Bounded by RAM.
- **Redis.** Shared across pods. Larger capacity. Network round-trip. Coherent for the cluster.
- **Database.** Source of truth.

The in-process LRU is the only layer in this stack that *does not need a network call*. That is its sole advantage and the reason every Go service of meaningful size has one.

### Why both in-process and Redis?

Two reasons.

1. **Latency.** A Redis call is on the order of a millisecond on the same network. An in-process LRU lookup is hundreds of nanoseconds. A 10000x difference matters under load.
2. **Insulation from Redis blips.** When Redis is slow or unreachable, the in-process LRU is the difference between "degraded performance" and "complete outage."

The trade-off is consistency. If a value is updated in the database and Redis is invalidated, the in-process LRUs across N pods are stale for up to the TTL. For most read-mostly workloads (profiles, configs, catalogs), that is acceptable. For balance-of-money or feature-flag-just-flipped workloads, it is not — in those cases, skip the in-process LRU or use a short TTL.

### The two failure modes you need to plan for

Caches can fail in two ways that hurt you, and they are opposite to each other.

1. **Cache stampede.** A hot key expires; thousands of concurrent requests all miss and hit the database simultaneously. Solution: `singleflight`, jittered TTLs, soft-TTL + serve-stale-while-revalidating.
2. **Cache poisoning.** A burst of unique keys evicts the hot set; hit-rate collapses for hours. Solution: TinyLFU-style admission filters, separate caches for trusted vs untrusted key spaces.

A junior engineer does not need to solve these on day one but should know they exist. Both are covered in detail at the senior and professional levels.

## A glossary of "almost LRU" policies (so you know the words)

You will hear these names in discussions. You do not need to implement them yet — that is senior and professional territory — but knowing the words means understanding when someone is proposing a different algorithm.

- **FIFO** — First In, First Out. Evicts the oldest *inserted*, not the oldest *used*. Simpler than LRU; usually worse hit-rate, sometimes comparable for write-heavy patterns.
- **MRU** — Most Recently Used. Evicts the most recent. Useful in a few exotic streaming workloads where the most recent is the *least* likely to be needed again. Rare.
- **LFU** — Least Frequently Used. Tracks an access count per key and evicts the lowest. Better than LRU when popularity matters more than recency, but vulnerable to "stale popularity" (a once-popular key that lingers forever).
- **2Q** — Two Queue. Keeps a "recent" queue and a "frequent" queue. A miss enters recent; a second hit while in recent promotes to frequent. Scan-resistant.
- **ARC** — Adaptive Replacement Cache. Self-tunes the balance between recency and frequency. The de facto policy when you want one knob and let the algorithm sort it out. IBM-patented; the Hashicorp ARC variant works around the patent.
- **SLRU** — Segmented LRU. Splits the cache into protected and probationary segments. A miss enters probation; a hit while in probation promotes to protected.
- **TinyLFU** — A small-memory frequency sketch (Count-Min Sketch) that decides which candidates *deserve* a cache slot. Pairs with an LRU eviction policy.
- **W-TinyLFU** — Windowed TinyLFU. Adds a small LRU "window" in front of TinyLFU so brand-new keys can prove themselves before competing on frequency. Used by ristretto and Caffeine (Java).
- **S3-FIFO** — A 2023 algorithm (from the FAST'24 paper). Three FIFO queues (small, main, ghost). Beats LRU on most workloads with simpler code. Lock-friendly because FIFO ops are append-only.

You will meet ristretto (W-TinyLFU) and S3-FIFO in the senior and professional files. For now, recognise that "LRU" is one specific policy among many — chosen because it is simple, fast, and good-enough for most workloads.

## FAQ (frequently confused points)

**Q: Why is `Get` a write? Conceptually I am just reading.**
A: Because the cache moves the entry to the front of the recency list. The map lookup is read-only, but the list mutation is not. From the cache's *implementation* standpoint, `Get` writes.

**Q: Could I make `Get` truly read-only by skipping `MoveToFront`?**
A: That is what `Peek` does. The price is that the recency information drifts; the cache no longer behaves like an LRU.

**Q: I see `sync.Map` in the standard library. Why not use it?**
A: `sync.Map` is an unbounded concurrent map. It has no eviction. As a long-running cache it leaks memory. Use it for "read-mostly, write-once" maps with a small, fixed set of keys (like a cache of compiled types). For a bounded LRU, use `hashicorp/golang-lru/v2`.

**Q: My cache is slow. Should I shard?**
A: First profile. If the mutex profile shows >20% wait time, yes — sharding is the next step (middle file). If contention is low, sharding will not help; look at allocator pressure or hash cost.

**Q: How big should `capacity` be?**
A: Start at "size of working set, multiplied by 1.2". If you do not know the working set, start at 1024 and grow until evictions/sec falls below 1% of ops/sec.

**Q: Should I cache `nil`?**
A: If your loader can return "not found" cheaply, do not bother. If it is expensive (a DB query that returns no row), cache a sentinel with a short TTL so a repeated query does not hammer the DB.

**Q: Is the cache eventually consistent with the database?**
A: Yes, at best. If your data has changed and you cached the old value, the cache will serve stale until the entry is evicted or invalidated. Plan for this.

**Q: Can I use the cache from a `database/sql` callback?**
A: Yes, but be careful — the SQL driver may hold a connection while you call into the cache. If the cache lock is contended, you stall the connection. Keep critical sections short.

**Q: Does `Resize(0)` panic?**
A: With `hashicorp/golang-lru/v2`, `New(0)` returns an error and `Resize(0)` is a no-op (you cannot make a cache hold zero items dynamically by calling `Resize`). Check the docs of your version.

**Q: How do I unit-test the cache?**
A: Three tests: (1) basic Set/Get correctness, (2) eviction order under a known sequence, (3) concurrent Set/Get under `-race`. See the Test section above.

**Q: Should I instrument cache calls with OpenTelemetry spans?**
A: Cache calls are sub-microsecond. A span is microseconds-to-milliseconds. Spans will dominate the operation. Use counter metrics (hit/miss/eviction), not spans.

**Q: Will the GC ever scan the cache?**
A: Yes — the cache and all its values are reachable from your roots, so the GC scans them on each cycle. For pointer-heavy cached values, this can be expensive. See `optimize.md` for mitigations.

**Q: Can two LRUs share the same underlying linked list?**
A: No. Each LRU owns its list. Two views of one list is a different data structure (and a much harder concurrency problem).

**Q: How do I migrate from `hashicorp/golang-lru` v1 to v2?**
A: v2 adds generics. Replace `lru.New(128)` with `lru.New[K, V](128)`. The method names are unchanged. Type assertions on returned values disappear.

## Further Reading

- `pkg.go.dev/container/list` — the standard-library doubly-linked list (whole package is ~150 lines).
- `pkg.go.dev/sync#Mutex` — the mutex you are using.
- `github.com/hashicorp/golang-lru/v2` — the library; read `simplelru/lru.go` for a small, well-commented reference implementation.
- "Cache replacement policies" — Wikipedia article on LRU, LFU, MRU, 2Q, ARC, S3-FIFO.
- *The Art of Multiprocessor Programming*, Herlihy and Shavit, chapter on linked lists and locking. (Java examples, but the lock-coupling patterns translate to Go.)

---

## Related Topics

- [Goroutines overview](../../01-goroutines/01-overview/) — concurrency basics.
- [Mutexes and RWMutexes](../../03-sync-primitives/) — the locks you are using.
- [`sync.Map`](../../04-sync-map/) — Go's built-in concurrent map (no eviction).
- [TTL caches](../01-ttl-caches/) — the eviction policy that uses time instead of recency.
- [Concurrent skip list](../03-concurrent-skip-list/) — another concurrent data structure with different trade-offs.

## A short retrospective on what changed in your head

Before reading this file you probably thought of a cache as a fast key-value store with some kind of automatic cleanup. After reading it:

- You know that "LRU" is one specific eviction rule among many — recency-based.
- You know that the implementation is a *cooperation* between a map and a doubly-linked list, with a strict invariant.
- You know that `Get` is a *write* in disguise, which is why a naive `RWMutex` does not help.
- You know that a single `sync.Mutex` is correct, simple, and works well up to a few hundred thousand operations per second.
- You know the standard library option (`container/list`), the standard third-party option (`hashicorp/golang-lru/v2`), and at least the *name* of more sophisticated options (ristretto, S3-FIFO).
- You know the classes of failure: cache stampede, cache poisoning, mutex contention, scan-eviction.
- You know how to instrument the cache so you have numbers to make decisions with.
- You can build one from scratch in about 80 lines of Go, with tests, in 20 minutes.

That is the junior-level mental model. The middle file picks up at sharding, RWMutex variants, and the practical use of `hashicorp/golang-lru/v2` in real services. The senior file moves to lock-free reads, BP-Wrapper, ristretto internals, and S3-FIFO. The professional file goes into TinyLFU sketches, NUMA-aware sharding, GC pressure, and formal hit-rate analysis.

A final reminder: a cache is a *speedup*, not a source of truth. Build it accordingly. Test it under contention. Measure it in production. And when it disappoints you, the answer is rarely "implement my own from scratch" — it is "pick the right algorithm, tune the capacity, or change the access pattern."

---

## Build it yourself: a six-step tutorial

The fastest way to internalise an LRU is to build one. The library has it covered for production, but for learning there is no substitute for hand-writing the type, the methods, and the tests.

### Step 1 — The empty type

Create `lru.go` in a new package:

```go
package mylru

import (
    "container/list"
    "sync"
)

type LRU[K comparable, V any] struct {
    mu       sync.Mutex
    capacity int
    items    map[K]*list.Element
    order    *list.List
}
```

That is the entire vocabulary you need. Four fields, two from the standard library.

### Step 2 — The constructor

```go
func New[K comparable, V any](capacity int) *LRU[K, V] {
    if capacity <= 0 {
        panic("mylru: capacity must be positive")
    }
    return &LRU[K, V]{
        capacity: capacity,
        items:    make(map[K]*list.Element, capacity),
        order:    list.New(),
    }
}
```

Preallocating the map avoids reallocations as it fills. The list does not need preallocation; nodes are allocated one at a time.

### Step 3 — `Get`

```go
type entry[K comparable, V any] struct {
    key K
    val V
}

func (c *LRU[K, V]) Get(k K) (V, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    e, ok := c.items[k]
    if !ok {
        var zero V
        return zero, false
    }
    c.order.MoveToFront(e)
    return e.Value.(*entry[K, V]).val, true
}
```

Three thoughts in three lines: look up, move, return. The cast to `*entry[K, V]` is safe because we control what goes into `e.Value`.

### Step 4 — `Set`

```go
func (c *LRU[K, V]) Set(k K, v V) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if e, ok := c.items[k]; ok {
        c.order.MoveToFront(e)
        e.Value.(*entry[K, V]).val = v
        return
    }
    if c.order.Len() >= c.capacity {
        back := c.order.Back()
        if back != nil {
            kv := c.order.Remove(back).(*entry[K, V])
            delete(c.items, kv.key)
        }
    }
    ent := &entry[K, V]{key: k, val: v}
    c.items[k] = c.order.PushFront(ent)
}
```

Three branches: (1) update existing, (2) evict if full, (3) push new. Eviction must extract the key from the removed element so we can delete the map entry — this is the spot every implementer forgets first.

### Step 5 — `Remove`, `Len`, `Purge`

```go
func (c *LRU[K, V]) Remove(k K) bool {
    c.mu.Lock()
    defer c.mu.Unlock()
    e, ok := c.items[k]
    if !ok {
        return false
    }
    c.order.Remove(e)
    delete(c.items, k)
    return true
}

func (c *LRU[K, V]) Len() int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.order.Len()
}

func (c *LRU[K, V]) Purge() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.items = make(map[K]*list.Element, c.capacity)
    c.order = list.New()
}
```

`Purge` just throws away both views and starts fresh. The old map and list become garbage on the next GC.

### Step 6 — Tests, including under `-race`

```go
package mylru_test

import (
    "fmt"
    "sync"
    "testing"

    "example.com/mylru"
)

func TestBasic(t *testing.T) {
    c := mylru.New[string, int](2)
    c.Set("a", 1)
    c.Set("b", 2)
    if v, ok := c.Get("a"); !ok || v != 1 {
        t.Fatalf("a: got %v, %v", v, ok)
    }
    c.Set("c", 3) // evicts b (a was just touched)
    if _, ok := c.Get("b"); ok {
        t.Fatal("b should be evicted")
    }
    if c.Len() != 2 {
        t.Fatalf("len=%d", c.Len())
    }
}

func TestParallel(t *testing.T) {
    c := mylru.New[int, int](100)
    var wg sync.WaitGroup
    for w := 0; w < 16; w++ {
        wg.Add(1)
        go func(off int) {
            defer wg.Done()
            for i := 0; i < 20_000; i++ {
                k := (off + i) % 200
                c.Set(k, i)
                _, _ = c.Get(k)
            }
        }(w * 1000)
    }
    wg.Wait()
    if c.Len() > 100 {
        t.Fatalf("len exceeds capacity: %d", c.Len())
    }
    fmt.Println("final len:", c.Len())
}
```

Run both with `go test -race ./...`. If the parallel test prints a length within `[1, 100]` and the race detector is silent, your LRU is correct.

The whole thing is fewer than 100 lines. The library version adds: eviction callbacks, multiple variants (2Q, ARC), more conservative locking choices, better naming, and exhaustive tests. Functionally, the core is what you just built.

## Three full examples in different contexts

The same cache type plugs into very different parts of a typical Go service. Here are three short, complete patterns to keep in your head.

### Context A — HTTP middleware for auth tokens

A JWT-to-user mapping is expensive to recompute on every request because it involves signature verification and a database lookup. Caching it for 30 seconds shaves milliseconds off every authenticated request.

```go
package authcache

import (
    "context"
    "errors"
    "time"

    lru "github.com/hashicorp/golang-lru/v2"
    "golang.org/x/sync/singleflight"
)

type Verifier interface {
    Verify(ctx context.Context, token string) (userID string, err error)
}

type entry struct {
    userID    string
    expireAt  time.Time
}

type Cache struct {
    inner    *lru.Cache[string, entry]
    verifier Verifier
    sf       singleflight.Group
    ttl      time.Duration
}

func New(capacity int, ttl time.Duration, v Verifier) (*Cache, error) {
    inner, err := lru.New[string, entry](capacity)
    if err != nil {
        return nil, err
    }
    return &Cache{inner: inner, verifier: v, ttl: ttl}, nil
}

func (c *Cache) Resolve(ctx context.Context, token string) (string, error) {
    if e, ok := c.inner.Get(token); ok && time.Now().Before(e.expireAt) {
        return e.userID, nil
    }
    v, err, _ := c.sf.Do(token, func() (interface{}, error) {
        uid, err := c.verifier.Verify(ctx, token)
        if err != nil {
            return "", err
        }
        c.inner.Add(token, entry{userID: uid, expireAt: time.Now().Add(c.ttl)})
        return uid, nil
    })
    if err != nil {
        return "", err
    }
    s, ok := v.(string)
    if !ok {
        return "", errors.New("unexpected singleflight result")
    }
    return s, nil
}
```

What this gives you:

- **Sub-microsecond cache hits.**
- **Single in-flight verification per token.** A thundering herd that hits the same token simultaneously does one Verify, not N.
- **TTL bound** so a revoked token does not linger forever (still, a more aggressive revocation channel is needed for security-critical operations).

### Context B — In-memory result cache for an idempotent transform

You have a pure function `transform(input []byte) []byte` that is CPU-bound (e.g., a regex pipeline, a JSON normaliser). Many callers ask for the same inputs.

```go
package transformcache

import (
    "crypto/sha256"
    "encoding/hex"

    lru "github.com/hashicorp/golang-lru/v2"
)

type Cache struct {
    inner *lru.Cache[string, []byte]
}

func New(capacity int) (*Cache, error) {
    c, err := lru.New[string, []byte](capacity)
    if err != nil {
        return nil, err
    }
    return &Cache{inner: c}, nil
}

func (c *Cache) Apply(input []byte, transform func([]byte) []byte) []byte {
    sum := sha256.Sum256(input)
    key := hex.EncodeToString(sum[:])
    if v, ok := c.inner.Get(key); ok {
        return v
    }
    out := transform(input)
    c.inner.Add(key, out)
    return out
}
```

What this gives you:

- **Content-addressed caching.** The hash is deterministic; identical inputs share a result.
- **Bounded memory** by capacity.

The drawback is that the hash is computed on every call (even on hits) — a few microseconds per MB on modern hardware, often acceptable. If `input` is large and frequent, hash once and re-use the key.

### Context C — Bounded handle pool for HTTP clients

Each downstream host needs its own `*http.Client` so connection pooling works per-host. You do not know upfront how many hosts you will see. An LRU with eviction-callback closes the least-used client when capacity is reached.

```go
package httpclientpool

import (
    "net/http"
    "time"

    lru "github.com/hashicorp/golang-lru/v2"
)

type Pool struct {
    inner *lru.Cache[string, *http.Client]
}

func New(capacity int) (*Pool, error) {
    inner, err := lru.NewWithEvict[string, *http.Client](
        capacity,
        func(_ string, c *http.Client) {
            // close idle connections so the GC can reclaim sockets
            if tr, ok := c.Transport.(*http.Transport); ok {
                tr.CloseIdleConnections()
            }
        },
    )
    if err != nil {
        return nil, err
    }
    return &Pool{inner: inner}, nil
}

func (p *Pool) For(host string) *http.Client {
    if c, ok := p.inner.Get(host); ok {
        return c
    }
    c := &http.Client{
        Timeout: 5 * time.Second,
        Transport: &http.Transport{
            MaxIdleConnsPerHost: 16,
        },
    }
    p.inner.Add(host, c)
    return c
}
```

What this gives you:

- **Per-host connection pooling.**
- **Bounded file-descriptor use** because old clients close their idle connections on eviction.

The race between two goroutines both creating a client for the same new host is benign — one will be stored, the other will be garbage-collected within the next GC cycle. If you need strict deduplication, wire `singleflight`.

## Walk-through: building it in your head

Imagine you have a cache with capacity 4 and these calls in order:

```
Set("a",1) Set("b",2) Set("c",3) Set("d",4) Get("b") Set("e",5) Get("a") Set("f",6)
```

Step by step:

1. `Set("a",1)` — list `[a]`, map `{a}`.
2. `Set("b",2)` — list `[b,a]`, map `{a,b}`.
3. `Set("c",3)` — list `[c,b,a]`, map `{a,b,c}`.
4. `Set("d",4)` — list `[d,c,b,a]`, map `{a,b,c,d}`. Full.
5. `Get("b")` — list `[b,d,c,a]`, map unchanged. `b` is now MRU.
6. `Set("e",5)` — full, evict back = `a`. List `[e,b,d,c]`, map `{b,c,d,e}`.
7. `Get("a")` — miss. Map unchanged.
8. `Set("f",6)` — full, evict back = `c`. List `[f,e,b,d]`, map `{b,d,e,f}`.

If you can walk through that on paper without losing the invariant, you understand the data structure. The mutex changes nothing about the per-step state — only the property that no two steps overlap.

## Putting it together: a complete example

Below is a small, complete program that combines everything in this file: a concurrent LRU built on `hashicorp/golang-lru/v2`, a loader function, eviction metrics, and a workload that exercises it from multiple goroutines.

```go
package main

import (
    "fmt"
    "log"
    "math/rand"
    "sync"
    "sync/atomic"
    "time"

    lru "github.com/hashicorp/golang-lru/v2"
)

// User is the value we cache.
type User struct {
    ID   int
    Name string
}

// loadUser pretends to fetch a user from a slow source.
func loadUser(id int) (*User, error) {
    time.Sleep(2 * time.Millisecond) // simulate I/O
    return &User{ID: id, Name: fmt.Sprintf("user-%d", id)}, nil
}

func main() {
    var evicted atomic.Uint64
    cache, err := lru.NewWithEvict[int, *User](1024, func(_ int, _ *User) {
        evicted.Add(1)
    })
    if err != nil {
        log.Fatal(err)
    }

    var hits, miss atomic.Uint64
    var wg sync.WaitGroup
    const workers = 16
    const opsPerWorker = 50_000

    start := time.Now()
    for w := 0; w < workers; w++ {
        wg.Add(1)
        go func(seed int) {
            defer wg.Done()
            r := rand.New(rand.NewSource(int64(seed)))
            for i := 0; i < opsPerWorker; i++ {
                id := r.Intn(5000) // 5x cache capacity → some misses
                if _, ok := cache.Get(id); ok {
                    hits.Add(1)
                } else {
                    miss.Add(1)
                    u, err := loadUser(id)
                    if err == nil {
                        cache.Add(id, u)
                    }
                }
            }
        }(w)
    }
    wg.Wait()
    dur := time.Since(start)

    total := hits.Load() + miss.Load()
    fmt.Printf("ops=%d in %v (%.0f ops/s)\n", total, dur, float64(total)/dur.Seconds())
    fmt.Printf("hits=%d misses=%d hit-rate=%.1f%%\n",
        hits.Load(), miss.Load(),
        100*float64(hits.Load())/float64(total))
    fmt.Printf("evictions=%d cache-size=%d\n", evicted.Load(), cache.Len())
}
```

Run it (`go mod init demo && go get github.com/hashicorp/golang-lru/v2 && go run .`) and you will see numbers like:

```
ops=800000 in 312ms (2564102 ops/s)
hits=632147 misses=167853 hit-rate=79.0%
evictions=166829 cache-size=1024
```

Hit-rate around 80% with capacity 1024 against a 5000-key universe is the textbook LRU outcome. Increase the cache size; the hit-rate climbs. Increase the key universe; the hit-rate falls. Both behaviours are expected.

This same skeleton — concurrent workers, cache fronting a loader, metrics — is what 90% of production Go code looks like when an LRU is involved.

## Common workloads in numbers

To give you a feel for what an LRU is *for*, here are the kinds of workloads where one earns its keep:

| Workload | Capacity | Typical hit rate | Reason |
|----------|----------|------------------|--------|
| User profile cache (~10 K active users) | 16 384 | 90–99% | Strong temporal locality |
| Feature-flag evaluation | 65 536 | 99%+ | Same flag/user pairs queried over and over |
| URL parser cache | 4 096 | 80–95% | Top URLs dominate traffic |
| Compiled regex cache | 256 | 99%+ | Tiny fixed set |
| Image thumbnail cache | 1 024 | 70–90% | Pareto distribution of popularity |
| Translation memory | 8 192 | 60–80% | Some repetition, but long tail |

A workload with sub-50% hit rate often is *not* the right fit for LRU — consider whether the cache is helping at all, or whether a smarter policy (LFU, W-TinyLFU) would do better. Numbers are illustrative; always measure in your own workload.

## How `hashicorp/golang-lru/v2` works internally (a guided tour)

You will use this library in dozens of projects. It pays to know what it is doing under the hood. The package is small — about 700 lines of Go split across a few files. Here is the abridged tour.

### `simplelru/lru.go` — the unsafe core

The library separates the *unsafe-for-concurrent-use* core (`simplelru.LRU`) from the *safe-for-concurrent-use wrapper* (`lru.Cache`). The core is essentially the textbook code you saw in Examples 1 and 2 above, without the mutex:

```go
// abridged
type LRU[K comparable, V any] struct {
    size      int
    evictList *list.List
    items     map[K]*list.Element
    onEvict   EvictCallback[K, V]
}

type entry[K comparable, V any] struct {
    key   K
    value V
}

func (c *LRU[K, V]) Add(key K, value V) (evicted bool) {
    if ent, ok := c.items[key]; ok {
        c.evictList.MoveToFront(ent)
        ent.Value.(*entry[K, V]).value = value
        return false
    }
    ent := &entry[K, V]{key, value}
    entry := c.evictList.PushFront(ent)
    c.items[key] = entry
    evict := c.evictList.Len() > c.size
    if evict {
        c.removeOldest()
    }
    return evict
}

func (c *LRU[K, V]) Get(key K) (value V, ok bool) {
    if ent, ok := c.items[key]; ok {
        c.evictList.MoveToFront(ent)
        return ent.Value.(*entry[K, V]).value, true
    }
    return
}

func (c *LRU[K, V]) removeOldest() {
    ent := c.evictList.Back()
    if ent != nil {
        c.removeElement(ent)
    }
}

func (c *LRU[K, V]) removeElement(e *list.Element) {
    c.evictList.Remove(e)
    kv := e.Value.(*entry[K, V])
    delete(c.items, kv.key)
    if c.onEvict != nil {
        c.onEvict(kv.key, kv.value)
    }
}
```

Two differences from the textbook:

1. The check `c.evictList.Len() > c.size` happens *after* the push. The library prefers to push-first-evict-second. It is equivalent to the check-first-evict-then-push version in the textbook because no other operation can run between them (the wrapper holds the lock).
2. `onEvict` is called *after* both the list and the map are updated. By that point the invariant is restored, so an `onEvict` that re-reads the cache (which would still deadlock because of the lock) at least sees a consistent state.

### `lru.go` — the safe wrapper

```go
// abridged
type Cache[K comparable, V any] struct {
    lru  *simplelru.LRU[K, V]
    lock sync.RWMutex
}

func (c *Cache[K, V]) Add(key K, value V) (evicted bool) {
    c.lock.Lock()
    evicted = c.lru.Add(key, value)
    c.lock.Unlock()
    return
}

func (c *Cache[K, V]) Get(key K) (value V, ok bool) {
    c.lock.Lock()  // NOTE: Lock, not RLock!
    value, ok = c.lru.Get(key)
    c.lock.Unlock()
    return
}

func (c *Cache[K, V]) Peek(key K) (value V, ok bool) {
    c.lock.RLock()  // NOTE: RLock, because Peek does not promote
    value, ok = c.lru.Peek(key)
    c.lock.RUnlock()
    return
}
```

Look at `Get` and `Peek` side by side. The library uses an `RWMutex` but takes the *write* lock in `Get` because `Get` calls `MoveToFront`. `Peek` is the only operation that can use the read lock. This confirms the rule from the Common Mistakes section: an RWMutex does not buy you parallel Gets in a plain LRU.

### What the library does *not* give you

- **No TTL.** Use the `expirable` subpackage (`expirable.NewLRU`) or wrap your value with a timestamp.
- **No sharding.** A single `lru.Cache` is one mutex. For sharded behaviour you build it yourself, or use `dgraph-io/ristretto`.
- **No persistence.** The cache is in-memory only. Restart = wipe.
- **No frequency tracking.** Pure LRU. If your workload has frequency-skew, ristretto's TinyLFU will outperform.
- **No async loader.** No `LoadingCache` à la Guava. Wire `singleflight` yourself as in Example 11.

### Variants in the same library

`hashicorp/golang-lru/v2` ships several variants:

- `lru.New` — the plain LRU you have seen.
- `lru.NewWithEvict` — same with a callback.
- `lru.New2Q` — the 2Q algorithm: two LRUs, a "recent" queue and a "frequent" queue, with a ghost list. Better for workloads where one-time scans should not evict the hot set.
- `lru.NewARC` — Adaptive Replacement Cache. Automatically tunes the split between recency and frequency. Patented by IBM; the library uses an unencumbered variant.
- `expirable.NewLRU` — LRU with per-entry TTL. Useful when entries become stale on a clock, not on capacity.

For 90% of projects, `lru.New` is the right starting point. Reach for 2Q or ARC when your hit-rate disappoints under a known scan pattern. Reach for `expirable` when freshness has a clock.

## A simple debugging endpoint

When something goes wrong in production, you want to see the cache state. A two-line HTTP handler is enough:

```go
http.HandleFunc("/debug/cache", func(w http.ResponseWriter, r *http.Request) {
    keys := cache.Keys()
    fmt.Fprintf(w, "size=%d\n", len(keys))
    for _, k := range keys {
        fmt.Fprintln(w, k)
    }
})
```

`Keys()` returns a snapshot in MRU → LRU order. Curl the endpoint, eyeball the top of the list, and you have a sanity check for "is my hot set actually staying hot?"

For production, hide this behind an authentication check; keys may be sensitive.

## Diagrams and Visual Aids

### The two-view picture

```text
                                  capacity = 4

Map (items)                       List (order, doubly-linked)

  "alice"  --------------------+
                               |
                               v
  "bob"    -------+        +-------+   +-------+   +-------+   +-------+
                  |        | alice |<->|  bob  |<->|  cid  |<->|  dan  |
  "cid"    ------ | -------+-------+   +-------+   +-------+   +-------+
                  |                                                ^
  "dan"    ----------------------------------------------+         |
                  |                                      |         |
                  v                                      v         v
              (pointer)                              (pointer) (LRU end)
```

`Get("alice")` promotes `alice` to the front:

```text
+-------+   +-------+   +-------+   +-------+
| alice |<->|  bob  |<->|  cid  |<->|  dan  |   (alice was already at front)
+-------+   +-------+   +-------+   +-------+
```

`Get("cid")` moves `cid` to the front:

```text
+-------+   +-------+   +-------+   +-------+
|  cid  |<->| alice |<->|  bob  |<->|  dan  |
+-------+   +-------+   +-------+   +-------+
```

`Set("eve", ...)` with the cache full evicts `dan` (the LRU end) and pushes `eve` to the front:

```text
+-------+   +-------+   +-------+   +-------+
|  eve  |<->|  cid  |<->| alice |<->|  bob  |    dan deleted from both views
+-------+   +-------+   +-------+   +-------+
```

### The one-lane bridge

```text
Goroutine 1 ─┐
Goroutine 2 ─┤
Goroutine 3 ─┼──> [ sync.Mutex ] ──> LRU internals
Goroutine 4 ─┤
Goroutine 5 ─┘
              All five queue. Only one is inside at a time.
```

### The invariant, broken and restored

```text
Invariant OK:
  items = {a→Ea, b→Eb, c→Ec}
  list  = [a, b, c]

After list.Remove(c) but BEFORE delete(items, "c"):
  items = {a→Ea, b→Eb, c→Ec*}   *Ec is a freed Element
  list  = [a, b]
  *** invariant broken — must finish atomically under the lock ***

After delete(items, "c"):
  items = {a→Ea, b→Eb}
  list  = [a, b]
  invariant restored.
```

Hold the lock across both halves. There is no "in-between" state visible to other goroutines.

### Sequence of operations under concurrency

```text
time ─►

G1: Lock──Get(a)─Move──Unlock
                  │
G2:               └► Lock──Set(b)─Push──Unlock
                                          │
G3:                                       └► Lock──Get(a)─Move──Unlock
```

Each operation runs to completion before the next starts. The wall-clock duration is the sum, not the maximum — that is the cost of one global lock and the motivation for sharding.

### Memory layout, conceptually

```text
heap:
   ┌───────────────────────────────┐
   │ LRU struct                    │
   │   mu        : Mutex           │
   │   capacity  : int             │
   │   items     : map → *Element  │
   │   order     : *List           │──┐
   └───────────────────────────────┘  │
                                      │
   ┌───────────────────────────────┐  │
   │ List header (front, back)     │◄─┘
   └───────────┬───────┬───────────┘
               │       │
               ▼       ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐
   │ Element │ │ Element │ │ Element │
   │ value   │ │ value   │ │ value   │
   │ next ──►│ │ next ──►│ │ next=nil│
   │◄── prev │ │◄── prev │ │◄── prev │
   └─────────┘ └─────────┘ └─────────┘
        ▲             ▲           ▲
        │             │           │
        └── map values point here ─┘
```

The list owns the elements. The map references them. Both must agree on the set of live elements at all times.

### A failing race scenario

```text
Goroutine A: cache.Get("x")        Goroutine B: cache.Set("y", v)
            (no lock)                          (no lock)

  A: load items["x"]      → e
                                     B: items["z"] = newE
                                     B: order.PushFront(newE)
  A: order.MoveToFront(e)
                                     B: order.Remove(order.Back())
                                        (which may be e if e was the back)
  *** PANIC: e.list is nil, e.next is nil ***
```

The race happens when A and B touch the same `*list.Element` simultaneously. Holding the lock across both `items[…]` and `order.…` calls eliminates this entirely.

### Throughput vs cores under one mutex

```text
Throughput
  │
  │       _____
  │   ___/     \_____      (single mutex curve)
  │  /                \____
  │ /
  │/
  └───────────────────────► cores
   1    2    4    8   16
```

Single-mutex LRU throughput plateaus and then *drops* past 4-8 cores because of contention. Sharding makes the curve climb linearly until the next bottleneck (allocator, GC, memory bandwidth).

### The eviction callback chain

```text
cache.Add(k, v) under lock:
   ┌─ existing? ─yes─► update + MoveToFront ─► unlock
   │
   └─ no ─► full?
              │
              ├─ no  ─► PushFront ─► unlock
              │
              └─ yes ─► evict back ─► callback(oldKey, oldVal) ─► PushFront ─► unlock
                                            │
                                            └── runs WITH the lock held
                                                so it must be FAST
```

A slow callback turns every full-cache insert into a lock-held call into your code. Keep it microseconds, ideally zero.

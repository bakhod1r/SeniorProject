---
layout: default
title: Junior
parent: TTL Caches
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/01-ttl-caches/junior/
---

# Concurrent TTL Caches — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Why a TTL Cache?](#why-a-ttl-cache)
5. [The Smallest Possible Cache](#the-smallest-possible-cache)
6. [Adding a TTL](#adding-a-ttl)
7. [Making It Safe for Concurrency](#making-it-safe-for-concurrency)
8. [Lazy Expiration](#lazy-expiration)
9. [Active Expiration: a Sweep Goroutine](#active-expiration-a-sweep-goroutine)
10. [Stopping the Sweeper Cleanly](#stopping-the-sweeper-cleanly)
11. [Get, Set, Delete in Detail](#get-set-delete-in-detail)
12. [Returning Values Safely](#returning-values-safely)
13. [Time: time.Now vs Monotonic](#time-timenow-vs-monotonic)
14. [A Worked Walk-through: User Session Cache](#a-worked-walk-through-user-session-cache)
15. [Per-Entry TTLs](#per-entry-ttls)
16. [Generic Cache with Go Generics](#generic-cache-with-go-generics)
17. [Counting Hits and Misses](#counting-hits-and-misses)
18. [Sizing the Sweep Interval](#sizing-the-sweep-interval)
19. [Testing a TTL Cache](#testing-a-ttl-cache)
20. [Race Detector and `go test -race`](#race-detector-and-go-test--race)
21. [Common First-Time Bugs](#common-first-time-bugs)
22. [Mental Models](#mental-models)
23. [Real-World Analogies](#real-world-analogies)
24. [Pros, Cons, and Trade-offs](#pros-cons-and-trade-offs)
25. [Use Cases at the Junior Level](#use-cases-at-the-junior-level)
26. [Clean-Code Considerations](#clean-code-considerations)
27. [Error Handling](#error-handling)
28. [Security Considerations](#security-considerations)
29. [Performance Tips at the Junior Level](#performance-tips-at-the-junior-level)
30. [Best Practices](#best-practices)
31. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
32. [Common Misconceptions](#common-misconceptions)
33. [Migrating From an Unsafe Cache](#migrating-from-an-unsafe-cache)
34. [Comparing to Plain `map`, `sync.Map`, and Channels](#comparing-to-plain-map-syncmap-and-channels)
35. [Cheat Sheet](#cheat-sheet)
36. [Self-Assessment Checklist](#self-assessment-checklist)
37. [Test Yourself](#test-yourself)
38. [Tricky Questions](#tricky-questions)
39. [Summary](#summary)
40. [What You Can Build](#what-you-can-build)
41. [Further Reading](#further-reading)
42. [Related Topics](#related-topics)
43. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction
> Focus: "What is a TTL cache? Why is it harder than a plain map? Show me the smallest working version."

A **TTL cache** is a key-value store where each entry has an *expiration time*. Once that time passes, the entry is no longer visible to readers — it has effectively been deleted, even if no goroutine actually removed it from memory. TTL stands for **time-to-live**: the amount of time an entry is considered alive.

You will meet TTL caches every time you want to:

- Avoid hitting a slow database for the same key over and over for the next 60 seconds
- Cache the result of an expensive computation for a few minutes
- Remember a user's authentication state for an hour without re-validating it on every request
- Hold a rate-limiter's "tokens" that should naturally decay
- Memoize an HTTP API response so a microservice doesn't drown its upstream

The "junior" version of this story is: a `map[string]Entry`, an `sync.RWMutex`, and a goroutine that occasionally wakes up to throw out dead entries. That is enough to handle most basic situations, and learning it well gives you the vocabulary needed for everything that follows. We will write that cache step by step, fix the bugs that beginners always introduce, and only then look at the real production designs.

After reading this file you will:

- Know what a TTL cache is and what `Get`, `Set`, and `Delete` mean in this context
- Be able to write a thread-safe cache with `map` + `sync.RWMutex` from memory
- Understand the difference between **lazy** and **active** eviction
- Be able to write a sweep goroutine that does not leak when the cache is destroyed
- Recognise the most common race conditions: lost updates, expired-then-resurrected, slow reader under writer
- Know why `time.Now()` is the right choice in Go but you must still be aware of monotonic vs wall-clock time
- Understand what a *thundering herd* on expiry is (we fix it properly at the middle level)

You do not need to know about sharded caches, `ristretto`, off-heap layout, or singleflight. Those come later.

---

## Prerequisites

- **Required:** Go 1.21 or newer.
- **Required:** Comfort with `map`, slices, pointers, struct fields.
- **Required:** Basic understanding of goroutines and the `go` keyword.
- **Required:** Awareness that maps in Go are **not** safe for concurrent read+write — touching the same map from two goroutines without synchronisation crashes the program with a fatal "concurrent map writes" error.
- **Helpful:** Some exposure to `sync.Mutex` / `sync.RWMutex`.
- **Helpful:** Familiarity with `time.Now()`, `time.Duration`, `time.After`, and `time.Ticker`.

If you can write a function that reads from a map under a mutex, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **TTL** | Time-to-live. The duration an entry remains valid before being considered expired. |
| **Expiration time** | The absolute moment (a `time.Time`) at which an entry becomes invalid. Usually computed as `time.Now().Add(ttl)`. |
| **Entry** | A struct holding the value plus its expiration time and possibly metadata. |
| **Lazy eviction** | Removing an expired entry only when a reader (or another writer) encounters it. The cache may hold dead memory for a long time. |
| **Active eviction** | A background goroutine that periodically scans the cache and removes expired entries, regardless of whether anyone reads them. |
| **Sweep / sweeper** | The background goroutine that performs active eviction. The act of doing a full pass is called a **sweep**. |
| **Get** | Look up a key. If absent or expired, return "miss." If present and not yet expired, return the value. |
| **Set** | Insert or replace a key with a value and a new expiration time. |
| **Delete** | Remove a key explicitly. |
| **Hit / Miss** | A `Get` finds a live entry → *hit*. A `Get` finds nothing (or an expired entry) → *miss*. |
| **Stale entry** | An entry whose expiration time has passed but is still in memory. |
| **Stampede / thundering herd** | When many concurrent readers all miss on the same key at the same instant — usually because a popular key just expired — and all rush to repopulate it. |
| **Singleflight** | A primitive that lets only one goroutine compute a missing value while others wait for the result. Provided by `golang.org/x/sync/singleflight`. |
| **Monotonic time** | A clock that only moves forward, unaffected by wall-clock adjustments. In Go, `time.Now()` reads both wall and monotonic time. |

---

## Why a TTL Cache?

The first question every reviewer will ask is: "Why a cache at all?" The honest answer is: because some piece of data is *expensive to obtain* but *cheap to remember for a while*. Examples:

- A database call that takes 50 ms but returns the same answer for the next 60 seconds for 99% of users.
- A JWT verification that costs 2 ms of CPU but returns the same `(userID, scopes)` pair until the token expires.
- A DNS lookup that takes 30 ms but is valid for the duration of the TTL the resolver returned.
- An HTML rendering that takes 200 ms but does not change as long as the underlying article does not.

You could use a *plain* cache — a `map` without TTL — but then you face two problems:

1. **Memory grows forever.** Every key ever requested is held for the rest of the process's life.
2. **You cannot reason about staleness.** If the underlying data changes, the cache will happily return wrong answers until you restart.

TTL gives you both *bounded memory* (entries eventually fall out) and *bounded staleness* (the answer is at most `ttl` seconds out of date). That is the contract.

A TTL cache does **not** guarantee that data is *exactly* `ttl` seconds old — only that it is *not older than* `ttl` seconds. The actual staleness depends on the cache's internal clock and on how often the sweeper runs. We will see this in detail below.

---

## The Smallest Possible Cache

Before TTL, before concurrency, before sweeping — start with the absolute minimum. A cache is a wrapper around a map. Here is the simplest version:

```go
package cache

// SimpleCache is a minimal, non-thread-safe, non-expiring cache.
// Do NOT use this in concurrent code.
type SimpleCache struct {
    data map[string]string
}

func NewSimpleCache() *SimpleCache {
    return &SimpleCache{data: make(map[string]string)}
}

func (c *SimpleCache) Get(key string) (string, bool) {
    v, ok := c.data[key]
    return v, ok
}

func (c *SimpleCache) Set(key, value string) {
    c.data[key] = value
}

func (c *SimpleCache) Delete(key string) {
    delete(c.data, key)
}
```

This compiles and works in a single goroutine. It is also broken in three important ways:

1. **No concurrency safety.** Two goroutines calling `Set` simultaneously will crash with `fatal error: concurrent map writes`.
2. **No expiration.** Entries live forever.
3. **No size limit.** Memory grows without bound.

We will fix the first two in this file. The third — size-bounded eviction (LRU / LFU) — belongs to the next subsection.

---

## Adding a TTL

To give each entry an expiration, store an `Entry` struct instead of a raw value:

```go
package cache

import "time"

type entry struct {
    value      string
    expiresAt  time.Time
}

type TTLCache struct {
    data        map[string]entry
    defaultTTL  time.Duration
}

func NewTTLCache(defaultTTL time.Duration) *TTLCache {
    return &TTLCache{
        data:       make(map[string]entry),
        defaultTTL: defaultTTL,
    }
}

func (c *TTLCache) Set(key, value string) {
    c.data[key] = entry{
        value:     value,
        expiresAt: time.Now().Add(c.defaultTTL),
    }
}

func (c *TTLCache) Get(key string) (string, bool) {
    e, ok := c.data[key]
    if !ok {
        return "", false
    }
    if time.Now().After(e.expiresAt) {
        // Expired. Treat as missing.
        delete(c.data, key)
        return "", false
    }
    return e.value, true
}

func (c *TTLCache) Delete(key string) {
    delete(c.data, key)
}
```

Note the move from `string` to `entry{value, expiresAt}` and the new check inside `Get`. This is **lazy eviction**: we never remove the expired entry until somebody asks for it. That is fine for a single goroutine, but two problems remain:

- This is still not concurrency-safe.
- Keys that are written once and never read again will sit in memory forever.

We will tackle them one at a time.

---

## Making It Safe for Concurrency

In Go, the *map* type is not safe for concurrent read+write. The runtime actively detects this and panics:

```
fatal error: concurrent map writes
fatal error: concurrent map read and map write
```

There are two practical ways to make a map-backed cache safe:

1. **Wrap it in a mutex.** Either `sync.Mutex` (simple, serialises everything) or `sync.RWMutex` (multiple concurrent readers, one writer).
2. **Use `sync.Map`.** A purpose-built concurrent map with different performance characteristics. We will see it at the middle level; it is not always faster than a mutex-protected map.

Start with `sync.RWMutex`. It is the right choice when reads vastly outnumber writes — which is true for almost every real cache.

```go
package cache

import (
    "sync"
    "time"
)

type entry struct {
    value     string
    expiresAt time.Time
}

type TTLCache struct {
    mu         sync.RWMutex
    data       map[string]entry
    defaultTTL time.Duration
}

func NewTTLCache(defaultTTL time.Duration) *TTLCache {
    return &TTLCache{
        data:       make(map[string]entry),
        defaultTTL: defaultTTL,
    }
}

func (c *TTLCache) Set(key, value string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.data[key] = entry{
        value:     value,
        expiresAt: time.Now().Add(c.defaultTTL),
    }
}

func (c *TTLCache) Get(key string) (string, bool) {
    c.mu.RLock()
    e, ok := c.data[key]
    c.mu.RUnlock()

    if !ok {
        return "", false
    }
    if time.Now().After(e.expiresAt) {
        // Expired — drop it under a write lock.
        c.mu.Lock()
        // Re-check under write lock; somebody may have refreshed it.
        if cur, ok := c.data[key]; ok && time.Now().After(cur.expiresAt) {
            delete(c.data, key)
        }
        c.mu.Unlock()
        return "", false
    }
    return e.value, true
}

func (c *TTLCache) Delete(key string) {
    c.mu.Lock()
    delete(c.data, key)
    c.mu.Unlock()
}
```

There is a subtlety here worth pausing on. We *read* under `RLock`, then if the entry is expired we *upgrade* by releasing the read lock and acquiring the write lock. Between those two operations, another goroutine might have already overwritten the entry with a fresh value. That is why we **re-check under the write lock** before deleting. If you skip the re-check you can lose updates: thread A finds the entry expired, but before A deletes it, thread B writes a fresh entry — A then deletes B's fresh entry. This pattern, "re-check under the stronger lock," appears all over concurrent programming.

> **Why don't we hold the write lock the whole time?** Because almost all calls are hits — the entry is live, no deletion needed. Holding the write lock for every `Get` would serialise the entire cache and destroy throughput. The read lock allows many concurrent hits.

---

## Lazy Expiration

The cache we just built does **lazy expiration**: the only way an entry leaves memory is

1. A reader looks it up, finds it expired, and deletes it.
2. A writer overwrites it.
3. Someone calls `Delete`.

Lazy expiration is appealing for its simplicity — no extra goroutines, no scheduling decisions. But it has a serious shortcoming: **keys that are inserted and never read again live forever.**

Consider a cache that holds session tokens. Users log in, the token goes into the cache, the user closes their browser and never comes back. With pure lazy eviction, the entry stays in memory until the process restarts. After a month, you have millions of dead session entries occupying gigabytes of RAM.

Pure lazy is therefore appropriate only when:

- Every key gets re-read often (e.g. you cache a *small* set of hot keys).
- The cache has another memory bound (e.g. an LRU on top, which is the next subsection's topic).
- Total memory is bounded by the key space (e.g. you cache *all* user records and there are at most 10,000 users).

For any realistic backend cache, you need **active eviction** — a sweep goroutine.

---

## Active Expiration: a Sweep Goroutine

A **sweeper** is a background goroutine that wakes up every so often, walks the cache, and deletes entries whose `expiresAt` is in the past. The simplest implementation uses a `time.Ticker`:

```go
package cache

import (
    "sync"
    "time"
)

type entry struct {
    value     string
    expiresAt time.Time
}

type TTLCache struct {
    mu         sync.RWMutex
    data       map[string]entry
    defaultTTL time.Duration

    stop chan struct{}
}

func NewTTLCache(defaultTTL, sweepInterval time.Duration) *TTLCache {
    c := &TTLCache{
        data:       make(map[string]entry),
        defaultTTL: defaultTTL,
        stop:       make(chan struct{}),
    }
    go c.sweepLoop(sweepInterval)
    return c
}

func (c *TTLCache) sweepLoop(interval time.Duration) {
    ticker := time.NewTicker(interval)
    defer ticker.Stop()

    for {
        select {
        case <-ticker.C:
            c.sweep()
        case <-c.stop:
            return
        }
    }
}

func (c *TTLCache) sweep() {
    now := time.Now()
    c.mu.Lock()
    defer c.mu.Unlock()
    for k, e := range c.data {
        if now.After(e.expiresAt) {
            delete(c.data, k)
        }
    }
}

func (c *TTLCache) Close() {
    close(c.stop)
}
```

Three things to notice immediately.

**First — the sweeper holds the write lock for the *entire pass*.** If the map has a million entries, no `Get` and no `Set` can proceed until the sweep finishes. On a million-entry map that may be 50–200 ms of stall. That is acceptable for a learning project; we will fix it at the middle level by sweeping in batches.

**Second — `delete` during `range` is safe in Go.** The language specification explicitly permits removing entries from a map you are ranging over. You may not safely *add* during iteration (the new keys may or may not appear in the rest of the range), but `delete` is fine.

**Third — `Close` must be called to stop the sweeper.** If you forget, the sweeper goroutine lives until the process dies — a textbook goroutine leak. The sweeper holds a reference to the cache, which holds a reference to its map; together they prevent the whole structure from being garbage collected, even if no other goroutine has a handle to it. We will harden this below.

---

## Stopping the Sweeper Cleanly

The `close(c.stop)` pattern is the idiomatic way to broadcast a stop signal to one or many goroutines. But there are two pitfalls.

### Pitfall 1: closing twice

```go
c.Close() // first call closes c.stop — fine
c.Close() // second call panics: "close of closed channel"
```

Either document "call Close at most once" or guard with `sync.Once`:

```go
import "sync"

type TTLCache struct {
    // ... other fields ...
    stop     chan struct{}
    stopOnce sync.Once
}

func (c *TTLCache) Close() {
    c.stopOnce.Do(func() { close(c.stop) })
}
```

`sync.Once` makes `Close` idempotent. For a real product, this is usually worth it.

### Pitfall 2: the sweeper is mid-pass when Close is called

If the sweeper is currently inside the `for k, e := range c.data` loop with the lock held, `close(c.stop)` only marks the signal. The sweeper will finish the current pass, release the lock, and *then* select the stop case. That is fine for correctness, but if you want `Close` to be synchronous you need to wait for the sweeper to exit:

```go
type TTLCache struct {
    // ... other fields ...
    stop     chan struct{}
    stopOnce sync.Once
    done     chan struct{}
}

func NewTTLCache(defaultTTL, sweepInterval time.Duration) *TTLCache {
    c := &TTLCache{
        data:       make(map[string]entry),
        defaultTTL: defaultTTL,
        stop:       make(chan struct{}),
        done:       make(chan struct{}),
    }
    go func() {
        defer close(c.done)
        c.sweepLoop(sweepInterval)
    }()
    return c
}

func (c *TTLCache) Close() {
    c.stopOnce.Do(func() { close(c.stop) })
    <-c.done
}
```

Now `Close` returns only after the sweeper has actually exited. That is also the right model for testing — your test can `Close` and then assert that no further calls into the cache see a running sweeper.

---

## Get, Set, Delete in Detail

Now we have a working cache. Let's walk through each operation carefully, because at the junior level the *order of operations* matters more than the precise data structure.

### Set

```go
func (c *TTLCache) Set(key, value string) {
    c.mu.Lock()
    c.data[key] = entry{
        value:     value,
        expiresAt: time.Now().Add(c.defaultTTL),
    }
    c.mu.Unlock()
}
```

Decisions made here:

- **Time captured inside the lock.** This is conservative but cheap. If two goroutines call `Set` "simultaneously," whichever the runtime serialises second has the later `expiresAt`. That is the natural and expected behaviour.
- **Overwrites are unconditional.** A second `Set` of the same key replaces the value *and* extends the expiration. This is sometimes called "refresh on write."

A variant that some people want is **"Set if absent or expired."** That is `SetNX`-style semantics, useful for things like distributed locks. We will write it explicitly because the naive form has a race:

```go
// WRONG: race between Get and Set.
func (c *TTLCache) SetIfAbsent_BUGGY(key, value string) bool {
    if _, ok := c.Get(key); ok {
        return false
    }
    c.Set(key, value) // another goroutine may have set it in between
    return true
}

// CORRECT: do the check inside a single locked region.
func (c *TTLCache) SetIfAbsent(key, value string) bool {
    c.mu.Lock()
    defer c.mu.Unlock()
    if e, ok := c.data[key]; ok && time.Now().Before(e.expiresAt) {
        return false
    }
    c.data[key] = entry{
        value:     value,
        expiresAt: time.Now().Add(c.defaultTTL),
    }
    return true
}
```

This is the classic **check-then-act** race. Always do both steps under the same lock.

### Get

```go
func (c *TTLCache) Get(key string) (string, bool) {
    c.mu.RLock()
    e, ok := c.data[key]
    c.mu.RUnlock()

    if !ok {
        return "", false
    }
    if time.Now().After(e.expiresAt) {
        // Expired. We could delete here, but the sweeper will get it eventually.
        return "", false
    }
    return e.value, true
}
```

Note that we **do not delete the expired entry on miss**. Why?

- Deleting requires upgrading to a write lock, which is expensive.
- The sweeper will pick it up soon enough.
- The performance of `Get` is the most important metric of the entire cache — keep it cheap.

If you want eager deletion (some applications do, especially when entries are very large), you can keep the deleting version from earlier. There is no single right answer; both are common.

### Delete

```go
func (c *TTLCache) Delete(key string) {
    c.mu.Lock()
    delete(c.data, key)
    c.mu.Unlock()
}
```

Always under write lock. Note that `delete` of a non-existent key is a no-op in Go — it does not panic.

A subtlety: should `Delete` report whether the key was present? Some APIs do:

```go
func (c *TTLCache) Delete(key string) (existed bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if _, ok := c.data[key]; ok {
        delete(c.data, key)
        return true
    }
    return false
}
```

This is occasionally useful for caller-side metrics. Make the API decision once and stick to it.

---

## Returning Values Safely

Our cache stores `string`, which is immutable in Go — a returned `string` cannot be mutated by the caller. But what if the value is a `[]byte`, a `map`, or a pointer to a mutable struct?

```go
type Entry struct {
    body []byte
}

func (c *Cache) Get(k string) (Entry, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    e, ok := c.data[k]
    return e, ok // returns a COPY of Entry, but the slice header still points to the same backing array
}
```

The caller now holds a slice that shares memory with the cached value. If the caller does `e.body[0] = 'x'`, they have mutated the cache too. Even worse, two goroutines that both received the slice are now racing each other through the cache.

Three defences:

1. **Document immutability.** "Do not mutate the returned slice. If you need to mutate, copy first." Cheap but error-prone.
2. **Defensive copy.** `Get` copies the slice before returning. Costs a heap allocation per call.
3. **Use immutable types.** `string` for bytes, value types for structs, no shared maps.

At the junior level, prefer immutable types. As you grow into the middle and senior levels you will learn when defensive copies are worth their cost.

---

## Time: time.Now vs Monotonic

`time.Now()` in Go returns a `time.Time` that carries **two readings simultaneously**: the wall clock (calendar time) and a monotonic reading. Comparisons via `After`, `Before`, `Sub` use the monotonic reading when both operands have one. That means our TTL cache is naturally robust against wall-clock jumps — if an NTP daemon adjusts the system clock by 5 minutes, our TTL math still works correctly, because `expiresAt.Sub(time.Now())` uses monotonic.

There is exactly one case where you lose monotonic time in Go:

- Serialising and deserialising a `time.Time` (e.g. via JSON, gob) strips the monotonic reading.
- Calling `.Round(0)` explicitly strips it.

For an in-memory cache that never serialises its `expiresAt` field, monotonic time works without you having to think about it. That is one fewer thing to get wrong.

If you find yourself storing `expiresAt` as a Unix timestamp (`int64`), you have given up monotonic time and are now exposed to wall-clock jumps. That is sometimes the right trade — for caches that span across process restarts via shared memory or external storage — but be aware.

A small mental exercise: imagine the system clock jumps forward by 1 hour because of a daylight-saving correction. What happens to a TTL cache that uses `time.Now()` directly versus one that stores `int64` Unix timestamps?

- `time.Now()` version: the monotonic clock did not jump, so `After`/`Before` still behave correctly; nothing observable happens.
- `int64` Unix timestamp version: every entry whose stored expiry is more than 1 hour in the future is unaffected, but every entry whose stored expiry was less than 1 hour from now is now considered expired. The cache appears to "flush" itself.

Now imagine the clock jumps *backwards* by 1 hour:

- `time.Now()` version: still nothing.
- `int64` Unix timestamp version: entries that should have expired in the next hour are now "alive" for an extra hour. Worse, you might re-insert keys with shorter TTLs than the existing entries — the cache stops respecting "last write wins" temporally.

This is why, for in-process caches, idiomatic Go uses `time.Time` and lets the runtime hide the monotonic-clock plumbing. Only step outside that abstraction when the cache crosses a process boundary.

---

## A Worked Walk-through: User Session Cache

Theory is fine, but the cache only earns its keep when you wire it into a real component. Let us walk through a realistic use case end-to-end: caching authenticated user sessions in an HTTP server.

The story: clients present a session token as a cookie. Validating the token requires querying the auth database (about 5 ms per call). The token is valid for 30 minutes after issuance. We want every request after the first to skip the database call.

```go
package session

import (
    "errors"
    "sync"
    "time"
)

type Session struct {
    UserID   int64
    Scopes   []string
    IssuedAt time.Time
}

type Store interface {
    Lookup(token string) (Session, error)
}

type Cache struct {
    mu    sync.RWMutex
    data  map[string]entry
    ttl   time.Duration
    store Store

    stop     chan struct{}
    stopOnce sync.Once
    done     chan struct{}
}

type entry struct {
    sess      Session
    expiresAt time.Time
}

var ErrInvalid = errors.New("invalid token")

func New(store Store, ttl, sweep time.Duration) *Cache {
    c := &Cache{
        data:  make(map[string]entry),
        ttl:   ttl,
        store: store,
        stop:  make(chan struct{}),
        done:  make(chan struct{}),
    }
    go func() {
        defer close(c.done)
        c.sweepLoop(sweep)
    }()
    return c
}

func (c *Cache) Get(token string) (Session, error) {
    c.mu.RLock()
    e, ok := c.data[token]
    c.mu.RUnlock()
    if ok && time.Now().Before(e.expiresAt) {
        return e.sess, nil
    }
    // Cache miss — call the store.
    sess, err := c.store.Lookup(token)
    if err != nil {
        return Session{}, err
    }
    c.mu.Lock()
    c.data[token] = entry{sess: sess, expiresAt: time.Now().Add(c.ttl)}
    c.mu.Unlock()
    return sess, nil
}

func (c *Cache) Invalidate(token string) {
    c.mu.Lock()
    delete(c.data, token)
    c.mu.Unlock()
}

func (c *Cache) sweepLoop(interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-t.C:
            c.sweep()
        case <-c.stop:
            return
        }
    }
}

func (c *Cache) sweep() {
    now := time.Now()
    c.mu.Lock()
    for k, e := range c.data {
        if now.After(e.expiresAt) {
            delete(c.data, k)
        }
    }
    c.mu.Unlock()
}

func (c *Cache) Close() {
    c.stopOnce.Do(func() { close(c.stop) })
    <-c.done
}
```

Five things to notice about this real-world shape:

1. **The cache is a layer over an interface (`Store`).** Tests can supply a stub `Store`. Production wires in the real database. This is the idiomatic Go separation of concerns.
2. **`Get` does the underlying call on miss.** That couples the cache to the store, which is fine for a junior implementation but is what a senior would extract into a separate "loader" function and protect with singleflight.
3. **`Invalidate` is exposed** so the application can throw out a session on logout, password change, or admin action.
4. **`Close` returns synchronously** so a graceful shutdown can wait for the sweeper before letting the process exit.
5. **`Get` may insert into the map under the write lock, even after seeing a miss under the read lock.** This is the classic "RLock for hot path, Lock for cold path" pattern. It is correct here because we *re-fetch from the store regardless* — there is no decision to skip work based on stale state.

Now imagine 1,000 concurrent requests for the same expired token. All 1,000 take the slow path and all 1,000 hit the database. That is the **thundering herd** problem, and the fix is single-flight, which we save for middle.md.

---

## Per-Entry TTLs

Our cache assumed every entry has the same TTL. Real systems often want different keys to live for different amounts of time:

- Successful DNS lookups: TTL provided by the server, usually 60–3600 s.
- Failed DNS lookups: TTL fixed at 5 s — you do not want to keep punishing the server but you also do not want to cache a typo forever.
- Auth tokens: TTL = token's remaining lifetime, not a global default.

The easiest way is to let `Set` take a TTL argument:

```go
func (c *TTLCache) SetWithTTL(key, value string, ttl time.Duration) {
    c.mu.Lock()
    c.data[key] = entry{
        value:     value,
        expiresAt: time.Now().Add(ttl),
    }
    c.mu.Unlock()
}

func (c *TTLCache) Set(key, value string) {
    c.SetWithTTL(key, value, c.defaultTTL)
}
```

The sweeper does not change at all — it just inspects each entry's stored `expiresAt`. This is one of the nice properties of expiration-time rather than duration: per-entry TTLs are "free."

You can also pass `0` to mean "no expiration":

```go
func (c *TTLCache) SetForever(key, value string) {
    c.mu.Lock()
    c.data[key] = entry{value: value} // expiresAt = zero
    c.mu.Unlock()
}

func (c *TTLCache) Get(key string) (string, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    e, ok := c.data[key]
    if !ok {
        return "", false
    }
    if !e.expiresAt.IsZero() && time.Now().After(e.expiresAt) {
        return "", false
    }
    return e.value, true
}
```

Be careful: if you mix `0`-TTL entries with active eviction, the sweeper must skip them too:

```go
func (c *TTLCache) sweep() {
    now := time.Now()
    c.mu.Lock()
    for k, e := range c.data {
        if !e.expiresAt.IsZero() && now.After(e.expiresAt) {
            delete(c.data, k)
        }
    }
    c.mu.Unlock()
}
```

Forgetting that check is a fun bug — the sweeper happily deletes every "forever" entry on the next tick, because the zero `Time` is in the distant past.

---

## Generic Cache with Go Generics

Real applications cache more than strings. Since Go 1.18 you can write a single cache type that works for any value type, using type parameters:

```go
package cache

import (
    "sync"
    "time"
)

type entry[V any] struct {
    value     V
    expiresAt time.Time
}

type TTLCache[V any] struct {
    mu         sync.RWMutex
    data       map[string]entry[V]
    defaultTTL time.Duration

    stop     chan struct{}
    stopOnce sync.Once
    done     chan struct{}
}

func New[V any](defaultTTL, sweepInterval time.Duration) *TTLCache[V] {
    c := &TTLCache[V]{
        data:       make(map[string]entry[V]),
        defaultTTL: defaultTTL,
        stop:       make(chan struct{}),
        done:       make(chan struct{}),
    }
    go func() {
        defer close(c.done)
        c.sweepLoop(sweepInterval)
    }()
    return c
}

func (c *TTLCache[V]) Get(key string) (V, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    e, ok := c.data[key]
    if !ok || time.Now().After(e.expiresAt) {
        var zero V
        return zero, false
    }
    return e.value, true
}

func (c *TTLCache[V]) Set(key string, value V) {
    c.mu.Lock()
    c.data[key] = entry[V]{value: value, expiresAt: time.Now().Add(c.defaultTTL)}
    c.mu.Unlock()
}

func (c *TTLCache[V]) Delete(key string) {
    c.mu.Lock()
    delete(c.data, key)
    c.mu.Unlock()
}

func (c *TTLCache[V]) sweepLoop(interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-t.C:
            c.sweep()
        case <-c.stop:
            return
        }
    }
}

func (c *TTLCache[V]) sweep() {
    now := time.Now()
    c.mu.Lock()
    for k, e := range c.data {
        if now.After(e.expiresAt) {
            delete(c.data, k)
        }
    }
    c.mu.Unlock()
}

func (c *TTLCache[V]) Close() {
    c.stopOnce.Do(func() { close(c.stop) })
    <-c.done
}
```

Now the same code caches sessions, integers, or any struct:

```go
sessions := cache.New[Session](30*time.Minute, time.Minute)
counts   := cache.New[int](time.Minute, 5*time.Second)
records  := cache.New[*User](time.Hour, time.Minute)
```

Note `*User` rather than `User`: caching pointers avoids copying large structs but exposes you to the "returned-value-is-mutable" trap from earlier. Choose with intention.

Generics do *not* solve concurrency problems — every fix you learned for the string-typed version applies unchanged. But they do remove the need to maintain six near-identical caches for six different value types.

---

## Counting Hits and Misses

Once you have a cache running in production, the first question your team will ask is: "What is the hit ratio?" If the answer is 5%, the cache is just slowing things down (extra map look-ups, extra memory, extra goroutine, no benefit). If the answer is 95%, you have probably amortised the underlying call by 20×.

Counting hits and misses is the lightest possible piece of observability and you should always add it. Use `sync/atomic` for the counters so that you do not pay a mutex cost on every lookup:

```go
import "sync/atomic"

type TTLCache struct {
    // ... existing fields ...
    hits   atomic.Uint64
    misses atomic.Uint64
}

func (c *TTLCache) Get(key string) (string, bool) {
    c.mu.RLock()
    e, ok := c.data[key]
    c.mu.RUnlock()

    if !ok || time.Now().After(e.expiresAt) {
        c.misses.Add(1)
        return "", false
    }
    c.hits.Add(1)
    return e.value, true
}

func (c *TTLCache) Stats() (hits, misses uint64) {
    return c.hits.Load(), c.misses.Load()
}
```

That is two extra atomic operations per `Get`. On a modern CPU each is a few nanoseconds — negligible compared to the map lookup.

Two warnings:

- **Do not use a `Mutex` to protect counters.** That would add a 30–60 ns lock acquisition to every `Get` and serialise the cache.
- **Atomic counters are not consistent snapshots.** `hits.Load()` and `misses.Load()` are read at slightly different instants. You may compute a ratio that "exceeds 100%" by a tiny fraction if you sample at the wrong moment. For monitoring this is irrelevant; for tests it is a flake.

Beyond hit/miss, useful counters at the junior level include:

- Number of expired-on-read events (entries `Get` found expired before the sweeper got to them).
- Number of sweep passes performed.
- Number of entries removed by the last sweep.
- Number of entries currently in the cache.

Add them sparingly; each adds a small cost and visual noise. We will discuss richer observability in the senior and professional files.

---

## Sizing the Sweep Interval

How often should the sweeper run? Too rarely, and dead entries accumulate. Too often, and the sweeper steals lock time from real readers.

A reasonable starting heuristic: **`sweepInterval = ttl / 5`**, but never less than 100 ms and rarely more than a minute. The factor of 5 means that, on average, an expired entry lives an extra 10% of its TTL before being swept, which is usually small enough to ignore.

```
ttl = 60s    -> sweep every 12s
ttl = 300s   -> sweep every 60s (clipped from 60s)
ttl = 5s     -> sweep every 1s
ttl = 200ms  -> sweep every 100ms (clipped lower bound)
```

For very small TTLs (say, sub-second), a fixed sweeper is the wrong design — you want the data structure to *know* when the next expiration is (a heap or timer-wheel, covered at the middle level). At the junior level just pick a sweepInterval less than or equal to ttl/2 and accept some waste.

A second knob is **how much work per sweep**. A naive sweep visits every entry; that is `O(N)` per pass. For a million-entry cache, that may be 50 ms of lock time. At the middle level you will see batched and time-budgeted sweepers; for now, expect that very large junior caches will stall under sweep load.

---

## Testing a TTL Cache

Tests for a TTL cache fall into three buckets:

1. **Functional tests.** Set/Get/Delete behave as documented.
2. **TTL tests.** Entries expire when expected.
3. **Concurrency tests.** No races, no deadlocks, no leaks.

### Functional tests

```go
func TestSetGet(t *testing.T) {
    c := NewTTLCache(time.Minute, time.Second)
    defer c.Close()

    c.Set("k", "v")
    v, ok := c.Get("k")
    if !ok || v != "v" {
        t.Fatalf("expected v, got %v ok=%v", v, ok)
    }
}

func TestDelete(t *testing.T) {
    c := NewTTLCache(time.Minute, time.Second)
    defer c.Close()

    c.Set("k", "v")
    c.Delete("k")
    if _, ok := c.Get("k"); ok {
        t.Fatal("expected miss after Delete")
    }
}
```

### TTL tests

The interesting question: how do you test "entry expires after 50 ms" without making tests slow?

- Option A: use real time, with a small TTL. Tests take 100 ms each.
- Option B: inject a clock.

Real time is acceptable when TTLs are short, but it makes tests inherently flaky on slow CI. Injecting a clock is more work up front but pays off:

```go
type clock interface {
    Now() time.Time
}

type realClock struct{}
func (realClock) Now() time.Time { return time.Now() }

type fakeClock struct {
    mu  sync.Mutex
    t   time.Time
}
func (f *fakeClock) Now() time.Time {
    f.mu.Lock()
    defer f.mu.Unlock()
    return f.t
}
func (f *fakeClock) Advance(d time.Duration) {
    f.mu.Lock()
    f.t = f.t.Add(d)
    f.mu.Unlock()
}
```

Then pass the clock into `NewTTLCache` and use `c.clock.Now()` everywhere. In tests you create a `fakeClock`, advance it past the TTL, and assert the entry is gone.

Be aware that you cannot fake out `time.Ticker` this way — that requires another abstraction. At the junior level, accept that the *sweep* portion of the cache is hard to fully fake-time, and rely on small real TTLs for sweep-specific tests.

### Concurrency tests

```go
func TestConcurrent(t *testing.T) {
    c := NewTTLCache(time.Second, 100*time.Millisecond)
    defer c.Close()

    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            key := fmt.Sprintf("k%d", id%10)
            for j := 0; j < 1000; j++ {
                c.Set(key, "v")
                c.Get(key)
            }
        }(i)
    }
    wg.Wait()
}
```

Run with `-race`. If the cache is correctly synchronised, the test passes silently. If you forgot a lock somewhere, the race detector will tell you exactly where the racy reads and writes happened.

---

## Race Detector and `go test -race`

`go run -race`, `go test -race`, `go build -race` — all enable Go's built-in **race detector**. It instruments your binary to track memory accesses across goroutines and report any pair that:

- Are unsynchronised by mutexes, channels, atomics, or `sync.Once`,
- Touch the same memory address,
- And at least one of them is a write.

For a TTL cache you should be in the habit of running every test under `-race` because almost all the interesting bugs are race conditions invisible without it.

Costs of `-race`:

- 5–10× slower
- 5–10× more memory
- Larger binary

That is why you do not ship a `-race` binary to production. But every code path in your test suite should run under `-race` at least once per CI build.

A subtle point: the race detector only *finds* races that actually fire during a particular execution. Some races sit dormant for hours and only trigger under load. So `-race` greens up "no race here" but does not prove the code is race-free in the general sense. Pair `-race` with stress tests that schedule many goroutines doing many operations.

---

## Common First-Time Bugs

Here are the bugs we see again and again in junior code reviews.

### Bug 1: forgetting to unlock

```go
func (c *Cache) Get(k string) (string, bool) {
    c.mu.RLock()
    e, ok := c.data[k]
    if !ok {
        return "", false   // RLock leaked!
    }
    c.mu.RUnlock()
    return e.value, true
}
```

Fix: use `defer`:

```go
func (c *Cache) Get(k string) (string, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    e, ok := c.data[k]
    if !ok {
        return "", false
    }
    return e.value, true
}
```

Or release before every return. `defer` is safer.

### Bug 2: writing the map while holding only the read lock

```go
func (c *Cache) GetOrCompute(k string, compute func() string) string {
    c.mu.RLock()
    defer c.mu.RUnlock()
    if e, ok := c.data[k]; ok {
        return e.value
    }
    c.data[k] = entry{value: compute()} // RACE: write under RLock
    return c.data[k].value
}
```

`sync.RWMutex` does not detect this. The Go runtime will eventually panic with "concurrent map writes" once a second goroutine actually writes. Always upgrade to `Lock()`.

### Bug 3: holding the lock across a slow call

```go
func (c *Cache) GetOrFetch(k string) string {
    c.mu.Lock()
    defer c.mu.Unlock()
    if e, ok := c.data[k]; ok {
        return e.value
    }
    v := slowDatabaseCall(k)         // holds the lock for 200 ms!
    c.data[k] = entry{value: v, expiresAt: time.Now().Add(time.Minute)}
    return v
}
```

While one goroutine waits on `slowDatabaseCall`, every other goroutine is blocked. The proper pattern uses singleflight (middle level) or releases the lock around the slow call (and accepts that two goroutines may compute the same value once).

### Bug 4: capturing the loop variable in the sweeper

In Go versions before 1.22 this was a real bug. From 1.22 the language semantics changed and each iteration gets its own variable, but you may still see legacy code:

```go
for k, e := range c.data {
    go func() {
        if time.Now().After(e.expiresAt) {
            c.mu.Lock()
            delete(c.data, k) // k and e are the SAME variable in pre-1.22 Go
            c.mu.Unlock()
        }
    }()
}
```

In modern Go this works. In old Go it deletes the wrong keys. Always pin the version your project requires.

### Bug 5: sweep deadlock

If your sweeper holds the cache lock and then somehow calls back *into* the cache, you will deadlock with yourself.

```go
func (c *Cache) sweep() {
    c.mu.Lock()
    defer c.mu.Unlock()
    for k := range c.data {
        if c.isExpired(k) { // isExpired also tries to take c.mu — deadlock
            delete(c.data, k)
        }
    }
}
```

Fix: do the comparison inline without re-entering any cache method, or use a `sync.Mutex` with explicit unlocking patterns.

### Bug 6: not stopping the sweeper

```go
func someHandler() {
    c := NewTTLCache(time.Minute, time.Second)
    // ... use c ...
    return // c goes out of scope but the sweeper goroutine still runs forever
}
```

Always `defer c.Close()` or wire the cache into a longer-lived component.

### Bug 7: zero-value Time treated as not-expired

```go
type entry struct {
    value     string
    expiresAt time.Time // zero by default
}

func (c *Cache) Set(k, v string) {
    c.data[k] = entry{value: v} // forgot to set expiresAt!
}

// Get treats e.expiresAt == zero as: time.Now().After(time.Time{}) → true
// so the entry is immediately considered expired.
```

This bug is sneaky because the cache "works" — every `Set` followed by `Get` returns a miss because the entry expired the moment it was inserted. Always test that a freshly inserted entry is actually retrievable.

### Bug 8: clock skew between Set and Get

```go
expiresAt := time.Now().Add(ttl)
// ... 100 ms pass ...
if time.Now().After(expiresAt) { ... } // uses monotonic time → correct
```

Fine in normal Go because `time.Now()` is monotonic. But if you serialised `expiresAt` to JSON and back, monotonic is stripped — and a system-clock adjustment may now make `After` lie.

### Bug 9: the sweeper outlives the cache

A subtle goroutine leak. Consider:

```go
func makeCache() *TTLCache {
    c := NewTTLCache(time.Minute, time.Second)
    return c // caller never calls Close
}

func handle() {
    c := makeCache()
    use(c)
    // c goes out of scope — but the sweeper still references the map.
}
```

The sweeper goroutine holds a reference to `c` (via the method receiver in `sweepLoop`). Therefore `c` is not eligible for garbage collection, even after the caller drops its last reference. The map, the mutex, the entries, and the sweeper itself all leak — *for the life of the process*. This is one of the easiest ways to leak goroutines in a long-running service.

Fix: always wire `Close()` into a deferred call, a shutdown hook, or a parent component's `Close`.

### Bug 10: assuming `Get` is purely a read

```go
// In a benchmark, this line shows up as "expensive":
v, ok := c.Get(key)
```

Why? Because our `Get` *might* take a write lock (the upgrade path when the entry is expired). If 30% of `Get` calls hit an expired entry, the cache is effectively serialised 30% of the time. The benchmark mysteriously shows that "reads" are slower than expected.

Fix at the junior level: do not delete in `Get` — let the sweeper handle it. The miss penalty is a wasted lookup, not a serialisation.

### Bug 11: `time.After` in the sweep loop, not `time.NewTicker`

```go
for {
    select {
    case <-time.After(interval):
        c.sweep()
    case <-c.stop:
        return
    }
}
```

`time.After` allocates a new timer on every iteration and *never reclaims it* until it fires. If `c.stop` fires first, the pending timer leaks for `interval`. For short intervals this is harmless; for long intervals (minutes) under high `Close` churn (e.g. in tests) this matters. Use `time.NewTicker` and `defer ticker.Stop()`.

### Bug 12: Goroutines launched per Set

A creative beginner sometimes writes:

```go
func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    c.data[k] = entry{value: v, expiresAt: time.Now().Add(c.ttl)}
    c.mu.Unlock()
    go func() {
        time.Sleep(c.ttl)
        c.Delete(k) // self-expiring entry!
    }()
}
```

It "works" — but it spawns a goroutine *per entry*. A cache with 10,000 entries has 10,000 sleeping goroutines. A cache with 10,000,000 entries has 10,000,000 goroutines — and your process is out of memory. The whole point of a sweeper is to use *one* goroutine for the entire cache.

---

## Mental Models

### Model 1: a sieve

Picture the cache as a sieve. New entries fall in from above with a stopwatch attached. Some entries are retrieved (a reader picks them out, checks the stopwatch, accepts or rejects them). The rest stay in the sieve until the sweeper passes through with a magnet that pulls out everything whose stopwatch has hit zero.

This model makes it obvious that there are two ways an entry leaves the sieve: a reader removes it, or the sweeper does. If neither happens, the entry stays forever.

### Model 2: a sliding window of stickies

Each entry is a sticky note with a date written on it. Every so often, a janitor walks through and removes any stickies whose date is in the past. Readers look at the stickies; if they find an old one, they may also throw it out themselves. The janitor's pace and the readers' attention together determine how many old stickies pile up.

### Model 3: two pipelines that cross

Readers and writers form one pipeline: random arrivals from many goroutines, all touching the same map. The sweeper forms a second pipeline: a slow, periodic process that contends with the first. The interesting questions are all about *the interaction* between these two pipelines — what happens when the sweeper holds the lock while readers wait, what happens when readers find an entry the sweeper is about to delete, what happens at shutdown.

---

## Real-World Analogies

Concrete analogies often beat formal definitions when you are reasoning about a concurrent data structure for the first time.

**A library returns shelf.** Books arrive in a hurry, get stacked on a returns shelf, and patrons grab them back when they want them again. Once a week, a librarian walks past and removes anything that has been sitting too long. The "TTL" is "how long a book may sit on the shelf"; the "sweep" is the librarian's weekly walk. Patrons (readers) can also throw a book in the discard bin if they see it is too dusty.

**A milk fridge.** Each carton has a "best before" date. Customers check the date when they pick one up (lazy eviction). A staff member also walks through periodically and tosses cartons past their date (active eviction). When the fridge gets crowded, additional rules kick in — recency-based eviction, popularity-based eviction — which is the LRU/LFU world from the next subsection.

**A DNS cache.** Probably the canonical TTL example: when a DNS server answers a query, it tells the resolver how long the answer may be reused. The resolver stores the answer with that expiration and serves later identical queries from cache until expiry. Once expired, the next query forces a fresh round-trip. Real DNS resolvers add jitter, negative caching, prefetching — all topics for the senior and professional pages.

**A token machine in a queue system.** When you take a number at the deli, the number is valid for some duration; if you walk away, the number is forfeited and the staff calls the next person. The machine sweeps for forfeited numbers and reuses them.

**Bus arrival predictions.** "Next bus in 7 minutes." That estimate is cached for ~30 s on the transit app. After 30 s, the app fetches a fresh prediction. If many users open the app within the same second, the app should bundle their fetches together — *singleflight*.

---

## Pros, Cons, and Trade-offs

### Pros

- **Simplicity.** A `map[string]entry` plus a mutex plus a sweeper is fewer than 100 lines of Go.
- **Predictable staleness.** Entries are at most `ttl + sweepInterval` out of date.
- **Memory bounded by entry lifetime.** Even without an explicit size cap, RAM stops growing eventually.
- **No external dependencies.** Pure standard library at the junior level.

### Cons

- **Global mutex.** Every operation contends with every other. For high-throughput services this becomes a bottleneck.
- **No size limit.** A flood of unique keys can fill RAM faster than the sweeper can clear them.
- **Thundering herds on expiry.** Single hot key expires → all readers miss simultaneously → upstream is hammered.
- **Sweep stalls.** A sweep that holds the lock for 100 ms while traversing a million-entry map stops all readers for 100 ms. p99 latency suffers.
- **No persistence.** Process restart wipes the cache; cold starts are painful.
- **No coordination across processes.** Each replica caches independently; warm caches do not share with each other.

### Trade-offs (junior level)

| Question | Cheap answer | Expensive answer |
|---|---|---|
| Lazy or active eviction? | Lazy only (no sweeper). Risk: leaks. | Active + lazy. Cost: sweeper goroutine. |
| Sweep frequency? | Once per minute. Cost: large arrears. | Every 100 ms. Cost: lock contention. |
| Read lock or write lock on Get? | Always write lock. Cost: serialised. | RWMutex with RLock fast path. |
| Sweep one giant pass? | Yes (simple). Cost: long stalls. | Many small passes (middle level). |
| Defensive copies on return? | No (caller must respect contract). | Yes (every Get allocates). |
| Per-entry TTLs? | One global TTL only. | Pass ttl into Set. |

Most of the trade-offs we will fix in the middle and senior files are about moving from the cheap side of these rows to the expensive side without paying the full cost.

---

## Use Cases at the Junior Level

The cache you can build with this file is appropriate for:

- **Single-process micro-services** where requests are not bursty and the cache is small (< 100k entries).
- **CLI tools** that make repeated remote calls (e.g. a CI script that needs to look up the same package metadata many times).
- **Tests** that need a deterministic in-memory store of TTL'd state.
- **Local development** of a system that will eventually use Redis. Building your code against a `Cache` interface that this junior cache implements means you can swap to Redis later without changing call sites.
- **Memoizing pure functions** in tight loops.

It is not appropriate for:

- Public APIs receiving thousands of requests per second.
- Caches holding 10M+ entries.
- Multi-region or multi-replica deployments needing shared cache state.
- Anything where p99 latency is a hard SLO.

---

## Clean-Code Considerations

Even a small cache benefits from disciplined naming and structure.

**Name your type after its purpose, not its mechanism.** `SessionCache` is better than `TTLMap`. The caller does not care whether it is implemented as a TTL'd map or a Redis client.

**Hide internals.** Make `entry`, `data`, `mu`, `stop` unexported. Expose only `Get`, `Set`, `Delete`, `Close`, and metrics.

**Document the contract.** Explicit godoc on each method:

```go
// Get returns the value associated with key and true if the entry exists
// and has not yet expired. Otherwise it returns the zero value and false.
// Get is safe for concurrent use.
func (c *TTLCache) Get(key string) (string, bool) { ... }
```

**Provide an interface.** When the cache crosses a package boundary, define an interface for what the caller can do, not what the implementation can do:

```go
type Cache interface {
    Get(key string) (string, bool)
    Set(key, value string)
    Delete(key string)
}
```

Now your tests can substitute a mock cache, and you can swap implementations without touching call sites.

**Functional options for construction** keep the constructor signature stable across future changes:

```go
type Option func(*TTLCache)

func WithSweepInterval(d time.Duration) Option {
    return func(c *TTLCache) { c.sweepInterval = d }
}

func New(defaultTTL time.Duration, opts ...Option) *TTLCache {
    c := &TTLCache{defaultTTL: defaultTTL, sweepInterval: defaultTTL / 5}
    for _, o := range opts {
        o(c)
    }
    // ... start sweeper ...
    return c
}
```

---

## Error Handling

A TTL cache has surprisingly few error conditions. The interesting ones:

- **Calling methods after `Close`.** Decision: panic (programmer error), no-op (silent), or return an error. Most popular: silent no-op for `Set`/`Delete`, miss for `Get`. Document it.
- **Negative TTL passed to `SetWithTTL`.** Decision: treat as "expire immediately" (most idiomatic), reject with panic, or default to zero. We recommend "expire immediately" — it is what `time.Now().Add(-5*time.Second)` produces naturally, and your Get's `time.Now().After(expiresAt)` check handles it cleanly.
- **Nil cache.** Calling `Get` on a `nil *TTLCache` panics with a nil-pointer dereference. Some libraries add an explicit check; most do not, on the principle that "do not call methods on nil" is a non-negotiable Go convention.

A common anti-pattern is logging from inside the cache. Resist it. The cache has no business knowing how the calling code wants errors reported; that is the caller's job. Return values, do not log.

---

## Security Considerations

A cache is not usually thought of as a security-sensitive component, but it has its own attack surface.

**Memory exhaustion via unique-key flooding.** An attacker who can choose the cache key can pump millions of unique entries into the cache faster than the sweeper can clear them, leading to OOM. Defences:

- Cap the maximum cache size (LRU eviction — next subsection).
- Validate that keys come from a bounded universe (e.g. user IDs that exist).
- Rate-limit writes per source.

**Leaking secrets through cache contents.** If your cache holds session tokens, password hashes, or API keys, then a heap dump (e.g. from a crash) reveals them all in plaintext. Mitigations: encrypt at-rest if your threat model demands it, scrub entries on `Delete`, prefer short TTLs.

**Side-channel: timing.** If `Get` is faster on hits than on misses, an attacker can probe to discover whether certain keys exist. Usually not a meaningful concern for non-security data, but worth knowing.

**Cache poisoning across tenants.** If the cache is shared across customers and the key does not include the tenant ID, customer A may read customer B's cached data. *Always* include a tenant prefix in cache keys for multi-tenant systems.

These problems become much more interesting at scale, where attackers can deliberately try to construct collisions, evict useful entries, or amplify a single request into many. We touch on those in the professional file.

---

## Performance Tips at the Junior Level

Most of the gains at this level come from "stop doing dumb things" rather than algorithmic cleverness.

1. **Use `RLock` for reads, not `Lock`.** The single change from `Mutex` to `RWMutex` typically doubles or triples read throughput.
2. **Do not allocate per call.** Returning a `string` value (not a pointer to a string) avoids garbage.
3. **Do not log on every `Get`.** A `fmt.Printf` inside `Get` will dominate every other cost in the function.
4. **Batch insertions if possible.** A single `Set` is cheap, but acquiring the lock 10,000 times in a tight loop is wasteful when you could acquire it once and insert 10,000 entries.
5. **Skip the expired-check delete in `Get`.** Let the sweeper handle it. Fewer write-lock acquisitions on the hot path.
6. **Pre-size the map.** If you know the cache will hold ~50,000 entries, `make(map[string]entry, 50000)` avoids repeated growth and rehashing.
7. **Avoid `interface{}` if you can.** With generics, you can hold concrete types and avoid the boxing cost.

You do **not** need to worry yet about:

- False sharing of cache lines.
- NUMA placement of memory.
- Sharded maps.
- `runtime.LockOSThread`.

Those become real only at very high throughput and are covered in the senior and professional files.

---

## Best Practices

- Always store `expiresAt` as a `time.Time`, not as an `int64`, when the cache lives inside one process.
- Always have a `Close` method. Always plumb it into your application's shutdown.
- Always run tests with `-race`.
- Always include a hit/miss counter; without it you cannot tell whether the cache is doing its job.
- Always document whether `Get` returns a copy or a shared reference.
- Always reason about the worst case before changing the sweep interval; halving it doubles the lock-time fraction.

---

## Edge Cases and Pitfalls

- **Adding a key during sweep.** The Go spec says new keys added during a `range` over a map may or may not be visible. In practice it does not matter because we add under the same lock as the sweep — they cannot happen simultaneously.
- **TTL of exactly zero.** Naive code may decide `time.Now().After(time.Now())` is false (they are the *same* instant). With monotonic time this is correct; the entry is technically alive for the duration of the function call. Most callers should use TTL > 0.
- **Very large values.** Storing 10 MB strings in a cache is a recipe for memory pressure. Cap value size or store references.
- **Keys with embedded nulls or non-printable bytes.** Go maps handle them, but logs may render them oddly. Sanitise when logging.
- **Sweeper falls behind.** If `sweep` takes longer than `sweepInterval`, the ticker drops ticks; you do not get a pile-up of sweep calls. That is `time.Ticker`'s documented behaviour.

---

## Common Misconceptions

- "A TTL cache evicts entries exactly at their TTL." False — sweepers run on a schedule; entries may live longer.
- "Lazy eviction is wasteful." False — it is exactly right when memory pressure is not a problem and you want minimal goroutine overhead.
- "`sync.Map` is always faster than `map + Mutex`." False — `sync.Map` wins for very-low-mutation workloads but loses for balanced read/write.
- "I do not need to lock reads because they are atomic." False — Go maps are not safe for concurrent read+write; reads may crash even if no other reader is racing.
- "The race detector will catch all my races in CI." False — it only catches races that fire in the executed paths.

---

## Migrating From an Unsafe Cache

You inherit a codebase with this:

```go
var cache = map[string]string{}

func Get(k string) string { return cache[k] }
func Set(k, v string)     { cache[k] = v }
```

It compiles. It passes single-threaded tests. It crashes randomly in production with "fatal error: concurrent map writes." Your job: migrate it safely.

Three steps:

1. **Add the mutex** and lock every access:

   ```go
   var (
       mu    sync.RWMutex
       cache = map[string]string{}
   )
   func Get(k string) string {
       mu.RLock(); defer mu.RUnlock()
       return cache[k]
   }
   func Set(k, v string) {
       mu.Lock(); defer mu.Unlock()
       cache[k] = v
   }
   ```

2. **Move from package-level globals to a struct.** Globals are testing-hostile and obscure dependencies.

3. **Add TTL.** Wrap values in `entry{value, expiresAt}` and add a sweeper. Migrate callers one at a time, keeping the old API alive during the transition.

The classic mistake here is to "improve while migrating" — adding three features at once. Each change should be reviewable and revertible.

---

## Comparing to Plain `map`, `sync.Map`, and Channels

| Approach | Concurrency safe? | Has TTL? | Notes |
|---|---|---|---|
| Plain `map` | No | No | Crashes on concurrent write. |
| `map + sync.Mutex` | Yes | No (you add it) | Simple, serialised access. |
| `map + sync.RWMutex` | Yes | No (you add it) | Better read throughput. |
| `sync.Map` | Yes | No (you add it) | Faster when keys are mostly read or grow-only; slower when writes are frequent. |
| Channels (request/response pattern) | Yes | No (you add it) | Single goroutine owns the map; clients send `op + reply chan`. Very Go-idiomatic but expensive for high-throughput. |
| Sharded `map + Mutex` | Yes | No (you add it) | Splits the lock into N sub-locks. |

A TTL cache is a *behaviour* layered on top of any of these. At the junior level we pick `map + sync.RWMutex` because it is the easiest to reason about and tune.

---

## Cheat Sheet

```go
// Construction
c := NewTTLCache(60*time.Second, 5*time.Second)
defer c.Close()

// Basic ops
c.Set("k", "v")
v, ok := c.Get("k")
c.Delete("k")

// "Set if absent"
inserted := c.SetIfAbsent("k", "v")

// Locking patterns
c.mu.RLock();  /* read  */; c.mu.RUnlock()
c.mu.Lock();   /* write */; c.mu.Unlock()

// Always under write lock
delete(c.data, k)
c.data[k] = ...

// Sweep loop skeleton
go func() {
    t := time.NewTicker(interval); defer t.Stop()
    for {
        select {
        case <-t.C:    c.sweep()
        case <-c.stop: return
        }
    }
}()
```

---

## Self-Assessment Checklist

- [ ] I can write a `map + sync.RWMutex` TTL cache from memory.
- [ ] I know why `Get` should re-check expiration under the write lock before deleting.
- [ ] I can explain the difference between lazy and active eviction.
- [ ] I can write a sweep loop that stops cleanly when `Close` is called.
- [ ] I know that `time.Now()` carries monotonic time, and what strips it.
- [ ] I can name three common mistakes: forgetting to unlock, writing under RLock, holding the lock across a slow call.
- [ ] I can explain the "check-then-act" race in `SetIfAbsent` and how to fix it.
- [ ] I know what a thundering herd is, even if I have not yet implemented the fix.

---

## Test Yourself

Write down the answers before reading the next file.

1. What does TTL stand for?
2. Why is `map` not safe for concurrent read+write in Go?
3. What does `sync.RWMutex` let you do that `sync.Mutex` does not?
4. What is the difference between lazy and active eviction?
5. Name two reasons pure lazy eviction can be wasteful.
6. Why must `Close` be called on a TTL cache?
7. What does `delete` do during a `for k := range m` loop? Is it safe?
8. Why does `time.Now()` in Go protect you against clock adjustments?
9. Why is it wrong to write to the map while holding only `RLock`?
10. Why is it bad to hold the cache lock across a slow database call?

---

## Tricky Questions

These are the questions juniors often get wrong even after they think they understand the topic.

**Q: If two goroutines call `Set("k", "v1")` and `Set("k", "v2")` at exactly the same time, what value will a later `Get("k")` see?**

A: One of them, but you cannot predict which. The mutex serialises the writes; whichever the runtime grants the lock to second is the value the cache holds. There is no "merge" or "conflict" — last write wins.

**Q: Is the sweep goroutine guaranteed to remove an expired entry before any reader sees it as expired?**

A: No. A reader can call `Get` *before* the sweeper has run. The reader sees the entry, checks `expiresAt`, decides "expired," and returns a miss. The sweeper deletes the entry later. The two paths exist independently; that is exactly why we have both lazy and active eviction.

**Q: Does the sweep loop guarantee that no entry lives longer than `ttl + sweepInterval`?**

A: Roughly. In practice the sweeper takes time to run (it may hold the lock for milliseconds), so the upper bound is more like `ttl + sweepInterval + sweepDuration`. For most applications this is well below the noise floor of the staleness budget.

**Q: What if `time.Now()` jumps backwards (via NTP)?**

A: With monotonic time (the default in Go's in-memory `time.Time`), it cannot — `After`/`Before`/`Sub` use the monotonic reading, which only moves forward. The wall-clock component may jump, but it is not used for these comparisons.

**Q: Can `Get` return a partially-written value?**

A: Not for our struct, because we replace the entire map entry atomically under the lock. But if your value is a *pointer* to a struct that other goroutines are mutating, you can read inconsistent state — but that is a separate bug, not a TTL cache bug.

---

## Summary

A TTL cache is a key-value store with an expiration time per entry. The smallest version is a `map[string]entry` protected by `sync.RWMutex`, where `entry` carries both the value and an `expiresAt` `time.Time`. Lazy eviction removes expired entries on read; active eviction uses a background sweeper goroutine to scan and delete. Production caches combine both.

The most important rules at this level are:

- Reads under `RLock`, writes under `Lock`.
- Never write to the map under only `RLock`.
- Use `defer` to unlock.
- Always provide a `Close` method to stop the sweeper.
- `time.Now()` carries monotonic time; do not strip it accidentally.
- The classic races — *check-then-act* in `SetIfAbsent`, *upgrade race* in `Get` after expiration — must be fixed by re-checking under the write lock.

What you do not yet have:

- A way to bound the cache's total memory (LRU / LFU eviction).
- A protection against thundering herds (singleflight).
- A way to avoid the global lock when the cache holds millions of entries (sharding).
- The understanding of how production libraries — ristretto, bigcache, freecache — solve all of the above.

Those topics are the subject of the middle, senior, and professional pages.

---

## What You Can Build

With what you know now you can build:

- A 200-line in-memory HTTP response cache for a small web server.
- A DNS-style positive/negative cache (with separate TTLs for success and failure).
- A short-lived memoization layer in front of a CPU-heavy function.
- A small-scale rate-limiter that holds per-IP counters with a 1-minute TTL.
- A "recently seen" deduplication set for a webhook receiver.

You should *not* yet build:

- A cache for a high-traffic public API (you will get thundering herds).
- A cache larger than a few hundred thousand entries (you will starve readers during sweeps).
- A cache shared across processes (you need an external store like Redis).

---

## Further Reading

- Go documentation for [`sync.RWMutex`](https://pkg.go.dev/sync#RWMutex).
- Go blog post on [Go maps in action](https://go.dev/blog/maps).
- Russ Cox's [How Go's runtime detects concurrent map writes](https://research.swtch.com/) — background reading on the panic you have already seen.
- The `patrickmn/go-cache` library — a well-known small TTL cache; reading its source is excellent practice.
- The [`time` package documentation](https://pkg.go.dev/time) — especially the section on monotonic clocks.

---

## Related Topics

- **Channels** — used in the sweep loop's `select`.
- **`sync.Mutex` / `sync.RWMutex`** — the core synchronisation primitive.
- **`sync.Map`** — alternative concurrent map (middle level).
- **Goroutine lifecycle** — `Close` semantics, leak prevention.
- **LRU / LFU caches** — size-bounded eviction (next subsection).
- **`golang.org/x/sync/singleflight`** — thundering herd protection (middle level).
- **`time.Time` monotonic clock semantics** — relevant whenever you store time.

---

## A Second Walk-through: HTTP Response Cache

Let us build one more end-to-end example, this time wrapping `http.Handler` so any handler becomes cached.

```go
package httpcache

import (
    "bytes"
    "io"
    "net/http"
    "net/http/httptest"
    "sync"
    "time"
)

type cachedResponse struct {
    status    int
    header    http.Header
    body      []byte
    expiresAt time.Time
}

type Middleware struct {
    mu    sync.RWMutex
    data  map[string]cachedResponse
    ttl   time.Duration

    stop     chan struct{}
    stopOnce sync.Once
    done     chan struct{}
}

func New(ttl, sweep time.Duration) *Middleware {
    m := &Middleware{
        data: make(map[string]cachedResponse),
        ttl:  ttl,
        stop: make(chan struct{}),
        done: make(chan struct{}),
    }
    go func() {
        defer close(m.done)
        t := time.NewTicker(sweep)
        defer t.Stop()
        for {
            select {
            case <-t.C:
                m.sweep()
            case <-m.stop:
                return
            }
        }
    }()
    return m
}

func (m *Middleware) Wrap(h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodGet {
            h.ServeHTTP(w, r)
            return
        }
        key := r.URL.RequestURI()

        m.mu.RLock()
        cr, ok := m.data[key]
        m.mu.RUnlock()
        if ok && time.Now().Before(cr.expiresAt) {
            copyHeader(w.Header(), cr.header)
            w.WriteHeader(cr.status)
            _, _ = io.Copy(w, bytes.NewReader(cr.body))
            return
        }

        rec := httptest.NewRecorder()
        h.ServeHTTP(rec, r)

        body := rec.Body.Bytes()
        cr = cachedResponse{
            status:    rec.Code,
            header:    rec.Header().Clone(),
            body:      append([]byte(nil), body...), // defensive copy
            expiresAt: time.Now().Add(m.ttl),
        }
        m.mu.Lock()
        m.data[key] = cr
        m.mu.Unlock()

        copyHeader(w.Header(), cr.header)
        w.WriteHeader(cr.status)
        _, _ = w.Write(cr.body)
    })
}

func copyHeader(dst, src http.Header) {
    for k, vv := range src {
        for _, v := range vv {
            dst.Add(k, v)
        }
    }
}

func (m *Middleware) sweep() {
    now := time.Now()
    m.mu.Lock()
    for k, e := range m.data {
        if now.After(e.expiresAt) {
            delete(m.data, k)
        }
    }
    m.mu.Unlock()
}

func (m *Middleware) Close() {
    m.stopOnce.Do(func() { close(m.stop) })
    <-m.done
}
```

Important details:

- **Method check.** Only GETs are cached. Caching POSTs would silently break correctness.
- **Key includes full URI** (path + query). This is the cache key. If two queries differ by a single character, they are different keys.
- **`httptest.NewRecorder`** captures the downstream handler's response so we can store it.
- **Defensive copy of body.** The downstream handler's bytes may be reused; copy before storing.
- **`Clone()` on headers.** Headers are a map, and we do not want shared references.
- **No singleflight.** Two concurrent requests for the same uncached key will both call the downstream handler. We will fix that at the middle level.

You can compose this middleware in a `net/http` server:

```go
mw := httpcache.New(30*time.Second, 5*time.Second)
defer mw.Close()
http.Handle("/articles/", mw.Wrap(articlesHandler))
http.ListenAndServe(":8080", nil)
```

This is a perfectly reasonable starting point for a small site. It can take a 1-ms render down to a 1-µs lookup. And it is fewer than 100 lines of code.

---

## Step-by-Step: Adding Each Feature

This section retraces our journey, but in finer steps, so a beginner can follow the construction without the editorialising.

### Step 1: a non-safe map.

```go
type Cache struct {
    data map[string]string
}
func New() *Cache { return &Cache{data: map[string]string{}} }
func (c *Cache) Get(k string) (string, bool) { v, ok := c.data[k]; return v, ok }
func (c *Cache) Set(k, v string)             { c.data[k] = v }
func (c *Cache) Delete(k string)             { delete(c.data, k) }
```

Single-threaded only. If two goroutines call `Set` you crash.

### Step 2: add a mutex.

```go
type Cache struct {
    mu   sync.Mutex
    data map[string]string
}
func (c *Cache) Get(k string) (string, bool) {
    c.mu.Lock(); defer c.mu.Unlock()
    v, ok := c.data[k]
    return v, ok
}
func (c *Cache) Set(k, v string) {
    c.mu.Lock(); defer c.mu.Unlock()
    c.data[k] = v
}
func (c *Cache) Delete(k string) {
    c.mu.Lock(); defer c.mu.Unlock()
    delete(c.data, k)
}
```

Now thread-safe. Reads and writes are serialised, which is the limiting factor for high-throughput services.

### Step 3: switch to RWMutex for parallel reads.

```go
type Cache struct {
    mu   sync.RWMutex
    data map[string]string
}
func (c *Cache) Get(k string) (string, bool) {
    c.mu.RLock(); defer c.mu.RUnlock()
    v, ok := c.data[k]
    return v, ok
}
// Set and Delete unchanged — still use Lock()
```

Many readers can run concurrently. A single writer blocks all readers.

### Step 4: add TTL by wrapping values.

```go
type entry struct {
    value     string
    expiresAt time.Time
}
type Cache struct {
    mu   sync.RWMutex
    data map[string]entry
    ttl  time.Duration
}
func (c *Cache) Set(k, v string) {
    c.mu.Lock(); defer c.mu.Unlock()
    c.data[k] = entry{value: v, expiresAt: time.Now().Add(c.ttl)}
}
func (c *Cache) Get(k string) (string, bool) {
    c.mu.RLock(); defer c.mu.RUnlock()
    e, ok := c.data[k]
    if !ok || time.Now().After(e.expiresAt) {
        return "", false
    }
    return e.value, true
}
```

Lazy expiration: expired entries hang around until a reader notices.

### Step 5: add an active sweeper.

```go
type Cache struct {
    // ... fields above ...
    stop chan struct{}
}

func New(ttl, sweep time.Duration) *Cache {
    c := &Cache{
        data: make(map[string]entry),
        ttl:  ttl,
        stop: make(chan struct{}),
    }
    go c.run(sweep)
    return c
}

func (c *Cache) run(d time.Duration) {
    t := time.NewTicker(d); defer t.Stop()
    for {
        select {
        case <-t.C:
            c.mu.Lock()
            now := time.Now()
            for k, e := range c.data {
                if now.After(e.expiresAt) {
                    delete(c.data, k)
                }
            }
            c.mu.Unlock()
        case <-c.stop:
            return
        }
    }
}

func (c *Cache) Close() { close(c.stop) }
```

Active eviction is now wired in. Don't forget to call `Close`.

### Step 6: make Close idempotent and synchronous.

```go
type Cache struct {
    // ... fields ...
    stop     chan struct{}
    stopOnce sync.Once
    done     chan struct{}
}

func New(ttl, sweep time.Duration) *Cache {
    c := &Cache{
        data: make(map[string]entry),
        ttl:  ttl,
        stop: make(chan struct{}),
        done: make(chan struct{}),
    }
    go func() {
        defer close(c.done)
        c.run(sweep)
    }()
    return c
}

func (c *Cache) Close() {
    c.stopOnce.Do(func() { close(c.stop) })
    <-c.done
}
```

This is the version you should walk into an interview ready to write.

### Step 7: add hit/miss metrics.

```go
import "sync/atomic"

type Cache struct {
    // ... fields ...
    hits, misses atomic.Uint64
}

func (c *Cache) Get(k string) (string, bool) {
    c.mu.RLock(); defer c.mu.RUnlock()
    e, ok := c.data[k]
    if !ok || time.Now().After(e.expiresAt) {
        c.misses.Add(1)
        return "", false
    }
    c.hits.Add(1)
    return e.value, true
}

func (c *Cache) Stats() (hits, misses uint64) {
    return c.hits.Load(), c.misses.Load()
}
```

The cache is now observable enough to know whether it is worth its memory.

### Step 8: add per-entry TTL.

```go
func (c *Cache) SetWithTTL(k, v string, ttl time.Duration) {
    c.mu.Lock(); defer c.mu.Unlock()
    var exp time.Time
    if ttl > 0 {
        exp = time.Now().Add(ttl)
    }
    c.data[k] = entry{value: v, expiresAt: exp}
}

func (c *Cache) Get(k string) (string, bool) {
    c.mu.RLock(); defer c.mu.RUnlock()
    e, ok := c.data[k]
    if !ok {
        c.misses.Add(1)
        return "", false
    }
    if !e.expiresAt.IsZero() && time.Now().After(e.expiresAt) {
        c.misses.Add(1)
        return "", false
    }
    c.hits.Add(1)
    return e.value, true
}
```

`ttl == 0` means "never expire." Zero `Time` is special-cased in the sweeper too.

You now have an 80-line TTL cache that handles per-entry TTLs, concurrency, eviction, observability, and clean shutdown.

---

## Reading Production Code: `patrickmn/go-cache`

The most famous junior-level TTL cache library in the Go ecosystem is `patrickmn/go-cache`. It is widely used, well-tested, and roughly the same shape as what we built above. Reading its source is excellent practice.

Key things to look for:

- It uses `sync.RWMutex`, just like ours.
- It supports per-entry TTLs, including a "no expiration" sentinel.
- It uses a single sweep goroutine.
- It has an `OnEvicted` callback so callers can react to deletions.
- It uses `time.AfterFunc` in some flow paths, which is a different style of self-scheduling.

Read its `cache.go` and compare with our implementation. You will find that:

1. The structure is the same (map + mutex + sweeper).
2. The API has more affordances (per-entry TTL, callbacks).
3. There is no singleflight, no sharding, no admission policy. That is by design: it is a simple cache that does one thing.

When you reach for `patrickmn/go-cache` in production, you are choosing the same engineering trade-offs we discussed in this file. You are exchanging features for simplicity.

---

## Deep Dive: Why `sync.RWMutex` Is the Right Default

Go offers several synchronisation primitives that *could* protect the map:

1. `sync.Mutex`
2. `sync.RWMutex`
3. `sync.Map` (a purpose-built concurrent map)
4. A single goroutine that owns the map, fed by a channel
5. Atomic pointer swap of an immutable map

Each has a place; at the junior level the right default is `sync.RWMutex`. Here is the reasoning, in case you have to defend the choice in a code review.

**Versus `sync.Mutex`.** A plain `Mutex` makes every operation exclusive. Two concurrent `Get` calls — which never touch each other's data — must serialise. For a cache where reads dominate (typical 95% reads / 5% writes), this is a huge waste. `RWMutex` lets readers proceed in parallel.

The cost: `RWMutex` is slightly slower than `Mutex` for the *single-goroutine* case (more bookkeeping). The crossover, where `RWMutex` starts winning, is somewhere around 2–4 concurrent readers on modern hardware. Almost any production cache crosses it immediately.

**Versus `sync.Map`.** `sync.Map` is optimised for "write-once, read-many" patterns — its internal data structure trades a little memory for very low contention on reads. It is *not* a general-purpose concurrent map. Benchmarks consistently show it loses to `map + RWMutex` for balanced read/write workloads, sometimes by a factor of 2–3.

Use `sync.Map` when:

- The same key is rarely written more than once.
- You have *many* goroutines each writing to *disjoint* keys.
- You can tolerate the lack of type safety (it stores `interface{}`).

For TTL caches, the dominant operation is "Get hits an entry that was written by some prior request and may be overwritten on expiry." That is roughly balanced read/write; `RWMutex` wins.

**Versus channels (CSP-style).** You can model a cache as a single goroutine that owns the map and a channel of requests:

```go
type op struct {
    kind  int // 0=get, 1=set, 2=delete
    k, v  string
    reply chan opReply
}
```

Elegant and easy to reason about — there is exactly one goroutine touching the map, so no locks needed. But channel send/receive plus a goroutine context switch is *much* slower than a mutex acquisition. For high-throughput caches, channels become the bottleneck.

This pattern is excellent when the operation is *complex* (sequencing matters, you want a single audit log of mutations, you want to express "transactions" easily) but overkill for a basic cache.

**Versus atomic pointer swap.** A "write" rebuilds the entire map; readers always read from a stable snapshot. Fantastic for read-only data — terrible for caches with any write rate.

So: `RWMutex` is the default because it is fast enough, correct, easy to reason about, and the cost model is well understood. The other primitives become attractive at the senior and professional levels when the cache's needs grow.

---

## Deep Dive: When the Sweeper Holds the Lock

Suppose your cache has 1,000,000 entries and the sweeper takes 80 ms to walk them under the write lock. During those 80 ms:

- All `Get` calls block.
- All `Set` calls block.
- All `Delete` calls block.
- The system's p99 latency for any cache-touching request becomes at least 80 ms.

For a service whose normal latency budget is 100 ms, this is catastrophic. Even worse: the sweeper holds the lock fairly, but `RWMutex` does not guarantee starvation-freedom for either readers or writers under heavy contention. A long-held write lock means readers stack up and may be unblocked in any order.

There are several escapes:

1. **Sweep less often.** If the cache is small enough that staleness does not matter, lengthen the sweep interval. Not always acceptable.
2. **Sweep in batches.** Hold the lock for a small chunk (say, 1,000 keys), release it, yield, take it again. We will implement this at the middle level.
3. **Shard the cache.** Multiple sub-caches, each with its own lock. The sweeper visits one shard at a time. We will implement this at the senior level.
4. **Sweep without the cache lock at all.** Read keys via an immutable index, schedule deletes by key. Requires a fundamentally different data structure.

At the junior level, choose small enough caches that one-shot sweeps are tolerable. Around 100,000 entries is a reasonable upper limit for a "naive" sweeper on modern hardware.

---

## Deep Dive: Why We Re-check Under the Write Lock

We mentioned this earlier in passing. It deserves its own section because it is one of the easiest concurrent-programming mistakes to make.

Suppose `Get` finds an expired entry and decides to delete it:

```go
// SUBTLY WRONG
func (c *Cache) Get(k string) (string, bool) {
    c.mu.RLock()
    e, ok := c.data[k]
    c.mu.RUnlock()

    if ok && time.Now().After(e.expiresAt) {
        c.mu.Lock()
        delete(c.data, k)
        c.mu.Unlock()
        return "", false
    }
    if !ok {
        return "", false
    }
    return e.value, true
}
```

Walk through an interleaving:

- Time t=0. Goroutine A calls `Get("k")`. It takes the RLock, reads `e` (with expiresAt = t-1), releases the RLock.
- Time t=0+ε. Goroutine B calls `Set("k", "new")`. It takes the write lock, writes a fresh entry with expiresAt = t+60. Releases the lock.
- Time t=0+2ε. Goroutine A takes the write lock and deletes `"k"` — which is now B's fresh entry. Releases the lock.

A has deleted a *fresh* entry that B just wrote. From the application's point of view: the user wrote a value and then it disappeared. A bug that may go unnoticed for months because it requires two specific goroutines to interleave just so.

The fix is to re-read inside the write-locked section:

```go
if ok && time.Now().After(e.expiresAt) {
    c.mu.Lock()
    if cur, ok2 := c.data[k]; ok2 && time.Now().After(cur.expiresAt) {
        delete(c.data, k)
    }
    c.mu.Unlock()
    return "", false
}
```

Now A checks "is the entry I think I'm deleting still expired?" If B got there first, A leaves the fresh entry alone.

The general principle: **any decision based on a read taken outside the protecting lock must be re-verified inside the lock before acting on it.** This is the *double-checked locking* idiom, also known as TOCTOU (time-of-check / time-of-use). It applies to filesystems, databases, network state, and any concurrent data structure.

Honest alternative: do not delete in `Get` at all. Let the sweeper handle it. Then `Get` never needs the write lock and the race vanishes.

---

## Deep Dive: How `time.Ticker` Actually Works

`time.NewTicker(interval)` returns a `*Ticker` with a `C` channel. The runtime sends a `time.Time` value on that channel approximately every `interval`, *as long as somebody is receiving*. If you stop receiving, the channel may drop ticks (it is buffered with size 1, so at most one tick is pending).

For a sweeper, this is exactly what you want. If a sweep happens to take longer than the interval — say, because the lock was held by a slow `Set` — the next tick is delayed until the receiver is ready. You do not get a pile-up of pending sweeps.

What you *do* need to remember is `defer ticker.Stop()`. Without it, the ticker's underlying timer is held alive by the runtime, even after your goroutine exits. The cost is small (one timer per leaked ticker), but it counts as a goroutine-adjacent leak and shows up in long tests.

```go
func (c *Cache) run(interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()   // <-- IMPORTANT
    for {
        select {
        case <-t.C:
            c.sweep()
        case <-c.stop:
            return
        }
    }
}
```

For very short intervals (sub-millisecond), `time.Ticker` becomes inaccurate — the runtime has overhead per tick that dominates the inter-tick gap. Sweepers in TTL caches almost never run that fast, so this is rarely an issue, but worth knowing.

A common alternative is `time.AfterFunc(interval, fn)`, which schedules a single callback. To produce a loop, the callback reschedules itself. This avoids the ticker channel entirely but introduces re-entrancy worries (the callback runs on a runtime-managed goroutine, not yours). For learning purposes, stick with `Ticker`.

---

## Deep Dive: What Happens on `panic` Inside a Sweep?

Consider a sweep callback that panics:

```go
func (c *Cache) sweep() {
    c.mu.Lock()
    defer c.mu.Unlock()
    for k, e := range c.data {
        if c.onEvicted != nil {
            c.onEvicted(k, e.value) // may panic!
        }
        delete(c.data, k)
    }
}
```

If `onEvicted` panics:

1. The panic unwinds the stack.
2. `defer c.mu.Unlock()` fires, releasing the lock — good.
3. The sweeper goroutine has no `recover`, so the panic propagates out of `sweep` into `run`, which also has no `recover`, and out into the runtime.
4. The runtime treats an unrecovered panic in any goroutine as fatal: the entire process exits.

That last step is the one juniors often miss. A panic in *any* goroutine, not just main, crashes the program. For a sweeper that runs every second, even an unlikely panic eventually fires and brings the service down.

The defensive pattern is to wrap callbacks in `recover`:

```go
func (c *Cache) safeCall(fn func()) {
    defer func() {
        if r := recover(); r != nil {
            // log r and continue
        }
    }()
    fn()
}
```

Use it any time the sweeper invokes user-supplied code. Apply the same defensive thinking to any goroutine you spawn: who runs it, what can it call, what would happen if that thing panicked?

The decision of whether to `recover` is style-dependent. Some teams treat panics as bugs that should crash the process loudly; others treat them as recoverable in background workers. Both are defensible. Pick a policy and document it.

---

## Long-Form Exercises

These exercises take a few hours each. Do them honestly — typing them out trains the muscle memory that lets you write a TTL cache in a job interview from scratch.

**Exercise A.** Implement `TTLCache` with `string` keys and `int` values. Add `Get`, `Set`, `Delete`, `Close`. Use `sync.RWMutex`. Write a test that spawns 100 goroutines doing 1,000 ops each, and run it with `-race`.

**Exercise B.** Add per-entry TTLs by introducing `SetWithTTL(key, value string, ttl time.Duration)`. Update the sweeper to handle the case where TTL is zero (meaning "never expire"). Test that a zero-TTL entry survives a sweep that occurs 10 seconds after insertion.

**Exercise C.** Add a `Stats() (hits, misses uint64)` method using `sync/atomic.Uint64`. Write a benchmark (`go test -bench`) that compares Get throughput between the version with stats and the version without. Report the cost per operation.

**Exercise D.** Replace the `sync.RWMutex` with a plain `sync.Mutex` and measure the change in Get throughput under 16-goroutine concurrent reads. You should see a measurable difference; understand why.

**Exercise E.** Inject a clock interface so tests can advance time without sleeping. Use it to write a test that asserts an entry is gone exactly when expected.

**Exercise F.** Convert the cache to generics. Make it `TTLCache[K comparable, V any]`. Make sure the sweeper, the entry struct, and the `Stats` API all compose correctly.

**Exercise G.** Add an `OnEvicted func(key string, value string)` callback that the sweeper calls when an entry is removed. Take care to call the callback *without* holding the cache lock, or you will deadlock callers who try to re-enter the cache from inside the callback.

**Exercise H.** Add a test that demonstrates a thundering herd: spawn 1000 goroutines that all call `GetOrCompute` for the same key just after it expires. Measure how many times the compute function is called. (Expected: ~1000.) This sets up the singleflight discussion in middle.md.

---

## Deep Dive: Memory Cost of an Entry

Curiosity-question that surprises people: how many bytes does one entry actually cost in our cache?

- Key (`string`): 16 bytes for the header (pointer + length), plus the byte payload (variable).
- Value (`string`): 16 bytes for the header, plus payload.
- `expiresAt` (`time.Time`): 24 bytes (wall, ext, loc).
- Map bucket overhead: roughly 8 bytes per entry on top of the above (depends on Go version and load factor).

So a `{key="user:12345", value="v"}` entry occupies on the order of 80–100 bytes including overhead. A million entries: ~80–100 MB. A hundred million entries: 8–10 GB.

That estimate matters because most "out of memory" failures in TTL caches come from entry-count growth that the developer did not anticipate. If you know your typical entry size, you can compute a memory budget and impose a size cap before you hit it.

For very small values (single integers, booleans), the `time.Time` field is the largest component. You can shave bytes by storing `int64` Unix nanoseconds at the cost of giving up monotonic time. Tread carefully.

For very large values, the dominant cost is the payload, and the cache becomes a "store of a few big things" rather than a "store of many small things" — completely different tuning.

---

## Deep Dive: Why Atomic Counters Beat Mutex Counters

We mentioned this in passing. Here is the reasoning in full.

A `sync.Mutex` acquisition on contended hardware costs roughly 25–60 nanoseconds. If `Get` already takes ~50 ns (a map lookup plus a `time.Now()`), adding a Mutex acquire-release just to bump a counter doubles the per-call cost. Even on uncontended hardware (atomic CAS path), a Mutex is slower than `atomic.Uint64.Add(1)`, which is essentially a single LOCK XADD instruction on x86 — single-digit nanoseconds.

Across a million `Get` calls per second, the difference is on the order of 50 ms of CPU time per second. That is the kind of "free" optimisation you should always take.

What you give up: counters are not consistent with each other. `hits.Load()` and `misses.Load()` are independent atomic reads; the ratio you compute from them may briefly exceed or fall below the "true" instantaneous ratio. For monitoring this is invisible noise. For testing, prefer property-based assertions over exact ratios.

Specifically:

```go
// Bad in a test
if hits == 5 && misses == 5 { ... }

// Better
if hits+misses == 10 && abs(int(hits)-int(misses)) <= 2 { ... }
```

Use total counts where you can; use ratios only at long time scales.

---

## Deep Dive: When to Choose `sync.Map`

Despite our earlier advice to default to `sync.RWMutex`, there is a specific shape of workload where `sync.Map` shines. Knowing the difference helps in interviews.

`sync.Map` is implemented with two internal maps: a "read" map served lock-free, and a "dirty" map for fresh writes. Reads on keys present in the read map cost only an atomic load. Writes (especially of new keys) cost a mutex acquire and a promotion of the dirty map.

This shape is good when:

- The same key is read many times after being written once. Sessions are a good example.
- Writes are rare relative to reads (say, < 1%).
- You do not need to know the cache's size (`sync.Map` does not expose `len`).

It is bad when:

- Reads and writes are roughly balanced (TTL cache with active sweeper falls here).
- You need iteration. `Range` is awkward and stops early on any false return.
- You need typed values (Store/Load take `interface{}`).
- You need any cache-wide operation like "evict the oldest N entries."

For a junior-level TTL cache, the sweeper writes (deletes) periodically, so the write rate is non-negligible. `sync.Map` would not give you the lock-free read fast path you might hope for. Stick with `RWMutex`.

If you are building a *read-mostly* cache where entries are inserted once and not deleted (a pure "memoization table" with a separate trimmer), `sync.Map` may be worth benchmarking. Always measure on representative workloads.

---

## Deep Dive: Map Growth and Memory Reuse

A Go map grows by allocating a new backing array when its load factor crosses a threshold (~6.5 entries per bucket on average). Deletes do *not* shrink the map back. So if you load a million entries and then delete all of them, the map's backing memory is still allocated — about 16–32 MB depending on key/value sizes.

This is the right behaviour for *most* uses; "delete then re-insert" is common, and reusing the buckets is faster than reallocating. But it surprises people who watch their TTL cache's memory usage and find that it doesn't drop after a sweep.

Two practical responses:

1. **Accept it.** Memory will plateau at "largest size ever reached" and stay there. The sweeper still keeps entry count under control, just not the underlying bucket array.
2. **Periodically rebuild.** Once an hour, or when the cache shrinks to 25% of its peak size, allocate a new map and copy live entries. Cheap because you only copy live entries.

```go
func (c *Cache) shrinkIfSparse() {
    c.mu.Lock()
    defer c.mu.Unlock()
    if len(c.data) > c.peak/4 {
        return
    }
    newData := make(map[string]entry, len(c.data)*2)
    for k, e := range c.data {
        newData[k] = e
    }
    c.data = newData
    c.peak = len(c.data)
}
```

At the junior level this is overkill for almost any application. We mention it because in interviews someone may ask "what happens to the map's memory after sweep?"

---

## Deep Dive: When NOT to Use a TTL Cache

A skill more valuable than building a cache is knowing when not to. Common cases where adding a cache makes things worse:

**The underlying call is already cheap.** A `map[string]string` lookup wrapped in a cache is sillier than calling the map directly.

**The data is highly dynamic.** If the underlying value changes more often than your TTL, every cache hit returns stale data and every cache miss is paid in full.

**The key space is enormous.** If almost every request has a unique key (e.g. fully-qualified URLs with unique query strings), the cache fills with entries that are never read again. Hit ratio approaches zero; you pay all the cost for none of the benefit.

**You need transactional consistency.** A cache cannot participate in a database transaction. If the answer to "is X true?" must be consistent with the next write, the cache is the wrong tool.

**The cache is the source of truth.** A cache, by definition, holds copies of data living elsewhere. If your TTL cache is the *only* place a value lives, the next process restart loses everything.

The decision to cache should always be: "I have measured the cost of the underlying operation, I have estimated the hit ratio, the savings exceed the operational overhead of running the cache." If you cannot make that statement honestly, do not cache.

---

## Deep Dive: Avoiding `time.Now()` in Hot Loops

Every call to `time.Now()` reads a kernel time source, which on Linux is `clock_gettime(CLOCK_MONOTONIC)` via vDSO — fast, but not free. About 25–50 ns. In the sweeper that walks a million entries, calling `time.Now()` per entry would cost 25–50 ms in clock reads alone.

Hoist the call out of the loop:

```go
func (c *Cache) sweep() {
    now := time.Now() // ONCE per sweep, not per entry
    c.mu.Lock()
    defer c.mu.Unlock()
    for k, e := range c.data {
        if now.After(e.expiresAt) {
            delete(c.data, k)
        }
    }
}
```

The slightly-imprecise effect: an entry whose `expiresAt` falls *inside* the sweep window (between `time.Now()` and the moment we visit it) is not deleted this round. That is fine — it gets deleted next round.

In contrast, inside `Get`, you typically want to call `time.Now()` once per call. There is no "loop" to hoist out of.

---

## A Note on When to Build vs Borrow

Throughout this file we have *built* TTL caches from scratch. That is correct for learning. In production code, you have three reasonable choices:

1. **Hand-roll a cache** like the ones in this file. Best for small, scope-limited needs where you want full control and no dependencies.
2. **Use `patrickmn/go-cache`** for a battle-tested junior-grade cache.
3. **Use a heavier library** (`ristretto`, `bigcache`, `freecache`) when you need size limits, GC-free behaviour, or sharded throughput. Senior-level discussion.

The decision is rarely "what is the fastest cache in absolute terms" — it is "what is the cheapest cache that meets my requirements." A 100-line hand-rolled cache that you fully understand is often the right answer.

---

## Deep Dive: Naming Things

A small but important point. Cache code is full of similar-looking variables — `data`, `m`, `cache`, `entries`, `tbl`. Without discipline, a code reviewer cannot tell at a glance what each one is.

Conventions that pay off:

- `data` (lowercase, unexported) for the backing map of an `XxxCache` type. Common across many libraries.
- `entry` (singular, unexported) for the per-key struct. `entries` (plural) for the slice/map of entries. Do not invent `cacheEntry`, `mapEntry`, etc.
- `expiresAt` (camelCase) for the timestamp field. Avoid `expiration`, `expiry`, `expirationTime` — they all mean the same thing and inconsistency hurts grep.
- `defaultTTL` for the cache-wide TTL. Avoid `defaultTtl`, `defaultExpiration`.
- `sweepInterval` for the cadence. Avoid `cleanupInterval`, `scanInterval`, `gcInterval` (the last especially — readers think you mean Go GC).
- `Close` (capital C, named exactly this) for shutdown. Match `io.Closer`.

Inside methods:

- `e` for an `entry` value.
- `k` for a key.
- `v` for a value.
- `now := time.Now()` always — never `t`, never `currentTime`.

Boring, but consistent. Future readers (including you, in six months) will thank you.

---

## Deep Dive: Logging from Inside a Cache

Resist the urge to log from `Get`, `Set`, or `sweep`. A few reasons:

1. **Performance.** A single `log.Printf` is microseconds — orders of magnitude slower than the operations it instruments.
2. **Volume.** A cache that handles 10k QPS produces 10k log lines per second. Your log pipeline drowns.
3. **Coupling.** The cache should not know what logger the application uses.
4. **Locking surprise.** Loggers may take their own locks; combined with the cache's, you can produce unexpected lock-order inversions.

Acceptable exceptions:

- One log line at startup (`new cache: ttl=60s sweepInterval=12s`).
- One log line per sweep, *if* the sweep does substantial work (e.g. evicted > 1,000 entries).
- One log line on Close.

For anything finer-grained, prefer metrics (counters, histograms) which are exported on demand rather than emitted per operation.

---

## Practice Story: Pricing API Cache

A small e-commerce service exposes `/price?sku=ABC123`. The handler calls a slow pricing engine (50 ms p99). The team adds a 60-second TTL cache. After deployment:

- Day 1: latency drops from 50 ms to 1 ms. Hit ratio is 92%. Team celebrates.
- Day 7: a sale launches; traffic spikes 20×. Hit ratio drops to 70%. Latency p99 rises to 30 ms because of lock contention during sweeps. Team adds a larger sweep interval.
- Day 14: marketing emails 500,000 customers at once. They all open the app simultaneously. The most popular SKU expires at exactly the moment of the email batch. Every client misses, every miss calls the pricing engine, the engine falls over with thread exhaustion. Team learns about *thundering herds* the hard way.
- Day 21: team adds jittered TTLs — each entry's expiration is `60s + rand(0..6s)` — so popular keys do not synchronise their expirations. The herd flattens out.
- Day 35: pricing engine still drowns under coincidental high-concurrency misses. Team adds singleflight: only one fetch per (key, in-flight) at a time. Engine load drops 90%.
- Day 60: cache hits memory limit; team adds an LRU on top so popular entries evict cold ones rather than nothing.
- Day 90: cache key count crosses 5 million; one giant sweep takes 400 ms. Team shards into 32 sub-caches with independent locks. p99 returns to normal.

This story spans junior, middle, senior, and professional content. The junior decisions — `map + RWMutex`, basic sweeper, hit/miss counters — got the team through days 1–7. After that, every problem they hit is something the higher-level files address. Read the journey backward: every senior optimisation is a fix for a problem someone with only junior knowledge ran into in production.

---

## Deep Dive: Testing Time-Based Code

Time-based tests in Go are usually written in one of three styles. Each has trade-offs you should understand before picking one for your TTL cache.

### Style 1: real `time.Sleep`

```go
func TestExpiration(t *testing.T) {
    c := New(50*time.Millisecond, 25*time.Millisecond)
    defer c.Close()
    c.Set("k", "v")
    time.Sleep(80 * time.Millisecond)
    if _, ok := c.Get("k"); ok {
        t.Fatal("expected miss after expiration")
    }
}
```

Simple to write. Painful when you have 50 such tests, each waiting 80 ms — total 4 seconds of CI time just sleeping. Also flaky on slow CI runners where 80 ms is sometimes only 40 ms of wall time.

Acceptable for one or two sanity tests. Not the default.

### Style 2: injected clock

Define a clock interface, use a fake clock in tests, advance it deterministically:

```go
type clock interface {
    Now() time.Time
}
```

Tests become instantaneous and deterministic — but you have introduced a layer of abstraction that the production code must thread through everywhere. Also: `time.Ticker` and `time.AfterFunc` still tick on real time, so the sweeper is hard to test with a fake clock. The usual workaround is to call `c.sweep()` directly in tests, bypassing the ticker.

### Style 3: synctest (Go 1.24+)

The `testing/synctest` package, experimental in 1.24 and stabilising in 1.25+, runs tests in a synthetic time domain. `time.Sleep`, `time.NewTicker`, and `time.Now()` all use a fake clock that the test can advance.

```go
import "testing/synctest"

func TestExpiration(t *testing.T) {
    synctest.Run(func() {
        c := New(50*time.Millisecond, 25*time.Millisecond)
        defer c.Close()
        c.Set("k", "v")
        time.Sleep(80 * time.Millisecond) // advances synthetic clock
        if _, ok := c.Get("k"); ok {
            t.Fatal("expected miss")
        }
    })
}
```

Pros: deterministic, no production code changes, real sweeper test. Cons: brand new API, only one Go version in production, all participating goroutines must be controlled.

For learning at the junior level, start with style 1 for the basic test and style 2 (injected clock) for serious test suites. Style 3 will become the default over the coming years; keep an eye on it.

---

## Deep Dive: API Surface Decisions

When you ship a TTL cache for others to use, every method name and signature is a design decision. Get them wrong and callers will route around your library. Below are the ones that come up repeatedly.

### `Get` return shape

```go
Get(k string) (V, bool)         // Go idiom: value, present
Get(k string) (V, error)        // explicit error for "not present"
Get(k string) *V                // nil for missing
GetOrDefault(k string, def V) V // never miss
```

The idiomatic Go choice is `(V, bool)`, mirroring map lookups. It is unambiguous and zero-cost. Resist the temptation to invent something cleverer.

### Set: replace or merge?

```go
Set(k string, v V)               // always overwrite
Add(k string, v V) (added bool)  // only if absent or expired
Touch(k string)                  // refresh TTL without replacing value
```

A complete API has all three. Adding `Touch` separately is useful for sessions: "keep this entry alive without forcing me to re-fetch its value."

### Delete: present or unconditional?

Already discussed. Some APIs add `Pop(k string) (V, bool)`: get-and-delete atomically.

### Bulk operations?

```go
SetMany(kvs map[string]V)
DeleteMany(ks []string)
Range(fn func(k string, v V) bool)
```

`Range` is risky: iterating under a single lock means the cache is frozen for the duration. If the callback is slow or panics, the cache stalls. Document it carefully or do not provide it.

### Stats and observability hooks

```go
Stats() Stats               // snapshot of hits, misses, evictions
OnEvicted(fn func(k, v V))  // callback on every eviction
OnExpired(fn func(k, v V))  // callback specifically for TTL expiry
```

Be careful: callbacks run on the sweeper goroutine, with the cache lock potentially held (depending on implementation). A callback that re-enters the cache deadlocks. Document this *very* prominently.

### Construction options

Functional options (`WithSweepInterval`, `WithMetricsHook`) age better than positional arguments. The latter ossifies the constructor signature.

---

## A Note on Type Constraints in Generics

When you write `TTLCache[K comparable, V any]`, the `comparable` constraint on `K` is what allows `K` to be used as a map key. Without it, `map[K]V` does not compile.

`comparable` includes:

- All numeric types
- `string`
- `bool`
- Pointers, channels
- Arrays (fixed-size) of comparable types
- Structs whose every field is comparable
- Interfaces (with a runtime check that the dynamic type is comparable)

`comparable` excludes:

- Slices
- Maps
- Functions
- Structs containing any of the above

So you cannot have `TTLCache[[]byte, V]`. If you need slice-keyed caches, convert the slice to a string first (`string(slice)` allocates, but Go can optimise away the copy in certain cases).

When `V` is `any`, you may want to add `comparable` constraints if you need to compare values for equality (e.g. for `CompareAndSwap` semantics). For a plain TTL cache, `V any` is enough.

---

## More Exercises: Reading Other People's Code

A junior-level exercise that pays disproportionate dividends: read the source of two or three open-source TTL caches and write a one-page summary of how they differ.

Suggested:

1. **`patrickmn/go-cache`** — the canonical simple cache. About 1,000 lines.
2. **`hashicorp/golang-lru/v2/expirable`** — LRU with TTL on top. About 500 lines.
3. The **`time.AfterFunc`-based caches** in the standard library's DNS resolver (search `internal/dnsclient`).

For each:

- What data structure backs it?
- What synchronisation does it use?
- Is the sweeper one-shot or batched?
- Does it support per-entry TTL?
- How does it handle Close?
- What metrics does it expose?

Doing this for three caches teaches you more than any tutorial. You start to see the shared design vocabulary.

---

## A Walk-Through Benchmark

Let us look at a small benchmark you can run yourself to feel the difference between configurations.

```go
package cache

import (
    "fmt"
    "sync"
    "testing"
    "time"
)

func BenchmarkRWMutexCache(b *testing.B) {
    c := New(time.Minute, time.Second)
    defer c.Close()
    for i := 0; i < 1000; i++ {
        c.Set(fmt.Sprintf("k%d", i), "v")
    }
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            i++
            c.Get(fmt.Sprintf("k%d", i%1000))
        }
    })
}

func BenchmarkPlainMutexCache(b *testing.B) {
    var (
        mu sync.Mutex
        m  = map[string]string{}
    )
    for i := 0; i < 1000; i++ {
        m[fmt.Sprintf("k%d", i)] = "v"
    }
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            i++
            mu.Lock()
            _ = m[fmt.Sprintf("k%d", i%1000)]
            mu.Unlock()
        }
    })
}
```

On a modern 8-core machine you might see:

- `BenchmarkRWMutexCache`: ~250 ns/op at 8 concurrent goroutines.
- `BenchmarkPlainMutexCache`: ~1000 ns/op at 8 concurrent goroutines.

The `RWMutex` version is roughly 4× faster because reads run in parallel. As you push the concurrency higher, the gap widens — until eventually you hit the writer-coordination cost and `RWMutex` flattens out. That flat point is your cache's throughput ceiling without sharding.

A second benchmark to try: bake in a slow `Set` (using `time.Sleep`) and measure how it affects `Get` latency. You will see that `RWMutex` does *not* allow `Get`s to run while a `Set` is pending — that's the writer-priority guarantee. The cost is a brief stall on the read side when writes interleave.

These numbers are illustrative; on your hardware they will differ. The relative shape — RWMutex faster than Mutex for reads — should hold.

---

## A Concrete Failure Mode Walk-through

Here is a realistic post-mortem you might write after deploying your first TTL cache in production.

**Symptom.** "p99 latency for `/profile` jumped from 8 ms to 320 ms intermittently, starting around 14:02. p50 unaffected."

**Initial guesses.** Network blip? Database flapping? GC pause?

**Investigation.** You correlate the spikes with the times your TTL cache's sweep runs (every 30 seconds, starting 14:00). The cache holds ~750,000 profile records. The sweep takes about 100 ms while holding the write lock. During those 100 ms, all `/profile` requests stall.

**Root cause.** The sweeper holds a single write lock that blocks every reader for the full sweep duration. Because the cache grew larger than expected (more daily active users than projected), the sweep time grew with it.

**Quick fix.** Lengthen the sweep interval from 30 s to 5 min. This reduces the frequency of spikes (12 → 1 per hour) but each spike is just as bad.

**Real fix (middle-level material).** Switch to a sharded cache so the sweep is per-shard and the lock blast radius is 1/N of the cache. Or implement a batched sweep that releases the lock between batches. Both are covered in middle.md.

**Lesson.** The naive sweeper is *fine* up to a point, and that point is exactly when your cache size grows past what one lock can handle. Plan for the transition before you hit it.

---

## Glossary Recap

Before you move to middle.md, you should be able to define, from memory:

- TTL
- Lazy eviction
- Active eviction
- Sweep / sweeper
- Hit / miss
- Stale entry
- Stampede / thundering herd
- Monotonic clock
- RLock / Lock
- Check-then-act race
- Goroutine leak (in the cache context)

If any of these still feel fuzzy, re-read the relevant section above.

---

## Diagrams & Visual Aids

### A TTL cache as a sieve

```
                 +------+
                  | Set |
                  +--+---+
                     |
                     v
      +--------------------------------+
      |   map[string]entry             |
      |   ----------------             |
      |   k1 -> v1, exp=t+60s          |
      |   k2 -> v2, exp=t+30s   <-- already expired
      |   k3 -> v3, exp=t+120s         |
      +--------------------------------+
              ^                ^
              | RLock          | Lock (sweep)
              |                |
            +-+--+         +---+----+
            |Get |         |Sweeper |
            +----+         +--------+
```

### Lazy vs active eviction timing

```
TIME ->  0s ........ 30s ........ 60s ........ 90s
Set("k") at 0s, ttl=60s, sweepInterval=30s

  Reader Get("k"):
    at 30s -> hit
    at 60s -> hit / miss (boundary)
    at 65s -> miss (lazy detection)

  Sweeper:
    at 30s -> "k" still alive, skip
    at 60s -> "k" exactly at boundary, may or may not remove
    at 90s -> "k" definitely removed
```

### Lifecycle of a sweep goroutine

```
   NewTTLCache  ----> spawn sweepLoop
        |
        | sweepLoop selects on:
        |    ticker.C  -> sweep()
        |    stop      -> return
        |
   Close --> close(stop) --> sweepLoop returns --> close(done)
                                                       |
                                          Close waits <+
```

These pictures will be the same throughout the middle and senior levels; only the internal data structure changes.

### State machine: an entry's life

```
        +-------+   Set    +------+   ttl elapses   +---------+   sweep    +---------+
        |absent | -------> |alive | --------------> |stale    | ---------> |absent   |
        +-------+          +------+                 |(in-mem) |            +---------+
            ^   ^             |                     +---------+              |
            |   |             |                          |                   |
            |   | Delete      |                          | Get sees stale    |
            |   +-------------+                          +-------------------+
            |                                                                |
            +----------------------------------------------------------------+
                          (any path eventually returns to "absent")
```

Three transitions take effort:
- `Set` (writer side, write lock).
- Sweep deleting a stale entry (sweeper side, write lock).
- Get observing a stale entry and deciding what to do (read/write lock interaction).

### Lock interaction timeline

```
goroutine A (Get):  RLock........RUnlock
goroutine B (Get):       RLock............RUnlock
goroutine C (Set):  wait....................Lock..Unlock
goroutine S (Sweep):                                wait..............Lock............Unlock

time -->
```

Multiple Gets overlap. The first Set blocks behind them. The Sweep blocks behind everything. This is `RWMutex` priority in action — readers in flight delay writers. Under reader-heavy workloads it is exactly what you want.

---

## Closing Thoughts on the Junior Level

If you have read this far carefully, you can now:

1. Write a working concurrent TTL cache in Go from scratch.
2. Defend the choice of `sync.RWMutex` over alternatives.
3. Explain lazy vs active eviction.
4. Implement a clean shutdown for the sweeper goroutine.
5. Recognise and fix the common races: check-then-act, upgrade race, write under RLock.
6. Reason about the performance trade-offs at small scale.
7. Identify your cache's failure modes when traffic grows beyond what one lock can handle.

That is *enough* knowledge to use a TTL cache in real code, to read other people's cache implementations critically, and to ask intelligent questions in interviews.

What you cannot yet do:

- Build a cache for millions of entries without sweep stalls.
- Protect against thundering herds on hot keys.
- Reason about `sync.Map`'s internals or when to choose it.
- Use admission policies (TinyLFU) to keep the cache from being polluted by one-hit-wonders.
- Reach into off-heap storage for billions of entries without GC pressure.

Those are the topics of the middle, senior, and professional files in this subsection. They build directly on what you have just learned, so do not skip ahead — every advanced technique is a fix for a problem you can name from this file. That is precisely why we built up the junior cache so deliberately: it is the baseline that every later optimisation improves upon.

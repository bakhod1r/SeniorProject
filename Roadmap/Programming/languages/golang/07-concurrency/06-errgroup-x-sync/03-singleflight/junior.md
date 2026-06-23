# singleflight — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [The Cache-Stampede Problem](#the-cache-stampede-problem)
6. [Real-World Analogies](#real-world-analogies)
7. [Mental Models](#mental-models)
8. [Installing the Package](#installing-the-package)
9. [The Three Methods](#the-three-methods)
10. [Code Examples](#code-examples)
11. [Coding Patterns](#coding-patterns)
12. [Clean Code](#clean-code)
13. [Product Use / Feature](#product-use-feature)
14. [Error Handling](#error-handling)
15. [Security Considerations](#security-considerations)
16. [Performance Tips](#performance-tips)
17. [Best Practices](#best-practices)
18. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
19. [Common Mistakes](#common-mistakes)
20. [Common Misconceptions](#common-misconceptions)
21. [Tricky Points](#tricky-points)
22. [Test](#test)
23. [Tricky Questions](#tricky-questions)
24. [Cheat Sheet](#cheat-sheet)
25. [Self-Assessment Checklist](#self-assessment-checklist)
26. [Summary](#summary)
27. [What You Can Build](#what-you-can-build)
28. [Further Reading](#further-reading)
29. [Related Topics](#related-topics)
30. [Diagrams and Visual Aids](#diagrams-and-visual-aids)

---

## Introduction

> Focus: "Why does my service hammer the database when the cache expires? How do I make sure that, when one thousand requests for the same user ID arrive at the same millisecond, the database is asked exactly once?"

Imagine a busy web service. A user profile is cached. The cache entry expires. In the next 50 milliseconds, ten thousand requests arrive that all need that user profile. Each request finds the cache empty. Each request opens a database connection, runs the same query, parses the same row, and writes the result back into the cache. The database, which is sized for a few hundred queries per second, suddenly receives ten thousand identical queries in a single burst. It buckles. Latencies spike. Some requests time out. The cache eventually fills, traffic recovers — until the next expiry, when it all happens again.

This is called a **cache stampede** or a **thundering herd**. It is one of the oldest distributed-systems problems, and the smallest tool in the Go ecosystem for solving it is the `singleflight` package, shipped at `golang.org/x/sync/singleflight`. It is forty lines of public API and roughly one hundred lines of implementation, but it expresses an idea that took the industry decades to name: **request coalescing**.

The promise of `singleflight` is:

> If N goroutines call `g.Do(key, fn)` with the same `key` while one call is still in flight, only one of them runs `fn`. The other N-1 wait. When `fn` returns, every caller receives the same result.

That is the entire idea. In this file you will learn what that one sentence means, why it matters, and how to use it without falling into the four or five bugs that bite every junior who reaches for it the first time.

After reading this file you will:

- Know what request coalescing is and why it is different from caching.
- Recognise a cache stampede in a metrics dashboard.
- Be able to write `g.Do(key, fn)` and read its three return values correctly.
- Know when to use `Do` vs `DoChan` vs `Forget`.
- Understand the most common bug: caching errors when you should retry.
- Be able to combine `singleflight` with a simple cache for a stable loader.

You do not need to know the internals (the `Group.m` map, the `call` struct, panic propagation through `runtime.Goexit`). Those come at the senior and professional levels.

---

## Prerequisites

- **Required:** A working Go installation, version 1.18 or newer. Check with `go version`.
- **Required:** Comfort writing a `main` function, running `go run`, and reading short concurrent code.
- **Required:** Familiarity with goroutines and `sync.WaitGroup`. You should know that `go f()` starts a goroutine and that `wg.Wait` blocks until counters hit zero.
- **Required:** Some idea of what a cache is, conceptually. You will see code that "checks the cache, falls back to a slow source on miss." If that idea is new, read the section on cache patterns first.
- **Helpful:** Light experience with `context.Context`. You will see `ctx` threaded through examples.
- **Helpful:** Light experience with `golang.org/x/...` packages. They are official Go subrepositories — stable, vetted, but not under the standard library's compatibility promise.

If you can compile a Go program, start a goroutine, and explain in one sentence what "cache hit" and "cache miss" mean, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Singleflight** | A small Go package, `golang.org/x/sync/singleflight`, that coalesces concurrent calls for the same key into a single execution. |
| **Group** | The main type of the package: `singleflight.Group`. A group holds the bookkeeping (a map of in-flight calls) needed to deduplicate calls. |
| **Coalescing** | Combining several identical concurrent requests into a single operation whose result is shared by all callers. Also called **deduplication** or **dedup**. |
| **Cache stampede** | A burst of concurrent requests that all miss the cache for the same key and all trigger the slow underlying operation. Also called **thundering herd**. |
| **Thundering herd** | Many waiters being woken at once and all rushing for the same resource. In the cache context, "thundering herd" and "cache stampede" are used interchangeably. |
| **Key** | A string identifier passed to `Do` that decides what to coalesce on. Two calls share work if and only if their keys are equal. |
| **`Do(key, fn)`** | The main method. Runs `fn` once per key per in-flight window. Returns `value, error, shared`. |
| **`DoChan(key, fn)`** | A variant of `Do` that returns a channel instead of blocking. Useful when you want to select on the result alongside a context. |
| **`Forget(key)`** | Remove an in-flight entry from the group's internal map so that the *next* call with the same key starts fresh, even if the current call has not finished. |
| **`shared`** | The third return value of `Do`. `true` if the same result was returned to two or more callers in this round, `false` if you were the only caller. |
| **In-flight call** | A `fn` that has started but not yet returned. Concurrent `Do` calls with the same key while the in-flight call exists will block and reuse its result. |
| **Loader function** | The `fn` you pass to `Do`. Its signature is `func() (interface{}, error)`. |
| **TTL cache** | A cache whose entries expire after a fixed time-to-live. Singleflight is most useful as a thin layer in front of a TTL cache. |
| **Error coalescing** | The fact that when `fn` returns an error, *every* waiter receives that error. Sometimes desired, sometimes not. |

---

## Core Concepts

### Concept 1: A Group is a deduplication table

`singleflight.Group` is a struct that wraps a private `map[string]*call`. The map records, for each key, a pointer to a `call` object that holds:

- A pointer to the function being executed.
- A `sync.WaitGroup` used to make late arrivals wait.
- The result and error fields, populated when the function returns.
- A counter of how many goroutines "shared" the result.

You never see this map directly. The package exposes just three methods that read and write it under a mutex:

```go
func (g *Group) Do(key string, fn func() (interface{}, error)) (v interface{}, err error, shared bool)
func (g *Group) DoChan(key string, fn func() (interface{}, error)) <-chan Result
func (g *Group) Forget(key string)
```

You pick keys, you supply loader functions, the group decides whether to execute or to wait.

### Concept 2: Equality of keys decides everything

Two calls coalesce *if and only if their keys are equal strings*. The package does no normalisation. `"User:42"` and `"user:42"` are different keys. `"42"` and `" 42 "` are different keys. The convention is: put enough information into the key that two identical loads always have identical keys. Avoid putting information that is irrelevant to identity (request ID, trace ID).

### Concept 3: Only the first caller runs the function

The package does not preserve a "first caller wins" guarantee in any visible way — it simply uses a mutex to insert the `call` record atomically. Whichever goroutine inserts the record first is the one that runs `fn`. The losers find the existing record and call `wg.Wait()` on it.

### Concept 4: Errors propagate to all waiters

When `fn` returns an error, that error is stored on the `call` record and every waiter sees it. This is convenient — and it is the most common cause of subtle bugs. We will return to this in [Error Handling](#error-handling) and at length in [Common Mistakes](#common-mistakes).

### Concept 5: Singleflight is *not* a cache

This is the single most important sentence in the file:

> `singleflight` does not remember results between calls.

Once `fn` returns and every waiter has been served, the entry is removed from the internal map. The next call with the same key will *re-execute* `fn`. Singleflight only deduplicates *in-flight* work; it does not cache.

If you want both — dedup *and* caching — you combine `singleflight` with a real cache (a `sync.Map`, an LRU, a TTL cache). The pattern is so common it has a name in this file: the **stable-key cache loader**, covered in [Coding Patterns](#coding-patterns).

---

## The Cache-Stampede Problem

Before we look at code, let us be sure the problem is concrete in your mind.

A naïve cache lookup looks like this:

```go
func GetUser(id string) (*User, error) {
    if u, ok := cache.Get(id); ok {
        return u, nil
    }
    u, err := db.QueryUser(id)
    if err != nil {
        return nil, err
    }
    cache.Set(id, u)
    return u, nil
}
```

This works fine for a single caller. Now imagine ten thousand callers, all running this code in parallel, all looking up the same `id`, immediately after the cache evicted it. What happens?

1. Caller 1 misses the cache. Starts `db.QueryUser`. Has not returned yet.
2. Caller 2 misses the cache (the `Set` has not happened). Starts another `db.QueryUser`.
3. Callers 3..10000 do the same.
4. The database receives ten thousand identical queries.
5. After some delay, the queries finish. Ten thousand `cache.Set` calls race against each other.

Each query returns the *same* `User` — they all read the same row from the same table. The database performed ten thousand times more work than necessary. Connection pools saturated. Latencies spiked. Probably some queries timed out.

This is the stampede. It is triggered every time a hot key expires under load.

A real fix is layered defence: ensure cache keys do not all expire at the same instant (jitter the TTL), pre-warm the cache, run a refresh-ahead loop. But even with all that, you can still get bursts of concurrent misses. That last burst is where `singleflight` shines.

With singleflight in the loader:

```go
func GetUser(id string) (*User, error) {
    if u, ok := cache.Get(id); ok {
        return u, nil
    }
    v, err, _ := g.Do(id, func() (interface{}, error) {
        u, err := db.QueryUser(id)
        if err != nil {
            return nil, err
        }
        cache.Set(id, u)
        return u, nil
    })
    if err != nil {
        return nil, err
    }
    return v.(*User), nil
}
```

Now the ten thousand callers behave like this:

1. Caller 1 misses. `g.Do(id, fn)` inserts an in-flight record and starts `fn`.
2. Caller 2 misses. `g.Do(id, fn)` finds the existing record. It blocks.
3. Callers 3..10000 do the same.
4. Caller 1's `fn` runs the database query, populates the cache, returns.
5. Every blocked caller receives the same `*User` from caller 1's `fn`.
6. The database was queried *once*.

That is a ten-thousand-fold reduction in database load for one expiry event. Multiply by every hot key in your system and you have a service that stays up under burst load.

---

## Real-World Analogies

### Analogy 1: One person fetches coffee

You and ten colleagues all decide you want coffee from the shop down the street. Without coordination, eleven people walk down. With coordination, one person collects orders, goes, returns. `singleflight` is the "wait, I'll grab everyone's" call. The key is "coffee from shop down the street." The result is shared by all eleven.

### Analogy 2: Library reference desk

Twenty students walk into the library asking for the same dictionary at the same minute. The librarian fetches it once, brings it out, and the twenty students share it. The librarian does not walk to the shelf twenty times.

### Analogy 3: The first car through the toll booth

Eleven cars approach a toll booth that requires the driver to fill in a paper form. The first driver fills in the form. The next ten see the form already filled and pass through without filling it themselves. As soon as the eleventh car leaves, the form is removed; the next batch will start a new form.

Importantly: `singleflight` is *not* a long-term store. The "filled form" disappears immediately after the batch passes. Caching that result is *your* job.

---

## Mental Models

### Mental Model 1: "Door with a queue"

Picture a door with a sign that says "Please wait if someone is already inside." A goroutine arrives at the door for key `K`. If nobody is inside for `K`, it goes in, does the work, comes out, and posts the result for everyone waiting. If someone is already inside for `K`, the new arrival joins the queue and reads the result when the worker comes out. After the worker leaves, the door reopens — the next caller starts a fresh round.

### Mental Model 2: "Map of WaitGroups"

`Group` is a `map[string]waitgroup`. When a call starts, you insert an entry with `wg.Add(1)`. Other callers find the entry and call `wg.Wait()`. The original caller does `wg.Done()` when its `fn` returns. (The real implementation also stores the result on the `call` struct so waiters can read it.)

### Mental Model 3: "Pipe with one writer and many readers"

The first caller is the writer. Late arrivals are readers. The writer's result is broadcast to every reader. Once the broadcast is done, the pipe is dismantled. The next call rebuilds it from scratch.

---

## Installing the Package

`singleflight` lives in the `golang.org/x/sync` subrepository. Add it to your module:

```bash
go get golang.org/x/sync/singleflight
```

Then import it:

```go
import "golang.org/x/sync/singleflight"
```

The `x/sync` repository follows the Go project's standard release rhythm but is *outside* the standard library's strict compatibility promise. In practice, `singleflight` has not changed in years and is considered effectively stable.

---

## The Three Methods

### `Do(key string, fn func() (interface{}, error)) (interface{}, error, bool)`

The main method. Blocks until `fn` (or an existing in-flight `fn` for the same key) returns. Returns three values:

- `v interface{}`: the value returned by `fn`. You will type-assert this back to its real type.
- `err error`: the error returned by `fn`. Same for all waiters.
- `shared bool`: `true` if the same value was returned to more than one caller in this round. Useful for metrics — "what fraction of my loads were coalesced?"

```go
v, err, shared := g.Do("user:42", func() (interface{}, error) {
    return db.QueryUser(42)
})
```

### `DoChan(key string, fn func() (interface{}, error)) <-chan Result`

Same semantics as `Do`, but returns a channel instead of blocking. The channel is closed after the single send. Useful when you want to combine with `ctx.Done()` in a `select`:

```go
ch := g.DoChan("user:42", loader)
select {
case res := <-ch:
    return res.Val.(*User), res.Err
case <-ctx.Done():
    return nil, ctx.Err()
}
```

Note: the underlying `fn` is *not* cancelled when you stop waiting on the channel. Cancellation behaviour at this level is a senior topic. Just remember: walking away does not stop the work.

The `Result` struct is:

```go
type Result struct {
    Val    interface{}
    Err    error
    Shared bool
}
```

### `Forget(key string)`

Drop the in-flight entry for `key`. If a call is currently executing, it continues — but the next caller that arrives will *not* coalesce with it; instead, that new caller will start a fresh `fn` execution.

`Forget` is the escape hatch for two situations:

1. You discovered the in-flight call is going to fail and you want fresh attempts to start immediately.
2. You want to invalidate after a successful run so the next caller does not start during a stale window. (At junior level, do not worry about this; the default behaviour is correct.)

---

## Code Examples

### Example 1: Bare minimum

```go
package main

import (
    "fmt"
    "sync"
    "time"

    "golang.org/x/sync/singleflight"
)

var g singleflight.Group

func slowLoad(key string) (interface{}, error) {
    time.Sleep(200 * time.Millisecond) // pretend this is a DB or HTTP call
    return "value-for-" + key, nil
}

func main() {
    var wg sync.WaitGroup
    start := time.Now()

    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            v, err, shared := g.Do("hot-key", func() (interface{}, error) {
                return slowLoad("hot-key")
            })
            fmt.Printf("goroutine %d got %v (err=%v, shared=%t) at %v\n",
                i, v, err, shared, time.Since(start))
        }(i)
    }
    wg.Wait()
}
```

Run it. Five goroutines all ask for `"hot-key"`. The total wall time is ~200ms, not 1000ms — because `slowLoad` runs once. Most goroutines will print `shared=true`.

Note: depending on scheduling timing, the very first goroutine may print `shared=false` even though others are waiting. The `shared` flag means "more than one caller received this result." Whether *you* were the first caller is a separate question (you can detect it by checking whether anyone else was waiting when `fn` started, but the package does not expose that).

### Example 2: Type assertion

The `v` is `interface{}`. You must assert it to the real type:

```go
v, err, _ := g.Do("user:42", func() (interface{}, error) {
    u, err := db.QueryUser(42)
    if err != nil {
        return nil, err
    }
    return u, nil
})
if err != nil {
    return nil, err
}
u := v.(*User)  // panics if the loader did not return *User
```

Be consistent: every loader for a given key must return the same concrete type, otherwise the assertion will panic for some waiters.

### Example 3: Combining with a cache (the stable loader)

This is the canonical pattern:

```go
var (
    cache = make(map[string]*User)
    mu    sync.RWMutex
    g     singleflight.Group
)

func GetUser(id string) (*User, error) {
    // Fast path: cache hit.
    mu.RLock()
    if u, ok := cache[id]; ok {
        mu.RUnlock()
        return u, nil
    }
    mu.RUnlock()

    // Slow path: coalesce with other concurrent misses.
    v, err, _ := g.Do(id, func() (interface{}, error) {
        u, err := db.QueryUser(id)
        if err != nil {
            return nil, err
        }
        mu.Lock()
        cache[id] = u
        mu.Unlock()
        return u, nil
    })
    if err != nil {
        return nil, err
    }
    return v.(*User), nil
}
```

Three observations:

1. The cache is the *long-term* store. Singleflight only collapses simultaneous misses.
2. Every loader writes to the cache before returning. Late arrivals see the result via the channel; later requests (after the round ends) see it via the cache hit at the top.
3. The lock is per-cache, not per-key. `singleflight` is what gives you per-key dedup.

### Example 4: `DoChan` with context

```go
func GetUserCtx(ctx context.Context, id string) (*User, error) {
    ch := g.DoChan(id, func() (interface{}, error) {
        return db.QueryUser(id)
    })
    select {
    case res := <-ch:
        if res.Err != nil {
            return nil, res.Err
        }
        return res.Val.(*User), nil
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}
```

This lets your caller abandon the wait when the context cancels. The underlying `fn` will keep running until it finishes naturally — singleflight has no way to cancel it from outside.

### Example 5: `Forget` after error to avoid sticky failures

```go
v, err, _ := g.Do(id, func() (interface{}, error) {
    u, err := db.QueryUser(id)
    if err != nil {
        return nil, err
    }
    return u, nil
})
if err != nil {
    // We do not Forget here — once Do returns, the call is already removed
    // from the map. Forget would be a no-op.
    return nil, err
}
```

Read carefully: `Do` removes the call from the map *itself* after `fn` returns. You do not need `Forget` after `Do` returns. `Forget` is for the case where you want a *concurrent* in-flight call to stop coalescing for *new* callers — covered at middle and senior levels.

---

## Coding Patterns

### Pattern 1: Stable-key cache loader

The most common pattern. Cache holds long-lived results; singleflight deduplicates concurrent misses; loader writes back to the cache.

Pseudocode:

```
load(key):
    if cache.has(key): return cache.get(key)
    v, err = singleflight.Do(key, () -> {
        v = slowSource(key)
        if err == nil: cache.set(key, v)
        return v
    })
    return v
```

### Pattern 2: TTL cache loader

Same as Pattern 1, but the cache entry has a TTL. After expiry, the next caller misses and the loader runs. Singleflight ensures the burst of misses-at-expiry does not stampede the underlying source.

### Pattern 3: Per-resource group

When you have multiple unrelated caches, give each its own `Group`. Sharing a single `Group` across unrelated key spaces forces all loaders to share a single internal mutex, increasing contention.

```go
type Service struct {
    userGroup    singleflight.Group
    productGroup singleflight.Group
}
```

### Pattern 4: Loader closure captures the key

Always capture `key` inside the loader. This guards against the classic "loop variable" bug where the loader sees the wrong key.

```go
for _, id := range ids {
    id := id // capture per-iteration
    go func() {
        v, _, _ := g.Do(id, func() (interface{}, error) {
            return load(id)
        })
        _ = v
    }()
}
```

### Pattern 5: Loader returns the typed value, caller asserts

Keep the loader as close to the underlying API as possible. Do not stuff `interface{}` plumbing inside the loader.

```go
func loadUser(id string) (*User, error) {
    return db.QueryUser(id)
}

// caller
v, err, _ := g.Do(id, func() (interface{}, error) {
    return loadUser(id)
})
```

This separates the singleflight concern (deduplication) from the data concern (loading).

---

## Clean Code

A few rules of taste for `singleflight` code:

- **Name the group after what it coalesces.** `userLoaderGroup`, not `g1`.
- **Pick a key prefix per resource type.** `"user:42"`, `"product:abc"`. This guards against collisions across resource types if you ever do share a group.
- **Wrap the loader.** Hide `singleflight.Group` behind a function that returns the typed result and asserts internally. Callers should not see `interface{}` if you can help it.

```go
type UserLoader struct {
    g     singleflight.Group
    cache UserCache
    db    UserDB
}

func (l *UserLoader) Get(ctx context.Context, id string) (*User, error) {
    if u, ok := l.cache.Get(id); ok {
        return u, nil
    }
    v, err, _ := l.g.Do(id, func() (interface{}, error) {
        u, err := l.db.QueryUser(ctx, id)
        if err != nil {
            return nil, err
        }
        l.cache.Set(id, u)
        return u, nil
    })
    if err != nil {
        return nil, err
    }
    return v.(*User), nil
}
```

- **Do not mix unrelated keys in one group.** If you only have one type of resource per group, your key namespace is unambiguous.

---

## Product Use / Feature

What sort of feature does `singleflight` actually power? A handful of common cases:

- **User profile fetch on a profile page.** Tens or hundreds of concurrent requests for the same celebrity's profile coalesce into one database hit.
- **Avatar / thumbnail loader.** A burst of requests for the same image URL after a CDN miss is collapsed into one origin fetch.
- **Configuration refresh.** A service reads remote configuration. When the local TTL expires, only one goroutine refetches; everyone else waits.
- **Authorization decision cache.** Many concurrent requests check whether a user can do something. The first one queries the policy engine; the rest reuse the answer.
- **Search query autocomplete.** A debounce-style cache. Repeated identical autocomplete queries within the same second coalesce.

A feature can be designed around `singleflight` without users ever knowing it exists — that is the point. The user experiences "fast and stable under burst." The infrastructure team experiences "no database meltdown when a cache expires."

---

## Error Handling

This is where most new users get into trouble.

### The default: errors are coalesced

When `fn` returns a non-nil error, every waiter gets that error. If you have one thousand concurrent callers and the database returns "connection refused," all one thousand see "connection refused."

This is sometimes what you want: the failure is real and there is nothing more to do, no point trying again.

It is sometimes *not* what you want: a transient failure (timeout, connection reset, 503 from upstream) probably should be retried by the next caller, not coalesced into one error for all.

### The simple rule

> If errors are transient and likely to succeed on retry, **call `g.Forget(key)` before returning the error**. The next caller will start a fresh attempt.

Wait — but I just said `Forget` after `Do` returns is a no-op. That is correct: `Do` itself cleans up the call entry when `fn` finishes. So if you want fresh retries on error, you have two choices:

1. Return the error normally. The internal entry is already gone. The *next* caller after `Do` returns will start fresh — that is the default behaviour. No `Forget` needed.
2. Use `Forget(key)` *inside* `fn` (before returning the error) to release in-flight waiters early. Almost never useful; advanced topic.

So at junior level: do nothing special with `Forget`. By default, the next caller after the failing call starts fresh. The issue is *concurrent* waiters during the failing call — they all see the same error. If that is bad for your use case, retry them at the *caller* level:

```go
for attempt := 0; attempt < 3; attempt++ {
    v, err, _ := g.Do(key, loader)
    if err == nil {
        return v.(*User), nil
    }
    if !isRetryable(err) {
        return nil, err
    }
    time.Sleep(backoff(attempt))
}
return nil, errors.New("exhausted retries")
```

This works because by the time `g.Do` returns the error, the call entry is already gone — the next iteration of the loop starts a fresh round.

### Panics

If `fn` panics, the panic propagates to *all* waiters. In practice, you should `recover` inside `fn` and convert the panic to an error, otherwise a single bad row in the database can take down hundreds of request handlers at once.

```go
g.Do(key, func() (v interface{}, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic in loader: %v", r)
        }
    }()
    return slowLoad(key)
})
```

In modern versions of `x/sync/singleflight`, the package itself catches certain panics and converts them into `errgo` errors — but it is still bad practice to rely on that. Recover yourself.

---

## Security Considerations

Singleflight is a coordination primitive, not a security boundary. A few things to keep in mind:

- **Key choice and tenant isolation.** If your service is multi-tenant, the key must include the tenant identifier. Otherwise a request from tenant A could receive a cached/coalesced result that was loaded under tenant B's privileges. Use `"tenant:X:user:42"`, not `"user:42"`.
- **Authorization context.** Singleflight does not pass `context.Context` to the loader by default. If your loader needs the calling user's identity to check authorization, you have a problem: which caller's context do you use? Answer: usually you load *resource state* with no authorization, then check authorization at the handler level. Do not authorize inside the loader.
- **Cache poisoning.** If a malicious caller can make the loader produce a bad value and that value is then coalesced into many concurrent legitimate requests, your service has been poisoned at scale. Validate loader output.
- **Resource exhaustion.** Singleflight prevents *duplicate* work but does not bound *total* work. If an attacker submits ten million distinct keys, you will have ten million in-flight loader functions. Pair singleflight with a request limiter.

---

## Performance Tips

- **In the no-coalesce case, singleflight is cheap.** A single mutex acquire, a map lookup, an insert, and a deferred cleanup. Microseconds.
- **In the coalesce case, you trade many slow ops for one slow op plus a `WaitGroup` wake.** Always a win when the slow op is much slower than the synchronisation.
- **The internal mutex is per-`Group`.** Heavy traffic on one group can become contended. If you have completely unrelated key spaces, use separate `Group` values.
- **Avoid huge loader return values.** Every waiter gets the same `interface{}`. The pointer is copied (cheap), but the underlying data is shared. If you mutate the result, every waiter sees it. Treat loader output as immutable.
- **String keys are GC pressure.** Building keys via `fmt.Sprintf` allocates. For hot loops, consider `strconv.AppendInt` or a `sync.Pool` of buffers.

---

## Best Practices

- Use a separate `Group` per resource type.
- Always use a real cache (TTL or LRU) in front of the loader. Singleflight does not replace caching.
- Keep the loader idempotent. It may be called once for a thousand waiters, so it should be safe to call.
- Make the loader respect context cancellation internally. The first caller's context is the one that actually flows in.
- Wrap singleflight behind a typed function. Callers should not see `interface{}`.
- Recover panics inside the loader.
- Treat the loader's return as immutable from outside the loader.

---

## Edge Cases and Pitfalls

### Edge case 1: Different loaders, same key

If two callers pass *different* `fn` arguments but the same key while a call is in flight, the second `fn` is *ignored*. The second caller waits for the first `fn`'s result. This can be confusing if the same key means different things in different code paths.

Rule: one key, one loader. Do not branch loader logic by caller.

### Edge case 2: Loader returns nil, nil

If `fn` returns `(nil, nil)`, every waiter receives `(nil, nil)`. That is legal Go: a `*User` of nil with no error means "no such user." Whether you treat that as an error or a valid absence is up to you, but be consistent across the loader and callers.

### Edge case 3: Loader is very fast

If `fn` returns in 1µs, no concurrent caller will see the in-flight record — they each get their own `Do` round. That is fine. Singleflight only matters when `fn` is slow.

### Edge case 4: Loader is very slow

If `fn` takes 30 seconds and a thousand callers join, all thousand wait 30 seconds. Singleflight does not parallelise; it serialises. For some cases, that is unacceptable — better to fail fast and degrade. Consider attaching a timeout to the loader (inside it, via `context.WithTimeout`).

### Edge case 5: Caller is cancelled while waiting

If you call `g.Do` and your goroutine is cancelled mid-wait — well, `Do` does not take a context, so you cannot cancel it. Use `DoChan` and `select` if you need cancellation semantics. The underlying `fn` continues to run regardless.

### Edge case 6: Process termination during a call

If the process exits while `fn` is running, the call simply dies along with the process. There is no cleanup contract. If `fn` had partial side effects (wrote to a database but did not return), those side effects persist.

---

## Common Mistakes

### Mistake 1: Treating singleflight as a cache

```go
// WRONG: relies on singleflight to remember the result.
v, err, _ := g.Do(id, expensiveLoad)
// Five seconds later, another caller:
v, err, _ := g.Do(id, expensiveLoad)
// expensiveLoad runs again. There is no caching.
```

Fix: use a real cache and put singleflight in front of it.

### Mistake 2: Caching an error result

```go
// WRONG: the error returned by Do is sometimes transient.
v, err, _ := g.Do(id, loader)
if err != nil {
    cache.Set(id, errEntry{err: err}) // bad: caches transient failures
    return nil, err
}
```

Fix: only cache successful results.

### Mistake 3: Key collisions across resource types

```go
// WRONG: "42" might be a user ID in one path and a product ID in another.
g.Do("42", loadUser)   // somewhere
g.Do("42", loadProduct) // somewhere else
```

Fix: prefix keys, or use separate groups.

### Mistake 4: Capturing the loop variable

```go
for _, id := range ids {
    go func() {
        v, _, _ := g.Do(id, func() (interface{}, error) { // wrong id captured
            return load(id)
        })
        _ = v
    }()
}
```

Fix: `id := id` at the top of each iteration, or pass `id` as an argument. (In Go 1.22+, the loop variable is per-iteration by default — but defensive code is still good.)

### Mistake 5: Holding a lock across `Do`

```go
mu.Lock()
v, _, _ := g.Do(id, loader)
mu.Unlock()
```

If `loader` takes 200ms and the lock is shared by other callers, you have serialised the whole system. Drop the lock before `Do`, reacquire after.

### Mistake 6: Mutating the loader result

```go
v, _, _ := g.Do(id, loader)
u := v.(*User)
u.LastSeen = time.Now() // mutates the shared object every waiter sees
```

Fix: clone before mutating, or do the mutation inside the loader before returning.

### Mistake 7: Type-assertion mismatch

```go
v, _, _ := g.Do(id, func() (interface{}, error) {
    return User{Name: "x"}, nil // value, not pointer
})
u := v.(*User) // panic: not *User
```

Fix: be consistent. Pointer or value; pick one and stick with it.

---

## Common Misconceptions

- **"Singleflight is faster than a normal cache."** No. It is *slower* than a cache hit. It is faster than a stampede of cache misses.
- **"Singleflight remembers results."** No. It only deduplicates in-flight calls. Pair with a cache.
- **"Cancelling a waiter cancels the work."** No. The work runs to completion regardless. Use `DoChan` if you want the waiter to give up; the work still runs.
- **"`Forget` is needed after a normal call."** No. `Do` cleans up its own entry. `Forget` is for advanced scenarios.
- **"All callers must pass the same function."** They should, but the package does not enforce it. Only the first caller's `fn` runs.
- **"Singleflight protects against repeated work over time."** No, only against simultaneous work. Two callers one second apart both pay the full cost.

---

## Tricky Points

### Tricky 1: `shared` is `false` for solo calls

If you are the only caller for a key, `shared` is `false`. If two or more callers join, `shared` is `true` for *all* of them, including the first. The flag is "was this result given to more than one goroutine?", not "are you a follower?"

### Tricky 2: The first caller's `fn` may run on the first caller's goroutine

In the current implementation, the first caller runs `fn` on its own goroutine. The waiters wake up after `wg.Done()`. This means the first caller's stack trace contains `fn` directly; the waiters' stack traces contain `wg.Wait`. That asymmetry matters for debugging.

### Tricky 3: After `Do` returns to the first caller, late arrivals start a new round

Imagine: caller A starts `Do`, runs `fn`, returns. Then caller B starts `Do` for the same key. B runs a *new* `fn`. Singleflight does not remember A's result. This is the key fact distinguishing dedup from caching.

### Tricky 4: Errors are coalesced *only during the in-flight window*

If the loader returns `("", err)`, every concurrent waiter sees that error. But the *next* caller (after the call entry is removed) starts a fresh round and may succeed. So singleflight does not "remember" the error — it only shares it among concurrent callers.

### Tricky 5: `DoChan` does not retry on cancellation

If you `select` on the channel and pick `ctx.Done()`, the channel send still happens later (the goroutine running `fn` keeps going). Nothing terrible happens, but the goroutine running `fn` is not freed until `fn` finishes.

---

## Test

A minimal test to convince yourself the coalescing works:

```go
func TestCoalesces(t *testing.T) {
    var g singleflight.Group
    var calls int32

    loader := func() (interface{}, error) {
        atomic.AddInt32(&calls, 1)
        time.Sleep(50 * time.Millisecond)
        return "ok", nil
    }

    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            v, err, _ := g.Do("k", loader)
            if err != nil || v != "ok" {
                t.Errorf("unexpected: %v, %v", v, err)
            }
        }()
    }
    wg.Wait()

    if got := atomic.LoadInt32(&calls); got != 1 {
        t.Errorf("expected 1 call, got %d", got)
    }
}
```

The assertion that `calls == 1` is the heart of singleflight. If that ever fires as `> 1`, your understanding of the package is wrong or the package broke.

A separate test for the *fresh start after return*:

```go
func TestNotACache(t *testing.T) {
    var g singleflight.Group
    var calls int32

    loader := func() (interface{}, error) {
        atomic.AddInt32(&calls, 1)
        return "ok", nil
    }

    g.Do("k", loader) // first round
    g.Do("k", loader) // second round, fresh

    if got := atomic.LoadInt32(&calls); got != 2 {
        t.Errorf("expected 2 calls, got %d", got)
    }
}
```

---

## Tricky Questions

1. **Q.** If two goroutines call `g.Do(k, fn)` at the same time, how many times does `fn` run?
   **A.** Exactly once. The second caller waits for the first.

2. **Q.** If two goroutines call `g.Do(k, fn)` with one second between them, how many times does `fn` run?
   **A.** Twice. The first call has finished and been removed from the in-flight map before the second arrives.

3. **Q.** If the loader returns an error, do all concurrent waiters see the error?
   **A.** Yes. Errors are coalesced just like values.

4. **Q.** Does cancelling the caller cancel the loader?
   **A.** No. The loader runs to completion. Use `DoChan` to give the caller a way to walk away from the wait.

5. **Q.** What does `shared` mean?
   **A.** `true` if the same result was returned to more than one caller in this round, `false` if you were alone.

6. **Q.** When should I call `Forget`?
   **A.** Rarely. The default cleanup is correct. `Forget` is for advanced scenarios where you want a new in-flight call to start despite an existing one.

7. **Q.** Can I use `singleflight` as a cache?
   **A.** No. It only deduplicates in-flight calls. Combine with a real cache.

8. **Q.** Is `singleflight` safe for concurrent use?
   **A.** Yes. The whole point of it is concurrent use.

9. **Q.** Why pick `singleflight` over `sync.Map.LoadOrStore` for a load-once cache?
   **A.** `LoadOrStore` does not prevent two goroutines from *computing* the value; it only ensures one wins the store. With `singleflight`, only one goroutine computes.

10. **Q.** What happens if I share one `Group` across many caches?
    **A.** All loaders share the same internal mutex. As long as your traffic does not get hot enough to contend on that mutex, it is fine. For unrelated key spaces, prefer separate groups.

---

## Cheat Sheet

```
PACKAGE:    golang.org/x/sync/singleflight
TYPE:       singleflight.Group (zero value ready to use)
METHODS:    Do(key, fn) -> (v, err, shared)
            DoChan(key, fn) -> <-chan Result
            Forget(key)
PURPOSE:    Coalesce concurrent calls for the same key.
NOT:        A cache. Pair with one.
KEY:        Any string. Equality decides coalescing.
LOADER:     func() (interface{}, error). May be called once per round.
ERRORS:     Coalesced across waiters. Cache only successes.
PANIC:      Propagates to all waiters. Recover inside loader.
SHARED:     true if more than one caller received this result.
CONTEXT:    Do does not take ctx. Use DoChan + select if you need it.
COMPARE:    LoadOrStore prevents double-store. Singleflight prevents double-compute.
```

---

## Self-Assessment Checklist

- [ ] I can explain what request coalescing is.
- [ ] I can describe the cache-stampede problem in concrete terms.
- [ ] I can write `g.Do(key, fn)` correctly and assert the result.
- [ ] I know that errors are coalesced and that I usually want to cache only successes.
- [ ] I know that singleflight is not a cache and I always pair it with one.
- [ ] I know that the loader runs to completion even if the caller walks away.
- [ ] I know to recover panics inside the loader.
- [ ] I can write a unit test that proves only one call happens for N concurrent callers.

---

## Summary

Singleflight is a tiny package with a precise job: when many goroutines ask for the same key at the same time, run the work once and share the result. It does not cache results across time. It does not cancel work when callers leave. It does not protect you from key collisions, mutated results, or coalesced errors. Used correctly, in front of a real cache, it eliminates an entire class of stampede outages with about ten lines of code. Used carelessly — caching transient errors, sharing one group across resource types, mutating the returned value — it produces bugs that survive in production for years.

The most important sentence from this file: **singleflight deduplicates in-flight calls; it does not cache.**

---

## What You Can Build

- A read-through cache for a hot database table.
- A configuration loader that refreshes once per TTL instead of once per caller.
- An avatar / thumbnail fetcher that handles a "celebrity just tweeted" burst.
- A policy decision cache for an authorization service.
- A first-tier shield in front of an expensive ML inference endpoint.

---

## Further Reading

- The package documentation: https://pkg.go.dev/golang.org/x/sync/singleflight.
- The original blog post by Brad Fitzpatrick about `groupcache` and request deduplication.
- The "Caching at Netflix" talks for production-scale cache patterns.
- The Wikipedia article on "cache stampede" for context across languages and stacks.

---

## Related Topics

- [errgroup](../01-errgroup/) — concurrency coordination with error propagation.
- [semaphore](../02-semaphore/) — bounding concurrency.
- [sync.Map](../../03-sync-package/06-map/) — the long-term store you usually pair with singleflight.
- [Context](../../../04-context/) — for cancellation around `DoChan`.
- [Future / Promise](../../05-concurrency-patterns/05-future-promise/) — for the more general "deferred value" pattern.

---

## Diagrams and Visual Aids

### Cache stampede (no singleflight)

```
time ─────────────────────────────────────►
                cache miss
                  │
caller A ─────────┼───[DB query]───────►
caller B ─────────┼───[DB query]───────►
caller C ─────────┼───[DB query]───────►
caller D ─────────┼───[DB query]───────►
                  │
                  └─ All four miss simultaneously.
                     Database handles four identical queries.
```

### Cache stampede (with singleflight)

```
time ─────────────────────────────────────►
                cache miss
                  │
caller A ─────────┼───[DB query]──────────►
caller B ─────────┼───[wait]──────────────►
caller C ─────────┼───[wait]──────────────►
caller D ─────────┼───[wait]──────────────►
                  │
                  └─ Only A queries the DB.
                     B, C, D receive A's result.
```

### Lifecycle of a `call` record

```
   ┌─────────────────────────────────────────┐
   │   Group.m[key] = nil (no in-flight)     │
   └──────────────────┬──────────────────────┘
                      │ first caller arrives
                      ▼
   ┌─────────────────────────────────────────┐
   │   Group.m[key] = &call{wg: 1}           │
   │   loader running                        │
   └──────────────────┬──────────────────────┘
                      │ late caller arrives
                      ▼
   ┌─────────────────────────────────────────┐
   │   call.dups++; caller blocks on wg      │
   └──────────────────┬──────────────────────┘
                      │ loader returns
                      ▼
   ┌─────────────────────────────────────────┐
   │   wg.Done; result stored on call        │
   │   delete(Group.m, key)                  │
   │   all waiters receive result            │
   └─────────────────────────────────────────┘
```

---

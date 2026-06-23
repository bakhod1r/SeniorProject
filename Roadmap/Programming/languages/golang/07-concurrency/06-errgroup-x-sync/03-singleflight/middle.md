# singleflight — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [`DoChan` in Depth](#dochan-in-depth)
3. [`Forget` and When It Actually Helps](#forget-and-when-it-actually-helps)
4. [Error Coalescing: The Right Mental Model](#error-coalescing-the-right-mental-model)
5. [Negative Caching vs Singleflight Errors](#negative-caching-vs-singleflight-errors)
6. [TTL Cache + Singleflight Integration](#ttl-cache--singleflight-integration)
7. [Panic Propagation and Recovery](#panic-propagation-and-recovery)
8. [Context Threading Through the Loader](#context-threading-through-the-loader)
9. [Generic Wrappers](#generic-wrappers)
10. [Per-Key vs Shared Groups](#per-key-vs-shared-groups)
11. [Metrics and Observability](#metrics-and-observability)
12. [Testing Singleflight Code](#testing-singleflight-code)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

At the junior level you learned the basic shape of `Group.Do`, the cache-stampede problem it solves, and the rule that singleflight is not a cache. At middle level we deepen the tool:

- The channel-returning variant `DoChan` and how to combine it with `context.Context`.
- The semantics of `Forget` and the small number of cases where it actually matters.
- Error coalescing — what it means in production and how to design around it.
- The standard production pattern: a TTL cache wrapped in a singleflight loader.
- Panic recovery, both inside the loader and at the call site.
- A generic, type-safe wrapper that hides `interface{}` from callers.
- Observability: counting coalesced calls, shared returns, and loader durations.
- Testing strategies that prove your loader is actually called once under bursts.

After this file you should be able to design a loader layer for a real service, sized for a few thousand requests per second, and explain to a colleague exactly why each line of code is there.

---

## `DoChan` in Depth

The blocking `Do` is the right choice 90% of the time. `DoChan` exists for the cases where you need to select on the result alongside another channel — usually a context's `Done()`.

Signature:

```go
func (g *Group) DoChan(key string, fn func() (interface{}, error)) <-chan Result

type Result struct {
    Val    interface{}
    Err    error
    Shared bool
}
```

The returned channel has capacity 1 (so the loader goroutine can send without blocking) and is closed after the single send. You can read it once.

### Use case: caller-side timeout

```go
func GetUserCtx(ctx context.Context, id string) (*User, error) {
    ch := g.DoChan(id, func() (interface{}, error) {
        return db.QueryUser(ctx, id)
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

This lets the caller abandon the wait at any time. Important: **the loader continues running** even after the caller bails. Singleflight has no way to cancel a started loader from outside.

### What "continues running" actually means

The loader function executes on its own goroutine. When that goroutine finishes, it writes the result to the channel, marks the call done in the internal map, and exits. If you walk away early, the channel is still written to — but nobody reads it. The buffered slot holds the value until the channel is garbage-collected. No goroutine leak, no panic.

If the loader is the only consumer of an outbound resource (a DB connection, an HTTP client), abandoning the wait does *not* free that resource any sooner. The loader holds it until it returns.

### When `DoChan` is wrong

If you do not need to select on another channel, prefer `Do`. The blocking call is simpler, allocates less, and produces clearer stack traces. `DoChan` is a tool for one specific scenario.

---

## `Forget` and When It Actually Helps

`Forget(key)` removes the in-flight record for `key` from the group's internal map. After `Forget`, future callers will *not* coalesce with the still-running loader; they start a fresh round.

What `Forget` does *not* do:

- It does not cancel the running loader.
- It does not affect callers who are already waiting on the old call (they still receive its result).
- It does not affect anything if no call is in flight for `key`.

### Use case 1: Sticky-error mitigation

Imagine a loader that has been running for 5 seconds and is about to return an error. Callers who arrive in those 5 seconds will all receive that error. If you suspect the loader is going to fail and you want new arrivals to try again with a fresh execution rather than waiting for the failure, call `Forget(key)` from another goroutine.

This is rarely the right tool — usually you wait for the failure and let the next round retry. But for very long-running loaders with high error correlation, it can help.

### Use case 2: Forced refresh

You have just observed an external invalidation event (a webhook, a pub/sub message). Any in-flight loader is now loading stale data. Call `Forget(key)`. The current loader will finish and serve its waiters with stale data, but the *next* caller starts a fresh load.

```go
func OnInvalidate(key string) {
    cache.Delete(key)
    g.Forget(key) // do not coalesce future callers with the in-flight stale load
}
```

### Common misuse

```go
// WRONG: g.Forget(key) after Do returns is a no-op.
v, err, _ := g.Do(key, loader)
g.Forget(key) // pointless; Do already removed the entry
```

`Do` cleans up its own entry as part of finishing. `Forget` after `Do` returns is wasted work.

---

## Error Coalescing: The Right Mental Model

The rule:

> While a loader is in flight, every concurrent caller that arrives shares the loader's *eventual* result — including its error.

This is intentional. The whole point of singleflight is "one call serves N callers." Specialising for error vs success would defeat the purpose. The package gives you the same fate, and it is your job to decide whether that fate should be reused.

### Three classes of error

1. **Permanent errors.** The resource does not exist (404), the input is malformed (400), authorization denied (403). Coalescing is fine — all callers should see the same answer.

2. **Transient errors.** Network timeout, connection reset, upstream 503, database overload. Coalescing is technically harmless — every caller sees the timeout — but it wastes the *next* round's chance to retry until the in-flight one fails.

3. **Bug errors.** Nil pointer, type assertion failure, panic-caught-as-error. Coalescing propagates the bug to N callers at once. You wanted to see one stack trace; you got N.

### Designing for retry

If your loader is expected to encounter transient failures, design the caller for retry:

```go
func LoadWithRetry(ctx context.Context, key string) (*User, error) {
    var lastErr error
    for attempt := 0; attempt < 3; attempt++ {
        v, err, _ := g.Do(key, loader)
        if err == nil {
            return v.(*User), nil
        }
        if !isTransient(err) {
            return nil, err
        }
        lastErr = err
        select {
        case <-time.After(backoff(attempt)):
        case <-ctx.Done():
            return nil, ctx.Err()
        }
    }
    return nil, fmt.Errorf("retries exhausted: %w", lastErr)
}
```

Each retry iteration starts a fresh `Do` round because the previous one has finished. Concurrent callers join the retries in their own loops, so each "attempt" of the loader serves its own batch.

This is the standard pattern. Notice that singleflight handles concurrency; retry handles temporal flakiness. They do different jobs.

---

## Negative Caching vs Singleflight Errors

A subtle question: should you cache an error result?

- **Yes** if the error is permanent. "User 999 does not exist." A 404 from the database. Cache it briefly (say, 30 seconds) so a malicious caller cannot trigger one query per request.
- **No** if the error is transient. "Database is overloaded." Caching that locks you out of recovery.

Negative caching is the *cache's* concern, not singleflight's. Singleflight only deduplicates the in-flight window. A typical pattern:

```go
type Entry struct {
    Val *User
    Err error // nil for normal success
    Expires time.Time
}

func GetUser(ctx context.Context, id string) (*User, error) {
    if e, ok := cache.Get(id); ok && time.Now().Before(e.Expires) {
        return e.Val, e.Err
    }
    v, err, _ := g.Do(id, func() (interface{}, error) {
        u, err := db.QueryUser(ctx, id)
        if err == nil {
            cache.Set(id, Entry{Val: u, Expires: time.Now().Add(5 * time.Minute)})
            return u, nil
        }
        if isPermanent(err) {
            cache.Set(id, Entry{Err: err, Expires: time.Now().Add(30 * time.Second)})
        }
        return nil, err
    })
    if err != nil {
        return nil, err
    }
    return v.(*User), nil
}
```

Note: we cache permanent errors with a *shorter* TTL than successes. This is so that, if our classifier was wrong (the error was actually transient), we recover within seconds.

---

## TTL Cache + Singleflight Integration

The combination is so standard it deserves a name: **the loader pattern**.

```go
type Loader[K comparable, V any] struct {
    mu    sync.RWMutex
    cache map[K]ttlEntry[V]
    ttl   time.Duration
    g     singleflight.Group
    load  func(context.Context, K) (V, error)
}

type ttlEntry[V any] struct {
    val V
    exp time.Time
}

func (l *Loader[K, V]) Get(ctx context.Context, key K) (V, error) {
    l.mu.RLock()
    e, ok := l.cache[key]
    l.mu.RUnlock()
    if ok && time.Now().Before(e.exp) {
        return e.val, nil
    }

    keyStr := fmt.Sprint(key) // stringify for singleflight
    v, err, _ := l.g.Do(keyStr, func() (interface{}, error) {
        // Re-check inside the loader: another caller may have populated
        // while we were waiting on the singleflight mutex.
        l.mu.RLock()
        e, ok := l.cache[key]
        l.mu.RUnlock()
        if ok && time.Now().Before(e.exp) {
            return e.val, nil
        }
        v, err := l.load(ctx, key)
        if err != nil {
            return *new(V), err
        }
        l.mu.Lock()
        l.cache[key] = ttlEntry[V]{val: v, exp: time.Now().Add(l.ttl)}
        l.mu.Unlock()
        return v, nil
    })
    if err != nil {
        return *new(V), err
    }
    return v.(V), nil
}
```

Three properties make this design sound:

1. **Double-check inside the loader.** Between the outer cache check and the singleflight entry, another goroutine may have populated. The inner re-check avoids unnecessary loads.
2. **Stringify keys for singleflight.** The map can use the comparable native key; singleflight wants a string.
3. **Generic over K and V.** Each instance of `Loader[K, V]` has its own group, its own cache, its own loader function. No `interface{}` leaks to callers.

---

## Panic Propagation and Recovery

Default behaviour: if the loader panics, the panic propagates to *every waiter*. This is dangerous because a single bad input can take down many request handlers simultaneously.

Modern versions of `x/sync/singleflight` catch `runtime.Goexit` from the loader and convert it to a panic at the call site, and catch a regular panic and re-panic at the call site. The packaged behaviour has been refined over the years; do not rely on the exact details.

### Defensive recover in the loader

Always:

```go
v, err, _ := g.Do(key, func() (v interface{}, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("loader panicked: %v\n%s", r, debug.Stack())
        }
    }()
    return doWork(key)
})
```

This converts panics to errors. The N waiters get a real error, not N panicking goroutines.

### When recovery is wrong

If the panic is a logic bug — nil dereference, out-of-bounds — you may actually want the program to crash so you find the bug in development. In production, prefer the recover.

A pragmatic rule: recover in production loaders, leave panics uncovered in unit tests, surface the converted error to a metric (`loader_panic_total`) so you see it.

---

## Context Threading Through the Loader

The standard library's `Group.Do` does not take a context. The loader you pass in is `func() (interface{}, error)` — no context parameter. So how do you pass a context to the loader?

**Capture it in a closure.** The context that flows in is the *first caller's* context:

```go
func GetUser(ctx context.Context, id string) (*User, error) {
    v, err, _ := g.Do(id, func() (interface{}, error) {
        // ctx is captured from the first caller.
        return db.QueryUser(ctx, id)
    })
    if err != nil {
        return nil, err
    }
    return v.(*User), nil
}
```

This works, but has a subtle issue: if the first caller cancels its context, the loader is using a cancelled context. Later callers, who joined the same in-flight call, suddenly find their request failing because the *first* caller went away.

### Two mitigation strategies

1. **Use `context.WithoutCancel` (Go 1.21+) inside the loader.** Detach the loader's work from any single caller's cancellation:

   ```go
   v, err, _ := g.Do(id, func() (interface{}, error) {
       loadCtx := context.WithoutCancel(ctx)
       return db.QueryUser(loadCtx, id)
   })
   ```

   The loader now runs with the *values* of the first caller's context but with no cancellation. Late arrivals are protected from the first caller's hang-up.

2. **Build a merged context** that cancels only when *every* current caller has cancelled. This is heavier and rarely used.

A blunt rule of thumb: if your loader is short (under 200ms) and your callers all share a sensible upstream context (the HTTP request), capturing is fine. If your loader is long and callers come from many sources, detach with `WithoutCancel`.

---

## Generic Wrappers

`interface{}` plumbing is ugly. Generics (Go 1.18+) make it disappear.

```go
type Group[T any] struct {
    g singleflight.Group
}

func (g *Group[T]) Do(key string, fn func() (T, error)) (T, error, bool) {
    v, err, shared := g.g.Do(key, func() (interface{}, error) {
        return fn()
    })
    if err != nil {
        var zero T
        return zero, err, shared
    }
    return v.(T), nil, shared
}
```

Now callers see a typed API:

```go
var userGroup Group[*User]
u, err, _ := userGroup.Do("user:42", func() (*User, error) {
    return db.QueryUser(42)
})
```

No type assertion. No `interface{}`. The generic wrapper compiles to the same machine code as the underlying call.

A `DoChan` variant is a straightforward exercise — wrap the underlying channel of `Result` into a `chan Result[T]`.

---

## Per-Key vs Shared Groups

A `Group` holds one internal mutex. Heavy traffic on one group can become contended.

Two design choices:

1. **One group per resource type.** `userGroup`, `productGroup`, `policyGroup`. Sensible default. Each group has its own mutex; key namespaces are isolated.

2. **Sharded groups.** If a single group is hot enough that the internal mutex shows up in profiles, partition by hash of key into N groups:

   ```go
   type ShardedGroup struct {
       shards [256]singleflight.Group
   }

   func (s *ShardedGroup) Do(key string, fn func() (interface{}, error)) (interface{}, error, bool) {
       h := xxhash.Sum64String(key)
       return s.shards[h%256].Do(key, fn)
   }
   ```

   Now contention is divided by 256.

In practice, the internal mutex of a single `Group` is rarely the bottleneck. The loader function is. Only consider sharding after measurement.

---

## Metrics and Observability

Three signals are worth recording:

1. **`loader_total{key_class}`.** Count every call to `Do`. Bucket by a coarse key class (`"user"`, `"product"`).
2. **`loader_coalesced_total{key_class}`.** Increment when `shared == true`. Ratio coalesced/total tells you how effective singleflight is.
3. **`loader_duration_seconds{key_class, outcome}`.** Histogram of loader durations, partitioned by success/failure.

```go
v, err, shared := g.Do(key, loader)
metrics.LoaderTotal.WithLabelValues(class).Inc()
if shared {
    metrics.LoaderCoalesced.WithLabelValues(class).Inc()
}
metrics.LoaderDuration.WithLabelValues(class, outcome(err)).Observe(elapsed.Seconds())
```

In a healthy service, `loader_coalesced_total / loader_total` is small in steady state and spikes during cache misses. If it is large in steady state, your cache is not doing its job.

---

## Testing Singleflight Code

Three tests every loader should have:

### Test 1: Coalescing under burst

```go
func TestLoaderCoalesces(t *testing.T) {
    var calls int32
    loader := func() (*User, error) {
        atomic.AddInt32(&calls, 1)
        time.Sleep(50 * time.Millisecond)
        return &User{ID: 42}, nil
    }
    l := NewLoader(loader)
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); l.Get(context.Background(), 42) }()
    }
    wg.Wait()
    if atomic.LoadInt32(&calls) != 1 {
        t.Fatalf("expected 1 loader call, got %d", calls)
    }
}
```

### Test 2: Error is returned to all waiters

```go
func TestErrorIsCoalesced(t *testing.T) {
    boom := errors.New("boom")
    loader := func() (*User, error) {
        time.Sleep(10 * time.Millisecond)
        return nil, boom
    }
    l := NewLoader(loader)
    var wg sync.WaitGroup
    var got int32
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            _, err := l.Get(context.Background(), 42)
            if errors.Is(err, boom) {
                atomic.AddInt32(&got, 1)
            }
        }()
    }
    wg.Wait()
    if got != 10 {
        t.Fatalf("expected all 10 waiters to receive boom, got %d", got)
    }
}
```

### Test 3: After error, next caller starts fresh

```go
func TestRetryAfterError(t *testing.T) {
    var calls int32
    loader := func() (*User, error) {
        n := atomic.AddInt32(&calls, 1)
        if n == 1 {
            return nil, errors.New("first fails")
        }
        return &User{ID: 42}, nil
    }
    l := NewLoader(loader)
    if _, err := l.Get(context.Background(), 42); err == nil {
        t.Fatal("expected first call to fail")
    }
    if u, err := l.Get(context.Background(), 42); err != nil || u.ID != 42 {
        t.Fatalf("expected second call to succeed, got %v %v", u, err)
    }
}
```

These three together cover the major behaviours: deduplication, error sharing, and the lack of caching.

---

## Cheat Sheet

```
USE Do        when the caller has nothing else to wait for.
USE DoChan    when the caller must select on ctx.Done() too.
USE Forget    rarely; for forced refresh or sticky-error mitigation.

DETECT     stampede via spikes in upstream QPS after cache expiry.
MITIGATE   stampede with TTL cache + singleflight loader + jittered TTLs.

RECOVER panics in the loader. Convert to error. Surface via metric.

DETACH long-running loaders from caller cancellation via
       context.WithoutCancel(ctx) inside the loader.

NEGATIVE-CACHE permanent errors with short TTL.
DO NOT cache transient errors.

OBSERVE total / coalesced / duration. Coalesce ratio in steady state should be low.

GENERIC wrapper hides interface{} from callers.
```

---

## Summary

The middle-level toolkit for singleflight is six ideas:

1. `DoChan` plus `select` for cancellation around the wait.
2. `Forget` for the rare "throw away the in-flight call" case.
3. Conscious design around error coalescing — retry at the caller level.
4. TTL cache + singleflight loader as the canonical production shape.
5. Panic recovery inside the loader, plus a metric to spot bugs.
6. Generic wrappers that hide `interface{}` and produce a typed API.

With those six, you can build a production-grade loader for any expensive operation in a Go service. The senior level adds judgement: when *not* to use singleflight, comparison with related primitives, and the real-world systems that rely on it.

---

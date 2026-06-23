---
layout: default
title: Middle
parent: Exponential Backoff
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/04-exponential-backoff/middle/
---

# Exponential Backoff — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The Thundering Herd Problem](#the-thundering-herd-problem)
5. [The Three Jitter Strategies](#the-three-jitter-strategies)
6. [Full Jitter](#full-jitter)
7. [Equal Jitter](#equal-jitter)
8. [Decorrelated Jitter](#decorrelated-jitter)
9. [Choosing Among the Three](#choosing-among-the-three)
10. [Implementation in Go](#implementation-in-go)
11. [Math/Rand vs Crypto/Rand](#mathrand-vs-cryptorand)
12. [Sharing a Random Source Safely](#sharing-a-random-source-safely)
13. [Context Cancellation](#context-cancellation)
14. [Context-Aware Sleep](#context-aware-sleep)
15. [Deadline Propagation](#deadline-propagation)
16. [The Retry Budget Idea](#the-retry-budget-idea)
17. [Token Bucket as a Retry Budget](#token-bucket-as-a-retry-budget)
18. [Composable Policies](#composable-policies)
19. [Mental Models](#mental-models)
20. [Real-World Analogies](#real-world-analogies)
21. [Pros and Cons of Jitter](#pros-and-cons-of-jitter)
22. [Use Cases](#use-cases)
23. [Code Examples](#code-examples)
24. [Coding Patterns](#coding-patterns)
25. [Clean Code](#clean-code)
26. [Error Handling](#error-handling)
27. [Performance Tips](#performance-tips)
28. [Best Practices](#best-practices)
29. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
30. [Common Mistakes](#common-mistakes)
31. [Common Misconceptions](#common-misconceptions)
32. [Tricky Points](#tricky-points)
33. [Test](#test)
34. [Tricky Questions](#tricky-questions)
35. [Cheat Sheet](#cheat-sheet)
36. [Self-Assessment Checklist](#self-assessment-checklist)
37. [Summary](#summary)
38. [What You Can Build](#what-you-can-build)
39. [Further Reading](#further-reading)
40. [Related Topics](#related-topics)
41. [Diagrams and Visual Aids](#diagrams-and-visual-aids)

---

## Introduction
> Focus: "Why must I randomise the delays? How do I cancel a retry mid-sleep? What is a retry budget and why do I need one?"

At the junior level you wrote a working retry loop with a doubling delay. It is correct enough for low-volume code. At any meaningful scale it has three serious problems that this file addresses:

1. **All your clients retry in lockstep.** When a service has a 200-ms blip, ten thousand clients each see the failure at roughly the same instant and each schedule a retry exactly 100 ms later. The recovering service is then hit by a synchronised pulse of ten thousand requests. This is the *thundering herd*, and exponential backoff alone does *not* prevent it. The fix is **jitter** — random variation of the delay so the retries spread out.
2. **Sleeping cannot be cancelled.** Your user clicked "cancel" while you are inside `time.Sleep(5 * time.Second)`. The user gets to wait another 4.7 seconds for nothing. Worse, if the request handler is itself bounded by a deadline, your retry loop may exceed it. The fix is a **context-aware sleep** that wakes early when `ctx.Done()` fires.
3. **There is no system-wide cap on retry traffic.** Each individual loop is bounded by `maxAttempts`, but if a million users all hit a failure at once, you produce a million retries. The fix is a **retry budget**: a system-wide token bucket that throttles the total retry rate.

This file gives you all three. By the end you will have a context-aware, jittered, budgeted retry helper that is suitable for moderate production use. The senior file goes deeper into the math and architecture; the professional file takes it to integration with real libraries and observability.

After reading this file you will:

- Understand the thundering-herd failure mode and why it kills services that pure-exponential clients use.
- Know the three jitter strategies — full, equal, decorrelated — and when to use each.
- Be able to implement each in Go from memory.
- Know the difference between `math/rand` and `crypto/rand` for jitter (spoiler: use `math/rand`, but be careful about seeding and sharing).
- Be able to write a retry loop that wakes early on context cancellation.
- Understand deadline propagation: a 5-second deadline at the top means at most 5 seconds across all retries.
- Know what a retry budget is and how to implement it with `golang.org/x/time/rate`.
- Be able to compose policies — a `JitteredPolicy` wrapping a `BasePolicy` wrapping a `ContextPolicy`.

You do not need to know about distributed tracing, gRPC interceptors, or circuit breakers yet. Those are the professional level.

---

## Prerequisites

- **Required:** Comfort with the junior file. You should be able to write a retry helper in 5 minutes.
- **Required:** Familiarity with `context.Context`: `context.Background`, `context.WithCancel`, `context.WithTimeout`, `<-ctx.Done()`, `ctx.Err()`.
- **Required:** Familiarity with `select` over channels.
- **Required:** Knowledge of `math/rand` basics: `rand.Float64`, `rand.Intn`, `rand.New(rand.NewSource(seed))`.
- **Helpful:** Familiarity with the `golang.org/x/time/rate` token-bucket limiter, or willingness to read a small bit of its API.
- **Helpful:** Some exposure to `sync.Mutex` and the idea that `math/rand`'s global functions are *not* safe for concurrent use without locking (until Go 1.20+, anyway — we discuss this).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Jitter** | Random variation added to a backoff delay. Without jitter, many clients retry simultaneously. With jitter, retries spread out across time. |
| **Full jitter** | The delay is drawn uniformly from `[0, exponential_cap)`. The expected delay is half the exponential value. |
| **Equal jitter** | The delay is `half_exponential + random(0, half_exponential)`. The expected delay equals the exponential. |
| **Decorrelated jitter** | The delay is `random(base, prev*3)`, capped at `maxDelay`. Each delay depends on the previous one rather than the attempt number. |
| **Thundering herd** | A failure mode where many clients retry simultaneously after a brief outage, overwhelming the recovering service. |
| **Retry storm** | The cascading version: A retries B, B retries C, C retries D — failure at D causes 27 retries upstream. |
| **Retry budget** | A system-wide limit on the rate or count of retries, separate from per-call attempt caps. |
| **Token bucket** | A rate-limiting algorithm: tokens accumulate at a configurable rate; each operation consumes one token; if the bucket is empty, the operation is denied. |
| **Deadline** | An absolute time after which an operation must give up. Propagated via `context.WithDeadline`. |
| **Deadline propagation** | The practice of passing the deadline through to downstream calls so they do not waste time after the parent has given up. |
| **Context-aware sleep** | A sleep that wakes early if `ctx.Done()` is closed. Implemented with `select` over `time.After` and `ctx.Done()`, or `time.NewTimer`. |
| **`rand.Rand`** | A non-thread-safe random source. A `*rand.Rand` wrapping a `rand.Source` can be created per goroutine to avoid lock contention. |
| **`rand.Source` (locked)** | The global `math/rand` source is safe for concurrent use in Go 1.20+. Before that, it required external locking. |

---

## The Thundering Herd Problem

Imagine you run a popular API with 100,000 active clients. Each client calls your API once a second. Most calls succeed.

One day, your database fails over. For 2 seconds, the API returns `503 Service Unavailable`. Every client sees the failure. Every client implements exponential backoff with no jitter: `delay = 100ms * 2^attempt`.

What happens?

| t (s) | event |
|-------|-------|
| 0.0   | 200,000 requests per second (normal load) |
| 0.5   | database starts failing over; API returns 503 |
| 2.5   | database back; API returns 200 |
| 0.6   | 100,000 clients see 503; each schedules retry for t+100ms |
| 0.7   | 100,000 retries fire; all 503; schedule retry for t+200ms |
| 0.9   | 100,000 retries fire; all 503; schedule retry for t+400ms |
| 1.3   | 100,000 retries fire; all 503; schedule retry for t+800ms |
| 2.1   | 100,000 retries fire; all 503; schedule retry for t+1600ms |
| 2.5   | database back |
| 3.7   | **100,000 simultaneous retries hit a just-recovered service** |

The recovering database — which has cold caches, an empty query plan cache, and a barely-warmed connection pool — receives a synchronised pulse of 100,000 retries at t=3.7. That is a *spike*, not a steady load. The service, which could normally handle 200k req/s of steady traffic, falls over because the spike exceeds the burst capacity.

Now the service is broken again. Every client schedules another retry. The cycle repeats. This is the *retry storm* form of thundering herd.

Exponential backoff did not prevent it. Why? *Because all the clients still synchronised their retries.* Doubling the delay shifts the spike to later, but does not spread it across time.

**Jitter is the antidote.** If each client adds a random amount to its delay, the spike becomes a *plateau* — the same number of retries spread over a window of time. The recovering service sees a gentle ramp rather than a cliff.

The picture:

```
Without jitter:        With jitter:
                       
   |  |                  ___________
   |  |   ←  spike  →   /           \   ← plateau →
   |  |                /             \
   |  |               /               \
___|__|___           /_________________\___
```

Same total number of retries; very different load profile.

---

## The Three Jitter Strategies

There are three well-known jitter strategies, named in a 2015 AWS Architecture Blog post by Marc Brooker. All three have been studied empirically and are used in production at AWS, Google, Stripe, and elsewhere.

1. **Full jitter** — `delay = uniform(0, cap)`, where `cap = min(maxDelay, base * 2^attempt)`.
2. **Equal jitter** — `delay = cap/2 + uniform(0, cap/2)`.
3. **Decorrelated jitter** — `delay = min(maxDelay, uniform(base, prev * 3))`, where `prev` is the previous delay.

The AWS post showed that all three are better than no jitter, and that *full jitter* is best in most cases — both for total time to completion and for load on the failing service. Decorrelated jitter is the second-best and has the property that consecutive delays are less correlated, which can be useful in pathological cases.

We discuss each in detail.

---

## Full Jitter

```
delay = uniform(0, min(maxDelay, base * 2^attempt))
```

The "cap" is the exponentially-growing value, but the actual delay is drawn uniformly from `[0, cap)`. So early delays are short on average, late delays are longer on average, but each delay could be anywhere in the range.

### Example

`base = 100ms`, `maxDelay = 30s`:

| attempt | exp_cap | sample delays (5 draws) |
|---------|---------|--------------------------|
| 0       | 100ms   | 23, 71, 12, 88, 45 ms    |
| 1       | 200ms   | 156, 8, 89, 134, 192 ms  |
| 2       | 400ms   | 312, 27, 198, 88, 350 ms |
| 3       | 800ms   | 600, 100, 423, 222, 711 ms |

Expected delay at attempt n is `min(maxDelay, base * 2^n) / 2`. That is half the no-jitter value. Concretely, the *average* total wait is half what no-jitter would produce — and that is a feature, not a bug. The randomness gives some clients short delays (good for fast recovery) and some clients long delays (good for spreading load).

### Implementation

```go
func fullJitter(attempt int, base, maxDelay time.Duration, r *rand.Rand) time.Duration {
    cap := base * time.Duration(1<<attempt)
    if cap > maxDelay || cap < 0 {
        cap = maxDelay
    }
    return time.Duration(r.Int63n(int64(cap)))
}
```

`r.Int63n(n)` returns a uniformly distributed integer in `[0, n)`. We cast to `time.Duration`.

If `cap` is zero — e.g. `base = 0` — `r.Int63n` panics. Guard with `if cap <= 0 { return 0 }`.

### Properties

- *Expected delay:* `cap / 2`.
- *Variance:* `cap² / 12` (the variance of a uniform distribution on `[0, cap]`).
- *Worst case:* `cap`.
- *Best case:* 0 (a client may retry immediately).

The "best case" is sometimes surprising. A client could draw a delay of 0 ns and retry instantly. This is fine — it does not produce a herd because *other* clients drew larger delays.

### Why this is the AWS recommendation

The AWS blog tested all three strategies in a simulation of 100 clients retrying against a single bottleneck server. Full jitter produced:

- The shortest total time to complete all client requests.
- The most uniform load on the server during recovery.
- The smallest standard deviation of completion times across clients.

The reason is intuitive: full jitter has the highest variance, so client retries are most spread out. A high-variance distribution covers the recovery window most uniformly.

For the vast majority of cases, full jitter is the right default.

---

## Equal Jitter

```
delay = cap/2 + uniform(0, cap/2)
```

Half-exponential plus half-uniform. The delay is always between `cap/2` and `cap`. Compared to full jitter, equal jitter has lower variance.

### Example

`base = 100ms`, attempt 3, `cap = 800ms`. Equal jitter draws delays from `[400, 800]ms`. Full jitter draws from `[0, 800]ms`. Equal jitter is "guaranteed to wait at least half the exponential", which makes it more polite to the failing service in the short term.

### Implementation

```go
func equalJitter(attempt int, base, maxDelay time.Duration, r *rand.Rand) time.Duration {
    cap := base * time.Duration(1<<attempt)
    if cap > maxDelay || cap < 0 {
        cap = maxDelay
    }
    half := cap / 2
    return half + time.Duration(r.Int63n(int64(half)))
}
```

### When to use equal jitter

If you specifically want to avoid the "client retries immediately after a 503" case — for example, if your service tracks retries by client and penalises clients who retry too aggressively — equal jitter guarantees at least `cap/2` wait. Full jitter could draw a 0 ms wait.

Otherwise full jitter is preferable.

---

## Decorrelated Jitter

```
delay = min(maxDelay, uniform(base, prev * 3))
```

Where `prev` is the delay used in the previous retry (initially `base`).

Unlike full and equal jitter, decorrelated jitter does not directly depend on `attempt`. It evolves: each delay is sampled from a window that grows based on the previous delay.

### Walk-through

`base = 100ms`, `maxDelay = 30s`. Starting `prev = base = 100ms`.

- Attempt 0: range is `[100ms, 300ms]`. Sample 200ms. `prev = 200ms`.
- Attempt 1: range is `[100ms, 600ms]`. Sample 350ms. `prev = 350ms`.
- Attempt 2: range is `[100ms, 1050ms]`. Sample 700ms. `prev = 700ms`.
- Attempt 3: range is `[100ms, 2100ms]`. Sample 1500ms. `prev = 1500ms`.
- Attempt 4: range is `[100ms, 4500ms]`. Sample 3200ms. `prev = 3200ms`.
- Attempt 5: range is `[100ms, 9600ms]`. Sample 7500ms. `prev = 7500ms`.

The delay grows on average like a power law, but each individual delay is uniformly distributed over a window. The growth factor is `3`, which gives roughly the same expected growth as a `factor = 2` no-jitter exponential (because the expected value of `uniform(a, b)` is `(a+b)/2`).

### Implementation

```go
type DecorrelatedJitter struct {
    Base     time.Duration
    MaxDelay time.Duration
    Prev     time.Duration
    Rand     *rand.Rand
}

func (d *DecorrelatedJitter) Next() time.Duration {
    if d.Prev == 0 {
        d.Prev = d.Base
    }
    upper := d.Prev * 3
    if upper > d.MaxDelay || upper < 0 {
        upper = d.MaxDelay
    }
    span := upper - d.Base
    if span <= 0 {
        d.Prev = d.Base
        return d.Base
    }
    delay := d.Base + time.Duration(d.Rand.Int63n(int64(span)))
    d.Prev = delay
    return delay
}
```

Note that the function is *stateful* — it needs `Prev` between calls. This is the main reason decorrelated jitter is less commonly used; it requires a struct rather than a pure function.

### Why "decorrelated"?

With full or equal jitter, the *expected* delay at attempt N+1 is fixed (it depends only on N). So if you look at the sequence of delays across many retries, they have a strong "growing on average" pattern.

With decorrelated jitter, each delay depends on the previous random value. The sequence is *less correlated with attempt number*. This can be useful in scenarios where you want to avoid any predictable schedule that an attacker could exploit — but those scenarios are rare.

Empirically, the AWS blog showed that decorrelated jitter performs almost as well as full jitter for thundering-herd mitigation, and better in some pathological cases. It is a reasonable choice, but slightly more complex to implement.

---

## Choosing Among the Three

**Default:** full jitter. Use this unless you have a specific reason not to.

**Use equal jitter when:**
- You want a guaranteed minimum delay between retries (e.g. to comply with a rate-limit contract).
- Your monitoring is easier to interpret with predictable lower-bounds on delays.

**Use decorrelated jitter when:**
- You need the lowest possible correlation between successive delays.
- You are implementing a specific algorithm (some AWS SDKs use decorrelated jitter internally).

**Avoid no-jitter:**
- Always. The thundering-herd risk is too high for any non-trivial system.

The AWS blog post's overall recommendation, repeated by many large-scale engineering teams: *if in doubt, use full jitter.*

---

## Implementation in Go

A clean, composable implementation of all three:

```go
package backoff

import (
	"math/rand"
	"sync"
	"time"
)

// Jitterer computes a single delay for a given attempt.
type Jitterer interface {
    Delay(attempt int) time.Duration
}

type FullJitter struct {
    Base     time.Duration
    MaxDelay time.Duration
    r        *rand.Rand
    mu       sync.Mutex
}

func (j *FullJitter) Delay(attempt int) time.Duration {
    cap := j.Base * time.Duration(1<<attempt)
    if cap > j.MaxDelay || cap < 0 {
        cap = j.MaxDelay
    }
    if cap <= 0 {
        return 0
    }
    j.mu.Lock()
    defer j.mu.Unlock()
    return time.Duration(j.r.Int63n(int64(cap)))
}

type EqualJitter struct {
    Base     time.Duration
    MaxDelay time.Duration
    r        *rand.Rand
    mu       sync.Mutex
}

func (j *EqualJitter) Delay(attempt int) time.Duration {
    cap := j.Base * time.Duration(1<<attempt)
    if cap > j.MaxDelay || cap < 0 {
        cap = j.MaxDelay
    }
    half := cap / 2
    if half <= 0 {
        return 0
    }
    j.mu.Lock()
    defer j.mu.Unlock()
    return half + time.Duration(j.r.Int63n(int64(half)))
}

type DecorrelatedJitter struct {
    Base     time.Duration
    MaxDelay time.Duration
    r        *rand.Rand
    mu       sync.Mutex
    prev     time.Duration
}

func (j *DecorrelatedJitter) Delay(_ int) time.Duration {
    j.mu.Lock()
    defer j.mu.Unlock()
    if j.prev == 0 {
        j.prev = j.Base
    }
    upper := j.prev * 3
    if upper > j.MaxDelay || upper < 0 {
        upper = j.MaxDelay
    }
    span := upper - j.Base
    if span <= 0 {
        j.prev = j.Base
        return j.Base
    }
    delay := j.Base + time.Duration(j.r.Int63n(int64(span)))
    j.prev = delay
    return delay
}

// New returns a Jitterer of the given strategy, sharing a *rand.Rand.
func New(strategy string, base, maxDelay time.Duration, r *rand.Rand) Jitterer {
    switch strategy {
    case "full":
        return &FullJitter{Base: base, MaxDelay: maxDelay, r: r}
    case "equal":
        return &EqualJitter{Base: base, MaxDelay: maxDelay, r: r}
    case "decorrelated":
        return &DecorrelatedJitter{Base: base, MaxDelay: maxDelay, r: r}
    }
    return &FullJitter{Base: base, MaxDelay: maxDelay, r: r}
}
```

Notice the mutex per jitterer. `rand.Rand` is *not* safe for concurrent use; each call to `Int63n` mutates the source's internal state. We discuss the trade-offs of locking next.

---

## Math/Rand vs Crypto/Rand

For jitter, you want a pseudo-random number generator. Two choices in Go:

- `math/rand` — fast, deterministic given a seed, not cryptographically secure.
- `crypto/rand` — slow, cryptographically secure, uses the OS's entropy source.

For jitter, **use `math/rand`**. Reasons:

1. Jitter does not need cryptographic randomness. An attacker who can predict your jitter has bigger problems.
2. `math/rand` is ~50× faster than `crypto/rand`.
3. `math/rand` is deterministic, which makes tests reproducible.

The exception is when jitter is used in a security-sensitive context — e.g. timing-attack mitigation. There, `crypto/rand` makes sense.

### `math/rand/v2` (Go 1.22+)

Go 1.22 introduced `math/rand/v2` with a cleaner API and better default generator. The recommended idiom:

```go
import "math/rand/v2"

delay := rand.Int64N(int64(cap))
```

`rand/v2`'s top-level functions are safe for concurrent use without locking. The underlying generator is the PCG family, which is fast and high-quality. If you are on Go 1.22+, prefer `math/rand/v2` for new code.

For Go 1.20-1.21, the global `math/rand` is also concurrent-safe, but the API is older. Either is fine.

For Go 1.19 and earlier, the global `math/rand` was *not* concurrent-safe, and you had to lock or use `rand.New(rand.NewSource(...))` per goroutine. Most of the patterns in this section accommodate the older convention because libraries you read may still use it.

### Seeding

In Go 1.20+, the global `math/rand` is auto-seeded with a random value at program start. You no longer need `rand.Seed(time.Now().UnixNano())`. The `rand.Seed` function is now deprecated.

If you use `rand.New(rand.NewSource(seed))`, choose a seed that varies per process: `time.Now().UnixNano()` is fine.

### A common gotcha

```go
// Before Go 1.20:
src := rand.NewSource(time.Now().UnixNano())
r := rand.New(src)
```

This is safe in *one* goroutine. If you share `r` across goroutines without locking, you get data races. In Go 1.20+ the global functions are concurrent-safe, but a `*rand.Rand` you create yourself with `rand.New` is *not*.

The lesson: either use the global `math/rand` (or `math/rand/v2`) functions, or wrap your `*rand.Rand` with a `sync.Mutex`.

---

## Sharing a Random Source Safely

If you have many goroutines doing jittered retries, they all need random numbers. Three strategies:

### Strategy 1: global `rand` (Go 1.20+)

```go
func fullJitter(attempt int, base, maxDelay time.Duration) time.Duration {
    cap := base * time.Duration(1<<attempt)
    if cap > maxDelay { cap = maxDelay }
    return time.Duration(rand.Int63n(int64(cap)))
}
```

The global functions in `math/rand` use an internal lock. Concurrent calls are serialised. On hot paths with many goroutines this can be a contention point — but for jitter, which fires at most once per retry, the contention is negligible.

### Strategy 2: per-goroutine `*rand.Rand`

```go
var randPool = sync.Pool{
    New: func() any {
        return rand.New(rand.NewSource(time.Now().UnixNano()))
    },
}

func fullJitter(attempt int, base, maxDelay time.Duration) time.Duration {
    cap := base * time.Duration(1<<attempt)
    if cap > maxDelay { cap = maxDelay }
    r := randPool.Get().(*rand.Rand)
    delay := time.Duration(r.Int63n(int64(cap)))
    randPool.Put(r)
    return delay
}
```

`sync.Pool` lets each goroutine grab its own `*rand.Rand`. No locking is needed because each `*rand.Rand` is owned by exactly one goroutine at a time.

This pattern is overkill for jitter but useful if you do a lot of random sampling.

### Strategy 3: wrap with a mutex

```go
type LockedRand struct {
    mu sync.Mutex
    r  *rand.Rand
}

func (l *LockedRand) Int63n(n int64) int64 {
    l.mu.Lock()
    defer l.mu.Unlock()
    return l.r.Int63n(n)
}
```

Same as the global rand internally, but you control the source.

### Recommendation

For Go 1.20+, just use the global `math/rand` (or `math/rand/v2`) functions. They are concurrent-safe and fast enough.

For older versions, wrap with a mutex.

Do not use `crypto/rand` for jitter unless you have a specific reason.

---

## Context Cancellation

`context.Context` is Go's idiomatic way to signal cancellation and propagate deadlines. Every request-scoped operation should accept a `context.Context` as its first argument.

A retry loop without context support is broken in three ways:

1. **The user cannot cancel.** If the user closes their browser or hits Ctrl+C, the retry keeps going.
2. **A deadline cannot be enforced.** A 5-second SLO cannot be honoured if the loop is mid-sleep.
3. **Resources leak.** A goroutine running a retry loop after the rest of the request has been cancelled is a leak.

The fix is straightforward: accept `ctx context.Context`, check `ctx.Err()` before each attempt, and replace `time.Sleep` with a context-aware sleep.

```go
func Do(ctx context.Context, op func(context.Context) error, p Policy) error {
    var lastErr error
    for attempt := 0; attempt < p.MaxAttempts; attempt++ {
        if err := ctx.Err(); err != nil {
            return fmt.Errorf("retry cancelled: %w", err)
        }
        err := op(ctx)
        if err == nil {
            return nil
        }
        if isPermanent(err) {
            return err
        }
        lastErr = err
        if attempt < p.MaxAttempts-1 {
            if err := sleepCtx(ctx, p.Delay(attempt)); err != nil {
                return fmt.Errorf("retry cancelled while sleeping: %w", err)
            }
        }
    }
    return fmt.Errorf("after %d attempts: %w", p.MaxAttempts, lastErr)
}
```

The key changes from the junior version:

1. The signature now takes `ctx`.
2. `op` itself accepts `ctx` — so the operation can use it for its own timeouts.
3. Before each attempt we check `ctx.Err()`. If cancelled, return immediately.
4. The sleep is via `sleepCtx`, which respects cancellation.

---

## Context-Aware Sleep

```go
func sleepCtx(ctx context.Context, d time.Duration) error {
    if d <= 0 {
        return nil
    }
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case <-t.C:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

This is the canonical pattern. Three points to notice:

1. **`time.NewTimer` not `time.After`.** `time.After(d)` creates a timer that is not garbage-collected until it fires. In a tight loop this leaks timers. `time.NewTimer` + `defer t.Stop()` is the leak-free version.
2. **`defer t.Stop()`.** Even though `t.Stop()` returns false if the timer already fired, calling it does not harm. Always defer Stop after `NewTimer`.
3. **Return `ctx.Err()`.** If `ctx.Done()` fires, we return the context's error — `context.Canceled` or `context.DeadlineExceeded`. The caller can `errors.Is(err, context.Canceled)` to distinguish.

A common variation reuses the timer across iterations:

```go
t := time.NewTimer(0) // initial delay 0
defer t.Stop()
if !t.Stop() { <-t.C } // drain
for attempt := 0; attempt < N; attempt++ {
    // ...
    if attempt < N-1 {
        t.Reset(delay)
        select {
        case <-t.C:
        case <-ctx.Done():
            return ctx.Err()
        }
    }
}
```

This avoids the per-iteration allocation of `time.NewTimer`. For very high-frequency retry loops, it matters. For typical applications, the simpler form is fine.

---

## Deadline Propagation

A `context.Context` can carry a deadline. The pattern:

```go
ctx, cancel := context.WithTimeout(parentCtx, 5*time.Second)
defer cancel()

err := retry.Do(ctx, doIt, policy)
```

The retry loop must respect the deadline. If the deadline is at t=5s and the loop is at t=4.5s about to sleep 2s, it should not sleep 2s — it should sleep at most 0.5s, then return `context.DeadlineExceeded`.

The `sleepCtx` we wrote already handles this: `<-ctx.Done()` fires when the deadline arrives.

But the loop should *also* be smart about the per-attempt sleep:

```go
func nextSleep(ctx context.Context, requested time.Duration) time.Duration {
    deadline, ok := ctx.Deadline()
    if !ok {
        return requested
    }
    remaining := time.Until(deadline)
    if requested > remaining {
        return remaining
    }
    return requested
}
```

If the parent deadline is closer than `requested`, sleep only until the deadline. Then the next call to `op(ctx)` will see `ctx.Err() != nil` and short-circuit.

This avoids the situation where you sleep most of the remaining time and then attempt a call with a tiny budget. Better to give the operation as much budget as possible.

### Propagation downstream

Deadline propagation matters because the *operation* itself takes time:

```go
err := op(ctx) // op should respect ctx.Deadline()
```

If `op` is `http.Client.Do`, it must use the context. Go's `http.NewRequestWithContext` plus `client.Do` does this; the request will be cancelled when the context is.

Likewise for gRPC, database libraries (`db.QueryContext`), and your own functions. *All* of them should accept and respect a `context.Context`.

Code smell: a function that does not accept `context.Context`. In modern Go, every I/O-bound function should accept it.

---

## The Retry Budget Idea

The retry-budget concept is a system-wide cap on retry traffic, *separate from* the per-call attempt cap. It is the answer to "what if a million users all hit a failure at once".

Without a budget:

- 1,000,000 users hit a failing API.
- Each user retries up to 5 times.
- Maximum total traffic: 5,000,000 calls per failure-window.

With a budget:

- 1,000,000 users hit a failing API.
- The retry budget allows 10% retry traffic (or some other fraction).
- Only 100,000 retries fire; the rest are denied locally.

The budget is enforced *at the client side* — your retry helper consults a counter before retrying, and if the counter is exhausted, it surfaces the error without retrying.

Why on the client side? Because the *purpose* of the budget is to protect the *failing service*. If every client retries unlimited, the service is overwhelmed. If clients voluntarily limit retries, the service has headroom to recover.

### What does the budget protect?

The budget protects against *correlated failures*. When one failure causes all clients to retry, the retry traffic itself is the second-order failure.

A bare `maxAttempts` per call does not solve this. Each individual call is bounded. The aggregate is not.

---

## Token Bucket as a Retry Budget

The canonical implementation uses a *token bucket*: tokens accumulate at a configured rate; each retry consumes a token; if the bucket is empty, retries are denied.

Go has a standard implementation: `golang.org/x/time/rate.Limiter`.

```go
import "golang.org/x/time/rate"

type Retrier struct {
    Policy  Policy
    Budget  *rate.Limiter
}

func (r *Retrier) Do(ctx context.Context, op func(context.Context) error) error {
    var lastErr error
    for attempt := 0; attempt < r.Policy.MaxAttempts; attempt++ {
        if attempt > 0 {
            // require a budget token before retrying
            if !r.Budget.Allow() {
                return fmt.Errorf("retry budget exhausted: %w", lastErr)
            }
        }
        err := op(ctx)
        if err == nil {
            return nil
        }
        lastErr = err
        if attempt < r.Policy.MaxAttempts-1 {
            if err := sleepCtx(ctx, r.Policy.Delay(attempt)); err != nil {
                return err
            }
        }
    }
    return fmt.Errorf("after %d attempts: %w", r.Policy.MaxAttempts, lastErr)
}
```

Construction:

```go
// Allow 100 retries/sec system-wide, with a burst of 200.
budget := rate.NewLimiter(100, 200)
retrier := &Retrier{Policy: policy, Budget: budget}
```

The limiter is shared across all goroutines using the same retrier. When traffic spikes, the bucket empties and retries are denied until tokens replenish.

### Tuning the budget

The choice of rate is workload-specific. A common heuristic:

- Allow retries equal to `0.1 * normal_request_rate`. (10% retry budget.)
- Burst = 2× the rate.

Google's SRE book has more sophisticated formulas; we discuss them in the senior file.

### Per-route budgets

A single global budget is the simplest. For more sophistication, per-route budgets:

```go
budgets := map[string]*rate.Limiter{
    "users":   rate.NewLimiter(100, 200),
    "payments": rate.NewLimiter(10, 20),
}
```

Then retries for `users` and `payments` are bounded independently. If payments is broken, users keeps working.

---

## Composable Policies

You now have several concepts: a backoff schedule, a jitter strategy, a max-attempts cap, a max-delay cap, a context, a budget. A retry library needs to compose them cleanly. The idiomatic Go pattern is interfaces.

```go
type Policy interface {
    // NextDelay returns the duration to wait before the (attempt+1)th attempt,
    // or (0, false) if no more retries should occur.
    NextDelay(attempt int) (time.Duration, bool)
}

type ExponentialPolicy struct {
    Base        time.Duration
    MaxDelay    time.Duration
    MaxAttempts int
}

func (p ExponentialPolicy) NextDelay(attempt int) (time.Duration, bool) {
    if attempt >= p.MaxAttempts {
        return 0, false
    }
    d := p.Base * time.Duration(1<<attempt)
    if d > p.MaxDelay || d < 0 {
        d = p.MaxDelay
    }
    return d, true
}

// Jittered wraps another policy with full jitter.
type Jittered struct {
    Inner Policy
    Rand  *rand.Rand
    mu    sync.Mutex
}

func (j *Jittered) NextDelay(attempt int) (time.Duration, bool) {
    d, ok := j.Inner.NextDelay(attempt)
    if !ok {
        return 0, false
    }
    j.mu.Lock()
    defer j.mu.Unlock()
    return time.Duration(j.Rand.Int63n(int64(d))), true
}

// Budgeted wraps a policy with a retry budget.
type Budgeted struct {
    Inner  Policy
    Budget *rate.Limiter
}

func (b *Budgeted) NextDelay(attempt int) (time.Duration, bool) {
    if !b.Budget.Allow() {
        return 0, false
    }
    return b.Inner.NextDelay(attempt)
}
```

Now you can compose:

```go
policy := &Budgeted{
    Inner: &Jittered{
        Inner: ExponentialPolicy{Base: 100 * time.Millisecond, MaxDelay: 5 * time.Second, MaxAttempts: 5},
        Rand:  rand.New(rand.NewSource(time.Now().UnixNano())),
    },
    Budget: rate.NewLimiter(100, 200),
}
```

Read it inside-out: exponential schedule, jittered, budgeted.

A single retry loop calls `policy.NextDelay(attempt)`:

```go
func Do(ctx context.Context, op func(context.Context) error, policy Policy) error {
    var lastErr error
    for attempt := 0; ; attempt++ {
        err := op(ctx)
        if err == nil {
            return nil
        }
        lastErr = err
        delay, ok := policy.NextDelay(attempt)
        if !ok {
            return fmt.Errorf("retry exhausted: %w", lastErr)
        }
        if err := sleepCtx(ctx, delay); err != nil {
            return err
        }
    }
}
```

Composability is the point. You can plug different policies into the same loop without changing the loop.

---

## Mental Models

### Model 1: jitter is a "spreader"

Without jitter, every client has a delta function at `base * 2^n`. Jitter convolves it with a uniform distribution, spreading it into a plateau. The same total area, less peak.

### Model 2: context is a "deadline contract"

A `context.Context` is a promise: "I will give up by this time". The retry loop's job is to deliver on that promise. Every `time.Sleep` is a potential violation; replace it with `sleepCtx`.

### Model 3: budget is a "shared throttle"

The retry budget is what makes individual retry decisions globally coherent. Without it, each call's `maxAttempts = 5` aggregates to N×5 retries during an outage. With it, the aggregate is bounded.

### Model 4: composition is the way

You will encounter many retry features: rate-limited delays, deadline-aware delays, attempt caps, budget caps, conditional retry. The idiomatic Go design is a `Policy` interface that you compose by wrapping. Resist building a monolithic retry function with 12 parameters.

---

## Real-World Analogies

**Jitter:** Imagine a thousand people leaving a stadium at the same instant. The corridor is jammed for an hour. Now imagine they each wait a random 0–30 minutes before leaving. The corridor is busy for 30 minutes but no one is jammed.

**Context cancellation:** You are on hold with customer service. You hear "your call will be answered in 5 minutes". A timer ticks. If you hang up before then, the queue forgets you. That is `ctx.Done()`.

**Retry budget:** A water system has a daily supply. Each household has unlimited taps but the city has a daily cap. When the supply runs low, distribution stops. That is the token bucket.

**Decorrelated jitter:** Imagine a dice game where each roll's range depends on the previous roll. Big rolls beget big rolls; small rolls beget small rolls — but with enough randomness that you do not get stuck.

---

## Pros and Cons of Jitter

**Pros:**

- Eliminates synchronised retry pulses (thundering herd).
- Spreads load on the recovering service.
- Empirically reduces total time-to-recovery in simulations.
- Simple to implement: one `rand.Int63n` per delay.

**Cons:**

- Slightly slower average case for individual clients (a client could draw a short delay).
- Requires a random source (and thread-safety considerations).
- Makes debugging harder — the schedule is not deterministic.
- Test fixtures must seed the source or accept variability.

The cons are minor compared to the thundering-herd risk. Use jitter.

---

## Use Cases

- Any client calling a shared service (your microservice calling another microservice).
- Any client doing high-frequency reconnect attempts (websocket clients).
- Any background worker processing a queue with potentially-correlated failures.
- Any system where multiple processes coordinate via a third party.

The rule: *if your code might be running in many copies simultaneously*, jitter. The only no-jitter case is a single-process tool retrying against a private dependency — and even there, the cost of jitter is nearly zero.

---

## Code Examples

### Example 1: full-jitter HTTP client

```go
package main

import (
	"context"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"time"
)

type Client struct {
	http       *http.Client
	maxAttempts int
	base       time.Duration
	maxDelay   time.Duration
}

func (c *Client) Get(ctx context.Context, url string) ([]byte, error) {
	var lastErr error
	for attempt := 0; attempt < c.maxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		body, err, retry := c.attempt(ctx, url)
		if err == nil {
			return body, nil
		}
		if !retry {
			return nil, err
		}
		lastErr = err
		if attempt < c.maxAttempts-1 {
			delay := c.fullJitter(attempt)
			if err := sleepCtx(ctx, delay); err != nil {
				return nil, err
			}
		}
	}
	return nil, fmt.Errorf("after %d attempts: %w", c.maxAttempts, lastErr)
}

func (c *Client) fullJitter(attempt int) time.Duration {
	cap := c.base * time.Duration(1<<attempt)
	if cap > c.maxDelay || cap < 0 {
		cap = c.maxDelay
	}
	if cap <= 0 {
		return 0
	}
	return time.Duration(rand.Int63n(int64(cap)))
}

func (c *Client) attempt(ctx context.Context, url string) ([]byte, error, bool) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err, false
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err, true
	}
	defer resp.Body.Close()
	if resp.StatusCode == 429 || (resp.StatusCode >= 500 && resp.StatusCode <= 599) {
		return nil, fmt.Errorf("status %d", resp.StatusCode), true
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("status %d", resp.StatusCode), false
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err, true
	}
	return body, nil, false
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

### Example 2: decorrelated jitter with a generic helper

```go
package retry

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"sync"
	"time"
)

type DecorrelatedJitter struct {
	Base     time.Duration
	MaxDelay time.Duration
	prev     time.Duration
	mu       sync.Mutex
}

func (d *DecorrelatedJitter) Next() time.Duration {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.prev == 0 {
		d.prev = d.Base
	}
	upper := d.prev * 3
	if upper > d.MaxDelay || upper < 0 {
		upper = d.MaxDelay
	}
	span := upper - d.Base
	if span <= 0 {
		d.prev = d.Base
		return d.Base
	}
	delay := d.Base + time.Duration(rand.Int63n(int64(span)))
	d.prev = delay
	return delay
}

func DoDecorrelated(ctx context.Context, op func(context.Context) error, base, maxDelay time.Duration, maxAttempts int) error {
	jit := &DecorrelatedJitter{Base: base, MaxDelay: maxDelay}
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		err := op(ctx)
		if err == nil {
			return nil
		}
		lastErr = err
		if attempt < maxAttempts-1 {
			if err := sleepCtx(ctx, jit.Next()); err != nil {
				return err
			}
		}
	}
	return fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr)
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

var ErrPermanent = errors.New("permanent")
```

### Example 3: a budget-aware retrier

```go
package retry

import (
	"context"
	"fmt"
	"time"

	"golang.org/x/time/rate"
)

type Retrier struct {
	MaxAttempts int
	Base        time.Duration
	MaxDelay    time.Duration
	Budget      *rate.Limiter
}

func (r *Retrier) Do(ctx context.Context, op func(context.Context) error) error {
	var lastErr error
	for attempt := 0; attempt < r.MaxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		err := op(ctx)
		if err == nil {
			return nil
		}
		lastErr = err
		if attempt < r.MaxAttempts-1 {
			// consume a token before scheduling retry
			if r.Budget != nil {
				if err := r.Budget.Wait(ctx); err != nil {
					return fmt.Errorf("retry budget: %w", err)
				}
			}
			delay := r.fullJitter(attempt)
			if err := sleepCtx(ctx, delay); err != nil {
				return err
			}
		}
	}
	return fmt.Errorf("after %d attempts: %w", r.MaxAttempts, lastErr)
}

func (r *Retrier) fullJitter(attempt int) time.Duration {
	cap := r.Base * time.Duration(1<<attempt)
	if cap > r.MaxDelay || cap < 0 {
		cap = r.MaxDelay
	}
	if cap <= 0 {
		return 0
	}
	// global math/rand is concurrent-safe in Go 1.20+
	return time.Duration(rand.Int63n(int64(cap)))
}
```

Note `r.Budget.Wait(ctx)` — this blocks until a token is available *or* the context is cancelled. If the budget is exhausted, the wait could be long.

If you want "deny rather than wait", use `r.Budget.Allow()`:

```go
if !r.Budget.Allow() {
    return fmt.Errorf("retry budget exhausted: %w", lastErr)
}
```

Both are valid. `Wait` is more polite (you eventually retry), `Allow` is more decisive (you give up immediately).

### Example 4: testing with seeded jitter

To make tests reproducible:

```go
func TestFullJitter(t *testing.T) {
    src := rand.NewSource(42)
    r := rand.New(src)
    j := &FullJitter{Base: 100 * time.Millisecond, MaxDelay: 5 * time.Second, r: r}
    
    delays := []time.Duration{}
    for i := 0; i < 5; i++ {
        delays = append(delays, j.Delay(i))
    }
    // delays is now deterministic, can assert exact values
}
```

Seeding `rand.NewSource(42)` produces the same sequence on every run.

### Example 5: comparing strategies in a simulation

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	const attempts = 6
	const base = 100 * time.Millisecond
	const maxDelay = 5 * time.Second
	const clients = 1000

	for _, strategy := range []string{"none", "full", "equal", "decorrelated"} {
		buckets := make(map[int]int)
		for c := 0; c < clients; c++ {
			elapsed := time.Duration(0)
			prev := time.Duration(0)
			for a := 0; a < attempts; a++ {
				var d time.Duration
				switch strategy {
				case "none":
					d = base * time.Duration(1<<a)
				case "full":
					cap := base * time.Duration(1<<a)
					if cap > maxDelay { cap = maxDelay }
					d = time.Duration(rand.Int63n(int64(cap)))
				case "equal":
					cap := base * time.Duration(1<<a)
					if cap > maxDelay { cap = maxDelay }
					d = cap/2 + time.Duration(rand.Int63n(int64(cap/2)))
				case "decorrelated":
					if prev == 0 { prev = base }
					upper := prev * 3
					if upper > maxDelay { upper = maxDelay }
					span := upper - base
					if span > 0 {
						d = base + time.Duration(rand.Int63n(int64(span)))
					} else {
						d = base
					}
					prev = d
				}
				if d > maxDelay { d = maxDelay }
				elapsed += d
				bucket := int(elapsed / (100 * time.Millisecond))
				buckets[bucket]++
			}
		}
		fmt.Printf("strategy=%s peak=%d\n", strategy, peakBucket(buckets))
	}
}

func peakBucket(b map[int]int) int {
	peak := 0
	for _, v := range b {
		if v > peak { peak = v }
	}
	return peak
}
```

Running this gives you concrete numbers for how much each strategy reduces the peak retry rate. The "none" strategy produces the worst peak (all clients retry at the same instant); the jittered strategies produce ~1/10th the peak.

---

## Coding Patterns

### Pattern A: pass the policy in

```go
type Doer interface {
    Do(ctx context.Context, op func(context.Context) error) error
}
```

Code that calls `Do` does not need to know which policy is in use. This lets you swap full jitter for equal jitter at the configuration level.

### Pattern B: separate "next delay" from "sleep"

The `NextDelay` method computes a duration. The retry loop calls `sleepCtx(ctx, delay)`. By separating, you can unit-test `NextDelay` without sleeping. Schedule tests run in microseconds.

### Pattern C: structure the policy struct

```go
type Policy struct {
    MaxAttempts int
    Base        time.Duration
    MaxDelay    time.Duration
    Strategy    string // "full", "equal", "decorrelated", "none"
    Budget      *rate.Limiter // optional
}
```

A single struct that captures all knobs. Configurable via YAML/JSON.

### Pattern D: instrument every retry

```go
type Stats struct {
    Attempts      int
    Retries       int
    BudgetDenied  int
    ContextCancel int
}
```

Counters incremented at each branch. You will use these in `professional.md` for Prometheus metrics.

---

## Clean Code

- Name jitter strategies by string in config but by interface in code. "full" is a config value; `FullJitter{}` is a Go type.
- Document the policy with a comment giving an example: "// full jitter: delay ~ U[0, base*2^attempt]".
- Test each jitter strategy with a seeded random source for reproducibility.
- Hide `*rand.Rand` behind a `Rand` interface so tests can inject a deterministic implementation.

---

## Error Handling

Three new error-handling cases at the middle level:

1. **`context.Canceled`.** The caller has given up. Return immediately. Wrap as `fmt.Errorf("retry cancelled: %w", ctx.Err())` so the caller can `errors.Is(err, context.Canceled)`.
2. **`context.DeadlineExceeded`.** The deadline has passed. Same as above; the err type tells the caller why.
3. **Retry budget exhausted.** A specific error type. Make it distinguishable.

```go
var ErrBudgetExhausted = errors.New("retry budget exhausted")

// In Do:
if !budget.Allow() {
    return fmt.Errorf("%w: %v", ErrBudgetExhausted, lastErr)
}
```

The caller can `errors.Is(err, ErrBudgetExhausted)` to handle this case specially — for example, fall back to a degraded mode.

---

## Performance Tips

- Avoid `time.After` in loops. Use `time.NewTimer` + `Stop`.
- Reuse a single `*time.Timer` across iterations of a hot retry loop.
- Use `math/rand`'s global functions (or `math/rand/v2`) rather than a `sync.Mutex`-protected source.
- Compute `cap` once and reuse it.
- Avoid `math.Pow` for power-of-two delays; use `1 << attempt`.
- Cap `attempt` at 30 before the shift to avoid overflow.

For sub-microsecond retry loops these matter. For typical application retries (millisecond-scale), they do not.

---

## Best Practices

1. **Always jitter.** No-jitter exponential backoff is an antipattern in shared services.
2. **Use full jitter by default.** Switch to equal or decorrelated only with a reason.
3. **Accept `context.Context` and respect it.** Never `time.Sleep` in a retry that the caller might cancel.
4. **Propagate deadlines.** Cap the remaining sleep by the remaining deadline budget.
5. **Add a retry budget** for any retrier that may run at scale.
6. **Test with seeded random sources** so behaviour is reproducible.
7. **Separate "compute delay" from "sleep"** so the schedule is unit-testable.
8. **Wrap errors with `%w`** so `errors.Is`/`errors.As` work.

---

## Edge Cases and Pitfalls

- **Negative durations.** `rand.Int63n(int64(cap))` panics if `cap <= 0`. Guard.
- **Zero `cap` at attempt 0.** If `base = 0`, every delay is zero. Loop spins. Validate config.
- **`time.After` leaks.** Use `time.NewTimer`.
- **`*rand.Rand` is not concurrent-safe.** Either wrap with mutex or use global functions.
- **`Budget.Wait` can block indefinitely** if no tokens and no deadline. Always pass a context.
- **The deadline check is racy.** Even if you check `ctx.Err()` before `op()`, the deadline may pass during `op()`. That is fine; the operation will see `ctx.Err()` and bail.
- **Cancellation during sleep.** `sleepCtx` handles this; ensure your loop returns the error.
- **Jitter making the average wait too short.** Full jitter halves the expected wait. If you wanted the unjittered values, switch to equal jitter.

---

## Common Mistakes

1. Forgetting to seed the random source (pre-Go 1.20).
2. Sharing a `*rand.Rand` across goroutines without locking.
3. Using `crypto/rand` for jitter ("for security"). Slow, unnecessary.
4. Using `time.After` in a hot loop.
5. Not propagating the deadline; the retry loop runs past the parent's deadline.
6. Not checking `ctx.Err()` at the start of each iteration.
7. Calling `op` without passing it the context.
8. Mixing the budget with the per-call cap; the budget should be *additional*, not a replacement.
9. Tuning the budget too tight, denying retries that would have succeeded.
10. Not surfacing `ErrBudgetExhausted` distinctly; callers cannot react.

---

## Common Misconceptions

- **"Jitter makes the wait longer."** No. Full jitter halves the expected wait. Equal jitter has the same expected wait as no-jitter.
- **"Context-aware sleep is slower."** No. The overhead of `select` is nanoseconds.
- **"Retry budget is the same as `maxAttempts`."** No. `maxAttempts` is per-call; budget is system-wide.
- **"`math/rand` is unsafe for any concurrent use."** Not since Go 1.20+. The *global* functions are safe; per-instance `*rand.Rand` still is not.
- **"Decorrelated jitter is always better than full jitter."** AWS's data shows full jitter is best in most simulations. Decorrelated is close, not better.

---

## Tricky Points

- The naming "full jitter" is confusing — it sounds like "maximum jitter" but is actually "uniformly distributed over the full range up to the cap". Synonyms include "0-jitter" or "random-jitter".
- `Limiter.Allow()` is non-blocking. `Limiter.Wait(ctx)` blocks. `Limiter.Reserve()` is lower-level. Pick the right one.
- A `rate.Limiter` with `Limit(0)` allows nothing — including the *first* call. If you want to allow the first call but throttle retries, do the budget check only when `attempt > 0`.
- The deadline propagated via `context.WithTimeout` is *absolute*, computed from the wall clock at the time of the `WithTimeout` call. If you call `time.Sleep` for 100s and then check `ctx.Done()`, the deadline may already have passed.
- In `math/rand/v2`, the function names changed: `Int63n` → `Int64N`. Be careful when porting.

---

## Test

Tests at the middle level should cover:

1. The retry loop terminates on `ctx.Done`.
2. The sleep respects context cancellation.
3. Each jitter strategy produces delays in the documented range.
4. The retry budget denies after enough retries.
5. Permanent errors short-circuit.
6. The deadline is honoured.

```go
func TestSleepCtxCancelled(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    go func() {
        time.Sleep(10 * time.Millisecond)
        cancel()
    }()
    start := time.Now()
    err := sleepCtx(ctx, 1*time.Second)
    elapsed := time.Since(start)
    if err == nil {
        t.Fatal("expected error")
    }
    if elapsed > 100*time.Millisecond {
        t.Fatalf("sleep did not wake on cancel; elapsed=%v", elapsed)
    }
}

func TestFullJitterRange(t *testing.T) {
    src := rand.NewSource(1)
    r := rand.New(src)
    j := &FullJitter{Base: 100*time.Millisecond, MaxDelay: 5*time.Second, r: r}
    for i := 0; i < 1000; i++ {
        d := j.Delay(3)
        // attempt 3 => cap = min(5s, 100ms * 8) = 800ms
        if d < 0 || d > 800*time.Millisecond {
            t.Errorf("delay %v out of [0, 800ms]", d)
        }
    }
}

func TestBudgetExhausted(t *testing.T) {
    budget := rate.NewLimiter(rate.Inf, 0) // no tokens ever
    r := &Retrier{MaxAttempts: 5, Base: 1*time.Millisecond, MaxDelay: 10*time.Millisecond, Budget: budget}
    callCount := 0
    err := r.Do(context.Background(), func(_ context.Context) error {
        callCount++
        return errors.New("transient")
    })
    if err == nil {
        t.Fatal("expected error")
    }
    if callCount != 1 {
        t.Fatalf("expected 1 call (no budget for retry), got %d", callCount)
    }
}
```

---

## Tricky Questions

**Q1.** Why does full jitter halve the expected delay compared to no-jitter?
A: Because the delay is uniformly distributed on `[0, cap]`, and the expected value of `U[0, cap]` is `cap/2`.

**Q2.** What happens if all 1000 clients use full jitter with the same `base` and `maxDelay`?
A: Each client samples its own random delays independently. The retries spread out over the time window.

**Q3.** Why is `time.After` bad in a loop?
A: It creates a timer per call that is not GC'd until it fires. In a tight loop, memory grows.

**Q4.** What does `Limiter.Wait(ctx)` do?
A: Blocks until a token is available *or* `ctx.Done()` fires.

**Q5.** What is the difference between `maxAttempts` and a retry budget?
A: `maxAttempts` is per-call: how many times this one operation may retry. The budget is system-wide: how many retries per second across all calls.

**Q6.** If the deadline is 1s away and the next delay is 5s, what should you do?
A: Sleep at most 1s. The next `op()` call sees `ctx.Err()` and exits.

**Q7.** What if `op` does not accept `context.Context`?
A: Wrap it or rewrite it. Modern Go I/O always takes context.

**Q8.** Why is decorrelated jitter stateful?
A: Each delay depends on the previous. You must store `prev` between calls.

---

## Cheat Sheet

```
Strategies:
  full      delay = U[0, cap]
  equal     delay = cap/2 + U[0, cap/2]
  decorr    delay = U[base, prev*3], cap'd at maxDelay
  
where cap = min(maxDelay, base * 2^attempt)

Context-aware sleep:
  t := time.NewTimer(d)
  defer t.Stop()
  select {
  case <-t.C:
  case <-ctx.Done(): return ctx.Err()
  }

Budget:
  budget := rate.NewLimiter(rate, burst)
  if !budget.Allow() { return ErrBudgetExhausted }

Default: full jitter, context-aware sleep, retry budget.
```

---

## Self-Assessment Checklist

- [ ] I can implement full jitter from memory.
- [ ] I can implement equal jitter from memory.
- [ ] I can implement decorrelated jitter from memory.
- [ ] I know why each strategy exists.
- [ ] I can write a context-aware sleep.
- [ ] I know why `time.After` leaks in loops.
- [ ] I understand the difference between `Limiter.Allow` and `Limiter.Wait`.
- [ ] I can explain thundering herd to a junior.
- [ ] I know to use `math/rand` (not `crypto/rand`) for jitter.

---

## Summary

The three additions to a retry loop at the middle level are: **jitter**, **context-awareness**, and a **retry budget**. Jitter (preferably full jitter) prevents thundering herd. Context lets the caller cancel and propagate deadlines. A retry budget caps system-wide retry traffic so a localised failure does not become a global outage.

The composable `Policy` interface lets you mix and match these features. A typical production policy is "exponential + full jitter + budget + max attempts + context".

---

## What You Can Build

- A production-grade HTTP client with retry, jitter, budget, and context.
- A websocket reconnect manager that does not stampede.
- A worker pool that retries failed jobs with jittered backoff.
- A reusable `retry.Policy` package for your codebase.

---

## Further Reading

- AWS Architecture Blog, "Exponential Backoff And Jitter" — the canonical reference.
- Google's SRE book, Chapter "Handling Overload" — for retry budgets.
- `golang.org/x/time/rate` documentation.
- `math/rand/v2` design discussion (Go proposal).
- `cenkalti/backoff` source code (a real implementation of these patterns).

---

## Related Topics

- **Context** (concurrency track): cancellation and deadlines.
- **Rate limiting** (time-based concurrency): token bucket internals.
- **Circuit breakers** (later in this track): fail fast when retry is hopeless.
- **`time.Timer`** (time-based concurrency): the primitive behind context-aware sleep.

---

## Diagrams and Visual Aids

### Full jitter spreads retries

```
no-jitter retries:        ▌
                          ▌▌
                          ▌▌▌    ← all clients pile up
                          ▌▌▌▌
   time →

full-jitter retries:      ▌  ▌
                           ▌ ▌▌      ← spread out
                            ▌  ▌▌
                          ▌  ▌  ▌
   time →
```

### Context-aware sleep

```
            ┌──────┐
ctx.Done────┤      │
            │ select  ──→ wake (early)
time.Timer──┤      │
            └──────┘
```

### Retry budget

```
                   ┌────────────────┐
   retry attempt ──┤  rate.Limiter  ├──→ allowed?
                   │  (tokens=N)    │
                   └────────────────┘
                          │
                          ▼
                    if no: deny
                    if yes: sleep, retry
```

The three additions compose orthogonally. A retry loop that has all three is the foundation for the senior-level discussion.

---

## Appendix A: A Deeper Look at the Three Jitter Strategies

The three strategies are easy to write down but harder to internalise. This appendix re-derives them, compares them on simulated workloads, and discusses subtle details you will not find in the AWS blog post.

### The basic exponential schedule

Define `exp(n) = base * 2^n`, the no-jitter exponential delay at attempt `n`. Let `cap` be the maximum of `exp(n)` and the policy's `maxDelay`:

```
cap(n) = min(maxDelay, base * 2^n)
```

All three jitter strategies are random samples drawn from a distribution parameterised by `cap(n)`. Equivalently, all three are random functions `f(n)` whose expected value is some fraction of `cap(n)`.

### Full jitter properties

- Distribution: `U[0, cap(n)]` (uniform on the closed-open interval).
- Expected value: `cap(n) / 2`.
- Variance: `cap(n)^2 / 12`.
- Probability of "small" delays: high. About 25% of full-jitter delays are below `cap(n)/4`.

Why this matters: full jitter has the *highest* variance among the three strategies, which makes it the best at spreading retries across the recovery window. This is exactly why the AWS simulations rank it best.

### Equal jitter properties

- Distribution: `cap(n)/2 + U[0, cap(n)/2]`.
- Expected value: `(3/4) * cap(n)`.
- Variance: `cap(n)^2 / 48` (one quarter of full jitter's).
- Probability of "small" delays: zero. The minimum delay is `cap(n)/2`.

Equal jitter is less spread-out than full jitter. Its advantage is the guarantee that *every* client waits at least half the exponential value. This matters in two cases:

1. **Compliance with rate-limit contracts.** If your dependency contractually requires "wait at least X ms between retries when 429", equal jitter (with `X = cap(n)/2`) honours the contract while still randomising.
2. **Observability.** Operators sometimes find equal jitter easier to reason about because they know the *minimum* wait.

But for thundering-herd prevention, equal jitter is strictly worse than full jitter.

### Decorrelated jitter properties

- Distribution at attempt `n`: `U[base, 3 * prev]` (where `prev` is the previous delay).
- Expected value: `(base + 3*prev) / 2 ≈ (3/2) * prev` for `prev >> base`.
- Variance: `(3*prev - base)^2 / 12`.
- Properties not derived from `attempt`: the schedule is *Markovian*, depending only on the previous delay.

Decorrelated jitter's distinguishing property is that *successive delays are independent of attempt number*. If you have a system where the attempt counter cannot be reliably tracked (e.g. retries spread across multiple processes), decorrelated jitter still works because it only needs the previous delay.

### A simulation

Suppose 100 clients each retry up to 6 times against a server that recovers at t=2.5s. Below is the conceptual histogram of retry arrivals in 100-ms buckets, comparing strategies:

| time bucket | none | full | equal | decorr |
|-------------|------|------|-------|--------|
| 0.1s        | 0    | 24   | 0     | 13     |
| 0.2s        | 100  | 23   | 0     | 18     |
| 0.3s        | 0    | 19   | 0     | 14     |
| 0.4s        | 100  | 11   | 25    | 12     |
| 0.5s        | 0    | 7    | 50    | 7      |
| 0.6s        | 0    | 4    | 25    | 5      |
| ...         | ...  | ...  | ...   | ...    |

The "none" row shows pulses (all 100 clients at the same instant). "Full" smears them out into a flat-ish plateau. "Equal" produces peaks around `cap(n) * (3/4)` because that is its expected delay. "Decorrelated" smears them out, somewhere between full and equal.

Reading the table: full jitter has the lowest peak per bucket, hence the lowest spike to the server. This is the empirical justification for choosing full jitter as the default.

### When full jitter is wrong

Two niche cases:

1. **Contractual lower bounds.** If you must wait at least X ms, full jitter can draw a 0 ms delay. Use equal jitter (or full jitter clamped to a lower bound).
2. **Stateless retry counters.** If you cannot track attempt number reliably, decorrelated jitter works with just the previous delay.

In all other cases, full jitter is the default.

---

## Appendix B: A Production-Adjacent Retrier

Let us combine everything from this file into a single package you could drop into production. It is ~150 lines of Go.

```go
// Package retry provides a context-aware, jittered, budgeted retry helper.
package retry

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"time"

	"golang.org/x/time/rate"
)

// Permanent wraps an error to signal "do not retry".
type Permanent struct{ Err error }

func (p *Permanent) Error() string { return p.Err.Error() }
func (p *Permanent) Unwrap() error { return p.Err }

// MarkPermanent returns err wrapped so that Do will not retry.
func MarkPermanent(err error) error { return &Permanent{Err: err} }

// ErrBudgetExhausted indicates the retry budget was empty.
var ErrBudgetExhausted = errors.New("retry budget exhausted")

// Strategy is the jitter strategy used by Policy.
type Strategy int

const (
	NoJitter Strategy = iota
	FullJitter
	EqualJitter
	DecorrelatedJitter
)

// Policy describes a retry policy.
type Policy struct {
	MaxAttempts int
	Base        time.Duration
	MaxDelay    time.Duration
	Strategy    Strategy
	Budget      *rate.Limiter // optional
}

// Default returns a reasonable default policy.
func Default() Policy {
	return Policy{
		MaxAttempts: 5,
		Base:        100 * time.Millisecond,
		MaxDelay:    5 * time.Second,
		Strategy:    FullJitter,
	}
}

// Retrier is the stateful retrier; safe for concurrent use.
type Retrier struct {
	Policy Policy
}

func New(p Policy) *Retrier {
	if p.MaxAttempts <= 0 {
		p.MaxAttempts = 1
	}
	if p.Base <= 0 {
		p.Base = 100 * time.Millisecond
	}
	if p.MaxDelay <= 0 {
		p.MaxDelay = 30 * time.Second
	}
	return &Retrier{Policy: p}
}

// Do runs op until success, permanent failure, budget exhaustion, or attempts exhausted.
func (r *Retrier) Do(ctx context.Context, op func(context.Context) error) error {
	var lastErr error
	var prev time.Duration // for decorrelated jitter
	for attempt := 0; attempt < r.Policy.MaxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("retry cancelled: %w", err)
		}
		err := op(ctx)
		if err == nil {
			return nil
		}
		var perm *Permanent
		if errors.As(err, &perm) {
			return perm.Err
		}
		lastErr = err
		if attempt >= r.Policy.MaxAttempts-1 {
			break
		}
		if r.Policy.Budget != nil {
			if !r.Policy.Budget.Allow() {
				return fmt.Errorf("%w: last error: %v", ErrBudgetExhausted, lastErr)
			}
		}
		delay, newPrev := r.nextDelay(attempt, prev)
		prev = newPrev
		// honour deadline if set
		if deadline, ok := ctx.Deadline(); ok {
			remaining := time.Until(deadline)
			if remaining < delay {
				delay = remaining
			}
		}
		if err := sleepCtx(ctx, delay); err != nil {
			return fmt.Errorf("retry cancelled while sleeping: %w", err)
		}
	}
	return fmt.Errorf("after %d attempts: %w", r.Policy.MaxAttempts, lastErr)
}

func (r *Retrier) nextDelay(attempt int, prev time.Duration) (time.Duration, time.Duration) {
	cap := r.Policy.Base * time.Duration(1<<attempt)
	if cap > r.Policy.MaxDelay || cap < 0 {
		cap = r.Policy.MaxDelay
	}
	switch r.Policy.Strategy {
	case NoJitter:
		return cap, cap
	case FullJitter:
		if cap <= 0 {
			return 0, 0
		}
		return time.Duration(rand.Int63n(int64(cap))), cap
	case EqualJitter:
		half := cap / 2
		if half <= 0 {
			return 0, 0
		}
		return half + time.Duration(rand.Int63n(int64(half))), cap
	case DecorrelatedJitter:
		if prev == 0 {
			prev = r.Policy.Base
		}
		upper := prev * 3
		if upper > r.Policy.MaxDelay || upper < 0 {
			upper = r.Policy.MaxDelay
		}
		span := upper - r.Policy.Base
		if span <= 0 {
			return r.Policy.Base, r.Policy.Base
		}
		delay := r.Policy.Base + time.Duration(rand.Int63n(int64(span)))
		return delay, delay
	}
	return cap, cap
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

This is the closest you can get to a production retry helper in a single file with no external dependencies (other than `golang.org/x/time/rate` for the budget).

Read it carefully:

1. The `Policy` is a value type — cheap to copy, easy to pass around.
2. The `Retrier.Do` method is the only public method that runs the loop. It accepts `ctx`, an `op`, and uses the embedded `Policy`.
3. The `nextDelay` method is pure (given `attempt` and `prev`) and returns the delay plus a new `prev`. Decorrelated jitter mutates `prev`; other strategies do not.
4. The deadline-honouring code clips `delay` to the remaining budget. This avoids the "I just slept for 5s past the parent's deadline" anti-pattern.
5. The `Permanent` wrapping mechanism lets callers veto retry.
6. `ErrBudgetExhausted` is a sentinel for callers who want to react.

You can write tests against it without sleeping much:

```go
func TestRetrierSucceedsThird(t *testing.T) {
    r := retry.New(retry.Policy{
        MaxAttempts: 5,
        Base:        1 * time.Millisecond,
        MaxDelay:    10 * time.Millisecond,
        Strategy:    retry.NoJitter,
    })
    calls := 0
    err := r.Do(context.Background(), func(_ context.Context) error {
        calls++
        if calls < 3 {
            return errors.New("transient")
        }
        return nil
    })
    if err != nil {
        t.Fatal(err)
    }
    if calls != 3 {
        t.Fatalf("got %d calls", calls)
    }
}
```

This is the API that the professional file extends with metrics, tracing, and circuit-breaker integration.

---

## Appendix C: The Math Behind Thundering Herd

A short formal treatment.

Suppose `N` clients all experience a failure at time `t=0`. Each client retries at time `D` (the delay), then again at `2D`, etc. Total retry traffic at the server, as a function of time, is the sum over clients of their retry impulses.

Without jitter, every client's impulse is at exactly the same `t`. So total traffic at `t=D` is `N`. Then 0 until `t=2D`, when it spikes to `N` again. The peak load is `N` per instant.

With full jitter at `cap = D`, each client's first retry is uniformly distributed in `[0, D]`. The expected number of clients retrying *within a small window* `[t, t+dt]` is `N * dt / D`. So the load is approximately constant at `N/D` per unit time. The peak is `N/D * window_size`.

If you measure peak in a 1-ms window:

- No jitter: `N` retries in 1 ms.
- Full jitter: `N/D * 1ms` retries in 1 ms. For `D = 100ms`, that is `N/100` retries in 1 ms.

So full jitter reduces the peak by ~100×, in this example. The server experiences a flat load instead of a spike.

The math generalises: full jitter at cap `D` produces a peak that is `1/D` times the no-jitter peak (in the same time window).

This is *why* jitter works.

### Why the AWS blog showed equal jitter is worse

Equal jitter at cap `D` distributes clients uniformly in `[D/2, D]`. The window has width `D/2`. So the peak load is `N/(D/2) * window_size = 2N/D * window_size`. That is twice the peak of full jitter for the same `D`.

In simulations, this 2× peak makes equal jitter noticeably worse at thundering-herd prevention. Full jitter wins.

### What about decorrelated jitter?

Decorrelated jitter at attempt `n` samples from `U[base, prev*3]`. The width of the sample distribution grows over time, so the peak shrinks over time. Empirically the peak is between equal and full.

---

## Appendix D: The `time.Timer` Pattern in Detail

We use `time.NewTimer` + `defer t.Stop()` in `sleepCtx`. Let us understand why.

### What `time.NewTimer` does

`time.NewTimer(d)` returns a `*time.Timer` whose `C` channel will receive a value `time.Time` after duration `d`. The timer is registered with the runtime's timer heap. After `d` elapses, the runtime sends a value on `t.C`.

If you do nothing else, the timer eventually fires and is garbage-collected. The cost is one allocation per timer.

### What `t.Stop()` does

`t.Stop()` removes the timer from the runtime's heap. Returns `false` if the timer has already fired (or been stopped before).

Calling `Stop()` on a timer that has not yet fired prevents the channel send. The timer is immediately removed; no allocation persists.

### Why `defer t.Stop()` matters

In `sleepCtx`, after the `select`, control returns to the caller. If we did *not* call `Stop()`, the timer would continue to live until `d` elapsed. In a tight loop, that means many timers in the heap at once.

`defer t.Stop()` ensures cleanup on every exit path — including panics.

### The `t.Reset(d)` pattern

For very high-frequency loops, allocating a new `*time.Timer` per iteration is wasteful. The optimisation is to keep a single timer and `Reset(d)` it:

```go
t := time.NewTimer(initial)
defer t.Stop()
for {
    select {
    case <-t.C:
    case <-ctx.Done():
        return
    }
    // ... work ...
    if !t.Stop() {
        <-t.C // drain if it fired
    }
    t.Reset(next)
}
```

The subtlety is: `Reset` on a not-stopped timer is safe but undefined if the timer's channel has unread values. The idiomatic guard is to call `Stop` first, then drain the channel if `Stop` returned false (meaning the timer already fired). For the typical retry loop this is overkill; new-per-iteration is fine.

### `time.After` vs `time.NewTimer`

`time.After(d)` is shorthand for `time.NewTimer(d).C`. The timer is *not* stopped, *not* returned to the caller. It lives until it fires. In a loop, this leaks.

Always prefer `time.NewTimer` + `Stop` when in a loop.

### Granularity

Timers fire with millisecond granularity on most platforms. A `time.NewTimer(1 * time.Nanosecond)` will fire after at least 1 ms in practice. Do not rely on nanosecond timing for jitter; the OS scheduler dominates.

For jitter purposes, this is irrelevant — the jitter values are tens or hundreds of milliseconds, far above OS granularity.

---

## Appendix E: A Complete HTTP-Client Wrapper

Let us write a complete HTTP client with retry, jitter, context, and budget. This is the kind of code you would ship in an internal SDK.

```go
package httpclient

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"yourmodule/retry"
)

type Client struct {
	HTTP    *http.Client
	Retrier *retry.Retrier
}

func New(retrier *retry.Retrier) *Client {
	return &Client{
		HTTP:    &http.Client{Timeout: 30 * time.Second},
		Retrier: retrier,
	}
}

// Do executes req with retry. Body is read into memory so retries can resend.
func (c *Client) Do(ctx context.Context, req *http.Request) (*http.Response, []byte, error) {
	var body []byte
	if req.Body != nil {
		var err error
		body, err = io.ReadAll(req.Body)
		if err != nil {
			return nil, nil, fmt.Errorf("read body: %w", err)
		}
		req.Body.Close()
	}
	var (
		respBody []byte
		respPtr  *http.Response
	)
	err := c.Retrier.Do(ctx, func(ctx context.Context) error {
		// fresh request each attempt
		var bodyReader io.Reader
		if body != nil {
			bodyReader = bytes.NewReader(body)
		}
		r, err := http.NewRequestWithContext(ctx, req.Method, req.URL.String(), bodyReader)
		if err != nil {
			return retry.MarkPermanent(err)
		}
		r.Header = req.Header.Clone()
		resp, err := c.HTTP.Do(r)
		if err != nil {
			return err // transient
		}
		if resp.StatusCode == 429 || (resp.StatusCode >= 500 && resp.StatusCode <= 599) {
			drainAndClose(resp)
			return fmt.Errorf("status %d", resp.StatusCode)
		}
		if resp.StatusCode >= 400 {
			b, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			return retry.MarkPermanent(fmt.Errorf("status %d: %s", resp.StatusCode, b))
		}
		b, err := io.ReadAll(resp.Body)
		if err != nil {
			resp.Body.Close()
			return err
		}
		resp.Body.Close()
		respBody = b
		respPtr = resp
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	return respPtr, respBody, nil
}

func drainAndClose(resp *http.Response) {
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
}

// RetryAfter parses the Retry-After header into a duration.
func RetryAfter(resp *http.Response) (time.Duration, bool) {
	if resp == nil {
		return 0, false
	}
	h := resp.Header.Get("Retry-After")
	if h == "" {
		return 0, false
	}
	if secs, err := strconv.Atoi(h); err == nil {
		return time.Duration(secs) * time.Second, true
	}
	if t, err := http.ParseTime(h); err == nil {
		return time.Until(t), true
	}
	return 0, false
}
```

This handles most of the cases an internal HTTP client needs. Missing:

- `Retry-After` header use (the helper is there but we do not wire it into the retrier yet — that comes in `professional.md`).
- Metrics emission.
- Distributed tracing.

Both are easy additions but belong in the professional file.

### A note on the body-reading hack

The line `body, err := io.ReadAll(req.Body)` reads the entire request body into memory. This is necessary because we may send it more than once. For small bodies (JSON, form data) it is fine. For large bodies (file uploads), it is a memory problem.

Two ways out:

1. Tell the caller "no retries for large requests". Document it.
2. Take a `func() io.Reader` instead of `io.Reader`, so the caller can produce a fresh reader per attempt.

The second is what `cenkalti/backoff` and many production libraries do. We will discuss it in `professional.md`.

---

## Appendix F: Mocking Time For Tests

Real retry tests need to either sleep or fake time. Sleeping is fine for short delays. For longer delays, fake time is essential.

### Approach 1: tiny durations

Use `base = 1 * time.Millisecond, maxDelay = 10 * time.Millisecond`. Tests still actually sleep, but for milliseconds.

```go
func TestRetrySucceedsAfterFailures(t *testing.T) {
    r := retry.New(retry.Policy{
        MaxAttempts: 5,
        Base:        1 * time.Millisecond,
        MaxDelay:    10 * time.Millisecond,
        Strategy:    retry.NoJitter,
    })
    // ... test ...
}
```

The total test time is `1 + 2 + 4 + 8 = 15ms` of sleep, plus the operation. Fast enough.

### Approach 2: inject a sleeper

```go
type Sleeper func(context.Context, time.Duration) error

type Retrier struct {
    Policy Policy
    Sleep  Sleeper // can be replaced for tests
}

func realSleep(ctx context.Context, d time.Duration) error {
    if d <= 0 { return nil }
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case <-t.C:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func New(p Policy) *Retrier {
    return &Retrier{Policy: p, Sleep: realSleep}
}
```

Tests can pass a no-op sleeper:

```go
r := retry.New(policy)
r.Sleep = func(_ context.Context, _ time.Duration) error { return nil }
```

Now the test runs instantly regardless of policy parameters. Trade-off: the API has an extra knob.

### Approach 3: a fake clock library

```go
import "github.com/benbjohnson/clock"

type Retrier struct {
    Policy Policy
    Clock  clock.Clock
}
```

The `clock.Clock` interface has `Now`, `Sleep`, `NewTimer`. In tests, use `clock.NewMock()` which lets you manually advance time:

```go
mc := clock.NewMock()
r := &Retrier{Policy: policy, Clock: mc}
go r.Do(ctx, op) // running in a goroutine
mc.Add(5 * time.Second) // advance the clock
```

Most powerful, most code. Worth it for libraries; overkill for application code.

### Recommendation

For most application code: tiny durations (approach 1).
For libraries: injectable sleeper (approach 2) or fake clock (approach 3).

---

## Appendix G: Combining With Other Time Primitives

Retry is one piece of a resilient client. The others — timeouts, deadlines, rate limits — all interact.

### Per-call timeout

```go
ctx, cancel := context.WithTimeout(parentCtx, 5*time.Second)
defer cancel()
resp, err := client.Do(req.WithContext(ctx))
```

This is *per call*, not *per retry budget*. If your retrier has 5 attempts and each has a 5-second timeout, the total wall-clock can reach 25s + sleeps.

### Total deadline across all retries

```go
ctx, cancel := context.WithTimeout(parentCtx, 30*time.Second) // total budget
defer cancel()
err := retrier.Do(ctx, op)
```

Now the total wall-clock is bounded by 30s. Each attempt may still take up to its own per-call timeout, but the retrier will stop scheduling new attempts once 30s is up.

This is the right pattern for user-facing requests. Set a *total* deadline at the request boundary; let the retrier work within it.

### Rate limit (outbound)

```go
limiter := rate.NewLimiter(rate.Limit(100), 200) // 100 RPS sustained, 200 burst

func callRemote(ctx context.Context) error {
    if err := limiter.Wait(ctx); err != nil { return err }
    return client.Do(req)
}
```

The rate limit applies to *every* call, including retries. This protects the dependency from your total outbound traffic.

### Rate limit + retry budget: different things

A rate limit caps the steady-state RPS. A retry budget caps the *retry* RPS. You may want both:

- 100 RPS overall.
- Of which, at most 10 RPS may be retries.

`golang.org/x/time/rate` makes both trivial: two limiters, one consulted on every call, one on retries.

### Bulkheads

A *bulkhead* is a per-dependency concurrency limit. If you can have at most 50 in-flight calls to a dependency, an `int64` counter or a semaphore enforces it. Retries count against the bulkhead.

```go
type Bulkhead struct { sem chan struct{} }
func (b *Bulkhead) Acquire(ctx context.Context) error {
    select {
    case b.sem <- struct{}{}:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
func (b *Bulkhead) Release() { <-b.sem }
```

Bulkheads, rate limits, and retry budgets all serve the same purpose at different granularities: protect the dependency.

---

## Appendix H: Closer Look at `context.Context`

Since retry depends heavily on context, a short reference.

### Creating a context

```go
ctx := context.Background()                              // root context
ctx, cancel := context.WithCancel(parent)                // cancellable child
ctx, cancel := context.WithTimeout(parent, 5*time.Second) // time-bounded child
ctx, cancel := context.WithDeadline(parent, deadline)    // absolute deadline
ctx := context.WithValue(parent, key, value)             // attach a value
```

Always defer `cancel()` to release resources.

### Reading from a context

```go
err := ctx.Err()              // nil unless cancelled/deadlined
deadline, ok := ctx.Deadline() // absolute deadline if any
done := ctx.Done()             // channel that closes on cancellation
v := ctx.Value(key)            // attached value or nil
```

### The cancellation propagation tree

If parent is cancelled, all descendant contexts created from it are also cancelled. This means a `context.WithCancel(parent)` you forget to cancel is OK *if* you cancel the parent.

But: every context you create with a `cancel` function should have `defer cancel()` to release the registered timer/parent association immediately on function return. `cancel()` is idempotent and cheap.

### Context in the retry loop

Three places to check:

1. Before each `op` call: `if err := ctx.Err(); err != nil { return err }`.
2. During the sleep: `select { case <-t.C: case <-ctx.Done(): }`.
3. Before scheduling the next attempt: optional but harmless.

Most retry libraries place the check just before each `op` call. The during-sleep check is in `sleepCtx`.

---

## Appendix I: A Note on `sync.Once` and First-Try Caching

Sometimes you have a "set up once, retry if not set up" pattern:

```go
var once sync.Once
var resource *Resource
var initErr error

func GetResource(ctx context.Context) (*Resource, error) {
    once.Do(func() {
        resource, initErr = setup(ctx)
    })
    return resource, initErr
}
```

The problem: if `setup` fails, `once.Do` records the failure and `initErr` is permanent. Future calls return the same error. No retry.

The fix is to use a *retrying* once:

```go
var (
    mu       sync.Mutex
    resource *Resource
    initErr  error
    inited   bool
)

func GetResource(ctx context.Context) (*Resource, error) {
    mu.Lock()
    defer mu.Unlock()
    if inited && initErr == nil {
        return resource, nil
    }
    r, err := setupWithRetry(ctx)
    if err != nil {
        initErr = err
        return nil, err
    }
    resource = r
    inited = true
    return resource, nil
}
```

The retry is *inside* `setupWithRetry`. The cache holds only successful results.

This is a common pattern for things like Kafka client setup, database pool creation, gRPC channel construction.

---

## Appendix J: Common Confusions

A few subtle points often confused at this level.

### "Jitter" vs "randomisation"

Jitter is a specific form of randomisation applied to a backoff delay. Other randomisations (e.g. shuffling a list) are not jitter. Use the word "jitter" only for retry/backoff contexts.

### "Backoff" vs "retry"

Backoff is the delay schedule. Retry is the whole policy. "Exponential backoff" usually means "exponential backoff schedule inside a retry loop". Sometimes used as synecdoche for the whole pattern.

### `time.After` vs `time.NewTimer`

`time.After(d)` returns a channel. `time.NewTimer(d)` returns a struct with a channel. The struct can be stopped; the bare channel cannot. In loops, use the struct.

### `Limiter.Wait` vs `Limiter.Allow`

`Wait` blocks. `Allow` returns false immediately if no token. `Reserve` is lower-level. For retry budgets, `Allow` is more common because you want a decisive "no more retries".

### Per-call timeout vs total deadline

A per-call timeout limits one attempt. A total deadline limits the whole retry sequence. You usually want both.

### Idempotency keys vs replay tokens

Idempotency keys are server-side: the server records the key and de-duplicates. Replay tokens are client-side: the client signs the request such that the server can detect a replay. Different mechanisms; both prevent duplicate side effects.

---

## Appendix K: Examples From Real Libraries

A short tour to anchor the theory.

### AWS SDK for Go v2

```go
import "github.com/aws/aws-sdk-go-v2/aws/retry"

config.Retryer = func() aws.Retryer {
    return retry.NewStandard(func(o *retry.StandardOptions) {
        o.MaxAttempts = 5
        o.MaxBackoff  = 5 * time.Second
    })
}
```

`retry.Standard` uses full jitter under the hood.

### gRPC service config

```json
"retryPolicy": {
  "maxAttempts": 4,
  "initialBackoff": "0.1s",
  "maxBackoff": "1s",
  "backoffMultiplier": 2,
  "retryableStatusCodes": ["UNAVAILABLE"]
}
```

Configured at the channel level; gRPC's client applies it transparently.

### cenkalti/backoff

```go
b := backoff.NewExponentialBackOff()
b.InitialInterval = 100 * time.Millisecond
b.MaxInterval     = 5 * time.Second
b.MaxElapsedTime  = 1 * time.Minute
err := backoff.Retry(func() error {
    return doIt()
}, b)
```

`ExponentialBackOff.NextBackOff()` includes randomisation via `RandomizationFactor` (defaults to 0.5).

### hashicorp/go-retryablehttp

```go
client := retryablehttp.NewClient()
client.RetryMax = 5
client.RetryWaitMin = 100 * time.Millisecond
client.RetryWaitMax = 5 * time.Second
resp, err := client.Get("https://example.com")
```

Wraps `net/http` with retry. Defaults use jittered exponential backoff.

These are the libraries you will encounter in real Go code. The patterns we have built in this file are essentially what they implement, plus integration with `net/http` or gRPC.

---

## Appendix L: Failure Mode Catalogue (Mid-Level)

A short tour of failures that good middle-level retry code handles. (`senior.md` and `professional.md` add more.)

### Mode 1: brief overload spike

Server has 100% CPU for ~500ms during garbage collection. Some calls return 503. Pure exponential without jitter: every client retries 100ms later, again hitting the still-recovering server. With full jitter: retries spread out over the 100-500ms window, server recovers smoothly.

### Mode 2: cold cache after restart

Server's caches are cold for 2-3 seconds after restart. Calls return errors during warm-up. With exponential + jitter + max 5 attempts, most clients are served by the 5th attempt (around t=1.5s + jitter). Caches warm up; subsequent calls succeed.

### Mode 3: rolling deploy

Half the fleet is being replaced. Some calls hit drained instances and fail. Full jitter spreads retries to non-drained instances. Client-side load balancing (DNS, round-robin) helps too.

### Mode 4: client-side context cancel

User clicked cancel. The request context is cancelled. `sleepCtx` wakes immediately, returns the cancellation. The user does not wait.

### Mode 5: deadline exceeded mid-retry

Total deadline is 5s. Attempt 3 fails at t=4.8s. Next computed delay is 1s — exceeds remaining 200ms. Retrier clips to 200ms, then `ctx.Err()` fires; return `DeadlineExceeded`.

### Mode 6: budget exhausted

A region-wide failure means many clients are retrying. The retry budget (10 RPS) fills up. New retries are denied. Clients see `ErrBudgetExhausted` instead of waiting. The dependency has headroom to recover.

---

## Appendix M: Test Patterns

A small toolbox for testing the retry helper.

### Counting attempts

```go
calls := 0
op := func(_ context.Context) error {
    calls++
    return ...
}
```

After running, assert `calls == expected`.

### Recording delays

```go
var delays []time.Duration
sleeper := func(ctx context.Context, d time.Duration) error {
    delays = append(delays, d)
    return nil
}
```

Inject this into the retrier; assert the sequence of delays.

### Checking jitter range

```go
for i := 0; i < 1000; i++ {
    d := jitter.Delay(3) // attempt 3
    if d > maxForAttempt3 {
        t.Errorf("delay %v exceeds max", d)
    }
}
```

Run many iterations; check the distribution stays in range.

### Cancelling mid-loop

```go
ctx, cancel := context.WithCancel(context.Background())
go func() {
    time.Sleep(10 * time.Millisecond)
    cancel()
}()
err := retrier.Do(ctx, longOp)
if !errors.Is(err, context.Canceled) {
    t.Fatal("expected cancel")
}
```

Cancels the context after a short delay; expects the retrier to bail.

### Deterministic jitter

```go
src := rand.NewSource(42)
r := rand.New(src)
jit := &FullJitter{Base: 100*time.Millisecond, MaxDelay: 5*time.Second, r: r}
d1 := jit.Delay(3)
d2 := jit.Delay(3)
// d1 and d2 are deterministic given seed 42
```

Use a known seed for reproducibility.

---

## Appendix N: Anti-Patterns Specific to the Middle Level

Beyond the junior-level anti-patterns, the middle level has its own.

### Anti-pattern 1: jittering without a cap

```go
// WRONG
delay := time.Duration(rand.Int63n(int64(base * (1 << attempt))))
```

No cap means the shift overflows at attempt 63, then `rand.Int63n` panics on negative input. Always cap before passing to `Int63n`.

### Anti-pattern 2: jittering with `crypto/rand`

```go
// WRONG
b := make([]byte, 8)
crypto_rand.Read(b)
delay := time.Duration(binary.BigEndian.Uint64(b) % uint64(cap))
```

Slow, unnecessary. Use `math/rand`.

### Anti-pattern 3: forgetting `defer cancel()`

```go
// WRONG
ctx, _ := context.WithTimeout(parent, 5*time.Second)
retrier.Do(ctx, op)
```

Leaks a timer until the parent context is cancelled. Always `defer cancel()`.

### Anti-pattern 4: ignoring `ctx.Err()` after `select`

```go
// WRONG
select {
case <-t.C:
case <-ctx.Done():
}
// continues without checking ctx.Err()
```

Always return `ctx.Err()` when `<-ctx.Done()` fires.

### Anti-pattern 5: passing context but not to `op`

```go
// WRONG
func (r *Retrier) Do(ctx context.Context, op func() error) error {
    // ... uses ctx for sleep, but op does not see it
}
```

The operation must use the context too, or it can run past the deadline. Make `op` accept `context.Context`.

### Anti-pattern 6: shared mutable `*rand.Rand` without lock

```go
// WRONG (pre Go 1.20)
var r = rand.New(rand.NewSource(time.Now().UnixNano()))
func jitter() time.Duration {
    return time.Duration(r.Int63n(1000)) // race condition
}
```

Either lock or use the global `math/rand` (Go 1.20+).

### Anti-pattern 7: budget rate that is too tight

```go
// WRONG
budget := rate.NewLimiter(rate.Limit(1), 1) // 1 retry per second
```

Now even normal retry traffic is denied. Tune the budget based on observed retry RPS.

### Anti-pattern 8: deadline shorter than first attempt

```go
ctx, cancel := context.WithTimeout(parent, 50*time.Millisecond)
defer cancel()
// first attempt itself takes 100ms
```

The first call sees `ctx.Err()` immediately. No retries. Set the deadline larger than expected call latency.

### Anti-pattern 9: nested retries

```go
err := outerRetrier.Do(ctx, func(ctx context.Context) error {
    return innerRetrier.Do(ctx, op)
})
```

Multiplies retry budgets. If outer is 5 and inner is 5, you can do 25 inner calls. Usually you want only the outermost layer to retry.

### Anti-pattern 10: retry on `ctx.Err()`

```go
if err := op(ctx); err != nil {
    if errors.Is(err, context.Canceled) {
        // retry — WRONG!
    }
}
```

Cancellation is permanent for this operation. Do not retry. Return the cancel error.

---

## Appendix O: Where The Senior File Picks Up

If you have read this far, the next file (`senior.md`) covers:

- **The math behind thundering herd** in more depth — Markov chains, queueing theory, recovery dynamics.
- **The AWS Architecture Blog formulas** in detail — full derivations, simulation results.
- **Retry storms** — multi-tier failures, the "shouting in a crowded room" effect.
- **Deadline propagation** at the architecture level — request-scope deadlines, distributed deadlines, gRPC metadata.
- **Idempotency requirements** — the deep version: idempotency keys, request fingerprints, deduplication windows.

The senior file assumes you have internalised everything in this file. If any of the appendices feel hazy, re-read before moving on.

---

## Final Exercises (Middle)

Pick three or four to code. Solutions in `tasks.md`.

1. Implement `FullJitter`, `EqualJitter`, `DecorrelatedJitter` from memory.
2. Implement `sleepCtx` from memory.
3. Write a retry helper with all three plus context plus budget.
4. Simulate 1000 clients retrying with each strategy; plot the load profile.
5. Add deadline-honouring logic: clip the last sleep to the remaining time.
6. Write a test that asserts the retry returns within a deadline.
7. Write a test that asserts the budget denies after enough retries.
8. Add `Retry-After` parsing and integration: prefer the header over computed delays.
9. Modify the helper to support `Permanent` errors that bypass retry.
10. Build an HTTP-client wrapper using all the above and benchmark its allocation rate.

Once you can do all ten without referencing this file, you are ready for `senior.md`.

---

## Appendix P: Worked Example — A Background Worker With Retry

Let us walk through a complete worker that processes a job queue with exponential backoff, jitter, and context.

```go
package worker

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"yourmodule/retry"
)

type Job struct {
	ID      string
	Payload []byte
}

type Processor func(ctx context.Context, j Job) error

type Worker struct {
	Queue     <-chan Job
	Processor Processor
	Retrier   *retry.Retrier
	Logger    *slog.Logger
}

func (w *Worker) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			w.Logger.Info("worker stopping", "reason", ctx.Err())
			return
		case j, ok := <-w.Queue:
			if !ok {
				w.Logger.Info("queue closed")
				return
			}
			w.handle(ctx, j)
		}
	}
}

func (w *Worker) handle(ctx context.Context, j Job) {
	// Per-job context with a deadline.
	jobCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	err := w.Retrier.Do(jobCtx, func(ctx context.Context) error {
		return w.Processor(ctx, j)
	})
	if err != nil {
		w.Logger.Warn("job failed", "id", j.ID, "err", err)
		return
	}
	w.Logger.Debug("job succeeded", "id", j.ID)
}
```

Reading this carefully:

1. `Run` is the worker's main loop. It listens for either context cancellation or a new job.
2. Each job gets its own context with a 60-second deadline. This bounds *total* time including retries.
3. The retrier runs the processor. The processor sees the per-job context, so its own I/O respects the deadline.
4. Failure is logged at WARN.

This is a complete, production-ready shape. Add metrics (Appendix in `professional.md`) and you have something you can run.

---

## Appendix Q: Why Decorrelated Jitter Sometimes Wins

The AWS blog gives full jitter the laurels for most cases. But there are pathological inputs where decorrelated jitter wins. Let us see one.

Imagine a service that fails for exactly 10 seconds, then recovers. Clients retry every `base*2^n` ms (with jitter). The question: when do clients give up?

With full jitter at attempt 5 (`cap = 100ms * 32 = 3.2s`), the expected delay is 1.6s. So most clients are still around for the recovery at t=10s.

With decorrelated jitter starting from 100ms, the expected delays are roughly `300ms, 700ms, 1.5s, 3s, 6.5s` (each is `1.5 * prev` on expectation). After 5 attempts the elapsed time is roughly 12s. Clients are still around when the service recovers.

But here is the subtle point: decorrelated jitter has *higher variance in time-to-give-up*. Some clients finish all attempts in 6s; some in 18s. So the load on the recovering service is spread across a longer window. Less peak.

This is why decorrelated jitter is sometimes preferred when *recovery time is uncertain*. Full jitter's lower variance can cause clumping.

In practice, the differences are small enough that full jitter wins in most measured scenarios. Decorrelated is a reasonable choice if you have specific evidence.

---

## Appendix R: A Visual Summary

Here is the policy graph for a typical retrier:

```
                ┌─────────────────┐
   op(ctx) ───→ │   call dependency │
                └────────┬────────┘
                         │
                  err? ──┴── no → return success
                         │
                   yes (transient)
                         │
                  budget ┴── empty → return ErrBudgetExhausted
                         │
                    has tokens
                         │
                  compute delay ── full/equal/decorr jitter
                         │
                  clip delay ── if exceeds ctx.Deadline
                         │
                  sleepCtx(ctx, delay)
                         │
                  ctx.Done? ── yes → return ctx.Err()
                         │
                         no
                         │
                  loop back to call
                         │
                  attempts exhausted? ── yes → return wrapped lastErr
```

Reading the graph: every decision point you must implement is a branch. Forgetting one is a bug. The structure is the same regardless of jitter strategy or budget configuration.

---

## Appendix S: Final Tips for Production-Adjacent Code

Some practical advice as you move toward the senior level:

1. **Measure before tuning.** Default policy is usually fine. Measure your retry rate and success-on-retry rate before changing parameters.
2. **Log retries selectively.** Successful first-try calls do not need a log. Retried-and-succeeded calls deserve INFO. Give-ups deserve WARN.
3. **Expose retry metrics.** A counter for "retries performed" and a histogram for "attempt count at success" are essential for SRE.
4. **Treat retries as a circuit-breaker input.** If you record errors into a breaker, retries should not record duplicates — usually only the first failure of each retry sequence counts.
5. **Test the failure modes.** Inject errors deliberately and confirm the retry behaves.
6. **Document the policy in the public API.** Callers should know the worst-case latency.
7. **Use the same policy across similar dependencies.** Centralise.
8. **Re-evaluate annually.** Workloads change; default parameters can drift.

This is enough to be effective at the middle level. The senior file digs into the architecture and the math.



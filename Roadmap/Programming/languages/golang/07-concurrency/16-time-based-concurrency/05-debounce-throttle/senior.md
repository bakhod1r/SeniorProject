---
layout: default
title: Senior
parent: Debounce and Throttle
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/05-debounce-throttle/senior/
---

# Debounce and Throttle — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Why "Senior" Means Building the Primitive Yourself](#why-senior-means-building-the-primitive-yourself)
3. [Token Bucket — The Mathematics](#token-bucket--the-mathematics)
4. [Token Bucket — A Production-Grade Implementation](#token-bucket--a-production-grade-implementation)
5. [Leaky Bucket — The Mathematics](#leaky-bucket--the-mathematics)
6. [Leaky Bucket — Implementations](#leaky-bucket--implementations)
7. [Token Bucket vs Leaky Bucket — Choosing](#token-bucket-vs-leaky-bucket--choosing)
8. [Sliding Window Counter](#sliding-window-counter)
9. [Sliding Window Log](#sliding-window-log)
10. [Generic Cell Rate Algorithm (GCRA)](#generic-cell-rate-algorithm-gcra)
11. [The Cost of `time.Now`](#the-cost-of-timenow)
12. [Atomic-Based Throttles](#atomic-based-throttles)
13. [Lock-Free Counters](#lock-free-counters)
14. [Sharding for Throughput](#sharding-for-throughput)
15. [Debouncer Deep Dive](#debouncer-deep-dive)
16. [Concurrency-Safe Debouncers](#concurrency-safe-debouncers)
17. [Coalescing Debouncers](#coalescing-debouncers)
18. [Distributed Throttling — Redis](#distributed-throttling--redis)
19. [Distributed Throttling — Consensus and Approximation](#distributed-throttling--consensus-and-approximation)
20. [Adaptive Throttling](#adaptive-throttling)
21. [Hierarchical Token Buckets](#hierarchical-token-buckets)
22. [Observability for Rate Limiters](#observability-for-rate-limiters)
23. [Benchmarks and Microbenchmarks](#benchmarks-and-microbenchmarks)
24. [Failure Modes and Pathologies](#failure-modes-and-pathologies)
25. [Self-Assessment](#self-assessment)
26. [Summary](#summary)

---

## Introduction

At the middle level you learned how to call `golang.org/x/time/rate` and how to wire a debouncer onto `time.AfterFunc`. At the senior level the questions change. The library is not a black box; it is a particular implementation of a token bucket with particular trade-offs that you must be able to justify in a design review. The debouncer is not just a one-shot timer; it is a coalescer with a precise contract about which event "wins" and under what timing guarantees.

This document covers the engineering substance behind every production rate limiter you will write: the math of token buckets and leaky buckets, the algorithms used by sliding-window counters and GCRA, the surprisingly expensive cost of reading the clock, the design of lock-free atomic counters, the technique of sharding to escape contention on a single counter, and the patterns for extending a local throttle into a cluster-wide one with Redis or a coordinator. We also revisit debounce with the eye of someone who has been bitten by races inside `Timer.Reset` and by goroutine leaks when a debouncer outlived its owner.

The patterns here are the ones that ship in real services that handle tens of thousands of requests per second per process, that have to provide rate-limit headers to clients, that have to drop log lines when the disk is full, and that have to debounce a fire-hose of cache invalidations into a single rebuild.

---

## Why "Senior" Means Building the Primitive Yourself

A junior reaches for `rate.Limiter`. A middle uses it correctly with a context and a graceful fallback. A senior knows when `rate.Limiter` is wrong, when it is right, and how to replace it with a custom structure that fits the workload.

You will reach for a custom implementation in at least four situations:

1. The workload is so hot that the lock inside `rate.Limiter` becomes a bottleneck. A million calls per second on a single limiter saturates the mutex and your tail latency exposes contention spikes.
2. The semantics are subtly different — for example a true fixed-window counter with reset-on-the-minute boundary, or a leaky bucket with a strict outflow rate that smooths bursts rather than allowing them.
3. The limiter must be distributed across processes. The local token bucket gives wrong totals when ten instances each enforce 100 RPS but you want a global 100 RPS.
4. The limiter must be observable in a way the library does not support — for example exposing the current token count to Prometheus, recording reasons for denial, sampling the wait distribution.

The senior level is built on the understanding that a rate limiter is, at its core, three lines of math and a clock. Once you can write the math you can shape it to fit any workload.

### Three properties of every rate limiter

Every rate limiter, whether it is a token bucket, a leaky bucket, a sliding window, or a custom contraption, has three properties:

1. **Rate** — the steady-state number of permitted events per unit of time. Usually expressed as `r` events per second.
2. **Burst** — the maximum number of events allowed back-to-back when the limiter has been idle. Usually expressed as `b` events.
3. **Behavior on overflow** — what happens when an event would exceed the limit. The choices are *block* (wait until allowed), *drop* (reject immediately), or *queue* (admit but delay).

Any rate limiter can be characterised by these three values. The differences between algorithms come from how they account for time and how they compose under bursty input.

### A note on terminology

Throughout this document we will use the words "permit" and "token" interchangeably. A "permit" is the abstract unit of admission; a "token" is the concrete representation inside a token bucket. When you "take a token" or "acquire a permit" you are doing the same thing: asking the limiter whether the next event is allowed.

We will also use "request" loosely. A request can be an incoming HTTP call, an outgoing API call, a log line, a metric emission, or any unit of work that you want to rate-limit. The algorithms are the same regardless of what the requests are.

---

## Token Bucket — The Mathematics

A token bucket is the dominant rate-limiting algorithm in production systems. It is the model used by `golang.org/x/time/rate`, by AWS, by GCP, by virtually every cloud rate limiter you will ever encounter.

The model is simple. Imagine a bucket with capacity `b`. The bucket starts full. Tokens drip in at rate `r` per second. The bucket cannot hold more than `b` tokens; surplus tokens spill over and are lost. Each request consumes one token (or `n` tokens for a weighted request). If there are not enough tokens, the request is denied or blocked.

### Why this works

The bucket gives you two properties simultaneously:

- **Long-term rate**: over any sufficiently long interval the average admission rate is at most `r`, because tokens cannot accumulate beyond `b` so the total tokens drawn over a long interval is bounded by `r * T + b`.
- **Burst tolerance**: an idle period accumulates tokens up to `b`, so a sudden burst of up to `b` requests is admitted immediately. This matches the way real workloads arrive: idle for a while, then a flurry.

The mathematical formulation: let `t_now` be the current time and `t_last` be the last time the bucket was updated. The number of tokens accumulated since the last update is `(t_now - t_last) * r`, capped at `b`. After updating, the bucket has `min(b, tokens_old + (t_now - t_last) * r)` tokens. A request for `k` tokens is admitted if and only if `tokens >= k`, in which case `tokens` decreases by `k`.

### Continuous vs discrete time

Two ways to model the bucket:

1. **Continuous**: tokens are a real number that grows continuously over time. This is the model used by `golang.org/x/time/rate`. It is mathematically clean and lock-free updates are easy.
2. **Discrete**: the bucket holds integer tokens, refilled on a clock tick. This is closer to how a textbook describes the algorithm, but it requires a background goroutine or external tick and the granularity of the tick matters.

Continuous time is almost always the right choice for software rate limiters. There is no reason to have a background goroutine ticking when you can compute the refill on demand.

### Worked example

Suppose `r = 10` tokens per second and `b = 20`. The bucket starts full with 20 tokens.

At `t = 0` ten requests arrive simultaneously. Each consumes one token. The bucket has 10 tokens left.

At `t = 1 second` we have accumulated `1 * 10 = 10` more tokens, so the bucket would have `10 + 10 = 20` tokens, capped at 20. So the bucket is full again.

At `t = 1` thirty requests arrive simultaneously. The first 20 each consume a token. The next 10 are denied (or wait). The bucket is empty.

At `t = 1.5` we have accumulated `0.5 * 10 = 5` tokens since the last update. The bucket has 5 tokens. Five of the queued requests can proceed; the rest must keep waiting.

At `t = 2` we have accumulated another `0.5 * 10 = 5` tokens. The bucket has 10 tokens. The remaining queued requests proceed.

The total admitted over `[0, 2]` is `10 + 20 + 5 + 5 = 40`, which is less than `r * 2 + b = 10 * 2 + 20 = 40`. The bound is tight.

### The "deficit" formulation

An equivalent and often more elegant formulation: instead of counting tokens, count the *deficit* between the next allowed time and now. Each event advances the deficit by `1 / r`. The event is admitted if the deficit is in the past (or within `b / r` of the future, for burst). This is the GCRA approach, covered later.

### Weighted requests

Some workloads have requests of varying cost. An expensive endpoint might consume 5 tokens; a cheap one consumes 1. The math still works: replace "one token per request" with "k tokens per request." The bucket is admitted if `tokens >= k`, otherwise the request waits `(k - tokens) / r` seconds for enough tokens to accumulate.

This generalises nicely to weighted requests: an LLM endpoint might charge tokens equal to the input length, a database endpoint might charge by the number of rows, a network endpoint might charge by bytes. The bucket model is agnostic to what a "token" represents.

---

## Token Bucket — A Production-Grade Implementation

Let's write a token bucket from scratch that is competitive with `rate.Limiter` for our purposes.

### Version 1: a straightforward mutex-protected bucket

```go
package tokenbucket

import (
    "sync"
    "time"
)

type Bucket struct {
    mu       sync.Mutex
    rate     float64 // tokens per second
    capacity float64 // maximum tokens
    tokens   float64
    last     time.Time
}

func New(rate, capacity float64) *Bucket {
    return &Bucket{
        rate:     rate,
        capacity: capacity,
        tokens:   capacity,
        last:     time.Now(),
    }
}

func (b *Bucket) Allow() bool {
    return b.AllowN(1)
}

func (b *Bucket) AllowN(n float64) bool {
    b.mu.Lock()
    defer b.mu.Unlock()
    now := time.Now()
    elapsed := now.Sub(b.last).Seconds()
    b.tokens += elapsed * b.rate
    if b.tokens > b.capacity {
        b.tokens = b.capacity
    }
    b.last = now
    if b.tokens >= n {
        b.tokens -= n
        return true
    }
    return false
}
```

This is simple, correct, and probably fast enough for 100k QPS on a single core. The mutex is the bottleneck under heavier load.

### Version 2: pre-computed reciprocal for performance

Multiplication is cheaper than division on every CPU we care about. Pre-compute `1/rate` once so refill is a multiply, not a divide.

```go
type Bucket struct {
    mu       sync.Mutex
    rate     float64
    capacity float64
    tokens   float64
    last     time.Time
}

func (b *Bucket) refill(now time.Time) {
    elapsed := now.Sub(b.last).Seconds()
    if elapsed <= 0 {
        return
    }
    b.tokens += elapsed * b.rate
    if b.tokens > b.capacity {
        b.tokens = b.capacity
    }
    b.last = now
}

func (b *Bucket) AllowN(n float64) bool {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.refill(time.Now())
    if b.tokens >= n {
        b.tokens -= n
        return true
    }
    return false
}
```

This factors out the refill logic. The mutex is still held across `time.Now()`, which on Linux is one VDSO call (~15 ns); the entire `AllowN` typically runs in 60-80 ns per call when the bucket is hot.

### Version 3: wait-aware

Sometimes you want the limiter to compute *when* the next token will be available, so the caller can sleep until then.

```go
func (b *Bucket) Reserve(n float64) time.Duration {
    b.mu.Lock()
    defer b.mu.Unlock()
    now := time.Now()
    b.refill(now)
    if b.tokens >= n {
        b.tokens -= n
        return 0
    }
    deficit := n - b.tokens
    wait := time.Duration(deficit / b.rate * float64(time.Second))
    b.tokens = 0
    b.last = now.Add(wait) // schedule the consumption in the future
    return wait
}
```

Notice the subtlety: when we reserve a future slot we move `b.last` forward, ensuring subsequent calls compute the refill from the new "future" anchor. This is exactly what `rate.Limiter.Reserve` does internally.

If a caller does not honor the wait, the bucket will still be correct on the next call, because the token count was decremented and `b.last` was advanced. The reservation is "consumed" regardless of what the caller does — there is no API to cancel it. This trade-off keeps the algorithm wait-free internally.

### Version 4: cancellable wait

```go
func (b *Bucket) Wait(ctx context.Context, n float64) error {
    wait := b.Reserve(n)
    if wait == 0 {
        return nil
    }
    select {
    case <-time.After(wait):
        return nil
    case <-ctx.Done():
        // Best-effort restore: try to return the tokens to the bucket.
        b.mu.Lock()
        b.tokens += n
        if b.tokens > b.capacity {
            b.tokens = b.capacity
        }
        b.mu.Unlock()
        return ctx.Err()
    }
}
```

The cancellation-aware version is necessary in real services because requests time out, clients disconnect, and a limiter that holds a goroutine for ten seconds when the caller's context expired after two is leaking work. The "restore" branch is a best-effort return of unused tokens — it does not perfectly preserve fairness (a later caller may have consumed in the interim) but it prevents pathological waste.

### Version 5: avoiding allocations

`time.After` allocates a `time.Timer`. For a limiter on a hot path that allocation becomes a measurable cost. Use a `time.Timer` from a `sync.Pool` instead.

```go
var timerPool = sync.Pool{
    New: func() interface{} {
        t := time.NewTimer(time.Hour)
        if !t.Stop() {
            <-t.C
        }
        return t
    },
}

func getTimer(d time.Duration) *time.Timer {
    t := timerPool.Get().(*time.Timer)
    t.Reset(d)
    return t
}

func putTimer(t *time.Timer) {
    if !t.Stop() {
        select {
        case <-t.C:
        default:
        }
    }
    timerPool.Put(t)
}

func (b *Bucket) Wait(ctx context.Context, n float64) error {
    wait := b.Reserve(n)
    if wait == 0 {
        return nil
    }
    t := getTimer(wait)
    defer putTimer(t)
    select {
    case <-t.C:
        return nil
    case <-ctx.Done():
        b.mu.Lock()
        b.tokens += n
        if b.tokens > b.capacity {
            b.tokens = b.capacity
        }
        b.mu.Unlock()
        return ctx.Err()
    }
}
```

This pool reduces allocations from roughly one timer per `Wait` call (the channel inside `time.After`) to near zero in steady state. On a workload of 100k `Wait` calls per second the difference is measurable: an extra megabyte of garbage per second versus negligible allocation.

### Version 6: tight-path AllowN with no allocations

The bare `AllowN` already has no heap allocations, but `time.Now` is a non-trivial call. Profiling on a hot service typically shows `time.Now` accounting for 5-15% of CPU when the limiter is the bottleneck. We will discuss techniques for amortising `time.Now` later in this document.

### Picking initial state

A subtle question: when the bucket is first constructed, should it start full or empty?

Starting full means the first burst of `b` events is immediately admitted. This is friendly to clients that send a small burst at startup (cache warmup, batch initial sync) but it allows a "thundering herd" effect when many processes start simultaneously.

Starting empty is conservative: every request from time zero is subject to the rate. This produces smoother startup behaviour but can frustrate clients that legitimately need a startup burst.

The conventional default — used by `rate.Limiter` — is to start full. Override it if your workload prefers conservative startup.

### Choosing `r` and `b`

The two parameters interact subtly:

- `r` is the long-term rate. Pick it to match the downstream system's capacity.
- `b` is the burst. Pick it to match the latency budget you can tolerate for a backlog to clear.

If the bucket runs full and a burst of `b` requests arrives, they all clear immediately. The next burst must wait until tokens refill. So a large `b` gives bursty workloads good latency but a small `b` smooths the load. The right answer depends on the downstream tolerance.

A common heuristic: `b = r * 1` (i.e. one second of refill) gives a one-second burst tolerance and smoothes longer bursts. For UI workloads `b = r * 0.5` is common; for batch workloads `b = r * 5` or more is reasonable.

---

## Leaky Bucket — The Mathematics

The leaky bucket is the older sibling of the token bucket and is sometimes confused with it. The two algorithms have different operational semantics.

The model: imagine a bucket with capacity `c` and a hole at the bottom that drains at rate `r` per second. Each request adds one unit of water to the bucket. If the bucket would overflow (the water level exceeds `c`), the request is denied.

The crucial difference from a token bucket: the leaky bucket *smooths the outflow*. The token bucket smooths the inflow but allows bursts at the output. The leaky bucket guarantees the output rate is at most `r`, never more. There are no bursts at the output.

### Two leaky bucket variants

There are actually two variants of the leaky bucket, frequently conflated:

1. **Leaky bucket as a meter** (sometimes called "leaky bucket counter"). The bucket level is tracked but the requests are not delayed — they are admitted or denied based on the level. This is operationally similar to a token bucket and is sometimes used interchangeably.

2. **Leaky bucket as a queue** (sometimes called "leaky bucket scheduler"). The bucket is a FIFO queue with capacity `c`. Requests are enqueued and dequeued at rate `r`. This adds latency but absolutely smooths the output rate.

The "queue" variant is what gives the leaky bucket its distinctive smoothing behaviour. The "meter" variant is essentially a renamed token bucket with capacity flipped.

### Worked example — meter variant

Suppose `r = 10` per second and `c = 20`. The bucket starts empty.

At `t = 0` ten requests arrive. The bucket fills to 10. All are admitted.

At `t = 0.5` ten more requests arrive. Since the last update, the bucket has drained by `0.5 * 10 = 5`, leaving 5. The ten new requests would push it to 15, still under 20. All admitted.

At `t = 1` thirty more requests arrive. The bucket has drained by another `0.5 * 10 = 5`, leaving 10. The next 10 requests fit, pushing it to 20. The remaining 20 do not fit and are denied.

The cumulative admitted is `10 + 10 + 10 = 30` in 1 second, which is `r * 1 + c = 10 + 20 = 30`. The bound matches the token bucket bound exactly.

### Worked example — queue variant

Same parameters. At `t = 0` ten requests arrive. They join the queue. The queue contains 10 items.

At `t = 1` the queue has been draining at 10 per second, so all ten have been dispatched at evenly spaced times: `t = 0`, `t = 0.1`, `t = 0.2`, ..., `t = 0.9`. The queue is empty at `t = 1`.

At `t = 1` thirty more requests arrive. They join the queue, but the queue has capacity 20, so the last 10 are denied. The remaining 20 are dispatched at `t = 1, 1.1, 1.2, ..., 2.9`.

The output rate is exactly 10 per second. The maximum delay is 2 seconds (the time to clear a full queue of 20 at rate 10).

This smoothing comes at a cost: latency. The queue variant has bounded latency `c / r` for any admitted request.

### When to choose leaky bucket over token bucket

Choose leaky bucket (queue variant) when:

- The downstream system cannot handle bursts at all. A serial-port driver, a single-threaded legacy service, a cache that thrashes when many writes arrive at once.
- The smoothed delivery has business value. Pacing outgoing email so the recipient SMTP server does not greylist you. Spacing out scraping requests so you do not look like a bot.
- You want a hard upper bound on latency. The queue-variant leaky bucket gives `latency <= c / r`.

Choose token bucket when:

- The downstream system can handle bursts.
- You care about low latency for the common case (most requests, the bucket has tokens, they are immediate).
- You want simple math and easy distributed coordination.

---

## Leaky Bucket — Implementations

### Meter variant

```go
package leakybucket

import (
    "sync"
    "time"
)

type MeterBucket struct {
    mu       sync.Mutex
    rate     float64 // drain rate in units per second
    capacity float64
    level    float64
    last     time.Time
}

func NewMeter(rate, capacity float64) *MeterBucket {
    return &MeterBucket{
        rate:     rate,
        capacity: capacity,
        last:     time.Now(),
    }
}

func (b *MeterBucket) Allow() bool {
    return b.AllowN(1)
}

func (b *MeterBucket) AllowN(n float64) bool {
    b.mu.Lock()
    defer b.mu.Unlock()
    now := time.Now()
    elapsed := now.Sub(b.last).Seconds()
    b.level -= elapsed * b.rate
    if b.level < 0 {
        b.level = 0
    }
    b.last = now
    if b.level+n <= b.capacity {
        b.level += n
        return true
    }
    return false
}
```

This is essentially the token bucket flipped: instead of decrementing tokens, we increment the level, and the refill drains the level. The math is symmetric.

### Queue variant

```go
package leakybucket

import (
    "context"
    "errors"
    "sync"
    "time"
)

type QueueBucket struct {
    mu        sync.Mutex
    rate      time.Duration // 1/r seconds between drains
    capacity  int
    pending   int
    nextDrain time.Time
    cond      *sync.Cond
}

func NewQueue(ratePerSec, capacity int) *QueueBucket {
    b := &QueueBucket{
        rate:     time.Second / time.Duration(ratePerSec),
        capacity: capacity,
    }
    b.cond = sync.NewCond(&b.mu)
    return b
}

var ErrFull = errors.New("queue full")

func (b *QueueBucket) Submit(ctx context.Context) error {
    b.mu.Lock()
    for {
        now := time.Now()
        if b.nextDrain.Before(now) {
            b.nextDrain = now
        }
        // Drain virtual slots that have elapsed.
        for b.pending > 0 && !b.nextDrain.After(now) {
            b.pending--
            b.nextDrain = b.nextDrain.Add(b.rate)
        }
        if b.pending < b.capacity {
            b.pending++
            mySlot := b.nextDrain.Add(time.Duration(b.pending-1) * b.rate)
            b.mu.Unlock()
            wait := time.Until(mySlot)
            if wait <= 0 {
                return nil
            }
            select {
            case <-time.After(wait):
                return nil
            case <-ctx.Done():
                return ctx.Err()
            }
        }
        // Queue full: wait for a drain.
        next := b.nextDrain
        b.mu.Unlock()
        wait := time.Until(next)
        if wait < 0 {
            wait = 0
        }
        select {
        case <-time.After(wait):
        case <-ctx.Done():
            return ctx.Err()
        }
        b.mu.Lock()
    }
}
```

This is more complex than the meter variant because we track virtual slot times for each pending item. The implementation is illustrative but not optimal — a real implementation would use a heap or a delay queue.

A simpler and more common approach: implement the queue variant by combining a buffered channel with a goroutine that drains it on a `time.Ticker`. The channel's buffer size is the bucket capacity, and the ticker enforces the drain rate.

```go
type SimpleQueueBucket struct {
    in   chan struct{}
    out  chan struct{}
    rate time.Duration
    stop chan struct{}
}

func NewSimpleQueue(ratePerSec, capacity int) *SimpleQueueBucket {
    b := &SimpleQueueBucket{
        in:   make(chan struct{}, capacity),
        out:  make(chan struct{}),
        rate: time.Second / time.Duration(ratePerSec),
        stop: make(chan struct{}),
    }
    go b.drain()
    return b
}

func (b *SimpleQueueBucket) drain() {
    t := time.NewTicker(b.rate)
    defer t.Stop()
    for {
        select {
        case <-b.stop:
            return
        case <-t.C:
            select {
            case <-b.in:
                b.out <- struct{}{}
            default:
            }
        }
    }
}

func (b *SimpleQueueBucket) Submit(ctx context.Context) error {
    select {
    case b.in <- struct{}{}:
    case <-ctx.Done():
        return ctx.Err()
    default:
        return ErrFull
    }
    select {
    case <-b.out:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (b *SimpleQueueBucket) Stop() {
    close(b.stop)
}
```

This is concise, correct, and lets the runtime do the scheduling work. The downside: it requires a long-lived goroutine and the ticker keeps the scheduler active even when no requests arrive.

---

## Token Bucket vs Leaky Bucket — Choosing

Let's make the choice concrete with three scenarios.

### Scenario 1: rate-limiting an external API client

You make calls to a payment provider that allows 100 RPS with a burst of 200. You want to maximise throughput while respecting the limit.

**Choose token bucket**. The provider explicitly accommodates bursts. A leaky bucket would needlessly delay requests during quiet periods. Set `r = 100`, `b = 200`. Use `rate.Limiter`.

### Scenario 2: rate-limiting outgoing email

You send marketing email through an SMTP relay. The relay limits you to 60 emails per minute. If you exceed it your IP is throttled or blocked.

**Choose leaky bucket (queue variant)**. The relay cares about the smoothed rate. A token bucket would let 60 emails through in the first second, then nothing for a minute, then 60 more — which looks like spam behaviour and may get you flagged. The queue variant smooths the output to one email per second.

### Scenario 3: rate-limiting a background job worker

Your worker pulls from a queue and processes jobs. You want to cap the worker at 1000 jobs per minute to avoid swamping the database. Jobs arrive in bursts.

**Choose token bucket**. The database can handle bursts (it has its own buffering). Smooth delivery is a non-goal. Set `r = 1000/60`, `b = 1000`. The worker can process up to 1000 jobs as fast as it likes when starting, then settles into the long-term rate.

### Scenario 4: protecting a public API endpoint

You expose an endpoint that authenticated users can call. You want each user limited to 100 requests per minute, but you do not want to penalise users for legitimate bursts.

**Choose token bucket** with per-user keys. Set `r = 100/60 ≈ 1.67`, `b = 100`. Users can burst up to 100 requests if they have been quiet, but cannot sustain more than 100 per minute.

### Hybrid: leaky-meter feeding a token bucket

A common architecture for protecting a downstream from a public-facing service:

```
[clients] -> [public token bucket per IP] -> [internal leaky meter to backend] -> [backend]
```

The token bucket gives clients a friendly burst-aware experience. The leaky bucket gives the backend a hard rate limit. The two compose naturally and give you defence in depth.

---

## Sliding Window Counter

The sliding window counter is the third big algorithm in this space. It avoids the "bucket reset" problem of fixed-window counters while being cheaper than a sliding window log.

### Fixed window — and its problem

A fixed window counter divides time into windows (say, one minute each) and counts requests per window. If the count exceeds the limit, the request is denied. At the boundary, the count resets.

The problem: a client can get 2x the intended rate by clustering requests around the boundary. If the limit is 100 per minute, the client sends 100 in the last second of minute 1 and 100 in the first second of minute 2 — that is 200 requests in two seconds.

### Sliding window log — the gold standard

Keep a log of every request's timestamp. To check a request, count how many timestamps are within the last `T` seconds. If under the limit, admit; record the timestamp.

This is exact but expensive: memory proportional to the number of requests in the window, and the count is `O(log N)` (binary search the sorted log) or `O(N)` (linear scan). For a single host at 10k RPS with a 60-second window that is 600k entries, which is workable but not free.

### Sliding window counter — the practical approximation

Instead of a full log, store the count for the current and previous fixed windows. Interpolate.

Let `c_current` be the count in the current window, `c_prev` the count in the previous window, and `f` the fraction of the current window elapsed (between 0 and 1). The estimated count in the trailing window of one window-width is:

```
estimate = c_prev * (1 - f) + c_current
```

Intuition: `(1 - f)` is the fraction of the previous window that still lies within the trailing window. The estimate weights the previous window's count by how much of it still applies.

If `estimate < limit`, admit and increment `c_current`. Otherwise deny.

```go
package sliding

import (
    "sync"
    "time"
)

type Counter struct {
    mu         sync.Mutex
    windowSize time.Duration
    limit      int
    current    int
    previous   int
    windowEnd  time.Time
}

func NewCounter(windowSize time.Duration, limit int) *Counter {
    return &Counter{
        windowSize: windowSize,
        limit:      limit,
        windowEnd:  time.Now().Add(windowSize),
    }
}

func (c *Counter) Allow() bool {
    c.mu.Lock()
    defer c.mu.Unlock()
    now := time.Now()
    for now.After(c.windowEnd) {
        c.previous = c.current
        c.current = 0
        c.windowEnd = c.windowEnd.Add(c.windowSize)
    }
    elapsed := c.windowSize - c.windowEnd.Sub(now)
    f := float64(elapsed) / float64(c.windowSize)
    estimate := float64(c.previous)*(1-f) + float64(c.current)
    if int(estimate) < c.limit {
        c.current++
        return true
    }
    return false
}
```

The error of the estimate is bounded by `c_prev / 2` in the worst case, because the assumption that requests in the previous window were uniformly distributed is approximate. For most workloads the error is small (a few percent), and the savings in memory and CPU are enormous compared to the full log.

### When sliding-window counter is the right tool

- Per-IP rate limiting where the rate is moderate (tens to thousands per minute) and you cannot store every request timestamp.
- Distributed rate limiting where the storage cost of a log per key is prohibitive.
- Cases where the bucket-based limiters' "burst at the start" is undesirable.

### Sliding window counter vs token bucket

Both algorithms enforce a long-term rate. The key behavioural differences:

1. Token bucket allows bursts up to `b`; sliding window strictly enforces the rate over the trailing window.
2. Token bucket is `O(1)` per call; sliding window is `O(1)` per call with the counter approximation.
3. Token bucket is friendlier to legitimate clients; sliding window is harder for attackers to game.

For per-user limits on a public API, sliding window counter is a common choice because it is harder to game than fixed window and cheaper than a log.

---

## Sliding Window Log

When you need exact counts in a sliding window (no approximation, no boundary effects), the log is the only option.

```go
package slidinglog

import (
    "sync"
    "time"
)

type Log struct {
    mu         sync.Mutex
    windowSize time.Duration
    limit      int
    entries    []time.Time
}

func New(windowSize time.Duration, limit int) *Log {
    return &Log{
        windowSize: windowSize,
        limit:      limit,
        entries:    make([]time.Time, 0, limit),
    }
}

func (l *Log) Allow() bool {
    l.mu.Lock()
    defer l.mu.Unlock()
    now := time.Now()
    cutoff := now.Add(-l.windowSize)
    // Drop entries older than the window.
    i := 0
    for i < len(l.entries) && l.entries[i].Before(cutoff) {
        i++
    }
    l.entries = l.entries[i:]
    if len(l.entries) < l.limit {
        l.entries = append(l.entries, now)
        return true
    }
    return false
}
```

Performance characteristics:

- `O(K)` per call where `K` is the number of expired entries. Amortised this is `O(1)` per call because each entry is removed exactly once.
- Memory proportional to the number of in-window entries. With a limit `N` the memory is `O(N)`.

For most rate-limiting use cases the log is overkill, but for billing-grade or compliance-grade limits — where every request must be exactly accounted for — the log is the right tool.

### Trimming the log

The naive trim above moves the head pointer, but the underlying slice keeps growing without shrinking. After a burst the slice may hold the maximum capacity even when only a few entries are live. Two fixes:

1. Use a ring buffer of fixed capacity equal to the limit. New entries overwrite the oldest. This bounds memory at exactly `limit` entries.
2. Periodically copy live entries to a new slice. Trades CPU for memory.

```go
type RingLog struct {
    mu         sync.Mutex
    windowSize time.Duration
    entries    []time.Time
    head       int
    size       int
}

func NewRing(windowSize time.Duration, limit int) *RingLog {
    return &RingLog{
        windowSize: windowSize,
        entries:    make([]time.Time, limit),
    }
}

func (l *RingLog) Allow() bool {
    l.mu.Lock()
    defer l.mu.Unlock()
    now := time.Now()
    cutoff := now.Add(-l.windowSize)
    // Trim from the head.
    for l.size > 0 && l.entries[l.head].Before(cutoff) {
        l.head = (l.head + 1) % len(l.entries)
        l.size--
    }
    if l.size < len(l.entries) {
        l.entries[(l.head+l.size)%len(l.entries)] = now
        l.size++
        return true
    }
    return false
}
```

The ring buffer is what you use when memory matters and the limit is fixed at construction.

---

## Generic Cell Rate Algorithm (GCRA)

GCRA is the rate-limiting algorithm used in ATM (asynchronous transfer mode) networks and increasingly in software because of its excellent properties: it is `O(1)`, allocation-free, and uses a single floating-point or integer value per limiter.

### The idea

Instead of tracking tokens or counts, track a single value: the "theoretical arrival time" (TAT). This is the time at which the next cell (request) is "scheduled" to arrive. If a request arrives before TAT minus the tolerance, deny. Otherwise advance TAT by the period.

Two parameters:
- `T` = `1/rate`: the period between requests at steady state.
- `tau`: the tolerance, equivalent to `(b - 1) * T` where `b` is the burst.

The algorithm:

```
On request at time `now`:
    if now < TAT - tau: deny
    else: TAT = max(now, TAT) + T; admit
```

### Why this works

The invariant: `TAT - tau <= now <= TAT` at admission time. This means the request is within `tau` of "schedule" (early by at most `tau`, never later). Over a long interval the average period is `T`, so the long-term rate is `1/T`. Over a short interval the request can be up to `tau / T` early, giving burst tolerance.

### Implementation

```go
package gcra

import (
    "sync"
    "time"
)

type GCRA struct {
    mu        sync.Mutex
    period    time.Duration // T = 1/rate
    tolerance time.Duration // tau
    tat       time.Time
}

func New(ratePerSec, burst float64) *GCRA {
    period := time.Duration(float64(time.Second) / ratePerSec)
    tolerance := time.Duration(float64(burst-1) * float64(period))
    return &GCRA{period: period, tolerance: tolerance, tat: time.Now()}
}

func (g *GCRA) Allow() bool {
    g.mu.Lock()
    defer g.mu.Unlock()
    now := time.Now()
    if now.Before(g.tat.Add(-g.tolerance)) {
        return false
    }
    newTAT := g.tat
    if now.After(newTAT) {
        newTAT = now
    }
    newTAT = newTAT.Add(g.period)
    g.tat = newTAT
    return true
}

func (g *GCRA) AllowAt(now time.Time) (bool, time.Duration) {
    g.mu.Lock()
    defer g.mu.Unlock()
    if now.Before(g.tat.Add(-g.tolerance)) {
        retry := g.tat.Add(-g.tolerance).Sub(now)
        return false, retry
    }
    newTAT := g.tat
    if now.After(newTAT) {
        newTAT = now
    }
    newTAT = newTAT.Add(g.period)
    g.tat = newTAT
    return true, 0
}
```

`AllowAt` returns the time the caller would need to wait before retrying. This is a clean API for clients that want to back off and retry rather than block.

### GCRA's advantages

- **Single state value**: `tat` is the only mutable field. This is friendly to atomic implementations.
- **`O(1)` time**: no loops, no allocations.
- **Burst semantics match token bucket**: GCRA with `tau = (b-1) * T` is mathematically equivalent to a token bucket with rate `1/T` and burst `b`.

### Atomic GCRA

Because GCRA's state is one value, we can implement it lock-free with a CAS loop:

```go
package gcra

import (
    "sync/atomic"
    "time"
)

type AtomicGCRA struct {
    period    int64 // nanoseconds
    tolerance int64
    tat       atomic.Int64
}

func NewAtomic(ratePerSec, burst float64) *AtomicGCRA {
    period := int64(float64(time.Second) / ratePerSec)
    tolerance := int64(float64(burst-1) * float64(period))
    g := &AtomicGCRA{period: period, tolerance: tolerance}
    g.tat.Store(time.Now().UnixNano())
    return g
}

func (g *AtomicGCRA) Allow() bool {
    nowNs := time.Now().UnixNano()
    for {
        old := g.tat.Load()
        if nowNs < old-g.tolerance {
            return false
        }
        newTAT := old
        if nowNs > newTAT {
            newTAT = nowNs
        }
        newTAT += g.period
        if g.tat.CompareAndSwap(old, newTAT) {
            return true
        }
    }
}
```

Under low contention this is dramatically faster than the mutex version (the CAS retries are rare). Under high contention the CAS loop can spin, but in practice for rate limiters the contention is typically low because most calls are rejected quickly (failures do not retry CAS).

We will return to atomic implementations in detail when we discuss lock-free counters.

---

## The Cost of `time.Now`

Every rate limiter calls `time.Now` at least once per admission decision. On a hot path this matters.

### What `time.Now` actually costs

On Linux x86_64, Go's `time.Now` uses the kernel's VDSO (virtual dynamic shared object), which avoids a syscall and reads the time directly from a memory-mapped page. The CPU instruction is `rdtsc` or `rdtscp` followed by some arithmetic. Typical cost:

- Linux x86_64: ~15-25 ns
- Linux arm64: ~20-30 ns
- macOS: ~30-50 ns (no VDSO; uses commpage but slightly slower)
- Windows: ~25-40 ns

On a CPU that runs at 3 GHz with an IPC of 3, 25 ns is roughly 225 useful instructions. That is more than the entire body of a hot `Allow()` call. So `time.Now` can easily be the dominant cost of a rate limiter.

### Why is it not faster?

`time.Now` does more than `rdtsc`:

1. It reads the current clock source state (kernel-shared page on Linux).
2. It converts from raw cycles to nanoseconds using a scaling factor that accounts for clock drift.
3. It optionally reads the monotonic and wall clocks separately.
4. It wraps the result in a `time.Time` struct (24 bytes on 64-bit Go).

Go added the "monotonic clock embedded in `time.Time`" feature in Go 1.9, which doubles the size of the returned value but enables correct duration subtraction even when the wall clock jumps.

### Caching `time.Now`

If you have many calls per second that can tolerate millisecond-stale time values, you can amortise `time.Now` by reading it once per tick and caching.

```go
package fasttime

import (
    "sync/atomic"
    "time"
)

var nowNs atomic.Int64

func init() {
    nowNs.Store(time.Now().UnixNano())
    go func() {
        t := time.NewTicker(time.Millisecond)
        for range t.C {
            nowNs.Store(time.Now().UnixNano())
        }
    }()
}

func Now() int64 {
    return nowNs.Load()
}
```

`fasttime.Now()` returns the cached value, accurate to within ~1 ms. The cost of `Now` is a single atomic load (~1 ns). This is 15-25x faster than `time.Now`.

The trade-offs:

- 1 ms staleness. For a 100 RPS limiter the timing error is negligible. For a 100k RPS limiter the error is 100 events at the boundary — still well under the burst.
- A background ticker. The ticker itself is cheap but it does prevent the runtime from being entirely idle.
- A global. The cached time is process-wide; you cannot have multiple cached clocks.

For most rate limiters operating below 10k RPS, `time.Now` directly is fine. For higher rates `fasttime` is a measurable win.

### Per-CPU `time.Now` caching

A more advanced technique: cache `time.Now` per logical CPU using `runtime_procPin` (a private runtime function exposed in `golang.org/x/sys/cpu` indirectly via `runtime.LockOSThread` or sharding tricks). Each CPU reads its own cache, which avoids contention on the global atomic.

This is rarely necessary in practice. By the time you need it you should be considering whether your design has too much contention on a single counter.

### `time.Now` and clock skew

Go's `time.Now` uses the monotonic clock for duration calculations, immune to wall-clock jumps from NTP. Rate limiters always want monotonic time. If you compare two `time.Time` values with `Sub`, you are using monotonic time. If you call `UnixNano()` you get wall-clock nanoseconds, which can jump backward — be careful when caching `UnixNano()` and subtracting.

For our atomic GCRA above, we used `UnixNano()` for portability. In production, prefer `time.Time.Sub` with the monotonic reading, or use `runtime.nanotime` (unexported but accessible via `//go:linkname`) for the ultimate hot path.

### The "now hint" trick

Some APIs let the caller pass in `now`:

```go
func (g *GCRA) AllowAt(now time.Time) bool { ... }
```

This lets a caller that already has `now` (e.g., from a request log or a tracing span) avoid calling `time.Now` again. In a hot HTTP handler that records the request time anyway, the savings are real: one `time.Now` per request instead of two or three.

---

## Atomic-Based Throttles

For very hot paths the mutex inside a token bucket can be the dominant cost. The first optimisation is to replace it with atomic operations.

### Why atomic is faster than mutex

A `sync.Mutex` in Go is essentially a futex-backed atomic with fallback to scheduler queueing under contention. The uncontended fast path is ~15-25 ns. The contended path involves goroutine parking, OS thread interaction, and is much slower — easily a microsecond or more.

A `sync/atomic.CompareAndSwap` on Intel x86_64 is a single `LOCK CMPXCHG` instruction. Uncontended cost: ~5-10 ns. Contended cost: still microseconds-range because the cache line bounces between cores, but no scheduler involvement.

For a workload of mostly-uncontended limiter calls (say, many cores each calling once per request), atomic is consistently 2-3x faster than mutex. Under high contention the gap narrows because cache-line bouncing dominates.

### Atomic GCRA recap

We saw above an atomic GCRA. Let's repeat it with more commentary:

```go
type AtomicGCRA struct {
    period    int64
    tolerance int64
    tat       atomic.Int64 // 8 bytes, aligned to a cache line if isolated
}

func (g *AtomicGCRA) Allow() bool {
    nowNs := time.Now().UnixNano()
    for {
        old := g.tat.Load()
        if nowNs < old-g.tolerance {
            return false
        }
        newTAT := old
        if nowNs > newTAT {
            newTAT = nowNs
        }
        newTAT += g.period
        if g.tat.CompareAndSwap(old, newTAT) {
            return true
        }
    }
}
```

Notice that the deny path returns *without* a CAS. This means denied requests are free — they read the `tat`, decide no, and return. Only admitted requests modify state. For a heavily-throttled service where most requests are denied, this is a big win.

### Atomic token bucket — is it possible?

Yes, but harder than GCRA because the token bucket has two coupled state variables: the token count and the last refill time. We can pack them into a single `uint64` if we are clever.

```go
package atomicbucket

import (
    "sync/atomic"
    "time"
)

// state encodes [tokens:32 bits | lastNs:32 bits]
// tokens is fixed-point with 16 bits of fractional part: real = tokens / 65536
// lastNs is the last update time as ns since process start, mod 2^32 (~4.3 sec window)
// This is too narrow for general use; we'll discuss a wider encoding next.
```

Packing two values into a 64-bit atomic only works if both values fit. For a token bucket with reasonable token counts (millions) and a long-running process, 64 bits is not enough for both.

The practical approach: use a `uint64` for the bucket state and accept that the "last update" time is relative to a reference point that resets periodically. Or use a `sync.Mutex` for the bucket — the contention is usually fine for the workloads where token buckets are appropriate.

A simpler alternative: use atomic for the cheap "Allow" path and fall back to mutex for the slow "wait" path.

```go
type HybridBucket struct {
    mu       sync.Mutex
    rate     float64
    capacity float64
    state    atomic.Pointer[bucketState]
}

type bucketState struct {
    tokens float64
    last   int64 // unixnano
}

func (b *HybridBucket) Allow() bool {
    nowNs := time.Now().UnixNano()
    for {
        old := b.state.Load()
        elapsed := float64(nowNs-old.last) / 1e9
        tokens := old.tokens + elapsed*b.rate
        if tokens > b.capacity {
            tokens = b.capacity
        }
        if tokens < 1 {
            return false
        }
        ns := &bucketState{tokens: tokens - 1, last: nowNs}
        if b.state.CompareAndSwap(old, ns) {
            return true
        }
    }
}
```

Each successful admission allocates a new `bucketState`. That allocation is the cost of avoiding the mutex. For a workload with ~50% denial rate this is a wash; for a mostly-admitted workload the allocations dominate and mutex wins.

A variant uses `sync.Pool` for the state objects, but then you need careful tracking of which states are still referenced — and you can no longer trivially deduce "the new state is mine because CAS succeeded."

### The CAS retry storm

Under high contention an atomic CAS loop can degenerate into a retry storm: every goroutine reads the state, computes a new state, fails the CAS, and retries. Cache-line bouncing slows everyone down. The total throughput can be *lower* than with a mutex because the mutex serialises and the CAS does not.

Symptoms:
- CPU utilisation high, throughput low.
- Profiles show most time in the `atomic` package or in the CAS loop.
- Adding more goroutines makes things slower, not faster.

Solutions:
- Add jitter or backoff between retries.
- Use sharding (covered next).
- Fall back to a mutex; the workload may not actually benefit from atomic.

---

## Lock-Free Counters

A counter that records the number of admissions, denials, or any other metric needs to be incremented without locking. Pre-Go 1.19 this was done with `atomic.AddInt64`. Since Go 1.19 there is `atomic.Int64`.

### Single-counter contention

A naive counter:

```go
var counter atomic.Int64

func record() {
    counter.Add(1)
}
```

Looks fine. On a single core: ~5 ns per increment. On 16 cores all incrementing: ~150-300 ns per increment due to cache line contention. The line that holds the counter bounces between cores' L1 caches.

This is the classic "false sharing"-like phenomenon, except here it is real sharing — every core wants to write to the same line.

### Striped counters

Spread the counter across many cells; each core writes to its own cell most of the time. Reading the total requires summing the cells.

```go
package striped

import (
    "runtime"
    "sync/atomic"
)

const cacheLine = 64

type Counter struct {
    cells []cell
}

type cell struct {
    val atomic.Int64
    _   [cacheLine - 8]byte // padding to fill a cache line
}

func New() *Counter {
    n := runtime.NumCPU()
    return &Counter{cells: make([]cell, n)}
}

func (c *Counter) Add(n int64) {
    idx := procPin() % len(c.cells)
    procUnpin()
    c.cells[idx].val.Add(n)
}

func (c *Counter) Load() int64 {
    var total int64
    for i := range c.cells {
        total += c.cells[i].val.Load()
    }
    return total
}
```

`procPin` is an internal runtime function that returns the current P's index. It is exposed via `runtime/internal/sys` or via tricks like `runtime.GOMAXPROCS(0)` and `goid`. In real code you might use a hash of `goid` or simply `runtime.NumCPU()` with cycling.

The `padding` is critical. Without it, multiple counter cells would share a cache line and false-share. The 64-byte padding ensures each cell sits alone on its line.

### Performance

A striped counter on a 16-core machine with all cores writing:
- Add: ~5-8 ns per call (each core hits its own line).
- Load: ~50-100 ns per call (sum across 16 cells, each line cold to the reader).

This is a dramatic improvement over the naive counter under contention. The trade-off: `Load` is more expensive than a single-counter load.

### When to stripe

- The counter is on a hot path with many concurrent writers.
- Reads are rare (you tally periodically for metrics, not on every operation).
- You can afford the extra memory: 64 bytes per cell × number of CPUs.

A typical request-rate counter for a 16-core service: 1024 bytes (16 cells × 64 bytes). Worth it for the contention savings.

### `metric/expvar` and Prometheus counters

`expvar.Int` is just a single atomic counter; under contention it bottlenecks. Prometheus client libraries typically use one counter per metric, also single atomic.

For very high-rate counters (every request, every cache hit) consider wrapping the metric in a striped counter and flushing periodically to the metric library.

```go
type StripedPromCounter struct {
    striped *Counter
    promCtr prometheus.Counter
}

func (s *StripedPromCounter) Inc() {
    s.striped.Add(1)
}

func (s *StripedPromCounter) Flush() {
    val := s.striped.Load()
    s.promCtr.Add(float64(val))
    // reset the striped counter... but this isn't trivial because Add is concurrent.
}
```

Resetting concurrent counters is the tricky part. A two-buffer scheme (write to A while reading from B, then swap) is a common pattern. We omit the implementation here; the principle is clear.

---

## Sharding for Throughput

Sharding is the natural extension of striping: instead of one big limiter, use N smaller ones and route by hash.

### Why shard a rate limiter

If you have a single limiter at 1M QPS, the mutex or atomic CAS will be your bottleneck. If you split into 16 shards each at 62.5k QPS, each shard has lower contention and the total throughput scales linearly with shards.

The cost: the rate guarantees become per-shard, not global. A shard might be at 100% utilisation while another is idle — the total admitted is below the global limit.

### When sharding is safe

Sharding is safe when:

1. The limit is approximate. "About 100 RPS" is fine; "exactly 100 RPS" is not.
2. The traffic to each shard is balanced. Hashing by request hash gives good balance for unstructured traffic but not for traffic with hot keys.
3. The rate is high enough that the shard-level rate is meaningful. A limit of 1 RPS sharded into 16 shards gives each shard 1/16 RPS, which produces fractional tokens and weird behaviour.

### Sharded token bucket

```go
package shardedbucket

import (
    "hash/maphash"

    "golang.org/x/time/rate"
)

type ShardedLimiter struct {
    shards []*rate.Limiter
    seed   maphash.Seed
}

func New(numShards int, ratePerSec rate.Limit, burst int) *ShardedLimiter {
    s := &ShardedLimiter{
        shards: make([]*rate.Limiter, numShards),
        seed:   maphash.MakeSeed(),
    }
    perShardRate := ratePerSec / rate.Limit(numShards)
    perShardBurst := burst / numShards
    if perShardBurst < 1 {
        perShardBurst = 1
    }
    for i := range s.shards {
        s.shards[i] = rate.NewLimiter(perShardRate, perShardBurst)
    }
    return s
}

func (s *ShardedLimiter) Allow(key string) bool {
    var h maphash.Hash
    h.SetSeed(s.seed)
    h.WriteString(key)
    idx := int(h.Sum64() % uint64(len(s.shards)))
    return s.shards[idx].Allow()
}
```

The hash maps each key to a single shard. The shard's `Allow` is independent of the others, so contention is limited to the goroutines that share a shard.

### Sharding for unkeyed limits

If your limit is global (no key), sharding still helps with contention by load-balancing goroutines to shards:

```go
func (s *ShardedLimiter) AllowRandom() bool {
    // Use a per-goroutine or per-P random pick.
    idx := fastrand() % uint32(len(s.shards))
    return s.shards[idx].Allow()
}
```

`fastrand` is the runtime's per-P random source, accessible via `runtime.fastrand` (private, accessible via `//go:linkname`).

The randomness ensures load balance even when one goroutine makes many calls in a row. The total rate is approximately `r` even though no individual shard is at `r`.

### Sharding and unfairness

Sharding introduces unfairness: two clients hashing to the same shard contend with each other, while a third client on a different shard does not.

For per-IP rate limiting this is usually fine — the IPs balanced across shards on average — but for premium customers who paid for guaranteed throughput, sharding is wrong: their request might land on a saturated shard and be denied while the shared budget is unspent.

The solution is per-customer limiters keyed by customer ID, with a tiered approach: a separate per-customer limiter for VIPs and a sharded shared limiter for everyone else.

---

## Debouncer Deep Dive

We've spent a lot of time on throttling. Let's revisit debouncing with senior-level care.

### The contract of a debouncer

A debouncer collapses a stream of events into a single trigger, fired after a period of silence. Three behaviours are usually relevant:

1. **Trailing-edge debounce**: fire after `d` of silence following the last event. This is the default.
2. **Leading-edge debounce**: fire immediately on the first event, then ignore subsequent events until `d` of silence.
3. **Both-edge debounce**: fire immediately on the first event, then fire again at the trailing edge if there were intervening events.

Most production debouncers are trailing-edge. Leading-edge is occasionally useful for "fire one notification per burst." Both-edge is rare.

### Trailing debouncer

```go
package debounce

import (
    "sync"
    "time"
)

type Trailing struct {
    mu     sync.Mutex
    timer  *time.Timer
    delay  time.Duration
    action func()
}

func NewTrailing(delay time.Duration, action func()) *Trailing {
    return &Trailing{delay: delay, action: action}
}

func (d *Trailing) Trigger() {
    d.mu.Lock()
    defer d.mu.Unlock()
    if d.timer != nil {
        d.timer.Stop()
    }
    d.timer = time.AfterFunc(d.delay, d.action)
}

func (d *Trailing) Stop() {
    d.mu.Lock()
    defer d.mu.Unlock()
    if d.timer != nil {
        d.timer.Stop()
    }
}
```

This is correct but allocates a fresh timer on every `Trigger`. For a high-rate event source the allocations matter.

### Trailing debouncer with timer reuse

```go
type ReusingTrailing struct {
    mu     sync.Mutex
    timer  *time.Timer
    delay  time.Duration
    action func()
}

func NewReusing(delay time.Duration, action func()) *ReusingTrailing {
    d := &ReusingTrailing{delay: delay, action: action}
    d.timer = time.AfterFunc(time.Hour, d.fire)
    d.timer.Stop()
    return d
}

func (d *ReusingTrailing) Trigger() {
    d.mu.Lock()
    defer d.mu.Unlock()
    d.timer.Reset(d.delay)
}

func (d *ReusingTrailing) fire() {
    d.action()
}

func (d *ReusingTrailing) Stop() {
    d.mu.Lock()
    defer d.mu.Unlock()
    d.timer.Stop()
}
```

`time.Timer.Reset` does not allocate; it reuses the existing runtime timer. On a hot debouncer this is a measurable saving.

A caveat: `Reset` after the timer has already fired is racy in Go versions before 1.23. The recommended pattern in older Go is to call `Stop` and drain the channel before `Reset`. Go 1.23+ made `Reset` safe in all cases by giving timers a single-element channel buffer with explicit "stop overwrites the slot" semantics.

### Trailing debouncer with last-value semantics

A common variant: the debouncer fires the *last* value it saw, not just a trigger.

```go
type ValueDebouncer[T any] struct {
    mu     sync.Mutex
    timer  *time.Timer
    delay  time.Duration
    value  T
    has    bool
    action func(T)
}

func NewValue[T any](delay time.Duration, action func(T)) *ValueDebouncer[T] {
    d := &ValueDebouncer[T]{delay: delay, action: action}
    d.timer = time.AfterFunc(time.Hour, d.fire)
    d.timer.Stop()
    return d
}

func (d *ValueDebouncer[T]) Trigger(v T) {
    d.mu.Lock()
    defer d.mu.Unlock()
    d.value = v
    d.has = true
    d.timer.Reset(d.delay)
}

func (d *ValueDebouncer[T]) fire() {
    d.mu.Lock()
    v, ok := d.value, d.has
    d.has = false
    var zero T
    d.value = zero
    d.mu.Unlock()
    if ok {
        d.action(v)
    }
}
```

The "last value wins" semantics is exactly right for cases like search input ("only search for the final query"), config reload ("apply the last config in the burst"), and UI state ("paint the final state").

### Leading-edge debouncer

```go
type Leading struct {
    mu      sync.Mutex
    nextOK  time.Time
    delay   time.Duration
    action  func()
}

func NewLeading(delay time.Duration, action func()) *Leading {
    return &Leading{delay: delay}
}

func (d *Leading) Trigger() {
    d.mu.Lock()
    now := time.Now()
    if now.Before(d.nextOK) {
        d.mu.Unlock()
        return
    }
    d.nextOK = now.Add(d.delay)
    d.mu.Unlock()
    d.action()
}
```

The leading-edge debouncer is just a "minimum interval" gate. It admits the first event, then drops everything until `delay` has passed. There is no timer needed at all.

### Both-edge debouncer

```go
type Both struct {
    mu      sync.Mutex
    timer   *time.Timer
    delay   time.Duration
    leading bool
    pending bool
    action  func()
}

func NewBoth(delay time.Duration, action func()) *Both {
    d := &Both{delay: delay, action: action}
    d.timer = time.AfterFunc(time.Hour, d.trailingFire)
    d.timer.Stop()
    return d
}

func (d *Both) Trigger() {
    d.mu.Lock()
    if !d.leading {
        d.leading = true
        d.timer.Reset(d.delay)
        d.mu.Unlock()
        d.action()
        return
    }
    d.pending = true
    d.timer.Reset(d.delay)
    d.mu.Unlock()
}

func (d *Both) trailingFire() {
    d.mu.Lock()
    fire := d.pending
    d.pending = false
    d.leading = false
    d.mu.Unlock()
    if fire {
        d.action()
    }
}
```

The state machine: idle → leading → (more events: stay leading, set pending) → quiet → fire trailing if pending, return to idle.

This is the variant used by lodash's `debounce({leading: true, trailing: true})` and similar libraries.

---

## Concurrency-Safe Debouncers

The implementations above are thread-safe in the sense that concurrent calls to `Trigger` will not corrupt the timer. But there are subtler concurrency issues worth examining.

### Race: action runs while Trigger updates state

Consider:

```go
func (d *ValueDebouncer[T]) Trigger(v T) {
    d.mu.Lock()
    defer d.mu.Unlock()
    d.value = v
    d.has = true
    d.timer.Reset(d.delay)
}
```

If the timer fires concurrently with `Trigger`, the timer's callback `fire` is called. `fire` acquires the lock. If `Trigger` is currently holding the lock, `fire` blocks until `Trigger` releases.

Sequence A: `Trigger` runs to completion, releases lock. `fire` acquires lock, sees the updated value, calls `action(v_new)`.

Sequence B: `fire` acquires lock first (when `Trigger` is still pending), sees the old value, calls `action(v_old)`. `Trigger` then runs, sets new value, resets timer. The new value will fire after `delay`.

Both sequences are correct. The contract "the action will eventually run with the most recent value or some superset" holds.

### Race: action calls Trigger

What if `action` calls `Trigger` (the debouncer is recursive)? The naive implementation:

```go
func (d *ValueDebouncer[T]) fire() {
    d.mu.Lock()
    v, ok := d.value, d.has
    d.has = false
    var zero T
    d.value = zero
    d.mu.Unlock()
    if ok {
        d.action(v) // action() may call d.Trigger()
    }
}
```

This works because we release the lock before calling `action`. If `action` calls `Trigger`, the lock is available. The timer is reset, and the next fire will pick up the new value.

If we forgot to release the lock before `action`, we would deadlock.

### Race: Stop while action is running

```go
func (d *ValueDebouncer[T]) Stop() {
    d.mu.Lock()
    defer d.mu.Unlock()
    d.timer.Stop()
}
```

If `Stop` is called while `action` is running, `Stop` waits to acquire the lock (because `fire` holds it before releasing for `action`). Once `Stop` acquires the lock, `action` has already finished. Calling `timer.Stop()` after the timer has fired is a no-op and returns `false`.

But there is a subtler case: `Stop` is called *after* the timer fires but *before* `fire` acquires the lock. `Stop` acquires the lock first, calls `timer.Stop()` (no-op), releases. Then `fire` acquires the lock, sees the value, runs `action`. The debouncer fires *after* `Stop` returned.

If the contract is "after `Stop` returns, `action` will not be called," this is a bug. Fix:

```go
type ValueDebouncer[T any] struct {
    mu      sync.Mutex
    timer   *time.Timer
    delay   time.Duration
    value   T
    has     bool
    stopped bool
    action  func(T)
}

func (d *ValueDebouncer[T]) Trigger(v T) {
    d.mu.Lock()
    defer d.mu.Unlock()
    if d.stopped {
        return
    }
    d.value = v
    d.has = true
    d.timer.Reset(d.delay)
}

func (d *ValueDebouncer[T]) fire() {
    d.mu.Lock()
    if d.stopped {
        d.mu.Unlock()
        return
    }
    v, ok := d.value, d.has
    d.has = false
    var zero T
    d.value = zero
    d.mu.Unlock()
    if ok {
        d.action(v)
    }
}

func (d *ValueDebouncer[T]) Stop() {
    d.mu.Lock()
    defer d.mu.Unlock()
    d.stopped = true
    d.timer.Stop()
}
```

The `stopped` flag turns later `fire` and `Trigger` calls into no-ops. `Stop` is now idempotent and the post-stop contract is enforced.

### A pattern: shutdown with wait

Sometimes you want `Stop` to wait until any pending `action` finishes. This is useful when `action` writes to a resource that you are about to close.

```go
type WaitableDebouncer struct {
    mu      sync.Mutex
    wg      sync.WaitGroup
    timer   *time.Timer
    delay   time.Duration
    stopped bool
    action  func()
}

func NewWaitable(delay time.Duration, action func()) *WaitableDebouncer {
    d := &WaitableDebouncer{delay: delay, action: action}
    d.timer = time.AfterFunc(time.Hour, d.fire)
    d.timer.Stop()
    return d
}

func (d *WaitableDebouncer) Trigger() {
    d.mu.Lock()
    defer d.mu.Unlock()
    if d.stopped {
        return
    }
    d.timer.Reset(d.delay)
}

func (d *WaitableDebouncer) fire() {
    d.mu.Lock()
    if d.stopped {
        d.mu.Unlock()
        return
    }
    d.wg.Add(1)
    d.mu.Unlock()
    defer d.wg.Done()
    d.action()
}

func (d *WaitableDebouncer) Stop() {
    d.mu.Lock()
    d.stopped = true
    d.timer.Stop()
    d.mu.Unlock()
    d.wg.Wait()
}
```

`Stop` sets the flag, stops the timer (preventing future fires), and waits for any in-flight `action`.

The `wg.Add(1)` is done *inside* the lock to ensure that if `Stop` runs concurrently with `fire`, `wg.Wait` sees the increment. Doing `Add` after releasing the lock would race.

---

## Coalescing Debouncers

A debouncer collapses bursts into one event. A coalescing debouncer additionally aggregates the events' values.

### Example: collecting cache invalidations

Suppose your service receives cache-invalidation events naming keys. Many keys can be invalidated rapidly. Instead of invalidating one at a time, you want to batch them and invalidate in groups.

```go
type Coalescer struct {
    mu     sync.Mutex
    keys   map[string]struct{}
    timer  *time.Timer
    delay  time.Duration
    flush  func(keys []string)
}

func NewCoalescer(delay time.Duration, flush func(keys []string)) *Coalescer {
    c := &Coalescer{
        keys:  make(map[string]struct{}),
        delay: delay,
        flush: flush,
    }
    c.timer = time.AfterFunc(time.Hour, c.fire)
    c.timer.Stop()
    return c
}

func (c *Coalescer) Add(key string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.keys[key] = struct{}{}
    if len(c.keys) == 1 {
        c.timer.Reset(c.delay)
    }
}

func (c *Coalescer) fire() {
    c.mu.Lock()
    keys := make([]string, 0, len(c.keys))
    for k := range c.keys {
        keys = append(keys, k)
        delete(c.keys, k)
    }
    c.mu.Unlock()
    if len(keys) > 0 {
        c.flush(keys)
    }
}
```

The timer is only reset on the first key in a batch — subsequent keys do not extend the deadline. This gives a *fixed-window* batching behaviour: every batch fires at most `delay` after the first key was added.

Alternative: reset the timer on every key. This gives *quiescence-based* batching: the batch fires only when the source has been silent for `delay`. Useful when you want to wait for the burst to fully end.

### Maximum-wait coalescing

A pure quiescence-based coalescer can wait forever if events keep arriving. A common fix: set a maximum delay, after which the batch is flushed regardless.

```go
type MaxWaitCoalescer struct {
    mu       sync.Mutex
    keys     map[string]struct{}
    timer    *time.Timer
    firstAdd time.Time
    delay    time.Duration
    maxWait  time.Duration
    flush    func(keys []string)
}

func NewMaxWait(delay, maxWait time.Duration, flush func(keys []string)) *MaxWaitCoalescer {
    c := &MaxWaitCoalescer{
        keys:    make(map[string]struct{}),
        delay:   delay,
        maxWait: maxWait,
        flush:   flush,
    }
    c.timer = time.AfterFunc(time.Hour, c.fire)
    c.timer.Stop()
    return c
}

func (c *MaxWaitCoalescer) Add(key string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.keys[key] = struct{}{}
    if len(c.keys) == 1 {
        c.firstAdd = time.Now()
        c.timer.Reset(c.delay)
    } else {
        // Reset toward delay but cap at maxWait from firstAdd.
        elapsed := time.Since(c.firstAdd)
        remaining := c.maxWait - elapsed
        if remaining < 0 {
            remaining = 0
        }
        next := c.delay
        if remaining < next {
            next = remaining
        }
        c.timer.Reset(next)
    }
}
```

This is the pattern used by Kafka producers' "linger" plus "linger.ms" plus "batch.size" combination: wait for quiescence, but only up to a maximum.

### Bounded coalescer

Beyond max-wait, you might also bound the batch size. If the coalescer hits the size limit, flush immediately:

```go
type BoundedCoalescer struct {
    mu       sync.Mutex
    keys     map[string]struct{}
    timer    *time.Timer
    firstAdd time.Time
    delay    time.Duration
    maxWait  time.Duration
    maxSize  int
    flush    func(keys []string)
}

func (c *BoundedCoalescer) Add(key string) {
    c.mu.Lock()
    c.keys[key] = struct{}{}
    if len(c.keys) >= c.maxSize {
        // Flush immediately.
        keys := make([]string, 0, len(c.keys))
        for k := range c.keys {
            keys = append(keys, k)
            delete(c.keys, k)
        }
        c.timer.Stop()
        c.mu.Unlock()
        c.flush(keys)
        return
    }
    // ... timer reset logic as before
    c.mu.Unlock()
}
```

Size-bounded coalescing is common in storage and database connectors where a batch beyond a certain size becomes harmful (memory pressure, request too large).

---

## Distributed Throttling — Redis

Local rate limiting is the easy case. Distributed rate limiting — where the limit must hold across many processes — requires coordination.

### Why local limiting falls short

You run 10 instances of a service, each with `rate.Limiter(100, 100)`. Each instance enforces 100 RPS. Total enforced rate: 1000 RPS. If the goal was a global 100 RPS, you have 10x oversold the limit.

One quick fix: divide the limit by the instance count. Now each instance enforces 10 RPS, and the total is approximately 100 RPS. But this assumes traffic is evenly distributed. If one instance gets 90% of traffic, it will deny most requests while the others sit idle.

The fundamental issue: traffic is not perfectly balanced, and to enforce a global limit we need a shared counter.

### Redis as the coordinator

Redis is the standard choice for distributed rate limiting because:

1. Atomic operations (`INCR`, `EVAL` Lua scripts) enable race-free counter manipulation.
2. Sub-millisecond latency for a colocated cache.
3. Built-in expiration for window resetting.
4. The single-threaded model means counters are naturally consistent.

### Redis fixed-window counter

The simplest distributed rate limiter:

```
KEY = "ratelimit:user:{user_id}:{minute}"
INCR KEY
EXPIRE KEY 60
if INCR result > limit: deny
```

In Go:

```go
package redislimiter

import (
    "context"
    "fmt"
    "time"

    "github.com/redis/go-redis/v9"
)

type FixedWindow struct {
    client     *redis.Client
    limit      int
    windowSize time.Duration
}

func NewFixedWindow(client *redis.Client, limit int, windowSize time.Duration) *FixedWindow {
    return &FixedWindow{client: client, limit: limit, windowSize: windowSize}
}

func (l *FixedWindow) Allow(ctx context.Context, key string) (bool, error) {
    bucket := time.Now().UnixNano() / int64(l.windowSize)
    redisKey := fmt.Sprintf("ratelimit:%s:%d", key, bucket)
    pipe := l.client.Pipeline()
    incr := pipe.Incr(ctx, redisKey)
    pipe.Expire(ctx, redisKey, l.windowSize+time.Second)
    if _, err := pipe.Exec(ctx); err != nil {
        return false, err
    }
    return incr.Val() <= int64(l.limit), nil
}
```

Notice we set the `EXPIRE` slightly longer than the window to avoid an edge case where the key expires immediately after `INCR`. The expire is set on every `Allow` call, which is slightly redundant — we could set it only on the first call, but that adds complexity. Redis's `EXPIRE` is idempotent and cheap.

### Redis sliding-window log

```go
package redislimiter

import (
    "context"
    "fmt"
    "time"

    "github.com/redis/go-redis/v9"
)

var slidingLogScript = redis.NewScript(`
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowNs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local cutoff = now - windowNs

redis.call("ZREMRANGEBYSCORE", key, "-inf", cutoff)
local count = redis.call("ZCARD", key)
if count < limit then
    redis.call("ZADD", key, now, now .. ":" .. math.random())
    redis.call("PEXPIRE", key, math.ceil(windowNs / 1e6))
    return 1
end
return 0
`)

type SlidingLog struct {
    client     *redis.Client
    limit      int
    windowSize time.Duration
}

func (l *SlidingLog) Allow(ctx context.Context, key string) (bool, error) {
    now := time.Now().UnixNano()
    res, err := slidingLogScript.Run(ctx, l.client, []string{
        fmt.Sprintf("ratelimit:slidinglog:%s", key),
    }, now, int64(l.windowSize), l.limit).Result()
    if err != nil {
        return false, err
    }
    return res.(int64) == 1, nil
}
```

The Lua script runs atomically inside Redis. It trims expired entries, counts, and adds the new one if under the limit. The sorted set stores each request's timestamp as its score; the value is `timestamp:random` to ensure uniqueness (two requests at the exact same nanosecond would otherwise collide).

This is the gold standard for distributed rate limiting: exact, fair across instances, and well-supported by Redis's data structures.

### Redis token bucket

```go
var tokenBucketScript = redis.NewScript(`
local key = KEYS[1]
local now = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local state = redis.call("HMGET", key, "tokens", "last")
local tokens = tonumber(state[1]) or capacity
local last = tonumber(state[2]) or now

local elapsed = (now - last) / 1e9
tokens = math.min(capacity, tokens + elapsed * rate)

local allowed = 0
if tokens >= cost then
    tokens = tokens - cost
    allowed = 1
end

redis.call("HSET", key, "tokens", tokens, "last", now)
local ttl = math.ceil(capacity / rate)
if ttl < 1 then ttl = 1 end
redis.call("EXPIRE", key, ttl)

return allowed
`)

type RedisTokenBucket struct {
    client   *redis.Client
    rate     float64
    capacity float64
}

func (l *RedisTokenBucket) Allow(ctx context.Context, key string, cost float64) (bool, error) {
    now := time.Now().UnixNano()
    res, err := tokenBucketScript.Run(ctx, l.client, []string{
        fmt.Sprintf("ratelimit:bucket:%s", key),
    }, now, l.rate, l.capacity, cost).Result()
    if err != nil {
        return false, err
    }
    return res.(int64) == 1, nil
}
```

The Lua script implements the standard token bucket. State is stored as a Redis hash with two fields: `tokens` and `last`. The TTL ensures cold keys clean themselves up.

The `now` is passed from the client because Redis's clock may differ from the application's. For a single-Redis-master deployment this is fine; for replicated Redis with sentinel/cluster you want consistent clocks across instances. NTP usually suffices.

### Failure modes of Redis-backed limiters

1. **Redis unreachable**. The limiter should fail open (admit) or fail closed (deny). Fail-open is typical for non-security-critical limits — better to allow than to deny everyone. For security limits (login attempts) fail-closed is safer.

2. **Redis slow**. The limiter's latency includes the Redis round trip. Under network jitter, your tail latency spikes. Mitigations: use a colocated Redis, set tight timeouts (1-5 ms), and have a local fallback.

3. **Redis split**. In a Redis cluster, network partitions cause writes to fail until the cluster heals. The limiter sees errors. Same fail-open/fail-closed decision applies.

4. **Hot key**. A single rate-limit key on a busy endpoint can saturate a Redis shard. Mitigation: per-user sharding, or local pre-throttle plus Redis aggregate.

### Local cache plus Redis

A common pattern: use Redis for the authoritative count, but cache recent decisions locally to amortise Redis calls. This is essentially a two-tier rate limiter.

```go
type CachedLimiter struct {
    redis    *RedisTokenBucket
    local    *lru.Cache[string, *cachedDecision]
    cacheTTL time.Duration
}

type cachedDecision struct {
    allowed bool
    expires time.Time
}

func (l *CachedLimiter) Allow(ctx context.Context, key string) (bool, error) {
    if c, ok := l.local.Get(key); ok && time.Now().Before(c.expires) {
        return c.allowed, nil
    }
    allowed, err := l.redis.Allow(ctx, key, 1)
    if err != nil {
        return false, err
    }
    l.local.Add(key, &cachedDecision{
        allowed: allowed,
        expires: time.Now().Add(l.cacheTTL),
    })
    return allowed, nil
}
```

The cache TTL is the key trade-off: longer TTLs reduce Redis load but give stale decisions. For a 100 RPS limit a 100 ms cache means at most 10 stale calls per second per instance — usually acceptable. For tight limits use shorter TTLs.

A more sophisticated variant uses a local token bucket sized to the cache TTL window. The local bucket holds the per-instance allocation, and the Redis interaction happens only when the local bucket is empty. This is the architecture used by Stripe's rate limiter and many large APIs.

---

## Distributed Throttling — Consensus and Approximation

Redis is not the only way. There are several alternatives, each with different trade-offs.

### Centralised rate-limit service

Run a dedicated service whose only job is to host counters. Clients call it over gRPC for every rate-limit decision. The service can use any of the algorithms above with in-memory state.

Examples: Envoy's RLS (Rate Limit Service), Lyft's Ratelimit, Cloudflare's edge limiter.

Pros:
- Single source of truth for counts.
- Specialised optimisations (sharded in-memory state, batching, custom protocols).
- Easy to swap algorithms.

Cons:
- Network round trip per decision.
- Service availability is critical; failure modes need careful design.
- Operationally heavy compared to a Redis call.

### Approximate distributed counting

Instead of consulting a central counter on every request, periodically synchronise local counters. Each instance has a local limiter sized to its expected share. Every few seconds it reports its count to a coordinator and adjusts its allotment.

This is the architecture of Google's Doorman, of YouTube's quota system, and of many large-scale rate limiters.

Pseudocode:

```
instance i:
    local_limiter = TokenBucket(rate = global_rate / num_instances, burst = b)
    every period:
        report local_count to coordinator
        receive new allotment from coordinator
        local_limiter.set_rate(new_allotment)
```

The coordinator collects counts, computes the fair share, and replies with updated rates. Between sync intervals each instance is locally autonomous — no network call per request.

Drawback: under bursty load, some instances may exhaust their allotment while others have surplus. The next sync rebalances. The system is eventually-consistent.

This pattern is appropriate when:
- The traffic is mostly evenly distributed across instances.
- Approximate enforcement is acceptable (a few percent over the limit during sync gaps is OK).
- The limit is high enough to make per-instance allotments meaningful.

### Gossip-based limiting

Each instance gossips its count to a few peers. The peers aggregate and gossip back. After log(N) rounds the count converges.

This is rarely used for rate limiting because the gossip latency is too high for tight limits, but it appears in some large peer-to-peer systems and in service-mesh sidecars.

### Hashing-based partitioning

If your traffic has a natural partition key (user ID, API key, IP), shard requests across instances by hashing the key. Each shard owns a subset of keys and runs an authoritative local limiter for them.

This is how Envoy's rate limit service shards: each RLS instance owns a subset of keys, and the routing fabric (consistent hashing) ensures all requests for a key go to the same instance.

Pros:
- No coordination overhead per request.
- Exact limits per key.

Cons:
- Requires the routing layer to support consistent hashing.
- Hot keys can saturate a single instance.
- Rebalancing during scaling is non-trivial.

### CRDTs for rate limiters

Conflict-free Replicated Data Types can model rate-limit counters with weak consistency. Each instance maintains a "G-Counter" (grow-only counter) per key. The global count is the sum across instances. Updates are gossiped.

This is theoretically clean but rarely used in practice for rate limiting because the eventual consistency is too loose.

---

## Adaptive Throttling

Sometimes the right rate is not a constant. The downstream may be healthy at 1000 RPS today and degraded at 500 RPS tomorrow. An adaptive throttle adjusts its rate based on observed downstream health.

### The classic AIMD pattern

Additive Increase, Multiplicative Decrease. Same algorithm TCP congestion control uses:

- On success: increase rate by a small constant.
- On failure: decrease rate by a multiplicative factor.

```go
package adaptive

import (
    "math"
    "sync"
    "time"
)

type AIMD struct {
    mu       sync.Mutex
    rate     float64
    minRate  float64
    maxRate  float64
    incStep  float64
    decRatio float64
    last     time.Time
}

func NewAIMD(initial, minR, maxR, incStep, decRatio float64) *AIMD {
    return &AIMD{
        rate:     initial,
        minRate:  minR,
        maxRate:  maxR,
        incStep:  incStep,
        decRatio: decRatio,
        last:     time.Now(),
    }
}

func (a *AIMD) Success() {
    a.mu.Lock()
    defer a.mu.Unlock()
    a.rate = math.Min(a.rate+a.incStep, a.maxRate)
}

func (a *AIMD) Failure() {
    a.mu.Lock()
    defer a.mu.Unlock()
    a.rate = math.Max(a.rate*a.decRatio, a.minRate)
}

func (a *AIMD) Rate() float64 {
    a.mu.Lock()
    defer a.mu.Unlock()
    return a.rate
}
```

Wire this into a token bucket:

```go
type AdaptiveLimiter struct {
    aimd   *AIMD
    bucket *Bucket
    sync   *time.Ticker
}

func (l *AdaptiveLimiter) syncLoop() {
    for range l.sync.C {
        rate := l.aimd.Rate()
        l.bucket.SetRate(rate)
    }
}
```

We have to add a `SetRate` method to the bucket. For `rate.Limiter` use `SetLimit`. The sync period is a trade-off: faster sync reacts quicker to changes but costs more CPU.

### Loss-based vs latency-based

The above adapts on success/failure. A more nuanced adapter looks at latency: if p99 latency exceeds a threshold, treat as failure even if the request succeeded.

This is closer to the BBR algorithm in TCP and to Netflix's adaptive concurrency limiter (the "Vegas" inspiration).

```go
func (a *AIMD) RecordLatency(latency time.Duration, threshold time.Duration) {
    if latency > threshold {
        a.Failure()
    } else {
        a.Success()
    }
}
```

The threshold is the hard part. Static thresholds break when load patterns change. Dynamic thresholds (a percentile of recent latencies) are more robust but harder to implement.

### Adaptive concurrency limit

A different formulation: instead of adapting a rate, adapt a concurrency limit. This is the approach in Netflix's "concurrency-limits" library.

The idea: measure the minimum latency seen recently (rtt_noload). At any time, the optimal concurrency is `rate * rtt_noload`. Track both and adapt the limit toward the optimum.

This works very well for downstreams whose latency grows under load (queueing). The limiter avoids the high-latency regime by capping concurrency.

### Failure: oscillation

AIMD can oscillate: increase, fail, decrease, increase, fail, decrease. The rate never stabilises.

Mitigations:
- Hysteresis: only adjust after N consecutive successes/failures.
- Damping: smooth the rate with an EWMA.
- Random jitter: add noise to break synchronisation between instances.

---

## Hierarchical Token Buckets

Real systems have multiple rate limits that compose. A request might be subject to:
- A per-user limit (10 RPS).
- A per-API-key limit (100 RPS).
- A global service limit (10k RPS).
- A per-endpoint limit (5k RPS for /search, 1k RPS for /upload).

All four must be satisfied simultaneously. The "hierarchical token bucket" (HTB) is the classical model for this, originating in network QoS.

### The HTB model

A tree of buckets. Each bucket has a rate and a burst. A request consumes one token from every bucket on its path from the leaf to the root. If any bucket lacks tokens, the request is denied.

```
          [root: 10k RPS]
          /              \
   [/search: 5k]       [/upload: 1k]
       |                    |
   [user A: 10]        [user A: 10]
```

A request for /search from user A consumes one token from "user A," "/search," and "root."

### Simple HTB implementation

```go
package htb

import "context"

type Bucket struct {
    name     string
    limiter  *rate.Limiter
    parent   *Bucket
}

func (b *Bucket) Allow(ctx context.Context) bool {
    cur := b
    for cur != nil {
        if !cur.limiter.Allow() {
            return false
        }
        cur = cur.parent
    }
    return true
}
```

A subtle issue: if we consume from "user A" but then "root" denies, the user's token is wasted. The request never proceeded but the user has been billed.

Fix: check before consuming. Walk the tree, check `tokens >= 1` everywhere, and only then consume.

```go
func (b *Bucket) Allow(ctx context.Context) bool {
    // Reserve up the tree.
    var reserved []*rate.Limiter
    cur := b
    for cur != nil {
        r := cur.limiter.Reserve()
        if !r.OK() || r.Delay() > 0 {
            // Cancel reservations.
            r.Cancel()
            for _, prev := range reserved {
                // No easy way; this is the limitation of x/time/rate.
            }
            return false
        }
        reserved = append(reserved, cur.limiter)
        cur = cur.parent
    }
    return true
}
```

The standard library does not support cancelling a reservation cleanly across multiple limiters. Production HTB implementations have a custom token-bucket library that supports two-phase commit.

### Real HTB use cases

- API gateways enforcing per-user, per-key, per-endpoint, and global limits.
- Multi-tenant systems where tenants have quotas that compose into a total system budget.
- Network QoS systems (the original HTB).

### Borrowing

A more flexible HTB allows children to borrow tokens from their parent when the children are below their reserved rate. This is the "ceil" mechanism of Linux's HTB qdisc.

In software rate limiting, borrowing is less common because the complexity is high. The simpler "strict tree" works for most cases.

---

## Observability for Rate Limiters

A rate limiter without observability is a black hole: requests vanish, you do not know why, and you cannot tune the limit.

### Essential metrics

For every limiter, export:

1. **Allowed count**: total admitted requests, by key and outcome.
2. **Denied count**: total denied requests, by key and reason.
3. **Wait time distribution**: histogram of how long callers waited before admission.
4. **Current tokens**: gauge of current bucket level (if the algorithm tracks tokens).
5. **Rate limit value**: gauge of the configured rate (so dashboards show changes after tuning).

In Prometheus:

```go
package metrics

import "github.com/prometheus/client_golang/prometheus"

var (
    LimiterAllowed = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "ratelimiter_allowed_total",
            Help: "Number of requests allowed by the rate limiter.",
        },
        []string{"limiter", "key"},
    )
    LimiterDenied = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "ratelimiter_denied_total",
            Help: "Number of requests denied by the rate limiter.",
        },
        []string{"limiter", "reason"},
    )
    LimiterWait = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "ratelimiter_wait_seconds",
            Help:    "Time spent waiting for rate limiter admission.",
            Buckets: prometheus.ExponentialBuckets(0.001, 2, 12),
        },
        []string{"limiter"},
    )
)
```

The `key` label is dangerous: high-cardinality keys (per-user, per-IP) can blow up Prometheus's memory. Strategies:

- Label only the broad limiter name, not the per-key value.
- Sample a fraction of keys for cardinality.
- Aggregate keys into buckets (e.g., "user_id_mod_10").

### Logging denials

Denial is interesting. Log a small fraction of denials with the key and reason, so you can diagnose unexpected denials.

```go
import "math/rand"

func (l *MyLimiter) Allow(key string) bool {
    if l.bucket.Allow() {
        return true
    }
    if rand.Float64() < 0.01 { // 1% sample
        log.Printf("rate-limit denied: key=%s rate=%f tokens=%f", key, l.bucket.rate, l.bucket.tokens)
    }
    return false
}
```

Sampling avoids overwhelming the logs during a sustained denial event.

### Tracing

If you use distributed tracing (OpenTelemetry), add a span event for rate-limit decisions:

```go
import "go.opentelemetry.io/otel/trace"

func (l *MyLimiter) Allow(ctx context.Context, key string) bool {
    allowed := l.bucket.Allow()
    if span := trace.SpanFromContext(ctx); span.IsRecording() {
        span.AddEvent("rate_limit_check", trace.WithAttributes(
            attribute.String("limiter", l.name),
            attribute.String("key", key),
            attribute.Bool("allowed", allowed),
        ))
    }
    return allowed
}
```

In a trace viewer you can then see exactly which limiter denied a request, which is invaluable when debugging.

### Health checks

A limiter that has been denying 100% of requests for the past minute is probably misconfigured or starved. Add a health check:

```go
func (l *MyLimiter) IsHealthy() bool {
    allowed := atomic.LoadInt64(&l.allowedCount)
    denied := atomic.LoadInt64(&l.deniedCount)
    if allowed+denied < 100 {
        return true // not enough data
    }
    denialRate := float64(denied) / float64(allowed+denied)
    return denialRate < 0.95
}
```

Wire the health check into your service's `/health` endpoint. A persistently unhealthy limiter is an operator's signal to investigate.

### Exporting current state

For deep debugging, expose the current state of the limiter:

```go
type LimiterDebug struct {
    Name      string  `json:"name"`
    Rate      float64 `json:"rate"`
    Burst     float64 `json:"burst"`
    Tokens    float64 `json:"tokens"`
    LastNs    int64   `json:"last_ns"`
}

func (l *MyLimiter) Debug() LimiterDebug {
    l.mu.Lock()
    defer l.mu.Unlock()
    return LimiterDebug{
        Name:   l.name,
        Rate:   l.rate,
        Burst:  l.capacity,
        Tokens: l.tokens,
        LastNs: l.last.UnixNano(),
    }
}
```

Expose via a debug endpoint:

```go
http.HandleFunc("/debug/limiters", func(w http.ResponseWriter, r *http.Request) {
    json.NewEncoder(w).Encode(allLimiters())
})
```

Restrict access — this is internal-only debugging.

---

## Benchmarks and Microbenchmarks

To compare limiter implementations, write Go benchmarks. The patterns:

### Single-goroutine benchmark

```go
func BenchmarkBucketAllow(b *testing.B) {
    bucket := New(1e9, 1e9) // very high rate, never denied
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        bucket.Allow()
    }
}
```

Use a high rate to avoid the `Allow` returning false (which has different cost than true). This measures the steady-state cost of an admitted call.

### Parallel benchmark

```go
func BenchmarkBucketAllowParallel(b *testing.B) {
    bucket := New(1e9, 1e9)
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            bucket.Allow()
        }
    })
}
```

`b.RunParallel` runs the benchmark across `GOMAXPROCS` goroutines. The result shows how the limiter scales with concurrency.

### Comparison

A representative run on a 16-core Linux box, Go 1.22:

```
BenchmarkBucketAllow-16              25000000    60 ns/op    0 B/op    0 allocs/op
BenchmarkBucketAllowParallel-16       5000000   300 ns/op    0 B/op    0 allocs/op
BenchmarkAtomicGCRAAllow-16          50000000    25 ns/op    0 B/op    0 allocs/op
BenchmarkAtomicGCRAAllowParallel-16  20000000    80 ns/op    0 B/op    0 allocs/op
BenchmarkRateLimiterAllow-16         15000000   110 ns/op    0 B/op    0 allocs/op
BenchmarkRateLimiterAllowParallel-16  3000000   500 ns/op    0 B/op    0 allocs/op
```

Atomic GCRA is 2-3x faster than mutex bucket, both single and parallel. `rate.Limiter` is somewhat slower than our hand-rolled bucket because it does more work (reservations, monotonic clock handling, etc.). For most workloads `rate.Limiter` is fast enough; for hot paths a custom implementation pays off.

### Benchmarking under denial

A different benchmark: measure throughput when most calls are denied (high contention scenario).

```go
func BenchmarkBucketAllowMostlyDenied(b *testing.B) {
    bucket := New(100, 100) // 100 RPS rate, burst 100
    b.ResetTimer()
    var allowed int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            if bucket.Allow() {
                atomic.AddInt64(&allowed, 1)
            }
        }
    })
    b.ReportMetric(float64(allowed)/b.Elapsed().Seconds(), "allowed/sec")
}
```

In this benchmark we expect ~100 admitted per second regardless of how many goroutines are calling. The interesting metric is how the limiter handles the denied calls.

### Latency tail under load

Throughput is only one dimension. Measure tail latency:

```go
func BenchmarkBucketLatencyTail(b *testing.B) {
    bucket := New(1e6, 1e6)
    latencies := make([]time.Duration, b.N)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        start := time.Now()
        bucket.Allow()
        latencies[i] = time.Since(start)
    }
    sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
    p50 := latencies[len(latencies)/2]
    p99 := latencies[len(latencies)*99/100]
    p999 := latencies[len(latencies)*999/1000]
    b.ReportMetric(float64(p50.Nanoseconds()), "p50_ns")
    b.ReportMetric(float64(p99.Nanoseconds()), "p99_ns")
    b.ReportMetric(float64(p999.Nanoseconds()), "p999_ns")
}
```

The tail is often where bottlenecks hide. A limiter that has fast p50 but bad p99 has a contention or GC issue.

### Memory allocations

Run benchmarks with `-benchmem`:

```
go test -bench=. -benchmem -count=5
```

Allocations should be zero for hot-path Allow calls. Any non-zero allocation needs to be justified.

---

## Failure Modes and Pathologies

Rate limiters fail in surprising ways. Some classic patterns to watch for:

### Pathology 1: thundering herd on token refill

A bucket sized `b = 1000` is empty. 1000 callers are waiting. When the bucket refills they all wake at once and contend for the mutex / atomic. Latency spikes.

Mitigations:
- Add jitter to wait times.
- Use a queue (not a mutex) so callers wake in order, not in a stampede.
- Sharded limiters reduce the herd size.

### Pathology 2: clock drift desyncing distributed limiters

Two processes have clocks that differ by 100 ms. Both compute "now" and write to the same Redis key. The bucket sees writes in an inconsistent order.

Mitigations:
- Run NTP and monitor offset.
- Use Redis's `TIME` command instead of the client's clock.
- Make the limiter tolerant of small clock differences (the math is usually OK if differences are < 1 window).

### Pathology 3: clock going backward

Some clock sources (especially virtualised) can jump backward. The limiter sees `now < last`, computes negative elapsed, and crashes or produces nonsense.

Mitigations:
- Use Go's monotonic clock (always do `time.Since(start)`, not subtract `UnixNano()` values).
- Validate elapsed and clamp at 0.

```go
elapsed := now.Sub(last).Seconds()
if elapsed < 0 {
    elapsed = 0
}
```

### Pathology 4: limiter outlives its target

You create a `rate.Limiter` per user. Users sign up, sign out, never return. The map of limiters grows forever.

Mitigations:
- Use a TTL-aware map (e.g., `bigcache`, `ristretto`, or a periodic janitor).
- Use Redis with TTL so cold keys auto-expire.
- Use a fixed-size LRU.

### Pathology 5: long waits with no cancellation

A caller asks the limiter to wait. The limiter computes "you'll be admitted in 10 seconds." The caller's HTTP request times out in 1 second. The limiter still holds the slot and admits a non-existent caller in 10 seconds.

Mitigation: always use `Wait(ctx, ...)` with a deadline. The cancellation must propagate to the limiter.

### Pathology 6: `Reset` race on `time.Timer`

In Go versions before 1.23, `time.Timer.Reset` is racy when called after the timer has fired but before the channel is drained. The fix is to follow the documented "stop and drain" pattern:

```go
if !t.Stop() {
    select {
    case <-t.C:
    default:
    }
}
t.Reset(d)
```

Go 1.23+ made this safe by changing timer semantics. If you target older Go, audit every `Reset` call.

### Pathology 7: limiter applied at the wrong layer

A common mistake: rate-limit at the application layer (request handler) but accept the rejection in the load balancer (which sees a 200 with a body that says "rate limited"). The load balancer thinks the request succeeded and keeps the connection open. The client thinks it succeeded too. Only the response body says otherwise.

Mitigation: return HTTP 429 (Too Many Requests) with proper headers. The status code is the signal, not the body.

### Pathology 8: jitter amplifies contention

You add random jitter to spread out clients. Two thousand clients each add 0-100 ms jitter. The clients are then spread across 100 ms. If the limiter is sized for 100 RPS, the clients still exceed the limit because they all arrive within a 100 ms window.

Mitigation: jitter must be proportional to the limiter's window. For a 100 RPS limiter the jitter should span at least 1 second to give the clients headroom.

### Pathology 9: limit denies "successful" requests

The limiter denies request X. The downstream system was actually idle and could have served X. The user sees a 429 for no good reason.

This is the cost of a conservative limit. It is acceptable for protective limits (preventing DDoS, capping per-user usage) but not for capacity-based limits.

Mitigation: adaptive limits, multi-tier limits (a cheap pre-throttle plus an expensive global one).

---

## Self-Assessment

Read each question. If you cannot answer it without consulting the document, return to that section.

1. Explain the token bucket and leaky bucket algorithms, and when you would choose each.
2. Derive the formula for tokens accumulated since the last update, and state the bound on long-term admitted rate.
3. Describe the GCRA algorithm and the relationship between GCRA's `tau` and the token bucket's burst `b`.
4. What is the cost of `time.Now` on Linux x86_64, and when would you cache it?
5. Why is an atomic CAS-based limiter faster than a mutex-based one, and what is its failure mode under high contention?
6. What is the "striped counter" pattern, and why does padding matter?
7. Describe the sliding-window counter approximation, including the formula.
8. When would you choose sliding-window log over sliding-window counter?
9. Design a Redis-backed sliding-window log limiter. Write the Lua script.
10. What are the fail-open vs fail-closed trade-offs for a Redis-backed limiter?
11. Describe the AIMD adaptive throttling algorithm, and explain why it can oscillate.
12. Sketch a hierarchical token bucket with per-user, per-endpoint, and global limits. How do you avoid wasted tokens when an inner bucket admits but an outer denies?
13. What metrics would you export from a rate limiter, and why?
14. Describe three failure modes of a distributed rate limiter and their mitigations.
15. Write a trailing-edge debouncer that fires the last value seen, with safe `Stop` semantics.
16. Why does `time.Timer.Reset` require care, and how is this addressed in Go 1.23+?

---

## Summary

At the senior level, debounce and throttle stop being library calls and become design surfaces.

The token bucket is the workhorse algorithm: a single state value (tokens) refilled at rate `r` and capped at burst `b`. The math is `tokens = min(b, tokens_old + elapsed * r)`. It is `O(1)` per call, friendly to caching, and naturally generalises to weighted requests.

The leaky bucket is the smoother sibling. In its queue variant it guarantees a strict output rate with bounded latency; in its meter variant it is operationally similar to a token bucket. Choose leaky bucket when smoothing matters (SMTP, scraping); choose token bucket when bursts are acceptable.

The sliding-window counter approximates the gold-standard log with two integer counts. The interpolation formula `c_prev * (1 - f) + c_current` gives an error of at most `c_prev / 2`, usually small enough to be acceptable.

GCRA, with its single "theoretical arrival time" value, is the friendliest algorithm for atomic implementations. It is mathematically equivalent to a token bucket but uses a different state representation that admits a clean CAS-based update.

`time.Now` is non-trivial on every platform. On a hot limiter it can account for 5-15% of CPU. The fastime cache (one ticker, one atomic) gives a 15-25x speedup at the cost of ~1 ms staleness.

Atomic-based limiters outperform mutex-based ones by 2-3x under low contention. Under high contention the CAS loop can degenerate; sharding is the answer.

Striped counters scale single-counter contention with the number of CPUs. Each cell on its own cache line; reads sum across cells.

Distributed rate limiting requires coordination. Redis is the default: Lua scripts implement the algorithm atomically. For higher scale, dedicated rate-limit services (Envoy RLS, Lyft Ratelimit) provide specialised storage and protocols. Consistent hashing eliminates coordination by partitioning keys across instances.

Adaptive throttles (AIMD, BBR-style) adjust their rate based on observed downstream health. They are powerful but oscillation-prone; damping and hysteresis are essential.

Hierarchical token buckets compose multiple limits: per-user, per-endpoint, global. The challenge is avoiding token waste when inner buckets admit but outer ones deny — solved by two-phase commit or by checking before consuming.

Observability is the difference between a useful limiter and a black box. Export allowed/denied counters, wait-time histograms, current bucket levels. Tag with labels — but watch cardinality.

Failure modes are many: thundering herds, clock drift, clock reversal, limiters outliving their targets, races in `Timer.Reset`. The cure is awareness; senior engineers know the failure mode before they hit it in production.

At this level you do not reach for a library and trust it. You reach for a library, read its source, and decide whether it matches your workload. When it does not, you have the math and the patterns to write your own.

The professional level next takes these primitives into production: API rate limit responses, UI event handling, log throttling, observability dashboards, integration with circuit breakers, and postmortems from real outages.

---

## Appendix A: A Walk Through `golang.org/x/time/rate`

The Go ecosystem's de facto standard rate limiter deserves a careful read. Its source is approachable and demonstrates many of the techniques we have discussed.

### The Limiter struct

```go
type Limiter struct {
    mu        sync.Mutex
    limit     Limit
    burst     int
    tokens    float64
    last      time.Time
    lastEvent time.Time
}
```

Five fields. `limit` is the rate (tokens per second). `burst` is the maximum tokens. `tokens` is the current count (a float for continuous-time math). `last` is the last time tokens were updated. `lastEvent` is the time of the most recent allowed event (used for reservation calculations).

### The advance function

The heart of the limiter is `advance`, which computes the elapsed-since-last refill and updates the token count:

```go
func (lim *Limiter) advance(t time.Time) (newT time.Time, newTokens float64) {
    last := lim.last
    if t.Before(last) {
        last = t
    }
    elapsed := t.Sub(last)
    delta := lim.limit.tokensFromDuration(elapsed)
    tokens := lim.tokens + delta
    if burst := float64(lim.burst); tokens > burst {
        tokens = burst
    }
    return t, tokens
}
```

Notice the `t.Before(last)` guard — clock reversal protection. If somehow `t < last` (which shouldn't happen with monotonic time, but defensive), we clamp.

`tokensFromDuration` converts a `time.Duration` to a float-tokens count:

```go
func (limit Limit) tokensFromDuration(d time.Duration) float64 {
    return d.Seconds() * float64(limit)
}
```

Pure math. No allocations.

### The reserveN function

```go
func (lim *Limiter) reserveN(t time.Time, n int, maxFutureReserve time.Duration) Reservation {
    lim.mu.Lock()
    defer lim.mu.Unlock()

    if lim.limit == Inf {
        return Reservation{ok: true, lim: lim, tokens: n, timeToAct: t}
    } else if lim.limit == 0 {
        var ok bool
        if lim.burst >= n {
            ok = true
            lim.burst -= n
        }
        return Reservation{ok: ok, lim: lim, tokens: lim.burst, timeToAct: t}
    }

    t, tokens := lim.advance(t)
    tokens -= float64(n)
    var waitDuration time.Duration
    if tokens < 0 {
        waitDuration = lim.limit.durationFromTokens(-tokens)
    }

    ok := n <= lim.burst && waitDuration <= maxFutureReserve

    r := Reservation{
        ok:    ok,
        lim:   lim,
        limit: lim.limit,
    }
    if ok {
        r.tokens = n
        r.timeToAct = t.Add(waitDuration)
        lim.last = t
        lim.tokens = tokens
        lim.lastEvent = r.timeToAct
    } else {
        lim.last = t
        lim.tokens = tokens + float64(n) // restore, since we didn't admit
    }

    return r
}
```

Two corner cases handled first: `Inf` limit (always allow) and zero limit (only burst tokens, decremented). The main path advances tokens, subtracts the request, and computes wait if negative.

The crucial line: `ok = n <= lim.burst && waitDuration <= maxFutureReserve`. A request larger than `burst` can never be admitted. A request that would wait longer than `maxFutureReserve` is rejected (this is how `Allow` differs from `Wait`: `Allow` passes `maxFutureReserve = 0`, `Wait` passes infinity).

If the request is admitted, the limiter advances `last`, decrements `tokens` (which may now be negative — "borrowing from the future"), and records `lastEvent` at the future admission time.

If denied, we still advance `last` but restore the tokens (since we did not consume any).

### The Reservation

```go
type Reservation struct {
    ok        bool
    lim       *Limiter
    tokens    int
    timeToAct time.Time
    limit     Limit
}

func (r *Reservation) Cancel() {
    r.CancelAt(time.Now())
}

func (r *Reservation) CancelAt(t time.Time) {
    if !r.ok {
        return
    }
    r.lim.mu.Lock()
    defer r.lim.mu.Unlock()
    if r.lim.limit == Inf || r.tokens == 0 || r.timeToAct.Before(t) {
        return
    }
    restoreTokens := float64(r.tokens) - r.limit.tokensFromDuration(r.lim.lastEvent.Sub(r.timeToAct))
    if restoreTokens <= 0 {
        return
    }
    t, tokens := r.lim.advance(t)
    tokens += restoreTokens
    if burst := float64(r.lim.burst); tokens > burst {
        tokens = burst
    }
    r.lim.last = t
    r.lim.tokens = tokens
    if r.timeToAct == r.lim.lastEvent {
        prevEvent := r.timeToAct.Add(r.limit.durationFromTokens(float64(-r.tokens)))
        if !prevEvent.Before(t) {
            r.lim.lastEvent = prevEvent
        }
    }
}
```

`Cancel` (and its time-aware variant) returns the reserved tokens to the pool, but only the portion that has not already been "consumed" by later reservations. The math is delicate: we subtract any tokens that have been allocated to events after our reservation but before the cancellation.

This is the cleanup path that ensures cancelled `Wait` calls do not waste capacity.

### The Wait method

```go
func (lim *Limiter) Wait(ctx context.Context) (err error) {
    return lim.WaitN(ctx, 1)
}

func (lim *Limiter) WaitN(ctx context.Context, n int) (err error) {
    lim.mu.Lock()
    burst := lim.burst
    limit := lim.limit
    lim.mu.Unlock()

    if n > burst && limit != Inf {
        return fmt.Errorf("rate: Wait(n=%d) exceeds limiter's burst %d", n, burst)
    }
    select {
    case <-ctx.Done():
        return ctx.Err()
    default:
    }
    waitLimit := InfDuration
    if deadline, ok := ctx.Deadline(); ok {
        waitLimit = deadline.Sub(time.Now())
    }
    r := lim.reserveN(time.Now(), n, waitLimit)
    if !r.ok {
        return fmt.Errorf("rate: Wait(n=%d) would exceed context deadline", n)
    }
    delay := r.DelayFrom(time.Now())
    if delay == 0 {
        return nil
    }
    t := time.NewTimer(delay)
    defer t.Stop()
    select {
    case <-t.C:
        return nil
    case <-ctx.Done():
        r.Cancel()
        return ctx.Err()
    }
}
```

The flow:

1. Validate `n` against burst (returns immediately if impossible).
2. Pre-check the context (return early if already cancelled).
3. Compute remaining context budget.
4. Reserve `n` tokens with `waitLimit = ctx.deadline()`.
5. If reservation succeeded, sleep until `timeToAct`. If context cancels first, cancel the reservation.

The reservation+cancel pattern ensures that if a Wait is cancelled, the unused tokens are returned. This is the same pattern we sketched earlier for our custom bucket.

### Lessons from reading the source

- The library uses float64 tokens with continuous time. The math is clean.
- Reservations are first-class and cancellable. This is more general than just "Allow or Wait."
- The mutex is held only briefly, but it is held during every call. For very hot paths the lock is the bottleneck.
- There are no allocations on the hot Allow path. The Wait path allocates a Timer.

### When to roll your own

You roll your own when:

- The mutex is your bottleneck (verified by profiling).
- You need atomic operations specifically.
- You need a different algorithm (sliding-window, leaky-bucket queue, GCRA).
- You need distributed limits.
- You need custom metrics or hooks.

For 95% of use cases `golang.org/x/time/rate` is the right answer. The remaining 5% is the senior-engineer territory.

---

## Appendix B: Implementing a Time-Indexed Map for Per-Key Limiters

When you have per-user or per-IP rate limits, you need a map of limiters. Two questions: how do you evict cold entries, and how do you avoid contention on the map?

### Naive: a sync.Map of limiters

```go
type PerKeyLimiter struct {
    limiters sync.Map // key -> *rate.Limiter
    rate     rate.Limit
    burst    int
}

func (p *PerKeyLimiter) Allow(key string) bool {
    lim, _ := p.limiters.LoadOrStore(key, rate.NewLimiter(p.rate, p.burst))
    return lim.(*rate.Limiter).Allow()
}
```

This works but never evicts. For long-lived keys (logged-in users) the map fits. For short-lived keys (IPs, anonymous sessions) the map grows unbounded.

### Adding TTL

```go
type entry struct {
    lim     *rate.Limiter
    lastUse atomic.Int64
}

type TTLLimiter struct {
    entries sync.Map
    rate    rate.Limit
    burst   int
    ttl     time.Duration
}

func (p *TTLLimiter) Allow(key string) bool {
    now := time.Now().UnixNano()
    val, _ := p.entries.LoadOrStore(key, &entry{
        lim: rate.NewLimiter(p.rate, p.burst),
    })
    e := val.(*entry)
    e.lastUse.Store(now)
    return e.lim.Allow()
}

func (p *TTLLimiter) Janitor(ctx context.Context) {
    ticker := time.NewTicker(p.ttl / 2)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            cutoff := time.Now().Add(-p.ttl).UnixNano()
            p.entries.Range(func(k, v interface{}) bool {
                e := v.(*entry)
                if e.lastUse.Load() < cutoff {
                    p.entries.Delete(k)
                }
                return true
            })
        }
    }
}
```

A background janitor periodically scans the map and removes cold entries. The scan is O(N) where N is the map size, but it runs infrequently (every TTL/2).

### LRU-based eviction

For a hard upper bound on memory, use an LRU cache instead of a TTL map:

```go
import "github.com/hashicorp/golang-lru/v2"

type LRULimiter struct {
    cache *lru.Cache[string, *rate.Limiter]
    rate  rate.Limit
    burst int
}

func NewLRULimiter(size int, r rate.Limit, b int) (*LRULimiter, error) {
    c, err := lru.New[string, *rate.Limiter](size)
    if err != nil {
        return nil, err
    }
    return &LRULimiter{cache: c, rate: r, burst: b}, nil
}

func (p *LRULimiter) Allow(key string) bool {
    lim, ok := p.cache.Get(key)
    if !ok {
        lim = rate.NewLimiter(p.rate, p.burst)
        p.cache.Add(key, lim)
    }
    return lim.Allow()
}
```

The LRU evicts the least recently used entry when the cache is full. This bounds memory but can drop a still-active key if there is a lot of churn.

### Sharded map for contention

`sync.Map` is internally optimised but still has contention on the write path. For a per-key limiter under heavy load (many keys, many calls), shard the map:

```go
type ShardedKeyMap struct {
    shards [256]struct {
        mu      sync.Mutex
        entries map[string]*rate.Limiter
    }
}

func (m *ShardedKeyMap) shard(key string) *struct{ ... } {
    h := fnv.New32a()
    h.Write([]byte(key))
    return &m.shards[h.Sum32()&0xff]
}

func (m *ShardedKeyMap) Get(key string) *rate.Limiter {
    s := m.shard(key)
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.entries[key]
}
```

256 shards means contention is ~256x lower than a single map. The cost: each shard has its own janitor or its own LRU.

### A practical recommendation

For most services:

- < 10k keys: `sync.Map` with a background janitor.
- 10k-100k keys: sharded `sync.Map` with TTL.
- > 100k keys: dedicated cache library (ristretto, bigcache) with TTL.
- Bounded memory: LRU.

---

## Appendix C: Designing for Composition

A rate limiter rarely stands alone. It composes with circuit breakers, retries, queues, and timeouts. The order matters.

### Common layered architecture

```
[client] -> [rate limiter] -> [circuit breaker] -> [bulkhead] -> [downstream]
```

- The rate limiter caps the total request rate.
- The circuit breaker cuts off requests when the downstream is unhealthy.
- The bulkhead caps concurrent in-flight requests.
- The downstream is the actual work.

Each layer protects against a different failure mode:

- Rate limiter: too many requests per second.
- Circuit breaker: downstream is failing.
- Bulkhead: too many concurrent requests (avoiding queue blowup).

### Why this order

Place the cheapest filter first. Rate limiting is the cheapest (one atomic op or one mutex lock). Circuit breaker is next (one read of state). Bulkhead is most expensive (acquire a semaphore, may block).

Putting expensive checks first wastes work when an earlier check would reject anyway.

### Cancellation propagation

When a rate limit denies, the request fails fast. Good. When a circuit breaker is open, the request fails fast. Good. When a bulkhead is full, the request may block — which is potentially a problem.

If the bulkhead blocks but the rate limiter has already admitted the request, the slot is "consumed" by a blocked request. If the request times out, the slot is wasted (in `rate.Limiter` semantics) until canceled.

Mitigation: pass the context through every layer. Cancellation cascades and releases reservations.

### Don't double-count

A common mistake: rate limit at the LB and again at the app. The LB sees 200 RPS; the app sees 100 RPS (because LB already cut half). The app's limit of "1000 RPS" was meant to cap the LB's incoming rate, not the app's residual. The result: the app never throttles, even when the LB has degraded.

Mitigation: be explicit about which layer enforces which limit. Document it. Don't redundantly limit unless there is a clear reason (defence in depth, internal-only limits).

### Rate limit AFTER auth, before business logic

If you rate limit before authentication, anonymous attackers can starve legitimate users. Authenticate first (cheap, often a JWT verify), then apply per-user limits. The exception: limit anonymous endpoints (login, password reset) to prevent credential stuffing.

```
[/login] -> [per-IP rate limiter for login] -> [auth] -> [business logic]
[/api]   -> [auth] -> [per-user rate limiter] -> [business logic]
```

### Composing debouncers with throttles

A pattern that comes up: a UI fires events rapidly. You want to coalesce them (debounce) and then send them at a steady rate (throttle).

```go
type DebounceThenThrottle struct {
    debouncer *Trailing
    throttler *rate.Limiter
    send      func()
}

func NewDebounceThenThrottle(debounceDelay time.Duration, ratePerSec float64, send func()) *DebounceThenThrottle {
    d := &DebounceThenThrottle{
        throttler: rate.NewLimiter(rate.Limit(ratePerSec), 1),
        send:      send,
    }
    d.debouncer = NewTrailing(debounceDelay, func() {
        if d.throttler.Allow() {
            d.send()
        } else {
            d.throttler.Wait(context.Background())
            d.send()
        }
    })
    return d
}

func (d *DebounceThenThrottle) Trigger() {
    d.debouncer.Trigger()
}
```

The debouncer waits for quiescence; the throttler ensures even the rare debounced fires don't exceed the rate. This pattern is common in event-driven UIs and in cache-invalidation pipelines.

---

## Appendix D: A Production-Grade Debouncer Library

Putting together everything we have discussed, here is a small library that handles the common cases:

```go
package debounce

import (
    "context"
    "sync"
    "time"
)

type Options struct {
    Leading   bool
    Trailing  bool
    MaxWait   time.Duration // 0 means no max
    Delay     time.Duration
}

type Debouncer[T any] struct {
    mu         sync.Mutex
    opts       Options
    action     func(T)
    timer      *time.Timer
    maxTimer   *time.Timer
    pending    bool
    leading    bool
    value      T
    hasValue   bool
    stopped    bool
    inFlight   sync.WaitGroup
    cancelChan chan struct{}
}

func New[T any](opts Options, action func(T)) *Debouncer[T] {
    if !opts.Leading && !opts.Trailing {
        opts.Trailing = true
    }
    d := &Debouncer[T]{
        opts:       opts,
        action:     action,
        cancelChan: make(chan struct{}),
    }
    d.timer = time.AfterFunc(time.Hour, d.fireTrailing)
    d.timer.Stop()
    if opts.MaxWait > 0 {
        d.maxTimer = time.AfterFunc(time.Hour, d.fireMax)
        d.maxTimer.Stop()
    }
    return d
}

func (d *Debouncer[T]) Trigger(v T) {
    d.mu.Lock()
    if d.stopped {
        d.mu.Unlock()
        return
    }
    d.value = v
    d.hasValue = true
    fireLeading := false
    if d.opts.Leading && !d.leading {
        d.leading = true
        fireLeading = true
        if d.opts.MaxWait > 0 {
            d.maxTimer.Reset(d.opts.MaxWait)
        }
    } else {
        d.pending = true
    }
    d.timer.Reset(d.opts.Delay)
    if fireLeading {
        d.mu.Unlock()
        d.runAction(v)
        return
    }
    d.mu.Unlock()
}

func (d *Debouncer[T]) fireTrailing() {
    d.mu.Lock()
    if d.stopped {
        d.mu.Unlock()
        return
    }
    if !d.opts.Trailing {
        d.leading = false
        d.pending = false
        if d.maxTimer != nil {
            d.maxTimer.Stop()
        }
        d.mu.Unlock()
        return
    }
    fire := false
    var v T
    if d.pending {
        v = d.value
        fire = true
    }
    d.pending = false
    d.leading = false
    d.hasValue = false
    var zero T
    d.value = zero
    if d.maxTimer != nil {
        d.maxTimer.Stop()
    }
    d.mu.Unlock()
    if fire {
        d.runAction(v)
    }
}

func (d *Debouncer[T]) fireMax() {
    d.mu.Lock()
    if d.stopped {
        d.mu.Unlock()
        return
    }
    fire := false
    var v T
    if d.pending {
        v = d.value
        fire = true
    }
    d.pending = false
    d.leading = false
    d.hasValue = false
    var zero T
    d.value = zero
    d.timer.Stop()
    d.mu.Unlock()
    if fire {
        d.runAction(v)
    }
}

func (d *Debouncer[T]) runAction(v T) {
    d.inFlight.Add(1)
    defer d.inFlight.Done()
    d.action(v)
}

func (d *Debouncer[T]) Stop(ctx context.Context) error {
    d.mu.Lock()
    if d.stopped {
        d.mu.Unlock()
        return nil
    }
    d.stopped = true
    d.timer.Stop()
    if d.maxTimer != nil {
        d.maxTimer.Stop()
    }
    d.mu.Unlock()
    done := make(chan struct{})
    go func() {
        d.inFlight.Wait()
        close(done)
    }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (d *Debouncer[T]) Flush() {
    d.mu.Lock()
    if d.stopped || !d.pending {
        d.mu.Unlock()
        return
    }
    v := d.value
    d.pending = false
    d.hasValue = false
    d.leading = false
    var zero T
    d.value = zero
    d.timer.Stop()
    if d.maxTimer != nil {
        d.maxTimer.Stop()
    }
    d.mu.Unlock()
    d.runAction(v)
}
```

Features:

- Generic over the value type.
- Leading, trailing, both modes.
- Max-wait cap.
- Safe `Stop` with context-aware drain.
- `Flush` for forcing immediate action.
- No allocations on the trigger path beyond the timer reset.

Test it:

```go
func TestDebouncerTrailing(t *testing.T) {
    var got []string
    var mu sync.Mutex
    d := New(Options{Delay: 50 * time.Millisecond}, func(v string) {
        mu.Lock()
        got = append(got, v)
        mu.Unlock()
    })
    d.Trigger("a")
    d.Trigger("b")
    d.Trigger("c")
    time.Sleep(100 * time.Millisecond)
    mu.Lock()
    defer mu.Unlock()
    if len(got) != 1 || got[0] != "c" {
        t.Fatalf("want [c], got %v", got)
    }
}

func TestDebouncerLeading(t *testing.T) {
    var got []string
    var mu sync.Mutex
    d := New(Options{Delay: 50 * time.Millisecond, Leading: true, Trailing: false}, func(v string) {
        mu.Lock()
        got = append(got, v)
        mu.Unlock()
    })
    d.Trigger("a")
    d.Trigger("b")
    d.Trigger("c")
    time.Sleep(100 * time.Millisecond)
    mu.Lock()
    defer mu.Unlock()
    if len(got) != 1 || got[0] != "a" {
        t.Fatalf("want [a], got %v", got)
    }
}

func TestDebouncerMaxWait(t *testing.T) {
    var got []string
    var mu sync.Mutex
    d := New(Options{Delay: 100 * time.Millisecond, MaxWait: 200 * time.Millisecond}, func(v string) {
        mu.Lock()
        got = append(got, v)
        mu.Unlock()
    })
    for i := 0; i < 5; i++ {
        d.Trigger("a")
        time.Sleep(80 * time.Millisecond)
    }
    time.Sleep(250 * time.Millisecond)
    mu.Lock()
    defer mu.Unlock()
    // Should have fired at least twice: once at maxWait, once at the trailing edge.
    if len(got) < 2 {
        t.Fatalf("want at least 2 fires, got %v", got)
    }
}
```

---

## Appendix E: Comparing Algorithms on a Single Workload

To make algorithm choice concrete, let's run a hypothetical workload through several limiters and observe the outcomes.

### The workload

A client sends requests in the following pattern:

- t = 0..1s: 100 requests at a steady 100 RPS.
- t = 1..2s: silent (0 requests).
- t = 2..2.1s: 100 requests in 100 ms (a burst).
- t = 2.1..3s: 0 requests.
- t = 3..4s: 200 requests at a steady 200 RPS.

Total: 400 requests over 4 seconds. Average rate: 100 RPS.

### Limit: 100 RPS with burst 100

- **Token bucket (rate=100, burst=100)**:
  - t=0: bucket starts full with 100 tokens.
  - 0..1s: 100 requests admitted (uses 100 tokens; refilled 100 tokens). End: 100 tokens.
  - 1..2s: bucket fills to 100 (already full).
  - 2..2.1s: 100 burst requests. Bucket has 100 + 0.1*100 = 110 capped at 100. All 100 admitted. End: 0 tokens.
  - 2.1..3s: bucket refills to 90. No requests.
  - 3..4s: 200 requests. Bucket has 90 + 1.0*100 = 190 capped at 100 at t=4. Average available across the second: ~95. Of 200 requests, ~100 are admitted; the rest are denied.
  - Total admitted: 100 + 100 + ~100 = ~300 of 400.

- **Fixed-window counter (limit=100/sec)**:
  - 0..1s: 100 admitted. Counter resets at t=1.
  - 1..2s: 0.
  - 2..2.1s: 100 admitted (counter was 0). Counter resets at t=3.
  - 3..4s: 100 admitted; the other 100 denied.
  - Total: 100 + 100 + 100 = 300. But the second window had 100 in 100 ms and then the third window also had 100 in 100 ms — within 0.2 seconds 200 were admitted, exceeding the intent.

- **Sliding-window counter (window=1s, limit=100)**:
  - At t=1: 100 in past 1s. Window admits up to 100. No room.
  - At t=2.05: previous-window count = 100, current = 50, fraction elapsed = 0.05. Estimate = 100*(1-0.05) + 50 = 95 + 50 = 145. Over 100. Deny.
  - Actually the burst at t=2 was 100 requests in 100 ms. By the time we are halfway through, we have admitted 50 and estimated 145 — so 50 are admitted, 50 denied.
  - 3..4s: previous-window mostly contains the burst (decaying). Strict admission.
  - Total: ~250.

- **Leaky bucket queue (rate=100, capacity=100)**:
  - 0..1s: 100 requests; all queued; all dispatched at 100 RPS. The 100th request dispatches at t=1.
  - 1..2s: idle.
  - 2..2.1s: 100 requests; all queued; dispatched at 100 RPS from t=2. The 100th dispatches at t=3.
  - 3..4s: 200 requests; the first 100 queued at t=3..3.5s (with the previous 100 still draining until t=3? no, by t=3 the queue is empty). So the first 100 of the new 200 join the queue and dispatch from t=3 to t=4 at 100 RPS. The second 100 — but capacity is 100; if the queue is full they are denied.
  - Total admitted: 100 + 100 + 100 = 300.

So three of the four algorithms admit roughly 300 out of 400 in this workload. The sliding-window admits fewer (~250) because it tracks the trailing window strictly. The fixed-window admits the most without penalty for the boundary-clustering — but the boundary effect is visible: 200 requests in 0.2 seconds were admitted.

### Lessons

- For most workloads token bucket is forgiving and admits the highest fraction of legitimate requests.
- Fixed-window is the simplest but has the boundary-clustering vulnerability.
- Sliding-window is the strictest and the most fair.
- Leaky bucket queue smooths perfectly but adds latency.

The choice depends on what "wrong" means for your workload. For a public API where boundary-clustering attacks matter, sliding-window. For an internal service where bursts are expected, token bucket. For an SMTP outflow, leaky bucket queue.

---

## Appendix F: Debouncer Pitfalls and Best Practices

A summary of the patterns we have seen, focused on what goes wrong.

### Pitfall 1: forgetting to cancel pending timers on shutdown

```go
type App struct {
    debouncer *Trailing
}

func (a *App) Shutdown() {
    // Forgot to call a.debouncer.Stop()
}
```

The debouncer's timer is still alive in the runtime's timer heap. If the debouncer holds a reference to a database connection (via its action closure), the connection cannot be reclaimed.

Always call `Stop` on debouncers in shutdown paths.

### Pitfall 2: debouncer in a request-scoped struct

```go
func handler(w http.ResponseWriter, r *http.Request) {
    d := NewTrailing(50 * time.Millisecond, func() {
        // send a notification
    })
    for _, event := range parseEvents(r.Body) {
        d.Trigger()
    }
    // handler returns
    // d's timer is still pending; the goroutine running fire() will execute after handler returned
}
```

The handler returns before the debouncer fires. If the action uses `r.Context()` or `w`, those are no longer valid. The action runs in a detached goroutine that may write to a closed `ResponseWriter`.

Always join: either call `d.Flush()` before returning, or `d.Stop(ctx)` to drain.

### Pitfall 3: leaking timer goroutines

`time.AfterFunc` does not start a goroutine — it adds the timer to the runtime's heap and the runtime fires it on a single timer goroutine. So a debouncer does not "leak goroutines" per se, but it does pin the closure (and anything it captures) in memory until the timer is stopped or fires.

The leak is memory, not goroutines. The mitigation is the same: `Stop`.

### Pitfall 4: action panics

If the debouncer's action panics, the panic propagates up to the timer goroutine, which crashes the program.

```go
d := NewTrailing(50*time.Millisecond, func() {
    panic("boom")
})
d.Trigger()
// Eventually the timer fires, panics in the runtime's timer goroutine.
// Go default behaviour: crash the program.
```

Mitigation: wrap the action in `recover`.

```go
func safeAction(action func()) func() {
    return func() {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("debouncer action panicked: %v", r)
            }
        }()
        action()
    }
}
```

### Pitfall 5: time.Now in the action

If the action calls `time.Now()` expecting the trigger time, it gets the *fire* time, which is delayed by the debounce period. This can be confusing.

Mitigation: capture the trigger time at trigger and pass it to the action.

```go
type TimedDebouncer struct {
    mu        sync.Mutex
    timer     *time.Timer
    delay     time.Duration
    lastTrig  time.Time
    action    func(triggered time.Time)
}

func (d *TimedDebouncer) Trigger() {
    d.mu.Lock()
    d.lastTrig = time.Now()
    d.timer.Reset(d.delay)
    d.mu.Unlock()
}

func (d *TimedDebouncer) fire() {
    d.mu.Lock()
    t := d.lastTrig
    d.mu.Unlock()
    d.action(t)
}
```

### Pitfall 6: not testing the debouncer

Debouncers are timer-driven, which makes them hard to test deterministically. Two approaches:

1. Mock the clock. Inject a `Clock` interface and use a fake in tests.
2. Use real time but pick periods that are comfortably long enough to be reliable.

```go
type Clock interface {
    Now() time.Time
    AfterFunc(d time.Duration, f func()) Timer
}

type Timer interface {
    Stop() bool
    Reset(d time.Duration) bool
}

// Real clock uses time package.
// Fake clock advances on command in tests.
```

A library like `github.com/jonboulle/clockwork` provides exactly this.

### Pitfall 7: capturing too much

```go
d := NewTrailing(50*time.Millisecond, func() {
    saveCacheToDisk(cache) // closure captures cache and disk
})
```

The closure captures `cache` and `saveCacheToDisk`'s receiver. As long as the debouncer is alive, the captured references are alive. If the cache is multi-gigabyte, the debouncer pins gigabytes of memory.

Mitigation: scope the closure tightly. Pass only what is needed.

### Pitfall 8: re-entrant trigger

The action of a debouncer calls `Trigger` on itself.

```go
d := NewTrailing(50*time.Millisecond, func() {
    if needsRetry() {
        d.Trigger()
    }
})
```

This is fine if the debouncer's `Trigger` is reentrant (it is, in our implementations because we release the lock before calling the action). The result is the debouncer fires again 50 ms later. Repeated retries amount to a periodic fire.

If you actually want a periodic fire, use a Ticker. If you actually want to retry on failure, use a backoff schedule, not a debouncer.

### Best practice: lifecycle ownership

Every debouncer has an owner. The owner is responsible for:

- Creating it.
- Calling `Trigger` on it.
- Calling `Stop` (or `Flush`) when done.
- Handling the case where the action panics.

Embed the debouncer in the owner struct, not as a global. Make `Stop` part of the owner's `Close` method.

```go
type Indexer struct {
    debouncer *Debouncer[Event]
}

func NewIndexer(...) *Indexer {
    i := &Indexer{}
    i.debouncer = New(Options{Delay: 100*time.Millisecond, Trailing: true}, i.flush)
    return i
}

func (i *Indexer) Submit(e Event) {
    i.debouncer.Trigger(e)
}

func (i *Indexer) flush(e Event) {
    // process
}

func (i *Indexer) Close(ctx context.Context) error {
    return i.debouncer.Stop(ctx)
}
```

Clean lifecycle, no leaks, testable.

---

## Appendix G: Hardware Perspective

A short detour into the hardware reality of rate limiters.

### Cache lines

Modern CPUs have 64-byte cache lines. When a value is read or written, the entire line is brought into L1 cache. A struct that spans two lines costs two line fetches.

Rate limiter state is small (a single atomic, a few floats) so it fits in one line. But when multiple limiters' state lives adjacent in memory (e.g., an array of limiters), they may share lines and false-share.

Fix: pad limiters to 64-byte boundaries.

```go
type PaddedLimiter struct {
    rate.Limiter
    _ [64 - unsafe.Sizeof(rate.Limiter{}) % 64]byte
}
```

The math gets tricky because `rate.Limiter` has a `sync.Mutex` and we cannot easily compute its size at compile time. In practice, place each limiter in its own allocation (a pointer) rather than embedding in an array, which gives 64-byte allocation alignment for free.

### Memory ordering

Atomic operations in Go are sequentially consistent (the default semantic for `sync/atomic`). This is strong but expensive on weakly-ordered architectures (ARM64).

For a single-counter increment, sequential consistency is essentially free (the atomic instruction is the same). For more complex operations (read-modify-write loops), the difference matters.

`atomic.AddInt64` on x86: `lock xadd`. ~5-10 ns.
`atomic.AddInt64` on ARM64: `ldaddal` (with full barriers) or a loop of `ldxr/stlxr`. ~15-25 ns.

For a counter at millions of ops per second, the difference between x86 and ARM is real.

### NUMA

On large multi-socket machines, memory access across NUMA nodes is much slower (50-100 ns vs 10-15 ns local). A counter pinned to one NUMA node is fast for that node and slow for others.

The pragmatic fix: shard by CPU, where each shard's memory is naturally on the local NUMA node (because the goroutine that initialised it ran there). This is fragile (the runtime may migrate goroutines) but the average effect is positive.

### Branch prediction

A rate limiter's hot loop:

```go
if tokens >= 1 {
    tokens--
    return true
}
return false
```

The branch is heavily biased: usually one direction (mostly allowed, or mostly denied). The CPU's branch predictor exploits this. If the limiter is well-tuned (deny rate < 1% or > 99%), prediction is near-perfect and branches cost nothing. If the deny rate hovers around 50%, prediction misses dominate.

Not much you can do about it directly, but it is a reason to *not* tune your limiter to admit exactly half the requests. Either admit almost all and rely on occasional denial, or deny most and rely on occasional admission.

---

## Appendix H: Glossary

- **Burst (b)**: the maximum number of events admitted back-to-back with no delay. Equivalent to the bucket's capacity.
- **Rate (r)**: the long-term admitted events per second.
- **Token**: a unit of admission. One per request unless weighted.
- **Bucket**: the state container for a token-bucket limiter.
- **TAT (theoretical arrival time)**: the GCRA state value.
- **Tolerance (tau)**: the GCRA state-parameter equivalent to (b-1)/r.
- **Window**: the time interval over which a fixed-window or sliding-window counter counts.
- **Debounce**: collapse a burst of events into one trigger after silence.
- **Throttle**: enforce a maximum event rate.
- **Coalesce**: combine multiple events into one aggregated event.
- **Leading edge**: the first event of a burst.
- **Trailing edge**: the last event of a burst.
- **Refill**: in a token bucket, the addition of tokens since the last update.
- **CAS (compare-and-swap)**: an atomic operation that updates a value if it matches an expected value.
- **Striping**: distributing state across multiple cells to reduce contention.
- **Sharding**: partitioning requests across multiple limiter instances.
- **Hierarchical token bucket (HTB)**: a tree of token buckets enforcing layered limits.
- **GCRA (Generic Cell Rate Algorithm)**: a rate-limiting algorithm using a single state value (TAT).
- **AIMD (Additive Increase Multiplicative Decrease)**: an adaptive algorithm for tuning rate based on success/failure.

---

## Appendix I: Further Reading

- The source of `golang.org/x/time/rate`. ~500 lines, readable.
- "Cloud-Scale Rate Limiting" by Stripe engineering — describes the GCRA-based limiter Stripe uses.
- "Doorman: Global Distributed Client Side Rate Limiting" — Google's paper on adaptive distributed rate limiting.
- "Adaptive Concurrency Limits" — Netflix's library and the underlying TCP-inspired algorithm.
- Linux kernel's `htb_enqueue` for HTB qdisc — the canonical hierarchical token bucket implementation.
- "Hashed and Hierarchical Timing Wheels" by George Varghese — relevant to large fleets of debouncers.

---

---

## Appendix J: Testing Rate Limiters Without Real Time

Real time is the enemy of fast, deterministic tests. A 1-second test that exercises a 100 RPS limiter is slow and flaky. The solution is a fake clock.

### A clock interface

```go
package clock

import "time"

type Clock interface {
    Now() time.Time
    Since(t time.Time) time.Duration
    NewTimer(d time.Duration) Timer
    AfterFunc(d time.Duration, f func()) Timer
    Sleep(d time.Duration)
}

type Timer interface {
    Stop() bool
    Reset(d time.Duration) bool
    C() <-chan time.Time
}
```

The real implementation forwards to the `time` package; the fake advances on command.

### Fake clock

```go
package clock

import (
    "container/heap"
    "sync"
    "time"
)

type FakeClock struct {
    mu     sync.Mutex
    now    time.Time
    timers timerHeap
}

func NewFake() *FakeClock {
    return &FakeClock{now: time.Unix(0, 0)}
}

func (c *FakeClock) Now() time.Time {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.now
}

func (c *FakeClock) Since(t time.Time) time.Duration {
    return c.Now().Sub(t)
}

func (c *FakeClock) Advance(d time.Duration) {
    c.mu.Lock()
    c.now = c.now.Add(d)
    deadline := c.now
    var due []*fakeTimer
    for c.timers.Len() > 0 && !c.timers[0].when.After(deadline) {
        t := heap.Pop(&c.timers).(*fakeTimer)
        due = append(due, t)
    }
    c.mu.Unlock()
    for _, t := range due {
        t.fire()
    }
}

type fakeTimer struct {
    when time.Time
    f    func()
    ch   chan time.Time
    idx  int
}

func (t *fakeTimer) fire() {
    if t.f != nil {
        t.f()
    } else {
        select {
        case t.ch <- t.when:
        default:
        }
    }
}

func (t *fakeTimer) Stop() bool {
    // omitted: lookup in heap, remove
    return true
}

func (t *fakeTimer) Reset(d time.Duration) bool {
    // omitted
    return true
}

func (t *fakeTimer) C() <-chan time.Time {
    return t.ch
}

type timerHeap []*fakeTimer

func (h timerHeap) Len() int            { return len(h) }
func (h timerHeap) Less(i, j int) bool  { return h[i].when.Before(h[j].when) }
func (h timerHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i]; h[i].idx = i; h[j].idx = j }
func (h *timerHeap) Push(x interface{}) { *h = append(*h, x.(*fakeTimer)) }
func (h *timerHeap) Pop() interface{}   { x := (*h)[len(*h)-1]; *h = (*h)[:len(*h)-1]; return x }

func (c *FakeClock) AfterFunc(d time.Duration, f func()) Timer {
    c.mu.Lock()
    defer c.mu.Unlock()
    t := &fakeTimer{when: c.now.Add(d), f: f}
    heap.Push(&c.timers, t)
    return t
}

func (c *FakeClock) NewTimer(d time.Duration) Timer {
    c.mu.Lock()
    defer c.mu.Unlock()
    t := &fakeTimer{when: c.now.Add(d), ch: make(chan time.Time, 1)}
    heap.Push(&c.timers, t)
    return t
}

func (c *FakeClock) Sleep(d time.Duration) {
    // In tests, sleep is replaced with Advance.
    panic("FakeClock.Sleep called; use Advance instead")
}
```

### Using the fake in a limiter

```go
type Bucket struct {
    clock    clock.Clock
    mu       sync.Mutex
    rate     float64
    capacity float64
    tokens   float64
    last     time.Time
}

func New(c clock.Clock, rate, capacity float64) *Bucket {
    return &Bucket{
        clock:    c,
        rate:     rate,
        capacity: capacity,
        tokens:   capacity,
        last:     c.Now(),
    }
}

func (b *Bucket) Allow() bool {
    b.mu.Lock()
    defer b.mu.Unlock()
    now := b.clock.Now()
    elapsed := now.Sub(b.last).Seconds()
    b.tokens += elapsed * b.rate
    if b.tokens > b.capacity {
        b.tokens = b.capacity
    }
    b.last = now
    if b.tokens >= 1 {
        b.tokens -= 1
        return true
    }
    return false
}
```

The limiter takes a `clock.Clock` and uses it instead of `time.Now`. Production wires up the real clock; tests wire up the fake.

### A deterministic test

```go
func TestBucketBurstThenRefill(t *testing.T) {
    fake := clock.NewFake()
    b := New(fake, 10, 5) // 10 RPS, burst 5
    // Drain the burst.
    for i := 0; i < 5; i++ {
        if !b.Allow() {
            t.Fatalf("expected admit at %d", i)
        }
    }
    // Next call denied.
    if b.Allow() {
        t.Fatal("expected deny when bucket empty")
    }
    // Advance time by 0.5 second; should accumulate 5 tokens.
    fake.Advance(500 * time.Millisecond)
    for i := 0; i < 5; i++ {
        if !b.Allow() {
            t.Fatalf("expected admit at %d after refill", i)
        }
    }
    if b.Allow() {
        t.Fatal("expected deny after second burst")
    }
}
```

No real sleep. The test is deterministic and runs in microseconds.

### Testing the wait path

For limiters that wait, you need to drive the fake clock concurrently with the goroutine that is waiting:

```go
func TestBucketWait(t *testing.T) {
    fake := clock.NewFake()
    b := New(fake, 10, 1)
    b.Allow() // drains
    done := make(chan struct{})
    go func() {
        b.Wait(context.Background())
        close(done)
    }()
    // Without time advancing, Wait should block.
    select {
    case <-done:
        t.Fatal("Wait returned without time advancing")
    case <-time.After(10 * time.Millisecond):
        // expected
    }
    fake.Advance(100 * time.Millisecond)
    select {
    case <-done:
        // expected
    case <-time.After(100 * time.Millisecond):
        t.Fatal("Wait did not return after advancing time")
    }
}
```

A real 10 ms wait is still used to check that `Wait` is blocked. This is the only real-time element. The "advance" itself is instantaneous.

### Library support

`github.com/jonboulle/clockwork` and `github.com/benbjohnson/clock` are two well-tested implementations of this pattern. Use one of them rather than rolling your own unless your needs are special.

### Testing distributed limiters

For Redis-backed limiters, use `miniredis` (a Redis-protocol in-memory fake) and inject the clock:

```go
func TestRedisLimiter(t *testing.T) {
    mr := miniredis.RunT(t)
    rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
    fake := clock.NewFake()
    l := NewRedisTokenBucket(rdb, 10, 5)
    l.now = fake.Now // inject
    // ... test as before, using mr.FastForward to advance Redis's clock too.
    mr.FastForward(100 * time.Millisecond)
    fake.Advance(100 * time.Millisecond)
}
```

`miniredis` supports `FastForward` to advance its internal clock for TTL testing, so EXPIRE works with the fake.

---

## Appendix K: Failure Recovery Patterns

What happens when the rate limiter itself is the problem?

### Self-throttling

A limiter that learns from its own behaviour. If 99% of admissions are followed by a downstream failure, the limiter should reduce its rate even without an explicit error signal.

```go
type SelfTuning struct {
    bucket    *Bucket
    success   atomic.Int64
    fail      atomic.Int64
    interval  time.Duration
    targetSuccessRate float64
}

func (s *SelfTuning) Record(succeeded bool) {
    if succeeded {
        s.success.Add(1)
    } else {
        s.fail.Add(1)
    }
}

func (s *SelfTuning) Loop(ctx context.Context) {
    t := time.NewTicker(s.interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            ok := s.success.Swap(0)
            bad := s.fail.Swap(0)
            total := ok + bad
            if total < 10 {
                continue
            }
            rate := float64(ok) / float64(total)
            currentRate := s.bucket.Rate()
            if rate < s.targetSuccessRate {
                s.bucket.SetRate(currentRate * 0.9)
            } else if rate > s.targetSuccessRate+0.05 {
                s.bucket.SetRate(currentRate * 1.05)
            }
        }
    }
}
```

The limiter watches its own success rate and adjusts. This is a form of AIMD but driven by observed outcomes, not by per-request signals.

### Bypass for emergencies

Sometimes you need to override the limiter. An on-call engineer needs to fire a "force refresh all caches" event. The rate limiter normally denies, but during incidents the operator needs a bypass.

```go
type BypassableLimiter struct {
    base    *Bucket
    bypassed atomic.Bool
}

func (l *BypassableLimiter) SetBypassed(b bool) {
    l.bypassed.Store(b)
}

func (l *BypassableLimiter) Allow() bool {
    if l.bypassed.Load() {
        return true
    }
    return l.base.Allow()
}
```

Expose via a debug endpoint behind authentication.

### Circuit-breaker integration

Combine the limiter with a circuit breaker so that:

- Normally, the limiter caps the rate.
- If the downstream is failing, the breaker opens and the limiter is bypassed (no point in admitting calls that will fail).
- If the breaker is closed, the limiter is in charge.

```go
type ProtectedClient struct {
    limiter *Bucket
    breaker *Breaker
    target  func() error
}

func (c *ProtectedClient) Call() error {
    if !c.breaker.Allow() {
        return ErrCircuitOpen
    }
    if !c.limiter.Allow() {
        return ErrRateLimited
    }
    err := c.target()
    if err != nil {
        c.breaker.RecordFailure()
    } else {
        c.breaker.RecordSuccess()
    }
    return err
}
```

The order matters: check the breaker first (cheaper, and if open we skip the limiter entirely). If the breaker is closed, check the limiter. If both pass, make the call.

### Graceful degradation

When the limiter is denying too much (say >50% for an extended period), the system is over-loaded. Options:

- Shed traffic at the edge (load balancer) so the limiter sees less.
- Drop low-priority traffic so high-priority can pass.
- Scale up the downstream.
- Increase the limit (manually or automatically).

A well-designed system has playbooks for each. The limiter is one of several signals that trigger them.

---

## Appendix L: The Mental Model

After all the patterns and code, here is the mental model to carry into design discussions.

A rate limiter is a *contract* between two parties. The producer (caller) agrees to send no more than `r` events per second with bursts up to `b`. The consumer (limiter) agrees to admit any request that complies with the contract.

When the producer violates the contract, the limiter has three choices: drop, queue, or block. Each has different semantics for the producer's experience.

The algorithm choice (token bucket, leaky bucket, sliding window, GCRA) determines *how* the contract is checked. The choice of behavior on overflow determines what *happens* when the contract is violated. These are independent decisions.

In a distributed system, the contract must be coordinated. Local enforcement is approximate; global enforcement requires a coordinator. The coordinator can be authoritative (Redis), partitioned (consistent hash), or eventual (gossip).

Observability turns the contract into something you can audit. Without metrics you cannot verify the contract is being enforced or understand why it is being violated.

Failure modes are inherent to distributed systems. The limiter must have a plan for every failure: backing store down, clock skew, network partition, hot key, thundering herd.

The senior level is precisely this: understanding the contract, the choices, the trade-offs, and the failure modes deeply enough to design a limiter that fits the workload — not just call one.

---

End of senior-level material. The next document — `professional.md` — takes these ideas into production: HTTP 429 semantics with `Retry-After` headers and `X-RateLimit-*` family, UI debounce patterns in real frontends with backend coordination, log throttling that prevents disk fill during downstream outages, dashboards that surface limiter behavior, integration with circuit breakers in service meshes, and postmortems from real outages where the rate limiter was either the hero or the villain.



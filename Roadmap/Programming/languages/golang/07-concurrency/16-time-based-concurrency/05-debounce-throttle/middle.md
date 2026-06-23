---
layout: default
title: Middle
parent: Debounce and Throttle
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/05-debounce-throttle/middle/
---

# Debounce and Throttle — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Recap of the junior material](#recap-of-the-junior-material)
3. [Leading, trailing, and both: the full picture](#leading-trailing-and-both-the-full-picture)
4. [The cancellable debouncer in production](#the-cancellable-debouncer-in-production)
5. [Meeting `golang.org/x/time/rate`](#meeting-golangorgxtimerate)
6. [Token bucket under the hood](#token-bucket-under-the-hood)
7. [Real input streams](#real-input-streams)
8. [Composition patterns](#composition-patterns)
9. [Channels, select, and ordering guarantees](#channels-select-and-ordering-guarantees)
10. [Per-actor throttling](#per-actor-throttling)
11. [Coalescing payloads](#coalescing-payloads)
12. [Testing with fake clocks](#testing-with-fake-clocks)
13. [Error handling and recovery](#error-handling-and-recovery)
14. [Observability hooks](#observability-hooks)
15. [Common middle-level mistakes](#common-middle-level-mistakes)
16. [A long worked example: editor autosave](#a-long-worked-example-editor-autosave)
17. [A long worked example: HTTP client with retry](#a-long-worked-example-http-client-with-retry)
18. [Pitfalls and tricky points](#pitfalls-and-tricky-points)
19. [Interview-grade questions](#interview-grade-questions)
20. [Cheat sheet](#cheat-sheet)
21. [Summary](#summary)

---

## Introduction

By the end of `junior.md` you can write a trailing debouncer and a basic throttle. The middle level is where you start writing the variants that real products want, plug into the standard library's rate limiter, and design code that survives production traffic.

Specifically, in this file you will:

- Write leading, trailing, and "leading + trailing" debouncers
- Implement `Cancel` and `Flush` properly without races
- Use `golang.org/x/time/rate.Limiter` and understand its three core operations (`Allow`, `Wait`, `Reserve`)
- Connect debounce and throttle to real input sources — keystrokes from `bufio.Reader`, HTTP requests, file-watcher events
- Compose multiple stages into pipelines
- Manage per-actor state with eviction
- Write proper tests using a fake clock
- Add observability so you can see what your debouncer is doing in production

Nothing here is "wrong" with respect to `junior.md`; we are adding precision and depth. By the end you will be writing code that holds up under code review at a serious Go shop.

---

## Recap of the junior material

A condensed reminder of the core distinctions:

- **Debounce** = wait for silence. Reset a timer on every event. Fire only after the window passes with no events.
- **Throttle** = watch the clock. Allow events at a fixed maximum frequency. Drop, queue, or block the overflow.
- The simplest debouncer is `time.AfterFunc` + `Stop`/replace under a mutex.
- The simplest throttle is `time.Ticker` + a single-slot channel, or a `time.Now`-based `Allow`.
- Always handle `context.Context` cancellation.
- Always `Stop` your ticker.

Hold those in mind as we add complexity. The new patterns are *additions* to that base, not replacements.

---

## Leading, trailing, and both: the full picture

A debouncer can fire at one of three moments:

1. **Trailing edge** — fire after the burst ends. This is the default.
2. **Leading edge** — fire at the start of the burst. Subsequent events are ignored until silence is restored.
3. **Both edges** — fire at the start *and* the end of a burst.

Each has its place; mixing them up causes subtle bugs.

### When to use leading-edge debounce

- Buttons that should give immediate feedback ("Submit", "Like", "Refresh")
- Toggles where the first click is the "real" intent and subsequent rapid clicks are accidental
- "Don't repeat the action for a while" semantics (debounce-as-cooldown)
- Single-shot remote calls where idempotency is not guaranteed

### When to use trailing-edge debounce

- Search-as-you-type
- Auto-save while typing
- Filesystem-watcher reloads (multiple write events for one logical save)
- Window-resize handlers
- Form validation

### When to use both edges

- Real-time collaboration: show "user is typing..." at the start, send the actual edit at the end
- Mobile UI: light up a button immediately, send the request on release
- Stream coalescing: emit one event for "started", one event for "ended", drop the middle

### Implementation: the unified debouncer

A clean way to implement all three flavours is one struct with policy flags:

```go
package debounce

import (
    "sync"
    "time"
)

type Policy uint8

const (
    Trailing Policy = 1 << iota
    Leading
)

type Debouncer struct {
    mu      sync.Mutex
    wait    time.Duration
    fn      func()
    policy  Policy
    timer   *time.Timer
    inBurst bool
}

func New(wait time.Duration, policy Policy, fn func()) *Debouncer {
    return &Debouncer{wait: wait, policy: policy, fn: fn}
}

func (d *Debouncer) Trigger() {
    d.mu.Lock()
    fireNow := false
    if !d.inBurst && d.policy&Leading != 0 {
        fireNow = true
    }
    d.inBurst = true
    if d.timer != nil {
        d.timer.Stop()
    }
    d.timer = time.AfterFunc(d.wait, d.tail)
    d.mu.Unlock()
    if fireNow {
        d.fn()
    }
}

func (d *Debouncer) tail() {
    d.mu.Lock()
    wasInBurst := d.inBurst
    d.inBurst = false
    d.mu.Unlock()
    if wasInBurst && d.policy&Trailing != 0 {
        d.fn()
    }
}

func (d *Debouncer) Cancel() {
    d.mu.Lock()
    d.inBurst = false
    if d.timer != nil {
        d.timer.Stop()
        d.timer = nil
    }
    d.mu.Unlock()
}
```

Usage:

```go
// Trailing: fire 200ms after the last event.
d := New(200*time.Millisecond, Trailing, save)

// Leading: fire at the first event, ignore subsequent for 200ms.
d := New(200*time.Millisecond, Leading, submit)

// Both: fire on first and last events of a burst.
d := New(200*time.Millisecond, Leading|Trailing, blink)
```

A bitfield is the canonical Go way to express "any combination of these flags".

### Subtlety: trailing fires only if there was a burst

The `wasInBurst` check matters. If only one event arrived and the policy is `Leading|Trailing`, you do *not* want to fire twice — once for the leading edge and once for the trailing edge — because that is logically the same event firing twice. The check "did we actually have an ongoing burst" prevents that.

For pure `Trailing`, the same check holds: if `Cancel` was called between `Trigger` and the timer firing, do not fire.

### Subtlety: fireNow under lock

We compute `fireNow := true` while holding the mutex but call `d.fn()` *after* releasing it. This is intentional: `fn` might be slow or might re-enter the debouncer (calling `Trigger` from inside `fn`). Holding the mutex across `fn` is a classic deadlock recipe.

---

## The cancellable debouncer in production

The `Cancel` method we just added is the difference between a toy and a production-grade debouncer. Real systems need to cancel pending work for many reasons:

- Context cancellation cascading
- Hot reload of configuration
- User navigation away from a page
- Test teardown
- Graceful shutdown

A `Cancel` that does not race with the timer firing is hard. Our version uses `timer.Stop()` and discards its return value. The race is: `Cancel` runs, sets `timer = nil`, but the timer's goroutine has *already* started running `tail`. The `inBurst = false` we set under lock blocks `tail` from firing, but `tail` already entered its lock acquisition path. Let's trace:

1. Goroutine A: `Cancel` acquires lock.
2. Goroutine A: sets `inBurst = false`, `timer.Stop()`, `timer = nil`.
3. Goroutine A: releases lock.
4. Goroutine B (the timer's): `tail` acquires lock.
5. Goroutine B: sees `wasInBurst == false`, does not fire.
6. Goroutine B: releases lock.

Good. The mutex serialises the two operations and `wasInBurst` carries the cancellation signal.

But what if the order is reversed?

1. Goroutine B: timer fires, `tail` acquires lock.
2. Goroutine B: reads `wasInBurst = true`, sets `inBurst = false`.
3. Goroutine B: releases lock.
4. Goroutine A: `Cancel` acquires lock.
5. Goroutine A: stops a timer that already fired (`Stop` returns false), sets `timer = nil`.
6. Goroutine A: releases lock.
7. Goroutine B: calls `d.fn()`.

In this ordering `Cancel` did *not* prevent the fire. The fire was already in flight. There is no way to prevent that without coordination *inside* `fn` itself. If preventing a stale fire is critical, `fn` should check a "live" flag before doing anything observable:

```go
func (d *Debouncer) fn() {
    d.mu.Lock()
    cancelled := d.cancelToken
    d.mu.Unlock()
    if !cancelled {
        actuallyDoWork()
    }
}
```

We will come back to this idea in `senior.md` when we discuss generation tokens for safe cancellation.

---

## Meeting `golang.org/x/time/rate`

The `golang.org/x/time/rate` package is the standard token-bucket rate limiter shipped by the Go team. It is not in the standard library proper (it lives in the `golang.org/x` "blessed extensions" tree) but it is the canonical answer to "give me a rate limiter".

### Installation

```sh
go get golang.org/x/time/rate
```

### The core type

```go
type Limiter struct { /* unexported */ }

func NewLimiter(r rate.Limit, b int) *Limiter
```

- `r`: the refill rate as `rate.Limit`, which is `events per second` as a float. Use `rate.Every(d)` to convert from "one event every d" to a `rate.Limit`.
- `b`: the bucket capacity (maximum burst size).

### Example: 10 requests per second, burst of 20

```go
import "golang.org/x/time/rate"

l := rate.NewLimiter(10, 20)
```

This means the steady-state rate is 10 ops/sec but you can burst up to 20 ops if the bucket has been quiet.

### The three operations

Every interaction with a `Limiter` is one of:

1. `l.Allow()` — returns `true` if a token was available *right now*. Non-blocking, lossy. Best for "drop the event if over-limit".
2. `l.Wait(ctx)` — blocks until a token is available, or until `ctx` is cancelled. Best for "queue this event".
3. `l.Reserve()` — returns a `*Reservation` representing a future token. The caller can ask how long until the token is available, decide whether to wait, or cancel the reservation.

### Example: `Allow`

```go
l := rate.NewLimiter(rate.Every(100*time.Millisecond), 1)
for i := 0; i < 20; i++ {
    if l.Allow() {
        log.Println("served", i)
    } else {
        log.Println("dropped", i)
    }
    time.Sleep(20 * time.Millisecond)
}
```

20 events in 400ms; rate is 10/sec; expect about 4 served and 16 dropped.

### Example: `Wait`

```go
l := rate.NewLimiter(rate.Every(100*time.Millisecond), 1)
for i := 0; i < 20; i++ {
    if err := l.Wait(ctx); err != nil {
        return err
    }
    sendRequest(i)
}
```

All 20 events served; total time at least 2 seconds. The limiter enforces the rate by blocking.

### Example: `Reserve`

```go
l := rate.NewLimiter(rate.Every(100*time.Millisecond), 1)
for i := 0; i < 20; i++ {
    r := l.Reserve()
    if !r.OK() {
        log.Println("not allowed")
        continue
    }
    delay := r.Delay()
    if delay > 50*time.Millisecond {
        r.Cancel()
        continue
    }
    time.Sleep(delay)
    sendRequest(i)
}
```

`Reserve` returns a reservation whose `Delay()` says how long until the slot. The caller can decide to wait, drop, or cancel the reservation (which returns the token to the bucket). This is the most flexible API and the basis of higher-level patterns like "wait at most 500ms, otherwise drop".

### Choosing between Allow, Wait, and Reserve

- `Allow` when events are cheap to drop and you do not want callers to block.
- `Wait` when every event must be processed (eventually) and you can afford to wait.
- `Reserve` when you want a budget — "I will wait at most X" or "I want to know how long until I'm allowed".

### Updating rates at runtime

```go
l.SetLimit(rate.Every(50 * time.Millisecond)) // increase to 20 RPS
l.SetBurst(40)                                 // double the burst
```

Rates can be changed without recreating the limiter. The state is preserved. Useful for adaptive throttling.

### Limiter is concurrency-safe

All methods on `*Limiter` are safe to call from multiple goroutines concurrently. You can share one limiter across hundreds of goroutines. The internal state is protected by a mutex (and minor atomic ops); the contention is well-tuned.

### Replacing our hand-rolled throttle

The hand-rolled limiter in `junior.md`:

```go
type Limiter struct {
    mu       sync.Mutex
    interval time.Duration
    last     time.Time
}
```

is functionally equivalent to:

```go
l := rate.NewLimiter(rate.Every(interval), 1)
```

For burst-of-one rate limits, both are correct. For burst-of-many, the hand-rolled version has a bug (it tracks only "last fire", not "tokens available"); use `rate.Limiter`.

---

## Token bucket under the hood

The math of a token bucket is a one-liner once you see it. The bucket has:

- Capacity `B` (max tokens)
- Refill rate `R` (tokens per second)
- Current count `T` and last update time `t_last`

On each query at time `now`:

```
T_new = min(B, T + R * (now - t_last))
t_last_new = now
if T_new >= 1:
    T_new = T_new - 1
    return ALLOW
else:
    return DENY
```

That's it. The whole "token bucket algorithm" is six lines. The complexity of `rate.Limiter` is not in the math; it is in concurrency safety, fractional tokens, reservation accounting, and clock monotonicity.

### Burst behaviour

If the bucket has been idle for `B / R` seconds, it is full. The first `B` events are allowed instantly. Then the rate slows to `R` events/second.

### Steady-state behaviour

After the initial burst, the average rate equals `R`. Over any window long enough, the count of allowed events approaches `R * window`.

### Fractional tokens

Real implementations track fractional tokens. If `R = 2.5/sec` and `now - t_last = 0.4s`, then `R * (now - t_last) = 1.0` tokens added. With integer arithmetic this rounds; with float arithmetic it is exact. `rate.Limiter` uses float64 internally.

### Why a token bucket and not a fixed window?

A fixed-window counter ("at most N per minute") has a notorious flaw: events bunched at the boundary between two windows can yield 2N events in one second of real time. Token bucket avoids this by tracking tokens continuously.

### Why a token bucket and not a leaky bucket?

A leaky bucket smooths output to exactly `R` events/second; no burst. Some applications want this (network shaping, audio streaming). Most web APIs prefer burst tolerance because users often do bursty work followed by quiet, and rejecting the entire burst is unfriendly.

---

## Real input streams

Up to now our examples consume from a `chan T` that we own. Real input streams come from:

- `bufio.Reader.ReadRune` / `ReadString` on stdin
- `*http.Request.Body`
- `*os.File` or `inotify`/`fsnotify`
- `*sql.Rows`
- Network sockets (TCP, UDP, WebSocket)
- `os/signal.Notify`

The pattern for hooking these into a debouncer or throttler is always the same: spawn a goroutine that reads from the source and pushes onto a channel, then debounce/throttle the channel.

### Example: keystrokes from stdin into a debounce

```go
package main

import (
    "bufio"
    "context"
    "fmt"
    "os"
    "time"
)

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    keys := readKeystrokes(ctx)
    deb := debounce(ctx, keys, 200*time.Millisecond)
    for batch := range deb {
        fmt.Println("burst ended:", batch)
    }
}

func readKeystrokes(ctx context.Context) <-chan string {
    out := make(chan string, 16)
    go func() {
        defer close(out)
        r := bufio.NewReader(os.Stdin)
        var buf []rune
        for {
            c, _, err := r.ReadRune()
            if err != nil {
                return
            }
            if c == '\n' {
                buf = buf[:0]
                continue
            }
            buf = append(buf, c)
            select {
            case out <- string(buf):
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func debounce(ctx context.Context, in <-chan string, wait time.Duration) <-chan string {
    out := make(chan string, 1)
    go func() {
        defer close(out)
        var pending string
        var has bool
        var timer *time.Timer
        var tc <-chan time.Time
        for {
            select {
            case v, ok := <-in:
                if !ok {
                    if has {
                        select {
                        case out <- pending:
                        case <-ctx.Done():
                        }
                    }
                    return
                }
                pending = v
                has = true
                if timer == nil {
                    timer = time.NewTimer(wait)
                } else {
                    if !timer.Stop() {
                        select { case <-timer.C: default: }
                    }
                    timer.Reset(wait)
                }
                tc = timer.C
            case <-tc:
                if has {
                    select {
                    case out <- pending:
                    case <-ctx.Done():
                        return
                    }
                    has = false
                }
                tc = nil
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

Run with `go run` and start typing. After 200ms of quiet you will see "burst ended: <your last input>". Press Enter to clear.

This is a complete end-to-end debounce on a real input source. Note the structure:

1. `readKeystrokes` produces events from a real source onto a channel.
2. `debounce` consumes from that channel, applies the debouncer logic, produces to another channel.
3. `main` consumes from the debounced channel.

Three goroutines, three channels, one debouncer. Composable.

### Example: HTTP request body into a throttle

Suppose you have an endpoint that receives a stream of JSON objects (newline-delimited) and you want to throttle their processing.

```go
func handleStream(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    l := rate.NewLimiter(10, 5) // 10/sec, burst 5
    dec := json.NewDecoder(r.Body)
    for dec.More() {
        var ev Event
        if err := dec.Decode(&ev); err != nil {
            http.Error(w, err.Error(), 400)
            return
        }
        if err := l.Wait(ctx); err != nil {
            http.Error(w, err.Error(), 408)
            return
        }
        process(ev)
    }
}
```

Here the throttle blocks the read loop. If the client streams too fast, the goroutine processing the stream slows down — and as the kernel TCP buffer fills, the client itself blocks on `Write`. That is *natural backpressure*: the throttle on our side causes the client's TCP send to stall.

This pattern is gold. No queue, no drop, just backpressure propagating through the OS network stack.

### Example: file-watcher events into a debounce

```go
import "github.com/fsnotify/fsnotify"

w, _ := fsnotify.NewWatcher()
defer w.Close()
w.Add("/etc/myapp/config.yaml")

deb := NewDebouncer(100*time.Millisecond, reload)
for {
    select {
    case <-w.Events:
        deb.Trigger()
    case err := <-w.Errors:
        log.Println(err)
    case <-ctx.Done():
        return
    }
}
```

Filesystem events are notoriously bursty on a single logical save (open + write + close on Linux can be 3 events; on macOS even more). A 100ms debounce coalesces them into one reload.

---

## Composition patterns

Real pipelines layer debounce, throttle, batching, retry, and fan-out. A few canonical compositions.

### Pattern 1: Debounce → Throttle

Collapse bursts to one event, then enforce a rate.

```
keystrokes → Debounce 300ms → Throttle 500ms → search()
```

The debounce produces at most one event per burst. The throttle enforces "at most one search every 500ms" in case the user does many quick separated bursts.

### Pattern 2: Throttle → Batch

Pace input rate, then batch the survivors for bulk processing.

```
events → Throttle 100ms → Batch(size=10, timeout=1s) → bulkInsert()
```

The throttle caps input. The batcher groups up to 10 events together (or flushes after 1s) for efficient downstream calls.

### Pattern 3: Debounce → Retry → Throttle

Coalesce, attempt, throttle retries.

```
saves → Debounce 1s → retryWithBackoff → ThrottleRetry 5/min → persist()
```

### Pattern 4: Fan-out with per-actor throttle

Route events to per-key sub-pipelines, each with its own throttle.

```
events → routerByKey → [throttle per key] → workers
```

This is the per-actor pattern we will detail below.

### A reusable composition helper

```go
package pipeline

import "context"

func Pipe[A, B, C any](
    ctx context.Context,
    in <-chan A,
    stage1 func(context.Context, <-chan A) <-chan B,
    stage2 func(context.Context, <-chan B) <-chan C,
) <-chan C {
    return stage2(ctx, stage1(ctx, in))
}
```

Useful but rarely needed; explicit composition is usually clearer.

---

## Channels, select, and ordering guarantees

A subtle thing about channel pipelines: the `select` statement in Go does *not* guarantee any particular order when multiple branches are ready. The runtime picks pseudo-randomly. This has real consequences for debounce/throttle.

### Example: simultaneous timer fire and event arrival

In our `debounce` function, the `select` has three branches. If both `<-in` and `<-tc` are ready at the same instant, which fires? Random. Sometimes the timer wins, sometimes the event wins.

This is not a bug — both orderings are valid. But it means tests cannot rely on micro-timing. If you write `time.Sleep(exactly the window)` and then check state, you may see "fired" or "not fired" depending on which branch the select picked. Always test with windows long enough to make the answer deterministic.

### Ordering on the input

If two events arrive on `in` close together, they are delivered in order (Go channels are FIFO). The debouncer's internal logic treats them in arrival order. So "the last event in a burst" is well-defined, and the trailing debounce delivers it.

### Ordering on the output

For a single-producer single-consumer chain, output order matches input order. For a fan-in (multiple debouncers writing to one channel), the merge has no inherent ordering. You may need explicit timestamps if downstream cares.

### `select` with default

A `select` with a `default` clause never blocks. We use this for the Stop-then-drain dance:

```go
select { case <-timer.C: default: }
```

It says: "If `timer.C` has a value waiting, consume it; otherwise do nothing." That is exactly what draining means.

### `select` with `time.After`

A common pattern in tests:

```go
select {
case v := <-out:
    // use v
case <-time.After(100 * time.Millisecond):
    t.Fatal("timeout")
}
```

Each call to `time.After` allocates a new timer. In hot loops this is wasteful. Prefer `time.NewTimer` + `Reset` for repeated waits, or use a fake clock in tests.

---

## Per-actor throttling

A single global throttle is rarely what production wants. Real systems throttle per IP, per user, per API key. The implementation is a map of limiters.

### Naive version

```go
type Multi struct {
    mu sync.Mutex
    m  map[string]*rate.Limiter
    r  rate.Limit
    b  int
}

func NewMulti(r rate.Limit, b int) *Multi {
    return &Multi{m: make(map[string]*rate.Limiter), r: r, b: b}
}

func (m *Multi) Allow(key string) bool {
    m.mu.Lock()
    l, ok := m.m[key]
    if !ok {
        l = rate.NewLimiter(m.r, m.b)
        m.m[key] = l
    }
    m.mu.Unlock()
    return l.Allow()
}
```

This works for "small fixed set of keys". For "millions of unique keys over time" it leaks memory. Every unique key adds a `*Limiter` to the map and never removes it.

### Version with eviction

```go
type entry struct {
    limiter *rate.Limiter
    seen    time.Time
}

type Multi struct {
    mu       sync.Mutex
    m        map[string]*entry
    r        rate.Limit
    b        int
    ttl      time.Duration
    lastSweep time.Time
}

func (m *Multi) Allow(key string) bool {
    m.mu.Lock()
    now := time.Now()
    if now.Sub(m.lastSweep) > m.ttl {
        for k, e := range m.m {
            if now.Sub(e.seen) > m.ttl {
                delete(m.m, k)
            }
        }
        m.lastSweep = now
    }
    e, ok := m.m[key]
    if !ok {
        e = &entry{limiter: rate.NewLimiter(m.r, m.b)}
        m.m[key] = e
    }
    e.seen = now
    m.mu.Unlock()
    return e.limiter.Allow()
}
```

This sweeps the map periodically and evicts entries unused for more than `ttl`. The sweep cost is amortised; if `ttl = 5min` and there are 10k entries, the sweep runs every 5min and costs about 1ms.

### Version with LRU

For tighter bounds, use an LRU. The `container/list` package gives you a doubly-linked list:

```go
import "container/list"

type lruEntry struct {
    key string
    limiter *rate.Limiter
}

type MultiLRU struct {
    mu sync.Mutex
    m  map[string]*list.Element
    l  *list.List
    cap int
    r  rate.Limit
    b  int
}

func NewLRU(cap int, r rate.Limit, b int) *MultiLRU {
    return &MultiLRU{
        m:   make(map[string]*list.Element),
        l:   list.New(),
        cap: cap,
        r:   r,
        b:   b,
    }
}

func (m *MultiLRU) Allow(key string) bool {
    m.mu.Lock()
    var lim *rate.Limiter
    if el, ok := m.m[key]; ok {
        m.l.MoveToFront(el)
        lim = el.Value.(*lruEntry).limiter
    } else {
        if m.l.Len() >= m.cap {
            back := m.l.Back()
            if back != nil {
                m.l.Remove(back)
                delete(m.m, back.Value.(*lruEntry).key)
            }
        }
        lim = rate.NewLimiter(m.r, m.b)
        m.m[key] = m.l.PushFront(&lruEntry{key: key, limiter: lim})
    }
    m.mu.Unlock()
    return lim.Allow()
}
```

This caps the map at `cap` entries. The least-recently-used entry is evicted when a new one is needed.

### Sharded map for less contention

A single mutex over the map is a contention point under load. Shard the map:

```go
type Sharded struct {
    shards [16]*Multi
}

func NewSharded(r rate.Limit, b int, ttl time.Duration) *Sharded {
    s := &Sharded{}
    for i := range s.shards {
        s.shards[i] = NewMulti(r, b, ttl)
    }
    return s
}

func (s *Sharded) Allow(key string) bool {
    h := fnv32(key)
    return s.shards[h&15].Allow(key)
}

func fnv32(s string) uint32 {
    h := uint32(2166136261)
    for i := 0; i < len(s); i++ {
        h ^= uint32(s[i])
        h *= 16777619
    }
    return h
}
```

16 shards spread the lock pressure 16x. Adjust the count to your concurrency level.

---

## Coalescing payloads

The basic debouncer keeps "the latest event". Real applications often want richer coalescing — merge timestamps, union sets, sum metrics, append IDs.

### Generic coalescer

```go
package debounce

import (
    "sync"
    "time"
)

type Coalescer[T any] struct {
    mu      sync.Mutex
    wait    time.Duration
    combine func(prev, next T) T
    fn      func(T)
    state   T
    has     bool
    timer   *time.Timer
}

func NewCoalescer[T any](wait time.Duration, combine func(T, T) T, fn func(T)) *Coalescer[T] {
    return &Coalescer[T]{wait: wait, combine: combine, fn: fn}
}

func (c *Coalescer[T]) Add(v T) {
    c.mu.Lock()
    if c.has {
        c.state = c.combine(c.state, v)
    } else {
        c.state = v
        c.has = true
    }
    if c.timer != nil {
        c.timer.Stop()
    }
    c.timer = time.AfterFunc(c.wait, c.fire)
    c.mu.Unlock()
}

func (c *Coalescer[T]) fire() {
    c.mu.Lock()
    v := c.state
    had := c.has
    c.has = false
    var zero T
    c.state = zero
    c.mu.Unlock()
    if had {
        c.fn(v)
    }
}
```

Examples of `combine`:

- `func(a, b string) string { return b }` — last wins (default debounce)
- `func(a, b int) int { return a + b }` — sum (counts)
- `func(a, b []int) []int { return append(a, b...) }` — append (batches)
- `func(a, b time.Time) time.Time { if b.After(a) { return b }; return a }` — latest timestamp
- `func(a, b Set) Set { for k := range b { a[k] = struct{}{} }; return a }` — union

The coalescer with the right `combine` covers debounce, batching, max, sum, and many other patterns with one struct.

### Coalesce + batch + window

For very high-throughput pipelines you often want "batch up to N events or wait at most T, then fire". This is a small extension:

```go
type Batcher[T any] struct {
    mu     sync.Mutex
    maxN   int
    maxT   time.Duration
    fn     func([]T)
    batch  []T
    timer  *time.Timer
}

func NewBatcher[T any](maxN int, maxT time.Duration, fn func([]T)) *Batcher[T] {
    return &Batcher[T]{maxN: maxN, maxT: maxT, fn: fn}
}

func (b *Batcher[T]) Add(v T) {
    b.mu.Lock()
    b.batch = append(b.batch, v)
    if len(b.batch) >= b.maxN {
        out := b.batch
        b.batch = nil
        if b.timer != nil {
            b.timer.Stop()
            b.timer = nil
        }
        b.mu.Unlock()
        b.fn(out)
        return
    }
    if b.timer == nil {
        b.timer = time.AfterFunc(b.maxT, b.flush)
    }
    b.mu.Unlock()
}

func (b *Batcher[T]) flush() {
    b.mu.Lock()
    out := b.batch
    b.batch = nil
    b.timer = nil
    b.mu.Unlock()
    if len(out) > 0 {
        b.fn(out)
    }
}
```

This is the workhorse of every batch-insert, batch-publish, batch-write system. The combination of "fire at N items" and "fire after T quiet" gives both throughput and latency bounds.

---

## Testing with fake clocks

Time-based code tested with real time is slow and flaky. Replace `time.Now`, `time.NewTimer`, `time.NewTicker`, and `time.AfterFunc` with an injected `Clock` interface, and your tests run in microseconds.

### Define the clock

```go
package clock

import "time"

type Clock interface {
    Now() time.Time
    NewTimer(d time.Duration) Timer
    NewTicker(d time.Duration) Ticker
    AfterFunc(d time.Duration, f func()) Timer
}

type Timer interface {
    Stop() bool
    Reset(d time.Duration) bool
    Chan() <-chan time.Time
}

type Ticker interface {
    Stop()
    Chan() <-chan time.Time
}
```

### Real clock

```go
type Real struct{}

func (Real) Now() time.Time { return time.Now() }
func (Real) NewTimer(d time.Duration) Timer {
    return realTimer{time.NewTimer(d)}
}
// ...
```

### Fake clock

```go
type Fake struct {
    mu sync.Mutex
    now time.Time
    timers []*fakeTimer
}

func NewFake() *Fake {
    return &Fake{now: time.Unix(0, 0)}
}

func (f *Fake) Advance(d time.Duration) {
    f.mu.Lock()
    f.now = f.now.Add(d)
    var fire []*fakeTimer
    rest := f.timers[:0]
    for _, t := range f.timers {
        if !t.fireAt.After(f.now) {
            fire = append(fire, t)
        } else {
            rest = append(rest, t)
        }
    }
    f.timers = rest
    f.mu.Unlock()
    for _, t := range fire {
        t.fire()
    }
}
```

With a fake clock, tests look like:

```go
func TestDebouncer(t *testing.T) {
    fc := clock.NewFake()
    d := NewDebouncerClock(fc, 1*time.Second, fn)
    d.Trigger()
    d.Trigger()
    d.Trigger()
    fc.Advance(500 * time.Millisecond)
    // assert not fired yet
    fc.Advance(600 * time.Millisecond)
    // assert fired once
}
```

No wall-clock sleeps; tests run in microseconds.

### Using `github.com/benbjohnson/clock`

The most popular fake-clock library is Ben Johnson's:

```sh
go get github.com/benbjohnson/clock
```

```go
import "github.com/benbjohnson/clock"

func TestDebounce(t *testing.T) {
    c := clock.NewMock()
    d := NewWithClock(c, 1*time.Second, fn)
    d.Trigger()
    c.Add(500 * time.Millisecond)
    // not fired
    c.Add(600 * time.Millisecond)
    // fired
}
```

The library handles timers, tickers, and after-funcs. Use it in tests; never in production.

---

## Error handling and recovery

Real systems must survive errors. A debouncer or throttler should:

- Recover from panics in callbacks
- Surface errors to observability
- Avoid blocking the caller because of a downstream failure
- Cancel pending work cleanly on shutdown

### Panic recovery

```go
func safeCall(fn func()) {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("debounce callback panic: %v\n%s", r, debug.Stack())
            metrics.PanicsTotal.Inc()
        }
    }()
    fn()
}

func (d *Debouncer) fire() {
    d.mu.Lock()
    fn := d.fn
    d.mu.Unlock()
    safeCall(fn)
}
```

Any production debouncer or throttler should wrap callback invocations in `recover`.

### Errors as values

If the callback returns an error, capture it:

```go
type WithErr struct {
    fn      func() error
    onError func(error)
}

func (d *WithErr) fire() {
    if err := d.fn(); err != nil {
        d.onError(err)
    }
}
```

The `onError` hook lets the application decide whether to retry, log, alert, or escalate.

### Errors in throttling

When `rate.Limiter.Wait` returns an error it is always `ctx.Err()`. Surface it to the caller; do not swallow.

```go
if err := l.Wait(ctx); err != nil {
    return fmt.Errorf("rate limit wait: %w", err)
}
```

Wrapping with `%w` preserves the error type so callers can do `errors.Is(err, context.DeadlineExceeded)`.

---

## Observability hooks

You cannot debug a debouncer or throttler in production without metrics. The minimum set:

- Number of events received
- Number of events fired (after debouncing) or allowed (after throttling)
- Number of events dropped (throttle reject)
- Time spent waiting in `Wait` (latency histogram)
- Current bucket level (for token bucket)
- Per-key entries in multi-key limiter

### Instrumenting a debouncer

```go
type InstrumentedDebouncer struct {
    Debouncer
    eventsTotal prometheus.Counter
    firesTotal  prometheus.Counter
}

func (d *InstrumentedDebouncer) Trigger() {
    d.eventsTotal.Inc()
    d.Debouncer.Trigger()
}

func (d *InstrumentedDebouncer) fire() {
    d.firesTotal.Inc()
    d.Debouncer.fire()
}
```

Now you can graph "events per second" vs "fires per second" and see the coalescing ratio.

### Instrumenting a throttle

```go
func (t *Throttle) Allow() bool {
    if t.limiter.Allow() {
        t.allowed.Inc()
        return true
    }
    t.rejected.Inc()
    return false
}
```

Histograms for `Wait` latency are also valuable; they tell you when the queue is filling up.

### Logging

Periodic logs (once per minute) summarising rates are more useful than per-event logs. A `rate.Limiter` of its own can throttle the log lines.

---

## Common middle-level mistakes

1. **Calling `fn` while holding the mutex.** Causes deadlock if `fn` re-enters `Trigger`.
2. **Forgetting to set the timer to `nil` after fire.** Causes the next `Trigger` to `Stop` a nil pointer (panic) or a fired timer (stale fire).
3. **Using `time.Tick`.** Use `time.NewTicker` always.
4. **Sharing a `*Limiter` across servers without coordination.** The throttle is local to one process; horizontally scaled deployments need a distributed limiter (`senior.md`).
5. **Allocating a new ticker per request.** Reuse.
6. **Not handling `ctx.Done()` in `Wait`.** Causes goroutines to hang on shutdown.
7. **Forgetting to evict from per-actor maps.** Memory leak under high cardinality.
8. **Using `Allow` when you should use `Wait`.** Loses events silently.
9. **Setting burst too low.** Sometimes a tiny burst breaks legitimate user behaviour.
10. **Setting burst too high.** Defeats the rate limit's purpose for the first N events.

---

## A long worked example: editor autosave

Let us put everything together in a realistic feature. The editor:

1. Saves the document one second after the user stops typing.
2. If the user types continuously for 30 seconds, save anyway.
3. The save is allowed at most 6 times per minute (server-side quota).
4. Manual `Ctrl-S` flushes immediately, bypassing the debounce.
5. Closing the editor flushes any pending save.

Code:

```go
package editor

import (
    "context"
    "sync"
    "time"

    "golang.org/x/time/rate"
)

type Autosave struct {
    mu          sync.Mutex
    wait        time.Duration
    maxWait     time.Duration
    save        func(ctx context.Context, content string) error
    onError     func(error)
    limiter     *rate.Limiter
    timer       *time.Timer
    pending     bool
    pendingContent string
    burstStart  time.Time
    ctx         context.Context
    cancel      context.CancelFunc
}

func New(ctx context.Context, save func(ctx context.Context, content string) error, onError func(error)) *Autosave {
    cctx, cancel := context.WithCancel(ctx)
    return &Autosave{
        wait:    1 * time.Second,
        maxWait: 30 * time.Second,
        save:    save,
        onError: onError,
        limiter: rate.NewLimiter(rate.Every(10*time.Second), 6),
        ctx:     cctx,
        cancel:  cancel,
    }
}

func (a *Autosave) OnEdit(content string) {
    a.mu.Lock()
    defer a.mu.Unlock()
    a.pendingContent = content
    a.pending = true
    now := time.Now()
    if a.burstStart.IsZero() {
        a.burstStart = now
    }
    remaining := a.maxWait - now.Sub(a.burstStart)
    if remaining < 0 {
        remaining = 0
    }
    use := a.wait
    if remaining < use {
        use = remaining
    }
    if a.timer != nil {
        a.timer.Stop()
    }
    a.timer = time.AfterFunc(use, a.fire)
}

func (a *Autosave) Flush() {
    a.mu.Lock()
    if !a.pending {
        a.mu.Unlock()
        return
    }
    a.pending = false
    content := a.pendingContent
    a.burstStart = time.Time{}
    if a.timer != nil {
        a.timer.Stop()
        a.timer = nil
    }
    a.mu.Unlock()
    a.doSave(content)
}

func (a *Autosave) fire() {
    a.mu.Lock()
    if !a.pending {
        a.mu.Unlock()
        return
    }
    a.pending = false
    content := a.pendingContent
    a.burstStart = time.Time{}
    a.mu.Unlock()
    a.doSave(content)
}

func (a *Autosave) doSave(content string) {
    if err := a.limiter.Wait(a.ctx); err != nil {
        a.onError(err)
        return
    }
    if err := a.save(a.ctx, content); err != nil {
        a.onError(err)
    }
}

func (a *Autosave) Close() {
    a.Flush()
    a.cancel()
}
```

Read it carefully. The pieces:

- `OnEdit` is the debounce trigger with a `maxWait` cap.
- `Flush` is the manual save (Ctrl-S).
- `fire` is the timer callback.
- `doSave` does the actual save, gated by the rate limiter.
- `Close` flushes pending and cancels the context.

This is roughly 80 lines of code that handles a feature spec that would take three paragraphs to describe in English. The compactness is a sign that we are using the right primitives.

### Tests

```go
func TestAutosave_DebouncesEdits(t *testing.T) {
    saved := make(chan string, 4)
    a := New(context.Background(), func(_ context.Context, c string) error {
        saved <- c
        return nil
    }, func(error) {})
    a.wait = 50 * time.Millisecond
    a.maxWait = 500 * time.Millisecond
    a.OnEdit("a")
    a.OnEdit("ab")
    a.OnEdit("abc")
    time.Sleep(100 * time.Millisecond)
    select {
    case v := <-saved:
        if v != "abc" {
            t.Fatalf("expected abc, got %q", v)
        }
    case <-time.After(time.Second):
        t.Fatal("no save")
    }
}

func TestAutosave_MaxWaitForces(t *testing.T) {
    saved := make(chan string, 4)
    a := New(context.Background(), func(_ context.Context, c string) error {
        saved <- c
        return nil
    }, func(error) {})
    a.wait = 200 * time.Millisecond
    a.maxWait = 500 * time.Millisecond
    for i := 0; i < 20; i++ {
        a.OnEdit("x")
        time.Sleep(50 * time.Millisecond)
    }
    // 20 edits, 50ms apart = 1000ms total. With maxWait=500ms we should see at least one save.
    select {
    case <-saved:
    case <-time.After(time.Second):
        t.Fatal("maxWait did not fire")
    }
}
```

The first test verifies trailing-debounce semantics. The second verifies the maxWait cap. Both run with real timers because the durations are small.

---

## A long worked example: HTTP client with retry

A second realistic feature: an HTTP client that retries on 429 with backoff, respects `Retry-After`, and throttles outgoing requests to stay within quota.

```go
package httpclient

import (
    "context"
    "errors"
    "io"
    "math/rand"
    "net/http"
    "strconv"
    "time"

    "golang.org/x/time/rate"
)

type Client struct {
    http    *http.Client
    limiter *rate.Limiter
    maxRetries int
}

func New(rps int, burst int) *Client {
    return &Client{
        http:       &http.Client{Timeout: 30 * time.Second},
        limiter:    rate.NewLimiter(rate.Limit(rps), burst),
        maxRetries: 5,
    }
}

func (c *Client) Do(ctx context.Context, req *http.Request) (*http.Response, error) {
    var lastErr error
    for attempt := 0; attempt <= c.maxRetries; attempt++ {
        if err := c.limiter.Wait(ctx); err != nil {
            return nil, err
        }
        resp, err := c.http.Do(req.Clone(ctx))
        if err == nil && resp.StatusCode != 429 && resp.StatusCode < 500 {
            return resp, nil
        }
        if err != nil {
            lastErr = err
        } else {
            lastErr = errors.New(resp.Status)
            resp.Body.Close()
        }
        wait := backoff(attempt, resp)
        select {
        case <-time.After(wait):
        case <-ctx.Done():
            return nil, ctx.Err()
        }
    }
    return nil, lastErr
}

func backoff(attempt int, resp *http.Response) time.Duration {
    if resp != nil {
        if ra := resp.Header.Get("Retry-After"); ra != "" {
            if secs, err := strconv.Atoi(ra); err == nil {
                return time.Duration(secs) * time.Second
            }
        }
    }
    base := time.Duration(100*(1<<attempt)) * time.Millisecond
    if base > 30*time.Second {
        base = 30 * time.Second
    }
    jitter := time.Duration(rand.Int63n(int64(base / 2)))
    return base + jitter
}

func drainBody(r io.ReadCloser) {
    io.Copy(io.Discard, r)
    r.Close()
}
```

The pieces:

- `c.limiter.Wait(ctx)` paces requests to stay within `rps`.
- On 429 or 5xx, retry with backoff.
- `Retry-After` header is honoured if present.
- Exponential backoff with jitter on each attempt.
- Context cancellation aborts the retry loop.

This is a small but realistic HTTP client. It demonstrates the *combination* of a throttle (input pacing) and a retry pattern (transient failure handling) with debounce-like coalescing not needed at this layer.

---

## Pitfalls and tricky points

### Pitfall: `Wait` ignores burst capacity

`rate.Limiter.Wait` will block for arbitrarily long if the bucket is empty and the queue is long. There is no built-in "wait at most X". For that, use `Reserve`:

```go
r := l.Reserve()
if !r.OK() || r.Delay() > maxWait {
    r.Cancel()
    return errLimit
}
time.Sleep(r.Delay())
```

### Pitfall: `Allow` consumes a token

A common bug: write a "check if I can do the thing" using `Allow`, but call it twice — once to check, once to fire. The second call always fails because the first consumed the token.

```go
if !l.Allow() { return errLimit }
// later
l.Allow() // wrong, takes another token
doWork()
```

Just call `Allow` once and gate the work on it.

### Pitfall: `Burst` of 0 is rejected always

`rate.NewLimiter(rate.Inf, 0)` allows nothing. You probably mean `rate.NewLimiter(rate.Inf, 1)` for "unlimited rate, allow one at a time".

### Pitfall: `rate.Inf` means literally infinite

`rate.NewLimiter(rate.Inf, B)` allows up to B in any burst, then refills instantly. Useful for "disable rate limiting" without conditional code.

### Pitfall: trailing debounce never fires if events never stop

You set a 100ms debounce. Events arrive every 50ms forever. Nothing fires. Use `maxWait` (combined debounce) or switch to throttle.

### Pitfall: leading debounce double-fires under race

If two `Trigger` calls arrive at the same instant before `inBurst` is set, both may take the leading-fire branch. The mutex prevents this in our example by setting `inBurst` under the lock; verify this in your own implementations.

### Pitfall: per-actor map without eviction

Every unique IP or user ID becomes an entry. The map grows forever. Always evict.

### Pitfall: `time.Now` race-conditioning the limiter

`rate.Limiter` is internally thread-safe but reads `time.Now()` itself. If you cache `now` in your own code for performance, do not pass a stale `now` to the limiter; it expects fresh time.

### Pitfall: `Wait` on a cancelled context returns immediately

If `ctx.Done()` is already closed when `Wait` is called, it returns `ctx.Err()` without taking a token. This is the right behaviour but can surprise callers who assume `Wait` is "fair".

### Pitfall: `Reserve.Cancel` returns the token

If you `Reserve` and then `Cancel`, the token is returned to the bucket. If you `Reserve` and never `Cancel`, the token is "spent" even if you do not actually do the work. Be careful to `Cancel` if you decide not to proceed.

---

## Interview-grade questions

> **Q1**: Walk me through writing a leading + trailing debouncer in Go.

Sketch the struct with `inBurst`, `policy`, `timer`. On `Trigger`: if not in burst and `policy & Leading`, call fn (outside the lock). Set `inBurst`, stop and replace the timer. On the timer firing: under the lock, capture `wasInBurst` and reset `inBurst`. Outside the lock, if `wasInBurst` and `policy & Trailing`, call fn.

> **Q2**: When would you choose `Allow` over `Wait`?

`Allow` for lossy throttles (logs, metrics, UI updates) where dropping is fine. `Wait` for lossless throttles where every event must be processed and callers can block.

> **Q3**: Explain `Reserve`.

`Reserve` returns a `*Reservation`. Call `Delay()` to see when the token is available. If `Delay()` is too long, call `Cancel()` to return the token to the bucket; otherwise wait and use the token. It is the "wait but bound the wait" API.

> **Q4**: Why is a single global mutex on a per-actor map a bad idea?

Under high concurrency every goroutine serialises through the lock. The throttle becomes a bottleneck. Shard the map or use `sync.Map`.

> **Q5**: What is `maxWait` in debounce semantics?

A cap on how long a burst can stretch the debounce timer. If the burst lasts longer than `maxWait`, fire even though events keep arriving. Prevents starvation in continuous-input scenarios.

> **Q6**: How would you test a debouncer without `time.Sleep`?

Inject a `Clock` interface; in tests use a fake clock you can advance manually. Libraries like `github.com/benbjohnson/clock` provide ready-made fakes.

> **Q7**: A throttle returns errors on `Wait`. What are they?

Only `ctx.Err()` — either `context.Canceled` or `context.DeadlineExceeded`. Wrap with `%w` so callers can `errors.Is`.

> **Q8**: How do you change a `Limiter`'s rate at runtime?

`SetLimit` and `SetBurst`. Thread-safe. State (current tokens) is preserved.

> **Q9**: What happens if a debouncer's callback panics?

Without `recover`, the goroutine dies and the panic propagates to the runtime, killing the process. Always wrap callbacks in `defer recover` in production.

> **Q10**: Why is leading debounce sometimes called a "throttle"?

Because functionally it limits the rate: only one fire per cooldown window. The semantic difference is that the cooldown is measured from the *fire time*, not from clock ticks. People often blur the distinction.

> **Q11**: Implement a debouncer that fires immediately if the event payload changes drastically.

Outside the scope of pure debounce; you would compute a "delta" between the new event and the pending one and short-circuit:

```go
if delta(new, pending) > threshold {
    fire(new); pending = zero
}
```

This is a custom heuristic. Production code uses it for "real-time" interactions where coalescing too aggressively is wrong.

> **Q12**: What is the unit of `rate.Limit`?

Events per second, as a float. `rate.Every(d)` converts a duration `d` into the equivalent `rate.Limit`.

> **Q13**: How does `rate.Limiter` handle clock jumps?

It uses `time.Now()` internally, which provides monotonic time on modern Go. Wall-clock jumps do not affect it. Resume-from-sleep can produce one burst (because `now - last` jumped by a large amount), but the steady state recovers.

> **Q14**: What's the difference between `Throttle` returning a `<-chan T` vs a callback `func(T)`?

Channels compose naturally with pipelines and `select`. Callbacks are simpler for one-off use. Library authors prefer channels.

> **Q15**: When would you use a sliding-window throttle instead of a token bucket?

Sliding window gives strict "no more than N in any rolling window" with no leading burst. Useful for hard quotas where the burst tolerance of token bucket is unacceptable. Senior-level topic.

---

## Cheat sheet

```go
// rate.Limiter
l := rate.NewLimiter(rate.Every(100*time.Millisecond), 5) // 10/sec burst 5
if l.Allow() { /* fire */ }
if err := l.Wait(ctx); err != nil { return err }
r := l.Reserve(); if r.Delay() > maxWait { r.Cancel() }; time.Sleep(r.Delay())

// Leading+trailing debouncer (policy bitfield)
d := New(200*time.Millisecond, Leading|Trailing, fn)
d.Trigger()
d.Cancel()

// Per-actor with eviction
multi := NewMulti(rate.Every(time.Second), 1, 5*time.Minute)
multi.Allow(ip)

// Coalescer (debounce with custom combine)
c := NewCoalescer(100*time.Millisecond, func(a, b int) int { return a + b }, fn)
c.Add(1); c.Add(2); c.Add(3) // fires with 6

// Test with fake clock
fc := clock.NewMock()
d := NewWithClock(fc, time.Second, fn)
d.Trigger(); fc.Add(2*time.Second) // assert fired
```

---

## Summary

Middle-level debounce and throttle is about variants and integration. You now know:

- Leading, trailing, and combined-edge debouncers
- `Cancel` and `Flush` semantics and their race characteristics
- The `rate.Limiter` API and when to choose `Allow`, `Wait`, or `Reserve`
- Token-bucket math at the algorithmic level
- How to hook up real input sources (stdin, HTTP, filesystem) to a debouncer
- Composition patterns (Debounce → Throttle, Throttle → Batch)
- Per-actor maps with eviction and sharding
- Generic coalescers and batchers
- Testing with injected clocks
- Panic recovery, error handling, and observability
- The set of pitfalls that turn a "working" debouncer into a leaking, racing, drift-prone production headache

The next file, `senior.md`, dives into the math of token vs leaky buckets, sliding windows, distributed limiters with Redis, and the hidden cost of `time.Now` calls in hot loops.

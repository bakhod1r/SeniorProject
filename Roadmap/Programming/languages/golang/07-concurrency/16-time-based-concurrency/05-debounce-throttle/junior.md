---
layout: default
title: Junior
parent: Debounce and Throttle
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/05-debounce-throttle/junior/
---

# Debounce and Throttle — Junior Level

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
12. [Product Use and Feature](#product-use-and-feature)
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
> Focus: "What is debounce? What is throttle? Why do I need either? How do I write the simplest version of each in Go?"

When events arrive in bursts, naive code processes every event the moment it arrives. Most of the time that is fine. Occasionally it is a disaster.

Suppose you wire a search box on a web page to a function that calls your server. The user types `g`, `go`, `gol`, `gola`, `golan`, `golang`. Without any safeguard your code fires six HTTP requests in under a second. Five of them are wasted because the user only really cares about the answer to the last query. The server now spends CPU cycles answering questions nobody is going to look at.

A **debouncer** fixes this. It says, "Wait until the user has stopped typing for, say, 300 milliseconds. Then send one request." The first five events are absorbed silently and the sixth, after the user pauses, finally fires.

Now suppose you write a logger that prints a line every time a database error occurs. The database goes down. Your code now generates ten thousand error log lines per second. Disk fills, the log shipper falls behind, the on-call engineer cannot read the screen because new errors push the useful ones off the top.

A **throttler** fixes this. It says, "No matter how many events you give me, I will only let one through every second." The first event fires immediately; the next 999 in that second are dropped or queued; the second after that, exactly one more fires.

Debounce waits for quiet. Throttle enforces a maximum rate. They sound similar and beginners regularly confuse them, but they are different patterns and you need both in your toolbox.

After reading this file you will:

- Be able to state the difference between debounce and throttle in one sentence
- Write a working debouncer using `time.AfterFunc`
- Write a working throttler using `time.Ticker`
- Know when each is the right tool
- Recognise the first four bugs every Go programmer hits when implementing them
- Understand why both patterns are about *time-based concurrency*, not just about plain rate limiting

We will not yet tackle leading-edge debounce, token buckets, sliding windows, distributed throttling, or any production concerns. Those live in `middle.md`, `senior.md`, and `professional.md`. The goal here is to build a rock-solid mental model and one working example of each pattern.

---

## Prerequisites

You need to know:

- Channels: how to make one, send to one, receive from one, close one
- Goroutines: how to start one with `go`, what `sync.WaitGroup` is for
- `select` statements: how a `select` picks one of several ready channels
- `time.Sleep`, `time.Duration`, `time.Now`
- `time.After`, `time.Ticker`, `time.AfterFunc`: the basics from `01-ticker`, `02-afterfunc`, and `03-timer-leaks`
- Basic concurrency safety with `sync.Mutex`

If any of those is fuzzy, read the earlier pages in the Concurrency track first. Debounce and throttle are *applications* of those primitives; you cannot understand the applications without the primitives.

You do not need to know:

- The `golang.org/x/time/rate` package yet — `middle.md` introduces it
- Leaky-bucket math — `senior.md` covers it
- Distributed rate limiting — `senior.md` and `professional.md` cover it
- The Go scheduler internals — irrelevant here

---

## Glossary

**Event**: any discrete signal you want to handle — a keystroke, an HTTP request, a database write, a metric update, a button click, a log line. The "thing" arriving at the rate-limiter.

**Burst**: a cluster of events arriving close together in time, separated by gaps of relative quiet. Bursts are the entire reason debounce and throttle exist; if events were perfectly evenly spaced you would not need either tool.

**Quiet period**: a stretch of time with no events. A debouncer uses the quiet period to decide it is finally safe to fire.

**Debounce**: collapse a burst of events into a single trigger that fires only after the events stop. The trigger normally carries the *last* event's payload. Synonym: "tail collapse".

**Trailing debounce**: the default flavour described above — fire at the end of the burst.

**Leading debounce**: fire at the *start* of the burst; ignore all events until a quiet period passes. Less common but useful for "first click wins" UI buttons.

**Leading + trailing debounce**: fire on both the first and the last event of a burst. Useful when you want immediate feedback *and* a final reconcile.

**Throttle**: enforce a maximum frequency. Let an event through every N units of time and drop, queue, or block the rest.

**Rate limit**: a synonym for throttle in the wider engineering vocabulary. In Go the standard library uses the word "rate".

**Token bucket**: a throttle algorithm based on a bucket that holds up to `B` tokens and refills at `R` tokens per second. Each event removes a token; if the bucket is empty the event is dropped or waits.

**Leaky bucket**: a throttle algorithm shaped like a bucket with a hole. Events pour in at any rate; output drips out at a fixed rate. Compared to a token bucket it cannot burst.

**Sliding window**: a throttle that counts events in the last N seconds (or the last M milliseconds, etc.) and rejects new events once the count crosses a threshold.

**`time.Timer`**: a Go primitive that fires once after a duration. Can be reset.

**`time.Ticker`**: a Go primitive that fires repeatedly on an interval.

**`time.AfterFunc(d, f)`**: convenience function that runs `f` in its own goroutine after `d` has elapsed. Returns a `*time.Timer` you can `Reset` or `Stop`.

**Coalesce**: combine multiple events into one — the action a debouncer performs.

**Backpressure**: any mechanism that makes a producer slow down because the consumer cannot keep up. Throttling is a form of backpressure when it blocks; it is a form of dropping when it does not.

**Goroutine leak**: a goroutine that never exits, usually because it is blocked on a channel that will never receive again. Debouncers and throttlers are surprisingly easy to leak; we will spend time on this.

**Idempotent**: an operation that has the same effect whether you run it once or a hundred times. Debouncing only makes sense for idempotent or "last-write-wins" operations, because earlier events are discarded.

---

## Core Concepts

### 1. The fundamental distinction

The shortest definition you will ever need:

> **Debounce** waits for *silence*. **Throttle** waits for the *clock*.

Read that twice. If you remember nothing else from this file, remember that.

Concretely, a debouncer is shaped like this:

```
event arrives → reset a countdown to T milliseconds
when countdown reaches zero → fire
```

A throttler is shaped like this:

```
event arrives → if the clock has ticked since last fire, fire; else drop/queue
clock ticks every T milliseconds
```

Notice that the debouncer's timer is **reset every event** and the throttler's timer is **never reset**. That single difference is the entire conceptual gap.

### 2. Why timers are not enough

A naive first attempt at "rate limiting" is to call `time.Sleep` between actions. It works in toy code:

```go
for _, ev := range events {
    process(ev)
    time.Sleep(100 * time.Millisecond)
}
```

This is not throttling; it is *pacing*. The pacing version assumes events arrive on demand and you control the loop. Real systems have producers and consumers running on different goroutines. The producer does not want to block; it wants to fire events as fast as they come in. The consumer wants to enforce a rate. The bridge between them is a channel plus a `select` and a timer.

### 3. Why goroutines are mandatory

You cannot debounce or throttle "in place" inside a single function. The whole point of these patterns is that *time passes* between events. Something must hold state across calls — the time of the last event, the countdown to the next fire, the bucket of tokens. That state lives in a goroutine (with channels) or in a struct (with a mutex). Either way, time is a first-class participant in the design.

### 4. Why channels and `select` matter

A debouncer or throttler running in isolation is useless. It only earns its keep when wired into a pipeline that emits events and consumes results. The standard Go idiom for that wiring is:

- A `chan T` for input
- A `chan T` (or callback) for output
- A `<-chan time.Time` from a timer or ticker
- A `select` that watches all three

The `select` is where the real logic happens. It lets the goroutine wake up on *whichever* of "event arrived", "timer fired", or "context cancelled" happens first. Every debouncer and throttler in this whole subsection is some variation of that pattern.

### 5. Trailing-edge debounce: the default

When people say "debounce" without qualification they almost always mean **trailing-edge**. Events stretch out a timer; when the timer finally expires, the most recent event's payload is delivered.

```
events:   E E E       E   E E E
                      ↑
                  timer fires here, delivering the last E
```

The big advantages of trailing debounce are:

- Only ever one delivered event per burst, ever
- The delivered event carries the latest data (good for "save the document" or "send the search query")
- Cheap to implement with `AfterFunc`

The big disadvantage is **latency**. The user has to *stop* before the action happens. If your debounce window is 500ms, every action is delayed by 500ms. For a search-as-you-type box that is fine. For "user clicked Save" it is awful — by then they expect immediate feedback.

### 6. Leading-edge debounce

Sometimes you want the *first* event to fire and the rest to be ignored. The classic case is a button that submits a form. You want one submission, not five if the user clicks furiously. You want the first click to go through, and you want the rest to be silently swallowed until things settle down.

```
events:   E E E       E   E E E
          ↑           ↑
       fires here  fires here (after quiet gap)
```

We will not write the full leading version here — that is `middle.md` territory — but you should know it exists. Junior code often gets bug reports like "the button only submits when I stop clicking" because someone reached for trailing debounce when leading was the right tool.

### 7. Throttle: enforce a steady rhythm

A throttle does not care about quiet at all. It cares about the clock. Every T milliseconds, *one* event is allowed through. Extra events are either dropped (lossy throttle) or queued (lossless throttle, with bounded queue) or made to block (backpressure throttle).

```
clock:    T   T   T   T   T   T
events:   E E E E E E E E E E E
fires:    E   E   E   E   E   E
                  (dropped E's not shown above)
```

Throttle is the right tool for:

- API rate limits ("max 10 requests/sec to this third-party API")
- Log throttling ("max 100 identical log lines per minute")
- UI animation ("call the resize handler at most every 16ms = 60 FPS")
- Telemetry ("emit one metric snapshot per second")

### 8. The relationship between debounce, throttle, and timers

Debounce uses a *resettable timer* (`time.AfterFunc` is the easiest API, but `time.Timer.Reset` works too). Throttle uses a *ticker* (`time.Ticker`) or a *non-resettable timer* you re-arm yourself. Both rely on the same underlying runtime mechanism — the `runtime.timer` heap inside `runtime/time.go` — but they expose different shapes.

If you write `time.AfterFunc` to schedule "fire one thing in 300ms", and you `Reset` it every time an event arrives, you have built a debouncer. If you write `time.NewTicker(300 * time.Millisecond)` and you process at most one event per tick, you have built a throttler. The hard part is the bookkeeping around them, not the timer call itself.

---

## Real-World Analogies

### The elevator door (debounce)

An elevator door waits a few seconds before closing. Every time someone steps in or the "open" button is pressed, the countdown restarts. Only when nothing happens for, say, three seconds does the door finally close. That is a trailing-edge debouncer with a 3-second window.

### The bouncer at a club (throttle)

The bouncer at a busy club lets one person in every ten seconds. People may form a line, but the rate at which they enter is fixed. If too many gather, some give up and leave (drop policy); some wait patiently (queue policy); some get angry and shout, putting pressure on the bouncer (backpressure policy). Whatever the queue does, the rate of admission is constant.

### The cassette tape rewind button (leading debounce)

On an old Walkman, pressing rewind once would start rewinding; pressing it ten more times in two seconds did nothing extra. That is a leading-edge debounce: the *first* press wins and the rest are absorbed.

### The fire-and-forget photo flash (throttle by interval)

A camera flash recharges for a couple of seconds after firing. You can press the shutter as fast as you like; the flash will only go off when the capacitor is full. That is a token bucket of size 1 with a slow refill rate.

### The petrol station with one pump (token bucket)

Imagine a station with a bucket holding ten litres of "free flow". Customers pour into the bucket at a rate of one litre per second. Anyone arriving while the bucket has fuel can take exactly what they need; if the bucket is empty they wait. A burst of customers in the first minute can each get a litre, but the eleventh in quick succession has to wait for refill. That is a token bucket with burst 10 and rate 1/sec.

### The sieve dripping water (leaky bucket)

A sieve holds water; water drips out at a constant rate. No matter how fast you pour, the output is fixed. There is no "burst capacity" — even if the sieve is empty when you start pouring, the first drops still drip at the steady output rate. That is a leaky bucket.

### A telephone exchange (sliding window)

Old phone exchanges allowed only N simultaneous calls. The exchange counted calls in the last sixty seconds and refused any over a threshold. That is a sliding window rate limit.

---

## Mental Models

### Mental model 1: the "stretchy ribbon" debounce

Picture a rubber ribbon stretched between you and a button. Every event pulls the ribbon a little tighter, restarting a stopwatch. When the stopwatch reaches zero without being touched, the ribbon snaps back, the button is pressed, and one signal escapes. This captures the *resettable* nature of debounce: each event delays the firing, and only the absence of further events finally permits a fire.

### Mental model 2: the "metronome" throttle

Picture a metronome clicking once per second. The throttle is a small gate that opens for one event whenever the metronome clicks and closes again right after. Events arriving while the gate is shut bounce off or queue up. This captures the *time-driven* nature of throttle: the metronome ticks regardless of whether events arrive, and the throttle's behaviour is entirely a function of "is the gate open right now?".

### Mental model 3: the "savings account" token bucket

The token bucket is a savings account that earns interest at a fixed rate. You start with `B` dollars. The bank adds one dollar per second up to a max balance of `B`. Each event withdraws one dollar. If the balance is zero you cannot spend. This captures *both* the burst and the steady-state rate: you can spend `B` dollars in one go after a long pause, but over the long run you can only spend at the refill rate.

### Mental model 4: the "buffered pipe" leaky bucket

The leaky bucket is a pipe with a small hole. You can pour water in arbitrarily fast; the pipe leaks at a fixed rate. If you pour faster than it leaks, the pipe overflows (events dropped). This captures the *no-burst* nature of the leaky bucket: even from empty, the output is paced.

### Mental model 5: the "rolling 60-second tally" sliding window

The sliding window is a slip of paper on which you write the timestamp of every event in the last minute. Whenever a new event arrives you first scratch out timestamps older than 60 seconds, then count remaining entries. If the count is at the limit, reject. This is the most accurate rate limit but uses the most memory.

### Mental model 6: the "state machine" view

Both debounce and throttle are tiny state machines with two states:

- Debounce: `Idle` ↔ `Pending`. Events move you into `Pending` and re-arm the timer; the timer expiring moves you back to `Idle` and fires the callback.
- Throttle: `Open` ↔ `Closed`. The clock opens the gate; firing closes it.

If you write a debounce or throttle and cannot draw the state machine in two boxes, you have over-engineered.

---

## Pros and Cons

### Debounce

**Pros**

- Collapses bursts to one event — minimal downstream work
- The last event in a burst carries the latest data (good for "save", "search", "auto-update")
- Simple to implement with `time.AfterFunc`
- No queue → constant memory

**Cons**

- Adds latency equal to the debounce window (300ms means a 300ms delay on every burst end)
- Discards all intermediate events — they are gone forever
- If the burst never ends, the debouncer never fires (rare but real for "keepalive" pings)
- Hard to reason about under cancellation: did the last event fire before context expired?

### Throttle

**Pros**

- Deterministic output rate — exactly N events per second, no more
- Backpressure-friendly — can block producers cleanly
- Composes well with downstream rate limits (API quotas, write budgets)
- Token-bucket variant allows controlled bursting

**Cons**

- Drops or queues data unless you do extra work
- A naive ticker implementation leaks goroutines if not stopped
- Wall-clock jitter can let multiple events through in one window
- More moving parts than debounce (ticker, queue, drop policy)

### Comparison table

| Aspect | Debounce | Throttle |
|--------|----------|----------|
| Triggered by | Silence | Clock |
| State held | Latest event | Tokens / window |
| Latency | Window length | At most one interval |
| Data loss | All but last | All but every Nth |
| Best for | "Just send the final value" | "Don't exceed N/sec" |
| Implementation | `time.AfterFunc` + `Reset` | `time.Ticker` or `rate.Limiter` |

---

## Use Cases

### Debounce

1. **Search-as-you-type**. Fire the search query 300ms after the user stops typing.
2. **Auto-save**. Save the document one second after the last keystroke.
3. **Resize listeners**. Recompute layout once after the window stops resizing.
4. **Config reload**. Reload config 500ms after the last filesystem event in a burst.
5. **Form validation**. Validate one second after the user stops typing.
6. **Mouse hover tooltips**. Show the tooltip 400ms after the cursor lands and stops.
7. **Database write coalescing**. Persist state 200ms after the last in-memory mutation.

### Throttle

1. **API rate limits**. Stay under 10 requests/sec to a third-party API.
2. **Log throttling**. Max 1 line/sec of "DB unavailable" no matter how many failures.
3. **Metrics emission**. One snapshot per second to Prometheus, not one per event.
4. **Scroll handlers**. Run the scroll callback at most every 16ms.
5. **WebSocket broadcasts**. Send at most 30 frames/sec per peer.
6. **Background polling**. Hit the upstream once per minute even if event sources fire faster.
7. **Login attempt rate-limits**. Max 5 attempts/minute per IP.
8. **CDN purge requests**. Coalesce and pace cache invalidations.

### Both together

1. **Search box**. Debounce keystrokes to one request *and* throttle to max 2 requests/sec to protect the backend.
2. **Editor save**. Debounce typing to one save *and* throttle saves to max 10/min to limit S3 writes.
3. **IoT sensor ingest**. Debounce per-device updates to coalesce noise, throttle total ingest rate to protect Kafka.

---

## Code Examples

### Example 1: the simplest possible debouncer

The smallest correct trailing-edge debouncer in Go is built on `time.AfterFunc`. A `*time.Timer` is created once; every call to `Trigger` resets it. Only the *last* call's `Reset` will actually let the timer expire and run the registered function.

```go
package debounce

import (
	"sync"
	"time"
)

// Debouncer is a trailing-edge debouncer. Construct one with New, call Trigger
// every time an event happens, and the supplied fn will run once, `wait` after
// the last Trigger.
type Debouncer struct {
	mu    sync.Mutex
	wait  time.Duration
	fn    func()
	timer *time.Timer
}

// New returns a Debouncer that will call fn once `wait` has elapsed without
// any further calls to Trigger.
func New(wait time.Duration, fn func()) *Debouncer {
	return &Debouncer{wait: wait, fn: fn}
}

// Trigger restarts the countdown. Safe to call from any goroutine.
func (d *Debouncer) Trigger() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.timer != nil {
		d.timer.Stop()
	}
	d.timer = time.AfterFunc(d.wait, d.fn)
}
```

Usage:

```go
func ExampleDebouncer() {
	deb := New(200*time.Millisecond, func() {
		println("fired")
	})
	deb.Trigger()
	deb.Trigger()
	deb.Trigger()
	time.Sleep(300 * time.Millisecond)
	// prints "fired" exactly once
}
```

The whole pattern: `Stop` the old timer, create a new one. The Go runtime takes care of the heap, the goroutine that fires `fn`, and the cleanup.

#### Why we hold a mutex

Two goroutines calling `Trigger` simultaneously could race on `d.timer`. The mutex turns the two operations (`Stop` then assign) into one atomic update.

#### Why we don't worry about the old timer's goroutine

`AfterFunc` only schedules a goroutine when the timer fires. Calling `Stop` *before* fire prevents the goroutine from running. We never have an orphan.

### Example 2: debounce wrapping a payload

The earlier debouncer fires a fixed function with no input. In real systems the event carries data and the action should use the latest data. A typed wrapper:

```go
package debounce

import (
	"sync"
	"time"
)

type PayloadDebouncer[T any] struct {
	mu      sync.Mutex
	wait    time.Duration
	fn      func(T)
	latest  T
	hasItem bool
	timer   *time.Timer
}

func NewPayload[T any](wait time.Duration, fn func(T)) *PayloadDebouncer[T] {
	return &PayloadDebouncer[T]{wait: wait, fn: fn}
}

func (d *PayloadDebouncer[T]) Trigger(v T) {
	d.mu.Lock()
	d.latest = v
	d.hasItem = true
	if d.timer != nil {
		d.timer.Stop()
	}
	d.timer = time.AfterFunc(d.wait, d.fire)
	d.mu.Unlock()
}

func (d *PayloadDebouncer[T]) fire() {
	d.mu.Lock()
	v := d.latest
	had := d.hasItem
	d.hasItem = false
	d.mu.Unlock()
	if had {
		d.fn(v)
	}
}
```

Usage:

```go
func ExamplePayloadDebouncer() {
	deb := NewPayload[string](300*time.Millisecond, func(q string) {
		println("search:", q)
	})
	deb.Trigger("g")
	deb.Trigger("go")
	deb.Trigger("gol")
	deb.Trigger("gola")
	deb.Trigger("golan")
	deb.Trigger("golang")
	time.Sleep(400 * time.Millisecond)
	// prints exactly once: "search: golang"
}
```

#### Why the second mutex acquisition in `fire`

`fire` runs in the timer's goroutine. By the time it runs, more `Trigger` calls might have updated `d.latest`. The lock makes the read of `latest` and reset of `hasItem` atomic with whatever else is happening on `Trigger`.

#### Why `hasItem`

It guards against the rare race in which `Stop` returned false (because the timer was already firing), the next call replaced `d.timer`, and we still got a callback from the *old* timer firing. In that case `hasItem` may still be true but we have already scheduled a fresh fire, so we will deliver one extra. That is acceptable for now; we will tighten this up in `middle.md`.

### Example 3: simplest throttler with `time.Ticker`

Now the throttle. We want to admit one event per `interval`. The simplest design is a ticker plus a single-slot channel:

```go
package throttle

import (
	"context"
	"time"
)

// Throttle reads from `in`, emits at most one event per `interval` on the
// returned channel, and drops anything else. It exits when ctx is cancelled
// or `in` is closed.
func Throttle[T any](ctx context.Context, in <-chan T, interval time.Duration) <-chan T {
	out := make(chan T, 1)
	go func() {
		defer close(out)
		tick := time.NewTicker(interval)
		defer tick.Stop()
		var pending T
		var hasPending bool
		for {
			select {
			case <-ctx.Done():
				return
			case v, ok := <-in:
				if !ok {
					return
				}
				pending = v
				hasPending = true
			case <-tick.C:
				if hasPending {
					select {
					case out <- pending:
						hasPending = false
					default:
						// downstream slow; drop
					}
				}
			}
		}
	}()
	return out
}
```

This throttle has two important properties:

1. The output rate is at most 1 per `interval`. Bursts on `in` are coalesced to the *latest* unread event.
2. If the downstream consumer is slow, events are dropped silently. That is a defensible default for log throttling; it would be wrong for a throttler in front of a payment API where every event must be delivered.

### Example 4: throttle with a leading-edge fire

The previous throttle waits for the first tick before emitting anything, which means up to one full interval of latency before the first event escapes. A leading-edge throttle fires the very first event immediately:

```go
package throttle

import (
	"context"
	"time"
)

func ThrottleLeading[T any](ctx context.Context, in <-chan T, interval time.Duration) <-chan T {
	out := make(chan T, 1)
	go func() {
		defer close(out)
		var last time.Time
		for {
			select {
			case <-ctx.Done():
				return
			case v, ok := <-in:
				if !ok {
					return
				}
				now := time.Now()
				if last.IsZero() || now.Sub(last) >= interval {
					out <- v
					last = now
				}
				// else: drop
			}
		}
	}()
	return out
}
```

This is "drop everything inside the cooldown" semantics. It is simple, correct, and pulls no extra goroutines. The downside is jitter: if events arrive at exactly the same wall-clock instant from multiple sources, they may all pass or all drop together. For UI scroll handlers this is fine; for hard rate limits you want a ticker-backed version.

### Example 5: a debounce running across a channel

So far the `Debouncer` exposed a `Trigger` method. In Go we often prefer channels for everything. Here is the same logic packaged as a channel-to-channel converter:

```go
package debounce

import (
	"context"
	"time"
)

func DebounceCh[T any](ctx context.Context, in <-chan T, wait time.Duration) <-chan T {
	out := make(chan T, 1)
	go func() {
		defer close(out)
		var pending T
		var hasPending bool
		var timer *time.Timer
		var timerC <-chan time.Time
		for {
			select {
			case <-ctx.Done():
				if timer != nil {
					timer.Stop()
				}
				return
			case v, ok := <-in:
				if !ok {
					if hasPending {
						select {
						case out <- pending:
						case <-ctx.Done():
						}
					}
					return
				}
				pending = v
				hasPending = true
				if timer == nil {
					timer = time.NewTimer(wait)
				} else {
					if !timer.Stop() {
						select {
						case <-timer.C:
						default:
						}
					}
					timer.Reset(wait)
				}
				timerC = timer.C
			case <-timerC:
				if hasPending {
					select {
					case out <- pending:
						hasPending = false
					case <-ctx.Done():
						return
					}
				}
				timerC = nil
			}
		}
	}()
	return out
}
```

Read this slowly. The pattern is:

- Maintain a `*time.Timer` only when an event is pending
- `timerC` is the channel to read from; it is `nil` when no event is pending — recall that a `nil` channel in `select` is never ready, which is exactly how we "disable" that branch
- On event: update pending, create or `Reset` the timer
- On timer fire: deliver pending, disable the timer branch
- On context cancel: stop the timer, return

#### Why drain `timer.C` inside the `Stop`-false branch

When `timer.Stop` returns false it means the timer already fired (or was already stopped). If we do not drain `timer.C`, the next `Reset` could give us a stale fire from the old firing. The non-blocking `select` drains it if present.

This idiom — `Stop` then drain — is the single most important pattern in Go timer code. It is covered in `03-timer-leaks` and is repeated in every production debounce and throttle.

### Example 6: a leading throttle backed by `time.Now`

The simplest throttle does not need any goroutines or channels at all. It is a struct holding the last-fire time and a mutex:

```go
package throttle

import (
	"sync"
	"time"
)

type Limiter struct {
	mu       sync.Mutex
	interval time.Duration
	last     time.Time
}

func New(interval time.Duration) *Limiter {
	return &Limiter{interval: interval}
}

// Allow returns true if an event is allowed right now.
func (l *Limiter) Allow() bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.last.IsZero() || now.Sub(l.last) >= l.interval {
		l.last = now
		return true
	}
	return false
}
```

Usage:

```go
func ExampleLimiter() {
	l := New(500 * time.Millisecond)
	for i := 0; i < 10; i++ {
		if l.Allow() {
			println("fire", i)
		}
		time.Sleep(100 * time.Millisecond)
	}
	// prints "fire 0", "fire 5"
}
```

This pattern is so common that the standard library effectively provides it via `golang.org/x/time/rate`. We will introduce that in `middle.md`. For now, the hand-rolled version is a fine starting point and works without external dependencies.

### Example 7: throttle that blocks instead of dropping

Sometimes you want callers to *wait* until the next token rather than be silently rejected. The cheapest version is a `time.Ticker` wrapped in a method:

```go
package throttle

import (
	"context"
	"time"
)

type BlockingLimiter struct {
	tick *time.Ticker
}

func NewBlocking(interval time.Duration) *BlockingLimiter {
	return &BlockingLimiter{tick: time.NewTicker(interval)}
}

func (b *BlockingLimiter) Wait(ctx context.Context) error {
	select {
	case <-b.tick.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (b *BlockingLimiter) Close() {
	b.tick.Stop()
}
```

Usage:

```go
func sendBatch(ctx context.Context, items []Item) error {
	l := NewBlocking(100 * time.Millisecond)
	defer l.Close()
	for _, it := range items {
		if err := l.Wait(ctx); err != nil {
			return err
		}
		send(it)
	}
	return nil
}
```

This is the simplest correct implementation of "block until I'm allowed to send", and it composes naturally with `context` for cancellation. Its weakness is that the ticker keeps running even when nobody is waiting — that wastes a goroutine wakeup per interval. For low-frequency limiters this is negligible; for very high-frequency ones we will reach for `rate.Limiter` in `middle.md`.

### Example 8: combining debounce and throttle

Real systems often want both. A search box should *debounce* typing into one query *and* then *throttle* queries to protect the backend. Here is the wiring:

```go
package pipeline

import (
	"context"
	"time"

	"example.com/debounce"
	"example.com/throttle"
)

func SearchPipeline(ctx context.Context, keystrokes <-chan string) <-chan string {
	debounced := debounce.DebounceCh(ctx, keystrokes, 300*time.Millisecond)
	throttled := throttle.Throttle(ctx, debounced, 500*time.Millisecond)
	return throttled
}
```

Three lines. The keystroke channel becomes a debounced channel, which becomes a throttled channel. Notice that each stage runs in its own goroutine — that is the entire point of channel-based composition. We will return to this layered design in `middle.md` and `professional.md`.

### Example 9: a debouncer that knows about cancellation

The debouncers above accept `context.Context` and exit on `ctx.Done()`. A subtle question: should a pending event still fire after the context is cancelled?

The general answer is **no**. Once the context is cancelled the consumer has stopped listening. Firing the timer's callback may write into a closed channel and panic, or may do unwanted work after the request has been abandoned.

The patterns in this file all stop the timer on context cancellation and do not fire any pending event. In `middle.md` we will explore the alternate policy ("fire on cancel") for completeness, but the default is "cancel means discard".

### Example 10: a small end-to-end runnable demo

To tie this together, here is a complete program you can run with `go run`:

```go
package main

import (
	"context"
	"fmt"
	"time"
)

type Debouncer struct {
	wait  time.Duration
	in    chan string
	out   chan string
	done  chan struct{}
}

func NewDebouncer(wait time.Duration) *Debouncer {
	d := &Debouncer{
		wait: wait,
		in:   make(chan string, 16),
		out:  make(chan string, 1),
		done: make(chan struct{}),
	}
	go d.loop()
	return d
}

func (d *Debouncer) loop() {
	defer close(d.out)
	var pending string
	var hasPending bool
	var timer *time.Timer
	var timerC <-chan time.Time
	for {
		select {
		case <-d.done:
			if timer != nil {
				timer.Stop()
			}
			return
		case v, ok := <-d.in:
			if !ok {
				return
			}
			pending = v
			hasPending = true
			if timer == nil {
				timer = time.NewTimer(d.wait)
			} else {
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				timer.Reset(d.wait)
			}
			timerC = timer.C
		case <-timerC:
			if hasPending {
				d.out <- pending
				hasPending = false
			}
			timerC = nil
		}
	}
}

func (d *Debouncer) Trigger(v string) {
	d.in <- v
}

func (d *Debouncer) Out() <-chan string { return d.out }

func (d *Debouncer) Close() {
	close(d.done)
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	deb := NewDebouncer(300 * time.Millisecond)
	defer deb.Close()

	go func() {
		for v := range deb.Out() {
			fmt.Println("delivered:", v)
		}
	}()

	for _, c := range "golang" {
		deb.Trigger(string(c))
		time.Sleep(50 * time.Millisecond)
	}

	<-ctx.Done()
}
```

Output:

```
delivered: g
```

Wait — that is the first letter, not the last. Why? Because `time.Sleep(50ms)` between letters is *less* than the 300ms debounce, so every letter resets the timer; only after the loop ends and we sleep do we actually get a fire — and the latest letter is `g`. Let me trace it more carefully:

Actually the loop sends `g`, `o`, `l`, `a`, `n`, `g` and the last is `g`. So output is `delivered: g`. If we change the loop to type `golang!`, the output would be `delivered: !`. The point is: trailing debounce always delivers the last event, no matter how many came before.

Run this program and play with the sleep duration. With `50ms`, all letters arrive within one debounce window. With `400ms`, each letter triggers its own fire, and you will see every character delivered.

---

## Coding Patterns

### Pattern 1: AfterFunc + Stop + assign

```go
if d.timer != nil {
    d.timer.Stop()
}
d.timer = time.AfterFunc(d.wait, d.fn)
```

The simplest correct debounce primitive. We discard the return of `Stop` because `AfterFunc` schedules its own goroutine and we just want the *previous* schedule cancelled. If `Stop` returned false (timer already fired), we accept that the old `fn` might have just run — that is no worse than the old behaviour and our new schedule is correct.

### Pattern 2: nil-channel disable

```go
var timerC <-chan time.Time
for {
    select {
    case <-timerC: // never ready when timerC is nil
        ...
    }
}
```

A nil channel in a `select` is **never ready**. This is the Go-idiomatic way to "disable" a branch of a `select`. Use it to express "no timer is currently armed" without ad-hoc booleans.

### Pattern 3: Stop-then-drain Reset dance

```go
if !timer.Stop() {
    select {
    case <-timer.C:
    default:
    }
}
timer.Reset(d)
```

When you reset a `time.Timer` (not `AfterFunc`), you must handle the case where it already fired. `Stop` returns `false` if it cannot prevent the fire. The non-blocking receive drains the channel if a value is sitting there. This avoids a stale value triggering the *next* fire prematurely.

In Go 1.23+ the runtime made this safer — bare `Reset` is now safe in most cases — but the explicit pattern still works on every version and is the canonical idiom.

### Pattern 4: ticker + buffered out-channel + drop

```go
out := make(chan T, 1)
for {
    select {
    case v := <-in:
        pending = v
        hasPending = true
    case <-tick.C:
        if hasPending {
            select {
            case out <- pending:
                hasPending = false
            default:
            }
        }
    }
}
```

This is the lossy throttle. The inner non-blocking send means "if the downstream is full, drop". It is appropriate for logs, metrics, UI updates — anything where the latest value is fine and dropping is acceptable.

### Pattern 5: blocking throttle

```go
out := make(chan T)
for v := range in {
    <-tick.C
    out <- v
}
```

The lossless throttle. Senders block on `tick.C`. The downstream gets one event per interval *and* every event is preserved (subject to the input channel's capacity). The cost is that producers must tolerate blocking.

### Pattern 6: leading-edge "if-elapsed"

```go
now := time.Now()
if now.Sub(last) >= interval {
    last = now
    // fire
}
```

No goroutines, no channels, no timers. Just timestamps. This is the implementation strategy of every "leading throttle" in the wild. It is so cheap that it shows up in tight loops where allocating a goroutine would be silly.

### Pattern 7: context-aware exit

```go
select {
case v := <-in:
    ...
case <-ctx.Done():
    if timer != nil { timer.Stop() }
    return
}
```

Always provide a way out. A debounce or throttle goroutine that cannot be cancelled is a goroutine leak waiting to happen. The `ctx.Done()` branch is non-negotiable in any production code.

---

## Clean Code

### Name your debouncers and throttlers for *what they coalesce or pace*

A name like `saveDebouncer` or `searchDebouncer` makes the call site read like English: `searchDebouncer.Trigger(query)`. A name like `d`, `db`, `dbnc` makes the call site obscure.

### Keep the function signature symmetric for debounce and throttle

Both should accept a `context.Context` first, an input channel second, and a duration third. The output channel should be the return value. The reader can then guess the API without reading the doc:

```go
func Debounce[T any](ctx context.Context, in <-chan T, wait time.Duration) <-chan T
func Throttle[T any](ctx context.Context, in <-chan T, interval time.Duration) <-chan T
```

### Encapsulate the goroutine

Never expose a public `Loop()` method that callers are expected to run in a goroutine. Spawn the goroutine inside the constructor (or the channel-pipeline function) and return the public surface. Callers should not have to remember "and also run `go d.Loop()`".

### One responsibility per type

A `Debouncer` debounces. It does not also throttle, batch, or persist. If you find your struct sprouting flags like `withBatching bool`, `withThrottling bool`, split it. Composition through channels is your friend.

### Make the firing function explicit

A debouncer that calls a `func()` is fine; a debouncer that emits to a channel is fine. A debouncer that does *both*, depending on a flag, is not fine. Pick one in the public API and let the other be implemented in terms of it.

### Always document the window

`NewDebouncer(300 * time.Millisecond, save)` is a call site that benefits from a comment: `// 300ms after the last edit, persist to disk.` In production code that comment is documentation; in junior code it is a teaching tool.

### Stop ticks in a `Close` method

Every long-lived throttler should expose `Close`. Inside, call `Stop` on the ticker. If you forget, the runtime will keep the ticker timer alive forever, which is a tiny memory leak in tests and a real one in long-running processes.

---

## Product Use and Feature

Imagine you are building a markdown note-taking app. The product manager says:

- "When the user stops typing for half a second, save."
- "Don't hit the server more than twice a second even if the user types like a maniac."
- "When connectivity is bad, queue saves and don't lose data."

That is one debounce, one throttle, and one buffered queue. The architecture writes itself:

```
keystroke chan → DebounceCh(500ms) → ThrottleBlocking(500ms) → save()
```

The `DebounceCh` collapses bursts; the `ThrottleBlocking` paces; the channel between them buffers if needed. A two-line wiring beats a hundred-line custom save-controller every time.

### Real-life feature: file-watch reload

A common feature in tooling: when a config file changes, reload it. File systems generate multiple "write" events for one save (open, write, close = 3 events on Linux). Without a debouncer your tool reloads the config three times in a row, which is at best a waste and at worst a half-written file being read.

```go
watcher.Events → DebounceCh(100ms) → reloadConfig()
```

Done.

### Real-life feature: error suppression

A logger that prints `connection refused` once per second instead of once per call:

```go
errCh → Throttle(1 * time.Second) → log.Println
```

The first error fires immediately (with a leading throttle), and subsequent errors in the next second are dropped. The on-call engineer sees one line per second, not ten thousand.

---

## Error Handling

The patterns in this file mostly process events of an opaque type. Errors live alongside events as part of the payload — typically `chan Result[T]` or `chan struct{ V T; Err error }`. The debouncer or throttler does not know what an "error" is; it just relays the payload.

That said, there are a few error-shaped things specific to debounce and throttle:

### Context cancellation

If the context is cancelled while an event is pending, *do not* deliver it. Discard it. The consumer is no longer listening.

```go
case <-ctx.Done():
    if timer != nil { timer.Stop() }
    return // do not flush
```

### Producer close

If the input channel is closed while an event is pending, the right behaviour usually *is* to deliver the pending event (it would have been delivered eventually). After the flush, exit:

```go
case v, ok := <-in:
    if !ok {
        if hasPending {
            select {
            case out <- pending:
            case <-ctx.Done():
            }
        }
        return
    }
    ...
```

### Downstream full

If the output channel is full and you have a *lossy* throttle, drop. If you have a *lossless* throttle, block on the send and accept backpressure. The choice is product-driven; document it loudly.

### Panic safety in `AfterFunc`

`time.AfterFunc(d, f)` runs `f` in a goroutine. If `f` panics it kills the whole program. Always recover inside the supplied function for production code:

```go
time.AfterFunc(d, func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("debounce fn panic: %v", r)
        }
    }()
    fn()
})
```

We will revisit panic safety in `professional.md`.

---

## Security Considerations

Debounce and throttle are themselves security primitives — they are how you implement rate-limiting on login attempts, password resets, API keys, and other abuse surfaces. A few things to be aware of even at the junior level:

### Don't use debounce as a rate limit

A debouncer absorbs bursts but allows arbitrary frequency over the long run. If you debounce password reset emails by 5 seconds, an attacker can still send *one every 5 seconds forever* — that is one per second of average rate which is not what you want. Use throttle for security limits.

### Per-actor isolation

A single shared throttle limits the whole system. For abuse prevention you want a throttle *per IP*, per user, or per API key. That means a `map[Actor]*Limiter` with eviction. We will design that in `senior.md`.

### Beware time-based side channels

If your "Allow" function takes substantially longer when the throttle rejects than when it permits, an attacker can deduce rate-limit state from response time. Make both paths constant-time-ish (the simple Allow above already is, because the cost difference between "compare and return true" and "return false" is negligible).

### Resource exhaustion

A throttle that *queues* unbounded events will eat all your memory. Always use a bounded queue (or no queue and the drop policy) when the actor is untrusted.

---

## Performance Tips

### `time.AfterFunc` allocates

Every call to `AfterFunc` allocates a `*time.Timer` and a goroutine. For a debouncer that fires hundreds of times per second this adds up. A single `time.Timer` reused via `Reset` allocates exactly once. Prefer the reuse pattern for hot debouncers.

### `time.Now` is fast but not free

On Linux/amd64 a `time.Now()` call is ~20ns and a `time.Since` is a subtraction plus a `Now`. On hot paths (millions of calls per second) you may want to amortise — call `time.Now` once per batch. We will get into this in `senior.md` and `optimize.md`.

### Avoid creating a new ticker per request

A `time.NewTicker` returned by your throttler should be created once and shared across calls. Creating one per request makes the runtime's timer heap dance for every event.

### Buffered output for throttles

`make(chan T, 1)` instead of `make(chan T)` removes one rendezvous from the hot path. The throttle's tick branch can deliver and continue without waiting for the consumer to be ready.

### Don't channel a single-bit signal

If the consumer just needs to know "an event is pending", `chan struct{}` with capacity 1 is the right type, not `chan bool` and not `chan int`. The compiler knows `struct{}` has zero size.

---

## Best Practices

1. **Always document the window.** "Debounce 300ms" or "Throttle 1/sec" should appear in the call site comment or constructor argument name.
2. **Always provide cancellation.** Either a `context.Context` parameter or a `Close()` method. Long-lived goroutines without cancellation are leaks.
3. **Default to trailing-edge debounce.** It is the variant 95% of use cases want. If you need leading, name the constructor `NewLeadingDebouncer` so it is obvious at the call site.
4. **Default to lossy throttle for logs and metrics, lossless for API quotas.** Picking the wrong default produces either dropped business events or memory bloat.
5. **Test with `time.Tick(time.Microsecond)`-driven input** to force the timer paths. A debouncer that "works" with 1-second test inputs may have unhandled edge cases at 1-microsecond inputs.
6. **Never share a `Debouncer` between contexts.** If `Trigger` is called from request A's context and the timer fires after request B's context cancels, things get messy. One context per debouncer is the safe rule.
7. **Prefer `AfterFunc` for fire-once-then-rearm semantics.** It is shorter and the runtime handles the goroutine. Use `time.Timer` + `Reset` only when you need to read from `timer.C` inside a `select`.
8. **Stop tickers in `defer`.** `defer tick.Stop()` is one line and prevents a runtime timer leak.
9. **Drain `timer.C` after `Stop` only when `Stop` returns false.** Draining when `Stop` returned true is a bug — there is nothing to drain and the select will block.
10. **Treat a `nil` channel as "disabled branch".** It is the cleanest way to express "no timer armed".

---

## Edge Cases and Pitfalls

### Pitfall 1: the trigger that never fires

```go
deb := New(1 * time.Second, save)
for range events {
    deb.Trigger()
    time.Sleep(500 * time.Millisecond)
}
```

If events never stop for a full second, the debouncer **never fires**. This is by design — there is no quiet period. The fix is either to use a throttle (which is time-driven and fires regardless of quiet) or to add a "maximum wait" to your debounce — combined-mode debounce, covered in `middle.md`.

### Pitfall 2: the timer that fires after Close

```go
deb := New(300 * time.Millisecond, save)
deb.Trigger()
deb.Close()
// 300ms later, save() is called anyway because we forgot to Stop the timer
```

`Close` must stop the timer. The simple debouncer above did not have a `Close`. In `middle.md` we will add one.

### Pitfall 3: missed first event

```go
out := Throttle(ctx, in, 1 * time.Second)
in <- "first"
v := <-out
// blocked for up to 1 second before "first" emerges
```

The ticker-based throttle delays the first event by up to a full tick. If you want the first event immediately, use the leading-throttle variant.

### Pitfall 4: ticker drift on slow consumers

```go
tick := time.NewTicker(100 * time.Millisecond)
for range tick.C {
    slowWork() // takes 200ms
}
```

If `slowWork` is slower than the tick, `tick.C` accumulates pending values. The loop ends up "playing catch-up" and runs back-to-back. For *throttling*, this is what you want — but for "pace work to 10/sec" it is wrong because you actually run 20/sec for a while. The fix is to read from `tick.C` once per loop and discard if late, or use `rate.Limiter`.

### Pitfall 5: capturing the loop variable

```go
for _, e := range events {
    deb := New(100*time.Millisecond, func() {
        fmt.Println(e) // always prints the last e in Go < 1.22
    })
    deb.Trigger()
}
```

Pre-Go-1.22, the closure captures `e` by reference. In Go 1.22+ this is fixed at the language level. But debounce callbacks are common offenders. Always capture explicitly:

```go
e := e
deb := New(100*time.Millisecond, func() {
    fmt.Println(e)
})
```

### Pitfall 6: race on `latest`

In our `PayloadDebouncer` we held a mutex. Without the mutex, two goroutines calling `Trigger` and the timer goroutine calling `fire` race on `latest`. Even reads of a `string` are not atomic — they consist of pointer + length. Always lock.

### Pitfall 7: `time.Tick` (note: no New) cannot be stopped

```go
for t := range time.Tick(time.Second) {
    ...
}
```

`time.Tick` returns a channel from a ticker that you can never stop. It is a leak. Use `time.NewTicker` and `defer t.Stop()`.

### Pitfall 8: throttle output channel closed too eagerly

```go
go func() {
    defer close(out)
    for v := range in {
        ...
    }
}()
```

If `in` is closed but the throttle has a pending event, the pending event is lost unless you flush. The DebounceCh example above flushes on close; many production throttles do not, depending on policy.

### Pitfall 9: clock skew

`time.Now` is wall-clock time. If the system clock jumps (NTP correction, VM resume) your throttle may briefly fire a flurry of events. Use `time.Since` on a `time.Now` recorded at startup, or even better, the monotonic clock — which Go's `time.Now` already records since Go 1.9. Comparing two `time.Now` results is monotonic by default; comparing one to a hard-coded `time.Time` literal is not.

### Pitfall 10: AfterFunc panics

```go
time.AfterFunc(d, func() {
    panic("oops")
})
```

This kills the process. Recover inside.

---

## Common Mistakes

1. **Confusing debounce and throttle.** They sound similar; they are not. Re-read the "fundamental distinction" section if you ever waver.
2. **Reaching for debounce when throttle is needed (or vice versa).** Search box → debounce; API call → throttle.
3. **Not stopping tickers.** `time.NewTicker` without `Stop` is a long-running leak.
4. **Forgetting to drain `timer.C` after `Stop`-false.** Causes stale fires.
5. **Using `time.Tick` (no `New`).** Cannot be stopped; in any but the shortest test programs this is a leak.
6. **Sharing a debouncer across actors.** One debouncer per actor (per user, per session, per file) is the rule.
7. **Forgetting `context.Context`.** Every long-lived goroutine should accept a context. Otherwise you cannot shut down gracefully.
8. **Reading `time.Now` inside a tight loop with thousands of events per second.** Amortise.
9. **Allocating a `*Limiter` per request.** Allocate once at startup, share via dependency injection.
10. **Mixing leading and trailing semantics without naming them.** The bug report will say "the button fires twice"; the cause is "I added trailing to a leading-only throttle".

---

## Common Misconceptions

> "Throttle and debounce are the same thing with different parameters."

No. They are different patterns. A debouncer with a 0-second window does *not* become a throttle; it becomes "call immediately on every event" — i.e. no rate limiting at all. A throttle with an infinite interval does not become a debouncer; it becomes "fire once and never again".

> "Debounce is for input, throttle is for output."

No. Both can be applied at input or output. A search-box keystroke is input, debounced. An outbound HTTP call is output, throttled. A websocket from a peer is input, throttled (to protect us). A toast notification is output, debounced (so we don't spam the user).

> "If I use `rate.Limiter` I don't need to understand any of this."

`rate.Limiter` is excellent and we use it heavily in `middle.md` and beyond. But you still need to know when to reach for debounce vs throttle, what bucket size to set, what to do on rejection. The library does not decide that for you.

> "Throttle adds latency."

Lossy throttle adds **at most one interval** of latency to the first event of a burst (with a ticker-backed implementation; zero with a leading implementation). Blocking throttle can add unbounded latency for late events in a burst. Debounce adds **exactly the window's worth** of latency to the last event.

> "I can just use `time.Sleep`."

`time.Sleep` paces a single producer. It does not throttle multiple concurrent producers, does not interact with channels, and does not respect cancellation cleanly.

---

## Tricky Points

### Tricky point 1: Reset semantics changed in Go 1.23

Before Go 1.23, calling `t.Reset` on a `*time.Timer` that had already fired could leave a stale value in `t.C`. The canonical workaround was the Stop-then-drain dance. From Go 1.23, the runtime made `Reset` safer by re-using the same channel and ensuring a single fire is delivered. The Stop-then-drain dance is still **correct** on all versions, just no longer **required** on 1.23+. Junior code should use the older idiom for portability.

### Tricky point 2: `AfterFunc` vs `NewTimer`

`time.AfterFunc(d, f)` runs `f` in a fresh goroutine when the timer fires. You cannot read from `timer.C` because there is no `timer.C` channel exposed to you. You also do not need a `select`.

`time.NewTimer(d)` returns a timer with a `timer.C` channel of buffer 1. You can include `<-timer.C` in a `select` and decide whether to fire based on which branch wins.

Use `AfterFunc` for fire-and-forget (the simple debouncer). Use `NewTimer` when the timer participates in a `select` (the channel-based debouncer).

### Tricky point 3: `Stop` returns bool

`t.Stop()` returns `true` if the call stopped the timer before it fired; `false` if it had already fired (or already been stopped). Production code uses that return value to decide whether to drain.

### Tricky point 4: goroutines from AfterFunc that already started

If `Stop` returns `false`, the timer's goroutine has already started running your `fn`. Stopping does *not* cancel an already-running `fn`. If you needed to abort the work — you cannot. The fix is to put a cancellation check inside `fn` itself.

### Tricky point 5: channels in select with closed sender

A closed channel becomes *immediately ready*. If you `select` on a closed channel, that branch will be chosen *every time*. Without an `ok` check and an explicit `nil`-out of that branch, you spin-loop. Always check `ok`:

```go
case v, ok := <-in:
    if !ok {
        in = nil // disable this branch
        continue
    }
```

### Tricky point 6: ticker drift

`time.NewTicker(100ms)` tries to fire every 100ms, but if the consumer is slow and the channel buffer fills (buffer is 1 for a ticker), the runtime *drops* ticks. The ticker does not "catch up" beyond the next scheduled fire. This is good for throttling (we never want a burst out the other side) but surprising.

### Tricky point 7: timers vs `runtime.timer`

Internally Go maintains a heap of timers in `runtime/time.go`. Creating millions of `time.AfterFunc` calls is fine for short-lived programs but can pressure the timer heap. For very high-frequency debouncing consider sharing a single timer that you `Reset` repeatedly.

### Tricky point 8: GC and timers

A `*time.Timer` that has been `Stop`ed and is no longer referenced is collected. A `*time.Timer` you keep a reference to but never `Stop` will *not* be GC'd until it fires. So long-lived debouncers that never fire (rare) can hold timers indefinitely.

### Tricky point 9: `time.Now` and timestamps

`time.Now()` returns a `time.Time` with both wall-clock and monotonic components. `Sub` between two such values uses monotonic, so it is correct across NTP adjustments. But if you serialize a `time.Time` to JSON and back, the monotonic component is lost. Be careful in distributed systems.

### Tricky point 10: zero-value `time.Time`

A `time.Time` whose underlying state is the zero value satisfies `t.IsZero() == true`. Comparisons like `now.Sub(zero)` are valid but yield a very large number (~292 years). Use `IsZero` checks before doing the math.

---

## Test

```go
package debounce

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestDebouncerFiresOnce(t *testing.T) {
	var hits int32
	d := New(50*time.Millisecond, func() {
		atomic.AddInt32(&hits, 1)
	})
	for i := 0; i < 10; i++ {
		d.Trigger()
		time.Sleep(10 * time.Millisecond)
	}
	time.Sleep(100 * time.Millisecond)
	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Fatalf("expected 1 fire, got %d", got)
	}
}

func TestDebouncerFiresPerBurst(t *testing.T) {
	var hits int32
	d := New(50*time.Millisecond, func() {
		atomic.AddInt32(&hits, 1)
	})
	d.Trigger()
	time.Sleep(100 * time.Millisecond)
	d.Trigger()
	time.Sleep(100 * time.Millisecond)
	if got := atomic.LoadInt32(&hits); got != 2 {
		t.Fatalf("expected 2 fires, got %d", got)
	}
}

func TestDebounceChChannelClose(t *testing.T) {
	in := make(chan int, 8)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out := DebounceCh(ctx, in, 30*time.Millisecond)
	for i := 0; i < 5; i++ {
		in <- i
	}
	close(in)
	select {
	case v, ok := <-out:
		if !ok {
			t.Fatal("expected one value before close")
		}
		if v != 4 {
			t.Fatalf("expected 4, got %d", v)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("timeout")
	}
}
```

```go
package throttle

import (
	"context"
	"testing"
	"time"
)

func TestThrottleRate(t *testing.T) {
	in := make(chan int, 100)
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	out := Throttle(ctx, in, 100*time.Millisecond)
	go func() {
		for i := 0; i < 100; i++ {
			in <- i
		}
		close(in)
	}()
	var count int
	for range out {
		count++
	}
	// In 500ms with 100ms interval we should get ~5
	if count > 7 || count < 3 {
		t.Fatalf("expected ~5 events, got %d", count)
	}
}

func TestLimiterLeading(t *testing.T) {
	l := New(50 * time.Millisecond)
	if !l.Allow() {
		t.Fatal("first Allow should succeed")
	}
	if l.Allow() {
		t.Fatal("second immediate Allow should fail")
	}
	time.Sleep(60 * time.Millisecond)
	if !l.Allow() {
		t.Fatal("Allow after interval should succeed")
	}
}
```

Run these with `go test -race -count=10` to shake out any rare races. The `-count=10` is important; concurrency bugs love to hide in single runs.

---

## Tricky Questions

> **Q1**: A debouncer is configured with a 100ms window. Events arrive every 50ms forever. How many fires per minute?

**A**: Zero. The window never expires because events keep arriving. This is by design and is a known property of pure trailing debounce.

> **Q2**: A throttle with a 1-second interval receives 10 events at time 0 and nothing after. How many fire and when?

**A**: One fires at time 0 (leading) or time 1s (trailing). Nine are dropped (lossy) or queue up to be delivered at 1s, 2s, … 9s (blocking).

> **Q3**: If you call `d.Trigger()` once and then call `d.Stop()` before the window expires, does the fn ever run?

**A**: Not if `Stop` correctly stops the timer. Our basic example does not have a `Stop` method; you would add one that calls `d.timer.Stop()` under the mutex.

> **Q4**: Why does a trailing debouncer "fire on close" of its input channel in the `DebounceCh` example?

**A**: Because closing the input is a strong signal that no more events are coming, so the latest pending event represents the final state and should not be lost. It is a policy choice; some debouncers discard pending events on close.

> **Q5**: A throttler is implemented as a goroutine reading from `in` and sending to `out`. The caller forgets to read from `out`. What happens?

**A**: If `out` is unbuffered, the throttler blocks forever on send. If `out` is buffered, the throttler fills the buffer and then blocks. Either way you have a leaked goroutine. The drop policy (`select { case out <- v: default: }`) prevents this.

> **Q6**: Why is `time.Tick(d)` considered harmful?

**A**: It returns the underlying ticker's channel but provides no way to access the ticker itself, so you cannot call `Stop`. The ticker leaks for the life of the program.

> **Q7**: A debouncer is created inside an HTTP handler. The handler returns. Does the debouncer survive?

**A**: It survives as long as something references it. If you stored it in a `map[user]*Debouncer` it persists. If it was a local variable, it is GC'd. If you forgot to stop its timer it persists until the timer fires.

> **Q8**: What's the difference between `Throttle` returning a `<-chan T` and `Throttle` taking a callback `func(T)`?

**A**: The channel version composes with other channel stages — pipelines. The callback version is more direct for one-shot use but ties the throttler to a specific kind of consumer. Library authors prefer channels.

> **Q9**: A junior writes `time.AfterFunc(d, fn)` inside `Trigger` and never calls `Stop` on the old timer. What is the bug?

**A**: Each `Trigger` schedules a new fire without cancelling the old one. After N triggers within `d`, you get N fires. The fix is `if old != nil { old.Stop() }; new = AfterFunc(...)`.

> **Q10**: In the channel-based `DebounceCh`, why is `timerC` set to `nil` after a fire instead of just relying on the timer being expired?

**A**: A `nil` channel in a `select` is permanently not ready. Without nil-ing it, the next iteration would race: the timer's channel might still appear ready and we would fire on stale data. Nil-ing is the cleanest disable.

---

## Cheat Sheet

```go
// Trailing debounce: fire 300ms after last event.
deb := time.AfterFunc(300*time.Millisecond, fn)
// On event:
deb.Stop(); deb = time.AfterFunc(300*time.Millisecond, fn)

// Leading throttle: fire if 1s has elapsed.
if time.Since(last) >= time.Second {
    last = time.Now(); fn()
}

// Trailing throttle: ticker emits at most once per tick.
tick := time.NewTicker(time.Second); defer tick.Stop()
for {
    select {
    case v := <-in:  pending = v; hasPending = true
    case <-tick.C:   if hasPending { out <- pending; hasPending = false }
    case <-ctx.Done(): return
    }
}

// Channel-based debounce: timer + nil-channel disable.
var timer *time.Timer; var tc <-chan time.Time
for {
    select {
    case v := <-in:
        pending = v; hasPending = true
        if timer == nil { timer = time.NewTimer(d) } else { timer.Stop(); select { case <-timer.C: default: }; timer.Reset(d) }
        tc = timer.C
    case <-tc:
        if hasPending { out <- pending; hasPending = false }
        tc = nil
    case <-ctx.Done(): return
    }
}
```

### Decision table

| Want | Use |
|------|-----|
| "Only the last value matters" | trailing debounce |
| "First click only" | leading debounce |
| "Max N per second, drop overflow" | lossy throttle (ticker) |
| "Max N per second, block sender" | blocking throttle (ticker) or `rate.Limiter` |
| "Burst tolerant" | token bucket (`rate.Limiter`) |
| "Strict steady output" | leaky bucket |
| "Approximate rolling window" | sliding window |

---

## Self-Assessment Checklist

- [ ] I can state the difference between debounce and throttle in one sentence.
- [ ] I have written a working trailing debouncer using `time.AfterFunc`.
- [ ] I have written a working throttler using `time.Ticker`.
- [ ] I know why my goroutine must accept a `context.Context` or a `done` channel.
- [ ] I know what `Stop`-then-drain is and why we do it before `Reset`.
- [ ] I can explain why `time.Tick` (no `New`) is a leak.
- [ ] I can name three real product features served by debounce and three served by throttle.
- [ ] I know when to use the channel-based form and when to use the method-based form.
- [ ] I can recognise a captured-loop-variable bug in a debounce callback.
- [ ] I have run the test suite with `go test -race -count=10`.

---

## Summary

A debouncer waits for silence; a throttler watches the clock. The simplest debouncer is a `time.AfterFunc` you `Stop` and reschedule on every event. The simplest throttler is a `time.Ticker` plus a single-slot channel. Both run in their own goroutine, both accept a context for cancellation, and both must be careful to clean up their timer when done. Real systems often layer them — debounce input, throttle output — and that layered design composes naturally with Go channels.

If you stop reading here you have enough to build a search-box debouncer, a log throttler, or a per-IP rate limit. The next file (`middle.md`) introduces leading-edge variants, the `golang.org/x/time/rate` library, and the design choices that come with real production traffic.

---

## What You Can Build

- A debounced search box for a CLI or web app.
- A throttled logger that suppresses repeated errors.
- A config-file watcher that reloads only after the burst of write events ends.
- A throttle in front of a downstream API to stay under 10 RPS.
- A WebSocket message coalescer that emits at most 30 fps per peer.
- A document auto-saver that persists 500ms after the user stops typing.

---

## Further Reading

- The Go time package: <https://pkg.go.dev/time>
- Bradfitz on time pitfalls: <https://dave.cheney.net/tag/timers>
- The Go runtime timer implementation: `src/runtime/time.go` in the Go source tree
- `golang.org/x/time/rate`: <https://pkg.go.dev/golang.org/x/time/rate>
- Russ Cox on Go concurrency patterns: "Go Concurrency Patterns" talk
- Lodash debounce documentation (for cross-language flavour): <https://lodash.com/docs/#debounce>

---

## Related Topics

- `01-ticker` — the `time.Ticker` primitive in detail
- `02-afterfunc` — the `time.AfterFunc` primitive in detail
- `03-timer-leaks` — how timer cleanup goes wrong and how to fix it
- `04-exponential-backoff` — a sibling pattern for retry-with-rate-limit
- `09-pipelines` (forthcoming) — composition of channel stages
- `06-context` — `context.Context` for cancellation

---

## Diagrams and Visual Aids

### Debounce timeline

```
events    : E   E E   E       E      E
                                          ↓ (timer expires)
output    :                              F
            ←——— resets ———→ ← quiet →
```

### Throttle timeline

```
clock     : T   T   T   T   T   T   T   T
events    : E E E E E E E E E E E E E E E E
output    : E       E       E       E
             (drops in between)
```

### Token bucket

```
   refill rate R/sec
        ↓
   ┌────────┐
   │tokens  │  max capacity B
   │ • • •  │
   └───┬────┘
       ↓ event takes 1 token
       (or waits if empty)
```

### Combined search box pipeline

```
keystrokes ─→ DEBOUNCE 300ms ─→ THROTTLE 500ms ─→ search()
              (collapse burst)  (cap rate)
```

### Decision flowchart

```
Do you want "only the last value matters"?
   yes  → DEBOUNCE
   no   → Do you want "max N per second"?
          yes → THROTTLE
          no  → No rate-limiting needed
```

### State machine diagram for debounce

```
        ┌───────────────────────────────┐
        │                               │
        ↓                               │
   ┌─────────┐  Trigger(v)        ┌───────────┐
   │  Idle   │ ─────────────────→ │  Pending  │
   │ timer=∅ │                    │ timer set │
   └─────────┘ ←──────────────────└───────────┘
                  timer expires
                  fire fn(latest)
                  reset timer to nil
```

In the `Idle` state the debouncer holds no timer; the next `Trigger` creates one. In the `Pending` state every subsequent `Trigger` resets the timer's countdown. Only the timer's expiration can transition back to `Idle`, and that transition is also when `fn` is invoked. `Close` is not shown but is a third state that forcibly drops to `Stopped` from either of the two.

### State machine diagram for throttle

```
   ┌─────────┐   tick                ┌────────────┐
   │ Closed  │ ────────────────────→ │  Open      │
   │ (drop)  │                       │ (let one)  │
   └─────────┘ ←───────────────────  └────────────┘
                 event accepted
```

In `Closed` state events are dropped (or queued). The next tick from the underlying `time.Ticker` moves the throttle to `Open` for an instant — long enough to let one event through — and then back. The "instant" is conceptual; in code it is a single iteration of the `select` loop.

### Memory model timeline of a debounce fire

```
goroutine A (caller)        goroutine B (debounce loop)        goroutine C (timer)

Trigger("x") ──────────────→ in <- "x"
                              ↓
                              pending = "x"
                              timer.Reset(d)
                                                 d elapses ────→ <-timer.C ready
                              ←──────────────────────────────────|
                              fn("x")
                                                                 ↑
                                                       runtime goroutine fires
```

Three goroutines participate. The caller never blocks (the `in` channel is buffered). The debounce loop owns the state. The runtime spawns a brief goroutine to deliver the timer signal — though for `AfterFunc` the runtime directly invokes the function and there is no intermediate channel.

### Sequence chart: token bucket with burst

```
time:  0       1       2       3       4       5
bkt :  •••••   •••••   ••••    •••     ••••    •••
       (5)     (refill (1 evt) (1 evt) (refill (1 evt)
                +0,    consumed         +1)    consumed
                cap-5)
```

Five tokens at t=0 means we can serve five events instantly (the "burst"). After the burst, the bucket refills at the configured rate. This is the difference between token bucket and leaky bucket: token bucket allows the initial burst, leaky bucket does not.

### Comparative latency chart

```
event arrival:    | | |    |        |
                  +0 +1 +2 +6       +11

trailing debounce 300ms:
  fires at +6+300=+306 (one fire only)

leading debounce 300ms:
  fires at +0 and +6+300=+306 (well, leading fires at +0 only if quiet preceded)

leading throttle 300ms:
  fires at +0, +6, +11 (each respects the 300ms cooldown from the previous fire)

trailing throttle 300ms (ticker):
  fires at +300, +600, +900, +1200 (regular grid; one event per slot, latest in slot)
```

Read this chart twice; it captures the actual behavioural differences between the four variants on the same input.

---

## A guided rebuild from first principles

If everything above feels like a lot, it helps to rebuild the patterns from scratch in tiny steps. Let us start with the simplest possible "rate-limited print" and work upward.

### Step 1: print all events

```go
package main

import "fmt"

func main() {
    events := []string{"a", "b", "c", "d", "e"}
    for _, e := range events {
        fmt.Println(e)
    }
}
```

No rate limiting. Five lines of output, instant.

### Step 2: pace with sleep

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    events := []string{"a", "b", "c", "d", "e"}
    for _, e := range events {
        fmt.Println(e)
        time.Sleep(200 * time.Millisecond)
    }
}
```

Still all five events, but spaced. Total runtime ~1 second.

### Step 3: enforce a rate even when events come from somewhere else

In step 2 we own the loop. In real systems events arrive on a channel from a different goroutine. The pacing has to live in the consumer.

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    events := make(chan string, 10)
    go func() {
        for _, e := range []string{"a", "b", "c", "d", "e"} {
            events <- e
        }
        close(events)
    }()

    last := time.Time{}
    for e := range events {
        if !last.IsZero() && time.Since(last) < 200*time.Millisecond {
            time.Sleep(200*time.Millisecond - time.Since(last))
        }
        fmt.Println(e)
        last = time.Now()
    }
}
```

This is a blocking, lossless throttle written in 15 lines. Every event eventually prints, but no two within 200ms of each other. The consumer absorbs the rate-limiting work.

### Step 4: switch to drop instead of block

```go
last := time.Time{}
for e := range events {
    if !last.IsZero() && time.Since(last) < 200*time.Millisecond {
        continue
    }
    fmt.Println(e)
    last = time.Now()
}
```

One line changed. Now events arriving in the cooldown are dropped. This is the basis of `Limiter.Allow` from earlier.

### Step 5: switch to debounce

What if instead of "every event must be printed eventually" we want "only print the last event in any burst of events arriving within 200ms of each other"?

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    events := make(chan string, 10)
    go func() {
        for _, e := range []string{"a", "b", "c", "d", "e"} {
            events <- e
            time.Sleep(50 * time.Millisecond)
        }
        close(events)
    }()

    var pending string
    var hasPending bool
    var timer *time.Timer
    var tc <-chan time.Time
    for {
        select {
        case e, ok := <-events:
            if !ok {
                if hasPending {
                    fmt.Println(pending)
                }
                return
            }
            pending = e
            hasPending = true
            if timer == nil {
                timer = time.NewTimer(200 * time.Millisecond)
            } else {
                if !timer.Stop() {
                    select { case <-timer.C: default: }
                }
                timer.Reset(200 * time.Millisecond)
            }
            tc = timer.C
        case <-tc:
            if hasPending {
                fmt.Println(pending)
                hasPending = false
            }
            tc = nil
        }
    }
}
```

This prints `e` exactly once. The five events arrived within 250ms total, all within 200ms windows of each other, so the trailing debounce coalesces them into the last value.

The difference between Step 4 (throttle, drop) and Step 5 (debounce) is the *structure* of the wait. Throttle ignores events during the cooldown; debounce restarts the cooldown on every event.

### Step 6: from main into a reusable function

Lift the loop out of `main` into a generic helper. That is exactly what `DebounceCh` from earlier does.

This six-step rebuild is the entire skill at junior level: recognise which problem you have, pick the matching shape of code, and wire it into the system.

---

## Extended discussion: when the event payload is not just a string

Real events carry more than a single value. They may be structs with timestamps, IDs, sources, weights. A debouncer has to decide *which* event wins when collapsing a burst.

### Policy: keep the latest

The default. Replace `pending` on every event. This is right for "save the current state" or "search the latest query".

```go
pending = newEvent
```

### Policy: keep the first

The leading-debounce style. Once `pending` is set, do not overwrite. Reset only after the fire.

```go
if !hasPending {
    pending = newEvent
    hasPending = true
}
```

### Policy: combine

Sometimes you want to merge events — sum metrics, union sets, append IDs. The debouncer becomes a small reducer:

```go
pending = combine(pending, newEvent)
hasPending = true
```

This generalises into `Coalescer[T]` patterns we will explore in `senior.md` and `optimize.md`. The key insight: the debouncer is no longer just "the last wins"; it is a *fold* over the burst, fired at quiet time.

### Policy: filter

If an event during the burst makes the pending event obsolete (e.g. "delete" supersedes a pending "update"), the debouncer may reset `pending` to `nil` and abort the burst:

```go
if newEvent.IsTerminal {
    pending = newEvent
    fireImmediately()
    return
}
```

This is a leading variant; the rest of the burst is silenced.

For junior code, "keep the latest" is the right default. Anything fancier deserves a clear name and a comment.

---

## Extended discussion: testing time-based code

Time-based code is notoriously hard to test. A naive test runs in real wall-clock time:

```go
func TestDebounce(t *testing.T) {
    d := New(100 * time.Millisecond, fn)
    d.Trigger()
    time.Sleep(150 * time.Millisecond)
    // assert fn was called once
}
```

This works but is **slow** and **flaky**. A whole test suite of these takes seconds when it should take milliseconds, and on a busy CI runner the sleep may not be long enough.

Better approaches:

### Approach A: shorten the window in tests

```go
const debounceWindow = 100 * time.Millisecond
```

In tests, set this to `1 * time.Millisecond`. Real production code uses the full window; the test sees the same logic at a thousand times the speed.

### Approach B: inject a clock

Define a `Clock` interface and pass it in:

```go
type Clock interface {
    Now() time.Time
    AfterFunc(d time.Duration, f func()) Timer
}

type Timer interface {
    Stop() bool
    Reset(d time.Duration) bool
}
```

In tests, supply a fake clock you can advance manually. The `github.com/benbjohnson/clock` library implements exactly this and is widely used. We will not require it at junior level, but you will see it in `professional.md`.

### Approach C: integration tests with shorter intervals

For "does the wiring work" tests, the real clock with a 10ms window is acceptable. Add `t.Parallel()` and run several at once to absorb the cost.

### Approach D: race detector

Always run debounce/throttle tests with `-race`. The patterns are exactly the kind that surface concurrency bugs.

```sh
go test -race -count=20 ./...
```

The `-count=20` flag re-runs every test 20 times, which surfaces flaky races that pass on one out of ten attempts.

---

## Comparing to JavaScript and Python conventions

If you are coming from a JS background, you know `lodash.debounce` and `lodash.throttle`. They have signatures like `debounce(fn, wait, { leading, trailing, maxWait })`. The Go equivalents are:

- `lodash.debounce` ≈ our `New(wait, fn)` with policy flags
- `lodash.throttle` ≈ our `Throttle` channel-stage helper
- `lodash.debounce.cancel()` ≈ our `Close()` method on the debouncer
- `lodash.debounce.flush()` ≈ a "fire pending now" method (not in our junior examples, in `middle.md`)

JS implementations rely on `setTimeout` which is conceptually similar to `AfterFunc` — both schedule a single deferred call. The big difference is concurrency: in JS the timer callback runs on the event loop thread; in Go the callback runs on its own goroutine. Go programmers therefore have to think about racing on shared state.

Python's `asyncio` has `loop.call_later` which is the close analogue. Frameworks like `aiohttp` and `Quart` ship debouncers built on it. The structure is identical — schedule a single deferred call, replace it on every event — and the bugs are identical too.

---

## Mini-cookbook: ten one-liners

1. Stop a ticker on function exit: `defer t.Stop()`
2. Disable a select branch: `tc = nil`
3. Drain a timer channel after Stop-false: `select { case <-t.C: default: }`
4. Read time only once per loop: `now := time.Now()` then reuse
5. Wait or exit on context: `select { case <-tick.C: case <-ctx.Done(): return }`
6. Schedule a one-shot fire: `time.AfterFunc(d, fn)`
7. Reset an AfterFunc-like timer: `t.Reset(d)`
8. Compare durations safely: `now.Sub(prev) >= interval`
9. Buffered single-slot channel for latest-wins: `make(chan T, 1)`
10. Generic debouncer signature: `func Debounce[T any](ctx context.Context, in <-chan T, wait time.Duration) <-chan T`

Memorise these and 80% of debounce/throttle code becomes muscle memory.

---

## A longer worked example: the keyboard buffer

Suppose you wire a real keyboard input source — a terminal — into your program. The user types `git status` and presses Enter. Without intervention you get nine separate events (`g`, `i`, `t`, space, `s`, ...). For most CLIs this is fine; for ones that auto-complete on every keystroke it is not.

Here is a complete program that buffers keystrokes, fires a "command preview" every 100ms of quiet, and a final fire on Enter.

```go
package main

import (
    "bufio"
    "context"
    "fmt"
    "os"
    "time"
)

type keyEvent struct {
    rune rune
    enter bool
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    in := make(chan keyEvent, 64)
    go readKeys(ctx, in)
    handleKeys(ctx, in)
}

func readKeys(ctx context.Context, out chan<- keyEvent) {
    defer close(out)
    r := bufio.NewReader(os.Stdin)
    for {
        c, _, err := r.ReadRune()
        if err != nil {
            return
        }
        select {
        case out <- keyEvent{rune: c, enter: c == '\n'}:
        case <-ctx.Done():
            return
        }
    }
}

func handleKeys(ctx context.Context, in <-chan keyEvent) {
    var buf []rune
    var timer *time.Timer
    var tc <-chan time.Time
    for {
        select {
        case <-ctx.Done():
            return
        case ev, ok := <-in:
            if !ok {
                return
            }
            if ev.enter {
                fmt.Printf("COMMAND: %q\n", string(buf))
                buf = buf[:0]
                if timer != nil {
                    timer.Stop()
                }
                tc = nil
                continue
            }
            buf = append(buf, ev.rune)
            if timer == nil {
                timer = time.NewTimer(100 * time.Millisecond)
            } else {
                if !timer.Stop() {
                    select { case <-timer.C: default: }
                }
                timer.Reset(100 * time.Millisecond)
            }
            tc = timer.C
        case <-tc:
            fmt.Printf("PREVIEW: %q\n", string(buf))
            tc = nil
        }
    }
}
```

Run it and type a few words. You will see `PREVIEW: "hello"` after 100ms of typing-then-pause, and `COMMAND: "hello world"` when you press Enter. This is a real, working trailing-debounce around an event stream.

The pattern generalises: anything that emits "incremental updates separated by pauses" can use this template. Editors with linting, search-as-you-type, IDE autocomplete, live preview — they all run on this skeleton.

---

## A second worked example: protecting a tiny API

Suppose you wrap a third-party API that limits you to 5 requests per second. You write a `Client` with a `Get` method. Without throttling, a burst of concurrent goroutines exceeds the limit and you get 429 responses.

```go
package apiclient

import (
    "context"
    "io"
    "net/http"
    "time"
)

type Client struct {
    base string
    http *http.Client
    tick *time.Ticker
}

func New(base string) *Client {
    return &Client{
        base: base,
        http: &http.Client{Timeout: 10 * time.Second},
        tick: time.NewTicker(200 * time.Millisecond), // 5 rps
    }
}

func (c *Client) Get(ctx context.Context, path string) ([]byte, error) {
    select {
    case <-c.tick.C:
    case <-ctx.Done():
        return nil, ctx.Err()
    }
    req, err := http.NewRequestWithContext(ctx, "GET", c.base+path, nil)
    if err != nil {
        return nil, err
    }
    resp, err := c.http.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    return io.ReadAll(resp.Body)
}

func (c *Client) Close() {
    c.tick.Stop()
}
```

Every call to `Get` waits for the next tick. With a 200ms tick this caps the call rate at 5 per second across the whole `Client`. If two goroutines call `Get` simultaneously, they queue on `c.tick.C` and one waits for the next tick.

This is the simplest correct throttle for an outbound API client. It does not allow bursts (no token bucket), it does not handle per-endpoint quotas (no per-path tracking), it does not gracefully degrade on 429 (no backoff). All those are `middle.md` and `senior.md` topics. But the skeleton is exactly what you would extend.

---

## A third worked example: the cancellable debounce

You want a debounce that can be cancelled mid-burst. The simplest implementation adds a `Cancel` method:

```go
package debounce

import (
    "sync"
    "time"
)

type Cancellable struct {
    mu    sync.Mutex
    wait  time.Duration
    fn    func()
    timer *time.Timer
}

func NewCancellable(wait time.Duration, fn func()) *Cancellable {
    return &Cancellable{wait: wait, fn: fn}
}

func (d *Cancellable) Trigger() {
    d.mu.Lock()
    defer d.mu.Unlock()
    if d.timer != nil {
        d.timer.Stop()
    }
    d.timer = time.AfterFunc(d.wait, d.fn)
}

func (d *Cancellable) Cancel() {
    d.mu.Lock()
    defer d.mu.Unlock()
    if d.timer != nil {
        d.timer.Stop()
        d.timer = nil
    }
}
```

This is the same `Debouncer` as before plus a `Cancel`. The semantics: after `Cancel`, no pending fire will occur until the next `Trigger`.

Use cases:

- A modal dialog opens during a search. While the modal is open, cancel the pending search debouncer because the user has moved on.
- A user logs out. Cancel all per-user debouncers in the system.
- A test is wrapping up. Cancel any background work to avoid leaks.

A subtle question: if `Cancel` races with the timer firing, the fire might happen anyway. The `Stop` call returns false in that case. Our simple version accepts that race; production code would track a "cancelled" flag and check it inside `fn`.

---

## A final note on naming

In real codebases you will see these patterns under many names: "debouncer", "coalescer", "deduper", "trailing-edge collapser". Throttles are sometimes called "rate limiters", "pacers", or "regulators". When in doubt:

- If the artifact's job is to *wait for silence and emit the last*, call it a debouncer.
- If the artifact's job is to *enforce a maximum rate*, call it a throttle or limiter.
- If the artifact combines multiple events into one delivered value, "coalescer" is a fine alternative to debouncer.

Avoid clever names like `EventGuard`, `EventPolice`, `TrafficCop`. Future-you will not remember which one was the debounce.

---

That is the junior-level material. Read it through, run the examples, and only then proceed to `middle.md` where leading/trailing variants, `rate.Limiter`, and real input streams take over.

---

## Appendix A: A library of small variations

The patterns in this file all derive from the same skeleton. Below are a dozen small variants that you will encounter or want to write.

### A1: Debounce that returns the count of coalesced events

Sometimes the consumer wants to know "how many events were combined into this one fire?":

```go
package debounce

import (
    "sync"
    "time"
)

type CountingDebouncer struct {
    mu    sync.Mutex
    wait  time.Duration
    fn    func(count int)
    count int
    timer *time.Timer
}

func NewCounting(wait time.Duration, fn func(int)) *CountingDebouncer {
    return &CountingDebouncer{wait: wait, fn: fn}
}

func (d *CountingDebouncer) Trigger() {
    d.mu.Lock()
    d.count++
    if d.timer != nil {
        d.timer.Stop()
    }
    d.timer = time.AfterFunc(d.wait, d.fire)
    d.mu.Unlock()
}

func (d *CountingDebouncer) fire() {
    d.mu.Lock()
    n := d.count
    d.count = 0
    d.mu.Unlock()
    if n > 0 {
        d.fn(n)
    }
}
```

The output is "I have seen N events in this burst; here is the count". Useful for "user clicked the button N times rapidly" telemetry.

### A2: Debounce that emits the first and last events

Leading + trailing combined:

```go
type LeadingTrailing struct {
    mu      sync.Mutex
    wait    time.Duration
    onFirst func()
    onLast  func()
    inBurst bool
    timer   *time.Timer
}

func (d *LeadingTrailing) Trigger() {
    d.mu.Lock()
    defer d.mu.Unlock()
    if !d.inBurst {
        d.inBurst = true
        d.onFirst()
    }
    if d.timer != nil {
        d.timer.Stop()
    }
    d.timer = time.AfterFunc(d.wait, d.fire)
}

func (d *LeadingTrailing) fire() {
    d.mu.Lock()
    d.inBurst = false
    d.mu.Unlock()
    d.onLast()
}
```

The first event in any burst fires `onFirst`; the trailing edge fires `onLast`. UI buttons use this combination to show instant feedback ("submitting...") and a final reconcile ("submitted!").

### A3: Throttle with a per-event hash

Sometimes you want to throttle per *kind* of event but allow different kinds through independently. The trick is a `map[Kind]time.Time`:

```go
type Multi struct {
    mu       sync.Mutex
    interval time.Duration
    last     map[string]time.Time
}

func NewMulti(interval time.Duration) *Multi {
    return &Multi{interval: interval, last: make(map[string]time.Time)}
}

func (m *Multi) Allow(key string) bool {
    m.mu.Lock()
    defer m.mu.Unlock()
    now := time.Now()
    if prev, ok := m.last[key]; ok && now.Sub(prev) < m.interval {
        return false
    }
    m.last[key] = now
    return true
}
```

Each key has its own cooldown. Useful for "max 1 'connection refused' log per host per minute". The map grows unbounded; a real implementation would expire old keys. We will tighten this up in `senior.md`.

### A4: Debounce with maxWait (the underscore-debounce flavor)

In lodash, `debounce(fn, wait, { maxWait })` forces a fire if the burst lasts longer than `maxWait`, regardless of quiet:

```go
type WithMaxWait struct {
    mu       sync.Mutex
    wait     time.Duration
    maxWait  time.Duration
    fn       func()
    timer    *time.Timer
    firstAt  time.Time
}

func (d *WithMaxWait) Trigger() {
    d.mu.Lock()
    defer d.mu.Unlock()
    now := time.Now()
    if d.firstAt.IsZero() {
        d.firstAt = now
    }
    if d.timer != nil {
        d.timer.Stop()
    }
    remaining := d.maxWait - now.Sub(d.firstAt)
    if remaining < 0 {
        remaining = 0
    }
    use := d.wait
    if remaining < use {
        use = remaining
    }
    d.timer = time.AfterFunc(use, d.fire)
}

func (d *WithMaxWait) fire() {
    d.mu.Lock()
    d.firstAt = time.Time{}
    d.mu.Unlock()
    d.fn()
}
```

This guarantees the fire happens within `maxWait` of the *first* event in a burst, even if events keep arriving. Useful for "save at least every 5 seconds" semantics.

### A5: Throttle that returns time-to-wait

Instead of `Allow() bool`, expose `Reserve() time.Duration`:

```go
func (l *Limiter) Reserve() time.Duration {
    l.mu.Lock()
    defer l.mu.Unlock()
    now := time.Now()
    next := l.last.Add(l.interval)
    if now.After(next) {
        l.last = now
        return 0
    }
    l.last = next
    return next.Sub(now)
}
```

Callers can use the returned duration to either `time.Sleep(d)` or `select { case <-time.After(d): }`. This matches the `rate.Limiter.Reserve` API we will encounter in `middle.md`.

### A6: Debounce that uses an existing timer

For very high-frequency triggers, reusing a single `time.Timer` avoids allocations:

```go
type Reusing struct {
    mu    sync.Mutex
    wait  time.Duration
    fn    func()
    timer *time.Timer
    armed bool
}

func NewReusing(wait time.Duration, fn func()) *Reusing {
    d := &Reusing{wait: wait, fn: fn}
    d.timer = time.NewTimer(wait)
    if !d.timer.Stop() {
        <-d.timer.C
    }
    go d.loop()
    return d
}

func (d *Reusing) loop() {
    for range d.timer.C {
        d.mu.Lock()
        d.armed = false
        d.mu.Unlock()
        d.fn()
    }
}

func (d *Reusing) Trigger() {
    d.mu.Lock()
    defer d.mu.Unlock()
    if d.armed {
        if !d.timer.Stop() {
            select { case <-d.timer.C: default: }
        }
    }
    d.timer.Reset(d.wait)
    d.armed = true
}
```

This allocates the timer once and reuses it forever. The trade-off is more complexity in the code. For most use cases the simple `AfterFunc` allocator-friendly version is better.

### A7: Throttle that allows configurable initial burst

The basic throttle has a "burst of 1". A throttle that lets through 5 events before pacing is a token bucket of size 5:

```go
type Bucket struct {
    mu       sync.Mutex
    capacity int
    refill   time.Duration
    tokens   int
    last     time.Time
}

func NewBucket(capacity int, refill time.Duration) *Bucket {
    return &Bucket{capacity: capacity, refill: refill, tokens: capacity, last: time.Now()}
}

func (b *Bucket) Allow() bool {
    b.mu.Lock()
    defer b.mu.Unlock()
    now := time.Now()
    elapsed := now.Sub(b.last)
    add := int(elapsed / b.refill)
    if add > 0 {
        b.tokens += add
        if b.tokens > b.capacity {
            b.tokens = b.capacity
        }
        b.last = b.last.Add(time.Duration(add) * b.refill)
    }
    if b.tokens > 0 {
        b.tokens--
        return true
    }
    return false
}
```

Start with `capacity` tokens. Every `refill` duration adds one token, up to `capacity`. Each event consumes one. This is the algorithm behind `golang.org/x/time/rate.Limiter`, simplified. We will use the real `rate.Limiter` in `middle.md` and explain the math in `senior.md`.

### A8: Throttle that adapts to backpressure

A clever throttle observes downstream latency and adjusts. If the consumer is slow, slow down:

```go
type Adaptive struct {
    mu        sync.Mutex
    minDelay  time.Duration
    maxDelay  time.Duration
    cur       time.Duration
    lastFire  time.Time
}

func (a *Adaptive) Allow(downstreamLatency time.Duration) bool {
    a.mu.Lock()
    defer a.mu.Unlock()
    now := time.Now()
    if now.Sub(a.lastFire) < a.cur {
        return false
    }
    a.lastFire = now
    if downstreamLatency > 500*time.Millisecond {
        a.cur = a.cur * 2
        if a.cur > a.maxDelay {
            a.cur = a.maxDelay
        }
    } else {
        a.cur = a.cur * 9 / 10
        if a.cur < a.minDelay {
            a.cur = a.minDelay
        }
    }
    return true
}
```

This is a sketch of AIMD-style (additive increase, multiplicative decrease) throttle adaptation. Real implementations are subtle; we will revisit them in `professional.md`.

### A9: Debounce that delivers to a channel

Some consumers prefer "wait on a channel until the next fire" over "supply a callback". The signature changes but the logic is the same:

```go
type Chan[T any] struct {
    mu      sync.Mutex
    wait    time.Duration
    out     chan T
    pending T
    has     bool
    timer   *time.Timer
}

func NewChan[T any](wait time.Duration) *Chan[T] {
    return &Chan[T]{wait: wait, out: make(chan T, 1)}
}

func (d *Chan[T]) Trigger(v T) {
    d.mu.Lock()
    d.pending = v
    d.has = true
    if d.timer != nil {
        d.timer.Stop()
    }
    d.timer = time.AfterFunc(d.wait, d.fire)
    d.mu.Unlock()
}

func (d *Chan[T]) fire() {
    d.mu.Lock()
    v := d.pending
    had := d.has
    d.has = false
    d.mu.Unlock()
    if had {
        select {
        case d.out <- v:
        default:
        }
    }
}

func (d *Chan[T]) Out() <-chan T { return d.out }
```

The non-blocking send in `fire` is important: if the consumer is slow, we do not want the timer goroutine to block. We drop instead. Production code might use a different policy.

### A10: Throttle bounded by a wait group

If you want to fire N events concurrently but pace their *start*:

```go
type Concurrent struct {
    sem chan struct{}
    tick *time.Ticker
}

func NewConcurrent(maxConcurrent int, interval time.Duration) *Concurrent {
    return &Concurrent{
        sem:  make(chan struct{}, maxConcurrent),
        tick: time.NewTicker(interval),
    }
}

func (c *Concurrent) Do(ctx context.Context, fn func()) error {
    select {
    case c.sem <- struct{}{}:
    case <-ctx.Done():
        return ctx.Err()
    }
    select {
    case <-c.tick.C:
    case <-ctx.Done():
        <-c.sem
        return ctx.Err()
    }
    go func() {
        defer func() { <-c.sem }()
        fn()
    }()
    return nil
}
```

This is "pace the starts to 1 per interval, but only allow `maxConcurrent` in flight at once". Two layers of rate-limiting. It is the shape of a real worker pool.

---

## Appendix B: when not to use debounce or throttle

These tools are not always the right answer. Some situations call for different patterns.

### B1: when you need exact counting

Debounce drops intermediate events. If you need to count *all* clicks, do not debounce. Use a counter that accumulates and a separate periodic flusher.

### B2: when ordering matters strictly

Throttle may drop or queue events. If event order is essential (audit logs, financial transactions), use a queue with backpressure, not a throttle.

### B3: when events are not idempotent

Debounce assumes the last event represents the desired state. If each event causes a side effect that cannot be skipped (sending an email, charging a card), debouncing is wrong. Use a queue with deduplication or a state machine.

### B4: when the consumer is the bottleneck

If your downstream cannot keep up, no amount of throttling on input will help — you will just queue forever. Diagnose downstream first.

### B5: when you can change the producer

Sometimes the producer can be fixed at the source. A websocket emitting too many frames may have a configurable batching window on its end. Pushing the fix upstream is usually better than absorbing it downstream.

### B6: when an existing library will do

`golang.org/x/time/rate.Limiter` is excellent. Reach for it before writing your own. `golang.org/x/sync/singleflight` deduplicates concurrent calls. `golang.org/x/sync/errgroup` handles fan-out with errors. Use the libraries when they fit.

---

## Appendix C: a glossary of "ish" words

People use words inconsistently. Here is a guide to the synonyms.

- **Debounce / coalesce / deduplicate-in-window**: same idea — collapse a burst into one event.
- **Throttle / rate-limit / pace / regulate**: same idea — cap output frequency.
- **Drop / discard / shed**: same idea — refuse an event when over-limit.
- **Block / queue / wait / backpressure**: same idea — make the sender wait.
- **Window / interval / period / tick**: same idea — the time unit of the limit.
- **Burst / capacity / depth**: the maximum number of events allowed in quick succession by a token bucket.
- **Refill / rate / leak rate**: the steady-state rate of a token or leaky bucket.
- **Leading / front / start**: fire on the first event of a burst.
- **Trailing / back / end**: fire on the last event of a burst.

The Go standard library is fairly consistent: `rate.Limiter`, `time.Ticker`, `time.AfterFunc`. The bigger ecosystem is not — when reading an unfamiliar codebase, expect names like `Pulser`, `Coalescer`, `Regulator`, `Pacer`, `Limiter`, `Gateway`, `Filter`, `Sampler`, all referring to the same underlying patterns.

---

## Appendix D: a final flashcard set

Memorise these one-liners; they will carry you through interviews and code reviews.

1. *Debounce waits for silence; throttle watches the clock.*
2. *Trailing debounce delivers the last event; leading debounce delivers the first.*
3. *Lossy throttle drops; lossless throttle queues or blocks.*
4. *Token bucket allows bursts; leaky bucket does not.*
5. *`time.AfterFunc` for fire-once; `time.Ticker` for fire-many.*
6. *Always `defer t.Stop()` on tickers.*
7. *Always handle `ctx.Done()` in long-lived goroutines.*
8. *A nil channel in select is never ready — use it to disable branches.*
9. *Stop-then-drain before `Reset` on Go versions before 1.23.*
10. *Per-actor isolation needs `map[Actor]*Limiter`.*

---

End of `junior.md`. Total reading time at a comfortable pace: about forty minutes. Total time to internalise enough to write the patterns by heart: about a week of practice. Move on to `middle.md` when you can write the trailing debouncer from scratch without looking.

---

## Appendix E: a small but realistic chat-app example

Let us put the patterns to work in a slightly larger scenario. Imagine a chat client. The user types a message. Three behaviours should happen:

1. The "is typing..." indicator is sent to peers, but no more often than once per two seconds (throttle).
2. The draft is autosaved to local storage, but only one second after the user stops typing (debounce).
3. The send-button is enabled the moment the user types the first character (leading debounce, sort of).

```go
package chat

import (
    "context"
    "sync"
    "time"
)

type Composer struct {
    mu sync.Mutex
    isTypingLast time.Time
    typingInterval time.Duration
    saveDebouncer *Debouncer
    sendEnabled   bool
    onTyping func()
    onSave   func(draft string)
    onEnable func()
    draft string
}

func NewComposer(onTyping func(), onSave func(string), onEnable func()) *Composer {
    c := &Composer{
        typingInterval: 2 * time.Second,
        onTyping: onTyping,
        onSave:   onSave,
        onEnable: onEnable,
    }
    c.saveDebouncer = New(1*time.Second, func() {
        c.mu.Lock()
        draft := c.draft
        c.mu.Unlock()
        onSave(draft)
    })
    return c
}

func (c *Composer) Keystroke(s string) {
    c.mu.Lock()
    c.draft = s
    if !c.sendEnabled && s != "" {
        c.sendEnabled = true
        c.onEnable()
    }
    now := time.Now()
    fireTyping := c.isTypingLast.IsZero() || now.Sub(c.isTypingLast) >= c.typingInterval
    if fireTyping {
        c.isTypingLast = now
    }
    c.mu.Unlock()
    if fireTyping {
        c.onTyping()
    }
    c.saveDebouncer.Trigger()
}

func (c *Composer) Close() {
    c.saveDebouncer.timer.Stop()
}
```

Three patterns in one struct:

- **Leading-edge "enable"**: fires once when the draft transitions from empty to non-empty. Subsequent keystrokes with non-empty draft do nothing.
- **Leading-edge throttle for typing indicator**: at most one "is typing" event per two seconds.
- **Trailing-edge debounce for autosave**: one autosave one second after the last keystroke.

Real chat apps are richer than this, but the bones are exactly right.

---

## Appendix F: pitfalls when integrating with HTTP middleware

A common application of throttling is HTTP middleware. The skeleton:

```go
func RateLimitMiddleware(rps int) func(http.Handler) http.Handler {
    interval := time.Second / time.Duration(rps)
    var mu sync.Mutex
    last := time.Time{}
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            mu.Lock()
            now := time.Now()
            if !last.IsZero() && now.Sub(last) < interval {
                mu.Unlock()
                http.Error(w, "rate limit", http.StatusTooManyRequests)
                return
            }
            last = now
            mu.Unlock()
            next.ServeHTTP(w, r)
        })
    }
}
```

This is a global rate limit. It has two big problems and one subtler one.

**Problem 1**: it does not distinguish between clients. One noisy client can block everyone else. Real middleware should key on IP, user, or API key.

**Problem 2**: it is "lossy leading throttle" — first request wins, rest 429'd. Some products want lossless (queue and serve when ready). The right policy is product-specific.

**Subtler problem**: the mutex is a contention point. At high throughput it serialises all requests through one lock. A real middleware should use `sync/atomic` or per-shard locks.

We will revisit these in `senior.md` and `professional.md`. The lesson at junior level: do not deploy a one-line rate-limiter as middleware on a production server. It will work and it will subtly fail.

---

## Appendix G: a checklist before merging debounce/throttle code

Before pushing a PR that introduces or changes a debouncer or throttler, run through this list:

- [ ] Does the goroutine accept `context.Context` for cancellation?
- [ ] Is `defer ticker.Stop()` present everywhere a ticker is created?
- [ ] Does the debouncer have a `Close` method that stops the timer?
- [ ] Is the public API documented with units and policy (leading? trailing? drop? block?)?
- [ ] Are tests run with `-race -count=20`?
- [ ] Is the bucket capacity / debounce window a configurable constant, not a magic number?
- [ ] Does the test cover the "burst" case (events within the window)?
- [ ] Does the test cover the "quiet" case (events spaced beyond the window)?
- [ ] Does the test cover the "close while pending" case?
- [ ] Does the test cover the "context cancel while pending" case?
- [ ] If a global mutex is used, has its contention been benchmarked?
- [ ] If a map is used (per-key throttling), is there an eviction policy?
- [ ] Does the metric/log subsystem record how often the throttle dropped or rejected?

A 30-second pass over this list catches 90% of "this looks fine, ship it" mistakes.

---

## Appendix H: a glossary of micro-bugs

Names for the small bugs you will hit so you can talk about them with colleagues:

- *The forgotten Stop*: a timer is never stopped; the fn fires after the owner closes.
- *The stale fire*: after `Stop`-false the `timer.C` was not drained, and the next `Reset` delivers an immediate fire.
- *The leaky tick*: `time.Tick` (no `New`) used in a goroutine; the ticker leaks.
- *The captured iteration*: a `for _, v := range` body closure on `v` runs after the loop and sees the last value (pre-Go-1.22).
- *The naked panic*: `time.AfterFunc(..., func() { /* something risky */ })` without `recover` brings the whole program down.
- *The forgotten cancel*: a goroutine without `ctx.Done()` runs forever.
- *The double fire*: a `Trigger` and a near-simultaneous `Stop`-then-`Reset` produces two `fn` calls.
- *The starving sender*: a blocking throttle whose downstream is slow blocks senders until they time out.
- *The runaway map*: per-key map of limiters grows without bound; eventual OOM.
- *The slow ticker*: tick interval shorter than `fn` duration causes the ticker to drop ticks silently.
- *The first-event delay*: a trailing throttle adds up to one interval of latency on first event.
- *The misaligned window*: a wall-clock-aligned throttle aggregates differently from a monotonic-aligned one across clock skew.

Knowing the names helps you recognise the bugs faster in code review.

---

## Appendix I: one last worked example with full tests

To round out the file, here is a complete, tested debouncer with both `Trigger` and `Flush` (immediate fire) operations. This is roughly the scope of what `middle.md` will formalise.

```go
package debounce

import (
    "sync"
    "time"
)

type WithFlush struct {
    mu      sync.Mutex
    wait    time.Duration
    fn      func()
    timer   *time.Timer
    pending bool
}

func NewWithFlush(wait time.Duration, fn func()) *WithFlush {
    return &WithFlush{wait: wait, fn: fn}
}

func (d *WithFlush) Trigger() {
    d.mu.Lock()
    defer d.mu.Unlock()
    d.pending = true
    if d.timer != nil {
        d.timer.Stop()
    }
    d.timer = time.AfterFunc(d.wait, d.fire)
}

func (d *WithFlush) Flush() {
    d.mu.Lock()
    had := d.pending
    d.pending = false
    if d.timer != nil {
        d.timer.Stop()
        d.timer = nil
    }
    d.mu.Unlock()
    if had {
        d.fn()
    }
}

func (d *WithFlush) Close() {
    d.mu.Lock()
    defer d.mu.Unlock()
    d.pending = false
    if d.timer != nil {
        d.timer.Stop()
        d.timer = nil
    }
}

func (d *WithFlush) fire() {
    d.mu.Lock()
    had := d.pending
    d.pending = false
    d.mu.Unlock()
    if had {
        d.fn()
    }
}
```

With tests:

```go
package debounce

import (
    "sync/atomic"
    "testing"
    "time"
)

func TestWithFlush_FlushFiresImmediately(t *testing.T) {
    var hits int32
    d := NewWithFlush(time.Second, func() { atomic.AddInt32(&hits, 1) })
    d.Trigger()
    d.Flush()
    if got := atomic.LoadInt32(&hits); got != 1 {
        t.Fatalf("flush should fire once, got %d", got)
    }
}

func TestWithFlush_FlushAfterFireIsNoop(t *testing.T) {
    var hits int32
    d := NewWithFlush(50*time.Millisecond, func() { atomic.AddInt32(&hits, 1) })
    d.Trigger()
    time.Sleep(100 * time.Millisecond)
    d.Flush()
    if got := atomic.LoadInt32(&hits); got != 1 {
        t.Fatalf("flush after fire should be no-op, got %d hits", got)
    }
}

func TestWithFlush_CloseSuppressesFire(t *testing.T) {
    var hits int32
    d := NewWithFlush(50*time.Millisecond, func() { atomic.AddInt32(&hits, 1) })
    d.Trigger()
    d.Close()
    time.Sleep(100 * time.Millisecond)
    if got := atomic.LoadInt32(&hits); got != 0 {
        t.Fatalf("close should suppress fire, got %d", got)
    }
}
```

All three tests cover one important semantic each. Add a fourth for "Trigger after Close":

```go
func TestWithFlush_TriggerAfterCloseStillWorks(t *testing.T) {
    var hits int32
    d := NewWithFlush(50*time.Millisecond, func() { atomic.AddInt32(&hits, 1) })
    d.Trigger()
    d.Close()
    d.Trigger() // should re-arm
    time.Sleep(100 * time.Millisecond)
    if got := atomic.LoadInt32(&hits); got != 1 {
        t.Fatalf("Trigger after Close should re-arm, got %d", got)
    }
}
```

This is the level of detail you should aim for in production tests. Each behaviour is one test, each test is short, and the suite catches regressions.

---

## Appendix J: thinking about debounce/throttle in interview prep

A common interview question: "implement a debouncer in Go". Here is the answer you should give, in five steps, talking aloud:

1. "Debouncer wraps a function to fire only after a quiet period."
2. "I will use `time.AfterFunc` because it gives me a one-shot timer with built-in goroutine."
3. "I'll keep the timer in a struct under a mutex so `Trigger` is safe from multiple goroutines."
4. "Every `Trigger` stops the old timer if any and schedules a new one."
5. "I'll add `Cancel` to stop the timer without firing, and `Flush` to fire immediately."

Code it up live; expect about 30 lines. The interviewer will probe for:

- Race conditions (mutex)
- Cancellation (Cancel method)
- The Stop-then-drain dance (mention you know it but `AfterFunc` doesn't need it)
- Tests (write one for `Trigger`-burst and one for `Cancel`)
- Generics (offer to make the payload generic if asked)

If you can do this in 15 minutes you are well prepared. The same drill works for throttle.

---

End of all appendices. With everything above you have ~3000 lines of grounding in debounce and throttle. The next file, `middle.md`, builds the leading/trailing variants, `golang.org/x/time/rate`, and a real input-stream pipeline.

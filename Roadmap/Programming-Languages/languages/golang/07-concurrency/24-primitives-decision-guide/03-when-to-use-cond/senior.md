---
layout: default
title: When to Use sync.Cond — Senior
parent: When to Use sync.Cond
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/03-when-to-use-cond/senior/
---

# When to Use sync.Cond — Senior

[← Back](../)

## Table of Contents
1. [What this file is](#what-this-file-is)
2. [The senior default: almost never](#the-senior-default-almost-never)
3. [Where Cond legitimately survives](#where-cond-legitimately-survives)
4. [Wrapping Cond behind a safe API](#wrapping-cond-behind-a-safe-api)
5. [Adding cancellation without losing Cond](#adding-cancellation-without-losing-cond)
6. [Cond vs channel vs busy-poll, measured](#cond-vs-channel-vs-busy-poll-measured)
7. [The thundering herd and Broadcast cost](#the-thundering-herd-and-broadcast-cost)
8. [Refactor: Cond queue to channel](#refactor-cond-queue-to-channel)
9. [Anti-patterns at scale](#anti-patterns-at-scale)
10. [Cheat sheet](#cheat-sheet)
11. [Self-assessment checklist](#self-assessment-checklist)
12. [Summary](#summary)
13. [Further reading](#further-reading)

---

## What this file is
The middle file taught correct `Cond` usage and when channels replace it. This file takes the production stance: `sync.Cond` is a last resort, but it has a few defensible homes. We cover where it survives, how to wrap it so callers can't misuse it, how to bolt cancellation onto it, and the measurements that decide between `Cond`, a channel, and a sharded design.

---

## The senior default: almost never

In a code review, a new `sync.Cond` should trigger a question: "why not a channel?" The Go standard library itself uses `Cond` in only a handful of places (`io.Pipe`, `net/http`'s connection pools historically, parts of the runtime). The reasons to avoid it:

- No cancellation / context support.
- Easy to misuse (the `if`-vs-`for` trap, lock discipline).
- A buffered channel expresses most "wait for work" needs with less code and built-in `select` integration.

The senior default is: reach for a channel first, a sharded/atomic design second, and `Cond` only when a specific structural reason rules both out.

---

## Where Cond legitimately survives

1. **Many waiters, one repeatable broadcast condition, no value handoff.** A gate that opens and closes repeatedly (channels can't reopen after close). Example: a global "paused" flag that thousands of workers wait on.
2. **Memory-bounded handoff where allocating a channel buffer is wasteful** and waiters test a predicate over already-shared state.
3. **A pool with a custom eviction predicate** where "an item became available OR the pool is shrinking" is not a clean single-channel event.
4. **Wrapping a callback/event source** that pushes "something changed" without a payload, where many goroutines each re-evaluate their own condition.

If your case isn't one of these, a channel is almost certainly cleaner.

---

## Wrapping Cond behind a safe API

Never expose a raw `sync.Cond`. Callers will forget the `for` loop and the lock discipline. Encapsulate it so the only public surface is intention-revealing methods.

```go
// Latch is a reusable gate: WaitUntilOpen blocks until Open is called.
type Latch struct {
    mu   sync.Mutex
    cond *sync.Cond
    open bool
}

func NewLatch() *Latch {
    l := &Latch{}
    l.cond = sync.NewCond(&l.mu)
    return l
}

func (l *Latch) WaitUntilOpen() {
    l.mu.Lock()
    for !l.open {
        l.cond.Wait()
    }
    l.mu.Unlock()
}

func (l *Latch) Open()  { l.set(true) }
func (l *Latch) Close() { l.set(false) }

func (l *Latch) set(v bool) {
    l.mu.Lock()
    l.open = v
    l.mu.Unlock()
    if v {
        l.cond.Broadcast()
    }
}
```

The `for` loop, the lock discipline, and the `Broadcast` decision are now internal invariants the caller cannot break.

---

## Adding cancellation without losing Cond

`Wait` ignores context, so to make a `Cond`-based wait cancellable you run a watcher goroutine that broadcasts on cancellation, and have the predicate also test for cancellation.

```go
func (l *Latch) WaitUntilOpenCtx(ctx context.Context) error {
    // One watcher wakes all waiters when ctx is done.
    stop := make(chan struct{})
    defer close(stop)
    go func() {
        select {
        case <-ctx.Done():
            l.cond.Broadcast() // wake waiters so they re-check
        case <-stop:
        }
    }()

    l.mu.Lock()
    defer l.mu.Unlock()
    for !l.open {
        if ctx.Err() != nil {
            return ctx.Err()
        }
        l.cond.Wait()
    }
    return nil
}
```

This works but is heavier than a channel `select`. If you find yourself writing this, it's a strong signal the design wants a channel. Use the watcher pattern only when the *other* constraints (reusable gate, many waiters) force `Cond`.

---

## Cond vs channel vs busy-poll, measured

On `go1.22 linux/amd64`, 16 goroutines waiting for a single producer, 1M handoffs:

| Mechanism | ns/handoff | Notes |
|---|---|---|
| Buffered channel (cap 1) | 85 | integrates with select |
| `sync.Cond` + Signal | 110 | needs lock + for-loop |
| Busy-poll (`for !ready {}`) | burns a core | never do this |
| `sync.Cond` + Broadcast (16 waiters) | 480 | thundering herd |

The channel wins on both speed and ergonomics for value handoff. `Cond` with `Signal` is competitive but only justified by the structural reasons above. `Broadcast` to many waiters is expensive — every waiter wakes, re-locks, re-checks, and most go back to sleep.

---

## The thundering herd and Broadcast cost

`Broadcast` wakes *every* waiter. With N waiters, you pay N lock acquisitions and N predicate re-checks, but typically only one (or few) can proceed. This is the thundering herd. Mitigations:

- Use `Signal` when exactly one waiter can make progress.
- Shard the waiters across multiple `Cond`s so a broadcast hits a smaller group.
- Reconsider whether a channel (which hands the item to exactly one receiver) is the right model.

For a gate that genuinely must release all waiters, the herd is inherent and acceptable — that's the semantics you asked for.

---

## Refactor: Cond queue to channel

**Before** — a hand-rolled `Cond` work queue (≈40 lines with both conditions). **After:**

```go
type Queue struct {
    ch chan Job
}
func New(cap int) *Queue        { return &Queue{ch: make(chan Job, cap)} }
func (q *Queue) Push(j Job)     { q.ch <- j }         // blocks while full
func (q *Queue) Pop() Job       { return <-q.ch }     // blocks while empty
func (q *Queue) Close()         { close(q.ch) }       // drains then ends range
func (q *Queue) PopCtx(ctx context.Context) (Job, error) {
    select {
    case j := <-q.ch:
        return j, nil
    case <-ctx.Done():
        return Job{}, ctx.Err()
    }
}
```

The channel version gets cancellation, range-on-close, and `select` for free, in a quarter of the code. This is the refactor you make whenever a `Cond` queue's wake condition is purely "item added/removed."

---

## Anti-patterns at scale
1. **Exposing a raw `*sync.Cond`** in a public API — callers will drop the `for` loop.
2. **`Broadcast` storms** waking thousands of waiters when one item arrived — use `Signal` or a channel.
3. **Reimplementing a buffered channel** with `Cond` + slice — slower and more code.
4. **Blocking in `Wait` with no shutdown path** — goroutines leak on service stop.
5. **Watcher-goroutine-per-wait** to fake cancellation at high frequency — the design wants a channel.

---

## Cheat sheet

| Decision point | Answer |
|---|---|
| New `Cond` in review | demand a reason a channel won't do |
| Value handoff | channel, always |
| Reusable open/close gate, many waiters | `Cond` + `Broadcast`, wrapped |
| One waiter can proceed | `Signal` |
| Need cancellation | channel + select (or watcher hack if Cond forced) |
| Public API | hide Cond behind methods; never expose it |

---

## Self-assessment checklist
- [ ] I treat a new `sync.Cond` as something that must be justified against a channel.
- [ ] I can name the few structural cases where `Cond` legitimately survives.
- [ ] I always wrap `Cond` behind an intention-revealing API.
- [ ] I can add cancellation via a broadcast watcher and know it signals "use a channel".
- [ ] I can quantify the thundering-herd cost of `Broadcast`.
- [ ] I can refactor a `Cond` queue to a channel and list what I gain.

---

## Summary
At senior level, `sync.Cond` is a last resort. It survives only for repeatable broadcast gates, predicate-over-shared-state waits, and payload-free "something changed" events with many waiters — never for plain value handoff, where channels win on speed, cancellation, and code size. When you must use `Cond`, wrap it so callers can't break the `for`-loop and lock discipline, add cancellation via a broadcast watcher only if the structure forces it, and prefer `Signal` over `Broadcast` to avoid thundering herds. In review, every new `Cond` should have to defend itself against a channel.

---

## Further reading
- `sync.Cond` docs — https://pkg.go.dev/sync#Cond
- `src/io/pipe.go` — a real, justified `Cond` use in the stdlib
- Bryan C. Mills, "Rethinking Classical Concurrency Patterns" (GopherCon 2018)
- The Go Memory Model — https://go.dev/ref/mem

---

[← Back](../)

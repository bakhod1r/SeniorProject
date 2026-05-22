# Push-Pull — Specification

## Table of Contents
1. [Definitions](#definitions)
2. [Invariants](#invariants)
3. [Operations and Semantics](#operations-and-semantics)
4. [Backpressure Contract](#backpressure-contract)
5. [Ordering and Memory Guarantees](#ordering-and-memory-guarantees)
6. [Failure Semantics](#failure-semantics)
7. [Defined vs Undefined Behavior](#defined-vs-undefined-behavior)
8. [Concurrency Contract](#concurrency-contract)
9. [Lifecycle State Machine](#lifecycle-state-machine)
10. [Edge Cases](#edge-cases)
11. [Reference Implementation](#reference-implementation)

---

## Definitions

- **Producer.** A goroutine that performs *push* operations, submitting items into the channel/queue.
- **Consumer.** A goroutine that performs *pull* operations, retrieving items.
- **Push.** Delivering an item into the queue. Subject to the overflow policy when the queue is full.
- **Pull.** Retrieving the next available item. Blocks (or returns "closed") when the queue is empty and no item will arrive.
- **Bounded queue.** A queue with a fixed maximum number of in-flight items (`capacity`). A buffered channel of capacity N.
- **Backpressure.** The effect by which a full bounded queue prevents (or delays/sheds) further pushes, coupling the producer's effective rate to the consumer's.
- **Overflow policy.** The rule applied to a push when the queue is full: `Block`, `DropNewest`, `DropOldest`, `Sample`, `Spill`, or `Reject`.
- **Drain.** Consuming all remaining items after the producer has stopped, before shutdown completes.
- **Closed queue.** A queue on which the producer has signalled completion (`close`). Pulls return remaining items, then `(zero, false)`.

---

## Invariants

A conforming bounded push-pull channel must guarantee:

1. **Capacity bound.** The number of items buffered never exceeds `capacity`. Memory is bounded by `capacity × itemSize`.
2. **No loss under Block policy.** With `Block`, every successfully-returned push delivers exactly one item to exactly one consumer; no item is silently dropped.
3. **Single delivery (fan-out).** Each pushed item is pulled by *exactly one* consumer (push-pull is not broadcast).
4. **Backpressure.** Under `Block`, a push on a full queue does not complete until a slot is freed by a pull (or the operation is cancelled).
5. **Sender-closes.** Only the producer side closes the channel; no push occurs after close.
6. **Drain on close.** After close, pulls continue to return buffered items in order until empty, then return `(zero, false)`.
7. **Cancellation.** A push or pull participating in a cancellable operation completes (with an error/abort) when its context is cancelled, rather than blocking indefinitely.
8. **Ownership transfer.** After a successful push, the item is owned by the consumer; the producer must not mutate it.

Breaking invariant 1 yields the unbounded-queue OOM; breaking 4 removes backpressure; breaking 8 is a data race.

---

## Operations and Semantics

### `Push(ctx, item)` (Block policy)

- **Pre-conditions:** queue open; `ctx` non-nil.
- **Behavior:** if a slot is free, enqueues immediately; otherwise blocks until a slot frees or `ctx` is cancelled.
- **Post-conditions:** on success, the item is enqueued and ownership transfers to the consumer; the buffered count ≤ capacity.
- **Returns:** `nil` on enqueue; `ctx.Err()` if cancelled while blocked.

### `Push(ctx, item)` (non-blocking policies)

- **DropNewest:** if full, discard `item`, return a "dropped" indication (and increment a metric).
- **DropOldest:** if full, discard the oldest buffered item to make room, enqueue `item`.
- **Reject:** if full, return `ErrOverloaded` without enqueuing.
- **Spill:** if full, persist `item` to a secondary (disk-backed) store; bounded by the store's capacity.

### `Pull(ctx)`

- **Pre-conditions:** `ctx` non-nil.
- **Behavior:** returns the next item if available; if empty and open, blocks until an item arrives, the queue closes, or `ctx` is cancelled.
- **Post-conditions:** the returned item is removed; a slot is freed (which may unblock a producer).
- **Returns:** `(item, true, nil)` on an item; `(zero, false, nil)` if closed and drained; `(zero, false, ctx.Err())` if cancelled.

### `Close()`

- **Pre-conditions:** called by the producer side; no push in progress from another producer.
- **Behavior:** marks the queue closed. No further push is valid.
- **Post-conditions:** consumers drain remaining items, then observe closed.

---

## Backpressure Contract

- Under `Block`, the producer's *effective* throughput cannot exceed the consumer's pull rate plus the slack provided by `capacity`. In steady state, producer rate = consumer rate.
- `capacity` is the only knob that decouples instantaneous rates; it absorbs bursts of up to `capacity` items before backpressure engages.
- Backpressure must terminate at a *blockable* or *droppable* boundary. If the producer's source cannot be blocked (e.g., an inbound socket, a real-time feed), the policy at that boundary must be non-blocking (`Drop`/`Sample`/`Reject`/`Spill`); otherwise the system either grows unbounded (if the bound is removed) or stalls the source.
- Steady-state throughput is bounded by the consumer service rate; increasing `capacity` raises burst tolerance and latency-under-load, never steady-state throughput.

---

## Ordering and Memory Guarantees

- **FIFO per channel.** With a single producer and a single consumer, items are delivered in push order. With multiple consumers (fan-out), per-item order is preserved up to the channel but the *processing* order across consumers is unspecified.
- **Happens-before.** A push happens-before the corresponding pull completes. All writes the producer performed before the push (including to memory the item points to, if not subsequently mutated) are visible to the consumer after the pull.
- **No mutation after push.** The happens-before edge orders the producer's pre-push writes before the consumer's reads; it does *not* order any post-push producer write — such a write is a data race.
- **Ordering across consumers.** Not guaranteed; if global order matters, use a single consumer or shard by key with per-shard ordering.

---

## Failure Semantics

| Situation | Result |
|-----------|--------|
| Push on a full queue, `Block` | blocks until a slot frees or `ctx` cancelled |
| Push on a full queue, non-blocking policy | item dropped / oldest evicted / rejected / spilled per policy; metric incremented |
| Push after `Close` | panic (send on closed channel) — a programming error |
| Pull on a closed, drained queue | returns `(zero, false)` |
| Push with no consumer ever pulling | blocks forever (deadlock) — caller error |
| Consumer exits while producer blocked on a full queue | producer leaks unless the push selects on `ctx.Done()` |
| `Close` called twice | panic — guard with `sync.Once` if multiple callers may close |
| Shutdown without drain | buffered items lost (acceptable only for abort semantics or replayable sources) |

For must-not-lose work, the channel alone is insufficient: at-least-once delivery requires an acking/redelivery layer (a broker), since a process crash loses all in-flight items.

---

## Defined vs Undefined Behavior

**Defined:**
- Single producer, single consumer, bounded channel: FIFO, backpressure on full, drain on close.
- Multiple consumers pulling one channel: each item to exactly one consumer (fan-out); processing order unspecified.
- Non-blocking overflow policies with explicit drop/reject and metrics.
- Cancellation via `select` on `ctx.Done()` for every blocking push/pull.

**Undefined / programming error:**
- Pushing after `Close` (panic).
- Closing more than once without a guard (panic).
- Closing from a consumer or from one of several producers without coordination (race/panic).
- Mutating an item after pushing it (data race).
- Reusing a slice after sending it (data race).
- Relying on a specific cross-consumer processing order.
- Removing the capacity bound for uncontrolled input (unbounded growth → OOM, outside the spec).

---

## Concurrency Contract

- A bounded channel supports concurrent producers and concurrent consumers safely (the runtime serialises send/receive internally).
- Exactly one party is responsible for `Close`; with multiple producers, coordinate close (e.g., a `sync.WaitGroup` over producers, then a single close).
- Every blocking operation in a cancellable pipeline must `select` on `ctx.Done()` to avoid leaks.
- The aggregate in-flight item count across a multi-stage pipeline is the sum of stage capacities; bound the aggregate (e.g., an admission semaphore) if total memory must be capped.
- Items must be free of shared mutable aliasing after push (ownership transfer).

---

## Lifecycle State Machine

```
                 New(cap)
                    |
                    v
            +----------------+   Push (slot free)    +----------------+
            |     OPEN       | --------------------> |  OPEN (n+1)    |
            | n items (n<cap)| <-------------------- |  buffered      |
            +----------------+   Pull (slot freed)   +----------------+
                    |  ^
       Push (full)  |  | Pull frees a slot
                    v  |
            +----------------+
            |     FULL       |  Block: producer waits
            | n == cap       |  Non-block policy: drop/reject/spill
            +----------------+
                    |
                    | Close() (producer)
                    v
            +----------------+   Pull (drain)        +----------------+
            |    CLOSED      | --------------------> |  CLOSED+EMPTY  |
            | (drain remain) |   last item pulled    | pulls -> (0,false)
            +----------------+                       +----------------+
```

- **OPEN:** accepting pushes and pulls; `0 ≤ n < cap`.
- **FULL:** `n == cap`; pushes block (Block) or apply the overflow policy.
- **CLOSED:** no more pushes; pulls drain remaining items.
- **CLOSED+EMPTY:** terminal; pulls return `(zero, false)`.

---

## Edge Cases

- **Capacity 0 (unbuffered).** Every push is a rendezvous: it completes only when a pull is in progress. FULL and OPEN collapse — there is no slack.
- **Single in-flight (cap 1).** The producer may be at most one item plus one in-flight ahead of the consumer.
- **`nil` channel.** Push and pull on a `nil` channel block forever; used intentionally to disable a `select` case, a bug if accidental.
- **Close with buffered items.** Consumers must drain before observing closed; do not assume close means "stop now."
- **Cancellation racing with a successful push.** Exactly one outcome must occur: either the item is enqueued (return `nil`) or the push is abandoned (return `ctx.Err()`) — never both. A `select { case ch<-v: case <-ctx.Done(): }` provides this.
- **Multiple producers + close.** Closing while another producer may still push panics; gate close behind "all producers done."
- **Slow consumer holding a slot.** Under Block, one slow consumer applies backpressure to all producers via the shared bound; under fan-out, other consumers continue, but the queue can still fill if aggregate consumption < production.

---

## Reference Implementation

A bounded push-pull queue with selectable overflow policy, cancellation, and clean drain — built on a channel.

```go
// Package pushpull provides a bounded producer/consumer queue with
// explicit overflow policy and context cancellation.
package pushpull

import (
    "context"
    "errors"
    "sync"
)

// ErrOverloaded is returned by Push under the Reject policy when full.
var ErrOverloaded = errors.New("pushpull: queue full")

type Policy int

const (
    Block Policy = iota // producer blocks until a slot frees (default)
    DropNewest          // discard the incoming item when full
    DropOldest          // evict the oldest buffered item when full
    Reject              // return ErrOverloaded when full
)

// Queue is a bounded push-pull queue. Construct with New. Safe for
// concurrent producers and consumers. The producer side closes via Close.
type Queue[T any] struct {
    ch        chan T
    policy    Policy
    closeOnce sync.Once

    mu      sync.Mutex
    dropped uint64 // observability: items lost to a non-block policy
}

// New returns a queue with the given capacity and overflow policy.
func New[T any](capacity int, policy Policy) *Queue[T] {
    if capacity < 0 {
        panic("pushpull: capacity must be >= 0")
    }
    return &Queue[T]{ch: make(chan T, capacity), policy: policy}
}

// Push submits an item according to the overflow policy.
// It returns ErrOverloaded under Reject when full, ctx.Err() on
// cancellation, or nil otherwise (including when an item is dropped).
func (q *Queue[T]) Push(ctx context.Context, item T) error {
    switch q.policy {
    case Block:
        select {
        case q.ch <- item:
            return nil
        case <-ctx.Done():
            return ctx.Err()
        }
    case DropNewest:
        select {
        case q.ch <- item:
            return nil
        case <-ctx.Done():
            return ctx.Err()
        default:
            q.recordDrop()
            return nil // dropped, but not an error
        }
    case DropOldest:
        for {
            select {
            case q.ch <- item:
                return nil
            case <-ctx.Done():
                return ctx.Err()
            default:
                select {
                case <-q.ch: // evict oldest, then retry
                    q.recordDrop()
                default:
                }
            }
        }
    case Reject:
        select {
        case q.ch <- item:
            return nil
        case <-ctx.Done():
            return ctx.Err()
        default:
            q.recordDrop()
            return ErrOverloaded
        }
    }
    return nil
}

// Pull returns the next item. ok is false when the queue is closed and
// drained. It returns ctx.Err() if cancelled while waiting.
func (q *Queue[T]) Pull(ctx context.Context) (item T, ok bool, err error) {
    select {
    case v, open := <-q.ch:
        return v, open, nil
    case <-ctx.Done():
        return item, false, ctx.Err()
    }
}

// C exposes the receive-only channel for use with range/select.
// Consumers may range over it; it ends when Close is called and the
// buffer is drained.
func (q *Queue[T]) C() <-chan T { return q.ch }

// Close signals that no more items will be pushed. Idempotent.
// Must be called only by the producer side (after all producers stop).
func (q *Queue[T]) Close() {
    q.closeOnce.Do(func() { close(q.ch) })
}

// Dropped reports how many items have been lost to a non-block policy.
func (q *Queue[T]) Dropped() uint64 {
    q.mu.Lock()
    defer q.mu.Unlock()
    return q.dropped
}

func (q *Queue[T]) recordDrop() {
    q.mu.Lock()
    q.dropped++
    q.mu.Unlock()
}
```

This satisfies the invariants: the channel enforces the capacity bound (1) and single delivery (3); `Block` provides backpressure with no loss (2, 4); `closeOnce` makes `Close` idempotent and the channel guarantees drain-on-close (5, 6); every blocking operation selects on `ctx.Done()` (7); and ownership transfer (8) is the caller's contract — the queue copies the value into the channel buffer and never touches it again. For must-not-lose work, layer acking/redelivery on top (a broker); the in-memory queue cannot survive a crash.

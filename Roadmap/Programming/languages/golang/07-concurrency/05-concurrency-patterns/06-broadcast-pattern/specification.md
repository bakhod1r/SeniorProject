# Broadcast Pattern — Specification

## Table of Contents
1. [Definitions](#definitions)
2. [Invariants](#invariants)
3. [Operations and Semantics](#operations-and-semantics)
4. [Ordering Guarantees](#ordering-guarantees)
5. [Failure Semantics](#failure-semantics)
6. [Concurrency Contract](#concurrency-contract)
7. [Lifecycle State Machine](#lifecycle-state-machine)
8. [Edge Cases](#edge-cases)

---

## Definitions

- **Hub.** An object that owns a set of *subscriptions* and offers a `Publish` operation. Implements the `Hub[T]` interface.
- **Subscription.** A single subscriber's view of the Hub. Owns one channel `C() <-chan T` and an `Unsubscribe()` method.
- **Publish.** The act of delivering a value `v` to *every* active subscription according to the overflow policy.
- **Active subscription.** A subscription that has been created by `Subscribe()` and has not yet been removed by `Unsubscribe()` or hub `Close()`.
- **Overflow policy.** A per-subscription rule applied when delivering to a full buffer: `Block`, `DropNewest`, `DropOldest`, or `Eject`.
- **Closed hub.** A hub on which `Close()` has been called. All future `Publish` calls return `ErrClosed`. All active subscriptions are closed.
- **Closed subscription.** A subscription whose channel has been closed. Future receives return `(zero, false)`.

---

## Invariants

The implementation must guarantee these at all times:

1. **Channel ownership.** Only the Hub closes subscription channels. Subscribers never close their own channels.
2. **Idempotent unsubscribe.** Calling `Unsubscribe()` more than once is safe and has the same observable effect as calling it once.
3. **Idempotent close.** Calling `Close()` more than once is safe; second call is a no-op.
4. **No send on closed channel.** The Hub never sends on a channel after it has been closed.
5. **No double close.** Every subscription channel is closed at most once.
6. **No publish after close.** After `Close()` returns, no `Publish` succeeds.
7. **No leak on close.** After `Close()`, no goroutine internal to the Hub is still alive (modulo the consumer goroutines outside the Hub).
8. **Subscribe consistency.** A subscription created at time `T` receives events with publish time strictly greater than `T` (modulo the overflow policy).

These invariants are the *contract*. If your implementation breaks one, callers will write bugs.

---

## Operations and Semantics

### `New[T any](options ...Option) *Hub[T]`

**Pre-conditions:** none.
**Post-conditions:** hub is in *Open* state. Internal goroutines (if any) are started.
**Returns:** a `*Hub[T]`.

### `Subscribe(opts ...SubOption) Subscription[T]`

**Pre-conditions:** hub is in any state.
**Post-conditions:**
- If hub is *Open*: a new subscription is registered. Its channel is open.
- If hub is *Closed*: a subscription whose channel is already closed is returned.
**Concurrency:** safe to call from any goroutine, including during a concurrent `Publish` or `Close`.
**Returns:** a `Subscription[T]`.

### `Publish(ctx context.Context, v T) error`

**Pre-conditions:** none.
**Post-conditions:**
- If hub is *Open*: every subscription active at the time the publish observed the subscription set receives `v`, modulo its overflow policy.
- If hub is *Closed*: returns `ErrClosed`; no delivery occurs.
- If `ctx` is cancelled mid-publish: returns `ctx.Err()`. Subscriptions already delivered to retain their event; subscriptions not yet visited do not.

**Concurrency:** safe to call from any goroutine; multiple concurrent publishers are allowed. Their values may interleave in subscriber channels.

**Returns:** `nil` on success; `ErrClosed` if the hub is closed; `ctx.Err()` if context cancelled.

### `Unsubscribe()` (on Subscription)

**Pre-conditions:** none.
**Post-conditions:**
- Subscription is removed from the hub's set.
- Subscription's channel is closed.
- Future receives on the channel return `(zero, false)`.
**Concurrency:** safe to call from any goroutine, including the subscriber's own consumer goroutine.

### `Close()` (on Hub)

**Pre-conditions:** none.
**Post-conditions:**
- Hub is in *Closed* state.
- Every active subscription's channel is closed.
- `Done()` returns a closed channel.
- Internal goroutines exit.
**Concurrency:** safe to call from any goroutine.

### `Done() <-chan struct{}` (on Hub)

**Returns:** a channel that is closed when the hub is closed. Multiple calls return the same channel.

---

## Ordering Guarantees

### Per-subscriber order

For a single subscription `S` and two publishes `P1`, `P2` issued in that *happens-before* order from a single goroutine:
- If neither publish is dropped due to overflow, `S` receives `P1` before `P2`.
- If `P1` is dropped (e.g., `DropNewest`), `S` receives `P2` and not `P1`.
- If `P2` is dropped, `S` receives `P1` and not `P2`.

### Cross-subscriber order

No guarantee. Subscriber `A` may see `P1` before subscriber `B` sees `P1`, and vice versa. The Hub iterates the subscription set in unspecified order.

### Concurrent publishers

Two publishers `Px` and `Py` issued concurrently from different goroutines may be observed by different subscribers in different orders. The Hub does not serialise across publishers; it serialises only within a single publish call (a publish call delivers `v` to subscriber-by-subscriber atomically).

### Publish atomicity

A single `Publish(v)` call delivers `v` to every active subscriber zero or one times. It does not deliver `v` twice to the same subscriber. A subscription that subscribes during the publish call may or may not see `v` — implementation-defined; our middle-level hub guarantees "no" via lock ordering.

---

## Failure Semantics

### Publisher errors

- `ErrClosed`: hub is closed. The publisher should stop publishing.
- `ctx.Err()`: caller's context was cancelled. The publish was partial.

The publisher cannot distinguish "all subscribers received" from "some subscribers dropped per policy" — the return is `nil` in both cases. To observe drops, query `Stats()`.

### Subscriber errors

A subscriber observes "the hub is gone" via `ok=false` on its channel. There is no `error` channel; failures are encoded by channel closure.

A subscriber observes "I was ejected" the same way: `ok=false` after a series of received events. Ejection is indistinguishable from `Close()` from the subscriber's perspective. If this distinction matters, encode it in the payload type.

### Hub panics

The Hub does not panic in normal operation. Panics can occur only if:

- A subscriber closes its own channel (violates the contract).
- A publisher sends a value containing a buggy custom type that panics on copy.

In both cases, the panicking goroutine should `recover()` to prevent crashing the process. Default behaviour is to panic — strict contracts make bugs loud.

---

## Concurrency Contract

The Hub is safe for concurrent use across all methods. Concretely:

- N goroutines may call `Publish` simultaneously.
- M goroutines may call `Subscribe` simultaneously.
- K goroutines may call `Unsubscribe` simultaneously.
- `Close` is safe at any time.

The implementation uses an `RWMutex` (or a sharded equivalent): `Publish` takes `RLock`; `Subscribe`, `Unsubscribe`, and `Close` take `Lock`. This guarantees that publishes do not race with subscription set mutations.

Read-side fast path: many concurrent publishes proceed in parallel under `RLock`. Subscribe latency is bounded by the longest concurrent publish duration.

---

## Lifecycle State Machine

```
       Subscribe          Publish (no-op)
          .------.       .---------.
          |      |       |         |
          v      |       v         |
       +------+--+    +---+-----+
   ----| Open |------>| Closed   |
   New +------+ Close +----------+
          ^      |
          |      |
       Subscribe          Unsubscribe
       (returns          (closes one
        closed sub)       subscription)
```

States:
- **Open.** Accepts subscribe, publish, unsubscribe. Internal goroutines run.
- **Closed.** Subscribe returns a closed subscription. Publish returns `ErrClosed`. Internal goroutines exited. `Done()` is closed.

Transitions:
- `Open → Closed`: via `Close()`. Irreversible.

There is no `Draining` state in the basic spec. The `Drain(timeout)` method (optional) is `Open` until the timeout fires, after which it transitions to `Closed`. During drain, `Publish` continues to work; `Subscribe` may be refused (implementation choice).

---

## Edge Cases

### Subscribing during `Close`
Specification: if `Close()` has *already returned*, `Subscribe()` must return a closed subscription. If `Close()` is still running (entered but not yet returned), `Subscribe()` must either block until `Close` completes (then return closed) or proceed and be cleaned up by `Close`. Most implementations use lock-based serialisation, which produces the first behaviour.

### Publishing during `Close`
Same as above. If `Close` has returned, `Publish` returns `ErrClosed`. If `Close` is running, `Publish` waits and then returns `ErrClosed`.

### Unsubscribing during `Publish` to that subscriber
Specification: the publish delivery to that subscriber either happens (and the unsubscribe takes effect after) or does not happen (and the unsubscribe takes effect before). Never both. Lock ordering enforces this.

### Subscriber receives a value after `Unsubscribe`
Possible. If the publish delivered before unsubscribe was acquired, the value is in the buffer. The subscriber should drain the channel after `Unsubscribe` to consume buffered values.

```go
sub.Unsubscribe()
for v := range sub.C() {
    // drain
    _ = v
}
```

### `Close` called twice from different goroutines
First wins; second is a no-op. Both return without error.

### `Close` called after every subscription has unsubscribed
Valid. Hub transitions to *Closed*. No subscriber channels to close.

### Publish with no subscribers
Valid. `Publish` is a no-op that returns `nil`.

### Subscribe and immediately Unsubscribe
Valid. No events delivered. Both calls succeed.

### `nil` payload
If `T` is a pointer or interface type, `nil` values are delivered as `nil`. The Hub does not filter them.

### Very large payload
The Hub does not bound payload size. The caller must enforce limits. Broadcasting a 1 GB value to 1000 subscribers will use 1 TB of memory if every subscriber holds the value; in practice, sending a pointer instead of a copy keeps memory bounded.

### Buffer of size 0
Valid. The subscription channel is unbuffered. Every publish to this subscriber synchronises with a receive. `Block` policy means the publisher waits for the receiver; `DropNewest` means the value is dropped unless the receiver is already in `<-`.

### Buffer of negative size
Invalid. `New` must reject or treat as zero. The spec defines: negative → error or panic at construction.

---

## Summary

A broadcast Hub is fully specified by:

- Its lifecycle states (Open / Closed) and the operations that move between them.
- Its concurrency contract (read-write lock semantics or equivalent).
- Its ordering guarantees (per-subscriber yes, cross-subscriber no).
- Its overflow policy (Block / DropNewest / DropOldest / Eject).
- Its failure semantics (`ErrClosed`, `ctx.Err()`, no panics in normal use).

Any implementation that satisfies these is interchangeable with any other from the caller's perspective. Diverging from the spec in subtle ways — for instance, "subscribers see events sometimes, sometimes not" — is the source of most production bugs.

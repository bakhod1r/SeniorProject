---
layout: default
title: Batching Stages — Specification
parent: Batching Stages
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/04-batching-stages/specification/
---

# Batching Stages — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Trigger Semantics](#trigger-semantics)
3. [Channel Semantics for Sends and Receives](#channel-semantics-for-sends-and-receives)
4. [Context Cancellation Guarantees](#context-cancellation-guarantees)
5. [End-of-Stream Marker Conventions](#end-of-stream-marker-conventions)
6. [Ordering Invariants](#ordering-invariants)
7. [Timer Semantics Across Go Versions](#timer-semantics-across-go-versions)
8. [Memory Model Notes](#memory-model-notes)
9. [Closing Invariants](#closing-invariants)
10. [Error Reporting Convention](#error-reporting-convention)
11. [References](#references)

---

## Introduction

This file collects the normative-style specifications that the canonical batching stage relies on. The Go language and the `context`, `time`, and `sync` standard library packages provide the guarantees; this file translates them into batching-stage terms.

Where the Go documentation is the authoritative source, this file cites it. Where the batching pattern adds conventions on top of the language guarantees, the conventions are labelled "convention" and are non-normative — they are simply the patterns the rest of the folder assumes.

---

## Trigger Semantics

The triple trigger consists of three independent events that cause a flush.

### Size trigger (specification)

**Trigger condition.** `len(buf) >= maxSize`.

**Evaluation point.** Immediately after each `append`. Not in a separate `select` case.

**Guarantee.** When the trigger fires, the flushed batch contains exactly `maxSize` items (assuming the implementation flushes whenever the size is `>= maxSize`, which is the canonical form).

**Edge case.** If `maxSize <= 0`, the trigger fires after every `append`, producing batches of size 1. The canonical implementation validates `maxSize > 0` at startup.

### Time trigger (specification)

**Trigger condition.** A `*time.Timer.C` receive becomes ready.

**Armed state.** The timer is armed via `Reset(maxWait)` when the buffer transitions from empty to non-empty. The timer is disarmed (`Stop()` + drain) after every flush, regardless of trigger reason.

**Guarantee.** Once armed, the timer fires within `maxWait + ε` of arming, where `ε` is the scheduler latency. On idle systems `ε` is sub-millisecond; under load it may reach tens of milliseconds.

**Edge case.** Empty-buffer fires (the timer fires after a flush but before reset) are handled by the `flush()` empty-buffer early-return.

### End-of-stream trigger (specification)

**Trigger condition.** `<-in` returns `(_, false)`.

**Cause.** The input channel has been closed by its owner.

**Guarantee.** After all sent values are received, the receive returns the zero value and `ok = false`. Per the Go spec: "Receiving from a closed channel always proceeds immediately, yielding the element type's zero value after any previously sent values have been received."

**Convention.** The canonical implementation treats end-of-stream as a "final flush then return" sequence, ensuring no partial batch is lost.

### Cancellation trigger (specification)

**Trigger condition.** `<-ctx.Done()` becomes ready.

**Guarantee.** Once `ctx` is cancelled (either explicitly or due to a parent cancel or deadline), `ctx.Done()` is closed and receives proceed immediately, returning the zero value. Per `context` docs: "After Done is closed, Err returns a non-nil value."

**Convention.** The canonical implementation treats cancellation as "best-effort final flush then return." The flush's downstream send may be skipped if the receiver has also been cancelled.

---

## Channel Semantics for Sends and Receives

### Receive from closed channel

Per the Go spec: A receive from a closed channel returns the zero value of the channel's element type and `ok = false`. The receive does not block.

This is the foundation of the end-of-stream trigger.

### Send to closed channel

Sending to a closed channel panics. The canonical implementation enforces that only the accumulator closes its output channel, via `defer close(out)`. Other goroutines that read from `out` do not close it.

### Buffered channel capacity

A buffered channel with capacity `n` accepts up to `n` sends without a corresponding receive. The `n+1`-th send blocks until a receive occurs. The canonical implementation uses an output channel of capacity 1–8 to allow overlap between the accumulator and the consumer.

### Nil channel behavior

Send to or receive from a nil channel blocks forever. The canonical implementation does not use nil channels directly, but advanced variants disable cases with nil channels (see middle.md).

### Select fairness

`select` with multiple ready cases chooses pseudo-randomly. There is no priority ordering. The canonical implementation relies on this fairness: under heavy traffic, the receive case and the timer case are both ready at times, and either may win.

### Single-direction conversion

A bidirectional channel `chan T` can be converted to `<-chan T` (receive-only) or `chan<- T` (send-only). The reverse conversion is not allowed. The canonical signature uses single-direction channels to express data flow.

---

## Context Cancellation Guarantees

The `context` package defines the cancellation contract.

### `Context.Done()`

Returns a channel that is closed when the work done on behalf of this context should be canceled.

**Idempotent.** Once closed, the channel remains closed. Multiple receives from it are valid.

**Composable.** Child contexts inherit cancellation from their parent. Cancelling the parent cancels all children.

### `Context.Err()`

Returns the reason for cancellation. The canonical reasons are:

- `context.Canceled` if the context was canceled explicitly.
- `context.DeadlineExceeded` if the deadline passed.

Pre-1.20 implementations return only these two. Go 1.20+ adds `WithCancelCause` which lets you attach an arbitrary error.

### Cancellation propagation timing

Cancellation is *asynchronous*. Calling `cancel()` does not synchronously stop goroutines; it closes the Done channel. Goroutines observe the close at their next `select` or `<-ctx.Done()` check.

**Implication for batching.** When `ctx.Done()` becomes ready in the accumulator's `select`, the cancellation has been requested; the accumulator should flush and exit. Time elapsed between `cancel()` call and goroutine exit may be milliseconds (current `select` operation finishes first).

### `context.WithCancelCause` (Go 1.20+)

Adds the ability to attach a reason:

```go
ctx, cancel := context.WithCancelCause(parent)
defer cancel(nil)
// later:
cancel(errors.New("user aborted"))
```

Useful for diagnostics in batching-stage logs.

---

## End-of-Stream Marker Conventions

In Go pipelines, end-of-stream is signaled exclusively by closing the input channel. There is no separate "EOS event" object.

### Rationale

- Closing a channel is the idiomatic Go signal for "no more values."
- The receiver detects it via `(_, ok := <-ch); !ok`.
- Multiple receivers all observe the close simultaneously.
- No sentinel value collision.

### Convention

- The producer is responsible for closing.
- The producer closes the channel exactly once, at the moment it has nothing more to send.
- The producer does not close the channel on cancellation; it simply stops sending. Cancellation is signaled via `ctx.Done()`, not via channel close.

### Anti-conventions

These are *not* the convention but are sometimes encountered. Avoid:

- Sending a sentinel item with `IsLast = true`. Re-invents close, badly.
- Closing the channel as a "stop signal" from a consumer to a producer. Wrong direction; consumers do not close producer channels.
- Closing on cancellation. Conflates two signals.

---

## Ordering Invariants

### Single-flusher in-order delivery

When the accumulator uses sync flush (no worker pool), batches are emitted in the order the items entered them. This is a consequence of the single-goroutine design.

### Single-worker async flush

When the accumulator uses bounded async flush with `Inflight = 1`, batches are still emitted in order. The single worker processes batches in receive order.

### Multi-worker async flush

When `Inflight > 1`, batches may complete out of order. The first batch may finish after the second one. The canonical implementation does not enforce order in this configuration.

### Per-key ordering

If the accumulator separates buffers by key, items within a key emerge in order (single per-key buffer). Items across keys may interleave.

### Pipelined ordered flushers

A specialised design (see senior.md) uses ack tokens to preserve global order across multiple workers. The dispatcher sends `(batch, done_chan)` pairs in order; the committer drains the done channels in order. Throughput up to `Inflight × per-worker rate`; order preserved.

---

## Timer Semantics Across Go Versions

### Go 1.18–1.22

`time.NewTimer(d)` returns a timer that fires once at `d` after creation. The timer's `C` channel has capacity 1.

`Timer.Stop()` returns:
- `true` if the timer was active and successfully stopped.
- `false` if the timer had already fired (or been stopped previously).

`Timer.Reset(d)` is documented as needing to be called after a successful `Stop` and drain. Calling `Reset` on a timer that has already fired without draining first leads to a race: the new `Reset` may or may not see the old value.

Canonical pattern:

```go
if !t.Stop() {
    select { case <-t.C: default: }
}
t.Reset(d)
```

### Go 1.23+

`Timer.Reset` was simplified. The runtime now guarantees that `Reset` on a fired-but-not-drained timer does the right thing — the pending value is discarded.

Canonical pattern still works on 1.23+, but you can simplify to:

```go
t.Reset(d)
```

The canonical implementations in this folder use the older safe pattern for portability across versions.

### `time.NewTicker(d)`

Returns a ticker that fires every `d`. Must be stopped with `Stop()` to release resources.

### `time.AfterFunc(d, f)`

Calls `f` in its own goroutine after `d`. Returns a `*Timer` (yes, with `Stop`/`Reset`).

`AfterFunc` is convenient for per-key timer designs because the callback can be the trigger event.

### `time.After(d)`

Returns a channel that fires once at `d`. The returned timer cannot be stopped — it leaks until it fires. **Do not use `time.After` in long-running loops.**

---

## Memory Model Notes

The Go memory model (`go.dev/ref/mem`) defines when one goroutine's writes are visible to another's reads.

### Channel send/receive

A send on a channel happens-before the corresponding receive completes. This is the key synchronisation primitive for batching.

**Implication.** When the accumulator sends `batch` on `out`, any writes performed before the send (such as the `copy(batch, buf)`) are visible to the goroutine that receives.

### Mutex unlock/lock

A `sync.Mutex.Unlock` happens-before any subsequent `Lock` of the same mutex. The canonical batching stage does not use mutexes; this is mentioned for variants that do.

### Atomic operations

`sync/atomic` operations are memory-model synchronised. Used in batching for metric counters and for `atomic.Int64.CompareAndSwap` in reconnecting clients.

### `sync.Once`

`sync.Once.Do(f)` guarantees `f` runs at most once. The function returns only after `f` has completed. Useful for one-time initialisation in stages.

### `sync.WaitGroup`

`wg.Wait` happens-after all `wg.Done` calls for the corresponding `wg.Add`. Used to ensure worker pools drain before returning.

---

## Closing Invariants

### Output channel close ownership

The accumulator is the sole owner of its output channel. It closes the channel exactly once, via `defer close(out)` at the top of the function.

### Input channel close ownership

The input channel is owned by the producer (which is upstream of the batching stage). The accumulator never closes it; it only detects the close via `(_, false) := <-in`.

### Close-once via `sync.Once`

In rare cases where multiple paths could close a channel, `sync.Once` ensures it happens exactly once:

```go
var closeOnce sync.Once
closeFn := func() { closeOnce.Do(func() { close(out) }) }
```

This is not needed in the canonical pattern but appears in variants.

### Worker channel close

In bounded async flush, the accumulator closes the `jobs` channel after the main loop exits. Workers detect the close via `for ... range` and exit cleanly. The `sync.WaitGroup` synchronises the accumulator's wait for workers.

---

## Error Reporting Convention

The canonical batching stage does not return errors from its main `Run` function for routine events:

- Input close: not an error; normal shutdown.
- Context cancellation: not an error returned from the stage; `ctx.Err()` is the canonical value.
- Sink failures: not the stage's concern; reported via the consumer of `out` or the worker pool's `OnError` hook.

The stage *does* return errors for:

- Validation failures (e.g. `maxSize <= 0`).
- Panic recovery (if implemented).

The convention is: the batching stage is a pipe; the I/O lives elsewhere; errors live with the I/O.

---

## References

- The Go Programming Language Specification: `https://go.dev/ref/spec`.
- The Go Memory Model: `https://go.dev/ref/mem`.
- `pkg.go.dev/context` — cancellation contract.
- `pkg.go.dev/time` — timer and ticker semantics.
- `pkg.go.dev/sync` — synchronisation primitives.
- `https://go.dev/blog/pipelines` — the foundational Go pipelines article.

---

## Notes on Future Versions

Go's standard library evolves. Future versions may add:

- More flexible timer semantics (`time.Timer` improvements).
- Native batching primitives in the standard library (unlikely but possible).
- Better runtime traceability for goroutine lifecycles.

The canonical patterns in this folder should remain valid. Specific syntax may shift; the trigger semantics will not.

---

## Appendix A — Detailed Channel Operation Table

A reference table mapping channel operations to their guarantees.

| Operation | On nil channel | On open buffered (cap > 0) | On open unbuffered | On closed |
|-----------|---------------|----------------------------|--------------------|------------|
| Send | blocks forever | blocks if full | blocks until receive | panic |
| Receive | blocks forever | blocks if empty | blocks until send | returns zero, ok=false |
| Close | panic | closes; receives drain then signal | closes; pending receives unblock with ok=false | panic |
| `len(ch)` | 0 | items in buffer | 0 | items in buffer (drains to 0) |
| `cap(ch)` | 0 | capacity | 0 | capacity |

The batching stage relies on:

- Send to open buffered: blocks for back-pressure when full.
- Receive from closed: detects end-of-stream.
- Close from sole owner: signals downstream completion.

---

## Appendix B — Context Hierarchy

`context.Context` forms a tree. Each child observes its parent.

```
context.Background()
  |
  v
context.WithCancel
  |     |
  |     +-- context.WithTimeout
  |
  +-- context.WithValue
```

The batching stage receives the leaf context and uses `ctx.Done()` for cancellation observation and `ctx.Err()` for diagnosis.

Cancellation flows top to bottom. Cancelling a parent cancels all descendants. Children cannot cancel their parents.

---

## Appendix C — Send-Receive Happens-Before

The Go memory model:

> The k-th receive on a channel with capacity C is synchronised before the completion of the (k+C)-th send.

For unbuffered channels (C=0): the k-th receive is synchronised before the completion of the k-th send. Effectively, send and receive happen-before each other; either ordering is observed by both goroutines.

For buffered channels (C>0): the k-th receive is synchronised before the (k+C)-th send. The first C sends can complete before any receive.

**Implication for batching.** When the accumulator sends `batch` and the consumer receives it, all of the accumulator's writes to `batch` (the `copy`) are visible to the consumer. Safe.

---

## Appendix D — Common Validation Rules

The canonical stage validates at construction or `Run` start:

- `In != nil` — required.
- `MaxSize > 0` — required.
- `MaxWait > 0` — required.
- If async: `Inflight > 0` and `Write != nil`.
- If sync: `Out != nil`.

These are programming errors, not runtime conditions; fail fast.

---

## Appendix E — Performance Characteristics

| Operation | Approximate cost |
|-----------|------------------|
| `select` with 3 ready cases | ~100 ns |
| Channel send (small struct) | ~50 ns |
| Channel receive | ~50 ns |
| `append` to non-full slice | ~5 ns |
| `append` to full slice (realloc) | ~100 ns + memcpy |
| `time.NewTimer` | ~200 ns |
| `time.Timer.Reset` | ~100 ns |
| `time.Now()` | ~30 ns |
| `make([]T, n)` | ~50 ns + memzero |
| `copy(dst, src)` (1000 ints) | ~500 ns |
| `sync.Pool.Get` | ~30 ns (hit), ~200 ns (miss) |
| `sync.Pool.Put` | ~30 ns |

Numbers are illustrative on a modern CPU. Useful for back-of-envelope.

---

## Appendix F — Version Compatibility

This folder's canonical patterns work on:

- Go 1.18+ (generic syntax).
- Go 1.20+ (`context.WithCancelCause`) for advanced diagnostics.
- Go 1.21+ (`slog`) for structured logging.
- Go 1.23+ (simplified `Timer.Reset`) for slightly cleaner code.

Pre-1.18 Go cannot use the generic patterns. Specialise per type or use `interface{}` (older style).

---

## Appendix G — Specification of the Canonical Function Signature

The single canonical signature is:

```go
func Batch[T any](
    ctx context.Context,
    in <-chan T,
    out chan<- []T,
    maxSize int,
    maxWait time.Duration,
)
```

Properties:

- Generic over item type `T`.
- Takes context as first parameter (Go convention).
- Read-only input channel.
- Write-only output channel.
- Two numeric tunables.

Variants in middle/senior/professional tier add: hooks, async configuration, builder methods. The base signature stays similar.

---

## Appendix H — Specification of Hooks

Hook signatures the canonical implementations use:

```go
type FlushHook[T any] func(reason Reason, batch []T)
type ErrorHook func(err error)
type CloseHook func()
type ClockHook func() Clock
```

Hooks are called synchronously from the accumulator's goroutine. They must not block significantly.

---

## Appendix I — Specification of Reason Values

The four canonical reason strings:

```go
const (
    ReasonSize   Reason = "size"
    ReasonTime   Reason = "time"
    ReasonClose  Reason = "close"
    ReasonCancel Reason = "cancel"
)
```

Pinned. Do not invent new ones casually. If a stage needs more nuance, add to the constants and document.

---

## Appendix J — Specification of Test Names

Conventional test names for batching stages:

- `TestBatch_SizeTrigger`
- `TestBatch_TimeTrigger`
- `TestBatch_FinalFlushOnClose`
- `TestBatch_FlushOnCancel`
- `TestBatch_NoEmptyBatches`
- `TestBatch_ConcurrentProducers`
- `TestBatch_DLQOnFailure` (for stages with DLQ)
- `TestBatch_OrderingPreserved` (for ordered variants)
- `TestBatch_BackPressure` (for bounded async)

These are the standard names. Future readers find them quickly.

---

## Final Notes

This specification file is intentionally compact. It serves as quick-reference for the contracts and guarantees the canonical patterns rely on. The implementation patterns themselves are in junior.md through professional.md.

When in doubt, consult the Go language spec and the Go memory model directly. They are the authoritative source. This file is a translation, not a substitute.

---

## Appendix K — Detailed Timer State Machine

A `*time.Timer` is in one of three states:

- **Active.** A future fire is scheduled. `C` is empty.
- **Fired-undrained.** The fire happened; one value is pending on `C`.
- **Stopped.** No fire scheduled. `C` may or may not contain a stale value.

Transitions:

- `NewTimer(d)`: → Active.
- `Stop()`:
  - From Active: → Stopped, returns true.
  - From Fired-undrained: → Stopped (but value still on C), returns false.
  - From Stopped: → Stopped, returns false.
- Fire (after `d`): Active → Fired-undrained.
- Receive `<-C`: Fired-undrained → Stopped.
- `Reset(d)`:
  - On all Go versions: should be called after Stop + drain. Result: → Active.
  - On Go 1.23+: can be called on any state; result is Active with any pending value discarded.

The canonical "stop and drain" pattern handles all transitions correctly:

```go
if !t.Stop() {
    select { case <-t.C: default: }
}
t.Reset(d)
```

If Stop returns true (was Active), nothing to drain. If false (was Fired-undrained or Stopped), the drain handles the pending value if any.

---

## Appendix L — Goroutine Lifecycle for Canonical Stage

The canonical stage's accumulator goroutine has this lifecycle:

1. **Start.** Called via `go Batch(...)`.
2. **Initialise.** Allocate buffer; create and stop timer.
3. **Main loop.** Park in `select`; wake on event; handle; repeat.
4. **Exit path 1 (input close).** Flush partial; return.
5. **Exit path 2 (cancellation).** Flush partial; return.
6. **Defer.** `close(out)` runs.
7. **Goroutine ends.** Stack frees.

For bounded async:

1-3 same.
3a. **Worker spawn.** N worker goroutines started.
4-6 same plus: after main loop, accumulator closes `jobs` and `wg.Wait()`s for workers.
7. **Accumulator goroutine ends.** Stack frees.

The worker goroutines each:

1. **Start.** Called via `go workerLoop(...)`.
2. **Main loop.** `for b := range jobs { write(b) }`.
3. **Exit.** When `jobs` closes.
4. **`wg.Done()`.**
5. **Goroutine ends.**

---

## Appendix M — Specification Quick Reference Card

```
TRIPLE TRIGGER
- Size:  inline if len(buf) >= maxSize
- Time:  case <-timer.C
- EOS:   case x, ok := <-in; if !ok
- Cancel: case <-ctx.Done()

OUTPUT
- chan<- []T
- defer close(out)
- cancellable send: select { case out <- batch: case <-ctx.Done(): }

BUFFER
- make([]T, 0, maxSize)
- buf = buf[:0] after flush
- copy(batch, buf) before send

TIMER
- *time.Timer (not Ticker)
- stop-and-drain on init and after flush
- Reset on empty->non-empty transition

REASON
- size, time, close, cancel

CONTRACT
- One accumulator owns out; closes it once.
- Producer owns in; closes it once.
- Cancellation via ctx.Done() only.
- EOS via input channel close only.
```

Pin to your desk.

---

## Appendix N — Conformance Test Suite

To verify any implementation conforms to the spec, run these tests:

1. **TestSizeTrigger.** Send `maxSize` items; expect one batch of exactly `maxSize`.
2. **TestTimeTrigger.** Send fewer; wait `maxWait + ε`; expect one batch of the partial size.
3. **TestFinalFlushOnClose.** Send items; close input; expect partial batch and channel close.
4. **TestFlushOnCancel.** Send items; cancel; expect partial batch (best-effort) and channel close.
5. **TestNoEmptyBatches.** Idle for `>maxWait`; expect no batches.
6. **TestCopyOnSend.** Verify batch slice is independent of internal buffer (modify buffer, see no change).
7. **TestCancellableSend.** Block consumer; cancel context; verify accumulator exits within bounded time.
8. **TestDoubleCloseSafety.** Run two cancellations; verify no panic.
9. **TestConcurrentProducers.** Multiple goroutines sending; verify no race.
10. **TestValidationErrors.** Bad inputs return errors.

A stage that passes all ten conforms to the spec.

---

## Appendix O — Anti-Spec — Things Not Required

The spec does NOT require:

- Ordering across batches (single-flusher gives it free; multi-worker async does not).
- Atomicity of batches at the sink (the sink may partially succeed).
- Exactly-once semantics (at-least-once is the norm).
- Lossless behaviour under cancellation (best-effort by spec).
- Memory bounds beyond `maxSize` per buffer (output channel may grow if consumer slow; consumer should bound).

Implementations may add these; the canonical does not.

---

This concludes the specification.



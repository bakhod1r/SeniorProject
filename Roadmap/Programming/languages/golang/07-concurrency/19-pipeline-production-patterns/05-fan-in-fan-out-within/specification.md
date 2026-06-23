---
layout: default
title: Fan-In Fan-Out Within — Specification
parent: Fan-In Fan-Out Within
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/05-fan-in-fan-out-within/specification/
---

# Fan-In / Fan-Out Inside a Pipeline — Specification

This file collects the formal contracts and invariants of fan-out / fan-in patterns. It is the reference engineers can quote in design reviews, code reviews, and architectural decisions.

## Vocabulary

- **Stage:** A function that takes one or more receive-only channels and returns one or more receive-only channels, plus a `context.Context` for cancellation.
- **Worker:** A goroutine inside a stage. A stage may have one or many workers.
- **Producer:** The goroutine that originally creates and sends to a channel.
- **Consumer:** The goroutine that receives from a channel.
- **Forwarder:** A goroutine inside a merge stage; reads from one input channel and writes to the merged output.
- **Closer:** The goroutine responsible for closing a channel.
- **Fan-out factor:** The number of workers in a fan-out stage.
- **Reorder buffer:** A data structure (map or heap) that holds out-of-order results until they can be emitted in order.

## Channel Ownership Invariants

For every channel `c` in a pipeline, exactly one goroutine is its **owner**. The owner:

1. Creates `c` via `make(chan T)` or `make(chan T, n)`.
2. Is the sole writer to `c` (or coordinates with others via `WaitGroup` if there are multiple writers).
3. Is the sole closer of `c`.

A non-owner goroutine MUST NOT:
- Close `c`.
- Assume `c` will be closed by any particular time.
- Hold a reference to `c` after the owner has closed it.

## Send / Receive Invariants

1. A send on a closed channel panics.
2. A receive on a closed channel returns the zero value and `ok=false` after the buffer is drained.
3. A receive on a nil channel blocks forever.
4. A send on a nil channel blocks forever.
5. `close(nil_channel)` panics.
6. `close(closed_channel)` panics.
7. `close` is non-blocking; it sets the closed flag and wakes all waiters (receivers get zero+false, senders panic).

## Merge Function Contract

A canonical merge function `merge(ctx, c1, ..., cN) -> out`:

1. Returns a receive-only channel `out` of the same element type.
2. Spawns one forwarder goroutine per input channel.
3. Each forwarder reads from its input and forwards to `out`, with `<-ctx.Done()` guard on every send.
4. A closer goroutine waits for all forwarders to exit, then closes `out`.
5. `out` is closed exactly once, after all input channels are closed AND all forwarders have exited.
6. The caller MUST NOT send to `out` (enforced at compile time by `<-chan T` return type).
7. The caller MUST NOT close `out`.
8. If `ctx` is cancelled, all forwarders exit promptly; `out` then closes.

## Fan-Out Worker Pool Contract

A canonical worker pool `pool(ctx, in, n, fn) -> out`:

1. `in` is a receive-only channel of inputs.
2. `n` is the worker count, fixed at construction.
3. `fn` is the per-item transform.
4. Returns a receive-only channel `out` of outputs.
5. Spawns `n` worker goroutines, each reading from `in`.
6. Each worker writes to `out`, with `<-ctx.Done()` guard.
7. A closer goroutine waits for all workers; then closes `out`.
8. Order of outputs is NOT guaranteed to match order of inputs (unless tagged-and-reordered).
9. The pool exits when `in` is closed AND all workers have finished OR when `ctx` is cancelled.

## Cancellation Contract

For a stage that accepts `context.Context`:

1. The stage SHOULD respect `ctx.Done()` in every blocking operation.
2. On `ctx.Done()` close, the stage SHOULD exit as quickly as possible.
3. The stage SHOULD release all resources on exit (close channels it owns, release pooled buffers, close files).
4. The stage SHOULD NOT leak goroutines after cancellation.
5. The stage MUST NOT panic on cancellation.

## Backpressure Contract

In a pipeline using only unbuffered or modestly-buffered channels:

1. The producer's rate is bounded by the slowest stage's rate.
2. There is no unbounded queue between stages.
3. If a consumer pauses, the producer eventually pauses too.

Violations: channels with very large buffers, or stages that use `default` clause in select to drop on full. These remove the backpressure property and require explicit drop accounting.

## Ordering Contract

By default, fan-out destroys order. To restore order, use tag-and-reorder:

1. Tag each input with a monotonically-increasing sequence number at the source.
2. Workers preserve the sequence number on the output.
3. A reorder stage emits results in sequence-number order.

The reorder stage:
- Holds out-of-order results in a buffer (map or min-heap).
- Emits the next-expected sequence as soon as it is available.
- May stall if the reorder buffer exceeds a cap.

Round-robin merge preserves order ONLY if the dispatcher pre-assigns items in round-robin (not the runtime's automatic load balancing).

## Error Propagation Contract

Three patterns:

### Pattern A: Result[T] union

Each pipeline item is a `Result[T]` containing either a value or an error. The consumer inspects each result.

### Pattern B: errgroup

Workers return `error`. The first non-nil error cancels the group's context. All workers exit. `g.Wait()` returns the first error.

### Pattern C: DLQ

Errors are sent to a separate "dead-letter queue" channel. The main pipeline continues with successes only.

The pattern MUST be documented per pipeline. Mixing without coordination is a bug.

## Resource Lifecycle Contract

For any resource held by a worker (file handle, network connection, database transaction):

1. Acquire at start of work.
2. Release before exit (`defer` is canonical).
3. On panic recovery, release if possible.
4. On ctx cancellation, release.

A leaked resource is a leaked goroutine indicator.

## Goroutine Lifecycle Contract

For every goroutine spawned by the pipeline:

1. It has a known entry condition (the `go` statement).
2. It has at least one known exit condition (input channel closed, ctx cancelled, work complete).
3. The exit condition is reached in all execution paths.
4. On exit, all resources are released and all owned channels are closed.

`goleak.VerifyNone(t)` enforces these at test time.

## Buffer Size Specification

Default buffer sizes:

- Channel from a producer to a fan-out: 0 (unbuffered).
- Per-worker output channel: 0 or 1.
- Merged output channel: 0 to N (worker count).
- Cross-stage channel: 0.
- Tag-and-reorder buffer: bounded by expected straggler distance (typically O(N)).

Any non-zero buffer SHOULD be documented with a comment explaining the size.

## Performance Contract

A fan-out / fan-in stage's overhead per item is approximately:

- 1 producer send + 1 worker receive: ~200 ns
- N workers parallel work: bounded by slowest worker
- 1 worker send + 1 forwarder receive: ~200 ns
- 1 forwarder send + 1 consumer receive: ~200 ns

Total channel overhead: ~600-800 ns per item, plus goroutine scheduling overhead (~300-1500 ns per item).

The stage adds linear overhead to per-item latency and is scalable in throughput up to the slowest stage's capacity.

## Testing Contract

A pipeline test MUST:

1. Run under `-race`.
2. Verify the output count matches the input count.
3. Verify no goroutines leak (use `goleak.VerifyNone(t)`).
4. Verify cancellation shuts down the pipeline within a bounded time.
5. Verify error injection produces expected error propagation.

A pipeline test SHOULD:

6. Verify ordering if order is a requirement.
7. Verify backpressure if the pipeline claims it.
8. Verify throughput against an established baseline.

## Documentation Contract

A pipeline implementation MUST document:

1. The shape of the pipeline (stages, fan-out factors).
2. Channel ownership (who writes, who reads, who closes each).
3. Failure modes (what panics, what errors, what restarts).
4. Resource caps (max goroutines, max memory).
5. The cancellation behavior.
6. The buffer sizes and their justifications.

## Deployment Contract

A production pipeline:

1. Exposes metrics for items/sec, errors/sec, latency, in-flight, goroutine count.
2. Has alerting on critical metrics (lag, errors, goroutine count).
3. Has a graceful shutdown procedure with a drain timeout.
4. Has a runbook for common failures.
5. Has been load-tested at 2x expected peak.

## Composition

A pipeline composition `A → B → C → ... → Z`:

1. Each stage's output is the next stage's input.
2. Each stage gets the same `context.Context` (or a derived one).
3. Cancellation of `ctx` cancels all stages.
4. Closing the source's output propagates downstream as each stage's input closes.
5. The end of pipeline (the final consumer) reads until the final stage's output closes.

## Equivalence

Two pipelines are equivalent if and only if:

1. They produce the same output for every input.
2. They have the same termination behavior (ctx cancellation, source close).
3. They have the same resource bounds.

Throughput and latency are not part of equivalence; they are performance properties.

## Limits

The following are platform / Go-runtime limits:

- Max goroutines: practically ~1 million per GB of RAM.
- Max channel buffer: capped by available memory.
- Max select cases (static): 65536.
- Max reflect.Select cases: limited by slice; practically ~10 000 efficient.
- Max stack per goroutine: 1 GB (configurable via `debug.SetMaxStack`).

## Conformance

A fan-out / fan-in implementation is *conformant* to this specification if it:

1. Implements the merge or pool function contract.
2. Respects channel ownership.
3. Respects cancellation.
4. Provides backpressure (unless explicitly disabled with documentation).
5. Has tests covering the contracts.

Code review against this specification is recommended for every pipeline before merge to main.

---

This specification is a living document. It records the agreements we make as a team about how fan-out / fan-in should behave. When evolving, update this file, update the tests, then update the implementation.

---

## Detailed Channel Operation Semantics

The following formal semantics describe behavior of channel operations relevant to fan-out / fan-in pipelines. They are derived from the Go specification and runtime behavior.

### Send Operation

Given `ch <- v`:

1. If `ch` is `nil`, the operation blocks forever (the goroutine parks).
2. If `ch` is closed, the operation panics with "send on closed channel".
3. If `ch` is unbuffered:
   a. If a goroutine is waiting on `ch` for receive, the value is transferred directly; both goroutines continue.
   b. Otherwise, the sending goroutine parks until a receiver arrives.
4. If `ch` is buffered:
   a. If a goroutine is waiting on `ch` for receive (rare for buffered), direct transfer.
   b. If `len(ch) < cap(ch)`, the value is copied into the buffer; the sender continues.
   c. If `len(ch) == cap(ch)`, the sender parks until space is available.

### Receive Operation

Given `v, ok := <-ch` or `v := <-ch`:

1. If `ch` is `nil`, the operation blocks forever.
2. If `ch` is closed:
   a. If `len(ch) > 0`, the next value from the buffer is returned with `ok == true`.
   b. If `len(ch) == 0`, the zero value is returned with `ok == false` (in two-result form) or with no error (in single-result form).
3. If a goroutine is waiting on `ch` for send (parked sender), the value is taken from it directly; both goroutines continue.
4. If `len(ch) > 0`, the next value is returned from the buffer; the next parked sender (if any) deposits into the freed slot.
5. Otherwise, the receiver parks until a sender arrives or the channel is closed.

### Close Operation

Given `close(ch)`:

1. If `ch` is `nil`, the operation panics.
2. If `ch` is already closed, the operation panics.
3. Otherwise:
   a. The channel's closed flag is set.
   b. All goroutines parked on the channel's recvq are woken; they receive the zero value with `ok == false`.
   c. All goroutines parked on the channel's sendq are woken; they panic with "send on closed channel".

### Select Operation

A `select` statement with N cases:

1. If any case can proceed without blocking, one of the ready cases is chosen pseudo-randomly.
2. If a `default` case exists and no other case is ready, the `default` runs.
3. If no `default` and no case is ready, the goroutine parks; the select fires when any case becomes ready.

A `nil` channel in a select case is treated as "never ready" — the case is effectively disabled.

## Forwarder Goroutine Semantics

Inside a merge function, each forwarder goroutine satisfies:

1. It reads from one input channel `c` via `for v := range c { ... }` or an equivalent select pattern.
2. It writes each value to the merged output `out` via a select that includes `<-ctx.Done()`.
3. It exits when:
   a. `c` is closed (the for-range loop ends naturally), OR
   b. `ctx.Done()` is closed (the select picks the cancellation case).
4. It calls `wg.Done()` before exit (via `defer wg.Done()` at the top).
5. It does not close `out`. It does not close `c`.

## Worker Goroutine Semantics

Inside a fan-out worker:

1. It reads from a shared input channel `in`.
2. It performs work for each item.
3. It writes the result to an output channel `out` (per-worker or shared).
4. It honors `ctx.Done()` on every blocking operation.
5. It closes `out` (if per-worker) before exit via `defer close(out)`.
6. It calls `wg.Done()` before exit if part of a `WaitGroup` group.
7. It recovers panics if the work can panic on untrusted input.

## Closer Goroutine Semantics

A closer goroutine inside a merge or pool:

1. Waits on `wg.Wait()` until all forwarders or workers have exited.
2. Closes the merged output channel exactly once.
3. Returns.

The closer is independent of the merge function's return. The merge function returns the output channel immediately; the closer runs in the background until all upstream goroutines finish.

## Supervisor Goroutine Semantics

A supervisor that monitors a worker:

1. Invokes the worker function.
2. On worker exit:
   a. If error is `nil` or `context.Canceled`, supervisor exits.
   b. If error indicates transient failure, supervisor waits a backoff period and re-invokes.
   c. If error indicates fatal failure, supervisor escalates (returns the error to its parent).
3. The supervisor respects `ctx.Done()` during backoff.

The supervisor MUST NOT loop forever on context cancellation; it must check and return.

## Backpressure Propagation Theorem

Given a pipeline with stages S1, S2, ..., Sn, each connected by unbuffered or modestly-buffered channels:

1. The maximum sustained throughput is `min(throughput(Si))` over all stages.
2. The producer's effective rate equals the slowest stage's rate.
3. The pipeline applies backpressure: if any consumer pauses, the producer eventually pauses.
4. Memory in flight is bounded: sum of all channel buffers plus per-stage in-flight items.

Buffers larger than O(1) introduce a "latency window" during which the producer can outrun the consumer. Beyond that window, backpressure resumes.

## Ordering Theorem

Given a fan-out worker pool with N workers:

1. By default, the output order is NOT a function of the input order.
2. With tag-and-reorder (sequence-number tagging at input, heap-based reorder at output), the output order matches the input order, with a memory bound proportional to the maximum straggler distance.
3. With round-robin dispatch (input item i to worker i mod N) and round-robin merge (read from worker output i mod N), the output order matches the input order if and only if work is uniform across workers.

## Cancellation Latency Theorem

Given a pipeline with K stages and the longest blocking operation being a channel op (no syscalls or unbounded loops):

1. The maximum time from `cancel()` to full pipeline shutdown is bounded by K * select_latency (typically a few microseconds total).
2. If any stage has unbounded blocking (uncancellable syscall, infinite loop without select), cancellation is unbounded.
3. Tests SHOULD verify cancellation latency.

## Equivalence Classes

Two channel operations are *equivalent* if they have the same observable behavior. For example:

- `for v := range c` is equivalent to `for { v, ok := <-c; if !ok { break }; ... }`.
- `ch <- v` followed by `close(ch)` (single-value channel) is equivalent to writing to a buffered channel of cap 1.
- A merge of N=1 channels is equivalent to the input channel (modulo an extra forwarder goroutine).

Equivalence is useful for refactoring without changing behavior.

## Constraints on Implementations

A conformant `merge[T]` implementation MUST:

1. Accept a variable number of input channels via `...<-chan T`.
2. Return a `<-chan T`.
3. Accept a `context.Context` first argument.
4. Spawn at most O(N+1) goroutines where N is the number of inputs.
5. Use a `sync.WaitGroup` or equivalent to coordinate forwarder exits.
6. Close the output channel exactly once.
7. Have a closer goroutine separate from the forwarders.
8. Handle the zero-input case gracefully (return an immediately-closed channel).
9. Handle `nil` input channels by ignoring them (or panic — but ignoring is preferred).

## Conformance Tests

A conformant implementation passes:

```go
func TestMergeAllValues(t *testing.T) {
    // Three channels each emitting some values; merge produces all of them.
}

func TestMergeClosesWhenAllInputsClose(t *testing.T) {
    // After all inputs close, merge's output also closes.
}

func TestMergeRespectsCancellation(t *testing.T) {
    // After cancel(), merge's output closes within a bounded time.
}

func TestMergeNoLeaks(t *testing.T) {
    // goleak.VerifyNone(t) after merge completes.
}

func TestMergeZeroInputs(t *testing.T) {
    // merge() with no arguments returns an immediately-closed channel.
}

func TestMergeSingleInput(t *testing.T) {
    // merge with one input behaves like a transparent forwarder.
}
```

A pool implementation passes analogous tests.

## Cross-Stage Contracts

When composing stages A and B such that A's output is B's input:

1. The same `context.Context` is passed to A and B.
2. A closes its output channel when its work is done.
3. B reads from A's output until it closes.
4. B closes its own output channel when it has finished forwarding A's output (or when ctx cancels).
5. Cancellation of ctx cancels both A and B.

## Reorder Stage Contract

A reorder stage `reorder(ctx, in) -> out`:

1. Reads tagged values `(seq, val)` from `in`.
2. Maintains a buffer of pending tagged values keyed by `seq`.
3. Emits values in order of sequence number to `out`.
4. The reorder buffer has a maximum size; if exceeded, the stage stalls (applies backpressure) or panics (configurable).
5. On `ctx.Done()`, the stage exits; pending values are discarded.
6. `out` is closed when `in` is closed AND the next-expected sequence is unreachable, OR when ctx cancels.

## Hedged Request Contract

A hedged request fan-out:

1. Sends the request to one primary replica immediately.
2. After a delay, sends to a secondary replica.
3. Whichever responds first is the returned result.
4. The slow replica is cancelled via context.
5. The returned result is propagated to the caller; the cancelled replica's response is discarded.
6. If both fail, the last error is returned.

## Auto-scaler Contract

An auto-scaler for fan-out worker count:

1. Has a minimum and maximum worker count.
2. Periodically measures load (e.g., channel fill, latency).
3. Adjusts worker count gradually (one at a time) to avoid oscillation.
4. Uses hysteresis: threshold to add < threshold to remove.
5. Respects min/max bounds.
6. On cancellation, stops adjusting; workers exit as they finish.

## Bulkhead Contract

A bulkheaded fan-out:

1. Per-worker errors are caught locally (recovered or logged).
2. Per-worker errors do NOT propagate as group errors (do not cancel siblings).
3. Critical errors (out-of-memory, fatal) MAY escalate.
4. Each worker has a private resource budget.

## Specification Versioning

This specification is versioned. Changes:

- Major version: incompatible changes (e.g., changed signatures).
- Minor version: new optional features.
- Patch: documentation clarifications.

Current version: 1.0.

When a project depends on this specification, it should pin the version.

## Glossary of Specification Terms

- **MUST:** required for conformance.
- **MUST NOT:** prohibited for conformance.
- **SHOULD:** strongly recommended; departures require justification.
- **MAY:** optional.
- **MAY NOT:** optional opposite of SHOULD.

These are the standard RFC 2119 keywords.

## End of Specification

This document is intended to be read together with the junior, middle, senior, and professional files. The specification is the formal layer; the other files are the educational layer.

For questions or proposed amendments, raise an issue against this file with the rationale and example.

## Appendix A: Canonical Implementations

### Canonical merge

```go
func merge[T any](ctx context.Context, cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        c := c
        go func() {
            defer wg.Done()
            for v := range c {
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

### Canonical worker pool

```go
func pool[I, O any](ctx context.Context, in <-chan I, n int, fn func(I) O) <-chan O {
    out := make(chan O)
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for v := range in {
                r := fn(v)
                select {
                case out <- r:
                case <-ctx.Done():
                    return
                }
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

### Canonical reorder

```go
type Tagged[T any] struct {
    Seq int
    Val T
}

func reorder[T any](ctx context.Context, in <-chan Tagged[T]) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        next := 0
        pending := make(map[int]T)
        for t := range in {
            pending[t.Seq] = t.Val
            for {
                v, ok := pending[next]
                if !ok {
                    break
                }
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
                delete(pending, next)
                next++
            }
        }
    }()
    return out
}
```

These implementations are the reference. Variations exist for performance, but the contract is the same.

## Appendix B: Conformance Statement

Any pipeline component claiming conformance with this specification SHOULD include in its package documentation:

> This package implements [version X.Y] of the Fan-In / Fan-Out specification. The conformance tests in conformance_test.go verify the contract.

This makes the contract auditable.

## Appendix C: Specification History

- Version 1.0: Initial. Defines core fan-out / fan-in patterns, merge contract, pool contract, cancellation, backpressure, ordering.
- (Future versions to be added as the specification evolves.)

End of specification document.



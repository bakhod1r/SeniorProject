---
layout: default
title: Specification
parent: Fan-Out Within Pipeline
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/03-fan-out-within-pipeline/specification/
---

# Fan-Out Within a Pipeline Stage — Specification

This document defines the formal contract of fan-out within a pipeline stage as used in this Roadmap. It is the reference any implementation must satisfy.

## Definitions

- **Stage**: a function with the signature `func(ctx context.Context, in <-chan T) <-chan U` (or a parameterised variant). It reads from `in`, processes items, and writes to its returned output channel.
- **Worker**: a goroutine spawned inside a stage that reads from `in` and writes to the stage's output channel.
- **Width N**: the number of workers in a fanned-out stage. N >= 1.
- **Closer**: a single goroutine spawned by the stage whose only operations are `wg.Wait()` followed by `close(out)`.
- **Input channel**: the channel the stage reads from. It is closed by its producer (not by the stage).
- **Output channel**: the channel the stage writes to. It is closed exactly once, by the closer goroutine.
- **Result**: the data written to the output channel for one input item. May carry an associated error.

## Producer-Closes-Its-Output Rule

The producer of a channel is the goroutine or stage responsible for closing it. Specifically:

- The producer that feeds `in` must close `in` when no more items will be sent.
- The fanned-out stage that produces `out` must close `out` exactly once after all workers have exited.
- No worker may close `in` or `out` directly.

This rule is a global invariant of the pattern.

## Lifecycle

A fanned-out stage has the following lifecycle, in order:

1. Stage function is called with `(ctx, in, ...)`.
2. Stage creates `out := make(chan U[, buffer])` and `wg := sync.WaitGroup{}`.
3. Stage spawns N worker goroutines and one closer goroutine. Each worker is `Add(1)`'d before being spawned.
4. Stage returns `out` (as `<-chan U`) to the caller.
5. Workers loop: receive from `in`, do work, send to `out`. They observe `ctx.Done()` if applicable.
6. When `in` is closed and drained, each worker exits its loop and calls `wg.Done()` via `defer`.
7. When all workers have exited, `wg.Wait()` in the closer returns.
8. Closer calls `close(out)`.
9. Consumer's range over `out` ends.

The lifecycle terminates cleanly under two conditions: producer closed `in`, or context was cancelled. Both must result in all goroutines exiting and `out` being closed exactly once.

## Ordering Guarantees

A fanned-out stage may declare one of three ordering modes:

- **Unordered**: items in `out` are not in any particular relation to items in `in`. Permutations are allowed.
- **Ordered (strict)**: items in `out` appear in the same order as items in `in`. Implementation uses sequence numbers and a reorder buffer, or per-worker queues with deterministic dispatch.
- **Windowed (size W)**: items in `out` appear in the same order as items in `in` modulo a window of size W. Items more than W positions late may be skipped or reordered.

The mode must be documented in the stage's doc comment. Default is unordered.

## Error Semantics

A fanned-out stage may declare one of three error modes:

- **Continue-on-error (default)**: errors per item are reported in the result struct's `Err` field. The pipeline continues processing other items.
- **Fail-fast**: on the first non-nil error from any worker, all workers are cancelled (via `ctx`), the output is closed, and the error is propagated. Implementation typically uses `errgroup.WithContext`.
- **First-success**: the first successful result terminates other workers. Used for replica-style fan-out.

The mode must be documented. Default is continue-on-error.

## Cancellation Contract

If the stage accepts a `context.Context`:

- Workers must observe `<-ctx.Done()` in every blocking operation: receive from `in`, send to `out`, and (if applicable) within the work function.
- On context cancellation, all workers must exit within a bounded time (typically < 10 ms in CPU-bound code; bounded by the longest non-cancellable operation in I/O-bound code).
- The closer must run after all workers exit, regardless of whether cancellation or normal completion triggered the exit.
- In-flight items at the time of cancellation may be lost or partially processed. Stages requiring at-least-once semantics must implement an outbox or queue mechanism (out of scope for the channel-based pattern).

## Concurrency Bounds

- N >= 1. N = 0 is invalid.
- N must be passed as a parameter or read from configuration; it must not be a hard-coded constant in production code.
- The maximum N may be capped by:
  - Hardware: `runtime.NumCPU()` for CPU-bound stages.
  - External: connection pool size, rate limit, dependency capacity.
  - Memory: per-worker resource requirements times N must fit available memory.

## Channel Semantics

- `in` may be buffered or unbuffered; both are correct.
- `out` may be buffered or unbuffered; both are correct.
- The capacity of `out` should be modest (typically N to 2N). Larger buffers do not improve throughput in steady state and may hide problems.
- `in` and `out` are distinct channels of distinct types. A worker never sends to `in` and never receives from `out`.

## Independence of Items

A fanned-out stage assumes its items are independent: processing of item i does not depend on item j for any j != i (in the unordered case). For ordered modes, the dependency is restricted to sequence-number ordering; the work function itself remains item-local.

Stages whose items have data dependencies are not appropriate for fan-out and must be expressed as a sequential stage or as per-key fan-out (which partitions by dependency key).

## Statelessness of Workers

Workers must not share mutable state without synchronisation. Specifically:

- Two workers writing to the same map or slice index without atomics or locks is undefined behaviour.
- Workers may share immutable configuration (HTTP client, regex, logger).
- Workers may have private state allocated before the worker loop and used only by that worker.
- The result-struct pattern is preferred for cross-worker communication; explicit shared state is the exception.

## Single Closer Invariant

The output channel `out` is closed exactly once. The closer goroutine is the only goroutine that calls `close(out)`. No worker calls `close(out)`. No other goroutine in the pipeline calls `close(out)`.

Violation of this invariant causes panic (`send on closed channel`) or double-close panic.

## Backpressure

A stage propagates backpressure naturally via channel blocking:

- If the consumer of `out` reads slowly, workers block on `out <-`.
- Blocked workers stop reading from `in`.
- The producer of `in` blocks on `in <-`.

A stage must not buffer indefinitely to mask consumer slowness. Bounded buffers are required.

## Resource Cleanup

Workers must clean up resources via `defer`:

- File handles, network connections, locks acquired during item processing must be released regardless of success, error, or cancellation.
- Per-worker resources (per-worker HTTP clients, buffers) live for the worker's lifetime and are GC'd when the worker exits.

## Test Conformance

An implementation conforms to this specification if:

1. With non-empty input and no errors, all input items are produced as output items exactly once.
2. With empty input and a normal close, the output channel closes without producing items.
3. With N = 1, behaviour is equivalent to a single-worker stage (modulo channel capacity).
4. With N > 1 and parallel-safe work, throughput improves up to the bottleneck.
5. With context cancellation, all workers exit within a bounded time and the output channel closes.
6. With `-race`, no data races are reported.
7. With repeated execution under load, no goroutines leak.

## Doc Comment Template

```go
// hashFiles fans out N workers reading file paths from in,
// computing SHA-256 hashes, and writing FileHash results to its output channel.
//
// Ordering:    Unordered. Output items may appear in any order relative to input.
// Errors:      Continue-on-error. Per-item errors are reported in FileHash.Err.
// Cancellation: Honors ctx. Workers exit within ~5ms of ctx.Done().
// Width:       N must be >= 1. Recommended: runtime.NumCPU() for CPU-bound hash work.
// Channels:    Reads from in until closed. Closes its output channel exactly once when all workers exit.
//
// The caller must close in when no more paths will be sent.
// The caller must drain the output channel (range over it) to avoid leaking workers.
func hashFiles(ctx context.Context, in <-chan string, n int) <-chan FileHash {
    ...
}
```

Every fanned-out stage in production code should have a doc comment of this shape.

## Permitted Deviations

A stage may deviate from defaults if documented:

- Different ordering mode (strict, windowed).
- Different error mode (fail-fast, first-success).
- Width derived from runtime (`runtime.NumCPU()`) — must be explicit.
- Internal use of `errgroup` or `semaphore` — must be documented in the comment.

Undocumented deviations are bugs.

## Versioning

This specification, version 1.0, applies to Go 1.21 and later. Earlier Go versions lack `context.WithoutCancel` and have slightly different loop-variable semantics in goroutine closures. Implementations for older Go must be adjusted accordingly.

## Out of Scope

The following are not specified by this document:

- Cross-host fan-out (queue-based; covered in the distributed-systems track).
- Adaptive concurrency control algorithms (recommended in the professional file but not normative).
- Specific metrics names and label conventions (project-specific).
- Hedging policy details (project-specific).

A future revision may incorporate these.

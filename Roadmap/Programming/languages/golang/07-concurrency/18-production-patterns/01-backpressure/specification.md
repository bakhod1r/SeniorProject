---
layout: default
title: Specification
parent: Backpressure
grand_parent: Production Patterns
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/01-backpressure/specification/
---

# Backpressure — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Channel Semantics (Language Spec)](#channel-semantics-language-spec)
3. [Bounded Channel Behaviour](#bounded-channel-behaviour)
4. [The `select` Statement and Backpressure](#the-select-statement-and-backpressure)
5. [Context Cancellation Semantics](#context-cancellation-semantics)
6. [`golang.org/x/sync/semaphore` Semantics](#golangorgxsyncsemaphore-semantics)
7. [HTTP/2 Flow Control (RFC 7540)](#http2-flow-control-rfc-7540)
8. [gRPC Status Codes for Backpressure](#grpc-status-codes-for-backpressure)
9. [HTTP Status Codes (RFC 9110)](#http-status-codes-rfc-9110)
10. [Memory Model Considerations](#memory-model-considerations)
11. [Garbage Collector Interactions](#garbage-collector-interactions)
12. [Runtime Guarantees and Non-Guarantees](#runtime-guarantees-and-non-guarantees)
13. [References](#references)

---

## Introduction

This page collects the formal, normative descriptions of Go primitives and protocols that underlie backpressure. Where the standards leave behaviour unspecified, those gaps are noted.

The relevant normative sources are:

- **The Go Programming Language Specification** (`go.dev/ref/spec`) — channel and `select` semantics.
- **The Go Memory Model** (`go.dev/ref/mem`) — ordering guarantees of channel operations.
- **The `runtime` and `sync` package documentation** — APIs and guarantees.
- **RFC 7540 (HTTP/2)** — flow control.
- **RFC 9110 (HTTP Semantics)** — 429 / 503 status codes.
- **`golang.org/x/sync/semaphore`** — weighted semaphore API.

This page is a reference. The conceptual material is in the level pages.

---

## Channel Semantics (Language Spec)

From `https://go.dev/ref/spec#Channel_types`:

> The capacity, in number of elements, sets the size of the buffer in the channel. If the capacity is zero or absent, the channel is unbuffered and communication succeeds only when both a sender and receiver are ready. Otherwise, the channel is buffered and communication succeeds without blocking if the buffer is not full (sends) or not empty (receives).

Normative points:

1. `make(chan T)` and `make(chan T, 0)` are equivalent.
2. Capacity is a non-negative integer; specified at creation; never changes.
3. An unbuffered send blocks until a receive is ready (and vice versa).
4. A buffered send blocks only when the buffer is full.
5. A buffered receive blocks only when the buffer is empty (and the channel is not closed).

From `https://go.dev/ref/spec#Send_statements`:

> Communication blocks until the send can proceed. A send on an unbuffered channel can proceed if a receiver is ready. A send on a buffered channel can proceed if there is room in the buffer. A send on a closed channel proceeds by causing a run-time panic.

From `https://go.dev/ref/spec#Receive_operator`:

> Receiving from a nil channel blocks forever. Receiving from a closed channel returns the zero value of the channel's type after any previously sent values have been received, with `ok` set to false.

These rules together describe the entire blocking-send mechanism that underlies channel-based backpressure.

---

## Bounded Channel Behaviour

A buffered channel `make(chan T, N)` provides the following guarantees:

- Sends succeed without blocking when `len(ch) < N`.
- Sends block when `len(ch) == N` until a receive frees a slot.
- Order is FIFO across sends from the *same* goroutine on the *same* channel. Across goroutines, order is unspecified except that each goroutine sees its own sends in program order.
- `len(ch)` returns the current count of buffered items; `cap(ch)` returns N.

The runtime does not provide fairness guarantees among multiple senders blocked on the same full channel. The implementation typically uses FIFO order on the sender wait queue, but this is not normative.

---

## The `select` Statement and Backpressure

From `https://go.dev/ref/spec#Select_statements`:

> Execution of a "select" statement proceeds in several steps:
>
> 1. For all the cases in the statement, the channel operands of receive operations and the channel and right-hand-side expressions of send statements are evaluated exactly once, in source order, upon entering the "select" statement.
> 2. If one or more of the communications can proceed, a single one that can proceed is chosen via a uniform pseudo-random selection.
> 3. If no communication can proceed and there is a default case, the default case executes.
> 4. Otherwise, the "select" statement blocks until at least one of the communications can proceed.

Backpressure-relevant implications:

- `select { case ch <- x: default: }` is a *non-blocking send*. It evaluates the send case; if it cannot proceed immediately, the default runs.
- `select { case ch <- x: case <-ctx.Done(): }` is a *send with cancellation*. The send proceeds only if a slot is available or the context fires.
- When multiple cases are ready, the choice is pseudo-random — there is no priority among cases.
- A `nil` channel in a case is never ready. This is the documented way to "disable" a case.

---

## Context Cancellation Semantics

From the `context` package documentation:

> A `Done` channel is closed when work done on behalf of this context should be canceled. `Done` may return `nil` if this context can never be canceled. Successive calls to `Done` return the same value. The close of the `Done` channel may happen asynchronously, after the cancel function returns.

A context's `Done()` channel:

- Is closed exactly once.
- Closure is observable by all receivers.
- After closure, `Err()` returns a non-nil error (`Canceled`, `DeadlineExceeded`, or a wrapped equivalent).
- Cancellation propagates to derived contexts.

Used in backpressure:

```go
select {
case ch <- x:
case <-ctx.Done():
    return ctx.Err()
}
```

The semantics: send if you can, give up if the context fires. Either branch is reachable; pseudo-random choice if both are simultaneously ready.

---

## `golang.org/x/sync/semaphore` Semantics

From the package documentation:

> `Acquire` acquires the semaphore with a weight of `n`, blocking until resources are available or `ctx` is done. On success, returns nil. On failure, returns `ctx.Err()` and leaves the semaphore unchanged.

> `TryAcquire` acquires the semaphore with a weight of `n` without blocking. On success, returns true. On failure, returns false and leaves the semaphore unchanged.

> `Release` releases the semaphore with a weight of `n`.

Normative points:

1. `Acquire(ctx, n)` succeeds atomically; partial acquires are not possible.
2. `TryAcquire(n)` returns immediately; does not respect context.
3. Releasing more weight than has been acquired results in a panic.
4. Waiters are served roughly in FIFO order, but precise fairness is not guaranteed.
5. The semaphore is goroutine-safe.

---

## HTTP/2 Flow Control (RFC 7540)

From RFC 7540, section 5.2:

> Flow control operates at two levels in HTTP/2: on each individual stream and on the connection as a whole. Both types of flow control are hop-by-hop; that is, only between the two endpoints. Intermediaries do not forward `WINDOW_UPDATE` frames between dependencies.

Key normative points:

1. The initial value of the flow-control window is 65,535 bytes per stream and per connection.
2. Senders cannot send more `DATA` frame payload than the window allows.
3. `WINDOW_UPDATE` frames increment the receiver's available window.
4. Window updates can be sent at any granularity; receivers should send them frequently enough to maintain throughput.
5. `SETTINGS_INITIAL_WINDOW_SIZE` parameter can change the initial window for streams.

In Go, the `golang.org/x/net/http2` package implements RFC 7540 and exposes window size configuration via `Transport` and `Server` fields.

---

## gRPC Status Codes for Backpressure

From the gRPC status code definitions:

- **`RESOURCE_EXHAUSTED`** (8): Some resource has been exhausted, perhaps a per-user quota, or perhaps the entire file system is out of space.
- **`UNAVAILABLE`** (14): The service is currently unavailable. This is most likely a transient condition, which can be corrected by retrying with a backoff.
- **`DEADLINE_EXCEEDED`** (4): The deadline expired before the operation could complete.

By convention:

- `RESOURCE_EXHAUSTED` is the gRPC equivalent of HTTP 429 (Too Many Requests).
- `UNAVAILABLE` is the gRPC equivalent of HTTP 503 (Service Unavailable).
- `DEADLINE_EXCEEDED` is the equivalent of context-driven timeout / client gave up.

Clients are expected to apply exponential backoff with jitter on `UNAVAILABLE` and `RESOURCE_EXHAUSTED`. The `grpc-retry` interceptor in the standard Go gRPC library implements this.

---

## HTTP Status Codes (RFC 9110)

From RFC 9110:

### 429 Too Many Requests

> The 429 status code indicates that the user has sent too many requests in a given amount of time ("rate limiting"). The response representations SHOULD include details explaining the condition, and MAY include a `Retry-After` header field indicating how long to wait before making a new request.

### 503 Service Unavailable

> The 503 (Service Unavailable) status code indicates that the server is currently unable to handle the request due to a temporary overload or scheduled maintenance, which will likely be alleviated after some delay. The server MAY send a `Retry-After` header field to suggest an appropriate amount of time for the client to wait before retrying the request.

### `Retry-After` header

> The "Retry-After" header field can be used to indicate how long the user agent ought to wait before making a follow-up request. When sent with a 503 (Service Unavailable) response, Retry-After indicates how long the service is expected to be unavailable to the client.

Two formats:
- Delay in seconds: `Retry-After: 120`
- Absolute date: `Retry-After: Fri, 31 Dec 2023 23:59:59 GMT`

These status codes are the standard cross-service backpressure protocol for HTTP.

---

## Memory Model Considerations

From the Go Memory Model (`https://go.dev/ref/mem`):

> A send on a channel happens before the corresponding receive from that channel completes.

> The closing of a channel happens before a receive that returns because the channel is closed.

These guarantees mean that all writes done before a send are visible to the goroutine that receives that send. This is essential for backpressure-related state: if a producer sets a flag before sending, the consumer sees the flag.

Conversely, there is no guarantee about the order of receives across multiple goroutines. Two consumers reading from the same channel may interleave their work.

---

## Garbage Collector Interactions

The Go GC has specific interactions with bounded resources:

- `GOMEMLIMIT` (Go 1.19+) caps total memory. The GC becomes more aggressive as the heap approaches the limit.
- Channels of fixed buffer size do not grow; their memory is allocated once at `make` time.
- Goroutines parked on a channel hold references to local variables; they are not GC'd until the goroutine resumes and exits.

Practical implication: a bounded queue has bounded GC pressure. An unbounded slice queue grows the heap, increases GC pauses, and feeds back into overall slowness.

`runtime/debug.SetGCPercent` tunes the GC's heap-growth target. Lower values produce more frequent, shorter pauses; higher values produce fewer but longer pauses.

---

## Runtime Guarantees and Non-Guarantees

The Go runtime guarantees:

- Channel send/receive are atomic.
- Closed channels do not panic on receive (they yield zero values).
- `len(ch)` and `cap(ch)` are atomic reads.
- `select` is statistically fair (pseudo-random choice).

The runtime does *not* guarantee:

- FIFO ordering among multiple senders to the same channel.
- Any particular pattern of preemption or scheduling.
- That `len(ch)` is meaningful for synchronisation (it is a snapshot).
- That `runtime.NumGoroutine` is stable during reads.

Code relying on non-guaranteed behaviour is unsafe across Go versions.

---

## References

- Go Language Specification: https://go.dev/ref/spec
- Go Memory Model: https://go.dev/ref/mem
- `runtime` package: https://pkg.go.dev/runtime
- `sync` package: https://pkg.go.dev/sync
- `context` package: https://pkg.go.dev/context
- `golang.org/x/sync/semaphore`: https://pkg.go.dev/golang.org/x/sync/semaphore
- `golang.org/x/time/rate`: https://pkg.go.dev/golang.org/x/time/rate
- RFC 7540 (HTTP/2): https://datatracker.ietf.org/doc/html/rfc7540
- RFC 9110 (HTTP Semantics): https://datatracker.ietf.org/doc/html/rfc9110
- gRPC status codes: https://grpc.github.io/grpc/core/md_doc_statuscodes.html
- Reactive Streams Specification: https://www.reactive-streams.org/
- "The Tail at Scale" (Dean & Barroso, CACM 2013).
- Netflix concurrency-limits: https://github.com/Netflix/concurrency-limits

---

## Detailed Specification: `make(chan T, N)`

From the spec:

> The expression `make(chan T, n)` makes a channel of type `chan T` with a buffer of size `n`. `n` must be a non-negative integer constant or expression. If omitted, the channel is unbuffered.

Behavioural guarantees:

- The channel is initialised empty (`len == 0`).
- Send on full channel parks the sender.
- Receive on empty channel parks the receiver.
- `close(ch)` may be called by any goroutine but is undefined if any goroutine still attempts to send.
- After close, `len(ch)` returns the count of buffered items remaining; receivers drain in send order until empty.
- After close, send to channel panics (`send on closed channel`).
- After close, receive returns the zero value with `ok=false` once buffer is drained.

Operations are O(1) in time and bounded in memory (N×sizeof(T) plus constant overhead).

---

## Detailed Specification: `<-ch` and `x, ok := <-ch`

The single-value receive `x := <-ch`:

- Blocks until a value is available or the channel is closed.
- Returns the zero value if the channel is closed and drained.

The two-value receive `x, ok := <-ch`:

- Same blocking semantics.
- `ok` is `false` only if the channel is closed *and* drained.
- `ok` is `true` if a value was received normally.

This is the canonical way to detect channel closure.

---

## Detailed Specification: `close(ch)`

From the spec:

> The built-in function `close` records that no more values will be sent on the channel. It is an error if `ch` is a receive-only channel. Sending to or closing a closed channel causes a run-time panic. Closing the nil channel also causes a run-time panic.

Properties:

- `close` is idempotent only in that a panic occurs on second close; not a no-op.
- After close, buffered values remain receivable until drained.
- After close, `cap(ch)` is unchanged; `len(ch)` reflects remaining items.
- `close` of a nil channel panics.

The standard idiom for safe close is to have a single goroutine own the channel and close it exactly once.

---

## Detailed Specification: `len(ch)` and `cap(ch)`

From the spec:

> The capacity, in number of elements, sets the size of the buffer in the channel. For channels:
> - `len(ch)`: number of elements queued in the channel buffer.
> - `cap(ch)`: maximum number of elements the channel buffer can hold.

Both are atomic O(1) reads. Neither is safe for synchronisation — values may change between read and use.

For an unbuffered channel, `cap == 0` and `len == 0` always.

---

## Detailed Specification: `select` Statement

From the spec:

> A "select" statement chooses which of a set of possible send or receive operations will proceed. It looks similar to a "switch" statement but with the cases all referring to communication operations.

Each case is one of:

```
SendStmt = Expression "<-" Expression .
RecvStmt = [ ExpressionList "=" | IdentifierList ":=" ] RecvExpr .
RecvExpr = Expression .
Default  = "default" ":" StatementList .
```

The execution algorithm:

1. Evaluate all channel expressions (and the values to send) exactly once, in source order.
2. If any communications can proceed, select one pseudo-randomly.
3. Otherwise, if a `default` exists, run the default.
4. Otherwise, block until one communication can proceed.

Subtleties:

- A `nil` channel in any case is never ready. Useful for disabling.
- A closed channel's *receive* case is always ready (returns zero, `ok=false`).
- A closed channel's *send* case is not a "case ready" — attempting it would panic; the spec says behaviour is undefined here.

Best practice: do not include send cases on possibly-closed channels in `select`.

---

## Detailed Specification: `context.Context`

From the package documentation:

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```

Guarantees:

- `Done()` returns the same channel each call.
- `Done()` may return nil if the context can never be cancelled.
- After cancellation, `Done()` is closed.
- After cancellation, `Err()` is non-nil and explains the reason.
- `Value` is for request-scoped data, not control.

Derived contexts (`WithCancel`, `WithDeadline`, `WithTimeout`, `WithValue`) inherit from parent. Cancellation propagates from parent to children. Children's deadlines are bounded by parent.

`Err` after cancellation is one of:

- `context.Canceled` — explicit `cancel()` call.
- `context.DeadlineExceeded` — deadline passed.
- A wrapped error if cancellation passed through `context.WithCancelCause` (Go 1.20+).

---

## Detailed Specification: `runtime.NumGoroutine`

From the package documentation:

> `NumGoroutine` returns the number of goroutines that currently exist.

The value:

- Includes the calling goroutine.
- Is a snapshot; may change immediately after the call.
- Excludes goroutines that have exited.
- Includes goroutines parked on channels, mutexes, syscalls, etc.

For backpressure debugging, an unexpected growth in `NumGoroutine` over time indicates a leak — often a goroutine blocked on a full channel that no one is reading.

---

## Detailed Specification: `runtime.MemStats`

Relevant fields for backpressure analysis:

- `HeapAlloc`: bytes of allocated heap objects.
- `HeapInuse`: bytes in in-use spans.
- `HeapIdle`: bytes in idle (released to OS) spans.
- `Sys`: total bytes obtained from the OS.
- `NextGC`: target heap size for the next GC cycle.
- `NumGC`: number of completed GC cycles.
- `PauseTotalNs`: cumulative GC pause duration.

Reading `runtime.ReadMemStats` is a stop-the-world operation. Use sparingly (every few seconds at most) and prefer derived metrics (`/debug/vars`, Prometheus client_golang) for hot paths.

---

## Detailed Specification: `GOMEMLIMIT` (Go 1.19+)

From the runtime documentation:

> The runtime soft memory limit is set via the `GOMEMLIMIT` environment variable, or via `runtime/debug.SetMemoryLimit`. The runtime will try to maintain the heap below this limit through more aggressive GC, but it is not a hard guarantee.

Properties:

- Soft limit; runtime may exceed briefly.
- GC frequency increases as approaching the limit.
- Set to a fraction of container memory (e.g., 90%) for predictable OOM behaviour.
- Interacts with `GOGC` (default 100); both affect GC trigger heuristics.

For backpressure: when `GOMEMLIMIT` is approached, GC overhead grows. Combined with application-level admission, this provides defensive memory management.

---

## Detailed Specification: `golang.org/x/time/rate`

The standard rate-limiter package implements token-bucket semantics.

```go
type Limiter struct { /* ... */ }
func NewLimiter(r Limit, b int) *Limiter
func (l *Limiter) Allow() bool
func (l *Limiter) Wait(ctx context.Context) error
func (l *Limiter) Reserve() *Reservation
```

Methods:

- `Allow()` returns true if a token is available; otherwise returns false immediately.
- `Wait(ctx)` blocks until a token is available or context fires.
- `Reserve()` reserves a future token; returns a `Reservation` with the wait duration.

Semantics:

- `r` is the rate in events per second; can be `rate.Inf` (no limit).
- `b` is the burst size (bucket capacity).
- Limiter is goroutine-safe.

Used at the boundary of a service to cap input rate before admission.

---

## Detailed Specification: HTTP `http.Server` Limits

The standard library `http.Server` has several knobs:

- `ReadTimeout`: maximum duration for reading the entire request, including body.
- `WriteTimeout`: maximum duration before timing out writes.
- `IdleTimeout`: maximum amount of time to wait for the next request when keep-alives are enabled.
- `MaxHeaderBytes`: maximum size of request headers.

For backpressure protection:

- A slow client cannot hold a connection beyond `ReadTimeout`. A `MaxBytesReader` further caps body size.
- Without these, a few slow clients can exhaust the server's goroutine budget.

The standard library does not include built-in admission control. Applications add it via middleware.

---

## Detailed Specification: gRPC Server Options

From `google.golang.org/grpc`:

- `grpc.MaxConcurrentStreams(n)`: cap concurrent streams per connection.
- `grpc.MaxRecvMsgSize(n)`: max single inbound message size.
- `grpc.MaxSendMsgSize(n)`: max single outbound message size.
- `grpc.InitialWindowSize(n)`: per-stream flow-control window.
- `grpc.InitialConnWindowSize(n)`: per-connection flow-control window.
- `grpc.KeepaliveParams(kp)`: connection keepalive and idle limits.

Each is a defensive limit. Default values are reasonable for development but should be tuned for production.

---

## Detailed Specification: Channel and Select Atomicity

A send on a channel and the corresponding receive are atomic — they happen as one transition from the perspective of any other goroutine. There is no intermediate state where one has happened but not the other.

A `select` that picks a case completes that case atomically. The choice itself is atomic — once a case is selected, no other case will run.

This atomicity is the foundation of the memory model guarantee: any write before a send is visible after the corresponding receive.

---

## Detailed Specification: Closed-Channel Behaviour Reference

Compact summary:

| Operation on a closed channel | Effect |
|---|---|
| `ch <- x` | panic |
| `x := <-ch` (drained) | zero value of T |
| `x, ok := <-ch` (drained) | zero, ok=false |
| `x := <-ch` (not drained) | next buffered value |
| `len(ch)` | remaining buffered count |
| `cap(ch)` | original capacity |
| `close(ch)` | panic (double close) |

Code that needs to handle closed channels gracefully should always use the two-value receive form.

---

## Detailed Specification: Backpressure-Relevant `runtime/debug` APIs

- `debug.SetGCPercent(p)`: set GC target (default 100, meaning heap doubles between GCs).
- `debug.SetMaxStack(b)`: set per-goroutine stack limit.
- `debug.SetMemoryLimit(b)`: set `GOMEMLIMIT` programmatically (Go 1.19+).
- `debug.SetMaxThreads(n)`: cap OS thread count.

For backpressure, the most useful is `SetMemoryLimit`. Combined with `GOGC=off`, this changes the GC's trigger from heap-growth ratio to memory-limit.

---

## Detailed Specification: Backpressure-Relevant Standard Library APIs

| Package | Function | Backpressure role |
|---|---|---|
| `sync` | `WaitGroup` | Coordinate completion of N goroutines |
| `sync` | `Cond` | Signal blocked goroutines |
| `sync/atomic` | `Add*`, `Load*`, `Store*` | Counters for stats |
| `context` | `WithTimeout`, `WithDeadline` | Bound wait durations |
| `golang.org/x/sync/semaphore` | `Acquire`, `Release` | Weighted concurrency |
| `golang.org/x/sync/singleflight` | `Do` | Coalesce duplicate work |
| `golang.org/x/sync/errgroup` | `Go`, `Wait` | Group goroutines with shared error |
| `golang.org/x/time/rate` | `Allow`, `Wait` | Token-bucket rate limit |
| `net/http` | `Server`, `MaxBytesReader` | Bound request resources |
| `google.golang.org/grpc` | Server options | gRPC-level limits |

These together form Go's backpressure standard kit. Each is documented in its package; this page does not duplicate the docs.

---

## Specification Cross-Reference for the Patterns in This Roadmap

For each backpressure mechanism discussed in junior/middle/senior/professional pages, the relevant spec sections:

| Mechanism | Specs |
|---|---|
| Bounded channel | Go spec §Channels |
| `select` with `default` | Go spec §Select |
| Blocking send | Go spec §Send statements |
| `context.Done()` | `context` package |
| Semaphore (`chan struct{}`) | Go spec §Channels |
| Weighted semaphore | `golang.org/x/sync/semaphore` |
| HTTP 503 / 429 | RFC 9110 §15.6.4, §15.5.29 |
| `Retry-After` | RFC 9110 §10.2.3 |
| gRPC ResourceExhausted | gRPC status codes |
| HTTP/2 flow control | RFC 7540 §5.2 |
| Token bucket | `golang.org/x/time/rate` |

This table is a map from concept to specification. Use it as a starting point when arguing about behaviour with colleagues.

---

## Closing Note

The specifications are precise; the implementations are sometimes more permissive (e.g., the runtime may choose pseudo-random or FIFO among ready cases — both are valid). Production code should rely only on what the spec guarantees, not on observed implementation behaviour.

When in doubt, read the spec. When that is unclear, write a test that codifies the expected behaviour. When even that fails, file an issue with the Go team.


# What is Concurrency — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Concurrency as an Architectural Concern](#concurrency-as-an-architectural-concern)
3. [Structured Concurrency](#structured-concurrency)
4. [Ownership, Lifetime, and Cancellation](#ownership-lifetime-and-cancellation)
5. [Concurrency Boundaries in Service Design](#concurrency-boundaries-in-service-design)
6. [When Concurrency Hurts](#when-concurrency-hurts)
7. [Choosing Between Concurrency Models](#choosing-between-concurrency-models)
8. [Concurrency and Failure Modes](#concurrency-and-failure-modes)
9. [Observability for Concurrent Systems](#observability-for-concurrent-systems)
10. [Capacity Planning and Saturation](#capacity-planning-and-saturation)
11. [Concurrency Reviews](#concurrency-reviews)
12. [Common Architectural Mistakes](#common-architectural-mistakes)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## Introduction

The senior view treats concurrency as something that lives in the *architecture*, not in individual `go` statements. The question is no longer "how do I use a goroutine here?" but "what shape of concurrent system am I building, what are its boundaries, what fails under load, and how is its behaviour visible from the outside?"

At this level we make decisions that resist easy testing: whether to colocate two services to share concurrency overhead, whether to expose backpressure to a caller, whether to make a function concurrent at the API surface or hide it behind a sync façade. These are decisions whose consequences appear in production three months later.

After reading this you will:

- See concurrency as a property of subsystems and services, not just functions.
- Apply structured concurrency principles consistently.
- Reason about ownership, lifetime, and cancellation as first-class concerns.
- Recognise the warning signs of concurrency that should not exist.
- Design for graceful degradation under saturation.
- Review concurrent code with a checklist that catches real production bugs.

---

## Concurrency as an Architectural Concern

A web service is a concurrent system. So is a worker fleet, an ETL pipeline, a CLI tool that fans out to remote APIs, a CLI that simply prints help. The question is *where in the architecture concurrency lives*.

### The concurrency boundary

Every system has a **concurrency boundary** — the line between "callers see sequential behaviour" and "internally many things happen at once." Examples:

- A `http.HandlerFunc` looks sequential to the framework but spawns goroutines for downstream calls.
- A `Repository.GetUser(ctx, id)` looks sequential but internally fans out to cache and DB in parallel, returns the first answer.
- A `WorkerPool.Submit(job)` is asynchronous: the caller queues work and gets a future or a callback.

Where you draw this boundary matters. Too far inside (every function is "secretly concurrent") and callers cannot reason about timing, cancellation, or errors. Too far outside (every caller must manage goroutines) and you leak implementation detail.

### Synchronous facades over concurrent implementations

A useful idiom: present a synchronous API to callers, manage concurrency internally.

```go
type Fetcher struct{ /* internal goroutines, pools, etc. */ }

func (f *Fetcher) Get(ctx context.Context, id string) (Result, error) {
    // Internally may fan out, race, retry, parallel.
    // Caller sees: one call in, one result out.
}
```

The caller writes sequential code; the implementer manages concurrency where it pays off. This is the right default unless asynchronicity is the *purpose* (e.g., a queue submitter).

### Concurrency-aware contracts

Some interfaces *must* expose concurrency to be useful. Examples:

- A streaming API yields results over time: `func (s *Stream) Recv() (T, error)`.
- An event bus subscriber is called per event from arbitrary goroutines.
- A pub/sub channel is concurrent by definition.

In these cases, the documented contract must spell out: how many goroutines can call this, in what order, with what guarantees.

---

## Structured Concurrency

The term comes from Nathaniel J. Smith's 2018 essay *"Notes on structured concurrency, or: Go statement considered harmful."* The idea: a function that spawns goroutines should not return until all spawned goroutines have finished. Goroutine lifetimes nest like function call scopes.

```
func parentFunc() {
    var wg sync.WaitGroup
    wg.Add(N)
    for i := 0; i < N; i++ {
        go func() { defer wg.Done(); work() }()
    }
    wg.Wait()                // parent does not return until children done
}
```

In Go, this is a *convention*, not a language feature. The language allows you to spawn goroutines and never wait. The convention says: don't.

### Why structured concurrency matters

- **Lifetime is local.** If `parentFunc()` returned, you know all the goroutines it spawned are done.
- **Errors propagate.** A child's failure can reach the parent.
- **Cancellation flows.** When the parent is cancelled, children are cancelled.
- **Resource cleanup is straightforward.** No "did a goroutine I forgot about hold onto this?"
- **Reasoning is local.** You don't need to read the whole codebase to know where goroutines run.

### `errgroup.Group` as structured concurrency

`golang.org/x/sync/errgroup` is Go's most idiomatic structured-concurrency primitive:

```go
g, ctx := errgroup.WithContext(ctx)
for _, item := range items {
    item := item
    g.Go(func() error { return process(ctx, item) })
}
if err := g.Wait(); err != nil {
    return err
}
```

`g.Wait()` blocks until every goroutine spawned by `g.Go` returns. The first non-nil error cancels `ctx`, causing the others to abort. Errors collect; resources free.

### Anti-pattern: "fire and forget"

```go
go logMetric(evt)
```

It spawns a goroutine outside any structured scope. It may leak. It may panic without anyone seeing. It may outlive the program's intent.

Fire-and-forget is sometimes appropriate (truly best-effort fire-and-forget — emitting a metric you do not care about), but it should be rare, conscious, and documented. Most uses are mistakes.

### Spawning goroutines that outlive their function

Sometimes you must spawn a goroutine that survives its caller — a long-running background task, a daemon, a connection reader. In those cases, return a handle:

```go
type Service struct {
    cancel context.CancelFunc
    done   chan struct{}
}

func New(ctx context.Context) *Service {
    ctx, cancel := context.WithCancel(ctx)
    s := &Service{cancel: cancel, done: make(chan struct{})}
    go func() {
        defer close(s.done)
        s.loop(ctx)
    }()
    return s
}

func (s *Service) Close() {
    s.cancel()
    <-s.done
}
```

The handle (`Service`) carries the goroutine's lifetime. The owner of the handle owns the goroutine. When the handle is closed, the goroutine exits.

---

## Ownership, Lifetime, and Cancellation

Three intertwined concepts. The senior task is to align them explicitly.

### Ownership

Who is *responsible* for a goroutine? Generally:

- The function that spawned it (structured concurrency).
- The struct it lives inside (handle pattern).
- A pool or supervisor (explicit ownership).

A goroutine without an owner is unmaintained. Bugs accumulate.

### Lifetime

When does the goroutine start and end? The lifetime should be obvious from the code: spawned at line X, joined at line Y. If you cannot point to those lines, you cannot reason about leaks.

### Cancellation

How is the goroutine *told* to stop? Three idioms in Go:

1. **`context.Context`.** The standard. Pass `ctx` everywhere, check `ctx.Done()` in long-running loops, propagate cancellation across goroutine trees.
2. **A `done chan struct{}`.** Older idiom; still common in low-level libraries.
3. **Channel close on input.** A worker reading `for job := range jobs` exits when the channel is closed.

Choose one per subsystem and stick to it. Mixing all three is confusing.

### Cancellation pitfalls

- Long-running CPU-bound loops do not naturally check `ctx`. Insert explicit checks at safe points.
- Library code that does not accept `ctx` (the standard library has many such functions) cannot be cancelled cooperatively; you must wrap with timeouts or accept long tails.
- `ctx.Err()` after a successful operation may be non-nil if the deadline triggered exactly at completion. Defensive code handles this.
- Cancelling a `ctx` does not unblock `time.Sleep`; use `time.After` + `select`.

---

## Concurrency Boundaries in Service Design

Where in the stack does concurrency live?

### Concurrency at the request level

Each incoming request is a goroutine. Internal calls flow synchronously. This is the default for HTTP servers and is correct for the vast majority of services.

### Concurrency within a request

The request goroutine spawns child goroutines to parallelise I/O (e.g., fan-out to multiple services). Use structured concurrency (errgroup) to keep lifetimes bounded.

### Concurrency outside the request

Background goroutines that run independently of any request: ticker-driven cache refreshers, queue consumers, periodic flushes. These need their own ownership story (handle pattern + explicit shutdown).

### Concurrency across requests

Multiple requests sharing concurrent work: a singleflight that dedupes identical concurrent requests, a connection pool, a batched DB writer. Concurrency here is a performance and resource concern, not a correctness one.

```go
import "golang.org/x/sync/singleflight"

var g singleflight.Group

func getUserCached(ctx context.Context, id string) (User, error) {
    v, err, _ := g.Do(id, func() (interface{}, error) {
        return fetchUser(ctx, id)
    })
    if err != nil {
        return User{}, err
    }
    return v.(User), nil
}
```

A thousand concurrent requests for the same `id` run the fetch once.

---

## When Concurrency Hurts

A senior engineer is skeptical of concurrency. Real cases where it harms:

### Sequential bottlenecks

Adding goroutines around a single mutex, a single DB connection, or a rate-limited API does nothing. The workers queue. Throughput is bounded by the serialised resource.

### Cache pollution

Many goroutines accessing the same data structure can cause cache line bouncing between cores. False sharing (different fields on the same cache line) is a classic subtle bug.

### Latency tail amplification

If a single backend call has a 99th-percentile latency of 200 ms, fanning out to 10 of them concurrently and waiting for all gives a tail close to `1 - (1 - 0.01)^10 ≈ 9.6%` at >200 ms. The slowest determines the wait. Concurrency *increases* the chance of seeing a slow tail.

Strategies: hedged requests (cancel slow ones once a fast one returns), tail-tolerant aggregation (return on `quorum` rather than all).

### Resource exhaustion

Unbounded goroutine spawning can OOM the process. Always cap.

### Complexity tax

Concurrent code is harder to read, harder to test, harder to refactor. The maintenance cost is real. Don't add concurrency without measurement.

### Hidden serialisation

Two goroutines that *should* be concurrent but share a `sync.Mutex` covering most of their work are effectively serial. Look for `pprof` block profiles showing high lock contention.

---

## Choosing Between Concurrency Models

| Model | Use when | Avoid when |
|---|---|---|
| Goroutine per request | Web servers, RPC servers, mostly I/O-bound | Truly stateless data processing better fits a worker pool |
| Fixed worker pool | Bounded resource (DB connections, CPU cores), bursty input | Fully I/O-bound with high goroutine churn — per-request is simpler |
| Pipeline | Stages with different rates that can each saturate independently | Single stage already saturates a core; pipeline adds overhead |
| Scatter-gather | Many candidate answers, take fastest | Single canonical answer required |
| Single goroutine | Inherently serial state (database connection multiplexer, log writer) | Multi-core compute work |
| Process per task | Hard isolation, untrusted code | Latency-sensitive (process spawn is slow) |

Hybrid models are common: a request-per-goroutine HTTP server that, inside a handler, fans out via errgroup to a worker pool. Clear documentation per layer is essential.

---

## Concurrency and Failure Modes

A concurrent system has more failure modes than a sequential one. Senior design accounts for them.

### Cascading cancellation

A request fails; its context is cancelled. Twelve downstream goroutines abort. If any of them held onto a database transaction, the transaction is rolled back. If any held a connection, the connection is returned to the pool. Failures must not leak resources.

### Partial failure

Five of ten parallel fetches succeed; five fail. What does "the request" do? Three policies:

- **All-or-nothing.** Any failure fails the request. Simple; loses partial data.
- **Best-effort.** Use successes; log failures. Good for non-critical aggregation.
- **Quorum.** Succeed if at least N succeed. Good for redundancy.

Choose explicitly; do not let it default.

### Cancel storms

A health check failing triggers all clients to retry. The retries pile up, exhausting connections. Use jitter on retries, circuit breakers, and load shedding.

### Goroutine leaks under failure

When a downstream call hangs, its goroutine sits forever unless it has a deadline. The leak grows linearly with failure rate. Every blocking call must have a timeout. Every channel send must have a receiver guaranteed or a buffer that prevents the send from blocking.

### Reentrancy hazards

A library function spawning goroutines while holding a lock can deadlock if a goroutine tries to acquire the same lock. Document carefully; prefer to spawn outside critical sections.

---

## Observability for Concurrent Systems

You cannot fix what you cannot see.

### Goroutine counts

```go
runtime.NumGoroutine()
```

Expose as a Prometheus gauge. Sudden growth = leak.

### Goroutine profiles

```bash
curl http://localhost:6060/debug/pprof/goroutine?debug=1
```

Live snapshot of where every goroutine is. Useful for diagnosing leaks.

### Block profile

```go
runtime.SetBlockProfileRate(rate)
```

Records goroutine block times. Useful for finding mutex contention.

### Mutex profile

```go
runtime.SetMutexProfileFraction(rate)
```

Records mutex contention. Indicates serial bottlenecks.

### Channel buffer occupancy

No built-in metric, but logging or instrumenting channel fullness shows whether back-pressure is engaging.

### Tracing

`go.opentelemetry.io/otel` integrates with goroutines: span context flows through `context.Context`. A trace of a concurrent request shows the fan-out structure with each child as a span.

---

## Capacity Planning and Saturation

A concurrent system has multiple capacity limits, often hidden.

### CPU saturation

When CPU is fully busy, additional concurrency increases queueing latency, not throughput. Measure CPU utilisation; alert at 80% sustained.

### Memory saturation

Each goroutine has a stack. Each request may allocate. At 100 000 in-flight requests, gigabytes are in flight. Bound concurrency to bound memory.

### File descriptor saturation

Each open socket / file is an FD. The default Linux limit is 1024 per process; production should raise to 1M for large servers. Monitor and alert.

### Network saturation

Bandwidth is finite. A fan-out to 10x downstreams x N concurrent requests can saturate the NIC. Latency rises; throughput drops.

### Downstream saturation

The DB has connection limits. The third-party API has rate limits. Concurrent in your service does not magically make them faster. Cap concurrency to match downstream capacity.

### Scheduler saturation

Even Go's scheduler degrades when millions of runnable goroutines compete. The default GMP scheduler scales to about a million runnable goroutines before scheduling overhead dominates. Beyond that, redesign.

---

## Concurrency Reviews

A checklist for reviewing concurrent code:

1. **Lifetime.** Where does each goroutine start? Where does it end? Is the end reachable on every path (including errors and cancellation)?
2. **Ownership.** Who is responsible for stopping each goroutine? Is it documented?
3. **Cancellation.** Does the code accept and propagate `context.Context`? Are long loops `ctx`-aware?
4. **Shared state.** Every variable shared between goroutines: how is it synchronised? Mutex, atomic, channel, immutable?
5. **Channel ownership.** Who closes each channel? Is double-close possible?
6. **Buffer sizes.** Are buffered channels sized for the expected burst, with a clear fallback when they fill?
7. **Backpressure.** When the consumer is slow, what does the producer do — block, drop, or buffer?
8. **Error handling.** How does an error from one goroutine reach the others? Does it cancel them?
9. **Panics.** Each goroutine — does it `recover` if it can panic on bad input?
10. **Race detector.** Has this been tested with `-race`? In CI?
11. **Bounds.** Is goroutine spawning bounded by input size or by a cap?
12. **Observability.** Are there metrics for in-flight count, error rate, queue depth?
13. **Tests.** Are there tests for cancellation, timeout, error propagation, panic recovery?

---

## Common Architectural Mistakes

### "Concurrency by default"

A library that spawns goroutines on the caller's behalf "for performance" makes the caller's code harder to reason about. Make concurrency opt-in unless the API is inherently asynchronous.

### `chan error` everywhere

A pattern where every function returns a `<-chan error` is overkill for code that is mostly synchronous. Reserve channel-returning APIs for genuinely streaming work.

### Unbounded worker pools

A worker pool that grows to match input is not a pool. It is the same as `go f()` per item. Caps exist for a reason.

### Hidden global state

A `sync.Mutex` package-level variable used by many callers is a bottleneck and a debugging nightmare. Encapsulate state in structs.

### Mixing concurrency models

A service that uses channels, callbacks, futures, and bare goroutines in different packages is hard to maintain. Pick a small set of patterns and document them.

### `time.Sleep` as throttle

Throttling via `time.Sleep(100 * time.Millisecond)` in a goroutine creates one inflexible rate. Use `time.Ticker` with proper cleanup, or `rate.Limiter` from `golang.org/x/time/rate`.

### Ignoring `pprof`

A senior should be fluent in `go tool pprof` (cpu, heap, goroutine, mutex, block). The runtime exposes everything; the diagnostic burden falls on whoever investigates.

---

## Self-Assessment

- [ ] I can identify the concurrency boundary in a service I am designing.
- [ ] I apply structured concurrency by default and document exceptions.
- [ ] I have a written policy for how cancellation flows in each service.
- [ ] I have refactored a concurrent system because measurement showed it was wrong, not because intuition said so.
- [ ] I have set up `pprof` endpoints, Prometheus metrics, and alerting on goroutine counts in a production service.
- [ ] I have rejected a `go` statement in code review with a concrete reason.
- [ ] I can describe at least three failure modes specific to concurrent systems and how to mitigate each.
- [ ] I have used `singleflight`, `errgroup`, `semaphore`, or `rate.Limiter` in production.
- [ ] I have set a hard cap on concurrency for an unbounded input.
- [ ] I have written a code review checklist for concurrent code.

---

## Summary

At the senior level, concurrency is an architectural property managed across many decisions: where the concurrency boundary lives, who owns goroutines, how cancellation flows, how failures propagate, how the system degrades under load. Structured concurrency is the discipline that keeps these answers local and visible.

Concurrency moves bottlenecks; it does not remove them. It amplifies tails as much as it improves throughput. It increases failure modes. The senior task is to make all of this explicit — in code review, in monitoring, in capacity planning — so the system fails in foreseeable ways and recovers automatically.

The next levels (`professional`, `specification`) dig into the runtime details that make these architectural choices possible.

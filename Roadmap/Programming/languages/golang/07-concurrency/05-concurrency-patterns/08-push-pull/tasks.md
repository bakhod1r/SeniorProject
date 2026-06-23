# Push-Pull — Tasks

A graded set of exercises, from "see backpressure happen" through "build a credit-based flow-control producer." Each task lists requirements, hints, and a self-check. Solutions are not given — write and run them yourself, always with `-race` enabled.

## Table of Contents
1. [Task 1: Minimal Push-Pull](#task-1-minimal-push-pull)
2. [Task 2: Observe Backpressure](#task-2-observe-backpressure)
3. [Task 3: Bounded vs Unbounded](#task-3-bounded-vs-unbounded)
4. [Task 4: Fan-Out Worker Pool](#task-4-fan-out-worker-pool)
5. [Task 5: Cancellable Pipeline](#task-5-cancellable-pipeline)
6. [Task 6: Drain vs Abort Shutdown](#task-6-drain-vs-abort-shutdown)
7. [Task 7: Overflow Policies](#task-7-overflow-policies)
8. [Task 8: Batching Stage](#task-8-batching-stage)
9. [Task 9: Credit-Based Pull](#task-9-credit-based-pull)
10. [Task 10: Three-Stage Streaming Pipeline](#task-10-three-stage-streaming-pipeline)
11. [Task 11: Benchmarks](#task-11-benchmarks)

---

## Task 1: Minimal Push-Pull

**Goal.** Connect one producer and one consumer with a bounded channel.

**Requirements.**
- Producer pushes integers 0..99, then closes the channel.
- Consumer `range`s and sums them.
- The producer owns the `close`; the consumer never closes.

**Hints.** `defer close(ch)` right inside the producer goroutine.

**Acceptance criteria.**
- Sum equals 4950.
- Passes `go test -race`.
- Returning a `<-chan int` from a `produce()` helper, the caller only ranges.

---

## Task 2: Observe Backpressure

**Goal.** Make backpressure visible.

**Requirements.**
- Buffer of 2; consumer sleeps 100 ms per item.
- Producer logs each push with a timestamp; consumer logs each pull.
- Run for 10 items.

**Hints.** Watch the producer stall after filling the buffer.

**Acceptance criteria.**
- The producer is never more than ~2 items ahead of the consumer (assert with an atomic counter).
- The log shows the producer pausing once the buffer is full.

---

## Task 3: Bounded vs Unbounded

**Goal.** Feel the difference empirically.

**Requirements.**
- Implement an `UnboundedQueue` (mutex + growing slice + `sync.Cond`).
- Run a fast producer and a slow consumer against (a) a bounded channel and (b) the unbounded queue, for a fixed wall-clock duration.
- Measure peak memory (`runtime.ReadMemStats`) and max queue length for each.

**Acceptance criteria.**
- The bounded version's memory stays roughly flat; the unbounded version's grows monotonically.
- Write one paragraph: why the bounded version is the safer default, and the narrow case where unbounded is acceptable.

---

## Task 4: Fan-Out Worker Pool

**Goal.** One producer, N consumers pulling from one channel, fan-in the results.

**Requirements.**
- N workers `range` a shared `jobs` channel; each computes a result and pushes to `results`.
- Producer closes `jobs`; a separate goroutine closes `results` after `wg.Wait()`.
- Final consumer aggregates results.

**Hints.** Never close `results` from inside a worker.

**Acceptance criteria.**
- Aggregate is correct regardless of N (try N=1, 4, 16).
- No panic / no race under `-race`.
- Closing `results` from a worker (deliberately) reproduces a panic — observe why, then revert.

---

## Task 5: Cancellable Pipeline

**Goal.** Make every blocking op cancellable.

**Requirements.**
- A producer that pushes forever inside `select { case out <- v: case <-ctx.Done(): return }`.
- A consumer that pulls inside a `select` on `ctx.Done()`.
- Cancel after pulling 10 items.

**Acceptance criteria.**
- After `cancel()`, the producer goroutine exits within a deadline (use a `goleak`-style or timeout check).
- Removing the `case <-ctx.Done()` from the producer's send leaks the producer — demonstrate, then fix.

---

## Task 6: Drain vs Abort Shutdown

**Goal.** Implement and contrast both shutdown modes.

**Requirements.**
- **Drain:** stop the source, `close(jobs)`, `wg.Wait()`; count processed items — must equal pushed items.
- **Abort:** `cancel()`; workers `select` on `ctx.Done()`; processed items may be fewer.
- Use a buffer with several items queued at shutdown time so the difference is visible.

**Acceptance criteria.**
- Drain processes 100% of pushed items; abort processes fewer (and you can quantify the loss).
- A short note: which mode is correct for a payment pipeline vs a live-metrics pipeline?

---

## Task 7: Overflow Policies

**Goal.** Implement four overflow policies on a bounded channel.

**Requirements.** Implement `Submit` with each policy:
- **Block** (default `ch <- v`).
- **Drop-newest** (`select { case ch <- v: default: drop }`).
- **Drop-oldest** (discard from the front to make room).
- **Reject** (return `ErrOverloaded`).
- Each non-block policy increments a `dropped`/`rejected` counter.

**Acceptance criteria.**
- Under a fast producer + slow consumer, each policy behaves as specified (block stalls; drops lose items; reject returns errors).
- The drop/reject counters are non-zero under overload, proving overload is *visible*.

---

## Task 8: Batching Stage

**Goal.** Amortise per-item channel cost by batching.

**Requirements.**
- A stage that reads single items and pushes `[]Item` batches of up to `size`.
- Add a time-based flush (`time.Ticker`) so a partial batch is not held longer than `maxDelay`.
- Allocate a fresh slice per flush (never reuse a sent slice).

**Hints.** `select` over the input channel, the ticker, and `ctx.Done()`.

**Acceptance criteria.**
- All input items appear in output batches exactly once.
- Reusing a sent slice (deliberately) triggers a `-race` report — observe, then fix.
- A benchmark shows higher throughput than single-item pushing at high rates (Task 11).

---

## Task 9: Credit-Based Pull

**Goal.** Implement consumer-driven (pull) flow control.

**Requirements.**
- Consumer sends credits ("I can take N more") on a `credit chan int`.
- Producer sends at most the available credit; blocks for more credit when exhausted.
- Bound in-flight (un-consumed) items to the credit window.

**Hints.** This mirrors gRPC/HTTP-2 flow control. The producer tracks a `window` integer.

**Acceptance criteria.**
- In-flight items never exceed the credit window (assert with a counter).
- The consumer fully controls the rate by granting credit slowly/quickly.
- A note: why is explicit credit usually unnecessary in-process but essential across a network?

---

## Task 10: Three-Stage Streaming Pipeline

**Goal.** Build read → transform → aggregate with bounded memory.

**Requirements.**
- Stage 1 reads lines from a large input (simulate with a generator producing millions of items).
- Stage 2 parses/transforms; skips bad items.
- Stage 3 aggregates (sum/count).
- All stages return `<-chan T`, own their goroutine, close on completion/cancel, and select on `ctx.Done()`.
- Process more "items" than would fit in memory if buffered all at once.

**Acceptance criteria.**
- Peak memory stays bounded (independent of total item count) — confirm with `runtime.ReadMemStats`.
- Cancelling mid-stream stops all stages within a deadline with no leaks.
- Output matches a single-threaded reference for a small input.

---

## Task 11: Benchmarks

**Goal.** Measure throughput vs buffer size, worker count, and batching.

**Requirements.**
- Benchmark single-item push-pull across buffer sizes {0, 1, 8, 64, 1024}.
- Benchmark fan-out throughput across worker counts {1, 2, 4, 8, runtime.NumCPU()}.
- Benchmark single-item vs batched (size 1, 16, 256) at a high item rate.
- Run with `-benchmem` and `-cpuprofile`.

**Acceptance criteria.**
- A table of items/sec per configuration.
- Unbuffered (0) shows the highest per-item synchronisation overhead; a small buffer improves it; a huge buffer does not improve steady-state throughput (it only adds memory).
- Batching shows a clear throughput win at high rates, with a latency cost noted.
- A one-paragraph interpretation tying results back to Little's Law and "throughput is set by the consumer's service rate."

---

## Stretch Goals

- Add a **bounded admission semaphore** in front of the pipeline so the *aggregate* in-flight work is capped, and return `ErrOverloaded` (HTTP 503-style) when admission is refused.
- Add **per-key sharding** (route items to one of K channels by key hash) to bound head-of-line blocking, and measure tail latency vs a single shared channel.
- Add **spill-to-disk** as a fifth overflow policy and verify no item is lost until disk is exhausted.
- Wire **queue-depth and dropped-count metrics** to a `/metrics` endpoint and graph them under a synthetic load spike.
- Build a **distributed version** using NATS queue groups (or a local Redis stream): N consumers, acks, and redelivery; kill a consumer mid-flight and confirm its un-acked work is redelivered.

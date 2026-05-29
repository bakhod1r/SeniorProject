# CSP — Hands-On Tasks

> **Topic:** [CSP](README.md)

---

## Introduction

These tasks turn the theory of Communicating Sequential Processes (CSP) into reflexes. CSP is not a library or a single language feature — it is a discipline: processes communicate by passing messages on named channels, and synchronisation is a side effect of communication, not the goal of it. If you absorb this discipline, race conditions, lost wake-ups, and tangled lock orderings stop being a constant background hazard and become a smell you notice in code review.

The exercises are graded. The Warm-Up section gets your fingers moving — goroutines, channels, `select`, `range`, directional types. The Core section is where most real systems live: fan-in and fan-out, pipelines, worker pools, rate limiters, debouncers. The Advanced section pushes you toward structured concurrency, dynamic topologies, throughput measurement, and the hard skill of seeing a goroutine leak before production does. The Capstone tasks ask you to build or salvage real systems and, in the last task, to step outside Go entirely and write a CSPm specification that you check with FDR.

Work in Go unless a task explicitly says otherwise. Resist the urge to reach for `sync.Mutex` — almost every task in this file has a clean channel-only solution, and the point of the exercise is to find it. If you genuinely cannot, write the mutex version, then refactor it into the channel version and compare.

Each task has Hints, but try without them first. Read the Self-check criteria before you start coding so you know what "done" looks like. The Sample Solutions in the Capstone section show one reasonable shape; they are not the only correct answer.

---

## Table of Contents

- [Warm-Up](#warm-up)
  - [Task 1: Hello, Goroutine and Channel](#task-1-hello-goroutine-and-channel)
  - [Task 2: Ping-Pong](#task-2-ping-pong)
  - [Task 3: Ticker Loop](#task-3-ticker-loop)
  - [Task 4: Basic Select](#task-4-basic-select)
  - [Task 5: Directional Channel Parameters](#task-5-directional-channel-parameters)
  - [Task 6: Range Over a Closed Channel](#task-6-range-over-a-closed-channel)
  - [Task 7: Done Channel Idiom](#task-7-done-channel-idiom)
- [Core](#core)
  - [Task 8: Bounded Buffer via Buffered Channel](#task-8-bounded-buffer-via-buffered-channel)
  - [Task 9: Fan-In, N to 1](#task-9-fan-in-n-to-1)
  - [Task 10: Fan-Out, 1 to N](#task-10-fan-out-1-to-n)
  - [Task 11: Pipeline with Context Cancellation](#task-11-pipeline-with-context-cancellation)
  - [Task 12: Worker Pool with Bounded Queue](#task-12-worker-pool-with-bounded-queue)
  - [Task 13: Token-Bucket Rate Limiter](#task-13-token-bucket-rate-limiter)
  - [Task 14: Stream Deduplicator](#task-14-stream-deduplicator)
  - [Task 15: Ticker plus Debouncer](#task-15-ticker-plus-debouncer)
  - [Task 16: Heartbeat Channel](#task-16-heartbeat-channel)
  - [Task 17: Or-Done Channel](#task-17-or-done-channel)
- [Advanced](#advanced)
  - [Task 18: Structured Concurrency Wrapper](#task-18-structured-concurrency-wrapper)
  - [Task 19: Dynamic Stage Pipeline](#task-19-dynamic-stage-pipeline)
  - [Task 20: Channel of Channels for Routing](#task-20-channel-of-channels-for-routing)
  - [Task 21: Throughput Benchmark](#task-21-throughput-benchmark)
  - [Task 22: Leak Detection in a Buggy Select](#task-22-leak-detection-in-a-buggy-select)
  - [Task 23: Semaphore-as-Channel](#task-23-semaphore-as-channel)
  - [Task 24: Priority Select](#task-24-priority-select)
  - [Task 25: Backpressure-Aware Multiplexer](#task-25-backpressure-aware-multiplexer)
- [Capstone](#capstone)
  - [Capstone 1: Market-Data Pipeline with Backpressure](#capstone-1-market-data-pipeline-with-backpressure)
  - [Capstone 2: Refactor Goroutine Soup into Structured Concurrency](#capstone-2-refactor-goroutine-soup-into-structured-concurrency)
  - [Capstone 3: CSPm Specification with FDR Model Checking](#capstone-3-cspm-specification-with-fdr-model-checking)
  - [Capstone 4: Distributed Sharded Worker Mesh](#capstone-4-distributed-sharded-worker-mesh)
- [Related Topics](#related-topics)

---

## Warm-Up

### Task 1: Hello, Goroutine and Channel

**Problem.** Write the smallest possible CSP-style "hello world": a goroutine that sends one string on an unbuffered channel, and a `main` that receives and prints it. Then change the channel to buffered with capacity 1 and observe what changes in the synchronisation behaviour.

**Constraints.**
- No `sync.WaitGroup`, no `time.Sleep`, no `sync.Mutex`.
- Program must terminate cleanly with no leaked goroutine.
- After the experiment, write a one-paragraph note in a comment explaining the difference between the two channel types in this specific program.

**Hints (try without first).**
- The receive operation `<-ch` blocks until a value is available — that is your synchronisation.
- An unbuffered channel forces the sender to wait until the receiver is ready (rendezvous).
- A buffered channel of size 1 lets the sender deposit and exit before the receiver runs.

**Self-check.**
- [ ] Program prints the message exactly once.
- [ ] `go vet` and `go run -race` are clean.
- [ ] The comment correctly identifies which version has rendezvous and which does not.

---

### Task 2: Ping-Pong

**Problem.** Two goroutines, `pinger` and `ponger`, exchange messages on two channels. `pinger` sends "ping" then waits for "pong", up to N rounds. `ponger` does the mirror. After N rounds, both exit and `main` reports the total count.

**Constraints.**
- Use exactly two channels, both unbuffered.
- No shared counters via memory; the count lives in the goroutine that owns it.
- Stop after exactly N rounds with no deadlock and no stuck goroutines.

**Hints (try without first).**
- Each goroutine owns one half of the count.
- Use a third channel or `close()` to signal "we are done" — pick one and justify why.

**Self-check.**
- [ ] Round count is exactly N for any N you choose at startup.
- [ ] No goroutine remains after `main` returns (verify with `runtime.NumGoroutine`).
- [ ] Switching channels to buffered changes timing but not correctness.

---

### Task 3: Ticker Loop

**Problem.** Build a program that prints the current time once per 200ms for 2 seconds, then stops. Use `time.NewTicker` and a `done` channel for cancellation.

**Constraints.**
- Must call `ticker.Stop()` on exit.
- Must not rely on `time.Sleep(2 * time.Second)` to end the program — use a timer or context.
- Should be safe to run with `-race`.

**Hints (try without first).**
- A `select` with two cases — ticker tick and a done signal — is the canonical shape.
- `time.After(2 * time.Second)` returns a channel that fires once; that is your stop signal.

**Self-check.**
- [ ] Exactly ten ticks (approximately) are printed.
- [ ] Ticker is stopped; no leaked timer goroutines.
- [ ] Swapping in `context.WithTimeout` works without restructuring the select.

---

### Task 4: Basic Select

**Problem.** Two source goroutines produce integers on two separate channels at random intervals between 50ms and 200ms. A consumer uses `select` to read from whichever arrives first, prints which source it came from, and stops after receiving 20 total messages.

**Constraints.**
- The consumer must not favour either channel by accident; the random fairness of `select` is the entire point.
- Sources must terminate when the consumer is done (no leaks).
- Use a single `done` channel that both sources observe.

**Hints (try without first).**
- `select` picks pseudo-randomly when multiple cases are ready.
- Closing `done` is a broadcast: every reader sees it immediately.

**Self-check.**
- [ ] Over many runs, the two sources contribute roughly equally on average.
- [ ] No goroutine leak after exit.
- [ ] Counter logic lives in the consumer, not in shared state.

---

### Task 5: Directional Channel Parameters

**Problem.** Write a `Generator(out chan<- int)` and a `Consumer(in <-chan int)` that together count from 1 to 100. The point is to use directional channel types in function signatures so the compiler enforces the data-flow direction.

**Constraints.**
- Function signatures must use `chan<-` and `<-chan`, not bidirectional `chan int`.
- Generator closes the channel when done.
- Consumer uses `range` to read until close.

**Hints (try without first).**
- A bidirectional channel converts implicitly to a directional one at the call site.
- Only the sender should close.

**Self-check.**
- [ ] `go vet` is clean.
- [ ] Attempting to receive in `Generator` is a compile error (try it, then revert).
- [ ] Consumer prints exactly 100 numbers in order.

---

### Task 6: Range Over a Closed Channel

**Problem.** Write a producer that sends the first 10 Fibonacci numbers on a channel and then closes it. A consumer iterates with `for n := range ch` and prints each one. Add a second consumer and observe what happens.

**Constraints.**
- Producer must close the channel exactly once.
- Each consumer must exit when the channel is closed.
- Do not introduce a `WaitGroup` for the consumers' termination — use channel closure as the signal.

**Hints (try without first).**
- `range` over a channel terminates when the channel is closed and drained.
- With two consumers, values are split between them, not duplicated.

**Self-check.**
- [ ] With one consumer, 10 numbers print.
- [ ] With two consumers, the combined output has 10 numbers, each appearing exactly once.
- [ ] No "send on closed channel" panic.

---

### Task 7: Done Channel Idiom

**Problem.** Implement a function `Generate(done <-chan struct{}) <-chan int` that produces integers 1, 2, 3, ... forever but stops cleanly when `done` is closed. A caller takes 5 values, closes `done`, and verifies no goroutines linger.

**Constraints.**
- The generator must use `select` between sending and reading `done`.
- The generator must return immediately when `done` fires, not after the next attempted send.
- Verify with `runtime.NumGoroutine` before and after.

**Hints (try without first).**
- The shape is `select { case out <- next: case <-done: return }`.
- Closing a `chan struct{}` is the conventional broadcast signal in Go.

**Self-check.**
- [ ] Caller receives exactly 5 values.
- [ ] After closing `done`, goroutine count returns to baseline within a small grace period.
- [ ] Closing `done` twice is rejected by the test (panic), so caller closes once only.

---

## Core

### Task 8: Bounded Buffer via Buffered Channel

**Problem.** Implement a producer-consumer with a bounded buffer of capacity K, using nothing but a buffered channel of size K. Producer generates 1000 items; consumer reads them. Measure how producer rate adapts when the consumer is slow.

**Constraints.**
- No mutex, no condition variable.
- Capacity K is a parameter.
- Add an artificial `time.Sleep(d)` in the consumer and observe that the producer naturally throttles to consumer speed — that is backpressure for free.

**Hints (try without first).**
- A buffered channel is already a bounded queue. You do not need to wrap it.
- The buffer being full causes the send to block. That is the backpressure.

**Self-check.**
- [ ] Total items produced equals total items consumed (1000).
- [ ] With slow consumer, producer's wall clock matches consumer's.
- [ ] With K=1 the system behaves like unbuffered rendezvous.

---

### Task 9: Fan-In, N to 1

**Problem.** Write `Merge(channels ...<-chan int) <-chan int` that fans N input channels into one output channel. The output closes when all inputs close.

**Constraints.**
- Use one goroutine per input channel.
- Use a single `sync.WaitGroup` only to know when to close the output — channels carry the actual data.
- Must work for any N including 0.

**Hints (try without first).**
- For each input, launch a goroutine that copies values to the output until the input closes.
- A separate "closer" goroutine waits on the WaitGroup and then closes the output.

**Self-check.**
- [ ] All values from all inputs appear in the merged output.
- [ ] Output channel closes after all inputs close, not before.
- [ ] No goroutine leaks with N=0.

---

### Task 10: Fan-Out, 1 to N

**Problem.** Given a single source channel and N workers, distribute incoming work across workers. Each item is processed by exactly one worker. Workers double the integer and send the result to a merged output channel.

**Constraints.**
- All N workers read from the same source channel — natural load balancing through `select`-on-receive.
- Use the fan-in from Task 9 to merge results.
- Bound the result channel's buffer; do not let unbounded buffering hide a slow consumer.

**Hints (try without first).**
- Multiple goroutines receiving from one channel naturally compete: whichever is ready gets the next value.
- The producer is the single closer of the source channel.

**Self-check.**
- [ ] With N workers and M items, total output count is exactly M.
- [ ] Each worker's count is roughly M/N on a balanced workload.
- [ ] When the source closes, all workers and the merger exit and the output channel closes.

---

### Task 11: Pipeline with Context Cancellation

**Problem.** Build a three-stage pipeline: generate integers, filter primes, square them. Each stage runs in its own goroutine. A `context.Context` propagates cancellation: when the context is cancelled, every stage exits within a bounded grace period.

**Constraints.**
- Each stage takes `ctx context.Context` and the relevant input channel; it returns an output channel.
- Each stage uses `select` between sending its output and `<-ctx.Done()`.
- A test must cancel the context mid-stream and verify zero goroutine leaks.

**Hints (try without first).**
- The shape of each stage: a single `for { select { case in, ok := <-input: ...; case <-ctx.Done(): return } }`.
- Closing the output channel on stage exit lets downstream `range`s terminate naturally.

**Self-check.**
- [ ] Pipeline correctly emits squared primes when not cancelled.
- [ ] Cancelling mid-stream stops all stages within, say, 50ms.
- [ ] `goleak` (or a manual `runtime.NumGoroutine` diff) reports no leaks.

---

### Task 12: Worker Pool with Bounded Queue

**Problem.** Build a worker pool that accepts jobs via a bounded queue (channel). N workers process jobs concurrently. Submission blocks when the queue is full — that is the desired backpressure. The pool exposes `Submit(job) error` and `Close()`.

**Constraints.**
- Pool has a configurable worker count and queue capacity.
- `Close()` drains the queue, lets workers finish in-flight jobs, then returns.
- `Submit` after `Close` returns an error rather than panicking.

**Hints (try without first).**
- A buffered channel of `Job` is the queue.
- Workers `range` over the queue; closing the queue triggers their natural exit.
- Wrap the close-flag check in a `sync.Once` to make `Close()` idempotent.

**Self-check.**
- [ ] With queue full, `Submit` blocks the caller until a slot is free.
- [ ] All submitted jobs run exactly once.
- [ ] `Close()` is idempotent and safe to call from any goroutine.

---

### Task 13: Token-Bucket Rate Limiter

**Problem.** Implement a rate limiter that refills tokens at R per second up to capacity B, and provides `Acquire(ctx)` that blocks until a token is available or the context is cancelled. Implement it using only channels and a ticker — no atomics, no mutexes.

**Constraints.**
- The token bucket itself is a buffered channel of capacity B.
- A ticker goroutine attempts to deposit one token per `1/R` seconds via a non-blocking `select`.
- `Acquire` is `<-bucket` racing with `<-ctx.Done()`.

**Hints (try without first).**
- Non-blocking send into a full bucket: `select { case bucket <- struct{}{}: default: }`.
- Start the bucket full (pre-fill B tokens) if you want immediate burst capacity.

**Self-check.**
- [ ] In a 10-second test with R=100, around 1000 acquisitions succeed.
- [ ] Burst of B is permitted immediately if the caller is idle for B/R seconds.
- [ ] Cancellation during `Acquire` returns promptly with the context error.

---

### Task 14: Stream Deduplicator

**Problem.** Given a `<-chan string`, output a `<-chan string` where each value appears at most once. The downstream cardinality may be much smaller than upstream. Add an option to use a TTL so a value can reappear after some time.

**Constraints.**
- Single goroutine owns the seen-set; no shared map.
- Upstream closure causes downstream closure.
- TTL variant uses a `time.AfterFunc` per entry — clean up timers when the dedup goroutine exits.

**Hints (try without first).**
- Hand the seen-set to one goroutine and let it own all reads and writes.
- For TTL, on insert schedule a deletion message back through a channel; do not modify the map from the timer callback directly.

**Self-check.**
- [ ] With 100 inputs containing 10 unique values, output yields exactly 10.
- [ ] With TTL=100ms, a value that reappears after 150ms passes through again.
- [ ] No leaked timers after the input closes.

---

### Task 15: Ticker plus Debouncer

**Problem.** Implement a `Debouncer` that, when it receives rapid events, only emits one event per quiet period of `d`. Concretely: signature `Debounce(in <-chan Event, d time.Duration) <-chan Event`.

**Constraints.**
- A burst of events within `d` should collapse into a single emission carrying the last event.
- The implementation should not leak the timer when input closes.
- Bonus: add a "leading edge" mode that emits the first event immediately and then suppresses for `d`.

**Hints (try without first).**
- Hold a `*time.Timer`. On each input, reset it; on timer fire, emit the latest event.
- `Timer.Reset` on a timer that may have already fired requires care — draining the timer's channel is the safe pattern.

**Self-check.**
- [ ] With 100 events at 1ms intervals and d=50ms, exactly one event is emitted.
- [ ] Switching between trailing and leading edge mode is a one-flag change, not a rewrite.
- [ ] No leaked goroutines or timers after `in` closes.

---

### Task 16: Heartbeat Channel

**Problem.** A long-running worker emits a heartbeat every `interval` on a dedicated channel so a supervisor can detect hangs. If the supervisor misses two heartbeats, it considers the worker stuck and triggers cancellation.

**Constraints.**
- Worker sends heartbeats non-blockingly: if the supervisor is not ready, the worker does not stall.
- Supervisor uses `select` with a timer reset after each heartbeat.
- On stall detection, supervisor cancels the worker's context.

**Hints (try without first).**
- Heartbeat send uses `select { case hb <- struct{}{}: default: }`.
- Supervisor's `select`: `case <-hb: resetTimer(); case <-timer.C: cancel(); return`.

**Self-check.**
- [ ] Healthy worker runs indefinitely without false-positive stalls.
- [ ] Inserting an artificial `time.Sleep(3*interval)` in the worker triggers cancellation.
- [ ] Cancelled worker exits within a bounded grace period.

---

### Task 17: Or-Done Channel

**Problem.** Implement `OrDone(done <-chan struct{}, in <-chan T) <-chan T` that returns a channel which forwards `in` until either `in` closes or `done` is closed. This is a building block that simplifies cancellation-aware loops elsewhere.

**Constraints.**
- Generic if you have Go 1.18+, or a typed version for `int`.
- Calling code uses `for v := range OrDone(done, in) { ... }` and never sees `done` directly.
- No leaks even if `done` fires while `in` still has buffered values.

**Hints (try without first).**
- Forwarder goroutine: `select { case v, ok := <-in: if !ok return; select { case out <- v: case <-done: return }; case <-done: return }`.
- Close `out` in a `defer`.

**Self-check.**
- [ ] Forwards values one-for-one in the steady state.
- [ ] Closing `done` causes the returned channel to close within one value.
- [ ] No "send on closed channel" panic in any race condition.

---

## Advanced

### Task 18: Structured Concurrency Wrapper

**Problem.** Build a small structured-concurrency primitive: `Group` with `Go(func(ctx context.Context) error)` and `Wait() error`. If any goroutine returns an error, the group's context is cancelled so siblings can exit. `Wait` returns the first error.

**Constraints.**
- Do not just rename `errgroup.Group` — write it yourself first, then compare to `golang.org/x/sync/errgroup`.
- The group must propagate the context to every spawned goroutine.
- After `Wait` returns, no goroutines from the group remain.

**Hints (try without first).**
- Underneath: a `sync.WaitGroup`, a `context.CancelFunc`, and a `sync.Once` for the first error.
- The CSP angle: the parent owns the lifetime of the children; no goroutine outlives its parent scope.

**Self-check.**
- [ ] Successful group returns `nil` after all goroutines finish.
- [ ] First failing goroutine cancels siblings within a tight bound.
- [ ] `goleak` reports no leftover goroutines.

---

### Task 19: Dynamic Stage Pipeline

**Problem.** Build a pipeline where stages can be added or removed at runtime. The interface: `pipeline.Push(stage)` appends a stage; `pipeline.PopFront()` removes the head. Input items flow through whatever stages currently exist.

**Constraints.**
- A new stage seamlessly becomes part of the flow on the next item, not retroactively.
- Removing a stage drains it cleanly — no items lost, no leaks.
- The control plane (Push/Pop) communicates with the data plane via channels, not via shared state.

**Hints (try without first).**
- Each stage owns its input channel and reads control messages on a separate command channel.
- "Insert stage" sends a message to the current head telling it to forward to the new stage instead of the old next.

**Self-check.**
- [ ] Adding a stage mid-stream changes downstream output as expected.
- [ ] Removing a stage neither drops items nor duplicates them.
- [ ] Concurrent Push/Pop calls do not corrupt the pipeline.

---

### Task 20: Channel of Channels for Routing

**Problem.** Implement a router where each incoming request carries its own reply channel. The server reads requests from a single inbox, processes them, and replies on the request's own channel. Requesters wait on their personal reply channel — there is no shared response queue.

**Constraints.**
- The request type embeds `Reply chan<- Response`.
- The server is a single goroutine.
- Test with 100 concurrent requesters; each must get its own reply.

**Hints (try without first).**
- This is the canonical CSP-style RPC pattern — sometimes called "request-reply via channel-of-channels".
- An unbuffered reply channel forces the server to wait for the requester to receive. A buffered reply channel (capacity 1) lets the server move on immediately.

**Self-check.**
- [ ] All 100 requesters receive their reply, with no crosstalk.
- [ ] The server is a single goroutine and processes requests sequentially.
- [ ] Cancelling a requester does not block the server.

---

### Task 21: Throughput Benchmark

**Problem.** Measure messages-per-second for: (a) one sender, one receiver, unbuffered channel; (b) same but buffered with capacity 1, 16, 256, 4096; (c) one sender, N receivers via fan-out; (d) the same using a `sync.Mutex`-protected queue. Plot the numbers and write a brief analysis.

**Constraints.**
- Use `testing.B` benchmarks; run with `-benchtime=5s -count=5`.
- Pin GOMAXPROCS for repeatability.
- Report both ops/sec and ns/op.

**Hints (try without first).**
- Unbuffered channels are slower than small-buffered channels per op but offer stricter ordering.
- The mutex-queue may win on raw throughput but loses on cancellation and composability.

**Self-check.**
- [ ] Numbers are stable across runs (low variance).
- [ ] You can explain why buffer 256 is faster than buffer 1 but not 100x faster than buffer 4096.
- [ ] Analysis notes the difference between throughput and latency under contention.

---

### Task 22: Leak Detection in a Buggy Select

**Problem.** You are given a function that supposedly returns the first response from a slice of upstream services, like a "scatter-first-reply" pattern. It leaks goroutines because the losing requests are abandoned without anyone reading their reply channels. Find the leak, write a test that detects it, then fix it.

**Constraints.**
- Use `goleak.VerifyNone(t)` or a manual `runtime.NumGoroutine` baseline.
- Two acceptable fixes: (a) buffered reply channels of size 1 so writes do not block after the loser is abandoned; (b) `context.WithCancel` so losers observe the cancellation and abort.
- Prefer the context fix; write a comment explaining why.

**Hints (try without first).**
- An unread send on an unbuffered channel blocks forever — that is your leak.
- The CSP-style fix is to propagate "I lost, you can stop" via a closed channel or a cancelled context.

**Self-check.**
- [ ] Test fails on the buggy version.
- [ ] Test passes on the fixed version.
- [ ] No leftover goroutines after `Scatter` returns, regardless of how many upstreams there are.

---

### Task 23: Semaphore-as-Channel

**Problem.** Implement a counting semaphore with capacity N using only a buffered channel. Provide `Acquire(ctx) error` and `Release()`. Use it to bound concurrency of HTTP fetches in a small crawler.

**Constraints.**
- The channel is the semaphore — no extra state.
- `Acquire` honours context cancellation.
- `Release` of an unheld token is a programmer error and should panic in development builds.

**Hints (try without first).**
- A buffered channel of `struct{}` capacity N: send to acquire, receive to release (or the inverse — pick one and document).
- `Acquire`: `select { case ch <- struct{}{}: return nil; case <-ctx.Done(): return ctx.Err() }`.

**Self-check.**
- [ ] At most N concurrent holders at any moment (verify with an atomic counter inside the protected section).
- [ ] Cancellation during `Acquire` returns promptly.
- [ ] Crawler with semaphore(8) never exceeds 8 in-flight HTTP requests.

---

### Task 24: Priority Select

**Problem.** Implement a function that prefers values from `high` over `low` when both are ready. `select` itself is randomised, so you have to layer logic on top. The function returns when both channels close.

**Constraints.**
- Must never starve `low` indefinitely if `high` is empty.
- Must prefer `high` when both are ready (tested with deterministic priming).
- No `time.Sleep` busy-waits.

**Hints (try without first).**
- The pattern: try a non-blocking receive on `high` first; if nothing, fall through to a blocking `select` on both.
- Closing semantics: a closed channel is "always ready" with the zero value — handle the `ok` flag.

**Self-check.**
- [ ] When `high` has values, `low` is consumed only when `high` is empty.
- [ ] When `high` is empty, `low` is consumed promptly.
- [ ] Closing both channels terminates the loop cleanly.

---

### Task 25: Backpressure-Aware Multiplexer

**Problem.** Build a multiplexer that combines N input streams into one output, but with the rule that each input has a maximum share of throughput. If one source floods, it does not crowd out the others.

**Constraints.**
- Per-input rate caps configurable.
- Output buffer bounded; flooding source observes backpressure on its own input.
- Fairness measured: with one source at 10k/s and others at 100/s each, others still get their full share.

**Hints (try without first).**
- A per-source goroutine fronts each input with a rate limiter (Task 13).
- Fan-in (Task 9) merges the rate-limited streams.

**Self-check.**
- [ ] Per-source rate cap is observed under heavy load.
- [ ] Slow sources are not starved.
- [ ] The multiplexer exits cleanly when all sources close.

---

## Capstone

The Capstone tasks are larger. They are designed to be done over several sittings, with tests, with measurements, and with a short write-up at the end describing what worked, what failed, and what trade-offs you made.

### Capstone 1: Market-Data Pipeline with Backpressure

**Problem.** Build a market-data ingestion pipeline. Multiple sources push price ticks at high but variable rates. Stages: ingest, normalise (uniform schema), filter (drop ticks for symbols not subscribed), aggregate (1-second OHLC bars), and publish to consumers. Consumers may be slow. The pipeline must apply backpressure correctly: a slow consumer must throttle upstream stages without dropping data silently. If a stage genuinely cannot keep up, it should drop with a recorded counter, not block forever.

**Constraints.**
- Each stage is a goroutine (or worker pool) with a bounded input channel.
- Context cancellation propagates from root to leaves.
- Metrics: dropped count per stage, queue depth per stage, end-to-end latency histogram.
- A test simulates a slow consumer and verifies that upstream slows down rather than buffering unboundedly.

**What "done" looks like.** You can demo this for a senior engineer in fifteen minutes. You can show that under healthy load, no drops occur and latency stays under your stated bound. You can show that when a consumer slows by 10x, upstream observably slows too — you can point at the metrics and say "this is where the backpressure took effect". You can cancel the root context and watch every goroutine exit within a tight window. You can answer the question "what happens if a single source goes bad?" with a clear story: a per-source rate cap and a circuit breaker isolate it.

**Hints (try without first).**
- Use bounded channels everywhere; that is your backpressure.
- For the slow-consumer case, decide ahead of time: drop newest, drop oldest, or block. Document the choice.
- The aggregate stage owns time: use a ticker to flush each 1-second window, not the arrival rate.

**Sample Solution (sketch).**

```go
type Tick struct {
    Symbol string
    Price  float64
    TS     time.Time
}

type Bar struct {
    Symbol           string
    Open, High, Low, Close float64
    Count            int
    WindowStart      time.Time
}

func Ingest(ctx context.Context, sources []<-chan Tick) <-chan Tick {
    out := make(chan Tick, 1024)
    var wg sync.WaitGroup
    for _, src := range sources {
        wg.Add(1)
        go func(s <-chan Tick) {
            defer wg.Done()
            for {
                select {
                case t, ok := <-s:
                    if !ok {
                        return
                    }
                    select {
                    case out <- t:
                    case <-ctx.Done():
                        return
                    }
                case <-ctx.Done():
                    return
                }
            }
        }(src)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}

func Aggregate(ctx context.Context, in <-chan Tick) <-chan Bar {
    out := make(chan Bar, 256)
    go func() {
        defer close(out)
        bars := map[string]*Bar{}
        tick := time.NewTicker(time.Second)
        defer tick.Stop()
        for {
            select {
            case t, ok := <-in:
                if !ok {
                    flush(bars, out, ctx)
                    return
                }
                update(bars, t)
            case <-tick.C:
                flush(bars, out, ctx)
                bars = map[string]*Bar{}
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

**Self-check.**
- [ ] Under healthy load, drops are zero across all stages.
- [ ] Under a slow consumer, upstream throughput throttles smoothly.
- [ ] Context cancel propagates and exits every goroutine in under 100ms.
- [ ] Metrics are observable via Prometheus or a simple `/metrics` endpoint.

---

### Capstone 2: Refactor Goroutine Soup into Structured Concurrency

**Problem.** You are given (or you write deliberately) a "goroutine soup" service: a system where goroutines are spawned in many places, ownership is unclear, cancellation is via global state or shared channels, and shutdown is a guessing game. Your task is to refactor it into a structured-concurrency shape where every goroutine has an explicit parent scope, every scope has an explicit cancellation path, and the program shuts down cleanly when the root scope ends.

**Constraints.**
- Before refactoring, document the current shape with a diagram: who spawns what, and via which channel.
- After refactoring, every goroutine is spawned within a `Group` (Task 18) or `errgroup`.
- Add a `goleak` check to the test suite; it must pass.
- Shutdown latency from `Cancel()` to all-goroutines-exited must be measured and bounded.

**What "done" looks like.** You can hand the diff to a colleague and they can read the lifetime story top-to-bottom: the root context is created here, it spawns these subgroups, each subgroup owns these workers, here is where they all exit. There is no `go someFunc()` floating in main without a parent. There is no shared `done` channel pinged from three places. Cancellation is one call, and a test verifies it takes under, say, 200ms to drain the system.

**Hints (try without first).**
- Start by drawing the goroutine graph. Identify orphans: goroutines whose parent is unclear.
- Replace shared `done` channels with a single root `context.Context` and `errgroup.WithContext`.
- Move "fire and forget" goroutines into named groups; if you cannot name the group, the goroutine probably should not exist.

**Sample Solution (sketch).**

```go
func Run(ctx context.Context, cfg Config) error {
    g, ctx := errgroup.WithContext(ctx)

    ticks := make(chan Tick, 256)
    bars := make(chan Bar, 64)

    g.Go(func() error { return runIngest(ctx, cfg.Sources, ticks) })
    g.Go(func() error { return runAggregator(ctx, ticks, bars) })
    g.Go(func() error { return runPublisher(ctx, bars, cfg.Sinks) })

    return g.Wait()
}
```

Compared to a pre-refactor version that scattered `go ingest(...)`, `go aggregate(...)`, `go publish(...)` across `main` with separate `done` channels, this version makes the lifetime tree explicit: every child goroutine lives inside `g`, every child sees the same `ctx`, and `g.Wait()` is the single join point that returns the first error.

**Self-check.**
- [ ] Goroutine graph diagram before and after.
- [ ] `goleak` passes in tests.
- [ ] Cancellation latency is measured and within the stated bound.
- [ ] No global `done` channel survives the refactor.

---

### Capstone 3: CSPm Specification with FDR Model Checking

**Problem.** Pick a critical concurrent workflow from a real system you maintain (or invent a small but realistic one: a two-phase commit, a leader-election handshake, a transactional message queue with at-most-once delivery). Write a CSPm specification — that is, Hoare's CSP in the machine-readable dialect that FDR4 accepts. Use FDR4 (free for academic use) to model-check the specification for deadlock-freedom, divergence-freedom, and at least one safety property and one liveness property you care about.

**Constraints.**
- The CSPm file is committed alongside the Go implementation.
- At least one safety property is expressed as a refinement check: `SpecSafety [T= System`.
- At least one liveness property is expressed: `SpecLive [F= System` (failures refinement).
- Deadlock check: `assert System :[deadlock free [F]]`.
- Write a short report: what the model caught (or did not catch), how the model differs from the implementation, and what changed in the implementation as a result.

**What "done" looks like.** You have a `.csp` file that FDR4 loads cleanly. You have at least three assertion results in your report — deadlock check, safety refinement, liveness refinement. At least one assertion either failed (and you fixed the spec or the design) or you can explain why it trivially passes. You can describe in plain English what the model proves: "if any quorum of three replicas agrees, the leader is unique" or "no message is delivered twice across crash-recovery cycles". You understand the cost: the model abstracts away timing and unbounded data, and you can describe what the abstraction sacrifices.

**Hints (try without first).**
- Start tiny: two processes, three states each. Get FDR4 running and a trivial assertion passing before you scale up.
- Channels in CSPm are events, not Go channels. `c!x -> P` sends `x` on event `c` then becomes `P`.
- Hidden events (using `\\`) are crucial for refinement checks; otherwise the spec must match the implementation event-for-event.

**Sample Solution (sketch, CSPm).**

```cspm
channel req, ack, commit, abort : {0, 1}

Coordinator(participants) =
  req ! 0 -> req ! 1 ->
  ack ? a0 -> ack ? a1 ->
    if a0 == 1 and a1 == 1 then
      commit ! 0 -> commit ! 1 -> SKIP
    else
      abort ! 0 -> abort ! 1 -> SKIP

Participant(id, votesYes) =
  req ? r ->
    (if votesYes then ack ! 1 else ack ! 0) ->
    (commit ? c -> SKIP [] abort ? a -> SKIP)

System =
  Coordinator(2) [| {| req, ack, commit, abort |} |]
    (Participant(0, true) ||| Participant(1, true))

assert System :[deadlock free [F]]
assert System :[divergence free]
```

The report then notes which assertions held, what initial bug FDR4 caught (typically a missing case in the coordinator's response handling), and how that bug would have manifested in production code under specific race conditions.

**Self-check.**
- [ ] `.csp` file compiles and FDR4 loads it.
- [ ] At least one passing safety refinement.
- [ ] At least one passing liveness or deadlock-freedom check.
- [ ] Report identifies a specific design change driven by the model-check result, or argues credibly why the model is already correct.

---

### Capstone 4: Distributed Sharded Worker Mesh

**Problem.** Build a sharded worker mesh: a fixed set of N worker processes (which can be N goroutines for a single-process simulation, then re-architected as N processes communicating over gRPC if you want to push further). Each worker owns a shard determined by `hash(key) mod N`. Requests are routed to the owning worker. Workers may stall or restart; the mesh must heal. The CSP angle: each worker is a sequential process, each link is a typed channel, and the supervisor reasons about the whole as a process algebra rather than as a shared-memory soup.

**Constraints.**
- A router process accepts requests and forwards them to the correct worker by shard.
- A supervisor process monitors heartbeats from each worker (Task 16) and triggers restart on stall.
- A simulated worker stall must be detected and healed within a bounded interval.
- Tests: send 10k requests under steady state, then under a single-worker stall, then under a router restart.

**What "done" looks like.** You have a diagram of processes and channels. You can describe the system in CSP terms: `Router = req?r -> workers[shard(r)] ! r -> Router`. You can demo a worker stall, see the supervisor restart it, and see request throughput recover. You can describe the failure modes you do not handle (network partition, split brain) and why.

**Hints (try without first).**
- For the single-process simulation, each worker is a goroutine with its own input channel; the router is a single goroutine that owns the routing map.
- For the multi-process version, swap channels for gRPC streams; the structure is preserved.
- The supervisor lives outside the data plane; it should never sit on a critical request path.

**Self-check.**
- [ ] Throughput is steady at 10k req/s in steady state.
- [ ] A simulated worker stall is detected and healed within your stated bound.
- [ ] A router restart loses no in-flight requests if you choose at-least-once semantics, or explains exactly which it loses if at-most-once.
- [ ] Diagram and short write-up are committed.

---

## Related Topics

- [Concurrency Models — Index](../README.md)
- [Threading Model](../01-threading/README.md)
- [Actor Model](../02-actors/README.md)
- [Coroutines and Fibers](../03-coroutines/README.md)
- [Event Loop Model](../05-event-loop/README.md)
- [Concurrency — Topic Index](../../README.md)
- [Language Internals](../../../README.md)

---

If you can do all of these, you have the CSP foundation that a strong senior engineer would expect.

# Channels — Hands-On Tasks

> **Topic:** [Channels](README.md)

---

## Introduction

Channels are the connective tissue of message-passing concurrency. Whereas mutexes coordinate by protecting shared memory, channels coordinate by moving values between goroutines, threads, or async tasks. The slogan "do not communicate by sharing memory; share memory by communicating" pushes designers to model concurrency as a network of producers, consumers, and pipelines connected by typed conduits. The discipline this forces — explicit ownership transfer, bounded buffers, deliberate backpressure — tends to produce systems that fail in observable ways instead of subtle data races.

These tasks build channel intuition from the ground up. The Warm-Up exercises focus on the smallest building blocks: a single producer talking to a single consumer, the role of `select`, the difference between sending and closing. The Core tasks introduce structural patterns — fan-in, fan-out, pipelines, worker pools, rate limiting — and the cross-language equivalents in Rust's `tokio::sync::mpsc` and `broadcast`. The Advanced tasks tackle the gnarly parts: structured concurrency wrappers that guarantee no goroutine outlives its parent, dynamic pipelines whose stages change at runtime, leak detection in misused `select` blocks, and a from-scratch LMAX Disruptor-style ring buffer. The Capstones combine everything into realistic systems: a market-data pipeline with end-to-end backpressure, a refactor of a tangled goroutine-soup service into a structured tree, and a high-throughput log shipper that must not drop messages under burst load.

Work through them in order. Each task lists constraints that mirror real production concerns — bounded resources, cancellation, observability — so the patterns you learn here transfer directly to services you will build and maintain. When a task offers a Go and a Rust variant, prefer doing both; the contrast between Go's channel-as-language-primitive and Rust's channel-as-library design teaches more than either alone.

## Table of Contents

- [Warm-Up](#warm-up)
  - [Task 1: Producer/Consumer with a Single Channel](#task-1-producerconsumer-with-a-single-channel)
  - [Task 2: Ping-Pong Between Two Goroutines](#task-2-ping-pong-between-two-goroutines)
  - [Task 3: Periodic Heartbeat via `time.Ticker`](#task-3-periodic-heartbeat-via-timeticker)
  - [Task 4: Non-Blocking `select` with `default`](#task-4-non-blocking-select-with-default)
  - [Task 5: Directional Channel Types as API Contracts](#task-5-directional-channel-types-as-api-contracts)
  - [Task 6: Close-as-Broadcast Cancellation Signal](#task-6-close-as-broadcast-cancellation-signal)
  - [Task 7: Range Over a Channel Until Close](#task-7-range-over-a-channel-until-close)
- [Core](#core)
  - [Task 8: Bounded Buffer with a Buffered Channel](#task-8-bounded-buffer-with-a-buffered-channel)
  - [Task 9: Fan-In Merging N Channels into One](#task-9-fan-in-merging-n-channels-into-one)
  - [Task 10: Fan-Out from One Source to N Workers](#task-10-fan-out-from-one-source-to-n-workers)
  - [Task 11: Three-Stage Pipeline with `context` Cancellation](#task-11-three-stage-pipeline-with-context-cancellation)
  - [Task 12: Worker Pool with Result Channel](#task-12-worker-pool-with-result-channel)
  - [Task 13: Rate Limiter via Token-Bucket Channel](#task-13-rate-limiter-via-token-bucket-channel)
  - [Task 14: Rust `tokio::mpsc` Producer/Consumer](#task-14-rust-tokiompsc-producerconsumer)
  - [Task 15: Rust `tokio::broadcast` Fan-Out](#task-15-rust-tokiobroadcast-fan-out)
  - [Task 16: One-Shot Request/Reply Pattern](#task-16-one-shot-requestreply-pattern)
- [Advanced](#advanced)
  - [Task 17: Structured Concurrency Wrapper](#task-17-structured-concurrency-wrapper)
  - [Task 18: Dynamic Stage Pipeline](#task-18-dynamic-stage-pipeline)
  - [Task 19: Channel-of-Channels for Routing](#task-19-channel-of-channels-for-routing)
  - [Task 20: Benchmark `crossbeam` vs `std::sync::mpsc`](#task-20-benchmark-crossbeam-vs-stdsyncmpsc)
  - [Task 21: Leaky `select` Bug Hunt](#task-21-leaky-select-bug-hunt)
  - [Task 22: Mini LMAX Disruptor Ring Buffer](#task-22-mini-lmax-disruptor-ring-buffer)
  - [Task 23: Priority Select Across Channels](#task-23-priority-select-across-channels)
- [Capstone](#capstone)
  - [Task 24: Market-Data Pipeline with Backpressure](#task-24-market-data-pipeline-with-backpressure)
  - [Task 25: Refactor a Goroutine-Soup Service to Structured Concurrency](#task-25-refactor-a-goroutine-soup-service-to-structured-concurrency)
  - [Task 26: High-Throughput Log Shipper](#task-26-high-throughput-log-shipper)
- [Sample Solutions](#sample-solutions)
- [Related Topics](#related-topics)

---

## Warm-Up

These tasks should each take ten to thirty minutes. Their goal is muscle memory: writing send/receive expressions, recognizing when a channel will block, and seeing what happens when one side closes.

### Task 1: Producer/Consumer with a Single Channel

**Problem.** Write a Go program with two goroutines connected by a single unbuffered channel of `int`. The producer sends the integers 1 through 10, then closes the channel. The consumer prints each value received. The `main` function waits for the consumer to finish.

**Constraints.**
- Use exactly one channel.
- The consumer must detect the close and exit cleanly without panicking.
- Synchronize the main goroutine using either a `done` channel or a `sync.WaitGroup`; do not use `time.Sleep`.

**Hints.**
- The two-value receive form `v, ok := <-ch` tells you whether the channel was closed.
- Equivalently, `for v := range ch` exits automatically when the channel closes.
- Only the producer should call `close(ch)` — closing from the consumer side is almost always a bug.

**Self-check.** If you remove the `close` call, what happens? If you replace `close` with `ch <- 0`, why is that an inferior signal? Can the producer ever block on send here?

---

### Task 2: Ping-Pong Between Two Goroutines

**Problem.** Two goroutines bounce a single token back and forth one hundred times. Goroutine A sends "ping" on channel `ab`, goroutine B receives it, prints it, then sends "pong" on channel `ba`. Goroutine A receives "pong" and the cycle repeats.

**Constraints.**
- Use two unbuffered channels.
- Each iteration must print both "ping" and "pong" in order.
- The program must terminate after exactly one hundred round trips.

**Hints.**
- Pass directional channel types to the goroutine functions: `func a(send chan<- string, recv <-chan string)`.
- Use a loop counter and `break` after one hundred iterations.

**Self-check.** Why does this work without any mutex? What guarantees the print order across goroutines?

---

### Task 3: Periodic Heartbeat via `time.Ticker`

**Problem.** Write a function that returns a channel emitting the current Unix timestamp every 100 milliseconds. Consume ten heartbeats in `main` and print each one, then stop the ticker.

**Constraints.**
- Use `time.NewTicker`, not `time.Sleep` in a loop.
- The producer goroutine must exit when a `done` channel is closed.
- No goroutine leak: after `main` returns, the producer must be gone.

**Hints.**
- `ticker.C` is a `<-chan time.Time` you can read from directly or forward via a worker goroutine.
- `select { case <-ticker.C: ...; case <-done: return }` is the idiomatic stop pattern.
- Always call `ticker.Stop()` to release the underlying timer.

**Self-check.** What happens if the consumer reads slower than 100 ms per tick? Does Go's ticker drop ticks or queue them?

---

### Task 4: Non-Blocking `select` with `default`

**Problem.** Implement a `trySend(ch chan<- int, v int) bool` and `tryRecv(ch <-chan int) (int, bool)` pair using `select` with a `default` clause. The functions must never block.

**Constraints.**
- A successful send returns `true`; a would-block send returns `false`.
- A successful receive returns the value and `true`; an empty channel returns the zero value and `false`.
- Test against an unbuffered channel, a buffered channel that is full, and a closed channel.

**Hints.**
- `select { case ch <- v: return true; default: return false }`.
- For receive, the two-value form inside the case distinguishes a real value from a closed-channel zero.

**Self-check.** Why does `tryRecv` on a closed channel always succeed and return the zero value? Is that the behavior you want?

---

### Task 5: Directional Channel Types as API Contracts

**Problem.** Write a function `generator(out chan<- int, count int)` that sends `count` integers and closes the channel, and a function `printer(in <-chan int)` that prints every value received. Connect them with a single bidirectional channel created in `main`.

**Constraints.**
- The compiler must reject any attempt by `printer` to send or by `generator` to receive.
- Use direction conversion only at the call site, never with explicit casts inside the functions.

**Hints.**
- A bidirectional `chan T` implicitly converts to `chan<- T` or `<-chan T` when passed as an argument.
- The reverse conversion is not allowed; this is what gives directional types their teeth.

**Self-check.** What error does the compiler emit if you try `out <- v` inside `printer`? Why is this restriction valuable in larger codebases?

---

### Task 6: Close-as-Broadcast Cancellation Signal

**Problem.** Spawn five worker goroutines, each blocked on `<-quit`. After one second, close `quit` from `main` and observe that all five workers unblock simultaneously.

**Constraints.**
- Use a single `chan struct{}` named `quit`.
- Each worker prints its ID before exiting.
- Demonstrate that order of unblocking is not guaranteed.

**Hints.**
- Closing a channel makes every pending receive complete with the zero value.
- `chan struct{}` carries no data, so it is the canonical signal type.

**Self-check.** Why is closing better than sending five separate values? What would go wrong if a worker also closed `quit`?

---

### Task 7: Range Over a Channel Until Close

**Problem.** Write a producer that pushes a slice of strings onto a channel and closes it. Consume them with `for v := range ch` and append each value to a result slice. Print the result.

**Constraints.**
- Use exactly one goroutine on each side.
- The consumer must not know in advance how many values to expect.

**Hints.**
- `for v := range ch` exits when `ch` is closed and drained.
- Closing a nil channel panics; closing a channel twice panics; sending on a closed channel panics. Internalize these rules now.

**Self-check.** What happens if you forget to close the channel? Where does the consumer block?

---

## Core

The Core tasks introduce the patterns you will reach for daily: bounded queues, fan-in/fan-out, pipelines, worker pools, and rate limiters. Several have Rust variants using `tokio::sync` so you can compare ergonomics across languages.

### Task 8: Bounded Buffer with a Buffered Channel

**Problem.** Implement a thread-safe bounded queue with capacity `N` using only a buffered channel. Provide `Push(v)` and `Pop() (v, ok)` methods. `Pop` returns `ok = false` when the queue is closed and drained.

**Constraints.**
- The data structure must hold no more than `N` items at any moment.
- `Push` blocks when full; `Pop` blocks when empty.
- A `Close` method makes future `Push` calls return an error and unblocks all pending `Pop` calls.

**Hints.**
- The channel itself is the buffer; you do not need a separate slice plus mutex.
- The close-then-drain semantics fall out of `for v := range ch` for free.
- Wrap the type in a struct so you can attach a `closed atomic.Bool` for safe `Push` rejection.

**Self-check.** What is the difference between this implementation and a `sync.Mutex`-guarded slice with a `sync.Cond`? Which has more predictable wake-up behavior?

---

### Task 9: Fan-In Merging N Channels into One

**Problem.** Write a function `Merge(chans ...<-chan int) <-chan int` that returns a single channel emitting every value from every input channel and closes when all inputs are closed.

**Constraints.**
- The function must work for any number of inputs known at call time.
- The output order is unspecified; you only guarantee that every value appears exactly once.
- Use a `sync.WaitGroup` to know when to close the output.

**Hints.**
- Spawn one goroutine per input channel; each goroutine ranges over its input and forwards to the output.
- Spawn one additional goroutine that calls `wg.Wait()` and then `close(out)`.

**Self-check.** What happens if you pass zero channels? Does `Merge()` return a channel that is already closed?

---

### Task 10: Fan-Out from One Source to N Workers

**Problem.** Given an input channel of jobs and `N` workers, each worker should consume from the same input channel. When the input closes, every worker should exit and signal completion via a `WaitGroup`.

**Constraints.**
- Workers must share the input channel directly; do not create per-worker channels.
- The dispatcher should not need to know `N` at queue time.
- Demonstrate that work is distributed roughly evenly under load.

**Hints.**
- The runtime's scheduling makes a single `<-chan` shared by N goroutines an implicit work-stealing queue.
- Use atomic counters in each worker to count items processed and print the distribution at the end.

**Self-check.** Under what condition will distribution be uneven? What if jobs vary wildly in cost?

---

### Task 11: Three-Stage Pipeline with `context` Cancellation

**Problem.** Build a pipeline `generate -> square -> sum` where each stage runs in its own goroutine, the stages are connected by channels, and a `context.Context` can cancel the whole pipeline mid-stream.

**Constraints.**
- Each stage must use `select` to listen for both the inbound channel and `ctx.Done()`.
- On cancellation, every stage must drain or discard remaining input, close its output, and exit.
- The pipeline must not leak any goroutines after cancellation.

**Hints.**
- Stage skeleton: `for { select { case v, ok := <-in: ...; case <-ctx.Done(): return } }`.
- Always `defer close(out)` so downstream stages naturally unblock.

**Self-check.** Run the test with `-race` and `goleak`. Does any goroutine survive after the context is cancelled?

---

### Task 12: Worker Pool with Result Channel

**Problem.** Implement a worker pool that processes `Job` values from a job channel and writes `Result` values to a result channel. The caller submits jobs, then closes the job channel; the pool closes the result channel when all workers have finished.

**Constraints.**
- The number of workers is configurable.
- The result channel must be closed exactly once, after the last result is sent.
- Errors inside a worker should be reported via the `Result`, not via panic.

**Hints.**
- Use the pattern: jobs goroutine -> N workers -> results goroutine. A separate `wg.Wait` + `close(results)` goroutine handles the closing.
- Resist the urge to call `close(results)` from inside a worker.

**Self-check.** What happens if a caller forgets to close the job channel? How would you guard against that in a library?

---

### Task 13: Rate Limiter via Token-Bucket Channel

**Problem.** Build a rate limiter that allows at most `R` operations per second and bursts of up to `B` operations. The limiter exposes `Wait(ctx)` that blocks until a token is available or the context is cancelled.

**Constraints.**
- Use a buffered channel of size `B` as the token bucket.
- A goroutine refills the bucket every `1/R` seconds.
- `Wait` returns `ctx.Err()` on cancellation; otherwise `nil`.

**Hints.**
- Pre-fill the bucket with `B` tokens on construction.
- The refill goroutine uses a `select` with `default` so it does not block when the bucket is full.

**Self-check.** Compare this to `golang.org/x/time/rate`. Where would yours behave differently? Hint: think about token timing under bursty consumption.

---

### Task 14: Rust `tokio::mpsc` Producer/Consumer

**Problem.** Rewrite Task 1 in Rust using `tokio::sync::mpsc::channel`. Spawn an async task that sends 1..=10, then drops the sender. The consumer receives until `None`.

**Constraints.**
- Use a bounded `mpsc` with capacity 4 to feel backpressure.
- The consumer must detect `None` from `recv().await` to terminate.

**Hints.**
- `let (tx, mut rx) = mpsc::channel(4); tokio::spawn(async move { for i in 1..=10 { tx.send(i).await.unwrap(); } });`.
- Dropping `tx` is the equivalent of Go's `close`.

**Self-check.** What is the difference between `mpsc::channel(0)` and Go's unbuffered channel? Hint: it isn't allowed; minimum capacity is one.

---

### Task 15: Rust `tokio::broadcast` Fan-Out

**Problem.** Use `tokio::sync::broadcast::channel` to fan out a stream of integers to three subscribers. Each subscriber prints what it receives.

**Constraints.**
- All three subscribers must see all values.
- Demonstrate the `Lagged` error when a slow subscriber falls behind the buffer.

**Hints.**
- `let (tx, _) = broadcast::channel(16); let mut rx1 = tx.subscribe();`.
- `match rx1.recv().await { Ok(v) => ..., Err(broadcast::error::RecvError::Lagged(n)) => ..., Err(Closed) => break }`.

**Self-check.** Why does `broadcast` keep history while Go channels do not? What use cases prefer each?

---

### Task 16: One-Shot Request/Reply Pattern

**Problem.** Implement a request/reply pattern where a client sends a request struct containing a reply channel, the server receives, processes, and sends the reply back through the embedded channel.

**Constraints.**
- The reply channel is unbuffered or buffered with capacity 1; choose and justify.
- The client must time out using `select` with `time.After` if the server is slow.
- The server must not leak goroutines if the client gives up.

**Hints.**
- `type Request struct { Payload string; Reply chan<- string }`.
- Buffered capacity 1 lets the server send the reply without blocking even if the client has already moved on.

**Self-check.** What happens if the client closes the reply channel before the server responds? Should the server detect this?

---

## Advanced

The Advanced tasks demand structural thinking: how to build channel abstractions that scale to real programs, how to debug subtle misuse, and how to reason about throughput.

### Task 17: Structured Concurrency Wrapper

**Problem.** Build a `Group` type whose `Go(func(ctx context.Context) error)` method spawns goroutines that are guaranteed to be joined when `Wait` returns. If any goroutine returns an error, the shared `ctx` is cancelled and the first error is returned from `Wait`.

**Constraints.**
- Mirror the semantics of `golang.org/x/sync/errgroup` but write it yourself.
- No goroutine spawned through the group may outlive `Wait`.
- The first non-nil error wins; subsequent errors are dropped.

**Hints.**
- Store a `sync.WaitGroup`, a `context.CancelFunc`, and a `sync.Once` for the first error.
- Each spawned goroutine calls `defer wg.Done()` and `errOnce.Do(...)` on error before `cancel()`.

**Self-check.** Compare your version to the actual `errgroup`. What edge cases (panic inside a goroutine, nil function) does the standard library handle?

---

### Task 18: Dynamic Stage Pipeline

**Problem.** Build a pipeline whose stages can be added or removed at runtime without dropping in-flight items. The simplest version: start with two stages, then add a third while the pipeline is running.

**Constraints.**
- Stages communicate via channels created at registration time.
- Adding a stage involves redirecting the previous stage's output to the new stage's input atomically.
- No item may be lost during reconfiguration.

**Hints.**
- Use an intermediate "router" goroutine between stages whose forwarding target is held behind a mutex or atomic pointer.
- When swapping, drain the old target before retargeting.

**Self-check.** What is the latency cost of the router goroutine? Could you implement this with just `select` and avoid the extra hop?

---

### Task 19: Channel-of-Channels for Routing

**Problem.** Build a registry where workers subscribe by sending a channel onto a `chan chan Message`. A dispatcher pulls a worker channel out of the registry, sends a message, and the worker handles it.

**Constraints.**
- After handling, the worker must re-register itself by sending its channel back on the registry channel.
- This implements a round-robin / first-available worker pool without an external queue.
- The dispatcher should `select` on both incoming jobs and worker availability.

**Hints.**
- This is the classic Go worker pool variant used in Rob Pike's concurrency talks.
- `dispatch := <-workerCh; dispatch <- job` — note that `dispatch` is itself a channel.

**Self-check.** Why is this useful when workers have heterogeneous state (e.g., a database connection bound to each worker)? Could you achieve the same with a single jobs channel?

---

### Task 20: Benchmark `crossbeam` vs `std::sync::mpsc`

**Problem.** In Rust, write a benchmark that sends one million `u64` values from one producer to one consumer using both `std::sync::mpsc::channel` and `crossbeam_channel::unbounded`. Compare wall-clock time and allocations.

**Constraints.**
- Use `criterion` or hand-rolled timing with `Instant::now`.
- Run on a release build (`cargo bench` or `--release`).
- Repeat with 4 producers and 1 consumer to see scaling behavior.

**Hints.**
- `std::sync::mpsc` uses a per-channel mutex; `crossbeam` uses lock-free queues for the common path.
- Numbers will vary by platform but `crossbeam` is typically 2-5x faster on MPSC workloads.

**Self-check.** Where does `crossbeam` lose to `std::sync::mpsc`? Hint: think about feature completeness and code size.

---

### Task 21: Leaky `select` Bug Hunt

**Problem.** Given the following buggy function, identify and fix the goroutine leak.

```go
func tail(ctx context.Context, in <-chan string) <-chan string {
    out := make(chan string)
    go func() {
        for v := range in {
            select {
            case out <- v:
            case <-ctx.Done():
                return
            }
        }
        close(out)
    }()
    return out
}
```

**Constraints.**
- Identify every scenario in which a goroutine or channel resource leaks.
- Patch the function so `goleak.VerifyNone(t)` passes for all scenarios.

**Hints.**
- What happens to `in` if `ctx.Done()` fires? Who drains it? Who closes `in`?
- The `return` skips `close(out)`, leaving any downstream consumer blocked.

**Self-check.** Is it ever safe to close `out` from this function? Who owns `in`? The leak is structural, not a typo.

---

### Task 22: Mini LMAX Disruptor Ring Buffer

**Problem.** Implement a single-producer single-consumer (SPSC) ring buffer of capacity `N` (power of two) using two atomic counters and a fixed-size array. Benchmark it against a Go buffered channel of equal capacity.

**Constraints.**
- The producer publishes by writing to the slot at `head % N` then incrementing `head`.
- The consumer reads from `tail % N` then increments `tail`.
- Use `atomic.Uint64` for head and tail; use mask-and-shift for index.
- The buffer is empty when `head == tail`; full when `head - tail == N`.

**Hints.**
- The LMAX paper's key insight: separate producer and consumer cache lines, never share a write counter between threads.
- Add padding (`_ [64]byte`) between counters to prevent false sharing.
- For benchmarking, send a billion `int64` values and measure throughput in messages per second.

**Self-check.** How does your throughput compare to a buffered channel? Why does Go's runtime channel use a mutex while Disruptor uses atomics? When would each be more appropriate?

---

### Task 23: Priority Select Across Channels

**Problem.** Implement a `PrioritySelect` that always prefers a high-priority channel over a low-priority one, even if both are ready. Standard Go `select` is uniformly random; build the priority on top.

**Constraints.**
- Two input channels: `hi <-chan T` and `lo <-chan T`.
- If `hi` has a value ready, take it. Only take from `lo` when `hi` is empty.
- Support a context for cancellation.

**Hints.**
- Pattern: outer `select` checks `hi` with `default`; inner `select` waits on both. The non-blocking outer check biases toward `hi`.
- Beware of busy-looping if both channels are empty for long periods.

**Self-check.** Under what burst pattern can `lo` be starved forever? Is starvation acceptable for the priorities you have in mind?

---

## Capstone

The Capstones are large-shaped projects. Each takes a multi-hour or multi-day effort and pulls together everything from the previous sections.

### Task 24: Market-Data Pipeline with Backpressure

**Problem.** Build a market-data pipeline with the following stages: a simulated tick source produces 100k ticks per second; a normalizer converts raw ticks into a canonical struct; a multiplexer fans out to two consumers — a persistence stage that writes to disk and an aggregator that computes 1-second OHLC bars. The system must apply backpressure end-to-end: if the persistence stage cannot keep up, the upstream eventually slows.

**What "done" looks like.** You have a runnable program with the four stages connected by bounded channels. Pushing the source rate to 200k/sec demonstrates visible queue growth in metrics, and one of the slow consumers triggers an "applying backpressure" log line within seconds. Killing the persistence consumer with a panic does not crash the pipeline; instead, the supervisor logs the error, restarts the consumer, and the aggregator's output is uninterrupted because it has its own bounded buffer. A `pprof` goroutine dump shows exactly the stages you spawned plus the supervisor — no leaks. Total throughput at steady state is at least 80k ticks/sec on a laptop, measured by counting bars emitted per minute. The README contains a diagram of channel sizes, a metrics screenshot, and a paragraph explaining the backpressure path from sink back to source.

**Constraints.**
- Use bounded channels everywhere; no `make(chan T)` without a documented capacity.
- Expose per-stage metrics (input rate, output rate, queue depth) via Prometheus or a logged JSON snapshot.
- A single `context.Context` cancels the entire pipeline within 200ms.

**Hints.**
- Decide channel sizes deliberately: too small causes thrash, too large hides bugs.
- A "select with default into a dropped-counter metric" is sometimes acceptable for telemetry; for market data, usually not.
- Use the structured concurrency wrapper from Task 17 to manage the supervisor tree.

---

### Task 25: Refactor a Goroutine-Soup Service to Structured Concurrency

**Problem.** Take an existing service that uses unstructured `go func() { ... }()` spawns throughout its codebase — fire-and-forget background tasks, ad-hoc producers and consumers, scattered `time.AfterFunc` callbacks — and refactor it so every goroutine has a documented parent and a clear shutdown path. The target service is yours to choose: pick a side project or write a synthetic one that has at least eight goroutines spawned from at least four call sites.

**What "done" looks like.** The refactored service uses a single root `errgroup.Group` per request or session. Every spawn site is annotated with which group owns it. A test using `go.uber.org/goleak` runs the full lifecycle of the service — start, take some requests, stop — and reports zero leaked goroutines. A pprof goroutine dump taken under steady load shows a clear hierarchical structure: top-level workers, their children, their grandchildren — no orphans. Shutdown takes a measured maximum of 500ms from `cancel()` to process exit. The diff log shows every removed `go ` keyword paired with its replacement structured spawn.

**Constraints.**
- No bare `go func` may remain except inside the structured wrappers.
- Every channel created must be either closed by the producer or guaranteed to be garbage collected.
- The refactor must not introduce a behavior regression; existing tests pass unchanged.

**Hints.**
- Make a spreadsheet of every goroutine spawn in the codebase before you touch anything; group them by lifetime.
- Use the technique from Task 11: every goroutine's outer loop should `select` on `ctx.Done()` somewhere.
- For periodic tasks, wrap them in a "ticker worker" helper that takes a context.

---

### Task 26: High-Throughput Log Shipper

**Problem.** Design and implement a log shipper that reads from local files (tailing them), batches messages, and ships them to a remote endpoint. It must sustain 200 MB/s of input on a single host with bounded memory and recover gracefully when the remote endpoint slows or fails.

**What "done" looks like.** The shipper has three internal stages connected by channels: tailer (one goroutine per file), batcher (combines lines into byte batches up to 1 MiB or 100 ms), and shipper (one or more goroutines that POST batches with retries). Under a synthetic 200 MB/s input — generated by a separate tool you write — the shipper holds steady-state memory below 200 MiB and end-to-end latency below 500 ms for the 99th percentile. When the remote endpoint returns 503 for 30 seconds, the shipper applies exponential backoff with jitter, holds at most 64 MiB of unsent batches in memory, and starts dropping the oldest batches once that buffer is full, logging the drop counts. A graceful shutdown drains the batcher, ships any final batches, and exits within five seconds. The repo contains a README with a flow diagram, channel sizing rationale, and a benchmark script.

**Constraints.**
- Use bounded channels between every stage. Document each capacity choice.
- Implement at-least-once delivery with deduplication keys; never drop silently without metrics.
- Memory caps are hard: if the shipper exceeds 256 MiB RSS, that is a bug.

**Hints.**
- For the tailer, see how `hpcloud/tail` or similar libraries handle rotation; or roll your own with `fsnotify`.
- The batcher uses a `select` with both an input channel and a `time.After(100 * time.Millisecond)` timer to flush partial batches on timeout.
- Retries should use a token-bucket limiter (Task 13) to avoid hammering an already-degraded endpoint.

---

These tasks build the channel toolkit you need for serious concurrent systems. Channels are not magic — they are a typed, bounded, supervised queue with carefully chosen semantics — but they shape how you decompose problems. Once you can sketch a pipeline diagram on a whiteboard and immediately know which channels to use, where the bounded buffers go, who closes them, and how cancellation propagates, you have internalized the pattern.

---

## Sample Solutions

### Sample Solution: Task 1 — Producer/Consumer with a Single Channel

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    done := make(chan struct{})

    go func() {
        defer close(ch)
        for i := 1; i <= 10; i++ {
            ch <- i
        }
    }()

    go func() {
        defer close(done)
        for v := range ch {
            fmt.Println(v)
        }
    }()

    <-done
}
```

The producer is responsible for closing `ch`; the consumer uses `range` to read until close. `done` is a synchronization-only channel — closing it is the broadcast signal that the consumer finished.

### Sample Solution: Task 9 — Fan-In

```go
func Merge(chans ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(chans))
    for _, c := range chans {
        c := c
        go func() {
            defer wg.Done()
            for v := range c {
                out <- v
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

Each input gets its own goroutine forwarding values. A separate "closer" goroutine waits for all forwarders to exit before closing the output — this is the canonical pattern.

### Sample Solution: Task 11 — Pipeline with Cancellation

```go
func generate(ctx context.Context) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            select {
            case out <- i:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func square(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            select {
            case out <- v * v:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func sum(ctx context.Context, in <-chan int) int {
    total := 0
    for {
        select {
        case v, ok := <-in:
            if !ok {
                return total
            }
            total += v
        case <-ctx.Done():
            return total
        }
    }
}
```

Each stage closes its output channel via `defer`, and each one listens on `ctx.Done()` in every blocking spot. The shape is uniform and copy-pasteable; that uniformity is what makes pipelines maintainable.

### Sample Solution: Task 17 — Structured Concurrency Wrapper

```go
type Group struct {
    wg       sync.WaitGroup
    cancel   context.CancelFunc
    ctx      context.Context
    errOnce  sync.Once
    firstErr error
}

func NewGroup(parent context.Context) *Group {
    ctx, cancel := context.WithCancel(parent)
    return &Group{ctx: ctx, cancel: cancel}
}

func (g *Group) Go(f func(ctx context.Context) error) {
    g.wg.Add(1)
    go func() {
        defer g.wg.Done()
        if err := f(g.ctx); err != nil {
            g.errOnce.Do(func() {
                g.firstErr = err
                g.cancel()
            })
        }
    }()
}

func (g *Group) Wait() error {
    g.wg.Wait()
    g.cancel()
    return g.firstErr
}
```

The `sync.Once` guarantees the cancel-on-first-error semantics. `Wait` cancels regardless so that the parent context's resources are released even on a clean exit.

---

## Related Topics

- [Channels (README)](README.md) — Conceptual overview of the primitive.
- [Atomics](../04-atomics/README.md) — When you need fine-grained coordination without the channel overhead.
- [Mutexes and RWMutexes](../03-mutexes/README.md) — The shared-memory alternative.
- [Semaphores](../06-semaphores/README.md) — When you need a counted resource limiter rather than a queue.
- [Memory Models](../../../memory-management/README.md) — The happens-before guarantees that channels provide.
- [Concurrency Models](../../01-models/README.md) — CSP, actors, and where channels fit on the map.
- [Async Programming](../../../async-programming/README.md) — Futures and async/await as an alternative to explicit channels.
- [Parallel Programming](../../../parallel-programming/README.md) — When the goal is throughput across cores rather than coordination.

# Message-Passing Concurrency — Hands-On Tasks

> **Topic:** [Message-Passing](README.md)

---

## Introduction

Message-passing concurrency replaces shared mutable state with explicit communication: independent units of execution (goroutines, actors, processes, threads-with-queues) exchange immutable messages through typed channels or mailboxes. Instead of "lock the data and mutate it", you write "send the data to whoever owns it". The serialization point moves from a mutex to a queue, and ownership becomes a runtime invariant rather than a discipline.

This file is a graded exercise track. Work top-to-bottom: Warm-Up builds the muscle memory for `chan`, mailboxes, and `select`; Core teaches the patterns that show up in real production code (back-pressure, fan-in/out, request/response, graceful shutdown); Advanced covers operational concerns (supervision, persistence, distribution, rate limiting); Capstone asks you to compose everything into a realistic system.

You should solve each task in at least one language that has first-class support for the model — Go for CSP-style channels, Erlang or Elixir for the actor model, Akka or Pekko for typed actors on the JVM, Rust's `tokio::sync::mpsc` for ownership-aware channels. The interesting bugs differ across runtimes, and seeing the same pattern in two languages cements the principle.

Rules of engagement:

- Try every task without hints first. Hints are an escape hatch, not a starting point.
- Prefer immutable messages. If you find yourself sending a pointer to a mutable struct and reading it from both sides, you have rebuilt shared memory the hard way.
- Treat closed channels and dead mailboxes as expected events, not exceptions.
- Measure something for every Core and Advanced task — at minimum count messages-per-second and tail latency.
- Write a tiny stress test (10x normal load, randomised pauses) for everything in the Core section. Most concurrency bugs only show up when timing wobbles.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Related Topics](#related-topics)

---

## Warm-Up

Goal: get fluent with the primitives. Each task should take 15-40 minutes. If one drags past an hour, read the hints.

### Task 1: Producer/consumer with a Go channel

**Problem.** Write a Go program in which one goroutine produces the integers 1..1000 onto a channel and a second goroutine consumes them, summing as it goes. The consumer prints the final sum and the program exits cleanly with no goroutine leaks.

**Constraints.**
- Use an unbuffered channel.
- The producer must signal end-of-stream by closing the channel.
- Use `for v := range ch` on the consumer side. Do not use a `done` boolean.
- The `main` function must `wait` on the consumer, not sleep.

**Hints (try without first).**
- A `sync.WaitGroup` with `Add(1)` before launching the consumer and `Done()` at the end is the canonical wait primitive.
- Closing the channel is the producer's job. Never close a channel from the receiver side.
- `go vet` and `go run -race` should both be clean.

**Self-check.**
- [ ] Program prints `500500` and exits with code 0.
- [ ] Removing the `close(ch)` causes the consumer to hang forever — you understand why.
- [ ] Replacing `range` with a `for { v, ok := <-ch; if !ok { break } }` produces the same output.

---

### Task 2: Erlang ping-pong

**Problem.** Spawn two Erlang processes, `ping` and `pong`. The `ping` process sends the message `{ping, self()}` to `pong`; `pong` replies with `{pong, self()}`. Repeat this exchange 100 times, then `ping` sends `stop` and both processes exit.

**Constraints.**
- Use only `spawn/1`, `!`, and `receive`. No `gen_server` for this one.
- Each process must print which message it received before replying.
- After `stop`, neither process should be left in the runtime — check with `erlang:processes()`.

**Hints (try without first).**
- `receive ... end` blocks until a matching message arrives. There is no busy loop to write.
- Pass the partner PID as an argument when spawning, otherwise the processes cannot address each other.
- A pattern like `loop(Partner, 0)` with a counter argument lets you terminate after N rounds.

**Self-check.**
- [ ] You see 100 ping lines and 100 pong lines interleaved in order.
- [ ] `erlang:processes()` after the run shows only the shell process, not your two.
- [ ] You can explain why message order between two specific processes is guaranteed by the BEAM.

---

### Task 3: Python multiprocessing queue

**Problem.** Use `multiprocessing.Queue` to compute the SHA-256 of every file in a directory in parallel. The parent process enqueues file paths; four worker processes dequeue paths, hash the file, and put `(path, digest)` back on a result queue. The parent prints results as they arrive.

**Constraints.**
- Use exactly four worker processes.
- Signal end-of-work with a sentinel value (`None`) — one sentinel per worker.
- The parent must join all workers before exiting.
- Do not use `concurrent.futures`. Build it with `Process` and `Queue`.

**Hints (try without first).**
- A `for p in processes: p.join()` after sending the sentinels prevents zombie children.
- The result queue needs to be drained by the parent in parallel with the workers writing to it, otherwise the OS pipe can fill up and deadlock.
- Print from the parent only — printing from children interleaves badly on stdout.

**Self-check.**
- [ ] Hashing 1000 small files completes faster than the single-process version.
- [ ] Killing one worker mid-run with SIGTERM does not hang the parent forever (you have a timeout on `get`).
- [ ] You can explain the difference between `multiprocessing.Queue` and `queue.Queue`.

---

### Task 4: Akka (or Pekko) echo actor

**Problem.** Implement a typed actor in Akka (or Apache Pekko) that accepts an `Echo(message, replyTo)` command and replies with the same message. Send it 10 messages from a test probe and assert each reply.

**Constraints.**
- Use the typed API (`akka.actor.typed`), not the classic one.
- The actor must be a stateless `Behaviors.receiveMessage` lambda.
- Use a `TestProbe[String]` to receive replies and assert each one in order.
- The test should run under `ScalaTest` or `JUnit5` and finish in under one second.

**Hints (try without first).**
- `ActorSystem[Echo]` is the entry point; remember to `terminate()` it after the test.
- The `replyTo: ActorRef[String]` field on the command is how the receiver knows where to answer — there is no implicit sender in typed Akka.
- Mailbox order from a single sender to a single recipient is preserved; you can assert exact order.

**Self-check.**
- [ ] All ten assertions pass.
- [ ] You can articulate why typed Akka removed the implicit `sender()` of classic Akka.
- [ ] You know what happens if the actor throws an exception (default supervision = restart).

---

### Task 5: Rust mpsc fan-in

**Problem.** Using `tokio::sync::mpsc`, spawn five producer tasks that each send 100 integers onto a shared channel. A single consumer task receives all 500 and prints the count. The program exits cleanly.

**Constraints.**
- Use bounded `mpsc::channel(32)`.
- Producers must `clone()` the sender; the consumer holds the unique receiver.
- The channel must close automatically when all sender clones are dropped — do not invent a sentinel.
- Use `#[tokio::main]` and `await` everywhere; no blocking calls.

**Hints (try without first).**
- The consumer loop is `while let Some(v) = rx.recv().await`.
- Spawn producers with `tokio::spawn(async move { ... })` and either `await` their `JoinHandle` or let them detach.
- The original `Sender` in `main` must also be dropped (or scoped to a block) before the consumer's `recv` will return `None`.

**Sample Solution.**

```rust
use tokio::sync::mpsc;

#[tokio::main]
async fn main() {
    let (tx, mut rx) = mpsc::channel::<i32>(32);
    for p in 0..5 {
        let tx = tx.clone();
        tokio::spawn(async move {
            for i in 0..100 {
                tx.send(p * 100 + i).await.unwrap();
            }
        });
    }
    drop(tx); // critical: otherwise rx never closes
    let mut count = 0;
    while let Some(_) = rx.recv().await {
        count += 1;
    }
    println!("received {count}");
}
```

**Self-check.**
- [ ] Output prints `received 500`.
- [ ] Removing `drop(tx)` causes the program to hang — you understand the ownership model.
- [ ] `cargo run` finishes in well under a second.

---

### Task 6: Basic timeout via `select` + `time.After`

**Problem.** In Go, write a function `fetchOrTimeout(ctx context.Context, work func() string, d time.Duration) (string, error)` that runs `work` in a goroutine and either returns its result or `ErrTimeout` after `d`.

**Constraints.**
- Use `select` with `time.After(d)` and a result channel.
- If timeout fires, the goroutine running `work` is allowed to keep running but its result must be discarded.
- No goroutine leaks if `work` eventually completes — drain or close cleanly.
- The result channel must be buffered with capacity 1.

**Hints (try without first).**
- Buffered capacity 1 means the worker can always send without blocking, even if the caller has already given up.
- `time.After` returns a channel — that is what makes it composable with `select`.
- An alternative is `time.NewTimer` + `Stop()`, which lets you avoid leaking timer goroutines on the GC path under high frequency.

**Self-check.**
- [ ] A 50ms `work` with 200ms timeout returns the result.
- [ ] A 500ms `work` with 100ms timeout returns `ErrTimeout`.
- [ ] You ran the slow case 10 000 times and `runtime.NumGoroutine()` is stable.

---

### Task 7: Bounded mailbox in your language of choice

**Problem.** Build a tiny actor abstraction in Python, Rust, or Go: a struct holding a bounded queue and a worker thread/goroutine that consumes from it. Expose a `send(message, timeout)` method that returns `false` if the queue is full when the timeout elapses.

**Constraints.**
- The mailbox capacity is a constructor parameter.
- Calling `send` after `stop()` raises an error or returns `false` cleanly — no panic, no crash.
- Stopping must drain any in-flight messages and then exit.
- The worker function is supplied as a constructor argument.

**Hints (try without first).**
- Python's `queue.Queue(maxsize)` with `put(timeout=...)` is most of the implementation.
- In Go, a buffered channel plus `select` with `time.After` does the job.
- The "stop" channel pattern: a separate `done chan struct{}` that the worker selects on alongside the inbox.

**Self-check.**
- [ ] Sending into a full mailbox blocks for the timeout and then returns failure.
- [ ] After `stop`, sending fails and the worker has exited.
- [ ] You can re-use this abstraction in Task 14.

---

## Core

These tasks bake in the patterns. Expect each to take 45-90 minutes. Always write at least one test per task.

### Task 8: Bounded back-pressure pipeline

**Problem.** Build a three-stage pipeline in Go: `read` → `parse` → `write`. Each stage runs in its own goroutine, connected by bounded channels (capacity 8). The producer reads 1 million synthetic records and the sink counts them. Demonstrate that when the sink slows down, the source naturally slows too.

**Constraints.**
- Channel capacities are 8 for stage-to-stage links.
- Add an artificial `time.Sleep(1 * time.Millisecond)` in the sink and observe steady-state throughput drop to ~1000 records/sec.
- All goroutines must exit on `context.Cancel`.
- Measure and print steady-state throughput every second.

**Hints (try without first).**
- Back-pressure is automatic with bounded channels: a full channel blocks the sender.
- A `context.Context` plumbed through every stage gives uniform cancellation.
- Use `select` with `<-ctx.Done()` in every send and every receive.

**Self-check.**
- [ ] With the sink delay enabled, end-to-end throughput is bounded by the slowest stage.
- [ ] Cancelling the context shuts the whole pipeline down within 100ms.
- [ ] You can reason about why a single unbounded channel anywhere in the pipeline breaks back-pressure.

---

### Task 9: Timeout via `select` + `time.After`, applied to a real RPC stub

**Problem.** Write `callRemote(ctx, req) (resp, error)` that simulates a remote call by sleeping for a random 10-500ms and returning a response. Wrap it so the caller can specify a deadline and receives `ErrDeadline` when exceeded. Verify under load (1000 concurrent calls) that no goroutines leak.

**Constraints.**
- Honour both an explicit `time.Duration` deadline and `ctx.Done()`.
- The stub goroutine must terminate after sending or being abandoned — no leaks.
- Cancellation must propagate: if `ctx` is cancelled, `callRemote` returns immediately even if the stub is still sleeping.
- Use `time.NewTimer` and call `Stop()` on early return.

**Hints (try without first).**
- `time.After` allocates a new timer goroutine every call. `time.NewTimer` + `Stop()` is the high-frequency version.
- Buffer the response channel so the stub never blocks on send when the caller has already returned.
- A "shadow" goroutine pattern: the stub goroutine keeps running but its result is discarded — verify it eventually exits.

**Self-check.**
- [ ] 1000 calls with mixed deadlines complete and `runtime.NumGoroutine()` returns to baseline.
- [ ] Cancelling the parent context kills every in-flight call.
- [ ] Replacing `time.After` with `time.NewTimer` measurably reduces allocations under `go test -bench`.

---

### Task 10: Fan-in (N producers → 1 consumer)

**Problem.** Implement a generic `Merge[T any](inputs ...<-chan T) <-chan T` that fans N input channels into one output channel. Close the output channel exactly once after all inputs are closed.

**Constraints.**
- Use a `sync.WaitGroup` to know when all inputs are exhausted.
- Spawn one forwarder goroutine per input.
- A separate goroutine waits on the `WaitGroup` and closes the output channel.
- Must work for N = 0, N = 1, and N very large.

**Hints (try without first).**
- The "wait then close" goroutine is the trick to avoid closing the output channel multiple times.
- Use generics (`any`) or write the `interface{}` version if your Go is older.
- Range over each input in its forwarder goroutine: when input closes, the goroutine returns and calls `wg.Done()`.

**Sample Solution.**

```go
func Merge[T any](inputs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(inputs))
    for _, in := range inputs {
        in := in
        go func() {
            defer wg.Done()
            for v := range in {
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

**Self-check.**
- [ ] Merging three channels of 100 items each produces exactly 300 items on the output.
- [ ] The output channel closes exactly once.
- [ ] Calling `Merge()` with zero inputs returns a channel that closes immediately.

---

### Task 11: Fan-out (1 producer → N consumers)

**Problem.** Implement `Distribute[T any](in <-chan T, n int) []<-chan T` that round-robins items from `in` across `n` output channels. When `in` closes, all outputs must close.

**Constraints.**
- Round-robin distribution, not random.
- Outputs are unbuffered.
- Closing `in` causes every output to close, in order or in parallel — your choice, but document it.
- A slow consumer must not stall fast consumers indefinitely (consider buffering or skipping).

**Hints (try without first).**
- The round-robin index is just `i % n`.
- For the "slow consumer should not block others" variant, add a small buffer or a `select` with `default` to drop on overflow.
- Closing N output channels: do it in a `defer` after the distribution loop exits.

**Self-check.**
- [ ] 100 items distributed across 4 consumers gives each consumer 25 items.
- [ ] Closing the input closes all four outputs.
- [ ] You have decided and documented what happens to a slow consumer.

---

### Task 12: Request/response with a reply channel

**Problem.** Build a `Server` actor in Go that exposes `Query(key string) (value string, err error)`. Internally the server runs in a single goroutine and processes commands from an inbox. The `Query` method sends a request struct containing a reply channel and waits for the answer.

**Constraints.**
- The server owns a `map[string]string`. No external code touches it.
- Each request struct embeds `replyTo chan response`.
- Reply channels are created per-call, buffered with capacity 1.
- Add a `Shutdown()` method that drains in-flight requests and exits the server goroutine.

**Hints (try without first).**
- Per-call reply channels are cheaper than they look in Go because they are stack-allocated.
- A single inbox goroutine eliminates the need for any mutex inside the server.
- For the shutdown, accept a special command variant and `close(inbox)` after dispatching it.

**Self-check.**
- [ ] Concurrent `Query` calls from 100 goroutines all return correct values.
- [ ] `go test -race` reports no data races.
- [ ] After `Shutdown`, new `Query` calls return an error rather than hanging.

---

### Task 13: Retry with budget

**Problem.** Write `RetryWithBudget(ctx, op func() error, budget time.Duration, base time.Duration) error` that retries `op` with exponential backoff until either it succeeds, the budget elapses, or the context is cancelled.

**Constraints.**
- Backoff starts at `base` and doubles up to a cap of 1 second.
- Add jitter: actual sleep is in `[backoff/2, backoff]`.
- The budget is end-to-end, not per-attempt.
- On final failure, wrap the last error so the caller can distinguish "budget exceeded" from "context cancelled".

**Hints (try without first).**
- Use `time.NewTimer` and `select` on `timer.C`, `ctx.Done()`, and a deadline channel.
- The budget deadline is `time.Now().Add(budget)` computed once at the start.
- Wrap errors with `fmt.Errorf("retry budget exhausted: %w", lastErr)`.

**Self-check.**
- [ ] An operation that succeeds on attempt 3 completes inside the budget.
- [ ] An operation that always fails returns a wrapped error containing the last failure.
- [ ] Cancelling the context returns immediately, not on the next backoff tick.

---

### Task 14: Graceful shutdown via close

**Problem.** Extend the bounded-mailbox actor from Task 7 with a `Shutdown(timeout)` method. It must: stop accepting new messages, drain the inbox of already-queued messages, and return after the worker has fully processed everything (or after the timeout).

**Constraints.**
- After `Shutdown` is called, `Send` returns an error immediately.
- Already-enqueued messages are processed in order, not discarded.
- If the timeout elapses, return a `ShutdownTimeoutError` but do not kill the worker — let it finish.
- The shutdown sequence is idempotent: calling `Shutdown` twice is safe.

**Hints (try without first).**
- A `sync.Once` makes idempotency trivial.
- Use a `done chan struct{}` that the worker closes when it has finished draining.
- The timeout is a `select` with `<-done` vs `<-time.After(timeout)`.

**Self-check.**
- [ ] After `Shutdown` returns success, the inbox is empty and the worker goroutine has exited.
- [ ] Sending during shutdown is rejected cleanly.
- [ ] Calling `Shutdown` twice from concurrent goroutines does not panic.

---

### Task 15: Sticky-state worker (per-key serialization)

**Problem.** Implement a worker pool where messages tagged with the same `key` are always routed to the same worker. This lets each worker hold per-key state without locks.

**Constraints.**
- N workers, deterministic routing via `hash(key) % N`.
- Each worker owns a `map[string]*State` and never shares it.
- Add a `Forward(key, msg)` API on the dispatcher.
- Shutdown propagates to all workers and waits for them to finish.

**Hints (try without first).**
- `hash/fnv` from the standard library gives a fast, deterministic hash.
- Each worker has its own inbox channel; the dispatcher selects the right inbox by key.
- This is the same model as Kafka's partitioning by key.

**Sample Solution.**

```go
type Dispatcher struct {
    inboxes []chan Msg
}

func New(n int) *Dispatcher {
    d := &Dispatcher{inboxes: make([]chan Msg, n)}
    for i := range d.inboxes {
        d.inboxes[i] = make(chan Msg, 64)
        go worker(d.inboxes[i])
    }
    return d
}

func (d *Dispatcher) Forward(key string, m Msg) {
    h := fnv.New32a()
    h.Write([]byte(key))
    d.inboxes[h.Sum32()%uint32(len(d.inboxes))] <- m
}
```

**Self-check.**
- [ ] Two messages with the same key always land on the same worker.
- [ ] Workers maintain per-key state with no synchronisation.
- [ ] Adding `-race` to your tests reports nothing.

---

### Task 16: Dead-letter queue

**Problem.** Extend any actor abstraction with a dead-letter queue (DLQ). Messages that fail processing (the handler returns an error) or that are sent to a stopped actor go to the DLQ. The DLQ is itself an actor that logs and counts.

**Constraints.**
- Handler signature is `func(msg) error`. A non-nil error sends the message to the DLQ.
- Sending to a stopped actor must not panic — the dispatcher captures and forwards to DLQ.
- The DLQ actor must never itself dead-letter; if its inbox is full, drop and increment a counter.
- Expose `DLQStats() (delivered, dropped int)` for observability.

**Hints (try without first).**
- A `recover()` block around the dispatcher's send captures `send on closed channel` panics in Go.
- Buffer the DLQ inbox generously; this is a last line of defence.
- In Erlang/Akka, this is built in (`dead_letters` mailbox); compare your implementation to theirs.

**Self-check.**
- [ ] A handler that returns an error causes the message to appear in the DLQ.
- [ ] Sending to a stopped actor enqueues to the DLQ rather than crashing.
- [ ] You can query DLQ stats and see correct delivered/dropped counts.

---

### Task 17: Pipeline cancellation propagation

**Problem.** Take the three-stage pipeline from Task 8 and make cancellation propagate both forwards (source stops) and backwards (sink stops first, source notices and stops too). Demonstrate that a downstream failure does not leak upstream goroutines.

**Constraints.**
- Use a single `context.Context` for forward cancellation.
- Use a `done` channel from the sink back to the source for "sink died" signalling.
- Verify with `runtime.NumGoroutine()` before and after.
- A test injecting a sink failure must complete inside 1 second.

**Hints (try without first).**
- A cancelled context signals all stages at once — that is your forward propagation.
- For backward propagation, the sink's deferred cleanup calls `cancel()` on the shared context.
- This is the Go idiom that the `errgroup.WithContext` pattern formalises.

**Self-check.**
- [ ] Sink failure causes source to stop within 100ms.
- [ ] No goroutines leaked after the failure case.
- [ ] You can swap your bespoke wiring for `errgroup.Group` and get the same behaviour.

---

## Advanced

These tasks introduce operational depth. Expect 2-4 hours each. Some are exploratory — there is no single "right" answer, but you must be able to defend your choices.

### Task 18: Worker pool with dynamic scaling

**Problem.** Build a worker pool that grows and shrinks based on inbox depth. Above 80% capacity, spawn a new worker (up to a max). Below 20% capacity for 5 seconds, retire one (down to a min).

**Constraints.**
- Min, max, and target utilisation are configurable.
- Retiring a worker waits for it to finish its current message — no kill.
- A "scaling controller" actor watches inbox depth on a tick and decides.
- All worker lifecycle events are logged with timestamps for replay analysis.

**Hints (try without first).**
- Reading inbox depth is `len(channel)` in Go.
- Retiring a worker is just "send it a poison pill"; the worker exits its receive loop and decrements the pool counter.
- A 100ms tick is plenty for the controller — finer-grained control is rarely useful.

**Self-check.**
- [ ] Under sustained load, the pool grows to `max`.
- [ ] When load disappears, it shrinks back to `min` over a few seconds.
- [ ] Oscillation is bounded — the pool does not flap between two sizes on the second.

---

### Task 19: Supervisor hierarchy in Erlang or Akka

**Problem.** Build a three-level supervision tree: a root supervisor, two child supervisors, and four worker actors per child supervisor. When a worker crashes, only its supervisor restarts it; when a child supervisor crashes, the root restarts that whole subtree.

**Constraints.**
- Use `supervisor` in Erlang/Elixir or `Behaviors.supervise` in Akka typed.
- Strategy for workers: `one_for_one` / `restart`.
- Strategy for child supervisors: `one_for_one` for the subtree.
- Add a kill switch that crashes a chosen worker and observe the restart.

**Hints (try without first).**
- In Erlang, `supervisor:start_link(?MODULE, [])` and a careful `init/1` is the boilerplate.
- In Akka typed, `Behaviors.supervise(child).onFailure[Throwable](SupervisorStrategy.restart)`.
- Crashing a worker is just `1/0` or `throw new RuntimeException`.

**Self-check.**
- [ ] Killing one worker restarts only that worker.
- [ ] Killing a child supervisor restarts the whole subtree under it.
- [ ] After 100 random kills, the system is still healthy and serving requests.

---

### Task 20: Idempotent at-least-once consumer

**Problem.** Design a consumer that processes messages with at-least-once delivery guarantees but is safe against duplicates. Each message has a unique `MessageID`; the consumer maintains a bounded LRU of recently-seen IDs and discards duplicates.

**Constraints.**
- LRU size is configurable; default 100 000.
- Processing must be a no-op for duplicates (do not increment counters, do not write to storage).
- Use a real LRU library (`hashicorp/golang-lru` for Go, `caffeine` for JVM).
- Stress test: send 1 million messages with 5% duplicates and verify exactly-once *effect*.

**Hints (try without first).**
- The LRU eviction implies a finite dedup window — messages older than that window may be re-processed. Pick the window based on producer retry SLO.
- For absolute exactly-once across restarts, you would need persistent storage; this task is RAM-only deliberately.
- Bloom filters are a memory-efficient alternative if you can tolerate a small false-positive rate.

**Self-check.**
- [ ] 1M messages with 5% duplicates result in exactly 950 000 processing effects.
- [ ] Performance is constant-time per message (LRU lookup is O(1)).
- [ ] You can explain the dedup window trade-off in interview-grade terms.

---

### Task 21: Persistent actor with snapshots

**Problem.** Implement a persistent counter actor: it accepts `Increment(n)` commands, and its state survives process restart. Write every command to a log file, replay the log on startup, and periodically take snapshots to bound replay time.

**Constraints.**
- Append-only log file, one command per line as JSON.
- Snapshot every 1000 commands. Snapshot includes current value and the log offset at which it was taken.
- On startup: load most recent snapshot, then replay log entries with offset greater than the snapshot offset.
- Fsync the log file (or its directory) on every write to guarantee durability.

**Hints (try without first).**
- The pattern is event sourcing — see Akka Persistence, Lagom, or Eventuate for reference designs.
- Snapshots are an optimisation, not a correctness requirement. Implement the no-snapshot path first.
- `os.O_APPEND | os.O_SYNC` (or explicit `f.Sync()`) is the durability guarantee.

**Self-check.**
- [ ] Killing the process and restarting recovers the exact prior value.
- [ ] Replay time after a million increments is bounded by the snapshot interval.
- [ ] Truncating the log file mid-record is detected and rejected at startup.

---

### Task 22: Distributed actor over the network

**Problem.** Run two processes on different ports. A client process sends `Hello(name)` messages to a server process via TCP and receives `Greet(text)` replies. Wrap the network in an actor abstraction so the calling code does not see sockets.

**Constraints.**
- Length-prefixed framing on the wire (4-byte big-endian length + payload).
- JSON payloads.
- The remote actor has the same API as a local actor: `send(msg)`, `ask(msg) -> reply`.
- Reconnect on disconnection with exponential backoff up to 30 seconds.

**Hints (try without first).**
- Erlang's distributed BEAM does all of this for free; building it in Go teaches you what BEAM hides.
- The framing layer is small but important — without it, messages bleed into each other on TCP.
- A request/reply over network needs a correlation ID and a reply table on the client side.

**Self-check.**
- [ ] Client and server exchange 1000 messages with no corruption.
- [ ] Killing the server and restarting it causes the client to reconnect within ~minute.
- [ ] In-flight `ask` calls during a reconnect either succeed after reconnect or fail cleanly with a timeout.

---

### Task 23: Rate limiter via token-bucket channel

**Problem.** Build a token-bucket rate limiter as an actor: tokens accumulate at rate R per second up to capacity C. A caller requesting K tokens either gets them immediately, waits until enough have accumulated, or gives up after a deadline.

**Constraints.**
- Both `R` and `C` are constructor parameters.
- The implementation uses a goroutine that periodically tops up a buffered channel.
- `Acquire(k, deadline)` returns success or failure cleanly.
- A 10x burst is allowed up to the bucket capacity, then steady-state is limited to R.

**Hints (try without first).**
- A simpler implementation: a buffered channel of size C is the bucket; a ticker goroutine sends tokens periodically.
- For `Acquire(k)`, draw k tokens in a loop — but use `select` with the deadline so you do not block indefinitely.
- Compare your design with `golang.org/x/time/rate` — your channel version is more expensive but easier to reason about.

**Self-check.**
- [ ] Steady-state throughput converges to R requests per second.
- [ ] Bursts up to C are allowed.
- [ ] Acquiring more tokens than capacity is rejected immediately.

---

### Task 24: Throughput benchmark

**Problem.** Compare three implementations of a producer/consumer pipeline at varying batch sizes: unbuffered channel, buffered channel (cap 1024), and a custom lock-based ring buffer. Measure throughput and median+p99 latency.

**Constraints.**
- Use `go test -bench` with at least 1 second per measurement.
- Pin GOMAXPROCS to a known value.
- Vary message size (1B, 64B, 1KB) and report a matrix.
- Generate a brief write-up summarising findings.

**Hints (try without first).**
- `b.SetBytes(...)` lets `go test -bench` report MB/s.
- For latency, sample timestamps before send and after receive and feed into a histogram (`hdrhistogram-go`).
- Expected results: buffered channel wins for small messages; ring buffer wins under contention; unbuffered is the slowest but simplest.

**Self-check.**
- [ ] Each variant runs reproducibly within 5% across runs.
- [ ] You can explain why buffered channels improve throughput.
- [ ] You can explain what `cache-line ping-pong` is and how it applies to your numbers.

---

### Task 25: Backpressure-aware publish-subscribe

**Problem.** Implement a pub-sub broker actor: subscribers register a callback, and publishers send messages by topic. Slow subscribers receive a bounded buffer and are disconnected if they fall too far behind.

**Constraints.**
- Per-subscriber buffer is 256 messages.
- If a subscriber's buffer is full when a new message arrives, drop the oldest message and increment a per-sub `lag` counter.
- After `lag > 1024`, disconnect the subscriber and emit a `SubscriberDropped` event.
- Multiple topics: each topic has its own subscriber list.

**Hints (try without first).**
- A subscriber is itself an actor; the broker forwards messages to it via its inbox.
- Drop-oldest is the "ring buffer" semantic — implement with a circular slice or by emptying and refilling under lock.
- Compare your design with NATS or Kafka consumer-lag eviction.

**Self-check.**
- [ ] Fast subscribers receive all messages; slow ones receive a fraction with a lag counter.
- [ ] A subscriber that stalls long enough is disconnected.
- [ ] Adding a 100th subscriber does not measurably slow publishers.

---

## Capstone

These are integrative projects. Plan to spend a day each. Capstones replace the Self-check list with a "What done looks like" paragraph that you must satisfy in your own judgement.

### Task 26: Chat server with rooms and presence

**Problem.** Build a chat server using the actor model: one actor per connected user, one actor per chat room, and a presence-tracking actor. Users join rooms, send messages, receive messages from other users in the same room, and have presence (online / idle / offline) tracked. The server runs over TCP or WebSocket.

**Constraints.**
- Each user actor manages its own connection and outbound queue.
- Each room actor maintains the member list and broadcasts messages.
- A presence actor maintains a per-user last-seen timestamp and emits `Online`/`Offline` events.
- The server gracefully handles 1000 concurrent users and 100 rooms.
- A user disconnecting cleans up subscriptions in all rooms.

**Hints (try without first).**
- Three actor types: User, Room, Presence. Compose them via message passing.
- Use a stream library (Akka Streams, RxJava) or plain goroutines — both work.
- Send a heartbeat ping every 30 seconds; a missed heartbeat after 90 seconds marks the user offline.

**What 'done' looks like.** Two telnet (or wscat) clients can connect simultaneously, join the same room, exchange messages, see each other's presence update when one disconnects, and the server runs at steady state with a thousand simulated clients on a laptop without leaking memory or descriptors over a 30-minute soak test. You can describe to an interviewer the message types, the actor topology, the broadcast latency you measured, and what would change if you scaled to multiple server instances.

---

### Task 27: Migrate a thread-pool worker to actors and measure

**Problem.** Take an existing piece of code that uses a thread pool + shared queue + locks — either one you write deliberately or pull from a project — and rewrite it using actors / channels. Measure throughput, latency, and code clarity. Write a short report.

**Constraints.**
- The original must use explicit locks and a shared queue.
- The actor version must have no shared mutable state.
- Benchmark both under at least three load profiles (burst, steady, mixed).
- Report includes lines of code, lock-related bug surface, and observed performance differences.

**Hints (try without first).**
- A natural source: a background image-thumbnail worker, a metrics aggregation worker, or a log shipper.
- The lock-based version often "wins" on raw throughput in micro-benchmarks but loses on tail latency and code maintainability.
- The actor version often wins on debuggability — a stuck mailbox is easier to spot than a stuck mutex.

**What 'done' looks like.** You have two implementations of the same business logic, side by side, with a benchmark harness that compares them under identical load. You have written a one-page report explaining where each model wins and loses, with data to back the claim. You can walk an interviewer through a specific bug that was easy to make in the lock version and impossible (or much harder) in the actor version.

---

### Task 28: Saga coordinator for a three-step order workflow

**Problem.** Implement a saga coordinator for an order workflow: (1) reserve inventory, (2) charge payment, (3) schedule delivery. Each step has a compensating action (release inventory, refund payment, cancel delivery). The coordinator is an actor that drives the workflow and handles partial failures.

**Constraints.**
- Each downstream service is its own actor with an in-process stub.
- The coordinator persists each step's outcome before invoking the next (event-sourced).
- On failure at any step, the coordinator invokes the compensating actions for all prior steps in reverse order.
- The coordinator must survive its own crash: on restart, replay the log and resume from the failed step.

**Hints (try without first).**
- Saga pattern: each forward action has a paired backward action; the coordinator records both.
- Use Task 21's persistent actor as a starting point for the coordinator state.
- Test the unhappy paths exhaustively — that is where sagas earn their keep.

**Sample Solution (skeleton).**

```go
type SagaState struct {
    OrderID string
    Stage   int           // 0=start, 1=reserved, 2=charged, 3=scheduled
    Events  []SagaEvent   // append-only log
}

func (c *Coordinator) Process(s *SagaState) {
    switch s.Stage {
    case 0:
        if err := c.inventory.Reserve(s.OrderID); err != nil { c.compensate(s); return }
        c.log(s, "RESERVED"); s.Stage = 1
        fallthrough
    case 1:
        if err := c.payment.Charge(s.OrderID); err != nil { c.compensate(s); return }
        c.log(s, "CHARGED"); s.Stage = 2
        fallthrough
    case 2:
        if err := c.delivery.Schedule(s.OrderID); err != nil { c.compensate(s); return }
        c.log(s, "SCHEDULED"); s.Stage = 3
    }
}
```

**What 'done' looks like.** A test harness injects failures at every step and verifies that the right compensating actions run in the right order, that the final saga state is consistent ("either all forwards committed or all forwards compensated"), and that killing the coordinator mid-workflow and restarting it from disk picks up exactly where it left off. You can explain the difference between an orchestrated saga (what you built) and a choreographed saga (event-driven, no central coordinator) and articulate the trade-offs.

---

### Task 29: Distributed work queue with at-least-once semantics

**Problem.** Build a small distributed work queue. Producers push jobs; multiple worker processes (on the same machine or across machines) consume jobs. Each job is processed at least once; idempotency on the worker side guarantees exactly-once effect. Workers may crash; jobs must not be lost.

**Constraints.**
- Persistent queue backed by disk (file or embedded KV like BoltDB).
- A job is "claimed" by a worker for up to N seconds; if not acknowledged in that window, it returns to the queue.
- Workers heartbeat their claim to extend the window.
- Use the actor model on both producer and consumer side; the queue itself is an actor with persistent state.

**Hints (try without first).**
- This is essentially a tiny rebuild of Sidekiq, Resque, or Beanstalkd.
- The claim/ack pattern is the same as Kafka consumer offsets or SQS visibility timeout.
- Idempotency uses the Task 20 dedup mechanism on the worker.

**What 'done' looks like.** You can start the queue, push 10 000 jobs, run 5 worker processes, kill one mid-run, and verify that every job was processed at least once and that any duplicates were no-ops thanks to dedup. You have measured the queue's throughput and the latency distribution from "produce" to "first acknowledge". You can articulate why this design is at-least-once and what it would take to make it exactly-once (hint: distributed two-phase commit, which is why almost nobody does it).

---

If you can do all of these, you have the message-passing foundation that a strong senior engineer would expect.

---

## Related Topics

- [Message-Passing Overview](README.md) — Conceptual model: actors, channels, mailboxes.
- [Shared-Memory Concurrency](../01-shared-memory/README.md) — The model message-passing is reacting against.
- [Software Transactional Memory](../03-stm/README.md) — A third way that composes without locks or mailboxes.
- [Memory Models and Visibility](../../02-memory-models/README.md) — What guarantees you do and do not get across goroutines, processes, and machines.
- [Scheduling and Runtime](../../03-scheduling/README.md) — How goroutines and BEAM processes get mapped to OS threads, which is what makes cheap message-passing possible.
- [Distributed Systems Foundations](../../../../distributed-systems/README.md) — Where message-passing scales out to multiple nodes and the failure model changes shape.

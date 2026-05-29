# Message-Passing Concurrency — Interview Questions

> **Topic:** [Message-Passing](README.md)

---

## Introduction

Message-passing concurrency is the discipline of structuring concurrent programs as independent units of execution that communicate exclusively by sending and receiving messages. There is no directly shared mutable state between participants; instead, all coordination flows through explicit message channels, mailboxes, or queues. This model spans a wide design space: synchronous rendezvous channels in CSP-style languages, asynchronous mailboxes in actor systems like Erlang and Akka, MPSC and MPMC queues in Rust, and `asyncio.Queue` in Python's cooperative scheduler. Each variant chooses a different point in the trade-off between throughput, latency, backpressure, and failure semantics.

Interviewers probe message-passing because it sits at the intersection of language design, operating-system primitives, and distributed-system thinking. A candidate who only knows "channels exist in Go" is unlikely to reason about mailbox overflow, dead-letter handling, ordering guarantees across actors, or why "let it crash" is a coherent strategy. This document collects the questions that surface real understanding: when message passing wins over shared memory, when it loses, and how to recognize the subtle failure modes — unbuffered deadlocks, send-on-closed panics, unbounded mailbox growth, ask-pattern timeout abuse, and producer/consumer impedance mismatches that silently kill throughput.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [System / Design Scenarios](#system--design-scenarios)
- [Coding Questions](#coding-questions)
- [Behavioral / Experience](#behavioral--experience)
- [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
- [Cheat Sheet](#cheat-sheet)
- [Further Reading](#further-reading)
- [Related Topics](#related-topics)

---

## Conceptual / Foundational

### Q: What is the fundamental difference between shared-memory and message-passing concurrency?

Shared-memory concurrency lets multiple threads read and write the same memory addresses, with synchronization (mutexes, atomics, memory barriers) imposed on top to keep the state consistent. Message-passing concurrency forbids that direct sharing: each unit of execution owns its state privately, and coordination happens only through messages sent over channels, mailboxes, or queues. The practical consequence is that data races are structurally impossible in pure message-passing systems because no two participants ever touch the same memory at the same time. The cost is copying or moving data on each send, which adds overhead but eliminates an entire class of bugs that haunt shared-memory programs. Most real systems are hybrids — Go has channels and mutexes, Erlang has ETS, Akka has CRDTs — but the dominant mode determines the reasoning style.

### Q: Distinguish synchronous from asynchronous messages and when each is preferable.

A synchronous message blocks the sender until the receiver accepts it, creating a rendezvous point. This is the semantics of an unbuffered Go channel or a CSP-style `c ! v` followed by `c ? x` in occam. An asynchronous message is dropped into a buffer or mailbox and the sender continues immediately. Synchronous messaging gives natural backpressure — the sender cannot outpace the receiver — and serves as a synchronization point, but it can introduce deadlocks if both parties wait. Asynchronous messaging decouples sender and receiver timing, improves throughput, and tolerates burstiness, but requires an explicit buffer-sizing decision and a strategy for what to do when the buffer fills. The right choice depends on whether you value flow control (sync) or decoupling (async).

### Q: What happens when a mailbox or channel buffer overflows, and what strategies exist to handle it?

The four canonical strategies for an overflowing buffer are: block the sender (backpressure), drop the new message (newest-wins), drop the oldest queued message (oldest-wins), and fail loudly (panic, exception, or shed load via a 503). Blocking is the safest default because it propagates the slowdown upstream until the bottleneck reaches a source that can throttle itself. Dropping is acceptable for telemetry, metrics, or other lossy signals where freshness matters more than completeness. Failing fast is appropriate at the edge of a system where you would rather reject an incoming request than enqueue it indefinitely. Erlang actors have unbounded mailboxes by default, which is a known foot-gun and one of the most common production incidents in BEAM systems.

### Q: Why are lost updates structurally impossible under pure message passing?

A lost update occurs when two writers concurrently read-modify-write the same memory and one writer's change overwrites the other's. In pure message passing there is no shared memory location: each piece of state lives inside exactly one process or actor, and the only way to mutate it is to send that owner a message. Because the owner processes messages one at a time, every read-modify-write is serialized through a single point. The trade-off is that the owning actor becomes a sequential bottleneck for its state, but the data race is gone. To regain parallelism you partition state across many actors, which is also the standard sharding pattern for distributed systems.

### Q: What is backpressure and how does message passing implement it?

Backpressure is the mechanism by which a slow consumer signals upstream producers to slow down, preventing unbounded queue growth and the latency spikes and OOM crashes that follow. In message passing it manifests in two main forms: synchronous send (the producer literally blocks until the consumer takes the value) and bounded buffers with blocking-send semantics. Go's unbuffered channel is direct backpressure; a bounded `chan T` of size N gives N slots of slack before the producer blocks. Actor systems traditionally lack built-in backpressure because mailboxes are unbounded, which is why Akka added Streams and Reactive Streams to introduce demand-driven flow control on top of the actor model.

### Q: Compare at-least-once, at-most-once, and exactly-once delivery semantics.

At-most-once delivery means a message is delivered zero or one times; it can be lost but never duplicated, which is appropriate for idempotent telemetry. At-least-once means the message is delivered one or more times; it cannot be lost but may be duplicated, requiring consumers to be idempotent. Exactly-once is delivery of exactly one message; it is impossible in the strict end-to-end sense in distributed systems (the Two Generals problem) but can be approximated with deduplication windows, transactional outboxes, or idempotency keys. Most production message-passing systems target at-least-once with idempotent consumers because that combination is implementable, debuggable, and resilient. In-process channels in Go or Rust are effectively exactly-once because there is no network failure mode to retry around.

### Q: What is the actor model and how does it differ from CSP?

The actor model, introduced by Carl Hewitt in 1973, defines an actor as an entity that can: receive a message, send messages to other actors, create new actors, and update its private state in response. Actors are addressed by an opaque reference (a PID, ActorRef, or ProcessId), and communication is asynchronous through unbounded mailboxes. CSP (Communicating Sequential Processes, Hoare 1978) instead centers on channels as first-class entities, with communication being synchronous by default, and processes are anonymous communicants on those channels. The practical contrast: in actors you address the receiver; in CSP you address the channel. Both models reject shared memory, but they differ in identity, synchronization, and failure semantics.

### Q: Explain the "let it crash" philosophy and why it is coherent.

"Let it crash" is the Erlang/OTP discipline of not writing defensive try/catch around every operation but instead allowing a misbehaving process to die and a supervisor to restart it in a known-good state. The rationale rests on three observations: most bugs are heisenbugs that disappear on a fresh process, defensive code is more buggy than the code it tries to protect, and supervised restart trees are formally verifiable while ad-hoc error handling is not. The model only works because Erlang processes are isolated (no shared memory to corrupt), cheap (millions per node), and supervised hierarchically. In shared-memory languages a crash can corrupt global state, so this discipline does not transfer cleanly; in pure message-passing systems it is one of the most successful fault-tolerance patterns ever deployed.

### Q: Compare head-based and tail-based sampling for tracing message flows.

Head-based sampling decides at the start of a trace whether to record all its messages; the decision is fast and stateless but cannot select interesting traces because outcomes are unknown at the head. Tail-based sampling buffers all spans of a trace and decides at the end (often based on errors, latency, or specific attributes); this catches the rare expensive trace but requires substantial memory and a centralized collector. In a message-passing system tail-based sampling is harder because trace context must be propagated through every message header, but the value is higher because the interesting message paths are usually rare. Modern OpenTelemetry pipelines often combine both: head-based for baseline throughput, tail-based for anomalies.

### Q: Rendezvous versus buffered channels — when do you choose each?

Rendezvous (unbuffered) channels are the right default when you want strict synchronization, natural backpressure, and a clear handoff semantics. They are ideal for one-shot signals, request/response pairs, and producer/consumer pipelines where producer rate must match consumer rate. Buffered channels are appropriate when bursts are expected, when you want to decouple producer and consumer timing, or when batching improves throughput downstream. Choosing a buffer size is empirical: too small loses throughput on bursts, too large hides backpressure and inflates latency. A useful rule is to set the buffer to roughly the size of the expected burst that you do not want to be visible to the producer.

### Q: What is dead-letter handling and why is it important?

A dead-letter queue (DLQ) is a destination for messages that cannot be delivered or processed — wrong address, unhandled message type, repeated processing failures, or expired TTL. Without a DLQ, problematic messages either silently disappear (loss of debuggability) or loop forever, consuming throughput and obscuring the underlying defect. With a DLQ you get an inspection point where messages can be examined, replayed after a fix, or aggregated for alerting. Akka's `system.deadLetters` actor and Erlang's `dead letter` logs are framework-level examples. Production message-passing systems should treat the DLQ as a first-class observability surface, not an afterthought.

### Q: How does message ordering work in actor systems and what guarantees can you rely on?

Most actor systems guarantee per-sender FIFO: if actor A sends messages m1 then m2 to actor B, then B will receive m1 before m2. There is no global ordering guarantee across senders: B may interleave messages from A and C in any order. Akka, Erlang, and similar systems all give this pairwise FIFO guarantee for in-VM messages; once you cross a network or persistence boundary the guarantee may weaken to "best effort". Designing around pairwise FIFO means you can build sequential protocols between actor pairs but cannot assume global causal ordering without explicit sequence numbers or vector clocks.

### Q: What is the difference between location transparency and location independence?

Location transparency means the API for sending a message does not depend on whether the receiver is local or remote: the same `actorRef ! msg` works either way. Location independence is stronger: the program's correctness does not depend on the receiver's location. Akka offers location transparency by default, but achieving true location independence requires the developer to handle network partitions, timeouts, and at-least-once semantics — concerns that local actors never face. Many bugs in distributed actor systems come from confusing the two: code that works locally because messages never get lost breaks in production where they do.

### Q: When is message passing the wrong choice?

Message passing is wrong when you need very tight latency (sub-microsecond) on shared data structures because every send incurs a copy or a synchronization handoff that a lock-free CAS can avoid. It is wrong for fine-grained parallelism over a single large dataset (matrix multiplication, image filters) where data-parallel SIMD beats any messaging cost. It is wrong when the natural problem decomposition is a graph with bidirectional, high-frequency interactions and no clean ownership boundary. Finally it is wrong when the team is small, the problem is well-bounded, and shared-memory threading with proven locks is simpler to reason about than a sprawling actor topology.

### Q: What is the "ask pattern" and what are its hazards?

The ask pattern (Akka `ask` operator `?`, Erlang `gen_server:call`) sends a message and returns a future or blocks until the recipient replies. It looks like a synchronous function call, which is appealing, but it carries three hazards: it requires a timeout (otherwise the caller can wait forever), it creates a transient temporary actor to receive the reply (overhead), and it tempts developers to write request/response chains that re-introduce the call-stack coupling actors were meant to eliminate. Tell-and-forget is preferred when possible; ask should be reserved for genuine query semantics with a small, bounded timeout.

---

## Language-Specific

### Q: How are Go channels implemented internally?

A Go channel is a struct containing a circular buffer (for buffered channels), a mutex, a queue of senders waiting to send, a queue of receivers waiting to receive, and a flag indicating whether the channel is closed. A send acquires the lock and either copies into the buffer, hands the value directly to a waiting receiver, or parks the sender's goroutine on the send-wait queue. A receive symmetrically pops from the buffer, takes from a waiting sender, or parks on the receive-wait queue. The runtime knows how to park and unpark goroutines via the scheduler, so blocking on a channel is cheap (a few hundred nanoseconds). Closing a channel wakes all parked receivers, who observe the closed flag.

### Q: When should you use a buffered channel in Go versus unbuffered?

Use unbuffered when you want strict handoff semantics — one goroutine signals exactly one other, and the sender knows the receiver has accepted before continuing. Use buffered when bursts are expected or when you want to decouple producer and consumer timing. A buffer of 1 is a useful pattern for "latest value wins" or for serializing a single ongoing operation. A larger buffer is appropriate for worker pools where N workers can be in flight simultaneously. Avoid using buffered channels to "speed things up" without measurement; a large buffer often hides backpressure rather than improving throughput.

### Q: What does `select` do in Go and what are its corner cases?

`select` blocks until one of its cases is ready, then executes that case; if multiple cases are ready, it picks one pseudo-randomly. A `default` case makes the select non-blocking — if no other case is ready, default runs immediately. Corner cases: a `select` with no cases blocks forever (sometimes used as a goroutine park), a `select` where one channel is closed will always fire that case (because receive on a closed channel never blocks), and a nil channel in a select case is never selected (a common pattern for disabling a case dynamically).

### Q: How does Erlang's `receive` clause work?

Erlang's `receive ... end` block scans the process's mailbox in arrival order, matching each message against the pattern clauses; the first message that matches is removed and processed, and unmatched messages remain in the mailbox. If no message matches, the process blocks until a new message arrives, then re-scans (including the new message). An `after Timeout -> ...` clause lets the process give up waiting after Timeout milliseconds. The selective-receive feature is powerful but a foot-gun: a process that selectively receives only certain messages while others accumulate can develop a giant mailbox that makes every subsequent receive scan slow.

### Q: How does Akka schedule actors onto threads?

Akka uses dispatchers, which are configurable thread pools that schedule actors. When an actor receives a message, it is added to its mailbox; if the actor is not currently running, the dispatcher schedules it on a thread to process a batch of messages from the mailbox (typically up to a throughput limit like 5). After processing the batch, the thread is released to schedule other actors. This lets millions of actors run on a small thread pool because most are idle at any moment. Dispatchers can be tuned per actor or actor group; CPU-bound actors get fork-join pools, IO-bound actors get bounded thread pools with larger queues, and `pinnedDispatcher` allocates one thread per actor for ultra-low-latency cases.

### Q: What is the difference between `tokio::sync::mpsc` and `std::sync::mpsc` in Rust?

`std::sync::mpsc` is a blocking, OS-thread channel with multi-producer, single-consumer semantics; calls to `send` and `recv` block the OS thread. `tokio::sync::mpsc` is an async channel for use with the Tokio runtime; `send` and `recv` are async and yield to the scheduler rather than blocking the OS thread. Use `std::sync::mpsc` for thread-based programs without an async runtime; use `tokio::sync::mpsc` (or `flume`, `async-channel`) when working inside an async executor. Mixing them is a frequent source of deadlocks — blocking on `std::sync::mpsc::recv` inside a Tokio task starves the runtime.

### Q: How does Python's `asyncio.Queue` differ from `queue.Queue`?

`queue.Queue` is a thread-safe blocking queue intended for use across OS threads; `get` and `put` block the calling thread. `asyncio.Queue` is an async-aware queue intended for use within a single event loop; `await queue.get()` and `await queue.put()` yield to the loop rather than blocking. They are not interchangeable: calling blocking `queue.Queue.get()` inside an async function blocks the entire event loop, defeating cooperative concurrency. For cross-thread/async bridges use `asyncio.run_coroutine_threadsafe` or `loop.run_in_executor`.

### Q: How does Go's channel direction in function signatures help?

A function parameter typed `chan<- T` accepts only sends; `<-chan T` accepts only receives. This restricts what the function can do with the channel and makes ownership intent explicit: a producer takes `chan<- T`, a consumer takes `<-chan T`. The compiler enforces these directional types, so a producer cannot accidentally drain the channel and a consumer cannot accidentally push into it. This is one of the cheapest, highest-value design patterns in Go and should be used in every channel-taking signature.

### Q: What is selective receive in Erlang and what is its cost?

Selective receive lets an Erlang process match only specific message patterns, leaving others in the mailbox for a later receive. This is convenient — you can write a synchronous-looking request/response protocol with a unique reference tag — but it scans the entire mailbox on every receive. If the mailbox grows because the process is slow or messages accumulate that the receive does not match, scan time becomes O(mailbox size) per receive and the process slows further in a feedback loop. Production Erlang code avoids unbounded selective receive and relies on `gen_server` whose receive matches every message.

### Q: How do Akka's `become` and `unbecome` work?

`become(behavior)` swaps the actor's message-handling function to a new one; subsequent messages are processed by the new behavior. `unbecome` pops back to the previous behavior. This implements a finite state machine where each state is a distinct behavior function, and transitions are explicit `become` calls. It is cleaner than maintaining a state variable and a giant `match` block, because each behavior only handles messages valid in its state. Untyped Akka allowed any message at any time; typed Akka makes state transitions even more explicit with `Behaviors.receive`.

### Q: What is the difference between Tokio's bounded and unbounded mpsc?

`mpsc::channel(N)` creates a bounded channel with capacity N; `send` is async and waits if the channel is full, giving backpressure. `mpsc::unbounded_channel()` has no capacity limit; `send` never waits and never fails (unless the receiver is dropped). Unbounded is tempting because it removes the await point in send, but it shifts the problem: a slow consumer leads to memory growth and eventual OOM. The default recommendation is bounded with a thoughtfully chosen capacity; unbounded is acceptable only when you can prove the producer rate is intrinsically bounded.

### Q: What does Python's `asyncio.Queue.put_nowait` do and when is it appropriate?

`put_nowait` enqueues without awaiting; if the queue is full it raises `QueueFull` immediately. This is the right call when you want to fail fast on overflow rather than block the producer. It pairs with `get_nowait` for non-blocking consumers in polling loops. Be careful: catching `QueueFull` and silently dropping messages is a form of data loss; either log and alert, route to a dead-letter destination, or apply admission control upstream.

---

## Tricky / Trap Questions

### Q: Why does this Go code deadlock?

```go
func main() {
    c := make(chan int)
    c <- 1
    fmt.Println(<-c)
}
```

The naive answer is "it works because we send and receive on the same channel." The trap is that `c` is unbuffered, so `c <- 1` blocks the only goroutine in the program waiting for a receiver, and since there is no other goroutine to receive, the runtime detects the deadlock and panics. The fix is either to make the channel buffered (`make(chan int, 1)`) or to put the send in a goroutine. The deeper lesson: an unbuffered channel requires a concurrent receiver in scope at the moment of send.

### Q: What happens if you `range` over a channel that is never closed?

```go
for v := range ch {
    process(v)
}
```

The loop reads until the channel is closed; if no one ever closes it and no more values arrive, the goroutine blocks forever, leaking memory and any resources it holds. The naive answer is "the loop just keeps reading." The trap is that the loop is a goroutine leak waiting to happen. Always identify the owner who is responsible for closing the channel, and ensure the close happens on every exit path (including error paths) using `defer close(ch)` in the producer goroutine.

### Q: What happens when you select on a closed channel?

```go
select {
case v, ok := <-ch:
    // ...
case <-time.After(1 * time.Second):
    // ...
}
```

If `ch` is closed, the receive case fires immediately and `ok` is false. The trap is that a closed channel always selects, which means a `select` in a loop that includes a closed channel becomes a tight spin: every iteration the closed case fires instantly. The fix is to detect `ok == false` and either set the channel to `nil` (which disables the case) or break out of the loop. A nil channel in a select case is never selected, which is the idiom for dynamic case disabling.

### Q: What is wrong with this use of the Akka ask pattern?

```scala
val future = actor ? Query("x")
val result = Await.result(future, 1.second)
```

The naive answer is "it sends a query and waits for the response." The trap is that `Await.result` blocks the calling thread, defeating the actor model's non-blocking semantics. If this code runs on an actor's thread (or any small thread pool), it deadlocks the dispatcher. The fix is to compose the future with `map`, `flatMap`, or `pipeTo`, never block. Also, a 1-second timeout is often too short for cold paths and too long for hot paths — pick the timeout based on the actual SLO.

### Q: What happens if an Akka actor's mailbox grows unboundedly?

The naive answer is "the actor processes messages slower." The reality is that the JVM heap grows by the size of each enqueued message plus mailbox overhead, GC pauses become longer and more frequent, and eventually the JVM either OOM-kills or thrashes the GC continuously. By default Akka mailboxes are unbounded; you must explicitly configure a bounded mailbox or a DroppingMailbox to bound the worst case. The deeper trap is that the actor may seem fine in development (low traffic) and only fail in production under a slow downstream dependency.

### Q: What does `close(ch)` followed by `ch <- v` do in Go?

`close(ch)` marks the channel closed; any subsequent send (`ch <- v`) panics with "send on closed channel." The naive answer is "the send is ignored." The reality is a panic that crashes the goroutine and, if not recovered, the program. This is why the producer should be the sole closer of a channel: if multiple goroutines send, you either need an additional coordination mechanism (a separate done channel) or you accept that closing the data channel is fundamentally unsafe.

### Q: Is it safe to `close()` a channel twice in Go?

The naive answer is "yes, close is idempotent." The reality is that a second close panics with "close of closed channel." There is no built-in `isClosed` to check; testing for closed-ness from outside requires a non-blocking receive in a select, which races with concurrent senders. The clean pattern is `sync.Once.Do(func() { close(ch) })` if multiple paths might trigger the close.

### Q: A slow consumer reads from an unbounded queue. What goes wrong?

The naive answer is "the consumer catches up eventually." The reality is that the queue grows without bound: latency for each enqueued item grows linearly with queue depth, memory pressure leads to GC pauses, and in the limit the process is OOM-killed. The fix is bounded buffers with backpressure, load shedding at the edge, or both. A queue without a bound is a bug, not a feature; treating it as a feature ("we'll never overflow in practice") is wishful thinking.

### Q: Why does this Go pipeline leak goroutines?

```go
func gen(nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        for _, n := range nums {
            out <- n
        }
        close(out)
    }()
    return out
}

func main() {
    for v := range gen(1, 2, 3) {
        if v == 2 { break }
        fmt.Println(v)
    }
}
```

The naive answer is "the generator finishes when nums is exhausted." The trap is that the consumer breaks early, so the generator's send of `3` blocks forever waiting for a receiver that will never come, leaking that goroutine and the channel. The fix is a `done` channel or a `context.Context` propagated into the generator so it can exit on cancellation.

### Q: What is wrong with selective receive that filters by reference tag?

```erlang
make_call(Pid, Msg) ->
    Ref = make_ref(),
    Pid ! {self(), Ref, Msg},
    receive
        {Ref, Reply} -> Reply
    end.
```

The naive answer is "this implements synchronous request/response cleanly." The trap is twofold: there is no timeout, so if Pid dies or never replies, the caller blocks forever; and the selective `receive` scans the entire mailbox on every message arrival until a match, so a backlog of unmatched messages amplifies latency. Production code uses `gen_server:call` which handles both with a timeout and a known protocol.

### Q: Why is "exactly once" generally unachievable in distributed message passing?

The naive answer is "use a transactional broker like Kafka." The trap is that exactly-once between two endpoints requires both atomic acknowledgment and atomic processing, which require distributed consensus on every message (Two Generals problem). What "exactly-once" actually means in practice is at-least-once delivery plus idempotent processing, where the consumer deduplicates by message ID. Brokers can offer exactly-once for the producer-broker hop, but end-to-end exactly-once requires consumer cooperation.

### Q: What's wrong with calling `recv()` in a `tokio::spawn_blocking` block?

```rust
tokio::task::spawn_blocking(move || {
    let v = rx.blocking_recv();
})
```

The naive answer is "spawn_blocking is fine for blocking operations." The trap is that `spawn_blocking` runs on a separate thread pool, but if many tasks block on receives and producers are also async, you can deadlock the runtime when the blocking pool is exhausted and no producers are running. Prefer the async `recv().await` and let the scheduler manage cooperative blocking.

### Q: Why can a Python `asyncio.Queue.put` block even with `maxsize=0`?

The naive answer is "maxsize=0 means unbounded so put never blocks." The trap is that `await queue.put(v)` is an async call that yields control to the event loop on every await point even without blocking; if the producer awaits in a tight loop while consumers do not yield, the consumer may still starve. Worse, some developers set `maxsize` to a small number for "safety" without realizing this turns a never-blocking call into one that can deadlock if the consumer awaits on the same task chain.

### Q: What happens when two actors send to each other simultaneously with the ask pattern?

The naive answer is "they each wait for the other's reply." The trap is that the ask pattern creates a temporary actor to receive the reply, and that actor has its own ask timeout; if both actors are waiting, both temp actors time out, both asks fail with `AskTimeoutException`, and both actors retry, leading to thrashing. The correct pattern is one-way `tell` messages with explicit correlation IDs, or restructuring so that only one direction uses ask.

### Q: A Go worker pool uses `WaitGroup` to wait for workers, but it deadlocks. Why?

```go
var wg sync.WaitGroup
jobs := make(chan Job)
for i := 0; i < 4; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for j := range jobs {
            process(j)
        }
    }()
}
for _, j := range allJobs {
    jobs <- j
}
wg.Wait()
```

The naive answer is "workers finish processing and `wg.Done` fires." The trap is that `for j := range jobs` never exits because `jobs` is never closed; workers loop forever waiting for the next job, `wg.Wait` blocks forever. The fix is `close(jobs)` after the producer loop, which lets the range loop terminate.

---

## System / Design Scenarios

### Q: Design a chat server using message-passing concurrency.

Model each connected user as an actor (or goroutine) with a mailbox/channel for incoming messages. Model each room as an actor that holds the set of member actor references and broadcasts messages to all members. When a user sends a chat message, they tell the room actor; the room iterates its members and tells each one. For persistence, the room actor also tells a persistence actor (or an outbox) that writes to durable storage. For backpressure use bounded user mailboxes: if a slow client cannot keep up, drop messages with a marker so the client can request a resync. Handle disconnects with supervisor restart of the user actor, and clean up its membership in rooms via a death-watch subscription.

### Q: Design an order-processing pipeline with idempotency.

Pipeline stages: HTTP gateway → validator → enrichment → pricing → persistence → notification. Each stage is a separate actor or worker pool with bounded mailboxes between them. Each order carries an idempotency key (the client-generated request ID); the gateway stage deduplicates by querying a Redis set or a DB unique index. Downstream stages assume at-least-once delivery and use the idempotency key in their persistence layer (INSERT ON CONFLICT DO NOTHING) to absorb retries. Failed messages go to a DLQ with the original payload and error context, where they can be inspected and replayed after a fix. Each stage emits structured logs with the idempotency key for end-to-end traceability.

### Q: Design request/response over a message-passing system with timeouts.

The caller generates a unique correlation ID, sends the request with that ID and its own reply address, and registers a future or callback in a local map indexed by the correlation ID. The callee processes and replies to the address with the same correlation ID. The caller correlates the reply by ID and completes the future. A timer fires after the timeout duration; if no reply has arrived, the future is failed with a timeout error and the entry removed. Avoid synchronous blocking in the caller: compose the future with the next stage or `await` it in an async context. The timeout must be set; never call ask without one.

### Q: Design fan-out broadcast to a large number of subscribers.

Maintain a publisher actor that holds a list of subscriber references and broadcasts incoming messages to all of them. For thousands of subscribers, simple iteration becomes a hot spot; introduce a tree of intermediate fan-out actors so each fan-out level handles a small number of children. For very high cardinality use a separate pub-sub broker (NATS, Redis pub/sub, Kafka topics) and let subscribers connect to it directly. Apply per-subscriber bounded buffering so a slow subscriber cannot stall the publisher; on overflow, either drop or disconnect that subscriber. Monitor lag per subscriber and alert when it exceeds a threshold.

### Q: Design a persistent actor with snapshots.

A persistent actor (Akka Persistence, Lagom, EventStore) writes every state-changing event to a journal before updating in-memory state. On startup it replays all events since the last snapshot to reconstruct state. Periodically — every N events or every T minutes — it takes a snapshot of current state and stores it; on startup it loads the latest snapshot and replays only events newer than the snapshot. This bounds startup time. The snapshot format should be versioned, and the replay logic must handle schema evolution (old events still need to be applicable to new state types). Use unique event IDs to deduplicate on replay if the journal allows duplicates.

### Q: Design a rate-limited HTTP gateway in front of a message-driven backend.

Front the gateway with a token-bucket rate limiter per client (API key or IP); requests that exceed the bucket are rejected with 429. Accepted requests are enqueued onto a bounded channel sized to the backend's processing capacity; if the channel is full, return 503 immediately rather than queuing. A pool of worker goroutines or actors drains the channel and processes requests; on completion they send the response back through a per-request reply channel keyed by correlation ID. For long-running requests use SSE or WebSocket to stream updates rather than blocking HTTP. Apply circuit breakers between the gateway and backend services to fail fast when downstream is unhealthy.

### Q: Design an event-sourced bank account using actors.

One actor per account, addressed by account ID. The actor's state is a balance and a list of recent transactions. Incoming commands (Deposit, Withdraw, Transfer) are validated; if valid they emit an event (Deposited, Withdrawn) which is persisted to the journal and then applied to the in-memory state. Failed commands return an error to the sender. For transfers between accounts, use a saga or two-phase protocol: the source actor reserves the amount, the destination actor accepts, then both commit; failures trigger a compensating event. Each account actor processes commands serially, so there is no need for inter-actor locking. To scale, shard accounts across nodes by account ID.

### Q: Design a worker pool that adapts size to load.

Start with a bounded channel of jobs and a small number of worker goroutines. Monitor the channel depth and the rate at which workers complete jobs; when depth grows beyond a threshold, spawn additional workers up to a maximum. When depth drops below a low threshold, idle workers exit after a grace period. The grace period prevents thrashing under bursty load. Wrap this in a controller actor that owns the worker set and reacts to depth/rate signals; workers report completion to the controller. For CPU-bound work pin the maximum to the CPU count; for IO-bound work allow a larger maximum because workers spend most of their time blocked.

---

## Coding Questions

### Q: Implement a worker pool in Go using channels.

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

type Job struct {
    ID int
}

type Result struct {
    JobID int
    Value int
}

func worker(ctx context.Context, id int, jobs <-chan Job, results chan<- Result, wg *sync.WaitGroup) {
    defer wg.Done()
    for {
        select {
        case <-ctx.Done():
            return
        case j, ok := <-jobs:
            if !ok {
                return
            }
            time.Sleep(50 * time.Millisecond) // simulate work
            select {
            case results <- Result{JobID: j.ID, Value: j.ID * 2}:
            case <-ctx.Done():
                return
            }
        }
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()

    jobs := make(chan Job, 10)
    results := make(chan Result, 10)

    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go worker(ctx, i, jobs, results, &wg)
    }

    go func() {
        for i := 0; i < 20; i++ {
            select {
            case jobs <- Job{ID: i}:
            case <-ctx.Done():
                close(jobs)
                return
            }
        }
        close(jobs)
    }()

    go func() {
        wg.Wait()
        close(results)
    }()

    for r := range results {
        fmt.Printf("job %d -> %d\n", r.JobID, r.Value)
    }
}
```

Key points: a single producer closes `jobs`; workers exit cleanly on both `jobs` close and context cancellation; the results channel is closed after all workers finish via a goroutine that calls `wg.Wait`. The receive loop in main terminates when results is closed.

### Q: Implement ping-pong actors in Erlang.

```erlang
-module(pingpong).
-export([start/0, ping/2, pong/0]).

ping(0, Pong_PID) ->
    Pong_PID ! finished,
    io:format("Ping finished~n");

ping(N, Pong_PID) ->
    Pong_PID ! {ping, self()},
    receive
        pong ->
            io:format("Ping received pong~n")
    end,
    ping(N - 1, Pong_PID).

pong() ->
    receive
        finished ->
            io:format("Pong finished~n");
        {ping, Ping_PID} ->
            io:format("Pong received ping~n"),
            Ping_PID ! pong,
            pong()
    end.

start() ->
    Pong_PID = spawn(pingpong, pong, []),
    spawn(pingpong, ping, [3, Pong_PID]).
```

Each actor is a recursive function in a loop. Ping sends `{ping, self()}`, waits for `pong`, and decrements. Pong waits for either `finished` (terminates) or `{ping, From}` (replies). The pattern shows pure message passing with no shared state and tail-recursive loops as the actor body.

### Q: Implement an MPMC queue in Rust using `crossbeam_channel`.

```rust
use crossbeam_channel::{bounded, Receiver, Sender};
use std::thread;
use std::time::Duration;

fn producer(id: usize, tx: Sender<(usize, usize)>) {
    for i in 0..10 {
        tx.send((id, i)).expect("send failed");
        thread::sleep(Duration::from_millis(10));
    }
}

fn consumer(id: usize, rx: Receiver<(usize, usize)>) {
    while let Ok((pid, v)) = rx.recv() {
        println!("consumer {} got ({}, {}) from producer {}", id, pid, v, pid);
    }
}

fn main() {
    let (tx, rx) = bounded::<(usize, usize)>(32);

    let mut handles = vec![];
    for i in 0..3 {
        let tx_clone = tx.clone();
        handles.push(thread::spawn(move || producer(i, tx_clone)));
    }
    drop(tx); // close once original sender is dropped and clones finish

    for i in 0..2 {
        let rx_clone = rx.clone();
        handles.push(thread::spawn(move || consumer(i, rx_clone)));
    }

    for h in handles {
        h.join().unwrap();
    }
}
```

Crossbeam's `bounded` returns Sender and Receiver that are both Clone, giving MPMC. The channel closes when all senders are dropped; `recv` returns Err which terminates the consumer loop. Dropping the original `tx` early after cloning ensures the channel closes when all producers finish.

### Q: Compare bounded buffer implementations across languages.

```go
// Go: bounded channel
ch := make(chan int, 8)
ch <- 1  // blocks if full
v := <-ch  // blocks if empty
```

```rust
// Rust: tokio mpsc
let (tx, mut rx) = tokio::sync::mpsc::channel::<i32>(8);
tx.send(1).await.unwrap();
let v = rx.recv().await.unwrap();
```

```python
# Python: asyncio.Queue
q: asyncio.Queue[int] = asyncio.Queue(maxsize=8)
await q.put(1)
v = await q.get()
```

```erlang
%% Erlang: explicit bounded mailbox via gen_server with backpressure
%% (built-in mailboxes are unbounded; use a token semaphore actor)
```

The shared model: a fixed-capacity buffer with blocking-send and blocking-receive. Go embeds the buffer in the channel; Rust and Python expose it as a Queue or channel type. Erlang requires building it manually because mailboxes are unbounded by design — a lesson that "always bounded" is not a universal default.

### Q: Implement a retry pattern using a Go channel with timeout.

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "math/rand"
    "time"
)

func callWithRetry(ctx context.Context, attempts int, op func() error) error {
    var lastErr error
    backoff := 100 * time.Millisecond
    for i := 0; i < attempts; i++ {
        result := make(chan error, 1)
        go func() { result <- op() }()
        select {
        case err := <-result:
            if err == nil {
                return nil
            }
            lastErr = err
        case <-ctx.Done():
            return ctx.Err()
        }
        jitter := time.Duration(rand.Int63n(int64(backoff / 2)))
        select {
        case <-time.After(backoff + jitter):
        case <-ctx.Done():
            return ctx.Err()
        }
        backoff *= 2
    }
    return fmt.Errorf("after %d attempts: %w", attempts, lastErr)
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    err := callWithRetry(ctx, 5, func() error {
        if rand.Float64() < 0.7 {
            return errors.New("transient")
        }
        return nil
    })
    fmt.Println("final:", err)
}
```

Each attempt runs the operation in a goroutine and waits on either the result or the context; backoff doubles on each retry with jitter to avoid thundering herd. Context cancellation propagates immediately. The pattern combines message passing (the result channel) with timing primitives (time.After) cleanly.

### Q: Implement a fan-in merge in Go.

```go
func merge(cs ...<-chan int) <-chan int {
    var wg sync.WaitGroup
    out := make(chan int)

    output := func(c <-chan int) {
        defer wg.Done()
        for v := range c {
            out <- v
        }
    }
    wg.Add(len(cs))
    for _, c := range cs {
        go output(c)
    }

    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

One goroutine per input channel forwards values to `out`. A WaitGroup tracks completion, and a single goroutine closes `out` once all inputs are drained. This is the canonical fan-in for unknown N inputs. Beware: if `out` is unbuffered and the consumer is slow, all input goroutines block, propagating backpressure into the upstream channels.

### Q: Implement a generator with cancellation in Go.

```go
func gen(ctx context.Context, nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range nums {
            select {
            case out <- n:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

Every send is wrapped in a select with the context's done channel; if the consumer stops reading and the context cancels, the generator exits and closes its output. This is the pattern that prevents the goroutine leak in the earlier tricky question.

---

## Behavioral / Experience

### Q: Tell me about a time message-passing helped you solve a production issue.

I worked on a service that aggregated metrics from thousands of agents. The original design used a shared map protected by a mutex; under load the mutex became a bottleneck and CPU profiling showed 60% of time in lock acquisition. I refactored to a per-agent goroutine model: each agent had its own actor goroutine with a bounded channel as its mailbox, and aggregation happened in a downstream reducer goroutine. The mutex contention disappeared, latency dropped by 4x at the same throughput, and the code became easier to reason about because each agent's state was now encapsulated.

### Q: Describe a debugging session involving a deadlock in a message-passing system.

A Go pipeline of three stages was hanging in production. Profiling showed all goroutines parked on channel sends. The root cause was a downstream consumer that called an HTTP API which had become slow; the consumer was reading from its input channel slowly, the middle stage's output channel filled, the middle stage stopped reading from its input, and so on up the pipeline. The fix had two parts: bounded buffers on each stage so the propagation was bounded, and circuit breakers around the downstream HTTP call so a slow dependency could not stall the pipeline. The lesson was that backpressure propagation can be a feature or a problem, and you need explicit shedding at the edge.

### Q: Tell me about a time you chose shared memory over message passing.

We had a hot loop computing statistics over a large in-memory dataset, with multiple worker threads each updating per-shard counters. An initial actor-based design copied the data on every message, which destroyed cache locality and was three times slower than direct shared-memory updates with sharded counters and per-shard atomics. We accepted the additional complexity because the workload was performance-critical and the team understood the locking discipline. The takeaway is that message passing is the right default but is not the right tool when data locality dominates the cost.

### Q: Describe a case where unbounded buffers caused production problems.

A Slack-like notification system used unbounded actor mailboxes. When a downstream push-notification provider had an outage, messages accumulated in the actor mailboxes until the JVM ran out of memory and crashed. The post-mortem fix was to switch to bounded mailboxes with explicit overflow policies — drop oldest for low-priority notifications, route to a DLQ for high-priority ones — and to add monitoring on mailbox depth with alerts. The deeper lesson is that "unbounded" is not a default; it is a design choice that requires justification.

### Q: How did you handle the migration from a synchronous to a message-passing architecture?

We had a monolith with deeply nested synchronous calls; latency was dominated by the longest synchronous chain. We introduced an internal event bus and started moving fan-out operations (notifications, search indexing, analytics) to consumers on that bus, leaving the synchronous read/write path for the user-facing transaction. The migration was staged: one consumer at a time, with dual-write for safety until the consumer was proven, then synchronous code removed. The hardest part was making consumers idempotent because at-least-once delivery surfaced bugs that the synchronous path had hidden.

### Q: Tell me about choosing a buffer size that mattered.

A worker pool with a job channel had buffer size 1000 by default; under bursty load the channel filled, jobs sat in the queue for tens of seconds, and clients saw timeouts even though the workers were processing at full speed. Reducing the buffer to 16 made the producer block earlier, which propagated backpressure to the HTTP layer where requests were rejected with 503 quickly rather than queued for ages. End-to-end p99 latency dropped substantially because clients could retry rather than wait. The lesson: large buffers hide problems rather than solving them.

### Q: How did you debug an Erlang process with a giant mailbox?

`erlang:process_info(Pid, message_queue_len)` showed 50,000 messages; the process was selectively receiving messages by reference tag and ignoring all others, which scanned the entire mailbox on every new message. The root cause was a buggy producer sending status updates faster than the process could consume them, and the selective receive amplified the slowdown. The fix was to convert the process to a `gen_server` whose receive matches every message, and to add backpressure on the producer.

### Q: Describe a time at-least-once delivery surprised you.

A billing pipeline retried failed messages, and a brief broker glitch caused a small fraction of messages to be redelivered. The consumer was not idempotent, so a handful of customers were charged twice. The post-mortem produced two changes: every message gained an idempotency key indexed in the billing database, and we added an end-to-end test that intentionally redelivers messages to verify idempotency. The broader lesson: at-least-once delivery is not optional in any system that does retries, and "we never expect duplicates" is wishful thinking.

---

## What I'd Ask a Candidate Now

### Q: Walk me through what happens, instruction by instruction, when a Go goroutine sends on a full buffered channel.

I want to see whether the candidate understands the runtime: the send acquires the channel's mutex, sees the buffer is full and the receive-wait queue is empty, parks the sending goroutine on the send-wait queue, releases the mutex, and yields to the scheduler. A senior candidate connects this to how a subsequent receive walks the send-wait queue and hands the value directly without re-buffering, plus the cost of the parking operation.

### Q: When would you prefer Erlang's actor model over Go's CSP?

I am looking for a comparison along three axes: failure semantics (Erlang's supervisor trees vs Go's manual recovery), addressing (PIDs vs anonymous channels), and synchronization (asynchronous mailboxes vs synchronous rendezvous). A strong candidate names workloads where each excels — Erlang for high-availability telecom-style systems with millions of long-lived sessions, Go for high-throughput pipelines with explicit data flow.

### Q: Design backpressure for a system with a slow consumer; what knobs do you have?

I want a tour of the options: bounded buffer + blocking send (transparent), bounded buffer + drop policy (lossy), explicit credit-based flow control (Reactive Streams), and load shedding at the edge (admission control). The candidate should also discuss observability — how do you know backpressure is happening, and what metrics do you alert on?

### Q: Critique a piece of code that has at-least-once delivery but a non-idempotent consumer.

Show a snippet that increments a counter or charges a customer in response to each message. The candidate should immediately spot that retries will double-charge, propose adding an idempotency key, discuss where the dedup state lives (in-memory bounded LRU, Redis with TTL, DB unique constraint), and address how dedup state survives restarts.

### Q: How would you design observability for a message-passing system?

I want trace propagation through message headers, mailbox-depth metrics per actor or queue, message-age histograms, DLQ counts and alerting, end-to-end latency tracked via correlation IDs, and structured logs with the correlation ID on every emitted log line. A strong answer discusses head-based vs tail-based sampling trade-offs and which to use when.

### Q: Tell me about a time you removed a message-passing layer and went back to shared memory.

I want to see if the candidate has the maturity to recognize over-engineering. Common reasons: copy overhead on hot paths, debugging difficulty of asynchronous flows, team unfamiliarity, or the actor topology became a tangled web. The lesson is that message passing is a tool, not a religion.

### Q: What is the worst message-passing design choice you have inherited?

I am probing for stories — unbounded mailboxes, ask patterns on hot paths, no DLQ, no correlation IDs, no timeouts on ask, supervisors that restart misbehaving actors fast enough to mask a permanent failure. The candidate should describe both the symptom and the systemic fix, not just patches.

---

## Cheat Sheet

**Models:**
- CSP: synchronous channels, anonymous processes (Go, occam).
- Actor: asynchronous mailboxes, addressed processes (Erlang, Akka).
- Async queues: cooperative, single event loop (Python asyncio, JS).

**Send semantics:**
- Sync send: blocks until receiver accepts (Go unbuffered chan).
- Async send: buffer or mailbox, may block on overflow or drop.

**Buffer policies on overflow:**
- Block sender (backpressure).
- Drop new (latest-loses).
- Drop old (oldest-loses).
- Fail loudly (reject, panic, 503).

**Delivery guarantees:**
- At-most-once: lossy, may skip.
- At-least-once: must dedupe at consumer.
- Exactly-once: at-least-once + idempotent consumer.

**Ordering:**
- Per-sender FIFO: standard in Akka, Erlang.
- No global ordering across senders.

**Common bugs:**
- Unbuffered send with no receiver in scope → deadlock.
- Range over never-closed channel → leak.
- Select on closed channel → spins.
- Send on closed channel → panic.
- Double close → panic.
- Unbounded mailbox + slow consumer → OOM.
- Ask without timeout → permanent block.

**Backpressure techniques:**
- Bounded buffer + blocking send.
- Reactive Streams credit-based demand.
- Token bucket admission.
- Circuit breaker on downstream.

**When to use what:**
- Go channels: pipelines, fan-in/fan-out, worker pools.
- Erlang actors: fault-tolerant, long-lived sessions, supervised trees.
- Akka: JVM ecosystems, persistent actors, sharded clusters.
- Rust mpsc: high-throughput in-process pipelines with strict typing.
- Python asyncio.Queue: single-loop async IO coordination.

---

## Further Reading

- Hoare, "Communicating Sequential Processes" (1978).
- Hewitt, Bishop, Steiger, "A Universal Modular Actor Formalism for Artificial Intelligence" (1973).
- Armstrong, "Programming Erlang: Software for a Concurrent World."
- Joe Armstrong, "Making Reliable Distributed Systems in the Presence of Software Errors" (thesis).
- "Designing Data-Intensive Applications," Kleppmann (chapters on messaging, replication).
- Akka documentation: Behaviors, Persistence, Streams.
- Go blog: "Go Concurrency Patterns: Pipelines and Cancellation."
- Tokio tutorial: channels and select.
- "Reactive Manifesto" — for backpressure as a system property.

---

## Related Topics

- [Shared-Memory Concurrency](../01-shared-memory/README.md)
- [Actor Model](../03-actor-model/README.md)
- [CSP](../04-csp/README.md)
- [Channels and Queues](../../02-primitives/README.md)
- [Backpressure Strategies](../../03-backpressure/README.md)
- [Supervision Trees](../../04-failure-models/README.md)
- [Idempotency Patterns](../../05-delivery-semantics/README.md)

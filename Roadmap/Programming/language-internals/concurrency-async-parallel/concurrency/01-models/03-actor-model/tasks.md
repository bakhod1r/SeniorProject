# Actor Model — Hands-On Tasks

> **Topic:** [Actor Model Roadmap](README.md)
> **Focus:** Build, supervise, route, persist, and benchmark actors across Erlang, Akka Typed, Orleans, and Tokio until the model is second nature.

---

## Introduction

The actor model is easy to describe and hard to feel. You only learn it by writing a mailbox, watching a supervisor restart a crashed child, hitting a real router with load, and discovering that "fire and forget" is not the same as "fire and pray." These tasks push you through that practical arc: from a 30-line ping-pong to a sharded chat server and a payment ledger with idempotency. Pick a primary stack (Erlang/OTP, Akka Typed on JVM, Microsoft Orleans on .NET, or Tokio on Rust) and do every task there. Then re-implement two or three in a second stack — that contrast is where senior intuition forms.

---

## Table of Contents

1. [Warm-Up](#warm-up)
2. [Core](#core)
3. [Advanced](#advanced)
4. [Capstone](#capstone)
5. [Sample Solutions](#sample-solutions)
6. [Closing](#closing)

---

## Warm-Up

These are the "does my toolchain even work" tasks. Each one should take 20-60 minutes. Do not skip them — actor frameworks have enough ceremony that the first runnable program is half the battle.

### Task 1: Erlang gen_server ping-pong

**Problem.** Implement two `gen_server` processes, `ping` and `pong`. `ping` sends `{ping, self()}` to `pong`; `pong` replies `{pong, self()}`; `ping` counts received pongs and stops after 1000 round trips. Print the elapsed time.

**Constraints.**
- Use OTP `gen_server`, not raw `spawn`/`!`.
- Both processes must be registered with names (`?MODULE` is fine).
- The round-trip count must be observable from a `sys:get_state/1` call.

**Hints (try without first).**
- `handle_cast/2` is enough — no synchronous calls needed.
- Start the timer in `init/1` of `ping` after seeding the first message to itself.
- Stop with `{stop, normal, State}` when the counter hits the target.

**Self-check.**
- [ ] `erl -noshell -s pingpong run -s init stop` prints elapsed milliseconds.
- [ ] Killing `pong` mid-run causes `ping` to crash too (no link/monitor yet — that's fine).
- [ ] You can explain why `gen_server:cast` returns immediately while `call` blocks.

### Task 2: Akka Typed echo actor

**Problem.** Build a typed `Echo` actor in Akka Typed (Scala or Java) that accepts `Echo(text, replyTo)` and replies with `Echoed(text)`. From `main`, spawn the actor, send 5 messages, and print each reply.

**Constraints.**
- Use `Behaviors.receiveMessage` — no untyped `ActorRef`.
- The protocol must be a sealed trait/sealed interface with `Echo` and a separate `Echoed` reply type.
- `ActorSystem` must shut down cleanly at the end (`system.terminate()` + await).

**Hints (try without first).**
- The "main" can itself be an actor that holds `context.spawn(Echo(), "echo")`.
- For replies, the main actor needs its own `Behavior<Echoed>` — or use `AskPattern`.
- Termination: `CoordinatedShutdown` or just `system.terminate()` after a `Thread.sleep`.

**Self-check.**
- [ ] No `Any`/`Object` anywhere in the message types.
- [ ] The program exits with code 0 within 2 seconds.
- [ ] You understand why `Behaviors.same` is different from returning the original `Behavior` value.

### Task 3: Orleans grain Hello

**Problem.** In Microsoft Orleans, define an `IHelloGrain` with a `SayHello(string name)` method that returns a `Task<string>`. Host a silo in-process, then call the grain 3 times with different names.

**Constraints.**
- Use Orleans 7+ APIs (`UseOrleans` on the host builder, `GrainBase`).
- Grain ID is a `string`, not a `Guid`.
- Calls must go through `IClusterClient.GetGrain<IHelloGrain>(id)`.

**Hints (try without first).**
- Use `Microsoft.Extensions.Hosting` + `UseOrleans(silo => silo.UseLocalhostClustering())`.
- The grain interface lives in a shared project; the implementation references it.
- `await host.StartAsync()` before you ask for the cluster client.

**Self-check.**
- [ ] Two calls with the same ID hit the same grain instance (log the instance hash).
- [ ] Two calls with different IDs may or may not hit the same instance — explain why.
- [ ] You can articulate the difference between an Orleans grain and an Akka actor.

### Task 4: Tokio mini-actor via `tokio::sync::mpsc`

**Problem.** In Rust with Tokio, build a `Counter` actor: a `tokio::spawn`ed task owning state, listening on an `mpsc::Receiver<Message>`. Messages: `Inc`, `Get(oneshot::Sender<u64>)`. From `main`, send 100 `Inc` and then `Get`, print the result.

**Constraints.**
- No external actor crate (`actix`, `ractor`, etc.) — handwritten.
- The actor's state is a plain `u64`, never wrapped in `Arc<Mutex<…>>`.
- Provide a `CounterHandle` newtype that wraps the `Sender` and exposes typed methods.

**Hints (try without first).**
- The handle's `inc()` is `pub async fn inc(&self) { self.tx.send(Message::Inc).await.unwrap(); }`.
- `get()` creates an `oneshot::channel` and awaits the receiver.
- The actor task is a `while let Some(msg) = rx.recv().await { match msg { … } }` loop.

**Self-check.**
- [ ] Dropping the `CounterHandle` causes the actor task to exit cleanly.
- [ ] You can compile `cargo build --release` with zero warnings.
- [ ] You see why this pattern beats `Arc<Mutex<u64>>` for contended writes.

### Task 5: Basic message send and receive

**Problem.** In your primary language, build two actors, `Producer` and `Consumer`. `Producer` sends 10000 integers `1..=10000` to `Consumer`, which sums them and prints the total. Measure wall-clock time.

**Constraints.**
- Single-machine, single-process.
- No shared memory between the actors — only messages.
- The sum must be exactly `50_005_000` (sanity check).

**Hints (try without first).**
- The bottleneck is usually the mailbox enqueue/dequeue, not arithmetic.
- Batching (send a `Vec` of 100 ints per message) usually gives a 10-50× speedup.
- Print throughput in msgs/sec.

**Self-check.**
- [ ] Run it 5 times — variance is under 10%.
- [ ] Increase to 1M integers; the program still completes.
- [ ] You measured both per-message and batched throughput.

### Task 6: Reading an actor mailbox

**Problem.** Trigger backpressure intentionally. Send 1M messages to a slow actor (it `sleep`s 1ms per message). Observe and report the mailbox depth at intervals.

**Constraints.**
- Use the framework's built-in mailbox metric if available (Akka: `MailboxSelector`/`DispatcherInfo`; Erlang: `process_info(Pid, message_queue_len)`).
- Sample the depth every 100ms; print a table.
- Do not OOM your machine — cap producer rate if needed.

**Hints (try without first).**
- Erlang: `erlang:process_info(Pid, message_queue_len)` is the canonical probe.
- Akka: enable `akka.actor.debug.mailbox` or use a custom metric mailbox.
- Tokio: `mpsc::channel(N)` has a fixed capacity; reading `tx.capacity()` is your gauge.

**Self-check.**
- [ ] You see the queue grow monotonically until the producer stops.
- [ ] You can name two production risks of unbounded mailboxes.
- [ ] You added a `MAX_QUEUE` ceiling that drops or rejects on overflow.

### Task 7: Cross-runtime "hello"

**Problem.** Pick two of {Erlang, Akka, Orleans, Tokio} and implement the same "echo" actor in both. Write a 1-paragraph diff of the developer experience (ceremony, typing, ergonomics).

**Constraints.**
- Both versions must run from `cargo`/`mix`/`sbt`/`dotnet` in one command.
- The paragraph cites concrete code locations (e.g. "Akka requires 4 type parameters here; Erlang requires zero").

**Hints (try without first).**
- Start by counting LOC for each.
- Note typing: Akka is statically typed end-to-end; Erlang is dynamic.
- Note distribution defaults: Erlang and Orleans bake it in; Akka needs config; Tokio needs you to write it.

**Self-check.**
- [ ] You have a paragraph saved as `README-comparison.md` in the task folder.
- [ ] The two binaries print identical output for identical input.
- [ ] You picked the runtime you'll use for the Core section.

---

## Core

These tasks teach the patterns. Expect 1-3 hours each. Stop and read framework docs when you hit a wall — the framework conventions are part of the lesson.

### Task 8: Bank-account actor

**Problem.** Implement a `BankAccount` actor with messages `Deposit(amount)`, `Withdraw(amount, replyTo)`, `Balance(replyTo)`. Withdraw must reply `Ok(newBalance)` or `Insufficient(currentBalance)`. Run a thousand concurrent transactions and assert the final balance is consistent.

**Constraints.**
- The balance is an integer (cents), never a float.
- Withdraw uses ask-pattern with a 1-second timeout.
- Concurrency comes from many *senders*; the account is a single actor.

**Hints (try without first).**
- The single-writer invariant is automatic — that's the whole point of actors.
- Use `BigInteger`/`i64`/`integer()` to avoid overflow at 1k tx × 1M cents.
- Log every accepted and rejected withdrawal; reconcile at the end.

**Self-check.**
- [ ] `final_balance == initial + sum(deposits) - sum(accepted_withdraws)`.
- [ ] Rejected withdraws never modify state.
- [ ] You can explain why no lock is needed.

### Task 9: Supervisor restart on crash

**Problem.** Build a supervisor over the bank-account actor. On the child's crash, the supervisor restarts it with the *last known balance* (cheating with shared memory is forbidden — restore via the child's `preStart` from an event log or `init` argument).

**Constraints.**
- Use the framework's idiomatic supervision (Erlang: `supervisor` behaviour; Akka Typed: `Behaviors.supervise(...).onFailure[E]`).
- Restart strategy is `one-for-one`, max 3 restarts in 10 seconds.
- After 3 restarts in the window, the supervisor itself escalates.

**Hints (try without first).**
- The child must take its initial balance as a constructor/spawn argument.
- The supervisor reads the last balance from an in-memory store (a `Map` actor or a `parent state`).
- Simulate a crash by sending `Crash` that the child handles by `throw new RuntimeException`.

**Self-check.**
- [ ] Three quick crashes in 5 seconds escalates to the supervisor's parent.
- [ ] After restart, `Balance` returns the last persisted value.
- [ ] You can describe the difference between `restart`, `resume`, and `stop` directives.

### Task 10: FSM via become/behavior switching

**Problem.** Model a `DoorActor` with states `Open`, `Closed`, `Locked`. Messages: `OpenDoor`, `CloseDoor`, `Lock`, `Unlock`. Implement state transitions by switching the actor's behavior (Erlang's `loop(NewState)`, Akka's `Behaviors.receive { … nextBehavior }`).

**Constraints.**
- The state is encoded as *which behavior the actor is running*, not as a `state` field.
- Illegal transitions (e.g. `Unlock` from `Open`) reply `IllegalTransition`.
- The actor never mutates a shared variable; each behavior is pure-ish.

**Hints (try without first).**
- Sketch the FSM on paper first: 3 states, 4 events, 8 valid edges.
- In Akka Typed, define `def open: Behavior[Cmd] = …` `def closed: Behavior[Cmd] = …` and return each.
- In Erlang, the loop is `loop(open) -> receive …; loop(closed)`.

**Self-check.**
- [ ] Adding a new state (`Broken`) takes ~10 lines, no field changes.
- [ ] Every transition logs `state X --event--> state Y`.
- [ ] You understand why this pattern is preferred over a `switch (state)` block inside one behavior.

### Task 11: Round-robin router across N workers

**Problem.** Build a `Router` actor that owns N=8 `Worker` children. Incoming `Job(payload)` messages are dispatched round-robin. Each worker simulates 50ms of CPU work and replies with `Done(id)`. Measure throughput vs. N.

**Constraints.**
- The router itself is a single actor — no shared atomic counter.
- N is configurable; rerun the benchmark with N ∈ {1, 2, 4, 8, 16, 32}.
- The benchmark sends 100k jobs and measures total wall-clock time.

**Hints (try without first).**
- Akka has a built-in `Routers.pool(n)` — write your own first, then compare.
- The router holds a `nextIdx: Int` field; increment on each message.
- Workers should be stateless — that's what makes round-robin safe.

**Self-check.**
- [ ] Throughput scales near-linearly up to your CPU core count.
- [ ] Beyond core count, you see diminishing returns (or worse).
- [ ] You sketched the chart and can explain the knee.

### Task 12: Stash + unstash during transient state

**Problem.** A `CacheLoader` actor warms a cache asynchronously on startup. While loading, it must stash all `Get(key)` requests and replay them after `LoadComplete`. Implement with the stash primitive.

**Constraints.**
- Use the framework's stash (Akka Typed: `Behaviors.withStash`; Erlang: `gen_statem` postpone or manual queue).
- Stash capacity is bounded — overflow logs a warning and drops the oldest.
- After unstash, the actor handles `Get` normally.

**Hints (try without first).**
- During loading, `Get` should be stashed; `LoadComplete` should `unstashAll` and switch behavior to `ready`.
- In Erlang, you can keep your own `queue:new()` and replay on transition.
- Test: send 10 `Get`s before `LoadComplete`, verify all are answered after.

**Self-check.**
- [ ] All stashed messages are eventually answered (no losses).
- [ ] Stashing more than capacity drops the oldest (or rejects — your choice).
- [ ] You can name two real-world scenarios where stash is the right primitive.

### Task 13: Ask pattern with timeout

**Problem.** Build a `Resolver` actor that resolves a `Hostname` to an `IpAddress` (mock it — sleep 100ms). From a separate actor, send `Resolve("example.com")` using ask with a 50ms timeout. Observe and handle the timeout.

**Constraints.**
- Use the framework's idiomatic ask (Akka: `AskPattern.ask`; Erlang: `gen_server:call/3` with timeout; Tokio: `oneshot` with `tokio::time::timeout`).
- The asker handles `Success(ip)`, `Failure(timeout)`, and `Failure(other)` distinctly.
- On timeout, the resolver's later reply (if any) must not crash anything.

**Hints (try without first).**
- The "late reply" problem is real — Akka wraps replies in adapters; Erlang's `gen_server:call` discards them.
- Test both the under-timeout and over-timeout paths.
- In Erlang, the resolver's reply after timeout becomes a stray message — flush with `receive _ -> ok after 0 -> ok end`.

**Self-check.**
- [ ] Timeouts surface as `Failure(timeout)`, not as crashes.
- [ ] Increasing the timeout to 200ms makes 100% of asks succeed.
- [ ] You understand why ask creates a temporary actor under the hood (in Akka).

### Task 14: Routing by content hash

**Problem.** Build a `HashRouter` over N=4 workers. Each `Job(key, payload)` is dispatched to worker `hash(key) % N`. The point: the same `key` always lands on the same worker, so per-key state is safe.

**Constraints.**
- Workers maintain a per-key `Map<Key, Counter>` and increment on each job.
- The router itself is stateless except for the worker list.
- Final reconciliation: the sum of all per-key counters across workers must equal the total jobs sent.

**Hints (try without first).**
- Pick a hash with good distribution: `MurmurHash3`, `xxhash`, or `Object.hashCode` (just measure variance).
- Visualize the load per worker — if it's skewed, your hash is bad or the key space is.
- A bad hash on a small key set is a classic interview gotcha.

**Self-check.**
- [ ] Per-worker load variance is under 10% with 1M random keys.
- [ ] The same key sent twice always hits the same worker.
- [ ] You can describe how `ConsistentHashRouter` improves on plain modulo when workers are added/removed.

### Task 15: Named-actor lookup

**Problem.** Build a `Registry` actor holding `Map<String, ActorRef>`. Actors register on `Register(name, self)`; senders look up via `Lookup(name, replyTo)`. Use it to send messages without holding a direct reference.

**Constraints.**
- Registration is idempotent — registering a dead actor's name should clean up.
- Lookup returns `Found(ref)` or `NotFound`.
- The registry watches each registered actor and removes it on termination.

**Hints (try without first).**
- In Akka Typed, use `Receptionist` instead of writing your own — but write your own first to feel the pattern.
- In Erlang, you can compare with `global:register_name/2` and `pg`.
- The "watch on register" hook is the only way to keep stale entries out.

**Self-check.**
- [ ] Lookup returns `NotFound` for an actor that was stopped.
- [ ] Two registrations with the same name behave per your documented policy (overwrite or reject).
- [ ] You can explain when a registry beats passing refs explicitly.

### Task 16: Per-message backpressure on a slow consumer

**Problem.** Wire a fast producer to a slow consumer. The producer must observe backpressure — slowing down when the consumer is overwhelmed, not blindly filling the mailbox.

**Constraints.**
- Use credit-based flow control or `ask`-driven pacing (producer sends 1 message, awaits ack, sends the next).
- Compare throughput to the unbounded case (Task 6 baseline).
- Show a 10x reduction in peak memory.

**Hints (try without first).**
- Credit window of 10: producer can have 10 in-flight messages; consumer sends `Ack(n)` after processing.
- Reactive Streams (`Akka Streams`, `tokio_stream`) implements this — but build your own first.
- A perfect credit window = throughput / latency.

**Self-check.**
- [ ] Peak memory is bounded, regardless of how long the producer runs.
- [ ] You can plot throughput vs. window size and find the sweet spot.
- [ ] You can explain the trade-off between latency and throughput in credit-based systems.

### Task 17: Worker pool with dynamic resize

**Problem.** Extend Task 11's router to dynamically grow/shrink the worker pool based on queue depth. If average depth > 100 for 5 seconds, add a worker; if < 10 for 30 seconds, remove one. Cap at 64 workers.

**Constraints.**
- The decision is made by a separate `Autoscaler` actor that monitors the router.
- Worker creation and termination must not lose in-flight jobs.
- Log every scale event with the reason.

**Hints (try without first).**
- Drain a worker before stopping: send it `Stop` and wait for `Stopped`.
- Hysteresis matters — without it, you'll thrash between scale-up and scale-down.
- The autoscaler is a control loop; classic PID is overkill but instructive.

**Self-check.**
- [ ] Under a sudden load spike, the pool grows within 6 seconds.
- [ ] When load drops, the pool shrinks within 35 seconds.
- [ ] No job is lost during scale-down (count sent == count completed).

---

## Advanced

These are 3-8 hour tasks. They cross into distributed-systems territory and ops concerns.

### Task 18: Persistent actor with snapshots + event journal

**Problem.** Reimplement the bank account from Task 8 as a persistent (event-sourced) actor. Every `Deposit` and `Withdraw` is journaled as an event. On restart, the actor replays events to reconstruct state. Snapshot every 100 events.

**Constraints.**
- Use Akka Persistence Typed (`EventSourcedBehavior`), or Erlang's `khepri`/`mnesia`, or roll your own append-only log file.
- Replay must reconstruct the exact balance.
- Snapshot triggers do not interrupt incoming commands.

**Hints (try without first).**
- The command-handler validates and emits an event; the event-handler applies it to state.
- After a snapshot, the journal can be pruned (in test, leave it; in prod, it's a separate concern).
- Replay performance is what you tune; snapshots are the lever.

**Self-check.**
- [ ] Killing the actor mid-run and restarting reconstructs the correct balance.
- [ ] Snapshot files are written every 100 events.
- [ ] Replay from snapshot + tail takes < 10ms for 10k events.

### Task 19: Cluster sharding stub (Akka)

**Problem.** Use Akka Cluster Sharding to distribute 1000 bank-account entities across 3 nodes. Each entity is keyed by `accountId`. Messages must reach the right shard regardless of which node they enter from.

**Constraints.**
- Run 3 nodes locally on different ports.
- Use `ClusterSharding.init(EntityKey)` and `EntityRef`.
- Kill node 2 and confirm its shards migrate (no data loss in this stub — persistence is Task 18).

**Hints (try without first).**
- `application.conf` needs `akka.cluster.seed-nodes` and `akka.actor.provider = "cluster"`.
- Use a deterministic hash on `accountId` for the shard ID.
- Sharding is opinionated — read the Akka docs first.

**Self-check.**
- [ ] An ask from node 1 to account "A1" is routed to whichever node owns it.
- [ ] Killing node 2 triggers shard rebalancing within 30 seconds.
- [ ] After rebalancing, asks still succeed.

### Task 20: Split-brain handling

**Problem.** Simulate a network partition in a 5-node cluster (use `tc qdisc` or Toxiproxy or just kill cluster messaging). Configure Akka's Split-Brain Resolver (or your equivalent) to keep one side and shut down the other.

**Constraints.**
- Choose a resolver strategy (`static-quorum`, `keep-majority`, `keep-oldest`) and document why.
- After partition heals, the cluster reforms cleanly.
- No two nodes ever both think they're the "leader."

**Hints (try without first).**
- `static-quorum = 3` is the simplest correct choice for 5 nodes.
- "Keep-oldest" is appealing but fragile — the oldest may be on the minority side.
- Test all the partition shapes: 3-2, 4-1, 2-2-1.

**Self-check.**
- [ ] During a 3-2 partition, the side of 2 shuts down within 30 seconds.
- [ ] After heal, the 2 nodes rejoin as fresh members (logs say so).
- [ ] You have a written rationale for your chosen strategy.

### Task 21: Throughput benchmark (msgs/sec, actor density)

**Problem.** Benchmark your runtime: max messages/sec a single actor can process; max actors you can spawn before throughput collapses. Plot both curves.

**Constraints.**
- Use a CPU-bound microbench (no I/O).
- Pin to a known CPU count and disable turbo boost if possible.
- Report numbers with two-significant-figure precision.

**Hints (try without first).**
- Erlang BEAM can usually hold 1M+ actors with no sweat.
- Akka on the JVM tops out around 2-5M actors per node depending on heap.
- Tokio tasks are cheaper than threads but each `mpsc` channel costs ~200 bytes minimum.

**Self-check.**
- [ ] You have two graphs and a 200-word writeup of what bottlenecks where.
- [ ] You can compare your numbers to the framework's published benchmarks.
- [ ] You can predict the dispatcher tuning (Task 24) that would shift the curves.

### Task 22: Mailbox saturation alarm

**Problem.** Build an `MailboxMonitor` actor that polls a set of "watched" actors every 500ms and emits a `Saturation(name, depth)` event when depth exceeds a threshold (default 1000). Wire it to a logger or metrics sink.

**Constraints.**
- The monitor must not itself become saturated — use bounded mailbox and drop-newest.
- Watch list is dynamic (`Watch(ref)`, `Unwatch(ref)`).
- Emit `Recovered(name)` when depth returns below threshold for 5 consecutive polls.

**Hints (try without first).**
- In Erlang, `process_info(Pid, message_queue_len)` is your probe.
- In Akka, you'll need a custom metric mailbox or external instrumentation.
- Hysteresis: do not flap between Saturation and Recovered every poll.

**Self-check.**
- [ ] You can demonstrate the alarm firing under synthetic load.
- [ ] The alarm clears within 5s after the load drops.
- [ ] The monitor itself never lags more than 1 second behind real-time.

### Task 23: Actor tracing with OpenTelemetry

**Problem.** Instrument a 3-actor call chain (`A -> B -> C -> reply`) with OpenTelemetry spans. The trace must show the message hop, not just the per-actor processing. Export to Jaeger or the console exporter.

**Constraints.**
- Each message carries a trace context (`traceId`, `spanId`).
- Spans are started on message receive and ended on reply or terminal action.
- Use the OTel SDK for your language (Java for Akka, `opentelemetry` for Erlang, `tracing-opentelemetry` for Rust).

**Hints (try without first).**
- The "context propagation" pattern means messages have a metadata header, not a field per call.
- In Akka, wrap messages with a `Traced<T>(payload, context)` or use `Behaviors.setup` to capture context.
- Test by issuing one request and finding 3 spans in Jaeger UI.

**Self-check.**
- [ ] Jaeger shows the parent-child relationship across actors.
- [ ] Async hops are correctly attributed (B's span starts after A's send, not after A's receive).
- [ ] You can name 3 things that go wrong if you forget context propagation.

### Task 24: Dispatcher / executor tuning

**Problem.** Reproduce a workload where dispatcher choice changes throughput by 3x or more. In Akka, compare default vs. pinned dispatcher vs. fork-join with custom parallelism. In Erlang, tweak `+S` and `+SDcpu` flags.

**Constraints.**
- Workload mixes CPU-bound and blocking I/O.
- Measure 95th percentile latency in addition to throughput.
- Report the configuration that wins for each workload.

**Hints (try without first).**
- Blocking I/O on the default dispatcher will starve other actors. Pin it.
- "Throughput" config (Akka) controls how many messages an actor processes before yielding.
- Erlang's scheduler is usually correct out of the box; experiment to feel the dials.

**Self-check.**
- [ ] You produced a "before" and "after" number with the same workload.
- [ ] You can explain *why* the tuning helped (with reference to the framework's scheduler).
- [ ] You documented the trade-off (e.g., latency vs. fairness).

### Task 25: Testing actors with TestKit

**Problem.** Write unit tests for the bank-account actor using your framework's TestKit (Akka: `ActorTestKit`; Erlang: `meck` + `gen_server` testing; Tokio: `tokio::test`). Cover: happy-path deposit, withdraw insufficient funds, crash + restart, timeout in ask.

**Constraints.**
- Tests run in CI in < 10 seconds total.
- No `Thread.sleep` in test code — use TestKit probes and explicit synchronization.
- Tests are deterministic (no flakes over 100 runs).

**Hints (try without first).**
- `TestProbe` is your friend: send a message, expect a message, with a timeout.
- For crash testing, use `BehaviorTestKit.expectEffect(Stopped)` in Akka Typed.
- In Erlang, `proper`-style property tests work great on `gen_server` semantics.

**Self-check.**
- [ ] All 4 cases pass on a fresh checkout.
- [ ] You ran the suite 100 times and got 100 passes.
- [ ] You can describe how to test a sharded actor (hint: it's harder).

---

## Capstone

These are the integrative projects. Expect 1-3 days each. Bring the same rigor you'd bring to production work.

### Task 26: Chat server with rooms and presence

**Problem.** Build a chat server using actors. Each `Room` is an actor holding a `Set<UserRef>`. `User` actors connect, join rooms, send messages, see presence. Persistence is optional but bonus. Choose Erlang/OTP or Akka.

**Constraints.**
- A `Lobby` (singleton or sharded) creates rooms on demand.
- Joining a room is `JoinRoom(roomId, user)`; leaving is symmetric.
- A user's disconnect must remove them from all rooms (use `watch`/`monitor`).
- At least one room must survive a server restart (event sourcing or external store).
- Concurrency target: 1000 users, 50 rooms, 10 msgs/sec/user, sustained for 5 minutes.

**What "done" looks like.** You can demo: a client (telnet or a tiny WebSocket frontend) connecting, joining `#general`, seeing a "userN joined" message, posting a chat, having other connected clients receive it within 50ms p99. When you `kill` the user's process, every room they were in announces their departure. Restarting the server replays the persisted rooms (if you did the bonus). You can describe, in 10 minutes, where the actors are, how supervision is structured, and what would break first under load.

### Task 27: Payment ledger actor system with idempotency

**Problem.** Build a ledger where each `Account` is a persistent actor. Transactions arrive with a client-supplied `idempotencyKey`. Duplicates must be detected and the original result returned, not double-applied.

**Constraints.**
- Account actor is event-sourced (Task 18 pattern).
- Idempotency keys are stored alongside events; lookup is O(log n) or better.
- A `Transfer(from, to, amount, key)` is two-phase: deduct from source, credit destination, with a saga or transactional outbox so a crash mid-transfer doesn't lose money.
- The system survives a node crash mid-transfer.

**What "done" looks like.** You have a test that throws 10,000 transfers with random keys, kills the JVM/BEAM mid-test, restarts it, and verifies that (a) all account balances reconcile, (b) duplicates submitted post-recovery return the original result, (c) no money was created or destroyed. You can write a one-page explanation of why the saga/outbox guarantees atomicity across two actors that share no transaction. You can name the two failure modes you chose not to handle (e.g. Byzantine corruption) and justify the choice.

### Task 28: Thread-pool service → actors migration

**Problem.** Pick a real service you wrote (or a 500-line open-source service) that uses threads + locks. Migrate the contended hot path to actors. Measure latency and throughput before and after.

**Constraints.**
- The migration must be testable in isolation — do not rewrite the whole service.
- "Before" and "after" benchmarks use the same harness and load.
- Document one regression (actors are not always faster).

**What "done" looks like.** You have two flame graphs (before/after), a chart of p50/p95/p99 latency, and a written narrative covering: what shared state existed, how you partitioned it across actors, where the actor model added overhead, where it removed contention, and whether you'd recommend the migration to a teammate. Include a one-paragraph "what I'd do differently next time."

### Task 29: "Should we adopt actors?" decision memo

**Problem.** Imagine you joined a backend team using threads + queues + Postgres. They ask you whether to adopt an actor framework. Write a 1500-word memo with a recommendation, alternatives, and risks.

**Constraints.**
- The memo references specific aspects of *their* codebase (invent a plausible one if needed).
- It does not say "always" or "never." It says "in cases X, Y, with mitigations A, B."
- It lists the team-level costs: hiring, debugging, observability, on-call.

**What "done" looks like.** A senior engineer reading the memo cold can decide. The memo contains: 1-paragraph executive summary, 3-bullet problem statement, the current architecture in a small diagram, the actor-based alternative in a parallel diagram, a side-by-side cost matrix, three concrete migration risks, a 90-day pilot proposal, and a recommendation. No marketing language. No emoji. No "industry-leading."

### Task 30: Cross-runtime portfolio piece

**Problem.** Take the bank-account actor (Tasks 8, 18) and implement it in *three* runtimes: Erlang/OTP, Akka Typed, Tokio. Write a comparison that a hiring committee would respect.

**Constraints.**
- All three pass an identical black-box test suite.
- The comparison covers: lines of code, startup time, memory footprint, idiomatic message style.
- The repo has one `README` per impl plus one top-level comparison `README`.

**What "done" looks like.** A hiring manager skimming your repo sees: a one-page top-level README that summarizes the comparison and links to each impl. Each impl has 100-300 lines, builds with one command, runs the test suite with one command. The comparison README has a table (LOC, startup ms, RSS at idle, msgs/sec) and three short paragraphs on lessons learned. You can defend every cell of the table in interview conversation.

---

## Sample Solutions

The sketches below are not full programs — they show the *shape* of an answer. Resist looking at them until you've struggled with the task.

### Sample 1: Erlang `gen_server` ping-pong skeleton (Task 1)

```erlang
-module(pingpong).
-behaviour(gen_server).

%% API
-export([start/0, run/0]).

%% gen_server callbacks
-export([init/1, handle_call/3, handle_cast/2, handle_info/2,
         terminate/2, code_change/3]).

-record(state, {role :: ping | pong, peer :: pid() | undefined, count = 0}).

run() ->
    {ok, PongPid} = gen_server:start_link(?MODULE, {pong, undefined}, []),
    {ok, _}       = gen_server:start_link(?MODULE, {ping, PongPid},    []),
    timer:sleep(2000).

init({pong, _}) ->
    {ok, #state{role = pong}};
init({ping, PongPid}) ->
    gen_server:cast(self(), start),
    {ok, #state{role = ping, peer = PongPid}}.

handle_cast(start, S = #state{role = ping, peer = Pong}) ->
    gen_server:cast(Pong, {ping, self()}),
    {noreply, S};

handle_cast({ping, From}, S = #state{role = pong}) ->
    gen_server:cast(From, {pong, self()}),
    {noreply, S};

handle_cast({pong, _From}, S = #state{role = ping, count = N, peer = Pong})
    when N < 1000 ->
    gen_server:cast(Pong, {ping, self()}),
    {noreply, S#state{count = N + 1}};

handle_cast({pong, _}, S = #state{role = ping}) ->
    {stop, normal, S}.

handle_call(_, _From, S) -> {reply, ok, S}.
handle_info(_, S)        -> {noreply, S}.
terminate(_, _)          -> ok.
code_change(_, S, _)     -> {ok, S}.
```

### Sample 2: Akka Typed echo `Behavior` (Task 2)

```scala
import akka.actor.typed.{ActorRef, ActorSystem, Behavior}
import akka.actor.typed.scaladsl.Behaviors

object Echo {
  sealed trait Cmd
  final case class Say(text: String, replyTo: ActorRef[Echoed]) extends Cmd

  final case class Echoed(text: String)

  def apply(): Behavior[Cmd] = Behaviors.receiveMessage { case Say(t, r) =>
    r ! Echoed(s"echo: $t")
    Behaviors.same
  }
}

object Main extends App {
  sealed trait Cmd
  final case class Tick(text: String)  extends Cmd
  final case class Wrap(e: Echo.Echoed) extends Cmd

  val root: Behavior[Cmd] = Behaviors.setup { ctx =>
    val echo    = ctx.spawn(Echo(), "echo")
    val adapter = ctx.messageAdapter[Echo.Echoed](Wrap)
    (1 to 5).foreach(i => ctx.self ! Tick(s"hi-$i"))

    Behaviors.receiveMessage {
      case Tick(t)         => echo ! Echo.Say(t, adapter); Behaviors.same
      case Wrap(Echo.Echoed(s)) => ctx.log.info(s); Behaviors.same
    }
  }

  ActorSystem(root, "echo-system")
}
```

### Sample 3: Round-robin router (Task 11)

```scala
import akka.actor.typed.{ActorRef, Behavior}
import akka.actor.typed.scaladsl.Behaviors

object Worker {
  sealed trait Cmd
  final case class Job(id: Int, replyTo: ActorRef[Done]) extends Cmd
  final case class Done(id: Int)

  def apply(): Behavior[Cmd] = Behaviors.receiveMessage { case Job(id, r) =>
    Thread.sleep(50) // simulated CPU work
    r ! Done(id)
    Behaviors.same
  }
}

object Router {
  sealed trait Cmd
  final case class Dispatch(id: Int, replyTo: ActorRef[Worker.Done]) extends Cmd

  def apply(n: Int): Behavior[Cmd] = Behaviors.setup { ctx =>
    val workers: IndexedSeq[ActorRef[Worker.Cmd]] =
      (0 until n).map(i => ctx.spawn(Worker(), s"w-$i"))
    routing(workers, idx = 0)
  }

  private def routing(workers: IndexedSeq[ActorRef[Worker.Cmd]], idx: Int): Behavior[Cmd] =
    Behaviors.receiveMessage { case Dispatch(id, r) =>
      workers(idx) ! Worker.Job(id, r)
      routing(workers, (idx + 1) % workers.size)
    }
}
```

### Sample 4: Supervisor strategy (Task 9)

```scala
import akka.actor.typed.{Behavior, SupervisorStrategy}
import akka.actor.typed.scaladsl.Behaviors
import scala.concurrent.duration._

object SupervisedAccount {
  def apply(initialBalance: Long): Behavior[BankAccount.Cmd] =
    Behaviors
      .supervise(BankAccount(initialBalance))
      .onFailure[RuntimeException](
        SupervisorStrategy
          .restart
          .withLimit(maxNrOfRetries = 3, withinTimeRange = 10.seconds)
      )
}

// Usage in parent:
//   ctx.spawn(SupervisedAccount(0L), "account-A1")
//
// What this gives you:
//   - on RuntimeException, restart the child with initialBalance
//   - if 3 restarts happen within 10s, escalate to the parent's supervisor
//   - state is reconstructed from `initialBalance` (or from a journal in Task 18)
```

---

## Closing

Re-implement at least Tasks 8, 11, and 18 in a *second* runtime. The contrasts — Erlang's "let it crash" vs. Akka's typed contracts vs. Orleans' virtual actors vs. Tokio's handle pattern — are where senior engineers form opinions. Take notes on what surprised you in each.

If you can do all of these, you have the actor-model foundation a strong senior engineer would expect.

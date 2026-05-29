# Actor Model — Interview Questions

> **Topic:** [Actor Model](README.md)

---

## Introduction

The Actor Model is a foundational concurrency paradigm proposed by Carl Hewitt in 1973 and refined by Gul Agha and others. It treats independent computational entities called "actors" as the universal primitive: each actor has private state, a mailbox of incoming messages, and a behaviour that processes one message at a time. Interviews about the actor model can range from theory (the three axioms, location transparency, fairness guarantees) to ecosystem specifics (Erlang/OTP, Akka, Orleans, Pony, Tokio actors) to design (how do you build a chat platform, a saga, or an IoT shadow store on top of actors).

This document collects the questions that come up most frequently when senior backend, distributed systems, or platform engineers interview at companies that lean heavily on actors — fintechs running Erlang, telecoms on OTP, gaming companies using Orleans grains, JVM shops with Akka Typed, and Rust shops with custom actor crates. Every section includes answers, the reasoning behind them, and the traps inexperienced candidates fall into. Read it as a study guide, not a flashcard deck: the model rewards engineers who understand *why* it exists, not just how to call `gen_server:call/2`.

We assume the reader already knows the basics covered in the [README](README.md) and [specification](specification.md) and is preparing for a senior-level conversation where the interviewer probes failure semantics, back-pressure, supervision design, and trade-offs against shared-memory or CSP-style alternatives.

---

## Table of Contents

1. [Conceptual / Foundational](#conceptual--foundational)
2. [Framework-Specific](#framework-specific)
   - [Erlang / OTP](#erlang--otp)
   - [Akka (Classic + Typed)](#akka-classic--typed)
   - [Microsoft Orleans](#microsoft-orleans)
   - [Pony](#pony)
   - [Tokio Actors (Rust)](#tokio-actors-rust)
3. [Tricky / Trap Questions](#tricky--trap-questions)
4. [System / Design Scenarios](#system--design-scenarios)
5. [Coding Questions](#coding-questions)
6. [Behavioral / Experience](#behavioral--experience)
7. [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
8. [Cheat Sheet](#cheat-sheet)
9. [Further Reading](#further-reading)
10. [Related Topics](#related-topics)

---

## Conceptual / Foundational

### Q: What are the three axioms of the Actor Model as defined by Hewitt and Agha?

When it receives a message, an actor can do exactly three things, and those are the axioms. First, it can **send a finite number of messages** to other actors whose addresses it already knows. Second, it can **create a finite number of new actors**. Third, it can **designate the behaviour to be used for the next message** it receives — this is how state mutation is modelled without shared memory. The order of these three actions inside a single message handling is implementation-defined and they are conceptually concurrent. The crucial point is that there is no fourth axiom: an actor cannot read another actor's state, cannot block, and cannot wait for a response synchronously without modelling that wait as another message exchange. Internalising the axioms is the difference between using actors and merely importing an actor library.

### Q: What is the difference between `ask` (request/reply) and `tell` (fire-and-forget) in actor systems?

`tell` is the primitive operation: it puts a message in the recipient's mailbox and returns immediately without waiting for any reply. It maps directly onto Hewitt's axioms — the sender does not learn anything about the outcome and does not block. `ask` is a higher-level helper built on top of `tell`: the framework creates an ephemeral actor (or future) that owns a unique correlation id, sends the request, and completes a future when the matching response arrives. `ask` requires a timeout because the framework cannot know if the target will ever respond; without one a slow or crashed peer leaks futures and threads. Senior interviewers expect candidates to say "tell is the default, ask is the exception, and ask always carries a timeout in production." Confusing the two is a leading cause of cascading failure in real systems.

### Q: Describe the standard supervision strategies and when you would choose each.

OTP and Akka share four canonical strategies. **One-for-one** restarts only the failed child — use it when siblings are independent (e.g., per-connection handlers). **One-for-all** restarts every child when any one fails — use it when siblings share invariants and partial state would be inconsistent (a connection pool plus its monitor). **Rest-for-one** restarts the failed child and every child started after it — use it for pipelines where downstream stages depend on upstream initialisation order. **SimpleOneForOne** (OTP) / dynamic supervisors (Akka) handle a homogeneous pool of dynamically spawned workers; restarts target the individual that failed without touching the others. The choice is driven by the *failure dependency graph* of your children, not their numbers. A weaker dimension is the restart intensity (max restarts per period); set too high and you mask bugs, too low and a transient blip kills the subtree.

### Q: Why does Erlang/OTP advocate "let it crash" rather than defensive programming?

The philosophy rests on three observations. First, the surface area of "expected" errors is tiny compared to the universe of unexpected ones; trying to write `try/catch` for every conceivable failure produces code dominated by error handling that is itself buggy. Second, an actor that has reached an inconsistent state cannot reliably recover in-process — its locals, ETS tables, and message queue may all be corrupted. Third, a fresh restart from a known-good state, supervised, is almost always cheaper than convoluted recovery code. Crashing is fast, deterministic, and observable. "Let it crash" only works because the runtime supplies isolation (one actor's crash cannot corrupt another), supervision (a parent restarts the child with known initial state), and small actors (the blast radius of a restart is bounded). Outside that ecosystem the slogan can backfire badly.

### Q: How does the actor model differ from CSP (Communicating Sequential Processes)?

CSP, popularised by Go's goroutines and channels, treats *channels* as first-class and processes as second-class — multiple processes can share a channel and communication is rendezvous-based (unbuffered) or buffered. The actor model inverts this: *actors* are first-class and addresses are the primitive; each actor owns exactly one mailbox and the channel is implicit. CSP encourages "share by communicating" using anonymous channels; actors encourage "name your recipient." Practical consequences: actors integrate naturally with location transparency (an address can refer to a remote actor on another node) because the mailbox is per-actor, while channels are usually local. CSP makes select/multi-channel reasoning easy; actors make supervision and lifecycle reasoning easy. Neither is strictly more expressive — you can simulate one in the other — but their idioms differ.

### Q: What are virtual actors (Orleans grains) and how do they differ from static actors?

In a classical actor system (Akka, Erlang) actors must be explicitly created and explicitly stopped; their lifetime is your responsibility and a reference to a stopped actor is "dead." Virtual actors, pioneered by Microsoft Orleans, invert this: every grain exists *logically* forever and is uniquely identified by a primary key (often a GUID or composite key). The runtime activates a grain on demand on some silo, deactivates it after idle timeout, and re-activates it transparently on the next call. Callers never reason about lifecycle; they call `GrainFactory.GetGrain<IUser>(userId)` and the runtime handles placement, activation, and (with persistence) state restoration. The trade-off is reduced control: you cannot easily put two grains on the same node, and message ordering across activations is weaker. Virtual actors trade fine-grained control for operational simplicity, which is the right trade for many business workloads.

### Q: What is the difference between typed and untyped actors, and why does it matter?

Untyped actors (Akka Classic, Erlang processes) accept `Any` messages; the actor pattern-matches inside its receive block and a sender can ship literally anything. Typed actors (Akka Typed, Pony, recent Orleans) require the message type to be part of the actor's type, so a `Behavior<Command>` can only receive `Command` values. The compiler catches mistakes that would otherwise become silent unhandled-message warnings at 3 a.m. Typing also lets the type system express protocols — replying with the wrong message type becomes a compile error. The downside is that typed actors require more upfront design: introducing a new message means widening the command ADT and recompiling. In senior interviews, expressing a clear preference (typed for new systems, untyped for legacy) and justifying it earns points.

### Q: Explain mailbox semantics: ordering, fairness, and bounded vs unbounded.

A mailbox is a per-actor queue; the runtime guarantees that messages from a single sender to a single receiver are delivered in send order (point-to-point FIFO). There is *no* global ordering between different sender/receiver pairs. Fairness is "weak fair": the scheduler eventually processes every message in every mailbox, but provides no deadline. Mailboxes can be unbounded (the default, easiest but allows OOM) or bounded (with overflow policies: drop new, drop old, drop head, fail, or back-pressure). Bounded mailboxes are essential anywhere the system has a public ingress, otherwise a hot actor can be drowned by a faster producer and consume all heap. Specialised mailboxes — priority, stash, control-aware — let high-priority messages skip ahead, but require careful invariant analysis.

### Q: How does event sourcing / persistence integrate with actors?

Persistent actors (Akka Persistence, Orleans persistence, OTP's `persistent_term` plus disk_log patterns) treat the actor's state as a fold over an event log. The actor handles a command, validates it, produces zero or more events, persists them atomically, and only then applies them to its in-memory state. On recovery the runtime replays the event log to rebuild state before the actor accepts new commands. The pattern lines up beautifully with the actor's single-threaded execution: you do not need transactions across mailbox boundaries because events are local to one actor. Snapshots compact the replay length. The trade-offs are event schema evolution (you can never lose backward compatibility), longer recovery times for large actors, and the need for a journal store that handles back-pressure under load.

### Q: What are OTP behaviours and why are they significant?

A behaviour in OTP is a generic, well-tested pattern (a typeclass-ish abstraction) that you parameterise with callback functions for your specific logic. The classic ones are `gen_server` (a request/reply server), `gen_statem` (an explicit state machine, replacing `gen_fsm`), `gen_event` (a fan-out of handlers), and `supervisor` (the supervision tree). They standardise concerns most engineers get wrong: matching synchronous calls to replies, timer handling, system messages, code change hooks, and graceful shutdown. The cultural impact is the bigger story: by codifying these patterns Joe Armstrong and the OTP team established a shared vocabulary that lets Erlang shops review each other's code instantly. Equivalents exist in Akka (Behaviors, FSM, Persistence) and Orleans (grain interfaces, reminders) but none have the same monolithic blessing.

### Q: How does hot code reload work in Erlang and why is it hard to replicate elsewhere?

Erlang's BEAM VM keeps two versions of each loaded module — current and old — in memory simultaneously. When a process is between messages, a fully-qualified call (`?MODULE:loop(State)`) jumps to the current version, which transparently picks up the new code; local calls keep running the old version until the next external hop. Old code is purged only when no process references it. Hot reload requires that the language semantics support code as a first-class loadable artefact, that calls can be late-bound at the call site, and that state migration hooks exist (`code_change/3` for `gen_server`). The JVM has class loading but module-level rebinding is fragile; Go and Rust have no story at all because they bake call targets into machine code. Erlang's design choices — small modules, message passing between calls, immutable state — make hot reload possible and useful for telecom-grade uptime.

### Q: How do you implement back-pressure in actor systems?

The naive answer "use a bounded mailbox" is necessary but not sufficient. Once the mailbox fills you must decide what to do: dropping silently corrupts business semantics, blocking the sender violates the actor model's non-blocking property. The robust pattern is *credit-based flow control* or *reactive streams*: the consumer publishes a credit count and the producer never sends more than that credit. Akka Streams, Orleans streaming, and Erlang's `gen_statem` with timeouts all implement variants. A second pattern is *demand-based polling*: the slow consumer asks for the next batch and the producer never pushes unsolicited. A third is *circuit-breaking*: route messages around the saturated actor for a cool-down window. Senior candidates should know that mailbox bounds without flow control just move the OOM upstream rather than solving it.

### Q: Are actors a good model for CPU-bound work?

Mostly no. Actors excel at coordinating I/O-bound, latency-sensitive, fault-isolated work. CPU-bound work pinned to one actor saturates a single core because the actor is single-threaded by definition; spawning N parallel workers and round-robining work between them is the actor-friendly answer, but at that point you are using actors as a thin shell over a thread pool. Frameworks like Akka encourage you to put CPU-heavy work on a dedicated dispatcher and explicitly back-pressure the producers feeding it. Pony tries harder by tagging the actor with object capabilities so the compiler can reorder work safely. The honest interview answer is "actors give you concurrency, not parallelism, for free; for CPU-bound work I would use a worker pool sharded by input range or by hash, with each shard being an actor."

### Q: What is location transparency and what are its limits?

Location transparency means a sender does not have to know whether a target actor lives in the same process, on another node, or on another data centre — the send API is identical. The address abstracts the path; the runtime handles serialisation, networking, and retries. This enables clean distributed designs without leaking infra into every call site. The limits are real though: local sends are nanoseconds and reliable, remote sends are milliseconds and may fail. Treating them as truly equivalent is the source of countless production incidents. The mature interpretation is *location transparency for API design, location awareness for performance and failure handling*: write code that compiles against either, but instrument and reason about latency where it matters.

---

## Framework-Specific

### Erlang / OTP

### Q: What is the difference between `gen_server:call` and `gen_server:cast`?

`call/2,3` is synchronous request/reply: the caller blocks until the callee responds or the timeout (default 5 s) fires, in which case `call` throws `exit({timeout, _})`. Under the hood it sends a `'$gen_call'` tuple with a monitor reference and waits for either the reply or a `DOWN` message. `cast/2` is fire-and-forget: it sends `'$gen_cast'` and returns `ok` immediately regardless of mailbox length or process liveness. `call` integrates with supervision because the timeout exception propagates; `cast` is invisible to back-pressure. The rule of thumb is "default to `call` for correctness, switch to `cast` after measuring that the consumer is genuinely independent." Misusing `cast` for high-volume writes creates silent message loss that surfaces only as customer complaints.

### Q: What is a linked process vs a monitored process?

A *link* is a bidirectional failure relationship: if either process exits abnormally, the other gets an exit signal and, unless trapping exits, also dies. Links are the substrate of supervision trees. A *monitor* is unidirectional and benign: the monitor receives a `DOWN` message when the monitored process exits but is not killed itself. Use links for components whose lifetimes are bound together (a server and its private cache). Use monitors for transient observation (a one-off `ask` pattern, a registry watching a worker). Linking is symmetric and survives across nodes; monitoring is asymmetric and is the right primitive for "let me know when you die" without coupling lifecycles.

### Q: What does `process_flag(trap_exit, true)` do and when do you need it?

A supervisor or any process that wants to handle the death of linked processes gracefully sets `trap_exit` to true. After that, exit signals are converted into `{'EXIT', Pid, Reason}` messages and delivered to the trapping process's mailbox instead of killing it. Supervisors trap exits so they can implement their restart strategy. Worker processes generally do *not* trap exits — they should crash and let the supervisor restart them. Setting `trap_exit` in a worker is a common antipattern: the worker swallows the failure that supervision was supposed to handle, and the supervisor never sees the crash.

### Q: How does `gen_statem` improve on `gen_fsm`?

`gen_fsm` (deprecated) treated states as named callbacks where you switched on the state name to dispatch. `gen_statem` generalises this with two modes — *state functions* (one callback per state, idiomatic) and *handle event* (a single callback that dispatches on state and event). It supports *postpone* (defer an out-of-order event until a state transition), *state timeouts* (a timeout local to a state, automatically cancelled on transition), *generic timeouts* (named cancellable timers), and *call/cast/info* uniformly. It also supports complex state structures (not just an atom) and integrates with code change. For non-trivial protocols — connection state machines, payment flows, device shadow logic — `gen_statem` is the right primitive and `gen_server` is a brittle stand-in.

### Q: Explain Erlang's "selective receive" and the performance pitfall it can introduce.

A `receive` block can match a subset of patterns; messages that do not match are left in the mailbox and re-examined on the next receive. This is enormously expressive — you can implement RPC correlation, priority handling, or staged protocols straightforwardly. The trap is the *selective receive scan*: if the mailbox is large and your receive pattern is rare, BEAM walks the entire mailbox on every receive looking for a match, turning what should be O(1) into O(N) and degrading the whole VM. Mitigations are receive markers (since OTP 24, `erlang:make_ref` plus pattern guard automatically optimises common reply patterns), draining the mailbox to a private queue, or restructuring the protocol to use small dedicated processes per request.

### Akka (Classic + Typed)

### Q: What changed between Akka Classic and Akka Typed?

Akka Typed redefines an actor as a `Behavior[Command]` instead of an untyped `Receive: PartialFunction[Any, Unit]`. The `ActorContext` is passed explicitly to the behaviour rather than being available as a mutable instance variable, making the actor's logic a pure function from current behaviour plus message to next behaviour. `sender()` no longer exists — if you want a reply path, the protocol must include a `replyTo: ActorRef[Response]` field. Supervision is no longer "always restart by default"; it must be declared via `Behaviors.supervise`. The `ActorSystem[T]` itself is typed with a root behaviour. The result is much stricter compile-time guarantees, fewer runtime surprises, and forced explicit protocol design.

### Q: What is `Behaviors.setup` vs `Behaviors.receive`?

`Behaviors.setup` is the constructor: it gets the `ActorContext` and returns the initial behaviour. Use it for initialisation that needs the context — spawning children, scheduling timers, registering with the receptionist. `Behaviors.receive` (or `receiveMessage`) defines how to handle each incoming message and returns the next behaviour. The separation enforces a clean distinction between "what happens once when this actor starts" and "what happens for every message." A common Typed pattern is `Behaviors.setup { ctx => Behaviors.receiveMessage { msg => ... } }`. Conflating the two — for example calling `ctx.spawn` inside `receiveMessage` — works but signals that the actor's startup cost is not amortised.

### Q: How do you implement supervision in Akka Typed?

Wrap the child's behaviour with `Behaviors.supervise(childBehavior).onFailure[Throwable](SupervisorStrategy.restart)`. Strategies include `stop`, `resume`, `restart`, `restartWithBackoff(minBackoff, maxBackoff, randomFactor)`, and `restart.withLimit(maxRestarts, within)`. You can compose multiple `.onFailure[SpecificException](...)` layers to give different exception types different strategies. Crucially, in Akka Typed the parent does *not* automatically restart children on failure — you must opt in. This is a deliberate change from Classic to make supervision policy explicit and reviewable. Backoff supervision is the right default for actors that talk to external resources (DBs, HTTP services) so retries do not stampede.

### Q: What is the receptionist and why does it exist?

In Typed, you can no longer look up actors by string path because that breaks type safety. The Receptionist is the typed registry: actors `Register` themselves under a typed `ServiceKey[Command]` and clients `Find` by the same key to get an `ActorRef[Command]` (or a `Listing` of refs). It is cluster-aware, so a registration on one node propagates to all nodes via gossip. The receptionist replaces the Classic pattern of resolving by `system.actorSelection("/user/foo")` and is the recommended way to discover actors that need to be addressed by role rather than known reference, including in clustering and sharding.

### Q: How does cluster sharding work and what problem does it solve?

Cluster Sharding partitions a large population of entity actors (think "user 12345" or "order 98765") across the cluster, automatically rebalancing as nodes join and leave. The application defines a `extractEntityId` and `extractShardId` function that route messages to the right entity and shard. The runtime activates an entity on demand (similar to Orleans grains), passivates idle ones, and handles handoff during rebalancing. It solves the problem of scaling to millions of entity actors where you cannot pin every entity to a known node. Persistence integrates so an entity's state is restored on activation. The major operational concern is *rolling upgrades during rebalance*; passivation and remembered entities must be tested under churn.

### Microsoft Orleans

### Q: What is a grain in Orleans and how is its lifecycle managed?

A grain is a virtual actor: a uniquely identifiable, single-threaded, in-memory object whose existence is logical. Clients address grains by a typed interface plus a primary key (`GrainFactory.GetGrain<IUser>(userId)`); the runtime decides which silo activates the grain and creates the instance lazily on the first call. Idle grains are deactivated after a configurable timeout (default 2 hours) and their state is lost unless persisted via grain state interfaces. Grains never appear dead to callers — the next call simply triggers reactivation. This makes lifecycle management completely transparent to application code at the cost of weaker control over placement and ordering.

### Q: What are grain reminders and how do they differ from timers?

A *timer* fires on the current activation of the grain and is lost when the grain deactivates; it is suitable for transient in-activation work like polling or local timeouts. A *reminder* is a persistent durable schedule managed by the cluster: it triggers the grain even if it is currently deactivated (the runtime activates it to deliver the reminder) and survives silo restarts. Reminders are appropriate for business-level recurring work — daily summary generation, retry of a stuck saga, periodic snapshot — while timers are for fine-grained in-call timing. Reminders have a minimum period (typically one minute) because their backing store is not designed for sub-second precision.

### Q: How does single-threaded execution within a grain protect state?

The Orleans runtime guarantees that only one call into a grain executes at a time, and the runtime suspends the activation between awaits inside an async method too (turn-based). This means a grain's instance fields are safe from concurrent access without locks. The trap is that *between* awaits another message can interleave, so any invariant that spans an await must be re-validated; the grain is conceptually "interleaved single-threaded." The `[Reentrant]` attribute relaxes this for performance-sensitive read-heavy grains, but introduces classical race conditions and is almost never the right choice for grains owning business state.

### Q: How does Orleans handle persistence and event sourcing?

Persistence comes in two flavours. The simple model — `Grain<TState>` — auto-snapshots the entire state on `WriteStateAsync()` and reloads on activation; the backing store can be any plugin (Azure Tables, ADO.NET, Redis, custom). The advanced model — Event-Sourced Grains via `JournaledGrain<TState, TEvent>` — appends events to a log, replays them on activation, and exposes `RaiseEvent(event)` for command handling. Event sourcing is preferable for grains with regulatory audit needs, complex history, or projection requirements. The persistence layer is pluggable so you can swap stores without changing grain code, though the migration path between stores is not automatic and remains an operational task.

### Q: What is the cost of a remote grain call vs a local one?

A local grain call (target grain activated on the same silo as the caller) is roughly a method dispatch with some scheduling overhead — single-digit microseconds. A remote call goes through serialisation (Orleans 7 uses its own high-throughput binary serialiser), network transport, deserialisation on the other side, scheduling, and the reverse path for the response — typically tens to hundreds of microseconds on a healthy LAN. Orleans never exposes whether a call is local or remote, which is location transparency, but performance-sensitive code paths should design for the remote case. Co-location strategies (preferred placement) and grain colocation help when two grains chat heavily; otherwise design the protocol to minimise round trips.

### Pony

### Q: What are reference capabilities in Pony and how do they enable safe actor messaging?

Pony's type system has six reference capabilities — `iso`, `trn`, `ref`, `val`, `box`, `tag` — that describe the aliasing and mutability of references. The compiler enforces that data sent across actor boundaries cannot create a data race: `iso` (isolated, the only reference) and `val` (immutable, shared aliases allowed) are sendable; `ref` (mutable, local-only) is not. This lets actors share data by reference, not by deep copy, without sacrificing safety. The trade-off is a steep learning curve — getting capabilities right is much harder than `final` or `const` in mainstream languages, and Pony's adoption has stayed niche partly because of this complexity, even though the safety it buys is impressive.

### Q: How does Pony's garbage collector cooperate with the actor model?

Pony does not have a stop-the-world GC; each actor has its own private heap collected independently between messages. There is no shared heap because the capability system prevents shared mutable state, so a global GC pause is unnecessary. A separate *message-tracing GC* tracks ownership of objects that travel between actors so they can be reclaimed when no actor references them. The result is near-zero GC latency at the system level: an actor pauses for its own heap only when its mailbox is between messages, which is exactly when it would have been idle anyway. This design is a key argument for using Pony in latency-sensitive systems.

### Q: What is causal message delivery and does Pony guarantee it?

Pony guarantees *causal messaging*: if actor A sends m1 to B and then m2 to C, and B (on receiving m1) sends m3 to C, then C will see m3 only after m2 if there is a causal chain. This is stronger than per-pair FIFO and weaker than total ordering. It rules out many surprising bugs where the second message arrives before the "cause" of it. The implementation cost is bookkeeping per actor on send timestamps; the runtime pays it because Pony's value proposition is correctness. Most other actor systems do not give this guarantee, which is why Pony code can be reasoned about more locally.

### Q: How does the `behaviour` keyword differ from a regular method?

In Pony, methods declared with `be` (behaviour) are asynchronous and return immediately (the result is `None` and any work happens in the actor's mailbox processing). Methods declared with `fun` are synchronous. Only actors can have behaviours; classes have only functions. The syntax forces the developer to mark every async cross-actor call site explicitly. This is similar in spirit to Akka Typed's `ActorRef.tell` but is a first-class language feature with compile-time type checking on the arguments. The benefit is that you can never accidentally block in an actor — there is no synchronous remote call construct to misuse.

### Q: How does Pony's actor scheduler differ from Akka's?

Pony's scheduler is built into the runtime and uses work-stealing across a configurable number of scheduler threads (defaults to the number of cores). It processes batches of messages per actor before yielding, which improves cache locality, and uses CPU affinity tuning aggressively. Akka's scheduler runs on top of the JVM's executor abstractions and supports multiple dispatcher configurations; you can route actors to different dispatchers (default, blocking IO, pinned). Pony's tighter integration buys lower overhead but less flexibility; Akka's flexibility lets you isolate dispatcher pools for back-pressure but at the cost of more configuration. For pure throughput, Pony is hard to beat on the JVM/CLR side.

### Tokio Actors (Rust)

### Q: Why does Rust not have a single canonical actor framework like Akka?

Several reasons. First, Rust's ownership and borrow checker make many common actor footguns (data races, dangling references) compile errors, reducing the urgency for a framework-level safety net. Second, async/await in Rust is built on `Future` and channels, not actors, so the ecosystem default for concurrency is "spawn a task and pass messages through `mpsc`/`oneshot` channels." Third, the community has many small, opinionated crates (Actix, Xtra, Riker, Coerce, Ractor) but no winner has emerged because the trade-offs differ: Actix prioritises web-server use, Xtra prioritises ergonomics, Ractor mimics OTP. The senior take is that Rust actors are usually thin wrappers over Tokio tasks and channels with a strongly-typed message enum; pick the abstraction that matches your team's familiarity.

### Q: How would you implement a basic actor in plain Tokio without a framework?

Define a command enum, an actor struct holding state, an async `run` loop, and spawn it with `tokio::spawn` returning a handle that wraps a `mpsc::Sender<Command>`. The handle exposes typed methods (`async fn get(&self, key: K) -> V`) that send a `Command` carrying a `oneshot::Sender<Reply>` and await the reply. The actor loops on `rx.recv().await`, matches on the command, mutates state, and replies via the oneshot. Termination happens when all handles are dropped and `recv()` returns `None`. This pattern — Tokio task plus mpsc + oneshot — is idiomatic Rust actors and gets you most of Akka's value without a framework.

### Q: What is Actix and what makes it different?

Actix is one of the older Rust actor frameworks; its `actix-web` derivative is among the fastest HTTP servers ever benchmarked. It introduces `Actor`, `Handler<M>`, `Addr<A>`, and a custom mailbox executor. It was popular for web work but has been criticised for safety lapses (historical `unsafe` usage in flight) and for an API that does not always feel idiomatic next to modern Tokio. For new projects in 2024+, many teams use plain Tokio channels with a hand-rolled actor pattern, Xtra, or Ractor, reserving Actix mainly for legacy `actix-web` integrations.

### Q: How do you handle back-pressure with Tokio mpsc channels?

`mpsc::channel(capacity)` creates a bounded channel where `send().await` suspends the producer when the channel is full. This gives natural back-pressure: producers slow down to consumer pace. Use `try_send` if you want to fail fast or shed load. Critically, never use `mpsc::unbounded_channel` for cross-component messaging — it removes the only natural mechanism for back-pressure in Tokio and leads to unbounded memory growth under sustained load. The `tokio::sync::Semaphore` gives even finer control when you need to bound concurrency separately from queue depth.

### Q: How do you implement supervision in Rust actors?

Rust does not have OTP-style supervision out of the box. The common pattern is a supervisor task that owns the `JoinHandle` of each child, awaits them, and on completion (or panic, caught via `tokio::spawn` returning `JoinError`) decides to restart by re-spawning. State recovery is up to you. Frameworks like Ractor implement this more directly. The pragmatic position is "supervision in Rust is library code, not language runtime"; you build a small supervisor that owns the lifecycle of its children and you accept that the breadth and ergonomics of OTP supervision are not free.

---

## Tricky / Trap Questions

### Q: "We use `ask` everywhere instead of `tell` because it is more explicit." What is the production hazard?

The naive intuition is that `ask` is safer because the caller gets a response. The reality is that `ask` creates an ephemeral actor or future per call, allocates a correlation id, registers a timeout, and waits for either a reply or the timeout. Used heavily in a request hot path, `ask` (a) wastes allocations, (b) doubles the message volume, (c) introduces timeout tuning headaches, and (d) blocks the calling code path waiting on async returns. If you remove the timeout (or set it to a very large value) to "be patient," then a slow downstream stalls upstream actors, which fill their mailboxes and trigger cascading slowdowns. Reserve `ask` for synchronous-style entry points (HTTP handlers) and use `tell` plus an explicit `replyTo` in the protocol for actor-to-actor work.

### Q: "Our actor calls a blocking database driver inside its receive block. Why is throughput collapsing?"

Each actor processes one message at a time, on a thread provided by the dispatcher. A blocking call inside the receive block holds that thread for the whole I/O round trip. Because dispatchers are shared across many actors, a small number of slow actors can starve the pool: hundreds of other actors are queued behind the blocked threads and cannot make progress. The classical symptom is "throughput drops to roughly `threadCount / blockingLatency` regardless of total actor count." The fix is to either use the async driver (preferred), or pin blocking work to a dedicated dispatcher with its own thread pool, or wrap the work in a `Future` executed on a separate execution context and pipe the result back. Many production incidents come from a single innocent blocking call that no one noticed in code review.

### Q: "Our actor uses an unbounded mailbox and we crashed in production with OutOfMemory. Was the actor model at fault?"

The blame lies with the system design, not the model. Unbounded mailboxes default to "absorb whatever the producer sends," which in distributed systems means "OOM under load." When a downstream service slows, producers continue sending; messages pile up in the consumer's mailbox until the JVM heap is exhausted. The fix is *not* to make the mailbox a little larger; it is to add back-pressure: bounded mailbox plus an overflow policy (block, drop, or reject), or reactive streams credit-based flow, or a circuit breaker upstream. The deeper lesson is that any queue in any system needs an answer to "what happens when the producer is faster than the consumer for an extended period?" An unbounded mailbox simply postpones that question until the heap fills.

### Q: "We are using Akka Classic and `sender()` returns the wrong actor in our callback. Why?"

`sender()` in Akka Classic is dynamically scoped to the message currently being processed. If your actor starts an asynchronous operation (a `Future`, a database call, an HTTP request) and inside the `.onComplete` callback you invoke `sender() ! reply`, you are reading `sender()` long after the original message has been popped and possibly while a new message is being processed. The reference is unpredictable — sometimes the next sender, sometimes `deadLetters`. The fix is to capture `val replyTo = sender()` immediately and close over `replyTo` inside the callback. Akka Typed removes this trap entirely by demanding `replyTo` be a typed field in the message, which is one of the strongest arguments for migrating to Typed.

### Q: "We are sending messages to a `PoisonPill`-ed actor. What happens?"

After an actor receives `PoisonPill` (or a stop signal in Typed), its mailbox is drained and the actor stops. Subsequent messages to its `ActorRef` are forwarded to the system's dead-letter queue and logged once (`Akka.actor.warn-about-java-serializer-usage` and dead-letter throttling apply). The sender does not get an exception. If the sender expected a reply it will time out. The pitfall is that messages silently disappear and tests pass because the side effects you expected never occurred. Use `watch`/`Terminated` to be informed when a target actor stops, or use a service registry so references are invalidated, or rely on cluster sharding which makes "address" outlive any single activation.

### Q: "Our supervisor uses `OneForOneStrategy` with `maxRetries = 1000`. Why are users still seeing inconsistencies?"

A very high restart limit means the supervisor keeps restarting a child even when the underlying cause persists (corrupt config, full disk, bad migration). Each restart resets in-memory state to the constructor; if business logic depended on partial progress, that progress is lost. Worse, restart loops mask the alert that a human needs to investigate. The right strategy is a small `maxRetries` per window (3–5 per minute) combined with exponential backoff via `BackoffSupervisor`, plus alerting when the supervisor escalates. The supervisor's job is not to make failures invisible; it is to *isolate* them and *signal* them.

### Q: "We have one actor per database row for a 100M row table to maximise concurrency. Is this a good design?"

This is the classic *actor-per-row antipattern*. Each actor has overhead (mailbox, scheduler entry, supervision relationship); 100M actors will exhaust memory and overwhelm the scheduler regardless of how many do real work at any moment. Even with virtual actors / passivation (Orleans grains, Akka cluster sharding), the working set still has to fit, and rare-access rows churn through activations expensively. The right design is one actor per *aggregate* that the business cares about: a user, a session, a tenant, an order. Within the aggregate, the actor manipulates its private state including many rows. Use sharding to scale aggregates across nodes; do not turn every row into an actor.

### Q: "Our message handler does `Thread.sleep(100)` to throttle a downstream API. What is wrong?"

`Thread.sleep` inside an actor's receive block holds the dispatcher thread for the sleep duration; the actor and every other actor sharing that thread cannot process anything else. Even on a per-actor pinned dispatcher, the actor itself stops processing new messages including supervision signals. The correct approach is to schedule a deferred message (`context.system.scheduler.scheduleOnce`) or use an async `delay`, returning control immediately. Throttling should be done with a rate limiter actor or a token-bucket pattern that decouples send rate from arrival rate without blocking.

### Q: "We send messages of type `Object` because we want flexibility. Why is this fragile?"

Untyped messages are an explicit cost in maintainability and debugging. The compiler cannot reject a sender from shipping the wrong shape; the receiver must defensively match every type, and unmatched messages either crash, go to dead letters, or worst of all are silently logged. A schema change in the message payload becomes a runtime hazard that surfaces under uncommon production traffic. Even in Erlang, where typing is dynamic by design, the community settled on records and increasingly type specs (via Dialyzer) to recover the protection that statically typed actor systems get from the compiler. Use typed actors (Akka Typed, Orleans grain interfaces) or carefully designed message ADTs.

### Q: "Our actors form a cycle: A asks B, B asks C, C asks A. Why does the system deadlock?"

`ask` blocks the caller's logical thread of execution waiting for a reply, but the actor itself does *not* block — the reply arrives as another message. The deadlock pattern is when each actor's reply *requires* the other actor to be available to process the next request, and all three are waiting on each other. In Akka Classic, the symptom is that all three actors are mid-handle of an `ask`, holding ephemeral promise actors, and the futures complete only by timeout. The fix is to break the cycle by introducing a coordinator that the participants report into, or by using `tell` with explicit reply protocol and idempotent state, or by structuring the protocol so any node can make progress with cached state.

### Q: "We log every message into and out of every actor for debugging. Why did production fall over?"

Logging is I/O. At high message rates each log call serialises a structured event, formats it, and writes it to a sink that itself has back-pressure. The logger queue fills, threads block on log writes, the dispatcher chokes, mailboxes back up, latency explodes. In actor systems this happens fast because actor message volume is often orders of magnitude higher than HTTP request volume. The right approach is structured tracing with sampling (e.g., 1% of messages, 100% on a specific actor when investigating), high-cardinality metrics instead of per-message logs, and an async log appender with a bounded queue and explicit policy for what to do when full.

### Q: "We assumed message delivery is reliable inside our cluster. Why do we lose messages?"

Actor systems give you *at-most-once* delivery by default. Messages are not journaled, retries are not automatic, and a node crash between send and receive loses the in-flight message. Even within one VM, a stopped actor's pending messages go to dead letters silently. For reliable delivery you need either at-least-once via persistent actors with explicit acknowledgements and idempotent receivers, or a durable queue between sender and receiver (Kafka, persistent JMS). The lesson: location transparency does not imply delivery transparency.

### Q: "We do `Await.result(future, Duration.Inf)` inside an actor. What is wrong?"

This blocks the dispatcher thread for an unbounded time, effectively transferring the worst kind of synchronous I/O hazard into the actor system. Even if the future completes "soon," you have given up the actor model's non-blocking property. The actor cannot service supervision signals during the await. The correct pattern is `pipeTo(self)`: the future completes and pipes its result back as a message, allowing the actor to handle other messages in the meantime and resume processing once the result arrives.

### Q: "Our system sends a `Stop` message to an actor and immediately a follow-up `Work` message. Why is the work ignored?"

There is a subtle race: `Stop` is processed in mailbox order, but the actor might be terminating already when `Work` arrives, causing `Work` to be dispatched to dead letters. Even more subtly, in cluster sharding, the entity might be passivating and the follow-up message can race with the passivation, sometimes being delivered to a new activation with a different state. The fix is to model the protocol explicitly — drain on stop, acknowledge stop before allowing new work, or use a state machine that rejects new work after a stop signal but does not crash.

### Q: "An actor catches its own exception with `try/catch` to keep running. Why is this often wrong?"

Catching exceptions inside the actor swallows the very signal that supervision is designed to react to. The actor continues with potentially corrupt state, the supervisor never learns about the failure, and the bug accumulates over messages until a much harder-to-debug failure surfaces downstream. The disciplined approach is to catch only *expected, recoverable* business errors (e.g., a parse error you want to reply to the sender about) and let unexpected exceptions propagate so the supervisor can restart with a known-good initial state. "Let it crash" is precisely a refusal to do this defensive catching.

---

## System / Design Scenarios

### Q: Design a chat service for 10 million concurrent users using actors. Walk through the actor topology.

Use one actor per online user (a *UserSession* actor) responsible for that user's WebSocket and presence. Use one actor per chat room (a *RoomActor*) responsible for membership, message broadcast, and room metadata; route via cluster sharding so the room id determines the node. Use a *MessageStore* actor per partition for persistence, again sharded. The flow is: a user sends a message, the UserSession forwards it to the RoomActor for the target room, the RoomActor persists to the MessageStore (with at-least-once delivery), then fans out to UserSessions of online members and pushes to a notification queue for offline members. Bound mailboxes everywhere; use credit-based flow control between RoomActor and UserSessions for high-traffic rooms. Sticky session routing at the WebSocket gateway pins each user to a node where their UserSession lives. Persist room state via event sourcing so rebalancing is safe. Hot rooms (millions of members) need special handling — shard the broadcast itself across several worker actors per room.

### Q: Design a payment ledger as actors. How do you guarantee no double-spend?

Model each account as a persistent, sharded entity actor keyed by account id. A transfer is a command sent to the source account: it validates balance, persists a `DebitInitiated` event, then sends a typed message to the destination account asking it to credit. The destination persists `CreditApplied` and acknowledges. On ack, the source persists `DebitFinalised`. If the destination never acks, a saga manager retries with idempotency keys; failure beyond timeout triggers `DebitReversed`. Because each account is a single-threaded actor, balance checks and event persistence happen atomically per account — no shared lock is required. Cluster sharding handles horizontal scaling. The hard problems are cross-shard atomicity (handled via saga-style compensation), exactly-once delivery (handled via idempotency keys and persistent state), and audit (event-sourced log of every command and event). Avoid distributed transactions; embrace eventual consistency with explicit reconciliation.

### Q: Design an IoT device shadow service handling 50M devices. How do actors help?

Model each device as a virtual actor (Orleans grain or Akka cluster shard entity) keyed by device id. The actor holds the *reported state*, the *desired state*, and the *delta*. Incoming MQTT messages are routed to the device's actor, which updates reported state, persists, and triggers downstream events. Desired state updates flow the opposite way: an API call sets desired state on the actor, which pushes the delta to the connected device. Use passivation so cold devices (most of the 50M) consume no memory; active devices stay hot. Persistence backs both states. Time-series telemetry should *not* live in the actor — route it to a dedicated TSDB and let the actor hold only the latest snapshot. Bound mailboxes per actor and rate-limit per device id to prevent a misbehaving device from flooding its actor. Cluster sharding rebalances on node failure transparently.

### Q: Design a real-time leaderboard for a game with 100M players and per-second updates.

A naive design — one actor per player updating one global leaderboard actor — collapses under contention. The right design is hierarchical. Each player's score-changing event goes to a player actor, which validates and persists. The player actor publishes the new score to a sharded *RegionLeaderboard* actor (sharded by hash range of score or by player segment), maintaining a top-K within each shard via a heap. A *GlobalLeaderboard* actor merges the top-K from each shard on a tick (e.g., every 100 ms) and exposes a read API. For reads, query the GlobalLeaderboard's cached merge. The trick is that *no* single actor sees all writes, so write throughput scales with shard count. Approximate global ordering is acceptable for a leaderboard; perfect ordering would require coordination and is rarely a real product requirement.

### Q: Design a saga orchestrator for distributed transactions using actors.

A saga is a long-running state machine: each step is a forward action plus a compensating action. Model the saga itself as an actor (one per in-flight saga, sharded by saga id, persistent). The actor reads the current step, sends the appropriate command to the participant service (as another actor or via HTTP), awaits the reply with timeout, and either advances or initiates compensation. State changes are persisted as events so a crash recovers the saga at the right step. Use `gen_statem` in Erlang or Akka Typed FSM patterns. Retries with exponential backoff handle transient participant failure; idempotency keys protect against duplicates from retries. A separate supervisor monitors saga liveness and alerts when sagas stall beyond an SLO. The biggest risks are partial compensation (when a compensation itself fails, requiring manual intervention) and the temptation to share state across sagas — keep each saga self-contained.

### Q: Design multi-tenant routing where one cluster serves 10,000 isolated tenants with different SLAs.

Use sharding keyed by tenant id so messages for a tenant route to a deterministic node; co-locate the tenant's actors there to minimise cross-node chatter. Give each tenant a dedicated *TenantSupervisor* with a private dispatcher and bounded mailbox sized to that tenant's SLA. Premium tenants get larger dispatchers and priority mailboxes; free tenants share a small dispatcher pool that can be back-pressured aggressively. Monitor per-tenant metrics (mailbox depth, processing latency) and trigger throttling at the ingress gateway when a tenant exceeds quota. The hard part is preventing noisy-neighbour effects without forcing a hard per-tenant cluster: the dispatcher boundary plus mailbox bounds give software isolation; if SLAs require true hardware isolation, premium tenants need a dedicated cluster.

### Q: Design a fan-out pub/sub built on actors for a financial market data feed.

A *FeedIngest* actor receives market events from upstream; it shards by symbol to *SymbolActor* instances, each owning the latest snapshot and a list of subscriber refs. Subscribers (trader clients) send `Subscribe(symbol)` to a *SubscriptionRegistry* which forwards their ref to the right SymbolActor. On each tick the SymbolActor pushes to its subscribers. For very popular symbols (hundreds of thousands of subscribers), introduce a tree of broadcast actors so no single actor's mailbox saturates pushing. Use bounded mailboxes on subscribers and shed slow consumers (disconnect or buffer the latest snapshot only). Replay on reconnect comes from a separate journal. The key insight is that the actor model lets you implement fan-out at the granularity that matters — per symbol — and isolate failure to one symbol's subtree.

### Q: Design rate limiting per user across a distributed cluster using actors.

For *per-user* rate limiting, the user's entity actor is the natural choke point because all requests for that user are serialised through it (via sharding). The actor holds a token bucket; each incoming request decrements tokens, and the request is admitted, queued, or rejected. The token bucket refills via a timer or on-demand math against wall-clock time. For *global* rate limiting (across all users), one actor is the wrong place — it becomes a single hot point. Instead, distribute the budget across shards via a periodic reconciliation: each shard gets a budget proportional to its observed share of traffic, with rebalance every few seconds. The trade-off is approximate enforcement (you can over-admit briefly during rebalance) versus exact enforcement at the cost of coordination latency. Most rate limiters in production accept the approximation.

---

## Coding Questions

### Q: Implement a minimal `gen_server` skeleton in Erlang that maintains a counter and supports increment, decrement, and get.

```erlang
-module(counter).
-behaviour(gen_server).

%% API
-export([start_link/0, increment/0, decrement/0, get/0, stop/0]).

%% gen_server callbacks
-export([init/1, handle_call/3, handle_cast/2,
         handle_info/2, terminate/2, code_change/3]).

-record(state, {value = 0 :: integer()}).

start_link() ->
    gen_server:start_link({local, ?MODULE}, ?MODULE, [], []).

increment() -> gen_server:cast(?MODULE, increment).
decrement() -> gen_server:cast(?MODULE, decrement).
get()       -> gen_server:call(?MODULE, get).
stop()      -> gen_server:stop(?MODULE).

init([]) ->
    {ok, #state{}}.

handle_call(get, _From, State = #state{value = V}) ->
    {reply, V, State}.

handle_cast(increment, State = #state{value = V}) ->
    {noreply, State#state{value = V + 1}};
handle_cast(decrement, State = #state{value = V}) ->
    {noreply, State#state{value = V - 1}}.

handle_info(_Msg, State) ->
    {noreply, State}.

terminate(_Reason, _State) -> ok.
code_change(_OldVsn, State, _Extra) -> {ok, State}.
```

Discussion points: `cast` for fire-and-forget writes keeps callers non-blocking; `call` for reads gives strong consistency at the cost of latency; the named registration `{local, ?MODULE}` makes the API ergonomic but precludes multiple instances; `code_change/3` is the hook for hot reload state migration.

### Q: Implement an echo actor in Akka Typed (Scala) with a reply protocol.

```scala
import akka.actor.typed._
import akka.actor.typed.scaladsl._

object Echo {
  sealed trait Command
  final case class Echo(message: String, replyTo: ActorRef[Reply]) extends Command
  case object Stop extends Command

  final case class Reply(message: String)

  def apply(): Behavior[Command] = Behaviors.receive { (ctx, cmd) =>
    cmd match {
      case Echo(msg, replyTo) =>
        ctx.log.debug("Echoing {}", msg)
        replyTo ! Reply(msg)
        Behaviors.same
      case Stop =>
        Behaviors.stopped
    }
  }
}

object Main extends App {
  val system = ActorSystem(Behaviors.setup[Echo.Reply] { ctx =>
    val echo = ctx.spawn(Echo(), "echo")
    echo ! Echo.Echo("hello", ctx.self)
    Behaviors.receiveMessage { reply =>
      ctx.log.info("got reply: {}", reply.message)
      Behaviors.stopped
    }
  }, "echo-system")
}
```

Discussion: the `replyTo: ActorRef[Reply]` is explicit in the protocol, not a hidden `sender()`. `Behaviors.same` keeps the behaviour unchanged; `Behaviors.stopped` ends the actor. The compiler will refuse to compile if the response type does not match `Reply`, eliminating a whole class of runtime errors.

### Q: Implement an Orleans grain that maintains a bank account balance with persistence.

```csharp
public interface IAccountGrain : IGrainWithGuidKey
{
    Task<decimal> GetBalanceAsync();
    Task<bool> DepositAsync(decimal amount);
    Task<bool> WithdrawAsync(decimal amount);
}

[Serializable, GenerateSerializer]
public class AccountState
{
    [Id(0)] public decimal Balance { get; set; }
}

public class AccountGrain : Grain, IAccountGrain
{
    private readonly IPersistentState<AccountState> _state;

    public AccountGrain(
        [PersistentState("account", "accountStore")] IPersistentState<AccountState> state)
    {
        _state = state;
    }

    public Task<decimal> GetBalanceAsync() =>
        Task.FromResult(_state.State.Balance);

    public async Task<bool> DepositAsync(decimal amount)
    {
        if (amount <= 0) return false;
        _state.State.Balance += amount;
        await _state.WriteStateAsync();
        return true;
    }

    public async Task<bool> WithdrawAsync(decimal amount)
    {
        if (amount <= 0 || _state.State.Balance < amount) return false;
        _state.State.Balance -= amount;
        await _state.WriteStateAsync();
        return true;
    }
}
```

Discussion: `IGrainWithGuidKey` chooses the primary key shape; `IPersistentState<T>` injects a state container backed by the `accountStore` provider configured at silo startup. Single-threaded execution within the grain ensures that the read-modify-write of balance is atomic without explicit locks. `WriteStateAsync` is awaited so the grain only acknowledges success after persistence.

### Q: Implement an Erlang supervisor with `one_for_one` strategy for two worker children.

```erlang
-module(my_sup).
-behaviour(supervisor).

-export([start_link/0, init/1]).

start_link() ->
    supervisor:start_link({local, ?MODULE}, ?MODULE, []).

init([]) ->
    SupFlags = #{strategy => one_for_one,
                 intensity => 5,    % up to 5 restarts...
                 period => 60},     % ... per 60 seconds
    ChildSpecs = [
        #{id => worker_a,
          start => {worker_a, start_link, []},
          restart => permanent,
          shutdown => 5000,
          type => worker,
          modules => [worker_a]},
        #{id => worker_b,
          start => {worker_b, start_link, []},
          restart => permanent,
          shutdown => 5000,
          type => worker,
          modules => [worker_b]}
    ],
    {ok, {SupFlags, ChildSpecs}}.
```

Discussion: `intensity` plus `period` define the restart budget; exceeding it causes the supervisor itself to terminate so the next layer up can react. `shutdown => 5000` gives each child 5 seconds to clean up before being killed. `restart => permanent` means restart on any termination; alternatives are `transient` (restart only on abnormal exit) and `temporary` (never restart).

### Q: Implement a finite state machine using `become` in Akka Classic for a traffic light.

```scala
import akka.actor.{Actor, ActorSystem, Props}

class TrafficLight extends Actor {
  case object Next

  def receive: Receive = red

  def red: Receive = {
    case Next =>
      println("RED -> GREEN")
      context.become(green)
  }

  def green: Receive = {
    case Next =>
      println("GREEN -> YELLOW")
      context.become(yellow)
  }

  def yellow: Receive = {
    case Next =>
      println("YELLOW -> RED")
      context.become(red)
  }
}

object Demo extends App {
  val system = ActorSystem("traffic")
  val light = system.actorOf(Props[TrafficLight](), "light")
  (1 to 5).foreach(_ => light ! "Next")
}
```

Discussion: `context.become(newReceive)` is the runtime implementation of Hewitt's "designate the next behaviour" axiom. Each state is a distinct `Receive` partial function, so messages relevant only to one state are naturally filtered. Unhandled messages in a state go to dead letters (or `unhandled`), making protocol errors visible. In Akka Typed, the same FSM is expressed by returning a different `Behavior` from each handler — the same idea with explicit types.

### Q: Implement a Tokio actor in Rust that maintains a hash map cache with bounded mailbox.

```rust
use std::collections::HashMap;
use tokio::sync::{mpsc, oneshot};

#[derive(Debug)]
enum Command {
    Get { key: String, reply: oneshot::Sender<Option<String>> },
    Set { key: String, value: String, reply: oneshot::Sender<()> },
    Stop,
}

struct CacheActor {
    state: HashMap<String, String>,
    rx: mpsc::Receiver<Command>,
}

impl CacheActor {
    async fn run(mut self) {
        while let Some(cmd) = self.rx.recv().await {
            match cmd {
                Command::Get { key, reply } => {
                    let _ = reply.send(self.state.get(&key).cloned());
                }
                Command::Set { key, value, reply } => {
                    self.state.insert(key, value);
                    let _ = reply.send(());
                }
                Command::Stop => break,
            }
        }
    }
}

#[derive(Clone)]
pub struct CacheHandle {
    tx: mpsc::Sender<Command>,
}

impl CacheHandle {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel(1024); // bounded mailbox
        let actor = CacheActor { state: HashMap::new(), rx };
        tokio::spawn(actor.run());
        Self { tx }
    }

    pub async fn get(&self, key: String) -> Option<String> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx.send(Command::Get { key, reply: reply_tx }).await.ok()?;
        reply_rx.await.ok().flatten()
    }

    pub async fn set(&self, key: String, value: String) {
        let (reply_tx, reply_rx) = oneshot::channel();
        if self.tx.send(Command::Set { key, value, reply: reply_tx }).await.is_ok() {
            let _ = reply_rx.await;
        }
    }
}
```

Discussion: the channel capacity of 1024 gives back-pressure — `send().await` suspends if the actor is behind. The handle is `Clone` because `mpsc::Sender` is `Clone`, giving us cheap producer references. The actor terminates when all handles are dropped (the channel closes) or on explicit `Stop`. This is the idiomatic Rust actor pattern and runs at very high throughput with no framework dependency.

### Q: Implement a stop-watch actor with timer scheduling in Akka Typed.

```scala
import akka.actor.typed._
import akka.actor.typed.scaladsl._
import scala.concurrent.duration._

object StopWatch {
  sealed trait Command
  case object Start extends Command
  case object Stop extends Command
  private case object Tick extends Command

  def apply(): Behavior[Command] = idle(0L)

  def idle(elapsedMs: Long): Behavior[Command] =
    Behaviors.receive { (ctx, cmd) =>
      cmd match {
        case Start =>
          Behaviors.withTimers { timers =>
            timers.startTimerAtFixedRate("tick", Tick, 1.second)
            running(elapsedMs, timers)
          }
        case _ => Behaviors.same
      }
    }

  def running(elapsedMs: Long, timers: TimerScheduler[Command]): Behavior[Command] =
    Behaviors.receive { (ctx, cmd) =>
      cmd match {
        case Tick =>
          val next = elapsedMs + 1000
          ctx.log.info("elapsed = {} ms", next)
          running(next, timers)
        case Stop =>
          timers.cancelAll()
          idle(elapsedMs)
        case _ =>
          Behaviors.same
      }
    }
}
```

Discussion: `Behaviors.withTimers` is the idiomatic way to access the timer scheduler; timers are cancelled automatically when the behaviour stops. The state — `elapsedMs` — is carried by the behaviour parameters rather than mutable fields, making it impossible for two messages to race on the counter. The transition between `idle` and `running` is an explicit behaviour swap, mirroring Hewitt's third axiom directly.

---

## Behavioral / Experience

### Q: Tell me about a production incident involving actors and what you learned.

A strong answer starts with a concrete situation, names the failure mode (e.g., unbounded mailbox saturating heap during a slow downstream), describes the diagnosis path (heap dump, mailbox metrics, dispatcher thread states), the immediate mitigation (circuit breaker, bounded mailbox, restart), and the durable fix (back-pressure protocol, alerting on mailbox depth). The lesson should be about systems thinking, not blame: "queue depth without a policy is a future incident." Bonus points for describing how you operationalised the lesson — runbook updates, dashboards, code review checklists.

### Q: When have you decided *not* to use actors, and why?

The honest answer recognises the cost. For example, a small CRUD service with 100 RPS does not benefit from actors; you pay framework complexity, scheduler overhead, and onboarding cost for capabilities you do not need. For CPU-bound number crunching, a work-stealing thread pool plus channels is simpler. For trivially parallel data transforms, streams or `parallelStream` may suffice. The candidate should show judgement: actors are a tool whose value is supervision, isolation, location transparency, and back-pressure; if you do not need those, the simpler abstraction wins.

### Q: How do you onboard a team new to actor systems?

Start by teaching the three axioms and the implications, not the API. Pair-program a small example where a junior engineer designs the protocol before writing code. Insist on typed actors so the compiler catches the worst mistakes. Set up dashboards for mailbox depth, dispatcher saturation, and dead-letter rates from day one. Cultivate "supervision-first thinking" — for any new actor, what are the failure modes and what should the parent do about them? Code reviews should focus on protocol design and supervision strategy, not just business logic.

### Q: Describe a refactor from a blocking, shared-state design to actors. What were the trade-offs?

Often the impetus is contention or scaling. Walking through the refactor: identify aggregates (units of consistency), make each aggregate an actor, replace direct method calls with message protocols, replace synchronous returns with `replyTo` or pipelined messages, introduce back-pressure where producers exceed consumers. The trade-offs are increased mental model complexity, debugging via distributed traces rather than stack traces, and harder synchronous reasoning. The wins are usually clearer aggregate boundaries, easier horizontal scaling, and better failure isolation.

### Q: Tell me about debugging a race condition in an actor system.

Even though single-threaded execution rules out classical races inside one actor, races still happen *between* actors. Example: actor A reads a value from actor B, decides to update, but in the interim actor C also updates B based on a stale read. The fix is to push the decision into B (where the state lives) instead of relying on read-modify-write across the boundary — model the action as a command to B that both reads and writes atomically. Debugging required tracing both message streams correlated by request id; the lesson was "if you find yourself doing read-modify-write across actors, you have a missing command."

### Q: How do you write tests for actor-based systems?

Use the framework's test kit (`akka.actor.testkit.typed`, `gen_server:call` with a stub, Orleans test cluster). Unit tests verify protocol behaviour: send a sequence of commands, assert replies. Property-based tests are excellent for stateful actors — generate random valid command sequences and check invariants hold after each. Integration tests spin up a real cluster (in-VM is fine) to validate sharding, supervision, persistence. The hardest tests are time-based; use simulated schedulers / virtual clocks to avoid flaky sleeps.

### Q: How do you monitor and operate actor systems in production?

Key metrics: mailbox depth per actor (or per actor class), dispatcher thread utilisation, message handling latency (p50/p99), dead-letter rate, restart count per supervisor, persistence write latency. Alerts on rising mailbox depth catch back-pressure failures early. Distributed traces correlating message flows across actors are essential for diagnosis. For clusters: split-brain alerts, leader changes, rebalance events. Treat the actor system as a distributed system — because it is.

### Q: What is the most surprising thing about actors that bites engineers transitioning from threads?

The biggest surprise is that "single-threaded execution per actor" does not mean "globally serialisable." Actors run *concurrently with each other* with no global lock. A naive design where two actors hold copies of the same data and update independently will diverge in ways threading code engineers do not expect because they are used to thinking about locks. The model demands you co-locate ownership of data with the actor responsible for it; reads from other actors are point-in-time snapshots and must be treated as such.

---

## What I'd Ask a Candidate Now

### Q: Can you walk me through the difference between "concurrency" and "parallelism" in the context of actors?

A senior candidate should distinguish: concurrency is the *structure* of a program as independently progressing tasks; parallelism is the *runtime property* of executing multiple things simultaneously. Actors give you concurrency by construction (every actor is a logically concurrent unit). Whether you get parallelism depends on the scheduler having multiple threads and on actors actually being available to run. The follow-up "what stops your 1000 actors from running in parallel right now?" probes whether the candidate understands dispatcher pool sizes, blocking operations, and message-bound actors.

### Q: I'm designing an actor that holds 10 GB of state. What problems do you anticipate?

The strong answer covers: actor memory is per-process and per-instance — if the actor migrates (sharding rebalance, failover) the rehydration cost is enormous; supervision restart loses everything if state is not persisted; passivation is impossible because activation cost dominates; GC pressure on the JVM/CLR can pause the entire VM. The senior recommendation is to split the state — multiple actors keyed by sub-id, externalise to a database with the actor as a thin coordinator, or shard internally. A junior candidate often misses the migration and GC angles.

### Q: When would you persist state from an actor versus externalising it?

The choice is about *who owns truth*. If the actor's state is the authoritative model and other systems care about its history — orders, accounts, sagas — persistence via event sourcing is natural. If the actor is a cache or coordinator over a database that already owns truth, persistence inside the actor is redundant and creates a divergence risk. Mixed designs (actor is authoritative for in-flight state, externalised view models for queries via CQRS) are common. The candidate should be able to articulate that persistence has a cost (write latency, schema evolution, replay time) and not reach for it reflexively.

### Q: How would you debug a production system where one actor has a mailbox of 50,000 messages and growing?

The candidate should propose: first, confirm via metrics (not eyeball). Second, identify the message handler latency — is the actor slow per message, or is the producer pathological? Third, look at the dispatcher — is it starved by blocking work elsewhere? Fourth, examine the message types; sometimes a specific message dominates and points to a bug. Fifth, decide whether to shed load (drop, reject), parallelise (split into sharded workers), or fix the underlying slowness. A weak answer jumps straight to "scale out"; a strong answer diagnoses before remediating.

### Q: Suppose I claim "actors solve distributed transactions." What is your response?

A senior candidate pushes back. Actors *do not* solve distributed transactions; in fact, they make 2PC awkward by design because their loose coupling resists global locks. What actors give you is a clean substrate for *sagas* — long-running, compensatable processes with explicit failure handling. This is intentional: the actor model bets that eventual consistency with explicit compensation is healthier than blocking transactions, and most modern designs agree. The candidate should articulate that you give up serialisability and gain availability, scalability, and clearer failure semantics.

### Q: How do you think about testability when designing actor protocols?

A protocol is testable when (a) commands and events are pure data, (b) the actor's behaviour is a pure function of state plus command, and (c) side effects are mediated by injectable references. The candidate should mention property-based testing for command sequences, simulated time for timer-driven behaviours, and avoiding tests that depend on real wall-clock delays. They should also distinguish protocol testing (unit) from integration testing (the actor in its cluster). Strong answers connect testability to typed actors — typed protocols are unit-testable because the type system enumerates the valid messages.

### Q: What is your perspective on actors versus async/await as the default concurrency model in a new system?

A nuanced answer recognises that async/await is unstructured concurrency at the function level: convenient for I/O scheduling but offers nothing for supervision, isolation, or back-pressure. Actors layer those on top. For a small service, async/await plus channels suffices and the framework cost of actors is not worth paying. For a system with many independent, stateful, supervised components, actors articulate the design intent the language cannot. Many modern systems (Rust + Tokio, .NET + Orleans, JVM + Akka) blend both: async/await within an actor for I/O, actor model across actors for structure. The senior view is that they solve different problems and combining them is often correct.

---

## Cheat Sheet

| Concept | One-line summary |
|---|---|
| Three axioms | Send, spawn, become — the only things an actor can do per message |
| `tell` | Fire-and-forget message send; the actor model's primitive operation |
| `ask` | Future-based request/reply; always with a timeout, used sparingly |
| Mailbox | Per-actor FIFO queue with point-to-point ordering; bound it in production |
| Supervision | Parent decides restart strategy for failed children: one-for-one, one-for-all, rest-for-one, dynamic |
| Let it crash | Restart from known-good state instead of catching every exception |
| Hot code reload | Erlang BEAM keeps two module versions; calls migrate at message boundaries |
| Location transparency | Same API for local and remote sends, but performance and reliability differ |
| Virtual actors | Orleans grains: lifetime is logical, runtime handles activation and placement |
| Typed actors | Compiler enforces message types; protocols are explicit; preferred for new systems |
| Back-pressure | Bounded mailboxes + credit-based or demand-based flow control |
| Persistence / event sourcing | Replay events on activation; commands produce events that are journaled atomically |
| Cluster sharding | Entity actors distributed and rebalanced across the cluster automatically |
| At-most-once delivery | Default; for reliability use persistent actors with idempotent receivers and explicit acks |
| Common antipattern | Actor-per-row; unbounded mailbox; blocking inside receive; ask without timeout |

---

## Further Reading

- *Actors: A Model of Concurrent Computation in Distributed Systems* — Gul Agha (1986) — the canonical formalism.
- *Programming Erlang* — Joe Armstrong — the OTP-flavoured introduction by Erlang's co-creator.
- *Designing for Scalability with Erlang/OTP* — Cesarini and Vinoski — the operations-and-systems perspective.
- *Reactive Design Patterns* — Roland Kuhn, Brian Hanafee, Jamie Allen — broad coverage of actor patterns at scale.
- *Microsoft Orleans* documentation — the canonical reference for virtual actors and grains.
- *Akka Typed* documentation — modern typed actors on the JVM.
- *Pony* tutorial — for capability-aware actors and concurrency without GC pauses.
- *Hewitt, Bishop, Steiger (1973)* — original "A Universal Modular ACTOR Formalism" paper.
- Carl Hewitt's modern lectures — explain why he thinks the actor model is more fundamental than Turing machines for distributed reasoning.

---

## Related Topics

- [README](README.md) — overview of the actor model in this roadmap.
- [Specification](specification.md) — formal semantics and properties.
- [Junior](junior.md) — entry-level concepts.
- [Middle](middle.md) — intermediate actor patterns.
- [Senior](senior.md) — advanced design topics.
- [Professional](professional.md) — production-grade engineering practices.
- [Optimize](optimize.md) — performance tuning and profiling.
- [Find-Bug](find-bug.md) — diagnosing actor system failures.
- [CSP and Channels (Go-style)](../02-csp-channels/README.md) — sibling concurrency model.
- [Shared Memory and Locks](../01-shared-memory/README.md) — the model actors deliberately avoid.
- [Software Transactional Memory](../04-stm/README.md) — another alternative to shared-memory concurrency.
- [Distributed Systems Patterns](../../../distributed-systems/README.md) — supervision, sagas, sharding in broader context.
- [Erlang/OTP Deep Dive](../../../../languages/erlang/README.md) — the canonical actor ecosystem.

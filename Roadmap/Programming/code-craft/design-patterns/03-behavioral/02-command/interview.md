# Command — Interview Preparation

> **Source:** [refactoring.guru/design-patterns/command](https://refactoring.guru/design-patterns/command)

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral / Architectural Questions](#behavioral-architectural-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### Q1. What is the Command pattern?

**A.** A behavioral pattern that encapsulates a request as an object, containing the receiver, the method, and parameters. The Command can be queued, logged, undone, retried, or transmitted. Decouples the Invoker (who triggers) from the Receiver (who does).

### Q2. Name the four roles in Command.

**A.** **Client** creates the Command and binds it to its Receiver. **Invoker** triggers the Command (button, queue, scheduler). **Command** is the abstraction holding `execute()` and optionally `undo()`. **Receiver** knows how to actually perform the action.

### Q3. What's the difference between Command and Strategy?

**A.** Both encapsulate behavior. **Strategy** picks one of multiple algorithms ("how"). **Command** represents an action to perform ("what"). Strategy is noun-like (a sorter); Command is verb-like (a save).

### Q4. Give a real-world example.

**A.** Undo/redo in editors, task queues (Sidekiq, Celery), database transactions, GUI button actions, macro recorders, scheduled jobs, HTTP request handlers.

### Q5. Why does the Invoker not know the Receiver?

**A.** Decoupling. The Invoker just calls `command.execute()`. Adding a new action = adding a new Concrete Command; the Invoker doesn't change. Open/Closed.

### Q6. What's the difference between Command and a function/lambda?

**A.** Conceptually the same. In modern languages, a closure capturing the Receiver IS a Command. The pattern formalizes the structure; lambdas reduce the boilerplate. Use a class when you need identity, undo, or serialization.

### Q7. What's a Macro Command?

**A.** A Command composed of other Commands, executed in sequence. Useful for grouping related actions into one transaction-like unit.

### Q8. When would you NOT use Command?

**A.** When the action is one line and never changes; when there's no need for queuing, undo, logging, or transmission. Direct calls are clearer for simple cases.

### Q9. How does undo work?

**A.** Two main approaches: (1) compute the inverse — `undo` of `inc` is `dec`. (2) snapshot — record state before; restore on undo. Use #1 when the inverse is deterministic; #2 otherwise.

### Q10. What's idempotency in the context of Commands?

**A.** A Command is idempotent if running it multiple times has the same effect as once. Critical for queued / network Commands where retries cause duplicates. Implement via dedup keys.

---

## Middle Questions

### Q11. How is Command different from Memento?

**A.** Command represents *an action* (with optional undo). Memento represents *a state snapshot* — used for undo by storing what state was. Often combined: Command's undo uses a Memento.

### Q12. What's a compensating action?

**A.** A Command that *undoes the effect* of another Command, especially in distributed systems where true rollback isn't possible. `Charge` → `Refund` is a compensation; `Reserve` → `Release` is a compensation. Used in Sagas.

### Q13. Why are queued Commands often required to be idempotent?

**A.** At-least-once delivery. Network failures cause retries; brokers redeliver after worker crashes. Without idempotency, "send email" becomes "send email 3 times." Idempotency keys make duplicates safe.

### Q14. How do you implement Ctrl+Z grouping?

**A.** Group related changes into a single Command. Either: explicitly start/end a transaction; or coalesce based on time (typing within 1 second is one undo unit). Push the group as one Command on the undo stack.

### Q15. What's the difference between Command and Event?

**A.** Command is *intent* — "I want to place an order." Can be rejected. Event is *fact* — "the order was placed." Cannot be rejected (it already happened). Conflating them produces fragile systems.

### Q16. How do you serialize a Command?

**A.** JSON, Protobuf, Avro, MessagePack. Command should be a value (immutable, no resource handles). Serialize all parameters; deserialize in another process. Kafka/RabbitMQ deliver these between services.

### Q17. What's the Command Bus pattern?

**A.** A central dispatcher that maps Command types to handlers. `bus.dispatch(cmd)` looks up the handler and invokes it. Common in CQRS frameworks (Axon, MediatR, NestJS CQRS).

### Q18. Macros and partial failure — how to handle?

**A.** Two strategies: (1) **Saga / compensation** — keep what succeeded; emit compensating Commands for failures. (2) **True rollback** — undo previous Commands in reverse order. Choice depends on whether actions can be safely undone.

### Q19. Sync vs async Commands — when each?

**A.** Sync for cheap in-process actions where latency is small (UI handlers, in-memory state). Async for I/O-bound (DB, HTTP), heavy work, or when caller doesn't need to wait. Async demands careful error handling and result tracking.

### Q20. What's Command result handling?

**A.** Classical Command is `void execute()`. For async or RPC, return a `Future<Result>` or `Promise<Result>`. For event-sourced systems, the result is implicit — Events are emitted as the Command's effect.

---

## Senior Questions

### Q21. CQRS — what is it and why?

**A.** Command-Query Responsibility Segregation. Different models for reads and writes. Commands modify state; Queries return data. Justifications: scale (reads >> writes), evolution (independent schemas), consistency (different requirements). Cost: complexity. Use only when justified.

### Q22. Event sourcing — how does Command fit?

**A.** Commands cause Events; Events are persisted; State is derived by replaying Events. Replay reconstructs state at any point. Audit, time-travel, debugging are first-class. Cost: storage, schema evolution, complexity.

### Q23. What is the Outbox pattern?

**A.** Atomic dual-write solution. In one transaction: state change + insert into outbox table. A separate dispatcher reads outbox and publishes to broker, marking entries dispatched. Eliminates dual-write hazard while providing at-least-once.

### Q24. Saga — choreography vs orchestration?

**A.** **Choreography**: services react to each other's events; no central coordinator. **Orchestration**: a workflow engine sends Commands sequentially. Choreography: decentralized, harder to follow. Orchestration: clearer logic, central failure point. Most teams pick orchestration for non-trivial flows.

### Q25. How do you design idempotent Commands?

**A.** (1) Idempotency keys on every Command. (2) Server stores processed keys with TTL. (3) Receiver checks before executing; returns cached result for duplicates. (4) Operations should be naturally idempotent where possible (UPSERT, conditional UPDATE).

### Q26. Optimistic locking with Commands?

**A.** Each aggregate has a version. Commands include the read version. UPDATE conditional on version; if conflict (0 rows), retry the Command with latest state. Avoids long-held locks; fits naturally with at-least-once delivery.

### Q27. How do you observe Command failures in production?

**A.** Per-Command metrics: dispatched, succeeded, failed, retry count. Distributed tracing for cross-service Commands. Dead-letter queues for failed-after-retries. Logs with correlation IDs to trace a Command across services.

### Q28. Schema evolution of stored Commands?

**A.** Backward-compatible: old consumers tolerate new fields (JSON unknown-ignore, protobuf optional). Forward-compatible: new consumers handle missing fields. Renames: don't; add new field, deprecate old, remove later. Schema registry (Confluent, Apicurio) enforces compatibility.

### Q29. Workflow engines — Temporal / Cadence relationship to Command?

**A.** Workflows are sequences of Commands persisted as history. Workers replay history to rehydrate state on restart. Activities (the actual work) are non-deterministic; results are stored. Combines Command + Saga + persistence into a managed service.

### Q30. Distributed Commands — at-most-once vs at-least-once vs exactly-once?

**A.** **At-most-once**: simple but lossy. **At-least-once**: retries until ack; duplicates possible (idempotent handlers required). **Exactly-once**: at-least-once + idempotency or transactional dedup. True exactly-once is rare and costly. Default: at-least-once + idempotent handlers.

---

## Professional Questions

### Q31. Why are Commands often immutable?

**A.** Immutability prevents bugs from mutated state during dispatch / retry / replay. A Command captured at time T should produce the same effect when run at time T+1. Mutation breaks this. Java records, Kotlin data classes, Python dataclasses are idiomatic.

### Q32. How does Temporal achieve "deterministic" workflows?

**A.** Workflows must produce the same sequence of Commands given the same inputs and recorded activity results. Forbids non-determinism: random, current time, network calls. These are recorded as activities; results are persisted. Replay uses recorded results.

### Q33. Idempotency store — Redis vs DB vs DynamoDB trade-offs?

**A.** Redis: fast (~200 µs), TTL built-in, not durable. DB table: durable, slower, simple. DynamoDB: durable, fast, expensive at scale. Pick by SLA. Many systems use Redis hot path + DB cold path for safety.

### Q34. Outbox dispatcher — polling vs CDC?

**A.** Polling: simple, Q-able, but every poll is a DB query; index pressure. CDC (Debezium reads WAL): zero DB load, real-time. CDC is operationally complex (stream tooling) but much higher throughput. For high traffic, CDC.

### Q35. Snapshot strategy in event-sourced systems?

**A.** Synchronous: snapshot every N events in same transaction → fresh, slow writes. Async: separate process snapshots periodically → fast writes, eventual freshness. Tune N based on event rate and replay tolerance.

### Q36. Replay performance — what's slow?

**A.** Loading thousands of events from disk; deserialization; applying each. Optimizations: snapshots, parallel replay across aggregates, stream-based replay (don't load into memory).

### Q37. Lock-free Command dispatch — Disruptor, why?

**A.** Lock-free ring buffer; single-writer principle; cache-line padding. Avoids context switches and lock contention for sub-microsecond dispatch. Used in financial trading where every µs counts.

### Q38. Why is Erlang's actor model Command at language level?

**A.** Every message sent to a process is a Command. The receiving process pattern-matches and responds. Built-in mailbox is the queue. Supervision trees handle failure. Command pattern as a primitive of the language.

### Q39. Schema registry — what it solves?

**A.** Prevents producers from publishing schemas that break consumers. Enforces compatibility (backward, forward, full). Provides versioning and history. Especially useful in event-sourced systems where Commands persist for years.

### Q40. JIT optimization of Command dispatch?

**A.** Monomorphic call sites (one Command type at one site) inline. Megamorphic (many types) fall back to vtable. For typed Command buses with many types, dispatch is megamorphic; cost is small (~ns) but real. Type-specialized branches restore monomorphism.

---

## Coding Tasks

### T1. Editor with undo / redo

A document with `append`, `delete`, `replace`. Each is a Command. Stack-based undo / redo with Ctrl+Z, Ctrl+Y.

### T2. Idempotent task queue

A queue processing Commands keyed by idempotency key. Dedup duplicates; cache results for replays.

### T3. Macro recorder

Record a sequence of user actions as Commands; persist; replay.

### T4. Transactional macro

A Macro Command that rolls back partial work on failure. Test with a flaky middle Command.

### T5. Outbox-based Command bus

In one transaction: persist state + Command in outbox. Separate dispatcher publishes; marks dispatched.

### T6. Saga orchestrator

Three Commands in sequence; if any fail, compensate previous ones in reverse. Test happy path and each failure point.

### T7. CQRS skeleton

A Command bus with handlers; a Query side reading from a projection. Separate models; verify they stay in sync.

### T8. Command serialization

A Command serialized to JSON, sent over a queue, deserialized, executed. Round-trip preserves semantics.

---

## Trick Questions

### TQ1. "Doesn't every method call already encapsulate an action — why Command?"

**A.** Yes, calls are actions. The pattern earns its weight when the action needs *identity*: queue, undo, log, transmit. Without those needs, Command is overhead.

### TQ2. "Can I put business logic in the Command's `execute`?"

**A.** No — the Command should *call* the Receiver, not BE the Receiver. If logic creeps into Commands, you've conflated roles. Command = thin wrapper; Receiver = where logic lives.

### TQ3. "Why can't I just use a `Runnable`?"

**A.** You can, for fire-and-forget tasks. `Runnable` lacks `undo`, identity (no name), and serializability. For richer needs, define a Command interface.

### TQ4. "If I have one Command type, is it still Command?"

**A.** It's the *shape* of Command but not pulling its weight. The pattern earns its complexity with multiple Concrete Commands or with the operations (queue, undo, log) on top. One-type Commands are usually overhead.

### TQ5. "Doesn't Spring's `@Async` make Command obsolete?"

**A.** No. `@Async` is *one mechanism* to dispatch Commands asynchronously. The pattern (action-as-object, Invoker / Receiver split) is intact; the framework hides some boilerplate.

### TQ6. "Can a Command be its own Receiver?"

**A.** It can — small commands often are. But it conflates two roles; testing is harder; the pattern's decoupling is lost. Generally separate them.

### TQ7. "How do I undo a Command that called an external API?"

**A.** You can't truly undo external side effects. Issue a *compensating* Command: `Charge` → `Refund`, `Send Email` → ?? (you can't unsend). For send-email, the honest answer is: you can't undo. Don't include it in undo flows.

### TQ8. "Are HTTP requests Commands?"

**A.** Conceptually yes — each request is an action with parameters, sent over the network. REST conflates Commands and Queries (POST is a Command; GET is a Query). gRPC and CQRS frameworks are more explicit.

---

## Behavioral / Architectural Questions

### B1. "Tell me about a time you used Command for undo."

Pick a concrete case: text editor, drawing app, IDE refactor. Describe Command structure, undo strategy (inverse vs snapshot), grouping for sane Ctrl+Z, history bounding.

### B2. "Walk me through a Saga implementation."

Concrete: order placement spans payment, inventory, shipping. Orchestrator (or choreography) dispatches Commands; on failure, compensations run in reverse. Mention idempotency, observability, dead-letter handling.

### B3. "Why did you choose CQRS for this system?"

Explain the *symptoms* that justified it: read/write asymmetry, divergent schemas, scale. Don't apply CQRS reflexively; apply when the costs of coupling write and read models exceed the costs of separation.

### B4. "Your queued Commands are running multiple times — how do you fix?"

Add idempotency keys. Server-side dedup with Redis/DB. Receivers operate idempotently (UPSERT, conditional UPDATE). Tag with correlation IDs for tracing. Set TTL on idempotency store.

### B5. "How do you decide between event sourcing and CRUD?"

CRUD: simpler, mainstream, sufficient for most apps. Event sourcing: when audit / time-travel / divergent projections are first-class needs. The complexity tax of event sourcing is real; pay only when justified.

### B6. "We need to support 10K Commands/sec. Architecture?"

Outbox + Kafka for durability. Idempotency keys (Redis). Multiple consumers per topic for parallel processing. Monitor lag, retries, dead-letters. CDC instead of polling outbox if DB load is a concern.

---

## Tips for Answering

1. **Lead with intent, not class names.** "Command turns an action into an object so you can queue / undo / log / transmit it."
2. **Always give a concrete example.** Undo, task queue, transaction.
3. **Distinguish from siblings.** Strategy, Memento, Event, Function.
4. **Address scale early.** In-process Command vs distributed (Saga, workflow engine).
5. **Mention idempotency for queued Commands.** Senior interviewers probe for this.
6. **Don't pretend exactly-once delivery is easy.** Be honest: at-least-once + idempotent is the realistic answer.
7. **Tie Command to CQRS / event sourcing.** Shows you understand the architectural lineage.
8. **Acknowledge when Command is overkill.** A function call is fine sometimes.

[← Professional](professional.md) · [Tasks →](tasks.md)

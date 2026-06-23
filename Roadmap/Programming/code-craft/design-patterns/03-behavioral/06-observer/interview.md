# Observer — Interview Preparation

> **Source:** [refactoring.guru/design-patterns/observer](https://refactoring.guru/design-patterns/observer)

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

### Q1. What is the Observer pattern?

**A.** A behavioral pattern establishing a one-to-many dependency: a Subject keeps a list of Observers, notifying them when its state changes. Each Observer reacts independently. The Subject doesn't know its Observers' concrete types.

### Q2. Subject and Observer — who knows whom?

**A.** Subject knows the Observer **interface** (calls `update()`), not concrete classes. Observers may know the Subject if they pull data; in push model, they don't need to. The asymmetry — Subject "doesn't know" its concrete observers — is what enables decoupling.

### Q3. Push vs pull — which is better?

**A.** Push: Subject sends data to observers (data is part of the notification). Pull: Subject only signals; observers fetch what they need from Subject. Push is more decoupled (observers don't know Subject API); pull is more flexible (each observer takes what it cares about). Default to push.

### Q4. Give 5 real-world examples.

**A.** UI events (click handlers), Kafka consumers, RxJS observables, Spring `@EventListener`, database triggers, file watchers, React state hooks, JavaScript EventEmitter, Java's deprecated `Observable`.

### Q5. What's a memory leak risk in Observer?

**A.** Observer subscribed to a long-lived Subject is held by the Subject indefinitely. If the Observer is supposed to be garbage-collected (UI fragment, request handler), the strong reference prevents it. Fix: weak references or explicit unsubscribe in lifecycle.

### Q6. Why is `notifyAll` synchronous in classical Observer?

**A.** Simplicity. Each observer runs in the calling thread, in subscription order. Predictable; easy to reason about; easy to debug. Async dispatch needs more machinery (executors, ordering, error handling).

### Q7. What's the difference between Observer and Pub/Sub?

**A.** Observer is in-process: Subject directly calls observers. Pub/Sub uses a broker (Kafka, Redis): publishers send to a topic; subscribers receive from the topic. Pub/Sub adds persistence, routing, durability. The pattern is the same; the scale differs.

### Q8. Why type your events?

**A.** Type-safety: subscribers can't subscribe to a non-existent event type, can't pass wrong handler signatures. Refactoring tools work. Strings are fragile — typos compile fine, fail at runtime.

### Q9. When NOT to use Observer?

**A.** Single fixed consumer (direct call is simpler). Strict ordering needed (Observer doesn't promise it). Performance-critical with many observers in sync chain. Extreme decoupling not desired (sometimes direct calls are clearer).

### Q10. How do you unsubscribe?

**A.** Subject exposes `unsubscribe(observer)`. Or subscribe returns a `Disposable` / unsubscribe function the caller can invoke later. The second pattern is increasingly common (RxJS, Reactor).

---

## Middle Questions

### Q11. How is Observer different from Mediator?

**A.** Observer: one-to-many, broadcast direction. Subject doesn't know observer types. Mediator: many-to-many, centralized routing. Mediator knows components; components talk through it.

### Q12. What's a `ConcurrentModificationException` in Observer?

**A.** During notification, an observer subscribes or unsubscribes — modifying the list being iterated. Fix: snapshot the list before iterating, or use `CopyOnWriteArrayList`, or use index-based iteration with explicit synchronization.

### Q13. How do you handle one observer throwing an exception?

**A.** Wrap each invocation in try/catch. Log the failure; continue with the next observer. Without this, one bad observer breaks the chain.

### Q14. How does Spring's `@EventListener` use Observer?

**A.** Spring publishes events via `ApplicationEventPublisher`. Beans annotated with `@EventListener` subscribe automatically — Spring discovers them at startup. Adding a listener = adding a bean. The publisher doesn't change.

### Q15. What's hot vs cold observable?

**A.** Hot: emits regardless of subscriptions; late subscribers miss events (live events, sensors). Cold: emits only on subscribe; each subscriber gets a fresh stream (database queries, file reads).

### Q16. How do you prevent cyclic notifications?

**A.** Detect with a thread-local flag (entering publish → flag = true; cycles return early or queue for after). Or restructure: collect changes, dispatch once at the end. Or use immutable state with diffing.

### Q17. Push vs pull memory model?

**A.** Push minimizes Subject coupling — observers don't need Subject's API. Pull risks observers calling unintended Subject methods. Push is recommended; pull is for "I might need this state" cases.

### Q18. What's a typed event bus?

**A.** A bus where you `subscribe(EventClass.class, handler)` and `publish(event)` is dispatched only to handlers for that specific class (or supertypes). Compile-time safety.

### Q19. Why use weak references for observers?

**A.** When the Subject's lifetime exceeds the Observer's, strong refs prevent GC of observers. Weak refs let the GC reclaim them; the bus must skip cleared refs on dispatch.

### Q20. How do you test an Observer chain?

**A.** Test the Subject: subscribe a fake observer, publish an event, verify it received the event. Test each observer in isolation: feed it synthetic events, assert side effects. For async: use latches or test schedulers.

---

## Senior Questions

### Q21. Sync vs async dispatch — when do you switch?

**A.** Switch to async when handlers do I/O (DB, HTTP), are slow (>tens of ms), or the publisher's latency budget is tight. Stay sync for UI events, in-memory transformations, transactional consistency. Async loses ordering and adds error-handling complexity.

### Q22. What's the Outbox pattern?

**A.** Atomicity for domain events: write the aggregate change AND the event into the same DB transaction. A separate dispatcher reads the outbox table and publishes to the broker, marking events as dispatched. Provides at-least-once, eventually-consistent delivery without the dual-write problem.

### Q23. How do you trace cascading events?

**A.** Correlation ID propagated through every event. Structured logging or distributed tracing (OpenTelemetry). Spans for each handler invocation. Without this, debugging "why did Y happen?" is painful.

### Q24. What's backpressure and how do you handle it?

**A.** When the publisher emits faster than subscribers can consume. Strategies: (1) drop newest/oldest (lossy), (2) block publisher (couples them), (3) buffer with bounded size + spill to disk, (4) Reactive Streams `request(n)` (subscribers pull). Choice depends on durability requirements.

### Q25. At-least-once vs at-most-once vs exactly-once?

**A.** **At-most-once**: fire-and-forget; events may be lost. **At-least-once**: retry until ack; duplicates possible (handlers must be idempotent). **Exactly-once**: hardest; usually means at-least-once + idempotency, sometimes with transactional outbox + dedup. Kafka's "exactly-once" is at-least-once + idempotent producer + transactional consumer.

### Q26. CDC (Change Data Capture) — how does it relate to Observer?

**A.** The DB is the Subject. CDC tools (Debezium, Maxwell) read the WAL and emit row changes as events. Downstream services subscribe. Useful for keeping caches, search indices, read models in sync. Same Observer pattern; the DB doesn't know its consumers.

### Q27. WebSockets / SSE — how is this Observer?

**A.** Server is the Subject; each connected client is an Observer. The connection is the subscription. Server pushes events; client reacts. SSE is simpler (server-only push); WebSocket is bidirectional.

### Q28. Per-handler executor vs shared executor?

**A.** Per-handler: each handler sees events in publish order; different handlers can interleave. Useful when handler order across observers doesn't matter but per-handler order does. Shared: simpler, lower overhead, no per-handler ordering.

### Q29. Schema evolution in event streams?

**A.** **Add fields**: safe (consumers ignore unknowns). **Remove fields**: deprecate first; remove after consumers update. **Rename**: dual-publish during transition. **Versioning**: include version in payload; handlers branch. Schema registry (Confluent, Apicurio) enforces compatibility.

### Q30. How do you observe Observer failures in production?

**A.** Per-handler metrics: invocation count, success count, failure count, latency. Per-handler logs with correlation IDs. Dead-letter queue for events that failed after retries. Alerting on failure rate or DLQ depth.

---

## Professional Questions

### Q31. How does CopyOnWriteArrayList enable lock-free reads?

**A.** Reads access an internal array reference (volatile or under lock). Writes synchronize, copy the array, modify the copy, atomically swap the reference. Iterators are over the snapshot — never see in-flight writes. Reads are O(1) with no lock; writes are O(n).

### Q32. Why is volatile required when sharing the listener list?

**A.** Without volatile (or other happens-before mechanisms), a write to the list reference by one thread isn't guaranteed visible to readers. Reader threads might see stale data indefinitely. `volatile` provides the visibility guarantee.

### Q33. Reactive Streams `request(n)` — what does it solve?

**A.** Backpressure. Without it, a fast publisher overwhelms a slow subscriber → memory exhaustion. With `request(n)`, subscribers tell publishers their capacity; publishers honor it. The Reactive Streams TCK ensures every implementation respects this contract.

### Q34. How does the LMAX Disruptor achieve millions of events/sec?

**A.** Ring buffer (no allocation), single-writer principle (no contention on writes), cache-line padding (no false sharing), busy-spin wait strategies (no kernel context switches), and mechanical sympathy (power-of-two sizes for bitmask indexing).

### Q35. Hot vs cold observable — implementation difference?

**A.** Cold: each `subscribe` call invokes the source-creation lambda fresh. The publisher captures inputs in the closure; each subscriber gets its own emission sequence. Hot: a single source emits to all subscribers; multicasting via `share()` or `publish().refCount()`.

### Q36. Kafka exactly-once semantics — how?

**A.** Idempotent producer: each message has a sequence number; broker dedups within a session. Transactional producer: events in a transaction commit atomically (multiple partitions). Transactional consumer: only reads committed events. With idempotent handlers, end-to-end exactly-once is achievable.

### Q37. JMM happens-before in Observer?

**A.** Subscribe writes to a list field; publish reads from it. Without ordering, the write may not be visible. `synchronized` or `volatile` establishes happens-before: actions before the synchronized block / volatile write happen-before actions after the synchronized block / volatile read.

### Q38. How do you benchmark an event bus?

**A.** JMH (Java) with `@State` to amortize setup. Vary observer count and observer body size. Use `Blackhole.consume()` to defeat DCE. Compare sync vs async; measure P50, P99 latency and throughput. Watch for warmup effects.

### Q39. Why use a single-threaded executor for ordering?

**A.** A single thread processes tasks in submission order. Multi-threaded pools reorder due to scheduling. If you need event-order preservation across all events for one observer, a single-threaded executor (per observer) is the simplest correct answer.

### Q40. Coroutines `SharedFlow` vs `Flow` — which is Observer?

**A.** `Flow` is cold: each collector re-runs the producer. `SharedFlow` is hot: one producer, multicast to many collectors. SharedFlow is the Kotlin equivalent of an EventBus / RxJava `Subject`. `replay` and `extraBufferCapacity` parameters tune late-subscriber and backpressure behavior.

---

## Coding Tasks

### T1. Simple subject with multiple observers

A `WeatherStation` with `setTemp()`. Multiple `Display` observers subscribe and print on update.

### T2. Typed event bus

`bus.subscribe(OrderPlaced.class, h)` and `bus.publish(new OrderPlaced(...))`. Compile-time safety.

### T3. Async dispatch with error isolation

A bus that runs each handler on an executor; one handler's exception doesn't affect others.

### T4. Weak-ref subject

Subscribers held by weak refs. Demonstrate that GC reclaims unreferenced observers; the bus skips cleared refs.

### T5. Outbox-pattern domain events

Aggregate emits events; persistence layer commits state + events atomically; a dispatcher pulls and publishes.

### T6. Backpressure with `Flux`

A fast `Flux` source and a slow subscriber. Show buffer overflow with `onBackpressureBuffer(N)` and dropped events.

### T7. SSE server

A simple Node.js or Spring Boot SSE endpoint. Multiple clients subscribe; server pushes events.

### T8. Cycle detection

A bus where Subject A → publishes → handler → publishes back to A. Detect and break the cycle.

---

## Trick Questions

### TQ1. "Doesn't an event handler that publishes another event create a cycle?"

**A.** Possibly. If A → B → A, yes. The fix is structural: detect cycles or model as a state machine where the handler emits a different event (`OrderPlaced` → `EmailSent`, not `OrderPlaced` → `OrderPlaced`).

### TQ2. "What's wrong with `for (Observer o : observers) o.update()`?"

**A.** If an observer modifies `observers` (subscribe / unsubscribe) inside `update`, you get `ConcurrentModificationException`. Fix: snapshot before iterating, or use `CopyOnWriteArrayList`.

### TQ3. "Why is Java's `java.util.Observable` deprecated?"

**A.** Inheritance-based; you must subclass `Observable`. The `setChanged()`/`notifyObservers()` two-step is awkward. No type safety on event payloads. Modern alternatives (`PropertyChangeListener`, `Flow`, third-party event buses) are better.

### TQ4. "Is React's `useState` Observer?"

**A.** Effectively yes — components subscribe to the state slice; React notifies (re-renders) on change. The framework hides the bookkeeping. Internally, React Fiber implements a sophisticated observer / scheduler.

### TQ5. "Can a single event have multiple subjects?"

**A.** A single event class can be published by many subjects, yes. But the term "Subject" in Observer specifically means the source-of-emission. If two sources publish the same event type, observers receive from both — that's just a busy event channel.

### TQ6. "If I unsubscribe inside `update`, does the next observer still get notified?"

**A.** Yes — provided the iteration is over a snapshot. Without snapshot, the iteration index might be off. Always snapshot before iterating, or use `CopyOnWriteArrayList`.

### TQ7. "Observer with a single observer — useful?"

**A.** Functionally identical to a callback. The pattern earns its complexity when (a) there are multiple observers, or (b) you anticipate multiple in the future. For one consumer, a direct call or function reference is clearer.

### TQ8. "What's wrong with synchronous notify in a request handler?"

**A.** Total request latency = your work + sum of all observers' latencies. If one observer does HTTP, you've added a network roundtrip to every request. Switch to async (or extract to a queue) for I/O-bound handlers.

---

## Behavioral / Architectural Questions

### B1. "Tell me about a time you used Observer to decouple a service."

Pick a concrete: replaced "user signup → email + analytics + slack" hardcoded calls with `UserRegistered` event. Multiple subscribers in their own modules. Easier to test, deploy, evolve.

### B2. "How would you replace an in-process Observer with Kafka?"

(1) Continue publishing in-process events. (2) Add a bridge subscriber that forwards to Kafka. (3) Stand up new external subscribers reading from Kafka. (4) Decommission in-process subscribers. (5) Or run both during transition.

### B3. "Your event bus is silently dropping events. How do you debug?"

Per-handler metrics first (subscribe count, invocations, errors). Logs with correlation IDs. Verify subscriptions registered (count == expected). Check for exceptions swallowed (per-handler try/catch logging). For async: queue depth metrics.

### B4. "How do you decide between Observer and Mediator?"

Observer: one-to-many broadcast; subject doesn't know observers. Mediator: many-to-many, central coordinator that knows participants. If components talk to each other (component A calls B which calls C), Mediator. If one source notifies many, Observer.

### B5. "What's the trade-off of Observer for cross-cutting concerns?"

Pros: cleanly decouple audit, metrics, logging. Cons: cascade tracing harder; debugging "why did this fire?" requires correlation IDs and structured logs. Often worth it; pay the operational tax.

### B6. "We have a system with 50 listeners on one event. Reasonable?"

Maybe. Audit the listeners — many may be subset listeners that should be on more specific events. Move to typed hierarchical events; subscribers listen at the level they care about. 50 listeners on a generic event is a smell; 50 across specific subtypes is fine.

---

## Tips for Answering

1. **Lead with intent, not class names.** "Observer is for one-to-many broadcast where the publisher doesn't know its subscribers."
2. **Always give a concrete example.** UI events, Kafka, RxJS — universally familiar.
3. **Distinguish from siblings.** Mediator (centralized), Pub/Sub (network scale), Reactive streams (backpressure).
4. **Address sync vs async early.** It's a big design knob with real consequences.
5. **Mention leak risks.** Memory leaks from stale subscriptions are the most common Observer bug.
6. **Tie to scale.** In-process Observer scales to thousands of events/sec; Pub/Sub for millions.
7. **Think about delivery semantics.** At-most/at-least/exactly-once shapes architecture.
8. **Don't ignore tracing.** "How do you debug?" is a senior question on Observer systems.

[← Professional](professional.md) · [Tasks →](tasks.md)

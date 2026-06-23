# Mediator — Interview Preparation

> **Source:** [refactoring.guru/design-patterns/mediator](https://refactoring.guru/design-patterns/mediator)

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

### Q1. What is the Mediator pattern?

**A.** A behavioral pattern that centralizes many-to-many object interactions through a coordinator. Components don't talk to each other directly; they notify the Mediator, which routes and decides who reacts. Reduces N×N coupling to N→1.

### Q2. What problem does it solve?

**A.** Tangled peer-to-peer dependencies. Without Mediator, N components have N² potential dependencies. With Mediator, each component depends on one Mediator interface. Reuse and refactoring become easier.

### Q3. How is Mediator different from Observer?

**A.** Observer: one-to-many broadcast; subject doesn't know listeners; listeners react independently. Mediator: many-to-many through a coordinator; coordinator knows all components and routes specifically with logic. Mediator is "specific routing"; Observer is "broadcast notification."

### Q4. Give a real-world example.

**A.** Air-traffic control tower (pilots radio it; tower coordinates), chat room (users post; room broadcasts), smart-home hub (devices report; hub orchestrates), UI dialog (fields notify dialog; dialog enables/disables buttons).

### Q5. What are the roles in Mediator?

**A.** **Mediator** (the coordinator interface), **ConcreteMediator** (the implementation that knows components), **Component** (a participant that holds a Mediator reference and notifies it; doesn't know other Components).

### Q6. What's a "god class" in the Mediator context?

**A.** A Mediator that grew too big — handles all logic, knows too many components, has too many methods. Smell of unfocused responsibility. Fix: split by domain into multiple Mediators.

### Q7. When is Mediator overkill?

**A.** Two or three components with simple interactions. Or when components don't actually interact. Premature centralization is as bad as god class.

### Q8. What's typed events vs magic strings?

**A.** Typed events use distinct method calls or classes; the compiler catches typos and refactors. Magic strings (`notify(this, "submit-clicked")`) compile fine but break at runtime. Always prefer typed.

### Q9. Is MVC's controller a Mediator?

**A.** Conceptually yes — it routes between View and Model, decoupling them. The View notifies the Controller; the Controller updates the Model. Same shape as Mediator.

### Q10. When should you use Observer over Mediator?

**A.** When the interaction is pure broadcast: subject changes; many observers react independently. No coordinator logic. If interactions need specific routing or central rules, Mediator.

---

## Middle Questions

### Q11. How do you avoid Mediator becoming a god class?

**A.** Split by sub-domain: header / form / footer mediators with a parent coordinator. Extract complex actions into Strategies or Commands. Move state into Components if it logically belongs there. Resist the urge to handle everything in one place.

### Q12. What's a hierarchical Mediator?

**A.** A tree of Mediators: a top-level coordinator with sub-Mediators for sub-domains. Sub-Mediators handle local concerns; the top Mediator coordinates between sub-Mediators. Scales to large UIs / workflows.

### Q13. Where does state live: Component or Mediator?

**A.** Decide upfront. Common: Component-owned (each component holds its data; Mediator queries). Less common: Mediator-owned (Components are views). Mixing is the source of most Mediator confusion.

### Q14. How does Mediator differ from Facade?

**A.** Facade hides a subsystem from outside callers — encapsulation. Mediator coordinates internal participants — interaction. Facade simplifies access; Mediator routes communication.

### Q15. Can a component reach another component through the Mediator?

**A.** No — at least not directly. Components ask the Mediator to do something; the Mediator decides which other Components are involved. If you find yourself doing `mediator.getButton().setEnabled(false)`, the Mediator should expose `mediator.disableSubmit()` instead.

### Q16. Mediator + Observer — common combo?

**A.** Often yes. The Mediator IS the Observer's subject; Components subscribe. Components also call methods on the Mediator (push). This blends the patterns; intent (centralized coordination) makes it Mediator.

### Q17. What's MediatR (.NET)?

**A.** A popular library implementing Mediator + CQRS. `mediator.Send(new PlaceOrder(...))` routes the request to a registered handler. Pipeline behaviors wrap dispatch with logging, validation, retry. Centralizes command dispatch.

### Q18. How do you test a Mediator?

**A.** Stub the Components with fakes that record method calls. Drive the Mediator's `notify` with synthetic events; assert the Mediator made the right calls on the right Components.

### Q19. Mediator and circular notifications — risk?

**A.** A's notify triggers B; B's notify triggers A; infinite loop. Detect with a thread-local "in-update" flag, or restructure as a state machine where the cycle becomes a transition.

### Q20. Mediator vs Strategy?

**A.** Strategy varies *one algorithm*. Mediator coordinates *many components*. Strategy: pick how to do something. Mediator: orchestrate who does what.

---

## Senior Questions

### Q21. Choreography vs orchestration — which is Mediator?

**A.** Orchestration is Mediator at distributed scale: a central orchestrator dispatches calls to participating services. Choreography is Observer at distributed scale: services react to events without a central coordinator. For complex flows with compensations, orchestration usually wins.

### Q22. What's a Saga and how is it Mediator?

**A.** A Saga is a long-running distributed transaction with compensations. The Saga orchestrator IS a Mediator — it coordinates participants (services) and routes both happy-path calls and compensations on failure. Choreography Sagas don't have a central Mediator.

### Q23. How do workflow engines (Temporal, Step Functions) implement Mediator?

**A.** The workflow code is the Mediator. Activities are Components. The engine persists every coordination step in an event history; on worker crash, replay the history to resume. Provides durability, retries, observability for free.

### Q24. State persistence for distributed Mediators?

**A.** Options: in-memory (lost on restart), DB-backed (write state per step), event-sourced (derive state from events), workflow engine (outsource entirely). Choose based on durability needs and operational complexity tolerance.

### Q25. Idempotency in Mediator-coordinated services?

**A.** Every Component call carries an idempotency key. Components dedup. Allows safe retry on Mediator failures or network issues. Critical for distributed Mediators where at-least-once is the norm.

### Q26. Mediator throughput at scale — bottlenecks?

**A.** Synchronized methods serialize requests. Per-request mediators avoid this; shared mediators need careful state isolation. State sharding (workflow ID hash → instance) scales linearly. Workflow engines partition workflows similarly.

### Q27. Distributed tracing through a Mediator hierarchy?

**A.** Each notification creates a span. Sub-Mediator spans nest under parent. Trace IDs propagated through Component calls. OpenTelemetry maps cleanly to Mediator hierarchies. Without tracing, debugging stuck workflows is misery.

### Q28. How do you migrate from custom orchestrator to workflow engine?

**A.** (1) Rewrite orchestrator code as workflow definitions. (2) Move activities into activity functions. (3) Run side-by-side; compare outcomes for parity. (4) Cut over once stable. (5) Decommission custom code. Workflow engine handles state, retries, observability.

### Q29. When is choreography better than Mediator orchestration?

**A.** When services are loosely coupled and the flow is genuinely event-driven. When central failure is unacceptable. When teams own services and shouldn't be coupled to a central orchestrator. Trade-off: harder to follow / debug.

### Q30. What's a "process manager" in DDD?

**A.** A long-running coordinator that subscribes to events and dispatches commands to drive a workflow. It IS a Mediator — coordinates aggregates without coupling them. Often implemented with workflow engines.

---

## Professional Questions

### Q31. How does Temporal achieve "deterministic" workflows?

**A.** Workflow code must produce the same sequence of activity invocations given the same inputs and recorded results. Forbids non-determinism: random, time, network, env. These become activities; results recorded. Replay uses recorded results.

### Q32. MediatR pipeline behaviors — how do they work?

**A.** Decorators around handler dispatch. Each behavior wraps the next, calling `next()` to continue or short-circuiting. Logging, validation, retry, transactional behaviors chain into a request-scoped pipeline. Order matters.

### Q33. Mediator + CQRS coupling?

**A.** Mediator dispatches Commands and Queries to handlers. Decouples senders from handlers; centralizes pre/post processing (validation, logging). MediatR (.NET) and Axon (Java) are canonical examples.

### Q34. State sharding for Mediator scale?

**A.** Hash workflow ID to a partition; each partition has a Mediator instance / thread. Linear scaling with partition count. Each partition serializes its workflows; cross-partition coordination requires explicit messaging.

### Q35. Can a workflow run forever?

**A.** Yes — Temporal supports "continue-as-new" to start a fresh workflow with the current state, avoiding ever-growing history. Useful for cron-like or session workflows. Pure long-running with mutating history is a bad idea.

### Q36. How does the Saga pattern handle failure cascades?

**A.** Compensations in reverse order. Charge → reserve → ship; if ship fails, release inventory, refund charge. Compensations must be idempotent. Mediator (orchestrator) is responsible for invoking them.

### Q37. Why is the Mediator usually NOT a singleton across requests?

**A.** State leakage. Per-request Mediator gives each request its own state; shared Mediator must isolate per-request state explicitly. For UI: per-dialog Mediator. For server: per-request or workflow-id-keyed.

### Q38. Distributed Mediator failure — how do you recover?

**A.** State must be durable. Workflow engine handles automatically (replay). Custom orchestrators: load state from DB on restart; resume from last completed step. Lost state = lost workflows = customer impact.

### Q39. Backpressure for Mediator handling many flows?

**A.** Bounded concurrent workflows. Reject new flows when at capacity (queue full). Surface clear error. Workflow engines often have built-in concurrency limits and queue management.

### Q40. Mediator + actor model — how do they relate?

**A.** Erlang's GenServer is a Mediator: receives messages, routes them, manages local state. Akka's actors are similar. The actor model bakes Mediator into the language / framework. Each actor mediates its own domain.

---

## Coding Tasks

### T1. Login dialog Mediator

Username, password, submit, cancel. Submit enables only when both fields filled.

### T2. Chat room

Multiple users; notify all except sender. Add: rate-limit, word-filter, mute.

### T3. Smart-home hub

Motion sensor + light + alarm. Define interactions in the hub.

### T4. Saga orchestrator

Three steps with compensations. On failure, run reverse compensations.

### T5. Hierarchical Mediator

Page mediator coordinating header, form, footer sub-mediators.

### T6. MediatR-style Command bus

`bus.send(Command)` routes to registered handler. Add a logging pipeline behavior.

### T7. Cycle detector

Mediator that detects nested notifications and breaks the cycle.

### T8. Distributed orchestrator stub

Async orchestrator calling three services with idempotency keys.

---

## Trick Questions

### TQ1. "Doesn't Mediator just move complexity from peers to one place?"

**A.** Yes — that's the point. Concentrating coordination logic in one named place is easier to reason about and change than scattered peer-to-peer code. The risk: that place becomes a god class. Mitigate by splitting.

### TQ2. "If components only know the Mediator, how do they get rendered together?"

**A.** They don't — the Mediator's container (a parent component, a layout, a frame) handles rendering. Mediator coordinates *interactions*, not layout. Layout responsibility lives in the View.

### TQ3. "Mediator vs Mediator pattern in DDD?"

**A.** DDD's "process manager" or "saga" plays the Mediator role at domain level. Coordinates aggregates by subscribing to events and dispatching commands. Same intent; DDD-flavored vocabulary.

### TQ4. "What's wrong with `mediator.getComponent('button').setEnabled(false)`?"

**A.** Components reaching through the Mediator to manipulate other Components. Defeats the pattern. The Mediator should expose an action: `mediator.disableSubmitButton()`. Components ask; Mediator decides.

### TQ5. "Mediator with one component — useful?"

**A.** Almost never. The pattern earns its weight when N ≥ 3 components have non-trivial interactions. With one or two, direct calls are clearer.

### TQ6. "Why isn't Spring's `ApplicationContext` called Mediator?"

**A.** It mediates dependency wiring, but its primary role is DI container — building the object graph. The Mediator pattern is specifically about runtime coordination; DI containers are typically construction-time. They overlap conceptually.

### TQ7. "Can you have a Mediator without an interface?"

**A.** You can, but you lose component reusability across Mediator implementations. The interface is what makes Components interchangeable. Without it, Components are coupled to one specific Mediator class.

### TQ8. "What's the difference between Mediator and a Service Layer?"

**A.** Service Layer: a stateless coordinator at a domain boundary, exposing operations. Mediator: a stateful coordinator routing events between participants. Service Layer is "what the app does"; Mediator is "how participants coordinate." Often complementary.

---

## Behavioral / Architectural Questions

### B1. "Tell me about a time you replaced peer-to-peer chatter with a Mediator."

Pick a concrete: UI dialog where every field knew every button. Refactored to a `LoginDialog` mediator. Fields became reusable; the dialog's logic was in one place; tests improved.

### B2. "How would you design a payment workflow with retries and compensations?"

Mediator (orchestrator) calls payment, inventory, shipping in sequence. Each call is idempotent. On failure, compensations in reverse. Persist state (DB or workflow engine). Add observability: traces per workflow, structured logs.

### B3. "Choreography or orchestration for our microservices?"

Depends on flow complexity. Simple "fire-and-forget" cross-service notifications: choreography. Complex multi-step business processes with compensations: orchestration (Mediator). Don't dogmatically pick one.

### B4. "Your Mediator has 3000 lines. What would you do?"

Audit responsibilities. Split by domain (header, form, footer). Extract complex routing into Strategy / Command. Move state to Components if they should own it. Keep Mediator focused on coordination, not implementation.

### B5. "How do you observe a stuck workflow?"

Distributed traces show every Mediator step with timing. Logs with correlation IDs. Workflow engine UIs (Temporal) show every running workflow's state. Without observability, "stuck workflow" is a black box.

### B6. "When would you choose Temporal over a custom orchestrator?"

When the operational complexity of running Temporal is justified by: many workflows, long-running flows, durability requirements, complex retry logic, observability needs. Custom orchestrators are fine for simple cases.

---

## Tips for Answering

1. **Lead with intent.** "Mediator centralizes many-to-many through a coordinator."
2. **Always give a concrete example.** Air-traffic-control, chat, login dialog.
3. **Distinguish from Observer early.** Senior interviewers probe.
4. **Mention god-class avoidance.** Maturity signal.
5. **Connect to Saga / orchestration at scale.** Shows architectural thinking.
6. **Acknowledge when Observer is better.** Pure broadcast doesn't need Mediator.
7. **Mediator ≠ controller, but conceptually related.** MVC parallel.
8. **Workflow engines for durability.** Don't reinvent state persistence at scale.

[← Professional](professional.md) · [Tasks →](tasks.md)

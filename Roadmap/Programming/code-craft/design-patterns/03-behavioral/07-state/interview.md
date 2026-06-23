# State — Interview Preparation

> **Source:** [refactoring.guru/design-patterns/state](https://refactoring.guru/design-patterns/state)

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

### Q1. What is the State pattern?

**A.** A behavioral pattern that lets an object change its behavior when its internal state changes. It looks like the object switches its class. Each Concrete State encapsulates one mode; the Context delegates method calls to the current state; transitions swap the state object.

### Q2. What problem does it solve?

**A.** Tangled `switch (mode)` chains scattered across many methods. State centralizes mode-dependent behavior in polymorphic state classes; adding a new state doesn't require touching existing methods.

### Q3. What's the difference between State and Strategy?

**A.** Strategy is picked by the caller (algorithm choice). State changes itself based on the Context's history (mode evolution). Strategy: caller decides; State: object decides.

### Q4. Give 5 real-world examples.

**A.** Document workflow (Draft → Moderation → Published), TCP connection states, vending machine modes, media player (Playing / Paused / Stopped), order lifecycle (Cart → Paid → Shipped), game character AI, subscription billing.

### Q5. What are the three roles in State?

**A.** **Context** (holds current state, delegates method calls), **State** (interface with operations), **Concrete States** (each implementing one mode).

### Q6. Who triggers transitions?

**A.** Most commonly, the State itself: a method on State calls `context.setState(newState)`. Less commonly, the Context decides based on data. The first is the canonical pattern.

### Q7. What's a finite state machine (FSM)?

**A.** A model where an object has finite modes, with defined transitions between them. State pattern is the OO realization of an FSM: states as classes, transitions as method calls.

### Q8. Why is State pattern useful for vending machines?

**A.** A vending machine's behavior depends on its mode: idle (accepts coins), selecting (accepts product choice), dispensing (releases product). Without State, every method has nested `if` based on mode. With State, each mode is its own class.

### Q9. When NOT to use State?

**A.** Two states with one boolean (`if/else` simpler). Performance-critical inner loops where dispatch overhead matters. The "modes" are independent algorithms picked by callers (Strategy fits better).

### Q10. What's the initial state?

**A.** The state the Context starts in. Set in the constructor. Don't allow null — the Context must always have a valid state to delegate to.

---

## Middle Questions

### Q11. State vs Strategy — which is which here?

**A.** Strategy: caller chooses ("sort with QuickSort vs MergeSort"). State: object's mode dictates ("a paused player ignores 'pause'; a playing player handles it"). Same shape; different decision-maker.

### Q12. How is State different from Mediator?

**A.** State centralizes mode-dependent behavior of *one object*. Mediator centralizes interactions among *many objects*. Different scope.

### Q13. Should states be singletons?

**A.** Yes if they're stateless. Singleton states avoid allocation per transition. If a state holds per-Context data, instantiate per-Context.

### Q14. What's a transition table?

**A.** A data structure mapping `(current_state, event) → next_state`. Lightweight FSM without per-state classes. Good for simple machines; loses per-state behavior encapsulation.

### Q15. How do you handle invalid transitions?

**A.** Three options: (1) throw `IllegalStateException` — surfaces bugs. (2) silently ignore — for user input ("can't pause when stopped"). (3) log and ignore. Choose based on whether it's a bug or a user error.

### Q16. What's a hierarchical state machine?

**A.** States organized as a tree. Substates inherit transitions from parents. Reduces duplication: "power_off" defined on `On`; both `On.Playing` and `On.Paused` get it.

### Q17. How do sealed types help State?

**A.** They list all possible states at compile time. Pattern matching is exhaustive — adding a new state forces compile errors at all switches. Refactor-safe.

### Q18. What's an event in an FSM context?

**A.** A trigger that may cause a transition. "Press play," "payment succeeded," "timer fires." Methods on the Context represent events.

### Q19. How do you persist FSM state?

**A.** Save the state name (string / enum value); reconstruct on load. For event-sourced systems, persist events; replay derives current state.

### Q20. What's a "do nothing" state method?

**A.** A method on a state that's a no-op for that mode. E.g., `pause()` on the Stopped state. Acceptable for honest "this isn't a thing here." Excessive no-ops suggest the FSM has too many states.

---

## Senior Questions

### Q21. How would you persist an FSM-driven entity?

**A.** Status column in DB with CHECK constraint. Optimistic locking on transitions: `UPDATE ... WHERE status = 'old' AND version = ?`. State machine logic in code; DB enforces validity. For audit, log every transition.

### Q22. What's a statechart?

**A.** UML/Harel formalism extending FSM with hierarchy, parallel states, history, guards, actions. Models complex flows that flat FSMs can't (or with painful duplication). XState is a popular JS implementation.

### Q23. How do you handle concurrent transitions?

**A.** Synchronization (lock the Context per-transition), optimistic locking (DB-level CAS on status), or per-Context single-thread executor (workflow engines). Choice depends on scale and persistence.

### Q24. State + event sourcing — relationship?

**A.** Event-sourced systems derive state from events. Each event = a transition. The "current state" is implicit (computed via fold over events). State pattern's mode classes can still apply; the persistence is event-based, not state-based.

### Q25. How does Stripe's PaymentIntent FSM scale?

**A.** Each PaymentIntent has a status. Transitions enforced server-side; webhooks notify on changes. Idempotent operations (double-confirm = no-op). Documented FSM lets clients build robust integrations.

### Q26. When would you use a workflow engine over hand-rolled FSM?

**A.** Long-running workflows (days, months). Need durability across crashes. Want visual workflow definition. Audit / replay is critical. Custom FSM is fine for short-lived in-process state; workflow engine for distributed / long-running.

### Q27. State explosion — how to manage?

**A.** Hierarchy (substates share parent transitions). Parallel statecharts (independent dimensions of state). Compositional design (separate FSMs that interact). Or: question whether all "states" really need to be states — sometimes they're just data.

### Q28. How do you evolve an FSM in production?

**A.** Adding states: usually safe (existing data unaffected). Removing: drain data first; deprecate; remove. Renaming: dual-name during transition. For event-sourced systems, old events stay valid; reinterpretation may be needed.

### Q29. What's the trade-off between object dispatch and transition tables?

**A.** Object dispatch: rich per-state behavior, type-safe, refactor-friendly. More files. Transition tables: lightweight, declarative, less per-state behavior. Choose based on per-state complexity.

### Q30. Distributed FSM across services?

**A.** Saga orchestrator owns the FSM; calls services for each transition. Compensations on failure. Or: each service has its own local FSM; events propagate. Saga is more centralized; events are more decoupled.

---

## Professional Questions

### Q31. JIT optimization of State pattern dispatch?

**A.** Monomorphic call sites (one state type observed) → inline cache → direct call → inlined body. Bimorphic still fast. Megamorphic (8+ types) → vtable, ~2-3ns. For business code: invisible.

### Q32. Sealed types in Java 17+ — what do they enable?

**A.** Compile-time exhaustiveness for switches over the closed set. Adding a new state forces compile errors at all dispatchers. JIT can specialize on the closed set. Pattern matching with type narrowing.

### Q33. CAS-based FSM transition — how?

**A.** Hold state in `AtomicReference`. Transition: read current; build next; CAS. On failure (concurrent transition), retry with new current. Lock-free; suitable for hot in-memory FSMs.

### Q34. How does Temporal handle workflow state?

**A.** Workflow code is deterministic; state lives in local variables and activities. History persists every event. On worker crash, replay history to reach the same state. Workflows can run for months without code-level state management.

### Q35. State machine vs interpreter?

**A.** State machine: data + transition rules + executor. Interpreter: state machine where the executor is generic (XState's interpret). Easier to test, persist, visualize. Hand-rolled is faster for simple cases.

### Q36. Performance of XState in production?

**A.** Per `send`: ~10-50µs. UI-friendly; not for tight loops. Server-side high-throughput → consider hand-rolled FSM. The expressiveness usually wins for business logic.

### Q37. How does Erlang's gen_statem differ from State pattern?

**A.** gen_statem is a behavior — a structured way to write state machines as actors. Each state is a function (not a class). Built-in supervision; can restart on crash. More integrated than the OO State pattern.

### Q38. Optimistic locking implementation in DB-backed FSM?

**A.** Add `version` column. Transition: `UPDATE ... WHERE id = ? AND version = ? AND status = ? RETURNING *`. If 0 rows, retry with fresh state. Atomicity at DB level; no lock needed in app.

### Q39. State pattern allocation cost?

**A.** Each `setState(new XState())` allocates. For high-frequency transitions, use singletons: `setState(XState.INSTANCE)`. Singletons require stateless states. For 1M transitions/sec, ~10MB/sec allocation savings.

### Q40. How does pattern matching in Kotlin / Rust improve State?

**A.** Compiler enforces exhaustiveness over sealed types. Adding a state breaks compilation at dispatchers — forces handling. Type narrowing eliminates casts. Idiomatic, readable, refactor-safe.

---

## Coding Tasks

### T1. Order lifecycle FSM

Cart → Checkout → Paid → Shipped → Delivered + Cancel branch. Disallow invalid transitions.

### T2. Vending machine

Idle → Selecting → Dispensing → Idle. Insert coin / select product / dispense.

### T3. Media player

Stopped → Playing → Paused → Stopped. Implement with both object dispatch and transition table.

### T4. Wizard form

Multi-step form with Next / Back. Conditional step based on user choice.

### T5. TCP-lite

CLOSED → LISTEN → ESTABLISHED → CLOSED. Methods: connect, accept, send, close.

### T6. Hierarchical states

Player FSM: On (Standby / Active.Playing / Active.Paused) / Off. PowerOff applies to all of On.

### T7. Persistent FSM

Order with status in DB. Optimistic locking on transitions. Throw on conflict.

### T8. Singleton states

Traffic light with Red/Yellow/Green singletons. No allocation per transition.

---

## Trick Questions

### TQ1. "Doesn't State pattern just hide a switch behind objects?"

**A.** Yes — but the polymorphism gives compile-time exhaustiveness (with sealed types), refactor safety, and Open/Closed for new states. Hidden switch is still better than scattered switches in many methods.

### TQ2. "If states are singletons, can I add a Context method that mutates state-specific data?"

**A.** No — singletons must be stateless. Per-Context state belongs in the Context. If you need per-Context state-specific data, use non-singleton states.

### TQ3. "Why does the Context need a setState method?"

**A.** Because states change states by calling `context.setState(...)`. The Context is the owner of the current state field; states are external to it. Without setState, states couldn't transition.

### TQ4. "Can the Context decide transitions instead of states?"

**A.** Yes — it's a variation. Context dispatches based on current state, applies transitions. Pros: states don't reference each other (lower coupling). Cons: Context grows.

### TQ5. "What's wrong with using a string field for state?"

**A.** No type safety; typos compile fine; no exhaustiveness; refactoring unsafe. Sealed types or enums catch errors at compile time. Use those.

### TQ6. "If my FSM has only 2 states, do I need State pattern?"

**A.** Probably not. A boolean flag and `if/else` is clearer. State earns its weight at 3+ states with non-trivial logic per state.

### TQ7. "Can I have an object in two states at once?"

**A.** Not in flat State pattern. In statecharts (parallel states), yes — but they're conceptually independent FSMs. "Player is Online AND Playing": two parallel FSMs (Network, Playback).

### TQ8. "What if I need to know the previous state?"

**A.** Store it. The Context can keep a `previousState` field; or the State can record its predecessor on transition. For full history, use Memento.

---

## Behavioral / Architectural Questions

### B1. "Tell me about a time you replaced a switch with State pattern."

Pick concrete: order management with status field; multiple methods had `switch (status)` chains. Refactored to OrderState interface + Concrete States. Each transition's logic centralized in source state. Adding new states became adding classes.

### B2. "How would you design an order management FSM at scale?"

Status in DB with CHECK constraint. Transitions enforced server-side via optimistic locking. Audit log of every transition. State pattern in code for clarity; DB for persistence. For complex flows (saga across services), workflow engine.

### B3. "Walk me through XState in a React app."

Define machine declaratively. Interpret it; state changes drive re-renders. Visualize via Stately's tools. Test machine independently of components. Replaces scattered `useState` + `useEffect` for complex flows.

### B4. "Your FSM has 50 states. What would you do?"

Audit: are these really distinct states? Look for hierarchy (5 base states × 10 substates). Look for parallel dimensions (independent flags as separate FSMs). If still 50, use a workflow engine or statechart library.

### B5. "How do you reconcile state mismatch between code and DB?"

Periodic reconciliation jobs that detect drift. Alert on mismatches. Validate state on every load. For event-sourced systems, replay events to derive truth; compare with stored snapshot.

### B6. "When would you choose a workflow engine over hand-rolled FSM?"

Long-running flows (days+). Distributed across services. Need replay/audit/observability. Many concurrent instances. Hand-rolled FSM for short, in-process flows; engines for the rest.

---

## Tips for Answering

1. **Lead with intent.** "State pattern lets an object's behavior change with its internal mode."
2. **Always give a concrete example.** Order lifecycle, vending machine, media player.
3. **Distinguish from Strategy early.** Senior interviewers probe.
4. **Mention sealed types** for type safety.
5. **Persistence is the senior signal.** State machines that survive restarts.
6. **Statecharts beat flat FSMs at scale.** Hierarchy + parallel + history.
7. **Concurrency: optimistic locking or per-context single-thread.** Show maturity.
8. **Workflow engines for long-running.** Don't reinvent at scale.

[← Professional](professional.md) · [Tasks →](tasks.md)

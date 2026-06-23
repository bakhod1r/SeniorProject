# State — Interview

## 1. How to use this file

This is 25 questions in interview order — junior to staff — plus three live-coding prompts, a concept-check list, and the signals interviewers actually grade on. Each question has a **short answer** (the length you'd give in the room — two to five sentences), and where it matters, a **follow-up to expect** so you're not surprised when the interviewer pushes one layer deeper.

Read top to bottom on first pass. On revision, skim the short answers and re-read only the ones you stumbled on. The live-coding section is for muscle memory — type the solutions out at least once, don't just read them.

If you can't answer any question in section 7 (Concept checks) in one breath, study more before the interview.

---

## 2. Junior questions (Q1–Q7)

### Q1. What is the State pattern?

**Short answer:** The State pattern (GoF) lets an object change its behavior when its internal mode changes — to the caller it looks like the object switched classes. Concretely: extract each mode into its own type, give the host (the "context") a pointer to the current state, and route every behavior call through that pointer. To transition, swap the pointer. The point is to replace a fat `switch status { ... }` spread across many methods with a small set of state objects, each owning its own rules.

**Follow-up to expect:** What's the host called? Answer: the **Context** — the object whose behavior changes. The state objects implement the interface; the Context forwards calls to whichever state it currently points at.

---

### Q2. Why prefer State over a status `switch`?

**Short answer:** A status `switch` works for two states. It collapses at five. Every method grows a parallel `switch` over the same status, and adding a new mode means editing every method *and* every switch. The State pattern inverts that: each state is one type, owning all of *its* rules in one place. Adding a state adds a type; adding a method adds one method per type. Reading "what does `Paid` allow?" is one file, not a grep across the codebase.

**Follow-up to expect:** When *is* a switch fine? Answer: two or three states with one or two methods, no transition logging, no persistence — a parser flag, a connection's bool. Don't reach for State to model `open/closed`.

---

### Q3. Show a minimal State in Go.

**Short answer:**

```go
type OrderState interface {
    Pay(*Order) error
    Ship(*Order) error
    Name() string
}

type Order struct{ state OrderState }

func (o *Order) setState(s OrderState) { o.state = s }
func (o *Order) Pay() error            { return o.state.Pay(o) }
func (o *Order) Ship() error           { return o.state.Ship(o) }

type Pending struct{}
func (Pending) Name() string         { return "pending" }
func (Pending) Pay(o *Order) error   { o.setState(Paid{}); return nil }
func (Pending) Ship(o *Order) error  { return errors.New("can't ship unpaid") }

type Paid struct{}
func (Paid) Name() string        { return "paid" }
func (Paid) Pay(o *Order) error  { return errors.New("already paid") }
func (Paid) Ship(o *Order) error { o.setState(Shipped{}); return nil }
```

Three pieces: an interface, a context with a state pointer, one type per mode. Each state owns its own answers; the context just forwards.

**Follow-up to expect:** Why pointer receivers vs value receivers on the states? Answer: states here are zero-sized; value receivers are cheaper and there's nothing to mutate. If a state carries per-instance data, pointer receivers — but in practice a stateless flyweight per state name is the cleanest shape.

---

### Q4. Difference between State and Strategy?

**Short answer:** Strategy is "pick an algorithm now, swap it later by request" — the caller chooses. State is "the object decides its own next mode based on what just happened" — the states choose. Strategy objects don't know about each other; state objects almost always do (or at least know which states exist to transition to). Mechanically they look identical — both are an interface plus implementations on a context. Semantically they differ in *who* drives the swap and *why*.

**Follow-up to expect:** Give an example of both in one system. Answer: a payment processor uses Strategy to pick a payment provider (Stripe vs Adyen — caller picks). The Order workflow uses State for its lifecycle (Pending → Paid → Shipped — internal transitions). Same codebase, different patterns.

---

### Q5. What's the Context in State?

**Short answer:** The Context is the object the outside world holds and calls — the `Order`, the `Connection`, the `Door`. It owns the current state pointer and forwards behavior calls. It also owns any data shared across states (the order ID, the connection's socket, the door's lock combination) — the so-called "blackboard". States operate on the Context but don't usually replace it; the Context outlives any individual state.

**Follow-up to expect:** Should the Context decide transitions or should states? Answer: states. If the Context's `Pay()` contains `if status == X { ... }`, you've reinvented the switch. Let `state.Pay(ctx)` return the next state (or set it on the context) — the Context is a forwarder, not a decision-maker.

---

### Q6. When have you seen State in the standard library?

**Short answer:** `text/template/parse/lex.go` uses the state-function form — `type stateFn func(*lexer) stateFn`, with `lexText`, `lexAction`, `lexLeftDelim` and so on. `net/http`'s server has a `connState` enum (`StateNew`, `StateActive`, `StateIdle`, `StateClosed`) used by `ConnState` hooks — informal State. `encoding/json`'s scanner is a hand-written FSM. `net.Conn` implementations carry a TCP-style state internally. Anything that lexes or parses input in Go is almost certainly a state machine; anything that manages a connection lifecycle is too.

---

### Q7. What's a transition vs an event?

**Short answer:** An **event** is the input — `Pay`, `Ship`, `Cancel`, "byte arrived", "timer fired". A **transition** is the move from one state to another *triggered by* an event. Events arrive from the outside; transitions are how the FSM responds. The same event may cause different transitions in different states (or no transition at all). Beginners conflate them — they say "the Pay transition fired" when they mean "the Pay event arrived". Be precise in interviews; FSM vocabulary matters.

**Follow-up to expect:** What's a guard then? Answer: a condition that must hold for an event to actually cause a transition. `Pay` is the event; `Pending → Paid` is the transition; `amount > 0 && account != frozen` is the guard. Event + guard = transition fires.

---

## 3. Middle questions (Q8–Q15)

### Q8. What are the three Go forms for state machines, and when do you pick each?

**Short answer:** Three shapes, same semantics, very different ergonomics.

- **Behavior-per-state types** — the classic GoF form. One interface, one type per state, behavior lives on the type. Pick when each state has distinct, non-trivial logic — parser modes, game character states, REPL phases.
- **State-function machines** — `type stateFn func(*M) stateFn`. The state *is* a function; running it returns the next function. Pick for linear or streaming flows — lexers, scanners, hand-written protocol parsers. Rob Pike's lexer is the canonical example.
- **Table-driven FSMs** — `(state, event) -> (newState, action)` encoded as data. Pick when the graph is large but per-state logic is uniform — TCP, declarative workflows, anything you want to render as a diagram.

The mistake is using the wrong shape: behavior-per-state for a 200-state TCP machine, table-driven for a parser with three modes. The graph size and uniformity decide for you.

**Follow-up to expect:** Can you mix them? Answer: yes, routinely. A `Machine` struct (behavior form) whose `Send` consults a transition table (table-driven) and whose individual states sometimes embed a streaming sub-lexer (state-function). One pattern at the architectural layer; the others at the leaves.

---

### Q9. Why did Rob Pike use state-functions for the template lexer?

**Short answer:** Three reasons. (1) The lexer is essentially linear — each state has one or two natural next states, so encoding the graph as data would be overkill. (2) No interface dispatch, no allocation per transition — a state-function is a function pointer, the loop just keeps calling. (3) Each `stateFn` reads like a tiny program — "consume whitespace, then if you see `{{` return `lexAction`" — which is exactly how a human reads a lexer. The shape *is* the algorithm.

The talk where he explains it (*Lexical scanning in Go*, GopherCon 2011) is essential viewing. The technique generalizes to any streaming consumer that has a small number of modes and natural "next-mode" jumps.

**Follow-up to expect:** Why not goroutines and channels for the lexer? Answer: he tried it first (the talk shows the intermediate version) and switched to state-functions because the goroutine version made testing harder and added concurrency for a job that was inherently sequential. Lesson: don't reach for concurrency primitives when the problem isn't concurrent.

---

### Q10. How do you log transitions properly?

**Short answer:** Log at the machine, not in each state's body. A single `Transition(next State)` method on the machine emits one structured log line — `from`, `to`, `event`, `actor`, `attempt_id`, `latency_ms` — and then swaps the pointer. Reasons: (1) one place to change format; (2) every state automatically logged, no risk of a state forgetting; (3) the log is the audit trail — if the field is missing, the audit is incomplete.

```go
func (m *Machine) Transition(ev Event, next State) {
    m.log.Info("state.transition",
        "from", m.state.Name(),
        "to", next.Name(),
        "event", ev.Name(),
        "actor", ev.Actor(),
        "entity_id", m.id,
    )
    m.state.Exit(m)
    m.state = next
    m.state.Enter(m)
}
```

For production: also write to an audit table or topic. Logs roll off; audits don't.

---

### Q11. What are Enter/Exit hooks and when do you need them?

**Short answer:** Hooks that fire when a state is entered or left. `Enter` runs setup — start a watchdog timer, open a connection, mark a row "in progress". `Exit` runs teardown — stop the timer, close the connection, mark the row done. You need them whenever a state has a *side effect that should outlive the transition itself* — anything that allocates a resource or schedules future work. Without `Exit`, you leak resources every time the machine moves on; without `Enter`, you have to remember to set things up from the caller, and you'll forget.

**Follow-up to expect:** What about `OnTransition` — a hook per (from, to) edge? Answer: useful when the side effect belongs to the *edge*, not either state — "log a refund record when moving from `Paid` to `Refunded`". For most machines, `Enter`/`Exit` on states is enough.

---

### Q12. How do you persist a state machine's state?

**Short answer:** Store the *name* of the state, not the object. The state object is behavior (methods); the persistent layer is data. Three columns minimum: `state` (string), `updated_at`, `version` (for optimistic concurrency). On load, look up the state object by name via a registry `map[string]State`. Anything per-state-specific lives on the Context's row, not in the state object.

```go
type Order struct {
    ID        string
    State     string    // "pending" | "paid" | ...
    UpdatedAt time.Time
    Version   int       // optimistic lock
    // ... domain fields
}

var states = map[string]OrderState{
    "pending":   Pending{},
    "paid":      Paid{},
    "shipped":   Shipped{},
    "cancelled": Cancelled{},
}

func Load(id string) (*OrderMachine, error) {
    var o Order
    if err := db.Get(&o, id); err != nil { return nil, err }
    s, ok := states[o.State]
    if !ok { return nil, fmt.Errorf("unknown state %q", o.State) }
    return &OrderMachine{order: o, state: s}, nil
}
```

A senior answer mentions that an unknown stored state on load is a *real* failure case to handle, not a panic — old code may have written values your new build no longer recognizes.

---

### Q13. Show a guard and an action in code.

**Short answer:** A guard is "may this transition fire?". An action is "what side effect runs as part of the transition?". The order is **guard → action → state swap**, and if the action fails you need a policy.

```go
type Transition struct {
    From, Event, To string
    Guard  func(m *Machine) error
    Action func(m *Machine) error
}

var T = []Transition{{
    From: "pending", Event: "pay", To: "paid",
    Guard: func(m *Machine) error {
        if m.order.Amount <= 0 {
            return errors.New("zero-amount order")
        }
        return nil
    },
    Action: func(m *Machine) error {
        return m.payments.Charge(m.order)
    },
}}

func (m *Machine) Send(event string) error {
    t := find(m.state, event)
    if t == nil { return ErrInvalidTransition }
    if err := t.Guard(m); err != nil { return err }
    if err := t.Action(m); err != nil { return err }   // <- failure policy lives here
    m.state = t.To
    return m.save()
}
```

The decision a senior makes explicit: if `Action` succeeds but `save()` fails, you've done the side effect with no persisted state change. The fix is either an outbox table, a transactional message bus, or making the action idempotent and replayable.

---

### Q14. How do you make a state machine safe under concurrent input?

**Short answer:** Two idiomatic patterns. (1) **Mutex-guarded `Send`** — every event acquires the machine's lock, dispatches, swaps state, releases. Simple, ordering-by-arrival-time-isn't-guaranteed. (2) **Channel-fed loop** — one goroutine owns the machine, events arrive on a channel, the goroutine processes them in order. Idiomatic Go, perfectly serialized, but adds buffering and backpressure decisions.

```go
// Pattern 2 — channel-fed:
func (m *Machine) run() {
    for {
        select {
        case ev := <-m.events:
            m.handle(ev)
        case <-m.ctx.Done():
            return
        }
    }
}
```

A bad answer skips the question and uses `atomic.StorePointer` on the state field directly. That fixes the read/write race but not the *transition* race — two goroutines both deciding "from `Pending`, on `Pay`, go to `Paid`" might both try to charge the card. Atomic on the field is necessary, not sufficient; you need atomic on the *transition*, which means a lock or an actor.

**Follow-up to expect:** What's wrong with mutex around the whole `Send`? Answer: the action may do I/O — charging a card, calling an API — and holding a lock across I/O is a deadlock waiting to happen. Pattern: take the lock to check the state and stage the transition, release it for the I/O, reacquire to commit. Or use an actor loop and avoid the question entirely.

---

### Q15. What happens if the action fails halfway through a transition?

**Short answer:** You have a choice — and the worst answer is "we'll figure it out". The four real options:

1. **Transactional FSM** — guard, action, and state swap are one DB transaction. If anything fails, roll back. Only works if the action is purely a DB write.
2. **Move to a `failed` state** — surface the failure as a real state, retry from there or escalate to a human. Best when the action has external side effects you can't roll back.
3. **Retry the action** — only safe if the action is idempotent. Add an idempotency key, attempt counter, max attempts.
4. **Saga / compensating action** — for distributed actions, register a compensation that undoes prior steps if a later step fails.

A senior picks one *per transition*, not one for the whole FSM. Charging a card is option 4 (Saga). Sending a marketing email is option 3 (idempotent retry). Writing a row in the same DB is option 1 (transaction). Document the choice in code — `Action` with a comment "// idempotent, safe to retry".

---

## 4. Senior questions (Q16–Q22)

### Q16. Design a durable order workflow with retries.

**Short answer:** Five components, each chosen to survive process restarts.

(1) **Persistent state** — the order row in Postgres carries `state`, `version`, `next_retry_at`, `attempt_count`, `last_error`. Source of truth, not the in-memory machine.

(2) **Stateless workers** — each worker loads the order, runs one transition, saves, releases. Workers are interchangeable; killing one only loses in-flight work that retries.

(3) **Transition table** — declarative `[]Transition{...}` with `From`, `Event`, `To`, `Guard`, `Action`. The table is data; can be rendered as a Graphviz diagram for review.

(4) **Retry policy per transition** — `MaxAttempts`, `Backoff` (exponential with jitter), and `OnFailure` (move to `failed`, dead-letter, escalate). Stored on the transition definition, not in worker code.

(5) **Outbox for side effects** — actions that publish events (`OrderPaid`) write to an outbox table in the same transaction as the state change. A separate dispatcher publishes from the outbox. Solves the "DB committed, queue publish failed" dual-write problem.

The senior move is recognizing this is what **Temporal** and **Cadence** give you for free, and that rolling your own is a multi-quarter project. If the team has Postgres and a single domain, the pattern above is sufficient. If you need cross-service workflows, child workflows, signals, timers — buy Temporal, don't build.

**Follow-up to expect:** Why version on the row? Answer: optimistic concurrency. Two workers picking up the same order with `WHERE id = ? AND version = ?` — only one wins. The loser retries with the fresh row. No row-level locks, no `SELECT FOR UPDATE` contention.

---

### Q17. Event sourcing vs current-state — when to choose each?

**Short answer:** **Current-state** stores `state="paid"` on the row. Fast reads, simple, every update overwrites history (unless you separately audit). **Event sourcing** stores an append-only log of events — `OrderPlaced`, `OrderPaid`, `OrderShipped` — and computes the current state by replaying. Source of truth is the event log.

Pick event sourcing when: (a) the history *is* the business — financial ledgers, audit-heavy domains, regulatory compliance; (b) you need to answer "what did the state look like at 3pm yesterday?"; (c) you'll have multiple read projections (materialized views) of the same events.

Pick current-state when: (a) the history is incidental — you just need to know the current mode; (b) reads dominate writes and need to be cheap; (c) the team doesn't have CQRS/projection experience.

A senior answer warns about the migrations problem: event-sourced systems can't just `ALTER TABLE`. The events are immutable; you upgrade by adding a *new* event type, projecting both old and new, and eventually retiring the old. Costlier than people think.

**Follow-up to expect:** Can you combine them? Answer: yes — *current-state with audit log*. Update the row in-place for fast reads, append every transition to an `audit` table for history. Cheaper than full event sourcing and covers 90% of the audit use case. Banks and order systems often run this way.

---

### Q18. How do you migrate an FSM with 10M in-flight entities to a new state set?

**Short answer:** Five phases, never one-shot.

(1) **Expand** — add the new states alongside the old. New code handles both. Old code untouched. Deploy. No data migrated yet.

(2) **Backfill mapping** — write a script that maps old states to new ones. `pending → awaiting_payment`, `paid → payment_confirmed`. Run on a small sample, verify, then in batches with rate limits and idempotency.

(3) **Dual-write** — the FSM writes both `state` (old) and `state_v2` (new) on every transition. Reads still hit `state`. Confidence-builder: if the two diverge, alarm.

(4) **Cut reads over** — flip the read path to `state_v2`. Old `state` column still updated but unused. Bake time: at least one full retry/timeout cycle for the longest-lived entity.

(5) **Contract** — remove the old code, drop the old column, archive the script. Only after the longest-lived in-flight entity completes — for orders that might be 30 days, for subscriptions a year.

Anti-patterns: stop-the-world migrations (the FSM can't be paused for 10M entities), runtime branches based on entity creation date (lifetime branches forever), schema changes without a rollback path. A senior answer references this as the **expand-contract pattern**, common in DB migrations.

---

### Q19. Mutex vs `atomic.Pointer[State]` for the state field — pros/cons.

**Short answer:** `atomic.Pointer[State]` is faster on reads (no lock contention) and gives you a lock-free read path. It's wrong for almost every real FSM. Reason: atomic gets you a consistent read of the *pointer*, but a transition is `read-current → compute-next → write-new` — three operations that need to be atomic as a *unit*. If two goroutines both see `Pending` and both write `Paid`, you've charged the card twice. Atomic prevents tearing; it doesn't prevent races.

Mutex (or actor loop) is correct because it serializes the whole transition decision. `atomic.Pointer` is appropriate when (a) the FSM is read-mostly and the few transitions can use `CompareAndSwap` to ensure no other transition slipped in, or (b) the state is purely advisory and races are tolerable — neither is the common case.

A senior answer ends with: **prefer the actor pattern** (one goroutine owns the machine, events arrive on a channel) — it side-steps both the mutex deadlock-across-IO problem and the atomic incorrectness, while reading like idiomatic Go.

**Follow-up to expect:** What about `sync.RWMutex`? Answer: writes are rare; reads are common. RWMutex helps if read throughput is high — querying "what state are you in?" from many goroutines. For pure-write workflows it's slower than a plain `Mutex` because of bookkeeping. Profile before reaching for it.

---

### Q20. Hierarchical state machines — what do they buy you in Go?

**Short answer:** **Hierarchical state machines (HSMs)** let states contain sub-states — `Connected` has child states `Authenticating`, `Active`, `Idle`. Behavior and transitions inherit: a `Disconnect` event in any `Connected` sub-state transitions to `Disconnected` without each sub-state declaring it.

What they buy you: (1) collapse of duplicate transitions ("from any active state on shutdown → closing"); (2) modeling of "modes within modes" naturally — UI tabs (`Logged in: {Browsing, Editing, Saving}`); (3) clearer diagrams when the flat FSM would have 50 edges of "anything → Error".

What they cost in Go: there's no language support. You build it manually — usually as nested machines, where the outer machine's "Connected" state owns an inner machine for sub-state. Libraries like `qmuntal/stateless` support hierarchy declaratively, which is what most Go teams reach for if they need it.

A senior answer notes that **most Go FSMs do not need hierarchy**. UML's HSM formalism (Harel statecharts) is powerful but heavy. Reach for HSM when the flat FSM has more than ~20 states with obvious groupings; otherwise it's overengineering.

---

### Q21. A workflow is stuck in `Processing` for 2 hours. How do you detect, alert, and recover?

**Short answer:** Three layers.

**Detection.** Every state has a *budget* — `Processing` is supposed to last 5 minutes. A scheduled job (`SELECT id FROM orders WHERE state='processing' AND updated_at < now() - interval '5 min'`) finds violators every minute. The query is cheap if `state, updated_at` is indexed; you should have that index from day one.

**Alerting.** Stuck entities go to a dashboard (count by state, oldest by state) and a paging alert on the rate of new stuck entities or the depth of the stuck queue. The alert says "5 orders stuck in Processing > 10 min" — actionable, not "high error rate".

**Recovery.** Per-state policy: (a) retry the action with idempotency — most common, handles transient failures; (b) move to a `failed` state for human review — when retries are exhausted or the input is bad; (c) skip the state ("Processing → Skipped → Complete") — only if the business allows it. The recovery worker is a separate process or cron, not part of the request path.

The deeper lesson: **every long-lived state needs a timeout**. The FSM definition should include `MaxDuration` per state; the heartbeat checker is generic over the table. Without this, you discover stuck entities six months in when a customer complains.

**Follow-up to expect:** What's a heartbeat for active long-running work? Answer: the worker periodically writes `last_heartbeat_at` on the row. Stuck detection becomes "no heartbeat for > 2x heartbeat interval". Distinguishes "actively processing slowly" from "process died holding the lock".

---

### Q22. How do you test a 30-state FSM without writing 900 test cases by hand?

**Short answer:** **Generate** the tests from the transition table. The table already declares every legal `(state, event) → newState`; iterate it for happy-path tests. The illegal set is `{all states} × {all events} \ table` — generate those too and assert they all error.

```go
func TestAllTransitions(t *testing.T) {
    for _, tr := range orderFSM {
        t.Run(fmt.Sprintf("%s_%s", tr.From, tr.Event), func(t *testing.T) {
            m := newAt(tr.From)
            err := m.Send(tr.Event)
            require.NoError(t, err)
            require.Equal(t, tr.To, m.State())
        })
    }
}

func TestInvalidTransitions(t *testing.T) {
    for _, s := range allStates {
        for _, e := range allEvents {
            if isLegal(s, e) { continue }
            t.Run(fmt.Sprintf("%s_%s_invalid", s, e), func(t *testing.T) {
                m := newAt(s)
                require.Error(t, m.Send(e))
            })
        }
    }
}
```

Add **property-based** tests for graph invariants: every state is reachable from the initial state; every state can reach a terminal state (no dead-ends); no cycles unless intentional; the union of all transitions never visits an undefined state. Property tests catch the bugs `(state, event)` enumeration misses.

Finally, a **soak test** that fires random events at the machine for thousands of iterations and asserts it never panics, never enters an unknown state, and always advances toward terminal. Property + soak + table enumeration = high confidence with low keystrokes.

---

## 5. Staff/Architect questions (Q23–Q25)

### Q23. Design Temporal-lite: a tiny durable workflow engine in Go.

**Short answer:** Six components, each justified by a Temporal feature you'd lose without it.

(1) **Workflow definition** — a Go function that calls activities. `func PaymentWorkflow(ctx workflow.Context, orderID string) error { ... }`. The engine intercepts every activity call, persists the intent, returns control on the next "yield point". This is the trickiest part: in real Temporal it's done via determinism + replay; in Temporal-lite, do it explicitly — the workflow yields by returning a `Step` value, the engine schedules it, persists, resumes.

(2) **Activity registry** — `map[string]func(ctx, json.RawMessage) (json.RawMessage, error)`. Activities are pure work units; they can fail and retry independently. Inputs and outputs are JSON, so they survive restarts.

(3) **Persistent event history** — every step is appended to `workflow_events(workflow_id, seq, type, payload)`. State is the *reduction* of the events. On restart, the engine replays events to reach the current step, then continues.

(4) **Scheduler** — a worker pool polls `workflow_steps WHERE next_run_at <= now() AND status='pending'`. For each row, look up the activity, run it with a deadline, write the result event, advance the workflow.

(5) **Retry + backoff per activity** — `attempts`, `max_attempts`, `next_run_at` with exponential backoff and jitter. The retry policy is per-activity-type, configurable.

(6) **Signals and timers** — signals are external events that arrive at the workflow (`signal_received` rows); timers are scheduled events (`timer_fire` rows). Both are just more event types in the history.

A staff candidate names what they're *not* building: cross-workflow queries, sticky workflow execution caches, history sharding, multi-cluster replication — the things that make real Temporal a multi-year project. The pitch is: "for a single domain with bounded workflow complexity, a 2000-line Go service with Postgres can give you 80% of Temporal at 1% of the operational cost".

**Follow-up to expect:** When does Temporal-lite hit the wall? Answer: when workflow definitions need to be deterministically replayable across deployments (Temporal solves this with versioning APIs), when you need cross-workflow signaling at scale, or when history size per workflow exceeds what a row can hold. At that point, buy Temporal.

---

### Q24. Distributed FSM across two services — how do you keep them in sync?

**Short answer:** You don't make one FSM span two services. That's the first mistake. Instead, each service owns its own FSM, and they communicate via **events** — durable, ordered, idempotent.

Concretely: Service A owns the `Order` FSM (`Placed → Paid → Shipped`). Service B owns the `Shipment` FSM (`Created → InTransit → Delivered`). When `Order` transitions to `Paid`, A emits `OrderPaid` (via outbox + queue). B consumes the event and transitions `Shipment: created`. When the shipment completes, B emits `ShipmentDelivered`; A consumes it and transitions `Order: shipped`.

Sync mechanisms:

(1) **Outbox pattern** — the source writes the event to a local `outbox` table in the same transaction as the state change. A dispatcher publishes from the outbox. Eliminates the dual-write problem.

(2) **Idempotent consumers** — every consumer dedupes by event ID. If a queue delivers twice, the second delivery is a no-op. Required because every real queue is at-least-once.

(3) **Saga compensation** — if A says "Paid" but B can't ship (no inventory), B emits `ShipmentFailed`; A's FSM has a transition `Paid → Refunding`. The compensation is itself a state transition, not a bolted-on undo.

(4) **Eventually consistent reads** — the join of A's and B's data is eventually consistent. Anything that needs both ("show me orders with shipping status") reads a projection that's updated by event consumers, not a live join.

The mistake staff candidates call out: trying to make both FSMs transition together via 2PC or distributed transactions. Don't. Two FSMs, events between them, each idempotent, each with its own state. Sagas for failure handling. That's the architecture.

**Follow-up to expect:** What about ordering? Answer: per-entity ordering matters; global ordering rarely does. Use the entity ID as the partition key in Kafka / use a per-order outbox cursor in Postgres-based pipelines. Cross-entity ordering is almost never a real requirement.

---

### Q25. The PM wants to add a "soft cancel" state next sprint. How do you design the rollout?

**Short answer:** Six steps, never one PR.

(1) **Design review** — what does "soft cancel" mean? Pause vs withdraw vs grace-period? Who can issue it? Which states can transition into it? Which states can it transition into (uncancel, cancel-hard)? Get the answers in writing before code.

(2) **Add the state, gated** — new state `soft_cancelled`, new transitions added to the table, but feature-flagged off. Existing code continues to work because the new transitions are unreachable. Deploy quietly.

(3) **Persistence migration** — the `state` column already stores strings, so `soft_cancelled` Just Works for storage. The query `WHERE state = 'cancelled'` may need to become `WHERE state IN ('cancelled', 'soft_cancelled')` in some places — find every consumer of the state column (probably more than expected) and audit.

(4) **Backfill or not?** — usually no backfill: existing `cancelled` orders stay `cancelled`. If product asks for backfill ("convert all recent cancels to soft cancels"), it's a separate migration with its own rollout.

(5) **Enable for a sliver** — flip the flag for 1% of traffic or a specific tenant. Watch the dashboards: transitions to the new state, transitions out, error rate on adjacent transitions. Compare to baseline.

(6) **Document the lifecycle** — update the FSM diagram, the runbook, the on-call notes. "What does soft cancel mean to support?" must have an answer.

The staff signal is recognizing that **adding a state is a cross-cutting change**, not a one-line PR. The state table is consumed by transitions, by views, by reports, by analytics, by exports, by the search index. Every consumer is a place the new state might break or be silently ignored. The rollout is one part code, three parts inventory of every consumer.

**Follow-up to expect:** What if the team can't enumerate every consumer? Answer: that's the actual problem. Before adding the state, build the consumer inventory — `grep -r 'state =' src/`, queries against the data warehouse, dashboard panel definitions. The next-sprint estimate triples once the list is honest. Better to surface that now than at rollout.

---

## 6. Live-coding prompts

### Prompt 1: Vending machine FSM

**Problem.** Implement a vending machine FSM with three states: `Idle`, `HasCoin`, `Dispensing`. Events: `InsertCoin`, `SelectItem`, `Dispense`, `Refund`. Invalid events return an error without changing state. A `Dispense` from `HasCoin` either succeeds (→ `Idle`) or fails (→ `Idle` with refund logged). Show transition logging and a guard (`SelectItem` requires `HasCoin`).

**Answer.**

```go
package vending

import (
    "errors"
    "fmt"
    "log/slog"
)

type State string

const (
    Idle       State = "idle"
    HasCoin    State = "has_coin"
    Dispensing State = "dispensing"
)

type Event string

const (
    InsertCoin Event = "insert_coin"
    SelectItem Event = "select_item"
    Dispense   Event = "dispense"
    Refund     Event = "refund"
)

type Machine struct {
    state    State
    selected string
    log      *slog.Logger
    stock    map[string]int
}

func New(log *slog.Logger, stock map[string]int) *Machine {
    return &Machine{state: Idle, log: log, stock: stock}
}

// Send is the single entry point. Centralizing dispatch means every transition
// is logged uniformly and invalid events fail the same way everywhere.
func (m *Machine) Send(ev Event, arg string) error {
    next, err := m.transition(ev, arg)
    if err != nil {
        // Log invalid attempts at Info, not Warn — they're user error, not bugs.
        m.log.Info("vending.invalid_event", "state", m.state, "event", ev, "err", err)
        return err
    }
    m.log.Info("vending.transition", "from", m.state, "to", next, "event", ev)
    m.state = next
    return nil
}

// transition returns the next state without mutating. Pure functions are
// easier to test and easier to reason about under concurrency.
func (m *Machine) transition(ev Event, arg string) (State, error) {
    switch m.state {
    case Idle:
        switch ev {
        case InsertCoin:
            return HasCoin, nil
        }
    case HasCoin:
        switch ev {
        case SelectItem:
            // Guard: item must exist and be in stock.
            if m.stock[arg] <= 0 {
                return m.state, fmt.Errorf("out of stock: %s", arg)
            }
            m.selected = arg
            return Dispensing, nil
        case Refund:
            // Refund returns the coin and clears any selection.
            m.selected = ""
            return Idle, nil
        }
    case Dispensing:
        switch ev {
        case Dispense:
            // Action: decrement stock. If this were a real machine, the action
            // might fail (motor jam) — we'd log and refund.
            if m.stock[m.selected] <= 0 {
                m.log.Warn("vending.dispense_failed", "item", m.selected)
                m.selected = ""
                return Idle, nil // failed but recovered
            }
            m.stock[m.selected]--
            m.selected = ""
            return Idle, nil
        }
    }
    return m.state, errors.New("invalid event for state")
}

func (m *Machine) State() State { return m.state }
```

Senior moves: (a) `transition` is pure — easy to test, no logging side-effect to mock; (b) invalid events log at `Info`, not `Warn`, because they're expected user behavior; (c) the stock guard is on `SelectItem`, not `Dispense` — fail fast, not after taking the coin; (d) `Dispense` failure transitions to `Idle` (refund) rather than getting stuck — every state has an exit even on partial failure; (e) state and event are typed `State` / `Event` (string newtypes) so the compiler catches typos.

---

### Prompt 2: TCP-like state machine

**Problem.** Implement a TCP-like state machine with states `Closed`, `Listen`, `SynRecv`, `Established`, `CloseWait`, `Closed` (terminal). Events: `Listen`, `Syn`, `Ack`, `Fin`, `Close`. Encode legal transitions as a table; reject invalid transitions with a clear error.

**Answer.**

```go
package tcpfsm

import (
    "fmt"
    "log/slog"
)

type State string

const (
    Closed      State = "CLOSED"
    Listen      State = "LISTEN"
    SynRecv     State = "SYN_RECV"
    Established State = "ESTABLISHED"
    CloseWait   State = "CLOSE_WAIT"
)

type Event string

const (
    EvListen Event = "LISTEN"
    EvSyn    Event = "SYN"
    EvAck    Event = "ACK"
    EvFin    Event = "FIN"
    EvClose  Event = "CLOSE"
)

type transition struct {
    From  State
    Event Event
    To    State
}

// The transition table IS the spec. A diagram can be generated from this slice;
// a reviewer can verify completeness by reading it; tests can iterate it.
// Anything not listed is invalid by construction.
var table = []transition{
    {Closed, EvListen, Listen},
    {Listen, EvSyn, SynRecv},
    {SynRecv, EvAck, Established},
    {Established, EvFin, CloseWait},
    {CloseWait, EvClose, Closed},
    // Note: real TCP has more states (SYN_SENT, FIN_WAIT_1/2, TIME_WAIT, etc.) —
    // this is the simplified passive-open path. In an interview, mention that
    // explicitly so the interviewer knows you understand what you're omitting.
}

type Machine struct {
    state State
    log   *slog.Logger
}

func New(log *slog.Logger) *Machine { return &Machine{state: Closed, log: log} }

func (m *Machine) Send(ev Event) error {
    for _, t := range table {
        if t.From == m.state && t.Event == ev {
            m.log.Info("tcp.transition", "from", t.From, "to", t.To, "event", ev)
            m.state = t.To
            return nil
        }
    }
    // No matching transition — invalid.
    return fmt.Errorf("invalid event %s in state %s", ev, m.state)
}

func (m *Machine) State() State { return m.state }

// IsLegal exposes the transition table for tests and tooling.
// Lets the test suite enumerate (state × event) and assert legality
// matches the table without re-implementing the rules.
func IsLegal(from State, ev Event) bool {
    for _, t := range table {
        if t.From == from && t.Event == ev {
            return true
        }
    }
    return false
}
```

Senior moves: (a) the transition table is the spec — readable, testable, diagrammable; (b) state and event are typed string newtypes so the type system catches `Send("syn")` typos; (c) `IsLegal` is exported so test suites can iterate the full Cartesian product and assert "every legal pair succeeds, every illegal pair errors" without duplicating the table; (d) the comment names what's omitted (FIN_WAIT_1/2, TIME_WAIT) — interviewers grade on knowing what you simplified; (e) no per-state structs because the per-state behavior is identical (lookup + swap) — table-driven is the right shape for this FSM.

---

### Prompt 3: Generic FSM library

**Problem.** Build a reusable FSM type using generics: `New[S, E comparable]() *Machine[S, E]` with `Allow(from S, ev E, to S, action func() error)`, `Send(ev E) error`, `State() S`. Concurrent `Send` calls must serialize. Invalid transitions error; action failures abort the transition.

**Answer.**

```go
package fsm

import (
    "errors"
    "fmt"
    "sync"
)

// Machine is a generic finite state machine. S and E must be comparable so
// they can be used as map keys — strings, typed ints, and named string types
// all qualify. Structs work too if all fields are comparable.
type Machine[S comparable, E comparable] struct {
    mu          sync.Mutex
    state       S
    transitions map[key[S, E]]transition[S]
}

type key[S, E comparable] struct {
    From  S
    Event E
}

type transition[S comparable] struct {
    To     S
    Action func() error // nil = no-op
}

func New[S comparable, E comparable](initial S) *Machine[S, E] {
    return &Machine[S, E]{
        state:       initial,
        transitions: make(map[key[S, E]]transition[S]),
    }
}

// Allow registers a legal transition. Duplicate registrations panic — better
// to fail at startup than to silently overwrite a transition at runtime.
func (m *Machine[S, E]) Allow(from S, ev E, to S, action func() error) {
    k := key[S, E]{From: from, Event: ev}
    if _, exists := m.transitions[k]; exists {
        panic(fmt.Sprintf("fsm: duplicate transition from %v on %v", from, ev))
    }
    m.transitions[k] = transition[S]{To: to, Action: action}
}

var ErrInvalidTransition = errors.New("fsm: invalid transition")

// Send fires an event. The mutex serializes the entire transition so a slow
// action doesn't allow a second event to slip in and read stale state.
// Trade-off: an action holding the lock blocks every other Send. For long
// I/O, consider releasing the lock around the action and re-acquiring to
// commit — at the cost of needing to re-check the state didn't change.
func (m *Machine[S, E]) Send(ev E) error {
    m.mu.Lock()
    defer m.mu.Unlock()
    t, ok := m.transitions[key[S, E]{From: m.state, Event: ev}]
    if !ok {
        return fmt.Errorf("%w: %v on %v", ErrInvalidTransition, ev, m.state)
    }
    if t.Action != nil {
        if err := t.Action(); err != nil {
            // Action failed before state change — leave state untouched.
            // Caller's policy decides whether to retry, escalate, or move
            // to an error state via a separate Send.
            return err
        }
    }
    m.state = t.To
    return nil
}

func (m *Machine[S, E]) State() S {
    m.mu.Lock()
    defer m.mu.Unlock()
    return m.state
}

// Example:
//
//   type orderState string
//   type orderEvent string
//
//   const (
//       Pending orderState = "pending"
//       Paid    orderState = "paid"
//       Shipped orderState = "shipped"
//
//       Pay  orderEvent = "pay"
//       Ship orderEvent = "ship"
//   )
//
//   m := fsm.New[orderState, orderEvent](Pending)
//   m.Allow(Pending, Pay, Paid, func() error { return charge() })
//   m.Allow(Paid, Ship, Shipped, nil)
//   _ = m.Send(Pay)
//   _ = m.Send(Ship)
```

Senior moves: (a) generics on `S, E comparable` give type safety without `any` casts at call sites; (b) `key` is a generic struct, not a string concatenation — no collision risk between `"foo:bar"` and `"foo:bar"` overlapping states; (c) duplicate `Allow` panics at registration, not silently overwrites — bugs surface at startup; (d) mutex around the *whole* `Send` is the simple-correct choice; the doc comment names the trade-off (lock-around-action) and when to consider releasing; (e) the action runs *before* the state swap, so a failed action leaves state untouched — the documented behavior, not a bug; (f) `State()` also locks — calling code expects a coherent read, not a torn pointer.

---

## 7. Concept checks

If you can't answer any of these in one breath, study more before the interview.

- What's the difference between State and Strategy? (State: object picks its own next mode based on what happened. Strategy: caller picks an algorithm.)
- What's the difference between an event and a transition? (Event: input. Transition: response that moves states. Same event in different states may cause different transitions or none.)
- Why store the state *name*, not the state *object*, in the database? (Object is behavior, not data. Name + registry rehydrates the behavior.)
- Why does Rob Pike's lexer use `func` per state instead of an interface? (Linear flow, no dispatch cost, no allocation, reads top-to-bottom like the algorithm itself.)
- What's the three Go shapes for FSMs? (Behavior-per-state types, state-functions, table-driven.)
- Why is `atomic.Pointer[State]` insufficient for a real FSM? (Atomic prevents pointer tearing but not the read-decide-write race; two goroutines can both transition from the same state.)
- What does `Enter`/`Exit` do that `Tick` doesn't? (Lifecycle hooks for resources tied to a state — timers, locks, watchers — that must be torn down on exit.)
- What's the failure policy choice when an action fails mid-transition? (Transactional rollback, move-to-failed, retry-if-idempotent, or Saga compensation. Pick per transition.)
- What's a guard? (A boolean condition that must hold for an event to fire its transition. Event + guard = transition.)
- Why is the Outbox pattern relevant to FSMs? (State change + event publish must be atomic. Outbox makes them one DB transaction; a dispatcher publishes the event later.)
- What's the difference between current-state and event sourcing? (Current-state: overwrite. Event-sourced: append-only log of events; current state is a reduction.)
- When does an FSM need a heartbeat? (Long-running active states where the worker might die holding the entity. Detects "actively slow" vs "stuck dead".)
- What's expand-contract for FSM migrations? (Add new states alongside old, dual-write, cut over reads, then remove old. Never stop the world.)
- What does Temporal give you that a hand-rolled FSM doesn't? (Durable workflow execution with replay, retries with backoff, signals, timers, child workflows, history — months of engineering.)
- Why are illegal transitions worth enumerating in tests? (Catches new events accidentally accepted in old states, and old events silently dropped after refactors.)

---

## 8. Red flags for interviewers

These signal a weak candidate.

- **Switch statements that grow.** The candidate's first design has `switch status { case "pending": ... case "paid": ... }` and they don't notice the parallel switch in every method. No recognition that the State pattern *exists to remove* that growth.
- **No transition logging.** Asked how they'd debug a stuck workflow, the candidate says "we'd look at the DB". No structured log per transition, no audit trail, no idea where to look first.
- **State object stored in the database.** Serializing a Go struct that has methods, then deserializing into a moving target type. Breaks on redeploy. A senior stores the *name* and rehydrates via a registry.
- **No persistence story.** "The state lives in memory." For an order workflow. The candidate has never run an FSM across a process restart.
- **`switch` over the state pointer's type.** `switch s := m.state.(type) { case *Pending: ... case *Paid: ... }` — re-introduces the switch inside the pattern that's meant to remove it.
- **Mutex held across I/O.** Lock, call HTTP, unlock. Deadlock waiting to happen the moment one call hangs. No mention of releasing around the action or using an actor loop.
- **No discussion of concurrent input.** The candidate's `Send` reads `m.state`, mutates `m.state`, with no lock or channel. Asked about concurrency, they say "we'd add a mutex" — without recognizing that a mutex alone doesn't fix the read-decide-write race unless held for the *whole* decision.
- **Action and state-swap order undefined.** Candidate can't say whether the state changes before or after the action runs, and what happens if the action fails. Whatever they answer, the answer is "we'll figure it out".
- **Hierarchical state machines reflexively.** Reaching for HSMs for a 6-state workflow. Sign of having read a UML book, not having built FSMs in production.
- **No mention of Temporal/Cadence at staff level.** Asked to design a durable workflow engine, the candidate hand-rolls everything from scratch with no acknowledgment that this is a solved problem with mature tooling.

---

## 9. Strong-candidate signals

These signal a strong candidate.

- **Picks the FSM shape based on graph size and uniformity.** Behavior-per-state for distinct logic, state-function for linear streaming, table-driven for large uniform graphs. Justifies the choice, doesn't reach for one shape by default.
- **Names states with imperative verbs or noun-phases that read.** `AwaitingPayment`, `PaymentConfirmed`, `Shipped`, `Refunded` — not `State1`, `Pending`, `Paid` ambiguously. Names appear in dashboards and audit logs; clarity matters.
- **Stores the state name, not the object.** Knows the registry-on-load pattern by reflex. Mentions the failure mode when an unknown name appears (new code, old data).
- **Asks about concurrency early.** Before writing the FSM, asks: "are events serialized? Is this called from multiple goroutines? Is there backpressure?" Doesn't assume single-threaded.
- **Brings up `Enter` / `Exit` for resource lifecycle.** Without prompting, notes that some states need setup/teardown — start a timer on `Processing`, stop on `Done`. Hasn't been bitten by a leak yet, or has been bitten enough to remember.
- **Mentions Temporal / Cadence when discussing durable workflows.** Recognizes the problem as solved at scale. Knows when to buy and when to build.
- **Brings up the Outbox pattern for state-change-plus-event-publish.** Unprompted. Signals familiarity with production failure modes.
- **Splits action failures by type.** "Idempotent retry for transient, move-to-failed for permanent, Saga compensation for distributed." Per-transition policy, not one rule for the whole FSM.
- **Generates tests from the transition table.** Doesn't propose writing 900 cases by hand. Enumerates legal and illegal transitions programmatically; adds property tests for graph invariants.
- **Asks who owns the FSM definition.** In a 200-state workflow system, recognizes that ownership, versioning, and stability contracts are part of the answer. Architectural thinking, not just code.

---

## 10. Further reading

- **Refactoring.Guru — State**: <https://refactoring.guru/design-patterns/state> — the canonical pattern description, language-agnostic. Read first for the GoF framing.
- **Rob Pike, *Lexical Scanning in Go* (GopherCon 2011)**: <https://go.dev/talks/2011/lex.slide> — the state-function form, motivated step-by-step. Essential viewing if you'll ever write a parser in Go.
- **`text/template/parse/lex.go`**: <https://cs.opensource.google/go/go/+/refs/tags/go1.22.0:src/text/template/parse/lex.go> — production state-function lexer in the standard library. Short, idiomatic, worth reading end-to-end.
- **`qmuntal/stateless`**: <https://github.com/qmuntal/stateless> — declarative FSM library for Go with hierarchy, guards, and entry/exit actions. Read the README for an idiomatic API design.
- **Temporal Documentation — Workflows**: <https://docs.temporal.io/workflows> — durable execution engine. Required reading once you've outgrown hand-rolled FSMs and need durable, replayable workflows at scale.

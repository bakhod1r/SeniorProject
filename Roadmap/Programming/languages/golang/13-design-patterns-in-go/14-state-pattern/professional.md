# State — Professional

> Focus: staff/principal-level decisions. A finite state machine is a wire protocol the system speaks with itself. The runtime cost is small; the design cost is real; the operational cost — once ten million entities are in flight — is what you actually get paid to manage. Opinionated where the field agrees, explicit about trade-offs where it does not.

---

## 1. FSM as a system primitive

The State pattern in code is the same idea as Paxos in distributed consensus, an actor's behavior in Erlang, and a Temporal workflow: a function `(state, event) -> (state', actions)`. The shape is invariant; only the substrate changes.

| Primitive | State lives in | Transition trigger | Durability | Failure model |
|---|---|---|---|---|
| In-process FSM (this pattern) | Pointer/string field on an object | Method call | In-memory until persisted | Crash loses state unless serialized |
| Event-sourced aggregate | An append-only event log | Command produces events | Log is the source of truth | Replay rebuilds state on restart |
| Workflow engine (Temporal, Cadence) | History persisted by the engine | Signal, timer, activity completion | Engine guarantees durability across crashes | Engine handles retries; workflow code stays deterministic |
| Actor model (Erlang/OTP, Akka) | Per-actor mailbox + private state | Message receive | Volatile unless the actor persists | Supervisor restart; blank slate by default |
| CSP / process calculi (Go channels, occam) | Goroutine's position in its code | Channel send/receive | None — the PC is the state | Crash loses everything |
| Replicated state machine (Paxos, Raft) | Log of commands applied in order on every replica | Consensus-confirmed command | Log is durable on a quorum | Replicas converge given the same log |

Read all six rows as one sentence: **the system has a state, an input arrives, the state changes, side effects fire**. The rows differ on *durability*, *replication*, *determinism*, and *what crosses the boundary on a transition*. A staff engineer's job is to know which substrate the problem deserves before reaching for any of them.

Three observations hold across all six:

1. **Determinism is the load-bearing property.** A pure FSM is trivially deterministic. Once a transition does I/O, determinism is gone and you need either idempotency or a replay-aware engine.
2. **States must be finite and small.** A "state" with a free-form blob is a record, not a state. Ten states is healthy; a hundred is a smell; a thousand is a defect.
3. **Transitions are events, not method names.** `Pay()`, `Ship()` look like methods, but in an event-sourced world they are nouns: `PaymentRequested`, `ShipmentDispatched`. Methods rot; events persist.

Lamport's *The Part-Time Parliament* (1998) frames Paxos as a replicated state machine — every replica is an FSM; the protocol ensures all replicas see the same input sequence. Hewitt's actor model (1973) frames a system as a soup of FSMs that communicate by message. Both predate microservices by decades; the math was already there.

---

## 2. Runtime cost analysis

Per-transition CPU and allocation matter on data planes (per-packet protocols, per-tick game loops). They are irrelevant on control planes (one order's lifecycle). Numbers below are Go 1.22, amd64, warm cache.

### 2.1 Interface dispatch

```go
type State interface {
    Handle(*Machine, Event) State
    Name() string
}

func (m *Machine) Send(ev Event) {
    next := m.state.Handle(m, ev)   // interface dispatch
    if next != m.state { m.state = next }
}
```

`m.state.Handle(...)` is an indirect call: two loads (itab + data), one method-pointer load from the itab, then `CALL CX`. ~1-2 ns when one concrete state dominates and the branch predictor hits; ~3-5 ns under a mixed workload. The itab is cached by `runtime.getitab`; the first call for a new (interface, concrete) pair pays a ~50 ns hash lookup, subsequent calls hit the cache.

### 2.2 State-function form (Rob Pike's lexer)

```go
type stateFn func(*Machine) stateFn
func (m *Machine) run() { for s := initial; s != nil; { s = s(m) } }
```

A direct call through a function value: one load, one indirect `CALL`. No itab, no method-pointer dereference. ~1 ns — effectively the cost of a `CALL`. To avoid closure-per-state allocation (~30 ns each), keep state functions top-level — never closures capturing variables.

### 2.3 Table lookup

A literal `[]Transition` linear scan is O(N) but cache-friendly. For ≤30-40 entries it often beats a hashed map by avoiding the hash. A `map[struct{From, Event}]StateID` is constant-time ~15-20 ns. For maximum throughput with small dense alphabets, encode as a 2D array:

```go
var table [numStates][numEvents]StateID
next := table[currentState][event]   // ~1 ns, no hashing
```

This is how TCP implementations encode transitions — N=11, M=8, table is 88 entries.

### 2.4 Atomic swap vs mutex

A single goroutine owning the FSM (events arrive on a channel) needs no synchronization. Concurrent transitions need a mutex or atomic swap.

| Form | Uncontested cost | Contended cost | Caveat |
|---|---|---|---|
| `sync.Mutex` around `Handle` | ~25 ns | Hundreds of ns in the futex queue | Serializes `Handle` body — bad if `Handle` does I/O |
| `atomic.Pointer[State]` + CAS loop | ~10 ns | Spins; better than parking for fast transitions | `Handle` may be called twice on CAS retry — **must be pure** |
| Channel-owned single goroutine | ~50 ns send + recv | Backpressure via bounded channel | Idiomatic Go; ordering preserved |

Rule: atomic swap for read-mostly state lookups; mutex for transitions with side effects; channel-driven loop when in doubt.

### 2.5 Memory: closures vs structs vs IDs

| Encoding | Per-state cost | Per-transition cost | Notes |
|---|---|---|---|
| State as closure (`stateFn` capturing vars) | 1 heap alloc per closure | 0 if reused | Avoid; use top-level functions |
| State as singleton struct (`&Pending{}`) | 1 alloc on creation, shared globally | 0 | Standard form |
| State as named ID (`StateID = uint8`) | 0 (one byte per machine) | 0 (table lookup) | Best for table-driven FSMs |

The singleton trick:

```go
var pendingState = &Pending{}
var paidState    = &Paid{}
```

Each state is allocated once for the process; every `Machine` shares the pointer. State objects carry behavior; per-entity data lives on the `Machine` as a blackboard.

---

## 3. Distributed FSMs

When one entity's state is split across services, the FSM lives in no process. It lives in the *consensus* of several. Under partition, two services disagree about the state of order #1234; everything below follows from that fact.

### 3.1 Consistency models

| Model | Read sees | Implementation | Use when |
|---|---|---|---|
| Linearizable | Latest committed, globally ordered | Single leader, sync replication (Raft, Paxos) | Money, inventory, access control |
| Sequential | Some prefix; monotonic per client | Causal replication | Collaboration, chat |
| Eventual | Convergence later | CRDTs, gossip | Telemetry, presence, caches |
| Read-your-writes | Your writes are visible to your reads | Sticky sessions | User dashboards |
| Bounded staleness | Up to N seconds old | Async replication with monitor | Analytics, audit |

A replicated FSM is linearizable only if every transition goes through one authoritative log. Allow two services to advance the FSM independently and you have a CRDT problem — possibly unsolvable if transitions don't commute.

### 3.2 The CAP angle

A replicated state machine is the canonical CP system: under partition, the minority side cannot transition (sacrificing availability), but every committed transition is consistent. AP variants (Dynamo-style stores) cannot maintain a single canonical state for non-commutative transitions like `Pay` then `Refund`. For FSMs where order matters, CP is the only honest choice — build on Raft (etcd, Consul) or a database with serializable transactions.

### 3.3 Sagas as cross-service FSMs

A saga (Pat Helland, *Life beyond Distributed Transactions*, 2007) is an FSM whose states span services. The order service's `OrderShipping` FSM invokes commands on payments (`Charge`) and inventory (`Reserve`); each may fail, requiring compensating transitions. A typical state set: `Created → InventoryReserved → Charged → Confirmed`, with branches into `ChargeFailed → Compensating → Failed`.

Two engineering rules: **compensations are not inverses** (refund is a new transaction, not an undo), and **every saga transition is idempotent** (the transition UUID doubles as a downstream idempotency key). Hand-rolled sagas are reasonable for two or three steps; beyond that, adopt Temporal (§6).

### 3.4 Where the FSM "lives"

| Pattern | Authoritative state | Propagation | Cost |
|---|---|---|---|
| Single-owner aggregate | One service owns end-to-end | Others use commands / read-only | Low — classic DDD |
| Outbox + event log | Owner writes state + events in one tx; consumers project | At-least-once, idempotent consumers | Moderate — outbox + CDC or polling |
| Replicated log (Raft/Kafka) | The log *is* the FSM | All consumers replay the same sequence | High — operational burden of a distributed log |

Default to the first. Move to the second only when read scaling demands it; to the third only when the FSM truly belongs to no one service.

---

## 4. Event sourcing vs current-state

Current-state stores `state` as a field. Event sourcing stores the sequence of events and derives current state by folding.

| Concern | Current-state | Event-sourced |
|---|---|---|
| Read latency | One row, immediate | Fold N events, may snapshot |
| Write cost | Update one row | Append one event |
| Audit | Needs a separate table | Built in — events *are* the audit |
| Schema evolution | Alter table, migrate rows | New event type; old events stay readable |
| "Why is the state X?" | Logs only if disciplined | Trivial — read the events |
| Storage | O(entities) | O(transitions); grows forever |
| Replay under new logic | No | Yes |
| Time-travel queries | No | Yes |
| Operational simplicity | High | Moderate to low |
| Snapshotting needed | No | Yes for replay performance |

Current-state is the right default. Event sourcing earns its complexity when **two of**: audit is a product requirement (finance, healthcare); replay under new logic has commercial value; the entity has many transitions over a long life; multiple downstream projections need different shapes of the same data.

### 4.1 Snapshotting

Folding 10 M events per entity is unworkable. Snapshot periodically:

```go
func loadAggregate(id string) Aggregate {
    snap := snapshotStore.Latest(id)            // {Version, State []byte}
    events := eventStore.Since(id, snap.Version)
    agg := decode(snap.State)
    for _, e := range events { agg = agg.Apply(e) }
    return agg
}
```

Choose N (snapshot every N events) so average load time stays under a budget (say, 50 ms). Treat snapshots as a cache, not a source of truth — they assume the schema in effect when taken; schema changes require migration or replay-from-events.

---

## 5. Hierarchical state machines (HSMs)

A flat FSM with twenty states often hides a hierarchy. UML 2.5 statecharts (Harel, 1987) formalize this with composite states, history pseudostates, and orthogonal regions.

| Concept | Meaning | Why it matters |
|---|---|---|
| Composite state | Contains sub-states | Common entry actions for a group |
| Initial pseudostate | Default sub-state on entry | "Where you start" inside a composite |
| History pseudostate (H, H*) | Re-enter the last active sub-state (deep variant recurses) | "Resume where you left off" |
| Orthogonal regions | Concurrent sub-states (AND-states) | `Connected AND Authenticated` simultaneously |
| Entry/exit actions | Run on every boundary crossing | DRY for setup/teardown |
| Internal transition | No entry/exit | Side effects without leaving |
| Guards | Boolean condition gating a transition | Conditional routing |

### 5.1 By hand in Go

```go
type State interface {
    Enter(m *Machine); Exit(m *Machine)
    Handle(m *Machine, ev Event) State
}

type CompositeConnected struct{}
func (CompositeConnected) Enter(m *Machine) { m.openSocket() }
func (CompositeConnected) Exit(m *Machine)  { m.closeSocket() }
func (c CompositeConnected) Handle(m *Machine, ev Event) State {
    if ev == EvDisconnect { return Disconnected{} }
    return c
}

type Authenticating struct{ CompositeConnected }   // embed parent
func (Authenticating) Handle(m *Machine, ev Event) State {
    switch ev {
    case EvAuthOK:   return Authenticated{}
    case EvAuthFail: return Disconnected{}
    }
    return Authenticating{}.CompositeConnected.Handle(m, ev)   // delegate up
}
```

Embedding gives sub-states access to parent behavior; the walk to find a handler is explicit. Go has no built-in "send this event to enclosing states until one consumes it" — that walk is the price of hand-rolled HSMs.

### 5.2 Libraries and when hierarchy helps

| Library | Hierarchical | Notes |
|---|---|---|
| `looplab/fsm` | No | Most popular; table-driven, flat FSMs |
| `qmuntal/stateless` | Yes (parent states, entry/exit) | Best Go option for HSMs; port of .NET Stateless |
| `cocoonspace/fsm` | No | Small; simple cases |

For orthogonal regions, run multiple FSMs side by side via shared context. A flat FSM with N states and M events has N×M transitions; a two-level HSM encodes common ones at the composite level — for a 20-state FSM with 5 universal events, that's ~25% fewer transitions and test rows. Hierarchy trades one-time cognitive cost for recurring testing savings.

---

## 6. Temporal/Cadence patterns

Temporal and its predecessor Cadence (Uber) implement *durable* state machines: the workflow is Go code, the engine persists the workflow's history, and on crash the engine replays the history through the same code. **Code is the FSM; history is the durability.**

### 6.1 The deterministic replay constraint

Workflow code must be deterministic given the same history:

```go
func OrderWorkflow(ctx workflow.Context, orderID string) error {
    var payment PaymentResult
    if err := workflow.ExecuteActivity(ctx, ChargeCard, orderID).Get(ctx, &payment); err != nil {
        return err
    }
    if err := workflow.ExecuteActivity(ctx, ReserveInventory, orderID).Get(ctx, nil); err != nil {
        workflow.ExecuteActivity(ctx, RefundCharge, payment.ChargeID)
        return err
    }
    workflow.ExecuteActivity(ctx, ShipOrder, orderID)
    return nil
}
```

The function runs many times — original execution, every worker restart, every replay-debugging session. Forbidden: `time.Now`, `rand.Intn`, `os.Getenv`, `time.Sleep`, direct HTTP/DB, native goroutines, unstable map iteration that affects branching. Replace each with `workflow.Now`, `workflow.NewRandom`, `workflow.SideEffect`, `workflow.Sleep`, activities, `workflow.Go`, or pre-sorted slices.

The reframing that helps: workflow code is the FSM's transition function; activities are I/O; the engine is the durable substrate. Anything not pure logic must cross the activity boundary.

### 6.2 The history abstraction

Each workflow has a history: a sequence of events the engine durably records (`WorkflowExecutionStarted`, `ActivityTaskScheduled`, `ActivityTaskCompleted`, `TimerStarted`, `WorkflowExecutionSignaled`, ...). On replay the engine matches each `workflow.ExecuteActivity` call positionally against the next `ActivityTaskCompleted` and returns the recorded result. When code outpaces history, the engine schedules new work. Same idea as event sourcing (§4), refined for orchestration.

### 6.3 When Temporal earns its keep

Sagas with more than two or three steps and durable state between them; long-running workflows (subscription billing, document signing, fraud reviews); workflows with timers, retries, and external signals arriving over hours; cross-team workflows where retry/timeout/visibility policies must be uniform. Don't reach for it on per-request FSMs, anything bounded to one transaction, or in-process FSMs (TCP, parsers). The engine has real operational cost; it fits problems where durability is non-negotiable.

---

## 7. Observability deep dive

An FSM is among the easiest things to instrument well and the most often instrumented badly. What you usually want is *not* "current state count by name" (a gauge); it is "duration spent in each state" (a histogram).

### 7.1 Per-state duration histograms

```go
stateLatency := prometheus.NewHistogramVec(prometheus.HistogramOpts{
    Name:    "fsm_state_duration_seconds",
    Buckets: prometheus.ExponentialBuckets(0.1, 4, 12),   // 100 ms .. 7 days
}, []string{"machine", "state"})

func (m *Machine) Transition(ev Event) {
    enteredAt := m.lastEnter
    prev := m.state
    m.state = prev.Handle(m, ev)
    if m.state != prev {
        stateLatency.WithLabelValues(m.kind, prev.Name()).
            Observe(time.Since(enteredAt).Seconds())
        m.lastEnter = time.Now()
    }
}
```

Buckets must span the timescales of interest. For an FSM whose `Shipped → Delivered` step takes days, exponential buckets from 100 ms to 7 days at base 4 cover the range in 12 buckets. The default `prometheus.DefBuckets` (5 ms to 10 s) drops everything past `Pending` into overflow.

Canonical questions: p50 of `Charging` should be seconds; p99 tens of seconds; p999 is the long tail where stuck workflows hide.

### 7.2 Stuck workflow alerts

```promql
# Entities older than 1 hour in a state that should resolve in minutes
max by (state) (
  time() - fsm_entity_state_entered_at{state=~"Charging|Reserving|Refunding"}
) > 3600
```

Any state whose normal duration is in seconds is stuck once occupied for an order of magnitude longer. The alert must be per-state — terminal states (`Delivered`) are expected to be old.

Complementary: alert on `rate(fsm_transitions_out_total[15m]) / fsm_entities_in_state` falling below a threshold. Liveness, not just lateness.

### 7.3 W3C Trace Context across transitions

A single entity's lifecycle spans many requests, goroutines, and processes. Persist W3C Trace Context with each transition so the lifecycle renders as one trace:

```go
func (m *Machine) Send(ctx context.Context, ev Event) {
    ctx, span := tracer.Start(ctx, "fsm.transition",
        trace.WithAttributes(
            attribute.String("entity.id", m.id),
            attribute.String("state.from", m.state.Name()),
            attribute.String("event", ev.Name())))
    defer span.End()
    m.state = m.state.Handle(m, ev)
    span.SetAttributes(attribute.String("state.to", m.state.Name()))
    m.persistTransition(ctx, Transition{ /* includes TraceParent from span */ })
}
```

When the next transition resumes on another worker, the stored `TraceParent` becomes the parent of its span. The trace tree shows the entity's lifetime as one logical operation across many workers and many days.

### 7.4 Structured logs

```go
slog.InfoContext(ctx, "fsm transition",
    "entity_id", m.id, "kind", m.kind,
    "state_from", prev.Name(), "state_to", m.state.Name(),
    "event", ev.Name(), "duration", time.Since(m.lastEnter),
    "actor", actorFromContext(ctx),
    "trace_id", trace.SpanContextFromContext(ctx).TraceID().String())
```

Eight fields cover every diagnostic query. Log every transition; storage is cheap; "what happened to order #1234?" becomes one query.

---

## 8. Failure modes & recovery

A real FSM does I/O on transitions — DB write, queue publish, API call. Any can fail partway. The recovery model is not optional.

### 8.1 Partial action failure

`Pay` does three things atomically from the user's view: charge the card, mark the order paid, publish `OrderPaid`. They are not atomic in the system.

| Failure point | DB | Card | Queue | Recovery |
|---|---|---|---|---|
| Charge call timed out | Pending | Possibly charged | No event | Reconcile via charge ID lookup |
| Charge succeeded, DB write failed | Pending | Charged | No event | Retry; idempotency prevents double-charge |
| DB succeeded, queue publish failed | Paid | Charged | No event | Outbox dispatcher retries |
| All three succeeded | Paid | Charged | Published | Done |

The third row is why **the outbox pattern** exists: write the event into the same DB transaction as the state change; a separate dispatcher publishes to the queue. DB is the source of truth; queue is best-effort distribution.

### 8.2 Reconciliation loops

For external state the FSM doesn't fully control:

```go
func reconcileCharges(ctx context.Context) {
    rows := db.Query(`
        SELECT order_id, charge_id FROM orders
        WHERE state = 'Charging' AND updated_at < NOW() - INTERVAL '5 minutes'`)
    for rows.Next() {
        var orderID, chargeID string
        rows.Scan(&orderID, &chargeID)
        actual, _ := paymentClient.GetCharge(ctx, chargeID)
        switch actual.Status {
        case "succeeded": fsm.Load(orderID).Send(ctx, EvChargeConfirmed)
        case "failed":    fsm.Load(orderID).Send(ctx, EvChargeFailed)
        }
    }
}
```

Two rules: **reconciliation must be idempotent** (sending `EvChargeConfirmed` twice is a no-op past `Charging`), and **must have a horizon** (only entities stuck > 5 min, not all of them).

### 8.3 Eventually-consistent FSMs

When the FSM's state is the *aggregate* of several services' partial views, eventual consistency is the correctness model. A subscription's `Active` state requires a successful charge (payments), a provisioned account (identity), and an entitlement (billing). Each confirms asynchronously; the FSM gathers and transitions only when all three arrive — a *gather-and-transition* pattern.

```go
type SubscriptionFSM struct {
    State                                       string
    PaymentOK, AccountOK, EntitlementOK         bool
}
func (s *SubscriptionFSM) onConfirmation(svc string) {
    switch svc {
    case "payment":     s.PaymentOK = true
    case "account":     s.AccountOK = true
    case "entitlement": s.EntitlementOK = true
    }
    if s.PaymentOK && s.AccountOK && s.EntitlementOK { s.State = "Active" }
}
```

If a fact never arrives, a timeout handler advances to `PendingVerification` where humans intervene.

### 8.4 Compensating actions on entry

When the FSM enters an error state, encode compensation in the entry hook so it is co-located with the failure semantics:

```go
type ChargeFailed struct{}
func (ChargeFailed) Enter(m *Machine) {
    if m.data.ReservationID != "" {
        m.inventory.Release(m.ctx, m.data.ReservationID)
    }
    m.notifications.Send(m.ctx, "charge_failed", m.data.CustomerID)
}
```

Compensation is *part of* the FSM's contract: entering `ChargeFailed` is defined as releasing the reservation. Without it, "charge failed but inventory stayed reserved" becomes a recurring ops ticket.

---

## 9. Schema evolution at scale

Adding a state to an FSM with 10 M in-flight entities is a migration, not a code change.

### 9.1 Compatibility matrix

| Change | Safe? | Notes |
|---|---|---|
| Add terminal state | Yes | New code; future transitions can reach it |
| Add intermediate state | With care | New code must handle entities in the old path |
| Remove state | After no entity has been there for a retention window | Tombstone the handler, then delete |
| Rename state | Treat as remove + add | Persist both names; route reads to either |
| Change a transition target | Risky | In-flight entities follow the old graph until they exit the affected state |
| Add event | Yes | Existing code ignores unknown events |
| Remove event | After no producer sends it | Tombstone the handler |

### 9.2 Double-write during migration

When the storage shape changes, write to both during the migration:

```go
func (m *Machine) persistTransition(ctx context.Context, t Transition) error {
    return m.db.RunInTx(ctx, func(tx *sql.Tx) error {
        if _, err := tx.ExecContext(ctx,
            `UPDATE orders SET state = $1 WHERE id = $2`, t.To, t.EntityID); err != nil {
            return err
        }
        _, err := tx.ExecContext(ctx,
            `INSERT INTO state_transitions (entity_id, from_state, to_state, event, at)
             VALUES ($1, $2, $3, $4, $5)`,
            t.EntityID, t.From, t.To, t.Event, t.OccurredAt)
        return err
    })
}
```

Double-write continues until every reader migrates and the new shape is fully populated. A separate deploy then stops writing the old shape; the old column drops after a retention window.

### 9.3 Shadow execution

For changes to transition logic, run the new FSM *in shadow* — compute what it would do, log divergence, commit the old result:

```go
func (m *Machine) Send(ctx context.Context, ev Event) {
    oldNext := m.state.Handle(m, ev)
    if shadowEnabled {
        if shadow := newFSM(m.data).Handle(ev); shadow.Name() != oldNext.Name() {
            slog.WarnContext(ctx, "fsm shadow divergence",
                "entity_id", m.id, "event", ev.Name(),
                "old_target", oldNext.Name(), "new_target", shadow.Name())
        }
    }
    m.state = oldNext
    m.persist(ctx)
}
```

Run shadow for at least one full lifecycle of the longest-lived entity. Non-zero divergence is a bug; zero confirms the cutover is safe.

### 9.4 Flag-gated rollout

Flip the live behavior under a feature flag partitioned by entity (1% → 10% → 50% → 100%). The flag check happens at *entity creation* and is sticky for the entity's lifetime — an entity must not cross between graph versions mid-flight, or it will encounter states the cohort's graph doesn't define.

---

## 10. Security

FSMs encode *who can do what when*. Mistakes show up as authorizing the wrong actor for a transition, or authorizing on the wrong dimension (state instead of event).

### 10.1 Authorize the event, not the state

"Customer can read an order in `Shipped`" authorizes by state and leaks intent. The right model: "customer can send `CancelOrder` on their own order, provided the FSM accepts it from the current state."

```go
type Authorization struct {
    Event EventName
    Roles []string
    Guard func(actor Principal, m *Machine) bool
}

var policies = map[EventName]Authorization{
    "Pay":         {Roles: []string{"customer"},   Guard: ownsOrder},
    "RefundOrder": {Roles: []string{"agent"},      Guard: hasRefundPermission},
    "FreezeOrder": {Roles: []string{"fraud_team"}, Guard: nil},
}

func (m *Machine) Send(ctx context.Context, ev Event) error {
    pol := policies[ev.Name()]
    actor := principalFromContext(ctx)
    if !hasAnyRole(actor, pol.Roles)            { return ErrUnauthorized }
    if pol.Guard != nil && !pol.Guard(actor, m) { return ErrForbidden }
    next := m.state.Handle(m, ev)
    if next == m.state { return ErrInvalidTransition }
    m.state = next
    return nil
}
```

State-based authorization conflates "you may know it is shipped" with "you may transition it." Different questions.

### 10.2 Audit log of who sent which event

Every transition deserves an audit row.

| Column | Purpose |
|---|---|
| `transition_id` | UUID; idempotency anchor |
| `entity_id`, `entity_kind` | Which entity |
| `actor_id`, `actor_kind` | `user` / `service` / `system` |
| `event` | Event name |
| `state_from`, `state_to` | The transition |
| `occurred_at` | Wall clock |
| `trace_id` | Link to the distributed trace |
| `outcome` | `applied` / `rejected_invalid` / `rejected_auth` |
| `reason` | Optional human note |

Append-only, immutable, separate retention from operational logs. For regulated FSMs the audit log is the legal record. AWS CloudTrail and Stripe's Sigma are the same pattern at scale.

### 10.3 Sensitive states

`Frozen`, `Suspended`, `UnderInvestigation` carry extra rules:

- Entry to a sensitive state requires elevated authorization.
- Reads of a sensitive state may require their own authorization (a "frozen" signal can tip off a fraudster — show others a neutral "processing" indicator).
- Transitions *out of* a sensitive state are at least as privileged as transitions in.

### 10.4 Replay attacks on event channels

Events arriving over a network can be replayed. Defenses are the same as for commands: idempotency keys per event, signed envelopes, max-age timestamps. The idempotency key naturally maps to `transition_id` — a duplicate event finds the prior transition and short-circuits.

---

## 11. Testing at scale

Beyond unit tests, an FSM with thousands of transitions needs property-level assurances.

### 11.1 Property-based testing

```go
func TestNoEntityEverReachesInvalidState(t *testing.T) {
    valid := map[StateID]bool{Pending: true, Paid: true, Shipped: true,
                              Delivered: true, Cancelled: true, Refunded: true}
    f := func(events []EventID) bool {
        m := New()
        for _, e := range events {
            m.Send(e)
            if !valid[m.State()] { return false }
        }
        return true
    }
    if err := quick.Check(f, &quick.Config{MaxCount: 100000}); err != nil {
        t.Fatal(err)
    }
}
```

100k random sequences explore the graph more aggressively than handwritten tests. Properties worth checking: state always in declared set; no unreachable state ever reached; every reachable state reached by *some* sequence; terminal states absorbing; idempotent events truly idempotent.

`gopter` (https://github.com/leanovate/gopter) is stronger than `testing/quick` — shrinks failing inputs, supports constrained generators, gives reproducible seeds.

### 11.2 Model checking with TLA+ / Alloy

For correctness-critical FSMs (payments, consensus, locks), model the spec in TLA+ and check invariants exhaustively. A two-step example:

```
VARIABLES state, charged, refunded
Init == state = "Pending" /\ charged = FALSE /\ refunded = FALSE
Pay    == state = "Pending" /\ state' = "Paid"     /\ charged'  = TRUE
Refund == state = "Paid"    /\ state' = "Refunded" /\ refunded' = TRUE
Inv == charged \/ ~refunded     \* cannot refund what was not charged
```

TLC explores every reachable state and verifies the invariant. The implementation can be correct against the wrong spec; the spec is the contract. Alloy is the lighter alternative for finite scopes.

### 11.3 Chaos engineering on stuck workflows

Inject failure deliberately: kill a worker mid-transition (verify reconciliation); delay a downstream past the FSM's timeout (verify the timeout state and compensation); drop a fraction of events (verify retries and idempotency); replay an old event from DLQ (verify rejection as duplicate). `toxiproxy` plus a transition-killer sidecar is enough tooling to flush out obvious gaps.

---

## 12. Anti-patterns at scale

| Anti-pattern | Symptom | Fix |
|---|---|---|
| **Distributed FSM with no idempotent transitions** | Duplicate charges, double refunds, drift | Idempotency key on every transition; dedup store; retries assume at-least-once |
| **Soft states that drift** | A "state" computed from fields; different services compute it differently | Store the state name explicitly; reconcile divergent views via a single owner |
| **States defined in code AND in the database** | Schema has a `status` enum; code has a `State` interface; they disagree | One source of truth — generate code from schema or vice versa |
| **State machine used as workflow engine without checkpointing** | Pay-then-ship-then-notify in one function; crashes leave inconsistency | Adopt Temporal/Cadence, or persist between every step with retries and reconciliation |
| **Polymorphic state objects stored as JSON** | New state field breaks unmarshalling of in-flight entities | Store the state *name*; reconstitute behavior from a registry |
| **FSM that swallows invalid events** | Bugs hide because invalid events are no-ops | Distinguish "no-op because already done" from "no-op because illegal" — the second is an error |
| **Catch-all `Failed` state** | Every error path goes to the same state; recovery needs manual review | Specific failure states per category (`ChargeFailed`, `ReservationFailed`) with their own recovery |
| **Side effects scattered across `Enter`, `Handle`, and callers** | Auditing is painful | Side effects in `Enter` only; `Handle` is pure (state → state); the machine drives I/O |
| **Per-entity workers** | One goroutine per active entity; OOM at scale | Single pool consumes events from a shared queue; load, apply, persist, release |
| **No retention on transitions table** | 500 GB audit table; queries time out | Partition by month; archive partitions older than retention |
| **Global enum of states across all FSM kinds** | One enum with 400 values | One state enum per FSM; the catalog is the architecture |

The deepest anti-pattern: **using state machines as workflow engines without the engine**. The shape is identical (events, transitions, side effects, durability) and the code is appealingly small at first. It becomes a maintenance disaster the first time a process crashes mid-saga. If the workflow has more than two non-trivial steps, more than a minute between them, or slow external systems, use Temporal/Cadence/Conductor. The pattern is not the engine.

---

## 13. Closing principles

A finite state machine is a contract. Honor it at every boundary.

1. **States are nouns; events are verbs.** A state named with a verb (`Processing`, `Paying`) is usually two states pretending to be one. Split it (`PaymentPending`, `PaymentConfirmed`). Naming is the architecture.
2. **The transition is the audit record.** Every transition deserves a row with `from`, `to`, `event`, `actor`, `trace_id`, `occurred_at`. Without it, "what happened to this entity?" is archaeology. With it, the FSM tells its own story.
3. **Determinism is non-negotiable on durable FSMs.** Once an FSM survives restarts, its transition function must be a pure function of `(state, event, context)` — no clocks, no randomness, no network reads inside the transition. Move I/O outside or behind activity boundaries.
4. **Idempotency is the price of distribution.** Two processes that can advance the same entity force every event to carry an idempotency key and every transition to check a dedup store. Exactly-once delivery is a marketing term; at-least-once + idempotent receiver is the real implementation.
5. **The graph is documentation.** A renderable diagram generated from the transition table — not redrawn by hand — is the single most useful artifact for onboarding, design review, and incident analysis. If no current diagram exists, the FSM has already drifted.

Get those right and the State pattern becomes invisible: the code reads as a description of the legal lives an entity can have; the runtime tells you which life each entity is currently living; the audit log tells you the history that brought every entity there.

---

## Further reading

- Leslie Lamport, *The Part-Time Parliament* (Paxos as replicated state machine) — https://lamport.azurewebsites.net/pubs/lamport-paxos.pdf
- Pat Helland, *Life beyond Distributed Transactions* — https://www.ics.uci.edu/~cs223/papers/cidr07p15.pdf
- Carl Hewitt et al., *A Universal Modular Actor Formalism for Artificial Intelligence* (1973)
- David Harel, *Statecharts: A Visual Formalism for Complex Systems* (1987); UML 2.5 — https://www.omg.org/spec/UML/2.5/
- Temporal — https://docs.temporal.io; Cadence — https://cadenceworkflow.io; Netflix Conductor — https://conductor.netflix.com
- `looplab/fsm` — https://github.com/looplab/fsm; `qmuntal/stateless` — https://github.com/qmuntal/stateless
- W3C Trace Context — https://www.w3.org/TR/trace-context/
- Leslie Lamport, *Specifying Systems* (TLA+) — https://lamport.azurewebsites.net/tla/book.html; Daniel Jackson, *Software Abstractions* (Alloy)
- Greg Young, *CQRS Documents* — canonical event-sourcing treatment
- Martin Kleppmann, *Designing Data-Intensive Applications* — Ch. 11, stream processing as state machines

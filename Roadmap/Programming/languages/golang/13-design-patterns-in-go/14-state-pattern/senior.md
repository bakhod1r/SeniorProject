# State — Senior

## 1. Mental model for senior engineers

At junior level, State is "wrap each mode in a type". At middle level, it is the choice between behavior-per-state, state-function, and table-driven shapes. At senior level, the question changes: **the State pattern is just one possible encoding of a finite-state machine, and the encoding is rarely the interesting decision.** The interesting decisions are durability, observability, concurrency, and versioning of the FSM — the pattern is plumbing under those.

A finite-state machine has five mathematical pieces: a finite set of states `Q`, an input alphabet `Σ`, a transition function `δ: Q × Σ → Q`, an initial state `q₀`, and (optionally) a set of accepting states `F`. Two practical variants exist:

| Variant | Output is determined by | Where it shows up in Go |
|---------|-------------------------|-------------------------|
| **Moore machine** | Current state only | Stateful goroutine that emits on state entry; LED controllers; `runtime` GC phases |
| **Mealy machine** | Current state *and* input | Parsers (token depends on input + mode); protocol decoders; `net/http` request dispatch |

The GoF State pattern as written is closer to Mealy: the method invoked (the input) plus the current state object decides the next state and the side effect. The state-function form from Rob Pike is also Mealy in spirit — `lexAction(l)` looks at the lexer's input and the lexer's position together.

Go's interface dispatch buys you the "swap behavior by swapping a pointer" mechanic essentially for free. Each interface call is a type pointer load + a vtable lookup + an indirect call — three or four pointer-sized operations. For most state machines, the dispatch cost is invisible next to whatever work the state actually does (I/O, parsing, allocation). The cost only becomes interesting at the hot end of the spectrum: lexers running at hundreds of MB/s, parsers in compilers, network protocol decoders. There, the state-function form (a plain `func` value, no interface, no allocation per transition) wins by ~10–30%; benchmark before assuming.

The senior framing: **stop asking "should this be the State pattern" and start asking "what is the underlying FSM, and where does it live"**. Once you can sketch the FSM (states, events, guards, actions, persistence boundary), the encoding choice falls out of the answers.

---

## 2. Three architectural decisions

Before any code, three orthogonal decisions shape the system. Each one has a default that holds for 80% of cases and an alternative that earns its weight only when specific forces are present.

### 2.1 Encoding: behavior-per-state vs state-function vs table-driven

| Encoding | Best when | Cost |
|----------|-----------|------|
| **Behavior-per-state** | Rich, distinct behavior per state; need `Enter`/`Exit` hooks; small graph (≤ 10 states) | One type per state; allocation per transition unless you cache singletons |
| **State-function** | Streaming / linear work (lexer, parser, decoder); performance-critical; few branches | Hard to introspect; no per-state data; copies of similar logic |
| **Table-driven** | Large graph (20+ states); uniform per-state code; want diagrams / validation from data | Per-state logic detaches from "the state"; harder to step through in a debugger |

Real production code mixes them. A workflow engine has a table-driven core (states are data, validated at startup) and behavior-per-state hooks for the few transitions with substantial logic. A protocol stack has state-function leaves inside a behavior-per-state outer machine. Treat the three as tools, not religions.

### 2.2 Persistence: in-memory vs durable

| Lifetime | Storage | Examples |
|----------|---------|----------|
| **In-memory** | Just the `Machine` struct | Lexer, game character, TCP connection within a process |
| **Durable, state-only** | Store the current state name; reconstitute on load | Orders, subscriptions, tickets, jobs |
| **Durable, event-sourced** | Store events; recompute state by replay | Audit-heavy domains, financial ledgers, Temporal/Cadence workflows |

The choice is forced by lifetime, not by elegance. If the machine must outlive a process restart, in-memory is wrong. If you ever need to ask "how did this entity end up here", state-only is insufficient and event sourcing earns its complexity (see §6).

### 2.3 Sync vs async transitions

| Mode | Transition timing | When |
|------|-------------------|------|
| **Synchronous** | The caller blocks until the transition (and its action) completes; `Send(ev)` returns the new state or an error | In-memory machines, request-bound work, anything where the caller needs the outcome to proceed |
| **Asynchronous / event-sourced** | The caller submits an event; the transition happens later, possibly on another machine; consumers observe via subscription or polling | Cross-process workflows; long-running compensations; multi-step sagas |

Mixing sync and async transitions on the same machine is the source of "sometimes the email goes out before the order is marked paid" bugs. Decide per-machine.

These three decisions compose: a behavior-per-state in-memory synchronous FSM is the textbook GoF State. A table-driven durable async FSM is essentially Temporal. Most production systems live somewhere on the diagonal between them.

---

## 3. Real Go ecosystem decomposed

### 3.1 `text/template/parse/lex.go` — Rob Pike's state-function lexer

The Go standard library's template lexer is the canonical example of the state-function form. The skeleton:

```go
type stateFn func(*lexer) stateFn

type lexer struct {
    name   string
    input  string
    start  int
    pos    int
    width  int
    items  chan item
    // ... line, parenDepth, leftDelim, rightDelim
}

func (l *lexer) run() {
    for state := lexText; state != nil; {
        state = state(l)
    }
    close(l.items)
}

func lexText(l *lexer) stateFn {
    for {
        if strings.HasPrefix(l.input[l.pos:], l.leftDelim) {
            if l.pos > l.start {
                l.emit(itemText)
            }
            return lexLeftDelim
        }
        if l.next() == eof {
            break
        }
    }
    if l.pos > l.start {
        l.emit(itemText)
    }
    l.emit(itemEOF)
    return nil
}
```

Senior takeaways:

- **No interface dispatch.** Each `stateFn` is a concrete function pointer. The compiler can inline some paths, and the tight loop in `run` is essentially a `goto` chain expressed in function values.
- **No per-state allocation.** State is a function pointer, eight bytes. Transitions are pointer assignments. The whole lexer can run at line-rate I/O speeds.
- **State lives in the lexer.** The `*lexer` carries all the per-position data. The state function is pure behavior. This is the inverse of behavior-per-state.
- **Emission is decoupled.** `l.emit(itemText)` pushes onto a channel; the parser reads from the other side. The lexer is a goroutine producer.

When to copy this design: any time you have a streaming input, a small number of modes, and the per-state code is meaningful (not a stub). When not to: when you need to ask "what state am I in?" from outside, or when several states share enough logic that the function copies dominate.

### 3.2 `net/http` request lifecycle — informal state machine

`net/http` never names its FSM, but one is there. A server-side request goes through approximate states:

```
        Accepted
            |
            v
        Reading-request
            |
            v
        Handling (chi/mux/your handler)
            |
            v
        Writing-headers
            |
            v
        Writing-body
            |
            v
        (Hijacked | Done | TimedOut | Cancelled)
```

The state is implicit — encoded across `*http.Request`, `http.ResponseWriter`, the server's connection bookkeeping, and the `context.Context` lifecycle. Specific behaviors gate on the state:

- `Header().Set(...)` after `WriteHeader` is a no-op (silently). The state has moved past "Writing-headers".
- `Hijack()` is legal only while no body has been written. After `WriteHeader`, the state forbids it.
- `Push()` for HTTP/2 must happen before the body. State-bound.
- `Flush()` requires that headers are already written. State-dependent.

The senior observation: the lifecycle is not modeled as states because the API was designed before the discipline became standard. The result is a class of bugs where calling the wrong method at the wrong moment produces silent misbehavior. **When you design a similar API, model the FSM explicitly** — even an internal enum that the methods check against gives you defensive errors instead of silent corruption.

### 3.3 `looplab/fsm` — table-driven library

`looplab/fsm` is the most-used FSM library in Go. The API is data-first:

```go
import "github.com/looplab/fsm"

m := fsm.NewFSM(
    "pending",
    fsm.Events{
        {Name: "pay",    Src: []string{"pending"}, Dst: "paid"},
        {Name: "ship",   Src: []string{"paid"},    Dst: "shipped"},
        {Name: "cancel", Src: []string{"pending", "paid"}, Dst: "cancelled"},
    },
    fsm.Callbacks{
        "enter_paid":     func(_ context.Context, e *fsm.Event) { metrics.Inc("paid") },
        "before_ship":    func(_ context.Context, e *fsm.Event) { /* validation */ },
        "after_cancel":   func(_ context.Context, e *fsm.Event) { /* refund hook */ },
    },
)

if err := m.Event(ctx, "pay"); err != nil {
    // fsm.InvalidEventError if the event isn't legal in this state
}
```

What `looplab/fsm` gets right:

- The graph is data. You can validate it at startup (no unreachable states, no dangling transitions).
- Callbacks are keyed by lifecycle phase: `before_<event>`, `leave_<state>`, `enter_<state>`, `after_<event>`. The library calls them in a defined order.
- The state is a string, trivially serializable.

What it does not give you:

- Per-machine concurrency safety in any non-trivial sense (you'd add a mutex around the machine).
- Durable persistence (you store the state name yourself).
- Generic typing of event payloads — events carry `[]interface{}` args.

Use it when the graph is large, your team agrees on declarative transitions, and you do not want to write the dispatch loop. Avoid it when you need typed payloads, hot-path performance, or fine control over the transition transaction.

### 3.4 `qmuntal/stateless` — declarative API

`qmuntal/stateless` is a Go port of Stateless (.NET), with a fluent declarative API:

```go
import "github.com/qmuntal/stateless"

sm := stateless.NewStateMachine("pending")
sm.Configure("pending").
    Permit("pay", "paid").
    Permit("cancel", "cancelled")

sm.Configure("paid").
    OnEntry(func(ctx context.Context, _ ...any) error { return notify(ctx, "paid") }).
    Permit("ship", "shipped").
    Permit("refund", "refunded")

sm.Configure("shipped").
    OnEntry(recordShipment).
    Permit("deliver", "delivered")

if err := sm.Fire(ctx, "pay"); err != nil { /* ... */ }
```

The Stateless model gives you hierarchical states (`SubstateOf`), guard clauses (`PermitIf`), and ignored events (`Ignore`). It's the most expressive FSM library in the Go ecosystem.

Senior trade-off: the API is fluent and discoverable, but the same expressiveness invites configuration sprawl. A machine with thirty states, twelve events, and a forest of guard clauses ends up as a 400-line `init` function nobody can keep in their head. The library is best when the FSM model is genuinely hierarchical (UI screens, hardware modes); flatter machines look just as good in `looplab/fsm` with less ceremony.

### 3.5 `temporal.io/sdk-go` — durable workflow as state machine

Temporal is the most consequential FSM library in Go production. Every workflow is an event-sourced state machine; the SDK gives you what looks like ordinary code:

```go
func OrderWorkflow(ctx workflow.Context, orderID string) error {
    var charge ChargeResult
    err := workflow.ExecuteActivity(ctx, ChargeCard, orderID).Get(ctx, &charge)
    if err != nil {
        return err
    }

    var ship ShipResult
    err = workflow.ExecuteActivity(ctx, ShipOrder, orderID).Get(ctx, &ship)
    if err != nil {
        // Compensate: refund the charge
        _ = workflow.ExecuteActivity(ctx, RefundCharge, charge.ID).Get(ctx, nil)
        return err
    }

    return workflow.ExecuteActivity(ctx, NotifyCustomer, orderID, ship).Get(ctx, nil)
}
```

What is going on underneath: every line of this function is a state in an implicit FSM. Temporal records `ActivityScheduled`, `ActivityCompleted`, `ActivityFailed` events in a durable history. When the workflow worker crashes and restarts, the SDK replays the history, deterministically rebuilds the local variables (`charge`, `ship`), and resumes at the next un-executed activity. The Go function body is the FSM written in straight-line code; the runtime turns it into events.

Senior takeaways:

- **The FSM is implicit in the code shape.** Temporal extracts it. You write business logic.
- **Replay determinism is a hard constraint.** No `time.Now()`, no `rand`, no map-iteration order — only Temporal's deterministic equivalents (`workflow.Now`, `workflow.NewRandom`). Violating determinism corrupts replays.
- **Sagas (§2.3 of the Command file) are free.** Compensating logic is just another activity in the same workflow.
- **The history is the audit log.** Every state transition is a row, observable and queryable.

When to reach for Temporal: workflows that span minutes to months, span services, need automatic retry and compensation, and would otherwise be a homegrown durable state machine. When to avoid: short-lived in-memory work; teams without operational capacity to run a Temporal cluster.

### 3.6 TCP/IP stack — protocol FSM

Any TCP implementation is the textbook FSM. The states from RFC 793 §3.2:

```
CLOSED -> LISTEN -> SYN_RCVD -> ESTABLISHED -> FIN_WAIT_1 -> FIN_WAIT_2 -> TIME_WAIT -> CLOSED
CLOSED -> SYN_SENT -> ESTABLISHED -> CLOSE_WAIT -> LAST_ACK -> CLOSED
```

In `gvisor.dev/gvisor/pkg/tcpip/transport/tcp` you can read the state machine as Go code:

```go
type EndpointState uint32

const (
    StateInitial EndpointState = iota
    StateBound
    StateListen
    StateConnecting
    StateConnected
    StateClosed
    // ...
)

func (e *endpoint) setEndpointState(state EndpointState) {
    oldstate := EndpointState(atomic.SwapUint32((*uint32)(&e.state), uint32(state)))
    if oldstate == state {
        return
    }
    // Run state-change observers.
}
```

Senior observations:

- States are `iota` constants (§ later in this file). One byte each; comparisons are integer equality; serialization is one number.
- The state field is mutated via `atomic.SwapUint32`. No mutex on the state itself.
- Transitions are *not* in a single switch; they are scattered across handlers for each packet type. This is intentional — the FSM is too large for one function, and packet handlers are the natural locus for "what does this state do when this kind of packet arrives".
- The codebase has separate state for the local endpoint, for retransmission, for congestion control, for keep-alive timers. These are *parallel* state machines that communicate. Modeling them as one big machine would multiply the state count combinatorially.

The senior takeaway from protocol FSMs: when a single machine grows past ~15 states, look for orthogonal concerns hiding in it. Splitting into parallel cooperating machines is almost always cleaner than collapsing them into one Cartesian product.

---

## 4. Designing transitions: guards, actions, side effects

A transition has up to four logical pieces:

1. **Guard** — a predicate that must hold for the transition to fire. Pure, side-effect-free, fast.
2. **Action** — the side effect: write to DB, call an external API, emit an event. May fail, may take seconds.
3. **State swap** — the actual change of the `state` field. One instruction or one atomic operation.
4. **Post-transition emission** — fire `Enter` hook on the new state, log, emit metrics, notify subscribers.

The order matters. The senior shape:

```go
func (m *Machine) Send(ctx context.Context, ev Event) error {
    t, ok := m.lookup(m.state, ev)
    if !ok {
        return fmt.Errorf("invalid event %q in state %q", ev, m.state)
    }
    if t.Guard != nil && !t.Guard(ctx, m) {
        return fmt.Errorf("guard rejected event %q in state %q", ev, m.state)
    }

    if t.Action != nil {
        if err := t.Action(ctx, m); err != nil {
            return fmt.Errorf("action: %w", err)
        }
    }

    old := m.state
    m.state = t.To
    m.observe(ctx, old, m.state, ev)
    return nil
}
```

Senior questions to answer for any non-trivial machine:

**Q1: Action runs before state swap. What if the action succeeds but the swap fails?** In Go with a simple field assignment, the swap cannot fail — it's a pointer write. In a durable machine where "state swap" is a DB write, the action and the swap must be in the same transaction, or the action must be idempotent so a retry after a failed swap is safe.

**Q2: What about Enter/Exit hooks on the state objects themselves?** They are part of the transition transaction:

```
1. Check guard
2. Run Exit on the current state (cleanup hooks)
3. Run Action (the actual transition work)
4. Swap state field
5. Run Enter on the new state (setup hooks)
6. Observe (log, metric, span)
```

Exit hooks must be idempotent — if Action fails after Exit has run, the machine is in a half-transitioned state. The safe pattern: design Exit hooks so re-running them on the same state is a no-op. Counter-intuitive but enforces resilience.

**Q3: Synchronous transactional, eventually consistent, or chaotic?** Three points on a spectrum:

| Model | Guarantee | Cost |
|-------|-----------|------|
| **Transactional** | All-or-nothing: action + state swap in one DB transaction | Limits action to local DB; external APIs need outbox |
| **Eventually consistent** | Action enqueues an event; state swap is on the consumer | Easy to scale; replays must be idempotent |
| **Best-effort** | Action runs, state swap happens, if either fails we log and move on | Only acceptable for non-critical machines (cache state, UI hints) |

Pick one per machine and document it. Sliding between them is the source of "we don't know why this order is in `paid` when Stripe returned an error" bugs.

**Q4: Idempotency of Enter/Exit.** Both hooks may run multiple times under retry or replay scenarios. The discipline:

```go
func (s *Paid) Enter(ctx context.Context, m *Machine) error {
    // Idempotent: ON CONFLICT DO NOTHING on the audit row,
    // start the shipment timer only if not already running.
    if _, err := m.db.ExecContext(ctx,
        `INSERT INTO order_paid_audit (order_id, paid_at)
         VALUES ($1, now())
         ON CONFLICT (order_id) DO NOTHING`,
        m.orderID); err != nil {
        return err
    }
    if !m.shipmentTimer.Running() {
        m.shipmentTimer.Start(24 * time.Hour)
    }
    return nil
}
```

Every side effect inside Enter/Exit needs a guard against double application. The cost is small (an `IF NOT EXISTS` check, an `ON CONFLICT` clause); the benefit is that replay-and-retry stops being a hand-wringing affair.

---

## 5. Observability

A state machine without observability is a state machine with random behavior. The senior surface area is six things: every transition is a log line, every state has a span, every state has a duration histogram, every state has an in-state counter, "stuck" detection, and a transition audit log.

### 5.1 Transition logging with `slog`

Go 1.21 made `log/slog` the standard. Every transition emits a structured record:

```go
func (m *Machine) observe(ctx context.Context, from, to State, ev Event) {
    m.log.LogAttrs(ctx, slog.LevelInfo, "state transition",
        slog.String("machine", m.kind),
        slog.String("id", m.id),
        slog.String("from", from.Name()),
        slog.String("to", to.Name()),
        slog.String("event", string(ev)),
        slog.Duration("in_prev_state", time.Since(m.enteredAt)),
        slog.String("trace_id", traceIDFromContext(ctx)),
    )
    m.enteredAt = time.Now()
}
```

`LogAttrs` avoids the reflection cost of `Info(...)` for hot paths. Use `slog.With(...)` to derive a per-machine logger that carries the kind and ID on every record without restating them.

### 5.2 OpenTelemetry span per state

For long-running states (anything past a few milliseconds), open a span when the state is entered and close it when the state is exited:

```go
func (m *Machine) enterState(ctx context.Context, s State) {
    m.stateSpanCtx, m.stateSpan = m.tracer.Start(ctx, "state."+s.Name(),
        trace.WithSpanKind(trace.SpanKindInternal),
        trace.WithAttributes(
            attribute.String("machine.kind", m.kind),
            attribute.String("machine.id", m.id),
            attribute.String("state.name", s.Name()),
        ))
}

func (m *Machine) exitState(reason string) {
    if m.stateSpan != nil {
        m.stateSpan.SetAttributes(attribute.String("exit_reason", reason))
        m.stateSpan.End()
        m.stateSpan = nil
    }
}
```

The span tree then shows the workflow's history as a Gantt chart in your tracing UI — one row per state, with the action's child spans nested below it. This is invaluable when debugging "why did this order take six hours to ship".

### 5.3 Metrics: duration, count, in-flight

Three metrics cover most operational needs:

| Metric | Type | Labels | Why |
|--------|------|--------|-----|
| `state_duration_seconds` | histogram | `machine`, `state` | Latency in each state; spot slow phases |
| `state_transitions_total` | counter | `machine`, `from`, `to`, `event` | Throughput; rare-transition detection |
| `state_in_flight` | gauge | `machine`, `state` | Currently-in-state count; capacity planning |

Cardinality is bounded by your state catalogue. Do not put entity IDs in labels.

### 5.4 "Stuck" detection

The most useful single metric on a durable state machine is "entity in state X for longer than its SLA". A nightly query, an alerting rule, or a real-time scan:

```sql
SELECT id, state, entered_at
FROM orders
WHERE state = 'paid'
  AND entered_at < now() - interval '48 hours';
```

Each state has a max-duration SLA. Crossing it fires an alert. This single check catches the entire class of "workflow stalled but no error was logged" incidents — payment processors that silently 200 but never callback, downstream consumers that crashed without acking, deploys that lost in-flight work.

### 5.5 Audit table

For any durable machine, every transition writes a row to an audit table:

```sql
CREATE TABLE order_transitions (
    id              bigserial PRIMARY KEY,
    order_id        text NOT NULL,
    from_state      text NOT NULL,
    to_state        text NOT NULL,
    event           text NOT NULL,
    actor           text,
    occurred_at     timestamptz NOT NULL DEFAULT now(),
    trace_id        text,
    metadata        jsonb
);
CREATE INDEX ON order_transitions (order_id, occurred_at DESC);
```

This is your single source of truth for "what happened to this entity". When support asks "why is order O123 in `cancelled`", the answer is one query away. The audit table is also the input to compliance reporting and the spine of any future migration to event sourcing.

---

## 6. Persistence strategies

Three patterns dominate, in increasing order of cost and capability.

### 6.1 State-only

Store the state name on the entity row; load it; look up the state object:

```go
type Order struct {
    ID        string
    State     string    // serialized name
    Total     int64
    UpdatedAt time.Time
}

var states = map[string]State{
    "pending":   pendingSingleton,
    "paid":      paidSingleton,
    "shipped":   shippedSingleton,
    "cancelled": cancelledSingleton,
}

func LoadOrder(ctx context.Context, db *sql.DB, id string) (*OrderMachine, error) {
    var o Order
    if err := db.QueryRowContext(ctx,
        `SELECT id, state, total, updated_at FROM orders WHERE id = $1`, id,
    ).Scan(&o.ID, &o.State, &o.Total, &o.UpdatedAt); err != nil {
        return nil, err
    }
    s, ok := states[o.State]
    if !ok {
        return nil, fmt.Errorf("unknown state %q", o.State)
    }
    return &OrderMachine{order: o, state: s}, nil
}
```

Pros: trivial schema; cheap reads; easy to query ("show me all paid orders").
Cons: no history; "how did we get here" requires the audit table from §5.5 as a separate concern.

This is the default for 90% of business workflows. Use it unless you have a specific reason not to.

### 6.2 Event-sourced

Store events; recompute state by replay. The entity row holds nothing but the ID:

```go
type Event struct {
    OrderID    string
    SeqNum     int64
    Kind       string
    OccurredAt time.Time
    Payload    json.RawMessage
}

func LoadOrder(ctx context.Context, db *sql.DB, id string) (*OrderMachine, error) {
    rows, err := db.QueryContext(ctx,
        `SELECT seq, kind, payload FROM order_events
         WHERE order_id = $1 ORDER BY seq ASC`, id)
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    m := &OrderMachine{order: Order{ID: id}, state: pendingSingleton}
    for rows.Next() {
        var ev Event
        if err := rows.Scan(&ev.SeqNum, &ev.Kind, &ev.Payload); err != nil {
            return nil, err
        }
        if err := m.apply(ev); err != nil { // pure function: ev + state -> next state
            return nil, fmt.Errorf("replay event %d: %w", ev.SeqNum, err)
        }
    }
    return m, rows.Err()
}
```

Pros: complete history for free; replayable; debuggable; immune to "the state field got corrupted" scenarios; natural fit for CQRS read models.
Cons: replay cost grows with history; need projections / read models for queries; replay must be deterministic forever (no embedded `time.Now()`); schema migrations on event shape are hard.

Reach for event sourcing when audit is a primary requirement (banking, healthcare, regulated workflows), when you want to derive new read models from old data, or when you need to "time travel" to a past state for debugging or what-ifs. Avoid it when the workload is simple CRUD with state, when the team has no operational appetite for projections and replays, or when "current state" is the only thing anyone actually queries.

### 6.3 Snapshot + events

The hybrid: store events for history, but also store periodic snapshots of computed state. Load by reading the latest snapshot, then replaying events newer than the snapshot:

```go
func LoadOrder(ctx context.Context, db *sql.DB, id string) (*OrderMachine, error) {
    var snap Snapshot
    err := db.QueryRowContext(ctx,
        `SELECT seq, state, total, updated_at FROM order_snapshots
         WHERE order_id = $1 ORDER BY seq DESC LIMIT 1`, id,
    ).Scan(&snap.Seq, &snap.State, &snap.Total, &snap.UpdatedAt)
    if err != nil && !errors.Is(err, sql.ErrNoRows) {
        return nil, err
    }
    m := newMachineFromSnapshot(snap)
    return m, replayEventsSince(ctx, db, id, snap.Seq, m)
}
```

Snapshots cap replay cost at "events since last snapshot". A snapshot every 100 events keeps load time bounded. The snapshot frequency is a tunable per workload.

This is the production shape for any high-volume event-sourced machine. Greenfield event sourcing should plan for snapshots from day one; retrofitting them later is messy.

---

## 7. Concurrency

A state machine handling concurrent input must serialize transitions; the question is how. Three patterns, each with different ergonomics.

### 7.1 Owned-by-goroutine (channel-fed loop)

One goroutine owns the machine; events arrive on a channel:

```go
type Machine struct {
    events chan Event
    state  State
    log    *slog.Logger
}

func (m *Machine) Run(ctx context.Context) {
    for {
        select {
        case ev := <-m.events:
            m.handle(ctx, ev)
        case <-ctx.Done():
            m.shutdown()
            return
        }
    }
}

func (m *Machine) Send(ctx context.Context, ev Event) error {
    select {
    case m.events <- ev:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Pros: no mutex; the state field is never raced; the channel provides FIFO ordering; back-pressure is natural (unbuffered channel blocks fast producers).
Cons: one machine = one goroutine = stack overhead; sending requires the owning goroutine to be alive; introspection ("what state am I in?") needs a query channel or careful read.

This is the most idiomatic Go shape and the default for in-process actor-style machines. The Erlang-style "one process per entity" model maps cleanly onto Go goroutines.

### 7.2 Mutex-guarded

The classic critical section:

```go
type Machine struct {
    mu    sync.Mutex
    state State
}

func (m *Machine) Send(ctx context.Context, ev Event) error {
    m.mu.Lock()
    defer m.mu.Unlock()
    return m.transition(ctx, ev)
}

func (m *Machine) State() string {
    m.mu.Lock()
    defer m.mu.Unlock()
    return m.state.Name()
}
```

Pros: simple; works with synchronous APIs; no extra goroutine per machine.
Cons: the lock spans the action — if the action does I/O, you serialize the whole machine on it; lock contention scales with concurrent senders; deadlock risk if actions call back into the same machine.

Use this for low-throughput machines or when a goroutine-per-machine is too expensive. Watch out for long-running actions inside the critical section; consider releasing the lock during the action and re-acquiring it for the state swap (with the obvious cost: another concurrent caller may have moved the machine in between).

### 7.3 Lock-free with `atomic.Pointer[State]`

For machines where every state is a singleton and transitions are simple swaps, Go 1.19's typed atomics give you a lock-free dispatch:

```go
type Machine struct {
    state atomic.Pointer[State]
}

func (m *Machine) State() State { return *m.state.Load() }

func (m *Machine) TryTransition(from, to *State) bool {
    return m.state.CompareAndSwap(from, to)
}

func (m *Machine) Send(ctx context.Context, ev Event) error {
    for {
        cur := m.state.Load()
        next, err := (*cur).Handle(ctx, ev)
        if err != nil {
            return err
        }
        if next == cur {
            return nil // no transition
        }
        if m.state.CompareAndSwap(cur, next) {
            return nil // we won the race
        }
        // someone else moved the machine; retry
    }
}
```

This is the optimistic-concurrency pattern, equivalent to lock-free linked-list updates. Pros: zero lock contention; scales linearly with cores; the state field is the only shared mutable. Cons: the action runs *before* the CAS, so it may run twice on retries — actions must be idempotent or the action must be moved after the CAS (which means the action sees a state that may already have moved on).

Reach for `atomic.Pointer` when the machine has tiny actions (or none — pure state swaps) and high concurrent traffic. Examples: feature-flag flip from `off` to `on`, leader-election state (`follower` → `candidate` → `leader`), connection pool health (`up` → `degraded` → `down`). For machines with real actions, prefer one of the other two patterns.

### 7.4 Concurrency anti-patterns

- **`RLock` on transitions, `Lock` on reads** — backwards. Transitions mutate; reads do not. The lock direction is `Lock` for transitions, `RLock` for reads.
- **Reading the state field without any lock** — race-detector territory; the field may be torn or stale.
- **Holding the lock across the action's network I/O** — turns a 10ms call into a serialization point for the whole machine.
- **Calling out of the machine, the called code re-enters the machine, deadlock** — keep the machine's external calls non-reentrant or use a re-entrant primitive (not Go's `sync.Mutex` — there is no built-in re-entrant lock; design the call graph instead).

---

## 8. Testing rigorously

A state machine's test suite has three layers: per-transition tests, full-graph property tests, and chaos tests for partial failures.

### 8.1 Per-transition table-driven tests

Generate test cases from the transition table itself. If the table is data, the tests can be too:

```go
func TestOrderTransitions(t *testing.T) {
    legal := map[string]map[string]string{
        "pending":   {"pay": "paid", "cancel": "cancelled"},
        "paid":      {"ship": "shipped", "refund": "refunded", "cancel": "cancelled"},
        "shipped":   {"deliver": "delivered"},
        "delivered": {},
        "cancelled": {},
        "refunded":  {},
    }

    for fromState, events := range legal {
        for ev, expected := range events {
            t.Run(fromState+"/"+ev, func(t *testing.T) {
                m := newMachineInState(fromState)
                if err := m.Send(ctx, Event(ev)); err != nil {
                    t.Fatalf("Send(%q) in %s: %v", ev, fromState, err)
                }
                if got := m.State(); got != expected {
                    t.Fatalf("after Send(%q) in %s: got %s, want %s", ev, fromState, got, expected)
                }
            })
        }
    }

    // Every (state, event) NOT in the table must fail.
    allEvents := []string{"pay", "ship", "cancel", "refund", "deliver"}
    for fromState := range legal {
        for _, ev := range allEvents {
            if _, ok := legal[fromState][ev]; ok {
                continue
            }
            t.Run(fromState+"/"+ev+"/invalid", func(t *testing.T) {
                m := newMachineInState(fromState)
                if err := m.Send(ctx, Event(ev)); err == nil {
                    t.Fatalf("Send(%q) in %s: expected error, got nil", ev, fromState)
                }
            })
        }
    }
}
```

The legal table is your specification. The invalid combinations are checked by exhaustion. New states and events are covered automatically — add a row, the test count goes up, the negative cases come along.

### 8.2 Property tests: no unreachable states, no dead ends

A property tester (gopter, `testing/quick`) can verify graph invariants:

```go
func TestNoUnreachableStates(t *testing.T) {
    visited := map[string]bool{"pending": true}
    queue := []string{"pending"}
    for len(queue) > 0 {
        s := queue[0]
        queue = queue[1:]
        for _, e := range legalEvents(s) {
            next := legalTransition(s, e)
            if !visited[next] {
                visited[next] = true
                queue = append(queue, next)
            }
        }
    }
    for _, s := range allStates {
        if !visited[s] && !isTerminal(s) {
            t.Errorf("state %s is unreachable from initial state", s)
        }
    }
}
```

Bonus checks:

- Every non-terminal state has at least one outgoing transition (no dead ends).
- Every terminal state has zero outgoing transitions.
- The initial state is reachable from itself iff there is a cycle through it (rarely intended).

### 8.3 Chaos tests for partial failures

The hardest bugs are "action succeeds, state swap fails" or "Exit hook runs, Action fails". Inject failures deterministically:

```go
type FlakyDB struct {
    *sql.DB
    failOnQuery int
    queryCount  atomic.Int64
}

func (f *FlakyDB) ExecContext(ctx context.Context, q string, args ...any) (sql.Result, error) {
    n := f.queryCount.Add(1)
    if int(n) == f.failOnQuery {
        return nil, errors.New("injected failure")
    }
    return f.DB.ExecContext(ctx, q, args...)
}

func TestTransition_FailureAtEachStep(t *testing.T) {
    for failAt := 1; failAt <= 5; failAt++ {
        t.Run(fmt.Sprintf("fail_at_query_%d", failAt), func(t *testing.T) {
            db := &FlakyDB{DB: realDB, failOnQuery: failAt}
            m := NewMachine(db)
            err := m.Send(ctx, "pay")
            // assertion depends on which query failed:
            // - Exit hook (q=1): machine still in pending, no audit row
            // - Action (q=2): machine still in pending, audit row absent
            // - State swap (q=3): machine in paid, but action may need replay
            // - Enter hook (q=4): machine in paid, follow-on hook will retry
            // - Audit log (q=5): machine in paid, audit incomplete
            verifyInvariants(t, m, db)
        })
    }
}
```

`verifyInvariants` is the single most important test in the suite: it asserts that after any failure, the machine is in a *recoverable* state — either fully transitioned or fully not, never half. If you cannot make that invariant hold, your transition design is wrong, not your test.

---

## 9. Versioning state machines

The moment a state machine becomes durable, the set of states is a wire format. Adding, renaming, or removing a state is a schema migration with all the same constraints.

### 9.1 Adding states

Additive. Deploy the new state's handler everywhere before any producer can transition into it. Order:

1. Deploy worker code that *recognizes* the new state (loads it, dispatches to its handler) but no producer creates it yet.
2. Verify the deploy across the whole fleet.
3. Deploy producer code that may transition into it.

Skipping step 2 produces "unknown state X" errors on workers that have not yet been updated.

### 9.2 Removing states

The hardest case. Three phases:

1. **Stop entering the state.** Producers no longer transition into `legacy_X`. Existing entities in `legacy_X` are not affected.
2. **Migrate stuck entities.** Run a one-shot job that moves any entity in `legacy_X` to its new home (often a freshly added state, or directly to a terminal).
3. **Remove the handler.** Only after step 2 confirms zero entities remain in `legacy_X`. Verify with a query before deploying.

The interval between phases is measured in days for a fast workflow, weeks for a slow one. Removing the handler before the migration finishes is the cause of the worst incident in this class.

### 9.3 Renaming events

Renaming an event (the input that triggers a transition) is a two-deploy operation. Period.

1. Add the new name as an alias for the old; both work; transitions log under the new name.
2. Update producers to send the new name.
3. After producers have all rolled out, remove the old alias.

Skipping step 1 means producers and consumers on different versions cannot communicate. This is the most common versioning bug in homegrown FSMs.

### 9.4 Double-write during migration

For complex migrations (splitting a state into two, merging two into one), the safe pattern is to keep both shapes alive for the duration:

```go
// Old: single 'paid' state
// New: 'paid_with_invoice' and 'paid_without_invoice'

func (s *Paid) Enter(ctx context.Context, m *Machine) error {
    // During migration, write both the legacy state name and the new one.
    return m.db.ExecContext(ctx,
        `UPDATE orders SET state = $1, state_v2 = $2 WHERE id = $3`,
        "paid", classifyPaid(m), m.id)
}
```

The new column is populated forever-forward. Once every entity has a value, you can flip reads to the new column, then drop the old. This is expand-contract migration applied to state machines.

---

## 10. When NOT to use State

The State pattern (the struct-per-state form) is overkill for a wide swath of real cases. The senior heuristic: if you find yourself reaching for State, check first whether one of these simpler shapes fits.

### 10.1 Only two states: just use a `bool`

```go
type Connection struct {
    open atomic.Bool
}

func (c *Connection) Send(b []byte) error {
    if !c.open.Load() {
        return ErrClosed
    }
    return c.write(b)
}
```

No interface, no struct, no map, no transition logging beyond what the `Close` path already does. Two states is `bool` territory.

### 10.2 Linear progression: just use a counter

```go
type Upload struct {
    chunkIdx int
    total    int
}

func (u *Upload) Done() bool { return u.chunkIdx == u.total }
```

A multi-step linear process (chunk 0 → chunk 1 → ... → chunk N → done) is a counter, not a state machine. The "state" is `chunkIdx`. The "transitions" are `chunkIdx++`. Encoding it as named states is ceremony.

### 10.3 The state doesn't change behavior

If `if state == X` never appears anywhere in your code, you do not have a State pattern; you have a status field. A status that is reported but never branched on is a tag, not a state. Keep it as a string.

### 10.4 The state graph is two states and one transition

```go
func Process(input string) (Result, error) { /* ... */ }
```

is a function. There is no FSM hiding inside. Senior pattern-recognition includes recognizing the absence of a pattern.

### 10.5 The "state" is actually configuration

A `Mode` field set once at startup and never changed is configuration, not state. Pass it in via constructor; do not dress it up as a machine.

---

## 11. Closing — what mastery looks like

The State pattern is finite-state-machine thinking, applied at whatever level your system needs. The encoding (struct-per-state, function-per-state, table-driven) is mechanical. The skill is the discipline.

Mastery is:

- **Recognizing FSMs in code that doesn't look like them yet.** The `net/http` request lifecycle is an FSM. The `*sql.Tx` lifecycle is an FSM. The Kubernetes pod lifecycle is an FSM. A senior engineer sees the implicit machine before writing the explicit one, and asks whether making it explicit would buy enough to be worth the code.
- **Choosing the encoding by force, not by familiarity.** Behavior-per-state for rich per-mode logic, state-function for streaming work, table-driven for large uniform graphs. Mix them when the system genuinely has multiple shapes.
- **Designing the persistence boundary deliberately.** State-only for simple workflows, event-sourced where audit is paramount, snapshot+events when replay cost matters. The persistence decision drives almost everything else — concurrency, versioning, observability.
- **Treating every transition as a transaction.** Guard → Exit → Action → swap → Enter → observe, in that order. Document whether the machine is transactional, eventually consistent, or best-effort. Mixing them inside one machine is the bug source.
- **Putting observability in from the start.** `slog` records on every transition. OpenTelemetry spans on long-lived states. Three metrics: duration histogram, transition counter, in-flight gauge. A "stuck" detector. An audit table. None of these are optional in production.
- **Picking concurrency by traffic shape.** Channel-fed loop is the Go default. Mutex when the goroutine-per-entity cost is too high. `atomic.Pointer[State]` only when the action is trivial and the contention is real.
- **Testing the full transition table.** Property tests for unreachable states. Chaos tests for partial failures. Verify the invariant: after any failure, the machine is in a recoverable shape.
- **Versioning the state set like a schema.** Add states with expand-contract. Rename events with aliases. Never deploy producer-first.
- **Recognizing when not to use the pattern.** Two states is a `bool`. Linear progress is a counter. A status that nothing branches on is a tag. Senior judgment is knowing when the apparatus exceeds the need.

The State pattern is one of the GoF patterns that aged best — partly because it predates and survives every framework around it, partly because it maps cleanly onto a mathematical object (the FSM) whose properties are well-understood. The Go ecosystem has converged on a small set of shapes (state-function for lexers, table-driven for workflows, durable event-sourced for cross-service work) that reflect the language's strengths. Knowing which to reach for is the senior skill; the rest is plumbing.

---

## Further reading

- Rob Pike, *Lexical scanning in Go* (2011) — the state-function form, with the template lexer as worked example
- `text/template/parse/lex.go` — production state-function lexer in the standard library
- `looplab/fsm` — table-driven FSM library
- `qmuntal/stateless` — declarative state machine with hierarchical states and guards
- `temporal.io/sdk-go` — durable workflows as event-sourced state machines
- Martin Fowler, *State Machine* (refactoring.com) — concepts independent of language
- Greg Young, *CQRS and Event Sourcing* — the conceptual ground beneath event-sourced FSMs
- RFC 793 §3.2 — the TCP state diagram, still the textbook example after fifty years
- David Harel, *Statecharts: A Visual Formalism for Complex Systems* (1987) — hierarchical and orthogonal states; the basis for Stateless and UML state machines

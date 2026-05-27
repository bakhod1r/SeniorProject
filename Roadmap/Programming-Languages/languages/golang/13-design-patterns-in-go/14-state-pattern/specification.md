# State Pattern — Specification

## 1. Origins

The State pattern was formalized in *Design Patterns: Elements of Reusable Object-Oriented Software* (Gamma, Helm, Johnson, Vlissides, 1994):

> "Allow an object to alter its behavior when its internal state changes. The object will appear to change its class."

Historical predecessors:

- **Mealy machine (1955)** — George H. Mealy's model where the output of a finite-state automaton depends on both the current state and the input symbol.
- **Moore machine (1956)** — Edward F. Moore's variant where the output depends only on the current state. Both formalisms underpin every modern FSM.
- **Harel statecharts (1987)** — David Harel's *Statecharts: A Visual Formalism for Complex Systems* introduced hierarchical states, parallel regions, history pseudostates, and broadcast events.
- **UML state diagrams (1997)** — Booch, Rumbaugh, and Jacobson absorbed statecharts into UML 1.1; UML 2.5 standardised entry/exit/do activities and composite states.

In post-GoF history:

- **TCP RFC 793 (1981)** — eleven explicit connection states (`LISTEN`, `SYN_SENT`, `ESTABLISHED`, `FIN_WAIT_1`, …) with documented transitions; the canonical large FSM in systems software.
- **Erlang OTP `gen_statem` (2000s)** — supervised state machines as first-class processes; influenced later workflow engines.
- **WPF/Silverlight `VisualStateManager` (2008)** — declarative UI state transitions.
- **AWS Step Functions (2016)** — JSON-described state machines as a managed service.

Go-specific history:

- **Rob Pike, *Lexical Scanning in Go* (2011)** — the GopherCon-era talk that introduced the `type stateFn func(*Lexer) stateFn` form; the lexer is a state machine where the state *is* the next function to call.
- **`text/template/parse/lex.go` (Go 1.0, 2012)** — the canonical state-function implementation in the standard library.
- **`looplab/fsm` (2013)** — table-driven FSM library inspired by Fowler's *State Machine*.
- **`qmuntal/stateless` (2019)** — Go port of the .NET `Stateless` library; declarative, fluent state machine configuration.
- **Temporal Go SDK (2019)** — `temporal.io/sdk-go` exposes durable workflows whose state is checkpointed event-by-event by the Temporal service.

Go's idiom is plural: the textbook behavior-per-state form coexists with Pike's state-function form and the table-driven form. Choosing among them is the senior-level skill.

---

## 2. Go language mechanics

### 2.1 Interface-based dispatch

The classic GoF form maps directly to a Go interface. Each state is a type satisfying the same interface; the context holds a value of the interface type and forwards calls to it.

```go
type State interface {
    Pay(*Order) error
    Ship(*Order) error
    Cancel(*Order) error
    Name() string
}

type Order struct {
    state State
}

func (o *Order) Pay() error { return o.state.Pay(o) }
```

Dispatch is virtual via the interface table; transition is a field assignment. The cost is one indirect call and zero allocation if state values are stateless (e.g., `Pending{}` as a zero-sized struct).

### 2.2 State-function form

State as a function: `type stateFn func(*Machine) stateFn`. The function does its work and returns the next function; a loop drives the machine.

```go
type stateFn func(*Lexer) stateFn

func (l *Lexer) run() {
    for state := lexText; state != nil; {
        state = state(l)
    }
}
```

No interface, no allocation per transition, no introspection. The state is opaque — you cannot ask "which state am I in?" from outside without storing a name alongside.

### 2.3 Table-driven form

The state machine is data: a slice or map of `(from, event) → (to, action)` rows. Dispatch is a lookup.

```go
type transition struct {
    From, Event, To string
    Guard           func(*Machine) bool
    Action          func(*Machine) error
}

var orderFSM = []transition{
    {"pending", "pay",    "paid",      nil, payHandler},
    {"paid",    "ship",   "shipped",   nil, shipHandler},
}
```

The graph can be validated, visualised, or diffed against a reference. The behaviour lives in handler functions detached from the state name.

### 2.4 `iota` enums for state identity

When states are uniform identifiers (no per-state behaviour beyond the row), `iota` gives compact, comparable values:

```go
type State uint8

const (
    StatePending State = iota
    StatePaid
    StateShipped
    StateCancelled
)

func (s State) String() string {
    return [...]string{"pending", "paid", "shipped", "cancelled"}[s]
}
```

Equality is a single byte comparison; storage is one byte; serialisation goes through `String()`/`UnmarshalText`. Use this when the FSM is table-driven and you don't need per-state methods.

### 2.5 `atomic.Pointer[T]` for lock-free swap

For high-throughput machines where readers vastly outnumber transitions, an `atomic.Pointer[State]` (Go 1.19+) avoids a mutex on the read path:

```go
type Machine struct {
    state atomic.Pointer[State]
}

func (m *Machine) Current() *State { return m.state.Load() }

func (m *Machine) transition(next *State) {
    m.state.Store(next)
}
```

The transition is observed atomically by every reader; no torn pointer. Writers still need coordination if multiple events can transition concurrently (a CAS loop or a serialised event channel).

---

## 3. Canonical Go shapes

### 3.1 Behavior-per-state

```go
type State interface {
    Enter(*Machine)
    Tick(*Machine, Event) State
    Exit(*Machine)
    Name() string
}

type Machine struct {
    state State
    data  Context
    log   *slog.Logger
}

func (m *Machine) Transition(next State) {
    m.state.Exit(m)
    m.log.Info("state transition", "from", m.state.Name(), "to", next.Name())
    m.state = next
    m.state.Enter(m)
}

func (m *Machine) Send(ev Event) {
    if next := m.state.Tick(m, ev); next != nil && next != m.state {
        m.Transition(next)
    }
}
```

Used when each state has rich, distinct behaviour: game character states, REPL phases, parser modes.

### 3.2 State-function (Rob Pike lexer)

```go
type stateFn func(*Lexer) stateFn

func lexText(l *Lexer) stateFn {
    for {
        if strings.HasPrefix(l.input[l.pos:], "{{") {
            return lexAction
        }
        if l.next() == eof {
            return nil
        }
    }
}

func lexAction(l *Lexer) stateFn { /* parse {{ ... }}, return lexText or nil */ }
```

Used for streaming, mostly-linear state graphs: lexers, scanners, protocol decoders.

### 3.3 Table-driven

```go
type Transition struct {
    From, Event, To string
    Guard           func(*Machine) bool
    Action          func(*Machine) error
}

func (m *Machine) Send(event string) error {
    for _, t := range m.table {
        if t.From != m.state || t.Event != event {
            continue
        }
        if t.Guard != nil && !t.Guard(m) {
            return fmt.Errorf("guard failed for %s/%s", m.state, event)
        }
        if t.Action != nil {
            if err := t.Action(m); err != nil {
                return err
            }
        }
        m.state = t.To
        return nil
    }
    return fmt.Errorf("invalid event %q in state %q", event, m.state)
}
```

Used for large, uniform graphs: TCP, protocol handlers, workflow engines.

### 3.4 Hierarchical (composite states)

Harel statecharts allow a state to contain substates; events bubble up if the active substate does not handle them.

```go
type CompositeState struct {
    name     string
    sub      State
    onEvent  func(*Machine, Event) State
}

func (c *CompositeState) Tick(m *Machine, ev Event) State {
    if next := c.sub.Tick(m, ev); next != nil {
        c.sub = next
        return c
    }
    return c.onEvent(m, ev)
}
```

Used when many states share entry/exit logic — e.g., "Connected" is a parent of `Authenticated`, `Idle`, `Busy`, all of which share a heartbeat timer.

### 3.5 Event-sourced (state = fold of events)

State is not stored — events are. Current state is the left-fold of every event applied to a zero value.

```go
type Event interface {
    Apply(*Order)
}

func Replay(events []Event) *Order {
    o := &Order{}
    for _, e := range events {
        e.Apply(o)
    }
    return o
}
```

Used in audit-critical domains (banking, healthcare) and as the foundation of CQRS + event sourcing.

---

## 4. Standard library use

### 4.1 `text/template/parse/lex.go` — state-function lexer

```go
type stateFn func(*lexer) stateFn

func (l *lexer) run() {
    for l.state = lexText; l.state != nil; {
        l.state = l.state(l)
    }
}
```

The canonical Go state machine. Each `lexFoo` parses one syntactic region and returns the next function. `nil` terminates the lexer.

### 4.2 `encoding/json` decoder — implicit state machine

The streaming decoder in `encoding/json/v2` (and the implicit machine in v1's `scanner`) tracks parsing context (in-array, in-object-key, in-object-value, in-string) via integer state codes:

```go
type scanner struct {
    step       func(*scanner, byte) int
    parseState []int
}
```

`step` is a function-valued field — a state function — that changes as the scanner advances through the JSON grammar.

### 4.3 `net/http.Request` lifecycle — informal FSM

A `*http.Request` flows through implicit states: assembled → written to wire → response received → body read → body closed. The transitions are not encoded as named states but as method legality (`Body.Read` after `Close` is an error; `Write` to an `http.ResponseWriter` after `WriteHeader` overrides nothing).

### 4.4 `net.Conn` (TCP states under the hood)

Below the `net.Conn` interface, the kernel maintains the eleven RFC 793 TCP states per connection. The `tcpconn` Go type exposes no state field — the OS owns it — but `getsockopt(SO_ERROR)` and `/proc/net/tcp` expose it for diagnostics.

### 4.5 `sync.WaitGroup` counters (degenerate FSM with one counter)

`WaitGroup` is a one-counter FSM: states are *positive count* (Wait blocks) and *zero count* (Wait returns). `Add` and `Done` are the events; `Wait` is the query. Calling `Add` after the counter reaches zero with waiters present is a documented error — a guarded transition.

---

## 5. Real library use

### 5.1 `looplab/fsm` — table-driven FSM

```go
fsm := fsm.NewFSM(
    "pending",
    fsm.Events{
        {Name: "pay",    Src: []string{"pending"}, Dst: "paid"},
        {Name: "ship",   Src: []string{"paid"},    Dst: "shipped"},
        {Name: "cancel", Src: []string{"pending", "paid"}, Dst: "cancelled"},
    },
    fsm.Callbacks{
        "before_pay": func(ctx context.Context, e *fsm.Event) { /* guard */ },
        "after_pay":  func(ctx context.Context, e *fsm.Event) { /* action */ },
    },
)

_ = fsm.Event(ctx, "pay")
```

The transition table is the source of truth. Callbacks fire at named lifecycle points (`before_<event>`, `leave_<state>`, `enter_<state>`, `after_<event>`).

### 5.2 `qmuntal/stateless` — declarative API (port of Stateless.NET)

```go
sm := stateless.NewStateMachine(StatePending)
sm.Configure(StatePending).
    Permit(TriggerPay,    StatePaid).
    Permit(TriggerCancel, StateCancelled)
sm.Configure(StatePaid).
    OnEntry(startShipTimer).
    OnExit(stopShipTimer).
    Permit(TriggerShip, StateShipped)

_ = sm.Fire(TriggerPay)
```

Fluent builder. Entry/exit hooks per state; guards as `PermitIf`. Influenced by .NET's `Stateless` library (Nicholas Blumhardt, 2009).

### 5.3 `temporal.io/sdk-go` — durable workflow FSM

```go
func OrderWorkflow(ctx workflow.Context, input OrderInput) error {
    if err := workflow.ExecuteActivity(ctx, ChargeCard, input).Get(ctx, nil); err != nil {
        return err
    }
    if err := workflow.ExecuteActivity(ctx, ShipOrder, input).Get(ctx, nil); err != nil {
        _ = workflow.ExecuteActivity(ctx, RefundCard, input).Get(ctx, nil)
        return err
    }
    return nil
}
```

The workflow function is the state machine; Temporal persists each activity completion as an event. On worker restart the function is replayed against the event history to reconstruct the logical state. The Go code reads like a synchronous procedure; the runtime turns it into a durable FSM.

### 5.4 `nats-io/jetstream` — consumer state machines

Each JetStream consumer is a server-side FSM tracking delivered, acknowledged, pending, and redelivered messages per subscriber. The Go client (`nats.go/jetstream`) exposes consumer state via `consumer.Info()`; transitions (ack, nack, in-progress, term) are events sent to the server.

### 5.5 `golang/protobuf` parser — state-function lexer

`protoc-gen-go`'s `.proto` parser uses Pike-style state functions to tokenise the schema language. The same shape appears in `gogo/protobuf` and the newer `protocompile` package.

---

## 6. Formal specification

A Go State implementation consists of:

| Element | Description |
|---------|-------------|
| **Context** | The object whose behavior depends on state. |
| **State** | A behavior set — interface implementation, function, or table row. |
| **Event** | Input that may trigger a transition. |
| **Guard** | Predicate that gates a transition. |
| **Action** | Side effect run during a transition. |
| **Transition** | Tuple `(from, event) → (to, action)`. |
| **Entry/Exit** | Lifecycle hooks on a state. |

**Invariants:**

1. At any moment, exactly one state is current. The machine is never partially transitioned from the outside's point of view.
2. Transitions are atomic — the swap is observable instantly. Readers see the old state or the new state, never an intermediate.
3. Invalid events in the current state are reported as errors, not silently dropped. An FSM that swallows unknown events hides bugs.
4. Persistence stores the state *name* (or `iota` value); behavior is reconstructed via a lookup table. State objects carry behavior, not data — data lives on the context.
5. Every transition is logged — minimally, `(from, event, to, ts)`. For regulated domains, the log is the audit trail.

---

## 7. Anti-patterns

### 7.1 Status-field switch (no state objects)

```go
func (o *Order) Pay() error {
    switch o.status {
    case "pending":
        o.status = "paid"
    case "paid", "shipped":
        return fmt.Errorf("can't pay")
    }
    return nil
}
```

Eight cases for two methods; eighty for five methods. Adding a state edits every method. **Fix:** extract states into types (3.1) or a table (3.3).

### 7.2 Storing the state object in the DB

```go
var o Order
json.Unmarshal(row, &o)
o.state = ???  // can't unmarshal an interface
```

State objects are behavior, not data. When the type changes (rename, new field, new method) the stored data fails to deserialise. **Fix:** persist `o.statusName string`; reconstruct via `states[name]` lookup.

### 7.3 Action runs before guard

```go
func (m *Machine) Send(ev Event) error {
    m.action(ev)            // side effect
    if !m.guard(ev) {       // checked after the fact
        return errInvalid
    }
    m.state = next
    return nil
}
```

The side effect persists even when the transition was illegal. **Fix:** check guard first; run action only on a green light; swap state last.

### 7.4 No exit hook on terminal state

A `Paid` state starts a "auto-cancel in 7 days" timer in `Enter`. The order ships and the machine moves to `Shipped` — but no `Exit` ran on `Paid`, so the timer fires a week later on a shipped order. **Fix:** every transition runs `prev.Exit(); next.Enter()`. Terminal states must release the resources their `Enter` acquired.

### 7.5 Shared mutable context with no protection

Multiple goroutines call `Send`; the context's `Balance` field is read by `Pay` and written by `Refund` concurrently. **Fix:** funnel events through a single goroutine (channel-fed loop) or guard the machine with one mutex; never let two events execute in parallel against the same context.

### 7.6 Comparing interface states with `==`

```go
if m.state == Paid{} { ... }
```

This works only because `Paid{}` is a zero-sized struct value held in an interface — the comparison is on type and value. If `Paid` becomes a pointer type or grows fields, `==` silently changes meaning. **Fix:** compare names: `m.state.Name() == "paid"`.

### 7.7 State knows its own next state (couples the graph)

```go
func (Pending) Pay(o *Order) error { o.setState(Paid{}); return nil }
func (Paid)    Ship(o *Order) error { o.setState(Shipped{}); return nil }
```

The transition graph is now scattered across N state types; reading the FSM means visiting every file. **Fix:** the *machine* decides the next state from a table or rule; states return the proposed next or an event, not the literal next type.

---

## 8. Variants and dialects

| Variant | Use case |
|---------|----------|
| Behavior-per-state | Rich, distinct per-state code (game states, parser modes) |
| State-function | Streaming/linear graphs (lexers, scanners, protocol decoders) |
| Table-driven | Large uniform graphs (TCP, order workflows, looplab/fsm) |
| Hierarchical (HSM) | Shared substates with common entry/exit (Harel statecharts) |
| Event-sourced | Audit + replay (banking, CQRS, Temporal histories) |
| Distributed FSM | Cross-service workflow (Temporal, Cadence, Step Functions) |

---

## 9. Naming conventions

- **States:** PascalCase nouns — `Pending`, `Paid`, `Shipped`, `Cancelled`, `Connected`, `Authenticated`.
- **Events:** imperative verbs — `Pay`, `Ship`, `Cancel`, `Connect`, `Disconnect`, `Heartbeat`.
- **Machine type:** `*Machine`, `*FSM`, `*Workflow`, `*Lexer`, `*Scanner` — domain-flavoured.
- **Hooks:** `Enter`, `Exit`, `Tick`/`Handle`/`Step`; entries are `OnEntry<State>`, exits `OnExit<State>`.
- **Terminal states:** `Done`, `Closed`, `Cancelled`, `Failed`, `Completed`.
- **State enum prefix:** `StateFoo` for `iota` constants; `TriggerBar` for events when ambiguity matters (`qmuntal/stateless` convention).
- **Lookup tables:** `states map[string]State`, `transitions []Transition`.

---

## 10. Related patterns

| Pattern | Distinction |
|---------|-------------|
| **Strategy** | Switches algorithm at the call site; State switches lifecycle position over time. Strategy is injected; State is mutated. |
| **Command** | An action object; an FSM can dispatch commands as its actions. Commands are *what to do*; states are *what mode we're in*. |
| **Memento** | Snapshot of state for restore/undo; complements an FSM that needs rollback. |
| **Observer** | Listeners attached to transitions; an FSM publishes `(from, event, to)` to subscribers. |
| **Mediator** | Coordinator across multiple FSMs; resolves cross-machine events (e.g., order FSM + payment FSM + shipment FSM). |
| **Workflow Engine** | Durable runtime for FSMs (Temporal, Cadence, Step Functions); persists transitions, retries activities, survives restarts. |
| **Interpreter** | A grammar interpreter is often a stack of state machines; the parser state and the evaluator state cooperate. |

---

## 11. Further reading

- **GoF (1994)** — original State pattern.
- **David Harel, *Statecharts: A Visual Formalism for Complex Systems* (Science of Computer Programming, 1987)** — hierarchical state machines.
- **UML 2.5 state machine specification** — formal semantics of entry/exit/do, composite states, history pseudostates.
- **Rob Pike, *Lexical Scanning in Go* (GopherCon 2011)** — the state-function form.
- **`text/template/parse/lex.go`** — production state-function lexer.
- **`looplab/fsm`, `qmuntal/stateless`** — table-driven and declarative Go FSM libraries.
- **Temporal architecture documentation** — durable workflow as event-sourced FSM.
- **Leslie Lamport, *Time, Clocks, and the Ordering of Events in a Distributed System* (CACM 1978)** — foundational reasoning about state and causality across processes.
- **Martin Fowler, *State Machine* (refactoring.com)** — pragmatic refactoring from status-field to state objects.
- **RFC 793 §3.2** — TCP state diagram as the canonical large FSM.

State in Go means choosing one of three forms — behavior-per-state, state-function, table-driven — for a domain that is fundamentally a finite state machine. Senior-level skill is recognising FSMs in code that doesn't look like one yet.

---

## 12. Glossary

| Term | Meaning |
|------|---------|
| **FSM** | Finite State Machine — a system with finitely many named modes and rule-driven transitions. |
| **HSM** | Hierarchical State Machine — composite states containing substates (Harel). |
| **Mealy** | FSM where output depends on state + input. |
| **Moore** | FSM where output depends only on state. |
| **Statechart** | Hierarchical FSM with parallel regions, broadcast events, and history (Harel). |
| **Transition** | A rule of the form `(state, event) → (state, action)`. |
| **Guard** | Predicate gating a transition; if false, the event is rejected. |
| **Snapshot** | Stored summary of FSM state at a moment in time. |
| **Event sourcing** | Persist events, compute state by folding them; the event log is the source of truth. |
| **Workflow** | Long-lived FSM with checkpointing across process restarts. |
| **Entry/Exit hook** | Code that runs when a state is entered or exited. |
| **Composite state** | A state that contains substates and shares their entry/exit behavior. |
| **Terminal state** | A state with no outgoing transitions — the machine is finished. |

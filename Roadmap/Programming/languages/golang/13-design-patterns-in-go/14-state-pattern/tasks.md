# State Pattern — Hands-on Tasks

## 1. How to use this file

Fifteen progressive tasks, ordered from "refactor a fat switch" to "build a Temporal-lite durable workflow engine". Each task has:

- **Goal** — one sentence stating what you are building and why.
- **Starter** — an incomplete sketch. Type it out by hand, do not paste.
- **Hints** — bullets you can read when stuck. Avoid them on the first pass.
- **Reference solution** — a collapsible, complete, compileable Go program. Senior decisions are called out in comments inside the code.

The code targets Go 1.22+ (`for` loop variable scoping, `reflect.TypeFor`, generics, `errors.Join`, `log/slog`). Every solution is self-contained `package main` unless noted — `go run file.go` should work.

The arc: start with an order whose `status` field is a string, lift it into per-state types, then a table, then a generic machine; weave in `Enter`/`Exit` hooks, guards, channel-fed concurrency, persistence, event sourcing, hierarchical states, stuck-detection, and finally land on a small but production-shaped durable workflow runtime.

---

## 2. Difficulty legend

| Tag | Level | What it means |
|-----|-------|---------------|
| **B** | Beginner | Reach for interfaces, basic structs, and `switch`. Roughly junior.md territory. |
| **I** | Intermediate | Hooks, guards, table-driven dispatch, channel ownership. Maps to middle.md. |
| **A** | Advanced | Persistence, generics, event sourcing, hierarchical FSMs, background watchers. |
| **S** | Stretch | One bigger project that combines everything. |

---

## 3. Tasks

### Task 1 (B) — Status switch refactor

**Goal:** Take an `Order` whose every method is a fat `switch o.status`, refactor it to the classic State pattern with one type per status. The behavior must stay identical; the structure must change.

**Starter:**

```go
package main

import "fmt"

// Before:
type Order struct {
    ID     string
    status string // "pending" | "paid" | "shipped" | "cancelled"
}

func (o *Order) Pay() error {
    switch o.status {
    case "pending":
        o.status = "paid"
        return nil
    default:
        return fmt.Errorf("can't pay in %s", o.status)
    }
}

// TODO: define OrderState interface { Pay, Ship, Cancel, Name }
// TODO: implement Pending, Paid, Shipped, Cancelled as value types
// TODO: rewrite Order to forward Pay/Ship/Cancel through state
```

**Hints:**

- The interface should have the same methods the `Order` exposed: `Pay`, `Ship`, `Cancel`, `Name`.
- Each state takes `*Order` so it can swap the state pointer.
- Value receivers are fine — these states are stateless singletons.
- Adding `var _ OrderState = Pending{}` after each state catches missed methods at compile time.

<details><summary>Reference solution</summary>

```go
package main

import (
    "errors"
    "fmt"
)

// OrderState is the behavior interface. Every concrete state implements it.
// The Order itself only forwards — it does not contain any business rule.
type OrderState interface {
    Pay(*Order) error
    Ship(*Order) error
    Cancel(*Order) error
    Name() string
}

// Order is the Context. It carries domain data and a pointer to the
// current state. Methods are one-liners that delegate.
type Order struct {
    ID    string
    state OrderState
}

func NewOrder(id string) *Order {
    // Senior decision: the zero value of Order is not a valid Order.
    // A constructor forces every Order to start in a known state.
    return &Order{ID: id, state: Pending{}}
}

func (o *Order) setState(s OrderState) { o.state = s }
func (o *Order) State() string         { return o.state.Name() }
func (o *Order) Pay() error            { return o.state.Pay(o) }
func (o *Order) Ship() error           { return o.state.Ship(o) }
func (o *Order) Cancel() error         { return o.state.Cancel(o) }

// --- states ---

type Pending struct{}

func (Pending) Name() string                { return "pending" }
func (Pending) Pay(o *Order) error          { o.setState(Paid{}); return nil }
func (Pending) Ship(*Order) error           { return errors.New("can't ship unpaid order") }
func (Pending) Cancel(o *Order) error       { o.setState(Cancelled{}); return nil }

type Paid struct{}

func (Paid) Name() string                   { return "paid" }
func (Paid) Pay(*Order) error               { return errors.New("already paid") }
func (Paid) Ship(o *Order) error            { o.setState(Shipped{}); return nil }
func (Paid) Cancel(o *Order) error          { o.setState(Cancelled{}); return nil }

type Shipped struct{}

func (Shipped) Name() string                { return "shipped" }
func (Shipped) Pay(*Order) error            { return errors.New("already paid") }
func (Shipped) Ship(*Order) error           { return errors.New("already shipped") }
func (Shipped) Cancel(*Order) error         { return errors.New("can't cancel a shipped order") }

type Cancelled struct{}

func (Cancelled) Name() string              { return "cancelled" }
func (Cancelled) Pay(*Order) error          { return errors.New("cancelled") }
func (Cancelled) Ship(*Order) error         { return errors.New("cancelled") }
func (Cancelled) Cancel(*Order) error       { return errors.New("already cancelled") }

// Compile-time interface checks. Cheap insurance.
var (
    _ OrderState = Pending{}
    _ OrderState = Paid{}
    _ OrderState = Shipped{}
    _ OrderState = Cancelled{}
)

func main() {
    o := NewOrder("o-1")
    fmt.Println("start:", o.State())
    _ = o.Pay()
    fmt.Println("after pay:", o.State())
    _ = o.Ship()
    fmt.Println("after ship:", o.State())
    if err := o.Cancel(); err != nil {
        fmt.Println("cancel error:", err)
    }
}
```

</details>

---

### Task 2 (B) — Traffic light

**Goal:** Model a Red → Green → Yellow → Red cycle. A single `Next()` call advances the light. This is the smallest non-trivial state machine and it forces you to think about *cyclic* state graphs, which an order workflow does not have.

**Starter:**

```go
package main

type Light interface {
    Next(t *TrafficLight)
    Color() string
}

type TrafficLight struct {
    state Light
}

// TODO: Red, Green, Yellow types implementing Light
// TODO: NewTrafficLight() — starts on Red
// TODO: (t *TrafficLight) Tick() — advances by one
```

**Hints:**

- `Red` transitions to `Green`, `Green` to `Yellow`, `Yellow` to `Red`. The graph is a 3-cycle.
- The state types are stateless — keep them as zero-size structs.
- A loop in `main` that calls `Tick()` six times should print R, G, Y, R, G, Y.

<details><summary>Reference solution</summary>

```go
package main

import "fmt"

type Light interface {
    Next(t *TrafficLight)
    Color() string
}

type TrafficLight struct {
    state Light
}

func NewTrafficLight() *TrafficLight {
    return &TrafficLight{state: Red{}}
}

// Senior decision: Tick (not Next) on the Context. The Context drives
// the transition; the state computes the next one.
func (t *TrafficLight) Tick()         { t.state.Next(t) }
func (t *TrafficLight) Color() string { return t.state.Color() }

type Red struct{}

func (Red) Color() string         { return "red" }
func (Red) Next(t *TrafficLight)  { t.state = Green{} }

type Green struct{}

func (Green) Color() string        { return "green" }
func (Green) Next(t *TrafficLight) { t.state = Yellow{} }

type Yellow struct{}

func (Yellow) Color() string        { return "yellow" }
func (Yellow) Next(t *TrafficLight) { t.state = Red{} }

func main() {
    t := NewTrafficLight()
    for i := 0; i < 6; i++ {
        fmt.Println(t.Color())
        t.Tick()
    }
}
```

</details>

---

### Task 3 (B) — State names from constants

**Goal:** Replace string state names with `iota` constants. The state machine should hold a `Status` (typed `int`) instead of a string; a lookup table maps `Status` to behavior. This is the form most production codebases settle on because it serializes well and prevents typos.

**Starter:**

```go
package main

type Status int

const (
    StatusPending Status = iota
    StatusPaid
    StatusShipped
    StatusCancelled
)

// TODO: func (s Status) String() string
// TODO: var orderStates = map[Status]OrderState{ ... }
// TODO: rewrite Order to hold Status, not OrderState
```

**Hints:**

- `Stringer` (`func (s Status) String() string`) gives you free `%s` formatting and `fmt.Println` output.
- The lookup table is created once at init time; states are still stateless values.
- Storing the `Status` (int or string name) instead of the state object is the trick that makes persistence trivial in later tasks.

<details><summary>Reference solution</summary>

```go
package main

import (
    "errors"
    "fmt"
)

type Status int

const (
    StatusPending Status = iota
    StatusPaid
    StatusShipped
    StatusCancelled
)

// Stringer: the FSM stores Status, but logs/JSON should show the name.
func (s Status) String() string {
    switch s {
    case StatusPending:
        return "pending"
    case StatusPaid:
        return "paid"
    case StatusShipped:
        return "shipped"
    case StatusCancelled:
        return "cancelled"
    }
    return fmt.Sprintf("unknown(%d)", int(s))
}

type OrderState interface {
    Pay(*Order) error
    Ship(*Order) error
    Cancel(*Order) error
}

type Order struct {
    ID     string
    status Status
}

func NewOrder(id string) *Order { return &Order{ID: id, status: StatusPending} }
func (o *Order) Status() Status { return o.status }

// The Order dispatches through the registry. The registry is built once.
func (o *Order) Pay() error    { return orderStates[o.status].Pay(o) }
func (o *Order) Ship() error   { return orderStates[o.status].Ship(o) }
func (o *Order) Cancel() error { return orderStates[o.status].Cancel(o) }

type pendingState struct{}

func (pendingState) Pay(o *Order) error    { o.status = StatusPaid; return nil }
func (pendingState) Ship(*Order) error     { return errors.New("can't ship unpaid order") }
func (pendingState) Cancel(o *Order) error { o.status = StatusCancelled; return nil }

type paidState struct{}

func (paidState) Pay(*Order) error         { return errors.New("already paid") }
func (paidState) Ship(o *Order) error      { o.status = StatusShipped; return nil }
func (paidState) Cancel(o *Order) error    { o.status = StatusCancelled; return nil }

type shippedState struct{}

func (shippedState) Pay(*Order) error    { return errors.New("already paid") }
func (shippedState) Ship(*Order) error   { return errors.New("already shipped") }
func (shippedState) Cancel(*Order) error { return errors.New("can't cancel shipped") }

type cancelledState struct{}

func (cancelledState) Pay(*Order) error    { return errors.New("cancelled") }
func (cancelledState) Ship(*Order) error   { return errors.New("cancelled") }
func (cancelledState) Cancel(*Order) error { return errors.New("already cancelled") }

// Senior decision: registry built once at package init. Each state is a
// flyweight — one value reused across every Order in the process.
var orderStates = map[Status]OrderState{
    StatusPending:   pendingState{},
    StatusPaid:      paidState{},
    StatusShipped:   shippedState{},
    StatusCancelled: cancelledState{},
}

func main() {
    o := NewOrder("o-1")
    fmt.Println("start:", o.Status())
    _ = o.Pay()
    fmt.Println("after pay:", o.Status())
    _ = o.Ship()
    fmt.Println("after ship:", o.Status())
    if err := o.Cancel(); err != nil {
        fmt.Println("cancel error:", err)
    }
}
```

</details>

---

### Task 4 (B) — Add a state

**Goal:** Take the order FSM from task 3 and add a `Refunded` state. Only a `Paid` or `Shipped` order can be refunded. A `Refunded` order accepts no further operations. The point of this exercise is to feel the difference between "edit four switch arms" and "add one struct and one row to the table".

**Starter:**

```go
package main

// import the iota constants, the state structs, the registry from task 3.
// TODO: add StatusRefunded
// TODO: add Refund() to OrderState interface
// TODO: add refundedState{} and wire it into orderStates
// TODO: implement Refund on every existing state
```

**Hints:**

- Adding a method to the interface forces every state to implement it — the compiler tells you which ones you forgot.
- The new state's methods all return "cannot do X to refunded order" errors.
- This is the moment where the State pattern earns its keep: one new file, four error returns, done. Compare against the equivalent in the original fat-switch form (touch every method).

<details><summary>Reference solution</summary>

```go
package main

import (
    "errors"
    "fmt"
)

type Status int

const (
    StatusPending Status = iota
    StatusPaid
    StatusShipped
    StatusCancelled
    StatusRefunded
)

func (s Status) String() string {
    return [...]string{"pending", "paid", "shipped", "cancelled", "refunded"}[s]
}

type OrderState interface {
    Pay(*Order) error
    Ship(*Order) error
    Cancel(*Order) error
    Refund(*Order) error
}

type Order struct {
    ID     string
    status Status
}

func NewOrder(id string) *Order { return &Order{ID: id, status: StatusPending} }
func (o *Order) Status() Status { return o.status }

func (o *Order) Pay() error    { return orderStates[o.status].Pay(o) }
func (o *Order) Ship() error   { return orderStates[o.status].Ship(o) }
func (o *Order) Cancel() error { return orderStates[o.status].Cancel(o) }
func (o *Order) Refund() error { return orderStates[o.status].Refund(o) }

type pendingState struct{}

func (pendingState) Pay(o *Order) error    { o.status = StatusPaid; return nil }
func (pendingState) Ship(*Order) error     { return errors.New("can't ship unpaid") }
func (pendingState) Cancel(o *Order) error { o.status = StatusCancelled; return nil }
func (pendingState) Refund(*Order) error   { return errors.New("nothing to refund") }

type paidState struct{}

func (paidState) Pay(*Order) error         { return errors.New("already paid") }
func (paidState) Ship(o *Order) error      { o.status = StatusShipped; return nil }
func (paidState) Cancel(o *Order) error    { o.status = StatusCancelled; return nil }
func (paidState) Refund(o *Order) error    { o.status = StatusRefunded; return nil }

type shippedState struct{}

func (shippedState) Pay(*Order) error      { return errors.New("already paid") }
func (shippedState) Ship(*Order) error     { return errors.New("already shipped") }
func (shippedState) Cancel(*Order) error   { return errors.New("can't cancel shipped") }
func (shippedState) Refund(o *Order) error { o.status = StatusRefunded; return nil }

type cancelledState struct{}

func (cancelledState) Pay(*Order) error    { return errors.New("cancelled") }
func (cancelledState) Ship(*Order) error   { return errors.New("cancelled") }
func (cancelledState) Cancel(*Order) error { return errors.New("already cancelled") }
func (cancelledState) Refund(*Order) error { return errors.New("nothing to refund") }

// The new state: terminal, rejects everything.
type refundedState struct{}

func (refundedState) Pay(*Order) error    { return errors.New("refunded") }
func (refundedState) Ship(*Order) error   { return errors.New("refunded") }
func (refundedState) Cancel(*Order) error { return errors.New("refunded") }
func (refundedState) Refund(*Order) error { return errors.New("already refunded") }

var orderStates = map[Status]OrderState{
    StatusPending:   pendingState{},
    StatusPaid:      paidState{},
    StatusShipped:   shippedState{},
    StatusCancelled: cancelledState{},
    StatusRefunded:  refundedState{},
}

func main() {
    o := NewOrder("o-1")
    _ = o.Pay()
    _ = o.Ship()
    _ = o.Refund()
    fmt.Println("final:", o.Status())
    if err := o.Refund(); err != nil {
        fmt.Println("expected error:", err)
    }
}
```

</details>

---

### Task 5 (I) — Enter/Exit hooks

**Goal:** Add `Enter(*Order)` and `Exit(*Order)` hooks to the state interface. When entering `Processing`, start a timer. When exiting `Processing`, stop the timer and record how long it ran. Hooks are the difference between a toy FSM and a production one — they are where you start/stop timers, open/close connections, and write audit rows.

**Starter:**

```go
package main

import "time"

type OrderState interface {
    Enter(*Order)
    Exit(*Order)
    Start(*Order) error  // pending -> processing
    Done(*Order) error   // processing -> completed
    Name() string
}

type Order struct {
    ID        string
    state     OrderState
    procStart time.Time
    procTotal time.Duration
}

// TODO: implement Pending, Processing, Completed
// TODO: (o *Order) transition(to OrderState) — runs Exit on current, sets new, runs Enter on new
```

**Hints:**

- The Context's `transition` method is the single place that calls `Exit(old)` and `Enter(new)`. States never call these themselves.
- `Processing.Enter` sets `o.procStart = time.Now()`. `Processing.Exit` adds `time.Since(o.procStart)` to `o.procTotal`.
- Most states have empty `Enter`/`Exit` — embed a `baseState struct{}` with no-op defaults if you want to avoid the boilerplate.

<details><summary>Reference solution</summary>

```go
package main

import (
    "errors"
    "fmt"
    "time"
)

type OrderState interface {
    Enter(*Order)
    Exit(*Order)
    Start(*Order) error
    Done(*Order) error
    Name() string
}

type Order struct {
    ID        string
    state     OrderState
    procStart time.Time
    procTotal time.Duration
}

func NewOrder(id string) *Order {
    o := &Order{ID: id}
    o.transition(Pending{})
    return o
}

// transition is the single chokepoint. Exit → swap → Enter. States never
// touch the state pointer themselves; that prevents the "swap-in-the-middle"
// foot-gun listed in junior.md §9.
func (o *Order) transition(next OrderState) {
    if o.state != nil {
        o.state.Exit(o)
    }
    o.state = next
    o.state.Enter(o)
}

func (o *Order) Start() error { return o.state.Start(o) }
func (o *Order) Done() error  { return o.state.Done(o) }
func (o *Order) State() string { return o.state.Name() }

// baseState is a no-op default so individual states only override what
// they care about. Saves four lines per state.
type baseState struct{}

func (baseState) Enter(*Order)       {}
func (baseState) Exit(*Order)        {}
func (baseState) Start(*Order) error { return errors.New("can't start in this state") }
func (baseState) Done(*Order) error  { return errors.New("can't complete in this state") }

type Pending struct{ baseState }

func (Pending) Name() string             { return "pending" }
func (Pending) Start(o *Order) error     { o.transition(Processing{}); return nil }

type Processing struct{ baseState }

func (Processing) Name() string { return "processing" }
func (Processing) Enter(o *Order) {
    o.procStart = time.Now()
    fmt.Println("processing: timer started")
}
func (Processing) Exit(o *Order) {
    o.procTotal += time.Since(o.procStart)
    fmt.Printf("processing: timer stopped, total=%v\n", o.procTotal)
}
func (Processing) Done(o *Order) error { o.transition(Completed{}); return nil }

type Completed struct{ baseState }

func (Completed) Name() string { return "completed" }

func main() {
    o := NewOrder("o-1")
    fmt.Println("state:", o.State())
    _ = o.Start()
    time.Sleep(25 * time.Millisecond)
    _ = o.Done()
    fmt.Println("final state:", o.State(), "procTotal:", o.procTotal)
}
```

</details>

---

### Task 6 (I) — State-function lexer

**Goal:** Build a tiny state-function lexer for a CSV row that handles quoted fields. `lexField` and `lexQuoted` are state *functions*; each returns the next one or `nil` to stop. This is the Rob Pike form from middle.md §3.

**Starter:**

```go
package main

type stateFn func(*lexer) stateFn

type lexer struct {
    input  string
    pos    int
    fields []string
    buf    []byte
}

// TODO: lexField — reads until ',' or end; on '"' it switches to lexQuoted
// TODO: lexQuoted — reads until matching '"' (handling "" as an escape); then back to lexField
// TODO: (l *lexer) run() — loops until state == nil
```

**Hints:**

- Each `stateFn` does exactly one job: read one field, or read one quoted body.
- When `lexQuoted` sees `""` inside a quoted field, append one `"` to the buffer and keep going. Standard CSV escape rule.
- The end of input is the signal to flush the buffer and return `nil`.
- The state machine has no `switch`. The "current state" is which function pointer you are about to call.

<details><summary>Reference solution</summary>

```go
package main

import "fmt"

type stateFn func(*lexer) stateFn

type lexer struct {
    input  string
    pos    int
    fields []string
    buf    []byte
}

func newLexer(s string) *lexer { return &lexer{input: s} }

func (l *lexer) run() {
    // Senior decision: state is a function pointer, not an enum. No
    // interface dispatch, no allocation per transition. This is why the
    // stdlib lexer (text/template/parse/lex.go) is shaped like this.
    for state := lexField; state != nil; {
        state = state(l)
    }
}

func (l *lexer) flushField() {
    l.fields = append(l.fields, string(l.buf))
    l.buf = l.buf[:0]
}

func lexField(l *lexer) stateFn {
    for {
        if l.pos >= len(l.input) {
            l.flushField()
            return nil
        }
        c := l.input[l.pos]
        switch c {
        case ',':
            l.pos++
            l.flushField()
            // stay in lexField for the next field
            return lexField
        case '"':
            // Only allowed at the start of a field.
            if len(l.buf) != 0 {
                l.buf = append(l.buf, c)
                l.pos++
                continue
            }
            l.pos++
            return lexQuoted
        default:
            l.buf = append(l.buf, c)
            l.pos++
        }
    }
}

func lexQuoted(l *lexer) stateFn {
    for {
        if l.pos >= len(l.input) {
            // Unterminated quote: in production, surface an error.
            l.flushField()
            return nil
        }
        c := l.input[l.pos]
        if c == '"' {
            // Possible escape: "" inside a quoted field becomes a single ".
            if l.pos+1 < len(l.input) && l.input[l.pos+1] == '"' {
                l.buf = append(l.buf, '"')
                l.pos += 2
                continue
            }
            l.pos++ // consume closing quote
            return lexField
        }
        l.buf = append(l.buf, c)
        l.pos++
    }
}

func main() {
    cases := []string{
        `a,b,c`,
        `"hello, world",foo,bar`,
        `"she said ""hi""",done`,
        ``,
    }
    for _, in := range cases {
        l := newLexer(in)
        l.run()
        fmt.Printf("%-30q -> %q\n", in, l.fields)
    }
}
```

</details>

---

### Task 7 (I) — Table-driven FSM

**Goal:** Encode the order workflow as a slice of `Transition{from, event, to, action}` rows. The machine's `Send(event)` walks the table. This is the form `looplab/fsm` and `qmuntal/stateless` give you, and it's what middle.md §4 calls "data, not code".

**Starter:**

```go
package main

import "fmt"

type Transition struct {
    From, Event, To string
    Action          func(*Machine) error
}

type Machine struct {
    state string
    table []Transition
}

// TODO: NewMachine(initial string, table []Transition)
// TODO: (m *Machine) Send(event string) error — find matching row, run Action, swap state
// TODO: define orderFSM = []Transition{ ... } covering pending/paid/shipped/cancelled/refunded
```

**Hints:**

- A row matches when `from == m.state && event == passed-event`. If none matches, return a typed error.
- The action runs *before* the state swap; if it errors, do not swap. (See middle.md §6 — pick one semantics and document it.)
- Bonus: write a validator that returns the list of unreachable states by walking the table.

<details><summary>Reference solution</summary>

```go
package main

import (
    "errors"
    "fmt"
)

type Transition struct {
    From, Event, To string
    Action          func(*Machine) error // nil = no side effect
}

type Machine struct {
    state string
    table []Transition
}

func NewMachine(initial string, table []Transition) *Machine {
    return &Machine{state: initial, table: table}
}

func (m *Machine) State() string { return m.state }

// ErrInvalid is returned when no row matches (state, event). Typed so
// callers can distinguish "wrong event" from "action failed".
var ErrInvalid = errors.New("invalid transition")

func (m *Machine) Send(event string) error {
    for _, t := range m.table {
        if t.From != m.state || t.Event != event {
            continue
        }
        // Senior decision: run Action FIRST. If it fails, do not swap.
        // The FSM stays in From. Document this; the alternative (swap then
        // act) requires compensation logic on Action failure.
        if t.Action != nil {
            if err := t.Action(m); err != nil {
                return fmt.Errorf("action %s->%s: %w", t.From, t.To, err)
            }
        }
        m.state = t.To
        return nil
    }
    return fmt.Errorf("%w: %s on %s", ErrInvalid, event, m.state)
}

// UnreachableStates returns states that appear in `to` columns but no
// `from` columns lead to them. Useful in CI to catch dead transitions.
func UnreachableStates(initial string, table []Transition) []string {
    reachable := map[string]bool{initial: true}
    changed := true
    for changed {
        changed = false
        for _, t := range table {
            if reachable[t.From] && !reachable[t.To] {
                reachable[t.To] = true
                changed = true
            }
        }
    }
    seen := map[string]bool{}
    for _, t := range table {
        seen[t.From] = true
        seen[t.To] = true
    }
    var dead []string
    for s := range seen {
        if !reachable[s] {
            dead = append(dead, s)
        }
    }
    return dead
}

func logAction(label string) func(*Machine) error {
    return func(m *Machine) error {
        fmt.Printf("[action] %s (state=%s)\n", label, m.state)
        return nil
    }
}

var orderFSM = []Transition{
    {"pending", "pay", "paid", logAction("charge card")},
    {"pending", "cancel", "cancelled", nil},
    {"paid", "ship", "shipped", logAction("notify warehouse")},
    {"paid", "cancel", "cancelled", logAction("issue refund")},
    {"paid", "refund", "refunded", logAction("issue refund")},
    {"shipped", "refund", "refunded", logAction("issue refund")},
}

func main() {
    m := NewMachine("pending", orderFSM)
    for _, ev := range []string{"pay", "ship", "refund", "pay"} {
        if err := m.Send(ev); err != nil {
            fmt.Println("err:", err)
            continue
        }
        fmt.Println("state:", m.State())
    }
    fmt.Println("unreachable:", UnreachableStates("pending", orderFSM))
}
```

</details>

---

### Task 8 (I) — Guards and actions

**Goal:** Extend task 7's table with a `Guard` field: a predicate the FSM must run before any state change. Add a rule: "you may only Pay an order whose Amount > 0". Add an Action that "charges the card" and may itself fail. Show that a Guard rejection and an Action failure produce different, distinguishable errors.

**Starter:**

```go
package main

type Transition struct {
    From, Event, To string
    Guard           func(*Order) error
    Action          func(*Order) error
}

type Order struct {
    state  string
    Amount int
    Paid   bool
}

// TODO: Send(event) — check Guard first, then Action, then swap
// TODO: errors: ErrGuard, ErrAction so callers can errors.Is them
// TODO: a "pay" transition guarded by Amount > 0 and acting via fakeCharge
```

**Hints:**

- Use sentinel errors (`var ErrGuard = errors.New("guard")`, `var ErrAction = errors.New("action")`) and wrap with `%w` so callers can `errors.Is`.
- The order: Guard → Action → state swap. Each layer can fail and short-circuit.
- A passing test: `Amount=0` returns `ErrGuard`; the action stub returning a flaky error returns `ErrAction`; both leave the state untouched.

<details><summary>Reference solution</summary>

```go
package main

import (
    "errors"
    "fmt"
)

var (
    ErrGuard   = errors.New("guard failed")
    ErrAction  = errors.New("action failed")
    ErrInvalid = errors.New("invalid transition")
)

type Order struct {
    state  string
    Amount int
    Paid   bool
}

type Transition struct {
    From, Event, To string
    Guard           func(*Order) error
    Action          func(*Order) error
}

type Machine struct {
    o     *Order
    table []Transition
}

func NewMachine(o *Order, table []Transition) *Machine {
    return &Machine{o: o, table: table}
}

func (m *Machine) State() string { return m.o.state }

func (m *Machine) Send(event string) error {
    for _, t := range m.table {
        if t.From != m.o.state || t.Event != event {
            continue
        }
        if t.Guard != nil {
            if err := t.Guard(m.o); err != nil {
                // Wrapped so errors.Is(err, ErrGuard) works.
                return fmt.Errorf("%w: %v", ErrGuard, err)
            }
        }
        if t.Action != nil {
            if err := t.Action(m.o); err != nil {
                return fmt.Errorf("%w: %v", ErrAction, err)
            }
        }
        m.o.state = t.To
        return nil
    }
    return fmt.Errorf("%w: %s on %s", ErrInvalid, event, m.o.state)
}

// Fake credit-card charge. In real life this is an HTTP call.
// We make it fail when Amount > 10_000 to demonstrate the Action branch.
func fakeCharge(o *Order) error {
    if o.Amount > 10_000 {
        return errors.New("card declined")
    }
    o.Paid = true
    return nil
}

func mustHavePositiveAmount(o *Order) error {
    if o.Amount <= 0 {
        return fmt.Errorf("amount must be > 0, got %d", o.Amount)
    }
    return nil
}

var orderFSM = []Transition{
    {"pending", "pay", "paid", mustHavePositiveAmount, fakeCharge},
    {"paid", "ship", "shipped", nil, nil},
}

func main() {
    // Case 1: guard fails (amount = 0).
    o1 := &Order{state: "pending", Amount: 0}
    m1 := NewMachine(o1, orderFSM)
    err := m1.Send("pay")
    fmt.Println("amount=0:", err, "is-guard:", errors.Is(err, ErrGuard))
    fmt.Println("state unchanged:", o1.state)

    // Case 2: action fails (amount too large).
    o2 := &Order{state: "pending", Amount: 100_000}
    m2 := NewMachine(o2, orderFSM)
    err = m2.Send("pay")
    fmt.Println("amount huge:", err, "is-action:", errors.Is(err, ErrAction))
    fmt.Println("state unchanged:", o2.state)

    // Case 3: happy path.
    o3 := &Order{state: "pending", Amount: 500}
    m3 := NewMachine(o3, orderFSM)
    if err := m3.Send("pay"); err != nil {
        fmt.Println("unexpected:", err)
    }
    fmt.Println("happy path state:", o3.state, "paid:", o3.Paid)
}
```

</details>

---

### Task 9 (I) — Concurrency: channel-fed FSM

**Goal:** Run the order FSM in a single owner goroutine. Events arrive on a channel; results are returned on a per-event reply channel. There is no mutex, no race on the state field. This is the form middle.md §8 calls "the most idiomatic Go approach".

**Starter:**

```go
package main

import "context"

type Event struct {
    Name  string
    Reply chan error
}

type Machine struct {
    state  string
    events chan Event
}

// TODO: NewMachine(initial) *Machine; spawn one goroutine in NewMachine
// TODO: (m *Machine) Send(ctx, name) error — sends an Event, waits on Reply
// TODO: the goroutine: for ev := range m.events { handle; ev.Reply <- err }
```

**Hints:**

- The goroutine *owns* the state field. No other goroutine reads or writes it directly.
- `Send` is blocking — it waits for the goroutine to reply. This serialises callers naturally.
- `Reply` channels must be buffered (size 1) or the goroutine deadlocks if the caller cancels mid-wait. Pick one; document it.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "sync"
)

type Event struct {
    Name  string
    Reply chan error
}

type Machine struct {
    state  string
    events chan Event
    done   chan struct{}
    wg     sync.WaitGroup
}

func NewMachine(initial string) *Machine {
    m := &Machine{
        state:  initial,
        events: make(chan Event), // unbounded would defeat backpressure
        done:   make(chan struct{}),
    }
    m.wg.Add(1)
    go m.loop()
    return m
}

// Senior decision: only this goroutine touches m.state. No locks, no
// happens-before puzzle. Callers ask via channel; the loop replies.
func (m *Machine) loop() {
    defer m.wg.Done()
    for {
        select {
        case <-m.done:
            return
        case ev := <-m.events:
            ev.Reply <- m.apply(ev.Name)
        }
    }
}

var ErrInvalid = errors.New("invalid transition")

func (m *Machine) apply(event string) error {
    switch m.state {
    case "pending":
        if event == "pay" {
            m.state = "paid"
            return nil
        }
    case "paid":
        if event == "ship" {
            m.state = "shipped"
            return nil
        }
    }
    return fmt.Errorf("%w: %s on %s", ErrInvalid, event, m.state)
}

// Send blocks until the loop processes the event or ctx is cancelled.
// Reply channel has capacity 1 so the loop can always send without
// blocking, even if the caller has given up.
func (m *Machine) Send(ctx context.Context, name string) error {
    ev := Event{Name: name, Reply: make(chan error, 1)}
    select {
    case <-ctx.Done():
        return ctx.Err()
    case m.events <- ev:
    }
    select {
    case <-ctx.Done():
        return ctx.Err()
    case err := <-ev.Reply:
        return err
    }
}

func (m *Machine) Close() {
    close(m.done)
    m.wg.Wait()
}

func main() {
    m := NewMachine("pending")
    defer m.Close()
    ctx := context.Background()

    var wg sync.WaitGroup
    // Fire 5 concurrent "pay" requests; exactly one should succeed.
    for i := 0; i < 5; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            err := m.Send(ctx, "pay")
            fmt.Printf("caller %d: %v\n", i, err)
        }()
    }
    wg.Wait()

    if err := m.Send(ctx, "ship"); err != nil {
        fmt.Println("ship:", err)
    }
}
```

</details>

---

### Task 10 (A) — Persistence

**Goal:** Store the state name (not the state object) in SQLite. On load, reconstitute the FSM by looking up the state in the registry. This is the form every long-running workflow uses — Temporal, Cadence, support tickets, subscription billing.

**Starter:**

```go
package main

import "database/sql"

// CREATE TABLE orders (id TEXT PRIMARY KEY, status TEXT NOT NULL, amount INT, updated_at INT);

type Order struct {
    ID        string
    Status    string
    Amount    int
    UpdatedAt int64
}

// TODO: Save(db *sql.DB, o *Order) error
// TODO: Load(db *sql.DB, id string) (*Machine, error)
// TODO: Machine.Send(event) — apply transition, save before returning
```

**Hints:**

- Use `modernc.org/sqlite` for a pure-Go SQLite driver (no cgo). Or stick with `mattn/go-sqlite3` if you have a working C toolchain. The code below uses the standard `database/sql` interface and an in-memory map to keep the example self-contained.
- Save *after* the in-memory state changes, not before. If the save fails, the in-memory FSM is now out of sync with the row — pick one strategy: rollback, log, crash. (Production: usually rollback by reloading from DB.)
- Storing the state *name* (a string) means you can deploy a new binary with renamed Go types without breaking existing rows.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "sync"
    "time"
)

// In-memory stand-in for a SQL row. The real implementation would be:
//   var status string
//   db.QueryRow("SELECT status FROM orders WHERE id=?", id).Scan(&status)
type Storage struct {
    mu   sync.Mutex
    rows map[string]Order
}

func NewStorage() *Storage { return &Storage{rows: map[string]Order{}} }

func (s *Storage) Save(_ context.Context, o Order) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    o.UpdatedAt = time.Now().Unix()
    s.rows[o.ID] = o
    return nil
}

func (s *Storage) Get(_ context.Context, id string) (Order, error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    o, ok := s.rows[id]
    if !ok {
        return Order{}, errors.New("not found")
    }
    return o, nil
}

// --- Order + Machine ---

type Order struct {
    ID        string
    Status    string
    Amount    int
    UpdatedAt int64
}

type Machine struct {
    order Order
    store *Storage
}

// Senior decision: do NOT store the state object — store the name. On
// load, the registry maps name -> behavior. This survives binary renames,
// schema migrations, and even rewrites in a different language.
var transitions = map[string]map[string]string{
    "pending":   {"pay": "paid", "cancel": "cancelled"},
    "paid":      {"ship": "shipped", "refund": "refunded"},
    "shipped":   {"refund": "refunded"},
    "cancelled": {},
    "refunded":  {},
}

func Load(ctx context.Context, store *Storage, id string) (*Machine, error) {
    o, err := store.Get(ctx, id)
    if err != nil {
        return nil, err
    }
    if _, ok := transitions[o.Status]; !ok {
        // The DB has a status string we don't know — could be a newer
        // binary's data, could be corruption. Refuse to operate on it.
        return nil, fmt.Errorf("unknown status %q in storage", o.Status)
    }
    return &Machine{order: o, store: store}, nil
}

func Create(ctx context.Context, store *Storage, id string, amount int) (*Machine, error) {
    o := Order{ID: id, Status: "pending", Amount: amount}
    if err := store.Save(ctx, o); err != nil {
        return nil, err
    }
    return &Machine{order: o, store: store}, nil
}

func (m *Machine) Send(ctx context.Context, event string) error {
    next, ok := transitions[m.order.Status][event]
    if !ok {
        return fmt.Errorf("invalid event %q on %s", event, m.order.Status)
    }
    prev := m.order.Status
    m.order.Status = next
    if err := m.store.Save(ctx, m.order); err != nil {
        // Roll back the in-memory change — the row is authoritative.
        m.order.Status = prev
        return fmt.Errorf("save: %w", err)
    }
    return nil
}

func (m *Machine) State() string { return m.order.Status }

func main() {
    ctx := context.Background()
    store := NewStorage()

    m, err := Create(ctx, store, "o-1", 500)
    if err != nil {
        panic(err)
    }
    _ = m.Send(ctx, "pay")
    _ = m.Send(ctx, "ship")

    // Simulate process restart: reload from "DB", continue.
    m2, err := Load(ctx, store, "o-1")
    if err != nil {
        panic(err)
    }
    fmt.Println("after reload:", m2.State())
    _ = m2.Send(ctx, "refund")
    fmt.Println("after refund:", m2.State())
}
```

</details>

---

### Task 11 (A) — Generic FSM

**Goal:** Define `type Machine[S, E comparable] struct { ... }` parameterised on state type `S` and event type `E`. The transition table is `map[S]map[E]S`. The state and event types stay yours — strings, ints, custom enums — without the FSM caring. This is what `qmuntal/stateless` does, in 40 lines.

**Starter:**

```go
package main

type Machine[S, E comparable] struct {
    state  S
    table  map[S]map[E]S
    onExit map[S]func()
    onEnter map[S]func()
}

// TODO: NewMachine[S, E comparable](initial S) *Machine[S, E]
// TODO: AddTransition(from S, event E, to S)
// TODO: Send(event E) error
// TODO: OnEnter(state S, fn func()), OnExit(state S, fn func())
```

**Hints:**

- The `comparable` constraint is required because `S` and `E` are map keys.
- The constructor builds empty inner maps so `AddTransition` can append without nil-checking.
- `Send` calls the outgoing state's `OnExit`, swaps, then calls the incoming state's `OnEnter`.

<details><summary>Reference solution</summary>

```go
package main

import (
    "errors"
    "fmt"
)

type Machine[S, E comparable] struct {
    state   S
    table   map[S]map[E]S
    onEnter map[S]func(S)
    onExit  map[S]func(S)
}

func NewMachine[S, E comparable](initial S) *Machine[S, E] {
    return &Machine[S, E]{
        state:   initial,
        table:   map[S]map[E]S{},
        onEnter: map[S]func(S){},
        onExit:  map[S]func(S){},
    }
}

func (m *Machine[S, E]) State() S { return m.state }

func (m *Machine[S, E]) AddTransition(from S, event E, to S) {
    inner, ok := m.table[from]
    if !ok {
        inner = map[E]S{}
        m.table[from] = inner
    }
    inner[event] = to
}

func (m *Machine[S, E]) OnEnter(s S, fn func(prev S)) { m.onEnter[s] = fn }
func (m *Machine[S, E]) OnExit(s S, fn func(next S))  { m.onExit[s] = fn }

var ErrInvalid = errors.New("invalid transition")

func (m *Machine[S, E]) Send(event E) error {
    next, ok := m.table[m.state][event]
    if !ok {
        return fmt.Errorf("%w: %v on %v", ErrInvalid, event, m.state)
    }
    prev := m.state
    if fn, ok := m.onExit[prev]; ok {
        fn(next)
    }
    m.state = next
    if fn, ok := m.onEnter[next]; ok {
        fn(prev)
    }
    return nil
}

// --- demo: order workflow as int-based states/events ---

type OrderState int

const (
    Pending OrderState = iota
    Paid
    Shipped
    Cancelled
    Refunded
)

func (s OrderState) String() string {
    return [...]string{"pending", "paid", "shipped", "cancelled", "refunded"}[s]
}

type OrderEvent int

const (
    Pay OrderEvent = iota
    Ship
    Cancel
    Refund
)

func (e OrderEvent) String() string {
    return [...]string{"pay", "ship", "cancel", "refund"}[e]
}

func main() {
    m := NewMachine[OrderState, OrderEvent](Pending)
    m.AddTransition(Pending, Pay, Paid)
    m.AddTransition(Pending, Cancel, Cancelled)
    m.AddTransition(Paid, Ship, Shipped)
    m.AddTransition(Paid, Refund, Refunded)
    m.AddTransition(Shipped, Refund, Refunded)

    m.OnEnter(Paid, func(prev OrderState) {
        fmt.Printf("[enter] paid (from %s)\n", prev)
    })
    m.OnExit(Paid, func(next OrderState) {
        fmt.Printf("[exit]  paid (to %s)\n", next)
    })

    for _, e := range []OrderEvent{Pay, Ship, Refund} {
        if err := m.Send(e); err != nil {
            fmt.Println("err:", err)
            continue
        }
        fmt.Println("state:", m.State())
    }

    if err := m.Send(Pay); err != nil {
        fmt.Println("expected:", err)
    }
}
```

</details>

---

### Task 12 (A) — Event sourcing

**Goal:** Store a sequence of events (`OrderCreated`, `OrderPaid`, `OrderShipped`, ...) instead of a current-status row. The current state is the result of replaying all events. This is what Kafka-backed systems and CQRS designs do — and it is the underlying model of Temporal, Datomic, EventStore.

**Starter:**

```go
package main

type Event interface{ Apply(*Order) }
type Order struct {
    ID     string
    Status string
    Amount int
}

type OrderCreated struct{ ID string; Amount int }
type OrderPaid struct{}
type OrderShipped struct{}

// TODO: Apply on each event mutates Order
// TODO: Replay(events []Event) *Order
// TODO: Command-style: Pay(o *Order) ([]Event, error) — returns new events without mutating
```

**Hints:**

- `Apply` is total — it always mutates. Validation happens earlier, in the command layer.
- Command functions return *new events* and an error; the caller appends events to the log and replays.
- The hardest senior idea here: keep the state machine pure. Mutating the in-memory order *and* appending an event must be one indivisible step, or replays will diverge.

<details><summary>Reference solution</summary>

```go
package main

import (
    "errors"
    "fmt"
)

type Order struct {
    ID     string
    Status string
    Amount int
}

// Event is something that already happened. Past tense.
type Event interface {
    Apply(*Order)
}

type OrderCreated struct {
    ID     string
    Amount int
}

func (e OrderCreated) Apply(o *Order) {
    o.ID = e.ID
    o.Amount = e.Amount
    o.Status = "pending"
}

type OrderPaid struct{}

func (OrderPaid) Apply(o *Order) { o.Status = "paid" }

type OrderShipped struct{}

func (OrderShipped) Apply(o *Order) { o.Status = "shipped" }

type OrderRefunded struct{}

func (OrderRefunded) Apply(o *Order) { o.Status = "refunded" }

// Replay rebuilds the current Order by folding events left-to-right.
// This is the *only* way to construct an Order in this design — there
// is no setter for Status, only the events.
func Replay(events []Event) *Order {
    o := &Order{}
    for _, e := range events {
        e.Apply(o)
    }
    return o
}

// --- command layer: validates current state, returns new events ---

func Pay(o *Order) ([]Event, error) {
    if o.Status != "pending" {
        return nil, fmt.Errorf("can't pay in %s", o.Status)
    }
    if o.Amount <= 0 {
        return nil, errors.New("amount must be > 0")
    }
    // Senior decision: commands return events; they do NOT call Apply
    // themselves. The event log is the single source of truth — the
    // command writes to it, and replay reconstructs state from it.
    return []Event{OrderPaid{}}, nil
}

func Ship(o *Order) ([]Event, error) {
    if o.Status != "paid" {
        return nil, fmt.Errorf("can't ship in %s", o.Status)
    }
    return []Event{OrderShipped{}}, nil
}

func Refund(o *Order) ([]Event, error) {
    switch o.Status {
    case "paid", "shipped":
        return []Event{OrderRefunded{}}, nil
    }
    return nil, fmt.Errorf("can't refund in %s", o.Status)
}

// Aggregate keeps the event log and the materialised view.
type Aggregate struct {
    log []Event
}

func NewAggregate(events ...Event) *Aggregate {
    return &Aggregate{log: events}
}

func (a *Aggregate) View() *Order { return Replay(a.log) }

func (a *Aggregate) Do(cmd func(*Order) ([]Event, error)) error {
    o := a.View()
    newEvents, err := cmd(o)
    if err != nil {
        return err
    }
    a.log = append(a.log, newEvents...)
    return nil
}

func main() {
    a := NewAggregate(OrderCreated{ID: "o-1", Amount: 500})
    if err := a.Do(Pay); err != nil {
        fmt.Println(err)
    }
    if err := a.Do(Ship); err != nil {
        fmt.Println(err)
    }
    fmt.Printf("after ship: %+v\n", a.View())

    if err := a.Do(Refund); err != nil {
        fmt.Println(err)
    }
    fmt.Printf("after refund: %+v\n", a.View())

    // Audit trail — for free, as a consequence of the design.
    fmt.Println("event log:")
    for i, e := range a.log {
        fmt.Printf("  %d. %T %+v\n", i, e, e)
    }
}
```

</details>

---

### Task 13 (A) — Hierarchical FSM

**Goal:** Define a "Connected" super-state that contains "Idle" and "Streaming" sub-states. From any sub-state of Connected, a `Disconnect` event must drop to "Disconnected". The point: model the type tree so that a sub-state inherits behavior from its parent (Go has no inheritance — you use embedding).

**Starter:**

```go
package main

// Sub-states share methods via embedding.
// type connectedState struct{}
// type Idle struct{ connectedState }
// type Streaming struct{ connectedState }
// type Disconnected struct{}

// TODO: a State interface with Send(event string) State
// TODO: connectedState handles Disconnect uniformly for all sub-states
// TODO: Idle.Send("start") -> Streaming; Streaming.Send("stop") -> Idle
```

**Hints:**

- Go's embedding is your "inheritance": embed `connectedState` in `Idle` and `Streaming`, and `Disconnect` handled in `connectedState` is inherited by both.
- The sub-states override behavior they need (`Idle.Send` returns `Streaming`); they let the parent handle the rest.
- This is closer in spirit to UML statecharts than to flat FSMs. Use it when several states share a chunk of behavior.

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
)

// State is what every node in the hierarchy implements.
type State interface {
    Send(event string) State
    Name() string
}

// connectedState is the SUPER-state. It implements Disconnect once,
// and Idle/Streaming inherit it through embedding. Go has no class
// inheritance; this is the closest equivalent.
type connectedState struct{}

func (connectedState) Send(event string) State {
    if event == "disconnect" {
        fmt.Println("[connected] dropping to disconnected")
        return Disconnected{}
    }
    // Unknown event in this super-state's scope: caller must override.
    return nil
}

func (connectedState) Name() string { return "connected" }

// Idle: a sub-state of Connected. Has its own start->Streaming behavior;
// falls through to connectedState for "disconnect".
type Idle struct {
    connectedState
}

func (i Idle) Name() string { return "connected.idle" }

func (i Idle) Send(event string) State {
    if event == "start" {
        fmt.Println("[idle] starting stream")
        return Streaming{}
    }
    // Senior decision: delegate to the embedded super-state for events
    // it knows how to handle. If neither level handles the event, the
    // call returns nil and the machine surfaces an error.
    return i.connectedState.Send(event)
}

type Streaming struct {
    connectedState
}

func (s Streaming) Name() string { return "connected.streaming" }

func (s Streaming) Send(event string) State {
    switch event {
    case "stop":
        fmt.Println("[streaming] stopping")
        return Idle{}
    case "tick":
        fmt.Println("[streaming] frame produced")
        return s // self-loop
    }
    return s.connectedState.Send(event)
}

type Disconnected struct{}

func (Disconnected) Name() string { return "disconnected" }
func (Disconnected) Send(event string) State {
    if event == "connect" {
        fmt.Println("[disconnected] connecting -> idle")
        return Idle{}
    }
    return nil
}

// Machine drives transitions; logs invalid events but does not panic.
type Machine struct {
    state State
}

func NewMachine() *Machine { return &Machine{state: Disconnected{}} }

func (m *Machine) Send(event string) {
    next := m.state.Send(event)
    if next == nil {
        fmt.Printf("[machine] invalid event %q in %s\n", event, m.state.Name())
        return
    }
    if next.Name() != m.state.Name() {
        fmt.Printf("[machine] %s -> %s\n", m.state.Name(), next.Name())
    }
    m.state = next
}

func main() {
    m := NewMachine()
    for _, ev := range []string{
        "connect", "start", "tick", "tick",
        "disconnect",      // handled by super-state
        "tick",            // invalid in disconnected
        "connect", "start", "stop",
    } {
        m.Send(ev)
    }
}
```

</details>

---

### Task 14 (A) — Stuck-detection

**Goal:** Add a background loop that scans the FSM every minute and logs a warning if any order has stayed in `Pending` for more than 5 minutes. This is the simplest "workflow visibility" feature, and the foundation of every "your job has been queued for ages" alert in production.

**Starter:**

```go
package main

import (
    "context"
    "sync"
    "time"
)

type Order struct {
    ID            string
    Status        string
    StatusSince   time.Time
}

type Tracker struct {
    mu     sync.Mutex
    orders map[string]*Order
}

// TODO: (t *Tracker) Add(o *Order)
// TODO: (t *Tracker) Set(id string, status string) — updates Status + StatusSince
// TODO: (t *Tracker) Watch(ctx, threshold, interval) — background loop
```

**Hints:**

- Hold the mutex *only* while scanning the map; release it before logging so a slow logger does not block updates.
- Use a `time.Ticker` for the loop; respect `ctx.Done()` so callers can stop the watcher cleanly.
- Use `slog` and include the order ID, the stuck-in status, the duration, and a stable event name (`"order_stuck"`) so dashboards can pivot on it.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "fmt"
    "log/slog"
    "os"
    "sync"
    "time"
)

type Order struct {
    ID          string
    Status      string
    StatusSince time.Time
}

type Tracker struct {
    mu     sync.Mutex
    orders map[string]*Order
    log    *slog.Logger
}

func NewTracker() *Tracker {
    return &Tracker{
        orders: map[string]*Order{},
        log:    slog.New(slog.NewTextHandler(os.Stdout, nil)),
    }
}

func (t *Tracker) Add(o *Order) {
    t.mu.Lock()
    defer t.mu.Unlock()
    o.StatusSince = time.Now()
    t.orders[o.ID] = o
}

func (t *Tracker) Set(id, status string) {
    t.mu.Lock()
    defer t.mu.Unlock()
    if o, ok := t.orders[id]; ok {
        o.Status = status
        o.StatusSince = time.Now()
    }
}

// snapshot returns IDs and timestamps under lock. The caller then logs
// without holding the lock. This is the standard "release lock before
// I/O" pattern.
func (t *Tracker) snapshot(threshold time.Duration) []stuck {
    t.mu.Lock()
    defer t.mu.Unlock()
    now := time.Now()
    var out []stuck
    for _, o := range t.orders {
        if o.Status == "pending" && now.Sub(o.StatusSince) > threshold {
            out = append(out, stuck{id: o.ID, since: o.StatusSince})
        }
    }
    return out
}

type stuck struct {
    id    string
    since time.Time
}

// Watch runs until ctx is cancelled. Senior decision: a single ticker
// goroutine, not one per order. O(N) per tick is acceptable for tens of
// thousands of orders; beyond that, switch to a priority queue keyed on
// StatusSince.
func (t *Tracker) Watch(ctx context.Context, threshold, interval time.Duration) {
    tk := time.NewTicker(interval)
    defer tk.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-tk.C:
            for _, s := range t.snapshot(threshold) {
                t.log.Warn("order_stuck",
                    "id", s.id,
                    "stuck_for", now.Sub(s.since).String(),
                    "threshold", threshold.String())
            }
        }
    }
}

func main() {
    tr := NewTracker()
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    // Pretend "5 minutes" is 50ms for the demo.
    threshold := 50 * time.Millisecond
    go tr.Watch(ctx, threshold, 20*time.Millisecond)

    tr.Add(&Order{ID: "o-1", Status: "pending"})
    tr.Add(&Order{ID: "o-2", Status: "pending"})
    tr.Add(&Order{ID: "o-3", Status: "paid"})

    time.Sleep(75 * time.Millisecond) // o-1 and o-2 should be flagged
    tr.Set("o-1", "paid")              // o-1 is now unstuck
    time.Sleep(75 * time.Millisecond) // o-2 still flagged, o-1 quiet

    cancel()
    time.Sleep(20 * time.Millisecond) // let the goroutine exit cleanly
    fmt.Println("done")
}
```

</details>

---

### Task 15 (S) — Mini Temporal-lite

**Goal:** Combine the previous pieces into a small but production-shaped durable workflow runtime. Append-only event log, replay to current state, scheduled timer events, retries with backoff for failing step actions, structured observability, and graceful shutdown. The result is a 250-line subset of what Temporal/Cadence provide.

**Starter:**

```go
package main

// type Workflow struct {
//     ID    string
//     Steps []Step       // ordered: each has Name, Action(ctx) error
//     Log   []Event
// }
//
// type Event interface{ apply(*Workflow) }
// type StepCompleted struct{ Name string }
// type StepFailed struct{ Name string; Err string; At time.Time }
// type TimerFired struct{ Name string; At time.Time }
//
// // Runtime: spin a goroutine per workflow that:
// //   1. replays Log to find current step
// //   2. runs the action with per-step retry/backoff
// //   3. appends events to Log atomically
// //   4. emits structured logs
```

**Hints:**

- Replay should be deterministic: given a Log, you always reach the same current step. No clocks inside `apply`.
- Persistence: an in-process map of `WorkflowID -> []Event` is fine for the exercise. The real shape is "append to DB, then act".
- The retry loop is per-step. After max attempts, append `StepFailed` and stop the workflow (or jump to a compensation chain — choose one).
- Timer events come from `time.AfterFunc(d, func() { runtime.Submit(TimerFired{...}) })`. The runtime queues them like any other event.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "log/slog"
    "os"
    "sync"
    "time"
)

// --- events: the durable log ---

type Event interface {
    apply(*workflowState)
    String() string
}

type WorkflowStarted struct {
    ID string
    At time.Time
}

func (e WorkflowStarted) apply(s *workflowState) {
    s.id = e.ID
    s.startedAt = e.At
    s.step = 0
}
func (e WorkflowStarted) String() string {
    return fmt.Sprintf("WorkflowStarted(id=%s)", e.ID)
}

type StepCompleted struct {
    Name string
    At   time.Time
}

func (e StepCompleted) apply(s *workflowState) {
    s.step++
    s.lastCompleted = e.Name
}
func (e StepCompleted) String() string { return fmt.Sprintf("StepCompleted(%s)", e.Name) }

type StepFailed struct {
    Name string
    Err  string
    At   time.Time
}

func (e StepFailed) apply(s *workflowState) {
    s.failed = true
    s.failedAt = e.Name
    s.failErr = e.Err
}
func (e StepFailed) String() string { return fmt.Sprintf("StepFailed(%s: %s)", e.Name, e.Err) }

type TimerFired struct {
    Name string
    At   time.Time
}

func (e TimerFired) apply(s *workflowState) { s.timers = append(s.timers, e.Name) }
func (e TimerFired) String() string         { return fmt.Sprintf("TimerFired(%s)", e.Name) }

// --- workflow definition + materialised state ---

type Step struct {
    Name    string
    Action  func(ctx context.Context) error
    MaxTry  int
    Backoff time.Duration
}

type workflowState struct {
    id            string
    startedAt     time.Time
    step          int
    lastCompleted string
    failed        bool
    failedAt      string
    failErr       string
    timers        []string
}

// replay folds events into a fresh state. Deterministic: no clocks, no I/O.
func replay(events []Event) workflowState {
    var s workflowState
    for _, e := range events {
        e.apply(&s)
    }
    return s
}

// --- runtime: one goroutine per workflow, owns the log ---

type Runtime struct {
    mu    sync.Mutex
    logs  map[string][]Event
    log   *slog.Logger
}

func NewRuntime() *Runtime {
    return &Runtime{
        logs: map[string][]Event{},
        log:  slog.New(slog.NewTextHandler(os.Stdout, nil)),
    }
}

// append is atomic w.r.t. concurrent readers of the log for this ID.
// In production: a single INSERT INTO event_log row.
func (r *Runtime) append(id string, e Event) {
    r.mu.Lock()
    defer r.mu.Unlock()
    r.logs[id] = append(r.logs[id], e)
}

func (r *Runtime) snapshot(id string) []Event {
    r.mu.Lock()
    defer r.mu.Unlock()
    out := make([]Event, len(r.logs[id]))
    copy(out, r.logs[id])
    return out
}

// Run executes a workflow to completion or to a permanent failure.
// All decisions (which step to run next, whether to retry) come from
// replaying the log — that is what makes the workflow durable.
func (r *Runtime) Run(ctx context.Context, wfID string, steps []Step) error {
    // Bootstrap: if the workflow has no events, start it.
    if len(r.snapshot(wfID)) == 0 {
        r.append(wfID, WorkflowStarted{ID: wfID, At: time.Now()})
    }

    for {
        if ctx.Err() != nil {
            return ctx.Err()
        }
        st := replay(r.snapshot(wfID))
        if st.failed {
            return fmt.Errorf("workflow %s failed at %s: %s", wfID, st.failedAt, st.failErr)
        }
        if st.step >= len(steps) {
            r.log.Info("workflow_done", "id", wfID, "steps", st.step)
            return nil
        }

        step := steps[st.step]
        if err := r.runStep(ctx, wfID, step); err != nil {
            return err
        }
    }
}

// runStep enforces per-step retry policy. Each attempt is logged so the
// audit trail shows the full history, not just the outcome.
func (r *Runtime) runStep(ctx context.Context, wfID string, s Step) error {
    maxTry := s.MaxTry
    if maxTry < 1 {
        maxTry = 1
    }
    for attempt := 1; attempt <= maxTry; attempt++ {
        start := time.Now()
        err := s.Action(ctx)
        dur := time.Since(start)
        if err == nil {
            r.log.Info("step_ok",
                "workflow", wfID, "step", s.Name,
                "attempt", attempt, "dur_ms", dur.Milliseconds())
            r.append(wfID, StepCompleted{Name: s.Name, At: time.Now()})
            return nil
        }
        r.log.Warn("step_err",
            "workflow", wfID, "step", s.Name,
            "attempt", attempt, "dur_ms", dur.Milliseconds(),
            "err", err.Error())
        if attempt == maxTry {
            r.append(wfID, StepFailed{Name: s.Name, Err: err.Error(), At: time.Now()})
            return fmt.Errorf("step %s exhausted retries: %w", s.Name, err)
        }
        // Linear backoff. Production: exponential + jitter.
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(time.Duration(attempt) * s.Backoff):
        }
    }
    return nil // unreachable
}

// ScheduleTimer fires a TimerFired event after d. The workflow can wait
// for it by reading r.snapshot(wfID) in its action. Production runtimes
// pause-and-resume the goroutine; this version polls.
func (r *Runtime) ScheduleTimer(wfID, name string, d time.Duration) {
    time.AfterFunc(d, func() {
        r.append(wfID, TimerFired{Name: name, At: time.Now()})
    })
}

func (r *Runtime) Dump(wfID string) {
    fmt.Printf("=== log for %s ===\n", wfID)
    for i, e := range r.snapshot(wfID) {
        fmt.Printf("  %d. %s\n", i, e)
    }
}

// --- demo workflow ---

func main() {
    rt := NewRuntime()
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()

    var flakyTries int
    steps := []Step{
        {
            Name: "reserve-inventory",
            Action: func(_ context.Context) error {
                fmt.Println("[step] reserving")
                return nil
            },
            MaxTry: 1,
        },
        {
            Name: "charge-card",
            Action: func(_ context.Context) error {
                flakyTries++
                if flakyTries < 3 {
                    return errors.New("network blip")
                }
                fmt.Println("[step] charged")
                return nil
            },
            MaxTry:  5,
            Backoff: 20 * time.Millisecond,
        },
        {
            Name: "wait-for-shipment",
            Action: func(ctx context.Context) error {
                // Schedule a timer at start; poll the log for it.
                rt.ScheduleTimer("wf-1", "ship-deadline", 50*time.Millisecond)
                tk := time.NewTicker(10 * time.Millisecond)
                defer tk.Stop()
                for {
                    select {
                    case <-ctx.Done():
                        return ctx.Err()
                    case <-tk.C:
                        st := replay(rt.snapshot("wf-1"))
                        for _, t := range st.timers {
                            if t == "ship-deadline" {
                                fmt.Println("[step] timer fired, shipment ack")
                                return nil
                            }
                        }
                    }
                }
            },
            MaxTry: 1,
        },
    }

    if err := rt.Run(ctx, "wf-1", steps); err != nil {
        fmt.Println("workflow failed:", err)
    }
    rt.Dump("wf-1")
}
```

</details>

---

## 4. How to grade yourself

Walk through your code and tick each box. If you cannot tick a box, the senior-level version of the task is not done yet.

- [ ] Every state's behavior lives on its own type — no `switch o.status` survives outside the dispatcher.
- [ ] The Context (the machine) drives transitions; states return the next state, they don't swap the pointer themselves.
- [ ] Persistence stores the state *name* (a string or int constant), never the state object.
- [ ] `Enter`/`Exit` hooks exist where they are useful (timers, audit rows) and are no-ops where they are not.
- [ ] Guards and Actions are distinguishable in errors — callers can `errors.Is(err, ErrGuard)` vs `ErrAction`.
- [ ] Concurrent access is serialised: either a mutex around `Send`, or a single owner goroutine reading from a channel.
- [ ] Logs are structured (`slog`), include the workflow ID, the from/to states, the event, and the duration.
- [ ] Naming reflects role: `State`, `Machine`, `Transition`, `Event` — not `Manager`, `Handler`, `Helper`.
- [ ] Generics show up where they remove repetition (a parameterised FSM), not as decoration.
- [ ] Tests are table-driven over the transition table — every `(state, event)` pair has a row.
- [ ] State-function lexers are used for streaming/parser problems, not for stateful business workflows.
- [ ] Hierarchical states use embedding for shared behavior; sub-states delegate to the super-state for unhandled events.
- [ ] Background watchers (stuck-detection) take a `ctx` and shut down cleanly when it is cancelled.
- [ ] Event-sourced commands return new events; they do not mutate the materialised view directly.
- [ ] Shutdown is explicit; there is no `os.Exit` from inside a worker or a watcher.

---

## 5. Stretch challenges

Pick one and ship it end-to-end.

1. **Graphviz exporter.** Take task 7's transition table and generate a `.dot` file that renders the state graph. Add CI that fails if the diagram in the repo is out of date with the table. The win: design reviews stop arguing about "is this transition allowed" and start arguing about the picture.

2. **SQLite-backed durable workflow.** Replace task 15's in-memory `map[string][]Event` with a SQLite table (`workflow_id TEXT, seq INT, event_type TEXT, payload BLOB`). Add a tool that reads the log of a given workflow and prints the trace. Bonus: a `--resume` flag that restarts an interrupted workflow from its log.

3. **State-machine fuzzer.** Take any FSM (task 7 or 11) and write a fuzz test that sends random events from random states and asserts the invariant "every successful transition is in the table". Use `go test -fuzz` to drive it. The win: invalid transitions cannot sneak in through a state you forgot to test.

The common thread: each stretch turns a textbook FSM into something a colleague could actually deploy. Stop when you can point at one of them on your laptop and say "this looks like the workflow engine at $JOB".

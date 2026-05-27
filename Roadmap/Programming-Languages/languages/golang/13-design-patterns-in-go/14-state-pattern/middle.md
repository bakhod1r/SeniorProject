# State — Middle

## 1. Where State actually shows up in Go

The "object-with-state-pointer" form from junior.md is the textbook version. In real Go code you'll see three practical shapes:

1. **Behavior-per-state types** — the classic GoF form. Used when each state has nontrivial behavior (parser modes, game states, REPL phases).
2. **Function-per-state machines** — `type stateFn func(...) stateFn`. The Rob Pike pattern from the [text/template lexer](https://go.dev/src/text/template/parse/lex.go). The state is a function; running it returns the next function.
3. **Table-driven state machines** — a `[currentState][event] -> (newState, action)` table. Used when the state graph is large but the per-state code is uniform (TCP, protocol state machines).

Choosing among them is the middle-level skill: each has the same semantics but very different ergonomics.

---

## 2. The behavior-per-state form (refined)

```go
type State interface {
    Enter(m *Machine)
    Tick(m *Machine, ev Event) State
    Exit(m *Machine)
    Name() string
}

type Machine struct {
    state State
    data  Context  // shared data across states
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

Key middle-level points:
- `Enter`/`Exit` hooks for setup/teardown per state.
- `Tick` returns the **next** state, not mutating directly — the machine drives the swap.
- A shared `Context` (often called "blackboard" in AI) holds data the states need.
- Logging the transition is non-negotiable in production code.

This shape is what you build when you want testable, observable state changes.

---

## 3. The state-function form (Rob Pike's lexer)

State *is* a function. Each function does its work and returns the next state function (or `nil` to stop):

```go
type stateFn func(*Lexer) stateFn

func (l *Lexer) run() {
    for state := lexText; state != nil; {
        state = state(l)
    }
}

func lexText(l *Lexer) stateFn {
    for {
        if strings.HasPrefix(l.input[l.pos:], "{{") {
            return lexAction
        }
        if l.next() == eof { return nil }
    }
}

func lexAction(l *Lexer) stateFn { /* parses {{ ... }}, returns lexText or nil */ }
```

Used by:
- `text/template/parse/lex.go`
- `encoding/json` decoder
- Most hand-written Go lexers

When to reach for it:
- The state graph is essentially linear or small.
- Each state has *one* job and *one or two* possible nexts.
- Performance matters — no interface dispatch, no allocation per transition.

When to avoid it:
- Many states with overlapping logic (function copies multiply).
- Need per-state state-data (you'd have to pass it via the machine struct).
- Need introspection — function values are opaque; you can't easily ask "what state am I in?".

---

## 4. The table-driven form

When the state graph is large and the per-state code is uniform (validation, transition logging, persistence), encode the rules as data:

```go
type transition struct {
    from, event, to string
    action          func(*Machine) error
}

var orderFSM = []transition{
    {"pending", "pay",    "paid",      payHandler},
    {"pending", "cancel", "cancelled", cancelHandler},
    {"paid",    "ship",   "shipped",   shipHandler},
    {"paid",    "refund", "refunded",  refundHandler},
    // ...
}

func (m *Machine) Send(event string) error {
    for _, t := range orderFSM {
        if t.from == m.state && t.event == event {
            if t.action != nil {
                if err := t.action(m); err != nil { return err }
            }
            m.state = t.to
            return nil
        }
    }
    return fmt.Errorf("invalid event %q in state %q", event, m.state)
}
```

This is what you get from `looplab/fsm` or `qmuntal/stateless`. Pros: the state machine is **data**, so you can visualize it, validate it (no unreachable states), generate diagrams from it. Cons: per-state logic now lives in handler functions detached from "the state".

---

## 5. Choosing among the three

| Form | Best when | Avoid when |
|------|-----------|------------|
| Behavior-per-state | Rich, distinct behavior per state | Many similar states |
| State-function | Linear/streaming (lexers, parsers) | Many states with shared data |
| Table-driven | Large graph, uniform per-state code | Each state has unique complex logic |

A real codebase often **mixes** them: a `Machine` struct (behavior form) whose `Send` consults a table to decide what's legal, with state-function leaves for streaming sub-tasks.

---

## 6. Guards and side effects

A guard is "this transition is only legal if X". A side effect is "running this transition causes Y to happen". Make both explicit:

```go
type Transition struct {
    From, Event, To string
    Guard           func(*Machine) bool          // may we?
    Action          func(*Machine) error          // do the work
}
```

The order is: check Guard → run Action → swap state. If Action fails partway, you have a choice:
- Revert state (treat the FSM as transactional).
- Move to a known-bad state (`failed`) and surface the error.
- Retry the action (idempotent actions only).

Pick one and document it. Mixing them is the source of "but it sometimes ends up in `paid` even though the charge failed" bugs.

---

## 7. Persisting state

For long-lived workflows (orders, subscriptions, support tickets) the state must survive process restarts:

```go
type Order struct {
    ID        string
    Status    string    // serializable name
    UpdatedAt time.Time
    // ... fields per state, possibly nil when not in that state
}

func Load(id string) *OrderMachine {
    var o Order
    db.Get(&o, id)
    return &OrderMachine{order: o, state: states[o.Status]}
}

func (m *OrderMachine) save() error { return db.Save(&m.order) }
```

The lookup table `states[name]` maps stored strings back to state objects. Don't store the state *object* (it's behavior). Store the *name*; reconstitute the object.

Real-world tools (Temporal, Cadence) do this for you: they checkpoint the workflow's logical position after every state-changing call.

---

## 8. Concurrency

A state machine is rarely free from concurrent input — events arrive on multiple goroutines. Two safe patterns:

1. **Mutex-guarded `Send`** — serialize all event handling:

   ```go
   func (m *Machine) Send(ev Event) error {
       m.mu.Lock()
       defer m.mu.Unlock()
       // dispatch
   }
   ```

2. **Channel-fed loop** — one goroutine owns the machine; events arrive on a channel:

   ```go
   for {
       select {
       case ev := <-m.events:
           m.handle(ev)
       case <-m.ctx.Done():
           return
       }
   }
   ```

   This is the most idiomatic Go approach — no mutex, no race on the state field. The trade-off is buffering (an unbuffered channel back-pressures the producer) and ordering (the channel preserves order, mutex doesn't necessarily).

---

## 9. Testing

State machines test beautifully if you let them:

```go
func TestOrderHappyPath(t *testing.T) {
    o := New()
    require.NoError(t, o.Pay())
    require.Equal(t, "paid", o.State())
    require.NoError(t, o.Ship())
    require.Equal(t, "shipped", o.State())
}

func TestOrderInvalidTransitions(t *testing.T) {
    cases := []struct {
        state, event string
        wantErr      bool
    }{
        {"pending", "ship", true},
        {"paid", "pay", true},
        {"shipped", "cancel", true},
        // ...
    }
    for _, c := range cases {
        t.Run(c.state+"/"+c.event, func(t *testing.T) { /* ... */ })
    }
}
```

Table-driven tests are a natural fit. For larger machines, generate the test cases from the transition table itself — "every (state, event) pair not in the table should fail".

---

## 10. Common middle-level mistakes

- **Storing the state object in the database** — when you redeploy with a new state type, the stored data won't unmarshal.
- **Tick mutating the state during traversal** — return the next state; let the machine swap. Otherwise `Enter`/`Exit` order gets confused.
- **No `Enter`/`Exit` hooks** — you'll discover the need (start a timer on `Paid`, stop it on `Shipped`) too late.
- **No history** — for debugging, every transition deserves a row in an audit table.
- **States that know about each other** — `Pending` directly returning `Paid{}` and `Paid` directly returning `Shipped{}` ties the graph in code. Prefer the machine deciding the next state.

---

## 11. Summary

The middle-level State skill is choosing the right of three shapes — behavior-per-state, state-function, table-driven — based on the size and uniformity of the graph. Add `Enter`/`Exit` hooks, name your states, log transitions, store the state name (not the object), and serialize event handling. Test the full transition table. The pattern stays simple; the engineering is in the surrounding plumbing.

---

## Further reading
- Rob Pike, *Lexical scanning in Go* (2011) — the state-function form
- `text/template/parse/lex.go` — production state-function lexer
- `looplab/fsm` — table-driven FSM library
- `qmuntal/stateless` — declarative state machine
- Martin Fowler, *State Machine* (refactoring.com)
- Temporal/Cadence — durable workflows as state machines

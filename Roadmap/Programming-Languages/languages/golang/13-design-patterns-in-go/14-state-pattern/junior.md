# State — Junior

## 1. What is the State pattern?

Some objects behave differently depending on what mode they're in. A door that's locked rejects `Open()`. A connection that's closed rejects `Send()`. A traffic light goes Red → Green → Yellow → Red.

The naive way: stuff every method full of `if state == X { ... } else if state == Y { ... }` branches. It works for two states. It collapses at five.

The **State** pattern (GoF) says: extract each mode into its own type. The object holds a pointer to the *current* state object, and delegates behavior to it. To change modes, you swap the pointer.

> Allow an object to alter its behavior when its internal state changes. The object will appear to change its class.

In Go, this usually means: a small set of state types satisfying a `State` interface, plus a context type (the "machine") that holds the current state and forwards calls to it.

---

## 2. Prerequisites
- Interfaces and how methods dispatch through them.
- Pointer receivers vs value receivers (matters for swapping state).
- Familiarity with at least one state-machine concept (TCP states, HTTP request lifecycle, an order workflow).

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Context** | The object whose behavior changes; holds the current state |
| **State** | A type that defines behavior for one mode |
| **Transition** | The act of swapping one state for another |
| **Event** | The input that may trigger a transition |
| **Guard** | A condition that must hold for a transition to fire |

---

## 4. The naive form (without the pattern)

```go
type Order struct {
    status string // "pending" | "paid" | "shipped" | "cancelled"
}

func (o *Order) Pay() error {
    switch o.status {
    case "pending":
        o.status = "paid"
        return nil
    case "paid", "shipped", "cancelled":
        return fmt.Errorf("can't pay an order in %s", o.status)
    }
    return fmt.Errorf("unknown status %s", o.status)
}

func (o *Order) Ship() error {
    switch o.status { /* same pattern, different rules */ }
}
```

Two methods, four statuses, eight cases. Add a "refunded" status and you touch every method. Add a method and you touch every status.

---

## 5. The State pattern in Go

Define an interface for state behavior, one type per state:

```go
type OrderState interface {
    Pay(*Order) error
    Ship(*Order) error
    Cancel(*Order) error
    Name() string
}

type Order struct {
    state OrderState
}

func (o *Order) setState(s OrderState) { o.state = s }
func (o *Order) Pay() error    { return o.state.Pay(o) }
func (o *Order) Ship() error   { return o.state.Ship(o) }
func (o *Order) Cancel() error { return o.state.Cancel(o) }
```

Each state owns its own rules:

```go
type Pending struct{}

func (Pending) Name() string { return "pending" }
func (Pending) Pay(o *Order) error {
    o.setState(Paid{})
    return nil
}
func (Pending) Ship(o *Order) error { return errors.New("can't ship unpaid order") }
func (Pending) Cancel(o *Order) error {
    o.setState(Cancelled{})
    return nil
}

type Paid struct{}

func (Paid) Name() string { return "paid" }
func (Paid) Pay(o *Order) error    { return errors.New("already paid") }
func (Paid) Ship(o *Order) error   { o.setState(Shipped{}); return nil }
func (Paid) Cancel(o *Order) error { o.setState(Cancelled{}); return nil }

// ...Shipped, Cancelled similarly
```

Use:

```go
o := &Order{state: Pending{}}
o.Pay()  // ok
o.Ship() // ok
o.Pay()  // error: already paid
```

Adding a new state means adding one type — not editing four methods.

---

## 6. State pointer vs state name

A common simplification: keep a `state string` for storage and lookup, but route behavior through a `map[string]OrderState`:

```go
var states = map[string]OrderState{
    "pending":   Pending{},
    "paid":      Paid{},
    "shipped":   Shipped{},
    "cancelled": Cancelled{},
}

func (o *Order) Pay() error { return states[o.statusName].Pay(o) }
```

Stores well, serializes well, and you still get the per-state dispatch.

---

## 7. Real-world analogy
A vending machine. In "idle" mode it waits for coins. In "has-money" mode it waits for a selection. In "dispensing" mode it ignores new input. The buttons are the same; their effect depends on the mode.

---

## 8. When you'll see it
- Network connection lifecycles (`net.Conn`, TCP state machine).
- Order/payment/shipment workflows.
- Game character states (idle, running, jumping, attacking).
- Parser states (in-string, in-comment, in-identifier).
- Workflow engines (Temporal, Cadence — each step is a state).

---

## 9. Common mistakes
- Letting the **Context** make the transition decisions instead of the state — defeats the point.
- Spreading transition rules across every state and the context.
- Sharing mutable data between states without making it explicit on the context.
- Forgetting that swapping the state object in the middle of a method may cause the rest of the method to see the new state.

---

## 10. Summary
State turns a fat `switch` over a status field into a small set of behavior objects. Each state knows what it can do and which state to become next. The context (the machine) forwards calls to whichever state is current. Adding modes becomes easy; reading the rules becomes easy too.

---

## Further reading
- Refactoring.Guru — State pattern: https://refactoring.guru/design-patterns/state
- TCP state diagram (RFC 793 §3.2)
- `net/http.Request` lifecycle as an informal state machine

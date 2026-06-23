# State Pattern — Find the Bug

## 1. How to use this file

Fifteen buggy State-pattern snippets. Read each one, find the defect in 30-60 seconds, then expand `<details>` for the answer. Every bug here has shown up in real production Go code — state machines are deceptively simple to write and surprisingly easy to break.

---

## Bug 1 — Transition during method causes double-execution

```go
type State interface {
    Tick(m *Machine, ev Event) State
    Name() string
}

type Paid struct{}

func (Paid) Name() string { return "paid" }
func (Paid) Tick(m *Machine, ev Event) State {
    if ev == EventShip {
        m.state = Shipped{}            // swap mid-method
        m.state.Tick(m, ev)            // re-dispatch on the new state
        m.log.Info("shipped order", "id", m.OrderID)
        return nil
    }
    return nil
}
```

<details><summary>Answer</summary>

**Bug:** `Paid.Tick` swaps `m.state` to `Shipped{}` and immediately calls `m.state.Tick(m, ev)` on the new state. `Shipped.Tick` runs to completion, then control returns to `Paid.Tick` which logs and exits. The event has been processed twice in the same call, and any `Enter`/`Exit` hooks were skipped.

**Why it's subtle:** It reads like "handle the event, then move on". The second dispatch looks like a clean handoff. The double-execution only matters if `Tick` has side effects (charge, notify, persist) — which it usually does.

**Spot in review:** Any `Tick`/`Handle` method that writes to `m.state` and then continues running. The state should return the next state; the machine should swap.

**Fix:**

```go
func (Paid) Tick(m *Machine, ev Event) State {
    if ev == EventShip {
        return Shipped{}               // let the machine swap
    }
    return nil
}

func (m *Machine) Send(ev Event) {
    if next := m.state.Tick(m, ev); next != nil {
        m.Transition(next)             // single, observable swap
    }
}
```

**Why common:** Developers reach for "in-place swap" because it feels concrete. The indirection through a return value seems unnecessary until you trace the double side effect in production.
</details>

---

## Bug 2 — Storing state object in DB

```go
type State interface{ Name() string }

type Paid struct {
    PaidAt time.Time
    Method string
}

type Order struct {
    ID    string
    State State    `json:"state"`
}

func Save(o *Order) error {
    b, _ := json.Marshal(o)
    return db.Put(o.ID, b)
}

func Load(id string) (*Order, error) {
    b, _ := db.Get(id)
    var o Order
    return &o, json.Unmarshal(b, &o)   // panics on next deploy
}
```

<details><summary>Answer</summary>

**Bug:** `o.State` is an interface field. `json.Marshal` only writes the concrete fields (without the type), and `json.Unmarshal` cannot reconstruct an interface — it doesn't know whether `{"PaidAt": ...}` is a `Paid`, `Refunded`, or something new. The unmarshal silently fills a nil interface, or panics when something later calls `o.State.Name()`.

When you deploy a new version with a new state type added, persisted records from the previous version unmarshal into a nil interface — every old order crashes the request handler.

**Why it's subtle:** The producer side works. Tests round-trip a `Paid{}` and pass because `Paid` is the only state the test knows about. Production fails the first time it loads an order written by an older binary.

**Spot in review:** Any `interface{}` or named-interface field on a struct being marshaled to JSON, gob, or any cross-process format.

**Fix:**

```go
type Order struct {
    ID     string
    Status string    `json:"status"`   // store the NAME
}

var registry = map[string]State{
    "pending": Pending{}, "paid": Paid{}, "shipped": Shipped{},
}

func Load(id string) (*Order, error) {
    var o Order
    b, _ := db.Get(id)
    if err := json.Unmarshal(b, &o); err != nil { return nil, err }
    if _, ok := registry[o.Status]; !ok {
        return nil, fmt.Errorf("unknown status %q", o.Status)
    }
    return &o, nil
}
```

Store the name. Reconstitute the behavior object from a registry.

**Why common:** "Save the state" is read literally. Developers don't notice that state is *behavior*, not *data*, until a redeploy mangles a queue of pending orders.
</details>

---

## Bug 3 — Action runs before guard check

```go
type Transition struct {
    From, Event, To string
    Guard           func(*Machine) bool
    Action          func(*Machine) error
}

func (m *Machine) Send(ev string) error {
    for _, t := range m.table {
        if t.From != m.state || t.Event != ev { continue }
        if err := t.Action(m); err != nil {   // runs first
            return err
        }
        if t.Guard != nil && !t.Guard(m) {     // checked after
            return fmt.Errorf("guard denied %s/%s", m.state, ev)
        }
        m.state = t.To
        return nil
    }
    return fmt.Errorf("no transition")
}
```

<details><summary>Answer</summary>

**Bug:** `Action` runs before `Guard`. If the guard rejects the transition, the action has already executed — money charged, email sent, inventory deducted — but the state never advances. On retry the action runs again. Double charge.

**Why it's subtle:** The two lines look almost interchangeable: "do the thing and check it's allowed". Order matters here far more than it appears.

**Spot in review:** Any transition handler that performs side effects before validating the transition is permitted.

**Fix:**

```go
for _, t := range m.table {
    if t.From != m.state || t.Event != ev { continue }
    if t.Guard != nil && !t.Guard(m) {
        return fmt.Errorf("guard denied %s/%s", m.state, ev)
    }
    if err := t.Action(m); err != nil { return err }
    m.state = t.To
    return nil
}
```

Guard → Action → swap. Always.

**Why common:** Guards are often added late, after the action code is already in place. Inserting the check feels like "one more validation step"; nobody notices it lives below the side effect.
</details>

---

## Bug 4 — State enum drift between code and DB

```go
var states = map[string]State{
    "Pending":   Pending{},
    "Paid":      Paid{},
    "Shipped":   Shipped{},
    "Cancelled": Cancelled{},
}

// Migration script written six months ago:
// INSERT INTO orders (id, status) VALUES ('o1', 'paid');

func Load(id string) (*Order, error) {
    var status string
    db.QueryRow("SELECT status FROM orders WHERE id=?", id).Scan(&status)
    s, ok := states[status]
    if !ok { return nil, fmt.Errorf("unknown status %q", status) }
    return &Order{ID: id, state: s}, nil
}
```

<details><summary>Answer</summary>

**Bug:** The database stores lower-case names (`paid`, `pending`); the code's lookup map uses title-case keys (`Paid`, `Pending`). Every load fails with `unknown status "paid"`. The mismatch sits across two systems and nobody notices until prod data is loaded.

**Why it's subtle:** Both halves are internally consistent. The code's map matches the Go type names; the DB column matches whatever the original migration script (or a CSV import, or another service) wrote. The drift only shows when the two halves meet.

**Spot in review:** Any string-keyed state lookup — verify that the case, spelling, and separator convention match the canonical value used elsewhere (DB, queue, API).

**Fix:**

```go
func canonical(s string) string { return strings.ToLower(s) }

var states = map[string]State{
    "pending":   Pending{},
    "paid":      Paid{},
    "shipped":   Shipped{},
    "cancelled": Cancelled{},
}

func Load(id string) (*Order, error) {
    var status string
    db.QueryRow("SELECT status FROM orders WHERE id=?", id).Scan(&status)
    s, ok := states[canonical(status)]
    if !ok { return nil, fmt.Errorf("unknown status %q", status) }
    return &Order{ID: id, state: s}, nil
}
```

Or — better — define a single typed enum (`type Status string`) used by both DB layer and state map. One source of truth.

**Why common:** State names start their life as DB strings, get re-typed into Go later, and the casing convention diverges. CHECK constraints on the DB column would have caught this on day one.
</details>

---

## Bug 5 — Goroutine races on m.state

```go
type Machine struct {
    state State
    log   *slog.Logger
}

func (m *Machine) Send(ev Event) {
    next := m.state.Tick(m, ev)
    if next != nil {
        m.state = next
    }
}

// Two goroutines:
go m.Send(EventPay)
go m.Send(EventCancel)
```

<details><summary>Answer</summary>

**Bug:** `m.state` is read and written without synchronization. Two concurrent `Send` calls race: both may read the same `Pending`, both transition (one to `Paid`, one to `Cancelled`), and the last writer wins. The losing transition's side effect already ran — money was charged on an order that's now `Cancelled`.

**Why it's subtle:** Each individual `Send` looks correct. The race is across two invocations, and the data race detector only flags it if both writes happen close enough in time.

**Spot in review:** Any `*Machine` shared across goroutines without `sync.Mutex` (or a single owning goroutine via a channel-fed event loop).

**Fix (mutex):**

```go
type Machine struct {
    mu    sync.Mutex
    state State
    log   *slog.Logger
}

func (m *Machine) Send(ev Event) {
    m.mu.Lock()
    defer m.mu.Unlock()
    if next := m.state.Tick(m, ev); next != nil {
        m.state = next
    }
}
```

**Fix (actor):**

```go
func (m *Machine) Run(ctx context.Context) {
    for {
        select {
        case ev := <-m.events:
            if next := m.state.Tick(m, ev); next != nil {
                m.state = next
            }
        case <-ctx.Done():
            return
        }
    }
}
```

**Why common:** State machines are written for a single-goroutine mental model — "events arrive in order". Web handlers, message consumers, and timer callbacks routinely violate that assumption.
</details>

---

## Bug 6 — Enter hook called twice on the same state

```go
func (m *Machine) Transition(next State) {
    m.state.Exit(m)
    m.log.Info("transition", "from", m.state.Name(), "to", next.Name())
    m.state = next
    m.state.Enter(m)
}

type Paid struct{}

func (Paid) Enter(m *Machine) {
    m.shipTimer = time.AfterFunc(48*time.Hour, func() {
        m.Send(EventAutoShip)
    })
}

// Some handler:
if m.state.Name() == "paid" {
    m.Transition(Paid{}) // already Paid — Enter runs again, second timer armed
}
```

<details><summary>Answer</summary>

**Bug:** `Transition` doesn't check whether the next state is the same as the current state. Re-entering `Paid` re-runs `Enter`, which arms a second 48-hour timer. After enough re-entries the order auto-ships multiple times, or the orphaned timers leak.

**Why it's subtle:** The textbook says "Exit, swap, Enter". Nobody explicitly says "skip if no-op". The hook is correct in isolation; the surrounding loop is what's wrong.

**Spot in review:** Any `Enter` that allocates a timer, opens a connection, or starts a goroutine — combined with a `Transition` that doesn't short-circuit identical transitions.

**Fix:**

```go
func (m *Machine) Transition(next State) {
    if next == nil || next.Name() == m.state.Name() {
        return                              // no-op self-transition
    }
    m.state.Exit(m)
    m.log.Info("transition", "from", m.state.Name(), "to", next.Name())
    m.state = next
    m.state.Enter(m)
}
```

If self-transitions are semantically meaningful (re-arm the timer on every `Pay`), document it and make `Enter` cancel the previous timer first.

**Why common:** Idempotency of `Enter` is rarely a requirement — until the side effect is a timer, a goroutine, or a metric counter that drifts.
</details>

---

## Bug 7 — Action partial failure leaves machine in inconsistent state

```go
func (m *Machine) Send(ev string) error {
    t, ok := m.find(m.state, ev)
    if !ok { return fmt.Errorf("invalid") }

    if err := t.Action(m); err != nil {
        return err                           // state unchanged, action partially ran
    }
    m.state = t.To
    return nil
}

func chargeCard(m *Machine) error {
    if err := stripe.Charge(m.OrderID, m.Amount); err != nil {
        return err
    }
    if err := m.audit.Log("charged", m.OrderID); err != nil {
        return err                           // charged, but audit failed
    }
    return nil
}
```

<details><summary>Answer</summary>

**Bug:** `Action` is not transactional. `stripe.Charge` succeeds, then `audit.Log` fails. The action returns an error, the machine stays in `Pending`, and the caller retries — charging the card a second time. The customer is billed twice; the state never advanced.

**Why it's subtle:** The error handling looks correct: "if action fails, don't transition". The flaw is that *the action itself* mixes a non-reversible side effect (card charge) with a fallible follow-up (audit log).

**Spot in review:** Any `Action` that performs more than one side effect, where the later ones can fail after the earlier ones have committed.

**Fix:** Make actions idempotent (pass an idempotency key) and move the machine to a known-bad state on failure so retries are explicit:

```go
func (m *Machine) Send(ev string) error {
    t, ok := m.find(m.state, ev)
    if !ok { return fmt.Errorf("invalid") }

    if err := t.Action(m); err != nil {
        m.state = "failed_" + t.To           // explicit failure mode
        m.lastErr = err
        return err
    }
    m.state = t.To
    return nil
}

func chargeCard(m *Machine) error {
    return stripe.ChargeIdempotent(m.OrderID, m.Amount, m.idempotencyKey)
}
```

Or split the transition into two: `chargePending` → `chargeRecorded` → `paid`. Each step is small enough to be retried safely.

**Why common:** Atomicity between an external API and a local DB is a hard problem. State machines paper over it with "the transition either happens or doesn't", which is a lie for any action that touches more than one system.
</details>

---

## Bug 8 — Loop variable capture in state-function table

```go
type stateFn func(*Lexer) stateFn

var keywords = []string{"func", "type", "var", "const"}

func buildKeywordStates() map[string]stateFn {
    fns := map[string]stateFn{}
    for _, kw := range keywords {
        fns[kw] = func(l *Lexer) stateFn {
            l.emit(kw)                       // pre-1.22: always emits "const"
            return lexText
        }
    }
    return fns
}
```

<details><summary>Answer</summary>

**Bug:** Pre-Go-1.22 the loop variable `kw` is shared across iterations. Every closure captures the same `kw`, which holds `"const"` by the time any function is called. Every keyword emits as `"const"`.

**Why it's subtle:** The map looks correctly populated when you `fmt.Println(fns)` — it has four entries. The values just all do the same thing.

**Spot in review:** A closure inside `for _, x := range` that references `x`, on a project whose `go.mod` predates 1.22.

**Fix:**

```go
for _, kw := range keywords {
    kw := kw                                 // shadow per iteration
    fns[kw] = func(l *Lexer) stateFn {
        l.emit(kw)
        return lexText
    }
}
```

Or upgrade to Go 1.22+ where each iteration gets a fresh variable.

**Why common:** State-function machines lean heavily on closures over per-state metadata. This is the closure-capture bug's natural habitat.
</details>

---

## Bug 9 — Iterating transitions in slice instead of map

```go
type Transition struct {
    From, Event, To string
    Action          func(*Machine) error
}

var fsm = []Transition{
    {"pending", "pay",    "paid",     payHandler},
    {"pending", "pay",    "fraud",    fraudFlagHandler},  // duplicate from/event
    {"paid",    "ship",   "shipped",  shipHandler},
}

func (m *Machine) Send(ev string) error {
    for _, t := range fsm {
        if t.From == m.state && t.Event == ev {
            if err := t.Action(m); err != nil { return err }
            m.state = t.To
            return nil
        }
    }
    return fmt.Errorf("no transition")
}
```

<details><summary>Answer</summary>

**Bug:** Two transitions share the same `(from, event)` pair. The slice iteration takes the *first* match, silently ignoring the fraud-check branch entirely. The intent (probably: "go to fraud if the guard fires") is lost — there are no guards on either entry, and the second never runs.

**Why it's subtle:** Both entries look valid in the table. There's no compile error, no runtime error, no warning. The fraud-check transition is dead code that reviewers assume "must do something".

**Spot in review:** Any `[]Transition` table with potentially overlapping `(from, event)` pairs. Either it should be a `map[Key]Transition` (compile-time uniqueness via duplicate-key detection at init), or each row needs a guard so the dispatch is unambiguous.

**Fix:**

```go
type Key struct{ From, Event string }

var fsm = map[Key]Transition{
    {"pending", "pay"}:  {To: "paid", Action: payHandler},
    {"paid",    "ship"}: {To: "shipped", Action: shipHandler},
}

// fraud-check belongs as a guard:
{"pending", "pay"}: {
    To: "paid",
    Guard:  func(m *Machine) bool { return !suspicious(m) },
    OnFail: "fraud",
    Action: payHandler,
},
```

Or sort the slice and assert uniqueness at init time:

```go
func init() {
    seen := map[Key]bool{}
    for _, t := range fsm {
        k := Key{t.From, t.Event}
        if seen[k] { panic(fmt.Sprintf("duplicate transition %v", k)) }
        seen[k] = true
    }
}
```

**Why common:** Tables grow over time. The original author wrote one row per transition; later somebody added a "special case" branch without realizing the slice iteration short-circuits on the first match.
</details>

---

## Bug 10 — Forgetting Exit hook on terminal state

```go
type State interface {
    Enter(m *Machine)
    Exit(m *Machine)
    Name() string
}

type Shipped struct{}

func (Shipped) Name() string         { return "shipped" }
func (Shipped) Enter(m *Machine)     { m.poller = startTrackingPoll(m) }
func (Shipped) Exit(m *Machine)      { m.poller.Stop() }

type Delivered struct{}

func (Delivered) Name() string       { return "delivered" }
func (Delivered) Enter(m *Machine)   {}
func (Delivered) Exit(m *Machine)    {}

// Machine never transitions out of Delivered — it's terminal:
func (m *Machine) Finish() {
    m.state = Delivered{}                    // no Exit called, no Transition used
}
```

<details><summary>Answer</summary>

**Bug:** `Finish` assigns `m.state = Delivered{}` directly instead of going through `Transition`. `Shipped.Exit` never runs, so `m.poller` keeps polling the tracking API forever. Every "completed" order leaks a goroutine.

**Why it's subtle:** Terminal states are special — there's no obvious place to put a cleanup. Developers reach for `m.state = ...` because "we're done; nothing else will happen". The cleanup of the *previous* state is what's missed.

**Spot in review:** Any direct write to `m.state` outside of `Transition`. Any terminal state that doesn't call its predecessor's `Exit`.

**Fix:**

```go
func (m *Machine) Finish() {
    m.Transition(Delivered{})                // runs Exit + Enter properly
}

func (m *Machine) Transition(next State) {
    if m.state != nil { m.state.Exit(m) }
    m.state = next
    if next != nil { next.Enter(m) }
}
```

If you want the terminal state to free machine-level resources too, give it a real `Enter`:

```go
func (Delivered) Enter(m *Machine) {
    m.releaseAllResources()
}
```

**Why common:** Terminal states are written last, by which point the `Transition` discipline has slipped. The leak only shows up under sustained traffic with monitoring on goroutine count.
</details>

---

## Bug 11 — Persisting state but not data

```go
type Paid struct {
    paidAt   time.Time
    method   string
    txnID    string
}

func (p Paid) Name() string { return "paid" }
func (p Paid) Refund(m *Machine) error {
    return stripe.Refund(p.txnID)            // needs txnID from when we paid
}

// Persistence:
type StoredOrder struct {
    ID     string `json:"id"`
    Status string `json:"status"`            // just the name
}

func Save(o *Machine) error {
    return db.Put(o.ID, StoredOrder{ID: o.ID, Status: o.state.Name()})
}

func Load(id string) (*Machine, error) {
    var s StoredOrder
    db.Get(id, &s)
    return &Machine{ID: s.ID, state: states[s.Status]}, nil  // fresh Paid{} — no txnID
}
```

<details><summary>Answer</summary>

**Bug:** The state *name* persists, but the state's *data* (`paidAt`, `method`, `txnID`) does not. After a reload, the machine is in `Paid` — but with a zero-valued `Paid{}`. `Refund` calls `stripe.Refund("")` and fails.

**Why it's subtle:** "Don't persist the state object, persist the name" (which is correct advice from junior.md) is taken too literally. The state name is the *type identifier*; the state's data fields are application state that still needs to survive.

**Spot in review:** Any state with private fields that aren't mirrored on the machine's persisted payload.

**Fix:** Move state-specific data onto the persisted record, then rehydrate it into the state object on load:

```go
type StoredOrder struct {
    ID      string    `json:"id"`
    Status  string    `json:"status"`
    PaidAt  time.Time `json:"paid_at,omitempty"`
    Method  string    `json:"method,omitempty"`
    TxnID   string    `json:"txn_id,omitempty"`
}

func Load(id string) (*Machine, error) {
    var s StoredOrder
    db.Get(id, &s)
    var state State
    switch s.Status {
    case "paid":
        state = Paid{paidAt: s.PaidAt, method: s.Method, txnID: s.TxnID}
    case "pending":
        state = Pending{}
    }
    return &Machine{ID: s.ID, state: state}, nil
}
```

Or keep all per-state data on the machine's `Context` struct, not inside the state types — then states are pure behavior and persistence has only one place to live.

**Why common:** The state-name-vs-state-object distinction is taught well; the data-on-the-state-object gotcha is not. The bug only fires for state-dependent actions (refund, cancel, escalate) after a restart.
</details>

---

## Bug 12 — Comparing interface state with `==`

```go
type State interface{ Name() string }
type Pending struct{ retries int }

func (Pending) Name() string { return "pending" }

func (m *Machine) waitUntilPaid() {
    for m.state == Pending{} {               // looks reasonable
        time.Sleep(100 * time.Millisecond)
    }
}

// Later, somewhere else:
func (m *Machine) RecordRetry() {
    p := m.state.(Pending)
    p.retries++
    m.state = p                              // new Pending value, different fields
}
```

<details><summary>Answer</summary>

**Bug:** `m.state == Pending{}` compares the dynamic value of the interface to a *zero-valued* `Pending`. Once `RecordRetry` runs, `m.state` holds `Pending{retries: 1}`, which is no longer equal to `Pending{}`. The loop exits even though the order is still pending. (And if the state contained a slice or map, `==` would panic at runtime.)

The reverse trap also exists: two separately constructed `Pending{}` pointers (`&Pending{}` vs `&Pending{}`) compare unequal even though they're logically the same state.

**Why it's subtle:** Interface equality looks intuitive — "same type, same fields, equal". It is, *if you remember which fields are present*. Adding a counter to `Pending` later breaks every `==` comparison in the codebase.

**Spot in review:** Any `==` or `!=` between an interface variable and a struct literal (or another interface variable holding a struct). Almost always a bug waiting to mature.

**Fix:** Compare names, not values:

```go
for m.state.Name() == "pending" {
    time.Sleep(100 * time.Millisecond)
}
```

Or use a type assertion when you actually need the data:

```go
if p, ok := m.state.(Pending); ok && p.retries < maxRetries {
    // ...
}
```

For pointer-state types, expose an `Equal` method explicitly.

**Why common:** Go's interface `==` semantics are well-defined but unintuitive. Comparing to a zero value looks like a clean "is it in this state" check; in fact it's "is it in this state with these specific fields".
</details>

---

## Bug 13 — Missing terminal state

```go
type stateFn func(*Lexer) stateFn

func (l *Lexer) run() {
    for state := lexText; state != nil; {
        state = state(l)
    }
}

func lexText(l *Lexer) stateFn {
    for {
        switch l.next() {
        case '{':
            return lexAction
        case eof:
            return lexText                   // bug: should return nil
        }
    }
}

func lexAction(l *Lexer) stateFn {
    // ... consumes the action, returns lexText
    return lexText
}
```

<details><summary>Answer</summary>

**Bug:** On `eof`, `lexText` returns itself instead of `nil`. The driver loop's exit condition (`state != nil`) is never satisfied. The lexer spins forever, repeatedly calling `lexText`, which repeatedly hits `eof`, which repeatedly returns `lexText`. CPU goes to 100%.

**Why it's subtle:** It *looks* like "keep lexing". The reader sees `return lexText` and reads "continue". The driver loop's termination contract — `nil` means stop — is implicit.

**Spot in review:** Every `stateFn`-style function should have at least one branch that returns `nil`. Verify the eof / done path explicitly.

**Fix:**

```go
func lexText(l *Lexer) stateFn {
    for {
        switch l.next() {
        case '{':
            return lexAction
        case eof:
            l.emit(itemEOF)
            return nil                       // terminate
        }
    }
}
```

Belt-and-braces: add a maximum-iteration guard in `run` for development builds:

```go
func (l *Lexer) run() {
    iter := 0
    for state := lexText; state != nil; {
        state = state(l)
        if iter++; iter > 1_000_000 {
            panic("lexer loop exceeded 1M iterations")
        }
    }
}
```

**Why common:** State-function machines lack a single "stop" signal — termination is "return nil from any state". A single forgotten branch hangs the entire machine.
</details>

---

## Bug 14 — Mutating shared context from one state visible to another

```go
type Context struct {
    Cart    []Item
    Coupon  string
    Total   int
}

type Reviewing struct{}

func (Reviewing) Tick(m *Machine, ev Event) State {
    m.ctx.Total = sum(m.ctx.Cart)            // recompute
    if ev == EventApplyCoupon {
        m.ctx.Coupon = "SAVE10"
        m.ctx.Total = m.ctx.Total * 9 / 10   // mutate
    }
    return Confirming{}
}

type Confirming struct{}

func (Confirming) Tick(m *Machine, ev Event) State {
    if m.ctx.Coupon != "" {
        m.ctx.Total = sum(m.ctx.Cart) * 9 / 10  // recompute, ignores prior mutation
    }
    return Paying{}
}
```

<details><summary>Answer</summary>

**Bug:** Two states mutate the same `*Context.Total`. `Reviewing` computes it one way (already-discounted value carried forward); `Confirming` recomputes it from scratch (assumes raw subtotal). If the user navigates back from Confirming to Reviewing and forward again, the discount is applied twice. Or zero times. Depends on the path.

**Why it's subtle:** Each state's code is internally correct. The bug is in the contract between states — there's no documented invariant about what `Total` means at each point in the workflow.

**Spot in review:** Any field on `Context` written by more than one state without an explicit ownership contract. A field that's read in state A and written in state B should be commented at the declaration: "owned by Reviewing; read-only elsewhere".

**Fix (option 1 — single owner):** Make total a derived value, computed on demand from cart + coupon:

```go
func (c *Context) ComputedTotal() int {
    t := sum(c.Cart)
    if c.Coupon == "SAVE10" { t = t * 9 / 10 }
    return t
}
```

Now no state mutates `Total`; the value is always consistent with the cart and coupon.

**Fix (option 2 — explicit ownership):** Document and enforce who writes what:

```go
type Context struct {
    Cart   []Item     // written: Browsing; read: all
    Coupon string     // written: Reviewing; read: Confirming, Paying
    Total  int        // written: Confirming only; read: Paying
}
```

Reviewers can then catch any state writing outside its lane.

**Why common:** Shared context starts as a convenience ("just stuff fields onto the machine"). Over time, multiple states accrete writes to the same field, and the invariants drift.
</details>

---

## Bug 15 — State transition inside a deferred call

```go
func (m *Machine) handlePayment(ev Event) error {
    m.log.Info("entering handlePayment", "state", m.state.Name())
    defer m.log.Info("exiting handlePayment", "state", m.state.Name())

    if err := stripe.Charge(m.OrderID, m.Amount); err != nil {
        defer m.Transition(Failed{})         // defer the transition
        return err
    }

    defer m.Transition(Paid{})               // defer success transition too
    m.audit.Log("charged", m.OrderID)
    return nil
}
```

<details><summary>Answer</summary>

**Bug:** `defer m.Transition(...)` runs **after** the function returns — and after the deferred `log.Info("exiting...")`. The log line records the *old* state ("pending"), not the new one. Worse, both `defer m.Transition` calls in the failure path are scheduled, but in the success path the `defer m.Transition(Paid{})` runs *before* the exit log because defers run LIFO — so the log might or might not see `Paid`, depending on the order they were registered.

If the function panics between `defer m.Transition(Failed{})` and `return err`, the transition still runs — moving the machine to `Failed` even if the caller intended to recover and retry.

**Why it's subtle:** `defer` looks like "guaranteed cleanup". Treating state transitions as cleanup is wrong: a transition is the *intent* of the function, not its cleanup. Side effects in the body (`audit.Log`) are now ordered before the transition, but log lines about the state are ordered after.

**Spot in review:** Any `defer m.Transition(...)`, `defer m.setState(...)`, or `defer m.state = ...`. State changes belong on the explicit success/failure path, not in a deferred call.

**Fix:**

```go
func (m *Machine) handlePayment(ev Event) error {
    m.log.Info("entering handlePayment", "state", m.state.Name())

    if err := stripe.Charge(m.OrderID, m.Amount); err != nil {
        m.Transition(Failed{})
        m.log.Info("payment failed", "state", m.state.Name())
        return err
    }

    m.Transition(Paid{})
    m.audit.Log("charged", m.OrderID)
    m.log.Info("payment succeeded", "state", m.state.Name())
    return nil
}
```

Transition first, then log/audit. The state and the log line agree.

**Why common:** Developers reach for `defer` to "make sure the state ends up right no matter what". The pattern is correct for resource cleanup (`defer f.Close()`) and wrong for state semantics — defers run after the body, but state should be set as part of the body.
</details>

---

## Summary

These bugs cluster into four families.

**Transition mechanics (1, 6, 10, 15):** mutating state mid-method, re-entering the same state, skipping Exit, deferring the transition. The pattern is "the transition discipline (Exit → swap → Enter) is bypassed by one shortcut".

**Persistence & identity (2, 4, 11, 12):** persisting the object instead of the name, casing drift between DB and code, persisting the name but not the data, comparing interfaces with `==`. State is *behavior* plus *data plus a label* — confusing any one for another is a class of bug.

**Concurrency & atomicity (3, 5, 7):** action before guard, racing on `m.state`, partial action failure. State machines are sequential by nature; production rarely is.

**Table & loop hazards (8, 9, 13, 14):** loop-variable capture, ambiguous transitions in a slice, missing terminal `nil`, shared mutable context. Tables and closures make state machines compact — and concentrate the failure modes.

Review checklist for any State-pattern PR:

- [ ] Does `Tick`/`Handle` **return** the next state, leaving the swap to the machine — instead of writing to `m.state` directly?
- [ ] Does `Transition` short-circuit when `next == current` (Enter idempotency)?
- [ ] Are `Enter` side effects (timers, goroutines, allocations) **cancelled** in `Exit`?
- [ ] Is every direct write to `m.state` outside `Transition` actually intentional? (Usually: rewrite via `Transition`.)
- [ ] Do guards run **before** actions?
- [ ] Are actions idempotent, or wrapped in a saga / outbox / compensation pattern?
- [ ] Is the persisted form the state **name** (not the object) — and is per-state data persisted alongside it?
- [ ] Do the DB enum, code enum, and string keys agree on case / spelling?
- [ ] Is `m.state` protected by a mutex, or owned by a single event-loop goroutine?
- [ ] Do transition tables forbid duplicate `(from, event)` keys at init time?
- [ ] Does every state-function path eventually return `nil` to terminate?
- [ ] Are loop variables shadowed (or is Go 1.22+ confirmed) before capturing in state-function closures?
- [ ] Do states compare by `Name()`, not by `==` on the interface value?
- [ ] For shared `Context` fields: is ownership ("who writes this") documented per field?

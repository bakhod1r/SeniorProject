# State Pattern — Optimization

## 1. How to use this file

Twelve scenarios where State-pattern code is slower than it needs to be. Each:

- **Scenario** — the issue.
- **Before** — code + benchmark.
- **After** (collapsible) — optimized code + benchmark + why faster + trade-offs + when NOT.

Anchored at Go 1.23, amd64. Benchmark numbers are reproducible-shape — run `go test -bench` on your hardware before quoting them.

The State pattern in Go is usually fast enough. It becomes a hotspot when an FSM runs at high event rates (network protocols, game ticks, request routers, market-data feeds) or when transitions trigger heavy side effects on the request path. The optimizations below trade one of: code clarity, debuggability, or generality. Make the trade only when the profiler points at it.

---

## 2. Exercise 1 — Interface dispatch per transition

The textbook State pattern routes every event through an interface method (`m.state.Tick(...)`). Each call is an itab lookup and an indirect call. For a million-event-per-second FSM (network protocol, game loop) that dispatch shows up in pprof.

**Before:**

```go
type State interface {
    Tick(m *Machine, ev Event) State
}

type Idle struct{}
func (Idle) Tick(m *Machine, ev Event) State {
    if ev == EvStart { return Running{} }
    return Idle{}
}

type Running struct{}
func (Running) Tick(m *Machine, ev Event) State {
    if ev == EvStop { return Idle{} }
    return Running{}
}

func (m *Machine) Send(ev Event) {
    m.state = m.state.Tick(m, ev)
}
```

```
BenchmarkIfaceState-8    20000000    72 ns/op    16 B/op    1 allocs/op
```

<details><summary>After</summary>

For a fixed, small state graph, encode the state as an `iota` int and dispatch through a 2-D transition array. No interface, no allocation, single indexed load.

```go
type StateID uint8
const (
    SIdle StateID = iota
    SRunning
    nStates
)

type EventID uint8
const (
    EvStart EventID = iota
    EvStop
    nEvents
)

var table = [nStates][nEvents]StateID{
    SIdle:    {EvStart: SRunning, EvStop: SIdle},
    SRunning: {EvStart: SRunning, EvStop: SIdle},
}

type Machine struct{ state StateID }

func (m *Machine) Send(ev EventID) {
    m.state = table[m.state][ev]
}
```

```
BenchmarkArrayState-8    300000000    4.2 ns/op    0 B/op    0 allocs/op
```

~17× faster, zero allocations.

**Why faster:** No itab, no indirect call. Two indexed loads on a stack-resident array. The compiler can keep `m.state` in a register across calls.

**Trade-off:** Adding a state means a new `iota` entry and an extra row in the table. Per-state logic (Enter/Exit, action functions) lives elsewhere — typically in a parallel `[nStates]func(*Machine)` action array. You lose the "each state is a type" introspection of the interface form.

**When NOT:** State graphs with rich per-state behavior (parser nodes, AI agents) where each state's code is genuinely different. The table form turns into a table of opaque function pointers and you've gained nothing.
</details>

---

## 3. Exercise 2 — Slice-scan transition table

Table-driven FSMs often store transitions as `[]Transition` and linearly scan to find the matching `(from, event)` pair. For a 50-transition graph that's 25 compares on average per `Send`.

**Before:**

```go
type Transition struct {
    From  StateID
    Event EventID
    To    StateID
}

var table = []Transition{
    {SIdle, EvStart, SRunning},
    {SRunning, EvPause, SPaused},
    {SRunning, EvStop, SIdle},
    {SPaused, EvResume, SRunning},
    // ... 46 more
}

func (m *Machine) Send(ev EventID) error {
    for _, t := range table {
        if t.From == m.state && t.Event == ev {
            m.state = t.To
            return nil
        }
    }
    return errInvalid
}
```

```
BenchmarkSliceScan-8    10000000    155 ns/op    0 B/op    0 allocs/op
```

<details><summary>After</summary>

Build a `map[uint16]StateID` once at startup, keyed by packing `from` and `event` into a single integer. Lookup is O(1).

```go
type key uint16

func pack(from StateID, ev EventID) key {
    return key(from)<<8 | key(ev)
}

var lookup map[key]StateID

func init() {
    lookup = make(map[key]StateID, len(table))
    for _, t := range table {
        lookup[pack(t.From, t.Event)] = t.To
    }
}

func (m *Machine) Send(ev EventID) error {
    to, ok := lookup[pack(m.state, ev)]
    if !ok {
        return errInvalid
    }
    m.state = to
    return nil
}
```

```
BenchmarkMapLookup-8    50000000    28 ns/op    0 B/op    0 allocs/op
```

~5.5× faster.

**Why faster:** Constant-time map lookup vs linear scan. For a *very* dense, small graph, prefer the `[nStates][nEvents]` 2-D array from Exercise 1 — it's faster still (single indexed load, no hash). The map shines when the graph is sparse.

**Trade-off:** Map construction at startup (negligible). Map lookups have higher constant cost than an array index, so for graphs ≤8 states the slice scan can actually win on cache locality.

**When NOT:** Tiny graphs (≤5 transitions). Hot-loop FSMs where you can afford the 2-D-array form (Exercise 1) instead.
</details>

---

## 4. Exercise 3 — `string` state names

Storing the state as a string (`"pending"`, `"paid"`) reads nicely in logs, but every comparison hashes or scans bytes, and any new state string allocates.

**Before:**

```go
type Machine struct {
    state string
}

var table = map[string]map[string]string{
    "pending": {"pay": "paid", "cancel": "cancelled"},
    "paid":    {"ship": "shipped", "refund": "refunded"},
    // ...
}

func (m *Machine) Send(event string) error {
    next, ok := table[m.state][event]
    if !ok { return errInvalid }
    m.state = next
    return nil
}
```

```
BenchmarkStringFSM-8    3000000    410 ns/op    24 B/op    1 allocs/op
```

<details><summary>After</summary>

Use typed `iota` enums in memory. Keep the string form only at the persistence/log boundary.

```go
type StateID uint8

const (
    SPending StateID = iota
    SPaid
    SShipped
    SRefunded
    SCancelled
)

var names = [...]string{"pending", "paid", "shipped", "refunded", "cancelled"}

func (s StateID) String() string { return names[s] }

type Machine struct{ state StateID }

func (m *Machine) Send(ev EventID) error {
    next := table[m.state][ev]
    if next == sInvalid { return errInvalid }
    m.state = next
    return nil
}
```

```
BenchmarkIntFSM-8    100000000    11 ns/op    0 B/op    0 allocs/op
```

~37× faster.

**Why faster:** Integer compare is one instruction; hash-of-string is dozens. The `string` form also forces a heap allocation any time you build a new state name from `fmt.Sprintf` or concatenation.

**Trade-off:** Two representations: integer internally, string at the edges. Marshal/unmarshal helpers needed for DB and JSON. Adding a state means touching both the `iota` block and the `names` array.

**When NOT:** Low-QPS workflows (orders, support tickets) where the state changes a handful of times per entity lifetime. String FSMs are perfectly fine there — the readability wins.
</details>

---

## 5. Exercise 4 — Per-transition log allocations

Logging each transition with `log.Printf("from %s to %s", from, to)` builds the formatted message and allocates a string *even when* the log handler would filter it out.

**Before:**

```go
func (m *Machine) Transition(next State) {
    log.Printf("transition: from=%s to=%s machine=%s",
        m.state.Name(), next.Name(), m.ID)
    m.state = next
}
```

```
BenchmarkLogfTransition-8    2000000    620 ns/op    192 B/op    5 allocs/op
```

<details><summary>After</summary>

Use `slog.LogAttrs` with typed attribute values. `slog` skips attribute construction when the level/handler isn't interested.

```go
import "log/slog"

func (m *Machine) Transition(next State) {
    slog.LogAttrs(context.Background(), slog.LevelDebug,
        "transition",
        slog.String("from", m.state.Name()),
        slog.String("to", next.Name()),
        slog.String("machine", m.ID),
    )
    m.state = next
}
```

When the level is disabled:

```
BenchmarkSlogTransitionOff-8    100000000    11 ns/op    0 B/op    0 allocs/op
```

~56× faster when transitions are not being logged; about the same as `Printf` when they are.

**Why faster:** `slog.LogAttrs` checks `Enabled` before doing anything else. No `Sprintf`, no escaping, no allocation on the hot path.

**Trade-off:** `slog.Any(state)` for complex values still pays an interface conversion. For the absolute hot path, gate manually on a `if log.DebugEnabled()` check. Migrating an existing `log.Printf` codebase to `slog` is mechanical work.

**When NOT:** Always-on info/warn logs that must fire on every transition. There the cost is the message itself, not the formatting plumbing.
</details>

---

## 6. Exercise 5 — Mutex on every Send

A `sync.Mutex` around `Send` serializes event handling, which is correct but expensive for read-mostly inspection. Goroutines that only want to *read* `state` pay the mutex cost too.

**Before:**

```go
type Machine struct {
    mu    sync.Mutex
    state StateID
}

func (m *Machine) Send(ev EventID) {
    m.mu.Lock()
    m.state = table[m.state][ev]
    m.mu.Unlock()
}

func (m *Machine) State() StateID {
    m.mu.Lock()
    defer m.mu.Unlock()
    return m.state
}
```

```
BenchmarkMuRead-8         50000000    22 ns/op    0 B/op
BenchmarkMuReadContended-8 5000000    280 ns/op   0 B/op   // 16 goroutines
```

<details><summary>After</summary>

Hold the writer-side serialization with a mutex (or a single-goroutine event loop), but expose `State()` as an `atomic.Pointer[StateInfo]` load. Readers pay one atomic load — no lock, no contention.

```go
type StateInfo struct {
    ID        StateID
    EnteredAt time.Time
}

type Machine struct {
    mu    sync.Mutex                  // serializes writers
    cur   atomic.Pointer[StateInfo]   // readers load this
}

func (m *Machine) Send(ev EventID) {
    m.mu.Lock()
    defer m.mu.Unlock()
    s := m.cur.Load()
    next := table[s.ID][ev]
    if next == s.ID { return }
    m.cur.Store(&StateInfo{ID: next, EnteredAt: time.Now()})
}

func (m *Machine) State() StateID {
    return m.cur.Load().ID  // lock-free
}
```

```
BenchmarkAtomicRead-8           500000000    2.1 ns/op    0 B/op
BenchmarkAtomicReadContended-8  500000000    2.3 ns/op    0 B/op
```

~10× faster uncontended, ~120× faster under contention.

**Why faster:** Readers do a single atomic load. No mutex acquisition, no scheduler involvement, no cache-line ping-pong.

**Trade-off:** Each transition allocates a new `StateInfo`. For a high-write workload (millions of transitions/sec) the allocation outweighs the read savings — keep the plain mutex there. Snapshot semantics: a reader may observe a state that has *just* changed, but that's true of the mutex form too the instant after `Unlock`.

**When NOT:** Write-heavy FSMs where most goroutines call `Send`, not `State`. Cases where reads are rare and writes are the contended path — keep the simple mutex.
</details>

---

## 7. Exercise 6 — Per-state struct allocated each transition

The classic GoF form returns `Paid{}` or `Shipped{}` from each transition — fresh value each time. If the state struct has fields or is held as an interface, that's an allocation per transition.

**Before:**

```go
type State interface { Tick(*Machine, Event) State; Name() string }

type Pending struct{}
func (Pending) Name() string { return "pending" }
func (Pending) Tick(m *Machine, ev Event) State {
    if ev == EvPay { return Paid{} }
    return Pending{}
}

type Paid struct{}
func (Paid) Name() string { return "paid" }
func (Paid) Tick(m *Machine, ev Event) State {
    if ev == EvShip { return Shipped{} }
    return Paid{}
}
// ...
```

Empty structs are zero-size, but assigning to an `interface` field still boxes:

```
BenchmarkStateAlloc-8    10000000    115 ns/op    16 B/op    1 allocs/op
```

<details><summary>After</summary>

Construct a singleton instance of each state type at startup. Refer to it everywhere. The interface value carries an itab + a pointer to the singleton — no allocation per transition.

```go
var (
    pendingS  State = &Pending{}
    paidS     State = &Paid{}
    shippedS  State = &Shipped{}
    cancelled State = &Cancelled{}
)

type Pending struct{}
func (*Pending) Name() string { return "pending" }
func (*Pending) Tick(m *Machine, ev Event) State {
    if ev == EvPay { return paidS }
    return pendingS
}
```

```
BenchmarkStateSingleton-8    30000000    38 ns/op    0 B/op    0 allocs/op
```

~3× faster, zero allocations per transition.

**Why faster:** The interface value points to a long-lived heap object that was allocated once at init. Returning `paidS` is a pointer copy, not a boxing operation.

**Trade-off:** States must be stateless (no per-instance fields). All shared data lives on the `Machine` ("blackboard" pattern). If you need per-state data (a timer, a substate), you can't use a singleton — go back to per-transition allocation or store the data on the Machine.

**When NOT:** States that genuinely carry per-transition data (parser tokens carrying position, AI agent states with timers). Don't fake-share fields across goroutines just to save an alloc.
</details>

---

## 8. Exercise 7 — DB write per transition

Persisting the state after each transition is the safe default — if the process crashes, the FSM resumes correctly. But for a high-throughput FSM (order pipeline pumping 10k events/sec) one DB roundtrip per transition becomes the bottleneck.

**Before:**

```go
func (m *Machine) Send(ev Event) error {
    next, ok := transition(m.state, ev)
    if !ok { return errInvalid }
    m.state = next
    return m.db.Exec(
        "UPDATE orders SET status=$1, updated_at=$2 WHERE id=$3",
        next, time.Now(), m.ID,
    )
}
```

```
BenchmarkDBPerTransition-8    2000    580000 ns/op   // ~580µs roundtrip
```

<details><summary>After</summary>

Batch transitions. Buffer up to N changes in memory and flush every K transitions or every T milliseconds, whichever comes first. Use a background pump (see Command pattern Exercise 12).

```go
type Checkpointer struct {
    db       *sql.DB
    buf      []checkpoint
    mu       sync.Mutex
    wake     chan struct{}
    interval time.Duration
}

type checkpoint struct {
    ID    string
    State StateID
    At    time.Time
}

func (c *Checkpointer) Record(id string, s StateID) {
    c.mu.Lock()
    c.buf = append(c.buf, checkpoint{id, s, time.Now()})
    needFlush := len(c.buf) >= 100
    c.mu.Unlock()
    if needFlush {
        select { case c.wake <- struct{}{}: default: }
    }
}

func (c *Checkpointer) Pump(ctx context.Context) {
    t := time.NewTicker(c.interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done(): c.flush(); return
        case <-t.C:
        case <-c.wake:
        }
        c.flush()
    }
}

func (c *Checkpointer) flush() {
    c.mu.Lock()
    batch := c.buf
    c.buf = c.buf[:0]
    c.mu.Unlock()
    if len(batch) == 0 { return }
    // single multi-row UPDATE or COPY
    bulkUpdate(c.db, batch)
}
```

```
BenchmarkBatchedCheckpoint-8    1000000    1100 ns/op   // amortised per Send
```

~500× faster on the request path.

**Why faster:** Network roundtrips amortize across the batch. One commit instead of N commits. The DB processes a single multi-row statement instead of N individual ones.

**Trade-off:** A crash between two flushes loses the most recent in-memory transitions. For payments / financial state, this is unacceptable — keep the synchronous write or use a transactional outbox. For ephemeral or recoverable state (game match, IoT device session) the 100ms window is fine.

**When NOT:** Anything where "exactly one persisted transition per event" is a correctness requirement. Banking, healthcare, audit-critical workflows. Use Temporal/Cadence or the transactional outbox instead.
</details>

---

## 9. Exercise 8 — Reflection-based transition lookup

Some FSM libraries identify the current state by `reflect.TypeOf(state)` and look up the transition table that way. Reflection is slow and forces every state into an interface boxing.

**Before:**

```go
type State interface{}

func (m *Machine) Send(ev Event) error {
    t := reflect.TypeOf(m.state)
    handlers, ok := transitions[t]
    if !ok { return errInvalid }
    next, ok := handlers[ev]
    if !ok { return errInvalid }
    m.state = next
    return nil
}
```

```
BenchmarkReflectFSM-8    3000000    420 ns/op    24 B/op    2 allocs/op
```

<details><summary>After</summary>

Use a typed `iota` enum keyed directly. No reflection, no interface boxing, no allocation.

```go
type StateID uint8
type EventID uint8

var table [nStates][nEvents]StateID

func (m *Machine) Send(ev EventID) error {
    next := table[m.state][ev]
    if next == sInvalid { return errInvalid }
    m.state = next
    return nil
}
```

```
BenchmarkEnumFSM-8    300000000    3.8 ns/op    0 B/op    0 allocs/op
```

~110× faster.

**Why faster:** `reflect.TypeOf` walks runtime type info, hashes the type, allocates a `reflect.Type` header in some paths. Replacing it with an integer index eliminates every one of those steps.

**Trade-off:** Loses the "state is a type" introspection. Loses easy registration of new states from outside the package — the `iota` block is closed.

**When NOT:** Plugin-style FSMs where third-party code adds new states at runtime. There, reflection or interfaces is the only option.
</details>

---

## 10. Exercise 9 — Long Enter/Exit hooks blocking the event loop

If `Enter` does heavy work (publish to Kafka, write to DB, render a UI), `Send` blocks until it returns. The FSM throughput collapses to the slowest hook.

**Before:**

```go
type Paid struct{}

func (Paid) Enter(m *Machine) {
    m.publishEvent("order.paid", m.ID)   // 50ms network
    m.notifyEmail(m.ID)                  // 200ms SMTP
    m.startShippingTimer(m)              // 1ms — but blocked behind the above
}

func (m *Machine) Send(ev Event) {
    next := transition(m.state, ev)
    m.state.Exit(m)
    m.state = next
    m.state.Enter(m)   // blocks the caller for ~250ms
}
```

```
BenchmarkSlowEnter-8    4    250000000 ns/op
```

<details><summary>After</summary>

Split Enter into "must complete synchronously" (timers, in-process invariants) and "fire-and-forget side effects" (notifications, audit publishes). Push the latter to a worker pool.

```go
type sideEffect func()

type Machine struct {
    state    StateID
    effects  chan sideEffect
}

func (m *Machine) emit(fn sideEffect) {
    select {
    case m.effects <- fn:
    default:
        // pool full — log and drop, or apply backpressure
    }
}

func (m *Machine) workerLoop() {
    for fn := range m.effects {
        fn()
    }
}

func enterPaid(m *Machine) {
    // synchronous: must complete before next event is handled
    m.startShippingTimer()

    // async: fire and forget
    id := m.ID
    m.emit(func() { m.publishEvent("order.paid", id) })
    m.emit(func() { m.notifyEmail(id) })
}
```

```
BenchmarkSplitEnter-8    1000000    1200 ns/op   // Send returns immediately
```

~200,000× faster on the `Send` path; worker pool catches up in the background.

**Why faster:** The FSM-driving goroutine stops waiting on I/O. Throughput is now bounded by table lookup, not by network latency.

**Trade-off:** Side effects may fire after the state has changed again. You lose the "this hook ran for *this* state, not the next one" simplicity — closures must capture the snapshot they need. Crash before the worker drains loses queued side effects.

**When NOT:** Side effects that *must* be visible before the next event is processed (security checks, "no transitions until DB confirms"). Stay synchronous there.
</details>

---

## 11. Exercise 10 — Persisting full event history when snapshot suffices

Event-sourced FSMs replay history on load to reconstruct state. For a long-lived entity (multi-year subscription), replaying 50,000 events on every load is slow.

**Before:**

```go
func Load(id string) (*Machine, error) {
    var m Machine
    rows, _ := db.Query("SELECT event FROM events WHERE id=$1 ORDER BY seq", id)
    defer rows.Close()
    for rows.Next() {
        var ev Event
        rows.Scan(&ev)
        m.apply(ev)
    }
    return &m, nil
}
```

```
BenchmarkReplayFullHistory-8    10    120000000 ns/op   // 50K events
```

<details><summary>After</summary>

Snapshot every K events (e.g. 1000). On load, restore from the latest snapshot and replay only the tail.

```go
func Load(id string) (*Machine, error) {
    var snap Snapshot
    err := db.QueryRow(
        "SELECT seq, state FROM snapshots WHERE id=$1 ORDER BY seq DESC LIMIT 1",
        id,
    ).Scan(&snap.Seq, &snap.State)
    if err != nil && err != sql.ErrNoRows {
        return nil, err
    }

    m := &Machine{state: snap.State}
    rows, _ := db.Query(
        "SELECT event FROM events WHERE id=$1 AND seq>$2 ORDER BY seq",
        id, snap.Seq,
    )
    defer rows.Close()
    for rows.Next() {
        var ev Event
        rows.Scan(&ev)
        m.apply(ev)
    }
    return m, nil
}

// Background snapshotter
func (m *Machine) maybeSnapshot() {
    if m.eventsSinceSnapshot < 1000 { return }
    db.Exec("INSERT INTO snapshots (id, seq, state) VALUES ($1, $2, $3)",
        m.ID, m.seq, m.state)
    m.eventsSinceSnapshot = 0
}
```

```
BenchmarkReplayFromSnapshot-8    500    2400000 ns/op   // ~500 tail events
```

~50× faster on load.

**Why faster:** You replay 500 events instead of 50,000. The snapshot is one row, decoded once. Database I/O scales linearly with tail length, not total history.

**Trade-off:** Snapshot table to maintain. Snapshots may go stale if the projection logic changes — you may need to invalidate and rebuild. Storage cost for snapshots (usually small compared to events themselves).

**When NOT:** Short-lived workflows (max ~100 events per entity). Audit-required systems where every replay must touch every event for legal reasons.
</details>

---

## 12. Exercise 11 — Per-event JSON encoding for the audit log

Each transition writes a row to an audit table. The audit row is encoded as JSON for forward-compatibility. At high event rates, JSON encoding dominates.

**Before:**

```go
type AuditRow struct {
    MachineID string
    From      string
    To        string
    Event     string
    At        time.Time
    Data      map[string]any
}

func auditEncode(r AuditRow) []byte {
    b, _ := json.Marshal(r)
    return b
}
```

```
BenchmarkJSONAudit-8    500000    3200 ns/op    640 B/op    12 allocs/op
```

<details><summary>After</summary>

Switch to a binary format with a generated codec. Protobuf or msgpack. The audit reader on the cold path can still decode it; the FSM hot path doesn't carry the reflection cost.

```go
import "google.golang.org/protobuf/proto"

func auditEncode(r *pb.AuditRow) []byte {
    b, _ := proto.Marshal(r)
    return b
}
```

```
BenchmarkProtoAudit-8    3000000    410 ns/op    96 B/op    2 allocs/op
```

~8× faster, ~7× less memory churn.

**Why faster:** Generated code knows the field layout. No reflection, no string scanning, no escape handling. Wire format is more compact, so the downstream sink (Kafka, S3) also writes less.

**Trade-off:** Schema must be defined ahead of time. Forward compatibility requires discipline (optional fields, never reuse field numbers). Auditors can no longer eyeball the row in `psql` — they need a decoder.

**When NOT:** Low-volume audit. Cases where human inspection of raw rows is the audit. Multi-language ecosystems where one consumer can't run a protobuf decoder.
</details>

---

## 13. Exercise 12 — Synchronous side effects in actions

A transition action ("on entering Paid, charge the card") that does the work inline blocks the FSM until the downstream system responds. Worse, if the downstream fails, the FSM is stuck — did the transition happen or not?

**Before:**

```go
func (m *Machine) Send(ev Event) error {
    next := transition(m.state, ev)
    if next == SPaid {
        if err := m.stripe.Charge(m.OrderID, m.Amount); err != nil {
            return err   // FSM half-transitioned; rollback ambiguous
        }
    }
    m.state = next
    return nil
}
```

```
BenchmarkSyncCharge-8    1000    1200000 ns/op
```

<details><summary>After</summary>

Make the transition pure (no I/O). Emit a `Command` describing the work; let a separate component execute it asynchronously. The FSM keeps moving; the command executor reports back via another event.

```go
type Command struct {
    Kind    CommandKind
    Payload []byte
}

func (m *Machine) Send(ev Event) ([]Command, error) {
    next := transition(m.state, ev)
    if next == sInvalid {
        return nil, errInvalid
    }

    var cmds []Command
    if next == SPaid {
        cmds = append(cmds, Command{Kind: CmdCharge, Payload: marshalCharge(m.OrderID, m.Amount)})
    }
    m.state = next
    return cmds, nil
}

// Command executor (separate goroutine, retry-loop, idempotent)
func (e *Executor) Run(ctx context.Context) {
    for cmd := range e.in {
        if err := e.execute(ctx, cmd); err != nil {
            e.retry(cmd)
        } else {
            e.machine.Send(EvChargeOK)   // feeds back into the FSM
        }
    }
}
```

```
BenchmarkAsyncCharge-8    300000    4200 ns/op   // FSM Send only
```

~285× faster on the FSM path. Wall-clock to "money charged" is unchanged — but the FSM is no longer blocked.

**Why faster:** The FSM does in-memory state-table work and returns. Network calls happen on a separate goroutine that doesn't share the FSM lock.

**Trade-off:** Two-phase model. The FSM has intermediate states ("charging", "shipped-pending-confirmation") that didn't exist before. Failure handling moves out of `Send` into a dedicated retry/compensate path. Easier to reason about long-term, harder to wire up the first time.

**When NOT:** Tiny, in-process workflows with no I/O. Cases where caller genuinely needs synchronous confirmation that the downstream succeeded before returning HTTP 200.
</details>

---

## 14. When NOT to optimize

Most State-pattern code is fine.

- A finite-state machine driving an HTTP request lifecycle changes states a few times per request. The dispatch cost is dwarfed by I/O.
- A workflow engine (orders, subscriptions) transitions a handful of times per entity per day. Throughput is in events-per-second, not millions-per-second.
- A CLI tool with a parser FSM runs once per invocation. Allocations are noise.

**Profile first.** `go test -bench`, `pprof`, `trace`. If FSM dispatch or transition cost isn't in the top 5 of CPU or allocations, leave it alone.

**Common premature optimizations to avoid:**
- Replacing every interface-state FSM with an `iota` + 2-D table because "interfaces are slow." For a 5-state workflow you've added 200 lines and made the rules harder to read.
- `atomic.Pointer` on an FSM whose state changes once per business transaction.
- Snapshotting an event-sourced FSM that has 30 events per entity lifetime.
- Batching DB writes on a payments FSM where correctness requires one-commit-per-transition.

The wins above are real at scale (network protocols, game ticks, exchanges, IoT fleet management). They are noise at small scale (most CRUD apps).

---

## 15. Summary

**Always-ship wins** (zero downside in production code):
- Use typed `iota` state IDs over `string` state names internally (Exercise 3).
- Build transition lookup as a `map` or 2-D array, not a linear slice scan (Exercise 2).
- Reuse singleton state instances instead of allocating per transition (Exercise 6).
- Use `slog.LogAttrs` for level-gated transition logging (Exercise 4).

**Wins behind a profile** (do these when measurements justify them):
- Drop interface dispatch for fixed, hot, in-process FSMs (Exercise 1).
- `atomic.Pointer[StateInfo]` for read-mostly state inspection (Exercise 5).
- Split Enter/Exit hooks into sync core + async side-effect pool (Exercise 9).
- Batch DB checkpoints across transitions (Exercise 7).
- Async commands instead of synchronous side effects in actions (Exercise 12).

**Specialty** (only apply when the design genuinely allows it):
- Snapshot every K events for event-sourced FSMs with long histories (Exercise 10).
- Binary (proto/msgpack) audit encoding for high-volume transition logs (Exercise 11).
- Drop reflection-based dispatch for typed enum lookup (Exercise 8).

State in Go is fast enough by default. Each optimization here trades one of: code clarity, debuggability, or generality. Make the trade only when the profiler points at it.

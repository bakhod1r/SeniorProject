# Command Pattern — Optimization

## 1. How to use this file

Twelve scenarios where Command-pattern code is slower than it needs to be. Each:

- **Scenario** — the issue.
- **Before** — code + benchmark.
- **After** (collapsible) — optimized code + benchmark + why faster + trade-offs + when NOT.

Anchored at Go 1.23, amd64. Benchmark numbers are reproducible-shape — run `go test -bench` on your hardware before quoting them.

---

## 2. Exercise 1 — Closure-per-job allocation

A producer dispatches jobs by building a fresh `func()` closure that captures the payload. Each closure escapes to the heap.

**Before:**

```go
type Job func() error

func Enqueue(q chan<- Job, payload Payload) {
    q <- func() error {
        return process(payload) // captures payload → heap alloc
    }
}
```

```
BenchmarkClosureJob-8    5000000    240 ns/op    64 B/op    2 allocs/op
```

<details><summary>After</summary>

Use a typed struct dispatched through a registry. The struct sits on the stack until the channel send, with no extra closure.

```go
type Job struct {
    Kind    uint8
    Payload Payload
}

const (
    KindProcess uint8 = iota
    KindRefund
)

var handlers = [...]func(Payload) error{
    KindProcess: process,
    KindRefund:  refund,
}

func Enqueue(q chan<- Job, p Payload) {
    q <- Job{Kind: KindProcess, Payload: p}
}
```

```
BenchmarkStructJob-8    20000000    65 ns/op    0 B/op    0 allocs/op
```

~3.7× faster, zero allocations.

**Why faster:** No closure, no heap escape. Dispatch is an array index, not an indirect call through a function value.

**Trade-off:** Adding a job type means a constant + handler-array entry. The closure form is just a lambda.

**When NOT:** A handful of one-off jobs in a CLI or batch script — the alloc savings are noise.
</details>

---

## 3. Exercise 2 — Interface dispatch in tight loops

`type Command interface { Execute() error }` reads cleanly but every call goes through an itab lookup. In an in-process loop running millions of commands per second, that's measurable.

**Before:**

```go
type Command interface {
    Execute() error
}

type Add struct{ a, b int; out *int }
func (c *Add) Execute() error { *c.out = c.a + c.b; return nil }

func RunAll(cmds []Command) {
    for _, c := range cmds {
        _ = c.Execute()
    }
}
```

```
BenchmarkIfaceDispatch-8    300000    4200 ns/op    (1000 cmds/iter)
```

<details><summary>After</summary>

When the command set is small and fixed, drop the interface and call the concrete method directly:

```go
type Add struct{ a, b int; out *int }
func (c *Add) Run() { *c.out = c.a + c.b }

func RunAll(cmds []Add) {
    for i := range cmds {
        cmds[i].Run()
    }
}
```

```
BenchmarkConcrete-8    1200000    980 ns/op    (1000 cmds/iter)
```

~4.3× faster.

**Why faster:** The compiler inlines `Run` into the loop. No itab, no indirect call. Sequential `Add` structs are cache-friendly too.

**Trade-off:** Lose polymorphism. A new command type means a new loop or a tagged union.

**When NOT:** Cross-boundary command buses (RPC, queue) where dispatch by type *is* the point. Or when dispatch cost is dwarfed by I/O inside `Execute`.
</details>

---

## 4. Exercise 3 — JSON serialization in the hot path

A worker pulls jobs off Redis as JSON and decodes them per task. `encoding/json` uses reflection on every call.

**Before:**

```go
type EmailJob struct {
    To, Subject, Body string
}

func handle(raw []byte) error {
    var j EmailJob
    if err := json.Unmarshal(raw, &j); err != nil {
        return err
    }
    return send(j)
}
```

```
BenchmarkJSONDecode-8    300000    4100 ns/op    480 B/op    9 allocs/op
```

<details><summary>After</summary>

Use msgpack (or protobuf if both sides own the schema). Binary formats skip reflection and string scanning.

```go
import "github.com/vmihailenco/msgpack/v5"

func handle(raw []byte) error {
    var j EmailJob
    if err := msgpack.Unmarshal(raw, &j); err != nil {
        return err
    }
    return send(j)
}
```

```
BenchmarkMsgpackDecode-8    1500000    790 ns/op    96 B/op    3 allocs/op
```

~5× faster, ~5× less memory.

**Why faster:** No string scanning, no escape decoding. Protobuf is even faster — generated code knows the field layout and skips reflection entirely.

**Trade-off:** Loses human-readable payloads (`redis-cli MONITOR` becomes useless). Schema drift between producer and consumer is harder to debug.

**When NOT:** Low-QPS queues where humans inspect payloads regularly. Cross-language ecosystems where every consumer would need a msgpack library.
</details>

---

## 5. Exercise 4 — Unbuffered command channel

An unbuffered channel means every `Enqueue` blocks until a worker is ready — a context switch per job.

**Before:**

```go
jobs := make(chan Job) // unbuffered

for i := 0; i < N; i++ {
    jobs <- Job{ID: i}
}
```

```
BenchmarkUnbuffered-8    500000    2400 ns/op
```

<details><summary>After</summary>

Buffer the channel. A size of 1024 (or a small multiple of GOMAXPROCS × expected burst) lets the producer write several jobs before blocking.

```go
jobs := make(chan Job, 1024)

for i := 0; i < N; i++ {
    jobs <- Job{ID: i}
}
```

```
BenchmarkBuffered1024-8    5000000    230 ns/op
```

~10× faster.

**Why faster:** Fewer goroutine wakeups. The scheduler doesn't park-unpark the producer per send; the consumer drains several jobs per wake-up.

**Trade-off:** Up to 1024 jobs in flight when the process dies — lost unless persisted before send. Memory scales with buffer × job size.

**When NOT:** Backpressure tightly coupled to consumer speed (real-time systems, bounded latency contracts). Huge jobs where 1024 of them won't fit.
</details>

---

## 6. Exercise 5 — Channel-per-command-type dispatch overhead

A bus dispatches commands using a switch with `reflect.TypeOf(cmd)`. Reflection plus 50 sequential cases per dispatch is slow.

**Before:**

```go
func (b *Bus) Send(cmd any) error {
    switch reflect.TypeOf(cmd) {
    case reflect.TypeOf(CreateOrder{}):
        return handleCreateOrder(cmd.(CreateOrder))
    case reflect.TypeOf(CancelOrder{}):
        return handleCancelOrder(cmd.(CancelOrder))
    // ... 48 more cases
    }
    return errUnknown
}
```

```
BenchmarkSwitchReflect-8    1000000    1180 ns/op    16 B/op    1 allocs/op
```

<details><summary>After</summary>

Build a `map[reflect.Type]Handler` once at startup, guarded by an `RWMutex` for late registration. Dispatch is a single hash lookup.

```go
type Handler func(any) error

type Bus struct {
    mu       sync.RWMutex
    handlers map[reflect.Type]Handler
}

func (b *Bus) Register(cmd any, h Handler) {
    b.mu.Lock()
    b.handlers[reflect.TypeOf(cmd)] = h
    b.mu.Unlock()
}

func (b *Bus) Send(cmd any) error {
    b.mu.RLock()
    h, ok := b.handlers[reflect.TypeOf(cmd)]
    b.mu.RUnlock()
    if !ok {
        return errUnknown
    }
    return h(cmd)
}
```

```
BenchmarkMapDispatch-8    5000000    240 ns/op    0 B/op    0 allocs/op
```

~5× faster, zero allocations.

**Why faster:** O(1) map lookup replaces O(n) switch cases. If all handlers register at boot, swap the mutex for `atomic.Pointer[map[...]...]` for lock-free reads.

**Trade-off:** Slight lock cost on hot paths until you go atomic.

**When NOT:** Tiny dispatch tables (3-4 types) — the switch is faster than a map lookup. Crossover is around 8-10 types.
</details>

---

## 7. Exercise 6 — Saga compensation runs sequentially when parallelizable

A saga rolls back compensations one at a time. If the compensations touch independent resources, they can run in parallel.

**Before:**

```go
func rollback(ctx context.Context, done []Op) {
    for i := len(done) - 1; i >= 0; i-- {
        _ = done[i].Undo(ctx)
    }
}
```

5 compensations × 200ms each = 1000ms wall clock.

<details><summary>After</summary>

Run independent compensations in parallel. **Safety condition is non-trivial — only commutative, independent steps can go in parallel.** Production sagas mark each `Op` with an explicit `Parallel bool` flag.

```go
func rollback(ctx context.Context, done []Op) {
    var wg sync.WaitGroup
    for i := len(done) - 1; i >= 0; i-- {
        op := done[i]
        if op.Parallel {
            wg.Add(1)
            go func() {
                defer wg.Done()
                _ = op.Undo(ctx)
            }()
        } else {
            wg.Wait() // serialize around non-parallel steps
            _ = op.Undo(ctx)
        }
    }
    wg.Wait()
}
```

5 compensations in parallel = ~200ms wall clock. ~5× faster.

**Why faster:** I/O-bound undos overlap. Wall clock is bounded by the slowest, not the sum.

**Trade-off:** Concurrency is correct only when undos commute. "Refund payment" and "release inventory" are independent; "credit A" and "debit A" are not. Get it wrong in production and you produce inconsistent state.

**When NOT:** Undos share resources. Ordering matters (write-then-delete chains). Fewer than 3 steps — overhead exceeds savings.
</details>

---

## 8. Exercise 7 — Heap-allocated command structs

A high-QPS command bus allocates a new command struct per request. Short-lived, but it still pressures the GC.

**Before:**

```go
type ProcessOrder struct {
    OrderID string
    UserID  string
    Items   []Item
    Total   decimal.Decimal
}

func handle(w http.ResponseWriter, r *http.Request) {
    cmd := &ProcessOrder{
        OrderID: r.FormValue("order"),
        UserID:  r.FormValue("user"),
    }
    bus.Send(cmd)
}
```

```
BenchmarkAllocCmd-8    500000    2200 ns/op    320 B/op    4 allocs/op
```

<details><summary>After</summary>

Pool the command structs. Zero on return.

```go
var orderPool = sync.Pool{
    New: func() any { return &ProcessOrder{} },
}

func handle(w http.ResponseWriter, r *http.Request) {
    cmd := orderPool.Get().(*ProcessOrder)
    defer func() {
        *cmd = ProcessOrder{} // zero the fields
        orderPool.Put(cmd)
    }()
    cmd.OrderID = r.FormValue("order")
    cmd.UserID = r.FormValue("user")
    bus.Send(cmd)
}
```

```
BenchmarkPooledCmd-8    2000000    540 ns/op    32 B/op    1 allocs/op
```

~4× faster, ~10× less memory churn.

**Why faster:** GC doesn't see the allocations. `sync.Pool` keeps a per-P local cache, so `Get` is usually a single load.

**Trade-off:** Forget to zero and you leak data across requests — a classic source of cross-request bugs. Pool keeps the largest-ever struct sizes alive, bad if payload sizes vary wildly.

**When NOT:** Low-QPS endpoints. Commands that escape into long-lived contexts (queues, async pipelines) — you don't know when to put them back.
</details>

---

## 9. Exercise 8 — Generic command bus monomorphization

Go generics monomorphize *only* for concrete types. Call `Send[any](bus, cmd)` and the type parameter is `any` — an interface — so the compiler produces a single boxed implementation. You lose the speed advantage.

**Before:**

```go
func Send[T any](bus *Bus, ctx context.Context, cmd T) error {
    return bus.dispatch(ctx, cmd)
}

var cmd any = CreateOrder{...}
Send(bus, ctx, cmd) // T = any → boxed
```

```
BenchmarkGenericBoxed-8    2000000    480 ns/op    48 B/op    2 allocs/op
```

<details><summary>After</summary>

Call with the concrete type so the compiler specializes.

```go
cmd := CreateOrder{...}
Send(bus, ctx, cmd) // T = CreateOrder → specialized

// Or be explicit:
Send[CreateOrder](bus, ctx, cmd)
```

```
BenchmarkGenericConcrete-8    10000000    105 ns/op    0 B/op    0 allocs/op
```

~4.5× faster, no allocations.

**Why faster:** The compiler emits a specialized `Send` that takes `CreateOrder` directly. No interface conversion, no method-table lookup on the common path. The function can be inlined.

**Trade-off:** Code size grows per instantiation (Go uses GC-shape stenciling, so the explosion is bounded but real). When dispatch genuinely needs to be heterogeneous, you're back to interface-typed parameters.

**When NOT:** A bus that genuinely accepts heterogeneous types (CQRS dispatcher) cannot specialize. There, the interface call is the design.
</details>

---

## 10. Exercise 9 — Logging per command at debug level

Even when debug is disabled, building the log line — formatting arguments, allocating the message — happens at the call site.

**Before:**

```go
func (b *Bus) Send(cmd Command) error {
    log.Debug(fmt.Sprintf("dispatching %s: %+v", cmd.Name(), cmd))
    return b.dispatch(cmd)
}
```

`fmt.Sprintf` runs every call, even if debug is off.

```
BenchmarkEagerLog-8    2000000    580 ns/op    160 B/op    4 allocs/op
```

<details><summary>After</summary>

Use `slog.LogAttrs` so attributes are only formatted if the level is enabled:

```go
import "log/slog"

func (b *Bus) Send(cmd Command) error {
    slog.LogAttrs(context.Background(), slog.LevelDebug,
        "dispatching command",
        slog.String("name", cmd.Name()),
        slog.Any("cmd", cmd),
    )
    return b.dispatch(cmd)
}
```

`slog` skips attribute construction when the handler's `Enabled` returns false.

```
BenchmarkSlogDebug-8    50000000    25 ns/op    0 B/op    0 allocs/op
```

~23× faster when debug is off, zero allocations.

**Why faster:** No `Sprintf`, no string allocation. The level check is a sub-nanosecond atomic load.

**Trade-off:** `slog.Any(cmd)` still pays a small cost for the interface conversion of `cmd`. For absolute hot paths, gate manually on a `log.DebugEnabled()` check.

**When NOT:** Info/error level that always runs. Low-QPS paths where 580ns is fine.
</details>

---

## 11. Exercise 10 — Retry backoff without jitter

When a downstream service flaps, every retrying client wakes at exactly the same exponential intervals and slams the recovering service simultaneously — a thundering herd.

**Before:**

```go
func retry(ctx context.Context, do func() error) error {
    base := 100 * time.Millisecond
    for attempt := 0; attempt < 5; attempt++ {
        if err := do(); err == nil {
            return nil
        }
        time.Sleep(base << attempt)
    }
    return errTooMany
}
```

Under a service blip, 10,000 clients all sleep 100ms, then 200ms, then 400ms — and hit the service at each boundary.

<details><summary>After</summary>

Add jitter. Each client picks a random offset in `[0, base*2^attempt)` (the "full jitter" formula from AWS):

```go
func retry(ctx context.Context, do func() error) error {
    base := 100 * time.Millisecond
    for attempt := 0; attempt < 5; attempt++ {
        if err := do(); err == nil {
            return nil
        }
        max := base << attempt
        sleep := time.Duration(rand.Int63n(int64(max)))
        select {
        case <-time.After(sleep):
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return errTooMany
}
```

**The win is on the server side.** Under simulated flap, the recovering service's peak inbound RPS drops ~4–10× because clients spread across the retry window instead of bunching at exact boundaries.

**Why faster (for the cluster):** Load spreads instead of pulsing. The recovering service doesn't get re-killed by the synchronized retry wave.

**Trade-off:** An individual request can take longer than the deterministic schedule's value. The cluster wins; an individual request might lose.

**When NOT:** Isolated retries (a single CLI client). When downstream's per-tenant rate limiting already de-synchronizes you.
</details>

---

## 12. Exercise 11 — Reflect-based dispatch on every send

Even with Exercise 5's map dispatch, every `Send` calls `reflect.TypeOf` and hashes it. For commands sent from a known call site, that work can be cached.

**Before:**

```go
func (b *Bus) Send(cmd any) error {
    b.mu.RLock()
    h := b.handlers[reflect.TypeOf(cmd)]
    b.mu.RUnlock()
    return h(cmd)
}

// Hot loop:
for _, order := range orders {
    bus.Send(order)
}
```

```
BenchmarkReflectSend-8    5000000    230 ns/op    0 B/op
```

<details><summary>After</summary>

When the type is known at compile time, expose a typed wrapper that closes over the handler once:

```go
type TypedBus[T any] struct {
    handler func(T) error
}

func TypedFor[T any](b *Bus) *TypedBus[T] {
    var zero T
    h := b.handlers[reflect.TypeOf(zero)]
    return &TypedBus[T]{handler: func(cmd T) error { return h(cmd) }}
}

func (t *TypedBus[T]) Send(cmd T) error {
    return t.handler(cmd)
}

// Setup once:
orderBus := TypedFor[Order](bus)

// Hot loop:
for _, order := range orders {
    orderBus.Send(order)
}
```

```
BenchmarkTypedSend-8    50000000    18 ns/op    0 B/op
```

~12× faster.

**Why faster:** Reflection runs once when `TypedFor` is called. The hot loop is a direct call through a closed-over function pointer — no map lookup, no `reflect.TypeOf`, no mutex.

**Trade-off:** Each wrapper is an allocation. Cache it in a long-lived field; don't create one per request or you've moved the cost.

**When NOT:** Mixed batches where the command type varies per call. One-shot dispatches.
</details>

---

## 13. Exercise 12 — Synchronous outbox flush

The transactional outbox writes a "to-publish" row in the same DB transaction as the business change, then publishes asynchronously. A naive implementation flushes synchronously on the request path.

**Before:**

```go
func HandleOrder(ctx context.Context, cmd CreateOrder) error {
    tx, _ := db.BeginTx(ctx, nil)
    if err := insertOrder(tx, cmd); err != nil {
        tx.Rollback()
        return err
    }
    if err := insertOutbox(tx, "order.created", cmd); err != nil {
        tx.Rollback()
        return err
    }
    if err := tx.Commit(); err != nil {
        return err
    }
    return flushOutbox(ctx) // blocks: read outbox, publish, delete
}
```

The request waits for Kafka publish + outbox cleanup. p99 latency is the *sum* of business work and publish work.

```
BenchmarkSyncOutbox-8    2000    580000 ns/op
```

<details><summary>After</summary>

Move the flush to a background pump that ticks every 10ms (or wakes on demand) and batches outbox rows.

```go
type Outbox struct {
    db   *sql.DB
    wake chan struct{}
}

func (o *Outbox) Pump(ctx context.Context) {
    t := time.NewTicker(10 * time.Millisecond)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
        case <-o.wake:
        }
        o.flushBatch(ctx, 100) // up to 100 rows per pump
    }
}

func HandleOrder(ctx context.Context, cmd CreateOrder) error {
    tx, _ := db.BeginTx(ctx, nil)
    if err := insertOrder(tx, cmd); err != nil {
        tx.Rollback()
        return err
    }
    if err := insertOutbox(tx, "order.created", cmd); err != nil {
        tx.Rollback()
        return err
    }
    if err := tx.Commit(); err != nil {
        return err
    }
    select { case outbox.wake <- struct{}{}: default: } // non-blocking nudge
    return nil
}
```

```
BenchmarkAsyncOutbox-8    50000    24000 ns/op
```

~24× faster on the request path.

**Why faster:** The request no longer waits for Kafka. The pump amortizes publish across many rows — one network roundtrip per batch instead of per command.

**Trade-off:** Events delayed by up to 10ms + batch publish time. Downstream sees within-partition ordering but with visible lag. You now own a background goroutine — monitoring, restart, clean shutdown.

**When NOT:** Caller needs synchronous confirmation that the event landed downstream (rare; usually bad design). Systems so low-QPS that the 10ms tick costs more than it saves.
</details>

---

## 14. When NOT to optimize

Most Command code is fine.

- A CLI runs a handful of commands. Dispatch cost is negligible compared to the actual work.
- A REST handler calling one downstream service is dominated by network time; 200ns of bus dispatch doesn't matter.
- A migration tool runs each command once and exits. There is no hot path.

**Profile first.** `go test -bench`, `pprof`, `trace`. If Command machinery isn't in the top 5 of CPU or allocations, leave it alone.

**Common premature optimizations to avoid:**
- Replacing every `func() error` with a typed struct because "interfaces are slow." For a 10-command CLI, you've added 200 lines for zero measurable benefit.
- `sync.Pool` for command structs sent at 10 RPS. Pool overhead exceeds the GC saving.
- Generics-monomorphized buses where the codebase actually has 50 command types — the dispatcher *must* be type-erased.
- Async outbox pumps in a system that runs 5 commands per minute.

The wins above are real at scale. They are noise at small scale.

---

## 15. Summary

**Always-ship wins** (zero downside in production code):
- Build chains and registries once at startup; don't reassemble per request (Exercises 1, 5).
- Buffer command channels appropriately (Exercise 4).
- Use `slog.LogAttrs` for level-gated debug logging (Exercise 9).
- Add jitter to retry backoff (Exercise 10).

**Wins behind a profile** (do these when measurements justify them):
- Drop interface dispatch for fixed, hot, in-process command sets (Exercise 2).
- Binary serialization (msgpack/proto) for high-QPS queues (Exercise 3).
- `sync.Pool` for high-QPS command structs (Exercise 7).
- Typed command-bus wrappers to skip reflection per call (Exercise 11).
- Background outbox pumps instead of synchronous flush (Exercise 12).

**Specialty** (only apply when the design genuinely allows it):
- Parallel saga compensations — only when the steps commute (Exercise 6).
- Monomorphized generic dispatchers — only when call sites use concrete types (Exercise 8).

Command in Go is fast enough by default. Each optimization here trades one of: code clarity, debuggability, or generality. Make the trade only when the profiler points at it.

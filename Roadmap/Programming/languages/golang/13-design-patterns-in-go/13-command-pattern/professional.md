# Command — Professional

> Focus: staff/principal-level decisions. Command as a system primitive across processes; cost in CPU and memory; behavior under load; behavior under partial failure; how Command intersects with queues, outboxes, sagas, tracing, and security. Opinionated where the field agrees, explicit about trade-offs where it does not.

---

## 1. Command as a system primitive

A Command is a value that names an intent and carries the data required to fulfill it. The pattern collapses several otherwise-different runtime mechanisms into one mental model:

| Mechanism | Where the command lives | Delivery guarantee | Latency | Failure model |
|---|---|---|---|---|
| In-process call | Stack / heap | Exactly once (no transport) | nanoseconds | Panic / returned error |
| RPC (gRPC, HTTP) | Network buffer | At-most-once unless retried | sub-ms to tens of ms | Network partition, timeout, partial application |
| Message-passing actor (Erlang, Akka) | Per-actor mailbox | At-most-once per send; ordered per sender | microseconds | Mailbox overflow, supervisor restart |
| Queued command (SQS, Kafka, NATS) | Broker storage | At-least-once typical; exactly-once only with idempotency keys | ms to seconds | Duplicate delivery, reordering, dead letter |
| Persisted log (Kafka compacted, EventStore) | Append-only log | At-least-once with offsets; replayable | ms | Consumer lag, replay storms |

The Command pattern is the same idea at every level: separate **what should happen** from **when, where, and how many times it actually happens**. The further the command travels, the less you can assume about its execution context. Read "Command" as "a request that will be executed by someone, sometime, possibly more than once, possibly never, possibly out of order." Every architectural choice downstream — idempotency, deduplication, ordering, retries, compensation — follows from where you draw the line between *enqueueing* a command and *executing* it.

---

## 2. Runtime cost analysis

The per-command CPU and allocation cost matters when you handle millions of commands per second on the data plane (request handlers, real-time systems) and is irrelevant on the control plane (deployments, configuration). Numbers below are Go 1.22, amd64, warm cache.

### 2.1 Closure form

```go
type Command func() error

func enqueue(work string) Command {
    return func() error { return process(work) }
}
```

Each call to `enqueue` builds a closure: a two-word value plus a heap-allocated **closure record** holding captured variables. For one captured string (16 bytes) plus the function pointer (8 bytes) plus header, the record is ~24-32 bytes and almost always escapes (`func literal escapes to heap` under `-gcflags="-m"`).

Cost per closure: **one heap allocation, ~30 ns including write barrier**. At 100k commands/sec, that's 3 MB/sec of garbage and ~3 ms/sec of CPU on the allocator. At 1M/sec it's ~30 MB/sec — enough to push the GC into shorter cycles and visibly hurt tail latency.

### 2.2 Struct form

```go
type ProcessWork struct{ Work string }

func (c ProcessWork) Execute() error { return process(c.Work) }
```

A `ProcessWork{Work: "x"}` literal is stack-allocatable when it doesn't escape; `ProcessWork{Work: "x"}.Execute()` is zero-allocation. Storing it in a `Command` interface slice does allocate — interface boxing copies non-pointer concrete values to the heap. A `*ProcessWork` avoids that allocation at the cost of an explicit pointer.

### 2.3 Interface dispatch

`cmd.Execute()` through `type Command interface{ Execute() error }` is an indirect call: two itab loads plus a register-indirect CALL. Branch-predictor-friendly when one concrete type dominates a hot loop (~1 ns); mixed types in one slice mispredict and add 3-5 ns per call.

### 2.4 Generic dispatch with monomorphization

```go
type Handler[C any] func(context.Context, C) error
type Bus[C any] struct{ h Handler[C] }
func (b Bus[C]) Send(ctx context.Context, c C) error { return b.h(ctx, c) }
```

For each concrete `C` actually used, the compiler emits a **GCShape-stenciled** instantiation. Same-shape types (all pointer-shaped) share a body and pass a per-call dictionary; different shapes get separate code. The dictionary load adds 1-2 ns per call. Generic dispatch beats interface dispatch only when the compiler can devirtualize at the call site (look for `inlining call` under `-gcflags="-m=2"`).

### 2.5 Serialization cost

When commands cross a process boundary, the per-command cost is dominated by serialization, not dispatch:

| Encoding | Encode | Decode | Size (typical) | Schema evolution |
|---|---|---|---|---|
| JSON (`encoding/json`) | ~800 ns - 1.5 µs | ~1-2 µs | 1.3x verbose | Loose, ad hoc |
| JSON (`jsoniter`, `sonic`) | ~200-400 ns | ~300-500 ns | same | same |
| Protobuf (`google.golang.org/protobuf`) | ~80-150 ns | ~80-150 ns | compact | Field numbers; safe additions |
| MessagePack | ~150-300 ns | ~150-300 ns | compact | Loose |
| Avro | ~150-300 ns | ~150-300 ns | compact | Schema registry required |
| gob | ~400-800 ns | ~400-800 ns | Go-only | Go-only |

At 1k commands/sec JSON is fine. At 100k+/sec protobuf is the right default. At 1M+/sec the encoder itself becomes a contention point and benefits from per-CPU buffer pools (`sync.Pool` of `bytes.Buffer`).

---

## 3. Backpressure and flow control

Every queued command system has a saturation point: producers create commands faster than consumers can drain them. What you do at that point determines whether the system degrades gracefully or fails catastrophically.

### 3.1 The unbounded channel anti-pattern

A `chan Command` with no size, or with a million slots, turns memory pressure into a hidden problem. The queue grows until OOM; producers see no backpressure signal; latency between enqueue and execute climbs from milliseconds to minutes; commands time out long before they run.

### 3.2 Bounded queue with backpressure

```go
type Bus struct {
    cmds chan Command
}

func New(capacity int) *Bus { return &Bus{cmds: make(chan Command, capacity)} }

func (b *Bus) Submit(ctx context.Context, c Command) error {
    select {
    case b.cmds <- c:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    default:
        return ErrQueueFull   // shed
    }
}
```

Choices when the queue is full:

| Strategy | Behavior | When to use |
|---|---|---|
| Block (no `default`) | Producer waits until slot frees | Synchronous backpressure across goroutines in same process |
| Drop oldest | Replace head | Real-time telemetry where stale data is useless |
| Drop newest | Reject incoming | When older work has higher value (FIFO with shedding) |
| Reject with error | Producer decides | API endpoints — return 503 with `Retry-After` |
| Spill to disk | Persist overflow | Mission-critical commands that must survive |

### 3.3 Priority queues and shedding by class

A single FIFO mixes user-visible commands (place order) with background commands (rebuild index). Saturation should shed the latter first. The typical structure is one bounded `chan Command` per class with a worker that drains higher-priority classes first via a layered `select`:

```go
func (b *Bus) next() Command {
    select {
    case c := <-b.queues[ClassCritical]: return c
    default:
    }
    select {
    case c := <-b.queues[ClassCritical]: return c
    case c := <-b.queues[ClassNormal]:   return c
    default:
    }
    return <-b.queues[ClassBackground]  // fallback blocks
}
```

Two-tier shedding is enough for most services: a Critical queue with bounded depth and a retry budget, plus a Best-Effort queue dropped first under load. Avoid more than 3-4 classes — operators cannot reason about more.

### 3.4 Sizing the worker pool

Pool size depends on the workload: pure CPU → `GOMAXPROCS` (or slightly less to leave room for GC); mixed → `GOMAXPROCS * (1 + waitFraction)`; pure I/O → capped by the downstream connection pool, not CPU. A common mistake is "100 goroutines per CPU because goroutines are cheap." They are cheap to create, but each one holds open a connection, a database slot, a memory buffer — the real limit is rarely the goroutine itself.

---

## 4. Distributed Command semantics

Once a command leaves the producer process, exactly-once delivery is unavailable. Pick one of:

| Model | Producer behavior | Consumer behavior | Implication |
|---|---|---|---|
| At-most-once | Fire and forget, no ack | May drop on crash | Lost commands acceptable (metrics, logs) |
| At-least-once | Retry until acked | Must be idempotent | Most queue systems default |
| Exactly-once (effective) | At-least-once delivery + dedup at consumer | Idempotency key + dedup store | Standard for payments, orders |

True end-to-end exactly-once is a marketing term; what you build is *at-least-once + idempotent consumer*, which is observably equivalent.

### 4.1 Idempotency keys

The command schema carries an `IdempotencyKey` chosen by the producer at the *intent boundary* — usually the inbound HTTP request:

```go
type RefundPayment struct {
    IdempotencyKey string    // chosen by client (Stripe-style) or derived from request hash
    PaymentID      string
    Amount         decimal.Decimal
    Reason         string
    IssuedAt       time.Time
}
```

The handler checks the key in a deduplication store before executing:

```go
func (h *Handler) Handle(ctx context.Context, c RefundPayment) error {
    seen, err := h.dedup.SetNX(ctx, "refund:"+c.IdempotencyKey, "1", 24*time.Hour)
    if err != nil { return fmt.Errorf("dedup: %w", err) }
    if !seen {
        return nil  // already processed
    }
    return h.refund(ctx, c)
}
```

Redis `SET key value NX EX ttl` is the canonical implementation: atomic test-and-set with TTL. The TTL is the **retry horizon** — longer than the longest plausible retry delay, shorter than memory budget allows.

### 4.2 The deduplication store contract

- **Atomicity**: SETNX must be atomic with respect to concurrent retries. Redis, DynamoDB conditional writes, and Postgres `INSERT ... ON CONFLICT DO NOTHING` all qualify.
- **Durability**: if the store loses the key, the next retry executes the command again. For Redis, this means AOF + fsync or replicated cluster — not in-memory only.
- **Outcome storage**: pure SETNX records "this was seen." For commands whose response matters (a returned receipt), store the response too, keyed by the idempotency key. The retried call returns the original response without re-executing.

The pattern matches Stripe's API idempotency keys (https://stripe.com/docs/api/idempotent_requests) and AWS's `ClientRequestToken` semantics.

---

## 5. The outbox pattern

The hardest distributed-systems bug in command-driven systems: the database commits a state change but the queue never receives the corresponding command — or the queue receives a command for a state change the database rolled back. The two systems are not transactional with each other.

The **outbox pattern** moves command publication into the same database transaction as the state change:

```sql
CREATE TABLE orders (
    id           UUID PRIMARY KEY,
    status       TEXT NOT NULL,
    ...
);

CREATE TABLE outbox (
    id           UUID PRIMARY KEY,
    aggregate_id UUID NOT NULL,
    command_type TEXT NOT NULL,
    payload      JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ
);

CREATE INDEX idx_outbox_unpublished ON outbox (created_at) WHERE published_at IS NULL;
```

The application writes both rows in one transaction:

```go
func (s *Service) PlaceOrder(ctx context.Context, o Order) error {
    return s.db.RunInTx(ctx, func(tx *sql.Tx) error {
        if _, err := tx.ExecContext(ctx,
            `INSERT INTO orders (id, status) VALUES ($1, $2)`,
            o.ID, "placed",
        ); err != nil { return err }

        payload, _ := json.Marshal(NotifyShipping{OrderID: o.ID})
        _, err := tx.ExecContext(ctx,
            `INSERT INTO outbox (id, aggregate_id, command_type, payload)
             VALUES ($1, $2, $3, $4)`,
            uuid.New(), o.ID, "NotifyShipping", payload,
        )
        return err
    })
}
```

A separate **outbox dispatcher** polls (or uses logical replication / Debezium CDC) for unpublished rows, publishes to the broker, marks `published_at`. The Postgres-flavored polling loop is:

```go
rows, err := db.QueryContext(ctx,
    `SELECT id, command_type, payload FROM outbox
     WHERE published_at IS NULL ORDER BY created_at LIMIT 100
     FOR UPDATE SKIP LOCKED`)
// for each row: publish to broker, then UPDATE outbox SET published_at = now() WHERE id = $1
```

The dispatcher is at-least-once: a crash between `Publish` and `UPDATE` re-publishes on the next poll. Consumers must therefore be idempotent — which they already are (see §4).

Trade-offs: polling is simple but adds DB load (tune batch size and interval); CDC (Debezium, AWS DMS) reads the WAL with zero query load but adds operational dependencies and ordering subtleties; the outbox table grows forever unless published rows are purged on a schedule.

Reference: Chris Richardson's pattern catalog at https://microservices.io/patterns/data/transactional-outbox.html.

---

## 6. Sagas

A saga is a sequence of local transactions, each on its own service or aggregate, coordinated by compensating commands when a later step fails. Two flavors:

| Flavor | Coordination | Failure mode |
|---|---|---|
| **Orchestrated** | Central orchestrator (a state machine) issues commands and waits for replies | Orchestrator is a SPOF; easy to reason about |
| **Choreographed** | Services react to each other's events with their own commands | No central state; emergent flow, hard to debug |

### 6.1 Orchestrated saga skeleton

```go
type SagaStep struct {
    Name       string
    Do         func(ctx context.Context, s *SagaState) error
    Compensate func(ctx context.Context, s *SagaState) error
}

func RunSaga(ctx context.Context, steps []SagaStep, s *SagaState) error {
    done := []SagaStep{}
    for _, step := range steps {
        if err := step.Do(ctx, s); err != nil {
            for i := len(done) - 1; i >= 0; i-- {
                if cerr := done[i].Compensate(ctx, s); cerr != nil {
                    return fmt.Errorf("saga %s failed; compensation of %s failed: %w",
                        step.Name, done[i].Name, cerr)
                }
            }
            return fmt.Errorf("saga step %s: %w", step.Name, err)
        }
        done = append(done, step)
    }
    return nil
}
```

Production sagas need three things this textbook form lacks: **durability between steps** (the orchestrator's state must survive a crash — persist `SagaState` after every step, exactly what Temporal, Cadence, and Netflix Conductor exist to do); **async waits** (real steps wait on external responses — a refund webhook, a shipment confirmation — and the orchestrator must park the saga and resume on signal); and **bounded compensation retries** (if compensation itself fails, the system needs a manual escalation path, not an infinite loop).

### 6.2 Compensations are not inverses

Compensation cancels the *effect* of a step from the business's point of view. It rarely undoes the step physically:

| Step | Naive inverse | Real compensation |
|---|---|---|
| Reserve inventory | Delete reservation | Mark reservation released; downstream readers see availability |
| Charge card | Refund | Refund (a new transaction visible in statements) |
| Send email | "Unsend" | Send a correction email (or nothing — emails are not transactional) |
| Allocate user ID | Delete user | Tombstone user; cannot reuse the ID |

A failed compensation leaves the system inconsistent by design. Production sagas record this and surface it as an alertable incident — the saga library does not fix the data; humans do.

### 6.3 Use a framework when sagas matter

Temporal (https://temporal.io) and its predecessor Cadence (Uber) implement orchestrated sagas as durable workflows with retries, timers, signals, and visibility tooling. Netflix Conductor offers a similar model with a JSON DSL. Hand-rolling sagas is reasonable for two or three steps; beyond that the pain of resuming a partially-executed saga after a crash and replaying for debugging usually exceeds the cost of adopting a framework.

---

## 7. Command versioning at the protocol level

Commands are a wire protocol. Treat them as one.

### 7.1 Schema evolution rules

| Change | Safe? | Notes |
|---|---|---|
| Add optional field | Yes | Default value when absent |
| Remove field | No | Old consumers need it; tombstone instead |
| Rename field | No | Wire-incompatible; introduce new field, deprecate old |
| Change field type | No | New field name |
| Add new command type | Yes | Old consumers ignore unknown types |
| Remove command type | Only after retention horizon expires |
| Add required field | No | Old producers don't send it |

Protobuf enforces most of these by construction. JSON does not — you need a schema registry or discipline.

### 7.2 Version in the envelope

```go
type Envelope struct {
    Type     string          `json:"type"`     // "OrderPlaced"
    Version  int             `json:"v"`        // 2
    ID       string          `json:"id"`       // for idempotency
    IssuedAt time.Time       `json:"issuedAt"`
    Trace    TraceContext    `json:"trace"`
    Payload  json.RawMessage `json:"payload"`
}
```

Handlers register by `(Type, Version)`. During a migration the producer **double-writes** v1 and v2 to two topics; consumers migrate one at a time; the v1 topic is retired only when no consumer reads it.

### 7.3 Tombstoned command types

When a command type is deprecated, leave its handler registered as a no-op that logs receipt for some grace period:

```go
func tombstonedHandler(name string) Handler {
    return func(ctx context.Context, _ json.RawMessage) error {
        slog.WarnContext(ctx, "tombstoned command received", "type", name)
        return nil
    }
}
```

Removing the handler immediately means a delayed-redelivery of an old command from a dead-letter queue becomes a hard failure.

### 7.4 Routing by version

```go
type key struct{ Type string; Version int }
type Router struct{ h map[key]Handler }

func (r *Router) Dispatch(ctx context.Context, e Envelope) error {
    if h, ok := r.h[key{e.Type, e.Version}]; ok { return h(ctx, e.Payload) }
    if h, ok := r.h[key{e.Type, 0}]; ok          { return h(ctx, e.Payload) }  // latest
    return fmt.Errorf("no handler for %s v%d", e.Type, e.Version)
}
```

The CloudEvents specification (https://cloudevents.io) standardizes an envelope very close to this; if commands cross organizational boundaries, conform to it rather than invent your own.

---

## 8. Observability deep dive

Commands are easy to lose track of: the producer and consumer run in different processes, possibly different teams. Without disciplined observability, "did this command run?" becomes unanswerable.

### 8.1 Trace context propagation

W3C Trace Context (https://www.w3.org/TR/trace-context/) defines two headers, `traceparent` and `tracestate`. Carry them on every command:

```go
type TraceContext struct {
    TraceParent string `json:"traceparent"`
    TraceState  string `json:"tracestate,omitempty"`
}

func injectTrace(ctx context.Context, e *Envelope) {
    carrier := propagation.MapCarrier{}
    otel.GetTextMapPropagator().Inject(ctx, carrier)
    e.Trace.TraceParent, e.Trace.TraceState = carrier["traceparent"], carrier["tracestate"]
}

func extractTrace(ctx context.Context, e Envelope) context.Context {
    return otel.GetTextMapPropagator().Extract(ctx, propagation.MapCarrier{
        "traceparent": e.Trace.TraceParent,
        "tracestate":  e.Trace.TraceState,
    })
}
```

In OpenTelemetry the producer creates a span when enqueueing; the consumer creates a child span on receipt. Both share a trace ID, so the entire end-to-end flow renders as one trace in Jaeger, Tempo, or Honeycomb.

### 8.2 Metrics: histograms over gauges

For per-command latency, use a histogram, not a gauge or summary.

| Metric type | Records | Use for |
|---|---|---|
| Counter | Monotonic count | Commands handled / failed |
| Gauge | Instantaneous value | Queue depth, in-flight count |
| Histogram | Distribution with buckets | Latency, payload size, retry count |
| Summary | Pre-aggregated quantiles | Avoid — quantiles do not aggregate across instances |

```go
cmdLatency := prometheus.NewHistogramVec(prometheus.HistogramOpts{
    Name:    "command_handle_seconds",
    Buckets: prometheus.ExponentialBuckets(0.001, 2, 14),  // 1ms..16s
}, []string{"type", "outcome"})
```

Per-type label cardinality must be bounded; do not label by `command_id` or `user_id`.

### 8.3 Tail latency and the poisoned command

p50 hides what matters. A handler with `p50=2ms, p99=200ms, p999=8s` means one in a thousand commands takes 4000x as long as the median. That tail is almost always one of: a **poisoned command** that the consumer retries indefinitely (a serialization-error loop; a downstream that returns 500 deterministically for one input); a periodic GC pause; or an accidental head-of-line blocker (one slow command per partition delays everything behind it).

Alert on `histogram_quantile(0.999, ...)` and on per-command-type max latency. A poisoned command must be identified by ID and quarantined to a dead-letter queue after N retries — without this, a single bad input can pin a worker at 100% CPU indefinitely.

### 8.4 Correlation IDs through retries

Every command carries an `ID`; every retry carries the same `ID`; `RetryCount` is a separate field; logs include both. Debugging "why did this user see a duplicate charge?" reduces to searching one ID and seeing every attempt across every retry across every worker — one trace, one ID, N spans.

---

## 9. Failure mode analysis

### 9.1 Retry budgets

Unbounded retries are how distributed systems amplify outages: a failing downstream sees more traffic from retries than from new requests, prolonging the outage. A **retry budget** caps retries as a fraction of new requests over a sliding window. Envoy and gRPC both implement this; the canonical setting is 20% — at most one retry for every five new requests. When the budget is exhausted, the next retry is denied and the command fails fast.

### 9.2 Exponential backoff with jitter

Naive backoff (`sleep := 2^attempt * base`) synchronizes retries from many clients after a transient failure — the "thundering herd." Add jitter:

```go
func backoff(attempt int) time.Duration {
    base := 100 * time.Millisecond
    cap := 30 * time.Second
    exp := base * (1 << min(attempt, 16))
    if exp > cap { exp = cap }
    return time.Duration(rand.Int63n(int64(exp)))   // "full jitter"
}
```

AWS's analysis (https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) shows full jitter is roughly optimal for distributed callers.

### 9.3 Dead-letter queue design

A DLQ receives commands that exhausted retries. It is not "another queue you also process" — it is a deliberate quarantine: main queue → handler → success / retry / DLQ; DLQ → manual operator review → replay or discard. The DLQ must record the original command, every failure (timestamp, error, stack), and the trace ID. DLQ replay is a manual operation, not an automatic loop — replaying without fixing the root cause re-poisons the main queue.

### 9.4 Circuit breaker per command type

A failing downstream should not consume all worker capacity. Wrap handlers in a circuit breaker keyed by command type or downstream identity (the typical Go choice is `github.com/sony/gobreaker`):

```go
cb := gobreaker.NewCircuitBreaker(gobreaker.Settings{
    Name:        e.Type,
    MaxRequests: 5,
    Interval:    30 * time.Second,
    Timeout:     10 * time.Second,
    ReadyToTrip: func(c gobreaker.Counts) bool { return c.ConsecutiveFailures > 10 },
})
_, err := cb.Execute(func() (any, error) { return nil, h.dispatch(ctx, e) })
```

When the breaker is open the handler fails fast — the command is rejected and (under at-least-once delivery) re-queued for later. The worker pool stays available for other command types.

---

## 10. Security

Commands are pre-authorized requests. Treat them with the same scrutiny as inbound HTTP.

### 10.1 Authorization at the command level

A handler must authorize the command, not trust that the producer did:

```go
type Authorizer interface { CanExecute(ctx context.Context, cmd any) error }

func (h *Handler) Handle(ctx context.Context, e Envelope) error {
    cmd, err := h.decode(e)
    if err != nil { return err }
    if err := h.auth.CanExecute(ctx, cmd); err != nil {
        return fmt.Errorf("unauthorized: %w", err)
    }
    return h.execute(ctx, cmd)
}
```

The command carries the actor (`UserID`, `ServiceAccount`) and the resource (`OrderID`, `AccountID`); the authorizer answers "may this actor perform this command on this resource?" using policy (RBAC, ABAC, Cedar, OPA). Authorizing only at the producer is insufficient — a compromised producer, a misrouted command, or a replayed command would bypass the check.

### 10.2 Audit log

Every executed command becomes an audit record with `CommandID`, `CommandType`, `Actor`, `Resource`, `IssuedAt`, `ExecutedAt`, `Outcome` (`ok`/`error`/`denied`), `Error`, and `TraceID`. The audit log is append-only, immutable, and on a separate retention policy from operational logs. Stripe's Sigma event log, Salesforce's audit trail, and AWS CloudTrail are all instances of this pattern at scale.

### 10.3 Replay attacks

If a command can be replayed, it can be abused. Defenses:

| Defense | Cost | When required |
|---|---|---|
| Idempotency key + dedup store (§4) | Low | All non-idempotent commands |
| Issued-at timestamp + max age | Low | Reject commands older than N minutes |
| Signed commands (HMAC, JWS) | Medium | Cross-organization commands; webhooks |
| Nonce in command + nonce store | Medium | High-value commands (financial transactions) |
| Mutual TLS between services | High | Service-to-service in zero-trust networks |

For external-to-internal command flows (webhooks, partner APIs), at minimum verify a signature and reject commands with timestamps outside a small window. Stripe's webhook signature scheme (https://stripe.com/docs/webhooks/signatures) is the reference design — HMAC-SHA256 over `timestamp.payload`, with a 5-minute window.

---

## 11. Authoring conventions

A team's command catalog grows into the hundreds; conventions are how it stays navigable.

### 11.1 Naming

- **Verb + Subject**: `CreateOrder`, `RefundPayment`, `CancelSubscription`. The verb is imperative; the subject is the aggregate root.
- Avoid `Process`, `Handle`, `Do` — they describe the runtime, not the intent.
- Avoid passive voice in commands (`OrderCreated`) — that is an *event*, not a command.

### 11.2 Commands vs events

| | Command | Event |
|---|---|---|
| Tense | Imperative (`CreateOrder`) | Past (`OrderCreated`) |
| Audience | Single handler | Many subscribers |
| Outcome | May be rejected | Already happened, not negotiable |
| Carries | Intent + parameters | Facts about what occurred |
| Routing | Point-to-point | Pub/sub |
| Authorization | Required | Producer's domain decides who receives |

A common architectural mistake is mixing the two on one bus. `PaymentReceived` is an event; you do not reject it. `CapturePayment` is a command; the handler can. They flow through different infrastructure and have different versioning rules.

### 11.3 Commands carry intent, not just data

A command schema should encode the *why* as well as the *what*:

```go
type CancelSubscription struct {
    SubscriptionID string
    Reason         CancellationReason   // "user_requested" | "payment_failed" | "fraud" | ...
    EffectiveAt    time.Time
    RefundPolicy   RefundPolicy
}
```

Compared to a thin `Cancel{ID}`, this richer command lets downstream handlers (billing, retention metrics, customer comms) react differently without inferring the reason. The data **is** the documentation of the intent.

---

## 12. Anti-pattern catalog

| Anti-pattern | Symptom | Fix |
|---|---|---|
| **God Bus** | One central bus routes every command in the system; every team depends on it; deploys are coordinated | Domain-aligned buses; each bounded context owns its bus |
| **Anemic command** | Command has fields but no validation; handlers re-validate inconsistently | Validate in the constructor / decoder; reject malformed commands at the boundary |
| **Command-as-DTO** | Commands match HTTP request bodies 1:1; no domain semantics | Distinguish API contracts from internal commands; map between them |
| **Side effects in handlers that emit new commands without idempotency** | Retries cause cascading duplicate work | Idempotency keys derived from the originating command, not generated fresh per emission |
| **Synchronous fan-out from one command** | One command spawns N sub-commands and awaits all of them inline; handler latency = max of N | Emit events; let independent handlers act asynchronously |
| **No deadline on the command context** | A stuck downstream pins workers forever | Per-command timeout, enforced by the dispatcher |
| **Untyped payload everywhere** | `map[string]any` carries everything; handlers reach in by string keys | Typed structs per command; payload is `json.RawMessage` only at the routing layer |
| **Mixed event/command schemas on one topic** | Subscribers cannot tell what they may reject | Separate topics or at minimum an explicit `kind` discriminator |
| **Generated retry storms** | Producer retries 5x; transport retries 3x; consumer retries 5x → 75 attempts | Retry at exactly one layer; pass `do-not-retry` through the others |
| **Forever-growing outbox** | Outbox table at 50 GB, query slow | Soft-delete published rows after N days; archive to cold storage |

---

## 13. Closing

The Command pattern is a discipline more than a structure. The structure is trivial — a struct or a function. The discipline is that **commands carry intent and handlers carry outcome**, and both must be designed for retry, observability, and evolution from day one.

Three principles hold across every command-driven system that has aged well:

1. **The boundary between enqueueing and executing is a contract.** What crosses it must be serializable, idempotent, versioned, and traceable. Treat the command type like an external API — because it is.

2. **Failure is the common case, not the exception.** A command that always succeeds does not need the pattern. The pattern earns its keep for commands that may fail, retry, time out, or arrive twice. Design for the third try, not the first.

3. **The catalog is the architecture.** Show me an organization's list of command types and I can describe its system. Naming, versioning, and authorization rules applied to that catalog are how the architecture stays coherent as the team grows from five engineers to five hundred.

Get those three right and Command becomes invisible: the system simply *describes* what it wants to happen, and the substrate — workers, queues, outboxes, sagas — makes it so.

---

## Further reading

- W3C Trace Context — https://www.w3.org/TR/trace-context/
- CloudEvents specification — https://cloudevents.io
- Chris Richardson, Transactional Outbox — https://microservices.io/patterns/data/transactional-outbox.html
- Temporal documentation — https://docs.temporal.io
- Netflix Conductor — https://conductor.netflix.com
- Stripe API Idempotency — https://stripe.com/docs/api/idempotent_requests
- AWS Exponential Backoff and Jitter — https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
- Pat Helland, *Life beyond Distributed Transactions* — the foundational paper for idempotent commands
- Greg Young, CQRS Documents — the original CQRS treatment of commands
- Gregor Hohpe & Bobby Woolf, *Enterprise Integration Patterns* — message channel, dead letter, idempotent receiver

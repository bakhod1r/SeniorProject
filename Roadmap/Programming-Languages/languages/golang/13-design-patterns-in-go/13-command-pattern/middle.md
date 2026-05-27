# Command — Middle

## 1. Where you actually meet Command in Go

You'll encounter Command-shaped code in four practical places:

1. **Background job queues** — `asynq`, `machinery`, `river`, custom worker pools. Each job is a serialized command.
2. **CQRS handlers** — application services receive a `Command` struct (`CreateOrder`, `RefundPayment`) and route it to a handler.
3. **Undo/redo systems** — editors, schema migrations, configuration rollbacks.
4. **HTTP routers** — registering `handler func(w, r)` is registering a command keyed by route.

The struct-with-Execute form is rare. The function-value form is everywhere. The interesting question at this level is: **when is the struct form actually worth it?**

---

## 2. Function-value vs struct: choosing

```go
// Function-value form
type Command func(ctx context.Context) error

// Struct form
type Command interface {
    Execute(ctx context.Context) error
}
```

Use the **function-value form** when:
- Commands are created in code and consumed locally (worker pool, retry loop).
- No need to inspect, name, log, or serialize the command.
- Closures naturally capture the parameters.

Use the **struct form** when:
- Commands cross a boundary (network, disk, queue) and must be serialized.
- You need to inspect or log "what" the command is (`cmd.Name()`, `cmd.Describe()`).
- The same command struct is dispatched to different handlers based on type.
- Commands need metadata: retry count, deadline, idempotency key.

---

## 3. Realistic Go example: a typed job queue

A worker pool that runs jobs, with names so logs are readable:

```go
type Job interface {
    Name() string
    Run(ctx context.Context) error
}

type SendEmailJob struct {
    To, Subject, Body string
}

func (j SendEmailJob) Name() string { return "send-email" }

func (j SendEmailJob) Run(ctx context.Context) error {
    return smtp.SendContext(ctx, j.To, j.Subject, j.Body)
}

type ResizeImageJob struct {
    Path string
    W, H int
}

func (j ResizeImageJob) Name() string { return "resize-image" }
func (j ResizeImageJob) Run(ctx context.Context) error {
    return image.Resize(j.Path, j.W, j.H)
}
```

The worker:

```go
type Worker struct {
    jobs chan Job
    log  *slog.Logger
}

func (w *Worker) loop(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case j := <-w.jobs:
            start := time.Now()
            err := j.Run(ctx)
            w.log.Info("job done",
                "name", j.Name(),
                "ms", time.Since(start).Milliseconds(),
                "err", err)
        }
    }
}
```

The worker never knows the concrete command type. Adding a new job means: define a new struct with `Name()` + `Run(ctx)`. No worker changes.

---

## 4. Reversible commands (transactions, migrations)

Once a command has an `Undo`, you can build a transaction-like sequence:

```go
type Op struct {
    Name string
    Do   func(ctx context.Context) error
    Undo func(ctx context.Context) error
}

func Run(ctx context.Context, ops []Op) error {
    done := []Op{}
    for _, op := range ops {
        if err := op.Do(ctx); err != nil {
            // rollback in reverse
            for i := len(done) - 1; i >= 0; i-- {
                _ = done[i].Undo(ctx)
            }
            return fmt.Errorf("op %s: %w", op.Name, err)
        }
        done = append(done, op)
    }
    return nil
}
```

This is the **Saga** pattern (a CoR + Command hybrid) common in distributed systems where there's no real database transaction across services.

Real example: `golang-migrate/migrate` runs `.up.sql` files; if one fails, it can run `.down.sql` files in reverse to roll back. Each migration is a reversible command.

---

## 5. Serializable commands (cross-process queues)

For Redis/SQS/Kafka-backed queues, commands cross a process boundary. They must be serializable:

```go
type Command struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload"`
    Retries int             `json:"retries"`
}

type Handler func(ctx context.Context, payload json.RawMessage) error

var registry = map[string]Handler{}

func Register(name string, h Handler) { registry[name] = h }

func Dispatch(ctx context.Context, c Command) error {
    h, ok := registry[c.Type]
    if !ok {
        return fmt.Errorf("unknown command: %s", c.Type)
    }
    return h(ctx, c.Payload)
}
```

The producer writes `Command{Type: "send-email", Payload: ...}` to a queue. The consumer reads it and dispatches by type. This is exactly how `asynq` and `machinery` work.

---

## 6. Command + Context

Always pass `context.Context` to a command's `Execute` / `Run`:

```go
type Command interface {
    Execute(ctx context.Context) error
}
```

Why:
- Cancellation propagates through long-running commands.
- Deadlines are honored (queue can put a per-job deadline on the context).
- Tracing/logging carry through (request ID, span).

A command without `ctx` is a command you can't cancel — a real liability for anything that does I/O.

---

## 7. CQRS commands

In CQRS (Command Query Responsibility Segregation), every state-changing operation is a Command struct:

```go
type CreateOrder struct {
    UserID  string
    Items   []Item
    Total   decimal.Decimal
}

type CancelOrder struct {
    OrderID string
    Reason  string
}
```

A dispatcher routes them to handlers by type:

```go
type Bus struct {
    handlers map[reflect.Type]func(any) error
}

func (b *Bus) Send(cmd any) error {
    h, ok := b.handlers[reflect.TypeOf(cmd)]
    if !ok { return fmt.Errorf("no handler for %T", cmd) }
    return h(cmd)
}
```

This is Command + Mediator. The data (struct) is decoupled from the behavior (handler), so the same `CreateOrder` value can be validated, persisted, replayed, audited — each by a different handler.

---

## 8. Trade-offs

| Aspect | Function form | Struct form |
|--------|---------------|-------------|
| **Boilerplate** | Minimal | Type + method + registration |
| **Serializable** | No (closures don't serialize) | Yes (just fields) |
| **Inspectable** | No (opaque closure) | Yes (`reflect`, `Name()`) |
| **Locality** | Defined where used | Defined globally |
| **Type-safe at call site** | Yes (`func()` signature) | Need type assertion or generics |
| **Testable in isolation** | Harder (captured closure state) | Easy (struct fields) |

Default to function values. Reach for structs only when you need serialization, inspection, or registry-based dispatch.

---

## 9. Common middle-level mistakes

- **No timeout on `Execute(ctx)`**: a single hung command blocks the worker forever. The caller (worker pool) should always set a per-job timeout.
- **Mutable command state**: if `cmd.Execute()` mutates the command, retries become unsafe. Treat commands as immutable values.
- **Hidden side effects in undo**: undo that does additional work (logs, metrics) instead of pure reversal. Undo should be the inverse operation, nothing more.
- **Loop-variable capture in closures**: `for _, x := range xs { cmds = append(cmds, func() { use(x) }) }` — pre-Go-1.22, all closures share the same `x`. Go 1.22+ fixed this.
- **Mixing Command and Strategy**: Strategy is for *how* (algorithm selection). Command is for *what to do, deferred*. If your "command" picks an algorithm, you might want Strategy instead.

---

## 10. Summary
At the middle level, Command in Go means choosing between a `func(ctx) error` and a `Job`/`Command` struct. Use the function form by default. Use the struct form when commands need serialization, dispatch by type, named logging, or undo semantics. Pair Command with Context for cancellation, with Mediator (a Bus) for routing, and with Saga for distributed transactions.

---

## Further reading
- `asynq` — Go background job library, full Command-pattern implementation
- `golang-migrate/migrate` — reversible Command for schema migrations
- `spf13/cobra` — Command pattern for CLIs
- Microsoft eShop CQRS reference — Commands and handlers
- Sam Newman, *Building Microservices* — Saga and compensating commands

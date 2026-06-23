# Command Pattern — Specification

## 1. Origins

The Command pattern was formalized in *Design Patterns: Elements of Reusable Object-Oriented Software* (Gamma, Helm, Johnson, Vlissides, 1994):

> "Encapsulate a request as an object, thereby letting you parameterize clients with different requests, queue or log requests, and support undoable operations."

Historical predecessors:

- **CLU (1974)** — Liskov's procedure objects; first-class operations passed as values.
- **Smalltalk-80 (1980)** — `Message` is a reified call; `perform:` and `BlockClosure` are command-shaped.
- **AppleScript (1993)** — verbs and direct objects sent to applications as scriptable commands; a runtime-level Command system.
- **HyperTalk (1987)** — message-passing model where each event is a command dispatched up a hierarchy.

In post-GoF history:

- **Java 1.0 (1996)** — `Runnable` and later `Callable` (Java 5, 2004) are Command interfaces used by the `Executor` framework.
- **.NET (2002)** — `ICommand` in WPF/MVVM with `Execute`/`CanExecute`; `Action`/`Func` delegates.
- **Editors (1980s onward)** — Emacs, Vim, Word, Photoshop — undo/redo built on command stacks.
- **Message queues (2000s)** — JMS, RabbitMQ, Kafka — messages are commands or events; consumers are handlers.
- **CQRS (Greg Young, 2010)** — Command as a domain-level intent, distinct from query; popularized by Evans and Vernon in DDD.

Go-specific history:

- **Go 1.0 (2012)** — `os/exec.Cmd` for process commands; `http.HandlerFunc` map for route registries; first-class function values as the default Command shape.
- **Go 1.7 (2016)** — `context.Context` standardized; the canonical `Execute(ctx) error` signature follows from this.
- **`spf13/cobra` (2015)** — CLI Command framework: each subcommand is a `*cobra.Command` with `PreRun`, `Run`, `PostRun`.
- **`hibiken/asynq` (2019)** — Redis-backed async task queue; each task is a serialized Command.
- **Go 1.18 (2022)** — generics enabled type-safe command buses: `Bus.Send[T Command](ctx, T) error`.
- **`riverqueue/river` (2023)** — typed background jobs leveraging generics for compile-time-checked dispatch.

Go's idiom diverges from the GoF struct-with-`Execute` form: the function value `func(ctx context.Context) error` is the dominant shape. Struct commands appear where serialization, inspection, or registry dispatch matter.

---

## 2. Go language mechanics

### 2.1 Function values as commands

Functions are first-class values. A command is often just a captured closure:

```go
type Command func(ctx context.Context) error

cmd := func(ctx context.Context) error {
    return db.ExecContext(ctx, "UPDATE accounts SET balance = balance - $1 WHERE id = $2", amount, id)
}
```

Closures capture parameters from the enclosing scope. The function value carries both behaviour and data; the receiver and arguments are baked in.

### 2.2 Struct + interface form

When the command must be inspected, named, or serialized, define a struct that satisfies an interface:

```go
type Command interface {
    Execute(ctx context.Context) error
}

type DebitAccount struct {
    AccountID string
    Amount    decimal.Decimal
}

func (c DebitAccount) Execute(ctx context.Context) error {
    return debit(ctx, c.AccountID, c.Amount)
}
```

The struct holds the request data; the method holds the behaviour. The interface lets unrelated commands flow through the same invoker.

### 2.3 Generics (Go 1.18+)

Generics enabled type-safe command buses without `any`/`reflect`:

```go
type Command interface {
    CommandName() string
}

type Handler[C Command] func(ctx context.Context, cmd C) error

type Bus struct {
    handlers map[string]any
}

func Register[C Command](b *Bus, h Handler[C]) {
    var zero C
    b.handlers[zero.CommandName()] = h
}

func Send[C Command](b *Bus, ctx context.Context, cmd C) error {
    h, ok := b.handlers[cmd.CommandName()].(Handler[C])
    if !ok {
        return fmt.Errorf("no handler for %s", cmd.CommandName())
    }
    return h(ctx, cmd)
}
```

Without generics, dispatch required `reflect.TypeOf` or `interface{}` plus type assertions in every handler.

### 2.4 Context propagation

The canonical Go Command signature is `Execute(ctx context.Context) error`. Three reasons:

1. **Cancellation** — a long-running command must abort when the caller cancels.
2. **Deadlines** — queues set per-job deadlines on the context.
3. **Tracing/logging** — request ID, span, user identity travel with the context.

A command without `ctx` is a command that can't be cancelled. For anything that does I/O, this is a design defect.

### 2.5 Reflection-based dispatch

Pre-generics command buses use `reflect.TypeOf(cmd)` as the registry key:

```go
type Bus struct {
    handlers map[reflect.Type]func(context.Context, any) error
}

func (b *Bus) Send(ctx context.Context, cmd any) error {
    h, ok := b.handlers[reflect.TypeOf(cmd)]
    if !ok {
        return fmt.Errorf("no handler for %T", cmd)
    }
    return h(ctx, cmd)
}
```

Reflection-based dispatch is still common where commands are open-ended (plugin systems, scripting, RPC servers).

---

## 3. Canonical Go shapes

### 3.1 Function-value command (idiomatic)

```go
type Command func(ctx context.Context) error

func WithRetry(c Command, attempts int) Command {
    return func(ctx context.Context) error {
        var err error
        for i := 0; i < attempts; i++ {
            if err = c(ctx); err == nil {
                return nil
            }
        }
        return err
    }
}
```

Most Go background-job code looks like this. No interface, no struct, no `Execute` method.

### 3.2 Interface command

```go
type Command interface {
    Execute(ctx context.Context) error
}

type ResizeImage struct {
    Path    string
    Width   int
    Height  int
}

func (c ResizeImage) Execute(ctx context.Context) error {
    return image.Resize(ctx, c.Path, c.Width, c.Height)
}
```

Used when the command is named, serialized, or routed by type.

### 3.3 Reversible command (Do/Undo)

```go
type Reversible struct {
    Name string
    Do   func(ctx context.Context) error
    Undo func(ctx context.Context) error
}

func RunAll(ctx context.Context, ops []Reversible) error {
    done := make([]Reversible, 0, len(ops))
    for _, op := range ops {
        if err := op.Do(ctx); err != nil {
            for i := len(done) - 1; i >= 0; i-- {
                _ = done[i].Undo(context.Background()) // rollback should not honour caller cancel
            }
            return fmt.Errorf("op %s: %w", op.Name, err)
        }
        done = append(done, op)
    }
    return nil
}
```

Used in editors, schema migrations, and Saga implementations.

### 3.4 Serializable command (JSON-tagged struct)

```go
type SendEmail struct {
    To      string `json:"to"`
    Subject string `json:"subject"`
    Body    string `json:"body"`
}

func (c SendEmail) Type() string { return "send_email" }

type Envelope struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload"`
    IdempotencyKey string   `json:"idempotency_key"`
}
```

The envelope carries the type discriminator; payloads are decoded by registry lookup. This is exactly how `asynq` and `machinery` serialise jobs to Redis.

### 3.5 Generics command bus (Go 1.18+)

```go
type Command interface {
    Kind() string
}

type Bus struct {
    mu       sync.RWMutex
    handlers map[string]any
}

func Register[C Command](b *Bus, h func(context.Context, C) error) {
    var zero C
    b.mu.Lock()
    defer b.mu.Unlock()
    b.handlers[zero.Kind()] = h
}

func Send[C Command](b *Bus, ctx context.Context, cmd C) error {
    b.mu.RLock()
    h, ok := b.handlers[cmd.Kind()].(func(context.Context, C) error)
    b.mu.RUnlock()
    if !ok {
        return fmt.Errorf("no handler for %s", cmd.Kind())
    }
    return h(ctx, cmd)
}
```

Compile-time type safety; no reflection in the hot path.

---

## 4. Standard library use

### 4.1 `os/exec.Cmd` — process commands

```go
cmd := exec.CommandContext(ctx, "git", "clone", url)
cmd.Stdout = &buf
cmd.Stderr = &buf
err := cmd.Run()
```

`*exec.Cmd` is the textbook struct Command: holds receiver (executable path), arguments, environment, I/O wiring, and exposes `Run`, `Start`, `Wait`. The same struct can be `Run` multiple times only via cloning; after `Wait` the command is exhausted.

### 4.2 `http.HandlerFunc` map — route registry

```go
mux := http.NewServeMux()
mux.HandleFunc("POST /orders", createOrder)
mux.HandleFunc("DELETE /orders/{id}", cancelOrder)
```

A `map[string]http.HandlerFunc` is a registry of commands keyed by route. Each handler is a function-value command; the mux is the invoker that selects which to run per request.

### 4.3 `sync.Once.Do(func())` — one-shot command

```go
var once sync.Once
once.Do(func() { initialize() })
```

`Do` takes a `func()` command and runs it exactly once; subsequent calls become no-ops. The command is parameterised via closure capture.

### 4.4 `time.AfterFunc(d, f)` — deferred command

```go
timer := time.AfterFunc(5*time.Second, func() {
    log.Println("five seconds elapsed")
})
defer timer.Stop()
```

The function value is a command scheduled for later execution. `Stop` cancels the scheduled command before it fires.

### 4.5 `runtime.SetFinalizer(obj, f)` — cleanup command

```go
runtime.SetFinalizer(conn, func(c *Conn) { _ = c.Close() })
```

A command tied to an object's lifetime, invoked by the garbage collector when the object becomes unreachable. Discouraged for resource cleanup (explicit `Close` is preferred) but a Command shape nonetheless.

---

## 5. Real library use

### 5.1 `spf13/cobra` — CLI commands

```go
var rootCmd = &cobra.Command{
    Use:   "myapp",
    Short: "...",
    PreRunE: func(cmd *cobra.Command, args []string) error { return validate(args) },
    RunE:    func(cmd *cobra.Command, args []string) error { return run(args) },
    PostRunE: func(cmd *cobra.Command, args []string) error { return cleanup() },
}
```

Cobra is a complete Command pattern implementation. `*cobra.Command` is the struct command; `PreRun`/`Run`/`PostRun` are the lifecycle hooks; subcommands form a tree (Composite + Command).

### 5.2 `hibiken/asynq` — async task queue

```go
task := asynq.NewTask("email:send", payload)
info, err := client.Enqueue(task, asynq.MaxRetry(3), asynq.Timeout(30*time.Second))
```

`asynq.Task` is a serialized command persisted to Redis. A worker server registers handlers per task type:

```go
mux := asynq.NewServeMux()
mux.HandleFunc("email:send", handleSendEmail)
```

Retry count, deadline, and idempotency are command metadata.

### 5.3 `riverqueue/river` — typed jobs with generics

```go
type SendEmailArgs struct {
    To      string
    Subject string
}

func (SendEmailArgs) Kind() string { return "send_email" }

type SendEmailWorker struct {
    river.WorkerDefaults[SendEmailArgs]
}

func (w *SendEmailWorker) Work(ctx context.Context, job *river.Job[SendEmailArgs]) error {
    return smtp.Send(ctx, job.Args.To, job.Args.Subject, "")
}
```

`river` uses generics so the worker receives a strongly typed job. The `Kind()` method is the discriminator; the args struct is the serialized command.

### 5.4 `RichardKnop/machinery` — distributed task queue

```go
signature := &tasks.Signature{
    Name: "add",
    Args: []tasks.Arg{{Type: "int64", Value: 1}, {Type: "int64", Value: 2}},
}
asyncResult, err := server.SendTask(signature)
```

`tasks.Signature` is a serialized command. The broker (Redis, AMQP, SQS) persists it; workers fetch and dispatch by `Name`.

### 5.5 `go-redis/redis` — Cmd struct for serialized Redis commands

```go
cmd := rdb.Set(ctx, "key", "value", 0)
if err := cmd.Err(); err != nil { /* ... */ }
val, err := rdb.Get(ctx, "key").Result()
```

Each Redis call returns a `*redis.StringCmd`/`*redis.IntCmd`/etc. holding the request, the wire representation, and the result. Pipelines accumulate commands and send them as a batch — Command + Macro.

---

## 6. Formal specification

A Go Command implementation consists of:

| Element | Description |
|---------|-------------|
| **Command type** | Function value (`func(ctx) error`) or struct implementing an interface. |
| **Receiver** | The thing the command operates on (DB, service, file, network endpoint). |
| **Invoker** | Code that triggers execution (worker pool, bus, scheduler, router). |
| **Execution context** | Cancellation, deadline, tracing — carried by `context.Context`. |
| **Error semantics** | Synchronous (`Execute` returns `error`) or deferred (delivered through a future, callback, or result store). |
| **Lifecycle** | Submit → execute → complete; with retry on transient failure; fail on terminal error; undo on rollback. |

**Invariants:**

1. The command is immutable after creation. Retries reuse the same value and must produce the same intent.
2. Execution is decoupled from creation in time and (potentially) in process. The producer and the consumer of a command need not run concurrently or on the same machine.
3. Errors are surfaced — through return values, result channels, or recorded job state. Never silently swallowed.
4. Context cancellation aborts in-flight execution. A command must honour `ctx.Done()` between I/O operations.
5. Commands carry **intent** (verb + subject — *CreateOrder*, *RefundPayment*), not **outcome**. Outcome belongs to the response or to a downstream Event.

---

## 7. Anti-patterns

### 7.1 God Command Bus

A single `Bus` routes every command in the system; over time, every package depends on it and the bus becomes the application. **Fix:** split by bounded context — one bus per domain, composed at the edges.

### 7.2 Command-as-DTO (no domain meaning)

```go
type UpdateUser struct {
    ID   string
    Data map[string]any
}
```

The command is a generic blob. There is no business invariant the type expresses. **Fix:** model the actual intent (`ChangeEmail{UserID, NewEmail}`, `PromoteToAdmin{UserID}`); each intent has its own type and validation rules.

### 7.3 Mutable command state during execution

```go
func (c *SendEmail) Execute(ctx context.Context) error {
    c.Attempts++              // mutates the command
    c.LastError = doSend(c)
    return c.LastError
}
```

Retries see a different command each time; serialised copies diverge from in-memory copies. **Fix:** treat commands as immutable; track attempts and errors on a separate `JobState` or `Execution` value.

### 7.4 Anemic command (no validation, no business meaning)

A struct with public fields and no methods, populated by setters and trusted by handlers. **Fix:** give the command a constructor that validates invariants (`NewCreateOrder(userID, items) (CreateOrder, error)`) and keep fields unexported or read-only.

### 7.5 Missing context propagation

```go
type Command interface {
    Execute() error           // no ctx
}
```

The command can't be cancelled or carry a deadline. Worker pools hang on stuck commands; tracing is lost. **Fix:** `Execute(ctx context.Context) error`. Always.

### 7.6 Unbounded command queue (no backpressure)

```go
queue := make(chan Command, math.MaxInt) // or no buffer + unbounded goroutine pool
```

Producers always succeed; consumers fall behind; memory grows until OOM. **Fix:** bounded channel + explicit backpressure (block, drop, or shed). For durable queues, monitor depth and apply rate limits at the producer.

### 7.7 Side effects in handlers that emit new commands without idempotency

A handler that processes `OrderPlaced` and emits `SendConfirmationEmail` and `ReserveInventory` — but the broker redelivers, and the handler emits duplicates. **Fix:** outbox pattern (emit + persist atomically) and idempotency keys on every emitted command (the consumer deduplicates).

---

## 8. Variants and dialects

| Variant | Use case |
|---------|----------|
| Function-value Command | In-process, ephemeral, no metadata |
| Struct Command | Serializable, named, dispatched by type |
| Reversible Command | Undo/redo in editors; Sagas in distributed systems |
| Macro Command | Composite of sub-commands executed as a unit (Redis pipelines, batch jobs) |
| Async Command | Returns a Future/Promise; result is delivered through a separate channel |
| Generics Command Bus | Type-safe dispatch in Go 1.18+ |
| CQRS Command | Domain-level intent; paired with a separate Query model |

---

## 9. Naming conventions

- **`Verb` + `Subject`** for the type: `CreateOrder`, `SendEmail`, `RefundPayment`, `PromoteUser`.
- **`Execute(ctx) error`** — standard method on the Command interface.
- **`Run(ctx)`** — alternative; used by Cobra and many CLI/job libraries.
- **`Do` / `Undo`** — reversible pair for transaction-like sequences.
- **`Bus`, `Dispatcher`, `Mediator`** — names for the invoker that routes commands.
- **`Handler`** — function that processes a specific command type.
- **`Worker`** — name for a consumer goroutine in queue-based systems.
- **`Task`** / **`Job`** — names for serialised commands in async queue libraries (`asynq.Task`, `river.Job`).
- **`Kind()` / `Name()` / `Type()`** — method returning the type discriminator on the wire.

---

## 10. Related patterns

| Pattern | Distinction |
|---------|-------------|
| **Strategy** | Selects *how* an operation is performed; Command represents *what to do, deferred*. Strategy is swapped at call site; Command is queued or stored. |
| **Mediator** | Routes commands between objects. A command bus *is* a mediator specialised for commands. |
| **Memento** | Captures state for undo; Reversible Command captures the inverse operation. Memento + Command together implement full editor undo. |
| **Chain of Responsibility** | Sequence of handlers, each may handle or pass along; Command bus routes to a single handler. CoR is "pipeline"; Bus is "dispatch table". |
| **Observer** | Fires *Events* (something happened); Command represents *intent* (please do something). Events are facts; Commands are requests. |
| **Saga** | Sequence of compensating commands executed across services. Saga uses Reversible Commands to model distributed transactions. |
| **Composite** | Macro Commands are composites of sub-commands; Cobra's subcommand tree is Command + Composite. |

---

## 11. Further reading

- **GoF (1994)** — the original Command pattern.
- **Eric Evans, *Domain-Driven Design* (2003)** — Command as application-service intent.
- **Vaughn Vernon, *Implementing Domain-Driven Design* (2013)** — Command vs Domain Event; aggregates as command receivers.
- **Greg Young, "CQRS Documents" (2010)** — Command/Query separation at the architectural level.
- **`spf13/cobra` docs** — CLI Command framework.
- **`hibiken/asynq` README**, **`riverqueue/river` README**, **`RichardKnop/machinery`** — async task queues.
- **Temporal / Cadence** — durable workflow engines modelling business processes as Command sequences with replayable history.
- **Outbox pattern (microservices.io)** — atomic command emission with the source-of-truth transaction.
- **W3C Trace Context spec** — propagating tracing IDs through command metadata across services.
- **Sam Newman, *Building Microservices* (2nd ed.)** — Sagas, compensating actions, eventual consistency.

Command in Go lives mostly as a function value; the GoF struct form appears at boundaries (queues, CLIs, CQRS). Senior-level skill is recognising which boundary requires the struct form, and choosing the right metadata (idempotency, retry, deadline, tracing) for that boundary.

---

## 12. Glossary

| Term | Meaning |
|------|---------|
| **Command** | An object or function representing one action, decoupled from execution. |
| **Invoker** | Code that triggers execution — worker pool, bus, scheduler, router. |
| **Receiver** | The target of the action — DB, service, file, remote endpoint. |
| **Handler** | Function that processes a specific command type. |
| **Bus / Dispatcher** | Component that routes commands to handlers by type or name. |
| **Saga** | Sequence of compensating commands modelling a distributed transaction. |
| **Outbox** | Reliable dispatch table written in the same DB transaction as the state change, drained by a separate worker. |
| **Idempotency key** | Identifier that lets a retried or redelivered command be deduplicated by the consumer. |
| **Compensating action** | The inverse of a command, run on rollback to restore the prior state. |
| **Macro Command** | A composite of sub-commands executed (and rolled back) as a unit. |
| **Envelope** | Wire format wrapping the command payload with metadata (type, retry count, deadline, tracing). |
| **Replay** | Re-executing a stored command stream to rebuild state, as in event sourcing. |

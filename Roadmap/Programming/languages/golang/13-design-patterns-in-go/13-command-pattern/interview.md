# Command — Interview

## 1. How to use this file

This is 25 questions in interview order — junior to staff — plus three live-coding prompts, a concept-check list, and the signals interviewers actually grade on. Each question has a **short answer** (the length you'd give in the room — two to five sentences), and where it matters, a **follow-up to expect** so you're not surprised when the interviewer pushes one layer deeper.

Read top to bottom on first pass. On revision, skim the short answers and re-read only the ones you stumbled on. The live-coding section is for muscle memory — type the solutions out at least once, don't just read them.

If you can't answer any question in section 7 (Concept checks) in one breath, study more before the interview.

---

## 2. Junior questions (Q1–Q7)

### Q1. What is the Command pattern?

**Short answer:** Wrap "what to do" as a value — a struct with an `Execute()` method, or in Go more often a `func() error`. The caller hands the value to an invoker that runs it later, possibly retries it, possibly logs it, possibly never runs it. The point is that the work is *deferred*, *named*, and *reified* as data.

**Follow-up to expect:** What's the difference between a Command and a function pointer? Answer: a function pointer is a Command in its simplest form. The Command *pattern* is the discipline of treating "an action" as a first-class value so you can queue, log, retry, or undo it. The shape is a function value; the pattern is how you use it.

---

### Q2. Why use a Command instead of just calling the function?

**Short answer:** Four reasons: (1) **deferral** — run later, not now (job queues, background workers); (2) **uniformity** — many different actions handled by one invoker (`for c := range jobs { c() }`); (3) **history** — keep a log of what ran so you can audit, replay, or undo; (4) **decoupling** — the producer of work doesn't know who runs it, when, or how many times. If you don't need any of those, just call the function.

---

### Q3. Show a minimal Command in Go.

**Short answer:**

```go
type Command func() error

cmds := []Command{
    func() error { return os.WriteFile("a.txt", []byte("hi"), 0644) },
    func() error { return sendEmail("a@b.c", "hello") },
}

for _, c := range cmds {
    if err := c(); err != nil {
        log.Println("failed:", err)
    }
}
```

That's the whole pattern. Closures capture parameters; the slice is a queue; the loop is the invoker. No interface, no `Execute` method, no class hierarchy.

**Follow-up to expect:** Add cancellation. Answer: change the signature to `type Command func(ctx context.Context) error` and pass `ctx` into each call.

---

### Q4. Function value or struct — which is more idiomatic in Go?

**Short answer:** Function value (`func(ctx) error`) is the default. It's shorter, allocates less, and reads cleanly. Use a struct when the command must cross a process boundary (serialization), needs a name for logs (`Name() string`), or carries metadata like retry count and idempotency key. Most Go codebases mix both — function values in-process, structs for the queue.

---

### Q5. What's an "invoker" and a "receiver" in Command vocabulary?

**Short answer:** The **invoker** is the code that runs the command — the worker pool, the for-loop, the HTTP server. The **receiver** is the thing the command operates on — the database, the file system, the SMTP client. The **client** creates the command, the **invoker** runs it, the **receiver** is the target. In Go you rarely need this vocabulary out loud, but interviewers use it.

---

### Q6. How does Command relate to undo/redo?

**Short answer:** Attach an inverse to each command — `Do func() error` and `Undo func() error`. The invoker pushes executed commands onto a stack. Undo pops and runs `Undo`. Redo pushes back and runs `Do` again. Editors, schema migrators (`golang-migrate` `up`/`down`), and config rollbacks all work this way. The hard part isn't the pattern; it's making `Undo` actually inverse — no extra side effects, no logging, no metrics that double-count.

**Follow-up to expect:** What if `Undo` itself fails? Answer: you're in a partially-rolled-back state. Either retry the undo, or record the failure and stop — never silently continue. The Saga pattern formalizes this with *compensating* commands that may fail and need their own recovery.

---

### Q7. When have you seen Command in the Go standard library?

**Short answer:** `os/exec.Cmd` is the textbook example — a struct describing a process invocation (path, args, env, stdin/stdout) that you build and then call `Run`, `Start`, or `Output` on. `http.HandlerFunc` registered in a `ServeMux` is a registry of commands keyed by route. `flag.Func` lets you register a callback per flag — again, named commands. `text/template.FuncMap` is commands looked up by name from template code. Once you see the shape, it's everywhere.

---

## 3. Middle questions (Q8–Q15)

### Q8. When would you use a struct over a function value?

**Short answer:** Five cases: (1) **serialization** — closures don't marshal to JSON; structs do; (2) **inspection** — a name for logs (`cmd.Name()`), a type for metrics; (3) **dispatch by type** — `switch cmd := cmd.(type)` in a Mediator/Bus; (4) **metadata** — retry count, deadline, idempotency key, trace ID attached to the command itself; (5) **testability** — struct fields are visible in test assertions; closure state isn't. If you need none of these, function value wins.

---

### Q9. How do you propagate cancellation to a Command?

**Short answer:** Make every command take a `context.Context`. Signature: `type Command func(ctx context.Context) error` or `Execute(ctx context.Context) error`. The invoker passes a derived context with the per-job deadline. Inside the command, every I/O call takes `ctx` — `db.QueryContext(ctx, ...)`, `client.Do(req.WithContext(ctx))`. A command that ignores `ctx` is a command you can't cancel, and a worker pool full of those is a service you can't shut down.

**Follow-up to expect:** What's the difference between `ctx.Done()` and checking `ctx.Err()`? Answer: `Done()` returns a channel for `select`. `Err()` returns `nil` until cancellation, then `context.Canceled` or `context.DeadlineExceeded`. Use the channel in long loops; use `Err()` between sub-steps.

---

### Q10. What's a Command Bus, and what problem does it solve?

**Short answer:** A Command Bus is a registry that maps a command type to its handler and routes incoming commands. Pseudo: `bus.Register[CreateOrder](handleCreateOrder); bus.Send(ctx, CreateOrder{...})`. It solves the routing problem in CQRS systems: the caller knows *what* it wants done (the command struct); the bus figures out *who* handles it. This decouples HTTP handlers, CLI commands, and background workers from the domain code — they all just send commands.

**Follow-up to expect:** Why not just call the handler directly? Answer: because then every transport (HTTP, gRPC, CLI, queue) has to import every handler. The bus is one indirection; the cost is registration boilerplate; the benefit is N transports times M handlers instead of N times M direct imports.

---

### Q11. How do you implement undo with Command in Go?

**Short answer:**

```go
type Reversible struct {
    Name string
    Do   func(ctx context.Context) error
    Undo func(ctx context.Context) error
}

type History struct {
    mu   sync.Mutex
    done []Reversible
}

func (h *History) Exec(ctx context.Context, r Reversible) error {
    if err := r.Do(ctx); err != nil { return err }
    h.mu.Lock(); h.done = append(h.done, r); h.mu.Unlock()
    return nil
}

func (h *History) Undo(ctx context.Context) error {
    h.mu.Lock()
    if len(h.done) == 0 { h.mu.Unlock(); return errors.New("nothing to undo") }
    r := h.done[len(h.done)-1]
    h.done = h.done[:len(h.done)-1]
    h.mu.Unlock()
    return r.Undo(ctx)
}
```

The hard parts are not in the data structure. They are: making `Undo` truly inverse (no extra side effects), bounding the history (don't grow forever), and deciding whether `Undo` failures pop the command anyway or push it back.

---

### Q12. Closures vs structs: what's the cost difference?

**Short answer:** A closure capturing N variables allocates an environment of roughly the same size as a struct with N fields, plus the function pointer. For a few captured variables the cost is negligible. The real differences are: (1) a closure escapes to the heap because the function value outlives the stack frame that created it — same as a struct returned by pointer; (2) a struct's fields are introspectable via reflection, a closure's captures aren't; (3) the compiler can sometimes inline a direct call to a struct method but rarely inlines through a `func` indirection. For a job queue measured in jobs-per-second, the cost difference is below your monitoring resolution.

---

### Q13. What's the loop-variable bug with commands, and when was it fixed?

**Short answer:** Pre-Go-1.22, `for _, x := range xs` reused the same `x` variable across iterations. A closure capturing `x` would see the *final* value, not the per-iteration value. Classic bug:

```go
var cmds []func()
for _, x := range []int{1, 2, 3} {
    cmds = append(cmds, func() { fmt.Println(x) })
}
for _, c := range cmds { c() }  // pre-1.22: prints 3, 3, 3
```

The fix pre-1.22 was `x := x` inside the loop to shadow. Go 1.22 (Feb 2024) made each iteration introduce a new variable, eliminating the bug. If you're targeting 1.22+ in `go.mod`, the old code works; on older modules it still bites.

---

### Q14. Compare Command, Strategy, and Chain of Responsibility — when each applies.

**Short answer:**
- **Command**: encapsulate *what to do, deferred*. The value represents one action to run later.
- **Strategy**: encapsulate *how to do it*. The value represents an algorithm to use now, swappable.
- **Chain of Responsibility**: encapsulate *a sequence of handlers* where each can short-circuit. The value is a pipeline.

A scheduled job is a Command. A sorting algorithm you pass to `sort.Slice` is a Strategy. HTTP middleware is Chain of Responsibility. They sometimes combine — a CQRS handler is a Command (the request) plus a Strategy (the handler picks the algorithm) inside a Bus (which routes), often with middleware (chain) around it.

---

### Q15. How would you serialize a Command for a background queue?

**Short answer:** Two parts. (1) A wire format — usually JSON with a discriminator field:

```go
type Envelope struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload"`
    Meta    Meta            `json:"meta"` // retry count, trace id, idempotency key
}
```

(2) A registry mapping the type string to a Go type and handler:

```go
type Handler func(ctx context.Context, payload json.RawMessage) error
var registry = map[string]Handler{}
```

The producer marshals `Envelope{Type: "send-email", Payload: marshal(SendEmail{...})}` to the queue. The consumer pulls it, looks up `registry[Type]`, and calls the handler with the raw payload. This is exactly how `asynq` and `machinery` work under the hood.

**Follow-up to expect:** Why not `gob`? Answer: JSON is debuggable in the queue UI, language-agnostic if you ever consume from non-Go, and forward-compatible if you treat unknown fields as ignored. `gob` is faster but tightly couples producer and consumer to the same Go types.

---

## 4. Senior questions (Q16–Q22)

### Q16. Design a generics-based command bus in Go 1.18+.

**Short answer:** Use generics for type-safe registration but `any` at the dispatch boundary because the bus must hold heterogeneous handlers in one map:

```go
type Bus struct {
    mu       sync.RWMutex
    handlers map[reflect.Type]func(context.Context, any) error
}

func NewBus() *Bus {
    return &Bus{handlers: map[reflect.Type]func(context.Context, any) error{}}
}

func Handle[T any](b *Bus, h func(context.Context, T) error) {
    var zero T
    b.mu.Lock(); defer b.mu.Unlock()
    b.handlers[reflect.TypeOf(zero)] = func(ctx context.Context, v any) error {
        return h(ctx, v.(T))
    }
}

func Send[T any](ctx context.Context, b *Bus, cmd T) error {
    b.mu.RLock(); h, ok := b.handlers[reflect.TypeOf(cmd)]; b.mu.RUnlock()
    if !ok { return fmt.Errorf("no handler for %T", cmd) }
    return h(ctx, cmd)
}
```

The win: `Handle[CreateOrder](bus, handleCreate)` is type-checked. The cost: methods can't be generic in Go, so `Handle` and `Send` are package-level functions, not methods on `*Bus`. That's the language limitation, not a design choice.

**Follow-up to expect:** Why `reflect.Type` and not `string`? Answer: types are unforgeable; strings drift. Two packages can both define a type named `"CreateOrder"`. Only one `reflect.Type` exists per Go type.

---

### Q17. What's the Outbox pattern and how does it relate to Command?

**Short answer:** The Outbox pattern solves the "I committed to my DB but failed to publish to the queue" dual-write problem. Instead of writing to the queue directly, you write the command into an `outbox` table in the *same transaction* as the business state. A separate worker reads the outbox and publishes to the real queue, then marks the row sent. The command struct is what goes into the outbox row's payload column.

This is Command in its purest form: the work is reified as a row in the database, then a worker (the invoker) executes it. The pattern gives you exactly-once-effectively semantics for the publish step — no command, no transaction; transaction, eventually-published command.

---

### Q18. Idempotency: where does the key live, and why?

**Short answer:** The idempotency key lives on the *command struct itself*, not on the handler. The handler checks `processed_keys` table or Redis SET-NX before doing work and short-circuits if the key was seen. Reasons: (1) the key must survive retries — if the handler chooses it, retries pick different keys; (2) the key must be visible at the queue layer for deduplication before work runs; (3) the producer is the only one who knows the *logical* request boundary — the consumer just sees bytes.

A senior answer mentions both the **at-least-once delivery** guarantee of every real queue and the **idempotent handler** requirement that follows from it. No idempotency story means duplicate side effects in production — duplicate emails, duplicate charges, duplicate signups.

---

### Q19. Saga vs nested transaction — when to use which.

**Short answer:** Use a **nested transaction** (or just one transaction) when everything you touch is in the same database. Use a **Saga** when the work spans services or systems that have no shared transaction. A Saga is a list of commands where each has a compensating command; on failure you run the inverses in reverse order. It's eventual consistency by design — there are moments where the world is partially updated. Nested transactions give you ACID; Sagas give you "eventually correct, with reversible steps".

**Follow-up to expect:** What if a compensating command also fails? Answer: you escalate. Log, alert, write to a dead-letter table, and require human intervention. There's no purely automatic recovery from a Saga that can't compensate — that's the price of distributed-transaction-by-choice.

---

### Q20. How do you observe a command's execution end-to-end?

**Short answer:** Four signals: (1) a **span** opened when the command enters the bus and closed when the handler returns, with attributes for command type, idempotency key, attempt count; (2) **counters** for `commands_total{type,outcome}` so you can graph success/failure ratios per command type; (3) a **histogram** for `command_duration_seconds{type}` to spot slowdowns; (4) **structured logs** at queue-enter, dequeue, handler-start, handler-end, with the trace ID linking them. The bus is the natural place to add all four — wrap every handler at registration time, don't ask handlers to instrument themselves.

---

### Q21. A worker thread is stuck on a Command — how do you cancel it safely?

**Short answer:** You can't cancel a goroutine externally in Go. The only way is for the command to honor `ctx`. The worker holds a `context.WithTimeout` per job and cancels it on the deadline. If the command's I/O honors the context (DB, HTTP, gRPC all do), it returns with `context.DeadlineExceeded` and the worker continues. If the command does CPU-bound work without checking `ctx.Done()`, you're stuck — the only escape is restarting the process.

Production lesson: every long-running command must check `ctx.Done()` in its inner loop. Every CPU-bound command must yield periodically. Every external call must take `ctx`. A worker pool whose oldest goroutine has been running for 4 hours has a bug, not a feature.

---

### Q22. Versioning serialized commands without breaking consumers.

**Short answer:** Three rules. (1) **Additive changes only on minor bumps** — adding optional fields with sensible zero-value defaults is safe. JSON ignores unknown fields by default. (2) **Discriminator includes a version** — `Type: "send-email/v2"` is a different command, with its own handler, coexisting with `send-email/v1` until the queue drains. (3) **Never reuse field names with different meanings** — if `Address` changed from string to struct, that's a new command type, not a v1 evolution. The principle: queues outlive deployments. A command produced by v1.4 might be consumed by v1.7. Both must survive every version that touches the queue between them.

**Follow-up to expect:** How do you drain the old version? Answer: keep both handlers registered until your queue's max retention window passes with zero v1 messages. Then remove `send-email/v1` from the registry. Measured in days for most queues.

---

## 5. Staff/Architect questions (Q23–Q25)

### Q23. Walk me through designing a job queue from scratch. What's a Command, what's a Job, what's a Task?

**Short answer:** Three layers, named deliberately.

A **Command** is the logical request — what the producer wants done. `SendWelcomeEmail{UserID: 42}`. It's a serialized struct on the wire. The producer knows nothing about scheduling, retries, or workers.

A **Job** is the queue-layer wrapper around the command: idempotency key, attempt count, scheduled-at, deadline, trace context, dead-letter status. The queue speaks Jobs; handlers speak Commands. The queue unwraps a Job, gives the handler the Command and a context with the deadline baked in.

A **Task** is the in-process execution unit — the goroutine running the handler with a per-attempt context. Tasks have lifetimes shorter than Jobs (a Job survives across retries; a Task is one attempt).

Design choices a staff candidate justifies: a *named registry* so handlers are looked up by command type, not by goroutine; *bounded queues* so backpressure propagates instead of OOM; *exponential backoff with jitter* on retry; *per-command-type concurrency limits* so a slow command doesn't starve fast ones; *dead-letter queue* for commands that exhaust retries; *observability hooks* baked into the bus, not bolted on per handler. The interesting question is what you *don't* build — most teams should use `asynq`, `river`, or SQS+Lambda rather than rolling their own. Staff signal: knowing when to buy, not just how to build.

---

### Q24. A handler panics on a poison command. Design the dead-letter pipeline.

**Short answer:** Five components.

(1) **`recover` in the worker**, not in the handler. The worker wraps every handler call in `defer func() { if r := recover(); r != nil { ... } }()`. Handlers don't know they're protected; they write straight-line code.

(2) **Attempt tracking**. The Job's `attempts` field increments on every dequeue, before the handler runs. On panic or error, the worker decides: retry, dead-letter, or drop. Maximum attempts is a per-command-type config — payment retries are different from email retries.

(3) **Dead-letter queue**. A separate queue or table that receives Jobs whose attempts exceeded the limit. Includes the full Command payload, the last error message, the stack trace from the panic, the attempt history, the original enqueue time. Never auto-replays — replay is explicit.

(4) **Alerting on DLQ depth**. A non-zero DLQ depth is an incident signal. Pager fires on rate, dashboard shows by command type. The DLQ is for human eyes, not automatic recovery.

(5) **Replay tooling**. A CLI that reads a DLQ entry, lets a human inspect and edit the payload, and re-enqueues it to the main queue with attempts reset. Staff candidates explicitly call this out — DLQs without replay tools become write-only and accumulate forever.

Staff signal: the dead-letter is one of three failure modes, not the only one. The other two are *retryable transient* (network blip, retry with backoff) and *unretryable not-poison* (invalid input that the handler rejects fast — fail it permanently without filling the DLQ).

---

### Q25. The Command Bus has grown to 200 handlers and is now the application. Refactor it.

**Short answer:** Six moves, in order.

(1) **Group handlers by bounded context, not by transport**. The 200 handlers aren't 200 unrelated things — they're maybe 12 domains (auth, billing, catalog, orders, shipping, notifications, ...). Each domain gets its own bus, or at least its own registration package. The application's entry-point bus is a router that fans out to domain buses.

(2) **Separate command and query**. If queries crept into the command bus ("GetUserByID"), split them. Commands change state and may fail; queries are reads. They don't share retry semantics, idempotency, or dead-letter pipelines. Two buses, different infrastructure.

(3) **Extract domain modules**. Each domain is its own Go module or at least its own internal package — `internal/auth`, `internal/billing`. Commands and handlers live next to their domain logic, not in a central `bus.go`.

(4) **Standardize a handler shape**. `func(ctx context.Context, cmd T) (Result, error)`. Generics in registration. Middleware wraps every handler — auth, tenant scoping, logging, metrics, tracing, transaction boundaries. Wrappers compose; handlers stay straight-line.

(5) **Define a stability contract**. Commands that cross a process boundary (HTTP request payloads, queue messages) are versioned, documented, owned by the domain that produces them. In-process commands can churn.

(6) **Force a domain to own its commands**. The biggest organizational lesson: 200 handlers in one bus means everyone touches everyone's code. After refactor, modifying an `OrderCreated` handler should require auth from the orders team, not from anyone with commit access.

Staff signal: this isn't a Go question, it's a software-architecture question. The interviewer is checking whether you reach for DDD/bounded contexts, whether you split read from write, and whether you understand that the bus pattern at scale is just service composition. The answer "rewrite it as microservices" is wrong unless the team-size argument supports it; the answer "leave it alone, it works" is also wrong if you can't explain *why* it works.

---

## 6. Live-coding prompts

### Prompt 1: Worker pool with Command

**Problem.** Implement a fixed-size pool of workers reading `chan Command` with graceful shutdown. Each command takes a `context.Context`. The pool must:
- Run N goroutines.
- Process commands from a buffered channel.
- Shut down cleanly when its context is cancelled, draining nothing in-flight forcibly.
- Return a `Wait()` that blocks until all workers have exited.

**Answer.**

```go
package workerpool

import (
    "context"
    "log/slog"
    "sync"
)

// Command is the unit of work. Take ctx so cancellation propagates.
type Command func(ctx context.Context) error

type Pool struct {
    jobs chan Command
    wg   sync.WaitGroup
    log  *slog.Logger
}

// New constructs a pool of size workers with a buffered job queue of cap.
// Buffered (not unbounded) so producers experience backpressure when full —
// an unbounded channel hides slow consumers until OOM.
func New(ctx context.Context, size, cap int, log *slog.Logger) *Pool {
    p := &Pool{
        jobs: make(chan Command, cap),
        log:  log,
    }
    for i := 0; i < size; i++ {
        p.wg.Add(1)
        go p.loop(ctx, i)
    }
    return p
}

// Submit blocks until the queue accepts the job or ctx fires.
// Returning ctx.Err() (not a custom "queue full" error) lets callers use
// standard cancellation handling.
func (p *Pool) Submit(ctx context.Context, c Command) error {
    select {
    case p.jobs <- c:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

// Close signals shutdown. After Close, Submit panics (sending on closed chan).
// In production, gate Submit with an atomic flag — omitted here for clarity.
func (p *Pool) Close() { close(p.jobs) }

// Wait blocks until every worker has returned. Always call after Close.
func (p *Pool) Wait() { p.wg.Wait() }

func (p *Pool) loop(ctx context.Context, id int) {
    defer p.wg.Done()
    for {
        select {
        case <-ctx.Done():
            // Pool's parent context cancelled — exit without draining.
            // If you want drain-on-cancel, change this to a labeled select
            // that prefers the jobs channel until it's empty.
            return
        case job, ok := <-p.jobs:
            if !ok {
                // Channel closed and empty — clean exit.
                return
            }
            // Recover so one panicking command doesn't kill the worker.
            // The recover must be inside the loop iteration, not on the
            // goroutine — otherwise one panic terminates the worker.
            func() {
                defer func() {
                    if r := recover(); r != nil {
                        p.log.Error("worker panic", "worker", id, "panic", r)
                    }
                }()
                if err := job(ctx); err != nil {
                    p.log.Warn("job failed", "worker", id, "err", err)
                }
            }()
        }
    }
}
```

Senior moves: (a) buffered channel for backpressure, not unbounded; (b) `Submit` honors `ctx` so producers can cancel; (c) per-iteration `recover` so a panicking command kills the job, not the worker; (d) `ctx` plumbed into the command so cancellation propagates end-to-end; (e) `Close` separated from `Wait` so callers can shut down stages in order.

---

### Prompt 2: Reversible command stack

**Problem.** Implement an undo/redo stack for reversible commands with a maximum size. Old commands evict from the bottom. Calling `Undo` moves the top command from the *done* stack to the *redo* stack; `Redo` reverses. Any new command after an undo clears the redo stack (standard editor semantics).

**Answer.**

```go
package history

import (
    "context"
    "errors"
    "sync"
)

type Reversible struct {
    Name string
    Do   func(ctx context.Context) error
    Undo func(ctx context.Context) error
}

type Stack struct {
    mu    sync.Mutex
    done  []Reversible
    redo  []Reversible
    limit int
}

func New(limit int) *Stack { return &Stack{limit: limit} }

// Exec runs a new command and pushes it. Any pending redo history is cleared,
// matching editor semantics: after typing something new, you can't redo what
// was undone before.
func (s *Stack) Exec(ctx context.Context, r Reversible) error {
    if err := r.Do(ctx); err != nil {
        // Don't push on failure — the command never happened.
        return err
    }
    s.mu.Lock()
    defer s.mu.Unlock()
    s.done = append(s.done, r)
    if len(s.done) > s.limit {
        // Drop the oldest. Bounded history prevents OOM in long sessions.
        s.done = s.done[len(s.done)-s.limit:]
    }
    s.redo = nil
    return nil
}

var ErrNothingToUndo = errors.New("history: nothing to undo")
var ErrNothingToRedo = errors.New("history: nothing to redo")

func (s *Stack) Undo(ctx context.Context) error {
    s.mu.Lock()
    if len(s.done) == 0 {
        s.mu.Unlock()
        return ErrNothingToUndo
    }
    r := s.done[len(s.done)-1]
    s.done = s.done[:len(s.done)-1]
    s.mu.Unlock()

    // Run Undo *outside* the lock — it may do I/O and we shouldn't block Exec.
    if err := r.Undo(ctx); err != nil {
        // Undo failed. Push back so caller can retry, rather than losing
        // the operation entirely. Some systems prefer to drop it and log;
        // pick the policy that matches your domain.
        s.mu.Lock(); s.done = append(s.done, r); s.mu.Unlock()
        return err
    }
    s.mu.Lock(); s.redo = append(s.redo, r); s.mu.Unlock()
    return nil
}

func (s *Stack) Redo(ctx context.Context) error {
    s.mu.Lock()
    if len(s.redo) == 0 {
        s.mu.Unlock()
        return ErrNothingToRedo
    }
    r := s.redo[len(s.redo)-1]
    s.redo = s.redo[:len(s.redo)-1]
    s.mu.Unlock()

    if err := r.Do(ctx); err != nil {
        s.mu.Lock(); s.redo = append(s.redo, r); s.mu.Unlock()
        return err
    }
    s.mu.Lock(); s.done = append(s.done, r); s.mu.Unlock()
    return nil
}
```

Senior moves: (a) bounded `done` slice — unbounded history is a memory leak; (b) the lock is released *before* running `Do`/`Undo` so I/O doesn't block other operations; (c) failed `Undo` pushes back rather than swallowing — caller decides whether to retry; (d) new `Exec` clears `redo` — standard editor semantics; (e) sentinel errors so callers can distinguish "empty" from "failure".

---

### Prompt 3: Generics command bus

**Problem.** Build a `Bus` where `Handle[T any](bus, func(ctx, T) error)` registers a typed handler and `Send[T any](ctx, bus, cmd)` dispatches to it. Type-mismatch at send time must return a clear error, not panic.

**Answer.**

```go
package bus

import (
    "context"
    "fmt"
    "reflect"
    "sync"
)

type Bus struct {
    mu       sync.RWMutex
    handlers map[reflect.Type]func(context.Context, any) error
}

func New() *Bus {
    return &Bus{handlers: map[reflect.Type]func(context.Context, any) error{}}
}

// Handle registers a typed handler. Methods can't be generic in Go (as of
// 1.22), so this is a package-level function, not a method on *Bus.
func Handle[T any](b *Bus, h func(ctx context.Context, cmd T) error) {
    var zero T
    t := reflect.TypeOf(zero)
    // Guard against registering with a nil-interface T whose reflect.TypeOf
    // returns nil — would corrupt the map.
    if t == nil {
        panic("bus.Handle: cannot register handler for nil interface type")
    }
    b.mu.Lock()
    defer b.mu.Unlock()
    if _, exists := b.handlers[t]; exists {
        // Last-write-wins or panic — pick a policy and document it. We panic
        // because silent override is a hard bug to find later.
        panic(fmt.Sprintf("bus.Handle: duplicate handler for %s", t))
    }
    b.handlers[t] = func(ctx context.Context, v any) error {
        // Safe to type-assert: Send only dispatches by exact reflect.Type
        // match, so v's concrete type is always T.
        return h(ctx, v.(T))
    }
}

// Send dispatches cmd to the registered handler for its type.
func Send[T any](ctx context.Context, b *Bus, cmd T) error {
    t := reflect.TypeOf(cmd)
    b.mu.RLock()
    h, ok := b.handlers[t]
    b.mu.RUnlock()
    if !ok {
        return fmt.Errorf("bus: no handler for %s", t)
    }
    return h(ctx, cmd)
}

// Example usage:
//
//   type CreateOrder struct{ UserID string; Total int }
//
//   b := bus.New()
//   bus.Handle[CreateOrder](b, func(ctx context.Context, c CreateOrder) error {
//       // ... validate, persist, emit events
//       return nil
//   })
//
//   err := bus.Send(ctx, b, CreateOrder{UserID: "u1", Total: 1000})
```

Senior moves: (a) generics give type-safe registration with zero runtime cost at the handler boundary (the `.(T)` is checked at compile time at the registration site); (b) `reflect.Type` is the map key — strings would let two packages collide; (c) duplicate registration panics rather than silently overwriting — fail loud at startup, not at first call; (d) explicit nil-type guard so passing `Handle[any]` doesn't poison the map; (e) `Send` returns an error for missing handler, doesn't panic — runtime missing-handler should be recoverable, not fatal.

---

## 7. Concept checks

If you can't answer any of these in one breath, study more before the interview.

- What's the difference between a Command and an Event? (Command: imperative, addressed, may be rejected. Event: declarative, broadcast, already happened.)
- Why does `chan Command` of unbounded size kill services? (No backpressure; producers outrun consumers until OOM.)
- When was the for-range loop-variable capture bug fixed? (Go 1.22, February 2024.)
- What's the failure mode of a Command that doesn't take `context.Context`? (Can't be cancelled or timed out — stuck workers, no graceful shutdown.)
- Why must serialized commands have a discriminator field? (Consumer has bytes; needs to know which Go type to unmarshal into.)
- What's the difference between Command and Strategy? (Command is *what to do, deferred*. Strategy is *how to do it, swappable*.)
- Why is the idempotency key on the Command, not the handler? (Survives retries; visible at queue layer; producer owns the request identity.)
- What's the Outbox pattern in one sentence? (Write the command to a DB table in the same transaction as state, then a separate worker publishes — fixes the dual-write problem.)
- What does `sync.Once` give you that a `bool` doesn't? (Memory-safe one-time execution under concurrency; the `bool` is a data race.)
- When should `Undo` not be called? (When `Do` failed — the command never happened, there's nothing to reverse.)
- Why are queues "at-least-once" and not "exactly-once"? (To deliver exactly once you'd need a distributed transaction between the queue and the handler — practically impossible at scale.)
- What's the difference between a Saga and a database transaction? (Saga is application-level compensation across services; transaction is DB-level ACID. Saga is eventual; transaction is atomic.)
- Why do most Go codebases prefer `func(ctx) error` over a `Command` interface? (Less ceremony, idiomatic closure capture, no per-action type declaration.)
- What's the lifetime relationship between a Job, a Command, and a Task? (Command < Job < execution; Job wraps Command with metadata; Task is one attempt; Job survives Task failures across retries.)
- Why does a Dead-Letter Queue need a replay tool? (Without it, the DLQ is write-only and accumulates forever — a backlog you can never resolve.)

---

## 8. Red flags for interviewers

These signal a weak candidate.

- **Building a class hierarchy for what could be a function.** `type Command interface { Execute() }` plus three structs to wrap three lambdas. Idiomatic Go is `func(ctx) error`; reaching for the interface form by default suggests the candidate hasn't internalized Go's first-class functions.
- **Ignoring `context`.** A Command without `ctx` is unsignalable, untimeable, untraceable. If the candidate's first design has no `ctx` parameter, they haven't built a real worker pool.
- **No idempotency story.** "We'll just retry on failure" without addressing duplicate effects means the candidate has never been on call for a queue. Production-grade answers always mention idempotency keys or natural idempotency.
- **No observability mention.** A Command Bus is a hairball without per-command metrics and tracing. Candidates who don't reach for spans, counters, and structured logs haven't operated one.
- **Confusing Command with Event.** Suggesting that a "OrderCreated" Command is the same as a "OrderCreated" Event. They differ in intent (imperative vs declarative), in receivers (one handler vs many subscribers), and in failure semantics (Command can be rejected; Event already happened).
- **Unbounded channels.** Proposing a `chan Command` without a buffer size or with no backpressure plan. In production, this is the path to OOM.
- **No DLQ design.** Asked about poison messages, the candidate says "we retry forever" or "we drop them silently". Both are operational catastrophes.
- **`reflect` for things generics solve.** Reaching for `reflect.TypeOf` in a Go 1.22+ codebase where generic registration would be cleaner suggests stale Go knowledge.

---

## 9. Strong-candidate signals

These signal a strong candidate.

- **Defaulting to `func(ctx context.Context) error`.** The interface form is justified, not assumed.
- **Escalating to a struct only for serialization, inspection, or registry dispatch.** The candidate names the specific reason — not "structs are more OO".
- **Naming commands as imperative verbs.** `CreateOrder`, `SendEmail`, `RefundCharge`. Not `OrderCommand` or `EmailMessage`. The candidate understands that Commands describe an action, not a thing.
- **Asking about backpressure.** Before designing the bus, the candidate asks: what happens when the queue fills? Bounded buffer, blocking submit, drop policy, return error to caller — they have an opinion.
- **Mentioning the Outbox pattern.** Unprompted, when asked about queue publishes during state changes. Signals familiarity with production failure modes.
- **Splitting Command from Query.** Reading the room for CQRS-style splits — recognizing that GETs don't belong on a Command Bus.
- **Discussing schema evolution.** "What happens when we change `SendEmail`'s fields six months from now?" — proves they've maintained a queue past the initial launch.
- **Bringing up `recover` in the worker, not the handler.** Shows the candidate has debugged a queue that died from a single bad message.
- **Asking who owns the registry.** In a 200-handler system, the candidate asks about module boundaries, team ownership, deployment coupling. Architectural thinking, not just code-level.
- **Mentioning at-least-once and its consequences.** Knowing that every real queue is at-least-once and that handlers must therefore be idempotent is the line between a junior who has read about queues and a senior who has run one.

---

## 10. Further reading

- **Refactoring.Guru — Command**: <https://refactoring.guru/design-patterns/command> — the canonical pattern description, language-agnostic. Read for the GoF framing.
- **`hibiken/asynq`**: <https://github.com/hibiken/asynq> — Go background job library built on Redis. Production-quality Command implementation with retries, scheduling, dead-letters. Read the source for `Task` and `Handler`.
- **`spf13/cobra`**: <https://github.com/spf13/cobra> — the CLI framework where every subcommand is a Command-pattern object. Useful contrast: same pattern, different problem (CLI dispatch vs job queue).
- **Microsoft — Transactional Outbox**: <https://learn.microsoft.com/en-us/azure/architecture/patterns/outbox> — the Outbox pattern formalized, with sequence diagrams. Required reading if your system writes to a DB and a queue.
- **Sam Newman, *Building Microservices* (2nd ed.), chapters on Sagas**: Compensating commands, choreography vs orchestration, failure modes. The canonical treatment of Command in a distributed setting.

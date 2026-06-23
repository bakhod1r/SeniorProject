# Command Pattern — Hands-on Tasks

## 1. How to use this file

Fifteen progressive tasks, ordered from "your first Command" to "design a job queue you would actually deploy". Each task has:

- **Goal** — one sentence stating what you are building and why.
- **Starter** — an incomplete sketch. Type it out by hand, do not paste.
- **Hints** — bullets you can read when stuck. Avoid them on the first pass.
- **Reference solution** — a collapsible, complete, compileable Go program. Senior decisions are called out in comments inside the code.

The code targets Go 1.22+ (`for` loop variable scoping, `sync.OnceValue`, generics, `errors.Join`). Every solution is self-contained `package main` unless noted — `go run file.go` should work.

The arc: start with a bare `func() error`, grow it into a struct with `Execute(ctx)`, hang queues and retries off it, dispatch it by type with `reflect` and then with generics, weave it into a saga, dedupe by idempotency key, and finally land on a small but production-shaped job queue.

---

## 2. Difficulty legend

| Tag | Level | What it means |
|-----|-------|---------------|
| **B** | Beginner | Reach for closures, basic structs, and `for range`. Roughly junior.md territory. |
| **I** | Intermediate | Context, channels, decorators, small concurrency. Maps to middle.md. |
| **A** | Advanced | Generics, reflection, sagas, the outbox pattern, observability. |
| **S** | Stretch | One bigger project that combines everything. |

---

## 3. Tasks

### Task 1 (B) — A first Command

**Goal:** Define `type Command func() error`, write three commands as function values, and run them in a loop. This is the smallest possible Command pattern in Go.

**Starter:**

```go
package main

import "fmt"

type Command func() error

func main() {
    cmds := []Command{
        // TODO: three function values
    }
    for _, c := range cmds {
        // TODO: call c, print error if any
    }
    _ = fmt.Sprintf // remove once you use fmt
}
```

**Hints:**

- A `Command` is just a function value — `func() error { ... }` literal works.
- The invoker (`main`) does not know what each command does. That is the whole point.
- Make one of the commands return a real error so you see the failure branch.

<details><summary>Reference solution</summary>

```go
package main

import (
    "errors"
    "fmt"
)

// Command is the smallest Command pattern in Go: just a function value.
// No interface, no struct, no Execute method. This shape is what 90% of
// production Go code looks like when it uses Command.
type Command func() error

func main() {
    cmds := []Command{
        func() error { fmt.Println("save file"); return nil },
        func() error { fmt.Println("send email"); return nil },
        func() error { return errors.New("payment declined") },
    }

    // The invoker has zero knowledge of what each command does.
    // It only knows the signature.
    for i, c := range cmds {
        if err := c(); err != nil {
            fmt.Printf("cmd %d failed: %v\n", i, err)
        }
    }
}
```

</details>

---

### Task 2 (B) — Command with parameters

**Goal:** Use a closure to capture parameters. Write `func makeWrite(path, data string) Command` that returns a command which, when called, writes `data` to `path`.

**Starter:**

```go
package main

import "os"

type Command func() error

func makeWrite(path, data string) Command {
    // TODO: return a closure that writes data to path
    return nil
}

func main() {
    cmd := makeWrite("/tmp/cmd-task2.txt", "hello")
    _ = cmd()
    _ = os.Remove
}
```

**Hints:**

- The closure captures `path` and `data` by reference, but since they are passed by value to `makeWrite`, the captured value is stable.
- `os.WriteFile(path, []byte(data), 0o644)` is the one-liner.
- Building commands this way is how every retry/queue helper in Go ends up looking.

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "os"
)

type Command func() error

// makeWrite is a Command factory. The returned closure carries its
// arguments in a private environment — callers cannot mutate them.
// This is the idiomatic Go form of "parameterised request".
func makeWrite(path, data string) Command {
    return func() error {
        return os.WriteFile(path, []byte(data), 0o644)
    }
}

func main() {
    cmds := []Command{
        makeWrite("/tmp/cmd-task2-a.txt", "alpha"),
        makeWrite("/tmp/cmd-task2-b.txt", "beta"),
    }
    for i, c := range cmds {
        if err := c(); err != nil {
            fmt.Printf("cmd %d: %v\n", i, err)
        }
    }
    // cleanup so reruns are idempotent
    for _, p := range []string{"/tmp/cmd-task2-a.txt", "/tmp/cmd-task2-b.txt"} {
        _ = os.Remove(p)
    }
}
```

</details>

---

### Task 3 (B) — Struct-based Command

**Goal:** Same behaviour as task 2 but as a struct with `Execute() error`. You now have two equivalent shapes: a function value and a struct method.

**Starter:**

```go
package main

type Command interface {
    Execute() error
}

type WriteFile struct {
    Path, Data string
}

// TODO: implement Execute on *WriteFile or WriteFile (which one, and why?)

func main() {
    var c Command = &WriteFile{Path: "/tmp/cmd-task3.txt", Data: "hi"}
    _ = c.Execute()
}
```

**Hints:**

- Pointer receiver vs value receiver: prefer value here — `WriteFile` has no mutable state and is small. Pointer would also work; the trade-off is allocation vs zero-cost interface satisfaction.
- Compile-time guarantee: `var _ Command = WriteFile{}` (or `(*WriteFile)(nil)` for a pointer receiver) tells the compiler to enforce the interface.

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "os"
)

type Command interface {
    Execute() error
}

// WriteFile carries the request as data. No closures, no captured
// scope — just a struct you can JSON-marshal, log, or store on a queue.
type WriteFile struct {
    Path string
    Data string
}

// Value receiver: WriteFile is small and immutable; no reason to allocate.
func (w WriteFile) Execute() error {
    return os.WriteFile(w.Path, []byte(w.Data), 0o644)
}

// Compile-time check that the interface is satisfied. Saves a debugging trip
// when someone later changes the method signature.
var _ Command = WriteFile{}

func main() {
    cmds := []Command{
        WriteFile{Path: "/tmp/cmd-task3-a.txt", Data: "alpha"},
        WriteFile{Path: "/tmp/cmd-task3-b.txt", Data: "beta"},
    }
    for _, c := range cmds {
        if err := c.Execute(); err != nil {
            fmt.Println("execute:", err)
        }
    }
    for _, p := range []string{"/tmp/cmd-task3-a.txt", "/tmp/cmd-task3-b.txt"} {
        _ = os.Remove(p)
    }
}
```

</details>

---

### Task 4 (B) — Compare both forms

**Goal:** Write the same `SendEmail` command in two shapes — once as a closure-producing factory, once as a struct with `Execute()`. In comments, note which is shorter and what is lost in each.

**Starter:**

```go
package main

// closure form
type CommandFunc func() error
// TODO: makeSendEmail(to, subject, body string) CommandFunc

// struct form
type Command interface{ Execute() error }
// TODO: type SendEmail struct{ ... }; func (s SendEmail) Execute() error
```

**Hints:**

- Closure form: shortest, but the closure is opaque — you cannot print it, serialize it to JSON, or ask "what command is this?".
- Struct form: more types, but you get `fmt.Printf("%+v", cmd)` for free, you can store it on a Redis queue as JSON, and you can switch on its type.
- Neither is "better" — choose by whether the command crosses a boundary.

<details><summary>Reference solution</summary>

```go
package main

import (
    "encoding/json"
    "fmt"
)

// ---------------- closure form ----------------

type CommandFunc func() error

// Shortest possible. Cannot inspect, name, or serialize.
func makeSendEmail(to, subject, body string) CommandFunc {
    return func() error {
        fmt.Printf("[closure] sending to=%s subject=%q\n", to, subject)
        _ = body
        return nil
    }
}

// ---------------- struct form ----------------

type Command interface {
    Execute() error
}

// More boilerplate; in exchange you get reflection, JSON, and pretty-print.
type SendEmail struct {
    To      string `json:"to"`
    Subject string `json:"subject"`
    Body    string `json:"body"`
}

func (s SendEmail) Execute() error {
    fmt.Printf("[struct]  sending to=%s subject=%q\n", s.To, s.Subject)
    return nil
}

func main() {
    cf := makeSendEmail("a@b.c", "hi", "body")
    _ = cf()
    // The closure is opaque — best we can do is the function pointer.
    fmt.Printf("closure value: %T\n", cf)

    se := SendEmail{To: "a@b.c", Subject: "hi", Body: "body"}
    _ = se.Execute()
    fmt.Printf("struct value:  %+v\n", se)
    // And here is the killer feature of the struct form:
    payload, _ := json.Marshal(se)
    fmt.Printf("serialized:    %s\n", payload)
    // A closure cannot do this. encoding/json gives up on func types.

    // Rule of thumb:
    //   - in-process, ephemeral, defined-where-used  -> closure
    //   - crosses a queue / disk / network, needs name+log -> struct
}
```

</details>

---

### Task 5 (I) — Command with context

**Goal:** Convert task 3 to take `Execute(ctx context.Context) error`. Make a `SleepyJob` that respects cancellation: if the context is cancelled while sleeping, return `ctx.Err()`.

**Starter:**

```go
package main

import (
    "context"
    "time"
)

type Command interface {
    Execute(ctx context.Context) error
}

type SleepyJob struct {
    Dur time.Duration
}

// TODO: implement Execute that returns on either time.After(Dur) OR ctx.Done()
```

**Hints:**

- `select { case <-time.After(d): return nil; case <-ctx.Done(): return ctx.Err() }`.
- A command that does not take a `ctx` cannot be cancelled. For anything that does I/O or sleeps, that is a liability.
- Demo with `context.WithTimeout(ctx, 100ms)` against a `SleepyJob{Dur: 1s}` and see the timeout fire.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "fmt"
    "time"
)

type Command interface {
    Execute(ctx context.Context) error
}

// SleepyJob simulates a long-running command that respects cancellation.
// Real commands wrap http.Get, db.Query, etc — all of which take ctx.
type SleepyJob struct {
    Name string
    Dur  time.Duration
}

func (j SleepyJob) Execute(ctx context.Context) error {
    select {
    case <-time.After(j.Dur):
        fmt.Printf("%s: done\n", j.Name)
        return nil
    case <-ctx.Done():
        // Senior decision: return ctx.Err() directly so callers can
        // errors.Is(err, context.Canceled) / context.DeadlineExceeded.
        return fmt.Errorf("%s: %w", j.Name, ctx.Err())
    }
}

func main() {
    short, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
    defer cancel()

    cmds := []Command{
        SleepyJob{Name: "fast", Dur: 10 * time.Millisecond},
        SleepyJob{Name: "slow", Dur: 1 * time.Second}, // will be cancelled
    }
    for _, c := range cmds {
        if err := c.Execute(short); err != nil {
            fmt.Println("error:", err)
        }
    }
}
```

</details>

---

### Task 6 (I) — A small worker pool

**Goal:** Spawn N workers that read commands from `chan Command` and execute them. Graceful shutdown via context. Closing the channel must drain remaining work.

**Starter:**

```go
package main

import (
    "context"
    "sync"
)

type Command func(ctx context.Context) error

type Pool struct {
    jobs chan Command
    wg   sync.WaitGroup
}

// TODO: NewPool(n int) *Pool; spawn n workers
// TODO: (p *Pool) Submit(c Command)
// TODO: (p *Pool) Stop() — close jobs, wait for workers
```

**Hints:**

- Each worker is a `go` loop `for c := range p.jobs { c(ctx) }`.
- `Stop()` closes `p.jobs` and `wg.Wait()`s. Closing the channel signals the range loop to exit when drained.
- For cancellation mid-job, the worker's loop should also `select` on `ctx.Done()` — your call whether to drop in-flight work or wait it out.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

type Command func(ctx context.Context) error

// Pool is a fixed-size worker pool reading Commands from a channel.
// Real production pools add: per-job timeout, metrics, panic recovery,
// priority queue, dead-letter — see task 15 for the full shape.
type Pool struct {
    jobs    chan Command
    wg      sync.WaitGroup
    ctx     context.Context
    cancel  context.CancelFunc
}

func NewPool(parent context.Context, workers, queueSize int) *Pool {
    ctx, cancel := context.WithCancel(parent)
    p := &Pool{
        jobs:   make(chan Command, queueSize), // bounded — see senior checklist
        ctx:    ctx,
        cancel: cancel,
    }
    for i := 0; i < workers; i++ {
        p.wg.Add(1)
        go p.worker(i)
    }
    return p
}

func (p *Pool) worker(id int) {
    defer p.wg.Done()
    for c := range p.jobs {
        if err := c(p.ctx); err != nil {
            fmt.Printf("worker %d: %v\n", id, err)
        }
    }
}

func (p *Pool) Submit(c Command) {
    // No select on ctx here — caller might want backpressure.
    p.jobs <- c
}

// Stop closes the queue and waits for in-flight work. To abort in-flight
// work too, call p.cancel() first.
func (p *Pool) Stop() {
    close(p.jobs)
    p.wg.Wait()
    p.cancel()
}

func main() {
    p := NewPool(context.Background(), 3, 8)
    for i := 0; i < 6; i++ {
        i := i
        p.Submit(func(ctx context.Context) error {
            time.Sleep(20 * time.Millisecond)
            fmt.Printf("job %d done\n", i)
            return nil
        })
    }
    p.Stop()
    fmt.Println("pool stopped")
}
```

</details>

---

### Task 7 (I) — Reversible commands

**Goal:** Define `type Reversible struct { Do, Undo func() error }`. Build a `History` with `Push(r) (runs Do then records)`, `UndoLast() error`, and `Len() int`. Think of it as a tiny editor history.

**Starter:**

```go
package main

type Reversible struct {
    Do, Undo func() error
}

type History struct {
    done []Reversible
}

// TODO: Push, UndoLast, Len
```

**Hints:**

- `Push` runs `Do`; only on success does it append to `done`.
- `UndoLast` pops the tail and runs its `Undo`.
- This is the foundation for editors, schema migrations, and saga compensations.

<details><summary>Reference solution</summary>

```go
package main

import (
    "errors"
    "fmt"
)

// Reversible is a command that can be undone. Production examples:
// migration up/down, editor insert/delete, configuration commit/rollback.
type Reversible struct {
    Name string
    Do   func() error
    Undo func() error
}

type History struct {
    done []Reversible
}

func (h *History) Push(r Reversible) error {
    if err := r.Do(); err != nil {
        // Senior decision: do not record half-applied commands.
        return fmt.Errorf("Do %s: %w", r.Name, err)
    }
    h.done = append(h.done, r)
    return nil
}

func (h *History) UndoLast() error {
    if len(h.done) == 0 {
        return errors.New("history empty")
    }
    last := h.done[len(h.done)-1]
    h.done = h.done[:len(h.done)-1]
    if err := last.Undo(); err != nil {
        // Best practice: do NOT re-push a failed undo back on the stack.
        // The state is unknown; surface to the caller.
        return fmt.Errorf("Undo %s: %w", last.Name, err)
    }
    return nil
}

func (h *History) Len() int { return len(h.done) }

func main() {
    var x int
    h := &History{}

    _ = h.Push(Reversible{
        Name: "+5",
        Do:   func() error { x += 5; return nil },
        Undo: func() error { x -= 5; return nil },
    })
    _ = h.Push(Reversible{
        Name: "*2",
        Do:   func() error { x *= 2; return nil },
        Undo: func() error { x /= 2; return nil },
    })
    fmt.Println("after pushes:", x) // 10

    _ = h.UndoLast()
    fmt.Println("after one undo:", x) // 5
    _ = h.UndoLast()
    fmt.Println("after two undos:", x) // 0
    fmt.Println("history len:", h.Len())
}
```

</details>

---

### Task 8 (I) — Command queue with retries

**Goal:** Build a queue where every failed command is re-enqueued up to `N` times. After `N` failures, it is dropped with a structured log line.

**Starter:**

```go
package main

import "context"

type Command func(ctx context.Context) error

type job struct {
    cmd      Command
    attempts int
}

type RetryQueue struct {
    jobs chan job
    max  int
}

// TODO: NewRetryQueue, Submit(cmd), run loop that re-enqueues on failure
```

**Hints:**

- Use a buffered channel so re-enqueue does not deadlock with a single worker.
- Increment `attempts` on every failure; drop when `attempts >= max`.
- Add a backoff: `time.Sleep(time.Duration(j.attempts) * 50ms)` before re-submitting, otherwise a permanently-failing command burns CPU.

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

type Command func(ctx context.Context) error

type job struct {
    name     string
    cmd      Command
    attempts int
}

type RetryQueue struct {
    jobs chan job
    max  int
    log  *slog.Logger
    wg   sync.WaitGroup
}

func NewRetryQueue(buf, maxAttempts int) *RetryQueue {
    return &RetryQueue{
        jobs: make(chan job, buf),
        max:  maxAttempts,
        log:  slog.New(slog.NewTextHandler(os.Stdout, nil)),
    }
}

func (q *RetryQueue) Submit(name string, c Command) {
    q.jobs <- job{name: name, cmd: c}
}

func (q *RetryQueue) Run(ctx context.Context, workers int) {
    for i := 0; i < workers; i++ {
        q.wg.Add(1)
        go q.worker(ctx, i)
    }
}

func (q *RetryQueue) worker(ctx context.Context, id int) {
    defer q.wg.Done()
    for {
        select {
        case <-ctx.Done():
            return
        case j, ok := <-q.jobs:
            if !ok {
                return
            }
            err := j.cmd(ctx)
            if err == nil {
                q.log.Info("ok", "name", j.name, "attempts", j.attempts+1, "worker", id)
                continue
            }
            j.attempts++
            if j.attempts >= q.max {
                // Senior decision: structured log so this is queryable in
                // production. The "dropped" event is the signal ops needs.
                q.log.Error("dropped", "name", j.name, "attempts", j.attempts, "err", err.Error())
                continue
            }
            // Linear backoff. In production, exponential + jitter.
            time.Sleep(time.Duration(j.attempts) * 50 * time.Millisecond)
            // Non-blocking re-enqueue — if the channel is full, we drop.
            select {
            case q.jobs <- j:
            default:
                q.log.Error("requeue-full", "name", j.name, "attempts", j.attempts)
            }
        }
    }
}

func (q *RetryQueue) Stop() {
    close(q.jobs)
    q.wg.Wait()
}

func main() {
    q := NewRetryQueue(16, 3)
    q.Run(context.Background(), 2)

    var tries int
    q.Submit("flaky", func(ctx context.Context) error {
        tries++
        if tries < 3 {
            return errors.New("transient")
        }
        return nil
    })
    q.Submit("always-fails", func(ctx context.Context) error {
        return errors.New("permanent")
    })

    time.Sleep(500 * time.Millisecond) // wait for retries to settle
    q.Stop()
    fmt.Println("done")
}
```

</details>

---

### Task 9 (I) — Command logging decorator

**Goal:** Write a decorator that wraps any command and logs its name, duration, and error. This is where Command meets Decorator.

**Starter:**

```go
package main

import (
    "context"
    "time"
)

type Command func(ctx context.Context) error

// TODO: func Logged(name string, c Command) Command
// must: log name, run c, measure duration, log err (if any), return err
```

**Hints:**

- The decorator returns a new `Command` that wraps the inner one.
- `start := time.Now(); err := c(ctx); dur := time.Since(start)`.
- Use `log/slog` so the output is structured — that becomes important when 10k jobs per minute are running.
- Returning the original error untouched is mandatory; the decorator must not swallow.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "errors"
    "log/slog"
    "os"
    "time"
)

type Command func(ctx context.Context) error

var log = slog.New(slog.NewTextHandler(os.Stdout, nil))

// Logged wraps a Command, recording name + duration + error. Pure
// decorator: it must never alter the error returned by the inner command.
func Logged(name string, c Command) Command {
    return func(ctx context.Context) error {
        start := time.Now()
        err := c(ctx)
        attrs := []any{
            "cmd", name,
            "dur_ms", time.Since(start).Milliseconds(),
        }
        if err != nil {
            attrs = append(attrs, "err", err.Error())
            log.Error("cmd done", attrs...)
        } else {
            log.Info("cmd done", attrs...)
        }
        return err // do NOT swallow
    }
}

// Timed enforces a per-command deadline. Compose decorators by nesting.
func Timed(d time.Duration, c Command) Command {
    return func(ctx context.Context) error {
        ctx, cancel := context.WithTimeout(ctx, d)
        defer cancel()
        return c(ctx)
    }
}

func main() {
    okCmd := Logged("fast", Timed(50*time.Millisecond, func(ctx context.Context) error {
        time.Sleep(5 * time.Millisecond)
        return nil
    }))
    failCmd := Logged("flaky", func(ctx context.Context) error {
        return errors.New("kaboom")
    })

    _ = okCmd(context.Background())
    _ = failCmd(context.Background())
}
```

</details>

---

### Task 10 (A) — Command Bus with dispatch by type

**Goal:** Build a Bus that routes commands to handlers based on their concrete type, using `reflect.TypeOf`. Register handlers for `Ping` and `Echo`; the Bus picks the right one.

**Starter:**

```go
package main

import "reflect"

type Bus struct {
    handlers map[reflect.Type]func(any) error
}

type Ping struct{}
type Echo struct{ Msg string }

// TODO: NewBus, Register(cmd any, h func(any) error), Send(cmd any) error
```

**Hints:**

- `b.handlers[reflect.TypeOf(cmd)] = h` to register.
- `b.handlers[reflect.TypeOf(cmd)](cmd)` to send.
- Unknown command type must produce a clean error, not a nil-handler panic.
- This is the foundation of CQRS in many Go codebases — and the reason for task 11, which removes the `any`.

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "reflect"
)

// Bus dispatches commands to handlers keyed by concrete type. This is
// the classic CQRS dispatcher. The `any` in the handler signature is
// the cost of working at runtime; task 11 fixes that with generics.
type Bus struct {
    handlers map[reflect.Type]func(any) error
}

func NewBus() *Bus {
    return &Bus{handlers: map[reflect.Type]func(any) error{}}
}

func (b *Bus) Register(sample any, h func(any) error) {
    b.handlers[reflect.TypeOf(sample)] = h
}

func (b *Bus) Send(cmd any) error {
    t := reflect.TypeOf(cmd)
    h, ok := b.handlers[t]
    if !ok {
        // Typed error so callers can distinguish "wrong command" from
        // "handler failed".
        return fmt.Errorf("no handler for %s", t)
    }
    return h(cmd)
}

type Ping struct{}
type Echo struct{ Msg string }

func main() {
    bus := NewBus()
    bus.Register(Ping{}, func(_ any) error {
        fmt.Println("pong")
        return nil
    })
    bus.Register(Echo{}, func(c any) error {
        e := c.(Echo) // safe: dispatcher only calls us for Echo
        fmt.Println("echo:", e.Msg)
        return nil
    })

    _ = bus.Send(Ping{})
    _ = bus.Send(Echo{Msg: "hi"})
    if err := bus.Send(42); err != nil {
        fmt.Println("expected error:", err)
    }
}
```

</details>

---

### Task 11 (A) — Generics Command Bus (Go 1.18+)

**Goal:** Same Bus as task 10, but type-safe. `Register[T any](bus *Bus, h func(ctx, T) error)` and `Send[T any](bus *Bus, ctx, cmd T) error`. No `any` at the call site, no type assertions.

**Starter:**

```go
package main

import (
    "context"
    "reflect"
)

type Bus struct {
    handlers map[reflect.Type]any // still untyped inside the bus
}

// TODO: NewBus
// TODO: func Register[T any](b *Bus, h func(context.Context, T) error)
// TODO: func Send[T any](b *Bus, ctx context.Context, cmd T) error
```

**Hints:**

- Methods cannot have their own type parameters in Go (yet), so `Register` and `Send` are top-level functions that take the bus as an argument. This is the standard workaround.
- Inside the bus, you still store `any` (the type-erased handler). The generics only protect the boundary.
- `reflect.TypeFor[T]()` is a Go 1.22+ helper that avoids constructing a zero `T`.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "fmt"
    "reflect"
)

// Bus is type-erased internally but the Register/Send helpers below give
// callers a type-safe surface. This is the canonical "generic CQRS bus"
// shape since Go 1.18.
type Bus struct {
    handlers map[reflect.Type]any
}

func NewBus() *Bus { return &Bus{handlers: map[reflect.Type]any{}} }

// Register binds a typed handler for command type T.
// Note: methods can't be generic, so Register is a free function.
func Register[T any](b *Bus, h func(context.Context, T) error) {
    b.handlers[reflect.TypeFor[T]()] = h
}

// Send dispatches a typed command. The type parameter is usually
// inferred from cmd, so callers write `Send(bus, ctx, MyCommand{...})`.
func Send[T any](b *Bus, ctx context.Context, cmd T) error {
    h, ok := b.handlers[reflect.TypeFor[T]()]
    if !ok {
        return fmt.Errorf("no handler for %T", cmd)
    }
    // Safe: we only stored handler funcs of the matching type.
    return h.(func(context.Context, T) error)(ctx, cmd)
}

// --- commands ---

type CreateUser struct {
    Email string
}

type DeleteUser struct {
    ID string
}

func main() {
    bus := NewBus()

    Register(bus, func(ctx context.Context, c CreateUser) error {
        fmt.Println("creating user:", c.Email)
        return nil
    })
    Register(bus, func(ctx context.Context, c DeleteUser) error {
        fmt.Println("deleting user:", c.ID)
        return nil
    })

    ctx := context.Background()
    _ = Send(bus, ctx, CreateUser{Email: "a@b.c"})
    _ = Send(bus, ctx, DeleteUser{ID: "u1"})

    // Compile-time safety: passing a struct without a handler still
    // compiles but fails at runtime — generics don't track registration.
    type Unknown struct{}
    if err := Send(bus, ctx, Unknown{}); err != nil {
        fmt.Println("expected:", err)
    }
}
```

</details>

---

### Task 12 (A) — Saga executor

**Goal:** Run a slice of `Step{Name, Forward, Compensate func(ctx) error}`. If a step's `Forward` fails, run the `Compensate` of every previously-successful step in reverse. This is the saga pattern, used for cross-service transactions.

**Starter:**

```go
package main

import "context"

type Step struct {
    Name       string
    Forward    func(ctx context.Context) error
    Compensate func(ctx context.Context) error
}

// TODO: func RunSaga(ctx context.Context, steps []Step) error
```

**Hints:**

- Keep a `done` slice of indices (or steps) you have applied.
- On failure at step `i`, walk `done` in reverse and call each `Compensate`.
- A compensation that itself fails is a Big Deal — log it, but keep walking (you cannot stop midway through a rollback). Return both the original error and a summary of the compensation failures.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "errors"
    "fmt"
)

type Step struct {
    Name       string
    Forward    func(ctx context.Context) error
    Compensate func(ctx context.Context) error
}

// RunSaga executes steps in order. On the first Forward failure, it
// rolls back by running Compensate on every previously-successful step
// in reverse. A failing Compensate is logged but does NOT stop the
// rollback — you cannot half-rollback a distributed transaction.
func RunSaga(ctx context.Context, steps []Step) error {
    var done []Step
    for _, s := range steps {
        if err := s.Forward(ctx); err != nil {
            rbErr := compensate(ctx, done)
            if rbErr != nil {
                return fmt.Errorf("saga: %s: %w; rollback errors: %v", s.Name, err, rbErr)
            }
            return fmt.Errorf("saga: %s: %w", s.Name, err)
        }
        done = append(done, s)
    }
    return nil
}

func compensate(ctx context.Context, done []Step) error {
    var errs []error
    for i := len(done) - 1; i >= 0; i-- {
        if err := done[i].Compensate(ctx); err != nil {
            errs = append(errs, fmt.Errorf("compensate %s: %w", done[i].Name, err))
        }
    }
    return errors.Join(errs...) // errors.Join(nil) returns nil
}

func main() {
    ctx := context.Background()
    booked := map[string]bool{}

    steps := []Step{
        {
            Name:       "book-flight",
            Forward:    func(_ context.Context) error { booked["flight"] = true; return nil },
            Compensate: func(_ context.Context) error { delete(booked, "flight"); return nil },
        },
        {
            Name:       "book-hotel",
            Forward:    func(_ context.Context) error { booked["hotel"] = true; return nil },
            Compensate: func(_ context.Context) error { delete(booked, "hotel"); return nil },
        },
        {
            Name:       "book-car",
            Forward:    func(_ context.Context) error { return errors.New("no cars left") },
            Compensate: func(_ context.Context) error { return nil },
        },
    }

    if err := RunSaga(ctx, steps); err != nil {
        fmt.Println("saga failed:", err)
    }
    fmt.Println("final state:", booked) // empty: flight and hotel rolled back
}
```

</details>

---

### Task 13 (A) — Outbox pattern (in-memory)

**Goal:** Implement the transactional outbox pattern. A "transactional" function writes both the state change and an outbox record under the same lock. A background pump reads the outbox and dispatches the commands. This is how reliable event publishing is built when you do not have distributed transactions.

**Starter:**

```go
package main

import (
    "context"
    "sync"
)

type OutboxEntry struct {
    ID      int
    Cmd     func(ctx context.Context) error
}

type Store struct {
    mu      sync.Mutex
    state   map[string]string
    outbox  []OutboxEntry
    nextID  int
}

// TODO: (s *Store) TransactWrite(key, val string, cmd) — atomic state + outbox
// TODO: (s *Store) Pump(ctx) — drain outbox, dispatch commands, remove on success
```

**Hints:**

- The whole point: the state write and the outbox append happen under the *same* mutex (or, in real life, the same SQL transaction). This makes them effectively atomic.
- The pump runs in its own goroutine. On success, remove the entry; on failure, leave it for retry.
- Do not hold the mutex while running a command — only while reading or writing the outbox.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

type OutboxEntry struct {
    ID  int
    Cmd func(ctx context.Context) error
    // In a real outbox: serialized payload, type tag, created_at, attempts.
}

type Store struct {
    mu     sync.Mutex
    state  map[string]string
    outbox []OutboxEntry
    next   int
}

func NewStore() *Store {
    return &Store{state: map[string]string{}}
}

// TransactWrite is the "atomic" boundary. In production this is a single
// SQL transaction that INSERTs both the state and the outbox row.
func (s *Store) TransactWrite(key, val string, cmd func(ctx context.Context) error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.state[key] = val
    s.next++
    s.outbox = append(s.outbox, OutboxEntry{ID: s.next, Cmd: cmd})
}

// dequeue returns a snapshot of pending entries.
func (s *Store) dequeue() []OutboxEntry {
    s.mu.Lock()
    defer s.mu.Unlock()
    out := make([]OutboxEntry, len(s.outbox))
    copy(out, s.outbox)
    return out
}

// removeIDs deletes successfully-dispatched entries.
func (s *Store) removeIDs(ids map[int]struct{}) {
    s.mu.Lock()
    defer s.mu.Unlock()
    kept := s.outbox[:0]
    for _, e := range s.outbox {
        if _, done := ids[e.ID]; !done {
            kept = append(kept, e)
        }
    }
    s.outbox = kept
}

// Pump loops until ctx is done, dispatching outbox entries.
func (s *Store) Pump(ctx context.Context) {
    tick := time.NewTicker(20 * time.Millisecond)
    defer tick.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-tick.C:
            entries := s.dequeue()
            ok := map[int]struct{}{}
            for _, e := range entries {
                if err := e.Cmd(ctx); err == nil {
                    ok[e.ID] = struct{}{}
                } else {
                    fmt.Printf("outbox %d failed (will retry): %v\n", e.ID, err)
                }
            }
            if len(ok) > 0 {
                s.removeIDs(ok)
            }
        }
    }
}

func main() {
    s := NewStore()
    ctx, cancel := context.WithCancel(context.Background())
    go s.Pump(ctx)

    s.TransactWrite("user:1", "Alice", func(ctx context.Context) error {
        fmt.Println("publish UserCreated(1)")
        return nil
    })
    s.TransactWrite("user:2", "Bob", func(ctx context.Context) error {
        fmt.Println("publish UserCreated(2)")
        return nil
    })

    time.Sleep(80 * time.Millisecond)
    cancel()
    fmt.Println("remaining outbox:", len(s.outbox))
}
```

</details>

---

### Task 14 (A) — Idempotent commands

**Goal:** Each command exposes an `IdempotencyKey() string`. The dispatcher dedupes: if a command with the same key arrives within a TTL window, it is silently dropped and the cached result is returned. This is how `Stripe-Idempotency-Key` works.

**Starter:**

```go
package main

import (
    "context"
    "sync"
    "time"
)

type Idempotent interface {
    IdempotencyKey() string
    Execute(ctx context.Context) error
}

type Dispatcher struct {
    mu   sync.Mutex
    seen map[string]time.Time
    ttl  time.Duration
}

// TODO: NewDispatcher(ttl)
// TODO: (d *Dispatcher) Dispatch(ctx, cmd) — dedupe by key, gc expired entries
```

**Hints:**

- On dispatch, look up the key. If present and not expired, return early.
- Caching the result (not just the key) is a real-world refinement — for this task, returning `nil` on the cached path is fine.
- GC: when checking the map, evict any entry whose TTL has passed. Do it inline so the map does not grow forever.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

type Idempotent interface {
    IdempotencyKey() string
    Execute(ctx context.Context) error
}

type Dispatcher struct {
    mu   sync.Mutex
    seen map[string]time.Time
    ttl  time.Duration
}

func NewDispatcher(ttl time.Duration) *Dispatcher {
    return &Dispatcher{
        seen: map[string]time.Time{},
        ttl:  ttl,
    }
}

// Dispatch returns nil and skips execution if the same key was seen
// within ttl. A production version would also cache the original result
// so retries return the same error/payload, not just nil.
func (d *Dispatcher) Dispatch(ctx context.Context, cmd Idempotent) error {
    key := cmd.IdempotencyKey()
    now := time.Now()

    d.mu.Lock()
    // Inline GC. For very large maps, run a goroutine that sweeps
    // periodically instead of doing work on every dispatch.
    for k, t := range d.seen {
        if now.Sub(t) > d.ttl {
            delete(d.seen, k)
        }
    }
    if _, dup := d.seen[key]; dup {
        d.mu.Unlock()
        fmt.Println("skipped duplicate:", key)
        return nil
    }
    d.seen[key] = now
    d.mu.Unlock()

    return cmd.Execute(ctx)
}

// --- a concrete command ---

type ChargeCard struct {
    OrderID string
    Amount  int
}

func (c ChargeCard) IdempotencyKey() string {
    return "charge:" + c.OrderID
}

func (c ChargeCard) Execute(_ context.Context) error {
    fmt.Printf("charging order=%s amount=%d\n", c.OrderID, c.Amount)
    return nil
}

func main() {
    d := NewDispatcher(200 * time.Millisecond)
    ctx := context.Background()

    _ = d.Dispatch(ctx, ChargeCard{OrderID: "o-1", Amount: 1000})
    _ = d.Dispatch(ctx, ChargeCard{OrderID: "o-1", Amount: 1000}) // dropped
    _ = d.Dispatch(ctx, ChargeCard{OrderID: "o-2", Amount: 500})

    time.Sleep(250 * time.Millisecond)
    // TTL has expired -> the same key is accepted again.
    _ = d.Dispatch(ctx, ChargeCard{OrderID: "o-1", Amount: 1000})
}
```

</details>

---

### Task 15 (S) — Mini job queue with everything

**Goal:** Combine the previous pieces into a small but production-shaped job queue. Workers, bounded queue, per-job timeout, panic recovery, retries with linear backoff, dead-letter for jobs that exceed the retry budget, structured logging with durations, graceful shutdown via context.

**Starter:**

```go
package main

// type Job interface { Name() string; Run(ctx context.Context) error }
// type Queue struct{ /* jobs, dlq, workers, log */ }
// (q *Queue) Submit(j Job) error
// (q *Queue) Shutdown(ctx context.Context) error
// internals: per-job timeout, recover(), retries, dead-letter
```

**Hints:**

- Define `Job` as a named struct interface (`Name()` + `Run(ctx)`), not a closure — you want to log the name and route by type.
- Each worker wraps the `Run` call in a `defer recover()` so a panicking handler does not bring the pool down.
- A separate `dlq chan Job` (or a slice protected by mutex) holds dead-letter jobs.
- The submit path must respect `ctx` so callers can refuse to enqueue once shutdown is in progress.

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "log/slog"
    "os"
    "runtime/debug"
    "sync"
    "time"
)

// Job is the unit of work. Struct form (not a bare func) because we want
// to log Name() and could later serialize Job to a real queue.
type Job interface {
    Name() string
    Run(ctx context.Context) error
}

type wrapped struct {
    job      Job
    attempts int
}

type Queue struct {
    jobs      chan wrapped
    dlq       chan Job
    log       *slog.Logger
    workerCnt int
    maxTries  int
    jobTimeout time.Duration

    wg     sync.WaitGroup
    closed chan struct{}
    once   sync.Once
}

type Config struct {
    Workers    int
    QueueSize  int
    DLQSize    int
    MaxTries   int
    JobTimeout time.Duration
}

func NewQueue(cfg Config) *Queue {
    return &Queue{
        jobs:       make(chan wrapped, cfg.QueueSize),
        dlq:        make(chan Job, cfg.DLQSize),
        log:        slog.New(slog.NewTextHandler(os.Stdout, nil)),
        workerCnt:  cfg.Workers,
        maxTries:   cfg.MaxTries,
        jobTimeout: cfg.JobTimeout,
        closed:     make(chan struct{}),
    }
}

func (q *Queue) Start(ctx context.Context) {
    for i := 0; i < q.workerCnt; i++ {
        q.wg.Add(1)
        go q.worker(ctx, i)
    }
}

func (q *Queue) Submit(j Job) error {
    select {
    case <-q.closed:
        return errors.New("queue: shutting down")
    case q.jobs <- wrapped{job: j}:
        return nil
    }
}

// DLQ returns dead-letter jobs for inspection.
func (q *Queue) DLQ() <-chan Job { return q.dlq }

// runOne executes a Job with per-job timeout and panic recovery.
// Critical: a panicking handler must not kill the worker.
func (q *Queue) runOne(ctx context.Context, j Job) (err error) {
    ctx, cancel := context.WithTimeout(ctx, q.jobTimeout)
    defer cancel()
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v\n%s", r, debug.Stack())
        }
    }()
    return j.Run(ctx)
}

func (q *Queue) worker(ctx context.Context, id int) {
    defer q.wg.Done()
    for {
        select {
        case <-ctx.Done():
            return
        case w, ok := <-q.jobs:
            if !ok {
                return
            }
            start := time.Now()
            err := q.runOne(ctx, w.job)
            dur := time.Since(start)

            if err == nil {
                q.log.Info("job ok",
                    "name", w.job.Name(),
                    "attempts", w.attempts+1,
                    "dur_ms", dur.Milliseconds(),
                    "worker", id)
                continue
            }

            w.attempts++
            q.log.Warn("job failed",
                "name", w.job.Name(),
                "attempts", w.attempts,
                "dur_ms", dur.Milliseconds(),
                "err", err.Error())

            if w.attempts >= q.maxTries {
                select {
                case q.dlq <- w.job:
                    q.log.Error("job dead-lettered", "name", w.job.Name())
                default:
                    q.log.Error("dlq full, job dropped", "name", w.job.Name())
                }
                continue
            }

            // Linear backoff. Production: exponential + jitter.
            backoff := time.Duration(w.attempts) * 50 * time.Millisecond
            time.AfterFunc(backoff, func() {
                select {
                case q.jobs <- w:
                case <-q.closed:
                    // dropping during shutdown is acceptable
                }
            })
        }
    }
}

// Shutdown stops accepting new jobs and waits for in-flight ones to
// finish (bounded by ctx). After Shutdown returns, no goroutines remain.
func (q *Queue) Shutdown(ctx context.Context) error {
    q.once.Do(func() {
        close(q.closed)
        close(q.jobs)
    })
    done := make(chan struct{})
    go func() {
        q.wg.Wait()
        close(done)
    }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

// --- demo jobs ---

type SendEmail struct{ To, Subject string }

func (s SendEmail) Name() string                       { return "send-email" }
func (s SendEmail) Run(_ context.Context) error {
    fmt.Printf("[email] %s -> %s\n", s.Subject, s.To)
    return nil
}

type FlakyJob struct {
    ID    int
    tries *int
}

func (f FlakyJob) Name() string { return fmt.Sprintf("flaky-%d", f.ID) }
func (f FlakyJob) Run(_ context.Context) error {
    *f.tries++
    if *f.tries < 3 {
        return errors.New("transient")
    }
    return nil
}

type PanicJob struct{}

func (PanicJob) Name() string                      { return "panic-job" }
func (PanicJob) Run(_ context.Context) error       { panic("nope") }

type AlwaysFails struct{}

func (AlwaysFails) Name() string                   { return "always-fails" }
func (AlwaysFails) Run(_ context.Context) error    { return errors.New("permanent") }

func main() {
    q := NewQueue(Config{
        Workers:    3,
        QueueSize:  32,
        DLQSize:    8,
        MaxTries:   3,
        JobTimeout: 500 * time.Millisecond,
    })
    q.Start(context.Background())

    var tries int
    _ = q.Submit(SendEmail{To: "a@b.c", Subject: "hi"})
    _ = q.Submit(FlakyJob{ID: 1, tries: &tries})
    _ = q.Submit(PanicJob{})       // must NOT kill the pool
    _ = q.Submit(AlwaysFails{})    // ends up in DLQ

    // Drain DLQ in a goroutine so the demo can show it.
    go func() {
        for j := range q.DLQ() {
            fmt.Println("DLQ inspector got:", j.Name())
        }
    }()

    time.Sleep(700 * time.Millisecond)
    shutCtx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()
    if err := q.Shutdown(shutCtx); err != nil {
        fmt.Println("shutdown:", err)
    }
    fmt.Println("queue stopped cleanly")
}
```

</details>

---

## 4. How to grade yourself

Walk through your code and tick each box. If you cannot tick a box, the senior-level version of the task is not done yet.

- [ ] Every command that touches I/O takes `context.Context` and respects cancellation.
- [ ] Worker handlers wrap user code in `defer recover()` so a panicking job does not take down the pool.
- [ ] Every channel is bounded — no unbounded `make(chan T)` in production paths.
- [ ] Retries use bounded attempts plus backoff; permanent failures go to a dead-letter sink, not `log.Fatal`.
- [ ] Logs are structured (`slog`), include the command name, duration, attempt count, and error.
- [ ] Naming reflects role: `Command`, `Job`, `Bus`, `Dispatcher`, `Queue` — not `Manager` or `Handler` everywhere.
- [ ] Decorators (logging, timeout, retry) are separate functions that wrap commands, not extra fields on every command struct.
- [ ] Idempotency keys exist for any command that may be retried across a network boundary.
- [ ] Generics are used where they remove type assertions at the call site, not as decoration.
- [ ] Tests use hand-rolled fakes against interfaces; no `*sql.DB` in unit tests.
- [ ] Reversible commands keep `Undo` as a pure inverse — no extra side effects, no logging, no metrics.
- [ ] Shutdown is explicit (`ctx` or `Shutdown(ctx)`); there is no `os.Exit` from inside a worker.

---

## 5. Stretch challenges

Pick one and ship it end-to-end.

1. **Redis-backed queue.** Replace the in-memory `chan Job` with a Redis list (`LPUSH` / `BRPOP`). Jobs are JSON-encoded `{Type, Payload}` envelopes; a registry maps `Type` to a typed handler. Add a separate Redis list for the DLQ. Compare throughput against the in-memory version with `go test -bench`.

2. **Tracing through ctx.** Instrument every command with OpenTelemetry spans propagated through `ctx`. Each decorator (timeout, retry, log) becomes its own span. Verify that a single submitted command produces a parent span with one child per decorator and one for the user code.

3. **CLI replay tool.** Write a CLI that reads a JSON file of `[{Type, Payload}, ...]` and replays each command through the dispatcher from task 11. Add a `--dry-run` flag that calls a no-op handler and prints what would run. Bonus: a `--from-offset N` flag so a crashed batch can resume.

The common thread: each stretch turns the in-memory toy into something a colleague could actually deploy. Stop when you can point at one of them on your laptop and say "this looks like the production queue at $JOB".

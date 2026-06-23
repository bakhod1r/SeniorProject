# Command Pattern — Find the Bug

## 1. How to use this file

Fifteen buggy Command-pattern snippets. Read each one, find the defect in 30-60 seconds, then expand `<details>` for the answer. Every bug here has shown up in real production Go code — most reviewers miss at least half on a first pass.

---

## Bug 1 — Loop-variable capture (pre-Go-1.22)

```go
type Command func() error

func buildCommands(items []string) []Command {
    cmds := []Command{}
    for _, item := range items {
        cmds = append(cmds, func() error {
            return process(item)
        })
    }
    return cmds
}

func main() {
    cmds := buildCommands([]string{"a", "b", "c"})
    for _, c := range cmds {
        _ = c()
    }
}
```

<details><summary>Answer</summary>

**Bug:** Pre-Go-1.22 the range variable `item` is shared across iterations. Every closure captures the same `item`, which equals `"c"` by the time any command runs. All three commands process `"c"`.

**Why it's subtle:** The code looks correct — a different `item` each iteration is the obvious mental model. The bug only shows up at run time, often only with more than one item.

**Spot in review:** A closure that references a `for _, x := range` variable, on a project whose `go.mod` predates 1.22.

**Fix:**

```go
for _, item := range items {
    item := item                       // shadow per iteration
    cmds = append(cmds, func() error { return process(item) })
}
```

Or upgrade to Go 1.22+, which makes each iteration get a fresh variable.

**Why common:** This is the single most reported pre-1.22 bug. Worker pools, retry helpers, and CLI fan-out code all hit it.
</details>

---

## Bug 2 — Missing context propagation

```go
type Command interface {
    Execute() error
}

type Worker struct {
    jobs chan Command
}

func (w *Worker) Run(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case c := <-w.jobs:
            _ = c.Execute()
        }
    }
}

type SyncFile struct{ Path string }

func (s SyncFile) Execute() error {
    return remoteSync(s.Path) // blocks 30s on a stuck network
}
```

<details><summary>Answer</summary>

**Bug:** `Execute()` takes no `context.Context`. When the worker pool shuts down (`ctx` cancelled), the in-flight command keeps running until it completes naturally. A 30-second network call ignores a clean SIGTERM.

**Why it's subtle:** The worker *does* respect context. Reviewers see the `select` and tick the box. The leak is one level deeper.

**Spot in review:** Any `Execute()` / `Run()` / `Handle()` method without a `ctx context.Context` parameter, especially when the body does I/O.

**Fix:**

```go
type Command interface {
    Execute(ctx context.Context) error
}

func (s SyncFile) Execute(ctx context.Context) error {
    return remoteSyncCtx(ctx, s.Path)
}
```

Then `_ = c.Execute(ctx)` in the worker.

**Why common:** Commands often start as `func() error` for simplicity and never get retrofitted with `ctx` when the codebase grows up.
</details>

---

## Bug 3 — Mutating command state during Execute

```go
type RetryCommand struct {
    URL     string
    attempt int
}

func (c *RetryCommand) Execute(ctx context.Context) error {
    c.attempt++
    log.Printf("attempt %d for %s", c.attempt, c.URL)
    return httpGet(ctx, c.URL)
}

// Caller:
cmd := &RetryCommand{URL: "https://api.example.com/data"}
for i := 0; i < 3; i++ {
    if err := cmd.Execute(ctx); err == nil {
        break
    }
}
// Later, the same cmd is re-queued after a process restart:
queue.Push(cmd) // attempt is already 3 — next consumer thinks it's exhausted
```

<details><summary>Answer</summary>

**Bug:** `Execute` mutates `c.attempt`. The command is no longer a pure description of work — it carries history. When the same command is requeued (or retried by a different layer), the consumer sees stale state from a previous run.

**Why it's subtle:** Incrementing `attempt` inside `Execute` looks like good observability. The damage only manifests when commands are reused, persisted, or replayed.

**Spot in review:** Any pointer-receiver `Execute` that writes to its own fields. Commands should be values; retry/attempt state belongs on the invoker.

**Fix:**

```go
type Command interface {
    Execute(ctx context.Context) error
}

func RunWithRetry(ctx context.Context, c Command, max int) error {
    for attempt := 1; attempt <= max; attempt++ {
        if err := c.Execute(ctx); err == nil {
            return nil
        }
    }
    return errors.New("exhausted")
}
```

Keep the attempt counter in the loop, not in the command.

**Why common:** Developers reach for "the command knows about itself" intuition, but the command is data — the runner owns the lifecycle.
</details>

---

## Bug 4 — Unbuffered channel with no consumer ready

```go
type Command func(context.Context) error

func enqueue(cmds []Command) {
    ch := make(chan Command)
    for _, c := range cmds {
        ch <- c // blocks forever on the first iteration
    }
    close(ch)

    go func() {
        for c := range ch {
            _ = c(context.Background())
        }
    }()
}
```

<details><summary>Answer</summary>

**Bug:** `ch` is unbuffered and the consumer goroutine is started *after* the send loop. The first `ch <- c` blocks forever waiting for a receiver that hasn't been launched yet. Deadlock.

**Why it's subtle:** The code visually contains both a producer and a consumer, so it looks balanced. Order of operations is the trap.

**Spot in review:** Any unbuffered channel where the sending loop comes before the receiving goroutine is launched.

**Fix:**

```go
ch := make(chan Command, len(cmds))   // buffered, or
// ... start consumer first ...
go consume(ch)
for _, c := range cmds { ch <- c }
close(ch)
```

Either size the buffer to fit the producer's burst, or start the consumer first.

**Why common:** "Channels are mailboxes" — beginners assume sends queue. They don't; unbuffered sends are rendezvous.
</details>

---

## Bug 5 — Forgotten error check

```go
type Command func() error

func runAll(cmds []Command) {
    for _, c := range cmds {
        c() // error discarded
    }
}

// Caller:
runAll([]Command{
    func() error { return db.Save(user) },
    func() error { return mailer.Send(user.Email) },
    func() error { return audit.Log(user.ID) },
})
```

<details><summary>Answer</summary>

**Bug:** `c()` returns an error that's never inspected. A failed DB save, a bounced email, an audit gap — all silently lost. The program reports success while data is missing.

**Why it's subtle:** `go vet` (without `errcheck`) won't flag `c()` because the function value's return type isn't visible at the call site in the same obvious way. The pattern looks like a clean iteration.

**Spot in review:** A bare `c()` inside a loop over `[]Command`/`[]func() error`. Any unhandled return value from a function-typed variable.

**Fix:**

```go
func runAll(cmds []Command) error {
    for i, c := range cmds {
        if err := c(); err != nil {
            return fmt.Errorf("command %d: %w", i, err)
        }
    }
    return nil
}
```

Decide explicitly: stop on first error, or collect with `errors.Join`. Never silently drop.

**Why common:** Discarding errors looks like "fire and forget", which is acceptable for logging but catastrophic for state changes.
</details>

---

## Bug 6 — Goroutine leak from queued command

```go
func enqueue(ch chan<- Command, c Command) {
    go func() {
        ch <- c
    }()
}

func shutdown() {
    // ch is no longer being drained; all pending enqueue goroutines leak
}
```

<details><summary>Answer</summary>

**Bug:** The producer goroutine blocks on `ch <- c` forever once the consumer stops draining. Every call to `enqueue` after shutdown leaks one goroutine. Under load, the process accumulates thousands.

**Why it's subtle:** "Fire and forget enqueue" looks idiomatic. The leak only manifests under partial shutdown or back-pressure scenarios — not in the happy path or unit tests.

**Spot in review:** Any `go func() { ch <- x }()` without a `select` against `ctx.Done()` or a closed channel.

**Fix:**

```go
func enqueue(ctx context.Context, ch chan<- Command, c Command) error {
    select {
    case ch <- c:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

No detached goroutine, and back-pressure becomes visible to the caller.

**Why common:** Spawning a goroutine to "make it async" is reflexive. Almost every Go service has at least one of these in its history.
</details>

---

## Bug 7 — Undo runs over the failing command

```go
type Op struct {
    Do, Undo func(ctx context.Context) error
}

func RunSaga(ctx context.Context, ops []Op) error {
    var done []Op
    for _, op := range ops {
        done = append(done, op)
        if err := op.Do(ctx); err != nil {
            for i := len(done) - 1; i >= 0; i-- {
                _ = done[i].Undo(ctx)
            }
            return err
        }
    }
    return nil
}
```

<details><summary>Answer</summary>

**Bug:** `done = append(done, op)` runs *before* `op.Do(ctx)`. When `Do` fails, the rollback loop calls `Undo` on the operation that *never successfully ran*. It tries to undo work that was never done.

**Why it's subtle:** The append is one line above the `Do`. Both lines feel like setup. The fault only surfaces when an undo of the failing op has a side effect (e.g., `Undo` deletes a resource that the failing `Do` never created — causing a second error or worse, deleting an unrelated resource with the same name).

**Spot in review:** In any saga/rollback loop: confirm the success record is written *after* success, not before the call.

**Fix:**

```go
for _, op := range ops {
    if err := op.Do(ctx); err != nil {
        for i := len(done) - 1; i >= 0; i-- {
            _ = done[i].Undo(ctx)
        }
        return err
    }
    done = append(done, op) // only after success
}
```

**Why common:** The append feels like "register the op" rather than "record the success". Both readings appear in real codebases.
</details>

---

## Bug 8 — Closure capturing a pointer to the loop variable

```go
type Order struct {
    ID    string
    Total int
}

func buildCommands(orders []Order) []func() {
    var cmds []func()
    for i := range orders {
        o := &orders[i]
        cmds = append(cmds, func() {
            charge(o.ID, o.Total)
        })
        o.Total *= 2 // apply a tax adjustment "for this order"
    }
    return cmds
}
```

<details><summary>Answer</summary>

**Bug:** `o := &orders[i]` captures a pointer into the *same backing array*. If the slice is later resized (or even if the caller mutates `orders[i]` after the loop), every closure sees the mutated state — not the value at command-creation time.

The second issue: `o.Total *= 2` mutates the underlying slice element. If `orders` is shared with the caller, the caller's slice is now mutated too.

**Why it's subtle:** Pre-1.22 fix mantras say "shadow the loop variable" — but `o := &orders[i]` is *not* a shadow, it's a pointer into the slice. The fix you've heard makes the bug worse here.

**Spot in review:** Closure captures of `&slice[i]` or `&array[i]` — almost always a smell.

**Fix:**

```go
for _, o := range orders {     // o is a copy
    o := o                     // independent per iteration
    cmds = append(cmds, func() {
        charge(o.ID, o.Total)
    })
}
```

Capture by value, not by pointer-into-shared-storage.

**Why common:** Developers reach for `&orders[i]` to avoid copying a "large" struct, not realizing the closure now aliases shared memory.
</details>

---

## Bug 9 — Map handler dispatch race

```go
type Handler func(ctx context.Context, payload []byte) error

type Bus struct {
    handlers map[string]Handler
}

func NewBus() *Bus {
    return &Bus{handlers: map[string]Handler{}}
}

func (b *Bus) Register(name string, h Handler) {
    b.handlers[name] = h
}

func (b *Bus) Dispatch(ctx context.Context, name string, payload []byte) error {
    h, ok := b.handlers[name]
    if !ok {
        return fmt.Errorf("unknown: %s", name)
    }
    return h(ctx, payload)
}
```

<details><summary>Answer</summary>

**Bug:** `Register` writes to `b.handlers` while `Dispatch` reads from it concurrently. Maps in Go are not safe for concurrent read/write — even one concurrent writer triggers `fatal error: concurrent map read and map write` and crashes the process.

**Why it's subtle:** Most apps register all handlers at startup before serving traffic, so this looks safe. The crash only surfaces when a handler is registered (or hot-reloaded) after `Dispatch` is already being called.

**Spot in review:** Any `map[K]V` field on a struct used from multiple goroutines without a `sync.RWMutex` or `sync.Map` wrapping it.

**Fix:**

```go
type Bus struct {
    mu       sync.RWMutex
    handlers map[string]Handler
}

func (b *Bus) Register(name string, h Handler) {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.handlers[name] = h
}

func (b *Bus) Dispatch(ctx context.Context, name string, payload []byte) error {
    b.mu.RLock()
    h, ok := b.handlers[name]
    b.mu.RUnlock()
    if !ok { return fmt.Errorf("unknown: %s", name) }
    return h(ctx, payload)
}
```

If the handler set is truly write-once-at-startup, freeze the map after init and document it.

**Why common:** "Register at startup, dispatch at runtime" is the conventional pattern. Anything that breaks the convention (admin endpoints, plugin reload, tests racing init) trips this.
</details>

---

## Bug 10 — Cancellation ignored by the command body

```go
type Command func(ctx context.Context) error

func uploadAll(ctx context.Context, files []string) error {
    upload := func(ctx context.Context) error {
        for _, f := range files {
            data, err := os.ReadFile(f)
            if err != nil {
                return err
            }
            if err := s3.Put(f, data); err != nil { // ignores ctx
                return err
            }
        }
        return nil
    }
    return upload(ctx)
}
```

<details><summary>Answer</summary>

**Bug:** The command receives `ctx` but never checks `ctx.Done()` and never passes it to `s3.Put`. A cancelled context is honored by the *caller* of the command, but the body grinds on until natural completion.

**Why it's subtle:** The signature looks right. Reviewers see `ctx context.Context` in the parameter list and assume it's used.

**Spot in review:** A function that takes `ctx` but the `ctx` token doesn't appear in the body, or only appears in places that don't actually consult cancellation.

**Fix:**

```go
upload := func(ctx context.Context) error {
    for _, f := range files {
        if err := ctx.Err(); err != nil { return err }
        data, err := os.ReadFile(f)
        if err != nil { return err }
        if err := s3.PutCtx(ctx, f, data); err != nil { return err }
    }
    return nil
}
```

Check `ctx.Err()` at loop boundaries; pass `ctx` to every I/O call that accepts one.

**Why common:** Linters can flag *missing* ctx parameters but rarely catch *unused* ones inside a function body.
</details>

---

## Bug 11 — Panic in handler kills the worker

```go
type Command func()

func worker(jobs <-chan Command) {
    for c := range jobs {
        c() // a panic here kills the goroutine
    }
}

func main() {
    jobs := make(chan Command, 100)
    go worker(jobs)

    jobs <- func() { panic("bad input") }
    jobs <- func() { fmt.Println("hi") } // never runs
}
```

<details><summary>Answer</summary>

**Bug:** A panic in any `c()` unwinds the worker goroutine. The worker exits, the channel is no longer drained, and every subsequent send either blocks (unbuffered) or piles up until the buffer fills (buffered). The queue silently stalls.

**Why it's subtle:** In tests, you usually send "good" commands and never see the failure mode. The bug only emerges with one bad input — and you lose all subsequent good ones.

**Spot in review:** A `for c := range jobs { c() }` loop without `defer recover()` around `c()`.

**Fix:**

```go
func safeRun(c Command) {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("command panic: %v\n%s", r, debug.Stack())
        }
    }()
    c()
}

func worker(jobs <-chan Command) {
    for c := range jobs {
        safeRun(c)
    }
}
```

Recover *per command*, not around the whole loop — otherwise the first panic still kills the worker.

**Why common:** Worker pools are written for the happy path. Recovery is an afterthought, often added only after the first production outage.
</details>

---

## Bug 12 — Serialized command with unexported fields

```go
type SendEmail struct {
    to      string
    subject string
    body    string
}

func (s SendEmail) Type() string { return "send-email" }

// Producer:
cmd := SendEmail{to: "a@b.c", subject: "hi", body: "hello"}
payload, _ := json.Marshal(cmd)
queue.Push("send-email", payload)

// Consumer:
var cmd SendEmail
_ = json.Unmarshal(payload, &cmd)
_ = smtp.Send(cmd.to, cmd.subject, cmd.body)
```

<details><summary>Answer</summary>

**Bug:** `encoding/json` only serializes **exported** fields. `to`, `subject`, `body` are lowercase, so `Marshal` writes `{}`. The consumer unmarshals into a zero-valued struct and sends an empty email to no one — silently.

**Why it's subtle:** `json.Marshal` doesn't return an error for unexported fields; it just skips them. The producer logs "queued OK", the consumer logs "sent OK", the customer never gets the mail.

**Spot in review:** Any struct passed to `json.Marshal`, `gob.Encode`, or stored in a cross-process queue with lowercase field names.

**Fix:**

```go
type SendEmail struct {
    To      string `json:"to"`
    Subject string `json:"subject"`
    Body    string `json:"body"`
}
```

Capitalize the fields and add JSON tags. If you must keep encapsulation, implement `MarshalJSON` / `UnmarshalJSON` explicitly.

**Why common:** Developers preserve encapsulation habits from Java/C# without realizing Go's encoders enforce visibility.
</details>

---

## Bug 13 — Idempotency key derived from non-deterministic data

```go
type Command struct {
    UserID string
    Amount int
    Key    string
}

func NewCharge(userID string, amount int) Command {
    return Command{
        UserID: userID,
        Amount: amount,
        Key:    fmt.Sprintf("%s-%d-%d", userID, amount, time.Now().UnixNano()),
    }
}

// Retry loop:
for i := 0; i < 3; i++ {
    cmd := NewCharge("u1", 100)
    if err := stripe.Charge(cmd); err == nil { break }
}
```

<details><summary>Answer</summary>

**Bug:** The idempotency key includes `time.Now().UnixNano()`. Every call to `NewCharge` produces a different key. When retries hit Stripe, each retry looks like a *new* charge — the customer is billed multiple times.

**Why it's subtle:** Including a timestamp "for uniqueness" looks like good hygiene. The bug only surfaces under retry — and only with a real downstream that respects idempotency keys.

**Spot in review:** Any idempotency key, request ID, or dedup token built from `time.Now()`, `uuid.New()`, or `rand` *inside the retry path*.

**Fix:**

```go
// Generate the key once, outside retries.
cmd := Command{
    UserID: "u1",
    Amount: 100,
    Key:    uuid.NewString(), // generated once
}
for i := 0; i < 3; i++ {
    if err := stripe.Charge(cmd); err == nil { break }
}
```

Or derive the key deterministically from inputs: `sha256(userID + "|" + amount + "|" + businessRequestID)`.

**Why common:** "Idempotency key" sounds like "unique ID" — developers conflate the two. The point of an idempotency key is that it's the **same** across retries.
</details>

---

## Bug 14 — Command bus dispatch by interface type

```go
type Command interface{}

type CreateOrder struct {
    OrderID string
}

type Bus struct {
    handlers map[reflect.Type]func(any) error
}

func (b *Bus) Register(cmd Command, h func(any) error) {
    b.handlers[reflect.TypeOf(&cmd).Elem()] = h
}

func (b *Bus) Send(cmd Command) error {
    h, ok := b.handlers[reflect.TypeOf(cmd)]
    if !ok { return fmt.Errorf("no handler for %T", cmd) }
    return h(cmd)
}

// Usage:
bus.Register(CreateOrder{}, createOrderHandler)
bus.Send(CreateOrder{OrderID: "o1"}) // "no handler for CreateOrder"
```

<details><summary>Answer</summary>

**Bug:** `Register` calls `reflect.TypeOf(&cmd).Elem()`. Because `cmd` is typed as the **interface** `Command`, `&cmd` is `*Command`, and `Elem()` returns the interface type `Command` — not the concrete `CreateOrder`. `Send`, on the other hand, calls `reflect.TypeOf(cmd)` which returns the concrete type. Keys don't match — dispatch always fails.

**Why it's subtle:** Both lines use `reflect.TypeOf` and both look like they identify "the type". The interface-vs-concrete distinction is invisible without running it.

**Spot in review:** Asymmetric reflection in `Register` and `Send`. They must compute the key the same way.

**Fix:**

```go
func (b *Bus) Register(cmd Command, h func(any) error) {
    b.handlers[reflect.TypeOf(cmd)] = h     // same expression as Send
}
```

`reflect.TypeOf` on an interface value returns the dynamic (concrete) type — which is what you want here.

**Why common:** People reach for `reflect.TypeOf(&x).Elem()` from a half-remembered pattern that was meant for *unset* interface values. For a passed-in value, plain `reflect.TypeOf(cmd)` is correct.
</details>

---

## Bug 15 — Saga compensation calling Do instead of Undo

```go
type Op struct {
    Name string
    Do   func(ctx context.Context) error
    Undo func(ctx context.Context) error
}

func RunSaga(ctx context.Context, ops []Op) error {
    var done []Op
    for _, op := range ops {
        if err := op.Do(ctx); err != nil {
            for i := len(done) - 1; i >= 0; i-- {
                _ = done[i].Do(ctx) // compensation
            }
            return err
        }
        done = append(done, op)
    }
    return nil
}
```

<details><summary>Answer</summary>

**Bug:** The "compensation" loop calls `done[i].Do(ctx)` instead of `done[i].Undo(ctx)`. When a step fails, the saga *re-executes* every successful step instead of rolling them back. A failed checkout retries every charge twice, sends the email twice, allocates inventory twice.

**Why it's subtle:** `Do` and `Undo` are one character apart and both are valid method names on the struct. The loop direction is correct (`len(done)-1` down to `0`), which lulls reviewers into thinking the logic is right.

**Spot in review:** Whenever you see a reverse-iteration compensation loop, read the **method name** out loud, not just the index expression.

**Fix:**

```go
for i := len(done) - 1; i >= 0; i-- {
    if err := done[i].Undo(ctx); err != nil {
        log.Printf("compensation of %s failed: %v", done[i].Name, err)
    }
}
```

Log compensation failures explicitly — a silent `_ =` here is the next bug waiting to happen.

**Why common:** Saga code is written once and rarely re-read. The first review pass focuses on the forward loop; the rollback path is skimmed. Tests often only exercise the happy path.
</details>

---

## Summary

These bugs cluster into four families.

**Concurrency (4, 6, 9, 11):** unbuffered channels, leaked producers, unsynchronized maps, unrecovered panics. The pattern is "the happy path looks safe; the edge case crashes the worker."

**Context & cancellation (2, 10):** missing `ctx` parameter, ignored `ctx` body. A command without honored cancellation is a command that ignores SIGTERM.

**State & identity (1, 3, 8, 13):** loop-variable capture, mutating commands, pointer-into-slice aliasing, non-deterministic idempotency keys. Commands should be **immutable values with stable identity**.

**Serialization & dispatch (5, 7, 12, 14, 15):** dropped errors, premature success-recording, unexported fields, asymmetric reflection keys, `Do` instead of `Undo`. All small mistakes; all silent in tests.

Review checklist for any Command-pattern PR:

- [ ] Does every `Execute` / `Run` / `Handle` accept `ctx context.Context`?
- [ ] Does the body actually consult `ctx.Done()` or pass `ctx` to I/O calls?
- [ ] Are commands **immutable values**? No pointer-receiver methods that mutate fields?
- [ ] Are channel sizes appropriate for the producer's burst, and is the consumer started first?
- [ ] Is there `defer recover()` per command in worker loops?
- [ ] Is the handler/dispatch map protected by a mutex (or frozen after init)?
- [ ] If commands are serialized: all fields **exported** with explicit tags?
- [ ] Are idempotency keys generated **once**, outside the retry loop, from deterministic data?
- [ ] Do saga compensation loops call `Undo`, not `Do`, and record success **after** the operation succeeds?
- [ ] Are loop variables shadowed (or is Go 1.22+ confirmed) before capturing in closures?

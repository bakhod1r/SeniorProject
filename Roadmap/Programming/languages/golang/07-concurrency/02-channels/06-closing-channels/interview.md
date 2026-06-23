# Closing Channels — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What does `close(ch)` do?

**Model answer.** It sets the channel's internal closed flag and wakes any goroutines blocked on send or receive on that channel. Receivers see the channel as closed; once the buffer is drained, further receives return the zero value with `ok = false`, and `for range` loops over the channel exit. Sends to a closed channel panic.

**Common wrong answers.**
- "It deletes the channel." (No; the channel still exists and can be received from.)
- "It interrupts all sends and receives." (Receives still work; sends panic.)
- "It frees the memory." (No; GC handles that when no references remain.)

**Follow-up.** *What happens if I receive from a closed empty channel?* — Returns the zero value of the element type, immediately, with `ok = false` in the comma-ok form. Never blocks.

---

### Q2. What is the difference between `<-ch` and `v, ok := <-ch`?

**Model answer.** Both receive a value from the channel. The single-value form returns only the value; the two-value form additionally returns a boolean indicating whether the channel was open when the value was sent. On a closed-drained channel, the single form gives the zero value (indistinguishable from a sent zero), while the two-value form gives `(zero, false)`.

**Follow-up.** *When do I use comma-ok?* — When the zero value is a legal value in your stream and you must distinguish it from "channel closed," or when you want to detect close without `for range`.

---

### Q3. What is the convention "only the sender closes" and why?

**Model answer.** Only the goroutine that sends on a channel should close it. The reason: closing signals "no more sends," and only the sender knows when there are no more sends. If the receiver closes, the sender doesn't know and may send to a closed channel, which panics. The convention prevents that.

**Follow-up.** *What if there are multiple senders?* — The convention breaks down. Use a synchronising closer (`WaitGroup` + closer goroutine), or a separate done channel.

---

### Q4. What happens if I `close` a `nil` channel?

**Model answer.** It panics at runtime with the message `"close of nil channel"`. A nil channel is a channel-typed variable that has not been initialised with `make`. The runtime explicitly checks for nil at the start of `closechan`.

**Common wrong answer.** "It silently does nothing." (No; it panics.)

---

### Q5. What happens if I `close` a channel twice?

**Model answer.** It panics at runtime with `"close of closed channel"`. The runtime checks the closed flag at the start of `closechan`; if already set, it panics. This is why `sync.Once` is used when close may be reached from multiple paths.

---

### Q6. Why does `for v := range ch` ever exit?

**Model answer.** When the channel is closed and drained, the underlying receive returns `ok = false`, and the range loop terminates. If the channel is never closed, `for range` blocks forever waiting for the next value — this is the most common goroutine leak.

**Follow-up.** *What if the channel has buffered values when closed?* — The loop drains those first, then exits. Close does not flush buffered values.

---

### Q7. Is closing a channel a thread-safe broadcast?

**Model answer.** Yes. Calling `close(ch)` wakes every goroutine blocked on a receive on `ch`, simultaneously, atomically. The closure is a single state transition; receivers see the post-close state. This is why closed channels are used as cancellation broadcasts.

**Follow-up.** *Is it O(1) or O(N) in the number of receivers?* — O(N): the runtime walks the receive-waiter queue and wakes each. But each wake is constant time, so the cost is proportional to receivers.

---

### Q8. Show me a generator function with close.

**Model answer.**

```go
func nums(n int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < n; i++ {
            out <- i
        }
    }()
    return out
}
```

The function creates the channel, starts a goroutine that sends values and closes via `defer`, and returns the channel as `<-chan int`. The caller cannot close it (type forbids); the caller just reads with `for range`.

---

## Middle

### Q9. How do you safely close a channel with multiple senders?

**Model answer.** Use a synchronising closer pattern:

```go
var wg sync.WaitGroup
for i := 0; i < N; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        sendStuff(ch)
    }()
}
go func() {
    wg.Wait()
    close(ch)
}()
```

A coordinator goroutine waits for all senders to finish, then closes once. No sender closes; no send happens after close.

**Alternative.** Use a separate `done` channel; never close the data channel. Senders observe `done` close and stop; only after all senders return is it safe to close (or to leave the data channel un-closed, since no one will send on it any more).

**Follow-up.** *Why does `sync.Once` alone not solve this?* — `Once` prevents double-close but does not stop in-flight sends. A sender after close still panics. Need to either (a) prevent sends after close via a done channel, or (b) use a synchronising closer.

---

### Q10. What is the memory model guarantee for close?

**Model answer.** The Go memory model states: *the closing of a channel is synchronized before a receive that returns because the channel is closed*. Any write a goroutine performs before closing a channel is visible to any goroutine that observes the close via a receive. This makes close a release/acquire synchronisation point — similar to a mutex unlock/lock or an atomic store/load.

**Practical use.** A "publish once, read many" pattern: write the result, close the done channel, every reader after `<-done` sees the written result.

---

### Q11. Why does `close` on a receive-only channel fail to compile?

**Model answer.** The type system enforces the sender-closes convention. A `<-chan T` is the receive-only direction; the compiler treats `close` as an operation only valid on `chan T` or `chan<- T`. The error is "invalid operation: cannot close receive-only channel."

**Follow-up.** *Can I cast to bypass this?* — No. The conversion from `<-chan T` to `chan T` is not allowed. The receive-only-ness is preserved.

---

### Q12. Walk through what `closechan` does in the runtime.

**Model answer.**

1. Check `c == nil`: panic if so.
2. Acquire `c.lock`.
3. Check `c.closed != 0`: panic if so.
4. Emit race-detector release event.
5. Set `c.closed = 1`.
6. Drain `c.recvq`: for each parked receiver, write zero into its destination, mark unsuccessful, push onto a wake list.
7. Drain `c.sendq`: for each parked sender, mark unsuccessful (will panic on resume), push onto wake list.
8. Release `c.lock`.
9. Call `goready` on each waiter to ready it for the scheduler.

The drain happens under the lock to prevent new waiters from joining mid-drain; the wake happens outside the lock to avoid deadlock with scheduler locks.

---

### Q13. What is the relationship between `close` and `context.Context.Done()`?

**Model answer.** `context.Context.Done()` returns a `<-chan struct{}` that is *closed* when the context is cancelled. The internal `cancelCtx.cancel` method calls `close(c.done)` once (guarded by a mutex). Every goroutine selecting on `ctx.Done()` wakes simultaneously. This is the broadcast-via-close pattern, productised as a stdlib type.

**Follow-up.** *Can I create my own Context-like done channel?* — Yes. `chan struct{}` + `sync.Once` + a "Close()" method is roughly what `cancelCtx` does. For real applications, use `context.Context`.

---

### Q14. What does `defer close(ch)` give you that a plain `close(ch)` doesn't?

**Model answer.** Three things:

1. Close runs even if the function exits via early return.
2. Close runs even if the function panics (deferred functions run during panic).
3. Close is the last thing to happen, after any other cleanup defers.

Without `defer`, an early return path that forgets to close leaks the consumer.

**Anti-pattern.** Putting `defer close(ch)` in the parent goroutine while sends happen in a child. The defer fires when the parent returns, but the child may not be done. Close belongs in the goroutine that owns the channel.

---

### Q15. Explain the difference between closing a channel and sending a "stop" value.

**Model answer.**

| Aspect | Close | Sentinel send |
|---|---|---|
| Number of wakes | All receivers, broadcast | One receiver, point-to-point |
| Detection | `ok = false` from `<-ch`, or `for range` exits | Type-encoded sentinel value |
| Repeatable | No (one-shot, then panic) | Sentinel could be sent multiple times |
| Type-checked | `close` is a built-in; valid only on send-direction types | Sentinel is just a value |
| Idiomatic | Yes for stream-end signal | No; usually a code smell |

Closing is the idiomatic way to signal "no more values." Sending a sentinel (like `-1` or a magic struct) requires every receiver to know the convention and is brittle.

---

### Q16. How would you test that a function correctly closes its returned channel?

**Model answer.**

```go
func TestCloses(t *testing.T) {
    ch := someFunc()
    timeout := time.After(time.Second)
    seen := 0
    for {
        select {
        case _, ok := <-ch:
            if !ok {
                if seen == 0 {
                    t.Fatal("channel closed without sending anything")
                }
                return // close observed; test passes
            }
            seen++
        case <-timeout:
            t.Fatal("channel did not close within 1s")
        }
    }
}
```

The test reads values, observes the close via `ok = false`, and times out if close doesn't happen. The timeout protects against infinite loops.

---

## Senior

### Q17. Design a graceful shutdown for a service with 100 long-lived goroutines.

**Model answer.**

```go
type Server struct {
    ctx    context.Context
    cancel context.CancelFunc
    wg     sync.WaitGroup
}

func NewServer() *Server {
    ctx, cancel := context.WithCancel(context.Background())
    return &Server{ctx: ctx, cancel: cancel}
}

func (s *Server) Start() {
    for i := 0; i < 100; i++ {
        s.wg.Add(1)
        go func(id int) {
            defer s.wg.Done()
            worker(s.ctx, id)
        }(i)
    }
}

func (s *Server) Shutdown(ctx context.Context) error {
    s.cancel() // cascades to all workers via s.ctx
    done := make(chan struct{})
    go func() {
        s.wg.Wait()
        close(done)
    }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err() // timeout
    }
}
```

Each worker calls `<-s.ctx.Done()` periodically. `Shutdown` cancels the context (one close internally) and waits for all workers via WaitGroup. The waited-for close `done` allows the shutdown to bound its wait by the caller's context.

**Key invariants.**
- One cancel → many goroutines stop (broadcast via close).
- Every worker registers in WaitGroup.
- Shutdown is bounded by an external context.

---

### Q18. Why does this leak goroutines?

```go
func produce(in []int) <-chan int {
    out := make(chan int)
    go func() {
        for _, v := range in {
            out <- v
        }
    }()
    return out
}
```

**Model answer.** Missing `close(out)`. The consumer's `for range` will block forever waiting for the next value after the last send. The goroutine itself exits (it doesn't leak), but the consumer leaks. Worse, if no consumer is reading, the producer also blocks on the last send because the unbuffered channel has no reader — both leak.

**Fix.**

```go
go func() {
    defer close(out)
    for _, v := range in {
        out <- v
    }
}()
```

---

### Q19. Why is `safeClose` an antipattern?

```go
func safeClose(ch chan int) (closed bool) {
    defer func() {
        if recover() != nil {
            closed = true
        }
    }()
    close(ch)
    return false
}
```

**Model answer.** It hides the bug rather than fixing it. The double-close panic is symptomatic of unclear ownership; recovering masks the symptom but leaves the design wrong. Worse, every panic-recovery costs a stack walk, and `recover` only catches panics in the same goroutine. The idiomatic fix is `sync.Once`:

```go
var once sync.Once
once.Do(func() { close(ch) })
```

Same idempotence guarantee, no panic, no recovery, no hidden bug.

---

### Q20. How would you debug a "send on closed channel" panic in production?

**Model answer.**

1. **Read the panic trace.** Identify the goroutine, the line that sent, the channel.
2. **Trace ownership.** Who created this channel? Who is supposed to close it? Are there multiple senders?
3. **Look for races.** Run `go test -race` over the failing code path. The detector identifies the unsynchronised close/send.
4. **Look at lifetime.** Is a sender outliving its expected lifetime? E.g., a goroutine that was supposed to exit on `ctx.Done()` is in a non-cancellable cgo call.
5. **Restructure.** Apply the multi-sender pattern: synchronising closer (WaitGroup + closer), separate done channel, or coordinator goroutine.

**Common root causes.**
- Closer races with sender.
- Sender starts a new send after observing close.
- `sync.Once` was added to close but senders still in flight.

---

### Q21. When would you choose a done channel over `context.Context`?

**Model answer.**

| Done channel | `context.Context` |
|---|---|
| Per-component signal | Propagated across function boundaries |
| Single one-shot event | Possibly multi-level cancellation |
| No tree of children | Parent-child relationship |
| Minimal overhead | Some allocation per derived context |
| Idiomatic for narrow scope | Idiomatic for cross-cutting cancellation |

Use `context.Context` whenever cancellation crosses a function boundary or when you need to propagate request-scoped values. Use a plain done channel for narrow, within-component signals (e.g., "stop this one worker"). Both ultimately use `close`.

---

### Q22. How do you propagate close through a 5-stage pipeline on cancellation?

**Model answer.** Each stage's worker has the shape:

```go
func stage(ctx context.Context, in <-chan A) <-chan B {
    out := make(chan B)
    go func() {
        defer close(out)
        for a := range in {
            b := transform(a)
            select {
            case <-ctx.Done():
                return
            case out <- b:
            }
        }
    }()
    return out
}
```

When `ctx` is cancelled:

1. Each stage's `select` picks `ctx.Done()` and returns.
2. `defer close(out)` runs.
3. The next stage's `for range` sees its input close and exits.
4. The cascade propagates from source to sink in O(depth) context switches.

The pipeline is cancellation-clean: no leaked goroutines, no panics.

---

### Q23. What is the relationship between close and `sudog`?

**Model answer.** A `sudog` is the runtime's per-blocking-event record: when a goroutine parks on `<-ch` or `ch <- v`, a sudog is allocated and linked onto `recvq` or `sendq`. When `close(ch)` runs, the runtime walks both queues and:

- For each receiver in `recvq`: sets `sg.success = false`, copies zero value to receiver, readies the goroutine.
- For each sender in `sendq`: sets `sg.success = false`, readies the goroutine which then panics with "send on closed channel."

Sudogs are recycled from a per-P pool; allocation is ~50 ns. Close walks the queues in FIFO order. Cost is O(N) in the number of parked goroutines.

---

## Staff

### Q24. Design a library that exposes a "stream of events" with explicit close contract.

**Model answer.**

```go
// Subscriber receives events. Drain Events() until it closes.
// Close() signals shutdown; safe to call multiple times.
type Subscriber struct {
    events chan Event
    done   chan struct{}
    once   sync.Once
    wg     sync.WaitGroup
}

func NewSubscriber(ctx context.Context) *Subscriber {
    s := &Subscriber{
        events: make(chan Event, 64),
        done:   make(chan struct{}),
    }
    s.wg.Add(1)
    go s.run(ctx)
    return s
}

func (s *Subscriber) Events() <-chan Event { return s.events }

func (s *Subscriber) Close() {
    s.once.Do(func() {
        close(s.done)
        s.wg.Wait()
        close(s.events)
    })
}

func (s *Subscriber) run(ctx context.Context) {
    defer s.wg.Done()
    for {
        select {
        case <-ctx.Done():
            return
        case <-s.done:
            return
        case ev := <-source:
            select {
            case s.events <- ev:
            case <-ctx.Done():
                return
            case <-s.done:
                return
            }
        }
    }
}
```

**Design properties.**
- `Events()` returns `<-chan Event` — caller can't close.
- `Close()` is idempotent via `sync.Once`.
- `Close()` first signals (closes `done`), then waits for the producer to stop (WaitGroup), then closes the data channel. The order is critical to prevent send-on-closed.
- Doc comment specifies the close contract.

**Anti-pattern avoided.** Calling `Close()` does not race with `run`. The producer observes `done` and exits before `Close()` proceeds to `close(s.events)`.

---

### Q25. Compare close semantics in Go, Rust, and Erlang.

**Model answer.**

| Language | Close mechanism | Sender after close | Receiver after close |
|---|---|---|---|
| Go | `close(ch)` built-in, runtime flag | Panic | Zero value + `ok = false`; for range exits |
| Rust | Drop all senders (RAII) | Compile-time impossible after drop | `recv()` returns `Err(RecvError)` |
| Erlang | No channel close; process exit | N/A — processes communicate, not channels | Receivers get `'DOWN'` or `'EXIT'` via monitor |

Rust's design is the most rigorous: the type system tracks which scopes own senders; close is the last drop. Go's runtime-driven close is more flexible (any sender can close) but requires programmer discipline. Erlang doesn't have channels; processes are first-class and their exit is the equivalent signal.

Go's close-as-broadcast is a particular property neither Rust nor Erlang directly replicates — Rust's tokio has a similar `Notify` primitive; Erlang uses monitors and `lists:foreach`.

---

### Q26. A team reports that their service occasionally panics with "send on closed channel" only in production. Walk through your diagnostic approach.

**Model answer.**

**Hypotheses (ranked by likelihood).**

1. **Race between close and send under load.** Multi-sender close without proper coordination.
2. **A goroutine outliving its expected lifetime.** E.g., a tail-end goroutine that misses a cancellation signal.
3. **A `Close()` method called twice from different paths.** Cleanup defers in nested scopes.

**Diagnostic steps.**

1. **Get the panic stack.** Identify the goroutine, the line, the channel by name.
2. **Capture all goroutine stacks at crash time.** `runtime/debug.PrintStack` in a panic handler.
3. **Reproduce locally with `-race`.** Often reveals the race.
4. **Audit ownership.** Who creates this channel? Who is documented to close it? Who actually closes it?
5. **Check for `defer close(ch)` in unexpected places.** A defer in a helper that fires twice.
6. **Add diagnostics**: log on close, log on send, with goroutine IDs.

**Common fixes.**

- Move close to a synchronising closer that waits for senders.
- Wrap close in `sync.Once`.
- Use a done channel instead of closing the data channel.
- Add explicit cancellation that senders must observe.

**Prevention.** Document close ownership in code comments. Code review every `close(ch)`. CI runs with `-race`.

---

### Q27. Explain why the Go runtime drains parked senders *under the lock* in `closechan`.

**Model answer.** The drain happens under the channel's `lock` because otherwise a sender could park onto `sendq` after `c.closed = 1` was set but before the drain reached it. That sender would never wake — leak. By holding the lock throughout "set closed flag + drain both queues," the runtime ensures atomicity: from any other goroutine's perspective, either the close is not yet effective (lock held), or it is fully effective and all queues drained.

The wake itself (`goready`) is done *after* releasing the lock to avoid deadlock with the scheduler's own locks. The wake list is held in a temporary `glist` local to the close call.

**Follow-up.** *Could the lock be replaced by atomics?* — In principle yes, with a more complex protocol involving CAS loops on the queue head. In practice the lock is short-lived and contention is low, so the runtime keeps it.

---

### Q28. A senior architect proposes "all our channels should have a `Close()` wrapper for safety." How do you respond?

**Model answer.** Push back unless there is a specific reason. The proposal has trade-offs:

**Pros.**
- Idempotent close via `sync.Once`.
- Documented close contract.
- Possibly easier to instrument (metrics on close).

**Cons.**
- More machinery, more code to maintain.
- Hides ownership: if anyone can close, who is really responsible?
- Encourages careless design ("close from anywhere; it's safe!").
- The real bug — unclear ownership — is masked, not fixed.

**Recommendation.** Use such wrappers only for specific cases: library APIs exposing channels (where caller may call Close in error paths), or coordinator types managing dynamic streams. For internal code, prefer clear ownership and `defer close`. Static design beats dynamic safety net.

---

### Q29. How would you implement a "Close-and-Reset" pattern for a reusable channel?

**Model answer.** Channels are not reopenable. The pattern is to **replace** the channel:

```go
type Resetable struct {
    mu sync.Mutex
    ch chan int
}

func (r *Resetable) Channel() <-chan int {
    r.mu.Lock()
    defer r.mu.Unlock()
    return r.ch
}

func (r *Resetable) CloseAndReset() {
    r.mu.Lock()
    defer r.mu.Unlock()
    close(r.ch)
    r.ch = make(chan int)
}
```

Caveats:

- Anyone holding the old channel still sees it as closed (which is correct).
- New subscribers via `Channel()` get the new channel.
- The mutex around close is to prevent races between Close and Channel.

This pattern is rare. Usually the answer is "create a new struct instance" rather than reset.

---

### Q30. Implement a "broadcast" channel that allows late subscribers to see only post-subscription events.

**Model answer.**

```go
type Broadcaster[T any] struct {
    mu     sync.Mutex
    subs   map[chan T]struct{}
    closed bool
}

func New[T any]() *Broadcaster[T] {
    return &Broadcaster[T]{subs: make(map[chan T]struct{})}
}

func (b *Broadcaster[T]) Subscribe() <-chan T {
    b.mu.Lock()
    defer b.mu.Unlock()
    ch := make(chan T, 16)
    if b.closed {
        close(ch)
        return ch
    }
    b.subs[ch] = struct{}{}
    return ch
}

func (b *Broadcaster[T]) Unsubscribe(ch <-chan T) {
    b.mu.Lock()
    defer b.mu.Unlock()
    for c := range b.subs {
        if (<-chan T)(c) == ch {
            delete(b.subs, c)
            close(c)
            return
        }
    }
}

func (b *Broadcaster[T]) Publish(v T) {
    b.mu.Lock()
    defer b.mu.Unlock()
    if b.closed {
        return
    }
    for ch := range b.subs {
        select {
        case ch <- v:
        default: // slow subscriber: drop
        }
    }
}

func (b *Broadcaster[T]) Close() {
    b.mu.Lock()
    defer b.mu.Unlock()
    if b.closed {
        return
    }
    b.closed = true
    for ch := range b.subs {
        close(ch)
    }
    b.subs = nil
}
```

**Design notes.**

- Each subscriber gets its own buffered channel.
- `Publish` fans out under a lock; slow subscribers drop.
- Subscribers added after `Close` receive a pre-closed channel — they see `for range` exit immediately.
- All channels are owned by the broadcaster; subscribers cannot close them.

**Trade-offs.**

- The lock serialises publishes. For high throughput, use a sharded broadcaster or a fan-out goroutine per subscriber.
- "Drop on slow" is a policy choice. Alternatives: block (backpressure), or grow the buffer.

---

### Q31. The runtime team is considering a `tryclose(ch) bool` that returns false instead of panicking on double-close. Should they add it?

**Model answer.** This has been considered and rejected in the past. Arguments against:

- The double-close panic indicates a logic bug; silencing it would hide bugs.
- `sync.Once` already provides idempotent close; the bug surface is solved at the library level.
- Adding `tryclose` would create a "fork in the road" — some code uses `close`, some uses `tryclose`, the language gets bigger.
- The "is it already closed" query is fundamentally racy; the answer is stale by the time you use it.

Arguments for:

- Some patterns where multiple owners can close (e.g., cleanup paths in unrelated cancellation trees) would be simpler.
- Equivalent of `sync.Once` overhead is small but non-zero.

The Go language design philosophy favours minimalism and clear error semantics over convenience. Panicking on double-close enforces clear ownership; `tryclose` would dilute that.

The team has rejected this in every iteration. The status quo: use `sync.Once` if you need idempotent close.

---

### Q32. How does `select` interact with closed channels, and how would you exploit it?

**Model answer.** A receive case on a closed channel is *always* selectable. The runtime treats the case as "ready" because receive on closed is non-blocking. Pattern: use a closed channel to make a case "always firing."

**Cancellation idiom.**

```go
for {
    select {
    case <-done:
        return
    case v := <-work:
        process(v)
    }
}
```

When `done` is closed, the first case is always selectable. If `work` also has values, `select` randomly picks (no priority). Once `done` fires once, it fires every iteration — must `return` to escape the loop.

**Priority idiom.**

```go
select {
case <-done:
    return
default:
}
select {
case <-done:
    return
case v := <-work:
    process(v)
}
```

First check `done` non-blocking; if closed, return. Otherwise proceed to the multiplexed select.

**Dynamic disable via nil idiom.**

```go
for {
    select {
    case v, ok := <-in1:
        if !ok {
            in1 = nil // disable this case
            continue
        }
        process(v)
    case v, ok := <-in2:
        // ...
    }
    if in1 == nil && in2 == nil {
        return
    }
}
```

Closed channels stay always-selectable; nil channels are never-selectable. Combined, you can drain multiple inputs in any close order.

---

## Summary of follow-ups by level

| Level | Themes |
|---|---|
| Junior | "What does close do?", "Comma-ok?", "Why does range exit?", "Convention sender-closes" |
| Middle | "Multi-sender close patterns", "Memory model", "Why receive-only can't close", "Close vs sentinel" |
| Senior | "Graceful shutdown design", "Diagnose send-on-closed", "When done vs Context", "Pipeline cascade" |
| Staff | "Library API design", "Cross-language comparison", "Broadcast patterns", "Runtime trade-offs" |

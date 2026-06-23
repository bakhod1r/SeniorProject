# Or-Done-Channel — Interview Questions

A collection of interview-style questions, organised by depth. Each comes with a model answer at the level the question targets.

---

## Warm-Up (Junior)

### Q1. What problem does the or-done-channel pattern solve?

**Answer.** A goroutine that reads from a channel with `for v := range ch` cannot be cancelled — it only exits when the channel closes. The or-done-channel pattern provides a small adapter that wraps an input channel together with a cancellation signal so the consumer's `range` loop exits whenever *either* the input closes or the cancellation fires.

---

### Q2. Write `orDone` for `chan int`.

**Answer.**

```go
func orDone(done <-chan struct{}, c <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for {
            select {
            case <-done:
                return
            case v, ok := <-c:
                if !ok {
                    return
                }
                select {
                case out <- v:
                case <-done:
                    return
                }
            }
        }
    }()
    return out
}
```

Generic version in Go 1.18+ takes `[T any]`.

---

### Q3. Why is `done` typed `chan struct{}` instead of `chan bool`?

**Answer.** `struct{}` is zero bytes — the channel value carries no information. The signal is the *closure* of the channel, not a value sent on it. `chan bool` would work but invites confusion about whether the value matters; the convention is `close(done)` not `done <- true`.

---

### Q4. What happens if I pass `nil` as the `done` channel?

**Answer.** A receive on a `nil` channel blocks forever. The `case <-done` in `select` is therefore never selectable. `orDone` then closes its output only when `c` closes — effectively a no-op cancellation. No panic, just silent loss of the cancellation guarantee.

---

## Core (Junior to Middle)

### Q5. Why are there *two* `select` statements in `orDone`?

**Answer.** The outer one waits for either a new value from `c` or `done`. The inner one waits for either the consumer to receive from `out` or `done`. Without the inner select, after reading `v` from `c`, the goroutine would block on `out <- v` if no consumer is reading, never observing the closed `done`. The pattern would leak the goroutine it was meant to protect.

---

### Q6. What is the difference between `orDone` and `context.Context`?

**Answer.** Functionally, for plain cancellation, almost nothing — `ctx.Done()` returns a `<-chan struct{}` that behaves identically to a `done` channel. `context.Context` adds three things on top: a tree of parent-child cancellations (`WithCancel(parent)`), deadlines (`WithTimeout`, `WithDeadline`), and request-scoped values (`WithValue`). `orDone` is the building block; `context` is the system built around it. Modern Go code prefers `context.Context`; bare `done` channels are reserved for small self-contained subsystems.

---

### Q7. What does this code print?

```go
done := make(chan struct{})
in := make(chan int, 3)
in <- 1
in <- 2
in <- 3
close(done)
for v := range orDone(done, in) {
    fmt.Println(v)
}
```

**Answer.** Indeterminate. The outer `select` can choose either `<-done` (printing nothing) or one of the buffered receives from `in` (printing one or more values). Both behaviours are correct under Go's select semantics. Production code must not depend on which one wins.

---

### Q8. How do you cancel from multiple sources?

**Answer.** Three approaches:

1. **Nest `orDone`**: `orDone(d1, orDone(d2, c))`. The output closes when either signal fires. Simple for two sources; adds one goroutine per layer.
2. **Build a context tree**: `child, _ := context.WithCancel(parent)`. Cancelling parent cancels child. Idiomatic for hierarchical cancellation.
3. **Merge done channels**: build a small `mergeDone(d1, d2, ..., dN) <-chan struct{}` using `reflect.Select`. Useful for many flat sources.

For 1–2 sources, nesting is fine. For 3+, prefer context trees.

---

### Q9. How do you test that `orDone` does not leak goroutines?

**Answer.** Use `go.uber.org/goleak`:

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

Then write tests that exercise every cancellation path — done-before-any-value, done-mid-stream, done-while-consumer-stalled — and assert the test exits with no leaked goroutines. `goleak` checks at process exit and prints stack traces of any survivors.

---

### Q10. Can I close `done` twice?

**Answer.** No — `close` on an already-closed channel panics with "close of closed channel." Two safe options:

```go
var once sync.Once
cancel := func() { once.Do(func() { close(done) }) }
```

Or use `context.WithCancel`, whose `cancel()` is idempotent. The bare-channel form lacks built-in idempotency.

---

## Design (Middle to Senior)

### Q11. A library returns `<-chan Event`. You want every consumer to handle cancellation. Where do you put the `orDone`?

**Answer.** Inside the library, at the boundary:

```go
func (b *Bus) Subscribe(ctx context.Context) <-chan Event {
    raw := b.subscribe()
    return orDoneCtx(ctx, raw)
}
```

The caller does `for ev := range bus.Subscribe(ctx)` and gets cancellation for free. Putting `orDone` at every caller site is wasteful and easy to forget. Putting it inside the library wraps the concern once.

---

### Q12. Does `orDone` stop the producer of `c`?

**Answer.** No. `orDone` only governs the *consumer side* — it stops forwarding when `done` closes, and exits its own goroutine. The producer is not signalled. If the producer keeps sending into `c`, and no one is reading after the `orDone` goroutine exits, the producer will block on `c <- v` and leak.

To stop the producer as well, the producer must observe `done` (or its `ctx`) inside its own send-select. `orDone` covers the receive side; the producer must cover the send side.

---

### Q13. When would you NOT use `orDone`?

**Answer.** Several cases:

- The stream is short-lived and will close naturally. No cancellation needed.
- You are in a hot path (millions of values per second). The extra goroutine and channel hop are measurable.
- You need to drain remaining values on cancel. `orDone` discards in-flight values; build `drainOrDone` instead.
- The cancellation semantics are not "Drop" — e.g., you need to block until quiescent, or compensate by emitting rollbacks. These require state machines, not channel combinators.
- You are in a terminal stage with no output channel — `eachOrDone(done, c, fn)` is one goroutine cheaper.

---

### Q14. Sketch the cost model of `orDone` per use.

**Answer.** Per invocation:

- One goroutine started: ~1.5–3 µs startup, ~2 KB initial stack.
- One channel allocated: small constant.

Per value:

- One extra channel send + receive: ~50–150 ns.

For streams below ~100K values/second, the cost is invisible. Between 100K and 1M, measurable. Above 1M, significant — consider inlining the `select`.

---

### Q15. How does `orDone` interact with backpressure?

**Answer.** With an *unbuffered* output, backpressure is preserved: producer blocks on its send until the `orDone` goroutine receives, which blocks until the consumer receives. One value sits "in flight" inside the `orDone` goroutine at any time.

With a *buffered* output of capacity N, the `orDone` goroutine can race ahead by up to N values from the producer's perspective. Producer experiences smoother send rates but the consumer's slowdowns are masked for up to N values.

For cancellation, the buffer means up to N values are in the buffer when `done` fires; whether the consumer drains them depends on whether it reads or breaks. Most `range out` loops exit on close and the buffered values are silently dropped.

---

## Deeper (Senior to Professional)

### Q16. Walk me through the lifecycle of an `orDone` goroutine in a pipeline that is shutting down.

**Answer.**

1. The supervisor closes `done`.
2. The `orDone` goroutine, currently blocked in one of its two selects, observes `<-done` and returns.
3. `defer close(out)` runs, closing the output channel.
4. The consumer's `range out` sees the close and exits its loop.
5. The producer side (if it also observes `done`) exits its own loop and closes `c`.

If the consumer is *not* currently blocked on `range`, the goroutine in step 2 may have been blocked on the inner select (sending to `out`). The closed `done` makes the inner select pick the `<-done` case and the same exit path runs.

Crucial property: this whole sequence is independent. Closing `done` triggers it; nothing else is required.

---

### Q17. You have a pipeline of five stages, each wrapping its input with `orDone`. Estimate the per-value overhead.

**Answer.** Five extra channel hops per value, at ~50–150 ns each → 250–750 ns of overhead per value. For 1M values/second that is 250 ms to 750 ms of CPU time per second — 25–75% of one core.

For most pipelines this is acceptable. For high-throughput data planes it is not. Mitigations:

- Inline the select in the hottest stage.
- Combine adjacent stages into a single goroutine.
- Use `eachOrDone` for terminal stages.

Measure with `pprof` before reorganising.

---

### Q18. How would you adapt `orDone` to also support a deadline?

**Answer.** Two options:

**Option A**: use `context.WithTimeout` and pass `ctx.Done()`:

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
out := orDone(ctx.Done(), c)
```

`ctx.Done()` closes when either `cancel` is called or the timeout elapses.

**Option B**: build a custom merged channel from `done` and `time.After`:

```go
func orDoneTimeout[T any](done <-chan struct{}, c <-chan T, d time.Duration) <-chan T {
    timer := time.NewTimer(d)
    defer timer.Stop()
    merged := make(chan struct{})
    go func() {
        defer close(merged)
        select {
        case <-done:
        case <-timer.C:
        }
    }()
    return orDone(merged, c)
}
```

Option A is simpler and the standard library convention. Option B is for code that does not already have a context plumbed.

---

### Q19. Two goroutines call `close(done)` concurrently. What happens?

**Answer.** One succeeds, the other panics. `close` on an already-closed channel panics, and the runtime does not serialise close calls. Mitigation: wrap with `sync.Once`:

```go
var once sync.Once
cancel := func() { once.Do(func() { close(done) }) }
```

Or, more idiomatically in 2026, use `context.WithCancel`, whose `cancel()` is idempotent and safe to call from any goroutine any number of times.

---

### Q20. How is `orDone` related to the "channel ownership" principle?

**Answer.** Channel ownership says: the goroutine that creates a channel is responsible for closing it; only the owner closes. `orDone` follows this exactly. The `orDone` goroutine creates `out` and closes it via `defer close(out)`. It does NOT close `c` (which belongs to the producer) or `done` (which belongs to the cancelling caller).

The receive-only return type `<-chan T` is the type system enforcing this: callers cannot close `out` because they cannot get a bidirectional reference to it.

---

## Edge Cases (Senior to Professional)

### Q21. The producer of `c` never closes it, and `done` never closes. What is the state of the `orDone` goroutine?

**Answer.** Blocked. If the consumer is reading, the goroutine forwards values forever. If the consumer stops reading, the goroutine blocks on `out <- v` forever. Either way, the goroutine leaks for the lifetime of the program.

Mitigation: `done` must always close eventually. Make `defer close(done)` the first line in any function that creates a `done` channel.

---

### Q22. The consumer panics while inside `range orDone(done, c)`. What happens to the `orDone` goroutine?

**Answer.** The consumer's panic unwinds its stack, which includes the `range` loop. The `range` loop exits without closing the output channel (it does not own `out`). The `orDone` goroutine is now blocked on `out <- v` with no receiver.

If `done` is closed (e.g., by a `defer close(done)` higher in the call stack), the inner select unblocks via the `done` case and the goroutine exits. If `done` is never closed, the goroutine leaks.

This is why `defer close(done)` should be at the top of any function that supervises an `orDone` chain: it must fire even if the consumer panics.

---

### Q23. Buffered `orDone` with capacity 16. The consumer crashes. How long until the producer notices?

**Answer.** It depends on the producer's send rate.

- The `orDone` goroutine reads 16 values from `c` and pushes them into the buffer.
- The 17th send `out <- v` blocks.
- The producer's next send on `c` then blocks (no receiver).
- The producer notices "backpressure" after the 17th value.

If `done` is closed during this, the `orDone` goroutine exits, but the 16 buffered values are inside `out` with no reader. They are discarded when `out` is garbage-collected.

The producer-side notification depends on observability — only the eventual block reveals the problem. Add a metric on the producer's send latency to detect this earlier.

---

### Q24. What does the race detector say about this code?

```go
var counter int
out := orDone(done, c)
go func() {
    for range out {
        counter++
    }
}()
close(done)
fmt.Println(counter)
```

**Answer.** This is a data race. `counter++` writes to `counter` from one goroutine; `fmt.Println(counter)` reads from another. There is no happens-before edge between them because `close(done)` does not synchronise with the consumer goroutine's exit.

Fix: wait for the consumer to exit before reading `counter`.

```go
done := make(chan struct{})
defer close(done)
out := orDone(done, c)

var counter int
finished := make(chan struct{})
go func() {
    defer close(finished)
    for range out {
        counter++
    }
}()
close(done)
<-finished
fmt.Println(counter) // safe
```

The `finished` channel close establishes the happens-before edge.

---

### Q25. Could you write `orDone` *without* spawning a goroutine?

**Answer.** Not as a function that returns a `<-chan T`. The return must be a channel; producing values on it requires a goroutine somewhere. You can, however, write the *equivalent* of `for v := range orDone(done, c)` as an inline loop:

```go
for {
    select {
    case <-done:
        return
    case v, ok := <-c:
        if !ok {
            return
        }
        use(v)
    }
}
```

No extra goroutine, no extra channel. The trade-off is that the cancellation logic is now part of every consumer instead of factored out. For terminal stages, this is the right shape; for forwarding stages, you need the channel and so the goroutine returns.

---

## Quick-Fire Round

- **Q.** What's the function signature? **A.** `func orDone[T any](done <-chan struct{}, c <-chan T) <-chan T`.
- **Q.** Who closes the output? **A.** `orDone` itself, via `defer close(out)`.
- **Q.** Who closes the input? **A.** The original producer, never `orDone`.
- **Q.** Where is the pattern documented? **A.** Katherine Cox-Buday, *Concurrency in Go*, Chapter 4.
- **Q.** Modern equivalent in idiomatic Go? **A.** `context.Context` with `ctx.Done()`.
- **Q.** One-line bridge? **A.** `func orDoneCtx[T any](ctx context.Context, c <-chan T) <-chan T { return orDone(ctx.Done(), c) }`.
- **Q.** Cost per value? **A.** ~50–150 ns plus one goroutine context switch.
- **Q.** What language feature made this clean in 2018+? **A.** Go 1.18 generics.

---

These questions cover the spectrum from "what is this code?" to "where does it belong in a system?" A candidate at the senior level should answer Q1–Q15 fluently, sketch Q16–Q20 on a whiteboard, and reason carefully through Q21–Q25.

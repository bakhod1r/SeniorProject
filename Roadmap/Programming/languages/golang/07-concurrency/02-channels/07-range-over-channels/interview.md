# Range Over Channels — Interview Questions

> Interview Q&A from junior to staff. Each question is short; each answer is precise. Use this as a self-quiz or as a guide to what an interviewer probes.

## Table of Contents

1. [Junior](#junior)
2. [Middle](#middle)
3. [Senior](#senior)
4. [Staff / Principal](#staff--principal)
5. [Code-Reading Questions](#code-reading-questions)
6. [System-Design Questions](#system-design-questions)
7. [Tricky / Trap Questions](#tricky--trap-questions)

---

## Junior

### Q1. What does `for v := range ch` do?

It receives values from the channel `ch` one at a time, assigning each to `v`, and executes the loop body for each. The loop exits when the channel is closed and drained.

---

### Q2. When does a `range` over a channel loop exit?

When both of the following are true:

1. `close(ch)` has been called.
2. All buffered values have been received.

If either condition is missing, the loop continues to block.

---

### Q3. Who is responsible for closing the channel?

The sender (producer). Receivers must not close. A `range` consumer never closes — it just exits when the channel is closed by someone else.

---

### Q4. What happens if no one ever closes the channel?

The `range` loop blocks forever after the last value, leaking the consumer goroutine. If every goroutine in the program is stuck this way, the runtime detects "all goroutines are asleep" and panics.

---

### Q5. What is `range` over a `nil` channel?

It blocks forever, silently. A `nil` channel never delivers a value and never closes. No panic, no deadlock detection unless all other goroutines are also stuck.

---

### Q6. What is the manual equivalent of `for v := range ch`?

```go
for {
    v, ok := <-ch
    if !ok { break }
    use(v)
}
```

Identical semantics, identical machine code after compilation.

---

### Q7. Does `range` give you a second value (like an index or `ok`)?

No. Channels have no index, and the `ok` is consumed internally by `range` to decide whether to exit. The body sees only the value.

---

### Q8. Can you `range` a send-only channel `chan<- T`?

No. Send-only channels cannot be received from, and `range` is a receive. The compiler rejects it.

---

### Q9. What happens if the producer panics without closing?

The producer goroutine dies. The consumer's `range` blocks on the next receive. The consumer goroutine leaks. Unrecovered panics also crash the entire program. Always `defer close(ch)` *and* `defer recover()` at the boundary.

---

### Q10. How do you write a clean producer/consumer with range?

```go
func produce(out chan<- int) {
    defer close(out)
    for _, v := range source { out <- v }
}

func consume(in <-chan int) {
    for v := range in { use(v) }
}
```

The producer closes on exit; the consumer ranges to completion.

---

## Middle

### Q11. How do you handle multiple producers, one consumer?

Use a closer goroutine that waits for all producers via `sync.WaitGroup` and then closes the channel exactly once. No producer should close the channel directly.

```go
var wg sync.WaitGroup
for _, p := range producers { wg.Add(1); go func(p){ defer wg.Done(); p.Run(ch) }(p) }
go func() { wg.Wait(); close(ch) }()
for v := range ch { use(v) }
```

---

### Q12. Why does `break` in a `range` loop risk a producer leak?

After `break`, no one is reading the channel. If the producer keeps sending, the next send blocks (unbuffered) or fills the buffer and then blocks. The producer goroutine never exits. To prevent this, signal the producer via context or a done channel.

---

### Q13. How does `range` compose into pipelines?

Each stage is a goroutine that `range`s its input and sends to its output, with `defer close(out)`. Chaining many stages creates a pipeline where close cascades from source to sink, draining all in-flight values.

---

### Q14. When must you switch from `range` to `select`?

When you need any of:

- Multiple input channels.
- Cancellation via context (`<-ctx.Done()`).
- Timeouts.
- Non-blocking polls.
- Reading and writing in one loop iteration.

`range` cannot express any of these.

---

### Q15. How do you make a `range`-based consumer respect a context?

Make the *producer* respect the context. When the context is cancelled, the producer returns, its `defer close` runs, and the consumer's `range` exits naturally. This keeps the consumer simple.

Alternatively, replace `range` with `for { select { case v, ok := <-ch: ...; case <-ctx.Done(): return } }`.

---

### Q16. How do you implement fan-out with `range`?

Spawn N worker goroutines, all `range`ing the same channel:

```go
for i := 0; i < N; i++ {
    go func() {
        for job := range jobs { process(job) }
    }()
}
```

Each worker competes for values; the runtime delivers each value to exactly one worker. Closing `jobs` makes all workers exit.

---

### Q17. How do you implement fan-in with `range`?

Each source has its own forwarder goroutine that `range`s the source and sends to a merged channel. A closer goroutine waits for all forwarders and closes the merged channel. The downstream consumer `range`s the merged channel.

---

### Q18. What is the cost of `range` per iteration?

About the cost of one channel receive: 30–70 ns fast path, 1–10 µs slow path (when parking and waking across goroutines). Compared to a manual receive, there is no overhead — `range` compiles to the same instructions.

---

### Q19. What happens if you close a channel twice?

Panic: `close of closed channel`. Always have exactly one owner of the close call, ideally guarded by `sync.Once` or by structural discipline (a single closer goroutine).

---

### Q20. How do you test that a `range`-based consumer exits cleanly?

Create the channel, start the consumer goroutine, close the channel, and assert the goroutine exits within a timeout:

```go
done := make(chan struct{})
go func() { for range ch {}; close(done) }()
close(ch)
select {
case <-done: // pass
case <-time.After(time.Second): t.Fatal("did not exit")
}
```

---

## Senior

### Q21. What is "channel ownership" and how does `range` relate?

Channel ownership is the design rule: one goroutine (or one designated closer) is responsible for sending and closing. Every other goroutine is a consumer. `range` consumers are non-owners; they receive until close. The owner closes exactly once.

---

### Q22. How does `range` over a channel fit structured concurrency?

The producer's `close` is its "done" signal. The consumer's `range` exit observes that signal. Combined with `errgroup.WithContext`, a parent function spawns producer and consumer; cancellation cascades down; both children exit cleanly; `g.Wait` returns. No bespoke shutdown protocol.

---

### Q23. Compare `range` over a channel with Go 1.23 range-over-func.

| Aspect | Channel range | Func range (1.23) |
|---|---|---|
| Producer | Separate goroutine | Same goroutine (synchronous) |
| Concurrency | Yes | No |
| Leak risk | High (if not closed) | None |
| Cost per value | ~50 ns + scheduler | ~5 ns function call |
| Use case | Concurrent producer/consumer | Lazy iteration |

For sequential iteration, prefer func range. For concurrent producer/consumer with buffering, channel range is required.

---

### Q24. How does the compiler lower `for v := range ch`?

To a `for` loop that calls `runtime.chanrecv2(ch, &v)`, checks the returned `ok` bool, and breaks if `false`. The runtime function handles fast-path receives from the buffer and slow-path parking when the channel is empty.

---

### Q25. What is `chanrecv2` and how does it work?

A runtime helper (`runtime/chan.go`) that performs a blocking receive and returns whether the receive corresponded to a real send (`ok=true`) or to a closed-and-drained channel (`ok=false`). It acquires the channel's internal mutex, checks for waiting senders / buffered values / closed state, and either copies the value immediately or parks the goroutine via `gopark`.

---

### Q26. What happens at the runtime level when `range` blocks?

The goroutine is added to the channel's `recvq` waiter queue, then `gopark` deschedules it. The scheduler runs other goroutines on the M. When a sender arrives, it copies the value directly into the waiting goroutine's stack (via `sendDirect`) and calls `goready`. The receiver eventually resumes inside `chanrecv2`.

---

### Q27. How does `close` interact with goroutines parked in `range`?

`close` walks `recvq` and wakes every parked receiver with `ok=false`. Each receiver returns from `chanrecv2`, sees `ok=false`, and exits its `range` loop. This is how a single `close` call can unblock many consumers atomically.

---

### Q28. When does Go's memory model guarantee visibility of values sent through a channel?

> The kth receive on a channel with capacity C is synchronized before the (k+C)th send completes.

In practice: anything the sender wrote *before* sending is visible to the consumer *after* receiving. The channel itself acts as a memory barrier. No additional `sync.Mutex` is needed for the data flowing through the channel.

---

### Q29. How do you design a pipeline that handles errors without losing work?

Use `errgroup.WithContext`. Each stage's goroutine returns an error; the first non-nil error cancels the context; all stages observe the cancel and exit cleanly. Combine with structured error types embedded in the value (`type Result struct { V; Err error }`) so per-item errors do not abort the pipeline unnecessarily.

---

### Q30. How do you bound a `range`-based pipeline's memory use?

Size the channel buffers explicitly. Each buffer of capacity `N` allows at most `N` in-flight items. With M stages and buffer N per stage, you have at most `M * N` items in flight, plus what is in each goroutine's local processing. Tune to fit the memory budget.

---

## Staff / Principal

### Q31. Walk me through a production incident caused by a `range` leak.

A typical scenario: a request handler spawns a goroutine that `range`s a channel of results. The channel is closed when the upstream service finishes. But a code change makes the upstream service hang indefinitely on a slow query. The goroutine accumulates per request. Over hours, `runtime.NumGoroutine` climbs from 100 to 100K, memory bloats, GC time explodes, latency degrades.

Diagnosis: pprof goroutine dump shows thousands of goroutines parked in `chanrecv1` / `chanrecv2`, all on the same channel type. Each is a leaked `range` consumer.

Fix:

1. Add a context to the upstream call so it times out.
2. Make the channel producer respect the context (close on cancel).
3. Add a Prometheus metric on `runtime.NumGoroutine` and an alert.

---

### Q32. How do you make a `range`-based pipeline observable in production?

Wrap each stage:

```go
for v := range in {
    inboundCounter.Inc()
    start := time.Now()
    out <- transform(v)
    latencyHist.Observe(time.Since(start).Seconds())
}
```

Add per-stage tracing spans, log when the stage exits (with item counts), and expose channel queue lengths as gauges. Many issues become diagnosable from metrics alone.

---

### Q33. When have channels failed you at scale?

Common failures:

- Throughput ceilings around 1–5M ops/sec per channel due to internal lock contention.
- Per-value overhead dominating a workload that should be batched.
- A long-lived global channel becomes the "everyone fans out from here" bottleneck.
- Pipeline shape becomes hard to evolve as the team grows; refactoring a 10-stage pipeline is hard.

In those cases, alternatives are: batching (channel of slices), sharded channels (key-routed), lock-free queues, or moving to a proper message broker (Kafka, NATS).

---

### Q34. How would you build a context-aware `range` adapter for Go 1.23 iterators?

```go
func RangeCtx[T any](ctx context.Context, ch <-chan T) iter.Seq[T] {
    return func(yield func(T) bool) {
        for {
            select {
            case v, ok := <-ch:
                if !ok { return }
                if !yield(v) { return }
            case <-ctx.Done():
                return
            }
        }
    }
}

// Usage:
for v := range RangeCtx(ctx, ch) {
    process(v)
}
```

Now early break + context cancellation both work cleanly. The producer still needs to respect context to avoid leaking *its* goroutine.

---

### Q35. What is your code-review checklist for `range` over a channel?

1. Where is `close(ch)` called? Find it.
2. Is the closer the sole writer? If multiple writers, where is the closer goroutine?
3. Is the channel buffered appropriately for the throughput?
4. Does the consumer handle the channel's element zero value correctly?
5. Is there a context or cancellation path?
6. What happens if the body panics?
7. Are there tests asserting termination when the channel closes?
8. Does the design respect Go's "sender closes" convention?

---

### Q36. Design a graceful-shutdown protocol for a 5-stage pipeline.

1. Top-level context with timeout.
2. Each stage is an `errgroup.Go` callback.
3. Each producer/intermediate stage:
   - `defer close(out)`.
   - Body has `select { case out <- v: case <-ctx.Done(): return }` on sends.
4. Each consumer/intermediate stage:
   - Pure `for v := range in`. Cancellation arrives via close from upstream.
5. On shutdown: cancel the context. Producers return, close their outputs. Consumers drain and exit. `g.Wait()` returns; if any returned an error, that is the result.

No goroutine leaks, no work dropped (modulo the buffer at the time of cancel).

---

### Q37. When would you use multiple `range` consumers on the same channel?

Worker pool pattern. N consumers `range` the same channel:

```go
for i := 0; i < N; i++ {
    go func() { for v := range jobs { process(v) } }()
}
```

The runtime delivers each value to exactly one consumer. Each consumer is independent. Closing `jobs` makes all of them exit, and you can `wg.Wait` for confirmation.

This is the cleanest way to bound parallelism: N is the concurrency limit.

---

### Q38. How do you migrate a channel-based API to a Go 1.23 iterator API without breaking callers?

Provide both:

```go
// Existing:
func Stream(ctx context.Context) <-chan Item { ... }

// New, wrapping the existing:
func Iter(ctx context.Context) iter.Seq[Item] {
    return func(yield func(Item) bool) {
        for v := range Stream(ctx) {
            if !yield(v) { return }
        }
    }
}
```

Deprecate `Stream` in a future major version. Library callers can migrate at their own pace.

---

### Q39. Tell me about a time you replaced `range` with `select` in a refactor.

When the consumer needed to observe context cancellation, a heartbeat tick, and the input channel — three sources of work. `range` over the input alone could not handle the other two. The refactor was `for { select { case v, ok := <-in: ... case <-tick.C: ... case <-ctx.Done(): return } }`. It became more verbose but expressed the actual control flow.

---

### Q40. Argue for or against using channels as the primary concurrency primitive.

For: clear ownership semantics, structured shutdown via close, composable pipelines, memory model guarantees, language-level support, idiomatic in the Go community.

Against: slower than atomics for fine-grained synchronisation, lock contention at extreme scale, no multicast, no replay, opaque under monitoring, can hide complexity inside goroutine state.

The pragmatic answer: channels and `range` are an excellent default for "communication between concurrent components." For shared counters use atomics, for mutex-style critical sections use `sync.Mutex`, for high-fan-out events use a pub/sub library. Pick the right primitive per problem.

---

## Code-Reading Questions

### Q41. What does this code do?

```go
ch := make(chan int, 3)
ch <- 1; ch <- 2; ch <- 3
close(ch)
for v := range ch { fmt.Println(v) }
```

Prints `1`, `2`, `3` and exits. The closed-but-drained channel makes the loop exit after the last value.

---

### Q42. Find the bug.

```go
ch := make(chan int)
go func() {
    for i := 0; i < 5; i++ { ch <- i }
}()
for v := range ch { fmt.Println(v) }
```

The producer never closes `ch`. After printing 0–4, the consumer blocks; with no other work to do, the runtime panics with "all goroutines are asleep — deadlock." Fix: `defer close(ch)` in the producer.

---

### Q43. Find the bug.

```go
var ch chan int
go func() { for i := 0; i < 5; i++ { ch <- i } }()
for v := range ch { fmt.Println(v) }
```

`ch` is `nil`. Sends to nil block forever; `range` over nil blocks forever. The program deadlocks silently or with the runtime's deadlock panic. Fix: `ch := make(chan int)`.

---

### Q44. What does this print?

```go
ch := make(chan int)
close(ch)
for v := range ch { fmt.Println(v) }
fmt.Println("done")
```

Just `done`. The closed empty channel makes `range` exit on the first receive.

---

### Q45. Spot the leak.

```go
func find(ch <-chan int, target int) (int, bool) {
    for v := range ch {
        if v == target {
            return v, true
        }
    }
    return 0, false
}
```

If the producer is unbounded (never closes, keeps producing), `find` may return on a match, but the producer keeps trying to send and blocks on the next send. The producer goroutine leaks. Fix: signal the producer to stop, e.g., via context or a done channel.

---

## System-Design Questions

### Q46. Design a log aggregator.

Single channel `logCh` of capacity 1024. Producers across the application do non-blocking sends (drop on full). A single writer goroutine `range logCh` and flushes lines to disk. On shutdown, close `logCh`, writer drains and exits.

---

### Q47. Design a worker pool for image resizing.

`jobs` channel of `ResizeJob`. N worker goroutines (= GOMAXPROCS) each `range jobs` and process. A dispatcher accepts incoming requests and `jobs <- job`. On shutdown, dispatcher closes `jobs`; workers exit; `wg.Wait` returns.

---

### Q48. Design a streaming server-sent-events endpoint.

Per-connection goroutine creates an `events` channel. A producer (e.g., subscribing to an event bus) writes to `events`. The handler `for e := range events { write to wire; flush }`. When the request context cancels, the producer closes `events`, the handler exits, the connection closes.

---

### Q49. Design a graceful drain on container shutdown.

Application listens for SIGTERM. On signal, cancel the top-level context. All producers respect the context, return, close their outputs. All `range`-based consumers see the close, drain remaining buffered work, exit. A final `errgroup.Wait` confirms everything stopped. Container exits with code 0.

---

### Q50. When would you NOT use `range` for a producer/consumer relationship?

- The producer is naturally request/response (use direct call instead).
- The consumer needs to listen to many channels (use `select`).
- The producer cannot close cleanly (e.g., infinite stream — use `select` + cancel).
- The throughput requires batching (use channel of slices, not values).
- The relationship is many-to-many with replay (use a message broker).

---

## Tricky / Trap Questions

### Q51. Is this code correct?

```go
for v := range ch {
    go func() { process(v) }()
}
```

Two issues:

1. Pre-Go 1.22: all goroutines share `v` (captured loop variable bug). Fix: `go func(v T) { process(v) }(v)`.
2. Unbounded goroutine spawning. If `ch` produces faster than `process` runs, you accumulate thousands of goroutines. Use a worker pool.

---

### Q52. Will this `range` exit?

```go
ch := make(chan int, 1)
ch <- 1
go func() {
    time.Sleep(time.Second)
    close(ch)
}()
for v := range ch {
    fmt.Println(v)
}
```

Yes. The loop prints `1`, then blocks on the next receive. After 1 second, the closer goroutine closes the channel; the blocked receive returns `ok=false`; the loop exits.

---

### Q53. What is wrong with this fan-in?

```go
ch := make(chan int)
for _, src := range sources {
    go func(src <-chan int) {
        for v := range src { ch <- v }
        close(ch)  // BUG
    }(src)
}
for v := range ch { use(v) }
```

Each goroutine tries to close `ch`. The first one succeeds; subsequent ones panic "close of closed channel". Even worse, after `ch` is closed, the still-running forwarders panic on send. Fix: use a single closer goroutine with `sync.WaitGroup`.

---

### Q54. Can the consumer's `range` see partial values?

No. The Go memory model guarantees the value received is the value sent — atomic with respect to other channel operations on this channel. The consumer never sees a torn or partial value.

---

### Q55. Is `for range ch { }` valid syntax?

Yes. It receives values and discards them. Useful for draining a channel without using its values (e.g., to ensure the producer can complete).

---

### Q56. Will this `range` ever process value 5?

```go
ch := make(chan int, 10)
for i := 0; i < 10; i++ { ch <- i }
close(ch)
for v := range ch {
    if v == 5 { break }
    fmt.Println(v)
}
```

It will print 0–4 and then break on 5. Values 5–9 are still in the buffer; they are never consumed. The channel is left closed with values inside (which is legal — the next `range` over `ch` would consume them).

---

### Q57. What happens if you `range` a nil channel inside `select`?

```go
var ch chan int
select {
case v := <-ch: // never selected
case <-time.After(time.Second): // selected
}
```

A nil channel inside `select` is permanently unselectable — it never delivers a value. This is sometimes used intentionally to "disable" a case. Outside of `select`, a receive on nil blocks forever.

---

### Q58. Two consumers `range` the same channel. Who gets what?

The runtime picks one consumer per send, in implementation-defined order (effectively, whichever was parked first or whichever the scheduler reaches first). Each value goes to exactly one consumer. There is no broadcast.

---

### Q59. Can `range` over a channel produce duplicate values?

No. Each value sent on the channel is received exactly once across all consumers. Channels are not pub/sub.

---

### Q60. What is the difference between `range ch` and `<-ch` in a hot loop?

None, in terms of performance: both compile to a call to `chanrecv2` (or `chanrecv1` for the single-value form). The difference is style: `range` is idiomatic for "all values until close"; manual `<-ch` is for one-shot or for when you need `ok` in the body.

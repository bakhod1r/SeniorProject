# Range Over Channels — Middle Level

> Focus: "How do I use `range` in real production code — pipelines, fan-in, graceful shutdown, and the moment I have to abandon `range` for `select`?"

## Table of Contents

1. [Producer/Consumer Done Right](#producerconsumer-done-right)
2. [Multi-Producer Coordination](#multi-producer-coordination)
3. [Pipeline Architecture](#pipeline-architecture)
4. [Fan-Out and Fan-In](#fan-out-and-fan-in)
5. [Range vs Select — When to Switch](#range-vs-select--when-to-switch)
6. [Graceful Shutdown and Drain](#graceful-shutdown-and-drain)
7. [Back-Pressure with Buffer Sizing](#back-pressure-with-buffer-sizing)
8. [Combining Range With Context](#combining-range-with-context)
9. [Common Real-World Bugs](#common-real-world-bugs)
10. [Performance Trade-Offs](#performance-trade-offs)
11. [Patterns You Will See in Real Codebases](#patterns-you-will-see-in-real-codebases)
12. [Testing Range-Based Code](#testing-range-based-code)

---

## Producer/Consumer Done Right

The minimal pattern from the junior file is the foundation:

```go
func produce(out chan<- int) {
    defer close(out)
    for i := 0; i < 10; i++ {
        out <- i
    }
}

func consume(in <-chan int) {
    for v := range in {
        fmt.Println(v)
    }
}

func main() {
    ch := make(chan int)
    go produce(ch)
    consume(ch)
}
```

Three things make this *correct*:

1. **`defer close(out)`** ensures the channel closes on every exit path, including panic.
2. **Channel direction in the signature** (`chan<- int` for sender, `<-chan int` for receiver) is the type system stating who is allowed to do what. The compiler will block accidental misuse.
3. **The consumer does not close.** It just exits when the channel closes.

This pattern composes. Once you internalise it, you can chain consumers and producers into long pipelines.

### A common production-ready variant: error reporting

```go
type Item struct {
    Val int
    Err error
}

func produce(ctx context.Context, out chan<- Item) {
    defer close(out)
    for i := 0; i < 10; i++ {
        v, err := fetch(i)
        select {
        case out <- Item{Val: v, Err: err}:
        case <-ctx.Done():
            return
        }
    }
}

func consume(in <-chan Item) {
    for it := range in {
        if it.Err != nil {
            log.Printf("error: %v", it.Err)
            continue
        }
        process(it.Val)
    }
}
```

Errors flow through the channel as part of the value. The consumer `range`s normally. The producer respects `ctx` — if the consumer goes away, the producer is told via cancellation.

---

## Multi-Producer Coordination

When you have N producers writing to one channel and one consumer `range`ing it, the question is: who closes?

**Rule.** Exactly one goroutine must close the channel, exactly once. With N producers, none of them can safely close (the others are still writing). The clean solution is a *closer* goroutine that waits for all producers, then closes.

```go
ch := make(chan Job, 64)
var wg sync.WaitGroup

for _, src := range sources {
    wg.Add(1)
    go func(src Source) {
        defer wg.Done()
        src.PumpInto(ch)
    }(src)
}

go func() {
    wg.Wait()
    close(ch)
}()

for j := range ch {
    process(j)
}
```

The closer goroutine has exactly one job: wait for all producers to finish, then close the channel. The consumer `range`s normally and exits when all producers are done.

### Why not have one producer be "the last" and close?

Because there is no way for a producer to know it is last without coordination — and that coordination is essentially a `WaitGroup`, which is what the closer goroutine already uses. The closer-goroutine pattern keeps the closing decision in a single, easy-to-audit place.

### Pitfall: closing race

```go
// WRONG — many producers, all race to close
for _, src := range sources {
    go func(src Source) {
        src.PumpInto(ch)
        close(ch) // some will run after channel is closed -> panic
    }(src)
}
```

`close` on an already-closed channel panics. Only the closer goroutine should call `close`.

---

## Pipeline Architecture

A pipeline is a chain of goroutines connected by channels. Each stage:

1. `range`s its input.
2. Transforms each value.
3. Sends the transform to its output.
4. Closes its output when its input is drained.

```go
func generate(nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range nums {
            out <- n
        }
    }()
    return out
}

func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- v * v
        }
    }()
    return out
}

func sum(in <-chan int) int {
    total := 0
    for v := range in {
        total += v
    }
    return total
}

func main() {
    nums := generate(1, 2, 3, 4, 5)
    squares := square(nums)
    fmt.Println(sum(squares)) // 55
}
```

Three stages, three goroutines. Close cascades from `generate` down: when `generate` finishes, its `out` closes; `square` exits its `range` and closes its `out`; `sum`'s `range` exits and the function returns.

This is *the* canonical Go pipeline. Once you see it, you see it everywhere.

### Why this composes

Each stage is independent. Each is a one-line `range` consuming from upstream, plus a `defer close` on its output. Adding a new stage means writing a new function with the same shape and inserting it into the chain. No coordination protocol, no shared state, no locks.

### A note on stage failure

If a stage panics without recovering, its `defer close` still runs (if you wrote `defer close(out)` first), which lets downstream stages drain and exit. But the panic still kills the program. For production pipelines, wrap the body with `recover` and either send an error value down the stream or signal cancellation upstream.

---

## Fan-Out and Fan-In

**Fan-out** = one producer, many consumers, all `range`ing the same channel:

```go
func fanOut(in <-chan Job, n int) {
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range in {
                process(j)
            }
        }()
    }
    wg.Wait()
}
```

All N workers compete to receive from `in`. The runtime picks one per send. When `in` closes, every worker's `range` exits, every `wg.Done` fires, and `wg.Wait` returns. This is the worker pool pattern.

**Fan-in** = many producers, one consumer, all sending to one channel:

```go
func fanIn(srcs ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for _, s := range srcs {
        wg.Add(1)
        go func(s <-chan int) {
            defer wg.Done()
            for v := range s {
                out <- v
            }
        }(s)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

Each producer's goroutine `range`s its own input and forwards to `out`. When all producer inputs close, all forwarder goroutines exit, the `WaitGroup` releases, and the closer closes `out`. The downstream consumer `range`s `out` and exits cleanly.

Notice the structure: every level of fan-in is itself a multi-producer scenario, and we use the same closer-goroutine pattern.

---

## Range vs Select — When to Switch

`range` is single-channel and blocks until close. As soon as you need *any* of these, you must use `select`:

- Multiple input channels.
- A cancellation channel or `ctx.Done()`.
- A timeout.
- Non-blocking poll.
- Reading and writing in the same loop iteration.

### `select` as a manual `range`

```go
for {
    select {
    case v, ok := <-ch:
        if !ok {
            return
        }
        process(v)
    case <-ctx.Done():
        return
    }
}
```

This is the most common upgrade path: a `range` that needs to honour a context becomes a `for-select` with a two-value receive in one case and a cancellation case in the other.

### Cost of the switch

`select` is slightly heavier than `range` (the runtime evaluates each case), but the difference is rarely the bottleneck. The clarity of `range` is the only thing you lose. Switch to `select` the moment you need more control; do not bend `range` to fit.

### Combining: a `range` loop with `select` inside the body

You can keep `range` for the main loop and use `select` only for the *send* on the output:

```go
for v := range in {
    transformed := transform(v)
    select {
    case out <- transformed:
    case <-ctx.Done():
        return
    }
}
```

Now you handle cancellation on the *send* side, where blocking can happen. This is the standard "context-aware pipeline stage" pattern.

---

## Graceful Shutdown and Drain

On shutdown, you want every in-flight value to be processed before the consumer exits. `range` makes this almost automatic — provided the producer closes.

The shutdown protocol:

1. Signal the producer to stop (via context or a quit channel).
2. The producer finishes its current send, then returns, triggering `defer close`.
3. The consumer's `range` drains whatever is left in the buffer.
4. When the buffer is empty, the consumer's `range` exits.
5. Cleanup runs.

```go
func produce(ctx context.Context, out chan<- Job) {
    defer close(out)
    for {
        j, err := fetchJob(ctx)
        if err != nil {
            return
        }
        select {
        case out <- j:
        case <-ctx.Done():
            return
        }
    }
}

func consume(in <-chan Job) {
    for j := range in {
        process(j)
    }
    log.Println("consumer drained, exiting")
}
```

Cancel `ctx`. The producer exits, closes `out`. The consumer drains the buffer (possibly several values) and then sees the channel closed-and-empty, and its `range` exits. No work is dropped; no values are lost.

This is the "drain to clean shutdown" pattern. Every long-running pipeline should follow it.

### Anti-pattern: cancel the consumer mid-stream

If you cancel the consumer (force it to return) before the channel is drained, the buffered values are discarded. Whether this is acceptable depends on the workload — for "best-effort" pipelines it might be fine; for "must-not-lose-work" pipelines, do not.

---

## Back-Pressure with Buffer Sizing

Channel buffer size is a back-pressure knob. With buffer `N`:

- Producer can get up to `N` values "ahead" of the consumer without blocking.
- Once the buffer fills, the producer blocks on the next send.
- The consumer `range`s as fast as it can; the buffer smooths out bursts.

A `range`-based consumer's throughput is constrained by:

- `process(v)` cost.
- Send rate of the producer.
- Buffer size.

Rule of thumb:

- Unbuffered: tight synchronisation. Use when consumer must process immediately, no buffering desired.
- Buffer 1: "decoupling buffer." Producer can post one ahead.
- Buffer 16–256: absorb bursts. Use for general producer/consumer.
- Buffer 1000+: queue-like. Used when production is bursty and consumption is steady.

Do not just default to "buffer 1" or "buffer 100" without thinking. Match it to your throughput.

### Buffered vs unbuffered: effect on `range`

The `range` syntax is identical. The semantics differ:

- Unbuffered: each iteration of `range` is a synchronisation point. Send and receive complete together.
- Buffered: receive completes when there is a value; send completes when there is room.

For unbuffered channels, `range`'s blocking behaviour matches the producer's send behaviour exactly.

---

## Combining Range With Context

`range` cannot read a context — it only sees a channel. To make a `range` respect context, you have three options:

### Option A: Have the producer respect context

The cleanest: the producer checks `ctx.Done` on every send. When the context is cancelled, the producer returns, `defer close` runs, and the consumer's `range` exits naturally.

```go
func produce(ctx context.Context, out chan<- Job) {
    defer close(out)
    for {
        select {
        case <-ctx.Done():
            return
        case out <- next():
        }
    }
}

// Consumer is plain range, no context needed:
for j := range out {
    process(j)
}
```

### Option B: Switch consumer to `select`

```go
for {
    select {
    case j, ok := <-ch:
        if !ok {
            return
        }
        process(j)
    case <-ctx.Done():
        return
    }
}
```

Now the consumer reacts to cancellation immediately, even if the producer is slow.

### Option C: Cancellation channel that closes ch

A goroutine watches the context and closes the channel on cancel — but this risks racing with the producer's sends. Avoid unless you are sure there are no concurrent senders.

In practice, Option A is preferred. The producer is the authority on the channel's lifetime; making it context-aware keeps the rest of the design simple.

---

## Common Real-World Bugs

### Bug: pipeline stage forgets `defer close`

```go
func stage(in <-chan int, out chan<- int) {
    for v := range in {
        out <- transform(v) // forgot: defer close(out)
    }
}
```

The next stage's `range` blocks forever after `stage` exits. The pipeline hangs at end-of-stream.

### Bug: closer goroutine waits on the wrong `WaitGroup`

```go
var wg sync.WaitGroup
for _, p := range producers {
    go func(p Producer) {
        // forgot: wg.Add(1) before go, or wg.Done() inside
        p.Pump(ch)
    }(p)
}
go func() { wg.Wait(); close(ch) }() // wg is zero, closes immediately
```

`wg.Wait()` returns immediately because no `Add` was called. The channel closes before producers send anything; producers crash on send to closed channel.

### Bug: `break` in `range` without cancelling the producer

```go
for v := range ch {
    if v.Type == "stop" {
        break
    }
}
// producer keeps sending, eventually blocks on send to nobody
```

After `break`, no one reads. The producer blocks on the next send, leaking a goroutine.

### Bug: ranging a channel of pointers and mutating

```go
for p := range pointers {
    p.Field = "modified" // visible to everyone holding p
}
```

If the producer holds a reference, mutations are visible across goroutines without synchronisation. Channels do not provide ownership semantics — sending a pointer does not transfer it.

Fix: send by value, or document that ownership transfers and the sender will not touch the pointer again.

### Bug: nil channel from a conditional

```go
var ch chan int
if condition {
    ch = make(chan int)
    go produce(ch)
}
for v := range ch { // if condition is false, ch is nil — blocks forever
    use(v)
}
```

Always initialise channels before ranging, or guard the `range` with an `if`.

---

## Performance Trade-Offs

`range` on a channel is the same cost as a manual two-value receive — no overhead. The performance question is not "is `range` fast?" but "is the channel design fast?"

Key levers:

- **Buffer size.** Larger buffer = less synchronisation = more throughput, more memory.
- **Element size.** Sending large structs (no pointers) copies them. Sending pointers is cheap but introduces aliasing.
- **Number of consumers.** Worker-pool fan-out scales receive throughput with N.
- **Body work.** If `process(v)` is fast (~ns), receive cost dominates. If `process(v)` is slow (~ms), the channel is rarely the bottleneck.

Benchmark numbers (rough, modern laptop):

- Send/receive on a buffered channel: ~50–100 ns per operation.
- Receive in a `range` loop, idle body: similar.
- Send across a context-switch (consumer was sleeping): ~1–10 µs.

For high-throughput data planes (>1M ops/sec), channels can become the bottleneck. Then consider batching values, larger buffers, or non-channel structures (lock-free queues, sharded mailboxes). For 99% of real applications, plain `range` is fast enough.

---

## Patterns You Will See in Real Codebases

### "Streaming response from a service"

```go
func streamEvents(ctx context.Context, w http.ResponseWriter, events <-chan Event) {
    flusher, _ := w.(http.Flusher)
    for e := range events {
        select {
        case <-ctx.Done():
            return
        default:
        }
        fmt.Fprintf(w, "data: %s\n\n", e.JSON())
        flusher.Flush()
    }
}
```

The handler `range`s an event channel and writes each event to the wire. When the producer closes (or the request ends), the loop exits.

### "Background log writer"

```go
var logCh = make(chan string, 1024)

func writer(f io.Writer) {
    for line := range logCh {
        f.Write([]byte(line + "\n"))
    }
}

func Log(line string) {
    select {
    case logCh <- line:
    default:
        // buffer full — drop log line
    }
}
```

A single writer goroutine drains the log channel. Producers can drop on full buffer to avoid blocking. The `range` makes the writer one line.

### "Batch processor"

```go
func batcher(in <-chan Item, batchSize int, out chan<- []Item) {
    defer close(out)
    var batch []Item
    for v := range in {
        batch = append(batch, v)
        if len(batch) >= batchSize {
            out <- batch
            batch = nil
        }
    }
    if len(batch) > 0 {
        out <- batch // flush remaining
    }
}
```

Group incoming items into batches of size N. The `range` makes the grouping logic obvious. The trailing flush handles the final partial batch.

### "Fan-out worker pool"

```go
func startPool(ctx context.Context, jobs <-chan Job, n int) *sync.WaitGroup {
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range jobs {
                process(ctx, j)
            }
        }()
    }
    return &wg
}
```

N workers, all `range`ing the same channel. Caller closes `jobs` to signal shutdown; all workers exit; `wg.Wait` returns. The pool's lifetime is determined by the channel's lifetime — clean.

### "Periodic flush"

```go
func flusher(in <-chan Metric) {
    var buf []Metric
    tick := time.NewTicker(5 * time.Second)
    defer tick.Stop()
    for {
        select {
        case m, ok := <-in:
            if !ok {
                send(buf)
                return
            }
            buf = append(buf, m)
        case <-tick.C:
            if len(buf) > 0 {
                send(buf)
                buf = nil
            }
        }
    }
}
```

Note: as soon as you need a timer alongside a channel, `range` is not enough. The upgrade to `select` is automatic.

---

## Testing Range-Based Code

Two questions to ask in tests:

1. Does the `range` consumer process every value the producer sends?
2. Does the consumer exit cleanly when the producer closes?

Both are testable without elaborate setup.

```go
func TestPipelineDrainsAllValues(t *testing.T) {
    in := make(chan int, 5)
    for i := 1; i <= 5; i++ {
        in <- i
    }
    close(in)

    var got []int
    out := square(in) // stage under test
    for v := range out {
        got = append(got, v)
    }
    if !reflect.DeepEqual(got, []int{1, 4, 9, 16, 25}) {
        t.Fatalf("got %v", got)
    }
}

func TestStageExitsOnInputClose(t *testing.T) {
    in := make(chan int)
    done := make(chan struct{})

    out := square(in)
    go func() {
        for range out {
        }
        close(done)
    }()
    close(in)

    select {
    case <-done:
        // ok — stage exited
    case <-time.After(time.Second):
        t.Fatal("stage did not exit after input closed")
    }
}
```

The first test verifies behaviour; the second test verifies *termination*. Both are essential for any production pipeline. Always test that closing the input causes the output to close.

### Use a timeout in every range-based test

A range that does not exit will hang your test. Add a `time.After` watchdog or `t.Deadline`. Better: run tests with `-timeout 10s` so CI fails fast on a hang.

---

## Putting It Together

The mental model at middle level:

- `range` is the universal consumer side. Always pair with a `close` in the producer.
- Multi-producer? Use a closer goroutine. Multi-consumer? Just fan-out, no extra coordination.
- Pipeline stages are one-line `range` + `defer close` consumers/producers. They compose without effort.
- The moment you need cancellation, multiple inputs, timeouts, or non-blocking polls, switch to `select`. `range` is the simple case; `select` is the general case.
- Graceful shutdown is built into the `range` model: cancel the producer, let it close, let the consumer drain, all goroutines exit.

Senior level goes deeper: ownership rules, structured concurrency, and how this compares to Go 1.23 range-over-func.

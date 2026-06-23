# Range Over Channels — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions or solution sketches are at the end.

---

## Easy

### Task 1 — Receive 10 values with `range`

Write a program that:

1. Creates a buffered channel of capacity 10.
2. Sends `1` through `10` into it.
3. Closes the channel.
4. Uses `for v := range ch` to print every value.

**Goal.** Internalise the simplest correct shape: send, close, range.

---

### Task 2 — Producer goroutine + range in main

Write a producer goroutine that sends 5 strings into a channel, closes it, exits. The main goroutine ranges over the channel and prints. Use `defer close(ch)` in the producer.

```go
func produce(ch chan<- string) {
    defer close(ch)
    for _, s := range []string{"a", "b", "c", "d", "e"} {
        ch <- s
    }
}
```

**Goal.** Get comfortable with the producer/consumer split.

---

### Task 3 — Forget the close, observe the deadlock

Take Task 2 and *remove* the `defer close(ch)`. Run the program. Observe:

```
fatal error: all goroutines are asleep - deadlock!
```

Then add the close back. Confirm the program now exits cleanly.

**Goal.** See firsthand what happens when the producer forgets to close.

---

### Task 4 — Range over a nil channel

```go
var ch chan int
for v := range ch {
    fmt.Println(v)
}
fmt.Println("done")
```

Run it. Observe that the program either hangs forever or panics with a deadlock. Now fix it: initialise `ch` with `make(chan int)`, send and close from a goroutine.

**Goal.** Confirm that `nil` channels are silently dangerous.

---

### Task 5 — Range with `break`, observe a producer leak

Spawn a producer that sends `1..1000` into an *unbuffered* channel. In the consumer, `break` after receiving the first value. Print `runtime.NumGoroutine()` before exiting.

You will see the goroutine count is 2 (main + leaked producer), not 1.

**Goal.** See a goroutine leak caused by `break` in a `range`.

---

### Task 6 — Manual desugar

Rewrite the following `range` loop without using `range`, using only `for { v, ok := <-ch; if !ok break; ... }`:

```go
for v := range ch {
    sum += v
}
```

Confirm both versions produce identical output.

**Goal.** Internalise that `range` is sugar.

---

### Task 7 — Range over a closed empty channel

```go
ch := make(chan int)
close(ch)
count := 0
for range ch { count++ }
fmt.Println(count)
```

What does it print? Run it. Answer: `0`. The closed empty channel exits the loop immediately.

**Goal.** Edge case awareness.

---

### Task 8 — Count values in a stream

Receive an unknown number of values from a channel via `range`, count them, print the count when the channel closes.

```go
func count(ch <-chan int) int {
    n := 0
    for range ch { n++ }
    return n
}
```

Test with a producer that sends a random number of values. Confirm.

**Goal.** Use `range` without using the value.

---

### Task 9 — Sum a stream

Receive a stream of `int`, return the sum. Test with `[]int{1, 2, 3, 4, 5}` → 15.

**Goal.** Combine `range` with an accumulator.

---

### Task 10 — Print until a sentinel

A producer sends `int` values. The value `-1` means "end of stream." The consumer should print every value until it sees `-1`, then stop.

Compare two implementations:

- One with `range` + `break`.
- One with `range` and producer closing the channel after sending `-1`.

Discuss which is cleaner.

**Goal.** Realise that close is preferable to sentinel values.

---

## Medium

### Task 11 — Multiple producers, one consumer

Spawn 5 producer goroutines, each sending 10 values into a shared channel. A single consumer ranges and prints them. Coordinate close with a `sync.WaitGroup` + closer goroutine.

```go
var wg sync.WaitGroup
ch := make(chan int, 100)
for i := 0; i < 5; i++ {
    wg.Add(1)
    go func(id int) {
        defer wg.Done()
        for j := 0; j < 10; j++ {
            ch <- id*10 + j
        }
    }(i)
}
go func() { wg.Wait(); close(ch) }()

for v := range ch { fmt.Println(v) }
```

**Goal.** Pattern the closer goroutine.

---

### Task 12 — Two-stage pipeline

Build a pipeline:

1. Stage 1: produces `int` values from a slice.
2. Stage 2: squares each value.
3. Sink: sums all squares.

All stages connected by channels. Verify the sum.

```go
func gen(nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range nums { out <- n }
    }()
    return out
}

func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in { out <- v * v }
    }()
    return out
}

func main() {
    sum := 0
    for v := range square(gen(1, 2, 3, 4, 5)) {
        sum += v
    }
    fmt.Println(sum) // 55
}
```

**Goal.** Pipeline shape: produce, transform, sink.

---

### Task 13 — Three-stage pipeline with filter

Add a filter stage that drops odd numbers:

```go
func evens(in <-chan int) <-chan int { ... }
```

Pipeline: `gen → evens → square → sum`. Verify result is `2*2 + 4*4 = 20`.

**Goal.** Composability of `range`-based stages.

---

### Task 14 — Worker pool with `range`

Spawn 4 worker goroutines, all `range`ing the same jobs channel. The dispatcher sends 100 jobs and closes the channel. Each worker processes (sleeps 10ms, prints).

Use a `WaitGroup` so the main goroutine waits for all workers.

**Goal.** Worker pool: the canonical `range` fan-out.

---

### Task 15 — Bounded fan-in

Merge 3 input channels into one output channel. The output should `range` over all values from all inputs and close when all inputs close.

```go
func fanIn(srcs ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for _, s := range srcs {
        wg.Add(1)
        go func(s <-chan int) {
            defer wg.Done()
            for v := range s { out <- v }
        }(s)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

Test with 3 sources of 5 values each. Confirm the consumer sees 15 values.

**Goal.** Build a generic fan-in.

---

### Task 16 — Streaming sum with batching

A producer sends 1 million `int` values. A consumer uses `range` to sum them — but in batches of 1000 (using a local slice). Compare throughput to a non-batched version.

```go
batch := make([]int, 0, 1000)
sum := 0
for v := range ch {
    batch = append(batch, v)
    if len(batch) == 1000 {
        for _, b := range batch { sum += b }
        batch = batch[:0]
    }
}
for _, b := range batch { sum += b } // flush
```

**Goal.** See that the loop body's tightness matters more than receive count.

---

### Task 17 — Range with context cancellation via producer

A producer respects a context: when cancelled, it returns (which triggers `defer close`). The consumer is plain `range`. Test by cancelling after 100ms and asserting the consumer exits cleanly within ~110ms.

```go
func produce(ctx context.Context, out chan<- int) {
    defer close(out)
    for i := 0; ; i++ {
        select {
        case <-ctx.Done(): return
        case out <- i:
        }
    }
}
```

**Goal.** Idiomatic context-aware producer with simple `range` consumer.

---

### Task 18 — Convert a `range` to `select`

Take this `range` loop:

```go
for v := range ch {
    process(v)
}
```

Rewrite it as a `for { select }` that also listens to `ctx.Done()`. Confirm both behave the same when the channel closes normally, but the `select` version exits faster on context cancellation.

**Goal.** Practise the canonical upgrade path.

---

### Task 19 — Pipeline with errors-as-values

Each pipeline value is `struct { V int; Err error }`. The producer occasionally emits an error. The consumer ranges over the channel and logs errors, processes successes.

```go
type Result struct {
    V int
    Err error
}

for r := range results {
    if r.Err != nil {
        log.Println("err:", r.Err)
        continue
    }
    use(r.V)
}
```

**Goal.** Error handling without abandoning `range`.

---

### Task 20 — Test that `range` exits on close

Write a test that:

1. Creates a channel.
2. Spawns a consumer goroutine running `for range ch {}`, signalling completion via a `done` channel.
3. Closes `ch`.
4. Asserts the consumer signalled `done` within 100ms.

Add a `time.After` watchdog so the test fails if the consumer hangs.

**Goal.** Mandatory testing pattern for any `range`-based consumer.

---

## Hard

### Task 21 — Build a pipeline framework

Write a generic library:

```go
type Stage[A, B any] func(in <-chan A) <-chan B
```

Provide:

- `Map[A, B](fn func(A) B) Stage[A, B]`
- `Filter[A any](pred func(A) bool) Stage[A, A]`
- `Pipe[A, B, C](a Stage[A, B], b Stage[B, C]) Stage[A, C]`

Each stage uses `defer close(out)` and `range` internally. Test with a 4-stage pipeline.

**Goal.** Generic pipeline composition.

---

### Task 22 — Fan-out with order preservation

Fan out `range` consumers to N workers. Each worker processes asynchronously. The result must be re-ordered to match the input order before being delivered downstream.

Hint: tag each value with a sequence number; downstream maintains a priority queue.

**Goal.** Order-preserving parallelism.

---

### Task 23 — Graceful drain on SIGTERM

Build a small server (any handler will do) where:

- A producer goroutine `range`s incoming work and dispatches to handlers.
- On SIGTERM, the server cancels its context, the producer closes the work channel, handlers `range` to drain, then `wg.Wait` returns.
- The server exits with code 0 if drained cleanly, code 1 if a timeout fired.

**Goal.** Production-ready shutdown.

---

### Task 24 — Channel-of-channels fan-in

Implement fan-in where the *number of sources is dynamic* (sources arrive over a "channel of channels"):

```go
sources := make(chan <-chan int)
out := dynamicFanIn(sources)
```

Each new source feeds into `out`. When `sources` closes and all source channels close, `out` closes.

**Goal.** Higher-order channel patterns.

---

### Task 25 — Replay buffer

Build a "tail-of-stream" buffer: a `range`-based consumer that keeps the last N values and exposes them via a method. The producer streams normally; the consumer keeps the rolling buffer.

```go
type Tail struct {
    last [100]Item
    pos  int
}

func (t *Tail) Run(in <-chan Item) {
    for v := range in {
        t.last[t.pos] = v
        t.pos = (t.pos + 1) % len(t.last)
    }
}
```

Make it thread-safe for readers calling `Snapshot()` concurrently.

**Goal.** Combine `range` with a side data structure.

---

### Task 26 — Batched flush pipeline

A producer sends events at variable rate. A consumer batches them: when 100 events have accumulated *or* 1 second has passed, flush the batch to a downstream channel. (You will need `select` plus a `time.Ticker`.)

```go
func batcher(in <-chan Event) <-chan []Event {
    out := make(chan []Event)
    go func() {
        defer close(out)
        var batch []Event
        tick := time.NewTicker(time.Second)
        defer tick.Stop()
        for {
            select {
            case e, ok := <-in:
                if !ok {
                    if len(batch) > 0 { out <- batch }
                    return
                }
                batch = append(batch, e)
                if len(batch) >= 100 {
                    out <- batch; batch = nil
                }
            case <-tick.C:
                if len(batch) > 0 {
                    out <- batch; batch = nil
                }
            }
        }
    }()
    return out
}
```

**Goal.** See where `range` gives way to `select`.

---

### Task 27 — Convert channel range to Go 1.23 iterator

Wrap an existing channel-based API in a Go 1.23 `iter.Seq` adapter:

```go
func ChanSeq[T any](ctx context.Context, ch <-chan T) iter.Seq[T] {
    return func(yield func(T) bool) {
        for {
            select {
            case <-ctx.Done(): return
            case v, ok := <-ch:
                if !ok { return }
                if !yield(v) { return }
            }
        }
    }
}
```

Test that early `break` in the iterator consumer works (the iterator returns cleanly). Note: the upstream producer must still respect `ctx` to avoid leaking.

**Goal.** Bridge channel-based and iterator-based APIs.

---

### Task 28 — Range with telemetry middleware

Wrap a `range`-based stage with a generic middleware that:

- Counts inbound values.
- Times each iteration body.
- Logs the close event with total counts.
- Optionally panics-and-recovers.

```go
func Instrument[T any](in <-chan T, name string) <-chan T {
    out := make(chan T)
    var count int64
    go func() {
        defer close(out)
        defer log.Printf("%s exited, processed %d items", name, count)
        for v := range in {
            atomic.AddInt64(&count, 1)
            out <- v
        }
    }()
    return out
}
```

Apply to every stage of a pipeline.

**Goal.** Production observability on every `range`.

---

### Task 29 — Pipeline benchmark suite

Build a benchmark that measures:

- Throughput of a 1-stage `range` (consumer only).
- Throughput of a 3-stage pipeline.
- Throughput when batching values into slices.
- Throughput with N consumers fan-out.

Plot the results. Identify the inflection points where adding stages or workers stops helping.

**Goal.** Empirical performance intuition.

---

### Task 30 — Implement deadlock detection in tests

Write a test helper:

```go
func MustExit(t *testing.T, fn func(done chan<- struct{}), timeout time.Duration) {
    done := make(chan struct{})
    go fn(done)
    select {
    case <-done:
    case <-time.After(timeout):
        t.Fatal("goroutine did not exit")
    }
}
```

Use it on every `range`-based test. Any test where the consumer hangs after the channel is closed must fail loudly.

**Goal.** CI-level safety net against `range` leaks.

---

## Solution Sketches

### Task 1 — Trivial

```go
ch := make(chan int, 10)
for i := 1; i <= 10; i++ { ch <- i }
close(ch)
for v := range ch { fmt.Println(v) }
```

---

### Task 2 — Producer pattern

Already shown above. Note `defer close(ch)`.

---

### Task 5 — Demonstrate the leak

After `break`, sleep for a moment, then `runtime.NumGoroutine()` returns 2.

```go
go func() {
    for i := 0; i < 1000; i++ {
        ch <- i // blocks after consumer breaks
    }
}()
for v := range ch {
    _ = v
    break
}
time.Sleep(10 * time.Millisecond)
fmt.Println(runtime.NumGoroutine()) // 2
```

---

### Task 11 — Closer goroutine

```go
go func() { wg.Wait(); close(ch) }()
```

This is the universal pattern for multi-producer.

---

### Task 14 — Worker pool

```go
const N = 4
jobs := make(chan int, 100)
var wg sync.WaitGroup
for i := 0; i < N; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for j := range jobs {
            time.Sleep(10 * time.Millisecond)
            fmt.Println("processed", j)
        }
    }()
}
for j := 0; j < 100; j++ { jobs <- j }
close(jobs)
wg.Wait()
```

---

### Task 17 — Context-aware producer

```go
ctx, cancel := context.WithCancel(context.Background())
ch := make(chan int)
go produce(ctx, ch)
go func() { time.Sleep(100 * time.Millisecond); cancel() }()
for v := range ch { _ = v }
// Range exits shortly after cancel; producer closed ch.
```

---

### Task 21 — Generic stage library

```go
func Map[A, B any](fn func(A) B) Stage[A, B] {
    return func(in <-chan A) <-chan B {
        out := make(chan B)
        go func() {
            defer close(out)
            for a := range in { out <- fn(a) }
        }()
        return out
    }
}

func Pipe[A, B, C any](a Stage[A, B], b Stage[B, C]) Stage[A, C] {
    return func(in <-chan A) <-chan C {
        return b(a(in))
    }
}
```

Each composition is one line. The framework relies on the `range`+`defer close` pattern at each stage.

---

### Task 22 — Order-preserving parallelism

Tag each value with a sequence number, fan out to N workers, fan in to a priority-queue-based sorter that releases values in input order. This is essentially how `golang.org/x/sync/errgroup` is sometimes extended.

---

### Task 23 — SIGTERM drain

```go
ctx, cancel := signal.NotifyContext(ctx, syscall.SIGTERM)
defer cancel()
g, ctx := errgroup.WithContext(ctx)
work := make(chan Item, 100)
g.Go(func() error { defer close(work); return ingest(ctx, work) })
g.Go(func() error { for w := range work { handle(w) }; return nil })
return g.Wait()
```

---

### Task 26 — Batcher

Already shown above. Note this is a `select` not a `range`, because of the periodic tick. The pure `range` shape breaks down once you need a timer.

---

### Task 30 — Test helper

```go
func MustExit(t *testing.T, fn func(done chan<- struct{}), timeout time.Duration) {
    done := make(chan struct{})
    go fn(done)
    select {
    case <-done:
    case <-time.After(timeout):
        t.Fatal("did not exit in time")
    }
}

// Usage:
MustExit(t, func(done chan<- struct{}) {
    for range ch { /* drain */ }
    done <- struct{}{}
}, time.Second)
```

---

## Wrap-up

After these exercises you should be able to:

- Write the producer/consumer pattern from memory.
- Diagnose the most common leaks (no close, range-then-break, nil channel).
- Build a 3+ stage pipeline with `range` at each stage.
- Add context-awareness via the producer.
- Recognise when to upgrade `range` to `select`.
- Wrap channel-range APIs in Go 1.23 iterator adapters.
- Test that `range`-based consumers exit when the channel closes.

Next: [find-bug.md](find-bug.md) for bug-finding exercises focused on `range` traps.

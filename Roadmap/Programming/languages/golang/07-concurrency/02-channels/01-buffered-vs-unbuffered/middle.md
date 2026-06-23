# Buffered vs Unbuffered Channels — Middle Level

## Table of Contents
1. [Recap](#recap)
2. [When to Choose Which — A Decision Framework](#when-to-choose-which-a-decision-framework)
3. [Channel Direction in API Design](#channel-direction-in-api-design)
4. [Real-World Patterns](#real-world-patterns)
5. [Closing Strategies](#closing-strategies)
6. [Detecting Closed Channels](#detecting-closed-channels)
7. [Capacity-Tuning Antipatterns](#capacity-tuning-antipatterns)
8. [Backpressure in Practice](#backpressure-in-practice)
9. [Lifecycle and Ownership](#lifecycle-and-ownership)
10. [Combining Channels with `sync.WaitGroup`](#combining-channels-with-syncwaitgroup)
11. [Buffered Channel Pitfalls](#buffered-channel-pitfalls)
12. [Diagnosing Deadlocks](#diagnosing-deadlocks)
13. [Production Examples](#production-examples)
14. [Summary](#summary)
15. [Self-Assessment](#self-assessment)

---

## Recap

By now you can:

- Make, send to, receive from, range over, and close a channel.
- State the blocking rules without consulting the table.
- Read a `fatal error: all goroutines are asleep - deadlock!` panic and identify at least one offending operation.

This level adds the *judgement* that turns "I can use channels" into "I know which channel to reach for and why."

---

## When to Choose Which — A Decision Framework

Ask yourself, in this order:

1. **Do I need a synchronous handshake?** "When my send returns, the other side must already have the value."
   - **Yes** → unbuffered.
   - **No** → continue.

2. **Am I doing a one-shot signal (`done`, `started`, `cancel`)?**
   - **Yes** → unbuffered `chan struct{}`, conventionally closed rather than sent.
   - **No** → continue.

3. **Do I have a known burst size that the consumer can drain on average?**
   - **Yes**, burst is N → buffered, capacity ≈ N. Document the choice.
   - **No, the producer is much faster than the consumer** → you have a *design* problem, not a buffering problem. Add a real queue (Redis, a message bus) or rate-limit the producer.

4. **Am I using the channel as a semaphore?**
   - **Yes** → buffered `chan struct{}`, capacity = max concurrency.

5. **None of the above?** Default to unbuffered. You will discover via deadlock if you needed something else.

### The Capacity = 1 special case

A channel of capacity 1 deserves its own row in your mental table:

```go
ch := make(chan T, 1)
```

It allows exactly one "in-flight" value. The producer can hand off and continue while the consumer drains. This is widely useful for:

- Result channels where exactly one value will ever flow.
- Time-decoupled signalling (sender does not have to wait for receiver to be live).
- "Once" patterns where a duplicate send would be a bug — you can `select` on send with a default to detect it.

It is the lowest non-zero capacity, and it is often a much better answer than capacity 100.

---

## Channel Direction in API Design

When channels appear in function signatures, *always* annotate direction.

```go
// produce only sends.
func produce(out chan<- int)

// consume only receives.
func consume(in <-chan int)

// pipeline stage: receives upstream, sends downstream.
func square(in <-chan int, out chan<- int)
```

The compiler refuses any operation against the type's direction:

```go
func consume(in <-chan int) {
    in <- 5 // compile error: invalid operation: cannot send to receive-only channel
}
```

Rules of thumb:

- A function parameter should be either `chan<- T` or `<-chan T`. Bidirectional `chan T` in a parameter list is almost always a smell.
- A return value, in contrast, is usually bidirectional — the caller decides what to do with it.
- When you receive a bidirectional channel and want to pass a one-way view to a helper, *just pass it*. Go converts implicitly.

```go
func main() {
    ch := make(chan int)
    go produce(ch) // ch is automatically restricted to chan<- int
    consume(ch)
}
```

There is no need for `(chan<- int)(ch)` casts.

---

## Real-World Patterns

### Pattern: producer/consumer with buffered queue

```go
type Job struct {
    ID   int
    Data []byte
}

func runPipeline(jobs []Job) {
    in := make(chan Job, 8) // burst buffer
    done := make(chan struct{})

    // Single consumer
    go func() {
        defer close(done)
        for j := range in {
            process(j)
        }
    }()

    // Single producer
    for _, j := range jobs {
        in <- j
    }
    close(in)

    <-done
}
```

Why capacity 8? Because measurement showed bursts of about 8 incoming jobs per scheduler quantum, and the consumer drains them at a steady rate. Naming a number like 8 with that justification is what separates "engineer" from "person who picked 100 because it felt safe."

### Pattern: signal-then-data

```go
ready := make(chan struct{})
data := make(chan int, 1)

go func() {
    // expensive setup ...
    close(ready)             // signal: I'm initialised
    data <- compute()        // payload: the actual answer
}()

<-ready
fmt.Println("worker is up")
fmt.Println(<-data)
```

Two channels: one carries an event, one carries a value. Each does one job clearly.

### Pattern: fan-in

```go
func fanIn(a, b <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        for v := range a { out <- v }
    }()
    go func() {
        for v := range b { out <- v }
    }()
    return out
}
```

Two producers, one consumer. The merged channel is unbuffered because the receiver controls the pace. (We will rebuild this with `select` in the next chapter so the goroutines exit cleanly when one side closes.)

### Pattern: fan-out

```go
func fanOut(in <-chan Job, n int, work func(Job)) {
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range in {
                work(j)
            }
        }()
    }
    wg.Wait()
}
```

One producer, N consumers. Each `range` reads from the same channel; the runtime delivers each value to exactly one consumer. The `sync.WaitGroup` is what tells us all consumers finished.

### Pattern: bounded concurrency with a token channel

```go
sem := make(chan struct{}, 5) // at most 5 concurrent fetches
var wg sync.WaitGroup

for _, url := range urls {
    wg.Add(1)
    sem <- struct{}{} // acquire
    go func(u string) {
        defer wg.Done()
        defer func() { <-sem }() // release
        fetch(u)
    }(url)
}
wg.Wait()
```

The buffered channel acts as the throttle. No condition variables, no mutex, no atomic counter — just a queue of `cap(sem)` tokens.

---

## Closing Strategies

Closing is the operation most likely to cause a panic in a Go program written by someone who otherwise knows what they are doing. There are three patterns that work in production:

### Strategy 1: single-producer closes the channel

```go
func produce(out chan<- int, n int) {
    defer close(out)
    for i := 0; i < n; i++ {
        out <- i
    }
}
```

Simple, correct, idiomatic.

### Strategy 2: multiple producers + a coordinator

If two or more goroutines write to a channel, none of them should close it — closing twice panics. Use a coordinator:

```go
var wg sync.WaitGroup
out := make(chan int, 16)

for i := 0; i < 3; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for _, v := range somePartition(i) {
            out <- v
        }
    }()
}

go func() {
    wg.Wait()
    close(out) // closes only after every producer is done
}()

for v := range out {
    consume(v)
}
```

The coordinator's only job is to wait for all producers to drop out, then close.

### Strategy 3: never close, let GC clean up

If the channel will be garbage-collected when all goroutines stop referencing it, you do not strictly need to close. But:

- `range` over an unclosed channel never terminates.
- Without a close, receivers cannot detect "no more values."

So this is rare in practice; usually you want closing semantics for the receive loop. The exception is short-lived "fire one value" channels:

```go
func get() int {
    ch := make(chan int, 1)
    go func() { ch <- compute() }()
    return <-ch
}
```

No close — the channel is GC'd when the function returns.

---

## Detecting Closed Channels

Two idioms:

### The comma-ok idiom

```go
v, ok := <-ch
if !ok {
    // closed and drained
}
```

Use when you need to act on the closed event explicitly.

### `range` until close

```go
for v := range ch {
    use(v)
}
// loop exits when ch is closed and drained
```

Use when you want the receiver to drain naturally and proceed.

A subtle but important rule: a closed channel does *not* panic on receive. It returns the zero value. That is why `range` can detect "done" cleanly: the runtime knows the channel is drained.

---

## Capacity-Tuning Antipatterns

The capacity of a buffered channel is a *real number with real semantics*. Treat it that way.

### Antipattern: "I'll bump it to 1000 to be safe"

```go
make(chan Job, 1000)
```

You have not made the program more robust. You have given an attacker (or an unbalanced workload) a bigger amount of latency to accumulate before the inevitable backpressure shows up. When the buffer eventually saturates, the producer suddenly blocks — possibly inside an HTTP handler, possibly inside a Lambda — and your system goes from "fine" to "queues full" with no graceful middle.

### Antipattern: "Capacity = number of CPUs"

```go
make(chan Job, runtime.NumCPU())
```

Capacity is not a unit of parallelism. Capacity is the number of values that can sit *idle* in the queue. Worker count and queue depth are two independent dimensions.

### Antipattern: "Capacity to mask deadlocks"

```go
// Deadlocks at cap=0:
ch := make(chan int)
ch <- 1
ch <- 2 // hang
```

"Just" raise the cap to 2:

```go
ch := make(chan int, 2)
ch <- 1
ch <- 2 // ok
```

You have not fixed anything. The next bug — three sends — is one line away, and the program will be "fine" on a small input and explode on a large one.

### When raising the buffer *is* okay

- You measured the burst.
- You picked a capacity that is "burst + small headroom."
- You documented the rationale.
- You handle the "buffer full" case with `select`/`default` if it ever happens.

---

## Backpressure in Practice

Backpressure is the property that a slow consumer slows down the producer. It is good — without it, queues grow unbounded and memory dies.

A buffered channel implements backpressure with a hard cliff at `cap`. Below the cap, no backpressure. At the cap, infinite backpressure (the producer blocks until the consumer drains).

For a smoother curve you can add a `select` with `default`:

```go
select {
case ch <- v:
    // normal path: enqueued
default:
    // overflow: drop, log, retry, etc.
}
```

We will explore this in the next chapter, but it is worth knowing now: pure channels give a binary "block or proceed" backpressure. You shape that into a richer policy by composing with `select` and `time.After`.

---

## Lifecycle and Ownership

Every channel has, in principle, an *owner* — the goroutine responsible for `make`-ing it, sending to it, and closing it. The convention is:

- The function that creates the channel returns it (often as a receive-only `<-chan T`).
- The function that produces values is the only one that closes it.
- All consumers are read-only.

This is the **producer-owner model**. It naturally falls out of pipelines:

```go
func source() <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < 10; i++ {
            out <- i
        }
    }()
    return out
}
```

Caller cannot accidentally close it (the type is `<-chan int`, close is illegal on a receive-only channel). The closure inside owns it for life. Clean.

---

## Combining Channels with `sync.WaitGroup`

The two are complementary. Channels move *values*; `WaitGroup` waits for *goroutines* to finish.

```go
func runJobs(jobs []Job) {
    var wg sync.WaitGroup
    results := make(chan Result, len(jobs))

    for _, j := range jobs {
        wg.Add(1)
        go func(j Job) {
            defer wg.Done()
            results <- process(j)
        }(j)
    }

    go func() {
        wg.Wait()
        close(results)
    }()

    for r := range results {
        save(r)
    }
}
```

Notice how the close-coordinator goroutine (`wg.Wait(); close(results)`) is the bridge between "all goroutines finished" and "channel will stop yielding." This is the canonical multi-producer close pattern.

---

## Buffered Channel Pitfalls

### Pitfall: hidden async assumption

```go
func sendMetric(m Metric) {
    metricsCh <- m
}

// elsewhere
sendMetric(m)
log.Printf("metric sent")
```

If `metricsCh` is unbuffered, the log line really does happen after a metric was *received*. If `metricsCh` is buffered, the log line happens after a metric was *queued*. The distinction is invisible to the reader. If something downstream asserts "every logged metric got persisted," your tests pass on unbuffered and fail on buffered. Be explicit in code reviews about which one you mean.

### Pitfall: leaked receiver

```go
func incoming() {
    ch := make(chan int)
    go func() {
        v := <-ch
        log.Println(v)
    }()
    // function returns, no one writes to ch
}
```

The goroutine blocks on receive forever. The channel never gets GC'd because the goroutine still holds a reference. A leaked goroutine plus a leaked channel plus any captured state. Pattern: every goroutine should have an exit condition that you can name.

### Pitfall: panic on send-after-close

```go
func produce(out chan<- int, stop <-chan struct{}) {
    for i := 0; i < 100; i++ {
        select {
        case <-stop:
            return       // (a) producer leaves
        case out <- i:
        }
    }
    close(out)           // (b) producer closes
}
```

If two goroutines run this same function on the same `out` channel, the first one to reach `(b)` closes; the second one then either re-enters and finds out closed → its next send panics, or itself reaches `(b)` and double-closes → panic. Either way, panic.

Fix: only one producer or a coordinator pattern.

### Pitfall: range over a slow producer

```go
ch := make(chan int)
go func() {
    for i := 0; i < 100; i++ {
        ch <- i
        time.Sleep(time.Second)
    }
    close(ch)
}()

for v := range ch {
    if shouldStop(v) {
        break // BUG: leaks the producer
    }
    process(v)
}
```

When the receiver `break`s, the producer's next send blocks forever. Fix: combine with a `done` channel, which we cover next chapter.

---

## Diagnosing Deadlocks

The runtime's deadlock detector fires only when *every* goroutine is asleep. So:

- **All-goroutines deadlock** → the message "all goroutines are asleep". Find a channel op with no partner.
- **Partial deadlock** → no panic; the program just hangs or one subsystem stalls. Use `kill -SIGQUIT <pid>` to dump all goroutine stacks (or `pprof`'s goroutine profile, or `runtime.Stack`).

When you read the dump, every parked goroutine has a stack frame ending in `chan send` or `chan receive`. Each of those is a clue: who was supposed to be on the other side?

A useful debugging trick:

```go
go func() {
    time.Sleep(5 * time.Second)
    panic("dump")
}()
```

A panic dumps every goroutine's stack. If your program "should be done by now," the panic shows you what is still waiting and on what.

---

## Production Examples

### Example: pipeline stage with backpressure

```go
func transform(in <-chan Record, out chan<- Record) {
    for r := range in {
        r2 := mutate(r)
        out <- r2 // blocks naturally if downstream is slow
    }
    close(out)
}
```

Each pipeline stage is a goroutine, each connection is a channel. The capacity of those channels controls how much work can pile up between stages.

### Example: graceful shutdown

```go
type Server struct {
    jobs chan Job
    quit chan struct{}
    wg   sync.WaitGroup
}

func (s *Server) Run() {
    s.wg.Add(1)
    go func() {
        defer s.wg.Done()
        for {
            select {
            case j := <-s.jobs:
                s.handle(j)
            case <-s.quit:
                return
            }
        }
    }()
}

func (s *Server) Shutdown() {
    close(s.quit) // tell every worker to exit
    s.wg.Wait()   // wait for them
}
```

Two channels: one for work, one for "stop." Closing `quit` is the broadcast mechanism; every receiver wakes up.

### Example: result aggregation

```go
results := make(chan Result, len(workers))
for _, w := range workers {
    w := w
    go func() {
        results <- w.Run()
    }()
}

var all []Result
for i := 0; i < len(workers); i++ {
    all = append(all, <-results)
}
```

The buffered channel is sized exactly to the worker count, so producers never block. The receiver loops a known number of times — no `range`, no `close` needed.

---

## Summary

At the middle level, the question is not "buffered or unbuffered?" but "what semantics am I trying to express, and which choice expresses them most cleanly?" Default to unbuffered for synchronisation, capacity 1 for one-shot decoupling, and capacity ≈ measured-burst for production pipelines. Treat capacity as a documented number, not a knob to mute deadlocks. Name an owner for every channel: someone makes it, someone closes it, and one of those someones is usually the same goroutine. Use `WaitGroup` to coordinate goroutine completion, and use the close-coordinator pattern when multiple producers share an output channel.

---

## Self-Assessment

- [ ] I have a one-sentence rationale for every `make(chan T, N)` in my code.
- [ ] My function signatures use directional channel types where possible.
- [ ] I have refactored at least one piece of code from "two-cap-buffer to mask a deadlock" to "actually fix the producer/consumer balance."
- [ ] I have written a multi-producer pattern with a coordinator that closes the channel.
- [ ] I have used `WaitGroup` together with channels in the same goroutine setup.
- [ ] I can read a goroutine dump and identify channel ops that have no partner.
- [ ] I prefer `<-chan T` and `chan<- T` in function parameters and have removed plain `chan T` parameters where I used to have them.

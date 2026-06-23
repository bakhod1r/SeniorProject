# CSP Model — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The CSP Algebra in One Page](#the-csp-algebra-in-one-page)
3. [Mapping CSP Operators to Go](#mapping-csp-operators-to-go)
4. [Synchronous vs Asynchronous Channels](#synchronous-vs-asynchronous-channels)
5. [Ownership Transfer in Depth](#ownership-transfer-in-depth)
6. [Pipelines, Fan-Out, Fan-In Revisited](#pipelines-fan-out-fan-in-revisited)
7. [Cancellation and the Done Pattern](#cancellation-and-the-done-pattern)
8. [Composition of CSP Processes](#composition-of-csp-processes)
9. [When CSP Is the Wrong Choice](#when-csp-is-the-wrong-choice)
10. [Comparison with Actors](#comparison-with-actors)
11. [Common CSP-Style Patterns Catalog](#common-csp-style-patterns-catalog)
12. [Testing CSP-Style Code](#testing-csp-style-code)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## Introduction

At junior level you wrote your first channel-based programs and learned the "share memory by communicating" slogan. At middle level we treat CSP as a *design discipline*: how to decompose a problem into communicating sequential processes, which channels carry which data, what synchronisation is implied, and when to deviate from the discipline.

We also briefly visit the formal side — the algebra of process composition that the Go runtime quietly mirrors. You do not need to learn the math, but seeing the structure clarifies why some channel patterns feel "right" and others are awkward.

After reading this you will:

- Recognise CSP operators in Go syntax: sequential, parallel, choice, hide.
- Understand when synchronous channels enforce desirable lockstep and when buffers help.
- Be fluent with the "done" pattern, then graduate to `context.Context`.
- Compose pipelines, fan-out, fan-in into larger systems.
- Diagnose CSP-style deadlocks.
- Contrast CSP with the actor model and pick the right one per problem.

---

## The CSP Algebra in One Page

Hoare's CSP defines a small set of operators on processes. Each Go construct maps to one (loosely):

| CSP operator | Symbol | Meaning | Go construct |
|---|---|---|---|
| Stop | `STOP` | Process that does nothing | `select {}` or a goroutine that returns immediately |
| Skip | `SKIP` | Successful termination | Goroutine's normal return |
| Prefix | `a -> P` | First do event `a`, then behave as `P` | Sequential code in a goroutine |
| Sequential | `P ; Q` | Do `P`; when done, do `Q` | Function call after function call |
| Parallel | `P \|\| Q` | Run `P` and `Q` concurrently | Two `go` statements |
| External choice | `P □ Q` | Choose between `P` and `Q` based on external event | `select` with multiple cases |
| Internal choice | `P ⊓ Q` | Choose nondeterministically | (Go does not directly express this; `select` is closer to external choice) |
| Communication | `c!v -> P` (send), `c?x -> P` (receive) | Send `v` on channel `c`, then `P` | `c <- v`, `x := <-c` |
| Hiding | `P \ A` | Hide events in set `A` | Wrap a goroutine in a function that does not expose its internal channels |
| Recursion | `P = ... -> P` | Process that loops | `for { ... }` |

Go does not enforce these as a formal algebra. But seeing your code through this lens helps. A `select` is an external choice. A `go` is parallel composition. Two `<-ch` in a row is sequential composition.

---

## Mapping CSP Operators to Go

### Parallel composition

```
P || Q
```

Two processes running concurrently. In Go:

```go
go P()
go Q()
```

Or via `errgroup`:

```go
g := new(errgroup.Group)
g.Go(P)
g.Go(Q)
g.Wait()
```

`P || Q` includes the convention that both run "to completion" before the parent moves on. The Go `WaitGroup` / `errgroup` patterns enforce this.

### Sequential composition

```
P ; Q
```

`P` finishes, then `Q` runs. In Go this is just normal code:

```go
P()
Q()
```

Or inside a single goroutine, statements run sequentially by definition.

### External choice

```
P □ Q
```

Choose `P` or `Q` based on which event becomes available first. In Go:

```go
select {
case x := <-pCh:
    P(x)
case y := <-qCh:
    Q(y)
}
```

The runtime picks whichever channel becomes ready. If both are ready simultaneously, it picks randomly (uniformly).

### Communication

```
c!v -> P    means: send v on c, then P
c?x -> P    means: receive into x, then P
```

In Go:

```go
c <- v  // c!v
x := <-c  // c?x
```

Surrounding code continues sequentially after the communication.

### Recursion / process loops

```
P = a -> P  means: do a, then become P again
```

In Go:

```go
go func() {
    for {
        a := <-input
        process(a)
    }
}()
```

Most CSP processes are recursive (they loop indefinitely until told to stop).

### Hiding

```
P \ {a, b}  means: P runs, but events a and b are private to P
```

In Go this is the natural consequence of encapsulating channels inside a struct or function:

```go
type Worker struct {
    in  chan Job   // public
    out chan Result // public
    tmp chan tmpItem // private — hidden inside the worker
}
```

The CSP "external interface" is the channels the outside world can see; everything else is hidden.

---

## Synchronous vs Asynchronous Channels

Pure CSP has only synchronous channels. The send and the receive rendezvous; both processes are paused at the moment of transfer.

Go has both. The choice between them is a design decision with consequences.

### Unbuffered (synchronous) channel

```go
ch := make(chan int)
```

A send blocks until a receiver is ready; a receive blocks until a sender. The two goroutines synchronise.

**Use when:**
- You want explicit ownership transfer (sender knows the value has been received).
- You want lockstep coordination between two processes.
- You want a back-pressure signal that the sender cannot ignore.
- You want the simplest, most CSP-pure behaviour.

**Avoid when:**
- The producer and consumer run at different rates and benefit from buffering.
- You need fire-and-forget semantics.

### Buffered (asynchronous) channel

```go
ch := make(chan int, n)
```

Send fills a buffer slot and returns. Receive empties a slot. When full, send blocks; when empty, receive blocks.

**Use when:**
- You want to absorb bursts where the producer is temporarily faster than the consumer.
- You want the producer to continue while the consumer processes the previous item.
- You need fire-and-forget with bounded memory.
- You want to mitigate latency variance.

**Buffer-size choices:**
- 0 (unbuffered): synchronous handoff.
- 1: minimal decoupling; sender can deposit one value and continue.
- N (small): batch absorbing burst.
- Very large: usually a code smell — you are using the channel as an unbounded queue.

### When you should not buffer

If you cannot articulate the burst size, do not buffer "just in case." Unbounded buffers absorb load until they OOM. Buffers should match the actual concurrency pattern.

---

## Ownership Transfer in Depth

A pointer or slice sent on a channel is a transfer of ownership in CSP discipline. After the send, the sender should not touch the value; after the receive, the receiver owns it.

```go
type Order struct {
    Items []string
}

orders := make(chan *Order)

go func() {
    o := &Order{Items: []string{"a", "b"}}
    orders <- o
    // After this, do not touch o anymore.
}()

go func() {
    o := <-orders
    o.Items = append(o.Items, "c") // safe — receiver owns o
}()
```

The compiler does not enforce this. The race detector catches some violations (concurrent reads + writes). The discipline is yours.

### Why ownership transfer matters

When ownership is clear:
- No locks needed; only one goroutine touches the data at any time.
- Data lifetime is local to the owning goroutine.
- The data can be mutated freely by its owner without synchronisation.

When ownership is muddy:
- Races appear. The sender forgets and tweaks the value after sending.
- Locks creep in; the CSP advantage evaporates.

### Immutable values bypass ownership

For primitive types (`int`, `string`, `bool`), and for immutable structs, "ownership" does not really matter — they are copied on send. The discipline applies to reference types: slices, maps, pointers, channels.

### Concurrent reads of immutable data

A struct that is set up before launching goroutines and never modified afterwards can be safely read by all of them. No ownership transfer needed; no synchronisation needed (the goroutine launch establishes happens-before).

---

## Pipelines, Fan-Out, Fan-In Revisited

### Pipeline shape

```
Source -> Stage1 -> Stage2 -> ... -> Sink
```

Each stage is a goroutine reading from its input channel and writing to its output channel. The shape is a linear graph.

Implementation guidelines:

- Each stage closes its output channel when done.
- The source is responsible for starting; the sink for waiting.
- Backpressure flows backwards: a slow sink fills its input channel; the upstream stage blocks on send; upstream of that blocks too. The pipeline self-regulates.

### Fan-out

One source, many parallel workers, each reading from the same channel:

```
Source -> [worker1, worker2, ..., workerN]
```

Implementation:

```go
in := make(chan Job)
var wg sync.WaitGroup
for i := 0; i < N; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for j := range in {
            process(j)
        }
    }()
}
```

Each job goes to exactly one worker — the runtime picks who. This is the worker pool.

### Fan-in

Many sources, one consumer:

```
[source1, source2, ..., sourceN] -> Sink
```

Implementation:

```go
func merge(channels ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for _, ch := range channels {
        wg.Add(1)
        ch := ch
        go func() {
            defer wg.Done()
            for v := range ch {
                out <- v
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

A goroutine per source channel reads and forwards to `out`. A coordinator goroutine waits for all sources to close, then closes `out`.

### Combined: fan-out then fan-in

A common pattern:

```
Source -> [worker1, worker2, ..., workerN] -> Sink
```

Workers read from the same input channel (fan-out) and write to a shared output channel (fan-in). The output channel is closed by a coordinator goroutine after all workers finish.

```go
func workerPool(in <-chan Job, workers int) <-chan Result {
    out := make(chan Result)
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range in {
                out <- process(j)
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

This is the canonical structure of a Go service that processes a stream of work in parallel.

---

## Cancellation and the Done Pattern

A long-running goroutine needs a way to stop. In CSP terms, cancellation is just another channel event — a `done` channel:

```go
func worker(in <-chan Job, done <-chan struct{}) {
    for {
        select {
        case j, ok := <-in:
            if !ok { return }
            process(j)
        case <-done:
            return
        }
    }
}
```

Closing `done` from outside terminates the worker. Closing it broadcasts to all goroutines reading from it.

### `context.Context` as a richer done channel

The `context.Context` type, added in Go 1.7, wraps the done-channel pattern with additional features:

- Cancellation deadlines.
- Value attachment (request-scoped data).
- Composable hierarchies (child contexts inherit cancellation).

Idiomatic Go uses `context.Context` everywhere, but underneath it is just a done channel:

```go
func worker(ctx context.Context, in <-chan Job) {
    for {
        select {
        case j, ok := <-in:
            if !ok { return }
            process(ctx, j)
        case <-ctx.Done():
            return
        }
    }
}
```

`<-ctx.Done()` is equivalent to receiving on a `chan struct{}` that is closed when the context is cancelled.

### Context as the first parameter

By convention, `ctx context.Context` is the first parameter of any function that may take time or spawn goroutines. This consistency means cancellation flows through the entire call graph automatically.

---

## Composition of CSP Processes

Big systems are built from small processes. The composition operators:

### Parallel composition

```go
go P()
go Q()
go R()
```

Three processes running concurrently. They communicate via channels.

### Sequential composition

```go
result := stage1()
result = stage2(result)
result = stage3(result)
```

Three pieces of code run in order.

### Choice composition

```go
select {
case v := <-a: handleA(v)
case v := <-b: handleB(v)
}
```

Whichever fires first.

### Composition by wiring

```go
func pipeline(in <-chan In) <-chan Out {
    s1 := stage1(in)
    s2 := stage2(s1)
    return stage3(s2)
}
```

Each stage takes a channel in, returns a channel out. Composition is function composition.

### Refinement (informally)

Two processes are "equivalent" in CSP if they exhibit the same observable behaviour — same channel events, same termination. In Go, refinement appears as "this implementation can be swapped for that one without callers noticing." The interface is the set of channels; the implementation is the goroutine's internal logic.

---

## When CSP Is the Wrong Choice

CSP is a style; like all styles it has weaknesses.

### Single shared variable

A counter incremented from many goroutines is best served by a mutex or atomic. Channelling each increment as a message is slow and ceremonious.

```go
// Bad: CSP overkill
inc := make(chan int)
go func() {
    var n int
    for d := range inc {
        n += d
    }
}()

// Good: atomic
var n int64
atomic.AddInt64(&n, 1)
```

### Read-heavy structures

A cache with 1000:1 read-to-write ratio is best with `sync.RWMutex` or `sync.Map`. Channelling reads through a single owner serialises them.

### Inherent serial state machines

A state machine where transitions depend on history (sessions, authentication state) often does not parallelise. One goroutine handling all events is fine; channels are unnecessary.

### Performance-critical hot loops

Channel operations have overhead (a few hundred nanoseconds). In a hot loop processing millions of items per second, the channel overhead dominates. Use shared buffers, atomics, or batching.

### Many-to-many broadcast

CSP channels are point-to-point. Broadcasting a message to N subscribers requires N channels or a broker. The actor model (Erlang's pub-sub) handles this more naturally.

### Cross-process communication

CSP within a single process is easy. Across processes (network), CSP requires marshalling, routing, fault tolerance — the actor model and message-passing middleware (NATS, Kafka, gRPC streams) win.

---

## Comparison with Actors

| Aspect | CSP (Go) | Actor (Erlang) |
|---|---|---|
| Communication | Anonymous channels | Named mailboxes per actor |
| Addressing | Send to channel; whoever reads gets it | Send to actor; only that actor gets it |
| Mailboxes | None; channels are the queue | Each actor has its own mailbox |
| Failure | Goroutine panic crashes the program (unless recovered) | Actor crash is a normal event; supervisor restarts it |
| Hot reload | Not built-in | Erlang/OTP supports it |
| Distribution | In-process only | Built for distributed systems |
| Identity | None | Every actor has a PID |
| Type system | Channels are typed | Mailboxes accept any term |

Neither is "better." CSP is lighter and clearer for in-process pipelines; actors are richer for distributed and fault-tolerant systems.

Go can implement actor-like patterns by wrapping each "actor" as a goroutine with a dedicated input channel. The result is approximate; Erlang/OTP provides the production primitives natively.

---

## Common CSP-Style Patterns Catalog

A reference for designing real systems.

### 1. Producer / consumer

One producer, one consumer, one channel. The simplest CSP pattern.

### 2. Worker pool

One job channel, N workers. Bounded concurrency.

### 3. Pipeline

N stages connected by channels. Linear data flow.

### 4. Fan-out / fan-in

Distribute work to many workers, collect results to one place.

### 5. Future / promise

A goroutine computes a value; the caller reads it from a channel later.

```go
type Future struct {
    out chan int
}

func async(f func() int) *Future {
    ft := &Future{out: make(chan int, 1)}
    go func() { ft.out <- f() }()
    return ft
}

func (ft *Future) Get() int { return <-ft.out }
```

### 6. Generator

A function that produces a stream of values via a returned channel.

### 7. Quit channel

A long-running goroutine watches a `done` channel for cancellation.

### 8. Heartbeat

A goroutine sends "still alive" on a channel periodically; the monitor detects silence.

```go
func work(heartbeat chan<- struct{}) {
    for {
        heartbeat <- struct{}{}
        doStep()
    }
}
```

### 9. Or-channel

Combine multiple "done" channels into one that fires when any of them does.

```go
func or(channels ...<-chan struct{}) <-chan struct{} {
    out := make(chan struct{})
    go func() {
        defer close(out)
        cases := make([]reflect.SelectCase, len(channels))
        for i, c := range channels {
            cases[i] = reflect.SelectCase{
                Dir: reflect.SelectRecv, Chan: reflect.ValueOf(c),
            }
        }
        reflect.Select(cases)
    }()
    return out
}
```

### 10. Bridge

Forward values from a stream of channels into a single output channel.

```go
func bridge(in <-chan <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for stream := range in {
            for v := range stream {
                out <- v
            }
        }
    }()
    return out
}
```

These patterns are extensively documented in Sameer Ajmani's Go talks and in Katherine Cox-Buday's *Concurrency in Go*.

---

## Testing CSP-Style Code

### Test channel-driven flow

```go
func TestPipeline(t *testing.T) {
    in := make(chan int, 3)
    in <- 1; in <- 2; in <- 3
    close(in)

    out := square(in)

    var got []int
    for v := range out {
        got = append(got, v)
    }
    want := []int{1, 4, 9}
    if !reflect.DeepEqual(got, want) {
        t.Fatalf("got %v want %v", got, want)
    }
}
```

Close the input to signal end-of-stream. The pipeline closes its output when the input is drained.

### Test cancellation

```go
func TestCancel(t *testing.T) {
    in := make(chan int)
    ctx, cancel := context.WithCancel(context.Background())
    out := worker(ctx, in)
    cancel()
    // out should close shortly
    select {
    case _, ok := <-out:
        if ok {
            t.Fatal("expected closed channel")
        }
    case <-time.After(time.Second):
        t.Fatal("timeout waiting for shutdown")
    }
}
```

### Test goroutine leaks

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

`goleak` reports any goroutines still alive after tests finish.

### Stress with `-race`

Run all CSP-style tests with `-race` and `-count=100` to surface timing-dependent bugs.

---

## Self-Assessment

- [ ] I can name each CSP operator and its Go equivalent.
- [ ] I can describe the difference between an unbuffered and a buffered channel in CSP terms.
- [ ] I have written a fan-out / fan-in worker pool with proper close semantics.
- [ ] I use `context.Context` for cancellation in all long-running goroutines.
- [ ] I can identify a piece of code that should be CSP-style and one that should not.
- [ ] I have implemented a generator that returns a `<-chan T`.
- [ ] I have used `select` with at least three cases including a timeout.
- [ ] I know the difference between CSP and the actor model with at least three contrasts.
- [ ] I have tested a pipeline with closed channels and verified shutdown.
- [ ] I have used `goleak` or equivalent to detect goroutine leaks in tests.

---

## Summary

CSP is a small algebra of processes communicating through channels. Go embodies it pragmatically: goroutines are processes, channels are channels, `select` is choice. Unbuffered channels enforce synchronous handoff; buffered channels add decoupling at the cost of CSP purity.

The discipline pays off when ownership is clear and dataflow drives the design. It does not pay off for protecting shared variables, broadcasting to many subscribers, or hot loops. Mix CSP with mutexes and atomics; use the right tool per problem.

The senior view treats CSP as one architectural pattern among several. The professional view dips into the formal CSP literature and into runtime mechanics. Both lie ahead.

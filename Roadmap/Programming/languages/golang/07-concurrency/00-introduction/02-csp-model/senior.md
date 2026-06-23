# CSP Model — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Designing a System as a CSP Network](#designing-a-system-as-a-csp-network)
3. [Ownership and Lifecycle Discipline](#ownership-and-lifecycle-discipline)
4. [CSP at Scale: Concerns Beyond Correctness](#csp-at-scale-concerns-beyond-correctness)
5. [Channel Topology Choices](#channel-topology-choices)
6. [Refactoring Shared-Memory Code Into CSP](#refactoring-shared-memory-code-into-csp)
7. [Hybrid Designs: Channels + Mutexes](#hybrid-designs-channels--mutexes)
8. [Deadlock and Livelock in CSP Designs](#deadlock-and-livelock-in-csp-designs)
9. [Backpressure as a First-Class Concern](#backpressure-as-a-first-class-concern)
10. [Observability in CSP Systems](#observability-in-csp-systems)
11. [When to Reach for an Actor-Inspired Pattern](#when-to-reach-for-an-actor-inspired-pattern)
12. [Architectural Examples](#architectural-examples)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## Introduction

The senior view of CSP is about *system shape*. Where do the boundaries between processes lie? Which channels are public API and which are internal plumbing? How does the system behave under burst, failure, and shutdown? Senior engineers do not need to remember CSP operator symbols; they need to design systems that are easy to reason about, hard to break, and observable from the outside.

This file is opinionated. Many of these decisions are matters of taste, and reasonable senior engineers disagree. But the failure modes are real: a misdesigned pipeline that deadlocks under pressure, a leaky worker pool that exhausts memory at 3 a.m., a fan-out that mysteriously slows down. Most of these come from CSP discipline being half-followed.

After this you will:

- Design a non-trivial concurrent system using CSP as the architecture, not as a toy.
- Choose channel topology deliberately (linear, tree, mesh, broker).
- Apply ownership and lifecycle discipline consistently.
- Recognise and prevent CSP-flavoured deadlocks and leaks.
- Decide when to mix mutexes, atomics, and channels.
- Build observability into a concurrent system from day one.

---

## Designing a System as a CSP Network

### Start with the data flow

Every concurrent system has a data flow. Sketch it: where does input arrive? Where does output go? What transformations happen along the way? Which transformations can run in parallel? Which must be sequential?

A typical service:

```
[Network] -> [Decoder] -> [Validator] -> [Business Logic] -> [Persistence] -> [Response]
                          -> [Audit Log]
```

Each box is a candidate process. Arrows are channels. Forks indicate fan-out; merges indicate fan-in.

### Decide the boundaries

Where do processes meet? Options:

- **Per-request goroutine.** The most common shape. Each incoming request is one goroutine flowing through the boxes synchronously, using a function-call style.
- **Per-stage goroutine pool.** Each box is a long-lived pool; requests flow through as messages on channels. More CSP-pure.
- **Hybrid.** Per-request goroutines that spawn child goroutines for parallel sub-work (fan-out within a request).

The right choice depends on:

- **Latency budget.** Per-request goroutines have lower per-message overhead.
- **Throughput.** Pool-based topology can serve more requests per second when stages have different rates.
- **Failure isolation.** Pool-based topology can drop or buffer at boundaries; per-request is harder to throttle.

### Document the channel interfaces

For each channel, write:

- The element type (often a struct).
- The producer's identity.
- The consumer's identity.
- Closing semantics (who closes, when).
- Buffer size and rationale.
- Cancellation propagation.

This becomes the system's documented concurrency contract. Without it, a new engineer cannot reason about the code; with it, even subtle bugs become approachable.

---

## Ownership and Lifecycle Discipline

### Each goroutine has one owner

Whoever spawned the goroutine is responsible for stopping it. In Go this discipline is convention:

```go
type Service struct {
    ctx    context.Context
    cancel context.CancelFunc
    done   chan struct{}
}

func New(parent context.Context) *Service {
    ctx, cancel := context.WithCancel(parent)
    s := &Service{ctx: ctx, cancel: cancel, done: make(chan struct{})}
    go func() {
        defer close(s.done)
        s.run(ctx)
    }()
    return s
}

func (s *Service) Close() {
    s.cancel()
    <-s.done
}
```

The `Service` struct *is* the goroutine's owner. `Close()` stops it cleanly. No goroutine spawned without an owner.

### Each channel has one closer

The CSP discipline: the channel's producer closes it. Multiple producers? Then either:

- Use `sync.Once` to ensure one close.
- Have a coordinator goroutine that waits on a `WaitGroup` of producers and then closes.

```go
go func() {
    wg.Wait()
    close(out)
}()
```

This is the standard close-after-wait pattern.

### Shutdown propagates from outside in

When the service is shutting down:

1. Stop accepting new input at the boundary.
2. Cancel the root context.
3. Goroutines that respect cancellation exit.
4. Channels close as their producers exit.
5. Downstream consumers finish draining and exit.
6. Resources release.
7. The top-level orchestrator returns.

This is *graceful shutdown*. Crash-only systems skip it; production services do not.

### Resource cleanup is the goroutine's responsibility

Each goroutine that holds a resource (file, connection, lock) must release it on every exit path. Use `defer`:

```go
go func() {
    defer conn.Close()
    defer wg.Done()
    handle(conn)
}()
```

Resource cleanup before signalling done; otherwise the parent may return and tear down the world while the resource is still held.

---

## CSP at Scale: Concerns Beyond Correctness

A toy three-goroutine pipeline is easy. A production system with 50 stages, 1000 goroutines per request, and 100k requests per minute is hard. Senior engineering attends to the following.

### Per-goroutine memory

Every goroutine has a stack (~2 KB initially, growing on demand). 100 000 active goroutines is ~200–400 MB just for stacks. Plus closures, plus heap-allocated channel structs. Bound aggressively.

### Per-channel memory

Each `make(chan T, n)` allocates `n * sizeof(T)` plus the channel header. A million-buffer channel of `[]byte` references can hold gigabytes.

### Scheduler pressure

The Go scheduler handles ~1M runnable goroutines reasonably. Beyond that, the scheduler itself becomes a bottleneck. Reuse goroutines via pools, do not spawn one per item.

### Garbage collector pressure

Sending a struct on a channel often allocates (the struct is copied or escapes to heap). Heavy channel traffic generates GC work. Reuse struct pools (`sync.Pool`) in hot paths.

### Latency tail amplification

A scatter-gather to 10 backends has p99 latency approximately `1 - (1 - p_99_per)^10`. If each backend's p99 is 100 ms, the aggregate p99 is much higher. Use hedged requests or quorum semantics.

### Cascading failures

A slow backend in a pipeline can cause backpressure to stall upstream stages, which can cause clients to time out and retry, which can multiply load on the slow backend. Circuit breakers and load shedding interrupt these cycles.

---

## Channel Topology Choices

### Linear pipeline

```
A -> B -> C -> D
```

Simple, easy to reason about. Throughput limited by the slowest stage. Backpressure flows naturally.

### Tree (fan-out)

```
A -> [B1, B2, B3]
```

Parallelise the bottleneck. Add a fan-in if results must be combined.

### DAG (directed acyclic graph)

```
A -> B -> D
A -> C -> D
```

Multiple paths from input to output. Common in data processing where the same source feeds multiple sinks (write to DB + emit metric + invalidate cache).

### Cycle / feedback loop

```
A -> B -> C -> A
```

Used for retries, rate limiting, or recursive processing. Be careful — easy to deadlock or livelock.

### Star / broker

```
       central broker
       /      |      \
    sub1    sub2    sub3
```

Decouples N producers from M consumers. Implement with a broker goroutine that copies each message to all subscribers. Built-in scaling concerns (must not block one slow subscriber from delivering to others).

### Mesh

Every process talks to every other. Avoid unless you genuinely need it. The combinatorics make debugging hellish.

---

## Refactoring Shared-Memory Code Into CSP

A common task: take an old codebase with mutexes and turn it into a CSP-style design (or the inverse — sometimes you should *remove* CSP because it does not pay).

### Example: refactor a mutex-protected counter into a CSP counter

Before:

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c *Counter) Inc() { c.mu.Lock(); c.n++; c.mu.Unlock() }
func (c *Counter) Get() int { c.mu.Lock(); defer c.mu.Unlock(); return c.n }
```

CSP version:

```go
type Counter struct {
    inc chan int
    get chan int
    out chan int
    quit chan struct{}
}

func NewCounter() *Counter {
    c := &Counter{
        inc:  make(chan int),
        get:  make(chan int),
        out:  make(chan int),
        quit: make(chan struct{}),
    }
    go func() {
        var n int
        for {
            select {
            case d := <-c.inc:
                n += d
            case <-c.get:
                c.out <- n
            case <-c.quit:
                return
            }
        }
    }()
    return c
}
```

Honestly: the mutex version is simpler and faster. This example exists to show how *not* to use CSP for everything. The CSP version is useful only if you want a single goroutine to mediate accesses (perhaps with extra logic like batched updates, persistence, or sequencing).

### When refactoring TO CSP makes sense

- The shared state is complex and the access pattern matches a state machine.
- Different operations have different rates and you want internal queueing.
- You want explicit ordering of operations.
- The current code is plagued by lock ordering or deadlocks.

### When refactoring AWAY from CSP makes sense

- A simple counter or flag was wrapped in a channel-mediated owner goroutine.
- Channel overhead is showing up in profiles.
- The owner goroutine is now a bottleneck (effectively a single-threaded service).
- Adding more channels keeps making the code more complex without solving the actual problem.

The middle ground: keep CSP at the boundary (each request is its own goroutine), use mutexes or atomics inside (per-piece-of-state protection).

---

## Hybrid Designs: Channels + Mutexes

Real Go code is rarely pure CSP. A typical structure:

- **Top level.** Goroutine per request; coordination via channels and `errgroup`.
- **Mid level.** Functions that may spawn child goroutines for parallel work; use `context.Context` for cancellation.
- **Inner data structures.** Mutex- or atomic-protected for shared state (caches, counters, configuration).
- **Cross-cutting concerns.** Pub-sub event bus implemented as a broker goroutine with channels.

This blend is idiomatic Go. The CSP discipline applies at the level of "how do my high-level pieces communicate." Inside those pieces, conventional shared-memory code is fine.

### The decision rule

For each piece of shared data, ask:

- **Will many goroutines need to read or modify it?** If yes, synchronise.
- **Is the access pattern uniform reads and writes?** Mutex.
- **Is it read-mostly?** RWMutex or `sync.Map`.
- **Is it numeric and tiny?** Atomic.
- **Is it a stream of values?** Channel.
- **Is it complex state that benefits from being owned by one goroutine?** CSP with a state-machine goroutine.

The right answer changes per piece of data. Senior engineers do not insist on one tool.

---

## Deadlock and Livelock in CSP Designs

### Classic deadlock: circular wait

```go
ch1, ch2 := make(chan int), make(chan int)

go func() {
    v := <-ch1
    ch2 <- v + 1
}()

ch2 <- 0 // blocks forever — no receiver
v := <-ch1
```

The main goroutine blocks on `ch2 <- 0` waiting for a receiver. The receiver is on the line above. Deadlock.

Detection: Go's runtime detects the *fatal* deadlock (all goroutines asleep) and panics. But it cannot detect *partial* deadlocks where only some goroutines are stuck — those just leak.

### Deadlock from missing close

```go
in := make(chan int)
out := square(in)
for v := range out {
    fmt.Println(v)
}
```

If `square` only closes `out` when `in` is closed, and the caller never closes `in`, the range loops forever. The closing protocol must be explicit and respected.

### Livelock: two processes courteously yielding

```go
for {
    select {
    case <-ch:
    default:
        runtime.Gosched()
    }
}
```

A busy loop that never makes progress. Bad pattern. Replace with blocking receive.

### Avoiding deadlock

- Always have a path for cancellation in every long-running goroutine.
- Document who closes each channel.
- Avoid cyclic channel topologies unless the cycle is broken by cancellation.
- Use `errgroup.WithContext` to ensure failure propagates cancellation.
- Use timeouts on every receive (`select` with `time.After` or `ctx.Done()`).

### Deadlock detection tools

- Go runtime: detects "all goroutines asleep."
- `pprof goroutine` profile: shows where every goroutine is. Stuck goroutines stand out as "still here after expected exit."
- `goleak` in tests: fails tests that leave goroutines running.
- Stress tests with `-race -count=N`.

---

## Backpressure as a First-Class Concern

Backpressure is the mechanism by which a slow consumer slows down a fast producer. Without it, queues grow unboundedly and the system OOMs.

### Backpressure via unbuffered channels

The simplest mechanism. A send on an unbuffered channel blocks until a receive. The producer cannot get ahead.

### Backpressure via bounded buffered channels

Allow modest decoupling but bound the buffer to a known burst size. When full, sends block. The buffer is a shock absorber, not a queue.

### Load shedding instead of backpressure

Sometimes blocking the producer is wrong. A network handler that blocks because internal queues are full will let connections back up. Better: drop requests at the boundary (return 503) and let healthy requests through.

```go
select {
case work <- req:
default:
    http.Error(w, "overloaded", 503)
    return
}
```

### Backpressure across services

Within a process, channels do the job. Across services, backpressure requires protocol support: HTTP/2 flow control, gRPC streaming flow control, Kafka consumer lag, etc. The same idea — "do not let the producer outpace the consumer indefinitely" — appears at every layer.

---

## Observability in CSP Systems

Without observability, a CSP system is opaque. Senior systems include:

### Per-channel depth metrics

For each significant buffered channel, expose a gauge of current length. Sustained high length indicates a downstream bottleneck.

```go
prometheus.NewGaugeFunc(prometheus.GaugeOpts{
    Name: "queue_depth_jobs",
}, func() float64 { return float64(len(jobs)) })
```

### Goroutine counts per role

Tag goroutines (informally — Go has no goroutine names) by counting active workers in your own code:

```go
var activeWorkers atomic.Int64

go func() {
    activeWorkers.Add(1)
    defer activeWorkers.Add(-1)
    work()
}()
```

Export `activeWorkers` as a gauge.

### Tracing across channels

`OpenTelemetry` spans flow through `context.Context`. When a goroutine reads from a channel, it can extract the span context from a struct sent on the channel and continue the trace:

```go
type Job struct {
    Ctx context.Context
    Data []byte
}

job := <-jobs
span := trace.SpanFromContext(job.Ctx)
// span is the producer's span; continue tracing
```

### Block / mutex profiles

`runtime.SetBlockProfileRate(1)` and `runtime.SetMutexProfileFraction(1)` enable pprof to capture blocking and contention. Useful for diagnosing CSP slowness.

### Logging at boundaries

Logging every channel send is too verbose. Logging boundary events — "request started," "request done," "error escalated" — gives just enough timeline to understand a problematic request.

---

## When to Reach for an Actor-Inspired Pattern

Sometimes CSP is the wrong abstraction. Consider:

### Each entity has identity and per-entity state

In a game, each player is an entity with their own state (inventory, position, connection). They communicate by sending events to each other. This is an actor pattern: each actor (player) has a mailbox, others address it by name.

In Go, implement with one goroutine per entity:

```go
type Player struct {
    inbox chan Event
}

func NewPlayer(id string) *Player {
    p := &Player{inbox: make(chan Event, 16)}
    go p.loop()
    return p
}

func (p *Player) Send(e Event) { p.inbox <- e }
```

The struct *is* the actor. Other goroutines send by calling `p.Send(e)`. Inside, the player processes events sequentially from its inbox — no locks needed.

### Supervisor / restart trees

Erlang's "let it crash" philosophy: when an actor errors, kill it and restart it. A supervisor watches a group and applies a restart strategy.

Implementing in Go is harder because panics terminate the program by default. With careful `recover()` + restart logic per goroutine, you can approximate. The `golang.org/x/sync/errgroup` package gives you the first half (an error from one goroutine cancels the group); supervised restart is more bespoke.

### Distributed messaging

Across processes or machines, CSP does not extend naturally. Actors do — Erlang's distribution is built in. For distributed Go systems, the pattern is "actor per node + message-passing middleware (NATS, Kafka, gRPC)."

---

## Architectural Examples

### Example: ETL pipeline

```
source -> filter -> enrich -> deduplicate -> batch -> writer
                                                  -> metrics
```

Each stage is a goroutine. Connections via channels. Each stage exits when its input channel closes. The source closes its output when input is exhausted. Backpressure flows backward naturally.

Failure handling: if `writer` fails, propagate via `errgroup`, cancelling the context. All stages exit on `ctx.Done()`.

### Example: HTTP API with rate limiting

```
[incoming requests] -> rate limiter -> handler pool -> response
```

Rate limiter is a goroutine producing tokens on a channel. Handler reads a token before processing. When tokens run out, handlers wait. Token producer paces tokens at the configured rate.

```go
tokens := make(chan struct{}, burst)
go func() {
    t := time.NewTicker(time.Second / time.Duration(qps))
    for range t.C {
        select {
        case tokens <- struct{}{}:
        default:
        }
    }
}()

http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    select {
    case <-tokens:
        handle(w, r)
    case <-time.After(time.Second):
        http.Error(w, "rate limited", 429)
    }
})
```

### Example: pub-sub event bus

```
publisher -> broker -> [sub1, sub2, ..., subN]
```

Broker is a goroutine with a publish channel and a map of subscriber channels. On each publish, fan out to all subscribers:

```go
type Broker struct {
    in   chan Event
    subs map[string]chan Event
    mu   sync.Mutex
}

func (b *Broker) Subscribe(id string) <-chan Event {
    b.mu.Lock()
    defer b.mu.Unlock()
    ch := make(chan Event, 16)
    b.subs[id] = ch
    return ch
}

func (b *Broker) Publish(e Event) { b.in <- e }

func (b *Broker) loop() {
    for e := range b.in {
        b.mu.Lock()
        for _, ch := range b.subs {
            select {
            case ch <- e:
            default:
                // subscriber's buffer full — drop or block
            }
        }
        b.mu.Unlock()
    }
}
```

Notice the hybrid: mutex for subscriber map, channel for events. Pure CSP would also use channels for subscribe/unsubscribe; the hybrid is simpler.

---

## Self-Assessment

- [ ] I can sketch a non-trivial concurrent system as a graph of CSP processes and channels.
- [ ] I document who closes each channel and who owns each goroutine.
- [ ] I use `context.Context` for cancellation everywhere; I write goroutines that exit on `ctx.Done()`.
- [ ] I have refactored shared-memory code into CSP-style and back, based on measurement.
- [ ] I have implemented backpressure (unbuffered channel, bounded buffer, or load shedding).
- [ ] I have written a pub-sub broker, a worker pool, and a pipeline.
- [ ] I expose goroutine count and queue depth as metrics in production services.
- [ ] I have diagnosed a CSP-style deadlock using `pprof goroutine`.
- [ ] I can argue for and against using CSP versus actors in a given scenario.
- [ ] I have a written shutdown protocol for at least one production CSP system.

---

## Summary

CSP at the senior level is about *shape*. Design the system as a network of processes communicating through channels; document the interfaces; bound resources; respect cancellation; observe everything.

Pure CSP is rare in production Go. Real systems mix CSP at the architectural level with mutexes and atomics inside individual data structures. The mix is fine; the discipline lies in being explicit about which is which.

Common failure modes — deadlock, leaks, backpressure collapse, latency-tail amplification — appear when CSP discipline is half-followed. Senior engineering makes the discipline explicit, observable, and testable.

The next file (`professional`) dips into formal process algebras and runtime mechanics for those who want to go deeper.

# CSP Model — Interview Questions

> Questions about CSP, channels, and idiomatic Go concurrency. From junior to staff. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What does CSP stand for and who proposed it?

**Model answer.** CSP stands for *Communicating Sequential Processes*. It was proposed by C. A. R. (Tony) Hoare in a 1978 paper of the same name. CSP models concurrency as a network of independent sequential processes that communicate exclusively by passing messages over channels.

**Follow-up.** *Why is it called "sequential"?* — Each process by itself is purely sequential. Concurrency emerges from running multiple such processes in parallel, with synchronisation happening only via channel communications.

---

### Q2. Explain the slogan "Do not communicate by sharing memory; share memory by communicating."

**Model answer.** The slogan, attributed to Rob Pike, captures the CSP discipline. Instead of having multiple goroutines access a shared variable (with locks to coordinate), structure the program so each piece of data is owned by one goroutine at a time. When another goroutine needs it, send it over a channel. The send-receive operation transfers ownership safely without explicit locking.

**Follow-up.** *Does that mean mutexes are bad in Go?* — No. Mutexes are appropriate for protecting a single shared variable or a simple data structure. CSP shines for dataflow-style programs (pipelines, queues, fan-out / fan-in). Both have their place.

---

### Q3. What is the difference between an unbuffered and a buffered channel?

**Model answer.** An unbuffered channel synchronises the sender and receiver: the sender blocks until a receiver is ready, and vice versa. A buffered channel has a fixed-size buffer; a send into a non-full buffer returns immediately, a receive from a non-empty buffer returns immediately. The buffer decouples sender and receiver in time.

**Follow-up.** *When would you use each?* — Unbuffered for explicit handoff and back-pressure. Buffered (small size) for absorbing burst or decoupling rate-mismatched stages.

---

### Q4. What does `close(ch)` do?

**Model answer.** `close(ch)` signals to receivers that no more values will be sent on the channel. Receivers see the close via the second return value of `v, ok := <-ch` (ok is false). A `range` loop over the channel exits. Sending on a closed channel panics. Closing a closed channel panics. Closing a nil channel panics.

**Follow-up.** *Who should close a channel?* — The sender (or the channel's designated owner). Receivers should not close.

---

### Q5. What is the difference between CSP and the actor model?

**Model answer.** Both are message-passing concurrency models, but they differ in addressing. In CSP, channels are anonymous: a process sends a message into a channel, and any process reading that channel may receive it. Processes do not have public identities. In the actor model, each actor has a name (a PID in Erlang); messages are addressed to specific actors. Go's channels follow CSP; Erlang's actors are the canonical example of the other model.

**Follow-up.** *Which is better?* — Neither. CSP is lighter for in-process pipelines; actors are richer for distributed and fault-tolerant systems.

---

### Q6. What is wrong with this code?

```go
ch := make(chan int)
ch <- 1
fmt.Println(<-ch)
```

**Model answer.** Deadlock. The send `ch <- 1` blocks because the channel is unbuffered and no receiver is ready. The next line of the same goroutine is the receiver, but the goroutine cannot reach it while blocked on the send. The Go runtime detects the deadlock and panics with "all goroutines are asleep".

**Fix.** Either send from a separate goroutine, or use a buffered channel: `make(chan int, 1)`.

---

## Middle

### Q7. Implement a pipeline with three stages using channels.

**Model answer.**

```go
func gen(nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range nums {
            out <- n
        }
    }()
    return out
}

func sq(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for n := range in {
            out <- n * n
        }
    }()
    return out
}

func sum(in <-chan int) int {
    s := 0
    for n := range in {
        s += n
    }
    return s
}

// Usage:
total := sum(sq(gen(1, 2, 3, 4)))  // 1 + 4 + 9 + 16 = 30
```

Each stage is a goroutine. Each closes its output channel when done. The next stage exits when its input closes.

**Follow-up.** *How would you add cancellation?* — Take a `context.Context` and `select` on `ctx.Done()` in each stage's loop.

---

### Q8. Explain "ownership transfer" via channels.

**Model answer.** When you send a value on a channel, the CSP discipline says the sender no longer owns it; the receiver does. This is especially important for reference types — pointers, slices, maps — where ownership matters for safe access. After sending a `*Foo`, the sender should not read or write `*Foo`; the receiver is free to mutate.

The Go language does not enforce this. The race detector catches some violations. The discipline is the programmer's responsibility.

**Follow-up.** *What types does this not apply to?* — Primitive values (`int`, `string`, etc.) are copied on send; "ownership" is meaningless because each side has its own copy.

---

### Q9. What happens when you receive from a closed channel?

**Model answer.** The receive returns immediately with the zero value of the channel's element type. The two-value form `v, ok := <-ch` returns `ok == false` to signal that the channel is closed. A `range` loop exits on close. Multiple receivers blocked on a channel all unblock when it closes — this is the "broadcast" property.

**Follow-up.** *How would you use this for broadcasting cancellation to many goroutines?* —

```go
done := make(chan struct{})
// ... many goroutines ...
go func() {
    for {
        select {
        case <-done:
            return
        case ...
        }
    }
}()
// To cancel all:
close(done)
```

Closing `done` immediately unblocks every goroutine waiting on it.

---

### Q10. How does `select` correspond to CSP's choice operator?

**Model answer.** CSP has an external choice operator `[]` (or `□`) that lets a process wait for any of multiple events. Go's `select` is the direct translation: each case is one possible communication event, and `select` blocks until any one of them is ready. If multiple are simultaneously ready, the runtime picks uniformly at random — that is CSP's "external nondeterministic choice."

**Follow-up.** *What does `default` add?* — `default` makes the `select` non-blocking. If no case is ready immediately, `default` fires. Useful for fire-and-forget sends or polling receives.

---

### Q11. When should you NOT use channels in Go?

**Model answer.** Several cases:

- **Protecting a single shared variable.** Mutex or atomic is simpler and faster.
- **Read-heavy data structures.** `sync.RWMutex` or `sync.Map`.
- **Counters or flags.** `atomic.Int64`, `atomic.Bool`.
- **Hot loops processing millions of items per second.** Channel overhead becomes significant.
- **Broadcasting to many subscribers.** Channels are point-to-point; broadcasting requires a custom broker.

The rule: use channels when ownership transfer or coordination is the goal. Use mutexes when protecting state from concurrent access is the goal.

---

### Q12. How do you implement a worker pool with channels?

**Model answer.**

```go
func workerPool(jobs <-chan Job, workers int) <-chan Result {
    out := make(chan Result)
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range jobs {
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

One job channel, N workers all reading from it, one result channel. A separate goroutine waits for all workers to finish and then closes the result channel.

**Follow-up.** *Why the separate goroutine for close?* — Workers cannot close `out` directly because there are multiple of them and closing twice panics. The coordinator `wg.Wait()`s on all workers and closes `out` once.

---

## Senior

### Q13. Design a pub-sub event bus using channels.

**Model answer.**

```go
type Broker struct {
    subscribe   chan subscription
    unsubscribe chan string
    publish     chan Event
}

type subscription struct {
    id string
    ch chan Event
}

func NewBroker() *Broker {
    b := &Broker{
        subscribe:   make(chan subscription),
        unsubscribe: make(chan string),
        publish:     make(chan Event),
    }
    go b.loop()
    return b
}

func (b *Broker) loop() {
    subs := map[string]chan Event{}
    for {
        select {
        case s := <-b.subscribe:
            subs[s.id] = s.ch
        case id := <-b.unsubscribe:
            if ch, ok := subs[id]; ok {
                close(ch)
                delete(subs, id)
            }
        case e := <-b.publish:
            for _, ch := range subs {
                select {
                case ch <- e:
                default:
                    // subscriber's buffer full — drop or block
                }
            }
        }
    }
}

func (b *Broker) Subscribe(id string) <-chan Event {
    ch := make(chan Event, 16)
    b.subscribe <- subscription{id, ch}
    return ch
}

func (b *Broker) Publish(e Event) { b.publish <- e }
func (b *Broker) Unsubscribe(id string) { b.unsubscribe <- id }
```

The broker is a single goroutine that mediates all access to the subscriber map. No locks needed inside the broker. Subscribers receive events on their channels; if a subscriber is slow, events to it are dropped (or block, configurable).

**Follow-up.** *Why does the broker drop slow subscribers' events?* — Otherwise one slow subscriber blocks delivery to everyone. The trade-off (deliver to all reliably vs deliver to fast ones quickly) is a product decision.

---

### Q14. What is back-pressure and how does CSP enable it?

**Model answer.** Back-pressure is the mechanism by which a slow consumer slows down a fast producer. Without back-pressure, a queue grows unboundedly and the system OOMs.

In CSP, unbuffered channels provide back-pressure naturally: the sender blocks until the receiver is ready. A pipeline of unbuffered channels self-regulates — if any stage is slow, every upstream stage pauses at the next send.

Buffered channels offer bounded decoupling: senders can deposit values up to the buffer's capacity, after which they block. The buffer absorbs burst; the back-pressure still engages eventually.

**Follow-up.** *What is load shedding and when do you use it instead?* — Load shedding drops work when overloaded rather than blocking the producer. Used at service boundaries where blocking the producer would cause cascading failures (e.g., HTTP servers under load — better to return 503 than to hold connections forever).

---

### Q15. How do you detect goroutine leaks in CSP-style code?

**Model answer.** Several techniques:

1. **`runtime.NumGoroutine()` in production.** Sustained growth indicates leaks. Export as a Prometheus gauge.
2. **`pprof goroutine` profile.** Dumps all goroutine stacks. Search for goroutines stuck on a channel send/receive that should have completed.
3. **`goleak` in tests.** `go.uber.org/goleak` snapshots goroutines before and after tests; failures indicate leaks.
4. **Stress runs.** `go test -count=1000` to surface leaks that happen rarely.

Common leak sources in CSP code:

- Channel never closed; receiver loops forever.
- Sender blocks on an unbuffered channel; receiver exits early without reading.
- Goroutine waits on `ctx.Done()`; context never cancelled.

---

### Q16. How does the `select` statement handle multiple ready cases?

**Model answer.** When multiple cases are ready simultaneously, the runtime picks one uniformly at random. This corresponds to CSP's external nondeterministic choice. The runtime cannot favour any particular case because the language semantics demand fairness.

**Follow-up.** *Why uniform random and not round-robin?* — Pseudo-random selection is simpler to implement and more robust under adversarial workloads. Round-robin would require state that survives across `select` invocations.

---

### Q17. Describe a hybrid design that uses both channels and mutexes.

**Model answer.** Consider an HTTP request handler that updates a shared cache:

- **Top level:** one goroutine per request (CSP: each request is its own process).
- **Mid level:** the handler calls a function that internally fans out to two backends via `errgroup`. Communication via channels and error groups (CSP).
- **Cache access:** the handler reads from a shared cache protected by `sync.RWMutex` (shared memory).

Why hybrid? Because the right tool depends on the access pattern. Channels are great for ownership transfer and coordination. Mutexes are great for read-mostly shared structures. Mixing them lets each problem use the right primitive.

**Follow-up.** *How do you avoid making the hybrid confusing?* — Document which parts of the code are CSP-style (data flows through channels) and which are shared-memory (locks protect state). Keep them at different layers of the architecture so a reader knows what to expect.

---

### Q18. How do you implement structured concurrency with CSP discipline?

**Model answer.** Use `errgroup.Group` from `golang.org/x/sync`. It enforces:

- All spawned goroutines run to completion before `Wait()` returns.
- The first error cancels a shared context, aborting the others.
- Errors collect; resources release.

```go
g, ctx := errgroup.WithContext(ctx)
for _, u := range urls {
    u := u
    g.Go(func() error { return fetch(ctx, u) })
}
if err := g.Wait(); err != nil {
    return err
}
```

This is the structured-concurrency primitive of choice. Internally it uses channels (well, a `sync.Once` and a `sync.WaitGroup`), but the user sees a clean API.

---

## Staff

### Q19. Design the concurrency model for a high-throughput log aggregator. CSP, shared memory, or hybrid?

**Model answer.** Hybrid. Top-level architecture:

- **Per-connection goroutine.** One goroutine per producer connection accepts log entries.
- **Buffered channels into shared workers.** Each connection goroutine submits entries to a shared input channel (size: tuned to expected burst).
- **Worker pool.** N worker goroutines read from the channel, parse, validate, and batch entries.
- **Batched writer.** Workers send batches to a writer goroutine on a separate channel.
- **Writer to disk / network.** The writer flushes batches to durable storage.

Shared-memory components:

- **Metrics counters.** `atomic.Int64` for entries processed, errors, etc.
- **Configuration.** `atomic.Value` for hot-reloadable settings.
- **Hash-based partitioning.** A consistent hash function decides which worker owns each entry (for ordering within a key).

The CSP shape handles dataflow and back-pressure. Atomics handle counters. The mix is intentional and documented.

Scaling concerns: at high throughput (millions of entries / sec), channel overhead matters. Consider:

- **Batching.** Workers receive `[]Entry` not `Entry`.
- **Sharding.** Per-CPU input channels reduce contention.
- **`sync.Pool`.** Reuse batch buffers across goroutines.

---

### Q20. Describe a case where CSP discipline produced a deadlock that shared-memory code would not have.

**Model answer.** Consider two pipelines that share a coordinator:

```
   pipelineA ----send----> coordinator
   pipelineB ----send----> coordinator
   coordinator --send---> pipelineA (response)
   coordinator --send---> pipelineB (response)
```

If pipelineA sends and blocks waiting for a response, and the coordinator blocks waiting to send to pipelineA because A's response channel is full, and meanwhile the coordinator's input channel fills with sends from B that A's response cannot drain — circular wait, deadlock.

Shared-memory code with locks might have avoided this if the responses were stored in a shared map. Locks have their own pitfalls (lock ordering), but in this case CSP's strict channel discipline magnified the deadlock surface.

**Resolution.** Add buffers to response channels, or restructure so each pipeline owns its own response channel of size 1, or use a hybrid (shared response map with mutex).

The point: CSP does not make all concurrency bugs vanish. Different bug classes appear.

---

### Q21. Critique the design: "We use a single global broker goroutine for all event distribution."

**Model answer.** Concerns:

1. **Single point of failure.** If the broker panics or hangs, the whole system stops. No isolation.
2. **Sequential bottleneck.** One goroutine processes all events. Throughput is bounded by one core.
3. **Latency.** Every event goes through the broker. Adds at least one channel hop.
4. **Memory.** The broker maintains all subscriptions; it grows with subscriber count.

Better designs:

- **Per-topic brokers.** Each topic has its own broker; topics scale horizontally.
- **Sharded brokers.** Hash key determines which broker handles a message.
- **In-process pub-sub library.** Use a library that handles this (NATS in-process, `go-pubsub`).
- **External broker.** NATS, Kafka, Redis Pub/Sub for cross-process or scale-out.

The single-broker design is fine for small systems (low event rate, few subscribers). At scale, decompose.

---

### Q22. How does the Go memory model relate to CSP?

**Model answer.** The Go memory model defines happens-before relations. CSP communications establish happens-before:

- A send on a channel happens-before the corresponding receive completes.
- For buffered channels, the *k*th receive happens-after the *(k − cap)*th send.
- A close happens-before a receive that returns the close.

This means CSP-discipline code is automatically race-free for any data passed through channels. Writes before a send are visible after the receive. The CSP discipline (do not mutate after sending) plus the memory model (channels establish ordering) compose to give a correct concurrent system without explicit locks.

In contrast, shared-memory code must explicitly use mutexes, atomics, or other synchronisation primitives to establish happens-before for shared writes.

This is the *formal* justification for the CSP discipline. The memory model is documented at `https://go.dev/ref/mem` and covered in [04-memory-model](../04-memory-model/).

---

### Q23. What is "channel mobility" and why does it matter?

**Model answer.** Channel mobility is the property that channels themselves can be passed as values, including through other channels. The π-calculus formalises this. Go supports it directly: `chan chan T` is a channel of channels.

In practice this enables dynamic network topologies:

```go
type request struct {
    arg   int
    reply chan<- int
}

func server(reqs <-chan request) {
    for r := range reqs {
        r.reply <- compute(r.arg)
    }
}

// Caller:
reply := make(chan int, 1)
reqs <- request{42, reply}
result := <-reply
```

The reply channel is passed *through* the request channel. The server does not know in advance who the caller is; the caller passes its private reply channel each time.

This is the "request-response" pattern, fundamental in client-server design within a Go process.

---

### Q24. How would you ensure a CSP-style pipeline shuts down cleanly under failure?

**Model answer.** Use `errgroup.WithContext` at the orchestrator level. Each stage:

1. Takes a `context.Context`.
2. Watches `ctx.Done()` in its `select` loop.
3. Returns an error or completes normally.
4. Closes its output channel on exit.

```go
func stage(ctx context.Context, in <-chan T) (<-chan U, <-chan error) {
    out := make(chan U)
    errCh := make(chan error, 1)
    go func() {
        defer close(out)
        for {
            select {
            case v, ok := <-in:
                if !ok { return }
                u, err := transform(v)
                if err != nil {
                    errCh <- err
                    return
                }
                select {
                case out <- u:
                case <-ctx.Done():
                    return
                }
            case <-ctx.Done():
                return
            }
        }
    }()
    return out, errCh
}
```

Or, more idiomatically, wire everything through `errgroup`:

```go
g, ctx := errgroup.WithContext(ctx)
g.Go(func() error { return runStage1(ctx) })
g.Go(func() error { return runStage2(ctx) })
g.Go(func() error { return runStage3(ctx) })
if err := g.Wait(); err != nil {
    return err
}
```

When any stage errors, the context cancels, the others observe `ctx.Done()` and exit, channels close, the pipeline tears down.

---

### Q25. What would you tell a junior engineer who wants to use channels for everything?

**Model answer.** Channels are powerful but not universal. Things to consider:

1. **Channels are slower than mutexes for simple shared variables.** Use atomics or mutexes for counters, flags, and single-piece-of-state.
2. **Channels can deadlock.** Lock-style bugs (forgot to close, sent on a closed channel) trade for lock bugs (lock order violations, double-lock).
3. **Channels have overhead.** ~100 ns per operation. In hot loops, this adds up.
4. **Channels are point-to-point.** Broadcasting needs custom infrastructure.
5. **Channels obscure the logic when overused.** A simple algorithm should look simple, not like a network diagram.

The discipline is: use channels where dataflow is the design. Use mutexes/atomics where protecting state is the design. Use both when the architecture is layered.

Read Sameer Ajmani's *Go Concurrency Patterns* talk. Read Effective Go's concurrency section. Read Hoare's CSP paper once. Then write code, measure, refine.

---

## Closing

CSP is one of the deepest ideas in concurrent programming. Hoare's 1978 paper is short, lucid, and worth reading even if you never use the formal calculus. Go's channels distil that into a pragmatic tool — not pure, but useful.

The interview questions above blend theory and practice. Senior interviews probe both: can you explain CSP without buzzwords, and can you build production systems where the discipline pays off?

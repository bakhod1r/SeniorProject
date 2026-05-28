# Futures & Promises — Professional

> Focus: staff/principal-level decisions. Futures are not a library feature in Go; they are an emergent property of channels, goroutines, and contexts. The hard parts are not writing `Resolve` and `Await`. They are: who owns cancellation, how the deferred value behaves under partial failure, what happens when a Future graph crosses a process boundary, and what an unbounded fan-out does to a server at 03:00. Opinionated where the field agrees, explicit about trade-offs where it does not.

---

## 1. Futures as a system primitive

A Future is a *deferred value with a cancellation contract*. Conflating it with neighbouring primitives costs production. The taxonomy:

| Primitive | Identity | Coupling | Failure model | Typical use |
|---|---|---|---|---|
| Future / Promise | Anonymous deferred value | Producer/consumer share a handle | One value or one error | "Fetch this user; I'll need it in ~10 ms" |
| Goroutine-per-task | None; fire-and-forget | Side effects only | Panic crashes process | "Log this; I don't care when" |
| Actor (Erlang/Akka) | Long-lived addressable mailbox | Caller knows actor ref | Supervisor tree; restart | "Stateful entity processes a stream" |
| RPC (gRPC/HTTP) | Endpoint with schema | Tight: caller knows callee | Sync deadline; explicit error | "Charge this card and tell me now" |
| Channel-of-results | Stream of values | Anonymous producer, many values | Stream closes on done or error | "Yield results as they arrive" |
| Pub/Sub topic | Event broadcast | Loose; producer ignorant of subs | At-least-once; no return | "An order was placed" |

Four distinctions matter:

1. **Cardinality.** A Future is exactly one outcome. A channel-of-results is many. Confusing these turns a Future into a leaked goroutine blocking on the second send.
2. **Cancellation direction.** RPC: caller to callee. Actor: supervisor to actor. Future: *cooperative* — the consumer signals via `context.Context`, the producer must observe.
3. **Identity.** Actors have stable mailbox addresses. Futures are anonymous handles — once awaited and discarded, unreachable. Futures are unfit for long-lived stateful work.
4. **Composition.** Futures compose with `All`/`First`/`Map`; actors with message passing; RPC with sequential calls; Pub/Sub with topic chains. Each has different latency and failure semantics.

The rule: **Future for one deferred value with cancellation; actor for stateful identity; RPC for inline result; Pub/Sub for fan-out notification.** The Future is the smallest; pick it when the work is bounded, the result is one value, and overlap with other work matters.

---

## 2. Quantitative cost analysis

Numbers below are Go 1.22, amd64, Linux 6.6 on a tuned 16-core box.

### 2.1 The four costs of a Future

```
go func() {}             goroutine spawn               ~1.0 µs   (~2.5 KB stack)
ch <- v; <-ch            unbuffered chan send+recv     ~50 ns
ctx.Done() select branch context cancellation check    ~3 ns    (one chan recv)
context.WithCancel       new ctx with cancel goroutine ~100 ns  (no goroutine; cheap)
context.WithTimeout      same + timer                  ~600 ns  (timer allocation)
sync.Once.Do (fast path) once-per-Future fulfilment    ~5 ns
```

A bare Future built on a goroutine and a one-shot channel costs about **1 µs to spawn, 50 ns to deliver, 3 ns to poll cancellation**. Against an I/O call (network: 100 µs–10 ms; disk: 50 µs–10 ms), the overhead is in the noise. Against in-process CPU work (1–100 ns), the Future is a 1000x tax. **Futures pay for I/O, not for compute.**

### 2.2 Combinator costs

```
errgroup.WithContext + 8 g.Go + Wait    ~10 µs total fixed   (8 goroutines)
errgroup.SetLimit(64) + 1000 tasks      ~1 ms throughput floor (semaphore amortized)
singleflight.Do (no contention)         ~200 ns
singleflight.Do (1000 callers, 1 winner) ~500 ns/caller    (waiter wakeup amortized)
sync.WaitGroup Add/Done/Wait (4 g)      ~300 ns
```

`errgroup` adds ~1 µs per goroutine over raw `go`. `singleflight` is essentially free relative to the work it dedups.

### 2.3 The hidden cost — goroutine stack

| Goroutines | Resident memory (min) | Scheduler overhead |
|---|---|---|
| 1 000 | ~8 MB | imperceptible |
| 100 000 | ~250 MB | GC and scheduler still smooth |
| 1 000 000 | ~3 GB | GC pauses grow; scheduler latency visible |
| 10 000 000 | OOM territory | runtime degrades |

A Future-per-request pattern with 50 k req/s and 20 ms work creates ~1 000 concurrent Futures — fine. The same pattern with 20 ms x 1 M concurrent fan-out is OOM. **Concurrency is not free; it is cheap. Cheap is not free.** Section 9 makes this quantitative with Little's Law.

---

## 3. Structured concurrency — borrowing from Trio/Kotlin; errgroup as Go's answer

The textbook critique of futures: **unstructured concurrency leaks**. A goroutine spawned inside a function can outlive it. Trio (Python) and Kotlin coroutines formalized the answer — *structured concurrency*. Go's `errgroup` is the closest idiomatic match.

The principle: **every goroutine has a parent scope; the scope cannot return until every child has completed or been cancelled.** No goroutine outlives its lexical parent.

```go
func fanOutStructured(ctx context.Context, ids []string) ([]User, error) {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(32)
    out := make([]User, len(ids))
    for i, id := range ids {
        i, id := i, id
        g.Go(func() error {
            u, err := fetchUser(gctx, id); if err != nil { return err }
            out[i] = u; return nil
        })
    }
    if err := g.Wait(); err != nil { return nil, err }
    return out, nil
}
```

When `fanOutStructured` returns, every goroutine has finished or seen `gctx.Done()`. No leak by construction. The unstructured version with bare `go func()` writing to an unbuffered channel is correct only if the caller drains forever. **Structured concurrency is the default; unstructured is the optimization with a proof obligation.**

| Property | `errgroup` | Trio nursery | Kotlin coroutineScope |
|---|---|---|---|
| Parent waits for children | Yes (`Wait`) | Yes | Yes |
| First child error cancels siblings | Yes | Yes | Yes |
| Concurrency cap | `SetLimit` | `CapacityLimiter` | `Semaphore` |
| Panic propagation | No (recover yourself) | Yes | Yes |
| Nested scopes | Yes (nest `errgroup`) | Yes | Yes |

The one gap: Go does not propagate panics across goroutines. A child panic in an `errgroup.Go` crashes the *process* (panic in goroutine = `runtime.Goexit` + crash), unless the function itself recovers. This is intentional but surprising; §4 covers the recovery wrapper every production codebase needs.

---

## 4. Cancellation models — explicit ctx, deadline propagation, panic propagation

There are three sources of cancellation in a Future graph: the consumer gave up, a deadline elapsed, a sibling failed. All three must flow to the producer without coupling.

### 4.1 Explicit context

Every Future must accept `context.Context` and observe it on every blocking point. The contract:

| Producer responsibility | Consumer responsibility |
|---|---|
| Pass `ctx` to every downstream call | Provide `ctx` with appropriate deadline |
| Select on `ctx.Done()` in every wait | Cancel `ctx` when no longer needed |
| Return `ctx.Err()` on cancellation | Treat `ctx.Err()` as a non-retriable error |

A Future that ignores `ctx` is a goroutine leak waiting for a slow downstream. The canonical wrapper:

```go
func Go[T any](ctx context.Context, fn func(context.Context) (T, error)) *Future[T] {
    f := NewFuture[T]()
    go func() {
        defer func() {
            if r := recover(); r != nil {
                f.Reject(fmt.Errorf("panic: %v\n%s", r, debug.Stack()))
            }
        }()
        v, err := fn(ctx)
        if err != nil { f.Reject(err); return }
        f.Resolve(v)
    }()
    return f
}
```

Three loadbearing details: `ctx` is passed explicitly (no globals); panics are recovered and surfaced through `Reject` (so a panic does not crash the process and does not leak the awaiter); `defer recover` runs *before* `Resolve/Reject` so the future is always fulfilled exactly once.

### 4.2 Deadline propagation

A deadline must flow through every layer:

```go
func ServeOrder(ctx context.Context, id string) (*Order, error) {
    ctx, cancel := context.WithTimeout(ctx, 250*time.Millisecond)
    defer cancel()
    g, gctx := errgroup.WithContext(ctx)
    var (user User; items []Item; risk RiskScore)
    g.Go(func() error { var e error; user, e = userSvc.Get(gctx, id); return e })
    g.Go(func() error { var e error; items, e = inventorySvc.Items(gctx, id); return e })
    g.Go(func() error { var e error; risk, e = riskSvc.Score(gctx, id); return e })
    if err := g.Wait(); err != nil { return nil, err }
    return assemble(user, items, risk), nil
}
```

If `userSvc.Get` takes 200 ms, the other two see `gctx` deadline arrive at the same wall-clock instant, not 250 ms after *they* started. Deadlines are absolute (`time.Time`), not durations. `context.WithTimeout(parent, d)` uses the shorter of `parent.Deadline()` and `now+d` — never longer. A child cannot outlive its parent.

The opposite mistake: each layer adds its own timeout. A request with a 300 ms budget passing through three services each adding 250 ms expires the client first. **Compute remaining budget; never reset it:** `remaining := time.Until(parentDeadline); ctx, cancel := context.WithTimeout(ctx, remaining - margin)`.

### 4.3 Panic propagation

Go does not propagate panics across goroutines. A panic in `g.Go` either crashes the process or is silently lost, depending on the runtime version. Every production Future spawner must wrap its body in `recover` and convert the panic to an error. The `Go[T]` helper above does this; `errgroup` does *not*. Either wrap every `g.Go` or use a wrapper:

```go
func safeGo(g *errgroup.Group, fn func() error) {
    g.Go(func() (err error) {
        defer func() {
            if r := recover(); r != nil {
                err = fmt.Errorf("panic: %v\n%s", r, debug.Stack())
            }
        }()
        return fn()
    })
}
```

A team that does not wrap panics in goroutines has a process-crash bug per major version of their dependencies. Wrap once, in the project's `future` package.

---

## 5. Distributed Futures — pending requests across services, correlation IDs, durable promises

A Future inside one process is a channel. A Future *across* processes is a correlation problem. The pattern: client sends a request with `correlation_id`, server replies asynchronously, client matches reply to the pending Future.

### 5.1 Correlation IDs over async transports

```go
type Pending struct {
    mu      sync.Mutex
    futures map[string]*Future[Response]
}

func (p *Pending) Send(ctx context.Context, req Request) (*Future[Response], error) {
    cid := uuid.NewString()
    req.CorrelationID = cid
    f := NewFuture[Response]()
    p.mu.Lock(); p.futures[cid] = f; p.mu.Unlock()
    if err := p.transport.Publish(ctx, req); err != nil {
        p.mu.Lock(); delete(p.futures, cid); p.mu.Unlock()
        return nil, err
    }
    return f, nil
}

func (p *Pending) onReply(resp Response) {
    p.mu.Lock()
    f, ok := p.futures[resp.CorrelationID]
    delete(p.futures, resp.CorrelationID)
    p.mu.Unlock()
    if ok { f.Resolve(resp) }
}
```

Three pitfalls. **Memory leak under packet loss** — if the reply never arrives, the entry sits forever; attach a per-Future expiry that calls `Reject(ErrTimeout)` and removes the entry. **Replay attacks** — sign the correlation ID or include it in an authenticated envelope. **Process restart** — pending futures vanish; the caller sees an error; idempotent retry recovers, which means the protocol must be idempotent.

### 5.2 Durable promises — Temporal, durable execution

A pending Future across services is *not durable*. If the client dies, the Future is gone — even when the server completes. For multi-minute or multi-hour Futures, the answer is **durable execution**: Temporal, Cadence, AWS Step Functions. The handle is persisted; the awaiter can crash and resume.

```go
func OnboardCustomer(ctx workflow.Context, customerID string) error {
    var profile Profile
    if err := workflow.ExecuteActivity(ctx, ProvisionAccount, customerID).Get(ctx, &profile); err != nil { return err }
    // This Future survives worker crashes and host failures.
    return workflow.ExecuteActivity(ctx, SendWelcomeEmail, profile).Get(ctx, nil)
}
```

`f.Get(ctx, ...)` looks like `Await`, but workflow state is persisted to a datastore. If the worker dies between `ExecuteActivity` and `Get`, a new worker resumes from the last persisted step.

| Property | In-process Future | RPC | Temporal activity |
|---|---|---|---|
| Lifetime | Goroutine | TCP connection | Hours to days |
| Failure mode | Process restart loses state | Connection drop loses request | Survives worker/host/broker restarts |
| Latency floor | 50 ns | 100 µs | 1 ms (persistence) |
| Cancellation | `ctx.Done()` | Stream close | Workflow signal |

Decision: in-process Futures for sub-second work, RPC for inline request/response, Temporal for "might take an hour and must not be lost." Mixing the third with the first ("emit a job, poll on a goroutine") reinvents Temporal poorly.

---

## 6. Backpressure & flow control — semaphores, weighted, token bucket

A Future is a permission slip to spawn a goroutine. Unbounded permission slips destroy servers. Three primitives dominate.

### 6.1 Counting semaphore — `golang.org/x/sync/semaphore`

```go
sem := semaphore.NewWeighted(64)
g, gctx := errgroup.WithContext(ctx)
for _, item := range items {
    item := item
    if err := sem.Acquire(gctx, 1); err != nil { return err }
    g.Go(func() error {
        defer sem.Release(1)
        return process(gctx, item)
    })
}
return g.Wait()
```

`errgroup.SetLimit(64)` is the simpler form when every task has equal weight. The semaphore is for **weighted** work — a heavy task takes 4 slots, a light one takes 1. This is correct backpressure when downstream resource cost varies per request.

### 6.2 Token bucket — `golang.org/x/time/rate`

A semaphore caps *concurrency*. A token bucket caps *rate*.

```go
lim := rate.NewLimiter(rate.Limit(500), 100) // 500 ops/s, burst 100
for _, item := range items {
    if err := lim.Wait(ctx); err != nil { return err }
    go process(ctx, item)
}
```

`Wait` blocks until a token is available or `ctx` cancels. Use this for outbound API quotas (third-party limits), database connection conservation, and downstream protection. Pair with circuit breakers: when downstream returns 429, halve the limiter rate.

### 6.3 Bounded channel as a queue

`jobs := make(chan Job, 256)` plus `select { case jobs <- j: case <-ctx.Done(): }` is the smallest backpressure mechanism in Go: producers slow to consumer speed when the buffer fills. Pitfall: never close the channel from the producer side with multiple producers; close from a coordinator after `sync.WaitGroup.Wait`.

| Mechanism | Caps | Right for |
|---|---|---|
| `errgroup.SetLimit` | Concurrency | Equal-weight fan-out |
| `semaphore.Weighted` | Concurrent weight | Heterogeneous tasks |
| `rate.Limiter` | Rate (ops/s) | External quota, DB load |
| Bounded channel | Queue depth | Producer-consumer with multiple workers |

The pathology these all prevent: an HTTP handler that does `go expensiveBackgroundWork(req)` with no bound and no observability. A traffic spike spawns 100 k goroutines, each holding a 10 KB working set; the process OOMs in 30 s. **Every fan-out point needs a documented concurrency cap.**

---

## 7. Observability — OpenTelemetry tracing through Future graphs

A Future graph is a tree (the caller spawns N futures; each may spawn more). The tree is invisible at runtime unless you instrument it. Three observability layers cover the failure modes.

### 7.1 Traces

Every `Go` spawns a child span; every `Await` ends it. OpenTelemetry's `trace.Span` carries through `context.Context`, so the child sees the parent automatically:

```go
func tracedGo[T any](ctx context.Context, name string, fn func(context.Context) (T, error)) *Future[T] {
    ctx, span := tracer.Start(ctx, name)
    f := NewFuture[T]()
    go func() {
        defer span.End()
        defer func() {
            if r := recover(); r != nil {
                span.RecordError(fmt.Errorf("panic: %v", r))
                span.SetStatus(codes.Error, "panic")
                f.Reject(fmt.Errorf("panic: %v", r))
            }
        }()
        v, err := fn(ctx)
        if err != nil {
            span.RecordError(err)
            span.SetStatus(codes.Error, err.Error())
            f.Reject(err); return
        }
        f.Resolve(v)
    }()
    return f
}
```

A request that fans out to 8 backends produces a trace with 8 child spans; the slowest one is the request's critical path. Jaeger or Tempo show this as a gantt; the longest bar is the optimization target.

### 7.2 Metrics

| Metric | Type | Why |
|---|---|---|
| `future_inflight` | Gauge | Concurrent unresolved Futures by class |
| `future_duration_seconds` | Histogram | Latency by operation |
| `future_resolved_total{outcome}` | Counter | Success/error/cancelled counts |
| `future_queue_wait_seconds` | Histogram | Time blocked on semaphore before spawn |
| `future_panic_total` | Counter | Panics caught by the recover wrapper |

Queue wait is the signal that backpressure is biting: when `future_queue_wait_seconds.p99` climbs above the operation's own latency, the system is saturated.

### 7.3 Slow-Future detection

A logger that dumps stacks when in-flight count exceeds a threshold is the highest-leverage tool in this layer:

```go
go func() {
    t := time.NewTicker(30 * time.Second); defer t.Stop()
    for range t.C {
        if n := futureInflightCount.Load(); n > 10_000 {
            buf := make([]byte, 1<<20)
            runtime.Stack(buf, true)
            log.Warn("future_inflight", "n", n, "stacks", string(buf))
        }
    }
}()
```

This is the difference between "we have a leak somewhere" and "9 800 of 10 000 stacks are blocked on a chan recv in `productSvc.Lookup`."

---

## 8. Failure modes — goroutine leak inventory, double resolve, context lifecycle bugs

The Future implementations in the middle level were correct *under the assumption* that producers and consumers cooperate. Production breaks that assumption.

### 8.1 The goroutine leak inventory

| Leak | Cause | Detection | Fix |
|---|---|---|---|
| Awaiter gives up, producer blocks on send | Unbuffered chan, no `ctx.Done()` branch in producer | `runtime.NumGoroutine` climbs forever | Buffer size 1 *or* select on `ctx.Done()` |
| `time.After` in a loop | Each iteration starts a timer that lives until expiry | `pprof goroutine` shows blocked-on-timer | `time.NewTimer` + `Reset` |
| `context.WithCancel` without `defer cancel()` | Cancel goroutine never cleaned up | `vet` warns; runtime accumulates | Always `defer cancel()` |
| `errgroup.Wait` never called | Group goroutines never observed | Pending forever | Always pair `g.Go` with `g.Wait` |
| Producer panics; awaiter never notified | No `recover` in goroutine | Process crash or silent hang | Recover wrapper (§4.3) |
| Fan-out without bound | Spike spawns N=traffic goroutines | `goroutine` count tracks RPS | `SetLimit` or semaphore |

The first is the most common and most insidious. Reproduce:

```go
// BUG — producer leaks if consumer cancels
func leakyFetch(ctx context.Context, id string) <-chan User {
    ch := make(chan User)
    go func() {
        u := slowFetch(id) // ignores ctx
        ch <- u            // blocks forever if no reader
    }()
    return ch
}
```

If the caller does `select { case u := <-leakyFetch(ctx, id): ...; case <-ctx.Done(): }`, then on cancellation the goroutine sits in `ch <- u` forever. Fix:

```go
func fetch(ctx context.Context, id string) <-chan User {
    ch := make(chan User, 1)              // buffer 1 absorbs late send
    go func() {
        u, err := slowFetch(ctx, id)      // ctx threaded through
        if err == nil {
            select {
            case ch <- u:
            case <-ctx.Done():            // don't block on a dead reader
            }
        }
    }()
    return ch
}
```

### 8.2 Double resolve

A Future fulfilled twice loses the second value silently — or panics if it's a raw `close(ch)`. `sync.Once` is the minimum. The subtler variant: a race between `Resolve` (success) and `Reject` (cancellation). The loser's result is dropped, which is correct only if both branches are *idempotent*. A Future resolving to an open file handle that gets dropped on cancellation leaks the FD. **Wrap resource-holding Futures with close-on-discard logic**, or return a `Result[T, error]` with `Close()`.

### 8.3 Context lifecycle bugs

| Bug | Symptom |
|---|---|
| Storing `ctx` in a struct | The context outlives its scope; `go vet` warns; cancellation never propagates |
| `context.Background()` deep in a request | Request-scoped values lost; deadlines lost; logs missing correlation IDs |
| `context.WithValue` for non-request data | Type-unsafe; opaque; tests fail to provide the value |
| `ctx` shared across requests | One request's cancel kills another's work |
| `context.TODO()` shipped to production | "I'll fix this later" never gets fixed |

The rule: **`context.Context` is a function parameter, never a struct field; one context per goroutine tree; derived contexts never share parents across requests.** A linter (`contextcheck`) catches the worst offenders.

---

## 9. Concurrency limits — Little's Law applied to Future fan-out

Little's Law: `L = λ · W` (in-flight = arrival × latency). It applies *exactly* to Futures.

**Worked example.** A handler fans out to 5 backends at 50 ms mean, 2 000 req/s. `L = 2 000 × 5 × 0.050 = 500` mean concurrent Futures; with p99 = 200 ms tail, `L_p99 ≈ 2 000`. Set `errgroup.SetLimit` per request and a process-wide semaphore at ~2 000 plus headroom. At 50 k req/s, `L = 12 500` mean and `L_p99 = 50 000` tail — fine for goroutines, but downstream services must absorb the same fan-out.

**Server resource exhaustion.** 50 000 goroutines × 8 KB minimum stack = 400 MB. Each downstream connection takes an FD; default `nofile` = 1 024, so `ulimit -n 65536` is mandatory for any fan-out service.

| Failure | Trigger | Mitigation |
|---|---|---|
| OOM from goroutine stacks | Unbounded fan-out under spike | Per-handler + global cap |
| FD exhaustion | Many outbound connections | Connection pooling; raise `nofile` |
| Downstream collapse | Fan-out amplifies request count | Rate limiter + circuit breaker |
| GC pressure | Many small allocations per Future | `sync.Pool` on hot paths |
| Scheduler starvation | Tight CPU loops without yields | `runtime.Gosched()` or yielding I/O |

The rule: **every fan-out must be sized to the slowest downstream**. If `inventorySvc` p99 is 500 ms and you fan out 100 calls/req at 100 req/s, that's 5 000 in-flight to inventory. Does it have capacity? Check before you ship.

---

## 10. Security — auth context propagation, sandboxed execution, timeout enforcement

A Future inherits the caller's context, which includes its authorization. Three failure classes are common.

**Auth context loss.** A handler stuffs identity into `ctx`; downstream futures must see it. The bug: spawning a Future with `context.Background()` (to avoid cancellation when the request ends) loses identity, trace, and deadline. The fix: `context.WithoutCancel(ctx)` (Go 1.21+) preserves values while detaching the deadline. Never strip the context wholesale.

**Sandboxed execution.** A Future running user-supplied code needs hard resource limits — CPU, memory, wall-clock, FS, network. Go has no in-process sandbox.

| Sandbox | Isolation | Latency |
|---|---|---|
| `os/exec` subprocess | Process-level; OS RLIMIT | Fork ~1 ms |
| WASM (wazero, wasmtime-go) | In-process; no syscalls | ~10 µs invocation |
| gVisor / Firecracker | Kernel-level | 100 ms cold start |
| Lua / Starlark embed | Cooperative; trust interpreter | Microseconds |

For multi-tenant services, WASM is the modern answer: explicit memory cap, deadline, zero ambient permissions. Starlark is fine for "buggy customer code", not "hostile customer code".

**Timeout enforcement.** A Future without a deadline is a security issue — a slow downstream attacker holds resources indefinitely. Every external call gets a wall-clock budget (request budget minus elapsed minus margin). **A timeout is a security control, not just UX.** Handlers without a cap on customer-influenced calls are one slow-loris away from goroutine exhaustion.

---

## 11. Anti-patterns at scale

| Anti-pattern | Symptom | Fix |
|---|---|---|
| Future-per-sync-call | Goroutine spawn dwarfs the work | Inline; Futures for I/O only |
| `go expensiveWork()` in a handler | Goroutine count tracks RPS; OOM under spike | `errgroup` with `SetLimit` |
| Awaiter ignores `ctx`; producer ignores `ctx` | Cancellation does nothing; goroutines leak | `ctx` on both sides, observed at every blocking point |
| `Future` stored in a struct field | Same Future awaited by multiple goroutines; one wins, rest hang | One Future, one Await; or use `sync.Once` resolve + broadcast |
| `chan T` returned, no buffering, ctx ignored | Producer blocks forever if consumer gives up | Buffer 1, select on `ctx.Done()` in producer |
| `errgroup.Wait` discarded | First error lost; siblings still running | Always check `g.Wait()` |
| `context.Background()` inside a request | Auth, trace, deadline all lost | `context.WithoutCancel` if you must detach |
| `time.After` in tight loop | Timer leak per iteration | `time.NewTimer` + `Reset` |
| No `recover` in Future body | Panic crashes process | Wrapper that converts panic to error |
| Fan-out with no semaphore | Spike to OOM | `SetLimit` or weighted semaphore |
| Future-of-Future-of-Future chain | Latency stacks; debugging impossible | Flatten; one Future per logical step |
| Polling a Future from outside | Busy loop on `select` with `default` | Block on `Done()` or `Await(ctx)` |
| Synchronous-looking API hides goroutine | Caller has no way to cancel | Accept `ctx`; document goroutine lifecycle |
| Future for cross-host RPC | Crash loses pending work silently | Use durable execution (Temporal) for hour-scale work |
| Cancelling parent leaves children running | Children hold downstream resources after request abort | Always use `errgroup.WithContext` or derived ctx |
| Awaiting in shutdown without timeout | Graceful shutdown hangs forever | `context.WithTimeout` around `g.Wait()` |
| Future inside a hot loop | Microsecond work overwhelmed by goroutine spawn | Use a worker pool or batch |
| `singleflight` returning shared mutable | Two callers mutate the same value | Treat result as immutable; defensive copy |

The deepest anti-pattern: **using Futures as a default for asynchrony**. Many problems are sequential. A handler that does three things in order at 5 ms each does *not* benefit from three Futures; it pays goroutine overhead for nothing. **Futures are for overlap; sequential work is for sequential code.** The `g, gctx := errgroup.WithContext(ctx)` line is not free — it is a commitment that the work is parallelizable, the failures compose with first-error-cancels, and the result is worth the orchestration cost.

---

## 12. Closing principles

A Future is a *deferred value with a cancellation contract*. Honor both halves:

1. **The deferred value is exactly one outcome.** Not zero (use `chan struct{}`), not many (use a stream), not maybe. A Future that resolves twice, never, or to nothing is a bug. `sync.Once` guards the implementation; the signature `(T, error)` documents the contract.

2. **Cancellation is cooperative.** Go cannot preempt a goroutine. The producer must observe `ctx.Done()` at every blocking point. A Future that ignores cancellation is a leak waiting for a slow downstream. The smallest correct Future is `<-chan Result[T]` with `ctx` threaded through and a `Done()` branch on the producer's select.

3. **Structured concurrency is the default.** Every goroutine has a lexical parent. Use `errgroup.WithContext` and `Wait`; the parent does not return until every child has finished or cancelled. Unstructured concurrency carries a proof obligation: who owns the lifetime, and who cleans up. The proof must be written down.

4. **Concurrency is cheap, not free.** ~1 µs spawn + 8 KB stack per Future; 100 k concurrent is 800 MB. Every fan-out needs `SetLimit` or a semaphore sized to the slowest downstream. Little's Law: `L = λ · W` — measure both, pick a cap, alert when you approach it.

5. **Deadlines shrink; never grow.** A child context's deadline is the parent's minus headroom. Cross-service calls carry the deadline in headers (`grpc-timeout`); each hop subtracts overhead and refuses work that cannot fit.

6. **Recover panics in every Future spawner.** Go does not propagate panics across goroutines; unrecovered panic crashes the process. One `defer recover` wrapper, in the project's `future` package, used everywhere.

7. **Observability is non-optional.** OpenTelemetry spans across `ctx` make the graph a trace. Metrics on `future_inflight` and `future_duration_seconds` make it a dashboard. A slow-Future logger turns "we have a leak" into "the leak is in `productSvc.Lookup`."

8. **Distributed Futures are correlation problems.** Pending entries live in a `map[correlation_id]*Future` with expiry; without expiry, it leaks. For work that must survive restarts, use durable execution (Temporal), not in-process Futures.

9. **Security follows the context.** Auth, trace, deadline all live in `ctx`. Dropping the context (`context.Background()`) loses all three. Use `context.WithoutCancel` to detach lifetime while preserving values. Sandbox untrusted work in WASM or subprocesses.

10. **Futures are for I/O overlap.** Not a general-purpose primitive. Sequential CPU work runs faster sequentially. The `errgroup.WithContext` line is a commitment that work is parallelizable, failures compose, and the orchestration cost is worth paying.

Get these right and Futures are invisible: handlers fan out, traces show the critical path, lag stays bounded. Get them wrong and the on-call incident is 50 000 goroutines blocked on the same downstream, a context stored in a struct that was never cancelled, and a panic three deploys ago silently crashing one pod per hour. The Future is the easiest pattern to write; the hardest to operate.

---

## Further reading

- Nathaniel Smith, *Notes on structured concurrency, or: Go statement considered harmful*
- `golang.org/x/sync/errgroup` and `semaphore` source — 100 lines each
- Sameer Ajmani, *Go Concurrency Patterns: Pipelines and cancellation* — Go blog
- Bryan C. Mills, *Rethinking Classical Concurrency Patterns* — GopherCon 2018
- Roman Elizarov, *Structured concurrency* — Kotlin coroutines design notes
- Trio docs, *Structured Concurrency* — Python implementation and rationale
- Temporal, *Workflows and Activities* — durable execution model
- Russ Cox, *Go and Dogma* — `context.Context` design rationale
- `pprof` + `runtime/trace` — the only tools that show what your Future graph is doing
- Martin Kleppmann, *Designing Data-Intensive Applications*, chapter 8
- Tony Hoare, *Communicating Sequential Processes*

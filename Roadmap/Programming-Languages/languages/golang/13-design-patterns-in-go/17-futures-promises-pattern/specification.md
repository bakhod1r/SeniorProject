# Futures & Promises — Specification

## 1. Origins

The Future/Promise vocabulary predates Go by four decades and arrived through three independent research traditions: actor-model concurrency, lazy functional evaluation, and distributed-object middleware. Go's contribution is to provide the underlying mechanism — a one-shot channel — as a language primitive, and to leave the abstraction-naming to the application.

Historical milestones:

- **Baker and Hewitt, *The Incremental Garbage Collection of Processes* (MIT AI Memo 454, 1977)** — introduced the term **future** for a placeholder representing the result of a not-yet-completed actor computation. The paper framed concurrency as a graph of pending values whose collection is incremental; the future was both a synchronisation point and a garbage-collection root.
- **Friedman and Wise, *The Impact of Applicative Programming on Multiprocessing* (Indiana, 1976)** — independently coined **promise** for the lazy-evaluation counterpart: a thunk that, when forced, yields a value. The applicative-functional flavour of the term persisted in Scheme's `delay`/`force` pair.
- **Liskov and Shrira, *Promises: Linguistic Support for Efficient Asynchronous Procedure Calls* (PLDI, 1988)** — formalised promises as first-class values in the Argus distributed language; introduced *promise pipelining* (chaining calls on an unresolved promise across a network) which reduced round-trip latency from O(n) to O(1) for chained RPCs.
- **Multilisp (Halstead, 1985)** — added the `future` special form to Lisp; `(future e)` returned immediately with a placeholder that callers could touch to demand the value. Multilisp's scheduler is the conceptual ancestor of Go's runtime.
- **E language (Mark Miller, 1996)** — promise pipelining became central to capability-secure distributed computing; `eventually` operators (`<-` in E) deferred message sends until promise resolution.
- **Java `java.util.concurrent.Future` (Java 5, 2004)** — Doug Lea's `j.u.c` package brought blocking `get()` futures to the mainstream JVM ecosystem.
- **JavaScript Promises (2012)** — Promises/A+ specification; standardised as ES6 (2015) with `.then`/`.catch` chaining; `async/await` followed (ES2017) and became the de facto user-facing idiom.
- **Java `CompletableFuture` (Java 8, 2014)** — composable combinators (`thenApply`, `thenCompose`, `allOf`, `anyOf`); the design directly influenced later Future libraries in other languages.
- **Rust `async`/`await` (stable 2019)** — zero-cost futures driven by an external executor; the polling model contrasts with the eager-spawn model that Go inherits.

Go-specific history:

- **Channels (Go 1.0, 2012)** — the language shipped with one-shot and many-shot communication primitives. A `chan T` of capacity 1 receiving one value before being closed *is* a Future.
- **`context` package (Go 1.7, 2016; vendor preview 2014)** — formalised cancellation and deadlines, giving Futures a standard way to signal "stop waiting".
- **`golang.org/x/sync/errgroup` (2017)** — wraps `sync.WaitGroup` with first-error semantics and context cancellation; the canonical "Future of N parallel computations".
- **`golang.org/x/sync/singleflight` (2017)** — deduplicates concurrent calls; multiple callers share one Future.
- **Go 1.18 generics (2022)** — enabled `Future[T any]` and `Result[T any]` without `interface{}` boxing.

Go's distinctive stance is that the language refuses to add a `Future` type. The channel, the goroutine, `sync.Once`, and `context` are the components; the pattern is built from them as needed. Most production codebases never construct an explicit `Future` value at all — they pass channels. This is a deliberate trade-off: the language is leaner, but every team builds their own thin Future layer. The Promise/A+ / `CompletableFuture` / Rust `Future` worlds have richer standard libraries because their underlying execution model demands it; Go's goroutines-and-channels model is already the missing piece.

---

## 2. Go language mechanics

### 2.1 Channel as Future

A one-shot channel is the smallest Future in Go:

```go
func Async(work func() Result) <-chan Result {
    ch := make(chan Result, 1)
    go func() { ch <- work(); close(ch) }()
    return ch
}
```

The buffer of 1 lets the producer goroutine exit even if no one ever receives. The receive operation is the *await*. The return type `<-chan Result` is the Future's static type, and it cannot be sent into by the caller — the compiler enforces producer/consumer asymmetry. A channel-based Future has no `Resolve` method because resolution is just a channel send; the language primitive is the abstraction.

### 2.2 Goroutine as deferred computation

The unit of work behind a Future in Go is a goroutine, not a callback. The runtime scheduler multiplexes goroutines onto OS threads; the producer's body is ordinary sequential code with no `await` keyword. This is the Multilisp model — implicit suspension via the scheduler — adapted to a CSP-style channel send. Each goroutine carries roughly 2KB of initial stack, growing as needed; spawning a goroutine per Future is cheap enough to be unremarkable up to the tens of thousands of in-flight goroutines, but unbounded fan-out still costs and should be capped with `errgroup.SetLimit` or a semaphore.

### 2.3 `select` for await

`select` lets a consumer await *any* of several Futures and react to the first one ready:

```go
select {
case v := <-fa:
    use(v)
case err := <-fb:
    handle(err)
case <-ctx.Done():
    return ctx.Err()
}
```

`select` is the closest Go gets to JavaScript's `Promise.race` or Java's `CompletableFuture.anyOf` — except it composes with cancellation in the same construct. When multiple cases are ready simultaneously, `select` chooses one pseudo-randomly; the language deliberately refuses to expose ordering to prevent code that depends on scheduler accident.

### 2.4 `sync.Once` for single-fulfilment

The Promise invariant *resolved at most once* is enforced by `sync.Once`:

```go
func (p *Promise[T]) Resolve(v T) {
    p.once.Do(func() {
        p.val = v
        close(p.done)
    })
}
```

Without `sync.Once`, a second `close(p.done)` panics. `sync.Once` makes `Resolve` and `Reject` mutually exclusive and idempotent.

### 2.5 `context` for cancellation/deadline

`context.Context` is the standard cancellation carrier. A well-formed `Await` accepts a context:

```go
func (f *Future[T]) Await(ctx context.Context) (T, error) {
    select {
    case <-f.done:
        return f.val, f.err
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}
```

The producer goroutine must also observe `ctx.Done()` to avoid leaking when the consumer gives up. Context is the seam where cancellation, timeouts, and deadlines all meet the Future — a Future without a context-aware `Await` is unfit for production code that must shed load gracefully.

---

## 3. Canonical Go shapes

### 3.1 One-shot channel Future

```go
func FetchAsync(ctx context.Context, id string) <-chan Result[User] {
    out := make(chan Result[User], 1)
    go func() {
        u, err := fetchUser(ctx, id)
        out <- Result[User]{Value: u, Err: err}
        close(out)
    }()
    return out
}
```

The simplest shape. No struct, no methods, just a channel returned from a function. Use when the consumer reads exactly once. The trailing `close(out)` is optional for a single value — buffered channels do not require closure — but it lets the consumer use `for r := range out` syntax and gives explicit "no more values" semantics if the API later grows to support streaming.

### 3.2 `Result[T]` envelope

```go
type Result[T any] struct {
    Value T
    Err   error
}
```

A discriminated-union analogue for channels that must carry "value or error". Sent over a single channel of type `chan Result[T]`. Avoids the dual-channel `(chan T, chan error)` antipattern: with two channels, the consumer must `select` on both and race-handle the case where one channel fires before the other; with one channel of `Result[T]`, the consumer reads once and branches on `r.Err != nil`. The `Result` envelope is the Go counterpart to Rust's `Result<T, E>` and Haskell's `Either E T`.

### 3.3 `Future[T]` struct with `sync.Once`

The full reference shape (see `middle.md` §2): a struct holding `done chan struct{}`, value, error, and `sync.Once`. Methods `Resolve`, `Reject`, `Await(ctx)`, `Done()`. Use when the Future is passed around as a value, awaited from multiple call sites, or stored in a map.

```go
type Future[T any] struct {
    done chan struct{}
    val  T
    err  error
    once sync.Once
}
```

The `done` channel is `chan struct{}` (zero-cost signal), not `chan T` — the value lives in the struct field, not in the channel. This lets multiple awaiters read the resolved value without channel contention; only the close-and-broadcast of `done` is synchronised.

### 3.4 `errgroup`-driven fan-out

```go
g, gctx := errgroup.WithContext(ctx)
var a A; var b B
g.Go(func() error { var e error; a, e = fetchA(gctx); return e })
g.Go(func() error { var e error; b, e = fetchB(gctx); return e })
if err := g.Wait(); err != nil { return err }
```

A composite Future: many parallel computations, one combined await. First error cancels the rest. The `gctx` returned by `WithContext` is the cancellation channel shared by every spawned goroutine; the producers must observe it themselves or the cancellation is purely advisory. `SetLimit(n)` adds a bounded-concurrency policy on top of the fan-out, turning the group into a semaphore-gated worker pool.

### 3.5 `singleflight`-deduplicated Future

```go
var sf singleflight.Group
v, err, _ := sf.Do(key, func() (any, error) { return expensive(key) })
```

Multiple callers contending for the same key share one Future. The library returns the same `(value, error)` tuple to every caller in the flight window. The third return value (`shared bool`) tells the caller whether their result was deduplicated. `DoChan` returns a `<-chan Result` for non-blocking awaits; `Forget(key)` evicts in-flight entries early. The pattern is mandatory in front of any expensive cache miss path subject to stampedes.

---

## 4. Standard library use

### 4.1 `sync.WaitGroup` as nullary Future

`WaitGroup.Wait()` is `Future[struct{}].Await()` with no value channel — the Future resolves to *nothing*, but the resolution itself (all goroutines done) is the signal. It is the oldest Future in the standard library. `Add(1)` on a `WaitGroup` is the increment of a pending-count; `Done()` is the decrement; resolution happens when the count reaches zero. Each `Wait()` call after resolution returns immediately.

### 4.2 `sync.Once` as lazy-init Future

```go
var once sync.Once
var config *Config

func GetConfig() *Config {
    once.Do(loadConfig)
    return config
}
```

`sync.Once` resolves the value on first call, all subsequent calls observe the resolved state. This is a *lazy* Future bound to package state. Go 1.21 added `sync.OnceFunc`, `sync.OnceValue[T]`, and `sync.OnceValues[T1, T2]`, generic helpers that wrap the `Once`-plus-state idiom into a single-call constructor — the closest the standard library comes to shipping a lazy-Future type.

### 4.3 `context.Context.Done()` as "operation pending" Future

`ctx.Done()` is a Future that resolves to *cancellation*. The channel close is the resolution. Every `select { case <-ctx.Done(): }` is an awaiter. It is the most-used Future in the standard library; `context.Cause(ctx)` (Go 1.20+) provides the rejection's error in addition to the bare close.

### 4.4 `time.AfterFunc` returns a degenerate Future

```go
timer := time.AfterFunc(5*time.Second, func() { fmt.Println("fired") })
timer.Stop() // cancel before resolution
```

The `*Timer` is a Future whose resolution is the callback firing. `Stop()` is the cancellation. `Reset` re-arms — a feature most Futures do not have. `time.After(d)` returns the lower-level `<-chan Time` form, which is a Future-of-time-value rather than a callback-fired Future; they are duals of the same underlying timer wheel in the runtime.

### 4.5 `net/http` `Server.Shutdown` returns Future-like channel via cancel

`http.Server.Shutdown(ctx)` is a synchronous Future-await: it blocks until all in-flight requests complete or `ctx` is cancelled. The pattern `go srv.Shutdown(ctx); <-someChan` lets graceful shutdown overlap with other teardown — the call itself is an awaitable computation. The companion `RegisterOnShutdown(func())` lets the caller register handlers that run when the Future resolves, the closest the standard library comes to a `.then` callback.

---

## 5. Real library use

### 5.1 `golang.org/x/sync/errgroup`

The canonical "Future of N parallel computations". Wraps `sync.WaitGroup` with first-error semantics and context cancellation. `SetLimit(n)` (Go 1.20+) caps concurrency, turning the group into a bounded semaphore + waiter. Source is under 200 lines; reading it is the fastest way to internalise the Promise-as-struct shape. The library deliberately does not expose individual goroutine results — by design, you collect them through closures over enclosing variables, which keeps the API surface tiny and pushes typing to user code.

### 5.2 `golang.org/x/sync/singleflight`

Deduplicates concurrent invocations of the same key. Internally a map of in-flight `call` structs; each `call` is a Future shared by all duplicate callers. The library handles the goroutine, the value, the error, and the shared-or-not flag. Used in HTTP cache layers, RPC client memoization, and config reload guards. The Future's lifetime is "until the underlying call returns" — there is no explicit `Resolve`; the function's return value resolves the Future and removes the key from the map atomically.

### 5.3 `temporal.io/sdk-go` Activities (durable Future)

A Temporal Activity is a Future whose state survives process restarts. The worker calls `workflow.ExecuteActivity(ctx, ActivityFn, args).Get(ctx, &result)`. The `Get` is the Await; the Future's resolution is recorded in Temporal's event history. A worker crash mid-await resumes on another worker with the same Future. This is the Liskov-Shrira promise extended to durable history.

### 5.4 `grpc-go` bidirectional streams (Future-of-stream)

A gRPC unary RPC is a Future: `client.Method(ctx, req)` returns `(*Resp, error)` when the server completes. A bidirectional stream is a Future-of-stream: `stream, err := client.StreamingMethod(ctx)` resolves immediately with a stream handle, but each `Recv` is itself an await of the next message. The pattern combines one Future for connection establishment with many Futures for in-stream messages. The `context.Context` passed to the call controls every in-flight Future at once — cancelling the context terminates the stream and unblocks every pending `Recv` with `ctx.Err()`.

### 5.5 `sourcegraph/conc`

A structured-concurrency wrapper inspired by Trio (Python) and the Loom proposals (Java). Provides `conc.WaitGroup`, `pool.Pool`, `stream.Stream`, and `iter.Map` with panic-recovery, generic results, and ergonomic combinators. The library deliberately wraps the existing primitives rather than replacing them — `pool.NewWithResults[T]()` returns a Future-of-`[]T`. `WaitAndRecover` rethrows the first panic in the parent goroutine, closing the long-standing Go anti-pattern of silent goroutine panics that crash the process without context.

---

## 6. Formal specification

A Go Future/Promise system consists of:

| Element | Description |
|---------|-------------|
| **Future** | Receive-only handle to a value that will become available exactly once. In Go: `<-chan T`, `<-chan Result[T]`, or `*Future[T]`. |
| **Promise** | Producer-side handle on which `Resolve` or `Reject` is called exactly once. Often the same struct as the Future, viewed from the writer side. |
| **Resolve** | Operation that supplies the value and unblocks all current and future awaiters. |
| **Reject** | Operation that supplies an error in place of a value, with the same unblocking semantics. |
| **Await** | Consumer operation that blocks until the Future is resolved or the consumer's context is cancelled. |
| **Cancellation** | `context.Context` propagation that signals the producer to abandon its work and the consumer to stop awaiting. |
| **Producer goroutine** | The goroutine that performs the computation and calls `Resolve` or `Reject` exactly once on completion. |

**Invariants:**

1. **Single resolution.** `Resolve` or `Reject` is called at most once per Future. `sync.Once` is the standard enforcement. A second call is a no-op or, without the guard, a panic on double-close.
2. **Multiple awaits allowed.** Once resolved, the Future remains in the resolved state forever; any number of awaiters — sequential or concurrent — observe the same value or error. The closed `done` channel is the broadcast medium.
3. **Awaiter can give up; producer must observe `ctx`.** An `Await(ctx)` that returns `ctx.Err()` does not stop the producer. The producer goroutine must itself observe its own context to avoid leaking work after the consumer departs.
4. **Resolution publishes to all current and future awaiters.** A goroutine that starts awaiting after `Resolve` has been called still receives the resolved value — the closed `done` channel reads always succeed.
5. **After `ctx` cancellation, no further work guarantee.** Once the producer's context is cancelled, the Future's resolution may be `ctx.Err()`, a partial value, or no resolution at all. Consumers must treat post-cancellation values as untrusted unless the producer documents otherwise. The producer goroutine may still terminate gracefully and resolve normally if it had already crossed its commit point — cancellation requests, but does not coerce.

Together, these five invariants make the Future a one-way state machine with two terminal states (Resolved, Rejected) and one input (`ctx` cancellation). All correctness reasoning about Future code reduces to checking that these invariants are preserved across the boundaries the value crosses.

**Composition algebra:**

Futures compose under a small algebra that every team eventually re-implements:

- `All(f1, f2, ..., fN) -> Future[[]T]` — resolves when every Future resolves; rejects on the first rejection. `errgroup.Wait` is the rejection-first form; a `[]T`-collecting variant is one-liner over `errgroup` plus a result slice.
- `First(f1, f2, ..., fN) -> Future[T]` — resolves with the first successful resolution; cancels the rest. Useful for hedged requests and racing replicas.
- `Map(f, fn) -> Future[U]` — transforms the value lazily through `fn`. The new Future rejects if `f` rejects.
- `FlatMap(f, fn) -> Future[U]` — chains: `fn` returns a Future, the outer Future resolves when the inner one does. The monadic bind for Futures.
- `Timeout(f, d) -> Future[T]` — wraps `f` so resolution must arrive within `d` or the Future rejects with `context.DeadlineExceeded`.

Go ships none of these as a package; each is 5-15 lines of code over the `Future[T]` primitive. The `conc` library implements analogues for a subset.

**Lifecycle states:**

| State | Description | Transition |
|-------|-------------|------------|
| **Pending** | Initial state; producer goroutine running; `done` channel open. | Either producer succeeds (→ Resolved) or fails (→ Rejected). |
| **Resolved** | Terminal; value available; `done` channel closed. | None; the Future is immutable. |
| **Rejected** | Terminal; error available; `done` channel closed. | None; the Future is immutable. |

The awaiter side has its own orthogonal states (Waiting, Returned, Cancelled), but they do not affect the Future itself — only the awaiter's local goroutine. A cancelled awaiter does not transition the Future out of Pending; the producer remains responsible for that.

---

## 7. Anti-patterns

### 7.1 Unbuffered Future channel

```go
ch := make(chan Result) // unbuffered
go func() { ch <- compute() }() // blocks forever if no one receives
```

If the consumer never awaits, the producer leaks. The leak is invisible until production sees a memory growth pattern that matches request rate. **Fix:** `make(chan Result, 1)` so the producer can deposit and exit. The buffer of 1 is non-negotiable for one-shot Future channels.

### 7.2 Resolve from multiple goroutines without `sync.Once`

```go
go func() { close(f.done) }() // goroutine A
go func() { close(f.done) }() // goroutine B — panic: close of closed channel
```

Concurrent producers racing to resolve. **Fix:** wrap resolution in `sync.Once.Do`. The first caller wins; the second is silently dropped. The bug commonly arises when a Future is shared between a primary computation and a fallback timeout goroutine; without `Once`, the timeout firing simultaneously with the primary's success panics the whole process.

### 7.3 Future without context

```go
func Await() T { return <-f.done } // no way to give up
```

A blocked awaiter cannot be cancelled. If the producer dies silently, the awaiter blocks forever. **Fix:** `Await(ctx context.Context) (T, error)` with a `select` on `f.done` and `ctx.Done()`. Any new Future-shaped function added to a service must accept a `context.Context`; this rule has no production-grade exceptions.

### 7.4 Reading channel twice expecting block

```go
v1 := <-f.done // resolves, returns zero value of struct{}
v2 := <-f.done // immediately returns zero value, does NOT block
```

A closed channel returns the zero value forever. Code that treats the second read as still-pending will busy-loop or misroute. **Fix:** read once, store the resolution in a struct field, or read the value channel (which carries the actual `T`) rather than the `done` signal.

### 7.5 `errgroup` loop variable capture

```go
for _, item := range items { // pre-Go-1.22
    g.Go(func() error { return process(item) }) // every goroutine sees last item
}
```

The classic Go closure-over-loop-variable bug. **Fix:** `item := item` inside the loop, or upgrade to Go 1.22+ where loop variables are per-iteration. The bug is invisible in unit tests with one item but produces silently-correct-looking corruption in production with N items — every goroutine processes the same final element.

### 7.6 Synchronous work wrapped as Future

```go
func Get() <-chan Result {
    ch := make(chan Result, 1)
    ch <- compute() // runs on caller's goroutine; no concurrency
    return ch
}
```

The Future shape with no async benefit. The caller pays the latency cost as if they called `compute()` directly, but now their code reads as if it were async. **Fix:** either run the work in a goroutine, or drop the channel and return `(Result, error)` directly. Don't pretend — fake Futures mislead reviewers about where latency lives.

### 7.7 Returning concrete `chan T` to consumers (mutation risk)

```go
func Pending() chan Result { return f.done } // consumer can send/close
```

A bidirectional channel returned to the consumer lets them close it, send into it, and break the Future invariants. A misbehaving consumer can resolve another consumer's Future with garbage data, or panic the producer with a double-close. **Fix:** return `<-chan Result` (receive-only). The compiler then enforces the asymmetry; an attempted send or close fails to compile.

---

### 7.8 Mixing Future libraries in one codebase

A service that imports `conc`, hand-rolls a `Future[T]`, uses `errgroup` for fan-out, and wraps `singleflight` for caching has four overlapping idioms for "the same thing". Reviewers must context-switch between four mental models per request path. **Fix:** pick one shape per layer — channels at the package boundary, `errgroup` for fan-out, `singleflight` only where deduplication is required — and document the choice. Treat Future-flavoured library adoption as a one-way door.

---

## 8. Variants and dialects

| Variant | Description |
|---------|-------------|
| **Future channel** | One-shot value over a `<-chan T` (or `<-chan Result[T]`); the most idiomatic Go shape; no library required. |
| **Promise struct** | Producer/consumer wrapper exposing `Resolve`, `Reject`, `Await`, `Done`; used when the Future is stored or passed around as a value. |
| **Lazy Future** | Computation deferred until first `Await`; uses `sync.Once` to memoise. Suited for fallback chains and rarely-used caches. |
| **errgroup** | Many-to-one fan-out: N parallel Futures combined into one Await with first-error semantics; the canonical Go combinator. |
| **singleflight** | Deduplicated Future: concurrent callers for the same key share one in-flight computation; eliminates cache stampedes. |
| **Durable Future** | Resolution survives process restart; backed by event log (Temporal Activity, Cadence); the Liskov-Shrira model in modern infrastructure. |
| **Pipeline Future** | Streams of Future-of-T flowing between pipeline stages; the consumer awaits each Future individually so slow items do not block fast ones. |

---

## 9. Naming conventions

- **Types:** `Future[T]` for the consumer-facing handle, `Promise[T]` when distinguishing the producer side; `Result[T]` for the value-or-error envelope. Some codebases collapse them into one `Future[T]` exposing both `Resolve` and `Await`.
- **Resolution verbs:** `Resolve`/`Reject` mirrors JavaScript and is the most common Go choice; `Set`/`SetError` is a Java-influenced alternative; `Complete`/`CompleteWithError` follows Java's `CompletableFuture`. Use one trio consistently — do not mix.
- **Awaiting verbs:** `Await(ctx)` (Promise-style), `Wait()` (lifted from `sync.WaitGroup`), `Get(ctx)` (lifted from Java). `Await` is preferred in new code; `Get` reads ambiguously with property accessors.
- **Constructors:** `NewFuture[T]()` for the empty future to be resolved later; `NewPromise[T]()` when promise/future are distinct types; `Run[T](ctx, fn)` or `Go[T](ctx, fn)` for the eager "spawn-and-return-future" constructor.
- **Channels:** the resolution-signal channel is conventionally `done chan struct{}`; the value channel (if separate) is `result` or `out`. Never re-use `done` for value transport — it is the broadcast close signal.
- **Package layout:** small internal `future` package per service, exporting `Future[T]`, `Result[T]`, `All`, `First`, `Map`. Avoid pulling a heavy third-party Futures library when 80 lines of code in `internal/future/future.go` covers the needs.

---

## 10. Related patterns

| Pattern | Distinction |
|---------|-------------|
| **Observer (GoF)** | Many notifications over the object's lifetime; Future is exactly one resolution. Observers re-fire; Futures do not. |
| **Pub/Sub** | Topics carry an unbounded stream; Futures carry a single value. A Pub/Sub channel with capacity 1 closed after one send approximates a Future, but Pub/Sub is many-to-many and typically broker-mediated. |
| **Command (GoF)** | Encapsulates a deferred *action*; a Future encapsulates a deferred *result*. The two compose: a Command's execution returns a Future of its outcome. |
| **Iterator** | Yields a stream of values, one per call; a Future yields one value total. Channels can implement both — capacity ≥ 1 with multiple sends is an iterator; capacity 1 with one send is a Future. |
| **Saga** | A sequence of compensable steps; each step is naturally a Future whose rejection triggers compensation of prior steps. Futures are the building block; Saga is the protocol over them. |
| **Memoization** | Caches the result of an expensive computation; a `sync.Once`-backed lazy Future is the canonical thread-safe memoization in Go. |
| **Active Object** | A method call returns a Future and the work runs on an actor's owned goroutine; channels-plus-Future is Go's lightweight Active Object. |

---

**Observability and Futures.**

A Future is invisible to production debugging unless instrumented. The minimum useful telemetry:

- A counter `future_started_total{op}` incremented on producer goroutine spawn.
- A counter `future_resolved_total{op,outcome}` with `outcome` in `{success, error, cancelled}` incremented on resolution.
- A histogram `future_latency_seconds{op}` measuring producer-goroutine wall time from start to resolution.
- A gauge `futures_pending{op}` derived from the difference of the two counters; sustained growth indicates leaked producers.

Without these, a leaking producer goroutine surfaces only as gradual memory growth and an eventual OOM — the symptom is hours from the cause.

---

## 11. Further reading

- **Baker and Hewitt, *The Incremental Garbage Collection of Processes* (MIT AI Memo 454, 1977)** — the original future-as-actor-placeholder paper; introduced the term and the garbage-collection problem that followed from it.
- **Liskov and Shrira, *Promises: Linguistic Support for Efficient Asynchronous Procedure Calls* (PLDI, 1988)** — promise pipelining and the first-class-promise design that influenced E, Cap'n Proto, and modern distributed actor frameworks.
- **Halstead, *Multilisp: A Language for Concurrent Symbolic Computation* (TOPLAS, 1985)** — the `future` special form and its scheduling discipline; the spiritual ancestor of Go's goroutine-plus-channel model.
- **Sameer Ajmani, *Go Concurrency Patterns: Pipelines and Cancellation* (Go blog, 2014)** — the canonical Go-blog text on channel pipelines, cancellation, and the pattern that became `context`. Required reading before designing any non-trivial Future API.
- **`golang.org/x/sync/errgroup` and `golang.org/x/sync/singleflight` source** — both packages fit on one screen each and are the best teaching reference for production-grade Future code in Go.
- **Temporal activity documentation (`docs.temporal.io`)** — durable Futures, replay semantics, and the activity lifecycle; the closest thing to Liskov-Shrira promises in modern infrastructure.
- **Sergio Stuto, *Cancel propagation in Go* (design talk)** — practical patterns for threading context through Future-shaped APIs without leaking goroutines.
- **`sourcegraph/conc` README and design doc** — argues for structured concurrency in Go and demonstrates Future-flavoured combinators built on top of stdlib primitives.

**On choosing the right shape.** Reach for a bare `<-chan Result[T]` first; promote to a `Future[T]` struct only when the value must be passed around, awaited from multiple sites, or composed with siblings. Reach for `errgroup` when work is parallel and the failure mode is "first error wins"; reach for `singleflight` when many callers want the same expensive value at the same time. Reach for `conc` or a hand-rolled `Future[T]` only when the stdlib primitives leave specific gaps — panic recovery, typed result collection, structured cancellation — that you cannot fill cleanly in user code. The pattern is small; the discipline of choosing the smallest shape that fits is what distinguishes senior from intermediate Go engineers.

A Future in Go is a one-shot channel plus discipline around cancellation. Senior skill is recognising that the right primitive is usually a channel, not a Future library.

The senior calculus for any Future-shaped problem in Go:

1. Can this be a return value? If yes, do not use a Future.
2. Can this be a `<-chan Result[T]`? If yes, use it; do not introduce a struct.
3. Is fan-out involved? Reach for `errgroup`.
4. Is deduplication involved? Reach for `singleflight`.
5. Otherwise, hand-roll a 30-line `Future[T]` in `internal/future`.

Steps 1-4 cover the vast majority of production paths. Step 5 is the escape hatch for the cases where structural concurrency or callable resolution genuinely earns its complexity.

---

## 12. Glossary

| Term | Meaning |
|------|---------|
| **Future** | Receive-only handle to a value that will become available exactly once; in Go, typically `<-chan T` or `*Future[T]`. |
| **Promise** | Producer-side handle on which `Resolve` or `Reject` is called once; often the same struct as the Future viewed from the writer side. |
| **Resolve / Reject** | Operations that supply the value or error to a Promise; together they constitute the single fulfilment of the Future. |
| **Await** | Consumer operation that blocks until the Future is resolved or the context is cancelled; returns `(T, error)`. |
| **Eager** | The Future's producer goroutine starts at construction time; work proceeds whether or not anyone awaits. |
| **Lazy** | The producer runs only when `Await` is first called; subsequent calls memoise via `sync.Once`. |
| **Combinator** | A function that builds a new Future from existing ones — `All` (wait for every Future), `First` (wait for the first to resolve), `Map` (transform the resolved value). |
| **errgroup** | `golang.org/x/sync/errgroup` package; runs N goroutines under a shared context with first-error semantics. |
| **singleflight** | `golang.org/x/sync/singleflight` package; deduplicates concurrent calls for the same key, sharing one Future. |
| **Cancellation** | Signal that the awaiter no longer wants the result and/or the producer should stop work; carried by `context.Context.Done()`. |
| **Deadline** | An absolute time after which a Future's context is considered cancelled; produced by `context.WithDeadline` or `context.WithTimeout`. |
| **Structured concurrency** | Discipline that ties goroutine lifetimes to lexical scopes; in Go, achieved with `errgroup`, `conc`, or careful manual context propagation. |
| **Promise pipelining** | Sending a method call to an unresolved promise so the call executes on the resolver's host without an extra round-trip; originated in Argus, central to Cap'n Proto and E. Rare in Go because cross-process Futures are typically gRPC calls. |
| **Pollable Future** | Awaiter-driven future model (Rust); the awaiter calls `poll` repeatedly until ready. Contrasts with Go's push-driven model where the producer signals readiness. |
| **Hot vs cold** | A *hot* Future has its work already running (Go's default); a *cold* Future starts work on first await (lazy Future). |

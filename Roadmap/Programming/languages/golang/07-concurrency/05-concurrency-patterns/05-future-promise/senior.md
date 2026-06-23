# Future / Promise Pattern — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Design Judgement: When NOT to Use a Future](#design-judgement-when-not-to-use-a-future)
3. [Eager vs Deferred Promises](#eager-vs-deferred-promises)
4. [Memoization Done Right](#memoization-done-right)
5. [Cross-Language Comparison](#cross-language-comparison)
6. [Why Go Did Not Add `async`/`await`](#why-go-did-not-add-asyncawait)
7. [Memory Model and Happens-Before](#memory-model-and-happens-before)
8. [Library Design: Returning Futures From APIs](#library-design-returning-futures-from-apis)
9. [Request Hedging and Speculative Execution](#request-hedging-and-speculative-execution)
10. [Stampede Control with `singleflight`](#stampede-control-with-singleflight)
11. [Observability for Futures](#observability-for-futures)
12. [Production Failure Modes](#production-failure-modes)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

At the senior level a future is not a code snippet but a design choice. The questions you answer are:

- Should this API return a future at all, or should the caller spawn the goroutine themselves?
- Eager or deferred? Memoized or single-shot?
- How do I cancel a fan-out without leaking workers?
- When my service has 50,000 in-flight futures, how do I observe them?
- What changes when the future crosses a process boundary (RPC, queue)?

This file assumes fluency with the middle-level material: generic `Future[T]`, ctx propagation, `errgroup`, `AwaitAll`/`AwaitAny`. The new content is comparison with other languages, the rationale for Go's design, and production patterns.

---

## Design Judgement: When NOT to Use a Future

A future imposes complexity. Use it only when it earns its keep.

**Do not use a future when:**

- The work is synchronous and fast (under a millisecond). The overhead — channel allocation, goroutine startup, ctx checks — exceeds the work.
- You have many pieces of independent work and a single "all or nothing" outcome. Use `errgroup`. The `Future[T]` abstraction adds an unnecessary handle.
- The result of "the work" is a *stream* of values. Use a channel. A future is one-shot by definition.
- The caller can express the same concurrency directly with `go f()` and a WaitGroup. Don't dress up clarity in a generic wrapper.

**Use a future when:**

- The function spans an API boundary and the caller wants a *handle to a result* rather than a callback.
- The result will be passed around — to a downstream function, into a `Map`/`FlatMap` chain, or stored in a registry.
- You need pluggable composition: hedging, racing, mapping. The combinators take futures as arguments.
- You are coalescing concurrent identical requests (memoized future / singleflight).

In a 100,000-line Go codebase I expect to find `errgroup` in many places and an explicit `Future[T]` in only a few — at module boundaries where the handle is the API.

---

## Eager vs Deferred Promises

In JavaScript, a `Promise` starts executing the instant it is constructed. That is **eager**. In Scala or Haskell, you can build a *deferred* computation: the work does not start until someone awaits.

Go's canonical pattern is eager: `New(ctx, fn)` starts the goroutine immediately. A deferred version looks like:

```go
type Lazy[T any] struct {
    fn   func(context.Context) (T, error)
    once sync.Once
    val  T
    err  error
    done chan struct{}
}

func NewLazy[T any](fn func(context.Context) (T, error)) *Lazy[T] {
    return &Lazy[T]{fn: fn, done: make(chan struct{})}
}

func (l *Lazy[T]) Await(ctx context.Context) (T, error) {
    l.once.Do(func() {
        l.val, l.err = l.fn(ctx)
        close(l.done)
    })
    select {
    case <-l.done:
        return l.val, l.err
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}
```

Notice the `once.Do` *runs synchronously on the first caller's goroutine*. The first awaiter pays the latency; subsequent awaiters get the cached value.

When is deferred useful?

- **Optional dependencies.** You may not need this value. Don't compute it speculatively.
- **Caches keyed by something.** Build a `map[K]*Lazy[V]` and let access trigger computation.
- **Initialisation graphs.** Want N values, but only those you actually read should be computed.

When is deferred wrong?

- You wanted the concurrency. If both this future and the caller's other work are blocking on the same `Await`, you got nothing in parallel.
- The caller has to remember that "calling `Await` may block for a long time". With eager, only the first `Await` could ever block past the work's natural duration.

Most Go futures are eager. Lazy is a specialised tool. If you find yourself reaching for it often, consider whether a plain function `func()(T,error)` plus memoization would serve you better.

---

## Memoization Done Right

The middle-level memoized future was:

```go
type Memo[T any] struct {
    once sync.Once
    val  T
    err  error
    done chan struct{}
}
```

Three refinements at this level.

### Refinement 1: ctx affects only `Await`, never the cached value

```go
func (m *Memo[T]) Await(ctx context.Context) (T, error) {
    select {
    case <-m.done:
        return m.val, m.err
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}
```

If the *first* caller cancels their context, do we cancel the work? Two policies:

- **Policy A:** No. The work runs with `context.Background()` or with a *combined* context derived from all current awaiters. The cached value is for everyone.
- **Policy B:** Yes. If the first caller bails out, the work cancels and the next caller restarts it.

Policy A is the safe default. Policy B is right when the work has no value once the original caller leaves (a per-request memoization). `singleflight.Group` uses something close to Policy A (the work continues until done, even if all callers leave).

### Refinement 2: Negative caching

If the work fails, should the next caller retry, or get the cached error?

Caching errors is *negative caching*. It is correct for some kinds of error (permanent: 404, "not found") and wrong for others (transient: timeout, network glitch). A future with no error-aware caching policy is naive. Two options:

- Wrap each memo with a TTL and re-run after expiry.
- Re-run on classified error types (`net.OpError`, `context.DeadlineExceeded`) but cache permanent errors.

```go
type ResettableMemo[T any] struct {
    mu       sync.Mutex
    inflight *Memo[T]
    cachedAt time.Time
    ttl      time.Duration
    fn       func(context.Context) (T, error)
}
```

This is getting close to a small cache library — at which point you should consider `github.com/dgraph-io/ristretto`, `github.com/hashicorp/golang-lru/v2`, or your own LRU.

### Refinement 3: Refcounting awaiters

For Policy B (cancel when all awaiters leave), you need to know how many awaiters are present. A small refcount plus `context.WithCancel`:

```go
type RefcountedMemo[T any] struct {
    mu      sync.Mutex
    n       int
    cancel  context.CancelFunc
    val     T
    err     error
    done    chan struct{}
}

func (m *RefcountedMemo[T]) Await(ctx context.Context) (T, error) {
    m.mu.Lock()
    if m.done == nil {
        m.done = make(chan struct{})
        workCtx, cancel := context.WithCancel(context.Background())
        m.cancel = cancel
        go func() {
            m.val, m.err = m.fn(workCtx)
            close(m.done)
        }()
    }
    m.n++
    m.mu.Unlock()

    defer func() {
        m.mu.Lock()
        m.n--
        if m.n == 0 {
            select {
            case <-m.done:
                // already finished
            default:
                m.cancel()
            }
        }
        m.mu.Unlock()
    }()

    select {
    case <-m.done:
        return m.val, m.err
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}
```

You rarely need this. It is here because seniors get asked about it.

---

## Cross-Language Comparison

Understanding what other languages do helps you see what Go chose *not* to do.

### JavaScript Promises

```js
const p = fetch(url);
p.then(r => r.json())
 .then(data => render(data))
 .catch(err => handle(err));

// async/await sugar:
async function load() {
    const r = await fetch(url);
    return r.json();
}
```

Properties:
- Eager. Construction starts work.
- Built-in `.then` for `Map`, `.then(asyncFn)` for `FlatMap`.
- Built-in `Promise.all` (= `AwaitAll`), `Promise.race` (= `AwaitAny`), `Promise.allSettled` (= `AwaitAllResults`).
- Errors propagate as rejected promises.
- No cancellation. The 2018 addition of `AbortController` provides external cancellation by convention, not by language.
- Single-threaded — promises do not give parallelism, only concurrency over I/O.

### Java `CompletableFuture`

```java
CompletableFuture<User> userFut = CompletableFuture.supplyAsync(() -> loadUser(42));
CompletableFuture<String> nameFut = userFut.thenApply(User::getName);
String name = nameFut.get();
```

Properties:
- Eager (`supplyAsync`) or deferred (`completedFuture`).
- Composition via `thenApply` (= map), `thenCompose` (= flatMap), `thenCombine` (= zip).
- `allOf(...)`, `anyOf(...)` for combinators.
- Backed by an `Executor` (thread pool). You choose the executor; many APIs default to `ForkJoinPool.commonPool()`, which is shared and easy to starve.
- Cancellation via `future.cancel(mayInterrupt)` — but cancellation is *cooperative* and famously hard to do right with blocking I/O.
- Errors via `CompletionException` wrapping.

### Rust `Future`

```rust
async fn load_user(id: u64) -> Result<User, Error> {
    let user = client.get(format!("/users/{}", id)).await?;
    Ok(user)
}
```

Properties:
- *Deferred by default*. An `async fn` returns a `Future` that has not started running. You must `.await` it or hand it to an executor (tokio, async-std).
- Zero-cost: futures compile to state machines, not heap-allocated objects.
- Cancellation by *dropping*. If you drop a future before awaiting it to completion, the work stops at the next await point.
- Errors via `Result<T, E>` inside the future. Just `?` it.
- Single-threaded by default (`tokio::spawn` for parallelism, with `Send` constraints).
- Pin and lifetimes are part of the API. Steep learning curve.

### C++ `std::future`

```cpp
std::future<int> fut = std::async(std::launch::async, []{ return compute(); });
int v = fut.get();
```

Properties:
- Eager (`std::launch::async`) or deferred (`std::launch::deferred`, runs on `get()`).
- `std::future` is non-copyable, single-consumer.
- `std::shared_future` for multi-consumer.
- No composition in the standard. `std::future::then` was proposed (`std::experimental::future`) but never merged.
- No cancellation.
- The C++ ecosystem moved on to `std::expected`, coroutines (`co_await`), and external libraries (Boost.Future, folly::Future).

### Comparison summary

| Language | Eager | Composition | Cancellation | Multi-consumer |
|----------|-------|-------------|--------------|----------------|
| JS Promise | yes | `.then`, `Promise.all/race` | AbortController (manual) | n/a (single-thread) |
| Java `CompletableFuture` | yes | rich | cooperative | yes |
| Rust `Future` | no (deferred) | `.await`, `join!`, `select!` | drop | shared via `Rc`/`Arc` |
| C++ `std::future` | yes | none in std | no | `shared_future` |
| Go `<-chan T` | yes (by convention) | hand-rolled | ctx | memoizing future |

Go is the only one where the future is *not a language feature*. It is a *pattern* using two primitives. The cost: a little more boilerplate. The benefit: no colored functions, no special compiler support, no executor model to choose, no Pin/Lifetimes.

---

## Why Go Did Not Add `async`/`await`

The Go authors looked at async/await and chose not to add it. The reasoning, summarised from Russ Cox, Rob Pike, and Brad Fitzpatrick's various talks and posts:

1. **No function coloring.** In JavaScript or Rust, an `async` function can only be called from another `async` function (or with special ceremony). The codebase splits into two colors. A sync function cannot use an async library cleanly. Go has no such split: every function can block (it just yields its goroutine), and every function can spawn (`go f()`).

2. **Channels are general; futures are a special case.** A `<-chan T` can be one-shot (a future), can stream (a pipeline), can be unbuffered (a rendezvous), or can be `select`ed against. A built-in `Future` type would be a strict subset of what channels already do.

3. **Cancellation already exists.** `context.Context` is the language-blessed cancellation. Adding a `Future` type would either reinvent ctx or be a worse second mechanism alongside it.

4. **Less ceremony, more goroutines.** Goroutines start cheap. Spawning one for a future is no different from spawning one for a worker, a server handler, or a watcher. The same primitive handles all four.

5. **The pattern is short.** Five lines. Adding a keyword for a five-line pattern is unattractive when the language already prizes minimalism.

The trade-off: pattern boilerplate at every call site. Go programmers write `make(chan Result[T], 1); go func() { ... }()` over and over. Some build a `Future[T]` library to dry it up; many do not. The community has tolerated the boilerplate for two reasons: (a) it is shallow — once you understand it, you stop thinking about it; (b) the no-colored-functions property is genuinely valuable for refactoring large codebases.

Reasonable people disagree. Some experienced Go programmers wish for `await`. The official position is that channels plus ctx are enough.

---

## Memory Model and Happens-Before

The Go memory model guarantees: *the send of a value on a channel happens-before the corresponding receive completes*. For a future, that means:

```go
go func() {
    x = 42         // write
    ch <- result   // send (happens-before receive)
}()
v := <-ch          // receive
use(x)             // sees x == 42 — guaranteed
```

The `<-ch` synchronizes with the `ch <-`. Everything the producer wrote before the send is visible to the consumer after the receive. This is the rule that lets you return arbitrary structs from a future without explicit locking.

A subtlety: if the result struct itself contains a pointer to a mutable object, the *pointer* is visible but writes to the *object* via another path are not synchronized. Don't write to shared state from inside a future and assume the await synchronizes it.

For memoized futures using `close(done)`, the rule is: *the close of a channel happens-before any receive that returns because the channel is closed*. Same outcome: writes before `close(done)` are visible after `<-done`.

---

## Library Design: Returning Futures From APIs

If your library exposes a future, the API contract is harder than it looks. Consider an HTTP client:

```go
// Bad: leaks if caller drops fut and ctx
func (c *Client) GetAsync(ctx context.Context, url string) *Future[Response] {
    return future.New(ctx, func(ctx context.Context) (Response, error) {
        return c.Get(ctx, url)
    })
}
```

Three failure modes for the caller:

1. They forget to await — but the work runs anyway, consuming resources.
2. They await with `context.Background()` — the future cannot be cancelled.
3. They share the future across goroutines — the second reader blocks forever (you returned a single-shot future).

Make the contract explicit in the doc comment:

```go
// GetAsync starts an HTTP GET concurrently and returns a Future for the result.
// The future is single-use: only one Await call will return the value; subsequent
// awaits block forever. The work honours ctx: cancelling ctx aborts the request.
// If you abandon the future without awaiting it, the request still runs to
// completion (or until ctx is cancelled).
```

A safer API often returns a *function* or accepts a callback instead of a future:

```go
func (c *Client) Get(ctx context.Context, url string) (Response, error)
```

Plain synchronous. If the caller wants concurrency, they wrap it. That puts the decision at the call site, where context is richer.

Reserve future-returning APIs for cases where the handle itself is the product: composable libraries, batch builders, future-graph orchestrators.

---

## Request Hedging and Speculative Execution

A common production use of futures: hedging. Send the same request to two backends; take whichever answers first.

```go
func Hedge[T any](
    parent context.Context,
    delay time.Duration,
    mk func(context.Context) (T, error),
) (T, error) {
    ctx, cancel := context.WithCancel(parent)
    defer cancel()

    type r struct {
        v   T
        err error
    }
    out := make(chan r, 2)

    go func() {
        v, err := mk(ctx)
        out <- r{v, err}
    }()

    select {
    case x := <-out:
        if x.err == nil {
            return x.v, nil
        }
        // first request failed; fall through to hedge
    case <-time.After(delay):
        // first request slow; start the hedge
        go func() {
            v, err := mk(ctx)
            out <- r{v, err}
        }()
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }

    select {
    case x := <-out:
        return x.v, x.err
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}
```

The first request fires immediately. If it does not return within `delay`, a second request fires. Whichever completes first wins; the other is cancelled via `defer cancel()`.

Tuning `delay`: set it near the **p95 latency**. The first request usually finishes before `delay`; the hedge only fires for the slow 5%. The cost is at most double the request volume for tail traffic.

This pattern is widely used in Google's RPC stacks. The paper "The Tail at Scale" by Dean and Barroso documents the impact: hedging at p95 with a 5% extra load can cut p99 latency by 40% or more.

---

## Stampede Control with `singleflight`

If a thousand goroutines all try to load the same key from the database at once, you get a thundering herd. `golang.org/x/sync/singleflight` solves this with memoized futures keyed by string:

```go
var g singleflight.Group

func loadUser(ctx context.Context, id string) (User, error) {
    v, err, _ := g.Do(id, func() (interface{}, error) {
        return db.LoadUser(ctx, id)
    })
    if err != nil {
        return User{}, err
    }
    return v.(User), nil
}
```

`Do(key, fn)` is essentially: "if another goroutine is currently running `fn` for this key, wait for that result and return it; otherwise run `fn`."

Internally, `singleflight` keeps a `map[string]*call` where each `call` is a memoized future. The first caller installs a new entry and runs the work; subsequent callers find the entry and wait on the same `done` channel.

Use cases:
- Cache-miss handlers: only one query per missing key.
- Token refresh: only one refresh per token.
- Configuration loading: only one fetch per config version.

Caveat: `singleflight` is *one-shot per key per stampede*. After the first request completes, the next request for the same key runs again. If you want longer-lived caching, layer it (singleflight in front of a cache).

There is also `singleflight.Group.DoChan` which returns a channel of `Result` — this *is* a future, by name, from the standard library extension.

---

## Observability for Futures

50,000 in-flight futures in production. What metrics do you want?

**Counts:**
- futures created (gauge or counter)
- futures completed (counter, labelled by success/failure)
- futures cancelled
- futures abandoned (created but never awaited)

**Latency:**
- creation-to-fulfilment (histogram)
- creation-to-await (histogram)

**Resource:**
- live goroutines from this subsystem (`runtime.NumGoroutine` deltas, or `expvar`)

Implementing this without rewriting every future call site is the challenge. One approach: wrap `future.New` in your package and instrument the wrapper:

```go
func instrumentedNew[T any](
    ctx context.Context,
    name string,
    fn func(context.Context) (T, error),
) *Future[T] {
    futureCreated.WithLabelValues(name).Inc()
    start := time.Now()
    return future.New(ctx, func(ctx context.Context) (T, error) {
        v, err := fn(ctx)
        futureCompleted.WithLabelValues(name, status(err)).Inc()
        futureLatency.WithLabelValues(name).Observe(time.Since(start).Seconds())
        return v, err
    })
}
```

For abandoned-future detection, you need a finalizer or a tracking registry. `runtime.SetFinalizer(fut, func(*Future[T]) { abandonedCount.Inc() })` works but adds GC pressure. Most teams skip this and rely on `goleak` in tests.

---

## Production Failure Modes

Five things that have actually gone wrong in production, and how to spot them.

1. **Goroutine count climbs unboundedly.** Causes: futures spawned in a hot loop without bounds; futures whose work never honours ctx and never finishes. Mitigation: bounded concurrency (worker pool), `goleak` in tests.

2. **CPU spikes during fan-out.** Causes: too many concurrent futures saturating CPUs with GC. Mitigation: bound concurrency to `GOMAXPROCS * k` for some small `k`.

3. **Cancellation that does not propagate.** Causes: a future stack where one intermediate layer used `context.Background()`. Mitigation: lint rule that forbids `context.Background()` outside main and top-level handlers.

4. **Memo cache leaks.** Causes: keyed memo that grows without bound (e.g. user IDs). Mitigation: LRU eviction, TTL, or `sync.Map` with periodic clear.

5. **Hedging with a too-low delay.** Causes: `delay` shorter than p50, doubling load. Mitigation: measure p95 and use that.

Each failure mode has a metric that catches it early. Wire them.

---

## Cheat Sheet

```
WHEN TO RETURN A FUTURE FROM AN API
    only when the handle itself is the product:
    composable libraries, batch builders, future graphs.
    otherwise return (T, error) and let caller wrap.

EAGER VS DEFERRED
    default to eager (canonical pattern)
    use deferred only for optional/cached dependencies

MEMOIZED FUTURE
    sync.Once + close(done channel)
    multi-reader without re-running work

HEDGING
    delay ~ p95
    derived ctx so loser cancels

SINGLEFLIGHT
    deduplicate concurrent identical requests
    layer over cache for long-lived dedup

OBSERVABILITY
    counter: created / completed / cancelled / abandoned
    histogram: create-to-fulfil, create-to-await
    goleak in tests, expvar in prod

GO VS OTHERS
    no language-level future; channels + ctx are the building blocks
    no async/await; no function colours
    explicit goroutine spawn at every site
```

---

## Summary

At the senior level the future stops being a coding pattern and becomes a design choice. The decision tree:

- Synchronous, short work? Just call the function.
- Fan-shaped, all-or-nothing? `errgroup`.
- Handle that must be passed around? `Future[T]`.
- Multi-consumer of one computation? Memoized future.
- Concurrent identical requests? `singleflight`.
- Tail-latency critical? Hedging.

The cross-language perspective matters: Go's "no built-in future" position is intentional. Goroutines, channels, and `context.Context` together cover the same ground without function coloring or executor models. The cost is a small amount of boilerplate at each call site; the benefit is that ordinary code remains ordinary.

Production future systems live or die on observability. Wire counters, histograms, and goleak. The five common failure modes (leak, CPU spike, broken ctx propagation, memo growth, mis-tuned hedge) all show up in dashboards before they show up in incidents — if you instrument them.

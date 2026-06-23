# Future / Promise Pattern — Interview Q&A

A graded set of questions from junior screen through staff. Each comes with a model answer and follow-up cues.

---

## Junior

### Q1. What is a future in Go?

A future is a placeholder for a value that will be produced concurrently. In Go, a future is conventionally a function that starts a goroutine and returns a receive-only channel `<-chan T` (or `<-chan Result[T]`). The caller awaits the result with `<-fut`.

Go has no built-in `future` or `promise` type. The pattern is assembled from a goroutine plus a buffered channel of capacity one.

**Follow-up:** Why capacity one?

Because the producer must be able to write its result and exit without waiting for a reader. If the channel were unbuffered and the caller never read, the producer would block forever — a goroutine leak.

---

### Q2. Write a function `Square(n int) <-chan int` that computes n*n asynchronously.

```go
func Square(n int) <-chan int {
    out := make(chan int, 1)
    go func() {
        out <- n * n
    }()
    return out
}
```

**Follow-up:** What if `n*n` could fail?

Return a result struct:

```go
type Result struct { Val int; Err error }

func Square(n int) <-chan Result {
    out := make(chan Result, 1)
    go func() {
        v, err := compute(n)
        out <- Result{Val: v, Err: err}
    }()
    return out
}
```

---

### Q3. What happens if you call `<-fut` twice on the same future?

The first read takes the value out of the capacity-1 buffer. The second read finds the channel empty and blocks forever (or until the goroutine holding the channel is garbage-collected, which only happens if no live reference exists).

A future is single-use. If you need multi-read, use a memoized future built with `sync.Once` and a closed channel.

---

### Q4. How is a future different from a channel?

A channel is a general primitive: it can stream many values, can be unbuffered for rendezvous, can be closed for completion, can be selected against. A future is a *one-shot* idiom built on a channel: one value, one read, then done.

In other words: every future is a channel, but not every channel is a future.

---

## Mid-level

### Q5. Write a generic `Future[T]` type with `Await(ctx)` and `New(ctx, fn)`.

```go
type Result[T any] struct {
    Val T
    Err error
}

type Future[T any] struct {
    ch chan Result[T]
}

func New[T any](ctx context.Context, fn func(context.Context) (T, error)) *Future[T] {
    f := &Future[T]{ch: make(chan Result[T], 1)}
    go func() {
        v, err := fn(ctx)
        f.ch <- Result[T]{Val: v, Err: err}
    }()
    return f
}

func (f *Future[T]) Await(ctx context.Context) (T, error) {
    select {
    case r := <-f.ch:
        return r.Val, r.Err
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}
```

**Follow-up:** Why does `Await` take a separate ctx from `New`?

Because the awaiter may have a different deadline from the worker. The awaiter might want to bail out after 100ms while the worker is allowed to keep running for the global timeout. Decoupling them gives the caller flexibility.

---

### Q6. How would you wait for any of three futures to succeed, taking the first?

`AwaitAny`. Spawn a small forwarder per future that pushes into a single channel. Read the first non-error result.

```go
func AwaitAny[T any](ctx context.Context, futs ...*Future[T]) (T, error) {
    type r struct { v T; err error }
    out := make(chan r, len(futs))
    for _, fu := range futs {
        fu := fu
        go func() {
            v, err := fu.Await(ctx)
            out <- r{v, err}
        }()
    }
    var lastErr error
    for i := 0; i < len(futs); i++ {
        select {
        case x := <-out:
            if x.err == nil { return x.v, nil }
            lastErr = x.err
        case <-ctx.Done():
            var zero T
            return zero, ctx.Err()
        }
    }
    var zero T
    return zero, lastErr
}
```

**Follow-up:** Do you cancel the losers? How?

Not in this version. To cancel them, derive a child ctx and cancel on return:

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
```

Then start the futures with this `ctx` (so they observe `ctx.Done()`).

---

### Q7. When would you choose `errgroup` over a hand-rolled set of futures?

When the work is fan-shaped (N parallel pieces, all-or-nothing failure) and you don't need the futures as *handles* to pass around. `errgroup` is fewer types, is in `golang.org/x/sync`, has ctx wired in, and is more idiomatic for the common case.

Choose `Future[T]` when:
- The future is the API (you return it from a public function),
- You compose futures via `Map`/`FlatMap`,
- Results have heterogeneous types you want to combine selectively.

---

### Q8. How do you build a future whose result can be read by many goroutines?

A memoized future:

```go
type Memo[T any] struct {
    once sync.Once
    val  T
    err  error
    done chan struct{}
    fn   func(context.Context) (T, error)
}

func (m *Memo[T]) Await(ctx context.Context) (T, error) {
    m.once.Do(func() {
        go func() {
            m.val, m.err = m.fn(context.Background())
            close(m.done)
        }()
    })
    select {
    case <-m.done:
        return m.val, m.err
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}
```

The key trick: `close(done)` is the broadcast. A closed channel returns instantly to every receiver. The value is stored in fields, not the channel.

---

## Senior

### Q9. Why doesn't Go have `async`/`await` keywords?

The Go authors made a deliberate choice. Channels plus `context.Context` already cover the same ground:

- Async semantics are achieved by `go f()` plus a result channel.
- Composition is achieved by `select`, `errgroup`, or library-level `Future[T]`.
- Cancellation is achieved by ctx propagation.

`async`/`await` would introduce function coloring — async functions can only be called from async functions, splitting the API surface. Go's goroutines have no color: any function can block and any function can spawn.

The cost is a small amount of boilerplate (the `make(chan T, 1)` and goroutine spawn) repeated at each future creation site. The Go community has accepted that cost for the simplicity and uniformity benefits.

**Follow-up:** Is there a downside to no async/await?

Yes. The pattern is unenforced — programmers can forget the buffer, forget ctx propagation, abandon goroutines. A language-level construct would mechanise correctness. Go's design assumes disciplined programmers and tooling (race detector, `goleak`, vet) to catch the mistakes.

---

### Q10. Walk me through hedging two requests in Go.

Goal: send the request to backend A. If A hasn't answered within delay D, also send to B. Take whichever answers first.

```go
func Hedge[T any](
    parent context.Context,
    delay time.Duration,
    do func(context.Context) (T, error),
) (T, error) {
    ctx, cancel := context.WithCancel(parent)
    defer cancel()

    type r struct { v T; err error }
    out := make(chan r, 2)

    go func() {
        v, err := do(ctx)
        out <- r{v, err}
    }()

    select {
    case x := <-out:
        if x.err == nil { return x.v, nil }
        // first failed; let the hedge run
    case <-time.After(delay):
        // first slow; fire hedge
        go func() {
            v, err := do(ctx)
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

Tuning: set `delay` near the p95 latency of the operation. That way the hedge fires only for the slow tail, costing ~5% extra load for a large p99 improvement.

**Follow-up:** What happens to the "loser" goroutine?

It sees `ctx.Done()` (because we `defer cancel()`) and exits. The buffer of size 2 ensures it can still write its `r` if it finished before noticing the cancel.

---

### Q11. Compare Go's future pattern with JavaScript Promises.

| Property | JavaScript Promise | Go Future |
|----------|-------------------|-----------|
| Built-in? | Yes (language) | No (pattern) |
| Eager? | Yes | Yes (canonical) |
| Composition | `.then`, `Promise.all`, `Promise.race` | Hand-rolled or library |
| Cancellation | AbortController (manual) | `context.Context` |
| Function coloring | Yes (async/await) | No |
| Multi-consumer | Yes (any `.then` works) | Only via memo |
| Errors | Rejected promise (caught with `.catch`) | `Result.Err` field |

The big philosophical difference: JS Promise is part of the language, so its semantics are uniform across libraries. Go's future is a *convention*, so different libraries can have subtly different conventions. The trade-off is the function-coloring problem: in JS, you cannot easily call an async function from a sync one; in Go, every function looks the same.

---

### Q12. How do you debug a "goroutine leak" caused by a future?

1. Take a goroutine dump: `kill -QUIT $pid` (writes to stderr) or `runtime.Stack(buf, true)` or `pprof goroutine`.
2. Look for stacks blocked on `chan receive` or `chan send` from your future code.
3. Match the creation site (the stack trace shows where the goroutine was started).
4. Diagnose:
   - Send-side leak: producer blocked on `ch <- v` because the consumer abandoned a buffer-0 channel.
   - Receive-side leak: consumer blocked on `<-ch` because the producer never sent (its work hung on something).
5. Fix: ensure the channel is buffered for send-side; ensure the work function honours ctx for receive-side; cancel hedging losers explicitly.

In tests, run `go.uber.org/goleak` — it catches these statically.

---

### Q13. Design a function that takes a list of URLs and returns the first valid HTML response, cancelling the rest.

```go
func FirstValid(ctx context.Context, urls []string) (string, error) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()

    type r struct { body string; err error }
    out := make(chan r, len(urls))

    for _, u := range urls {
        u := u
        go func() {
            body, err := fetch(ctx, u)
            if err == nil && !looksLikeHTML(body) {
                err = errors.New("not HTML")
            }
            select {
            case out <- r{body, err}:
            case <-ctx.Done():
            }
        }()
    }

    var lastErr error
    for i := 0; i < len(urls); i++ {
        select {
        case x := <-out:
            if x.err == nil {
                return x.body, nil
            }
            lastErr = x.err
        case <-ctx.Done():
            return "", ctx.Err()
        }
    }
    return "", lastErr
}
```

Once we return a successful body, `defer cancel()` cancels the rest, and the buffered `out` channel lets late arrivals deliver without blocking.

---

## Staff

### Q14. Design a "request graph" library where each node is a future and dependencies are wired automatically.

Hint: each node has a `Compute func(deps map[string]any) (any, error)`, a list of dependency keys, and is memoized.

```go
type Node struct {
    Key     string
    Deps    []string
    Compute func(ctx context.Context, deps map[string]any) (any, error)

    once sync.Once
    val  any
    err  error
    done chan struct{}
}

type Graph struct {
    nodes map[string]*Node
}

func (g *Graph) Resolve(ctx context.Context, key string) (any, error) {
    n, ok := g.nodes[key]
    if !ok { return nil, fmt.Errorf("no node %q", key) }
    n.once.Do(func() {
        n.done = make(chan struct{})
        go func() {
            defer close(n.done)
            deps := make(map[string]any, len(n.Deps))
            grp, gctx := errgroup.WithContext(ctx)
            var mu sync.Mutex
            for _, dk := range n.Deps {
                dk := dk
                grp.Go(func() error {
                    v, err := g.Resolve(gctx, dk)
                    if err != nil { return err }
                    mu.Lock(); deps[dk] = v; mu.Unlock()
                    return nil
                })
            }
            if err := grp.Wait(); err != nil { n.err = err; return }
            n.val, n.err = n.Compute(ctx, deps)
        }()
    })
    select {
    case <-n.done:
        return n.val, n.err
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}
```

Each node computes at most once. Concurrent requests for the same key share the work. Dependencies fan out via `errgroup` so independent deps run in parallel. Cancellation propagates downward.

**Follow-up:** What if the graph has a cycle?

Detect cycles at graph-construction time with a topological sort. Resolve-time detection is possible but messy — a goroutine waiting on its own grandparent will deadlock and `goleak` won't tell you why. Build a validator.

---

### Q15. How would you implement a `sync.Pool`-backed future to reduce allocations?

The allocation cost of a future is: one `Future` struct, one channel, one closure capturing ctx, one goroutine stack (first time). At ~200 bytes per future, this is invisible at 100/sec and dominant at 1M/sec.

```go
var futPool = sync.Pool{
    New: func() any { return &Future[Result]{ch: make(chan Result, 1)} },
}

func New(ctx context.Context, fn func(context.Context) (Result, error)) *Future[Result] {
    f := futPool.Get().(*Future[Result])
    // channel may have a stale value from a previous use — drain it
    select { case <-f.ch: default: }

    go func() {
        v, err := fn(ctx)
        f.ch <- Result{Val: v, Err: err}
    }()
    return f
}

func (f *Future[Result]) Await(ctx context.Context) (Result, error) {
    defer futPool.Put(f)
    // ... normal await logic
}
```

Caveats:
- The pool only helps if `Get` and `Put` are paired. A future that is created and abandoned won't return to the pool.
- The channel persists across pool uses. Stale values must be drained.
- This sacrifices the safety of "the future is consumed once" — putting it back into the pool means another caller could see it.
- Benchmark before deploying. Most workloads don't need this.

**Follow-up:** Where would you measure to know if this is worth doing?

`pprof alloc_space` and `alloc_objects`. If your future-creation site is in the top 5, pooling may help. Otherwise it adds complexity for no win.

---

### Q16. A production system reports rising p99 latency but no individual downstream is slow. What's your investigation plan?

Hypothesis tree:

1. **Goroutine pile-up.** Run `pprof goroutine` during a slow period. If goroutine count is far above baseline, the scheduler is thrashing. Look for unbounded fan-outs.
2. **GC pressure.** `pprof heap` and `pprof allocs`. If allocation rate spiked, large request fan-outs with per-future allocations are likely.
3. **Lock contention.** `pprof mutex` (Go 1.20+ with `runtime.SetMutexProfileFraction`). If a shared mutex is hot, the fan-in step of an aggregator is serialising.
4. **Connection pool exhaustion.** Downstream HTTP/DB clients have pool limits. Many in-flight requests queue on `Pool.Get()`, hidden from per-request metrics.
5. **DNS resolution.** Slow DNS in the worker can serialise on a global lock. Look for `runtime.lookupHost` in goroutine dumps.

The future-pattern angle: bound your fan-outs. `errgroup.SetLimit(K)` keeps any single request from creating unbounded goroutines. Add a request-level semaphore for the *number of in-flight aggregations* if the fan-out count is itself unbounded.

---

### Q17. Argue for or against introducing a `Future[T]` library type in your codebase.

**For:**
- A single place to centralise instrumentation (counters, traces) on every async call.
- Self-documenting API boundaries (`*Future[User]` says "this is async").
- Composition becomes possible: `Map`, `FlatMap`, `Hedge` as functions taking futures.
- Future maintainers learn one abstraction, not five variant patterns.

**Against:**
- `errgroup` covers 80% of use cases without a custom type.
- The bare channel is more flexible: `select` over `<-chan T` is native; over `*Future[T]` it needs `Done()` returning a chan, which then re-introduces the channel.
- A custom type introduces a wrapper allocation. For high-frequency call sites this matters.
- Junior engineers learning the codebase must learn this in addition to ordinary channels and ctx.

**My position:** introduce it only if you have a clear, repeated pattern that the type makes simpler. Don't introduce it speculatively. The Go community has lived without one for a decade; you can too.

---

### Q18. When (if ever) is a *deferred* (lazy) future the right choice in Go?

Rare. Three plausible cases:

1. **Optional dependencies.** A function takes ten parameters, eight of which are loaded asynchronously. The user often only reads three. Deferred futures avoid speculative work.
2. **Initialisation graphs in DI containers.** Each service depends on N others; you build a graph at startup, and each node only computes when something downstream asks for it.
3. **Test fixtures.** Setup is expensive; tests choose which fixtures they need.

In all three, the alternative is "memoized plain function" — `func GetX(ctx) (X, error)` with internal `sync.Once`. That is usually simpler than a typed `Lazy[T]`.

Deferred futures shine when you want a *value* (passed around, stored in a map, used in combinators) rather than a *function*. In Go, plain functions are usually fine, so deferred futures are uncommon.

---

### Q19. How does `singleflight.Group` work internally? What's the trade-off?

`singleflight.Group` maintains a `map[string]*call`. Each `call` has a `wg sync.WaitGroup` (incremented once), a `val any`, an `err error`, and a `dups int` count.

When `Do(key, fn)` is called:

1. Lock the group, look up the key.
2. If absent, install a new `*call`, `Add(1)` to its WaitGroup, unlock, run `fn` synchronously, store the result, `Done()`, then remove the entry.
3. If present, `dups++`, unlock, `Wait()` on the WaitGroup, return the stored result.

Trade-offs:

- **Pro:** Concurrent identical requests are deduplicated to one underlying call.
- **Pro:** No ongoing memory cost — entries are removed after the call completes.
- **Con:** The first caller's panic propagates as a panic to *all* deduplicated callers (a known historical pitfall).
- **Con:** No caching between distinct stampedes. After completion, the next caller starts over.
- **Con:** The context is the *first caller's* ctx. If they cancel, others still see the result because the work is detached from ctx in some implementations — actually since 1.20, `singleflight` uses the first ctx and downstream callers can be affected if the work is ctx-aware.

For "longer-lived dedup", combine with a cache (cache.Get -> singleflight.Do -> cache.Set).

---

### Q20. Walk me through the memory model proof that this code is safe without explicit synchronisation.

```go
type S struct { x, y int }

func compute() <-chan *S {
    out := make(chan *S, 1)
    go func() {
        s := &S{x: 1, y: 2}
        out <- s
    }()
    return out
}

s := <-compute()
fmt.Println(s.x, s.y) // safe? yes — guaranteed to print 1 2
```

By Go memory model:

1. The write `s.x = 1, s.y = 2` happens-before the send `out <- s` (program order in the producer goroutine).
2. The send `out <- s` happens-before the receive `<-compute()` (channel-send-receive synchronization).
3. Therefore the writes happen-before the receive (transitivity).
4. The reads `s.x, s.y` in the consumer happen-after the receive (program order).
5. Therefore the writes happen-before the reads (transitivity).

So the consumer is guaranteed to observe `s.x == 1, s.y == 2`. No mutex needed.

Caveat: if the producer keeps a reference to `s` and mutates it after the send, that mutation races with the consumer's read. Don't share pointers and mutate.

---

## Closing Cues for Interviewers

- A candidate who answers Q1–Q4 but stumbles on Q5 is likely a junior engineer comfortable with channels but not generics.
- A candidate who answers Q5–Q8 cleanly is at mid-level.
- A candidate who handles Q9–Q13 with thoughtful trade-offs (especially Q9 and Q11) is senior.
- A candidate who designs Q14 systematically and reasons about Q16 like an incident commander is staff.

The pattern is small enough that depth of judgement is more telling than memorised code.

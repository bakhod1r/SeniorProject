# Futures & Promises — Senior

## 1. Mental model — Future as concurrency primitive

At senior level a Future stops being "a way to wait on a goroutine" and becomes **a uniform handle for a value-that-will-exist**. The handle is decoupled from the work that produces it and from the consumer that awaits it. Whether the mechanism is a one-shot channel, a `sync.Once`-guarded struct, or `errgroup.Wait`, the abstraction is the same: **a write-once, read-many cell with a "ready" signal**.

This decoupling is what makes Futures composable. The producer does not need to know who awaits or how many. A combinator (`All`, `First`, `Map`) operates on the handle, not on the work.

| Property | RPC-style | Future-style |
|----------|-----------|--------------|
| **When work runs** | Synchronously at call site | Eager: at construction; Lazy: at first await |
| **What the caller has** | The result | A handle to a future result |
| **Composition** | Sequential, blocking | Parallel fan-out by default |
| **Cancellation** | Implicit (return) | Explicit (`ctx`) on both sides |
| **Failure surface** | Synchronous error | Stored in handle, materializes at await |

**Eager vs lazy from a senior view.** Not stylistic; it determines the system's failure surface.

- **Eager** Futures start work at construction. Win: latency hiding — by the time the consumer needs the value, it is ready. Cost: orphaned work when the consumer disappears; requires disciplined cancellation propagation.
- **Lazy** Futures defer work to the first `Await`. Win: work that nobody needs costs nothing. Cost: serial latency. Right for caching, fallback chains, expensive validators that only some paths consume.

The senior heuristic: **eager when the work has its own latency to hide (network, disk); lazy when the value might not be needed**. Mixing them in one API confuses callers — pick one per type and document it.

A Future is also the right mental model for primitives you do not normally label as such: `context.Done()` is a Future of "should stop", `sync.WaitGroup.Wait` of "everyone finished", `time.After(d)` of "d elapsed". Recognizing these lets you compose them with `select`.

---

## 2. Channel internals — `hchan`, send/receive cost, one-shot channels

Every Go-shaped Future eventually rides on a channel — either `<-chan Result[T]` directly, or a `chan struct{}` inside a Promise struct used as a "done" signal. The cost model of channels is the cost model of Futures.

`runtime.hchan` (paraphrased from `src/runtime/chan.go`):

```go
type hchan struct {
    qcount   uint
    dataqsiz uint           // 0 = unbuffered
    buf      unsafe.Pointer // circular buffer
    elemsize uint16
    closed   uint32
    sendx, recvx uint
    recvq, sendq waitq      // parked goroutines
    lock     mutex
}
```

Every send and receive acquires `hchan.lock`. There is no lock-free fast path — even an empty `select` over a channel takes the lock. This is why **a Future implemented as a channel is not free, but a one-shot channel is essentially free**.

| Operation | Approx cost | Why |
|-----------|-------------|-----|
| `chan struct{}` close + receive | ~30 ns | Lock + flip `closed` + wake `recvq` |
| Unbuffered send with waiter | ~70 ns | Direct stack-to-stack copy via `recvq` |
| Buffered send, slot free | ~25 ns | Lock + memcpy into `buf` + unlock |
| Buffered send, slot full | ~150 ns + park | Sleep on `sendq`; scheduler wakeup |
| `select` over 4 ready cases | ~80 ns | Random ordering + lock per channel |

**Why one-shot channels are essentially free.** A typical Future uses `chan struct{}` as the "done" signal. Size zero — `elemsize = 0`, no buffer beyond the `hchan` header (~96 bytes). Lifecycle is `make → close → many receives`. Receives on a closed zero-sized channel skip the buffer copy entirely. One alloc per Future, two lock acquisitions (close + first receive), then unlimited near-free receives.

Compare with `<-chan Result[T]` where `Result[T]` is 64 bytes: every receive copies 64 bytes. For fan-out to N awaiters this is N×64 bytes of copy. The `chan struct{}` + shared memory pattern (Promise struct with `val`, `err` plus `done chan struct{}`) is strictly faster for multi-await.

Memory ordering: `close(f.done)` is a synchronization point (Go memory model). Anything written **before** `close` is visible to anything that observes it closed. This makes `val`/`err` safe to read after `<-f.done` without further locking. **Closing a one-shot channel is the cheapest cross-goroutine sync Go offers**.

---

## 3. Go ecosystem deep dive

**`golang.org/x/sync/errgroup`** — parallel fan-out with first-error cancellation. The most-used Future-like primitive in Go.

```go
g, gctx := errgroup.WithContext(ctx)
g.SetLimit(8)
for _, item := range items {
    item := item
    g.Go(func() error { return process(gctx, item) })
}
if err := g.Wait(); err != nil { return err }
```

Internally `errgroup.Group` is a `sync.WaitGroup` + `sync.Once` + a cancel func. `Wait` returns the first non-nil error; subsequent errors are dropped. The senior gotcha: `Wait()` returning does **not** mean all goroutines are gone; stragglers exit only when they see `gctx.Done()`.

**`golang.org/x/sync/singleflight`** — deduplication of in-flight identical calls.

```go
var g singleflight.Group
v, err, _ := g.Do(id, func() (any, error) { return fetchUser(ctx, id) })
```

If 1000 goroutines call with the same key concurrently, exactly one runs and all 1000 share its result. The pitfall is shared `ctx` — the call uses the **first caller's** context; if that caller cancels, every dedup'd caller observes the cancellation. Use `DoChan` to respect each caller's `ctx` individually.

**`sync/atomic` for lock-free Future state.** When a Future is hot-read and rarely written, the `sync.Once` slow path becomes the bottleneck.

```go
type AtomicFuture[T any] struct {
    state atomic.Uint32 // 0 = pending, 1 = resolved
    done  chan struct{}
    val   T
    err   error
}

func (f *AtomicFuture[T]) Resolve(v T) bool {
    if !f.state.CompareAndSwap(0, 1) { return false }
    f.val = v
    close(f.done)
    return true
}

func (f *AtomicFuture[T]) Await(ctx context.Context) (T, error) {
    if f.state.Load() == 1 { return f.val, f.err } // fast path, no chan op
    select {
    case <-f.done:    return f.val, f.err
    case <-ctx.Done():
        var z T; return z, ctx.Err()
    }
}
```

The fast path skips even the channel receive once resolved. Memory ordering is supplied by `close(done)`; the `state.Load()` fast path is safe because the transition is one-way. This pattern is used internally in `errgroup`, `singleflight`, and most Go connection pools.

| Library | Shape | When |
|---------|-------|------|
| `x/sync/errgroup` | Parallel fan-out, first-error | Default for "do N things in parallel" |
| `x/sync/singleflight` | Deduplication | Cache stampede, RPC memoization |
| `sourcegraph/conc` | Typed pool with `Wait() []T` | Want typed results, panic-safe |
| `alitto/pond` | Worker pool, queued tasks | Submit > workers, want queue semantics |
| `panjf2000/ants` | Reusable goroutine pool | Millions of short tasks, GC pressure |

The senior reach: `errgroup` 90% of the time; `singleflight` for dedup; `conc/pool` when you want typed results; `ants`/`pond` only when you've measured goroutine churn as the bottleneck.

---

## 4. Combinators — `All`, `First`, `Any`, `Race`, `Map`, `FlatMap`

Go does not ship Future combinators. Each team rebuilds them or imports `conc`. The canonical set:

**`All`** — wait for all, fail on first error, cancel the rest. This is `errgroup.WithContext` with results collected.

```go
func All[T any](ctx context.Context, fs []*Future[T]) ([]T, error) {
    g, gctx := errgroup.WithContext(ctx)
    out := make([]T, len(fs))
    for i, f := range fs {
        i, f := i, f
        g.Go(func() error {
            v, err := f.Await(gctx)
            if err != nil { return err }
            out[i] = v
            return nil
        })
    }
    if err := g.Wait(); err != nil { return nil, err }
    return out, nil
}
```

**`First`** — first **success**, cancel siblings. **`Any`** — first **completion**, success or failure. **`Race`** — first completion wins and cancels the rest; tail-latency hiding used in BigTable, Cassandra, Cockroach.

```go
func Race[T any](ctx context.Context, runs []func(context.Context) (T, error)) (T, error) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()
    type res struct{ v T; err error }
    ch := make(chan res, len(runs))
    for _, fn := range runs {
        go func(fn func(context.Context) (T, error)) {
            v, err := fn(ctx); ch <- res{v, err}
        }(fn)
    }
    r := <-ch
    return r.v, r.err
}
```

**`Map`** — transform a Future's value. **`FlatMap`** — chain a Future producing another Future; avoids `Future[Future[T]]` nesting.

```go
func Map[T, U any](ctx context.Context, f *Future[T], fn func(T) U) *Future[U] {
    out := NewFuture[U]()
    go func() {
        v, err := f.Await(ctx)
        if err != nil { out.Reject(err); return }
        out.Resolve(fn(v))
    }()
    return out
}

func FlatMap[T, U any](ctx context.Context, f *Future[T], fn func(T) *Future[U]) *Future[U] {
    out := NewFuture[U]()
    go func() {
        v, err := f.Await(ctx)
        if err != nil { out.Reject(err); return }
        v2, err := fn(v).Await(ctx)
        if err != nil { out.Reject(err); return }
        out.Resolve(v2)
    }()
    return out
}
```

**Go's lack vs custom.** Go made an explicit choice: no built-in combinators. Idiomatic Go composes via `select` and `errgroup` — chains read like Scala futures, which the designers consider less legible. Generics arrived late (1.18), so any combinator API before 2022 was `interface{}` and lossy. The senior reality: **most large codebases have an internal `future` package** with the six combinators above and nothing more.

---

## 5. Cancellation propagation — `ctx` threading, abort-on-error, structured concurrency

A Future without cancellation propagation is a goroutine leak waiting to happen.

**Thread `ctx` to the work.** The function producing the Future accepts a `ctx`, and every blocking call inside respects it.

```go
func fetchUser(ctx context.Context, id string) (User, error) {
    req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
    resp, err := http.DefaultClient.Do(req) // ctx-aware
    // ...
}
```

**Abort-on-error.** `errgroup.WithContext` gives this for free: the first non-nil error cancels the group's `ctx`, every other goroutine sees `ctx.Done()`.

```go
g, gctx := errgroup.WithContext(ctx)
for _, q := range queries {
    q := q
    g.Go(func() error { return runQuery(gctx, q) }) // gctx, not ctx
}
err := g.Wait()
```

Note `gctx`, not the parent `ctx`. Passing the parent defeats the cancellation — child goroutines run to completion even after the first error. One of the most common review findings in `errgroup` code.

**Structured concurrency.** The principle: **no goroutine outlives the function that started it**. `errgroup.Wait` enforces this. The anti-pattern:

```go
func handler(ctx context.Context) {
    go expensive(ctx) // fire-and-forget
    return            // expensive is now orphaned
}
```

If `ctx` is the request context, `expensive` is canceled — fine. If it is a long-lived server context, `expensive` runs forever. Senior code always either `g.Go`s or returns a Future the caller can await.

**Cancellation latency.** `ctx.Done()` only fires when the work checks it. A handler doing a 10 MB JSON encode in a tight loop ignores `ctx.Done()` for the duration. Periodically check `ctx.Err()` in long CPU loops; for I/O use `ctx`-aware APIs (`net/http`, `database/sql` with `QueryContext`).

---

## 6. Generics typed Future — full `Future[T]` and `Result[T]`

Pre-1.18 Futures used `interface{}` and lost type information. Generics let the type ride through composition.

```go
type Result[T any] struct {
    Value T
    Err   error
}

func (r Result[T]) Ok() bool           { return r.Err == nil }
func (r Result[T]) Unwrap() (T, error) { return r.Value, r.Err }

type Future[T any] struct {
    done  chan struct{}
    val   T
    err   error
    state atomic.Uint32 // 0 = pending, 1 = resolved
    once  sync.Once
}

func NewFuture[T any]() *Future[T] {
    return &Future[T]{done: make(chan struct{})}
}

func (f *Future[T]) Resolve(v T) (ok bool) {
    f.once.Do(func() {
        f.val = v
        f.state.Store(1)
        close(f.done)
        ok = true
    })
    return
}

func (f *Future[T]) Reject(err error) (ok bool) {
    if err == nil { panic("Reject(nil)") }
    f.once.Do(func() {
        f.err = err
        f.state.Store(1)
        close(f.done)
        ok = true
    })
    return
}

func (f *Future[T]) Ready() bool { return f.state.Load() == 1 }

func (f *Future[T]) Await(ctx context.Context) (T, error) {
    if f.state.Load() == 1 { return f.val, f.err } // hot path
    select {
    case <-f.done:    return f.val, f.err
    case <-ctx.Done():
        var z T
        return z, ctx.Err()
    }
}

func (f *Future[T]) Done() <-chan struct{} { return f.done }

func Go[T any](ctx context.Context, fn func(context.Context) (T, error)) *Future[T] {
    f := NewFuture[T]()
    go func() {
        defer func() {
            if r := recover(); r != nil {
                f.Reject(fmt.Errorf("future panic: %v\n%s", r, debug.Stack()))
            }
        }()
        v, err := fn(ctx)
        if err != nil { f.Reject(err); return }
        f.Resolve(v)
    }()
    return f
}

type Lazy[T any] struct {
    once sync.Once
    fn   func(context.Context) (T, error)
    val  T
    err  error
}

func (l *Lazy[T]) Await(ctx context.Context) (T, error) {
    l.once.Do(func() { l.val, l.err = l.fn(ctx) })
    return l.val, l.err
}
```

Key senior touches:

- **Atomic state flag** — `Ready()` and `Await` fast path skip channel ops when resolved.
- **`Reject(nil)` panics** — `nil` error is success; allowing it invites bugs where the consumer cannot distinguish "no value" from "value=zero, err=nil".
- **`Resolve`/`Reject` return `bool`** — caller knows whether it won the resolve race. Useful in `Race`/`First` combinators.
- **Panic recovery in `Go`** — a panic in `fn` becomes an error in the Future. Without this, the panic crashes the program and the awaiter blocks forever (§9).
- **`Result[T]`** — useful for collecting heterogeneous Futures where partial failure is acceptable.

The contract: write-once, read-many, panic-safe, cancellation-respecting.

---

## 7. Backpressure — bounded concurrency with `SetLimit`, semaphore patterns

Unbounded fan-out is the single most common production failure of Future-heavy code. A request burst arrives, the handler does `for _, x := range items { g.Go(...) }`, and a million goroutines spawn — memory explodes, GC stalls, scheduler thrashes, OOM.

**`errgroup.SetLimit` (Go 1.20+).** The simplest bounded pool — `g.Go` blocks when the limit is full.

```go
g, gctx := errgroup.WithContext(ctx)
g.SetLimit(64)
for _, item := range items {
    item := item
    g.Go(func() error { return process(gctx, item) })
}
return g.Wait()
```

`g.Go` blocks the **caller** until a slot is free — backpressure propagates to whoever feeds `items`. The trap: `g.Go` blocks even when `gctx` is canceled. Fix:

```go
if err := gctx.Err(); err != nil { break }
g.Go(func() error { return process(gctx, item) })
```

Or `g.TryGo` returns `false` if the limit is hit — useful when you want to drop instead of queue.

**`golang.org/x/sync/semaphore` for weighted concurrency.** When tasks have different weights, a counting semaphore bounds total cost, not total count.

```go
sem := semaphore.NewWeighted(100)
for _, item := range items {
    weight := int64(item.Size / 1024)
    if err := sem.Acquire(gctx, weight); err != nil { break }
    g.Go(func() error {
        defer sem.Release(weight)
        return process(gctx, item)
    })
}
```

Total in-flight work never exceeds 100 KB. Right shape when "concurrent count" is a bad proxy for load.

**Channel-as-semaphore.** Buffered channel of capacity N is a counting semaphore with N permits, cheaper than mutex-based; ctx-aware via `select`.

| Bottleneck | Bound |
|------------|-------|
| CPU | `runtime.GOMAXPROCS(0)` or 2-4x |
| Network egress (HTTP) | Match `MaxIdleConnsPerHost` |
| Disk I/O | 2-8 for spinning; 32-128 for NVMe |
| Database | Match `db.SetMaxOpenConns` |
| Remote API rate limit | Below limit with headroom |

The senior rule: **bound concurrency to the bottleneck resource**, not "feels about right". Profile, then set.

---

## 8. Observability — span per Future, duration histograms, leak detection

A Future is a unit of work; treat it like a span.

```go
func GoTraced[T any](ctx context.Context, name string, fn func(context.Context) (T, error)) *Future[T] {
    ctx, span := tracer.Start(ctx, name)
    f := NewFuture[T]()
    go func() {
        defer span.End()
        defer func() {
            if r := recover(); r != nil {
                span.RecordError(fmt.Errorf("%v", r))
                f.Reject(fmt.Errorf("future panic: %v", r))
            }
        }()
        v, err := fn(ctx)
        if err != nil { span.RecordError(err); f.Reject(err); return }
        f.Resolve(v)
    }()
    return f
}
```

Span attributes: `future.name`, `future.eager`, `future.outcome` (resolved/rejected/canceled). Across a fan-out, the parent span has N child spans — the trace UI shows them in parallel.

| Metric | Type | Labels |
|--------|------|--------|
| `future_duration_seconds` | histogram | name, outcome |
| `future_inflight` | gauge | name |
| `future_panics_total` | counter | name |
| `future_canceled_total` | counter | name, reason |
| `errgroup_concurrency_limit` | gauge | group |
| `errgroup_queued` | gauge | group |

Two metrics catch problems early: **`future_inflight`** rising linearly (producer not bounded, consumer not awaiting) and **`future_duration_seconds{outcome="canceled"}` p99 jump** (work being abandoned).

**Leak detection.** A leaked Future is one whose work runs forever because nothing cancels it and nothing awaits it.

1. **`runtime.SetFinalizer`** on the Future — if GC'd before resolved, log a warning. Imperfect but cheap.
2. **`uber-go/goleak`** at the end of every test — fails on leftover goroutines. Catches leaks spawned during tests.
3. **`net/http/pprof`** — `/debug/pprof/goroutine?debug=2` shows every goroutine's stack. A stack ending in `select` on `f.done` is a Future the consumer abandoned. Production canary: scrape goroutine count every minute; alert on linear growth.
4. **Inflight gauge** with an alert above expected concurrency.

```go
import "go.uber.org/goleak"
func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }
```

The senior rule: **a Future that is not awaited and not canceled is a leak**. Pre-leak detection (goleak in tests) is cheaper than post-leak detection (pprof on a 4 GB heap dump at 3 AM).

---

## 9. Failure modes — orphaned producers, double-fulfilment, panic propagation

**Orphaned producers.** The consumer cancels or times out. The Future's producer goroutine, if it does not observe `ctx.Done()`, keeps running. Over time, orphans accumulate.

```go
// Anti-pattern: ignores ctx
func slow(ctx context.Context) (string, error) {
    time.Sleep(30 * time.Second)
    return queryDB(), nil
}
// Fix:
func slow(ctx context.Context) (string, error) {
    select {
    case <-time.After(30 * time.Second):
    case <-ctx.Done(): return "", ctx.Err()
    }
    return queryDB(ctx)
}
```

**Producers must always be ctx-aware**, even when "the work is fast". Fast in dev becomes slow in prod under contention.

**Double-fulfilment.** Resolving a Future from two goroutines simultaneously. Without `sync.Once` (or atomic CAS), `close(f.done)` runs twice and panics with `"close of closed channel"`. In `Race`/`First`, many goroutines try to resolve the same output Future — `sync.Once` guarantees only the first wins. The `bool` return from `Resolve`/`Reject` tells the caller "you lost the race" so it can clean up.

**Panic propagation.** A panic in the producer goroutine, unrecovered, crashes the **program**, and the awaiter blocks forever.

```go
go func() {
    v, err := fn(ctx) // if this panics, the program dies
    if err != nil { f.Reject(err); return }
    f.Resolve(v)
}()
```

Fix: `recover()` in the goroutine, convert to error (§6's `Go`). Capture `debug.Stack()` so the awaiter has context.

`errgroup` does **not** recover panics. A panicking goroutine inside `g.Go` crashes the program. Wrap with recover for untrusted code:

```go
g.Go(func() (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v\n%s", r, debug.Stack())
        }
    }()
    return work(gctx)
})
```

`sourcegraph/conc`'s `pool.Pool` recovers panics by default.

| Failure | Symptom | Fix |
|---------|---------|-----|
| Orphaned producer | Goroutine count grows; memory leak | Make producer ctx-aware |
| Double-fulfilment | `close of closed channel` panic | `sync.Once` on resolve/reject |
| Unrecovered panic | Program crashes; awaiter blocks forever | `recover()` in goroutine, convert to error |
| Awaiter abandons Future | Producer runs forever | Always thread `ctx`; bound concurrency |
| `errgroup` swallows late errors | Wait returns first error; others silent | Log per-goroutine errors before returning |

---

## 10. When NOT Futures + closing principles

### 10.1 When not

- **Sequential work.** A then B then C with no parallelism is plain function calls. Wrapping in Futures adds goroutines for no gain.
- **Hot, in-process loops.** A tight loop doing 10M element transforms does not want a goroutine per element. Use bounded workers reading from a channel.
- **Two-step pipelines.** Producer/consumer with no fan-out is two functions and a buffered channel.
- **Tasks with no result.** Fire-and-forget uses `go fn(ctx)` plus a `sync.WaitGroup` for shutdown.
- **Strong ordering requirements.** Futures resolve in completion order, not start order. For FIFO use a channel with sequential receiver.
- **Microsecond budgets.** Goroutine creation costs ~3-5 microseconds, channel ops ~50-200 ns. For a 1 microsecond operation a Future is 5x overhead. Inline it.

### 10.2 Closing principles

**A Future is a handle, not a goroutine.** The senior shift is thinking of the value, not the goroutine. Two Futures with identical contracts (`Future[User]`) are interchangeable regardless of whether the impl is eager-channel, `singleflight`, or `errgroup`-wrapped.

**Eager by default, lazy when needed.** Pick one per type, document it, do not mix. Mixed eagerness is the source of "why did this not run?" bugs.

**Cancellation is the contract.** Every Future-producing function takes a `ctx`. Every producer respects `ctx.Done()`. Every awaiter respects `ctx` on `Await`. Cancellation propagation is the contract that makes the whole system safe to leak-test.

**Bound concurrency or be bounded.** Always `SetLimit`, always a semaphore, always pick the bound from the bottleneck. If you cannot identify the bottleneck, you do not yet have permission to fan out.

**At-least-once + idempotent.** When retrying Futures, the work must be idempotent. A retry that creates a duplicate row is a bug; a retry that returns the existing row is correctness.

**Observe before you scale.** Span per Future, duration histograms, inflight gauges, goleak in tests. Futures fail by silently leaking — silence does not show up in incident timelines.

**Build the small package; match shape to topology.** `Future[T]`, `Go`, `All`, `First`, `Race`, `Map`, `FlatMap` — six types and six functions cover 95% of the work. `errgroup` for fan-out-and-collect, `singleflight` for dedup, `Race` for tail-latency hiding, `Lazy` for caching. The senior skill is recognizing which topology the code wants — not forcing every problem into the same `Future[T]` you know best.

---

## Further reading

- `src/runtime/chan.go` — `hchan` implementation and channel cost model
- `golang.org/x/sync/{errgroup,singleflight,semaphore}` source
- `sourcegraph/conc` — panic-safe pools and typed combinators
- `uber-go/goleak` — goroutine leak detection in tests
- "Go Concurrency Patterns: Pipelines and cancellation" — Sameer Ajmani
- Bryan Mills, "Rethinking classical concurrency patterns" — GopherCon 2018
- Java `CompletableFuture` API — reference for combinator naming

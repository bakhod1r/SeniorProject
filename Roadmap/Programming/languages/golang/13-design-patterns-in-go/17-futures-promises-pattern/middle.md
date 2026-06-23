# Futures & Promises — Middle

## 1. Where Futures actually live in idiomatic Go

The textbook Future is `Promise<T>` with `.then(...)`. Go doesn't have that. What you'll find in real Go code is roughly four shapes, all serving the same goal:

1. **`<-chan Result[T]`** — a function returns a receive-only channel that will receive exactly one result. Most idiomatic.
2. **`*Promise[T]`** — a struct with `Resolve/Reject/Await` methods. Used when you need to *hold* the future as a value and pass it around.
3. **`errgroup.Group`** — runs N goroutines that all share a context; the group resolves when they all finish (or the first one errors).
4. **`singleflight.Group`** — deduplicates concurrent calls and gives every caller the same Future.

The middle-level skill is choosing the shape based on what the consumer needs: one value? Several parallel values? A deduplicated value? Each of these has a different idiomatic Go shape.

---

## 2. The `Future[T]` building block (production-shaped)

A small reusable Future type:

```go
type Future[T any] struct {
    done chan struct{}
    val  T
    err  error
    once sync.Once
}

func NewFuture[T any]() *Future[T] {
    return &Future[T]{done: make(chan struct{})}
}

func (f *Future[T]) Resolve(v T) {
    f.once.Do(func() {
        f.val = v
        close(f.done)
    })
}

func (f *Future[T]) Reject(err error) {
    f.once.Do(func() {
        f.err = err
        close(f.done)
    })
}

func (f *Future[T]) Await(ctx context.Context) (T, error) {
    select {
    case <-f.done:
        return f.val, f.err
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}

func (f *Future[T]) Done() <-chan struct{} { return f.done }
```

Three key middle-level points:

- **`sync.Once`** guards against double-fulfilment (`Resolve` then `Reject` would panic without it).
- **`Await(ctx)`** lets the consumer give up; the producer goroutine keeps running but the consumer isn't stuck.
- **`Done()`** exposes the channel so callers can use it in their own `select`.

---

## 3. Eager vs lazy

The Futures we've shown are **eager**: the goroutine is started at `Go(fn)` time, the work proceeds whether the consumer ever awaits or not.

A **lazy** Future does nothing until `Await` is called:

```go
type Lazy[T any] struct {
    once sync.Once
    val  T
    err  error
    fn   func(context.Context) (T, error)
}

func NewLazy[T any](fn func(context.Context) (T, error)) *Lazy[T] {
    return &Lazy[T]{fn: fn}
}

func (l *Lazy[T]) Await(ctx context.Context) (T, error) {
    l.once.Do(func() { l.val, l.err = l.fn(ctx) })
    return l.val, l.err
}
```

Eager wastes work if no one awaits. Lazy adds a hop of latency at await time. Use eager when: the work has its own latency hiding (network, disk) and you want to overlap with other work. Use lazy when: the value might not be needed (caching, fallback chains).

---

## 4. Combining Futures

Several common compositions show up:

**All** — wait for all, fail if any fails. `errgroup.Group` does this:

```go
g, gctx := errgroup.WithContext(ctx)
var u User
var orders []Order
g.Go(func() error {
    var err error
    u, err = fetchUser(gctx, id)
    return err
})
g.Go(func() error {
    var err error
    orders, err = fetchOrders(gctx, id)
    return err
})
if err := g.Wait(); err != nil {
    return err
}
```

`errgroup` cancels `gctx` as soon as one goroutine returns an error. The others see the cancellation and bail out. This is the canonical "parallel fan-out" in Go.

**First** — return the first result, cancel the rest. Often written manually with `select`:

```go
func First[T any](futures ...*Future[T]) *Future[T] {
    out := NewFuture[T]()
    for _, f := range futures {
        go func(f *Future[T]) {
            v, err := f.Await(ctx)
            if err == nil {
                out.Resolve(v)
            } else {
                out.Reject(err)
            }
        }(f)
    }
    return out
}
```

**Map** — transform the result lazily:

```go
func Map[T, U any](f *Future[T], fn func(T) U) *Future[U] {
    out := NewFuture[U]()
    go func() {
        v, err := f.Await(ctx)
        if err != nil { out.Reject(err); return }
        out.Resolve(fn(v))
    }()
    return out
}
```

Go doesn't ship these helpers. You either roll your own (3-10 lines each) or use a library. Most teams build a small `future` package once and reuse it.

---

## 5. `golang.org/x/sync/singleflight`

A specialized Future: **deduplication of concurrent calls**.

```go
var g singleflight.Group

func GetUser(ctx context.Context, id string) (User, error) {
    v, err, _ := g.Do(id, func() (any, error) {
        return fetchUser(ctx, id)
    })
    return v.(User), err
}
```

If 1000 goroutines call `GetUser("alice")` simultaneously, only **one** `fetchUser` runs. The other 999 share the same result. This is a Future shared across the de-duplicated callers.

The pitfall is the `singleflight.Result` shape — each caller sees the *same* result, including the same error and any sharedness. Don't write through it.

Used in: cache stampede prevention, RPC client memoization, deduplicating expensive validators.

---

## 6. `errgroup` semantics in detail

`errgroup.Group` (and the `WithContext` variant) is the most-used Future-like primitive in Go:

```go
g, ctx := errgroup.WithContext(parentCtx)

g.SetLimit(10) // max 10 concurrent goroutines (Go 1.20+)

for _, item := range items {
    item := item
    g.Go(func() error {
        return process(ctx, item)
    })
}

if err := g.Wait(); err != nil { /* first error */ }
```

Key semantics:
- The first error cancels the group's context.
- Subsequent errors are silently dropped (only first is returned by `Wait`).
- `SetLimit(n)` is a hard concurrency cap; `Go` blocks if full.
- `g.Go(f)` runs `f` in a new goroutine and returns immediately.

Anti-pattern: `g.Go` inside a loop without capturing the loop variable (pre-Go-1.22 bug). Always `item := item` or use Go 1.22+ semantics.

---

## 7. Timeouts and deadlines

Two ways to time-box a Future:

**Context with timeout** — kills the producer's work:

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
result, err := future.Await(ctx)
```

The goroutine sees `ctx.Done()` and (ideally) returns. Best when the work *can* be cancelled.

**Awaiter-side timeout** — only the consumer gives up:

```go
select {
case r := <-future:
    use(r)
case <-time.After(5 * time.Second):
    return errors.New("future awaited > 5s")
}
```

The goroutine keeps running. This is a leak unless the goroutine also has a cancellation path. Use this only when you have no way to cancel the work — increasingly rare.

---

## 8. Synchronization primitives that look like Futures

- **`sync.WaitGroup`** — a Future that resolves to nothing. Many producers, one Future. `Wait()` is the Await.
- **`sync.Once`** — a Future that runs the work once; subsequent calls return immediately. Lazy-init pattern.
- **`context.Context.Done()`** — a degenerate Future for "the operation should stop". The channel closes when the context is done.

Recognizing these as Futures makes Go's concurrency primitives easier to mentally compose.

---

## 9. Pipeline patterns

A pipeline is a chain of stages, each producing futures the next stage awaits:

```go
func Stage1(in <-chan Job) <-chan Future[Result] {
    out := make(chan Future[Result])
    go func() {
        defer close(out)
        for j := range in {
            f := NewFuture[Result]()
            go func(j Job, f *Future[Result]) {
                r, err := process(j)
                if err != nil { f.Reject(err) } else { f.Resolve(r) }
            }(j, f)
            out <- f
        }
    }()
    return out
}
```

The Future-of-Result lets each stage hand off without blocking on the slowest job. Pipelines of futures are how high-throughput backends decouple slow steps from fast ones.

---

## 10. Common middle-level mistakes

- **Unbounded fan-out.** A producer doing `g.Go(...)` per incoming request, with no `SetLimit`, can spawn millions of goroutines on a traffic spike. Always limit.
- **Forgetting `defer cancel()`** on `context.WithTimeout`. The timer leaks until expiry.
- **Reading a closed channel expecting to block** — closed channels deliver zero values forever. After the first read, subsequent reads return the zero value with `ok=false`.
- **Resolving a Future from multiple goroutines** without `sync.Once` — panic on double close.
- **Awaiting in a loop with `time.After`** without resetting — fresh timer per iteration leaks. Use `time.NewTimer` and `Reset()`.
- **Treating `errgroup.Wait` as "all done" when it returned on first error.** Other goroutines may still be running; they only stop when they observe `ctx.Done()`.

---

## 11. Summary

In Go, a Future is a one-shot channel; a Promise is a struct with Resolve/Reject/Await. Eager Futures pre-start work; lazy ones defer it. `errgroup` handles "all-or-first-error" parallel fan-out; `singleflight` deduplicates concurrent calls. Always thread context, always limit concurrency, always handle "the consumer gave up" without leaking the producer. The pattern is small in code; the discipline is in correctness under cancellation.

---

## Further reading
- `golang.org/x/sync/errgroup` source code
- `golang.org/x/sync/singleflight` source code
- "Pipelines and cancellation" — Go blog (Sameer Ajmani)
- `context` package documentation — the canonical cancellation source
- Sergio Stuto, *Cancel propagation in Go* — design talks
- Java `CompletableFuture` — type-level inspiration for Map/All/First combinators

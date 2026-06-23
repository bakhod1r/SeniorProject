# Future / Promise Pattern — Tasks

Hands-on exercises, ordered roughly from junior to staff. Each comes with acceptance criteria and a hint. Suggested solutions are sketched at the bottom of each task.

---

## Task 1. Your first future

Write a function `SquareAsync(n int) <-chan int` that computes `n*n` asynchronously and returns a channel carrying the single result.

**Acceptance:**
- The function returns a receive-only channel.
- The channel is buffered with capacity 1.
- The result is sent and the goroutine exits even if no one reads.

**Hint:** Five lines. `make(chan int, 1)`, `go func() { ch <- n*n }()`, `return ch`.

**Solution sketch:**

```go
func SquareAsync(n int) <-chan int {
    ch := make(chan int, 1)
    go func() {
        ch <- n * n
    }()
    return ch
}
```

---

## Task 2. Add an error path

Generalise Task 1 to `DivideAsync(a, b int) <-chan Result[int]` where:
- `Result[T]` is `struct { Val T; Err error }`.
- Division by zero returns `(0, errors.New("divide by zero"))`.
- Otherwise returns `(a/b, nil)`.

**Acceptance:**
- The result channel carries a `Result[int]`.
- Division-by-zero behaviour is correct without panicking.

**Solution sketch:**

```go
type Result[T any] struct {
    Val T
    Err error
}

func DivideAsync(a, b int) <-chan Result[int] {
    out := make(chan Result[int], 1)
    go func() {
        if b == 0 {
            out <- Result[int]{Err: errors.New("divide by zero")}
            return
        }
        out <- Result[int]{Val: a / b}
    }()
    return out
}
```

---

## Task 3. Concurrent fetch

Write `FetchTwo(urlA, urlB string) (string, string, error)` that fetches both URLs concurrently and returns their bodies. If either fails, return the error.

**Acceptance:**
- Both fetches run concurrently (wall time ~ max of the two).
- Test by mocking `http.Get` or by stubbing a slow handler.

**Hint:** Two futures, two awaits.

**Solution sketch:**

```go
func FetchTwo(urlA, urlB string) (string, string, error) {
    a := fetchAsync(urlA)
    b := fetchAsync(urlB)
    ra := <-a
    rb := <-b
    if ra.Err != nil { return "", "", ra.Err }
    if rb.Err != nil { return "", "", rb.Err }
    return ra.Val, rb.Val, nil
}

func fetchAsync(url string) <-chan Result[string] {
    out := make(chan Result[string], 1)
    go func() {
        resp, err := http.Get(url)
        if err != nil { out <- Result[string]{Err: err}; return }
        defer resp.Body.Close()
        body, err := io.ReadAll(resp.Body)
        out <- Result[string]{Val: string(body), Err: err}
    }()
    return out
}
```

---

## Task 4. Generic Future[T]

Build a `Future[T]` type with these methods:
- `New[T](ctx, fn func(ctx) (T, error)) *Future[T]`
- `(f *Future[T]) Await(ctx) (T, error)`

`Await` must return `ctx.Err()` if the awaiter's ctx is cancelled before the future resolves.

**Acceptance:**
- Compiles with Go 1.18+ generics.
- `goleak.VerifyTestMain(m)` passes in tests.
- A cancelled-await test passes within 50ms (no deadlock).

**Solution sketch:** see middle.md "Generic Future[T] Type".

---

## Task 5. AwaitAll

Write `AwaitAll[T any](ctx context.Context, futs ...*Future[T]) ([]T, error)` that returns all results in order or the first error.

**Acceptance:**
- Wall time is `max(t_i)`, not `sum(t_i)`.
- First error short-circuits (subsequent futures continue, but the function returns).
- Cancellation of `ctx` causes early return with `ctx.Err()`.

**Solution sketch:**

```go
func AwaitAll[T any](ctx context.Context, futs ...*Future[T]) ([]T, error) {
    results := make([]T, len(futs))
    for i, fu := range futs {
        v, err := fu.Await(ctx)
        if err != nil { return nil, err }
        results[i] = v
    }
    return results, nil
}
```

---

## Task 6. AwaitAny

Write `AwaitAny[T any](ctx, futs...) (T, error)` returning the first successful result, or an aggregate error if all fail.

**Acceptance:**
- Returns as soon as any future succeeds.
- If all fail, returns a wrapping error mentioning the last failure.
- Cancellation returns `ctx.Err()`.

**Solution sketch:** see middle.md "AwaitAny".

---

## Task 7. Cancel losers in AwaitAny

Improve Task 6: when a future succeeds, cancel the rest so they stop consuming resources.

**Acceptance:**
- Pass a child `context.Context` to each future at creation time.
- After the first success, `cancel()` is called.
- Losers observe `ctx.Done()` and exit promptly.

**Hint:** This requires the *futures themselves* to honour ctx end-to-end. Wrap the test work to confirm.

**Solution sketch:**

```go
func AwaitAnyCancel[T any](
    parent context.Context,
    factories ...func(context.Context) *Future[T],
) (T, error) {
    ctx, cancel := context.WithCancel(parent)
    defer cancel()
    futs := make([]*Future[T], len(factories))
    for i, mk := range factories {
        futs[i] = mk(ctx)
    }
    return AwaitAny(ctx, futs...)
}
```

---

## Task 8. Memoized future

Build a `Memo[T]` type so that:
- The work runs at most once.
- Any number of `Await`s return the same result.
- Late arrivals (after resolution) return immediately.

**Acceptance:**
- Test with 100 concurrent awaits, all of which must see the same value.
- A counter in the work function must equal 1.

**Solution sketch:**

```go
type Memo[T any] struct {
    once sync.Once
    val  T
    err  error
    done chan struct{}
    fn   func(context.Context) (T, error)
}

func NewMemo[T any](fn func(context.Context) (T, error)) *Memo[T] {
    return &Memo[T]{done: make(chan struct{}), fn: fn}
}

func (m *Memo[T]) Await(ctx context.Context) (T, error) {
    m.once.Do(func() {
        go func() {
            defer close(m.done)
            m.val, m.err = m.fn(context.Background())
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

---

## Task 9. Map combinator

Write `Map[A, B](in *Future[A], f func(A) B) *Future[B]`.

**Acceptance:**
- `f` is called once if `in` succeeds.
- If `in` fails, the new future also fails with the same error and `f` is not called.

**Solution sketch:** see middle.md.

---

## Task 10. FlatMap combinator

Write `FlatMap[A, B](in *Future[A], f func(ctx, A) *Future[B]) *Future[B]`.

**Acceptance:**
- The result is a `Future[B]`, not a `Future[*Future[B]]`.
- `f` is called once if `in` succeeds.

**Solution sketch:** see middle.md.

---

## Task 11. Hedge

Write `Hedge[T](ctx, delay, do) (T, error)` that:
- Starts the work immediately.
- If no result by `delay`, starts a second copy.
- Returns the first successful result and cancels the loser.

**Acceptance:**
- Wall time is at most p95(work), even when the first request is slow.
- The losing goroutine exits within a small constant time after the winner is selected.

**Solution sketch:** see senior.md "Request Hedging".

---

## Task 12. Convert errgroup code to futures (and back)

Take this errgroup code:

```go
func loadProfile(ctx context.Context, id string) (Profile, error) {
    g, ctx := errgroup.WithContext(ctx)
    var u User; var o []Order
    g.Go(func() error { x, err := loadUser(ctx, id); u = x; return err })
    g.Go(func() error { x, err := loadOrders(ctx, id); o = x; return err })
    if err := g.Wait(); err != nil { return Profile{}, err }
    return Profile{User: u, Orders: o}, nil
}
```

Rewrite using `Future[User]` and `Future[[]Order]` and `AwaitAll`. Compare readability.

Then rewrite *the future version* back to errgroup.

**Acceptance:**
- All three versions compile and pass the same test.
- A note in comments about which you find more readable and why.

**Suggested verdict:** the errgroup version is shorter for fan-shaped work; the futures version is better if you wanted to pass `u` and `o` futures elsewhere first.

---

## Task 13. Detect a leak

Given this code:

```go
func FetchOrTimeout(url string, d time.Duration) (string, error) {
    out := make(chan string)        // BUG?
    go func() {
        body, _ := fetch(url)
        out <- body
    }()
    select {
    case b := <-out:
        return b, nil
    case <-time.After(d):
        return "", errors.New("timeout")
    }
}
```

1. Identify the bug.
2. Write a test using `goleak` that fails because of the bug.
3. Fix it.

**Hint:** Unbuffered channel.

**Solution sketch:** `out := make(chan string, 1)` to allow the goroutine to send and exit even when the awaiter timed out.

---

## Task 14. Singleflight by hand

Without using `golang.org/x/sync/singleflight`, write a `Group` type with method `Do(key string, fn func() (any, error)) (any, error, bool)` that:
- Coalesces concurrent calls with the same key into one execution of `fn`.
- Returns the result of that one call to all concurrent callers.
- The third return is `true` if the call was deduplicated, `false` for the original caller.

**Acceptance:**
- Test: 1000 goroutines call `Do("k", expensive)` simultaneously. `expensive` runs once.
- All goroutines receive the same value.
- After the call completes, a *later* call to `Do("k", ...)` runs `fn` again (no caching, only coalescing).

**Solution sketch:**

```go
type Group struct {
    mu sync.Mutex
    m  map[string]*call
}

type call struct {
    wg  sync.WaitGroup
    val any
    err error
    dup bool
}

func (g *Group) Do(key string, fn func() (any, error)) (any, error, bool) {
    g.mu.Lock()
    if g.m == nil { g.m = make(map[string]*call) }
    if c, ok := g.m[key]; ok {
        g.mu.Unlock()
        c.wg.Wait()
        return c.val, c.err, true
    }
    c := &call{}
    c.wg.Add(1)
    g.m[key] = c
    g.mu.Unlock()

    c.val, c.err = fn()
    c.wg.Done()

    g.mu.Lock()
    delete(g.m, key)
    g.mu.Unlock()
    return c.val, c.err, false
}
```

---

## Task 15. Build the smallest possible deferred-future type

A `Lazy[T]` whose work only starts on the first `Await`.

**Acceptance:**
- If `Await` is never called, the work never runs.
- If called multiple times, the work runs once.

**Solution sketch:** see senior.md "Eager vs Deferred Promises".

---

## Task 16. Replace a callback-style API with futures

Given:

```go
type Worker interface {
    Submit(req Request, cb func(Response, error))
}
```

Wrap it to expose:

```go
type FutureWorker interface {
    SubmitAsync(req Request) *Future[Response]
}
```

**Acceptance:**
- One callback always fires the future.
- No goroutine leak even if the callback never fires (you must add a timeout or rely on caller ctx).

**Solution sketch:**

```go
func wrap(w Worker) FutureWorker {
    return &wrappedWorker{w}
}

type wrappedWorker struct { w Worker }

func (ww *wrappedWorker) SubmitAsync(req Request) *Future[Response] {
    f := &Future[Response]{ch: make(chan Result[Response], 1)}
    ww.w.Submit(req, func(r Response, err error) {
        f.ch <- Result[Response]{Val: r, Err: err}
    })
    return f
}
```

If the callback might never fire, layer a timeout: pass ctx to `Await`.

---

## Task 17. Request graph

Implement a small request-graph runner: nodes have keys, dependencies, and a compute function. `Resolve(ctx, key)` returns the value, computing each node at most once and reusing across paths.

**Acceptance:**
- Diamond graph (A -> B, A -> C, B -> D, C -> D) calls `A` exactly once even though both `B` and `C` depend on it.
- Cycle detection at construction time.

**Solution sketch:** see professional.md "Batch Build Systems" and the staff interview Q14.

---

## Task 18. Future telemetry wrapper

Wrap your `Future[T]` type so that creating and awaiting a future records:
- a `prometheus.Counter` of total futures created (labelled by `name`)
- a `prometheus.Histogram` of creation-to-fulfilment latency (labelled by `name`, `status`)
- a `prometheus.Gauge` of currently in-flight futures

**Acceptance:**
- Tests do not require a live Prometheus server; use the in-process registry.
- The counter increments exactly once per future.

**Solution sketch:** see senior.md "Observability for Futures".

---

## Task 19. Stress test

Write a stress test that:
1. Spawns 10,000 futures.
2. Awaits half of them (`AwaitAll`).
3. Abandons the other half.
4. Verifies (via `runtime.NumGoroutine`) that the goroutine count returns to baseline within 500ms after the test ends.

**Acceptance:**
- No leak.
- Total memory growth bounded.

**Hint:** Need a buffered channel; need each future's work to honour ctx; abandoned futures must rely on the buffer to let the producer exit.

---

## Task 20. Cross-language port

Take this JavaScript code:

```js
async function getProfile(id) {
    const [user, orders, friends] = await Promise.all([
        fetch(`/user/${id}`).then(r => r.json()),
        fetch(`/orders?u=${id}`).then(r => r.json()),
        fetch(`/friends?u=${id}`).then(r => r.json()),
    ]);
    return { user, orders, friends };
}
```

Port it to Go using:
1. `errgroup` (the idiomatic version).
2. `Future[T]` (your typed version).

**Acceptance:**
- Both versions fetch concurrently.
- Both honour a passed `ctx`.
- A short comparison in comments — which feels more Go-idiomatic?

**Hint:** errgroup is shorter and is what most Go reviewers prefer.

---

## Final notes

If you finish all 20 tasks, you have written every variant of the pattern that production Go services use. The leap from there is *design judgement*: knowing when not to use a future at all, when to memoize, when to hedge. That comes from running the patterns in real systems and watching the dashboards.

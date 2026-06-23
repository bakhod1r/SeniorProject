# Future / Promise Pattern — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Generic `Future[T]` Type](#generic-futuret-type)
3. [Error Handling with `Result[T]`](#error-handling-with-resultt)
4. [Cancellation with `context.Context`](#cancellation-with-contextcontext)
5. [`AwaitAll` — Wait For Every Future](#awaitall--wait-for-every-future)
6. [`AwaitAny` — First Of Many](#awaitany--first-of-many)
7. [`errgroup` — The Standard "All-or-Nothing"](#errgroup--the-standard-all-or-nothing)
8. [Memoizing Futures](#memoizing-futures)
9. [Composition: `Then`, `Map`, `FlatMap`](#composition-then-map-flatmap)
10. [Timeouts and Deadlines](#timeouts-and-deadlines)
11. [Common Bugs Revisited](#common-bugs-revisited)
12. [Testing Futures Properly](#testing-futures-properly)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

At the junior level you wrote `func XAsync() <-chan Result[T]` and called `<-fut` once. You learned the buffered-channel-of-one rule and survived your first leak. Time to professionalise.

At this level we add:

- A generic `Future[T]` wrapper that hides the channel and exposes methods.
- A canonical `Result[T]` struct everyone in your codebase shares.
- Cancellation via `context.Context` — the future stops if you ask it to.
- The two big combinators: `AwaitAll` and `AwaitAny`.
- The `errgroup` package, the standard library's answer to "wait for all, fail fast".
- Memoization for futures that need to be awaited more than once.
- Composition: chaining one future's output as the next future's input.

By the end of this page, you should be able to design the "data layer" of a Go service where dozens of futures fly around concurrently and the calling code reads like ordinary sequential code.

---

## Generic `Future[T]` Type

The plain `<-chan Result[T]` works but is a little raw. You cannot attach methods, you cannot lazily compose, and the type signature is verbose. A small wrapper improves ergonomics:

```go
package future

import "context"

type Result[T any] struct {
    Val T
    Err error
}

type Future[T any] struct {
    ch chan Result[T]
}

// New starts work concurrently and returns a Future.
// The function f receives the context and produces the result.
func New[T any](ctx context.Context, f func(context.Context) (T, error)) *Future[T] {
    fu := &Future[T]{ch: make(chan Result[T], 1)}
    go func() {
        v, err := f(ctx)
        fu.ch <- Result[T]{Val: v, Err: err}
    }()
    return fu
}

// Await blocks until the value is ready, ctx is cancelled, or returns immediately if ready.
func (f *Future[T]) Await(ctx context.Context) (T, error) {
    select {
    case r := <-f.ch:
        return r.Val, r.Err
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}

// Done returns a channel closed when the future is fulfilled.
func (f *Future[T]) Done() <-chan struct{} {
    done := make(chan struct{})
    go func() {
        <-f.ch
        close(done)
    }()
    return done
}
```

Wait — `Done()` reads the channel and throws the value away. That breaks the future for any later `Await` caller. We will fix this with memoization below.

For now, the canonical pattern: `New` to start the work, `Await` to receive it.

```go
ctx := context.Background()
fut := future.New(ctx, func(ctx context.Context) (User, error) {
    return db.LoadUser(ctx, 42)
})
// ... other work ...
user, err := fut.Await(ctx)
```

The advantage over the bare channel:

- The caller cannot accidentally send into the channel.
- The wrapper holds state that we can extend (memoization, observers).
- A method-call style fits naturally with chaining and combinators.

---

## Error Handling with `Result[T]`

A single `Result[T]` carries both the success value and the error. The receiver consumes both:

```go
r := <-futCh
if r.Err != nil {
    return r.Err
}
use(r.Val)
```

Why one struct instead of two channels? Three reasons:

1. **One allocation.** A `Result` is a value type. A pair-of-channels future allocates two channels.
2. **No "which channel" problem.** With paired channels, both `select` cases must be present even though only one will ever fire. That is a constant tax on every reader.
3. **Cohesion.** The pair (value, error) is what the caller wants. Modelling them together is honest about that.

The cost: even a successful result carries an `error` field, which is a nil interface (two pointer-words). For most domains that is invisible. If you have a hot loop processing millions of futures, you can return only the value channel and signal errors a different way — but that is a senior-level micro-optimisation.

### Pre-1.18 style

Before generics, the same pattern looked like:

```go
type UserResult struct {
    User User
    Err  error
}

func loadUserAsync(id int) <-chan UserResult {
    out := make(chan UserResult, 1)
    go func() {
        u, err := db.LoadUser(id)
        out <- UserResult{User: u, Err: err}
    }()
    return out
}
```

You wrote one `XResult` struct per type. Not pretty but workable. Modern code uses `Result[T any]`.

---

## Cancellation with `context.Context`

The plain pattern from the junior file has no way to cancel work in progress. If you decide you no longer need the value, the goroutine keeps running until it finishes. That is fine for a 10ms DB query; it is wasteful for a 30-second machine-learning inference.

`context.Context` solves this. The worker checks `ctx.Done()` and the awaiter passes a context to `Await`:

```go
func loadAsync(ctx context.Context, id int) *Future[User] {
    return future.New(ctx, func(ctx context.Context) (User, error) {
        return slowLoad(ctx, id)
    })
}

func handler(ctx context.Context, id int) {
    ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
    defer cancel()

    fut := loadAsync(ctx, id)
    user, err := fut.Await(ctx)
    if err != nil {
        // err is ctx.DeadlineExceeded if we timed out
    }
}
```

Two patterns to internalise:

1. **The work function takes ctx.** Inside, every blocking call (DB, HTTP) takes that ctx. The work cancels naturally when the deadline fires.
2. **`Await` takes ctx.** Even if the work itself does not honour ctx, the awaiter can stop waiting and let the goroutine finish on its own (or leak — depending on whether the worker honours ctx).

If the work function ignores `ctx`, cancelling `Await` only abandons the wait; the goroutine continues. That is a leak. **A future must honour ctx end-to-end, or the cancellation is theatre.**

---

## `AwaitAll` — Wait For Every Future

The fan-in of futures. Given N futures of the same type, wait for all of them and collect the results. The first error short-circuits:

```go
func AwaitAll[T any](ctx context.Context, futs ...*Future[T]) ([]T, error) {
    results := make([]T, len(futs))
    for i, fu := range futs {
        v, err := fu.Await(ctx)
        if err != nil {
            return nil, fmt.Errorf("future %d: %w", i, err)
        }
        results[i] = v
    }
    return results, nil
}
```

This version is *sequential* in the await loop, but each underlying goroutine is concurrent — so the wall time is still `max(durations)`, not `sum(durations)`. The sequential await is fine because every future has already been started.

For the all-must-succeed case, this is enough. For "wait for all, gather errors too", you might want:

```go
type AllResult[T any] struct {
    Val T
    Err error
}

func AwaitAllResults[T any](futs ...*Future[T]) []AllResult[T] {
    out := make([]AllResult[T], len(futs))
    for i, fu := range futs {
        v, err := fu.Await(context.Background())
        out[i] = AllResult[T]{Val: v, Err: err}
    }
    return out
}
```

For most production code, the first version (with `errgroup` underneath) wins. We show that below.

---

## `AwaitAny` — First Of Many

The opposite combinator: return as soon as *any* future succeeds. Used for hedging — fire two copies of a slow request, take whichever returns first.

```go
func AwaitAny[T any](ctx context.Context, futs ...*Future[T]) (T, error) {
    type winner struct {
        Val T
        Err error
    }
    ch := make(chan winner, len(futs))

    for _, fu := range futs {
        fu := fu
        go func() {
            v, err := fu.Await(ctx)
            ch <- winner{Val: v, Err: err}
        }()
    }

    var lastErr error
    for i := 0; i < len(futs); i++ {
        select {
        case w := <-ch:
            if w.Err == nil {
                return w.Val, nil
            }
            lastErr = w.Err
        case <-ctx.Done():
            var zero T
            return zero, ctx.Err()
        }
    }

    var zero T
    return zero, fmt.Errorf("all futures failed: %w", lastErr)
}
```

Two subtleties:

1. **The forwarder loop spawns a small extra goroutine per future** so the select in the main loop is "any-of-N" rather than "all-of-N-in-order". The buffer `len(futs)` prevents leaks when the function returns early.
2. **We do not cancel the losers.** That is a separate decision. If you want to, build the futures with a derived context and cancel it the moment you return.

The fully-cancelling version looks like:

```go
func AwaitAnyCancelling[T any](
    parent context.Context,
    factories ...func(context.Context) *Future[T],
) (T, error) {
    ctx, cancel := context.WithCancel(parent)
    defer cancel()

    futs := make([]*Future[T], len(factories))
    for i, mk := range factories {
        futs[i] = mk(ctx)
    }
    v, err := AwaitAny(ctx, futs...)
    cancel() // signal losers to stop
    return v, err
}
```

The loser goroutines see `ctx.Done()` and exit. Hedging done right.

---

## `errgroup` — The Standard "All-or-Nothing"

`golang.org/x/sync/errgroup` is the standard library's answer to "I have N pieces of work, run them in parallel, fail on the first error, otherwise wait for all". It is not a future type, but it solves the same problem when the result is fan-shaped.

```go
import "golang.org/x/sync/errgroup"

func loadAll(ctx context.Context) (User, []Order, Friends, error) {
    g, ctx := errgroup.WithContext(ctx)
    var user User
    var orders []Order
    var friends Friends

    g.Go(func() error {
        u, err := db.LoadUser(ctx, 42)
        user = u
        return err
    })
    g.Go(func() error {
        o, err := db.LoadOrders(ctx, 42)
        orders = o
        return err
    })
    g.Go(func() error {
        f, err := social.LoadFriends(ctx, 42)
        friends = f
        return err
    })

    if err := g.Wait(); err != nil {
        return User{}, nil, Friends{}, err
    }
    return user, orders, friends, nil
}
```

`errgroup.WithContext` returns a derived context that is cancelled as soon as any `g.Go` returns an error. The other workers see `ctx.Done()` and bail out. `g.Wait()` returns the first error (or nil).

When to use `errgroup` versus hand-rolled futures:

- **Use errgroup** when all the work has the same error type, you want all-or-nothing semantics, and you assign results into pre-declared variables.
- **Use Future[T]** when results have heterogeneous types you want to compose individually, or you want to return a single future as a value across module boundaries.

Most production Go uses `errgroup` for the fan-shaped case. The hand-rolled `Future[T]` shines when you need a *handle* to pass around.

---

## Memoizing Futures

A capacity-1 channel only delivers its value once. If two callers want the same result, the second one blocks forever. The fix is to remember the resolved value and answer subsequent awaits from memory.

The simplest memoized future uses `sync.Once`:

```go
type Memo[T any] struct {
    once sync.Once
    val  T
    err  error
    done chan struct{}
}

func NewMemo[T any](work func() (T, error)) *Memo[T] {
    m := &Memo[T]{done: make(chan struct{})}
    go func() {
        m.once.Do(func() {
            m.val, m.err = work()
            close(m.done)
        })
    }()
    return m
}

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

Key changes from the single-shot future:

- The result is stored in struct fields, not the channel.
- `done` is closed (not sent into) — a closed channel returns instantly to *every* receiver.
- `sync.Once` guards initial computation. Not strictly needed since we only call `work` once anyway, but it documents intent.

Every reader of `m.Await` sees the same `(val, err)` pair. The closed channel is the broadcast.

This is the building block for "request coalescing" — `singleflight.Group` in `golang.org/x/sync/singleflight` uses a similar idea to deduplicate concurrent identical requests.

---

## Composition: `Then`, `Map`, `FlatMap`

Async values compose. Given a `Future[A]`, you should be able to derive a `Future[B]` by applying a function. The names come from JavaScript (`.then`), Java (`thenApply`, `thenCompose`), and functional programming (map, flatMap).

### Map

```go
func Map[A, B any](in *Future[A], f func(A) B) *Future[B] {
    out := &Future[B]{ch: make(chan Result[B], 1)}
    go func() {
        v, err := in.Await(context.Background())
        if err != nil {
            var zero B
            out.ch <- Result[B]{Val: zero, Err: err}
            return
        }
        out.ch <- Result[B]{Val: f(v), Err: nil}
    }()
    return out
}
```

Usage:

```go
userFut := loadUserAsync(ctx, 42)
nameFut := future.Map(userFut, func(u User) string { return u.Name })
name, err := nameFut.Await(ctx)
```

### FlatMap (Then)

`FlatMap` is for when `f` itself returns a future. You want a flat `Future[B]`, not a `Future[Future[B]]`.

```go
func FlatMap[A, B any](
    in *Future[A],
    f func(context.Context, A) *Future[B],
) *Future[B] {
    out := &Future[B]{ch: make(chan Result[B], 1)}
    go func() {
        v, err := in.Await(context.Background())
        if err != nil {
            var zero B
            out.ch <- Result[B]{Val: zero, Err: err}
            return
        }
        inner := f(context.Background(), v)
        w, err := inner.Await(context.Background())
        out.ch <- Result[B]{Val: w, Err: err}
    }()
    return out
}
```

Now you can chain:

```go
userFut := loadUserAsync(ctx, 42)
ordersFut := future.FlatMap(userFut, func(ctx context.Context, u User) *Future[[]Order] {
    return loadOrdersAsync(ctx, u.ID)
})
```

This is the building block of all "async pipelines". Combine map and flatMap and you have a monadic future.

In practice, Go programmers rarely build long chains of `.Map().FlatMap().Map()`. The code reads better as plain awaits inside a single function. But for library boundaries where you return a `Future[T]`, composition is essential.

---

## Timeouts and Deadlines

Two flavours:

### Timeout on `Await`

```go
ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
defer cancel()
v, err := fut.Await(ctx)
```

If the future is not ready in 2 seconds, `Await` returns `ctx.DeadlineExceeded`. The underlying goroutine keeps running. If the work function honours ctx, the work also stops.

### Timeout baked into the future

You can also time-bound the future at creation time:

```go
func loadWithTimeout(parent context.Context, id int) *Future[User] {
    ctx, cancel := context.WithTimeout(parent, 2*time.Second)
    return future.New(ctx, func(ctx context.Context) (User, error) {
        defer cancel()
        return db.LoadUser(ctx, id)
    })
}
```

Note `defer cancel()` inside the worker so the cancellation function is called once the work returns successfully. Without that, the timer would leak until the deadline fires.

Pick *one* of the two — applying both is fine but redundant. Most teams put the timeout at the *call site* (`Await`) so each caller controls its own latency budget.

---

## Common Bugs Revisited

You learned three at the junior level. Here are three more.

### Bug A: Forgetting to derive ctx for `AwaitAny`

```go
func AwaitAnyBuggy(ctx context.Context, futs ...*Future[T]) (T, error) {
    // ...
    // returns when the first succeeds
}
// other futures continue burning resources because ctx wasn't cancelled
```

If the futures share the same `ctx`, returning early does not stop them. Derive a child ctx with `context.WithCancel` inside the function and cancel it before returning.

### Bug B: Memoized future with `sync.Mutex` instead of closed channel

A common attempt:

```go
type BadMemo[T any] struct {
    mu    sync.Mutex
    done  bool
    val   T
    err   error
}

func (m *BadMemo[T]) Await() (T, error) {
    m.mu.Lock()
    defer m.mu.Unlock()
    for !m.done {
        // ... how do we wait without holding the lock?
    }
    return m.val, m.err
}
```

You cannot wait while holding a lock. You would need a `sync.Cond` and broadcast, which works but is more code than the closed-channel approach. Always prefer "close a channel to signal" for broadcast in Go.

### Bug C: Capturing range variable in a goroutine that produces a future

```go
futs := make([]*Future[int], 0, 10)
for i := 0; i < 10; i++ {
    futs = append(futs, future.New(ctx, func(ctx context.Context) (int, error) {
        return compute(i), nil // pre-1.22: races on i
    }))
}
```

Pre-1.22 every goroutine sees the same `i`, ending at 10. Go 1.22 fixed this by giving each iteration its own `i`. Until your project pins 1.22+ in `go.mod`, write:

```go
for i := 0; i < 10; i++ {
    i := i // shadow
    futs = append(futs, future.New(ctx, func(ctx context.Context) (int, error) {
        return compute(i), nil
    }))
}
```

---

## Testing Futures Properly

Three things to test:

1. **Resolution.** The future eventually returns the right value.
2. **Cancellation.** The future stops on `ctx.Done()`.
3. **No leak.** When the test ends, no goroutine from this future is still alive.

For (3), use `go.uber.org/goleak`:

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

A failing test with `goleak` looks like:

```
leak: ... created by example.loadAsync at ...:42
```

Use it routinely on packages full of futures. It catches the "buffered channel saves the producer but a select-on-await ignored ctx" class of bugs that nothing else does.

A cancellation test:

```go
func TestFutureCancellation(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    fut := future.New(ctx, func(ctx context.Context) (int, error) {
        select {
        case <-time.After(1 * time.Second):
            return 42, nil
        case <-ctx.Done():
            return 0, ctx.Err()
        }
    })

    cancel()
    _, err := fut.Await(context.Background())
    if !errors.Is(err, context.Canceled) {
        t.Fatalf("got %v, want Canceled", err)
    }
}
```

Note `Await(context.Background())` — we are not awaiting with the cancelled context; we want to see the *future's* error, not the awaiter's.

---

## Cheat Sheet

```
Future[T] WRAPPER
    f := future.New(ctx, func(ctx) (T, error) { ... })
    v, err := f.Await(ctx)

Result[T]
    type Result[T any] struct { Val T; Err error }

AWAITALL    sequential awaits, max(t_i) wall time
AWAITANY    forward via fan-in chan, return on first success
ERRGROUP    standard "all-or-nothing" for void-returning work
MEMO        sync.Once + closed channel = multi-reader future
MAP         Future[A] -> Future[B] via pure function
FLATMAP     Future[A] -> Future[B] via async function
TIMEOUT     ctx, cancel := context.WithTimeout(parent, d)

THREE RULES
  1. Always honour ctx end-to-end.
  2. Always buffer the result channel (cap 1) or close a done channel for memo.
  3. Always run goleak in tests of code that produces futures.
```

---

## Summary

The middle level promotes the raw `<-chan Result[T]` into a typed `Future[T]` with methods. Cancellation enters via `context.Context`, error handling is one struct field, and composition becomes possible: `AwaitAll`, `AwaitAny`, `Map`, `FlatMap`.

For the common "do N pieces of work in parallel" case, the standard library's `errgroup` is the recommended tool — fewer types, clearer error path, ctx already wired in. Hand-rolled futures shine when you need a *handle* to pass around, or when results have heterogeneous types.

Memoized futures (single producer, many consumers) are the second important variant. They are built with `sync.Once` and a closed channel for broadcast. The same idea appears in `singleflight.Group` for request deduplication.

Always run `goleak` in tests. Always honour `ctx` end-to-end. Always buffer the channel.

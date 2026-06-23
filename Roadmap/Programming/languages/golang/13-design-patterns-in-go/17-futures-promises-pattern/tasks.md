# Futures & Promises — Practice Tasks

Fifteen Go exercises that march from a one-shot channel to a Temporal-style durable promise, with detours through `errgroup`, `singleflight`, deadline propagation, and Redis-backed coordination. Difficulty: **B**eginner, **I**ntermediate, **A**dvanced, **S**enior.

Each task gives a Goal, a Starter, Hints, and a folded Reference solution. Read the middle.md first — most of the trade-offs are explained there, the tasks just force you to live with them.

---

## Task 1 — First Future as one-shot channel (B)

**Goal.** Build the cheapest Future possible: a function that starts a goroutine and returns a receive-only channel. The channel receives one value, then closes. No struct, no `sync.Once`, no generics — just `<-chan int`. Get a feel for the shape before you dress it up.

**Starter.**

```go
package futures

func Async(fn func() int) <-chan int {
    // TODO: start a goroutine, send result on a buffered chan, close it.
}
```

**Hints.**

- Buffer the channel with capacity 1. Unbuffered means the goroutine blocks forever if no one ever awaits.
- Close the channel after the send so a second receive returns the zero value rather than blocking.
- `select` on `<-ch` and a `time.After` to await with a timeout.

<details><summary>Reference solution</summary>

```go
package futures

func Async(fn func() int) <-chan int {
    // Senior decision: buffered(1) means the producer never blocks if the
    // consumer abandons the Future. Unbuffered would leak a goroutine
    // every time someone called Async() but never read the channel.
    ch := make(chan int, 1)
    go func() {
        ch <- fn()
        close(ch)
    }()
    return ch
}

// Caller pattern:
//
//   f := Async(func() int { time.Sleep(time.Second); return 42 })
//   // ... do other work ...
//   v := <-f
//   fmt.Println(v)
//
// Or with timeout:
//
//   select {
//   case v := <-f:
//       fmt.Println(v)
//   case <-time.After(500 * time.Millisecond):
//       fmt.Println("timed out")
//   }
```

What you should believe after this:
- A Future in Go is a *direction* on a channel (`<-chan`), not a wrapper class.
- Closing the channel is optional but kind; it lets the consumer use `for range` or distinguish zero-value from closed.
- The producer's goroutine outlives the function call, which is the entire point — and the entire cost — of asynchrony.

</details>

---

## Task 2 — Future with error (Result[T]) (B)

**Goal.** Real work can fail. Return a `Result[T]` wrapping value + error on a single channel, so the consumer always gets exactly one well-typed message. No multi-return channels. No panics on error.

**Starter.**

```go
type Result[T any] struct {
    Val T
    Err error
}

func AsyncR[T any](fn func() (T, error)) <-chan Result[T] {
    // TODO
}
```

**Hints.**

- Don't use two channels (one for value, one for error). The consumer would have to `select` on both, and the wrong order leads to bugs.
- A struct on a single channel is the idiomatic Go shape for "either or".
- The zero-value of `Result[T]` is a *valid* but unhelpful state. Don't read the channel twice expecting a real value the second time.

<details><summary>Reference solution</summary>

```go
package futures

type Result[T any] struct {
    Val T
    Err error
}

func AsyncR[T any](fn func() (T, error)) <-chan Result[T] {
    // Senior decision: one channel, one struct. The alternative — two
    // channels, one for value and one for error — leads to "wait, which
    // one fires first?" select bugs that the type system can't catch.
    ch := make(chan Result[T], 1)
    go func() {
        v, err := fn()
        ch <- Result[T]{Val: v, Err: err}
        close(ch)
    }()
    return ch
}

// Caller pattern:
//
//   f := AsyncR(func() (User, error) {
//       return fetchUser(ctx, "alice")
//   })
//   r := <-f
//   if r.Err != nil {
//       return r.Err
//   }
//   use(r.Val)
```

The `Result[T]` pattern is the building block for every higher-level Future combinator below. Once you've internalized "values flow as `Result[T]`", `Map`, `All`, and `First` become small.

</details>

---

## Task 3 — Future with ctx cancellation (B)

**Goal.** A Future that respects `context.Context`. The producer must observe `ctx.Done()` and return early; the consumer awaits with the same context and gives up cleanly. No leaked goroutines, no zombie work.

**Starter.**

```go
func AsyncCtx[T any](ctx context.Context, fn func(context.Context) (T, error)) <-chan Result[T] {
    // TODO
}
```

**Hints.**

- Pass the *same* ctx into `fn`. Otherwise the producer can't react to the deadline you set on the consumer side.
- The consumer's await `select` watches both the future-channel and `ctx.Done()`. The first to fire wins.
- Even when the consumer gives up, the producer's goroutine keeps running unless `fn` checks ctx. Document this.

<details><summary>Reference solution</summary>

```go
package futures

import "context"

func AsyncCtx[T any](ctx context.Context, fn func(context.Context) (T, error)) <-chan Result[T] {
    ch := make(chan Result[T], 1)
    go func() {
        // Senior decision: forward the SAME ctx to fn. A common bug is
        // creating a fresh background context inside the goroutine,
        // which silently disables every deadline the caller set.
        v, err := fn(ctx)
        select {
        case ch <- Result[T]{Val: v, Err: err}:
        case <-ctx.Done():
            // Caller is gone — non-blocking send, then bail.
            // Channel is buffered(1), so this path is mostly dead code,
            // but kept for documentation.
        }
        close(ch)
    }()
    return ch
}

// Await wrapper that watches ctx alongside the channel.
func Await[T any](ctx context.Context, f <-chan Result[T]) (T, error) {
    var zero T
    select {
    case r := <-f:
        return r.Val, r.Err
    case <-ctx.Done():
        return zero, ctx.Err()
    }
}

// Caller pattern:
//
//   ctx, cancel := context.WithTimeout(parent, 200*time.Millisecond)
//   defer cancel()
//   f := AsyncCtx(ctx, fetchUserCtx)
//   user, err := Await(ctx, f)
//   if errors.Is(err, context.DeadlineExceeded) { ... }
```

Important distinction: `Await` returning `ctx.Err()` means the *consumer* gave up. It does NOT mean the work finished. The goroutine may still be running. If `fn` honors ctx, it'll stop on its own. If not, you have a leak.

</details>

---

## Task 4 — sync.Once-guarded resolve (B)

**Goal.** Wrap Result into a `*Promise[T]` struct with `Resolve`, `Reject`, and `Await` methods. Two key properties: (1) the second `Resolve` (or `Reject` after `Resolve`) must be a silent no-op, not a panic; (2) `Await` must be safe to call from N goroutines, all receiving the same result.

**Starter.**

```go
type Promise[T any] struct {
    // TODO: done chan, value, err, once
}

func NewPromise[T any]() *Promise[T]                       { /* TODO */ }
func (p *Promise[T]) Resolve(v T)                          { /* TODO */ }
func (p *Promise[T]) Reject(err error)                     { /* TODO */ }
func (p *Promise[T]) Await(ctx context.Context) (T, error) { /* TODO */ }
```

**Hints.**

- `sync.Once` is exactly what protects "set state once, close channel once". Don't roll your own atomic-bool.
- Storing the value/err is safe even without further locks because `close(done)` happens-before any receive — so readers always see the writes that preceded the close.
- `Await` is `select { case <-p.done: ...; case <-ctx.Done(): ... }`.

<details><summary>Reference solution</summary>

```go
package futures

import (
    "context"
    "sync"
)

type Promise[T any] struct {
    done chan struct{}
    val  T
    err  error
    once sync.Once
}

func NewPromise[T any]() *Promise[T] {
    return &Promise[T]{done: make(chan struct{})}
}

func (p *Promise[T]) Resolve(v T) {
    // Senior decision: sync.Once protects BOTH the write to val/err AND
    // the close. A double-close panics; double-write is a data race
    // even though either value would be "valid". Guard it once, cleanly.
    p.once.Do(func() {
        p.val = v
        close(p.done)
    })
}

func (p *Promise[T]) Reject(err error) {
    p.once.Do(func() {
        p.err = err
        close(p.done)
    })
}

func (p *Promise[T]) Await(ctx context.Context) (T, error) {
    select {
    case <-p.done:
        return p.val, p.err
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}

func (p *Promise[T]) Done() <-chan struct{} { return p.done }
```

The happens-before guarantee around channel close is the linchpin: any goroutine that observes the close has also observed the writes to `val` and `err` made before the close. No additional mutex on reads is needed. This is the single most useful Go memory model fact for building Futures.

Test with `go test -race`:

```go
func TestPromiseRace(t *testing.T) {
    p := NewPromise[int]()
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); p.Resolve(42) }()
    }
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            v, _ := p.Await(context.Background())
            if v != 42 { t.Errorf("got %d", v) }
        }()
    }
    wg.Wait()
}
```

</details>

---

## Task 5 — Generic Future[T] struct (I)

**Goal.** Promote the `Promise[T]` from Task 4 into a proper `Future[T]` that combines producer and consumer responsibilities: `Future[T]` is what callers receive; the producer side gets `Resolver[T]` (a tiny capability to fulfil it). Separating "I can read the result" from "I can write the result" is a small refactor with big API benefits.

**Starter.**

```go
type Future[T any]   struct { /* TODO */ }
type Resolver[T any] struct { /* TODO */ }

// Returns a paired (future, resolver). The future is what you hand to
// callers; the resolver is what your producer goroutine uses internally.
func NewFuture[T any]() (*Future[T], *Resolver[T]) { /* TODO */ }
```

**Hints.**

- Internally, both types point to the same shared state (one struct).
- A caller who only holds `*Future[T]` *cannot* call `Resolve` — that's the encapsulation win.
- Add `Future.Await(ctx)` and a `Go` helper that pairs creation with goroutine launch.

<details><summary>Reference solution</summary>

```go
package futures

import (
    "context"
    "sync"
)

type futureState[T any] struct {
    done chan struct{}
    val  T
    err  error
    once sync.Once
}

type Future[T any] struct {
    s *futureState[T]
}

type Resolver[T any] struct {
    s *futureState[T]
}

func NewFuture[T any]() (*Future[T], *Resolver[T]) {
    // Senior decision: separate read/write sides into different types.
    // Callers receive *Future[T] and cannot accidentally Resolve it.
    // Producers receive *Resolver[T] and cannot accidentally Await
    // (which would deadlock if the producer's the only resolver).
    s := &futureState[T]{done: make(chan struct{})}
    return &Future[T]{s: s}, &Resolver[T]{s: s}
}

func (r *Resolver[T]) Resolve(v T) {
    r.s.once.Do(func() {
        r.s.val = v
        close(r.s.done)
    })
}

func (r *Resolver[T]) Reject(err error) {
    r.s.once.Do(func() {
        r.s.err = err
        close(r.s.done)
    })
}

func (f *Future[T]) Await(ctx context.Context) (T, error) {
    select {
    case <-f.s.done:
        return f.s.val, f.s.err
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}

func (f *Future[T]) Done() <-chan struct{} { return f.s.done }

// Convenience helper that pairs creation + goroutine launch.
func Go[T any](ctx context.Context, fn func(context.Context) (T, error)) *Future[T] {
    f, r := NewFuture[T]()
    go func() {
        v, err := fn(ctx)
        if err != nil { r.Reject(err); return }
        r.Resolve(v)
    }()
    return f
}
```

The split-API mirrors how JavaScript Promises work under the hood: `new Promise((resolve, reject) => ...)` separates the capability to fulfil from the value itself. Go's type system makes this explicit.

</details>

---

## Task 6 — Lazy Future (await triggers computation) (I)

**Goal.** Build a `Lazy[T]` whose `fn` runs only on the first `Await`. Subsequent `Await` calls return the cached result without re-running. Concurrent awaits while the first is in flight should all wait, not race.

**Starter.**

```go
type Lazy[T any] struct {
    // TODO: once, fn, val, err
}

func NewLazy[T any](fn func(context.Context) (T, error)) *Lazy[T] { /* TODO */ }
func (l *Lazy[T]) Await(ctx context.Context) (T, error)          { /* TODO */ }
```

**Hints.**

- `sync.Once` runs `fn` exactly once. Concurrent callers all block on `once.Do` until the first finishes.
- The wrinkle: `once.Do` doesn't accept a ctx. If the first caller's ctx expires mid-computation, what happens to the second caller's ctx? Decide and document.
- For cancellation-aware lazy: use a `sync.Mutex` + `state` field instead of `sync.Once`, so you can re-attempt after a previous failure.

<details><summary>Reference solution</summary>

```go
package futures

import (
    "context"
    "sync"
)

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
    // Senior decision: l.fn runs with the FIRST awaiter's ctx. Subsequent
    // awaiters share the cached result, including any error. This means
    // a Lazy is poisoned by its first failure — a different design would
    // be to retry on subsequent calls (see RetryLazy below).
    l.once.Do(func() {
        l.val, l.err = l.fn(ctx)
    })
    return l.val, l.err
}

// Variant: cancellation-safe Lazy that lets a fresh ctx retry after
// the first attempt was cancelled.
type RetryLazy[T any] struct {
    mu       sync.Mutex
    done     bool
    inFlight *sync.WaitGroup
    val      T
    err      error
    fn       func(context.Context) (T, error)
}

func NewRetryLazy[T any](fn func(context.Context) (T, error)) *RetryLazy[T] {
    return &RetryLazy[T]{fn: fn}
}

func (l *RetryLazy[T]) Await(ctx context.Context) (T, error) {
    l.mu.Lock()
    if l.done {
        defer l.mu.Unlock()
        return l.val, l.err
    }
    if l.inFlight != nil {
        // Another goroutine is computing — join the wait.
        wg := l.inFlight
        l.mu.Unlock()
        wg.Wait()
        l.mu.Lock()
        defer l.mu.Unlock()
        return l.val, l.err
    }
    // We're the first. Mark in-flight, drop the lock, compute.
    wg := &sync.WaitGroup{}
    wg.Add(1)
    l.inFlight = wg
    l.mu.Unlock()

    v, err := l.fn(ctx)

    l.mu.Lock()
    // Senior decision: only commit on success. A failed attempt with a
    // cancelled ctx should let the NEXT caller retry. Otherwise a single
    // network blip poisons the Lazy forever, which is rarely what you want.
    if err == nil || ctx.Err() == nil {
        l.val, l.err = v, err
        l.done = true
    }
    l.inFlight = nil
    wg.Done()
    return v, err
}
```

When to use Lazy: when the value might never be needed (option chains, fallback values, expensive validators). When NOT to use Lazy: when the latency is on the critical path and you can overlap it with other work — go eager.

</details>

---

## Task 7 — errgroup-based parallel fetch with first-error abort (I)

**Goal.** Fetch a User, their Orders, and their Recommendations in parallel using `golang.org/x/sync/errgroup`. If any of the three errors, cancel the other two. Return the first error. Write a test that proves the cancellation happens (one slow call sees `ctx.Done()`).

**Starter.**

```go
type Profile struct {
    User   User
    Orders []Order
    Recos  []Recommendation
}

func FetchProfile(ctx context.Context, be Backend, id string) (Profile, error) {
    // TODO: errgroup.WithContext, three g.Go calls, g.Wait, assemble.
}
```

**Hints.**

- `errgroup.WithContext(ctx)` returns a *derived* ctx. Pass *that* into the sub-fetchers, not the original.
- Inside the closures, capture variables by value (`item := item`) if you're in a loop pre-Go-1.22.
- `g.Wait()` returns the first error; subsequent errors from other goroutines are silently dropped (but their ctx is cancelled).

<details><summary>Reference solution</summary>

```go
package futures

import (
    "context"

    "golang.org/x/sync/errgroup"
)

type User struct{ ID, Name string }
type Order struct{ ID string }
type Recommendation struct{ SKU string }

type Profile struct {
    User   User
    Orders []Order
    Recos  []Recommendation
}

type Backend interface {
    FetchUser(ctx context.Context, id string) (User, error)
    FetchOrders(ctx context.Context, id string) ([]Order, error)
    FetchRecos(ctx context.Context, id string) ([]Recommendation, error)
}

func FetchProfile(ctx context.Context, be Backend, id string) (Profile, error) {
    // Senior decision: WithContext gives us a derived ctx that's
    // cancelled the moment any g.Go returns an error. Every sub-fetcher
    // MUST use gctx (not the original ctx) for this to work.
    g, gctx := errgroup.WithContext(ctx)

    var p Profile
    g.Go(func() error {
        u, err := be.FetchUser(gctx, id)
        p.User = u // safe: we read p only after g.Wait()
        return err
    })
    g.Go(func() error {
        o, err := be.FetchOrders(gctx, id)
        p.Orders = o
        return err
    })
    g.Go(func() error {
        r, err := be.FetchRecos(gctx, id)
        p.Recos = r
        return err
    })

    if err := g.Wait(); err != nil {
        return Profile{}, err
    }
    return p, nil
}

// Test that cancellation propagates.
//
//   func TestFirstErrorCancels(t *testing.T) {
//       be := &fakeBackend{
//           userErr:    errors.New("user-down"),
//           ordersHang: 200 * time.Millisecond,
//           recosHang:  200 * time.Millisecond,
//       }
//       ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
//       defer cancel()
//       _, err := FetchProfile(ctx, be, "id")
//       if err == nil || err.Error() != "user-down" {
//           t.Fatalf("want user-down, got %v", err)
//       }
//       // If errgroup didn't cancel correctly, the Orders/Recos goroutines
//       // would still be running and the test would race them.
//   }
```

One subtle point: writing into `p.User`, `p.Orders`, `p.Recos` from three goroutines is safe *only because* each writes a different field. If two goroutines wrote the same field, you'd need a mutex even though the writes happen-before `g.Wait()`. The race detector catches this in practice; the language spec does not.

</details>

---

## Task 8 — singleflight for dedup (I)

**Goal.** Wrap an expensive `loadUser(id)` so that N simultaneous callers asking for the same id share one underlying call. The 99 extra callers wait for the in-flight one and get a copy of its result. Use `golang.org/x/sync/singleflight`. Prove with a counter: 1000 concurrent callers asking for the same id should produce exactly 1 backend call.

**Starter.**

```go
type UserLoader struct {
    g    singleflight.Group
    load func(ctx context.Context, id string) (User, error)
}

func (l *UserLoader) Get(ctx context.Context, id string) (User, error) {
    // TODO: use l.g.Do, type-assert the result.
}
```

**Hints.**

- `g.Do(key, fn)` returns `(any, error, shared bool)`. The third return tells you whether your call was deduped or original.
- `Forget(key)` clears the in-flight entry. Useful if a transient failure shouldn't poison future callers.
- The shared `error` value: if the in-flight call fails, *every* deduped caller gets the same error. Make sure the error is safe to share (don't include caller-specific context).

<details><summary>Reference solution</summary>

```go
package futures

import (
    "context"
    "sync/atomic"

    "golang.org/x/sync/singleflight"
)

type UserLoader struct {
    g       singleflight.Group
    load    func(ctx context.Context, id string) (User, error)
    backend int64 // atomic counter for testing
}

func NewUserLoader(load func(ctx context.Context, id string) (User, error)) *UserLoader {
    return &UserLoader{load: load}
}

func (l *UserLoader) Get(ctx context.Context, id string) (User, error) {
    // Senior decision: the singleflight Group lives on the loader, not
    // global. Two loaders with different backends shouldn't share an
    // in-flight pool. Also: never call Forget unless you have a specific
    // "don't cache this failure" reason; the default is fine.
    v, err, _ := l.g.Do(id, func() (any, error) {
        atomic.AddInt64(&l.backend, 1)
        return l.load(ctx, id)
    })
    if err != nil {
        return User{}, err
    }
    return v.(User), nil
}

// Test it:
//
//   func TestSingleflightDedups(t *testing.T) {
//       l := NewUserLoader(func(ctx context.Context, id string) (User, error) {
//           time.Sleep(50 * time.Millisecond)
//           return User{ID: id}, nil
//       })
//       var wg sync.WaitGroup
//       for i := 0; i < 1000; i++ {
//           wg.Add(1)
//           go func() {
//               defer wg.Done()
//               _, _ = l.Get(context.Background(), "alice")
//           }()
//       }
//       wg.Wait()
//       if got := atomic.LoadInt64(&l.backend); got != 1 {
//           t.Errorf("backend calls = %d, want 1", got)
//       }
//   }
```

Watch out for one trap: the ctx passed to `Do` is the *first* caller's ctx. If the first caller cancels, the in-flight call may be cancelled — and every deduped caller sees the cancellation error too. For long-lived shared work, use a background-derived ctx inside `Do`.

</details>

---

## Task 9 — All/First combinators (I)

**Goal.** Build two combinators over `*Future[T]` from Task 5: `All(futures...)` resolves when every input resolves, returning `[]T` (fails fast on first error); `First(futures...)` resolves with the first success and ignores subsequent results. Both must be cancellation-aware.

**Starter.**

```go
func All[T any](ctx context.Context, fs ...*Future[T]) ([]T, error) { /* TODO */ }
func First[T any](ctx context.Context, fs ...*Future[T]) (T, error) { /* TODO */ }
```

**Hints.**

- `All` is `len(fs)` Awaits in series, collecting results, returning early on error.
- `First` needs a `select` over every `Future.Done()` channel. With unknown N, use a per-future goroutine that writes to a shared channel.
- Returning early from `First` doesn't cancel the losers — their goroutines keep running. Document this. The fix is to thread ctx into the producer-side, which we do in Task 13.

<details><summary>Reference solution</summary>

```go
package futures

import "context"

func All[T any](ctx context.Context, fs ...*Future[T]) ([]T, error) {
    out := make([]T, len(fs))
    for i, f := range fs {
        v, err := f.Await(ctx)
        if err != nil {
            // Senior decision: fail fast. The other futures keep running
            // (they don't know we gave up). If you also want them
            // cancelled, use Task 7's errgroup pattern instead.
            return nil, err
        }
        out[i] = v
    }
    return out, nil
}

func First[T any](ctx context.Context, fs ...*Future[T]) (T, error) {
    var zero T
    if len(fs) == 0 {
        return zero, context.Canceled
    }
    type resOrErr struct {
        v   T
        err error
    }
    ch := make(chan resOrErr, len(fs))
    for _, f := range fs {
        go func(f *Future[T]) {
            v, err := f.Await(ctx)
            ch <- resOrErr{v, err}
        }(f)
    }
    // Senior decision: count errors so we don't return a zero-value if
    // every future fails. Return the LAST error in that case (could also
    // collect them all via errors.Join).
    var lastErr error
    for i := 0; i < len(fs); i++ {
        select {
        case r := <-ch:
            if r.err == nil {
                return r.v, nil
            }
            lastErr = r.err
        case <-ctx.Done():
            return zero, ctx.Err()
        }
    }
    return zero, lastErr
}

// Variant: WaitAll — wait for all, collect both values and errors,
// don't fail fast. Useful for status pages and dashboards.
func WaitAll[T any](ctx context.Context, fs ...*Future[T]) ([]Result[T], error) {
    out := make([]Result[T], len(fs))
    for i, f := range fs {
        v, err := f.Await(ctx)
        out[i] = Result[T]{Val: v, Err: err}
        if ctx.Err() != nil {
            return out, ctx.Err()
        }
    }
    return out, nil
}
```

Three idioms, three semantics — pick the one that matches the question you're asking:
- `All` = "I need everything; if anything's missing, I'm done."
- `First` = "I want the fastest answer; losers, I don't care."
- `WaitAll` = "I want a status report on each; partial failures are okay."

</details>

---

## Task 10 — Promise pipeline (Future-of-Future chaining) (A)

**Goal.** Implement `Then[T, U]`: take a `*Future[T]` and a transform function `fn(T) *Future[U]`, return a `*Future[U]` that resolves after both stages. This is the `.then()` method JavaScript users miss. Multi-stage chaining (`Then(Then(f1, fn1), fn2)`) must work without exotic plumbing.

**Starter.**

```go
func Then[T, U any](
    ctx context.Context,
    f *Future[T],
    fn func(context.Context, T) *Future[U],
) *Future[U] {
    // TODO: launch a goroutine that awaits f, calls fn, awaits the result,
    // then forwards into the output Future[U].
}
```

**Hints.**

- The output Future's resolver is what your bridge goroutine writes to.
- Don't flatten the inner Future eagerly — let `fn` decide whether to start work or be lazy.
- Errors from either stage propagate to the output. No partial state.

<details><summary>Reference solution</summary>

```go
package futures

import "context"

func Then[T, U any](
    ctx context.Context,
    f *Future[T],
    fn func(context.Context, T) *Future[U],
) *Future[U] {
    out, resolver := NewFuture[U]()
    go func() {
        // Senior decision: one bridge goroutine per Then. A chain of N
        // Thens spawns N goroutines. That's fine — they're short-lived
        // (await + forward). The alternative (single dispatcher goroutine
        // per chain) is faster but much harder to write correctly.
        v, err := f.Await(ctx)
        if err != nil {
            resolver.Reject(err)
            return
        }
        next := fn(ctx, v)
        v2, err := next.Await(ctx)
        if err != nil {
            resolver.Reject(err)
            return
        }
        resolver.Resolve(v2)
    }()
    return out
}

// Map: synchronous transform (no Future returned by fn).
func Map[T, U any](
    ctx context.Context,
    f *Future[T],
    fn func(T) (U, error),
) *Future[U] {
    out, resolver := NewFuture[U]()
    go func() {
        v, err := f.Await(ctx)
        if err != nil { resolver.Reject(err); return }
        u, err := fn(v)
        if err != nil { resolver.Reject(err); return }
        resolver.Resolve(u)
    }()
    return out
}

// Recover: handle an error and convert to a successful value.
func Recover[T any](
    ctx context.Context,
    f *Future[T],
    fn func(error) (T, error),
) *Future[T] {
    out, resolver := NewFuture[T]()
    go func() {
        v, err := f.Await(ctx)
        if err == nil { resolver.Resolve(v); return }
        recovered, rerr := fn(err)
        if rerr != nil { resolver.Reject(rerr); return }
        resolver.Resolve(recovered)
    }()
    return out
}

// Chain example:
//
//   userF := Go(ctx, fetchUser)
//   ordersF := Then(ctx, userF, func(ctx context.Context, u User) *Future[[]Order] {
//       return Go(ctx, func(ctx context.Context) ([]Order, error) {
//           return fetchOrders(ctx, u.ID)
//       })
//   })
//   reportF := Map(ctx, ordersF, func(orders []Order) (Report, error) {
//       return summarize(orders)
//   })
//   report, err := reportF.Await(ctx)
```

Whether this is idiomatic Go is a fair debate. The Go community generally prefers explicit sequencing (`if err != nil` between each step) over Promise chains. But: for fan-out-then-combine flows where you really do want the next step decoupled from the previous step's caller, `Then` is the right shape.

</details>

---

## Task 11 — Bounded fanout with SetLimit (A)

**Goal.** Process 10,000 jobs in parallel, but never run more than 16 concurrently. Use `errgroup.SetLimit`. Return the first error and cancel the rest. Verify with a high-water-mark counter that you never exceeded the limit.

**Starter.**

```go
func ProcessAll(
    ctx context.Context,
    jobs []Job,
    limit int,
    process func(ctx context.Context, j Job) error,
) error {
    // TODO
}
```

**Hints.**

- `g.SetLimit(n)` makes `g.Go` block when n goroutines are already running. It's a hard cap.
- The slice-capture-in-loop bug: pre-Go-1.22, do `j := j` inside the loop. Go 1.22+, the loop variable is per-iteration.
- Measure the high-water-mark with an atomic int. Increment on entry, decrement on exit, track max with a CAS loop.

<details><summary>Reference solution</summary>

```go
package futures

import (
    "context"
    "fmt"
    "sync/atomic"

    "golang.org/x/sync/errgroup"
)

type Job struct{ ID string }

func ProcessAll(
    ctx context.Context,
    jobs []Job,
    limit int,
    process func(ctx context.Context, j Job) error,
) error {
    g, gctx := errgroup.WithContext(ctx)
    // Senior decision: SetLimit is a HARD cap. g.Go blocks the caller's
    // goroutine if the limit is reached. That's a feature: it provides
    // back-pressure without ever spawning more than `limit` goroutines.
    g.SetLimit(limit)

    var inflight, peak atomic.Int64
    for _, j := range jobs {
        j := j // Go pre-1.22 safety
        g.Go(func() error {
            n := inflight.Add(1)
            for {
                p := peak.Load()
                if n <= p || peak.CompareAndSwap(p, n) {
                    break
                }
            }
            defer inflight.Add(-1)
            return process(gctx, j)
        })
    }
    if err := g.Wait(); err != nil {
        return err
    }
    if p := peak.Load(); p > int64(limit) {
        // Defensive; SetLimit guarantees this can't happen.
        return fmt.Errorf("invariant violated: peak %d > limit %d", p, limit)
    }
    return nil
}

// Caller pattern:
//
//   jobs := make([]Job, 10000)
//   for i := range jobs {
//       jobs[i] = Job{ID: fmt.Sprintf("j-%d", i)}
//   }
//   err := ProcessAll(ctx, jobs, 16, func(ctx context.Context, j Job) error {
//       return realWork(ctx, j)
//   })
```

A common alternative is a worker-pool pattern (N permanent worker goroutines pulling from a channel of jobs). `errgroup.SetLimit` is strictly simpler. Use the worker pool when workers have expensive setup (DB connection, big buffer) that you want to reuse across many jobs.

</details>

---

## Task 12 — Future leak detector (track goroutines that never resolved) (A)

**Goal.** Build a `Tracker` that wraps `NewFuture[T]` and records every Future created. After a configurable wait, report any Future that was never resolved or rejected — a likely goroutine leak. Capture creation site (`runtime.Caller`) so the report points back at the buggy line. Be honest about the trade-offs.

**Starter.**

```go
type Tracker struct {
    // TODO: map of unresolved futures with caller info
}

func NewTracker() *Tracker                                                     { /* TODO */ }
func (t *Tracker) New() (*Future[any], *Resolver[any])                         { /* TODO */ }
func (t *Tracker) Report() []LeakInfo                                          { /* TODO */ }
```

**Hints.**

- Capture `runtime.Caller(1)` at registration time to remember WHERE the Future was created.
- Register on `New`, unregister when the future's `done` channel closes (spawn a tiny watcher goroutine).
- Don't ship this in production: the watcher goroutine per future doubles the cost. Use it as a `go test -tags=leaktest` build.

<details><summary>Reference solution</summary>

```go
package futures

import (
    "context"
    "fmt"
    "runtime"
    "sync"
    "sync/atomic"
    "time"
)

type LeakInfo struct {
    ID       uint64
    Caller   string
    Age      time.Duration
    Resolved bool
}

type trackedFuture struct {
    id       uint64
    caller   string
    born     time.Time
    resolved atomic.Bool
}

type Tracker struct {
    mu     sync.Mutex
    nextID uint64
    items  map[uint64]*trackedFuture
}

func NewTracker() *Tracker {
    return &Tracker{items: map[uint64]*trackedFuture{}}
}

func (t *Tracker) New() (*Future[any], *Resolver[any]) {
    f, r := NewFuture[any]()
    _, file, line, _ := runtime.Caller(1)
    t.mu.Lock()
    t.nextID++
    id := t.nextID
    tf := &trackedFuture{
        id:     id,
        caller: fmt.Sprintf("%s:%d", file, line),
        born:   time.Now(),
    }
    t.items[id] = tf
    t.mu.Unlock()

    // Senior decision: one watcher per tracked future. Cheap (~2 KB
    // stack) and the only race-free way to detect completion without
    // forking the Future API. In production, you'd switch this off
    // behind a build tag — the constant per-future goroutine cost is
    // unwelcome at scale.
    go func() {
        <-f.s.done
        tf.resolved.Store(true)
        t.mu.Lock()
        delete(t.items, id)
        t.mu.Unlock()
    }()
    return f, r
}

func (t *Tracker) Report() []LeakInfo {
    t.mu.Lock()
    defer t.mu.Unlock()
    now := time.Now()
    var out []LeakInfo
    for _, tf := range t.items {
        if tf.resolved.Load() {
            continue
        }
        out = append(out, LeakInfo{
            ID:     tf.id,
            Caller: tf.caller,
            Age:    now.Sub(tf.born),
        })
    }
    return out
}

// Helper that creates+launches in one call, with leak tracking.
func (t *Tracker) Go(ctx context.Context, fn func(context.Context) (any, error)) *Future[any] {
    f, r := t.New()
    go func() {
        v, err := fn(ctx)
        if err != nil { r.Reject(err) } else { r.Resolve(v) }
    }()
    return f
}

// Usage in tests:
//
//   func TestNoLeaks(t *testing.T) {
//       tr := NewTracker()
//       _ = tr.Go(context.Background(), func(ctx context.Context) (any, error) {
//           select {} // never returns -> leaks
//       })
//       _ = tr.Go(context.Background(), func(ctx context.Context) (any, error) {
//           return 1, nil
//       })
//       time.Sleep(50 * time.Millisecond)
//       leaks := tr.Report()
//       if len(leaks) != 1 {
//           t.Errorf("expected 1 leak, got %d: %+v", len(leaks), leaks)
//       }
//   }
```

This is a debugging tool, not a production safety net. The right production approach is *prevention*: thread ctx through everything, use `errgroup` so the group's `Wait` is your synchronization point, and avoid raw `go func() { f.Resolve(...) }()` patterns where ownership of the goroutine is unclear.

</details>

---

## Task 13 — Future with deadline propagation (A)

**Goal.** Build `WithDeadline[T]`: a Future variant where the producer's ctx is automatically tightened based on the consumer's. If the consumer awaits with a 100 ms deadline and the producer was started with a 1 s deadline, cap the work at 100 ms. The producer's goroutine must observe the tightened deadline mid-flight.

**Starter.**

```go
type DeadlineFuture[T any] struct {
    // TODO
}

func GoWithDeadline[T any](fn func(context.Context) (T, error)) *DeadlineFuture[T] { /* TODO */ }
func (f *DeadlineFuture[T]) Await(ctx context.Context) (T, error)                   { /* TODO */ }
```

**Hints.**

- The trick: the producer can't see the consumer's deadline at start time, because no one has called `Await` yet. Solution: producer runs under a *cancellable* ctx and waits for either work-done or a signal from Await.
- The first Await registers its ctx; subsequent Awaits can only tighten the deadline, never raise it.
- A simpler version: the Future has a *settable* upper deadline that any Await can lower, never raise.

<details><summary>Reference solution</summary>

```go
package futures

import (
    "context"
    "sync"
    "time"
)

type DeadlineFuture[T any] struct {
    done chan struct{}
    val  T
    err  error
    once sync.Once

    cancelProducer context.CancelFunc
    deadlineMu     sync.Mutex
    deadline       time.Time // zero = unbounded
}

func GoWithDeadline[T any](fn func(context.Context) (T, error)) *DeadlineFuture[T] {
    // Senior decision: producer starts under a cancellable ctx whose
    // deadline can be tightened mid-flight by Await. We use a
    // monitoring goroutine to bridge "Await's deadline" to "producer's
    // cancellation".
    pctx, pcancel := context.WithCancel(context.Background())
    f := &DeadlineFuture[T]{
        done:           make(chan struct{}),
        cancelProducer: pcancel,
    }
    go func() {
        v, err := fn(pctx)
        f.once.Do(func() {
            f.val = v
            f.err = err
            close(f.done)
        })
        pcancel() // belt and suspenders
    }()
    return f
}

func (f *DeadlineFuture[T]) Await(ctx context.Context) (T, error) {
    // Adopt the awaiter's deadline if it tightens what we already have.
    if dl, ok := ctx.Deadline(); ok {
        f.deadlineMu.Lock()
        if f.deadline.IsZero() || dl.Before(f.deadline) {
            f.deadline = dl
            // Schedule a producer-cancel when the deadline hits.
            go func(deadline time.Time) {
                t := time.NewTimer(time.Until(deadline))
                defer t.Stop()
                select {
                case <-t.C:
                    f.cancelProducer()
                case <-f.done:
                }
            }(dl)
        }
        f.deadlineMu.Unlock()
    }

    select {
    case <-f.done:
        return f.val, f.err
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}
```

What this buys you: a single Future shared across multiple awaiters, where the tightest deadline among all awaiters determines the upper bound on the producer. The producer is cancelled exactly once, when the tightest deadline fires.

What it costs: every Await that tightens the deadline spawns a watchdog goroutine. Cheap, but not free. For very-high-frequency Await patterns, consider an explicit `Future.SetDeadline(t)` method.

Edge case worth thinking through: what if Await is called *after* the producer already finished? The deadline machinery is a no-op (the `case <-f.done` arm closes immediately). Make sure you don't leak the watchdog timer in that case.

</details>

---

## Task 14 — Distributed Future via Redis SETNX + pubsub (A)

**Goal.** Build a Future that lives across processes. When one process needs `Get("alice")`, it tries to grab a Redis lock with `SETNX`. If it wins, it does the work, stores the result in Redis, publishes to a `result:alice` channel, and releases the lock. If it loses, it subscribes to `result:alice` and waits. Survives process death (lock TTL).

**Starter.**

```go
type DistFuture struct {
    rdb *redis.Client
}

func (df *DistFuture) Get(
    ctx context.Context,
    key string,
    compute func(ctx context.Context) ([]byte, error),
) ([]byte, error) {
    // TODO
}
```

**Hints.**

- `SETNX fut-lock:alice <uuid> EX 30` claims the lock for 30s. Use UUID as the value so you only release locks you own.
- After computing, `SET fut-cache:alice <bytes> EX 300` and `PUBLISH fut-pub:alice <bytes>`.
- The waiter: subscribe to the channel BEFORE checking the cache (so a publish racing with your subscribe isn't lost).
- Use a Lua script to release the lock atomically; otherwise a slow `compute()` can let the TTL expire and you'd accidentally delete someone else's lock.

<details><summary>Reference solution</summary>

```go
package futures

import (
    "context"
    "errors"
    "fmt"
    "time"

    "github.com/google/uuid"
    "github.com/redis/go-redis/v9"
)

type DistFuture struct {
    rdb     *redis.Client
    lockTTL time.Duration
    valTTL  time.Duration
}

func NewDistFuture(rdb *redis.Client) *DistFuture {
    return &DistFuture{rdb: rdb, lockTTL: 30 * time.Second, valTTL: 5 * time.Minute}
}

func (df *DistFuture) Get(
    ctx context.Context,
    key string,
    compute func(ctx context.Context) ([]byte, error),
) ([]byte, error) {
    cacheK := "fut-cache:" + key
    lockK := "fut-lock:" + key
    pubK := "fut-pub:" + key

    // Fast path: result already cached.
    if v, err := df.rdb.Get(ctx, cacheK).Bytes(); err == nil {
        return v, nil
    }

    // Senior decision: subscribe BEFORE attempting SETNX. If we lose
    // the race, we mustn't miss the publish that already happened.
    // The order is: (1) subscribe, (2) check cache one more time,
    // (3) try lock. If anything fired between (1) and (2), we get it.
    sub := df.rdb.Subscribe(ctx, pubK)
    defer sub.Close()
    if _, err := sub.Receive(ctx); err != nil {
        return nil, fmt.Errorf("subscribe: %w", err)
    }

    if v, err := df.rdb.Get(ctx, cacheK).Bytes(); err == nil {
        return v, nil
    }

    token := uuid.NewString()
    won, err := df.rdb.SetNX(ctx, lockK, token, df.lockTTL).Result()
    if err != nil {
        return nil, fmt.Errorf("setnx: %w", err)
    }

    if won {
        // We own the work.
        defer df.releaseLock(ctx, lockK, token)
        v, computeErr := compute(ctx)
        if computeErr != nil {
            // Senior decision: don't cache failures; let the next caller
            // retry. Negative-cache only via an explicit policy.
            return nil, computeErr
        }
        if err := df.rdb.Set(ctx, cacheK, v, df.valTTL).Err(); err != nil {
            return nil, fmt.Errorf("set cache: %w", err)
        }
        if err := df.rdb.Publish(ctx, pubK, v).Err(); err != nil {
            return nil, fmt.Errorf("publish: %w", err)
        }
        return v, nil
    }

    // We lost; wait for a publish or cache hit.
    ch := sub.Channel()
    pollT := time.NewTicker(1 * time.Second)
    defer pollT.Stop()

    for {
        select {
        case msg := <-ch:
            return []byte(msg.Payload), nil
        case <-pollT.C:
            // Fallback poll: the winner may have died mid-compute, in
            // which case the cache eventually populates from a retrier
            // (or we'll loop until lockTTL expires and we can retry).
            if v, err := df.rdb.Get(ctx, cacheK).Bytes(); err == nil {
                return v, nil
            }
            // Lock holder dead? Check if the lock is gone.
            if cnt, _ := df.rdb.Exists(ctx, lockK).Result(); cnt == 0 {
                // Winner crashed before publishing — retry from the top.
                return df.Get(ctx, key, compute)
            }
        case <-ctx.Done():
            return nil, ctx.Err()
        }
    }
}

var releaseScript = redis.NewScript(`
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
end
return 0
`)

func (df *DistFuture) releaseLock(ctx context.Context, lockK, token string) {
    // Senior decision: token-checked release via Lua. SET ... EX is
    // racy: TTL could expire mid-work, another process grabs the lock,
    // and we'd accidentally release theirs.
    _, _ = releaseScript.Run(ctx, df.rdb, []string{lockK}, token).Result()
}

var _ = errors.New
```

The Lua-script lock release is critical. Without it, a slow `compute()` can have its lock expire, another process grabs it, and the original process then deletes someone else's lock. The token-check is the standard distributed-lock idiom.

This pattern is in production at countless companies under names like "distributed cache stampede prevention" or "thundering-herd guard". Single-process equivalent: `singleflight` from Task 8.

</details>

---

## Task 15 — Mini Temporal-style durable promise (S)

**Goal.** Combine WAL-style persistence with the Future API. A `DurablePromise[T]` survives process crashes: its state (pending/resolved/rejected, value, timestamp) is persisted on every transition. Restart the process, recover the promise by id, await it again — it returns the same result.

**Starter.**

```go
type DurablePromise[T any] struct {
    id      string
    storage Storage
    // TODO
}

type Storage interface {
    Save(rec PromiseRecord) error
    Load(id string) (PromiseRecord, error)
    All() ([]PromiseRecord, error)
}

func NewDurable[T any](storage Storage, id string) (*DurablePromise[T], error) { /* TODO */ }
func (p *DurablePromise[T]) Resolve(v T) error                                   { /* TODO */ }
func (p *DurablePromise[T]) Reject(err error) error                              { /* TODO */ }
func (p *DurablePromise[T]) Await(ctx context.Context) (T, error)                { /* TODO */ }
```

**Hints.**

- Persist BEFORE notifying. If you resolve in-memory then crash before writing to disk, the next process replay loses the result.
- Idempotent resolve: calling `Resolve(v)` twice with the same `v` is fine; calling it twice with different values is an error (or take the first — pick a policy).
- Storage doesn't need to be a real database for this exercise. A JSON file per promise is enough to demonstrate the contract.
- Atomic file write: write to `tmp`, then `rename`. `os.WriteFile` alone is not crash-safe.

<details><summary>Reference solution</summary>

```go
package futures

import (
    "context"
    "encoding/json"
    "errors"
    "fmt"
    "os"
    "path/filepath"
    "sync"
)

type State string

const (
    StatePending  State = "pending"
    StateResolved State = "resolved"
    StateRejected State = "rejected"
)

type PromiseRecord struct {
    ID    string          `json:"id"`
    State State           `json:"state"`
    Value json.RawMessage `json:"value,omitempty"`
    Error string          `json:"error,omitempty"`
}

type Storage interface {
    Save(rec PromiseRecord) error
    Load(id string) (PromiseRecord, error)
    All() ([]PromiseRecord, error)
}

// FileStorage: one JSON file per promise.
type FileStorage struct {
    dir string
    mu  sync.Mutex
}

func NewFileStorage(dir string) (*FileStorage, error) {
    if err := os.MkdirAll(dir, 0o755); err != nil {
        return nil, err
    }
    return &FileStorage{dir: dir}, nil
}

func (s *FileStorage) Save(rec PromiseRecord) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    data, err := json.Marshal(rec)
    if err != nil {
        return err
    }
    path := filepath.Join(s.dir, rec.ID+".json")
    tmp := path + ".tmp"
    // Senior decision: write-then-rename for atomic persistence.
    // os.WriteFile alone is NOT atomic — a crash mid-write leaves a
    // truncated file. Rename is atomic on POSIX.
    if err := os.WriteFile(tmp, data, 0o644); err != nil {
        return err
    }
    return os.Rename(tmp, path)
}

func (s *FileStorage) Load(id string) (PromiseRecord, error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    data, err := os.ReadFile(filepath.Join(s.dir, id+".json"))
    if err != nil {
        return PromiseRecord{}, err
    }
    var rec PromiseRecord
    if err := json.Unmarshal(data, &rec); err != nil {
        return PromiseRecord{}, err
    }
    return rec, nil
}

func (s *FileStorage) All() ([]PromiseRecord, error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    entries, err := os.ReadDir(s.dir)
    if err != nil {
        return nil, err
    }
    var out []PromiseRecord
    for _, e := range entries {
        if filepath.Ext(e.Name()) != ".json" {
            continue
        }
        data, err := os.ReadFile(filepath.Join(s.dir, e.Name()))
        if err != nil {
            return nil, err
        }
        var rec PromiseRecord
        if err := json.Unmarshal(data, &rec); err != nil {
            continue // skip half-written or stale files
        }
        out = append(out, rec)
    }
    return out, nil
}

type DurablePromise[T any] struct {
    id      string
    storage Storage

    mu    sync.Mutex
    done  chan struct{}
    val   T
    err   error
    state State
}

func NewDurable[T any](storage Storage, id string) (*DurablePromise[T], error) {
    p := &DurablePromise[T]{
        id:      id,
        storage: storage,
        done:    make(chan struct{}),
        state:   StatePending,
    }
    rec, err := storage.Load(id)
    if err == nil {
        // Already exists; load state.
        p.state = rec.State
        if rec.State == StateResolved {
            if err := json.Unmarshal(rec.Value, &p.val); err != nil {
                return nil, fmt.Errorf("recover %s: %w", id, err)
            }
            close(p.done)
        } else if rec.State == StateRejected {
            p.err = errors.New(rec.Error)
            close(p.done)
        }
    } else if !os.IsNotExist(err) {
        return nil, err
    } else {
        // First time — persist the pending record so recovery sees it.
        if err := storage.Save(PromiseRecord{ID: id, State: StatePending}); err != nil {
            return nil, err
        }
    }
    return p, nil
}

func (p *DurablePromise[T]) Resolve(v T) error {
    p.mu.Lock()
    defer p.mu.Unlock()
    if p.state != StatePending {
        // Senior decision: idempotent resolve. Calling Resolve on an
        // already-resolved promise returns nil (success). Calling it on
        // a rejected one is an error — state transitions must be
        // monotonic and unambiguous.
        if p.state == StateResolved {
            return nil
        }
        return fmt.Errorf("cannot resolve: state=%s", p.state)
    }
    payload, err := json.Marshal(v)
    if err != nil {
        return err
    }
    // PERSIST FIRST.
    rec := PromiseRecord{ID: p.id, State: StateResolved, Value: payload}
    if err := p.storage.Save(rec); err != nil {
        return fmt.Errorf("persist resolve: %w", err)
    }
    // Then mutate in-memory.
    p.val = v
    p.state = StateResolved
    close(p.done)
    return nil
}

func (p *DurablePromise[T]) Reject(perr error) error {
    p.mu.Lock()
    defer p.mu.Unlock()
    if p.state != StatePending {
        if p.state == StateRejected {
            return nil
        }
        return fmt.Errorf("cannot reject: state=%s", p.state)
    }
    rec := PromiseRecord{ID: p.id, State: StateRejected, Error: perr.Error()}
    if err := p.storage.Save(rec); err != nil {
        return fmt.Errorf("persist reject: %w", err)
    }
    p.err = perr
    p.state = StateRejected
    close(p.done)
    return nil
}

func (p *DurablePromise[T]) Await(ctx context.Context) (T, error) {
    select {
    case <-p.done:
        return p.val, p.err
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}

// Recover all promises so the orchestrator can decide what to do
// (re-run? wait?).
func RecoverAll[T any](storage Storage) ([]*DurablePromise[T], error) {
    recs, err := storage.All()
    if err != nil {
        return nil, err
    }
    var out []*DurablePromise[T]
    for _, rec := range recs {
        p, err := NewDurable[T](storage, rec.ID)
        if err != nil {
            return nil, err
        }
        out = append(out, p)
    }
    return out, nil
}
```

What you've built mimics the durable-promise primitive at the heart of Temporal, Restate, Resonate, and similar workflow runtimes. The contract:

1. State transitions are persisted before they're observable to awaiters.
2. Restarting the process and constructing the same `id` finds the old state.
3. Resolve/Reject are idempotent — safe to retry after a crash.

What's missing for production: leases (so a stuck worker doesn't hold the promise forever), watchers (so multiple processes can await the same promise across the network), retention policies, transactional Save+Send (so the workflow can chain durably), and indices for bulk recovery. Temporal/Restate ship all of that. The skeleton above is the smallest thing that exhibits the durability contract.

</details>

---

## 4. How to grade yourself

Score each task `0` (didn't try), `1` (got it working with hints), `2` (got it working unaided), `3` (got it working *and* wrote a stress or property-based test that broke an earlier version). Add them up:

| Score | What it means |
|-------|---------------|
| 0–15  | You can describe a Future but can't build one that survives concurrent awaiters. Re-read middle.md, then redo Tasks 1–4. The channel-as-Future intuition has to be reflex before the rest makes sense. |
| 16–25 | You can build the Promise[T] type cleanly and use errgroup correctly. Now do Tasks 5–9. Don't skip singleflight — it's the cheapest production win in the entire module. |
| 26–35 | You understand the in-process world. Tasks 10–13 are about composition (Then, bounded fan-out, leak detection, deadline propagation). These are the patterns that distinguish "can write a Future" from "can ship Future-based code". |
| 36–45 | You're at senior level. Task 14 (distributed) and Task 15 (durable) push you out of pure-Go land and into the territory where workflows, sagas, and Temporal live. If those didn't teach you something, go read the Resonate or Restate open-source notes on durable promises and try to implement leases. |

The most important question is not *did you finish* — it's *can you predict the goroutine lifecycle for every Future you create?* If you can articulate "the producer goroutine exits when X, the await returns when Y, a leak happens if Z" for Tasks 1, 4, 5, 7, 10, 12, 13, and 15, you understand Futures in Go. If not, the rest is plumbing.

Concrete checks worth running before you call yourself done:

- Race detector clean: `go test -race ./...` on every task.
- A Future created and never awaited must not leak the producer goroutine forever — at minimum, it must respect ctx cancellation.
- `Resolve` called from 1000 goroutines must produce exactly one state transition (verify with an atomic counter inside the once.Do).
- `All` and `First` must propagate ctx cancellation; the losers must observe it.
- The durable promise (Task 15) must survive `kill -9 $PID` mid-resolve and return the correct state on recovery. Test this in a child process — fork, kill, re-exec, re-load.

---

## 5. Stretch challenges

**S1 — Backpressure-aware Future chains.** Extend Task 10's `Then` so that a downstream stage that's slower than its upstream stage applies back-pressure. The shape: each stage in a chain has a bounded queue; producers block on `Then` when the next stage's queue is full. Implement it with `chan` between stages and a configurable buffer per stage. Compare end-to-end throughput against the unbounded version under a deliberately slow last stage — the unbounded version should grow memory unboundedly; yours should plateau.

**S2 — Future-of-stream.** Build `*FutureStream[T]` — a Future that resolves to a sequence of values, not just one. `Send(v)` adds a value, `Close()` signals end-of-stream, `Range(ctx, fn)` consumes with cancellation. Now build `Map`, `Filter`, `Take(n)` combinators over it. The key constraint: every combinator must respect ctx and never leak goroutines, even when fused into a five-stage pipeline that's cancelled mid-way. Verify with `runtime.NumGoroutine()` before and after.

**S3 — Distributed durable Future with leases.** Extend Task 15's durable promise to support multiple processes coordinating on the same promise: writer A acquires a lease, computes, writes the result, releases the lease. If A dies mid-compute, writer B inherits the lease after the TTL expires. Awaiters in process C see the result regardless of which writer produced it. Use Postgres with `SELECT ... FOR UPDATE SKIP LOCKED` as the lease backend. Prove correctness by killing writers mid-flight under load — every promise must eventually resolve exactly once, no matter how many writer-deaths the cluster experiences.

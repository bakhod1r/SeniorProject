# Futures & Promises — Junior

## 1. What are Futures and Promises?

You want a value, but computing it takes time — a database query, an HTTP call, a slow computation. You don't want to block right now; you want to *kick off* the work and *come back later* for the result.

A **Future** is a placeholder for "a value that will eventually exist". A **Promise** is the same idea seen from the producer's side: it's the thing you write the result *into* so a future reader can pick it up.

> Future = the read side of a deferred value.
> Promise = the write side.

In many languages (JavaScript, Java, Rust, C++) Futures and Promises are first-class types: `Future<T>`, `Promise<T>`. In Go, they're not. Go has channels and goroutines, and the language designers expect you to compose your own.

So in Go, a Future is most commonly **a channel that will receive a single value, then close**. A Promise is the goroutine writing to that channel.

---

## 2. Prerequisites
- Channels (`make(chan T)`, send, receive).
- Goroutines (`go func() { ... }()`).
- `context.Context` for cancellation.
- Basic understanding that goroutines are cheap (a few KB stack to start).

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Future** | A handle for a value that hasn't been computed yet |
| **Promise** | The write side; what the producer fulfils |
| **Resolve** | Producer delivers the value (success) |
| **Reject** | Producer delivers an error (failure) |
| **Await** | Consumer waits for the value |
| **Eager** | Computation starts immediately |
| **Lazy** | Computation starts only when awaited |

---

## 4. The simplest Go Future: a one-shot channel

```go
func fetchUserAsync(id string) <-chan User {
    out := make(chan User, 1)
    go func() {
        u := fetchUser(id) // slow
        out <- u
        close(out)
    }()
    return out
}

future := fetchUserAsync("alice")
// ... do other work ...
user := <-future
```

That's a Future. The channel is the placeholder. The goroutine is the work. The consumer reads when they're ready.

The channel is buffered (size 1) so the goroutine doesn't block sending if no one is reading yet.

---

## 5. A Future with errors

A real Future returns either a value *or* an error:

```go
type Result[T any] struct {
    Value T
    Err   error
}

func fetchUserAsync(ctx context.Context, id string) <-chan Result[User] {
    out := make(chan Result[User], 1)
    go func() {
        u, err := fetchUser(ctx, id)
        out <- Result[User]{Value: u, Err: err}
        close(out)
    }()
    return out
}

future := fetchUserAsync(ctx, "alice")
r := <-future
if r.Err != nil { /* handle */ }
useUser(r.Value)
```

This pattern is everywhere in Go codebases that need futures. Both result and error go through one channel; the consumer never has to wonder "which channel do I read?".

---

## 6. The Promise-style API (separating producer and consumer)

A Promise wraps the future + a `Resolve`/`Reject` method for the producer:

```go
type Promise[T any] struct {
    done chan struct{}
    val  T
    err  error
}

func NewPromise[T any]() *Promise[T] {
    return &Promise[T]{done: make(chan struct{})}
}

func (p *Promise[T]) Resolve(v T)     { p.val = v; close(p.done) }
func (p *Promise[T]) Reject(err error) { p.err = err; close(p.done) }

func (p *Promise[T]) Await() (T, error) {
    <-p.done
    return p.val, p.err
}
```

The producer calls `Resolve` or `Reject` *exactly once*. The consumer calls `Await` whenever it's ready. Closing `done` is the "fulfilled" signal.

```go
p := NewPromise[User]()
go func() {
    u, err := fetchUser(ctx, "alice")
    if err != nil { p.Reject(err); return }
    p.Resolve(u)
}()
user, err := p.Await()
```

This shape is closer to the textbook Promise. The channel-only version above is more idiomatic Go.

---

## 7. Cancellation with `context.Context`

A Future without cancellation is a leak waiting to happen. If the consumer disappears, the goroutine is still running.

The fix is always the same: thread `context.Context` through.

```go
func fetchUserAsync(ctx context.Context, id string) <-chan Result[User] {
    out := make(chan Result[User], 1)
    go func() {
        u, err := fetchUserCtx(ctx, id)
        select {
        case out <- Result[User]{Value: u, Err: err}:
        case <-ctx.Done():
            // consumer gave up; drop the result
        }
    }()
    return out
}
```

Then the consumer does:

```go
select {
case r := <-future:
    use(r)
case <-ctx.Done():
    return ctx.Err()
}
```

If the context cancels, the consumer gives up; the goroutine returns. No leak.

---

## 8. Real-world analogy
You drop off film at a photo lab. They hand you a ticket (the Future). You leave. Later you come back with the ticket and pick up your photos (Await). The lab develops the photos in parallel with your other errands. If you never come back, the lab still develops them — but no one cares.

---

## 9. When you'll see it
- HTTP/RPC clients with async APIs.
- `errgroup.WithContext` for running goroutines in parallel and collecting first error.
- `sync.WaitGroup` (a degenerate Future that resolves to nothing).
- Channel-of-Result everywhere in pipeline code.
- `golang.org/x/sync/singleflight` — deduplicates concurrent requests, returns the same Future.

---

## 10. Common mistakes
- **Sending to an unbuffered channel with no reader** — the goroutine blocks forever.
- **Closing the channel twice** (calling Resolve and Reject) — panic.
- **No context** — consumer cancels, goroutine keeps running.
- **Reading the channel twice** — the second read blocks forever (channel is closed; only the zero value comes through, often a silent bug).
- **Mutating the channel** — pass it as `<-chan T` to keep consumers read-only.

---

## 11. Summary

A Future in Go is a one-shot channel that delivers a result. A Promise is the producer-side wrapper that exposes `Resolve`/`Reject`/`Await`. The pattern lets the producer and consumer run in parallel: the consumer doesn't block until it actually needs the value. Always thread `context.Context` for cancellation, return `<-chan Result[T]` from constructors, and treat the channel as one-shot.

---

## Further reading
- "Go Concurrency Patterns: Pipelines and cancellation" — Go blog
- `golang.org/x/sync/errgroup` — futures-with-shared-cancellation
- `golang.org/x/sync/singleflight` — deduplicated futures
- C# `Task<T>`, JavaScript `Promise<T>`, Java `CompletableFuture` — type-level versions
- Pike, *Concurrency is not parallelism* (Go's design philosophy)

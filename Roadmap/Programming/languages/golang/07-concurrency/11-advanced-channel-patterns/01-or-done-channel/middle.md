# Or-Done-Channel — Middle Level

> Focus: "How does this pattern relate to `context.Context`? How do I use it in real pipelines, and when do I reach for it instead of context?"

## Table of Contents

1. [From `done` to `context.Context`](#from-done-to-contextcontext)
2. [Comparing the Two Idioms](#comparing-the-two-idioms)
3. [The Generic Adapter, Reviewed](#the-generic-adapter-reviewed)
4. [Pipelines: Where `orDone` Earns Its Keep](#pipelines-where-ordone-earns-its-keep)
5. [Composing Done Signals](#composing-done-signals)
6. [Buffering Considerations](#buffering-considerations)
7. [Producer-Side Cancellation vs Consumer-Side Wrapping](#producer-side-cancellation-vs-consumer-side-wrapping)
8. [The Ok-Pattern and EOF Detection](#the-ok-pattern-and-eof-detection)
9. [Bridging `context` and a `done` Channel](#bridging-context-and-a-done-channel)
10. [Goroutine Leak Testing](#goroutine-leak-testing)
11. [Common Mistakes at the Middle Level](#common-mistakes-at-the-middle-level)
12. [Patterns You Will See in Real Code](#patterns-you-will-see-in-real-code)

---

## From `done` to `context.Context`

The or-done-channel pattern was popularised by Katherine Cox-Buday in *Concurrency in Go* (O'Reilly, 2017). At that time, `context.Context` already existed but was not yet ubiquitous across the standard library. The pattern presented a vocabulary for cancellable channel pipelines built from raw primitives: a `chan struct{}` whose *closure* is the cancellation signal.

In 2026, `context.Context` is the default. Almost every standard-library function that performs I/O takes a `ctx` parameter. Inside a context, `ctx.Done()` returns a `<-chan struct{}` — and that channel is exactly the `done` channel the pattern needs.

So the relationship is:

- `done <-chan struct{}` is the low-level primitive.
- `ctx.Done()` is the same primitive, wrapped in a system that adds deadlines, request-scoped values, and parent-child cancellation trees.
- The `orDone` pattern is the same logic in both worlds.

Once you see this, the question stops being "do I use `done` or `context`?" and becomes "do I need the tree, the deadline, the values? If yes, use `context`. If no, a plain `done` channel is fine."

---

## Comparing the Two Idioms

Side by side, the difference is mostly cosmetic.

### `done`-channel form

```go
func source(done <-chan struct{}) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            select {
            case <-done:
                return
            case out <- i:
            }
        }
    }()
    return out
}

done := make(chan struct{})
defer close(done)
for v := range orDone(done, source(done)) {
    use(v)
}
```

### `context` form

```go
func source(ctx context.Context) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            select {
            case <-ctx.Done():
                return
            case out <- i:
            }
        }
    }()
    return out
}

ctx, cancel := context.WithCancel(context.Background())
defer cancel()
for v := range orDone(ctx.Done(), source(ctx)) {
    use(v)
}
```

Both compile to the same machine code essentially. The differences:

| Aspect | `done` channel | `context.Context` |
|---|---|---|
| Cancellation | `close(done)` | `cancel()` (idempotent) |
| Double cancel | panics — guard with `sync.Once` | safe — internally idempotent |
| Deadlines | not built in | `context.WithTimeout` / `WithDeadline` |
| Trees | manual: pass multiple done channels | `context.WithCancel(parentCtx)` |
| Values | not part of the protocol | `context.WithValue` (use sparingly) |
| Interop with stdlib | not the convention | the convention |
| Footprint | one channel | one struct + atomic state |

Rule of thumb: prefer `context.Context` in any code that already accepts one. Reach for the bare `done` channel only in small libraries or self-contained subsystems where pulling in `context` semantics feels heavy.

The `orDone` *function* is useful in both worlds: in the context world, `orDone(ctx.Done(), src)` is the equivalent expression.

---

## The Generic Adapter, Reviewed

The canonical Go 1.18+ form:

```go
func orDone[T any](done <-chan struct{}, c <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for {
            select {
            case <-done:
                return
            case v, ok := <-c:
                if !ok {
                    return
                }
                select {
                case out <- v:
                case <-done:
                    return
                }
            }
        }
    }()
    return out
}
```

At the middle level you should be able to read this without effort and predict its behaviour from first principles:

- The goroutine owns `out`. Hence `defer close(out)`.
- Two `select` statements, both observing `done`. Either blocking operation — reading `c` or sending `out` — must be cancellable.
- `ok` detects upstream closure (EOF), distinct from cancellation.
- Type parameter `T any` allows reuse across element types.

A `context`-flavoured version is one line:

```go
func orDoneCtx[T any](ctx context.Context, c <-chan T) <-chan T {
    return orDone(ctx.Done(), c)
}
```

Some teams ship only this `Ctx` variant. Others keep both for flexibility.

---

## Pipelines: Where `orDone` Earns Its Keep

A pipeline is a series of stages, each a goroutine, each connected by channels. The cancellable form looks like:

```go
func generator(done <-chan struct{}) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            select {
            case <-done:
                return
            case out <- i:
            }
        }
    }()
    return out
}

func multiply(done <-chan struct{}, in <-chan int, factor int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range orDone(done, in) {
            select {
            case out <- v * factor:
            case <-done:
                return
            }
        }
    }()
    return out
}

func add(done <-chan struct{}, in <-chan int, addend int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range orDone(done, in) {
            select {
            case out <- v + addend:
            case <-done:
                return
            }
        }
    }()
    return out
}
```

Composition:

```go
done := make(chan struct{})
defer close(done)

pipeline := add(done, multiply(done, generator(done), 2), 1)

for v := range orDone(done, pipeline) {
    if v > 100 {
        break
    }
    fmt.Println(v)
}
```

Note three things:

1. Every stage takes `done` and observes it on both reads (via `orDone`) and writes (via the inline `select`).
2. The `range orDone(done, in)` form keeps each stage's body simple.
3. Closing `done` (here, the `defer` at the top of `main`) unwinds the entire pipeline. Each `orDone` exits, each stage's `range` exits, each stage's `defer close(out)` fires, the next stage's `orDone` exits, and so on.

The crucial property: **closing `done` once collapses the whole chain.** Without `orDone`, you would repeat the dual-select in every stage.

---

## Composing Done Signals

You often have more than one reason to cancel. Two common compositions:

### Layered: request-scoped over global

```go
globalDone := make(chan struct{}) // closed on server shutdown
requestDone := make(chan struct{}) // closed when a single request ends

func handleRequest() {
    defer close(requestDone)
    stream := orDone(globalDone, orDone(requestDone, source))
    for v := range stream {
        process(v)
    }
}
```

`stream` closes when *either* signal fires. Server shutdown ends every in-flight request; a single request ending does not affect the others.

### With `context.Context`

The same composition is built into context:

```go
serverCtx, cancelServer := context.WithCancel(context.Background())
defer cancelServer()

func handleRequest() {
    reqCtx, cancelReq := context.WithCancel(serverCtx)
    defer cancelReq()

    for v := range orDoneCtx(reqCtx, source) {
        process(v)
    }
}
```

`reqCtx.Done()` closes when *either* `cancelReq()` or `cancelServer()` (its parent) fires. The tree structure is built into the type.

### Many done signals — when to stop nesting

`orDone(d1, orDone(d2, orDone(d3, c)))` works, but each layer adds a goroutine. For more than two signals, switch to a single `select` with N cases, or build a *fan-in of done signals* into one merged channel:

```go
func mergeDone(dones ...<-chan struct{}) <-chan struct{} {
    out := make(chan struct{})
    go func() {
        defer close(out)
        cases := make([]reflect.SelectCase, len(dones))
        for i, d := range dones {
            cases[i] = reflect.SelectCase{Dir: reflect.SelectRecv, Chan: reflect.ValueOf(d)}
        }
        reflect.Select(cases) // returns when any one fires
    }()
    return out
}
```

Use sparingly; this is reaching for `context.WithCancel(parent)` instead.

---

## Buffering Considerations

The default `orDone` creates an unbuffered output:

```go
out := make(chan T) // unbuffered
```

Unbuffered means: the `orDone` goroutine and the consumer rendezvous on every send. The send blocks until the consumer is ready to receive. Backpressure is preserved.

A buffered variant:

```go
func orDoneBuffered[T any](done <-chan struct{}, c <-chan T, n int) <-chan T {
    out := make(chan T, n)
    go func() {
        defer close(out)
        for {
            select {
            case <-done:
                return
            case v, ok := <-c:
                if !ok {
                    return
                }
                select {
                case out <- v:
                case <-done:
                    return
                }
            }
        }
    }()
    return out
}
```

Trade-offs:

- A buffer of N decouples producer and consumer by up to N values.
- Under cancellation, up to N values that were sent into `out` *before* `done` fired are still readable by the consumer if it chooses to drain.
- Latency to deliver a value is reduced; jitter is smoothed.
- Memory cost is N × sizeof(T).

For most pipeline stages, unbuffered is correct. Add buffering only where measurement shows it pays.

---

## Producer-Side Cancellation vs Consumer-Side Wrapping

There are two places to handle cancellation. They are *not* equivalent.

### Producer-side: the source itself observes `done`

```go
func source(done <-chan struct{}) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            select {
            case <-done:
                return
            case out <- i:
            }
        }
    }()
    return out
}
```

The producer stops sending when `done` closes. No values are wasted; the goroutine exits at the source.

### Consumer-side: wrap with `orDone` at the boundary

```go
func source() <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            out <- i // no done observation
        }
    }()
    return out
}

stream := orDone(done, source())
```

The producer keeps sending into `out`. When `done` closes and the consumer stops reading, the producer eventually blocks on `out <- v`. **Unless the source observes `done` too, the producer leaks.**

Conclusion: `orDone` on the consumer side is necessary but not sufficient. The producer must also observe `done` (or its `ctx`). The pattern fixes the *consumer-side* leak, not the producer-side one.

When you do not control the producer (it is a library function with no done-channel parameter), `orDone` is the best you can do — but understand that you may be leaving the original goroutine running until it finishes naturally.

---

## The Ok-Pattern and EOF Detection

Receiving from a channel returns two values:

```go
v, ok := <-c
```

- `ok == true`: value received normally.
- `ok == false`: channel is closed and the buffer is drained; `v` is the zero value.

`orDone` uses this to distinguish three states inside the outer `select`:

1. `done` closes — exit with cancellation semantics.
2. `c` delivers a value — forward to `out`.
3. `c` closes — exit with EOF semantics.

The caller cannot distinguish (1) from (3) by looking at `out`: both result in `out` being closed and the consumer's `range` exiting. If the caller needs to know *why* iteration ended, embed it in the value type or expose a separate signal:

```go
type Outcome struct {
    Cancelled bool
}

func orDoneTracked[T any](done <-chan struct{}, c <-chan T) (<-chan T, *Outcome) {
    out := make(chan T)
    outcome := &Outcome{}
    go func() {
        defer close(out)
        for {
            select {
            case <-done:
                outcome.Cancelled = true
                return
            case v, ok := <-c:
                if !ok {
                    return
                }
                select {
                case out <- v:
                case <-done:
                    outcome.Cancelled = true
                    return
                }
            }
        }
    }()
    return out, outcome
}
```

Mind the data race on `outcome.Cancelled`: read it only after the consumer's `range` has exited, which establishes a happens-before edge via the channel close.

---

## Bridging `context` and a `done` Channel

Most real code mixes the two. You receive a `ctx` from your caller; you have a sub-library that wants a bare `done`. Bridge:

### `context` → `done`

```go
func contextDone(ctx context.Context) <-chan struct{} {
    return ctx.Done()
}
```

It is literally one method. `ctx.Done()` *is* a done channel.

### `done` → `context`

Slightly more work, because a bare `done` does not carry deadlines or values:

```go
func contextFromDone(done <-chan struct{}) (context.Context, context.CancelFunc) {
    ctx, cancel := context.WithCancel(context.Background())
    go func() {
        select {
        case <-done:
            cancel()
        case <-ctx.Done():
        }
    }()
    return ctx, cancel
}
```

A spawned goroutine watches `done` and propagates the close to the context. The reverse case (`<-ctx.Done()`) is needed so this helper goroutine exits when the caller's context dies independently.

Use these only at API boundaries. Inside a single subsystem, pick one and stick with it.

---

## Goroutine Leak Testing

The most useful test for `orDone`-based code is one that asserts no goroutines outlive the test. The standard tool is `go.uber.org/goleak`:

```go
package mypipeline_test

import (
    "testing"
    "time"

    "go.uber.org/goleak"
)

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}

func TestPipeline_NoLeaks(t *testing.T) {
    done := make(chan struct{})

    stream := orDone(done, generator(done))

    var got []int
    for v := range stream {
        got = append(got, v)
        if len(got) == 10 {
            close(done)
        }
    }
    // Give goroutines a moment to exit
    time.Sleep(10 * time.Millisecond)
    // goleak checks at test end via TestMain
}
```

A failing `goleak` test points directly to the goroutine that did not exit, with its stack trace. This catches:

- Forgetting `defer close(out)`.
- Producer not observing `done`.
- Missing inner `select`.
- Wrong cancellation order in composed pipelines.

Without leak testing, these bugs ship to production and only surface as slowly growing memory.

---

## Common Mistakes at the Middle Level

| Mistake | Symptom | Fix |
|---|---|---|
| Only wrapping consumer, not producer | Memory rises after each request | Producer must also observe `done` / `ctx` |
| Sharing one `done` across requests | One slow request shuts down others | Per-request `ctx` derived from server `ctx` |
| Closing `done` inside the goroutine that reads `done` | Reader exits, but `done` never closes | Close from the *cancelling* side, not the reading side |
| Stacking three or more `orDone` layers | Excess goroutines, hard to debug | Merge done signals or use `context.WithCancel` tree |
| Using `orDone` on a buffered channel and expecting drain | Values lost on cancellation | Build `drainOrDone` explicitly or accept the loss |
| `orDone(ctx.Done(), c)` but also a bare `done` channel | Two cancellation worlds, easy to mismatch | Pick one, bridge at the boundary |
| Forgetting that `ctx` cancellation cascades | Cancelling parent cancels child silently | Build the tree intentionally with `WithCancel(parent)` |

---

## Patterns You Will See in Real Code

### Pattern: cancel-on-disconnect HTTP handler

```go
func (s *Server) StreamHandler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context() // cancels when client disconnects
    flusher := w.(http.Flusher)

    events := orDoneCtx(ctx, s.subscribe())
    for ev := range events {
        fmt.Fprintf(w, "data: %s\n\n", ev)
        flusher.Flush()
    }
}
```

`r.Context()` is closed by the `net/http` server when the client disconnects. The `events` stream stops without explicit cleanup.

### Pattern: bounded-time consumer

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()

for v := range orDoneCtx(ctx, source) {
    handle(v)
}
```

After five seconds, `ctx.Done()` closes, `orDone` exits, the loop ends. Simpler than a manual timer.

### Pattern: graceful shutdown of a worker pool

```go
done := make(chan struct{})
var wg sync.WaitGroup

for i := 0; i < workers; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for job := range orDone(done, jobs) {
            run(job)
        }
    }()
}

// On shutdown:
close(done)
wg.Wait()
```

Each worker exits its `range` when `done` closes. `WaitGroup` joins them.

### Pattern: library API returns a wrapped channel

```go
package eventbus

func (b *Bus) Subscribe(ctx context.Context) <-chan Event {
    raw := b.subscribe()
    return orDoneCtx(ctx, raw)
}
```

The library hides the `orDone` adapter behind its public API. Callers do `for ev := range bus.Subscribe(ctx)` and get cancellation for free.

### Pattern: testing with synthetic source

```go
func TestProcessor(t *testing.T) {
    src := make(chan int)
    done := make(chan struct{})

    go func() {
        defer close(src)
        for i := 0; i < 3; i++ {
            src <- i
        }
    }()

    var got []int
    for v := range orDone(done, src) {
        got = append(got, v)
    }
    close(done)
    // assert got == [0, 1, 2]
}
```

The `orDone` wrap is unnecessary for *this* test (the source closes on its own), but using it everywhere keeps the test shape consistent with production code.

---

At the middle level, `orDone` is no longer a curiosity; it is a habit. You wrap external channels at the API boundary, you compose with `context` where appropriate, you write leak tests, and you reason about producer-side cancellation as carefully as consumer-side wrapping. From here, the senior file looks at the deeper trade-offs: when to inline the pattern for performance, how it interacts with backpressure, and how to design APIs around it.

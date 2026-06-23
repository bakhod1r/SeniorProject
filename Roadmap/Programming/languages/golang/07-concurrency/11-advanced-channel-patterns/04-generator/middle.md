# Generator Pattern — Middle Level

> Focus: "Cancellation, composition, and integration with the rest of the pipeline vocabulary."

At junior level, the generator is a function that returns `<-chan T`. At middle level, it becomes a *contract*: a source that promises to yield values, close on EOF, respect cancellation, and surface errors deterministically. This file walks through that contract and how generators compose with fan-out, fan-in, tee, bridge, and rate-limiter.

## Table of Contents

1. [The Generator Contract](#the-generator-contract)
2. [Cancellation Idioms](#cancellation-idioms)
3. [Infinite Generators Without Leaks](#infinite-generators-without-leaks)
4. [Buffered vs Unbuffered Output](#buffered-vs-unbuffered-output)
5. [Composing With Other Channel Patterns](#composing-with-other-channel-patterns)
6. [Error Propagation From a Generator](#error-propagation-from-a-generator)
7. [Resource Ownership and Cleanup](#resource-ownership-and-cleanup)
8. [Testing Generators](#testing-generators)
9. [Common Middle-Level Bugs](#common-middle-level-bugs)
10. [Refactoring a Producer Into a Generator](#refactoring-a-producer-into-a-generator)

---

## The Generator Contract

A well-formed generator promises four things to the caller:

1. **Lifecycle:** values are produced lazily; the goroutine sleeps when the consumer is not reading; it exits on EOF or cancellation.
2. **Close:** the output channel closes exactly once, when production ends.
3. **Cancellation:** if a `ctx` or `done` is provided, the goroutine returns promptly when it fires.
4. **Cleanup:** any resources opened by the generator (file handles, DB cursors, HTTP bodies) are released before the goroutine exits.

Encode this contract in the doc-comment:

```go
// Lines yields each line of path until EOF or ctx is cancelled.
// On open error, returns (nil, err) synchronously.
// The returned channel closes when production ends; the file is closed
// before close.
func Lines(ctx context.Context, path string) (<-chan string, error)
```

A consumer who reads only the signature should be able to predict the runtime behaviour.

### The two error modes

A generator has two distinct failure surfaces:

- **Setup error:** could not even start (file not found, bad URL). Return synchronously as `(<-chan T, error)`. The consumer never sees the channel.
- **Streaming error:** mid-stream failure (read error, decode failure, network blip). Either embed in the element (`type Result struct { V T; Err error }`) or expose a separate `func (g *Gen) Err() error` accessor that the consumer checks after the channel closes.

The `bufio.Scanner` standard-library pattern is the latter: `Scan()` returns `bool`, and `Err()` is checked after the loop. A generator wrapping a scanner should preserve this distinction.

---

## Cancellation Idioms

Three forms appear in the wild. Pick one per project and stick to it.

### Form A — `done <-chan struct{}` (Cox-Buday style)

```go
func Counter(done <-chan struct{}) <-chan int {
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

Pros: minimal, no `context` import. Cons: doesn't carry deadlines or values; idiomatic only inside a self-contained module.

### Form B — `context.Context` (standard library style)

```go
func Counter(ctx context.Context) <-chan int {
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
```

Pros: composes with HTTP, DB, RPC. Required for any API that crosses package boundaries.

### Form C — explicit `Stop()` method

```go
type Counter struct {
    Out  <-chan int
    stop chan struct{}
}

func NewCounter() *Counter {
    c := &Counter{stop: make(chan struct{})}
    out := make(chan int)
    c.Out = out
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            select {
            case <-c.stop:
                return
            case out <- i:
            }
        }
    }()
    return c
}

func (c *Counter) Stop() { close(c.stop) }
```

Pros: ergonomic for callers who don't want to manage a context. Cons: easy to forget `Stop()` and leak; explicit lifecycle harder to compose.

### Don't mix the three

Pick one cancellation form per package. Mixing `done`, `ctx`, and `Stop()` in one codebase doubles cognitive load and triples the bug surface.

---

## Infinite Generators Without Leaks

Every infinite generator must guarantee: *if the consumer stops reading, the goroutine exits*.

The mandatory shape:

```go
for {
    next := compute()
    select {
    case <-ctx.Done():
        return
    case out <- next:
    }
}
```

Antipatterns:

- `out <- next` without a `select` — leaks instantly.
- `select { case <-ctx.Done(): return; default: out <- next }` — busy loop; turns into 100% CPU.
- `time.Sleep(1)` followed by `out <- next` — leaks during the sleep; the consumer's cancel signal isn't observed for a full second.

For ticker-driven generators, integrate cancellation into the ticker loop:

```go
func Ticks(ctx context.Context, d time.Duration) <-chan time.Time {
    out := make(chan time.Time)
    go func() {
        defer close(out)
        t := time.NewTicker(d)
        defer t.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case now := <-t.C:
                select {
                case <-ctx.Done():
                    return
                case out <- now:
                }
            }
        }
    }()
    return out
}
```

Note the double `select`: one waits for a tick, the other forwards it cancellably. Without the inner `select`, the goroutine would block on `out <- now` even after cancellation.

---

## Buffered vs Unbuffered Output

The default generator output is unbuffered. This gives the strongest backpressure: the producer sends only when the consumer is ready, and slow consumers naturally throttle the producer.

Add a buffer only for a specific reason:

- **Smoothing jitter.** The producer is bursty (reads chunks from disk); a buffer of 8-32 lets it run ahead between bursts.
- **Decoupling latency.** The producer's `compute()` is expensive; you want it to keep working while the consumer is busy.
- **Amortising channel cost.** Channel ops are ~50ns; for very fast producers, a buffer of 128 reduces per-item overhead.

Antipattern: `make(chan T, 10_000)` "just to be safe". A huge buffer hides backpressure and inflates memory. Treat buffer size as a tunable, not a default.

### Buffer of one as a "latest value" cache

```go
out := make(chan T, 1)
```

Lets the producer enqueue one value ahead. Useful when the consumer pulls irregularly and you do not want to block the producer instantly. Not a substitute for cancellation.

---

## Composing With Other Channel Patterns

A generator's value is in what comes *after* it. Compose them with the rest of the channel vocabulary:

### Fan-out (one generator, N workers)

```go
nums := Gen(1, 2, 3, 4, 5, 6, 7, 8)

workers := make([]<-chan int, 4)
for i := range workers {
    workers[i] = squareWorker(nums)
}

for v := range fanIn(workers...) {
    fmt.Println(v)
}
```

The single generator hands values out; each worker receives a different value. Order is not preserved.

### Fan-in (N generators, one stream)

```go
a := Gen(1, 2, 3)
b := Gen(4, 5, 6)
c := Gen(7, 8, 9)

for v := range fanIn(a, b, c) {
    fmt.Println(v)
}
```

The merged channel closes only when all inputs close.

### Tee (one generator, two consumers)

```go
src := Gen(1, 2, 3)
left, right := tee(src)
// left and right each receive every value of src.
```

Useful when one stream feeds both a logger and a processor.

### Bridge (channel of channels)

```go
chans := newChans(ctx)        // <-chan (<-chan int)
flat := bridge(ctx, chans)    // <-chan int
```

A generator can yield generators; `bridge` flattens them.

### Rate limiter

```go
src := Gen(...)
limited := rateLimit(src, 10) // 10/sec
```

Stack a rate-limiter on top of any generator without changing the generator.

The point: generators are *building blocks*. Keep them simple; compose them outside.

---

## Error Propagation From a Generator

A generator that hides an error is a bug magnet. Three idiomatic options:

### 1. Result type

```go
type Result[T any] struct {
    Value T
    Err   error
}

func Lines(ctx context.Context, path string) <-chan Result[string] {
    out := make(chan Result[string])
    go func() {
        defer close(out)
        f, err := os.Open(path)
        if err != nil {
            out <- Result[string]{Err: err}
            return
        }
        defer f.Close()
        s := bufio.NewScanner(f)
        for s.Scan() {
            select {
            case <-ctx.Done():
                return
            case out <- Result[string]{Value: s.Text()}:
            }
        }
        if err := s.Err(); err != nil {
            out <- Result[string]{Err: err}
        }
    }()
    return out
}
```

Pros: errors flow downstream; consumer checks `r.Err`. Cons: every consumer must check.

### 2. Side channel

```go
func Lines(ctx context.Context, path string) (<-chan string, <-chan error)
```

Two channels: values, errors. Consumer `select`s on both. Pros: keeps value type clean. Cons: easy to forget the error channel.

### 3. Trailing error accessor

```go
type Stream struct {
    Out <-chan string
    err error
    mu  sync.Mutex
}
func (s *Stream) Err() error { s.mu.Lock(); defer s.mu.Unlock(); return s.err }
```

Set `err` before closing `Out`. Consumer checks `s.Err()` *after* the `range` ends. Pros: mimics `bufio.Scanner`. Cons: requires a struct, not a free function.

Pick one per project. Inconsistency confuses consumers more than the choice itself.

---

## Resource Ownership and Cleanup

A generator that opens a file, a DB cursor, or an HTTP body owns those resources. Cleanup must happen *inside* the goroutine, *before* the close.

```go
func Lines(ctx context.Context, path string) (<-chan string, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    out := make(chan string)
    go func() {
        defer close(out)
        defer f.Close()              // runs after defer close(out), so before close? No — see below.
        s := bufio.NewScanner(f)
        for s.Scan() {
            select {
            case <-ctx.Done():
                return
            case out <- s.Text():
            }
        }
    }()
    return out, nil
}
```

Wait — `defer` is LIFO. The deferred `f.Close()` runs *before* `defer close(out)` because it was deferred *second* and pops first. That means the file is closed before the channel is closed. Good.

Order matters. Defer in this order:

```go
defer close(out)   // outermost: runs LAST
defer f.Close()    // inner: runs FIRST
```

So the file is released first, then consumers learn EOF. This is usually what you want, because a consumer who sees the close might immediately try to reopen the file.

If the generator opens multiple resources, defer each in reverse-acquisition order; standard Go cleanup discipline.

---

## Testing Generators

A generator is testable as a pure function of inputs to a slice of outputs:

```go
func collect[T any](ch <-chan T) []T {
    var out []T
    for v := range ch {
        out = append(out, v)
    }
    return out
}

func TestGen(t *testing.T) {
    got := collect(Gen(1, 2, 3))
    want := []int{1, 2, 3}
    if !reflect.DeepEqual(got, want) {
        t.Fatalf("got %v want %v", got, want)
    }
}
```

Test the three contract properties:

1. **Yields the right values.** Collect into a slice, compare.
2. **Closes the channel.** `_, ok := <-ch; if ok { t.Fatal("expected closed") }`.
3. **Respects cancellation.** Start, cancel, expect the channel to close within a short timeout.

```go
func TestCounterCancel(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    out := Counter(ctx)
    <-out
    cancel()
    select {
    case _, ok := <-out:
        if ok {
            // drain remaining buffered values
            for range out {
            }
        }
    case <-time.After(time.Second):
        t.Fatal("counter did not stop")
    }
}
```

Run with `-race`. Generators with shared state between goroutine and caller will fail under the race detector.

---

## Common Middle-Level Bugs

1. **Forgotten cancellation case.** Infinite generator without `<-ctx.Done()` leaks when consumer stops.
2. **Outer `select` only.** Cancellation observed only at one point per iteration; if `compute()` blocks, cancel is ignored.
3. **Wrong defer order.** `defer f.Close()` placed before `defer close(out)` runs in the wrong order; consumers see EOF while file is still open.
4. **Double-close on retry.** Generator restarted after error; the second goroutine tries to close an already-closed channel; panics.
5. **Send inside a nested goroutine without coordination.** Two inner goroutines race on the output channel; close happens before all have stopped sending; panic.
6. **Buffered channel masking deadlock.** Buffer of 1000 lets producer run far ahead; deadlock surfaces only when buffer fills, in production, under load.
7. **Setup error masquerading as EOF.** Generator opens file inside the goroutine; on failure it just `return`s and closes the channel; consumer sees zero items and assumes empty file.
8. **Ctx ignored after the first `select`.** Inner loops (e.g., over page items) forget to re-check `ctx.Done()`; large pages are not interruptible mid-page.

---

## Refactoring a Producer Into a Generator

You have a function:

```go
func ProcessFile(path string, fn func(string) error) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close()
    s := bufio.NewScanner(f)
    for s.Scan() {
        if err := fn(s.Text()); err != nil {
            return err
        }
    }
    return s.Err()
}
```

It is a callback-style producer. To make it a generator:

1. Replace the callback with a channel send.
2. Return `(<-chan string, error)` or `<-chan Result[string]`.
3. Make it cancellable.

```go
func Lines(ctx context.Context, path string) (<-chan string, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    out := make(chan string)
    go func() {
        defer close(out)
        defer f.Close()
        s := bufio.NewScanner(f)
        for s.Scan() {
            select {
            case <-ctx.Done():
                return
            case out <- s.Text():
            }
        }
        // Scanner errors are dropped here; switch to Result[string] if you need them.
    }()
    return out, nil
}
```

The callback form is eager; the generator form is lazy. The consumer gains:
- The freedom to stop reading without bubbling an error.
- The ability to compose with downstream channel stages.
- A `context.Context`-aware shutdown.

The cost:
- One goroutine.
- Channel send/receive overhead per line.
- A more involved testing approach.

The trade-off is almost always worth it when the consumer is a pipeline, and almost never worth it when the consumer is a single tight `for` loop. (More on that at senior level, where we contrast with Go 1.23 range-over-func.)

---

A middle-level generator is a documented, cancellable, well-cleaned-up source stage. Get its contract right, and every downstream stage becomes trivial to write.

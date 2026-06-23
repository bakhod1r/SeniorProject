# Generator Pattern — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "I want a function that, when called, hands me a stream of values I can `range` over."

A **generator** is the simplest kind of producer in Go concurrency: a function whose return type is `<-chan T`. Call it once, get back a receive-only channel, and read values one by one until the channel closes. Inside the function, a single goroutine sends the values and closes the channel when done. The caller never sees the goroutine; they just see a channel.

The pattern is everywhere in idiomatic Go pipelines. Whenever you read a slice into a pipeline, walk a directory, paginate a REST API, or count from one to infinity, you write a generator. It is the *source* stage that everything else hangs off of.

The big idea: a generator turns "values" into "a stream of values, delivered when the consumer is ready". The caller pulls one at a time; the goroutine pushes one at a time; the channel mediates the rhythm.

After reading this file you will:
- Recognise the canonical generator shape and write one from memory.
- Use a generic generator: `func gen[T any](values ...T) <-chan T`.
- Plug a generator into a pipeline (filter, map, sink).
- Write a cancellable generator using a `done` channel.
- Write an infinite generator without leaking goroutines.
- Spot common bugs: missing `close`, missing `done` case, blocking sends.

You do **not** yet need to compare generators with Go 1.23 `range`-over-func, or design backpressure-tuned generators. Those topics live in middle and senior.

---

## Prerequisites

- **Required:** Goroutines, channels, `range`, `close`.
- **Required:** Returning a `<-chan T` from a function and reading from it.
- **Helpful:** Familiarity with the pipeline pattern (`gen → square → sum`).
- **Helpful:** Knowing why a goroutine without an exit path leaks.

If you can write a function that spawns a goroutine, sends a few values on a channel, and `defer close`s that channel, you are ready for this page.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Generator** | A function that returns `<-chan T` and produces a stream of `T` values from a private goroutine. |
| **Source** | The first stage of a pipeline — the generator. It has no input channel. |
| **Receive-only channel** | A channel typed as `<-chan T`; the caller can only receive, not send or close. |
| **Send-only channel** | A channel typed as `chan<- T`; only the owner can send. Inside a generator, the output channel is `chan T` (bidirectional) but is returned typed as `<-chan T`. |
| **Cancellable generator** | A generator that accepts a cancel signal (`done <-chan struct{}` or `context.Context`) so it can stop early without leaking. |
| **Infinite generator** | A generator that has no natural end (counter, ticker, poller). Must be cancellable. |
| **Range-over-func** | Go 1.23+ feature that lets a function be ranged over with `for x := range fn`. An alternative to channel generators when concurrency is not needed. |
| **Leak** | A goroutine that never returns because its send blocked forever. The most common bug in this pattern. |
| **Done channel** | An unbuffered `chan struct{}` whose *close* signals cancellation to receivers via `<-done`. |

---

## Core Concepts

### The canonical generator shape

Every generator follows this template:

```go
func gen(values ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, v := range values {
            out <- v
        }
    }()
    return out
}
```

Read it line by line:
1. The function returns `<-chan int` — a *receive-only* channel. The caller cannot accidentally send or close.
2. `out := make(chan int)` — the generator owns this channel.
3. `go func() { ... }()` — a goroutine runs in the background.
4. `defer close(out)` — when the goroutine exits, the channel is closed. This is what tells the caller "no more values".
5. `for _, v := range values { out <- v }` — the goroutine sends each value, blocking until the caller is ready.
6. `return out` — the bidirectional `chan int` is returned typed as `<-chan int` (Go converts implicitly).

The three rules:
- **The generator creates the channel.**
- **The generator closes the channel** (exactly once, via `defer`).
- **The caller only receives.** Never sends to a generator's channel.

### Generic generator template

With Go generics, the canonical generator becomes universally reusable:

```go
func Gen[T any](values ...T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for _, v := range values {
            out <- v
        }
    }()
    return out
}
```

Now `Gen(1, 2, 3)` yields `<-chan int`, `Gen("a", "b")` yields `<-chan string`, and `Gen(user1, user2)` yields `<-chan User`. One template, all element types.

### Generator from a slice

```go
func FromSlice[T any](s []T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for _, v := range s {
            out <- v
        }
    }()
    return out
}
```

Identical pattern, but takes a slice instead of variadic args. Use this when the values already live in a slice.

### Cancellable generator with `done`

An infinite or long-running generator must be cancellable, otherwise it leaks the moment the caller stops reading.

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

The `select` has two cases:
- `<-done` — if the caller has closed `done`, the goroutine returns; `defer close(out)` fires; no leak.
- `out <- i` — normal send.

Whichever is ready first wins. If both are ready, Go picks one at random. The `done` case ensures the goroutine always has a way out.

### Cancellable generator with `context.Context`

Modern Go uses `context.Context` for cancellation. The shape is the same:

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

`ctx.Done()` returns a `<-chan struct{}` that closes when the context is cancelled (by deadline, timeout, or explicit `cancel()`). Functionally identical to the `done`-channel form, but plugs into the standard library and propagates across API boundaries.

### Composing generators

A generator is the *source* of a pipeline. The output feeds into the next stage:

```go
func main() {
    nums := Gen(1, 2, 3, 4)
    sq := square(nums)
    for v := range sq {
        fmt.Println(v) // 1 4 9 16
    }
}
```

The same generator can feed into fan-out (N workers reading from one generator), fan-in (merge several generators), tee (duplicate), or bridge (flatten a channel of channels).

---

## Real-World Analogies

### A waiter handing out plates
You sit at a counter. The waiter brings plate after plate. When the kitchen runs out, the waiter says "that is the last one" (close). You eat at your own pace; the waiter waits for your empty hand before bringing the next plate (backpressure).

### A vending machine
You press a button, a soda drops. You can keep pressing for more. When the machine is empty (close), pressing does nothing. The machine never floods the floor with sodas — it only releases one when you ask.

### A magazine subscription
A new issue arrives in your mailbox every month. You read at your leisure. Eventually the subscription ends (close). You did not have to know how the magazine was printed; you only saw the channel (your mailbox).

### A turnstile at a stadium
People enter one at a time. The turnstile is the generator: it produces a stream of "person N entered" events. When the stadium is full or the event ends, the turnstile stops.

### A spool of thread
You pull thread off as you sew. The spool only releases as much as you draw. When it is empty, you are done. Backpressure is built in: you cannot pull faster than your hand moves.

---

## Mental Models

### Model 1: "A function that returns a stream"
A generator is the natural Go answer to "give me an iterator". Instead of an object with `Next()`, you get a channel and `range` it.

### Model 2: "The goroutine is hidden behind the channel"
The caller never touches the goroutine directly. They only see `<-chan T`. The goroutine exits when the channel closes; you never have to `Wait()` for it.

### Model 3: "Lazy by default"
The goroutine sends one value, then blocks on the next send until the caller is ready. Nothing is produced eagerly. This makes generators safe for large or infinite sequences.

### Model 4: "Cancellation is just another receive"
`done` and `ctx.Done()` are receive operations. They sit alongside the send in a `select`. Whichever is ready first wins.

### Model 5: "One owner, one closer"
The goroutine inside the generator is the channel's *owner*. It is the only one that sends. It is the only one that closes. The caller never does either.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Trivially composable into pipelines. | One goroutine per generator. |
| Lazy evaluation — no wasted work. | Cancellation requires extra plumbing. |
| Natural backpressure via channel send. | Forgotten `close` causes consumer hangs. |
| Element type is type-safe (generics). | Forgotten cancel case causes producer leaks. |
| Source of values is fully encapsulated. | Channel ops have ~50ns overhead per item. |
| Caller sees only a `<-chan T`. | Less efficient than tight in-place loops. |
| Easy to test (consume and assert). | Range-over-func is faster for non-concurrent use. |

---

## Use Cases

- **Reading a slice into a pipeline** — turn `[]string` into `<-chan string`.
- **File line scanner** — yield lines one at a time from a large file.
- **REST paginator** — yield items page by page from an API.
- **Database cursor** — yield rows from a long `SELECT`.
- **Directory walker** — yield file paths from `filepath.Walk`.
- **Natural numbers / Fibonacci / primes** — classic infinite math generators.
- **Test fixtures** — yield a stream of synthetic events to a pipeline under test.
- **Event poller** — yield events fetched periodically from a queue.

---

## Code Examples

### Example 1: simple finite generator

```go
package main

import "fmt"

func gen(values ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, v := range values {
            out <- v
        }
    }()
    return out
}

func main() {
    for v := range gen(10, 20, 30) {
        fmt.Println(v)
    }
}
```

Output: `10 20 30`. After the third value, the goroutine's `for` loop ends, `defer close(out)` fires, and the caller's `range` exits.

### Example 2: generic generator

```go
func Gen[T any](values ...T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for _, v := range values {
            out <- v
        }
    }()
    return out
}

func main() {
    for s := range Gen("a", "b", "c") {
        fmt.Println(s)
    }
}
```

### Example 3: infinite counter with `done`

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

func main() {
    done := make(chan struct{})
    nums := Counter(done)
    for i := 0; i < 5; i++ {
        fmt.Println(<-nums)
    }
    close(done)
    // Generator goroutine drains and exits.
}
```

### Example 4: cancellable generator with `context.Context`

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

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    nums := Counter(ctx)
    for i := 0; i < 5; i++ {
        fmt.Println(<-nums)
    }
    cancel() // graceful stop
}
```

### Example 5: file line generator

```go
func ReadLines(path string) (<-chan string, error) {
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
            out <- s.Text()
        }
    }()
    return out, nil
}
```

The open error is returned synchronously; only the streaming part is concurrent.

### Example 6: pipeline with a generator at the source

```go
func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- v * v
        }
    }()
    return out
}

func main() {
    for v := range square(Gen(1, 2, 3, 4)) {
        fmt.Println(v) // 1 4 9 16
    }
}
```

### Example 7: paginator generator

```go
type Page struct {
    Items []Item
    Next  string
}

func Pages(ctx context.Context, fetch func(cursor string) (Page, error)) <-chan Item {
    out := make(chan Item)
    go func() {
        defer close(out)
        cursor := ""
        for {
            page, err := fetch(cursor)
            if err != nil {
                return
            }
            for _, it := range page.Items {
                select {
                case <-ctx.Done():
                    return
                case out <- it:
                }
            }
            if page.Next == "" {
                return
            }
            cursor = page.Next
        }
    }()
    return out
}
```

One generator hides the entire pagination state machine. The caller just `range`s.

### Example 8: deliberately leaky generator (to study, not to copy)

```go
func Leaky() <-chan int {
    out := make(chan int)
    go func() {
        for i := 0; ; i++ {
            out <- i // no select, no done, no ctx
        }
    }()
    return out
}

func main() {
    nums := Leaky()
    fmt.Println(<-nums)
    // Goroutine is stuck on `out <- 1` forever. Leak.
}
```

Read this, then never write it. Every infinite generator needs a cancel case.

---

## Coding Patterns

### Pattern: canonical shape
```go
func gen(args) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        // produce values
    }()
    return out
}
```
Memorise it. You will write it hundreds of times.

### Pattern: variadic source
`func Gen[T any](values ...T) <-chan T` — the simplest possible generator. Used in tests and demos.

### Pattern: slice source
`func FromSlice[T any](s []T) <-chan T` — when the values are already in a slice.

### Pattern: cancellable infinite
```go
for {
    select {
    case <-done:
        return
    case out <- next():
    }
}
```
The mandatory shape for any non-terminating generator.

### Pattern: context-aware
Take `ctx context.Context` as the first argument; use `ctx.Done()` in the `select`. The modern idiom.

### Pattern: error returned synchronously, values streamed asynchronously
If setup (open file, dial DB) can fail, return `(<-chan T, error)`. Stream values on the channel; report fatal setup errors via the return.

### Pattern: paginator
The generator hides the loop over pages; the consumer just sees a flat stream of items.

---

## Clean Code

- Name generators by *what they produce*: `Lines`, `Rows`, `Pages`, `Events`, `Counter`.
- Always return `<-chan T`, never `chan T`. The receive-only type documents the contract.
- Put `defer close(out)` as the *first* line of the goroutine. This guarantees it runs even on `return`.
- Put `ctx` or `done` as the first parameter of cancellable generators.
- Keep the goroutine body short. If it grows, extract a helper.
- Document the element type in a one-line doc-comment: `// Lines yields each non-empty line of path, until EOF or ctx is cancelled.`
- Never spawn more than one goroutine per generator at the junior level. Fan-out is a different pattern.

---

## Product Use / Feature

In a real product, you almost always write generators for I/O sources:

```
PostgreSQL cursor   ─▶  <-chan Row  ─▶  enrich  ─▶  validate  ─▶  write to Parquet
Stripe API pages    ─▶  <-chan Invoice ─▶ summarise ─▶ email
Kafka consumer      ─▶  <-chan Event ─▶  dedupe  ─▶  index
filepath.Walk       ─▶  <-chan string ─▶ hash ─▶ store
```

The generator hides the cursor / pagination / offset / iterator state. The downstream stages see a flat stream and can be reused across products.

A junior implementation should:
- Always make the generator cancellable (take `ctx` even if the data set is finite).
- Always document the close-on-EOF guarantee.
- Always return setup errors synchronously, not via panics or a separate channel.
- Always test with `-race`.

---

## Error Handling

Generators face two error scenarios:

**Setup errors** (cannot start producing at all): return them synchronously.
```go
func ReadLines(path string) (<-chan string, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    // ... stream lines ...
}
```

**Streaming errors** (something failed mid-stream): send a value carrying the error.
```go
type Result struct {
    Line string
    Err  error
}

func ReadLines(ctx context.Context, path string) <-chan Result {
    out := make(chan Result)
    go func() {
        defer close(out)
        f, err := os.Open(path)
        if err != nil {
            out <- Result{Err: err}
            return
        }
        defer f.Close()
        s := bufio.NewScanner(f)
        for s.Scan() {
            select {
            case <-ctx.Done():
                return
            case out <- Result{Line: s.Text()}:
            }
        }
        if err := s.Err(); err != nil {
            out <- Result{Err: err}
        }
    }()
    return out
}
```

A junior generator should not silently drop errors. Either return them or send them downstream.

---

## Security Considerations

- A generator backed by external input (file, network) must validate or sanitise *before* releasing values to downstream stages. Untrusted input flowing through a pipeline turns every stage into a potential attack surface.
- Do not log raw values inside a generator if values may contain PII or secrets. Log shapes (`len(line) bytes received`) instead.
- Generators that hit external systems (HTTP, DB) must respect rate limits. Combine with a rate-limiter stage or sleep between fetches.
- An infinite generator that never sees cancellation is a resource leak — and a leak with goroutine stacks growing forever is a memory exhaustion vector.

---

## Performance Tips

- Channel send/receive is ~50ns. For very tight loops (millions of integers), a generator may dominate the wall clock; range-over-func or a plain `for` loop is faster (covered in middle/senior).
- Buffer the channel (`make(chan T, 16)`) only if profiling shows the consumer cannot keep up momentarily. Default is unbuffered.
- A generator is one goroutine. Goroutines are cheap (~2KB stack) but not free; do not spawn one generator per item — spawn one generator that yields items.
- Avoid heavy work inside the generator goroutine if the goal is just to *stream* values; push transformations into downstream stages so they can fan out.
- For very fast producers, batch values into a slice and send slices: `<-chan []T` instead of `<-chan T` reduces channel ops 100×.

---

## Best Practices

1. Always return `<-chan T`, never `chan T`.
2. Always `defer close(out)` as the first line of the goroutine.
3. Always have a cancellation path for non-terminating generators.
4. Use generics: `func Gen[T any](...)` over per-type duplicates.
5. Test every generator with `-race`.
6. Document: "yields ... until ... or ctx is cancelled".
7. Return setup errors synchronously; stream runtime errors as data.
8. Name the function by what it yields, not by *how* it yields.

---

## Edge Cases & Pitfalls

- **Caller stops reading early.** The goroutine blocks on `out <- v` forever — a leak. Fix: cancellation.
- **`close` forgotten.** Caller's `range` never exits. Fix: `defer close(out)` first line.
- **Panic inside the goroutine.** `defer close(out)` still runs (because `defer` runs on panic), so consumers see EOF — but the program crashes unless the panic is recovered.
- **Empty input.** Generator should send zero values and close cleanly. Always works if you use `defer close`.
- **Single-element input.** Should also work cleanly.
- **Generator returns a non-receive-only `chan T`.** Caller can accidentally close it; double-close panics. Always return `<-chan T`.
- **Both `done` and a normal exit fire.** Whichever the `select` picks first wins; either way the goroutine exits and closes the channel.

---

## Common Mistakes

1. Forgetting `defer close(out)` — consumer hangs.
2. Forgetting the `<-done` / `<-ctx.Done()` case in an infinite generator — producer leaks.
3. Returning `chan T` instead of `<-chan T` — leaks ownership.
4. Spawning multiple goroutines that all write to one channel without coordination — race on close, duplicate sends.
5. Logging or doing I/O inside the goroutine on every value — kills laziness.
6. Sending nil or zero values to signal EOF — use `close` instead.
7. Calling `close` from the caller — only the producer closes.
8. Putting the generator's send and a long blocking call in the same `case` — defeats cancellation.

---

## Common Misconceptions

- "A generator must be infinite." It can be finite (slice) or infinite (counter) — both are valid.
- "The goroutine runs eagerly to completion." It runs lazily: each send blocks until the consumer is ready.
- "Closing the channel from the caller stops the generator." Closing is illegal from the caller; use `done` or `ctx`.
- "A generator needs a buffer to work." Unbuffered is the default and the safest choice.
- "Channel generators are always slower than iterators." For small loops yes; for I/O-bound or concurrent pipelines, the throughput is dominated by I/O, not channel ops.
- "I can return the same channel from the generator each call." No — each call creates a new channel and goroutine. Multiple consumers would otherwise compete for values.

---

## Tricky Points

- **`defer close(out)` runs even on panic.** This is a feature: consumers still see EOF. But the program crashes unless the panic is recovered. A generator that may panic should `recover()` inside the goroutine.
- **The returned `<-chan T` is the same channel, just typed differently.** `make(chan T)` gives a bidirectional value; the implicit conversion to `<-chan T` on return is a *type* change, not a copy.
- **Select with `done` is unfair by design.** When both cases are ready, Go picks randomly. The goroutine may produce one extra value after `done` fired. Consumers must tolerate this.
- **A generator does not retain references to its arguments beyond the goroutine's lifetime.** Once the goroutine exits, slices passed in can be GC'd as usual.
- **You cannot call the generator twice on the same source.** A second call to `Gen(...)` makes a new channel and goroutine; if the underlying source (file, cursor) is exhausted, the second generator yields nothing.

---

## Test

```go
package gen_test

import (
    "context"
    "testing"
    "time"
)

func TestGenFinite(t *testing.T) {
    var got []int
    for v := range Gen(1, 2, 3) {
        got = append(got, v)
    }
    if len(got) != 3 || got[0] != 1 || got[2] != 3 {
        t.Fatalf("unexpected: %v", got)
    }
}

func TestGenEmpty(t *testing.T) {
    for range Gen[int]() {
        t.Fatal("expected no values")
    }
}

func TestCounterCancellation(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    nums := Counter(ctx)
    <-nums
    <-nums
    cancel()

    drainDeadline := time.After(time.Second)
    for {
        select {
        case _, ok := <-nums:
            if !ok {
                return // closed cleanly
            }
        case <-drainDeadline:
            t.Fatal("counter did not stop after cancel")
        }
    }
}
```

Always run `go test -race`.

---

## Tricky Questions

1. **Why must the generator close its output channel?** So the consumer's `range` loop terminates.
2. **Why is `defer close(out)` the first defer?** Because defers run LIFO; the first deferred is the last to run.
3. **What if the consumer stops reading early?** The goroutine blocks on `out <- v` forever — that is a leak. Use `done` or `ctx` to give it an exit path.
4. **Why return `<-chan T` and not `chan T`?** To prevent the caller from sending or closing.
5. **Can a generator have multiple producers internally?** Yes (fan-out source), but then you need a closer goroutine or `sync.WaitGroup` to coordinate the close.
6. **What happens when the channel is unbuffered and the consumer is slow?** The goroutine blocks on the send. Natural backpressure.
7. **What is the difference between `done <-chan struct{}` and `ctx context.Context`?** Functionally the same for cancellation; `ctx` also carries deadlines and values, and is the standard library convention.
8. **Can a generator panic?** Yes; `defer close(out)` still runs, so consumers see EOF. The panic still crashes the program unless `recover`ed.

---

## Cheat Sheet

```go
// Generator template:
func Gen[T any](values ...T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for _, v := range values {
            out <- v
        }
    }()
    return out
}

// Cancellable infinite generator template:
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

| Element | Form |
|---------|------|
| Return type | `<-chan T` |
| Channel creation | `out := make(chan T)` |
| Close | `defer close(out)` as first line |
| Cancellation | `select { case <-ctx.Done(): return; case out <- v: }` |
| Consumer | `for v := range gen(...) { ... }` |

---

## Self-Assessment Checklist

- [ ] I can write a generic generator from memory.
- [ ] I know why the return type is `<-chan T` and not `chan T`.
- [ ] I can write a cancellable infinite generator using `ctx`.
- [ ] I can explain what happens if the consumer stops reading early.
- [ ] I can name three places generators appear in real systems.
- [ ] I can write a generator over a file's lines.
- [ ] I can test a generator with `-race` and pass.

---

## Summary

A generator is a function that returns `<-chan T` and spawns one goroutine to send values. It is the canonical *source* stage of every Go pipeline. The shape is always the same: create the channel, `defer close`, send in a loop, return the receive-only end. Generic templates make it reusable across all element types. Infinite generators must be cancellable via `done` or `ctx`, otherwise the producer leaks when the consumer bails out. Master this small pattern and you have the foundation for fan-out, fan-in, tee, bridge, and every channel pipeline you will ever write.

---

## What You Can Build

- A `Lines(path)` generator that yields each line of a text file.
- A `Counter(ctx)` generator that emits 0, 1, 2, ... until cancelled.
- A `Walk(root)` generator that yields file paths under a directory.
- A `Pages(ctx, fetch)` generator that paginates a REST API.
- A simple ETL: `Lines → parse → validate → write`.
- A primes generator using a sieve of nested generators (classic).

---

## Further Reading

- The Go Blog: "Go Concurrency Patterns: Pipelines and cancellation".
- Katherine Cox-Buday, *Concurrency in Go*, chapters on generators and pipelines.
- The Go 1.23 release notes: `range` over function iterators.
- Rob Pike's talk "Concurrency is not parallelism".

---

## Related Topics

- Pipeline pattern — generators feed pipelines.
- Fan-out — multiple consumers reading from one generator.
- Fan-in — merging several generators into one stream.
- Tee channel — duplicating a generator's stream.
- Bridge channel — flattening a `<-chan <-chan T` into `<-chan T`.
- Or-done channel — cancellation adapter for non-context generators.
- Context — modern cancellation idiom.
- Range over function (Go 1.23+) — non-concurrent alternative.

---

## Diagrams & Visual Aids

```
                ┌────────────────────────────────────┐
                │  generator() goroutine             │
   caller       │                                    │
   reads  ◀─── chan ◀── send  ◀── produce next value │
                │                                    │
                │  defer close(chan) on return       │
                └────────────────────────────────────┘
```

```
Cancellable generator:

       caller                              generator goroutine
         │                                          │
         │── close(done) ──────────▶ select picks <-done case
         │                                          │
         │                                       return
         │                                          │
         │◀── chan closed (via defer close) ────────┘
         │
       range exits
```

```
Pipeline with generator at the source:

  Gen(1,2,3,4)  ─▶  square  ─▶  filter  ─▶  sum
   chan int        chan int    chan int     int
```

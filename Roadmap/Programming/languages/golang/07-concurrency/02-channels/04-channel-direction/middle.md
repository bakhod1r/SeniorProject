# Channel Direction — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Channel Direction in API Design](#channel-direction-in-api-design)
3. [The Pipeline Pattern, in Detail](#the-pipeline-pattern-in-detail)
4. [Ownership and Lifetime via Direction](#ownership-and-lifetime-via-direction)
5. [Fan-Out, Fan-In, and Directional Glue](#fan-out-fan-in-and-directional-glue)
6. [`select` with Directional Channels](#select-with-directional-channels)
7. [Conversions, Revisited](#conversions-revisited)
8. [Directional Channels in Struct Fields](#directional-channels-in-struct-fields)
9. [Using Direction with Generics](#using-direction-with-generics)
10. [Refactor Playbooks](#refactor-playbooks)
11. [Testing With Directional Channels](#testing-with-directional-channels)
12. [Performance Notes](#performance-notes)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## Introduction

At junior level you learned the syntax and the conversion rules. At middle level you turn those rules into **design decisions**. You stop asking "is this `chan T` or `<-chan T`?" and start asking:

- Where in this codebase should direction appear?
- Who owns the close?
- How do I let a subscriber stop without giving them the bidirectional reference?
- How do directional types fit with generics?
- How do I refactor a 5-year-old `chan T`-everywhere package into something safer without breaking callers?

After this file you will:

- Choose between `chan T` and a directional view at each function boundary, with a rule of thumb.
- Build a 3+ stage pipeline whose lifetimes are explicit at the type level.
- Use direction together with `context.Context` for cancellation across many goroutines.
- Refactor an existing API to add direction without breaking callers, in a controlled way.
- Use directional types with generic functions for reusable pipeline helpers.

---

## Channel Direction in API Design

### The boundary rule

> **At a function or method boundary, the channel type should reflect the role.**

Three roles, three types:

| Role | Direction | Why |
|---|---|---|
| Producer | `chan<- T` | They send and may close. They never read. |
| Consumer | `<-chan T` | They receive and may range. They never send or close. |
| Mediator | `chan T` | They read from upstream and write to downstream — but each is a different channel, so prefer split signatures. |

A pure mediator stage in a pipeline takes `<-chan In` and returns `<-chan Out`. The intermediate `chan Out` it creates inside is bidirectional, but it never escapes — only the receive-only view does.

### Reading a signature

A reviewer should be able to tell from the signature alone:

```go
func Logger(ctx context.Context, in <-chan LogEntry) error
```

- Takes a stream to read.
- Cannot publish into the stream.
- Returns an error — possibly from `ctx.Err()` or a disk write failure.
- Will stop when `in` is closed or `ctx` is done.

Compare to a sloppy signature:

```go
func Logger(ctx context.Context, in chan LogEntry) error
```

Same code may work, but now the reader has to read the body to learn the function's relationship with `in`. The directional version saves them the trip.

### A worked example: an HTTP middleware that records requests

```go
type Recorder struct {
    requests chan request
}

func New() *Recorder {
    r := &Recorder{requests: make(chan request, 1024)}
    go r.run()
    return r
}

func (r *Recorder) Record() chan<- request   { return r.requests }
func (r *Recorder) Stream() <-chan request   { return r.requests }
```

Wait — but `requests` is the same channel. If we expose it both ways, anyone with `Record()` *and* `Stream()` could theoretically do both. Yes — but each method narrows what its caller can do. The struct's *internal* `r.run()` is the only place that needs the bidirectional reference (and it does not, because it only reads):

```go
func (r *Recorder) run() {
    for req := range r.requests {
        writeToDisk(req)
    }
}
```

If you want to be truly strict, hide the channel completely and replace `Record()` with a method that does the send:

```go
func (r *Recorder) Record(req request) {
    select {
    case r.requests <- req:
    default:           // drop if full
    }
}
```

The trade-off: method-call interface is more flexible (you can add back-pressure logic, metrics, drop policy), but channel-typed return is more composable with `select`.

---

## The Pipeline Pattern, in Detail

A pipeline is a series of stages connected by channels. Each stage:

1. Receives from an input channel (`<-chan In`).
2. Sends to an output channel (`chan<- Out`).
3. Closes its output when its input closes (or when cancelled).
4. Runs as one or more goroutines.

### Canonical three-stage pipeline

```go
func gen(ctx context.Context, nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range nums {
            select {
            case out <- n:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func square(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            select {
            case out <- v * v:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func print(ctx context.Context, in <-chan int) {
    for v := range in {
        fmt.Println(v)
        if ctx.Err() != nil {
            return
        }
    }
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    print(ctx, square(ctx, gen(ctx, 1, 2, 3, 4)))
}
```

What direction guarantees here:

- `gen` cannot read from its own output by accident.
- `square` cannot send back into `in`.
- `print` cannot send into `in` or close it.
- The bidirectional `out` channels are visible only inside each stage's goroutine.

### Stage variants you will write

| Variant | Signature | Notes |
|---|---|---|
| Source (no input) | `func gen(ctx) <-chan T` | The starting stage. |
| Map | `func map(ctx, in <-chan In) <-chan Out` | One-to-one transform. |
| Filter | `func filter(ctx, in <-chan T, pred func(T) bool) <-chan T` | Drop some values. |
| Flatten | `func flatten(ctx, in <-chan []T) <-chan T` | One input slice → many outputs. |
| Group | `func group(ctx, in <-chan T, n int) <-chan []T` | Many inputs → batched output. |
| Sink (no output) | `func write(ctx, in <-chan T) error` | The terminating stage. |

Every variant follows the same shape: directional inputs, directional outputs (or none), one goroutine per stage, defer close, ctx-aware sends.

### The "always defer close" rule

```go
func stage(ctx context.Context, in <-chan In) <-chan Out {
    out := make(chan Out)
    go func() {
        defer close(out)       // <-- always
        for v := range in {
            select {
            case out <- transform(v):
            case <-ctx.Done():
                return         // close fires
            }
        }
    }()
    return out
}
```

The directional return type `chan<- Out` *cannot* be closed by anyone outside the goroutine, so the goroutine is the only entity that can. `defer close(out)` ensures it fires on every exit path: normal end-of-loop, ctx cancellation, or panic.

### Composition

A pipeline composes by passing the receive-only return of one stage into the receive-only parameter of the next. The implicit conversion at the parameter is unnecessary — both are already `<-chan T`. The type system says nothing changes.

Sketch:

```go
out := write(ctx, batch(ctx, filter(ctx, square(ctx, gen(ctx, source)))))
```

Each call site stitches one stage to the next with no type adapter required.

---

## Ownership and Lifetime via Direction

A common Go question: "who closes the channel?"

The direction answers it. The reference of type `chan T` or `chan<- T` is the one that may close. Therefore:

> **Whoever needs to call `close` must hold a sendable reference (bi or send-only).**

The flip side:

> **Whoever holds only `<-chan T` cannot close, by construction.**

This is the type system enforcing the *senders close, never receivers* rule.

### Two ownership styles

**Style A: One owner per channel.**

```go
type Stream struct {
    out chan Event             // owner side
}

func (s *Stream) Out() <-chan Event { return s.out }    // public read-only view
func (s *Stream) emit(e Event)      { s.out <- e }      // private emit
func (s *Stream) Close()            { close(s.out) }     // public close-on-stream
```

The Stream owns the channel. Senders within the package call `emit`. External code reads via `Out()`.

**Style B: Channel is the API.**

```go
func NewStream() (chan<- Event, <-chan Event) {
    ch := make(chan Event, 64)
    return ch, ch
}
```

The constructor returns the two views; the caller is the owner of the producer side. Less common in larger systems because it spreads ownership.

In practice, Style A wins for long-lived components; Style B is fine for short-lived helpers and tests.

### Lifetime contract via context

Pair directional channels with `context.Context`. The context owns the *lifetime*; the channel owns the *data flow*. The producer:

1. Sends until the consumer reads or the context is done.
2. Closes the channel on exit.

The consumer:

1. Reads until the channel is closed.
2. May abandon reading at any time (the producer will eventually unblock when ctx is done).

```go
func produce(ctx context.Context, out chan<- T) {
    defer close(out)
    for {
        v, ok := next()
        if !ok {
            return
        }
        select {
        case out <- v:
        case <-ctx.Done():
            return
        }
    }
}
```

This pattern is so common that it deserves a template. The directional `out chan<- T` makes the producer's role obvious; the `select` on `ctx.Done()` prevents the producer from leaking when the consumer disappears.

---

## Fan-Out, Fan-In, and Directional Glue

### Fan-out

Multiple goroutines reading from the same input channel:

```go
func fanOut(ctx context.Context, in <-chan Job, n int) []<-chan Result {
    outs := make([]chan Result, n)
    res  := make([]<-chan Result, n)
    for i := 0; i < n; i++ {
        outs[i] = make(chan Result)
        res[i]  = outs[i]
        go func(out chan<- Result) {
            defer close(out)
            for j := range in {
                select {
                case out <- process(j):
                case <-ctx.Done():
                    return
                }
            }
        }(outs[i])
    }
    return res
}
```

Each worker takes `chan<- Result` as a parameter. It cannot read from its own output. The returned slice is `[]<-chan Result`; callers cannot send back.

### Fan-in

Many input channels, one output:

```go
func fanIn[T any](ctx context.Context, ins ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(ins))
    for _, in := range ins {
        go func(in <-chan T) {
            defer wg.Done()
            for v := range in {
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
            }
        }(in)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

Variadic `ins ...<-chan T`: each one is read-only. The function reads from all of them, writes to a single bidirectional `out`, and returns the receive-only view.

### The standard pattern: fan-out then fan-in

```go
inputs := gen(ctx, 1, 2, 3, 4, 5, 6, 7, 8)
results := fanIn(ctx, fanOut(ctx, inputs, 4)...)
for r := range results {
    fmt.Println(r)
}
```

Eight inputs, four workers, one merged stream. Each function's signature tells the reader what it does.

---

## `select` with Directional Channels

`select` cases come in two flavours: send and receive. Direction restricts which case is legal for which channel.

| Case form | Requires |
|---|---|
| `case x := <-ch:` | `ch` must be `chan T` or `<-chan T` |
| `case <-ch:` | same as above |
| `case ch <- v:` | `ch` must be `chan T` or `chan<- T` |
| `default:` | any time |

If you try to write `case <-sendOnly:` or `case recvOnly <- v:`, the compiler refuses.

### Multiplexing directional channels

A common pattern: a consumer waits on multiple sources.

```go
func waitFirst(ctx context.Context, a, b <-chan int) (int, error) {
    select {
    case v := <-a:
        return v, nil
    case v := <-b:
        return v, nil
    case <-ctx.Done():
        return 0, ctx.Err()
    }
}
```

All three cases are receive cases on receive-only channels. Direction matches.

A producer that publishes to one of several outputs:

```go
func dispatch(ctx context.Context, msg Msg, out1, out2 chan<- Msg) error {
    select {
    case out1 <- msg:
    case out2 <- msg:
    case <-ctx.Done():
        return ctx.Err()
    }
    return nil
}
```

Two send cases on send-only channels. Direction matches.

### Mixing send and receive in one `select`

```go
select {
case v := <-in:
    fmt.Println("got", v)
case out <- next:
    fmt.Println("sent", next)
case <-ctx.Done():
    return
}
```

`in` is `<-chan T`, `out` is `chan<- T`. Both directions, one `select`. The compiler picks the type of each case from the channel's type.

---

## Conversions, Revisited

The conversion rules from junior level are:

```
chan T   -> chan<- T    (implicit, free)
chan T   -> <-chan T    (implicit, free)
chan<- T -> chan T      (NOT ALLOWED)
<-chan T -> chan T      (NOT ALLOWED)
chan<- T -> <-chan T    (NOT ALLOWED)
<-chan T -> chan<- T    (NOT ALLOWED)
```

At middle level, you encounter the rules in less obvious places:

### Slices and maps of channels

```go
var bis []chan int = make([]chan int, 3)
var sends []chan<- int = bis             // compile error
```

The implicit conversion does not extend to *slices of* channels. Each channel can convert individually, but the slice types are unrelated.

To get a `[]<-chan int` from a `[]chan int`, you must build it explicitly:

```go
outs := make([]<-chan int, len(bis))
for i, c := range bis {
    outs[i] = c
}
```

This is one of the small irritations of Go generics — for a fully generic version, you would write a helper.

### Channel-of-channel conversions

```go
var outer chan chan int      = make(chan chan int)
var sendOuter chan<- chan int = outer       // OK — outer direction widens
var recvOuter <-chan chan int = outer       // OK — outer direction widens
// element type chan int stays bidirectional
```

But:

```go
var bothInner chan chan int = make(chan chan int)
var sendInner chan <-chan int                  // chan of receive-only int channels
sendInner = bothInner                          // compile error: inner element types differ
```

The inner direction is part of the type identity; it does not auto-narrow.

### Type-switch and interfaces

You can store a directional channel in an `interface{}`:

```go
var i any = make(chan<- int, 0)
ch, ok := i.(chan<- int)
fmt.Println(ok)               // true
ch2, ok := i.(chan int)
fmt.Println(ok)               // false
_ = ch
_ = ch2
```

The assertion to `chan int` fails because the dynamic type is `chan<- int`. The interface stores the exact type; type assertion compares dynamic types, not assignability.

This catches occasional refactoring bugs: you store something in an `any` and later assert as the wrong direction.

### `reflect` and direction

```go
import "reflect"

c := make(chan int)
t := reflect.TypeOf(c)
fmt.Println(t.ChanDir())          // chan (== reflect.BothDir)
```

`ChanDir` returns `reflect.RecvDir`, `reflect.SendDir`, or `reflect.BothDir`. You can build a directional channel type via `reflect.ChanOf(reflect.SendDir, intType)`, but you cannot reflectively widen back. Full coverage in the professional file.

---

## Directional Channels in Struct Fields

Storing a channel in a struct is common. Direction shows up in the field type *and* in the methods that expose the channel to outside code.

### Strategy 1: Field is bidirectional, accessors narrow

```go
type Broker struct {
    msgs chan Message       // bidirectional internally
}

func (b *Broker) Publish(m Message) {
    b.msgs <- m
}

func (b *Broker) Subscribe() <-chan Message {
    return b.msgs           // implicit widening to <-chan
}
```

The most common pattern. The struct owns the channel; methods control access.

### Strategy 2: Field itself is directional

```go
type Worker struct {
    jobs <-chan Job         // worker only reads
}
```

This works when the field came from outside. The worker stores the receive-only view; it cannot send or close, even from inside its own methods. This is one step *stronger* than Strategy 1.

```go
func NewWorker(jobs <-chan Job) *Worker {
    return &Worker{jobs: jobs}
}
```

The caller chose to give the worker only the read side. The worker physically cannot misbehave.

### Strategy 3: Multiple fields with different directions, same channel

```go
type Pipe struct {
    in  chan<- T
    out <-chan T
}

func NewPipe(ch chan T) *Pipe {
    return &Pipe{in: ch, out: ch}
}
```

Both `p.in` and `p.out` reference the *same* channel. The struct exposes two narrowed views. Callers reach for `p.in` to send, `p.out` to receive. Useful in tests and adapter code.

### Strategy 4: Closeable abstraction

```go
type EventStream struct {
    events chan Event
    closer sync.Once
}

func (s *EventStream) Events() <-chan Event { return s.events }

func (s *EventStream) Close() {
    s.closer.Do(func() { close(s.events) })
}
```

`Events()` exposes receive-only. `Close()` is the single sanctioned close path, idempotent via `sync.Once`. External code cannot close the channel directly because `events` is unexported; `s.events` is bidirectional internally so `close` is legal there.

---

## Using Direction with Generics

Generics (Go 1.18+) work cleanly with directional channels. The two patterns you will write most:

### Pattern A: A generic fan-in

```go
func Merge[T any](ctx context.Context, ins ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(ins))
    for _, in := range ins {
        go func(in <-chan T) {
            defer wg.Done()
            for v := range in {
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
            }
        }(in)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

`T` is the element type. The directional types `<-chan T` and the internal `chan T` work the same as before. Calls look like `Merge(ctx, a, b, c)` where each is `<-chan T` or compatible.

### Pattern B: A generic stage with two type parameters

```go
func Map[A, B any](ctx context.Context, in <-chan A, f func(A) B) <-chan B {
    out := make(chan B)
    go func() {
        defer close(out)
        for v := range in {
            select {
            case out <- f(v):
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

The function is reusable across pipelines and types. Each call site:

```go
strs := Map(ctx, ints, strconv.Itoa)          // <-chan int -> <-chan string
upper := Map(ctx, strs, strings.ToUpper)      // <-chan string -> <-chan string
```

### What generics do *not* let you do

You cannot make a generic type parameter that abstracts over direction:

```go
// hypothetical, not legal
func Anything[C chan<- T | <-chan T | chan T](ch C) { ... }
```

There is no constraint syntax that admits "any direction." If you need that, you write three overloads or use reflection. In practice, you almost never need it — code is either a producer or a consumer.

---

## Refactor Playbooks

You inherit a package with `chan T` everywhere. How do you add direction without breaking callers?

### Playbook 1: Narrow returns first

A function with return type `chan T` can usually be narrowed to `<-chan T` without breaking callers, because callers were using it only one way anyway. Search for every call site and confirm they only read.

```go
// before
func Events() chan Event

// after
func Events() <-chan Event
```

If any caller writes to it, your refactor would break them. The grep proves it.

### Playbook 2: Narrow parameters next

Function parameters are trickier. A function `func f(ch chan T)` that only sends can become `func f(ch chan<- T)`. Callers were passing `chan T`; the implicit conversion at the call site keeps them compiling.

If any callers were passing `<-chan T` to that parameter (they should not have been — would have been a compile error), nothing changes.

### Playbook 3: Internal field narrowing

A struct field `events chan Event` accessed via methods can stay bidirectional. Narrow the *methods'* return types and parameters; the field itself does not need to change.

### Playbook 4: Eliminate gratuitous bidirection

In long bodies, look for variables that *only* send or *only* receive. Narrow them locally:

```go
ch := make(chan int)
go func() {
    var out chan<- int = ch   // explicit narrowing for the producer goroutine
    defer close(out)
    for i := 0; i < 10; i++ {
        out <- i
    }
}()
```

This is mostly cosmetic, but it helps reviewers and catches future bugs where someone adds a read to the producer goroutine by mistake.

### Playbook 5: The two-step migration

For a public API change like `func Foo() chan T → func Foo() <-chan T`:

1. **Step 1.** Add a new function `Foo2() <-chan T` that returns the narrowed view. Deprecate `Foo`.
2. **Step 2.** After consumers migrate, remove `Foo` and rename `Foo2` to `Foo`.

This is the standard Go API migration recipe, applicable to direction changes too.

---

## Testing With Directional Channels

### Fakes for producers and consumers

A test for a consumer needs a producer source. The cleanest way is to hand the consumer a `<-chan T` that the test fills:

```go
func TestConsumer(t *testing.T) {
    src := make(chan int, 3)
    src <- 1
    src <- 2
    src <- 3
    close(src)
    consume(src)                  // src widens to <-chan int automatically
}
```

For a producer, the test provides a destination it owns:

```go
func TestProducer(t *testing.T) {
    dst := make(chan int, 10)
    produce(dst)                  // dst widens to chan<- int
    close(dst)
    var got []int
    for v := range dst {
        got = append(got, v)
    }
    // assert on got
}
```

The implicit conversion makes tests natural: tests own bidirectional channels (because they need to do both), and the functions under test see narrowed views.

### Testing with `select` and timeouts

Always wrap channel reads in tests with a `select` and a `time.After`:

```go
select {
case v := <-out:
    if v != expected {
        t.Errorf("got %v, want %v", v, expected)
    }
case <-time.After(time.Second):
    t.Fatal("timeout waiting for value")
}
```

A test that blocks forever is worse than a test that fails — CI hangs. The directional view does not change the `select` rules.

### Race detector

Run with `-race`:

```bash
go test -race ./...
```

The race detector instruments channel operations and reports races. Directional types do not change race behaviour; the underlying channel is the same.

---

## Performance Notes

The performance impact of channel direction is zero. The compiler generates the same calls to `runtime.chansend1` and `runtime.chanrecv1` regardless of which directional view you used. The relevant cost is the channel operation itself, not the direction.

Microbenchmark sketch:

```go
func BenchmarkSendBidi(b *testing.B) {
    ch := make(chan int, 1)
    for i := 0; i < b.N; i++ {
        ch <- i
        <-ch
    }
}

func BenchmarkSendDirected(b *testing.B) {
    ch := make(chan int, 1)
    s, r := chan<- int(ch), <-chan int(ch)         // illegal — see below
    _ = s; _ = r
    // ...
}
```

The explicit-conversion form is illegal as written above (Go syntax does not allow it that way — you would use an assignment). The point: you cannot construct a meaningful performance difference. Whatever direction is, it does not show up at run time.

### One real cost: extra channel literal in nested types

`chan<- <-chan T` is a real type. The compiler maintains type descriptors for each unique channel type. Heavy use of nested directional types creates more type metadata. In practice this is well under a kilobyte per program; ignore it.

---

## Self-Assessment

- [ ] I narrow channel types at every function and method boundary by default.
- [ ] I never give a consumer the ability to close.
- [ ] I write pipeline stages with the `func(ctx, <-chan In) <-chan Out` signature without thinking.
- [ ] I know that a `[]chan T` does not implicitly convert to `[]<-chan T`.
- [ ] I can pair directional channels with `context.Context` for cancellation.
- [ ] I can refactor a `chan T`-heavy package to narrow directions without breaking callers.
- [ ] I write generic helpers like `Merge` and `Map` that use directional types correctly.
- [ ] I use `select` cases on directional channels confidently — send only on send-able, receive only on receive-able.
- [ ] I store channels in struct fields with the narrowest type appropriate to the field's role.
- [ ] I know direction has zero runtime cost and is a pure design tool.

---

## Summary

Middle-level mastery of channel direction is about **API design**, not syntax. You stop asking "is this `chan` or `<-chan`?" and start asking "what is this function's role?" The signature becomes the contract: producer, consumer, mediator, sink. Each role gets the narrowest type that makes its job possible.

Direction shines in pipelines, where every stage returns `<-chan T` and the build refuses bad rewires. It shines in struct APIs, where `Events() <-chan Event` and `Publish(...)` keep external code in one role. It pairs naturally with `context.Context` and `sync.WaitGroup`. Generics keep the patterns reusable across types.

The conversion rules — widen, never narrow, never cross — are not a limitation but a guarantee. The type system tells you, at compile time, who has the authority to send, receive, and close. Use it. Senior-level concerns (architectural boundaries, plug-in safety, cross-module contracts) build on the same foundation.

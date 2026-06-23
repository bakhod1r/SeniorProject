# Channel Direction — Hands-on Tasks

> Exercises from easy to hard. Each task states the goal, what success looks like, and a hint. Solutions or sketches are at the end.

---

## Easy

### Task 1 — Print the three syntaxes

Write a program that creates a bidirectional channel, assigns it to a `chan<- int` variable, and assigns it to a `<-chan int` variable. Send a value via the send-only variable, then receive via the receive-only variable. Print the value.

```go
package main

import "fmt"

func main() {
    bi := make(chan int, 1)
    var s chan<- int = bi
    var r <-chan int = bi
    s <- 42
    fmt.Println(<-r)
}
```

**Goal.** Internalise the three forms and confirm they share underlying state.

---

### Task 2 — Make the compiler refuse illegal operations

Write three short functions:

1. One that takes `chan<- int` and tries to receive.
2. One that takes `<-chan int` and tries to send.
3. One that takes `<-chan int` and tries to close.

Compile each one. Record the error messages.

**Goal.** Get familiar with the compiler errors so you recognise them in real code.

---

### Task 3 — Producer/consumer with explicit directions

Implement a producer and a consumer with narrowed signatures:

```go
func produce(out chan<- int)
func consume(in <-chan int)
```

The producer sends 1..5 and closes the channel. The consumer ranges over the channel and prints each value. Spawn them as goroutines and wait with a `WaitGroup`.

**Goal.** Practice the canonical producer/consumer pattern.

---

### Task 4 — Three-stage pipeline

Implement three stages connected by channels:

```go
func gen(nums ...int) <-chan int
func square(in <-chan int) <-chan int
func print(in <-chan int)
```

`gen` emits `nums`, `square` doubles them (actually squares: `v*v`), `print` prints. Use the standard pattern: `defer close(out)` inside each producing stage.

Verify by running `gen(1, 2, 3, 4)` through `square` and printing.

Expected output:
```
1
4
9
16
```

**Goal.** Build the canonical pipeline pattern from scratch.

---

### Task 5 — A receive-only field

Define a struct:

```go
type Counter struct {
    out chan int
}
```

Add a method `func (c *Counter) Out() <-chan int`. Verify external code cannot send into `c.Out()` or close it (try and observe the compile error).

**Goal.** Narrow through method return types.

---

### Task 6 — Recognise widening direction

Without running the code, predict which lines compile:

```go
bi := make(chan string)
var s chan<- string = bi
var r <-chan string = bi
var s2 chan<- string = r       // A
var b chan string = r          // B
var s3 chan<- string = s       // C
var r2 <-chan string = s       // D
```

**Goal.** Cement the assignability rules.

(Hint: only bidirectional widens; once directional, never goes anywhere else.)

---

### Task 7 — `select` with directional channels

Write a function:

```go
func dispatch(ctx context.Context, msg string, a, b chan<- string) error
```

It tries to send `msg` to `a` or `b`, whichever is ready first. If `ctx.Done()`, returns `ctx.Err()`.

Then write a corresponding receiver:

```go
func consume(ctx context.Context, a, b <-chan string)
```

Receives from whichever channel produces first. Cancel after 100 ms; the goroutines should exit cleanly.

**Goal.** Practice `select` cases with directional types.

---

### Task 8 — Discover what `make` produces

Try compiling each line:

```go
ch1 := make(chan int)
ch2 := make(chan<- int)        // does this work?
ch3 := make(<-chan int)        // does this work?
```

Record the result and explain.

**Goal.** Confirm that `make` always produces bidirectional channels.

---

## Medium

### Task 9 — Implement `Map` as a generic pipeline stage

```go
func Map[A, B any](ctx context.Context, in <-chan A, f func(A) B) <-chan B
```

Reads from `in`, applies `f`, sends to `out`. Closes `out` on exit. Respects `ctx`.

Test with:

```go
nums := gen(ctx, 1, 2, 3, 4)
strs := Map(ctx, nums, strconv.Itoa)
for s := range strs {
    fmt.Println(s)
}
```

Expected: `1 2 3 4` printed as strings.

**Goal.** Combine direction with generics for reusable stages.

---

### Task 10 — Fan-out worker pool

Write:

```go
func fanOut(ctx context.Context, in <-chan Job, n int) []<-chan Result
```

It spawns `n` workers reading from `in`. Each worker has its own output channel. Returns the slice of receive-only outputs.

Pair with `fanIn`:

```go
func fanIn(ctx context.Context, ins ...<-chan Result) <-chan Result
```

Combines them into one receive-only stream.

Test with 4 workers processing 10 jobs.

**Goal.** Build the fan-out/fan-in idiom with strict direction.

---

### Task 11 — Refactor a function from `chan T` to directional types

You have this function:

```go
func process(ch chan int) {
    for v := range ch {
        if v > 0 {
            ch <- v * 2   // BUG: sending while ranging
        }
    }
}
```

It accidentally sends back into the channel it is reading from. Identify the bug. Then propose a new signature using directional channels that would have prevented the bug at compile time.

**Goal.** See how direction prevents accidental self-write bugs.

---

### Task 12 — Subscription with unsubscribe

Implement a hub:

```go
type Hub struct { ... }
func New() *Hub
func (h *Hub) Subscribe() (<-chan Event, func())  // channel + unsubscribe closure
func (h *Hub) Publish(e Event)
```

Subscribers get a receive-only channel; the closure is the only way to unsubscribe. The hub holds the bidirectional channels and closes them on unsubscribe.

Test with 3 subscribers, publish 5 events, unsubscribe one, publish 5 more.

**Goal.** Practice ownership of channel lifetime with direction.

---

### Task 13 — Reject illegal operations on directional struct fields

Build:

```go
type Logger struct {
    sink chan<- string
}

func (l *Logger) Log(msg string) { l.sink <- msg }
```

Try adding a method `func (l *Logger) Read() string { return <-l.sink }`. Confirm it fails to compile.

**Goal.** See how struct fields with directional types prevent misuse from inside the struct.

---

### Task 14 — Convert via `reflect`

Use the `reflect` package to:

1. Create a bidirectional channel via `reflect.MakeChan`.
2. Convert it to a send-only channel via `Value.Convert`.
3. Send a value via the send-only `Value`.
4. Try to convert the send-only value back to bidirectional — catch the panic and print the message.

```go
import "reflect"

t := reflect.ChanOf(reflect.BothDir, reflect.TypeOf(0))
bi := reflect.MakeChan(t, 1)
s := bi.Convert(reflect.ChanOf(reflect.SendDir, reflect.TypeOf(0)))
s.Send(reflect.ValueOf(42))
defer func() {
    if r := recover(); r != nil {
        fmt.Println("panic:", r)
    }
}()
_ = s.Convert(t)   // panics
```

**Goal.** Confirm `reflect` enforces the same direction rules.

---

### Task 15 — Compare types

Write a program that creates `chan int` and `chan<- int` reflect types and compares them:

```go
bi := reflect.TypeOf(make(chan int))
send := reflect.ChanOf(reflect.SendDir, reflect.TypeOf(0))
fmt.Println(bi == send)             // false
fmt.Println(bi.ChanDir())            // chan
fmt.Println(send.ChanDir())          // chan<-
fmt.Println(bi.Elem() == send.Elem()) // true — both int
```

**Goal.** See how types carry direction in reflect.

---

### Task 16 — Pipeline with cancellation

Build a 3-stage pipeline that uses `context.Context`:

```go
func gen(ctx context.Context, in []int) <-chan int
func square(ctx context.Context, in <-chan int) <-chan int
func write(ctx context.Context, in <-chan int) error
```

Start the pipeline, then cancel the context after 50 ms. Confirm all goroutines exit cleanly (no leak). Use `runtime.NumGoroutine` to verify.

**Goal.** Integrate direction with cancellation.

---

### Task 17 — Detect the wrong-end close

A producer holding `chan<- T` *can* close (legal). A consumer holding `<-chan T` *cannot* close (compile error). Write two functions:

```go
func badConsumer(in <-chan int) { close(in) }   // should fail
func goodProducer(out chan<- int) { close(out) } // should compile
```

Confirm the compile error for the first.

**Goal.** See the central asymmetry directly.

---

## Hard

### Task 18 — Generic pipeline framework

Build a small framework:

```go
type Stage[A, B any] func(ctx context.Context, in <-chan A) <-chan B

func Compose[A, B, C any](s1 Stage[A, B], s2 Stage[B, C]) Stage[A, C] {
    return func(ctx context.Context, in <-chan A) <-chan C {
        return s2(ctx, s1(ctx, in))
    }
}

// Provide concrete stages:
func MapStage[A, B any](f func(A) B) Stage[A, B] { ... }
func FilterStage[T any](p func(T) bool) Stage[T, T] { ... }
```

Use it to build a 4-stage pipeline: gen → map → filter → write. Each stage strictly directional.

**Goal.** Composable pipeline stages with type-safe direction.

---

### Task 19 — Refactor a real legacy package

Pick a small open-source Go project (or your own) that uses `chan T` in function signatures. Audit:

1. Grep for `chan ` (space matters) in `.go` files.
2. List each occurrence and classify as send-only, receive-only, or genuinely bidirectional.
3. Refactor 3–5 functions to use narrowed types.
4. Run `go build ./...` and `go test ./...` to confirm no regressions.

**Goal.** Real-world refactor practice.

---

### Task 20 — Replay simulation

Build a "replay" tool that records every send on a `chan<- T` and lets you re-emit them. The interface:

```go
type Recorder[T any] struct{ ... }
func NewRecorder[T any](size int) *Recorder[T]
func (r *Recorder[T]) Capture() chan<- T          // send-only side
func (r *Recorder[T]) Replay(ctx context.Context) <-chan T  // receive-only side
```

The internal goroutine reads from the capture channel into a buffer, then later replays them via the replay channel.

**Goal.** Apply direction to an asymmetric resource (a recording).

---

### Task 21 — Implement broadcast hub with bounded subscribers

```go
type Hub[T any] struct{ ... }
func New[T any]() *Hub[T]
func (h *Hub[T]) Publish() chan<- T
func (h *Hub[T]) Subscribe(buffer int) (<-chan T, func())
func (h *Hub[T]) Close()
```

The hub fans out each published message to all current subscribers. If a subscriber's buffer is full, drop the message for that subscriber (do not block the publisher). Subscribers can unsubscribe.

Stress test: 1 publisher, 100 subscribers, 10 000 messages. Verify no panics, no leaks, no blocked publishes.

**Goal.** Production-quality broadcast with strict direction.

---

### Task 22 — Static analysis: find wrong-direction parameters

Write a small tool (using `go/ast` and `go/types`) that scans a package and reports:

- Functions that return `chan T` but never write to or close it (candidates for `<-chan T`).
- Functions that take `chan T` but never read from it (candidates for `chan<- T`).

This is a real-world linting task.

```go
// Sketch with golang.org/x/tools/go/packages
pkgs, _ := packages.Load(&packages.Config{Mode: packages.LoadAllSyntax}, "./...")
for _, p := range pkgs {
    // visit each function; check uses of each chan-typed parameter
}
```

**Goal.** Engineer the type-narrowing decision into automation.

---

### Task 23 — Direction-aware mock generator

Write a mock generator for an interface:

```go
type Source interface {
    Events(ctx context.Context) <-chan Event
}
```

Generate a mock that lets a test push events via a `chan<- Event` controlled by the test. The mock's `Events` method narrows the channel to `<-chan Event` for the system under test.

```go
type MockSource struct {
    out chan Event
}

func (m *MockSource) Push(e Event)               { m.out <- e }
func (m *MockSource) Events(ctx context.Context) <-chan Event { return m.out }
```

Use it in a test that pushes 3 events and confirms the consumer receives all 3.

**Goal.** Apply direction in the test layer.

---

### Task 24 — Channel-of-channel pub/sub registration

Implement a registration channel:

```go
type Registration[T any] struct {
    addSub chan chan<- T          // bi: receive add requests
    sub    <-chan T               // narrow view for external API
}
```

Subscribers send a `chan<- T` they own into `addSub`; the hub keeps it and uses it for future publishes. The hub never reads from those channels (only writes).

**Goal.** Get comfortable with nested directional types.

---

### Task 25 — Direction in a generic type set (research)

Investigate whether you can write a generic type set that admits `chan T`, `<-chan T`, and `chan<- T`:

```go
type AnyChan[T any] interface {
    chan T | <-chan T | chan<- T
}
```

Try writing a function that uses this. Document what works and what does not (you should find that you cannot send or receive inside the function because the type set includes a type that forbids each operation).

**Goal.** Understand the limits of generic abstraction over direction.

---

## Solution Sketches

### Task 1

The program produces `42`. Both `s` and `r` reference `bi`'s underlying channel.

### Task 2

The errors:

```
./prog.go:5:21: invalid operation: cannot send to receive-only channel ch (variable of type <-chan int)
./prog.go:8:23: invalid operation: cannot receive from send-only channel ch (variable of type chan<- int)
./prog.go:11:21: invalid operation: cannot close receive-only channel ch (variable of type <-chan int)
```

### Task 3

```go
package main

import (
    "fmt"
    "sync"
)

func produce(out chan<- int) {
    defer close(out)
    for i := 1; i <= 5; i++ {
        out <- i
    }
}

func consume(in <-chan int) {
    for v := range in {
        fmt.Println(v)
    }
}

func main() {
    ch := make(chan int)
    var wg sync.WaitGroup
    wg.Add(1)
    go func() { defer wg.Done(); consume(ch) }()
    produce(ch)
    wg.Wait()
}
```

### Task 6

- A: error (cannot convert `<-chan` to `chan<-`).
- B: error (cannot widen `<-chan` to bidirectional).
- C: OK (same type).
- D: error (cannot convert `chan<-` to `<-chan`).

### Task 8

`ch1` works (`chan int`). `ch2` and `ch3` are compile errors: `make` only accepts bidirectional channel types. The error reads something like `invalid argument: cannot make chan<- int; the type must be bidirectional`.

### Task 9

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

### Task 10 sketch

```go
func fanOut(ctx context.Context, in <-chan Job, n int) []<-chan Result {
    outs := make([]chan Result, n)
    result := make([]<-chan Result, n)
    for i := 0; i < n; i++ {
        outs[i] = make(chan Result)
        result[i] = outs[i]
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
    return result
}

func fanIn(ctx context.Context, ins ...<-chan Result) <-chan Result {
    out := make(chan Result)
    var wg sync.WaitGroup
    wg.Add(len(ins))
    for _, in := range ins {
        go func(in <-chan Result) {
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

### Task 11

The bug: `process` sends back into `ch` while ranging — this can deadlock if the channel is unbuffered and there is no other receiver, or it can cause an infinite loop. The fix:

```go
func process(in <-chan int, out chan<- int) {
    defer close(out)
    for v := range in {
        if v > 0 {
            out <- v * 2
        }
    }
}
```

Now the function takes a separate `out` of type `chan<- int`. The compiler enforces that `in` is read-only and `out` is write-only; the original bug is impossible.

### Task 12 sketch

```go
type Hub struct {
    subs map[chan Event]struct{}
    mu   sync.Mutex
}

func (h *Hub) Subscribe() (<-chan Event, func()) {
    c := make(chan Event, 16)
    h.mu.Lock(); h.subs[c] = struct{}{}; h.mu.Unlock()
    unsub := func() {
        h.mu.Lock()
        defer h.mu.Unlock()
        if _, ok := h.subs[c]; ok {
            delete(h.subs, c)
            close(c)
        }
    }
    return c, unsub
}

func (h *Hub) Publish(e Event) {
    h.mu.Lock()
    defer h.mu.Unlock()
    for c := range h.subs {
        select {
        case c <- e:
        default:    // drop if full
        }
    }
}
```

### Task 14

Convert succeeds in the widening direction (`bi → s`). Sending via `s` works. Converting `s` back to bidirectional panics with a message like:

```
panic: reflect.Value.Convert: value of type chan<- int cannot be converted to type chan int
```

### Task 17

`badConsumer` fails:

```
invalid operation: cannot close receive-only channel in (variable of type <-chan int)
```

`goodProducer` compiles. The directional types enforce who may close.

---

## Wrap-up

After working through these tasks you should be able to:

- Read and write the three channel-type syntaxes fluently.
- Build pipeline stages, fan-out/fan-in, and pub/sub with strict direction.
- Pair direction with `context.Context` for cancellation.
- Use generics to build reusable stages.
- Refactor real codebases by narrowing channel types.
- Reflect on channel types via the `reflect` package.

Next: [find-bug.md](find-bug.md) for bug hunts where direction is the missing safeguard.

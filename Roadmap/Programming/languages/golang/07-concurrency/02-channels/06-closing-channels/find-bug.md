# Closing Channels — Find the Bug

> Each section presents broken code. Read it carefully, predict the symptom, then read the explanation and fix. The bugs are real — every one has been found in production Go code.

---

## How to use this file

1. Read the snippet.
2. State the symptom: panic, deadlock, leak, wrong output, race?
3. Identify the root cause.
4. Sketch a fix.
5. Read the explanation and compare.

---

## Bug 1: classic forgotten close

```go
func numbers() <-chan int {
    ch := make(chan int)
    go func() {
        for i := 0; i < 10; i++ {
            ch <- i
        }
    }()
    return ch
}

func main() {
    for v := range numbers() {
        fmt.Println(v)
    }
}
```

**Symptom.** Prints 0..9, then deadlock: `fatal error: all goroutines are asleep`.

**Root cause.** The producer goroutine sends 10 values and exits without closing. The consumer's `for range` blocks waiting for the 11th value that will never arrive.

**Fix.**

```go
go func() {
    defer close(ch)
    for i := 0; i < 10; i++ {
        ch <- i
    }
}()
```

The `defer close(ch)` runs on goroutine exit, regardless of how exit happens.

---

## Bug 2: closing in the wrong goroutine

```go
func numbers() <-chan int {
    ch := make(chan int)
    go func() {
        for i := 0; i < 10; i++ {
            ch <- i
        }
    }()
    close(ch) // outside the goroutine
    return ch
}
```

**Symptom.** Panic: `send on closed channel`.

**Root cause.** `close(ch)` runs immediately in the parent, before the goroutine has sent anything. The first send then panics. Even if it didn't, the consumer would see a closed channel immediately.

**Fix.** Move close inside the goroutine:

```go
go func() {
    defer close(ch)
    for i := 0; i < 10; i++ {
        ch <- i
    }
}()
```

---

## Bug 3: multi-sender, each closes

```go
func main() {
    ch := make(chan int, 100)
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            defer close(ch) // each sender closes
            for j := 0; j < 10; j++ {
                ch <- id*10 + j
            }
        }(i)
    }
    wg.Wait()
    for v := range ch {
        fmt.Println(v)
    }
}
```

**Symptom.** Panic: `close of closed channel`. Sometimes also `send on closed channel`.

**Root cause.** Five senders each call `close(ch)`. The first close succeeds; the second panics. If a sender is mid-loop when another closes, that send also panics.

**Fix.** Single closer pattern:

```go
go func() {
    wg.Wait()
    close(ch)
}()
```

Remove `defer close(ch)` from each sender. One synchronising closer.

---

## Bug 4: closing inside the receiver

```go
func main() {
    ch := make(chan int)
    go func() {
        for i := 0; i < 5; i++ {
            ch <- i
        }
    }()
    received := 0
    for v := range ch {
        fmt.Println(v)
        received++
        if received == 3 {
            close(ch) // receiver closes
        }
    }
}
```

**Symptom.** Panic: `send on closed channel` on the producer's next send.

**Root cause.** The receiver closes the channel while the producer is still sending. The next send panics.

**Fix.** Use a done channel to signal the producer to stop:

```go
ch := make(chan int)
done := make(chan struct{})
go func() {
    defer close(ch)
    for i := 0; i < 5; i++ {
        select {
        case <-done:
            return
        case ch <- i:
        }
    }
}()
received := 0
for v := range ch {
    fmt.Println(v)
    received++
    if received == 3 {
        close(done)
        // drain remaining
        for range ch {
        }
        break
    }
}
```

The receiver signals via `close(done)`; the producer observes and closes `ch` cleanly.

---

## Bug 5: double-close in defer chain

```go
func work(ch chan int) error {
    defer close(ch)
    if err := step1(); err != nil {
        close(ch) // panic on second defer
        return err
    }
    return step2()
}
```

**Symptom.** When `step1` errors, panic: `close of closed channel`.

**Root cause.** Two `close(ch)` calls: the explicit one in the if-branch, then the deferred one when `work` returns. Both run.

**Fix.** Use `defer close(ch)` once; remove the explicit close:

```go
func work(ch chan int) error {
    defer close(ch)
    if err := step1(); err != nil {
        return err
    }
    return step2()
}
```

Or guard with `sync.Once`:

```go
var once sync.Once
closeCh := func() { once.Do(func() { close(ch) }) }
defer closeCh()
if err := step1(); err != nil {
    closeCh()
    return err
}
```

(The defer-only version is cleaner.)

---

## Bug 6: nil-close after struct reset

```go
type Worker struct {
    ch chan int
}

func (w *Worker) Start() {
    w.ch = make(chan int)
    // ...
}

func (w *Worker) Stop() {
    close(w.ch) // panic if Start never called
}

func main() {
    w := &Worker{}
    w.Stop() // panic: close of nil channel
}
```

**Symptom.** Panic: `close of nil channel`.

**Root cause.** `w.ch` is the zero value (`nil`) because `Start` was not called. Closing a nil channel panics.

**Fix.** Check before closing:

```go
func (w *Worker) Stop() {
    if w.ch != nil {
        close(w.ch)
        w.ch = nil
    }
}
```

Or always initialise in the constructor:

```go
func NewWorker() *Worker {
    return &Worker{ch: make(chan int)}
}
```

---

## Bug 7: race between close and send

```go
func main() {
    ch := make(chan int)
    go func() {
        for i := 0; i < 100; i++ {
            ch <- i // may panic
        }
    }()
    go func() {
        time.Sleep(10 * time.Millisecond)
        close(ch)
    }()
    for v := range ch {
        _ = v
    }
}
```

**Symptom.** Sometimes panics: `send on closed channel`. Sometimes runs OK.

**Root cause.** The closer races with the sender. After `close`, the sender's next iteration panics.

**Fix.** Use a done channel for cancellation; close the data channel only after the sender exits.

```go
ch := make(chan int)
done := make(chan struct{})
var wg sync.WaitGroup
wg.Add(1)
go func() {
    defer wg.Done()
    defer close(ch)
    for i := 0; i < 100; i++ {
        select {
        case <-done:
            return
        case ch <- i:
        }
    }
}()
go func() {
    time.Sleep(10 * time.Millisecond)
    close(done)
}()
for v := range ch {
    _ = v
}
wg.Wait()
```

---

## Bug 8: close to signal error

```go
func work() (<-chan int, <-chan error) {
    values := make(chan int)
    errs := make(chan error)
    go func() {
        defer close(values)
        for i := 0; i < 10; i++ {
            if i == 5 {
                errs <- errors.New("boom")
                close(errs)
                return // signal end via not-sending more
            }
            values <- i
        }
    }()
    return values, errs
}

func main() {
    values, errs := work()
    for v := range values {
        fmt.Println(v)
    }
    for e := range errs {
        fmt.Println(e)
    }
}
```

**Symptom.** Deadlock or panic, depending on timing.

**Root cause.** Multiple bugs:

1. `errs` is unbuffered; the goroutine blocks on `errs <- err` because the main goroutine is reading `values`, not `errs`.
2. The error path also closes `errs`. If the main then ranges `errs`, it sees the closed channel and exits.
3. After receiving the error and breaking out, the values channel may not be drained.

**Fix.** Use a single channel with a `Result` struct, or buffer the error channel:

```go
type Result struct {
    V   int
    Err error
}

func work() <-chan Result {
    out := make(chan Result)
    go func() {
        defer close(out)
        for i := 0; i < 10; i++ {
            if i == 5 {
                out <- Result{Err: errors.New("boom")}
                return
            }
            out <- Result{V: i}
        }
    }()
    return out
}
```

---

## Bug 9: range on never-closed input

```go
func filter(in <-chan int, pred func(int) bool) <-chan int {
    out := make(chan int)
    go func() {
        for v := range in {
            if pred(v) {
                out <- v
            }
        }
        // forgot close(out)
    }()
    return out
}

func main() {
    in := make(chan int, 3)
    in <- 1
    in <- 2
    in <- 3
    close(in)
    for v := range filter(in, func(x int) bool { return x > 1 }) {
        fmt.Println(v)
    }
}
```

**Symptom.** Prints `2 3`, then deadlock.

**Root cause.** `filter`'s goroutine exits cleanly after its input closes, but `out` is never closed. The consumer's `for range out` blocks.

**Fix.** `defer close(out)`:

```go
go func() {
    defer close(out)
    for v := range in {
        if pred(v) {
            out <- v
        }
    }
}()
```

---

## Bug 10: send to closed in `select`

```go
func main() {
    ch := make(chan int)
    close(ch)
    select {
    case ch <- 1: // panics; selectable case
    default:
        fmt.Println("default")
    }
}
```

**Symptom.** Panic: `send on closed channel`.

**Root cause.** The send case on a closed channel is selectable (it doesn't block), so `select` picks it. The send then panics.

**Fix.** Don't send to a channel that might be closed. If unavoidable, structure differently — e.g., observe a done channel:

```go
select {
case <-done:
    return
case ch <- 1:
}
```

This works only if `ch` is open; if `ch` is closed but `done` is not, the panic recurs. The root fix is: don't have a code path that sends to a possibly-closed channel.

---

## Bug 11: goroutine leak with select on done

```go
func worker(done <-chan struct{}, jobs <-chan Job) {
    for {
        select {
        case j := <-jobs:
            process(j) // long, no cancellation check
        case <-done:
            return
        }
    }
}
```

**Symptom.** After `close(done)`, the worker may still be in `process(j)` for a long time. The done close has no effect during processing.

**Root cause.** `select` is checked once per loop iteration. While `process` runs, the worker is not in `select`. The done signal is not observed mid-process.

**Fix.** Pass `done` to `process`:

```go
func process(done <-chan struct{}, j Job) {
    for /* internal loop */ {
        select {
        case <-done:
            return
        default:
        }
        // do one step
    }
}
```

Or use `context.Context` consistently throughout.

---

## Bug 12: double `for range` on same channel

```go
func main() {
    ch := make(chan int)
    go func() {
        defer close(ch)
        for i := 0; i < 5; i++ {
            ch <- i
        }
    }()
    for v := range ch {
        fmt.Println("first:", v)
    }
    for v := range ch {
        fmt.Println("second:", v) // never executes
    }
}
```

**Symptom.** First loop prints 0..4; second loop runs zero times.

**Root cause.** After the first loop, the channel is closed and drained. The second `for range` on a closed-drained channel runs zero iterations (immediately exits).

**Fix.** This is usually a logic error: re-using a closed channel. Create a new channel or restructure.

---

## Bug 13: closing a channel returned by a library

```go
func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    done := ctx.Done()
    close(done) // compile error
}
```

**Symptom.** Compile error: `cannot close receive-only channel`.

**Root cause.** `ctx.Done()` returns `<-chan struct{}`; cannot close.

**Fix.** Cancel the context, not the channel:

```go
cancel() // closes ctx.Done() internally
```

---

## Bug 14: WaitGroup race with close

```go
func main() {
    ch := make(chan int)
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        go func(id int) {
            wg.Add(1) // wrong: inside goroutine
            defer wg.Done()
            ch <- id
        }(i)
    }
    go func() {
        wg.Wait()
        close(ch)
    }()
    for v := range ch {
        fmt.Println(v)
    }
}
```

**Symptom.** Sometimes deadlock. Sometimes close happens before all sends.

**Root cause.** `wg.Add(1)` is inside the goroutine. The closer goroutine may run `wg.Wait()` *before* any of the sender goroutines have reached `Add`. With counter at 0, `Wait` returns immediately; `close(ch)` runs; senders then send to a closed channel.

**Fix.** Move `wg.Add(1)` to the parent before `go`:

```go
for i := 0; i < 3; i++ {
    wg.Add(1)
    go func(id int) {
        defer wg.Done()
        ch <- id
    }(i)
}
```

---

## Bug 15: closing during pipeline cancellation, no drain

```go
func main() {
    ctx, cancel := context.WithCancel(context.Background())
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
    for i := 0; i < 5; i++ {
        <-out
    }
    cancel()
    // forgot to drain out
    time.Sleep(100 * time.Millisecond)
    fmt.Println("done")
}
```

**Symptom.** Goroutine leak (the producer is blocked on `out <- i`, but `out` has no reader since we stopped consuming).

**Root cause.** After `cancel()`, the producer's `select` has two ready cases: `ctx.Done()` and `out <- i` (if reader is parked — but no reader, so this case blocks). The producer picks `ctx.Done()` *only* if its case is selectable when select runs. If the send is in progress (rendezvous half-done), the select may not retry.

**Reality.** Actually, with an unbuffered channel and no reader, the send case is never ready, so the select picks `ctx.Done()`. The bug here is more subtle: if the buffer were non-empty *or* if the timing were different, you could see leaks.

**Best practice.** Always drain:

```go
cancel()
go func() {
    for range out {
    }
}()
```

A defensive drain ensures any in-flight send completes, allowing the producer to observe cancellation cleanly.

---

## Bug 16: closing channel held by struct after struct discarded

```go
type Pub struct {
    ch chan int
}

func main() {
    p := &Pub{ch: make(chan int)}
    sub := p.ch
    p = nil // p no longer references the channel
    runtime.GC()
    close(sub) // OK; sub still references the channel
    _, ok := <-sub
    fmt.Println(ok) // false
}
```

**Symptom.** No bug! Channels are reference types. As long as one variable references the channel, it lives. Closing it via that reference is legal.

**Lesson.** This is a *non-bug* but a good clarification. The channel does not "belong" to the struct in a way that destroying the struct destroys the channel.

---

## Bug 17: send on closed inside `recover`

```go
func main() {
    ch := make(chan int, 1)
    close(ch)
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
            ch <- 1 // panics inside recover
        }
    }()
    ch <- 1
}
```

**Symptom.** Recovered from first panic, then a new panic propagates: `send on closed channel`.

**Root cause.** The recover does not "unclose" the channel. The second send panics again; the second panic is not caught by another defer.

**Fix.** Don't retry on closed channel. Restructure the code to avoid sends after close.

---

## Bug 18: closing nil channel via direction conversion

```go
func close_it(c chan<- int) {
    close(c)
}

func main() {
    var ch chan int
    close_it(ch) // panic: close of nil channel
}
```

**Symptom.** Panic: `close of nil channel`.

**Root cause.** Conversion from `chan int` to `chan<- int` preserves the nil value. Closing a nil channel panics regardless of direction.

**Fix.** Initialise with `make` before passing.

---

## Bug 19: select with no default + done case

```go
func consume(done <-chan struct{}, work <-chan int) {
    for {
        select {
        case v := <-work:
            fmt.Println(v)
        case <-done:
            return
        }
    }
}

func main() {
    done := make(chan struct{})
    work := make(chan int)
    go consume(done, work)
    close(done)
    close(work) // unnecessary; consume already returned
    time.Sleep(10 * time.Millisecond)
}
```

**Symptom.** No panic here, but `close(work)` is unnecessary. Worse, if `consume` were modified to be a multi-sender on `work`, this close-after-done sequence could race.

**Lesson.** Closing channels that already have an exit path is redundant. Audit close calls; remove unnecessary ones.

---

## Bug 20: close inside loop body, not defer

```go
func process(ch chan int) {
    if shouldClose() {
        close(ch)
        return
    }
    for v := range source {
        ch <- v
    }
}
```

**Symptom.** When `shouldClose` is false, the function returns without closing. Consumers leak.

**Root cause.** No `defer close(ch)`. The close only runs on one code path.

**Fix.** `defer close(ch)` at the top:

```go
func process(ch chan int) {
    defer close(ch)
    if shouldClose() {
        return
    }
    for v := range source {
        ch <- v
    }
}
```

---

## Bug 21: close inside `select` default

```go
for {
    select {
    case v := <-in:
        process(v)
    default:
        close(out) // panics on next iteration's default
    }
}
```

**Symptom.** Infinite loop; close called every iteration when `in` is empty; panics after first close.

**Root cause.** `default` runs whenever no other case is ready. Inside `default`, the close fires; on the next iteration, default fires again and tries to close already-closed channel.

**Fix.** Restructure so close happens once, on a deliberate condition.

---

## Bug 22: closing a "results" channel before workers finish

```go
func main() {
    jobs := make(chan int, 10)
    results := make(chan int, 10)
    for i := 0; i < 3; i++ {
        go func() {
            for j := range jobs {
                results <- j * 2
            }
        }()
    }
    for i := 0; i < 5; i++ {
        jobs <- i
    }
    close(jobs)
    close(results) // wrong: workers still writing
    for r := range results {
        fmt.Println(r)
    }
}
```

**Symptom.** Sometimes panics: `send on closed channel` from a worker.

**Root cause.** `close(results)` happens immediately, while workers are still processing. Their `results <- j*2` after the close panics.

**Fix.** Use the synchronising-closer pattern:

```go
var wg sync.WaitGroup
for i := 0; i < 3; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for j := range jobs {
            results <- j * 2
        }
    }()
}
for i := 0; i < 5; i++ {
    jobs <- i
}
close(jobs)
go func() {
    wg.Wait()
    close(results)
}()
for r := range results {
    fmt.Println(r)
}
```

---

## Bug 23: orphaned goroutine after panic recovery

```go
func main() {
    ch := make(chan int)
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()
    go func() {
        defer close(ch)
        panic("oops")
    }()
    for v := range ch {
        fmt.Println(v)
    }
}
```

**Symptom.** Process terminates with "panic: oops" (not recovered).

**Root cause.** `recover` is in `main`'s defer. The panic happens in a *different* goroutine. Cross-goroutine recover doesn't work.

**Fix.** Recover *inside* the panicking goroutine:

```go
go func() {
    defer close(ch)
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()
    panic("oops")
}()
```

The deferred `close(ch)` still runs, so the consumer's `for range` exits cleanly.

---

## Bug 24: closing a channel as a flag

```go
type Service struct {
    ch chan int
}

func (s *Service) IsClosed() bool {
    select {
    case <-s.ch:
        return true
    default:
        return false
    }
}
```

**Symptom.** If the channel has a value, `IsClosed` consumes it and returns `true` falsely. Race condition.

**Root cause.** `<-s.ch` succeeds for *any* receive — including a real value. The "is closed" check is conflated with "is empty + closed."

**Fix.** Use comma-ok:

```go
func (s *Service) IsClosed() bool {
    select {
    case _, ok := <-s.ch:
        return !ok
    default:
        return false
    }
}
```

But this is still racy — the answer is stale. The right pattern is to track closed-ness explicitly in a separate flag protected by a mutex, or to never query.

---

## Bug 25: closing in cleanup function before goroutine exits

```go
func setup() (chan int, func()) {
    ch := make(chan int)
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        for v := range ch {
            process(v)
        }
    }()
    cleanup := func() {
        close(ch) // OK: signals worker to exit
        wg.Wait()
    }
    return ch, cleanup
}
```

**Symptom.** Works. But: if the caller closes `ch` themselves (forgetting `cleanup` does it), `cleanup` panics.

**Lesson.** Document the close contract clearly. If `cleanup` closes the channel, the caller MUST NOT close it. Better: use a done channel instead of closing the data channel, so the data channel close is unambiguous.

---

## Bug 26: pipeline that doesn't propagate cancellation

```go
func stage(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- v * 2 // no ctx check
        }
    }()
    return out
}
```

**Symptom.** Cancellation does not stop mid-stream. If `in` keeps sending and `out` reader has stopped, the goroutine blocks forever.

**Fix.** Add context:

```go
func stage(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            select {
            case <-ctx.Done():
                return
            case out <- v * 2:
            }
        }
    }()
    return out
}
```

---

## Summary of Bug Patterns

| Pattern | Frequency | Symptom |
|---|---|---|
| Forgot to close | very high | range deadlock, leak |
| Multi-sender, each closes | high | double-close panic |
| Receiver closes | medium | send-on-closed panic |
| Double-close in error paths | high | close-of-closed panic |
| Nil-close | low | nil-close panic |
| Race between close and send | medium | intermittent panic |
| Close to signal error | medium | ambiguous semantics |
| Send to closed in select | low | panic on selectable case |
| WaitGroup `Add` inside goroutine | medium | wait returns too early |
| Missing context in pipeline send | high | hang on cancellation |
| Cross-goroutine recover | medium | recovery missed, process dies |

The vast majority of bugs cluster around **ownership unclear** and **cancellation not propagated**. Discipline around `defer close` in producers, single-closer for multi-sender, and `select` on `ctx.Done()` in every send path prevents most of them.

Run every concurrent test with `go test -race`. The race detector catches the unsynchronised-close-vs-send class of bugs.

# Range Over Channels — Find the Bug

> Each section presents broken code. Read it, identify the bug, predict the symptom, and only then check the explanation. The bugs cluster around closing, breaking, capturing, and confusing `range` with `select`.

---

## Bug 1 — Forgotten close

```go
func main() {
    ch := make(chan int)
    go func() {
        for i := 0; i < 3; i++ {
            ch <- i
        }
    }()
    for v := range ch {
        fmt.Println(v)
    }
    fmt.Println("done")
}
```

**Symptom.** Prints `0`, `1`, `2`, then panics:

```
fatal error: all goroutines are asleep - deadlock!
```

**Bug.** The producer never calls `close(ch)`. After sending three values, it exits. The consumer's `range` reads three values, then blocks on the next receive. No goroutine can make progress; the runtime detects the deadlock and panics.

**Fix.** Add `defer close(ch)` at the top of the producer goroutine:

```go
go func() {
    defer close(ch)
    for i := 0; i < 3; i++ { ch <- i }
}()
```

This is *the* most common `range`-related bug. Make `defer close(ch)` muscle memory.

---

## Bug 2 — Double close

```go
ch := make(chan int)
go func() {
    for i := 0; i < 3; i++ { ch <- i }
    close(ch)
}()
go func() {
    for i := 3; i < 6; i++ { ch <- i }
    close(ch)
}()
for v := range ch { fmt.Println(v) }
```

**Symptom.**

```
panic: close of closed channel
```

The order in which goroutines run is non-deterministic, but eventually both will reach their `close` call. The second one panics.

**Bug.** Two producers, both think they own the close. Closing a closed channel panics.

**Fix.** Use a single closer goroutine:

```go
var wg sync.WaitGroup
wg.Add(2)
go func() {
    defer wg.Done()
    for i := 0; i < 3; i++ { ch <- i }
}()
go func() {
    defer wg.Done()
    for i := 3; i < 6; i++ { ch <- i }
}()
go func() { wg.Wait(); close(ch) }()
for v := range ch { fmt.Println(v) }
```

The closer goroutine waits for both producers, then closes exactly once.

---

## Bug 3 — Nil channel

```go
func main() {
    var ch chan int
    go func() {
        ch <- 1
        ch <- 2
        close(ch)
    }()
    for v := range ch {
        fmt.Println(v)
    }
}
```

**Symptom.** Either hangs silently or panics with deadlock (depending on whether the runtime can detect "all asleep").

**Bug.** `ch` is `nil` — never initialised with `make`. Sends and receives on `nil` block forever. The producer blocks on its first send; the consumer blocks on its first receive.

**Fix.** `ch := make(chan int)` instead of `var ch chan int`.

Static analysis tools (e.g., `staticcheck`) sometimes flag this; running with `-race` does not catch it because there is no race — only a deadlock.

---

## Bug 4 — Break leaks the producer

```go
func main() {
    ch := make(chan int)
    go func() {
        defer close(ch)
        for i := 0; ; i++ {
            ch <- i // blocks forever after consumer breaks
        }
    }()
    for v := range ch {
        if v >= 5 { break }
        fmt.Println(v)
    }
    fmt.Println("consumer done")
    time.Sleep(time.Second)
    fmt.Println("goroutines:", runtime.NumGoroutine())
}
```

**Symptom.** Prints `0` through `4`, then `consumer done`. Then `goroutines: 2` — the producer is still alive, blocked on send.

**Bug.** The consumer `break`s out of the loop. The producer continues sending; the next send (`ch <- 5` or `ch <- 6`) blocks forever. Producer leaks.

**Fix.** Make the producer respect a cancellation signal:

```go
ctx, cancel := context.WithCancel(context.Background())
go func() {
    defer close(ch)
    for i := 0; ; i++ {
        select {
        case <-ctx.Done(): return
        case ch <- i:
        }
    }
}()
for v := range ch {
    if v >= 5 { break }
    fmt.Println(v)
}
cancel()
```

Now `cancel()` tells the producer to exit; `defer close(ch)` runs; the program exits cleanly.

---

## Bug 5 — Captured loop variable in `range` body (pre-Go 1.22)

```go
for v := range ch {
    go func() {
        process(v) // shared v in Go < 1.22
    }()
}
```

**Symptom.** In Go 1.21 and earlier, all goroutines see the *same* `v` — usually the last value received. In Go 1.22+, each iteration's `v` is a fresh variable, so each goroutine sees its own.

**Bug.** Closure capture of the loop variable. The classic Go gotcha.

**Fix (works in every version).** Pass `v` as a parameter:

```go
for v := range ch {
    go func(v T) { process(v) }(v)
}
```

This is also a likely sign that you should not be spawning a goroutine per value at all — use a worker pool to bound concurrency.

---

## Bug 6 — Producer panic without close

```go
func producer(ch chan<- int) {
    for i := 0; ; i++ {
        ch <- i
        if i == 3 {
            panic("oops")
        }
    }
}

func main() {
    ch := make(chan int)
    go producer(ch)
    for v := range ch {
        fmt.Println(v)
    }
}
```

**Symptom.** Prints `0`, `1`, `2`, `3`, then panic kills the program *because the panic is in a goroutine*. Even if it were recovered, the consumer would hang because there is no `defer close(ch)`.

**Bug.** No `defer close(ch)`. A panic in the producer leaves the consumer hanging (assuming the panic is recovered).

**Fix.**

```go
func producer(ch chan<- int) {
    defer close(ch)
    defer func() {
        if r := recover(); r != nil {
            log.Printf("producer panic: %v", r)
        }
    }()
    // ...
}
```

`defer` runs in LIFO order. `recover` runs first (caught the panic), then `close(ch)` (signals the consumer). The order matters.

---

## Bug 7 — Send on closed channel

```go
ch := make(chan int)
go func() {
    for i := 0; i < 5; i++ { ch <- i }
}()
close(ch)             // BUG: closing while producer may still send
for v := range ch {
    fmt.Println(v)
}
```

**Symptom.**

```
panic: send on closed channel
```

The producer's next send happens on a closed channel and panics.

**Bug.** Closing the channel from outside the producer, while the producer is still active.

**Fix.** Let the producer close, with `defer close(ch)`. Never close from a goroutine that does not own the sending side.

---

## Bug 8 — `range` over a channel that may be reassigned

```go
var ch = make(chan int)
go func() {
    defer close(ch)
    for i := 0; i < 3; i++ { ch <- i }
}()
go func() {
    time.Sleep(100 * time.Millisecond)
    ch = make(chan int) // BUG: reassigning the variable
    close(ch)
}()
for v := range ch {
    fmt.Println(v)
}
```

**Symptom.** Unpredictable. The `range` is over the *initial* channel value (evaluated once). The reassignment of `ch` is invisible to `range`. Worse: the second goroutine could race with the first on the channel variable.

**Bug.** `range` evaluates its channel expression once at the start. Mutating the variable later is meaningless. Also, the variable assignment is a data race (no synchronisation).

**Fix.** Do not reassign channels. They are values; pass them around explicitly. If you need to switch channels, change the design (e.g., use `select` or a wrapper struct).

---

## Bug 9 — `range` inside `select` (impossible, but tried)

```go
select {
case for v := range ch {  // syntax error
    process(v)
}:
}
```

**Symptom.** Compile error: `syntax error: unexpected for, expecting expression`.

**Bug.** `range` is a *loop* form, not an expression; it cannot appear as a `select` case. The mental model "`range` is just shorthand for receive" sometimes misleads people into trying this.

**Fix.** Use `select` with two-value receive:

```go
for {
    select {
    case v, ok := <-ch:
        if !ok { return }
        process(v)
    case <-ctx.Done(): return
    }
}
```

---

## Bug 10 — Closing the consumer's channel

```go
func consume(in <-chan int) {
    for v := range in {
        process(v)
    }
    close(in) // BUG: compile error
}
```

**Symptom.** Compile error: `cannot close receive-only channel`.

**Bug.** Receive-only channels (`<-chan T`) cannot be closed. The compiler enforces the "sender owns close" rule via the type system.

**Fix.** Remove the `close`. The consumer never closes. If you wrote this and it compiled, the channel is `chan T` (bidirectional) — fix the function signature to `<-chan T`.

---

## Bug 11 — Buffered channel with one consumer break

```go
ch := make(chan int, 5)
for i := 0; i < 5; i++ { ch <- i }
close(ch)
for v := range ch {
    if v == 2 { break }
    fmt.Println(v)
}
for v := range ch {
    fmt.Println(v)
}
```

**Symptom.** First loop prints `0`, `1`, breaks on `2`. Second loop prints `3`, `4` and exits.

**Bug?** This is not actually a bug — the second `range` over the closed-but-not-drained channel reads the remaining values. It is a *surprise*, not a bug, but if the author thought the first `range` consumed everything, they would be wrong.

**Lesson.** A `range` does not drain on `break`. It abandons the channel mid-stream.

---

## Bug 12 — Range without producer

```go
ch := make(chan int)
go func() {
    time.Sleep(time.Second)
    // ... forgot to send anything
    // ... forgot to close
}()
for v := range ch {
    fmt.Println(v)
}
```

**Symptom.**

```
fatal error: all goroutines are asleep - deadlock!
```

**Bug.** The "producer" goroutine sleeps and exits without sending or closing. The consumer's `range` blocks on the first receive forever.

**Fix.** Either send values or close, depending on what was intended. If the goroutine should send nothing and close cleanly, `defer close(ch)`.

---

## Bug 13 — Fan-in with each forwarder closing

```go
out := make(chan int)
for _, src := range sources {
    go func(src <-chan int) {
        for v := range src { out <- v }
        close(out) // BUG: all forwarders try to close
    }(src)
}
for v := range out { fmt.Println(v) }
```

**Symptom.** First forwarder to close succeeds. Subsequent ones panic "close of closed channel". Forwarders that are still sending to `out` panic "send on closed channel".

**Bug.** Each forwarder thinks it should close `out`. Only one closer can succeed; the rest crash.

**Fix.** One closer goroutine, with `WaitGroup`:

```go
out := make(chan int)
var wg sync.WaitGroup
for _, src := range sources {
    wg.Add(1)
    go func(src <-chan int) {
        defer wg.Done()
        for v := range src { out <- v }
    }(src)
}
go func() { wg.Wait(); close(out) }()
for v := range out { fmt.Println(v) }
```

---

## Bug 14 — Pipeline stage forgets to close

```go
func double(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        for v := range in {
            out <- v * 2
        }
        // BUG: forgot defer close(out)
    }()
    return out
}

func main() {
    in := make(chan int, 3)
    in <- 1; in <- 2; in <- 3
    close(in)
    for v := range double(in) { fmt.Println(v) }
}
```

**Symptom.** Prints `2`, `4`, `6`, then deadlocks: `fatal error: all goroutines are asleep`.

**Bug.** `double` does not close `out`. When `in` closes, the goroutine's `range` exits and the goroutine returns — but `out` is left open. The main `range` blocks forever.

**Fix.** `defer close(out)` at the top of the goroutine:

```go
go func() {
    defer close(out)
    for v := range in { out <- v * 2 }
}()
```

This is the canonical pipeline-stage skeleton. Every stage looks like this.

---

## Bug 15 — Range and `defer` per iteration

```go
for v := range files {
    f, _ := os.Open(v)
    defer f.Close()  // BUG: closes only when function returns
    process(f)
}
```

**Symptom.** File descriptors accumulate; eventually the program runs out of file descriptors and `Open` fails.

**Bug.** `defer` runs at function return, not at the end of each iteration. With thousands of files, thousands of `Close` calls are deferred but not executed.

**Fix.** Move the work into a function so the `defer` is per-iteration:

```go
for v := range files {
    func(path string) {
        f, _ := os.Open(path)
        defer f.Close()
        process(f)
    }(v)
}
```

Or close manually inside the loop.

---

## Bug 16 — Range with unbuffered channel and slow consumer

```go
ch := make(chan int)
go func() {
    defer close(ch)
    for i := 0; i < 1_000_000; i++ {
        ch <- i // each send blocks until consumer is ready
    }
}()
for v := range ch {
    time.Sleep(time.Millisecond) // slow consumer
    use(v)
}
```

**Symptom.** Runs at ~1000 values/second — bounded by `time.Sleep`. Producer spends almost all its time parked.

**Bug?** Not a bug per se; this is correct backpressure. But if the author expected high throughput, they need either:

- A buffered channel (small win — just shifts the queue).
- More consumers (worker pool).
- Faster consumer logic (often the real fix).

**Lesson.** Unbuffered + slow consumer = throughput limited by consumer. Buffering only helps with burstiness, not with steady-state throughput.

---

## Bug 17 — Goroutine spawned in `range` body

```go
for v := range ch {
    go func(v int) {
        process(v) // may take seconds
    }(v)
}
```

**Symptom.** If the producer is fast, you spawn thousands or millions of goroutines. Memory bloats; the scheduler thrashes; eventually OOM.

**Bug.** Unbounded goroutine creation. Consuming `range` should *not* delegate the entire body to a new goroutine without bounds.

**Fix.** Worker pool:

```go
const N = 8
jobs := make(chan int, 100)
var wg sync.WaitGroup
for i := 0; i < N; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for v := range jobs { process(v) }
    }()
}
for v := range ch { jobs <- v }
close(jobs)
wg.Wait()
```

Or use `errgroup.Group.SetLimit(N)` for a bounded `g.Go`.

---

## Bug 18 — Reading from a closed channel inside a closure that escapes

```go
func tail(ch chan int) func() int {
    return func() int {
        for v := range ch {
            return v
        }
        return -1
    }
}
```

**Symptom.** The first call to the returned function receives one value (good) or returns `-1` if the channel is closed (also fine). But callers may not realise the channel is *consumed* by this function. A subsequent call may return `-1` or block.

**Bug?** Subtle semantics rather than a hard bug. The escape of channel access through a closure makes ownership opaque.

**Lesson.** Avoid escaping channel access through closures. Keep the producer/consumer roles explicit in the call stack.

---

## Bug 19 — Race between close and range start

```go
ch := make(chan int)
go func() {
    ch <- 1
    close(ch)
}()
runtime.Gosched()
runtime.Gosched()
// race window: ch may or may not be closed before range starts
for v := range ch {
    fmt.Println(v)
}
```

**Symptom.** Usually fine, but the program is *non-deterministic* about whether the producer has finished sending or closed before the consumer starts. In this small example, the consumer will receive `1` either way and then see the channel closed and exit.

**Bug?** No actual bug — channels handle this correctly. But the `runtime.Gosched()` calls suggest the author was trying to "wait" for the producer, which is wrong. The `range` itself waits.

**Lesson.** Do not sprinkle `Gosched` or `time.Sleep` "to give the producer a chance to start." `range` will wait.

---

## Bug 20 — Producer closes too early

```go
ch := make(chan int, 3)
go func() {
    close(ch)         // BUG: close before sending
    for i := 0; i < 3; i++ {
        ch <- i       // panic: send on closed channel
    }
}()
for v := range ch { fmt.Println(v) }
```

**Symptom.**

```
panic: send on closed channel
```

**Bug.** `close` then `send`. Always close *after* sending all values.

**Fix.** Re-order, or use `defer close(ch)` to guarantee close happens after the function body:

```go
go func() {
    defer close(ch)
    for i := 0; i < 3; i++ { ch <- i }
}()
```

---

## Bug 21 — Cancelling consumer without cancelling producer

```go
ctx, cancel := context.WithCancel(context.Background())
ch := make(chan int)
go func() {
    defer close(ch)
    for i := 0; ; i++ { ch <- i } // no ctx check
}()

go func() {
    time.Sleep(time.Second)
    cancel()
}()

for {
    select {
    case v := <-ch:
        fmt.Println(v)
    case <-ctx.Done():
        return
    }
}
// consumer returns; producer keeps sending; producer blocks; leak
```

**Symptom.** Consumer returns after 1 second; producer keeps trying to send; blocks on the unbuffered channel; goroutine leaks. `runtime.NumGoroutine()` will show the producer still alive.

**Bug.** The producer does not respect `ctx`. Cancelling the consumer is not enough — the producer must also see the cancel.

**Fix.** Producer must check `ctx.Done()` on every send:

```go
go func() {
    defer close(ch)
    for i := 0; ; i++ {
        select {
        case <-ctx.Done(): return
        case ch <- i:
        }
    }
}()
```

---

## Bug 22 — `range` over a partial iterator (Go 1.23)

```go
// Go 1.23 iterator wrapping a channel:
func chSeq[T any](ch <-chan T) iter.Seq[T] {
    return func(yield func(T) bool) {
        for v := range ch {
            if !yield(v) { return }
        }
    }
}

for v := range chSeq(producer()) {
    if condition(v) { break }
}
// Producer goroutine still running; ch never drained; leak.
```

**Symptom.** The iterator returns on `break` (good — it does not block forever). But the producer that fills `ch` keeps producing into a channel no one is reading. The producer goroutine leaks.

**Bug.** The iterator adapter does not propagate cancellation upstream. The upstream channel producer has no way to know the consumer stopped.

**Fix.** Adapter takes a context; producer respects it:

```go
func chSeq[T any](ctx context.Context, ch <-chan T) iter.Seq[T] { ... }
```

And the producer of `ch` is context-aware.

The lesson generalises: Go 1.23 iterators do not magically make channel-leak risk go away. They only fix the *consumer*-side break; the *producer* still needs explicit cancellation.

---

## Bug 23 — Range with side-effecting `len(ch)`

```go
for v := range ch {
    if len(ch) > 100 {
        log.Printf("backlog: %d", len(ch))
    }
    process(v)
}
```

**Symptom.** Works, but `len(ch)` may give inaccurate readings under concurrent sends. The value is a snapshot at the moment of the call and may have changed by the next instruction.

**Bug?** Misuse rather than a hard bug. `len` on a channel under concurrent producers is racy in the colloquial sense — useful for diagnostics, not for control flow decisions.

**Lesson.** Use `len(ch)` only for metrics/logging. Never branch on it.

---

## Bug 24 — `range` body itself blocks forever

```go
for v := range ch {
    <-time.After(time.Hour) // BUG: process is supposed to be fast
    process(v)
}
```

**Symptom.** Range receives one value, body waits an hour, range receives next value, etc. Throughput is one value per hour.

**Bug.** A latent bug where the body's wait was supposed to be a short timeout, but the value is wrong.

**Lesson.** A `range` body that blocks for a long time *is* the bottleneck. If the body is supposed to be fast and is not, the `range` is fine — the body is broken.

---

## Bug 25 — Range that "skips" the zero value

```go
for v := range ch {
    if v == 0 { continue } // assumption: 0 means "skip"
    process(v)
}
```

**Symptom.** Looks correct, but if the producer legitimately sends `0`, the consumer skips it silently. Bugs of this kind are hard to spot.

**Bug.** Using a sentinel value in-band. Better to use an explicit type (`struct { V int; Valid bool }`) or a separate signal.

**Lesson.** Do not overload the value's zero with control semantics. The channel's `close` is the only built-in signal; everything else should be explicit.

---

## Wrap-up

The recurring themes across these 25 bugs:

1. **Forgotten close.** Always `defer close(ch)` in the producer.
2. **Wrong closer.** Only the owner closes. Multi-producer needs a dedicated closer goroutine.
3. **`break` without cancellation.** The producer must be told too.
4. **Nil channels.** Always `make`. Never `var ch chan T`.
5. **Send after close, close after close.** Lifecycle discipline.
6. **Per-stage close in pipelines.** Every stage's goroutine has its own `defer close(out)`.
7. **Goroutine spawn explosion** inside the `range` body. Use a worker pool.
8. **Mixing `range` with sentinel values.** Use close, not in-band signals.

A code-review checklist for any `range ch`:

- [ ] Where is `close(ch)` called? Find it in the source.
- [ ] Is the closer the sole writer or a dedicated closer goroutine?
- [ ] What happens if the producer panics?
- [ ] What happens if the consumer needs to stop early?
- [ ] Is there a context-cancellation path?
- [ ] Are there tests asserting clean termination?

If you cannot answer all six, treat the code as suspicious.

Next: [optimize.md](optimize.md) for exercises focused on making `range`-based pipelines fast.

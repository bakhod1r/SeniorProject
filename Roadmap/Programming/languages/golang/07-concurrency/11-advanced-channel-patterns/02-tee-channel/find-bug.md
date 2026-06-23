# Tee-Channel — Find the Bug

Twelve programs. Each compiles and runs; each contains exactly one tee-related bug. Read carefully, identify the bug, then read the explanation.

---

## Bug 1: Two readers, no tee

```go
func main() {
    in := make(chan int)
    go func() {
        for i := 1; i <= 10; i++ { in <- i }
        close(in)
    }()

    go func() { for v := range in { fmt.Println("A:", v) } }()
    go func() { for v := range in { fmt.Println("B:", v) } }()

    time.Sleep(time.Second)
}
```

### What's wrong

The author wanted both A and B to print every value. They didn't use tee. Two goroutines reading the same channel *partition* the stream — each value goes to exactly one of them. A and B together print each value once, not twice. This is fan-out, not duplication.

**Fix.** Insert a tee:

```go
a, b := Tee(done, in)
go func() { for v := range a { fmt.Println("A:", v) } }()
go func() { for v := range b { fmt.Println("B:", v) } }()
```

---

## Bug 2: Sequential sends without nil trick

```go
func Tee(in <-chan int) (<-chan int, <-chan int) {
    out1 := make(chan int)
    out2 := make(chan int)
    go func() {
        defer close(out1)
        defer close(out2)
        for v := range in {
            for i := 0; i < 2; i++ {
                select {
                case out1 <- v:
                case out2 <- v:
                }
            }
        }
    }()
    return out1, out2
}
```

### What's wrong

The inner loop runs twice but each iteration is free to pick the same case. If `out1` is always ready first, both iterations send to `out1`, and `out2` never receives the value. Half (or more) of the values are missed by `out2`.

**Fix.** Nil out the channel after sending:

```go
a, b := out1, out2
for i := 0; i < 2; i++ {
    select {
    case a <- v: a = nil
    case b <- v: b = nil
    }
}
```

---

## Bug 3: Missing `defer close`

```go
func Tee[T any](done <-chan struct{}, in <-chan T) (<-chan T, <-chan T) {
    out1, out2 := make(chan T), make(chan T)
    go func() {
        for v := range in {
            a, b := out1, out2
            for i := 0; i < 2; i++ {
                select {
                case <-done:
                    return // outputs never close!
                case a <- v: a = nil
                case b <- v: b = nil
                }
            }
        }
        close(out1)
        close(out2)
    }()
    return out1, out2
}
```

### What's wrong

The `close` calls are at the end of the goroutine body, *after* the `for` loop. The `<-done` case returns directly, bypassing them. Consumers `range`ing on the outputs after cancellation block forever waiting for EOF — goroutine leak.

**Fix.** Use `defer close` so cancellation also closes:

```go
defer close(out1)
defer close(out2)
```

---

## Bug 4: Discarding one output

```go
in := producer()
a, _ := Tee(done, in)
go func() { for v := range a { useA(v) } }()
```

### What's wrong

The second output is bound to `_`. Nobody reads it. The tee goroutine's first send to `out2` blocks forever. Even if `out1`'s consumer drains promptly, the producer can never advance past the first value. The pipeline stalls; tee goroutine leaks.

**Fix.** If you don't need the second output, don't use tee. Use the input channel directly.

---

## Bug 5: Per-request tee

```go
func handle(w http.ResponseWriter, r *http.Request) {
    items := source(r)
    a, b := Tee(r.Context().Done(), items)
    go consumeA(a)
    consumeB(b)
}
```

### What's wrong

Each request spawns a new tee goroutine. Under load, you have thousands of tee goroutines, each handling its own short-lived stream. The overhead dominates. Worse: if any consumer for any request leaks (forgets to drain on early return), the tee goroutine for that request leaks too.

**Fix.** Build the tee topology once at startup. Per-request work flows through the same tee, with request-scoped identifiers in the payload.

(For genuinely per-request short streams of a few items, plain duplication via a slice is often simpler than tee.)

---

## Bug 6: Closing an output channel externally

```go
a, b := Tee(done, in)

go func() {
    for v := range a {
        if v == "stop" {
            close(a) // panic later
            return
        }
        process(v)
    }
}()
```

### What's wrong

`a` is typed `<-chan T` to prevent this, but the example assumes the author cast it back to bidirectional. Closing an output channel externally causes the next `out1 <- v` inside the tee to panic with "send on closed channel."

**Fix.** Do not close output channels of combinators. Use `done` to signal stop.

---

## Bug 7: Nil-channel reset after each input

```go
func Tee[T any](done <-chan struct{}, in <-chan T) (<-chan T, <-chan T) {
    out1, out2 := make(chan T), make(chan T)
    go func() {
        defer close(out1)
        defer close(out2)
        a, b := out1, out2  // reset OUTSIDE the loop!
        for v := range in {
            for i := 0; i < 2; i++ {
                select {
                case <-done: return
                case a <- v: a = nil
                case b <- v: b = nil
                }
            }
        }
    }()
    return out1, out2
}
```

### What's wrong

`a` and `b` are nilled on the first input value. From the *second* value onward, both are `nil`, so the inner `select` only has `<-done` as a viable case. The goroutine deadlocks waiting for `done`.

**Fix.** Reset `a, b := out1, out2` *inside* the outer loop, once per input value.

---

## Bug 8: Done channel is nil

```go
func main() {
    in := producer()
    a, b := Tee(nil, in)  // nil done!
    ...
}
```

### What's wrong

A `nil` channel in a `select` case is a *disabled* case, not an immediate fail. The `<-done` case never fires. If `in` closes normally, this is fine — the tee drains and exits. But if you need to cancel, you can't. Combined with a consumer crash or hang, the tee leaks.

**Fix.** Always pass a real `done` channel, even if you don't plan to close it during normal operation. Cancellation paths are insurance.

---

## Bug 9: Tee with shared pointer payload

```go
type Event struct {
    ID   string
    Data map[string]string
}

a, b := Tee(done, eventsChan)

go func() {
    for ev := range a {
        ev.Data["consumer"] = "A" // modifies shared map
    }
}()
go func() {
    for ev := range b {
        fmt.Println(ev.Data["consumer"]) // may print "A"
    }
}()
```

### What's wrong

`Event.Data` is a `map`, which is a reference type. Tee sends a struct copy, but the `Data` map header points to the same underlying storage. Consumer A mutates it; consumer B sees the mutation. The bug surfaces as race conditions reported by `-race`, or as flaky tests where the order of consumers matters.

**Fix.** Either treat tee values as immutable (document the contract), or deep-copy at the tee, or refactor to use immutable payloads.

---

## Bug 10: Tee + fan-in collision

```go
a, b := Tee(done, in)
merged := FanIn(a, b)
for v := range merged {
    fmt.Println(v)
}
```

### What's wrong

`FanIn(a, b)` merges two channels into one. After tee, both `a` and `b` carry the same sequence. The merged channel carries every value *twice*. The downstream consumer sees doubled values. Almost always a thinko by the author.

**Fix.** Drop the tee, or drop the fan-in. If you wanted "tee for testing visibility and then merge back," use a debug tap (lossy tee) instead.

---

## Bug 11: Cancellation without drain

```go
a, b := Tee(done, in)
go func() {
    for v := range a {
        if shouldStop(v) {
            close(done)
            return // does not drain b!
        }
    }
}()
for v := range b {
    process(v)
}
```

### What's wrong

When `done` closes, the tee goroutine may have a value mid-flight. If it has already sent to `a` (and `a`'s consumer has just exited), the next iteration picks `<-done` and returns — fine. But if `b` is unbuffered and slow, the producer may be blocked on `b <- v` when `done` fires; the `select` picks `<-done` cleanly. So far OK. The real issue: after `close(done)`, the `for v := range b` is still running and expects EOF; tee's `defer close(b)` runs, b closes, the loop exits.

So actually... what's the bug? The bug is that *before* the deferred close runs, the producer may have sent a value to `b` that no consumer reads. The producer was blocked in `case b <- v`; the `<-done` case wins; the goroutine returns without finishing the send. That's OK because no value was sent. So no bug?

Re-read: the `select`'s `case b <- v` only completes if it is actually chosen. If `<-done` is chosen instead, the send did not happen. The trick to confirm: a send that loses a select race did not move the value.

**Actual bug.** The bug is the close-then-return without ensuring `a`'s consumer's exit signal coordinates with `b`'s. If consumer A exits abruptly after closing `done`, consumer B may continue processing values for several more iterations until the tee notices and exits. If B's processing has side effects that should be tied to A's lifecycle, this asymmetry is the bug.

**Fix.** Tie A's lifecycle to B's via a shared `WaitGroup` or `errgroup`, so consumers coordinate exit, and only signal `done` once all consumers acknowledge.

---

## Bug 12: Tee with a producer that panics

```go
func produce() <-chan int {
    out := make(chan int)
    go func() {
        for i := 0; i < 10; i++ {
            if i == 5 { panic("boom") }
            out <- i
        }
        close(out)
    }()
    return out
}

func main() {
    in := produce()
    a, b := Tee(done, in)
    go func() { for range a {} }()
    for range b {}
}
```

### What's wrong

The producer panics at i=5 without closing `out`. The panic kills the program (no recover in the goroutine), so in this exact example the bug is moot — the whole process dies. But suppose someone adds `recover` to the producer:

```go
defer func() { recover() }()
```

Now the producer's goroutine swallows the panic and exits without closing `out`. The tee's `for v := range in` blocks forever. The tee goroutine leaks. Both `a` and `b` are stranded.

**Fix.** Always close the output channel in `defer`, before any other `defer`:

```go
go func() {
    defer close(out)
    defer func() { recover() }()
    ...
}()
```

The `defer close(out)` ensures the channel is closed *even on panic*, which lets the tee drain and exit cleanly.

---

## Bug 13: Tee with mismatched channel capacities

```go
func TeeAsym[T any](done <-chan struct{}, in <-chan T) (<-chan T, <-chan T) {
    out1 := make(chan T, 1024)
    out2 := make(chan T, 1)
    go func() {
        defer close(out1)
        defer close(out2)
        for v := range in {
            a, b := out1, out2
            for i := 0; i < 2; i++ {
                select {
                case <-done: return
                case a <- v: a = nil
                case b <- v: b = nil
                }
            }
        }
    }()
    return out1, out2
}
```

### What's wrong

The two buffers have wildly different capacities. `out1` can absorb 1024 items; `out2` can absorb 1. If `out1`'s consumer is fast and `out2`'s consumer is slow, the `out1` buffer fills almost immediately because, on each iteration, `select` is just as likely to pick `a` first as `b`. But the producer cannot advance until both have received this value. So `out1`'s buffer fills (in temporary), then drains, then fills, then drains, in a wasteful churn — and the throughput is bounded by `out2`'s slow consumer anyway.

The 1024-slot buffer is essentially useless.

**Fix.** Either symmetric buffers (both 1024 or both 0), or use the asymmetric *lossy* form where the slow side is non-blocking and the fast side blocks.

---

## Bug 14: Tee inside a select that selects on its outputs

```go
a, b := Tee(done, in)
for {
    select {
    case v := <-a:
        useA(v)
    case v := <-b:
        useB(v)
    case <-done:
        return
    }
}
```

### What's wrong

This consumer drains *both* outputs in one select. It uses one value at a time, alternating arbitrarily between A and B. The result: each input value is processed *twice* by the same consumer, with the consumer not knowing it's seeing duplicates.

This is almost always a misunderstanding of tee. The author wrote tee expecting two consumers, then wrote one consumer that drains both.

**Fix.** Either two separate consumers (one per branch), or drop the tee and use the input directly.

---

## Bug 15: Tee where consumer reuses the value

```go
type Buffer struct {
    Data []byte
}

func main() {
    in := make(chan *Buffer)
    a, b := Tee(done, in)

    go func() {
        for buf := range a {
            buf.Data = buf.Data[:0] // clear for reuse?
            useA(buf)
        }
    }()
    go func() {
        for buf := range b {
            useB(buf) // sees cleared Data!
        }
    }()
}
```

### What's wrong

The producer reuses `*Buffer` to avoid allocation. Both consumers receive the same pointer. Consumer A clears the slice; consumer B then reads zero-length data. Worse: if A clears after B has captured the pointer but before B has read its contents, B observes inconsistent state.

This is a textbook aliasing bug. The Go race detector may or may not catch it depending on memory ordering.

**Fix.** Do not reuse buffers across tee branches. Either allocate per send, or send by value, or build an immutability contract enforced by review.

---

## Bug 16: Tee with a done channel that's never closed

```go
func RunForever() {
    done := make(chan struct{})
    in := source()
    a, b := Tee(done, in)
    go consumeA(a)
    consumeB(b)
}
```

### What's wrong

`done` is created locally, never closed, never passed elsewhere. The tee can only exit when `in` closes. If `in` never closes (a long-running source like a network listener), the tee runs forever. Combined with `consumeA` exiting early (e.g., panic-recovered), the tee blocks on `a <- v` forever, and the producer stalls.

**Fix.** Wire `done` to the process-level cancellation signal:

```go
ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
defer cancel()
a, b := Tee(ctx, in)
```

Or pass `done` as a parameter so the caller controls cancellation.

---

## General lessons

Patterns across the bugs:

1. **Tee depends on the producer closing `in`.** If the producer panics or otherwise fails to close, tee leaks. Make `close(in)` the producer's first deferred statement.
2. **Both outputs must be consumed.** Discarding one stalls the producer.
3. **`done` must be a real channel.** `nil` looks like it disables the case; it does, but it disables your cancellation entirely.
4. **The nil-channel-after-send trick is non-optional** in the canonical implementation. Without it, the inner loop may send twice to the same output.
5. **Reset `a, b` per outer iteration.** Once per input value, not once per tee.
6. **Reference-type payloads alias across outputs.** Either document immutability or deep-copy.
7. **Tee is a primitive, not per-request scaffolding.** Build once at startup.

A correct tee implementation is fifteen lines. A correctly-*used* tee depends on every collaborator in the pipeline behaving properly. Most "tee bugs" are bugs in producers, consumers, or surrounding lifecycle code.

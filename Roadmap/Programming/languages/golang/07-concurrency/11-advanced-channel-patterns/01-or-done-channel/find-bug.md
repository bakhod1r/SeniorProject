# Or-Done-Channel — Find the Bug

A collection of broken `orDone`-style code. For each snippet, read carefully, find the bug, and check against the discussion that follows.

---

## Bug 1: The missing inner select

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
                out <- v
            }
        }
    }()
    return out
}
```

### Find it

What goroutine leak does this admit?

### Discussion

The send `out <- v` is not inside a `select`. If the consumer stops reading from `out` (e.g., it broke out of its `range`), the `orDone` goroutine blocks here. When `done` is then closed, this blocked send is unaffected — the goroutine never observes the close. It is leaked.

Fix: wrap the send in `select { case out <- v: case <-done: return }`.

This is the most common implementation mistake. It compiles, it passes simple tests, and it leaks in production when consumers exit early.

---

## Bug 2: Wrong channel closure

```go
func orDone[T any](done <-chan struct{}, c <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        defer close(c) // <-- this line
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

### Find it

The compiler may or may not complain. What's wrong?

### Discussion

`close(c)` is a bug. The compiler refuses, because `c` is `<-chan T` (receive-only) — you cannot close a receive-only channel. Good: the type system catches this one.

But the *intent* — having `orDone` close its input — is also wrong even with a bidirectional channel. The producer owns `c` and must close it. If `orDone` closed `c`, the producer would panic on its next send. The principle: never close a channel you did not create.

Fix: delete the line.

---

## Bug 3: Sending to done instead of closing

```go
done := make(chan struct{})
go func() {
    time.Sleep(time.Second)
    done <- struct{}{} // <-- this
}()
for v := range orDone(done, source) {
    use(v)
}
```

### Find it

`orDone` exits, but other consumers of the same `done` channel never observe cancellation.

### Discussion

`done <- struct{}{}` is a *send*, not a *close*. Only one goroutine that does `<-done` will receive the value. Every other goroutine waiting on `<-done` is still blocked. The cancellation is *one-shot*, not *broadcast*.

The convention is: close the channel. A closed channel makes every `<-done` immediately ready, broadcasting the signal to all consumers.

Fix: `close(done)` instead of `done <- struct{}{}`.

---

## Bug 4: Double close panic

```go
func cancel() {
    close(done)
}

// later, from two paths:
cancel()
cancel() // panic: close of closed channel
```

### Find it

The second `cancel()` panics. Why is this hard to spot in real code?

### Discussion

In a small example, the bug is obvious. In real code, `cancel` might be called from multiple defer blocks, from error paths, from cleanup goroutines, and from a top-level `defer cancel()`. Any two of them firing in the same execution causes a panic.

Fix: wrap with `sync.Once`:

```go
var once sync.Once
cancel := func() {
    once.Do(func() { close(done) })
}
```

Or use `context.WithCancel`, whose `cancel()` is idempotent by design.

---

## Bug 5: WaitGroup vs orDone ordering

```go
done := make(chan struct{})
var wg sync.WaitGroup

for i := 0; i < 4; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for v := range orDone(done, jobs) {
            handle(v)
        }
    }()
}

wg.Wait() // <-- never returns
close(done)
```

### Find it

Why does this deadlock?

### Discussion

`wg.Wait()` blocks until all four workers call `wg.Done()`. The workers exit their `range` only when `orDone` closes its output — which requires `done` to close. But `close(done)` is *after* `wg.Wait()`.

Fix: reverse the order. Close `done` first, then wait.

```go
close(done)
wg.Wait()
```

This is one of the most frequent ordering bugs around the pattern. Always: cancel first, join afterwards.

---

## Bug 6: Capturing the loop variable

```go
sources := []<-chan int{src1, src2, src3}

for _, s := range sources {
    go func() {
        for v := range orDone(done, s) { // <-- captures s
            handle(v)
        }
    }()
}
```

### Find it

In Go versions before 1.22, what happens?

### Discussion

Pre-Go 1.22, the loop variable `s` is shared across iterations. By the time the goroutines start running, `s` is the last value of the range — `src3`. All three goroutines read from `src3` and ignore the others.

Fix for any Go version:

```go
for _, s := range sources {
    s := s // shadow
    go func() {
        for v := range orDone(done, s) {
            handle(v)
        }
    }()
}
```

Or pass as a parameter:

```go
for _, s := range sources {
    go func(s <-chan int) {
        for v := range orDone(done, s) {
            handle(v)
        }
    }(s)
}
```

Go 1.22+ makes the per-iteration `s` fresh by default, fixing this. If you target Go 1.21 or below, you must shadow or pass.

---

## Bug 7: Forgetting `defer close(out)`

```go
func orDone[T any](done <-chan struct{}, c <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        for {
            select {
            case <-done:
                close(out)
                return
            case v, ok := <-c:
                if !ok {
                    close(out)
                    return
                }
                select {
                case out <- v:
                case <-done:
                    close(out)
                    return
                }
            }
        }
    }()
    return out
}
```

### Find it

The author explicitly closes `out` on each return path. What is fragile about this?

### Discussion

It works *as written*, but it is brittle: every future modification to the function must remember to add `close(out)` on every new return path. The moment someone adds an early return (perhaps in an error case, perhaps in a refactor), the close is forgotten and consumers' `range` hangs forever.

Fix:

```go
go func() {
    defer close(out)
    // ... no explicit close calls
}()
```

`defer close(out)` runs on every return path — including panics. This is the idiomatic Go pattern for "I own this resource, here is its cleanup."

---

## Bug 8: Wrong direction on parameter

```go
func orDone[T any](done chan struct{}, c chan T) chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        // ...
    }()
    return out
}
```

### Find it

The function compiles. What's wrong with the type signature?

### Discussion

All three channels are bidirectional. This means:

- The caller could accidentally `close(done)` from inside the consumer (the receiver). Bad.
- The caller could accidentally close the returned channel. Catastrophic — `orDone`'s `defer close(out)` would then panic.
- A confused user could pass a write-only channel where a read-only was expected, hoping the compiler would warn them.

Fix: use directional types.

```go
func orDone[T any](done <-chan struct{}, c <-chan T) <-chan T
```

The receive-only signature on `done` and `c` says "I only read." The receive-only return says "you only read." The compiler enforces ownership.

---

## Bug 9: Producer ignoring done

```go
func source() <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            out <- i // never observes done
        }
    }()
    return out
}

// caller:
done := make(chan struct{})
for v := range orDone(done, source()) {
    if v == 5 { close(done); break }
}
```

### Find it

After the consumer breaks, what's the state of the producer goroutine?

### Discussion

The producer is sending into `out` (the source channel). When the `orDone` goroutine exits (because `done` closed), no one is reading from `out` any more. The producer's next send blocks forever. Goroutine leaked.

`orDone` covered the consumer side; nothing covered the producer side.

Fix: make the producer observe a done signal (or context) too.

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

Now closing `done` collapses both sides.

---

## Bug 10: Unbuffered errCh leak

```go
func runWithTimeout() error {
    errCh := make(chan error) // unbuffered
    go func() {
        errCh <- doWork()
    }()

    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()

    select {
    case err := <-errCh:
        return err
    case <-ctx.Done():
        return ctx.Err() // <-- early return, errCh never read
    }
}
```

### Find it

This is not strictly an `orDone` bug, but it's a classic in the same family. What leaks?

### Discussion

If the timeout fires before `doWork` completes, the function returns `ctx.Err()`. The goroutine continues running. When `doWork` eventually returns, the goroutine tries `errCh <- err` — but no one is reading. It blocks forever. Goroutine leaked.

Fix 1: buffer the channel.

```go
errCh := make(chan error, 1)
```

Now the goroutine's send succeeds immediately regardless of whether anyone reads.

Fix 2: make `doWork` cancellable via the context.

```go
go func() {
    errCh <- doWork(ctx)
}()
```

Both fixes apply; doing both is best.

---

## Bug 11: Misplaced break

```go
done := make(chan struct{})
for v := range orDone(done, source) {
    if v.Err != nil {
        break // <-- exits the loop, but done is never closed
    }
    process(v.Val)
}
// done is still open here; if source is infinite, the producer leaks
```

### Find it

What is leaked?

### Discussion

`break` exits the loop. But it does *not* close `done`. The `orDone` goroutine is still running, blocked on receiving from `source`. If `source` is an infinite generator that also doesn't observe `done`, the producer is also still running.

The consumer's exit alone is not cleanup. You must close `done` to cascade the shutdown.

Fix:

```go
done := make(chan struct{})
defer close(done)
for v := range orDone(done, source) {
    if v.Err != nil {
        break
    }
    process(v.Val)
}
```

`defer close(done)` fires on `break`, on return, and on panic. Always pair `done` creation with `defer close(done)`.

---

## Bug 12: Two goroutines wrapping the same channel

```go
done := make(chan struct{})
ch := source()

a := orDone(done, ch)
b := orDone(done, ch) // <-- same source

go func() { for v := range a { handleA(v) } }()
go func() { for v := range b { handleB(v) } }()
```

### Find it

What is wrong with wrapping `ch` twice with two separate `orDone` calls?

### Discussion

Both `orDone` goroutines are *receiving* from `ch`. Each value sent to `ch` goes to exactly one of them (channel sends are point-to-point in Go). So `handleA` sees roughly half the values and `handleB` sees the other half — they each get an unpredictable subset.

If you wanted both handlers to see every value, you should have used `tee(done, ch)` to split:

```go
a, b := tee(done, ch)
go func() { for v := range a { handleA(v) } }()
go func() { for v := range b { handleB(v) } }()
```

`tee` sends each value to both outputs. Two `orDone`s on the same source is a load balancer, not a broadcaster.

---

## Bug 13: Closed nil channel

```go
var done chan struct{} // never initialised
close(done)
```

### Find it

What happens at runtime?

### Discussion

`close` on a nil channel panics with "close of nil channel." This is not the same as the "close of closed channel" panic. Both are runtime errors caught by the runtime.

If you find yourself reaching for `close(done)` and `done` might be `nil`, the bug is upstream: `done` should have been initialised at the spawning site, not later.

Fix: always initialise `done := make(chan struct{})` at the spawn site, before any goroutine that uses it.

---

## Bug 14: Buffered orDone, lost cancellation values

```go
func orDone[T any](done <-chan struct{}, c <-chan T) <-chan T {
    out := make(chan T, 100) // <-- buffered
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

// caller:
out := orDone(done, source)
// reads 10 values, then:
close(done)
// reads from out — gets nothing, even though up to 100 values may have been buffered
```

### Find it

The consumer expects to drain the buffer after cancellation. Why might it not?

### Discussion

When `done` closes, the `orDone` goroutine exits and `defer close(out)` fires. The consumer's `range out` sees `out` close — and exits. The values still in `out`'s buffer are *not* automatically delivered; `range` does drain a closed channel, but only if the consumer keeps reading.

In fact, `range out` *does* drain the buffer before exiting. So this code does deliver the buffered values. The bug, in some teams' opinion, is the *expectation*: people who write `out := make(chan T, 100)` often expect that *all* in-flight values are delivered. In truth, only the ones already in the buffer are delivered; ones that were about to be sent (still inside the `orDone` goroutine's `v` variable) are lost.

Mitigation: be explicit about what "in-flight" means. Document whether the wrapper drains or drops. The `drainOrDone` variant exists precisely to make this distinction visible at the call site.

---

## Bug 15: Self-referential close

```go
func handler(ctx context.Context) {
    done := ctx.Done()
    defer close(done) // <-- compile error or panic?
}
```

### Find it

What's wrong with closing `ctx.Done()`?

### Discussion

`ctx.Done()` returns a `<-chan struct{}` — receive-only. The compiler rejects `close(done)` because you cannot close a receive-only channel. Good: the type system catches it.

Even if `done` had been bidirectional, closing it would be wrong: `ctx.Done()` is owned by the context, and closing it directly would bypass the context's internal state. Always cancel via `cancel()` (the function returned by `context.WithCancel`), never close `ctx.Done()`.

Fix: cancel via the cancel function.

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
```

---

## Bug 16: orDone receiving its own output

```go
done := make(chan struct{})
out := orDone(done, source)
out = orDone(done, out) // <-- "wrap twice"
```

### Find it

This compiles and runs. What does it cost?

### Discussion

Two `orDone` goroutines now sit between `source` and the consumer. Every value crosses two extra channels. Goroutine count doubles. Memory and CPU overhead doubles.

There is no functional benefit: the second wrap observes the same `done` as the first. The cancellation behaviour is identical to a single wrap.

Fix: don't double-wrap. Wrap once at the boundary.

This bug usually appears when someone "just to be safe" wraps a channel they did not realise was already wrapped. Code review and clear API contracts (in docstrings) prevent it.

---

These sixteen bugs cover the most common failures. Reading them in order is its own kind of education: by the end, you have seen every way `orDone`-style code can fail in real systems. When you write your own, you will recognise these patterns before they hit production.

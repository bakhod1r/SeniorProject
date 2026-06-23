# Bridge-Channel — Find the Bug

A series of bridge implementations and consumers, each with a defect. For each snippet:

1. Identify the bug.
2. Explain why it occurs.
3. Provide a fix.

Solutions follow each snippet.

---

## Bug 1 — Missing OrDone

```go
func bridge[T any](done <-chan struct{}, cs <-chan <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for {
            var stream <-chan T
            select {
            case s, ok := <-cs:
                if !ok {
                    return
                }
                stream = s
            case <-done:
                return
            }
            for v := range stream {
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

**Bug:** The inner `for v := range stream` blocks on `<-stream`. If `done` is closed mid-inner-stream, the range does *not* observe `done`. It will only exit when the inner channel closes — which may never happen if the producer is also watching `done` and bows out without closing.

**Why:** A bare `range` over a channel only exits on channel close. There is no cancellation guard.

**Fix:** Wrap the inner channel with `orDone`:

```go
for v := range orDone(done, stream) {
    select {
    case out <- v:
    case <-done:
        return
    }
}
```

---

## Bug 2 — Closing inner channel from bridge

```go
go func() {
    defer close(out)
    for s := range cs {
        for v := range s {
            out <- v
        }
        close(s) // "clean up"
    }
}()
```

**Bug:** Bridge closes an inner channel it does not own. If the producer also tries to close it (or send into it after thinking it's still open), the program panics.

**Why:** Ownership rule: the goroutine that creates a channel closes it. Bridge is a reader, not the owner.

**Fix:** Remove the `close(s)`. Trust the producer's contract.

---

## Bug 3 — Buffered output hides cancellation

```go
out := make(chan T, 1000)
```

**Bug:** A consumer that stops reading allows up to 1000 values to accumulate in memory. Cancellation, when it eventually arrives, leaves the buffered values stranded. Bridge appears to "work" but is wasting memory.

**Why:** The output buffer absorbs the consumer-side backpressure. With nothing pushing the producer to slow down, the producer races ahead.

**Fix:** Use an unbuffered output: `out := make(chan T)`. Buffer only if measurements show a need.

---

## Bug 4 — Forgetting to close the outer channel

```go
func Pages(ctx context.Context, c *Client) <-chan <-chan Row {
    out := make(chan (<-chan Row))
    go func() {
        cursor := ""
        for {
            page, next, _ := c.Fetch(cursor)
            inner := makeInner(page)
            out <- inner
            if next == "" {
                return // missing close(out)
            }
            cursor = next
        }
    }()
    return out
}
```

**Bug:** When pagination ends, the goroutine returns without closing `out`. Bridge's outer receive blocks forever; the consumer's `for range` never sees EOF.

**Why:** Bridge relies on the outer channel's closure to know when to stop.

**Fix:** `defer close(out)` at the top of the goroutine.

---

## Bug 5 — Double bridge on the same chanStream

```go
flat1 := bridge(done, cs)
flat2 := bridge(done, cs)
go consumeA(flat1)
go consumeB(flat2)
```

**Bug:** Two bridges race for inner channels in `cs`. Each receives roughly half. Neither sees the full flat stream.

**Why:** A channel is consumed once; readers compete.

**Fix:** Bridge once, then tee the result:

```go
flat := bridge(done, cs)
a, b := tee(done, flat)
go consumeA(a)
go consumeB(b)
```

---

## Bug 6 — Producer doesn't watch ctx on send

```go
inner := make(chan int)
go func() {
    defer close(inner)
    for _, v := range data {
        inner <- v // no select on ctx
    }
}()
out <- inner
```

**Bug:** If bridge has been cancelled and stops reading `inner`, the producer goroutine blocks forever on `inner <- v`. Goroutine leak.

**Why:** An unbuffered send blocks until a receive. Bridge no longer receives after cancel; producer is stuck.

**Fix:** Producer must select on `ctx.Done()` when sending:

```go
select {
case inner <- v:
case <-ctx.Done():
    return
}
```

---

## Bug 7 — Nil inner channel emitted

```go
go func() {
    defer close(out)
    if condition() {
        var inner <-chan T // nil
        out <- inner
        return
    }
    out <- makeInner()
}()
```

**Bug:** A nil channel is emitted. Bridge tries to read from it, blocks forever (receives on nil block).

**Why:** `var c <-chan T` is nil. Receiving from a nil channel is permanent blocking.

**Fix:** Never emit nil. Either skip the case or emit a closed empty channel:

```go
empty := make(chan T); close(empty)
out <- empty
```

---

## Bug 8 — Bridge in a select without exit

```go
for {
    select {
    case <-time.After(time.Second):
        log.Println("tick")
    case v := <-bridge(ctx, cs):
        process(v)
    }
}
```

**Bug:** Calling `bridge(ctx, cs)` *inside* the select means a new bridge is created on every iteration. Each one launches a helper goroutine. Each one reads from `cs` independently. Catastrophic leak and ordering corruption.

**Why:** A function call inside a select case is invoked on every loop pass.

**Fix:** Call bridge once, outside the loop:

```go
out := bridge(ctx, cs)
for {
    select {
    case <-time.After(time.Second):
        log.Println("tick")
    case v, ok := <-out:
        if !ok {
            return
        }
        process(v)
    }
}
```

---

## Bug 9 — Inner channel never closes

```go
go func() {
    for _, v := range data {
        inner <- v
    }
    // missing close(inner)
}()
out <- inner
```

**Bug:** Bridge waits for `inner` to close before moving to the next outer channel. It never closes. Bridge stalls. Subsequent inner channels back up in `cs`.

**Why:** Bridge's contract: each inner channel must be closed by its producer.

**Fix:** `defer close(inner)` at the start of the producing goroutine.

---

## Bug 10 — Closing done twice

```go
done := make(chan struct{})
close(done)
close(done) // panic
```

**Bug:** Closing an already-closed channel panics. If two places attempt to "signal cancel," both might close.

**Why:** Go's channel semantics: close-once.

**Fix:** Use `sync.Once`, or use `context.Context` which handles this internally.

```go
var cancelOnce sync.Once
cancel := func() { cancelOnce.Do(func() { close(done) }) }
```

---

## Bug 11 — Treating bridge as fan-in

```go
// "Parallel processing of shards"
shardChannels := make(chan <-chan Result)
for _, s := range shards {
    go func(s Shard) {
        shardChannels <- s.stream(ctx)
    }(s)
}
results := bridge(ctx, shardChannels) // expects parallel
```

**Bug:** Bridge reads shard streams *serially*. While shard 1 is being drained, shards 2..N's producers fill their internal buffers (or block on send). What the engineer wanted was parallel reads.

**Why:** Bridge serialises; fan-in parallelises. Different shapes.

**Fix:** Use fan-in:

```go
results := fanIn(ctx, shardStreams...)
```

Or use `BridgeParallel` if you want bounded concurrency with an outer-channel input shape.

---

## Bug 12 — Forgot to range over bridge

```go
out := bridge(ctx, cs)
for {
    v := <-out
    process(v)
}
```

**Bug:** When bridge closes `out`, `<-out` returns the zero value forever. The loop spins forever processing zero values.

**Why:** A receive from a closed channel returns the zero value with `ok == false`.

**Fix:** Either `range`:

```go
for v := range bridge(ctx, cs) {
    process(v)
}
```

Or check `ok`:

```go
for {
    v, ok := <-out
    if !ok {
        return
    }
    process(v)
}
```

---

## Bug 13 — Context cancelled but bridge keeps producing

```go
ctx, cancel := context.WithCancel(parent)
out := bridge(ctx, cs)
go func() {
    for v := range out {
        process(v)
    }
}()
time.Sleep(100 * time.Millisecond)
cancel()
// expect goroutine to exit
```

**Bug:** Bridge exits and closes `out`, the consumer goroutine exits. Good. But the inner-channel-producer goroutines may still be alive, blocked on sends, if they did not watch `ctx`.

**Why:** Cancellation propagates only to goroutines that look for it.

**Fix:** Audit every producer goroutine in the chain; ensure each selects on `ctx.Done()` in its send loop.

---

## Bug 14 — Hidden state in bridge through global

```go
var lastSeen int
func bridge(ctx context.Context, cs <-chan <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for s := range cs {
            for v := range s {
                lastSeen = v
                out <- v
            }
        }
    }()
    return out
}
```

**Bug:** Two bridges sharing the package-global `lastSeen` race. The variable is updated from a goroutine without synchronisation.

**Why:** Globals + goroutines = data race.

**Fix:** Move state into the bridge's closure, or remove it entirely. Bridge should be stateless externally.

---

## Bug 15 — Forgetting nil checks on shutdown

```go
defer close(out)
for {
    select {
    case s, ok := <-cs:
        if !ok {
            return
        }
        for v := range s {
            out <- v
        }
    case <-done:
        // forgot return
    }
}
```

**Bug:** When `done` fires, the case body runs but doesn't `return`. The loop continues, re-enters select, may pick `<-cs` again. Cancellation is effectively ignored.

**Why:** A `case` without `return` falls through into the next iteration.

**Fix:** Add `return`:

```go
case <-done:
    return
```

---

## Bug 16 — Bridging a buffered chanStream with a slow consumer

```go
cs := make(chan <-chan int, 1000) // huge buffer
out := bridge(ctx, cs)
// consumer reads slowly
```

**Bug:** The outer channel's buffer holds up to 1000 inner channels, each potentially holding values. Memory grows.

**Why:** Buffering the outer decouples producer from consumer; producer races ahead, building up.

**Fix:** Make `cs` unbuffered. The producer naturally throttles to the bridge's pace.

---

## Bug 17 — Goroutine leak when ctx cancels exactly during send

```go
for v := range orDone(ctx, stream) {
    out <- v // not in a select
}
```

**Bug:** If the consumer disappears between `range` checks, `out <- v` blocks. Even though `orDone` is cancellable, this send is not.

**Why:** A send-without-select doesn't observe ctx.

**Fix:** Wrap the send in a select:

```go
select {
case out <- v:
case <-ctx.Done():
    return
}
```

This is the inner select-on-send and is part of the canonical bridge.

---

## Bug 18 — Returning a bidirectional channel

```go
func bridge[T any](ctx context.Context, cs <-chan <-chan T) chan T {
    out := make(chan T)
    // ...
    return out
}
```

**Bug:** Returning `chan T` instead of `<-chan T` means external callers can close it. Bridge has exclusive ownership; an external close causes a panic on bridge's deferred close.

**Why:** Return types enforce semantic restrictions.

**Fix:** Return `<-chan T`. Receivers can't close.

---

## Bug 19 — Async logging delays goroutine exit

```go
go func() {
    defer close(out)
    defer log.Println("bridge exiting")
    for {
        // ...
    }
}()
```

**Bug:** The deferred `log.Println` runs after `close(out)`. Mostly harmless, but if `log` itself uses a channel or blocks on a slow writer, bridge's caller sees `out` closed but the goroutine lingers.

**Why:** Defers run in LIFO order, after all returns.

**Fix:** Order defers so cleanup that callers depend on (close) runs last. Reverse the defer order:

```go
defer close(out)
defer log.Println("bridge exiting")
```

Wait — that's the same. The fix is to put `close(out)` last in source order so it runs first:

```go
defer log.Println("bridge exiting") // runs second
defer close(out)                     // runs first
```

Actually defers run LIFO, so the *last* defer in source order runs *first*. To make close run first, put it last in source:

```go
defer log.Println("bridge exiting") // pushed first, runs last
defer close(out)                     // pushed last, runs first
```

Confusing but important. Document carefully.

---

## Bug 20 — `range` over a returned function

```go
out := bridge // forgot the call
for v := range out { ... }
```

**Bug:** `bridge` is a function value, not a channel. `range` over a function with the correct signature is valid in Go 1.23+ but unlikely to do what's intended.

**Why:** Without parentheses, you've passed the function reference, not its result.

**Fix:** Call the function: `out := bridge(ctx, cs)`.

---

Twenty bugs covering implementation, contract, lifecycle, and use. If you can spot all of them at a glance, you have an intuition for bridge's failure modes. If a few surprised you, revisit junior and middle level.

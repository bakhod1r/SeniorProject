# Bridge-Channel — Interview Questions

A focused set of interview questions on the bridge-channel pattern, in roughly increasing difficulty. Each comes with a concise reference answer.

---

## 1. What is the bridge-channel pattern, in one sentence?

Bridge is an adapter that takes a stream of streams (`<-chan <-chan T`) and produces a single flat stream (`<-chan T`) by reading each inner channel to completion in order and forwarding its values to one output.

It was named in Katherine Cox-Buday's *Concurrency in Go*.

---

## 2. Why would a producer return `<-chan <-chan T` instead of `<-chan T`?

Three common situations:

- **Pagination.** The natural unit is the page; each page becomes one inner channel.
- **Batches.** Each batch produces a sub-stream of results.
- **Sub-queries.** A query made of N sequential stages, each yielding rows.

The two-level shape encodes the producer's natural structure. Bridge lets the consumer ignore it.

---

## 3. Write the bridge function from memory.

```go
func bridge[T any](done <-chan struct{}, chanStream <-chan <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for {
            var stream <-chan T
            select {
            case maybeStream, ok := <-chanStream:
                if !ok {
                    return
                }
                stream = maybeStream
            case <-done:
                return
            }
            for v := range orDone(done, stream) {
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

Three cancellation points: outer select, inside `orDone`, inner select-on-send.

---

## 4. What does `orDone` do, and why is it required inside bridge?

`orDone` wraps a channel with a cancellation guard, producing a new channel that closes when *either* the wrapped channel closes *or* the cancellation signal fires.

Inside bridge it's required because the inner read is a `for range`. Without `orDone`, a `range` over the inner channel blocks indefinitely on receive even after `done` is closed — bridge can't exit, the goroutine leaks. `orDone` makes the inner read cancellable.

---

## 5. How does bridge differ from fan-in?

| | Bridge | Fan-In |
|---|---|---|
| Input | `<-chan <-chan T` | `...<-chan T` |
| Reading | Serial | Parallel |
| Order | Concatenation | Interleaved |
| N known at | Run-time (over time) | Call-time |
| Goroutines | 1 | N (one per input) |

Mnemonic: **bridge concatenates, fan-in merges**.

If all inputs are known at the call site and you want them merged, use fan-in. If inputs arrive over time and you want them concatenated, use bridge.

---

## 6. What happens if an inner channel never closes?

Bridge stalls on it forever. The next inner channel is never read. The whole pipeline freezes until cancellation fires (or the program is killed).

The producer's contract is: every emitted inner channel must eventually be closed. Bridge cannot enforce it.

---

## 7. What happens if the producer emits a nil inner channel?

Receives on a nil channel block forever. Bridge stalls. Cancellation still works (the inner select sees `done`), but no further inner channels are read.

The fix: validate inner channels at the producer, never emit nil.

---

## 8. Does bridge close inner channels?

No. Inner channels are owned by their producers; bridge only reads from them. If bridge closed an inner channel, the producer would panic on its next send.

This is a strict ownership rule and must be documented in the producer's contract.

---

## 9. Can two bridges share the same `chanStream`?

No. Two bridges would race for inner channels — each would get a subset. Neither would see the full flat stream.

If you need two consumers of one flat stream, run one bridge and `tee` its output.

---

## 10. Could you implement bridge without `orDone`?

Yes, by inlining the select inside the inner loop:

```go
for {
    select {
    case <-done:
        return
    case v, ok := <-stream:
        if !ok {
            goto next
        }
        select {
        case out <- v:
        case <-done:
            return
        }
    }
}
next:
```

Slightly faster (one fewer goroutine and channel hop per inner stream), slightly less readable. Both are correct.

---

## 11. Why doesn't bridge buffer its output channel by default?

The output is the place backpressure must reach the producer. Buffering it decouples consumer pace from producer pace — values pile in memory if the consumer is slow, and cancellation latency increases.

Almost always wrong. Use unbuffered unless you have measurements demonstrating a need.

---

## 12. How does bridge handle errors?

Bridge doesn't natively. Conventions:

- Wrap values in `Result[T]{Val, Err}` and let consumers branch on `Err`.
- Maintain a parallel `<-chan error` and `select` on both.

The first composes better through pipelines.

---

## 13. What's the goroutine cost of bridge?

One helper goroutine for the bridge loop, plus one `OrDone` helper per inner channel processed. The bridge helper is persistent for the lifetime of the bridge; `OrDone` helpers live only as long as their inner channel.

Memory: ~2 KB per goroutine (initial stack) + one channel allocation each.

---

## 14. How would you test that bridge doesn't leak goroutines?

Use `goleak` from `go.uber.org/goleak`:

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

Combined with tests that drive bridge through normal, empty, and cancelled paths.

Also useful: a stress test that spawns 1000 bridges with random cancellation, then asserts `runtime.NumGoroutine()` returns to baseline.

---

## 15. Can bridge be replaced with `iter.Seq` in Go 1.23+?

For *synchronous* consumers, yes:

```go
func BridgeSeq[T any](chanStream <-chan <-chan T) iter.Seq[T] {
    return func(yield func(T) bool) {
        for stream := range chanStream {
            for v := range stream {
                if !yield(v) {
                    return
                }
            }
        }
    }
}
```

For concurrent producer-consumer, no — channels remain the natural fit. Most production bridges are still channel-based as of Go 1.23.

---

## 16. What ordering guarantees does bridge make?

Strict concatenation order: every value from inner channel #N is sent to the output before any value from inner channel #N+1. Within each inner channel, order is preserved.

This is the principal difference from fan-in, which interleaves and is non-deterministic.

---

## 17. Bridge a `<-chan <-chan int` where each inner channel arrives slowly (one per 100ms) and emits 1000 values quickly. What's the throughput pattern?

Burst-and-wait: 1000 values stream out at consumer speed, then 100ms idle while the next inner channel arrives, then another burst, and so on.

Average throughput: roughly `1000 / (drain_time + 100ms)`. If drain_time is fast, the 100ms outer-arrival latency dominates.

If you wanted to hide the 100ms gap, you'd pre-fetch — emit inner channels onto `chanStream` concurrently — but you'd lose strict serial order.

---

## 18. Could you bridge a `<-chan <-chan <-chan T`?

Yes, with two bridges:

```go
inner := Bridge(ctx, deeplyNested)        // <-chan <-chan T
flat := Bridge(ctx, inner)                  // <-chan T
```

Two helper goroutines, two output channels. Legal but rare — a three-level shape usually indicates that the producer's design is too nested. Consider refactoring the producer.

---

## 19. What goes wrong if a consumer abandons the bridge without cancelling?

Bridge blocks on `out <- v`. The inner select waits for `done` to fire. Without cancellation, the bridge goroutine leaks: it lives forever, holding the inner channel's producer goroutine as well.

Always cancel when you stop consuming.

---

## 20. Outline a hybrid "bridge with parallelism" and explain what trade-off you accept.

Spawn one goroutine per inner channel up to a concurrency limit K, merging into a single output:

```go
func BridgeParallel[T any](ctx context.Context, k int, cs <-chan <-chan T) <-chan T {
    out := make(chan T)
    sem := make(chan struct{}, k)
    var wg sync.WaitGroup
    go func() {
        defer func() { wg.Wait(); close(out) }()
        for s := range cs {
            sem <- struct{}{}
            wg.Add(1)
            go func(stream <-chan T) {
                defer wg.Done()
                defer func() { <-sem }()
                for v := range orDone(ctx.Done(), stream) {
                    select {
                    case out <- v:
                    case <-ctx.Done():
                        return
                    }
                }
            }(s)
        }
    }()
    return out
}
```

Trade-off: lose strict concatenation order across inner channels. Within each inner channel, order is preserved; across them, interleaved.

Name it clearly — not "bridge" — to avoid confusion.

---

## 21. A senior engineer says "bridge is just `concatMap` from Rx." Is that fair?

Largely yes. Cox-Buday's `bridge` is the channel-equivalent of `concatMap` / `concatAll` from RxJS, Project Reactor, and Akka Streams.

Both:

- Concatenate inner streams in arrival order.
- Don't interleave.
- Have a parallel sibling (`mergeMap` / `BridgeParallel`).

The differences are surface — Go uses channels, Rx uses observables — but the algebra is identical.

---

## 22. When should you reject bridge as a design choice?

- When inner channels can be consumed in parallel and order doesn't matter — use fan-in.
- When the data already lives in memory as slice-of-slices — just iterate.
- When global ordering is required across inner-channel values (sort, k-way merge) — bridge doesn't sort.
- When the producer can't be made to close inner channels — bridge will stall.
- When the shape is `<-chan <-chan T` by accident, not design — refactor the producer to emit a flat stream.

---

## 23. Bonus: walk through what happens when `done` fires while bridge is between inner channels.

The bridge helper is in the outer `select`:

```go
select {
case maybeStream, ok := <-chanStream: ...
case <-done:
    return
}
```

The `case <-done` is taken. The deferred `close(out)` runs. The helper goroutine exits. The output channel is closed. The consumer's `range` exits. Total latency: one select operation, sub-millisecond.

No values are dropped — none were in flight. The cancellation is clean.

---

## 24. Bonus: what does it look like in a stack trace when bridge has leaked?

The leaked goroutines are stuck in `runtime.gopark` inside a channel receive. The stack will show:

```
goroutine 42 [chan receive]:
runtime.gopark(...)
runtime.chanrecv(...)
yourpkg.bridge.func1(...)
    /path/bridge.go:14
```

Or, for the `OrDone` helper:

```
goroutine 43 [chan receive]:
yourpkg.orDone.func1(...)
    /path/ordone.go:12
```

Pair this trace with `goleak`'s output to find the missing cancellation or the never-closed inner channel.

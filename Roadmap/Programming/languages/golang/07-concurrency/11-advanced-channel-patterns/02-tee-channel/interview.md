# Tee-Channel — Interview Questions

A bank of questions, ordered roughly junior to senior. Each has a model answer and notes on what the interviewer is checking for.

---

## 1. What is the tee-channel pattern?

**Model answer.** A combinator that takes one input channel and produces two output channels. Every value sent on the input is delivered to both outputs, in order. Named after the Unix `tee` command.

**Checking for.** Knowing the shape. Bonus points for naming the source (Cox-Buday, *Concurrency in Go*).

---

## 2. Why can't I just read the same channel from two goroutines?

**Model answer.** A channel delivers each value to exactly one receiver. Two goroutines reading the same channel divide the stream — that's fan-out, not duplication. To duplicate, someone must explicitly send each value to two channels.

**Checking for.** Understanding that channels are point-to-point, not broadcast.

---

## 3. Write `Tee` from scratch.

**Model answer.**

```go
func Tee[T any](done <-chan struct{}, in <-chan T) (<-chan T, <-chan T) {
    out1, out2 := make(chan T), make(chan T)
    go func() {
        defer close(out1)
        defer close(out2)
        for v := range in {
            a, b := out1, out2
            for i := 0; i < 2; i++ {
                select {
                case <-done:
                    return
                case a <- v:
                    a = nil
                case b <- v:
                    b = nil
                }
            }
        }
    }()
    return out1, out2
}
```

**Checking for.** Generic signature; both defers in place; nil-channel trick; done as the first select case.

---

## 4. Walk me through the nil-channel trick. Why does it work?

**Model answer.** In Go's `select` statement, a case whose channel expression evaluates to `nil` is *disabled* — the runtime skips it. Setting the channel variable to `nil` after the first successful send removes it from consideration on the second iteration. The second iteration's `select` can then only pick the *other* output, guaranteeing one send per output.

**Checking for.** Knowing this is a runtime feature, not a workaround. Recognising it generalises to "disable a select case dynamically."

---

## 5. What happens if `done` is closed between the two sends?

**Model answer.** The next iteration of the inner `select` will see `<-done` ready and the goroutine returns. The output that received the first send has the value; the output that didn't never receives it. So the two outputs' counts differ by one for this final value. Both outputs then close via the deferred `close`.

**Checking for.** Understanding cancellation may produce a one-value asymmetry.

---

## 6. What is the difference between tee and fan-out?

**Model answer.** Fan-out *partitions* a stream across N workers; each value goes to one worker. Tee *duplicates* a stream into two outputs; each value goes to both. Fan-out is for load distribution; tee is for delivering the same data to multiple consumers.

**Checking for.** Crisp distinction. The "doubling a worker test" is a great elaboration.

---

## 7. What is the difference between tee and a broadcast hub?

**Model answer.** Tee has fixed N=2, no dynamic subscribe/unsubscribe, no per-subscriber buffering policy, and is implemented in ~15 lines. A broadcast hub has dynamic N, subscription lifecycle, configurable overflow policies, and is implemented in ~200 lines. Tee is a primitive; a hub is a framework. Use tee for the simple case; use a hub when consumers come and go or when per-consumer back-pressure differs.

**Checking for.** Knowing both ends of the spectrum and where the line is (roughly N>3 or dynamic).

---

## 8. The naive implementation sends to both outputs sequentially. What's wrong with that?

**Model answer.** Sequential sends are correct in terms of duplication but couple the consumers tightly in one ordering: A always sees the value before B. More importantly, between the two sends the goroutine cannot react to `done` without growing extra `select`s. The nil-channel-with-select form delivers to whichever consumer is ready first, fairly, and handles cancellation in one place.

**Checking for.** Recognising that the issue isn't correctness, it's flexibility and cancellation.

---

## 9. How do you handle three consumers?

**Model answer.** Chain two tees:

```go
a, rest := Tee(done, in)
b, c := Tee(done, rest)
```

For four, build a balanced tree. Past three or four, switch to a broadcast hub — chained tees become hard to read and reason about.

**Checking for.** Knowing the trick, knowing its limit.

---

## 10. What happens if one consumer is much slower than the other?

**Model answer.** The faster consumer is paced by the slower one. The producer can't push the next value until the slower output's send completes. This is *backpressure*, and it's intentional — it prevents unbounded buffering. If you want to decouple the two consumers, use a buffered or lossy asymmetric variant.

**Checking for.** Embracing backpressure as a feature, not a bug.

---

## 11. Write an asymmetric tee that buffers one side.

**Model answer.**

```go
func TeeAsym[T any](done <-chan struct{}, in <-chan T, buf int) (<-chan T, <-chan T) {
    a := make(chan T)
    b := make(chan T, buf)
    go func() {
        defer close(a)
        defer close(b)
        for v := range in {
            x, y := a, b
            for i := 0; i < 2; i++ {
                select {
                case <-done:
                    return
                case x <- v:
                    x = nil
                case y <- v:
                    y = nil
                }
            }
        }
    }()
    return a, b
}
```

**Checking for.** Recognising only the channel creation changes.

---

## 12. Write a lossy tee where one branch may drop.

**Model answer.**

```go
func TeeLossy[T any](done <-chan struct{}, in <-chan T, buf int) (
    critical, lossy <-chan T, dropped *uint64,
) {
    c := make(chan T)
    l := make(chan T, buf)
    var d uint64
    go func() {
        defer close(c)
        defer close(l)
        for v := range in {
            select {
            case <-done:
                return
            case c <- v:
            }
            select {
            case l <- v:
            default:
                atomic.AddUint64(&d, 1)
            }
        }
    }()
    return c, l, &d
}
```

**Checking for.** Critical branch uses blocking send; lossy branch uses non-blocking send with `default`. Drop counter is observable.

---

## 13. Is the `select` between the two `case`s biased?

**Model answer.** No. Go's `select` chooses uniformly at random among ready cases. Over time both outputs are equally likely to receive the value first within any given iteration. If you want priority, you express it explicitly with a nested `select` plus `default`.

**Checking for.** Knowing the spec answer (`select` is random) and how to add priority when needed.

---

## 14. What's the throughput ceiling?

**Model answer.** On commodity x86_64, around 4-6 million values per second for a single tee with CPU-bound consumers. The bottleneck is the channel send overhead and the `selectgo` runtime call. Past that, switch to a sharded tee or a single-producer-multi-consumer ring buffer.

**Checking for.** Order-of-magnitude familiarity. Bonus for naming the alternatives.

---

## 15. The producer panics. What happens?

**Model answer.** If the producer's goroutine fails to close `in` before panicking, the tee's `for v := range in` blocks forever waiting for the next value. The tee leaks. Defensive pattern: install a `recover` in the producer that closes the output channel before re-panicking.

**Checking for.** Awareness that tee depends on `in` being closed properly.

---

## 16. The consumer of `out1` panics. What happens?

**Model answer.** The next send to `out1` blocks forever. The tee goroutine is stuck on `a <- v` (or the inner select with `outA` as a ready case but no receiver). `done` is the escape hatch; cancellation eventually frees the goroutine.

**Checking for.** Understanding the cascade and the role of cancellation.

---

## 17. Can both output channels be closed by tee at the same time?

**Model answer.** Yes — both `defer close(...)` statements run at goroutine exit. From the consumers' perspective, both see EOF concurrently (or near-concurrently; scheduler decides). Whether your consumers observe close at the exact same instant is irrelevant; they each independently exit their `range` loop.

**Checking for.** Knowing `defer` runs both, in LIFO order, when the goroutine returns.

---

## 18. Why does the canonical tee use `for i := 0; i < 2; i++` and not `for { ... break when done }`?

**Model answer.** Style. We know statically that exactly two sends per input value are needed. A counted loop expresses that intent directly. A while-loop with a break condition would require checking whether both `a` and `b` are nil, which is more code for the same effect. Both are correct.

**Checking for.** Reading code for clarity. Stylistic preferences are fair game.

---

## 19. How would you test the backpressure property?

**Model answer.** Run a benchmark with one fast consumer (immediate receive) and one slow consumer (sleeps per receive). Measure total wall time and producer's progress. If the producer ran ahead of the slow consumer, backpressure was broken. A typical test asserts that the total time matches the slow consumer's pace within a tolerance.

**Checking for.** Distinguishing "test correctness" from "test design intent." Backpressure is design intent.

---

## 20. When would you NOT use tee?

**Model answer.**
- N > 3 consumers: use a hub.
- Consumers must fail independently: use a hub with per-subscriber drop policy.
- Throughput exceeds ~5 M/sec: use SPMC ring fanout.
- Consumers live in different processes: use a message broker with consumer groups.
- Dynamic subscribe/unsubscribe: use a hub.

**Checking for.** Knowing the design envelope.

---

## 21. Implement a tee that works on `context.Context` instead of a `done` channel.

**Model answer.**

```go
func Tee[T any](ctx context.Context, in <-chan T) (<-chan T, <-chan T) {
    out1, out2 := make(chan T), make(chan T)
    go func() {
        defer close(out1)
        defer close(out2)
        for v := range in {
            a, b := out1, out2
            for i := 0; i < 2; i++ {
                select {
                case <-ctx.Done():
                    return
                case a <- v:
                    a = nil
                case b <- v:
                    b = nil
                }
            }
        }
    }()
    return out1, out2
}
```

**Checking for.** Trivial substitution; recognising it's the same pattern.

---

## 22. How does tee compose with `errgroup`?

**Model answer.** Producer and consumers are `g.Go(...)` tasks; the tee goroutine is spawned directly. When any errgroup task returns an error, the context is cancelled, the tee sees `<-ctx.Done()`, exits, closes outputs, and consumers' ranges exit. `g.Wait()` returns the first error. The tee itself does not need to be an errgroup member because it produces no error.

**Checking for.** Lifecycle reasoning across multiple goroutines.

---

## 23. Walk me through a real production failure with tee.

**Model answer.** A common one: the audit branch writes to a SQL database that goes slow during a query plan regression. Symmetric tee couples both branches, so the business processor also slows. SLAs miss. The fix: switch the audit branch to lossy asymmetric tee with a 1024-slot buffer and a drop counter alerting at >0.1% drop rate. The business processor returns to normal speed; audit may lose a small fraction of events during incidents but is alerted on.

**Checking for.** Storytelling, root-cause analysis, knowledge of the right remediation.

---

## 24. The tee goroutine count keeps growing. What's the bug?

**Model answer.** Most likely: the caller spawns a new tee per request rather than per pipeline. Each request adds one goroutine that never exits (either because `in` never closes or `done` is never signalled for that request's tee). Fix: build the tee topology once at startup; per-request work happens through it.

**Checking for.** Recognising the smell of "per-item state machinery."

---

## 25. Could you implement tee with a single buffered channel and two readers?

**Model answer.** No, because Go channels deliver each value to exactly one reader. Two readers would split the stream, not duplicate it. To duplicate, you must explicitly send each value twice — either via channels or via an in-memory broadcast structure.

**Checking for.** Catching the trick question.

---

## Anti-questions (things you shouldn't ask)

- "What's the exact line of code in runtime/select.go that implements the nil-channel disabling?" — too low-level for normal interviews.
- "Why doesn't Go's tee use a sync.Mutex?" — leading question; the pattern is mutex-free by design.
- Anything that requires the candidate to memorise specific microbenchmark numbers without context.

Tee questions test for clarity of thinking about pipelines, channels, and lifecycle. The shortest tee implementation is fifteen lines; the conceptual scaffolding around it is what reveals seniority.

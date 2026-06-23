---
layout: default
title: Fan-In Fan-Out Within — Find the Bug
parent: Fan-In Fan-Out Within
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/05-fan-in-fan-out-within/find-bug/
---

# Fan-In / Fan-Out Inside a Pipeline — Find the Bug

Each section presents a piece of code with one or more bugs. Identify the bug, explain the failure mode, and write the fix. Try without looking at the answer first.

---

## Bug 1: Double close

```go
func mergeBad(cs ...<-chan int) <-chan int {
    out := make(chan int)
    for _, c := range cs {
        c := c
        go func() {
            for v := range c {
                out <- v
            }
            close(out)
        }()
    }
    return out
}
```

**Bug:** Each worker closes `out`. The first worker to finish closes the channel; the others panic on subsequent sends.

**Failure:** Runtime panic: "send on closed channel" from one of the still-running workers.

**Fix:** Use a `WaitGroup` and a single closer goroutine.

```go
func mergeFixed(cs ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        c := c
        go func() {
            defer wg.Done()
            for v := range c {
                out <- v
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

---

## Bug 2: No close at all

```go
func mergeBad2(cs ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        c := c
        go func() {
            defer wg.Done()
            for v := range c {
                out <- v
            }
        }()
    }
    return out
}
```

**Bug:** Missing closer goroutine. `out` is never closed.

**Failure:** Caller's `for v := range out` hangs forever after all input channels close. Caller's goroutine leaks.

**Fix:** Add the closer goroutine:

```go
go func() { wg.Wait(); close(out) }()
```

---

## Bug 3: Captured loop variable (pre-Go 1.22)

```go
func mergeBad3(cs []<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func() {
            defer wg.Done()
            for v := range c {
                out <- v
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Bug:** All forwarders share the same `c` (in Go < 1.22). They all read from the last channel.

**Failure:** Only values from the last channel are forwarded. Other channels are leaked.

**Fix:** Rebind `c` inside the loop:

```go
for _, c := range cs {
    c := c // rebind
    go func() { ... }()
}
```

Or pass as argument:

```go
for _, c := range cs {
    go func(c <-chan int) { ... }(c)
}
```

In Go 1.22+, the original code works correctly because of the per-iteration variable. Write the explicit form for compatibility.

---

## Bug 4: WaitGroup add inside goroutine

```go
func mergeBad4(cs ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for _, c := range cs {
        c := c
        go func() {
            wg.Add(1)
            defer wg.Done()
            for v := range c {
                out <- v
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Bug:** `wg.Add(1)` runs inside each goroutine. The closer goroutine may call `wg.Wait()` before any `Add` runs; sees counter 0; closes `out` immediately.

**Failure:** `out` closes before any value is forwarded. Caller sees an empty stream.

**Fix:** Call `wg.Add(len(cs))` once before any `go` statement.

---

## Bug 5: Send without ctx awareness

```go
func mergeBad5(ctx context.Context, cs ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        c := c
        go func() {
            defer wg.Done()
            for v := range c {
                out <- v // BLOCKS on slow consumer
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Bug:** The forwarders send on `out` without selecting on `<-ctx.Done()`. If the consumer is slow or stopped, forwarders block forever.

**Failure:** Goroutine leak. After `cancel()`, forwarders do not exit.

**Fix:**

```go
for v := range c {
    select {
    case out <- v:
    case <-ctx.Done():
        return
    }
}
```

---

## Bug 6: Producer closes the wrong channel

```go
func produce(in <-chan int, out chan<- int) {
    for v := range in {
        out <- v * 2
    }
    close(in) // wrong
}
```

**Bug:** The producer reads from `in` but tries to close it. `in` is owned by whoever created it (upstream); the producer must not close it.

**Failure:** Panic "send on closed channel" upstream, or panic on the producer's `close` if some other goroutine has already closed `in`.

**Fix:** The producer closes its *output*, not its input:

```go
func produce(in <-chan int, out chan<- int) {
    defer close(out)
    for v := range in {
        out <- v * 2
    }
}
```

---

## Bug 7: Closure issue with goroutine and slice

```go
func processItems(items []int) <-chan int {
    out := make(chan int)
    for i := range items {
        go func() {
            out <- items[i] // captures i
        }()
    }
    return out
}
```

**Bug:** All goroutines share `i` (in Go < 1.22) and read whatever `i` is when they run — usually `len(items)`, causing index out of range.

**Fix:** Pass index as argument:

```go
for i := range items {
    go func(i int) {
        out <- items[i]
    }(i)
}
```

Also: missing wait + close, but that's a separate bug.

---

## Bug 8: Reorder buffer grows unbounded

```go
func reorder(in <-chan Tagged) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        next := 0
        pending := map[int]int{}
        for t := range in {
            pending[t.Seq] = t.Val
            for {
                v, ok := pending[next]
                if !ok {
                    break
                }
                out <- v
                delete(pending, next)
                next++
            }
        }
    }()
    return out
}
```

**Bug:** No bound on `pending`'s size. If one item is permanently lost (e.g., a worker died), `pending` grows forever — all subsequent items wait for the missing seq.

**Failure:** Memory grows; the consumer sees no output after the missing seq.

**Fix:** Cap the pending size; on overflow, log and emit a sentinel for the missing seq:

```go
if len(pending) > maxPending {
    log.Printf("reorder: missing seq %d; skipping", next)
    // mark all up to some point as skipped
    next++
}
```

Or apply backpressure by not reading more from `in`.

---

## Bug 9: Goroutine leak on early break

```go
func consumeFirstN(merged <-chan int, n int) []int {
    var result []int
    for v := range merged {
        result = append(result, v)
        if len(result) == n {
            break
        }
    }
    return result
}
```

**Bug:** After `break`, the upstream producers may still send. If they are not cancellable, they block on `out <- v` and leak.

**Fix:** Combine with cancellation:

```go
func consumeFirstN(ctx context.Context, cancel context.CancelFunc, merged <-chan int, n int) []int {
    var result []int
    for v := range merged {
        result = append(result, v)
        if len(result) == n {
            cancel()
            // drain the rest to let forwarders exit
            for range merged {
            }
            break
        }
    }
    return result
}
```

The drain after cancel lets the forwarders exit. (Or, if every blocking send selects on `ctx.Done`, the forwarders exit without needing drain.)

---

## Bug 10: Missing recover

```go
func worker(in <-chan int, out chan<- int) {
    for v := range in {
        out <- 100 / v // panics on 0
    }
}
```

**Bug:** A divide-by-zero panic kills the program (the panic is in a goroutine and not recovered).

**Failure:** Process exit on input 0.

**Fix:** Recover at the worker boundary:

```go
func worker(in <-chan int, out chan<- int) {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("worker panic: %v", r)
        }
    }()
    for v := range in {
        out <- 100 / v
    }
}
```

Better: validate input and emit a `Result` with error.

---

## Bug 11: Closed channel send race

```go
func produce(out chan<- int, done <-chan struct{}) {
    for i := 0; ; i++ {
        select {
        case out <- i:
        case <-done:
            close(out)
            return
        }
    }
}
```

**Bug:** Two producers running this would both try to close `out`. Even with one producer, if `out` is somehow closed elsewhere, the next send panics.

**Failure:** Panic on double close or send on closed.

**Fix:** Only one party owns `out`. The producer owns and closes. Make sure no other code closes it. Add `sync.Once` if you must:

```go
var once sync.Once
once.Do(func() { close(out) })
```

---

## Bug 12: Pre-emptive select bias

```go
for {
    select {
    case v := <-fast:
        process(v)
    case v := <-slow:
        process(v)
    }
}
```

**Bug:** None per se, but worth noting: when both are ready, Go picks pseudo-randomly. If `fast` has a steady stream and `slow` is also ready, `slow` is starved.

This is intentional fairness. Not a bug. But beware that priorities are not enforced; for that, use the priority merge pattern.

---

## Bug 13: Channel never closes due to nil chan

```go
func consume(in <-chan int) {
    for v := range in {
        process(v)
    }
}

// caller:
var in chan int // nil
consume(in)
```

**Bug:** `in` is `nil`. `for v := range in` blocks forever on the first receive.

**Failure:** consume's goroutine hangs.

**Fix:** Initialize `in := make(chan int)` and ensure the producer sends and closes.

---

## Bug 14: Closing twice from defer

```go
func worker(in <-chan int, out chan<- int) {
    defer close(out)
    for v := range in {
        out <- v
    }
    close(out) // duplicate
}
```

**Bug:** `close(out)` runs once explicitly, then again from the `defer`.

**Failure:** Panic: close of closed channel.

**Fix:** Only one close. The `defer` is preferred:

```go
defer close(out)
for v := range in {
    out <- v
}
```

---

## Bug 15: Race on a shared counter

```go
func pool(in <-chan int) <-chan int {
    out := make(chan int)
    var count int
    var wg sync.WaitGroup
    wg.Add(4)
    for i := 0; i < 4; i++ {
        go func() {
            defer wg.Done()
            for v := range in {
                count++ // race
                out <- v
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Bug:** Four workers concurrently increment `count`. Data race.

**Failure:** Race detector reports it; counter value is wrong.

**Fix:** Use `atomic.AddInt64`:

```go
var count atomic.Int64
// ...
count.Add(1)
```

---

## Bug 16: Forwarder reads from nil channel

```go
func mergeBad6(cs []<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for i := range cs {
        c := cs[i]
        go func() {
            defer wg.Done()
            for v := range c {
                out <- v
            }
        }()
    }
    // ...
}

// caller:
cs := make([]<-chan int, 3) // all elements are nil
out := mergeBad6(cs)
```

**Bug:** Each `c` is nil. `for v := range c` blocks forever (receive from nil channel blocks forever).

**Failure:** All forwarders hang. The closer never runs. The merged output never closes.

**Fix:** Initialise each channel in the caller. Or in the merge, defensively skip nil:

```go
for i := range cs {
    c := cs[i]
    if c == nil {
        wg.Done()
        continue
    }
    go func() { ... }()
}
```

---

## Bug 17: `time.After` leaks in a hot loop

```go
for v := range in {
    select {
    case out <- v:
    case <-time.After(time.Second):
        log.Println("slow")
    }
}
```

**Bug:** Every iteration creates a `time.After` timer goroutine. If the `out <- v` always wins, the timer goroutine still exists until it fires; it does not cancel.

**Failure:** Memory growth; goroutines accumulate.

**Fix:** Use a reusable timer:

```go
t := time.NewTimer(time.Second)
defer t.Stop()
for v := range in {
    if !t.Stop() {
        select { case <-t.C: default: }
    }
    t.Reset(time.Second)
    select {
    case out <- v:
    case <-t.C:
        log.Println("slow")
    }
}
```

---

## Bug 18: Worker exits but its in-flight item is lost

```go
func worker(ctx context.Context, in <-chan Item, out chan<- Result) {
    for v := range in {
        select {
        case <-ctx.Done():
            return
        default:
        }
        result := process(v)
        select {
        case out <- result:
        case <-ctx.Done():
            return
        }
    }
}
```

**Bug:** When `ctx` is cancelled mid-processing, the worker returns without sending the result. The item was consumed from `in` and produced no output.

**Failure:** Item silently dropped. The consumer count differs from the producer count.

**Fix:** Handle the in-flight item:

```go
result := process(v)
select {
case out <- result:
case <-ctx.Done():
    // log or DLQ the lost item
    log.Printf("lost item: %v", v)
    return
}
```

Or, accept the loss and document it.

---

## Bug 19: Slow consumer causes drop (anti-pattern)

```go
for v := range in {
    select {
    case out <- v:
    default:
        // dropped
    }
}
```

**Bug:** This silently drops values when `out` is not ready. Whether this is a bug depends on intent. If you intended backpressure, this is a bug. If you intended best-effort delivery, this is correct.

**Fix:** For backpressure, block:

```go
for v := range in {
    out <- v
}
```

Or with ctx:

```go
for v := range in {
    select {
    case out <- v:
    case <-ctx.Done():
        return
    }
}
```

---

## Bug 20: Producer panics; merge hangs

```go
func produce() <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < 100; i++ {
            if i == 50 {
                panic("oops")
            }
            out <- i
        }
    }()
    return out
}
```

**Bug:** The producer panics. The unrecovered panic kills the entire program.

Actually wait — if it's a top-level program, yes. Within a tested function, the test fails.

**Failure:** Program exit.

**Fix:** Recover and propagate:

```go
go func() {
    defer close(out)
    defer func() {
        if r := recover(); r != nil {
            log.Printf("producer panic: %v", r)
            // optionally: send a sentinel to out
        }
    }()
    for i := 0; i < 100; i++ {
        // ...
    }
}()
```

---

## More Bugs to Try

For practice, here are descriptions only; write the buggy code and fix it yourself:

- **Bug 21:** A pipeline that uses `for v := range merged` but the merged channel is buffered, and the producer closes after sending; the consumer reads the buffer but then `for range` exits. Verify the count.
- **Bug 22:** A worker that holds a `sync.Mutex` for the duration of its for-loop, blocking other workers.
- **Bug 23:** Two goroutines reading from one channel; one expects ordered values, the other gets the rest, but ordering matters for application logic.
- **Bug 24:** A merge function where the closer accidentally closes the wrong channel (a copy of `out` from a different scope).
- **Bug 25:** A pipeline using `errgroup.WithContext` but the workers ignore the derived ctx and use the outer ctx.

---

## Lessons from These Bugs

The recurring themes:

1. **Channel ownership.** Confusion about who closes leads to many bugs.
2. **Loop variable capture.** Pre-Go 1.22 trap; still common.
3. **Missing cancellation.** Blocking sends without `<-ctx.Done()` leak.
4. **WaitGroup misuse.** Add inside the goroutine; close before all done.
5. **Panics in goroutines.** Unrecovered, they kill the program.
6. **Buffer hides backpressure.** Large buffers cause memory growth.
7. **Race conditions.** Shared mutable state without sync.

Internalise these. Most production bugs in fan-out / fan-in are variants of the above.

---

## Test Your Fixes

For each bug:

1. Write the buggy code.
2. Write a test that exhibits the failure.
3. Run with `-race` and `goleak.VerifyNone(t)`.
4. Confirm the test fails.
5. Apply the fix.
6. Confirm the test passes.

The discipline of test-first ensures your fix actually addresses the bug.

---

## Final Note

Production fan-out / fan-in code has many failure modes. The patterns in this file cover the most common. Real codebases have novel bugs at the intersection of these patterns. Pattern recognition speeds diagnosis; rigorous testing prevents recurrence.

Good luck.

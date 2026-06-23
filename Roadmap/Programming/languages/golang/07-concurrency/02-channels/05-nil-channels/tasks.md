# Nil Channels — Hands-On Tasks

> Exercises that build muscle memory around nil channels. Start with Task 1 and move sequentially; later tasks build on earlier ones. Each task has clear acceptance criteria. Reference solutions appear at the end.

---

## Task 1 — Observe nil-channel deadlock (Easy)

**Goal.** Reproduce the "all goroutines are asleep" message.

Write a program that declares an uninitialised channel of type `chan int` and immediately attempts to receive from it. Run it. Observe the runtime's deadlock message.

**Acceptance criteria.**

- The program is a single `main.go` with no other files.
- Running `go run main.go` prints `fatal error: all goroutines are asleep - deadlock!` and a stack trace.
- The stack trace mentions `chan receive (nil chan)`.

---

## Task 2 — Catch close-on-nil (Easy)

**Goal.** Demonstrate `close(nil)` and recover from the panic.

Write a function `safeClose(ch chan int) (ok bool)` that returns `true` if the close succeeds and `false` if a panic was caught. Test it with both a nil channel and a real channel.

**Acceptance criteria.**

- `safeClose(nil)` returns `false`.
- `safeClose(make(chan int))` returns `true`.
- The function uses `defer` + `recover` only — no `if ch != nil` shortcut.

---

## Task 3 — Implement the off-switch pattern (Easy)

**Goal.** Use nil-channel disabling to fire a one-shot event without repeating.

Write a `for { select { ... } }` loop that:

- Has a `once` channel with one buffered value.
- Has a `tick` channel firing every 100ms.
- Has a `timeout` after 500ms.

After receiving from `once`, set `once = nil` so it does not fire again. The loop should exit on timeout.

**Acceptance criteria.**

- Program runs to completion in ~500ms.
- The `once` value is printed exactly once.
- The `tick` value is printed multiple times.
- The exit happens via the timeout case.

---

## Task 4 — Drain-then-disable on close (Medium)

**Goal.** Implement a consumer that drains a closed channel, then disables the case but continues on other cases.

Two channels: `data chan int` (closed externally after sending 5 values) and `heartbeat chan struct{}` (ticks every 50ms).

Your consumer should:

- Receive and print each value from `data`.
- When `data` closes (received `ok=false`), set `data = nil`.
- Continue the loop on `heartbeat` for one more second after `data` is nilled.
- Exit cleanly.

**Acceptance criteria.**

- All 5 values from `data` are printed.
- At least 10 heartbeats are printed (~1 second of heartbeats after drain).
- No goroutine leak (verify with `runtime.NumGoroutine` before/after).

---

## Task 5 — Pause/resume periodic emitter (Medium)

**Goal.** Implement a periodic emitter with pause/resume controls.

A goroutine emits "tick" every 100ms. A `control` channel of strings ("pause" / "resume") changes its state. Use nil-channel toggling on the local `tickCh` variable to disable emission during pause.

Test with this control sequence:

1. Run for 300ms (emit 3 times).
2. Send "pause", run for 300ms (emit 0 times).
3. Send "resume", run for 300ms (emit 3 times).
4. Send "pause" then exit.

**Acceptance criteria.**

- Exactly 6 ticks emitted across the full sequence (3 + 0 + 3).
- The goroutine exits cleanly within 100ms of receiving the final pause-then-cancel.
- The ticker is properly stopped with `ticker.Stop()`.

---

## Task 6 — Backpressure with conditional send (Medium)

**Goal.** Implement a buffer-aware pipeline stage.

The stage receives `Item` values, transforms them, and forwards them. It uses an internal buffer of up to 5 items. When the buffer is full, the input case is disabled (set to nil). When the buffer is empty, the output case is disabled.

**Acceptance criteria.**

- The stage handles a producer that sends 20 items rapidly.
- A slow consumer (50ms per item) does not lose any items.
- The producer does not block beyond the buffer capacity.
- Use nil-channel toggling, not flags.

---

## Task 7 — Two-source fan-in with independent shutdown (Medium)

**Goal.** Merge two input channels into one output. When each input closes, disable it. When both are closed, close the output.

Signature:

```go
func fanIn(ctx context.Context, a, b <-chan int) <-chan int
```

**Acceptance criteria.**

- All values from both inputs appear in the output (order-independent).
- Closing `a` first does not disrupt receipt of `b`'s remaining values.
- Closing both inputs results in the output being closed.
- Cancellation via context cleanly exits.
- No goroutine leak.

---

## Task 8 — Three-state crawler (Hard)

**Goal.** Implement a crawler with three states (idle, crawling, throttled) that uses nil-channel disabling to gate behaviour.

States:

- **Idle:** does not accept fetch requests, does not emit results.
- **Crawling:** accepts fetch requests, emits results.
- **Throttled:** does not accept fetch requests, but emits already-pending results.

The crawler has channels: `fetch chan URL` (input), `result chan Result` (output), `ctrl chan string` (control). Internal worker goroutines process URLs; their results buffer internally.

**Acceptance criteria.**

- In Idle, sending on `fetch` blocks (because the case is disabled).
- In Crawling, fetches are processed.
- In Throttled, new fetches are not accepted but pending results emit.
- State transitions via `ctrl` are immediate (within one `select` iteration).
- All goroutines exit cleanly on cancellation.

---

## Task 9 — Closure-capture pitfall (Hard)

**Goal.** Write a program that demonstrates the closure-capture bug with nil channels.

Set up: a function that creates a channel, spawns a goroutine that sends to it via closure capture, then sets the variable to nil. Show that the goroutine ends up blocked on a nil channel (verify via pprof or `runtime.Stack`).

Then write a corrected version using argument passing.

**Acceptance criteria.**

- The buggy version leaks a goroutine. Verify by checking `runtime.NumGoroutine` and dumping the goroutine stack.
- The corrected version does not leak.
- Comments explain *why* the closure version leaks.

---

## Task 10 — Reflect-Select dynamic fan-in (Hard)

**Goal.** Use `reflect.Select` to merge N input channels (N decided at runtime).

Signature:

```go
func MergeN[T any](ctx context.Context, ins []<-chan T) <-chan T
```

Each input may close independently. When it closes, disable its case by setting `cases[i].Chan = reflect.Value{}`. Exit when all data cases are disabled or on cancellation.

**Acceptance criteria.**

- Works for N = 1, 2, 10, 100.
- All values from all inputs appear in the output.
- Cancellation cleanly stops.
- Pre-allocate the `cases` slice; do not re-allocate on each iteration.

---

## Task 11 — Hot-swappable upstream (Hard)

**Goal.** A pipeline stage whose input source can be swapped at runtime.

The stage has a control channel that delivers new input channels: `control chan <-chan Item`. The stage's main loop reads from the current input channel; when a new channel arrives on `control`, the stage switches to it. The old channel may continue to exist (the producer might still be writing to it) but the stage no longer reads from it.

If the control channel delivers nil, the stage's input becomes nil (no input).

**Acceptance criteria.**

- The stage processes items from the current input.
- Switching inputs via `control` works without losing items mid-flight (define the contract: any item received but not yet forwarded is forwarded before switching).
- A nil input via control disables input but keeps the stage alive on cancellation.
- Cancellation cleanly exits.

---

## Task 12 — Leak detector test (Medium)

**Goal.** Write a unit test that catches a nil-channel goroutine leak.

Set up a function `BuggyServer` that has a nil-channel bug (your choice — pick from this file's examples). Write a test using `go.uber.org/goleak` that:

1. Runs `BuggyServer`.
2. Cancels it.
3. Asserts via `goleak.VerifyNone(t)` that no goroutines remain.

The test should fail.

Then fix the bug. The same test should pass.

**Acceptance criteria.**

- The test, with the buggy implementation, reports a goroutine leak.
- The goleak output mentions `chan ... (nil chan)`.
- After fixing, the test passes.

---

## Task 13 — Production-grade observability (Hard)

**Goal.** Build a small service that exposes nil-channel metrics.

Requirements:

- A function that periodically (every 5s) scans goroutine stacks via `runtime.Stack`, counts goroutines with wait reasons containing "nil chan", and exposes the count as a Prometheus counter (or just `fmt.Println`).
- A toy bug: a handler that intermittently leaks one nil-channel goroutine.
- Demonstrate that under load, the counter rises over time.

**Acceptance criteria.**

- The scanner correctly identifies `nil chan` waits.
- Under repeated handler invocation, the counter increases.
- Code is structured for production: errors logged, no panics in the scanner.

---

## Task 14 — Reflect-Select benchmark (Hard)

**Goal.** Measure the cost of `reflect.Select` vs static `select`.

Benchmark two implementations:

1. A static `select` with 4 cases.
2. A `reflect.Select` with 4 pre-built cases.

Both forward values from inputs to an output. Measure throughput in values/second.

**Acceptance criteria.**

- Reproducible benchmark using `go test -bench`.
- Report shows the static select is significantly faster (typically 10-100x).
- Documentation explains the result.

---

## Task 15 — Refactor flag-based to nil-based (Medium)

**Goal.** Given a flag-based `select` loop, refactor it to use nil-channel disabling.

Starting code:

```go
func consume(in <-chan Job, ctx context.Context) error {
    var done bool
    for !done || hasPendingWork() {
        select {
        case job, ok := <-in:
            if !ok {
                done = true
                continue
            }
            handle(job)
        case <-time.After(time.Second):
            if done && !hasPendingWork() {
                return nil
            }
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return nil
}
```

Refactor to use nil-channel disabling instead of the `done` boolean.

**Acceptance criteria.**

- Behaviour preserved: drain all available items, exit on cancellation or after grace period.
- The `done` boolean is removed.
- The closed-channel busy-loop bug is avoided (verified by checking that closing `in` does not cause CPU spike).

---

## Solutions Sketch

### Solution 1

```go
package main

func main() {
    var ch chan int
    <-ch
}
```

### Solution 2

```go
func safeClose(ch chan int) (ok bool) {
    defer func() {
        if r := recover(); r != nil {
            ok = false
        }
    }()
    close(ch)
    return true
}
```

### Solution 3

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    once := make(chan int, 1)
    once <- 42
    tick := time.NewTicker(100 * time.Millisecond)
    defer tick.Stop()
    timeout := time.After(500 * time.Millisecond)

    for {
        select {
        case v := <-once:
            fmt.Println("once:", v)
            once = nil
        case t := <-tick.C:
            fmt.Println("tick:", t.UnixMilli())
        case <-timeout:
            return
        }
    }
}
```

### Solution 4

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    data := make(chan int, 5)
    for i := 1; i <= 5; i++ {
        data <- i
    }
    close(data)

    heartbeat := time.NewTicker(50 * time.Millisecond)
    defer heartbeat.Stop()
    cutoff := time.After(time.Second)

    for {
        select {
        case v, ok := <-data:
            if !ok {
                data = nil
                continue
            }
            fmt.Println("data:", v)
        case <-heartbeat.C:
            fmt.Println("heartbeat")
        case <-cutoff:
            return
        }
    }
}
```

### Solution 5

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func emitter(ctx context.Context, control <-chan string) {
    ticker := time.NewTicker(100 * time.Millisecond)
    defer ticker.Stop()
    tickCh := ticker.C

    for {
        select {
        case <-tickCh:
            fmt.Println("tick")
        case cmd := <-control:
            switch cmd {
            case "pause":
                tickCh = nil
            case "resume":
                tickCh = ticker.C
            }
        case <-ctx.Done():
            return
        }
    }
}
```

### Solution 6

```go
type Item struct{ V int }

func stage(ctx context.Context, in <-chan Item, out chan<- Item) {
    defer close(out)
    const maxBuf = 5
    buf := []Item{}

    for {
        var inCh <-chan Item
        var outCh chan<- Item
        var head Item

        if len(buf) < maxBuf {
            inCh = in
        }
        if len(buf) > 0 {
            outCh = out
            head = buf[0]
        }

        select {
        case v, ok := <-inCh:
            if !ok {
                in = nil
                inCh = nil
                if len(buf) == 0 {
                    return
                }
                continue
            }
            buf = append(buf, transform(v))
        case outCh <- head:
            buf = buf[1:]
        case <-ctx.Done():
            return
        }
    }
}
```

### Solution 7

```go
func fanIn(ctx context.Context, a, b <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        alive := 2
        for alive > 0 {
            select {
            case v, ok := <-a:
                if !ok { a = nil; alive--; continue }
                select { case out <- v: case <-ctx.Done(): return }
            case v, ok := <-b:
                if !ok { b = nil; alive--; continue }
                select { case out <- v: case <-ctx.Done(): return }
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

### Solution 10 (sketch)

```go
func MergeN[T any](ctx context.Context, ins []<-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        cases := make([]reflect.SelectCase, len(ins)+1)
        for i, in := range ins {
            cases[i] = reflect.SelectCase{Dir: reflect.SelectRecv, Chan: reflect.ValueOf(in)}
        }
        cases[len(ins)] = reflect.SelectCase{Dir: reflect.SelectRecv, Chan: reflect.ValueOf(ctx.Done())}

        alive := len(ins)
        for alive > 0 {
            chosen, val, ok := reflect.Select(cases)
            if chosen == len(ins) {
                return
            }
            if !ok {
                cases[chosen].Chan = reflect.Value{}
                alive--
                continue
            }
            select {
            case out <- val.Interface().(T):
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

### Solution 15

```go
func consume(in <-chan Job, ctx context.Context) error {
    grace := time.After(time.Second)
    for in != nil || hasPendingWork() {
        select {
        case job, ok := <-in:
            if !ok {
                in = nil
                continue
            }
            handle(job)
        case <-grace:
            if !hasPendingWork() {
                return nil
            }
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return nil
}
```

The loop condition uses `in != nil` as the natural exit signal: once `in` is nil and there is no pending work, the loop exits without needing a `done` flag.

---

## Wrap-up

These tasks rehearse the patterns from junior, middle, and senior levels:

- Direct nil-channel behaviour (Tasks 1, 2).
- Off-switch and drain-then-disable (Tasks 3, 4, 5).
- Backpressure and conditional sends (Task 6).
- Multi-source coordination (Tasks 7, 10, 11).
- State machines (Task 8).
- Bug hunting and leak detection (Tasks 9, 12, 13).
- Performance and refactoring (Tasks 14, 15).

After completing them you should be able to write any nil-channel-disabled `select`-loop from scratch, recognise the same shape in others' code, and diagnose leaks in production.

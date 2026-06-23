# Nil Channels — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What is a nil channel? Why does the program hang? When would I ever want one on purpose?"

A **nil channel** is the zero value of any channel type. You produce one any time you write:

```go
var ch chan int
```

`ch` is now a perfectly valid Go value of type `chan int`. It is *not* a runtime error, it is *not* a compile error, and the compiler is perfectly happy to let you send to it, receive from it, or pass it to a function. The trap is what happens at runtime: any send or receive on a nil channel **blocks the calling goroutine forever**, and any attempt to `close` a nil channel **panics**.

Most newcomers meet nil channels by accident. You declare a channel, forget to call `make`, send a value, and your program hangs. After enough of those, you learn to always initialise channels with `make(chan T)` or `make(chan T, N)` — and you would be forgiven for assuming nil channels are just a bug source to be avoided.

They are not. Nil channels are a deliberately useful tool. The Go runtime treats them as a *permanent block* on `select` cases, which means you can disable a branch of a `select` simply by setting its channel to `nil`. The case never fires, the `select` keeps multiplexing the remaining live channels, and you avoid the contortions of duplicating `select` blocks or carrying boolean flags.

After reading this file you will:

- Know what a nil channel is and how to create one (on purpose or by accident)
- Understand exactly what `send`, `receive`, and `close` do to a nil channel
- Understand how `select` treats a nil channel and why that is useful
- Recognise the "disable this case" pattern (the *off switch* idiom)
- Distinguish a nil channel from a closed channel — a confusion that bites everyone
- Know the bugs that come from accidentally-nil channels and how to spot them

You do not need to know the runtime internals (`chansend`, `chanrecv`, `gopark`) at this level. Those come at the professional level. This file is about the practical behaviour you can observe, predict, and use.

---

## Prerequisites

- **Required:** A working Go installation (1.18 or newer, 1.21+ recommended). Check with `go version`.
- **Required:** Familiarity with basic channel operations — `make(chan T)`, `ch <- v`, `<-ch`, and `close(ch)`. If `01-buffered-vs-unbuffered/junior.md` is unfamiliar, read it first.
- **Required:** Familiarity with `select` statements. Read `02-select-statement/junior.md` if `select { case ... }` is unfamiliar.
- **Helpful:** Comfort with goroutines and `sync.WaitGroup` — covered in the goroutines section.
- **Helpful:** Have written or debugged a "stuck program" before. Nil-channel bugs look exactly like other deadlocks.

If you can write a producer/consumer pair with `make(chan int)`, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Nil channel** | A channel-typed variable whose value is `nil`. The zero value of any channel type. Produced by `var ch chan T`, by assigning `nil`, or by declaring a struct field of channel type. |
| **Initialised channel** | A channel created via `make(chan T)` or `make(chan T, N)`. Backed by an `hchan` struct in the runtime. |
| **Closed channel** | An initialised channel on which `close` has been called. Different from nil — you can still receive from a closed channel (it yields the zero value immediately). |
| **Blocking forever** | The goroutine is parked by the runtime with no way to be woken. It contributes to goroutine count but consumes no CPU. Indistinguishable from a permanent leak. |
| **`select` statement** | The mechanism for waiting on multiple channel operations at once. When a case's channel is nil, that case is treated as if it cannot proceed and is skipped. |
| **Off switch pattern** | The idiomatic use of nil channels: setting a channel variable to `nil` inside a `select`-loop to *remove* its case from selection until you reassign it. |
| **`chansend` / `chanrecv`** | Runtime functions that implement send/receive. Both have an explicit `if c == nil` branch that parks the calling goroutine forever via `gopark(waitReasonChanSendNilChan)` or `waitReasonChanReceiveNilChan`. |
| **Goroutine leak** | A goroutine that will never make progress. A receive on a nil channel produces one of these unless intentional. |
| **Zero value** | The default value Go assigns to any variable that is not explicitly initialised. For channel types, the zero value is `nil`. |

---

## Core Concepts

### A channel variable's zero value is nil

When you declare a channel without calling `make`, you get nil:

```go
var ch chan int   // ch == nil
fmt.Println(ch == nil) // true
```

This is the same rule that gives you `nil` slices, `nil` maps, and `nil` pointers. The compiler does not require you to initialise. But unlike a `nil` slice (which you can `append` to) or a `nil` map (which panics on writes but returns the zero value on reads), a nil channel has the unique property of **blocking forever** on every operation except `close`, which **panics**.

### Send on nil: blocks forever

```go
var ch chan int
ch <- 42  // blocks this goroutine forever
```

The runtime parks the calling goroutine with the wait reason `chan send (nil chan)`. The goroutine never wakes — there is nothing to wake it. It remains in the goroutine count, consumes no CPU, but holds onto its stack and any captured references.

If this is the main goroutine and there are no other runnable goroutines, the Go runtime detects the deadlock and prints:

```
fatal error: all goroutines are asleep - deadlock!
```

If there *are* other runnable goroutines (e.g., this is a background goroutine and `main` is doing other work), no deadlock is reported. The send simply leaks the goroutine quietly.

### Receive on nil: blocks forever

```go
var ch chan int
v := <-ch  // blocks this goroutine forever
```

Same mechanism, different wait reason: `chan receive (nil chan)`. The goroutine is parked and never wakes. Like the send case, this either produces a "deadlock" fatal error (if everyone is parked) or silently leaks (if other work continues).

### Close on nil: panics

```go
var ch chan int
close(ch)  // panic: close of nil channel
```

Unlike send and receive, which block, `close` on a nil channel triggers an immediate `runtime error: close of nil channel`. This is also the third member of the "channel close panics" club:

- Close a nil channel → panic
- Close an already-closed channel → panic
- Send on a closed channel → panic

(Receive on a closed channel does not panic — it returns the zero value, `ok==false`.)

### `select` with a nil case: the case is dormant

This is where nil channels become useful. Inside a `select` statement, a case whose channel is nil is **not selectable**. The runtime evaluates each case's readiness; a nil channel reports "not ready" forever. Crucially, the other cases continue to be considered:

```go
var dead chan int
live := make(chan int, 1)
live <- 7

select {
case v := <-dead:  // never fires
    fmt.Println("from dead:", v)
case v := <-live:  // fires
    fmt.Println("from live:", v)
}
```

Output: `from live: 7`. The case on `dead` is skipped exactly as if it were not in the `select` at all.

The trick: you can flip a case on and off at runtime by assigning the channel variable to nil (to disable it) or to a real channel (to re-enable it). Restructuring around this avoids the alternative of writing two different `select` blocks for "feature on" and "feature off" states.

### A nil channel is not a closed channel

Beginners often think "I set the channel to nil, that's the same as closing." It is not.

| Operation | Nil channel | Closed channel |
|---|---|---|
| Send | Blocks forever | Panics |
| Receive | Blocks forever | Returns zero value, `ok==false`, immediately |
| Close | Panics | Panics |
| In `select` send case | Case never fires | Case fires (and panics if selected) |
| In `select` receive case | Case never fires | Case fires immediately with zero value |

A closed channel is "always ready to receive." A nil channel is "never ready for anything." Opposite ends of the spectrum. Choosing wrongly turns a quiet idle loop into a busy spin or a permanent stall.

### `nil` is not "magic" — it is the absence of an `hchan`

Under the hood, a channel value is a pointer to a runtime struct called `hchan`. When you write `make(chan int, 10)`, the runtime allocates an `hchan`, sets up its buffer, mutex, and waiter queues, and returns the pointer. When you write `var ch chan int`, the pointer is `nil`. Every channel operation (`send`, `receive`, `close`) first checks "is this `hchan` nil?" — and that check is the entry point to the special behaviour. There is no separate "nil channel type"; nil is the same channel type with no backing struct.

---

## Real-World Analogies

### A telephone with no line plugged in

You can pick up the handset and shout "hello?" forever — no one will answer, because the cord is not connected. That is a nil channel: the variable exists, the receiver/sender mechanism *thinks* it is doing work, but nothing is wired up and nothing will ever happen.

### A "do not call this number" sign

Inside a `select`, a nil channel is the equivalent of a phone number scratched out on a contact list. The dispatcher (the `select` runtime) sees it in the list but knows it cannot dial it, so it moves on. Other valid numbers still get called. You can re-instate the number any time by writing it back in.

### A door that cannot be opened, locked, or unlocked

A nil channel resists every operation except panic-on-close. It is not "closed" (closed doors can still be locked or unlocked), it is "absent." There is no door at all; the variable just *says* there is one.

### A radio tuned to a frequency that does not exist

If you tune a radio to a frequency no station transmits on, you hear silence forever. That is receive-on-nil. Send-on-nil is the same: you shout into a microphone whose cable is not plugged into any transmitter. The sound vanishes; nothing carries it.

---

## Mental Models

### Model 1: "Nil channel = permanent block"

The single mental model that covers everything is: *a nil channel is permanently not-ready for both send and receive*. Once you internalise this, every behaviour follows:

- A goroutine sending or receiving on it is parked forever.
- A `select` skips the case.
- `close` panics because there is nothing to close.

You do not need to memorise three rules. There is one rule with three projections.

### Model 2: "Nil is the off position of a select case"

Inside a `for { select { ... } }` loop, each case is a switch you can toggle. `case <-ch` is on when `ch` is a real channel, off when `ch` is nil. To turn it off: `ch = nil`. To turn it on: `ch = realCh`. This works because the `select` evaluates the channel expression every iteration; the runtime's nil-check is rechecked each time.

### Model 3: "Send-on-nil = goroutine in a black hole"

Outside `select`, a send or receive on a nil channel is a one-way ticket. The goroutine that does it is gone — visible in `runtime.NumGoroutine()`, but unable to make any progress. Treat any send or receive on a nil channel outside of `select` as a bug until proven otherwise.

### Model 4: "Closed channel and nil channel are opposites"

When you want a case to always fire (e.g., "shutdown signal received"), close the channel. When you want a case to never fire (e.g., "disable this branch"), set it to nil. They are dual to each other. Mixing them up — closing when you meant nil, or vice versa — is a common bug source.

### Model 5: "The runtime treats nil with the same priority as a real check"

The performance cost of a nil channel case in `select` is essentially the same as a real check. The runtime sees `nil` and skips quickly. So there is no efficiency reason to omit a `select` case you currently want disabled — just set it to nil. The compiler does *not* optimise the case away; the check still happens at runtime, but it is one branch.

---

## Pros & Cons

### Pros

- **Clean state-machine pattern.** `select`-loops that need to disable branches dynamically (e.g., "stop reading input once we received EOF") become much simpler with nil-channel assignment than with boolean flags.
- **No restructuring.** You do not need to split a `for { select { ... } }` loop into two variants for "input still live" vs "input closed."
- **Zero overhead beyond the `select` itself.** The runtime's nil check is cheap.
- **Composable with the closed-channel pattern.** When a producer closes its output channel, the consumer can drain remaining values and then set the receive variable to nil to disable that case while keeping other cases (timer, cancellation) live.
- **Self-documenting.** `case <-doneCh` with `doneCh = nil` makes the intent visible: "no longer interested."
- **Built into the language.** No extra library or flag system needed. The behaviour is part of the runtime.

### Cons

- **Easy to leak.** A send or receive on a nil channel outside `select` is silent and permanent. Goroutines pile up in production with no panic, no log line.
- **Confusing semantics for beginners.** "Sending to nothing" intuitively feels like a no-op or a panic — but it is "block forever," which is much harder to debug than either.
- **Close-on-nil panics in production.** A `defer close(ch)` where `ch` happens to be nil at defer time crashes the whole program.
- **`select` behaviour is non-obvious.** A case that is silently disabled is not visible in the source code unless you trace the channel variable's mutations.
- **Tests that pass by accident.** A test that "expects" a goroutine to send may pass because the send-on-nil silently blocks, while in production the channel is real and the value arrives. The bug only surfaces under load.
- **No type-system warning.** The compiler permits any send or receive on a nil channel. There is no `non-nil chan` type.

---

## Use Cases

| Scenario | Why nil channels help |
|---|---|
| Pipeline stage that drains its upstream when the upstream closes | After draining, set the receive variable to nil so the case stops firing; the loop continues on the other cases (timer, output, cancellation). |
| Periodic producer that should stop emitting after a "pause" signal | Maintain two channels: `tickCh` (the time.Ticker) and `pauseCh`; when paused, set `tickCh = nil` to disable emit. Resume by reassigning the real ticker. |
| Fan-in with dynamic subscription | Each subscriber is a channel; remove a subscriber by setting its entry to nil rather than rebuilding the `select`. |
| State machine where input is gated on internal state | When the state is "saturated," set the input channel to nil; when ready again, restore. Backpressure without buffering. |
| Shutdown coordination | Cancellation channel stays live; data channels become nil one by one as workers finish. |
| Single-fire emit followed by silence | Send one value, then set the send variable to nil so the case never fires again. |

| Scenario | Why nil channels do *not* help |
|---|---|
| Simple producer/consumer | Just close the channel when done. Nil adds nothing. |
| Replacing `close` for shutdown | `nil` blocks, `close` notifies. They are not interchangeable. |
| Avoiding panic on `close` | `close(nil)` panics too. Use `sync.Once` or careful ownership instead. |
| Lazy initialisation | Use `sync.Once` or check-then-make in a constructor. A `nil` field is a footgun, not a feature. |

---

## Code Examples

### Example 1: Send on nil hangs the program

```go
package main

func main() {
    var ch chan int
    ch <- 1
}
```

Output:

```
fatal error: all goroutines are asleep - deadlock!
```

The main goroutine is the only one, and it is parked on a nil send. The runtime sees no runnable goroutines and aborts.

### Example 2: Receive on nil hangs the program

```go
package main

func main() {
    var ch chan int
    <-ch
}
```

Same outcome: deadlock fatal error. The receive blocks the main goroutine, the runtime detects no progress is possible.

### Example 3: Close on nil panics

```go
package main

func main() {
    var ch chan int
    close(ch)
}
```

Output:

```
panic: close of nil channel
```

Unlike send/receive, this is immediate — no parking, no deadlock detector. A direct `runtime.panic` with a clear message.

### Example 4: Send on nil from a background goroutine — silent leak

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    var ch chan int
    go func() {
        ch <- 1 // blocks forever
    }()
    time.Sleep(100 * time.Millisecond)
    fmt.Println("goroutines:", runtime.NumGoroutine())
}
```

Output:

```
goroutines: 2
```

No deadlock fatal — the main goroutine is doing work. The background goroutine is parked forever. The runtime sees only the main goroutine is "active enough" and does not trigger the all-asleep check.

### Example 5: A nil case in `select` is skipped

```go
package main

import "fmt"

func main() {
    var dead chan int
    live := make(chan int, 1)
    live <- 42

    select {
    case v := <-dead:
        fmt.Println("from dead:", v)
    case v := <-live:
        fmt.Println("from live:", v)
    }
}
```

Output: `from live: 42`. The dead case is never selectable.

### Example 6: All-nil select with a default fires the default

```go
package main

import "fmt"

func main() {
    var a, b chan int
    select {
    case <-a:
        fmt.Println("a")
    case <-b:
        fmt.Println("b")
    default:
        fmt.Println("none ready")
    }
}
```

Output: `none ready`. A `default` case fires immediately if no other case is ready. With all nil channels, nothing else can ever be ready, so `default` always wins.

### Example 7: All-nil select with no default hangs

```go
package main

func main() {
    var a, b chan int
    select {
    case <-a:
    case <-b:
    }
}
```

Output: `fatal error: all goroutines are asleep - deadlock!`. No case can fire, no default, no other goroutines — deadlock.

### Example 8: The off-switch pattern — disable a case after first fire

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    once := make(chan int, 1)
    once <- 99
    tick := time.NewTicker(200 * time.Millisecond)
    defer tick.Stop()

    timeout := time.After(700 * time.Millisecond)

    for {
        select {
        case v := <-once:
            fmt.Println("once:", v)
            once = nil // disable this case from now on
        case t := <-tick.C:
            fmt.Println("tick:", t.Format("15:04:05.000"))
        case <-timeout:
            fmt.Println("done")
            return
        }
    }
}
```

`once` fires exactly once. After that, `once = nil` removes it from the `select`. The ticker continues. The pattern would otherwise need a boolean flag and a longer conditional.

### Example 9: Draining and disabling an input channel after close

```go
package main

import "fmt"

func main() {
    in := make(chan int, 3)
    in <- 1
    in <- 2
    in <- 3
    close(in)

    quit := make(chan struct{})
    go func() {
        // simulate a separate stop signal
        for {
            // do nothing — just keep the goroutine alive briefly
        }
    }()
    _ = quit

    for {
        select {
        case v, ok := <-in:
            if !ok {
                fmt.Println("in closed; disabling case")
                in = nil // disable; loop continues but case is dormant
                return   // for demo, exit; in real code you'd keep looping
            }
            fmt.Println("got:", v)
        }
    }
}
```

The classic shape: receive returns `ok==false` when the channel is closed and drained. At that point, set the channel to nil so the case stops firing every iteration. Without this, the closed channel would keep returning `(0, false)` instantly in every `select`, busy-looping.

### Example 10: A nil channel disables a send case too

```go
package main

import "fmt"

func main() {
    var out chan int           // nil
    in := make(chan int, 1)
    in <- 42

    for i := 0; i < 2; i++ {
        select {
        case v := <-in:
            fmt.Println("read:", v)
        case out <- 1:
            fmt.Println("wrote (impossible)")
        }
    }
}
```

The `out <- 1` case never fires because `out` is nil. The loop reads from `in`, prints once, then on the second iteration: only the nil send case is left, so the goroutine parks forever. Deadlock if main is the only goroutine.

The lesson: nil disables both send and receive cases. Useful symmetry, but you must ensure at least one case can still progress.

---

## Coding Patterns

### Pattern 1: One-shot then nil

```go
emitCh := make(chan Event, 1)
emitCh <- firstEvent

for {
    select {
    case v := <-emitCh:
        handle(v)
        emitCh = nil // never fire again
    case <-other:
        // ...
    }
}
```

A clean way to enforce "send exactly one value" without flags.

### Pattern 2: Drain-then-disable on close

```go
for in != nil || timer != nil {
    select {
    case v, ok := <-in:
        if !ok {
            in = nil
            continue
        }
        forward(v)
    case <-timer.C:
        timer = nil // or .Stop() and nil
        cleanup()
    }
}
```

A loop that gradually shuts down. As each source ends, its variable is set to nil; the loop continues until every source is nil, then exits via the outer condition.

### Pattern 3: Conditional output

```go
var out chan Result
buffer := []Result{}

for {
    var head Result
    if len(buffer) > 0 {
        head = buffer[0]
        out = realOutCh
    } else {
        out = nil
    }

    select {
    case in := <-input:
        buffer = append(buffer, transform(in))
    case out <- head:
        buffer = buffer[1:]
    }
}
```

Backpressure pattern: emit only when the buffer has content. When the buffer is empty, `out = nil` disables the send case and the `select` only reads input. The runtime never tries to send on nil — no spin, no busy-wait.

### Pattern 4: Cancellable periodic emit

```go
ticker := time.NewTicker(time.Second)
defer ticker.Stop()
tickCh := ticker.C // may be nil-ed when paused

for {
    select {
    case <-tickCh:
        emit()
    case cmd := <-control:
        if cmd == "pause" {
            tickCh = nil
        } else if cmd == "resume" {
            tickCh = ticker.C
        }
    case <-quit:
        return
    }
}
```

Pause and resume by toggling `tickCh` between `ticker.C` and `nil`. The ticker itself keeps running underneath; you just stop *listening*.

---

## Clean Code

- **Always make channels before you use them.** A `chan T` field that is supposed to be live should be initialised in a constructor. Document any field that is intentionally allowed to be nil.
- **Reserve nil for `select`.** If you find yourself sending or receiving on a nil channel outside a `select`, you have almost certainly forgotten a `make`.
- **Name the variable as a verb of intent.** `emitCh` (will emit) vs `disabledEmitCh` (currently off) is clearer than reusing one name with mutating semantics.
- **Comment the disabling assignment.** `in = nil // upstream closed; stop selecting on it` makes the intent visible.
- **Never `close(ch)` on a value you might have niled.** Wrap with an explicit guard: `if ch != nil { close(ch) }`.
- **Avoid embedding nil-channel logic deep in conditionals.** Surface the switch — make the assignment visible at the top of the loop body.

---

## Product Use / Feature

| Product feature | How nil channels deliver it |
|---|---|
| Live event stream with pause/resume controls | The data channel goes nil during pause, real during play, and never during stop. |
| Worker that consumes from N inputs and gracefully drops dead ones | Each input variable is nil-ed as its upstream closes; worker exits when all are nil. |
| Rate-controlled emitter | `out` is nil while throttled, real when ready to emit. |
| Multi-stage pipeline with optional stages | A bypass case becomes nil when the stage is enabled, real when bypassed. |
| Auth/feature flag gating | A `case <-priorityCh` is nil for users without the feature, real for premium accounts. No conditional duplicated. |
| Idle detection | After receiving a final value, set the receive variable to nil; remaining cases are timers and shutdown only. |

---

## Error Handling

Nil channels themselves do not generate "errors" in the Go `error` sense — they generate either deadlocks or panics. The error-handling story is therefore preventative:

### 1. Catch close-on-nil with a guard

```go
if ch != nil {
    close(ch)
}
```

Easier than `recover`. Cheaper to read.

### 2. Use `recover` if you must (last resort)

```go
func safeClose(ch chan int) (recovered any) {
    defer func() {
        recovered = recover()
    }()
    close(ch)
    return nil
}
```

This recovers both `close of nil channel` and `close of closed channel`. Use only when you genuinely cannot enforce a single-close invariant. Hides bugs; not idiomatic.

### 3. Detect leaks proactively

Test with the `go.uber.org/goleak` package to verify no goroutines linger after a test. A nil-channel-induced leak shows up as a goroutine parked on `chan send (nil chan)` or `chan receive (nil chan)`.

```go
import "go.uber.org/goleak"

func TestNoLeak(t *testing.T) {
    defer goleak.VerifyNone(t)
    // ... your test code ...
}
```

### 4. Inspect the goroutine stack in production

A live `pprof goroutine?debug=2` dump shows the wait reason. Look for `chan receive (nil chan)` or `chan send (nil chan)` in stack traces — those are nil-channel leaks.

```
goroutine 17 [chan receive (nil chan), 5 minutes]:
main.worker(0x0)
    /app/worker.go:42 +0x35
```

---

## Security Considerations

- **Denial of service via leaked goroutines.** A user-triggered code path that ends in a send or receive on a nil channel leaks one goroutine per request. Sustained traffic exhausts memory. Treat any input-handler that constructs channels carefully — every channel field must be initialised before use.
- **Permanent stalls in critical paths.** If an authentication or authorisation step uses a `select` with a nil-on-failure channel, the goroutine never returns, the request never completes, and the timeout you rely on may not be in scope. Always include a `<-ctx.Done()` case.
- **Hidden quiescence.** A logging or audit pipeline that quietly disables its emit case (via nil) might silently stop recording events. Add a panic or alert when *all* cases of a critical `select` are nil.
- **Resource holds.** Nil-induced leaks hold any heap object captured by the goroutine's stack: large buffers, request bodies, decryption keys. Periodic audits of long-lived goroutines should look for nil-channel waits.

---

## Performance Tips

- **Disabling a `select` case is free.** Setting a channel to nil costs one pointer write. There is no runtime fast-path you bypass by removing a case; the `select` evaluates each case every iteration regardless.
- **Avoid busy loops on closed channels.** A closed receive returns instantly with the zero value every time. In a tight `for { select }` loop, this becomes a busy spin consuming 100% CPU. After drain detection, set the channel to nil.
- **Cap the number of nil cases.** If your `select` has ten cases and nine are nil for long periods, consider whether that loop is the right structure. Sometimes redesign beats over-elaboration.
- **Do not use nil to "save memory."** Setting `ch = nil` does not free anything if other references exist. If the goal is to release the channel, you must drop *all* references.

---

## Best Practices

1. Always initialise channel fields in constructors.
2. Reserve nil-channel usage to `select` cases — never as a primary control signal outside `select`.
3. Comment every assignment of `nil` to a channel variable with intent.
4. Pair `nil`-disabling with at least one *always-live* case (e.g., `ctx.Done()`) so the loop is never trapped on all-nil.
5. Use `defer` carefully with `close` — guard against nil.
6. After draining a closed channel, immediately set the variable to nil to avoid busy-loop on the always-ready case.
7. In multi-stage pipelines, hold a single source of truth for "is this channel live?" — either the variable being non-nil, or a separate flag — but not both.
8. Run tests with `go test -race` and `goleak` to surface nil-induced leaks.
9. Prefer `context.Context` cancellation over hand-rolled nil-toggling when the use case is "stop everything."
10. Document any function that returns a channel about whether the returned channel can ever be nil.

---

## Edge Cases & Pitfalls

### Forgetting to call `make`

```go
type Server struct {
    events chan Event
}

func (s *Server) Run() {
    s.events <- Event{} // blocks forever
}
```

Fix:

```go
func NewServer() *Server {
    return &Server{events: make(chan Event, 16)}
}
```

The most common nil-channel bug. Always construct via a function that initialises every field.

### A function that returns a nil channel by mistake

```go
func dataStream() chan int {
    var out chan int // forgot make!
    go func() {
        for i := 0; i < 10; i++ {
            out <- i // blocks forever
        }
    }()
    return out
}
```

Caller receives a nil channel, hangs on every receive. Hard to spot because the type signature looks right.

### Closing a struct field that was never initialised

```go
type Pipeline struct {
    out chan int
}

func (p *Pipeline) Shutdown() {
    close(p.out) // panics if out is nil
}
```

Fix: initialise in constructor, or guard with `if p.out != nil`.

### Re-assigning a channel to nil while a goroutine still references it

```go
ch := make(chan int)
ch = nil
go func() {
    ch <- 1 // BUG: but ch in the goroutine's closure was captured before nil
}()
```

Closures capture by reference. The goroutine sees the *updated* nil, not the original channel. Send hangs. This is one of the most surprising interactions between closures and nil.

Workaround: pass the channel as an argument, not via closure:

```go
go func(ch chan int) {
    ch <- 1
}(realCh)
```

### Mixing close-and-nil

```go
if quit {
    close(ch)
    ch = nil
}
```

This works if no other goroutine is currently using `ch` — but in general, mutating a shared channel variable from one place while others read it is a data race. The mutation must be protected by a mutex or the channel must be owned by one goroutine.

### `len`/`cap` on nil

```go
var ch chan int
fmt.Println(len(ch), cap(ch)) // 0 0
```

Both return 0. Not a bug, but easy to misinterpret as "empty buffered channel."

### Comparing channels

```go
var a chan int
b := make(chan int)
fmt.Println(a == nil) // true
fmt.Println(b == nil) // false
fmt.Println(a == b)   // false
```

Channel comparison is by identity (pointer). Two channels are equal only if they are the same channel value.

---

## Common Mistakes

| Mistake | Fix |
|---|---|
| `var ch chan int; ch <- v` — forgetting `make` | Initialise with `ch := make(chan int)` or `make(chan int, N)`. |
| `close(ch)` where `ch` may be nil | Guard with `if ch != nil { close(ch) }` or refactor ownership. |
| Confusing nil and closed | Memorise: nil blocks forever; closed yields zero value immediately. |
| Using nil to "shut down" goroutines | Use `close`, `context.Context`, or a quit channel — *not* nil. |
| `select` where all cases become nil at runtime | Always keep one always-live case (e.g., `ctx.Done()`) or a `default`. |
| Capturing a nil-channel-soon variable in a closure | Pass the channel as a parameter; closures see later mutations. |
| Expecting a deadlock detector in production | The "all goroutines asleep" detector only fires if *every* goroutine is parked. Background nil-channel leaks are silent. |
| Returning a nil channel from a constructor on the error path | Either return an initialised channel, or return `(nil, err)` and let the caller branch. |

---

## Common Misconceptions

> *"A nil channel is the same as a closed channel."* — Opposite ends of the spectrum. Nil blocks forever; closed is always ready.

> *"Sending to nil panics."* — No. Sending blocks. Only `close(nil)` panics.

> *"`select` cases with nil channels cause a panic."* — No. They are silently skipped.

> *"You can never use nil channels in real code."* — They are idiomatic inside `select`. Disabling a case by setting its channel to nil is in the standard library and many open-source projects.

> *"`len(ch)` panics on nil."* — No. It returns 0. Same for `cap(ch)`.

> *"Once a channel is nil, it can never go back."* — A channel *variable* can be reassigned to a real channel any time. The variable is just a pointer.

> *"Nil channels save memory."* — No memory is freed when you set a variable to nil unless that was the last reference.

> *"A receive on nil eventually times out."* — There is no built-in timeout. The goroutine is parked indefinitely.

---

## Tricky Points

### Nil-channel cases reduce select degree, but not select selection cost

The runtime still walks every case in the `select` to determine readiness. Nil cases are cheap to skip (one comparison), but they still cost CPU per iteration. In a hot path, ten nil cases per `select` add measurable overhead. Keep `select` blocks small.

### Closure capture happens at `go func`, not at scheduling time

If a captured channel variable is later set to nil, the goroutine sees the *current* value when it dereferences. This means:

```go
ch := make(chan int)
go func() {
    time.Sleep(time.Second)
    ch <- 1 // sees ch's value NOW, not at the time of `go`
}()
ch = nil
```

After 1 second, the goroutine's `ch <- 1` reads the captured variable (which holds nil now) and blocks forever. To freeze the channel into the goroutine at spawn time, pass it as an argument.

### A nil channel with a `default` is a noisy idle

```go
for {
    select {
    case <-ch: // nil
        // ...
    default:
        // fires every iteration — busy spin
    }
}
```

100% CPU. The default fires immediately because no case is ever ready. If you want "do work occasionally when ch is ready," `ch = nil` is *not* the way to gate this — use `time.Sleep` or a ticker.

### `nil` channel inside a `for ... range`

```go
var ch chan int
for v := range ch {
    fmt.Println(v)
}
```

`range` does an internal receive each iteration. The first iteration blocks forever on the nil channel. Identical to `<-ch`. Often the source of "my range loop never runs" surprises.

### Reading the wait reason in pprof

A goroutine stuck on a nil channel shows:

```
chan receive (nil chan)
chan send (nil chan)
```

Compare with regular receive:

```
chan receive
chan send
```

The `(nil chan)` suffix is the diagnostic. Always look for it in `/debug/pprof/goroutine?debug=2` dumps.

### Type-asserted nil channels

```go
var i interface{} = chan int(nil)
ch := i.(chan int)
ch <- 1 // blocks forever
```

Passing a nil channel through an interface and back preserves its nil-ness. The type assertion succeeds.

---

## Test

```go
// nil_channels_test.go
package nilchan_test

import (
    "testing"
    "time"
)

func TestNilSelectCaseIsSkipped(t *testing.T) {
    var dead chan int
    live := make(chan int, 1)
    live <- 7

    select {
    case <-dead:
        t.Fatal("dead case fired")
    case v := <-live:
        if v != 7 {
            t.Fatalf("got %d, want 7", v)
        }
    }
}

func TestOffSwitchPattern(t *testing.T) {
    once := make(chan int, 1)
    once <- 1
    timeout := time.After(100 * time.Millisecond)
    got := []int{}

loop:
    for {
        select {
        case v := <-once:
            got = append(got, v)
            once = nil
        case <-timeout:
            break loop
        }
    }
    if len(got) != 1 || got[0] != 1 {
        t.Fatalf("got %v, want [1]", got)
    }
}

func TestCloseNilPanics(t *testing.T) {
    defer func() {
        if r := recover(); r == nil {
            t.Fatal("expected panic, got none")
        }
    }()
    var ch chan int
    close(ch)
}
```

Run with the race detector:

```bash
go test -race ./...
```

For leak detection:

```go
import "go.uber.org/goleak"

func TestNoNilLeak(t *testing.T) {
    defer goleak.VerifyNone(t)
    // ... code that should not leak goroutines on nil channels ...
}
```

---

## Tricky Questions

**Q.** What does this print?

```go
package main

func main() {
    var ch chan int
    select {
    case <-ch:
        println("a")
    default:
        println("b")
    }
}
```

**A.** `b`. The nil case is not ready, so `default` fires.

---

**Q.** What does this print?

```go
package main

func main() {
    var ch chan int
    select {
    case <-ch:
        println("a")
    }
}
```

**A.** Nothing. The `select` has only a nil case and no default. The goroutine parks forever; the runtime detects deadlock and prints `fatal error: all goroutines are asleep`.

---

**Q.** Is this a bug?

```go
func leakyServer() {
    var notify chan struct{}
    go func() {
        <-notify
        cleanup()
    }()
}
```

**A.** Yes. `notify` is nil; the goroutine blocks forever on the receive, never running `cleanup`. Goroutine leak on every call. Fix: `notify := make(chan struct{})` and `close(notify)` when ready, or remove the goroutine.

---

**Q.** What is the difference between `close(ch)` and `ch = nil`?

**A.** `close(ch)` notifies all current and future receivers: receives return the zero value with `ok==false` immediately. `ch = nil` removes the variable's reference; subsequent operations on the variable block (send/receive) or panic (`close`). They have opposite effects.

---

**Q.** Will this compile?

```go
var ch chan int = nil
ch <- 1
```

**A.** Yes. The compiler accepts it. At runtime, the send blocks forever, leading to a deadlock fatal if there are no other goroutines.

---

**Q.** What is the value of `len(ch)` when `ch == nil`?

**A.** 0. Same for `cap(ch)`. Channels follow the slice/map convention: zero-valued aggregates have length 0.

---

**Q.** Can `range` over a nil channel?

**A.** Yes, syntactically. At runtime, the very first iteration blocks forever on a receive, same as `<-ch`.

---

## Cheat Sheet

```go
// Create a nil channel (intentional or not)
var ch chan int          // nil
ch2 := make(chan int)    // initialised
ch3 := (chan int)(nil)   // explicit nil

// Behaviour
ch <- 1     // blocks forever
v := <-ch   // blocks forever
close(ch)   // panic: close of nil channel

// In select: case is skipped
select {
case <-ch:                  // never fires
case v := <-other:          // can fire
default:                    // fires if no others ready
}

// The off-switch pattern
ch = nil                    // disable this case
ch = realCh                 // re-enable

// Drain-then-disable on close
for v, ok := <-in; ok; v, ok = <-in { handle(v) }
in = nil                    // stop selecting on closed channel

// Safe close
if ch != nil { close(ch) }
```

---

## Self-Assessment Checklist

- [ ] I can produce a nil channel three different ways.
- [ ] I know what `send`, `receive`, and `close` do to a nil channel.
- [ ] I know what `select` does when a case's channel is nil.
- [ ] I know the difference between a nil channel and a closed channel.
- [ ] I can write the "off switch" pattern from memory.
- [ ] I can write the "drain then disable" pattern from memory.
- [ ] I can identify a `goleak`-style nil-channel leak in a pprof dump.
- [ ] I know why `close(nil)` panics but `<-nil` blocks.
- [ ] I have used a nil channel intentionally in `select` at least once.
- [ ] I have run a test with `go test -race` and `goleak` to catch leaks.

---

## Summary

A nil channel is the zero value of a channel type. Send and receive on it block forever; `close` panics. Outside `select`, this is almost always a bug — the result of a forgotten `make`, an uninitialised struct field, or a closure-capture surprise. Inside `select`, it is a precision tool: a case whose channel is nil is silently skipped, letting you disable a branch by reassigning the channel variable.

The two key patterns to internalise: the "off switch" (set a channel to nil after one-time use) and "drain then disable" (read a closed channel until `ok==false`, then nil it so the case stops firing). Both turn cumbersome boolean-flag state machines into clean `select`-driven loops.

Always remember: a nil channel is *not* a closed channel. They sit at opposite ends of the readiness spectrum. Confusing them creates either silent leaks (using nil when you meant close) or accidental panics (closing when you meant nil).

The middle level covers architectural patterns — pipelines that disable upstreams, multi-source fan-in shutdown, and the interaction with `context.Context`. The professional level dives into `chansend`/`chanrecv` and how the runtime treats nil channels at the lowest layer.

---

## What You Can Build

After mastering this material:

- A periodic emitter with pause/resume that does not waste a goroutine on a sleep loop.
- A multi-source fan-in that gracefully shuts down each source independently.
- A backpressure-aware buffer that selects on output only when there is data to send.
- A state-machine `select`-loop that disables transitions based on internal state.
- A drain-and-exit worker that consumes a closed channel and cleans up.
- A timer-driven sampler that disables sampling between windows by nil-ing the tick channel.

---

## Further Reading

- The Go Programming Language Specification — *Channel types*: <https://go.dev/ref/spec#Channel_types>
- The Go Programming Language Specification — *Send statements* and *Receive operator*: <https://go.dev/ref/spec#Send_statements>
- Dave Cheney — *Curious Channels*: <https://dave.cheney.net/2013/04/30/curious-channels>
- Bryan Mills — *Rethinking Classical Concurrency Patterns* (GopherCon 2018): <https://www.youtube.com/watch?v=5zXAHh5tJqQ>
- The Go Blog — *Go Concurrency Patterns: Pipelines and Cancellation*: <https://go.dev/blog/pipelines>
- `go.uber.org/goleak` — leak detector library: <https://github.com/uber-go/goleak>

---

## Related Topics

- [Buffered vs Unbuffered Channels](../01-buffered-vs-unbuffered/) — the baseline channel semantics
- [Select Statement](../02-select-statement/) — where nil channels become useful
- [Closing Channels](../06-closing-channels/) — the dual operation to nil
- [Range over Channels](../07-range-over-channels/) — `range` interacts surprisingly with nil
- `context.Context` (later section) — the canonical cancellation pattern

---

## Diagrams & Visual Aids

### Send / receive / close on nil — at a glance

```
                +-------------+----------------+----------------+
                |  Operation  |  Nil channel   | Closed channel |
                +-------------+----------------+----------------+
                |  send       | blocks forever |    panic       |
                |  receive    | blocks forever | zero, ok=false |
                |  close      |    panic       |    panic       |
                |  in select  | case skipped   | case fires now |
                |  len()/cap()|     0 / 0      |   buf depth    |
                +-------------+----------------+----------------+
```

### `select` with a mix of live and nil cases

```
   +-- select { ----------------------------+
   |   case <-ch1 (live):  ready or not    |  <- considered
   |   case <-ch2 (nil):    skipped         |  <- ignored
   |   case ch3 <- v (nil): skipped         |  <- ignored
   |   case <-ctx.Done():   considered      |  <- considered
   |   default:             fallback        |  <- if none ready
   +----------------------------------------+
```

### The off-switch lifecycle

```
   start
     |
     v
   ch = make(chan T)            (real channel — case active)
     |
     v
   ch <- v   (or <-ch)          (case fires)
     |
     v
   ch = nil                     (case disabled — never fires again)
     |
     v
   (other cases continue)
```

### Drain-then-disable on close

```mermaid
sequenceDiagram
    participant P as Producer
    participant C as Consumer (select-loop)
    P->>C: v1
    C->>C: handle(v1)
    P->>C: v2
    C->>C: handle(v2)
    P->>P: close(in)
    C->>C: receive returns (0,false)
    Note over C: in = nil; case dormant
    C->>C: continues on other cases
```

### Closure capture pitfall

```
    +-- main goroutine --+              +-- spawned goroutine --+
    |                    |              |                       |
    |  ch := make(...)   |              |  (captured ch via    |
    |  go func() {       |  -----+      |   closure ref)        |
    |     ch <- 1        |       |      |                       |
    |  }()               |       +----> |  reads ch RIGHT NOW   |
    |  ch = nil          |              |  -> sees nil          |
    |                    |              |  -> blocks forever    |
    +--------------------+              +-----------------------+
```

Pass the channel as a parameter to freeze the value:

```
    go func(ch chan int) {
        ch <- 1   // sees the captured argument, not later mutations
    }(realCh)
```

### Goroutine state machine including nil-channel wait

```
   runnable --[run on M]--> running --[ch <- v on nil]--> waiting (chan send nil chan)
                                  |
                                  +--[<-ch on nil]------> waiting (chan receive nil chan)
                                  |
                                  +--[select all nil, no default]--> waiting

   waiting --[NO WAKEUP POSSIBLE]--> stays parked forever
```

Compare with normal channel: waiting → runnable on send/recv completion.

### Off-switch vs boolean-flag comparison

```
   Boolean-flag (verbose):                Nil-channel (concise):
                                        
   for {                                  for {
       select {                              select {
       case v := <-ch:                       case v := <-ch:
           if active {                          handle(v)
               handle(v)                        ch = nil
               active = false                case <-other:
           }                                    // ...
       case <-other:                         }
           // ...                         }
       }
   }
```

The right-hand version uses the runtime's built-in skip; no flag, no conditional, fewer states to track.

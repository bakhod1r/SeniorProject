# Nil Channels — Find the Bug

> Each program below has a bug related to nil channels. Find the bug, explain why it matters, and describe a fix. Difficulty rises through the file. Solutions are at the end.

---

## Easy

### Bug 1 — The forgotten `make`

```go
package main

import "fmt"

type Server struct {
    events chan string
}

func (s *Server) Run() {
    s.events <- "boot"
    fmt.Println("server started")
}

func main() {
    s := &Server{}
    s.Run()
}
```

**Observation.** The program prints nothing and hangs, then exits with `fatal error: all goroutines are asleep - deadlock!`.

**Find the bug.**

---

### Bug 2 — Defer-close on a maybe-nil channel

```go
package main

import "fmt"

func process(active bool) {
    var ch chan int
    if active {
        ch = make(chan int)
    }
    defer close(ch)
    // ... do work ...
    fmt.Println("done")
}

func main() {
    process(false)
}
```

**Observation.** When `active` is false, the program crashes with `panic: close of nil channel`.

**Find the bug.**

---

### Bug 3 — Receive in a closure that captures the channel

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var ch chan int
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        v := <-ch
        fmt.Println("got:", v)
    }()
    ch = make(chan int)
    ch <- 42
    wg.Wait()
}
```

**Observation.** Hangs.

**Find the bug.**

---

### Bug 4 — Range over a possibly-nil channel

```go
package main

import "fmt"

func eventStream(enabled bool) chan int {
    if !enabled {
        return nil
    }
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < 3; i++ {
            out <- i
        }
    }()
    return out
}

func main() {
    for v := range eventStream(false) {
        fmt.Println(v)
    }
    fmt.Println("done")
}
```

**Observation.** "done" is never printed.

**Find the bug.**

---

### Bug 5 — Select with all-nil cases

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
    }
    fmt.Println("after")
}
```

**Observation.** Deadlock fatal error; "after" never prints.

**Find the bug.**

---

## Medium

### Bug 6 — Off-switch without an escape

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 1)
    ch <- 42
    for {
        select {
        case v := <-ch:
            fmt.Println(v)
            ch = nil
        }
    }
}
```

**Observation.** Prints 42, then hangs.

**Find the bug.**

---

### Bug 7 — Closed channel busy-loop

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int, 2)
    ch <- 1
    ch <- 2
    close(ch)

    timeout := time.After(100 * time.Millisecond)
    count := 0
    for {
        select {
        case v, ok := <-ch:
            if !ok {
                // case keeps firing; let's just count and move on
                count++
                continue
            }
            fmt.Println(v)
        case <-timeout:
            fmt.Println("count:", count)
            return
        }
    }
}
```

**Observation.** Prints 1, 2, then `count: <a huge number>`. CPU is pegged at 100% during the run.

**Find the bug.**

---

### Bug 8 — Niling a still-written-to channel

```go
package main

import (
    "fmt"
    "time"
)

var dataCh chan int

func producer() {
    for i := 0; i < 100; i++ {
        dataCh <- i
        time.Sleep(time.Millisecond)
    }
}

func main() {
    dataCh = make(chan int)
    go producer()

    // Read 5 values, then disable
    for i := 0; i < 5; i++ {
        v := <-dataCh
        fmt.Println(v)
    }
    dataCh = nil

    time.Sleep(time.Second)
    fmt.Println("done")
}
```

**Observation.** "done" prints, but the producer goroutine never finished — it leaks.

**Find the bug.**

---

### Bug 9 — Conditional close that hits nil

```go
package main

func main() {
    var ch1, ch2 chan int
    ch1 = make(chan int)
    // ch2 is intentionally nil — feature disabled
    
    cleanup := func() {
        close(ch1)
        close(ch2)
    }
    cleanup()
}
```

**Observation.** Panics with `close of nil channel`.

**Find the bug.**

---

### Bug 10 — Pause loop that exits the goroutine

```go
package main

import (
    "fmt"
    "time"
)

func emitter(control <-chan string) {
    ticker := time.NewTicker(100 * time.Millisecond)
    defer ticker.Stop()
    tickCh := ticker.C

    for {
        select {
        case <-tickCh:
            fmt.Println("tick")
        case cmd := <-control:
            if cmd == "pause" {
                tickCh = nil
            }
            if cmd == "stop" {
                tickCh = nil // wrong
            }
        }
    }
}

func main() {
    control := make(chan string)
    go emitter(control)
    time.Sleep(250 * time.Millisecond)
    control <- "stop"
    time.Sleep(500 * time.Millisecond)
    fmt.Println("main done")
}
```

**Observation.** "main done" prints, but the emitter goroutine is still parked. Goroutine count stays at 2 forever.

**Find the bug.**

---

### Bug 11 — A select with a default and all nils

```go
package main

import "fmt"

func main() {
    var ch chan int
    for i := 0; i < 5; i++ {
        select {
        case v := <-ch:
            fmt.Println("got:", v)
        default:
            fmt.Println("nothing")
        }
    }
}
```

**Observation.** Prints "nothing" five times. The developer expected this to "wait briefly" between iterations.

**Find the bug.**

---

## Hard

### Bug 12 — Nil channel inside a generic merge

```go
package main

import (
    "fmt"
    "reflect"
    "sync"
)

func Merge(ins ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for _, in := range ins {
        wg.Add(1)
        go func(in <-chan int) {
            defer wg.Done()
            for v := range in {
                out <- v
            }
        }(in)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}

func main() {
    a := make(chan int, 2)
    a <- 1; a <- 2; close(a)
    var b <-chan int // intentionally nil
    merged := Merge(a, b)
    for v := range merged {
        fmt.Println(v)
    }
    _ = reflect.ValueOf
    fmt.Println("done")
}
```

**Observation.** Prints 1 and 2, but "done" never prints — `merged` is never closed.

**Find the bug.**

---

### Bug 13 — Hot-swap with a stale channel

```go
package main

import (
    "fmt"
    "time"
)

func stage(in *<-chan int, out chan<- int) {
    for {
        select {
        case v, ok := <-*in:
            if !ok {
                return
            }
            out <- v
        }
    }
}

func main() {
    src1 := make(chan int, 2)
    src1 <- 1
    src1 <- 2
    close(src1)

    var in <-chan int = src1
    out := make(chan int, 10)
    go stage(&in, out)

    time.Sleep(100 * time.Millisecond)

    src2 := make(chan int, 2)
    src2 <- 3
    src2 <- 4
    close(src2)
    in = src2 // swap

    time.Sleep(200 * time.Millisecond)
    close(out)
    for v := range out {
        fmt.Println(v)
    }
}
```

**Observation.** Prints 1, 2, and then the program hangs or has unpredictable output.

**Find the bug.**

---

### Bug 14 — Concurrent niling

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Worker struct {
    in chan int
}

func (w *Worker) Run() {
    for {
        select {
        case v, ok := <-w.in:
            if !ok {
                return
            }
            fmt.Println("got:", v)
        }
    }
}

func (w *Worker) Disable() {
    w.in = nil
}

func main() {
    w := &Worker{in: make(chan int)}
    var wg sync.WaitGroup
    wg.Add(1)
    go func() { defer wg.Done(); w.Run() }()

    // simulate concurrent disable
    go func() {
        time.Sleep(100 * time.Millisecond)
        w.Disable()
    }()

    w.in <- 1
    time.Sleep(200 * time.Millisecond)
    fmt.Println("main done")
}
```

**Observation.** Sometimes "got: 1" prints; sometimes the program races and behaves inconsistently. The `Worker` may or may not leak.

**Find the bug.**

---

### Bug 15 — Pipeline that prematurely sets input to nil

```go
package main

import "fmt"

func main() {
    in := make(chan int, 3)
    in <- 1
    in <- 2
    in <- 3
    // forgot to close(in)

    for {
        select {
        case v, ok := <-in:
            if !ok {
                in = nil
                continue
            }
            fmt.Println(v)
            if v == 2 {
                in = nil // disable after seeing 2
            }
        }
    }
}
```

**Observation.** Prints 1, 2, and then hangs forever.

**Find the bug.**

---

### Bug 16 — `reflect.Select` with a literal nil channel

```go
package main

import (
    "fmt"
    "reflect"
)

func main() {
    a := make(chan int, 1)
    a <- 1
    var b chan int // nil

    cases := []reflect.SelectCase{
        {Dir: reflect.SelectRecv, Chan: reflect.ValueOf(a)},
        {Dir: reflect.SelectRecv, Chan: reflect.ValueOf(b)},
    }
    chosen, val, ok := reflect.Select(cases)
    fmt.Println("chosen:", chosen, "val:", val.Interface(), "ok:", ok)
}
```

**Observation.** Works correctly here (chosen=0, val=1, ok=true), but the developer is unsure whether this is reliable. They want to know if `reflect.ValueOf(b)` (a nil chan) is the same as `reflect.Value{}`.

**Find the bug (or the gotcha).**

---

### Bug 17 — Off-switch with side effect lost

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    once := make(chan int, 1)
    once <- 99
    tick := time.NewTicker(50 * time.Millisecond)
    defer tick.Stop()
    timeout := time.After(200 * time.Millisecond)

    var sideEffectCount int

    for {
        select {
        case v := <-once:
            fmt.Println("once:", v)
            sideEffectCount++
            once = nil
        case <-tick.C:
            fmt.Println("tick")
            once = make(chan int, 1) // reset once for next round!
            once <- 100
        case <-timeout:
            fmt.Println("count:", sideEffectCount)
            return
        }
    }
}
```

**Observation.** The developer wanted "once" to fire every tick. It prints "once: 99" then "tick", then "once: 100" rarely. Actually behaves randomly.

**Find the bug.**

---

## Solutions

### Solution 1

`Server.events` is never initialised. `s.events <- "boot"` sends on a nil channel and blocks forever. Fix: initialise via a constructor:

```go
func NewServer() *Server {
    return &Server{events: make(chan string, 16)}
}
```

Or buffer-size your channel and initialise in `Run`.

---

### Solution 2

`defer close(ch)` is registered before the conditional initialisation. When `active==false`, `ch` is nil at defer-time; `close(nil)` panics. Fix: only register the defer when `ch` is non-nil:

```go
if ch != nil {
    defer close(ch)
}
```

Or guard inside the defer:

```go
defer func() {
    if ch != nil {
        close(ch)
    }
}()
```

---

### Solution 3

Closure capture: the spawned goroutine captures `ch` by reference, but it runs immediately and reads `ch` while it is still nil. The receive parks the goroutine forever. The later `ch = make(chan int); ch <- 42` reassigns the variable, but the parked goroutine has no mechanism to be woken on the new channel.

Fix: initialise the channel *before* spawning the goroutine.

```go
ch := make(chan int)
var wg sync.WaitGroup
wg.Add(1)
go func() { defer wg.Done(); v := <-ch; fmt.Println(v) }()
ch <- 42
wg.Wait()
```

Or pass the channel as an argument:

```go
ch := make(chan int)
go func(ch chan int) { fmt.Println(<-ch) }(ch)
```

---

### Solution 4

`eventStream(false)` returns a nil channel. `for v := range nilCh` blocks forever on the first receive. The main goroutine is the only one; deadlock.

Fix: defend against nil:

```go
ch := eventStream(false)
if ch == nil {
    fmt.Println("done")
    return
}
for v := range ch { fmt.Println(v) }
fmt.Println("done")
```

Or use `select` with a default/cancellation case.

---

### Solution 5

Both channels are nil; the `select` has no default; no case can ever proceed. The main goroutine parks forever; runtime detects deadlock.

Fix: add a `default` case if you want non-blocking, or initialise at least one channel, or add `ctx.Done()` as an always-live case.

---

### Solution 6

After the first receive, `ch = nil`. The next `select` has only the nil case, no default, no other case. The goroutine parks forever. Since main is the only goroutine, deadlock.

Fix: add an exit condition. Either `return` after `ch = nil`, or add a cancellation case:

```go
case <-ctx.Done():
    return
```

---

### Solution 7

When `ch` is closed, the receive case fires immediately every iteration, returning `(0, false)`. The code does not nil `ch` after detecting closure, so the loop runs at maximum speed. The `count++` line is hit hundreds of thousands of times per second.

Fix: nil the channel after detecting closure:

```go
case v, ok := <-ch:
    if !ok {
        ch = nil
        continue
    }
```

After this, the case stops firing; the loop waits on the timeout.

---

### Solution 8

Setting `dataCh = nil` from main does not affect the producer goroutine, which captured `dataCh` by reference (it is a package-level variable, so always shared). The producer continues to send on the *now-nil* variable — every send blocks forever. The producer leaks.

Fix: do not mutate the shared channel variable. Use a separate stop signal:

```go
stop := make(chan struct{})
go func() {
    for i := 0; i < 100; i++ {
        select {
        case dataCh <- i:
        case <-stop:
            return
        }
        time.Sleep(time.Millisecond)
    }
}()
// ... receive 5, then ...
close(stop)
```

---

### Solution 9

`ch2` is nil. `close(ch2)` panics. The `close(ch1)` succeeded but `close(ch2)` immediately crashes.

Fix: guard each close:

```go
cleanup := func() {
    if ch1 != nil { close(ch1) }
    if ch2 != nil { close(ch2) }
}
```

Or structure ownership so that nil-able fields are tracked.

---

### Solution 10

The "stop" command sets `tickCh = nil` but never returns from the function. The `select` now has only one always-live case: `control`, which the test never sends on again. The goroutine parks forever (it has nil tickCh, and control is the only live case but no one sends on it).

Fix: handle "stop" by returning:

```go
case cmd := <-control:
    switch cmd {
    case "pause":
        tickCh = nil
    case "resume":
        tickCh = ticker.C
    case "stop":
        return
    }
```

---

### Solution 11

The `select` with a nil case and a default immediately falls to the default. The loop runs as fast as the CPU allows — five iterations are over in microseconds. The developer expected blocking; they got busy iteration.

Fix: if you want to wait, use a timer, `time.Sleep`, or a real channel. The default makes the `select` non-blocking; combined with nil channels, it is just a noop with a default.

---

### Solution 12

The `Merge` function spawns a goroutine for each input, including the nil one. The goroutine that does `for v := range nil` blocks forever on its first receive. The `wg.Wait()` never completes (because the nil-channel goroutine never calls `wg.Done()`). The closing goroutine never closes `out`. The main loop ranges forever.

Fix: skip nil inputs at spawn time:

```go
for _, in := range ins {
    if in == nil { continue }
    wg.Add(1)
    go func(in <-chan int) { ... }(in)
}
```

Or, more defensively, check inside the goroutine and exit immediately if its channel is nil.

---

### Solution 13

The `stage` function takes `in *<-chan int` (pointer to a channel). On each `select` iteration, `*in` is read fresh — so swapping `in = src2` from main does change what `stage` sees. *But* there is a race: stage reads `*in` without synchronisation while main mutates it.

Worse: stage uses `<-*in` directly. If main mutates `in` mid-`select`, stage may read from an inconsistent state.

The cleaner fix is to send new sources via a control channel rather than mutating a shared pointer:

```go
func stage(ctx context.Context, sources <-chan <-chan int, out chan<- int) {
    var in <-chan int
    for {
        select {
        case newIn := <-sources:
            in = newIn
        case v, ok := <-in:
            if !ok {
                in = nil
                continue
            }
            out <- v
        case <-ctx.Done():
            return
        }
    }
}
```

---

### Solution 14

`w.in = nil` in `Disable()` races with the goroutine's `<-w.in` read. Data race on the `w.in` field. The race detector (`-race`) flags it. Additionally, niling the field while the main goroutine is mid-`w.in <- 1` may cause the send to block on nil if the niling wins the race.

Fix: do not mutate shared channel fields concurrently. Use a control channel for disable, or `sync.RWMutex`, or `atomic.Pointer[chan int]`. Simpler: redesign so the worker owns its `in` field and only it mutates it.

---

### Solution 15

The channel is not closed. After printing 2 and setting `in = nil`, the `select` has only one case (the nil one) — no default, no other case. The goroutine parks forever.

Fix: add an escape case, or `return` after `in = nil`:

```go
if v == 2 {
    in = nil
    return // or break out of the loop somehow
}
```

The intent ("disable after seeing 2 but keep doing something") is unclear; the structure needs another live case like `ctx.Done()`.

---

### Solution 16

`reflect.ValueOf(b)` where `b` is a nil `chan int` returns a *valid* `reflect.Value` of channel type, whose underlying channel is nil. This is *different* from `reflect.Value{}` (the zero `reflect.Value`).

- `reflect.ValueOf(nilChan)`: valid Value, nil channel pointer — `reflect.Select` treats it as a nil case (never fires).
- `reflect.Value{}`: invalid Value — `reflect.Select` treats it identically (never fires).

Either works to disable a case. The runtime's check is "is the underlying channel pointer nil?" which is true for both. The conventional choice is `reflect.Value{}` because it is shorter and more obvious "this case is disabled."

So there is no bug here — but the developer should know both forms work, and prefer `reflect.Value{}` for new code.

---

### Solution 17

The developer reassigns `once = make(chan int, 1); once <- 100` inside the tick case. This *creates a new channel* — the original buffered `99` was already consumed. The new channel has value 100. On the next iteration, the `once` case might fire (if the random selection picks it) or the tick case might fire again (which resets `once` again, discarding the 100 that was just buffered).

The pattern is fundamentally confused: nil-ing a channel and recreating it is not the same as "fire again." The original "off switch" pattern is for one-shot events. To fire on each tick, just do the work in the tick case:

```go
case <-tick.C:
    fmt.Println("tick")
    fmt.Println("once: 100") // do whatever the once-case did
    sideEffectCount++
```

Don't recreate channels in a hot loop.

---

## Wrap-up

These bugs cluster around four root causes:

1. **Forgotten initialisation** — Bugs 1, 4.
2. **Closure-capture / shared mutation race** — Bugs 3, 8, 13, 14.
3. **Missing escape case** — Bugs 5, 6, 10, 15.
4. **Confusion between nil, closed, and live** — Bugs 2, 7, 9, 11, 12.

Plus advanced misuses (16, 17) where the pattern is misapplied.

The fixes share a discipline: every nil-channel assignment is *intentional* and accompanied by either (a) a clear exit path for the goroutine or (b) at least one always-live case in the `select`. Audit any `ch = nil` in production code against this rule.

Next: [optimize.md](optimize.md) for optimization exercises around nil-channel patterns.

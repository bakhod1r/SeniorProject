---
layout: default
title: Find Bug
parent: Channel Close Violations
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 8
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/03-channel-close-violations/find-bug/
---

# Channel Close Violations — Find the Bug

## Introduction

This file presents 12 broken programs. Each one has a close-related defect. Your task: read the code, find the bug, classify it (double close, send-after-close, range-never-returns, etc.), and propose a fix.

After each snippet, the bug, classification, and corrected code are revealed. Try to find the bug yourself before reading the solution.

---

## Bug 1: Double Close in Multiple Producers

```go
package main

import "sync"

func main() {
    ch := make(chan int, 10)
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            defer close(ch)
            for j := 0; j < 5; j++ {
                ch <- id*10 + j
            }
        }(i)
    }
    wg.Wait()
    for v := range ch {
        _ = v
    }
}
```

**Classification.** Double close from multiple producers.

**Bug.** Each producer has `defer close(ch)`. The first to finish closes; the second and third panic with `close of closed channel`.

**Fix.** Use a coordinator goroutine.

```go
for i := 0; i < 3; i++ {
    wg.Add(1)
    go func(id int) {
        defer wg.Done()
        for j := 0; j < 5; j++ {
            ch <- id*10 + j
        }
    }(i)
}
go func() {
    wg.Wait()
    close(ch)
}()
```

The closer is the single coordinator goroutine; producers no longer close.

---

## Bug 2: Send After Close in Defer

```go
package main

func main() {
    ch := make(chan int)
    go func() {
        defer close(ch)
        for i := 0; i < 10; i++ {
            ch <- i
        }
    }()

    for v := range ch {
        if v == 5 {
            close(ch) // BAD
            return
        }
    }
}
```

**Classification.** Receiver-side close (Rule 4 violation); causes send-on-closed in the producer.

**Bug.** The receiver closes the channel when it sees value 5. The producer's next send panics. (Also the producer's deferred `close` would then double-close — though it never gets there because of the panic.)

**Fix.** Use a done-channel to signal cancellation.

```go
done := make(chan struct{})
ch := make(chan int)
go func() {
    defer close(ch)
    for i := 0; i < 10; i++ {
        select {
        case <-done: return
        case ch <- i:
        }
    }
}()

for v := range ch {
    if v == 5 {
        close(done) // signal producer
        // drain channel to let producer exit
        for range ch {}
        return
    }
}
```

The done channel signals cancellation. The producer exits cleanly, executing its deferred close.

---

## Bug 3: Range Never Returns

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    go func() {
        for i := 0; i < 10; i++ {
            ch <- i
        }
        // missing close(ch)
    }()

    for v := range ch {
        fmt.Println(v)
    }
}
```

**Classification.** Missing close; range never exits.

**Bug.** The producer sends 10 values and exits, but never closes the channel. The main goroutine's `for range` waits for the next value forever. Deadlock; runtime detects "all goroutines are asleep".

**Fix.** Add `defer close(ch)` in the producer.

```go
go func() {
    defer close(ch)
    for i := 0; i < 10; i++ {
        ch <- i
    }
}()
```

---

## Bug 4: Close on Nil Channel

```go
package main

type Svc struct {
    ch chan int
}

func New() *Svc { return &Svc{} }

func (s *Svc) Close() { close(s.ch) }

func main() {
    s := New()
    s.Close()
}
```

**Classification.** Close on nil channel.

**Bug.** `New` does not initialize `s.ch`. `s.ch` is nil. `close(s.ch)` panics with `close of nil channel`.

**Fix.** Initialize the channel in the constructor.

```go
func New() *Svc { return &Svc{ch: make(chan int)} }
```

---

## Bug 5: Defer Close in Goroutine That May Not Run

```go
package main

import "fmt"

func produce(cond bool) <-chan int {
    out := make(chan int)
    if cond {
        go func() {
            defer close(out)
            for i := 0; i < 10; i++ {
                out <- i
            }
        }()
    }
    return out
}

func main() {
    ch := produce(false)
    for v := range ch {
        fmt.Println(v)
    }
}
```

**Classification.** Missing close due to conditional goroutine.

**Bug.** When `cond` is false, no goroutine is started; the channel is never closed; range hangs forever.

**Fix.** Close immediately when no producer will run, or refactor to always start a producer.

```go
func produce(cond bool) <-chan int {
    out := make(chan int)
    if !cond {
        close(out)
        return out
    }
    go func() {
        defer close(out)
        for i := 0; i < 10; i++ {
            out <- i
        }
    }()
    return out
}
```

Or simply return an already-closed channel from a separate path.

---

## Bug 6: Send to Closed Channel Caught by Recover (Bad Pattern)

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    close(ch)

    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()

    ch <- 1 // panics
    fmt.Println("after send")
}
```

**Classification.** Send-on-closed (Rule 3); program "handles" via recover, but the design is wrong.

**Bug.** The send panics. Recover catches it, but the channel is closed; "after send" never prints. The program has hidden the bug; the send did not happen.

**Fix.** Do not send to a closed channel. Use a done-channel pattern.

```go
done := make(chan struct{})
close(done) // simulate cancellation

ch := make(chan int)
select {
case <-done:
    fmt.Println("cancelled")
case ch <- 1:
    fmt.Println("sent")
}
```

The select abandons the send when done is closed. No panic, no recover, no bug hidden.

---

## Bug 7: Closing a Library-Returned Channel

```go
package main

func subscribe() chan int {
    out := make(chan int)
    go func() {
        for i := 0; i < 5; i++ {
            out <- i
        }
        close(out)
    }()
    return out
}

func main() {
    ch := subscribe()
    defer close(ch) // BAD: library will also close
    for v := range ch {
        _ = v
    }
}
```

**Classification.** Caller closes a channel owned by library; double-close panic.

**Bug.** The library's goroutine will close `out` when it finishes. The caller's `defer close(ch)` will execute *after* the range loop exits (because range finished by the library closing). Then the caller's deferred close panics.

Actually wait — `defer close(ch)` runs when main returns. The order:

1. main starts; subscribe spawns producer.
2. main ranges over ch; producer finishes; library closes out.
3. Range exits.
4. main returns. `defer close(ch)` fires. Panic.

**Fix.** Do not close library-returned channels. Trust the library.

```go
func main() {
    ch := subscribe()
    for v := range ch {
        _ = v
    }
}
```

Better still, the library should return `<-chan int` to prevent this at compile time:

```go
func subscribe() <-chan int { ... }
```

---

## Bug 8: WaitGroup Bug Allowing Close Before Sends Complete

```go
package main

import "sync"

func main() {
    ch := make(chan int, 10)
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        go func(id int) {
            wg.Add(1)
            defer wg.Done()
            for j := 0; j < 5; j++ {
                ch <- id*10 + j
            }
        }(i)
    }
    wg.Wait()
    close(ch)
    for v := range ch {
        _ = v
    }
}
```

**Classification.** WaitGroup misuse; close fires before sends complete.

**Bug.** `wg.Add(1)` is inside the goroutine. The main `wg.Wait()` may run before any goroutine has called `wg.Add`, so it returns immediately. Then `close(ch)` fires while goroutines are still sending. Panic.

**Fix.** Always call `wg.Add` from the parent goroutine before spawning.

```go
for i := 0; i < 3; i++ {
    wg.Add(1)
    go func(id int) {
        defer wg.Done()
        for j := 0; j < 5; j++ {
            ch <- id*10 + j
        }
    }(i)
}
wg.Wait()
close(ch)
```

This is the canonical pattern. Note that this version sends to a buffered channel of 10 capacity; for 15 total sends and 10 slots, the producers will block until main reads. Make sure main reads after Wait. Actually the close-then-range works here because of the buffered semantics, but it's still a deadlock pattern under the broken version (close + send race).

---

## Bug 9: Closing in Both Branches of a Conditional

```go
package main

func main() {
    ch := make(chan int)
    cond := true

    go func() {
        if cond {
            close(ch)
        }
        // some other logic
        close(ch)
    }()

    <-ch
}
```

**Classification.** Conditional double-close.

**Bug.** When `cond` is true, the first `close(ch)` executes. The function falls through (no return); the second `close(ch)` executes. Double-close panic.

**Fix.** Add return after the first close, or use sync.Once.

```go
go func() {
    defer close(ch)
    if cond {
        return // close fires via defer
    }
    // other logic
}()
```

The defer guarantees exactly one close.

---

## Bug 10: Closing Inside Receive Loop

```go
package main

func main() {
    ch := make(chan int, 10)
    go func() {
        for i := 0; i < 10; i++ {
            ch <- i
        }
    }()

    for v := range ch {
        if v >= 5 {
            close(ch)
            return
        }
    }
}
```

**Classification.** Receiver-side close while sender is in flight; potential send-on-closed.

**Bug.** The receiver closes ch when v reaches 5. The producer goroutine is still sending (it sent up to 5; if the producer is slow, it has not yet finished). The producer's next send panics.

Even worse: the receiver returns immediately after close; the producer may not have noticed yet; the panic propagates.

**Fix.** Use a done channel; let the producer close on its own.

```go
done := make(chan struct{})
ch := make(chan int, 10)
go func() {
    defer close(ch)
    for i := 0; i < 10; i++ {
        select {
        case <-done: return
        case ch <- i:
        }
    }
}()

for v := range ch {
    if v >= 5 {
        close(done)
        for range ch {} // drain
        return
    }
}
```

The done channel signals; the producer cleanly exits and closes ch.

---

## Bug 11: select with Send on Closed Channel

```go
package main

func main() {
    ch := make(chan int)
    close(ch)

    select {
    case ch <- 1:
    default:
    }
}
```

**Classification.** Send-on-closed in select.

**Bug.** The send case panics during evaluation, regardless of the default arm. The default does not save you.

**Fix.** Do not send on a closed channel. Use a done channel:

```go
done := make(chan struct{})
close(done)

ch := make(chan int)
select {
case <-done: return
case ch <- 1:
default:
}
```

The done arm fires first (it's always ready when closed). The send is never attempted.

---

## Bug 12: Defer in Goroutine That Captures Wrong Variable

```go
package main

import "fmt"

func main() {
    var channels []chan int
    for i := 0; i < 3; i++ {
        ch := make(chan int, 1)
        channels = append(channels, ch)
        go func() {
            defer close(ch) // captures latest ch, not per-iteration
            ch <- i          // captures latest i, not per-iteration
        }()
    }
    for _, ch := range channels {
        for v := range ch {
            fmt.Println(v)
        }
    }
}
```

**Classification.** Closure-capture bug; multiple goroutines close the same channel.

**Bug.** All three goroutines capture the *same* variable `ch` (the loop variable). By the time the goroutines run, `ch` is the last channel created. All three goroutines close the same channel; double-close panic.

(Note: in Go 1.22+, the loop variable is scoped per iteration, so this bug is fixed by the language. In older Go, this is a classic gotcha.)

**Fix.** Pass loop variables as parameters or scope them per-iteration.

```go
for i := 0; i < 3; i++ {
    ch := make(chan int, 1)
    channels = append(channels, ch)
    go func(ch chan int, i int) {
        defer close(ch)
        ch <- i
    }(ch, i)
}
```

Or in Go 1.22+:

```go
for i := 0; i < 3; i++ {
    ch := make(chan int, 1) // per-iteration ch
    channels = append(channels, ch)
    go func() {
        defer close(ch)
        ch <- i // per-iteration i (Go 1.22+)
    }()
}
```

---

## Summary

Each of these bugs is real: I have seen each one in production code. The patterns are:

- **Bug 1, 8, 9, 12:** Double close from concurrent producers.
- **Bug 2, 10:** Receiver-side close.
- **Bug 6, 11:** Send-on-closed in different forms.
- **Bug 3, 5:** Missing close causing receiver to hang.
- **Bug 4:** Close on nil.
- **Bug 7:** Caller closes library-owned channel.

The fixes follow the patterns from the senior-level material: coordinator + WaitGroup, done-channel, sync.Once, defer in single closer, type-system enforcement (`<-chan T`).

If you can spot these bugs at a glance, you have internalised the close discipline.

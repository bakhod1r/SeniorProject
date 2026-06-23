# The `hchan` Struct — Find the Bug

[← Back to index](index.md)

## How to Use This Page

Each section presents a Go program and a question. Read the code carefully, predict the behavior, and only then read the explanation. The bugs here are subtle — they manifest only when you understand the channel internals.

---

## Bug 1 — "It Just Hangs"

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int)
    go func() {
        time.Sleep(10 * time.Millisecond)
        ch <- 42
    }()
    fmt.Println(<-ch)
}
```

This works. Modify it slightly:

```go
func main() {
    var ch chan int  // declared, not made
    go func() {
        time.Sleep(10 * time.Millisecond)
        ch <- 42
    }()
    fmt.Println(<-ch)
}
```

What happens?

**Answer**: deadlock. `var ch chan int` leaves `ch` as `nil` (a nil `*hchan`). Both `chansend` and `chanrecv` check `if c == nil` and call `gopark` with `traceBlockForever`. Neither goroutine ever wakes. The Go runtime detects "all goroutines asleep" and prints a fatal:

```
fatal error: all goroutines are asleep - deadlock!
```

**Why the internals matter**: knowing that `chan T` is just a `*hchan` makes the bug obvious. The compiler does not warn because nil channels are a legitimate feature (used in `select` to dynamically disable a case).

---

## Bug 2 — The Surprising Range

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 3)
    ch <- 1
    ch <- 2
    ch <- 3
    // Forgot close(ch)
    for v := range ch {
        fmt.Println(v)
    }
}
```

**Answer**: deadlock. `for v := range ch` keeps receiving until the channel is closed. The buffer has three values; they are received. Then `<-ch` blocks. No goroutine will ever send or close. Fatal deadlock.

**Why the internals matter**: `range` over a channel is sugar for `for { v, ok := <-ch; if !ok { break } ... }`. The `ok` becomes false only when the channel is closed (`closechan` woke us with `success = false`). Without a close, `ok` is always true and the loop never exits.

---

## Bug 3 — The Close-and-Send Race

```go
package main

import (
    "sync"
    "time"
)

func main() {
    ch := make(chan int)
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            time.Sleep(time.Duration(i) * time.Millisecond)
            ch <- i
        }(i)
    }
    go func() {
        time.Sleep(5 * time.Millisecond)
        close(ch)
    }()
    for v := range ch {
        _ = v
    }
    wg.Wait()
}
```

**Answer**: panics with "send on closed channel" from one of the senders. The classic "who closes a fan-in channel?" mistake. After `close(ch)`, any sender goroutine still trying to send will panic because the check `if c.closed != 0 { unlock; panic }` in `chansend` triggers.

**Why the internals matter**: `chansend` checks `closed` under the lock after acquiring it. There is no way for a sender to know "is it still safe to send?" without taking the lock — which is exactly what `chansend` does. The panic is the language's chosen signal: do not close from the producer side when multiple producers exist.

**Fix**: have all producers signal "done" via a `sync.WaitGroup`, and have a separate goroutine call `close` only after `wg.Wait()`.

---

## Bug 4 — Stale `len(ch)`

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int, 10)
    go func() {
        for i := 0; i < 10; i++ {
            ch <- i
        }
    }()
    for {
        if len(ch) == 10 {
            fmt.Println("buffer full!")
            return
        }
        time.Sleep(time.Microsecond)
    }
}
```

**Answer**: works most of the time but is fragile. `len(ch)` reads `c.qcount` without locking, returning a snapshot. The loop spins waiting for `qcount == 10`, but between two reads `qcount` could go up and back down (if a consumer existed). In this example, since there is no consumer, the value monotonically increases — but the program still spins busy-waiting.

**Why the internals matter**: `len(ch)` is **not** a synchronization point. It is a debugging tool. Using it for control flow is an anti-pattern.

**Fix**: do not gate logic on `len(ch)`. Use proper synchronization (a separate channel, `sync.WaitGroup`, or a context).

---

## Bug 5 — The Phantom Receiver

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int)
    var done = make(chan struct{})
    go func() {
        for v := range ch {
            fmt.Println("got", v)
        }
        close(done)
    }()
    ch <- 1
    ch <- 2
    ch <- 3
    close(ch)
    <-done
    fmt.Println("but did 3 print?")
    time.Sleep(100 * time.Millisecond)
}
```

Question: does `got 3` print before "but did 3 print?"

**Answer**: yes — usually. The send `ch <- 3` is a rendezvous (unbuffered) with the parked receiver. The transfer happens, the receiver prints, the receiver continues looping. `close(ch)` then wakes the receiver out of its next `<-ch`; `for range` exits; `close(done)` runs; main unblocks.

But the order between "got 3" and main's `<-done` return is concurrent. Go's scheduler will *usually* run the receiver first because main is blocked on `<-done`, but a long-running receiver could in principle still be inside `fmt.Println` when main resumes.

**Why the internals matter**: `chansend` for unbuffered hands off the value and calls `goready` on the receiver. The receiver is now runnable, not running. The actual `Println` happens later, when a P picks the receiver up. So "the send returned" does not mean "the receive completed".

**Fix for guaranteed ordering**: have the receiver send back an ack on a second channel.

---

## Bug 6 — The Forgotten Direction

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 1)
    var done = make(chan struct{})

    go func() {
        for {
            select {
            case v := <-ch:
                fmt.Println(v)
            case <-done:
                return
            }
        }
    }()

    ch <- 1
    ch <- 2
    close(done)
}
```

Question: how many values get printed?

**Answer**: probably both 1 and 2, but it's racy. After `close(done)`, the receiver's `select` may pick `<-done` even though `ch` has values. `select` randomises among ready cases. If `ch` has a value AND `done` is closed, both cases are ready — Go picks randomly.

**Why the internals matter**: `selectgo` polls all cases and picks uniformly at random among ready ones. The "drain ch then exit" pattern is *not* guaranteed by `select` semantics.

**Fix**: drain in a second loop after the done signal, or use a single channel with sentinel values.

---

## Bug 7 — The Goroutine Leak via Block

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func fetch(ctx context.Context) string {
    ch := make(chan string)
    go func() {
        time.Sleep(5 * time.Second) // slow operation
        ch <- "result"
    }()
    select {
    case v := <-ch:
        return v
    case <-ctx.Done():
        return ""
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()
    fmt.Println(fetch(ctx))
}
```

After the timeout, `fetch` returns. But what happens to the goroutine doing the slow operation?

**Answer**: it leaks. After `fetch` returns, the goroutine is still sleeping. It then does `ch <- "result"`. The channel has no receiver. The goroutine parks on `chansend` forever — *but* the channel may also be GC-eligible since no one references it anymore...

Wait. The parked goroutine *itself* holds a reference to the channel (via `sg.c`). So the channel stays alive, the goroutine stays parked, the runtime never collects either. This is a *true leak*.

**Why the internals matter**: a parked sender's `sudog.c` keeps the `hchan` reachable. The `hchan` keeps the `sudog` reachable. The goroutine is reachable from the scheduler's `allgs`. None of them can be collected.

**Fix**: make the channel buffered (capacity 1) so the late send completes and the goroutine exits. Or wrap with a context-aware send via `select`.

---

## Bug 8 — The Sneaky Closure Pointer

```go
package main

import "fmt"

func main() {
    chs := make([]chan int, 3)
    for i := range chs {
        chs[i] = make(chan int, 1)
    }

    for i, ch := range chs {
        go func() {
            ch <- i
        }()
    }

    for _, ch := range chs {
        fmt.Println(<-ch)
    }
}
```

Question: what does this print?

**Answer (Go < 1.22)**: probably `2 2 2` or similar — the loop variables `i` and `ch` are shared across iterations. By the time the goroutines run, the loop has finished and `i == 2`, `ch == chs[2]`. The values are written to `chs[2]` three times (and the receives on `chs[0]` and `chs[1]` deadlock).

**Answer (Go 1.22+)**: each iteration has its own `i` and `ch`. Output is `0 1 2` in some order.

**Why the internals matter**: nothing about `hchan` per se, but it illustrates that the channel is identified by its pointer. Three goroutines all sending to `chs[2]` means three sends to the same `*hchan`. The first two trigger Path B (buffered, room) and the third parks on Path C until consumed... but no one consumes `chs[2]` more than once.

**Fix**: capture loop vars explicitly (`go func(i int, ch chan int) {...}(i, ch)`) or upgrade to Go 1.22+.

---

## Bug 9 — The Close-of-Receive-Only Compile Error

```go
package main

func consume(ch <-chan int) {
    close(ch)
}

func main() {
    ch := make(chan int)
    consume(ch)
}
```

**Answer**: compile error: `invalid operation: close(ch) (cannot close receive-only channel)`.

**Why the internals matter**: `<-chan int` is a *receive-only* view of the same `*hchan`. The type system enforces that `close` can only be called on bidirectional or send-only channels. Why? Because closing is a producer's responsibility; receivers should not close. The runtime's `closechan` does not care — it operates on `*hchan` — but the type system rejects the call at compile time.

---

## Bug 10 — The "Capacity Zero, Buffered Channel"

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 0) // explicit zero
    fmt.Println(cap(ch), len(ch))
    go func() { ch <- 1 }()
    fmt.Println(<-ch)
}
```

What does this print? Is `ch` buffered or unbuffered?

**Answer**: prints `0 0`, then `1`. `make(chan int, 0)` is identical to `make(chan int)` — both produce an unbuffered channel. `dataqsiz == 0`. The send-receive uses the rendezvous path (Path A in `chansend`).

**Why the internals matter**: knowing that "buffered" means `dataqsiz > 0` makes this unambiguous. The size argument 0 is allowed and produces the same struct as omitting it.

---

## Bug 11 — `select` on a Single Always-Ready Case

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int, 1)
    ch <- 1
    for i := 0; i < 1000000; i++ {
        select {
        case <-ch:
            ch <- 1
        }
    }
    fmt.Println("done")
    time.Sleep(10 * time.Millisecond)
}
```

What's wrong here?

**Answer**: nothing is wrong correctness-wise — it terminates and prints "done". But it's surprisingly slow. Each iteration does a `select` with one case (`<-ch`), which goes through `selectgo` instead of the fast `chanrecv1` path. Then `ch <- 1` is `chansend1`.

Compare with the same loop using `<-ch; ch <- 1` directly: it's faster because no `scase` array is allocated, no lock-and-poll machinery runs.

**Why the internals matter**: `select { case x := <-ch: ... }` is *not* identical to `x := <-ch`. The compiler generates more code: it sets up an `scase`, calls `selectgo`, dispatches on the return value. For a single case the compiler *could* optimise to the direct call but it generally does not (verify with `-S`).

**Fix**: if you have only one case, do not use `select`.

---

## Bug 12 — The Lost Wakeup You Cannot Have

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var mu sync.Mutex
    var v int
    var sent bool
    cond := sync.NewCond(&mu)
    ch := make(chan struct{})

    go func() {
        mu.Lock()
        for !sent {
            cond.Wait()
        }
        v++
        mu.Unlock()
        ch <- struct{}{}
    }()

    mu.Lock()
    sent = true
    cond.Signal()
    mu.Unlock()

    <-ch
    fmt.Println(v)
}
```

Question: can this program lose the wakeup or print anything other than `1`?

**Answer**: no — by design. `sync.Cond.Wait` releases the lock atomically with parking; `Signal` is observed reliably. The subsequent `ch <- struct{}{}` synchronises with `<-ch` via `hchan.lock`. `v` is therefore always `1`.

**Why the internals matter**: this is to verify your *positive* understanding. The combination of `Cond` and `chan` is solid because both rely on the same fundamental machinery: park goroutines in a queue, signal them under a lock, release the lock before resuming. There is no "lost wakeup" because the runtime arranges all the orderings.

If you doubt this, instrument with `runtime.NumGoroutine()` after each step. The producer parks (`Wait`), is signaled, takes the lock again, increments v, sends — and the receiver is parked the whole time until the send hands off via Path A.

---

## Bug 13 — The Channel That Won't Die

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    fmt.Println("before:", runtime.NumGoroutine())
    for i := 0; i < 1000; i++ {
        ch := make(chan int)
        go func() {
            <-ch
        }()
        _ = ch
    }
    time.Sleep(100 * time.Millisecond)
    fmt.Println("after:", runtime.NumGoroutine())
}
```

What does this print?

**Answer**: roughly `before: 1`, `after: 1001`. Each iteration creates a channel and a goroutine that parks on receive. The channel never gets a value or a close. The goroutine is permanently parked. The channel is held alive by the goroutine's `sudog.c`. The goroutine is held alive by `allgs`. Both leak.

**Why the internals matter**: parking on a channel is silent. There is no timeout, no error. Without explicit close or cancellation, these goroutines accumulate forever. In a long-running server this would eventually OOM.

**Fix**: combine the receive with a context: `select { case <-ch: case <-ctx.Done(): return }`. Always have a path out.

---

## Bug 14 — Iterating While Closing

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan int)
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        for v := range ch {
            fmt.Println(v)
        }
    }()
    ch <- 1
    close(ch)
    ch <- 2 // panic
    wg.Wait()
}
```

**Answer**: panics on `ch <- 2` with "send on closed channel". `close(ch)` set `c.closed = 1`. The next send sees this in `chansend` and panics. The receive `for v := range ch` would have printed `1`, then the `close` wakes the range loop with `ok == false`, exits cleanly.

**Why the internals matter**: `close` is final. Any subsequent send panics. The right pattern is: producer closes, no more sends. Or: a separate "I'm done" channel, with `close` done by an orchestrator who knows all producers are done.

---

## Bug 15 — The `select` Cleanup Race

This bug does *not* manifest in user code — it would be a runtime bug. But understanding why it cannot happen is illuminating.

Suppose `select` is rewritten naively: enqueue `sudog`s on every channel's wait queue, park, when woken just return. Channels other than the winner still have stale `sudog`s pointing at this goroutine. If the goroutine later does another channel op, the runtime might mistakenly find these stale sudogs.

The real runtime handles this by:
1. Setting `sg.isSelect = true` on each `sudog`.
2. After waking, the goroutine walks `g.waiting` (chain of all its sudogs) and unlinks each from its channel's queue.
3. In `waitq.dequeue`, the runtime uses `selectDone.CompareAndSwap(0, 1)` to skip already-claimed sudogs that haven't yet been cleaned up.

**Why the internals matter**: this is *why* `waitq.dequeue` is in a loop instead of returning the first node directly. Skipping `if sgp.isSelect && !sgp.g.selectDone.CompareAndSwap(0, 1) { continue }` would not break correctness on simple channels but would break `select` immediately. A subtle invariant maintained by the data structure.

---

## What to Read Next

- **`optimize.md`** — Performance-oriented mistakes and fixes grounded in `hchan` layout.
- **`tasks.md`** — Hands-on exercises to deepen the muscle memory.
- **`02-runtime-behavior/`** — Scheduler-level interactions with parked goroutines.

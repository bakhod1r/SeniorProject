# Send/Receive Flow — Find the Bug

A collection of buggy programs. Each one looks plausible but has a defect rooted in misunderstanding the send/receive flow. For each, the goal is to:

1. Identify the bug.
2. Explain *why* it bites at the runtime level (not just "channels are tricky").
3. Propose a fix.

## Table of Contents
1. [Bug 1: send-on-closed in a worker pool](#bug-1-send-on-closed-in-a-worker-pool)
2. [Bug 2: a deadlock that depends on direct-handoff order](#bug-2-a-deadlock-that-depends-on-direct-handoff-order)
3. [Bug 3: nil-channel read in a `select`](#bug-3-nil-channel-read-in-a-select)
4. [Bug 4: goroutine leak via parked sender](#bug-4-goroutine-leak-via-parked-sender)
5. [Bug 5: lost value on close](#bug-5-lost-value-on-close)
6. [Bug 6: race on the produced value](#bug-6-race-on-the-produced-value)
7. [Bug 7: `for range` plus close: the wrong order](#bug-7-for-range-plus-close-the-wrong-order)
8. [Bug 8: misuse of comma-ok](#bug-8-misuse-of-comma-ok)
9. [Bug 9: select fairness assumption](#bug-9-select-fairness-assumption)
10. [Bug 10: subtle double-receive](#bug-10-subtle-double-receive)
11. [Bug 11: ordering between two channels](#bug-11-ordering-between-two-channels)
12. [Bug 12: send-receive symmetry inversion](#bug-12-send-receive-symmetry-inversion)
13. [Bug 13: incorrect cancellation with park](#bug-13-incorrect-cancellation-with-park)
14. [Bug 14: starved receiver](#bug-14-starved-receiver)

---

## Bug 1: send-on-closed in a worker pool

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    jobs := make(chan int, 10)
    var wg sync.WaitGroup

    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := range jobs {
                fmt.Printf("worker %d got %d\n", id, j)
                if j == 0 {
                    close(jobs) // bug
                }
            }
        }(i)
    }

    for k := 1; k <= 5; k++ {
        jobs <- k
    }
    jobs <- 0 // sentinel
    wg.Wait()
}
```

**The bug**: workers close `jobs` from inside the loop. Meanwhile, the main goroutine is still sending. The race is: main might be in the middle of `chansend` when worker calls `close`. If main's `chansend` reaches the closed check after the close, it panics. If it reaches the direct-handoff first, the value goes through, but the next send panics.

**Why at runtime level**: `chansend` checks `c.closed != 0` under the lock. If the close happens after the lock check but before the next send, that next send panics. The lock-protected check is the only thing that makes "send on closed" detectable; it cannot be "send on about-to-be-closed."

**Fix**: only the *sender* should close (or the coordinator that orchestrates the senders). Workers should drain until the channel is closed by someone else.

```go
go func() {
    for k := 1; k <= 5; k++ {
        jobs <- k
    }
    close(jobs) // main closes after all sends done
}()
```

---

## Bug 2: a deadlock that depends on direct-handoff order

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    a := make(chan int)
    b := make(chan int)
    var wg sync.WaitGroup
    wg.Add(2)

    go func() {
        defer wg.Done()
        a <- 1
        v := <-b
        fmt.Println("g1 got", v)
    }()

    go func() {
        defer wg.Done()
        b <- 2
        v := <-a
        fmt.Println("g2 got", v)
    }()

    wg.Wait()
}
```

**The bug**: classic two-channel deadlock. G1 sends on `a`, waits for receive from `b`. G2 sends on `b`, waits for receive from `a`. Both send first — both park on `sendq`. Neither is there to receive.

**Why at runtime level**: G1's `chansend(a, ...)` finds `a.recvq` empty, parks on `a.sendq`. Same for G2 on `b.sendq`. Both are `_Gwaiting`. The main goroutine waits forever. Eventually the runtime detects deadlock and dies with "fatal error: all goroutines are asleep - deadlock!".

The send/receive flow always tries direct handoff *first*. There is no "wait for the other side to send first" semantic. If the order in the goroutines were reversed (receive first, then send), it would work.

**Fix**: reverse the order in one goroutine, or use unbuffered channels in opposite directions.

```go
go func() {
    defer wg.Done()
    v := <-b
    a <- 1
    fmt.Println("g1 got", v)
}()
```

---

## Bug 3: nil-channel read in a `select`

```go
package main

import "fmt"

func main() {
    var ch chan int
    select {
    case v := <-ch:
        fmt.Println(v)
    case <-make(chan struct{}):
        fmt.Println("default")
    }
}
```

**The bug**: `ch` is nil. The receive on a nil channel blocks forever. The second case (receive on an unbuffered fresh channel that nobody sends to) also blocks forever. The select has no default. Deadlock.

**Why at runtime level**: `chanrecv` checks `c == nil` first; if blocking, it calls `gopark(nil, nil, waitReasonChanReceiveNilChan, traceBlockForever, 2)`. A `select` with nil-channel cases simply omits those cases from the queue-registration phase (the case is never selectable). So the select waits on the other cases. Here, neither is selectable.

**Fix**: avoid nil channels unless you specifically want a "disabled case." Always provide a default if all branches might block.

```go
select {
case v := <-ch:
    fmt.Println(v)
default:
    fmt.Println("default")
}
```

---

## Bug 4: goroutine leak via parked sender

```go
package main

import (
    "fmt"
    "time"
)

func produce() chan int {
    ch := make(chan int)
    go func() {
        for i := 0; i < 1000; i++ {
            ch <- i
        }
    }()
    return ch
}

func main() {
    ch := produce()
    for i := 0; i < 3; i++ {
        fmt.Println(<-ch)
    }
    time.Sleep(time.Second)
    // function returns; the producer goroutine is parked forever
}
```

**The bug**: `produce` starts a goroutine that sends 1000 values. `main` consumes only 3. After three receives, the producer's 4th send parks on `sendq` because the channel is unbuffered and nobody is receiving. The goroutine is leaked.

**Why at runtime level**: the 4th send finds `recvq` empty, no buffer, allocates a sudog, enqueues on `sendq`, calls `gopark`. The goroutine is `_Gwaiting`. There is no mechanism in Go to wake a parked goroutine externally except via the channel itself. If the channel is dropped from `main`'s scope, the channel itself becomes unreachable — but the goroutine still references it via the sudog's `c` field. The runtime won't garbage-collect a live goroutine even if the channel is otherwise unreachable.

**Fix**: signal "I'm done" to the producer.

```go
func produce(done <-chan struct{}) chan int {
    ch := make(chan int)
    go func() {
        defer close(ch)
        for i := 0; i < 1000; i++ {
            select {
            case ch <- i:
            case <-done:
                return
            }
        }
    }()
    return ch
}
```

---

## Bug 5: lost value on close

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 1)
    ch <- 42

    go func() {
        v := <-ch
        fmt.Println("received", v)
    }()

    close(ch)
}
```

**The bug**: the program might or might not print "received 42" — usually it prints, but the main goroutine exits before the print can flush. If the goroutine doesn't get to run, the buffered 42 is lost.

**Why at runtime level**: closing a buffered channel does not lose the buffered values; the receiver will get them. But `main` returns immediately after `close`, which terminates the entire program (including the goroutine). The `chanrecv` for the goroutine may not have run yet.

This is a *program lifetime* bug, not a channel bug. But it is often presented as a "close ate my data" bug.

**Fix**: wait for the goroutine.

```go
done := make(chan struct{})
go func() {
    defer close(done)
    v := <-ch
    fmt.Println("received", v)
}()
close(ch)
<-done
```

---

## Bug 6: race on the produced value

```go
package main

import "fmt"

func main() {
    var data int
    done := make(chan struct{})

    go func() {
        close(done)
        data = 42 // race: write after close
    }()

    <-done
    fmt.Println(data)
}
```

**The bug**: the closer writes `data` *after* `close(done)`. The receiver (`<-done`) synchronises with the close, but the close-acquire only provides happens-before for writes that happened *before* the close. The write to `data` after close is racy.

**Why at runtime level**: `closechan` emits a `racerelease` event at the close. `<-done` emits a `raceacquire` when it observes the closure. This pair establishes happens-before for any writes the closer did *before* the close. The post-close write is unsynchronised; the reader's read of `data` is a data race.

**Fix**: write before close.

```go
go func() {
    data = 42
    close(done)
}()
```

---

## Bug 7: `for range` plus close: the wrong order

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    go func() {
        for v := range ch {
            fmt.Println(v)
        }
    }()

    close(ch) // bug: close before any send
    ch <- 1   // panic
    ch <- 2
    ch <- 3
}
```

**The bug**: `close(ch)` is called before any sends. The next `ch <- 1` panics with "send on closed channel."

**Why at runtime level**: `closechan` sets `c.closed = 1`. The next `chansend` takes the lock, sees `c.closed != 0`, unlocks and panics.

**Fix**: send first, then close.

```go
ch <- 1
ch <- 2
ch <- 3
close(ch)
```

---

## Bug 8: misuse of comma-ok

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 3)
    ch <- 1
    ch <- 2
    close(ch)

    for {
        v, ok := <-ch
        fmt.Println(v, ok)
        if v == 0 {
            break
        }
    }
}
```

**The bug**: the loop's exit condition is `v == 0`, not `!ok`. If a real value 0 is sent on the channel, the loop exits early. If no zero is sent, the loop continues forever printing `0 false` after close.

**Why at runtime level**: after close-and-drain, every receive returns `(zero, false)`. The loop never sees the false ok flag; it sees the value 0 (which happens to be the zero of `int`) and exits. But on a different element type (e.g., `string` with empty `""`), the bug would manifest differently.

**Fix**: check `ok`.

```go
for {
    v, ok := <-ch
    if !ok {
        break
    }
    fmt.Println(v)
}
```

Or use `for range`:

```go
for v := range ch {
    fmt.Println(v)
}
```

---

## Bug 9: select fairness assumption

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    fast := make(chan int)
    slow := make(chan int)

    go func() {
        for i := 0; ; i++ {
            fast <- i
        }
    }()
    go func() {
        for {
            time.Sleep(100 * time.Millisecond)
            slow <- -1
        }
    }()

    for i := 0; i < 10; i++ {
        select {
        case v := <-fast:
            fmt.Println("fast:", v)
        case v := <-slow:
            fmt.Println("slow:", v)
        }
    }
}
```

**The bug**: the developer expects "slow" cases to fire occasionally. In practice, `fast` is always ready (sender is in a tight loop), so the `select` will almost always pick the fast case. The slow case might never fire.

**Why at runtime level**: `selectgo` shuffles cases to provide randomness, but it only fires a case that is *ready*. If `fast` is always ready and `slow` is not, the random choice between cases is moot — `slow` is not a contender.

**Fix**: if you want fairness, implement it explicitly. If you want priority, use the nested-select pattern. If you want time-based, add a `time.After` case.

```go
for i := 0; i < 10; i++ {
    select {
    case v := <-slow:
        fmt.Println("slow:", v)
    default:
        select {
        case v := <-fast:
            fmt.Println("fast:", v)
        case v := <-slow:
            fmt.Println("slow:", v)
        }
    }
}
```

---

## Bug 10: subtle double-receive

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 1)
    ch <- 42

    var v int
    select {
    case v = <-ch:
    default:
    }
    v = <-ch // bug: blocks forever
    fmt.Println(v)
}
```

**The bug**: the `select` already received the 42. The buffer is now empty. The second `<-ch` blocks forever because nobody sends.

**Why at runtime level**: the first `select` case fires (channel had data); `chanrecv(c, &v, false)` returned `(true, true)`, value 42 in `v`. The second `<-ch` is a blocking `chanrecv(c, &v, true)`; finds empty channel, parks. Forever.

**Fix**: don't re-read. Or check whether the select fired.

```go
var v int
gotValue := false
select {
case v = <-ch:
    gotValue = true
default:
}
if !gotValue {
    v = <-ch
}
fmt.Println(v)
```

---

## Bug 11: ordering between two channels

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    a := make(chan int, 1)
    b := make(chan int, 1)
    var wg sync.WaitGroup
    wg.Add(1)

    go func() {
        defer wg.Done()
        a <- 1
        b <- 2
    }()

    fmt.Println(<-b, <-a)
    wg.Wait()
}
```

**The bug**: works (no panic, no deadlock), but the developer might have assumed that "send on `a` happens before send on `b`, therefore receiving from `b` first means `a` already has 1." That is true here only because both channels are buffered. If they were unbuffered, the goroutine would park on `a <- 1` and never reach `b <- 2`.

**Why at runtime level**: buffered channels do not synchronise across channels. A send on `a` happens-before a receive on `a`, but it does *not* happen-before a send on `b`. The Go memory model gives per-channel ordering, not global ordering.

This program works but is fragile. Tomorrow someone could change `a` to unbuffered and create a deadlock.

**Fix**: explicit synchronisation. If you need "after `a` has 1, send on `b`," receive from `a` first.

---

## Bug 12: send-receive symmetry inversion

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    ch <- 1 // bug: no receiver
    fmt.Println(<-ch)
}
```

**The bug**: sends on an unbuffered channel with no receiver. Deadlock immediately.

**Why at runtime level**: `chansend` locks, `recvq` empty, buffer empty (no buffer), allocates sudog, parks. The only goroutine is now `_Gwaiting`. Runtime detects "all goroutines asleep, deadlock" and panics.

**Fix**: spawn a goroutine to receive first, or make the channel buffered.

```go
go func() { fmt.Println(<-ch) }()
ch <- 1
```

---

## Bug 13: incorrect cancellation with park

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func slowSend(ctx context.Context, ch chan int, v int) {
    ch <- v // bug: doesn't check ctx
    fmt.Println("sent", v)
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
    defer cancel()

    ch := make(chan int)
    go slowSend(ctx, ch, 1)

    time.Sleep(100 * time.Millisecond)
    select {
    case v := <-ch:
        fmt.Println("got", v)
    case <-ctx.Done():
        fmt.Println("cancelled")
    }
}
```

**The bug**: `slowSend` doesn't respect ctx. If nobody receives, the goroutine parks forever. The main goroutine's `select` will see ctx.Done() first (timeout), print "cancelled", and exit. But `slowSend` is leaked.

**Why at runtime level**: `ch <- v` calls `chansend` with `block = true`. Once parked, no external mechanism wakes the sender. Context cancellation only works if the sender *participates* by including a `ctx.Done()` case in a `select`.

**Fix**:

```go
func slowSend(ctx context.Context, ch chan int, v int) {
    select {
    case ch <- v:
        fmt.Println("sent", v)
    case <-ctx.Done():
        fmt.Println("send cancelled")
    }
}
```

---

## Bug 14: starved receiver

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    runtime.GOMAXPROCS(1) // single-threaded
    ch := make(chan int)
    var wg sync.WaitGroup
    wg.Add(2)

    go func() {
        defer wg.Done()
        for i := 0; i < 1_000_000; i++ {
            ch <- i
        }
        close(ch)
    }()

    go func() {
        defer wg.Done()
        count := 0
        for range ch {
            count++
        }
        fmt.Println("count:", count)
    }()

    wg.Wait()
}
```

**The bug**: on GOMAXPROCS=1 with two goroutines and an unbuffered channel, each send/receive is a direct handoff. The sender ships a value, immediately tries to send again, parks (because the receiver hasn't been scheduled). The receiver gets ready, receives, parks (sender hasn't been scheduled). This works but is extremely slow due to constant context switching.

Worse: it might not deadlock, but the throughput is one round-trip per scheduler tick. For 1 million ops, this could take seconds.

**Why at runtime level**: on a single-P system, every send/receive that parks requires the other goroutine to be scheduled before progress. Each park-and-wake is a full scheduler round-trip. The throughput is bounded by the scheduler, not the lock or the memory.

**Fix**: either use a buffer (which avoids parking for small bursts) or `GOMAXPROCS > 1` (which lets the two goroutines run on different Ps and overlap).

```go
ch := make(chan int, 1024)
```

---

These bugs each illustrate a different failure mode rooted in the send/receive flow. Practising on them builds an intuition for "when I see this code, what runtime path will it take?" — the senior-level intuition.

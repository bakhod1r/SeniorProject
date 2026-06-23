# Buffer Mechanics — Find the Bug

A collection of buggy programs and code snippets that look like generic channel problems but are really buffer-mechanic problems. Each snippet is presented; then we explain the bug, the misunderstanding behind it, and how to fix it. Treat each one as a code-review exercise: read it, predict its behaviour, then read the analysis.

## Table of Contents
1. [Bug 1: The Disappearing Send](#bug-1-the-disappearing-send)
2. [Bug 2: Deadlock at Capacity 1](#bug-2-deadlock-at-capacity-1)
3. [Bug 3: `len(ch)` Race](#bug-3-lench-race)
4. [Bug 4: Buffer Holding Big Objects](#bug-4-buffer-holding-big-objects)
5. [Bug 5: Capacity From Untrusted Input](#bug-5-capacity-from-untrusted-input)
6. [Bug 6: Close, Then Send "Just One More"](#bug-6-close-then-send-just-one-more)
7. [Bug 7: Empty-Struct Buffer Misuse](#bug-7-empty-struct-buffer-misuse)
8. [Bug 8: Buffer Used to "Fix" a Deadlock](#bug-8-buffer-used-to-fix-a-deadlock)
9. [Bug 9: FIFO Assumption Violated by Two Senders](#bug-9-fifo-assumption-violated-by-two-senders)
10. [Bug 10: Receiver Sees Stale `len`](#bug-10-receiver-sees-stale-len)
11. [Bug 11: Pointer Leak Through the Buffer](#bug-11-pointer-leak-through-the-buffer)
12. [Bug 12: The Drop-Old That Drops Wrong](#bug-12-the-drop-old-that-drops-wrong)

---

## Bug 1: The Disappearing Send

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 1)
    ch <- 1
    if len(ch) < cap(ch) {
        ch <- 2
    } else {
        fmt.Println("would have dropped 2")
    }
    fmt.Println("len:", len(ch))
}
```

**Output.** `len: 1`.

**Bug.** `len(ch) == 1` and `cap(ch) == 1`, so the condition is false. The second send is skipped, but we expected it to succeed.

**Misunderstanding.** The author thought `len < cap` is "room available." In fact `len < cap` is true only when `len < cap`; at `len == cap` it is false. With capacity 1 and one value already buffered, there is no room.

**Fix.** Use `select` with `default` for non-blocking sends, or increase the capacity. Don't rely on `len`/`cap` for control flow at all.

---

## Bug 2: Deadlock at Capacity 1

```go
package main

func main() {
    ch := make(chan int, 1)
    ch <- 1
    ch <- 2
}
```

**Output.** Fatal error: all goroutines are asleep — deadlock.

**Bug.** Two sends, capacity 1, no receiver. The second send blocks forever.

**Misunderstanding.** "But it's buffered, isn't it supposed to not block?" — yes, only up to capacity. The buffer is a finite shock absorber. When full, sends behave like unbuffered ones.

**Fix.** Spawn a goroutine to receive, or increase capacity, or use a non-blocking send via `select`.

---

## Bug 3: `len(ch)` Race

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan int, 10)
    var wg sync.WaitGroup
    for i := 0; i < 20; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            if len(ch) < cap(ch) {
                ch <- i // PANIC POSSIBLE? NO. BUT NOT WHAT YOU THINK.
            }
        }(i)
    }
    wg.Wait()
    fmt.Println("len:", len(ch))
    // What's len now?
}
```

**Output.** `len` is some number ≤ 10, but not necessarily 10. Could be 9 or 8 even if all 20 goroutines saw "room available."

Actually it could even be more nuanced: some goroutines see "no room" and skip; others succeed. If many goroutines simultaneously see `len(ch) < cap(ch)` when `len == 9`, they all try to send. The lock serialises them; the first one succeeds (now `len == 10`), the rest block. Wait — they would *block* on the send, not skip, because the goroutine has already passed the if-check.

So actually `wg.Wait()` may hang because some goroutines are blocked on a full channel forever. That is the real bug.

**Misunderstanding.** `len(ch) < cap(ch)` and `ch <- v` are not atomic. Another goroutine can fill the buffer between the check and the send. The check provides no guarantee.

**Fix.** Use `select` with `default`:

```go
select {
case ch <- i:
default:
    // dropped
}
```

This is atomic under the channel lock.

---

## Bug 4: Buffer Holding Big Objects

```go
package main

type Big struct {
    Data [1 << 20]byte // 1 MB
}

func main() {
    ch := make(chan Big, 1000) // !!
    for i := 0; i < 1000; i++ {
        ch <- Big{}
    }
}
```

**Output.** Allocates 1 GB of buffer. Likely OOM on a normal machine.

**Bug.** `1000 * 1 MB = 1 GB`. The buffer is allocated up front.

**Misunderstanding.** "It's just a channel." But `make(chan T, N)` allocates `N * sizeof(T)` bytes immediately. Channels are not lazy.

**Fix.** Use `chan *Big` to send pointers instead of values. Each slot is 8 bytes. Or use a small buffer with explicit back-pressure.

---

## Bug 5: Capacity From Untrusted Input

```go
package main

import (
    "encoding/json"
    "os"
)

type Config struct {
    BufferSize int `json:"buffer_size"`
}

func main() {
    var c Config
    json.NewDecoder(os.Stdin).Decode(&c)
    ch := make(chan []byte, c.BufferSize)
    _ = ch
}
```

**Output.** If an attacker provides `buffer_size: 1000000000`, the program tries to allocate 8 GB (1B slots × 8 bytes per pointer). OOM or memory pressure DoS.

**Bug.** Capacity is not validated.

**Misunderstanding.** "It's just a config field." Capacity is a resource cap. Treat it like one.

**Fix.** Validate `c.BufferSize` against a sane upper bound (e.g., 65536) before passing it to `make`.

---

## Bug 6: Close, Then Send "Just One More"

```go
package main

func main() {
    ch := make(chan int, 5)
    ch <- 1
    ch <- 2
    close(ch)
    ch <- 3 // PANIC
}
```

**Output.** Runtime panic: "send on closed channel."

**Bug.** Sending after close.

**Misunderstanding.** "But the buffer has room (3 free slots)." Buffer state is irrelevant for `send on closed`. The runtime checks `closed` first. Buffer status is checked only if not closed.

**Fix.** Decide who closes the channel, and ensure no further sends happen after that.

---

## Bug 7: Empty-Struct Buffer Misuse

```go
package main

import "fmt"

func main() {
    done := make(chan struct{}, 1)
    done <- struct{}{}
    done <- struct{}{}
    fmt.Println("done")
}
```

**Output.** Deadlock — "fatal error: all goroutines are asleep."

**Bug.** `chan struct{}` with capacity 1, two sends, no receiver. The second send blocks forever.

**Misunderstanding.** "But `struct{}` has zero size! There's no actual data!" The slot *count* still matters. The buffer has 1 slot regardless of element size. The second send finds the buffer full and parks.

**Fix.** Either increase capacity or have a receiver. For "done" signalling, the canonical pattern is unbuffered + close:

```go
done := make(chan struct{})
go func() {
    // work
    close(done)
}()
<-done
```

---

## Bug 8: Buffer Used to "Fix" a Deadlock

```go
package main

import "fmt"

func sendN(ch chan int, n int) {
    for i := 0; i < n; i++ {
        ch <- i
    }
}

func main() {
    ch := make(chan int, 1000000) // "to be safe"
    sendN(ch, 1000)
    close(ch)
    for v := range ch {
        _ = v
    }
    fmt.Println("done")
}
```

**Output.** Works fine — but only because the buffer is huge.

**Bug.** The "real" structure is sequential (send 1000, then receive 1000). With a smaller buffer, it would block sooner. With a buffer of 1 it would have deadlocked on the first send if there were no receiver.

**Misunderstanding.** "A large buffer means I don't have to think about synchronisation." In production, your input scales, and one day `n = 1_000_001` exceeds capacity. Now it deadlocks.

**Fix.** Spawn a receiver goroutine before the sender starts. The buffer size should be a small, intentional shock absorber, not a bottomless pit.

---

## Bug 9: FIFO Assumption Violated by Two Senders

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan string, 10)
    var wg sync.WaitGroup
    wg.Add(2)
    go func() {
        defer wg.Done()
        ch <- "A"
        ch <- "B"
        ch <- "C"
    }()
    go func() {
        defer wg.Done()
        ch <- "1"
        ch <- "2"
        ch <- "3"
    }()
    wg.Wait()
    close(ch)
    for v := range ch {
        fmt.Println(v)
    }
}
```

**Output.** Depends on lock ordering — typical: `A 1 B 2 C 3` or `1 A 2 B 3 C` or any interleaving. Not deterministic.

**Bug.** The author assumed total ordering of sends. The channel's FIFO is per-acquisition-of-the-lock, not per-real-time.

**Misunderstanding.** "Channels are FIFO." They are, but only relative to the order the lock was acquired. Two goroutines competing for the lock can interleave in any way.

**Fix.** If you need a global order, send tagged values and sort at the consumer; or serialize the senders explicitly.

---

## Bug 10: Receiver Sees Stale `len`

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 5)
    for i := 0; i < 3; i++ {
        ch <- i
    }
    if len(ch) > 0 {
        v := <-ch
        // SOMEONE ELSE COULD HAVE DRAINED IT?
        fmt.Println(v)
    }
}
```

In a single-goroutine program this is fine. But if other goroutines also drain `ch`, the `len(ch) > 0` check can pass and then `<-ch` can still block (if another goroutine drained the buffer before this receive ran).

**Bug.** Time-of-check-to-time-of-use (TOCTOU) race between `len(ch)` and the receive.

**Misunderstanding.** Same as Bug 3: `len` is not synchronised with operations.

**Fix.** Use `select`:

```go
select {
case v := <-ch:
    fmt.Println(v)
default:
    fmt.Println("empty")
}
```

---

## Bug 11: Pointer Leak Through the Buffer

```go
package main

import "fmt"

type Big struct {
    data [1 << 20]byte
}

func main() {
    ch := make(chan *Big, 1000)
    for i := 0; i < 1000; i++ {
        ch <- &Big{}
    }
    // ... do other work, never drain ch
    // ch is reachable from main; the 1000 *Big values are alive.
    fmt.Println("done")
}
```

**Bug.** The buffer holds 1000 pointers, each to a 1 MB struct. Total memory held: ~1 GB. The garbage collector cannot reclaim them because the channel keeps them reachable.

**Misunderstanding.** "I'm storing pointers, so it's cheap." The pointers themselves are cheap (8 KB total). The objects they point to are not.

**Fix.** Drain the channel before it grows large, or close it and let GC reclaim the channel itself (which drops the references). Even better: don't accumulate in the first place.

---

## Bug 12: The Drop-Old That Drops Wrong

```go
package main

import "fmt"

func setLatest(ch chan int, v int) {
    select {
    case ch <- v:
    default:
        <-ch
        ch <- v
    }
}

func main() {
    ch := make(chan int, 1)
    setLatest(ch, 1)
    setLatest(ch, 2)
    setLatest(ch, 3)
    fmt.Println(<-ch)
}
```

**Expected output.** `3`.

**Actual output.** Usually `3`, but the function is racy: between `<-ch` and `ch <- v`, another goroutine could send. In a multi-goroutine setting the "latest" guarantee fails.

**Bug.** Two-step drain-and-set is not atomic. Under concurrency, the channel could be empty when we try to send (a receiver consumed the value), and then the send blocks.

**Misunderstanding.** `select` makes single operations atomic, not multi-step sequences.

**Fix.** Use a mutex around the whole operation:

```go
type Latest struct {
    mu sync.Mutex
    ch chan int
}
func (l *Latest) Set(v int) {
    l.mu.Lock()
    defer l.mu.Unlock()
    select {
    case l.ch <- v:
    default:
        <-l.ch
        l.ch <- v
    }
}
```

Or use `atomic.Value` for a non-channel implementation.

---

## Common Threads in These Bugs

- **Capacity is not a tuning knob you raise to make problems go away.** Each of Bugs 4, 5, 8 is "buffer too big" symptom.
- **`len`/`cap` are not control-flow primitives in concurrent code.** Bugs 3 and 10.
- **Closed-channel semantics override buffer state.** Bug 6.
- **Zero-size element does not mean zero-slot buffer.** Bug 7.
- **FIFO is per-lock, not per-real-time.** Bug 9.
- **Buffer keeps references alive.** Bug 11.
- **Composite operations need a higher-level lock.** Bug 12.

If you can spot these patterns in code review, you can prevent most channel-buffer bugs before they ship.

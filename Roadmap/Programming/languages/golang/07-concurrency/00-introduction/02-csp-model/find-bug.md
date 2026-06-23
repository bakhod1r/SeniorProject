# CSP Model — Find the Bug

> Each snippet contains at least one CSP-related bug. Diagnose, then read the explanation. Bugs include closed-channel panics, missed close, deadlocks, race-prone hybrids, broken pipeline shutdown, and CSP-discipline violations.

---

## Bug 1 — Receiver closes the channel

```go
func consume(ch <-chan int) {
    for v := range ch {
        fmt.Println(v)
    }
    close(ch)
}
```

**What is wrong?**

You cannot call `close` on a receive-only channel (the type is `<-chan int`, not `chan int`). Also, the receiver should never close — only the sender (or designated owner) does. This program does not compile, and the design is wrong.

**Fix.**

The sender closes:

```go
func produce(ch chan<- int) {
    defer close(ch)
    for i := 0; i < 10; i++ {
        ch <- i
    }
}

func consume(ch <-chan int) {
    for v := range ch {
        fmt.Println(v)
    }
}
```

---

## Bug 2 — Closing a channel from multiple goroutines

```go
ch := make(chan int)
for i := 0; i < 5; i++ {
    go func() {
        defer close(ch)
        ch <- compute()
    }()
}
```

**What is wrong?**

Five goroutines each `close(ch)`. The first close is fine; the rest panic. The program crashes.

**Fix.**

Either appoint a single closer, or close once via `sync.Once`:

```go
var once sync.Once
closeOnce := func() { once.Do(func() { close(ch) }) }

for i := 0; i < 5; i++ {
    go func() {
        defer closeOnce()
        ch <- compute()
    }()
}
```

Or better, restructure: use a `WaitGroup` and a coordinator goroutine that closes once:

```go
var wg sync.WaitGroup
for i := 0; i < 5; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        ch <- compute()
    }()
}
go func() {
    wg.Wait()
    close(ch)
}()
```

---

## Bug 3 — Send on closed channel

```go
ch := make(chan int, 5)
close(ch)
ch <- 1
```

**What is wrong?**

Sending on a closed channel panics with "send on closed channel."

**Fix.**

Coordinate so sends do not happen after close. Typical pattern: the sender owns close and ensures all sends happen before.

---

## Bug 4 — Pipeline that does not close output

```go
func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        for v := range in {
            out <- v * v
        }
        // forgot close(out)
    }()
    return out
}
```

**What is wrong?**

When `in` closes and the loop exits, the goroutine returns without closing `out`. Downstream `range out` loops forever (or the receiver hangs waiting for the next value).

**Fix.**

```go
go func() {
    defer close(out)
    for v := range in {
        out <- v * v
    }
}()
```

`defer close(out)` ensures close on every exit path.

---

## Bug 5 — Buffered channel as a leak

```go
func fetch(ctx context.Context) (int, error) {
    ch := make(chan int)
    go func() {
        ch <- compute()
    }()
    select {
    case v := <-ch:
        return v, nil
    case <-ctx.Done():
        return 0, ctx.Err()
    }
}
```

**What is wrong?**

If `ctx.Done()` fires first, the function returns with the error. The spawned goroutine is still trying to send on `ch`, but there is no receiver. The goroutine blocks forever.

**Fix.**

Use a buffered channel of capacity 1, so the send always succeeds:

```go
ch := make(chan int, 1)
```

Now even if no one reads, the goroutine completes the send and exits.

---

## Bug 6 — Sending on a nil channel

```go
var ch chan int
go func() {
    ch <- 1
}()
```

**What is wrong?**

`ch` is nil. Send on a nil channel blocks forever. The goroutine leaks silently. The runtime does not detect this as a deadlock unless the program reaches the "all goroutines asleep" state.

**Fix.**

Initialise the channel:

```go
ch := make(chan int)
```

---

## Bug 7 — Range over a never-closed channel

```go
ch := make(chan int)
go func() {
    for i := 0; i < 10; i++ {
        ch <- i
    }
    // forgot close(ch)
}()
for v := range ch {
    fmt.Println(v)
}
```

**What is wrong?**

The producer sends 10 values and exits without closing. The `range` loop receives all 10 values and then blocks waiting for more. The main goroutine hangs. Eventually the runtime detects deadlock and panics.

**Fix.**

Close the channel when the producer is done:

```go
go func() {
    defer close(ch)
    for i := 0; i < 10; i++ {
        ch <- i
    }
}()
```

---

## Bug 8 — Deadlock: send to oneself

```go
func main() {
    ch := make(chan int)
    ch <- 1
}
```

**What is wrong?**

The unbuffered send has no receiver. The main goroutine blocks forever. The runtime detects all-goroutines-asleep and panics.

**Fix.**

Send from another goroutine, or use a buffered channel.

---

## Bug 9 — `for { select { } }` without exit

```go
go func() {
    for {
        select {
        case v := <-in:
            process(v)
        case <-time.After(time.Second):
            fmt.Println("heartbeat")
        }
    }
}()
```

**What is wrong?**

No cancellation case. The goroutine runs forever even if no one cares. Leaks.

**Fix.**

Add `<-ctx.Done()`:

```go
for {
    select {
    case v := <-in:
        process(v)
    case <-time.After(time.Second):
        fmt.Println("heartbeat")
    case <-ctx.Done():
        return
    }
}
```

---

## Bug 10 — Two goroutines own a channel

```go
type Pipeline struct {
    ch chan int
}

func (p *Pipeline) Producer() {
    for i := 0; i < 100; i++ {
        p.ch <- i
    }
    close(p.ch)
}

func (p *Pipeline) AlternateProducer() {
    for i := 100; i < 200; i++ {
        p.ch <- i
    }
    close(p.ch) // PANIC if Producer also closed
}
```

**What is wrong?**

Both methods close the same channel. If both run, the second `close` panics.

**Fix.**

Choose: one producer closes; or use `sync.Once`; or have a coordinator close after both producers are done.

---

## Bug 11 — Holding a lock during a channel send

```go
type Service struct {
    mu sync.Mutex
    ch chan Event
}

func (s *Service) Handle(e Event) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.ch <- e // blocks if the channel is full; lock held during the block
}
```

**What is wrong?**

If `ch` is full or has no receiver, the send blocks. The mutex stays held. Every other caller of `Handle` blocks behind the mutex. Cascading failure.

**Fix.**

Release the lock before the send:

```go
func (s *Service) Handle(e Event) {
    s.mu.Lock()
    ch := s.ch
    s.mu.Unlock()
    ch <- e
}
```

Or use a buffered channel sized for expected load, and accept block as backpressure.

---

## Bug 12 — Receiving from a closed channel as a sentinel value

```go
ch := make(chan int, 10)
ch <- 1
ch <- 0   // intended sentinel
close(ch)

for {
    v := <-ch
    if v == 0 {
        break
    }
    process(v)
}
```

**What is wrong?**

The loop breaks on `0`. But after close, every subsequent receive returns 0 (the zero value). The code "works" but the design is fragile: any legitimate `0` value also triggers the break. Also, after close, the loop would receive `0` indefinitely — the break is the only exit.

**Fix.**

Use the two-value form:

```go
for {
    v, ok := <-ch
    if !ok {
        break
    }
    process(v)
}
```

Or `range`:

```go
for v := range ch {
    process(v)
}
```

---

## Bug 13 — Forgetting to drain a channel before exit

```go
ch := make(chan int)
go func() {
    for i := 0; i < 10; i++ {
        ch <- i
    }
}()
v := <-ch
fmt.Println(v)
// the goroutine is still sending — leaks
```

**What is wrong?**

The main goroutine reads one value and exits. The spawned goroutine still wants to send 9 more, all blocked. They leak (until program exit).

**Fix.**

Either drain the channel:

```go
for v := range ch { fmt.Println(v) }
```

Or signal cancellation:

```go
done := make(chan struct{})
go func() {
    defer close(ch)
    for i := 0; i < 10; i++ {
        select {
        case ch <- i:
        case <-done:
            return
        }
    }
}()
```

---

## Bug 14 — Misusing `default` in `select`

```go
for {
    select {
    case v := <-ch:
        process(v)
    default:
        // do "background" work
        background()
    }
}
```

**What is wrong?**

The `default` case fires whenever `ch` is not immediately ready. The loop becomes a busy-spin polling `ch` and doing `background()` repeatedly. Burns CPU; never sleeps; starves other goroutines unless explicit yields.

**Fix.**

If you want to "do background work but also handle messages," use a `time.Ticker`:

```go
t := time.NewTicker(100 * time.Millisecond)
defer t.Stop()
for {
    select {
    case v := <-ch:
        process(v)
    case <-t.C:
        background()
    }
}
```

Or restructure so background is a separate goroutine.

---

## Bug 15 — CSP discipline violation

```go
type Job struct {
    Data []byte
}

func producer(jobs chan<- *Job) {
    j := &Job{Data: make([]byte, 1000)}
    jobs <- j
    j.Data[0] = 99 // BUG: writing after handing off
}

func consumer(jobs <-chan *Job) {
    for j := range jobs {
        process(j.Data)
    }
}
```

**What is wrong?**

After sending `j` on the channel, the producer mutates `j.Data`. This violates the CSP discipline (ownership transfer): the consumer now has a moving target. The race detector flags it.

**Fix.**

Do not touch the value after sending. If you need to keep it around, copy it before sending:

```go
copy := *j
copy.Data = append([]byte(nil), j.Data...)
jobs <- &copy
```

Better: design so the producer's intent is clear — only mutate before sending.

---

## Bug 16 — Goroutine started without cancellation context

```go
func startWorker() {
    go func() {
        for {
            doSomething()
        }
    }()
}
```

**What is wrong?**

No way to stop the worker. Leaks for the lifetime of the program. May be intentional for daemons but should be explicit.

**Fix.**

Provide a stop mechanism:

```go
type Worker struct {
    cancel context.CancelFunc
    done   chan struct{}
}

func StartWorker(ctx context.Context) *Worker {
    ctx, cancel := context.WithCancel(ctx)
    w := &Worker{cancel: cancel, done: make(chan struct{})}
    go func() {
        defer close(w.done)
        for {
            select {
            case <-ctx.Done():
                return
            default:
                doSomething()
            }
        }
    }()
    return w
}

func (w *Worker) Close() {
    w.cancel()
    <-w.done
}
```

---

## Bug 17 — Fan-in that leaks

```go
func merge(a, b <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        for v := range a {
            out <- v
        }
    }()
    go func() {
        for v := range b {
            out <- v
        }
    }()
    return out
}
```

**What is wrong?**

The function never closes `out`. The consumer's `range out` loop never exits. Also, if the consumer stops reading, both goroutines block forever on send.

**Fix.**

Wait for both inputs to close, then close output:

```go
func merge(a, b <-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(2)
    forward := func(c <-chan int) {
        defer wg.Done()
        for v := range c {
            out <- v
        }
    }
    go forward(a)
    go forward(b)
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

Add a context for consumer-side cancellation if needed.

---

## Bug 18 — `select` with one always-ready case starves others

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

**What is wrong?**

If `fast` always has values ready, `select` picks among ready cases uniformly at random. Over time `fast` and `slow` are picked roughly evenly. But if `slow` is rarely ready, `fast` gets all the attention.

This is *not* starvation per se (the runtime is fair), but if you needed `slow` to keep up, you should restructure.

**Fix.**

If `slow` should be prioritised when its values appear, use a two-phase select:

```go
for {
    // First chance: try slow exclusively
    select {
    case v := <-slow:
        process(v)
        continue
    default:
    }
    // Otherwise: either
    select {
    case v := <-fast:
        process(v)
    case v := <-slow:
        process(v)
    }
}
```

---

## Bug 19 — Empty `select{}`

```go
go func() {
    setup()
    select{}
}()
```

**What is wrong?**

`select {}` blocks forever — no cases ever fire. The goroutine cannot exit. Intentional for "park this goroutine forever" patterns, but usually a bug.

**Fix.**

Use `<-ctx.Done()` for cancellation, or design the goroutine to do useful work.

---

## Bug 20 — Channel of pointers + shared state

```go
counter := &Counter{}
ch := make(chan *Counter)

go func() {
    c := <-ch
    c.value++
}()
ch <- counter
counter.value++ // BUG: also modifying via the original reference
```

**What is wrong?**

The "ownership transfer" via the channel is undone by the sender continuing to hold and mutate the original reference. Race condition.

**Fix.**

After sending, do not touch the original. Or send a copy instead of a pointer.

---

## Bug 21 — Implicit assumption that select is round-robin

```go
for i := 0; i < 100; i++ {
    select {
    case <-a:
    case <-b:
    }
}
```

**What is wrong?**

The comment says "balance reads between a and b." `select` picks among ready cases uniformly at random, not in order. If both are always ready, you get roughly 50/50, but with no guarantee on any specific round.

**Fix.**

If you need exact balancing, alternate explicitly:

```go
for i := 0; i < 100; i++ {
    if i%2 == 0 {
        <-a
    } else {
        <-b
    }
}
```

---

## Bug 22 — Buffered channel size accidentally creates back-pressure issues

```go
in := make(chan int, 1_000_000)
go produce(in)
go consume(in)
```

**What is wrong?**

A buffer of 1 million sounds generous. But if the producer is faster than the consumer (which is the whole reason for buffers), the buffer fills with up to a million elements. If each is 100 bytes, that is 100 MB of pending work. Under burst, the program OOMs.

**Fix.**

Bound the buffer to expected burst. If the buffer fills, you have a real problem: producer is overloading the consumer. Either:

- Block the producer (backpressure).
- Drop work (load shedding).
- Slow down upstream.

A giant buffer just hides the problem until it grows large enough to crash.

---

## Bug 23 — `select` not seeing closed channel

```go
var done chan struct{}

for {
    select {
    case <-done:
        return
    case v := <-work:
        process(v)
    }
}
```

**What is wrong?**

`done` is nil. The `<-done` case never fires. The loop runs until `work` closes (or forever if it doesn't).

**Fix.**

Initialise `done`:

```go
done := make(chan struct{})
```

Or guard initialisation properly before the loop.

---

## Bug 24 — Two goroutines compete for the same receive

```go
done := make(chan struct{})

go func() {
    <-done
    cleanup()
}()
go func() {
    <-done
    cleanup()
}()

close(done)
```

**What is wrong?**

This *does* work — closing `done` broadcasts; both goroutines see the close (zero-value receive). But if `done` were a synchronous channel with a single send (not a close), only one goroutine would receive; the other would block forever.

Be deliberate about which idiom you want: close-to-broadcast vs send-once.

---

## Bug 25 — Forgetting that `select` is not a switch

```go
select {
case <-a:
    handleA()
case <-b:
    handleB()
    // forgot break; intended fallthrough?
    handleC()
}
```

**What is wrong?**

`select` does not fall through like `switch`. Each case is independent; the chosen one's body runs to completion. The code `handleC()` is reached only if `<-b` was the chosen case — which is fine, but the comment suggests the author thought it might also run if `<-a` happened.

**Fix.**

If both `handleB` and `handleC` should run after `<-b`, the current code is correct. If `handleC` should run regardless, place it outside the `select`.

---

## Closing

CSP-style bugs cluster around the same themes:

- Improper channel ownership (who closes? who can send after close?).
- Missed close = leaked range loops.
- Send on closed channel = panic.
- Holding mutexes across channel sends = cascading blocks.
- Mutation after ownership transfer = race.
- Goroutines without cancellation = leaks.

Run the race detector. Use `goleak` in tests. Document who owns each channel. Always have a cancellation path.

CSP makes some bug classes go away (data races on shared state). It introduces others (channel-shape bugs). The net is usually positive *if* the discipline is followed.

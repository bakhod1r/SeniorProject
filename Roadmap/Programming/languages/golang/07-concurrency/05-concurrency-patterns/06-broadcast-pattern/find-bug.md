# Broadcast Pattern — Find the Bug

Each section presents a broken implementation, asks you to find the bug *before* reading the analysis, and then explains both the failure mode and the fix.

## Table of Contents
1. [Bug 1: Closing Done Twice](#bug-1-closing-done-twice)
2. [Bug 2: Subscribers Close Their Own Channel](#bug-2-subscribers-close-their-own-channel)
3. [Bug 3: Hub Holds Mutex During Publish](#bug-3-hub-holds-mutex-during-publish)
4. [Bug 4: Map Iteration Without Lock](#bug-4-map-iteration-without-lock)
5. [Bug 5: Send-on-Closed Race](#bug-5-send-on-closed-race)
6. [Bug 6: Forgotten Unsubscribe Drains Memory](#bug-6-forgotten-unsubscribe-drains-memory)
7. [Bug 7: Blocked Publish Blocks Shutdown](#bug-7-blocked-publish-blocks-shutdown)
8. [Bug 8: Loop Variable Capture in Subscribe](#bug-8-loop-variable-capture-in-subscribe)
9. [Bug 9: Cond.Wait Without Loop](#bug-9-condwait-without-loop)
10. [Bug 10: Subscribe-During-Close Race](#bug-10-subscribe-during-close-race)
11. [Bug 11: Drop Oldest Without Retry](#bug-11-drop-oldest-without-retry)
12. [Bug 12: Receiver Discards `ok` Flag](#bug-12-receiver-discards-ok-flag)

---

## Bug 1: Closing Done Twice

### Broken code

```go
type Service struct {
    done chan struct{}
}

func (s *Service) Stop() {
    close(s.done)
}

func main() {
    s := &Service{done: make(chan struct{})}
    go s.Run()
    s.Stop()
    s.Stop() // problem
}
```

**What goes wrong?** Pause and think.

### Failure mode

The second `Stop()` panics with `close of closed channel`. Calling `close` on an already-closed channel is always a panic in Go.

This is sometimes silent in tests because a panic in a non-main goroutine crashes only that goroutine (with `recover`), but a panic in main goroutine *kills the program*. In production, double-close panics show up as crash reports.

### Fix

Wrap `close` in `sync.Once`:

```go
type Service struct {
    done     chan struct{}
    stopOnce sync.Once
}

func (s *Service) Stop() {
    s.stopOnce.Do(func() { close(s.done) })
}
```

Now `Stop` is idempotent. Multiple callers can request shutdown; only the first one actually closes the channel.

---

## Bug 2: Subscribers Close Their Own Channel

### Broken code

```go
type Hub struct {
    publish chan string
    subs    []chan string
}

func subscriber(in <-chan string) {
    for msg := range in {
        fmt.Println(msg)
    }
}

func main() {
    h := &Hub{publish: make(chan string)}
    s := make(chan string)
    h.subs = append(h.subs, s)
    go subscriber(s)
    go h.Run()
    h.publish <- "x"

    time.Sleep(100 * time.Millisecond)
    close(s) // subscriber decides it has had enough
}
```

**What goes wrong?**

### Failure mode

Eventually the hub does:

```go
for _, s := range h.subs {
    s <- v // PANIC: send on closed channel
}
```

The first send after `close(s)` panics. The hub goroutine crashes, taking the whole broadcast down.

### Fix

Establish a clear ownership rule: **only the hub closes subscriber channels**. Subscribers signal departure through a separate `Unsubscribe()` call that the hub handles:

```go
type subscription struct {
    ch       chan string
    closeOnce sync.Once
}

func (h *Hub) Unsubscribe(s *subscription) {
    h.mu.Lock()
    defer h.mu.Unlock()
    // remove from map first, then close
    delete(h.subs, s)
    s.closeOnce.Do(func() { close(s.ch) })
}
```

The hub takes the lock so no concurrent publish is in progress. After removing `s` from the map, no further sends can target it. Then close is safe.

---

## Bug 3: Hub Holds Mutex During Publish

### Broken code

```go
type Hub struct {
    mu   sync.Mutex
    subs map[*sub]struct{}
}

func (h *Hub) Publish(v string) {
    h.mu.Lock()
    defer h.mu.Unlock()
    for s := range h.subs {
        s.ch <- v // blocking send under lock
    }
}

func (h *Hub) Subscribe() *sub {
    h.mu.Lock()
    defer h.mu.Unlock()
    s := &sub{ch: make(chan string, 4)}
    h.subs[s] = struct{}{}
    return s
}
```

**What goes wrong?**

### Failure mode

Two coupled problems:

1. **Slow subscriber blocks all subscribes.** If `s.ch <- v` blocks (subscriber's buffer is full and policy is Block), `Subscribe` waits indefinitely. New users cannot join.
2. **Mutex contention.** Even with fast subscribers, every Publish takes the exclusive Mutex, so concurrent Publishes serialise. Throughput is capped to one Publish at a time.

### Fix

Use `RWMutex`. Publish takes `RLock` (multiple publishes in parallel), mutators take `Lock`:

```go
func (h *Hub) Publish(v string) {
    h.mu.RLock()
    defer h.mu.RUnlock()
    for s := range h.subs {
        select {
        case s.ch <- v:
        default: // drop on overflow
        }
    }
}

func (h *Hub) Subscribe() *sub {
    h.mu.Lock()
    defer h.mu.Unlock()
    // ...
}
```

Even better: do not Block on subscriber sends. Use a non-blocking `select` with a drop fallback (`DropNewest`) or per-subscriber goroutine. Now slow subscribers never affect anyone.

---

## Bug 4: Map Iteration Without Lock

### Broken code

```go
type Hub struct {
    subs map[*sub]struct{}
}

func (h *Hub) Publish(v string) {
    for s := range h.subs {
        s.ch <- v
    }
}

func (h *Hub) Subscribe() *sub {
    s := &sub{ch: make(chan string, 4)}
    h.subs[s] = struct{}{}
    return s
}
```

**What goes wrong?**

### Failure mode

Concurrent map write and read = **fatal**. Go's runtime explicitly detects this and aborts with `fatal error: concurrent map writes` (or `concurrent map read and map write`). Not a panic — a process-killing abort. No `recover()` will help.

Run under `-race` to catch it deterministically.

### Fix

Use `sync.RWMutex`:

```go
func (h *Hub) Publish(v string) {
    h.mu.RLock()
    defer h.mu.RUnlock()
    for s := range h.subs {
        select { case s.ch <- v: default: }
    }
}
```

Or use `sync.Map`. For pub/sub workloads, `RWMutex` is usually faster because publish is a long iteration; `sync.Map` is tuned for point lookups.

---

## Bug 5: Send-on-Closed Race

### Broken code

```go
func (h *Hub) Publish(v string) {
    h.mu.RLock()
    subs := make([]*sub, 0, len(h.subs))
    for s := range h.subs {
        subs = append(subs, s)
    }
    h.mu.RUnlock()
    // Note: lock released before sending.
    for _, s := range subs {
        s.ch <- v
    }
}

func (h *Hub) Unsubscribe(s *sub) {
    h.mu.Lock()
    delete(h.subs, s)
    close(s.ch)
    h.mu.Unlock()
}
```

**What goes wrong?**

### Failure mode

Between `h.mu.RUnlock()` and `s.ch <- v`, another goroutine can call `Unsubscribe(s)`. That closes `s.ch`. The next `s.ch <- v` panics with `send on closed channel`.

The author tried to be clever by snapshotting subscribers and releasing the lock, but it broke the invariant "no send on a closed channel."

### Fix

Either keep the read lock for the entire publish (the standard approach), or change the close protocol to not close the channel but to mark the subscription closed and have the publisher check:

```go
type sub struct {
    ch     chan string
    closed atomic.Bool
}

func (h *Hub) Publish(v string) {
    h.mu.RLock()
    subs := make([]*sub, 0, len(h.subs))
    for s := range h.subs {
        subs = append(subs, s)
    }
    h.mu.RUnlock()

    for _, s := range subs {
        if s.closed.Load() { continue }
        select { case s.ch <- v: default: }
    }
}
```

But this still has a race: `Unsubscribe` may close `s.ch` between the `Load` and the send. Production-grade pattern: keep the RLock, period. Or use the COW pattern where Unsubscribe replaces the slice and the snapshot held by Publish is unaffected by close.

---

## Bug 6: Forgotten Unsubscribe Drains Memory

### Broken code

```go
func handleConnection(conn net.Conn, h *Hub) {
    sub := h.Subscribe()
    // forgot defer sub.Unsubscribe()
    for {
        select {
        case msg := <-sub.C():
            fmt.Fprintln(conn, msg)
        case <-time.After(5 * time.Minute):
            conn.Close()
            return // subscription leaked
        }
    }
}
```

**What goes wrong?**

### Failure mode

Each connection adds one subscription. When the connection closes, the subscription stays in the hub forever. Memory grows linearly with connection count, eventually OOM.

The buffer for each leaked subscription holds events the hub continues to send. Over time, each leaked subscription's buffer fills, and `DropNewest` discards everything — no functional issue for live subscribers, but the memory pinned by the buffers stays.

### Fix

Always `defer sub.Unsubscribe()`:

```go
func handleConnection(conn net.Conn, h *Hub) {
    sub := h.Subscribe()
    defer sub.Unsubscribe()
    // ...
}
```

Defensively, you can bind subscriptions to a `context.Context` that auto-unsubscribes when ctx is done:

```go
func (h *Hub) SubscribeCtx(ctx context.Context) Subscription[T] {
    s := h.Subscribe()
    go func() { <-ctx.Done(); s.Unsubscribe() }()
    return s
}
```

The extra goroutine costs 8 KB but the leak is impossible.

---

## Bug 7: Blocked Publish Blocks Shutdown

### Broken code

```go
type Hub struct {
    mu   sync.RWMutex
    subs map[*sub]struct{}
}

func (h *Hub) Publish(v string) {
    h.mu.RLock()
    defer h.mu.RUnlock()
    for s := range h.subs {
        s.ch <- v // Block policy, no ctx
    }
}

func (h *Hub) Close() {
    h.mu.Lock()
    defer h.mu.Unlock()
    for s := range h.subs {
        close(s.ch)
    }
}
```

**What goes wrong?**

### Failure mode

If one subscriber is paused, `Publish` is stuck on `s.ch <- v` holding `RLock`. `Close` needs `Lock` (exclusive) but cannot acquire it because `Publish` holds the read lock. Deadlock.

In production, `Close` is called on shutdown (e.g., SIGTERM handler). The graceful shutdown timeout expires; the process is killed; in-flight requests are dropped. All caused by one slow subscriber.

### Fix

Accept a `context.Context` in Publish, and respect it:

```go
func (h *Hub) Publish(ctx context.Context, v string) error {
    h.mu.RLock()
    defer h.mu.RUnlock()
    for s := range h.subs {
        select {
        case s.ch <- v:
        case <-ctx.Done():
            return ctx.Err()
        case <-h.done:
            return ErrClosed
        }
    }
    return nil
}
```

The `<-h.done` case ensures that even a stuck Publish gives up if the hub is closing. `Close` first signals `h.done`, then waits for in-flight publishes to drain, then acquires `Lock` to finalize.

A simpler fix: use non-blocking sends (`DropNewest`), which never block. The "Block" policy is a hazard outside very specific use cases.

---

## Bug 8: Loop Variable Capture in Subscribe

### Broken code

```go
func setupSubscribers(h *Hub, names []string) {
    for _, name := range names {
        sub := h.Subscribe()
        go func() {
            for msg := range sub.C() {
                fmt.Printf("[%s] %s\n", name, msg) // all use the last name
            }
        }()
    }
}
```

**What goes wrong?**

### Failure mode

In Go versions before 1.22, the loop variable `name` is shared across all iterations. Every goroutine reads the *same* variable, which by the time they run holds the *last* value of `names`. All output is labelled with the last name.

`sub` has the same problem: every goroutine references the same `sub` (the last subscription created).

### Fix

In Go 1.22+, the loop variable scope changed and the bug is gone. In earlier versions:

```go
for _, name := range names {
    name := name // shadow with a new local
    sub := h.Subscribe()
    go func() {
        for msg := range sub.C() {
            fmt.Printf("[%s] %s\n", name, msg)
        }
    }()
}
```

Or pass as arguments:

```go
go func(name string, sub Subscription[string]) {
    for msg := range sub.C() {
        fmt.Printf("[%s] %s\n", name, msg)
    }
}(name, sub)
```

Always run `go vet` — it catches this.

---

## Bug 9: Cond.Wait Without Loop

### Broken code

```go
type Gate struct {
    mu   sync.Mutex
    cond *sync.Cond
    open bool
}

func (g *Gate) Wait() {
    g.mu.Lock()
    if !g.open { // bug: should be `for`
        g.cond.Wait()
    }
    g.mu.Unlock()
}

func (g *Gate) Open() {
    g.mu.Lock()
    g.open = true
    g.mu.Unlock()
    g.cond.Broadcast()
}
```

**What goes wrong?**

### Failure mode

`Cond.Wait` can wake **spuriously** — the runtime may return from Wait without anyone calling Signal/Broadcast. (Spurious wakeups are rare on Go's pthreads-based Cond, but the documentation does not forbid them, and other implementations definitely have them.)

More commonly: between `cond.Broadcast` and the waiter re-acquiring `g.mu`, another waiter or external code may have changed `g.open` back to false (unlikely here but real in queue-shape Conds). On wake, the predicate is no longer true; the waiter proceeds anyway, breaking the invariant.

The bigger issue: this `if`-based code reads as a defect to any reviewer. The `for` loop is the canonical idiom.

### Fix

```go
func (g *Gate) Wait() {
    g.mu.Lock()
    defer g.mu.Unlock()
    for !g.open {
        g.cond.Wait()
    }
}
```

Memorise: **`cond.Wait()` is always inside a `for !predicate` loop, never an `if`.**

---

## Bug 10: Subscribe-During-Close Race

### Broken code

```go
type Hub struct {
    mu     sync.RWMutex
    subs   map[*sub]struct{}
    closed bool
}

func (h *Hub) Subscribe() *sub {
    if h.closed { // race: read without lock
        return nil
    }
    h.mu.Lock()
    s := &sub{ch: make(chan string, 4)}
    h.subs[s] = struct{}{}
    h.mu.Unlock()
    return s
}

func (h *Hub) Close() {
    h.mu.Lock()
    h.closed = true
    for s := range h.subs {
        close(s.ch)
    }
    h.subs = nil
    h.mu.Unlock()
}
```

**What goes wrong?**

### Failure mode

The check `if h.closed` reads without holding the lock. A concurrent `Close` could:

1. Subscriber A reads `h.closed == false`.
2. Goroutine B enters `Close()`, locks, sets `closed=true`, closes all channels, nils the map, unlocks.
3. Subscriber A locks, tries `h.subs[s] = struct{}{}` on a nil map. Panic: `assignment to entry in nil map`.

Even worse: A may insert a subscription into a *fresh* map after Close ran. The subscription leaks; its channel is never closed; subscribers wait forever.

### Fix

Move the `closed` check inside the lock:

```go
func (h *Hub) Subscribe() *sub {
    h.mu.Lock()
    defer h.mu.Unlock()
    if h.closed {
        s := &sub{ch: make(chan string)}
        close(s.ch) // hand back an already-closed subscription
        return s
    }
    s := &sub{ch: make(chan string, 4)}
    h.subs[s] = struct{}{}
    return s
}
```

Now the check and the mutation are atomic. Subscribers that call Subscribe after Close get a closed channel immediately; they observe `ok=false` on their first receive and exit cleanly.

---

## Bug 11: Drop Oldest Without Retry

### Broken code

```go
func (h *Hub) deliverDropOldest(s *sub, v string) {
    select {
    case s.ch <- v:
        return
    default:
    }
    select {
    case <-s.ch: // drop one
    default:
    }
    s.ch <- v // assume room now
}
```

**What goes wrong?**

### Failure mode

After dropping one event, the code assumes there is room — but a concurrent drainer might also have already drained. So the send to `s.ch` might block forever (if blocking), or might fill the buffer slot another publisher just wanted.

More subtly: between `<-s.ch` and `s.ch <- v`, another publisher may have raced ahead and filled the slot. Now `s.ch <- v` blocks.

### Fix

Loop the whole thing with non-blocking sends:

```go
func (h *Hub) deliverDropOldest(s *sub, v string) {
    for {
        select {
        case s.ch <- v:
            return
        default:
        }
        select {
        case <-s.ch:
        default:
            // someone else drained; loop and try again
        }
    }
}
```

Both operations are non-blocking. The loop guarantees progress without ever blocking the publisher.

---

## Bug 12: Receiver Discards `ok` Flag

### Broken code

```go
func consumer(sub Subscription[Event]) {
    for {
        v := <-sub.C() // ignores ok
        handle(v)
    }
}
```

**What goes wrong?**

### Failure mode

When the hub closes the subscription, `<-sub.C()` returns the zero value with `ok=false`. The code ignores `ok` and keeps spinning, handling zero-value events forever. Tight loop, 100% CPU, garbage events.

### Fix

Always destructure with the `ok` flag, or `range`:

```go
func consumer(sub Subscription[Event]) {
    for v := range sub.C() {
        handle(v)
    }
    // range exits cleanly on close
}
```

Or:

```go
for {
    v, ok := <-sub.C()
    if !ok {
        return
    }
    handle(v)
}
```

This is one of Go's most under-appreciated idioms. Channel ranges are the cleanest way to consume until-close.

---

## Bonus: Putting It All Together

Below is a hub with five of the bugs above combined. Find them all before reading the solution.

```go
type Hub struct {
    mu   sync.Mutex
    subs map[chan string]bool
    done chan struct{}
}

func New() *Hub {
    return &Hub{subs: map[chan string]bool{}}
}

func (h *Hub) Subscribe() chan string {
    s := make(chan string)
    h.mu.Lock()
    h.subs[s] = true
    h.mu.Unlock()
    return s
}

func (h *Hub) Unsubscribe(s chan string) {
    h.mu.Lock()
    delete(h.subs, s)
    h.mu.Unlock()
    close(s)
}

func (h *Hub) Publish(v string) {
    h.mu.Lock()
    defer h.mu.Unlock()
    for s := range h.subs {
        s <- v
    }
}

func (h *Hub) Close() {
    for s := range h.subs {
        close(s)
    }
}
```

### Bugs

1. **Hub holds Mutex during publish, no policy.** Slow subscriber stalls everyone, and Subscribe/Unsubscribe wait for slow publishes.
2. **Unsubscribe closes outside the lock; publish may send on closed channel.** Race window between `delete` and `close` plus send.
3. **Subscribe returns the writable channel.** Subscribers can send into it and crash the hub. Should return `<-chan string`.
4. **No idempotent Unsubscribe.** Double-unsubscribe → double-close → panic.
5. **Close holds no lock; can race with Subscribe/Unsubscribe/Publish.** Also iterates the map without lock → fatal concurrent map access.
6. **Close does not set a "closed" flag.** A subsequent Subscribe inserts into the map. Publish then sends to a channel that Close already closed → panic.
7. **Unbuffered subscriber channel.** Every publish synchronises with the slowest reader.

That is seven bugs in 30 lines. Real production code looks like this when no one has reviewed it. Use this exercise to sharpen your eye.

---

## Summary

The same five bug families show up over and over:

1. **Double close** of `done` channels or subscriber channels. Fix with `sync.Once`.
2. **Send on closed channel** because closing happens concurrently with publishing. Fix with strict ownership: only the hub closes, and only under the same lock as the map mutation.
3. **Map race** from concurrent read/write. Fix with `RWMutex` or `sync.Map`.
4. **Stalled hub** because a subscriber is slow and the policy is implicit Block. Fix with explicit `DropNewest`/`DropOldest`/`Eject`.
5. **Cond.Wait without `for` loop.** Fix with the canonical `for !pred { cond.Wait() }`.

Internalise these and 90% of broadcast bugs disappear before you write them.

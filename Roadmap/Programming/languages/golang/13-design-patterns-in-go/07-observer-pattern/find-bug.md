# Observer Pattern — Find the Bug

## 1. How to use this file

Fifteen short scenarios. Each has a buggy Observer implementation. Read the code, identify the bug, then expand the answer to check. The bugs are *realistic* — most of them show up once you put the pattern under concurrent load.

Difficulty varies. Some are obvious panics; others are concurrency hazards that only surface when one observer is slow, one subscription happens mid-notify, or a test forgets to clean up. The Observer pattern looks like a list and a `for` loop. The bugs live in the gaps between subscribe, notify, and unsubscribe.

---

## Bug 1 — Iterating observer slice while subscribing

```go
type Subject struct {
    mu  sync.Mutex
    obs []Observer
}

func (s *Subject) Subscribe(o Observer) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.obs = append(s.obs, o)
}

func (s *Subject) Notify(ev Event) {
    s.mu.Lock()
    defer s.mu.Unlock()
    for _, o := range s.obs {
        o.OnEvent(ev) // !
    }
}
```

Some observers subscribe a *new* observer when they handle an event (think: a root observer that spawns children).

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** `Notify` holds `s.mu` while calling `o.OnEvent`. If any observer calls back into `s.Subscribe`, the inner `Lock` deadlocks on the same goroutine — Go's `sync.Mutex` is not re-entrant.

Even if you remove the lock, mutating `s.obs` while iterating is unsafe: `append` may reallocate the backing array, and the iteration variable `s.obs` is bound at the start of the `for` loop. New subscribers added during a notify either get notified immediately (surprise) or get skipped (also surprise), depending on capacity.

**Spot in review:** Notification loops that call user code while holding the registry lock. Especially when the registry mutators (`Subscribe`, `Unsubscribe`) take the same lock.

**Fix:** Take a snapshot under the lock, release, then iterate:

```go
func (s *Subject) Notify(ev Event) {
    s.mu.Lock()
    snapshot := make([]Observer, len(s.obs))
    copy(snapshot, s.obs)
    s.mu.Unlock()
    for _, o := range snapshot {
        o.OnEvent(ev)
    }
}
```

Now `OnEvent` is free to subscribe, unsubscribe, or even re-enter `Notify` without deadlocking. The snapshot also means "subscribed *during* notify" doesn't receive the in-flight event — usually the safer semantics.

**Why common:** The author writes `Notify` thinking "I'll lock the list while I iterate, just like a textbook critical section". The trap is that the body of the loop is *user code* — it can do anything, including taking the same lock you're holding.
</details>

---

## Bug 2 — Unsubscribe deadlock (subscriber holds lock that notify needs)

```go
type Subject struct {
    mu  sync.Mutex
    obs map[int]Observer
    nxt int
}

func (s *Subject) Subscribe(o Observer) int {
    s.mu.Lock()
    defer s.mu.Unlock()
    id := s.nxt
    s.nxt++
    s.obs[id] = o
    return id
}

func (s *Subject) Unsubscribe(id int) {
    s.mu.Lock()
    defer s.mu.Unlock()
    delete(s.obs, id)
}

func (s *Subject) Notify(ev Event) {
    s.mu.Lock()
    defer s.mu.Unlock()
    for _, o := range s.obs {
        o.OnEvent(ev) // calls back into s.Unsubscribe sometimes
    }
}

// observer:
type oneShot struct {
    subj *Subject
    id   int
}
func (o *oneShot) OnEvent(Event) { o.subj.Unsubscribe(o.id) }
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Classic re-entrancy deadlock. `Notify` holds `s.mu`. `OnEvent` calls `Unsubscribe`, which tries to take `s.mu` again. `sync.Mutex` is not re-entrant — the second `Lock` blocks forever on the same goroutine.

This bug is especially nasty because "self-unsubscribing observer" is a common, useful pattern: a `oneShot` listener that fires once and detaches. The pattern is correct; the implementation traps it.

**Spot in review:** Any callback invoked while a lock is held, when the callback's contract permits calling back into the holder. Anything observer-shaped is suspect.

**Fix:** Same as Bug 1 — snapshot then iterate. Or use `sync.RWMutex` and a copy-on-write list. Or queue the unsubscribe:

```go
func (s *Subject) Notify(ev Event) {
    s.mu.Lock()
    snapshot := make([]Observer, 0, len(s.obs))
    for _, o := range s.obs { snapshot = append(snapshot, o) }
    s.mu.Unlock()
    for _, o := range snapshot {
        o.OnEvent(ev)
    }
}
```

The snapshot has a subtle consequence: if an observer unsubscribes *during* its own callback, the unsubscribe is processed correctly, but the event is still delivered to that observer (you copied the reference before the unsubscribe ran). That's almost always what you want for a one-shot.

**Why common:** People think of the lock as guarding the *map*. They forget that whatever runs *inside* the locked region is also part of the critical section. Once user code is in the critical section, all bets are off.
</details>

---

## Bug 3 — Slow observer blocking all others (synchronous notification)

```go
type Subject struct {
    mu  sync.RWMutex
    obs []Observer
}

func (s *Subject) Notify(ev Event) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    for _, o := range s.obs {
        o.OnEvent(ev) // ! some observers take seconds
    }
}
```

Three observers are registered: a cache invalidator (microseconds), a metric counter (microseconds), and a webhook poster (seconds).

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Notification is fully synchronous and serial. The slowest observer dictates the latency of `Notify`. The cache invalidator and metric counter wait behind the webhook poster on every event. If the webhook endpoint times out at 30s, every `Notify` call takes 30s.

There's no isolation between observers either. If the webhook poster panics, the goroutine running `Notify` crashes — taking down the publisher.

**Spot in review:** Notification loops that perform I/O directly inside the loop body. Webhook calls, HTTP fan-out, database writes, file I/O — all need isolation from the publisher.

**Fix:** Several options, pick by use case:

1. **Per-observer goroutines (fire-and-forget):**
   ```go
   for _, o := range snapshot {
       go func(o Observer) {
           defer func() { _ = recover() }() // contain panics
           o.OnEvent(ev)
       }(o)
   }
   ```
   Fastest, but no backpressure, no ordering guarantees, and you've turned each observer into a goroutine churn.

2. **Per-observer bounded channel** (see Bug 6, Bug 13):
   ```go
   o.ch <- ev // non-blocking with default, or with timeout
   ```

3. **Worker pool** for the whole fan-out: one queue, N workers, observers see best-effort delivery.

**Why common:** Synchronous Observer is the textbook implementation. It breaks the moment one observer does I/O. The fix is rarely "make Notify async by default" — it's "isolate the slow observer" so it can't punish the fast ones.
</details>

---

## Bug 4 — Forgotten unsubscribe in test → leaks across tests

```go
var globalBus = NewSubject()

func TestPriceChange(t *testing.T) {
    received := 0
    globalBus.Subscribe(ObserverFunc(func(Event) {
        received++
    }))
    globalBus.Notify(Event{Kind: "price"})
    if received != 1 {
        t.Fatalf("got %d, want 1", received)
    }
}

func TestVolumeChange(t *testing.T) {
    received := 0
    globalBus.Subscribe(ObserverFunc(func(Event) {
        received++
    }))
    globalBus.Notify(Event{Kind: "volume"})
    if received != 1 {
        t.Fatalf("got %d, want 1", received)
    }
}
```

Running `go test` once: both pass. Running `go test -count=10`: increasingly flaky.

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** `globalBus` is a package-level singleton. Each test subscribes a new observer and never unsubscribes. By the time `TestVolumeChange` runs, the bus already has a leftover observer from `TestPriceChange`. The leftover closure still references *its own* `received` variable from the previous test; that's harmless. The harm is that on `-count=2`, each test runs twice, so by the second iteration the bus has 2 + 1 + 2 + 1 = 6 observers, and the `received++` counts go wild.

The root cause is two-fold:
1. Tests use shared global state.
2. `Subscribe` returns nothing, so the test has no way to clean up even if it wanted to.

**Spot in review:** Tests against a package-level `Subject`, `Bus`, or `Hub`. Subscribers without a matching unsubscribe in `t.Cleanup`. Subscribe APIs that don't return a handle.

**Fix:** Two fixes, ideally both:

1. **Return an unsubscribe handle:**
   ```go
   func (s *Subject) Subscribe(o Observer) (unsubscribe func()) {
       id := s.add(o)
       return func() { s.remove(id) }
   }
   ```
2. **Per-test subject** instead of a global:
   ```go
   func TestPriceChange(t *testing.T) {
       bus := NewSubject()
       unsub := bus.Subscribe(...)
       t.Cleanup(unsub)
       ...
   }
   ```

For libraries that *do* expose a default singleton, make sure tests can construct an isolated instance.

**Why common:** Observer bus is the textbook "global event hub" — every "default instance" tutorial encourages this. Tests share the hub by accident. The leak is invisible at `-count=1` and pure poison under `-race -count=10`.
</details>

---

## Bug 5 — Closure capturing loop variable in subscribe loop (pre-1.22)

```go
// go.mod says go 1.21

type Handler struct {
    Name string
    Fn   func(Event)
}

handlers := []Handler{
    {Name: "audit", Fn: audit},
    {Name: "metrics", Fn: metrics},
    {Name: "alert", Fn: alert},
}

for _, h := range handlers {
    subject.Subscribe(ObserverFunc(func(ev Event) {
        log.Printf("handler=%s event=%v", h.Name, ev)
        h.Fn(ev)
    }))
}
```

Notify is called once.

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Under Go 1.21 (and earlier), `h` is a single variable reused across all loop iterations. Every closure captures the *same* `h`. By the time `Notify` fires, the loop has finished, and `h` holds the *last* value (`alert`). All three observers log `handler=alert` and run `alert`.

The audit and metrics handlers are subscribed but effectively dead — they're replaced by triplicate calls to `alert`.

**Spot in review:** Any `for _, x := range ...` where `x` is captured by a closure that escapes the loop. Until Go 1.22, this is *always* a bug if the closure runs later. With go.mod `go 1.22+`, the variable is per-iteration and the bug doesn't apply.

**Fix:** Three options, all valid:

1. **Bump go.mod to 1.22+:** loop variables become per-iteration automatically.
2. **Take address explicitly:**
   ```go
   for _, h := range handlers {
       h := h
       subject.Subscribe(ObserverFunc(func(ev Event) { h.Fn(ev) }))
   }
   ```
3. **Pass as argument:**
   ```go
   for _, h := range handlers {
       subject.Subscribe(makeObserver(h))
   }
   ```

Linters (`loopclosure` in `go vet`, `exportloopref`) flag this — but only if you actually run them.

**Why common:** This is the canonical Go gotcha. It's been bitten anew every time someone writes "subscribe in a loop". Go 1.22 fixed the language-level cause; codebases stuck on older toolchains still suffer.
</details>

---

## Bug 6 — Channel-based observer not draining → producer blocks

```go
type ChanObserver struct {
    ch chan Event
}

func NewChanObserver() *ChanObserver {
    return &ChanObserver{ch: make(chan Event, 4)}
}

func (c *ChanObserver) OnEvent(ev Event) {
    c.ch <- ev // !
}

// somewhere:
obs := NewChanObserver()
subject.Subscribe(obs)

// the consumer:
go func() {
    for ev := range obs.ch {
        process(ev)
    }
}()
```

Under load, `Notify` calls start blocking.

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** The observer's `OnEvent` writes to a buffered channel of size 4. If `process` is slower than `Notify`, the buffer fills, and the next `OnEvent` blocks. Because `Notify` calls observers serially (Bug 3), one slow consumer freezes every other observer downstream.

Worse: if the consumer goroutine ever crashes or returns, the channel is never drained again. The publisher blocks forever on the first overflow.

**Spot in review:** `c.ch <- ev` without a `select` and `default` case (or `ctx.Done()`). Buffered channels treated as "infinite enough" without quantifying how full they can get.

**Fix:** Choose your overflow policy explicitly:

```go
func (c *ChanObserver) OnEvent(ev Event) {
    select {
    case c.ch <- ev:
        // delivered
    default:
        atomic.AddInt64(&c.dropped, 1)
        // drop, log, or replace oldest
    }
}
```

The right policy is domain-specific. The wrong policy is "block forever".

**Why common:** Buffered channels look like they "smooth out bursts" — until the burst lasts longer than the buffer. Then the publisher inherits the consumer's slowness.
</details>

---

## Bug 7 — Subscribe after close panics

```go
type Subject struct {
    mu     sync.Mutex
    obs    map[int]chan Event
    closed bool
    nxt    int
}

func (s *Subject) Subscribe() (<-chan Event, int) {
    s.mu.Lock()
    defer s.mu.Unlock()
    ch := make(chan Event, 16)
    id := s.nxt
    s.nxt++
    s.obs[id] = ch
    return ch, id
}

func (s *Subject) Close() {
    s.mu.Lock()
    defer s.mu.Unlock()
    for _, ch := range s.obs {
        close(ch)
    }
    s.closed = true
}

func (s *Subject) Notify(ev Event) {
    s.mu.Lock()
    defer s.mu.Unlock()
    for _, ch := range s.obs {
        ch <- ev
    }
}
```

A late-arriving caller does `Subscribe()` after `Close()`, then receives on the channel.

**What's wrong?**

<details><summary>Answer</summary>

**Bug 1:** `Subscribe` doesn't check `s.closed`. After `Close()`, a new subscriber gets a freshly-made channel that nobody will ever send to. The consumer blocks on `<-ch` forever — a goroutine leak.

**Bug 2:** Worse — if `Notify` is called *between* `Close` and that observer's `Close` (impossible here because we hold the lock, but easy to introduce by snapshotting), it sends on a closed channel and panics.

**Bug 3:** If someone calls `Close` twice, the second call panics with "close of closed channel".

**Spot in review:** Any `Subscribe`/`Close` pair where neither method checks the other's state. Any `Close()` that doesn't guard against double-close.

**Fix:**

```go
func (s *Subject) Subscribe() (<-chan Event, int, error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.closed {
        return nil, 0, errors.New("subject: closed")
    }
    ch := make(chan Event, 16)
    id := s.nxt
    s.nxt++
    s.obs[id] = ch
    return ch, id, nil
}

func (s *Subject) Close() {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.closed {
        return
    }
    s.closed = true
    for _, ch := range s.obs {
        close(ch)
    }
    s.obs = nil
}
```

For double-close protection, `sync.Once` is also idiomatic.

**Why common:** Lifecycle bugs are a category. "What happens after `Close`?" is never the question people ask first. Closed-channel panic is one of Go's loudest crashes; the silent goroutine leak is worse because no one notices.
</details>

---

## Bug 8 — Goroutine leak: observer goroutines outlive subject

```go
type AsyncSubject struct {
    obs []Observer
}

func (s *AsyncSubject) Subscribe(o Observer) {
    s.obs = append(s.obs, o)
}

func (s *AsyncSubject) Notify(ev Event) {
    for _, o := range s.obs {
        go o.OnEvent(ev) // !
    }
}

// observer that takes a while:
func (s *Slow) OnEvent(ev Event) {
    time.Sleep(30 * time.Second)
    s.processed++
}
```

`AsyncSubject` is created, used, dropped. The process keeps running.

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Every `Notify` spawns N goroutines and never tracks them. When the `AsyncSubject` is dropped, its observers' goroutines keep running for 30s each. If `Notify` is called every second with 10 observers, you have ~300 in-flight goroutines at any time, each holding references that prevent GC.

There's also no shutdown story. `AsyncSubject` has no `Close()`. The owning service can't tell when in-flight notifications have drained.

**Spot in review:** `go X` inside a method without a `sync.WaitGroup`, a context, or a tracked supervisor. Any `Notify` that returns before its consequences finish.

**Fix:** Track lifecycle explicitly:

```go
type AsyncSubject struct {
    mu  sync.Mutex
    obs []Observer
    wg  sync.WaitGroup
    ctx context.Context
    cancel context.CancelFunc
}

func New() *AsyncSubject {
    ctx, cancel := context.WithCancel(context.Background())
    return &AsyncSubject{ctx: ctx, cancel: cancel}
}

func (s *AsyncSubject) Notify(ev Event) {
    s.mu.Lock()
    snapshot := append([]Observer(nil), s.obs...)
    s.mu.Unlock()
    for _, o := range snapshot {
        s.wg.Add(1)
        go func(o Observer) {
            defer s.wg.Done()
            select {
            case <-s.ctx.Done():
                return
            default:
            }
            o.OnEvent(ev)
        }(o)
    }
}

func (s *AsyncSubject) Close() {
    s.cancel()
    s.wg.Wait()
}
```

`Close()` cancels in-flight observers (best-effort) and waits for the rest to finish.

**Why common:** `go X` looks free; goroutines are cheap. The cost is *unbounded growth* — without a `WaitGroup`, an external observer of the process can't tell whether the goroutines completed or whether the binary is leaking. Always pair `go` with explicit lifecycle tracking.
</details>

---

## Bug 9 — Re-entrant notify (observer calls Notify itself → deadlock)

```go
type Subject struct {
    mu  sync.Mutex
    obs []Observer
}

func (s *Subject) Subscribe(o Observer) {
    s.mu.Lock()
    s.obs = append(s.obs, o)
    s.mu.Unlock()
}

func (s *Subject) Notify(ev Event) {
    s.mu.Lock()
    defer s.mu.Unlock()
    for _, o := range s.obs {
        o.OnEvent(ev)
    }
}

// observer that turns one event into another:
type Forwarder struct {
    Subj *Subject
}
func (f *Forwarder) OnEvent(ev Event) {
    if ev.Kind == "raw" {
        f.Subj.Notify(Event{Kind: "cooked", Data: ev.Data})
    }
}
```

`Forwarder` is registered with the same subject it forwards to.

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Self-deadlock from re-entrant `Notify`. `Subject.Notify` holds `s.mu` and calls `Forwarder.OnEvent`, which calls `Subject.Notify` again, which tries to take `s.mu` — already held by the same goroutine — and blocks forever.

The author may have *meant* to support forwarding (a perfectly reasonable feature). The implementation makes it impossible.

A subtler form of the same bug: even if you fix the mutex (snapshot-based notify, like Bug 1), unbounded recursion is still possible. `cooked` events could re-enter as `raw` and cascade. You need a "currently-notifying" guard *and* a deadlock-free mutex strategy.

**Spot in review:** Lock held across user code, and the user code has access to the same `Subject`. Anything observer-shaped that can publish back to itself.

**Fix:** Snapshot-and-release (as in Bug 1), plus a recursion budget if forwarding is intentional:

```go
func (s *Subject) Notify(ev Event) {
    s.mu.Lock()
    snapshot := append([]Observer(nil), s.obs...)
    s.mu.Unlock()
    for _, o := range snapshot {
        o.OnEvent(ev)
    }
}
```

If recursion is *not* intended, detect it:

```go
type Subject struct {
    mu       sync.Mutex
    obs      []Observer
    inNotify atomic.Bool
}

func (s *Subject) Notify(ev Event) {
    if !s.inNotify.CompareAndSwap(false, true) {
        // queue or reject; don't recurse
        return
    }
    defer s.inNotify.Store(false)
    // ... snapshot ...
}
```

**Why common:** "Forward this event to a different topic" is a legitimate observer use case. Coupling forward + locking model leads straight to this trap. Solve them as two separate problems.
</details>

---

## Bug 10 — Race on observer list (read-write without sync)

```go
type Subject struct {
    obs []Observer
}

func (s *Subject) Subscribe(o Observer) {
    s.obs = append(s.obs, o)
}

func (s *Subject) Unsubscribe(o Observer) {
    for i, x := range s.obs {
        if x == o {
            s.obs = append(s.obs[:i], s.obs[i+1:]...)
            return
        }
    }
}

func (s *Subject) Notify(ev Event) {
    for _, o := range s.obs {
        o.OnEvent(ev)
    }
}
```

Used concurrently from multiple goroutines.

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Plain data race. `s.obs` is read and written from multiple goroutines with no synchronisation. `go test -race` lights up immediately.

Even if you're "lucky" and don't crash, the slice header (pointer/len/cap) can tear during read. `Notify` might iterate over a half-updated slice, calling a nil function, calling the same observer twice, or skipping one. None of these manifest as a panic — they manifest as missing or duplicate events, which is *much* harder to debug.

`append` can reallocate the backing array. If `Notify`'s `range` captured the old header and `Subscribe` reallocates, the new subscriber is silently dropped from the in-flight notify. The slice grew, but `Notify` is iterating over the old underlying array.

**Spot in review:** Mutable shared state with no mutex, no atomic, no channel. `go test -race` should be a CI gate.

**Fix:** A mutex (with snapshot-and-release for notify):

```go
type Subject struct {
    mu  sync.RWMutex
    obs []Observer
}

func (s *Subject) Subscribe(o Observer) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.obs = append(s.obs, o)
}

func (s *Subject) Notify(ev Event) {
    s.mu.RLock()
    snapshot := append([]Observer(nil), s.obs...)
    s.mu.RUnlock()
    for _, o := range snapshot {
        o.OnEvent(ev)
    }
}
```

For higher-throughput, copy-on-write via `atomic.Value` is also idiomatic — `Subscribe` builds a new slice and atomically swaps; `Notify` loads the current slice without locking.

**Why common:** "It's just a slice" is the rationale. People assume `append` is atomic — it isn't, and the slice header isn't either. The race only fires under load, often only in production.
</details>

---

## Bug 11 — Observer mutating shared event payload

```go
type Event struct {
    ID   int
    Tags map[string]string
    Body []byte
}

func (s *Subject) Notify(ev Event) {
    s.mu.Lock()
    snapshot := append([]Observer(nil), s.obs...)
    s.mu.Unlock()
    for _, o := range snapshot {
        go o.OnEvent(ev)
    }
}

// observer A:
func (a *Tagger) OnEvent(ev Event) {
    ev.Tags["seen-by"] = "tagger" // !
}

// observer B:
func (b *Logger) OnEvent(ev Event) {
    for k, v := range ev.Tags { // !
        log.Printf("%s=%s", k, v)
    }
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** `Event` is passed by value, but `Event.Tags` is a `map` — a reference type. The map is shared across all observers. Observer A mutates it concurrently while Observer B iterates → race detector fires, and even without `-race`, behaviour is undefined (map writes during reads can panic).

`Event.Body` is a `[]byte` — same problem. If one observer slices into it (`ev.Body = ev.Body[10:]`) the others see the truncated view. If one observer mutates the bytes (`ev.Body[0] = 'X'`) everyone sees the corruption.

The *struct* is copied. The *contents* of reference-typed fields are not.

**Spot in review:** Events with `map`, `[]byte`, `chan`, `[]T`, or pointer fields, plus any observer code that writes to them. Anything passed to `go o.OnEvent(ev)` where the event isn't trivially shallow.

**Fix:** Establish an "events are immutable" contract and enforce it:

1. **Document the rule** at the top of the package: observers must treat events as read-only.
2. **Defensive copy at the boundary** if you can't trust observers:
   ```go
   func cloneEvent(ev Event) Event {
       out := ev
       out.Tags = maps.Clone(ev.Tags)
       out.Body = append([]byte(nil), ev.Body...)
       return out
   }
   ```
3. **Use immutable types** — e.g., `[]string` of `"key=value"` instead of a map, or a freeze step that converts to read-only structures.

For observers that need to enrich events, return new events or use an explicit pipeline (this is the Pub/Sub or pipes-and-filters pattern, not Observer).

**Why common:** The pattern "Event is a value type" gives a false sense of isolation. Reference-typed fields punch through that isolation silently. Race detector catches it eventually; logic bugs from mutation may never be caught.
</details>

---

## Bug 12 — Notification ordering surprise across goroutines

```go
type Subject struct {
    mu  sync.Mutex
    obs []Observer
}

func (s *Subject) Notify(ev Event) {
    s.mu.Lock()
    snapshot := append([]Observer(nil), s.obs...)
    s.mu.Unlock()
    for _, o := range snapshot {
        go o.OnEvent(ev)
    }
}

// caller:
subject.Notify(Event{Seq: 1})
subject.Notify(Event{Seq: 2})
subject.Notify(Event{Seq: 3})

// observer logs in order:
func (h *History) OnEvent(ev Event) {
    h.events = append(h.events, ev) // !
}
```

A test expects `h.events` to be `[1, 2, 3]`.

**What's wrong?**

<details><summary>Answer</summary>

**Bug 1:** Each call to `Notify` spawns a goroutine per observer. There's no ordering between goroutines. Event 1's goroutine may run *after* event 2's. `h.events` ends up as `[2, 1, 3]` or `[3, 2, 1]` — and varies per run.

**Bug 2:** `h.events = append(...)` runs concurrently from multiple goroutines on the same `History`. Classic slice race; `-race` catches it. Even if the slice happens to be a `chan`, ordering is still unspecified.

**Bug 3:** Tests that depend on a specific delivery order are testing the implementation, not the contract. If the contract is "in-order delivery", `go o.OnEvent` is the wrong implementation. If the contract is "best-effort delivery", the test is wrong.

**Spot in review:** Fan-out via `go X` plus any observer that appends to shared state. Tests that assert a specific event sequence.

**Fix:** Match implementation to contract.

For *per-observer* in-order delivery (each observer sees events in publish order, but different observers may be at different points):

```go
type ChanObserver struct {
    ch chan Event
}
func (c *ChanObserver) OnEvent(ev Event) { c.ch <- ev }

// One worker per observer, processing the channel sequentially.
```

For *globally* in-order delivery (every observer agrees on order), use a single dispatch goroutine:

```go
type Subject struct {
    in  chan Event
    obs []Observer
}

func (s *Subject) run() {
    for ev := range s.in {
        for _, o := range s.obs { // all observers see this event before the next
            o.OnEvent(ev)
        }
    }
}
```

For *best-effort, no ordering*, document it loudly so tests don't depend on order.

**Why common:** "Run each observer in its own goroutine" sounds like an obvious throughput win. It is — but it implicitly chooses *unordered, concurrent delivery*. Callers naturally assume "I called Notify(1) then Notify(2), so my observer sees 1 then 2". Document the choice, or use a deterministic dispatcher.
</details>

---

## Bug 13 — Unbuffered channel for fan-out → producer slow

```go
type Subject struct {
    mu  sync.Mutex
    obs []chan Event
}

func (s *Subject) Subscribe() <-chan Event {
    s.mu.Lock()
    defer s.mu.Unlock()
    ch := make(chan Event) // !
    s.obs = append(s.obs, ch)
    return ch
}

func (s *Subject) Notify(ev Event) {
    s.mu.Lock()
    snapshot := append([]chan Event(nil), s.obs...)
    s.mu.Unlock()
    for _, ch := range snapshot {
        ch <- ev
    }
}
```

Two consumers subscribe. One reads fast; one reads slow.

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Channels are unbuffered (`make(chan Event)`). `ch <- ev` blocks until a receiver is ready. `Notify` iterates observers serially, so the *slowest* consumer pins the publisher at every step. If consumer A is fast and consumer B is napping, `Notify` waits for B before delivering to A.

There's also no isolation. If consumer B's goroutine dies (panic, return), the channel is never read again, and `Notify` blocks forever on it.

**Spot in review:** `make(chan T)` for fan-out scenarios. Unbuffered channels are a synchronisation primitive ("hand-off"), not a queue. They're rarely the right choice for one-to-many.

**Fix:** Buffer plus drop-on-overflow:

```go
func (s *Subject) Subscribe() <-chan Event {
    s.mu.Lock()
    defer s.mu.Unlock()
    ch := make(chan Event, 64)
    s.obs = append(s.obs, ch)
    return ch
}

func (s *Subject) Notify(ev Event) {
    s.mu.Lock()
    snapshot := append([]chan Event(nil), s.obs...)
    s.mu.Unlock()
    for _, ch := range snapshot {
        select {
        case ch <- ev:
        default:
            // drop, log, or per-subscriber counter
        }
    }
}
```

The buffer size is a service-level decision: how big a burst can a consumer absorb before falling behind? The `default` case is a *policy*: drop, replace oldest, count and continue. Pick deliberately.

**Why common:** "I'll use a channel for the fan-out" is good instinct, but `make(chan T)` (zero size) is unbuffered and synchronous. Beginners often use unbuffered channels everywhere because the docs use them in basic examples — those examples assume one sender, one receiver, in lockstep. Fan-out is none of those things.
</details>

---

## Bug 14 — Backpressure via blocking causes cascading slowdown

```go
type Service struct {
    bus *Subject
}

func (s *Service) Handle(req Request) error {
    s.bus.Notify(Event{Kind: "request", Data: req})
    return s.processRequest(req)
}

// Subject delivers synchronously to a buffered channel, with overflow blocking:
func (s *Subject) Notify(ev Event) {
    for _, ch := range s.obs {
        ch <- ev // buffered, but blocks when full
    }
}
```

A downstream observer (analytics) batches events into 1-second windows. When the analytics writer is slow, request latency in `Service.Handle` grows.

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Blocking sends propagate backpressure all the way to the request-handling path. Analytics is conceptually best-effort, but the implementation makes it a hard dependency: if analytics blocks, `Notify` blocks, `Handle` blocks, the load balancer's request times out, the upstream client retries, the retried request also blocks, the queue grows, the system melts.

This is called a *latency cascade*. A 100ms slowdown in a "non-critical" observer becomes a 100ms tax on every request, which under high QPS turns into queue saturation, then OOM, then a brownout.

**Spot in review:** Synchronous `Notify` on a critical path. Buffered channels whose `default` case blocks instead of drops. "Best-effort" observers wired into the request lifecycle without an explicit boundary.

**Fix:** Decouple the request path from observer delivery:

```go
// 1. Publish to a queue, return immediately.
type Subject struct {
    inbox chan Event
}

func (s *Subject) Notify(ev Event) {
    select {
    case s.inbox <- ev:
    default:
        atomic.AddInt64(&s.dropped, 1) // metric, alert if > 0
    }
}

// 2. A dispatcher reads from inbox and fans out to observers.
func (s *Subject) dispatch() {
    for ev := range s.inbox {
        for _, o := range s.snapshot() {
            // per-observer non-blocking send
        }
    }
}
```

The request path now has bounded latency (one channel send + a `select`). Slow observers can fall behind without dragging the publisher with them. Dropped events become an observable metric — if it spikes, you know the observer side needs attention, not the request side.

**Why common:** Blocking sends look like "natural backpressure". They are — but the pressure pushes back into a place that *can't* absorb it (your request-handling goroutine). True backpressure requires a *bounded queue with an explicit drop or shed policy*. Otherwise you've just smeared the bottleneck across more code.
</details>

---

## Bug 15 — Generic Observer[T] type assertion panic

```go
type Observer[T any] interface {
    OnEvent(T)
}

type Subject struct {
    obs []any // !
}

func Subscribe[T any](s *Subject, o Observer[T]) {
    s.obs = append(s.obs, o)
}

func Notify[T any](s *Subject, ev T) {
    for _, o := range s.obs {
        o.(Observer[T]).OnEvent(ev) // !
    }
}
```

Used:

```go
s := &Subject{}
Subscribe(s, OrderObserver{}) // Observer[Order]
Subscribe(s, PriceObserver{}) // Observer[Price]

Notify(s, Order{ID: 1}) // panic
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** A single `Subject` holds heterogeneous `Observer[T]` values in `[]any`. The type parameter `T` exists only at each *method* call — there's no way for the storage to know which observer is `Observer[Order]` vs `Observer[Price]`. The type assertion `o.(Observer[T])` runs at runtime; when `T` is `Order` and the loop encounters a `PriceObserver`, the assertion panics.

Even ignoring the panic, this design is conceptually broken: a "subject" that fans out to observers of *different* event types isn't a subject; it's an event bus with topics, and the topics need to be explicit.

The Go generics model is *monomorphisation-like at compile time but homogeneous at runtime*: you can't have a single slice that erases T and recovers it generically. You can have a slice per T, or a slice of "topic + payload" pairs.

**Spot in review:** Generic interfaces stored in `[]any` followed by type assertions. Generic registries that mix observers of incompatible types.

**Fix:** One subject per event type:

```go
type Subject[T any] struct {
    obs []Observer[T]
}

func (s *Subject[T]) Subscribe(o Observer[T]) { s.obs = append(s.obs, o) }
func (s *Subject[T]) Notify(ev T) {
    for _, o := range s.obs { o.OnEvent(ev) }
}

// Compose as needed:
type Bus struct {
    Orders *Subject[Order]
    Prices *Subject[Price]
}
```

If you really need a heterogeneous bus, encode the type explicitly:

```go
type Topic string
type Bus struct {
    obs map[Topic][]func(any)
}

func Subscribe[T any](b *Bus, topic Topic, o func(T)) {
    b.obs[topic] = append(b.obs[topic], func(ev any) {
        o(ev.(T)) // assertion is now scoped to one topic
    })
}
```

The assertion is still there, but it can only fail at *subscribe-side mismatch*, which is testable.

**Why common:** Generics in Go let you write `Observer[T]`, which feels like it should compose into a generic registry. It doesn't — type parameters don't survive into `[]any`. People reach for `any` to "store anything", then hit panics on extraction. The fix is usually "more types, not fewer".
</details>

---

## Summary

Four families of bugs in this set:

**Locking / re-entrancy** (1, 2, 9, 10): The observer pattern's main complication is that *user code runs inside the critical section*. Snapshot-and-release is the universal escape hatch. Hold the lock long enough to copy the list, never long enough to call into observers.

**Lifecycle leaks** (4, 7, 8): Observers, channels, and goroutines must have explicit unsubscribe / close / cancel paths. Anything that subscribes without a way to detach is a leak waiting to happen. Anything that spawns a goroutine without a `WaitGroup` or context is a leak waiting to happen.

**Delivery semantics** (3, 6, 12, 13, 14): Synchronous vs asynchronous, ordered vs unordered, blocking vs dropping — these are *contract* decisions, not implementation details. Pick deliberately, document loudly, and make the test suite enforce the choice.

**Shared state and types** (5, 11, 15): Loop-variable capture, mutable event payloads, and erased generic types all leak shared state in ways the type system doesn't catch. Defensive copies and one-type-per-subject keep these in check.

**Review checklist:**
- [ ] `Notify` does not call user code while holding a lock (snapshot-and-release).
- [ ] `Subscribe` returns an unsubscribe handle or token.
- [ ] `Close` is idempotent and prevents subsequent `Subscribe`.
- [ ] Tests use a fresh `Subject`, not a package-level singleton.
- [ ] Goroutines spawned for observers are tracked with `sync.WaitGroup` and tied to a context.
- [ ] Channels used for fan-out are buffered with an explicit overflow policy (drop / drop-oldest / block + document).
- [ ] No `go o.OnEvent(ev)` without a recover and a lifecycle owner.
- [ ] Event payloads are documented as immutable, or defensively copied at the boundary.
- [ ] Loop-variable capture in subscribe loops works under your `go.mod` version (1.22+ safe by default; older versions need `x := x`).
- [ ] No `[]any` storage of generic observers with `o.(Observer[T])` assertions.
- [ ] Tests run with `-race` in CI.
- [ ] Slow observers cannot block the request path (or the publisher).

If you reviewed observer code with this checklist, you'd catch most of the bugs above before they reached production.

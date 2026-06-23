# sync.Cond — Find the Bug

> Each section presents broken code. Read it, predict the symptom, then read the explanation and fix. Every bug below has been seen in production Go code.

---

## How to use this file

1. Read the snippet.
2. State the symptom: panic, deadlock, leak, wrong output, race, thundering herd?
3. Identify the root cause.
4. Sketch a fix.
5. Read the explanation and compare.

---

## Bug 1: the missing `for` loop

```go
mu.Lock()
if !ready {
    cond.Wait()
}
process(state)
mu.Unlock()
```

**Symptom.** Most of the time: works. Rarely (under load): `process(state)` runs with `ready == false`, and panics or produces wrong output.

**Root cause.** `if` instead of `for`. On a spurious wake-up, a competing waiter consuming the state change, or an unrelated `Broadcast`, the waiter resumes with the predicate still false. The Go spec explicitly allows spurious wake-ups; even if current implementations don't produce them, multiple waiters racing for one resource is enough.

**Fix.**

```go
mu.Lock()
for !ready {
    cond.Wait()
}
process(state)
mu.Unlock()
```

The `for` loop costs one extra comparison after each wake-up. The bug it prevents is hours of debugging.

---

## Bug 2: forgotten lock around Wait

```go
go func() {
    if !ready {
        cond.Wait()
    }
    process()
}()
```

**Symptom.** Panic: `sync: unlock of unlocked mutex`.

**Root cause.** `cond.Wait()` internally calls `c.L.Unlock()`. The caller never locked, so the unlock panics. The Go runtime is strict about this — there's no "fall through if not locked" mode.

**Fix.**

```go
go func() {
    mu.Lock()
    for !ready {
        cond.Wait()
    }
    process()
    mu.Unlock()
}()
```

The lock is held around every predicate check, every `Wait`, and the action afterward.

---

## Bug 3: signal under no lock

```go
// Signaller
state.ready = true
cond.Signal()
```

**Symptom.** Occasional missed wake-ups. Goroutines hang in `Wait`. Symptom only appears under concurrency, often in production but not in unit tests.

**Root cause.** The state mutation and the signal happen outside the lock. A waiter could re-acquire the lock between the write and the signal, see `ready == true`, proceed. Then the signal fires to a different waiter who has just parked — that waiter wakes, re-checks the predicate, finds it satisfied, but consumed the wake-up. If only one of the two could proceed, you lost it.

Or, more subtly: the waiter and the signaller race on the write itself. Without a synchronization edge, the waiter may not observe `state.ready = true` after waking.

**Fix.**

```go
mu.Lock()
state.ready = true
cond.Signal()
mu.Unlock()
```

Both the mutation and the signal are under the lock. The waiter wakes inside the lock and is guaranteed to observe the write.

---

## Bug 4: copying the Cond

```go
type Queue struct {
    mu   sync.Mutex
    cond sync.Cond     // BUG: by value
    items []int
}

func NewQueue() Queue {
    q := Queue{}
    q.cond = sync.Cond{L: &q.mu}
    return q  // copies q
}

func main() {
    q := NewQueue()
    go producer(&q)
    go consumer(&q)
}
```

**Symptom.** `go vet` warns: `assignment copies lock value to q`. At runtime: panic `sync.Cond is copied`.

**Root cause.** `sync.Cond` contains a `noCopy` field. Copying it after first use is unsafe — the internal wait list points at the old address. The `copyChecker` detects this and panics. Even before the panic, the wait list is inconsistent: signallers operate on one copy, waiters on another.

**Fix.** Use a pointer.

```go
type Queue struct {
    mu    sync.Mutex
    cond  *sync.Cond
    items []int
}

func NewQueue() *Queue {
    q := &Queue{}
    q.cond = sync.NewCond(&q.mu)
    return q
}
```

Always store `*sync.Cond`. Always return `*Queue`.

---

## Bug 5: mismatched locks

```go
type Server struct {
    stateMu sync.Mutex
    cond    *sync.Cond
    state   string
}

func NewServer() *Server {
    s := &Server{}
    s.cond = sync.NewCond(&sync.Mutex{}) // BUG: different mutex
    return s
}

func (s *Server) WaitReady() {
    s.stateMu.Lock()
    for s.state != "ready" {
        s.cond.Wait()
    }
    s.stateMu.Unlock()
}
```

**Symptom.** Panic in `WaitReady`: `sync: unlock of unlocked mutex`.

**Root cause.** `cond.Wait()` calls `Unlock()` on the *inner anonymous mutex* it was constructed with, not on `s.stateMu`. That inner mutex was never locked, so the unlock panics.

**Fix.** Construct the `Cond` with the *same* mutex used in callers.

```go
func NewServer() *Server {
    s := &Server{}
    s.cond = sync.NewCond(&s.stateMu)
    return s
}
```

---

## Bug 6: signal with the wrong lock

```go
type Cache struct {
    mu   sync.Mutex
    cond *sync.Cond
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    c.store(k, v)
    c.mu.Unlock()
    c.cond.Signal() // signal outside the lock
}

func (c *Cache) Get(k string) string {
    c.mu.Lock()
    for !c.has(k) {
        c.cond.Wait()
    }
    v := c.fetch(k)
    c.mu.Unlock()
    return v
}
```

**Symptom.** Get hangs forever in some interleavings.

**Root cause.** Set unlocks before signalling. Between unlock and signal, a Get goroutine could lock, check `has(k) == false`, and call `Wait` — parking just before our signal arrives. But the signal arrives only after Get has parked, so all should be fine, right? Wrong: another Get could have raced in and consumed the signal-worthy state.

The deeper issue: with signal-outside-lock, the order of signal-arrival vs waiter-parking is racy. The classical race is:

1. Set: lock, store, unlock.
2. Get: lock, check (not yet — the timing is racy on visibility), park (just before signal).
3. Set: signal — wakes Get.

But Go's memory model only guarantees visibility under the lock, and the signal is outside. The waiter on wake-up re-locks, re-checks, and finds it true. Subtle but possible: under heavy contention, the signal can be "absorbed" by a waiter who is *just about to check* the predicate but hasn't yet, and they proceed without going through `Wait` — the signal is then misplaced.

**Fix.** Signal inside the lock.

```go
func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    c.store(k, v)
    c.cond.Signal()
    c.mu.Unlock()
}
```

---

## Bug 7: Signal instead of Broadcast

```go
type Once struct {
    mu   sync.Mutex
    cond *sync.Cond
    done bool
}

func (o *Once) Do(f func()) {
    o.mu.Lock()
    if o.done { o.mu.Unlock(); return }
    // ...
}

func (o *Once) markDone() {
    o.mu.Lock()
    o.done = true
    o.cond.Signal()  // BUG: only wakes one
    o.mu.Unlock()
}
```

If 100 goroutines call `Do(f)`, only one wakes up. The other 99 stay parked forever.

**Symptom.** Goroutine leak. `runtime.NumGoroutine` grows.

**Root cause.** `Signal` wakes one waiter. The class-of-state change (`done = true`) affects all waiters, so all should be woken.

**Fix.**

```go
o.cond.Broadcast()
```

Class-of-state changes use `Broadcast`. Per-item changes (one item pushed, one slot freed) use `Signal`.

---

## Bug 8: forgotten Broadcast on close

```go
type Queue struct {
    mu       sync.Mutex
    cond     *sync.Cond
    items    []int
    closed   bool
}

func (q *Queue) Push(v int) error {
    q.mu.Lock()
    defer q.mu.Unlock()
    if q.closed { return ErrClosed }
    q.items = append(q.items, v)
    q.cond.Signal()
    return nil
}

func (q *Queue) Pop() (int, error) {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == 0 && !q.closed {
        q.cond.Wait()
    }
    if q.closed && len(q.items) == 0 { return 0, ErrClosed }
    v := q.items[0]
    q.items = q.items[1:]
    return v, nil
}

func (q *Queue) Close() {
    q.mu.Lock()
    q.closed = true
    q.mu.Unlock()
    // BUG: no broadcast
}
```

**Symptom.** After `Close`, any goroutine parked in `Pop` never returns.

**Root cause.** Setting `closed = true` doesn't wake waiters. They're parked in `cond.Wait()` waiting for a signal.

**Fix.** Add `Broadcast`.

```go
func (q *Queue) Close() {
    q.mu.Lock()
    q.closed = true
    q.cond.Broadcast()
    q.mu.Unlock()
}
```

`Broadcast` wakes all waiters; each re-checks, sees `closed`, and exits.

---

## Bug 9: double-unlock after Wait

```go
mu.Lock()
for !ready {
    cond.Wait()
    mu.Unlock()  // BUG: Wait already re-locked
}
```

**Symptom.** Panic: `sync: unlock of unlocked mutex` on the second iteration of the loop, or on early exit.

**Root cause.** `Wait` re-acquires the lock before returning. The caller does not need to (and must not) unlock between iterations. The `mu.Unlock()` inside the loop double-unlocks.

**Fix.** Remove the inner unlock.

```go
mu.Lock()
for !ready {
    cond.Wait()
}
// act on state
mu.Unlock()
```

---

## Bug 10: defer order trap

```go
func (q *Queue) Pop() (int, error) {
    q.mu.Lock()
    defer q.mu.Unlock()
    defer q.cond.Signal() // BUG: signals before unlock
    for len(q.items) == 0 {
        q.cond.Wait()
    }
    // ...
}
```

**Symptom.** The signal fires before the lock is released. The woken goroutine immediately tries to acquire the lock and blocks until the deferred unlock runs. This is correctness-wise fine but performance-wise bad: the woken goroutine yields immediately. More importantly, signalling on `Pop` (which is a *consumer*, not a producer) is conceptually backwards — there's nothing for it to signal about.

**Root cause.** Two bugs intertwined: defer order (Go defers in LIFO order, so `Signal` runs before `Unlock`), and the wrong place to signal (Pop signals `notFull` after consuming, not `notEmpty`).

**Fix.** Remove the defer-signal; signal in the right place (producer signals `notEmpty`, consumer signals `notFull`).

```go
func (q *Queue) Pop() (int, error) {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == 0 { q.notEmpty.Wait() }
    v := q.items[0]
    q.items = q.items[1:]
    q.notFull.Signal()  // wake one producer who was waiting on full
    return v, nil
}
```

---

## Bug 11: signalling on every state change in a tight loop

```go
type Counter struct {
    mu   sync.Mutex
    cond *sync.Cond
    n    int
}

func (c *Counter) Inc() {
    c.mu.Lock()
    c.n++
    c.cond.Broadcast()  // wakes 1000 waiters per call
    c.mu.Unlock()
}

func (c *Counter) WaitAt(target int) {
    c.mu.Lock()
    for c.n < target { c.cond.Wait() }
    c.mu.Unlock()
}
```

If `Inc` is called 1M times and 1000 goroutines are waiting on various targets, the broadcast storm burns the CPU.

**Symptom.** Throughput plateaus far below CPU saturation. `pprof` shows `runtime.goready` and `runtime.notifyListNotifyAll` dominating.

**Root cause.** `Broadcast` on every increment wakes all 1000 waiters, 999 of whom re-park.

**Fix.** Use `Signal` if only one waiter could possibly benefit per increment, or design a different data structure (sorted heap of waiters, channel-per-target, etc.).

```go
// Cheapest fix: Signal instead of Broadcast.
// Caveat: if multiple waiters share a target that just got hit, only one wakes.
//        That's usually fine if waiters are independent.
c.cond.Signal()
```

A better fix maintains a sorted list of pending targets and signals only when the next-target threshold is crossed. Or migrate to channels.

---

## Bug 12: state change without signal

```go
type State struct {
    mu      sync.Mutex
    cond    *sync.Cond
    running bool
}

func (s *State) Stop() {
    s.mu.Lock()
    s.running = false
    s.mu.Unlock()
    // BUG: no broadcast
}

func (s *State) WaitStopped() {
    s.mu.Lock()
    for s.running { s.cond.Wait() }
    s.mu.Unlock()
}
```

**Symptom.** `WaitStopped` hangs forever after `Stop` is called.

**Root cause.** `Stop` mutated state but did not signal. The waiter never learns.

**Fix.**

```go
func (s *State) Stop() {
    s.mu.Lock()
    s.running = false
    s.cond.Broadcast()
    s.mu.Unlock()
}
```

---

## Bug 13: signaller holds two locks, deadlock with waiter

```go
type Service struct {
    apiMu  sync.Mutex
    stateMu sync.Mutex
    cond   *sync.Cond  // bound to stateMu
    state  string
}

func (s *Service) RequestReady() {
    s.apiMu.Lock()
    defer s.apiMu.Unlock()
    s.stateMu.Lock()
    for s.state != "ready" { s.cond.Wait() }
    s.stateMu.Unlock()
}

func (s *Service) MarkReady() {
    s.apiMu.Lock()  // BUG: signaller takes apiMu too
    defer s.apiMu.Unlock()
    s.stateMu.Lock()
    s.state = "ready"
    s.cond.Broadcast()
    s.stateMu.Unlock()
}
```

**Symptom.** Deadlock. `RequestReady` holds `apiMu`; `MarkReady` tries to acquire `apiMu`, blocks. `RequestReady` is parked in `Wait` (released `stateMu` but still holds `apiMu`).

**Root cause.** The waiter holds an *additional* lock during `Wait`. `Wait` only releases `cond.L` (which is `stateMu`), not `apiMu`. The signaller cannot make progress.

**Fix.** Either drop `apiMu` before calling `Wait`, or restructure so the signaller does not need `apiMu`.

```go
func (s *Service) RequestReady() {
    s.apiMu.Lock()
    // do api stuff
    s.apiMu.Unlock()

    s.stateMu.Lock()
    for s.state != "ready" { s.cond.Wait() }
    s.stateMu.Unlock()
}
```

Lesson: never hold an extra lock across `Wait`.

---

## Bug 14: range over a Cond-driven channel after close

```go
type Queue struct {
    mu       sync.Mutex
    cond     *sync.Cond
    items    []int
    closed   bool
}

func (q *Queue) Drain() []int {
    q.mu.Lock()
    defer q.mu.Unlock()
    for !q.closed { q.cond.Wait() }
    return q.items
}
```

**Symptom.** Drain returns successfully but with stale data: the caller modifies the returned slice and corrupts the queue's internal state.

**Root cause.** Returning a slice that aliases the internal buffer. Concurrent mutations from `Push` (under the lock, but after Drain returns) race with the caller's reads.

**Fix.** Return a copy.

```go
func (q *Queue) Drain() []int {
    q.mu.Lock()
    defer q.mu.Unlock()
    for !q.closed { q.cond.Wait() }
    out := make([]int, len(q.items))
    copy(out, q.items)
    return out
}
```

The `Cond` discipline was correct; the bug was in the data handling after the wait.

---

## Bug 15: spurious wake-up corrupts assumption

```go
type Box struct {
    mu      sync.Mutex
    cond    *sync.Cond
    value   *int
}

func (b *Box) Wait() *int {
    b.mu.Lock()
    if b.value == nil {     // BUG: should be for
        b.cond.Wait()
    }
    v := b.value           // may still be nil
    b.mu.Unlock()
    return v               // returns nil if spurious
}
```

**Symptom.** Rare nil returns. Callers panic dereferencing.

**Root cause.** Single `if`. A spurious wake-up (or a `Broadcast` from elsewhere) returns `b.value == nil`.

**Fix.**

```go
for b.value == nil { b.cond.Wait() }
```

---

## Bug 16: signal lost during initialization

```go
type Server struct {
    mu    sync.Mutex
    cond  *sync.Cond
    ready bool
}

func main() {
    s := &Server{}
    go func() {
        s.mu.Lock()
        s.ready = true
        s.cond.Signal()     // BUG: cond may be nil
        s.mu.Unlock()
    }()
    s.cond = sync.NewCond(&s.mu)
    s.mu.Lock()
    for !s.ready { s.cond.Wait() }
    s.mu.Unlock()
}
```

**Symptom.** Nil pointer dereference, or a missed wake-up where the goroutine ran with `s.cond == nil`.

**Root cause.** `cond` is assigned after the goroutine starts. Race on `cond` field. If the goroutine reaches `s.cond.Signal()` before the main reaches `s.cond = sync.NewCond(...)`, it panics.

**Fix.** Construct `cond` before spawning.

```go
s := &Server{}
s.cond = sync.NewCond(&s.mu)
go func() { /* uses s.cond safely */ }()
```

---

## Bug 17: Cond's lock is held during a long callback

```go
func (q *Queue) WaitAndProcess(callback func(int)) {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == 0 { q.cond.Wait() }
    v := q.items[0]
    q.items = q.items[1:]
    callback(v)   // BUG: holds the lock for the duration of callback
}
```

**Symptom.** All producers and other consumers block while `callback` runs. Latency spikes.

**Root cause.** The lock is held during user-supplied code. Even if `callback` is fast, holding the lock during *any* I/O or external call is poor practice.

**Fix.** Release the lock before invoking the callback.

```go
func (q *Queue) WaitAndProcess(callback func(int)) {
    q.mu.Lock()
    for len(q.items) == 0 { q.cond.Wait() }
    v := q.items[0]
    q.items = q.items[1:]
    q.cond.Signal() // signal next producer
    q.mu.Unlock()
    callback(v)
}
```

Snapshot the value, unlock, then call out.

---

## Bug 18: waiter that never re-acquires the lock

```go
mu.Lock()
for !ready {
    cond.Wait()
    return // BUG: exits without unlocking
}
```

**Symptom.** Subsequent `mu.Lock()` calls hang forever.

**Root cause.** `Wait` re-acquired the lock before returning. The `return` exits without unlocking. The lock is now permanently held by the dead goroutine.

**Fix.** Always unlock, with `defer` or explicit.

```go
mu.Lock()
defer mu.Unlock()
for !ready {
    cond.Wait()
    if shouldAbort {
        return
    }
}
```

---

## Bug 19: signal-then-state-change

```go
mu.Lock()
cond.Signal()       // BUG: signal before state change
ready = true
mu.Unlock()
```

**Symptom.** Subtle race. The wake-up still works because the lock is held — the waiter re-acquires only after our unlock — so they observe `ready = true`. But it's brittle: if anyone refactors and unlocks between signal and state change, the bug appears.

**Root cause.** Conceptually wrong order. The signal should follow the state change, so the invariant "if signalled then predicate holds" reads naturally.

**Fix.** State change first, signal second.

```go
mu.Lock()
ready = true
cond.Signal()
mu.Unlock()
```

---

## Bug 20: broadcasting from a goroutine that doesn't hold the lock

```go
func (s *Server) ShutdownAsync() {
    go func() {
        s.cond.Broadcast() // BUG: no lock held
        // (caller didn't lock before spawning)
    }()
}
```

**Symptom.** Sometimes waiters wake; sometimes not. State changes that the waiter expects to see may not be visible.

**Root cause.** The broadcast is technically legal without the lock, but state changes (like `s.closed = true`) are not synchronized with the wake-up. Waiters wake, re-acquire the lock, but may not see the state change yet.

**Fix.** Always pair state change + broadcast under the lock.

```go
func (s *Server) ShutdownAsync() {
    go func() {
        s.mu.Lock()
        s.closed = true
        s.cond.Broadcast()
        s.mu.Unlock()
    }()
}
```

---

## Bug 21: starvation under Signal

```go
type Pool struct {
    mu    sync.Mutex
    cond  *sync.Cond
    free  int
    total int
}

func (p *Pool) Acquire() {
    p.mu.Lock()
    for p.free == 0 { p.cond.Wait() }
    p.free--
    p.mu.Unlock()
}

func (p *Pool) Release() {
    p.mu.Lock()
    p.free++
    p.cond.Signal()
    p.mu.Unlock()
}
```

**Symptom.** Under load, some `Acquire` callers wait much longer than others. Tail latencies are very high.

**Root cause.** `Signal` makes no FIFO guarantee. The same goroutine may be woken repeatedly while older waiters stay parked.

**Fix.** If fairness matters, switch to a channel-based pool (channels are FIFO for waiters) or implement an explicit ticket order with `Cond` (verbose).

```go
// Channel-based pool, FIFO:
free := make(chan struct{}, total)
for i := 0; i < total; i++ { free <- struct{}{} }
// Acquire: <-free
// Release: free <- struct{}{}
```

---

## Bug 22: re-entry from inside Wait callback (not possible directly, but via Goroutine)

```go
type Service struct {
    mu   sync.Mutex
    cond *sync.Cond
}

func (s *Service) Wait() {
    s.mu.Lock()
    for !s.ready { s.cond.Wait() }
    s.onReady() // calls back into something that may need s.mu
    s.mu.Unlock()
}
```

**Symptom.** Recursive lock attempt deadlocks.

**Root cause.** `s.onReady()` is invoked while holding `s.mu`. If `onReady` calls a method that tries to lock `s.mu` (directly or via a different code path), deadlock.

**Fix.** Release the lock before invoking callbacks.

```go
func (s *Service) Wait() {
    s.mu.Lock()
    for !s.ready { s.cond.Wait() }
    s.mu.Unlock()
    s.onReady()
}
```

`sync.Mutex` is not re-entrant. Callbacks must run outside the lock.

---

## Bug 23: capturing the Cond before initialization

```go
type S struct { cond *sync.Cond }

func main() {
    s := &S{}
    go func() {
        s.cond.Signal() // BUG: nil pointer
    }()
    s.cond = sync.NewCond(&sync.Mutex{})
}
```

**Symptom.** Nil pointer dereference panic.

**Root cause.** The goroutine starts before `s.cond` is assigned. Race on the field; if the goroutine wins, it reads `nil`.

**Fix.** Initialize before spawning.

```go
s := &S{cond: sync.NewCond(&sync.Mutex{})}
go func() { s.cond.Signal() }()
```

---

## Bug 24: zombie waiter after close

```go
type Q struct {
    mu     sync.Mutex
    cond   *sync.Cond
    items  []int
    closed bool
}

func (q *Q) Pop() (int, error) {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == 0 {
        q.cond.Wait()
    }
    // BUG: forgot to check q.closed
    v := q.items[0]
    q.items = q.items[1:]
    return v, nil
}

func (q *Q) Close() {
    q.mu.Lock()
    q.closed = true
    q.cond.Broadcast()
    q.mu.Unlock()
}
```

**Symptom.** After `Close` with no items, `Pop` returns from `Wait` (woken by Broadcast), but `len(items) == 0` is still true — so the `for` loop re-checks, finds it true, calls `Wait` again. Hangs forever.

**Root cause.** The predicate `len(items) == 0` doesn't account for `closed`. The waiter never exits.

**Fix.** Include `closed` in the predicate.

```go
for !q.closed && len(q.items) == 0 { q.cond.Wait() }
if q.closed && len(q.items) == 0 { return 0, ErrClosed }
```

---

## Bug 25: forgetting that one Cond doesn't fit two predicates

```go
type Bounded struct {
    mu       sync.Mutex
    cond     *sync.Cond
    items    []int
    cap      int
}

func (b *Bounded) Push(v int) {
    b.mu.Lock()
    defer b.mu.Unlock()
    for len(b.items) == b.cap { b.cond.Wait() }
    b.items = append(b.items, v)
    b.cond.Signal()
}

func (b *Bounded) Pop() int {
    b.mu.Lock()
    defer b.mu.Unlock()
    for len(b.items) == 0 { b.cond.Wait() }
    v := b.items[0]
    b.items = b.items[1:]
    b.cond.Signal()
    return v
}
```

**Symptom.** Under stress, producers stay parked when there is room, or consumers stay parked when there are items.

**Root cause.** One `Cond` for two predicates. Push signals — but if the signal wakes another producer (parked on "full"), that producer immediately re-parks because the queue is no longer empty but also not less full. The consumer who needed the wake is still parked.

The runtime cannot distinguish "wake a producer" from "wake a consumer" — it just wakes a waiter. With one `Cond` and two wait sets, every signal is potentially mis-routed.

**Fix.** Two `Cond`s.

```go
type Bounded struct {
    mu       sync.Mutex
    notFull  *sync.Cond
    notEmpty *sync.Cond
    items    []int
    cap      int
}

func (b *Bounded) Push(v int) {
    b.mu.Lock()
    defer b.mu.Unlock()
    for len(b.items) == b.cap { b.notFull.Wait() }
    b.items = append(b.items, v)
    b.notEmpty.Signal()
}

func (b *Bounded) Pop() int {
    b.mu.Lock()
    defer b.mu.Unlock()
    for len(b.items) == 0 { b.notEmpty.Wait() }
    v := b.items[0]
    b.items = b.items[1:]
    b.notFull.Signal()
    return v
}
```

Now each signal targets the correct wait set.

---

## Closing

These 25 bugs cover the practical attack surface. If you have read this file end to end and could reproduce/fix every example, you understand `sync.Cond` well enough to use it safely.

Two reminders for production code:

1. Always justify the choice of `Cond` over a channel with a comment.
2. Always run with `go test -race`. Many of the bugs above are detected by the race detector.

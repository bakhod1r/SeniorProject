# sync.Cond — Tasks

Each task includes a brief, acceptance criteria, hints, and a solution sketch. Solve the task first; consult the sketch after.

The tasks build from the basics to design exercises that compare `Cond` with channels.

---

## Task 1 — Hello, Cond

Write a program where one goroutine waits for a flag to be set, and another sets it after 100 ms.

**Acceptance.** Use `sync.Cond`. The waiter prints "ready" after the flag is set. The program exits cleanly.

**Hints.** Lock around the predicate. `for !ready { cond.Wait() }`. The setter signals under the lock.

**Solution sketch.**

```go
var mu sync.Mutex
cond := sync.NewCond(&mu)
ready := false

go func() {
    time.Sleep(100 * time.Millisecond)
    mu.Lock()
    ready = true
    cond.Signal()
    mu.Unlock()
}()

mu.Lock()
for !ready { cond.Wait() }
mu.Unlock()
fmt.Println("ready")
```

---

## Task 2 — Five runners, one starting gun

Spawn 5 goroutines that wait for a "go" flag. When the flag flips, all 5 print "running" simultaneously (as close as possible).

**Acceptance.** Single `Broadcast`. All 5 goroutines visibly proceed. Use `sync.WaitGroup` to join.

**Solution sketch.**

```go
var mu sync.Mutex
cond := sync.NewCond(&mu)
var wg sync.WaitGroup
go_ := false

for i := 0; i < 5; i++ {
    wg.Add(1)
    go func(id int) {
        defer wg.Done()
        mu.Lock()
        for !go_ { cond.Wait() }
        mu.Unlock()
        fmt.Println("runner", id, "running")
    }(i)
}

time.Sleep(50 * time.Millisecond)
mu.Lock()
go_ = true
cond.Broadcast()
mu.Unlock()
wg.Wait()
```

---

## Task 3 — Bounded queue (`sync.Cond` version)

Implement a thread-safe bounded queue `Q[T]` with `Push`, `Pop`, `Close`. `Push` blocks when full; `Pop` blocks when empty. After `Close`, `Push` returns `ErrClosed`; `Pop` drains remaining items and then returns `ErrClosed`.

**Acceptance.** Multiple producers and consumers. Use two `*sync.Cond` sharing one mutex. Tests must cover close-while-waiting.

**Solution sketch.** See `middle.md` "Bounded Queue, Done Properly."

---

## Task 4 — Bounded queue (channel version)

Reimplement Task 3 using only a buffered channel. Compare the line count.

**Acceptance.** Same semantics: `Push`, `Pop`, `Close`, `ErrClosed`. Tests pass.

**Solution sketch.**

```go
type Q[T any] struct {
    ch     chan T
    closed atomic.Bool
}

func NewQ[T any](cap int) *Q[T] { return &Q[T]{ch: make(chan T, cap)} }

var ErrClosed = errors.New("queue closed")

func (q *Q[T]) Push(v T) error {
    if q.closed.Load() { return ErrClosed }
    q.ch <- v
    return nil
}

func (q *Q[T]) Pop() (T, error) {
    v, ok := <-q.ch
    if !ok { return v, ErrClosed }
    return v, nil
}

func (q *Q[T]) Close() {
    if q.closed.CompareAndSwap(false, true) {
        close(q.ch)
    }
}
```

Compare: the channel version is ~20 lines vs ~40 lines for `Cond`. Note: `Push` after `Close` has a race here (load + send), so a real implementation needs more care. The `Cond` version handles this naturally with the lock.

---

## Task 5 — Connection pool

Build a `Pool` that holds up to N `*Conn`. `Get()` blocks until a connection is free; `Put(*Conn)` returns one and wakes one waiter. Add `Close()` to drain and refuse new gets.

**Acceptance.** Multiple concurrent `Get`/`Put` callers. No leaks. Tests for close-during-wait.

**Solution sketch.** See `middle.md` "Resource Pool with Capacity."

---

## Task 6 — Pool with context

Extend Task 5 so `Get` takes a `context.Context` and returns early on cancellation. Compare the `Cond` and channel implementations.

**Acceptance.** `Get(ctx)` returns `ctx.Err()` if cancelled before a connection is available. The `Cond` version requires a helper goroutine; the channel version uses `select`.

**Solution sketch (Cond).**

```go
func (p *Pool) Get(ctx context.Context) (*Conn, error) {
    done := make(chan struct{})
    defer close(done)
    go func() {
        select {
        case <-ctx.Done():
            p.mu.Lock(); p.cond.Broadcast(); p.mu.Unlock()
        case <-done:
        }
    }()

    p.mu.Lock()
    defer p.mu.Unlock()
    for len(p.free) == 0 && ctx.Err() == nil { p.cond.Wait() }
    if ctx.Err() != nil { return nil, ctx.Err() }
    c := p.free[len(p.free)-1]
    p.free = p.free[:len(p.free)-1]
    return c, nil
}
```

**Solution sketch (channel).**

```go
func (p *Pool) Get(ctx context.Context) (*Conn, error) {
    select {
    case c := <-p.free:
        return c, nil
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}
```

Note the extra goroutine in the `Cond` version. In a server with 10 000 concurrent waiters, that's 10 000 extra goroutines.

---

## Task 7 — Reference-counted shutdown

Implement a `RefCounter` with `Add(int)` and `WaitZero()`. Multiple goroutines can call `WaitZero` and all must wake when the count reaches zero.

**Acceptance.** Tests with concurrent `Add` and `WaitZero` callers. No leaks.

**Solution sketch.**

```go
type RefCounter struct {
    mu   sync.Mutex
    cond *sync.Cond
    n    int
}

func NewRefCounter() *RefCounter {
    c := &RefCounter{}
    c.cond = sync.NewCond(&c.mu)
    return c
}

func (c *RefCounter) Add(delta int) {
    c.mu.Lock()
    c.n += delta
    if c.n == 0 { c.cond.Broadcast() }
    c.mu.Unlock()
}

func (c *RefCounter) WaitZero() {
    c.mu.Lock()
    for c.n != 0 { c.cond.Wait() }
    c.mu.Unlock()
}
```

---

## Task 8 — WaitGroup from scratch

Implement a `WaitGroup`-equivalent on `sync.Cond`. Methods: `Add`, `Done`, `Wait`. Compare with `sync.WaitGroup`.

**Acceptance.** Same semantics as `sync.WaitGroup`. Tests with 1000 concurrent `Add` and `Done` calls.

**Solution sketch.** Same as Task 7. The real `sync.WaitGroup` uses atomics and `runtime/sema` for speed; the `Cond` version is conceptually equivalent but slower under contention.

---

## Task 9 — Pause / resume a worker pool

Build a worker pool that can be paused (no work consumed) and resumed (workers wake and consume again). The pool reads jobs from an input channel.

**Acceptance.** Pause/resume can be called repeatedly. Workers cleanly drain on `Close`. Tests for pause-during-work.

**Solution sketch.**

```go
type Pool struct {
    mu     sync.Mutex
    cond   *sync.Cond
    state  int // 0 paused, 1 running, 2 closed
    jobs   <-chan Job
}

func (p *Pool) worker() {
    for {
        p.mu.Lock()
        for p.state == 0 { p.cond.Wait() }
        if p.state == 2 { p.mu.Unlock(); return }
        p.mu.Unlock()

        select {
        case j, ok := <-p.jobs:
            if !ok { return }
            j.Do()
        }
    }
}

func (p *Pool) Pause()  { p.mu.Lock(); p.state = 0; p.mu.Unlock() }
func (p *Pool) Resume() { p.mu.Lock(); p.state = 1; p.cond.Broadcast(); p.mu.Unlock() }
func (p *Pool) Close()  { p.mu.Lock(); p.state = 2; p.cond.Broadcast(); p.mu.Unlock() }
```

---

## Task 10 — One Cond, many predicates (anti-pattern)

Take Task 3 (bounded queue) and try to implement it with a *single* `Cond` instead of two. Benchmark both versions under heavy load (many producers, many consumers, 1M operations). Report the difference.

**Acceptance.** Both implementations pass functional tests. The single-`Cond` version is noticeably slower under high contention (typically 1.5x–3x), because every push wakes consumers *and* producers, half of whom re-park.

**Solution sketch.** Replace `notFull` and `notEmpty` with one `cond`. In `Push`, signal/broadcast `cond` after appending. In `Pop`, same. Run `go test -bench` and observe.

---

## Task 11 — Priority bounded queue

Extend Task 3 so items have priorities and `Pop` returns the highest-priority item first. Producers still wait when full; consumers wait when empty.

**Acceptance.** Items pop in priority order. Fairness within a priority is not required.

**Hints.** Use a heap for `items`. Otherwise the structure is identical.

---

## Task 12 — Reader-writer with three states

Implement a sync primitive that allows multiple "readers" *or* one "writer," but never both. Use `sync.Cond` (compare with `sync.RWMutex`).

**Acceptance.** No reader starvation under heavy writer load. Tests with 10 readers + 1 writer.

**Solution sketch.**

```go
type RW struct {
    mu       sync.Mutex
    cond     *sync.Cond
    readers  int
    writer   bool
    waitingW int
}

func (r *RW) RLock() {
    r.mu.Lock()
    for r.writer || r.waitingW > 0 { r.cond.Wait() }
    r.readers++
    r.mu.Unlock()
}
func (r *RW) RUnlock() {
    r.mu.Lock()
    r.readers--
    if r.readers == 0 { r.cond.Broadcast() }
    r.mu.Unlock()
}
func (r *RW) Lock() {
    r.mu.Lock()
    r.waitingW++
    for r.writer || r.readers > 0 { r.cond.Wait() }
    r.waitingW--
    r.writer = true
    r.mu.Unlock()
}
func (r *RW) Unlock() {
    r.mu.Lock()
    r.writer = false
    r.cond.Broadcast()
    r.mu.Unlock()
}
```

The `waitingW` counter gives writers priority — readers wait when a writer is queued. This is one design; another would prioritize readers.

---

## Task 13 — Implement Cond with channels (educational)

Implement a `myCond` struct with `Wait`, `Signal`, `Broadcast` using only mutexes and channels. Compare with `sync.Cond`.

**Acceptance.** Functional equivalence on simple tests. Discuss what's missing.

**Solution sketch.**

```go
type myCond struct {
    L  sync.Locker
    mu sync.Mutex
    waiters []chan struct{}
}

func (c *myCond) Wait() {
    c.mu.Lock()
    ch := make(chan struct{})
    c.waiters = append(c.waiters, ch)
    c.mu.Unlock()
    c.L.Unlock()
    <-ch
    c.L.Lock()
}

func (c *myCond) Signal() {
    c.mu.Lock()
    if len(c.waiters) > 0 {
        ch := c.waiters[0]
        c.waiters = c.waiters[1:]
        close(ch)
    }
    c.mu.Unlock()
}

func (c *myCond) Broadcast() {
    c.mu.Lock()
    for _, ch := range c.waiters { close(ch) }
    c.waiters = nil
    c.mu.Unlock()
}
```

This works but allocates a channel per `Wait` call. `sync.Cond` uses `sudog` pooling to avoid this. The exercise teaches that `Cond` is essentially a wait-list manager.

---

## Task 14 — Cond-based once

Implement `Once`-equivalent on `Cond`: `Do(f)` runs `f` exactly once. Concurrent callers either run `f` or wait for the running call to finish.

**Acceptance.** Tests with 100 concurrent `Do` calls. `f` runs once.

**Solution sketch.**

```go
type Once struct {
    mu   sync.Mutex
    cond *sync.Cond
    done bool
    running bool
}

func (o *Once) Do(f func()) {
    o.mu.Lock()
    for o.running { o.cond.Wait() }
    if o.done { o.mu.Unlock(); return }
    o.running = true
    o.mu.Unlock()
    f()
    o.mu.Lock()
    o.done = true
    o.running = false
    o.cond.Broadcast()
    o.mu.Unlock()
}
```

The real `sync.Once` uses an atomic `uint32` and is much faster. The `Cond` version is conceptually equivalent.

---

## Task 15 — Latency-sensitive signal

Measure the latency from `cond.Signal()` to `Wait` returning. Compare with a channel send / receive on a `chan struct{}` with a single waiter.

**Acceptance.** A benchmark with `time.Now()` taken before signal and after wake. Report mean latency.

**Hints.** Run with `runtime.GOMAXPROCS(1)` for stable results. Repeat 10 000 times. Use `b.ResetTimer()`.

**Expected.** Both are in the sub-microsecond range. Channel send is typically slightly faster (~100 ns); `Cond.Signal` is a few hundred ns. The differences are small enough that ergonomic concerns dominate.

---

## Task 16 — Find the broadcast storm

Take Task 7 (RefCounter) and add 1000 `WaitZero` callers. Have one goroutine do `Add(+1)` and `Add(-1)` in a tight loop 1M times. Profile.

**Acceptance.** Observe the broadcast storm: every `Add(-1)` that takes count to zero wakes all 1000 waiters, who immediately re-park because count just went up again. CPU is dominated by `sync.runtime_notifyListNotifyAll` and `runtime.goready`.

**Mitigation.** Only broadcast on the *transition* to zero from a non-zero state, *and* ensure the transition is observable (set a flag, broadcast once, never broadcast again).

---

## Task 17 — Drain-on-close

Build a sink: producers push items; one consumer drains. On `Close`, the producers must stop pushing (return error), and the consumer must drain all already-pushed items before returning.

**Acceptance.** No items lost on close. Tests with 100 producers and 1 consumer.

---

## Task 18 — Multi-state machine

Build a machine with states `Init -> Connecting -> Ready -> Closed`. Multiple goroutines call `WaitFor(state)` and unblock when the state reaches their target (or a later state, since states only move forward).

**Acceptance.** A goroutine calling `WaitFor(Ready)` unblocks once state is `Ready` *or* `Closed`. Use one `Cond`.

**Solution sketch.**

```go
type Machine struct {
    mu    sync.Mutex
    cond  *sync.Cond
    state State
}

func (m *Machine) WaitFor(target State) {
    m.mu.Lock()
    for m.state < target { m.cond.Wait() }
    m.mu.Unlock()
}

func (m *Machine) SetState(s State) {
    m.mu.Lock()
    m.state = s
    m.cond.Broadcast()
    m.mu.Unlock()
}
```

`Broadcast` is essential because waiters have different targets.

---

## Task 19 — Replace with channels

Take Task 18 and rewrite using only channels. Compare clarity and line count.

**Acceptance.** Same external API. No `sync.Cond` in the implementation.

**Solution sketch.** One channel per state, closed on transition:

```go
type Machine struct {
    mu      sync.Mutex
    state   State
    chans   map[State]chan struct{}
}

func NewMachine() *Machine {
    m := &Machine{chans: map[State]chan struct{}{}}
    for _, s := range []State{Init, Connecting, Ready, Closed} {
        m.chans[s] = make(chan struct{})
    }
    return m
}

func (m *Machine) WaitFor(target State) {
    <-m.chans[target]
}

func (m *Machine) SetState(s State) {
    m.mu.Lock()
    defer m.mu.Unlock()
    for cur := m.state + 1; cur <= s; cur++ {
        close(m.chans[cur])
    }
    m.state = s
}
```

Each state transition closes channels for that state. Waiters block on `<-m.chans[target]`. Once closed, the channel is a permanent "yes" signal. This is the canonical "broadcast-on-event" pattern in Go.

The channel version is comparable in size but supports `select` and `ctx.Done()` integration trivially.

---

## Task 20 — When Cond truly wins

Find a real-world example in your own code (or in a Go library) where `Cond` is used. Justify whether the choice is correct, or rewrite with channels.

**Acceptance.** Either a written justification ("the multi-predicate / explicit state / repeated broadcast use case applies because..."), or a channel-based rewrite that is at most as long and as clear as the original.

This task has no model answer; it is the senior-level integration exercise. Most of the time, the channel version wins. When it doesn't, articulate exactly why.

---

## Bonus tasks

### Task B1 — Stress-test the discipline

Write a test that runs a `Cond`-based bounded queue with 1000 producers, 1000 consumers, and 1M total items. Verify total count matches and no items are lost or duplicated. Run with `-race`.

### Task B2 — Inject misuse

Take a working `Cond`-based queue and introduce each of these bugs in turn:
- `if !predicate { Wait() }` instead of `for`
- Signal outside the lock
- Signal under a different mutex
- Forget to broadcast on close

For each, write a test that *would* catch the bug under stress. Then fix.

### Task B3 — Replace Cond in a real codebase

Search the Go ecosystem (your favorite Go libraries) for `sync.NewCond`. Pick one. Read the surrounding code, understand why `Cond` was used, and propose a channel-based replacement (or argue why `Cond` is correct).

Real examples to start with:
- `database/sql` — older versions used `Cond`; newer use semaphores.
- `gocql/gocql` — connection pool, historical use.
- Any worker-pool library.

---

## Closing

These tasks build muscle memory for the discipline rules and the design decisions. The final test is Task 20: in your own code, do you reach for `Cond` because it's the right tool, or because you have a habit from another language? The answer to that question is the senior-level skill.

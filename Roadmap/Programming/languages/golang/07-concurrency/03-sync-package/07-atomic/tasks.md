# sync/atomic — Hands-On Tasks

Each task is independent. Pick the level that matches your current confidence. Solutions are sketched at the end of each task; resist the urge to peek before attempting.

---

## Task 1 — Basic Atomic Counter

**Difficulty:** Junior

Build a `Counter` type that supports `Inc`, `Add(int64)`, `Value()` and is safe for concurrent use.

### Requirements
- Use `atomic.Int64`, not a raw `int64` plus the legacy API.
- Methods take pointer receivers.
- The counter cannot be copied (use a `noCopy` marker or rely on `atomic.Int64`'s built-in marker).

### Test
Spawn 1000 goroutines, each calling `Inc` 1000 times. Assert `Value()` is exactly 1,000,000.

### Solution sketch

```go
type Counter struct {
    n atomic.Int64
}

func (c *Counter) Inc()         { c.n.Add(1) }
func (c *Counter) Add(d int64)  { c.n.Add(d) }
func (c *Counter) Value() int64 { return c.n.Load() }
```

The `atomic.Int64` type contains a `noCopy` marker; `go vet` flags copies of `Counter` automatically.

---

## Task 2 — Stop Flag for a Worker Pool

**Difficulty:** Junior

Build a worker pool that processes items from a slice. The pool must support a `Stop()` call that signals all workers to drain and exit.

### Requirements
- 8 workers.
- Use `atomic.Bool` for the stop flag.
- Workers check the flag at the top of each item.
- `Stop()` returns when all workers have exited.

### Test
Start the pool with 10,000 items, call `Stop()` after 100 ms, assert that some items are unprocessed and the pool exits cleanly within another 100 ms.

### Solution sketch

```go
type Pool struct {
    stop atomic.Bool
    wg   sync.WaitGroup
}

func (p *Pool) Run(items []Item) {
    ch := make(chan Item)
    for i := 0; i < 8; i++ {
        p.wg.Add(1)
        go func() {
            defer p.wg.Done()
            for item := range ch {
                if p.stop.Load() {
                    return
                }
                process(item)
            }
        }()
    }
    for _, it := range items {
        if p.stop.Load() {
            break
        }
        ch <- it
    }
    close(ch)
}

func (p *Pool) Stop() {
    p.stop.Store(true)
    p.wg.Wait()
}
```

---

## Task 3 — Hot-Reload Configuration

**Difficulty:** Junior-Middle

Build a `ConfigStore` that holds a `*Config`. Readers should never block. Writers atomically replace the entire config.

### Requirements
- Use `atomic.Pointer[Config]`.
- `Get()` returns the current `*Config` (may return `nil` if never set).
- `Set(*Config)` replaces the config.
- Document that callers must not mutate the returned config.

### Test
Spawn 100 reader goroutines that loop `Get()` and read fields. Spawn one writer that calls `Set` 1000 times with a fresh `Config`. Run for one second under `-race`. Assert no races, all reads complete, all writes succeed.

### Solution sketch

```go
type Config struct {
    Endpoint string
    Timeout  time.Duration
}

type ConfigStore struct {
    p atomic.Pointer[Config]
}

func (s *ConfigStore) Get() *Config         { return s.p.Load() }
func (s *ConfigStore) Set(c *Config)        { s.p.Store(c) }
```

The producer must build a new `Config` for each `Set` and never mutate after.

---

## Task 4 — Compare-and-Swap Maximum

**Difficulty:** Middle

Build an `AtomicMax` type that tracks the maximum value seen so far. `Observe(v)` may be called concurrently; `Max()` returns the current maximum.

### Requirements
- Use `atomic.Int64`.
- `Observe` only advances the value upward; never downward.
- Implement with a CAS loop.

### Test
Spawn 100 goroutines, each calling `Observe(rand.Int63n(1e9))` 1000 times. Compute the max of the same sequence sequentially; assert `Max()` matches.

### Solution sketch

```go
type AtomicMax struct {
    v atomic.Int64
}

func (m *AtomicMax) Observe(x int64) {
    for {
        cur := m.v.Load()
        if x <= cur {
            return
        }
        if m.v.CompareAndSwap(cur, x) {
            return
        }
    }
}

func (m *AtomicMax) Max() int64 { return m.v.Load() }
```

Notice: under contention, the CAS may retry. The early `if x <= cur { return }` avoids the CAS when the value already exceeds ours. This is a common optimisation.

---

## Task 5 — Reference-Counted Buffer

**Difficulty:** Middle

Build a `Buffer` type that wraps a `[]byte` and is reference-counted. The buffer must call a registered `release` function when the count drops to zero.

### Requirements
- `Acquire()` increments the count; `Release()` decrements.
- Initial count is 1 (caller owns it).
- `Acquire()` must refuse to resurrect a zero-count buffer.
- `Release()` calls `release()` exactly once when count hits zero.

### Test
Allocate, acquire 5 times (count = 6), release 6 times. Assert the release function is called exactly once. Repeat with concurrent goroutines.

### Solution sketch

```go
type Buffer struct {
    refs    atomic.Int64
    data    []byte
    release func()
}

func NewBuffer(data []byte, release func()) *Buffer {
    b := &Buffer{data: data, release: release}
    b.refs.Store(1)
    return b
}

func (b *Buffer) Acquire() bool {
    for {
        n := b.refs.Load()
        if n == 0 {
            return false
        }
        if b.refs.CompareAndSwap(n, n+1) {
            return true
        }
    }
}

func (b *Buffer) Release() {
    if b.refs.Add(-1) == 0 {
        b.release()
    }
}
```

Note the careful `Acquire` with CAS: it refuses to increment a count of zero, preventing resurrection of a buffer that is about to be released.

---

## Task 6 — Bitset State Machine

**Difficulty:** Middle (Go 1.23+ for And/Or; otherwise use CAS loops)

Build a state holder that tracks a 32-bit set of flags. Operations:
- `Set(flag)` — set the bit.
- `Clear(flag)` — clear the bit.
- `Has(flag) bool` — test the bit.
- `Replace(set, clear uint32)` — set some bits and clear others atomically.

### Requirements
- Use `atomic.Uint32`.
- If Go 1.23+ is available, use `Or` / `And` for `Set` / `Clear`. Otherwise, use CAS loops.
- `Replace` must apply both updates as one atomic step.

### Test
Concurrently `Set` and `Clear` various bits. Assert no bit is "stuck" in the wrong state at the end. Test `Replace` with two flags swapping atomically.

### Solution sketch

```go
type State struct {
    v atomic.Uint32
}

// Go 1.23+
func (s *State) Set(flag uint32)   { s.v.Or(flag) }
func (s *State) Clear(flag uint32) { s.v.And(^flag) }

// Pre Go 1.23
func (s *State) SetCAS(flag uint32) {
    for {
        old := s.v.Load()
        if s.v.CompareAndSwap(old, old|flag) { return }
    }
}

func (s *State) Has(flag uint32) bool {
    return s.v.Load()&flag != 0
}

func (s *State) Replace(set, clear uint32) {
    for {
        old := s.v.Load()
        new := (old | set) &^ clear
        if s.v.CompareAndSwap(old, new) { return }
    }
}
```

`Replace` must be a CAS loop because there is no single CPU instruction for "set these bits and clear those others" in one step.

---

## Task 7 — Lock-Free Treiber Stack

**Difficulty:** Senior

Implement a lock-free LIFO stack with `Push(v any)` and `Pop() (any, bool)`.

### Requirements
- Use `atomic.Pointer[Node]`.
- No mutex.
- Be aware of (but in Go, not affected by) the ABA problem; document it in a comment.

### Test
Spawn 100 producers and 100 consumers. Producers push integers `0..1000`. Consumers pop until empty. Assert: every integer that was pushed is popped exactly once.

### Solution sketch

```go
type stackNode struct {
    value any
    next  *stackNode
}

type Stack struct {
    head atomic.Pointer[stackNode]
}

func (s *Stack) Push(v any) {
    n := &stackNode{value: v}
    for {
        n.next = s.head.Load()
        if s.head.CompareAndSwap(n.next, n) {
            return
        }
    }
}

func (s *Stack) Pop() (any, bool) {
    for {
        top := s.head.Load()
        if top == nil {
            return nil, false
        }
        if s.head.CompareAndSwap(top, top.next) {
            return top.value, true
        }
    }
}
```

ABA: in Go, the GC keeps `top` alive while `Pop` holds it, preventing pointer reuse. The classic ABA bug does not arise. If you ever pool nodes via `sync.Pool`, ABA returns.

---

## Task 8 — Sharded Counter

**Difficulty:** Senior

Build a `ShardedCounter` that scales linearly with CPU count. `Inc` should be contention-free (or close to it); `Load` sums all shards.

### Requirements
- Number of shards = `runtime.NumCPU()` (or a fixed power of 2).
- Each shard is in a struct padded to 64 bytes to avoid false sharing.
- Shard selection: hash of a per-goroutine value, or a runtime trick.

### Test
Benchmark `Inc` from `N` goroutines for `N = 1, 4, 16`. Compare to a single `atomic.Int64`. Verify throughput scales for the sharded version and degrades for the single counter.

### Solution sketch

```go
type shard struct {
    v atomic.Int64
    _ [56]byte // pad
}

type ShardedCounter struct {
    shards []shard
}

func New() *ShardedCounter {
    return &ShardedCounter{shards: make([]shard, runtime.NumCPU())}
}

func (c *ShardedCounter) Inc() {
    idx := pickShard(len(c.shards))
    c.shards[idx].v.Add(1)
}

func (c *ShardedCounter) Load() int64 {
    var total int64
    for i := range c.shards {
        total += c.shards[i].v.Load()
    }
    return total
}

func pickShard(n int) int {
    var x int
    return int(uintptr(unsafe.Pointer(&x))) % n // address of stack variable
}
```

`pickShard` uses the goroutine's stack address as a hash. Different goroutines have different stacks; the modulus distributes them across shards. Not perfectly uniform but contention-free enough for most cases.

---

## Task 9 — Spin-Lock Implementation (Educational)

**Difficulty:** Senior

Implement a `SpinLock` with `Lock()` and `Unlock()`. The goal is education; do not use this in production.

### Requirements
- Use `atomic.Int32` as the state.
- `Lock` spins until it acquires the lock.
- Yield to other goroutines after a few failed attempts.

### Test
Compare against `sync.Mutex` under low and high contention. Spin-locks win at very low contention with sub-microsecond critical sections; otherwise mutex wins.

### Solution sketch

```go
type SpinLock struct {
    state atomic.Int32
}

func (l *SpinLock) Lock() {
    for i := 0; !l.state.CompareAndSwap(0, 1); i++ {
        if i > 10 {
            runtime.Gosched()
        }
    }
}

func (l *SpinLock) Unlock() {
    l.state.Store(0)
}
```

Use case in real systems: extremely short critical sections (a few nanoseconds), where parking via the mutex would cost more than spinning. Almost never the right choice in application Go code.

---

## Task 10 — Once-Only Init via CAS

**Difficulty:** Senior

Implement a `Once` type with `Do(func())` semantics. The function runs exactly once; concurrent callers wait until it completes.

### Requirements
- Use `atomic.Int32` and `sync.Mutex`.
- Fast path: check the atomic flag, no lock.
- Slow path: lock, check again, run if first.
- Concurrent callers must wait for the function to finish.

### Test
Spawn 100 goroutines all calling `once.Do(initFn)`. Assert `initFn` ran exactly once and all goroutines completed only after it finished.

### Solution sketch

```go
type Once struct {
    done atomic.Int32
    m    sync.Mutex
}

func (o *Once) Do(f func()) {
    if o.done.Load() == 0 {
        o.doSlow(f)
    }
}

func (o *Once) doSlow(f func()) {
    o.m.Lock()
    defer o.m.Unlock()
    if o.done.Load() == 0 {
        defer o.done.Store(1)
        f()
    }
}
```

This is almost exactly the `sync.Once` implementation. Note: the slow path takes the mutex even on the second time through, ensuring waiters block until `f()` finishes. A pure CAS would not wait.

---

## Task 11 — Atomic Snapshot of Two Variables

**Difficulty:** Senior

Build a type that holds two integers `(a, b)`. Readers must observe a consistent snapshot: never a new `a` paired with an old `b` or vice versa.

### Requirements
- One writer at a time (you may use a mutex on the write side).
- Many concurrent readers, lock-free.
- Use `atomic.Pointer[Pair]` to publish.

### Test
Have a writer continuously update `(a, b) = (i, -i)`. Have readers continuously check `a == -b`. Assert no reader ever sees `a + b != 0`.

### Solution sketch

```go
type Pair struct{ A, B int64 }

type Atomic2 struct {
    p atomic.Pointer[Pair]
    m sync.Mutex // serialises writers
}

func (s *Atomic2) Get() Pair { return *s.p.Load() }

func (s *Atomic2) Set(a, b int64) {
    s.m.Lock()
    defer s.m.Unlock()
    s.p.Store(&Pair{A: a, B: b})
}
```

Readers load one pointer; they see one consistent `Pair`. The atomic-pointer pattern handles multi-field consistency by packing into a struct.

---

## Task 12 — Sequence Number Generator

**Difficulty:** Middle-Senior

Build a generator that issues unique, monotonically increasing 64-bit sequence numbers. `Next()` returns the next number; concurrent callers never see duplicates.

### Requirements
- Use `atomic.Int64.Add(1)`.
- After 2^63-1 calls, behaviour is undefined (acceptable for any real workload).
- Compare with a CAS-loop alternative; observe that `Add` is faster.

### Test
Spawn 100 goroutines each calling `Next()` 10,000 times. Assert: no duplicate is returned anywhere. Sum of all values equals `n*(n+1)/2` where `n = 1,000,000`.

### Solution sketch

```go
type Seq struct {
    n atomic.Int64
}

func (s *Seq) Next() int64 { return s.n.Add(1) }
```

`Add` returns the *new* value, which is what we want as the next sequence number.

---

## Task 13 — Snapshot-and-Reset Metrics

**Difficulty:** Junior-Middle

Build a metric counter where the metrics scraper periodically calls `Drain()` to read the count and reset it to zero in one atomic step.

### Requirements
- Use `atomic.Int64.Swap(0)`.
- `Add(n)` records events.
- `Drain()` returns the count and resets to zero atomically.

### Test
Add 1000 events. Drain. Assert the result is exactly 1000 and the counter is now 0. Spawn concurrent adders during a Drain; assert nothing is lost.

### Solution sketch

```go
type Metric struct {
    n atomic.Int64
}

func (m *Metric) Add(n int64) { m.n.Add(n) }
func (m *Metric) Drain() int64 { return m.n.Swap(0) }
```

The `Swap(0)` is the entire point: between a separate `Load` and `Store`, increments could be lost. `Swap` makes it atomic.

---

## Task 14 — Atomic Pointer to Linked List Head

**Difficulty:** Senior

Build a single-producer, single-consumer queue where the producer appends to the tail and the consumer reads from the head, both lock-free.

### Requirements
- Atomic pointer to the head node.
- Tail pointer maintained by the producer alone.
- Use `atomic.Pointer[Node]`.

### Test
One producer pushes 100,000 integers; one consumer reads them all. Assert: all pushed values are consumed in order.

### Solution sketch

This is intricate; the basic shape:

```go
type Node struct {
    val  int
    next atomic.Pointer[Node]
}

type SPSCQueue struct {
    head atomic.Pointer[Node]
    tail *Node // single-writer; no atomic needed if you trust the producer's exclusivity
}

func New() *SPSCQueue {
    dummy := &Node{}
    q := &SPSCQueue{tail: dummy}
    q.head.Store(dummy)
    return q
}

func (q *SPSCQueue) Push(v int) {
    n := &Node{val: v}
    q.tail.next.Store(n)
    q.tail = n
}

func (q *SPSCQueue) Pop() (int, bool) {
    head := q.head.Load()
    next := head.next.Load()
    if next == nil {
        return 0, false
    }
    q.head.Store(next)
    return next.val, true
}
```

The dummy head simplifies pop: there is always a head, with `next` pointing at the actual first node (or nil if empty).

---

## Task 15 — Bounded Lock-Free Ring Buffer

**Difficulty:** Staff

Implement a single-producer, single-consumer ring buffer of fixed capacity.

### Requirements
- Use `atomic.Uint64` for the head and tail indices.
- Producer waits when full; consumer waits when empty (use a small sleep or `runtime.Gosched`).
- Capacity is a power of 2 (mask instead of modulo).

### Test
Produce 1M values; consume them all; assert FIFO order.

### Solution sketch

```go
type Ring struct {
    buf  []int
    mask uint64
    head atomic.Uint64 // consumer reads from head
    tail atomic.Uint64 // producer writes to tail
}

func NewRing(capPow2 int) *Ring {
    size := 1 << capPow2
    return &Ring{buf: make([]int, size), mask: uint64(size - 1)}
}

func (r *Ring) Push(v int) {
    for {
        tail := r.tail.Load()
        head := r.head.Load()
        if tail-head == uint64(len(r.buf)) {
            runtime.Gosched()
            continue
        }
        r.buf[tail&r.mask] = v
        r.tail.Store(tail + 1)
        return
    }
}

func (r *Ring) Pop() (int, bool) {
    head := r.head.Load()
    tail := r.tail.Load()
    if head == tail {
        return 0, false
    }
    v := r.buf[head&r.mask]
    r.head.Store(head + 1)
    return v, true
}
```

This is the classic Lamport SPSC queue. Multi-producer / multi-consumer variants need more atomics and are significantly more complex.

---

## Final Notes

Tasks 1-3 should be obvious after reading `junior.md`. Tasks 4-6 require comfort with CAS loops, covered in `middle.md`. Tasks 7-11 cross into lock-free territory, the domain of `senior.md`. Tasks 12-15 build real concurrent data structures and benefit from `professional.md` understanding.

For every task: write a `-race`-clean test. Run benchmarks. Compare against a mutex-based version. The intuition you build is more valuable than the code you write.

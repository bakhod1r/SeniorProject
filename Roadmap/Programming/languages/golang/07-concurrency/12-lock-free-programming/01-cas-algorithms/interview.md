# Compare-and-Swap (CAS) Algorithms — Interview

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Conceptual Questions](#conceptual-questions)
3. [Code-Reading Questions](#code-reading-questions)
4. [Design Questions](#design-questions)
5. [Performance Questions](#performance-questions)
6. [Hardware-Level Questions](#hardware-level-questions)
7. [Bug-Spotting Questions](#bug-spotting-questions)
8. [System-Design Vignettes](#system-design-vignettes)
9. [Whiteboard Coding Prompts](#whiteboard-coding-prompts)

---

## How to Use This File

These questions span junior, middle, senior, and professional levels. For each: a short prompt, a complete answer, and (where relevant) the reasoning a strong candidate would walk through. The expected depth differs across levels — what is a complete answer for a junior interview may be a starting point at the senior level.

For self-study, cover the answer, attempt to articulate it, then compare.

---

## Conceptual Questions

### Q1. What is Compare-and-Swap in one sentence?

**Answer.** CAS is an atomic CPU operation that conditionally writes a new value to a memory location only if the current value matches an expected old value, returning whether the write happened.

### Q2. Why is CAS atomic?

**Answer.** Because the hardware implements it as a single instruction (`LOCK CMPXCHG` on x86, `CAS` or LL/SC on ARM) that holds exclusive ownership of the cache line for the duration of the read, compare, and conditional write. No other CPU can observe a partial state.

### Q3. Write the canonical CAS-loop pseudocode.

**Answer.**

```go
for {
    old := shared.Load()
    new := compute(old)
    if shared.CompareAndSwap(old, new) {
        break
    }
}
```

Four phases: load snapshot, compute new value from snapshot, attempt swap, retry on failure.

### Q4. What is the difference between lock-free and wait-free?

**Answer.**

- **Lock-free:** at every instant, at least one thread makes progress globally. Individual threads can stall, but the system advances.
- **Wait-free:** every thread completes its operation in a bounded number of its own steps, regardless of other threads.

CAS loops are lock-free but not wait-free.

### Q5. Why isn't a CAS loop wait-free?

**Answer.** Under sustained contention, a particular goroutine can lose its CAS arbitrarily many times. Some other goroutine wins each round (so the system progresses), but any single goroutine can be starved indefinitely.

### Q6. What is the ABA problem?

**Answer.** A value changes from A to B and back to A between a thread's read and its CAS. The CAS succeeds because the values match, but the state of the world has changed underneath. Common when memory is recycled (e.g., from a pool). Solutions: versioned pointers, hazard pointers, epoch-based reclamation. In pure-Go code with GC, ABA on pointer CAS is rare because the GC keeps observed pointers alive.

### Q7. Are Go's atomic operations sequentially consistent?

**Answer.** Yes, since Go 1.19 the memory model formally specifies sequential consistency for all `sync/atomic` operations. All atomics across the program have a single total order consistent with each goroutine's program order. This is the same guarantee as Java's `volatile` and C++'s `memory_order_seq_cst`.

### Q8. What does the typed `atomic.Int64` give you over the legacy `atomic.CompareAndSwapInt64`?

**Answer.** Three things:

1. **Alignment.** The struct includes an `align64` marker forcing 8-byte alignment on 32-bit platforms.
2. **Copy safety.** The struct embeds `noCopy`; `go vet` flags accidental copies.
3. **Ergonomics.** Method calls instead of passing addresses, no `unsafe.Pointer` for pointer types.

### Q9. When should you use `Add` instead of a CAS loop?

**Answer.** Whenever the operation is unconditional and maps to a hardware atomic instruction. `Add(1)` is one instruction; the CAS loop is at least three plus a possible retry. For conditional updates (set-if-greater, increment-if-positive), use CAS.

### Q10. What is "publish-by-pointer"?

**Answer.** Build a complete, immutable struct, then atomically swap a single pointer to it. Readers always see either the old or the new struct, never a half-built one. The pointer-swap is one atomic operation (Store or CompareAndSwap on `atomic.Pointer[T]`), so multiple fields are published as a unit.

---

## Code-Reading Questions

### Q11. What does this code do?

```go
type Once struct {
    done atomic.Bool
}

func (o *Once) Do(f func()) {
    if o.done.CompareAndSwap(false, true) {
        f()
    }
}
```

**Answer.** First-one-wins. The first goroutine to call `Do` finds `done == false`, succeeds the CAS, sets `done = true`, and runs `f`. Subsequent goroutines find `done == true`, fail the CAS, and skip `f`. Note: unlike `sync.Once`, this does *not* make later callers wait for `f` to finish.

### Q12. Spot the bug.

```go
func (s *Stack) Push(v int) {
    n := &Node{value: v, next: s.head.Load()}
    for {
        if s.head.CompareAndSwap(n.next, n) {
            return
        }
    }
}
```

**Answer.** `n.next` is set once before the loop. If the CAS fails (because another goroutine pushed in between), the head has moved, but `n.next` still points to the old head. The next CAS uses the stale `n.next` as the expected value, which can never match the new head. Loop spins forever (or, worse, eventually succeeds with `n.next` pointing somewhere wrong).

Fix: reload `n.next` inside the loop.

```go
for {
    n.next = s.head.Load()
    if s.head.CompareAndSwap(n.next, n) {
        return
    }
}
```

### Q13. What is wrong with this counter?

```go
type Counter struct {
    v atomic.Int64
}

func (c Counter) Inc() { // value receiver
    c.v.Add(1)
}
```

**Answer.** Value receiver. `c` is a copy. `c.v.Add(1)` modifies the copy and discards it. The caller's `Counter` is unchanged. `go vet` flags this because `atomic.Int64` has `noCopy`. Fix: pointer receiver `func (c *Counter) Inc()`.

### Q14. Trace this code: what does G2 print?

```go
var data int
var ready atomic.Bool

// G1
data = 42
ready.Store(true)

// G2 runs after G1
if ready.Load() {
    fmt.Println(data)
}
```

**Answer.** `42`. The atomic Store has release semantics; the atomic Load has acquire semantics. G1's non-atomic write to `data` happens-before G1's atomic Store; G1's Store synchronised-before G2's Load (which observes true); G2's Load happens-before G2's print. Transitively, G2 sees G1's write.

### Q15. Why doesn't this work for "atomically update a and b"?

```go
a.CompareAndSwap(oldA, newA)
b.CompareAndSwap(oldB, newB)
```

**Answer.** The two CASes are individually atomic but not jointly atomic. Between them, another goroutine can observe (a updated, b not yet). To atomically update two fields, package them into a struct and CAS a single pointer to the struct.

---

## Design Questions

### Q16. Design a lock-free counter that scales to many cores.

**Answer.** Sharded counter: an array of per-shard counters, each on its own cache line. Writers pick a shard (by hashing goroutine ID or pinning to processor) and increment their shard. Readers sum across all shards. The per-shard contention is low because few writers hit each shard. The cache-line padding prevents false sharing between shards.

```go
type ShardedCounter struct {
    shards [16]struct {
        v atomic.Int64
        _ [56]byte // pad to 64 bytes
    }
}
```

Trade-off: O(shards) read cost. For mostly-write workloads (metrics counters), this is the right choice.

### Q17. How would you implement a lock-free reference counter that supports both `Acquire` (increment from non-zero) and `Release` (decrement, free on zero)?

**Answer.**

```go
type RC struct {
    count atomic.Int32
    data  *Resource
}

func (r *RC) Acquire() bool {
    for {
        c := r.count.Load()
        if c == 0 {
            return false
        }
        if r.count.CompareAndSwap(c, c+1) {
            return true
        }
    }
}

func (r *RC) Release() {
    if r.count.Add(-1) == 0 {
        r.data.Close()
    }
}
```

`Acquire` uses CAS because the increment is conditional ("only if not zero"). `Release` uses `Add` because the decrement is unconditional. The check on zero closes the resource exactly once.

Key invariant: never call `Acquire` and let it return `true` after the count has reached zero. The CAS provides this — if count hits zero during the load-and-CAS, the CAS fails and the loop re-reads.

### Q18. Design a `sync.Once`-like primitive that also makes late callers wait for `f` to finish.

**Answer.** CAS picks the winner; a channel signals completion.

```go
type Once struct {
    state atomic.Int32 // 0=unstarted, 1=running, 2=done
    done  chan struct{}
}

func NewOnce() *Once {
    return &Once{done: make(chan struct{})}
}

func (o *Once) Do(f func()) {
    if o.state.CompareAndSwap(0, 1) {
        f()
        o.state.Store(2)
        close(o.done)
        return
    }
    <-o.done
}
```

The CAS chooses the runner. Others block on the channel. The `close(o.done)` after `f` releases waiters.

### Q19. When would you choose a mutex over CAS for a hot counter?

**Answer.** When:

- The critical section is long enough that the spinning cost of CAS-retries dominates the mutex's parking overhead.
- The update is not single-word (e.g., must atomically update multiple fields).
- The workload is so heavily contended that mutex's FIFO fairness prevents goroutine starvation that CAS would allow.

For a simple counter with light-to-moderate contention, CAS or `Add` wins.

### Q20. How does `sync.Mutex` use CAS internally?

**Answer.** The Mutex state word packs (locked bit, woken bit, starving bit, waiter count). The fast path of `Lock` is `CompareAndSwap(0, locked)`. If it succeeds, the goroutine has the lock without any kernel interaction. If it fails, the slow path increments the waiter count via CAS and parks on a runtime semaphore. `Unlock` clears the locked bit and wakes a waiter if needed. CAS is the foundation of the entire fast path.

---

## Performance Questions

### Q21. Approximately how long does an uncontended CAS take on modern x86?

**Answer.** 5-15 nanoseconds. The instruction itself (`LOCK CMPXCHG`) is ~10-20 cycles. At 3-4 GHz, that is 3-7 ns. With function-call overhead and the load it replaces, you measure 5-15 ns.

### Q22. What dominates CAS cost under heavy contention?

**Answer.** Cache-line bouncing. Every CAS on a contended line requires exclusive ownership in MESI; transferring the line between cores costs 30-100 cycles each time. With N cores all CASing, the line ping-pongs and per-CAS cost can rise to hundreds of nanoseconds.

### Q23. What is false sharing?

**Answer.** Two independent variables that share a cache line. Even though each thread writes a different variable, both incur cache-line transfers because the coherence protocol operates at line granularity, not variable granularity. Fix: pad to cache-line boundaries (typically 64 bytes).

### Q24. How would you detect contention on a CAS-based hot path?

**Answer.** Add a retry counter and log/measure it:

```go
type Counter struct {
    v       atomic.Int64
    retries atomic.Int64
}

func (c *Counter) Inc() {
    for {
        old := c.v.Load()
        if c.v.CompareAndSwap(old, old+1) {
            return
        }
        c.retries.Add(1)
    }
}
```

If `retries / value > 1.0`, contention is high enough to consider sharding. Combine with CPU profiling: a high CPU time on the CAS function with low throughput is the smoking gun.

### Q25. Why is mutex sometimes faster than CAS-loop under heavy contention?

**Answer.** Mutex parks goroutines that cannot acquire. While parked, they consume no CPU. CAS spinners pump the bus indefinitely. With many CAS spinners, the cache-coherence traffic alone reduces throughput. Mutex's parking puts most waiters to sleep, leaving only one CPU contending at a time.

### Q26. What is the typical throughput ceiling for a single contended atomic variable on 8 cores?

**Answer.** Roughly 50-100M operations per second total across all cores. The limit is cache-coherence traffic. Per-core throughput drops to ~10M ops/s. To exceed this, shard the state.

---

## Hardware-Level Questions

### Q27. What is the x86 instruction for CAS?

**Answer.** `CMPXCHG` (compare-and-exchange). With the `LOCK` prefix (`LOCK CMPXCHG`), it is atomic across CPUs. The implicit comparison register is RAX (RAX = old). The source register is the new value. The destination is a memory operand.

### Q28. What is LL/SC?

**Answer.** Load-Linked / Store-Conditional. A two-instruction atomic primitive used on ARM (pre-v8.1), POWER, MIPS, and others. The CPU "arms" an exclusive monitor on the cache line at LL. The SC succeeds only if the monitor is still armed (no other CPU wrote). The pair is wrapped in a retry loop to handle spurious monitor clears (context switches, evictions). Equivalent in expressiveness to CAS.

### Q29. Why does ARMv8.1 have a dedicated CAS instruction?

**Answer.** LL/SC's retry overhead and spurious-failure handling add complexity and cycles. The Large System Extension (LSE) in ARMv8.1 adds `CAS`, `LDADD`, `SWP`, `LDSET`, and others as single-instruction atomics. They use cache coherence directly without the exclusive monitor. Result: simpler implementation, similar performance to x86.

### Q30. What is the MESI protocol?

**Answer.** A cache coherence protocol where each cache line in each cache is in one of four states: Modified (only-copy, memory stale), Exclusive (only-copy, memory current), Shared (multiple-copies, memory current), or Invalid (stale). When a CPU writes a line, it must get it into Modified state, sending invalidation messages to other caches. CAS requires Modified state for the duration of the operation.

### Q31. What is the cost of a CAS on a line shared by multiple cores?

**Answer.** The CPU must invalidate other caches' copies (sending invalidation messages on the coherence interconnect) and pull the line into its own cache in Modified state. Typically 30-100 cycles for L1-to-L1 transfer, 100-300 cycles for cross-socket. Each contended CAS pays this cost.

### Q32. Do Go's atomics emit memory barriers on ARM?

**Answer.** Yes. On ARM64, atomic loads use `LDAR` (load-acquire), stores use `STLR` (store-release), and CAS uses `LDAXR`/`STLXR` (load-acquire-exclusive / store-release-exclusive). These provide the acquire/release semantics needed for sequential consistency. The compiler may also emit `DMB ISH` (data memory barrier, inner shareable) when stronger ordering is needed.

---

## Bug-Spotting Questions

### Q33. Find the bug.

```go
type Stack struct {
    head *Node
}

func (s *Stack) Push(v int) {
    n := &Node{value: v}
    for {
        n.next = s.head
        if atomic.CompareAndSwapPointer(
            (*unsafe.Pointer)(unsafe.Pointer(&s.head)),
            unsafe.Pointer(n.next),
            unsafe.Pointer(n)) {
            return
        }
    }
}
```

**Answer.** The read of `s.head` (in `n.next = s.head`) is non-atomic. Concurrent writes to `s.head` from other goroutines' CAS calls race with this read. The race detector flags it. Fix: use `atomic.LoadPointer` for the read, or — far better — switch to `atomic.Pointer[Node]`.

### Q34. Find the bug.

```go
const maxRetries = 100

func update(state *atomic.Int64) error {
    for i := 0; i < maxRetries; i++ {
        old := state.Load()
        new := old + 1
        if state.CompareAndSwap(old, new) {
            return nil
        }
    }
    return errors.New("contention")
}
```

**Answer.** Subtle. Under genuine contention, 100 retries may not be enough. Under no contention, 100 is wildly excessive. The hard bug: returning an error on CAS retries exhaust can be misleading — the operation simply did not happen, even though no genuine failure occurred. Bounded retries are useful for guarding against truly pathological contention, but the error path should make the semantics clear ("retry later" vs "operation aborted").

### Q35. Find the bug.

```go
type Lazy struct {
    v atomic.Pointer[Resource]
}

func (l *Lazy) Get() *Resource {
    if l.v.Load() == nil {
        l.v.Store(buildResource())
    }
    return l.v.Load()
}
```

**Answer.** Race. Two goroutines can both see `nil` and both call `buildResource`, both Store. One wins; the other's resource is leaked (and may have side effects — file opens, sockets). Fix: use CAS.

```go
func (l *Lazy) Get() *Resource {
    if v := l.v.Load(); v != nil {
        return v
    }
    candidate := buildResource()
    if l.v.CompareAndSwap(nil, candidate) {
        return candidate
    }
    candidate.Close() // or whatever cleanup
    return l.v.Load()
}
```

The CAS guarantees exactly one published resource. The loser cleans up its candidate.

### Q36. Find the bug.

```go
type Max struct { v atomic.Int64 }

func (m *Max) Observe(x int64) {
    old := m.v.Load()
    if x > old {
        m.v.Store(x)
    }
}
```

**Answer.** Race between the Load and the Store. Two goroutines reading `old == 5`, with values 7 and 10, both pass the check and Store. If the 10-store lands first and the 7-store second, the max is 7 — wrong. Fix: CAS loop.

```go
for {
    old := m.v.Load()
    if x <= old { return }
    if m.v.CompareAndSwap(old, x) { return }
}
```

---

## System-Design Vignettes

### Q37. You are designing a metrics aggregation system. Counters are incremented 10M times/sec from 64 goroutines. Reads happen once per second. What is your design?

**Answer.** Sharded counters. One counter per processor (or per goroutine bucket). Each increment hits its shard with `atomic.Int64.Add(1)` — single instruction, low contention because few writers per shard. The once-per-second read sums all shards.

Cache-line padding between shards to prevent false sharing. Number of shards = `runtime.GOMAXPROCS()` or `runtime.NumCPU()`. The Go `sync.Pool` uses this pattern with per-P shards.

If the metric must be globally monotonic (sequence number), sharding does not work — you need a single atomic and accept the contention, or batch (each goroutine allocates a range of 1000 IDs at a time).

### Q38. You have a configuration object that is read on every request (10k req/sec) and updated once per minute. Design the publication mechanism.

**Answer.** `atomic.Pointer[Config]`. Readers `Load` the pointer (one cache load, no synchronisation overhead beyond the load itself). Updaters build a new immutable Config and `Store` (or `CompareAndSwap` if computing from old) the pointer.

```go
var current atomic.Pointer[Config]

func ReadConfig() *Config { return current.Load() }
func UpdateConfig(c *Config) { current.Store(c) }
```

The old Config is garbage-collected once all readers finish. No locks. Reads are wait-free.

### Q39. A queue is shared between one producer and many consumers. The producer is slow (10/sec), consumers are fast (each can process 1000/sec). Mutex, CAS, or channel?

**Answer.** Channel. Buffered if you want to absorb bursts, unbuffered if you want strict producer-consumer synchronisation. With 10/sec production and consumers fanning out, contention is low — any choice works correctness-wise, but channel is the idiomatic Go answer.

CAS-based queue (Michael-Scott) is overkill for this rate. Mutex-based queue is fine but more verbose than a channel.

### Q40. A high-frequency trading system needs guaranteed worst-case latency under 10µs per operation. Your team proposes a CAS-based lock-free queue. Sign off or push back?

**Answer.** Push back unless wait-free is on the table. CAS loops are lock-free, not wait-free; an individual operation has no upper-bounded latency under contention. For guaranteed worst-case latency you need:

- A wait-free queue (Kogan-Petrank, complex).
- Single-producer/single-consumer queue with no CAS (just atomic loads/stores).
- Hardware support that fits your latency budget (verify with measurements).

Also: 10µs is a budget that should accommodate occasional cache misses and scheduling jitter. Profile under realistic load before approving any design.

---

## Whiteboard Coding Prompts

### W1. Write a lock-free Treiber stack.

**Solution.**

```go
package stack

import "sync/atomic"

type node[T any] struct {
    value T
    next  *node[T]
}

type Stack[T any] struct {
    head atomic.Pointer[node[T]]
}

func (s *Stack[T]) Push(v T) {
    n := &node[T]{value: v}
    for {
        n.next = s.head.Load()
        if s.head.CompareAndSwap(n.next, n) {
            return
        }
    }
}

func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    for {
        top := s.head.Load()
        if top == nil {
            return zero, false
        }
        if s.head.CompareAndSwap(top, top.next) {
            return top.value, true
        }
    }
}
```

Talk through: why `n.next` is reloaded inside the loop, why pop's empty check is before the CAS, what the linearisation points are, why ABA does not bite in pure Go.

### W2. Implement `sync.Once` using only CAS and channels.

**Solution.**

```go
type Once struct {
    state atomic.Int32 // 0=idle, 1=running, 2=done
    done  chan struct{}
}

func NewOnce() *Once {
    return &Once{done: make(chan struct{})}
}

func (o *Once) Do(f func()) {
    if o.state.CompareAndSwap(0, 1) {
        defer func() {
            o.state.Store(2)
            close(o.done)
        }()
        f()
        return
    }
    <-o.done
}
```

Discuss: CAS picks the winner; the channel close releases waiters; the state field is just for debuggability (callers do not need it, but it documents the lifecycle).

### W3. Implement a "set-if-greater" with CAS.

**Solution.**

```go
type Max struct{ v atomic.Int64 }

func (m *Max) Observe(x int64) {
    for {
        old := m.v.Load()
        if x <= old {
            return
        }
        if m.v.CompareAndSwap(old, x) {
            return
        }
    }
}

func (m *Max) Value() int64 { return m.v.Load() }
```

Discuss: why early-return on `x <= old` (avoid unnecessary CAS), why CAS not Add (conditional), the linearisation point.

### W4. Atomically swap two unrelated integers.

**Solution.** You cannot, with one CAS. Either:

1. Pack both into a single 64-bit word (each gets 32 bits) and CAS the word.
2. Wrap both in a pointer-to-struct and CAS the pointer.
3. Use a mutex.

Show the pointer-to-struct version:

```go
type Pair struct {
    a, b int32
}

type Swappable struct {
    p atomic.Pointer[Pair]
}

func (s *Swappable) Swap() {
    for {
        old := s.p.Load()
        np := &Pair{a: old.b, b: old.a}
        if s.p.CompareAndSwap(old, np) {
            return
        }
    }
}
```

Discuss: allocation cost, GC pressure, when this is preferable to mutex.

### W5. Build a reference-counted pointer.

**Solution.** See Q17. Key points: `Acquire` uses CAS (conditional on non-zero); `Release` uses `Add` (unconditional decrement). Discuss the 0-to-1 race and why CAS closes it.

### W6. Implement an `Atomic[T]` generic wrapper for arbitrary types.

**Solution.**

```go
type Atomic[T any] struct {
    v atomic.Pointer[T]
}

func (a *Atomic[T]) Load() *T { return a.v.Load() }

func (a *Atomic[T]) Store(v *T) { a.v.Store(v) }

func (a *Atomic[T]) CompareAndSwap(old, new *T) bool {
    return a.v.CompareAndSwap(old, new)
}

func (a *Atomic[T]) Update(fn func(*T) *T) {
    for {
        old := a.v.Load()
        new := fn(old)
        if a.v.CompareAndSwap(old, new) {
            return
        }
    }
}
```

Discuss: this is `atomic.Pointer[T]` plus an `Update` convenience; immutability of `T` is the caller's responsibility; allocation per update is the trade-off.

---

End of interview file. For the underlying material, see `junior.md` through `professional.md` in this directory.

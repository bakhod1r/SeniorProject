# Compare-and-Swap (CAS) Algorithms — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Progress Conditions: Lock-Free, Wait-Free, Obstruction-Free](#progress-conditions)
3. [Building Higher-Level Primitives on CAS](#building-higher-level-primitives-on-cas)
4. [CAS-Based Reader-Writer Lock](#cas-based-reader-writer-lock)
5. [CAS-Based Semaphore](#cas-based-semaphore)
6. [Optimistic Concurrency Control](#optimistic-concurrency-control)
7. [CAS vs Mutex: A Disciplined Comparison](#cas-vs-mutex-a-disciplined-comparison)
8. [Lock-Free Algorithm Design Trade-Offs](#lock-free-algorithm-design-trade-offs)
9. [Memory Reclamation Strategies](#memory-reclamation-strategies)
10. [Helping and Cooperation](#helping-and-cooperation)
11. [The DCAS Wish and the Lack Thereof](#the-dcas-wish-and-the-lack-thereof)
12. [Patterns from Production Code](#patterns-from-production-code)
13. [Debugging Lock-Free Code](#debugging-lock-free-code)
14. [Summary](#summary)
15. [Further Reading](#further-reading)

---

## Introduction

At the senior level, CAS is no longer a primitive to be used — it is a primitive to be *evaluated*. You compare CAS-based designs against mutex-based designs, channel-based designs, sharded designs. You understand why a lock-free queue can be slower than a mutex-protected queue in practice, even though it is theoretically more scalable. You know what wait-free means and why nobody builds wait-free code in Go outside of textbook exercises.

The depth shift: from "I can write a CAS loop" to "I can justify or reject a CAS-based design." This file covers the design space, the trade-offs, and the patterns that real Go services use.

---

## Progress Conditions

Progress conditions classify concurrent algorithms by the worst-case progress guarantee they offer.

### Wait-free

**Definition:** Every thread completes its operation in a bounded number of its own steps, regardless of the actions of other threads.

This is the strongest guarantee. No thread can be starved. It is used in real-time and safety-critical systems where worst-case latency matters more than average throughput.

Wait-free algorithms exist (Herlihy's universal construction; Kogan and Petrank's wait-free queue) but are typically slower than lock-free alternatives. The cost is bookkeeping: every operation must help all pending operations make progress.

In Go, wait-free algorithms are rare. The runtime itself does not need them; user code almost never needs them.

### Lock-free

**Definition:** At every point in time, *at least one* thread is making progress. The system as a whole does not stall, but individual threads can be repeatedly thwarted.

This is the standard guarantee for CAS-based algorithms. The Treiber stack is lock-free: at every CAS contention, exactly one CAS succeeds, so global progress continues. But the same goroutine can lose every CAS forever in theory.

### Obstruction-free

**Definition:** A thread completes its operation in a bounded number of steps *if it runs in isolation* (other threads suspended).

This is the weakest non-blocking guarantee. Algorithms can livelock when threads interfere. STM (software transactional memory) implementations often start obstruction-free and add contention managers to upgrade to lock-free.

### Blocking

**Definition:** A thread can be delayed indefinitely by another thread (typically by holding a lock).

Mutex-based algorithms are blocking. If the lock holder is descheduled, every waiter blocks for the duration of the deschedule.

### The hierarchy

```
wait-free  >  lock-free  >  obstruction-free  >  blocking
strongest                                          weakest
```

Stronger guarantees are harder to implement and usually slower under low contention. Lock-free is the sweet spot for most CAS-based code.

### Why Go programs rarely need wait-free

- The Go scheduler is preemptive (Go 1.14+). A goroutine cannot be permanently descheduled.
- Goroutines are cheap; goroutine starvation is unlikely under realistic load.
- Linux's CFS gives fair scheduling to threads, which extends to goroutines via M:N mapping.

For HFT, kernels, and embedded RT systems where these assumptions break, wait-free matters. For typical Go services, lock-free is plenty.

---

## Building Higher-Level Primitives on CAS

CAS is universal: with CAS and unbounded memory you can build any other synchronisation primitive (Herlihy's consensus number proof). In practice you build:

### A spin-lock

```go
type SpinLock struct {
    locked atomic.Int32
}

func (s *SpinLock) Lock() {
    for !s.locked.CompareAndSwap(0, 1) {
        // spin
    }
}

func (s *SpinLock) Unlock() {
    s.locked.Store(0)
}
```

The simplest mutex possible. Useful only when:

- Critical sections are very short (<100 ns).
- Contention is low.
- You can afford to burn CPU rather than block.

For real Go code, `sync.Mutex` is almost always better — it has a spin phase and falls back to OS-level blocking. A naive spinlock peg cores under contention.

### A try-lock

```go
type TryLock struct {
    locked atomic.Int32
}

func (t *TryLock) TryLock() bool {
    return t.locked.CompareAndSwap(0, 1)
}

func (t *TryLock) Unlock() {
    t.locked.Store(0)
}
```

`sync.Mutex.TryLock` was added in Go 1.18; before that, this CAS pattern was how you built one. The advantage of the CAS version is full control over the failure semantics (e.g., return immediately, log, fall back).

### A reentrant lock

CAS alone does not give you reentrancy — the count of holders and the identity of the holder must both be tracked. A reentrant lock typically uses CAS for the holder slot and a separate counter for depth.

Go's `sync.Mutex` is deliberately not reentrant. Reentrancy is a code smell more often than a need. If you find yourself wanting it, consider whether your call graph should be flattened.

### A signal/wait pair

CAS cannot block by itself. To wait, you must combine CAS with the runtime's parking mechanism. `sync.Mutex` does this internally; user code typically uses channels or `sync.Cond`.

```go
type Signal struct {
    fired atomic.Bool
    ch    chan struct{}
}

func NewSignal() *Signal {
    return &Signal{ch: make(chan struct{})}
}

func (s *Signal) Fire() {
    if s.fired.CompareAndSwap(false, true) {
        close(s.ch)
    }
}

func (s *Signal) Wait() {
    <-s.ch
}
```

The CAS guarantees `close(ch)` runs exactly once, even with concurrent `Fire` calls.

---

## CAS-Based Reader-Writer Lock

A simplified reader-writer lock built on CAS:

```go
type RWLock struct {
    state atomic.Int64
}

const writerBit int64 = 1 << 62

func (r *RWLock) RLock() {
    for {
        s := r.state.Load()
        if s&writerBit != 0 {
            continue // writer holds; spin
        }
        if r.state.CompareAndSwap(s, s+1) {
            return
        }
    }
}

func (r *RWLock) RUnlock() {
    r.state.Add(-1)
}

func (r *RWLock) Lock() {
    for {
        if r.state.CompareAndSwap(0, writerBit) {
            return
        }
    }
}

func (r *RWLock) Unlock() {
    r.state.Store(0)
}
```

The state word encodes (reader count, writer flag). Writer acquisition CAS-es from "no readers, no writer" to "writer held." Reader acquisition increments only when the writer flag is clear.

### Issues with this simple version

1. **Writer starvation.** New readers can arrive forever while a writer waits. Production rwlocks use a "pending writer" bit to bias toward writers.
2. **No waiting.** Spinning is fine for very short critical sections; bad otherwise.
3. **No fairness.** No FIFO ordering of waiters.

`sync.RWMutex` solves these via internal channels and waiter queues. Build your own only if you have specific requirements that the standard library does not meet.

---

## CAS-Based Semaphore

A counting semaphore via CAS:

```go
type Semaphore struct {
    count atomic.Int32
}

func NewSemaphore(n int32) *Semaphore {
    s := &Semaphore{}
    s.count.Store(n)
    return s
}

func (s *Semaphore) TryAcquire() bool {
    for {
        c := s.count.Load()
        if c == 0 {
            return false
        }
        if s.count.CompareAndSwap(c, c-1) {
            return true
        }
    }
}

func (s *Semaphore) Release() {
    s.count.Add(1)
}
```

`TryAcquire` is non-blocking. To block until a permit is available, combine with channels — typically the channel itself is the semaphore (`make(chan struct{}, n)`), and CAS is not needed.

The CAS-based semaphore is useful when you need:

- Strict non-blocking semantics (return immediately if empty).
- A counter that can be read without modifying.
- Integration with other CAS-based state.

For the common case, a buffered channel is simpler.

---

## Optimistic Concurrency Control

Optimistic concurrency control (OCC) is the database-pattern equivalent of CAS. You read state, do work, then check at commit time that nothing changed. If it did, retry.

### A versioned record

```go
type Record struct {
    version atomic.Int64
    data    atomic.Pointer[Data]
}

func (r *Record) Update(fn func(*Data) *Data) {
    for {
        oldVersion := r.version.Load()
        oldData := r.data.Load()
        newData := fn(oldData)
        if r.version.CompareAndSwap(oldVersion, oldVersion+1) {
            r.data.Store(newData)
            return
        }
    }
}
```

Wait — there is a bug. Between the CAS on version and the store on data, another goroutine could observe inconsistent state (new version, old data) or (old version, new data). To fix:

```go
type State struct {
    version int64
    data    *Data
}

type Record struct {
    state atomic.Pointer[State]
}

func (r *Record) Update(fn func(*Data) *Data) {
    for {
        old := r.state.Load()
        newState := &State{
            version: old.version + 1,
            data:    fn(old.data),
        }
        if r.state.CompareAndSwap(old, newState) {
            return
        }
    }
}
```

Now version and data are bundled in a single pointer, and the CAS atomically publishes both. This is the **publish-by-pointer** pattern: when you need to update multiple fields atomically, package them into an immutable struct and CAS the pointer.

### Trade-offs

- **Allocation per update.** Each successful update allocates a new State. Under high write load this can dominate.
- **Pointer indirection on read.** Every read loads the pointer, then loads through it. Two cache misses worst case.
- **GC pressure.** Old versions are garbage; the GC collects them eventually. If updates are very frequent, the heap can grow before GC catches up.

Mitigations: pool the State objects (carefully — pooled objects raise the ABA problem); or use a fixed-size circular buffer of versions; or accept the cost.

---

## CAS vs Mutex: A Disciplined Comparison

A common claim: "CAS is faster than mutex." Sometimes true, sometimes very false. The honest comparison:

### Uncontended

- Mutex Lock+Unlock: ~25 ns on modern x86.
- CAS-loop (success first try): ~10 ns.

CAS wins by 2-3x. Both are fast enough that for most code, the difference is invisible.

### Lightly contended (2-4 cores fighting)

- Mutex: ~50-100 ns, the kernel may still not block.
- CAS-loop: ~30-100 ns, 1-3 retries.

Roughly comparable. CAS still has an edge.

### Heavily contended (16+ cores fighting)

- Mutex: ~200-1000 ns. Once the kernel parks, cost rises sharply.
- CAS-loop: ~100-500 ns. Retries multiply with contention.

Both bad. CAS has higher throughput because it never blocks; but individual operations can take longer than under mutex because retries are unbounded. In the worst case, CAS livelocks while mutex provides FIFO ordering.

### Mutex has goroutine-friendly waiting

`sync.Mutex` puts a waiting goroutine to sleep via the runtime. While it waits, the goroutine consumes no CPU. A spinning CAS loop pegs a core.

For workloads where the critical section is sometimes long (e.g., a write that occasionally flushes to disk), mutex is strictly better — CAS would spin the entire flush.

### Mutex is FIFO-fair (mostly)

`sync.Mutex` in starvation mode (Go 1.9+) gives waiting goroutines FIFO order after they have waited >1ms. CAS has no such fairness — pure luck-of-the-CAS.

### CAS supports try-without-block naturally

CAS returns immediately. Mutex requires `TryLock` (Go 1.18+) for the same behaviour, and even then has subtly different semantics.

### Summary table

| Property | CAS-loop | Mutex |
|---|---|---|
| Uncontended cost | Lowest (~10 ns) | Low (~25 ns) |
| Contended cost | Variable, can be high | Predictable, can block |
| Worst-case latency | Unbounded (livelock) | Bounded (FIFO under starvation) |
| Fairness | None | FIFO after 1ms wait |
| Blocking semantics | None | Goroutine parking |
| Composability | Single word only | Arbitrary critical section |
| Deadlock possible | No | Yes |
| Livelock possible | Yes | No |
| Suitable for long critical sections | No | Yes |
| Suitable for kernel/RT code | Yes (lock-free) | No |

---

## Lock-Free Algorithm Design Trade-Offs

Designing a lock-free algorithm involves several dimensions of choice.

### 1. Progress condition

Wait-free, lock-free, or obstruction-free? In Go: lock-free is the practical sweet spot.

### 2. Memory layout

Cache-line packing matters. False sharing destroys performance. Pad hot atomic fields to 64 bytes:

```go
type Counter struct {
    v atomic.Int64
    _ [56]byte // pad to cache line
}
```

### 3. Linearisability vs sequential consistency

- **Linearisability:** Each operation appears to take effect at a single instant; the resulting history is sequentially valid.
- **Sequential consistency:** Operations appear in some sequential order consistent with each thread's program order; the order does not need to match real time.

Linearisability is stronger. CAS-based algorithms are typically linearisable. Some weaker schemes (e.g., RCU) provide sequential consistency without linearisability and gain performance.

### 4. Read-mostly vs write-mostly

- Read-mostly: optimise readers; `atomic.Pointer` to immutable snapshot is ideal.
- Write-mostly: optimise writers; sharding, batching, or per-thread state.

### 5. Memory reclamation

The hardest problem in lock-free programming. See next section.

### 6. Helping vs solo progress

Wait-free algorithms typically require operations to help each other. This bookkeeping adds cost. Lock-free algorithms are usually solo: each thread does its own work; no helping.

### 7. ABA protection

If the same logical value can appear twice in the same CAS slot (typical for pooled or recycled memory), you need ABA protection: versioned pointers, hazard pointers, or epoch-based reclamation. See `02-aba-problem`.

---

## Memory Reclamation Strategies

In a managed language like Go, the GC handles reclamation. In unmanaged languages (C++, Rust), and in Go with manual pools, you must answer: *when is it safe to free a node that was just removed from a lock-free structure?*

The danger: another thread may still hold a pointer to the node from a prior Load. If you free immediately, you create a use-after-free.

### Strategies

1. **Garbage collection.** Free. The GC tracks reachable pointers; an "in-flight" pointer in a goroutine's register or stack pins the object. Go gives this for free.

2. **Hazard pointers.** Each thread publishes the pointers it is currently using. A reclaimer scans all hazard pointers before freeing. Maged Michael's classic technique (2004). Costs a hazard-pointer table check per access.

3. **Epoch-based reclamation (EBR).** Threads enter and exit epochs. A node freed in epoch N can be reclaimed once all threads have advanced past epoch N. Lower per-access cost than hazard pointers but higher memory usage (deferred frees pile up).

4. **Read-copy-update (RCU).** Reader threads do not synchronise; writers wait for a grace period before reclaiming. Linux kernel staple. Implementations exist for Go (`github.com/dgraph-io/ristretto` has one) but the standard library does not.

5. **Reference counting.** Each pointer carries a count; nodes are freed at count 0. Atomic refcount updates are the cost.

### Go's situation

Pure-Go lock-free code with GC: no manual reclamation needed. The GC pins live pointers. The price: each node lives until GC, raising memory pressure.

CGo / unsafe / off-heap memory: you are responsible. Use one of the above strategies.

For most Go code, the implicit GC strategy is fine. If you find yourself optimising past that, you have a research problem on your hands.

---

## Helping and Cooperation

In wait-free and some lock-free algorithms, threads help each other. The pattern:

```go
// thread that fails its CAS notices that someone else is partially through an op
// and finishes that op for them, then retries its own.
```

The Michael-Scott queue has helping built in: if you read a tail that has a non-nil next, you help advance the tail pointer (CAS tail forward) before retrying your enqueue. This prevents a slow producer from blocking the queue.

### Example: Michael-Scott helping pattern

```go
tail := q.tail.Load()
next := tail.next.Load()
if next != nil {
    // someone enqueued but didn't advance tail; help them
    q.tail.CompareAndSwap(tail, next)
    continue
}
```

The helping CAS may fail (tail already advanced) — that is fine; the help was harmless and idempotent.

### Trade-offs of helping

- **Plus:** Robustness against slow threads. No thread blocks waiting for another.
- **Plus:** Provides part of the wait-free guarantee for some operations.
- **Minus:** More CAS operations per logical operation. More cache-line traffic.
- **Minus:** Harder to reason about. The helping logic must be correct or you double-free or skip work.

Use helping when you have a real scenario where one thread can leave a structure in a partial state and other threads must not block. The Michael-Scott queue is the canonical example.

---

## The DCAS Wish and the Lack Thereof

DCAS (double-word compare-and-swap) atomically updates two unrelated memory locations. It would make many lock-free algorithms simpler. But mainstream CPUs do not have it. x86 has CMPXCHG8B / CMPXCHG16B, which atomically updates 8 or 16 *contiguous* bytes — a single double-width word, not two unrelated words.

The workarounds:

### 1. Pack into one word

If you need to update two 32-bit values atomically, pack them into a 64-bit word and CAS that. Common for (head, count) pointer-and-tag combos.

### 2. CAS on a pointer to a struct

Pack both values into a struct, allocate, CAS the pointer. The allocation cost is the trade-off.

### 3. Software transactional memory (STM)

A library layer that lets you write transactional code; the STM handles atomicity. Performance overhead is significant. Rust has `triomphe`; Go has no widely-used STM library.

### 4. Mutex

Just use a mutex. For "atomically update two unrelated things," a mutex is usually the right answer.

The lack of DCAS is the single biggest constraint on lock-free algorithm design. Many published lock-free algorithms originally assumed DCAS and had to be rewritten when researchers realised real hardware does not provide it.

---

## Patterns from Production Code

### Pattern 1: Atomic config swap

```go
type Config struct {
    /* immutable fields */
}

var current atomic.Pointer[Config]

func ReadConfig() *Config { return current.Load() }

func UpdateConfig(newCfg *Config) {
    current.Store(newCfg)
}
```

Hot readers, cold writers. Writers build a complete Config off-side and publish in one atomic Store. Readers always see a fully-built config.

For "compute new from old" updates, switch the Store to a CAS loop.

### Pattern 2: Lazy initialisation

```go
type Lazy[T any] struct {
    val  atomic.Pointer[T]
    init func() *T
}

func (l *Lazy[T]) Get() *T {
    if v := l.val.Load(); v != nil {
        return v
    }
    candidate := l.init()
    if l.val.CompareAndSwap(nil, candidate) {
        return candidate
    }
    return l.val.Load()
}
```

The first goroutine to CAS-win publishes the value. Losers see the winner's value via the second Load. The init function may be called multiple times under contention; if that is a problem use `sync.Once`.

### Pattern 3: Sequence number / generation

```go
type SeqNo struct {
    n atomic.Uint64
}

func (s *SeqNo) Next() uint64 {
    return s.n.Add(1)
}
```

Each call returns a unique monotonic number. `Add(1)` is the right tool; no CAS loop needed.

If you need to skip reserved numbers, CAS loop:

```go
func (s *SeqNo) Next() uint64 {
    for {
        n := s.n.Load()
        m := n + 1
        for isReserved(m) { m++ }
        if s.n.CompareAndSwap(n, m) {
            return m
        }
    }
}
```

### Pattern 4: Multi-state finite state machine

```go
type FSM struct {
    state atomic.Int32
}

const (
    Idle    = 0
    Running = 1
    Done    = 2
    Failed  = 3
)

func (f *FSM) Run() error {
    if !f.state.CompareAndSwap(Idle, Running) {
        return errors.New("not idle")
    }
    defer func() {
        if r := recover(); r != nil {
            f.state.Store(Failed)
            panic(r)
        }
    }()
    // do work
    f.state.Store(Done)
    return nil
}
```

CAS guards the Idle → Running transition. Only one goroutine can enter Running; the rest see "not idle" and return.

### Pattern 5: Watermark / max tracking

```go
type Max struct {
    v atomic.Int64
}

func (m *Max) Observe(x int64) {
    for {
        old := m.v.Load()
        if x <= old { return }
        if m.v.CompareAndSwap(old, x) { return }
    }
}
```

See junior.md Example 4. Common for measuring peak latency, peak queue depth, peak concurrent connections.

---

## Debugging Lock-Free Code

### Use the race detector

`go test -race` catches mixed atomic/non-atomic access. Run all CAS-using tests under it.

### Reproduce with high contention

```go
func TestUnderStress(t *testing.T) {
    runtime.GOMAXPROCS(runtime.NumCPU())
    for trial := 0; trial < 1000; trial++ {
        // run the operation
    }
}
```

Bugs that need a specific interleaving may not surface in one run. Repeat thousands of times.

### Add invariant assertions

```go
func (s *Stack) Push(v int) {
    n := &Node{value: v}
    for {
        n.next = s.head.Load()
        if s.head.CompareAndSwap(n.next, n) {
            return
        }
    }
}

func (s *Stack) checkInvariant() {
    var seen = map[*Node]bool{}
    for n := s.head.Load(); n != nil; n = n.next {
        if seen[n] {
            panic("cycle in stack")
        }
        seen[n] = true
    }
}
```

Call `checkInvariant` between operations during testing.

### Log retries

A retry-counter on a CAS loop tells you whether you have a contention problem masked as a performance problem.

### Use a linearisability checker

[Porcupine](https://github.com/anishathalye/porcupine) for Go can verify recorded histories against a model.

### Reduce, then reproduce

When a bug appears under heavy load, reduce the algorithm to its essence:

```go
// minimum reproducible case for the bug
```

Often, a 10-line example shows the same bug that a 1000-line system has.

---

## Summary

At the senior level, CAS is one tool in a toolkit, and you choose it based on workload characteristics and progress requirements:

- For unconditional simple updates: `Add` / `Or` / `And`.
- For conditional single-word updates: CAS loop.
- For multi-field atomicity: publish-by-pointer (CAS on `atomic.Pointer`).
- For long critical sections: mutex.
- For high contention with simple work: shard the state, not the synchronisation.

You can reason about progress conditions (wait-free, lock-free, obstruction-free, blocking) and choose deliberately. You know the cost of helping, the trade-offs of memory reclamation, and why DCAS would be nice but does not exist.

The professional level adds: hardware-level details (LOCK CMPXCHG, ARMv8 CAS, LL/SC), the runtime source, cache-line behaviour at the assembly level.

---

## Further Reading

- Maurice Herlihy, "Wait-Free Synchronization," ACM TOPLAS 13(1):124-149, 1991. The consensus number proof and universal construction.
- Maged M. Michael, "Hazard Pointers: Safe Memory Reclamation for Lock-Free Objects," IEEE TPDS 15(6):491-504, 2004.
- Keir Fraser, "Practical Lock-Freedom," PhD thesis, Cambridge, 2004. Comprehensive coverage including EBR.
- Alex Kogan and Erez Petrank, "Wait-Free Queues with Multiple Enqueuers and Dequeuers," PPoPP '11.
- Paul E. McKenney et al., "RCU Usage In the Linux Kernel: One Decade Later," 2013.
- Maurice Herlihy and Nir Shavit, *The Art of Multiprocessor Programming*, 2nd ed., 2020. Chapters 5-12.
- Russ Cox, "Hardware Memory Models," <https://research.swtch.com/hwmm>.
- Dmitry Vyukov's blog: <https://www.1024cores.net/>. Practical lock-free design notes.
- The Go runtime: `src/runtime/proc.go`, `src/runtime/lock_sema.go`. How the runtime itself uses CAS.

# Compare-and-Swap (CAS) Algorithms — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Correctness Proof of the CAS Loop](#correctness-proof-of-the-cas-loop)
3. [The Treiber Stack in Depth](#the-treiber-stack-in-depth)
4. [Lock-Free Queues: An Introduction](#lock-free-queues-an-introduction)
5. [Reference Counting via CAS](#reference-counting-via-cas)
6. [Bit-Flag Sets via CAS](#bit-flag-sets-via-cas)
7. [CAS-Loop Pitfalls Beyond Junior](#cas-loop-pitfalls-beyond-junior)
8. [Spinning vs Backoff](#spinning-vs-backoff)
9. [Contention Profiling](#contention-profiling)
10. [Choosing CAS vs `Add` vs Mutex](#choosing-cas-vs-add-vs-mutex)
11. [Memory Visibility Guarantees](#memory-visibility-guarantees)
12. [Testing CAS Code](#testing-cas-code)
13. [Benchmarks](#benchmarks)
14. [Summary](#summary)
15. [Further Reading](#further-reading)

---

## Introduction

At the junior level you learned what CAS does and how to write the canonical CAS loop. At the middle level you start using CAS as the foundation for real lock-free data structures: a Treiber stack, a reference counter, a bit-flag set. You also learn to think about *contention* as a first-class concern. A CAS loop that works perfectly in isolation can collapse to 1/10th of its peak throughput under realistic multi-core load.

This file builds three things on top of CAS:

1. **Correctness**: why a CAS loop is logically equivalent to a sequential update, and how to prove it for your own algorithms.
2. **Composition**: how to combine multiple CAS operations into larger structures without losing atomicity or correctness.
3. **Behaviour under load**: how the contention profile changes the answer to "should I use CAS here?"

You should have written and tested a CAS-loop counter at the junior level. The examples here assume that vocabulary and move on to pointer-based structures, conditional updates, and the moment a CAS loop crosses the threshold from "elegant" to "scary."

---

## Correctness Proof of the CAS Loop

Suppose you want to atomically apply a pure function `f` to a shared variable `x`. The desired sequential behaviour is:

```
old := x
x = f(old)
```

The CAS loop implements this concurrently:

```go
for {
    old := x.Load()
    new := f(old)
    if x.CompareAndSwap(old, new) {
        return
    }
}
```

### Claim

Every successful CAS commits a value `new = f(old)` where `old` was the value of `x` immediately before the CAS, in the total order of atomic operations.

### Proof sketch

Because Go atomics are sequentially consistent, there is a single global order on all atomic operations on `x`. In that order:

1. Goroutine G performs `Load` at time `t1`, observing value `v`.
2. Some interleaving of other goroutines' atomic ops on `x` happens between `t1` and `t2`.
3. Goroutine G performs `CompareAndSwap(v, f(v))` at time `t2`.

The CAS succeeds **if and only if** no other atomic op on `x` between `t1` and `t2` changed the value. That is the definition of CAS. So when the CAS succeeds, the value of `x` immediately before `t2` was still `v`, and the value immediately after is `f(v)`. From the perspective of the global order, this is exactly the sequential pair `old := x; x = f(old)` — atomically.

When the CAS fails, no write occurred. The loop retries with a fresh load. The retried iteration is an independent attempt; the previous one is as if it never happened.

### What the proof requires

- `f` must be a **pure function** of `old`. If `f` has side effects, they happen on every iteration, including the failed ones.
- `f` must not depend on any other mutable shared state. If it does, the value read in step 1 is stale by step 2 — but the CAS does not check that other state. Your algorithm can silently lose updates to fields outside the CAS target.
- The variable `x` must be accessed only through atomic ops in this analysis. Mixing atomic and non-atomic writes to `x` invalidates the proof (and creates a data race).

### What the proof does not give you

- It does not prove the algorithm is **wait-free**. Any individual goroutine can fail its CAS arbitrarily many times.
- It does not prove the algorithm is **livelock-free**. Pathological scheduling can starve a goroutine, although in practice this is rare with Go's scheduler.
- It does not prove anything about other variables. If your CAS loop also touches `y`, the atomicity guarantee covers `x` but not the `x`-and-`y` pair.

This proof is the formal version of the snapshot-compute-commit mental model from the junior level. Every CAS-based algorithm relies on it.

---

## The Treiber Stack in Depth

The Treiber stack is the simplest non-trivial lock-free data structure: a singly linked list with a head pointer updated via CAS. Junior-level Push and Pop are recapped below; the depth here is what happens around them.

```go
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

### Linearisability

The Treiber stack is **linearisable**: each operation appears to take effect at some single instant between its call and its return, and the resulting sequential history is a valid stack history. The linearisation point of `Push` is the successful CAS. The linearisation point of `Pop` is the successful CAS or the `nil` check (for the empty case).

This is the gold standard for concurrent data-structure correctness. Linearisable means clients can pretend each operation is atomic and ignore concurrency in their proofs.

### Why `n.next` is set inside the loop

```go
// WRONG — n.next set once before the loop
n := &node[T]{value: v, next: s.head.Load()}
for {
    if s.head.CompareAndSwap(n.next, n) {
        return
    }
}
```

If the CAS fails, `s.head` has moved. The next attempt uses the *stale* `n.next` as the expected value, which can never match the new head. The loop spins forever. Always reload `n.next` inside the loop.

### Why the head is `atomic.Pointer[node[T]]`

Go 1.19+ gives you a typed atomic pointer that:

- Preserves the element type — no `unsafe.Pointer` conversions in user code.
- Forces alignment — never a misaligned pointer.
- Carries `noCopy` — the struct cannot be accidentally copied.

The legacy alternative was `atomic.CompareAndSwapPointer(&s.head, unsafe.Pointer(...), unsafe.Pointer(...))` with manual conversions. Modern code should always use the typed form.

### Hidden costs: allocation

Every `Push` allocates a node. With 1M pushes/sec, that is 1M allocations/sec. The Go GC handles this, but the allocation itself is ~25 ns — comparable to the CAS cost. For very hot paths, consider:

- A pool of nodes (with care; pooling reintroduces the ABA problem).
- Pre-allocating a fixed-size array stack instead of a linked list.
- Batching pushes if your producer can buffer.

### The ABA problem in a Treiber stack

A canonical bug: goroutine G1 pops the top (node A pointing to B), is descheduled, and meanwhile G2 pops A, pops B, and pushes A back (now A points to C). G1 resumes; its CAS `head: A -> B` succeeds because the head is once again A. But B is no longer reachable, and your stack is corrupt.

In **pure Go without pooling**, this cannot happen: while G1 holds a pointer to A, the GC keeps A alive, and Go does not reuse memory of live objects. Even if A's `next` field changes, the pointer-identity check in CAS still works because the pointer comparison is on addresses. But — and this is the subtle bit — the *value semantics* of A.next have changed. CAS swapped to A.next which is now `C`, not `B`. The stack is wrong.

Wait. Re-read the previous paragraph. The CAS swaps head to `top.next`. If G1 reads `top.next` as `B` before the deschedule, computes new head = `B`, then CASes. The CAS compares head to A (pointer match: still A), writes B. After the swap, head = B. But meanwhile G2 pushed A with A.next = C. So actually the new head is B, not C. We swapped to a stale `next`.

This is **exactly** the ABA bug. Pure-Go Treiber stack with reused nodes (via pooling) suffers from it. Without pooling, GC pins both A and its old next field's pointed-to node, so the values do not silently change underneath the goroutine.

Cross-reference: full discussion in `02-aba-problem`.

---

## Lock-Free Queues: An Introduction

A queue is harder than a stack because both ends move. The classical lock-free FIFO is the **Michael-Scott queue** (Michael & Scott, 1996). The full algorithm needs two CAS operations per enqueue and uses a sentinel node to avoid empty-queue special cases.

A simplified single-producer/single-consumer (SPSC) version with one CAS per op:

```go
type qnode[T any] struct {
    value T
    next  atomic.Pointer[qnode[T]]
}

type Queue[T any] struct {
    head atomic.Pointer[qnode[T]] // dequeue end
    tail atomic.Pointer[qnode[T]] // enqueue end
}

func NewQueue[T any]() *Queue[T] {
    sentinel := &qnode[T]{}
    q := &Queue[T]{}
    q.head.Store(sentinel)
    q.tail.Store(sentinel)
    return q
}

func (q *Queue[T]) Enqueue(v T) {
    n := &qnode[T]{value: v}
    for {
        tail := q.tail.Load()
        next := tail.next.Load()
        if tail != q.tail.Load() {
            continue // tail moved while we read
        }
        if next != nil {
            // Help advance the tail
            q.tail.CompareAndSwap(tail, next)
            continue
        }
        if tail.next.CompareAndSwap(nil, n) {
            q.tail.CompareAndSwap(tail, n)
            return
        }
    }
}

func (q *Queue[T]) Dequeue() (T, bool) {
    var zero T
    for {
        head := q.head.Load()
        tail := q.tail.Load()
        next := head.next.Load()
        if head != q.head.Load() {
            continue
        }
        if head == tail {
            if next == nil {
                return zero, false
            }
            q.tail.CompareAndSwap(tail, next)
            continue
        }
        v := next.value
        if q.head.CompareAndSwap(head, next) {
            return v, true
        }
    }
}
```

The full multi-producer multi-consumer Michael-Scott queue is more involved. The above is a simplification meant to show the *shape*: two CAS pointers, sentinel node, "help advance" logic to make a slow producer not block the tail.

Important: this is illustrative. For production use the Go standard library does not ship a lock-free queue; if you need one, use `golang.org/x/sync/errgroup`-style batching, a channel, or a third-party library. Treat the Michael-Scott queue as a teaching example and dive into the original paper before shipping it.

---

## Reference Counting via CAS

A shared object with a reference count: each owner increments before using, decrements when done. When the count reaches zero, the object is freed.

```go
type RefCounted struct {
    count atomic.Int32
    data  *Resource
}

func New(r *Resource) *RefCounted {
    rc := &RefCounted{data: r}
    rc.count.Store(1)
    return rc
}

func (rc *RefCounted) Acquire() bool {
    for {
        c := rc.count.Load()
        if c == 0 {
            return false // already freed
        }
        if rc.count.CompareAndSwap(c, c+1) {
            return true
        }
    }
}

func (rc *RefCounted) Release() {
    if rc.count.Add(-1) == 0 {
        rc.data.Close()
    }
}
```

### Why `Acquire` uses CAS and `Release` uses `Add`

`Release` is unconditional: always decrement, then check if zero. `Add` returns the new value atomically, so the check is race-free.

`Acquire` is conditional: increment only if not zero. The "not zero" predicate makes `Add` unsuitable — `Add` would increment from 0 to 1 and resurrect a freed object. CAS lets you check then increment atomically.

### The 0-to-1 race

```go
// BUG — race window between Load and Add
if rc.count.Load() > 0 {
    rc.count.Add(1) // another goroutine may have set count to 0
    use(rc.data)    // resurrected!
}
```

Between the Load and the Add, `Release` can run, hit zero, and free `rc.data`. The Add then resurrects the count, but `rc.data` is already closed. The CAS version closes this window by reading and updating atomically.

### Bias towards lock-free

For 99% of Go programs, `sync.WaitGroup` or `runtime.SetFinalizer` is the right tool. Reference counting via CAS is for when you must interoperate with C-style ownership (e.g., handles to OS resources) or when finalisers are too slow.

---

## Bit-Flag Sets via CAS

A bitfield where each bit represents a flag. Atomic bit-set and bit-clear via CAS:

```go
type Flags struct {
    bits atomic.Uint64
}

func (f *Flags) Set(bit uint) {
    mask := uint64(1) << bit
    for {
        old := f.bits.Load()
        if old&mask != 0 {
            return // already set
        }
        if f.bits.CompareAndSwap(old, old|mask) {
            return
        }
    }
}

func (f *Flags) Clear(bit uint) {
    mask := uint64(1) << bit
    for {
        old := f.bits.Load()
        if old&mask == 0 {
            return // already clear
        }
        if f.bits.CompareAndSwap(old, old&^mask) {
            return
        }
    }
}

func (f *Flags) IsSet(bit uint) bool {
    return f.bits.Load()&(uint64(1)<<bit) != 0
}
```

### Go 1.23's `And` and `Or`

Go 1.23 added `atomic.Uint64.And` and `atomic.Uint64.Or` as single-instruction atomic bitwise operations:

```go
func (f *Flags) Set(bit uint)   { f.bits.Or(uint64(1) << bit) }
func (f *Flags) Clear(bit uint) { f.bits.And(^(uint64(1) << bit)) }
```

These are equivalent to the CAS-loop versions but use a dedicated hardware instruction (`LOCK OR`/`LOCK AND` on x86) and never retry. Prefer them on Go 1.23+.

The CAS-loop versions remain useful for **conditional** bit operations: "set this bit only if that other bit is clear," which `Or` cannot express.

---

## CAS-Loop Pitfalls Beyond Junior

### Pitfall 1: Recomputing `new` from a stale snapshot

```go
// WRONG
for {
    old := state.Load()
    if some_condition_on_old_using_other_state() {
        new := compute(old)
        if state.CompareAndSwap(old, new) {
            return
        }
    }
}
```

If `some_condition_on_old_using_other_state` reads variables outside the CAS, your decision logic uses snapshots from different points in time. A successful CAS commits the result of a stale decision.

The fix: either capture all needed state atomically (one big pointer-swap), or use a coarser synchronisation (mutex).

### Pitfall 2: Two CASes pretending to be atomic

```go
// WRONG — not atomic across the pair
a.CompareAndSwap(oldA, newA)
b.CompareAndSwap(oldB, newB)
```

Between the two CASes, another goroutine can observe the inconsistent intermediate state (a updated, b not). For genuine multi-word atomicity, you need:

- A single pointer to a struct that contains both fields (publish-by-pointer).
- Or a software transactional memory layer (rare in Go).
- Or a mutex (often the simplest choice).

### Pitfall 3: Yielding inside a CAS loop

```go
for {
    old := state.Load()
    if state.CompareAndSwap(old, next(old)) {
        return
    }
    runtime.Gosched() // attempt to be polite
}
```

`Gosched` lets another goroutine run, which is sometimes good (reduce contention) and sometimes bad (in a high-priority path you wanted to finish). Test before adding it. For most CAS loops the retry cost without yield is fine.

### Pitfall 4: Forgetting that `next(old)` may produce the same value

```go
for {
    old := flag.Load()
    new := old // unconditionally same
    if flag.CompareAndSwap(old, new) {
        return
    }
}
```

The CAS technically succeeds (or rather always could). But the loop is doing nothing useful. Diagnose by asking: "what state change is this CAS trying to commit?" If the answer is "none," remove the CAS.

### Pitfall 5: Treating CAS failure as an error

```go
ok := state.CompareAndSwap(old, new)
if !ok {
    log.Error("CAS failed!") // misleading
}
```

CAS failure is expected under contention. It is not an error condition. Log it only at debug level or as a contention metric (e.g., increment a "cas_retries" counter).

---

## Spinning vs Backoff

Under contention, naive spinning burns CPU. Several refinements:

### Pure spin (no yield)

```go
for {
    old := state.Load()
    if state.CompareAndSwap(old, next(old)) {
        return
    }
}
```

Best for very low contention. Each CAS is short; retries are rare. Wastes CPU at high contention.

### `runtime.Gosched`

```go
for {
    old := state.Load()
    if state.CompareAndSwap(old, next(old)) {
        return
    }
    runtime.Gosched()
}
```

Yields the goroutine. The scheduler reschedules someone else. Useful when the goroutine count exceeds GOMAXPROCS — without yielding, the current goroutine can starve siblings on the same OS thread.

### Exponential backoff

```go
delay := time.Nanosecond
for {
    old := state.Load()
    if state.CompareAndSwap(old, next(old)) {
        return
    }
    time.Sleep(delay)
    if delay < time.Microsecond {
        delay *= 2
    }
}
```

Doubles the wait on each failure, capped at some maximum. Reduces hot-spot pressure at the cost of latency for the unlucky goroutine.

In practice, Go's runtime tends to handle scheduling well enough that pure spin or `Gosched`-on-failure is sufficient. Reach for exponential backoff only if you measure throughput collapse under contention.

### `runtime.procyield`

Internally, the Go runtime has a `procyield(n)` function that issues `PAUSE` instructions on x86 (or `YIELD` on ARM). These hint to the CPU that we are in a spin loop and let it save power or release shared execution resources to another hyperthread. User code cannot call `procyield` directly, but if you write a spin loop and care about hyperthreading partners, the same effect can be achieved by:

- Calling `runtime.Gosched`.
- Importing `runtime/internal/atomic` (unsafe and unstable; do not do it).

For production code, trust the standard atomic and mutex primitives.

---

## Contention Profiling

A CAS loop's behaviour changes radically with contention. Profile to see:

```go
type Counter struct {
    v        atomic.Int64
    retries  atomic.Int64
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

func (c *Counter) Stats() (value, retries int64) {
    return c.v.Load(), c.retries.Load()
}
```

A ratio of `retries / value` above 1.0 means more failures than successes — high contention. Time to consider sharding or batching.

### Reducing contention by sharding

Instead of one counter, keep N counters and aggregate on read:

```go
type ShardedCounter struct {
    shards [16]struct {
        v atomic.Int64
        _ [56]byte // pad to cache line
    }
}

func (c *ShardedCounter) Inc() {
    shard := runtime_procPin() % len(c.shards)
    c.shards[shard].v.Add(1)
    runtime_procUnpin()
}

func (c *ShardedCounter) Value() int64 {
    var sum int64
    for i := range c.shards {
        sum += c.shards[i].v.Load()
    }
    return sum
}
```

Writers contend only within their shard (typically one writer per core when pinned). Readers pay an O(shards) sum. The `_ [56]byte` padding prevents two shards from sharing a cache line.

Note: `runtime_procPin` is not exported; this is illustrative. In practice, use the per-P approach from the Go runtime's `sync.Pool` or hash the goroutine ID.

For a fully worked example see `03-sync-package/07-atomic/senior.md` "Sharded counter pattern."

### When sharding hurts

- Small counts of cores (1-2): one cache line, no contention. Sharding adds overhead.
- Write-once read-many workloads: a single cache line is fine for the read side; the sum of shards is more expensive.
- When the order of operations matters: sharding loses ordering. A monotonic ID generator cannot be sharded.

---

## Choosing CAS vs `Add` vs Mutex

| Operation | Best primitive | Why |
|---|---|---|
| Unconditional increment | `atomic.Int64.Add(1)` | One instruction. No retry. |
| Increment if positive | CAS-loop | Conditional. `Add` would underflow guard. |
| Set if greater (max watermark) | CAS-loop | No "atomic max" instruction. |
| Set bit | `atomic.Uint64.Or(mask)` (Go 1.23+) | One instruction. |
| Set bit if other bit clear | CAS-loop | Conditional. |
| Swap two unrelated fields atomically | Mutex (or pointer-swap of a struct) | CAS handles one word. |
| Long critical section (>1µs of work) | Mutex | CAS retries multiply work. Mutex blocks instead. |
| One-shot initialisation | `sync.Once` | Battle-tested, handles waiting. |
| Update head of a lock-free list | CAS on `atomic.Pointer` | The canonical use. |
| Publish a new config | CAS on `atomic.Pointer` to immutable struct | Readers always see complete object. |

### Heuristic: "Is the critical section a single-word update?"

If yes, atomic ops (Add, Or, CAS) win. If no, mutex.

### Heuristic: "Is the operation conditional?"

If conditional in a way that maps to `Add`/`Or`/`And`: use those.
If conditional in a way that requires arbitrary logic: CAS.
If conditional and involves multiple fields: mutex.

---

## Memory Visibility Guarantees

Every Go atomic op is sequentially consistent. For CAS specifically:

- A successful CAS acts as **both an acquire and a release**: all writes before the CAS in program order are visible to a thread that subsequently observes the CAS result via an atomic load.
- A failed CAS also synchronises: it still reads the current value atomically, and that read participates in the happens-before order.

```go
var data int
var ready atomic.Bool

// goroutine A
data = 42
ready.Store(true)

// goroutine B
if ready.Load() {
    use(data) // guaranteed to see 42
}
```

The `Store` is a release; the `Load` is an acquire. The non-atomic write to `data` happens-before the Load in any goroutine that sees `ready == true`.

CAS plays the same role:

```go
// goroutine A
data = 42
ready.CompareAndSwap(false, true)

// goroutine B
if ready.Load() {
    use(data) // guaranteed to see 42
}
```

The CAS, when successful, is both an acquire-of-the-old-value and a release-of-the-new-value.

For the full formal rules, see `specification.md` in this directory.

---

## Testing CAS Code

### Use the race detector

```bash
go test -race -count=100 ./...
```

Even though atomic ops are race-free by construction, surrounding code often is not. The race detector catches mixed atomic/non-atomic access.

### Stress tests under load

```go
func TestStack_Concurrent(t *testing.T) {
    var s Stack[int]
    const goroutines = 100
    const opsPerGoroutine = 10_000
    var wg sync.WaitGroup
    for i := 0; i < goroutines; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < opsPerGoroutine; j++ {
                if j%2 == 0 {
                    s.Push(i*opsPerGoroutine + j)
                } else {
                    s.Pop()
                }
            }
        }()
    }
    wg.Wait()
}
```

Repeated runs with `-race` and `-count=100` expose ordering bugs that single runs miss.

### Linearisability checking

For published lock-free structures, formal linearisability checkers (Porcupine for Go: <https://github.com/anishathalye/porcupine>) verify that a recorded history is consistent with some sequential history. Use for serious work.

### Property-based tests

```go
func TestStack_LIFO(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        ops := rapid.SliceOf(rapid.Custom(func(t *rapid.T) op {
            return op{kind: rapid.IntRange(0, 1).Draw(t, "kind"), value: rapid.Int().Draw(t, "v")}
        })).Draw(t, "ops")
        // Run ops on Stack and reference Stack; compare results.
    })
}
```

Property-based testing finds corner cases (interleavings) that hand-written tests miss.

---

## Benchmarks

A representative benchmark for the four primitives:

```go
package bench

import (
    "sync"
    "sync/atomic"
    "testing"
)

func BenchmarkAdd(b *testing.B) {
    var v atomic.Int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            v.Add(1)
        }
    })
}

func BenchmarkCASLoop(b *testing.B) {
    var v atomic.Int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            for {
                old := v.Load()
                if v.CompareAndSwap(old, old+1) {
                    break
                }
            }
        }
    })
}

func BenchmarkMutex(b *testing.B) {
    var mu sync.Mutex
    var v int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            mu.Lock()
            v++
            mu.Unlock()
        }
    })
}

func BenchmarkChannel(b *testing.B) {
    ch := make(chan struct{}, 1)
    ch <- struct{}{}
    var v int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            <-ch
            v++
            ch <- struct{}{}
        }
    })
    _ = v
}
```

Run on 8-core x86:

```
BenchmarkAdd-8           50000000   23 ns/op
BenchmarkCASLoop-8       30000000   45 ns/op
BenchmarkMutex-8         20000000   65 ns/op
BenchmarkChannel-8       10000000  120 ns/op
```

`Add` wins for unconditional updates. CAS-loop is the next-cheapest. Mutex follows. Channels are the slowest for fine-grained mutual exclusion (their power is signalling, not protection).

At 64 goroutines on 8 cores, the numbers degrade across the board, but the relative ordering is preserved. The cache-line bouncing cost is the dominant factor.

---

## Summary

At the middle level, CAS stops being "the fast counter primitive" and becomes the building block of lock-free data structures. You can now:

- Prove the correctness of a CAS loop via the sequential-consistency argument.
- Write Push and Pop on a Treiber stack and know why each line is the way it is.
- Sketch a Michael-Scott queue and know where the subtleties live.
- Implement reference counting with the 0-to-1 race understood and closed.
- Choose between CAS-loop, `Add`/`Or`/`And`, and mutex based on the shape of the update.
- Reason about contention as a first-class design constraint.
- Profile retry counts to detect contention before it becomes a production fire.

The next level (senior) adds: building higher-level primitives, deeper comparison with mutex, design trade-offs across whole subsystems, and the formal vocabulary of progress conditions.

---

## Further Reading

- R. K. Treiber, "Systems Programming: Coping with Parallelism," IBM Almaden Research Center, RJ 5118, 1986. The original Treiber stack paper.
- M. M. Michael and M. L. Scott, "Simple, Fast, and Practical Non-Blocking and Blocking Concurrent Queue Algorithms," PODC '96. The Michael-Scott queue.
- Maurice Herlihy and Nir Shavit, *The Art of Multiprocessor Programming*, 2nd ed., Morgan Kaufmann, 2020. Chapters 9-11 on lock-free stacks and queues.
- Russ Cox, "Hardware Memory Models," <https://research.swtch.com/hwmm>.
- Russ Cox, "Programming Language Memory Models," <https://research.swtch.com/plmm>.
- Anish Athalye, "Porcupine: A Fast Linearizability Checker," <https://github.com/anishathalye/porcupine>.
- Go memory model: <https://go.dev/ref/mem>.
- The Go source: `src/sync/atomic/type.go` for typed atomics.

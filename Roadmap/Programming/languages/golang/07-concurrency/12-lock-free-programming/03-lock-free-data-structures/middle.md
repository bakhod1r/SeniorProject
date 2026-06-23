# Lock-Free Data Structures — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Harris's Lock-Free Linked List](#harriss-lock-free-linked-list)
3. [SPSC Ring Buffer](#spsc-ring-buffer)
4. [MPSC Ring Buffer and Queue](#mpsc-ring-buffer-and-queue)
5. [The Two CASes of MS-Queue, Re-Examined](#the-two-cases-of-ms-queue-re-examined)
6. [Backoff and Contention Control](#backoff-and-contention-control)
7. [Sharded Counters and Sharded Stacks](#sharded-counters-and-sharded-stacks)
8. [Designing the API of a Lock-Free Type](#designing-the-api-of-a-lock-free-type)
9. [Benchmarking Honestly](#benchmarking-honestly)
10. [Summary](#summary)

---

## Introduction

At junior level we wrote the Treiber stack and the Michael-Scott queue. They were short and beautiful, and they hid as much as they showed. At middle level we tackle the structures that take real work to write correctly: Harris's lock-free linked list, single-producer/single-consumer ring buffers, multi-producer/single-consumer ring buffers, sharded counters that scale, and the contention-control techniques that turn a textbook design into a production-grade component.

We also start asking the questions that decide whether you should ship a lock-free design: what does it really cost under contention, how do you benchmark honestly, and when is a `sync.Mutex` plus a slice not just adequate but better?

---

## Harris's Lock-Free Linked List

Tim Harris published *A Pragmatic Implementation of Non-Blocking Linked-Lists* in 2001. The contribution is the **mark bit**: instead of physically deleting a node by swinging the predecessor's `next` pointer, you first *mark* the doomed node's own `next` pointer as deleted. Any concurrent operation that sees the mark refuses to splice through that node and helps finish the physical deletion.

### Why naive deletion races

Consider three nodes `A -> B -> C` and two concurrent operations: delete B, and insert X between B and C. Naive code:

1. Deleter reads `B.next = C`, plans to set `A.next = C`.
2. Inserter reads `B.next = C`, plans to insert X by setting `B.next = X` and `X.next = C`.

If the inserter goes first: `A -> B -> X -> C`. Then the deleter sets `A.next = C`. Now X is orphaned — silently dropped. There is no atomic operation that combines "verify B is still in the list" with "update A.next."

### Harris's fix in one paragraph

Atomically tag `B.next`'s pointer bits with a *mark*. After marking, no one can insert through B because the inserter's CAS on `B.next` from `C` to `X` will fail (B.next is now marked, not plain `C`). Once marked, anyone — the original deleter, or a helping passer-by — performs the physical unlink by CASing `A.next` from `B` to `C`. Logical delete, then physical delete.

### Storing the mark in Go

C++ uses the low bit of the pointer (pointers are at least word-aligned, so the low bits are free). Go does not let you flip bits in `*T` directly. Two options:

1. Wrap the next-pointer in a struct: `next atomic.Pointer[markableNext]` where `markableNext` has both the pointer and a bool. CAS on the wrapper.
2. Use `unsafe.Pointer` and tag the low bit manually. Faster, uglier, and you have to be careful with the GC.

Option 1 is the right choice for almost all code. Here is the skeleton.

```go
type listNode[V any] struct {
    key  uint64
    val  V
    next atomic.Pointer[nextRef[V]]
}

type nextRef[V any] struct {
    next    *listNode[V]
    deleted bool
}

func (n *listNode[V]) loadNext() (*listNode[V], bool) {
    r := n.next.Load()
    if r == nil {
        return nil, false
    }
    return r.next, r.deleted
}

func (n *listNode[V]) casNext(oldRef, newRef *nextRef[V]) bool {
    return n.next.CompareAndSwap(oldRef, newRef)
}
```

The cost: every successor pointer is a heap-allocated `nextRef`. For a small list this is fine; for billions of nodes it doubles the per-node footprint. Tagged-pointer Harris is more compact; it is the right move when you are squeezing memory.

### Search-then-help pattern

The list is sorted by `key`. To insert or delete, `search(key)` returns a pair `(predecessor, successor)` with `pred.key < key <= succ.key`, having helped finish any pending deletions along the way.

```go
func (l *List[V]) search(key uint64) (pred, curr *listNode[V]) {
    for {
        pred = l.head
        currRef := pred.next.Load()
        if currRef == nil {
            return pred, nil
        }
        curr = currRef.next
        for curr != nil {
            nextRef := curr.next.Load()
            if nextRef != nil && nextRef.deleted {
                // curr is logically deleted; help physical unlink.
                newRef := &nextRef[V]{next: nextRef.next, deleted: false}
                if !pred.casNext(currRef, newRef) {
                    break // someone else helped; restart search
                }
                currRef = newRef
                curr = currRef.next
                continue
            }
            if curr.key >= key {
                return pred, curr
            }
            pred = curr
            currRef = nextRef
            curr = currRef.next
        }
        // hit end of list cleanly
        return pred, nil
    }
}
```

The full implementation runs around 200 lines. The point at middle level is the *shape* — search-then-help, mark-then-unlink — not the line-by-line code.

### Why Harris matters

It is the foundation of every lock-free ordered map and lock-free skip list. Cliff Click's hash map uses a per-slot variant. The lock-free skip list (Fraser, Sundell-Tsigas) uses a multi-level Harris list. Read the paper.

---

## SPSC Ring Buffer

The single-producer single-consumer ring buffer is the highest-throughput concurrent queue in existence. Both sides are wait-free in isolation. Both sides use only atomic load and store, no CAS. The structure is the workhorse of audio pipelines, network drivers, and inter-thread messaging in real-time systems.

### Invariants

- Capacity `N` is a power of two (so masking is cheap).
- `head` is incremented only by the consumer.
- `tail` is incremented only by the producer.
- Buffer slots are indexed by `index & (N-1)`.
- Empty iff `head == tail`. Full iff `tail - head == N`.

### Implementation

```go
type SPSC[V any] struct {
    buf  []V
    mask uint64
    _pad [56]byte    // cache-line separation
    head atomic.Uint64
    _pad2 [56]byte
    tail atomic.Uint64
}

func NewSPSC[V any](capPow2 int) *SPSC[V] {
    if capPow2 == 0 || capPow2&(capPow2-1) != 0 {
        panic("capacity must be a power of two")
    }
    return &SPSC[V]{
        buf:  make([]V, capPow2),
        mask: uint64(capPow2 - 1),
    }
}

func (q *SPSC[V]) Push(v V) bool {
    tail := q.tail.Load()
    head := q.head.Load()
    if tail-head == uint64(len(q.buf)) {
        return false
    }
    q.buf[tail&q.mask] = v
    q.tail.Store(tail + 1)
    return true
}

func (q *SPSC[V]) Pop() (V, bool) {
    var zero V
    head := q.head.Load()
    tail := q.tail.Load()
    if head == tail {
        return zero, false
    }
    v := q.buf[head&q.mask]
    q.head.Store(head + 1)
    return v, true
}
```

The padding is not decoration. Without it, `head` and `tail` may live on the same cache line, and producer-writes to `tail` will invalidate the consumer's cached copy of `head`. That is **false sharing**, and it can cost 5-10x in throughput.

### Why it works in Go

Go's atomics are sequentially consistent. The producer's `Store(tail+1)` happens-after its preceding `q.buf[tail&q.mask] = v` (Go memory model: the buffer write is observable to any thread that observes the tail increment). The consumer's `Load(tail)` sees the updated tail and then reads the buffer at the correct slot.

There is one subtlety: the buffer write itself is not atomic, only the index publication is. For value types that fit in a machine word (pointers, ints) this is fine on modern x86 and ARM because aligned word-sized stores are atomic. For larger value types you may want to store `*V` and allocate per-message — at which point you have given up the no-allocation virtue of a ring buffer.

### Performance feel

On a modern x86, an SPSC ring buffer with int values can sustain 100M+ ops/sec on a single producer/consumer pair pinned to sibling cores. A channel does ~20M ops/sec. A mutex-protected slice does ~10M. Lock-free wins decisively *here*, in the niche it was designed for.

---

## MPSC Ring Buffer and Queue

Multi-producer, single-consumer is the next step. Many goroutines push; one goroutine pops. The classic application: a logging subsystem where every goroutine emits log lines and a single writer goroutine drains them.

### Vyukov's intrusive MPSC queue

Dmitry Vyukov's intrusive MPSC queue is one of the cleanest designs in the literature. It is *not* lock-free in the strict sense — the consumer can briefly stall — but it is non-blocking on the producer side and very fast in practice. The trick: a single atomic `Swap` on the tail.

```go
type mpscNode[V any] struct {
    next atomic.Pointer[mpscNode[V]]
    val  V
}

type MPSC[V any] struct {
    head *mpscNode[V]                      // touched only by consumer
    tail atomic.Pointer[mpscNode[V]]       // hammered by producers
    stub mpscNode[V]
}

func NewMPSC[V any]() *MPSC[V] {
    q := &MPSC[V]{}
    q.head = &q.stub
    q.tail.Store(&q.stub)
    return q
}

func (q *MPSC[V]) Push(v V) {
    n := &mpscNode[V]{val: v}
    prev := q.tail.Swap(n)
    prev.next.Store(n)
}

func (q *MPSC[V]) Pop() (V, bool) {
    var zero V
    tail := q.head
    next := tail.next.Load()
    if tail == &q.stub {
        if next == nil {
            return zero, false
        }
        q.head = next
        tail = next
        next = tail.next.Load()
    }
    if next != nil {
        q.head = next
        return tail.val, true
    }
    if tail != q.tail.Load() {
        // Producer is mid-Push; consumer must wait.
        return zero, false
    }
    // Re-enqueue the stub to make Pop visible again.
    q.stub.next.Store(nil)
    prev := q.tail.Swap(&q.stub)
    prev.next.Store(&q.stub)
    next = tail.next.Load()
    if next != nil {
        q.head = next
        return tail.val, true
    }
    return zero, false
}
```

Producers: one atomic Swap + one atomic Store. No CAS, no retries. This is wait-free for producers.

Consumer: not strictly lock-free — between a producer's `tail.Swap` and `prev.next.Store`, the consumer can see a tail that has no link to it yet, and must report "empty for now." For a logging consumer this is fine; for a strict lock-free queue this is a flaw.

### When to choose MPSC over a channel

A Go channel with a single receiver and many senders is already MPSC. A buffered channel handles bursts well. Vyukov's MPSC beats channels on raw throughput when the consumer is a tight loop (no `select`, no `range`-with-ctx), at the cost of significantly more complex code.

Rule of thumb: if you can use a channel, use it. If profiling shows the channel is your bottleneck and the consumer is genuinely a tight loop, consider Vyukov MPSC.

---

## The Two CASes of MS-Queue, Re-Examined

At junior level we said "the MS-queue uses two CASes per enqueue." Why exactly two? Could it be one?

The state being changed is two pointers: `tail.next` (from nil to `n`) and `tail` (from old to `n`). These are two separate atomic words. A single CAS instruction acts on one word. So two CASes is the minimum on a machine without DWCAS.

A machine with **DWCAS** (double-word CAS) can do it in one. Some x86 systems expose CMPXCHG16B. ARM has CASP. In C++ you can sometimes use these via `std::atomic<std::pair<T*, uint64_t>>`. Go's `sync/atomic` does not expose DWCAS, so two CASes it is.

The cost: the tail can lag the actual last node by exactly one node, for a brief window. The MS-queue handles this with the "help advance tail" pattern. The window is small; the lag is bounded; the algorithm is correct.

### Why the helping pattern is necessary

Without helping, a stalled enqueuer (say, descheduled between its two CASes) would block all dequeue operations because dequeue's invariant requires that `tail` is at most one node behind. With helping, any active thread can finish the stalled thread's work and proceed. This is what makes the structure lock-free.

### Common bug: helping with the wrong CAS

```go
// WRONG: CAS from nil
q.tail.CompareAndSwap(nil, next)
// CORRECT: CAS from the observed lagging tail
q.tail.CompareAndSwap(tail, next)
```

If you CAS from `nil`, you assume the tail was unset — but it is currently the lagging value. The CAS will never succeed (unless someone else has freed it, in which case you are doing something far worse).

---

## Backoff and Contention Control

Under high contention, a CAS loop can burn CPU on retries: every thread reads the same head, every thread tries to CAS, only one wins, the others retry. The cache line of `head` ping-pongs between cores.

### Exponential backoff

After each failed CAS, sleep or spin briefly, doubling the wait each time up to a cap:

```go
delay := 1
for {
    if s.head.CompareAndSwap(old, new) {
        return
    }
    for i := 0; i < delay; i++ {
        runtime.Gosched()
    }
    if delay < 1024 {
        delay *= 2
    }
}
```

This trades a tiny bit of latency on the first retry for vastly reduced cache traffic under heavy contention. Java's `j.u.c.atomic` uses something similar internally.

### Why backoff is controversial

Backoff hurts low-contention performance. The fast path now spends an extra branch and an extra check. If contention is rare, the unwasted retries do not justify the slowdown. Measure both paths.

A reasonable default: no backoff. Add backoff only when profiling proves it helps.

### Sharding beats backoff

The cleaner answer to contention is to remove the single hot cache line. Instead of one stack, keep `N` stacks indexed by `runtime.NumGoroutine() % N` or by per-P sharding. Each goroutine touches its own shard most of the time, and the structure scales linearly with cores.

This trades exact ordering (FIFO/LIFO) for throughput. For many workloads — work queues, free lists, statistics buckets — the trade is fine.

---

## Sharded Counters and Sharded Stacks

A sharded counter has `N` independent atomic counters. To increment: pick a shard (often by `runtime.Tid()` or a hash of the current goroutine) and `Add(1)` on that shard. To read total: sum the shards.

```go
type ShardedCounter struct {
    shards [64]struct {
        n atomic.Int64
        _ [56]byte // pad to cache line
    }
}

func (c *ShardedCounter) Add(delta int64) {
    i := shardIndex() & 63
    c.shards[i].n.Add(delta)
}

func (c *ShardedCounter) Sum() int64 {
    var s int64
    for i := range c.shards {
        s += c.shards[i].n.Load()
    }
    return s
}
```

`shardIndex()` is the missing piece. Go does not expose thread IDs cleanly; common workarounds: hash the address of a stack variable, use `runtime.GOMAXPROCS` and CPU id from `syscall` (Linux only), or accept random sharding via fastrand. The `golang.org/x/sync/singleflight` style of "best-effort shard" is usually good enough.

The Sum is racy with concurrent increments — it returns a count that is approximate but always within `N * |delta|` of reality. For metrics this is acceptable.

### Sharded stack

The same idea applies to stacks: `N` Treiber stacks, push to shard `i`, pop from shard `i`. You lose strict LIFO ordering across shards but gain near-linear scaling. This is how Go's `sync.Pool` works internally.

---

## Designing the API of a Lock-Free Type

A few principles:

- **Block or not, never both.** Either `Push` returns immediately with a bool, or it blocks until success. Mixing the two confuses callers.
- **Returns `(V, bool)`, not `(V, error)`.** Empty is not an error.
- **No `Size()` method.** Or label it `ApproxSize()`. Exact size cannot be computed lock-free without serialising every op.
- **No `Iterate` callback method.** Lock-free iteration is a different beast and most callers do not want it.
- **No `Clear()` method**, at least not a clean one. Clearing a lock-free queue while ops are in flight is an algorithm in its own right.

These constraints push you toward minimal APIs: Push, Pop, IsEmpty (approximate). This is a feature: it forces the caller to design around the structure's strengths.

---

## Benchmarking Honestly

The honest benchmark of a lock-free structure has at least these dimensions:

- **Contention level**: 1 producer 1 consumer, N producers 1 consumer, N producers N consumers, all-the-cores producers.
- **Hardware**: x86 vs ARM, single socket vs NUMA, with or without SMT.
- **Payload size**: scalar values, pointer values, large structs.
- **Mix**: 100% push, 50/50, 90% read.
- **Comparison baselines**: `sync.Mutex` + slice, `sync.Mutex` + linked list, channel, `sync.Map` if applicable.

A representative benchmark loop:

```go
func BenchmarkStackPush(b *testing.B) {
    var s Stack[int]
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            s.Push(i)
            i++
        }
    })
}
```

Compare to:

```go
func BenchmarkMutexSlicePush(b *testing.B) {
    var mu sync.Mutex
    var sl []int
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            mu.Lock()
            sl = append(sl, i)
            mu.Unlock()
            i++
        }
    })
}
```

Run with `go test -bench=. -benchmem -cpu=1,2,4,8,16`. Compare ns/op and allocs/op. Look at how each scales with `-cpu`. A scalable design has roughly constant ns/op as cores grow; a contended design has rising ns/op.

### What honest benchmarking usually reveals

For application-level workloads:

- At 1-2 cores, `sync.Mutex` ties or wins.
- At 4-8 cores under contention, lock-free pulls ahead, sometimes by 2-3x.
- At 16+ cores under heavy contention, sharded structures dominate both.
- For 90% read workloads, `sync.RWMutex` competes well with lock-free reads.

The win/lose curve depends on workload. Do not extrapolate from a microbenchmark to your production traffic.

---

## Summary

The middle-level lock-free repertoire: Harris's lock-free list with mark bits, SPSC and MPSC ring buffers, contention control via backoff and sharding, the helping pattern in the MS-queue.

The honest assessment hardens: lock-free wins in narrow, well-measured cases. Sharded counters and SPSC ring buffers are the easiest production wins. Harris-style lists and MPMC queues are senior-level material because they are subtle and hard to debug.

Two takeaways:

1. Most "lock-free is faster" claims do not survive a fair benchmark. The exceptions are real but specific — SPSC, sharded, hot single-atomic.
2. The MS-queue's helping pattern and Harris's mark bit are the two ideas that unlock the harder structures. Internalise both before reading the senior-level material.

---

## Related Topics

- [01-cas-algorithms](../01-cas-algorithms/) — CAS primitives
- [02-aba-problem](../02-aba-problem/) — ABA on indices and tagged pointers
- [04-memory-fences](../04-memory-fences/) — Memory ordering for ring buffers
- [05-lock-free-vs-wait-free](../05-lock-free-vs-wait-free/) — Where SPSC sits on the progress hierarchy

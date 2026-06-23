# The ABA Problem — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Why Tagged Pointers Are Not Enough](#why-tagged-pointers-are-not-enough)
3. [Safe Memory Reclamation Survey](#safe-memory-reclamation-survey)
4. [Hazard Pointers in Depth](#hazard-pointers-in-depth)
5. [Hazard Pointers in Go](#hazard-pointers-in-go)
6. [Epoch-Based Reclamation](#epoch-based-reclamation)
7. [EBR in Go](#ebr-in-go)
8. [Reference Counting Variants](#reference-counting-variants)
9. [Hazard Eras and Interval-Based Reclamation](#hazard-eras-and-interval-based-reclamation)
10. [Michael and Scott Queue, ABA, and Reclamation](#michael-and-scott-queue-aba-and-reclamation)
11. [Harris-Michael Linked List](#harris-michael-linked-list)
12. [Interaction With Go's Garbage Collector](#interaction-with-gos-garbage-collector)
13. [Choosing a Strategy](#choosing-a-strategy)
14. [Verification and Stress Testing](#verification-and-stress-testing)
15. [Summary](#summary)

---

## Introduction

At senior level you stop treating ABA as a single problem with a single fix and start treating it as the visible symptom of a deeper question: how do you safely reclaim memory in a lock-free algorithm? In garbage-collected languages this question often hides behind the runtime. In manually managed environments — and in Go the moment you reach for `sync.Pool` or `unsafe` — it is the central engineering challenge of lock-free data structures.

This file covers the three industrial-grade techniques that the literature converges on:

- **Hazard pointers**, introduced by Maged Michael in 2004, give bounded memory usage and wait-free reads at the cost of one atomic store on each read.
- **Epoch-based reclamation (EBR)**, introduced by Keir Fraser in 2004 and refined by McKenney and others, amortises reclamation across batches and gives near-zero overhead on the fast path.
- **Reference counting variants** — split refcounts, weak references, hazard-pointer-assisted refcounts — fill the niche between the two.

We will reconstruct each from first principles, write a working Go implementation, and then look at the canonical lock-free structures (Michael and Scott queue, Harris-Michael list) that motivated the techniques in the first place.

Throughout, we will distinguish between two questions that beginners conflate:

1. *When is a CAS observation valid?* — answered by ABA mitigations (tagged pointers, DCAS).
2. *When is it safe to free a node?* — answered by safe memory reclamation (hazard pointers, EBR, RCU).

The two are linked. A typical lock-free pop reads a node, dereferences it (`top.next`), and CASes the head past it. Without reclamation discipline, the dereference can read freed memory. With careless reclamation, the CAS can succeed against a recycled pointer (ABA). Hazard pointers and EBR solve both problems at once.

---

## Why Tagged Pointers Are Not Enough

A tagged pointer — `(pointer, gen)` packed into a wrapper or a 128-bit word — defeats *value*-level ABA. It does not, by itself, defeat *use-after-free*. Consider a tagged stack implemented with `unsafe`:

```go
type tagged struct {
    ptr uintptr
    gen uint64
}
```

Suppose T1 loads `(A, 5)`, gets descheduled, and meanwhile T2 pops `A`, frees the node, pushes a different node which is then freed too. The address `A` has been reused twice. T2 finishes by pushing a fresh node that happens to land at address `A` again, yielding `(A, 9)`. So far so good — the generation difference (`5 vs 9`) will cause T1's CAS to fail.

But T1 has not yet reached the CAS. Before failing, T1 still does `next := top.next` on its local `top := A`. If `A`'s storage has been freed and reallocated for an unrelated object — a string, a goroutine stack frame, anything — that dereference reads garbage. The CAS never runs. The program has already misbehaved.

This is the difference between **detecting** a change and **protecting** a dereference. Tagged pointers do the first. They do not do the second. In C and C++ this is a well-known trap: ABA bugs and use-after-free are siblings, and any complete solution must address both.

In Go, the dereference is safe because the GC keeps `A` alive while T1 holds it. But once you opt out of GC (a `sync.Pool` of nodes, an `unsafe`-based slab) you re-enter the C world and need both mitigations.

```go
// Vulnerable: tagged but pooled.
type Stack struct {
    state atomic.Pointer[versioned]
}
type versioned struct {
    head *Node
    gen  uint64
}

func (s *Stack) Pop() (any, bool) {
    for {
        old := s.state.Load()
        if old.head == nil {
            return nil, false
        }
        // BUG: old.head may have been Put back to the pool and recycled,
        // so old.head.next reads stale fields.
        next := &versioned{head: old.head.next, gen: old.gen + 1}
        if s.state.CompareAndSwap(old, next) {
            ret := old.head.value
            nodePool.Put(old.head) // returns Node to pool, defeats GC pinning
            return ret, true
        }
    }
}
```

The wrapper's `gen` will *eventually* cause a stale CAS to fail. But the read `old.head.next` happens before the CAS. If a concurrent goroutine has already pooled and reused `old.head`, you read a torn `Node` struct.

The fix is either to stop pooling, or to add a reclamation discipline that delays pooling until no goroutine holds a reference. Hazard pointers and EBR are the two industrial answers to "how do you do that?".

---

## Safe Memory Reclamation Survey

The literature names this class of problem **SMR — safe memory reclamation**. The canonical surveys are:

- Maged Michael, *Hazard Pointers: Safe Memory Reclamation for Lock-Free Objects*, IEEE TPDS 2004.
- Keir Fraser, *Practical Lock-Freedom*, PhD thesis, Cambridge 2004 — introduces EBR.
- Thomas Hart, Paul McKenney, Angela Demke Brown, *Performance of Memory Reclamation for Lockless Synchronization*, JPDC 2007 — head-to-head comparison.
- Nuno Diegues, Paolo Romano, *Self-Tuning Hazard Pointers*, ICDCS 2015.
- Pedro Ramalhete, Andreia Correia, *Hazard Eras*, SPAA 2017.

The taxonomy that comes out of these papers:

| Scheme | Reader overhead | Reclamation cost | Memory bound | Real-time friendly |
|--------|----------------:|-----------------:|-------------:|-------------------:|
| GC | nothing extra | runtime-controlled | runtime-controlled | no (GC pauses) |
| Reference counting | atomic add/sub per read | per-decrement | tight | yes |
| Hazard pointers | atomic store per read | scan O(P*H) | bounded | yes |
| Epoch-based | epoch read on entry | batch scan | unbounded | no (epoch starvation) |
| Hazard eras | era read on entry | scan | bounded | yes |
| RCU | one barrier per quiescence | per grace period | bounded | yes |
| Interval-based | era read on entry | scan | bounded | yes |

The "right" choice depends on workload (read-heavy vs write-heavy), latency requirements (tail latency vs throughput), and engineering budget. There is no universal best.

In Go specifically, the GC row is the default and the right answer for most code. The other rows apply when you are doing one of:

- Building a library others embed where you cannot afford the GC's tail-latency contribution.
- Wrapping foreign memory where the GC cannot help.
- Recycling slabs or pools for cache locality.
- Implementing concurrency primitives in `runtime`-adjacent code.

The rest of this file goes deep on the two most important rows: hazard pointers and EBR.

---

## Hazard Pointers in Depth

A **hazard pointer** is a single-writer, multi-reader slot that a thread populates with the address of an object it is about to dereference. Before any thread frees an object, it scans all hazard slots; if the object's address appears in any slot, the free is deferred. The address can only be recycled once no thread is observing it.

The contract:

1. Each thread `T` owns one or more hazard slots `hp[T]`.
2. To safely access an object referenced by some shared `head`:
   - Read `p = head.Load()`.
   - Store `hp[T] = p`.
   - **Re-read** `p2 = head.Load()`. If `p2 != p`, retry from step 1.
   - At this point, `hp[T] = p` is published, and `head` still points at `p`. Any thread that wants to free `p` must observe the hazard.
3. To retire (logically free) an object:
   - Add it to a thread-local retired list.
   - Periodically: scan all hazard slots, build a snapshot, and physically free any retired object whose address is *not* in the snapshot.

The re-read on step 2 is the load-bearing detail. It establishes that the hazard pointer was published *before* the second read confirmed the object is still reachable. Without the re-read, a freeing thread could observe an empty hazard slot, free the object, and miss the fact that another thread was about to populate the slot.

### Why this gives bounded memory

Suppose `P` threads each have `H` hazard slots, and each thread retires at most `R` objects between scans. The maximum number of objects that can be retired but not yet freed at any moment is `P * R`. Bound `R` by triggering a scan whenever the retired list exceeds, say, `2 * P * H`. Then the steady-state memory overhead is `O(P * H)`. This is **bounded** — and in particular, independent of how long a slow thread takes to make progress.

EBR does not have this property: a single slow thread can stall reclamation indefinitely, growing the retired list without bound.

### Memory ordering

Hazard pointer publication requires careful ordering. The publish must be a **store-release**, the re-read a **load-acquire**, the retirement scan a **load-acquire** of every hazard slot. In C++ atomics these are explicit; in Go, every atomic op is sequentially consistent, so the ordering is automatic. The cost is some extra barrier overhead on weak architectures (ARM), but the correctness comes for free.

### Wait-free reads

A hazard-pointer read does a bounded number of atomic stores and loads — no loops, no retries unless the object actually moved. This makes hazard-pointer-protected reads **wait-free** in the strict sense: every thread completes its access in a bounded number of steps. Writes (retirement scans) are lock-free but not wait-free, because the scan iterates over all hazard slots.

### Reference: Michael 2004

The IEEE TPDS paper is short and dense. The key results:

- Hazard pointers solve ABA and use-after-free simultaneously, for any number of threads, with `O(P * H)` memory overhead.
- The technique is patented by IBM; the patent expired in 2024, removing the long-standing legal cloud over open-source implementations.
- Original implementation reclaims via per-thread retired lists with a threshold of `2 * P * H`.

The 2024 patent expiry is why you now see hazard pointer implementations in `folly` (Facebook), `boost`, and a number of Go libraries that previously declined to ship them.

---

## Hazard Pointers in Go

A minimal hazard-pointer implementation in Go:

```go
package hazard

import (
    "runtime"
    "sync"
    "sync/atomic"
    "unsafe"
)

const slotsPerThread = 1

type slot struct {
    p atomic.Pointer[byte]
    _ [56]byte // pad to a cache line
}

type Domain struct {
    slots    []slot
    mu       sync.Mutex
    retired  map[unsafe.Pointer]func()
}

func NewDomain(maxThreads int) *Domain {
    return &Domain{
        slots:   make([]slot, maxThreads*slotsPerThread),
        retired: make(map[unsafe.Pointer]func()),
    }
}

// Protect publishes p in the caller's hazard slot. Returns a release function.
// The pattern is:
//   p := head.Load()
//   release := d.Protect(slotIdx, p)
//   defer release()
//   if head.Load() != p { release(); retry }
//   ... safely dereference p ...
func (d *Domain) Protect(slotIdx int, p unsafe.Pointer) func() {
    d.slots[slotIdx].p.Store((*byte)(p))
    return func() { d.slots[slotIdx].p.Store(nil) }
}

// Retire schedules p for deletion via free. The actual call happens after no
// hazard pointer references p.
func (d *Domain) Retire(p unsafe.Pointer, free func()) {
    d.mu.Lock()
    d.retired[p] = free
    if len(d.retired) >= 2*len(d.slots) {
        d.scanLocked()
    }
    d.mu.Unlock()
}

func (d *Domain) scanLocked() {
    hazards := make(map[unsafe.Pointer]struct{}, len(d.slots))
    for i := range d.slots {
        if p := d.slots[i].p.Load(); p != nil {
            hazards[unsafe.Pointer(p)] = struct{}{}
        }
    }
    for p, free := range d.retired {
        if _, hazard := hazards[p]; !hazard {
            free()
            delete(d.retired, p)
        }
    }
    runtime.KeepAlive(d.slots)
}
```

This is a teaching implementation. Production hazard-pointer libraries (Folly's `HazPtr`, the Linux kernel's `liburcu`) add:

- Per-thread slot assignment via thread-local storage.
- Wait-free retirement using thread-local retired lists, batching reclamation.
- Multiple slots per thread for traversals that hold two pointers (current and next).
- Hazard-eras hybrid to bound memory.

### Using it to make a stack ABA-safe

```go
type Node struct {
    value any
    next  *Node
}

type Stack struct {
    head atomic.Pointer[Node]
    hp   *hazard.Domain
}

func (s *Stack) Pop(slotIdx int) (any, bool) {
    for {
        top := s.head.Load()
        if top == nil {
            return nil, false
        }
        release := s.hp.Protect(slotIdx, unsafe.Pointer(top))
        if s.head.Load() != top {
            release()
            continue
        }
        next := top.next
        if s.head.CompareAndSwap(top, next) {
            release()
            v := top.value
            s.hp.Retire(unsafe.Pointer(top), func() {
                // place Node back into pool, or simply allow Go GC to reap
                nodePool.Put(top)
            })
            return v, true
        }
        release()
    }
}
```

The re-read after publication closes the window where a freeing thread could fail to observe the hazard. The retirement callback hands the node to a pool (or to whichever free routine you use); the callback fires only when no hazard slot still points at the node.

### Cost analysis

Per `Pop`: two loads on `head`, one atomic store on `hp[slotIdx]`, one atomic store to clear the slot, and the CAS. Roughly 4-5 atomic ops on the fast path. Compare with EBR's roughly 2 (an epoch read and an epoch write) — hazard pointers cost more per read but bound memory tightly.

---

## Epoch-Based Reclamation

Epoch-based reclamation works at a coarser grain. Every thread declares whether it is currently inside a "critical section" by writing its observed epoch number. A reclaimer can free any object retired in epoch `e` once all threads have advanced past `e`. Three epochs (current, current-1, current-2) suffice: an object retired in epoch `e` can be freed once epoch `e+2` is reached and all threads agree.

The algorithm sketch (Fraser 2004):

1. Global `epoch` counter, initially 0.
2. Per-thread `local_epoch`, initially `INACTIVE`.
3. **Enter critical section**: `local_epoch = global_epoch`.
4. **Exit critical section**: `local_epoch = INACTIVE`.
5. **Retire**: append to per-thread retired list, tagged with `global_epoch`.
6. **Try advance**: occasionally, scan all `local_epoch`s. If every active thread's epoch equals `global_epoch`, increment `global_epoch`. Free anything retired in `global_epoch - 2`.

The invariant: a thread in epoch `e` can only see objects published in epoch `e`. Therefore, an object retired in epoch `e` can be reclaimed once every active thread has moved past `e+1`. The "+1" gap is necessary because retirement and advance can race; in practice `e+2` is the safe lower bound.

### Why EBR is fast

The reader's fast path is one relaxed write (`local_epoch = global_epoch`) on enter and one on exit. No CAS, no scan. On x86 these compile to plain stores; on ARM, a release store. This is hard to beat — the only cheaper thing is doing nothing, which the Go GC effectively does for non-`unsafe` pointers.

### Why EBR can be slow under stress

A stalled thread that left its `local_epoch` set to an old value blocks all reclamation. The retired list grows without bound. In a long-running service this is a memory leak in slow motion. The fix is some combination of:

- Detect stalled threads and force them out of the critical section.
- Switch to hazard pointers under stress.
- Use **interval-based reclamation** which combines the two.

EBR is the right choice for read-heavy short-section workloads (lookups, hash table reads) and the wrong choice for long-running readers (full traversals, snapshot iteration).

---

## EBR in Go

A minimal EBR implementation:

```go
package ebr

import (
    "sync"
    "sync/atomic"
)

type Domain struct {
    globalEpoch atomic.Uint64
    locals      []localState
    mu          sync.Mutex
    retired     [3][]func() // indexed by epoch%3
}

type localState struct {
    epoch atomic.Uint64
    _     [56]byte
}

const inactive = ^uint64(0)

func NewDomain(maxThreads int) *Domain {
    d := &Domain{locals: make([]localState, maxThreads)}
    for i := range d.locals {
        d.locals[i].epoch.Store(inactive)
    }
    return d
}

func (d *Domain) Enter(tid int) {
    d.locals[tid].epoch.Store(d.globalEpoch.Load())
}

func (d *Domain) Exit(tid int) {
    d.locals[tid].epoch.Store(inactive)
}

func (d *Domain) Retire(free func()) {
    e := d.globalEpoch.Load()
    d.mu.Lock()
    d.retired[e%3] = append(d.retired[e%3], free)
    d.mu.Unlock()
}

func (d *Domain) TryAdvance() {
    e := d.globalEpoch.Load()
    for i := range d.locals {
        le := d.locals[i].epoch.Load()
        if le != inactive && le != e {
            return // someone is behind
        }
    }
    d.globalEpoch.Store(e + 1)
    d.mu.Lock()
    old := d.retired[(e+1)%3]
    d.retired[(e+1)%3] = nil
    d.mu.Unlock()
    for _, f := range old {
        f()
    }
}
```

### Using EBR with the stack

```go
func (s *Stack) Pop(tid int) (any, bool) {
    s.ebr.Enter(tid)
    defer s.ebr.Exit(tid)
    for {
        top := s.head.Load()
        if top == nil {
            return nil, false
        }
        next := top.next
        if s.head.CompareAndSwap(top, next) {
            v := top.value
            s.ebr.Retire(func() { nodePool.Put(top) })
            return v, true
        }
    }
}
```

The `Enter`/`Exit` pair brackets the critical section. Inside, the thread can freely dereference any pointer it loaded from `s.head` — no other thread will reclaim it until the epoch advances. `TryAdvance` is called periodically (e.g., after every Nth retire) to push reclamation forward.

### Comparison to RCU

RCU (read-copy-update), the technique that the Linux kernel uses everywhere, is essentially EBR with a synchronisation primitive (`synchronize_rcu` or `call_rcu`) and a guarantee that read sections are short and bounded. The kernel can detect quiescent states cheaply because it owns the scheduler: every context switch is a quiescent point. In userspace, EBR has no scheduler hook, so it relies on explicit enter/exit calls.

Userspace RCU (`liburcu`) provides multiple flavours: `mb` (memory barrier on every enter), `signal` (signal-based quiescence detection), `bp` (bullet-proof, slower but signal-safe), and `qsbr` (caller-provided quiescent points, fastest). The QSBR flavour is essentially EBR with a polished API.

---

## Reference Counting Variants

A naive atomic refcount has two problems:

1. The refcount itself can ABA, as discussed in middle.md.
2. Reading the refcount before incrementing it (to check "is this object still alive?") races with a concurrent free.

The second problem is the killer. If you load a pointer `p`, then `atomic.AddInt32(&p.refs, 1)`, the object might be freed between the load and the add. Your add corrupts unrelated memory.

The known fixes:

### Split reference counts (Lea 2000)

Keep two counters: one for "transient" references (locals, in-flight CAS loops) and one for "permanent" references (stored handles). The transient count is decremented when the local goes out of scope; the permanent count when a handle is dropped. The object is freed when both reach zero. The transient count is protected by hazard pointers or by the same mechanism that protects the original pointer load.

### Hazard-pointer-protected refcount (Folly's `hazptr_holder`)

Use a hazard pointer to safely load `p`, then atomically increment `p.refs` if it is non-zero (a "weak fetch-add"). The hazard guarantees `p` is not freed between load and increment. Once the increment succeeds, the hazard can be released; the refcount keeps the object alive.

### `weak_ptr` style (folly, std::shared_ptr)

Two refcounts per object: one for strong references, one for weak. A weak reference is essentially a "may upgrade to strong if still alive" handle. Upgrading is the only operation that races with the last decrement; the upgrade uses a CAS loop on the strong count, refusing to increment if it is already zero.

In Go, all of these are mostly academic because the GC handles object lifetime. They become relevant when you wrap C objects (`cgo`) or implement deallocation hooks (`runtime.SetFinalizer` is too lazy for many use cases).

---

## Hazard Eras and Interval-Based Reclamation

**Hazard eras** (Ramalhete and Correia, SPAA 2017) generalise hazard pointers to ranges of time. Instead of publishing a single pointer, a thread publishes an `(enter_era, exit_era)` interval. An object retired with `(birth, death)` can be freed once no thread's interval overlaps `[birth, death]`. This trades some memory for fewer atomic operations: one era read on entry, one on exit, no per-pointer publication.

**Interval-based reclamation** (Wen, Izraelevitz, Cai, Beadle, Scott, PPoPP 2018) refines this further with bounded memory under stalled threads, by aborting and restarting long-running readers. The technique is what you would reach for in a kernel or in a hard-real-time userspace context. In Go application code, you almost certainly do not need it.

These are mentioned for completeness and to give names to the techniques you might encounter in academic literature. The two workhorses for almost all Go code that opts out of the GC are hazard pointers and EBR.

---

## Michael and Scott Queue, ABA, and Reclamation

The canonical lock-free MPMC queue (Michael and Scott, PODC 1996) is the standard test case for reclamation schemes. Its enqueue and dequeue both involve a CAS on a node pointer plus a dereference of `node.next`. Both operations are vulnerable to ABA and use-after-free.

Pseudocode (Go-flavoured):

```go
type msNode struct {
    value any
    next  atomic.Pointer[msNode]
}

type MSQueue struct {
    head atomic.Pointer[msNode] // points to sentinel
    tail atomic.Pointer[msNode]
}

func (q *MSQueue) Enqueue(v any) {
    n := &msNode{value: v}
    for {
        last := q.tail.Load()
        next := last.next.Load()
        if last != q.tail.Load() {
            continue
        }
        if next == nil {
            if last.next.CompareAndSwap(nil, n) {
                q.tail.CompareAndSwap(last, n)
                return
            }
        } else {
            q.tail.CompareAndSwap(last, next)
        }
    }
}

func (q *MSQueue) Dequeue() (any, bool) {
    for {
        first := q.head.Load()
        last := q.tail.Load()
        next := first.next.Load()
        if first != q.head.Load() {
            continue
        }
        if first == last {
            if next == nil {
                return nil, false
            }
            q.tail.CompareAndSwap(last, next)
        } else {
            v := next.value
            if q.head.CompareAndSwap(first, next) {
                // first is the old sentinel, now retire it
                retire(first)
                return v, true
            }
        }
    }
}
```

In Go this code is approximately correct *because* the GC keeps `first`, `last`, and `next` alive while the locals reference them. Without the GC — say if `retire(first)` immediately calls `pool.Put(first)` without coordination — the next iteration of a concurrent `Dequeue` could read `first.next` from a recycled node and crash or loop forever.

Production lock-free queues (LCRQ, Vyukov's bounded MPMC, Folly's `MPMCQueue`) all couple their CAS protocol with a reclamation scheme. The Vyukov MPMC queue we saw in middle.md sidesteps the problem by using per-slot sequence numbers in a fixed-size ring buffer, which avoids dynamic allocation entirely.

---

## Harris-Michael Linked List

Harris (DISC 2001) introduced the now-standard lock-free linked list, refined by Michael (SPAA 2002) to coexist with hazard pointers. The technique: deletion is a two-step process — logically mark the node as deleted by setting a bit in `next`, then physically unlink. The marking bit means a concurrent traversal can detect the in-progress deletion and help complete it.

```go
type listNode struct {
    key  int
    next markableRef // packed pointer + mark bit
}
```

Where `markableRef` is either a 64-bit packed value (via `unsafe`) or a wrapper struct. The mark bit is what makes the node observable as "in deletion" without freeing it. Hazard pointers then protect the actual pointer.

The combination "mark bit + hazard pointer" is the canonical recipe for lock-free linked structures with bounded memory. It is more involved than a tagged-pointer stack but solves the entire problem cleanly.

Go's `sync.Map` does something morally similar internally: a `read` map and a `dirty` map, with `expunged` entries that are logically deleted but not yet physically removed. The GC handles the physical reclamation, but the conceptual structure — "logical delete, then physical delete after a quiescent period" — is the same.

---

## Interaction With Go's Garbage Collector

Hazard pointers and EBR in Go interact with the GC in two ways worth thinking about:

### The GC already protects against use-after-free

If your `Retire` callback simply discards the reference (the node will be GC'd once no goroutine holds it), you do not need hazard pointers for use-after-free safety — the GC does that. You may still want hazard pointers or EBR for performance reasons (avoiding the GC's tail-latency contribution), but the correctness justification is gone.

### `runtime.KeepAlive` and finalizers

If you mix hazard pointers with `runtime.SetFinalizer`, you need `runtime.KeepAlive` to ensure the GC does not run a finalizer prematurely while a hazard pointer still references the object. The interaction is subtle: the hazard pointer is an `unsafe.Pointer`, which the GC does not track. From the GC's perspective, the object is unreachable as soon as the last `*Node` reference goes out of scope, even if `hp.Load()` returns its address.

```go
release := d.Protect(slotIdx, unsafe.Pointer(node))
defer runtime.KeepAlive(node) // pin node from the GC's view
defer release()
```

The `runtime.KeepAlive` keeps the strongly-typed pointer reachable; the hazard pointer publication then has meaning beyond "an address that the GC might already have freed."

In a pure `unsafe.Pointer` arena where you have given up on the GC entirely (slab allocator, `mmap`-backed), this concern goes away.

### Why Go's GC is "implicit hazard pointers"

Every stack-resident `*T` is a GC root. Every `atomic.Pointer[T].Load()` returning into a local is a published reference that pins the object. The GC's tri-colour mark phase is effectively a periodic scan of "all hazard pointers held by all goroutines." In this sense, Go's GC is hazard pointers with a global scan instead of per-thread, and a fancier write barrier. The cost is the GC pauses; the benefit is that all of this happens automatically.

For most application code, the GC's tradeoff is correct: pay a small GC overhead, never write a hazard-pointer scheme. For latency-critical lock-free libraries, the explicit scheme buys lower tail latency at the cost of substantial complexity.

---

## Choosing a Strategy

A decision tree for senior engineers in Go:

1. **Is this code performance-critical lock-free with hot allocation?** If no, stop. Use a mutex. The complexity is not justified.

2. **Are you opting out of GC (sync.Pool, unsafe, cgo)?** If no, you almost certainly do not need hazard pointers or EBR. The GC handles reclamation. Use a tagged wrapper if value-level ABA is possible.

3. **Is the workload read-heavy with short critical sections?** EBR is the right answer. One write on enter, one on exit, batched reclamation.

4. **Do you need bounded memory under stalled threads, or hard real-time guarantees?** Hazard pointers. One write per dereference, but memory is bounded by `O(P * H)`.

5. **Do you need both?** Hazard eras or interval-based reclamation. Substantially more complex to implement correctly; rarely worth it outside of high-end systems work.

6. **Is the workload very specific (single-producer single-consumer, bounded ring buffer, etc.)?** Look for a workload-specific scheme — Vyukov MPMC, LCRQ, Disruptor — that avoids the problem entirely.

For most Go code, the first two questions terminate the discussion. Hazard pointers and EBR are tools for libraries and infrastructure, not application code.

---

## Verification and Stress Testing

ABA bugs are *hard* to trigger in test. They depend on a specific interleaving of operations and memory reuse. Bare-eyed code review catches the obvious ones; the subtle ones require:

### `go test -race`

The race detector catches data races on plain memory but not on atomically-accessed memory. A lock-free algorithm by design has no data races in the Go memory model sense; the race detector will not catch ABA. This is a common surprise. The race detector is necessary but not sufficient.

### Stress tests with chaos

Run the structure under high concurrency (`GOMAXPROCS=8` or 16) for hours with random operations. Verify invariants (multiset of contents, length) after each operation. Inject scheduling chaos with `runtime.Gosched()` at strategic points.

### Model checking with `loom` (Rust) or hand-written tools

Go does not have an out-of-the-box model checker, but the `dst` library and `gomc` provide deterministic schedulers. For critical lock-free code, model checking is the only way to gain real confidence.

### Linearizability checking

Tools like `porcupine` (Anish Athalye) take an operation log and check whether it could have been produced by a serial execution of the abstract data type. This catches linearizability violations that ABA bugs typically produce.

```go
import "github.com/anishathalye/porcupine"

events := []porcupine.Event{...} // captured during stress run
ok := porcupine.CheckOperations(stackModel, events)
```

For senior-level lock-free work, set up porcupine before you ship.

### Production canary

Roll the structure out to a single host first, with detailed metrics on operation counts, retries, and invariant checks. Compare those metrics across hosts to detect drift.

---

## Summary

ABA is the visible symptom of a deeper problem: in a lock-free algorithm, you must coordinate both "did the value change?" and "when is it safe to reclaim?" In garbage-collected languages, the second question is handed to the runtime. In manually managed code — and in Go the moment you reach for `sync.Pool` or `unsafe` — both questions return.

The two industrial-grade answers are hazard pointers (per-pointer publication, bounded memory, wait-free reads) and epoch-based reclamation (coarse-grained quiescence, near-zero reader overhead, unbounded retired list under stress). Both have working Go implementations; both interact with the GC in interesting ways.

For the canonical lock-free structures — Treiber stack (Treiber 1986), Michael and Scott queue (MS 1996), Harris-Michael list (Harris 2001, Michael 2002) — the reclamation scheme is at least as important as the algorithm. The original papers are short, and worth reading directly; the modern compendium is *The Art of Multiprocessor Programming* by Herlihy and Shavit, second edition.

At senior level, the practical decisions are: when to use a mutex, when a tagged wrapper, when hazard pointers, when EBR, and when to use a workload-specific scheme that sidesteps the question entirely. The professional level, next, looks at production postmortems and the dirtier corners — DWCAS in cgo, MTE on ARM, real incidents that taught the field what hazard pointers were originally meant to prevent.

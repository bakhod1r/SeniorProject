# Lock-Free Data Structures — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What is a lock-free data structure? How do I build a stack and a queue without using a mutex? Why are they harder than they look?"

A **lock-free data structure** is a container — a stack, queue, list, map — whose operations make progress even when other threads are paused mid-operation. No thread holds a lock. No thread waits for another thread to "release" anything. Each thread reads the shared state, computes its next move, and tries to commit that move atomically with `CompareAndSwap`. If another thread got there first, it tries again.

The textbook designs are old and short. R. Kent Treiber wrote the lock-free stack in 1986. Maged Michael and Michael Scott published the canonical lock-free FIFO queue in 1996. Tim Harris published the lock-free linked list with logical deletion in 2001. Cliff Click presented a non-blocking hash map at JavaOne 2007. Each one fits in a few hundred lines. Each one has nuances that bite people who skip the paper.

Why learn these in Go? Two honest reasons:

1. **To read concurrent code well.** When you see `atomic.Pointer[Node]` and a CAS loop in someone else's library, you should recognise the pattern, name the algorithm, and predict where it can break. This is a basic literacy skill once you go past `sync.Mutex`.
2. **To understand the limits.** You will not build a lock-free queue at work. The Go standard library already gives you channels, `sync.Map`, `sync.Mutex`, and `sync.RWMutex`, and all of them are fast enough for almost every real workload. Knowing the textbook designs teaches you *why* they are not the default — they are subtle, they have memory-reclamation problems, and they are not necessarily faster.

After reading this file you will:

- Know what makes a data structure lock-free
- Be able to write a Treiber stack in Go from memory
- Be able to write a Michael-Scott queue in Go with the two CASes per operation
- Understand why both designs need an "ABA story" and why Go's garbage collector helps
- Recognise that an atomic counter is the simplest lock-free data structure
- Know when to reach for a mutex instead

You do not need to know about hazard pointers, epoch-based reclamation, the LMAX Disruptor, Vyukov's MPMC queue, or Click's hash map yet. They appear at middle and senior level. This file is the on-ramp.

---

## Prerequisites

- **Required:** Comfort with goroutines, channels, and `sync.Mutex`. You should know what `go f()` does and what `mu.Lock()` does.
- **Required:** Working knowledge of `sync/atomic`, especially `atomic.Int64`, `atomic.Pointer[T]`, and `CompareAndSwap`. The CAS-algorithms subsection covers this; read it first if `CAS` is unfamiliar.
- **Required:** A Go installation, version 1.19 or newer. Earlier versions lacked the generic `atomic.Pointer[T]` type and forced uglier code with `unsafe.Pointer`.
- **Helpful:** Some idea of pointers in C-like languages. Lock-free data structures are pointer-heavy.
- **Helpful:** Awareness of the ABA problem from the previous subsection. We will mention it but not solve it.

If you can write a goroutine that increments a counter with `atomic.Int64` from ten goroutines and get the right total at the end, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Lock-free** | A data structure where, at any moment, at least one thread is guaranteed to make progress in a bounded number of steps. No thread is blocked by another thread holding a lock. |
| **Wait-free** | A stronger guarantee: every thread makes progress in a bounded number of steps, not just one. Wait-free algorithms exist but are rare and usually slower. |
| **Obstruction-free** | A weaker guarantee: a thread makes progress if it runs in isolation for long enough. Two contending threads may livelock. |
| **CAS** | Compare-And-Swap. The hardware instruction `if mem == old then mem = new`. The basic building block of every algorithm here. |
| **Treiber stack** | The classic lock-free LIFO stack, published by R. Kent Treiber in 1986. One CAS per push, one CAS per pop. |
| **Michael-Scott queue (MS-queue)** | The canonical lock-free FIFO queue, published by Michael and Scott in 1996. Two CASes per enqueue and per dequeue. |
| **Harris list** | A lock-free singly linked list with logical-then-physical deletion, published by Tim Harris in 2001. |
| **ABA problem** | A CAS sees the same value it read earlier and concludes "nothing changed," when in fact the value was changed to something else and back. |
| **Linearizability** | The correctness condition for concurrent data structures: every operation appears to take effect at some single instant between its invocation and its return. |
| **`atomic.Pointer[T]`** | Go's generic atomic pointer type (since 1.19). Provides `Load`, `Store`, `Swap`, `CompareAndSwap` for pointer-typed values. |
| **Sentinel / dummy node** | A node that holds no user value but simplifies head/tail invariants. The MS-queue uses one. |
| **Hot path** | The code path that runs most often in a hot loop. Lock-free designs are often justified by making the hot path mutex-free. |

---

## Core Concepts

### A data structure is lock-free, not a piece of code

People say "I wrote a lock-free function." They mean "I wrote a function that does not lock." Lock-freedom is a property of the *whole* data structure — its operations, taken together, must satisfy the progress guarantee. A single push that uses CAS is meaningless if the matching pop uses a mutex.

When you label a structure lock-free, you are claiming a property about every operation in concert: push, pop, peek, size, iterate. If any one of them blocks waiters or can be blocked by them, the structure is not lock-free.

### Every lock-free structure shares one shape

Almost every lock-free operation follows the same skeleton:

```
1. Read the relevant pointer or value with an atomic load.
2. Inspect what you read. If the structure is in a state you do not handle, retry or help another thread.
3. Compute the new value/pointer.
4. CAS the old value to the new value.
5. If the CAS failed, go to step 1.
```

This is the **CAS loop**. The reason it works: when the CAS succeeds, the structure has not moved since step 1. The reason it is hard: the structure can move between steps 1 and 4 in many ways, and you must handle each.

### Treiber's stack is the smallest lock-free structure that is interesting

A stack has one pointer: `head`. Push prepends a node; pop removes the top node. Both reduce to "atomically swap `head` from `old` to `new`."

```go
type Node[V any] struct {
    value V
    next  *Node[V]
}

type Stack[V any] struct {
    head atomic.Pointer[Node[V]]
}

func (s *Stack[V]) Push(v V) {
    n := &Node[V]{value: v}
    for {
        top := s.head.Load()
        n.next = top
        if s.head.CompareAndSwap(top, n) {
            return
        }
    }
}

func (s *Stack[V]) Pop() (V, bool) {
    var zero V
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

This is the whole stack. It is correct in Go because the GC keeps `top` alive while you hold a reference to it, which dodges the worst form of ABA. In C++ you would need hazard pointers or reference counting or epoch reclamation. We get them for free.

### Michael-Scott queue uses two pointers and two CASes

A queue needs both a head and a tail. The textbook trick: keep a **dummy node** at the front, so `head` and `tail` are never `nil`. Enqueue links a new node after the current tail and advances the tail. Dequeue takes the node after `head` and advances `head`.

The reason there are *two* CASes per operation is that enqueue is two distinct atomic steps: (1) link the new node to the tail node's `next`, (2) advance the tail pointer. Either step can race. A second enqueuer arriving between (1) and (2) must *help* finish (2) before proceeding. This "helping" pattern is signature MS-queue code.

We will write it in full in the Code Examples section.

### Harris's lock-free linked list separates logical and physical deletion

Linked-list deletion looks easy: find the node, point its predecessor at its successor. With concurrent access, naive deletion races: two deleters can both reroute around the same node, or an inserter can splice a new node behind a deleter mid-flight.

Harris's solution: mark the deleted node's `next` pointer with a *deletion bit* before physically unlinking it. Once marked, no concurrent operation will splice anything onto that node — they all detect the mark and help finish the deletion. Logical delete first, physical delete second.

This is harder to write than the stack or queue. We mention it now and code a sketch at middle level.

### Atomic counter is the trivial lock-free "data structure"

`atomic.Int64` is technically a lock-free data structure with two operations: `Add` and `Load`. Pushing it under the same banner as stacks and queues sounds silly, but it underlines the point: lock-free starts the moment you replace `mu.Lock(); n++; mu.Unlock()` with `atomic.AddInt64(&n, 1)`. Most of the wins from lock-free programming come from this trivial case.

### Bounded queues are a different beast

A *bounded* queue has fixed capacity. It does not allocate per operation. The classic implementation is a **ring buffer**: a fixed array, a head index, a tail index, both atomic. The cost model is completely different: no allocation, no garbage, no node-recycling problem (and therefore no ABA on pointers), but indices wrap around so ABA-on-integers can show up.

Three flavours:

- **SPSC** (single-producer, single-consumer): the simplest, often wait-free.
- **MPSC** (multi-producer, single-consumer): one CAS loop on the producer side, simple consumer.
- **MPMC** (multi-producer, multi-consumer): hardest. Vyukov's algorithm and the LMAX Disruptor are the famous designs.

We meet SPSC and MPSC at middle level; MPMC at senior.

### "Lock-free is faster than mutex" — almost always false

This is the single most damaging belief in the topic. Mutexes in Go are extremely fast — uncontended `sync.Mutex.Lock` is a single atomic op plus a few instructions. A lock-free stack pays the same one atomic op per operation, plus retries when there is contention. Under high contention, lock-free retries can burn more CPU than a mutex's adaptive spinning.

The right reason to choose lock-free is rarely throughput. It is **latency predictability** under preemption: a thread holding a mutex can be descheduled by the OS, and then everyone waits; a lock-free thread that is descheduled does not block anyone. For latency-sensitive code — schedulers, GC barriers, signal handlers — this matters. For HTTP handlers, it almost never does.

---

## Real-World Analogies

### A stack is a single-doored closet

Treiber's stack: one door (`head`), one queue of people outside, each holding the thing they want to put inside or wanting to take the top thing out. Each person looks through the door, decides what they would do, and tries to slam the door shut on their move. If someone else slammed it first, they look again. Nobody waits in line.

### MS-queue is a conveyor belt with two clerks

The enqueue clerk loads new items onto the back of the belt. The dequeue clerk picks items off the front. They use two distinct controls: a "back marker" the loader bumps after loading, and a "front marker" the picker bumps after picking. Because loading is two steps (place item, advance marker), a second loader who arrives between the steps must help advance the marker before placing their own item — otherwise items pile up at the back without being indexed.

### Harris list is editing a shared Wikipedia paragraph

Several editors are deleting sentences from a paragraph at once. The naive way — each editor rewrites the surrounding text — collides. The Harris way: each editor first puts a strikethrough on the doomed sentence (the mark). Once struck through, no other editor will splice onto that sentence. After the mark is in, anyone can perform the physical removal — first one to do so wins.

### Ring buffer is a circular conveyor at sushi train

Plates ride a circular belt. Producers place plates in slots; consumers take them. Each slot has a small flag — "loaded" or "empty." Producers spin until a slot is empty, place a plate, set "loaded." Consumers spin until "loaded," take the plate, set "empty." Indices wrap from N back to 0.

### Lock-free vs mutex is express lane vs cashier

A grocery store with one cashier: everyone forms a line. A self-checkout with eight kiosks: everyone picks an open one. Self-checkout has no "wait for the front of the line," but a customer who gets stuck at a kiosk does not stop the others. Lock-free is self-checkout. Mutex is the cashier.

---

## Mental Models

### Mental model 1: every lock-free op is a bet
You read the world, you decide your move, you place your bet (CAS), and either you win or you replay. There is no waiting room.

### Mental model 2: the structure is the atomic pointers
Forget about "the queue." The queue's *identity* is the values of its atomic pointers at this moment. Operations are state transitions over those pointers. Anything else — node values, GC-managed memory — is incidental.

### Mental model 3: helping is a feature, not a workaround
In the MS-queue, when an enqueuer sees a half-finished enqueue from another thread (tail's `next` is non-nil), it advances the tail itself. This "helping" is core to the algorithm. Lock-free algorithms often require active threads to assist stalled threads to maintain the progress guarantee.

### Mental model 4: ABA is a permanent worry
Even in Go, where the GC pins reachable nodes, ABA still appears whenever you recycle indices (ring buffers), reuse identifiers, or wrap counters. The pattern "I read X, you read X, I act, you act on the same X" is what ABA is, regardless of whether X is a pointer or an int.

### Mental model 5: linearizability is the contract
Lock-free data structures are not just "works most of the time." Their public contract is linearizability: every operation appears to happen instantaneously at some moment between when you called it and when it returned. If your design cannot meet this, you have a concurrent data structure, but it is not the kind of object users expect.

---

## Pros & Cons

### Pros

- **No deadlock by construction.** No locks means no lock-ordering bugs.
- **No priority inversion.** A high-priority thread cannot be blocked by a low-priority thread holding a lock.
- **Robust under preemption.** A descheduled thread does not block anyone.
- **Useful in code that cannot lock.** Signal handlers, GC barriers, async-signal-safe code.
- **Predictable tail latency.** No lock-induced stalls.

### Cons

- **Much harder to write.** The textbook designs are subtle, and your own designs are likely wrong.
- **Much harder to test.** Bugs surface only under specific schedules; race detectors are necessary but not sufficient.
- **Not automatically faster.** Under high contention, retries can be costlier than a mutex's wait queue.
- **Memory reclamation is hard.** In Go the GC saves you; in C++ you write hazard pointers or epochs.
- **Limited operation set.** Multi-step operations (transactions across two structures) are very hard lock-free.
- **Hard to read.** The code is short but every line is load-bearing.

---

## Use Cases

- **Lock-free counters.** Request counters, metrics, statistics. `atomic.Int64` is the right answer here.
- **Lock-free flags.** "Has this run yet?" `atomic.Bool` or `sync.Once` (which itself uses an atomic flag).
- **Producer-consumer pipelines** with hot single-producer/single-consumer hops. SPSC ring buffers shine here.
- **Work-stealing schedulers.** Each P (in Go's runtime) has a lock-free deque other Ps can steal from.
- **Lock-free reference counting.** Tracking shared resources without contending on a counter mutex.
- **Cache eviction queues.** A lock-free linked list with mark bits is a common LRU primitive.

When **not** to reach for lock-free:

- An ordinary mutex-protected map or slice is fine for almost any application code.
- If contention is moderate, `sync.RWMutex` beats most hand-rolled lock-free designs.
- If your data structure needs multi-step transactions, lock-free will not help you.

---

## Code Examples

### Example 1: Treiber stack, complete and tested

This is the full Treiber stack. Read it once, then read it again — every line earns its keep.

```go
package lockfree

import (
    "sync/atomic"
)

// node is the internal stack node.
type node[V any] struct {
    value V
    next  *node[V]
}

// Stack is a lock-free LIFO stack (Treiber, 1986).
// All operations are safe to call from multiple goroutines.
type Stack[V any] struct {
    head atomic.Pointer[node[V]]
}

// Push prepends v to the stack. O(1) amortised, lock-free.
func (s *Stack[V]) Push(v V) {
    n := &node[V]{value: v}
    for {
        top := s.head.Load()
        n.next = top
        if s.head.CompareAndSwap(top, n) {
            return
        }
        // CAS failed: another thread modified head. Retry.
    }
}

// Pop removes and returns the top of the stack.
// Returns (zero, false) if the stack is empty.
func (s *Stack[V]) Pop() (V, bool) {
    var zero V
    for {
        top := s.head.Load()
        if top == nil {
            return zero, false
        }
        next := top.next
        if s.head.CompareAndSwap(top, next) {
            return top.value, true
        }
    }
}

// Peek returns the top value without removing it.
// Returns (zero, false) if empty. Linearisable at the load.
func (s *Stack[V]) Peek() (V, bool) {
    var zero V
    top := s.head.Load()
    if top == nil {
        return zero, false
    }
    return top.value, true
}
```

A simple test:

```go
package lockfree

import (
    "sync"
    "testing"
)

func TestStackConcurrent(t *testing.T) {
    var s Stack[int]
    const goroutines = 16
    const perGoroutine = 1000

    var wg sync.WaitGroup
    wg.Add(goroutines)
    for i := 0; i < goroutines; i++ {
        go func(id int) {
            defer wg.Done()
            for j := 0; j < perGoroutine; j++ {
                s.Push(id*perGoroutine + j)
            }
        }(i)
    }
    wg.Wait()

    seen := make(map[int]bool)
    for {
        v, ok := s.Pop()
        if !ok {
            break
        }
        if seen[v] {
            t.Fatalf("duplicate value %d", v)
        }
        seen[v] = true
    }
    if len(seen) != goroutines*perGoroutine {
        t.Fatalf("lost values: got %d, want %d", len(seen), goroutines*perGoroutine)
    }
}
```

Run with `go test -race -run TestStackConcurrent`. The race detector should stay quiet.

### Example 2: Michael-Scott queue, complete

This is the full lock-free FIFO queue. Note the dummy node, the two CASes per enqueue, and the "help advance tail" step.

```go
package lockfree

import (
    "sync/atomic"
)

type msNode[V any] struct {
    value V
    next  atomic.Pointer[msNode[V]]
}

// Queue is a lock-free FIFO queue (Michael & Scott, 1996).
// Always contains at least one node — a dummy whose value is unused.
type Queue[V any] struct {
    head atomic.Pointer[msNode[V]]
    tail atomic.Pointer[msNode[V]]
}

// NewQueue returns a queue with a dummy node already installed.
func NewQueue[V any]() *Queue[V] {
    q := &Queue[V]{}
    dummy := &msNode[V]{}
    q.head.Store(dummy)
    q.tail.Store(dummy)
    return q
}

// Enqueue appends v to the back of the queue.
func (q *Queue[V]) Enqueue(v V) {
    n := &msNode[V]{value: v}
    for {
        tail := q.tail.Load()
        next := tail.next.Load()
        if tail != q.tail.Load() {
            continue // tail changed under us, retry
        }
        if next != nil {
            // Tail is lagging; someone enqueued but did not advance tail. Help them.
            q.tail.CompareAndSwap(tail, next)
            continue
        }
        // Try to link n after tail.
        if tail.next.CompareAndSwap(nil, n) {
            // We succeeded. Try to advance tail. If we fail, someone else helped.
            q.tail.CompareAndSwap(tail, n)
            return
        }
        // CAS failed; another thread enqueued first. Retry.
    }
}

// Dequeue removes and returns the front of the queue.
// Returns (zero, false) if the queue is empty.
func (q *Queue[V]) Dequeue() (V, bool) {
    var zero V
    for {
        head := q.head.Load()
        tail := q.tail.Load()
        next := head.next.Load()
        if head != q.head.Load() {
            continue
        }
        if head == tail {
            if next == nil {
                return zero, false // empty
            }
            // Tail is lagging; help advance it.
            q.tail.CompareAndSwap(tail, next)
            continue
        }
        // Read the value before CAS — the node may be reused after CAS.
        v := next.value
        if q.head.CompareAndSwap(head, next) {
            return v, true
        }
    }
}
```

The structure: the queue *always* has at least one node — the initial dummy. After the first enqueue, `head` is the dummy, `tail` is the new node, and `head.next == tail`. Dequeue advances `head` to its successor and returns the successor's value. The dummy floats forward as the queue is consumed.

The crucial detail: in Dequeue, you must read `next.value` **before** the CAS, not after. After the CAS, another thread may dequeue further and (in C++) free the node; in Go the GC saves us, but reading after CAS is still wrong because by then your local reference may point to a node that has been re-linked elsewhere.

Test it:

```go
func TestQueueConcurrent(t *testing.T) {
    q := NewQueue[int]()
    const producers = 8
    const consumers = 8
    const perProducer = 1000

    var wg sync.WaitGroup
    wg.Add(producers + consumers)

    for i := 0; i < producers; i++ {
        go func(id int) {
            defer wg.Done()
            for j := 0; j < perProducer; j++ {
                q.Enqueue(id*perProducer + j)
            }
        }(i)
    }

    var counts sync.Map
    for c := 0; c < consumers; c++ {
        go func() {
            defer wg.Done()
            for {
                v, ok := q.Dequeue()
                if !ok {
                    // Producers may still be producing; spin/retry briefly in real tests.
                    return
                }
                counts.Store(v, true)
            }
        }()
    }
    wg.Wait()
    // In a real test, drain residual items and assert total count.
}
```

(In a real test you would use a `done` channel or a known total to know when to stop dequeueing.)

### Example 3: atomic counter (the trivial case)

```go
type Counter struct {
    n atomic.Int64
}

func (c *Counter) Inc()            { c.n.Add(1) }
func (c *Counter) Value() int64    { return c.n.Load() }
func (c *Counter) Reset() int64    { return c.n.Swap(0) }
```

This is lock-free. It is also wait-free, since every operation completes in a constant number of steps. It is the structure that wins the cost-benefit argument by the widest margin: trivial code, large win over a mutex-protected `int`.

### Example 4: SPSC ring buffer sketch

A single-producer single-consumer bounded queue. We will study it in detail at middle level; here is the shape:

```go
type SPSCRing[V any] struct {
    buf  []V
    mask uint64
    head atomic.Uint64 // consumer reads, producer reads
    tail atomic.Uint64 // producer writes, consumer reads
}

func NewSPSCRing[V any](capPow2 int) *SPSCRing[V] {
    return &SPSCRing[V]{
        buf:  make([]V, capPow2),
        mask: uint64(capPow2 - 1),
    }
}

func (r *SPSCRing[V]) Push(v V) bool {
    tail := r.tail.Load()
    if tail-r.head.Load() == uint64(len(r.buf)) {
        return false // full
    }
    r.buf[tail&r.mask] = v
    r.tail.Store(tail + 1)
    return true
}

func (r *SPSCRing[V]) Pop() (V, bool) {
    var zero V
    head := r.head.Load()
    if head == r.tail.Load() {
        return zero, false // empty
    }
    v := r.buf[head&r.mask]
    r.head.Store(head + 1)
    return v, true
}
```

This is wait-free for both producer and consumer in isolation — no loops, no CAS, only atomic load/store. It is correct because of Go's sequential consistency on atomics: the producer's store of `tail` happens after the store of `buf[...]`, and the consumer's load of `buf[...]` happens after the load of `tail`.

For MPMC, the same idea but with per-slot sequence numbers (Vyukov's algorithm). That is senior-level material.

---

## Coding Patterns

### Pattern 1: the canonical CAS loop
```go
for {
    old := ptr.Load()
    new := mutate(old)
    if ptr.CompareAndSwap(old, new) {
        return
    }
}
```
Every operation in Treiber and MS-queue is a specialisation of this.

### Pattern 2: helping
```go
if interferenceDetected {
    helpFinish() // bump the other thread's progress
    continue
}
```
Seen in MS-queue: a stalled enqueue is helped along by the next enqueuer.

### Pattern 3: dummy node
Initialise the queue with a no-value node. `head` and `tail` are never nil. Many edge cases vanish.

### Pattern 4: read-load-validate
```go
a := ptr.Load()
b := other.Load()
if a != ptr.Load() {
    continue // a stale, restart
}
```
Re-read the first pointer after reading the second, to ensure consistency. The MS-queue uses this against the head/tail/next triple.

### Pattern 5: zero value on empty
```go
var zero V
return zero, false
```
For generic stacks and queues, returning `false` plus the zero value is idiomatic Go. Callers check the bool.

---

## Clean Code

- Name lock-free types after their algorithm: `TreiberStack`, `MSQueue`, `VyukovQueue`. The user should know what they bought.
- Keep the CAS loop in one function. Do not inline retries into the caller.
- Always read pointers via `Load()`, never via direct field access. Tooling and reviewers will assume `Load` means atomic.
- Document the linearisation point in a comment on each method. Future readers will ask.
- Do not mix lock-free and locked operations on the same structure. It almost always breaks.

---

## Product Use / Feature

- A high-throughput metrics counter for a request handler — `atomic.Int64`, lock-free.
- A work queue between a single goroutine that pulls TCP frames and a worker pool — MS-queue or a channel; channels usually win for ergonomics.
- A reusable pool of byte buffers — `sync.Pool` (internally lock-free per-P).
- A lock-free LRU eviction list — Harris list with mark bits, used by some caches.

In application code, the right answer is almost always "use a channel" or "use a mutex." Lock-free shows up when you are writing infrastructure: a scheduler, a database storage engine, a high-frequency trading order book, a kernel module.

---

## Error Handling

Lock-free data structures themselves do not return errors. They return `(value, ok)` pairs for "is the structure empty?" and panic only on programmer errors (passing a `nil` queue, for example).

What you must handle externally:

- **Empty/full conditions.** A `Pop` from an empty stack must report empty without panicking.
- **Caller cancellation.** Lock-free ops are non-blocking; you do not wait. If the structure is empty, you decide what to do.
- **Shutdown.** No active "close" exists for these structures. Shutdown is coordinated by the caller, often by setting a flag and draining.

---

## Security Considerations

- **Denial-of-service via contention.** A malicious goroutine can spin pushing/popping at full speed and starve nothing — that is exactly the point of lock-free — but it can burn CPU and inflate cache traffic. Rate-limit untrusted producers.
- **Information leak via timing.** Lock-free retries have data-dependent timings. In cryptographic code, prefer constant-time primitives, not lock-free containers.
- **Unbounded growth.** A `Stack` or `Queue` with no capacity check can grow until OOM. Cap them if untrusted parties can push.
- **GC pressure.** Each Push allocates a node. At a million ops/sec this is real GC pressure. Pool nodes or use a bounded ring buffer.

---

## Performance Tips

- **Measure first.** A `sync.Mutex` benchmark may already saturate your throughput budget.
- **Use atomic types.** `atomic.Int64`, `atomic.Pointer[T]` are typed and pleasant. Avoid raw `unsafe.Pointer` unless you need it.
- **Pad to avoid false sharing.** When two atomic fields are hammered by different cores, place them on separate cache lines (64-byte padding). The MS-queue's `head` and `tail` are classic culprits.
- **Use bounded structures where possible.** Ring buffers avoid allocations.
- **Batch.** Push N nodes at once; pop N nodes at once. Lock-free overhead amortises over batches.
- **Avoid hot single-pointer contention.** A single global head pointer is the scalability ceiling. Shard or partition.

---

## Best Practices

- Prefer channels, mutexes, and `sync.Map` for application code.
- Reach for lock-free only when you have measured contention as the bottleneck.
- Always run `go test -race`. Always.
- Document the invariants of your structure in a comment block. Other engineers will reformulate the algorithm in their heads while reading.
- Write stress tests with many goroutines and many iterations. Single-threaded tests prove nothing.
- Read the original papers. Treiber, Michael-Scott, Harris, Vyukov, Click. They are short and clear.

---

## Edge Cases & Pitfalls

- **Empty stack/queue.** A `Pop` from an empty Treiber stack returns `(zero, false)`. From an empty MS-queue it does too — but the check is more delicate because the structure always contains the dummy.
- **Single-element queue.** When `head == tail` but `head.next != nil`, an enqueue is half-finished. Helpers must advance the tail.
- **Sole consumer.** If you have one consumer and one producer, an SPSC ring buffer is almost always the right answer.
- **Stale tail in MS-queue.** A tail pointer can lag the actual tail for a brief window. Algorithms must accept and repair this.
- **Hash table resizing.** Lock-free resize is significantly harder than lock-free insert. Use a fixed-capacity table or accept a global resize lock.

---

## Common Mistakes

### Reading the value after CAS, not before
```go
// WRONG
if q.head.CompareAndSwap(head, next) {
    return next.value, true // next may have been reused
}
// RIGHT
v := next.value
if q.head.CompareAndSwap(head, next) {
    return v, true
}
```

### Mixing atomic and non-atomic access
```go
// WRONG
n := head      // non-atomic read
head = newHead // non-atomic write
// RIGHT
head.Load() / head.Store(...) / head.CompareAndSwap(...)
```

### Forgetting to re-read after a load
A naive implementation reads `head` once and uses it across many steps. By the time you act, `head` may have changed. Re-read inside the loop body when in doubt.

### "Helping" with the wrong CAS
In the MS-queue, when helping advance the tail, you must CAS `tail` from the *observed* lagging value to its *observed* successor. CASing from `nil` or some other value is a bug.

### Treating lock-free as "no synchronisation needed"
Lock-free still needs atomics. Lock-free does *not* mean lock-free of memory operations — it means lock-free of mutexes.

---

## Common Misconceptions

### "Lock-free means no atomic operations"
False. Lock-free means no mutual exclusion; it always uses atomic ops under the hood.

### "Lock-free means faster"
Often false. Mutex contention is well-tuned in modern runtimes. Lock-free wins on latency consistency, not throughput.

### "Go's GC eliminates ABA"
Partly true. The GC eliminates the *pointer reuse* form of ABA (a freed node is not reissued). It does not eliminate ABA on integers, indices, or generation counters.

### "I can swap a mutex out for a CAS loop"
Almost never. The semantics differ; the failure modes differ; the testing burden differs. Refactor by changing the data structure, not by replacing locks one by one.

### "Wait-free is just lock-free done better"
False. Wait-free is a strictly stronger guarantee and almost always more expensive. Most production lock-free code is lock-free, not wait-free.

---

## Tricky Points

- A `Load` followed by a `CompareAndSwap` is not atomic across the two ops. Something can happen between them. The CAS validates that the field is still the loaded value, which is what gives you correctness.
- `atomic.Pointer[T].CompareAndSwap` compares pointer values (addresses), not pointed-to values. Two distinct nodes with equal contents will not compare equal.
- A Treiber stack allocates one node per push. Heavy push/pop traffic creates GC pressure. A bounded structure avoids this.
- Range-over-channel and lock-free queue look similar from the outside but compose very differently with `select`, `context`, and backpressure.
- "Lock-free" applies to one structure in isolation. Two lock-free structures used together do not give you lock-free transactions.

---

## Test

How to test a lock-free data structure:

1. **Unit tests** for single-threaded correctness — push N, pop N, verify FIFO/LIFO order.
2. **Stress tests** with N producers and M consumers, total ops counted, verify no value lost or duplicated.
3. **Race detector**: `go test -race`. Any data race is a bug.
4. **Linearizability checker**: tools like `porcupine` (Go port) replay traces and confirm a serial history exists.
5. **Long soak**: run the stress test for minutes. ABA-like bugs surface only after many cycles.
6. **Fuzz the API**: random sequences of push/pop and assert invariants.

A clean `go test -race -count=100` is necessary but not sufficient. Lock-free bugs hide under specific schedules.

---

## Tricky Questions

**Q: Why does the MS-queue need a dummy node?**
A: To avoid two complex edge cases: (1) an empty queue where head and tail both must be nil, breaking many invariants; (2) the race between dequeuing the last element and a concurrent enqueue. The dummy makes `head != nil` always true and lets enqueue and dequeue act on `head.next` rather than `head` directly.

**Q: Why two CASes per enqueue?**
A: One to link the new node, one to advance the tail. They cannot be combined into a single atomic step on a non-DWCAS machine. The second one is allowed to "fail" because a later operation will repair it.

**Q: What happens if a thread dies between the two CASes?**
A: The tail lags by one. The next enqueuer notices `tail.next != nil`, helps advance the tail, and continues. The structure remains correct. This is the lock-free progress guarantee.

**Q: Can I make Treiber's stack wait-free?**
A: Not trivially. Wait-free stacks exist (Kogan-Petrank) but are significantly more complex. The classic Treiber stack is lock-free, not wait-free.

**Q: Is `sync.Map` lock-free?**
A: Partly. Its read path is lock-free (atomic load of a read-only map). Its write path takes a mutex. Calling it "lock-free" is a stretch; "mostly lock-free reads" is accurate.

---

## Cheat Sheet

| Data structure | Operations | Mechanism | Lock-free? | Wait-free? |
|---|---|---|---|---|
| `atomic.Int64` counter | Add, Load | Single atomic op | Yes | Yes |
| Treiber stack | Push, Pop | CAS on head | Yes | No |
| MS-queue | Enqueue, Dequeue | Two CASes per op | Yes | No |
| Harris list | Insert, Delete | CAS + mark bit | Yes | No |
| SPSC ring buffer | Push, Pop | Atomic indices | Yes | Yes (in isolation) |
| Vyukov MPMC queue | Push, Pop | CAS on per-slot seq | Yes | No |
| Click hash map | Get, Put | Per-slot CAS | Yes | No |

---

## Self-Assessment Checklist

- I can write a Treiber stack from memory and explain every line.
- I can write a Michael-Scott queue from memory and explain the two CASes and the helping step.
- I know what the dummy node is for in the MS-queue.
- I can explain why Go's GC partially insulates these designs from ABA.
- I know that lock-free does not automatically mean faster.
- I can name three real-world places lock-free is worth the cost (schedulers, GC, signal handlers).
- I can name three places where a mutex is the right choice.
- I have run `go test -race` on a lock-free data structure I wrote.

---

## Summary

A lock-free data structure makes per-operation progress without using mutual exclusion. The progress guarantee is the heart of the definition: under any thread schedule, *some* thread always makes progress. The textbook designs — Treiber's stack, Michael-Scott's queue, Harris's list — fit on a single page each and rest on `CompareAndSwap`.

In Go, the garbage collector hides one of the worst pitfalls (memory reclamation), so the algorithms are cleaner than in C++. The CAS loop is the shared pattern: read, compute, commit, retry. The MS-queue adds two more patterns: dummy node and helping. SPSC ring buffers are wait-free and the right answer when you have a single producer and a single consumer.

The honest critique: lock-free is rarely the right default. Mutexes in Go are fast and well-understood. Channels handle the common producer-consumer cases ergonomically. Lock-free is the tool you reach for when you have measured contention as a bottleneck, when the workload has a stable hot path, and when you can afford the testing burden.

---

## What You Can Build

After this file, you can build:

- A concurrent stack of integers used as a free-list for a memory pool
- A concurrent FIFO queue feeding a worker pool
- A high-throughput request counter and metric aggregator
- A bounded ring buffer between two cooperating goroutines
- A simple lock-free task scheduler with one global queue (then realise it does not scale, and split into per-CPU queues)

You cannot yet build:

- A lock-free hash map (senior)
- A lock-free skip list (senior)
- A lock-free LRU cache (senior; needs the Harris list)
- A wait-free anything (a different topic entirely)

---

## Further Reading

- R. K. Treiber. *Systems Programming: Coping with Parallelism.* IBM Almaden Research, RJ 5118, 1986. The original Treiber stack note.
- M. Michael and M. Scott. *Simple, Fast, and Practical Non-Blocking and Blocking Concurrent Queue Algorithms.* PODC 1996. The MS-queue paper.
- T. Harris. *A Pragmatic Implementation of Non-Blocking Linked-Lists.* DISC 2001. The Harris list with mark bits.
- M. Herlihy and N. Shavit. *The Art of Multiprocessor Programming.* 2nd ed., MK 2020. Chapters 9–12 cover lock-free containers in depth.
- D. Lea. *The java.util.concurrent Synchronizer Framework.* PPPJ 2005. JVM perspective, useful for context.
- D. Vyukov. *Bounded MPMC Queue.* https://www.1024cores.net/. A canonical MPMC design.

---

## Related Topics

- [01-cas-algorithms](../01-cas-algorithms/) — The CAS primitive every structure here uses
- [02-aba-problem](../02-aba-problem/) — The classic CAS pitfall
- [04-memory-fences](../04-memory-fences/) — Memory ordering details
- [05-lock-free-vs-wait-free](../05-lock-free-vs-wait-free/) — Progress hierarchy
- [03-sync-package/07-atomic](../../03-sync-package/07-atomic/) — Go's atomic types
- [04-channels](../../04-channels/) — Channels often replace what lock-free queues attempt

---

## Diagrams & Visual Aids

### Treiber stack push

```
Before:  head -> A -> B -> C -> nil

Step 1: read top = A
Step 2: new node n with n.next = A
Step 3: CAS head: A -> n

After:   head -> n -> A -> B -> C -> nil
```

### MS-queue enqueue

```
Before:  head -> D -> A -> B -> C <- tail   (D is the dummy)

Step 1: read tail = C, next = C.next = nil
Step 2: CAS C.next: nil -> n      (link new node)
Step 3: CAS tail: C -> n          (advance tail)

After:   head -> D -> A -> B -> C -> n <- tail
```

If a thread reads tail = C but is suspended after step 2 and before step 3, the next enqueuer sees C.next = n (non-nil) and helps:

```
Helper: CAS tail: C -> n
```

### SPSC ring buffer state

```
buf:  [_, _, _, _, _, _, _, _]  capacity = 8
head ^                          consumer takes from here
tail ^                          producer puts here

After 3 pushes:
buf:  [a, b, c, _, _, _, _, _]
head ^
tail          ^

After 2 pops:
buf:  [a, b, c, _, _, _, _, _]   (a and b still in array, but logically gone)
head       ^
tail          ^
```

Indices wrap with `index & mask` when `mask = capacity - 1` and capacity is a power of two.

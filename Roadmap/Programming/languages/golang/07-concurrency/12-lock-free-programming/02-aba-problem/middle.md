# The ABA Problem — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Why Go GC Mitigates Pointer ABA](#why-go-gc-mitigates-pointer-aba)
3. [Where ABA Still Strikes in Go](#where-aba-still-strikes-in-go)
4. [Tagged-Pointer Stack — Production Walkthrough](#tagged-pointer-stack--production-walkthrough)
5. [Generation Counter Idioms](#generation-counter-idioms)
6. [ABA in Ring Buffers and Bounded Queues](#aba-in-ring-buffers-and-bounded-queues)
7. [`sync.Pool` Reuse Patterns](#syncpool-reuse-patterns)
8. [Interaction with `atomic.Pointer[T]`](#interaction-with-atomicpointert)
9. [ABA in Reference Counting](#aba-in-reference-counting)
10. [Diagnosing ABA in Existing Code](#diagnosing-aba-in-existing-code)
11. [Trade-offs of Each Mitigation](#trade-offs-of-each-mitigation)
12. [Summary](#summary)

---

## Introduction

At the middle level you are no longer just spotting ABA in textbook examples — you are choosing mitigations for real Go code and explaining the trade-offs to a team. The goal of this file is to move you from "I see ABA when someone points it out" to "I see ABA in a code review and can recommend the cheapest correct fix."

Two facts dominate this level:

1. Go's garbage collector silently eliminates the C/C++ flavour of ABA, and any conversation about ABA in Go has to start with this fact.
2. The GC does *not* eliminate value-level ABA, nor does it protect any structure that recycles objects through `sync.Pool` or a custom free list. Once you cross that line, the C-style problem returns, and you need C-style mitigations.

We will spend most of this file in the second region: where Go's defaults stop helping and you must do real work. We will build a production-shaped tagged-pointer stack, explain why each design choice matters, and survey the other places ABA hides.

---

## Why Go GC Mitigates Pointer ABA

In Go, the garbage collector tracks every reachable allocation. A pointer is reachable if any goroutine has it in a stack frame, register, global, or live heap structure. While the pointer is reachable, the GC will not reuse that memory for a new allocation. This single property eliminates the textbook ABA from C: in C, `free` plus `malloc` can hand a freshly-allocated object the same address as a recently-freed one, and a thread holding the old address gets fooled.

```go
func (s *Stack) Pop() (int, bool) {
    for {
        top := s.head.Load()       // local variable holds *Node A
        if top == nil {
            return 0, false
        }
        next := top.next            // dereferences A safely; A is GC-pinned
        if s.head.CompareAndSwap(top, next) {
            return top.value, true
        }
    }
}
```

The local `top` is a GC root for as long as the function is on the goroutine's stack. While T1 sits in this loop with `top` referencing A, no other goroutine can produce a `*Node` with A's address bits *for a different object*. Therefore the CAS comparison "is the head still bit-pattern A?" is equivalent to "is the head still the same logical object I observed?". Bit equality implies state equality. ABA is impossible.

This is a striking property. It means that all the classical literature on lock-free stacks, queues, and lists — most of which spends pages on memory reclamation — can in Go be ignored as long as the code does not opt out of the GC. The textbook ABA example, transliterated into Go, simply does not exhibit the bug. Beginners often translate C lock-free code, see no ABA, and conclude their CAS knowledge transfers; experts know that the *language*, not the algorithm, made the difference.

A second consequence: in Go, the GC effectively *is* an over-engineered hazard-pointer scheme. Every reference acts as an implicit hazard pointer. The cost — STW pauses, write barriers, marking overhead — is the price you pay for not having to write explicit hazard pointers. For 95% of Go code, that is a great trade.

---

## Where ABA Still Strikes in Go

The 5% that opts out of GC protection covers a surprising amount of real code.

### `sync.Pool` and custom free lists

A `sync.Pool` exists precisely to give you the same `*Node` back. From the algorithm's perspective, this is identical to `free` plus `malloc` in C: the address is reused, the surrounding state has changed, and CAS bit-comparison no longer implies state equality. Any CAS-protected linked structure that returns nodes to a pool reintroduces ABA in full strength.

```go
// Vulnerable: returns popped nodes to a pool.
func (s *Stack) Pop() (int, bool) {
    for {
        top := s.head.Load()
        if top == nil {
            return 0, false
        }
        next := top.next
        if s.head.CompareAndSwap(top, next) {
            v := top.value
            top.next = nil
            nodePool.Put(top) // <-- the moment ABA risk reappears
            return v, true
        }
    }
}
```

The instant `top` is `Put` back, another goroutine can `Get` it, mutate it, push it. T2's view of "the head is `top`" is no longer linked to T1's intent.

### Integer indices

Indices into an array, a ring buffer, or a sharded table are plain integers. The GC has no opinion on them. If you CAS on an index value, you must defend against the value returning to an earlier number.

A 64-bit monotonic index that never wraps is, in practice, safe: 2^64 increments at 1 ns each take 585 years. But beware of designs that *deliberately* wrap (modulo the buffer size), or that use 32-bit indices, or that re-use slot identifiers.

### Generation counters that wrap

If you mitigated ABA with a `uint32` counter, you only deferred the problem. Two billion increments in a long-running service is achievable in seconds under heavy load. After wrap-around, the same `(pointer, gen)` pair will recur with different surrounding state, and ABA returns. Use `uint64` unless you have a hard reason not to.

### Recycled slot semantics

Some lock-free designs deliberately reuse slots (think MPMC ring buffer). The slot identity is intentionally non-unique across time. These designs must encode an "epoch" or "sequence number" *per slot* so consumers can distinguish slot reuse from no-change.

---

## Tagged-Pointer Stack — Production Walkthrough

We now build a production-shaped tagged-pointer stack in Go. The design encapsulates head and generation in an immutable wrapper, CAS-swaps the wrapper, and increments the counter on every modification.

```go
package lfstack

import "sync/atomic"

type Node struct {
    value any
    next  *Node
}

// versioned is immutable once published. To "modify" the stack, allocate a
// new versioned with the new head and gen+1, then CAS-swap the pointer.
type versioned struct {
    head *Node
    gen  uint64
}

// Stack is a lock-free LIFO with ABA protection via generation counter.
type Stack struct {
    state atomic.Pointer[versioned]
}

func NewStack() *Stack {
    s := &Stack{}
    s.state.Store(&versioned{})
    return s
}

func (s *Stack) Push(v any) {
    n := &Node{value: v}
    for {
        old := s.state.Load()
        n.next = old.head
        next := &versioned{head: n, gen: old.gen + 1}
        if s.state.CompareAndSwap(old, next) {
            return
        }
    }
}

func (s *Stack) Pop() (any, bool) {
    for {
        old := s.state.Load()
        if old.head == nil {
            return nil, false
        }
        next := &versioned{head: old.head.next, gen: old.gen + 1}
        if s.state.CompareAndSwap(old, next) {
            return old.head.value, true
        }
    }
}

func (s *Stack) Len() int {
    n := 0
    for cur := s.state.Load().head; cur != nil; cur = cur.next {
        n++
    }
    return n
}
```

### Why this works

The CAS compares `*versioned`, which is itself a pointer. Two `*versioned` values are equal if and only if they refer to the same wrapper allocation. As soon as any goroutine modifies the stack, it produces a fresh wrapper with `gen+1`, so even if the underlying head pointer is the same (a re-pushed node, say) the wrapper pointer is different. CAS detects the change.

The wrapper itself is immutable. Once `s.state.Store(w)` is published, no goroutine modifies `w.head` or `w.gen`. To mutate the stack, you publish a new wrapper. This invariant — wrapper immutability after publication — is the load-bearing detail. Violating it (e.g., bumping `gen` in place to "save an allocation") reintroduces races and likely ABA.

### Allocation cost

Each modification allocates one `versioned` (16 bytes on 64-bit) plus, on `Push`, one `Node`. Under typical Go workloads this is acceptable; under extreme throughput it can be a bottleneck. We will see allocation-free variants at the senior and professional levels, using `unsafe` and packed 128-bit atomics.

### Why we do not just bump a separate `atomic.Uint64`

A common temptation:

```go
// BROKEN — two separate atomics are not jointly atomic
head atomic.Pointer[Node]
gen  atomic.Uint64
```

You cannot bump `head` and `gen` atomically without DCAS. Even with carefully ordered `Load`s and `Store`s, another goroutine can observe an inconsistent `(head, gen)` snapshot. The whole point of the wrapper is that the two fields are jointly atomic via a single pointer swap.

### Why we do not pack the generation into low bits of the pointer

Go pointers are 64-bit, but only the low 48 (or 52) bits are meaningful on most x86-64 and ARMv8 systems. You could in principle steal the high bits for a generation counter using `uintptr`. Two reasons to avoid this in idiomatic Go:

- **Garbage collector hostility.** A `uintptr` is not a pointer to the GC. If the only reference to the heap-allocated node is via a `uintptr` with stolen bits, the GC may collect the node. You must keep an honest `*Node` alive elsewhere.
- **Portability.** Stolen-bit pointer tricks depend on architecture conventions. ARM `MTE` (memory tagging) and `top-byte-ignore` make this fragile.

The wrapper pattern pays one allocation per modification but is portable, GC-friendly, and obviously correct.

---

## Generation Counter Idioms

### Always increment, never compare

The counter exists to *force* CAS failure on intervening modifications. Increment on every successful CAS, even if the visible state did not change. If you skip the increment on no-ops (an empty pop, say), two no-ops at different times produce indistinguishable wrappers, and a slow CAS in between can succeed unexpectedly.

### Width matters

`uint64` is the safe default. `uint32` is tempting for cache reasons but exposes the design to wrap-around. In a service that performs 10^9 ops per second, a 32-bit counter wraps in 4 seconds. After wrap-around, the protection lapses for any thread that has been paused longer than 4 seconds. Set `uint32` aside unless you have measured a real benefit and proven wrap-around is impossible.

### Monotonicity is necessary, not sufficient

A monotone counter is necessary because CAS expects equality (an old generation cannot equal a new one). But monotonicity alone does not guarantee uniqueness across the lifetime of the system. With `uint64`, you have effective uniqueness; with `uint32`, you do not.

### Per-structure vs global counters

Generation counters live with the structure they protect. Do not share one counter across multiple stacks or maps. The protection is local: it says "this particular CAS-ed location has been bumped N times." A global counter wastes contention on unrelated bumps.

---

## ABA in Ring Buffers and Bounded Queues

A classic example: a single-producer, single-consumer ring buffer indexed by 64-bit `head` (consumer) and `tail` (producer). Each slot in the array is reused as the producer wraps around. Slot reuse is intentional, so we cannot rely on pointer identity; we need a per-slot sequence number.

Vyukov's MPMC queue uses exactly this technique. Each slot stores a sequence number; producers and consumers compare the sequence against their expected value, and the CAS that updates the slot also publishes the next sequence. The sequence number serves the same role as a generation counter: it distinguishes "slot reused N times ago" from "slot reused N+1 times ago."

```go
type slot struct {
    seq atomic.Uint64
    val any
}

type Queue struct {
    mask  uint64
    head  atomic.Uint64
    tail  atomic.Uint64
    slots []slot
}

func (q *Queue) Enqueue(v any) bool {
    for {
        pos := q.tail.Load()
        s := &q.slots[pos&q.mask]
        seq := s.seq.Load()
        diff := int64(seq) - int64(pos)
        switch {
        case diff == 0:
            if q.tail.CompareAndSwap(pos, pos+1) {
                s.val = v
                s.seq.Store(pos + 1)
                return true
            }
        case diff < 0:
            return false // queue full
        default:
            // another producer claimed this slot; retry
        }
    }
}
```

The pattern above is correct because each slot's sequence number ratchets monotonically. A slot at position `pos` only accepts a producer that expects `seq == pos`; after the producer publishes, the slot's `seq` becomes `pos+1`, then `pos+capacity` after the consumer reads, and so on. No two cycles of slot reuse have the same `seq`. ABA on slot identity is prevented.

---

## `sync.Pool` Reuse Patterns

If you absolutely must use `sync.Pool` with a CAS-protected linked structure, the cleanest discipline is:

1. **Never return a node to the pool while it could still be visible to another goroutine.** This is hard to enforce.
2. **Use a hazard-pointer scheme around the pool.** Before `Put`, scan for any in-flight reader holding the pointer; defer the `Put` until safe.
3. **Defer reuse through a quiescent period.** Accumulate retired nodes in a per-goroutine batch and `Put` them only after the next major event (a flush, a tick).

In practice, the answer is usually "do not pool nodes of a CAS-protected structure." Allocate fresh nodes, let the GC collect them. The allocation cost is usually less than the cost of the bug.

If you are pooling for cache-line locality rather than allocation cost, consider a slab allocator pattern: a contiguous slice of nodes that you never return individually. The slab is dropped wholesale when the structure is destroyed.

---

## Interaction with `atomic.Pointer[T]`

`atomic.Pointer[T]` is the right tool for CAS on pointers in modern Go (1.19+). It interacts with the GC in two important ways:

- **Stored pointers are GC roots.** While a value is stored, the referenced object is kept alive. This is the property we rely on for default ABA safety.
- **Read pointers participate in write barriers.** When you `Load` and assign to a heap location (a struct field, for example), the GC's write barrier observes the new reference. This is invisible to your code but matters when you reason about correctness under GC.

A subtle consequence: if you `Load` a pointer into a local variable and store it nowhere else, the GC still sees it (the local is a root on the goroutine stack). The pointer is safe until the local goes out of scope.

`atomic.Pointer[T]` does not, however, give you any tagged-pointer support. To bundle a generation counter, you must wrap. The cost is the allocation we discussed above. Future versions of Go may expose a wider atomic for tagged pointers; today, the wrapper is the idiom.

---

## ABA in Reference Counting

Lock-free reference counting is full of ABA-class bugs. The classic scenario:

- An object has refcount 2.
- T1 plans to decrement: read 2, intend to CAS to 1.
- T2 decrements (CAS 2 → 1). T3 also touches the object, bumping back to 2 (CAS 1 → 2).
- T1 resumes, sees 2, CAS succeeds to 1 — but T2's decrement and T3's increment have already happened, so the count is wrong by one.

In Go, this scenario is rare because the GC handles object lifetime; reference counting is typically not needed. When it is needed (interfacing with foreign memory, for instance), the same mitigations apply: pair the count with a generation, or use a dedicated `atomic.AddInt64` with delta semantics so the CAS is not value-based.

`atomic.AddInt64` is essentially immune to ABA because it applies a delta, not a target value. The instruction internally does whatever is needed to add atomically; it does not say "if current is X, set to X+1." It says "add 1, return the result." For pure refcounts, prefer delta operations to CAS.

---

## Diagnosing ABA in Existing Code

Telltale signs in a code review:

- **A CAS loop on `atomic.Pointer[T]` where the pointed-to type can be recycled.** Check for `sync.Pool`, custom free lists, or any explicit reuse.
- **A CAS on `atomic.Uint64` interpreted as a slot index or generation.** Ask: can this value return to an earlier number?
- **A "version" field that is sometimes incremented and sometimes not.** Missed increments produce ABA-shaped bugs.
- **`unsafe.Pointer` arithmetic to pack bits.** Most attempts to fake DCAS in Go are wrong.
- **Comments that say "this is fine because the pointer is unique" without explaining why.** Often the GC argument is being invoked unwittingly; ask whether it actually holds.

A practical diagnostic: stress-test the structure with `GOMAXPROCS=N` for `N` in `{1, 2, 4, 16}` and observe whether invariants (length, multiset of contents) hold. ABA bugs typically manifest as nondeterministic invariant violations.

---

## Trade-offs of Each Mitigation

| Mitigation | Throughput vs mutex | Memory cost | Code complexity | When to choose |
|------------|--------------------:|------------:|----------------:|----------------|
| GC-only (no pool) | 1.5–3x | extra GC pressure | trivial | default |
| Tagged wrapper | 1.2–2.5x | +16 B per modification | low | most lock-free Go |
| DCAS (via cgo/asm) | 1.5–3x | none extra | high | extreme throughput |
| Hazard pointers | 1.3–2x | bounded slab | high | bounded memory needed |
| Epoch / RCU | 1.5–3x (read-heavy) | unbounded retire queue | high | read-heavy workloads |
| `sync.Mutex` | baseline | none | trivial | always a valid choice |

Numbers vary wildly by workload, contention, and hardware. The point of the table is the *ordering* — and that mutexes are not automatically the slowest option.

---

## Summary

In Go, the garbage collector silently eliminates the most common ABA scenario: pointer reuse after free. For pure-pointer lock-free structures that allocate fresh nodes, the textbook ABA does not occur. Beginners can write a "correct-looking" lock-free stack and never see a bug, because Go made it correct for them. The moment you reach for `sync.Pool`, integer indices, or generation counters that wrap, the GC's protection lifts and ABA returns in full strength.

For most production Go code, the tagged-pointer wrapper pattern — an immutable `(head, gen)` struct swapped via `atomic.Pointer` — gives ABA safety at one allocation per modification. For workloads where that cost is unacceptable, hazard pointers and epoch-based reclamation are the next stops, covered at the senior level. For everything else, a mutex is a fine choice; lock-free is not free.

The middle-level mental model is: identify every CAS, identify what it compares, ask whether that value can round-trip, and pick the cheapest mitigation that closes the loop. Tagged wrappers are the workhorse. The GC is the silent partner. Hazard pointers and EBR wait for the harder cases at senior level.

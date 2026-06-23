# The ABA Problem — Hands-On Tasks

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Task 1 — Reproduce ABA in a Vulnerable Stack](#task-1--reproduce-aba-in-a-vulnerable-stack)
3. [Task 2 — Tagged-Wrapper Stack](#task-2--tagged-wrapper-stack)
4. [Task 3 — Generation Counter on a Counter Field](#task-3--generation-counter-on-a-counter-field)
5. [Task 4 — Vyukov MPMC Queue Walk-Through](#task-4--vyukov-mpmc-queue-walk-through)
6. [Task 5 — Minimal Hazard Pointer Implementation](#task-5--minimal-hazard-pointer-implementation)
7. [Task 6 — EBR Implementation](#task-6--ebr-implementation)
8. [Task 7 — Linearizability Check with Porcupine](#task-7--linearizability-check-with-porcupine)
9. [Task 8 — DWCAS via Assembly](#task-8--dwcas-via-assembly)
10. [Task 9 — Refcount with Hazard-Pointer Protection](#task-9--refcount-with-hazard-pointer-protection)
11. [Task 10 — End-to-End Lock-Free Cache](#task-10--end-to-end-lock-free-cache)
12. [Self-Check Answers](#self-check-answers)

---

## How to Use This File

Each task is a small, runnable exercise. Read the goal, write the code, run the included tests, and check your work against the discussion section. The tasks build on each other; do them in order if you are learning, or pick targeted ones if you are reviewing.

Setup:

```
mkdir aba-tasks && cd aba-tasks
go mod init aba-tasks
```

Go 1.22 or later assumed. All tasks use only `sync/atomic`, `sync`, `runtime`, and `unsafe` where noted.

A common test harness:

```go
package main

import (
    "runtime"
    "sync"
    "testing"
)

func StressN(b *testing.B, workers int, op func(workerID int)) {
    b.ResetTimer()
    var wg sync.WaitGroup
    for w := 0; w < workers; w++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for i := 0; i < b.N/workers; i++ {
                op(id)
            }
        }(w)
    }
    wg.Wait()
    runtime.GC()
}
```

This harness drives N goroutines, each performing `b.N/workers` operations. We will reuse it.

---

## Task 1 — Reproduce ABA in a Vulnerable Stack

**Goal.** Write a stack that uses `sync.Pool` for nodes, then construct an interleaving that causes the abstract invariant (multiset of values) to break.

**Code.**

```go
package main

import (
    "sync"
    "sync/atomic"
)

type Node struct {
    value int
    next  *Node
}

var pool = sync.Pool{New: func() any { return &Node{} }}

type VulnStack struct {
    head atomic.Pointer[Node]
}

func (s *VulnStack) Push(v int) {
    n := pool.Get().(*Node)
    n.value = v
    for {
        old := s.head.Load()
        n.next = old
        if s.head.CompareAndSwap(old, n) {
            return
        }
    }
}

func (s *VulnStack) Pop() (int, bool) {
    for {
        top := s.head.Load()
        if top == nil {
            return 0, false
        }
        next := top.next
        if s.head.CompareAndSwap(top, next) {
            v := top.value
            top.next = nil
            pool.Put(top)
            return v, true
        }
    }
}
```

**Stress test.**

```go
func TestVulnStack_Invariant(t *testing.T) {
    s := &VulnStack{}
    const N = 1_000_000
    const W = 16
    runtime.GOMAXPROCS(W)

    pushed := make([]int64, W)
    popped := make([]int64, W)

    var wg sync.WaitGroup
    for w := 0; w < W; w++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for i := 0; i < N/W; i++ {
                if i&1 == 0 {
                    s.Push(id*N + i)
                    atomic.AddInt64(&pushed[id], 1)
                } else {
                    if _, ok := s.Pop(); ok {
                        atomic.AddInt64(&popped[id], 1)
                    }
                }
            }
        }(w)
    }
    wg.Wait()

    var totalPushed, totalPopped int64
    for w := 0; w < W; w++ {
        totalPushed += pushed[w]
        totalPopped += popped[w]
    }
    // Drain remaining
    for {
        if _, ok := s.Pop(); !ok {
            break
        }
        totalPopped++
    }
    if totalPushed != totalPopped {
        t.Errorf("push=%d pop=%d (lost or duplicated)", totalPushed, totalPopped)
    }
}
```

**Discussion.** On most runs with `GOMAXPROCS=16` the test will pass — ABA bugs are probabilistic. To reliably observe corruption, instrument the pool to log every `Put`/`Get` and look for a `Get` interleaved with another goroutine's CAS. The bug is rare per operation but cumulative; with `N=1e7` over 16 workers you will sometimes see lost or duplicated values.

Self-check: Why does this stack lose values?
- The `top := s.head.Load()` of one goroutine can race with another goroutine's `Pop` that pools `top`, followed by a `Push` that re-uses the pooled node and links it back. The first goroutine's CAS now succeeds against a recycled `top`, but `top.next` has been overwritten.

---

## Task 2 — Tagged-Wrapper Stack

**Goal.** Replace the vulnerable stack with a tagged-wrapper version and verify the test passes deterministically.

**Code.**

```go
type versioned struct {
    head *Node
    gen  uint64
}

type SafeStack struct {
    state atomic.Pointer[versioned]
}

func NewSafeStack() *SafeStack {
    s := &SafeStack{}
    s.state.Store(&versioned{})
    return s
}

func (s *SafeStack) Push(v int) {
    n := &Node{value: v}
    for {
        old := s.state.Load()
        n.next = old.head
        if s.state.CompareAndSwap(old, &versioned{head: n, gen: old.gen + 1}) {
            return
        }
    }
}

func (s *SafeStack) Pop() (int, bool) {
    for {
        old := s.state.Load()
        if old.head == nil {
            return 0, false
        }
        if s.state.CompareAndSwap(old, &versioned{head: old.head.next, gen: old.gen + 1}) {
            return old.head.value, true
        }
    }
}
```

**Discussion.** Two key differences from Task 1: nodes are not pooled, and the head is wrapped. Either change alone fixes the bug in Go; we apply both for defence in depth.

Self-check: If you remove the generation counter, does the algorithm remain correct in Go?
- Yes. The wrapper pointer identity already prevents ABA via GC pinning. The counter is defensive documentation.

Self-check: What happens if you make the wrapper mutable (bump `gen` in place)?
- Race conditions. Two goroutines could both observe `old.gen = 5` and both attempt to bump it; the CAS would then succeed for one of them but the in-place bump leaks the other's intent. Wrappers must be immutable after publication.

---

## Task 3 — Generation Counter on a Counter Field

**Goal.** Construct a scenario where a `uint32` counter wraps and causes a bug, then fix by widening to `uint64`.

**Code.**

```go
type Cancellable struct {
    gen atomic.Uint32 // BUG: too narrow
    val atomic.Int64
}

func (c *Cancellable) Submit(v int64) uint32 {
    g := c.gen.Add(1)
    c.val.Store(v)
    return g
}

func (c *Cancellable) Cancel(expected uint32) bool {
    return c.gen.CompareAndSwap(expected, expected+1)
}
```

**Stress test.** Submit and cancel in a tight loop for hours. After ~2 billion submissions, `gen` wraps. A latent `Cancel(expected)` where `expected` was recorded before wraparound now succeeds against an unrelated submission.

**Fix.**

```go
type Cancellable struct {
    gen atomic.Uint64 // 64 bits
    val atomic.Int64
}
```

Self-check: How long until `uint32` wraps at 10^9 ops/sec?
- ~4 seconds. Trivial to hit in production load tests.

Self-check: How long until `uint64` wraps at 10^9 ops/sec?
- ~585 years. Effectively never.

---

## Task 4 — Vyukov MPMC Queue Walk-Through

**Goal.** Implement Vyukov's bounded MPMC queue and explain why slot reuse does not cause ABA.

**Code.**

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

func NewQueue(capacity uint64) *Queue {
    if capacity&(capacity-1) != 0 {
        panic("capacity must be power of two")
    }
    q := &Queue{mask: capacity - 1, slots: make([]slot, capacity)}
    for i := range q.slots {
        q.slots[i].seq.Store(uint64(i))
    }
    return q
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
            return false // full
        }
    }
}

func (q *Queue) Dequeue() (any, bool) {
    for {
        pos := q.head.Load()
        s := &q.slots[pos&q.mask]
        seq := s.seq.Load()
        diff := int64(seq) - int64(pos+1)
        switch {
        case diff == 0:
            if q.head.CompareAndSwap(pos, pos+1) {
                v := s.val
                s.val = nil
                s.seq.Store(pos + q.mask + 1)
                return v, true
            }
        case diff < 0:
            return nil, false // empty
        }
    }
}
```

**Discussion.** The per-slot `seq` is a generation counter local to that slot. A producer at position `pos` only writes if `seq == pos`. After writing, the producer sets `seq = pos+1`, which the consumer at `pos` waits for. After the consumer reads, it sets `seq = pos + capacity`, which is the next position that will use this slot.

ABA-freedom: the slot's `seq` monotonically increases by `capacity` per cycle. Two cycles of the same slot have `seq` values `pos` and `pos+capacity`, which differ. Producers and consumers compare `seq` to their expected position; mismatch means "another cycle is in progress" and they spin.

Self-check: Does this design avoid ABA on `head` and `tail`?
- Not entirely on its own. The CAS on `head` (and `tail`) uses 64-bit indices. With `uint64`, monotonic increment never wraps in practice, so S1 from specification.md holds. ABA is structurally impossible.

---

## Task 5 — Minimal Hazard Pointer Implementation

**Goal.** Build a minimal hazard-pointer scheme and use it to make the pooled-node stack from Task 1 ABA-safe.

**Code.** See senior.md for the full `Domain` and `Protect`/`Retire` implementations. Adapt to your test harness:

```go
package main

import (
    "sync"
    "sync/atomic"
    "unsafe"
)

type HazDomain struct {
    slots   []atomic.Pointer[byte]
    mu      sync.Mutex
    retired map[unsafe.Pointer]func()
}

func NewHazDomain(slots int) *HazDomain {
    return &HazDomain{
        slots:   make([]atomic.Pointer[byte], slots),
        retired: make(map[unsafe.Pointer]func()),
    }
}

func (d *HazDomain) Protect(slot int, p unsafe.Pointer) {
    d.slots[slot].Store((*byte)(p))
}

func (d *HazDomain) Clear(slot int) {
    d.slots[slot].Store(nil)
}

func (d *HazDomain) Retire(p unsafe.Pointer, free func()) {
    d.mu.Lock()
    defer d.mu.Unlock()
    d.retired[p] = free
    if len(d.retired) > 2*len(d.slots) {
        d.scanLocked()
    }
}

func (d *HazDomain) scanLocked() {
    hazards := make(map[unsafe.Pointer]struct{})
    for i := range d.slots {
        if p := d.slots[i].Load(); p != nil {
            hazards[unsafe.Pointer(p)] = struct{}{}
        }
    }
    for p, free := range d.retired {
        if _, ok := hazards[p]; !ok {
            free()
            delete(d.retired, p)
        }
    }
}
```

**Use in stack.**

```go
type HazStack struct {
    head atomic.Pointer[Node]
    hp   *HazDomain
}

func (s *HazStack) Pop(slot int) (int, bool) {
    for {
        top := s.head.Load()
        if top == nil {
            return 0, false
        }
        s.hp.Protect(slot, unsafe.Pointer(top))
        if s.head.Load() != top {
            continue
        }
        next := top.next
        if s.head.CompareAndSwap(top, next) {
            v := top.value
            s.hp.Clear(slot)
            s.hp.Retire(unsafe.Pointer(top), func() {
                pool.Put(top)
            })
            return v, true
        }
    }
}
```

**Discussion.** The slot index per goroutine is the awkward part. Production hazard pointer libraries use TLS or runtime hooks. In Go we pass an explicit slot index. For test code, mapping goroutine ID (via `runtime.GoID`, exposed via a hack) to a slot works; for production, manage slots explicitly.

Self-check: Why is the re-read after `Protect` necessary?
- Without it, a freeing thread could finish its scan before the hazard is published, then free the node. The re-read confirms the node was still reachable after the publication, closing the window.

---

## Task 6 — EBR Implementation

**Goal.** Build a minimal EBR and use it for a lock-free linked list.

**Code.** See senior.md for the `Domain` skeleton. Test usage:

```go
type EBRList struct {
    head atomic.Pointer[listNode]
    ebr  *ebr.Domain
}

type listNode struct {
    key  int
    next atomic.Pointer[listNode]
}

func (l *EBRList) Insert(tid int, key int) bool {
    l.ebr.Enter(tid)
    defer l.ebr.Exit(tid)

    n := &listNode{key: key}
    for {
        prev := &l.head
        for {
            cur := prev.Load()
            if cur == nil || cur.key >= key {
                n.next.Store(cur)
                if prev.CompareAndSwap(cur, n) {
                    return true
                }
                break
            }
            if cur.key == key {
                return false
            }
            prev = &cur.next
        }
    }
}

func (l *EBRList) Delete(tid int, key int) bool {
    l.ebr.Enter(tid)
    defer l.ebr.Exit(tid)

    prev := &l.head
    for {
        cur := prev.Load()
        if cur == nil {
            return false
        }
        if cur.key == key {
            next := cur.next.Load()
            if prev.CompareAndSwap(cur, next) {
                l.ebr.Retire(func() { /* GC handles this */ })
                return true
            }
            continue
        }
        if cur.key > key {
            return false
        }
        prev = &cur.next
    }
}
```

**Discussion.** This list uses EBR mostly as documentation in Go because the GC handles reclamation. The point of the exercise is to see the `Enter`/`Exit` pattern and the deferred retirement. In a non-GC environment, the `Retire` callback would call `free(cur)` or `pool.Put(cur)`.

Self-check: What happens if a goroutine forgets to call `Exit`?
- The goroutine's `local_epoch` stays at the entered value. Future calls to `TryAdvance` will not progress, and the retired list grows. Eventually the system runs out of memory.

---

## Task 7 — Linearizability Check with Porcupine

**Goal.** Install `porcupine`, capture an operation log from a stress run, and verify linearizability.

```
go get github.com/anishathalye/porcupine
```

**Code.**

```go
import "github.com/anishathalye/porcupine"

type stackOp struct {
    op    string // "push" or "pop"
    value int
    ok    bool
}

var stackModel = porcupine.Model{
    Init: func() any { return []int{} },
    Step: func(state any, input any, output any) (bool, any) {
        s := state.([]int)
        op := input.(stackOp)
        out := output.(stackOp)
        switch op.op {
        case "push":
            return true, append(s, op.value)
        case "pop":
            if len(s) == 0 {
                return !out.ok, s
            }
            top := s[len(s)-1]
            return out.ok && out.value == top, s[:len(s)-1]
        }
        return false, state
    },
}
```

Record operations during a stress run, feed to `porcupine.CheckOperations`. A non-linearizable history indicates ABA or another concurrency bug.

**Discussion.** This is the most rigorous testing tool for lock-free structures. Use it before shipping. The cost is the runtime overhead of capturing every operation; run it under reduced concurrency in test builds.

---

## Task 8 — DWCAS via Assembly

**Goal.** Implement a 128-bit CAS on amd64 via Go assembly and use it for a tagged-pointer stack without wrapper allocation.

**Code.**

```
// dwcas_amd64.s
#include "textflag.h"

// func cas128(p *uint128, old, new uint128) bool
TEXT ·cas128(SB), NOSPLIT, $0-49
    MOVQ p+0(FP), DI
    MOVQ old_lo+8(FP), AX
    MOVQ old_hi+16(FP), DX
    MOVQ new_lo+24(FP), BX
    MOVQ new_hi+32(FP), CX
    LOCK
    CMPXCHG16B (DI)
    SETEQ ret+40(FP)
    RET
```

```go
type uint128 struct {
    lo, hi uint64
}

//go:noescape
func cas128(p *uint128, old, new uint128) bool
```

**Discussion.** This is the lowest-level option in Go. The assembly stub bypasses the type system; misuse causes crashes. Production code: hide behind a typed package, document carefully, gate with build tags for amd64-only.

Self-check: Why is the alignment of `*uint128` important?
- `CMPXCHG16B` requires 16-byte alignment. A misaligned access raises `#GP` (general protection fault). The Go runtime aligns `uint128` to 16 bytes when allocated; arrays of `uint128` are aligned at the array start but each element follows the alignment of the previous, which is 16 (uint128 is 16 bytes). Verify with `unsafe.Alignof`.

Self-check: Is `CMPXCHG16B` available on all amd64?
- Since Athlon 64 (2003). Almost all production amd64 hardware supports it. Cloud providers (AWS, GCP, Azure) ship hardware that supports it. Verify with `cpuid` if porting to embedded amd64.

---

## Task 9 — Refcount with Hazard-Pointer Protection

**Goal.** Implement a lock-free reference-counted object with the "weak fetch-add" idiom.

**Code.**

```go
type RefCounted struct {
    refs atomic.Int32
    payload any
}

type Holder struct {
    ptr atomic.Pointer[RefCounted]
    hp  *HazDomain
}

func (h *Holder) Acquire(slot int) *RefCounted {
    for {
        p := h.ptr.Load()
        if p == nil {
            return nil
        }
        h.hp.Protect(slot, unsafe.Pointer(p))
        if h.ptr.Load() != p {
            continue
        }
        // Hazard published; p cannot be freed
        for {
            n := p.refs.Load()
            if n == 0 {
                h.hp.Clear(slot)
                return nil // p is being destroyed
            }
            if p.refs.CompareAndSwap(n, n+1) {
                h.hp.Clear(slot)
                return p
            }
        }
    }
}

func (p *RefCounted) Release() {
    if p.refs.Add(-1) == 0 {
        // last reference; free p
        // (in Go, just let it become unreachable)
    }
}
```

**Discussion.** The hazard pointer protects the load-then-CAS sequence. Without the hazard, the object could be freed between the load and the CAS, corrupting unrelated memory. With the hazard, the freeing thread observes the publication and defers.

Self-check: Why "weak fetch-add" rather than a plain `refs.Add(1)`?
- Because plain `Add` would succeed even on a zero refcount, resurrecting a dead object. The CAS loop with the `n == 0` check prevents this.

---

## Task 10 — End-to-End Lock-Free Cache

**Goal.** Combine techniques into a lock-free cache with TTL eviction, ABA-safe under high concurrency.

Design:
- Sharded hash table, each shard a CAS-protected linked list.
- TTL eviction via a background goroutine that scans and removes expired entries.
- Entries are reference-counted; readers hold a reference while accessing.

Pseudocode:

```go
type entry struct {
    key      string
    value    any
    expires  time.Time
    refs     atomic.Int32
    next     atomic.Pointer[entry]
}

type Shard struct {
    head atomic.Pointer[entry]
    hp   *HazDomain
}

type Cache struct {
    shards [256]Shard
}

func (c *Cache) Get(key string) (any, bool) {
    s := &c.shards[hash(key)%256]
    slot := goroutineSlot()
    for cur := s.head.Load(); cur != nil; cur = cur.next.Load() {
        s.hp.Protect(slot, unsafe.Pointer(cur))
        if s.head.Load() == nil || /* re-validate */ false {
            continue
        }
        if cur.key == key && time.Now().Before(cur.expires) {
            cur.refs.Add(1)
            v := cur.value
            cur.refs.Add(-1)
            s.hp.Clear(slot)
            return v, true
        }
    }
    s.hp.Clear(slot)
    return nil, false
}
```

This is a sketch. Full implementation is non-trivial; the exercise is to identify all the ABA hazards:
- Per-shard list traversal — hazard pointers on each node.
- Entry refcount — weak fetch-add idiom.
- TTL eviction — must not free entries with non-zero refcount.

**Discussion.** A production-grade lock-free cache (`groupcache`, `bigcache`, `freecache`) handles all of these. The exercise is to see how the pieces fit. Most Go projects use `sync.Map` or a sharded mutex cache; the lock-free variant is justified only for extreme throughput.

---

## Self-Check Answers

### Task 1
The vulnerable stack loses values because `top.next` is read after another goroutine has pooled `top` and a third goroutine has reinitialised it. The CAS succeeds against a recycled `top`, but `top.next` is wrong, so the new head points to garbage and intermediate nodes are lost.

### Task 2
Removing the generation counter is safe in Go (wrapper identity suffices). Making the wrapper mutable introduces races.

### Task 3
At 10^9 ops/sec: `uint32` wraps in 4 seconds; `uint64` wraps in 585 years. Use `uint64`.

### Task 4
Vyukov's design is ABA-free because slot `seq` increases monotonically by `capacity` per cycle, and 64-bit `head`/`tail` indices never wrap in practice.

### Task 5
The re-read closes the publication-race window. Without it, a freeing thread could finish its scan before the hazard is observable.

### Task 6
A goroutine that forgets `Exit` stalls EBR reclamation. Use `defer` to ensure `Exit` is called.

### Task 7
Porcupine catches linearizability violations, which is the formal property ABA bugs typically break.

### Task 8
`CMPXCHG16B` requires 16-byte alignment. Available on all production amd64 hardware since 2003.

### Task 9
Weak fetch-add prevents resurrecting an object whose refcount has reached zero (i.e., is being destroyed).

### Task 10
A lock-free cache combines list-traversal hazards, refcount races, and TTL eviction. Hazard pointers protect dereferences; weak fetch-add protects refcount increments; eviction must check refcount before freeing.

---

These tasks form a complete ABA curriculum. Working through all ten gives you the engineering judgement to evaluate lock-free designs in production. The exercises emphasise breadth (every mitigation technique appears) and depth (each technique is implemented, not just described). At the end, you have working code for every concept in middle.md, senior.md, and professional.md.

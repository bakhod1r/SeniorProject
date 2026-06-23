# The ABA Problem — Find the Bug

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Bug 1 — The Reused Free List](#bug-1--the-reused-free-list)
3. [Bug 2 — The 32-Bit Generation Counter](#bug-2--the-32-bit-generation-counter)
4. [Bug 3 — Two Atomics for One Logical State](#bug-3--two-atomics-for-one-logical-state)
5. [Bug 4 — The Tombstoned Hash Slot](#bug-4--the-tombstoned-hash-slot)
6. [Bug 5 — The Logger That Survived the Pool](#bug-5--the-logger-that-survived-the-pool)
7. [Bug 6 — The Refcount Race](#bug-6--the-refcount-race)
8. [Bug 7 — The Off-By-One Sequence Number](#bug-7--the-off-by-one-sequence-number)
9. [Bug 8 — Hazard Pointer Without Re-Read](#bug-8--hazard-pointer-without-re-read)
10. [Bug 9 — EBR With Forgotten Exit](#bug-9--ebr-with-forgotten-exit)
11. [Bug 10 — Tagged Pointer With In-Place Increment](#bug-10--tagged-pointer-with-in-place-increment)
12. [Bug 11 — `uintptr` Defeating GC](#bug-11--uintptr-defeating-gc)
13. [Bug 12 — DWCAS Misalignment](#bug-12--dwcas-misalignment)
14. [Diagnosing ABA in Real Code](#diagnosing-aba-in-real-code)
15. [Tools and Techniques](#tools-and-techniques)

---

## How to Use This File

Each bug is a short, self-contained code snippet. Read the code, try to find the bug, then read the explanation. Treat them as a code-review exercise. The cumulative effect is a trained eye for ABA-shaped patterns.

The bugs are loosely ordered by subtlety: the first few are obvious once you know to look; the last few require understanding the interaction between Go's runtime and lock-free algorithms.

Conventions:
- All snippets compile (modulo missing imports).
- Some are minor adaptations of real production bugs.
- "Spot the bug" assumes you have read junior.md, middle.md, and senior.md.

---

## Bug 1 — The Reused Free List

```go
package buggy

import (
    "sync"
    "sync/atomic"
)

type Node struct {
    value int
    next  *Node
}

var nodePool = sync.Pool{New: func() any { return &Node{} }}

type Stack struct {
    head atomic.Pointer[Node]
}

func (s *Stack) Push(v int) {
    n := nodePool.Get().(*Node)
    n.value = v
    for {
        old := s.head.Load()
        n.next = old
        if s.head.CompareAndSwap(old, n) {
            return
        }
    }
}

func (s *Stack) Pop() (int, bool) {
    for {
        top := s.head.Load()
        if top == nil {
            return 0, false
        }
        next := top.next
        if s.head.CompareAndSwap(top, next) {
            v := top.value
            nodePool.Put(top)
            return v, true
        }
    }
}
```

**Find the bug.**

**Answer.** Classic pooled-node ABA. The `sync.Pool` defeats Go's GC pinning. A goroutine that holds `top` from `Load` can have `top` recycled by another `Pop` and `Push` before its CAS executes. The CAS may succeed against the recycled `top`, but the new head points to an old `next` that no longer reflects the stack's structure.

**Fix.** Either stop pooling nodes (drop the `sync.Pool`), use a tagged wrapper around the head, or pair with hazard pointers. The simplest fix is dropping the pool; for high-throughput, the wrapper is the next step.

---

## Bug 2 — The 32-Bit Generation Counter

```go
package buggy

import "sync/atomic"

type Cache struct {
    gen atomic.Uint32 // <-- consider this
    m   map[string]int
}

func (c *Cache) Invalidate() {
    c.gen.Add(1)
}

func (c *Cache) Get(key string, expectedGen uint32) (int, bool) {
    if c.gen.Load() != expectedGen {
        return 0, false
    }
    v, ok := c.m[key]
    return v, ok
}
```

**Find the bug.**

**Answer.** `uint32` wraps in seconds under high invalidation rate. A `Get` that recorded `expectedGen = 100` at time T can see `gen == 100` again at time T + 4 seconds (assuming 10^9 invalidations/sec, exaggerated but illustrative). The `Get` thinks the cache is fresh when it has been invalidated 2^32 times.

The map access is also racy in this snippet (a different bug). Focus on the gen for the ABA discussion.

**Fix.** Widen to `uint64`. The cost is 4 extra bytes per cache; the benefit is no wraparound under any realistic load.

---

## Bug 3 — Two Atomics for One Logical State

```go
package buggy

import "sync/atomic"

type Pair struct {
    a atomic.Int64
    b atomic.Int64
}

// SetBoth wants to atomically update both a and b.
func (p *Pair) SetBoth(newA, newB int64, oldA, oldB int64) bool {
    if !p.a.CompareAndSwap(oldA, newA) {
        return false
    }
    if !p.b.CompareAndSwap(oldB, newB) {
        // Roll back a.
        p.a.Store(oldA)
        return false
    }
    return true
}
```

**Find the bug.**

**Answer.** Not strictly ABA, but a closely related concurrency bug: two CAS operations are not jointly atomic. Between the two CASes, another goroutine can observe `(newA, oldB)`, a state that never legitimately existed. Additionally, the rollback `p.a.Store(oldA)` can race with a third goroutine that has already CAS'd `a` past `newA`. The rollback corrupts the state.

This is what DWCAS is for: pack `(a, b)` into 128 bits and CAS atomically. In Go without DWCAS, the answer is to wrap `(a, b)` in a struct and CAS the wrapper pointer.

**Fix.** Use a tagged-wrapper-style struct:

```go
type pair struct{ a, b int64 }
type Pair struct{ state atomic.Pointer[pair] }

func (p *Pair) SetBoth(newA, newB int64, old *pair) bool {
    return p.state.CompareAndSwap(old, &pair{newA, newB})
}
```

---

## Bug 4 — The Tombstoned Hash Slot

```go
package buggy

import "sync/atomic"

const (
    stateEmpty = iota
    stateInserting
    stateOccupied
    stateTombstoned
)

type slot struct {
    state atomic.Int32
    key   atomic.Pointer[string]
    value atomic.Pointer[any]
}

type Table struct {
    slots []slot
}

func (t *Table) Lookup(key string) (any, bool) {
    h := hash(key) % uint64(len(t.slots))
    for i := h; ; i = (i + 1) % uint64(len(t.slots)) {
        s := &t.slots[i]
        st := s.state.Load()
        if st == stateEmpty {
            return nil, false
        }
        if st == stateOccupied {
            if k := s.key.Load(); k != nil && *k == key {
                if v := s.value.Load(); v != nil {
                    return *v, true
                }
            }
        }
    }
}
```

**Find the bug.**

**Answer.** Slot recycling. A slot can transition `OCCUPIED → TOMBSTONED → EMPTY → INSERTING → OCCUPIED` while the lookup is in flight. The lookup may load `state == OCCUPIED` for the new occupant, then load `key` for the new occupant (wrong key, falls through to next probe), missing the recycle. Or it may load `state == EMPTY` for the brief moment between tombstone cleanup and re-insert, and return "not found" for a key that is actually present.

Additionally, the lookup uses three separate atomic loads (`state`, `key`, `value`) which are not jointly atomic. A reader can see torn state.

**Fix.** Add a per-slot generation counter; record the gen at probe start, re-check at probe end. If any probed slot's gen changed, restart. This is the postmortem from professional.md.

---

## Bug 5 — The Logger That Survived the Pool

```go
package buggy

import (
    "sync"
)

type Buffer struct {
    payload []byte
}

var bufPool = sync.Pool{New: func() any { return &Buffer{} }}

type Server struct {
    logQueue chan *Buffer
}

func (s *Server) Handle(req []byte) {
    buf := bufPool.Get().(*Buffer)
    buf.payload = append(buf.payload[:0], req...)

    s.logQueue <- buf // logging goroutine will write this asynchronously

    // ... process request using buf ...
    process(buf)

    bufPool.Put(buf)
}

func (s *Server) logLoop() {
    for buf := range s.logQueue {
        writeToDisk(buf.payload)
    }
}
```

**Find the bug.**

**Answer.** The logging goroutine holds a reference to `buf` via the channel. The handler returns `buf` to the pool. Another handler grabs `buf` from the pool, overwrites `buf.payload`, processes a different request. The logging goroutine, getting around to it, reads the new payload as if it were the original.

This is the "pooled buffer use-after-free" postmortem from professional.md. The bug is invisible to `go test -race` because all accesses are technically race-free (the channel synchronises) — but the logical lifetime is wrong.

**Fix.** Copy `payload` into a private slice before sending to the logger. Or refcount the buffer. The simplest fix:

```go
func (s *Server) Handle(req []byte) {
    buf := bufPool.Get().(*Buffer)
    buf.payload = append(buf.payload[:0], req...)
    s.logQueue <- &Buffer{payload: append([]byte(nil), buf.payload...)}
    process(buf)
    bufPool.Put(buf)
}
```

---

## Bug 6 — The Refcount Race

```go
package buggy

import "sync/atomic"

type Object struct {
    refs    atomic.Int32
    payload any
}

type Handle struct {
    ptr atomic.Pointer[Object]
}

func (h *Handle) Acquire() *Object {
    p := h.ptr.Load()
    if p == nil {
        return nil
    }
    p.refs.Add(1) // <-- consider this
    return p
}

func (h *Handle) Set(p *Object) {
    p.refs.Store(1)
    old := h.ptr.Swap(p)
    if old != nil {
        if old.refs.Add(-1) == 0 {
            // free old
        }
    }
}
```

**Find the bug.**

**Answer.** `Acquire` loads `p`, then calls `p.refs.Add(1)`. Between the load and the add, another goroutine can call `Set` with a new object; the old `p`'s refcount can drop to zero and the freeing logic can run. Then `Acquire`'s `Add(1)` writes to freed memory.

In Go specifically, the GC keeps `p` alive while the local references it, so the write does not corrupt unrelated memory. But the semantic intent is wrong: `Acquire` increments the refcount of a logically-dead object. Subsequent uses may misbehave.

**Fix.** Use the "weak fetch-add" idiom: load, then CAS-increment, refusing to increment from zero.

```go
func (h *Handle) Acquire() *Object {
    for {
        p := h.ptr.Load()
        if p == nil {
            return nil
        }
        n := p.refs.Load()
        if n == 0 {
            return nil
        }
        if p.refs.CompareAndSwap(n, n+1) {
            return p
        }
    }
}
```

Combine with hazard pointers for full safety in non-GC environments.

---

## Bug 7 — The Off-By-One Sequence Number

```go
package buggy

import "sync/atomic"

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

func NewQueue(cap uint64) *Queue {
    q := &Queue{mask: cap - 1, slots: make([]slot, cap)}
    // bug: slots not initialised
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
            return false
        }
    }
}
```

**Find the bug.**

**Answer.** The slots' `seq` are zero-initialised, but the Vyukov protocol requires `seq[i] = i` initially. With all zeros, only `pos = 0` matches. The first `Enqueue` succeeds, the second sees `pos = 1`, `seq = 0`, `diff = -1` (queue full), returns false. The queue thinks it is full when it has one element.

This is not ABA but it is ABA-adjacent: an off-by-one in slot initialisation produces a structurally-broken queue. The lesson is that lock-free designs are sensitive to initialisation invariants.

**Fix.** Initialise:

```go
for i := range q.slots {
    q.slots[i].seq.Store(uint64(i))
}
```

---

## Bug 8 — Hazard Pointer Without Re-Read

```go
package buggy

import (
    "sync/atomic"
    "unsafe"
)

type Node struct {
    value int
    next  *Node
}

type Stack struct {
    head atomic.Pointer[Node]
    hp   *HazDomain // some hazard pointer domain
}

func (s *Stack) Pop(slot int) (int, bool) {
    top := s.head.Load()
    if top == nil {
        return 0, false
    }
    s.hp.Protect(slot, unsafe.Pointer(top))
    // BUG: no re-read of s.head
    next := top.next
    if s.head.CompareAndSwap(top, next) {
        v := top.value
        s.hp.Clear(slot)
        s.hp.Retire(unsafe.Pointer(top), nil)
        return v, true
    }
    s.hp.Clear(slot)
    return 0, false
}
```

**Find the bug.**

**Answer.** No re-read of `s.head` after `Protect`. The window between the original load and the publication of the hazard is unprotected. A concurrent thread can pop `top`, scan the hazards (sees nothing for `top` yet), free `top`, then publish a recycled node with the same address. Our `Protect` publishes too late; the dereference `top.next` reads freed memory.

The Michael 2004 protocol explicitly requires the re-read. Without it, the hazard scheme degenerates.

**Fix.**

```go
top := s.head.Load()
if top == nil { return 0, false }
s.hp.Protect(slot, unsafe.Pointer(top))
if s.head.Load() != top {
    s.hp.Clear(slot)
    continue // outer retry loop
}
// safe to dereference top
```

---

## Bug 9 — EBR With Forgotten Exit

```go
package buggy

import "ebr"

type List struct {
    ebr *ebr.Domain
    // ...
}

func (l *List) Find(tid int, key int) (Node, bool) {
    l.ebr.Enter(tid)
    for cur := l.head.Load(); cur != nil; cur = cur.next.Load() {
        if cur.key == key {
            return *cur, true
            // BUG: no Exit
        }
    }
    l.ebr.Exit(tid)
    return Node{}, false
}
```

**Find the bug.**

**Answer.** The early return on `cur.key == key` skips `l.ebr.Exit(tid)`. The goroutine's local epoch stays set indefinitely. EBR's global epoch advance scans local epochs and refuses to advance if any is behind; this goroutine's stale local epoch blocks all reclamation.

In a long-running service, the retired list grows unboundedly. Memory leak in slow motion.

**Fix.** Use `defer`:

```go
func (l *List) Find(tid int, key int) (Node, bool) {
    l.ebr.Enter(tid)
    defer l.ebr.Exit(tid)
    // ...
}
```

---

## Bug 10 — Tagged Pointer With In-Place Increment

```go
package buggy

import "sync/atomic"

type Node struct {
    value int
    next  *Node
}

type versioned struct {
    head *Node
    gen  uint64
}

type Stack struct {
    state atomic.Pointer[versioned]
}

func (s *Stack) Push(v int) {
    n := &Node{value: v}
    for {
        old := s.state.Load()
        old.gen++ // BUG: mutating shared wrapper
        n.next = old.head
        if s.state.CompareAndSwap(old, &versioned{head: n, gen: old.gen}) {
            return
        }
    }
}
```

**Find the bug.**

**Answer.** `old.gen++` mutates the shared wrapper in place. Two goroutines that both observe `old.gen = 5` can race on the increment, producing wrappers with the same `gen = 6` instead of distinct values. The defensive purpose of the counter is broken.

More fundamentally, the wrapper-immutability invariant is violated. The whole design depends on each wrapper being frozen after publication.

**Fix.** Read `old.gen` into a local, build the new wrapper from the local:

```go
gen := old.gen
n.next = old.head
if s.state.CompareAndSwap(old, &versioned{head: n, gen: gen + 1}) {
```

---

## Bug 11 — `uintptr` Defeating GC

```go
package buggy

import (
    "sync/atomic"
    "unsafe"
)

type Node struct {
    value int
    next  *Node
}

type Stack struct {
    head atomic.Uintptr // BUG: stores uintptr, not *Node
}

func (s *Stack) Push(v int) {
    n := &Node{value: v}
    nPtr := uintptr(unsafe.Pointer(n))
    for {
        old := s.head.Load()
        n.next = (*Node)(unsafe.Pointer(old))
        if s.head.CompareAndSwap(old, nPtr) {
            return
        }
    }
}
```

**Find the bug.**

**Answer.** `uintptr` is not a pointer to the GC. The stack's `head` is a numeric address, not a tracked reference. The GC may collect the `Node` whose address is stored in `head` if no other `*Node` keeps it alive.

The `n.next` field is a `*Node`, which keeps the predecessor alive. But once the predecessor is popped, the field is overwritten; if nothing else references it, the GC can free it. The next `Pop` then reads a freed node.

This is a common "I want a tagged pointer" trap. The fix is to use `atomic.Pointer[Node]` and trust the GC.

**Fix.** Use `atomic.Pointer[Node]` everywhere; if you genuinely need tagging, use a wrapper struct.

---

## Bug 12 — DWCAS Misalignment

```go
package buggy

import "sync/atomic"

type tagged struct {
    ptr uint64
    gen uint64
}

type Stack struct {
    state [2]tagged // BUG: array of tagged, not aligned for CMPXCHG16B
}

//go:noescape
func cas128(p *tagged, old, new tagged) bool

func (s *Stack) Push(v int) {
    var node tagged
    // ... set node.ptr ...
    for {
        old := s.state[1]
        if cas128(&s.state[1], old, node) {
            return
        }
    }
}
```

**Find the bug.**

**Answer.** `CMPXCHG16B` requires 16-byte alignment of the target. A `tagged` struct is 16 bytes, but the second element of `[2]tagged` may not be 16-byte aligned if the array starts at an odd 8-byte boundary (depending on enclosing struct layout). The misaligned access raises `#GP` and crashes.

Additionally, the field selection `s.state[1]` returns a value, not an addressable lvalue; the assembly stub needs `&s.state[1]`, which is in the code, but the address of an array element may not be aligned.

**Fix.** Either use a single `tagged` (16 bytes, naturally aligned at start of struct), or pad explicitly:

```go
type Stack struct {
    _     [0]uint128 // force 16-byte alignment via the zero-size aligner trick
    state tagged
}
```

Or ensure the struct is heap-allocated and verify alignment at construction.

---

## Diagnosing ABA in Real Code

In a code review or incident investigation, the heuristics for spotting ABA-class bugs:

### Hot spots

- Any function with `atomic.CompareAndSwap` in a loop.
- Any use of `sync.Pool` with shared structures.
- Any 32-bit counter that could increment more than 4 billion times.
- Any `unsafe.Pointer` arithmetic.
- Any custom free list or slab allocator.
- Any function that takes an "expected" parameter and compares it to live state.

### Questions to ask

- What value is being CAS'd? Can it recur?
- Who else can modify this location? Can they round-trip it?
- If recurrence is possible, what mitigation is in place?
- Is the mitigation actually used by every CAS site, or is one site missing it?
- Does the algorithm depend on state beyond the CAS'd location? If so, what protects that wider state?

### Patterns that should raise alarm

- A comment that says "this works because the pointer is unique" without explaining why.
- A `uint32` field labeled "version" or "generation."
- A `sync.Pool` of structs that have CAS-able fields.
- A `uintptr` in an atomic field.
- A CAS where the "new" value is computed from a non-atomic read of related state.

---

## Tools and Techniques

### `go test -race`

Catches data races on plain memory. Does **not** catch ABA on atomic memory. Necessary but not sufficient. Run it always; do not assume it catches everything.

### Linearizability checkers

`porcupine` (Anish Athalye) takes a log of operations and checks linearizability. The strongest test for lock-free correctness. Use before shipping.

### Stress tests with chaos

High `GOMAXPROCS` (8-16), millions of operations, invariant checks after each, occasional `runtime.Gosched()`. Run for hours. ABA bugs surface as nondeterministic invariant violations.

### Manual model checking

For small state spaces, enumerate all interleavings by hand. Tedious but conclusive. Works well for proving correctness of a tagged-wrapper protocol.

### Code generation and SAT

Tools like `dst` (Deterministic Simulation Testing) provide a deterministic scheduler. `gomc` is similar. Both let you reproduce a bug deterministically once you have a failing seed.

### Runtime tracing

`runtime/trace` shows goroutine scheduling. For an ABA bug, it can reveal which goroutines were running concurrently at the moment of corruption. Combine with custom event annotations (`trace.Log`) to mark suspect operations.

### Memory tagging hardware (future)

ARMv8.5+ MTE and Intel CET features hint at hardware support for catching use-after-free. Currently not exposed to Go programmers, but worth tracking. The pattern of bugs in this file would shrink under hardware-enforced memory tagging.

---

These 12 bugs cover the major ABA-class patterns you will encounter in Go code. Some are obvious; some require subtle reasoning about runtime semantics. After working through them, code review for ABA becomes a matter of pattern recognition. The cumulative skill is "see a CAS, ask what value is being compared, ask what can interfere."

The next file, optimize.md, looks at the performance trade-offs of these mitigations and when each is worth the cost.

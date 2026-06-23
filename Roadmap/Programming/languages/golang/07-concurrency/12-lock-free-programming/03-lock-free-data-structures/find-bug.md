# Lock-Free Data Structures — Find the Bug

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Treiber Stack Bugs](#treiber-stack-bugs)
3. [Michael-Scott Queue Bugs](#michael-scott-queue-bugs)
4. [Harris List Bugs](#harris-list-bugs)
5. [Ring Buffer Bugs](#ring-buffer-bugs)
6. [Vyukov MPMC Bugs](#vyukov-mpmc-bugs)
7. [Memory Reclamation Bugs](#memory-reclamation-bugs)
8. [Padding and False-Sharing Bugs](#padding-and-false-sharing-bugs)
9. [General Pitfalls](#general-pitfalls)
10. [Diagnostic Methodology](#diagnostic-methodology)

---

## How to Use This File

Each bug has:

- A **buggy code sample**.
- A symptom or test that exposes it.
- A diagnosis explaining what is wrong.
- A **fix**.

Read the buggy code, hypothesise the bug, then check the diagnosis. Pen-and-paper concurrency reasoning is the single most useful skill in this material.

All examples target Go 1.21+ with generics.

---

## Treiber Stack Bugs

### Bug 1. Pop reads next after CAS.

```go
func (s *Stack[V]) Pop() (V, bool) {
    var zero V
    for {
        top := s.head.Load()
        if top == nil {
            return zero, false
        }
        if s.head.CompareAndSwap(top, top.next) {
            return top.val, true
        }
    }
}
```

This is actually correct in Go because `top.next` is read before the CAS attempts. But consider:

```go
func (s *Stack[V]) Pop() (V, bool) {
    var zero V
    for {
        top := s.head.Load()
        if top == nil {
            return zero, false
        }
        if s.head.CompareAndSwap(top, s.head.Load().next) {  // BUG
            return top.val, true
        }
    }
}
```

**Diagnosis.** The `new` value passed to CAS is `s.head.Load().next` — but `s.head` may have changed between the first `Load` and this second `Load`. If `top` is still the head when the CAS runs, `s.head.Load().next` is `top.next`, which is fine. But if `top` is no longer the head, the CAS will fail anyway. The real issue: in the moment between the inner `Load` and the CAS, another op can swing head, so the `.next` we are passing is unrelated to `top`.

Actually, in this specific case the CAS will fail because `s.head != top`, so it is benign — but it is sloppy and confusing. Always pass `top.next`, not a re-loaded value.

**Fix.** Use `top.next`:

```go
if s.head.CompareAndSwap(top, top.next) {
```

---

### Bug 2. Push without re-reading head in the loop.

```go
func (s *Stack[V]) Push(v V) {
    n := &node[V]{val: v}
    old := s.head.Load()
    n.next = old
    for !s.head.CompareAndSwap(old, n) {
        // BUG: n.next never updated
    }
}
```

**Diagnosis.** `old` and `n.next` are set once before the loop. After a failed CAS, `s.head` has changed but `n.next` still points to the original `old`. The retry CAS will fail forever because we are comparing against a stale `old`. The loop never makes progress.

**Symptom.** Threads in Push spin forever once contention happens.

**Fix.** Move the load and `n.next` assignment inside the loop:

```go
func (s *Stack[V]) Push(v V) {
    n := &node[V]{val: v}
    for {
        old := s.head.Load()
        n.next = old
        if s.head.CompareAndSwap(old, n) {
            return
        }
    }
}
```

---

### Bug 3. Setting `n.next` *after* successful CAS.

```go
func (s *Stack[V]) Push(v V) {
    n := &node[V]{val: v}
    for {
        old := s.head.Load()
        if s.head.CompareAndSwap(old, n) {
            n.next = old  // BUG: n is published before next is set
            return
        }
    }
}
```

**Diagnosis.** After the CAS, `n` is the head. Another thread can `Load(head) == n` and read `n.next` before we set it. They will see `nil` and either return early in Pop (stack appears to have only one element) or crash.

**Symptom.** Lost elements, occasional nil dereferences, race detector report.

**Fix.** Set `n.next` before the CAS. Always publish a fully-constructed object.

---

## Michael-Scott Queue Bugs

### Bug 4. Forgetting to help advance the tail.

```go
func (q *Queue[V]) Enqueue(v V) {
    n := &qnode[V]{val: v}
    for {
        tail := q.tail.Load()
        if tail.next.CompareAndSwap(nil, n) {
            q.tail.CompareAndSwap(tail, n)
            return
        }
        // BUG: did not help advance a lagging tail
    }
}
```

**Diagnosis.** When `tail.next.CAS(nil, n)` fails, the cause is usually that another enqueuer already linked a node. That enqueuer might be descheduled before advancing tail. The current thread sees `tail.next != nil` and retries — but `tail` is the same, so the inner CAS will always fail. Livelock.

**Symptom.** CPU pegged at 100%, no throughput.

**Fix.** Read `tail.next` and help advance:

```go
for {
    tail := q.tail.Load()
    next := tail.next.Load()
    if next != nil {
        q.tail.CompareAndSwap(tail, next)
        continue
    }
    if tail.next.CompareAndSwap(nil, n) {
        q.tail.CompareAndSwap(tail, n)
        return
    }
}
```

---

### Bug 5. Dequeue without the head-tail check.

```go
func (q *Queue[V]) Dequeue() (V, bool) {
    var zero V
    for {
        head := q.head.Load()
        next := head.next.Load()
        if next == nil {
            return zero, false
        }
        if q.head.CompareAndSwap(head, next) {
            return next.val, true
        }
    }
}
```

**Diagnosis.** Misses the case where `head == tail` but `next != nil` (the lagging-tail case during a concurrent enqueue). Here, the dequeuer should help advance the tail before dequeuing. Without the help, after this Dequeue removes the dummy, the queue has an inconsistent tail pointer pointing to a node no longer in the list.

**Symptom.** Future Enqueues fail or duplicate elements.

**Fix.** Add the help-advance-tail step:

```go
for {
    head := q.head.Load()
    tail := q.tail.Load()
    next := head.next.Load()
    if next == nil {
        return zero, false
    }
    if head == tail {
        q.tail.CompareAndSwap(tail, next)
        continue
    }
    if q.head.CompareAndSwap(head, next) {
        return next.val, true
    }
}
```

---

### Bug 6. Reusing the dummy node across queue lifetime.

```go
func NewQueue[V any]() *Queue[V] {
    dummy := &qnode[V]{}
    return &Queue[V]{
        head: atomic.Pointer[qnode[V]]{},
        tail: atomic.Pointer[qnode[V]]{},
    }
    // BUG: never stored dummy in head/tail
}
```

**Diagnosis.** `q.head` and `q.tail` are zero values (nil). Every method dereferences `q.head.Load()` and panics on nil.

**Symptom.** Nil pointer dereference on first op.

**Fix.** Store dummy:

```go
func NewQueue[V any]() *Queue[V] {
    dummy := &qnode[V]{}
    q := &Queue[V]{}
    q.head.Store(dummy)
    q.tail.Store(dummy)
    return q
}
```

---

### Bug 7. Snapshot inconsistency in Enqueue.

```go
func (q *Queue[V]) Enqueue(v V) {
    n := &qnode[V]{val: v}
    for {
        tail := q.tail.Load()
        next := tail.next.Load()
        // BUG: missing re-check of q.tail == tail
        if next != nil {
            q.tail.CompareAndSwap(tail, next)
            continue
        }
        if tail.next.CompareAndSwap(nil, n) {
            q.tail.CompareAndSwap(tail, n)
            return
        }
    }
}
```

**Diagnosis.** Between `tail := q.tail.Load()` and `next := tail.next.Load()`, another thread might have advanced the tail and queued new elements. Now we read `tail.next` (a stale tail's next). If we try to CAS `tail.next` from nil to `n`, we may corrupt a node that is no longer in the canonical lookup path.

The standard MS-queue includes a "snapshot consistency" check: re-read `q.tail` and confirm it equals `tail` before proceeding. If not, retry.

**Symptom.** Occasional element duplication or loss under contention.

**Fix.** Re-check the snapshot:

```go
tail := q.tail.Load()
next := tail.next.Load()
if tail != q.tail.Load() {
    continue
}
```

This is a defensive technique that the original Michael-Scott paper specifies. Skipping it works most of the time but fails subtly under heavy contention.

---

## Harris List Bugs

### Bug 8. Marking the wrong pointer.

```go
func (l *List) Delete(key uint64) bool {
    pred, curr := l.search(key)
    if curr == nil || curr.key != key {
        return false
    }
    // BUG: marks pred.next instead of curr.next
    predNext := pred.next.Load()
    pred.next.CompareAndSwap(predNext, &nextRef{next: predNext.next, deleted: true})
    return true
}
```

**Diagnosis.** Harris's algorithm marks the *doomed node's* `next` pointer, not the predecessor's. Marking `pred.next` means "the link from pred to curr is broken," which is meaningless because `pred.next` is supposed to remain a valid forward link.

**Symptom.** Insertions into the marked range succeed but subsequent searches do not see them. Or vice versa, depending on the race.

**Fix.** Mark `curr.next`:

```go
currNext := curr.next.Load()
if currNext == nil {
    return false
}
curr.next.CompareAndSwap(currNext, &nextRef{next: currNext.next, deleted: true})
```

---

### Bug 9. Reading mark via a deref before checking.

```go
func (l *List) Contains(key uint64) bool {
    _, curr := l.search(key)
    if curr == nil {
        return false
    }
    return curr.key == key && !curr.next.Load().deleted
    // BUG: nil deref if curr.next.Load() returns nil
}
```

**Diagnosis.** `curr.next.Load()` may return nil if `curr` is the tail. Dereferencing `.deleted` panics.

**Symptom.** Nil deref panic on `Contains` near the tail.

**Fix.** Check for nil:

```go
nref := curr.next.Load()
return curr.key == key && (nref == nil || !nref.deleted)
```

(The semantics: a tail node with `next == nil` is, by convention, not deleted.)

---

### Bug 10. Inserting through a marked node.

```go
func (l *List) Insert(key uint64) {
    n := &listNode{key: key}
    for {
        pred, succ := l.search(key)
        n.next.Store(&nextRef{next: succ})
        oldRef := pred.next.Load()
        // BUG: should check oldRef.deleted == false
        if pred.next.CompareAndSwap(oldRef, &nextRef{next: n}) {
            return
        }
    }
}
```

**Diagnosis.** If `pred` itself is logically deleted (`oldRef.deleted == true`), inserting `n` after `pred` links `n` into a doomed chain. Once `pred` is physically unlinked, `n` becomes orphaned.

**Symptom.** Lost insertions; `Contains` returns false for keys that were inserted.

**Fix.** The search routine should return only non-marked predecessors. Check in `Insert`:

```go
if oldRef.deleted {
    continue // retry; search will skip past deleted pred
}
if pred.next.CompareAndSwap(oldRef, &nextRef{next: n}) {
    return
}
```

The cleaner fix is to ensure `search` never returns a marked `pred`. This is the standard formulation in the Harris paper.

---

## Ring Buffer Bugs

### Bug 11. SPSC ring buffer with non-power-of-two size.

```go
type SPSC[V any] struct {
    buf  []V
    head atomic.Uint64
    tail atomic.Uint64
}

func NewSPSC[V any](cap int) *SPSC[V] {
    return &SPSC[V]{buf: make([]V, cap)}
}

func (q *SPSC[V]) Push(v V) bool {
    tail := q.tail.Load()
    head := q.head.Load()
    if tail-head >= uint64(len(q.buf)) {
        return false
    }
    q.buf[tail%uint64(len(q.buf))] = v  // BUG: % is slow; also wrap-around bug
    q.tail.Store(tail + 1)
    return true
}
```

**Diagnosis.** Two issues.

1. `%` is much slower than masking with `(cap-1)` when cap is a power of two. The standard SPSC requires power-of-two for this reason.
2. With arbitrary cap, the wrap math `tail-head >= cap` still works, but on integer overflow (`tail` and `head` are unsigned 64-bit, so this is practically never an issue) you would need extra care.

The bigger architectural issue: every operation does a modulo, which can be 10x slower than the SPSC's other operations. For a structure whose purpose is raw throughput, this defeats the design.

**Fix.** Require power-of-two cap and use a mask:

```go
type SPSC[V any] struct {
    buf  []V
    mask uint64
    head atomic.Uint64
    tail atomic.Uint64
}

func NewSPSC[V any](capPow2 int) *SPSC[V] {
    if capPow2 == 0 || capPow2&(capPow2-1) != 0 {
        panic("capacity must be a power of two")
    }
    return &SPSC[V]{buf: make([]V, capPow2), mask: uint64(capPow2 - 1)}
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
```

---

### Bug 12. SPSC with no padding between head and tail.

```go
type SPSC[V any] struct {
    buf  []V
    mask uint64
    head atomic.Uint64  // touched by consumer
    tail atomic.Uint64  // touched by producer  -- shares cache line with head
}
```

**Diagnosis.** `head` and `tail` are adjacent. On a 64-byte cache line, both fit in one line. The producer's `Store(tail+1)` invalidates the consumer's cached `head`, and vice versa. False sharing.

**Symptom.** Throughput is 5-10x lower than the same algorithm with padding.

**Fix.** Pad explicitly:

```go
type SPSC[V any] struct {
    buf  []V
    mask uint64
    _    [40]byte         // pad rest of cache line after mask
    head atomic.Uint64
    _    [56]byte
    tail atomic.Uint64
    _    [56]byte
}
```

This is the kind of bug that takes a year to find without `perf c2c` because the code is functionally correct.

---

### Bug 13. SPSC Push that writes after publishing.

```go
func (q *SPSC[V]) Push(v V) bool {
    tail := q.tail.Load()
    head := q.head.Load()
    if tail-head == uint64(len(q.buf)) {
        return false
    }
    q.tail.Store(tail + 1)        // BUG: publish before write
    q.buf[tail&q.mask] = v
    return true
}
```

**Diagnosis.** The tail is incremented before the value is written. A consumer that sees the new tail tries to read the slot, gets the previous value (or garbage), and returns it.

**Symptom.** Consumer sees stale or zero values for newly-pushed items.

**Fix.** Write the slot, then publish:

```go
q.buf[tail&q.mask] = v
q.tail.Store(tail + 1)
```

The Go memory model guarantees the buffer write happens-before any read that observes the new tail via atomic Load — but only if the buffer write is sequenced before the atomic Store. This is the bedrock of every ring-buffer correctness argument.

---

## Vyukov MPMC Bugs

### Bug 14. Sequence number initialised to zero.

```go
func NewQueue[V any](capPow2 int) *Queue[V] {
    q := &Queue[V]{
        buf:  make([]cell[V], capPow2),
        mask: uint64(capPow2 - 1),
    }
    // BUG: forgot to initialise cell.seq[i] = i
    return q
}
```

**Diagnosis.** All cells have `seq = 0`. The first Enqueue at `pos = 0` sees `seq == pos`, proceeds, sets `seq = 1`. Good. But the first Enqueue at `pos = 1` sees `seq = 0` at cell 1, computes `diff = 0 - 1 = -1`, reports full. The queue appears full immediately.

**Symptom.** Enqueue returns false immediately on a fresh queue past position 0.

**Fix.** Initialise sequences:

```go
for i := range q.buf {
    q.buf[i].seq.Store(uint64(i))
}
```

---

### Bug 15. Mixing signed and unsigned diff arithmetic.

```go
diff := seq - pos     // both uint64
if diff == 0 {
    // ...
}
if diff < 0 {  // BUG: uint64 < 0 is always false
    return false
}
```

**Diagnosis.** `uint64` is unsigned. `diff < 0` is unreachable. The full case is never detected; the queue appears infinite.

**Symptom.** Enqueues succeed even when the queue is full, overwriting unread cells.

**Fix.** Cast to signed:

```go
diff := int64(seq) - int64(pos)
if diff == 0 { ... }
if diff < 0 { return false }
```

This bug is common when porting C/C++ Vyukov code, where the original uses `ptrdiff_t`.

---

### Bug 16. Forgetting the deqPos increment to capacity.

```go
case diff == 0:
    if q.deqPos.CompareAndSwap(pos, pos+1) {
        v := c.val
        c.seq.Store(pos + 1)  // BUG: should be pos + capacity
        return v, true
    }
```

**Diagnosis.** After dequeue, the cell's seq should jump by capacity so that the next enqueue at `pos + capacity` finds the right value. Setting it to `pos + 1` makes the cell appear ready for the next enqueue at position `pos + 1`, which is wrong — that position is for the next cell.

**Symptom.** Subsequent enqueues at the wrapped position fail or produce ABA-like inconsistencies.

**Fix.**

```go
c.seq.Store(pos + uint64(len(q.buf)))
```

---

## Memory Reclamation Bugs

### Bug 17. Freeing a node that another reader is dereferencing.

(In Go, free is implicit via GC. This bug arises only when interacting with `unsafe.Pointer` or external memory.)

```go
func (s *Stack) Pop() (unsafe.Pointer, bool) {
    for {
        top := atomic.LoadPointer(&s.head)
        if top == nil {
            return nil, false
        }
        next := (*node)(top).next
        if atomic.CompareAndSwapPointer(&s.head, top, next) {
            // BUG: another reader may still be dereferencing top
            C.free(top)
            return top, true
        }
    }
}
```

**Diagnosis.** Another goroutine could have read `s.head == top` and be about to call `(*node)(top).next`. We free `top` from under them. Use-after-free.

**Fix.** Use hazard pointers or EBR. Or rely on Go's GC by avoiding `unsafe.Pointer` and `C.free`.

In Go with regular pointers, this bug cannot occur: the popper holds a live reference, so the GC will not free the node.

---

### Bug 18. Hazard pointer published after dereference.

```go
func (t *hpThread) Protect(load func() unsafe.Pointer) unsafe.Pointer {
    p := load()
    _ = (*node)(p).val   // BUG: deref before publishing
    t.mySlot.Store((*byte)(p))
    return p
}
```

**Diagnosis.** The hazard slot is published *after* the dereference. Between the load and the store, the node could be freed. Use-after-free in the deref.

**Fix.** Publish, then re-read, then deref:

```go
for {
    p := load()
    t.mySlot.Store((*byte)(p))
    if load() == p {
        return p   // safe to deref now
    }
}
```

The re-read confirms the pointer is still published at the source, so the hazard pointer was registered before the source was modified.

---

### Bug 19. EBR pin without unpin.

```go
func (m *Map) Get(k Key) Value {
    m.epoch.Pin()
    return m.lookup(k)
    // BUG: forgot Unpin
}
```

**Diagnosis.** Pinned goroutines block epoch advance. If `Get` never unpins, retire lists grow forever. Memory leak.

**Fix.**

```go
func (m *Map) Get(k Key) Value {
    g := m.epoch.Pin()
    defer g.Unpin()
    return m.lookup(k)
}
```

`defer` is the only sane way to manage pin/unpin in Go.

---

## Padding and False-Sharing Bugs

### Bug 20. Insufficient pad on ARM.

```go
type SPSC struct {
    head atomic.Uint64
    _    [56]byte    // pads to 64 bytes, correct for x86
    tail atomic.Uint64
}
```

**Diagnosis.** On Apple M-series, the cache line is 128 bytes. The 56-byte pad still leaves head and tail in the same effective cache line. False sharing on M-series despite "padding."

**Symptom.** Mysteriously worse performance on M1/M2 than on x86.

**Fix.** Pad to 128 bytes on ARM:

```go
type SPSC struct {
    head atomic.Uint64
    _    [120]byte   // pad to 128 bytes
    tail atomic.Uint64
    _    [120]byte
}
```

Or build a portable pad with `const cacheLine = 64` (x86) or `128` (M-series) and select at build time.

---

### Bug 21. Pad immediately before a slice header.

```go
type Counter struct {
    n   atomic.Int64
    _   [56]byte    // pad
    buf []byte      // BUG: slice header is 24 bytes; next field shares cache line with this if any
}
```

**Diagnosis.** The pad is between `n` and `buf`. `buf` is a `SliceHeader` of 24 bytes. Whatever follows `buf` is in the same cache line as `buf`. If the next field is also written concurrently, you have false sharing again.

**Fix.** Pad after every concurrently-written field, not just the first one:

```go
type Counter struct {
    n   atomic.Int64
    _   [56]byte
    buf []byte
    _   [40]byte   // pad after buf
}
```

The general rule: pad after each independently-written concurrent field. Test layout in unit tests.

---

## General Pitfalls

### Bug 22. Non-atomic field used as if atomic.

```go
type stats struct {
    counter int64  // BUG: not atomic
}

func (s *stats) Add(v int64) {
    s.counter += v
}
```

**Diagnosis.** Multiple goroutines call `Add` concurrently; non-atomic increment loses updates. Race detector catches this immediately.

**Fix.** Use `atomic.Int64`:

```go
type stats struct {
    counter atomic.Int64
}

func (s *stats) Add(v int64) {
    s.counter.Add(v)
}
```

### Bug 23. Mixing atomic and non-atomic access.

```go
type X struct {
    n atomic.Int64
}

var x X

go func() { x.n.Add(1) }()
go func() { fmt.Println(*(*int64)(unsafe.Pointer(&x.n))) }()  // BUG
```

**Diagnosis.** Reading the field via unsafe pointer bypasses the atomic. Race on the underlying memory. The read may see a torn value.

**Fix.** Use the atomic API consistently:

```go
fmt.Println(x.n.Load())
```

### Bug 24. Assuming `runtime.Gosched()` yields the thread.

```go
for !q.head.CompareAndSwap(old, new) {
    runtime.Gosched()
}
```

**Diagnosis.** `Gosched` yields to the Go scheduler, not the OS. On a single P, no other goroutine may be runnable, and we spin tighter than without the call. Worse than nothing.

The fix is rarely to use `Gosched`. Use exponential backoff with a real sleep at the high end, or accept that under contention the loop will spin.

### Bug 25. Using a `chan` as a "lock-free queue".

```go
type Queue struct {
    ch chan int
}

func (q *Queue) Enqueue(v int) {
    q.ch <- v   // BUG: blocks if full
}
```

**Diagnosis.** Channel ops block. A blocked op is not lock-free. If the consumer dies, all producers stall.

**Fix.** Either use a true lock-free queue, or use a select with default and accept drop semantics:

```go
select {
case q.ch <- v:
default:
    // dropped
}
```

---

## Diagnostic Methodology

When a lock-free structure misbehaves, work through these steps.

### Step 1. Run under `-race`.

```bash
go test -race -count=10000 -timeout=10m ./...
```

The race detector finds the majority of bugs. Run with high count to catch rare races.

### Step 2. Add invariant checks.

Track expected vs actual state with atomic counters. Assert at quiescence.

```go
type Stack[V any] struct {
    head atomic.Pointer[node[V]]
    pushed atomic.Int64
    popped atomic.Int64
}
```

### Step 3. Identify the linearization point.

For every operation, name the single atomic op at which the operation takes effect. If you cannot, the algorithm is suspect.

### Step 4. Check ABA.

Does any CAS compare values that could be the same after intervening ops? If yes, you need version counters, sequence numbers, or the GC's pointer guarantee.

### Step 5. Check memory ordering.

Every published pointer must be fully constructed before the CAS that publishes it. Every reader that sees the published pointer accesses the object through it (not via a separate atomic load that could see a stale state).

### Step 6. Check helping.

If the algorithm has multiple CASes per op (MS-queue tail advance), confirm that any thread observing the intermediate state can complete the work.

### Step 7. Check progress.

In every retry loop, confirm that some CAS in the system has succeeded. If a thread can retry forever without others making progress, the algorithm is at most obstruction-free.

### Step 8. Compare with the paper.

Find the original publication. Compare your code line-by-line. The papers are short. Discrepancies are bugs.

### Step 9. Look at `perf c2c` output.

If the algorithm is correct but slow, false sharing is the likely culprit. `perf c2c` shows cache-line contention directly.

### Step 10. Consider switching to a mutex.

If the bug count exceeds three after a week of debugging, you are in research territory. A mutex-protected version is almost always available, debuggable, and within 30% on throughput. Ship that.

---

## Closing Thoughts

Lock-free bugs are the hardest concurrency bugs to find. They often manifest as occasional element loss, occasional duplication, or slow memory growth — symptoms easy to miss in unit tests and hard to trace in production.

The disciplines that prevent them: name linearization points, document invariants, run `-race` to exhaustion, pad aggressively, prefer the GC over hand-rolled reclamation, and have a mutex-protected baseline to compare against.

The honest summary, again: most lock-free code does not need to be lock-free. The bugs that hide in lock-free code are far more expensive than the throughput gains. Reach for the mutex first; reach for lock-free only when profiling demands it and you have the discipline to maintain the result.

---

## Related Topics

- [02-aba-problem](../02-aba-problem/) — ABA cases in depth
- [04-memory-fences](../04-memory-fences/) — Memory ordering bugs
- [05-lock-free-vs-wait-free](../05-lock-free-vs-wait-free/) — Progress guarantees

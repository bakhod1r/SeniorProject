# Compare-and-Swap (CAS) Algorithms — Find the Bug

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Bug 1: Forgotten Loop](#bug-1-forgotten-loop)
3. [Bug 2: Stale `new` Value](#bug-2-stale-new-value)
4. [Bug 3: `n.next` Set Before the Loop](#bug-3-nnext-set-before-the-loop)
5. [Bug 4: Mixing Atomic and Non-Atomic](#bug-4-mixing-atomic-and-non-atomic)
6. [Bug 5: Value-Receiver Atomic](#bug-5-value-receiver-atomic)
7. [Bug 6: Two Independent CASes Pretending to Be One](#bug-6-two-independent-cases)
8. [Bug 7: 0-to-1 Acquire Race](#bug-7-0-to-1-acquire-race)
9. [Bug 8: Set-Then-Check Watermark](#bug-8-set-then-check-watermark)
10. [Bug 9: Side Effect Inside the Loop](#bug-9-side-effect-inside-the-loop)
11. [Bug 10: Misaligned int64 on 32-bit](#bug-10-misaligned-int64-on-32-bit)
12. [Bug 11: Lazy Init Without CAS](#bug-11-lazy-init-without-cas)
13. [Bug 12: Forgotten Empty Check in Pop](#bug-12-forgotten-empty-check-in-pop)
14. [Bug 13: ABA via Pooling](#bug-13-aba-via-pooling)
15. [Bug 14: Reading Stale Pointer Field](#bug-14-reading-stale-pointer-field)
16. [Bug 15: Wrong Order of `Store`s After CAS](#bug-15-wrong-order-of-stores-after-cas)
17. [Bug 16: CAS on Misaligned Atomic in a Struct](#bug-16-cas-on-misaligned-atomic-in-a-struct)
18. [Bug 17: Re-reading Inside `compute`](#bug-17-re-reading-inside-compute)

---

## How to Use This File

Each entry: a code sample with a bug, a hint, the diagnosis, and the fix. Try to spot the bug before reading the diagnosis.

All examples compile (the bugs are runtime/semantic, not syntactic).

---

## Bug 1: Forgotten Loop

```go
type Counter struct {
    v atomic.Int64
}

func (c *Counter) Inc() {
    old := c.v.Load()
    c.v.CompareAndSwap(old, old+1)
}
```

**Hint.** What happens if the CAS fails?

**Diagnosis.** The CAS may fail under contention. If it does, no retry happens — the increment is silently lost. Under concurrent callers, the final count is less than the number of calls.

**Fix.** Wrap in a `for` loop.

```go
func (c *Counter) Inc() {
    for {
        old := c.v.Load()
        if c.v.CompareAndSwap(old, old+1) {
            return
        }
    }
}
```

The CAS-loop template is non-negotiable. A bare CAS without a retry is almost always wrong.

---

## Bug 2: Stale `new` Value

```go
type Counter struct {
    v atomic.Int64
}

func (c *Counter) Inc() {
    old := c.v.Load()
    newVal := old + 1
    for {
        if c.v.CompareAndSwap(old, newVal) {
            return
        }
    }
}
```

**Hint.** What changes between iterations of the loop?

**Diagnosis.** `old` and `newVal` are computed once before the loop. If the first CAS fails (because another goroutine moved `v` forward), the next iteration uses the same stale `old` and `newVal`. The CAS will keep failing forever because `c.v` no longer equals `old`. Infinite spin.

**Fix.** Move the Load and the computation into the loop.

```go
func (c *Counter) Inc() {
    for {
        old := c.v.Load()
        if c.v.CompareAndSwap(old, old+1) {
            return
        }
    }
}
```

The point of the loop is to refresh `old` each iteration.

---

## Bug 3: `n.next` Set Before the Loop

```go
type Stack struct {
    head atomic.Pointer[Node]
}

func (s *Stack) Push(v int) {
    n := &Node{value: v}
    n.next = s.head.Load()
    for {
        if s.head.CompareAndSwap(n.next, n) {
            return
        }
    }
}
```

**Hint.** Same issue as Bug 2, but for a pointer-based stack.

**Diagnosis.** `n.next` is captured once. If the first CAS fails, the head has changed but `n.next` still points to the old head. Subsequent CASes use the stale value and spin forever — or worse, eventually succeed when the head happens to equal the stale value again (the ABA scenario).

**Fix.** Reload `n.next` inside the loop.

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
```

---

## Bug 4: Mixing Atomic and Non-Atomic

```go
var counter int64

func Inc() {
    atomic.AddInt64(&counter, 1)
}

func Reset() {
    counter = 0 // non-atomic
}
```

**Hint.** What does the race detector say?

**Diagnosis.** `Reset` writes `counter` non-atomically. `Inc` reads-modifies-writes it atomically. The non-atomic write races with concurrent atomic ops. The race detector flags it.

Even without the race detector, semantically: a non-atomic write may not become visible to other goroutines, and concurrent atomic ops may see torn values on some platforms.

**Fix.** Use atomic for all accesses.

```go
var counter atomic.Int64

func Inc()   { counter.Add(1) }
func Reset() { counter.Store(0) }
```

Rule: a memory location must be accessed exclusively via atomic ops or exclusively via non-atomic ops. Mixing is undefined.

---

## Bug 5: Value-Receiver Atomic

```go
type Counter struct {
    v atomic.Int64
}

func (c Counter) Inc() {
    c.v.Add(1)
}
```

**Hint.** What does `go vet` say?

**Diagnosis.** Value receiver. `c` is a copy of the caller's `Counter`. `c.v.Add(1)` modifies the copy and discards it. The original is unchanged. `go vet` reports "passes lock by value" because `atomic.Int64` has a `noCopy` marker.

**Fix.** Pointer receiver.

```go
func (c *Counter) Inc() {
    c.v.Add(1)
}
```

Always use pointer receivers for methods that mutate atomic fields. Always.

---

## Bug 6: Two Independent CASes

```go
type Pair struct {
    a atomic.Int64
    b atomic.Int64
}

func (p *Pair) SwapBoth(newA, newB int64) {
    oldA := p.a.Load()
    oldB := p.b.Load()
    p.a.CompareAndSwap(oldA, newA)
    p.b.CompareAndSwap(oldB, newB)
}
```

**Hint.** What can another goroutine observe between the two CASes?

**Diagnosis.** The two CASes are individually atomic but not jointly atomic. Another goroutine can read `(a=newA, b=oldB)` — a state that no other "swap" intended. The function does not provide atomic multi-field update.

Additionally, each CAS may fail without retry, so even individual updates may be silently lost.

**Fix.** Pack a and b into a struct and CAS a pointer to the struct.

```go
type Pair struct {
    a, b int64
}

type AtomicPair struct {
    p atomic.Pointer[Pair]
}

func (ap *AtomicPair) SwapBoth(newA, newB int64) {
    for {
        old := ap.p.Load()
        new := &Pair{a: newA, b: newB}
        if ap.p.CompareAndSwap(old, new) {
            return
        }
    }
}
```

Now both fields are published atomically.

---

## Bug 7: 0-to-1 Acquire Race

```go
type RC struct {
    count atomic.Int32
    data  *Resource
}

func (r *RC) Acquire() bool {
    if r.count.Load() > 0 {
        r.count.Add(1)
        return true
    }
    return false
}

func (r *RC) Release() {
    if r.count.Add(-1) == 0 {
        r.data.Close()
    }
}
```

**Hint.** What can `Release` do between `Load` and `Add` in `Acquire`?

**Diagnosis.** Race window. `Acquire` reads `count > 0` (say count = 1). Before `Acquire`'s `Add`, `Release` runs: decrements to 0 and closes `data`. `Acquire` then increments to 1, returns true. The caller uses a closed resource.

**Fix.** CAS.

```go
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
```

The CAS atomically checks-and-increments. If the count hit zero between the Load and the CAS, the CAS fails and the loop re-checks.

---

## Bug 8: Set-Then-Check Watermark

```go
type Max struct {
    v atomic.Int64
}

func (m *Max) Observe(x int64) {
    if x > m.v.Load() {
        m.v.Store(x)
    }
}
```

**Hint.** Two goroutines observe values 7 and 10 when current is 5.

**Diagnosis.** Race between Load and Store. Goroutine A: Load=5, x=10, decides to Store. Goroutine B: Load=5, x=7, decides to Store. If B's Store lands after A's, max becomes 7 — wrong.

**Fix.** CAS loop.

```go
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
```

If the CAS fails, another writer raised the max. Reread and re-decide.

---

## Bug 9: Side Effect Inside the Loop

```go
func DispenseTicket(t *atomic.Int64) int64 {
    for {
        n := t.Load()
        log.Printf("dispensing ticket %d", n+1)
        if t.CompareAndSwap(n, n+1) {
            return n + 1
        }
    }
}
```

**Hint.** Under contention, how many log lines per successful ticket?

**Diagnosis.** The log call runs every iteration. Under contention with 100 retries, you get 100 log lines for one ticket. Floods the log.

Less obvious: the log line shows the value `n+1` that was *attempted*, not the value that was committed. Failed attempts have misleading numbers.

**Fix.** Log outside the loop.

```go
func DispenseTicket(t *atomic.Int64) int64 {
    for {
        n := t.Load()
        if t.CompareAndSwap(n, n+1) {
            log.Printf("dispensing ticket %d", n+1)
            return n + 1
        }
    }
}
```

Side effects (logs, metrics, I/O) belong on the success path, not in the loop body.

---

## Bug 10: Misaligned int64 on 32-bit

```go
type Stats struct {
    flag    bool
    counter int64
}

func (s *Stats) Inc() {
    atomic.AddInt64(&s.counter, 1)
}
```

**Hint.** What happens on 32-bit ARM or 386?

**Diagnosis.** `bool` is 1 byte; `counter` follows at offset 1 (or 4 after alignment). On 32-bit platforms, the struct's natural alignment is 4 bytes; `counter` may be 4-byte aligned, not 8-byte. `atomic.AddInt64` on a misaligned int64 panics on 32-bit.

**Fix 1 (legacy).** Put 64-bit fields first.

```go
type Stats struct {
    counter int64 // first; aligned to 8
    flag    bool
}
```

**Fix 2 (preferred).** Use `atomic.Int64`.

```go
type Stats struct {
    flag    bool
    counter atomic.Int64
}
```

`atomic.Int64` has an alignment hint and is always 8-byte aligned regardless of position.

---

## Bug 11: Lazy Init Without CAS

```go
type Lazy struct {
    v *Resource
    o sync.Once
}

func (l *Lazy) Get() *Resource {
    if l.v == nil {
        l.v = expensiveBuild()
    }
    return l.v
}
```

**Hint.** Two goroutines call `Get` simultaneously.

**Diagnosis.** Both can see `l.v == nil`, both call `expensiveBuild`, both assign. Resources leak; assignment race; the `sync.Once` field is unused.

**Fix 1: use `sync.Once`.**

```go
func (l *Lazy) Get() *Resource {
    l.o.Do(func() {
        l.v = expensiveBuild()
    })
    return l.v
}
```

**Fix 2: CAS.**

```go
type Lazy struct {
    v atomic.Pointer[Resource]
}

func (l *Lazy) Get() *Resource {
    if v := l.v.Load(); v != nil {
        return v
    }
    candidate := expensiveBuild()
    if l.v.CompareAndSwap(nil, candidate) {
        return candidate
    }
    return l.v.Load()
}
```

CAS approach: builders race, only one wins, losers discard. Useful when `expensiveBuild` is idempotent and cheap to discard. For genuine "do once and only once," use `sync.Once`.

---

## Bug 12: Forgotten Empty Check in Pop

```go
func (s *Stack) Pop() (int, bool) {
    for {
        top := s.head.Load()
        if s.head.CompareAndSwap(top, top.next) {
            return top.value, true
        }
    }
}
```

**Hint.** What if the stack is empty?

**Diagnosis.** `top` is nil. `top.next` is a nil-pointer dereference: panic. Even before the panic, `top.value` would also crash.

**Fix.** Check for nil before the CAS.

```go
func (s *Stack) Pop() (int, bool) {
    for {
        top := s.head.Load()
        if top == nil {
            return 0, false
        }
        if s.head.CompareAndSwap(top, top.next) {
            return top.value, true
        }
    }
}
```

The empty check is itself the linearisation point for the "stack was empty" case.

---

## Bug 13: ABA via Pooling

```go
var nodePool = sync.Pool{
    New: func() any { return new(Node) },
}

type Stack struct {
    head atomic.Pointer[Node]
}

func (s *Stack) Push(v int) {
    n := nodePool.Get().(*Node)
    n.value = v
    for {
        n.next = s.head.Load()
        if s.head.CompareAndSwap(n.next, n) {
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
            nodePool.Put(top) // recycle!
            return v, true
        }
    }
}
```

**Hint.** Search for ABA in the title of the next subsection.

**Diagnosis.** Classic ABA. Goroutine G1 starts `Pop`: loads top = A, reads `next = B`. Descheduled. Goroutine G2 pops A (A goes to pool), pops B, pushes A back (A.next now points to a new node C). G1 resumes: `head.CompareAndSwap(A, B)`. The CAS succeeds — head is once again A — but B is no longer reachable, and the head now points to B which is in some unknown state.

The pool created the ABA: A came back into circulation with the same pointer value.

**Fix.** Either:

1. Don't pool — accept the GC cost. Pure-Go pointer CAS is mostly ABA-free.
2. Versioned pointers: pack a counter with each pointer (need 128-bit CAS, which Go does not directly expose).
3. Hazard pointers or epoch-based reclamation.
4. Use a non-pooled implementation.

The Treiber stack in `02-aba-problem` shows the versioned-pointer fix in detail.

---

## Bug 14: Reading Stale Pointer Field

```go
type Cell struct {
    val  int
    next *Cell
}

type List struct {
    head atomic.Pointer[Cell]
}

func (l *List) Insert(v int) {
    n := &Cell{val: v}
    for {
        n.next = l.head.Load() // .next is a non-atomic field
        if l.head.CompareAndSwap(n.next, n) {
            return
        }
    }
}

func (l *List) Walk() []int {
    var out []int
    for c := l.head.Load(); c != nil; c = c.next { // non-atomic read of .next
        out = append(out, c.val)
    }
    return out
}
```

**Hint.** Look at how `next` is written and read.

**Diagnosis.** `n.next` is written non-atomically in `Insert`, then `l.head.CompareAndSwap` publishes `n`. The publication of `n` via the atomic CAS *does* make `n.next`'s value visible to subsequent readers (publication semantics). So far OK.

But: if `next` is later modified (e.g., for deletion), and `Walk` reads it concurrently with a non-atomic write, you have a race.

For an insert-only list this is fine because `next` is written exactly once before publication. For a list that supports removal or updates, `next` must be atomic.

**Fix for general use.**

```go
type Cell struct {
    val  int
    next atomic.Pointer[Cell]
}

func (l *List) Insert(v int) {
    n := &Cell{val: v}
    for {
        head := l.head.Load()
        n.next.Store(head)
        if l.head.CompareAndSwap(head, n) {
            return
        }
    }
}

func (l *List) Walk() []int {
    var out []int
    for c := l.head.Load(); c != nil; c = c.next.Load() {
        out = append(out, c.val)
    }
    return out
}
```

Every shared field accessed across goroutines must be atomic. The bug is silent until you add a deletion operation that breaks the invariant.

---

## Bug 15: Wrong Order of `Store`s After CAS

```go
type Record struct {
    version atomic.Int64
    data    atomic.Pointer[Data]
}

func (r *Record) Update(d *Data) {
    for {
        oldV := r.version.Load()
        if r.version.CompareAndSwap(oldV, oldV+1) {
            r.data.Store(d)
            return
        }
    }
}
```

**Hint.** What does a concurrent reader see between the CAS and the Store?

**Diagnosis.** Between the version CAS and the data Store, another goroutine can read (version = oldV+1, data = oldData). The pair (version, data) is observable as inconsistent.

**Fix.** Bundle version and data into a struct, CAS the pointer.

```go
type State struct {
    version int64
    data    *Data
}

type Record struct {
    state atomic.Pointer[State]
}

func (r *Record) Update(d *Data) {
    for {
        old := r.state.Load()
        new := &State{version: old.version + 1, data: d}
        if r.state.CompareAndSwap(old, new) {
            return
        }
    }
}
```

Now (version, data) are always published together.

---

## Bug 16: CAS on Misaligned Atomic in a Struct

```go
type Header struct {
    magic uint16
    flags atomic.Int64
}
```

**Hint.** What is the offset of `flags`?

**Diagnosis.** `uint16` is 2 bytes. Without padding, `flags` would be at offset 2 — not 8-byte aligned. On 32-bit platforms, this would crash at runtime.

But! `atomic.Int64` has an internal `align64` marker. The compiler pads `Header` to make `flags` 8-byte aligned. The struct grows from "2+8=10 bytes" to typically 16 bytes (6 bytes of padding inserted before `flags`).

So this is actually **not** a bug if you use `atomic.Int64`. It *would* be a bug if you used a plain `int64`:

```go
type Header struct {
    magic uint16
    flags int64 // dangerous on 32-bit: may end up at offset 2
}
```

**Lesson.** `atomic.Int64` is safer than `int64` for atomic access. Prefer it.

---

## Bug 17: Re-reading Inside `compute`

```go
type Config struct {
    threshold atomic.Int64
    other     atomic.Int64
}

func (c *Config) Bump() {
    for {
        old := c.threshold.Load()
        // bug: re-reads `other` each iteration, which may be in motion
        new := old + c.other.Load()
        if c.threshold.CompareAndSwap(old, new) {
            return
        }
    }
}
```

**Hint.** Is `c.other` synchronised with the CAS?

**Diagnosis.** The CAS protects `threshold` only. `other` is read non-atomically (well, atomically with its own Load, but not synchronised with the CAS on threshold). Across iterations, `other` may change between reads.

Result: `threshold` is committed to a value computed from a snapshot of `other` that may differ from `other`'s current value. The relationship between threshold and other is not invariant-preserving.

**Fix 1.** Read `other` once before the loop if you want a fixed snapshot.

```go
func (c *Config) Bump() {
    delta := c.other.Load()
    for {
        old := c.threshold.Load()
        if c.threshold.CompareAndSwap(old, old+delta) {
            return
        }
    }
}
```

This captures `other` once. The relationship is "increment threshold by the value of other at the start."

**Fix 2.** Bundle both into a struct and CAS the pointer.

```go
type Snapshot struct {
    threshold, other int64
}

type Config struct {
    s atomic.Pointer[Snapshot]
}

func (c *Config) Bump() {
    for {
        old := c.s.Load()
        new := &Snapshot{threshold: old.threshold + old.other, other: old.other}
        if c.s.CompareAndSwap(old, new) {
            return
        }
    }
}
```

Now the (threshold, other) pair is atomic.

**Lesson.** A CAS protects only its target. If your computation depends on other shared state, you need a wider synchronisation strategy (snapshot at the start, pack into one CAS-able unit, or use a mutex).

---

End of find-bug. For each pattern, the fix tends to be one of: (a) wrap in a loop, (b) reload inside the loop, (c) use a CAS instead of a Load-then-Store, (d) bundle multiple fields into a pointer-swap, (e) use atomic for every accessor of a shared field.

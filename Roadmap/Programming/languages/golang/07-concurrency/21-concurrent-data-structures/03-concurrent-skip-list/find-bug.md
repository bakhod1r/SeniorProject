---
layout: default
title: Find Bug
parent: Concurrent Skip List
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/03-concurrent-skip-list/find-bug/
---

# Concurrent Skip List — Find the Bug

> Each snippet below contains a real bug from a concurrent skip list implementation: a torn read, a missing marker, an ABA on the level field, a range scan that lies, an unsafe `findPath` that reads non-atomic next pointers, a node that gets freed under a reader, a re-insertion that breaks linearizability. Identify the bug, explain why it bites, then fix it.

---

## Bug 1 — Non-atomic next pointer in lock-free search

```go
type node struct {
    key  int
    next []*node // plain pointers, not atomic
}

func (s *SkipList) Contains(key int) bool {
    curr := s.head
    for i := s.maxLevel - 1; i >= 0; i-- {
        for curr.next[i] != nil && curr.next[i].key < key {
            curr = curr.next[i]
        }
    }
    nxt := curr.next[0]
    return nxt != nil && nxt.key == key
}

func (s *SkipList) Insert(key int) bool {
    // ... finds preds[i] for each level ...
    n := &node{key: key, next: make([]*node, lvl)}
    for i := 0; i < lvl; i++ {
        n.next[i] = preds[i].next[i]      // plain read
        preds[i].next[i] = n              // plain write
    }
    return true
}
```

**Bug.** `next[i]` is a plain `*node`. The writer's store is not atomic at the language level — the compiler is free to reorder it with the construction of `n`, and the CPU may publish the store before the writes that initialized `n.next[i]`. A reader can see `curr.next[i] = newNode` while `newNode.next[i]` is still zero, then crash on the next iteration when it dereferences a partially constructed node.

The race detector flags every reader-writer pair as a write/read race.

**Fix.** Use `atomic.Pointer[node]`:

```go
type node struct {
    key  int
    next []atomic.Pointer[node]
}

func (s *SkipList) Contains(key int) bool {
    curr := s.head
    for i := s.maxLevel - 1; i >= 0; i-- {
        for nxt := curr.next[i].Load(); nxt != nil && nxt.key < key; nxt = curr.next[i].Load() {
            curr = nxt
        }
    }
    nxt := curr.next[0].Load()
    return nxt != nil && nxt.key == key
}
```

For each store at insertion, also wire `n.next[i]` *before* publishing `n` into `preds[i].next[i]`. That ordering is essential — the publishing store synchronizes with any reader that observes `n`.

---

## Bug 2 — Missing marker node on delete

```go
func (s *SkipList) Delete(key int) bool {
    pred, curr := s.findLevel0(key)
    if curr == nil || curr.key != key {
        return false
    }
    pred.next[0].Store(curr.next[0].Load()) // unlink in one step
    return true
}
```

**Bug.** This deletes by snipping `pred -> curr` and rewiring `pred -> curr.next`. The problem: another writer is inserting `newNode` between `curr` and `curr.next`. That writer's CAS is:

```go
newNode.next[0].Store(curr.next[0].Load()) // reads curr.next = X
curr.next[0].CompareAndSwap(X, newNode)    // succeeds
```

Meanwhile the deleter has just loaded `curr.next[0]` and stored it into `pred.next[0]`. Now `pred.next[0]` points to `X`, skipping the just-inserted `newNode`. `newNode` is silently lost.

This is the classic Harris/Michael bug — a delete that does not first *mark* the node leaves a window for concurrent inserts to disappear.

**Fix.** Two-step delete with marker:

```go
func (s *SkipList) Delete(key int) bool {
    for {
        pred, curr := s.findLevel0(key)
        if curr == nil || curr.key != key {
            return false
        }
        oldMref := curr.mref.Load()
        if oldMref.deleted {
            return false
        }
        newMref := &markedRef{next: oldMref.next, deleted: true}
        if !curr.mref.CompareAndSwap(oldMref, newMref) {
            continue
        }
        // Now curr is logically deleted. Any concurrent insert
        // sees the marked bit and retries.
        pred.mref.CompareAndSwap(
            &markedRef{next: curr, deleted: false},
            &markedRef{next: newMref.next, deleted: false},
        )
        return true
    }
}
```

A concurrent inserter must check `curr.mref.deleted` *before* its CAS; if marked, it retries.

---

## Bug 3 — `findPath` reads non-atomic level

```go
type SkipList struct {
    head     *node
    level    int   // current top level, plain int
    maxLevel int
}

func (s *SkipList) findPath(key int) (preds, succs []*node) {
    preds = make([]*node, s.maxLevel)
    succs = make([]*node, s.maxLevel)
    curr := s.head
    for i := s.level - 1; i >= 0; i-- {
        for curr.next[i].Load() != nil && curr.next[i].Load().key < key {
            curr = curr.next[i].Load()
        }
        preds[i] = curr
        succs[i] = curr.next[i].Load()
    }
    return
}

func (s *SkipList) Insert(key int) bool {
    // ...
    if lvl > s.level {
        s.level = lvl // plain write, racy
    }
    // ...
}
```

**Bug.** `s.level` is a plain `int`. Concurrent writers may increase it. The race detector flags it. Worse, `findPath` reads it once at loop start — if a writer doubles the level mid-search, an inserter computes `preds[]` only for the lower levels and writes garbage `preds[i] = nil` for the upper levels, then dereferences them.

The seemingly innocent "current top level" field is one of the most common skip-list bugs.

**Fix.** Make `level` an `atomic.Int32` and only ever increase it monotonically. Better yet, eliminate it entirely: always search from `maxLevel - 1`. The cost is `maxLevel - log(n)` extra header pointer reads, which is constant for typical sizes (~16 for n < 65k).

```go
type SkipList struct {
    head     *node
    maxLevel int
}

func (s *SkipList) findPath(key int) (preds, succs []*node) {
    preds = make([]*node, s.maxLevel)
    succs = make([]*node, s.maxLevel)
    curr := s.head
    for i := s.maxLevel - 1; i >= 0; i-- {
        for {
            nxt := curr.next[i].Load()
            if nxt == nil || nxt.key >= key {
                break
            }
            curr = nxt
        }
        preds[i] = curr
        succs[i] = curr.next[i].Load()
    }
    return
}
```

Header's upper levels point to `nil` for empty tiers, so the search short-circuits in O(1) per empty level.

---

## Bug 4 — Range scan misses concurrent inserts

```go
func (s *SkipList) Range(lo, hi int, visit func(int) bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    // walk level 0 from lo
    n := s.findFirst(lo)
    for n != nil && n.key <= hi {
        if !visit(n.key) {
            return
        }
        n = n.next[0].Load()
    }
}
```

**Bug.** This holds the read lock for the whole iteration. If `visit` is slow, all writers are blocked. If `visit` calls back into the skip list (e.g., to record a key), it deadlocks on the same RWMutex from the same goroutine.

The intended bug is more subtle: the structure mixes RWMutex with `atomic.Pointer` for next pointers. The author thought "the RLock protects me from writers" — but the writers are doing `next.Store(...)` *without* taking the write lock (because Insert is lock-free). So concurrent inserts happen during the RLocked Range and are observed *partially*: the scan sees some new keys but not others, depending on race timing.

**Fix.** Either:

1. **Honest design:** drop the RWMutex. The scan walks `next[0]` atomically and accepts the linearization point of "saw whatever was reachable at each step." Document this.

```go
func (s *SkipList) Range(lo, hi int, visit func(int) bool) {
    n := s.findFirst(lo)
    for n != nil && n.key <= hi {
        if mref := n.mref.Load(); !mref.deleted {
            if !visit(n.key) {
                return
            }
        }
        n = n.mref.Load().next
    }
}
```

2. **Snapshot:** copy keys into a slice under a quick write-locked pause, then iterate the slice without any lock. The pause is amortized across the iteration.

Pick one; do not pretend RLock provides isolation against lock-free writers.

---

## Bug 5 — ABA on the level field

```go
type SkipList struct {
    topLevel atomic.Int32
}

func (s *SkipList) Insert(key int) bool {
    // ...
    nodeLevel := s.randomLevel()
    for {
        cur := s.topLevel.Load()
        if int32(nodeLevel) <= cur {
            break
        }
        if s.topLevel.CompareAndSwap(cur, int32(nodeLevel)) {
            break
        }
    }
    // ... actual insert ...
}

func (s *SkipList) Delete(key int) bool {
    // ... actual delete ...
    // Shrink topLevel if upper levels are empty
    for s.topLevel.Load() > 1 {
        lvl := s.topLevel.Load()
        if s.head.next[lvl-1].Load() != nil {
            break
        }
        s.topLevel.CompareAndSwap(lvl, lvl-1)
    }
    return true
}
```

**Bug.** ABA on `topLevel`. Imagine: inserter A reads `topLevel = 5`, decides its new node is level 7, attempts CAS(5, 7). Meanwhile deleter D shrinks 5 to 4 (no level-4 nodes) and then inserter B grows back to 5. Now A's CAS(5, 7) succeeds, but the level field reflects a different "5" — the levels-4 cleanup is now wrong because there's a level-7 node hidden under a once-shrunk level pointer.

In Go, `atomic.Int32.CompareAndSwap` is a plain value compare; there is no tag. Classic ABA.

For an integer level counter, ABA is rarely catastrophic — the worst case is a wasted iteration. But if the same counter is used to gate per-level GC or hazard pointer cleanup, the consequences can be use-after-free.

**Fix.** Either:

1. Stop maintaining `topLevel` at all. Always search from `maxLevel`. Header points to `nil` for empty tiers; cost is constant.
2. Pair the level with a generation counter:

```go
type levelGen struct {
    level int32
    gen   int64
}

var topLevel atomic.Pointer[levelGen]

func growLevel(target int32) {
    for {
        old := topLevel.Load()
        if old.level >= target {
            return
        }
        new := &levelGen{level: target, gen: old.gen + 1}
        if topLevel.CompareAndSwap(old, new) {
            return
        }
    }
}
```

Option 1 is simpler. Skip lists rarely benefit from tracking the dynamic top level — `maxLevel` is small.

---

## Bug 6 — Insert at level 0 reads stale prev

```go
func (s *SkipList) Insert(key int) bool {
    for {
        pred, curr := s.findLevel0(key)
        if curr != nil && curr.key == key {
            return false
        }
        n := &node{key: key}
        n.next[0].Store(curr)
        if pred.next[0].CompareAndSwap(curr, n) {
            return true
        }
    }
}

func (s *SkipList) findLevel0(key int) (*node, *node) {
    pred := s.head
    curr := pred.next[0].Load()
    for curr != nil && curr.key < key {
        pred = curr
        curr = curr.next[0].Load()
    }
    return pred, curr
}
```

**Bug.** `findLevel0` returns `(pred, curr)`, but by the time `pred.next[0].CompareAndSwap(curr, n)` runs, `pred` may itself have been logically deleted. The CAS succeeds — the writer sets `pred.next[0] = n` — but `pred` is unreachable, so `n` is unreachable too. The key is silently lost.

This is the second-most-common lock-free skip list bug. The fix is to also check that `pred` is not marked.

**Fix.** Inspect the marker on `pred` before the CAS:

```go
func (s *SkipList) Insert(key int) bool {
    for {
        pred, curr := s.findLevel0(key)
        if curr != nil && curr.key == key {
            return false
        }
        if pred.mref.Load().deleted {
            continue // restart; pred is gone
        }
        n := &node{key: key}
        n.mref.Store(&markedRef{next: curr})
        oldPredMref := &markedRef{next: curr}
        newPredMref := &markedRef{next: n}
        if pred.mref.CompareAndSwap(oldPredMref, newPredMref) {
            return true
        }
    }
}
```

Or use the Harris linked-list trick: a marked node's `next` pointer is itself how you detect deletion — readers walking past `pred` will help unlink it before traversing to `curr`.

---

## Bug 7 — Snapshot iterator holds the writer's lock

```go
type Snapshot struct {
    s *SkipList
}

func (s *SkipList) Snapshot() *Snapshot {
    s.mu.Lock() // BUG: never released
    return &Snapshot{s: s}
}

func (snap *Snapshot) Range(visit func(int) bool) {
    for n := snap.s.head.next[0]; n != nil; n = n.next[0] {
        if !visit(n.key) {
            return
        }
    }
}

func (snap *Snapshot) Close() {
    snap.s.mu.Unlock()
}
```

**Bug.** The `Snapshot` holds the writer's lock for its entire lifetime. If the caller forgets `Close()`, the skip list is frozen forever. Worse, the lock is held during `visit`, so callers cannot reliably call back into the skip list from within their visit function. And if `visit` panics, `Close` is never called and the lock leaks.

**Fix.** Either copy under a brief lock and release immediately, or use an MVCC-style snapshot with a version counter:

```go
func (s *SkipList) Snapshot() *Snapshot {
    s.mu.RLock()
    keys := make([]int, 0, s.n)
    for n := s.head.next[0]; n != nil; n = n.next[0] {
        keys = append(keys, n.key)
    }
    s.mu.RUnlock()
    return &Snapshot{keys: keys}
}
```

The copy is O(n) memory, but the lock window is bounded and predictable. The MVCC version is more code but constant memory per snapshot.

---

## Bug 8 — Concurrent insert duplicates a key

```go
func (s *SkipList) Insert(key int) bool {
    for {
        pred, curr := s.findLevel0(key)
        if curr != nil && curr.key == key {
            return false
        }
        n := &node{key: key}
        n.next[0].Store(curr)
        if pred.next[0].CompareAndSwap(curr, n) {
            // Now climb to upper levels...
            for i := 1; i < n.level; i++ {
                p, c := s.findPathAt(key, i)
                n.next[i].Store(c)
                p.next[i].CompareAndSwap(c, n)
                // BUG: no retry on CAS failure
            }
            return true
        }
    }
}
```

**Bug.** The level-0 CAS commits the insertion. So far so good — that is the linearization point. But the upper-level CASes are *fire and forget*: if any one of them fails, the loop continues but the node is missing from that level. A subsequent search at that level may skip over the new node and conclude the key is absent.

A more subtle case: two concurrent inserters with the same key. Both pass the `curr.key == key` check (they read disjoint snapshots). Both succeed at level 0 (the second sees `pred.next = first.node` and retries; eventually one wins). But the loser may continue retrying with stale `curr` and accidentally re-insert.

**Fix.** Each upper-level CAS must be in its own retry loop *that also re-checks for duplicates*. And after a successful level-0 commit, never re-check duplicates — the linearization point has passed.

```go
for i := 1; i < n.level; i++ {
    for {
        p, c := s.findPathAt(key, i)
        if c == n {
            break // already inserted by helper
        }
        n.next[i].Store(c)
        if p.next[i].CompareAndSwap(c, n) {
            break
        }
    }
}
```

Or use the "self-healing skip list" approach: upper-level links are advisory. Any search that finds level-0 reachable but upper-level missing inserts the link itself.

---

## Bug 9 — Memory reclaimed under a reader

```go
type SkipList struct {
    // no GC reclamation; just unlink and rely on Go GC
}

func (s *SkipList) Delete(key int) bool {
    // ... unlink the node ...
    // Optional: clear to help GC
    n.next = nil
    n.key = 0
    return true
}

func (s *SkipList) Contains(key int) bool {
    curr := s.head
    for i := s.maxLevel - 1; i >= 0; i-- {
        for {
            nxt := curr.next[i].Load()
            if nxt == nil {
                break
            }
            if nxt.key >= key { // reads nxt.key, might be cleared
                break
            }
            curr = nxt
        }
    }
    nxt := curr.next[0].Load()
    return nxt != nil && nxt.key == key
}
```

**Bug.** The deleter clears `n.key = 0` to "help GC." But Go's GC keeps the node alive as long as any other reference exists — and a concurrent reader is holding a reference to `n`. The reader reads `n.key = 0` (just cleared) and incorrectly concludes `0 >= key` for any positive key, so the search stops too early and `Contains` returns `false` for keys actually present.

The "help GC" optimization is wrong here. Skip-list nodes must remain valid for as long as any reader could possibly observe them. Letting Go's GC handle it (with no clearing) is correct.

**Fix.** Delete the "help GC" lines:

```go
func (s *SkipList) Delete(key int) bool {
    // ... unlink the node ...
    return true
}
```

If memory pressure is a real concern, use hazard pointers or epoch-based reclamation to know when no readers can observe `n`, then clear and recycle. Never clear a node while readers may still see it.

---

## Bug 10 — Re-insertion of a marked node

```go
type node struct {
    key  int
    mref atomic.Pointer[markedRef]
}

func (s *SkipList) Insert(key int) bool {
    for {
        pred, curr := s.findLevel0(key)
        if curr != nil && curr.key == key {
            if curr.mref.Load().deleted {
                // unmark and reuse
                old := curr.mref.Load()
                fresh := &markedRef{next: old.next, deleted: false}
                if curr.mref.CompareAndSwap(old, fresh) {
                    return true
                }
                continue
            }
            return false
        }
        // ... normal insert ...
    }
}
```

**Bug.** "Unmark and reuse" sounds clever but is a linearizability violation. Reader R observed `curr` to be deleted at time T1. Inserter I unmarks `curr` at time T2 > T1. Reader R's earlier observation is now retroactively contradicted: the key it saw as absent is again present, with no event between T1 and T2 that R can attribute the change to.

More concretely, if R is inside a snapshot iterator that filters out marked nodes, R reports "key not in snapshot," then re-snapshots at T3 and reports "key in snapshot." The user sees the key reappear without any insert event being logged.

Also: the marker pattern is supposed to be one-shot. Once marked, a node is dead. Resurrecting it breaks the assumption every concurrent algorithm makes about marked nodes.

**Fix.** Never unmark. Insert a fresh node:

```go
if curr != nil && curr.key == key && !curr.mref.Load().deleted {
    return false
}
// Fall through: insert a new node, regardless of whether
// a marked node with the same key exists.
n := &node{key: key, mref: &markedRef{next: curr}}
// ...
```

Garbage collection (via hazard pointers or Go's GC) eventually reclaims the marked node.

---

## Bug 11 — Wrong order of pointer wiring

```go
func (s *SkipList) Insert(key int) bool {
    // ... find predecessors and successors ...
    n := &node{key: key, next: make([]atomic.Pointer[node], lvl)}

    // Wire pred -> new first, then new -> succ.
    for i := 0; i < lvl; i++ {
        preds[i].next[i].Store(n)        // step A: publish n
        n.next[i].Store(succs[i])         // step B: link n forward
    }
    return true
}
```

**Bug.** Between step A and step B at level `i`, the new node `n` is reachable but has `n.next[i] = nil`. A concurrent reader walking level `i` reaches `n`, reads `n.next[i].Load()` = nil, and concludes the list ends here. Every key after `n` at level `i` becomes invisible to that reader for the duration of the window. Worse, if a concurrent inserter at a higher key uses `n` as a predecessor and tries to splice in, the splice may fail because `n.next` is still nil.

The fix is order: wire `n -> succs` *first*, then publish `pred -> n` last. The publishing store is the visibility point; everything `n` needs must be set *before* it.

**Fix.**

```go
for i := 0; i < lvl; i++ {
    n.next[i].Store(succs[i])         // step A: link n forward (private)
}
for i := 0; i < lvl; i++ {
    preds[i].next[i].Store(n)         // step B: publish n (visible)
}
```

Note the two separate loops. Single-loop versions like `next[i].Store(succs[i]); preds[i].next[i].Store(n)` are also correct *per level*, but readers walking a *higher* level might publish-then-see-incomplete on a *lower* level. Two passes are safest.

This pattern is the same as "construct then publish" for any concurrent object. Stores to fresh fields must happen-before the store that makes the object reachable.

---

## Bug 12 — `Range` returns deleted keys

```go
func (s *SkipList) Range(lo, hi int, visit func(int) bool) {
    n := s.findFirst(lo)
    for n != nil && n.key <= hi {
        if !visit(n.key) {
            return
        }
        n = n.next[0].Load()
    }
}
```

**Bug.** The scan walks level 0, calling `visit(n.key)` for every node. It does not check whether `n` is logically deleted. So `Range` reports keys that the user already deleted, as long as the marker has not yet been physically unlinked.

For a user calling `Delete(k)` followed by `Range`, observing `k` is a linearizability violation: the delete returned `true`, so by happen-before, `Range` (which happens-after the delete returned) should not see `k`.

**Fix.** Check the marker before visiting:

```go
func (s *SkipList) Range(lo, hi int, visit func(int) bool) {
    n := s.findFirst(lo)
    for n != nil && n.key <= hi {
        mref := n.mref.Load()
        if !mref.deleted {
            if !visit(n.key) {
                return
            }
        }
        n = mref.next
    }
}
```

Read the marker once into `mref`, then use both `mref.deleted` and `mref.next`. Reading `mref.next` from `n.next[0].Load()` separately would race against a concurrent delete that updates both fields together.

---

## Bug 13 — Use of `unsafe.Pointer` casts to skip atomics

```go
type node struct {
    key  int
    next []unsafe.Pointer // *node, but typed as unsafe.Pointer
}

func (s *SkipList) Contains(key int) bool {
    curr := s.head
    for i := s.maxLevel - 1; i >= 0; i-- {
        for {
            // BUG: plain pointer load, no atomic
            nxt := (*node)(curr.next[i])
            if nxt == nil || nxt.key >= key {
                break
            }
            curr = nxt
        }
    }
    nxt := (*node)(curr.next[0])
    return nxt != nil && nxt.key == key
}
```

**Bug.** The author used `unsafe.Pointer` thinking "well, it's a single pointer-sized word, so the read is atomic on x86." That's true *at the hardware level* — a pointer-sized load is atomic on every modern architecture — but it is not atomic *at the Go memory model level*. The compiler is free to read the field once and cache the value, or to introduce torn re-reads.

The race detector flags this. Without the race detector, the program may work for years and then fail under a different compiler optimization level.

**Fix.** Use `atomic.LoadPointer` or, better, `atomic.Pointer[node]`:

```go
type node struct {
    key  int
    next []atomic.Pointer[node]
}

// In Contains:
nxt := curr.next[i].Load()
```

Never cast away atomicity. The race detector is right.

---

## Bug 14 — Two snapshots interleave updates

```go
type Snapshot struct {
    version int64
    list    *SkipList
}

func (s *SkipList) Snapshot() *Snapshot {
    return &Snapshot{
        version: s.currentVersion.Load(),
        list:    s,
    }
}

func (s *SkipList) Insert(key int) bool {
    s.currentVersion.Add(1) // bump first
    // ... actual insert with new node's version field ...
    n.version = s.currentVersion.Load() // BUG: read AFTER the bump,
                                         // but other inserters may have bumped further
}
```

**Bug.** The version is bumped, then the new node reads the *current* version separately. Between the two operations, another inserter may bump again. The new node's `version` is now higher than the version assigned to its insertion event. Snapshots whose `version` equals the original bump miss the node; snapshots whose `version` equals the later read see it.

The classic invariant violation: the node's stamped version no longer matches the "when did this insert happen" version that snapshots use to filter.

**Fix.** Allocate the version *and* stamp the node in a single atomic step:

```go
func (s *SkipList) Insert(key int) bool {
    n := &node{key: key}
    n.version = s.currentVersion.Add(1)
    // ... continue with linking ...
}
```

`Add` returns the new value. There is no gap between bumping and stamping.

---

## Bug 15 — Recycling nodes through `sync.Pool`

```go
var nodePool = sync.Pool{
    New: func() any { return &node{} },
}

func (s *SkipList) Delete(key int) bool {
    pred, curr := s.findLevel0(key)
    if curr == nil || curr.key != key {
        return false
    }
    pred.next[0].Store(curr.next[0].Load())
    nodePool.Put(curr) // BUG: recycle immediately
    return true
}
```

**Bug.** The node is unlinked and immediately returned to a `sync.Pool`. A concurrent reader, mid-search, is holding a reference to `curr`. The pool hands `curr` to a new insertion, which mutates its key and pointers. The reader now sees corrupt data: the key it expected to be 42 reads as 17, the search direction inverts, the algorithm goes off the rails.

`sync.Pool` is safe for objects that are no longer referenced *anywhere*. In a lock-free data structure, "no longer referenced" requires a proof — hazard pointers, epoch-based reclamation, or a coarse-grained quiescent point.

**Fix.** Two options:

1. **Drop the pool.** Let Go's GC handle reclamation. Modern Go's GC is efficient; the overhead is usually invisible.
2. **Add hazard pointers.** Each search registers a hazard for the nodes it dereferences. `Delete` does not pool the node directly; it pushes onto a retire list. A reclamation pass scans hazards and pools only nodes that no goroutine has hazarded.

For most skip-list use cases in Go, option 1 is correct. The pool is a premature optimization that introduces a class of bug Go's GC was designed to prevent.

---

## Final note

The recurring themes:

- **Use atomics.** Lock-free structures require `atomic.Pointer` for every concurrently mutated link. Plain `*T` is wrong even though x86 makes the load atomic at the hardware level.
- **Mark before you unlink.** A two-phase delete prevents concurrent inserters from losing their writes in the deletion window.
- **Publish last.** Construct the new node fully, then make it reachable in a single atomic store. Reverse the order and readers observe half-constructed objects.
- **Honor the linearization point.** Once `Insert` returns, the key is in. Once `Delete` returns, the key is out. Anything that re-orders, resurrects, or skips around this contract breaks user code that depends on linearizability.
- **Trust Go's GC.** Manual reclamation in a lock-free structure is a research topic. For 95% of production use cases, Go's GC plus `atomic.Pointer` is the right tool.

The remaining 5% — high-throughput memtables, in-memory indexes for distributed databases — is exactly the territory of `github.com/zhangyunhao116/skipset`. Read its source; it is one of the best concurrent-data-structure references in the Go ecosystem.

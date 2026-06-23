---
layout: default
title: Interview
parent: Concurrent Skip List
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/03-concurrent-skip-list/interview/
---

# Concurrent Skip List — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes. Questions are loosely ordered by difficulty.

---

## Junior

### Q1. What is a skip list?

**Model answer.** A skip list is a probabilistic data structure invented by William Pugh in 1990. It is a sorted linked list at the bottom level, with additional sparser linked lists at higher levels acting as "express lanes" for fast traversal. Each new node is assigned a random height; nodes of height `h` appear in levels `0..h-1`. Expected search, insert, and delete cost is `O(log n)`.

**Common wrong answers.**
- "It's a balanced tree." (No — it has no tree structure. It is a stack of linked lists.)
- "It's like a hash table for ordered data." (No — it maintains order; hash tables do not.)
- "It's deterministic `O(log n)`." (No — it is `O(log n)` *in expectation*. Worst case is `O(n)` but vanishingly improbable.)

**Follow-up.** *Why use a skip list instead of a tree?* — Simplicity, especially for concurrent versions. A skip list update touches one vertical column of pointers; a tree update may rebalance along the entire root-to-leaf path. No rotations, no splits.

---

### Q2. Why is a skip list probabilistic?

**Model answer.** Heights are drawn from a geometric distribution: with probability `p` (often `1/2` or `1/4`), a node has height `>= 2`; with probability `p^2`, height `>= 3`; etc. This gives `O(log n)` expected depth without ever needing to rebalance. The randomness "absorbs" the work that a deterministic balanced tree does explicitly through rotations.

**Follow-up.** *Could the heights be adversarial?* — Only if the attacker can influence the random source. The standard fix is to seed each list with a process-private random source. Without that, an attacker could construct a sequence that produces a degenerate skip list (all heights 1), reducing search to `O(n)`.

---

### Q3. Why is `p = 1/2` typical?

**Model answer.** With `p = 1/2`, half of all nodes are at level 0 only, a quarter at levels 0–1, an eighth at levels 0–2, and so on. This gives total pointer count `2n` (constant overhead) and expected depth `log_2 n`. `p = 1/4` (used in Java's `ConcurrentSkipListMap`) cuts memory to `4n/3` with a small constant-factor increase in search depth — a worthwhile trade-off for memory-constrained systems.

**Follow-up.** *What does `MaxLevel` do?* — Caps the height. With `p = 1/2`, `MaxLevel = 16` supports about `2^16 = 65536` keys before the top level becomes "crowded." For larger lists, raise `MaxLevel`.

---

### Q4. What does this print? (Sequential skip list)

```go
sl := newSkipList()
sl.Insert(3, "c")
sl.Insert(1, "a")
sl.Insert(2, "b")
for k, v := range sl.Range(0, 10) {
    fmt.Println(k, v)
}
```

**Model answer.** Prints:
```
1 a
2 b
3 c
```

Skip lists keep keys ordered. `Range` walks the level-0 chain in sorted order.

**Follow-up.** *What if the comparator is reversed?* — Iteration order reverses. The skip list does not care which order; it only needs a consistent total ordering.

---

### Q5. What is the simplest way to make a skip list goroutine-safe?

**Model answer.** Wrap every method with a `sync.Mutex` (or `sync.RWMutex` for reads).

```go
type SafeSkipList struct {
    mu sync.RWMutex
    sl *skipList
}

func (s *SafeSkipList) Get(k int) (string, bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.sl.Get(k)
}
```

Correct, simple, and fine for low-throughput cases. Under contention it serialises everything; throughput cannot exceed single-threaded.

**Follow-up.** *What about `sync.Map`?* — `sync.Map` is unordered and does not support range queries efficiently. A skip list is the ordered alternative.

---

### Q6. How is a skip list different from a binary search tree?

**Model answer.**

| Property | Skip list | BST |
|---|---|---|
| Structure | Stack of linked lists | Tree of nodes |
| Balancing | Randomised heights | Explicit (rotations) |
| Update locality | One vertical column | Path to root |
| Implementation size | Small | Moderate–large |
| Concurrent ease | Easier | Harder (rotations move keys) |
| Cache behaviour | Pointer hops | Pointer hops |

Both give `O(log n)` lookup; the choice between them is mostly about update locality and concurrency.

**Follow-up.** *When is a tree better?* — When you need strict (non-probabilistic) `O(log n)` guarantees, or when you have an existing tree implementation that is already optimised.

---

### Q7. What is the random source for in a Go skip list?

**Model answer.** It produces the height for each new node. Modern Go uses `math/rand/v2` (Go 1.22+), which is goroutine-safe and gives a good PCG/ChaCha8 source. A bad random source (e.g., `time.Now().UnixNano()` mod something) destroys the analysis — heights stop being geometric and the structure degenerates.

**Common bug.** Sharing a `*rand.Rand` (the old API) across goroutines without `Lock`. The old `math/rand` has an internal mutex per default; the *v2* API does not need it because the top-level functions are atomic-clean.

**Follow-up.** *How do you make per-goroutine randomness?* — `rand.New(rand.NewPCG(seed1, seed2))` per goroutine, stored in goroutine-local data (a sync.Pool or function-local var).

---

## Middle

### Q8. Walk through inserting key 5 into this skip list:

```
Level 2: head -----------------> 8 -----> nil
Level 1: head -----> 3 ---------> 8 -----> nil
Level 0: head -> 1 -> 3 -> 4 -> 7 -> 8 -> 9 -> nil
```

Assume the new node has height 2.

**Model answer.**

1. **Search.** At level 2, walk head → 8 (8 > 5, stop). Drop to level 1. Walk head → 3 (3 < 5), then 3 → 8 (8 > 5, stop). Drop to level 0. Walk 3 → 4 (4 < 5), then 4 → 7 (7 > 5, stop).
2. **Record predecessors.** `update[2] = head`, `update[1] = 3`, `update[0] = 4`.
3. **Splice in.** New node height 2, so only levels 0 and 1.
   - `new.next[0] = update[0].next[0] = 7`
   - `new.next[1] = update[1].next[1] = 8`
   - `update[0].next[0] = new` (i.e., `4.next[0] = 5`)
   - `update[1].next[1] = new` (i.e., `3.next[1] = 5`)

Result:

```
Level 2: head -----------------> 8 -----> nil
Level 1: head -----> 3 ---------> 5 -----> 8 -----> nil
Level 0: head -> 1 -> 3 -> 4 -> 5 -> 7 -> 8 -> 9 -> nil
```

**Follow-up.** *Why bottom-up insertion in the concurrent version?* — So the linearisation point (bottom-level CAS) commits the key as "present"; the upper levels are optimisation. If a thread crashes between bottom and top inserts, the structure is still correct, just less efficient.

---

### Q9. What goes wrong with this naive concurrent insert?

```go
func (s *SkipList) Insert(k int) {
    preds, succs := s.find(k)
    new := &node{key: k, height: randHeight()}
    for i := 0; i < new.height; i++ {
        new.next[i] = succs[i]
        preds[i].next[i] = new
    }
}
```

**Model answer.** Many things, but the most damning:

1. **Lost insert.** Between `find` and `preds[0].next[0] = new`, another goroutine can insert into the same gap. Both writes succeed; one disappears.
2. **Pointing to a deleted node.** A concurrent delete may remove `succs[i]` between the `find` and the write. We splice `new.next[i] = succs[i]` to a node that is unreachable; readers at level `i` skip past `new`.
3. **Height mismatch.** Levels are linked in source order. A reader at level 1 may see `new`, while a reader at level 0 has not yet seen it.

**Fix.** CAS the bottom level first; on success, retry upper levels with refreshed predecessors. Each pointer mutation is a CAS, not a plain store.

---

### Q10. What is "lock coupling" in the context of skip lists?

**Model answer.** Also called *hand-over-hand locking*. The thread acquires a lock on the head, then on the head's next, then releases head's lock, then on the next-next, etc. — always holding two consecutive locks while moving forward.

For skip lists, lock coupling means: at each level during search, acquire the predecessor lock before releasing the previous one. By the time you reach the insertion point, you hold the immediate predecessor's lock, so no other thread can splice in between.

**Trade-off.** Eliminates the "predecessor changed under me" race but serialises traversals through hot regions. Throughput peaks lower than CAS-based versions. Used in textbook concurrent skip lists for clarity.

---

### Q11. What is a *marker node*?

**Model answer.** A sentinel node inserted *immediately after* a node being deleted, used in the lock-free skip list of Pugh, Lev/Luchangco/Olszewski, and Java's `ConcurrentSkipListMap`.

Sequence:
```
... pred -> victim -> succ ...
becomes
... pred -> victim -> marker -> succ ...   (marker CAS'd in)
then
... pred -------------------> succ ...      (pred CAS'd to skip past)
```

A reader that follows `pred.next` and lands on `victim`, then reads `victim.next`, sees the marker and treats `victim` as deleted. The marker:

- Has a sentinel key, never compared as a "real" key.
- Is immutable after creation — `marker.next[0]` is never CAS'd again.
- Is only reachable via the victim it tags.

The first CAS (inserting the marker) is the *linearisation point* of the deletion: from that moment, any concurrent reader observes the deletion.

**Follow-up.** *Why not just a "deleted" bit on the node?* — A bit on the node would make the deletion visible, but readers checking the bit must also handle the case where the bit is set but the node hasn't been unlinked. The marker scheme makes both states atomic from the reader's perspective. (The Harris–Michael lemma proves the simpler bit approach has subtle races for inserts vs deletes of adjacent keys.)

---

### Q12. CAS-based insert: trace through this race.

Thread A and B both insert key 5 into a list where `pred = 4, succ = 7`.

**Model answer.**

1. Both threads call `find(5)`, both receive `pred = node(4), succ = node(7)`.
2. Both allocate a new node 5; let's call them `Na` and `Nb`.
3. Both set `Na.next[0] = node(7)` and `Nb.next[0] = node(7)`.
4. Both call `CAS(&pred.next[0], node(7), <theirs>)`.
5. Whoever's CAS happens first wins: say A. `pred.next[0]` is now `Na`.
6. B's CAS sees `pred.next[0] = Na` (not `node(7)`), so it fails.
7. B retries: `find(5)` returns `pred = Na, succ = node(7)` (because `Na.key = 5`, but B is looking for 5, so... actually `succs[0].key == 5 && !marked`, so B's insert short-circuits: the key is already present.

Result: only `Na` is in the list. B discards `Nb`. Correctness preserved.

**Follow-up.** *What if A is inserting 5 and B is inserting 6 at the same gap?* — A's CAS still expects `pred.next = node(7)`. If A wins, B's CAS fails; B retries `find(6)` and gets `pred = Na (key 5), succ = node(7)`. B's CAS succeeds against the new predecessor.

---

### Q13. CAS-based delete: trace through marking key 5.

Initial state:
```
Level 0: ... 4 -> 5 -> 7 -> ...
Level 1: ... 3 -> 5 -> 8 -> ...
```

The deleter of 5 wants to mark and unlink it.

**Model answer.**

1. `find(5)` returns `preds = [4, 3]`, `succs = [5, 5]` (at both levels, the successor *is* 5).
2. **Mark top-down.** At level 1, CAS `node(5).next[1]` from `node(8)` to `marker -> node(8)` (i.e., insert a marker node tagging the 5-at-level-1). Repeat for upper levels if any.
3. **Mark bottom.** CAS `node(5).next[0]` from `node(7)` to `marker -> node(7)`. This is the linearisation point of the delete.
4. **Help unlink.** Call `find(5)` again; the helping logic in `find` notices markers and CAS's `preds[i].next[i]` to skip past the marked nodes.

After step 3, any reader that reaches `node(5)` and reads its `next[0]` sees a marker — interprets as "deleted." So even if the physical unlink in step 4 lags, the key is *logically* gone.

**Follow-up.** *What if two deletes race?* — The first CAS to mark `node(5).next[0]` wins; the second sees it already marked and returns "not present" (which is correct — the key was deleted concurrently).

---

### Q14. Why mark top-down but unlink bottom-up?

**Model answer.** The *bottom-level mark* is the linearisation point. To ensure a reader cannot observe a "the key exists at level 1 but not at level 0" inconsistency, we mark from the top:

- Mark `next[h-1]` first. Readers at level `h-1` may now treat the node as deleted; this is harmless because the deletion *is* about to happen.
- Mark `next[0]` last. Until this moment, the key is logically present (a reader that descends to level 0 sees an unmarked `next[0]`).

If we instead marked bottom-up, there would be a window where `next[0]` is marked but `next[h-1]` is not. A reader at level `h-1` might use the unmarked upper pointer, descend, and only then notice the bottom-level mark — fine, but more inconsistent and harder to reason about.

For unlinking (physical removal of the node), the order does not matter for correctness, but typical implementations unlink at each level eagerly as `find` traverses.

**Follow-up.** *Is the "mark top-down" strict?* — No. As long as the bottom is marked last, the order of the upper marks does not affect linearisability. The standard convention is top-down because it keeps the invariant "if level `i` is unmarked, level `i-1` is also unmarked" visible to debugging.

---

### Q15. What is *helping* in lock-free algorithms?

**Model answer.** When a thread observes a partially completed operation by another thread, instead of waiting for that thread to finish, it pushes the operation forward to completion itself.

In a lock-free skip list, helping happens during `find`. When `find` walks a level and encounters a marked successor, instead of just skipping over it logically, it CAS's the predecessor's pointer to physically unlink the marked node. The original deleter does not need to remain in the picture.

**Why it matters.**
- Removes the dependency on the originating thread completing.
- Gives the lock-freedom guarantee: every traversal makes progress, even if the original thread has been descheduled or crashed.
- Costs almost nothing — the CAS is one instruction on the cache line we are already reading.

**Follow-up.** *Without helping, could a delete be lost?* — Yes. If the deleter marks the node and then is descheduled forever, and no other thread helps, the marker remains and readers correctly see "deleted," but the physical chain has an extra hop forever, degrading future searches.

---

### Q16. How does Go's GC simplify a concurrent skip list?

**Model answer.** Massively. In C or Rust, after a thread unlinks a node, the node *cannot be freed* immediately because other threads may still hold references obtained before the unlink. To free safely, you need hazard pointers or epoch-based reclamation — hundreds of lines of code plus per-operation overhead.

In Go, the GC tracks all live references. Once no live variable holds a pointer to the unlinked node, it is reclaimed in the next GC cycle. No explicit reclamation code needed.

The cost: occasional GC pauses (sub-millisecond on modern Go), and slightly higher memory due to deferred reclamation.

**Follow-up.** *Is this "fair"? Doesn't this ignore the GC cost?* — Yes and no. For most workloads, GC overhead is amortised across all allocations, not specifically charged to the skip list. For latency-critical paths (e.g., HFT), some Go skip lists pre-allocate node pools to avoid GC entirely; this re-introduces hazard-pointer-like complexity.

---

### Q17. How does `sync.Map` differ from a concurrent skip list?

**Model answer.**

| | `sync.Map` | Concurrent skip list |
|---|---|---|
| Keys | Unordered | Ordered |
| Lookup cost | `O(1)` amortised | `O(log n)` expected |
| Range query | Yes, but unordered | `O(log n + k)`, sorted |
| Write throughput | High (lock-free read path, mutex on miss) | High (CAS per level) |
| API | `Load/Store/LoadOrStore/Delete/Range` | Same plus ordered iteration |
| Memory | Amortised | `2n` pointers + values |
| Use case | Hot read-mostly cache | Sorted index, range scans |

If you don't need order, `sync.Map`. If you do, skip list.

**Follow-up.** *What is `sync.Map` internally?* — Two maps: `read` (a copy-on-write read-only `map[interface{}]*entry`) and `dirty` (mutable, mutex-protected). Reads hit the lock-free `read`; misses fall through to `dirty` and may promote the entry. Optimised for write-once-read-many.

---

### Q18. What is the linearisation point of `Insert`?

**Model answer.** The successful CAS that swings the bottom-level predecessor's `next[0]` pointer to the new node. From that moment on, every reader's `Get` either returns the new node or returns a "not-present" result that linearises before the insert.

The upper-level CAS's are not linearisation points; they are optimisations. A reader can observe the new key purely by walking level 0 (just slowly).

**Follow-up.** *What if the insert is updating an existing key?* — The linearisation point is the `atomic.Store` (or CAS) on the existing node's `value` pointer.

---

### Q19. What is the linearisation point of `Delete`?

**Model answer.** The successful CAS that marks `victim.next[0]`. After this CAS, every reader observes the node as deleted: any traversal that reaches the victim reads its `next[0]`, sees the marker, and treats the victim as gone.

Marking the upper levels happens before; unlinking happens after. Neither is the linearisation point.

**Follow-up.** *What if the deleter dies between marking and unlinking?* — The marker is still there; future traversals help unlink. The key is correctly deleted; only the unlink work is deferred. Lock-freedom guarantees this terminates.

---

## Senior

### Q20. Describe the Harris–Michael lemma and why marker nodes solve it.

**Model answer.** Harris and Michael showed that a lock-free singly linked list using only a "deleted" bit on outgoing pointers has a subtle race:

> Two concurrent inserts between the same `(pred, succ)` pair, combined with a concurrent delete of `succ`, can produce a state where one inserted node is unreachable.

The mechanic: thread A inserts `x` between `pred` and `succ`. Concurrently, thread C marks `succ.next` (logically deleting `succ`). Thread B, which was preparing to insert `y` between `pred` and `succ`, retries — but by now `pred.next = x`, not `succ`. B's CAS fails; B reads the new chain `pred -> x -> succ`. B updates its insertion to be `(x, succ)`. B's CAS succeeds. But concurrent unlink of `succ` (because of C's mark) may have rewritten `x.next` to skip past `succ`, splicing past B's insertion.

Marker nodes fix this by encoding the deletion as a *node in the chain* rather than a bit on a pointer. Any traversal sees the marker as part of the chain, never as "deletion in progress." Specifically: the marker is immutable after creation, so once a reader follows `pred -> victim -> marker`, the marker's `next[0]` will always be consistent with what the deleter wrote at marker creation time.

**Follow-up.** *Are marker nodes strictly necessary, or are there alternatives?* — The Harris "tagged pointer" approach also works, with more subtle reasoning. Markers are cleaner; they trade slightly more memory (one extra allocation per delete) for substantially simpler proofs.

---

### Q21. What memory ordering does Go's `sync/atomic` provide, and how does it affect skip list correctness?

**Model answer.** Since Go 1.19, the Go memory model specifies:

> All the atomic operations executed in a program behave as though executed in some sequentially consistent order.

This is stronger than C++11's "acquire/release." Every atomic operation on every address is observed by every goroutine in some global total order. In practice this means:

- A CAS that publishes a pointer to a new node serves as both a release (the new node's fields are visible) and an acquire (for the reader that observes the new pointer).
- We do not need to insert explicit fences.
- A read of a field is ordered with respect to every atomic on the same field.

This vastly simplifies the algorithm's correctness argument. C++ implementations of the same algorithm must annotate every atomic operation with `std::memory_order_release` or `std::memory_order_acquire` (or accept the sequentially consistent default with its performance penalty).

**Follow-up.** *Is there a cost?* — Yes. Sequentially consistent atomics emit slightly more expensive instructions (e.g., `xchg` on x86, full barriers on ARM). Go accepts this cost for correctness simplicity.

---

### Q22. Implement `Contains(key)` for a lock-free skip list. How does helping fit in?

**Model answer.**

```go
func (s *SkipList[K, V]) Contains(key K) bool {
    x := s.head
    for i := s.maxLevel - 1; i >= 0; i-- {
        for {
            nxt := x.next[i].Load()
            if nxt == nil {
                break
            }
            if nxt.isMarker || s.isMarked(nxt) {
                // Help unlink — CAS x.next[i] past the marker
                successor := nxt.next[i].Load()
                x.next[i].CompareAndSwap(nxt, successor)
                continue   // restart this level
            }
            if s.cmp(nxt.key, key) >= 0 {
                break
            }
            x = nxt
        }
    }
    final := x.next[0].Load()
    return final != nil && !final.isMarker && s.cmp(final.key, key) == 0
}
```

The helping is the inner block: whenever we see a marker, we attempt to splice past it. The CAS may fail (someone else helped); we retry by re-reading.

**Follow-up.** *Why is helping in a read-only path useful?* — It accelerates reclamation. Without it, marked nodes accumulate, slowing subsequent reads. With it, every reader pays a small cost to keep the structure clean — amortised, this matches the write throughput.

---

### Q23. Explain hazard pointers and why Go does not need them for skip lists.

**Model answer.** Hazard pointers (Michael 2004) are a memory-reclamation technique for lock-free data structures in non-GC languages.

Each thread maintains a small array of "hazard pointers" — addresses it is currently using. Before dereferencing a shared pointer, the thread:

1. Reads the pointer `p`.
2. Stores `p` in its hazard array.
3. Re-reads to verify; if `p` changed, restart.

To free a node, the deleter:

1. Unlinks the node.
2. Adds it to a thread-local "retired" list.
3. Periodically scans all hazard arrays; nodes not referenced are freed.

Costs: 2 memory barriers per pointer follow; constant per-thread space; scan cost amortised.

Go does not need hazard pointers because the GC achieves the same goal: nodes are freed when no live variable holds a reference. The GC scans roots and heap; once no goroutine has a pointer to a node, the node is reclaimed.

**Trade-offs.** Hazard pointers give bounded memory (proportional to thread count); GC gives bursty memory (deferred reclamation). For most workloads GC wins on simplicity; for latency-critical paths, hazard pointers can win.

**Follow-up.** *Could you implement hazard pointers in Go on top of the GC?* — Yes; you would use `runtime.SetFinalizer` or maintain explicit retired lists. The GC would still claim the memory, but you would add a "logical free" step for instrumentation. Rarely worth it.

---

### Q24. Compare epoch-based reclamation (EBR) with hazard pointers.

**Model answer.**

| Aspect | Hazard pointers | EBR |
|---|---|---|
| Per-operation cost | 2 fences per pointer load | 1 cache-line load (current epoch) |
| Memory bound | Tight (proportional to thread count) | Loose (proportional to thread slowness) |
| Implementation | Complex (publish/verify protocol) | Moderate (epoch counters) |
| Resistance to slow threads | Excellent | Poor — a slow thread prevents reclamation |
| Where used | C++ standard library, MongoDB | Rust crates (crossbeam), some Linux kernel modules |

**Follow-up.** *What if you used EBR in a multi-tenant Go service?* — Risky: a goroutine stuck in a long syscall could prevent reclamation for the entire process. GC is safer. Use EBR only when GC's pause is unacceptable and you can bound goroutine stall time.

---

### Q25. Implement `Range(from, to)` correctly for a lock-free skip list.

**Model answer.**

```go
func (s *SkipList[K, V]) Range(from, to K, yield func(K, V) bool) {
    // Find the leftmost node >= from
    x := s.head
    for i := s.maxLevel - 1; i >= 0; i-- {
        for {
            nxt := x.next[i].Load()
            if nxt == nil || s.cmp(nxt.key, from) >= 0 {
                break
            }
            if nxt.isMarker {
                successor := nxt.next[i].Load()
                x.next[i].CompareAndSwap(nxt, successor)
                continue
            }
            x = nxt
        }
    }
    // Walk level 0 until we hit `to`
    cur := x.next[0].Load()
    for cur != nil && s.cmp(cur.key, to) < 0 {
        if !cur.isMarker && !s.isMarked(cur) {
            val := cur.val.Load()
            if val != nil {
                if !yield(cur.key, *val) {
                    return
                }
            }
        }
        cur = cur.next[0].Load()
    }
}
```

Guarantees:

- Sorted, monotonic non-decreasing order.
- No key is yielded twice.
- No key outside `[from, to)` is yielded.
- A key continuously present throughout iteration is always yielded.
- A key inserted or deleted during iteration may or may not be yielded.

This is the "weak iterator" semantics of `java.util.concurrent.ConcurrentSkipListMap`.

**Follow-up.** *How would you provide snapshot iteration?* — Maintain an immutable copy under `atomic.Pointer`; readers atomically load the snapshot at the start of iteration. Writers update the live tree and periodically rebuild the snapshot. Costs: snapshot memory and write amplification.

---

### Q26. Why is the *bottom-level CAS* the linearisation point of insert?

**Model answer.** Three reasons:

1. **Every reader eventually drops to level 0.** A `Contains` or `Get` walks the upper levels for efficiency, then descends to level 0 to finalise the answer. So the final reading point is always at level 0.
2. **Level 0 is the bottom of the data structure's truth.** Upper levels are "express lanes" — they accelerate search but do not contain any information not at level 0.
3. **A node not yet linked at upper levels is still findable.** A reader that misses an upper-level shortcut just walks more nodes at level 0; it still finds the key. The reverse is not true: a node linked at upper levels but not at level 0 would be findable only sometimes (depending on the search path).

Therefore: the moment a node becomes reachable on level 0, it is "present" for any reader. The CAS that splices it in is the linearisation point.

**Follow-up.** *Is the same true for delete?* — Yes, mirrored. Marking `next[0]` is the linearisation of delete; any reader that reaches the node and reads its `next[0]` sees the marker.

---

### Q27. What if `random.Uint32()` returns a biased distribution? Concretely, what fails?

**Model answer.** The geometric distribution assumes uniform random bits. If, e.g., the source produces only even numbers, half the levels never get "promoted," and the structure degenerates. Specifically:

- If `P(coin = heads) = 0.9` (instead of 0.5): most nodes have very high `h`. Insert cost becomes `O(MaxLevel * log_2 n)` because every CAS targets all levels. Memory inflates by `MaxLevel / 2`.
- If `P(coin = heads) = 0.1`: most nodes have `h = 1`. Search degenerates to `O(n)` because no shortcuts exist.

Concrete failure mode: an adversary controls the random source (e.g., HashDoS analog) and constructs a sequence that makes search `O(n)`. Mitigation: per-process random source seeded at startup, not exposed.

**Follow-up.** *Should the random source be cryptographic?* — Not necessarily. Cryptographic randomness (`crypto/rand`) is slower. `math/rand/v2`'s PCG is unpredictable enough for non-adversarial workloads. For adversarial input, use a keyed hash of the input plus a process-private seed.

---

### Q28. Trace through a 3-thread race: A inserts 5, B inserts 5, C deletes 5.

**Model answer.** Suppose all three operations are issued simultaneously on an empty list with just sentinels.

1. A and B both compute `pred = head, succ = tail`. C also computes the same and finds no key 5 — returns immediately with "not found."

(If 5 is being inserted concurrently, C's outcome depends on whether C's `find` happens before or after the inserts.)

2. A CAS's `head.next[0] = Na`. Suppose A wins.

3. B's CAS expects `head.next[0] = tail`; sees `Na`; CAS fails.
4. B retries: `find(5)` returns `pred = Na, succ = tail`. B's logic: `succs[0].key == 5 && !marked(succs[0])` → key already present. B returns the existing node (which is Na).

5. C re-runs `find(5)` (because its first attempt was racy or because C is the retry-style delete). This time `find(5)` returns `succs[0] = Na`. C proceeds to mark `Na.next[0]`.

6. C's CAS: `Na.next[0]` from `tail` to `mark(tail)`. Succeeds.

7. The next reader sees `head.next[0] = Na`, walks to `Na`, reads `Na.next[0]`, sees a marker — treats `Na` as deleted.

End state: A's insert was "first," B's insert was a no-op (key already present, returned A's node), C's delete linearised after both inserts and successfully removed the key.

**Linearisation order: A.insert → B.insert (as no-op) → C.delete.**

**Follow-up.** *What if C started before A?* — C's `find(5)` returns `succs[0] = tail` (key not present). C returns "not found" immediately. A and B's inserts both attempt to add 5; one wins. C's delete linearised before either insert, so its "not present" result is correct.

---

### Q29. How would you test a concurrent skip list?

**Model answer.** Layered testing:

1. **Sequential tests.** Insert / delete / search in a single goroutine. Verify ordering, count, no duplicates.

2. **Linearisation tests.** Run N goroutines doing random operations, log every operation with a timestamp range, then check that *some* serial ordering of operations could explain the results. Use libraries like `https://github.com/anishathalye/porcupine`.

3. **Race detector.** `go test -race`. Any field read without atomic, any lock missed, will be caught.

4. **Property-based tests.** With `https://github.com/leanovate/gopter`: generate sequences of operations, run them on the concurrent skip list and on a sequential `map[K]V` "oracle," verify post-conditions match.

5. **Stress tests.** Long-running tests with thousands of goroutines, monitoring for goroutine leaks (`go.uber.org/goleak`), memory leaks (`pprof`), or crashes.

6. **Chaos tests.** Random goroutine pauses (`runtime.Gosched`, `time.Sleep`) inside the algorithm to widen race windows.

**Follow-up.** *Is `go test -race` enough?* — No. The race detector catches data races (unsynchronised access to the same memory) but not high-level linearisability bugs. You also need explicit linearisation testing.

---

### Q30. The `value` field — how should it be stored to allow concurrent updates?

**Model answer.** Two options:

1. **Replace the whole node.** On update, allocate a new node with the new value, CAS the predecessor's `next[0]` to point to it, then mark the old node. Simple, costs an extra allocation per update.

2. **`atomic.Pointer[V]` for the value field.** On update, `node.val.Store(&newV)`. Cheap, no structural change. Updates are linearisable on the store.

Option 2 is standard. The node remains in the structure; only the value pointer changes.

```go
type node[K Ordered, V any] struct {
    key  K
    val  atomic.Pointer[V]
    next []atomic.Pointer[node[K, V]]
}

func (n *node[K, V]) update(v V) {
    n.val.Store(&v)
}
```

**Follow-up.** *What if `V` is a small primitive like `int64`?* — Use `atomic.Int64`; no pointer needed. Saves an allocation per update.

---

## Staff

### Q31. Discuss the trade-off between marker nodes and tag-bit pointers.

**Model answer.**

**Marker nodes (Java / Pugh / Lev):**

- One extra heap allocation per delete (the marker node).
- Atomic pointer field — no special low-bit handling.
- Memory model: standard atomic pointer ops.
- Implementation: ~600 lines for a full Go skip list.
- Garbage collected freely.

**Tag-bit pointers (Harris / Fraser):**

- No extra allocations on delete.
- Pointer values carry a low-bit flag (`unsafe.Pointer` with bit 0 set = marked).
- Requires `unsafe`; not strictly within Go's safety model.
- Memory model: same atomic ops, but unmasking on every read.
- Implementation: smaller (~400 lines).
- Faster on tight benchmarks (no marker allocation in the hot path).

In Go, the marker-node approach is conventional because:
1. GC removes the cost of the extra allocation almost entirely.
2. `unsafe` is discouraged in library code that other Go projects depend on.
3. Reasoning about correctness is simpler.

In C++ or Rust, the tag-bit approach is more common because the allocator cost is real.

**Follow-up.** *Could you mix the two?* — Yes; some implementations use marker nodes for the marker semantics but tag the predecessor's outgoing pointer for fast detection. Rarely worth the complexity.

---

### Q32. How would you shard a skip list to improve write throughput?

**Model answer.** *Sharded skip lists* — partition the key space into `K` shards, each a separate skip list with its own lock or lock-free protocol. A top-level dispatcher maps each key to a shard via a hash or order-preserving function.

```go
type Sharded[K Ordered, V any] struct {
    shards [N]*SkipList[K, V]
    hash   func(K) int
}

func (s *Sharded[K, V]) Get(k K) (V, bool) {
    return s.shards[s.hash(k) % N].Get(k)
}
```

**Trade-offs.**

- Pro: linear throughput scaling with `N` for random-key workloads.
- Con: range queries must visit all shards (or use order-preserving hashing).
- Con: shard imbalance under skewed key distributions.

**When to use:** when single-shard CAS contention dominates. For `~1 GB/s` write workloads.

**Follow-up.** *What is the trade-off with order-preserving sharding (i.e., key-range partitioning)?* — Preserves cheap range queries (one shard typically suffices) but vulnerable to hot-key skew. Hash-based sharding randomises load but makes range queries `O(N * log n)` instead of `O(log n + k)`.

---

### Q33. A profiler shows that `find` is dominated by cache misses. What can you do?

**Model answer.** Skip lists' worst trait is poor cache locality: each pointer hop is to a potentially uncached node. Mitigations:

1. **Increase fanout.** Replace each level with a node holding multiple keys (a *skiplist of nodes*, where each node is a sorted array of keys). Lookups within a node are cache-line-local; only inter-node hops cost cache misses.

2. **Prefetch.** When reading `node.next[0]`, prefetch `node.next[0].next[0]` for the next iteration. `runtime/internal` does not expose user prefetch, but `unsafe` tricks can. Limited returns.

3. **Layout for the CPU.** Co-locate `key`, `val`, and `next[0]` in the first cache line. Push less-used fields (level, isMarker) to a second cache line.

4. **Sharded skip list.** Cheaper than tuning a single one; each shard fits in cache.

5. **Switch to a B+tree.** If reads dominate and writes are infrequent, the B+tree's pages give superior cache use. This is why on-disk databases use B+trees, not skip lists.

**Follow-up.** *Is there a hybrid?* — Yes: *bw-tree* (Microsoft, 2013) combines a B+tree-like layered structure with lock-free updates. Used in SQL Server's Hekaton engine. Complex but fast.

---

### Q34. Walk through `zhangyunhao116/skipset`'s strategy.

**Model answer.** `github.com/zhangyunhao116/skipset` is one of the most-starred Go concurrent skip set libraries. Key design choices:

1. **Marker nodes**, not tagged pointers. Each `node` has a boolean `flags` field with bits for `marked` (logically deleted) and `fullyLinked` (insert complete).

2. **Optimistic locking with per-node mutexes** for inserts and deletes. The `find` phase is lock-free; only the splice phase locks. This is *not* a fully lock-free skip list — it is optimistic-pessimistic hybrid (similar to Herlihy/Shavit's optimistic algorithm).

3. **Level 0 read path is fully lock-free.** Reads never block.

4. **GC reclamation.** No hazard pointers.

5. **Specialised implementations per primitive type** (int, string, float64) via code generation to avoid `interface{}` boxing. Generics added in a later version.

The result: read throughput close to `sync.Map`, write throughput several times higher than a mutex-wrapped sequential skip list, ordering preserved.

**Follow-up.** *Why isn't it fully lock-free?* — The optimistic-with-locks variant is empirically faster in Go because:
- Go's CAS on `unsafe.Pointer` is slightly slower than `sync.Mutex` under low contention (Mutex spin path is heavily tuned).
- Lock acquisition gives a clean memory ordering boundary without manual reasoning.
- The mutex is per-node, so contention is local.

Pure lock-free wins under extreme contention; the hybrid wins in the common case.

---

### Q35. How would you implement a snapshot-iteration mode without copying the entire structure?

**Model answer.** Several approaches:

1. **Persistent / functional skip list** (Pugh's 1990 paper sketches this). Each modification creates a new node and updates only the affected predecessors; old versions remain reachable through their old predecessors. Snapshot = "root pointer at time T." Costs: every update writes `O(log n)` new nodes; old versions stay alive until no snapshot holds them.

2. **MVCC (multi-version concurrency control).** Each node holds a list of `(timestamp, value, tombstone)` entries. A snapshot at time `T` reads the most recent version with `timestamp <= T`. Costs: per-node memory grows with version count; GC of old versions requires a separate vacuum phase.

3. **Copy-on-write snapshot.** Maintain `current` and `snapshot` versions. Reads at snapshot use the snapshot; writes go to current; periodically rebuild snapshot from current. Costs: two copies of the structure; bounded write amplification.

In Go, the persistent approach is most elegant: the GC handles old-version reclamation naturally. RocksDB-style MVCC is overkill for in-memory use.

**Follow-up.** *What if iteration is rare?* — Read-copy-update style: writers block readers only during the swap moment (atomic pointer load/store of the root). For very rare snapshots this is fine.

---

### Q36. Why might a skip list outperform a balanced tree in concurrent benchmarks even though both are `O(log n)`?

**Model answer.** Three reasons:

1. **Update locality.** A skip list update modifies `O(log n)` *independent* pointers, each settable with a single CAS. A balanced tree update may rebalance along the full path (rotations); each rotation moves multiple pointers and may require locking adjacent nodes.

2. **No restructuring under concurrency.** A red-black tree under concurrent updates needs to coordinate rotations between writers; rotations are not commutative. A skip list has no rotations; concurrent writers in disjoint key ranges never conflict.

3. **Simpler correctness.** Simpler algorithms are easier to optimise. Skip list code is short enough to be hand-tuned, profiled, and inlined.

**Where trees still win.** Memory: a balanced tree with parent pointers can be compact. Cache: contiguous arrays of keys per node (B+tree style) beat scattered skip list nodes.

**Follow-up.** *What about a concurrent B+tree?* — Doable, very complex. PostgreSQL's btree access method is hundreds of thousands of lines. `bw-tree` (Microsoft) is a lock-free B+tree variant; it is among the most complex data structures in production use.

---

### Q37. Bonus: how does LevelDB use a skip list?

**Model answer.** LevelDB (and RocksDB, BadgerDB, CockroachDB Pebble) uses a skip list as the *memtable* — the in-memory write buffer.

- Every write goes to the memtable as a single key/value insert.
- Reads check the memtable first, then the SSTables on disk.
- When the memtable fills (configurable threshold, e.g., 64 MB), it is flushed to disk as a new SSTable, and a fresh memtable replaces it.

Why a skip list (not a btree)?
- Concurrent inserts with no global lock.
- Ordered iteration for flushing (write keys in sorted order to SSTable).
- Simple memory management — the entire memtable is dropped after flush.
- Variable-size node allocations are easy in C++ (LevelDB uses an arena allocator).

LevelDB's skip list source (`db/skiplist.h`) is ~300 lines — illustrating just how compact the algorithm is.

**Follow-up.** *Could you use a B+tree memtable?* — RocksDB has experimented with this (the "Vector" memtable). The result: comparable performance but more code. The skip list won out for its simplicity-to-performance ratio.

---

### Q38. Design exercise: an LRU cache backed by an ordered concurrent index. How does a skip list help?

**Model answer.** Classic LRU: a `map[K]*entry` + a doubly-linked list. Concurrent LRU is hard because the linked list update is global.

**Skip-list-backed LRU.** Instead of a linked list, use a skip list ordered by *last-access timestamp*. Each access updates the entry's timestamp (atomically) and *re-inserts* it at the new position.

Pseudo-API:
```go
type LRU[K, V] struct {
    cap   int
    index map[K]*entry   // O(1) lookup
    order *SkipList[time.Time, *entry]   // ordered by access time
}

func (c *LRU) Get(k K) (V, bool) {
    e := c.index[k]
    if e == nil { return zero, false }
    c.order.Delete(e.ts)
    e.ts = time.Now()
    c.order.Insert(e.ts, e)
    return e.v, true
}

func (c *LRU) Evict() {
    oldest := c.order.RangeFirst()   // O(log n)
    c.order.Delete(oldest.ts)
    delete(c.index, oldest.k)
}
```

Trade-offs vs linked-list:
- Eviction is `O(log n)` instead of `O(1)`.
- But: concurrent updates work without a global lock.
- Re-insertion on every `Get` is expensive; in practice, use a "freshness threshold" — only re-insert if `now - e.ts > threshold`.

**Follow-up.** *Is this used in practice?* — `bigcache` (Allegro) and `ristretto` (Dgraph) use simpler approaches (shards + tinylfu / clock); skip-list-backed LRUs are rarer because the re-insertion cost is real. But for ordered eviction policies (e.g., "evict items older than T"), skip lists are a clean fit.

---

### Q39. Bonus: under what conditions does the lock-free skip list lose to a `sync.RWMutex`-wrapped sequential skip list?

**Model answer.** Three scenarios:

1. **Very low contention.** With one or two goroutines, the lock-free version pays CAS overhead on every operation; the locked version pays only one mutex per call. The locked version wins.

2. **Read-mostly workloads with cache locality.** A read-locked `RWMutex` lets all readers proceed; the underlying sequential algorithm is faster than the lock-free version's "load, check marker, retry on marker" loop.

3. **Sharded access (one goroutine per shard).** No contention at all; lock-free overhead is pure cost.

**When lock-free wins:**
- Mixed read/write, 4+ goroutines.
- Write-heavy workloads.
- Latency-sensitive (no lock-induced jitter).
- Workloads where one slow goroutine cannot be allowed to block others.

**Practical advice.** Benchmark both for your workload. Don't assume "lock-free = faster"; the simplicity of `sync.RWMutex + sequential skip list` is often the right answer.

---

### Q40. Design a "delete by predicate" operation: `DeleteIf(func(K, V) bool)`. What are the linearisability concerns?

**Model answer.** A naive implementation:

```go
func (s *SkipList) DeleteIf(pred func(K, V) bool) {
    for k, v := range s.Range(minK, maxK) {
        if pred(k, v) {
            s.Delete(k)
        }
    }
}
```

This is **not** linearisable as a single atomic operation. It is a sequence of independent reads and deletes. Concurrent updates may interleave:
- A key that satisfied `pred` at read time may be updated to no longer satisfy by delete time.
- A new key satisfying `pred` may be inserted after iteration started; the delete won't see it.
- A different concurrent delete may remove the key first.

To make `DeleteIf` *appear* atomic — i.e., linearisable to some single moment — we would need either:

1. **A global write lock for the duration** (defeats the lock-free design).
2. **A snapshot iteration + CAS-per-delete** with reconciliation: read the snapshot, mark candidates, then attempt delete only if the current value still matches the snapshot value.

Most practical implementations document `DeleteIf` as *weakly consistent*: the predicate is evaluated some time during the call, deletes happen based on those evaluations, and concurrent updates may interleave. This is the same trade-off as `Range`.

**Follow-up.** *What if I really need atomic semantics?* — Reach for a `sync.RWMutex` and call `DeleteIf` under the write lock. Or accept that the concurrent skip list is not the right structure for this operation.

---

## Summary

- **Junior:** what a skip list is, why probabilistic, simplest concurrent version (coarse lock).
- **Middle:** marker nodes, CAS-based insert/delete, helping, `sync.Map` vs skip list, GC simplicity.
- **Senior:** Harris–Michael lemma, memory ordering, hazard pointers vs GC, linearisation points.
- **Staff:** sharding, cache locality, real-world libraries, MVCC snapshots, design-level trade-offs.

The recurring theme: concurrent skip lists work because each modification touches a thin, vertical column of pointers. Markers and CAS make those touches atomic; Go's GC handles reclamation; the memory model gives free fences. The result is a data structure that fits in ~600 lines, scales to millions of keys, and reliably outperforms naive mutex wrappers under contention.

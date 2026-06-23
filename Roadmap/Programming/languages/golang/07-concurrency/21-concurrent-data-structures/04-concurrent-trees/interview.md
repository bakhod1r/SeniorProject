---
layout: default
title: Interview
parent: Concurrent Trees
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/04-concurrent-trees/interview/
---

# Concurrent Trees — Interview Questions

## Junior Level

**Q1. What is a B-tree, and how is it different from a hash map?**

A: A B-tree is an ordered, balanced search tree that holds many keys per node (typically 16-64). Operations are `O(log n)`. Unlike a hash map, a B-tree supports ordered iteration, range queries, predecessor/successor lookups, and "min" / "max" queries — all in `O(log n)` or `O(log n + k)`. A hash map is `O(1)` for point access but has no ordering.

**Q2. Why is `google/btree` not safe for concurrent writes?**

A: The library's documentation explicitly states that write operations are not safe for concurrent mutation. Multiple writers calling `ReplaceOrInsert` or `Delete` concurrently can corrupt the tree's internal node structure. The caller must enforce serialization with an external `sync.Mutex` or `sync.RWMutex`.

**Q3. When would you choose `sync.RWMutex` over `sync.Mutex`?**

A: When the workload is read-heavy (e.g., >80% reads). `RWMutex` allows multiple readers concurrently, while writers are exclusive. For write-heavy workloads, plain `Mutex` is faster because `RWMutex` has slightly more overhead.

**Q4. What is a goroutine "leak" in a tree iteration context?**

A: If a goroutine takes the read lock and iterates the tree but never releases the lock (e.g., due to a panic without `defer Unlock`), subsequent writers block forever. Always use `defer mu.Unlock()`.

**Q5. Write a thread-safe wrapper around `google/btree.BTreeG`.**

A: 

```go
type SafeBTree struct {
    mu sync.RWMutex
    bt *btree.BTreeG[Item]
}

func (s *SafeBTree) Set(it Item) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.bt.ReplaceOrInsert(it)
}

func (s *SafeBTree) Get(k int) (Item, bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.bt.Get(Item{Key: k})
}
```

**Q6. What does "callback runs under the lock" mean for tree iteration?**

A: When you call `tr.Ascend(fn)` while holding the read lock, `fn` is called while the lock is still held. If `fn` calls back into the tree (e.g., `tr.Set(...)`), the goroutine deadlocks because it tries to take the write lock while holding the read lock.

**Q7. Why does Go's `range` not work on a tree?**

A: A B-tree is not a slice or map, so `range` does not apply. Instead, the library provides callback-style iteration: `tr.Ascend(func(it Item) bool { ... return true })`.

---

## Middle Level

**Q8. Explain hand-over-hand locking.**

A: Each tree node has its own lock. To traverse, a goroutine locks the root, finds the right child, locks the child, then releases the root. It holds at most two locks at any moment. Other goroutines can be walking different parts of the tree simultaneously.

**Q9. What is optimistic concurrency control (OCC) on a tree?**

A: Each node has a version counter. Readers do not take locks; they read the fields, then check the version. If the version is odd (writer in flight) or changed (mutation during read), they retry. Writers take a per-node mutex, increment the version twice (odd, then even), and mutate. Readers and writers do not block each other except on retries.

**Q10. Describe the publish/subscribe COW pattern.**

A: A writer maintains a "live" tree and a published snapshot pointer. Each write mutates the live tree, takes a cheap COW snapshot, and atomically stores it as the published pointer. Readers load the published pointer and walk the snapshot without locks. Old snapshots are garbage-collected when no reader holds them.

**Q11. What is the Lehman-Yao B-link tree?**

A: A B+-tree variant where each node has a right-sibling pointer and a "high key" (largest key reachable through this node). When a node splits, the new sibling is published *before* the parent is updated. In-flight readers who land in the wrong half follow the right-sibling pointer to find their key. This eliminates the need to re-latch the parent after a concurrent split.

**Q12. Why does Go's GC subsume RCU?**

A: RCU (Read-Copy-Update) requires deferred reclamation: old memory cannot be freed until all in-flight readers finish. In Go, the garbage collector observes reachability automatically. As long as no goroutine retains a pointer to an old node, it is collected. No explicit epoch mechanism is needed.

**Q13. When is COW publish/subscribe the wrong choice?**

A: When writes are 50%+ of operations, the per-write snapshot allocation may dominate. When writers need "read your own writes" immediately (without reloading the snapshot), it is awkward. When memory is tight, the snapshot pinning can be expensive.

**Q14. How would you implement an LRU cache with ordered eviction?**

A: A B-tree of `(lastAccessTime, key)` for ordered eviction plus a `map[key]Entry` for `O(1)` lookup. On `Get`, delete the old entry from the tree, update its `lastAccessTime`, re-insert. On insert, if size exceeds capacity, `DeleteMin` from the tree and remove from the map. Under one mutex, it all works.

**Q15. What is sharding, and when does it help?**

A: Divide the keyspace by a hash function into N independent sub-trees, each with its own mutex. Point access scales linearly with N. Cross-shard range queries become more complex (fan-out + merge).

---

## Senior Level

**Q16. Design an in-memory concurrent ordered key-value store for 1M reads/sec and 100k writes/sec.**

A: Publish/subscribe COW with `tidwall/btree`. Single writer mutex; atomic.Pointer-published snapshot for reads. Reads are lock-free; writes are serialized but cheap. Throughput estimate: easily 1M reads/sec, 100k writes/sec on modern hardware. If write throughput is borderline, shard by hash into 4-16 shards.

**Q17. Walk through the Lehman-Yao split protocol.**

A: When a leaf L is full and an insert occurs: allocate new leaf M with upper half of items; set M.highKey = L.highKey, M.rightSib = L.rightSib; atomically set L.highKey = median-1, L.rightSib = M (this is the publication point); release latch on L; eventually update the parent. In-flight readers on L who see key > L.highKey follow L.rightSib to M.

**Q18. How does MVCC garbage collection work?**

A: Each version has XMin (created) and XMax (deleted, or 0). A version is safe to reclaim when XMax is set, XMax is committed, and XMax < oldest active snapshot. A background process scans rows and prunes old versions.

**Q19. What is snapshot isolation, and how is it different from serializable?**

A: SI: each transaction sees a consistent snapshot at its start; concurrent writes are not visible. Write-write conflicts cause abort. Serializable: every transaction appears to execute in some serial order; both write-write and read-write conflicts cause abort. SI allows write-skew anomalies; serializable does not.

**Q20. Why does PostgreSQL nbtree defer merges?**

A: Merges complicate the B-link protocol significantly. PostgreSQL marks deletes as tombstones and lets the VACUUM process merge sparse pages lazily. This trades index density for protocol simplicity and concurrency.

**Q21. Compare hand-over-hand to publish/subscribe COW.**

A: Hand-over-hand: per-node mutexes, write throughput scales with disjoint paths, more complex implementation. COW: lock-free reads, per-write path copy, snapshot pinning consumes memory. For Go, COW is the simpler and faster default for read-heavy workloads.

**Q22. Design a metrics server with per-series time indexes.**

A: One `tidwall/btree` per series, keyed by timestamp. A top-level `map[seriesKey]*Series` (with `RWMutex`) maps series names to their tree. Each series's tree uses publish/subscribe COW. Writes go to the relevant series's tree; reads query the snapshot. Eviction by a background goroutine prunes old timestamps. Throughput: millions of writes/sec across many series.

**Q23. Why is implementing a Bw-tree usually a bad idea?**

A: It is genuinely hard. The protocol has many subtle correctness considerations (delta chain consolidation under concurrency, split propagation, epoch reclamation). Bug rates are high. Reasonable alternatives (COW publish/subscribe with `tidwall/btree`) handle 99% of needs with a fraction of the complexity. Implement a Bw-tree only if you are building a database engine and have measurement-backed evidence that COW is insufficient.

**Q24. How do you debug a concurrent tree?**

A: First, `go test -race -count=100`. Then add invariant assertions (e.g., "after Set, the tree contains the key"). Then profile with `pprof` to find hot spots and contention. Then use `runtime/trace` to see goroutine scheduling and blocking. For protocol design bugs, model checkers (TLA+) help.

**Q25. What is the cost of a `tidwall/btree.Copy()` followed by a series of writes?**

A: `Copy()` is `O(1)`. Each subsequent write to either tree triggers path-copy of `O(log n)` nodes (those with refcount > 1). For a tree with 1M entries (~5 levels), that is ~5 nodes per write, ~5 KB. For 1000 writes after a Copy, ~5 MB allocated. Acceptable for typical workloads; batch writes to reduce churn.

---

## Staff Level

**Q26. Architect a Hekaton-class in-memory transactional engine in Go.**

A: Sketch:

- Per-table primary index: `tidwall/btree` with COW publish/subscribe per shard (16 shards).
- Per-table secondary indexes: same structure.
- Row storage: per-row mutex with version chains.
- Transactions: ID counter, snapshot at Begin, validation at Commit, commit log.
- MVCC: per-row XMin/XMax; visibility predicate consults commit log.
- WAL: group commit with `fsync` per ~1 ms.
- GC: background goroutine reclaims versions older than oldest snapshot.

Throughput: ~100k tx/sec, ~10M point reads/sec on modern hardware. Not Hekaton-class (which is C++) but sufficient for most Go applications.

**Q27. Compare and contrast PostgreSQL nbtree vs BoltDB.**

A: nbtree: WAL-protected B+-tree with Lehman-Yao B-link, latch crabbing, MVCC via XID tuples, VACUUM for GC. Multi-writer (per-row locks). BoltDB: COW B+-tree with mmap, single-writer with multi-version readers, page-level copy-on-write, no WAL (durability via meta page atomic update). nbtree is more concurrent but more complex; bbolt is simpler but limited to one writer.

**Q28. Design a sharded distributed B+-tree for a globally consistent database.**

A: Range-shard the keyspace into 64 MB chunks. Each chunk is a B+-tree on a single node. Use Raft for per-chunk replication. Use a central coordinator (or DNS-based discovery) for chunk-to-node mapping. Transactions span chunks via two-phase commit, ideally with TrueTime-style synchronized clocks. Read consistency: snapshot reads at a given timestamp, served from any replica that has acknowledged that timestamp.

**Q29. How would you make a Bw-tree in pure Go simpler than the original?**

A: Use Go's GC instead of epoch reclamation. Use `atomic.Pointer[T]` for the mapping table entries. Use a sync.Map for the parent table (`childID -> parentID`). Use Go interfaces for the polymorphic node types (delta vs base). Accept some performance overhead for simplicity.

**Q30. What is the fundamental limit on throughput for a single-tree concurrent ordered store?**

A: For a publish/subscribe COW tree, throughput is bounded by the rate at which a single goroutine can apply writes and produce snapshots. With ~10 μs per write + snapshot, ~100k writes/sec. Reads are unbounded by the writer (lock-free). For higher write throughput, shard. For ordered range queries across all data, you cannot shard meaningfully — either accept the single-tree limit or use a different architecture (e.g., LSM with periodic compaction).

**Q31. Design an in-memory order book for a financial exchange.**

A: Two B-trees (bids, asks) with per-symbol mutex. Each Order is a pointer in the tree. byID `map[string]*Order` for fast cancel. `Match` pops min from each tree, executes trades, removes empty orders. For multi-symbol throughput, one book per symbol (sharded by symbol). For market data feeds, publish a snapshot every 10 ms via COW; subscribers read the snapshot.

**Q32. How would you implement persistent (durable) snapshot reads on a concurrent tree?**

A: Layer a WAL: each write appends a log record before applying to the tree. On commit, fsync. On startup, replay the WAL into the tree. For point-in-time reads at a historical timestamp, maintain MVCC: each tree entry carries (key, value, timestamp); reads find the latest entry with timestamp <= snapshot. Old entries are reclaimed when below the oldest active snapshot.

**Q33. A reader holds a snapshot in a global variable indefinitely. What happens?**

A: The snapshot's nodes are pinned in memory; Go's GC cannot reclaim them. Each subsequent write to the live tree path-copies any shared nodes, increasing memory usage. Eventually, memory pressure or OOM. Mitigation: bound snapshot lifetimes; document the contract; warn if a snapshot is held longer than expected.

**Q34. Why is `sync.Map` not a good replacement for a concurrent tree?**

A: `sync.Map` is optimized for "insert once, read many" workloads. It has no ordering, no range queries, no min/max. For ordered workloads, you need a tree.

**Q35. How does CockroachDB's MVCC encoding work?**

A: Keys are `(userKey, walltime, logical)` triples. The tree sorts by userKey ascending, timestamp descending. A read at snapshot T does `Seek((userKey, T, 0))`, which returns the largest entry with userKey == userKey and timestamp <= T. GC removes entries with timestamps below the oldest active snapshot. The tree's natural ordering provides MVCC for free.

---

## Behavioral Questions

**Q36. Tell me about a time you debugged a concurrent tree bug.**

A: (Personal story.) Look for: clarity of the bug description, the diagnostic process (logs, race detector, profiling), the fix, and the prevention measures (tests, invariant assertions). Senior interviewers value the prevention story most.

**Q37. How do you decide when to use a concurrent tree vs a `sync.Map`?**

A: If I need ordered access (range queries, min/max, sorted iteration), I use a tree. Otherwise, `sync.Map` for insert-once-read-many, or `map + RWMutex` for general purpose.

**Q38. Have you ever implemented a tree from scratch in production?**

A: (Be honest.) "No, I use `tidwall/btree` or `bbolt`. I would implement a custom tree only if profiling proved a library was insufficient." This answer is *better* than claiming custom implementations — it shows judgment.

**Q39. How do you stay current with concurrent data structure research?**

A: Read papers (Bw-tree, ART, MassTree, Lehman-Yao). Follow database engineering blogs. Read source of major systems (PostgreSQL, CockroachDB, Pebble). Build experimental implementations. Discuss with peers.

**Q40. What is your favorite paper on concurrent data structures?**

A: (Personal.) Mine: Lehman-Yao. It is short, foundational, and elegant. Other good answers: McKenney's RCU bible, Levandoski's Bw-tree, Leis's ART. Show genuine enthusiasm.

---

## Coding Round Questions

**Q41. Implement a thread-safe `SortedSet[T]` in Go.**

A: See junior.md Appendix J. About 50 lines wrapping `google/btree.BTreeG[T]`.

**Q42. Implement publish/subscribe COW around `tidwall/btree`.**

A: See middle.md Appendix AC. About 20 lines.

**Q43. Implement an in-memory MVCC store with snapshot reads.**

A: See senior.md Appendix BA. About 200 lines.

**Q44. Implement an in-memory order book.**

A: See senior.md Appendix H. About 200 lines.

**Q45. Implement a TTL cache with ordered eviction.**

A: See junior.md Appendix D.1. About 80 lines.

---

## Architecture Round Questions

**Q46. Design a metrics ingestion system handling 1M writes/sec.**

A: Sharded per-series publish/subscribe COW. Background eviction. Per-shard mutex; per-series tree. Throughput: easily 1M writes/sec on ~16 cores.

**Q47. Design a route table for an API gateway handling 100k requests/sec.**

A: Publish/subscribe COW tree of (prefix, handler) pairs. Updates from control plane are infrequent; reads are every request. Lock-free reads via snapshot. Latency: < 100 μs per route lookup.

**Q48. Design a feature flag service.**

A: Map of (flag_id, value). Publish/subscribe COW for the map. Updates from admin UI publish new snapshots; reads on every request use the snapshot. Latency: < 10 μs per flag check.

**Q49. Design a session store.**

A: Sharded ordered map of (session_id, session) for `O(log n)` access plus per-user enumeration. Publish/subscribe COW per shard. Background TTL eviction. Throughput: > 100k requests/sec per shard.

**Q50. Design a leaderboard for a real-time game.**

A: Per-game ordered tree of (score desc, user_id). Publish/subscribe COW with periodic snapshot publishing. Top-N queries on the snapshot. Updates on every game tick.

---

## Closing

The interview questions in this file range from basic (junior) to architecture-level (staff). A senior candidate should be comfortable with Q1-Q25. A staff candidate should handle Q26-Q35. Architecture rounds test Q46-Q50.

For each question, the *reasoning* matters more than the answer. Articulate your assumptions, identify the trade-offs, and defend your choice with measurement evidence (real or imagined).

Practice answering aloud. Junior questions: 1 minute each. Middle: 2-3 minutes. Senior: 5 minutes. Staff: 10 minutes including diagram.

Good luck.

---

## Bonus: Pair Interview Walkthrough

**Q51. (Pair) Build a thread-safe counter map: `Inc(key)`, `Get(key)`, `TopN(n)`.**

A:

```go
type CounterMap struct {
    mu       sync.Mutex
    counts   map[string]int64
    sorted   *btree.BTreeG[entry]
}

type entry struct {
    Key   string
    Count int64
}

func less(a, b entry) bool {
    if a.Count != b.Count {
        return a.Count > b.Count
    }
    return a.Key < b.Key
}

func New() *CounterMap {
    return &CounterMap{
        counts: make(map[string]int64),
        sorted: btree.NewBTreeG[entry](less),
    }
}

func (c *CounterMap) Inc(key string) int64 {
    c.mu.Lock()
    defer c.mu.Unlock()
    old := c.counts[key]
    if old > 0 {
        c.sorted.Delete(entry{Key: key, Count: old})
    }
    new := old + 1
    c.counts[key] = new
    c.sorted.Set(entry{Key: key, Count: new})
    return new
}

func (c *CounterMap) TopN(n int) []entry {
    c.mu.Lock()
    defer c.mu.Unlock()
    out := make([]entry, 0, n)
    c.sorted.Scan(func(e entry) bool {
        out = append(out, e)
        return len(out) < n
    })
    return out
}
```

A senior candidate should mention:
- The dual index (`map` + `tree`) pattern.
- Why ordering by `(count desc, key asc)` matters for determinism.
- The COW snapshot improvement (publish/subscribe) for read-heavy `TopN` workloads.
- Memory/GC implications.

---

**Q52. (Pair) The candidate is given a buggy concurrent tree. Walk through finding the bug.**

Sample bug:

```go
func (s *Store) Update(key int, fn func(int) int) {
    s.mu.RLock()
    cur, _ := s.bt.Get(Item{Key: key})
    new := fn(cur.Value)
    s.mu.RUnlock()
    s.mu.Lock()
    s.bt.ReplaceOrInsert(Item{Key: key, Value: new})
    s.mu.Unlock()
}
```

The bug: between `RUnlock` and `Lock`, another goroutine may update the same key. The senior candidate should:

- Identify the race.
- Propose the fix: take `Lock` for the entire operation.
- Or propose a CAS-style protocol with a retry loop.

```go
func (s *Store) Update(key int, fn func(int) int) {
    s.mu.Lock()
    defer s.mu.Unlock()
    cur, _ := s.bt.Get(Item{Key: key})
    new := fn(cur.Value)
    s.bt.ReplaceOrInsert(Item{Key: key, Value: new})
}
```

The candidate should also mention `-race` would catch this.

---

**Q53. (Pair) Design an in-memory event log with subscribe semantics.**

Requirements:
- Append events: O(log n).
- Subscribe to events since timestamp T: receive all events with TS > T, then block until new events.
- Many concurrent subscribers.

Design:

```go
type EventLog struct {
    mu        sync.Mutex
    cond      *sync.Cond
    events    *btree.BTreeG[Event]
    snapshot  atomic.Pointer[btree.BTreeG[Event]]
}

func (l *EventLog) Append(e Event) {
    l.mu.Lock()
    defer l.mu.Unlock()
    l.events.Set(e)
    l.snapshot.Store(l.events.Copy())
    l.cond.Broadcast()
}

func (l *EventLog) Subscribe(sinceTS int64, ch chan<- Event) {
    go func() {
        cursor := sinceTS
        for {
            // Drain new events.
            snap := l.snapshot.Load()
            var batch []Event
            snap.Ascend(Event{TS: cursor + 1}, func(e Event) bool {
                batch = append(batch, e)
                return true
            })
            for _, e := range batch {
                ch <- e
                cursor = e.TS
            }
            // Wait for new events.
            l.mu.Lock()
            for l.snapshot.Load() == snap {
                l.cond.Wait()
            }
            l.mu.Unlock()
        }
    }()
}
```

The senior candidate should note:
- `cond.Broadcast` wakes all subscribers.
- Each subscriber maintains its own cursor.
- Snapshot publish/subscribe lets subscribers iterate without blocking writers.
- Backpressure / channel buffering must be considered.

---

## Bonus: Quick-fire questions

**Q54.** What is `tidwall/btree.PathHint`? A: A small per-goroutine struct that remembers the path of the last access, enabling `O(1)` shortcuts on nearby accesses.

**Q55.** Can two goroutines call `tidwall/btree.BTreeG.Copy()` concurrently? A: No — `Copy` is a mutation. Take a mutex.

**Q56.** What is the difference between `tr.Ascend` and `tr.Scan` in `tidwall/btree`? A: `Ascend(pivot, fn)` starts from `pivot`; `Scan(fn)` starts from the smallest. Same iteration model.

**Q57.** Is `atomic.Pointer[T].Store` a release barrier? A: Yes, equivalent to a release fence followed by the store.

**Q58.** What is the smallest tree size where a B-tree outperforms a sorted slice? A: Roughly 50-100 elements, depending on item size and cache behavior. Below that, a sorted slice with binary search is faster.

**Q59.** Why is `sync.RWMutex` slower than `sync.Mutex` for write-heavy workloads? A: `RWMutex` maintains both reader and writer counters; the bookkeeping adds overhead. For pure write workloads, plain `Mutex` is faster.

**Q60.** What does `runtime.NumGoroutine()` return? A: The current count of running goroutines. Useful for detecting leaks.

---

## Bonus: Architecture critique questions

The interviewer presents a tree design; the candidate critiques it.

**Q61.** Design: "We'll use a `map[string]*Node` with a `sync.RWMutex` for our ordered store." Critique?

A: A `map` is not ordered; you cannot do range queries. The "ordered" part requires a tree (B-tree or skip list).

**Q62.** Design: "We'll shard our B-tree by `hash(key) % 16` for concurrency." Critique?

A: Sharding works for point access. For range queries (e.g., "all keys between X and Y"), you must fan out to all 16 shards and merge. If range queries are frequent, hash sharding is wrong; use range sharding instead.

**Q63.** Design: "We'll use `sync.Map` for our ordered cache." Critique?

A: `sync.Map` is hash-based, not ordered. You cannot iterate in key order. Use `tidwall/btree` instead.

**Q64.** Design: "We'll lock individual tree nodes with `sync.RWMutex`." Critique?

A: Per-node mutexes add 24 bytes per node (significant for million-node trees). Hand-over-hand locking is complex to get right. For most Go workloads, publish/subscribe COW is simpler and faster.

**Q65.** Design: "We'll re-publish a new snapshot after every single write." Critique?

A: Snapshot allocation is `O(log n)`. Per-write publishing causes excessive GC pressure. Batch writes and publish once per batch.

---

## Closing

Sixty-five questions covering junior to staff levels, plus pair-coding and architecture critique. Practice answering aloud, with timing. The right answer is usually less important than the reasoning.

Be honest about your limits. "I have not implemented a Bw-tree but I have read the paper and can describe the protocol" is a better answer than pretending expertise you do not have.

Be measured. Senior interviewers want to hear "I would profile before optimizing" more than "I would use a lock-free skip list with hazard pointers."

Be specific. "I would use `tidwall/btree` with publish/subscribe COW" beats "I would use a concurrent tree."

Good luck. Go build something.

---

## Bonus: System design follow-ups

Once you've answered a system design question, expect follow-ups that probe deeper. Practice answering these:

**Q66. After describing a publish/subscribe COW store, the interviewer asks: "What happens at 10x the write rate?"**

A: Snapshot allocation becomes the bottleneck. Mitigations: (1) batch writes — accumulate N writes, publish one snapshot; (2) shard by hash for uncorrelated writes; (3) consider a different protocol (hand-over-hand or in-place latching) if writes dominate.

**Q67. "How would you handle a network partition in a distributed version?"**

A: For an in-memory store, "partition" usually means losing communication with replicas. CockroachDB-style: Raft consensus per range; minority partitions stop serving writes; majority continue. Spanner-style: rely on TrueTime; both partitions can serve reads at past timestamps, but writes need quorum.

**Q68. "What if the machine runs out of memory mid-operation?"**

A: Go's runtime panics with "runtime: out of memory." For graceful handling, monitor memory pressure via `runtime.MemStats` and reject new writes when above threshold. For durable stores, ensure WAL has flushed before serving the OOM-triggered panic.

**Q69. "How would you debug a goroutine leak in this system?"**

A: `runtime.NumGoroutine()` exposed via a metrics endpoint. `pprof goroutine` for stacks. If subscribers leak, check their cancellation logic. If publishers leak, check their channel-send pattern.

**Q70. "How would you add multi-region replication?"**

A: Each region runs its own copy of the store. A change-data-capture stream broadcasts writes to other regions. Conflict resolution via CRDTs (for eventually consistent) or two-phase commit (for strongly consistent). For Go: gRPC stream from leader to followers; per-row last-write-wins on conflict.

---

## Bonus: Whiteboard questions

A whiteboard interview goes deeper than pseudocode. Practice these.

**Q71. Draw the state of a B-link tree after a split.**

A: Start with a full leaf. Show the split into two leaves with the new high keys and right-sibling pointer. Indicate the publication point. Then show the parent update.

**Q72. Draw the version chain for a row that has been updated 3 times.**

A:

```
Row{Key: 42}
  Newest: Version{Value: "v3", XMin: 30, XMax: 0,  Next: ↓}
                  Version{Value: "v2", XMin: 20, XMax: 30, Next: ↓}
                  Version{Value: "v1", XMin: 10, XMax: 20, Next: nil}
```

A reader at snapshot 25 walks the chain, finds v2 (XMin=20 <= 25, XMax=30 > 25). Returns "v2".

**Q73. Draw the Bw-tree mapping table for a small tree.**

A:

```
mapping[1] -> Base{root, items: [k=50 ptr to ID=2, k=100 ptr to ID=3], hk: inf}
mapping[2] -> Delta(insert k=10) -> Base{items: [k=5, k=25, k=40], hk: 49}
mapping[3] -> Base{items: [k=60, k=80, k=90, k=100], hk: 100}
```

Show how a Get walks from root (mapping[1]) to a leaf, applying any deltas.

**Q74. Draw the latch hierarchy during a B-link split.**

A: Show: latches on (L, M, parent), in that order, then release in reverse. Show the right-sibling pointer being updated (publication point), then the parent being updated.

---

## Bonus: Code review questions

The interviewer shows code; the candidate reviews it.

**Q75. Review:**

```go
func (s *Store) Get(k int) (Item, bool) {
    s.mu.Lock()
    defer s.mu.Unlock()
    it, ok := s.bt.Get(Item{Key: k})
    return it, ok
}
```

Critique: `Get` should use `RLock`, not `Lock`. With `Lock`, only one reader at a time. Fix:

```go
func (s *Store) Get(k int) (Item, bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.bt.Get(Item{Key: k})
}
```

**Q76. Review:**

```go
func (s *Store) WithItems(fn func([]Item)) {
    s.mu.RLock()
    var items []Item
    s.bt.Ascend(func(it Item) bool {
        items = append(items, it)
        return true
    })
    s.mu.RUnlock()
    fn(items)
}
```

Critique: Materializes the entire tree into a slice. For a 1M-entry tree, this is ~16 MB allocation per call. Mitigate by using a publish/subscribe snapshot or by streaming through the callback (with documented "do not re-enter" contract).

**Q77. Review:**

```go
func (s *Store) Set(it Item) {
    s.mu.Lock()
    s.bt.ReplaceOrInsert(it)
    go func() {
        s.snapshot.Store(s.bt.Copy())
    }()
    s.mu.Unlock()
}
```

Critique: The goroutine accesses `s.bt` and `s.snapshot` without holding the mutex. Race. Fix:

```go
func (s *Store) Set(it Item) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.bt.ReplaceOrInsert(it)
    s.snapshot.Store(s.bt.Copy())
}
```

**Q78. Review:**

```go
type Store struct {
    mu sync.Mutex
    bt *btree.BTreeG[Item]
}

func (s *Store) BatchSet(items []Item) {
    for _, it := range items {
        s.mu.Lock()
        s.bt.ReplaceOrInsert(it)
        s.mu.Unlock()
    }
}
```

Critique: Lock acquisition per item is unnecessary churn. Acquire once, batch-insert, release. Fix:

```go
func (s *Store) BatchSet(items []Item) {
    s.mu.Lock()
    defer s.mu.Unlock()
    for _, it := range items {
        s.bt.ReplaceOrInsert(it)
    }
}
```

---

## Bonus: Trick questions

**Q79.** Why is `tr.AscendRange(Item{Key: 5}, Item{Key: 5}, fn)` not called for the item with key 5?

A: Because the range is half-open `[5, 5)` = empty. To include key 5, use `[5, 6)` or check with `tr.Get`.

**Q80.** Why does `tr.Min()` on an empty tree return `(zeroValue, false)` instead of nil?

A: Go does not have null for non-pointer types. The second return value indicates absence. Always check the bool.

**Q81.** Why is `tr.ReplaceOrInsert(Item{Key: 1, Value: "a"})` followed by `tr.ReplaceOrInsert(Item{Key: 1, Value: "b"})` end up with Value "b"?

A: `ReplaceOrInsert` overwrites by key. The second call's value replaces the first.

**Q82.** Why does `tidwall/btree.BTreeG.Copy()` return in O(1) for a billion-entry tree?

A: It increments a refcount on the root. No data is copied until the first write.

**Q83.** Why is `sync.RWMutex` not preferred for high write rates?

A: It has slightly more overhead than `Mutex` due to dual counters. For workloads where writes dominate, `Mutex` is faster.

**Q84.** Why does my `for k, v := range m` on a Go `map` give different orders each run?

A: Go randomizes map iteration order to discourage reliance on it. For deterministic ordering, use a tree.

**Q85.** Why does my callback in `tr.Ascend(fn)` not see new items inserted during iteration?

A: The tree library is not designed for in-flight modifications. Buffer keys to modify, then apply after iteration completes.

---

## Bonus: API design questions

**Q86. Design an API for a concurrent ordered map.**

A: Methods: `Set(key, value)`, `Get(key) -> (value, bool)`, `Delete(key)`, `Range(lo, hi, fn func(k, v) bool)`, `Len() int`, `Snapshot() *Snapshot`, `Min() / Max()`. All methods are thread-safe. `Snapshot` returns a read-only view.

**Q87. Design an iteration API that doesn't deadlock on re-entry.**

A: Either materialize into a slice (and warn about memory) or hand out a `*Snapshot` that the caller iterates outside the lock.

**Q88. How would you expose tree statistics?**

A: `Stats() Stats` returning a struct with NumKeys, Depth, FillFactor, NumNodes. Snapshot at call time.

**Q89. How would you support transactions in the API?**

A: `BeginTx() *Tx`; tx has Get/Set/Delete; `Tx.Commit() error`. Optimistic conflict detection at commit.

**Q90. Should `Get` return `(Item, bool)` or `(Item, error)`?**

A: `(Item, bool)` for "not found" (common case). `(Item, error)` only if the operation can fail with a non-not-found reason.

---

## Closing closing

You now have 90 interview questions covering everything from "what is a B-tree" to "design a Hekaton-class engine." Practice them aloud. The best preparation is verbal explanation, not silent reading.

Most of these questions are common in senior-and-above Go interviews at companies that work with concurrent data: database vendors, fintech, search, real-time systems, game backends.

For the others — well, even understanding the questions makes you better at this job.

Good luck.



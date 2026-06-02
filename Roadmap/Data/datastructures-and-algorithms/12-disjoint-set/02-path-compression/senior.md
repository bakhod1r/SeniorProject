# Path Compression — Senior Level

> Path compression is a beautiful single-node optimization — until you try to make a DSU persistent, distributed, or concurrent. Then the very thing that makes `find` fast (mutating `parent[]` during a read) becomes the thing that breaks rollback, breaks snapshots, and races other threads. This file is about those tensions.

## Table of Contents
1. [Introduction](#1-introduction)
2. [System Design Considerations](#2-system-design-considerations)
3. [Distributed and Persistent DSU](#3-distributed-and-persistent-dsu)
4. [Concurrent Variants](#4-concurrent-variants)
5. [Comparison at Scale](#5-comparison-at-scale)
6. [Architecture Patterns](#6-architecture-patterns)
7. [Code Examples](#7-code-examples)
8. [Observability](#8-observability)
9. [Failure Modes](#9-failure-modes)
10. [Capacity Planning](#10-capacity-planning)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is not "which compression variant flattens fastest" but "what does compression cost me architecturally?" The defining property of path compression is that **`find` is a mutating operation**. It writes to `parent[]` while logically reading a representative. That single fact drives every hard decision in this file:

- **Persistence:** compression overwrites the old structure, so you cannot cheaply snapshot or roll back.
- **Concurrency:** two threads compressing overlapping paths race on `parent[]` writes.
- **Distribution:** a DSU sharded across machines cannot compress across the network cheaply.
- **Observability:** the only way to know if compression is working is to measure average path length over time.

The senior-level decisions are therefore: *when do I keep compression, when do I drop it for read-only `find`, and how do I make compression safe under concurrency?*

---

## 2. System Design Considerations

### 2.1 Compression is a write amplification on reads

In a naive mental model, `find` is a read. With compression it issues up to `depth` writes per call. For a read-heavy connectivity service this changes the storage and concurrency profile:

- You cannot put the DSU behind a read-replica and serve `find` from the replica — the replica would need to write.
- You cannot mark the `parent[]` pages copy-on-write cheaply, because nearly every `find` dirties pages.
- A "read-only" snapshot taken mid-traffic is invalid the instant a `find` runs.

The fix when these matter: use **union by rank/size with a read-only `find` (no compression)**. Height stays `O(log n)`, finds are true reads, and the structure becomes snapshot- and replica-friendly. You trade `O(α(n))` for `O(log n)` — usually acceptable.

### 2.2 The decision matrix

| Requirement | Keep compression? | Strategy |
| --- | --- | --- |
| Single-threaded, in-memory, fastest finds | yes | halving/splitting + union by rank |
| Need rollback / undo of unions | no | union by rank only, read-only find |
| Need immutable snapshots / persistence | no | persistent DSU (path copying) or rank-only |
| Concurrent finds and unions | careful | splitting + CAS, or lock-free DSU |
| Sharded across machines | mostly no | local compression per shard, no cross-shard compression |

---

## 3. Distributed and Persistent DSU

### 3.1 Compression breaks persistence

A **persistent** (immutable, versioned) DSU lets you query any past version. The standard way to build one is *path copying*: each `union` copies the `O(log n)` nodes it changes and shares the rest, producing a new root version in `O(log n)` space.

Path compression is fundamentally incompatible with this model. Compression rewrites an arbitrary number of nodes on the find-path — potentially `O(n)` of them on the first deep find. If `find` had to copy every node it re-points, a single query would allocate `O(n)` new nodes, destroying the `O(log n)` space-per-version guarantee. So persistent DSUs **drop compression** and rely on **union by rank/size only**, which:

- keeps `find` read-only (no nodes to copy on a query),
- keeps height `O(log n)` (so finds remain cheap),
- makes `union` copy exactly the `O(log n)` nodes on the two find-paths.

The lesson: *persistence and compression are mutually exclusive in any cheap implementation.* Choose rank-only for persistence.

### 3.2 Rollback DSU (semi-persistent)

A rollback DSU supports undoing the last `union` (used in offline dynamic connectivity, "DSU on segment tree of time"). It also drops compression: with compression, one `find` rewrites many parents, so the undo log would have to record and restore all of them. Without compression, each `union` changes exactly one parent pointer and at most one rank, so rollback is `O(1)`. This is the canonical structure behind offline dynamic-connectivity solutions.

### 3.3 Distributed connectivity

When the element set is too large for one machine, you shard `parent[]` by element id. Now a find-path may cross shards, and compression across shards means a remote write per hop — catastrophic. Practical distributed designs:

- **Local compression only.** Compress within a shard; when a path leaves the shard, stop compressing and just follow remote pointers. Periodic global "flatten" jobs re-root.
- **Coordinator-side union-find.** Keep the DSU on a single coordinator and shard only the *data*; the DSU itself stays in-memory on one node with full compression.
- **Label propagation instead of DSU.** For very large graphs (Spark/GraphX connected components), iterative label propagation replaces DSU entirely; there is no per-node compression, just min-label broadcasts to convergence.

---

## 4. Concurrent Variants

### 4.1 Why compression races

Two threads calling `find` on overlapping paths both write `parent[]`. A naive parallel full compression can:

- **Lose writes:** thread A sets `parent[x] = r1`, thread B simultaneously sets `parent[x] = r2`; one write is lost. As long as both `r1` and `r2` are valid ancestors of `x`, the *result* is still correct (any ancestor closer to the root is fine), but you can lose flattening progress.
- **Create a stale pointer:** if `union` concurrently re-roots the tree, a compressing `find` might re-point a node to a node that is no longer the root. This is still correct as long as it remains an ancestor — `find` will just walk a bit further next time.

The crucial invariant a correct concurrent DSU preserves: **every `parent[]` write must point a node to one of its current ancestors.** Under that invariant, lost or stale writes only cost performance, never correctness.

### 4.2 Why concurrent DSU prefers splitting

**Path splitting** is the variant of choice for lock-free DSUs (e.g., the Jayanti–Tarjan concurrent union-find) because each of its writes re-points a node to its *grandparent* — which is always a current ancestor — and the write is a single word. There is no two-pass "remember the root, then rewrite everyone" step that could go stale mid-flight. Each splitting step is independently safe:

```
parent[x] = parent[parent[x]]   // grandparent is always an ancestor; safe to publish
```

Full compression, by contrast, computes the root first and then rewrites the whole path to *that specific root*; if the root changes under you (concurrent union), those writes can point to a non-ancestor in pathological interleavings, requiring extra care.

### 4.3 CAS-based find

A lock-free splitting find uses compare-and-swap so a write only lands if the parent has not changed:

```
loop at node x:
    p  = parent[x]
    if p == x: return x          # root
    gp = parent[p]
    CAS(&parent[x], p, gp)       # only update if parent[x] is still p
    x = gp
```

If the CAS fails, another thread already advanced `parent[x]`; you simply re-read and continue. Correctness holds because `gp` is an ancestor of `x` whenever the CAS succeeds.

### 4.4 Locking alternatives

If you do not want lock-free complexity:

- **Coarse lock:** one mutex around the whole DSU. Simple, correct, serializes everything. Fine when the DSU is not the bottleneck.
- **Per-root lock:** lock the two roots during `union`; finds run lock-free with splitting + CAS. This is the common middle ground.

---

## 5. Comparison at Scale

| Strategy | find | concurrency | persistence | rollback | when |
| --- | --- | --- | --- | --- | --- |
| Compression + rank (sequential) | O(α(n)) am. | needs lock | no | no | default single-thread |
| Splitting + CAS | O(α(n)) am. | lock-free find | no | no | concurrent connectivity |
| Rank-only, read-only find | O(log n) | trivially shareable | yes (path copying) | O(1) | persistent / rollback / replicas |
| Sharded local compression | O(α(n)) local + RTT | per-shard | no | no | element set exceeds one node |
| Label propagation | O(iterations · E) | bulk-parallel | snapshot per superstep | n/a | massive graphs (Spark/GraphX) |

The takeaway: compression buys you `O(α(n))` but costs you persistence, easy concurrency, and shardability. Drop it the moment one of those matters more than the constant factor on `find`.

---

## 6. Architecture Patterns

### 6.1 Two-mode DSU

Expose a flag that switches `find` between *compressing* (fast, mutating) and *read-only* (snapshot-safe). Build the structure with compression during ingest, then freeze to read-only mode before serving snapshots or replicas.

```
        ingest phase                serve phase
   +---------------------+     +---------------------+
   | find = splitting    | --> | find = read-only    |
   | union by rank       |     | (no writes)         |
   | trees flattened     |     | safe to snapshot    |
   +---------------------+     +---------------------+
```

After the ingest phase has flattened the forest, read-only finds are already near-`O(1)` because the trees are flat — you keep most of the benefit without the write cost.

### 6.2 Periodic global flatten

In a long-lived DSU, run an occasional sweep that calls `find(i)` for all `i` (or a single explicit two-pass re-root) to fully flatten, then switch to read-only. This amortizes the compression cost into a maintenance window and gives clean snapshots afterward.

### 6.3 DSU over time (offline dynamic connectivity)

For "was `u` connected to `v` at time `t`" queries, build a segment tree over time, attach each edge to the intervals where it is alive, and DFS the tree using a **rollback DSU (rank only, no compression)**. Compression is dropped precisely because each DFS step must undo a union on the way back up.

---

## 7. Code Examples

### 7.1 Go — lock-free splitting find with CAS

```go
package dsu

import "sync/atomic"

// ConcurrentDSU stores parents as atomic int32s.
// find uses path splitting with CAS; writes only publish an ancestor.
type ConcurrentDSU struct {
	parent []int32
	rank   []int32
}

func New(n int) *ConcurrentDSU {
	p := make([]int32, n)
	for i := range p {
		p[i] = int32(i)
	}
	return &ConcurrentDSU{parent: p, rank: make([]int32, n)}
}

func (d *ConcurrentDSU) Find(x int32) int32 {
	for {
		p := atomic.LoadInt32(&d.parent[x])
		if p == x {
			return x
		}
		gp := atomic.LoadInt32(&d.parent[p])
		// Path splitting: point x at its grandparent if parent unchanged.
		atomic.CompareAndSwapInt32(&d.parent[x], p, gp)
		x = gp
	}
}

func (d *ConcurrentDSU) Union(a, b int32) {
	for {
		ra, rb := d.Find(a), d.Find(b)
		if ra == rb {
			return
		}
		// Order roots by rank to keep trees shallow; link with CAS.
		if atomic.LoadInt32(&d.rank[ra]) < atomic.LoadInt32(&d.rank[rb]) {
			ra, rb = rb, ra
		}
		if atomic.CompareAndSwapInt32(&d.parent[rb], rb, ra) {
			if atomic.LoadInt32(&d.rank[ra]) == atomic.LoadInt32(&d.rank[rb]) {
				atomic.AddInt32(&d.rank[ra], 1)
			}
			return
		}
		// Lost the race; retry from fresh roots.
	}
}
```

Notes for review:
- Every `parent[x]` write publishes the *grandparent*, always an ancestor, so concurrent stale writes never break correctness.
- The `Union` CAS may fail under contention; the retry loop re-derives roots. Rank updates are best-effort (rank is only an upper bound, so an occasionally-missed bump is harmless).

### 7.2 Java — explicit two-pass full compression (no recursion, snapshot-friendly result)

```java
public final class TwoPassDSU {
    private final int[] parent;
    private final int[] rank;

    public TwoPassDSU(int n) {
        parent = new int[n];
        rank = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
    }

    // Two passes, no recursion: find the root, then re-point the whole path.
    public int find(int x) {
        int root = x;
        while (parent[root] != root) root = parent[root]; // pass 1
        while (parent[x] != root) {                       // pass 2
            int next = parent[x];
            parent[x] = root;
            x = next;
        }
        return root;
    }

    public boolean union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return false;
        if (rank[ra] < rank[rb]) { int t = ra; ra = rb; rb = t; }
        parent[rb] = ra;
        if (rank[ra] == rank[rb]) rank[ra]++;
        return true;
    }
}
```

This is the safe way to get full flattening on JVM-heap-sized inputs where a recursive find would blow the thread stack.

### 7.3 Python — rank-only DSU for rollback/persistence (no compression)

```python
class RankOnlyDSU:
    """No path compression. find() is read-only, so unions are undoable
    and the structure is safe to snapshot. Height stays O(log n)."""

    def __init__(self, n: int):
        self.parent = list(range(n))
        self.rank = [0] * n
        self._log = []  # for rollback

    def find(self, x: int) -> int:        # read-only walk, no writes
        while self.parent[x] != x:
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> bool:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            self._log.append(None)
            return False
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self._log.append((rb, ra, self.rank[ra] == self.rank[rb]))
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1
        return True

    def rollback(self) -> None:
        rec = self._log.pop()
        if rec is None:
            return
        rb, ra, bumped = rec
        self.parent[rb] = rb            # exactly one pointer to restore
        if bumped:
            self.rank[ra] -= 1
```

Because `find` never writes, rollback restores exactly one parent and one rank — `O(1)`. Add compression and this guarantee evaporates.

---

## 8. Observability

A DSU is invisible until finds get slow. Instrument the structure to know whether compression is actually working.

| Metric | Type | Why |
| --- | --- | --- |
| `dsu_avg_path_length` | gauge | Average hops per `find`. Should trend toward ~1 as compression flattens. |
| `dsu_max_path_length` | gauge | Worst observed walk. A spike means a deep tree formed (often missing union by rank). |
| `dsu_find_writes_total` | counter | Total `parent[]` writes from compression. High and not decreasing → trees not flattening. |
| `dsu_components` | gauge | Number of distinct roots; the partition coarseness over time. |
| `dsu_find_latency_seconds` | histogram | End-to-end find cost; tail captures first-walk cost on deep nodes. |
| `dsu_cas_retries_total` | counter | (Concurrent) contention on the lock-free find/union. |

**Measuring average path length:** periodically sample, for a random subset of nodes, the number of hops to the root *before* compression rewrites them. If the average stays well above 1 over time, your union side is missing rank/size, or you are dropping compression somewhere.

---

## 9. Failure Modes

### 9.1 Stack overflow on recursive full compression
The classic production incident: a near-linear tree forms (compression on but union-by-rank accidentally disabled, or a pathological union order), and the first recursive `find` recurses to depth `n`, blowing the stack. **Mitigation:** always use iterative halving/splitting, or the explicit two-pass loop. Never ship recursive compression where input depth is unbounded.

### 9.2 Lost compression under read replicas
A team puts `find` behind a read replica to scale reads; the replica is read-only, so compression silently no-ops, paths never flatten, and finds degrade to `O(log n)` or worse. **Mitigation:** flatten on the primary, switch to read-only find on replicas knowingly, or keep the DSU single-homed.

### 9.3 Rollback corruption from compression
Someone "optimizes" a rollback DSU by adding compression. The next `union`'s find rewrites several parents; rollback restores only the one logged pointer; the structure is now corrupt. **Mitigation:** rollback DSU must be rank-only; assert no compression in code review.

### 9.4 Concurrent non-ancestor write
A concurrent full-compression find computes a root, a parallel union re-roots the tree, and the find publishes a pointer to a stale node that is no longer an ancestor — creating a cycle in rare interleavings. **Mitigation:** use splitting (grandparent writes are always ancestors) with CAS, never parallel full compression.

### 9.5 Rank inflation illusion
Engineers read `rank` as the true height for capacity decisions; after heavy compression the real height is far smaller. **Mitigation:** document that rank is an upper bound; measure real path length for capacity, not rank.

---

## 10. Capacity Planning

### 10.1 Memory
A path-compressed DSU needs one `parent[]` plus an optional `rank[]`/`size[]`. For `n` elements with 32-bit ids: `4n` bytes for parents, `4n` for rank → `8n` bytes. For `n = 10^8`: ~0.8 GB. Compression adds no per-node memory; it only rewrites existing slots.

### 10.2 Throughput
- Single-thread, in-memory, halving + rank: tens of millions of finds/sec; effectively constant per op after warm-up.
- Lock-free splitting + CAS: scales with cores until `parent[]` cache-line contention dominates; expect good scaling to ~8–16 cores, then diminishing returns from false sharing.
- The dominant cost at scale is **cache misses on the first walk**, not the algorithm. Flattening early turns later finds into single cache-friendly reads.

### 10.3 When to drop compression
Drop compression when: you need snapshots/replicas, you need rollback, you need persistence, or you shard across machines. In all of these, switch to **union by rank/size with read-only find** and accept `O(log n)`.

### 10.4 When to keep it
Keep compression for the common case: a single-process, in-memory DSU answering many connectivity queries (MST, components, offline LCA on one box). Here `O(α(n))` is free and there is no reason not to.

---

## 11. Summary

- Path compression's defining trait is that **`find` mutates** — this is what makes it fast and what makes it architecturally awkward.
- **Persistence and compression are mutually exclusive** cheaply: persistent and rollback DSUs drop compression and use union by rank/size with read-only finds (`O(log n)`).
- **Concurrent DSUs prefer path splitting** because every write publishes a grandparent, which is always a current ancestor, so lost/stale writes never break correctness; use CAS.
- **Never ship recursive full compression** where depth is unbounded — it overflows the stack. Use iterative halving/splitting or an explicit two-pass loop.
- **Distributed connectivity** compresses only locally; cross-shard or massive-graph problems use coordinator-side DSU or label propagation instead.
- **Observe average and max path length**, not rank, to know whether compression is working and whether trees are flattening.
- The default remains: single-process, in-memory, iterative splitting/halving + union by rank → `O(α(n))`. Drop compression only when persistence, rollback, replication, or sharding demands it.

References to study further: Tarjan & van Leeuwen "Worst-case analysis of set union algorithms" (1984), Jayanti & Tarjan "Concurrent disjoint set union" (2016), the "DSU on segment tree of time" technique for offline dynamic connectivity, and the sibling topics `03-union-by-rank` and `04-offline-lca`.

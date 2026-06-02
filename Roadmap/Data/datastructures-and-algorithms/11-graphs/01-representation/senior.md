# Graph Representation — Senior Level

> A representation that is perfect on a single node — an `O(V²)` matrix, a pointer-rich adjacency list — becomes a production incident the moment the graph outgrows one machine's RAM, must be queried concurrently, or has to be updated while traffic is live. At scale, the representation *is* the system-design decision.

## Table of Contents
1. [Introduction](#1-introduction)
2. [System Design — Graph Stores and When to Materialize](#2-system-design--graph-stores-and-when-to-materialize)
3. [Distributed and Out-of-Core Graphs](#3-distributed-and-out-of-core-graphs)
4. [Concurrency — Immutable CSR and Concurrent Reads](#4-concurrency--immutable-csr-and-concurrent-reads)
5. [Comparison at Scale](#5-comparison-at-scale)
6. [Architecture Patterns](#6-architecture-patterns)
7. [Code Examples](#7-code-examples)
8. [Observability](#8-observability)
9. [Failure Modes](#9-failure-modes)
10. [Capacity Planning — Bytes per Edge](#10-capacity-planning--bytes-per-edge)
11. [Serialization, Loading, and Versioning](#11-serialization-loading-and-versioning)
12. [Incremental and Streaming Updates](#12-incremental-and-streaming-updates)
13. [Zero-Copy mmap Load — Full Implementation](#13-zero-copy-mmap-load--full-implementation)
14. [Capacity Planning Worked End-to-End](#14-capacity-planning-worked-end-to-end)
15. [Summary](#15-summary)

---

## 1. Introduction

At the senior level the question is no longer "matrix or list?" but "where does this graph live, how is it built, who reads it concurrently, and what breaks when it grows past one machine?". A graph representation has three properties that drive every architectural decision:

- **Size.** `O(V²)` matrices are unusable past a few thousand vertices; `O(V+E)` lists scale to hundreds of millions of edges on one box, then need partitioning.
- **Mutability.** A live social or routing graph changes constantly; a batch analytics graph is built once and read a billion times. These want opposite representations.
- **Access pattern.** Point lookups ("are `u` and `v` connected?") want different layouts than full scans (PageRank, connected components).

The senior decisions are therefore: when to materialize a graph versus query it from a database; how to partition it across machines; how to make it safe for thousands of concurrent readers; and how to plan capacity in bytes-per-edge so you know the break point before you hit it.

---

## 2. System Design — Graph Stores and When to Materialize

### 2.1 Three tiers of graph storage

```mermaid
flowchart LR
    A[In-memory CSR / adjacency list<br/>~10^8 edges<br/>microsecond reads] --> B[Graph database<br/>Neo4j / JanusGraph / Neptune<br/>~10^10 edges<br/>millisecond reads, durable]
    B --> C[Distributed graph engine<br/>Pregel / GraphX / Giraph<br/>~10^12 edges<br/>batch, partitioned]
    style A fill:#e8f4ff,stroke:#0366d6
    style B fill:#fff4e8,stroke:#d97706
    style C fill:#ffe8e8,stroke:#dc2626
```

| Tier | When right | When wrong |
| --- | --- | --- |
| In-memory CSR / list | Fits in RAM, read-heavy, latency-critical traversal. | Graph exceeds RAM or must survive restarts without a rebuild. |
| Graph database | Durable, transactional, ad-hoc queries, mutable. | You run iterative analytics over the whole graph — DB traversal overhead dominates. |
| Distributed engine | Whole-graph analytics (PageRank, components) on `10¹¹`+ edges. | You need single-pair point queries — batch latency is seconds to minutes. |

### 2.2 Materialize vs query-on-demand

The most expensive recurring decision: do you **materialize** an in-memory representation (CSR), or **query** edges from a backing store per traversal step?

- Materialize when the graph fits in RAM and is read far more than written. Building CSR once and traversing it millions of times amortizes the build cost to nothing.
- Query-on-demand when the graph is huge, sparse in access (you only ever touch a small neighborhood), or changes faster than you can rebuild. A 2-hop friend recommendation touches thousands of edges out of billions — materializing the whole graph would be absurd.

A common hybrid: materialize a CSR snapshot for the read-mostly core, fall back to the database for the long tail and for writes.

---

## 3. Distributed and Out-of-Core Graphs

### 3.1 Partitioning — the central problem

To store a graph across `P` machines you must assign each vertex (and its edges) to a partition. The quality of the partition determines how many edges *cross* machines, and cross-partition edges are the cost — every traversal step that crosses a partition is a network hop.

- **Edge-cut partitioning** (assign vertices to machines, cut edges between them). Used by Pregel/Giraph. Minimizing the cut is NP-hard; in practice hash partitioning (`hash(vertex) mod P`) is used for simplicity, and metis-style multilevel partitioners are used when cut quality matters.
- **Vertex-cut partitioning** (assign edges to machines, replicate vertices). Used by PowerGraph/GraphX, much better for **power-law graphs** where a few hub vertices have enormous degree. A single hub's edges are split across many machines instead of overwhelming one.

```mermaid
flowchart TB
    P[Partitioner] -->|hash mod P| M0[Machine 0<br/>vertices 0,3,6...]
    P -->|hash mod P| M1[Machine 1<br/>vertices 1,4,7...]
    P -->|hash mod P| M2[Machine 2<br/>vertices 2,5,8...]
    M0 -.cross-edge message.-> M1
    M1 -.cross-edge message.-> M2
    style M1 fill:#ffe8e8,stroke:#dc2626
```

### 3.2 Pregel / vertex-centric model

Pregel (and its open-source descendants Giraph and Spark GraphX) represents the graph as partitioned adjacency lists and runs computation in **supersteps**: each vertex reads incoming messages, updates its state, and sends messages along its out-edges. The representation is a distributed CSR — each partition holds a local CSR plus a routing table mapping remote vertex ids to their owning machine. PageRank, connected components, and shortest paths all fit this "think like a vertex" model.

### 3.3 Out-of-core (single machine, disk-backed)

When a graph exceeds RAM but you do not want a cluster, **out-of-core** engines (GraphChi, X-Stream) stream the CSR from disk in shards. The key trick is ordering edges so that a sequential disk scan visits all edges touching a contiguous vertex range — turning random graph access into sequential I/O. CSR's flat layout is exactly what makes this possible; a pointer-based adjacency list cannot be streamed.

---

## 4. Concurrency — Immutable CSR and Concurrent Reads

### 4.1 The read-mostly graph

Most large graphs are read far more than written. The cleanest concurrency story is an **immutable CSR**: build it once, then share it across all reader threads with zero locking. Two flat arrays with no interior mutability are trivially thread-safe; readers never contend.

### 4.2 Handling writes — snapshot swap

When the graph must change, do **not** mutate the shared CSR in place. Instead:

1. Apply writes to a side buffer (a mutable delta log or a fresh adjacency list).
2. Periodically rebuild a new immutable CSR snapshot from the base plus deltas.
3. Atomically swap a single pointer (`atomic.Value` in Go, `AtomicReference` in Java) so new readers see the new snapshot; old readers finish on the old one and it is GC'd.

This is copy-on-write at the whole-graph granularity. Readers are lock-free; writers pay a periodic rebuild. It is exactly how read-optimized stores serve a slowly-changing graph under heavy concurrent load.

### 4.3 Fine-grained mutable graphs

If writes are frequent and reads must see them immediately, you fall back to a concurrent adjacency list with per-vertex locks (lock striping by vertex id) or a concurrent map of neighbor sets. This loses CSR's cache benefits but supports real-time mutation — the trade-off a graph database makes internally.

---

## 5. Comparison at Scale

| Representation | Build | Point query | Full scan | Mutable | Distributable | When |
| --- | --- | --- | --- | --- | --- | --- |
| In-memory matrix | `O(V²)` | `O(1)` | `O(V²)` | yes | poorly (dense blocks) | small dense graphs only |
| In-memory adjacency list | `O(V+E)` | `O(d)` | `O(V+E)` | yes | hard (pointers) | mutable, fits RAM |
| Immutable CSR | `O(V+E)` | `O(d)` | `O(V+E)`, fastest | no (rebuild) | yes (shard offsets) | static, read-heavy, hot |
| Graph database (Neo4j) | incremental | `O(d)` + I/O | slow (full scan over storage) | yes, ACID | clustered | durable, transactional, ad-hoc |
| Distributed CSR (Pregel) | `O((V+E)/P)` | network hop | `O((V+E)/P)` per superstep | batch | yes | whole-graph analytics |

The in-memory CSR wins whenever the graph fits in RAM and is read-mostly. The graph database wins when durability and transactions matter. The distributed engine wins only when the graph genuinely does not fit on one large machine — and modern machines hold a *lot* of edges, so reach for the cluster later than you think.

---

## 6. Architecture Patterns

### 6.1 CSR snapshot with atomic swap

```
writes --> delta log --> (periodic rebuild) --> new immutable CSR
                                                      |
readers ----atomic load of current snapshot pointer--+
```

Readers always dereference one atomic pointer to the current CSR and traverse lock-free. A background job rebuilds and swaps. Bounded staleness (the rebuild interval) is the trade-off for lock-free reads.

### 6.2 Tiered: hot CSR + cold database

Keep the read-hot subgraph (recent, high-traffic vertices) materialized in CSR; serve cold queries from the durable graph database. A cache-miss promotes a vertex's neighborhood into the hot tier. This bounds RAM while keeping the common case fast.

### 6.3 Compressed representations for scale

For web-scale graphs, store CSR with **gap-encoded, variable-length** neighbor ids (sort each vertex's neighbors, store deltas, compress with a byte-aligned varint or the WebGraph framework). This routinely cuts a web graph from `O(E)` 4-byte ids to `2–4 bits per edge`, letting a graph that would need 400 GB fit in 30 GB. The cost is `O(d)` decode per neighbor scan — usually worth it because memory, not CPU, is the bottleneck at this scale.

---

## 7. Code Examples

### 7.1 Go — immutable CSR with atomic snapshot swap

```go
package graph

import (
	"sort"
	"sync"
	"sync/atomic"
)

// CSR is an immutable, read-only graph snapshot. Safe for concurrent readers.
type CSR struct {
	offset []int32
	target []int32
}

func (c *CSR) Neighbors(u int32) []int32 {
	return c.target[c.offset[u]:c.offset[u+1]]
}

// buildCSR turns a directed edge slice into an immutable CSR.
func buildCSR(n int32, edges [][2]int32) *CSR {
	offset := make([]int32, n+1)
	for _, e := range edges {
		offset[e[0]+1]++
	}
	for i := int32(1); i <= n; i++ {
		offset[i] += offset[i-1]
	}
	target := make([]int32, len(edges))
	cursor := make([]int32, n)
	copy(cursor, offset[:n])
	for _, e := range edges {
		u := e[0]
		target[cursor[u]] = e[1]
		cursor[u]++
	}
	return &CSR{offset: offset, target: target}
}

// Store holds the current snapshot plus a pending write buffer.
type Store struct {
	n       int32
	current atomic.Pointer[CSR] // lock-free read
	mu      sync.Mutex          // guards pending writes
	pending [][2]int32
	base    [][2]int32
}

func NewStore(n int32, edges [][2]int32) *Store {
	s := &Store{n: n, base: edges}
	s.current.Store(buildCSR(n, edges))
	return s
}

// Read path: no locks, just an atomic load.
func (s *Store) Neighbors(u int32) []int32 {
	return s.current.Load().Neighbors(u)
}

// Write path: buffer the edge; it becomes visible after Rebuild.
func (s *Store) AddEdge(u, v int32) {
	s.mu.Lock()
	s.pending = append(s.pending, [2]int32{u, v})
	s.mu.Unlock()
}

// Rebuild folds pending edges into a fresh snapshot and swaps atomically.
func (s *Store) Rebuild() {
	s.mu.Lock()
	all := make([][2]int32, 0, len(s.base)+len(s.pending))
	all = append(all, s.base...)
	all = append(all, s.pending...)
	s.base = all
	s.pending = nil
	s.mu.Unlock()

	sort.Slice(all, func(i, j int) bool { return all[i][0] < all[j][0] })
	s.current.Store(buildCSR(s.n, all)) // readers see new snapshot atomically
}
```

Notes for review:

- Reads are fully lock-free — one atomic pointer load, then a slice into immutable arrays.
- Writes are buffered and applied in batches by `Rebuild`; this trades bounded staleness for lock-free reads.
- `int32` ids halve memory versus `int`; for `> 2³¹` vertices, switch to `int64`.

### 7.2 Java — immutable CSR shared across reader threads

```java
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicReference;

public final class GraphStore {
    // Immutable snapshot: two flat arrays, no interior mutability.
    public static final class CSR {
        final int[] offset;
        final int[] target;

        CSR(int[] offset, int[] target) {
            this.offset = offset;
            this.target = target;
        }

        public int[] neighbors(int u) {
            return Arrays.copyOfRange(target, offset[u], offset[u + 1]);
        }
    }

    private final int n;
    private final AtomicReference<CSR> current = new AtomicReference<>();

    public GraphStore(int n, int[][] edges) {
        this.n = n;
        current.set(build(n, edges));
    }

    public int[] neighbors(int u) { // lock-free read
        return current.get().neighbors(u);
    }

    public void swap(int[][] edges) { // build new snapshot, publish atomically
        current.set(build(n, edges));
    }

    private static CSR build(int n, int[][] edges) {
        int[] offset = new int[n + 1];
        for (int[] e : edges) offset[e[0] + 1]++;
        for (int i = 1; i <= n; i++) offset[i] += offset[i - 1];
        int[] target = new int[edges.length];
        int[] cursor = Arrays.copyOf(offset, n);
        for (int[] e : edges) target[cursor[e[0]]++] = e[1];
        return new CSR(offset, target);
    }
}
```

The `final` fields plus the `AtomicReference` publication give the JMM guarantee that a reader observing a new snapshot sees fully-initialized arrays. No reader ever needs a lock.

### 7.3 Python — out-of-core CSR scan from disk shards

```python
import struct
from typing import Iterator, Tuple


def scan_csr_shard(offset_path: str, target_path: str,
                   lo: int, hi: int) -> Iterator[Tuple[int, int]]:
    """Stream edges for vertices [lo, hi) sequentially from on-disk CSR arrays.

    offset_path: int32 offsets, length V+1
    target_path: int32 targets, length E
    Yields (u, v) edges; sequential disk reads make this out-of-core friendly.
    """
    with open(offset_path, "rb") as fo:
        fo.seek(lo * 4)
        offs = struct.unpack(f"<{hi - lo + 1}i", fo.read((hi - lo + 1) * 4))
    start, end = offs[0], offs[-1]
    with open(target_path, "rb") as ft:
        ft.seek(start * 4)
        chunk = ft.read((end - start) * 4)
    targets = struct.unpack(f"<{end - start}i", chunk)
    for u in range(lo, hi):
        a = offs[u - lo] - start
        b = offs[u - lo + 1] - start
        for k in range(a, b):
            yield u, targets[k]
```

Because CSR is flat, one `seek` + one big `read` pulls an entire vertex range's edges as sequential I/O — the property that makes disk-backed graph processing viable. A pointer-based adjacency list could never be streamed this way.

---

## 8. Observability

A graph representation is invisible until it OOMs or a traversal mysteriously slows. Instrument:

| Metric | Type | Why |
| --- | --- | --- |
| `graph_vertices`, `graph_edges` | gauge | Track growth toward the RAM ceiling. |
| `graph_bytes_resident` | gauge | Actual memory; compare against capacity plan. |
| `graph_max_degree` | gauge | A new super-hub can blow up per-vertex work and skew partitions. |
| `csr_rebuild_seconds` | histogram | Snapshot rebuild time; if it exceeds the write rate you fall behind. |
| `csr_snapshot_staleness_seconds` | gauge | How old is the current snapshot? Bounds read consistency. |
| `traversal_neighbors_visited` | histogram | Detect a query touching far more of the graph than expected. |
| `partition_cross_edge_ratio` | gauge | Fraction of edges crossing machines; high = bad partition, more network hops. |
| `graph_cache_miss_rate` | gauge | CSR locality regression (e.g. after losing vertex-order locality). |

The most actionable are `graph_bytes_resident` against the capacity plan, and `partition_cross_edge_ratio` for distributed graphs — a bad partition silently turns local reads into network storms.

---

## 9. Failure Modes

### 9.1 Matrix OOM on a sparse graph
Someone reaches for `int[V][V]` on a graph that grew to `V = 10⁵`. That is `10¹⁰` cells — instant OOM. Mitigation: never allocate a matrix without checking `V² · cellsize` against available RAM; default to a list/CSR.

### 9.2 Super-hub degree explosion
A power-law graph gains a celebrity vertex with degree `10⁸`. Any per-vertex operation that materializes `neighbors(hub)` allocates a huge slice; hash partitioning dumps the whole hub on one machine. Mitigation: vertex-cut partitioning, streaming neighbor iteration (never copy the slice), and degree-capping or two-level hub handling.

### 9.3 Snapshot rebuild falling behind writes
Write rate exceeds rebuild throughput; the delta log grows unbounded and staleness climbs. Mitigation: incremental CSR updates for the hot region, faster (parallel) rebuilds, or back-pressure on writes.

### 9.4 Lost vertex-order locality
Ids get renumbered (e.g. after a re-import) so neighbors are no longer near each other in `target[]`. Cache-miss rate spikes, traversals slow 3–5×. Mitigation: relabel vertices by a locality-preserving order (BFS order, or a space-filling curve for spatial graphs) before building CSR.

### 9.5 Cross-partition message storm
A poorly partitioned distributed graph sends a message across the network for nearly every edge. Mitigation: measure `partition_cross_edge_ratio`, repartition with a multilevel partitioner, or switch edge-cut → vertex-cut for power-law graphs.

### 9.6 Concurrent mutation tearing
Someone mutates a "shared" adjacency list while readers traverse it, producing torn reads or `ConcurrentModificationException`. Mitigation: make the shared representation immutable (CSR + atomic swap); route all writes through the rebuild path.

---

## 10. Capacity Planning — Bytes per Edge

### 10.1 The fundamental numbers

Per directed edge, by representation (32-bit ids):

- **CSR:** `4 bytes` (one `int32` in `target[]`) plus the amortized `offset` cost `4·(V+1)/E` bytes. For `E ≫ V`, effectively **4 bytes/edge**.
- **Adjacency list (`int[]` per vertex):** `4 bytes/edge` for the value plus slice/array header overhead per vertex (`~24–48 bytes/vertex` in Go/Java) and capacity slack (often 1.5–2× over-allocation).
- **Adjacency list (`List<Integer>` in Java):** `16 bytes/edge` — each `Integer` is a boxed object (`~16 B`) plus the backing array reference. Avoid boxed collections for large graphs.
- **Adjacency matrix:** `V²/8 bytes` for a bitset (`0/1`), `V² · 4` for weighted. Independent of `E`.
- **Compressed (gap + varint):** `0.25–1 byte/edge` on web graphs — the only way to fit `10¹¹`-edge graphs in commodity RAM.

### 10.2 Worked example

A social graph: `V = 2×10⁸` users, average degree 200, so `E = 4×10¹⁰` directed edges.

- CSR with `int32` ids: `4·10¹⁰ · 4 B = 160 GB` of targets + `(2×10⁸+1)·4 B ≈ 0.8 GB` offsets ≈ **161 GB**. Fits on a single large memory-optimized instance (e.g. 256–512 GB RAM). Materialize it.
- Same as `List<List<Integer>>` in Java: `~16 B/edge = 640 GB` plus per-vertex overhead — does **not** fit; you would shard or switch to primitive CSR.
- Compressed CSR (gap-encoded, ~1 B/edge): `~40 GB` — fits comfortably, at the cost of varint decode per neighbor.

### 10.3 When to leave a single node

Move off in-memory CSR when any of these holds:

- `bytes(E) + bytes(V)` exceeds the largest practical single-machine RAM (today ~1–2 TB) even after compression.
- The graph must be durable and transactional → graph database.
- Whole-graph analytics latency on one machine is unacceptable → distributed engine with partitioned CSR.

Until then, one big box with a compressed immutable CSR beats a cluster on both latency and operational simplicity. Modern hardware holds tens of billions of edges; reach for distribution later than instinct suggests.

---

## 11. Serialization, Loading, and Versioning

A graph that lives only in RAM is one process crash away from a multi-minute rebuild. At scale you persist the *built* representation, not just the raw edges, so a restart is a `mmap`, not a recompute.

### 11.1 On-disk CSR layout

Persist CSR as a self-describing binary blob: a fixed header (`magic`, `version`, `n`, `m`, `id_width`, `flags`) followed by the `offset[]` array and the `target[]` array, both little-endian and naturally aligned. Because both are flat, the file is a byte-for-byte image of the in-memory arrays:

```text
[ header 64 B ][ offset: (n+1) * 4 B ][ target: m * 4 B ][ optional weight: m * 4 B ]
```

The payoff is **zero-copy load**: `mmap` the file and reinterpret the bytes as `int32` slices — no parsing, no allocation, no rebuild. A 160 GB social-graph CSR loads in the time it takes the OS to set up page tables; pages fault in lazily as traversals touch them. A pointer-based adjacency list cannot do this — its heap pointers are meaningless across processes — which is another reason CSR dominates the read-mostly tier.

### 11.2 Versioning and schema evolution

Bake a `version` byte and an `id_width` (4 vs 8) into the header so a reader can reject or up-convert an incompatible file rather than silently misinterpret offsets. When you cross the `2³¹`-vertex boundary you flip `id_width` to 8 and double the file; readers branch on the header. Treat the format like any wire protocol: never reuse a field meaning, always add new fields after the existing ones, and validate `n`, `m`, and `offset[n] == m` on load before trusting a single byte.

### 11.3 Snapshot distribution

For a fleet of read replicas, the rebuild-and-swap pattern (§4.2) extends across machines: a builder node produces a new immutable CSR file, writes it to object storage (S3/GCS) under a content-addressed key, and replicas atomically `mmap` the new blob and swap their snapshot pointer. This is the same copy-on-write story at cluster granularity — replicas serve lock-free reads from an immutable mapped file while the next snapshot is built out of band. Staleness equals the build-plus-distribute interval, which you expose as a metric (`csr_snapshot_staleness_seconds`).

---

## 12. Incremental and Streaming Updates

The snapshot-swap model assumes you can afford a periodic full rebuild. For a fast-changing hot region or a true streaming graph, a full `Θ(n + m)` rebuild per batch is wasteful. Three escalating strategies:

### 12.1 Delta overlay on an immutable base

Keep the immutable CSR base plus a small mutable **overlay** (a per-vertex hash map of added/removed neighbors). A neighbor query reads the base block and applies the overlay diff:

```text
neighbors(u) = (base.Neighbors(u) \ removed[u]) ∪ added[u]
```

Reads stay lock-free against the base and take a cheap lock (or a second atomic snapshot) only on the overlay. When the overlay grows past a threshold (say 5–10% of `m`), fold it into the base with one background rebuild and clear it. This bounds both staleness and the per-query overlay cost.

### 12.2 Slotted / gap CSR

Allocate each vertex's neighbor block with slack (a `cap[u] ≥ deg[u]`), so an insertion writes into a free slot in place instead of shifting the whole `target[]`. This is the **CSR-with-gaps** used by GPU dynamic-graph frameworks (Hornet, faimGraph). Inserts are `O(1)` until a block overflows, at which point that single block is relocated to a fresh region (amortized `O(1)` with doubling). It sacrifices a little space and perfect locality for in-place mutation without a global rebuild.

### 12.3 Log-structured merge for graphs

Borrowing from LSM trees: writes land in a small in-memory level (an adjacency hash map); when it fills it is flushed to an immutable sorted CSR run; runs are periodically merged. Reads consult the in-memory level plus the runs, newest-wins. This gives high write throughput and bounded read fan-out, and is essentially how transactional graph databases (and time-evolving graph stores) keep both writes cheap and full scans CSR-fast. The trade-off mirrors the LSM read-amplification story: more runs means more blocks to merge per neighbor query until compaction catches up.

### 12.4 Choosing a strategy

| Write rate | Read latency need | Strategy |
| --- | --- | --- |
| Low (hourly batches) | Microsecond, lock-free | Full rebuild + atomic swap |
| Moderate, bursty | Low, slightly stale OK | Delta overlay on immutable base |
| High, in-place | Microsecond, GPU/many-core | Slotted (gap) CSR |
| Very high, durable | Millisecond, durable | LSM-structured CSR runs |

The unifying principle: keep the *bulk* of the graph in immutable, cache-friendly CSR and confine mutation to a small, separately-managed delta — never mutate the shared flat arrays in place under concurrent readers.

---

## 13. Zero-Copy mmap Load — Full Implementation

Section 11 argued that persisting the *built* CSR lets a restart be a `mmap` rather than a multi-minute rebuild. This section shows the actual mechanics in all three languages, including the header validation that keeps a corrupt or version-skewed file from being silently misinterpreted as offsets and targets.

The on-disk layout is the one from §11.1: a 64-byte header followed by the two flat arrays.

```text
offset 0    [ magic "CSRG" | u32 version | u32 idWidth | u64 n | u64 m | u32 flags | pad ]  64 B
offset 64   [ offset[]:  (n+1) * 4 B  little-endian int32 ]
offset ...  [ target[]:   m    * 4 B  little-endian int32 ]
```

### 13.1 Go — mmap a CSR file and reinterpret bytes with no copy

```go
package graph

import (
	"encoding/binary"
	"fmt"
	"os"
	"unsafe"

	"golang.org/x/sys/unix"
)

const headerSize = 64
const magic = 0x47525343 // "CSRG" little-endian

// MappedCSR is a read-only CSR backed directly by an mmap'd file.
// No parsing, no allocation: the arrays alias the mapped pages.
type MappedCSR struct {
	data   []byte  // the whole mmap region (kept alive so the GC won't unmap)
	offset []int32 // aliases data[64 : 64+(n+1)*4]
	target []int32 // aliases the remainder
	n, m   int64
}

func OpenCSR(path string) (*MappedCSR, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	fi, _ := f.Stat()
	data, err := unix.Mmap(int(f.Fd()), 0, int(fi.Size()),
		unix.PROT_READ, unix.MAP_SHARED)
	if err != nil {
		return nil, err
	}
	// Validate the header before trusting a single offset.
	if binary.LittleEndian.Uint32(data[0:4]) != magic {
		return nil, fmt.Errorf("bad magic, not a CSR file")
	}
	if v := binary.LittleEndian.Uint32(data[4:8]); v != 1 {
		return nil, fmt.Errorf("unsupported version %d", v)
	}
	if w := binary.LittleEndian.Uint32(data[8:12]); w != 4 {
		return nil, fmt.Errorf("id width %d unsupported (need int64 path)", w)
	}
	n := int64(binary.LittleEndian.Uint64(data[16:24]))
	m := int64(binary.LittleEndian.Uint64(data[24:32]))

	// Reinterpret the mapped bytes as []int32 slices — the zero-copy step.
	offBytes := data[headerSize : headerSize+(n+1)*4]
	tgtBase := headerSize + (n+1)*4
	tgtBytes := data[tgtBase : tgtBase+m*4]
	off := unsafe.Slice((*int32)(unsafe.Pointer(&offBytes[0])), n+1)
	tgt := unsafe.Slice((*int32)(unsafe.Pointer(&tgtBytes[0])), m)

	// Cheap integrity check: the last offset must equal the edge count.
	if int64(off[n]) != m {
		return nil, fmt.Errorf("offset[n]=%d != m=%d, file corrupt", off[n], m)
	}
	return &MappedCSR{data: data, offset: off, target: tgt, n: n, m: m}, nil
}

func (c *MappedCSR) Neighbors(u int32) []int32 {
	return c.target[c.offset[u]:c.offset[u+1]]
}

func (c *MappedCSR) Close() error { return unix.Munmap(c.data) }
```

The traversal then faults pages in lazily: a BFS that touches only a small neighborhood pays for only the pages it reads, not the whole 160 GB file. `MAP_SHARED` + `PROT_READ` means many processes on one box share the same physical pages — N replicas of a read-only graph cost one copy of RAM.

### 13.2 Java — `MappedByteBuffer` as an `IntBuffer` view

```java
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteOrder;
import java.nio.IntBuffer;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;

public final class MappedCSR implements AutoCloseable {
    private static final int MAGIC = 0x47525343; // "CSRG"
    private final IntBuffer offset; // (n+1) ints, view into the map
    private final IntBuffer target; // m ints
    private final long n, m;
    private final FileChannel channel;

    public MappedCSR(String path) throws IOException {
        RandomAccessFile raf = new RandomAccessFile(path, "r");
        channel = raf.getChannel();
        long size = channel.size();
        MappedByteBuffer buf = channel.map(FileChannel.MapMode.READ_ONLY, 0, size);
        buf.order(ByteOrder.LITTLE_ENDIAN);

        if (buf.getInt(0) != MAGIC) throw new IOException("bad magic");
        if (buf.getInt(4) != 1)     throw new IOException("unsupported version");
        if (buf.getInt(8) != 4)     throw new IOException("id width != 4");
        n = buf.getLong(16);
        m = buf.getLong(24);

        // Slice off the header, then expose the two regions as IntBuffers.
        buf.position(64);
        offset = buf.slice().asIntBuffer();
        offset.limit((int) (n + 1));
        buf.position(64 + (int) (n + 1) * 4);
        target = buf.slice().asIntBuffer();
        target.limit((int) m);

        if (offset.get((int) n) != m) throw new IOException("offset[n] != m");
    }

    public int degree(int u) { return offset.get(u + 1) - offset.get(u); }

    public int neighbor(int u, int k) { return target.get(offset.get(u) + k); }

    @Override public void close() throws IOException { channel.close(); }
}
```

`MappedByteBuffer` keeps the bytes in the OS page cache, outside the Java heap — so a 160 GB graph does not inflate the heap or pressure the garbage collector, and the GC never scans it. This is the standard trick for serving graphs larger than a sane heap.

### 13.3 Python — `mmap` + `memoryview.cast` for a parse-free load

```python
import mmap
import struct
from typing import List


class MappedCSR:
    """Read-only CSR backed by an mmap; arrays are zero-copy memoryviews."""

    MAGIC = 0x47525343  # "CSRG"
    HEADER = 64

    def __init__(self, path: str) -> None:
        self._file = open(path, "rb")
        self._mm = mmap.mmap(self._file.fileno(), 0, prot=mmap.PROT_READ)
        magic, version, id_width = struct.unpack_from("<III", self._mm, 0)
        if magic != self.MAGIC:
            raise ValueError("not a CSR file")
        if version != 1:
            raise ValueError(f"unsupported version {version}")
        if id_width != 4:
            raise ValueError("id width != 4")
        self.n, self.m = struct.unpack_from("<QQ", self._mm, 16)

        view = memoryview(self._mm)
        off_end = self.HEADER + (self.n + 1) * 4
        # cast() reinterprets the bytes as int32 with no copy.
        self.offset = view[self.HEADER:off_end].cast("i")
        self.target = view[off_end:off_end + self.m * 4].cast("i")
        if self.offset[self.n] != self.m:
            raise ValueError("offset[n] != m, file corrupt")

    def neighbors(self, u: int) -> List[int]:
        return self.target[self.offset[u]:self.offset[u + 1]].tolist()

    def degree(self, u: int) -> int:
        return self.offset[u + 1] - self.offset[u]

    def close(self) -> None:
        self.offset.release()
        self.target.release()
        self._mm.close()
        self._file.close()
```

`memoryview.cast("i")` gives an `int32` view over the mapped bytes with zero copying; slicing it never materializes a list until `.tolist()` is called. Even in Python — where everything is usually boxed — the bulk graph stays as raw mapped pages, so a multi-gigabyte CSR loads in milliseconds and shares the page cache across worker processes.

### 13.4 The architecture this unlocks

```text
                     ┌─────────────────────────┐
                     │  builder node           │
                     │  edges → sorted CSR      │
                     │  → write CSRG blob       │
                     └────────────┬────────────┘
                                  │  PUT  graph-<contenthash>.csr
                                  ▼
                     ┌─────────────────────────┐
                     │  object storage (S3/GCS) │
                     │  content-addressed blobs │
                     └────────────┬────────────┘
                  GET (lazy/range)│
        ┌─────────────────┬───────┴────────┬─────────────────┐
        ▼                 ▼                ▼                 ▼
   ┌─────────┐       ┌─────────┐      ┌─────────┐       ┌─────────┐
   │replica 0│       │replica 1│      │replica 2│       │replica 3│
   │ mmap +  │       │ mmap +  │      │ mmap +  │       │ mmap +  │
   │ atomic  │       │ atomic  │      │ atomic  │       │ atomic  │
   │ swap ptr│       │ swap ptr│      │ swap ptr│       │ swap ptr│
   └─────────┘       └─────────┘      └─────────┘       └─────────┘
   lock-free reads from the immutable mapped snapshot; next blob built out of band
```

Each replica does exactly what §13.1–§13.3 implement: `mmap` the new blob, validate its header, atomically swap the snapshot pointer (the §4.2 pattern, now at fleet scale). The content-addressed key means a replica that already holds blob `<hash>` skips the download entirely; rollback is "point at the previous hash." Staleness equals the build-plus-distribute interval, exported as `csr_snapshot_staleness_seconds`.

---

## 14. Capacity Planning Worked End-to-End

§10 gave the bytes-per-edge numbers; this section walks a single realistic sizing decision from requirements to an instance choice, the way it would happen in a design review.

### 14.1 The requirement

> Serve 2-hop neighborhood queries for a follow graph. `V = 5×10⁸` accounts, mean out-degree 150, p99 latency budget 5 ms, read QPS 200k, write QPS 20k (new follows), durability handled separately by the source-of-truth database. The in-memory graph is a *read accelerator*, rebuildable from the DB.

### 14.2 Step 1 — raw size

```text
E_directed = V * mean_out_degree = 5e8 * 150 = 7.5e10 directed edges
target[]   = E * 4 B   (int32 ids)            = 7.5e10 * 4  = 300 GB
offset[]   = (V + 1) * 4 B                     ≈ 5e8 * 4     = 2 GB
            ----------------------------------------------------------
primitive CSR resident                          ≈ 302 GB
```

`V = 5×10⁸ < 2³¹ = 2.1×10⁹`, so `int32` ids are safe — no need for the 8-byte id path that would double everything to ~600 GB.

### 14.3 Step 2 — does it fit, and at what cost?

| Option | Resident | Fits one box? | Note |
|---|---|---|---|
| Primitive CSR, int32 | ~302 GB | Yes (memory-optimized 512 GB–1 TB instance) | Headroom for the OS, page cache, query state. |
| Boxed `List<List<Integer>>` | ~1.2 TB (16 B/edge) | Barely / no | GC pressure makes p99 unachievable; rejected. |
| Gap+varint compressed CSR | ~75–150 GB (1–2 B/edge) | Comfortably | Adds varint decode per neighbor — check the latency budget. |

### 14.4 Step 3 — latency check against the budget

A 2-hop query touches `≈ deg + Σ_{first hop} deg ≈ 150 + 150·150 = 22,650` edges in the worst typical case. Each neighbor read is a likely cache miss (~100 ns on a random `target[]`/`offset[]` access):

```text
primitive CSR:   22,650 misses * 100 ns           ≈ 2.3 ms   (within 5 ms budget) ✓
compressed CSR:  22,650 * (100 ns + ~20 ns decode) ≈ 2.7 ms   (still within budget) ✓
```

Both meet 5 ms. The decision hinges on RAM cost versus instance availability, not latency — so pick primitive CSR if a 512 GB instance is cheap and available, compressed CSR if you want to run on a 256 GB instance or pack more replicas per host.

### 14.5 Step 4 — write path and rebuild cadence

20k follows/s into a 7.5×10¹⁰-edge base is `1.7×10⁹` new edges/day — about 2.3% growth/day. Using the delta-overlay strategy (§12.1) with a 5% overlay threshold, a full rebuild is needed roughly every two days. Rebuild cost:

```text
rebuild = counting-sort over (E + delta) ≈ 7.7e10 edges
parallel build at ~2e9 edges/s/core * 32 cores ≈ 6.4e10 edges/s
rebuild wall time ≈ 7.7e10 / 6.4e10 ≈ 1.2 s of CPU-bound scatter
                  + sort + I/O ≈ tens of seconds total
```

Comfortably under the every-two-day cadence, so the overlay never overflows and `csr_rebuild_seconds` stays well below the inter-rebuild interval — the §9.3 failure mode (rebuild falling behind writes) does not trigger.

### 14.6 Step 5 — replica fleet sizing

```text
read QPS 200k, per-query CPU ≈ 2.3 ms (cache-miss bound, single thread)
per-core throughput ≈ 1 / 2.3 ms ≈ 435 q/s
cores needed ≈ 200,000 / 435 ≈ 460 cores
at 64 cores/replica ≈ 8 replicas for compute
```

Memory says one replica per ~512 GB box; compute says ~8 boxes. Compute dominates here, so provision ~8 replicas (plus 1–2 for redundancy), each `mmap`-ing the shared blob (§13). The conclusion: a fleet of ten 512 GB / 64-core instances serves a 75-billion-edge follow graph at 200k QPS within a 5 ms budget — no cluster graph engine required, vindicating the §5 "reach for distribution later than instinct suggests" rule.

---

## 15. Summary

- The representation is a system-design decision: size, mutability, and access pattern dictate it more than asymptotics do.
- Materialize an in-memory CSR when the graph fits in RAM and is read-mostly; query a graph database when durability and transactions matter; reach for a distributed engine only when the graph truly does not fit on one large machine.
- Partitioning quality (edge-cut vs vertex-cut) determines network cost; power-law graphs need vertex-cut to tame super-hubs.
- Immutable CSR plus atomic snapshot swap gives lock-free concurrent reads with bounded staleness — the cleanest concurrency story for a read-heavy graph.
- Plan in bytes-per-edge: primitive CSR is ~4 B/edge, boxed Java lists ~16 B/edge, compressed web graphs under 1 B/edge. The break point is predictable; compute it before you allocate.
- Watch `graph_bytes_resident`, `csr_snapshot_staleness`, super-hub degree, and `partition_cross_edge_ratio` — these catch the failures (OOM, stale reads, message storms) that throughput metrics miss.
- Persist the *built* CSR as a flat, versioned binary blob so a restart is a zero-copy `mmap` rather than a multi-minute rebuild; distribute snapshots to read replicas via content-addressed object storage and atomic pointer swap.
- For fast-changing graphs, confine mutation to a small delta — a delta overlay on an immutable base, a slotted (gap) CSR for in-place inserts, or LSM-structured CSR runs — and never mutate the shared flat arrays in place under concurrent readers.

References to study further: Pregel (Malewicz et al. 2010), PowerGraph vertex-cut partitioning (Gonzalez et al. 2012), GraphChi out-of-core (Kyrola et al. 2012), the WebGraph compression framework (Boldi & Vigna), and Neo4j's native graph storage internals.

---
layout: default
title: Tasks
parent: Concurrent Trees
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/04-concurrent-trees/tasks/
---

# Concurrent Trees — Tasks

A graduated series of coding tasks. Complete each in your own editor; verify with tests. Difficulty increases gradually.

## Task 1: Safe wrapper (junior)

**Goal:** Wrap `github.com/google/btree.BTreeG` with a `sync.RWMutex`.

**Requirements:**

- Type: `SafeBTree`
- Methods: `Set(k int, v string)`, `Get(k int) (string, bool)`, `Delete(k int) bool`, `Len() int`.
- All methods are safe for concurrent use.
- `Get` uses `RLock`; mutations use `Lock`.

**Acceptance test:**

```go
func TestSafeBTree(t *testing.T) {
    s := New()
    var wg sync.WaitGroup
    for w := 0; w < 8; w++ {
        wg.Add(1)
        go func(seed int) {
            defer wg.Done()
            for i := 0; i < 10_000; i++ {
                s.Set(seed*10_000+i, "x")
            }
        }(w)
    }
    wg.Wait()
    if s.Len() != 80_000 {
        t.Fatalf("len=%d", s.Len())
    }
}
```

Run with `go test -race`.

---

## Task 2: Range query (junior)

**Goal:** Add a `Range(lo, hi int) []int` method that returns all keys in `[lo, hi)`.

**Requirements:**

- Returns keys in ascending order.
- Empty slice if no keys in range.
- Thread-safe.

**Acceptance test:**

```go
func TestRange(t *testing.T) {
    s := New()
    for i := 0; i < 100; i++ {
        s.Set(i, "x")
    }
    keys := s.Range(20, 30)
    if len(keys) != 10 || keys[0] != 20 || keys[9] != 29 {
        t.Fatalf("range=%v", keys)
    }
}
```

---

## Task 3: TTL cache (junior+)

**Goal:** Build a TTL cache backed by a B-tree.

**Requirements:**

- Type: `Cache`
- Methods: `Set(key string, value any, ttl time.Duration)`, `Get(key string) (any, bool)`, `Sweep(now time.Time) int`.
- Dual indexes: `map[string]Entry` for fast Get; B-tree of `Entry` sorted by `Expires` for sweep.
- Thread-safe with one `sync.Mutex`.

**Acceptance test:**

```go
func TestCacheTTL(t *testing.T) {
    c := New()
    c.Set("a", 1, 1*time.Hour)
    c.Set("b", 2, 1*time.Millisecond)
    time.Sleep(10 * time.Millisecond)
    removed := c.Sweep(time.Now())
    if removed != 1 {
        t.Fatalf("removed=%d", removed)
    }
    if _, ok := c.Get("a"); !ok {
        t.Fatalf("a should still be there")
    }
    if _, ok := c.Get("b"); ok {
        t.Fatalf("b should be expired")
    }
}
```

---

## Task 4: Sharded store (middle)

**Goal:** Build a sharded version of the safe wrapper.

**Requirements:**

- Type: `ShardedStore`
- 16 shards, each with its own `sync.Mutex` and `btree.BTreeG`.
- Sharding by `hash(key) % 16`.
- Methods: `Set(key int, val string)`, `Get(key int) (string, bool)`, `Len() int` (sums across shards).

**Acceptance test:**

```go
func TestShardedStore(t *testing.T) {
    s := New()
    var wg sync.WaitGroup
    for w := 0; w < 16; w++ {
        wg.Add(1)
        go func(seed int) {
            defer wg.Done()
            for i := 0; i < 10_000; i++ {
                s.Set(seed*10_000+i, "x")
            }
        }(w)
    }
    wg.Wait()
    if s.Len() != 160_000 {
        t.Fatalf("len=%d", s.Len())
    }
}
```

Run with `go test -race`.

---

## Task 5: Publish/subscribe COW (middle)

**Goal:** Implement publish/subscribe COW around `github.com/tidwall/btree.BTreeG`.

**Requirements:**

- Type: `PubSubStore`
- Methods: `Set(key string, value any)`, `Get(key string) (any, bool)`.
- Single writer mutex.
- `atomic.Pointer[btree.BTreeG[Item]]` for the published snapshot.
- `Get` does not take the mutex.

**Acceptance test:**

```go
func TestPubSubStore(t *testing.T) {
    s := New()
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        for i := 0; i < 10_000; i++ {
            s.Set(fmt.Sprintf("k%d", i), i)
        }
    }()
    for r := 0; r < 8; r++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for i := 0; i < 100_000; i++ {
                s.Get(fmt.Sprintf("k%d", rand.Intn(10_000)))
            }
        }()
    }
    wg.Wait()
}
```

Verify under `-race`. Benchmark and compare to Task 1.

---

## Task 6: Snapshot API (middle)

**Goal:** Add `Snapshot()` to the publish/subscribe store.

**Requirements:**

- `Snapshot()` returns a `*Snapshot` that supports `Get(key)`, `Range(lo, hi, fn)`, `Len()`.
- The snapshot is immutable; it sees a fixed point in time.
- Snapshot does not block writers.

**Acceptance test:**

```go
func TestSnapshot(t *testing.T) {
    s := New()
    for i := 0; i < 100; i++ {
        s.Set(fmt.Sprintf("k%d", i), i)
    }
    snap := s.Snapshot()
    for i := 100; i < 200; i++ {
        s.Set(fmt.Sprintf("k%d", i), i)
    }
    if snap.Len() != 100 {
        t.Fatalf("snap.Len=%d", snap.Len())
    }
    // Live store should have 200.
    var live int
    s.Snapshot().Range("", "z", func(k string, _ any) bool { live++; return true })
    if live != 200 {
        t.Fatalf("live=%d", live)
    }
}
```

---

## Task 7: LRU cache with ordered eviction (middle)

**Goal:** Build an LRU cache that uses a tree keyed by access time.

**Requirements:**

- Type: `LRU`
- Methods: `Set(key string, val any)`, `Get(key string) (any, bool)`.
- Capacity bound: evicts the least-recently-used entry when full.
- Uses both a `map` (for O(1) lookup) and a tree (for O(log n) ordered eviction).
- Thread-safe.

**Acceptance test:**

```go
func TestLRU(t *testing.T) {
    l := New(3)
    l.Set("a", 1)
    l.Set("b", 2)
    l.Set("c", 3)
    l.Get("a") // bumps a to most recent
    l.Set("d", 4) // evicts b (oldest after the bump)
    if _, ok := l.Get("b"); ok {
        t.Fatalf("b should be evicted")
    }
    if _, ok := l.Get("a"); !ok {
        t.Fatalf("a should still be there")
    }
}
```

---

## Task 8: MVCC version chain (senior)

**Goal:** Build a per-key MVCC version chain on top of a concurrent tree.

**Requirements:**

- Each row has a chain of versions.
- `Read(key, snapshot)` returns the value visible at `snapshot`.
- `Write(key, value, txID)` prepends a new version.
- `GC(minActive)` removes versions older than `minActive`.

**Acceptance test:**

```go
func TestMVCC(t *testing.T) {
    e := New()
    e.Write("k", "v1", 1)
    e.Write("k", "v2", 2)
    e.Write("k", "v3", 3)
    if v, _ := e.Read("k", 1); v != "v1" {
        t.Fatalf("at 1: %v", v)
    }
    if v, _ := e.Read("k", 2); v != "v2" {
        t.Fatalf("at 2: %v", v)
    }
    if v, _ := e.Read("k", 3); v != "v3" {
        t.Fatalf("at 3: %v", v)
    }
    e.GC(2)
    // After GC, snapshot 1 may not be able to find its version.
}
```

---

## Task 9: Hand-over-hand BST (senior)

**Goal:** Implement a binary search tree with hand-over-hand locking.

**Requirements:**

- Each node has its own `sync.RWMutex`.
- Reads traverse with at most 2 locks at any moment.
- Writes traverse with appropriate write locks.
- No rebalancing required.

**Acceptance test:**

```go
func TestHOH(t *testing.T) {
    tr := New()
    var wg sync.WaitGroup
    for w := 0; w < 8; w++ {
        wg.Add(1)
        go func(seed int) {
            defer wg.Done()
            for i := 0; i < 10_000; i++ {
                tr.Insert(seed*10_000+i, "x")
            }
        }(w)
    }
    wg.Wait()
    for i := 0; i < 80_000; i++ {
        if _, ok := tr.Get(i); !ok {
            t.Fatalf("missing %d", i)
        }
    }
}
```

Run with `go test -race`.

---

## Task 10: Lehman-Yao B-link (senior+)

**Goal:** Implement a Lehman-Yao B-link tree of int64 keys to string values.

**Requirements:**

- Each node has a high key and a right-sibling pointer.
- Reads follow right siblings when the target key exceeds the high key.
- Writes use latch crabbing with preemptive splits.
- Splits publish the new right sibling before updating the parent.

**Acceptance test:**

```go
func TestBlink(t *testing.T) {
    tr := New()
    var wg sync.WaitGroup
    for w := 0; w < 8; w++ {
        wg.Add(1)
        go func(seed int) {
            defer wg.Done()
            for i := 0; i < 10_000; i++ {
                tr.Set(int64(seed)*10_000+int64(i), "x")
            }
        }(w)
    }
    wg.Wait()
    for i := int64(0); i < 80_000; i++ {
        if _, ok := tr.Get(i); !ok {
            t.Fatalf("missing %d", i)
        }
    }
}
```

This is a difficult task. The implementation is ~200-300 lines. See senior.md Appendix A for a skeleton.

---

## Task 11: Order book (senior+)

**Goal:** Build an in-memory order book with bids, asks, and matching.

**Requirements:**

- Type: `OrderBook`
- Methods: `PlaceBid(o Order)`, `PlaceAsk(o Order)`, `Cancel(id string) bool`, `Match() []Trade`, `MarketData(depth int) Snapshot`.
- Bids sorted by (price desc, time asc, id asc).
- Asks sorted by (price asc, time asc, id asc).
- `MarketData` returns a point-in-time snapshot, lock-free.
- `Match` is atomic with respect to other operations.

See senior.md Appendix H for a reference implementation.

---

## Task 12: Metrics index (senior+)

**Goal:** Build the metrics server from senior.md Appendix AF.

**Requirements:**

- Per-series ordered tree of (timestamp, value).
- Publish/subscribe COW per series.
- Global series index `map[string]*Series` with `RWMutex`.
- Methods: `Ingest(series, ts, value)`, `Query(series, lo, hi)`, `EvictOlderThan(cutoff)`.
- Throughput target: 1M ingests/sec, 1M queries/sec on 16 cores.

Run benchmarks and verify throughput.

---

## Task 13: Snapshot isolation engine (professional)

**Goal:** Build a snapshot-isolation MVCC engine in Go.

**Requirements:**

- Transaction lifecycle: `Begin()`, `Read(key)`, `Write(key, val)`, `Commit()`, `Abort()`.
- Snapshot isolation: each tx sees a consistent point in time.
- Write-write conflict detection: second-committer-aborts.
- Per-key version chains.
- Background GC.

See senior.md Appendix BA for a skeleton.

---

## Task 14: Sharded MVCC engine (professional)

**Goal:** Extend Task 13 to be sharded for high concurrency.

**Requirements:**

- 16 shards.
- Sharding by hash of key.
- Per-shard COW snapshots.
- Cross-shard reads collect from all shards.
- Cross-shard transactions atomically validate across all touched shards.

This is hard; the cross-shard atomicity is the tricky part. Consider per-shard commit votes with a two-phase commit.

---

## Task 15: Concurrent ART (professional)

**Goal:** Implement a concurrent Adaptive Radix Tree for string keys.

**Requirements:**

- Node types: Node4, Node16, Node48, Node256.
- Adaptive resizing.
- Prefix compression.
- OLFIT-style optimistic concurrency.

This is a multi-week project. See professional.md Appendix AK and BO for skeletons.

---

## Task 16: Bw-tree skeleton (professional)

**Goal:** Implement a minimal Bw-tree (no splits, no merges).

**Requirements:**

- Mapping table.
- Delta records for inserts and deletes.
- Consolidation when chain exceeds threshold.
- Lock-free reads.

See professional.md Appendix AJ for a skeleton. Splits and merges are out of scope for this task; they triple the implementation difficulty.

---

## Task 17: Profiling and optimization (senior+)

**Goal:** Profile one of your earlier implementations and optimize the hottest path.

**Requirements:**

- Set up a realistic benchmark.
- Run `go test -bench=. -cpuprofile=cpu.prof`.
- Analyze with `go tool pprof`.
- Identify the top function.
- Optimize it (e.g., reduce allocations, use a better data structure, change locking).
- Re-benchmark; show measurable improvement.

This task is open-ended. The skill is the profile-then-optimize loop, not a specific answer.

---

## Task 18: Stress testing (professional)

**Goal:** Write a stress test harness for one of your implementations.

**Requirements:**

- Random operations: get, set, delete, snapshot, range scan.
- Many concurrent goroutines.
- Invariant checks (e.g., after Set, key is in tree).
- Runs for at least 10 minutes without failure.
- Catches at least one bug if one is introduced (test the test).

---

## Task 19: Comparison study (senior+)

**Goal:** Compare 4-6 implementations on the same workload.

**Requirements:**

- Single Mutex, RWMutex, Sharded Mutex, Sharded COW, Publish/Subscribe COW.
- Same benchmark for each.
- Run with `-cpu=1,4,16,64`.
- Plot throughput vs cores.
- Identify the inflection points.
- Write a 1-page summary.

This is a study, not a coding task. Produce a writeup for your team.

---

## Task 20: Production deployment (capstone)

**Goal:** Deploy one of your tree implementations behind a real service.

**Requirements:**

- Wrap with HTTP/gRPC endpoints.
- Add metrics: throughput, latency, GC pressure, memory.
- Add logs for errors and slow operations.
- Run under load for at least 24 hours.
- Document the operational characteristics.

This task verifies that you can take a concurrent tree from theory to production. It is the capstone.

---

## Closing

Twenty tasks, ranging from a 50-line junior wrapper to a multi-week professional engine. Complete five of them seriously and you will have hands-on mastery of concurrent trees in Go.

For each task:

1. Sketch the design first.
2. Implement.
3. Test under `-race`.
4. Benchmark.
5. Iterate.

The skill is not memorization but the loop: design, implement, verify, measure, improve.

Good luck. Build something real.

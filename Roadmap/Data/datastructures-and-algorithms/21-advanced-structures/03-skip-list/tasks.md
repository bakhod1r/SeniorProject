# Skip List — Practice Tasks

> **Audience:** Anyone who has read at least `junior.md` and `middle.md`. Tasks build sequentially from basic implementation to advanced production features. Solve each in **Go**, **Java**, and **Python**. Reference solutions are given in the most idiomatic language for the task; translations are mechanical.

---

## Beginner Tasks

### Task 1 — Implement a basic skip list (search / insert / delete)

**Goal.** Build the foundation: a `SkipList` of `int` with `insert(v)`, `search(v) -> bool`, `delete(v) -> bool`. Use a head sentinel of `maxLevel`, geometric random levels (`p = 0.5`), and the `update`-array splice pattern. Set semantics (ignore duplicate inserts).

**Constraints.** Search/insert/delete must be expected O(log n). 1 head sentinel. Cover edge cases: empty list, single element, value smaller/larger than all.

**Test it.** Apply 5000 random ops to your skip list *and* to a `map[int]bool` (Go) / `TreeSet` (Java) / `set` (Python) reference; after each op assert identical membership and that ordered iteration of the skip list matches the sorted reference.

**Go reference solution:**
```go
package skiplist

import "math/rand"

const (
    maxLevel = 16
    p        = 0.5
)

type node struct {
    value   int
    forward []*node
}

type SkipList struct {
    head  *node
    level int
}

func New() *SkipList {
    return &SkipList{head: &node{forward: make([]*node, maxLevel)}, level: 1}
}

func randomLevel() int {
    lvl := 1
    for rand.Float64() < p && lvl < maxLevel {
        lvl++
    }
    return lvl
}

func (s *SkipList) Search(v int) bool {
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.forward[i] != nil && x.forward[i].value < v {
            x = x.forward[i]
        }
    }
    x = x.forward[0]
    return x != nil && x.value == v
}

func (s *SkipList) Insert(v int) {
    update := make([]*node, maxLevel)
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.forward[i] != nil && x.forward[i].value < v {
            x = x.forward[i]
        }
        update[i] = x
    }
    if nx := x.forward[0]; nx != nil && nx.value == v {
        return
    }
    lvl := randomLevel()
    if lvl > s.level {
        for i := s.level; i < lvl; i++ {
            update[i] = s.head
        }
        s.level = lvl
    }
    n := &node{value: v, forward: make([]*node, lvl)}
    for i := 0; i < lvl; i++ {
        n.forward[i] = update[i].forward[i]
        update[i].forward[i] = n
    }
}

func (s *SkipList) Delete(v int) bool {
    update := make([]*node, maxLevel)
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.forward[i] != nil && x.forward[i].value < v {
            x = x.forward[i]
        }
        update[i] = x
    }
    t := x.forward[0]
    if t == nil || t.value != v {
        return false
    }
    for i := 0; i < s.level; i++ {
        if update[i].forward[i] != t {
            break
        }
        update[i].forward[i] = t.forward[i]
    }
    for s.level > 1 && s.head.forward[s.level-1] == nil {
        s.level--
    }
    return true
}
```

**Expected:** a structure that maintains sorted order and answers membership correctly under any operation sequence.

---

### Task 2 — Ordered iteration and `toSlice`

**Goal.** Add `ToSlice() []int` (Go) / `toList()` (Java) / `__iter__` (Python) that returns all elements in ascending order by walking `forward[0]` from `head`. Add `Min()` (= `head.forward[0]`) and `Max()` (walk to the last node).

**Constraints.** `ToSlice` is O(n); `Min` is O(1); `Max` is O(n) unless you track the tail.

**Evaluation.** Iteration is sorted and includes every element exactly once.

---

### Task 3 — `randomLevel` distribution check

**Goal.** Write a test that calls `randomLevel()` 1,000,000 times and tabulates how often each height occurs. Verify the empirical frequencies match the geometric distribution `P(height=k) = p^{k-1}(1-p)` within a small tolerance: ~50% height 1, ~25% height 2, ~12.5% height 3 for `p=0.5`.

**Constraints.** No assertion of exact equality — use a tolerance (e.g., within 2% of expected) to account for sampling noise.

**Evaluation.** The printed histogram visibly halves at each step (for `p=0.5`); the test passes for both `p=0.5` and `p=0.25`.

---

### Task 4 — Configurable `p` and `maxLevel`

**Goal.** Refactor the skip list so `p` and `maxLevel` are constructor parameters, not constants. Build the same dataset with `p=0.5` and `p=0.25` and report, for each: average node height, number of levels, and total pointer count.

**Constraints.** Validate `0 < p < 1` and `maxLevel >= 1`.

**Evaluation.** Observed average node height ≈ `1/(1-p)` (2.0 vs 1.33) and total pointers ≈ `n/(1-p)`. Confirms the space analysis from `middle.md`.

---

### Task 5 — Brute-force property test

**Goal.** Write a randomized property test: maintain a skip list and a sorted reference array in lockstep. For 10,000 iterations, pick a random op (insert / delete / search / iterate) on a random value, apply to both, and assert agreement (membership, sorted contents, search result). Use a fixed RNG seed so failures reproduce.

**Constraints.** Must catch the classic bugs: `<=` vs `<` in search, missing level-raise on tall insert, missing level-shrink on delete, duplicate mishandling.

**Evaluation.** Test passes thousands of iterations; deliberately introducing one of the bugs above makes it fail quickly.

---

## Intermediate Tasks

### Task 6 — Indexable skip list (`rank` and `select`)

**Goal.** Add a **span** to each forward pointer (number of base nodes skipped). Implement `Select(k) -> value` (k-th smallest, 0-indexed) and `Rank(v) -> int` (number of elements < v), both O(log n). Maintain spans correctly on insert and delete.

**Constraints.** On splice, the new node splits an existing span into two pieces summing to the old span + 1; on unlink, two spans merge. Levels above the affected node's height have their spans incremented (insert) / decremented (delete) by 1.

**Test.** `Select(k)` must equal the k-th element of the sorted reference for all k; `Rank(v)` must equal the count of smaller elements. (See `middle.md` §8 for a full reference implementation.)

---

### Task 7 — Range query `[lo, hi]`

**Goal.** Implement `Range(lo, hi) -> []int` returning all elements with `lo <= v <= hi` in ascending order, in O(log n + k) where k is the result count.

**Constraints.** Descend to the first node `>= lo` (O(log n)), then walk `forward[0]` collecting until `v > hi`. Handle `lo > hi` (empty) and ranges outside the data.

**Evaluation.** Matches the sorted reference's slice; cost scales with result size, not list size.

---

### Task 8 — Skip-list-backed ordered map

**Goal.** Turn the set into a `Map[int]V`: store a `value` payload per node. `Put(k, v)` inserts or updates; `Get(k) -> (V, bool)`; `Delete(k)`. Ordered iteration yields `(key, value)` pairs by key.

**Constraints.** On `Put` of an existing key, update the payload in place (do not insert a duplicate node). Map semantics, not multiset.

**Evaluation.** Behaves like a sorted map; `Put` of an existing key changes its value without growing the list.

---

### Task 9 — Doubly-linked level 0 (predecessor + reverse iteration)

**Goal.** Add a `backward` pointer to each base-level node, making level 0 doubly linked (the Redis design). Implement `Predecessor(v)` in O(1) given a node, and `ReverseIterate()` yielding elements in descending order.

**Constraints.** Maintain `backward` correctly on insert (point new node back at its predecessor, point successor back at new node) and delete (re-link the gap). The head's backward is nil; the tail tracks the last node.

**Evaluation.** Reverse iteration produces the exact reverse of forward iteration; predecessor of each node is correct.

---

### Task 10 — Inversion count via an order-statistic skip list

**Goal.** Use an indexable skip list (Task 6) to count inversions in an array: for each element from right to left, query how many already-inserted elements are smaller, then insert. Sum the counts.

**Constraints.** O(n log n) total. Handle duplicates consistently (decide whether equal elements count as inversions).

**Evaluation.** Matches a brute-force O(n²) inversion count on random arrays of length 1000.

---

## Advanced Tasks

### Task 11 — Concurrent skip list with fine-grained behavior

**Goal.** Implement a thread-safe skip list. Start with a single `RWMutex` (search read-locks, insert/delete write-lock). Then stress-test it: spawn 8 goroutines/threads doing mixed insert/delete/search and verify no data races (Go `-race`, Java with concurrent assertions) and that final contents match a sequential replay.

**Constraints.** No lost updates, no torn reads, no panics under contention. Compare throughput of the RWMutex version against `sync.Map`-style or `ConcurrentSkipListMap` baselines.

**Evaluation.** `go test -race` is clean; final state equals a single-threaded application of the same operation multiset.

---

### Task 12 — Lock-free deletion with marking (Harris)

**Goal.** Implement the two-phase lock-free delete: (1) CAS-mark the target's forward pointer (logical delete), (2) CAS the predecessor past it (physical unlink), with **helping** so threads that encounter a marked node complete its removal. Inserts CAS against unmarked predecessors and retry on failure.

**Constraints.** A concurrent insert-after-a-deleted-node must fail and retry against the live predecessor (the marking invariant). Address memory reclamation conceptually (epoch/hazard pointers or rely on GC).

**Evaluation.** Under heavy concurrent insert+delete on overlapping key ranges, no node is ever linked off a removed node; final contents are consistent. (This is research-grade — getting it exactly right is the point.)

---

### Task 13 — LSM-style insert-only memtable with lock-free reads

**Goal.** Build an insert-only skip list (LevelDB style): single writer, many concurrent readers, **no read locks**. The writer publishes a new node by writing its forward pointers and storing `forward[0]` last with a release barrier; readers use acquire loads.

**Constraints.** Readers must never observe a torn node (a link without the node's fields). Add `Flush() []int` that returns all elements sorted (one `forward[0]` walk) — the memtable→SSTable flush.

**Evaluation.** Concurrent readers always see a consistent prefix of inserts; `Flush` yields sorted output. On Go, verify with `-race`; reason about acquire/release ordering explicitly.

---

### Task 14 — Tune `p` empirically against a workload

**Goal.** For a fixed dataset (1M random inserts) and a query workload (1M random searches), measure average search comparisons and total memory for `p ∈ {0.5, 0.368, 0.25}`. Plot or tabulate comparisons-vs-memory and identify the knee.

**Constraints.** Use the same RNG seed across runs for fair comparison; count comparisons by instrumenting the search loop.

**Evaluation.** Confirm `p≈1/e` minimizes comparisons, `p=1/4` minimizes memory among the three, and `p=1/2` is in between — matching `middle.md` §4. Write a one-paragraph recommendation for a memory-constrained vs latency-constrained system.

---

### Task 15 — Implement Redis-style ZSET (dual index)

**Goal.** Combine an indexable skip list (ordered by `(score, member)`) with a hash map (`member -> score`) to build a sorted set supporting: `zadd(member, score)`, `zscore(member) -> score` in O(1), `zrank(member) -> int` and `zrange(start, stop) -> []member` in O(log n). Keep both indices in sync on every write.

**Constraints.** Break score ties by member string (total order). `zadd` of an existing member with a new score must remove the old skip-list node and insert at the new position while updating the hash map. Support negative and duplicate scores.

**Evaluation.** Behaves like Redis `ZADD`/`ZSCORE`/`ZRANK`/`ZRANGE` on a battery of test cases; `zscore` is O(1) while rank/range stay O(log n). This is the capstone — a real production data structure.

---

## Benchmark Task

> Compare skip-list search performance across all 3 languages and against a balanced-tree baseline (`TreeSet` / `std::map`-equivalent / `sortedcontainers`).

#### Go

```go
package main

import (
    "fmt"
    "math/rand"
    "time"
)

func main() {
    sizes := []int{1000, 10000, 100000, 1000000}
    for _, n := range sizes {
        s := New()
        for i := 0; i < n; i++ {
            s.Insert(rand.Intn(n * 10))
        }
        start := time.Now()
        for i := 0; i < 100000; i++ {
            s.Search(rand.Intn(n * 10))
        }
        elapsed := time.Since(start)
        fmt.Printf("n=%8d: %.1f ns/search\n", n, float64(elapsed.Nanoseconds())/100000.0)
    }
}
```

#### Java

```java
import java.util.Random;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000, 1000000};
        Random r = new Random();
        for (int n : sizes) {
            SkipList s = new SkipList();
            for (int i = 0; i < n; i++) s.insert(r.nextInt(n * 10));
            long start = System.nanoTime();
            for (int i = 0; i < 100000; i++) s.search(r.nextInt(n * 10));
            long elapsed = System.nanoTime() - start;
            System.out.printf("n=%8d: %.1f ns/search%n", n, elapsed / 100000.0);
        }
    }
}
```

#### Python

```python
import random
import time

for n in (1_000, 10_000, 100_000):
    s = SkipList()
    for _ in range(n):
        s.insert(random.randint(0, n * 10))
    start = time.perf_counter()
    for _ in range(100_000):
        s.search(random.randint(0, n * 10))
    elapsed = time.perf_counter() - start
    print(f"n={n:>8}: {elapsed / 100_000 * 1e9:.1f} ns/search")
```

**Expected observation:** search time grows logarithmically (each 10× in `n` adds a roughly constant number of comparisons). The skip list's constant factor is larger than a sorted-array binary search (pointer-chasing vs contiguous memory) but competitive with the balanced-tree baseline. Report the ratio against `TreeSet`/`sortedcontainers` and explain the difference in terms of cache behavior (`senior.md` §6).

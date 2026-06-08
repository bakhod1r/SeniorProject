# van Emde Boas Tree (vEB) — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python** (in that order). Tasks build from a bare structure to space-reduced variants and benchmarks. Each task states a goal, constraints, and how it is evaluated. Reference `junior.md`–`professional.md` for the algorithms.

---

## Beginner Tasks

### Task 1 — Implement the high/low/index split

**Goal.** Given a power-of-two universe `u`, implement `high(x)`, `low(x)`, and `index(h, l)` using the upper-sqrt/lower-sqrt split (`lower = 2^floor(k/2)`, `upper = 2^ceil(k/2)` where `u = 2^k`). Verify `index(high(x), low(x)) == x` for all `x` in `{0..u-1}`.

#### Go

```go
package main

func splitParams(u int) (lower, upper int) {
    // return lower = 2^floor(k/2), upper = 2^ceil(k/2)
    return 0, 0
}

func main() {
    // for u = 16, 256, 4096: assert index(high(x), low(x)) == x for all x
}
```

#### Java

```java
public class Task1 {
    static int[] splitParams(int u) { return new int[]{0, 0}; }
    public static void main(String[] args) {
        // verify the round-trip for several universes
    }
}
```

#### Python

```python
def split_params(u):
    # return (lower, upper)
    return 0, 0

if __name__ == "__main__":
    # verify index(high(x), low(x)) == x for u in (16, 256, 4096)
    pass
```

- **Constraints:** `u` a power of two up to `2^20`. Use shifts/masks, not division, where possible.
- **Expected output:** "OK" if the round-trip holds for every `x`, else the first failing `x`.
- **Evaluation:** correctness of the split for both even and odd `k`.

---

### Task 2 — Build a recursive vEB tree (member, insert, min, max)

**Goal.** Implement `New(u)`, `Member(x)`, `Insert(x)`, `Min()`, `Max()` for a recursive vEB tree. No `successor` yet. Handle the `u = 2` base case and the empty-node and min-swap cases.

- **Constraints:** `u` a power of two. `min`/`max` must be `O(1)` (stored aside). Insert must assume `x` is not already present (a set).
- **Expected output:** after inserting {2, 3, 4, 9, 13} into `u = 16`: `min = 2`, `max = 13`, `member(9) = true`, `member(10) = false`.
- **Evaluation:** correct min-aside behavior; verify `member` finds every inserted key and rejects absent ones.

---

### Task 3 — Add `successor` and `predecessor`

**Goal.** Extend Task 2 with `Successor(x)` and `Predecessor(x)`. Remember the predecessor min-aside special case (when no smaller cluster exists, still check `x > min`).

- **Constraints:** both `O(log log u)`. Return `NIL` (`-1`) when no successor/predecessor exists.
- **Expected output:** on {2,3,4,9,13}, `u=16`: `successor(4)=9`, `successor(13)=NIL`, `predecessor(9)=4`, `predecessor(2)=NIL`.
- **Evaluation:** correctness against a sorted reference list; the predecessor-of-small-key case must return `min`, not `NIL`.

---

### Task 4 — vEB-sort

**Goal.** Use your vEB tree to sort a list of distinct integers from `{0..u-1}`: insert all, then emit `min, successor(min), successor(...), ...` until `NIL`.

- **Constraints:** input keys distinct and within range. Total time `O(n log log u)` (plus `O(u)` build).
- **Expected output:** the input in ascending order, e.g. `[13,2,9,4,3] → [2,3,4,9,13]`.
- **Evaluation:** output equals the sorted input; handle the empty input (return `[]`).

---

### Task 5 — Validate against a reference set (randomized test)

**Goal.** Write a randomized test harness: for `u = 256`, perform 10,000 random `insert`/`member`/`successor` operations, mirroring each into a language-native sorted set (`TreeSet`/`sorted list`/`bisect`), and assert every result matches.

- **Constraints:** use a fixed RNG seed for reproducibility. Compare successor results exactly, including `NIL`.
- **Expected output:** "PASS" or the first mismatching operation with both results.
- **Evaluation:** the harness must actually catch a deliberately broken `successor` (e.g. one that omits the min-aside check) — test your test.

---

## Intermediate Tasks

### Task 6 — Implement full `delete`

**Goal.** Add `Delete(x)` with correct min-promotion (when deleting the aside-min) and summary cleanup (when a cluster empties), plus max-patching. Keep it `O(log log u)`.

- **Constraints:** assume `x` is present. After delete, all invariants (I1)–(I5 from `professional.md`) must hold.
- **Expected output:** on {2,3,4,9,13}, deleting 2 → `min=3`; deleting 13 → `max=9`; deleting all → empty (`min=max=NIL`).
- **Evaluation:** randomized insert/delete/successor sequence against a reference `TreeSet` — must stay consistent for 100,000 ops.

---

### Task 7 — Integer priority queue wrapper

**Goal.** Wrap the vEB tree as a min-priority-queue: `push(x)`, `peekMin()` (O(1)), `popMin()`. Use it to simulate an event scheduler that pops events in deadline order.

- **Constraints:** `peekMin` must be `O(1)`; `popMin` `O(log log u)`. Handle popping from an empty queue (return `NIL`).
- **Expected output:** pushing deadlines [40, 10, 30, 20] then popping all yields [10, 20, 30, 40].
- **Evaluation:** order correctness; `peekMin` does not mutate; empty-pop handled.

---

### Task 8 — Hashed-cluster vEB (O(n) space)

**Goal.** Reimplement the tree with clusters stored in a hash map (and a lazily allocated summary) so unused clusters cost nothing. Support member/insert/successor.

- **Constraints:** space `O(n)`; never read `cluster[c].min` for an absent cluster. Time `O(log log u)` expected.
- **Expected output:** identical query results to the dense version for the same op sequence, but with a far smaller live-node count on sparse data.
- **Evaluation:** assert query parity with the dense tree; report `node_count` for `u = 2^16` holding 50 keys (should be tiny, not `O(u)`).

---

### Task 9 — Nearest-neighbor stream

**Goal.** Process a stream of integers; after each one, output the nearest already-seen value (by absolute difference), using `predecessor` and `successor`. Insert each value after querying.

- **Constraints:** `O(log log u)` per element. On the first element output `NIL` (no neighbor yet).
- **Expected output:** stream [5, 9, 2, 7], `u=16` → [NIL, 5, 5, 5] (7's nearest among {5,9,2} is 5, tie broken toward smaller).
- **Evaluation:** correct tie-breaking (toward the smaller value); empty-tree first query returns `NIL`.

---

### Task 10 — Generalize to odd-exponent universes

**Goal.** Ensure your tree is correct for `u = 2^k` with **odd** `k` (e.g. `u = 32`, `k = 5`), where `sqrt(u)` is not integral. Use upper/lower sqrt consistently.

- **Constraints:** clusters number `upper = 2^ceil(k/2)`, each of size `lower = 2^floor(k/2)`. Verify on `u = 8, 32, 128`.
- **Expected output:** full insert/successor parity with a reference set on universes `8, 32, 128, 512`.
- **Evaluation:** the round-trip `index(high(x), low(x)) == x` holds and queries match the reference across odd and even `k`.

---

## Advanced Tasks

### Task 11 — Benchmark vEB vs sorted array vs TreeSet

**Goal.** For `u = 2^16` and `n = 30,000` random keys, benchmark `successor` throughput of: your vEB tree, a sorted array with binary search, and a language-native balanced set. Report ops/sec and discuss cache effects.

- **Constraints:** identical key set and query set across all three. Warm up before timing.
- **Expected output:** a small table of ms / 1e6 successor queries per structure, plus a one-paragraph analysis of why the array is often competitive despite `O(log n)`.
- **Evaluation:** fair methodology; correct conclusion that `log log u`'s tiny constant + cache misses let flat structures compete.

---

### Task 12 — x-fast trie

**Goal.** Implement an x-fast trie over `n` representatives: a depth-`log u` bit-trie with each level in a hash table; `successor` via binary search over the levels in `O(log log u)`. Report its `O(n log u)` space.

- **Constraints:** levels stored as hash sets of present prefixes; thread "leaf" pointers for successor. Query `O(log log u)`, update `O(log u)`.
- **Expected output:** `successor`/`predecessor` parity with a reference set on `u = 2^12`.
- **Evaluation:** correctness of the level-binary-search; measured space scales like `n·log u`.

---

### Task 13 — y-fast trie (O(n) space)

**Goal.** Build a y-fast trie: group keys into bags of size `~log u` (balanced BST per bag), one representative per bag fed into your Task-12 x-fast trie. Support member/insert/successor in `O(log log u)` (amortized insert) and `O(n)` space.

- **Constraints:** group split/merge to keep bag sizes in `[½ log u, 2 log u]`. Query first locates the bag via x-fast, then searches the BST.
- **Expected output:** full parity with a reference `TreeSet` on `u = 2^16`, `n = 20,000`, with measured space `O(n)` (not `O(n log u)`).
- **Evaluation:** correctness, amortized update cost, and confirmed linear space.

---

### Task 14 — Concurrent successor index

**Goal.** Wrap your vEB tree in a reader-writer lock (or shard by high bits with one writer per shard) and drive it with many concurrent reader threads doing `successor` and a few writers doing `insert`/`delete`. Verify no races and correct results.

- **Constraints:** readers may run concurrently; writers are exclusive (per shard). Use the race detector / thread-sanitizer.
- **Expected output:** under concurrent load, final set matches a single-threaded replay of the same op log.
- **Evaluation:** no data races reported; result equivalence to the serial replay.

---

### Task 15 — Dijkstra with a vEB priority queue

**Goal.** Implement Dijkstra for a graph with integer edge weights bounded by `C`, using your vEB-based integer PQ (universe sized to the max possible distance). Compare against a binary-heap Dijkstra on the same graphs.

- **Constraints:** keys are tentative distances (bounded integers); handle decrease-key by delete+insert. Correct shortest paths required.
- **Expected output:** identical shortest-path distances to the binary-heap version, plus a timing comparison and a note on when the vEB PQ helps (large `n`, small `C`) vs hurts (cache).
- **Evaluation:** path correctness on random and adversarial graphs; sound analysis of the practical trade-off.

---

## Benchmark Task

> Compare `successor` performance across all 3 languages for a fixed vEB tree.

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func main() {
	u := 1 << 16
	t := New(u) // your vEB constructor
	for i := 0; i < 30000; i++ {
		t.Insert((i * 2654435761) % u)
	}
	start := time.Now()
	sum := 0
	for q := 0; q < 1_000_000; q++ {
		sum += t.Successor(q % u)
	}
	fmt.Printf("1e6 successors: %v (checksum %d)\n", time.Since(start), sum)
}
```

#### Java

```java
public class Benchmark {
    public static void main(String[] args) {
        int u = 1 << 16;
        VEB t = new VEB(u); // your vEB class
        for (int i = 0; i < 30000; i++) t.insert((int)(((long)i * 2654435761L) % u));
        long start = System.nanoTime();
        long sum = 0;
        for (int q = 0; q < 1_000_000; q++) sum += t.successor(q % u);
        System.out.printf("1e6 successors: %.1f ms (checksum %d)%n",
            (System.nanoTime() - start) / 1e6, sum);
    }
}
```

#### Python

```python
import time

def main():
    u = 1 << 16
    t = VEB(u)  # your vEB class
    for i in range(30000):
        t.insert((i * 2654435761) % u)
    start = time.perf_counter()
    s = 0
    for q in range(1_000_000):
        s += t.successor(q % u)
    print(f"1e6 successors: {(time.perf_counter()-start)*1000:.1f} ms (checksum {s})")

if __name__ == "__main__":
    main()
```

> **Deliverable.** A short table of wall-clock times for the three languages plus the array/TreeSet comparison from Task 11, and a paragraph explaining why the asymptotically-superior vEB tree frequently does *not* win in practice (cache misses from pointer chasing vs the tiny `log log u` constant).

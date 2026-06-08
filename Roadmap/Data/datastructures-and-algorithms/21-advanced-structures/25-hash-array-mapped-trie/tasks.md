# Hash Array Mapped Trie (HAMT) — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Use a 32-bit hash and **5-bit chunks** unless a task says otherwise. Keep nodes immutable except where transients are explicitly requested.

## Beginner Tasks

**Task 1: Bitmap + popcount index helper.**
Implement `denseIndex(bitmap, slot) = popcount(bitmap & ((1 << slot) - 1))` and `present(bitmap, slot) = bitmap & (1 << slot) != 0`. Verify on a node with children in slots `{1, 4, 9}`: `denseIndex` must return `0, 1, 2` for slots `1, 4, 9` and the right "not present" for others.

#### Go

```go
package main

import "math/bits"

func denseIndex(bitmap, slot uint32) int { /* implement */ return 0 }
func present(bitmap, slot uint32) bool   { /* implement */ return false }

func main() { /* test with slots {1,4,9} */ _ = bits.OnesCount32 }
```

#### Java

```java
public class Task1 {
    static int denseIndex(int bitmap, int slot) { return 0; /* implement */ }
    static boolean present(int bitmap, int slot) { return false; /* implement */ }
    public static void main(String[] args) { /* test with slots {1,4,9} */ }
}
```

#### Python

```python
def dense_index(bitmap, slot):  # implement
    return 0
def present(bitmap, slot):      # implement
    return False
if __name__ == "__main__":
    pass  # test with slots {1,4,9}
```

- **Constraints:** use the built-in popcount; no loops over 32 bits.
- **Expected Output:** correct indices for present slots; `false` for absent slots.
- **Evaluation:** correctness of the mask `(1<<slot)-1`, use of hardware popcount.

**Task 2: Chunk extractor.**
Implement `chunk(hash, depth) = (hash >> (5*depth)) & 0x1F`. Given `hash = 0b11010_00110_01001`, print the chunks for depths 0, 1, 2. Expected: `9, 6, 26`.

**Task 3: Single-level node get/insert.**
Build a one-level HAMT node (root only). Implement `insert(slot, leaf)` that maintains the bitmap and dense array in lockstep, and `get(slot)`. Test that inserting into slots out of order (e.g. 9, then 1, then 4) keeps the dense array correctly ordered.

**Task 4: Immutable leaf get/insert (full trie).**
Implement immutable `insert(root, hash, key, value)` and `get(root, hash, key)` with leaf splitting (no collision handling required — assume distinct hashes). Verify that after `r2 = insert(r1, ...)`, `get(r1, ...)` for the new key returns "not found".

**Task 5: Persistence check.**
Insert keys `a, b, c` into `r1`. Derive `r2` by inserting `d`. Assert that `r1` still contains exactly `{a, b, c}` and `r2` contains `{a, b, c, d}` — the old version is untouched. Print both maps via an iterator.

## Intermediate Tasks

**Task 6: Collision node.**
Extend Task 4 so that two distinct keys with the **same full hash** are stored in a collision bucket. Provide a key/hash pair that collides (force it by using a hash function you control) and verify both keys are retrievable. Provide starter code in all 3 languages.

**Task 7: Delete with single-child collapse.**
Implement immutable `delete(root, hash, key)`. After removing a key, if a copied internal node has exactly one child and that child is a leaf, **collapse** it (pull the leaf up). Verify the tree depth does not grow under an insert/delete churn loop.

**Task 8: Iterator and size.**
Implement an iterator that yields all `(key, value)` pairs via DFS over the dense arrays, and a `size(root)` that counts entries. Confirm `size` is O(n) and stable across versions.

**Task 9: Structural merge with pointer short-circuit.**
Implement `merge(a, b)` that returns a new HAMT containing all entries of both (b wins on key conflicts). Optimize: if two sub-nodes are the **same pointer**, reuse one without recursing. Demonstrate the short-circuit fires when merging a map with a snapshot of itself plus one change.

**Task 10: Configurable chunk width.**
Parameterize the chunk width `t` (try `t ∈ {4, 5, 6}` → branching 16/32/64). Build the same 10,000 keys and report the resulting tree depth and node count for each `t`. Explain the depth vs node-width trade-off you observe.

## Advanced Tasks

**Task 11: Transient batch build.**
Implement a transient with an edit token: `assoc!` mutates owned nodes in place, copies-and-owns unowned ones; `persistent!` freezes (drops tokens). Build 100,000 entries via the transient and via 100,000 immutable inserts; compare allocation counts / time. Provide starter code in all 3 languages.

**Task 12: CHAMP node layout.**
Reimplement the internal node with **two** bitmaps (`dataMap`, `nodeMap`), inline data entries packed at the front of one array and sub-nodes at the back. Implement `get`/`insert` against this layout and verify correctness against your Task 4 HAMT on random inputs.

**Task 13: Canonical equality.**
Using your CHAMP node, implement `equals(a, b)` that (1) short-circuits on pointer equality, (2) rejects on differing `dataMap`/`nodeMap`, (3) recurses otherwise. Build two CHAMP maps with the same entries inserted in **different orders** and assert they are structurally equal (proving canonicality).

**Task 14: Persistent vector (integer-keyed trie).**
Build a Clojure-style persistent vector: a 32-way trie indexed by an integer position sliced into 5-bit chunks (no hashing). Implement immutable `get(i)`, `update(i, v)` (path copy), and `append(v)`. Verify `update` leaves the old version unchanged.

**Task 15: Seeded hash defense.**
Implement a seeded hash `h_seed(key) = mix(seed, key)` and show that switching the seed reshapes the trie for the same keys. Then construct a set of keys that all collide under an unseeded hash, insert them, and measure the collision-node size and per-op cost; re-run with a random seed and show the degradation disappears.

## Benchmark Task

> Compare HAMT operations across all 3 languages. Insert `n` keys, then do `n` random lookups; report ms per phase.

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func main() {
	sizes := []int{1000, 10000, 100000}
	for _, n := range sizes {
		var root *node // your HAMT root type
		start := time.Now()
		for i := 0; i < n; i++ {
			h := uint32(i*2654435761) // Knuth multiplicative hash
			root = insert(root, h, fmt.Sprintf("k%d", i), i, 0)
		}
		buildMs := float64(time.Since(start).Milliseconds())

		start = time.Now()
		for i := 0; i < n; i++ {
			h := uint32(i * 2654435761)
			_, _ = get(root, h, fmt.Sprintf("k%d", i))
		}
		getMs := float64(time.Since(start).Milliseconds())
		fmt.Printf("n=%7d  build=%.1fms  get=%.1fms\n", n, buildMs, getMs)
	}
}
```

#### Java

```java
public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000};
        for (int n : sizes) {
            Node root = null; // your HAMT
            long s = System.nanoTime();
            for (int i = 0; i < n; i++) {
                int h = i * 2654435761;
                root = insert(root, h, "k" + i, i, 0);
            }
            double build = (System.nanoTime() - s) / 1e6;
            s = System.nanoTime();
            for (int i = 0; i < n; i++) {
                int h = i * 2654435761;
                get(root, h, "k" + i);
            }
            double get = (System.nanoTime() - s) / 1e6;
            System.out.printf("n=%7d  build=%.1fms  get=%.1fms%n", n, build, get);
        }
    }
}
```

#### Python

```python
import time

sizes = [1000, 10000, 100000]
for n in sizes:
    root = None  # your HAMT
    t0 = time.perf_counter()
    for i in range(n):
        h = (i * 2654435761) & 0xFFFFFFFF
        root = insert(root, h, f"k{i}", i, 0)
    build = (time.perf_counter() - t0) * 1000
    t0 = time.perf_counter()
    for i in range(n):
        h = (i * 2654435761) & 0xFFFFFFFF
        get(root, h, f"k{i}")
    g = (time.perf_counter() - t0) * 1000
    print(f"n={n:>7}  build={build:6.1f}ms  get={g:6.1f}ms")
```

- **Report:** build vs get time per size; verify roughly linear-in-`n` total work (per-op ~constant).
- **Bonus:** re-run the build with transients (Task 11) and compare allocation/time.

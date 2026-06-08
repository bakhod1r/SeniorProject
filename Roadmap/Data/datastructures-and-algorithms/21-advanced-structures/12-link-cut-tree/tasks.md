# Link-Cut Tree — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**. Build on the reference code from `junior.md`/`middle.md`. Always test against a brute-force parent-pointer forest on random `link`/`cut`/`query` sequences.

## Beginner Tasks

**Task 1:** Implement a minimal LCT supporting `link(u, v)`, `cut(u, v)`, and `connected(u, v)` from scratch (no path aggregate yet). Use the splay + `access` + `makeRoot` + `findRoot` core.

#### Go
```go
package main

type Node struct {
	ch     [2]*Node
	parent *Node
	rev    bool
}

// TODO: isRoot, applyRev, push, rotate, splay, access, makeRoot, findRoot
func link(u, v *Node)        { /* implement */ }
func cut(u, v *Node)         { /* implement */ }
func connected(u, v *Node) bool { return false }

func main() {
	// build a few nodes, link/cut, print connected()
}
```

#### Java
```java
public class Task1 {
    static final class Node { Node left, right, parent; boolean rev; }
    // TODO: isRoot, applyRev, push, rotate, splay, access, makeRoot, findRoot
    static void link(Node u, Node v) { /* implement */ }
    static void cut(Node u, Node v) { /* implement */ }
    static boolean connected(Node u, Node v) { return false; }
    public static void main(String[] args) { }
}
```

#### Python
```python
class Node:
    __slots__ = ("ch", "parent", "rev")
    def __init__(self):
        self.ch = [None, None]; self.parent = None; self.rev = False

# TODO: is_root, apply_rev, push, rotate, splay, access, make_root, find_root
def link(u, v): ...
def cut(u, v): ...
def connected(u, v): return False

if __name__ == "__main__":
    pass
```

- **Constraints:** all ops amortized O(log n); guard `link` against cycles and `cut` against non-edges.
- **Expected Output:** `connected` returns correct booleans through a sequence of link/cut.
- **Evaluation:** correctness, edge cases (self, isolated), complexity.

**Task 2:** Add a **path-sum** query `pathSum(u, v)` to your Task 1 LCT. Each node carries a value; return the sum of node values on the path `u..v`. Verify against a brute-force path walk.

**Task 3:** Add **path-max** and **path-min** queries (separate aggregates). Test that re-rooting (`makeRoot`) does not corrupt them (they are commutative — they should survive).

**Task 4:** Implement `depth(v)` (distance from `v` to its tree root) using a path-length aggregate: give every node value `1` and return `pathSum(root, v) - 1`. Compare to a parent-walk.

**Task 5:** Implement `findRoot(v)` and write a randomized test harness: build a random forest via `link`s, then assert `findRoot` matches a reference union of parent pointers for 10,000 random nodes.

## Intermediate Tasks

**Task 6:** Refactor your LCT to a **generic monoid**: parameterize over `combine(a, b)` and `identity`. Instantiate it for sum, max, min, gcd, and xor without duplicating the splay/access core.

**Task 7:** Implement **LCA under a fixed root**: support `makeRoot(r)` once, then `lca(u, v)` returning the lowest common ancestor in O(log n) using the "last path-parent of the second `access`" trick.

**Task 8:** Solve **online MST**: given a stream of weighted edges, maintain the minimum spanning forest using the edge-as-node encoding; after each edge print the total MSF weight. (Spec matches `interview.md`'s challenge — implement independently.)

**Task 9:** Implement **path assignment / path add with lazy tags**: add a lazy "add `delta` to all node values on the exposed path" tag (segment-tree-style), composed correctly with the reverse flag. Support `pathAdd(u, v, delta)` and `pathSum(u, v)`.

**Task 10:** Build a **dynamic connectivity** service: process a mixed stream of `addEdge`, `removeEdge` (tree edges only via cut + replacement search among stored non-tree edges), and `connected` queries. Keep non-tree edges in a side set per component.

## Advanced Tasks

**Task 11:** Implement **subtree-sum** via the virtual-subtree augmentation: maintain a `virt` field, update it on every virtual↔real transition in `access` and `link`, and answer `subtreeSum(v, parent)` in amortized O(log n). Validate against a brute-force subtree DFS.

**Task 12:** Implement a **non-commutative path aggregate** (ordered 2×2 matrix product) with a **two-sided node** (forward and reverse products), and verify it survives `makeRoot` by swapping the two on `applyRev`.

**Task 13:** Implement **dynamic-trees Dinic**: use an LCT with path-min (bottleneck) and lazy path-add (augment) to compute max flow on a layered graph; benchmark blocking-flow cost vs naive O(VE).

**Task 14:** Build an **invariant checker** that, given an LCT, reconstructs the represented forest by walking path-parent pointers and depth orders, and diffs it against a maintained reference forest after every operation. Use it to fuzz-test Tasks 1–11 with adversarial chain inputs.

**Task 15:** Implement an **arena-backed LCT** (nodes in a flat `int`-indexed array, index 0 = null sentinel, all fields in parallel slices). Benchmark it against the pointer version on 10⁶ nodes and report the speedup from improved cache locality.

## Benchmark Task

> Compare per-operation latency across all 3 languages on a random `link`/`cut`/`pathMax` workload over a chain of `n` nodes. Expect roughly flat (log n) per-op time.

#### Go
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	for _, n := range []int{1000, 10000, 100000} {
		nodes := buildChain(n) // TODO: build n LCT nodes linked in a chain
		ops := 200000
		start := time.Now()
		for k := 0; k < ops; k++ {
			a, b := rand.Intn(n), rand.Intn(n)
			_ = pathMax(nodes[a], nodes[b]) // TODO
		}
		fmt.Printf("n=%7d: %.2f ns/op\n", n, float64(time.Since(start).Nanoseconds())/float64(ops))
	}
}
```

#### Java
```java
import java.util.Random;

public class Benchmark {
    public static void main(String[] args) {
        Random rnd = new Random(1);
        for (int n : new int[]{1000, 10000, 100000}) {
            Node[] nodes = buildChain(n); // TODO
            int ops = 200000;
            long start = System.nanoTime();
            for (int k = 0; k < ops; k++)
                pathMax(nodes[rnd.nextInt(n)], nodes[rnd.nextInt(n)]); // TODO
            System.out.printf("n=%7d: %.2f ns/op%n", n, (System.nanoTime() - start) / (double) ops);
        }
    }
}
```

#### Python
```python
import random, time

for n in (1000, 10000, 50000):
    nodes = build_chain(n)  # TODO
    ops = 50000
    start = time.perf_counter()
    for _ in range(ops):
        path_max(nodes[random.randrange(n)], nodes[random.randrange(n)])  # TODO
    print(f"n={n:>7}: {(time.perf_counter()-start)/ops*1e9:.0f} ns/op")
```

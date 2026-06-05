# Prüfer Code — Middle Level

> **One-line summary:** Beyond "peel the smallest leaf," the Prüfer code is a bijection you can compute in linear time with a pointer trick, generalize to forests and prescribed-degree trees (multinomial coefficients), and exploit for uniform random tree sampling and tree compression.

---

## Table of Contents

1. [Recap and Mental Model](#recap-and-mental-model)
2. [Comparison with Alternatives](#comparison-with-alternatives)
3. [The O(n) Pointer Trick](#the-on-pointer-trick)
4. [Advanced Patterns](#advanced-patterns)
5. [Generalizations](#generalizations)
6. [Code Examples](#code-examples)
7. [Complexity Deep-Dive](#complexity-deep-dive)
8. [Testing the Bijection](#testing-the-bijection)
9. [Pitfalls at This Level](#pitfalls-at-this-level)
10. [Practice Checklist](#practice-checklist)
11. [Summary](#summary)

---

## Recap and Mental Model

A Prüfer code is a sequence of `n − 2` labels that encodes a labeled tree on vertices `1..n`. Two ideas drive everything:

1. **Encode** removes the smallest leaf `n − 2` times, recording each removed leaf's unique neighbor.
2. **Decode** reverses it using the invariant `appearances(v) = degree(v) − 1`.

At the junior level we used a heap (`O(n log n)`). At this level we care about three upgrades:

- a **linear-time** `O(n)` algorithm,
- the **generalizations** (forests, prescribed degrees, complete bipartite trees),
- the **applications** (uniform sampling, counting, compression) and how to test them.

Keep this invariant table in mind:

```text
encode: code[i] = neighbor of i-th smallest-leaf removal
decode: degree[v] = count(v in code) + 1
        # of times v appears  = degree(v) - 1
        vertices never in code = leaves of the tree
        last vertex n          = ALWAYS one of the final two (never the
                                 smallest leaf if it has high degree); in
                                 the standard algorithm n is never recorded
                                 as a leaf removal because we stop at 2 nodes
```

---

## Comparison with Alternatives

How does a Prüfer code stack up against other ways to *represent* or *count* labeled trees?

| Representation | Size | Canonical? | Reversible? | Random-uniform draw | Notes |
|----------------|------|-----------|-------------|---------------------|-------|
| **Edge list** | `n − 1` pairs | No (order/labeling varies) | Yes | Hard (rejection) | Natural but verbose |
| **Adjacency matrix** | `n²` bits | No | Yes | Hard | Wasteful for sparse trees |
| **Prüfer code** | `n − 2` ints | **Yes** | **Yes** | **`O(n)` trivial** | The canonical compact form |
| **Parent array** (rooted) | `n − 1` ints | Depends on root | Yes | Easy if root fixed | Encodes *rooted* trees; `n^(n−1)` of them |
| **Nested parentheses** | `O(n)` chars | For ordered trees | Yes | — | For *ordered/unlabeled* trees, not labeled |

Two counting facts worth contrasting:

- **Labeled trees** on `n` vertices: `n^(n−2)` (Cayley) — Prüfer code length `n − 2`.
- **Labeled rooted trees**: `n^(n−1)` (choose a root × Cayley) — matches a parent-array of length `n − 1`.

And vs. the sibling **24-kirchhoff-theorem**: Kirchhoff counts spanning trees of *any* graph via a determinant; Prüfer only handles the *complete* graph `K_n` but does so *constructively* (it builds the trees, not just counts them).

---

## The O(n) Pointer Trick

The heap is `O(n log n)`. We can get `O(n)` by observing a subtle monotonicity.

**Encoding in O(n).** Maintain `degree[]`. Walk a pointer `ptr` from `1` upward to find the smallest leaf. Key insight:

> When you remove a leaf and decrement its neighbor `u`'s degree, `u` becomes a new leaf only if `degree[u]` hits 1. If `u < ptr` (already passed), process it **immediately** in a tight inner loop. Otherwise the outer `ptr` walk will reach it naturally. The pointer never moves backward overall, so total work is `O(n)`.

```text
ptr = 1
leaf = 1
repeat n-2 times:
    # find next leaf
    while degree[leaf] != 1:
        ptr += 1
        leaf = ptr
    u = unique remaining neighbor of leaf       # via adjacency or sum trick
    code.append(u)
    degree[leaf] = 0
    degree[u] -= 1
    if degree[u] == 1 and u < ptr:
        leaf = u          # process the small new leaf right away
    else:
        ptr += 1
        leaf = ptr
```

Finding "the unique remaining neighbor" in `O(1)` without scanning is the trick: keep a per-vertex running structure (set, or for a *rooted* tree the parent pointer). A common competitive-programming shortcut for **decoding** avoids adjacency entirely (degrees only), and the same pointer monotonicity gives `O(n)` there too.

**Decoding in O(n).** Same idea — the smallest available leaf index only moves forward except when a freshly-created leaf is smaller than the current pointer, and that happens at most once per code entry, so amortized `O(n)`.

```text
degree[v] = count(v in code) + 1
ptr = smallest v with degree==1
leaf = ptr
for x in code:
    edge(leaf, x)
    degree[x] -= 1
    if degree[x] == 1 and x < ptr:
        leaf = x
    else:
        ptr += 1 until degree[ptr]==1; leaf = ptr
connect last two degree-1 vertices
```

---

## Advanced Patterns

### Pattern 1 — Uniform random labeled tree

Because the map is a bijection, sampling a code uniformly samples a tree uniformly.

```text
random_labeled_tree(n):
    code = [ random int in 1..n  for _ in range(n-2) ]
    return prufer_decode(code)
```

No rejection, no bias, `O(n)`. This is the canonical answer to "generate a random spanning tree of `K_n`."

### Pattern 2 — Counting trees with prescribed degrees

The number of labeled trees where vertex `i` has degree `d_i` (with `Σ d_i = 2(n−1)`) equals the **multinomial coefficient**

```text
       (n - 2)!
  ----------------------
  (d_1-1)!(d_2-1)!...(d_n-1)!
```

because such a tree's Prüfer code is exactly a sequence where label `i` appears `d_i − 1` times. Counting those sequences is "arrange a multiset" → multinomial.

### Pattern 3 — Spanning trees of complete bipartite graphs

`K_{m,n}` has `m^(n−1) · n^(m−1)` spanning trees — derivable via a *bipartite Prüfer-style* code. (The general multipartite count follows similarly.) Use this as a closed form instead of running Kirchhoff on a huge matrix.

### Pattern 4 — Tree compression / canonical hashing

Store or hash a labeled tree by its Prüfer code (`n − 2` ints). Two trees are equal iff their codes are equal — `O(n)` equality and a natural hash key.

---

## Generalizations

| Object | Code length / form | Count |
|--------|--------------------|-------|
| Labeled tree on `n` | `n − 2` over `{1..n}` | `n^(n−2)` |
| Labeled **rooted** tree | parent array, `n − 1` | `n^(n−1)` |
| Tree with degrees `d_i` | code with `i` repeated `d_i−1` | multinomial above |
| Labeled **forest** with `k` trees, roots `r_1..r_k` | generalized Prüfer of length `n − k − 1` | `k · n^(n−k−1)` |
| Spanning trees of `K_{m,n}` | bipartite Prüfer | `m^(n−1) n^(m−1)` |

The forest result: the number of labeled forests on `n` vertices consisting of `k` trees, where `k` specified vertices are the roots (one per tree), is `k · n^(n−k−1)`. Setting `k = 1` recovers Cayley.

---

## Code Examples

### O(n) pointer-trick decode (degrees only, no adjacency)

```go
package main

import "fmt"

type Edge struct{ U, V int }

// DecodeLinear rebuilds a tree from a Prüfer code in O(n).
func DecodeLinear(code []int) []Edge {
	n := len(code) + 2
	degree := make([]int, n+1)
	for v := 1; v <= n; v++ {
		degree[v] = 1
	}
	for _, x := range code {
		degree[x]++
	}

	// ptr: smallest index that is currently a leaf
	ptr := 1
	for degree[ptr] != 1 {
		ptr++
	}
	leaf := ptr

	edges := make([]Edge, 0, n-1)
	for _, x := range code {
		edges = append(edges, Edge{leaf, x})
		degree[leaf]--
		degree[x]--
		if degree[x] == 1 && x < ptr {
			leaf = x
		} else {
			ptr++
			for degree[ptr] != 1 {
				ptr++
			}
			leaf = ptr
		}
	}
	// last edge: the two remaining degree-1 vertices
	u := -1
	for v := 1; v <= n; v++ {
		if degree[v] == 1 {
			if u == -1 {
				u = v
			} else {
				edges = append(edges, Edge{u, v})
				break
			}
		}
	}
	return edges
}

func main() {
	fmt.Println(DecodeLinear([]int{4, 4, 6, 3}))
}
```

```java
import java.util.*;

public class DecodeLinear {
    public static int[][] decode(int[] code) {
        int n = code.length + 2;
        int[] degree = new int[n + 1];
        Arrays.fill(degree, 1, n + 1, 1);
        for (int x : code) degree[x]++;

        int ptr = 1;
        while (degree[ptr] != 1) ptr++;
        int leaf = ptr;

        int[][] edges = new int[n - 1][2];
        int e = 0;
        for (int x : code) {
            edges[e][0] = leaf;
            edges[e][1] = x;
            e++;
            degree[leaf]--;
            degree[x]--;
            if (degree[x] == 1 && x < ptr) {
                leaf = x;
            } else {
                ptr++;
                while (degree[ptr] != 1) ptr++;
                leaf = ptr;
            }
        }
        int u = -1;
        for (int v = 1; v <= n; v++) {
            if (degree[v] == 1) {
                if (u == -1) u = v;
                else { edges[e][0] = u; edges[e][1] = v; break; }
            }
        }
        return edges;
    }

    public static void main(String[] args) {
        for (int[] ed : decode(new int[]{4, 4, 6, 3}))
            System.out.println(Arrays.toString(ed));
    }
}
```

```python
def decode_linear(code):
    n = len(code) + 2
    degree = [0] + [1] * n
    for x in code:
        degree[x] += 1

    ptr = 1
    while degree[ptr] != 1:
        ptr += 1
    leaf = ptr

    edges = []
    for x in code:
        edges.append((leaf, x))
        degree[leaf] -= 1
        degree[x] -= 1
        if degree[x] == 1 and x < ptr:
            leaf = x
        else:
            ptr += 1
            while degree[ptr] != 1:
                ptr += 1
            leaf = ptr

    rem = [v for v in range(1, n + 1) if degree[v] == 1]
    edges.append((rem[0], rem[1]))
    return edges


if __name__ == "__main__":
    print(decode_linear([4, 4, 6, 3]))
```

### Counting trees with prescribed degrees

```go
package main

import "fmt"

func factorial(n int) int {
	r := 1
	for i := 2; i <= n; i++ {
		r *= i
	}
	return r
}

// CountTreesWithDegrees: # labeled trees with deg[i] for i=1..n.
// Requires sum(deg) == 2*(n-1); else 0.
func CountTreesWithDegrees(deg []int) int {
	n := len(deg)
	sum := 0
	for _, d := range deg {
		if d < 1 {
			return 0
		}
		sum += d
	}
	if sum != 2*(n-1) {
		return 0
	}
	res := factorial(n - 2)
	for _, d := range deg {
		res /= factorial(d - 1)
	}
	return res
}

func main() {
	// n=4, degrees [1,2,2,1]: a path. Multinomial 2!/(0!1!1!0!) = 2.
	fmt.Println(CountTreesWithDegrees([]int{1, 2, 2, 1})) // 2
}
```

```java
public class CountTrees {
    static long fact(int n) {
        long r = 1;
        for (int i = 2; i <= n; i++) r *= i;
        return r;
    }

    static long countTreesWithDegrees(int[] deg) {
        int n = deg.length, sum = 0;
        for (int d : deg) { if (d < 1) return 0; sum += d; }
        if (sum != 2 * (n - 1)) return 0;
        long res = fact(n - 2);
        for (int d : deg) res /= fact(d - 1);
        return res;
    }

    public static void main(String[] args) {
        System.out.println(countTreesWithDegrees(new int[]{1, 2, 2, 1})); // 2
    }
}
```

```python
from math import factorial


def count_trees_with_degrees(deg):
    n = len(deg)
    if any(d < 1 for d in deg) or sum(deg) != 2 * (n - 1):
        return 0
    res = factorial(n - 2)
    for d in deg:
        res //= factorial(d - 1)
    return res


if __name__ == "__main__":
    print(count_trees_with_degrees([1, 2, 2, 1]))  # 2
```

### Uniform random labeled tree

```go
package main

import (
	"fmt"
	"math/rand"
)

func RandomLabeledTree(n int) []Edge {
	if n == 1 {
		return nil
	}
	if n == 2 {
		return []Edge{{1, 2}}
	}
	code := make([]int, n-2)
	for i := range code {
		code[i] = rand.Intn(n) + 1 // 1..n
	}
	return DecodeLinear(code)
}

func main() {
	rand.Seed(1)
	fmt.Println(RandomLabeledTree(6))
}
```

```java
import java.util.*;

public class RandomTree {
    static int[][] randomLabeledTree(int n, Random rng) {
        if (n == 2) return new int[][]{{1, 2}};
        int[] code = new int[n - 2];
        for (int i = 0; i < code.length; i++) code[i] = rng.nextInt(n) + 1;
        return DecodeLinear.decode(code);
    }

    public static void main(String[] args) {
        for (int[] e : randomLabeledTree(6, new Random(1)))
            System.out.println(Arrays.toString(e));
    }
}
```

```python
import random


def random_labeled_tree(n, rng=random):
    if n == 1:
        return []
    if n == 2:
        return [(1, 2)]
    code = [rng.randint(1, n) for _ in range(n - 2)]
    return decode_linear(code)


if __name__ == "__main__":
    random.seed(1)
    print(random_labeled_tree(6))
```

---

## Complexity Deep-Dive

| Variant | Time | Space | When to use |
|---------|------|-------|-------------|
| Heap encode/decode | `O(n log n)` | `O(n)` | Clear, default; fine to `n ≈ 10^6` |
| Pointer-trick encode/decode | `O(n)` | `O(n)` | Tight loops, very large `n`, contests |
| Count w/ degrees | `O(n)` (with big-int for large `n`) | `O(1)` | Closed-form counting |
| Random tree | `O(n)` | `O(n)` | Uniform sampling, fuzz tests |

Why the pointer trick is truly `O(n)`: the pointer `ptr` is non-decreasing across the whole run and bounded by `n`; the only "extra" leaf processed out of order (`x < ptr`) is paid for by the code entry that created it — at most one per entry. Amortized total: `O(n)`.

---

## Testing the Bijection

The single most valuable test is the **round-trip property** (see sibling skill *property-based-testing*):

```python
def test_round_trip(n, trials=2000):
    import random
    for _ in range(trials):
        # build a random tree directly, encode, decode, compare edge sets
        code = [random.randint(1, n) for _ in range(n - 2)]
        edges = decode_linear(code)
        # re-encode and check we get the same code back
        adj = {v: [] for v in range(1, n + 1)}
        for u, w in edges:
            adj[u].append(w); adj[w].append(u)
        assert prufer_encode(n, adj) == code
```

This checks `encode(decode(seq)) == seq` for random sequences, which (because `decode` is onto trees) also validates `decode(encode(tree)) == tree`.

A second test: **count check.** Enumerate all `n^(n−2)` codes for small `n` (e.g. `n = 4` → 16 codes), decode each, and assert all decoded trees are distinct and all are valid trees. This empirically confirms the bijection and Cayley's count.

---

## Pitfalls at This Level

- **Big factorials overflow.** `CountTreesWithDegrees` uses `int`; for `n > 20` use big integers (Python is safe by default; Go needs `math/big`; Java `BigInteger`).
- **`rand.Intn(n) + 1`** — forgetting the `+1` yields label 0, which is out of range.
- **Pointer trick correctness** hinges on the `x < ptr` condition — using `<=` or omitting it reintroduces wrong leaves.
- **Forest variant indexing** — the length is `n − k − 1`, not `n − 2`; mixing them silently corrupts results.
- **Equality by edge set, not edge list** — order and endpoint order differ; normalize unordered pairs.

---

## Practice Checklist

- [ ] Implement both heap and pointer-trick decode; assert they agree on random inputs.
- [ ] Write `count_trees_with_degrees` and verify `Σ over all degree sequences = n^(n−2)` for `n = 5`.
- [ ] Generate 10⁵ random trees on `n = 7`; check the empirical distribution of, say, vertex-1 degree against the theoretical `(n−1 choose d−1)(n−1)^... ` ratio.
- [ ] Derive `K_{2,3}` spanning-tree count `2^(3−1)·3^(2−1) = 4·3 = 12` and verify by brute force.
- [ ] Handle `n = 1` and `n = 2` in every function.

---

## Summary

At the middle level, the Prüfer code becomes a *toolkit*: a **linear-time** encode/decode via the pointer trick, a family of **generalizations** (rooted trees `n^(n−1)`, prescribed-degree multinomials, forests `k·n^(n−k−1)`, bipartite `m^(n−1)n^(m−1)`), and concrete **applications** (uniform random trees in `O(n)`, canonical hashing, compression). Test everything with the **round-trip property** and small-`n` exhaustive counts. Compared to alternatives, the Prüfer code is the uniquely *canonical, compact, reversible, and uniformly-samplable* representation of labeled trees — and the constructive counterpart to the determinant-based **24-kirchhoff-theorem**.

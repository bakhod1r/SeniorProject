# Prüfer Code — Interview Preparation

The Prüfer code is a favorite "elegant bijection" interview topic: it tests whether you understand trees beyond traversal, whether you can reason about invariants (`appearances = degree − 1`), and whether you can connect a hands-on algorithm to a famous counting result (Cayley's `n^{n−2}`). This file is a graded question bank, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Fact / Operation | Result | Notes |
|------------------|--------|-------|
| Code length | `n − 2` | empty for `n = 1, 2` |
| Encode | peel smallest leaf, record its neighbor | `O(n log n)` heap, `O(n)` pointer |
| Decode | `deg(v)=count(v)+1`; connect smallest leaf to each code entry | finish with last 2 leaves |
| Appearances of `v` | `deg(v) − 1` | leaf ⇔ never appears |
| # labeled trees | `n^{n−2}` (Cayley) | bijection corollary |
| # trees, degrees `d_i` | `(n−2)! / Π(d_i−1)!` | multinomial |
| # rooted forests, `k` roots | `k·n^{n−k−1}` | `k=1` ⇒ Cayley |
| Spanning trees `K_{m,n}` | `m^{n−1} n^{m−1}` | bipartite Prüfer |
| Random labeled tree | decode `n−2` random ints in `1..n` | uniform, `O(n)` |

```text
ENCODE(adj, n):                       DECODE(code):  n = len(code)+2
  deg[v] = #neighbors                   deg[v] = count(v in code)+1
  heap <- all leaves (deg==1)           heap <- all leaves (deg==1)
  repeat n-2:                           for x in code:
    leaf = pop min                        leaf = pop min
    u = sole neighbor(leaf)               edge(leaf, x)
    code.append(u)                        deg[leaf]--; deg[x]--
    deg[u]--; if deg[u]==1 push u         if deg[x]==1 push x
                                         connect last two leaves
```

**Invariants to recite:** smallest-leaf rule (else not canonical), `deg = appearances + 1`, code length `n − 2`, bijection ⇒ Cayley.

---

## Junior Questions (12 Q&A)

### J1. What is a Prüfer code?
A unique sequence of `n − 2` integers (each in `1..n`) that encodes a labeled tree on `n` vertices. It is produced by repeatedly removing the smallest-labeled leaf and recording its single neighbor, and you can rebuild the exact tree from the sequence.

### J2. How long is the code and why?
`n − 2`. Encoding removes one leaf per step and stops when 2 vertices remain, so it runs `n − 2` times, recording one number each time.

### J3. What is recorded at each step — the leaf or its neighbor?
The **neighbor**. The leaf being removed is never written down; we record the vertex it was attached to.

### J4. What does "labeled" tree mean?
The vertices have distinct identities `1..n`. Two trees that look the same as drawings but assign different labels to vertices are *different* labeled trees and get different codes.

### J5. How do you encode? Give the rule.
Repeatedly: find the smallest leaf, append its only neighbor to the code, delete the leaf. Do this `n − 2` times.

### J6. How do you decode?
Compute `deg(v) = (times v appears in code) + 1`. Then for each code value `x`, connect the smallest vertex still having degree 1 to `x`, decrement both degrees. Finally connect the two leftover degree-1 vertices.

### J7. Why must you always pick the *smallest* leaf?
To make encoding deterministic and the map a bijection. Picking any leaf still gives a valid tree on decode, but it would not be the canonical Prüfer code, and the round-trip would break.

### J8. What is the time complexity?
`O(n log n)` with a min-heap for "smallest leaf," or `O(n)` with a monotone-pointer trick. Space is `O(n)`.

### J9. What is Cayley's formula and how does Prüfer relate?
Cayley's formula says there are `n^{n−2}` labeled trees on `n` vertices. The Prüfer code is a bijection between trees and length-`(n−2)` sequences over `n` symbols; there are `n^{n−2}` such sequences, so the formula follows directly.

### J10. How do you generate a uniformly random labeled tree?
Pick `n − 2` random integers in `1..n` and decode them. Because decoding is a bijection, this samples trees uniformly. `O(n)`, no rejection.

### J11. What are the edge cases?
`n = 1`: empty code, no edges. `n = 2`: empty code, one implicit edge `(1,2)`. Also watch 1-indexed labels vs 0-indexed arrays.

### J12. If a vertex never appears in the code, what is it?
A **leaf** of the original tree (degree 1), since `appearances = degree − 1 = 0`.

---

## Middle Questions (12 Q&A)

### M1. State and justify the invariant `appearances(v) = deg(v) − 1`.
A vertex `v` is recorded once for each incident edge removed by peeling a neighbor. `v` loses all but possibly one edge through such peelings before either surviving to the final pair (ends with 1 edge → recorded `deg−1` times) or being peeled itself (the step that peels `v` records `v`'s neighbor, not `v`). Either way `v` is recorded `deg(v) − 1` times.

### M2. Why does the decoder know the degree sequence before placing any edge?
Because `deg(v) = appearances + 1` is computable directly from the code. That recovered degree sequence is exactly the original tree's, which is what makes decoding deterministic and correct.

### M3. Describe the O(n) pointer trick for decode.
Keep a pointer scanning for the smallest current leaf. When you decrement a vertex's degree to 1 and that vertex is *below* the pointer, process it immediately; otherwise the forward-moving pointer will reach it. The pointer is monotone and each out-of-order leaf is charged to one code entry, so total work is `O(n)`.

### M4. How many labeled trees have a given degree sequence?
`(n−2)! / Π(d_i−1)!`, the multinomial counting arrangements of a code where symbol `i` appears `d_i − 1` times.

### M5. Why is summing that multinomial over all degree sequences equal to `n^{n−2}`?
By the multinomial theorem: summing `(n−2)!/Π m_i!` over all `(m_i)` with `Σ m_i = n−2` equals `n^{n−2}` (expand `(1+…+1)^{n−2}` with `n` ones). It is an internal consistency check on Cayley.

### M6. Count spanning trees of `K_{3,3}`.
`m^{n−1} n^{m−1} = 3^{2} · 3^{2} = 9 · 9 = 81`.

### M7. How is generating a random *parent array* different from Prüfer sampling?
A random parent array samples uniformly among `n^{n−1}` *rooted* trees, which is not uniform over *unrooted* labeled trees. Prüfer decoding gives uniform over unrooted labeled trees (`n^{n−2}`).

### M8. How do you compare two labeled trees for equality fast using Prüfer?
Encode both to canonical codes and compare the `n − 2`-length sequences. Equal codes ⇔ equal trees. `O(n)` after encoding.

### M9. What is the forest generalization count?
The number of labeled forests on `n` vertices with `k` trees and `k` specified roots is `k·n^{n−k−1}`; `k = 1` recovers Cayley.

### M10. Where would you use a min-heap vs a pointer here?
Heap = simplest correct (`O(n log n)`), good default. Pointer = `O(n)`, for very large `n` or contest time limits. They produce identical output.

### M11. How do you handle the "find the unique remaining neighbor" cheaply in encode?
Use a per-vertex XOR (or sum) of current neighbors. For a leaf, that XOR *is* its single neighbor; on removal, XOR it out of the neighbor. `O(1)`, no per-vertex sets.

### M12. Why does the last vertex never need recording?
Encoding stops at 2 vertices; the final edge between them is implicit. The code only records the `n − 2` peel steps.

---

## Senior Questions (10 Q&A)

### S1. When is Prüfer the *wrong* tool?
For weighted spanning trees, spanning trees of arbitrary (non-complete) graphs, or unlabeled trees. Use Kirchhoff (24-kirchhoff-theorem), MST algorithms (10-mst-kruskal-prim), or AHU canonical forms instead.

### S2. Contrast the Prüfer and Kirchhoff proofs of Cayley.
Prüfer is constructive — it builds a bijection trees↔sequences and reads off `n^{n−2}`. Kirchhoff is algebraic — it evaluates a cofactor of the reduced Laplacian of `K_n`, giving `n^{n−2}` as a determinant. Prüfer generalizes to closed-form counts; Kirchhoff generalizes to arbitrary graphs.

### S3. How do you keep counts exact for large `n`?
Use big integers (Python native, Go `math/big`, Java `BigInteger`). For multinomials avoid dividing huge numbers — cancel factorial factors incrementally, or compute modulo a prime with precomputed inverse factorials.

### S4. Design a "random tree" service. What concerns matter?
Seedable reproducibility, documenting *uniform-over-labeled-trees-of-K_n* (not unlabeled, not arbitrary graphs), label remapping at the boundary, edge cases `n∈{1,2}`, and avoiding the parent-array bias. Core is one decode call.

### S5. How do you validate untrusted Prüfer input?
Check every value is in `1..n` where `n = len+2`, and special-case `n < 2`. For untrusted *trees* to encode, verify `edges == n−1` and connectivity before running the inner loop.

### S6. Why is encoding inherently sequential? How do you still parallelize?
Each leaf removal mutates degrees, so one tree's encode can't be parallelized. But independent trees are embarrassingly parallel — batch them across cores/workers.

### S7. How would you stream-decode a huge tree?
Emit edges lazily as a generator while consuming the code; downstream (file writer, graph DB bulk loader) consumes the stream without materializing all `n − 1` edges at once.

### S8. Give the complete-multipartite spanning-tree formula and a specialization.
`τ(K_{n_1,…,n_r}) = N^{r−2} Π (N − n_i)^{n_i−1}` with `N = Σ n_i`. `r=2` gives `m^{n−1} n^{m−1}`; all singletons give Cayley `N^{N−2}`.

### S9. How does the XOR-sum trick reduce memory at scale?
It replaces a per-vertex neighbor `Set` (pointers, allocations) with a single integer per vertex, cutting memory by roughly an order of magnitude and improving cache behavior for `n` in the millions.

### S10. What property test most quickly catches bugs?
The round-trip: `encode(decode(seq)) == seq` for random `seq`. Because decode is onto trees, this simultaneously validates `decode(encode(tree)) == tree`.

---

## Staff / Principal Questions (8 Q&A)

### P1. Prove the bijection is well-defined in both directions.
Encode: every tree with ≥2 vertices has a (smallest) leaf, deleting a leaf yields a tree, so the loop runs `n−2` times producing values in `1..n`. Decode: the recovered degrees sum to `2(n−1)`, a leaf always exists during the loop, no vertex is reused after removal, and `n−1` acyclic edges on `n` vertices form a tree. (See professional.md §2–3.)

### P2. Prove `decode(encode(T)) = T`.
Decode begins with the true degree sequence (invariant `deg = appearances+1`). By induction the `i`-th leaf decode chooses equals the `i`-th leaf encode peeled, and the `i`-th edge added equals the edge removed; the final two leftover vertices form the last edge. (professional.md §5.)

### P3. Derive the degree-multinomial count from the bijection.
A tree has degrees `(d_i)` iff its code has symbol `i` exactly `d_i−1` times; counting such codes is `(n−2)!/Π(d_i−1)!`.

### P4. Reconcile `n^{n−2}` (unrooted) with `n^{n−1}` (rooted).
Rooted = choose a root (`n` ways) × unrooted = `n · n^{n−2} = n^{n−1}`. A parent array encodes a rooted tree.

### P5. How does the forest count `k·n^{n−k−1}` arise?
Attach a virtual vertex `0` to the `k` roots, forming a tree on `n+1` vertices where `0` has degree `k`; counting via the degree-multinomial with `d_0 = k` and simplifying gives `k·n^{n−k−1}`.

### P6. When would you compute counts mod a prime, and how?
In combinatorial/contest settings or when only `count mod p` is needed. Precompute factorials and modular inverse factorials; `n^{n−2} mod p` via fast exponentiation; multinomials via `fact[n−2]·Π invfact[d_i−1]`.

### P7. Compare Prüfer sampling vs Wilson's algorithm for random spanning trees.
Prüfer samples uniform spanning trees of `K_n` in `O(n)`. Wilson's loop-erased random walk samples uniform spanning trees of an *arbitrary* (weighted) graph. For `K_n` specifically, Prüfer is simpler and faster; for general graphs you need Wilson/Aldous–Broder.

### P8. What numerical pitfalls exist in the degree-multinomial?
Direct `(n−2)!` overflows quickly (`n>20` in 64-bit). Cancel factorial terms or use big integers; integer-divide only when divisibility is guaranteed (it always is here since the count is an integer).

---

## Behavioral Questions (5)

### B1. Tell me about a time you chose an elegant algorithm over a brute-force one.
*Structure (STAR):* Situation — needed uniform random tree topologies for a graph-DB load test; the naive approach generated random graphs and rejected non-trees, wasting >90% of attempts. Task — make generation fast and provably uniform. Action — recognized the requirement as "uniform labeled tree" and replaced rejection sampling with Prüfer decode of random sequences. Result — `O(n)` per tree, zero rejection, and I could *prove* uniformity to skeptical reviewers via the bijection.

### B2. Describe explaining a tricky concept (like a bijection) to a teammate.
Focus on the one invariant (`appearances = degree − 1`), use a tiny `n=4` worked example, and show the round-trip live. Concrete small cases beat abstract proofs for building intuition; I followed up with the formal proof for those who wanted rigor.

### B3. A time you found a subtle off-by-one bug.
A decoder mixed 0-indexed input with a 1-indexed inner loop, dropping vertex `n`. Caught it via a property test (`encode(decode(seq)) == seq`) that failed on ~1/n of random inputs. Lesson: add round-trip property tests early; they localize indexing bugs instantly.

### B4. How do you decide between a clear `O(n log n)` and a complex `O(n)` solution?
Default to the clear heap version; switch to the pointer trick only when profiling shows it matters (large `n`, hot path). Premature micro-optimization costs readability; I document both and gate the fast path behind a benchmark.

### B5. A time you pushed back on an over-engineered design.
A teammate wanted a full graph library to generate random trees. I showed a 15-line Prüfer decoder met every requirement with a fraction of the surface area and maintenance cost. We shipped the small version with thorough tests.

---

## Coding Challenges

### Challenge 1 — Encode a tree to its Prüfer code

> Given `n` and the `n − 1` edges of a labeled tree (`1..n`), return its Prüfer code.

```go
package main

import (
	"container/heap"
	"fmt"
)

type IntHeap []int

func (h IntHeap) Len() int            { return len(h) }
func (h IntHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h IntHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *IntHeap) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *IntHeap) Pop() interface{} {
	o := *h
	x := o[len(o)-1]
	*h = o[:len(o)-1]
	return x
}

func encode(n int, edges [][2]int) []int {
	deg := make([]int, n+1)
	nx := make([]int, n+1) // XOR of current neighbors
	for _, e := range edges {
		deg[e[0]]++; deg[e[1]]++
		nx[e[0]] ^= e[1]; nx[e[1]] ^= e[0]
	}
	h := &IntHeap{}
	for v := 1; v <= n; v++ {
		if deg[v] == 1 {
			heap.Push(h, v)
		}
	}
	code := make([]int, 0, n-2)
	for len(code) < n-2 {
		leaf := heap.Pop(h).(int)
		u := nx[leaf] // unique neighbor
		code = append(code, u)
		nx[u] ^= leaf
		if deg[u]--; deg[u] == 1 {
			heap.Push(h, u)
		}
	}
	return code
}

func main() {
	edges := [][2]int{{1, 4}, {2, 4}, {4, 6}, {5, 3}, {3, 6}}
	fmt.Println(encode(6, edges)) // [4 4 6 3]
}
```

```java
import java.util.*;

public class Encode {
    static int[] encode(int n, int[][] edges) {
        int[] deg = new int[n + 1];
        int[] nx = new int[n + 1];
        for (int[] e : edges) {
            deg[e[0]]++; deg[e[1]]++;
            nx[e[0]] ^= e[1]; nx[e[1]] ^= e[0];
        }
        PriorityQueue<Integer> pq = new PriorityQueue<>();
        for (int v = 1; v <= n; v++) if (deg[v] == 1) pq.add(v);
        int[] code = new int[Math.max(0, n - 2)];
        int i = 0;
        while (i < n - 2) {
            int leaf = pq.poll();
            int u = nx[leaf];
            code[i++] = u;
            nx[u] ^= leaf;
            if (--deg[u] == 1) pq.add(u);
        }
        return code;
    }

    public static void main(String[] args) {
        int[][] edges = {{1, 4}, {2, 4}, {4, 6}, {5, 3}, {3, 6}};
        System.out.println(Arrays.toString(encode(6, edges))); // [4, 4, 6, 3]
    }
}
```

```python
import heapq


def encode(n, edges):
    deg = [0] * (n + 1)
    nx = [0] * (n + 1)            # XOR of current neighbors
    for a, b in edges:
        deg[a] += 1; deg[b] += 1
        nx[a] ^= b; nx[b] ^= a
    leaves = [v for v in range(1, n + 1) if deg[v] == 1]
    heapq.heapify(leaves)
    code = []
    while len(code) < n - 2:
        leaf = heapq.heappop(leaves)
        u = nx[leaf]
        code.append(u)
        nx[u] ^= leaf
        deg[u] -= 1
        if deg[u] == 1:
            heapq.heappush(leaves, u)
    return code


if __name__ == "__main__":
    print(encode(6, [(1, 4), (2, 4), (4, 6), (5, 3), (3, 6)]))  # [4, 4, 6, 3]
```

### Challenge 2 — Decode a Prüfer code to edges

> Given a code of length `n − 2`, return the `n − 1` edges. (Heap version, clear.)

```go
package main

import (
	"container/heap"
	"fmt"
)

func decode(code []int) [][2]int {
	n := len(code) + 2
	deg := make([]int, n+1)
	for v := 1; v <= n; v++ {
		deg[v] = 1
	}
	for _, x := range code {
		deg[x]++
	}
	h := &IntHeap{}
	for v := 1; v <= n; v++ {
		if deg[v] == 1 {
			heap.Push(h, v)
		}
	}
	edges := make([][2]int, 0, n-1)
	for _, x := range code {
		leaf := heap.Pop(h).(int)
		edges = append(edges, [2]int{leaf, x})
		deg[leaf]--; deg[x]--
		if deg[x] == 1 {
			heap.Push(h, x)
		}
	}
	u := heap.Pop(h).(int)
	v := heap.Pop(h).(int)
	edges = append(edges, [2]int{u, v})
	return edges
}

func main() { fmt.Println(decode([]int{4, 4, 6, 3})) }
```

```java
import java.util.*;

public class Decode {
    static int[][] decode(int[] code) {
        int n = code.length + 2;
        int[] deg = new int[n + 1];
        Arrays.fill(deg, 1, n + 1, 1);
        for (int x : code) deg[x]++;
        PriorityQueue<Integer> pq = new PriorityQueue<>();
        for (int v = 1; v <= n; v++) if (deg[v] == 1) pq.add(v);
        int[][] edges = new int[n - 1][2];
        int e = 0;
        for (int x : code) {
            int leaf = pq.poll();
            edges[e][0] = leaf; edges[e][1] = x; e++;
            deg[leaf]--;
            if (--deg[x] == 1) pq.add(x);
        }
        edges[e][0] = pq.poll(); edges[e][1] = pq.poll();
        return edges;
    }

    public static void main(String[] args) {
        for (int[] ed : decode(new int[]{4, 4, 6, 3}))
            System.out.println(Arrays.toString(ed));
    }
}
```

```python
import heapq


def decode(code):
    n = len(code) + 2
    deg = [0] + [1] * n
    for x in code:
        deg[x] += 1
    leaves = [v for v in range(1, n + 1) if deg[v] == 1]
    heapq.heapify(leaves)
    edges = []
    for x in code:
        leaf = heapq.heappop(leaves)
        edges.append((leaf, x))
        deg[leaf] -= 1; deg[x] -= 1
        if deg[x] == 1:
            heapq.heappush(leaves, x)
    u = heapq.heappop(leaves); v = heapq.heappop(leaves)
    edges.append((u, v))
    return edges


if __name__ == "__main__":
    print(decode([4, 4, 6, 3]))
```

### Challenge 3 — Count trees with a given degree sequence

> Given degrees `d_1..d_n`, return how many labeled trees realize them.

```go
package main

import (
	"fmt"
	"math/big"
)

func fact(n int) *big.Int { return new(big.Int).MulRange(1, int64(n)) }

func countTrees(deg []int) *big.Int {
	n := len(deg)
	sum := 0
	for _, d := range deg {
		if d < 1 {
			return big.NewInt(0)
		}
		sum += d
	}
	if sum != 2*(n-1) {
		return big.NewInt(0)
	}
	res := fact(n - 2)
	for _, d := range deg {
		res.Div(res, fact(d-1))
	}
	return res
}

func main() { fmt.Println(countTrees([]int{1, 2, 2, 1})) } // 2
```

```java
import java.math.BigInteger;

public class CountTrees {
    static BigInteger fact(int n) {
        BigInteger r = BigInteger.ONE;
        for (int i = 2; i <= n; i++) r = r.multiply(BigInteger.valueOf(i));
        return r;
    }
    static BigInteger countTrees(int[] deg) {
        int n = deg.length, sum = 0;
        for (int d : deg) { if (d < 1) return BigInteger.ZERO; sum += d; }
        if (sum != 2 * (n - 1)) return BigInteger.ZERO;
        BigInteger res = fact(n - 2);
        for (int d : deg) res = res.divide(fact(d - 1));
        return res;
    }
    public static void main(String[] a) {
        System.out.println(countTrees(new int[]{1, 2, 2, 1})); // 2
    }
}
```

```python
from math import factorial


def count_trees(deg):
    n = len(deg)
    if any(d < 1 for d in deg) or sum(deg) != 2 * (n - 1):
        return 0
    res = factorial(n - 2)
    for d in deg:
        res //= factorial(d - 1)
    return res


if __name__ == "__main__":
    print(count_trees([1, 2, 2, 1]))  # 2
```

### Challenge 4 — Generate a uniformly random labeled tree

> Return the edges of a uniformly random labeled tree on `n` vertices, given a seed.

```go
package main

import (
	"fmt"
	"math/rand"
)

func randomTree(n int, seed int64) [][2]int {
	r := rand.New(rand.NewSource(seed))
	if n == 1 {
		return nil
	}
	if n == 2 {
		return [][2]int{{1, 2}}
	}
	code := make([]int, n-2)
	for i := range code {
		code[i] = r.Intn(n) + 1
	}
	return decode(code)
}

func main() { fmt.Println(randomTree(6, 42)) }
```

```java
import java.util.*;

public class RandomTree {
    static int[][] randomTree(int n, long seed) {
        Random r = new Random(seed);
        if (n == 2) return new int[][]{{1, 2}};
        int[] code = new int[n - 2];
        for (int i = 0; i < code.length; i++) code[i] = r.nextInt(n) + 1;
        return Decode.decode(code);
    }
    public static void main(String[] a) {
        for (int[] e : randomTree(6, 42)) System.out.println(Arrays.toString(e));
    }
}
```

```python
import random


def random_tree(n, seed=None):
    rng = random.Random(seed)
    if n == 1:
        return []
    if n == 2:
        return [(1, 2)]
    code = [rng.randint(1, n) for _ in range(n - 2)]
    return decode(code)


if __name__ == "__main__":
    print(random_tree(6, 42))
```

---

## Final Tips

- **Lead with the invariant.** Saying "a vertex appears `deg − 1` times" upfront shows depth and makes both directions obvious.
- **Always mention Cayley.** Connecting the algorithm to `n^{n−2}` signals you understand *why* it matters.
- **Special-case `n ∈ {1, 2}`** before writing the loop; interviewers probe this.
- **Use the round-trip test** to justify correctness when asked "how would you test this?"
- **Know when not to use it:** weighted / arbitrary-graph / unlabeled cases route elsewhere (24-kirchhoff-theorem, 10-mst-kruskal-prim).

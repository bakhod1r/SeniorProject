# Prüfer Code — Practice Tasks

Fifteen graded exercises (5 easy, 5 medium, 5 hard) plus a benchmark task. Each task states the problem, gives constraints, a worked example, hints, and a reference solution in Go, Java, and Python. Labels are `1..n` (1-indexed) unless noted. Reuse `encode`/`decode` from the earlier files where helpful.

---

## Shared helpers (used across solutions)

```python
import heapq

def encode(n, edges):
    deg = [0] * (n + 1); nx = [0] * (n + 1)
    for a, b in edges:
        deg[a] += 1; deg[b] += 1; nx[a] ^= b; nx[b] ^= a
    leaves = [v for v in range(1, n + 1) if deg[v] == 1]
    heapq.heapify(leaves)
    code = []
    while len(code) < n - 2:
        leaf = heapq.heappop(leaves)
        u = nx[leaf]; code.append(u); nx[u] ^= leaf
        deg[u] -= 1
        if deg[u] == 1: heapq.heappush(leaves, u)
    return code

def decode(code):
    n = len(code) + 2
    deg = [0] + [1] * n
    for x in code: deg[x] += 1
    leaves = [v for v in range(1, n + 1) if deg[v] == 1]
    heapq.heapify(leaves)
    edges = []
    for x in code:
        leaf = heapq.heappop(leaves)
        edges.append((leaf, x)); deg[leaf] -= 1; deg[x] -= 1
        if deg[x] == 1: heapq.heappush(leaves, x)
    u = heapq.heappop(leaves); v = heapq.heappop(leaves)
    edges.append((u, v))
    return edges
```

---

# EASY

## E1 — Code length and validity

**Problem.** Given an integer `n ≥ 1`, return the length of the Prüfer code, and given a candidate sequence, decide whether it is a valid code for some tree on `n` vertices.

**Constraints.** `1 ≤ n ≤ 10^6`.

**Example.** `n = 6` → length `4`. Sequence `[4,4,6,3]` valid; `[4,4,6,7]` invalid (`7 > 6`); `[1,2,3]` invalid for `n=6` (wrong length).

**Hint.** Length is `max(0, n − 2)`. Validity: length must equal `n − 2` and every value in `1..n`.

```go
func codeLen(n int) int {
	if n < 2 {
		return 0
	}
	return n - 2
}

func validCode(n int, code []int) bool {
	if len(code) != codeLen(n) {
		return false
	}
	for _, x := range code {
		if x < 1 || x > n {
			return false
		}
	}
	return true
}
```

```java
static int codeLen(int n) { return n < 2 ? 0 : n - 2; }

static boolean validCode(int n, int[] code) {
    if (code.length != codeLen(n)) return false;
    for (int x : code) if (x < 1 || x > n) return false;
    return true;
}
```

```python
def code_len(n):
    return max(0, n - 2)

def valid_code(n, code):
    return len(code) == code_len(n) and all(1 <= x <= n for x in code)
```

## E2 — Degree sequence from a code

**Problem.** Given a Prüfer code, return the degree of every vertex `1..n` without building the tree.

**Constraints.** `n = len(code) + 2 ≤ 10^6`.

**Example.** `[4,4,6,3]` → `deg = {1:1, 2:1, 3:2, 4:3, 5:1, 6:2}`.

**Hint.** `deg(v) = count(v in code) + 1`.

```go
func degrees(code []int) []int {
	n := len(code) + 2
	deg := make([]int, n+1)
	for v := 1; v <= n; v++ {
		deg[v] = 1
	}
	for _, x := range code {
		deg[x]++
	}
	return deg
}
```

```java
static int[] degrees(int[] code) {
    int n = code.length + 2;
    int[] deg = new int[n + 1];
    java.util.Arrays.fill(deg, 1, n + 1, 1);
    for (int x : code) deg[x]++;
    return deg;
}
```

```python
def degrees(code):
    n = len(code) + 2
    deg = [0] + [1] * n
    for x in code:
        deg[x] += 1
    return deg
```

## E3 — Leaves of the original tree from the code

**Problem.** Return the sorted list of leaves (degree-1 vertices) of the tree a code decodes to, without decoding.

**Example.** `[4,4,6,3]` → leaves `[1, 2, 5]`.

**Hint.** Leaves are exactly the vertices that never appear in the code.

```go
func leaves(code []int) []int {
	n := len(code) + 2
	seen := make([]bool, n+1)
	for _, x := range code {
		seen[x] = true
	}
	var res []int
	for v := 1; v <= n; v++ {
		if !seen[v] {
			res = append(res, v)
		}
	}
	return res
}
```

```java
static java.util.List<Integer> leaves(int[] code) {
    int n = code.length + 2;
    boolean[] seen = new boolean[n + 1];
    for (int x : code) seen[x] = true;
    java.util.List<Integer> res = new java.util.ArrayList<>();
    for (int v = 1; v <= n; v++) if (!seen[v]) res.add(v);
    return res;
}
```

```python
def leaves(code):
    n = len(code) + 2
    seen = set(code)
    return [v for v in range(1, n + 1) if v not in seen]
```

## E4 — Is the tree a star?

**Problem.** Decide whether the decoded tree is a *star* (one center adjacent to all others) using only the code.

**Example.** `n = 5`, code `[3,3,3]` → star centered at 3. Code `[2,3]` → not a star.

**Hint.** A star on `n ≥ 3` vertices has one vertex of degree `n − 1`; its code is the center repeated `n − 2` times.

```go
func isStar(code []int) bool {
	if len(code) == 0 {
		return true // n<=2 trivially a star
	}
	c := code[0]
	for _, x := range code {
		if x != c {
			return false
		}
	}
	return true
}
```

```java
static boolean isStar(int[] code) {
    if (code.length == 0) return true;
    int c = code[0];
    for (int x : code) if (x != c) return false;
    return true;
}
```

```python
def is_star(code):
    return len(code) == 0 or all(x == code[0] for x in code)
```

## E5 — Is the tree a path?

**Problem.** Decide whether the decoded tree is a simple path.

**Example.** `n = 5`, code `[2,3,4]` (path `1-2-3-4-5`) → path. Code `[3,3,3]` (star) → not a path.

**Hint.** A path has exactly two leaves and all other degrees equal 2. So in the code, no value appears more than once (each interior vertex appears `deg−1 = 1` time), i.e. the code has no repeats.

```go
func isPath(code []int) bool {
	seen := map[int]bool{}
	for _, x := range code {
		if seen[x] {
			return false
		}
		seen[x] = true
	}
	return true
}
```

```java
static boolean isPath(int[] code) {
    java.util.Set<Integer> s = new java.util.HashSet<>();
    for (int x : code) if (!s.add(x)) return false;
    return true;
}
```

```python
def is_path(code):
    return len(set(code)) == len(code)
```

---

# MEDIUM

## M1 — Round-trip verifier

**Problem.** Given a tree's edges, encode then decode and assert the decoded edge set equals the original (as unordered pairs). Return `True/False`.

**Example.** Edges `[(1,4),(2,4),(4,6),(5,3),(3,6)]` → `True`.

**Hint.** Normalize each edge as `(min, max)` and compare sets.

```go
func norm(e [2]int) [2]int {
	if e[0] > e[1] {
		return [2]int{e[1], e[0]}
	}
	return e
}

func roundTrip(n int, edges [][2]int) bool {
	code := encode(n, edges)
	got := decode(code)
	set := map[[2]int]bool{}
	for _, e := range edges {
		set[norm(e)] = true
	}
	if len(got) != len(edges) {
		return false
	}
	for _, e := range got {
		if !set[norm(e)] {
			return false
		}
	}
	return true
}
```

```java
static long key(int a, int b) { return a < b ? (long) a << 20 | b : (long) b << 20 | a; }

static boolean roundTrip(int n, int[][] edges) {
    int[] code = Encode.encode(n, edges);
    int[][] got = Decode.decode(code);
    java.util.Set<Long> set = new java.util.HashSet<>();
    for (int[] e : edges) set.add(key(e[0], e[1]));
    if (got.length != edges.length) return false;
    for (int[] e : got) if (!set.contains(key(e[0], e[1]))) return false;
    return true;
}
```

```python
def round_trip(n, edges):
    code = encode(n, edges)
    got = decode(code)
    norm = lambda e: tuple(sorted(e))
    return {norm(e) for e in got} == {norm(e) for e in edges} and len(got) == len(edges)
```

## M2 — Count labeled trees (Cayley) with big integers

**Problem.** Return `n^{n−2}` exactly for `1 ≤ n ≤ 1000`.

**Example.** `n=4 → 16`, `n=10 → 100000000`.

**Hint.** Use big-integer exponentiation; define `n=1,2 → 1`.

```go
func cayley(n int) *big.Int {
	if n <= 2 {
		return big.NewInt(1)
	}
	return new(big.Int).Exp(big.NewInt(int64(n)), big.NewInt(int64(n-2)), nil)
}
```

```java
static java.math.BigInteger cayley(int n) {
    if (n <= 2) return java.math.BigInteger.ONE;
    return java.math.BigInteger.valueOf(n).pow(n - 2);
}
```

```python
def cayley(n):
    return 1 if n <= 2 else n ** (n - 2)
```

## M3 — Count trees with prescribed degrees

**Problem.** Given degrees `d_1..d_n`, return the number of labeled trees realizing them; 0 if impossible.

**Example.** `[1,2,2,1] → 2`; `[1,1,1,1] → 0` (degree sum `4 ≠ 6`).

**Hint.** Multinomial `(n−2)!/Π(d_i−1)!`; require `Σ d_i = 2(n−1)` and each `d_i ≥ 1`.

```go
func countByDeg(deg []int) *big.Int {
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
	res := new(big.Int).MulRange(1, int64(n-2))
	for _, d := range deg {
		res.Div(res, new(big.Int).MulRange(1, int64(d-1)))
	}
	return res
}
```

```java
static java.math.BigInteger fact(int n) {
    java.math.BigInteger r = java.math.BigInteger.ONE;
    for (int i = 2; i <= n; i++) r = r.multiply(java.math.BigInteger.valueOf(i));
    return r;
}
static java.math.BigInteger countByDeg(int[] deg) {
    int n = deg.length, s = 0;
    for (int d : deg) { if (d < 1) return java.math.BigInteger.ZERO; s += d; }
    if (s != 2 * (n - 1)) return java.math.BigInteger.ZERO;
    java.math.BigInteger r = fact(n - 2);
    for (int d : deg) r = r.divide(fact(d - 1));
    return r;
}
```

```python
from math import factorial
def count_by_deg(deg):
    n = len(deg)
    if any(d < 1 for d in deg) or sum(deg) != 2 * (n - 1):
        return 0
    r = factorial(n - 2)
    for d in deg:
        r //= factorial(d - 1)
    return r
```

## M4 — Uniform random tree with a seed

**Problem.** Given `n` and `seed`, return a uniformly random labeled tree's edges deterministically.

**Example.** Same `(n, seed)` → identical edges across runs.

**Hint.** Random code of `n−2` ints in `1..n`, then decode.

```go
func randTree(n int, seed int64) [][2]int {
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
```

```java
static int[][] randTree(int n, long seed) {
    java.util.Random r = new java.util.Random(seed);
    if (n == 2) return new int[][]{{1, 2}};
    int[] code = new int[n - 2];
    for (int i = 0; i < code.length; i++) code[i] = r.nextInt(n) + 1;
    return Decode.decode(code);
}
```

```python
import random
def rand_tree(n, seed=None):
    rng = random.Random(seed)
    if n == 1: return []
    if n == 2: return [(1, 2)]
    return decode([rng.randint(1, n) for _ in range(n - 2)])
```

## M5 — Center vertex of the encoded tree (max-degree)

**Problem.** Return the vertex of maximum degree (smallest label on ties) from a code.

**Example.** `[4,4,6,3]` → `4` (degree 3).

**Hint.** Count appearances; degree = count+1; argmax with tie-break.

```go
func maxDegVertex(code []int) int {
	n := len(code) + 2
	cnt := make([]int, n+1)
	for _, x := range code {
		cnt[x]++
	}
	best, bestV := -1, 1
	for v := 1; v <= n; v++ {
		if cnt[v] > best {
			best, bestV = cnt[v], v
		}
	}
	return bestV
}
```

```java
static int maxDegVertex(int[] code) {
    int n = code.length + 2;
    int[] cnt = new int[n + 1];
    for (int x : code) cnt[x]++;
    int best = -1, bestV = 1;
    for (int v = 1; v <= n; v++) if (cnt[v] > best) { best = cnt[v]; bestV = v; }
    return bestV;
}
```

```python
def max_deg_vertex(code):
    n = len(code) + 2
    cnt = [0] * (n + 1)
    for x in code:
        cnt[x] += 1
    return max(range(1, n + 1), key=lambda v: (cnt[v], -v))
```

---

# HARD

## H1 — Linear-time decode (no heap)

**Problem.** Decode in `O(n)` using the monotone-pointer trick.

**Constraints.** `n ≤ 5·10^6`; must avoid `O(n log n)`.

**Hint.** Maintain `ptr` to the smallest current leaf; if a freshly-decremented vertex `< ptr` becomes a leaf, use it immediately.

```go
func decodeLinear(code []int) [][2]int {
	n := len(code) + 2
	deg := make([]int, n+1)
	for v := 1; v <= n; v++ {
		deg[v] = 1
	}
	for _, x := range code {
		deg[x]++
	}
	ptr := 1
	for deg[ptr] != 1 {
		ptr++
	}
	leaf := ptr
	edges := make([][2]int, 0, n-1)
	for _, x := range code {
		edges = append(edges, [2]int{leaf, x})
		deg[leaf]--; deg[x]--
		if deg[x] == 1 && x < ptr {
			leaf = x
		} else {
			ptr++
			for deg[ptr] != 1 {
				ptr++
			}
			leaf = ptr
		}
	}
	u := -1
	for v := 1; v <= n; v++ {
		if deg[v] == 1 {
			if u == -1 {
				u = v
			} else {
				edges = append(edges, [2]int{u, v})
				break
			}
		}
	}
	return edges
}
```

```java
static int[][] decodeLinear(int[] code) {
    int n = code.length + 2;
    int[] deg = new int[n + 1];
    java.util.Arrays.fill(deg, 1, n + 1, 1);
    for (int x : code) deg[x]++;
    int ptr = 1;
    while (deg[ptr] != 1) ptr++;
    int leaf = ptr;
    int[][] edges = new int[n - 1][2];
    int e = 0;
    for (int x : code) {
        edges[e][0] = leaf; edges[e][1] = x; e++;
        deg[leaf]--; deg[x]--;
        if (deg[x] == 1 && x < ptr) leaf = x;
        else { ptr++; while (deg[ptr] != 1) ptr++; leaf = ptr; }
    }
    int u = -1;
    for (int v = 1; v <= n; v++) if (deg[v] == 1) {
        if (u == -1) u = v; else { edges[e][0] = u; edges[e][1] = v; break; }
    }
    return edges;
}
```

```python
def decode_linear(code):
    n = len(code) + 2
    deg = [0] + [1] * n
    for x in code:
        deg[x] += 1
    ptr = 1
    while deg[ptr] != 1:
        ptr += 1
    leaf = ptr
    edges = []
    for x in code:
        edges.append((leaf, x))
        deg[leaf] -= 1; deg[x] -= 1
        if deg[x] == 1 and x < ptr:
            leaf = x
        else:
            ptr += 1
            while deg[ptr] != 1:
                ptr += 1
            leaf = ptr
    rem = [v for v in range(1, n + 1) if deg[v] == 1]
    edges.append((rem[0], rem[1]))
    return edges
```

## H2 — k-th labeled tree in code order

**Problem.** Codes are sequences over `1..n`; order them lexicographically (and thus the trees). Given `n` and rank `k` (0-indexed, `0 ≤ k < n^{n−2}`), return the `k`-th tree's edges.

**Example.** `n = 4`, `k = 0` → code `[1,1]` → its decoded tree.

**Hint.** Convert `k` to base-`n` with `n−2` digits (each digit + 1 gives a label), then decode.

```go
func kthTree(n int, k *big.Int) [][2]int {
	m := n - 2
	code := make([]int, m)
	base := big.NewInt(int64(n))
	cur := new(big.Int).Set(k)
	for i := m - 1; i >= 0; i-- {
		q, r := new(big.Int).DivMod(cur, base, new(big.Int))
		code[i] = int(r.Int64()) + 1
		cur = q
	}
	return decode(code)
}
```

```java
static int[][] kthTree(int n, java.math.BigInteger k) {
    int m = n - 2;
    int[] code = new int[m];
    java.math.BigInteger base = java.math.BigInteger.valueOf(n);
    for (int i = m - 1; i >= 0; i--) {
        java.math.BigInteger[] qr = k.divideAndRemainder(base);
        code[i] = qr[1].intValue() + 1;
        k = qr[0];
    }
    return Decode.decode(code);
}
```

```python
def kth_tree(n, k):
    m = n - 2
    code = [0] * m
    for i in range(m - 1, -1, -1):
        k, r = divmod(k, n)
        code[i] = r + 1
    return decode(code)
```

## H3 — Spanning trees of complete bipartite K(m,n)

**Problem.** Return `τ(K_{m,n}) = m^{n−1}·n^{m−1}` exactly, and (bonus) verify by brute force for tiny `m,n`.

**Example.** `K_{2,3} → 2^2·3^1 = 12`.

**Hint.** Big-integer powers; brute force enumerates subsets of the `m·n` edges of size `m+n−1` and checks tree-ness.

```go
func bipartiteSpanningTrees(m, n int) *big.Int {
	a := new(big.Int).Exp(big.NewInt(int64(m)), big.NewInt(int64(n-1)), nil)
	b := new(big.Int).Exp(big.NewInt(int64(n)), big.NewInt(int64(m-1)), nil)
	return a.Mul(a, b)
}
```

```java
static java.math.BigInteger bipartiteSpanningTrees(int m, int n) {
    return java.math.BigInteger.valueOf(m).pow(n - 1)
            .multiply(java.math.BigInteger.valueOf(n).pow(m - 1));
}
```

```python
def bipartite_spanning_trees(m, n):
    return m ** (n - 1) * n ** (m - 1)
```

## H4 — Most-balanced relabeling check (degree multiset)

**Problem.** Given a code, return the *multiset of degrees* of the tree, and decide whether the tree is a *caterpillar* — a tree where removing all leaves yields a path.

**Example.** `[2,3,4]` (path) → caterpillar. A "spider" with a high-degree center may or may not be.

**Hint.** Decode, then check: after deleting degree-1 vertices, the remaining graph must be a simple path (every remaining vertex has degree ≤ 2 in the induced subgraph).

```go
func isCaterpillar(code []int) bool {
	n := len(code) + 2
	edges := decode(code)
	deg := make([]int, n+1)
	adj := make([][]int, n+1)
	for _, e := range edges {
		deg[e[0]]++; deg[e[1]]++
		adj[e[0]] = append(adj[e[0]], e[1])
		adj[e[1]] = append(adj[e[1]], e[0])
	}
	isLeaf := make([]bool, n+1)
	for v := 1; v <= n; v++ {
		isLeaf[v] = deg[v] <= 1
	}
	for v := 1; v <= n; v++ {
		if isLeaf[v] {
			continue
		}
		spineDeg := 0
		for _, u := range adj[v] {
			if !isLeaf[u] {
				spineDeg++
			}
		}
		if spineDeg > 2 {
			return false
		}
	}
	return true
}
```

```java
static boolean isCaterpillar(int[] code) {
    int n = code.length + 2;
    int[][] edges = Decode.decode(code);
    int[] deg = new int[n + 1];
    java.util.List<java.util.List<Integer>> adj = new java.util.ArrayList<>();
    for (int i = 0; i <= n; i++) adj.add(new java.util.ArrayList<>());
    for (int[] e : edges) {
        deg[e[0]]++; deg[e[1]]++;
        adj.get(e[0]).add(e[1]); adj.get(e[1]).add(e[0]);
    }
    boolean[] leaf = new boolean[n + 1];
    for (int v = 1; v <= n; v++) leaf[v] = deg[v] <= 1;
    for (int v = 1; v <= n; v++) {
        if (leaf[v]) continue;
        int s = 0;
        for (int u : adj.get(v)) if (!leaf[u]) s++;
        if (s > 2) return false;
    }
    return true;
}
```

```python
def is_caterpillar(code):
    n = len(code) + 2
    edges = decode(code)
    deg = [0] * (n + 1)
    adj = [[] for _ in range(n + 1)]
    for a, b in edges:
        deg[a] += 1; deg[b] += 1
        adj[a].append(b); adj[b].append(a)
    leaf = [deg[v] <= 1 for v in range(n + 1)]
    for v in range(1, n + 1):
        if leaf[v]:
            continue
        if sum(1 for u in adj[v] if not leaf[u]) > 2:
            return False
    return True
```

## H5 — Random forest with k components

**Problem.** Generate a uniformly random labeled forest on `n` vertices with exactly `k` trees whose roots are `1..k`, using the virtual-vertex reduction.

**Constraints.** `1 ≤ k ≤ n`.

**Hint.** Add vertex `0` joined to roots `1..k`. A random such structure corresponds to a random tree on `{0,…,n}` where `0` has degree exactly `k`; sample its code with `0` appearing `k−1` times among the relevant positions, decode, then delete vertex `0` to recover the `k` components.

```go
func randomForest(n, k int, seed int64) [][2]int {
	r := rand.New(rand.NewSource(seed))
	// vertices 0..n; 0 connects to roots 1..k. Build code of length (n+1)-2 = n-1
	// where 0 appears exactly k-1 times (so deg(0)=k), rest random over {1..n}.
	m := n - 1
	code := make([]int, 0, m)
	for i := 0; i < k-1; i++ {
		code = append(code, 0)
	}
	for len(code) < m {
		code = append(code, r.Intn(n)+1) // 1..n, never 0 beyond the k-1
	}
	r.Shuffle(len(code), func(i, j int) { code[i], code[j] = code[j], code[i] })
	// decode on labels 0..n
	N := n + 1
	deg := make([]int, N)
	for v := 0; v < N; v++ {
		deg[v] = 1
	}
	for _, x := range code {
		deg[x]++
	}
	h := &IntHeap{}
	for v := 0; v < N; v++ {
		if deg[v] == 1 {
			heap.Push(h, v)
		}
	}
	var edges [][2]int
	for _, x := range code {
		leaf := heap.Pop(h).(int)
		if leaf != 0 && x != 0 {
			edges = append(edges, [2]int{leaf, x})
		}
		deg[leaf]--; deg[x]--
		if deg[x] == 1 {
			heap.Push(h, x)
		}
	}
	u := heap.Pop(h).(int)
	v := heap.Pop(h).(int)
	if u != 0 && v != 0 {
		edges = append(edges, [2]int{u, v})
	}
	return edges
}
```

```java
static int[][] randomForest(int n, int k, long seed) {
    java.util.Random r = new java.util.Random(seed);
    int m = n - 1;
    java.util.List<Integer> code = new java.util.ArrayList<>();
    for (int i = 0; i < k - 1; i++) code.add(0);
    while (code.size() < m) code.add(r.nextInt(n) + 1);
    java.util.Collections.shuffle(code, r);
    int N = n + 1;
    int[] deg = new int[N];
    java.util.Arrays.fill(deg, 1);
    for (int x : code) deg[x]++;
    java.util.PriorityQueue<Integer> pq = new java.util.PriorityQueue<>();
    for (int v = 0; v < N; v++) if (deg[v] == 1) pq.add(v);
    java.util.List<int[]> edges = new java.util.ArrayList<>();
    for (int x : code) {
        int leaf = pq.poll();
        if (leaf != 0 && x != 0) edges.add(new int[]{leaf, x});
        deg[leaf]--;
        if (--deg[x] == 1) pq.add(x);
    }
    int u = pq.poll(), v = pq.poll();
    if (u != 0 && v != 0) edges.add(new int[]{u, v});
    return edges.toArray(new int[0][]);
}
```

```python
import random, heapq
def random_forest(n, k, seed=None):
    rng = random.Random(seed)
    m = n - 1
    code = [0] * (k - 1) + [rng.randint(1, n) for _ in range(m - (k - 1))]
    rng.shuffle(code)
    N = n + 1
    deg = [1] * N
    for x in code:
        deg[x] += 1
    leaves = [v for v in range(N) if deg[v] == 1]
    heapq.heapify(leaves)
    edges = []
    for x in code:
        leaf = heapq.heappop(leaves)
        if leaf != 0 and x != 0:
            edges.append((leaf, x))
        deg[leaf] -= 1; deg[x] -= 1
        if deg[x] == 1:
            heapq.heappush(leaves, x)
    u = heapq.heappop(leaves); v = heapq.heappop(leaves)
    if u != 0 and v != 0:
        edges.append((u, v))
    return edges
```

---

# BENCHMARK TASK

## B1 — Heap vs Linear decode throughput

**Problem.** Compare the heap decoder (`O(n log n)`) against the pointer decoder (`O(n)`) across `n ∈ {10^3, 10^4, 10^5, 10^6}`. Generate a random code, decode with both, assert identical edge sets, and report timings.

**What to measure.** Wall-clock per decode (median of several runs), and the crossover where the linear version pulls ahead.

**Expected shape of results.**

| n | heap decode | linear decode | speedup |
|------|-------------|---------------|---------|
| 10³ | ~0.4 ms | ~0.1 ms | ~4× |
| 10⁴ | ~5 ms | ~1 ms | ~5× |
| 10⁵ | ~70 ms | ~12 ms | ~6× |
| 10⁶ | ~1.0 s | ~0.15 s | ~6–7× |

(Numbers are illustrative; the linear version's edge grows with `n` mostly due to cache behavior, not just the `log n` factor.)

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	for _, n := range []int{1000, 10000, 100000, 1000000} {
		code := make([]int, n-2)
		for i := range code {
			code[i] = rand.Intn(n) + 1
		}
		t0 := time.Now()
		a := decode(code) // heap
		dHeap := time.Since(t0)
		t1 := time.Now()
		b := decodeLinear(code)
		dLin := time.Since(t1)
		// sanity: same number of edges
		if len(a) != len(b) {
			panic("mismatch")
		}
		fmt.Printf("n=%-8d heap=%-12v linear=%-12v speedup=%.1fx\n",
			n, dHeap, dLin, float64(dHeap)/float64(dLin))
	}
}
```

```java
public class Bench {
    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000, 1000000};
        java.util.Random r = new java.util.Random(1);
        for (int n : sizes) {
            int[] code = new int[n - 2];
            for (int i = 0; i < code.length; i++) code[i] = r.nextInt(n) + 1;
            long t0 = System.nanoTime();
            int[][] a = Decode.decode(code);
            long heap = System.nanoTime() - t0;
            long t1 = System.nanoTime();
            int[][] b = decodeLinear(code);
            long lin = System.nanoTime() - t1;
            if (a.length != b.length) throw new RuntimeException("mismatch");
            System.out.printf("n=%-8d heap=%-10.2fms linear=%-10.2fms speedup=%.1fx%n",
                n, heap / 1e6, lin / 1e6, (double) heap / lin);
        }
    }
}
```

```python
import random, time

def bench():
    for n in (1000, 10000, 100000, 1000000):
        code = [random.randint(1, n) for _ in range(n - 2)]
        t0 = time.perf_counter(); a = decode(code); heap = time.perf_counter() - t0
        t1 = time.perf_counter(); b = decode_linear(code); lin = time.perf_counter() - t1
        assert len(a) == len(b)
        print(f"n={n:<8} heap={heap*1e3:8.2f}ms linear={lin*1e3:8.2f}ms "
              f"speedup={heap/lin:.1f}x")

if __name__ == "__main__":
    bench()
```

**Analysis prompts.**

1. At which `n` does the linear version's advantage become consistent (>2×)? Explain via cache misses, not just `log n`.
2. Replace the heap with a bucket/counting structure for leaves — does it close the gap? Why or why not?
3. Profile allocation: how much of the heap version's time is GC / boxing (Java `Integer`, Python objects) vs the array-based linear version?
4. For `n = 10^6`, measure memory: the `Set`-per-vertex encoder vs the XOR-sum encoder.

---

## Self-Check

- [ ] All easy tasks pass on `n = 6`, code `[4,4,6,3]`.
- [ ] `round_trip` holds for 10⁵ random trees on `n = 50`.
- [ ] `cayley(4) == 16`, `count_by_deg([1,2,2,1]) == 2`.
- [ ] `decode` and `decode_linear` agree on random codes.
- [ ] `bipartite_spanning_trees(2,3) == 12`.
- [ ] Benchmark shows linear decode beating heap decode at `n ≥ 10^4`.

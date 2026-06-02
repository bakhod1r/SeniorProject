# Union by Rank — Interview Preparation

Union by rank (and union by size) is a high-leverage interview topic: it is tiny to write on a whiteboard, it powers a whole family of "connectivity / grouping / equivalence" problems (provinces, accounts merge, redundant connection, smallest equivalent string), and it hides exactly the kind of subtle correctness traps — the tie-break, balancing roots not nodes, rank-as-upper-bound — that separate a candidate who pasted a template from one who understands it. This file is a graded question bank plus four end-to-end coding challenges with runnable Go, Java, and Python.

---

## Quick-Reference Cheat Sheet

| Operation | Complexity (rank/size + compression) | Note |
|-----------|--------------------------------------|------|
| `find(x)` | `O(α(n))` amortized | Compresses the path. |
| `union(a, b)` | `O(α(n))` amortized | Balances by rank or size. |
| `connected(a, b)` | `O(α(n))` amortized | `find(a) == find(b)`. |
| `componentSize(x)` | `O(α(n))` amortized | `size[find(x)]` (size variant only). |
| Build (`n` makesets) | `O(n)` | Fill `parent[i]=i`, `rank=0`/`size=1`. |
| Space | `O(n)` | `parent[]` + `rank[]`(byte) or `size[]`(int). |

```text
α(n) ≤ 4 for any n in the physical universe  →  treat as constant.
```

**The two rules beginners break:**
1. Balance the **roots**: compare `rank[find(a)]` vs `rank[find(b)]`, never `rank[a]` vs `rank[b]`.
2. Bump rank **only on a tie** (`rank[winner] += 1`). Union by size never needs a tie-break — just add sizes.

**Rank vs size in one line:** rank = upper bound on height (smallest array); size = element count (free component sizes). Both → `O(α(n))` with compression.

---

## Junior Questions (12 Q&A)

### J1. What problem does union by rank solve?
Naive `union` links roots arbitrarily and can build a chain of height `O(n)`, making `find` linear. Union by rank always attaches the shorter tree under the taller, keeping height `O(log n)` so `find`/`union` stay logarithmic even before path compression.

### J2. What is "rank"?
Rank is a small integer kept per root that is an **upper bound on the height** of its tree. It starts at 0 and is used to decide which root becomes the child during a union. It is *not* a node count.

### J3. When does rank increase?
Only on a **tie** — when the two roots being merged have equal rank. Then you pick one survivor and increment its rank by exactly 1. If one root is strictly taller, the shorter slides under it without changing any rank.

### J4. What is union by size and how does it differ from union by rank?
Union by size attaches the tree with **fewer nodes** under the tree with **more nodes**, and adds the two sizes. It needs no special tie-break (you always add) and gives you the component's element count for free via `size[find(x)]`. Rank balances by height instead and uses a smaller array.

### J5. Do rank and size give the same complexity?
Yes. Each alone bounds tree height by `O(log n)`; each combined with path compression gives amortized `O(α(n))` per operation. The difference is practical: memory and the free size metric.

### J6. What is `find` and what does it return?
`find(x)` walks up `parent` pointers until it reaches a root (a node that is its own parent) and returns that root — the representative of `x`'s set. Two elements are in the same set iff they share a root.

### J7. Why must you balance the roots, not the input nodes?
`a` and `b` may be deep inside their trees with stale ranks. The balancing decision must compare the ranks of `find(a)` and `find(b)` — the actual roots — otherwise you attach trees in the wrong direction and lose the height guarantee.

### J8. What is `α(n)` and why do we say it is "basically constant"?
`α` is the inverse Ackermann function. It grows so slowly that `α(n) ≤ 4` for any `n` you could ever store (beyond `2^65536`). So amortized `O(α(n))` per operation is, for all practical inputs, constant time.

### J9. How do you initialize a DSU of `n` elements?
Set `parent[i] = i` for all `i` (each element is its own root), and `rank[i] = 0` (or `size[i] = 1`). That is `O(n)` and done once.

### J10. How do you count connected components with a DSU?
Start a counter at `n`. Every time a `union` actually merges two *different* sets (i.e. `find(a) != find(b)`), decrement it. Skip the decrement on a no-op union.

### J11. What does union by size give you that union by rank does not?
The size of any component: `size[find(x)]` is the number of elements in `x`'s set. This is handy for "largest component," percolation thresholds, and weighted-merge heuristics.

### J12. Can you detect a cycle in an undirected graph with a DSU?
Yes. Process edges one by one; if `find(u) == find(v)` *before* unioning, the edge `(u,v)` closes a cycle. Otherwise union them.

---

## Middle Questions (12 Q&A)

### M1. Prove (informally) that union by rank keeps height `O(log n)`.
A root of rank `r` commands at least `2^r` nodes: rank only rises on a tie, merging two rank-`(r−1)` trees each with `≥ 2^{r−1}` nodes into one with `≥ 2^r`. Since `2^r ≤ n`, ranks are `≤ log₂ n`, and rank upper-bounds height, so height `≤ log₂ n`.

### M2. After path compression, is rank still the height?
No. Compression flattens trees, lowering actual heights, but we never decrement ranks. Rank becomes an **upper bound** on height, not the exact height. That is fine and intentional — the complexity proof only needs rank to be a non-decreasing label bounded by `log n`.

### M3. Why don't we fix the ranks after compression?
Recomputing exact heights after each compression would cost `O(path)` or more per operation, destroying the speedup. An upper bound is all the merge rule and the amortized analysis require, so we leave ranks alone.

### M4. Which is better, rank or size?
They are asymptotically identical. Prefer **size** when you need component counts (which is common) — that is most production code. Prefer **rank** when memory is tight (a `byte` array suffices, since max rank ≈ 64).

### M5. Walk through `union(a, b)` with union by rank.
`ra = find(a); rb = find(b)`. If equal, return. If `rank[ra] < rank[rb]`, set `parent[ra] = rb`. If `>`, set `parent[rb] = ra`. If equal, set `parent[rb] = ra` and `rank[ra] += 1`.

### M6. Walk through `union(a, b)` with union by size.
Find both roots; if equal, return. Ensure `ra` is the larger by swapping if `size[ra] < size[rb]`. Then `parent[rb] = ra` and `size[ra] += size[rb]`. No tie-break.

### M7. Why use iterative `find` instead of recursive?
On an adversarial near-chain of `10⁶` elements, recursive `find` can overflow the stack before compression has flattened anything. Iterative two-pass `find` (find root, then re-point) avoids recursion-depth limits.

### M8. How does DSU power Kruskal's MST?
Sort edges by weight. For each edge `(u,v,w)`, if `find(u) != find(v)`, add it to the MST and `union(u,v)`; otherwise skip it (it would form a cycle). The DSU is the "different components?" oracle.

### M9. What is a weighted / parity DSU?
A DSU where each edge carries a relation (an offset or a parity bit), stored as `rel[x]` = relation of `x` to its parent. `find` accumulates `rel` along the path while compressing; `union` sets the new edge's relation so the constraint holds. Used for bipartiteness checks and "value(u) − value(v) = w" queries. The balancing logic is unchanged.

### M10. When would you keep balancing but drop path compression?
When you need **rollback** (undo unions) — e.g. offline dynamic connectivity. Balanced union touches only `O(1)` nodes, so each union is trivially reversible; compression touches `O(path)` nodes and breaks cheap rollback. Height stays `O(log n)` from balancing alone.

### M11. What is the danger of bumping rank on every union?
Ranks become inflated and meaningless; the balancing decision can then attach a genuinely taller tree under a shorter one, reintroducing tall trees. Bump **only** on a tie.

### M12. How would you find the largest connected component online?
Use union by size and keep a running maximum: after each successful union, `best = max(best, size[survivingRoot])`. Answer queries in `O(1)`.

---

## Senior Questions (10 Q&A)

### S1. Why is union by size preferred over union by rank in distributed DSU?
Size is a **mergeable aggregate**: when two components merge, the new size is `Sa + Sb` (associative, commutative), which composes cleanly across shards and as a CRDT-style monotone counter. Rank carries no aggregate meaning and its tie-break is order-sensitive, so it does not merge cleanly.

### S2. Why is concurrent DSU tricky given that `find` mutates?
Path compression rewrites parent pointers during a *read*, so even `find` contends under naive locking, and a read replica that compresses lazily diverges in shape from the primary. Lock-free designs use CAS to make compression and linking safe, and snapshot the *partition* (labels), not raw `parent[]`.

### S3. Describe a lock-free union by rank.
`find` walks parents and compresses via CAS (path halving). `union` finds both roots, picks the winner by rank/size, and CASes the loser's parent from "itself" to the winner; on CAS failure (the root moved) it retries from `find`. Contention is only on the two roots, so it scales near-linearly.

### S4. What is union by random and why use it concurrently?
Each element gets a fixed random priority; the higher-priority root wins a union. No mutable `rank`/`size` to update means far fewer CAS conflicts. Expected height stays `O(log n)`. The cost: bounds are *expected* not worst-case, and you lose free component sizes.

### S5. How do you make union reversible?
Keep balanced union **without** compression and push each link (and the survivor's old size) onto a stack. `rollback()` pops and restores the child's self-parent and the parent's old size — `O(1)`, because balanced union changed only `O(1)` fields.

### S6. How do you handle a DSU larger than one machine's memory?
Shard elements by `hash(id) % S`. A component can span shards, so `find` follows parent pointers across shards via RPC. Mitigate chattiness with root caching (with epochs) and best-effort cross-shard compression. Use union by size so size metadata merges cleanly and the smaller side is re-pointed.

### S7. What metric best signals a broken DSU in production?
Average `find` path length. With compression it should sit near 1–2 hops; if it creeps up, balancing or compression is broken. Complement with `max_rank` (should stay `≤ ~log₂ n`) and `largest_component`.

### S8. What integer-overflow risk does union by size carry?
For `n > 2³¹`, repeated `size[ra] += size[rb]` can overflow a 32-bit size field, corrupting both the balance decision and the reported cardinality. Use 64-bit sizes for huge universes. Rank never overflows a byte.

### S9. Can DSU handle edge deletions?
Not directly — plain DSU only adds edges. For deletions you need offline divide-and-conquer over the timeline with a rollback DSU, or a fully dynamic connectivity structure (Holm–de Lichtenberg–Thorup, `O(log² n)`-ish), or link-cut trees.

### S10. Why is `find` returning `false` for `connected` safe to act on, but `true` permanent?
Edges are only added, so connectivity is monotone. A `false` is a correct point-in-time fact (they may connect later); a `true` is permanent. Concurrent and distributed designs exploit this monotonicity to relax consistency.

---

## Professional Questions (8 Q&A)

### P1. State the combined complexity theorem precisely.
Tarjan & van Leeuwen (1984): a sequence of `m` find/union operations on `n` elements using union by rank (or size) plus path compression (or halving/splitting) runs in `O((m+n)·α(m+n, n))` total, i.e. amortized `O(α(n))` per operation.

### P2. Sketch the potential-function proof.
Define `level(x)` and `iter(x)` on non-root nodes from the Ackermann hierarchy, and a potential `Φ(x) = (α(n) − level(x))·rank(x) − iter(x)`. Each compressed interior node either raises its `level` or its `iter`, strictly dropping its `Φ` by ≥ 1, paying for itself. Bucketing the path's nodes by `level` (of which there are `α(n)+1`) charges only `O(α(n))` nodes per operation to the operation itself; the rest are charged to their own `Φ` decrease. Summing gives `O((m+n)·α(n))`.

### P3. Which rank facts does the proof rely on, and do they survive compression?
Three: ranks start at 0; strictly increase along parent edges; at most `⌊n/2^r⌋` elements ever reach rank `r`. All three are time-stable under path compression because ranks are never decreased — which is the formal justification for "don't fix ranks."

### P4. Is `O(α(n))` tight, or could a cleverer algorithm hit `O(1)`?
Tight. Tarjan (1979) proves `Ω(α(n))` amortized in the separable pointer-machine model; Fredman & Saks (1989) prove `Ω(α(n))` in the cell-probe model. So `O(1)` amortized union-find is impossible in standard models; the inverse Ackermann factor is intrinsic.

### P5. Prove a rank-`r` root has `≥ 2^r` nodes (no compression).
Induction. Base: rank 0, one node = `2^0`. Step: rank reaches `r` only by merging two rank-`(r−1)` roots, each with `≥ 2^{r−1}` nodes by hypothesis, giving `≥ 2^r`. Hence ranks `≤ log₂ n`.

### P6. How does cache layout affect DSU performance?
Keep `parent[]` and `rank[]`/`size[]` as separate arrays (struct-of-arrays): `find` then streams only `parent[]`. A `uint8` rank packs 64 per cache line. Path halving improves locality incrementally. In concurrent DSU, pad hot roots to avoid false sharing, or use union-by-random to drop mutable balancing fields.

### P7. When can union-find be `O(1)`?
In restricted settings the lower bound's adversary can't be realized — e.g. Gabow–Tarjan (1985) interval/incremental union-find, where the union tree is known in advance, achieves `O(1)` amortized. The general bound still stands.

### P8. Compare compression-only vs balancing-only vs both.
Balancing only (rank/size, no compression): `O(log n)` worst case. Compression only (no balancing): `O(log n)` amortized. Both together: `O(α(n))` amortized — optimal. The exponent drops to `α(n)` only when both are combined.

---

## Behavioral / System-Design Questions (5)

### B1. Tell me about a time you chose a DSU over another structure.
Look for: the problem (connectivity/grouping), alternatives considered (BFS/DFS per query, adjacency + flood fill, a graph DB), the criteria (many incremental `connected?` queries, no deletions), and why amortized `O(α(n))` per query won. Strong answers cite that DSU beats per-query BFS when queries are interleaved with edge additions.

### B2. Design a service that answers "are these two accounts the same person?"
DSU keyed by account id; union on every "same person" signal. Discuss durability (a union log as source of truth, in-memory forest as a materialized view), idempotency (already-unioned is a no-op), and that connectivity is monotone so a `true` is permanent. Mention sharding by hash and using union by size so the smaller side re-points.

### B3. Design connected-component counting over a streaming graph.
Maintain a DSU plus a `components` counter decremented on real merges, and `size[root]` for the largest component. Discuss back-pressure if edges arrive faster than you can union, and a periodic snapshot of the partition labels for restart recovery.

### B4. A teammate says "let's just bump rank every union, it's simpler." How do you respond?
Explain that rank must reflect a *height bound*; bumping unconditionally inflates ranks, can attach a taller tree under a shorter one, and reintroduces `O(n)` chains. The tie-only rule is what keeps the bound. Offer union by size as the genuinely simpler alternative (no tie-break, plus free counts).

### B5. Your DSU-based job got slow after a refactor. How do you investigate?
Check `find` path length and `max_rank` first — a runaway value means balancing or the tie-break was dropped. Verify you compare `rank[find(a)]` not `rank[a]`. Confirm `find` is iterative (no stack overflow / fallback). Reproduce with the captured op sequence and add an invariant assert (`rank[parent] > rank[child]`).

---

## Coding Challenges

### Challenge 1: Full Optimized DSU (rank + path compression)

**Problem.** Implement a DSU with `find`, `union`, `connected`, and a live component count, using union by rank and iterative path compression.

**Constraints.** `1 ≤ n ≤ 10⁶`, up to `10⁶` operations, each amortized `O(α(n))`.

**Go.**

```go
package main

import "fmt"

type DSU struct {
	parent     []int
	rank       []int
	components int
}

func NewDSU(n int) *DSU {
	d := &DSU{parent: make([]int, n), rank: make([]int, n), components: n}
	for i := range d.parent {
		d.parent[i] = i
	}
	return d
}

func (d *DSU) Find(x int) int {
	root := x
	for d.parent[root] != root {
		root = d.parent[root]
	}
	for d.parent[x] != root {
		d.parent[x], x = root, d.parent[x]
	}
	return root
}

func (d *DSU) Union(a, b int) bool {
	ra, rb := d.Find(a), d.Find(b)
	if ra == rb {
		return false
	}
	if d.rank[ra] < d.rank[rb] {
		ra, rb = rb, ra
	}
	d.parent[rb] = ra
	if d.rank[ra] == d.rank[rb] {
		d.rank[ra]++
	}
	d.components--
	return true
}

func (d *DSU) Connected(a, b int) bool { return d.Find(a) == d.Find(b) }

func main() {
	d := NewDSU(5)
	d.Union(0, 1)
	d.Union(3, 4)
	d.Union(1, 4)
	fmt.Println(d.Connected(0, 3)) // true
	fmt.Println(d.components)       // 2
}
```

**Java.**

```java
public class DSU {
    int[] parent, rank;
    int components;

    DSU(int n) {
        parent = new int[n];
        rank = new int[n];
        components = n;
        for (int i = 0; i < n; i++) parent[i] = i;
    }

    int find(int x) {
        int root = x;
        while (parent[root] != root) root = parent[root];
        while (parent[x] != root) { int nx = parent[x]; parent[x] = root; x = nx; }
        return root;
    }

    boolean union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return false;
        if (rank[ra] < rank[rb]) { int t = ra; ra = rb; rb = t; }
        parent[rb] = ra;
        if (rank[ra] == rank[rb]) rank[ra]++;
        components--;
        return true;
    }

    boolean connected(int a, int b) { return find(a) == find(b); }

    public static void main(String[] args) {
        DSU d = new DSU(5);
        d.union(0, 1);
        d.union(3, 4);
        d.union(1, 4);
        System.out.println(d.connected(0, 3)); // true
        System.out.println(d.components);        // 2
    }
}
```

**Python.**

```python
class DSU:
    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n
        self.components = n

    def find(self, x):
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1
        self.components -= 1
        return True

    def connected(self, a, b):
        return self.find(a) == self.find(b)


if __name__ == "__main__":
    d = DSU(5)
    d.union(0, 1)
    d.union(3, 4)
    d.union(1, 4)
    print(d.connected(0, 3))  # True
    print(d.components)         # 2
```

---

### Challenge 2: Number of Provinces (LeetCode 547)

**Problem.** Given an `n×n` matrix `isConnected` where `isConnected[i][j] = 1` means city `i` and city `j` are directly connected, return the number of **provinces** (connected components).

**Example.** `isConnected = [[1,1,0],[1,1,0],[0,0,1]]` → `2`.

**Optimal.** Union every directly-connected pair; the answer is the live component count. `O(n²·α(n))`.

**Go.**

```go
func findCircleNum(isConnected [][]int) int {
	n := len(isConnected)
	d := NewDSU(n) // from Challenge 1
	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			if isConnected[i][j] == 1 {
				d.Union(i, j)
			}
		}
	}
	return d.components
}
```

**Java.**

```java
public int findCircleNum(int[][] isConnected) {
    int n = isConnected.length;
    DSU d = new DSU(n); // from Challenge 1
    for (int i = 0; i < n; i++)
        for (int j = i + 1; j < n; j++)
            if (isConnected[i][j] == 1) d.union(i, j);
    return d.components;
}
```

**Python.**

```python
def find_circle_num(is_connected):
    n = len(is_connected)
    d = DSU(n)  # from Challenge 1
    for i in range(n):
        for j in range(i + 1, n):
            if is_connected[i][j] == 1:
                d.union(i, j)
    return d.components
```

**Follow-up.** With size variant you can also return the largest province in the same pass.

---

### Challenge 3: Accounts Merge (LeetCode 721)

**Problem.** Each account is `[name, email1, email2, …]`. Two accounts belong to the same person if they share any email. Merge accounts: output `[name, sorted unique emails…]` per person.

**Optimal.** Map each email to an integer id; union emails that appear in the same account; group emails by root; attach the owner's name. `O(E·α + E log E)` for `E` emails (sort dominates).

**Go.**

```go
package main

import "sort"

func accountsMerge(accounts [][]string) [][]string {
	emailID := map[string]int{}
	emailName := map[string]string{}
	for _, acc := range accounts {
		name := acc[0]
		for _, e := range acc[1:] {
			if _, ok := emailID[e]; !ok {
				emailID[e] = len(emailID)
			}
			emailName[e] = name
		}
	}
	d := NewDSU(len(emailID)) // from Challenge 1
	for _, acc := range accounts {
		first := emailID[acc[1]]
		for _, e := range acc[2:] {
			d.Union(first, emailID[e])
		}
	}
	groups := map[int][]string{}
	for e, id := range emailID {
		r := d.Find(id)
		groups[r] = append(groups[r], e)
	}
	var res [][]string
	for r, emails := range groups {
		sort.Strings(emails)
		// recover the name from any email in the group
		var anyEmail string
		for e := range emailID {
			if d.Find(emailID[e]) == r {
				anyEmail = e
				break
			}
		}
		res = append(res, append([]string{emailName[anyEmail]}, emails...))
	}
	return res
}
```

**Java.**

```java
import java.util.*;

public List<List<String>> accountsMerge(List<List<String>> accounts) {
    Map<String, Integer> emailId = new HashMap<>();
    Map<String, String> emailName = new HashMap<>();
    for (List<String> acc : accounts) {
        String name = acc.get(0);
        for (int i = 1; i < acc.size(); i++) {
            emailId.putIfAbsent(acc.get(i), emailId.size());
            emailName.put(acc.get(i), name);
        }
    }
    DSU d = new DSU(emailId.size()); // from Challenge 1
    for (List<String> acc : accounts) {
        int first = emailId.get(acc.get(1));
        for (int i = 2; i < acc.size(); i++) d.union(first, emailId.get(acc.get(i)));
    }
    Map<Integer, TreeSet<String>> groups = new HashMap<>();
    for (var e : emailId.entrySet())
        groups.computeIfAbsent(d.find(e.getValue()), k -> new TreeSet<>()).add(e.getKey());
    List<List<String>> res = new ArrayList<>();
    for (var g : groups.entrySet()) {
        List<String> row = new ArrayList<>();
        String anyEmail = g.getValue().first();
        row.add(emailName.get(anyEmail));
        row.addAll(g.getValue());
        res.add(row);
    }
    return res;
}
```

**Python.**

```python
from collections import defaultdict

def accounts_merge(accounts):
    email_id, email_name = {}, {}
    for acc in accounts:
        name = acc[0]
        for e in acc[1:]:
            email_id.setdefault(e, len(email_id))
            email_name[e] = name
    d = DSU(len(email_id))  # from Challenge 1
    for acc in accounts:
        first = email_id[acc[1]]
        for e in acc[2:]:
            d.union(first, email_id[e])
    groups = defaultdict(list)
    for e, i in email_id.items():
        groups[d.find(i)].append(e)
    res = []
    for r, emails in groups.items():
        emails.sort()
        res.append([email_name[emails[0]]] + emails)
    return res
```

---

### Challenge 4: Lexicographically Smallest Equivalent String (LeetCode 1061)

**Problem.** Given `s1`, `s2` of equal length, character `s1[i]` is equivalent to `s2[i]` (equivalence is reflexive, symmetric, transitive). For a query string `baseStr`, replace each character with the **lexicographically smallest** character in its equivalence class.

**Optimal.** A 26-node DSU over letters where the **root is always the smallest letter** in its class. Union by always making the smaller letter the parent. `O((|s1| + |baseStr|)·α(26))`.

**Go.**

```go
package main

func smallestEquivalentString(s1, s2, baseStr string) string {
	parent := make([]int, 26)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	union := func(a, b int) {
		ra, rb := find(a), find(b)
		if ra == rb {
			return
		}
		if ra < rb { // keep the SMALLER letter as root
			parent[rb] = ra
		} else {
			parent[ra] = rb
		}
	}
	for i := 0; i < len(s1); i++ {
		union(int(s1[i]-'a'), int(s2[i]-'a'))
	}
	out := []byte(baseStr)
	for i := range out {
		out[i] = byte('a' + find(int(out[i]-'a')))
	}
	return string(out)
}
```

**Java.**

```java
public String smallestEquivalentString(String s1, String s2, String baseStr) {
    int[] parent = new int[26];
    for (int i = 0; i < 26; i++) parent[i] = i;
    for (int i = 0; i < s1.length(); i++)
        union(parent, s1.charAt(i) - 'a', s2.charAt(i) - 'a');
    StringBuilder sb = new StringBuilder();
    for (char c : baseStr.toCharArray())
        sb.append((char) ('a' + find(parent, c - 'a')));
    return sb.toString();
}

private int find(int[] p, int x) {
    while (p[x] != x) { p[x] = p[p[x]]; x = p[x]; }
    return x;
}

private void union(int[] p, int a, int b) {
    int ra = find(p, a), rb = find(p, b);
    if (ra == rb) return;
    if (ra < rb) p[rb] = ra; else p[ra] = rb; // smaller letter wins
}
```

**Python.**

```python
def smallest_equivalent_string(s1, s2, base_str):
    parent = list(range(26))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra == rb:
            return
        if ra < rb:           # smaller letter stays root
            parent[rb] = ra
        else:
            parent[ra] = rb

    for a, b in zip(s1, s2):
        union(ord(a) - 97, ord(b) - 97)
    return "".join(chr(97 + find(ord(c) - 97)) for c in base_str)
```

**Note.** Here the *attachment rule is "smallest letter is root,"* not rank/size — a clean example of choosing the root by a problem-specific criterion instead of by height. With only 26 nodes, height is irrelevant; correctness of the "smallest" invariant is everything.

---

## Common Pitfalls in Interviews

- **Comparing ranks of input nodes, not roots.** Use `rank[find(a)]`, not `rank[a]`. The most common silent bug.
- **Forgetting the tie-break.** On equal rank you must `rank[winner] += 1`. Without it, trees grow tall and you lose the bound — but tests on tiny inputs still pass, so it slips through.
- **Bumping rank on every union.** Inflates ranks and breaks balancing. Bump only on a tie.
- **Reading `size[x]` without `find`.** Only the root holds the correct size; use `size[find(x)]`.
- **Recursive `find` blowing the stack.** On `10⁶` adversarial elements, recurse-then-compress can overflow. Go iterative.
- **Mixing rank and size arrays.** Pick one per DSU; never compare ranks while adding sizes.
- **Decrementing the component count on a no-op union.** Only decrement when `find(a) != find(b)`.
- **Assuming you can delete edges.** Plain DSU is add-only; mention rollback or dynamic connectivity if asked.

---

## What Interviewers Are Really Testing

A union-find question is rarely about reciting the template. Interviewers probe three layers. First, **can you recognize the pattern** behind a disguised statement — "provinces," "friend circles," "accounts merge," "redundant connection," "smallest equivalent string," "number of islands II" are all DSU in costume, and spotting that is the real signal. Second, **do you understand the optimizations, not just the code** — the tie-break, balancing roots versus nodes, rank as an *upper bound* on height after compression, why we never repair ranks, and the headline `O(α(n))` with its "≤ 4 for any real input" intuition. A candidate who can explain *why* rank only rises on a tie understands the structure; one who can't merely memorized it. Third, **can you adapt the attachment rule** — sometimes you balance by rank, sometimes by size for free counts, sometimes you make "the smallest letter" or "the node with extra metadata" the root. The strongest candidates also reach for production concerns when prompted: that `find` mutates (hard to replicate/parallelize), that size overflows for huge `n`, that deletions need a different structure, and that union by size is the distributed default because size is a mergeable aggregate. Demonstrating all three layers in one small, fast-to-code structure is exactly why this topic shows up so often.

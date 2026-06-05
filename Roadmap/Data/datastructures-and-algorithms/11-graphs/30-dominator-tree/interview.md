# Dominator Tree (Lengauer-Tarjan) — Interview Preparation

Dominators are a favorite for compiler, systems, and senior algorithm interviews: the definition is one sentence ("every path passes through"), but it hides a beautiful tree structure, a near-linear algorithm built on DFS numbering and Union-Find, and deep applications in SSA and program analysis. This file is a tiered question bank, behavioral prompts, and runnable Go/Java/Python coding challenges.

---

## Quick-Reference Cheat Sheet

| Aspect | Value |
|--------|-------|
| Problem | Find `idom(v)` for every `v` in a flow graph `(V, E, r)` |
| Dominates | `u ⪰ v` iff **every** path `r ⇝ v` contains `u` |
| `idom(v)` | unique closest strict dominator |
| Dominator tree | parent of `v` is `idom(v)`; root `r` |
| Naive time | `O(V·E)` (iterative dataflow / bitset) |
| Lengauer-Tarjan | `O(E·log V)` simple, `O(E·α(V))` sophisticated |
| Space | `O(V + E)` |
| Query "u dom v?" | `u` ancestor of `v` in dom tree (`O(1)` with Euler tour) |
| Post-dominators | dominators of the **reversed** graph, exit as root |

Key building blocks: **DFS numbering → semidominators (`sdom`) → link-eval with path compression → correct `sdom` into `idom`**.

---

## Junior Questions (12 Q&A)

### J1. What does it mean for `u` to dominate `v`?
Every path from the entry `r` to `v` passes through `u`. Note "every," not "some" — a vertex on one route is not a dominator unless it is on all routes. `r` dominates everything; `v` dominates itself.

### J2. What is the immediate dominator?
`idom(v)` is the closest strict dominator of `v` — the last unavoidable vertex before `v`. It is unique because the strict dominators of `v` form a chain (total order), so there is exactly one "deepest" one.

### J3. What is the dominator tree?
The tree with an edge `idom(v) → v` for every `v ≠ r`, rooted at `r`. Since each vertex has exactly one immediate dominator, each node has one parent, so it is a tree.

### J4. How do you read domination off the tree?
`u` dominates `v` iff `u` is an ancestor of `v` in the dominator tree (including `v` itself). The global "every path" question becomes a simple tree-ancestor check.

### J5. Why is the immediate dominator unique?
Because all strict dominators of `v` lie on every `r ⇝ v` path, they appear in a consistent order on every such path, forming a chain under domination. A chain has a unique maximal (closest-to-`v`) element — that is `idom(v)`.

### J6. What is the simplest correct algorithm?
The iterative dataflow fixpoint: `Dom(r) = {r}`, `Dom(v) = {v} ∪ ⋂ Dom(p)` over predecessors `p`, iterated until stable. Then `idom(v)` is the closest strict dominator. Easy to code, `O(V·E)`-ish with bitsets.

### J7. Does the entry have an immediate dominator?
No. `r` is the root of the dominator tree; by convention `idom(r) = r` (a self-reference) or it is left undefined. Never give `r` a real parent.

### J8. Is the dominator tree the same as the DFS tree?
No. They are different trees. `idom(v)` is usually **not** the DFS parent of `v` — the immediate dominator can jump much higher when there are multiple independent paths into `v`.

### J9. What happens to unreachable vertices?
Dominance is undefined for vertices not reachable from `r`. Prune them first, or handle them specially; feeding them into the algorithm yields `idom = -1` or garbage.

### J10. Give a tiny example where `idom` is not the predecessor.
Diamond: `r→a, r→b, a→c, b→c`. Both `a` and `b` are predecessors of `c`, but neither dominates it (`r→b→c` avoids `a`). So `idom(c) = r`, not a predecessor.

### J11. What does the dominator tree being "flatter" than the CFG tell you?
A vertex whose `idom` jumps high (toward `r`) has multiple independent ways to reach it — those alternate paths mean fewer vertices are unavoidable, so its immediate dominator is far up.

### J12 (analysis). Why O(V·E) for the naive method and not worse?
With an `idom`-array representation and reverse-postorder processing, each sweep is `O(E)` (an `intersect` per edge), and the number of sweeps is bounded (small for reducible graphs). Crude set-intersection without bitsets can be `O(V²·E)`.

---

## Middle Questions (12 Q&A)

### M1. What is a semidominator?
`sdom(v)` is the smallest-DFS-number vertex `u` from which there is a path to `v` whose intermediate vertices all have DFS number larger than `v`'s. It is a computable lower bound on `idom(v)` — the core idea of Lengauer-Tarjan.

### M2. Why is `sdom(v)` only an approximation of `idom(v)`?
`idom(v)` is always a DFS-ancestor of `v` with `dfnum(idom(v)) ≤ dfnum(sdom(v))` — so `sdom` never goes *below* `idom`, but it can land above it. A correction step (the dominator theorem) fixes `sdom` into the exact `idom`.

### M3. What are the four phases of Lengauer-Tarjan?
(1) DFS + numbering; (2) compute `sdom` for each vertex in decreasing DFS-number order using predecessors and `EVAL`; (3) bucket vertices under their `sdom` and tentatively set `idom`; (4) a forward pass that finalizes deferred `idom`s.

### M4. What do LINK and EVAL do?
They maintain a forest mirroring the DFS tree, built bottom-up. `LINK(parent, w)` attaches `w`'s tree to its parent. `EVAL(v)` returns the vertex of minimum `sdom` on the path from `v` to its current tree root — the "best ancestor so far."

### M5. Why does path compression make it near-linear?
`EVAL` walks tree paths; done naively that is `O(depth)` per call → `O(V·E)`. Path compression flattens the paths (Union-Find style), so the amortized cost of all LINK/EVAL ops is `O(E·log V)` with compression alone, `O(E·α(V))` with balanced linking.

### M6. How do you turn `sdom` into `idom`?
Let `u = EVAL(v)` (min-`sdom` vertex on `v`'s path). If `sdom(u) == sdom(v)`, then `idom(v) = sdom(v)`. Otherwise `idom(v) = idom(u)`, resolved in a forward pass once `u`'s `idom` is final.

### M7. When do you prefer iterative dataflow over Lengauer-Tarjan?
On **reducible** CFGs (almost all structured source code). Iterative dataflow in reverse postorder converges in 2–3 sweeps and its tiny constant beats Lengauer-Tarjan on wall-clock. LLVM ships a hybrid (Semi-NCA), not classic Lengauer-Tarjan, for this reason.

### M8. When must you use Lengauer-Tarjan / Semi-NCA?
On irreducible graphs (machine-generated code, decompiled binaries) or in latency-critical contexts (a JIT) where you need a hard `O(E·α(V))` worst-case guarantee rather than the iterative method's `O(V·E)` worst case.

### M9. How do you compute post-dominators?
Run the exact same dominator algorithm on the **reversed graph** with the **exit** as root. No second algorithm — `post-idom(v)` = `idom` of `v` in the reversed CFG. Add a synthetic unique exit if the CFG has multiple exits.

### M10. What is the dominance frontier and why does it matter?
`DF(u)` = blocks `w` where `u` dominates a predecessor of `w` but not `w` itself — the merge points where `u`'s influence ends. It is exactly where SSA φ-functions go for a variable defined in `u`.

### M11. How does SSA construction use the dominator tree?
Build the dom tree → compute dominance frontiers → place φ-functions at iterated dominance frontiers of each variable's definitions → rename variables in a **dominator-tree preorder** walk. The preorder property is what makes renaming a single correct pass.

### M12 (analysis). Why does reverse postorder speed up the iterative algorithm?
Processing vertices in reverse postorder means a vertex is usually updated after its dominators are settled, so information flows forward in one sweep. The number of sweeps is bounded by the graph's loop-connectedness + 2, which is small for reducible graphs.

---

## Senior Questions (10 Q&A)

### S1. How is the dominator tree consumed in a compiler?
As a shared, read-mostly index: SSA construction (φ placement), natural-loop detection (back edges + headers), dominator-based GVN/CSE, LICM, and — via the reversed graph — post-dominators for control dependence. Almost every optimization queries `dominates(a,b)` or nearest common dominator.

### S2. How do you make domination queries O(1)?
Preprocess the dominator tree with an Euler-tour DFS assigning in/out times; then `dominates(a,b)` is the interval check `tin[a] ≤ tin[b] && tout[b] ≤ tout[a]`. Nearest common dominator (LCA) becomes `O(1)` with a sparse table.

### S3. How do you keep the dominator tree consistent as passes mutate the CFG?
Pass-manager preserve/invalidate flags: a pass declares whether it preserves dominators; if not, the tree is invalidated and rebuilt lazily before the next consumer. For edit-heavy passes, batch all edits then rebuild once, or use an incremental `DomTreeUpdater`.

### S4. Insertions vs deletions for incremental dominators — which is easier?
Insertions are easier: adding an edge can only move some `idom`s **up** toward the root (to the nearest common dominator of the old `idom` and the new path). Deletions are harder and may push `idom`s down; fully-dynamic dominators are research-grade.

### S5. How do you detect natural loops with dominators?
A back edge is `t → h` where `h` dominates `t` (`h` is the loop header). The natural loop is `{h}` plus all vertices that reach `t` without passing through `h`. Dominance is the *definition* of the back edge — you cannot identify headers correctly without it.

### S6. What is control dependence and how do dominators give it?
`v` is control-dependent on branch `b` iff `v` post-dominates a successor of `b` but not `b` itself. Computed from the post-dominator tree (dominators of the reversed CFG) and the post-dominance frontier. It builds the control-dependence half of the Program Dependence Graph.

### S7. Why ship a debug verifier alongside the fast algorithm?
The fast algorithms are bug-prone, and a wrong or stale dominator tree is a **silent miscompile**, not a crash. A debug-only oracle (recompute `idom` with the trivial iterative method, or assert structural invariants) on every CI graph catches these before production.

### S8. The CFG has multiple exits. What breaks for post-dominators?
The reversed graph has no single root, so post-dominators are ill-defined. Add a synthetic unique exit with edges from every real exit (and from exitless infinite-loop headers), making the reversed graph single-rooted.

### S9. How does the inverse Ackermann function enter the complexity?
The link-eval forest with **balanced linking + path compression** is a Union-Find-style structure; its amortized cost over `O(E)` operations is `O(E·α(V))`. `α(V) ≤ 4` for any realistic `V`, so the algorithm is linear for practical purposes.

### S10 (analysis). Why can the theoretically-better Lengauer-Tarjan lose to iterative dataflow in practice?
Asymptotics vs constants. On reducible CFGs the iterative method needs few sweeps, each a branch-light, cache-friendly `O(E)` pass, while Lengauer-Tarjan pays for bucket lists, the link-eval forest, and path-compression recursion. The cube-vs-constant lesson: pick by worst-case guarantee needs, not Big-O alone.

---

## Professional Questions (8 Q&A)

### P1. State and justify the semidominator definition.
`sdom(v)` = min `dfnum` vertex `u` with a path `u ⇝ v` whose intermediates all have `dfnum > dfnum(v)`. By the Path Lemma, such `u` is a DFS-ancestor of `v`, and one proves `idom(v)` is a DFS-ancestor with `dfnum(idom(v)) ≤ dfnum(sdom(v))` — so `sdom` is a valid lower bound to be corrected to `idom`.

### P2. State the Dominator Theorem.
Let `u` be the min-`sdom` vertex on the DFS-path from `sdom(v)` (exclusive) to `v`. If `sdom(u) == sdom(v)`, then `idom(v) = sdom(v)` (Rule 1); otherwise `idom(v) = idom(u)` (Rule 2). Rule-2 cases are finalized in a forward pass via `idom(v) = idom(idom(v))`.

### P3. Why is the immediate dominator unique (formal)?
The strict dominators of `v` are totally ordered by domination (any two both lie on every `r ⇝ v` path, so one dominates the other — else you could splice a path avoiding one). A finite chain has a unique closest element to `v`, which is `idom(v)`.

### P4. Prove the iterative dataflow algorithm is correct.
The equations `Dom(v) = {v} ∪ ⋂ Dom(p)` are monotone over the subset lattice (meet = ∩) of finite height, so iteration from `Dom = V` converges to the greatest fixpoint. Soundness: true dominators survive every intersection. Completeness: a non-dominator has an avoiding path that removes it during iteration. (Kildall framework.)

### P5. Give the complexity of the link-eval phase.
`O(E)` LINK/EVAL operations on `V` elements. With path compression only, amortized `O(E·log V)`; with balanced linking (union by size), `O(E·α(V))`. Total including DFS and the bucket/finalize passes is the same, with `O(V+E)` space.

### P6. What is the iterated dominance frontier and its role?
`DF⁺(S)` is the least fixpoint of `DF⁺(S) = DF(S ∪ DF⁺(S))`. By Cytron et al., the minimal φ-placement for variable `x` is `DF⁺(D_x ∪ {r})` where `D_x` are `x`'s definition sites. This is the formal SSA payoff of the dominator tree.

### P7. Is there a truly linear dominator algorithm?
Yes — Buchsbaum, Kaplan, Rogers & Westbrook (1998/2008) give `O(V+E)` via microtree/macrotree decomposition, removing even the `α(V)` factor. It is rarely implemented because Lengauer-Tarjan and Semi-NCA are already fast enough and far simpler.

### P8 (analysis). How do dominators yield directed 2-connectivity?
Georgiadis-Italiano et al. compute strong-bridges and strong-articulation points (directed 2-edge/2-vertex connectivity) in linear time using the dominator trees of `G` and its reverse: a vertex is a strong articulation point iff it is a non-trivial dominator in one of the two trees. Dominators turn a connectivity question into ancestry queries.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you used a dominator-based analysis.
Look for a concrete story: a compiler/IR pass (SSA, loop opt, dead-code), the reason dominators were the right structure (needed "always runs before" / "unavoidable" reasoning), the algorithm chosen (iterative vs Lengauer-Tarjan) and why, and how correctness was verified (oracle/verifier).

### B2. Design the dominator-tree component of an optimizing compiler.
Build it as an analysis result with preserve/invalidate flags; default to a fast Semi-NCA/iterative algorithm; preprocess Euler-tour in/out numbers for `O(1)` `dominates`; reuse the same code on the reversed CFG for post-dominators; ship a debug verifier. Discuss invalidation policy as the dominant cost lever.

### B3. Your optimizer occasionally miscompiles after a CFG transform. Diagnose.
Almost certainly a **stale dominator tree**: a pass edited the CFG without invalidating dominance, and a later pass hoisted/sank an instruction past a block that no longer dominates. Fix with pass-manager invalidation discipline and a debug verifier; add a regression test on the offending CFG.

### B4. A junior asks "isn't reachability enough? why dominators?" How do you answer?
Reachability says "can I get from `r` to `v`." Dominators say "what can I never *avoid* on the way." Optimizations and slicing need the stronger "always happens before / unavoidable" relation — e.g. you can only hoist code to a block that dominates all uses. Reachability cannot express that.

### B5. The compiler is spending too long in dominator computation. Investigate.
The driver is usually **rebuild count**, not per-build cost (already near-linear). Check rebuilds-per-function vs CFG-edit count; coarse invalidation rebuilds the tree many times unnecessarily. Fix invalidation granularity, batch edits, or use incremental updates for hot passes. Only then consider algorithm swaps.

---

## Coding Challenges

### Challenge 1: Build the Dominator Tree (Lengauer-Tarjan)

**Problem.** Given a flow graph with `n` vertices (`0..n-1`), an entry `r`, and a list of directed edges, return `idom[v]` for every vertex (`idom[r] = r`, unreachable vertices `-1`).

**Approach.** Run the simple `O(E log V)` Lengauer-Tarjan: DFS numbering, semidominators via link-eval with path compression, then correct `sdom` to `idom`.

**Go.**

```go
package main

import "fmt"

func computeIdom(n int, edges [][2]int, r int) []int {
	succ := make([][]int, n)
	pred := make([][]int, n)
	for _, e := range edges {
		succ[e[0]] = append(succ[e[0]], e[1])
		pred[e[1]] = append(pred[e[1]], e[0])
	}
	dfnum := make([]int, n)
	vertex := make([]int, n)
	parent := make([]int, n)
	semi := make([]int, n)
	idom := make([]int, n)
	ancestor := make([]int, n)
	label := make([]int, n)
	bucket := make([][]int, n)
	for i := 0; i < n; i++ {
		semi[i] = -1
		ancestor[i] = -1
		label[i] = i
	}
	cnt := 0
	var dfs func(u int)
	dfs = func(u int) {
		semi[u] = cnt
		vertex[cnt] = u
		cnt++
		for _, v := range succ[u] {
			if semi[v] == -1 {
				parent[v] = u
				dfs(v)
			}
		}
	}
	dfs(r)
	var compress func(v int)
	compress = func(v int) {
		if ancestor[ancestor[v]] != -1 {
			compress(ancestor[v])
			if semi[label[ancestor[v]]] < semi[label[v]] {
				label[v] = label[ancestor[v]]
			}
			ancestor[v] = ancestor[ancestor[v]]
		}
	}
	eval := func(v int) int {
		if ancestor[v] == -1 {
			return v
		}
		compress(v)
		return label[v]
	}
	res := make([]int, n)
	for i := range res {
		res[i] = -1
	}
	for i := cnt - 1; i >= 1; i-- {
		w := vertex[i]
		for _, v := range pred[w] {
			if semi[v] == -1 {
				continue
			}
			u := eval(v)
			if semi[u] < semi[w] {
				semi[w] = semi[u]
			}
		}
		bucket[vertex[semi[w]]] = append(bucket[vertex[semi[w]]], w)
		ancestor[w] = parent[w]
		pw := parent[w]
		for _, v := range bucket[pw] {
			u := eval(v)
			if semi[u] < semi[v] {
				idom[v] = u
			} else {
				idom[v] = pw
			}
		}
		bucket[pw] = nil
	}
	for i := 1; i < cnt; i++ {
		w := vertex[i]
		if idom[w] != vertex[semi[w]] {
			idom[w] = idom[idom[w]]
		}
		res[w] = idom[w]
	}
	res[r] = r
	return res
}

func main() {
	edges := [][2]int{{0, 1}, {0, 2}, {1, 3}, {2, 3}, {3, 4}, {3, 5}, {4, 5}}
	fmt.Println(computeIdom(6, edges, 0)) // [0 0 0 0 3 3]
}
```

**Java.**

```java
import java.util.*;

public class DominatorTree {
    int cnt = 0;
    int[] vertex, parent, semi, idom, ancestor, label;
    List<List<Integer>> succ, pred, bucket;

    int[] computeIdom(int n, int[][] edges, int r) {
        succ = new ArrayList<>(); pred = new ArrayList<>(); bucket = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            succ.add(new ArrayList<>()); pred.add(new ArrayList<>()); bucket.add(new ArrayList<>());
        }
        for (int[] e : edges) { succ.get(e[0]).add(e[1]); pred.get(e[1]).add(e[0]); }
        vertex = new int[n]; parent = new int[n]; semi = new int[n];
        idom = new int[n]; ancestor = new int[n]; label = new int[n];
        Arrays.fill(semi, -1); Arrays.fill(ancestor, -1); Arrays.fill(idom, -1);
        for (int i = 0; i < n; i++) label[i] = i;
        dfs(r);
        for (int i = cnt - 1; i >= 1; i--) {
            int w = vertex[i];
            for (int v : pred.get(w)) {
                if (semi[v] == -1) continue;
                int u = eval(v);
                if (semi[u] < semi[w]) semi[w] = semi[u];
            }
            bucket.get(vertex[semi[w]]).add(w);
            ancestor[w] = parent[w];
            int pw = parent[w];
            for (int v : bucket.get(pw)) {
                int u = eval(v);
                idom[v] = (semi[u] < semi[v]) ? u : pw;
            }
            bucket.get(pw).clear();
        }
        int[] res = new int[n];
        Arrays.fill(res, -1);
        for (int i = 1; i < cnt; i++) {
            int w = vertex[i];
            if (idom[w] != vertex[semi[w]]) idom[w] = idom[idom[w]];
            res[w] = idom[w];
        }
        res[r] = r;
        return res;
    }

    void dfs(int u) {
        semi[u] = cnt; vertex[cnt] = u; cnt++;
        for (int v : succ.get(u)) if (semi[v] == -1) { parent[v] = u; dfs(v); }
    }

    void compress(int v) {
        if (ancestor[ancestor[v]] != -1) {
            compress(ancestor[v]);
            if (semi[label[ancestor[v]]] < semi[label[v]]) label[v] = label[ancestor[v]];
            ancestor[v] = ancestor[ancestor[v]];
        }
    }

    int eval(int v) {
        if (ancestor[v] == -1) return v;
        compress(v);
        return label[v];
    }

    public static void main(String[] args) {
        int[][] edges = {{0,1},{0,2},{1,3},{2,3},{3,4},{3,5},{4,5}};
        System.out.println(Arrays.toString(new DominatorTree().computeIdom(6, edges, 0)));
        // [0, 0, 0, 0, 3, 3]
    }
}
```

**Python.**

```python
import sys


def compute_idom(n, edges, r):
    sys.setrecursionlimit(1 << 20)
    succ = [[] for _ in range(n)]
    pred = [[] for _ in range(n)]
    for u, v in edges:
        succ[u].append(v)
        pred[v].append(u)
    vertex = [0] * n
    parent = [0] * n
    semi = [-1] * n
    idom = [-1] * n
    ancestor = [-1] * n
    label = list(range(n))
    bucket = [[] for _ in range(n)]
    cnt = 0

    def dfs(start):
        nonlocal cnt
        stack = [start]
        semi[start] = cnt
        vertex[cnt] = start
        cnt += 1
        seen = {start}
        order = [start]
        while order:
            u = order.pop()
            for v in succ[u]:
                if v not in seen:
                    seen.add(v)
                    parent[v] = u
                    semi[v] = cnt
                    vertex[cnt] = v
                    cnt += 1
                    order.append(v)

    def compress(v):
        if ancestor[ancestor[v]] != -1:
            compress(ancestor[v])
            if semi[label[ancestor[v]]] < semi[label[v]]:
                label[v] = label[ancestor[v]]
            ancestor[v] = ancestor[ancestor[v]]

    def eval_(v):
        if ancestor[v] == -1:
            return v
        compress(v)
        return label[v]

    dfs(r)
    for i in range(cnt - 1, 0, -1):
        w = vertex[i]
        for v in pred[w]:
            if semi[v] == -1:
                continue
            u = eval_(v)
            if semi[u] < semi[w]:
                semi[w] = semi[u]
        bucket[vertex[semi[w]]].append(w)
        ancestor[w] = parent[w]
        pw = parent[w]
        for v in bucket[pw]:
            u = eval_(v)
            idom[v] = u if semi[u] < semi[v] else pw
        bucket[pw] = []
    res = [-1] * n
    for i in range(1, cnt):
        w = vertex[i]
        if idom[w] != vertex[semi[w]]:
            idom[w] = idom[idom[w]]
        res[w] = idom[w]
    res[r] = r
    return res


if __name__ == "__main__":
    edges = [(0, 1), (0, 2), (1, 3), (2, 3), (3, 4), (3, 5), (4, 5)]
    print(compute_idom(6, edges, 0))  # [0, 0, 0, 0, 3, 3]
```

**Follow-up.** How would you verify this? Cross-check against the trivial iterative dataflow oracle on thousands of random CFGs (differential testing).

---

### Challenge 2: Does `u` Always Run Before `v`? (Domination Query)

**Problem.** Given a CFG and many `(u, v)` queries, answer whether `u` is guaranteed to execute before `v` on every run — i.e. whether `u` dominates `v`. Preprocess for `O(1)` queries.

**Approach.** Compute `idom`, then Euler-tour the dominator tree for in/out times; `dominates(u, v)` is an interval-containment check.

**Go.**

```go
package main

import "fmt"

func dominationQueries(n int, edges [][2]int, r int, queries [][2]int) []bool {
	idom := computeIdom(n, edges, r) // from Challenge 1
	children := make([][]int, n)
	for v := 0; v < n; v++ {
		if v != r && idom[v] != -1 {
			children[idom[v]] = append(children[idom[v]], v)
		}
	}
	tin := make([]int, n)
	tout := make([]int, n)
	timer := 0
	type frame struct{ u, ci int }
	stack := []frame{{r, 0}}
	tin[r] = timer
	timer++
	for len(stack) > 0 {
		f := &stack[len(stack)-1]
		if f.ci < len(children[f.u]) {
			c := children[f.u][f.ci]
			f.ci++
			tin[c] = timer
			timer++
			stack = append(stack, frame{c, 0})
		} else {
			tout[f.u] = timer
			timer++
			stack = stack[:len(stack)-1]
		}
	}
	out := make([]bool, len(queries))
	for i, q := range queries {
		u, v := q[0], q[1]
		out[i] = tin[u] <= tin[v] && tout[v] <= tout[u]
	}
	return out
}

func main() {
	edges := [][2]int{{0, 1}, {0, 2}, {1, 3}, {2, 3}, {3, 4}, {3, 5}, {4, 5}}
	qs := [][2]int{{3, 5}, {1, 5}, {0, 4}}
	fmt.Println(dominationQueries(6, edges, 0, qs)) // [true false true]
}
```

**Java.**

```java
import java.util.*;

public class DominationQuery {
    public boolean[] dominationQueries(int n, int[][] edges, int r, int[][] queries) {
        int[] idom = new DominatorTree().computeIdom(n, edges, r); // Challenge 1
        List<List<Integer>> children = new ArrayList<>();
        for (int i = 0; i < n; i++) children.add(new ArrayList<>());
        for (int v = 0; v < n; v++)
            if (v != r && idom[v] != -1) children.get(idom[v]).add(v);
        int[] tin = new int[n], tout = new int[n];
        int[] timer = {0};
        Deque<int[]> stack = new ArrayDeque<>();
        tin[r] = timer[0]++;
        stack.push(new int[]{r, 0});
        while (!stack.isEmpty()) {
            int[] f = stack.peek();
            int u = f[0];
            if (f[1] < children.get(u).size()) {
                int c = children.get(u).get(f[1]++);
                tin[c] = timer[0]++;
                stack.push(new int[]{c, 0});
            } else {
                tout[u] = timer[0]++;
                stack.pop();
            }
        }
        boolean[] out = new boolean[queries.length];
        for (int i = 0; i < queries.length; i++) {
            int u = queries[i][0], v = queries[i][1];
            out[i] = tin[u] <= tin[v] && tout[v] <= tout[u];
        }
        return out;
    }

    public static void main(String[] args) {
        int[][] edges = {{0,1},{0,2},{1,3},{2,3},{3,4},{3,5},{4,5}};
        int[][] qs = {{3,5},{1,5},{0,4}};
        System.out.println(Arrays.toString(
            new DominationQuery().dominationQueries(6, edges, 0, qs))); // [true, false, true]
    }
}
```

**Python.**

```python
def domination_queries(n, edges, r, queries):
    idom = compute_idom(n, edges, r)  # from Challenge 1
    children = [[] for _ in range(n)]
    for v in range(n):
        if v != r and idom[v] != -1:
            children[idom[v]].append(v)
    tin = [0] * n
    tout = [0] * n
    timer = 0
    stack = [(r, iter(children[r]))]
    tin[r] = timer
    timer += 1
    while stack:
        u, it = stack[-1]
        for c in it:
            tin[c] = timer
            timer += 1
            stack.append((c, iter(children[c])))
            break
        else:
            tout[u] = timer
            timer += 1
            stack.pop()
    return [tin[u] <= tin[v] and tout[v] <= tout[u] for u, v in queries]


if __name__ == "__main__":
    edges = [(0, 1), (0, 2), (1, 3), (2, 3), (3, 4), (3, 5), (4, 5)]
    qs = [(3, 5), (1, 5), (0, 4)]
    print(domination_queries(6, edges, 0, qs))  # [True, False, True]
```

**Follow-up.** This is exactly the "available expression can be reused" check in GVN, and the SPOF check in a single-source network — same query, different domain.

---

### Challenge 3: Find Single Points of Failure (Dominator-Based Reliability)

**Problem.** A service receives all traffic at ingress `r` and routes it through a directed graph of nodes. A node `x ≠ r` is a **single point of failure (SPOF)** if removing it disconnects some node from `r`. Return all SPOFs. (A node is a SPOF iff it strictly dominates at least one other node.)

**Approach.** Compute `idom`. Any vertex that appears as `idom[v]` for some `v ≠ that vertex` (and `v ≠ r`) is a SPOF — it has children in the dominator tree, meaning it is unavoidable for them.

**Go.**

```go
package main

import (
	"fmt"
	"sort"
)

func singlePointsOfFailure(n int, edges [][2]int, r int) []int {
	idom := computeIdom(n, edges, r) // Challenge 1
	isSPOF := make([]bool, n)
	for v := 0; v < n; v++ {
		if v != r && idom[v] != -1 && idom[v] != r {
			// idom[v] is unavoidable for v -> it's a SPOF (excluding the entry)
			isSPOF[idom[v]] = true
		}
	}
	var res []int
	for v := 0; v < n; v++ {
		if isSPOF[v] {
			res = append(res, v)
		}
	}
	sort.Ints(res)
	return res
}

func main() {
	// r=0; node 3 is unavoidable for 4 and 5 -> SPOF
	edges := [][2]int{{0, 1}, {0, 2}, {1, 3}, {2, 3}, {3, 4}, {3, 5}, {4, 5}}
	fmt.Println(singlePointsOfFailure(6, edges, 0)) // [3]
}
```

**Java.**

```java
import java.util.*;

public class SPOF {
    public List<Integer> singlePointsOfFailure(int n, int[][] edges, int r) {
        int[] idom = new DominatorTree().computeIdom(n, edges, r); // Challenge 1
        boolean[] isSPOF = new boolean[n];
        for (int v = 0; v < n; v++)
            if (v != r && idom[v] != -1 && idom[v] != r)
                isSPOF[idom[v]] = true;
        List<Integer> res = new ArrayList<>();
        for (int v = 0; v < n; v++) if (isSPOF[v]) res.add(v);
        return res;
    }

    public static void main(String[] args) {
        int[][] edges = {{0,1},{0,2},{1,3},{2,3},{3,4},{3,5},{4,5}};
        System.out.println(new SPOF().singlePointsOfFailure(6, edges, 0)); // [3]
    }
}
```

**Python.**

```python
def single_points_of_failure(n, edges, r):
    idom = compute_idom(n, edges, r)  # Challenge 1
    is_spof = [False] * n
    for v in range(n):
        if v != r and idom[v] != -1 and idom[v] != r:
            is_spof[idom[v]] = True
    return [v for v in range(n) if is_spof[v]]


if __name__ == "__main__":
    edges = [(0, 1), (0, 2), (1, 3), (2, 3), (3, 4), (3, 5), (4, 5)]
    print(single_points_of_failure(6, edges, 0))  # [3]
```

**Follow-up.** For *both-direction* resilience (strong articulation points in a strongly connected service mesh), compute dominator trees of both `G` and its reverse and combine — the Italiano-Georgiadis linear-time 2-connectivity result.

---

## Common Pitfalls in Interviews

- **"Some path" instead of "every path."** The defining error. A vertex on one route is not a dominator.
- **Confusing the DFS tree with the dominator tree.** `idom(v)` is usually not the DFS parent.
- **Comparing vertex ids instead of DFS/RPO numbers** in `intersect`/`EVAL`. Produces wrong `idom` on diamonds.
- **Forgetting reachability.** Unreachable vertices have undefined dominators.
- **Recursive DFS on deep graphs.** Stack overflow; use an explicit stack in production.
- **Renaming SSA in CFG order, not dominator-tree preorder.** Silent SSA correctness bug.
- **Forking a separate post-dominator algorithm.** Reuse the dominator code on the reversed graph.
- **Stale dominator tree after CFG edits.** Silent miscompile; enforce invalidation.

---

## What Interviewers Are Really Testing

A dominator question rarely checks rote recall of Lengauer-Tarjan. It probes three things. First, **conceptual precision**: can you state "every path passes through," explain why `idom` is unique (the chain argument), and read domination as tree ancestry? That clarity separates understanding from memorization. Second, **algorithm maturity**: do you know the semidominator idea, why path compression buys near-linearity, and — crucially — *when the simple iterative method beats the fancy one* on real reducible CFGs? Picking Lengauer-Tarjan reflexively without justifying it is a yellow flag; knowing LLVM ships a hybrid is a green one. Third, **applications and systems sense**: SSA φ-placement via dominance frontiers, natural-loop detection, post-dominators for control dependence, and the production realities (Euler-tour `O(1)` queries, invalidation discipline, debug verifiers, SPOF analysis). The strongest candidates connect the one-sentence definition to the compiler that runs their code and to fine-grained results like directed 2-connectivity — demonstrating depth across theory, engineering, and applications in a single conversation.

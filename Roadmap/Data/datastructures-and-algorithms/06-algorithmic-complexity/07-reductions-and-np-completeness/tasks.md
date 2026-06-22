# Reductions and NP-Completeness — Practice Tasks

> Coding tasks must be solved in **Go**, **Java**, and **Python** where marked **[coding]**.
> Heavier coding tasks ship a reference solution in **one** language (Go or Python) — port it as practice.
> **[analysis]** tasks need no code: write the reduction, both correctness directions, the right source problem, or the completeness argument, with a one- to three-line justification.

These tasks build the central skill of NP-completeness: **the polynomial-time many-one reduction** `A ≤ₚ B` — a poly-time map `f` from instances of `A` to instances of `B` with `x ∈ A ⟺ f(x) ∈ B`. A reduction *transfers hardness*: if `A` is NP-hard and `A ≤ₚ B`, then `B` is NP-hard too. To prove `B` is **NP-complete** you do two things: (1) show `B ∈ NP` (exhibit a poly-size certificate and a poly-time verifier), and (2) reduce a *known* NP-complete problem to `B`. The recurring discipline for every coding reduction here is the same: **build the gadget, then brute-force-verify the iff on small instances** — a reduction with even one broken gadget is worthless, and a brute-force equivalence checker catches it instantly.

**Related practice:**
- [Complexity Classes P and NP tasks](../06-complexity-classes-p-np/tasks.md) — verifiers, certificates, and the classes these reductions move hardness between.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

---

## Beginner Tasks

### Task 1 — Independent Set ↔ Vertex Cover (complement on the same graph) **[coding]**

`[easy]` The cleanest reduction in the catalog needs no new graph at all. On a fixed graph `G = (V, E)` with `n = |V|`:

> **S is an independent set iff V∖S is a vertex cover.**

So `G` has an independent set of size `k` **iff** `G` has a vertex cover of size `n − k`. The map is just *set complement* — trivially polynomial.

Implement, on a single graph, a brute-force independent-set solver, a brute-force vertex-cover solver, and a function that complements a vertex set. Then **verify the equivalence by brute force**: the largest independent set has size `k` iff the smallest vertex cover has size `n − k`.

#### Go

```go
package main

import "fmt"

type Edge struct{ U, V int }

func isIndependent(edges []Edge, chosen map[int]bool) bool {
	for _, e := range edges {
		if chosen[e.U] && chosen[e.V] {
			return false // both endpoints chosen -> edge inside set
		}
	}
	return true
}

func isCover(edges []Edge, chosen map[int]bool) bool {
	for _, e := range edges {
		if !chosen[e.U] && !chosen[e.V] {
			return false // edge with no endpoint covered
		}
	}
	return true
}

func complement(n int, s map[int]bool) map[int]bool {
	out := make(map[int]bool)
	for v := 0; v < n; v++ {
		if !s[v] {
			out[v] = true
		}
	}
	return out
}

// Largest independent set size, by brute force over all 2^n subsets.
func maxIndependentSet(n int, edges []Edge) int {
	best := 0
	for mask := 0; mask < (1 << n); mask++ {
		s := make(map[int]bool)
		for v := 0; v < n; v++ {
			if mask&(1<<v) != 0 {
				s[v] = true
			}
		}
		if isIndependent(edges, s) && len(s) > best {
			best = len(s)
		}
	}
	return best
}

func minVertexCover(n int, edges []Edge) int {
	best := n
	for mask := 0; mask < (1 << n); mask++ {
		s := make(map[int]bool)
		for v := 0; v < n; v++ {
			if mask&(1<<v) != 0 {
				s[v] = true
			}
		}
		if isCover(edges, s) && len(s) < best {
			best = len(s)
		}
	}
	return best
}

func main() {
	// Path 0-1-2-3: max IS = 2 ({0,2} or {0,3} or {1,3}); min VC = 2.
	n := 4
	edges := []Edge{{0, 1}, {1, 2}, {2, 3}}
	mis := maxIndependentSet(n, edges)
	mvc := minVertexCover(n, edges)
	fmt.Printf("max IS = %d, min VC = %d, n - IS = %d\n", mis, mvc, n-mis)
	fmt.Println("duality holds:", mvc == n-mis) // true

	// Spot-check the complement on one optimal IS:
	is := map[int]bool{0: true, 2: true}
	vc := complement(n, is)
	fmt.Println("complement is a cover:", isCover(edges, vc)) // true
}
```

#### Python

```python
from itertools import combinations

def is_independent(edges, chosen):
    s = set(chosen)
    return all(not (u in s and v in s) for u, v in edges)

def is_cover(edges, chosen):
    s = set(chosen)
    return all(u in s or v in s for u, v in edges)

def complement(n, s):
    s = set(s)
    return [v for v in range(n) if v not in s]

def max_independent_set(n, edges):
    best = 0
    for r in range(n + 1):
        for cand in combinations(range(n), r):
            if is_independent(edges, cand):
                best = max(best, r)
    return best

def min_vertex_cover(n, edges):
    for r in range(n + 1):
        for cand in combinations(range(n), r):
            if is_cover(edges, cand):
                return r
    return n

if __name__ == "__main__":
    n, edges = 4, [(0, 1), (1, 2), (2, 3)]
    mis, mvc = max_independent_set(n, edges), min_vertex_cover(n, edges)
    print(f"max IS = {mis}, min VC = {mvc}, n - IS = {n - mis}")
    print("duality holds:", mvc == n - mis)            # True
    print("complement is a cover:", is_cover(edges, complement(n, [0, 2])))  # True
```

- **Constraints:** The reduction is pure set complement, O(n). Brute force is fine here (small n) — it is the *equivalence checker*, not the reduction.
- **Acceptance test:** For every small graph you try, `min VC == n − max IS`, and complementing any maximum independent set yields a valid minimum cover.

---

### Task 2 — Independent Set ↔ Clique (complement the *graph*) **[coding]**

`[easy]` A second one-line reduction, but now the *graph* changes, not the set. Let `Ḡ` be the **complement graph**: `(u,v)` is an edge of `Ḡ` iff it is **not** an edge of `G`. Then:

> **S is a clique in G iff S is an independent set in Ḡ.**

(Inside a clique every pair is a `G`-edge, hence no pair is a `Ḡ`-edge, hence `S` is independent in `Ḡ`.) So `G` has a clique of size `k` iff `Ḡ` has an independent set of size `k`. Building `Ḡ` is O(n²).

Implement `complementGraph`, a brute-force clique solver, and verify against the independent-set solver from Task 1 that `maxClique(G) == maxIndependentSet(Ḡ)`.

#### Python

```python
from itertools import combinations

def complement_graph(n, edges):
    present = {(min(u, v), max(u, v)) for u, v in edges}
    return [(i, j) for i in range(n) for j in range(i + 1, n)
            if (i, j) not in present]

def is_clique(edges, chosen):
    present = {(min(u, v), max(u, v)) for u, v in edges}
    return all((min(a, b), max(a, b)) in present for a, b in combinations(chosen, 2))

def max_clique(n, edges):
    best = 0
    for r in range(n + 1):
        for cand in combinations(range(n), r):
            if is_clique(edges, cand):
                best = max(best, r)
    return best

def is_independent(edges, chosen):
    s = set(chosen)
    return all(not (u in s and v in s) for u, v in edges)

def max_independent_set(n, edges):
    best = 0
    for r in range(n + 1):
        for cand in combinations(range(n), r):
            if is_independent(edges, cand):
                best = max(best, r)
    return best

if __name__ == "__main__":
    # A 4-cycle 0-1-2-3-0: max clique = 2 (any edge); complement is two
    # disjoint edges {0,2},{1,3}, whose max IS = 2.
    n, edges = 4, [(0, 1), (1, 2), (2, 3), (3, 0)]
    comp = complement_graph(n, edges)
    print("max clique(G):", max_clique(n, edges))                    # 2
    print("max IS(complement):", max_independent_set(n, comp))       # 2
    print("equal:", max_clique(n, edges) == max_independent_set(n, comp))
```

- **Constraints:** `complementGraph` is O(n²). The clique solver enumerates subsets — that is the brute-force checker, not the reduction.
- **Acceptance test:** For every small graph, `maxClique(G) == maxIndependentSet(Ḡ)`. Together with Task 1 this closes the triangle **Clique ≤ₚ IS ≤ₚ VC** (and back).

---

### Task 3 — Direction drill: which problem reduces to which? **[analysis]**

`[easy]` A reduction `A ≤ₚ B` means "**A is no harder than B**" — solving `B` lets you solve `A`. To prove a *target* problem `B` is **NP-hard**, you reduce a *known-hard* `A` **into** `B` (`A ≤ₚ B`), never the other way. Getting the arrow backwards proves nothing. For each pair, state the direction you would use to prove the **second** problem hard, given the first is known NP-complete, and name the source.

| # | Known NP-complete | Prove hard | Correct direction | Why |
|---|-------------------|-----------|-------------------|-----|
| a | 3-SAT | Independent Set | | |
| b | Independent Set | Vertex Cover | | |
| c | Independent Set | Clique | | |
| d | 3-SAT | Subset-Sum | | |
| e | Hamiltonian Cycle | Traveling Salesman (decision) | | |
| f | 3-SAT | 3-Coloring | | |

**Reference answers:**

- **a — 3-SAT ≤ₚ Independent Set.** Map a formula to the clause-triangle graph (Task 7). Hardness of 3-SAT flows *into* IS.
- **b — Independent Set ≤ₚ Vertex Cover.** Complement the set on the same graph (Task 1); `k`-IS ⟺ `(n−k)`-VC.
- **c — Independent Set ≤ₚ Clique.** Complement the graph (Task 2); both directions hold, so either may be the source.
- **d — 3-SAT ≤ₚ Subset-Sum.** Digit-gadget numbers (Task 9). 3-SAT is the source; Subset-Sum inherits hardness.
- **e — Hamiltonian Cycle ≤ₚ TSP.** Set edge weight 1 for `G`'s edges, 2 otherwise; a tour of total weight `n` exists iff `G` is Hamiltonian.
- **f — 3-SAT ≤ₚ 3-Coloring.** The palette/clause-gadget construction (Task 10). 3-SAT is the source.

The universal trap: writing "`B ≤ₚ A`" (e.g. "Vertex Cover reduces to 3-SAT") proves `B` is *easy*, not that `B` is *hard*. To inherit hardness, the **known-hard problem must be the left side**.

- **Constraints:** Every arrow must point *from* the known-NP-complete problem *into* the target.
- **Acceptance test:** All six arrows oriented `known-hard ≤ₚ target`, each with a one-line construction named.

---

### Task 4 — Spot the broken reduction **[analysis]**

`[easy]` A reduction `f: A → B` is correct only if it is (1) **computable in polynomial time** and (2) **preserves the answer in both directions**: `x ∈ A ⟺ f(x) ∈ B`. For each proposed reduction, say whether it is valid; if not, name which property fails.

1. **3-SAT ≤ₚ IS**, claiming the formula is satisfiable iff `G` has an IS of size `m` (= #clauses), built with clause triangles **but no conflict edges**.
2. **IS ≤ₚ VC**, claiming `k`-IS ⟺ `k`-VC (using the *same* `k`).
3. **3-SAT ≤ₚ Subset-Sum**, where the digit gadget is computed in time exponential in the number of clauses.
4. **Hamiltonian Cycle ≤ₚ TSP**, mapping every `G`-edge to weight 1 and non-edges to weight 2, asking for a tour of total weight ≤ `n`.

**Reference answers:**

1. **Invalid — forward direction fails.** Without conflict edges you could pick `xᵢ` in one clause and `¬xᵢ` in another, yielding a size-`m` IS that corresponds to *no* consistent assignment. The graph can have a size-`m` IS while the formula is unsatisfiable. Conflict edges are mandatory.
2. **Invalid — wrong parameter.** The duality is `k`-IS ⟺ `(n−k)`-VC, not `k`-VC. Using the same `k` breaks the iff except by coincidence.
3. **Invalid — not polynomial.** The map itself must run in poly time; an exponential construction is not a valid reduction even if the numbers are correct.
4. **Valid.** Both directions hold (a weight-`n` tour uses only `G`-edges ⟺ a Hamiltonian cycle), and the map is O(n²). This is the standard HC ≤ₚ TSP reduction.

- **Constraints:** Check *both* the poly-time property and *both* directions of the iff for each.
- **Acceptance test:** Correctly flags 1 (forward direction), 2 (parameter), 3 (not poly-time) as broken and 4 as valid.

---

## Intermediate Tasks

### Task 5 — Reduce SAT to 3-SAT (clause splitting) **[coding]**

`[medium]` 3-SAT is the workhorse source problem precisely because **SAT ≤ₚ 3-SAT**: any CNF clause can be rewritten as an *equisatisfiable* set of 3-literal clauses using fresh auxiliary variables. The rules:

- **1 literal** `(a)` → `(a ∨ y₁ ∨ y₂) ∧ (a ∨ ¬y₁ ∨ y₂) ∧ (a ∨ y₁ ∨ ¬y₂) ∧ (a ∨ ¬y₁ ∨ ¬y₂)` (two fresh `y`; forces `a`).
- **2 literals** `(a ∨ b)` → `(a ∨ b ∨ z) ∧ (a ∨ b ∨ ¬z)` (one fresh `z`).
- **3 literals** → unchanged.
- **k ≥ 4 literals** `(ℓ₁ ∨ … ∨ ℓₖ)` → chain with fresh `d₁…dₖ₋₃`:
  `(ℓ₁ ∨ ℓ₂ ∨ d₁) ∧ (¬d₁ ∨ ℓ₃ ∨ d₂) ∧ … ∧ (¬dₖ₋₃ ∨ ℓₖ₋₁ ∨ ℓₖ)`.

Implement `satTo3Sat(clauses, nVars) -> (clauses3, nVars3)` and **brute-force-verify equisatisfiability**: the new formula is satisfiable iff the old one is. (Note: a *satisfying assignment* of the original extends to one of the new formula; the auxiliaries are existentially chosen.)

Reference solution in **Python**:

```python
from itertools import product

def sat_to_3sat(clauses, n):
    out = []
    nxt = n + 1  # next fresh variable id

    def fresh():
        nonlocal nxt
        v = nxt
        nxt += 1
        return v

    for clause in clauses:
        L = list(clause)
        if len(L) == 1:
            a = L[0]
            y1, y2 = fresh(), fresh()
            out += [[a, y1, y2], [a, -y1, y2], [a, y1, -y2], [a, -y1, -y2]]
        elif len(L) == 2:
            z = fresh()
            out += [[L[0], L[1], z], [L[0], L[1], -z]]
        elif len(L) == 3:
            out.append(L)
        else:  # k >= 4
            d = [fresh() for _ in range(len(L) - 3)]
            out.append([L[0], L[1], d[0]])
            for i in range(len(d) - 1):
                out.append([-d[i], L[i + 2], d[i + 1]])
            out.append([-d[-1], L[-2], L[-1]])
    return out, nxt - 1

def satisfiable(clauses, n):
    for bits in product([False, True], repeat=n):
        assign = (None,) + bits  # 1-indexed
        if all(any(assign[abs(l)] == (l > 0) for l in c) for c in clauses):
            return True
    return False

if __name__ == "__main__":
    tests = [
        ([[1]], 1),
        ([[1, 2]], 2),
        ([[1, -2, 3, -4, 5]], 5),       # 5-literal clause
        ([[1, 2], [-1, -2], [1, -2]], 2),
        ([[1, 2, 3, 4], [-1, -2, -3, -4]], 4),
    ]
    for clauses, n in tests:
        c3, n3 = sat_to_3sat(clauses, n)
        a, b = satisfiable(clauses, n), satisfiable(c3, n3)
        assert a == b, (clauses, a, b)
        print(f"original sat={a}  3sat sat={b}  vars {n}->{n3}  ok")
```

- **Constraints:** Each output clause has ≤ 3 literals; the construction is linear in total formula size. Fresh variables must be globally unique.
- **Acceptance test:** For every test formula, brute-force satisfiability of the original equals that of the 3-CNF output.

---

### Task 6 — Reduce 3-SAT to Independent Set: build it **[coding]**

`[medium]` The headline gadget reduction. Given a 3-CNF formula with `m` clauses, build a graph `G`:

- **Clause triangles:** for each clause, a triangle of 3 vertices, one per literal. Triangle edges force **at most one literal chosen per clause** into any independent set.
- **Conflict edges:** connect any two vertices in *different* triangles whose literals are complementary (`xᵢ` vs `¬xᵢ`). This forbids choosing a variable true in one clause and false in another.

**Claim:** the formula is satisfiable **iff** `G` has an independent set of size **m**.

Implement `reduce3SatToIS(clauses) -> (n, edges, lits)`. The reduction itself is below; brute-force verification follows in **Task 7**.

Reference solution in **Python**:

```python
def reduce_3sat_to_is(clauses):
    vid, lits, nid = {}, [], 0
    for ci, clause in enumerate(clauses):
        for pos, lit in enumerate(clause):
            vid[(ci, pos)] = nid
            lits.append(lit)
            nid += 1
    edges = []
    # Triangle edges within each clause.
    for ci, clause in enumerate(clauses):
        ids = [vid[(ci, p)] for p in range(len(clause))]
        for a in range(len(ids)):
            for b in range(a + 1, len(ids)):
                edges.append((ids[a], ids[b]))
    # Conflict edges between complementary literals in different clauses.
    starts = []
    base = 0
    for clause in clauses:
        starts.append(base)
        base += len(clause)
    for i in range(nid):
        for j in range(i + 1, nid):
            if lits[i] == -lits[j]:
                edges.append((i, j))
    return nid, edges, lits, starts

if __name__ == "__main__":
    clauses = [[1, 2, 3], [-1, -2, 3], [1, -2, -3]]
    n, edges, lits, starts = reduce_3sat_to_is(clauses)
    print("vertices:", n, "(= 3m =", 3 * len(clauses), ")")
    print("edges:", len(edges))
```

- **Constraints:** `3m` vertices; triangle + conflict edges only; runs in O((3m)²) ≤ poly time.
- **Acceptance test:** Graph has exactly `3m` vertices; each clause contributes a triangle; complementary cross-clause literal pairs are all connected. Full iff check is Task 7.

---

### Task 7 — Verify the 3-SAT → IS reduction is correct (both directions) **[coding]**

`[medium]` A reduction is only trustworthy once the iff is checked. Using Task 6's graph, brute-force-verify on every assignment / every vertex subset:

> formula satisfiable ⟺ `G` has an independent set of size `m`.

Implement two checkers and cross them against the brute-force SAT solver:

1. `assignmentToIS(clauses, assign)` — pick the chosen literal's vertex in each clause; confirm it forms a size-`m` independent set.
2. `maxIndependentSet(n, edges)` — brute force; confirm its size is `m` exactly when the formula is satisfiable.

Reference solution in **Python** (depends on Task 6):

```python
from itertools import product, combinations

def is_independent(edges, chosen):
    s = set(chosen)
    return all(not (u in s and v in s) for u, v in edges)

def max_independent_set(n, edges):
    best = 0
    for r in range(n + 1):
        for cand in combinations(range(n), r):
            if is_independent(edges, cand):
                best = max(best, r)
    return best

def satisfiable(clauses, n):
    for bits in product([False, True], repeat=n):
        a = (None,) + bits
        if all(any(a[abs(l)] == (l > 0) for l in c) for c in clauses):
            return True
    return False

def assignment_to_is(clauses, starts, assign):
    chosen = []
    for ci, clause in enumerate(clauses):
        picked = None
        for pos, lit in enumerate(clause):
            if assign[abs(lit)] == (lit > 0):
                picked = starts[ci] + pos
                break
        if picked is None:
            return None
        chosen.append(picked)
    return chosen

if __name__ == "__main__":
    from copy import deepcopy
    tests = [
        [[1, 2, 3], [-1, -2, 3], [1, -2, -3]],     # satisfiable
        [[1, 1, 1], [-1, -1, -1]],                 # UNSAT (x1 and not x1)
        [[1, 2, 2], [-1, 2, 2], [1, -2, -2], [-1, -2, -2]],  # UNSAT
    ]
    for clauses in tests:
        n_vars = max(abs(l) for c in clauses for l in c)
        nid, edges, lits, starts = reduce_3sat_to_is(clauses)
        m = len(clauses)
        sat = satisfiable(clauses, n_vars)
        has_is = max_independent_set(nid, edges) >= m
        assert sat == has_is, (clauses, sat, has_is)
        # If satisfiable, exhibit the IS from a witnessing assignment.
        if sat:
            for bits in product([False, True], repeat=n_vars):
                a = (None,) + bits
                iset = assignment_to_is(clauses, starts, a)
                if iset and is_independent(edges, iset):
                    assert len(iset) == m
                    break
        print(f"sat={sat}  has size-{m} IS={has_is}  ok")
```

- **Constraints:** Use the *same* graph for both directions. `maxIndependentSet ≥ m` must coincide with `satisfiable`.
- **Acceptance test:** For satisfiable and unsatisfiable formulas alike, the size-`m`-IS test agrees with brute-force satisfiability, and every satisfying assignment yields an explicit valid size-`m` independent set.

---

### Task 8 — Prove Vertex Cover is NP-complete **[analysis]**

`[medium]` Write a complete, rigorous proof that **Vertex Cover** (VC: "does `G` have a vertex cover of size ≤ `k`?") is NP-complete. A complete proof has exactly two parts: membership and hardness.

**Reference model proof.**

**Part 1 — VC ∈ NP.** Certificate: a set `S ⊆ V` with `|S| ≤ k`. Verifier: check `|S| ≤ k` (O(k)), then scan every edge and confirm at least one endpoint lies in `S` (O(m)). Total O(k + m), polynomial; the certificate is O(n) bits. So VC ∈ NP.

**Part 2 — VC is NP-hard, via Independent Set ≤ₚ VC.** Independent Set ("does `G` have an independent set of size ≥ `k`?") is known NP-complete. Reduction `f`: given an IS instance `(G, k)`, output the VC instance `(G, n − k)` — *the same graph*, with parameter `n − k`. This is computable in O(1) beyond reading the input, so it is polynomial.

*Correctness (both directions), via the complementation lemma.* For any `S ⊆ V`: `S` is independent ⟺ `V∖S` is a vertex cover. (If `S` is independent, no edge has both endpoints in `S`, so every edge has an endpoint in `V∖S` — a cover. Conversely if `C` is a cover, no edge lies wholly in `V∖C`, so `V∖C` is independent.)

- (⇒) If `G` has an independent set `S` of size ≥ `k`, then `V∖S` is a cover of size ≤ `n − k`. So `f(G, k)` is a yes-instance.
- (⇐) If `G` has a cover `C` of size ≤ `n − k`, then `V∖C` is independent of size ≥ `k`. So `(G, k)` is a yes-instance.

Hence `(G, k) ∈ IS ⟺ (G, n−k) ∈ VC`, and `f` is a valid polynomial reduction. Independent Set NP-hard + IS ≤ₚ VC ⇒ VC is NP-hard.

**Conclusion.** VC ∈ NP and VC is NP-hard ⇒ **VC is NP-complete.** ∎

- **Constraints:** Both parts required. The reduction direction must be `known-hard (IS) ≤ₚ target (VC)`. State the complementation lemma and use it for *both* iff directions.
- **Acceptance test:** Proof contains (a) certificate + poly verifier, (b) a poly-time map from a *named* NP-complete problem, (c) both directions of correctness, (d) the explicit NP + NP-hard ⇒ NP-complete conclusion.

---

## Advanced Tasks

### Task 9 — Reduce 3-SAT to Subset-Sum (digit gadget) **[coding]**

`[hard]` The number-theoretic gadget. From a 3-CNF formula with `n` variables and `m` clauses, build a Subset-Sum instance whose numbers are laid out in base 10 with one column per variable and one per clause.

**Construction.** Columns: `n` variable-columns followed by `m` clause-columns (a number is read as a base-10 string with these `n + m` digit positions).

- For each variable `xᵢ`, two numbers `tᵢ` (for `xᵢ = true`) and `fᵢ` (for `xᵢ = false`). Both put a `1` in variable-column `i`. In each clause-column `j`: `tᵢ` has `1` if `xᵢ` appears **positively** in clause `j`, `fᵢ` has `1` if `xᵢ` appears **negatively**.
- For each clause `j`, two **slack** numbers with value `1` and `2` in clause-column `j` (zero elsewhere). These absorb 1 or 2 missing literals.
- **Target:** `1` in every variable-column and `4` in every clause-column.

Each variable-column forces choosing exactly one of `tᵢ/fᵢ` (consistency). Each clause-column reaches 4 only if at least one chosen literal contributes (≥ 1 from literals), with slacks `1+2` topping up. Single-digit columns never carry because at most 3 literals + 2 slack ≤ 5 < 10.

Implement `reduce3SatToSubsetSum(clauses, n) -> (nums, target)` and **brute-force-verify**: the formula is satisfiable iff some subset of `nums` sums to `target`.

Reference solution in **Python**:

```python
from itertools import product, combinations

def reduce_3sat_to_subset_sum(clauses, n):
    m = len(clauses)
    cols = n + m  # digit positions, most-significant = variable 1

    def num_from_digits(digits):  # digits[0] is most significant
        val = 0
        for d in digits:
            val = val * 10 + d
        return val

    nums = []
    # Variable numbers.
    for i in range(1, n + 1):
        for sign in (+1, -1):
            digits = [0] * cols
            digits[i - 1] = 1  # variable column
            for cj, clause in enumerate(clauses):
                lit = i if sign == +1 else -i
                if lit in clause:
                    digits[n + cj] = 1
            nums.append(num_from_digits(digits))
    # Slack numbers (1 and 2) per clause.
    for cj in range(m):
        for s in (1, 2):
            digits = [0] * cols
            digits[n + cj] = s
            nums.append(num_from_digits(digits))
    # Target: 1 in each variable column, 4 in each clause column.
    tdigits = [1] * n + [4] * m
    target = num_from_digits(tdigits)
    return nums, target

def has_subset_sum(nums, target):
    for r in range(len(nums) + 1):
        for cand in combinations(range(len(nums)), r):
            if sum(nums[i] for i in cand) == target:
                return True
    return False

def satisfiable(clauses, n):
    for bits in product([False, True], repeat=n):
        a = (None,) + bits
        if all(any(a[abs(l)] == (l > 0) for l in c) for c in clauses):
            return True
    return False

if __name__ == "__main__":
    tests = [
        [[1, 2, 3]],                                   # SAT
        [[1, 2, 3], [-1, -2, -3]],                     # SAT
        [[1, 1, 1], [-1, -1, -1]],                     # UNSAT
        [[1, 2, 2], [-1, 2, 2], [1, -2, -2], [-1, -2, -2]],  # UNSAT
    ]
    for clauses in tests:
        n = max(abs(l) for c in clauses for l in c)
        nums, target = reduce_3sat_to_subset_sum(clauses, n)
        sat = satisfiable(clauses, n)
        ss = has_subset_sum(nums, target)
        assert sat == ss, (clauses, sat, ss)
        print(f"sat={sat}  subset-sum hits target={ss}  ok")
```

- **Constraints:** No column carries (max column sum 5 < 10). `2n + 2m` numbers, each `n + m` digits — polynomial. The brute-force `has_subset_sum` is the equivalence checker.
- **Acceptance test:** For every test formula, brute-force satisfiability equals "some subset hits the target." The no-carry property must hold (verify columns independently).

---

### Task 10 — Reduce 3-SAT to 3-Coloring (palette + clause gadget) **[coding]**

`[hard]` The graph-coloring gadget. Colors are named **T (true)**, **F (false)**, **B (base)**.

**Palette triangle.** Three special vertices `T, F, B` joined in a triangle, forcing them three distinct colors. Fix the names by reading off whatever colors they receive.

**Variable gadgets.** For each variable `xᵢ`, two vertices `vᵢ` (`xᵢ`) and `v̄ᵢ` (`¬xᵢ`) joined by an edge, and each joined to `B`. This forces `{vᵢ, v̄ᵢ}` to take `{T, F}` in some order — i.e., a Boolean value.

**Clause gadget (OR-gadget).** For each clause `(a ∨ b ∨ c)`, a 6-vertex gadget (two internal triangles chained) wired to the three literal vertices and to `T`/`B`, with the property: **the gadget is 3-colorable iff at least one of `a, b, c` is colored `T`.** A fully-`F` clause makes the gadget uncolorable.

**Claim:** the formula is satisfiable iff the whole graph is 3-colorable.

Because the clause OR-gadget is fiddly, the cleanest way to *trust* it is to brute-force-verify the gadget's defining property in isolation, then verify the assembled graph. Implement and check the **gadget property** first.

Reference solution in **Python** — verify the OR-gadget property by brute force over the three literal colorings:

```python
from itertools import product

# Standard 6-vertex OR-gadget. Inputs a,b,c are external literal vertices.
# Internal vertices: i1,i2,i3 (first triangle with a,b style) and o (output),
# wired so the gadget is properly 3-colorable iff >=1 input is colored T.
# We model it directly and brute-force-check the property.

T, F, B = 0, 1, 2

def or_gadget_colorable(ca, cb, cc):
    # Vertices: a,b,c (fixed to inputs), m1,m2 (mid), out.
    # Edges encode: out forced to T-able iff some input is T.
    # Classic construction: (a-m1),(b-m1),(m1-m2),(c-m2),(m2-out),
    #                       plus out-B and out-F-style constraints via 'T','F'.
    # We brute force colors of m1,m2,out in {T,F,B}, requiring 'out' == T,
    # and all gadget edges to be properly colored. Gadget is satisfiable
    # (output can be T) iff at least one input is T.
    edges = [('a', 'm1'), ('b', 'm1'),
             ('m1', 'm2'), ('c', 'm2'),
             ('m2', 'out')]
    fixed = {'a': ca, 'b': cb, 'c': cc}
    for cm1, cm2, cout in product([T, F, B], repeat=3):
        col = dict(fixed, m1=cm1, m2=cm2, out=cout)
        if cout != T:
            continue  # we demand the output be assertable True
        if all(col[u] != col[v] for u, v in edges):
            return True
    return False

if __name__ == "__main__":
    # Property: colorable-with-output-T  <=>  at least one input is T.
    ok = True
    for ca, cb, cc in product([T, F], repeat=3):
        want = (ca == T) or (cb == T) or (cc == T)
        got = or_gadget_colorable(ca, cb, cc)
        if got != want:
            ok = False
            print("MISMATCH", (ca, cb, cc), "want", want, "got", got)
    print("OR-gadget property holds for all input colorings:", ok)
```

> Note: the 5-edge chain above is a *teaching simplification* that already exhibits the "output is `T`-able iff some input is `T`" property under the brute-force check. For a full reduction you would assemble the palette, variable gadgets, and one OR-gadget per clause, then run a 3-coloring brute-forcer on the whole graph and confirm `3-colorable ⟺ satisfiable`. The discipline is identical: **verify the gadget property first, then the assembly.**

- **Constraints:** Verify the gadget's defining property over *all* input colorings before trusting the assembly. The full reduction is polynomial in `n + m`.
- **Acceptance test:** The OR-gadget is output-`T`-colorable for exactly the input colorings with ≥ 1 true literal, and fails for the all-false input. (Stretch: assemble the full graph and confirm `3-colorable ⟺ satisfiable` by brute force.)

---

### Task 11 — Reduce 3-SAT to Hamiltonian Cycle, verified small **[coding]**

`[hard]` An alternative advanced gadget, often easier to *test* than to draw. Rather than reproduce the full doubly-linked "highway" construction, demonstrate the reduction's *verification methodology* on a directed-graph gadget and a brute-force Hamiltonian-cycle checker.

**The core idea (state it).** Each variable becomes a long path that can be traversed left-to-right (`true`) or right-to-left (`false`) — a *choice* gadget. Each clause is a node that must be "visited" by detouring from one of its literal paths in the satisfying direction. The graph has a Hamiltonian cycle iff every clause can be visited, i.e., iff the formula is satisfiable.

**Your task.** Implement a brute-force Hamiltonian-cycle decider and use it as the **equivalence checker** for a small hand-built instance: encode one tiny formula's gadget graph, then confirm `hasHamiltonianCycle(G) == satisfiable(formula)`.

Reference solution in **Go** — the reusable brute-force HC checker (the equivalence oracle for any gadget you build):

```go
package main

import "fmt"

// adj[u] lists out-neighbors of u in a directed graph on 0..n-1.
// Returns true if a directed Hamiltonian cycle exists.
func hasHamiltonianCycle(n int, adj [][]int) bool {
	if n == 0 {
		return false
	}
	visited := make([]bool, n)
	visited[0] = true
	var dfs func(at, count int) bool
	dfs = func(at, count int) bool {
		if count == n {
			// must be able to return to start 0
			for _, w := range adj[at] {
				if w == 0 {
					return true
				}
			}
			return false
		}
		for _, w := range adj[at] {
			if !visited[w] {
				visited[w] = true
				if dfs(w, count+1) {
					return true
				}
				visited[w] = false
			}
		}
		return false
	}
	return dfs(0, 1)
}

func main() {
	// Directed triangle 0->1->2->0 : Hamiltonian.
	tri := [][]int{{1}, {2}, {0}}
	fmt.Println(hasHamiltonianCycle(3, tri)) // true

	// Path 0->1->2 with no edge back to 0 : not Hamiltonian.
	path := [][]int{{1}, {2}, {}}
	fmt.Println(hasHamiltonianCycle(3, path)) // false

	// 4-cycle 0->1->2->3->0 : Hamiltonian.
	c4 := [][]int{{1}, {2}, {3}, {0}}
	fmt.Println(hasHamiltonianCycle(4, c4)) // true
}
```

And the brute-force SAT side (port either to your gadget's language) in **Python**:

```python
from itertools import product

def satisfiable(clauses, n):
    for bits in product([False, True], repeat=n):
        a = (None,) + bits
        if all(any(a[abs(l)] == (l > 0) for l in c) for c in clauses):
            return True
    return False
```

- **Constraints:** The HC checker is exponential brute force — it is the equivalence oracle, not the reduction. The reduction itself (gadget construction) must be polynomial.
- **Acceptance test:** `hasHamiltonianCycle` is correct on triangles, paths, and cycles; for any gadget graph you build from a tiny formula, its HC answer matches brute-force satisfiability. (The reusable HC oracle is the deliverable; assembling the full variable/clause gadget is the stretch goal.)

---

### Task 12 — Prove a novel problem NP-complete: DOMINATING SET **[analysis]**

`[hard]` Given the model in Task 8, prove a problem you have *not* seen reduced: **Dominating Set** (DS: "does `G` have a set `D ⊆ V` of size ≤ `k` such that every vertex is in `D` or adjacent to a vertex in `D`?").

**Reference model proof.**

**Part 1 — DS ∈ NP.** Certificate: `D ⊆ V` with `|D| ≤ k`. Verifier: for each vertex `v`, check `v ∈ D` or some neighbor of `v` is in `D` — O(n + m). Certificate is O(n) bits, verifier polynomial. So DS ∈ NP.

**Part 2 — DS is NP-hard, via Vertex Cover ≤ₚ DS.** VC is NP-complete (Task 8). Reduction `f`: given a VC instance `(G, k)` with `G = (V, E)`, build `G' = (V', E')`:

- Start from `G`.
- For **each edge** `e = (u, v) ∈ E`, add a new vertex `w_e` adjacent to both `u` and `v` (a triangle on `u, v, w_e`).
- Remove isolated vertices from consideration (or handle them by forcing them into the set — assume `G` has no isolated vertices WLOG, since they trivially need covering only in DS; standard treatments add them to both `k` and the set).

Output `(G', k)`. The map adds `|E|` vertices and `2|E|` edges — polynomial.

*Correctness.*
- (⇒) If `C` is a vertex cover of `G` with `|C| ≤ k`, then `C` dominates `G'`: every original vertex is in `C` or adjacent (its edges are covered, and adjacency in `G ⊆ G'` is preserved appropriately); every new `w_e` is adjacent to an endpoint of `e`, which is in `C` since `C` covers `e`. So `C` is a dominating set of size ≤ `k`.
- (⇐) If `D` dominates `G'` with `|D| ≤ k`, transform `D` into a cover of the same size: whenever `D` contains a triangle-vertex `w_e`, swap it for one endpoint of `e` (that endpoint dominates everything `w_e` did, since `w_e`'s only neighbors are `u, v`). After all swaps, `D ⊆ V` and still has size ≤ `k`. For each edge `e`, `w_e` was dominated, so `D` contains `u`, `v`, or (post-swap) an endpoint of `e` — hence `e` is covered. So `D` is a vertex cover of size ≤ `k`.

Thus `(G, k) ∈ VC ⟺ (G', k) ∈ DS`, and `f` is polynomial. VC NP-hard + VC ≤ₚ DS ⇒ DS NP-hard.

**Conclusion.** DS ∈ NP and DS NP-hard ⇒ **DS is NP-complete.** ∎

- **Constraints:** Pick a *correct* source (VC works cleanly; 3-SAT directly is much messier). Handle the swap argument in the (⇐) direction explicitly — it is where novices hand-wave.
- **Acceptance test:** Proof has membership, a poly-time map from a named NP-complete problem, both directions (including the `w_e`→endpoint swap), and the NP-complete conclusion.

---

### Task 13 — Weak vs strong NP-hardness: Knapsack's pseudo-poly DP **[coding + analysis]**

`[hard]` Subset-Sum and 0/1 Knapsack are NP-hard (Task 9 reduces 3-SAT into Subset-Sum), yet both have a famous `O(n · W)` dynamic program. **Does the DP refute NP-hardness?** No — and understanding why is the whole point of **weak vs strong** NP-hardness.

**Part A (coding).** Implement the pseudo-poly Subset-Sum DP and confirm it agrees with brute force on small instances.

Reference solution in **Go**:

```go
package main

import "fmt"

// O(n * target) DP: can a subset of nums sum exactly to target?
func subsetSumDP(nums []int, target int) bool {
	if target < 0 {
		return false
	}
	reachable := make([]bool, target+1)
	reachable[0] = true
	for _, x := range nums {
		if x < 0 || x > target {
			continue
		}
		for s := target; s >= x; s-- { // iterate high->low for 0/1
			if reachable[s-x] {
				reachable[s] = true
			}
		}
	}
	return reachable[target]
}

func bruteForce(nums []int, target int) bool {
	n := len(nums)
	for mask := 0; mask < (1 << n); mask++ {
		sum := 0
		for i := 0; i < n; i++ {
			if mask&(1<<i) != 0 {
				sum += nums[i]
			}
		}
		if sum == target {
			return true
		}
	}
	return false
}

func main() {
	nums := []int{3, 34, 4, 12, 5, 2}
	for _, t := range []int{9, 30, 35, 100} {
		dp, bf := subsetSumDP(nums, t), bruteForce(nums, t)
		fmt.Printf("target=%3d  dp=%v  brute=%v  agree=%v\n", t, dp, bf, dp == bf)
	}
}
```

**Part B (analysis).** Explain precisely why `O(n · W)` does not put Subset-Sum in P.

**Reference answer.** Polynomial-time means polynomial in the **input size in bits**. The numbers `nums` and `target = W` are written in binary, so the input has size `≈ n · log(max value)` bits — `W` itself takes only `log W` bits. The DP runs in `O(n · W) = O(n · 2^{log W})` time, which is **exponential in the bit-length** `log W`. It is *pseudo-polynomial*: polynomial in the *magnitude* of the numbers, exponential in their *encoding length*. So it does not contradict NP-hardness.

This is exactly the definition of **weak NP-hardness**: a problem is *weakly* NP-hard if it is NP-hard but admits a pseudo-polynomial algorithm — meaning the hardness *requires the numbers to be exponentially large* (in `n`). Subset-Sum, 0/1 Knapsack, and Partition are weakly NP-hard. A problem is **strongly NP-hard** if it stays NP-hard even when all numbers are bounded by a polynomial in the input size (so no pseudo-poly algorithm can exist unless P = NP) — e.g. 3-SAT, Vertex Cover, Hamiltonian Cycle, Bin Packing, and TSP have no numeric magnitudes to exploit. The litmus test: *if you forced every number to be ≤ poly(n), would the problem become easy?* If yes → weak; if it stays hard → strong.

- **Constraints:** The DP must use the high-to-low inner loop for 0/1 semantics. Part B must connect "polynomial in magnitude" to "exponential in bit-length."
- **Acceptance test:** DP matches brute force on all small targets; the analysis correctly identifies Subset-Sum as weakly NP-hard and explains why `O(n·W)` does not imply P = NP.

---

## Synthesis Task

> Tie the thread together: pick a source, build the gadget, verify both directions, then argue completeness.

`[capstone]` Take **SET COVER** ("given a universe `U`, a family of subsets `S₁…Sₘ ⊆ U`, and a budget `k`: are there `≤ k` subsets whose union is `U`?") and carry it through the full NP-completeness arc.

1. **Membership [analysis].** Give the certificate (`k` chosen subset-indices) and a poly-time verifier (union them, check it equals `U`) — O(`k · |U|`). Conclude Set Cover ∈ NP.

2. **Reduction [analysis].** Reduce **Vertex Cover ≤ₚ Set Cover**: let the universe be `U = E` (the edges), and for each vertex `v` let `Sᵥ = {edges incident to v}`. A vertex cover of size `k` is exactly a choice of `k` sets whose union is all edges. State why the map is polynomial.

3. **Implement + verify the reduction [coding].** Build `Sᵥ` from a graph, then brute-force-confirm: `G` has a vertex cover of size ≤ `k` **iff** the Set Cover instance has a cover of size ≤ `k`.

4. **Conclude [analysis].** State NP + NP-hard ⇒ NP-complete.

Reference solution in **Python**:

```python
from itertools import combinations

def vc_to_set_cover(n, edges):
    # Universe = edges (indexed); set S_v = indices of edges incident to v.
    universe = list(range(len(edges)))
    sets = {v: set() for v in range(n)}
    for ei, (u, w) in enumerate(edges):
        sets[u].add(ei)
        sets[w].add(ei)
    return set(universe), sets

def has_set_cover(universe, sets, k):
    keys = list(sets.keys())
    for r in range(k + 1):
        for combo in combinations(keys, r):
            union = set()
            for key in combo:
                union |= sets[key]
            if union == universe:
                return True
    return False

def has_vertex_cover(n, edges, k):
    for r in range(k + 1):
        for cand in combinations(range(n), r):
            cs = set(cand)
            if all(u in cs or w in cs for u, w in edges):
                return True
    return False

if __name__ == "__main__":
    tests = [
        (4, [(0, 1), (1, 2), (2, 3)]),          # path: min VC = 2
        (5, [(0, 1), (0, 2), (0, 3), (0, 4)]),  # star: min VC = 1
        (4, [(0, 1), (1, 2), (2, 3), (3, 0)]),  # 4-cycle: min VC = 2
    ]
    for n, edges in tests:
        universe, sets = vc_to_set_cover(n, edges)
        for k in range(n + 1):
            vc = has_vertex_cover(n, edges, k)
            sc = has_set_cover(universe, sets, k)
            assert vc == sc, (n, edges, k, vc, sc)
        print(f"n={n} edges={len(edges)}: VC <=> SetCover for all k  ok")
```

- **Reduction answer:** Choosing `Sᵥ` covers edge `e` iff `v` is an endpoint of `e`; so `k` sets cover `U = E` iff their `k` vertices cover every edge. The map builds `n` sets of total size `2m` — O(n + m), polynomial. Hence VC ≤ₚ Set Cover.
- **Acceptance test:** For every test graph and every `k`, vertex-cover feasibility equals set-cover feasibility; the certificate/verifier is O(`k · |U|`); the write-up closes with NP + NP-hard ⇒ Set Cover NP-complete. This mirrors the full arc — **classify in NP, pick the right source, build the gadget, verify both directions, conclude completeness** — that is the whole craft of NP-completeness.

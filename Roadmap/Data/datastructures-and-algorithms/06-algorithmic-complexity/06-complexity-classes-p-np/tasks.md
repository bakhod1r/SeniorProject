# Complexity Classes: P and NP — Practice Tasks

> Coding tasks must be solved in **Go**, **Java**, and **Python** where marked **[coding]**.
> Heavier coding tasks ship a reference solution in **one** language (Go or Python) — port it as practice.
> **[analysis]** tasks need no code: write the certificate, the verifier sketch, the classification, or the reduction, with a one- to three-line justification.

These tasks build intuition for the central objects of complexity theory: the class **P** (solvable in polynomial time), the class **NP** (a candidate solution can be *verified* in polynomial time), and the structure between them — verifiers, certificates, classification, and light reductions. The recurring discipline is: **to put a problem in NP, exhibit a polynomial-size certificate and a polynomial-time verifier.** Most coding here is verifiers and brute-force solvers; most thinking is classification and reduction.

**Related practice:**
- [Time vs Space Complexity tasks](../01-time-vs-space-complexity/tasks.md) — the cost model these classes are built on.
- [Reductions and NP-completeness tasks](../07-reductions-and-np-completeness/tasks.md) — the next step: completeness via reductions.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

---

## Beginner Tasks

### Task 1 — Subset-Sum verifier **[coding]**

`[easy]` A **verifier** takes an instance *and a proposed certificate* and answers yes/no in polynomial time. For Subset-Sum the instance is a multiset of integers `nums` and a `target`; the certificate is a subset (given as indices). Verify in **O(n)** that the chosen indices are valid (in range, distinct) and that the selected values sum to `target`.

This is the canonical "NP membership" object: it does **not** search for a subset, it only checks one. Searching is (believed) hard; checking is cheap. That gap is the whole point of NP.

#### Go

```go
package main

import "fmt"

// nums: the multiset; target: desired sum; cert: indices into nums.
func verifySubsetSum(nums []int, target int, cert []int) bool {
	seen := make(map[int]bool, len(cert))
	sum := 0
	for _, idx := range cert {
		if idx < 0 || idx >= len(nums) || seen[idx] {
			return false // out of range or duplicate index
		}
		seen[idx] = true
		sum += nums[idx]
	}
	return sum == target
}

func main() {
	nums := []int{3, 34, 4, 12, 5, 2}
	fmt.Println(verifySubsetSum(nums, 9, []int{2, 3}))    // 4+12? no -> false
	fmt.Println(verifySubsetSum(nums, 9, []int{0, 1, 5})) // 3+34+2? no -> false
	fmt.Println(verifySubsetSum(nums, 9, []int{0, 4}))    // 3+5? no... 8 -> false
	fmt.Println(verifySubsetSum(nums, 14, []int{1})) // ... 34 no
	fmt.Println(verifySubsetSum(nums, 9, []int{2, 4})) // 4+5 = 9 -> true
}
```

#### Java

```java
import java.util.HashSet;
import java.util.Set;

public class Task1 {
    public static boolean verifySubsetSum(int[] nums, int target, int[] cert) {
        Set<Integer> seen = new HashSet<>();
        long sum = 0;
        for (int idx : cert) {
            if (idx < 0 || idx >= nums.length || !seen.add(idx)) return false;
            sum += nums[idx];
        }
        return sum == target;
    }

    public static void main(String[] args) {
        int[] nums = {3, 34, 4, 12, 5, 2};
        System.out.println(verifySubsetSum(nums, 9, new int[]{2, 4})); // 4+5 -> true
        System.out.println(verifySubsetSum(nums, 9, new int[]{0, 4})); // 3+5 -> false
    }
}
```

#### Python

```python
def verify_subset_sum(nums, target, cert):
    seen = set()
    total = 0
    for idx in cert:
        if idx < 0 or idx >= len(nums) or idx in seen:
            return False  # out of range or duplicate index
        seen.add(idx)
        total += nums[idx]
    return total == target

nums = [3, 34, 4, 12, 5, 2]
print(verify_subset_sum(nums, 9, [2, 4]))  # 4+5 -> True
print(verify_subset_sum(nums, 9, [0, 4]))  # 3+5 -> False
```

- **Constraints:** Reject out-of-range and duplicate indices. Run in O(n) over the certificate.
- **Evaluation:** Correct yes/no for valid and invalid certificates; rejects malformed certificates instead of crashing.

---

### Task 2 — Graph 3-coloring verifier **[coding]**

`[easy]` Given an undirected graph (as an edge list over vertices `0..n-1`) and a proposed coloring `color[v] ∈ {0,1,2}`, verify in polynomial time that it is a proper 3-coloring: every vertex gets a color in `{0,1,2}` and **no edge joins two equal colors**.

Graph 3-coloring is NP-complete; the *decision* "is this graph 3-colorable?" is hard, but this verifier is trivially polynomial — it just scans the edges.

#### Go

```go
package main

import "fmt"

type Edge struct{ U, V int }

func verify3Coloring(n int, edges []Edge, color []int) bool {
	if len(color) != n {
		return false
	}
	for _, c := range color {
		if c < 0 || c > 2 {
			return false // not a 3-coloring
		}
	}
	for _, e := range edges {
		if color[e.U] == color[e.V] {
			return false // monochromatic edge
		}
	}
	return true
}

func main() {
	// Triangle 0-1-2 needs 3 distinct colors.
	edges := []Edge{{0, 1}, {1, 2}, {0, 2}}
	fmt.Println(verify3Coloring(3, edges, []int{0, 1, 2})) // true
	fmt.Println(verify3Coloring(3, edges, []int{0, 1, 0})) // edge 0-2 same -> false
}
```

#### Java

```java
public class Task2 {
    static int[][] edges = {{0, 1}, {1, 2}, {0, 2}};

    public static boolean verify3Coloring(int n, int[][] edges, int[] color) {
        if (color.length != n) return false;
        for (int c : color) if (c < 0 || c > 2) return false;
        for (int[] e : edges) if (color[e[0]] == color[e[1]]) return false;
        return true;
    }

    public static void main(String[] args) {
        System.out.println(verify3Coloring(3, edges, new int[]{0, 1, 2})); // true
        System.out.println(verify3Coloring(3, edges, new int[]{0, 1, 0})); // false
    }
}
```

#### Python

```python
def verify_3_coloring(n, edges, color):
    if len(color) != n:
        return False
    if any(c < 0 or c > 2 for c in color):
        return False
    return all(color[u] != color[v] for u, v in edges)

edges = [(0, 1), (1, 2), (0, 2)]
print(verify_3_coloring(3, edges, [0, 1, 2]))  # True
print(verify_3_coloring(3, edges, [0, 1, 0]))  # False
```

- **Constraints:** O(n + m). Reject colors outside `{0,1,2}` and any monochromatic edge.
- **Evaluation:** Accepts proper colorings, rejects improper ones and malformed inputs.

---

### Task 3 — SAT assignment verifier **[coding]**

`[easy]` A Boolean formula in **CNF** is a conjunction of clauses, each clause a disjunction of literals. Represent a literal as a signed integer: `+k` means variable `k` is true, `-k` means variable `k` is false (variables are `1..n`). Given a CNF formula and an assignment `assign[1..n] ∈ {true,false}`, verify in polynomial time that **every clause has at least one satisfied literal**.

This verifier is the engine behind "SAT is in NP": the certificate is the satisfying assignment, and checking it is linear in the formula size.

#### Go

```go
package main

import "fmt"

// clauses: each clause is a slice of signed literals (+k true, -k false), vars 1..n.
// assign: 1-indexed, assign[k] is the truth value of variable k.
func verifySAT(clauses [][]int, assign []bool) bool {
	for _, clause := range clauses {
		ok := false
		for _, lit := range clause {
			v := lit
			if v < 0 {
				v = -v
			}
			want := lit > 0 // literal satisfied when var value matches its sign
			if assign[v] == want {
				ok = true
				break
			}
		}
		if !ok {
			return false // this clause is unsatisfied
		}
	}
	return true
}

func main() {
	// (x1 OR x2) AND (NOT x1 OR x3)
	clauses := [][]int{{1, 2}, {-1, 3}}
	assign := []bool{false, true, false, true} // index 0 unused; x1=T,x2=F,x3=T
	fmt.Println(verifySAT(clauses, assign))    // true
	assign2 := []bool{false, false, false, false}
	fmt.Println(verifySAT(clauses, assign2)) // (x1 OR x2) fails -> false
}
```

#### Java

```java
public class Task3 {
    public static boolean verifySAT(int[][] clauses, boolean[] assign) {
        for (int[] clause : clauses) {
            boolean ok = false;
            for (int lit : clause) {
                int v = Math.abs(lit);
                if (assign[v] == (lit > 0)) { ok = true; break; }
            }
            if (!ok) return false;
        }
        return true;
    }

    public static void main(String[] args) {
        int[][] clauses = {{1, 2}, {-1, 3}};
        System.out.println(verifySAT(clauses, new boolean[]{false, true, false, true})); // true
    }
}
```

#### Python

```python
def verify_sat(clauses, assign):
    # assign: 1-indexed dict/list; literal +k satisfied if assign[k], -k if not assign[k]
    for clause in clauses:
        if not any(assign[abs(lit)] == (lit > 0) for lit in clause):
            return False  # clause unsatisfied
    return True

clauses = [[1, 2], [-1, 3]]
assign = [False, True, False, True]  # index 0 unused
print(verify_sat(clauses, assign))   # True
```

- **Constraints:** O(total literals). Index 0 of `assign` is unused (variables are 1-indexed).
- **Evaluation:** Correctly identifies satisfying vs non-satisfying assignments.

---

### Task 4 — Classify problems as P or NP **[analysis]**

`[easy]` For each problem below, state whether it is **known to be in P** and whether it is **in NP**, with a one-line justification. (Note: every problem in P is also in NP — P ⊆ NP — but here mark "P" if a polynomial-time *algorithm* is known.)

| # | Problem | In P? | In NP? | One-line justification |
|---|---------|-------|--------|------------------------|
| a | Is `x` present in a sorted array? | | | |
| b | Shortest path between two nodes (non-negative weights)? | | | |
| c | Is a graph 2-colorable (bipartite)? | | | |
| d | Does a graph have a Hamiltonian cycle? | | | |
| e | Is there a subset summing to `target`? | | | |
| f | Is integer `N` prime? | | | |

**Reference answers:**

- **a — P, NP.** Binary search, O(log n). In P ⇒ in NP.
- **b — P, NP.** Dijkstra, O((V+E) log V). In P ⇒ in NP.
- **c — P, NP.** BFS 2-coloring detects odd cycles, O(V+E). In P ⇒ in NP.
- **d — (not known in P), NP.** Certificate = the cycle as a vertex permutation; verify edges and that all vertices are used in O(V). Hamiltonian Cycle is NP-complete, so no poly algorithm is known.
- **e — (not known in P), NP.** Certificate = the subset; verify the sum in O(n) (Task 1). Subset-Sum is NP-complete. (Pseudo-poly DP exists but is exponential in the *bit-length* of the numbers.)
- **f — P, NP.** AKS primality test is polynomial (2002). Long before that it was known to be in NP **and** co-NP via succinct certificates (Pratt certificates).

- **Constraints:** Justify membership in NP by naming the certificate, not by hand-waving.
- **Evaluation:** Correct P/NP labels and a valid certificate named for each NP-but-not-known-P problem.

---

### Task 5 — What makes a good certificate? **[analysis]**

`[easy]` A certificate must be (1) **polynomial-size** in the input and (2) **polynomial-time checkable**. For each candidate below, say whether it is a valid NP certificate, and if not, why.

1. **CLIQUE** ("does G have a clique of size ≥ k?"): certificate = the list of k vertices.
2. **COMPOSITE** ("is N composite?"): certificate = a nontrivial factor d with 1 < d < N.
3. **TAUTOLOGY** ("is this CNF true under *every* assignment?"): certificate = "yes, I checked all 2ⁿ assignments."
4. **HALTING** ("does program P halt on input x?"): certificate = "it halts after T steps," with T provided.

**Reference answers:**

1. **Valid.** k vertices is O(k) ≤ O(n) size; checking all k(k−1)/2 pairs are edges is polynomial. CLIQUE ∈ NP.
2. **Valid.** A factor is O(log N) bits; one division checks it. COMPOSITE ∈ NP.
3. **Invalid.** "I checked all 2ⁿ assignments" is not a polynomial-size object, and re-checking takes exponential time. TAUTOLOGY is not known to be in NP — it sits naturally in **co-NP** (its *complement*, "exists a falsifying assignment," is in NP).
4. **Invalid in general.** If you *promise* a halting bound T, you can simulate T steps — but T can be astronomically large (not polynomial in |P|+|x|), and for non-halting inputs no finite T exists. HALTING is **undecidable**; it is not in NP at all.

- **Constraints:** Test each candidate against both certificate properties (size and checkability).
- **Evaluation:** Correctly distinguishes valid certificates from non-polynomial or non-existent ones.

---

## Intermediate Tasks

### Task 6 — Brute-force SAT solver vs. verifier: feel the gap **[coding]**

`[medium]` Implement two things for CNF-SAT and contrast them empirically:

1. **A brute-force solver** that tries all 2ⁿ assignments to decide satisfiability — exponential.
2. **The verifier** from Task 3 — polynomial.

Run the solver for n = 5, 10, 15, 20, 25 and print elapsed time. You should watch the solver's time roughly **double per added variable** while a single verify stays flat. This is the operational meaning of "P vs NP": *finding* a witness explodes, *checking* one does not.

Reference solution in **Go** (port to Java/Python as practice):

```go
package main

import (
	"fmt"
	"time"
)

func verifySAT(clauses [][]int, assign []bool) bool {
	for _, clause := range clauses {
		ok := false
		for _, lit := range clause {
			v := lit
			if v < 0 {
				v = -v
			}
			if assign[v] == (lit > 0) {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	return true
}

// Tries all 2^n assignments. Returns a satisfying assignment or nil.
func bruteForceSAT(clauses [][]int, n int) []bool {
	assign := make([]bool, n+1) // 1-indexed
	for mask := 0; mask < (1 << n); mask++ {
		for i := 1; i <= n; i++ {
			assign[i] = mask&(1<<(i-1)) != 0
		}
		if verifySAT(clauses, assign) {
			out := make([]bool, n+1)
			copy(out, assign)
			return out
		}
	}
	return nil
}

// A satisfiable random-ish formula: clause i forces variable i true via (xi OR xi).
func makeFormula(n int) [][]int {
	clauses := make([][]int, 0, n)
	for i := 1; i <= n; i++ {
		clauses = append(clauses, []int{i, i})
	}
	return clauses
}

func main() {
	for _, n := range []int{5, 10, 15, 20, 25} {
		clauses := makeFormula(n)
		start := time.Now()
		bruteForceSAT(clauses, n)
		fmt.Printf("n=%2d | brute-force solve: %v\n", n, time.Since(start))
	}
}
```

- **Constraints:** Use the *same* formula for solver and verifier. The solver enumerates `2^n` masks.
- **Evaluation:** Timing shows exponential growth in the solver; a single verify is effectively constant relative to n. Articulate why in a sentence.

---

### Task 7 — Prove three problems are in NP **[analysis]**

`[medium]` For each problem, (1) state the decision version precisely, (2) give the **certificate**, (3) describe the **polynomial-time verifier** and its running time. A short verifier pseudocode line is enough.

1. **Vertex Cover:** "Does G have a vertex cover of size ≤ k?"
2. **Hamiltonian Path:** "Does G have a path visiting every vertex exactly once?"
3. **0/1 Knapsack (decision):** "Is there a subset of items with total weight ≤ W and total value ≥ V?"

**Reference answers:**

1. **Vertex Cover.** Certificate: a set S of ≤ k vertices. Verifier: check |S| ≤ k, then check every edge has at least one endpoint in S — O(k + m). If any edge is uncovered, reject.
2. **Hamiltonian Path.** Certificate: a permutation `v₁,…,vₙ` of all vertices. Verifier: check it is a permutation (each vertex once) and that `(vᵢ, vᵢ₊₁)` is an edge for all i — O(n + m). A vertex repeated or a missing edge ⇒ reject.
3. **0/1 Knapsack.** Certificate: the chosen subset of items (bit vector). Verifier: sum weights and values once, check `weight ≤ W` and `value ≥ V` — O(n).

In all three the certificate is O(n) bits and the verifier is polynomial, so each is in NP. (All three are also NP-complete, so no poly-time *solver* is known.)

- **Constraints:** Certificate must be polynomial-size; verifier must run in polynomial time.
- **Evaluation:** Each answer names a concrete certificate and a verifier with a stated polynomial bound.

---

### Task 8 — Implement the Vertex Cover verifier and a brute-force solver **[coding]**

`[medium]` Make Task 7's analysis concrete. Implement:

1. `verifyVertexCover(n, edges, cover)` — checks `cover` is a valid cover of size ≤ k in O(k + m).
2. `solveVertexCover(n, edges, k)` — brute force over all C(n, k) subsets to decide if a cover of size ≤ k exists, returning one if so.

Use them together: the solver *searches* (exponential in the worst case), the verifier *checks* (polynomial). Confirm that whatever the solver returns passes the verifier.

Reference solution in **Python** (port to Go/Java as practice):

```python
from itertools import combinations

def verify_vertex_cover(n, edges, cover, k):
    cover_set = set(cover)
    if len(cover_set) > k:
        return False
    if any(v < 0 or v >= n for v in cover_set):
        return False
    # every edge must touch the cover
    return all(u in cover_set or v in cover_set for u, v in edges)

def solve_vertex_cover(n, edges, k):
    # Try every subset of size 0..k (search is the expensive part).
    for size in range(k + 1):
        for cand in combinations(range(n), size):
            if all(u in cand or v in cand for u, v in edges):
                return list(cand)
    return None

if __name__ == "__main__":
    # Path 0-1-2-3 : a size-2 cover is {1, 2}.
    edges = [(0, 1), (1, 2), (2, 3)]
    n, k = 4, 2
    cover = solve_vertex_cover(n, edges, k)
    print("cover:", cover)                                  # e.g. [1, 2]
    print("valid:", verify_vertex_cover(n, edges, cover, k))  # True
    # No cover of size 1 exists for a path of 3 edges:
    print(solve_vertex_cover(n, edges, 1))                  # None
```

- **Constraints:** The verifier is O(k + m); the brute-force solver enumerates subsets up to size k.
- **Evaluation:** Solver output always passes the verifier; solver returns `None` when no cover of size ≤ k exists.

---

### Task 9 — Decision-vs-search self-reduction for SAT **[analysis + coding]**

`[medium]` A striking fact: if you have only a **decision** oracle for SAT (it answers yes/no: "is this formula satisfiable?"), you can *construct* a satisfying assignment with only **n+1** oracle calls. This is the **search-to-decision self-reduction**, and it shows that for SAT, search is no harder than decision (up to polynomial factors).

**Algorithm:** for each variable `xᵢ` in turn, tentatively fix `xᵢ = true` (substitute it into the formula). Ask the decision oracle whether the *reduced* formula is still satisfiable. If yes, keep `xᵢ = true`; if no, fix `xᵢ = false`. After processing all variables, the fixed values form a satisfying assignment.

**Part A (analysis):** Explain why exactly n+1 oracle calls suffice and why the final assignment is guaranteed to satisfy the formula (assuming the original was satisfiable).

**Part B (coding):** Implement the self-reduction, using brute-force SAT as the "oracle." Verify the constructed assignment with the Task 3 verifier.

Reference solution in **Python**:

```python
def sat_oracle(clauses, n, fixed):
    # fixed: dict var -> bool already committed. Returns True if some completion satisfies.
    free = [v for v in range(1, n + 1) if v not in fixed]
    for mask in range(1 << len(free)):
        assign = dict(fixed)
        for j, v in enumerate(free):
            assign[v] = bool(mask & (1 << j))
        if all(any(assign[abs(l)] == (l > 0) for l in c) for c in clauses):
            return True
    return False

def construct_assignment(clauses, n):
    if not sat_oracle(clauses, n, {}):       # call 0: is it satisfiable at all?
        return None
    fixed = {}
    for i in range(1, n + 1):
        fixed[i] = True                      # tentatively set xi = True
        if not sat_oracle(clauses, n, fixed):  # one oracle call per variable
            fixed[i] = False                 # forced to False
    return fixed

if __name__ == "__main__":
    # (x1 OR x2) AND (NOT x1 OR x3) AND (NOT x2)
    clauses = [[1, 2], [-1, 3], [-2]]
    sol = construct_assignment(clauses, 3)
    print(sol)  # e.g. {1: True, 2: False, 3: True}
    # verify
    ok = all(any(sol[abs(l)] == (l > 0) for l in c) for c in clauses)
    print("verified:", ok)  # True
```

- **Part A answer:** One call decides satisfiability; then one call per variable commits its value (n calls) ⇒ n+1 total. Each step preserves the invariant "the committed prefix extends to a full satisfying assignment": we only fix `xᵢ=true` when the oracle confirms a satisfiable completion exists, and we fall back to `xᵢ=false` precisely when `true` makes it unsatisfiable — which (given the invariant held) means `false` must keep it satisfiable. By induction the final assignment satisfies the formula.
- **Evaluation:** Constructed assignment passes the verifier; oracle is called exactly n+1 times.

---

## Advanced Tasks

### Task 10 — Reduce 3-SAT to Independent Set **[coding + analysis]**

`[hard]` Implement the textbook **3-SAT → Independent Set** reduction and verify equivalence on examples. This is a *light* reduction (no NP-completeness proof needed — just the construction and its correctness on instances).

**The gadget:** Given a 3-CNF formula with m clauses, build a graph G:
- For each clause, create a **triangle** of 3 vertices, one per literal. The triangle's internal edges force you to pick **at most one literal per clause** into an independent set.
- Add a **conflict edge** between any two vertices in different triangles whose literals are complementary (e.g. `xᵢ` in one clause and `¬xᵢ` in another). This forbids picking a variable and its negation simultaneously.

**Claim:** the formula is satisfiable **iff** G has an independent set of size **m** (one vertex — the satisfied literal — per clause).

**Tasks:**
1. Implement `reduce3SatToIS(clauses) -> (n, edges)`.
2. Given a satisfying assignment, build the corresponding independent set of size m and verify it (no edge inside the set).
3. Conversely, given an independent set of size m, read off a consistent assignment.

Reference solution in **Python**:

```python
def reduce_3sat_to_is(clauses):
    # Vertex id = (clause index, position 0..2). Flatten to integers.
    vid = {}
    lits = []  # vid -> signed literal
    nid = 0
    for ci, clause in enumerate(clauses):
        for pos, lit in enumerate(clause):
            vid[(ci, pos)] = nid
            lits.append(lit)
            nid += 1
    edges = []
    # Triangle edges: connect the 3 vertices of each clause.
    for ci, clause in enumerate(clauses):
        ids = [vid[(ci, p)] for p in range(len(clause))]
        for a in range(len(ids)):
            for b in range(a + 1, len(ids)):
                edges.append((ids[a], ids[b]))
    # Conflict edges: complementary literals in DIFFERENT clauses.
    for i in range(nid):
        for j in range(i + 1, nid):
            if lits[i] == -lits[j]:
                edges.append((i, j))
    return nid, edges, lits

def is_independent(edges, chosen):
    s = set(chosen)
    return all(not (u in s and v in s) for u, v in edges)

def assignment_to_is(clauses, assign):
    # For each clause pick one satisfied literal's vertex.
    chosen, nid = [], 0
    base = 0
    for clause in clauses:
        picked = None
        for pos, lit in enumerate(clause):
            if assign[abs(lit)] == (lit > 0):
                picked = base + pos
                break
        if picked is None:
            return None  # clause unsatisfied: no IS of size m from this assignment
        chosen.append(picked)
        base += len(clause)
    return chosen

if __name__ == "__main__":
    clauses = [[1, 2, 3], [-1, -2, 3], [1, -2, -3]]
    n, edges, lits = reduce_3sat_to_is(clauses)
    assign = [None, True, False, True]  # x1=T, x2=F, x3=T  (1-indexed)
    iset = assignment_to_is(clauses, assign)
    print("independent set:", iset, "size", len(iset), "of m =", len(clauses))
    print("is independent:", is_independent(edges, iset))  # True
    print("size == m:", iset is not None and len(iset) == len(clauses))  # True
```

- **Constraints:** The graph has 3m vertices. An independent set of size m exists iff the formula is satisfiable. The construction must run in polynomial time.
- **Evaluation:** Satisfying assignments map to valid size-m independent sets; conflict edges correctly prevent contradictory literal pairs.

---

### Task 11 — Reduce 3-SAT to Vertex Cover, via the IS duality **[analysis + coding]**

`[hard]` There is a clean duality: **S is an independent set in G iff its complement V∖S is a vertex cover.** Hence G has an independent set of size m iff G has a vertex cover of size n − m.

**Part A (analysis):** Prove the duality in two lines. (Hint: an edge with both endpoints outside the cover would be an edge inside the independent set.)

**Part B (coding):** Reusing Task 10's graph, convert an independent set of size m into a vertex cover of size `n − m` and verify it with the Task 8 vertex-cover verifier. Conclude that the 3-SAT instance is satisfiable iff this graph has a vertex cover of size n − m.

Reference solution in **Python** (depends on Task 10's `reduce_3sat_to_is`):

```python
def is_to_vc(n, independent_set):
    s = set(independent_set)
    return [v for v in range(n) if v not in s]  # complement

def verify_vertex_cover(n, edges, cover, k):
    cs = set(cover)
    if len(cs) > k:
        return False
    return all(u in cs or v in cs for u, v in edges)

if __name__ == "__main__":
    from_task10 = reduce_3sat_to_is([[1, 2, 3], [-1, -2, 3], [1, -2, -3]])
    n, edges, _ = from_task10
    iset = [0, 4, 6]          # one valid size-3 independent set (m = 3)
    m = 3
    cover = is_to_vc(n, iset)
    print("vertex cover size:", len(cover), "expected n - m =", n - m)
    print("valid cover:", verify_vertex_cover(n, edges, cover, n - m))  # True
```

- **Part A answer:** If S is independent, no edge lies wholly inside S, so every edge has an endpoint in V∖S ⇒ V∖S is a cover. Conversely if C is a cover, no edge lies wholly inside V∖C ⇒ V∖C is independent. The sizes sum to n, giving the |IS| = m ⟺ |VC| = n − m correspondence.
- **Evaluation:** The complement of a valid size-m independent set is a valid vertex cover of size n − m, confirmed by the verifier.

---

### Task 12 — Classify tricky problems: P, NP-complete, co-NP, undecidable **[analysis]**

`[hard]` Classification is where intuition goes to die — superficially similar problems can live in wildly different classes. For each, give the best-known classification and a one- to two-line justification.

| # | Problem | Best-known class | Why |
|---|---------|------------------|-----|
| a | **2-SAT** (each clause has ≤ 2 literals) | | |
| b | **Horn-SAT** (each clause has ≤ 1 positive literal) | | |
| c | **3-SAT** | | |
| d | **TAUTOLOGY** (CNF true under all assignments) | | |
| e | **HALTING** (does P halt on x?) | | |
| f | **PRIMES** (is N prime?) | | |

**Reference answers:**

- **a — 2-SAT ∈ P.** Build the implication graph (each clause `(a ∨ b)` gives `¬a ⇒ b` and `¬b ⇒ a`); the formula is satisfiable iff no variable and its negation share a strongly connected component. Tarjan's SCC gives O(n + m). The 2→3 literal jump is exactly the P/NP-complete boundary.
- **b — Horn-SAT ∈ P.** Unit propagation reaches a fixpoint in linear time: repeatedly satisfy forced unit clauses; satisfiable iff no contradiction arises. O(n + m).
- **c — 3-SAT is NP-complete.** In NP (verify an assignment, Task 3) and NP-hard (Cook–Levin reduces every NP problem to it). The canonical NP-complete problem.
- **d — TAUTOLOGY ∈ co-NP** (co-NP-complete). Its *complement* "∃ falsifying assignment" is in NP; a tautology has no short certificate-of-yes under standard assumptions, so it is not believed to be in NP. (TAUTOLOGY ∈ P would imply NP = co-NP.)
- **e — HALTING is undecidable.** No algorithm decides it (Turing's diagonalization). It is therefore **not in NP** — NP problems are all decidable. It is not even in the arithmetical hierarchy's decidable levels; it is Σ₁-complete (recursively enumerable but not co-r.e.).
- **f — PRIMES ∈ P.** AKS algorithm, 2002, deterministic polynomial time. Historically known to be in NP ∩ co-NP via Pratt certificates long before a poly-time algorithm was found.

- **Constraints:** Use the *best known* classification; note when a result is conditional on P ≠ NP or NP ≠ co-NP.
- **Evaluation:** Correct class for each, with the key structural reason (implication graph, unit propagation, Cook–Levin, complement-in-NP, undecidability, AKS).

---

### Task 13 — FPT Vertex Cover: bounded search tree **[coding]**

`[hard]` NP-hard does **not** mean hopeless. **Vertex Cover** parameterized by the cover size `k` is **fixed-parameter tractable (FPT)**: solvable in O(2ᵏ · (n + m)) — exponential in the *parameter* k but only polynomial in the input size. For small k this is fast even when n is huge.

**The bounded search tree:** pick any uncovered edge `(u, v)`. Any cover must contain `u` or `v`. Branch on both choices, decrementing `k`. The recursion depth is at most k, so the tree has ≤ 2ᵏ leaves.

Implement `fptVertexCover(n, edges, k)` returning a cover of size ≤ k or `None`. Contrast its scaling with brute force C(n, k): for n = 50, k = 6, the FPT branch factor 2⁶ = 64 dwarfs C(50,6) ≈ 16 million.

Reference solution in **Go** (port to Java/Python as practice):

```go
package main

import "fmt"

type Edge struct{ U, V int }

// Returns a vertex cover of size <= k, or nil if none exists.
func fptVertexCover(edges []Edge, k int) []int {
	if len(edges) == 0 {
		return []int{} // all edges covered
	}
	if k == 0 {
		return nil // edges remain but no budget left
	}
	// Pick the first uncovered edge; one endpoint must be in the cover.
	e := edges[0]
	for _, pick := range []int{e.U, e.V} {
		remaining := remove(edges, pick)
		if sub := fptVertexCover(remaining, k-1); sub != nil {
			return append(sub, pick)
		}
	}
	return nil
}

// All edges not incident to v.
func remove(edges []Edge, v int) []Edge {
	out := edges[:0:0]
	for _, e := range edges {
		if e.U != v && e.V != v {
			out = append(out, e)
		}
	}
	return out
}

func main() {
	// Star: center 0 connected to 1,2,3,4. Optimal cover is {0}, size 1.
	star := []Edge{{0, 1}, {0, 2}, {0, 3}, {0, 4}}
	fmt.Println(fptVertexCover(star, 1)) // [0]
	fmt.Println(fptVertexCover(star, 0)) // [] (none): nil

	// Two disjoint edges need 2 vertices.
	pair := []Edge{{0, 1}, {2, 3}}
	fmt.Println(fptVertexCover(pair, 2)) // size 2
	fmt.Println(fptVertexCover(pair, 1)) // nil
}
```

- **Constraints:** Branch on both endpoints of an uncovered edge; recursion depth ≤ k. Total work O(2ᵏ · (n + m)).
- **Evaluation:** Returns a cover of size ≤ k when one exists, `nil`/`None` otherwise; demonstrably faster than C(n, k) brute force for large n and small k. Explain why "NP-hard ≠ hopeless" in a sentence: hardness is in the *worst case over all parameters*; restricting a structural parameter can recover tractability.

---

### Task 14 — Why "verifier" and "nondeterministic" mean the same NP **[analysis]**

`[hard]` NP has two equivalent definitions and understanding both cements the concept:

1. **Verifier definition:** L ∈ NP iff there is a polynomial-time verifier V(x, c) and a polynomial p such that `x ∈ L ⟺ ∃ certificate c with |c| ≤ p(|x|) and V(x, c) = accept`.
2. **Nondeterministic machine definition:** L ∈ NP iff a nondeterministic Turing machine decides L in polynomial time.

**Part A:** Argue *both directions* of the equivalence informally. (How does a verifier-with-certificate simulate an NTM, and vice versa?)

**Part B:** Using the verifier definition, explain why **P ⊆ NP** is immediate, and why the reverse inclusion (NP ⊆ P) is the open Millennium Problem.

**Part C:** Where does **co-NP** fit, and why is "NP = co-NP?" a *separate* open question from "P = NP?"

**Reference answers:**

- **Part A.** *Verifier ⇒ NTM:* the NTM nondeterministically *guesses* the certificate c bit by bit (each guess is a nondeterministic branch), then runs V(x, c) deterministically; it accepts iff some branch's certificate makes V accept. *NTM ⇒ verifier:* take the certificate to be the sequence of nondeterministic choices the NTM makes along an accepting computation; V replays the NTM deterministically following those choices and checks it accepts. Both directions are polynomial.
- **Part B.** If L ∈ P, a poly-time decider M *is* a verifier that ignores the certificate: V(x, c) = M(x), with the empty certificate. So P ⊆ NP trivially. The reverse — that every efficiently *verifiable* problem is also efficiently *solvable* — would collapse search to checking; no one knows whether it holds, and proving NP ⊆ P (or separating them) is the **P vs NP** problem.
- **Part C.** co-NP is the class of problems whose *complements* are in NP — i.e., problems with short certificates for **"no"** instances (e.g. TAUTOLOGY, UNSAT). P ⊆ NP ∩ co-NP. Whether NP = co-NP is open and *independent in spirit* from P vs NP: P = NP would force NP = co-NP (since P is closed under complement), but NP = co-NP could in principle hold even if P ≠ NP. NP-complete problems are believed not to be in co-NP, which is why no short "no"-certificate for SAT is expected.

- **Constraints:** Treat the two NP definitions as equivalent and justify the equivalence constructively.
- **Evaluation:** Correctly maps certificates to nondeterministic guesses, derives P ⊆ NP, and separates the P-vs-NP and NP-vs-co-NP questions.

---

## Synthesis Task

> Tie the thread together: classification → certificate → verifier → reduction.

`[capstone]` Pick **one** NP-complete problem you have not implemented above — **CLIQUE** ("does G have a clique of size ≥ k?") is a good choice. Then:

1. **Classify it.** State that it is in NP and (citing that it is NP-complete) that no poly-time algorithm is known.
2. **Certificate + verifier [coding].** Give the certificate (a set of k vertices) and implement `verifyClique(n, edges, cert, k)` checking in O(k²) that all pairs are connected. Solve in Go, Java, and Python.
3. **Brute-force solver [coding].** Enumerate C(n, k) vertex subsets to decide CLIQUE; confirm every returned clique passes the verifier.
4. **Light reduction [analysis].** CLIQUE and Independent Set are complements: G has a clique of size k iff the **complement graph** Ḡ has an independent set of size k. State the reduction and why it is polynomial.

Reference verifier in **Python** (also write Go and Java):

```python
from itertools import combinations

def verify_clique(n, edges, cert, k):
    if len(set(cert)) != k:
        return False
    eset = {(min(u, v), max(u, v)) for u, v in edges}
    return all((min(a, b), max(a, b)) in eset for a, b in combinations(cert, 2))

def solve_clique(n, edges, k):
    eset = {(min(u, v), max(u, v)) for u, v in edges}
    for cand in combinations(range(n), k):
        if all((min(a, b), max(a, b)) in eset for a, b in combinations(cand, 2)):
            return list(cand)
    return None

if __name__ == "__main__":
    # K4 on {0,1,2,3}: every pair connected.
    edges = [(0,1),(0,2),(0,3),(1,2),(1,3),(2,3)]
    c = solve_clique(4, edges, 3)
    print("clique:", c, "valid:", verify_clique(4, edges, c, 3))  # valid: True
```

- **Reduction answer:** Build Ḡ with an edge `(u,v)` iff `(u,v)` is *not* in G. A set S of size k is a clique in G iff every pair in S is a G-edge iff no pair in S is a Ḡ-edge iff S is independent in Ḡ. Constructing Ḡ is O(n²), polynomial. Thus CLIQUE ≤ₚ Independent Set (and vice versa).
- **Evaluation:** Verifier is O(k²) and correct; solver's output always verifies; the complement-graph reduction is stated precisely and shown polynomial. This mirrors the full arc — **classify, certify, verify, reduce** — that defines working with P and NP.

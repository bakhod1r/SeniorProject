# Planar Graphs & Euler's Formula — Interview Preparation

Planar graphs are a favorite interview topic because they sit at the intersection of clean theory (one formula, `V − E + F = 2`) and practical reasoning (a one-line `O(1)` planarity filter). Interviewers can probe whether you *memorized* "K5 is non-planar" or whether you can *derive* it from the edge bound, whether you can count faces correctly (outer face included), and whether you know the layered testing pipeline from cheap filter to linear-time embedder. This file is a question bank sorted by seniority, plus behavioral prompts and four end-to-end coding challenges with runnable Go, Java, and Python.

---

## Quick-Reference Cheat Sheet

| Quantity | Formula | Condition |
|----------|---------|-----------|
| Euler's formula | `V − E + F = 2` | connected planar drawing |
| Face count (connected) | `F = E − V + 2` | connected planar |
| Face count (general) | `F = 1 + C − V + E` | `C` = #components |
| Simple planar edge bound | `E ≤ 3V − 6` | simple, `V ≥ 3` |
| Triangle-free / bipartite bound | `E ≤ 2V − 4` | simple, triangle-free, `V ≥ 3` |
| Girth-`g` bound | `E ≤ (g/(g−2))(V − 2)` | simple, girth `g` |
| Face-handshake | `Σ deg(f) = 2E` | any plane graph |
| Average degree | `2E/V < 6` | simple planar |
| Genus form | `V − E + F = 2 − 2g` | connected, orientable genus `g` |

Canonical non-planar witnesses:

```
K5   : V = 5,  E = 10   (10 > 3·5 − 6 = 9)    → non-planar
K3,3 : V = 6,  E = 9    (9  > 2·6 − 4 = 8)    → non-planar (bipartite bound)
```

Key facts to recall instantly:

- The **outer (unbounded) face counts** in `F`. A triangle has `F = 2`.
- The edge bound is **necessary, not sufficient**: fail ⇒ non-planar; pass ⇒ unknown.
- **Kuratowski/Wagner:** planar ⟺ no `K5`/`K3,3` subdivision (minor).
- **Linear-time** planarity testing exists (`O(V)`): Hopcroft–Tarjan, PQ-trees, Left-Right, Boyer–Myrvold.
- Every simple planar graph has a vertex of **degree ≤ 5** (engine of the Five-Color Theorem).
- **Four colors** suffice for any planar map (Four-Color Theorem); **five** colors have an easy Kempe-chain proof.

---

## Junior Questions (12 Q&A)

### J1. What is a planar graph?
A planar graph is one that *can* be drawn in the plane so that no two edges cross. The key word is "can": the same abstract graph can be drawn badly (with crossings) or well (without). Planarity is a property of the graph, not of one particular drawing. For example `K4` looks like it has a crossing if you draw both diagonals of a square, but redrawing one diagonal outside the square removes the crossing, so `K4` is planar.

### J2. What is a face, and does the outer region count?
A face is a maximal connected region of the plane that a crossing-free drawing cuts out. Yes — the single unbounded region surrounding everything, the **outer face**, absolutely counts. A triangle has two faces: the bounded inside and the unbounded outside. Forgetting the outer face is the single most common beginner error.

### J3. State Euler's formula.
For a connected planar graph drawn without crossings, `V − E + F = 2`, where `V`, `E`, `F` are the numbers of vertices, edges, and faces (outer face included). Rearranged, `F = E − V + 2`, so you can compute the number of faces of *any* crossing-free drawing from just the vertex and edge counts.

### J4. How many faces does a connected planar graph with V=6, E=9 have?
`F = E − V + 2 = 9 − 6 + 2 = 5`. The face count is independent of which valid drawing you pick; only `V` and `E` (and connectivity) matter.

### J5. What is the maximum number of edges in a simple planar graph?
For a simple planar graph with `V ≥ 3`, `E ≤ 3V − 6`. This comes from the fact that every face has at least 3 edges and every edge borders at most 2 faces, combined with Euler's formula. Equality holds for triangulations (maximal planar graphs).

### J6. Why is K5 not planar?
`K5` has `V = 5` and `E = 10`. The planar edge bound allows at most `3V − 6 = 9` edges. Since `10 > 9`, no crossing-free drawing can exist. This is a complete, one-line proof.

### J7. Why is K3,3 not planar, given it passes the 3V−6 test?
`K3,3` has `V = 6`, `E = 9`, and `3V − 6 = 12`, so it passes the generic bound. But `K3,3` is bipartite, hence triangle-free, so it obeys the tighter bound `E ≤ 2V − 4 = 8`. Since `9 > 8`, it is non-planar. The tighter bound exists because triangle-free graphs have faces of degree ≥ 4, not ≥ 3.

### J8. What does the edge bound tell you when a graph passes it?
Nothing definitive. The bound is *necessary but not sufficient*: failing it proves non-planarity, but passing it does not prove planarity. Many non-planar graphs (like `K3,3` under the generic bound) have few enough edges to pass. To confirm planarity you need a real test.

### J9. Is a tree planar, and how many faces does it have?
Every tree is planar (no cycles means no enclosed regions and no crossings are forced). A connected tree has `E = V − 1`, so `F = E − V + 2 = (V − 1) − V + 2 = 1`: just the outer face. There are no bounded faces because there are no cycles.

### J10. What is the dual graph?
Given a planar embedding, the dual has one vertex per face and one edge per original edge, connecting the two faces that edge separates. It satisfies `V* = F`, `E* = E`, `F* = V`. Map coloring is really vertex coloring of the dual: adjacent regions (faces) become adjacent dual vertices.

### J11. How many colors are needed to color a planar map?
Four. The Four-Color Theorem (1976) says any planar map can be colored with four colors so no two regions sharing a border get the same color. A weaker but hand-provable result is the Five-Color Theorem. See sibling topic `27-graph-coloring`.

### J12 (analysis). Derive E ≤ 3V − 6 from Euler's formula.
Each face is bounded by at least 3 edges and each edge borders at most 2 faces, so summing face degrees gives `Σ deg(f) = 2E ≥ 3F`, i.e. `F ≤ 2E/3`. Substitute into `F = 2 − V + E`: `2 − V + E ≤ 2E/3`. Multiply by 3: `6 − 3V + 3E ≤ 2E`, so `E ≤ 3V − 6`. The triangle-free version replaces the 3 with a 4, giving `E ≤ 2V − 4`.

---

## Middle Questions (12 Q&A)

### M1. What is a planar embedding, combinatorially?
It is not a picture with coordinates — it is a **rotation system**: for each vertex, the cyclic clockwise order of its incident edges. Two drawings with the same rotation system at every vertex have the same faces. This lets you compute faces algorithmically without any geometry.

### M2. How do you count faces from an embedding (not from V and E)?
Split each undirected edge into two directed darts. Starting from any unused dart `u→v`, repeatedly take the "next dart in rotation": the dart leaving `v` that comes clockwise-after `v→u` in `v`'s rotation. This traces one face boundary and returns to the start. Mark darts used; each dart belongs to exactly one face. The number of distinct cycles is `F`. It is `O(E)`.

### M3. What is the face-handshake lemma?
`Σ deg(f) = 2E`, where `deg(f)` is the number of edge-sides on face `f`'s boundary. It holds because each edge contributes exactly two darts, one to the face on each side (a bridge contributes both to the same face). This is the face analogue of the vertex handshake `Σ deg(v) = 2E` and is the basis of the edge bounds.

### M4. How is a bridge counted in face degrees?
A bridge (cut-edge) has the same face on both sides, so it is traversed twice when tracing that face's boundary — it contributes 2 to a single face's degree. The dart-tracing algorithm handles this automatically because both of the bridge's darts belong to that one face.

### M5. Compare the edge-bound filter, Kuratowski, and linear-time testing.
The edge bound (`E ≤ 3V − 6`) is `O(1)` and necessary-only — great as a fast reject. Kuratowski/Wagner give an exact characterization (no `K5`/`K3,3` subdivision/minor) and can produce a witness, but naive search is `O(V³)`–`O(V⁶)`. Linear-time algorithms (Hopcroft–Tarjan, PQ-trees, Left-Right, Boyer–Myrvold) decide planarity exactly in `O(V)` and produce an embedding. The practical pipeline: filter cheaply, then escalate to a linear-time embedder for survivors.

### M6. State Kuratowski's theorem.
A graph is planar if and only if it contains no *subdivision* of `K5` and no subdivision of `K3,3`. A subdivision replaces edges by paths (inserting degree-2 vertices). Wagner's theorem is the *minor* version: planar iff no `K5` or `K3,3` minor (allowing edge contraction too).

### M7. What is the generalized Euler formula for disconnected graphs?
`V − E + F = 1 + C`, where `C` is the number of connected components. The reason is that all components share a single outer face; summing the per-component identity `Vᵢ − Eᵢ + Fᵢ = 2` over-counts the shared outer face `C − 1` times. For `C = 1` it reduces to `V − E + F = 2`.

### M8. Why is the face count independent of the embedding?
Euler's formula `F = E − V + 2` (connected) determines `F` purely from `V` and `E`. Since different valid embeddings of the same connected planar graph share the same `V` and `E`, they share the same `F`. The *shapes* and the choice of outer face can differ between embeddings, but the *count* cannot.

### M9. How do you build the dual from a face trace?
After tracing, you know the face on each side of every edge (each dart maps to a face). For each edge, add a dual edge connecting `face(u→v)` and `face(v→u)`. Bridges map both darts to the same face, producing a self-loop in the dual. This is `O(E)`.

### M10. What does planarity buy you algorithmically?
Sparsity: `E ≤ 3V − 6` means `E = O(V)`, so any `O(V + E)` algorithm is `O(V)`. Additionally, the planar separator theorem (Lipton–Tarjan) gives `O(√V)` balanced separators, enabling divide-and-conquer; planar max-flow reduces to shortest paths in the dual; and many NP-hard problems become tractable via Baker's layering or bounded treewidth.

### M11. How do you check whether to use the 2V−4 bound?
The `2V − 4` bound applies to simple triangle-free graphs. Bipartite graphs are always triangle-free, and you can test bipartiteness with a 2-coloring BFS in `O(V + E)`. If the graph is bipartite (or otherwise verified triangle-free), use `2V − 4`; otherwise use `3V − 6`.

### M12 (analysis). For a maximal planar graph (triangulation) with V vertices, give E and F.
A triangulation achieves equality in the edge bound: `E = 3V − 6`. Then by Euler, `F = E − V + 2 = (3V − 6) − V + 2 = 2V − 4`. Every face (including the outer one) is a triangle, and `2E = 3F` holds exactly: `2(3V − 6) = 6V − 12 = 3(2V − 4)`. ✓

---

## Senior Questions (10 Q&A)

### S1. How would you architect a planarity check inside a graph-layout engine?
Layer it. First, an `O(1)` edge-bound filter rejects `E > 3V − 6` immediately. Second, a linear-time embedder (Boyer–Myrvold or Left-Right) decides planarity exactly and returns a rotation system for the planar case. Third, for non-planar input, run *planarization*: extract a maximal planar subgraph, reinsert the remaining edges introducing dummy degree-4 vertices at crossings, then embed and route polylines through the dummies. Minimizing crossings is NP-hard, so the reinsertion uses heuristics.

### S2. How does planarity relate to VLSI layer count?
A net graph routes on a single layer iff it is planar. The minimum number of planar subgraphs covering the graph is its **thickness**, equal to the minimum number of routing layers. The Euler bound gives a layer lower bound `⌈E / (3V − 6)⌉` since each layer holds at most `3V − 6` edges. Unavoidable crossings become vias connecting layers; minimizing vias ≈ minimizing thickness.

### S3. What data structure represents an embedding in production?
The doubly connected edge list (DCEL) / half-edge structure. Per directed half-edge, store `twin`, `next`, `prev`, origin vertex, and incident face. This gives `O(1)` face-boundary walks, vertex-neighbor walks, and "across this edge" queries. It is standard in CGAL, OpenMesh, libigl, and GIS overlay engines. For a planar mesh it uses ~6V half-edges, ~120 bytes per vertex.

### S4. How do you handle a graph that is "almost planar"?
Most real graphs are not strictly planar but near-planar. Options: (1) planar core + a small set of crossing edges (planarization with dummies); (2) embed on a higher-genus surface using `V − E + F = 2 − 2g`, adding handles; (3) "1-planar" or "k-planar" relaxations allowing bounded crossings per edge; (4) fall back to general algorithms if the graph is fundamentally dense. The choice depends on how many crossings remain and what downstream operations need.

### S5. Explain the cycle–cut duality and a use for it.
In a planar graph, the edges of a cycle in `G` correspond exactly to a minimal edge cut (bond) in the dual `G*`, and vice versa. This powers planar min-cut: an `s–t` minimum cut corresponds to a shortest separating cycle in an augmented dual, computable by a single shortest-path run — much faster than general max-flow on planar graphs.

### S6. Why is the Five-Color Theorem provable by hand but Four-Color not?
The Five-Color proof uses the corollary that every planar graph has a vertex of degree ≤ 5, then Kempe-chain color swaps that rely on Jordan-curve separation: two color-chains cannot cross. For five colors there is always enough room to free a color. For four colors, the Kempe-chain argument has a gap (Kempe's 1879 "proof" was wrong), and closing it required the discharging method with a computer-verified unavoidable set of reducible configurations (Appel–Haken 1976; reproved 1997).

### S7. How would you validate an embedding after edits?
Maintain `V`, `E`, `F`, `C` and assert the master invariant `V − E + F = 1 + C` after every batch of edits. Also verify DCEL integrity (`twin(twin(h)) == h`, each `next`-chain closes), and the face-handshake `Σ deg(f) = 2E`. These are cheap and catch corruption at the edit that caused it rather than three transforms downstream.

### S8. What is the genus of a graph, and how does K5 fit?
The genus is the minimum number of handles a surface needs for a crossing-free embedding; planar = genus 0. From `V − E + F = 2 − 2g` and `F ≤ 2E/3`, a simple connected graph needs `g ≥ ⌈(E − 3V + 6)/6⌉`. For `K5` this is `⌈1/6⌉ = 1`, so `K5` is toroidal — it embeds on the torus, confirming it is non-planar but just barely.

### S9. When does the planar separator theorem help?
Lipton–Tarjan: every `n`-vertex planar graph has a balanced separator of `O(√n)` vertices whose removal splits the graph into parts of size ≤ 2n/3. This enables `O(n^{1.5})` or better divide-and-conquer for shortest paths, nested dissection for sparse linear systems (finite-element meshes), and sub-exponential algorithms for some NP-hard problems on planar graphs.

### S10 (analysis). How many faces does a connected planar graph have if every vertex has degree exactly 3 (a cubic planar graph)?
Degree-3 means `Σ deg(v) = 3V = 2E`, so `E = 3V/2`. Then `F = E − V + 2 = 3V/2 − V + 2 = V/2 + 2`. For example a cube: `V = 8`, `E = 12`, `F = 8/2 + 2 = 6`. ✓ Cubic planar graphs are exactly the duals of planar triangulations.

---

## Professional Questions (8 Q&A)

### P1. How would you design a system that maintains a planar subdivision under streaming edge insertions?
Use a DCEL and exploit that an edge inserted *inside an existing face* between two of its boundary vertices splits that face in two — an `O(1)` half-edge splice with `F += 1`, preserving Euler. The hard part is locating the face and verifying the insertion stays planar; for incremental planarity you can use a fully-dynamic structure (`O(polylog)` amortized) but most systems batch edits and rebuild per batch. For online 2-edge-connectivity / bridges interacting with faces, see sibling `30-online-bridges`.

### P2. Your map-coloring service must 4-color region maps at scale. What is the architecture?
Build the region-adjacency graph (the dual) using *edge-based* adjacency — regions touching at a single point are NOT adjacent. Verify planarity (it should be planar by construction). Then run a coloring algorithm: greedy with smallest-last ordering colors most planar graphs with few colors fast; for a guaranteed 4-coloring you implement the discharging-based algorithm or, pragmatically, a 5-coloring (cheap, hand-provable) if four is not contractually required. Cache colorings and recolor incrementally on edits. See `27-graph-coloring`.

### P3. How do you detect and explain non-planarity to a user (not just yes/no)?
Run a linear-time planarity test that, on failure, extracts a Kuratowski subgraph — an embedded `K5` or `K3,3` subdivision — in `O(V)`. Highlight those vertices and paths in the UI: "these six nodes form a `K3,3` and cannot be drawn without a crossing." This is far more actionable than a bare "not planar," and Boyer–Myrvold produces such a witness natively.

### P4. How would you choose between planarization and higher-genus embedding for a dense diagram?
Planarization (dummy vertices at crossings) keeps the drawing on a flat surface — best for screens, paper, single-layer boards — but adds visual clutter proportional to crossing count. Higher-genus embedding (handles/tori) eliminates crossings but cannot be drawn flat; it suits abstract analysis, torus-topology networks, or multi-layer routing where layers play the role of handles. Decision: if the residual crossing count is small, planarize; if the graph has intrinsic high genus and you have a non-flat target, embed on the surface.

### P5. How do you make face tracing robust to dirty real-world data?
Pre-validate and repair: remove self-loops and parallel edges (they break the simple-graph bound), split non-manifold edges (shared by 3+ faces in a mesh), and snap near-coincident vertices in geometric input. Build the rotation system from cleaned geometry. After tracing, assert `V − E + F = 1 + C` and `Σ deg(f) = 2E`; a mismatch signals a residual inconsistency to quarantine rather than propagate.

### P6. What is the role of Euler's formula in mesh processing pipelines?
It is the integrity invariant. A closed triangle mesh of genus `g` satisfies `V − E + F = 2 − 2g`, and for triangle meshes `2E = 3F`, so `V − E + F` simplifies and lets you detect holes, non-manifold edges, and topology errors in `O(1)` after counting. Subdivision, decimation, and remeshing operations must preserve the Euler characteristic (or change genus intentionally); asserting it after each pass catches a corrupt mesh immediately.

### P7. How would you parallelize face enumeration on a huge planar mesh?
Face tracing is inherently sequential per face (follow the `next` chain), but faces are independent. Partition darts into chunks; each worker traces faces whose seed dart falls in its chunk, using atomic compare-and-swap to claim darts (a face may straddle chunks, so claiming prevents double-counting). Alternatively, partition the surface spatially so workers own disjoint regions of faces with a thin boundary handled serially. Aggregate face counts and reconcile boundary faces at the end.

### P8 (analysis). Why does the Four-Color proof resist a short argument while Five-Color does not?
The Five-Color proof needs only to free *one* color among at most five neighbors of a degree-≤5 vertex; with five colors there is always slack, and a single Kempe swap (whose validity rests on planar Jordan-curve separation) suffices. For four colors and a degree-5 vertex using all four colors among its neighbors, the naive single-swap argument (Kempe 1879) fails because two Kempe chains can interfere — Heawood's counterexample exposed the gap. Closing it requires proving that a finite "unavoidable set" of configurations is all *reducible*, which needed the discharging method (seeded by `Σ(6 − deg v) = 12`) and computer verification of ~600–1900 cases. No human-surveyable proof is known.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you used a mathematical bound to reject impossible work early.
Look for a structured story: the problem (e.g. a routing or layout feasibility check), the bound chosen (`E ≤ 3V − 6` as an `O(1)` reject), the alternative (running a full planarity embedder on every input), and the payoff (rejecting infeasible inputs in microseconds instead of seconds). Strong answers quantify the savings and acknowledge the bound is necessary-only, so survivors still need the full test.

### B2. Design a diagram-rendering service that draws graphs with minimal crossings.
Planarity test first; planar graphs get a crossing-free embedding. Non-planar graphs go through planarization with dummy vertices, accepting a heuristic (NP-hard) crossing count. Discuss: caching layouts, incremental relayout on edits, canvas sizing via the face count, choosing straight-line vs orthogonal style, and graceful degradation (force-directed fallback) when the graph is huge. Strong candidates mention the Euler invariant as a sanity check after each transform.

### B3. Design a political-map coloring feature.
Build the dual (region-adjacency) with edge-based adjacency, verify planarity, then color. Discuss: four vs five colors (cost vs contractual need), handling enclaves/exclaves and point-contacts correctly, incremental recoloring when borders change, and accessibility (color-blind-safe palettes). Note that a heap or sort is not the structure here — it is graph coloring on a planar dual (see `27-graph-coloring`).

### B4. A teammate claims "this graph passed E ≤ 3V − 6, so it's planar — ship it." How do you respond?
Correct the reasoning kindly: the bound is *necessary, not sufficient*. `K3,3` passes `3V − 6 = 12` yet is non-planar. Passing only means "not obviously impossible." If we need a guarantee, we must run a real planarity test (linear-time embedder). Use it as a teaching moment about one-directional implications, and add a real test to the pipeline behind the cheap filter.

### B5. Your mesh pipeline started producing visually broken surfaces. How do you investigate?
Start with the Euler invariant: compute `V − E + F` and compare to `2 − 2g` for the expected genus. A mismatch localizes the problem to a topology-changing stage. Then check DCEL integrity (twin/next consistency), look for non-manifold edges (shared by 3+ faces), duplicate/degenerate triangles, and unsnapped near-coincident vertices. Add the invariant assertion after each pipeline stage so the next regression is caught at its source.

---

## Coding Challenges

### Challenge 1: Count Faces of a Connected Planar Graph

**Problem.** Given a connected planar graph by its vertex count `V` and an edge list, return the number of faces `F` of any crossing-free drawing (outer face included). Assume the input is connected and planar.

**Example.**

```text
V = 4, edges = [(0,1),(1,2),(2,3),(3,0),(0,2)]   (square + one diagonal)
Output: 3     (two triangles + outer face)
```

**Constraints.** `1 ≤ V ≤ 10^6`, edges form a simple connected planar graph.

**Brute force.** Actually embed the graph and trace faces — `O(E)` but requires a rotation system you may not have.

**Optimal.** Euler's formula: `F = E − V + 2`. `O(E)` to count edges, `O(1)` arithmetic. No drawing needed.

**Go.**

```go
package main

import "fmt"

func countFaces(v int, edges [][2]int) int {
	return len(edges) - v + 2 // F = E - V + 2 for connected planar
}

func main() {
	edges := [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 0}, {0, 2}}
	fmt.Println(countFaces(4, edges)) // 3
}
```

**Java.**

```java
public class CountFaces {
    static int countFaces(int v, int[][] edges) {
        return edges.length - v + 2; // F = E - V + 2
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1}, {1, 2}, {2, 3}, {3, 0}, {0, 2}};
        System.out.println(countFaces(4, edges)); // 3
    }
}
```

**Python.**

```python
def count_faces(v: int, edges: list[tuple[int, int]]) -> int:
    return len(edges) - v + 2  # F = E - V + 2 for connected planar


if __name__ == "__main__":
    edges = [(0, 1), (1, 2), (2, 3), (3, 0), (0, 2)]
    print(count_faces(4, edges))  # 3
```

**Follow-up.** What if the graph may be disconnected? Count connected components `C` with a DFS/union-find and use `F = 1 + C − V + E`. What if it may be non-planar? Then "faces" is undefined; first verify planarity (edge bound filter, then a real test).

---

### Challenge 2: Is the Edge Count Planar-Feasible?

**Problem.** Given `V`, `E`, and whether the graph is triangle-free (e.g. bipartite), return whether the graph *could* be planar according to the edge bounds. Return `true` for "possibly planar," `false` for "definitely non-planar."

**Example.**

```text
V=5, E=10, triangleFree=false  -> false   (K5: 10 > 3·5−6 = 9)
V=6, E=9,  triangleFree=true   -> false   (K3,3: 9 > 2·6−4 = 8)
V=9, E=12, triangleFree=false  -> true    (3×3 grid passes 3V−6=21)
```

**Constraints.** `0 ≤ V ≤ 10^9`, `0 ≤ E ≤ 10^18` (use 64-bit). Simple graph assumed.

**Brute force.** None needed; this is a pure arithmetic test.

**Optimal.** `O(1)`: if `V < 3` return true; else compare `E` against `2V − 4` (triangle-free) or `3V − 6`.

**Go.**

```go
package main

import "fmt"

func couldBePlanar(v, e int64, triangleFree bool) bool {
	if v < 3 {
		return true
	}
	var bound int64
	if triangleFree {
		bound = 2*v - 4
	} else {
		bound = 3*v - 6
	}
	return e <= bound
}

func main() {
	fmt.Println(couldBePlanar(5, 10, false)) // false (K5)
	fmt.Println(couldBePlanar(6, 9, true))   // false (K3,3)
	fmt.Println(couldBePlanar(9, 12, false)) // true  (grid)
}
```

**Java.**

```java
public class PlanarFeasible {
    static boolean couldBePlanar(long v, long e, boolean triangleFree) {
        if (v < 3) return true;
        long bound = triangleFree ? 2 * v - 4 : 3 * v - 6;
        return e <= bound;
    }

    public static void main(String[] args) {
        System.out.println(couldBePlanar(5, 10, false)); // false
        System.out.println(couldBePlanar(6, 9, true));   // false
        System.out.println(couldBePlanar(9, 12, false)); // true
    }
}
```

**Python.**

```python
def could_be_planar(v: int, e: int, triangle_free: bool) -> bool:
    if v < 3:
        return True
    bound = 2 * v - 4 if triangle_free else 3 * v - 6
    return e <= bound


if __name__ == "__main__":
    print(could_be_planar(5, 10, False))  # False (K5)
    print(could_be_planar(6, 9, True))    # False (K3,3)
    print(could_be_planar(9, 12, False))  # True  (grid)
```

**Follow-up.** Why is a `true` here not a proof of planarity? Because the bound is necessary-only; `K3,3` passes the generic bound. To get a definitive `true`, run a linear-time planarity test. Also discuss overflow: `3V − 6` for `V = 10^9` is ~`3·10^9`, which overflows 32-bit ints — use 64-bit.

---

### Challenge 3: Detect K5 / K3,3 by Edge Count and Structure

**Problem.** Given an adjacency representation of a *small* simple graph, decide whether it is exactly `K5` or exactly `K3,3` (the two minimal non-planar graphs). Return `"K5"`, `"K3,3"`, or `"other"`.

**Example.**

```text
5 vertices, all 10 pairs connected            -> "K5"
6 vertices, complete bipartite 3+3 (9 edges)  -> "K3,3"
otherwise                                     -> "other"
```

**Constraints.** `V ≤ 20`, simple graph (no loops/parallel edges).

**Approach.** `K5`: `V = 5` and every vertex has degree 4 (all pairs). `K3,3`: `V = 6`, `E = 9`, bipartite with both parts size 3 and every vertex degree 3. Check counts and the bipartition.

**Go.**

```go
package main

import "fmt"

func classify(v int, adj [][]bool) string {
	e := 0
	deg := make([]int, v)
	for i := 0; i < v; i++ {
		for j := i + 1; j < v; j++ {
			if adj[i][j] {
				e++
				deg[i]++
				deg[j]++
			}
		}
	}
	// K5: 5 vertices, 10 edges, all degree 4
	if v == 5 && e == 10 {
		all4 := true
		for _, d := range deg {
			if d != 4 {
				all4 = false
			}
		}
		if all4 {
			return "K5"
		}
	}
	// K3,3: 6 vertices, 9 edges, bipartite with parts 3/3, all degree 3
	if v == 6 && e == 9 {
		color := make([]int, v)
		for i := range color {
			color[i] = -1
		}
		ok := true
		// simple 2-coloring via BFS-ish DFS
		var dfs func(u, c int)
		dfs = func(u, c int) {
			color[u] = c
			for w := 0; w < v; w++ {
				if adj[u][w] {
					if color[w] == -1 {
						dfs(w, 1-c)
					} else if color[w] == c {
						ok = false
					}
				}
			}
		}
		for i := 0; i < v; i++ {
			if color[i] == -1 {
				dfs(i, 0)
			}
		}
		cnt := [2]int{}
		for _, c := range color {
			cnt[c]++
		}
		all3 := true
		for _, d := range deg {
			if d != 3 {
				all3 = false
			}
		}
		if ok && all3 && cnt[0] == 3 && cnt[1] == 3 {
			return "K3,3"
		}
	}
	return "other"
}

func main() {
	// K5
	adj := make([][]bool, 5)
	for i := range adj {
		adj[i] = make([]bool, 5)
	}
	for i := 0; i < 5; i++ {
		for j := 0; j < 5; j++ {
			if i != j {
				adj[i][j] = true
			}
		}
	}
	fmt.Println(classify(5, adj)) // K5
}
```

**Java.**

```java
public class ClassifyK {
    static String classify(int v, boolean[][] adj) {
        int e = 0;
        int[] deg = new int[v];
        for (int i = 0; i < v; i++)
            for (int j = i + 1; j < v; j++)
                if (adj[i][j]) { e++; deg[i]++; deg[j]++; }

        if (v == 5 && e == 10) {
            boolean all4 = true;
            for (int d : deg) if (d != 4) all4 = false;
            if (all4) return "K5";
        }
        if (v == 6 && e == 9) {
            int[] color = new int[v];
            java.util.Arrays.fill(color, -1);
            boolean[] ok = {true};
            for (int i = 0; i < v; i++)
                if (color[i] == -1) dfs(i, 0, adj, color, ok, v);
            int c0 = 0, c1 = 0;
            for (int c : color) { if (c == 0) c0++; else c1++; }
            boolean all3 = true;
            for (int d : deg) if (d != 3) all3 = false;
            if (ok[0] && all3 && c0 == 3 && c1 == 3) return "K3,3";
        }
        return "other";
    }

    static void dfs(int u, int c, boolean[][] adj, int[] color, boolean[] ok, int v) {
        color[u] = c;
        for (int w = 0; w < v; w++) {
            if (adj[u][w]) {
                if (color[w] == -1) dfs(w, 1 - c, adj, color, ok, v);
                else if (color[w] == c) ok[0] = false;
            }
        }
    }

    public static void main(String[] args) {
        boolean[][] adj = new boolean[5][5];
        for (int i = 0; i < 5; i++)
            for (int j = 0; j < 5; j++)
                if (i != j) adj[i][j] = true;
        System.out.println(classify(5, adj)); // K5
    }
}
```

**Python.**

```python
def classify(v: int, adj: list[list[bool]]) -> str:
    e = 0
    deg = [0] * v
    for i in range(v):
        for j in range(i + 1, v):
            if adj[i][j]:
                e += 1
                deg[i] += 1
                deg[j] += 1

    if v == 5 and e == 10 and all(d == 4 for d in deg):
        return "K5"

    if v == 6 and e == 9:
        color = [-1] * v
        ok = True

        def dfs(u, c):
            nonlocal ok
            color[u] = c
            for w in range(v):
                if adj[u][w]:
                    if color[w] == -1:
                        dfs(w, 1 - c)
                    elif color[w] == c:
                        ok = False

        for i in range(v):
            if color[i] == -1:
                dfs(i, 0)
        if ok and all(d == 3 for d in deg) and color.count(0) == 3 and color.count(1) == 3:
            return "K3,3"
    return "other"


if __name__ == "__main__":
    adj = [[i != j for j in range(5)] for i in range(5)]
    print(classify(5, adj))  # K5
```

**Follow-up.** Real non-planarity detection looks for `K5`/`K3,3` *subdivisions* (paths replacing edges) or *minors* (contractions), not the exact graphs — that is Kuratowski/Wagner, decided in `O(V)` by a linear-time planarity tester that extracts the witness. This challenge is the toy base case.

---

### Challenge 4: Build the Dual Graph from a Traced Embedding

**Problem.** Given the face on each side of every edge (a map from directed dart to face id, e.g. from a face tracer), build the dual graph's adjacency. Skip bridges (same face on both sides) to avoid self-loops, or include them per spec.

**Example.**

```text
edges = [(0,1),(1,2),(2,0)]   (a triangle)
darts: (0,1),(1,2),(2,0) -> inner face 0 ; (1,0),(2,1),(0,2) -> outer face 1
Dual: face 0 and face 1 connected by 3 parallel edges (one per triangle edge).
```

**Constraints.** `E ≤ 10^6`.

**Approach.** For each undirected edge, look up the face on each side; connect those two faces in the dual. `O(E)`.

**Go.**

```go
package main

import "fmt"

func buildDual(edges [][2]int, faceOf map[[2]int]int) map[int][]int {
	dual := map[int][]int{}
	for _, e := range edges {
		f1 := faceOf[[2]int{e[0], e[1]}]
		f2 := faceOf[[2]int{e[1], e[0]}]
		if f1 != f2 { // skip bridges to avoid self-loops
			dual[f1] = append(dual[f1], f2)
			dual[f2] = append(dual[f2], f1)
		}
	}
	return dual
}

func main() {
	edges := [][2]int{{0, 1}, {1, 2}, {2, 0}}
	faceOf := map[[2]int]int{
		{0, 1}: 0, {1, 2}: 0, {2, 0}: 0,
		{1, 0}: 1, {2, 1}: 1, {0, 2}: 1,
	}
	fmt.Println(buildDual(edges, faceOf)) // face 0 <-> face 1 (x3)
}
```

**Java.**

```java
import java.util.*;

public class BuildDual {
    static Map<Integer, List<Integer>> buildDual(int[][] edges, Map<Long, Integer> faceOf) {
        Map<Integer, List<Integer>> dual = new HashMap<>();
        for (int[] e : edges) {
            int f1 = faceOf.get(key(e[0], e[1]));
            int f2 = faceOf.get(key(e[1], e[0]));
            if (f1 != f2) {
                dual.computeIfAbsent(f1, k -> new ArrayList<>()).add(f2);
                dual.computeIfAbsent(f2, k -> new ArrayList<>()).add(f1);
            }
        }
        return dual;
    }

    static long key(int u, int v) { return ((long) u << 20) | v; }

    public static void main(String[] args) {
        int[][] edges = {{0, 1}, {1, 2}, {2, 0}};
        Map<Long, Integer> faceOf = new HashMap<>();
        faceOf.put(key(0, 1), 0); faceOf.put(key(1, 2), 0); faceOf.put(key(2, 0), 0);
        faceOf.put(key(1, 0), 1); faceOf.put(key(2, 1), 1); faceOf.put(key(0, 2), 1);
        System.out.println(buildDual(edges, faceOf));
    }
}
```

**Python.**

```python
from collections import defaultdict


def build_dual(edges, face_of):
    dual = defaultdict(list)
    for u, v in edges:
        f1, f2 = face_of[(u, v)], face_of[(v, u)]
        if f1 != f2:  # skip bridges
            dual[f1].append(f2)
            dual[f2].append(f1)
    return dict(dual)


if __name__ == "__main__":
    edges = [(0, 1), (1, 2), (2, 0)]
    face_of = {
        (0, 1): 0, (1, 2): 0, (2, 0): 0,
        (1, 0): 1, (2, 1): 1, (0, 2): 1,
    }
    print(build_dual(edges, face_of))  # 0 <-> 1 three times
```

**Follow-up.** The dual is the structure you color for map coloring. How would you deduplicate parallel dual edges if you only care about adjacency (not multiplicity)? Use a set per face. Why keep multiplicity for min-cut? Because each parallel dual edge corresponds to a distinct primal edge in the cut.

---

## Common Pitfalls in Interviews

- **Forgetting the outer face.** A triangle has `F = 2`. If your face count is off by exactly one, you almost certainly dropped the outer face.
- **Using the wrong Euler form.** Connected: `F = E − V + 2`. Disconnected: `F = 1 + C − V + E`. Mixing them up is the classic bug.
- **Treating the edge bound as sufficient.** "Passed `3V − 6`, therefore planar" is wrong — `K3,3` passes it. State clearly that the bound only rejects.
- **Missing the bipartite bound.** Declaring `K3,3` planar because it survives `3V − 6`. Triangle-free graphs need `2V − 4`.
- **Integer overflow.** `3V − 6` for large `V` overflows 32-bit ints; use 64-bit when `V` can exceed ~700 million.
- **Applying bounds to multigraphs.** Self-loops and parallel edges break the simple-graph bounds; normalize first.
- **Confusing this Euler with Eulerian paths.** "Euler's formula" (faces) is different from "Eulerian path/circuit" (traversing every edge once) — see sibling `12-eulerian-path-circuit`.
- **Hand-waving planarity testing.** Saying "just check for `K5`/`K3,3`" without noting that you mean *subdivisions/minors* and that linear-time testers exist.

---

## What Interviewers Are Really Testing

A planar-graph question rarely checks whether you can recite "`V − E + F = 2`." It checks three deeper things. First, can you *derive* rather than memorize? Turning the face-handshake `Σ deg(f) = 2E` plus Euler's formula into `E ≤ 3V − 6`, and then into a one-line proof that `K5` is non-planar, shows real understanding. Second, can you reason about *necessary vs sufficient*? The edge bound rejects but does not confirm; recognizing that `K3,3` passes the generic bound yet is non-planar is the litmus test that separates depth from rote learning. Third, do you know the *layered toolkit* — `O(1)` filter, linear-time embedder, Kuratowski witness, dual graph, four/five-color results — and when each applies? You will not implement a linear-time planarity tester on a whiteboard, but you should name Hopcroft–Tarjan / Boyer–Myrvold / Left-Right, explain that they are `O(V)`, and describe the dual as the bridge to map coloring. The best answers also connect to production: rejecting infeasible routing inputs early, validating mesh topology with the Euler invariant, and explaining non-planarity to a user via a highlighted `K3,3`. A planar-graph question is compact enough to demonstrate theory, complexity reasoning, and systems judgment in a single conversation.

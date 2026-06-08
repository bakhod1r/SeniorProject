# Minkowski Sum of Convex Polygons — Interview Preparation

> Covers tiered Q&A (junior → professional) plus a full multi-language coding challenge. Each answer states the *idea*, the *complexity*, and the *gotcha* an interviewer probes for.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Rapid-Fire Round](#rapid-fire-round)
6. [Coding Challenge](#coding-challenge)
7. [Follow-up Extensions](#follow-up-extensions)

---

## Junior Questions

### J1. What is the Minkowski sum of two sets?

`A ⊕ B = { a + b : a ∈ A, b ∈ B }` — every point of `A` added to every point of `B`. Geometrically, stamp a copy of `B` at every point of `A` and union the stamps. **Gotcha:** it is *not* an intersection or a difference; it grows the shape.

### J2. If `A` and `B` are convex polygons, what is `A ⊕ B`?

Another convex polygon, with at most `n + m` vertices. **Gotcha:** the "at most" — collinear edges fuse, so it can have fewer.

### J3. How fast can you compute it for two convex polygons, and how?

`O(n + m)` by merging the two polygons' **edge vectors in polar-angle order**, chained tip-to-tail. **Gotcha:** the inputs must be convex and CCW; reorder each to start at its bottom-most vertex.

### J4. What is `A ⊕ {p}` where `{p}` is a single point?

Just `A` translated by `p` — shift every vertex by `p`. A good sanity check for any implementation.

### J5. Why merge edges by angle instead of computing all `n × m` sums?

All-pairs gives `nm` points and needs a convex hull — `O(nm log nm)`. The edge merge is `O(n + m)` because the result has at most `n + m` edges, all parallel to input edges.

### J6. How do you compare two edge directions without `atan2`?

Use the **cross product**: `cross(u, v) > 0` means `v` is CCW from `u` (u has the smaller angle, roughly), `< 0` the reverse, `= 0` parallel. Exact for integers, no trig. For a full `[0, 2π)` ordering you first split by half-plane (lower vs upper), then break ties within a half by the cross product — but in the merge, because both edge lists are already monotone, comparing the two current front edges by cross product suffices.

### J7. Work a tiny example by hand: sum of two unit segments.

`A = {(0,0),(1,0)}` (horizontal segment), `B = {(0,0),(0,1)}` (vertical segment). Every `a + b`: `(0,0),(1,0),(0,1),(1,1)` — the **unit square**. Two segments at an angle sum to a parallelogram; parallel segments sum to a longer segment. This is the simplest non-trivial Minkowski sum and a great sanity check.

### J8. What does the sum look like if `B` is a small disk?

`A ⊕ disk(r)` is `A` "fattened" by `r` in every direction — edges shift out by `r`, corners become rounded (circular arcs). This is exactly polygon *offsetting*, the operation behind CAD tool-paths and "safety margins."

| # | Question | Expected focus |
|---|----------|----------------|
| J1 | Define `A ⊕ B`. | `{a+b}`, union-of-stamps picture |
| J2 | Sum of two convex polygons? | Convex, ≤ n+m vertices |
| J3 | Complexity + method? | O(n+m), edge merge by angle |
| J4 | `A ⊕ {p}`? | Pure translation |
| J5 | Why not all-pairs? | O(nm log nm) vs O(n+m) |
| J6 | Compare angles without atan2? | Cross-product sign |

---

## Middle Questions

### M1. Prove (informally) that the sum of two convex polygons is convex.

Take `p = a₁+b₁`, `q = a₂+b₂` in the sum and `t ∈ [0,1]`. Then `(1−t)p + tq = [(1−t)a₁+ta₂] + [(1−t)b₁+tb₂]`; both brackets lie in `A`, `B` by their convexity, so the combination lies in `A ⊕ B`. The segment stays inside ⇒ convex.

### M2. What is the support function and why does it matter here?

`h_K(d) = max_{x∈K} ⟨x,d⟩`. The key identity is `h_{A⊕B}(d) = h_A(d) + h_B(d)` — the sum's furthest point in any direction is the sum of the operands' furthest points. This single fact proves convexity *and* explains the edge merge.

### M3. What is the difference between `A ⊖ B` and `A ⊕ (−B)`?

`A ⊖ B = {c : c+B ⊆ A}` is **erosion** (shrinking) — an intersection of translated copies of `A`. `A ⊕ (−B) = {a−b}` is the **reflection-sum** used in collision detection. They are different sets; conflating them is a classic bug. **Gotcha:** `A ⊖ B ≠ A ⊕ (−B)` in general.

### M4. How does the Minkowski sum reduce robot motion planning to moving a point?

Inflate each obstacle `O` by the *reflected* robot: `CO = O ⊕ (−R)`. The robot's reference point collides with `O` exactly when it enters `CO`. After inflating all obstacles, plan a path for a single point through the free space. This is the **configuration-space** transformation.

### M5. Why `−R` and not `R` in the inflation?

The robot placed at `r` is `{r + p : p ∈ R}`; it touches obstacle point `o` when `r + p = o`, i.e. `r = o − p ∈ O ⊕ (−R)`. The reflection comes from solving for the reference point.

### M6. When does the linear merge *not* apply?

When either operand is non-convex. Then you must convex-decompose, sum pieces pairwise, and union — `O(n²m²)` worst case.

### M7. How many vertices can `A ⊕ B` have, and when is it fewer than `n + m`?

At most `n + m`. It is strictly fewer whenever an edge of `A` is parallel to an edge of `B` (same outward normal) — those two edges fuse into one in the sum. Two regular polygons rotated by a generic angle hit the maximum `n + m`; aligned axis-parallel boxes fuse and give fewer.

### M8. Show that collision detection reduces to one point test.

`A` and `B` overlap iff some `a ∈ A` equals some `b ∈ B`, i.e. `a − b = 0`. The set of all `a − b` is exactly `A ⊕ (−B)`. So overlap ⇔ the origin lies in that single convex set — one point-in-convex-polygon test instead of comparing two shapes directly. This is the conceptual core of GJK.

| # | Question | Expected focus |
|---|----------|----------------|
| M1 | Prove convexity. | Convex-combination closure |
| M2 | Support function role? | `h_{A⊕B}=h_A+h_B` |
| M3 | `A ⊖ B` vs `A ⊕ (−B)`? | Erosion vs reflection-sum |
| M4 | Motion planning reduction? | C-space inflation |
| M5 | Why reflect the robot? | Solve `r = o − p` |
| M6 | When is merge invalid? | Non-convex inputs |

---

## Senior Questions

### S1. How does GJK use the Minkowski difference?

GJK tests `0 ∈ A ⊕ (−B)` (collision ⇔ origin inside) using only the **support function** `support_A(d) − support_B(−d)`. It builds a simplex toward the origin and never materializes the difference. This works identically in 2-D and 3-D, which is why it dominates physics engines.

### S2. You have 10,000 moving convex bodies. Do you materialize Minkowski sums each frame?

No. Materializing is wasteful for dynamic shapes. Run a **broadphase** (AABB sweep-and-prune / BVH) to cull pairs, then lazy **GJK** (+ EPA for depth) on survivors. Materialize only for *static* geometry you reuse, like C-space obstacles.

### S3. How do you handle a non-convex robot or obstacle?

**Convex-decompose** both (triangulation, optimal decomposition, or approximate convex decomposition / V-HACD), sum every convex pair, and union. Key lever: **minimize piece count**, since cost scales with `pq` and the union of `O(nm)` segments can hit `O(n²m²)`.

### S4. What's the role of EPA after GJK?

GJK only says yes/no (and distance when apart). When shapes overlap, **EPA** expands GJK's terminal simplex to the boundary of `A ⊕ (−B)` to find the closest boundary point to the origin → **penetration depth** and **contact normal** for the solver.

### S5. How is CAD offsetting a Minkowski sum?

Offsetting a part outward by radius `r` is `part ⊕ disk(r)`: edges shift out by `r`, convex corners become circular arcs, reflex corners may self-intersect and need trimming. Disks are approximated by `k`-gons; chord error `≈ r(1 − cos(π/k))`.

### S6. What breaks numerically and how do you defend?

Near-collinear edges flip cross-product signs → non-convex "sums" or GJK that cycles. Defenses: integer coordinates + 64-bit cross products, robust/adaptive predicates (Shewchuk, CGAL), GJK iteration cap + a contact margin.

### S7. How does temporal coherence speed up a collision engine?

Shapes move only slightly between frames, so the previous frame's separating axis (for disjoint pairs) or GJK simplex (for close pairs) is an excellent warm start. Reusing it typically cuts GJK to 1–2 iterations and lets SAT re-check the cached axis first. Combined with a stable broadphase (sweep-and-prune exploits sorted coherence too), this is what makes large dynamic scenes real-time.

### S8. When would you precompute a distance/clearance field instead of running GJK live?

When obstacles are static and many queries ask "how far is the nearest obstacle from point `p`?" — e.g. sampling-based planners scoring thousands of candidate poses. Inflate obstacles once (Minkowski sum with the robot), then build a distance field over free space; each query becomes an `O(1)` lookup instead of a per-pair GJK. Trade memory and preprocessing for query latency.

| # | Question | Expected focus |
|---|----------|----------------|
| S1 | GJK + Minkowski diff? | Origin test via support fn |
| S2 | 10k bodies per frame? | Broadphase + lazy GJK |
| S3 | Non-convex inputs? | Decompose, minimize pieces |
| S4 | Why EPA? | Penetration depth + normal |
| S5 | CAD offsetting? | `part ⊕ disk`, arcs |
| S6 | Numerical defenses? | Robust predicates, margins |

---

## Professional Questions

### P1. State and prove the edge-count bound.

`#edges(A ⊕ B) ≤ n + m`. Every edge of the sum is parallel to an edge of `A` or `B` (since `F_{A⊕B}(d) = F_A(d) + F_B(d)` is an edge iff some operand's face is an edge). The `n + m` edge-normals partition the circle into ≤ `n + m` arcs; shared normals fuse. Hence ≤ `n + m` edges.

### P2. Prove the angular merge correct.

Loop invariant: after `k` emitted edges, the polyline is the boundary of `A ⊕ B` for directions in `[0, θ_k]`, and the current vertex equals `F_A(d) + F_B(d)` for `d` just past `θ_k`. Base: the bottom vertex `A[0]+B[0] = F_{A⊕B}(−y)`. Step: appending the smaller-angle edge advances the corresponding support vertex (Lemma 1); ties fuse. Terminates in ≤ `n+m` steps as `θ` sweeps `[0,2π)`.

### P3. Prove `A ∩ B ≠ ∅ ⇔ 0 ∈ A ⊕ (−B)`.

(⇒) `x ∈ A ∩ B ⇒ 0 = x − x ∈ A ⊕ (−B)`. (⇐) `0 = a − b ⇒ a = b ∈ A ∩ B`. ∎

### P4. What is the worst-case complexity of the non-convex sum, with justification?

`Θ(n²m²)`. Lower bound: orthogonal comb polygons make `Θ(n)` × `Θ(m)` teeth interact, each producing `Θ(nm)` features. Upper bound: decompose into `p`, `q` convex pieces; pairwise sums total `O(nm)` edges; their Boolean union (overlay of `O(nm)` segments) yields up to `O((nm)²)` intersection points.

### P5. Why is `A ⊖ B ≠ A ⊕ (−B)`?

`A ⊖ B = ⋂_{b∈B}(A − b)` is an *intersection* (erosion), generally smaller than and shaped differently from the *reflection-sum* `A ⊕ (−B)`. Only `(A ⊖ B) ⊕ B ⊆ A` holds, with equality only when `A` has no necks thinner than `B`.

### P6. How do you make the orientation predicate robust?

Compute `cross(u,v)` in floating point with an error bound `≈ O(ε·C²)` for coordinates `≤ C`; if `|fl(cross)|` exceeds the bound, the sign is certified, else fall back to exact rational arithmetic (adaptive predicates). Integer inputs with 64/128-bit cross products avoid the issue entirely.

| # | Question | Expected focus |
|---|----------|----------------|
| P1 | Edge-count bound proof. | ≤ n+m via edge-normals |
| P2 | Merge correctness. | Loop invariant + support identity |
| P3 | Origin-test proof. | `a−a=0` both directions |
| P4 | Non-convex complexity. | Θ(n²m²), comb construction |
| P5 | Erosion ≠ reflection-sum. | Intersection vs sum |
| P6 | Robust predicates. | Error bound + exact fallback |

---

## Rapid-Fire Round

| Prompt | Answer |
|--------|--------|
| Is `⊕` commutative? | Yes: `A ⊕ B = B ⊕ A`. |
| Is `⊕` associative? | Yes. |
| `A ⊕ ∅` = ? | `∅`. |
| Max vertices of `A ⊕ B`? | `n + m`. |
| Sum of two segments? | A parallelogram (or a segment if parallel). |
| Sum of a polygon and a disk? | The polygon offset outward (arcs at corners). |
| Collision test reduces to? | Origin inside `A ⊕ (−B)`. |
| To keep `−B` CCW you must also? | Reverse the vertex order. |
| Best way to compare edge angles? | Cross-product sign. |
| Non-convex sum complexity? | `O(n²m²)`. |
| What does EPA compute? | Penetration depth + normal. |
| C-space obstacle formula? | `O ⊕ (−R)`. |
| Is the merge optimal? | Yes — `Ω(n+m)` to write the output. |
| Master support identity? | `h_{A⊕B} = h_A + h_B`. |
| Start vertex for the merge? | Bottom-most (lowest y, then x) of each. |
| `A ⊕ disk(r)` is? | The polygon offset outward by `r` (rounded corners). |
| Brunn–Minkowski (2-D)? | `√area(A⊕B) ≥ √area(A) + √area(B)`. |
| 3-D explicit sum complexity? | `Θ(nm)` faces. |
| Why GJK over materializing in 3-D? | Support-only, dimension-agnostic, no `Θ(nm)` build. |

---

### Dialogue D — "Why not sort all edges with atan2 and merge once?"

> **You:** "You *can* — sort all `n + m` edge vectors by polar angle and chain them, `O((n+m) log(n+m))`. But if each input is already convex and CCW, its edges are *already* angle-sorted, so I skip the sort and merge in `O(n + m)`. The atan2 sort also introduces floating-point ties for collinear edges; a cross-product comparison keeps it exact for integer coordinates. So I'd only reach for the explicit sort when summing many polygons at once or when inputs aren't pre-ordered."
>
> **Interviewer:** "Many polygons?" → **You:** "Since `⊕` is associative and commutative, the sum of `k` convex polygons has all their edges merged by angle — I can dump every edge into one list, sort once, and chain, instead of folding pairwise."

---

## Coding Challenge

### Challenge: Minkowski sum of two convex polygons

> **Given** two convex polygons in CCW order (each a list of integer `(x, y)` vertices), **return** their Minkowski sum as a CCW convex polygon. Run in `O(n + m)`.
>
> Validate against the brute-force oracle: `convexHull({ a + b : a ∈ A, b ∈ B })` must yield the same vertex set.
>
> Example:
> `A = [(0,0),(2,0),(0,2)]`, `B = [(0,0),(1,0),(1,1),(0,1)]`
> → `[(0,0),(3,0),(3,1),(1,3),(0,3),(0,1)]` (collinear vertices acceptable).

#### Go

```go
package main

import "fmt"

type Pt struct{ X, Y int64 }

func add(a, b Pt) Pt      { return Pt{a.X + b.X, a.Y + b.Y} }
func sub(a, b Pt) Pt      { return Pt{a.X - b.X, a.Y - b.Y} }
func cross(a, b Pt) int64 { return a.X*b.Y - a.Y*b.X }

func reorder(p []Pt) []Pt {
	k := 0
	for i := 1; i < len(p); i++ {
		if p[i].Y < p[k].Y || (p[i].Y == p[k].Y && p[i].X < p[k].X) {
			k = i
		}
	}
	out := make([]Pt, len(p))
	for i := range p {
		out[i] = p[(k+i)%len(p)]
	}
	return out
}

func minkowski(a, b []Pt) []Pt {
	a, b = reorder(a), reorder(b)
	a = append(a, a[0], a[1])
	b = append(b, b[0], b[1])
	var res []Pt
	i, j := 0, 0
	for i < len(a)-2 || j < len(b)-2 {
		res = append(res, add(a[i], b[j]))
		c := cross(sub(a[i+1], a[i]), sub(b[j+1], b[j]))
		switch {
		case c > 0:
			i++
		case c < 0:
			j++
		default:
			i++
			j++
		}
	}
	return res
}

func main() {
	a := []Pt{{0, 0}, {2, 0}, {0, 2}}
	b := []Pt{{0, 0}, {1, 0}, {1, 1}, {0, 1}}
	fmt.Println(minkowski(a, b))
}
```

#### Java

```java
import java.util.*;

public class Solution {
    record Pt(long x, long y) {}
    static Pt add(Pt a, Pt b) { return new Pt(a.x + b.x, a.y + b.y); }
    static Pt sub(Pt a, Pt b) { return new Pt(a.x - b.x, a.y - b.y); }
    static long cross(Pt a, Pt b) { return a.x * b.y - a.y * b.x; }

    static List<Pt> reorder(List<Pt> p) {
        int k = 0;
        for (int i = 1; i < p.size(); i++)
            if (p.get(i).y() < p.get(k).y()
                || (p.get(i).y() == p.get(k).y() && p.get(i).x() < p.get(k).x())) k = i;
        List<Pt> out = new ArrayList<>();
        for (int i = 0; i < p.size(); i++) out.add(p.get((k + i) % p.size()));
        return out;
    }

    static List<Pt> minkowski(List<Pt> a, List<Pt> b) {
        a = new ArrayList<>(reorder(a)); a.add(a.get(0)); a.add(a.get(1));
        b = new ArrayList<>(reorder(b)); b.add(b.get(0)); b.add(b.get(1));
        List<Pt> res = new ArrayList<>();
        int i = 0, j = 0;
        while (i < a.size() - 2 || j < b.size() - 2) {
            res.add(add(a.get(i), b.get(j)));
            long c = cross(sub(a.get(i + 1), a.get(i)), sub(b.get(j + 1), b.get(j)));
            if (c > 0) i++; else if (c < 0) j++; else { i++; j++; }
        }
        return res;
    }

    public static void main(String[] args) {
        List<Pt> a = List.of(new Pt(0,0), new Pt(2,0), new Pt(0,2));
        List<Pt> b = List.of(new Pt(0,0), new Pt(1,0), new Pt(1,1), new Pt(0,1));
        System.out.println(minkowski(a, b));
    }
}
```

#### Python

```python
def add(a, b): return (a[0] + b[0], a[1] + b[1])
def sub(a, b): return (a[0] - b[0], a[1] - b[1])
def cross(a, b): return a[0] * b[1] - a[1] * b[0]


def reorder(p):
    k = min(range(len(p)), key=lambda i: (p[i][1], p[i][0]))
    return p[k:] + p[:k]


def minkowski(a, b):
    a, b = reorder(a), reorder(b)
    a, b = a + [a[0], a[1]], b + [b[0], b[1]]
    res, i, j = [], 0, 0
    while i < len(a) - 2 or j < len(b) - 2:
        res.append(add(a[i], b[j]))
        c = cross(sub(a[i + 1], a[i]), sub(b[j + 1], b[j]))
        if c > 0:
            i += 1
        elif c < 0:
            j += 1
        else:
            i += 1
            j += 1
    return res


# --- brute-force oracle for testing ---
def convex_hull(pts):
    pts = sorted(set(pts))
    if len(pts) <= 1:
        return pts
    def half(points):
        h = []
        for p in points:
            while len(h) >= 2 and cross(sub(h[-1], h[-2]), sub(p, h[-2])) <= 0:
                h.pop()
            h.append(p)
        return h[:-1]
    return half(pts) + half(pts[::-1])


def brute(a, b):
    return convex_hull([add(p, q) for p in a for q in b])


if __name__ == "__main__":
    a = [(0, 0), (2, 0), (0, 2)]
    b = [(0, 0), (1, 0), (1, 1), (0, 1)]
    print("merge:", minkowski(a, b))
    print("oracle hull:", brute(a, b))
```

**Expected output (merge):** `[(0, 0), (2, 0), (3, 0), (3, 1), (1, 3), (0, 3), (0, 1)]` — the oracle hull matches its non-collinear vertices.

---

## Follow-up Extensions

1. **Collision variant:** modify the solution to answer "do `A` and `B` overlap?" using `0 ∈ A ⊕ (−B)` — reflect `B` (negate + reverse), sum, then point-in-convex-polygon test on the origin.
2. **C-space variant:** given an obstacle and a robot footprint, return the inflated obstacle `O ⊕ (−R)`.
3. **Penetration depth:** after detecting overlap, find the minimum translation vector (distance from origin to the boundary of `A ⊕ (−B)`).
4. **3-D twist:** explain why the explicit sum is impractical in 3-D and how GJK sidesteps it.
5. **Non-convex twist:** outline decomposing each input into convex pieces, summing pairwise, and unioning — and the resulting `O(n²m²)` bound.

---

## Definitions to Memorize

State these crisply on demand — interviewers test precision, especially the difference vs reflection-sum distinction.

```text
Minkowski sum:        A ⊕ B = { a + b : a ∈ A, b ∈ B }
Reflection:           −B = { −b : b ∈ B }   (negate AND reverse to keep CCW)
Reflection-sum:       A ⊕ (−B) = { a − b }   ← collision detection uses THIS
Minkowski difference: A ⊖ B = { c : c + B ⊆ A } = ⋂_{b∈B}(A − b)   ← erosion, NOT the above
Support function:     h_K(d) = max_{x∈K} ⟨x, d⟩
Master identity:      h_{A⊕B}(d) = h_A(d) + h_B(d)
Collision test:       A ∩ B ≠ ∅  ⇔  0 ∈ A ⊕ (−B)
C-space obstacle:     CO = O ⊕ (−R)   (R = robot footprint)
```

## Complexity Quick Reference

| Task | Complexity | Why |
|------|-----------|-----|
| Convex ⊕ convex | O(n + m) | Edge merge; output ≤ n+m edges |
| Translate (`A ⊕ {p}`) | O(n) | Shift every vertex |
| Reflect (`−B`) | O(n) | Negate + reverse |
| Not pre-sorted by angle | O(n log n + m log m) | One sort each |
| All-pairs + hull (oracle) | O(nm log nm) | nm points hulled |
| Point-in-convex (origin test) | O(n) | Half-plane checks |
| GJK overlap (lazy) | O(k(n+m)) | k = small iteration count |
| Convex ⊕ non-convex | O(nm log nm) | m convex pieces |
| Non-convex ⊕ non-convex | O(n²m²) | Decompose + union overlay |

## Whiteboard Scenarios

These are open-ended "design / reason it out loud" prompts that interviewers use to probe depth. Each lists the *trap*, the *strong answer*, and the *follow-up* the interviewer will push.

### W1. "A round robot of radius `r` drives among polygonal walls. Plan a collision-free path."

- **Trap:** trying to plan for a *disk* moving among polygons directly (hard).
- **Strong answer:** inflate every wall by the disk via `wall ⊕ disk(r)` (a Minkowski sum giving rounded corners), turning the robot into a *point*. The inflated obstacles' free space is then searched with a visibility graph or grid A*. The disk has no orientation, so the configuration space is just 2-D `(x, y)` — no `θ` dimension.
- **Follow-up:** "What if the robot were a long rectangle?" → now orientation matters; the C-space becomes `(x, y, θ)` and you inflate per-orientation slice, or restrict to a finite set of headings.

### W2. "Detect collisions among 50,000 convex pieces in a physics step. Walk me through the pipeline."

- **Trap:** running a pairwise narrowphase on all `~10⁹` pairs.
- **Strong answer:** broadphase first (sweep-and-prune on AABBs, or a BVH/spatial hash) to cull to `O(n)` candidate pairs; then lazy **GJK** on survivors (origin test on `A ⊕ (−B)` via support functions, no materialization); EPA only when GJK reports overlap, to get depth + normal for the solver. Reuse the previous frame's separating axis / simplex as a warm start (temporal coherence).
- **Follow-up:** "How do you make GJK numerically stable?" → iteration cap, contact margin, robust support tie-breaking; warm-starting reduces iterations.

### W3. "Offset a 2-D CAM part outward by the cutter radius. What does the geometry look like?"

- **Trap:** assuming the offset is just "move every edge out by `r`" with no corner handling.
- **Strong answer:** `part ⊕ disk(r)`. Edges shift out along their outward normal; convex corners become **circular arcs** of radius `r`; reflex (concave) corners can make the offset self-intersect and must be trimmed by a Boolean cleanup. CAM tools approximate the disk by a `k`-gon (chord error `r(1−cos(π/k))`) or carry true arcs.
- **Follow-up:** "Inward offset?" → that is erosion `part ⊖ disk(r)`; thin features can vanish or split the part into pieces.

### W4. "Why can't you just always use the all-pairs construction — it's simpler?"

- **Trap:** thinking `O(nm log nm)` is fine.
- **Strong answer:** for two convex inputs the result has only `n + m` edges, so the all-pairs approach wastes work hulling `nm` points; at `n = m = 4096` that is ~`16.8M` points hulled vs a `~8K`-step merge — thousands of times slower. The all-pairs version is best kept as a *test oracle* for tiny inputs, not a production path.
- **Follow-up:** "When is all-pairs actually unavoidable?" → never for convex inputs; for non-convex you decompose instead.

---

## Common Wrong Answers (and the correct version)

| Wrong answer | Why it's wrong | Correct |
|--------------|----------------|---------|
| "`A ⊖ B = A ⊕ (−B)`." | Erosion is an intersection of translates, not a reflection-sum. | They are different sets; only `(A ⊖ B) ⊕ B ⊆ A`. |
| "Sum two convex polygons → hull of all `a+b`." | Correct but `O(nm log nm)`, not optimal. | Edge merge by angle, `O(n+m)`. |
| "Sort edges with `atan2` then merge." | Floating-point ties + slower. | Cross-product sign comparison; exact for integers. |
| "Collision ⇔ `0 ∈ A ⊕ B`." | It is the *reflection*-sum. | Collision ⇔ `0 ∈ A ⊕ (−B)`. |
| "Inflate obstacle by `+R`." | The reference-point algebra gives `−R`. | `CO = O ⊕ (−R)`. |
| "GJK builds the Minkowski difference." | It never materializes it. | GJK queries the support function only. |
| "The merge works on any polygon." | Needs convex, CCW inputs. | Convex-hull or decompose first. |

---

## Sample Dialogues (how to talk through the hard ones)

These transcripts model the *narration* an interviewer wants — thinking out loud, stating invariants, naming complexities.

### Dialogue A — "Walk me through computing `A ⊕ B` in linear time."

> **You:** "First I'll assume both polygons are convex and given counter-clockwise — I'll validate that or convex-hull them otherwise. The key fact is that the sum of two convex polygons is convex and has at most `n + m` edges, and every edge of the sum is parallel to an edge of `A` or `B`. So I don't need the interior at all."
>
> **You:** "I rotate each polygon to start at its bottom-most vertex — lowest `y`, then lowest `x`. After that, walking the boundary CCW gives the edge vectors in increasing polar angle. The bottom vertex of the sum is `A[0] + B[0]`, which is the support point of both in the `−y` direction."
>
> **You:** "Then it's a merge: two pointers, one per edge list. At each step I append whichever edge has the smaller polar angle, which I decide with a cross product — `cross(edgeA, edgeB) > 0` means `A`'s edge comes first. On a tie I append both, because collinear edges fuse into one. Each edge is consumed once, so it's `O(n + m)`, which is optimal because just writing the output is `Ω(n + m)`."
>
> **Interviewer:** "How do you know it's correct?" → **You:** "Loop invariant on the support function: after `k` edges the current vertex is `support_A(d) + support_B(d)` for the direction just past the last edge's angle. Advancing the smaller-angle edge advances exactly the operand whose support vertex changes there."

### Dialogue B — "Two convex shapes — do they collide?"

> **You:** "Collision reduces to a single point test: `A` and `B` intersect iff the origin is inside `A ⊕ (−B)`, the reflection-sum. That's because `a = b` for some points iff `a − b = 0`."
>
> **You:** "In an interview I'd either (a) build `A ⊕ (−B)` with the merge — reflect `B` by negating and reversing to keep CCW, sum, then a point-in-convex-polygon test on the origin, all `O(n + m)`; or (b) for production, use GJK, which never builds the difference — it samples its support function `support_A(d) − support_B(−d)` and grows a simplex toward the origin. GJK generalizes to 3-D for free, which is the real reason engines use it."
>
> **Interviewer:** "What if they overlap and you need to push them apart?" → **You:** "Run EPA after GJK: expand the terminal simplex to the boundary of the Minkowski difference; the closest boundary point to the origin gives the penetration depth and contact normal."

### Dialogue C — "Plan a path for a robot among obstacles."

> **You:** "I'll convert it to moving a *point*. Inflate every obstacle by the reflected robot: `CO = O ⊕ (−R)`. The reflection comes from the algebra — the robot at reference point `r` is `{r + p}`, which hits an obstacle point `o` when `r = o − p`, so the forbidden region for `r` is `O ⊕ (−R)`."
>
> **You:** "After inflating all obstacles and unioning overlaps, the robot is a point that must avoid the inflated obstacles. I plan with a visibility graph or grid A* over the free space. If the robot rotates, orientation becomes a third configuration dimension `θ` and I inflate per-orientation slice."

---

## Closing Checklist (say these and you pass)

- `A ⊕ B = {a+b}`; for convex polygons it is convex with `≤ n+m` edges.
- Build it in `O(n+m)` by **merging edge vectors in polar-angle order** (cross-product comparison).
- Convexity follows from convex-combination closure *and* `h_{A⊕B} = h_A + h_B`.
- **Collision** ⇔ `0 ∈ A ⊕ (−B)`; GJK answers this with support queries only; EPA gives depth.
- **Motion planning**: inflate obstacles `O ⊕ (−R)` so the robot becomes a point (C-space).
- **Erosion** `A ⊖ B` is *not* `A ⊕ (−B)` — keep them separate.
- **Non-convex**: decompose, sum pairwise, union — `O(n²m²)` worst case.
- Keep the arithmetic exact (integer cross products) or robust (adaptive predicates).
- The merge is **output-sensitive and optimal** — its time equals the output size, no log factor.
- Normalize inputs to CCW and start each at its bottom-most vertex before merging.
- `⊕` is commutative and associative, so `k`-polygon sums merge all edges in one angular pass.

---

## One-Minute Recap

If you have sixty seconds at the end of an interview, say this: "The Minkowski sum adds every point of one shape to every point of another. For convex polygons it's convex with at most `n + m` edges, built in optimal linear time by merging the two edge lists in polar-angle order using cross-product comparisons. It powers three things: collision detection — two shapes touch iff the origin is inside `A ⊕ (−B)`, which GJK tests with support functions alone; motion planning — inflate obstacles by the reflected robot so the robot becomes a point; and CAD offsetting — sum with a disk to grow a part. The only traps are confusing the erosion `A ⊖ B` with the reflection-sum `A ⊕ (−B)`, forgetting to reflect `B` for collisions, and letting floating-point flip a cross-product sign."
